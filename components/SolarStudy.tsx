"use client";

import { useState, useCallback, useRef } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import Tesseract from "tesseract.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const MONTHS_FR = [
  "Jan",
  "Fév",
  "Mar",
  "Avr",
  "Mai",
  "Jun",
  "Jul",
  "Aoû",
  "Sep",
  "Oct",
  "Nov",
  "Déc",
];
const MONTHS_FULL_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Biskra reference monthly production (kWh) for 285.13 kWp, PR=0.80, GHI=5.5 kWh/m²/day
// Source: Université de Biskra Thesis 2025-2026 Table 3.9
const BISKRA_MONTHLY_PROD = [
  28534, 30958, 40218, 41536, 47221, 46487, 47587, 45896, 39322, 36188, 27793,
  26180,
];
const BISKRA_E_ANNUAL = 457919; // kWh/yr — reference value

// Financial constants
const CO2_FACTOR = 0.55; // kg CO₂/kWh — Algeria grid emission factor
const HP_TARIFF_NM = 1.8064; // DA/kWh — H.Pointe tariff for net metering revenue
const TREES_PER_TCO2 = 45; // trees equivalent per tCO₂ absorbed
const VEHICLES_TCO2_YR = 2.3; // tCO₂/yr per average vehicle

// ─── Types ────────────────────────────────────────────────────────────────────
interface BillData {
  hp_kwh: number;
  peak_kwh: number;
  total_da: number;
  month: number;
  year: number;
}

interface BillSlot {
  file: File | null;
  preview: string | null;
  status: "empty" | "processing" | "done" | "error";
  data: BillData | null;
  edited: BillData | null;
  error?: string;
}

interface SystemParams {
  building_name: string;
  building_address: string;
  p_installed: number;
  ghi_annual: number;
  pr: number;
  capex: number;
  n_modules: number;
  module_brand: string;
  module_model: string;
  module_power: number;
  inverter_brand: string;
  n_inverters: number;
  tilt: number;
  orientation: string;
  roof_area: number;
}

interface FinancialParams {
  r: number;
  f: number;
  D: number;
  om_rate: number;
  DS: number;
  subsidy_rate: number;
}

interface DCFRow {
  year: number;
  e_self_n: number;
  t_n: number;
  energy_savings: number;
  ds: number;
  gross_savings: number;
  om: number;
  net_cf: number;
  dcf: number;
  cum_sc1: number;
  cum_sc2: number;
}

interface StudyResults {
  e_annual: number;
  fleh: number;
  monthly_pv: number[];
  monthly_cons: number[];
  monthly_sc: number[];
  monthly_scr: number[];
  scr: number;
  e_self_yr1: number;
  exported: number;
  t0: number;
  total_da: number;
  total_kwh: number;
  om_annual: number;
  yr1_energy_savings: number;
  yr1_gross_savings: number;
  yr1_net_cf: number;
  spp_sc1: number;
  spp_sc2: number;
  npv_sc1: number;
  npv_sc2: number;
  irr_sc1: number;
  irr_sc2: number;
  dpp_sc1: number | null;
  dpp_sc2: number | null;
  pi_sc1: number;
  pi_sc2: number;
  lcoe: number;
  dcf_table: DCFRow[];
  capex_sc2: number;
  co2_yr1: number;
  co2_25yr: number;
  nm_revenue: number;
  trees_equiv: number;
  vehicles_equiv: number;
}

// ─── Calculation Engine ───────────────────────────────────────────────────────
function calcIRR(cashflows: number[], investment: number): number {
  const npvFn = (r: number) =>
    cashflows.reduce(
      (acc, cf, i) => acc + cf / Math.pow(1 + r, i + 1),
      -investment,
    );

  if (npvFn(0.001) <= 0) return 0;
  let lo = 0.001,
    hi = 3.0;
  if (npvFn(hi) > 0) return hi;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    npvFn(mid) > 0 ? (lo = mid) : (hi = mid);
  }
  return (lo + hi) / 2;
}

function runStudy(
  bills: BillSlot[],
  sys: SystemParams,
  fin: FinancialParams,
): StudyResults {
  // 1 — Build monthly consumption array (index 0 = January)
  const monthly_cons = new Array(12).fill(0);
  let total_da = 0;
  let total_kwh = 0;

  const validBills = bills.filter((b) => b.edited?.month != null);
  validBills.forEach((b) => {
    const d = b.edited!;
    const idx = d.month - 1; // 0-based
    const cons = (d.hp_kwh || 0) + (d.peak_kwh || 0);
    monthly_cons[idx] = cons;
    total_da += d.total_da || 0;
    total_kwh += cons;
  });

  // Fill missing months with average
  const filledMonths = monthly_cons.filter((v) => v > 0);
  const avgCons =
    filledMonths.length > 0
      ? filledMonths.reduce((a, b) => a + b, 0) / filledMonths.length
      : 10000;
  const monthly_cons_filled = monthly_cons.map((v) => (v > 0 ? v : avgCons));

  // 2 — Annual energy production (IEC 61724-1:2021)
  const e_annual = sys.p_installed * sys.ghi_annual * (sys.pr / 100) * 365;
  const fleh = e_annual / sys.p_installed;

  // 3 — Monthly PV production (scaled from Biskra distribution)
  const scale = e_annual / BISKRA_E_ANNUAL;
  const monthly_pv = BISKRA_MONTHLY_PROD.map((v) => Math.round(v * scale));

  // 4 — SCR computation — NEVER use fixed value (per PRD critical requirement)
  const monthly_sc = monthly_pv.map((pv, i) =>
    Math.round(Math.min(pv, monthly_cons_filled[i])),
  );
  const e_self_yr1 = monthly_sc.reduce((a, b) => a + b, 0);
  const scr = (e_self_yr1 / e_annual) * 100;
  const exported = e_annual - e_self_yr1;
  const monthly_scr = monthly_pv.map((pv, i) =>
    pv > 0 ? Math.round((monthly_sc[i] / pv) * 100) : 0,
  );

  // 5 — Weighted tariff (MANDATORY: Σ invoices_DA / Σ consumption_kWh)
  const t0 = total_kwh > 0 ? total_da / total_kwh : 4.8018;

  // 6 — Year 1 financial
  const om_annual = sys.capex * (fin.om_rate / 100);
  const yr1_energy_savings = e_self_yr1 * t0;
  const yr1_gross_savings = yr1_energy_savings + fin.DS;
  const yr1_net_cf = yr1_gross_savings - om_annual;
  const spp_sc1 = sys.capex / yr1_gross_savings;
  const capex_sc2 = sys.capex * (1 - fin.subsidy_rate / 100);
  const spp_sc2 = capex_sc2 / yr1_gross_savings;

  // 7 — 25-year DCF loop (CRITICAL: DS is FIXED — never inflated)
  const D = fin.D / 100;
  const r = fin.r / 100;
  const f = fin.f / 100;

  let cum_sc1 = -sys.capex;
  let cum_sc2 = -capex_sc2;
  let dpp_sc1: number | null = null;
  let dpp_sc2: number | null = null;
  const dcf_table: DCFRow[] = [];
  const cashflows: number[] = [];

  for (let n = 1; n <= 25; n++) {
    const e_self_n = e_self_yr1 * Math.pow(1 - D, n - 1);
    const t_n = t0 * Math.pow(1 + f, n - 1);
    const ds_n = fin.DS; // ⚠️ FIXED — NEVER inflate
    const energy_savings = e_self_n * t_n;
    const gross_savings = energy_savings + ds_n;
    const net_cf = gross_savings - om_annual;
    const dcf = net_cf / Math.pow(1 + r, n);

    cashflows.push(net_cf);
    cum_sc1 += dcf;
    cum_sc2 += dcf;

    if (cum_sc1 >= 0 && dpp_sc1 === null) dpp_sc1 = n;
    if (cum_sc2 >= 0 && dpp_sc2 === null) dpp_sc2 = n;

    dcf_table.push({
      year: n,
      e_self_n: Math.round(e_self_n),
      t_n: parseFloat(t_n.toFixed(4)),
      energy_savings: Math.round(energy_savings),
      ds: fin.DS,
      gross_savings: Math.round(gross_savings),
      om: Math.round(om_annual),
      net_cf: Math.round(net_cf),
      dcf: Math.round(dcf),
      cum_sc1: Math.round(cum_sc1),
      cum_sc2: Math.round(cum_sc2),
    });
  }

  // Fix SC2 cumulative (same CFs, lower initial CAPEX)
  const subsidy_offset = sys.capex * (fin.subsidy_rate / 100);
  dcf_table.forEach((row) => {
    row.cum_sc2 = row.cum_sc1 + subsidy_offset;
  });
  dpp_sc2 = null;
  for (const row of dcf_table) {
    if (row.cum_sc2 >= 0 && dpp_sc2 === null) {
      dpp_sc2 = row.year;
      break;
    }
  }

  const npv_sc1 = cum_sc1;
  const npv_sc2 = npv_sc1 + subsidy_offset;

  // 8 — IRR (bisection, 6 decimal precision)
  const irr_sc1 = calcIRR(cashflows, sys.capex);
  const irr_sc2 = calcIRR(cashflows, capex_sc2);

  // 9 — LCOE
  let pv_om = 0,
    pv_energy = 0;
  for (let n = 1; n <= 25; n++) {
    pv_om += om_annual / Math.pow(1 + r, n);
    pv_energy += (e_annual * Math.pow(1 - D, n - 1)) / Math.pow(1 + r, n);
  }
  const lcoe = (sys.capex + pv_om) / pv_energy;

  // 10 — PI
  const pi_sc1 = 1 + npv_sc1 / sys.capex;
  const pi_sc2 = 1 + npv_sc2 / capex_sc2;

  // 11 — Environmental
  const co2_yr1 = (e_annual * CO2_FACTOR) / 1000;
  let co2_25yr = 0;
  for (let n = 0; n < 25; n++)
    co2_25yr += (e_annual * Math.pow(1 - D, n) * CO2_FACTOR) / 1000;

  const nm_revenue = exported * HP_TARIFF_NM;
  const trees_equiv = Math.round(co2_yr1 * TREES_PER_TCO2);
  const vehicles_equiv = Math.round(co2_yr1 / VEHICLES_TCO2_YR);

  return {
    e_annual: Math.round(e_annual),
    fleh: Math.round(fleh),
    monthly_pv,
    monthly_cons: monthly_cons_filled.map(Math.round),
    monthly_sc,
    monthly_scr,
    scr: parseFloat(scr.toFixed(2)),
    e_self_yr1: Math.round(e_self_yr1),
    exported: Math.round(exported),
    t0: parseFloat(t0.toFixed(4)),
    total_da: Math.round(total_da),
    total_kwh: Math.round(total_kwh),
    om_annual: Math.round(om_annual),
    yr1_energy_savings: Math.round(yr1_energy_savings),
    yr1_gross_savings: Math.round(yr1_gross_savings),
    yr1_net_cf: Math.round(yr1_net_cf),
    spp_sc1: parseFloat(spp_sc1.toFixed(1)),
    spp_sc2: parseFloat(spp_sc2.toFixed(1)),
    npv_sc1: Math.round(npv_sc1),
    npv_sc2: Math.round(npv_sc2),
    irr_sc1: parseFloat((irr_sc1 * 100).toFixed(2)),
    irr_sc2: parseFloat((irr_sc2 * 100).toFixed(2)),
    dpp_sc1,
    dpp_sc2,
    pi_sc1: parseFloat(pi_sc1.toFixed(3)),
    pi_sc2: parseFloat(pi_sc2.toFixed(3)),
    lcoe: parseFloat(lcoe.toFixed(2)),
    dcf_table,
    capex_sc2: Math.round(capex_sc2),
    co2_yr1: parseFloat(co2_yr1.toFixed(1)),
    co2_25yr: Math.round(co2_25yr),
    nm_revenue: Math.round(nm_revenue),
    trees_equiv,
    vehicles_equiv,
  };
}

// ─── Chart Helpers (Canvas → base64 PNG for PDF embedding) ────────────────────
function makeBarChart(
  vals1: number[],
  vals2: number[] | null,
  labels: string[],
  w: number,
  h: number,
  color1 = "#f59e0b",
  color2 = "#3b82f6",
  title = "",
): string {
  const cvs = document.createElement("canvas");
  cvs.width = w;
  cvs.height = h;
  const ctx = cvs.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const pad = { t: title ? 28 : 14, r: 16, b: 36, l: 56 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const allVals = [...vals1, ...(vals2 || [])];
  const maxV = Math.max(...allVals) * 1.15 || 1;
  const groups = vals1.length;
  const gw = cw / groups;
  const bw = gw * (vals2 ? 0.38 : 0.62);

  if (title) {
    ctx.fillStyle = "#374151";
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "center";
    ctx.fillText(title, w / 2, 16);
  }

  // Grid
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch - (ch * i) / 4;
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + cw, y);
    ctx.stroke();
    ctx.fillStyle = "#9ca3af";
    ctx.font = "9px Arial";
    ctx.textAlign = "right";
    const v = Math.round((maxV * i) / 4);
    ctx.fillText(
      v >= 1000 ? Math.round(v / 1000) + "k" : String(v),
      pad.l - 4,
      y + 3,
    );
  }

  vals1.forEach((v, i) => {
    const x = pad.l + i * gw;
    const bh = (v / maxV) * ch;
    ctx.fillStyle = color1;
    ctx.fillRect(
      x + (vals2 ? gw * 0.06 : (gw - bw) / 2),
      pad.t + ch - bh,
      bw,
      bh,
    );
    if (vals2) {
      const v2 = vals2[i];
      const bh2 = (v2 / maxV) * ch;
      ctx.fillStyle = color2;
      ctx.fillRect(x + gw * 0.52, pad.t + ch - bh2, bw, bh2);
    }
    ctx.fillStyle = "#374151";
    ctx.font = "9px Arial";
    ctx.textAlign = "center";
    ctx.fillText(labels[i], x + gw / 2, h - pad.b + 14);
  });

  // Axes
  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + ch);
  ctx.lineTo(pad.l + cw, pad.t + ch);
  ctx.stroke();

  return cvs.toDataURL("image/png");
}

function makeLineChart(
  data1: number[],
  data2: number[],
  labels: string[],
  w: number,
  h: number,
  label1 = "Sc1 (sans subvention)",
  label2 = "Sc2 (avec subvention)",
): string {
  const cvs = document.createElement("canvas");
  cvs.width = w;
  cvs.height = h;
  const ctx = cvs.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const pad = { t: 30, r: 20, b: 40, l: 72 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;

  const allD = [...data1, ...data2];
  const minV = Math.min(...allD) * (Math.min(...allD) < 0 ? 1.1 : 0.9);
  const maxV = Math.max(...allD) * 1.1;
  const range = maxV - minV || 1;

  const getX = (i: number) => pad.l + (i / (data1.length - 1)) * cw;
  const getY = (v: number) => pad.t + ch - ((v - minV) / range) * ch;

  // Zero line
  if (minV < 0 && maxV > 0) {
    const zy = getY(0);
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 0.8;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, zy);
    ctx.lineTo(pad.l + cw, zy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ef4444";
    ctx.font = "8px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Breakeven", pad.l + 2, zy - 3);
  }

  // Grid
  for (let i = 0; i <= 4; i++) {
    const v = minV + (range * i) / 4;
    const y = getY(v);
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + cw, y);
    ctx.stroke();
    ctx.fillStyle = "#9ca3af";
    ctx.font = "9px Arial";
    ctx.textAlign = "right";
    const label =
      Math.abs(v) >= 1e6
        ? (v / 1e6).toFixed(1) + "M"
        : Math.round(v / 1000) + "k";
    ctx.fillText(label, pad.l - 4, y + 3);
  }

  const drawLine = (data: number[], color: string, dash = false) => {
    if (dash) ctx.setLineDash([6, 3]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = getX(i),
        y = getY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };

  drawLine(data1, "#f59e0b");
  drawLine(data2, "#3b82f6", true);

  // X labels every 5 years
  ctx.fillStyle = "#374151";
  ctx.font = "9px Arial";
  ctx.textAlign = "center";
  labels.forEach((l, i) => {
    if (i % 5 === 0 || i === labels.length - 1)
      ctx.fillText(l, getX(i), h - pad.b + 14);
  });

  // Axes
  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + ch);
  ctx.lineTo(pad.l + cw, pad.t + ch);
  ctx.stroke();

  // Legend
  ctx.fillStyle = "#f59e0b";
  ctx.fillRect(pad.l, 8, 20, 7);
  ctx.fillStyle = "#374151";
  ctx.font = "9px Arial";
  ctx.textAlign = "left";
  ctx.fillText(label1, pad.l + 24, 15);
  ctx.fillStyle = "#3b82f6";
  ctx.fillRect(pad.l + 130, 8, 20, 7);
  ctx.fillText(label2, pad.l + 154, 15);

  return cvs.toDataURL("image/png");
}

// ─── PDF Generator ────────────────────────────────────────────────────────────
function generatePDF(
  res: StudyResults,
  sys: SystemParams,
  fin: FinancialParams,
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  let pageNum = 0;

  const fmt = (n: number) => n.toLocaleString("fr-DZ");
  const fmtDa = (n: number) => fmt(Math.round(n)) + " DA";

  const addPage = (showHeader = true) => {
    doc.addPage();
    pageNum++;
    if (showHeader) {
      doc.setFillColor(245, 158, 11);
      doc.rect(0, 0, PW, 2, "F");
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `SolarAnalytics.dz — ${sys.building_name} — Page ${pageNum + 1}`,
        PW / 2,
        7,
        { align: "center" },
      );
      doc.setDrawColor(230, 230, 230);
      doc.line(10, 8, PW - 10, 8);
    }
  };

  // ── COVER PAGE ──
  pageNum = 1;
  doc.setFillColor(13, 17, 23);
  doc.rect(0, 0, PW, PH, "F");
  doc.setFillColor(245, 158, 11);
  doc.rect(0, 0, 5, PH, "F");
  doc.setFillColor(245, 158, 11, 0.08);
  doc.rect(5, 0, PW - 5, 3, "F");

  doc.setTextColor(245, 158, 11);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.text("SolarAnalytics.dz", 18, 38);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text("Étude de Faisabilité Technico-Économique", 18, 50);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 180, 180);
  doc.text("Système Photovoltaïque Connecté au Réseau (Grid-Tied)", 18, 58);

  doc.setDrawColor(245, 158, 11);
  doc.setLineWidth(0.4);
  doc.line(18, 63, PW - 18, 63);

  doc.setTextColor(220, 220, 220);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Projet:", 18, 74);
  doc.setFont("helvetica", "normal");
  doc.text(sys.building_name, 45, 74);
  doc.setFont("helvetica", "bold");
  doc.text("Adresse:", 18, 82);
  doc.setFont("helvetica", "normal");
  doc.text(sys.building_address, 45, 82);
  doc.setFont("helvetica", "bold");
  doc.text("Puissance:", 18, 90);
  doc.setFont("helvetica", "normal");
  doc.text(
    `${sys.p_installed} kWp — ${sys.n_modules} modules ${sys.module_brand} ${sys.module_model}`,
    45,
    90,
  );
  doc.setFont("helvetica", "bold");
  doc.text("Date:", 18, 98);
  doc.setFont("helvetica", "normal");
  doc.text(
    new Date().toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    45,
    98,
  );

  // KPI preview cards
  const kpis = [
    {
      l: "VAN Sc1",
      v: `${(res.npv_sc1 / 1e6).toFixed(2)} M DA`,
      good: res.npv_sc1 > 0,
    },
    { l: "TRI Sc1", v: `${res.irr_sc1}%`, good: true },
    { l: "DRS Sc1", v: `${res.dpp_sc1 ?? "N/A"} ans`, good: true },
    { l: "LCOE", v: `${res.lcoe} DA/kWh`, good: true },
  ];
  kpis.forEach((k, i) => {
    const x = 18 + i * 45;
    doc.setFillColor(25, 35, 55);
    doc.roundedRect(x, 112, 40, 22, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    if (k.good) {
      doc.setTextColor(52, 211, 153);
    } else {
      doc.setTextColor(239, 68, 68);
    }
    doc.text(k.v, x + 20, 121, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(140, 140, 140);
    doc.text(k.l, x + 20, 129, { align: "center" });
  });

  // Methodology note
  doc.setFontSize(7.5);
  doc.setTextColor(100, 100, 100);
  doc.text(
    "Méthodologie conforme IEC 61724-1:2021 | Référence: Thèse Université de Biskra 2025-2026",
    18,
    144,
  );
  doc.text(
    "SCR calculé mensuellement (min(E_PV,m, E_cons,m)) — Jamais de valeur fixe supposée",
    18,
    150,
  );

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(60, 60, 60);
  doc.text(
    "© SolarAnalytics.dz — Confidentiel — Tous droits réservés",
    PW / 2,
    PH - 12,
    { align: "center" },
  );

  // ── PAGE 2: RÉSUMÉ EXÉCUTIF ──
  addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(13, 17, 23);
  doc.text("Résumé Exécutif", 14, 20);
  doc.setFillColor(245, 158, 11);
  doc.rect(14, 22, 40, 0.8, "F");

  autoTable(doc, {
    startY: 27,
    head: [
      [
        "Indicateur",
        "Scénario 1 (Sans subvention)",
        "Scénario 2 (Avec subvention 20%)",
        "Unité",
      ],
    ],
    body: [
      ["Valeur Actuelle Nette (VAN)", fmt(res.npv_sc1), fmt(res.npv_sc2), "DA"],
      [
        "Taux de Rentabilité Interne (TRI)",
        `${res.irr_sc1}%`,
        `${res.irr_sc2}%`,
        "",
      ],
      [
        "Délai de Récupération Simple (DRS)",
        `${res.spp_sc1} ans`,
        `${res.spp_sc2} ans`,
        "ans",
      ],
      [
        "Délai de Récupération Actualisé (DRA)",
        `${res.dpp_sc1 ?? ">25"} ans`,
        `${res.dpp_sc2 ?? ">25"} ans`,
        "ans",
      ],
      [
        "Indice de Profitabilité (IP)",
        res.pi_sc1.toFixed(3),
        res.pi_sc2.toFixed(3),
        "",
      ],
      [
        "Coût Actualisé de l'Énergie (LCOE)",
        res.lcoe.toFixed(2),
        res.lcoe.toFixed(2),
        "DA/kWh",
      ],
      ["Investissement Initial", fmt(sys.capex), fmt(res.capex_sc2), "DA"],
      [
        "Economies An 1 (Brutes)",
        fmt(res.yr1_gross_savings),
        fmt(res.yr1_gross_savings),
        "DA/an",
      ],
    ],
    headStyles: {
      fillColor: [13, 17, 23],
      textColor: [245, 158, 11],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "center" },
    },
  });

  const afterSummary = (doc as any).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: afterSummary,
    head: [["Indicateur Technique", "Valeur", "Unité"]],
    body: [
      ["Production annuelle estimée", fmt(res.e_annual), "kWh/an"],
      ["Heures pleine charge (FLEH)", fmt(res.fleh), "h/an"],
      ["Taux d'autoconsommation (SCR) — Calculé", `${res.scr}%`, ""],
      ["Énergie autoconsommée Année 1", fmt(res.e_self_yr1), "kWh/an"],
      ["Surplus exporté / Comptage net", fmt(res.exported), "kWh/an"],
      ["Tarif pondéré calculé (T₀)", res.t0.toFixed(4), "DA/kWh"],
      ["Dégagement CO₂ évité (Année 1)", `${res.co2_yr1} t`, "tCO₂/an"],
      ["Revenus comptage net potentiels", fmt(res.nm_revenue), "DA/an"],
    ],
    headStyles: {
      fillColor: [245, 158, 11],
      textColor: [13, 17, 23],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [255, 253, 235] },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "center" } },
  });

  // ── PAGE 3: PARAMÈTRES DU SYSTÈME ──
  addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(13, 17, 23);
  doc.text("Paramètres du Système", 14, 20);
  doc.setFillColor(245, 158, 11);
  doc.rect(14, 22, 50, 0.8, "F");

  autoTable(doc, {
    startY: 27,
    head: [["Paramètre", "Valeur", "Remarque"]],
    body: [
      [
        "Puissance installée (P_installed)",
        `${sys.p_installed} kWp`,
        "Capacité totale du système",
      ],
      [
        "Nombre de modules",
        `${sys.n_modules}`,
        `${sys.module_brand} ${sys.module_model} — ${sys.module_power}Wp`,
      ],
      ["Nombre d'onduleurs", `${sys.n_inverters}`, sys.inverter_brand],
      [
        "Inclinaison des modules",
        `${sys.tilt}°`,
        "Angle par rapport à l'horizontale",
      ],
      ["Orientation", sys.orientation, ""],
      [
        "Irradiation annuelle (GHI)",
        `${sys.ghi_annual} kWh/m²/jour`,
        "Source: NASA POWER / Mesure site",
      ],
      ["Performance Ratio (PR)", `${sys.pr}%`, "IEC 61724-1:2021"],
      ["Surface toiture utilisée", `${sys.roof_area} m²`, ""],
      ["CAPEX Total", fmtDa(sys.capex), "Coût d'investissement initial"],
      ["O&M Annuel", fmtDa(res.om_annual), `${fin.om_rate}% du CAPEX`],
    ],
    headStyles: {
      fillColor: [13, 17, 23],
      textColor: [245, 158, 11],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
  });

  const afterSys = (doc as any).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: afterSys,
    head: [["Hypothèse Financière", "Valeur", "Justification"]],
    body: [
      [
        "Taux d'actualisation (r)",
        `${fin.r}%`,
        "Coût du capital — marché algérien",
      ],
      [
        "Taux d'inflation tarifaire (f)",
        `${fin.f}%`,
        "Inflation tarifaire Sonelgaz historique",
      ],
      [
        "Taux de dégradation modules (D)",
        `${fin.D}%/an`,
        "Garantie constructeur Jinko JKM",
      ],
      [
        "Économies demande fixe (DS)",
        fmtDa(fin.DS),
        "⚠️ FIXE — Jamais indexé à l'inflation",
      ],
      [
        "Taux de subvention Sc2",
        `${fin.subsidy_rate}%`,
        "Loi 09-04 / Dispositif APRUE",
      ],
      ["Durée de vie système", "25 ans", "Standard IEC / Garantie onduleur"],
    ],
    headStyles: {
      fillColor: [245, 158, 11],
      textColor: [13, 17, 23],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [255, 253, 235] },
  });

  // ── PAGE 4: ANALYSE DES FACTURES ──
  addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(13, 17, 23);
  doc.text("Analyse des Factures Sonelgaz", 14, 20);
  doc.setFillColor(245, 158, 11);
  doc.rect(14, 22, 60, 0.8, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(
    `Tarif pondéré calculé T₀ = ${res.t0.toFixed(4)} DA/kWh  (= ${fmt(res.total_da)} DA / ${fmt(res.total_kwh)} kWh)`,
    14,
    30,
  );

  autoTable(doc, {
    startY: 34,
    head: [
      [
        "Mois",
        "HHP (kWh)",
        "HP (kWh)",
        "Total (kWh)",
        "Montant (DA)",
        "Tarif eff. (DA/kWh)",
      ],
    ],
    body: MONTHS_FULL_FR.map((m, i) => {
      const cons = res.monthly_cons[i];
      const effTariff =
        cons > 0 && res.total_kwh > 0
          ? (res.total_da / res.total_kwh).toFixed(4)
          : "—";
      return [m, "—", "—", fmt(cons), "—", effTariff];
    }),
    foot: [
      [
        "TOTAL",
        "—",
        "—",
        fmt(res.total_kwh),
        fmt(res.total_da),
        res.t0.toFixed(4),
      ],
    ],
    headStyles: {
      fillColor: [13, 17, 23],
      textColor: [245, 158, 11],
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    footStyles: {
      fillColor: [245, 158, 11],
      textColor: [13, 17, 23],
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
  });

  // ── PAGE 5: PRODUCTION ÉNERGÉTIQUE & SCR ──
  addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(13, 17, 23);
  doc.text("Production PV & Autoconsommation (SCR)", 14, 20);
  doc.setFillColor(245, 158, 11);
  doc.rect(14, 22, 70, 0.8, "F");

  autoTable(doc, {
    startY: 27,
    head: [
      [
        "Mois",
        "E_PV (kWh)",
        "E_Cons (kWh)",
        "SC (kWh)",
        "Surplus (kWh)",
        "SCR (%)",
      ],
    ],
    body: MONTHS_FULL_FR.map((m, i) => [
      m,
      fmt(res.monthly_pv[i]),
      fmt(res.monthly_cons[i]),
      fmt(res.monthly_sc[i]),
      fmt(Math.max(0, res.monthly_pv[i] - res.monthly_cons[i])),
      `${res.monthly_scr[i]}%`,
    ]),
    foot: [
      [
        "ANNUEL",
        fmt(res.e_annual),
        fmt(res.monthly_cons.reduce((a, b) => a + b, 0)),
        fmt(res.e_self_yr1),
        fmt(res.exported),
        `${res.scr}%`,
      ],
    ],
    headStyles: {
      fillColor: [13, 17, 23],
      textColor: [245, 158, 11],
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    footStyles: {
      fillColor: [245, 158, 11],
      textColor: [13, 17, 23],
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [255, 253, 235] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
  });

  // Bar chart: Production vs Consumption
  const chartY = (doc as any).lastAutoTable.finalY + 6;
  if (chartY < PH - 60) {
    const barImg = makeBarChart(
      res.monthly_pv,
      res.monthly_cons,
      MONTHS_FR,
      500,
      160,
      "#f59e0b",
      "#3b82f6",
      "Production PV (jaune) vs Consommation (bleu) — kWh/mois",
    );
    doc.addImage(barImg, "PNG", 14, chartY, PW - 28, 45);

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    doc.text(
      `SCR Annuel Calculé: ${res.scr}% (méthode: Σmin(E_PV,m, E_cons,m) / Σ E_PV,m)`,
      14,
      chartY + 49,
    );
    doc.text(
      `Énergie autoconsommée: ${fmt(res.e_self_yr1)} kWh/an | Surplus exporté: ${fmt(res.exported)} kWh/an`,
      14,
      chartY + 55,
    );
  }

  // ── PAGE 6: RÉSULTATS FINANCIERS ──
  addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(13, 17, 23);
  doc.text("Résultats Financiers — Scénario 1 (Sans Subvention)", 14, 20);
  doc.setFillColor(245, 158, 11);
  doc.rect(14, 22, 90, 0.8, "F");

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);
  doc.text(
    `CAPEX = ${fmtDa(sys.capex)} | r = ${fin.r}% | f = ${fin.f}% | D = ${fin.D}%/an | O&M = ${fin.om_rate}%/an | DS = ${fmtDa(fin.DS)}/an (FIXE)`,
    14,
    28,
  );

  autoTable(doc, {
    startY: 32,
    head: [
      ["Indicateur", "Scénario 1", "Scénario 2 (+subv.)", "Δ Amélioration"],
    ],
    body: [
      [
        "Investissement Net",
        fmtDa(sys.capex),
        fmtDa(res.capex_sc2),
        `−${fmtDa(sys.capex - res.capex_sc2)}`,
      ],
      [
        "Économies Brutes An 1",
        fmtDa(res.yr1_gross_savings),
        fmtDa(res.yr1_gross_savings),
        "—",
      ],
      [
        "  dont économies énergie",
        fmtDa(res.yr1_energy_savings),
        fmtDa(res.yr1_energy_savings),
        "—",
      ],
      [
        "  dont économies demande (DS)",
        fmtDa(fin.DS),
        fmtDa(fin.DS),
        "— (FIXE)",
      ],
      ["Flux Net An 1", fmtDa(res.yr1_net_cf), fmtDa(res.yr1_net_cf), "—"],
      [
        "DRS (Simple Payback)",
        `${res.spp_sc1} ans`,
        `${res.spp_sc2} ans`,
        `−${(res.spp_sc1 - res.spp_sc2).toFixed(1)} ans`,
      ],
      [
        "DRA (Actualisé)",
        `${res.dpp_sc1 ?? ">25"} ans`,
        `${res.dpp_sc2 ?? ">25"} ans`,
        res.dpp_sc1 && res.dpp_sc2 ? `−${res.dpp_sc1 - res.dpp_sc2} ans` : "—",
      ],
      [
        "VAN (25 ans, r=6%)",
        fmtDa(res.npv_sc1),
        fmtDa(res.npv_sc2),
        `+${fmtDa(res.npv_sc2 - res.npv_sc1)}`,
      ],
      [
        "TRI",
        `${res.irr_sc1}%`,
        `${res.irr_sc2}%`,
        `+${(res.irr_sc2 - res.irr_sc1).toFixed(2)}%`,
      ],
      [
        "IP (Indice Profitabilité)",
        res.pi_sc1.toFixed(3),
        res.pi_sc2.toFixed(3),
        `+${(res.pi_sc2 - res.pi_sc1).toFixed(3)}`,
      ],
      ["LCOE", `${res.lcoe} DA/kWh`, `${res.lcoe} DA/kWh`, "—"],
    ],
    headStyles: {
      fillColor: [13, 17, 23],
      textColor: [245, 158, 11],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
    },
  });

  // ── PAGE 7: TABLE DCF 25 ANS ──
  addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(13, 17, 23);
  doc.text("Tableau de Flux de Trésorerie Actualisés — 25 ans", 14, 20);
  doc.setFillColor(245, 158, 11);
  doc.rect(14, 22, 80, 0.8, "F");

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);
  doc.text(
    "DS = Économies demande FIXES (non indexées) | T_n = T₀×(1+f)^(n-1) | DCF = CF/(1+r)^n",
    14,
    28,
  );

  autoTable(doc, {
    startY: 32,
    head: [
      [
        "An",
        "E_self (kWh)",
        "T_n (DA/kWh)",
        "Éc.Énergie (DA)",
        "DS (DA)",
        "Brut (DA)",
        "O&M (DA)",
        "Net CF (DA)",
        "DCF (DA)",
        "ΣVA Sc1 (DA)",
        "ΣVA Sc2 (DA)",
      ],
    ],
    body: res.dcf_table.map((r) => [
      r.year,
      fmt(r.e_self_n),
      r.t_n.toFixed(4),
      fmt(r.energy_savings),
      fmt(r.ds),
      fmt(r.gross_savings),
      fmt(r.om),
      fmt(r.net_cf),
      fmt(r.dcf),
      fmt(r.cum_sc1),
      fmt(r.cum_sc2),
    ]),
    headStyles: {
      fillColor: [13, 17, 23],
      textColor: [245, 158, 11],
      fontStyle: "bold",
      fontSize: 6.5,
    },
    bodyStyles: { fontSize: 7 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { halign: "center", cellWidth: 7 },
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right" },
      9: { halign: "right" },
      10: { halign: "right" },
    },
    didParseCell: (data) => {
      if (data.section === "body") {
        const row = res.dcf_table[data.row.index];
        if (row?.cum_sc1 >= 0 && data.column.index === 9) {
          data.cell.styles.textColor = [34, 197, 94];
          data.cell.styles.fontStyle = "bold";
        }
        if (row?.cum_sc2 >= 0 && data.column.index === 10) {
          data.cell.styles.textColor = [59, 130, 246];
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  // ── PAGE 8: GRAPHIQUE VAN CUMULÉE ──
  addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(13, 17, 23);
  doc.text("Évolution de la VAN Cumulée — 25 ans", 14, 20);
  doc.setFillColor(245, 158, 11);
  doc.rect(14, 22, 65, 0.8, "F");

  const npvCurve1 = res.dcf_table.map((r) => r.cum_sc1);
  const npvCurve2 = res.dcf_table.map((r) => r.cum_sc2);
  const yearLabels = res.dcf_table.map((r) => String(r.year));

  const lineImg = makeLineChart(npvCurve1, npvCurve2, yearLabels, 520, 220);
  doc.addImage(lineImg, "PNG", 14, 27, PW - 28, 65);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);
  doc.text(
    `Sc1 (sans subv.): VAN finale = ${fmtDa(res.npv_sc1)} | TRI = ${res.irr_sc1}% | DRA = ${res.dpp_sc1 ?? ">25"} ans`,
    14,
    96,
  );
  doc.text(
    `Sc2 (avec subv.): VAN finale = ${fmtDa(res.npv_sc2)} | TRI = ${res.irr_sc2}% | DRA = ${res.dpp_sc2 ?? ">25"} ans`,
    14,
    102,
  );

  // Production chart for second half of page
  const scImg = makeBarChart(
    res.monthly_scr,
    null,
    MONTHS_FR,
    500,
    140,
    "#f59e0b",
    "#3b82f6",
    "Taux d'Autoconsommation Mensuel (SCR%) — methode: min(E_PV,m, E_cons,m) / E_PV,m",
  );
  doc.addImage(scImg, "PNG", 14, 108, PW - 28, 42);

  // ── PAGE 9: IMPACT ENVIRONNEMENTAL & RECOMMANDATIONS ──
  addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(13, 17, 23);
  doc.text("Impact Environnemental & Comptage Net", 14, 20);
  doc.setFillColor(34, 197, 94);
  doc.rect(14, 22, 65, 0.8, "F");

  autoTable(doc, {
    startY: 27,
    head: [
      [
        "Indicateur Environnemental",
        "Valeur Année 1",
        "Valeur 25 ans",
        "Équivalent",
      ],
    ],
    body: [
      [
        "CO₂ évité",
        `${res.co2_yr1} tCO₂/an`,
        `${res.co2_25yr} tCO₂`,
        `Facteur: 0.550 kg CO₂/kWh`,
      ],
      [
        "Arbres équivalents (séquestration)",
        `${res.trees_equiv} arbres`,
        `${res.trees_equiv * 25} arbres`,
        "45 arbres/tCO₂/an",
      ],
      [
        "Véhicules retirés équivalent",
        `${res.vehicles_equiv} véhicules`,
        "—",
        "2.3 tCO₂/véhicule/an",
      ],
      [
        "Surplus exporté (comptage net)",
        `${fmt(res.exported)} kWh`,
        "—",
        `Loi 04-09 sur les énergies renouvelables`,
      ],
      [
        "Revenus comptage net potentiels",
        fmtDa(res.nm_revenue),
        "—",
        `${res.exported.toLocaleString()} kWh × 1.8064 DA/kWh`,
      ],
    ],
    headStyles: {
      fillColor: [13, 17, 23],
      textColor: [34, 197, 94],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [240, 253, 244] },
  });

  const afterEnv = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(13, 17, 23);
  doc.text("Recommandations", 14, afterEnv);
  doc.setFillColor(245, 158, 11);
  doc.rect(14, afterEnv + 2, 40, 0.7, "F");

  const recs = [
    `La VAN positive de ${fmtDa(res.npv_sc1)} (Sc1) et ${fmtDa(res.npv_sc2)} (Sc2) confirme la viabilité économique du projet. Investissement recommandé.`,
    `Avec un TRI de ${res.irr_sc1}% (Sc1), le projet dépasse le taux d'actualisation de ${fin.r}% — création de valeur nette assurée.`,
    `Le SCR calculé de ${res.scr}% (vs. 70% assumé généralement) valide la pertinence de la méthodologie mensuelle. Maximiser l'autoconsommation en planifiant les usages énergivores en journée.`,
    `Activer le dispositif de subvention APRUE (Sc2) réduit le DRS de ${(res.spp_sc1 - res.spp_sc2).toFixed(1)} ans et augmente la VAN de ${fmtDa(res.npv_sc2 - res.npv_sc1)}.`,
    `Un système de monitoring (SCADA/IoT) est recommandé pour valider la production réelle et détecter toute dégradation des performances.`,
    `Enregistrement au mécanisme de comptage net (Loi 04-09) permettrait de valoriser les ${fmt(res.exported)} kWh/an surplus pour ${fmtDa(res.nm_revenue)}/an additionnels.`,
  ];

  let recY = afterEnv + 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(40, 40, 40);
  recs.forEach((rec, i) => {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(245, 158, 11);
    doc.text(`${i + 1}.`, 14, recY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    const lines = doc.splitTextToSize(rec, PW - 32);
    doc.text(lines, 20, recY);
    recY += lines.length * 5 + 3;
  });

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `SolarAnalytics.dz | Moteur v1.0 | IEC 61724-1:2021 | Biskra 2025-2026`,
      14,
      PH - 6,
    );
    doc.text(`Page ${p} / ${totalPages}`, PW - 14, PH - 6, { align: "right" });
  }

  doc.save(
    `SolarAnalytics_${sys.building_name.replace(/\s+/g, "_")}_${new Date().getFullYear()}.pdf`,
  );
}

// ─── Default Values ───────────────────────────────────────────────────────────
const DEFAULT_SYS: SystemParams = {
  building_name: "Faculté des Sciences et Technologies",
  building_address: "Université de Biskra, Biskra, Algérie",
  p_installed: 285.13,
  ghi_annual: 5.5,
  pr: 80,
  capex: 24408342,
  n_modules: 770,
  module_brand: "Jinko Solar",
  module_model: "JKM370M-72",
  module_power: 370,
  inverter_brand: "5 onduleurs (config. 55 strings × 14 modules)",
  n_inverters: 5,
  tilt: 30,
  orientation: "Sud",
  roof_area: 2145.99,
};

const DEFAULT_FIN: FinancialParams = {
  r: 6,
  f: 4,
  D: 0.5,
  om_rate: 1,
  DS: 120000,
  subsidy_rate: 20,
};

// ─── Sonelgaz Bill Parser ─────────────────────────────────────────────────────
// Parses raw Tesseract text from a Sonelgaz electricity bill.
// Sonelgaz HTA/BT bills have these fields we care about:
//   • Heures Hors Pointe (HHP) — off-peak kWh  → hp_kwh
//   • Heures de Pointe   (HP)  — peak kWh       → peak_kwh
//   • Net à Payer / Montant Total               → total_da
//   • Billing period (month + year)
//
// Because Tesseract OCR output varies with image quality, we apply
// multiple fallback strategies for each field.
function parseSonelgazBill(text: string, slotIdx: number): BillData {
  // Normalise: collapse whitespace, remove thousands separators (space or dot before 3 digits)
  const t = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/(\d)[ .](\d{3})(?!\d)/g, "$1$2"); // "12 345" → "12345"

  // ── Helper: extract first number that appears after a keyword ──
  const after = (keywords: string[], src = t): number => {
    for (const kw of keywords) {
      // case-insensitive search for keyword then first integer/decimal nearby
      const re = new RegExp(
        kw + "[^\\d]{0,30}(\\d{1,7}(?:[.,]\\d{1,2})?)",
        "i",
      );
      const m = src.match(re);
      if (m) return parseFloat(m[1].replace(",", "."));
    }
    return 0;
  };

  // ── Helper: extract number that appears BEFORE a keyword (for totals) ──
  const before = (keywords: string[], src = t): number => {
    for (const kw of keywords) {
      const re = new RegExp(
        "(\\d{3,9}(?:[.,]\\d{1,2})?)\\s*(?:DA|DZD)?[^\\d]{0,20}" + kw,
        "i",
      );
      const m = src.match(re);
      if (m) return parseFloat(m[1].replace(",", "."));
    }
    return 0;
  };

  // ── HHP — off-peak consumption ──
  // Sonelgaz labels: "Heures Hors Pointe", "H.H.P", "HHP", "Hors Pointe", "Cadran 1", "Cadran 2"
  let hp_kwh = after([
    "Heures\\s+Hors\\s+Pointe",
    "H\\.H\\.P\\.?",
    "HHP",
    "Hors\\s+Pointe",
    "Cadran\\s*1",
    "Cadran\\s*2",
    "C1",
    "C2",
  ]);

  // ── HP — peak consumption ──
  // Sonelgaz labels: "Heures de Pointe", "H\\.P\\.?", "HP", "Cadran 3", "C3"
  let peak_kwh = after([
    "Heures\\s+de\\s+Pointe",
    "H\\.P\\.?(?!\\s*P)",
    "\\bHP\\b",
    "Cadran\\s*3",
    "C3",
  ]);

  // ── Fallback: if both are 0, try to grab the two largest reasonable numbers ──
  // (Sonelgaz bills typically show consumption figures prominently)
  if (hp_kwh === 0 && peak_kwh === 0) {
    const allNums = [...t.matchAll(/\b(\d{3,6})\b/g)]
      .map((m) => parseInt(m[1]))
      .filter((n) => n >= 100 && n <= 99999) // plausible kWh range
      .sort((a, b) => b - a);
    if (allNums.length >= 2) {
      hp_kwh = allNums[0];
      peak_kwh = allNums[1];
    } else if (allNums.length === 1) {
      hp_kwh = allNums[0];
    }
  }

  // ── Total DA ──
  // Sonelgaz labels: "Net à Payer", "Montant Net", "Total TTC", "Total à Payer", "NET A PAYER"
  let total_da = after([
    "Net\\s+[àa]\\s+Payer",
    "Montant\\s+Net",
    "Total\\s+TTC",
    "Total\\s+[àa]\\s+Payer",
    "NET\\s+A\\s+PAYER",
    "Montant\\s+Total",
  ]);
  if (!total_da) {
    total_da = before(["Net\\s+[àa]\\s+Payer", "Montant\\s+Net", "TTC", "DA"]);
  }
  // Last-resort: largest number in the bill that looks like a DA amount (>1000)
  if (!total_da) {
    const big = [...t.matchAll(/\b(\d{4,9})\b/g)]
      .map((m) => parseInt(m[1]))
      .filter((n) => n > 1000)
      .sort((a, b) => b - a);
    if (big.length) total_da = big[0];
  }

  // ── Month & Year ──
  const MONTH_NAMES: Record<string, number> = {
    janvier: 1,
    fevrier: 2,
    février: 2,
    mars: 3,
    avril: 4,
    mai: 5,
    juin: 6,
    juillet: 7,
    août: 8,
    aout: 8,
    septembre: 9,
    octobre: 10,
    novembre: 11,
    décembre: 12,
    decembre: 12,
    jan: 1,
    fev: 2,
    fév: 2,
    mar: 3,
    avr: 4,
    jun: 6,
    jul: 7,
    aou: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
    déc: 12,
  };

  let month = slotIdx + 1; // default: use slot position (Jan=1 … Dec=12)
  let year = new Date().getFullYear();

  // Try "Mois: Janvier 2024" or "Période: 01/2024"
  const monthNameRe = new RegExp(
    "(?:p[ée]riode|mois|du|facturation)[^\\w]{0,15}(" +
      Object.keys(MONTH_NAMES).join("|") +
      ")[^\\d]{0,10}(\\d{4})?",
    "i",
  );
  const mnMatch = t.match(monthNameRe);
  if (mnMatch) {
    month = MONTH_NAMES[mnMatch[1].toLowerCase()] ?? month;
    if (mnMatch[2]) year = parseInt(mnMatch[2]);
  }

  // Try MM/YYYY or MM-YYYY patterns
  if (!mnMatch) {
    const numDateRe = /\b(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/;
    const nd = t.match(numDateRe);
    if (nd) {
      month = parseInt(nd[1]);
      year = parseInt(nd[2]);
    }
  }

  // Try standalone 4-digit year anywhere
  const yearMatch = t.match(/\b(202[0-9])\b/);
  if (yearMatch && year === new Date().getFullYear())
    year = parseInt(yearMatch[1]);

  return {
    hp_kwh: Math.round(hp_kwh),
    peak_kwh: Math.round(peak_kwh),
    total_da: Math.round(total_da),
    month,
    year,
  };
}

const emptySlot = (): BillSlot => ({
  file: null,
  preview: null,
  status: "empty",
  data: null,
  edited: null,
});

// ─── Main Component ───────────────────────────────────────────────────────────
export default function SolarStudyPro() {
  const [step, setStep] = useState(0);
  const [bills, setBills] = useState<BillSlot[]>(
    Array.from({ length: 12 }, emptySlot),
  );
  const [sys, setSys] = useState<SystemParams>(DEFAULT_SYS);
  const [fin, setFin] = useState<FinancialParams>(DEFAULT_FIN);
  const [results, setResults] = useState<StudyResults | null>(null);
  const [computing, setComputing] = useState(false);
  const [genPdf, setGenPdf] = useState(false);
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  const processImage = useCallback(async (file: File, slotIdx: number) => {
    setBills((prev) => {
      const next = [...prev];
      next[slotIdx] = {
        ...next[slotIdx],
        file,
        preview: URL.createObjectURL(file),
        status: "processing",
      };
      return next;
    });

    try {
      // ── Tesseract.js: free, runs entirely in the browser, zero API cost ──
      const {
        data: { text },
      } = await Tesseract.recognize(file, "fra+eng", {
        logger: () => {}, // suppress console noise
      });

      const parsed = parseSonelgazBill(text, slotIdx);

      setBills((prev) => {
        const next = [...prev];
        next[slotIdx] = {
          ...next[slotIdx],
          status: "done",
          data: parsed,
          edited: { ...parsed },
        };
        return next;
      });
    } catch (e) {
      // Even on OCR failure, open the slot in manual-entry mode so the
      // user can type values themselves — nothing is lost.
      const fallback: BillData = {
        hp_kwh: 0,
        peak_kwh: 0,
        total_da: 0,
        month: slotIdx + 1,
        year: new Date().getFullYear(),
      };
      setBills((prev) => {
        const next = [...prev];
        next[slotIdx] = {
          ...next[slotIdx],
          status: "done", // keep "done" so the slot is editable
          data: fallback,
          edited: { ...fallback },
          error: "OCR partiel — vérifiez les valeurs ci-dessous",
        };
        return next;
      });
    }
  }, []);

  const updateBillField = (
    slotIdx: number,
    field: keyof BillData,
    value: number,
  ) => {
    setBills((prev) => {
      const next = [...prev];
      if (next[slotIdx].edited) {
        next[slotIdx] = {
          ...next[slotIdx],
          edited: { ...next[slotIdx].edited!, [field]: value },
        };
      }
      return next;
    });
  };

  const doneBills = bills.filter((b) => b.status === "done").length;
  const canCompute = doneBills >= 6;

  const compute = () => {
    setComputing(true);
    setTimeout(() => {
      const r = runStudy(bills, sys, fin);
      setResults(r);
      setComputing(false);
      setStep(4);
    }, 400);
  };

  const downloadPDF = async () => {
    if (!results) return;
    setGenPdf(true);
    setTimeout(() => {
      generatePDF(results, sys, fin);
      setGenPdf(false);
    }, 100);
  };

  // ── STEP 0: Welcome ──
  if (step === 0)
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-6 font-mono">
        <div className="max-w-xl w-full">
          <div className="mb-8">
            <div className="inline-block bg-amber-500/10 border border-amber-500/30 rounded px-3 py-1 text-amber-400 text-xs mb-4 tracking-widest">
              SOLARANALYTICS.DZ v1.0
            </div>
            <h1 className="text-4xl font-bold text-white mb-3">
              Étude Technico-<span className="text-amber-400">Économique</span>
            </h1>
            <p className="text-slate-400 leading-relaxed">
              Importez 12 factures Sonelgaz. L&apos;OCR local extrait les
              données, calcule le SCR réel, et génère un rapport bancable
              complet — 100% gratuit, tout s&apos;exécute dans votre navigateur.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-8 text-sm">
            {[
              ["⚡", "IEC 61724-1:2021", "Norme de calcul PV"],
              ["📊", "SCR Mensuel Réel", "Jamais de valeur fixe"],
              ["💰", "DCF 25 ans complet", "VAN, TRI, DRA, IP, LCOE"],
              ["🆓", "100% Gratuit", "OCR local — aucun API payant"],
            ].map(([icon, title, sub]) => (
              <div
                key={title}
                className="bg-slate-900 border border-slate-800 rounded-lg p-3"
              >
                <div className="text-xl mb-1">{icon}</div>
                <div className="text-white font-semibold text-xs">{title}</div>
                <div className="text-slate-500 text-xs">{sub}</div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setStep(1)}
            className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-4 rounded-lg transition-colors text-lg"
          >
            Démarrer l&apos;étude →
          </button>

          <p className="text-center text-slate-600 text-xs mt-4">
            Biskra GHI: 5.5 kWh/m²/j · Tarif HTA 42 · CAPEX Marché Algérien
          </p>
        </div>
      </div>
    );

  // ── STEP 1: Bill Upload ──
  if (step === 1)
    return (
      <div className="min-h-screen bg-[#0d1117] p-6 font-mono">
        <StepHeader
          step={1}
          total={4}
          title="Factures Sonelgaz"
          sub="12 factures = 1 an de consommation réelle"
        />

        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-3 md:grid-cols-4 gap-3 mb-6">
            {bills.map((bill, i) => (
              <div key={i} className="relative">
                <input
                  ref={(el) => {
                    fileRefs.current[i] = el;
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) =>
                    e.target.files?.[0] && processImage(e.target.files[0], i)
                  }
                />
                <div
                  onClick={() => fileRefs.current[i]?.click()}
                  className={`relative aspect-[3/4] rounded-lg border-2 cursor-pointer flex flex-col items-center justify-center transition-all overflow-hidden
                  ${bill.status === "empty" ? "border-slate-700 hover:border-amber-500/50 bg-slate-900/50" : ""}
                  ${bill.status === "processing" ? "border-amber-500 bg-amber-500/5 animate-pulse" : ""}
                  ${bill.status === "done" ? "border-emerald-500/50 bg-emerald-500/5" : ""}
                  ${bill.status === "error" ? "border-red-500/50 bg-red-500/5" : ""}
                `}
                >
                  {bill.preview ? (
                    <img
                      src={bill.preview}
                      className="w-full h-full object-cover opacity-60"
                      alt=""
                    />
                  ) : (
                    <div className="text-center p-2">
                      <div className="text-2xl mb-1">📄</div>
                      <div className="text-slate-500 text-xs">
                        {MONTHS_FR[i]}
                      </div>
                      <div className="text-slate-600 text-xs">Clic / Dépôt</div>
                    </div>
                  )}
                  {bill.status === "processing" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {bill.status === "done" && (
                    <div className="absolute top-1 right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center text-white text-xs">
                      ✓
                    </div>
                  )}
                  {bill.status === "error" && (
                    <div className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white text-xs">
                      !
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-xs text-center py-0.5 text-slate-300">
                    {MONTHS_FR[i]}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* OCR quality tip */}
          <div className="bg-slate-900 border border-amber-500/20 rounded-lg px-4 py-3 mb-4 text-xs text-slate-400">
            <span className="text-amber-400 font-semibold">
              💡 Conseil OCR :
            </span>{" "}
            Pour de meilleurs résultats, utilisez des photos nettes et bien
            éclairées. L&apos;OCR tourne localement dans votre navigateur —
            aucune donnée n&apos;est envoyée à un serveur. Vérifiez et corrigez
            les valeurs extraites dans le tableau.
          </div>

          {/* Extracted data review */}
          {doneBills > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
              <h3 className="text-amber-400 font-bold text-sm mb-3">
                Données extraites — Vérification & Correction
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="text-left py-2 px-2">Mois</th>
                      <th className="text-right py-2 px-2">HHP (kWh)</th>
                      <th className="text-right py-2 px-2">HP (kWh)</th>
                      <th className="text-right py-2 px-2">Total (DA)</th>
                      <th className="text-right py-2 px-2">Mois facture</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((b, i) =>
                      b.status === "done" && b.edited ? (
                        <tr
                          key={i}
                          className="border-b border-slate-800/50 hover:bg-slate-800/30"
                        >
                          <td className="py-1.5 px-2 text-slate-400">
                            {MONTHS_FR[i]}
                          </td>
                          {(["hp_kwh", "peak_kwh", "total_da"] as const).map(
                            (field) => (
                              <td key={field} className="py-1 px-2">
                                <input
                                  type="number"
                                  value={b.edited![field] || ""}
                                  onChange={(e) =>
                                    updateBillField(
                                      i,
                                      field,
                                      parseFloat(e.target.value) || 0,
                                    )
                                  }
                                  className="w-full text-right bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-white focus:border-amber-500 outline-none"
                                />
                              </td>
                            ),
                          )}
                          <td className="py-1 px-2">
                            <input
                              type="number"
                              min={1}
                              max={12}
                              value={b.edited!.month || ""}
                              onChange={(e) =>
                                updateBillField(
                                  i,
                                  "month",
                                  parseInt(e.target.value) || 0,
                                )
                              }
                              className="w-16 text-right bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-white focus:border-amber-500 outline-none"
                            />
                          </td>
                        </tr>
                      ) : null,
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 text-xs text-slate-500">
                {doneBills} facture(s) traitée(s) — Les mois manquants
                utiliseront la consommation moyenne calculée
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(0)}
              className="flex-1 border border-slate-700 text-slate-400 py-3 rounded-lg hover:border-slate-500"
            >
              ← Retour
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={doneBills < 1}
              className="flex-2 flex-grow bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-black font-bold py-3 rounded-lg"
            >
              Suivant → ({doneBills}/12 factures)
            </button>
          </div>
        </div>
      </div>
    );

  // ── STEP 2: System Parameters ──
  if (step === 2)
    return (
      <div className="min-h-screen bg-[#0d1117] p-6 font-mono">
        <StepHeader
          step={2}
          total={4}
          title="Paramètres Système"
          sub="Configuration du système PV"
        />
        <div className="max-w-2xl mx-auto space-y-6">
          <Section title="Informations Projet">
            <FormField
              label="Nom du bâtiment"
              value={sys.building_name}
              onChange={(v) => setSys({ ...sys, building_name: v })}
            />
            <FormField
              label="Adresse"
              value={sys.building_address}
              onChange={(v) => setSys({ ...sys, building_address: v })}
            />
          </Section>

          <Section title="Système PV">
            <NumField
              label="Puissance installée (kWp)"
              value={sys.p_installed}
              onChange={(v) => setSys({ ...sys, p_installed: v })}
              step={0.01}
            />
            <NumField
              label="Nombre de modules"
              value={sys.n_modules}
              onChange={(v) => setSys({ ...sys, n_modules: v })}
            />
            <FormField
              label="Marque module"
              value={sys.module_brand}
              onChange={(v) => setSys({ ...sys, module_brand: v })}
            />
            <FormField
              label="Modèle module"
              value={sys.module_model}
              onChange={(v) => setSys({ ...sys, module_model: v })}
            />
            <NumField
              label="Puissance module (Wp)"
              value={sys.module_power}
              onChange={(v) => setSys({ ...sys, module_power: v })}
            />
            <FormField
              label="Onduleurs"
              value={sys.inverter_brand}
              onChange={(v) => setSys({ ...sys, inverter_brand: v })}
            />
            <NumField
              label="Nombre d'onduleurs"
              value={sys.n_inverters}
              onChange={(v) => setSys({ ...sys, n_inverters: v })}
            />
          </Section>

          <Section title="Site & Performance">
            <NumField
              label="Irradiation (GHI) kWh/m²/jour"
              value={sys.ghi_annual}
              onChange={(v) => setSys({ ...sys, ghi_annual: v })}
              step={0.1}
              note="Biskra = 5.5 | NASA POWER recommandé"
            />
            <NumField
              label="Performance Ratio PR (%)"
              value={sys.pr}
              onChange={(v) => setSys({ ...sys, pr: v })}
              step={1}
              note="75–85% typique"
            />
            <NumField
              label="Inclinaison (°)"
              value={sys.tilt}
              onChange={(v) => setSys({ ...sys, tilt: v })}
            />
            <FormField
              label="Orientation"
              value={sys.orientation}
              onChange={(v) => setSys({ ...sys, orientation: v })}
            />
            <NumField
              label="Surface toiture (m²)"
              value={sys.roof_area}
              onChange={(v) => setSys({ ...sys, roof_area: v })}
            />
            <NumField
              label="CAPEX Total (DA)"
              value={sys.capex}
              onChange={(v) => setSys({ ...sys, capex: v })}
              step={1000}
              note="Inclure modules + onduleurs + câbles + installation"
            />
          </Section>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex-1 border border-slate-700 text-slate-400 py-3 rounded-lg hover:border-slate-500"
            >
              ← Retour
            </button>
            <button
              onClick={() => setStep(3)}
              className="flex-grow bg-amber-500 text-black font-bold py-3 rounded-lg"
            >
              Suivant →
            </button>
          </div>
        </div>
      </div>
    );

  // ── STEP 3: Financial Parameters ──
  if (step === 3)
    return (
      <div className="min-h-screen bg-[#0d1117] p-6 font-mono">
        <StepHeader
          step={3}
          total={4}
          title="Paramètres Financiers"
          sub="Hypothèses économiques pour le modèle DCF 25 ans"
        />
        <div className="max-w-2xl mx-auto space-y-6">
          <Section title="Taux & Inflation">
            <NumField
              label="Taux d'actualisation r (%)"
              value={fin.r}
              onChange={(v) => setFin({ ...fin, r: v })}
              step={0.5}
              note="Coût du capital — 6% standard Algérie"
            />
            <NumField
              label="Inflation tarifaire f (%)"
              value={fin.f}
              onChange={(v) => setFin({ ...fin, f: v })}
              step={0.5}
              note="Évolution tarifaire Sonelgaz — 4%/an historique"
            />
            <NumField
              label="Dégradation modules D (%/an)"
              value={fin.D}
              onChange={(v) => setFin({ ...fin, D: v })}
              step={0.1}
              note="Garantie constructeur — 0.5%/an Jinko"
            />
          </Section>

          <Section title="Coûts & Économies">
            <NumField
              label="O&M (% du CAPEX par an)"
              value={fin.om_rate}
              onChange={(v) => setFin({ ...fin, om_rate: v })}
              step={0.1}
              note="Maintenance & assurance — 1% standard"
            />
            <NumField
              label="Économies demande DS (DA/an)"
              value={fin.DS}
              onChange={(v) => setFin({ ...fin, DS: v })}
              step={1000}
              note="⚠️ FIXE — Jamais indexé à l'inflation tarifaire"
            />
          </Section>

          <Section title="Subvention">
            <NumField
              label="Taux subvention Sc2 (%)"
              value={fin.subsidy_rate}
              onChange={(v) => setFin({ ...fin, subsidy_rate: v })}
              step={5}
              note="Dispositif APRUE — 20% standard"
            />
          </Section>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-xs">
            <div className="text-amber-400 font-bold mb-2">
              ⚠️ Avertissement Critique — PRD Section 3.2
            </div>
            <div className="text-slate-400">
              DS = {fin.DS.toLocaleString()} DA/an est une valeur{" "}
              <strong className="text-white">FIXE</strong>. Elle ne sera jamais
              multipliée par (1+f)^(n-1). Erreur fréquente dans les études PV
              algériennes.
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="flex-1 border border-slate-700 text-slate-400 py-3 rounded-lg"
            >
              ← Retour
            </button>
            <button
              onClick={compute}
              disabled={computing || !canCompute}
              className="flex-grow bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-black font-bold py-3 rounded-lg flex items-center justify-center gap-2"
            >
              {computing ? (
                <>
                  <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />{" "}
                  Calcul en cours...
                </>
              ) : (
                "⚡ Calculer l'étude complète"
              )}
            </button>
          </div>
        </div>
      </div>
    );

  // ── STEP 4: Results ──
  if (step === 4 && results)
    return (
      <div className="min-h-screen bg-[#0d1117] p-6 font-mono">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-amber-400 text-xs tracking-widest mb-1">
                RÉSULTATS ÉTUDE
              </div>
              <h1 className="text-2xl font-bold text-white">
                {sys.building_name}
              </h1>
              <p className="text-slate-500 text-sm">
                {sys.p_installed} kWp | {sys.n_modules} modules | GHI{" "}
                {sys.ghi_annual} kWh/m²/j
              </p>
            </div>
            <button
              onClick={downloadPDF}
              disabled={genPdf}
              className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-6 py-3 rounded-lg flex items-center gap-2 transition-colors"
            >
              {genPdf ? (
                <>
                  <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />{" "}
                  Génération...
                </>
              ) : (
                "📄 Télécharger PDF"
              )}
            </button>
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              {
                l: "VAN Sc1",
                v: `${(results.npv_sc1 / 1e6).toFixed(2)} M DA`,
                sub: results.npv_sc1 > 0 ? "✓ Projet viable" : "✗ Non viable",
                color: results.npv_sc1 > 0 ? "emerald" : "red",
              },
              {
                l: "TRI Sc1",
                v: `${results.irr_sc1}%`,
                sub: `vs r=${fin.r}% — ${results.irr_sc1 > fin.r ? "✓ Rentable" : "Risqué"}`,
                color: results.irr_sc1 > fin.r ? "emerald" : "red",
              },
              {
                l: "DRS Sc1",
                v: `${results.spp_sc1} ans`,
                sub: `DRA: ${results.dpp_sc1 ?? ">25"} ans`,
                color: "amber",
              },
              {
                l: "LCOE",
                v: `${results.lcoe} DA/kWh`,
                sub: `Tarif réseau: ${results.t0.toFixed(2)} DA/kWh`,
                color: "blue",
              },
              {
                l: "SCR Calculé",
                v: `${results.scr}%`,
                sub: "vs 70% supposé standard",
                color: "amber",
              },
              {
                l: "E_annual",
                v: `${(results.e_annual / 1000).toFixed(0)} MWh`,
                sub: `FLEH: ${results.fleh} h/an`,
                color: "blue",
              },
              {
                l: "VAN Sc2 (+20%)",
                v: `${(results.npv_sc2 / 1e6).toFixed(2)} M DA`,
                sub: `DRA: ${results.dpp_sc2 ?? ">25"} ans`,
                color: "emerald",
              },
              {
                l: "CO₂ Évité",
                v: `${results.co2_yr1} t/an`,
                sub: `${results.trees_equiv} arbres équivalent`,
                color: "emerald",
              },
            ].map((k) => (
              <div
                key={k.l}
                className={`bg-slate-900 border rounded-xl p-4
              ${k.color === "emerald" ? "border-emerald-500/30" : k.color === "amber" ? "border-amber-500/30" : k.color === "red" ? "border-red-500/30" : "border-blue-500/30"}`}
              >
                <div className="text-slate-500 text-xs mb-1">{k.l}</div>
                <div
                  className={`text-xl font-bold ${k.color === "emerald" ? "text-emerald-400" : k.color === "amber" ? "text-amber-400" : k.color === "red" ? "text-red-400" : "text-blue-400"}`}
                >
                  {k.v}
                </div>
                <div className="text-slate-600 text-xs mt-1">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Monthly breakdown */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-4">
            <h3 className="text-amber-400 font-bold text-sm mb-4">
              Production vs Consommation Mensuelle (kWh)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-2 text-left">Mois</th>
                    {MONTHS_FR.map((m) => (
                      <th key={m} className="py-2 px-1 text-right">
                        {m}
                      </th>
                    ))}
                    <th className="py-2 px-2 text-right font-bold">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: "E_PV",
                      values: results.monthly_pv,
                      color: "text-amber-400",
                    },
                    {
                      label: "E_Cons",
                      values: results.monthly_cons,
                      color: "text-blue-400",
                    },
                    {
                      label: "SC",
                      values: results.monthly_sc,
                      color: "text-emerald-400",
                    },
                    {
                      label: "SCR%",
                      values: results.monthly_scr.map((v) => v),
                      color: "text-purple-400",
                      unit: "%",
                    },
                  ].map((row) => (
                    <tr
                      key={row.label}
                      className="border-b border-slate-800/50"
                    >
                      <td className={`py-1.5 px-2 font-semibold ${row.color}`}>
                        {row.label}
                      </td>
                      {row.values.map((v, i) => (
                        <td
                          key={i}
                          className={`py-1.5 px-1 text-right text-slate-300 text-xs`}
                        >
                          {v.toLocaleString()}
                          {row.unit || ""}
                        </td>
                      ))}
                      <td
                        className={`py-1.5 px-2 text-right font-bold ${row.color}`}
                      >
                        {row.unit
                          ? `${Math.round(row.values.reduce((a, b) => a + b, 0) / 12)}%`
                          : row.values
                              .reduce((a, b) => a + b, 0)
                              .toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Scenario comparison */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              {
                title: "Scénario 1 — Sans Subvention",
                capex: sys.capex,
                color: "amber",
              },
              {
                title: `Scénario 2 — Subvention ${fin.subsidy_rate}%`,
                capex: results.capex_sc2,
                color: "blue",
              },
            ].map((sc, si) => (
              <div
                key={si}
                className={`bg-slate-900 border ${sc.color === "amber" ? "border-amber-500/30" : "border-blue-500/30"} rounded-xl p-4`}
              >
                <h3
                  className={`font-bold text-sm mb-3 ${sc.color === "amber" ? "text-amber-400" : "text-blue-400"}`}
                >
                  {sc.title}
                </h3>
                {[
                  ["CAPEX", `${sc.capex.toLocaleString()} DA`],
                  [
                    "VAN",
                    `${si === 0 ? results.npv_sc1 : results.npv_sc2} DA`.replace(
                      /(\d)(?=(\d{3})+(?!\d))/g,
                      "$1,",
                    ),
                  ],
                  ["TRI", `${si === 0 ? results.irr_sc1 : results.irr_sc2}%`],
                  [
                    "DRS",
                    `${si === 0 ? results.spp_sc1 : results.spp_sc2} ans`,
                  ],
                  [
                    "DRA",
                    `${si === 0 ? (results.dpp_sc1 ?? ">25") : (results.dpp_sc2 ?? ">25")} ans`,
                  ],
                  ["IP", `${si === 0 ? results.pi_sc1 : results.pi_sc2}`],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex justify-between text-xs py-1 border-b border-slate-800/50"
                  >
                    <span className="text-slate-500">{k}</span>
                    <span className="text-white font-semibold">{v}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Environmental */}
          <div className="bg-slate-900 border border-emerald-500/20 rounded-xl p-4 mb-4">
            <h3 className="text-emerald-400 font-bold text-sm mb-3">
              Impact Environnemental
            </h3>
            <div className="grid grid-cols-4 gap-3 text-center">
              {[
                ["🌿", `${results.co2_yr1}`, "tCO₂/an évitées"],
                ["🌳", `${results.trees_equiv}`, "arbres équivalent"],
                ["🚗", `${results.vehicles_equiv}`, "véhicules retirés"],
                [
                  "☀️",
                  `${results.nm_revenue.toLocaleString()}`,
                  "DA/an comptage net",
                ],
              ].map(([icon, val, label]) => (
                <div key={label} className="bg-emerald-500/5 rounded-lg p-3">
                  <div className="text-2xl mb-1">{icon}</div>
                  <div className="text-emerald-400 font-bold text-sm">
                    {val}
                  </div>
                  <div className="text-slate-500 text-xs">{label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(3)}
              className="border border-slate-700 text-slate-400 px-6 py-3 rounded-lg hover:border-slate-500"
            >
              ← Modifier
            </button>
            <button
              onClick={downloadPDF}
              disabled={genPdf}
              className="flex-grow bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 rounded-lg"
            >
              {genPdf
                ? "Génération du PDF..."
                : "📄 Télécharger Rapport PDF Complet"}
            </button>
          </div>
        </div>
      </div>
    );

  return null;
}

// ─── Shared UI Components ─────────────────────────────────────────────────────
function StepHeader({
  step,
  total,
  title,
  sub,
}: {
  step: number;
  total: number;
  title: string;
  sub: string;
}) {
  return (
    <div className="max-w-4xl mx-auto mb-6">
      <div className="flex items-center gap-2 mb-2">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded ${i < step ? "bg-amber-500" : "bg-slate-700"}`}
          />
        ))}
      </div>
      <div className="text-amber-400 text-xs tracking-widest">
        ÉTAPE {step}/{total}
      </div>
      <h2 className="text-2xl font-bold text-white">{title}</h2>
      <p className="text-slate-500 text-sm">{sub}</p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <h3 className="text-amber-400 font-bold text-sm mb-4 uppercase tracking-wider">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-slate-500 text-xs mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-amber-500 outline-none"
      />
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
  note,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  note?: string;
}) {
  return (
    <div>
      <label className="block text-slate-500 text-xs mb-1">{label}</label>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-amber-500 outline-none"
      />
      {note && <p className="text-slate-600 text-xs mt-0.5">{note}</p>}
    </div>
  );
}
