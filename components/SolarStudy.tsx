"use client";

import { useState, useCallback, useRef } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import Tesseract from "tesseract.js";

// ─── Color tokens ─────────────────────────────────────────────────────────────
const C = {
  navy: "#101828", // main background
  light: "#f9f8f8", // text / light surfaces
  cream: "#f9f4cf", // accent / CTA
  navy2: "#1a2740", // card surface (slightly lighter than navy)
  border: "rgba(249,244,207,0.18)", // cream at low opacity
};

// ─── Calculation constants ────────────────────────────────────────────────────
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

// Biskra thesis (Univ. Biskra 2025-2026) — monthly PV distribution for 285.13 kWp, PR=80%, GHI=5.5
const BISKRA_MONTHLY_PROD = [
  28534, 30958, 40218, 41536, 47221, 46487, 47587, 45896, 39322, 36188, 27793,
  26180,
];
const BISKRA_E_ANNUAL = 457919; // kWh/yr reference

// Financial / environmental
const CO2_FACTOR = 0.55; // kg CO₂/kWh — Algerian grid
const NM_TARIFF = 1.8064; // DA/kWh — net metering rate (H.Hors Pointe)
const TREES_PER_TCO2 = 45;
const VEHICLES_TCO2_YR = 2.3;

// ─── TypeScript interfaces ────────────────────────────────────────────────────
interface BillData {
  hp_kwh: number; // Heures Hors Pointe (Cadran 1 + 2) — off-peak kWh
  peak_kwh: number; // Heures de Pointe   (Cadran 3)     — peak kWh
  total_da: number; // Net à Payer / TOTAL FACTURE in DA
  month: number; // 1–12
  year: number;
}

interface BillSlot {
  file: File | null;
  preview: string | null;
  status: "empty" | "processing" | "done";
  data: BillData | null;
  edited: BillData | null;
  ocrWarn: string; // non-blocking OCR warning shown to user
}

interface SystemParams {
  building_name: string;
  building_address: string;
  p_installed: number; // kWp
  ghi_annual: number; // kWh/m²/day
  pr: number; // Performance Ratio %
  capex: number; // DA
  n_modules: number;
  module_brand: string;
  module_model: string;
  module_power: number; // Wp
  inverter_brand: string;
  n_inverters: number;
  tilt: number; // degrees
  orientation: string;
  roof_area: number; // m²
}

interface FinancialParams {
  r: number; // discount rate %
  f: number; // tariff inflation rate %
  D: number; // module degradation %/yr
  om_rate: number; // O&M as % of CAPEX
  DS: number; // demand savings DA/yr — FIXED, never inflated
  subsidy_rate: number; // % for Scenario 2
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

// ─── IRR bisection solver ──────────────────────────────────────────────────────
function calcIRR(cashflows: number[], investment: number): number {
  const npv = (r: number) =>
    cashflows.reduce(
      (acc, cf, i) => acc + cf / Math.pow(1 + r, i + 1),
      -investment,
    );
  if (npv(0.001) <= 0) return 0;
  let lo = 0.001,
    hi = 3.0;
  if (npv(hi) > 0) return hi;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    npv(mid) > 0 ? (lo = mid) : (hi = mid);
  }
  return (lo + hi) / 2;
}

// ─── Main calculation engine (IEC 61724-1:2021 + PRD Biskra methodology) ──────
function runStudy(
  bills: BillSlot[],
  sys: SystemParams,
  fin: FinancialParams,
): StudyResults {
  // 1 — Build monthly consumption from bills
  const monthly_cons = new Array(12).fill(0);
  let total_da = 0;
  let total_kwh = 0;

  bills
    .filter(
      (b) =>
        b.status === "done" && b.edited !== null && (b.edited.month ?? 0) >= 1,
    )
    .forEach((b) => {
      const d = b.edited!;
      const idx = d.month - 1;
      if (idx < 0 || idx > 11) return;
      const cons = (d.hp_kwh || 0) + (d.peak_kwh || 0);
      monthly_cons[idx] = Math.max(monthly_cons[idx], cons); // keep largest if duplicates
      total_da += d.total_da || 0;
      total_kwh += cons;
    });

  // Fill empty months with average of provided months
  const filled = monthly_cons.filter((v) => v > 0);
  const avgCons =
    filled.length > 0
      ? filled.reduce((a, b) => a + b, 0) / filled.length
      : 10000;
  const monthly_cons_f = monthly_cons.map((v) => (v > 0 ? v : avgCons));

  // 2 — Annual energy yield E_annual (IEC 61724-1:2021 Eq. 3.1)
  const e_annual = sys.p_installed * sys.ghi_annual * (sys.pr / 100) * 365;
  const fleh = e_annual / sys.p_installed;

  // 3 — Monthly PV production — scale from Biskra distribution
  const scale = e_annual / BISKRA_E_ANNUAL;
  const monthly_pv = BISKRA_MONTHLY_PROD.map((v) => Math.round(v * scale));

  // 4 — SCR: min(E_PV,m, E_cons,m) per month — NEVER use fixed value
  const monthly_sc = monthly_pv.map((pv, i) =>
    Math.round(Math.min(pv, monthly_cons_f[i])),
  );
  const e_self_yr1 = monthly_sc.reduce((a, b) => a + b, 0);
  const scr = (e_self_yr1 / e_annual) * 100;
  const exported = Math.round(e_annual - e_self_yr1);
  const monthly_scr = monthly_pv.map((pv, i) =>
    pv > 0 ? Math.round((monthly_sc[i] / pv) * 100) : 0,
  );

  // 5 — Weighted tariff T₀ = Σ(DA) / Σ(kWh) — MANDATORY method
  const t0 = total_kwh > 0 ? total_da / total_kwh : 4.8018;

  // 6 — Year-1 financials
  const om_annual = sys.capex * (fin.om_rate / 100);
  const yr1_energy_savings = e_self_yr1 * t0;
  const yr1_gross_savings = yr1_energy_savings + fin.DS; // DS is FIXED
  const yr1_net_cf = yr1_gross_savings - om_annual;
  const capex_sc2 = sys.capex * (1 - fin.subsidy_rate / 100);
  const spp_sc1 = sys.capex / yr1_gross_savings;
  const spp_sc2 = capex_sc2 / yr1_gross_savings;

  // 7 — 25-year DCF (DS NEVER inflated — PRD critical requirement)
  const D_dec = fin.D / 100;
  const r_dec = fin.r / 100;
  const f_dec = fin.f / 100;
  let cum_sc1 = -sys.capex;
  const dcf_table: DCFRow[] = [];
  const cashflows: number[] = [];
  let dpp_sc1: number | null = null;

  for (let n = 1; n <= 25; n++) {
    const e_self_n = e_self_yr1 * Math.pow(1 - D_dec, n - 1);
    const t_n = t0 * Math.pow(1 + f_dec, n - 1);
    const energy_savings = e_self_n * t_n;
    const gross_savings = energy_savings + fin.DS; // DS FIXED
    const net_cf = gross_savings - om_annual;
    const dcf = net_cf / Math.pow(1 + r_dec, n);
    cashflows.push(net_cf);
    cum_sc1 += dcf;
    if (cum_sc1 >= 0 && dpp_sc1 === null) dpp_sc1 = n;
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
      cum_sc2: 0,
    });
  }

  // SC2: same CFs, lower initial CAPEX
  const subsidy_offset = sys.capex * (fin.subsidy_rate / 100);
  let dpp_sc2: number | null = null;
  dcf_table.forEach((row) => {
    row.cum_sc2 = row.cum_sc1 + subsidy_offset;
    if (row.cum_sc2 >= 0 && dpp_sc2 === null) dpp_sc2 = row.year;
  });

  const npv_sc1 = cum_sc1;
  const npv_sc2 = npv_sc1 + subsidy_offset;

  // 8 — IRR
  const irr_sc1 = calcIRR(cashflows, sys.capex);
  const irr_sc2 = calcIRR(cashflows, capex_sc2);

  // 9 — LCOE
  let pv_om = 0,
    pv_energy = 0;
  for (let n = 1; n <= 25; n++) {
    pv_om += om_annual / Math.pow(1 + r_dec, n);
    pv_energy +=
      (e_annual * Math.pow(1 - D_dec, n - 1)) / Math.pow(1 + r_dec, n);
  }
  const lcoe = (sys.capex + pv_om) / pv_energy;

  // 10 — Profitability Index
  const pi_sc1 = 1 + npv_sc1 / sys.capex;
  const pi_sc2 = 1 + npv_sc2 / capex_sc2;

  // 11 — Environmental
  const co2_yr1 = (e_annual * CO2_FACTOR) / 1000;
  let co2_25yr = 0;
  for (let n = 0; n < 25; n++)
    co2_25yr += (e_annual * Math.pow(1 - D_dec, n) * CO2_FACTOR) / 1000;
  const nm_revenue = exported * NM_TARIFF;
  const trees_equiv = Math.round(co2_yr1 * TREES_PER_TCO2);
  const vehicles_equiv = Math.round(co2_yr1 / VEHICLES_TCO2_YR);

  return {
    e_annual: Math.round(e_annual),
    fleh: Math.round(fleh),
    monthly_pv,
    monthly_cons: monthly_cons_f.map(Math.round),
    monthly_sc,
    monthly_scr,
    scr: parseFloat(scr.toFixed(2)),
    e_self_yr1: Math.round(e_self_yr1),
    exported,
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

// ─── Canvas chart helpers (no emoji — jsPDF Helvetica doesn't support them) ───
function makeBarChart(
  vals1: number[],
  vals2: number[] | null,
  labels: string[],
  w: number,
  h: number,
  color1 = C.cream,
  color2 = C.navy,
  title = "",
): string {
  const cvs = document.createElement("canvas");
  cvs.width = w;
  cvs.height = h;
  const ctx = cvs.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const pad = { t: title ? 28 : 14, r: 16, b: 36, l: 58 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const all = [...vals1, ...(vals2 || [])];
  const maxV = (Math.max(...all) || 1) * 1.15;
  const gw = cw / vals1.length;
  const bw = gw * (vals2 ? 0.38 : 0.62);

  if (title) {
    ctx.fillStyle = "#374151";
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "center";
    ctx.fillText(title, w / 2, 16);
  }
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
      const bh2 = (vals2[i] / maxV) * ch;
      ctx.fillStyle = color2;
      ctx.fillRect(x + gw * 0.52, pad.t + ch - bh2, bw, bh2);
    }
    ctx.fillStyle = "#374151";
    ctx.font = "9px Arial";
    ctx.textAlign = "center";
    ctx.fillText(labels[i], x + gw / 2, h - pad.b + 14);
  });
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
): string {
  const cvs = document.createElement("canvas");
  cvs.width = w;
  cvs.height = h;
  const ctx = cvs.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const pad = { t: 32, r: 20, b: 40, l: 74 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const all = [...data1, ...data2];
  const minV = Math.min(...all) * (Math.min(...all) < 0 ? 1.1 : 0.9);
  const maxV = Math.max(...all) * 1.1;
  const range = maxV - minV || 1;
  const getX = (i: number) => pad.l + (i / (data1.length - 1)) * cw;
  const getY = (v: number) => pad.t + ch - ((v - minV) / range) * ch;

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
    ctx.fillText("Seuil de rentabilite", pad.l + 2, zy - 3);
  }
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
    const lbl =
      Math.abs(v) >= 1e6
        ? (v / 1e6).toFixed(1) + "M"
        : Math.round(v / 1000) + "k";
    ctx.fillText(lbl, pad.l - 4, y + 3);
  }
  const drawLine = (data: number[], color: string, dash = false) => {
    if (dash) ctx.setLineDash([6, 3]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    data.forEach((v, i) => {
      i === 0 ? ctx.moveTo(getX(i), getY(v)) : ctx.lineTo(getX(i), getY(v));
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };
  drawLine(data1, C.cream);
  drawLine(data2, "#60a5fa", true);
  ctx.fillStyle = "#374151";
  ctx.font = "9px Arial";
  ctx.textAlign = "center";
  labels.forEach((l, i) => {
    if (i % 5 === 0 || i === labels.length - 1)
      ctx.fillText(l, getX(i), h - pad.b + 14);
  });
  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + ch);
  ctx.lineTo(pad.l + cw, pad.t + ch);
  ctx.stroke();
  // Legend
  ctx.fillStyle = C.cream;
  ctx.fillRect(pad.l, 8, 18, 7);
  ctx.fillStyle = "#374151";
  ctx.font = "9px Arial";
  ctx.textAlign = "left";
  ctx.fillText("Sc1 (sans subvention)", pad.l + 22, 15);
  ctx.fillStyle = "#60a5fa";
  ctx.fillRect(pad.l + 140, 8, 18, 7);
  ctx.fillText("Sc2 (avec subvention)", pad.l + 162, 15);
  return cvs.toDataURL("image/png");
}

// ─── PDF report generator ─────────────────────────────────────────────────────
function generatePDF(
  res: StudyResults,
  sys: SystemParams,
  fin: FinancialParams,
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  // Navy RGB
  const NAVY = [16, 24, 40] as [number, number, number];
  const CREAM = [249, 244, 207] as [number, number, number];
  const WHITE = [249, 248, 248] as [number, number, number];
  const GRAY = [100, 110, 130] as [number, number, number];

  const fmt = (n: number) => Math.round(n).toLocaleString("fr-DZ");
  const fmtDA = (n: number) => fmt(n) + " DA";

  let pNum = 1;
  const addPage = () => {
    doc.addPage();
    pNum++;
    doc.setFillColor(...CREAM);
    doc.rect(0, 0, PW, 1.5, "F");
    doc.setFillColor(...NAVY);
    doc.rect(0, 1.5, PW, 7, "F");
    doc.setFontSize(7);
    doc.setTextColor(...CREAM);
    doc.text(
      `SolarAnalytics.dz  |  ${sys.building_name}  |  Page ${pNum}`,
      PW / 2,
      6.5,
      { align: "center" },
    );
    doc.setDrawColor(220, 220, 220);
    doc.line(10, 9, PW - 10, 9);
  };

  // ── PAGE 1: COVER ─────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PW, PH, "F");
  doc.setFillColor(...CREAM);
  doc.rect(0, 0, 6, PH, "F"); // left accent bar
  doc.setFillColor(26, 39, 64);
  doc.rect(6, PH - 60, PW - 6, 60, "F"); // footer band

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(...CREAM);
  doc.text("SolarAnalytics.dz", 20, 38);

  doc.setFontSize(13);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...WHITE);
  doc.text("Etude de Faisabilite Technico-Economique", 20, 50);
  doc.setFontSize(10);
  doc.setTextColor(...GRAY);
  doc.text(
    "Systeme Photovoltaique Connecte au Reseau — IEC 61724-1:2021",
    20,
    58,
  );

  doc.setDrawColor(...CREAM);
  doc.setLineWidth(0.4);
  doc.line(20, 64, PW - 20, 64);

  // Project info block
  const infoRows = [
    ["Projet", sys.building_name],
    ["Adresse", sys.building_address],
    [
      "Puissance",
      `${sys.p_installed} kWp — ${sys.n_modules} modules ${sys.module_brand} ${sys.module_model}`,
    ],
    [
      "Date",
      new Date().toLocaleDateString("fr-FR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    ],
  ];
  doc.setFontSize(9);
  infoRows.forEach((row, i) => {
    const y = 74 + i * 9;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...CREAM);
    doc.text(row[0] + ":", 20, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...WHITE);
    doc.text(row[1], 50, y);
  });

  // KPI cards
  const kpis = [
    {
      l: "VAN Sc1",
      v: `${(res.npv_sc1 / 1e6).toFixed(2)} M DA`,
      ok: res.npv_sc1 > 0,
    },
    { l: "TRI Sc1", v: `${res.irr_sc1}%`, ok: true },
    { l: "DRA Sc1", v: `${res.dpp_sc1 ?? ">25"} ans`, ok: true },
    { l: "LCOE", v: `${res.lcoe} DA/kWh`, ok: true },
  ];
  kpis.forEach((k, i) => {
    const x = 20 + i * 45;
    doc.setFillColor(26, 39, 64);
    doc.roundedRect(x, 116, 41, 22, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    if (k.ok) {
      doc.setTextColor(...CREAM);
    } else {
      doc.setTextColor(239, 68, 68);
    }
    doc.text(k.v, x + 20.5, 125, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(k.l, x + 20.5, 132, { align: "center" });
  });

  // Methodology note
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  doc.text(
    "SCR calcule mensuellement — min(E_PV,m, E_cons,m) — jamais de valeur fixe supposee",
    20,
    148,
  );
  doc.text(
    "Tarif pondere T0 = Somme(DA) / Somme(kWh) sur 12 factures — DS fixe non indexe",
    20,
    154,
  );

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(80, 90, 110);
  doc.text("(c) SolarAnalytics.dz — Confidentiel", PW / 2, PH - 10, {
    align: "center",
  });

  // ── PAGE 2: RESUME EXECUTIF ────────────────────────────────────────────────
  addPage();

  const hLine = (y: number, label: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...NAVY);
    doc.text(label, 14, y);
    doc.setFillColor(...CREAM);
    doc.rect(14, y + 1.5, 35, 0.8, "F");
  };

  hLine(20, "Resume Executif");

  autoTable(doc, {
    startY: 26,
    head: [
      [
        "Indicateur",
        "Scenario 1 — Sans subvention",
        "Scenario 2 — Avec subvention",
        "Unite",
      ],
    ],
    body: [
      ["Valeur Actuelle Nette (VAN)", fmt(res.npv_sc1), fmt(res.npv_sc2), "DA"],
      [
        "Taux de Rentabilite Interne (TRI)",
        `${res.irr_sc1}%`,
        `${res.irr_sc2}%`,
        "",
      ],
      [
        "Delai de Recuperation Simple (DRS)",
        `${res.spp_sc1} ans`,
        `${res.spp_sc2} ans`,
        "ans",
      ],
      [
        "Delai de Recuperation Actualise (DRA)",
        `${res.dpp_sc1 ?? ">25"} ans`,
        `${res.dpp_sc2 ?? ">25"} ans`,
        "ans",
      ],
      [
        "Indice de Profitabilite (IP)",
        res.pi_sc1.toFixed(3),
        res.pi_sc2.toFixed(3),
        "",
      ],
      [
        "Cout Actualise de l'Energie (LCOE)",
        res.lcoe.toFixed(2),
        res.lcoe.toFixed(2),
        "DA/kWh",
      ],
      [
        "Investissement Initial (CAPEX)",
        fmt(sys.capex),
        fmt(res.capex_sc2),
        "DA",
      ],
      [
        "Economies An 1 (Brutes)",
        fmt(res.yr1_gross_savings),
        fmt(res.yr1_gross_savings),
        "DA/an",
      ],
    ],
    headStyles: {
      fillColor: NAVY,
      textColor: CREAM,
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "center" },
    },
  });

  const y2 = (doc as any).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: y2,
    head: [["Indicateur Technique", "Valeur", "Unite"]],
    body: [
      ["Production annuelle E_annual", fmt(res.e_annual), "kWh/an"],
      ["Heures pleine charge (FLEH)", fmt(res.fleh), "h/an"],
      ["Taux d'autoconsommation (SCR) calcule", `${res.scr}%`, ""],
      ["Energie autoconsommee An 1", fmt(res.e_self_yr1), "kWh/an"],
      ["Surplus exporte (comptage net)", fmt(res.exported), "kWh/an"],
      ["Tarif pondere calcule T0", res.t0.toFixed(4), "DA/kWh"],
      ["CO2 evite An 1", `${res.co2_yr1} t`, "tCO2/an"],
      ["Revenus comptage net potentiels", fmtDA(res.nm_revenue), "DA/an"],
    ],
    headStyles: {
      fillColor: CREAM,
      textColor: NAVY,
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "center" } },
  });

  // ── PAGE 3: PARAMETRES ─────────────────────────────────────────────────────
  addPage();
  hLine(20, "Parametres du Systeme");
  autoTable(doc, {
    startY: 26,
    head: [["Parametre", "Valeur", "Remarque"]],
    body: [
      ["Puissance installee", `${sys.p_installed} kWp`, "P_installed"],
      [
        "Nombre de modules",
        `${sys.n_modules}`,
        `${sys.module_brand} ${sys.module_model} ${sys.module_power}Wp`,
      ],
      ["Onduleurs", `${sys.n_inverters}`, sys.inverter_brand],
      ["Inclinaison", `${sys.tilt} deg`, ""],
      ["Orientation", sys.orientation, ""],
      [
        "GHI annuel",
        `${sys.ghi_annual} kWh/m2/jour`,
        "NASA POWER / mesure site",
      ],
      ["Performance Ratio PR", `${sys.pr}%`, "IEC 61724-1:2021"],
      [
        "Surface toiture nette",
        `${sys.roof_area} m2`,
        "Apres facteur d'espacement",
      ],
      ["CAPEX total", fmtDA(sys.capex), "Investissement initial"],
      ["O&M annuel", fmtDA(res.om_annual), `${fin.om_rate}% du CAPEX`],
    ],
    headStyles: {
      fillColor: NAVY,
      textColor: CREAM,
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
  });

  const y3 = (doc as any).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: y3,
    head: [["Hypothese Financiere", "Valeur", "Justification"]],
    body: [
      [
        "Taux d'actualisation (r)",
        `${fin.r}%`,
        "Cout du capital — marche algerien",
      ],
      [
        "Inflation tarifaire (f)",
        `${fin.f}%`,
        "Evolution tarif Sonelgaz historique",
      ],
      ["Degradation modules (D)", `${fin.D}%/an`, "Garantie constructeur"],
      [
        "Economies demande (DS)",
        fmtDA(fin.DS),
        "FIXE — Jamais indexe a l'inflation",
      ],
      [
        "Subvention Scenario 2",
        `${fin.subsidy_rate}%`,
        "Dispositif APRUE / Loi 09-04",
      ],
      ["Duree de vie systeme", "25 ans", "Standard IEC / Garantie onduleur"],
    ],
    headStyles: {
      fillColor: CREAM,
      textColor: NAVY,
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
  });

  // ── PAGE 4: ANALYSE FACTURES ───────────────────────────────────────────────
  addPage();
  hLine(20, "Analyse des Factures Sonelgaz");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  doc.text(
    `Tarif pondere T0 = ${res.t0.toFixed(4)} DA/kWh  (Total: ${fmt(res.total_da)} DA / ${fmt(res.total_kwh)} kWh)`,
    14,
    30,
  );
  autoTable(doc, {
    startY: 35,
    head: [
      [
        "Mois",
        "HHP (kWh)",
        "HP (kWh)",
        "Total Cons. (kWh)",
        "Tarif eff. (DA/kWh)",
      ],
    ],
    body: MONTHS_FULL_FR.map((m, i) => {
      const cons = res.monthly_cons[i];
      const eff =
        cons > 0 && res.total_kwh > 0
          ? (res.total_da / res.total_kwh).toFixed(4)
          : "—";
      return [m, "—", "—", fmt(cons), eff];
    }),
    foot: [["TOTAL", "—", "—", fmt(res.total_kwh), res.t0.toFixed(4)]],
    headStyles: {
      fillColor: NAVY,
      textColor: CREAM,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    footStyles: {
      fillColor: CREAM,
      textColor: NAVY,
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
    },
  });

  // ── PAGE 5: PRODUCTION & SCR ───────────────────────────────────────────────
  addPage();
  hLine(20, "Production PV & Autoconsommation (SCR)");
  autoTable(doc, {
    startY: 26,
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
      fillColor: NAVY,
      textColor: CREAM,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    footStyles: {
      fillColor: CREAM,
      textColor: NAVY,
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
  });

  const chartY5 = (doc as any).lastAutoTable.finalY + 4;
  if (chartY5 < PH - 58) {
    const img = makeBarChart(
      res.monthly_pv,
      res.monthly_cons,
      MONTHS_FR,
      520,
      160,
      C.cream,
      C.navy,
      "Production PV (clair) vs Consommation (fonce) — kWh/mois",
    );
    doc.addImage(img, "PNG", 14, chartY5, PW - 28, 46);
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(
      `SCR annuel calcule: ${res.scr}%  |  Auto-consomme: ${fmt(res.e_self_yr1)} kWh  |  Exporte: ${fmt(res.exported)} kWh`,
      14,
      chartY5 + 50,
    );
  }

  // ── PAGE 6: RESULTATS FINANCIERS ──────────────────────────────────────────
  addPage();
  hLine(20, "Resultats Financiers — Comparaison Sc1 vs Sc2");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(
    `CAPEX=${fmtDA(sys.capex)} | r=${fin.r}% | f=${fin.f}% | D=${fin.D}%/an | O&M=${fin.om_rate}% | DS=${fmtDA(fin.DS)}/an (FIXE)`,
    14,
    28,
  );

  autoTable(doc, {
    startY: 33,
    head: [["Indicateur", "Scenario 1", "Scenario 2 (+subv.)", "Delta"]],
    body: [
      [
        "Investissement Net",
        fmtDA(sys.capex),
        fmtDA(res.capex_sc2),
        `-${fmtDA(sys.capex - res.capex_sc2)}`,
      ],
      [
        "Economies Brutes An 1",
        fmtDA(res.yr1_gross_savings),
        fmtDA(res.yr1_gross_savings),
        "—",
      ],
      [
        "  dont eco. energie",
        fmtDA(res.yr1_energy_savings),
        fmtDA(res.yr1_energy_savings),
        "—",
      ],
      ["  dont eco. demande (DS FIXE)", fmtDA(fin.DS), fmtDA(fin.DS), "—"],
      ["Flux Net An 1", fmtDA(res.yr1_net_cf), fmtDA(res.yr1_net_cf), "—"],
      [
        "DRS (Simple Payback)",
        `${res.spp_sc1} ans`,
        `${res.spp_sc2} ans`,
        `-${(res.spp_sc1 - res.spp_sc2).toFixed(1)} ans`,
      ],
      [
        "DRA (Actualise)",
        `${res.dpp_sc1 ?? ">25"} ans`,
        `${res.dpp_sc2 ?? ">25"} ans`,
        res.dpp_sc1 !== null && res.dpp_sc2 !== null
          ? `-${res.dpp_sc1 - res.dpp_sc2} ans`
          : "—",
      ],
      [
        "VAN (25 ans, r=6%)",
        fmtDA(res.npv_sc1),
        fmtDA(res.npv_sc2),
        `+${fmtDA(res.npv_sc2 - res.npv_sc1)}`,
      ],
      [
        "TRI",
        `${res.irr_sc1}%`,
        `${res.irr_sc2}%`,
        `+${(res.irr_sc2 - res.irr_sc1).toFixed(2)}%`,
      ],
      [
        "IP (Indice Profitabilite)",
        res.pi_sc1.toFixed(3),
        res.pi_sc2.toFixed(3),
        `+${(res.pi_sc2 - res.pi_sc1).toFixed(3)}`,
      ],
      ["LCOE", `${res.lcoe} DA/kWh`, `${res.lcoe} DA/kWh`, "—"],
    ],
    headStyles: {
      fillColor: NAVY,
      textColor: CREAM,
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
    },
  });

  // ── PAGE 7: DCF TABLE ─────────────────────────────────────────────────────
  addPage();
  hLine(20, "Tableau DCF — 25 ans");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text(
    "DS = FIXE (non indexe) | T_n = T0*(1+f)^(n-1) | DCF = CF/(1+r)^n | Vert = annee de rentabilite",
    14,
    28,
  );

  autoTable(doc, {
    startY: 33,
    head: [
      [
        "An",
        "E_self",
        "T_n",
        "Eco.Energ",
        "DS",
        "Brut",
        "O&M",
        "Net CF",
        "DCF",
        "VA Sc1",
        "VA Sc2",
      ],
    ],
    body: res.dcf_table.map((row) => [
      row.year,
      fmt(row.e_self_n),
      row.t_n.toFixed(4),
      fmt(row.energy_savings),
      fmt(row.ds),
      fmt(row.gross_savings),
      fmt(row.om),
      fmt(row.net_cf),
      fmt(row.dcf),
      fmt(row.cum_sc1),
      fmt(row.cum_sc2),
    ]),
    headStyles: {
      fillColor: NAVY,
      textColor: CREAM,
      fontStyle: "bold",
      fontSize: 6.5,
    },
    bodyStyles: { fontSize: 7 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
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
      if (data.section !== "body") return;
      const row = res.dcf_table[data.row.index];
      if (!row) return;
      if (row.cum_sc1 >= 0 && data.column.index === 9) {
        data.cell.styles.textColor = [22, 163, 74];
        data.cell.styles.fontStyle = "bold";
      }
      if (row.cum_sc2 >= 0 && data.column.index === 10) {
        data.cell.styles.textColor = [37, 99, 235];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // ── PAGE 8: COURBE VAN + SCR ──────────────────────────────────────────────
  addPage();
  hLine(20, "Evolution VAN Cumulee — 25 ans");

  const npv1 = res.dcf_table.map((r) => r.cum_sc1);
  const npv2 = res.dcf_table.map((r) => r.cum_sc2);
  const yrLbls = res.dcf_table.map((r) => String(r.year));
  const lineImg = makeLineChart(npv1, npv2, yrLbls, 520, 220);
  doc.addImage(lineImg, "PNG", 14, 27, PW - 28, 65);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text(
    `Sc1: VAN=${fmtDA(res.npv_sc1)} | TRI=${res.irr_sc1}% | DRA=${res.dpp_sc1 ?? ">25"} ans`,
    14,
    96,
  );
  doc.text(
    `Sc2: VAN=${fmtDA(res.npv_sc2)} | TRI=${res.irr_sc2}% | DRA=${res.dpp_sc2 ?? ">25"} ans`,
    14,
    102,
  );

  const scrImg = makeBarChart(
    res.monthly_scr,
    null,
    MONTHS_FR,
    520,
    140,
    C.cream,
    C.navy,
    "Taux d'Autoconsommation Mensuel SCR% — methode: min(E_PV,m, E_cons,m) / E_PV,m",
  );
  doc.addImage(scrImg, "PNG", 14, 108, PW - 28, 42);

  // ── PAGE 9: ENVIRONNEMENT & RECOMMANDATIONS ───────────────────────────────
  addPage();
  hLine(20, "Impact Environnemental & Comptage Net");
  autoTable(doc, {
    startY: 26,
    head: [["Indicateur", "Valeur An 1", "Valeur 25 ans", "Reference"]],
    body: [
      [
        "CO2 evite",
        `${res.co2_yr1} tCO2`,
        `${res.co2_25yr} tCO2`,
        "Facteur 0.550 kg CO2/kWh — reseau algerien",
      ],
      [
        "Arbres equivalents",
        `${res.trees_equiv}`,
        `${res.trees_equiv * 25}`,
        "45 arbres / tCO2 / an",
      ],
      [
        "Vehicules retires equiv.",
        `${res.vehicles_equiv}`,
        "—",
        "2.3 tCO2 / vehicule / an",
      ],
      [
        "Surplus exporte (net. net)",
        `${fmt(res.exported)} kWh`,
        "—",
        "Loi 04-09 sur les energies renouvelables",
      ],
      [
        "Revenus comptage net",
        fmtDA(res.nm_revenue),
        "—",
        `${fmt(res.exported)} kWh * 1.8064 DA/kWh`,
      ],
    ],
    headStyles: {
      fillColor: [22, 101, 52],
      textColor: [187, 247, 208],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [240, 253, 244] },
  });

  const recY0 = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.text("Recommandations", 14, recY0);
  doc.setFillColor(...CREAM);
  doc.rect(14, recY0 + 1.5, 45, 0.7, "F");

  const recs = [
    `VAN positive ${fmtDA(res.npv_sc1)} (Sc1) — le projet cree de la valeur sur 25 ans. Investissement recommande.`,
    `TRI ${res.irr_sc1}% > taux d'actualisation ${fin.r}% — la rentabilite est assuree.`,
    `SCR calcule ${res.scr}% (vs 70% suppose generallement) — methodologie mensuelle plus precise.`,
    `Activer le dispositif APRUE (Sc2) reduit le DRS de ${(res.spp_sc1 - res.spp_sc2).toFixed(1)} ans et augmente la VAN de ${fmtDA(res.npv_sc2 - res.npv_sc1)}.`,
    `Installer un systeme de monitoring (SCADA / IoT) pour valider la production et detecter les degradations.`,
    `S'enregistrer au mecanisme de comptage net (Loi 04-09) pour valoriser les ${fmt(res.exported)} kWh/an exportes.`,
  ];

  let ry = recY0 + 9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(40, 40, 40);
  recs.forEach((rec, i) => {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...(CREAM[0] > 200 ? NAVY : CREAM));
    doc.setTextColor(180, 150, 10);
    doc.text(`${i + 1}.`, 14, ry);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    const lines = doc.splitTextToSize(rec, PW - 32) as string[];
    doc.text(lines, 20, ry);
    ry += lines.length * 5 + 3;
    if (ry > PH - 20) {
      addPage();
      ry = 20;
    }
  });

  // ── Footer on every page ─────────────────────────────────────────────────
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(140, 140, 140);
    doc.text(
      "SolarAnalytics.dz | Moteur v1.0 | IEC 61724-1:2021 | Universite de Biskra 2025-2026",
      14,
      PH - 5,
    );
    doc.text(`Page ${p} / ${total}`, PW - 14, PH - 5, { align: "right" });
  }

  doc.save(
    `SolarAnalytics_${sys.building_name.replace(/\s+/g, "_")}_${new Date().getFullYear()}.pdf`,
  );
}

// ─── Sonelgaz bill parser (Tarif HTA 42 — based on actual Sonelgaz bill structure) ──
// Fields to extract from each Sonelgaz HTA Tarif 42 bill:
//   hp_kwh   = Heures Hors Pointe = Cadran 1 + Cadran 2   (tariff ~1.80 DA/kWh)
//   peak_kwh = Heures de Pointe   = Cadran 3               (tariff ~8.72 DA/kWh)
//   total_da = TOTAL FACTURE / Net a Payer
//   month, year from billing period header
function parseSonelgazBill(
  text: string,
  slotIdx: number,
): { data: BillData; warn: string } {
  // 1 — Normalise
  //   a) collapse whitespace within lines
  //   b) remove French thousands separators: "10 322" → "10322"
  //      Must run twice because "1 234 567" needs two passes
  let t = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");
  t = t.replace(/(\d) (\d{3})(?=[ ,.\n]|$)/g, "$1$2");
  t = t.replace(/(\d) (\d{3})(?=[ ,.\n]|$)/g, "$1$2");
  // c) comma-decimal → dot-decimal: "10322,00" → "10322.00"
  t = t.replace(/(\d),(\d{2})(?!\d)/g, "$1.$2");

  const lines = t
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // ── Helpers ──
  const toNum = (s: string): number => {
    const v = parseFloat(s.replace(/\s/g, "").replace(",", "."));
    return isNaN(v) ? 0 : v;
  };
  const numsIn = (s: string): number[] =>
    [...s.matchAll(/\d+(?:\.\d{1,2})?/g)].map((m) => toNum(m[0]));

  const findAfter = (src: string, keywords: RegExp[]): number => {
    for (const kw of keywords) {
      const m = src.match(kw);
      if (m && m[1]) {
        const v = toNum(m[1]);
        if (v > 0) return v;
      }
    }
    return 0;
  };

  // ── Strategy 1: Cadran-based (most precise for HTA) ─────────────────────
  // The bill has a table header row "Cadran 1 / Cadran 2 / Cadran 3"
  // followed on the next row by the consumption quantities.
  let c1 = 0,
    c2 = 0,
    c3 = 0;

  // Try inline on same line: "Cadran 1   10322.00"
  c1 = findAfter(t, [
    /[Cc]adran\s*1[^\d\n]{0,60}(\d{3,6}(?:\.\d{1,2})?)/,
    /\bC1\b[^\d\n]{0,30}(\d{3,6}(?:\.\d{1,2})?)/,
  ]);
  c2 = findAfter(t, [
    /[Cc]adran\s*2[^\d\n]{0,60}(\d{3,6}(?:\.\d{1,2})?)/,
    /\bC2\b[^\d\n]{0,30}(\d{3,6}(?:\.\d{1,2})?)/,
  ]);
  c3 = findAfter(t, [
    /[Cc]adran\s*3[^\d\n]{0,60}(\d{3,6}(?:\.\d{1,2})?)/,
    /\bC3\b[^\d\n]{0,30}(\d{3,6}(?:\.\d{1,2})?)/,
  ]);

  // If not inline — Cadran headers are a row by themselves, values on next row
  if (c1 === 0 && c2 === 0) {
    for (let i = 0; i < lines.length - 1; i++) {
      const lo = lines[i].toLowerCase();
      if (lo.includes("cadran") && lo.includes("1")) {
        // next line should have the quantities
        const nxt = lines[i + 1];
        const nums = numsIn(nxt).filter((n) => n >= 50 && n <= 999999);
        if (nums.length >= 3) {
          c1 = nums[0];
          c2 = nums[1];
          c3 = nums[2];
        } else if (nums.length === 2) {
          c1 = nums[0];
          c2 = nums[1];
        } else if (nums.length === 1) {
          c1 = nums[0];
        }
        break;
      }
    }
  }

  // ── Strategy 2: Periodes Tarifaires ─────────────────────────────────────
  // The bill shows "H Pointe" and "Pointe" column headers with values below.
  let hpPeriode = 0,
    pPeriode = 0;

  // Try same-line pattern: "H.Pointe  33721.49   Pointe  320.71"
  const periodeLineRe =
    /H[.\s]*Pointe.*?(\d{3,6}(?:\.\d{1,2})?).*?Pointe.*?(\d{2,5}(?:\.\d{1,2})?)/i;
  const plMatch = t.match(periodeLineRe);
  if (plMatch) {
    hpPeriode = toNum(plMatch[1]);
    pPeriode = toNum(plMatch[2]);
  }

  if (hpPeriode === 0) {
    hpPeriode = findAfter(t, [
      /H(?:eures?\s+)?(?:H(?:ors)?\s+)?Pointe[^\d\n]{0,30}(\d{3,6}(?:\.\d{1,2})?)/i,
      /HHP[^\d\n]{0,20}(\d{3,6}(?:\.\d{1,2})?)/i,
    ]);
  }

  // ── Determine hp_kwh and peak_kwh ────────────────────────────────────────
  let hp_kwh = 0,
    peak_kwh = 0;

  if (c1 > 0 || c2 > 0 || c3 > 0) {
    // HTA Tarif 42: Cadran 1 + 2 = HHP, Cadran 3 = HP (peak)
    hp_kwh = c1 + c2;
    peak_kwh = c3;
    // Edge: only c3 was found — put it in hp
    if (hp_kwh === 0 && peak_kwh > 0) {
      hp_kwh = peak_kwh;
      peak_kwh = 0;
    }
  } else if (hpPeriode > 0 || pPeriode > 0) {
    hp_kwh = hpPeriode;
    peak_kwh = pPeriode;
  } else {
    // Last resort: pick the 2 most prominent kWh-range numbers
    const all = lines.flatMap((l) =>
      numsIn(l).filter((n) => n >= 100 && n <= 99999),
    );
    const uniq = [...new Set(all)].sort((a, b) => b - a);
    if (uniq.length >= 2) {
      hp_kwh = uniq[0];
      peak_kwh = uniq[1];
    } else if (uniq.length === 1) {
      hp_kwh = uniq[0];
    }
  }

  // ── Total DA ─────────────────────────────────────────────────────────────
  let total_da = 0;

  // Look for "TOTAL FACTURE" / "Net a Payer" and take the number on same or next line
  const totalKeywords = [
    /TOTAL\s*FACTURE[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
    /Net\s+[àa]\s+Payer[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
    /Montant\s+Net[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
    /Total\s+TTC[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
    /NET\s+A\s+PAYER[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
  ];

  total_da = findAfter(t, totalKeywords);

  // If not found inline, check line-by-line (value may be on next line)
  if (total_da === 0) {
    for (let i = 0; i < lines.length; i++) {
      const lo = lines[i].toLowerCase();
      const isTotal =
        (lo.includes("total") && lo.includes("facture")) ||
        lo.includes("net a payer") ||
        (lo.includes("montant") && lo.includes("net"));
      if (isTotal) {
        // Try numbers on same line
        const sameNums = numsIn(lines[i]).filter((n) => n > 1000);
        if (sameNums.length) {
          total_da = sameNums[sameNums.length - 1];
          break;
        }
        // Try next line
        if (i + 1 < lines.length) {
          const nextNums = numsIn(lines[i + 1]).filter((n) => n > 1000);
          if (nextNums.length) {
            total_da = nextNums[0];
            break;
          }
        }
      }
    }
  }

  // Absolute fallback: largest number > 5000 likely to be a DA bill amount
  if (total_da === 0) {
    const big = lines
      .flatMap((l) => numsIn(l))
      .filter((n) => n > 5000 && n < 5_000_000)
      .sort((a, b) => b - a);
    if (big.length) total_da = big[0];
  }

  // ── Month & Year ─────────────────────────────────────────────────────────
  const MONTH_MAP: Record<string, number> = {
    janvier: 1,
    fevrier: 2,
    février: 2,
    mars: 3,
    avril: 4,
    mai: 5,
    juin: 6,
    juillet: 7,
    aout: 8,
    août: 8,
    septembre: 9,
    octobre: 10,
    novembre: 11,
    decembre: 12,
    décembre: 12,
    jan: 1,
    fev: 2,
    fév: 2,
    mar: 3,
    avr: 4,
    jun: 6,
    jul: 7,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
    déc: 12,
  };

  let month = slotIdx + 1; // default = slot index (Jan=1 … Dec=12)
  let year = new Date().getFullYear();

  // Pattern 1: "Janvier 2023" anywhere in text
  const mkeys = Object.keys(MONTH_MAP).join("|");
  const mRe = new RegExp(`\\b(${mkeys})\\b[\\s,.-]{0,5}(20\\d{2})`, "i");
  const mMatch = t.match(mRe);
  if (mMatch) {
    month = MONTH_MAP[mMatch[1].toLowerCase()] ?? month;
    year = parseInt(mMatch[2]);
  }

  // Pattern 2: MM/YYYY or MM-YYYY
  if (!mMatch) {
    const numRe = /\b(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/;
    const nMatch = t.match(numRe);
    if (nMatch) {
      month = parseInt(nMatch[1]);
      year = parseInt(nMatch[2]);
    }
  }

  // Pattern 3: standalone year
  const yMatch = t.match(/\b(202\d)\b/);
  if (yMatch && year === new Date().getFullYear()) year = parseInt(yMatch[1]);

  // ── Build warning string for partial extractions ─────────────────────────
  const warns: string[] = [];
  if (hp_kwh === 0 && peak_kwh === 0) warns.push("Consommation non detectee");
  if (total_da === 0) warns.push("Montant non detecte");
  if (!mMatch) warns.push("Mois/annee non detectes — verifiez");
  const warn = warns.join(" | ");

  return {
    data: {
      hp_kwh: Math.round(hp_kwh),
      peak_kwh: Math.round(peak_kwh),
      total_da: Math.round(total_da),
      month,
      year,
    },
    warn,
  };
}

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_SYS: SystemParams = {
  building_name: "Faculte des Sciences et Technologies",
  building_address: "Universite de Biskra, Biskra, Algerie",
  p_installed: 285.13,
  ghi_annual: 5.5,
  pr: 80,
  capex: 24408342,
  n_modules: 770,
  module_brand: "Jinko Solar",
  module_model: "JKM370M-72",
  module_power: 370,
  inverter_brand: "5 onduleurs (55 strings x 14 modules)",
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
const emptySlot = (): BillSlot => ({
  file: null,
  preview: null,
  status: "empty",
  data: null,
  edited: null,
  ocrWarn: "",
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

  // ── OCR + parse ──────────────────────────────────────────────────────────
  const processImage = useCallback(async (file: File, idx: number) => {
    setBills((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        file,
        preview: URL.createObjectURL(file),
        status: "processing",
        ocrWarn: "",
      };
      return next;
    });
    try {
      const {
        data: { text },
      } = await Tesseract.recognize(file, "fra", { logger: () => {} });
      const { data, warn } = parseSonelgazBill(text, idx);
      setBills((prev) => {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          status: "done",
          data,
          edited: { ...data },
          ocrWarn: warn,
        };
        return next;
      });
    } catch {
      const fallback: BillData = {
        hp_kwh: 0,
        peak_kwh: 0,
        total_da: 0,
        month: idx + 1,
        year: new Date().getFullYear(),
      };
      setBills((prev) => {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          status: "done",
          data: fallback,
          edited: { ...fallback },
          ocrWarn: "OCR echoue — saisie manuelle requise",
        };
        return next;
      });
    }
  }, []);

  const manualSlot = (idx: number) => {
    const fallback: BillData = {
      hp_kwh: 0,
      peak_kwh: 0,
      total_da: 0,
      month: idx + 1,
      year: new Date().getFullYear(),
    };
    setBills((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        status: "done",
        data: fallback,
        edited: { ...fallback },
        ocrWarn: "Saisie manuelle",
      };
      return next;
    });
  };

  const updateField = (idx: number, field: keyof BillData, value: number) => {
    setBills((prev) => {
      const next = [...prev];
      if (next[idx].edited)
        next[idx] = {
          ...next[idx],
          edited: { ...next[idx].edited!, [field]: value },
        };
      return next;
    });
  };

  const doneBills = bills.filter((b) => b.status === "done").length;

  const compute = () => {
    setComputing(true);
    setTimeout(() => {
      setResults(runStudy(bills, sys, fin));
      setComputing(false);
      setStep(4);
    }, 300);
  };

  const downloadPDF = () => {
    if (!results) return;
    setGenPdf(true);
    setTimeout(() => {
      generatePDF(results, sys, fin);
      setGenPdf(false);
    }, 100);
  };

  // ── STEP 0: Welcome ───────────────────────────────────────────────────────
  if (step === 0)
    return (
      <div
        style={{ backgroundColor: C.navy }}
        className="min-h-screen flex items-center justify-center p-6"
      >
        <div className="max-w-lg w-full">
          <div className="mb-2" style={{ color: C.cream }}>
            <span
              className="text-xs tracking-[0.3em] font-semibold border px-2 py-0.5 rounded"
              style={{ borderColor: C.cream + "40" }}
            >
              SOLARANALYTICS.DZ — v1.0
            </span>
          </div>
          <h1
            className="text-4xl font-bold mt-4 mb-3 leading-tight"
            style={{ color: C.light }}
          >
            Etude Technico-
            <br />
            <span style={{ color: C.cream }}>Economique PV</span>
          </h1>
          <p
            className="mb-8 leading-relaxed text-sm"
            style={{ color: C.light + "99" }}
          >
            Importez vos factures Sonelgaz. L&apos;OCR extrait les donnees, le
            moteur calcule le SCR reel mensuel, et un rapport bancable PDF est
            genere. 100% gratuit — tout s&apos;execute dans votre navigateur.
          </p>

          <div className="grid grid-cols-2 gap-3 mb-8">
            {[
              ["IEC 61724-1:2021", "Norme internationale de calcul PV"],
              ["SCR Mensuel Reel", "Jamais de valeur fixe supposee"],
              ["DCF 25 ans complet", "VAN, TRI, DRA, IP, LCOE"],
              ["100% Gratuit", "OCR local — aucun API payant"],
            ].map(([t, s]) => (
              <div
                key={t}
                className="rounded-xl p-4 border"
                style={{ backgroundColor: C.navy2, borderColor: C.border }}
              >
                <div
                  className="font-bold text-xs mb-1"
                  style={{ color: C.cream }}
                >
                  {t}
                </div>
                <div className="text-xs" style={{ color: C.light + "70" }}>
                  {s}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setStep(1)}
            className="w-full py-4 rounded-xl font-bold text-base transition-opacity hover:opacity-90"
            style={{ backgroundColor: C.cream, color: C.navy }}
          >
            Demarrer l&apos;etude →
          </button>
          <p
            className="text-center text-xs mt-4"
            style={{ color: C.light + "40" }}
          >
            Biskra GHI: 5.5 kWh/m²/j · Tarif HTA 42 · Reference Univ. Biskra
            2025-2026
          </p>
        </div>
      </div>
    );

  // ── STEP 1: Bills ─────────────────────────────────────────────────────────
  if (step === 1)
    return (
      <div style={{ backgroundColor: C.navy }} className="min-h-screen p-5">
        <WizardHeader
          step={1}
          total={4}
          title="Factures Sonelgaz"
          sub="Importez jusqu'a 12 factures — OCR automatique + saisie manuelle"
        />

        <div className="max-w-4xl mx-auto">
          {/* Tip */}
          <div
            className="rounded-xl p-3 mb-5 border text-xs"
            style={{
              backgroundColor: C.navy2,
              borderColor: C.cream + "30",
              color: C.light + "80",
            }}
          >
            <span style={{ color: C.cream }} className="font-semibold">
              Conseil facture HTA Tarif 42 :
            </span>{" "}
            L&apos;OCR cherche Cadran 1 (HHP) + Cadran 2 (HHP) + Cadran 3 (HP)
            et TOTAL FACTURE. Verifiez toujours les valeurs extraites. Utilisez
            &quot;Saisie manuelle&quot; si l&apos;image est floue.
          </div>

          {/* Upload grid */}
          <div className="grid grid-cols-3 md:grid-cols-4 gap-3 mb-5">
            {bills.map((bill, i) => (
              <div key={i}>
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
                  onClick={() =>
                    bill.status !== "processing" && fileRefs.current[i]?.click()
                  }
                  className="relative rounded-xl border-2 cursor-pointer overflow-hidden transition-all"
                  style={{
                    aspectRatio: "3/4",
                    borderColor:
                      bill.status === "empty"
                        ? C.border
                        : bill.status === "processing"
                          ? C.cream
                          : bill.ocrWarn
                            ? "#f59e0b44"
                            : "#22c55e44",
                    backgroundColor: C.navy2,
                  }}
                >
                  {bill.preview ? (
                    <img
                      src={bill.preview}
                      className="w-full h-full object-cover"
                      style={{ opacity: 0.55 }}
                      alt=""
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                      <div className="text-xl">📄</div>
                      <div
                        className="text-xs"
                        style={{ color: C.cream + "80" }}
                      >
                        {MONTHS_FR[i]}
                      </div>
                    </div>
                  )}
                  {bill.status === "processing" && (
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ backgroundColor: C.navy + "cc" }}
                    >
                      <div
                        className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin"
                        style={{ borderColor: C.cream }}
                      />
                    </div>
                  )}
                  {bill.status === "done" && (
                    <div
                      className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{
                        backgroundColor: bill.ocrWarn ? "#f59e0b" : "#22c55e",
                        color: C.navy,
                      }}
                    >
                      {bill.ocrWarn ? "!" : "✓"}
                    </div>
                  )}
                  <div
                    className="absolute bottom-0 left-0 right-0 text-center py-0.5 text-xs font-semibold"
                    style={{
                      backgroundColor: C.navy + "cc",
                      color: C.cream + "cc",
                    }}
                  >
                    {MONTHS_FR[i]}
                  </div>
                </div>
                {bill.status === "empty" && (
                  <button
                    onClick={() => manualSlot(i)}
                    className="w-full mt-1 text-xs py-1 rounded-lg"
                    style={{
                      backgroundColor: C.navy2,
                      color: C.light + "60",
                      border: `1px solid ${C.border}`,
                    }}
                  >
                    Saisie manuelle
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Review table */}
          {doneBills > 0 && (
            <div
              className="rounded-xl border overflow-hidden mb-5"
              style={{ borderColor: C.border }}
            >
              <div
                className="px-4 py-3 font-bold text-sm border-b"
                style={{
                  backgroundColor: C.navy2,
                  color: C.cream,
                  borderColor: C.border,
                }}
              >
                Verification &amp; Correction des valeurs extraites
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ backgroundColor: C.navy2 }}>
                      {[
                        "Mois",
                        "HHP (kWh)",
                        "HP Pointe (kWh)",
                        "Total (DA)",
                        "Mois fact.",
                        "An",
                      ].map((h) => (
                        <th
                          key={h}
                          className="py-2 px-2 text-left font-semibold"
                          style={{ color: C.light + "70" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((b, i) =>
                      b.status === "done" && b.edited ? (
                        <tr
                          key={i}
                          className="border-t"
                          style={{ borderColor: C.border + "40" }}
                        >
                          <td
                            className="py-1.5 px-2 font-semibold"
                            style={{ color: C.cream + "aa" }}
                          >
                            {MONTHS_FR[i]}
                            {b.ocrWarn && (
                              <div
                                className="text-xs font-normal"
                                style={{ color: "#f59e0b" }}
                              >
                                {b.ocrWarn}
                              </div>
                            )}
                          </td>
                          {(["hp_kwh", "peak_kwh", "total_da"] as const).map(
                            (field) => (
                              <td key={field} className="py-1 px-1.5">
                                <input
                                  type="number"
                                  value={b.edited![field] || ""}
                                  onChange={(e) =>
                                    updateField(
                                      i,
                                      field,
                                      parseFloat(e.target.value) || 0,
                                    )
                                  }
                                  className="w-full text-right px-2 py-1 rounded-lg text-xs outline-none"
                                  style={{
                                    backgroundColor: C.navy,
                                    border: `1px solid ${C.border}`,
                                    color: C.light,
                                  }}
                                />
                              </td>
                            ),
                          )}
                          <td className="py-1 px-1.5">
                            <input
                              type="number"
                              min={1}
                              max={12}
                              value={b.edited!.month || ""}
                              onChange={(e) =>
                                updateField(
                                  i,
                                  "month",
                                  parseInt(e.target.value) || 0,
                                )
                              }
                              className="w-16 text-center px-2 py-1 rounded-lg text-xs outline-none"
                              style={{
                                backgroundColor: C.navy,
                                border: `1px solid ${C.border}`,
                                color: C.light,
                              }}
                            />
                          </td>
                          <td className="py-1 px-1.5">
                            <input
                              type="number"
                              min={2020}
                              max={2030}
                              value={b.edited!.year || ""}
                              onChange={(e) =>
                                updateField(
                                  i,
                                  "year",
                                  parseInt(e.target.value) || 0,
                                )
                              }
                              className="w-20 text-center px-2 py-1 rounded-lg text-xs outline-none"
                              style={{
                                backgroundColor: C.navy,
                                border: `1px solid ${C.border}`,
                                color: C.light,
                              }}
                            />
                          </td>
                        </tr>
                      ) : null,
                    )}
                  </tbody>
                </table>
              </div>
              <div
                className="px-4 py-2 text-xs"
                style={{ backgroundColor: C.navy2, color: C.light + "50" }}
              >
                {doneBills}/12 factures renseignees — les mois manquants
                utilisent la consommation moyenne
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(0)}
              className="flex-1 py-3 rounded-xl text-sm"
              style={{ border: `1px solid ${C.border}`, color: C.light + "70" }}
            >
              Retour
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={doneBills < 1}
              className="flex-grow py-3 rounded-xl font-bold transition-opacity hover:opacity-90 disabled:opacity-30"
              style={{ backgroundColor: C.cream, color: C.navy }}
            >
              Suivant — Systeme ({doneBills}/12 factures)
            </button>
          </div>
        </div>
      </div>
    );

  // ── STEP 2: System ────────────────────────────────────────────────────────
  if (step === 2)
    return (
      <div style={{ backgroundColor: C.navy }} className="min-h-screen p-5">
        <WizardHeader
          step={2}
          total={4}
          title="Systeme PV"
          sub="Configuration technique de l'installation"
        />
        <div className="max-w-2xl mx-auto space-y-5">
          <Card title="Projet">
            <TxtField
              label="Nom du batiment"
              value={sys.building_name}
              onChange={(v) => setSys({ ...sys, building_name: v })}
            />
            <TxtField
              label="Adresse"
              value={sys.building_address}
              onChange={(v) => setSys({ ...sys, building_address: v })}
            />
          </Card>
          <Card title="Modules & Onduleurs">
            <NumField
              label="Puissance installee (kWp)"
              value={sys.p_installed}
              onChange={(v) => setSys({ ...sys, p_installed: v })}
              step={0.01}
            />
            <NumField
              label="Nombre de modules"
              value={sys.n_modules}
              onChange={(v) => setSys({ ...sys, n_modules: v })}
            />
            <TxtField
              label="Marque module"
              value={sys.module_brand}
              onChange={(v) => setSys({ ...sys, module_brand: v })}
            />
            <TxtField
              label="Modele module"
              value={sys.module_model}
              onChange={(v) => setSys({ ...sys, module_model: v })}
            />
            <NumField
              label="Puissance module (Wp)"
              value={sys.module_power}
              onChange={(v) => setSys({ ...sys, module_power: v })}
            />
            <TxtField
              label="Onduleurs"
              value={sys.inverter_brand}
              onChange={(v) => setSys({ ...sys, inverter_brand: v })}
            />
            <NumField
              label="Nombre d'onduleurs"
              value={sys.n_inverters}
              onChange={(v) => setSys({ ...sys, n_inverters: v })}
            />
          </Card>
          <Card title="Site & Performance">
            <NumField
              label="GHI annuel (kWh/m2/jour)"
              value={sys.ghi_annual}
              onChange={(v) => setSys({ ...sys, ghi_annual: v })}
              step={0.1}
              hint="Biskra=5.5 | Alger=4.8 | Adrar=6.8"
            />
            <NumField
              label="Performance Ratio PR (%)"
              value={sys.pr}
              onChange={(v) => setSys({ ...sys, pr: v })}
              step={1}
              hint="75-85% typique — 80% par defaut"
            />
            <NumField
              label="Inclinaison (deg)"
              value={sys.tilt}
              onChange={(v) => setSys({ ...sys, tilt: v })}
            />
            <TxtField
              label="Orientation"
              value={sys.orientation}
              onChange={(v) => setSys({ ...sys, orientation: v })}
            />
            <NumField
              label="Surface toiture (m2)"
              value={sys.roof_area}
              onChange={(v) => setSys({ ...sys, roof_area: v })}
            />
            <NumField
              label="CAPEX total (DA)"
              value={sys.capex}
              onChange={(v) => setSys({ ...sys, capex: v })}
              step={10000}
              hint="Modules + onduleurs + cables + installation + 5% imprevu"
            />
          </Card>
          <NavButtons
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextLabel="Suivant — Financier"
          />
        </div>
      </div>
    );

  // ── STEP 3: Financial ─────────────────────────────────────────────────────
  if (step === 3)
    return (
      <div style={{ backgroundColor: C.navy }} className="min-h-screen p-5">
        <WizardHeader
          step={3}
          total={4}
          title="Parametres Financiers"
          sub="Hypotheses du modele DCF 25 ans"
        />
        <div className="max-w-2xl mx-auto space-y-5">
          <Card title="Taux & Inflation">
            <NumField
              label="Taux d'actualisation r (%)"
              value={fin.r}
              onChange={(v) => setFin({ ...fin, r: v })}
              step={0.5}
              hint="Cout du capital — 6% standard Algerie"
            />
            <NumField
              label="Inflation tarifaire f (%/an)"
              value={fin.f}
              onChange={(v) => setFin({ ...fin, f: v })}
              step={0.5}
              hint="Evolution tarifaire Sonelgaz — 4%/an historique"
            />
            <NumField
              label="Degradation modules D (%/an)"
              value={fin.D}
              onChange={(v) => setFin({ ...fin, D: v })}
              step={0.1}
              hint="Garantie Jinko JKM — 0.5%/an"
            />
          </Card>
          <Card title="Couts & Economies">
            <NumField
              label="O&M (% CAPEX/an)"
              value={fin.om_rate}
              onChange={(v) => setFin({ ...fin, om_rate: v })}
              step={0.1}
              hint="Maintenance + assurance — 1% standard"
            />
            <NumField
              label="Economies demande DS (DA/an)"
              value={fin.DS}
              onChange={(v) => setFin({ ...fin, DS: v })}
              step={1000}
              hint="Valeur FIXE — ne pas indexer a l'inflation tarifaire"
            />
            <NumField
              label="Taux subvention Sc2 (%)"
              value={fin.subsidy_rate}
              onChange={(v) => setFin({ ...fin, subsidy_rate: v })}
              step={5}
              hint="Dispositif APRUE — 20% standard"
            />
          </Card>

          {/* Critical warning */}
          <div
            className="rounded-xl p-4 border text-sm"
            style={{
              border: `1px solid ${C.cream}40`,
              backgroundColor: C.cream + "08",
              color: C.light + "90",
            }}
          >
            <div className="font-bold mb-1" style={{ color: C.cream }}>
              Avertissement critique — DS fixe
            </div>
            DS = {fin.DS.toLocaleString()} DA/an est une constante. Dans le
            moteur de calcul, elle n&apos;est{" "}
            <strong style={{ color: C.cream }}>jamais</strong> multipliee par
            (1+f)^(n-1). C&apos;est l&apos;erreur la plus frequente dans les
            etudes PV algeriennes.
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-3 rounded-xl text-sm"
              style={{ border: `1px solid ${C.border}`, color: C.light + "70" }}
            >
              Retour
            </button>
            <button
              onClick={compute}
              disabled={computing}
              className="flex-grow py-3 rounded-xl font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: C.cream, color: C.navy }}
            >
              {computing ? (
                <span className="flex items-center justify-center gap-2">
                  <span
                    className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                    style={{ borderColor: C.navy }}
                  />
                  Calcul en cours...
                </span>
              ) : (
                "Calculer l'etude complete"
              )}
            </button>
          </div>
        </div>
      </div>
    );

  // ── STEP 4: Results ───────────────────────────────────────────────────────
  if (step === 4 && results) {
    const r = results;
    return (
      <div style={{ backgroundColor: C.navy }} className="min-h-screen p-5">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-start justify-between mb-6 gap-4">
            <div>
              <div
                className="text-xs tracking-widest mb-1"
                style={{ color: C.cream + "80" }}
              >
                RESULTATS ETUDE
              </div>
              <h1 className="text-2xl font-bold" style={{ color: C.light }}>
                {sys.building_name}
              </h1>
              <p className="text-sm mt-1" style={{ color: C.light + "60" }}>
                {sys.p_installed} kWp · {sys.n_modules} modules · GHI{" "}
                {sys.ghi_annual} kWh/m²/j · T₀ = {r.t0.toFixed(4)} DA/kWh
              </p>
            </div>
            <button
              onClick={downloadPDF}
              disabled={genPdf}
              className="shrink-0 px-6 py-3 rounded-xl font-bold transition-opacity hover:opacity-90 disabled:opacity-40 text-sm"
              style={{ backgroundColor: C.cream, color: C.navy }}
            >
              {genPdf ? "Generation..." : "Telecharger PDF"}
            </button>
          </div>

          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              {
                l: "VAN Sc1",
                v: `${(r.npv_sc1 / 1e6).toFixed(2)} M DA`,
                ok: r.npv_sc1 > 0,
              },
              { l: "TRI Sc1", v: `${r.irr_sc1}%`, ok: r.irr_sc1 > fin.r },
              { l: "DRS Sc1", v: `${r.spp_sc1} ans`, ok: true },
              { l: "LCOE", v: `${r.lcoe} DA/kWh`, ok: true },
              { l: "SCR Calcule", v: `${r.scr}%`, ok: true },
              {
                l: "E_annual",
                v: `${(r.e_annual / 1000).toFixed(0)} MWh`,
                ok: true,
              },
              {
                l: "VAN Sc2",
                v: `${(r.npv_sc2 / 1e6).toFixed(2)} M DA`,
                ok: r.npv_sc2 > 0,
              },
              { l: "CO2 evite", v: `${r.co2_yr1} t/an`, ok: true },
            ].map((k) => (
              <div
                key={k.l}
                className="rounded-xl p-4 border"
                style={{
                  backgroundColor: C.navy2,
                  borderColor: k.ok ? C.cream + "25" : "#ef444433",
                }}
              >
                <div className="text-xs mb-1" style={{ color: C.light + "50" }}>
                  {k.l}
                </div>
                <div
                  className="text-lg font-bold"
                  style={{ color: k.ok ? C.cream : "#ef4444" }}
                >
                  {k.v}
                </div>
              </div>
            ))}
          </div>

          {/* Monthly table */}
          <div
            className="rounded-xl border overflow-hidden mb-4"
            style={{ borderColor: C.border }}
          >
            <div
              className="px-4 py-3 font-bold text-sm"
              style={{ backgroundColor: C.navy2, color: C.cream }}
            >
              Production vs Consommation Mensuelle
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ backgroundColor: C.navy2 }}>
                    <th
                      className="py-2 px-2 text-left"
                      style={{ color: C.light + "60" }}
                    >
                      Indicateur
                    </th>
                    {MONTHS_FR.map((m) => (
                      <th
                        key={m}
                        className="py-2 px-1 text-right"
                        style={{ color: C.light + "60" }}
                      >
                        {m}
                      </th>
                    ))}
                    <th
                      className="py-2 px-2 text-right font-bold"
                      style={{ color: C.cream }}
                    >
                      TOTAL
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "E_PV (kWh)", vals: r.monthly_pv, color: C.cream },
                    {
                      label: "E_Cons (kWh)",
                      vals: r.monthly_cons,
                      color: "#60a5fa",
                    },
                    { label: "SC (kWh)", vals: r.monthly_sc, color: "#4ade80" },
                    {
                      label: "SCR (%)",
                      vals: r.monthly_scr,
                      color: C.light + "80",
                      unit: "%",
                    },
                  ].map((row) => (
                    <tr
                      key={row.label}
                      className="border-t"
                      style={{ borderColor: C.border + "30" }}
                    >
                      <td
                        className="py-1.5 px-2 font-semibold"
                        style={{ color: row.color }}
                      >
                        {row.label}
                      </td>
                      {row.vals.map((v, i) => (
                        <td
                          key={i}
                          className="py-1.5 px-1 text-right"
                          style={{ color: C.light + "90" }}
                        >
                          {v.toLocaleString()}
                          {row.unit ?? ""}
                        </td>
                      ))}
                      <td
                        className="py-1.5 px-2 text-right font-bold"
                        style={{ color: row.color }}
                      >
                        {row.unit
                          ? `${Math.round(row.vals.reduce((a, b) => a + b, 0) / 12)}%`
                          : row.vals
                              .reduce((a, b) => a + b, 0)
                              .toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Scenarios */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {(
              [
                {
                  title: `Sc1 — Sans subvention`,
                  cap: sys.capex,
                  npv: r.npv_sc1,
                  irr: r.irr_sc1,
                  spp: r.spp_sc1,
                  dpp: r.dpp_sc1,
                  pi: r.pi_sc1,
                  color: C.cream,
                },
                {
                  title: `Sc2 — Subvention ${fin.subsidy_rate}%`,
                  cap: r.capex_sc2,
                  npv: r.npv_sc2,
                  irr: r.irr_sc2,
                  spp: r.spp_sc2,
                  dpp: r.dpp_sc2,
                  pi: r.pi_sc2,
                  color: "#60a5fa",
                },
              ] as const
            ).map((sc) => (
              <div
                key={sc.title}
                className="rounded-xl border p-4"
                style={{
                  backgroundColor: C.navy2,
                  borderColor: sc.color + "33",
                }}
              >
                <div
                  className="font-bold text-sm mb-3"
                  style={{ color: sc.color }}
                >
                  {sc.title}
                </div>
                {[
                  ["CAPEX", sc.cap.toLocaleString() + " DA"],
                  ["VAN", sc.npv.toLocaleString() + " DA"],
                  ["TRI", sc.irr + "%"],
                  ["DRS", sc.spp + " ans"],
                  ["DRA", (sc.dpp ?? ">25") + " ans"],
                  ["IP", String(sc.pi)],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex justify-between text-xs py-1 border-b"
                    style={{ borderColor: C.border + "30" }}
                  >
                    <span style={{ color: C.light + "50" }}>{k}</span>
                    <span className="font-semibold" style={{ color: C.light }}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Environmental */}
          <div
            className="rounded-xl border p-4 mb-4"
            style={{ backgroundColor: C.navy2, borderColor: "#22c55e22" }}
          >
            <div
              className="font-bold text-sm mb-3"
              style={{ color: "#4ade80" }}
            >
              Impact Environnemental
            </div>
            <div className="grid grid-cols-4 gap-3 text-center">
              {[
                ["tCO2/an", String(r.co2_yr1), "CO2 evite"],
                ["arbres", String(r.trees_equiv), "Equivalent arbres"],
                ["vehicules", String(r.vehicles_equiv), "Vehicules retires"],
                [
                  "DA/an",
                  r.nm_revenue.toLocaleString(),
                  "Revenus net metering",
                ],
              ].map(([unit, val, lbl]) => (
                <div
                  key={lbl}
                  className="rounded-lg p-3"
                  style={{ backgroundColor: "#22c55e0a" }}
                >
                  <div
                    className="text-xl font-bold"
                    style={{ color: "#4ade80" }}
                  >
                    {val}
                  </div>
                  <div className="text-xs" style={{ color: "#4ade80" + "80" }}>
                    {unit}
                  </div>
                  <div
                    className="text-xs mt-0.5"
                    style={{ color: C.light + "50" }}
                  >
                    {lbl}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(3)}
              className="py-3 px-6 rounded-xl text-sm"
              style={{ border: `1px solid ${C.border}`, color: C.light + "70" }}
            >
              Modifier
            </button>
            <button
              onClick={downloadPDF}
              disabled={genPdf}
              className="flex-grow py-3 rounded-xl font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: C.cream, color: C.navy }}
            >
              {genPdf
                ? "Generation du PDF..."
                : "Telecharger Rapport PDF Complet (9 pages)"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Shared UI sub-components ─────────────────────────────────────────────────
function WizardHeader({
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
      <div className="flex gap-1.5 mb-3">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full transition-all"
            style={{ backgroundColor: i < step ? C.cream : C.cream + "25" }}
          />
        ))}
      </div>
      <div
        className="text-xs tracking-[0.25em] font-semibold mb-1"
        style={{ color: C.cream + "70" }}
      >
        ETAPE {step} / {total}
      </div>
      <h2 className="text-2xl font-bold" style={{ color: C.light }}>
        {title}
      </h2>
      <p className="text-sm mt-1" style={{ color: C.light + "60" }}>
        {sub}
      </p>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ backgroundColor: C.navy2, borderColor: C.border }}
    >
      <div
        className="text-xs font-bold tracking-widest mb-4 uppercase"
        style={{ color: C.cream }}
      >
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function TxtField({
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
      <label className="block text-xs mb-1" style={{ color: C.light + "60" }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg text-sm outline-none"
        style={{
          backgroundColor: C.navy,
          border: `1px solid ${C.border}`,
          color: C.light,
        }}
      />
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs mb-1" style={{ color: C.light + "60" }}>
        {label}
      </label>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full px-3 py-2 rounded-lg text-sm outline-none"
        style={{
          backgroundColor: C.navy,
          border: `1px solid ${C.border}`,
          color: C.light,
        }}
      />
      {hint && (
        <p className="text-xs mt-0.5" style={{ color: C.light + "35" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function NavButtons({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <div className="flex gap-3">
      <button
        onClick={onBack}
        className="flex-1 py-3 rounded-xl text-sm"
        style={{ border: `1px solid ${C.border}`, color: C.light + "70" }}
      >
        Retour
      </button>
      <button
        onClick={onNext}
        className="flex-grow py-3 rounded-xl font-bold transition-opacity hover:opacity-90"
        style={{ backgroundColor: C.cream, color: C.navy }}
      >
        {nextLabel}
      </button>
    </div>
  );
}
