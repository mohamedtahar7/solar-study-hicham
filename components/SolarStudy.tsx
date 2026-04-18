"use client";
// ─────────────────────────────────────────────────────────────────────────────
//  SolarAnalytics.dz  v2.0
//  Full 35-Equation PV Techno-Economic Study Engine
//  IEC 61724-1:2021 · PRD Biskra Methodology · All 58 Wilayas
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useCallback, useRef } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import Tesseract from "tesseract.js";

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  navy: "#0c1322",
  navy2: "#152035",
  navy3: "#1d2d4a",
  cream: "#f5edd6",
  gold: "#d4a843",
  light: "#eef0f4",
  muted: "rgba(238,240,244,0.55)",
  border: "rgba(212,168,67,0.20)",
  green: "#2ecc71",
  red: "#e74c3c",
  blue: "#4a9eff",
};

// ─── Physical / financial constants ──────────────────────────────────────────
const SF = 0.7; // Space Factor (Eq.1)
const A_MODULE = 1.94; // m² per module (Jinko JKM 370M-72)
const P_UNIT = 370.3; // Wp per module at STC
const NOCT = 44; // °C (Eq.6)
const GAMMA = -0.0038; // /°C temperature coefficient (Eq.7)
const PR_INV = 0.98;
const PR_WIRING = 0.982;
const PR_MISMATCH = 0.982;
const PR_AVAIL = 0.997;
const CO2_FACTOR = 0.55; // kg CO₂/kWh — Algerian grid
const NM_TARIFF = 1.8064; // DA/kWh — net-metering (H.Hors Pointe)
const TREES_TCO2 = 45;
const VEHI_TCO2 = 2.3;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// ─── Month labels ─────────────────────────────────────────────────────────────
const M_SHORT = [
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
const M_FULL = [
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

// ─── Climate zones: monthly GHI fractions (of annual) + ambient temps ────────
// Zone 1 — Coastal  (GHI_yr ≤ 1700)
// Zone 2 — Tell     (1700 < GHI_yr ≤ 1950)
// Zone 3 — Hauts-Plateaux (1950 < GHI_yr ≤ 2150)
// Zone 4 — Pré-Saharien   (2150 < GHI_yr ≤ 2350)
// Zone 5 — Saharien       (GHI_yr > 2350)
type ClimateZone = 1 | 2 | 3 | 4 | 5;

const ZONE_FRACS: Record<ClimateZone, number[]> = {
  1: [
    0.056, 0.068, 0.09, 0.1, 0.108, 0.115, 0.118, 0.106, 0.086, 0.07, 0.052,
    0.031,
  ],
  2: [
    0.05, 0.064, 0.088, 0.1, 0.108, 0.115, 0.122, 0.11, 0.086, 0.074, 0.052,
    0.031,
  ],
  3: [
    0.048, 0.063, 0.086, 0.098, 0.106, 0.115, 0.128, 0.114, 0.088, 0.076, 0.053,
    0.025,
  ],
  4: [
    0.047, 0.061, 0.085, 0.095, 0.105, 0.115, 0.132, 0.118, 0.09, 0.078, 0.054,
    0.02,
  ],
  5: [
    0.046, 0.06, 0.084, 0.093, 0.103, 0.115, 0.135, 0.12, 0.092, 0.08, 0.055,
    0.017,
  ],
};
const ZONE_TEMPS: Record<ClimateZone, number[]> = {
  1: [12, 13, 15, 18, 21, 25, 28, 28, 24, 20, 15, 12],
  2: [7, 9, 12, 16, 21, 27, 31, 30, 25, 19, 11, 7],
  3: [5, 7, 11, 16, 22, 28, 33, 32, 26, 19, 10, 5],
  4: [10, 13, 18, 23, 29, 34, 38, 37, 32, 25, 16, 10],
  5: [13, 16, 21, 27, 33, 38, 42, 41, 36, 29, 19, 13],
};
// PR_soiling monthly (Eq.8) — higher in summer (Saharan dust)
const ZONE_SOILING: Record<ClimateZone, number[]> = {
  1: [
    0.975, 0.975, 0.973, 0.971, 0.969, 0.966, 0.963, 0.965, 0.97, 0.973, 0.975,
    0.975,
  ],
  2: [
    0.973, 0.972, 0.97, 0.968, 0.965, 0.962, 0.96, 0.962, 0.966, 0.97, 0.972,
    0.973,
  ],
  3: [
    0.972, 0.97, 0.967, 0.964, 0.962, 0.959, 0.957, 0.959, 0.963, 0.967, 0.97,
    0.972,
  ],
  4: [
    0.97, 0.968, 0.964, 0.96, 0.958, 0.955, 0.958, 0.96, 0.964, 0.967, 0.969,
    0.971,
  ],
  5: [
    0.968, 0.965, 0.962, 0.958, 0.955, 0.953, 0.956, 0.958, 0.962, 0.965, 0.967,
    0.969,
  ],
};

function ghiToZone(ghi_yr: number): ClimateZone {
  if (ghi_yr <= 1700) return 1;
  if (ghi_yr <= 1950) return 2;
  if (ghi_yr <= 2150) return 3;
  if (ghi_yr <= 2350) return 4;
  return 5;
}

// ─── 58 Wilayas (GHI in kWh/m²/year) ───────────────────────────────────────
interface Wilaya {
  id: number;
  name: string;
  ghi_yr: number;
}
const WILAYAS: Wilaya[] = [
  { id: 1, name: "Adrar", ghi_yr: 2350 },
  { id: 2, name: "Chlef", ghi_yr: 1750 },
  { id: 3, name: "Laghouat", ghi_yr: 2150 },
  { id: 4, name: "Oum El Bouaghi", ghi_yr: 1850 },
  { id: 5, name: "Batna", ghi_yr: 1950 },
  { id: 6, name: "Béjaïa", ghi_yr: 1650 },
  { id: 7, name: "Biskra", ghi_yr: 2100 },
  { id: 8, name: "Béchar", ghi_yr: 2300 },
  { id: 9, name: "Blida", ghi_yr: 1700 },
  { id: 10, name: "Bouira", ghi_yr: 1750 },
  { id: 11, name: "Tamanrasset", ghi_yr: 2500 },
  { id: 12, name: "Tébessa", ghi_yr: 1900 },
  { id: 13, name: "Tlemcen", ghi_yr: 1850 },
  { id: 14, name: "Tiaret", ghi_yr: 1900 },
  { id: 15, name: "Tizi Ouzou", ghi_yr: 1680 },
  { id: 16, name: "Alger", ghi_yr: 1700 },
  { id: 17, name: "Djelfa", ghi_yr: 2050 },
  { id: 18, name: "Jijel", ghi_yr: 1620 },
  { id: 19, name: "Sétif", ghi_yr: 1900 },
  { id: 20, name: "Saïda", ghi_yr: 1950 },
  { id: 21, name: "Skikda", ghi_yr: 1600 },
  { id: 22, name: "Sidi Bel Abbès", ghi_yr: 1880 },
  { id: 23, name: "Annaba", ghi_yr: 1650 },
  { id: 24, name: "Guelma", ghi_yr: 1750 },
  { id: 25, name: "Constantine", ghi_yr: 1800 },
  { id: 26, name: "Médéa", ghi_yr: 1820 },
  { id: 27, name: "Mostaganem", ghi_yr: 1780 },
  { id: 28, name: "M'Sila", ghi_yr: 2000 },
  { id: 29, name: "Mascara", ghi_yr: 1850 },
  { id: 30, name: "Ouargla", ghi_yr: 2300 },
  { id: 31, name: "Oran", ghi_yr: 1820 },
  { id: 32, name: "El Bayadh", ghi_yr: 2200 },
  { id: 33, name: "Illizi", ghi_yr: 2450 },
  { id: 34, name: "Bordj Bou Arréridj", ghi_yr: 1880 },
  { id: 35, name: "Boumerdès", ghi_yr: 1680 },
  { id: 36, name: "El Tarf", ghi_yr: 1620 },
  { id: 37, name: "Tindouf", ghi_yr: 2400 },
  { id: 38, name: "Tissemsilt", ghi_yr: 1800 },
  { id: 39, name: "El Oued", ghi_yr: 2250 },
  { id: 40, name: "Khenchela", ghi_yr: 1920 },
  { id: 41, name: "Souk Ahras", ghi_yr: 1780 },
  { id: 42, name: "Tipaza", ghi_yr: 1720 },
  { id: 43, name: "Mila", ghi_yr: 1760 },
  { id: 44, name: "Aïn Defla", ghi_yr: 1780 },
  { id: 45, name: "Naâma", ghi_yr: 2200 },
  { id: 46, name: "Aïn Témouchent", ghi_yr: 1850 },
  { id: 47, name: "Ghardaïa", ghi_yr: 2250 },
  { id: 48, name: "Relizane", ghi_yr: 1820 },
  { id: 49, name: "El M'Ghair", ghi_yr: 2150 },
  { id: 50, name: "El Meniaa", ghi_yr: 2300 },
  { id: 51, name: "Ouled Djellal", ghi_yr: 2120 },
  { id: 52, name: "Bordj Baji Mokhtar", ghi_yr: 2450 },
  { id: 53, name: "Béni Abbès", ghi_yr: 2350 },
  { id: 54, name: "Timimoun", ghi_yr: 2380 },
  { id: 55, name: "Touggourt", ghi_yr: 2280 },
  { id: 56, name: "Djanet", ghi_yr: 2480 },
  { id: 57, name: "In Salah", ghi_yr: 2450 },
  { id: 58, name: "In Guezzam", ghi_yr: 2500 },
];

// ─── Auto-sizing from gross rooftop area (Eqs 1-3 + CAPEX Eq.18) ─────────────
function autoSize(grossArea: number, ghiYr: number) {
  const ghi_daily = ghiYr / 365; // kWh/m²/day
  const a_available = grossArea * SF; // Eq.1
  const n_modules = Math.floor(a_available / A_MODULE); // Eq.2
  const p_installed = parseFloat(((n_modules * P_UNIT) / 1000).toFixed(2)); // Eq.3 kWp
  const n_inverters = Math.max(1, Math.ceil(p_installed / 50));
  // Eq.18 — CAPEX estimate
  const c_modules = n_modules * 9_500;
  const c_inverters = n_inverters * 2_200_000;
  const c_structure = p_installed * 4_500;
  const c_cabling = 1_200_000;
  const c_transform = 800_000;
  const c_labor = p_installed * 3_500;
  const c_eng = 650_000;
  const subtotal =
    c_modules +
    c_inverters +
    c_structure +
    c_cabling +
    c_transform +
    c_labor +
    c_eng;
  const capex = Math.round(subtotal * 1.05);
  return {
    a_available,
    n_modules,
    p_installed,
    n_inverters,
    ghi_daily,
    c_modules,
    c_inverters,
    c_structure,
    c_cabling,
    c_transform,
    c_labor,
    c_eng,
    capex,
  };
}

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface LocationParams {
  wilaya_id: number;
  building_name: string;
  building_address: string;
  gross_area: number; // m²
}
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
  status: "empty" | "processing" | "done";
  data: BillData | null;
  edited: BillData | null;
  ocrWarn: string;
}
interface SystemParams {
  p_installed: number;
  n_modules: number;
  n_inverters: number;
  module_brand: string;
  module_model: string;
  module_power: number;
  inverter_brand: string;
  tilt: number;
  orientation: string;
  pr: number;
  a_available: number;
  c_modules: number;
  c_inverters: number;
  c_structure: number;
  c_cabling: number;
  c_transform: number;
  c_labor: number;
  c_eng: number;
}
interface FinancialParams {
  r: number;
  f: number;
  D: number;
  om_rate: number;
  DS: number;
  subsidy_rate: number;
}
interface MonthlyDetail {
  m: number;
  ghi_daily: number;
  t_amb: number;
  t_cell: number;
  pr_temp: number;
  pr_soiling: number;
  pr_total: number;
  e_pv: number;
  e_cons: number;
  sc: number;
  exported_m: number;
  scr_m: number;
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
  // Sizing
  a_available: number;
  // Production (Eqs 4-9)
  e_annual: number;
  fleh: number;
  monthly: MonthlyDetail[];
  monthly_pv: number[];
  monthly_cons: number[];
  monthly_sc: number[];
  monthly_scr: number[];
  // SCR (Eqs 13-17)
  scr: number;
  e_self_yr1: number;
  exported: number;
  ssr: number;
  // Invoices (Eqs 10-12)
  t0: number;
  total_da: number;
  total_kwh: number;
  // Financials (Eqs 20-32)
  capex: number;
  capex_sc2: number;
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
  // Environmental (Eqs 33-35)
  co2_yr1: number;
  co2_25yr: number;
  nm_revenue: number;
  trees_equiv: number;
  vehicles_equiv: number;
}

// ─── IRR bisection ─────────────────────────────────────────────────────────────
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
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    npv(mid) > 0 ? (lo = mid) : (hi = mid);
  }
  return (lo + hi) / 2;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN CALCULATION ENGINE — All 35 Equations
// ─────────────────────────────────────────────────────────────────────────────
function runStudy(
  loc: LocationParams,
  bills: BillSlot[],
  sys: SystemParams,
  fin: FinancialParams,
): StudyResults {
  const wilaya = WILAYAS.find((w) => w.id === loc.wilaya_id) ?? WILAYAS[6];
  const zone = ghiToZone(wilaya.ghi_yr);
  const ghi_yr = wilaya.ghi_yr;
  const ghi_day = ghi_yr / 365; // kWh/m²/day
  const fracs = ZONE_FRACS[zone];
  const t_ambs = ZONE_TEMPS[zone];
  const soilings = ZONE_SOILING[zone];
  const a_avail = parseFloat((loc.gross_area * SF).toFixed(2)); // Eq.1

  // ── Eqs 4-5: Annual production ─────────────────────────────────────────────
  const pr_base = sys.pr / 100;
  const e_annual = sys.p_installed * ghi_day * pr_base * 365; // Eq.4
  const fleh = e_annual / sys.p_installed; // Eq.5

  // ── Eqs 6-9: Monthly production with temperature-corrected PR ──────────────
  const monthly_detail: MonthlyDetail[] = [];
  const monthly_pv: number[] = [];

  for (let m = 0; m < 12; m++) {
    const ghi_m_daily = ghi_day * fracs[m] * 12; // daily avg for month
    const t_amb = t_ambs[m];
    const t_cell = t_amb + ((NOCT - 20) * ghi_m_daily) / 0.8; // Eq.6
    const pr_temp = 1 + GAMMA * (t_cell - 25); // Eq.7
    const pr_soiling = soilings[m];
    const pr_total =
      pr_temp * pr_soiling * PR_INV * PR_WIRING * PR_MISMATCH * PR_AVAIL; // Eq.8
    const ghi_m_total = ghi_yr * fracs[m]; // total kWh/m² for month
    const e_pv = Math.round(sys.p_installed * ghi_m_total * pr_total); // Eq.9
    monthly_pv.push(e_pv);
    monthly_detail.push({
      m,
      ghi_daily: parseFloat(ghi_m_daily.toFixed(3)),
      t_amb,
      t_cell: parseFloat(t_cell.toFixed(1)),
      pr_temp: parseFloat((pr_temp * 100).toFixed(1)),
      pr_soiling,
      pr_total: parseFloat((pr_total * 100).toFixed(1)),
      e_pv,
      e_cons: 0,
      sc: 0,
      exported_m: 0,
      scr_m: 0,
    });
  }

  // ── Eqs 10-12: Invoice analysis ────────────────────────────────────────────
  const monthly_cons = new Array(12).fill(0);
  let total_da = 0,
    total_kwh = 0;
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
      monthly_cons[idx] = Math.max(monthly_cons[idx], cons); // Eq.11
      total_da += d.total_da || 0;
      total_kwh += cons;
    });
  const filled = monthly_cons.filter((v) => v > 0);
  const avgCons =
    filled.length > 0
      ? filled.reduce((a, b) => a + b, 0) / filled.length
      : 10000;
  const monthly_cons_f = monthly_cons.map((v) => (v > 0 ? v : avgCons));
  const t0 = total_kwh > 0 ? total_da / total_kwh : 4.8018; // Eq.10 (weighted tariff)

  // ── Eqs 13-17: SCR per month ───────────────────────────────────────────────
  const monthly_sc: number[] = [];
  const monthly_scr: number[] = [];
  for (let m = 0; m < 12; m++) {
    const sc = Math.round(Math.min(monthly_pv[m], monthly_cons_f[m])); // Eq.13
    monthly_sc.push(sc);
    monthly_scr.push(
      monthly_pv[m] > 0 ? Math.round((sc / monthly_pv[m]) * 100) : 0,
    );
    monthly_detail[m].e_cons = Math.round(monthly_cons_f[m]);
    monthly_detail[m].sc = sc;
    monthly_detail[m].exported_m = Math.max(
      0,
      Math.round(monthly_pv[m] - monthly_cons_f[m]),
    );
    monthly_detail[m].scr_m = monthly_scr[m];
  }
  const e_self_yr1 = monthly_sc.reduce((a, b) => a + b, 0); // Eq.15
  const scr = parseFloat(((e_self_yr1 / e_annual) * 100).toFixed(2)); // Eq.14
  const exported = Math.round(
    monthly_pv.reduce((a, b) => a + b, 0) - e_self_yr1,
  ); // Eq.16
  const e_cons_annual = monthly_cons_f.reduce((a, b) => a + b, 0);
  const ssr = parseFloat(((e_self_yr1 / e_cons_annual) * 100).toFixed(2)); // Eq.17

  // ── Eq.19: O&M ─────────────────────────────────────────────────────────────
  const capex_total =
    sys.c_modules +
    sys.c_inverters +
    sys.c_structure +
    sys.c_cabling +
    sys.c_transform +
    sys.c_labor +
    sys.c_eng;
  const capex = Math.round(capex_total * 1.05); // Eq.18 (with 5% contingency)
  const om_annual = Math.round(capex * (fin.om_rate / 100)); // Eq.19

  // ── Eqs 20-23: Year-1 financials ──────────────────────────────────────────
  const yr1_energy_savings = Math.round(e_self_yr1 * t0); // Eq.20
  const yr1_gross_savings = Math.round(yr1_energy_savings + fin.DS); // Eq.21
  const yr1_net_cf = Math.round(yr1_gross_savings - om_annual); // Eq.22
  const capex_sc2 = Math.round(capex * (1 - fin.subsidy_rate / 100)); // Eq.32
  const spp_sc1 = parseFloat((capex / yr1_gross_savings).toFixed(1)); // Eq.23
  const spp_sc2 = parseFloat((capex_sc2 / yr1_gross_savings).toFixed(1));

  // ── Eqs 24-29: 25-yr DCF ──────────────────────────────────────────────────
  const D_dec = fin.D / 100,
    r_dec = fin.r / 100,
    f_dec = fin.f / 100;
  let cum_sc1 = -capex;
  const dcf_table: DCFRow[] = [];
  const cashflows: number[] = [];
  let dpp_sc1: number | null = null;
  for (let n = 1; n <= 25; n++) {
    const e_self_n = e_self_yr1 * Math.pow(1 - D_dec, n - 1); // Eq.24
    const t_n = t0 * Math.pow(1 + f_dec, n - 1); // Eq.25
    const energy_savings = e_self_n * t_n;
    const gross_savings = energy_savings + fin.DS; // Eq.26 (DS NEVER inflated)
    const net_cf = gross_savings - om_annual;
    const dcf = net_cf / Math.pow(1 + r_dec, n);
    cashflows.push(net_cf);
    cum_sc1 += dcf;
    if (cum_sc1 >= 0 && dpp_sc1 === null) dpp_sc1 = n; // Eq.29
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
  const subsidy_offset = capex * (fin.subsidy_rate / 100);
  let dpp_sc2: number | null = null;
  dcf_table.forEach((row) => {
    row.cum_sc2 = Math.round(row.cum_sc1 + subsidy_offset);
    if (row.cum_sc2 >= 0 && dpp_sc2 === null) dpp_sc2 = row.year;
  });
  const npv_sc1 = Math.round(cum_sc1); // Eq.27
  const npv_sc2 = Math.round(npv_sc1 + subsidy_offset);
  const irr_sc1 = parseFloat((calcIRR(cashflows, capex) * 100).toFixed(2)); // Eq.28
  const irr_sc2 = parseFloat((calcIRR(cashflows, capex_sc2) * 100).toFixed(2));
  const pi_sc1 = parseFloat((1 + npv_sc1 / capex).toFixed(3)); // Eq.31
  const pi_sc2 = parseFloat((1 + npv_sc2 / capex_sc2).toFixed(3));

  // ── Eq.30: LCOE ───────────────────────────────────────────────────────────
  let pv_om = 0,
    pv_energy = 0;
  for (let n = 1; n <= 25; n++) {
    pv_om += om_annual / Math.pow(1 + r_dec, n);
    pv_energy +=
      (e_annual * Math.pow(1 - D_dec, n - 1)) / Math.pow(1 + r_dec, n);
  }
  const lcoe = parseFloat(((capex + pv_om) / pv_energy).toFixed(2));

  // ── Eqs 33-35: Environmental + Net Metering ───────────────────────────────
  const co2_yr1 = parseFloat(((e_annual * CO2_FACTOR) / 1000).toFixed(1)); // Eq.33
  let co2_25yr = 0;
  for (let n = 0; n < 25; n++)
    co2_25yr += (e_annual * Math.pow(1 - D_dec, n) * CO2_FACTOR) / 1000; // Eq.34
  const nm_revenue = Math.round(exported * NM_TARIFF); // Eq.35
  const trees_equiv = Math.round(co2_yr1 * TREES_TCO2);
  const vehicles_equiv = Math.round(co2_yr1 / VEHI_TCO2);

  return {
    a_available: a_avail,
    e_annual: Math.round(e_annual),
    fleh: Math.round(fleh),
    monthly: monthly_detail,
    monthly_pv,
    monthly_cons: monthly_cons_f.map(Math.round),
    monthly_sc,
    monthly_scr,
    scr,
    e_self_yr1: Math.round(e_self_yr1),
    exported,
    ssr,
    t0: parseFloat(t0.toFixed(4)),
    total_da: Math.round(total_da),
    total_kwh: Math.round(total_kwh),
    capex,
    capex_sc2,
    om_annual,
    yr1_energy_savings,
    yr1_gross_savings,
    yr1_net_cf,
    spp_sc1,
    spp_sc2,
    npv_sc1,
    npv_sc2,
    irr_sc1,
    irr_sc2,
    dpp_sc1,
    dpp_sc2,
    pi_sc1,
    pi_sc2,
    lcoe,
    dcf_table,
    co2_yr1,
    co2_25yr: Math.round(co2_25yr),
    nm_revenue,
    trees_equiv,
    vehicles_equiv,
  };
}

// ─── Canvas chart helpers ─────────────────────────────────────────────────────
function makeBarChart(
  v1: number[],
  v2: number[] | null,
  labels: string[],
  w: number,
  h: number,
  c1 = C.gold,
  c2 = C.navy,
  title = "",
): string {
  const cvs = document.createElement("canvas");
  cvs.width = w;
  cvs.height = h;
  const ctx = cvs.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const pad = { t: title ? 32 : 14, r: 16, b: 38, l: 60 };
  const cw = w - pad.l - pad.r,
    ch = h - pad.t - pad.b;
  const all = [...v1, ...(v2 || [])];
  const maxV = (Math.max(...all) || 1) * 1.15;
  const gw = cw / v1.length,
    bw = gw * (v2 ? 0.38 : 0.62);
  if (title) {
    ctx.fillStyle = "#374151";
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "center";
    ctx.fillText(title, w / 2, 18);
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
  v1.forEach((v, i) => {
    const x = pad.l + i * gw,
      bh = (v / maxV) * ch;
    ctx.fillStyle = c1;
    ctx.fillRect(x + (v2 ? gw * 0.06 : (gw - bw) / 2), pad.t + ch - bh, bw, bh);
    if (v2) {
      const bh2 = (v2[i] / maxV) * ch;
      ctx.fillStyle = c2;
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
  d1: number[],
  d2: number[],
  labels: string[],
  w: number,
  h: number,
): string {
  const cvs = document.createElement("canvas");
  cvs.width = w;
  cvs.height = h;
  const ctx = cvs.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const pad = { t: 34, r: 22, b: 42, l: 76 };
  const cw = w - pad.l - pad.r,
    ch = h - pad.t - pad.b;
  const all = [...d1, ...d2];
  const minV = Math.min(...all) * (Math.min(...all) < 0 ? 1.1 : 0.9);
  const maxV = Math.max(...all) * 1.1;
  const range = maxV - minV || 1;
  const gx = (i: number) => pad.l + (i / (d1.length - 1)) * cw;
  const gy = (v: number) => pad.t + ch - ((v - minV) / range) * ch;
  if (minV < 0 && maxV > 0) {
    const zy = gy(0);
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
    const v = minV + (range * i) / 4,
      y = gy(v);
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + cw, y);
    ctx.stroke();
    ctx.fillStyle = "#9ca3af";
    ctx.font = "9px Arial";
    ctx.textAlign = "right";
    ctx.fillText(
      Math.abs(v) >= 1e6
        ? (v / 1e6).toFixed(1) + "M"
        : Math.round(v / 1000) + "k",
      pad.l - 4,
      y + 3,
    );
  }
  const drawL = (data: number[], color: string, dash = false) => {
    if (dash) ctx.setLineDash([6, 3]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    data.forEach((v, i) =>
      i === 0 ? ctx.moveTo(gx(i), gy(v)) : ctx.lineTo(gx(i), gy(v)),
    );
    ctx.stroke();
    ctx.setLineDash([]);
  };
  drawL(d1, C.gold);
  drawL(d2, C.blue, true);
  ctx.fillStyle = "#374151";
  ctx.font = "9px Arial";
  ctx.textAlign = "center";
  labels.forEach((l, i) => {
    if (i % 5 === 0 || i === labels.length - 1)
      ctx.fillText(l, gx(i), h - pad.b + 14);
  });
  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + ch);
  ctx.lineTo(pad.l + cw, pad.t + ch);
  ctx.stroke();
  ctx.fillStyle = C.gold;
  ctx.fillRect(pad.l, 8, 16, 7);
  ctx.fillStyle = "#374151";
  ctx.font = "9px Arial";
  ctx.textAlign = "left";
  ctx.fillText("Sc1 (sans subvention)", pad.l + 20, 15);
  ctx.fillStyle = C.blue;
  ctx.fillRect(pad.l + 145, 8, 16, 7);
  ctx.fillText("Sc2 (avec subvention)", pad.l + 165, 15);
  return cvs.toDataURL("image/png");
}

// ─── PDF Report Generator (9 pages) ──────────────────────────────────────────
function generatePDF(
  res: StudyResults,
  loc: LocationParams,
  sys: SystemParams,
  fin: FinancialParams,
) {
  const wilaya = WILAYAS.find((w) => w.id === loc.wilaya_id) ?? WILAYAS[6];
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth(),
    PH = doc.internal.pageSize.getHeight();
  const NAVY = [12, 19, 34] as [number, number, number];
  const NAVY2 = [21, 32, 53] as [number, number, number];
  const CREAM = [245, 237, 214] as [number, number, number];
  const GOLD = [212, 168, 67] as [number, number, number];
  const GRAY = [100, 110, 130] as [number, number, number];
  const WHITE = [238, 240, 244] as [number, number, number];
  const fmt = (n: number) => Math.round(n).toLocaleString("fr-DZ");
  const fDA = (n: number) => fmt(n) + " DA";
  let pn = 1;
  const addPage = () => {
    doc.addPage();
    pn++;
    doc.setFillColor(...GOLD);
    doc.rect(0, 0, PW, 1.8, "F");
    doc.setFillColor(...NAVY);
    doc.rect(0, 1.8, PW, 7.5, "F");
    doc.setFontSize(7);
    doc.setTextColor(...CREAM);
    doc.text(
      `SolarAnalytics.dz  |  ${loc.building_name}  |  ${wilaya.name}  |  Page ${pn}`,
      PW / 2,
      6.8,
      { align: "center" },
    );
    doc.setDrawColor(200, 200, 200);
    doc.line(10, 9.5, PW - 10, 9.5);
  };
  const hLine = (y: number, label: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text(label, 14, y);
    doc.setFillColor(...GOLD);
    doc.rect(14, y + 1.5, 40, 0.7, "F");
  };

  // ── Cover ─────────────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PW, PH, "F");
  doc.setFillColor(...GOLD);
  doc.rect(0, 0, 7, PH, "F");
  doc.setFillColor(...NAVY2);
  doc.rect(7, PH - 55, PW - 7, 55, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...GOLD);
  doc.text("SolarAnalytics.dz", 22, 36);
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...WHITE);
  doc.text("Etude de Faisabilite Technico-Economique", 22, 47);
  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  doc.text(
    "Systeme Photovoltaique Connecte au Reseau  —  IEC 61724-1:2021",
    22,
    55,
  );
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  doc.line(22, 60, PW - 22, 60);
  [
    ["Projet", loc.building_name],
    ["Adresse", loc.building_address],
    [
      "Wilaya / GHI",
      `${wilaya.name}  —  ${wilaya.ghi_yr} kWh/m²/an  (${(wilaya.ghi_yr / 365).toFixed(2)} kWh/m²/j)`,
    ],
    [
      "Systeme",
      `${sys.p_installed} kWp — ${sys.n_modules} modules — ${sys.n_inverters} onduleurs`,
    ],
    [
      "Surface",
      `${loc.gross_area} m² brute → ${res.a_available} m² nette (SF=0.70)`,
    ],
    [
      "Date",
      new Date().toLocaleDateString("fr-FR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    ],
  ].forEach(([k, v], i) => {
    const y = 70 + i * 9;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...GOLD);
    doc.text(k + ":", 22, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...WHITE);
    doc.text(v, 58, y);
  });
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
    const x = 22 + i * 46;
    doc.setFillColor(29, 45, 74);
    doc.roundedRect(x, 125, 42, 22, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    if (k.ok) {
      doc.setTextColor(...GOLD);
    } else {
      doc.setTextColor(239, 68, 68);
    }
    doc.text(k.v, x + 21, 134, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(k.l, x + 21, 140, { align: "center" });
  });
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  doc.text(
    "SCR mensuel reel: min(E_PV,m,E_cons,m) | T0 pondere: Σ(DA)/Σ(kWh) | DS FIXE non indexe",
    22,
    152,
  );
  doc.text(
    "Equations 1-35 implementees | Toutes les 58 wilayas | Reference: PRD Biskra 2025-2026",
    22,
    158,
  );
  doc.setFontSize(7);
  doc.setTextColor(70, 80, 100);
  doc.text("(c) SolarAnalytics.dz — Document Confidentiel", PW / 2, PH - 8, {
    align: "center",
  });

  // ── P2: Resume Executif ───────────────────────────────────────────────────
  addPage();
  hLine(20, "Resume Executif");
  autoTable(doc, {
    startY: 27,
    head: [
      ["Indicateur", "Sc1 — Sans subvention", "Sc2 — Avec subvention", "Unite"],
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
        "Delai Recup. Simple (DRS)",
        `${res.spp_sc1} ans`,
        `${res.spp_sc2} ans`,
        "ans",
      ],
      [
        "Delai Recup. Actualise (DRA)",
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
      ["LCOE", res.lcoe.toFixed(2), res.lcoe.toFixed(2), "DA/kWh"],
      ["CAPEX", fDA(res.capex), fDA(res.capex_sc2), "DA"],
      [
        "Economies An 1 (brutes)",
        fDA(res.yr1_gross_savings),
        fDA(res.yr1_gross_savings),
        "DA/an",
      ],
    ],
    headStyles: {
      fillColor: NAVY,
      textColor: CREAM,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
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
      [
        "Surface brute / nette (SF=0.70)",
        `${loc.gross_area} / ${res.a_available} m²`,
        "m²",
      ],
      ["Production annuelle (Eq.4)", fmt(res.e_annual), "kWh/an"],
      ["FLEH (Eq.5)", fmt(res.fleh), "h/an"],
      ["SCR annuel calcule (Eq.14)", `${res.scr}%`, ""],
      ["Taux Autosuffisance SSR (Eq.17)", `${res.ssr}%`, ""],
      ["Energie autoconsommee An 1", fmt(res.e_self_yr1), "kWh/an"],
      ["Surplus exporte (Eq.16)", fmt(res.exported), "kWh/an"],
      ["Tarif pondere T0 (Eq.10)", res.t0.toFixed(4), "DA/kWh"],
      ["CO2 evite An 1 (Eq.33)", `${res.co2_yr1} t`, "tCO2/an"],
      ["Revenus comptage net (Eq.35)", fDA(res.nm_revenue), "DA/an"],
    ],
    headStyles: {
      fillColor: CREAM,
      textColor: NAVY,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "center" } },
  });

  // ── P3: Dimensionnement (Eqs 1-3) ────────────────────────────────────────
  addPage();
  hLine(20, "Dimensionnement du Systeme (Equations 1-3)");
  autoTable(doc, {
    startY: 27,
    head: [["Etape", "Equation", "Valeur", "Remarque"]],
    body: [
      [
        "Eq.1 — Surface nette",
        "A_avail = A_brute × SF",
        `${loc.gross_area} × 0.70 = ${res.a_available} m²`,
        "SF = 0.70 (setbacks + espacement)",
      ],
      [
        "Eq.2 — Nb. modules",
        "N = floor(A_avail / 1.940)",
        `${res.a_available} / 1.940 = ${sys.n_modules}`,
        "Jinko JKM 370M-72, empreinte = 1.940 m²",
      ],
      [
        "Eq.3 — Puissance",
        "P = N × 370.3 / 1000",
        `${sys.n_modules} × 370.3 / 1000 = ${sys.p_installed} kWp`,
        "Puissance STC par module",
      ],
      [
        "Eq.4 — Production",
        "E = P × GHI_j × PR × 365",
        `${sys.p_installed} × ${(wilaya.ghi_yr / 365).toFixed(2)} × ${sys.pr / 100} × 365 = ${fmt(res.e_annual)} kWh`,
        "GHI Wilaya ${wilaya.name}",
      ],
      [
        "Eq.5 — FLEH",
        "FLEH = E / P",
        `${fmt(res.e_annual)} / ${sys.p_installed} = ${res.fleh} h/an`,
        "Heures pleine charge",
      ],
    ],
    headStyles: {
      fillColor: NAVY,
      textColor: CREAM,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
  });
  const y3 = (doc as any).lastAutoTable.finalY + 6;
  hLine(y3, "CAPEX Detaille (Equation 18)");
  const subtotal =
    sys.c_modules +
    sys.c_inverters +
    sys.c_structure +
    sys.c_cabling +
    sys.c_transform +
    sys.c_labor +
    sys.c_eng;
  autoTable(doc, {
    startY: y3 + 8,
    head: [["Composant", "Calcul", "Montant (DA)", "% CAPEX"]],
    body: [
      [
        "Modules PV",
        `${sys.n_modules} × 9 500`,
        fDA(sys.c_modules),
        ((sys.c_modules / res.capex) * 100).toFixed(1) + "%",
      ],
      [
        "Onduleurs",
        `${sys.n_inverters} × 2 200 000`,
        fDA(sys.c_inverters),
        ((sys.c_inverters / res.capex) * 100).toFixed(1) + "%",
      ],
      [
        "Structures aluminium",
        `${sys.p_installed} kWp × 4 500`,
        fDA(sys.c_structure),
        ((sys.c_structure / res.capex) * 100).toFixed(1) + "%",
      ],
      [
        "Cablage & protection",
        "Forfait",
        fDA(sys.c_cabling),
        ((sys.c_cabling / res.capex) * 100).toFixed(1) + "%",
      ],
      [
        "Raccordement HTA",
        "Forfait",
        fDA(sys.c_transform),
        ((sys.c_transform / res.capex) * 100).toFixed(1) + "%",
      ],
      [
        "Main d'oeuvre",
        `${sys.p_installed} kWp × 3 500`,
        fDA(sys.c_labor),
        ((sys.c_labor / res.capex) * 100).toFixed(1) + "%",
      ],
      [
        "Etudes & permis",
        "Forfait",
        fDA(sys.c_eng),
        ((sys.c_eng / res.capex) * 100).toFixed(1) + "%",
      ],
      [
        "Contingences (5%)",
        "5% × sous-total",
        fDA(Math.round(subtotal * 0.05)),
        "5.0%",
      ],
    ],
    foot: [["CAPEX TOTAL", "", "" + fDA(res.capex), "100%"]],
    headStyles: {
      fillColor: NAVY,
      textColor: CREAM,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    footStyles: {
      fillColor: GOLD,
      textColor: NAVY,
      fontStyle: "bold",
      fontSize: 8,
    },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
  });

  // ── P4: Production mensuelle (Eqs 6-9) ───────────────────────────────────
  addPage();
  hLine(20, "Production Mensuelle — Temperature Corrigee (Equations 6-9)");
  autoTable(doc, {
    startY: 27,
    head: [
      [
        "Mois",
        "GHI/j",
        "T_amb",
        "T_cell (Eq.6)",
        "PR_temp (Eq.7)",
        "PR_soiling",
        "PR_total (Eq.8)",
        "E_PV (Eq.9) kWh",
      ],
    ],
    body: res.monthly.map((r, i) => [
      M_FULL[i],
      r.ghi_daily.toFixed(2) + "  kWh/m²",
      r.t_amb + "°C",
      r.t_cell + "°C",
      r.pr_temp + "%",
      (r.pr_soiling * 100).toFixed(1) + "%",
      r.pr_total + "%",
      fmt(r.e_pv),
    ]),
    foot: [
      [
        "ANNUEL",
        `${(wilaya.ghi_yr / 365).toFixed(2)} moy`,
        "—",
        "—",
        `${(res.monthly.reduce((s, r) => s + r.pr_temp, 0) / 12).toFixed(1)}%`,
        "—",
        `${(res.monthly.reduce((s, r) => s + r.pr_total, 0) / 12).toFixed(1)}%`,
        fmt(res.e_annual),
      ],
    ],
    headStyles: {
      fillColor: NAVY,
      textColor: CREAM,
      fontStyle: "bold",
      fontSize: 6.5,
    },
    bodyStyles: { fontSize: 7.5 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    footStyles: {
      fillColor: GOLD,
      textColor: NAVY,
      fontStyle: "bold",
      fontSize: 7.5,
    },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
    },
  });

  // ── P5: SCR mensuel (Eqs 13-17) + Factures (Eqs 10-12) ───────────────────
  addPage();
  hLine(20, "Bilan Energetique & SCR (Equations 10-17)");
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(
    `T0 pondere (Eq.10): ${res.t0} DA/kWh  |  Total: ${fmt(res.total_da)} DA / ${fmt(res.total_kwh)} kWh  |  SCR annuel (Eq.14): ${res.scr}%  |  SSR (Eq.17): ${res.ssr}%`,
    14,
    29,
  );
  autoTable(doc, {
    startY: 33,
    head: [
      [
        "Mois",
        "E_PV (kWh)",
        "E_Cons (kWh)",
        "SC (kWh) Eq.13",
        "Surplus (kWh) Eq.16",
        "SCR% Eq.13",
        "SSR%",
      ],
    ],
    body: res.monthly.map((r, i) => [
      M_FULL[i],
      fmt(r.e_pv),
      fmt(r.e_cons),
      fmt(r.sc),
      r.exported_m > 0 ? fmt(r.exported_m) : "—",
      r.scr_m + "%",
      r.e_cons > 0
        ? Math.min(100, Math.round((r.sc / r.e_cons) * 100)) + "%"
        : "—",
    ]),
    foot: [
      [
        "ANNUEL",
        fmt(res.e_annual),
        fmt(res.monthly_cons.reduce((a, b) => a + b, 0)),
        fmt(res.e_self_yr1),
        fmt(res.exported),
        `${res.scr}%`,
        `${res.ssr}%`,
      ],
    ],
    headStyles: {
      fillColor: NAVY,
      textColor: CREAM,
      fontStyle: "bold",
      fontSize: 7,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    footStyles: {
      fillColor: GOLD,
      textColor: NAVY,
      fontStyle: "bold",
      fontSize: 8,
    },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
    },
  });
  const y5 = (doc as any).lastAutoTable.finalY + 4;
  if (y5 < PH - 58) {
    const img = makeBarChart(
      res.monthly_pv,
      res.monthly_cons,
      M_SHORT,
      540,
      160,
      C.gold,
      "#2c4a7a",
      "Production PV vs Consommation — kWh/mois",
    );
    doc.addImage(img, "PNG", 14, y5, PW - 28, 47);
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(
      `SCR=${res.scr}%  |  Auto-consomme: ${fmt(res.e_self_yr1)} kWh  |  Exporte: ${fmt(res.exported)} kWh  |  T0=${res.t0} DA/kWh`,
      14,
      y5 + 51,
    );
  }

  // ── P6: Financiers (Eqs 20-32) ────────────────────────────────────────────
  addPage();
  hLine(20, "Resultats Financiers (Equations 20-32)");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text(
    `CAPEX=${fDA(res.capex)} | T0=${res.t0} DA/kWh | r=${fin.r}% | f=${fin.f}% | D=${fin.D}%/an | O&M=${fin.om_rate}% | DS=${fDA(fin.DS)}/an FIXE | Sc2=${fin.subsidy_rate}%`,
    14,
    28,
  );
  autoTable(doc, {
    startY: 33,
    head: [
      [
        "Indicateur",
        "Equation",
        "Sc1 — Sans subvention",
        "Sc2 — Avec subvention",
        "Delta",
      ],
    ],
    body: [
      [
        "CAPEX Net",
        "—",
        fDA(res.capex),
        fDA(res.capex_sc2),
        `-${fDA(res.capex - res.capex_sc2)}`,
      ],
      [
        "Eco. Energie An 1",
        "Eq.20",
        fDA(res.yr1_energy_savings),
        fDA(res.yr1_energy_savings),
        "—",
      ],
      ["+ Eco. Demande DS", "Eq.21", fDA(fin.DS), fDA(fin.DS), "FIXE"],
      [
        "= Economies Brutes An 1",
        "Eq.21",
        fDA(res.yr1_gross_savings),
        fDA(res.yr1_gross_savings),
        "—",
      ],
      ["Flux Net An 1", "Eq.22", fDA(res.yr1_net_cf), fDA(res.yr1_net_cf), "—"],
      [
        "DRS (Simple Payback)",
        "Eq.23",
        `${res.spp_sc1} ans`,
        `${res.spp_sc2} ans`,
        `-${(res.spp_sc1 - res.spp_sc2).toFixed(1)} ans`,
      ],
      [
        "DRA (Actualise)",
        "Eq.29",
        `${res.dpp_sc1 ?? ">25"} ans`,
        `${res.dpp_sc2 ?? ">25"} ans`,
        res.dpp_sc1 && res.dpp_sc2 ? `-${res.dpp_sc1 - res.dpp_sc2} ans` : "—",
      ],
      [
        "VAN (25 ans)",
        "Eq.27",
        fDA(res.npv_sc1),
        fDA(res.npv_sc2),
        `+${fDA(res.npv_sc2 - res.npv_sc1)}`,
      ],
      [
        "TRI",
        "Eq.28",
        `${res.irr_sc1}%`,
        `${res.irr_sc2}%`,
        `+${(res.irr_sc2 - res.irr_sc1).toFixed(2)}%`,
      ],
      [
        "IP (Indice Profit.)",
        "Eq.31",
        res.pi_sc1.toFixed(3),
        res.pi_sc2.toFixed(3),
        `+${(res.pi_sc2 - res.pi_sc1).toFixed(3)}`,
      ],
      ["LCOE", "Eq.30", `${res.lcoe} DA/kWh`, `${res.lcoe} DA/kWh`, "—"],
    ],
    headStyles: {
      fillColor: NAVY,
      textColor: CREAM,
      fontStyle: "bold",
      fontSize: 7.5,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
    },
  });

  // ── P7: DCF 25 ans (Eqs 24-29) ────────────────────────────────────────────
  addPage();
  hLine(20, "Tableau DCF — 25 ans (Equations 24-29)");
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  doc.text(
    "E_n=E_self×(1-D)^(n-1) Eq.24 | T_n=T0×(1+f)^(n-1) Eq.25 | CF=E_n×T_n+DS-OM Eq.26 | DCF=CF/(1+r)^n Eq.27",
    14,
    28,
  );
  autoTable(doc, {
    startY: 33,
    head: [
      [
        "An",
        "E_self(kWh)",
        "T_n(DA/kWh)",
        "Eco.Energ",
        "DS",
        "Brut",
        "O&M",
        "Net CF",
        "DCF",
        "VAN Sc1",
        "VAN Sc2",
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
      fillColor: NAVY,
      textColor: CREAM,
      fontStyle: "bold",
      fontSize: 6,
    },
    bodyStyles: { fontSize: 6.5 },
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

  // ── P8: Courbe VAN + SCR bar chart ────────────────────────────────────────
  addPage();
  hLine(20, "Evolution VAN Cumulee — 25 ans");
  const lineImg = makeLineChart(
    res.dcf_table.map((r) => r.cum_sc1),
    res.dcf_table.map((r) => r.cum_sc2),
    res.dcf_table.map((r) => String(r.year)),
    540,
    200,
  );
  doc.addImage(lineImg, "PNG", 14, 27, PW - 28, 60);
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(
    `Sc1: VAN=${fDA(res.npv_sc1)} | TRI=${res.irr_sc1}% | DRA=${res.dpp_sc1 ?? ">25"} ans | IP=${res.pi_sc1}`,
    14,
    92,
  );
  doc.text(
    `Sc2: VAN=${fDA(res.npv_sc2)} | TRI=${res.irr_sc2}% | DRA=${res.dpp_sc2 ?? ">25"} ans | IP=${res.pi_sc2}`,
    14,
    98,
  );
  const scrImg = makeBarChart(
    res.monthly_scr,
    null,
    M_SHORT,
    540,
    140,
    C.gold,
    C.navy,
    "SCR% Mensuel (Eq.13): min(E_PV,m, E_cons,m) / E_PV,m",
  );
  doc.addImage(scrImg, "PNG", 14, 103, PW - 28, 42);

  // ── P9: Environnement (Eqs 33-35) + Recommandations ──────────────────────
  addPage();
  hLine(20, "Impact Environnemental (Equations 33-35)");
  autoTable(doc, {
    startY: 27,
    head: [["Indicateur", "Equation", "An 1", "25 ans", "Reference"]],
    body: [
      [
        "CO2 evite",
        "Eq.33: E×0.550/1000",
        `${res.co2_yr1} tCO2`,
        `${res.co2_25yr} tCO2`,
        "CREG/IEA Algerie 2023",
      ],
      [
        "Arbres equivalents",
        "co2_yr1×45",
        `${res.trees_equiv}`,
        `${res.trees_equiv * 25}`,
        "45 arbres/tCO2/an",
      ],
      [
        "Vehicules retires",
        "co2_yr1/2.3",
        `${res.vehicles_equiv}`,
        "—",
        "2.3 tCO2/vehicule/an",
      ],
      [
        "Surplus exporte",
        "Eq.16",
        `${fmt(res.exported)} kWh`,
        "—",
        "Loi 04-09 energies renouvelables",
      ],
      [
        "Revenus Net Metering",
        "Eq.35: E_exp×1.8064",
        fDA(res.nm_revenue),
        "—",
        "Tarif HTA Hors Pointe",
      ],
    ],
    headStyles: {
      fillColor: [21, 73, 44],
      textColor: [187, 247, 208],
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [240, 253, 244] },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
  });
  const recY = (doc as any).lastAutoTable.finalY + 9;
  hLine(recY, "Recommandations");
  const recs = [
    `Projet VIABLE (Sc1): VAN = ${fDA(res.npv_sc1)} — TRI = ${res.irr_sc1}% >> taux d'actualisation ${fin.r}%`,
    `SCR reel calcule = ${res.scr}% (methode mensuelle) — plus fiable que la valeur fixe 70% communement utilisee`,
    `Sc2 (subvention ${fin.subsidy_rate}%): DRS passe de ${res.spp_sc1} a ${res.spp_sc2} ans, VAN +${fDA(res.npv_sc2 - res.npv_sc1)}`,
    `Mettre en place comptage net (Loi 04-09): ${fmt(res.exported)} kWh/an exportes = ${fDA(res.nm_revenue)} DA/an supplementaires`,
    `Monitorer la degradation (D=${fin.D}%/an): verifier PR reel apres mise en service et ajuster le plan O&M`,
    `Surface ${loc.gross_area} m² (${res.a_available} m² nette) accueille ${sys.n_modules} modules (${sys.p_installed} kWp) — ratio ${((sys.p_installed / loc.gross_area) * 1000).toFixed(0)} Wp/m² brut`,
  ];
  let ry = recY + 9;
  recs.forEach((rec, i) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(180, 150, 10);
    doc.text(`${i + 1}.`, 14, ry);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    const lines = doc.splitTextToSize(rec, PW - 32) as string[];
    doc.text(lines, 20, ry);
    ry += lines.length * 5 + 3;
    if (ry > PH - 18) {
      addPage();
      ry = 20;
    }
  });
  // Global footer
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(
      "SolarAnalytics.dz | v2.0 | Equations 1-35 | IEC 61724-1:2021 | PRD Biskra 2025-2026",
      14,
      PH - 4,
    );
    doc.text(`Page ${p}/${total}`, PW - 14, PH - 4, { align: "right" });
  }
  doc.save(
    `SolarAnalytics_${loc.building_name.replace(/\s+/g, "_")}_${wilaya.name}_${new Date().getFullYear()}.pdf`,
  );
}

// ─── Sonelgaz OCR parser (HTA Tarif 42) ──────────────────────────────────────
function parseSonelgazBill(
  text: string,
  slotIdx: number,
): { data: BillData; warn: string } {
  let t = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");
  t = t.replace(/(\d) (\d{3})(?=[ ,.\n]|$)/g, "$1$2");
  t = t.replace(/(\d) (\d{3})(?=[ ,.\n]|$)/g, "$1$2");
  t = t.replace(/(\d),(\d{2})(?!\d)/g, "$1.$2");
  const lines = t
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const toNum = (s: string) => {
    const v = parseFloat(s.replace(/\s/g, "").replace(",", "."));
    return isNaN(v) ? 0 : v;
  };
  const numsIn = (s: string) =>
    [...s.matchAll(/\d+(?:\.\d{1,2})?/g)].map((m) => toNum(m[0]));
  const findAfter = (src: string, kws: RegExp[]) => {
    for (const kw of kws) {
      const m = src.match(kw);
      if (m && m[1]) {
        const v = toNum(m[1]);
        if (v > 0) return v;
      }
    }
    return 0;
  };
  let c1 = 0,
    c2 = 0,
    c3 = 0;
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
  if (c1 === 0 && c2 === 0) {
    for (let i = 0; i < lines.length - 1; i++) {
      const lo = lines[i].toLowerCase();
      if (lo.includes("cadran") && lo.includes("1")) {
        const nums = numsIn(lines[i + 1]).filter((n) => n >= 50 && n <= 999999);
        if (nums.length >= 3) {
          c1 = nums[0];
          c2 = nums[1];
          c3 = nums[2];
        } else if (nums.length === 2) {
          c1 = nums[0];
          c2 = nums[1];
        } else if (nums.length === 1) c1 = nums[0];
        break;
      }
    }
  }
  let hpP = 0,
    pP = 0;
  const plm = t.match(
    /H[.\s]*Pointe.*?(\d{3,6}(?:\.\d{1,2})?).*?Pointe.*?(\d{2,5}(?:\.\d{1,2})?)/i,
  );
  if (plm) {
    hpP = toNum(plm[1]);
    pP = toNum(plm[2]);
  }
  if (hpP === 0)
    hpP = findAfter(t, [
      /H(?:eures?\s+)?(?:H(?:ors)?\s+)?Pointe[^\d\n]{0,30}(\d{3,6}(?:\.\d{1,2})?)/i,
      /HHP[^\d\n]{0,20}(\d{3,6}(?:\.\d{1,2})?)/i,
    ]);
  let hp_kwh = 0,
    peak_kwh = 0;
  if (c1 > 0 || c2 > 0 || c3 > 0) {
    hp_kwh = c1 + c2;
    peak_kwh = c3;
    if (hp_kwh === 0 && peak_kwh > 0) {
      hp_kwh = peak_kwh;
      peak_kwh = 0;
    }
  } else if (hpP > 0 || pP > 0) {
    hp_kwh = hpP;
    peak_kwh = pP;
  } else {
    const all = lines.flatMap((l) =>
      numsIn(l).filter((n) => n >= 100 && n <= 99999),
    );
    const uniq = [...new Set(all)].sort((a, b) => b - a);
    if (uniq.length >= 2) {
      hp_kwh = uniq[0];
      peak_kwh = uniq[1];
    } else if (uniq.length === 1) hp_kwh = uniq[0];
  }
  let total_da = 0;
  const totalKws = [
    /TOTAL\s*FACTURE[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
    /Net\s+[àa]\s+Payer[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
    /Montant\s+Net[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
    /Total\s+TTC[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
    /NET\s+A\s+PAYER[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
  ];
  total_da = findAfter(t, totalKws);
  if (total_da === 0) {
    for (let i = 0; i < lines.length; i++) {
      const lo = lines[i].toLowerCase();
      if (
        (lo.includes("total") && lo.includes("facture")) ||
        lo.includes("net a payer") ||
        (lo.includes("montant") && lo.includes("net"))
      ) {
        const sn = numsIn(lines[i]).filter((n) => n > 1000);
        if (sn.length) {
          total_da = sn[sn.length - 1];
          break;
        }
        if (i + 1 < lines.length) {
          const nn = numsIn(lines[i + 1]).filter((n) => n > 1000);
          if (nn.length) {
            total_da = nn[0];
            break;
          }
        }
      }
    }
  }
  if (total_da === 0) {
    const big = lines
      .flatMap((l) => numsIn(l))
      .filter((n) => n > 5000 && n < 5_000_000)
      .sort((a, b) => b - a);
    if (big.length) total_da = big[0];
  }
  const MM: Record<string, number> = {
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
  let month = slotIdx + 1,
    year = new Date().getFullYear();
  const mk = Object.keys(MM).join("|");
  const mRe = new RegExp(`\\b(${mk})\\b[\\s,.-]{0,5}(20\\d{2})`, "i");
  const mMatch = t.match(mRe);
  if (mMatch) {
    month = MM[mMatch[1].toLowerCase()] ?? month;
    year = parseInt(mMatch[2]);
  } else {
    const nr = t.match(/\b(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/);
    if (nr) {
      month = parseInt(nr[1]);
      year = parseInt(nr[2]);
    }
  }
  const yMatch = t.match(/\b(202\d)\b/);
  if (yMatch && year === new Date().getFullYear()) year = parseInt(yMatch[1]);
  const warns: string[] = [];
  if (hp_kwh === 0 && peak_kwh === 0) warns.push("Consommation non detectee");
  if (total_da === 0) warns.push("Montant non detecte");
  if (!mMatch) warns.push("Mois/annee non detectes");
  return {
    data: {
      hp_kwh: Math.round(hp_kwh),
      peak_kwh: Math.round(peak_kwh),
      total_da: Math.round(total_da),
      month,
      year,
    },
    warn: warns.join(" | "),
  };
}

// ─── Default values ───────────────────────────────────────────────────────────
const DEFAULT_LOC: LocationParams = {
  wilaya_id: 7,
  building_name: "Faculte des Sciences et Technologies",
  building_address: "Universite de Biskra",
  gross_area: 3065,
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

function sysFromSizing(loc: LocationParams): SystemParams {
  const w = WILAYAS.find((w) => w.id === loc.wilaya_id) ?? WILAYAS[6];
  const s = autoSize(loc.gross_area, w.ghi_yr);
  return {
    p_installed: s.p_installed,
    n_modules: s.n_modules,
    n_inverters: s.n_inverters,
    module_brand: "Jinko Solar",
    module_model: "JKM370M-72",
    module_power: 370,
    inverter_brand: "SMA Sunny Tripower STP 50-40",
    tilt: 30,
    orientation: "Sud",
    pr: 80,
    a_available: parseFloat((loc.gross_area * SF).toFixed(2)),
    c_modules: s.c_modules,
    c_inverters: s.c_inverters,
    c_structure: s.c_structure,
    c_cabling: s.c_cabling,
    c_transform: s.c_transform,
    c_labor: s.c_labor,
    c_eng: s.c_eng,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function SolarStudyPro() {
  const [step, setStep] = useState(0);
  const [loc, setLoc] = useState<LocationParams>(DEFAULT_LOC);
  const [bills, setBills] = useState<BillSlot[]>(
    Array.from({ length: 12 }, emptySlot),
  );
  const [sys, setSys] = useState<SystemParams>(sysFromSizing(DEFAULT_LOC));
  const [fin, setFin] = useState<FinancialParams>(DEFAULT_FIN);
  const [results, setResults] = useState<StudyResults | null>(null);
  const [computing, setComputing] = useState(false);
  const [genPdf, setGenPdf] = useState(false);
  const [wilayaSearch, setWilayaSearch] = useState("");
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  const selectedWilaya =
    WILAYAS.find((w) => w.id === loc.wilaya_id) ?? WILAYAS[6];

  const updateLoc = (update: Partial<LocationParams>) => {
    const newLoc = { ...loc, ...update };
    setLoc(newLoc);
    setSys(sysFromSizing(newLoc));
  };

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
      const fb: BillData = {
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
          data: fb,
          edited: { ...fb },
          ocrWarn: "OCR echoue — saisie manuelle",
        };
        return next;
      });
    }
  }, []);

  const manualSlot = (idx: number) => {
    const fb: BillData = {
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
        data: fb,
        edited: { ...fb },
        ocrWarn: "Saisie manuelle",
      };
      return next;
    });
  };

  const updField = (idx: number, field: keyof BillData, value: number) => {
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
      setResults(runStudy(loc, bills, sys, fin));
      setComputing(false);
      setStep(5);
    }, 400);
  };

  const downloadPDF = () => {
    if (!results) return;
    setGenPdf(true);
    setTimeout(() => {
      generatePDF(results, loc, sys, fin);
      setGenPdf(false);
    }, 100);
  };

  // ── Shared UI atoms ────────────────────────────────────────────────────────
  const inputCls = "w-full px-3 py-2 rounded-lg text-sm outline-none";
  const inputStyle = {
    backgroundColor: C.navy,
    border: `1px solid ${C.border}`,
    color: C.light,
  };
  const NF = ({
    label,
    value,
    onChange,
    step: s = 1,
    hint,
    unit,
  }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    step?: number;
    hint?: string;
    unit?: string;
  }) => (
    <div>
      <label className="block text-xs mb-1" style={{ color: C.muted }}>
        {label}
      </label>
      <div className="flex gap-2 items-center">
        <input
          type="number"
          value={value}
          step={s}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={inputCls}
          style={inputStyle}
        />
        {unit && (
          <span className="text-xs whitespace-nowrap" style={{ color: C.gold }}>
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <p className="text-xs mt-0.5" style={{ color: C.muted + "80" }}>
          {hint}
        </p>
      )}
    </div>
  );
  const TF = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <div>
      <label className="block text-xs mb-1" style={{ color: C.muted }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
        style={inputStyle}
      />
    </div>
  );
  const Card = ({
    title,
    children,
    accent = C.gold,
  }: {
    title: string;
    children: React.ReactNode;
    accent?: string;
  }) => (
    <div
      className="rounded-2xl p-5 border"
      style={{ backgroundColor: C.navy2, borderColor: C.border }}
    >
      <div className="text-xs font-bold tracking-widest mb-4 uppercase flex items-center gap-2">
        <span
          style={{
            width: 3,
            height: 14,
            backgroundColor: accent,
            display: "inline-block",
            borderRadius: 2,
          }}
        />
        <span style={{ color: accent }}>{title}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );

  const WH = ({ s, t, sub }: { s: number; t: string; sub: string }) => (
    <div className="max-w-4xl mx-auto mb-6">
      <div className="flex gap-1.5 mb-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex-1 h-1.5 rounded-full transition-all duration-500"
            style={{ backgroundColor: i <= s ? C.gold : C.gold + "22" }}
          />
        ))}
      </div>
      <div
        className="text-xs tracking-[0.3em] font-semibold mb-1"
        style={{ color: C.gold + "80" }}
      >
        ETAPE {s} / 5
      </div>
      <h2 className="text-2xl font-bold" style={{ color: C.light }}>
        {t}
      </h2>
      <p className="text-sm mt-1" style={{ color: C.muted }}>
        {sub}
      </p>
    </div>
  );

  const NavBtns = ({
    onBack,
    onNext,
    nextLabel,
    disabled,
  }: {
    onBack: () => void;
    onNext: () => void;
    nextLabel: string;
    disabled?: boolean;
  }) => (
    <div className="flex gap-3">
      <button
        onClick={onBack}
        className="flex-1 py-3 rounded-xl text-sm"
        style={{ border: `1px solid ${C.border}`, color: C.muted }}
      >
        Retour
      </button>
      <button
        onClick={onNext}
        disabled={disabled}
        className="flex-grow py-3 rounded-xl font-bold transition-opacity hover:opacity-90 disabled:opacity-30"
        style={{ backgroundColor: C.gold, color: C.navy }}
      >
        {nextLabel}
      </button>
    </div>
  );

  // ── STEP 0: Welcome ────────────────────────────────────────────────────────
  if (step === 0)
    return (
      <div
        style={{ backgroundColor: C.navy, minHeight: "100vh" }}
        className="flex items-center justify-center p-6"
      >
        <div className="max-w-lg w-full">
          <div className="mb-3">
            <span
              className="text-xs tracking-[0.35em] font-bold px-3 py-1 rounded-full border"
              style={{ color: C.gold, borderColor: C.gold + "40" }}
            >
              SOLARANALYTICS.DZ — v2.0
            </span>
          </div>
          <h1
            className="text-4xl font-black mt-5 mb-3 leading-[1.1]"
            style={{ color: C.light }}
          >
            Etude
            <br />
            <span style={{ color: C.gold }}>Technico-Economique PV</span>
          </h1>
          <p
            className="mb-8 leading-relaxed text-sm"
            style={{ color: C.muted }}
          >
            Selectionnez votre wilaya, entrez la surface de toiture, importez
            vos factures Sonelgaz. Le moteur execute les 35 equations et genere
            un rapport bancable PDF complet.
          </p>
          <div className="grid grid-cols-2 gap-3 mb-8">
            {[
              ["35 Equations", "IEC 61724-1:2021 complet"],
              ["58 Wilayas", "GHI par zone climatique"],
              ["OCR Tesseract", "Extraction auto des factures"],
              ["Rapport 9 pages", "DCF 25 ans, VAN, TRI, LCOE"],
            ].map(([t, s]) => (
              <div
                key={t}
                className="rounded-xl p-4 border"
                style={{ backgroundColor: C.navy2, borderColor: C.border }}
              >
                <div
                  className="font-bold text-xs mb-1"
                  style={{ color: C.gold }}
                >
                  {t}
                </div>
                <div className="text-xs" style={{ color: C.muted }}>
                  {s}
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setStep(1)}
            className="w-full py-4 rounded-xl font-bold text-base transition-opacity hover:opacity-90"
            style={{ backgroundColor: C.gold, color: C.navy }}
          >
            Demarrer l&apos;etude →
          </button>
        </div>
      </div>
    );

  // ── STEP 1: Localisation & Dimensionnement ─────────────────────────────────
  if (step === 1) {
    const sizing = autoSize(loc.gross_area, selectedWilaya.ghi_yr);
    const filteredWilayas = wilayaSearch
      ? WILAYAS.filter((w) =>
          w.name.toLowerCase().includes(wilayaSearch.toLowerCase()),
        )
      : WILAYAS;
    return (
      <div
        style={{ backgroundColor: C.navy, minHeight: "100vh" }}
        className="p-5"
      >
        <WH
          s={1}
          t="Localisation & Dimensionnement"
          sub="Choisissez la wilaya et saisissez la surface brute de toiture"
        />
        <div className="max-w-3xl mx-auto space-y-5">
          <Card title="Projet">
            <TF
              label="Nom du bâtiment / projet"
              value={loc.building_name}
              onChange={(v) => setLoc({ ...loc, building_name: v })}
            />
            <TF
              label="Adresse"
              value={loc.building_address}
              onChange={(v) => setLoc({ ...loc, building_address: v })}
            />
          </Card>

          <Card title="Wilaya — GHI Solaire">
            <div>
              <label className="block text-xs mb-1" style={{ color: C.muted }}>
                Rechercher une wilaya
              </label>
              <input
                type="text"
                placeholder="ex: Biskra, Alger, Adrar..."
                value={wilayaSearch}
                onChange={(e) => setWilayaSearch(e.target.value)}
                className={inputCls}
                style={inputStyle}
              />
            </div>
            <div
              className="grid grid-cols-3 gap-1.5 max-h-52 overflow-y-auto pr-1"
              style={{ scrollbarWidth: "thin" }}
            >
              {filteredWilayas.map((w) => (
                <button
                  key={w.id}
                  onClick={() => updateLoc({ wilaya_id: w.id })}
                  className="text-left p-2.5 rounded-lg border text-xs transition-all"
                  style={{
                    backgroundColor:
                      loc.wilaya_id === w.id ? C.gold + "22" : C.navy,
                    borderColor: loc.wilaya_id === w.id ? C.gold : C.border,
                    color: loc.wilaya_id === w.id ? C.gold : C.muted,
                  }}
                >
                  <span className="font-semibold block">{w.name}</span>
                  <span
                    style={{
                      color: loc.wilaya_id === w.id ? C.gold : C.muted + "70",
                    }}
                  >
                    {w.ghi_yr} kWh/m²/an
                  </span>
                </button>
              ))}
            </div>
            {selectedWilaya && (
              <div
                className="rounded-xl p-4 border"
                style={{ backgroundColor: C.navy, borderColor: C.gold + "40" }}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div
                      className="font-bold text-base"
                      style={{ color: C.gold }}
                    >
                      {selectedWilaya.name}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: C.muted }}>
                      GHI annuel:{" "}
                      <span style={{ color: C.cream }}>
                        {selectedWilaya.ghi_yr} kWh/m²/an
                      </span>
                      {" | "}GHI journalier:{" "}
                      <span style={{ color: C.cream }}>
                        {(selectedWilaya.ghi_yr / 365).toFixed(2)} kWh/m²/j
                      </span>
                    </div>
                    <div className="text-xs" style={{ color: C.muted }}>
                      Zone climatique:{" "}
                      <span style={{ color: C.cream }}>
                        Zone {ghiToZone(selectedWilaya.ghi_yr)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="text-xs font-semibold px-2 py-1 rounded-lg"
                      style={{
                        backgroundColor:
                          selectedWilaya.ghi_yr > 2000
                            ? C.gold + "20"
                            : "#4a9eff20",
                        color: selectedWilaya.ghi_yr > 2000 ? C.gold : C.blue,
                      }}
                    >
                      {selectedWilaya.ghi_yr > 2000
                        ? "Potentiel Eleve"
                        : "Potentiel Modere"}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>

          <Card title="Surface de Toiture (Equation 1)">
            <NF
              label="Surface brute de toiture A_brute"
              value={loc.gross_area}
              onChange={(v) => updateLoc({ gross_area: v })}
              unit="m²"
              hint="Mesuree sur Google Earth ou plans architecturaux"
            />
            <div className="grid grid-cols-3 gap-3 mt-2">
              {[
                [
                  "Eq.1 — Surface nette",
                  "A_brute × 0.70",
                  `${sizing.a_available.toFixed(2)} m²`,
                  C.gold,
                ],
                [
                  "Eq.2 — Nb. modules",
                  "floor(A_nette / 1.94)",
                  `${sizing.n_modules}`,
                  C.green,
                ],
                [
                  "Eq.3 — Puissance PV",
                  "N × 370.3 / 1000",
                  `${sizing.p_installed} kWp`,
                  C.blue,
                ],
              ].map(([label, eq, val, color]) => (
                <div
                  key={label}
                  className="rounded-xl p-3 border"
                  style={{ backgroundColor: C.navy, borderColor: color + "30" }}
                >
                  <div
                    className="text-xs font-bold mb-0.5"
                    style={{ color: color as string }}
                  >
                    {label}
                  </div>
                  <div
                    className="text-xs font-mono mb-1"
                    style={{ color: C.muted + "80" }}
                  >
                    {eq}
                  </div>
                  <div
                    className="text-lg font-black"
                    style={{ color: color as string }}
                  >
                    {val}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              {[
                ["Onduleurs estimés (50kW/unit.)", `${sizing.n_inverters}`],
                [
                  "CAPEX auto-estimé (Eq.18)",
                  `${Math.round(sizing.capex).toLocaleString()} DA`,
                ],
              ].map(([l, v]) => (
                <div
                  key={l}
                  className="rounded-xl p-3 border"
                  style={{ backgroundColor: C.navy, borderColor: C.border }}
                >
                  <div className="text-xs" style={{ color: C.muted }}>
                    {l}
                  </div>
                  <div
                    className="text-base font-bold mt-0.5"
                    style={{ color: C.cream }}
                  >
                    {v}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <NavBtns
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
            nextLabel="Suivant — Factures"
            disabled={loc.gross_area < 10}
          />
        </div>
      </div>
    );
  }

  // ── STEP 2: Factures ───────────────────────────────────────────────────────
  if (step === 2)
    return (
      <div
        style={{ backgroundColor: C.navy, minHeight: "100vh" }}
        className="p-5"
      >
        <WH
          s={2}
          t="Factures Sonelgaz"
          sub="Importez jusqu'à 12 factures — OCR auto + correction manuelle"
        />
        <div className="max-w-4xl mx-auto">
          <div
            className="rounded-xl p-3 mb-5 border text-xs"
            style={{
              backgroundColor: C.navy2,
              borderColor: C.gold + "25",
              color: C.muted,
            }}
          >
            <span style={{ color: C.gold }} className="font-semibold">
              Tarif HTA 42 :
            </span>{" "}
            L&apos;OCR extrait Cadran 1+2 (H.Hors Pointe) + Cadran 3 (H.Pointe)
            + TOTAL FACTURE. Corrigez les valeurs dans le tableau ci-dessous si
            l&apos;OCR est imprécis.
          </div>

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
                  className="relative rounded-xl border-2 cursor-pointer overflow-hidden"
                  style={{
                    aspectRatio: "3/4",
                    borderColor:
                      bill.status === "empty"
                        ? C.border
                        : bill.status === "processing"
                          ? C.gold
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
                      style={{ opacity: 0.6 }}
                      alt=""
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                      <div className="text-lg">📄</div>
                      <div className="text-xs" style={{ color: C.gold + "80" }}>
                        {M_SHORT[i]}
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
                        style={{ borderColor: C.gold }}
                      />
                    </div>
                  )}
                  {bill.status === "done" && (
                    <div
                      className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
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
                      color: C.gold + "cc",
                    }}
                  >
                    {M_SHORT[i]}
                  </div>
                </div>
                {bill.status === "empty" && (
                  <button
                    onClick={() => manualSlot(i)}
                    className="w-full mt-1 text-xs py-1 rounded-lg"
                    style={{
                      backgroundColor: C.navy2,
                      color: C.muted + "60",
                      border: `1px solid ${C.border}`,
                    }}
                  >
                    Saisie manuelle
                  </button>
                )}
              </div>
            ))}
          </div>

          {doneBills > 0 && (
            <div
              className="rounded-xl border overflow-hidden mb-5"
              style={{ borderColor: C.border }}
            >
              <div
                className="px-4 py-3 font-bold text-sm border-b flex items-center justify-between"
                style={{
                  backgroundColor: C.navy2,
                  color: C.gold,
                  borderColor: C.border,
                }}
              >
                <span>Vérification & Correction des valeurs OCR</span>
                <span
                  className="text-xs font-normal"
                  style={{ color: C.muted }}
                >
                  {doneBills}/12 factures
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ backgroundColor: C.navy2 }}>
                      {[
                        "Mois",
                        "Image",
                        "HHP kWh (Cad.1+2)",
                        "HP Pointe kWh (Cad.3)",
                        "Total DA",
                        "Mois (1-12)",
                        "Année",
                      ].map((h) => (
                        <th
                          key={h}
                          className="py-2 px-2 text-left font-semibold"
                          style={{ color: C.muted }}
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
                            className="py-1.5 px-2"
                            style={{ color: C.gold + "aa" }}
                          >
                            <div className="font-semibold">{M_SHORT[i]}</div>
                            {b.ocrWarn && (
                              <div
                                className="text-xs"
                                style={{ color: "#f59e0b" }}
                              >
                                {b.ocrWarn}
                              </div>
                            )}
                          </td>
                          <td className="py-1 px-2">
                            {b.preview && (
                              <img
                                src={b.preview}
                                className="w-10 h-14 object-cover rounded-md"
                                alt=""
                              />
                            )}
                          </td>
                          {(["hp_kwh", "peak_kwh", "total_da"] as const).map(
                            (field) => (
                              <td key={field} className="py-1 px-1.5">
                                <input
                                  type="number"
                                  value={b.edited![field] || ""}
                                  onChange={(e) =>
                                    updField(
                                      i,
                                      field,
                                      parseFloat(e.target.value) || 0,
                                    )
                                  }
                                  className="w-full text-right px-2 py-1.5 rounded-lg text-xs outline-none"
                                  style={{
                                    backgroundColor: C.navy,
                                    border: `1px solid ${b.ocrWarn && b.edited![field] === 0 ? "#f59e0b44" : C.border}`,
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
                                updField(
                                  i,
                                  "month",
                                  parseInt(e.target.value) || 0,
                                )
                              }
                              className="w-16 text-center px-2 py-1.5 rounded-lg text-xs outline-none"
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
                                updField(
                                  i,
                                  "year",
                                  parseInt(e.target.value) || 0,
                                )
                              }
                              className="w-20 text-center px-2 py-1.5 rounded-lg text-xs outline-none"
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
                style={{ backgroundColor: C.navy2, color: C.muted + "50" }}
              >
                Les mois sans facture utiliseront la consommation moyenne des
                mois renseignés.
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-3 rounded-xl text-sm"
              style={{ border: `1px solid ${C.border}`, color: C.muted }}
            >
              Retour
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={doneBills < 1}
              className="flex-grow py-3 rounded-xl font-bold transition-opacity hover:opacity-90 disabled:opacity-30"
              style={{ backgroundColor: C.gold, color: C.navy }}
            >
              Suivant — Système ({doneBills}/12 factures)
            </button>
          </div>
        </div>
      </div>
    );

  // ── STEP 3: Système ────────────────────────────────────────────────────────
  if (step === 3)
    return (
      <div
        style={{ backgroundColor: C.navy, minHeight: "100vh" }}
        className="p-5"
      >
        <WH
          s={3}
          t="Paramètres du Système PV"
          sub="Valeurs auto-calculées depuis l'Étape 1 — toutes éditables"
        />
        <div className="max-w-2xl mx-auto space-y-5">
          <Card title="Modules & Onduleurs">
            <NF
              label="Puissance installée (kWp)"
              value={sys.p_installed}
              onChange={(v) => setSys({ ...sys, p_installed: v })}
              step={0.01}
            />
            <NF
              label="Nombre de modules"
              value={sys.n_modules}
              onChange={(v) => setSys({ ...sys, n_modules: v })}
            />
            <TF
              label="Marque module"
              value={sys.module_brand}
              onChange={(v) => setSys({ ...sys, module_brand: v })}
            />
            <TF
              label="Modèle module"
              value={sys.module_model}
              onChange={(v) => setSys({ ...sys, module_model: v })}
            />
            <NF
              label="Puissance module (Wp)"
              value={sys.module_power}
              onChange={(v) => setSys({ ...sys, module_power: v })}
            />
            <TF
              label="Onduleurs"
              value={sys.inverter_brand}
              onChange={(v) => setSys({ ...sys, inverter_brand: v })}
            />
            <NF
              label="Nombre d'onduleurs"
              value={sys.n_inverters}
              onChange={(v) => setSys({ ...sys, n_inverters: v })}
            />
          </Card>
          <Card title="Site & Performance" accent={C.blue}>
            <NF
              label="Performance Ratio PR (%)"
              value={sys.pr}
              onChange={(v) => setSys({ ...sys, pr: v })}
              step={1}
              hint="75-85% typique — 80% par défaut (IEC 61724)"
            />
            <NF
              label="Inclinaison (degrés)"
              value={sys.tilt}
              onChange={(v) => setSys({ ...sys, tilt: v })}
            />
            <TF
              label="Orientation"
              value={sys.orientation}
              onChange={(v) => setSys({ ...sys, orientation: v })}
            />
          </Card>
          <Card title="CAPEX Détaillé — Equation 18" accent={C.green}>
            <p className="text-xs mb-2" style={{ color: C.muted }}>
              5% de contingence appliqué automatiquement sur le sous-total.
            </p>
            <NF
              label="Modules PV (DA)"
              value={sys.c_modules}
              onChange={(v) => setSys({ ...sys, c_modules: v })}
              step={10000}
              unit="DA"
            />
            <NF
              label="Onduleurs (DA)"
              value={sys.c_inverters}
              onChange={(v) => setSys({ ...sys, c_inverters: v })}
              step={100000}
              unit="DA"
            />
            <NF
              label="Structures aluminium (DA)"
              value={sys.c_structure}
              onChange={(v) => setSys({ ...sys, c_structure: v })}
              step={10000}
              unit="DA"
            />
            <NF
              label="Câblage & protection (DA)"
              value={sys.c_cabling}
              onChange={(v) => setSys({ ...sys, c_cabling: v })}
              step={50000}
              unit="DA"
            />
            <NF
              label="Raccordement HTA (DA)"
              value={sys.c_transform}
              onChange={(v) => setSys({ ...sys, c_transform: v })}
              step={50000}
              unit="DA"
            />
            <NF
              label="Main d'œuvre & pose (DA)"
              value={sys.c_labor}
              onChange={(v) => setSys({ ...sys, c_labor: v })}
              step={10000}
              unit="DA"
            />
            <NF
              label="Études & permis (DA)"
              value={sys.c_eng}
              onChange={(v) => setSys({ ...sys, c_eng: v })}
              step={10000}
              unit="DA"
            />
            <div
              className="rounded-xl p-3 border mt-3"
              style={{ backgroundColor: C.navy, borderColor: C.green + "40" }}
            >
              <div className="flex justify-between">
                <span className="text-xs font-bold" style={{ color: C.green }}>
                  CAPEX TOTAL (+ 5% contingences)
                </span>
                <span className="text-sm font-black" style={{ color: C.cream }}>
                  {Math.round(
                    (sys.c_modules +
                      sys.c_inverters +
                      sys.c_structure +
                      sys.c_cabling +
                      sys.c_transform +
                      sys.c_labor +
                      sys.c_eng) *
                      1.05,
                  ).toLocaleString()}{" "}
                  DA
                </span>
              </div>
            </div>
          </Card>
          <NavBtns
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
            nextLabel="Suivant — Financier"
          />
        </div>
      </div>
    );

  // ── STEP 4: Financier ──────────────────────────────────────────────────────
  if (step === 4)
    return (
      <div
        style={{ backgroundColor: C.navy, minHeight: "100vh" }}
        className="p-5"
      >
        <WH
          s={4}
          t="Paramètres Financiers"
          sub="Hypothèses du modèle DCF 25 ans"
        />
        <div className="max-w-2xl mx-auto space-y-5">
          <Card title="Taux & Dégradation">
            <NF
              label="Taux d'actualisation r (%)"
              value={fin.r}
              onChange={(v) => setFin({ ...fin, r: v })}
              step={0.5}
              hint="6% — taux institutionnel algérien de référence"
            />
            <NF
              label="Inflation tarifaire f (%/an)"
              value={fin.f}
              onChange={(v) => setFin({ ...fin, f: v })}
              step={0.5}
              hint="4%/an — CAGR observé Sonelgaz 2023-2025"
            />
            <NF
              label="Dégradation modules D (%/an)"
              value={fin.D}
              onChange={(v) => setFin({ ...fin, D: v })}
              step={0.1}
              hint="0.5%/an — garantie Jinko JKM 25 ans"
            />
          </Card>
          <Card title="Coûts & Économies" accent={C.green}>
            <NF
              label="O&M (% CAPEX/an) — Eq.19"
              value={fin.om_rate}
              onChange={(v) => setFin({ ...fin, om_rate: v })}
              step={0.1}
              hint="1% standard — maintenance + assurance"
            />
            <NF
              label="Économies demande DS (DA/an) — FIXE"
              value={fin.DS}
              onChange={(v) => setFin({ ...fin, DS: v })}
              step={1000}
              hint="Réduction facture demande/réactif — NE PAS indexer"
            />
            <NF
              label="Subvention Scénario 2 (%)"
              value={fin.subsidy_rate}
              onChange={(v) => setFin({ ...fin, subsidy_rate: v })}
              step={5}
              hint="APRUE/PREREC — 20% standard"
            />
          </Card>
          <div
            className="rounded-xl p-4 border text-sm"
            style={{
              border: `1px solid ${C.gold}33`,
              backgroundColor: C.gold + "08",
              color: C.muted,
            }}
          >
            <div className="font-bold mb-1" style={{ color: C.gold }}>
              ⚠ DS est une constante — jamais indexée à f
            </div>
            DS = {fin.DS.toLocaleString()} DA/an dans toutes les années 1-25.
            Indexer DS serait une erreur méthodologique grave (suréstime le
            VAN).
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep(3)}
              className="flex-1 py-3 rounded-xl text-sm"
              style={{ border: `1px solid ${C.border}`, color: C.muted }}
            >
              Retour
            </button>
            <button
              onClick={compute}
              disabled={computing}
              className="flex-grow py-3 rounded-xl font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: C.gold, color: C.navy }}
            >
              {computing ? (
                <span className="flex items-center justify-center gap-2">
                  <span
                    className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                    style={{ borderColor: C.navy }}
                  />
                  Calcul des 35 équations...
                </span>
              ) : (
                "Lancer l'étude complète"
              )}
            </button>
          </div>
        </div>
      </div>
    );

  // ── STEP 5: Résultats ──────────────────────────────────────────────────────
  if (step === 5 && results) {
    const r = results;
    const wilaya = WILAYAS.find((w) => w.id === loc.wilaya_id) ?? WILAYAS[6];
    const capex = r.capex;
    return (
      <div
        style={{ backgroundColor: C.navy, minHeight: "100vh" }}
        className="p-5"
      >
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="flex items-start justify-between mb-6 gap-4">
            <div>
              <div
                className="text-xs tracking-widest mb-1"
                style={{ color: C.gold + "80" }}
              >
                RÉSULTATS — 35 ÉQUATIONS
              </div>
              <h1 className="text-2xl font-bold" style={{ color: C.light }}>
                {loc.building_name}
              </h1>
              <p className="text-sm mt-1" style={{ color: C.muted }}>
                {wilaya.name} · {sys.p_installed} kWp · {sys.n_modules} modules
                · GHI {wilaya.ghi_yr} kWh/m²/an · T₀ = {r.t0} DA/kWh
              </p>
            </div>
            <button
              onClick={downloadPDF}
              disabled={genPdf}
              className="shrink-0 px-6 py-3 rounded-xl font-bold transition-opacity hover:opacity-90 disabled:opacity-40 text-sm"
              style={{ backgroundColor: C.gold, color: C.navy }}
            >
              {genPdf ? "Génération..." : "Télécharger PDF (9 pages)"}
            </button>
          </div>

          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              {
                l: "VAN Sc1 (Eq.27)",
                v: `${(r.npv_sc1 / 1e6).toFixed(2)} M DA`,
                ok: r.npv_sc1 > 0,
                c: C.gold,
              },
              {
                l: "TRI Sc1 (Eq.28)",
                v: `${r.irr_sc1}%`,
                ok: r.irr_sc1 > fin.r,
                c: C.green,
              },
              {
                l: "DRS Sc1 (Eq.23)",
                v: `${r.spp_sc1} ans`,
                ok: true,
                c: C.cream,
              },
              { l: "LCOE (Eq.30)", v: `${r.lcoe} DA/kWh`, ok: true, c: C.blue },
              { l: "SCR Annuel (Eq.14)", v: `${r.scr}%`, ok: true, c: C.gold },
              {
                l: "E_annual (Eq.4)",
                v: `${(r.e_annual / 1000).toFixed(0)} MWh`,
                ok: true,
                c: C.cream,
              },
              {
                l: "VAN Sc2 (Eq.27)",
                v: `${(r.npv_sc2 / 1e6).toFixed(2)} M DA`,
                ok: r.npv_sc2 > 0,
                c: C.blue,
              },
              {
                l: "CO2 evité (Eq.33)",
                v: `${r.co2_yr1} t/an`,
                ok: true,
                c: C.green,
              },
            ].map((k) => (
              <div
                key={k.l}
                className="rounded-xl p-4 border"
                style={{ backgroundColor: C.navy2, borderColor: k.c + "22" }}
              >
                <div className="text-xs mb-1" style={{ color: C.muted }}>
                  {k.l}
                </div>
                <div
                  className="text-lg font-black"
                  style={{ color: k.ok ? k.c : C.red }}
                >
                  {k.v}
                </div>
              </div>
            ))}
          </div>

          {/* Sizing summary */}
          <div
            className="rounded-xl border p-4 mb-4"
            style={{ backgroundColor: C.navy2, borderColor: C.border }}
          >
            <div
              className="font-bold text-xs uppercase tracking-widest mb-3"
              style={{ color: C.gold }}
            >
              Dimensionnement (Eqs 1-5)
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {[
                ["Surface nette (Eq.1)", `${r.a_available} m²`],
                ["Modules (Eq.2)", `${sys.n_modules}`],
                ["kWp (Eq.3)", `${sys.p_installed}`],
                ["FLEH (Eq.5)", `${r.fleh} h`],
                ["Prod. (Eq.4)", `${(r.e_annual / 1000).toFixed(0)} MWh`],
                ["CAPEX (Eq.18)", `${(capex / 1e6).toFixed(2)} M DA`],
              ].map(([l, v]) => (
                <div key={l} className="text-center">
                  <div className="text-xs" style={{ color: C.muted }}>
                    {l}
                  </div>
                  <div className="font-bold" style={{ color: C.cream }}>
                    {v}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Monthly production table */}
          <div
            className="rounded-xl border overflow-hidden mb-4"
            style={{ borderColor: C.border }}
          >
            <div
              className="px-4 py-3 font-bold text-sm"
              style={{ backgroundColor: C.navy2, color: C.gold }}
            >
              Production Mensuelle (Eqs 6-9) & SCR (Eqs 13-17)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ backgroundColor: C.navy2 }}>
                    <th
                      className="py-2 px-2 text-left"
                      style={{ color: C.muted }}
                    >
                      Indicateur
                    </th>
                    {M_SHORT.map((m) => (
                      <th
                        key={m}
                        className="py-2 px-1 text-right"
                        style={{ color: C.muted }}
                      >
                        {m}
                      </th>
                    ))}
                    <th
                      className="py-2 px-2 text-right font-bold"
                      style={{ color: C.gold }}
                    >
                      TOTAL
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: "T_cell °C",
                      vals: r.monthly.map((m) => m.t_cell),
                      color: "#fb923c",
                      unit: "°C",
                      isTotal: false,
                    },
                    {
                      label: "PR_total % (Eq.8)",
                      vals: r.monthly.map((m) => m.pr_total),
                      color: C.blue,
                      unit: "%",
                      isTotal: false,
                    },
                    {
                      label: "E_PV kWh (Eq.9)",
                      vals: r.monthly_pv,
                      color: C.gold,
                      isTotal: true,
                    },
                    {
                      label: "E_Cons kWh",
                      vals: r.monthly_cons,
                      color: C.blue,
                      isTotal: true,
                    },
                    {
                      label: "SC kWh (Eq.13)",
                      vals: r.monthly_sc,
                      color: C.green,
                      isTotal: true,
                    },
                    {
                      label: "SCR % (Eq.13)",
                      vals: r.monthly_scr,
                      color: C.muted,
                      unit: "%",
                      isTotal: false,
                    },
                  ].map((row) => (
                    <tr
                      key={row.label}
                      className="border-t"
                      style={{ borderColor: C.border + "30" }}
                    >
                      <td
                        className="py-1.5 px-2 font-semibold text-xs"
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
                          {typeof v === "number" ? v.toLocaleString() : v}
                          {row.unit ?? ""}
                        </td>
                      ))}
                      <td
                        className="py-1.5 px-2 text-right font-bold"
                        style={{ color: row.color }}
                      >
                        {row.isTotal
                          ? row.vals
                              .reduce((a, b) => a + (b as number), 0)
                              .toLocaleString()
                          : row.unit === "%"
                            ? `${Math.round(row.vals.reduce((a, b) => a + (b as number), 0) / row.vals.length)}%`
                            : `${(row.vals.reduce((a, b) => a + (b as number), 0) / row.vals.length).toFixed(1)}°C`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2 Scenario cards */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {(
              [
                {
                  title: `Sc1 — Sans subvention`,
                  cap: capex,
                  npv: r.npv_sc1,
                  irr: r.irr_sc1,
                  spp: r.spp_sc1,
                  dpp: r.dpp_sc1,
                  pi: r.pi_sc1,
                  color: C.gold,
                },
                {
                  title: `Sc2 — Subvention ${fin.subsidy_rate}%`,
                  cap: r.capex_sc2,
                  npv: r.npv_sc2,
                  irr: r.irr_sc2,
                  spp: r.spp_sc2,
                  dpp: r.dpp_sc2,
                  pi: r.pi_sc2,
                  color: C.blue,
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
                  ["VAN (Eq.27)", sc.npv.toLocaleString() + " DA"],
                  ["TRI (Eq.28)", sc.irr + "%"],
                  ["DRS (Eq.23)", sc.spp + " ans"],
                  ["DRA (Eq.29)", (sc.dpp ?? ">25") + " ans"],
                  ["IP (Eq.31)", String(sc.pi)],
                  ["LCOE (Eq.30)", r.lcoe + " DA/kWh"],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex justify-between text-xs py-1 border-b"
                    style={{ borderColor: C.border + "30" }}
                  >
                    <span style={{ color: C.muted }}>{k}</span>
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
            style={{ backgroundColor: C.navy2, borderColor: C.green + "22" }}
          >
            <div className="font-bold text-sm mb-3" style={{ color: C.green }}>
              Impact Environnemental (Eqs 33-35)
            </div>
            <div className="grid grid-cols-4 gap-3 text-center">
              {[
                ["tCO2/an", String(r.co2_yr1), "CO2 évité (Eq.33)"],
                [`${r.co2_25yr} t`, `sur 25 ans`, "CO2 total (Eq.34)"],
                ["arbres", String(r.trees_equiv), "Équivalent arbres"],
                [
                  "DA/an",
                  r.nm_revenue.toLocaleString(),
                  "Net Metering (Eq.35)",
                ],
              ].map(([unit, val, lbl]) => (
                <div
                  key={lbl}
                  className="rounded-lg p-3"
                  style={{ backgroundColor: C.green + "0a" }}
                >
                  <div
                    className="text-xl font-black"
                    style={{ color: C.green }}
                  >
                    {val}
                  </div>
                  <div className="text-xs" style={{ color: C.green + "80" }}>
                    {unit}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: C.muted }}>
                    {lbl}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(4)}
              className="py-3 px-6 rounded-xl text-sm"
              style={{ border: `1px solid ${C.border}`, color: C.muted }}
            >
              Modifier
            </button>
            <button
              onClick={downloadPDF}
              disabled={genPdf}
              className="flex-grow py-3 rounded-xl font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: C.gold, color: C.navy }}
            >
              {genPdf
                ? "Génération PDF..."
                : "Télécharger Rapport PDF Complet (9 pages)"}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
