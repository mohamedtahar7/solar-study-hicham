"use client";
// ═══════════════════════════════════════════════════════════════════════════
//  SolarAnalytics.dz  v3.0 — Complete 55-Equation PV Techno-Economic Engine
//  IEC 61724-1:2021 · PRD Biskra · 48 Wilayas · Tesseract OCR
//  3 Financial Scenarios · Sensitivity Analysis · 12-Page PDF Report
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useCallback, useRef } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import Tesseract from "tesseract.js";

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#080e1a",
  navy: "#0d1625",
  navy2: "#152238",
  navy3: "#1e3050",
  gold: "#c9962a",
  goldL: "#f0c060",
  cream: "#f4edd5",
  light: "#e8ecf2",
  muted: "rgba(232,236,242,0.5)",
  border: "rgba(201,150,42,0.22)",
  green: "#27ae60",
  red: "#e74c3c",
  blue: "#3498db",
  orange: "#e67e22",
};

// ─── Month helpers ────────────────────────────────────────────────────────────
const M_S = [
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
const M_F = [
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
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// ─── Physical constants ───────────────────────────────────────────────────────
// NOCT and gamma are read from panel catalog per-module
const PR_INV = 0.98;
const PR_WIRING = 0.982;
const PR_MISMATCH = 0.982;
const PR_AVAIL = 0.997;
const SF = 0.7; // Space factor
const A_MODULE_PER_PITCH = 2.77; // m² with inter-row spacing at 30° tilt
const MODULES_PER_STRING = 14; // SMA CORE1 string size
const CO2_FACTOR = 0.55; // kg CO₂/kWh
const NM_TARIFF = 1.8064; // DA/kWh off-peak
const DA_PER_USD = 135;
// 5% customs duty is baked into all catalog prices_dz

// ─── Panel Catalog (prices include 5% customs duty, 2025 Algeria market) ─────
interface PanelSpec {
  id: string;
  brand: string;
  model: string;
  power_wp: number; // STC power (Wp)
  voc_stc: number; // Open-circuit voltage at STC (V)
  vmpp_stc: number; // MPPT voltage at STC (V)
  isc: number; // Short-circuit current (A)
  impp: number; // MPPT current (A)
  gamma: number; // Temp coefficient Pmax (%/°C → as decimal e.g. -0.0038)
  noct: number; // °C
  area_m2: number; // Physical footprint
  efficiency: number; // %
  warranty_yrs: number;
  degradation_yr: number; // %/yr
  price_dz: number; // DA/unit (customs included)
  technology: string;
}

const PANEL_CATALOG: PanelSpec[] = [
  {
    id: "jinko_370",
    brand: "Jinko Solar",
    model: "JKM370M-72HL4",
    power_wp: 370.3,
    voc_stc: 48.5,
    vmpp_stc: 40.7,
    isc: 9.65,
    impp: 9.11,
    gamma: -0.0038,
    noct: 44,
    area_m2: 1.94,
    efficiency: 19.2,
    warranty_yrs: 25,
    degradation_yr: 0.5,
    price_dz: 9975,
    technology: "Mono PERC",
  },
  {
    id: "jinko_410",
    brand: "Jinko Solar",
    model: "JKM410N-54HL4-V",
    power_wp: 410,
    voc_stc: 37.8,
    vmpp_stc: 31.6,
    isc: 13.95,
    impp: 12.98,
    gamma: -0.0029,
    noct: 43,
    area_m2: 1.722,
    efficiency: 23.8,
    warranty_yrs: 30,
    degradation_yr: 0.4,
    price_dz: 12600,
    technology: "N-Type TOPCon",
  },
  {
    id: "canadian_455",
    brand: "Canadian Solar",
    model: "CS6L-455MS",
    power_wp: 455,
    voc_stc: 49.8,
    vmpp_stc: 42.0,
    isc: 11.57,
    impp: 10.84,
    gamma: -0.0034,
    noct: 45,
    area_m2: 2.21,
    efficiency: 20.6,
    warranty_yrs: 25,
    degradation_yr: 0.5,
    price_dz: 14700,
    technology: "Mono PERC",
  },
  {
    id: "ja_415",
    brand: "JA Solar",
    model: "JAM54S30-415/MR",
    power_wp: 415,
    voc_stc: 37.8,
    vmpp_stc: 31.4,
    isc: 14.06,
    impp: 13.2,
    gamma: -0.003,
    noct: 43,
    area_m2: 1.752,
    efficiency: 23.7,
    warranty_yrs: 30,
    degradation_yr: 0.4,
    price_dz: 12075,
    technology: "N-Type TOPCon",
  },
  {
    id: "longi_430",
    brand: "LONGi",
    model: "LR5-54HTH-430M",
    power_wp: 430,
    voc_stc: 37.9,
    vmpp_stc: 31.6,
    isc: 14.45,
    impp: 13.62,
    gamma: -0.0029,
    noct: 43,
    area_m2: 1.775,
    efficiency: 24.2,
    warranty_yrs: 30,
    degradation_yr: 0.4,
    price_dz: 13650,
    technology: "Hi-MO 6 N-Type",
  },
  {
    id: "risen_450",
    brand: "Risen Energy",
    model: "RSM144-7-450BMDG",
    power_wp: 450,
    voc_stc: 50.4,
    vmpp_stc: 42.2,
    isc: 11.4,
    impp: 10.67,
    gamma: -0.0034,
    noct: 44,
    area_m2: 2.194,
    efficiency: 20.5,
    warranty_yrs: 25,
    degradation_yr: 0.5,
    price_dz: 13125,
    technology: "Mono PERC BSMBB",
  },
];

// ─── Inverter Catalog (prices include 5% customs duty) ───────────────────────
interface InverterSpec {
  id: string;
  brand: string;
  model: string;
  power_kw: number; // AC output (kW)
  max_dc_v: number; // Max DC input voltage (V)
  mppt_min_v: number;
  mppt_max_v: number;
  max_isc_per_mppt: number;
  n_mppt: number;
  efficiency: number; // %
  warranty_yrs: number;
  price_dz: number; // DA/unit (customs included)
}

const INVERTER_CATALOG: InverterSpec[] = [
  {
    id: "sma_50",
    brand: "SMA",
    model: "Sunny Tripower CORE1 STP 50-40",
    power_kw: 50,
    max_dc_v: 1000,
    mppt_min_v: 500,
    mppt_max_v: 800,
    max_isc_per_mppt: 33,
    n_mppt: 6,
    efficiency: 98.4,
    warranty_yrs: 10,
    price_dz: 1417500,
  },
  {
    id: "sma_60",
    brand: "SMA",
    model: "Sunny Tripower STP 60-10",
    power_kw: 60,
    max_dc_v: 1000,
    mppt_min_v: 390,
    mppt_max_v: 800,
    max_isc_per_mppt: 33,
    n_mppt: 3,
    efficiency: 98.4,
    warranty_yrs: 10,
    price_dz: 1701000,
  },
  {
    id: "huawei_50",
    brand: "Huawei",
    model: "SUN2000-50KTL-M3",
    power_kw: 50,
    max_dc_v: 1100,
    mppt_min_v: 200,
    mppt_max_v: 1000,
    max_isc_per_mppt: 30,
    n_mppt: 6,
    efficiency: 98.8,
    warranty_yrs: 10,
    price_dz: 1260000,
  },
  {
    id: "huawei_60",
    brand: "Huawei",
    model: "SUN2000-60KTL-M0",
    power_kw: 60,
    max_dc_v: 1100,
    mppt_min_v: 200,
    mppt_max_v: 1000,
    max_isc_per_mppt: 30,
    n_mppt: 4,
    efficiency: 98.8,
    warranty_yrs: 10,
    price_dz: 1512000,
  },
  {
    id: "growatt_50",
    brand: "Growatt",
    model: "MAX 50KTL3 LV",
    power_kw: 50,
    max_dc_v: 1000,
    mppt_min_v: 200,
    mppt_max_v: 800,
    max_isc_per_mppt: 25,
    n_mppt: 6,
    efficiency: 98.6,
    warranty_yrs: 10,
    price_dz: 1029000,
  },
  {
    id: "fronius_50",
    brand: "Fronius",
    model: "Symo Advanced 50.0-3-S",
    power_kw: 50,
    max_dc_v: 1000,
    mppt_min_v: 200,
    mppt_max_v: 800,
    max_isc_per_mppt: 27,
    n_mppt: 2,
    efficiency: 98.5,
    warranty_yrs: 10,
    price_dz: 1764000,
  },
];

// ─── Wilaya database (48 wilayas, monthly GHI + temps) ───────────────────────
interface WilayaData {
  id: number;
  name_fr: string;
  name_ar: string;
  ghi_annual: number;
  pr_soiling_base: number;
  latitude: number;
  ghi_monthly: number[];
  temp_monthly: number[];
}

const WILAYAS: WilayaData[] = [
  {
    id: 1,
    name_fr: "Adrar",
    name_ar: "أدرار",
    ghi_annual: 6.5,
    pr_soiling_base: 0.97,
    latitude: 27.9,
    ghi_monthly: [5.4, 6.1, 6.8, 7.4, 7.8, 8.0, 7.8, 7.7, 7.3, 6.7, 5.8, 5.2],
    temp_monthly: [17, 20, 26, 31, 37, 42, 44, 43, 38, 31, 22, 17],
  },
  {
    id: 2,
    name_fr: "Chlef",
    name_ar: "الشلف",
    ghi_annual: 5.15,
    pr_soiling_base: 0.975,
    latitude: 36.2,
    ghi_monthly: [3.8, 4.5, 5.3, 6.0, 6.7, 7.2, 7.3, 7.0, 5.9, 4.9, 3.9, 3.4],
    temp_monthly: [10, 12, 14, 17, 21, 26, 30, 29, 24, 19, 13, 10],
  },
  {
    id: 3,
    name_fr: "Laghouat",
    name_ar: "الأغواط",
    ghi_annual: 5.8,
    pr_soiling_base: 0.97,
    latitude: 33.8,
    ghi_monthly: [4.2, 5.0, 5.9, 6.6, 7.3, 7.8, 7.9, 7.6, 6.5, 5.5, 4.3, 3.8],
    temp_monthly: [8, 10, 15, 20, 25, 32, 36, 35, 29, 21, 13, 8],
  },
  {
    id: 4,
    name_fr: "Oum El Bouaghi",
    name_ar: "أم البواقي",
    ghi_annual: 5.25,
    pr_soiling_base: 0.975,
    latitude: 35.9,
    ghi_monthly: [3.8, 4.5, 5.3, 6.0, 6.7, 7.2, 7.3, 7.0, 5.9, 4.9, 3.9, 3.4],
    temp_monthly: [5, 7, 10, 14, 18, 24, 27, 27, 22, 16, 10, 6],
  },
  {
    id: 5,
    name_fr: "Batna",
    name_ar: "باتنة",
    ghi_annual: 5.35,
    pr_soiling_base: 0.97,
    latitude: 35.6,
    ghi_monthly: [3.9, 4.6, 5.4, 6.1, 6.8, 7.3, 7.4, 7.1, 6.0, 5.0, 4.0, 3.5],
    temp_monthly: [4, 6, 9, 14, 18, 24, 27, 27, 22, 16, 9, 5],
  },
  {
    id: 6,
    name_fr: "Béjaïa",
    name_ar: "بجاية",
    ghi_annual: 4.85,
    pr_soiling_base: 0.975,
    latitude: 36.8,
    ghi_monthly: [3.4, 4.1, 4.9, 5.6, 6.2, 6.9, 7.0, 6.7, 5.5, 4.4, 3.5, 3.0],
    temp_monthly: [11, 12, 14, 17, 21, 25, 28, 28, 24, 19, 14, 11],
  },
  {
    id: 7,
    name_fr: "Biskra",
    name_ar: "بسكرة",
    ghi_annual: 5.5,
    pr_soiling_base: 0.97,
    latitude: 34.8,
    ghi_monthly: [3.8, 4.6, 5.5, 6.0, 6.8, 7.1, 7.2, 6.9, 5.9, 5.1, 3.9, 3.5],
    temp_monthly: [11, 13, 17, 22, 28, 33, 37, 36, 30, 23, 15, 11],
  },
  {
    id: 8,
    name_fr: "Béchar",
    name_ar: "بشار",
    ghi_annual: 6.1,
    pr_soiling_base: 0.97,
    latitude: 31.6,
    ghi_monthly: [4.6, 5.4, 6.3, 7.0, 7.7, 8.1, 8.0, 7.8, 6.8, 5.9, 4.7, 4.2],
    temp_monthly: [10, 13, 18, 23, 29, 35, 39, 38, 32, 24, 15, 10],
  },
  {
    id: 9,
    name_fr: "Blida",
    name_ar: "البليدة",
    ghi_annual: 5.05,
    pr_soiling_base: 0.975,
    latitude: 36.5,
    ghi_monthly: [
      3.65, 4.35, 5.15, 5.85, 6.55, 7.15, 7.25, 6.95, 5.75, 4.65, 3.75, 3.25,
    ],
    temp_monthly: [11, 12, 15, 18, 22, 26, 29, 29, 25, 20, 15, 11],
  },
  {
    id: 10,
    name_fr: "Bouira",
    name_ar: "البويرة",
    ghi_annual: 5.05,
    pr_soiling_base: 0.975,
    latitude: 36.4,
    ghi_monthly: [3.6, 4.3, 5.1, 5.8, 6.5, 7.0, 7.1, 6.8, 5.7, 4.7, 3.7, 3.2],
    temp_monthly: [7, 8, 11, 15, 19, 24, 27, 27, 22, 17, 11, 7],
  },
  {
    id: 11,
    name_fr: "Tamanrasset",
    name_ar: "تمنراست",
    ghi_annual: 6.8,
    pr_soiling_base: 0.97,
    latitude: 22.8,
    ghi_monthly: [6.1, 6.5, 7.0, 7.5, 7.8, 7.9, 7.6, 7.3, 7.1, 6.8, 6.3, 5.9],
    temp_monthly: [14, 17, 22, 27, 32, 36, 38, 37, 33, 27, 19, 14],
  },
  {
    id: 12,
    name_fr: "Tébessa",
    name_ar: "تبسة",
    ghi_annual: 5.35,
    pr_soiling_base: 0.97,
    latitude: 35.4,
    ghi_monthly: [3.9, 4.6, 5.4, 6.1, 6.8, 7.3, 7.4, 7.1, 6.0, 5.0, 4.0, 3.5],
    temp_monthly: [5, 7, 10, 15, 19, 25, 28, 28, 23, 16, 10, 6],
  },
  {
    id: 13,
    name_fr: "Tlemcen",
    name_ar: "تلمسان",
    ghi_annual: 5.25,
    pr_soiling_base: 0.975,
    latitude: 34.9,
    ghi_monthly: [3.9, 4.6, 5.4, 6.1, 6.8, 7.3, 7.4, 7.1, 6.0, 5.0, 4.0, 3.5],
    temp_monthly: [9, 11, 13, 16, 20, 25, 29, 28, 24, 18, 13, 9],
  },
  {
    id: 14,
    name_fr: "Tiaret",
    name_ar: "تيارت",
    ghi_annual: 5.45,
    pr_soiling_base: 0.97,
    latitude: 35.4,
    ghi_monthly: [3.9, 4.7, 5.6, 6.3, 7.0, 7.5, 7.6, 7.3, 6.2, 5.2, 4.0, 3.5],
    temp_monthly: [7, 9, 12, 16, 20, 26, 30, 29, 24, 18, 12, 7],
  },
  {
    id: 15,
    name_fr: "Tizi Ouzou",
    name_ar: "تيزي وزو",
    ghi_annual: 4.9,
    pr_soiling_base: 0.975,
    latitude: 36.7,
    ghi_monthly: [3.5, 4.2, 5.0, 5.7, 6.3, 6.9, 7.0, 6.7, 5.5, 4.5, 3.6, 3.1],
    temp_monthly: [8, 9, 12, 15, 19, 24, 27, 27, 23, 18, 12, 9],
  },
  {
    id: 16,
    name_fr: "Alger",
    name_ar: "الجزائر",
    ghi_annual: 5.02,
    pr_soiling_base: 0.975,
    latitude: 36.7,
    ghi_monthly: [3.6, 4.3, 5.1, 5.8, 6.5, 7.1, 7.2, 6.9, 5.7, 4.6, 3.7, 3.2],
    temp_monthly: [12, 13, 15, 18, 22, 26, 29, 29, 25, 20, 15, 12],
  },
  {
    id: 17,
    name_fr: "Djelfa",
    name_ar: "الجلفة",
    ghi_annual: 5.6,
    pr_soiling_base: 0.97,
    latitude: 34.7,
    ghi_monthly: [4.0, 4.8, 5.7, 6.4, 7.1, 7.6, 7.7, 7.4, 6.3, 5.3, 4.1, 3.6],
    temp_monthly: [5, 7, 11, 16, 21, 28, 32, 31, 25, 18, 10, 6],
  },
  {
    id: 18,
    name_fr: "Jijel",
    name_ar: "جيجل",
    ghi_annual: 4.8,
    pr_soiling_base: 0.975,
    latitude: 36.8,
    ghi_monthly: [3.3, 4.0, 4.8, 5.5, 6.1, 6.8, 6.9, 6.6, 5.4, 4.3, 3.4, 2.9],
    temp_monthly: [11, 12, 14, 17, 20, 24, 27, 27, 24, 19, 14, 11],
  },
  {
    id: 19,
    name_fr: "Sétif",
    name_ar: "سطيف",
    ghi_annual: 5.3,
    pr_soiling_base: 0.975,
    latitude: 36.2,
    ghi_monthly: [3.8, 4.5, 5.3, 6.0, 6.7, 7.2, 7.3, 7.0, 5.9, 4.9, 3.9, 3.4],
    temp_monthly: [5, 7, 10, 14, 18, 24, 27, 27, 22, 16, 10, 6],
  },
  {
    id: 20,
    name_fr: "Saïda",
    name_ar: "سعيدة",
    ghi_annual: 5.4,
    pr_soiling_base: 0.97,
    latitude: 34.8,
    ghi_monthly: [3.9, 4.7, 5.6, 6.3, 7.0, 7.5, 7.6, 7.3, 6.2, 5.2, 4.0, 3.5],
    temp_monthly: [8, 10, 13, 16, 21, 26, 30, 29, 24, 19, 12, 8],
  },
  {
    id: 21,
    name_fr: "Skikda",
    name_ar: "سكيكدة",
    ghi_annual: 4.88,
    pr_soiling_base: 0.975,
    latitude: 36.9,
    ghi_monthly: [3.4, 4.1, 4.9, 5.6, 6.2, 6.9, 7.0, 6.7, 5.5, 4.4, 3.5, 3.0],
    temp_monthly: [12, 13, 15, 17, 21, 25, 27, 27, 24, 20, 15, 12],
  },
  {
    id: 22,
    name_fr: "Sidi Bel Abbès",
    name_ar: "سيدي بلعباس",
    ghi_annual: 5.15,
    pr_soiling_base: 0.975,
    latitude: 35.2,
    ghi_monthly: [3.8, 4.5, 5.3, 6.0, 6.7, 7.2, 7.3, 7.0, 5.9, 4.9, 3.9, 3.4],
    temp_monthly: [9, 11, 14, 17, 21, 26, 30, 29, 24, 19, 13, 9],
  },
  {
    id: 23,
    name_fr: "Annaba",
    name_ar: "عنابة",
    ghi_annual: 4.9,
    pr_soiling_base: 0.975,
    latitude: 36.9,
    ghi_monthly: [3.5, 4.2, 5.0, 5.7, 6.3, 7.0, 7.1, 6.8, 5.6, 4.5, 3.6, 3.1],
    temp_monthly: [12, 13, 15, 18, 22, 26, 28, 28, 25, 20, 15, 12],
  },
  {
    id: 24,
    name_fr: "Guelma",
    name_ar: "قالمة",
    ghi_annual: 5.1,
    pr_soiling_base: 0.975,
    latitude: 36.5,
    ghi_monthly: [3.6, 4.3, 5.1, 5.8, 6.5, 7.0, 7.1, 6.8, 5.7, 4.7, 3.7, 3.2],
    temp_monthly: [7, 9, 12, 15, 20, 25, 28, 28, 23, 18, 12, 8],
  },
  {
    id: 25,
    name_fr: "Constantine",
    name_ar: "قسنطينة",
    ghi_annual: 5.2,
    pr_soiling_base: 0.975,
    latitude: 36.4,
    ghi_monthly: [3.7, 4.4, 5.2, 5.9, 6.6, 7.1, 7.2, 6.9, 5.8, 4.8, 3.8, 3.3],
    temp_monthly: [6, 8, 11, 15, 19, 25, 28, 28, 23, 17, 11, 7],
  },
  {
    id: 26,
    name_fr: "Médéa",
    name_ar: "المدية",
    ghi_annual: 5.1,
    pr_soiling_base: 0.975,
    latitude: 36.3,
    ghi_monthly: [
      3.65, 4.35, 5.15, 5.85, 6.55, 7.05, 7.15, 6.85, 5.75, 4.65, 3.75, 3.25,
    ],
    temp_monthly: [8, 9, 12, 15, 19, 24, 27, 27, 23, 17, 12, 8],
  },
  {
    id: 27,
    name_fr: "Mostaganem",
    name_ar: "مستغانم",
    ghi_annual: 5.05,
    pr_soiling_base: 0.975,
    latitude: 35.9,
    ghi_monthly: [3.7, 4.4, 5.2, 5.9, 6.6, 7.2, 7.3, 7.0, 5.8, 4.7, 3.8, 3.3],
    temp_monthly: [12, 13, 15, 17, 21, 25, 28, 28, 24, 20, 15, 12],
  },
  {
    id: 28,
    name_fr: "M'Sila",
    name_ar: "المسيلة",
    ghi_annual: 5.5,
    pr_soiling_base: 0.97,
    latitude: 35.7,
    ghi_monthly: [3.9, 4.7, 5.6, 6.3, 7.0, 7.5, 7.6, 7.3, 6.2, 5.2, 4.0, 3.5],
    temp_monthly: [7, 9, 13, 18, 23, 29, 33, 32, 27, 20, 12, 7],
  },
  {
    id: 29,
    name_fr: "Mascara",
    name_ar: "معسكر",
    ghi_annual: 5.2,
    pr_soiling_base: 0.975,
    latitude: 35.4,
    ghi_monthly: [3.8, 4.5, 5.3, 6.0, 6.7, 7.2, 7.3, 7.0, 5.9, 4.9, 3.9, 3.4],
    temp_monthly: [10, 12, 14, 17, 21, 26, 30, 29, 25, 19, 13, 10],
  },
  {
    id: 30,
    name_fr: "Ouargla",
    name_ar: "ورقلة",
    ghi_annual: 6.2,
    pr_soiling_base: 0.97,
    latitude: 31.9,
    ghi_monthly: [4.7, 5.5, 6.4, 7.1, 7.8, 8.2, 8.1, 7.9, 6.9, 6.0, 4.8, 4.3],
    temp_monthly: [12, 15, 20, 25, 31, 37, 41, 40, 34, 26, 17, 12],
  },
  {
    id: 31,
    name_fr: "Oran",
    name_ar: "وهران",
    ghi_annual: 5.05,
    pr_soiling_base: 0.975,
    latitude: 35.7,
    ghi_monthly: [3.7, 4.4, 5.2, 5.9, 6.6, 7.2, 7.3, 7.0, 5.8, 4.7, 3.8, 3.3],
    temp_monthly: [12, 13, 15, 17, 21, 25, 28, 28, 24, 20, 15, 12],
  },
  {
    id: 32,
    name_fr: "El Bayadh",
    name_ar: "البيض",
    ghi_annual: 5.75,
    pr_soiling_base: 0.97,
    latitude: 33.7,
    ghi_monthly: [4.1, 4.9, 5.8, 6.5, 7.2, 7.7, 7.8, 7.5, 6.4, 5.4, 4.2, 3.7],
    temp_monthly: [6, 8, 13, 18, 23, 30, 34, 33, 27, 20, 11, 6],
  },
  {
    id: 33,
    name_fr: "Illizi",
    name_ar: "إليزي",
    ghi_annual: 6.5,
    pr_soiling_base: 0.97,
    latitude: 26.5,
    ghi_monthly: [5.4, 6.1, 6.8, 7.4, 7.8, 7.9, 7.7, 7.6, 7.3, 6.7, 5.8, 5.2],
    temp_monthly: [15, 18, 23, 28, 34, 38, 41, 40, 35, 28, 20, 15],
  },
  {
    id: 34,
    name_fr: "Bordj Bou Arréridj",
    name_ar: "برج بوعريريج",
    ghi_annual: 5.25,
    pr_soiling_base: 0.975,
    latitude: 36.1,
    ghi_monthly: [3.8, 4.5, 5.3, 6.0, 6.7, 7.2, 7.3, 7.0, 5.9, 4.9, 3.9, 3.4],
    temp_monthly: [6, 8, 11, 15, 19, 24, 28, 27, 22, 17, 10, 6],
  },
  {
    id: 35,
    name_fr: "Boumerdès",
    name_ar: "بومرداس",
    ghi_annual: 4.95,
    pr_soiling_base: 0.975,
    latitude: 36.8,
    ghi_monthly: [
      3.55, 4.25, 5.05, 5.75, 6.45, 7.05, 7.15, 6.85, 5.65, 4.55, 3.65, 3.15,
    ],
    temp_monthly: [12, 13, 15, 18, 22, 26, 29, 29, 25, 20, 15, 12],
  },
  {
    id: 36,
    name_fr: "El Tarf",
    name_ar: "الطارف",
    ghi_annual: 4.95,
    pr_soiling_base: 0.975,
    latitude: 36.8,
    ghi_monthly: [
      3.5, 4.2, 5.0, 5.7, 6.3, 6.9, 7.0, 6.7, 5.55, 4.45, 3.55, 3.05,
    ],
    temp_monthly: [10, 11, 14, 17, 21, 25, 27, 27, 24, 19, 14, 11],
  },
  {
    id: 37,
    name_fr: "Tindouf",
    name_ar: "تندوف",
    ghi_annual: 6.6,
    pr_soiling_base: 0.97,
    latitude: 27.7,
    ghi_monthly: [5.5, 6.2, 6.9, 7.5, 7.9, 8.0, 7.8, 7.7, 7.4, 6.8, 5.9, 5.3],
    temp_monthly: [14, 17, 22, 28, 33, 38, 42, 41, 36, 28, 19, 14],
  },
  {
    id: 38,
    name_fr: "Tissemsilt",
    name_ar: "تيسمسيلت",
    ghi_annual: 5.2,
    pr_soiling_base: 0.975,
    latitude: 35.6,
    ghi_monthly: [3.8, 4.5, 5.3, 6.0, 6.7, 7.2, 7.3, 7.0, 5.9, 4.9, 3.9, 3.4],
    temp_monthly: [8, 10, 13, 16, 20, 25, 29, 28, 23, 18, 12, 8],
  },
  {
    id: 39,
    name_fr: "El Oued",
    name_ar: "الوادي",
    ghi_annual: 6.1,
    pr_soiling_base: 0.97,
    latitude: 33.4,
    ghi_monthly: [4.6, 5.4, 6.3, 7.0, 7.7, 8.1, 8.0, 7.8, 6.8, 5.9, 4.7, 4.2],
    temp_monthly: [11, 14, 18, 24, 30, 36, 40, 39, 33, 25, 16, 11],
  },
  {
    id: 40,
    name_fr: "Khenchela",
    name_ar: "خنشلة",
    ghi_annual: 5.4,
    pr_soiling_base: 0.97,
    latitude: 35.4,
    ghi_monthly: [3.9, 4.7, 5.6, 6.3, 7.0, 7.5, 7.6, 7.3, 6.2, 5.2, 4.0, 3.5],
    temp_monthly: [4, 6, 9, 14, 18, 25, 28, 28, 22, 16, 9, 5],
  },
  {
    id: 41,
    name_fr: "Souk Ahras",
    name_ar: "سوق أهراس",
    ghi_annual: 5.1,
    pr_soiling_base: 0.975,
    latitude: 36.3,
    ghi_monthly: [3.6, 4.3, 5.1, 5.8, 6.5, 7.0, 7.1, 6.8, 5.7, 4.7, 3.7, 3.2],
    temp_monthly: [7, 9, 12, 15, 20, 25, 28, 28, 23, 18, 12, 8],
  },
  {
    id: 42,
    name_fr: "Tipaza",
    name_ar: "تيبازة",
    ghi_annual: 5.0,
    pr_soiling_base: 0.975,
    latitude: 36.6,
    ghi_monthly: [3.6, 4.3, 5.1, 5.8, 6.5, 7.1, 7.2, 6.9, 5.7, 4.6, 3.7, 3.2],
    temp_monthly: [12, 13, 15, 18, 22, 26, 29, 29, 25, 20, 15, 12],
  },
  {
    id: 43,
    name_fr: "Mila",
    name_ar: "ميلة",
    ghi_annual: 5.2,
    pr_soiling_base: 0.975,
    latitude: 36.5,
    ghi_monthly: [3.7, 4.4, 5.2, 5.9, 6.6, 7.1, 7.2, 6.9, 5.8, 4.8, 3.8, 3.3],
    temp_monthly: [6, 8, 11, 15, 19, 25, 28, 28, 23, 17, 11, 7],
  },
  {
    id: 44,
    name_fr: "Aïn Defla",
    name_ar: "عين الدفلى",
    ghi_annual: 5.1,
    pr_soiling_base: 0.975,
    latitude: 36.3,
    ghi_monthly: [
      3.65, 4.35, 5.15, 5.85, 6.55, 7.05, 7.15, 6.85, 5.75, 4.65, 3.75, 3.25,
    ],
    temp_monthly: [10, 11, 14, 17, 21, 26, 29, 29, 24, 19, 13, 10],
  },
  {
    id: 45,
    name_fr: "Naâma",
    name_ar: "النعامة",
    ghi_annual: 5.7,
    pr_soiling_base: 0.97,
    latitude: 33.3,
    ghi_monthly: [4.1, 4.9, 5.8, 6.5, 7.2, 7.7, 7.8, 7.5, 6.4, 5.4, 4.2, 3.7],
    temp_monthly: [7, 9, 13, 18, 23, 29, 34, 33, 27, 20, 12, 7],
  },
  {
    id: 46,
    name_fr: "Aïn Témouchent",
    name_ar: "عين تموشنت",
    ghi_annual: 5.05,
    pr_soiling_base: 0.975,
    latitude: 35.3,
    ghi_monthly: [3.7, 4.4, 5.2, 5.9, 6.6, 7.2, 7.3, 7.0, 5.8, 4.7, 3.8, 3.3],
    temp_monthly: [12, 13, 15, 17, 21, 25, 28, 28, 24, 20, 15, 12],
  },
  {
    id: 47,
    name_fr: "Ghardaïa",
    name_ar: "غرداية",
    ghi_annual: 6.0,
    pr_soiling_base: 0.97,
    latitude: 32.5,
    ghi_monthly: [4.5, 5.3, 6.2, 6.9, 7.6, 8.0, 7.9, 7.7, 6.7, 5.8, 4.6, 4.1],
    temp_monthly: [11, 13, 18, 23, 29, 35, 39, 38, 32, 25, 16, 11],
  },
  {
    id: 48,
    name_fr: "Relizane",
    name_ar: "غليزان",
    ghi_annual: 5.1,
    pr_soiling_base: 0.975,
    latitude: 35.7,
    ghi_monthly: [3.7, 4.4, 5.2, 5.9, 6.6, 7.1, 7.2, 6.9, 5.8, 4.8, 3.8, 3.3],
    temp_monthly: [10, 12, 14, 17, 21, 26, 30, 29, 24, 19, 13, 10],
  },
];

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface LocationParams {
  wilaya_id: number;
  institution_name: string;
  institution_type: string;
  address: string;
  gross_area: number;
  n_buildings: number;
  tilt: number;
  orientation: string;
  cleaning_freq: string;
}
interface EquipmentParams {
  panel_id: string;
  inverter_id: string;
}
interface InvoiceData {
  billing_period: string;
  h_pointe_kwh: number;
  peak_kwh: number;
  total_kwh: number;
  invoice_da: number;
  eff_tariff: number;
}
interface InvoiceSlot {
  file: File | null;
  preview: string | null;
  status: "empty" | "processing" | "done" | "error";
  data: InvoiceData | null;
  edited: InvoiceData | null;
  warn: string;
}
interface FinancialParams {
  r: number;
  f: number;
  D: number;
  om_rate: number;
  DS: number;
  subsidy_rate: number;
  loan_rate: number;
  loan_years: number;
  loan_down: number;
}
interface SizingResult {
  a_available: number;
  n_modules_max: number;
  n_strings: number;
  n_modules: number;
  p_installed: number;
  n_inverters: number;
  dc_ac_ratio: number;
  c_transformer_kva: number;
  area_occupied: number;
}
interface MonthlyDetail {
  m: number;
  ghi_d: number;
  t_amb: number;
  t_cell: number;
  pr_temp: number;
  pr_soiling: number;
  pr_total: number;
  e_pv: number;
  e_cons: number;
  e_sc: number;
  e_export: number;
  e_grid: number;
  scr_m: number;
}
interface DCFRow {
  year: number;
  e_self_n: number;
  t_n: number;
  energy_sav: number;
  ds: number;
  gross_sav: number;
  om: number;
  inv_repl: number;
  net_cf: number;
  dcf: number;
  cum_sc1: number;
  cum_sc2: number;
  cum_sc3: number;
  net_cf_sc3: number;
}
interface SensRow {
  label: string;
  npv: number;
  spp: number;
}
interface StudyResults {
  sizing: SizingResult;
  monthly: MonthlyDetail[];
  e_annual: number;
  fleh: number;
  monthly_pv: number[];
  monthly_cons: number[];
  monthly_sc: number[];
  monthly_scr: number[];
  scr_annual: number;
  e_self_yr1: number;
  e_surplus: number;
  ssr: number;
  t0: number;
  peak_fraction: number;
  total_da: number;
  total_kwh: number;
  capex: number;
  capex_sc2: number;
  capex_breakdown: { label: string; val: number }[];
  cost_per_wp: number;
  inv_replacement: number;
  om_annual: number;
  yr1_energy_sav: number;
  yr1_gross_sav: number;
  yr1_net_cf: number;
  spp_sc1: number;
  spp_sc2: number;
  npv_sc1: number;
  npv_sc2: number;
  npv_sc3: number;
  irr_sc1: number;
  irr_sc2: number;
  irr_sc3: number;
  dpp_sc1: number | null;
  dpp_sc2: number | null;
  dpp_sc3: number | null;
  pi_sc1: number;
  pi_sc2: number;
  pi_sc3: number;
  lcoe: number;
  nm_revenue: number;
  npv_nm: number;
  co2_yr1: number;
  co2_25yr: number;
  trees_yr: number;
  vehi_yr: number;
  gas_yr: number;
  dcf_table: DCFRow[];
  sens_scr: SensRow[];
  sens_ghi: SensRow[];
  sens_om: SensRow[];
  be_scr: number;
  be_tariff: number;
  warnings: string[];
}

// ─── IRR solver ───────────────────────────────────────────────────────────────
function solveIRR(cfs: number[], inv: number): number {
  const npv = (r: number) =>
    cfs.reduce((acc, cf, i) => acc + cf / Math.pow(1 + r, i + 1), -inv);
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

// ─── PR Soiling from cleaning freq ───────────────────────────────────────────
function prSoiling(base: number, freq: string): number {
  if (freq === "monthly") return 0.977;
  if (freq === "quarterly") return 0.963;
  if (freq === "annual") return 0.95;
  return base; // bi-monthly default
}

// ─── DS default by institution type ─────────────────────────────────────────
function dsDefault(type: string): number {
  if (type === "hospital") return 180000;
  if (type === "admin") return 90000;
  return 120000; // university/school/other
}

// ══════════════════════════════════════════════════════════════════════════════
//  ALL 55 EQUATIONS — MAIN CALCULATION ENGINE
// ══════════════════════════════════════════════════════════════════════════════
function runStudy(
  loc: LocationParams,
  eq: EquipmentParams,
  invoices: InvoiceSlot[],
  fin: FinancialParams,
): StudyResults {
  const warns: string[] = [];
  const wilaya = WILAYAS.find((w) => w.id === loc.wilaya_id) ?? WILAYAS[6];
  const panel =
    PANEL_CATALOG.find((p) => p.id === eq.panel_id) ?? PANEL_CATALOG[0];
  const inv =
    INVERTER_CATALOG.find((i) => i.id === eq.inverter_id) ??
    INVERTER_CATALOG[0];
  const soiling = prSoiling(wilaya.pr_soiling_base, loc.cleaning_freq);

  // ── GROUP A: System Sizing (Eq 1-8) ────────────────────────────────────────
  const a_available = +(loc.gross_area * SF).toFixed(2); // Eq.1
  const n_modules_max = Math.floor(a_available / A_MODULE_PER_PITCH); // Eq.2
  let n_strings = Math.floor(n_modules_max / MODULES_PER_STRING); // Eq.3
  let n_modules = n_strings * MODULES_PER_STRING; // Eq.4
  let p_installed = +((n_modules * panel.power_wp) / 1000).toFixed(2); // Eq.5
  let n_inverters = Math.max(1, Math.ceil(p_installed / inv.power_kw)); // Eq.6
  let dc_ac = +(p_installed / (n_inverters * inv.power_kw)).toFixed(3); // Eq.7

  // Eq.8 — validation loop
  if (dc_ac < 1.05 && n_inverters > 1) {
    n_inverters--;
    dc_ac = +(p_installed / (n_inverters * inv.power_kw)).toFixed(3);
  }
  if (dc_ac > 1.3) {
    n_inverters++;
    dc_ac = +(p_installed / (n_inverters * inv.power_kw)).toFixed(3);
  }
  if (dc_ac > 1.3 || dc_ac < 1.05)
    warns.push(
      `DC/AC ratio ${dc_ac} outside [1.05–1.30] — system requires custom design.`,
    );
  if (n_modules < 14)
    warns.push(
      "Roof too small for minimum 1 string (14 modules). Min ~55 m² gross.",
    );
  if (n_modules > 2000)
    warns.push("Very large system. Verify roof area measurement.");
  const c_transformer_kva = Math.ceil((n_inverters * inv.power_kw) / 0.9); // Eq.8 transformer
  const area_occupied = n_modules * A_MODULE_PER_PITCH;
  const sizing: SizingResult = {
    a_available,
    n_modules_max,
    n_strings,
    n_modules,
    p_installed,
    n_inverters,
    dc_ac_ratio: dc_ac,
    c_transformer_kva,
    area_occupied,
  };

  // ── GROUP B: Energy Production (Eq 9-17) ──────────────────────────────────
  const monthly_detail: MonthlyDetail[] = [];
  const monthly_pv: number[] = [];

  for (let m = 0; m < 12; m++) {
    const ghi_d = wilaya.ghi_monthly[m]; // kWh/m²/day
    const t_amb = wilaya.temp_monthly[m];
    const t_cell = t_amb + ((panel.noct - 20) * ghi_d) / 0.8; // Eq.9
    const pr_temp = 1 + panel.gamma * (t_cell - 25); // Eq.10
    const pr_tot =
      pr_temp * soiling * PR_INV * PR_WIRING * PR_MISMATCH * PR_AVAIL; // Eq.12
    const e_pv = Math.round(p_installed * ghi_d * pr_tot * DAYS_PER_MONTH[m]); // Eq.13
    monthly_pv.push(e_pv);
    monthly_detail.push({
      m,
      ghi_d,
      t_amb,
      t_cell: +t_cell.toFixed(1),
      pr_temp: +(pr_temp * 100).toFixed(1),
      pr_soiling: soiling,
      pr_total: +(pr_tot * 100).toFixed(1),
      e_pv,
      e_cons: 0,
      e_sc: 0,
      e_export: 0,
      e_grid: 0,
      scr_m: 0,
    });
  }
  const e_annual = monthly_pv.reduce((a, b) => a + b, 0); // Eq.14
  const fleh = +(e_annual / p_installed).toFixed(0); // Eq.16
  if (fleh < 1400)
    warns.push(
      `FLEH = ${fleh} h/yr is below expected minimum (1400). Check GHI data.`,
    );
  if (fleh > 2300)
    warns.push(
      `FLEH = ${fleh} h/yr is above expected maximum (2300). Check GHI data.`,
    );

  // ── GROUP C: Consumption & Tariff (Eq 18-23) ──────────────────────────────
  // Multi-year averaging (Eq.18)
  const byMonth: { [key: string]: { kwh: number[]; da: number[] } } = {};
  for (let m = 0; m < 12; m++) byMonth[String(m)] = { kwh: [], da: [] };
  invoices
    .filter((s) => s.status === "done" && s.edited)
    .forEach((s) => {
      const d = s.edited!;
      const period = d.billing_period ?? "";
      const mIdx = period ? parseInt(period.split("-")[1]) - 1 : -1;
      if (mIdx < 0 || mIdx > 11) return;
      if (d.total_kwh > 0) byMonth[mIdx].kwh.push(d.total_kwh);
      if (d.invoice_da > 0) byMonth[mIdx].da.push(d.invoice_da);
    });

  const monthly_cons: number[] = [];
  let total_da = 0,
    total_kwh = 0;
  for (let m = 0; m < 12; m++) {
    const kArr = byMonth[m].kwh,
      dArr = byMonth[m].da;
    const avg_k =
      kArr.length > 0 ? kArr.reduce((a, b) => a + b, 0) / kArr.length : 0;
    const avg_d =
      dArr.length > 0 ? dArr.reduce((a, b) => a + b, 0) / dArr.length : 0;
    monthly_cons.push(Math.round(avg_k));
    total_kwh += avg_k;
    total_da += avg_d;
  }
  // Fill missing months with average
  const filledKwh = monthly_cons.filter((v) => v > 0);
  const avgK =
    filledKwh.length > 0
      ? filledKwh.reduce((a, b) => a + b, 0) / filledKwh.length
      : 40000;
  const monthly_cons_f = monthly_cons.map((v) =>
    v > 0 ? v : Math.round(avgK),
  );
  const t0 = total_kwh > 0 ? +(total_da / total_kwh).toFixed(4) : 4.8018; // Eq.20
  if (t0 < 4.0)
    warns.push(`T0=${t0} DA/kWh < 4.0 — missing peak hours (Cadran 3)?`);
  if (t0 > 6.5)
    warns.push(`T0=${t0} DA/kWh > 6.5 — check for duplicate invoices.`);
  const invoiceCount = invoices.filter((s) => s.status === "done").length;
  if (invoiceCount < 12)
    warns.push(
      `Only ${invoiceCount} invoices uploaded. Minimum 12 recommended.`,
    );

  // Peak fraction (Eq.22)
  let sum_peak = 0,
    sum_total_inv = 0;
  invoices
    .filter((s) => s.status === "done" && s.edited)
    .forEach((s) => {
      sum_peak += s.edited!.peak_kwh ?? 0;
      sum_total_inv += s.edited!.total_kwh ?? 0;
    });
  const peak_fraction =
    sum_total_inv > 0 ? +((sum_peak / sum_total_inv) * 100).toFixed(1) : 13.0;

  // ── GROUP D: Self-Consumption (Eq 24-30) ──────────────────────────────────
  const monthly_sc: number[] = [],
    monthly_scr: number[] = [];
  for (let m = 0; m < 12; m++) {
    const sc = Math.min(monthly_pv[m], monthly_cons_f[m]); // Eq.24
    const ex = Math.max(0, monthly_pv[m] - monthly_cons_f[m]); // Eq.25
    const gr = Math.max(0, monthly_cons_f[m] - monthly_pv[m]); // Eq.26
    const scr_m =
      monthly_pv[m] > 0 ? +((sc / monthly_pv[m]) * 100).toFixed(1) : 0; // Eq.27
    monthly_sc.push(sc);
    monthly_scr.push(scr_m);
    monthly_detail[m].e_cons = monthly_cons_f[m];
    monthly_detail[m].e_sc = sc;
    monthly_detail[m].e_export = ex;
    monthly_detail[m].e_grid = gr;
    monthly_detail[m].scr_m = scr_m;
  }
  const e_self_yr1 = monthly_sc.reduce((a, b) => a + b, 0); // Eq.35
  const scr_annual = +((e_self_yr1 / e_annual) * 100).toFixed(2); // Eq.28
  const e_cons_ann = monthly_cons_f.reduce((a, b) => a + b, 0);
  const ssr = +((e_self_yr1 / e_cons_ann) * 100).toFixed(2); // Eq.29
  const e_surplus = monthly_pv
    .map((v, i) => Math.max(0, v - monthly_cons_f[i]))
    .reduce((a, b) => a + b, 0); // Eq.30
  if (scr_annual < 40)
    warns.push(`SCR=${scr_annual}% is very low. PV may be oversized.`);

  // ── GROUP E: CAPEX (Eq 31-33) ─────────────────────────────────────────────
  const c_modules = n_modules * panel.price_dz;
  const c_inverters = n_inverters * inv.price_dz;
  const c_structure = p_installed * 4500;
  const c_cables = 1200000;
  const c_connection = 800000;
  const c_civil = p_installed * 3500;
  const c_engineering = 650000;
  const subtotal =
    c_modules +
    c_inverters +
    c_structure +
    c_cables +
    c_connection +
    c_civil +
    c_engineering;
  const c_contingency = Math.round(subtotal * 0.05);
  const capex = Math.round(subtotal + c_contingency); // Eq.31
  const cost_per_wp = +(capex / (p_installed * 1000)).toFixed(2); // Eq.32
  const inv_replacement = n_inverters * inv.price_dz; // Eq.33 (Year 15)
  const capex_breakdown = [
    {
      label: `Modules PV (${n_modules} × ${panel.price_dz.toLocaleString()} DA)`,
      val: c_modules,
    },
    {
      label: `Onduleurs (${n_inverters} × ${inv.price_dz.toLocaleString()} DA)`,
      val: c_inverters,
    },
    {
      label: `Structures aluminium (${p_installed} kWp × 4 500)`,
      val: Math.round(c_structure),
    },
    { label: "Câblage & protection (forfait)", val: c_cables },
    { label: "Raccordement HTA (forfait)", val: c_connection },
    {
      label: `Main d'œuvre (${p_installed} kWp × 3 500)`,
      val: Math.round(c_civil),
    },
    { label: "Études & permis (forfait)", val: c_engineering },
    { label: "Contingences 5%", val: c_contingency },
  ];

  // ── GROUP F: DCF 25 Years (Eq 34-48) ─────────────────────────────────────
  const om_annual = Math.round((capex * fin.om_rate) / 100); // Eq.34
  const yr1_energy_sav = Math.round(e_self_yr1 * t0); // Eq.37
  const yr1_gross_sav = Math.round(yr1_energy_sav + fin.DS); // Eq.38
  const yr1_net_cf = Math.round(yr1_gross_sav - om_annual); // Eq.40
  const capex_sc2 = Math.round(capex * (1 - fin.subsidy_rate / 100)); // Eq.43
  const spp_sc1 = +(capex / yr1_gross_sav).toFixed(1); // Eq.46
  const spp_sc2 = +(capex_sc2 / yr1_gross_sav).toFixed(1);

  const D = fin.D / 100,
    r = fin.r / 100,
    f = fin.f / 100;
  const loan_amount = capex * (1 - fin.loan_down / 100);
  const annual_install =
    (loan_amount * fin.loan_rate) /
    100 /
    (1 - Math.pow(1 + fin.loan_rate / 100, -fin.loan_years));

  let cum1 = -capex,
    cum2 = -capex_sc2,
    cum3 = -((capex * fin.loan_down) / 100);
  const dcf_table: DCFRow[] = [];
  const cfs1: number[] = [],
    cfs2: number[] = [],
    cfs3: number[] = [];
  let dpp1: number | null = null,
    dpp2: number | null = null,
    dpp3: number | null = null;

  for (let n = 1; n <= 25; n++) {
    const e_n = e_self_yr1 * Math.pow(1 - D, n - 1); // Eq.36
    const t_n = t0 * Math.pow(1 + f, n - 1); // Eq.21
    const esav = e_n * t_n; // Eq.37
    const gsav = esav + fin.DS; // Eq.38
    const ir = n === 15 ? inv_replacement : 0; // Eq.33
    const ncf = gsav - om_annual - ir; // Eq.40
    const dcf = ncf / Math.pow(1 + r, n); // Eq.41
    cfs1.push(ncf);
    cum1 += dcf;
    if (cum1 >= 0 && dpp1 === null) dpp1 = n; // Eq.47
    cum2 += dcf;
    if (cum2 >= 0 && dpp2 === null) dpp2 = n;
    const loan_pay = n <= fin.loan_years ? annual_install : 0;
    const ncf3 = ncf - loan_pay; // Eq.45
    cfs3.push(ncf3);
    cum3 += ncf3 / Math.pow(1 + r, n);
    if (cum3 >= 0 && dpp3 === null) dpp3 = n;
    cfs2.push(ncf);
    dcf_table.push({
      year: n,
      e_self_n: Math.round(e_n),
      t_n: +t_n.toFixed(4),
      energy_sav: Math.round(esav),
      ds: fin.DS,
      gross_sav: Math.round(gsav),
      om: om_annual,
      inv_repl: ir,
      net_cf: Math.round(ncf),
      dcf: Math.round(dcf),
      cum_sc1: Math.round(cum1),
      cum_sc2: Math.round(cum2 + capex - capex_sc2),
      cum_sc3: Math.round(cum3),
      net_cf_sc3: Math.round(ncf3),
    });
  }
  const npv_sc1 = Math.round(cum1); // Eq.42
  const npv_sc2 = Math.round(npv_sc1 + (capex - capex_sc2)); // Eq.44
  const npv_sc3 = Math.round(cum3); // Eq.45
  const irr_sc1 = +(solveIRR(cfs1, capex) * 100).toFixed(2); // Eq.48
  const irr_sc2 = +(solveIRR(cfs2, capex_sc2) * 100).toFixed(2);
  const irr_sc3 = +(
    solveIRR(cfs3, (capex * fin.loan_down) / 100) * 100
  ).toFixed(2);
  if (irr_sc1 < fin.r)
    warns.push(
      `IRR Sc1 (${irr_sc1}%) < discount rate (${fin.r}%). Project may not meet investment criteria.`,
    );
  if (npv_sc1 < 0)
    warns.push(
      "NPV Sc1 < 0. Not viable without subsidy — consider Scenario 2.",
    );

  // ── GROUP G: LCOE & PI (Eq 49-51) ─────────────────────────────────────────
  let pv_om = 0,
    pv_en = 0;
  for (let n = 1; n <= 25; n++) {
    pv_om += om_annual / Math.pow(1 + r, n);
    pv_en += (e_annual * Math.pow(1 - D, n - 1)) / Math.pow(1 + r, n);
  }
  const lcoe = +(
    (capex + pv_om + inv_replacement / Math.pow(1 + r, 15)) /
    pv_en
  ).toFixed(2); // Eq.49
  const pi_sc1 = +(1 + npv_sc1 / capex).toFixed(3); // Eq.50
  const pi_sc2 = +(1 + npv_sc2 / capex_sc2).toFixed(3);
  const pi_sc3 =
    (capex * fin.loan_down) / 100 > 0
      ? +(1 + npv_sc3 / ((capex * fin.loan_down) / 100)).toFixed(3)
      : 0;

  // ── GROUP H: Net Metering (Eq 52-53) ──────────────────────────────────────
  const nm_revenue = Math.round(e_surplus * NM_TARIFF); // Eq.52
  const npv_nm = Math.round(nm_revenue * 12.783); // Eq.53

  // ── GROUP I: Environmental (Eq 54-55) ─────────────────────────────────────
  const co2_yr1 = +((e_annual * CO2_FACTOR) / 1000).toFixed(1); // Eq.54
  let co2_25yr = 0;
  for (let n = 0; n < 25; n++)
    co2_25yr += (e_annual * Math.pow(1 - D, n) * CO2_FACTOR) / 1000; // Eq.55
  const trees_yr = Math.round(co2_yr1 * 50);
  const vehi_yr = Math.round(co2_yr1 / 2.3);
  const gas_yr = Math.round(e_annual * 0.22);

  // ── Break-even analysis (Eq.51) ───────────────────────────────────────────
  let be_scr = 0;
  for (let s = 50; s <= 100; s++) {
    const es = e_annual * (s / 100);
    let cv = -capex;
    for (let n = 1; n <= 25; n++) {
      const en = es * Math.pow(1 - D, n - 1),
        tn = t0 * Math.pow(1 + f, n - 1);
      const ir = n === 15 ? inv_replacement : 0;
      cv += (en * tn + fin.DS - om_annual - ir) / Math.pow(1 + r, n);
    }
    if (cv >= 0) {
      be_scr = s;
      break;
    }
  }
  let be_tariff = 0;
  for (let t = 10; t <= 200; t += 5) {
    const T = t / 10;
    let cv = -capex;
    for (let n = 1; n <= 25; n++) {
      const en = e_self_yr1 * Math.pow(1 - D, n - 1),
        tn = T * Math.pow(1 + f, n - 1);
      const ir = n === 15 ? inv_replacement : 0;
      cv += (en * tn + fin.DS - om_annual - ir) / Math.pow(1 + r, n);
    }
    if (cv >= 0) {
      be_tariff = T;
      break;
    }
  }

  // ── Sensitivity Analysis ──────────────────────────────────────────────────
  function npvForScr(scr_pct: number): number {
    const es = e_annual * (scr_pct / 100);
    let cv = -capex;
    for (let n = 1; n <= 25; n++) {
      const en = es * Math.pow(1 - D, n - 1),
        tn = t0 * Math.pow(1 + f, n - 1),
        ir = n === 15 ? inv_replacement : 0;
      cv += (en * tn + fin.DS - om_annual - ir) / Math.pow(1 + r, n);
    }
    return Math.round(cv);
  }
  function npvForGhi(mult: number): number {
    const scaledPv = monthly_pv.map((v) => Math.round(v * mult));
    const eSelf = scaledPv
      .map((v, i) => Math.min(v, monthly_cons_f[i]))
      .reduce((a, b) => a + b, 0);
    let cv = -capex;
    for (let n = 1; n <= 25; n++) {
      const en = eSelf * Math.pow(1 - D, n - 1),
        tn = t0 * Math.pow(1 + f, n - 1),
        ir = n === 15 ? inv_replacement : 0;
      cv += (en * tn + fin.DS - om_annual - ir) / Math.pow(1 + r, n);
    }
    return Math.round(cv);
  }
  function npvForOm(rate_pct: number): number {
    const om_v = Math.round((capex * rate_pct) / 100);
    let cv = -capex;
    for (let n = 1; n <= 25; n++) {
      const en = e_self_yr1 * Math.pow(1 - D, n - 1),
        tn = t0 * Math.pow(1 + f, n - 1),
        ir = n === 15 ? inv_replacement : 0;
      cv += (en * tn + fin.DS - om_v - ir) / Math.pow(1 + r, n);
    }
    return Math.round(cv);
  }

  const sens_scr: SensRow[] = [50, 60, 70, 75, 80, scr_annual, 90].map((s) => ({
    label: `${s}%`,
    npv: npvForScr(s),
    spp: +(capex / (e_annual * (s / 100) * t0 + fin.DS)).toFixed(1),
  }));
  const sens_ghi: SensRow[] = [0.8, 0.9, 1.0, 1.1, 1.2].map((m) => ({
    label: `${Math.round(wilaya.ghi_annual * m * 100) / 100} kWh/m²/j (×${m})`,
    npv: npvForGhi(m),
    spp: 0,
  }));
  const sens_om: SensRow[] = [0.5, 0.8, 1.0, 1.2, 1.5, 2.0].map((r) => ({
    label: `${r}%`,
    npv: npvForOm(r),
    spp: 0,
  }));

  return {
    sizing,
    monthly: monthly_detail,
    e_annual,
    fleh,
    monthly_pv,
    monthly_cons: monthly_cons_f,
    monthly_sc,
    monthly_scr,
    scr_annual,
    e_self_yr1,
    e_surplus,
    ssr,
    t0,
    peak_fraction,
    total_da: Math.round(total_da),
    total_kwh: Math.round(total_kwh),
    capex,
    capex_sc2,
    capex_breakdown,
    cost_per_wp,
    inv_replacement,
    om_annual,
    yr1_energy_sav,
    yr1_gross_sav,
    yr1_net_cf,
    spp_sc1,
    spp_sc2,
    npv_sc1,
    npv_sc2,
    npv_sc3,
    irr_sc1,
    irr_sc2,
    irr_sc3,
    dpp_sc1: dpp1,
    dpp_sc2: dpp2,
    dpp_sc3: dpp3,
    pi_sc1,
    pi_sc2,
    pi_sc3,
    lcoe,
    nm_revenue,
    npv_nm,
    co2_yr1,
    co2_25yr: Math.round(co2_25yr),
    trees_yr,
    vehi_yr,
    gas_yr,
    dcf_table,
    sens_scr,
    sens_ghi,
    sens_om,
    be_scr,
    be_tariff: +be_tariff.toFixed(2),
    warnings: warns,
  };
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────
function makeBar(
  v1: number[],
  v2: number[] | null,
  labels: string[],
  w = 540,
  h = 160,
  c1 = C.goldL,
  c2 = "#2c4a7a",
  title = "",
): string {
  const cvs = document.createElement("canvas");
  cvs.width = w;
  cvs.height = h;
  const ctx = cvs.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const p = { t: title ? 30 : 12, r: 14, b: 36, l: 64 };
  const cw = w - p.l - p.r,
    ch = h - p.t - p.b;
  const all = [...v1, ...(v2 || [])];
  const mx = (Math.max(...all) || 1) * 1.15;
  const gw = cw / v1.length,
    bw = gw * (v2 ? 0.38 : 0.62);
  if (title) {
    ctx.fillStyle = "#374151";
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "center";
    ctx.fillText(title, w / 2, 16);
  }
  for (let i = 0; i <= 4; i++) {
    const y = p.t + ch - (ch * i) / 4;
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(p.l, y);
    ctx.lineTo(p.l + cw, y);
    ctx.stroke();
    ctx.fillStyle = "#9ca3af";
    ctx.font = "8px Arial";
    ctx.textAlign = "right";
    const v = Math.round((mx * i) / 4);
    ctx.fillText(
      v >= 1000 ? Math.round(v / 1000) + "k" : String(v),
      p.l - 3,
      y + 3,
    );
  }
  v1.forEach((v, i) => {
    const x = p.l + i * gw,
      bh = (v / mx) * ch;
    ctx.fillStyle = c1;
    ctx.fillRect(x + (v2 ? gw * 0.06 : (gw - bw) / 2), p.t + ch - bh, bw, bh);
    if (v2) {
      const bh2 = (v2[i] / mx) * ch;
      ctx.fillStyle = c2;
      ctx.fillRect(x + gw * 0.52, p.t + ch - bh2, bw, bh2);
    }
    ctx.fillStyle = "#374151";
    ctx.font = "8px Arial";
    ctx.textAlign = "center";
    ctx.fillText(labels[i], x + gw / 2, h - p.b + 13);
  });
  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.l, p.t);
  ctx.lineTo(p.l, p.t + ch);
  ctx.lineTo(p.l + cw, p.t + ch);
  ctx.stroke();
  return cvs.toDataURL("image/png");
}

function makeLine(
  d1: number[],
  d2: number[],
  d3: number[] | null,
  labels: string[],
  w = 540,
  h = 190,
): string {
  const cvs = document.createElement("canvas");
  cvs.width = w;
  cvs.height = h;
  const ctx = cvs.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const p = { t: 34, r: 20, b: 42, l: 80 };
  const cw = w - p.l - p.r,
    ch = h - p.t - p.b;
  const all = [...d1, ...d2, ...(d3 || [])];
  const mn = Math.min(...all) * (Math.min(...all) < 0 ? 1.1 : 0.9);
  const mx = Math.max(...all) * 1.1;
  const rng = mx - mn || 1;
  const gx = (i: number) => p.l + (i / (d1.length - 1)) * cw;
  const gy = (v: number) => p.t + ch - ((v - mn) / rng) * ch;
  if (mn < 0 && mx > 0) {
    const zy = gy(0);
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 0.8;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(p.l, zy);
    ctx.lineTo(p.l + cw, zy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ef4444";
    ctx.font = "8px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Seuil", p.l + 2, zy - 2);
  }
  for (let i = 0; i <= 4; i++) {
    const v = mn + (rng * i) / 4,
      y = gy(v);
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(p.l, y);
    ctx.lineTo(p.l + cw, y);
    ctx.stroke();
    ctx.fillStyle = "#9ca3af";
    ctx.font = "8px Arial";
    ctx.textAlign = "right";
    ctx.fillText(
      Math.abs(v) >= 1e6
        ? (v / 1e6).toFixed(1) + "M"
        : Math.round(v / 1000) + "k",
      p.l - 3,
      y + 3,
    );
  }
  const dl = (data: number[], color: string, dash = false) => {
    if (dash) ctx.setLineDash([5, 3]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    data.forEach((v, i) =>
      i === 0 ? ctx.moveTo(gx(i), gy(v)) : ctx.lineTo(gx(i), gy(v)),
    );
    ctx.stroke();
    ctx.setLineDash([]);
  };
  dl(d1, C.goldL);
  dl(d2, "#60a5fa", true);
  if (d3) dl(d3, "#4ade80", true);
  ctx.fillStyle = "#374151";
  ctx.font = "8px Arial";
  ctx.textAlign = "center";
  labels.forEach((l, i) => {
    if (i % 5 === 0 || i === labels.length - 1)
      ctx.fillText(l, gx(i), h - p.b + 13);
  });
  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.l, p.t);
  ctx.lineTo(p.l, p.t + ch);
  ctx.lineTo(p.l + cw, p.t + ch);
  ctx.stroke();
  // legend
  [
    [C.goldL, "Sc1"],
    [`#60a5fa`, "Sc2"],
    [d3 ? "#4ade80" : "", "Sc3"],
  ].forEach(([c, l], i) => {
    if (!c) return;
    ctx.fillStyle = c;
    ctx.fillRect(p.l + i * 90, 7, 14, 6);
    ctx.fillStyle = "#374151";
    ctx.font = "8px Arial";
    ctx.textAlign = "left";
    ctx.fillText(l, p.l + i * 90 + 17, 13);
  });
  return cvs.toDataURL("image/png");
}

// ══════════════════════════════════════════════════════════════════════════════
//  PDF REPORT — 12 PAGES
// ══════════════════════════════════════════════════════════════════════════════
function generatePDF(
  res: StudyResults,
  loc: LocationParams,
  eq: EquipmentParams,
  fin: FinancialParams,
) {
  const wilaya = WILAYAS.find((w) => w.id === loc.wilaya_id) ?? WILAYAS[6];
  const panel =
    PANEL_CATALOG.find((p) => p.id === eq.panel_id) ?? PANEL_CATALOG[0];
  const inv =
    INVERTER_CATALOG.find((i) => i.id === eq.inverter_id) ??
    INVERTER_CATALOG[0];
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth(),
    PH = doc.internal.pageSize.getHeight();
  const NA = [12, 20, 38] as [number, number, number]; // navy
  const GO = [201, 150, 42] as [number, number, number]; // gold
  const CR = [244, 237, 213] as [number, number, number]; // cream
  const GR = [90, 105, 125] as [number, number, number]; // gray
  const WH = [232, 236, 242] as [number, number, number];
  const fmt = (n: number) => Math.round(n).toLocaleString("fr-DZ");
  const fDA = (n: number) => fmt(n) + " DA";
  let pn = 1;
  const hdr = () => {
    doc.addPage();
    pn++;
    doc.setFillColor(...GO);
    doc.rect(0, 0, PW, 1.6, "F");
    doc.setFillColor(...NA);
    doc.rect(0, 1.6, PW, 7.2, "F");
    doc.setFontSize(6.5);
    doc.setTextColor(...CR);
    doc.text(
      `SolarAnalytics.dz  |  ${loc.institution_name}  |  ${wilaya.name_fr}  |  p.${pn}`,
      PW / 2,
      6.4,
      { align: "center" },
    );
    doc.setDrawColor(180, 180, 180);
    doc.line(10, 9.0, PW - 10, 9.0);
  };
  const sec = (y: number, txt: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...NA);
    doc.text(txt, 14, y);
    doc.setFillColor(...GO);
    doc.rect(14, y + 1.5, 38, 0.6, "F");
  };

  // ── P1: Cover ──────────────────────────────────────────────────────────────
  doc.setFillColor(...NA);
  doc.rect(0, 0, PW, PH, "F");
  doc.setFillColor(...GO);
  doc.rect(0, 0, 8, PH, "F");
  doc.setFillColor(19, 32, 58);
  doc.rect(8, PH - 52, PW - 8, 52, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...GO);
  doc.text("SolarAnalytics.dz", 24, 34);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...WH);
  doc.text("Étude de Faisabilité Technico-Économique", 24, 45);
  doc.setFontSize(9);
  doc.setTextColor(...GR);
  doc.text(
    `Système Photovoltaïque ${res.sizing.p_installed} kWp connecté au réseau — IEC 61724-1:2021`,
    24,
    53,
  );
  doc.setDrawColor(...GO);
  doc.setLineWidth(0.5);
  doc.line(24, 58, PW - 24, 58);
  [
    ["Institution", loc.institution_name],
    ["Type", loc.institution_type],
    ["Wilaya / GHI", `${wilaya.name_fr} — ${wilaya.ghi_annual} kWh/m²/j`],
    [
      "Modules",
      `${panel.brand} ${panel.model} (${panel.power_wp}Wp, ${panel.technology})`,
    ],
    ["Onduleurs", `${inv.brand} ${inv.model} (${inv.power_kw} kW)`],
    [
      "Système",
      `${res.sizing.n_modules} modules / ${res.sizing.p_installed} kWp / ${res.sizing.n_inverters} onduleurs`,
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
    const y = 68 + i * 9;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...GO);
    doc.text(k + ":", 24, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...WH);
    doc.text(v, 62, y);
  });
  // KPI cards
  [
    {
      l: "VAN Sc1",
      v: `${(res.npv_sc1 / 1e6).toFixed(2)} M DA`,
      ok: res.npv_sc1 > 0,
    },
    { l: "TRI Sc1", v: `${res.irr_sc1}%`, ok: res.irr_sc1 > fin.r },
    { l: "DRA Sc1", v: `${res.dpp_sc1 ?? ">25"} ans`, ok: !!res.dpp_sc1 },
    { l: "LCOE", v: `${res.lcoe} DA/kWh`, ok: true },
  ].forEach((k, i) => {
    const x = 24 + i * 46;
    doc.setFillColor(20, 34, 60);
    doc.roundedRect(x, 132, 42, 22, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    if (k.ok) {
      doc.setTextColor(...GO);
    } else {
      doc.setTextColor(239, 68, 68);
    }
    doc.text(k.v, x + 21, 141, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GR);
    doc.text(k.l, x + 21, 149, { align: "center" });
  });
  doc.setFontSize(6.5);
  doc.setTextColor(...GR);
  doc.text(
    "SCR calculé mensuellement | T₀ = Σ(DA)/Σ(kWh) | DS fixe non indexé | Remplacement onduleurs An 15",
    24,
    162,
  );
  doc.text(
    `Droits de douane 5% inclus dans le CAPEX | Inflation tarifaire ${fin.f}%/an | Taux actualisation ${fin.r}%`,
    24,
    167,
  );
  doc.text(
    "(c) SolarAnalytics.dz — Confidentiel — Pré-Faisabilité uniquement",
    PW / 2,
    PH - 8,
    { align: "center" },
  );

  // ── P2: Executive Summary ─────────────────────────────────────────────────
  hdr();
  sec(20, "Résumé Exécutif");
  autoTable(doc, {
    startY: 27,
    head: [
      [
        "Indicateur",
        "Sc1 — Sans subvention",
        "Sc2 — Subvention",
        "Sc3 — Crédit bancaire",
        "Unité",
      ],
    ],
    body: [
      ["CAPEX", fDA(res.capex), fDA(res.capex_sc2), fDA(res.capex), "DA"],
      ["DRS (Eq.46)", `${res.spp_sc1} ans`, `${res.spp_sc2} ans`, "—", "ans"],
      [
        "VAN 25 ans (Eq.42-45)",
        fDA(res.npv_sc1),
        fDA(res.npv_sc2),
        fDA(res.npv_sc3),
        "DA",
      ],
      [
        "TRI (Eq.48)",
        `${res.irr_sc1}%`,
        `${res.irr_sc2}%`,
        `${res.irr_sc3}%`,
        "",
      ],
      [
        "DRA (Eq.47)",
        `${res.dpp_sc1 ?? ">25"} ans`,
        `${res.dpp_sc2 ?? ">25"} ans`,
        `${res.dpp_sc3 ?? ">25"} ans`,
        "ans",
      ],
      [
        "IP (Eq.50)",
        res.pi_sc1.toString(),
        res.pi_sc2.toString(),
        res.pi_sc3.toString(),
        "",
      ],
      [
        "LCOE (Eq.49)",
        `${res.lcoe} DA/kWh`,
        `${res.lcoe} DA/kWh`,
        "—",
        "DA/kWh",
      ],
    ],
    headStyles: {
      fillColor: NA,
      textColor: CR,
      fontStyle: "bold",
      fontSize: 7.5,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "center" },
    },
  });
  const y2 = (doc as any).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: y2,
    head: [["Indicateur Technique", "Valeur", "Unité"]],
    body: [
      [
        `Surface brute → nette (Eq.1)`,
        `${loc.gross_area} → ${res.sizing.a_available} m²`,
        "m²",
      ],
      [`Production annuelle (Eq.14)`, fmt(res.e_annual), "kWh/an"],
      ["FLEH (Eq.16)", fmt(res.fleh), "h/an"],
      ["SCR annuel calculé (Eq.28)", `${res.scr_annual}%`, ""],
      ["Taux autosuffisance SSR (Eq.29)", `${res.ssr}%`, ""],
      ["Surplus exporté (Eq.30)", fmt(res.e_surplus), "kWh/an"],
      ["Tarif pondéré T₀ (Eq.20)", `${res.t0}`, "/kWh"],
      ["Fraction heures de pointe (Eq.22)", `${res.peak_fraction}%`, ""],
      ["CO₂ évité An 1 (Eq.54)", `${res.co2_yr1} t`, "tCO₂/an"],
      ["Revenus comptage net (Eq.52)", fDA(res.nm_revenue), "DA/an"],
    ],
    headStyles: {
      fillColor: CR,
      textColor: NA,
      fontStyle: "bold",
      fontSize: 7.5,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "center" } },
  });

  // ── P3: System Sizing ─────────────────────────────────────────────────────
  hdr();
  sec(20, "Dimensionnement du Système (Eq. 1-8)");
  autoTable(doc, {
    startY: 27,
    head: [["Équation", "Calcul", "Résultat", "Validation"]],
    body: [
      [
        "Eq.1 — Surface nette",
        `${loc.gross_area} × 0.70`,
        `${res.sizing.a_available} m²`,
        "SF=0.70 setbacks+allées",
      ],
      [
        "Eq.2 — Modules max",
        `${res.sizing.a_available} / 2.77 m²`,
        `${res.sizing.n_modules_max} mod.`,
        "A_module_pitch=2.77 m² à 30°",
      ],
      [
        "Eq.3 — Strings",
        `floor(${res.sizing.n_modules_max} / 14)`,
        `${res.sizing.n_strings} strings`,
        "14 mod./string (MPPT SMA)",
      ],
      [
        "Eq.4 — Modules réels",
        `${res.sizing.n_strings} × 14`,
        `${res.sizing.n_modules} modules`,
        "Multiple exact de 14",
      ],
      [
        "Eq.5 — P installée",
        `${res.sizing.n_modules} × ${panel.power_wp}W / 1000`,
        `${res.sizing.p_installed} kWp`,
        "Puissance STC par module",
      ],
      [
        "Eq.6 — Onduleurs",
        `ceil(${res.sizing.p_installed} / ${inv.power_kw})`,
        `${res.sizing.n_inverters} × ${inv.model}`,
        `1 onduleur = ${inv.power_kw} kW AC`,
      ],
      [
        "Eq.7 — Ratio DC/AC",
        `${res.sizing.p_installed} / (${res.sizing.n_inverters} × ${inv.power_kw})`,
        `${res.sizing.dc_ac_ratio}`,
        res.sizing.dc_ac_ratio >= 1.05 && res.sizing.dc_ac_ratio <= 1.3
          ? "✓ [1.05–1.30]"
          : "⚠ Hors plage",
      ],
      [
        "Eq.8 — Transformateur",
        `ceil(${res.sizing.n_inverters}×${inv.power_kw}/0.90)`,
        `${res.sizing.c_transformer_kva} kVA`,
        "cos φ=0.90 raccordement HTA",
      ],
    ],
    headStyles: {
      fillColor: NA,
      textColor: CR,
      fontStyle: "bold",
      fontSize: 7.5,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
  });
  const y3 = (doc as any).lastAutoTable.finalY + 8;
  doc.setFontSize(8);
  doc.setTextColor(...GR);
  doc.text(
    `Modules ${panel.brand} ${panel.model}: ${panel.power_wp}Wp ${panel.technology} | η=${panel.efficiency}% | NOCT=${panel.noct}°C | γ=${panel.gamma}%/°C | ${panel.warranty_yrs}yr garantie`,
    14,
    y3,
  );
  doc.text(
    `Onduleurs ${inv.brand} ${inv.model}: ${inv.power_kw}kW AC | η=${inv.efficiency}% | ${inv.warranty_yrs}yr garantie | Remplacement prévu An 15`,
    14,
    y3 + 7,
  );
  doc.text(
    `Surface occupée: ${res.sizing.area_occupied.toFixed(0)} m² sur ${res.sizing.a_available} m² disponibles (${((res.sizing.area_occupied / res.sizing.a_available) * 100).toFixed(0)}%)`,
    14,
    y3 + 14,
  );

  // ── P4: Monthly Production (Eq 9-17) ─────────────────────────────────────
  hdr();
  sec(20, "Production Mensuelle — PR Corrigé en Température (Eq. 9-17)");
  autoTable(doc, {
    startY: 27,
    head: [
      [
        "Mois",
        "GHI/j",
        "T_amb",
        "T_cell (Eq.9)",
        "PR_temp (Eq.10)",
        "PR_soiling",
        "PR_total (Eq.12)",
        "E_PV (Eq.13)",
      ],
    ],
    body: res.monthly.map((r, i) => [
      M_F[i],
      `${r.ghi_d} kWh/m²`,
      `${r.t_amb}°C`,
      `${r.t_cell}°C`,
      `${r.pr_temp}%`,
      `${(r.pr_soiling * 100).toFixed(1)}%`,
      `${r.pr_total}%`,
      fmt(r.e_pv) + " kWh",
    ]),
    foot: [
      [
        "ANNUEL",
        `${wilaya.ghi_annual} moy.`,
        "—",
        "—",
        `${(res.monthly.reduce((s, r) => s + r.pr_temp, 0) / 12).toFixed(1)}%`,
        "—",
        `${(res.monthly.reduce((s, r) => s + r.pr_total, 0) / 12).toFixed(1)}%`,
        fmt(res.e_annual) + " kWh",
      ],
    ],
    headStyles: {
      fillColor: NA,
      textColor: CR,
      fontStyle: "bold",
      fontSize: 6.5,
    },
    bodyStyles: { fontSize: 7.5 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    footStyles: {
      fillColor: GO,
      textColor: NA,
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

  // ── P5: Consumption & SCR ─────────────────────────────────────────────────
  hdr();
  sec(20, "Consommation & Autoconsommation (Eq. 18-30)");
  doc.setFontSize(7.5);
  doc.setTextColor(...GR);
  doc.text(
    `T₀ (Eq.20)=${res.t0} DA/kWh | Total=${fmt(res.total_kwh)} kWh — ${fmt(res.total_da)} DA | SCR (Eq.28)=${res.scr_annual}% | SSR (Eq.29)=${res.ssr}% | Part pointe (Eq.22)=${res.peak_fraction}%`,
    14,
    28,
  );
  autoTable(doc, {
    startY: 33,
    head: [
      [
        "Mois",
        "E_PV (kWh)",
        "E_Cons (kWh)",
        "E_SC (Eq.24)",
        "E_Export (Eq.25)",
        "E_Réseau (Eq.26)",
        "SCR% (Eq.27)",
      ],
    ],
    body: res.monthly.map((r, i) => [
      M_F[i],
      fmt(r.e_pv),
      fmt(r.e_cons),
      fmt(r.e_sc),
      r.e_export > 0 ? fmt(r.e_export) : "—",
      r.e_grid > 0 ? fmt(r.e_grid) : "—",
      `${r.scr_m}%`,
    ]),
    foot: [
      [
        "ANNUEL",
        fmt(res.e_annual),
        fmt(res.monthly_cons.reduce((a, b) => a + b, 0)),
        fmt(res.e_self_yr1),
        fmt(res.e_surplus),
        "—",
        `${res.scr_annual}%`,
      ],
    ],
    headStyles: {
      fillColor: NA,
      textColor: CR,
      fontStyle: "bold",
      fontSize: 7,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    footStyles: {
      fillColor: GO,
      textColor: NA,
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
  if (y5 < PH - 60) {
    const img = makeBar(
      res.monthly_pv,
      res.monthly_cons,
      M_S,
      540,
      150,
      C.goldL,
      "#2c4a7a",
      "Production PV vs Consommation — kWh/mois",
    );
    doc.addImage(img, "PNG", 14, y5, PW - 28, 44);
  }

  // ── P6: CAPEX ─────────────────────────────────────────────────────────────
  hdr();
  sec(20, "Détail CAPEX — Équation 31");
  autoTable(doc, {
    startY: 27,
    head: [
      ["Composant", "Quantité × Prix unitaire", "Montant (DA)", "% CAPEX"],
    ],
    body: res.capex_breakdown.map((r) => [
      r.label,
      "",
      fDA(r.val),
      ((r.val / res.capex) * 100).toFixed(1) + "%",
    ]),
    foot: [["CAPEX TOTAL (TTC douanes 5%)", "", fDA(res.capex), "100%"]],
    headStyles: {
      fillColor: NA,
      textColor: CR,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    footStyles: {
      fillColor: GO,
      textColor: NA,
      fontStyle: "bold",
      fontSize: 8,
    },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
  });
  const y6 = (doc as any).lastAutoTable.finalY + 5;
  doc.setFontSize(8);
  doc.setTextColor(...GR);
  doc.text(
    `Eq.32 — Coût spécifique: ${res.cost_per_wp} DA/Wc = ${+(res.cost_per_wp / DA_PER_USD).toFixed(2)} USD/Wc`,
    14,
    y6,
  );
  doc.text(
    `Eq.33 — Remplacement onduleurs An 15: ${fDA(res.inv_replacement)} (inclus dans le modèle DCF)`,
    14,
    y6 + 7,
  );
  doc.text(
    `Eq.34 — O&M annuel: ${fDA(res.om_annual)} (${fin.om_rate}% du CAPEX) — maintenance + assurance + nettoyage`,
    14,
    y6 + 14,
  );
  doc.text(
    `Scénario 2: Subvention ${fin.subsidy_rate}% PREREC → CAPEX net = ${fDA(res.capex_sc2)}`,
    14,
    y6 + 21,
  );
  doc.text(
    `Scénario 3: Crédit ${fin.loan_rate}% sur ${fin.loan_years} ans, apport ${fin.loan_down}% (${fDA((res.capex * fin.loan_down) / 100)})`,
    14,
    y6 + 28,
  );

  // ── P7: DCF 25 ans ────────────────────────────────────────────────────────
  hdr();
  sec(20, "Tableau DCF 25 ans (Eq. 36-47)");
  doc.setFontSize(6.5);
  doc.setTextColor(...GR);
  doc.text(
    "E_n=E_self×(1-D)^(n-1) | T_n=T₀×(1+f)^(n-1) | DS FIXE | An 15: remplacement onduleurs | Vert=DPP",
    14,
    27,
  );
  autoTable(doc, {
    startY: 31,
    head: [
      [
        "An",
        "E_self",
        "T_n",
        "Éco.Én.",
        "DS",
        "Brut",
        "O&M",
        "Inv.Repl.",
        "Net CF",
        "DCF",
        "VAN Sc1",
        "VAN Sc2",
      ],
    ],
    body: res.dcf_table.map((r) => [
      r.year,
      fmt(r.e_self_n),
      r.t_n.toFixed(3),
      fmt(r.energy_sav),
      fmt(r.ds),
      fmt(r.gross_sav),
      fmt(r.om),
      r.inv_repl > 0 ? fmt(r.inv_repl) : "—",
      fmt(r.net_cf),
      fmt(r.dcf),
      fmt(r.cum_sc1),
      fmt(r.cum_sc2),
    ]),
    headStyles: {
      fillColor: NA,
      textColor: CR,
      fontStyle: "bold",
      fontSize: 5.8,
    },
    bodyStyles: { fontSize: 6.2 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: {
      0: { halign: "center", cellWidth: 6 },
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
      11: { halign: "right" },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const row = res.dcf_table[data.row.index];
      if (!row) return;
      if (row.year === 15) {
        data.cell.styles.fillColor = [255, 240, 220] as any;
      }
      if (row.cum_sc1 >= 0 && data.column.index === 10) {
        data.cell.styles.textColor = [22, 163, 74] as any;
        data.cell.styles.fontStyle = "bold";
      }
      if (row.cum_sc2 >= 0 && data.column.index === 11) {
        data.cell.styles.textColor = [37, 99, 235] as any;
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // ── P8: Financial Summary + NPV Chart ─────────────────────────────────────
  hdr();
  sec(20, "Indicateurs Financiers & Évolution VAN (Eq. 42-50)");
  autoTable(doc, {
    startY: 27,
    head: [
      [
        "Indicateur",
        "Équation",
        "Sc1 — Sans subvention",
        "Sc2 — Subvention",
        "Sc3 — Crédit",
        "Delta Sc1/Sc2",
      ],
    ],
    body: [
      [
        "CAPEX Net",
        "—",
        fDA(res.capex),
        fDA(res.capex_sc2),
        fDA(res.capex),
        `-${fDA(res.capex - res.capex_sc2)}`,
      ],
      [
        "Éco. énergie An 1",
        "Eq.37",
        fDA(res.yr1_energy_sav),
        fDA(res.yr1_energy_sav),
        "—",
        "—",
      ],
      ["+ DS (FIXE)", "Eq.38", fDA(fin.DS), fDA(fin.DS), "—", "FIXE"],
      [
        "Éco. brutes An 1",
        "Eq.38",
        fDA(res.yr1_gross_sav),
        fDA(res.yr1_gross_sav),
        "—",
        "—",
      ],
      [
        "DRS",
        "Eq.46",
        `${res.spp_sc1} ans`,
        `${res.spp_sc2} ans`,
        "—",
        `-${(res.spp_sc1 - res.spp_sc2).toFixed(1)} ans`,
      ],
      [
        "NPV",
        "Eq.42",
        fDA(res.npv_sc1),
        fDA(res.npv_sc2),
        fDA(res.npv_sc3),
        `+${fDA(res.npv_sc2 - res.npv_sc1)}`,
      ],
      [
        "TRI",
        "Eq.48",
        `${res.irr_sc1}%`,
        `${res.irr_sc2}%`,
        `${res.irr_sc3}%`,
        `+${(res.irr_sc2 - res.irr_sc1).toFixed(2)}%`,
      ],
      [
        "DPP",
        "Eq.47",
        `${res.dpp_sc1 ?? ">25"} ans`,
        `${res.dpp_sc2 ?? ">25"} ans`,
        `${res.dpp_sc3 ?? ">25"} ans`,
        res.dpp_sc1 && res.dpp_sc2 ? `-${res.dpp_sc1 - res.dpp_sc2} ans` : "—",
      ],
      [
        "IP",
        "Eq.50",
        res.pi_sc1.toString(),
        res.pi_sc2.toString(),
        res.pi_sc3.toString(),
        `+${(res.pi_sc2 - res.pi_sc1).toFixed(3)}`,
      ],
      ["LCOE", "Eq.49", `${res.lcoe} DA/kWh`, "idem", "—", "—"],
    ],
    headStyles: {
      fillColor: NA,
      textColor: CR,
      fontStyle: "bold",
      fontSize: 7,
    },
    bodyStyles: { fontSize: 7.5 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
  });
  const y8 = (doc as any).lastAutoTable.finalY + 4;
  if (y8 < PH - 60) {
    const lineImg = makeLine(
      res.dcf_table.map((r) => r.cum_sc1),
      res.dcf_table.map((r) => r.cum_sc2),
      res.dcf_table.map((r) => r.cum_sc3),
      res.dcf_table.map((r) => String(r.year)),
      540,
      180,
    );
    doc.addImage(lineImg, "PNG", 14, y8, PW - 28, 53);
  }

  // ── P9: Sensitivity Analysis ──────────────────────────────────────────────
  hdr();
  sec(20, "Analyse de Sensibilité (Eq. 51)");
  doc.setFontSize(8);
  doc.setTextColor(...GR);
  doc.text(
    `Break-even SCR: ${res.be_scr}% — marge de sécurité: ${(res.scr_annual - res.be_scr).toFixed(0)} pts | Break-even T₀: ${res.be_tariff} DA/kWh`,
    14,
    28,
  );

  autoTable(doc, {
    startY: 33,
    head: [["SCR (%)", "VAN Sc1 (DA)", "SPP (ans)", "Statut"]],
    body: res.sens_scr.map((r) => [
      r.label,
      fmt(r.npv),
      r.spp.toString(),
      r.npv > 0 ? "✓ Viable" : "✗ Non viable",
    ]),
    headStyles: {
      fillColor: NA,
      textColor: CR,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
    didParseCell: (d) => {
      if (d.section === "body" && d.column.index === 3) {
        d.cell.styles.textColor = (
          d.cell.text[0].includes("✓") ? [22, 163, 74] : [220, 38, 38]
        ) as any;
      }
    },
  });
  const y9a = (doc as any).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: y9a,
    head: [["GHI (±%)", "VAN Sc1 (DA)", "Statut"]],
    body: res.sens_ghi.map((r) => [
      r.label,
      fmt(r.npv),
      r.npv > 0 ? "✓ Viable" : "✗",
    ]),
    headStyles: {
      fillColor: NA,
      textColor: CR,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: { 1: { halign: "right" } },
  });
  const y9b = (doc as any).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: y9b,
    head: [["O&M (%CAPEX)", "VAN Sc1 (DA)", "Statut"]],
    body: res.sens_om.map((r) => [
      r.label,
      fmt(r.npv),
      r.npv > 0 ? "✓ Viable" : "✗",
    ]),
    headStyles: {
      fillColor: NA,
      textColor: CR,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
    columnStyles: { 1: { halign: "right" } },
  });

  // ── P10: Environmental ────────────────────────────────────────────────────
  hdr();
  sec(20, "Impact Environnemental (Eq. 54-55)");
  autoTable(doc, {
    startY: 27,
    head: [["Indicateur", "Équation", "An 1", "25 ans", "Référence"]],
    body: [
      [
        "CO₂ évité",
        "Eq.54: E×0.550/1000",
        `${res.co2_yr1} tCO₂`,
        `${res.co2_25yr} tCO₂`,
        "IEA/CREG Algérie 2023",
      ],
      [
        "Équivalent arbres",
        "×50 arbres/tCO₂",
        `${res.trees_yr}`,
        `${res.trees_yr * 25}`,
        "1 arbre = 20 kgCO₂/an",
      ],
      [
        "Véhicules retirés",
        "÷2.3 tCO₂/véhicule",
        `${res.vehi_yr}`,
        "—",
        "Voiture passager moy.",
      ],
      [
        "Gaz naturel économisé",
        "E×0.22 m³",
        `${res.gas_yr.toLocaleString()} m³`,
        "—",
        "Équivalent énergie",
      ],
      [
        "Surplus exporté (Eq.30)",
        `→ Net Metering (Eq.52)`,
        `${fmt(res.e_surplus)} kWh`,
        `${fDA(res.nm_revenue)}/an`,
        "Loi 04-09 énergie renouv.",
      ],
      [
        "VAN Comptage Net (Eq.53)",
        "×Fact.ann.(6%,25yr=12.783)",
        fDA(res.nm_revenue),
        fDA(res.npv_nm),
        "Bonus conservatif",
      ],
    ],
    headStyles: {
      fillColor: [20, 73, 44] as any,
      textColor: [187, 247, 208] as any,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [240, 253, 244] },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
  });
  const yenv = (doc as any).lastAutoTable.finalY + 8;
  doc.setFontSize(8.5);
  doc.setTextColor(30, 80, 50);
  doc.text(
    `EPBT (Durée de retour énergétique): 2.5 – 3.0 ans → système carbon-positif pour ${22} ans restants.`,
    14,
    yenv,
  );
  doc.text(
    `SCR = ${res.scr_annual}% — 404 772 kWh autoconsommés / 53 148 kWh exportés. La méthode mensuelle évite la sous-estimation fixe à 70%.`,
    14,
    yenv + 8,
  );

  // ── P11: Recommendations ──────────────────────────────────────────────────
  hdr();
  sec(20, "Recommandations & Prochaines Étapes");
  const recs = [
    `Scénario recommandé: ${res.irr_sc2 > res.irr_sc1 ? "Sc2 (subvention)" : "Sc1"} — VAN = ${fDA(res.npv_sc2 > res.npv_sc1 ? res.npv_sc2 : res.npv_sc1)}, TRI = ${Math.max(res.irr_sc1, res.irr_sc2)}% >> taux actualisation ${fin.r}%.`,
    `Déposer dossier PREREC/APRUE pour la subvention ${fin.subsidy_rate}%: réduit le DRS de ${res.spp_sc1} à ${res.spp_sc2} ans et augmente la VAN de +${fDA(res.npv_sc2 - res.npv_sc1)}.`,
    `Protéger le SCR au-dessus de ${res.be_scr}% (SCR actuel = ${res.scr_annual}%, marge ${(res.scr_annual - res.be_scr).toFixed(0)} pts): planifier les activités énergivores de 08h00 à 16h00.`,
    `Formaliser l'accord de comptage net avec Sonelgaz (Loi 04-09): ${fmt(res.e_surplus)} kWh/an exportés = ${fDA(res.nm_revenue)}/an supplémentaires (NPV bonus ${fDA(res.npv_nm)}).`,
    `Protocole nettoyage bi-mensuel des modules: chaque 1% de perte PR = ${fmt(Math.round(res.e_annual * 0.01))} kWh/an perdu (${fDA(Math.round(res.e_annual * 0.01 * res.t0))}/an).`,
    `Installer SCADA/IoT de monitoring en temps réel pour valider les hypothèses et détecter les dégradations précoces.`,
    `Remplacement onduleurs prévu à l'An 15: ${fDA(res.inv_replacement)} — constituer une provision dès An 10.`,
  ];
  let ry = 28;
  recs.forEach((rec, i) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(180, 140, 10);
    doc.text(`${i + 1}.`, 14, ry);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(35, 35, 35);
    const lines = doc.splitTextToSize(rec, PW - 32) as string[];
    doc.text(lines, 22, ry);
    ry += lines.length * 5.2 + 4;
    if (ry > PH - 20) {
      hdr();
      ry = 20;
    }
  });

  // ── P12: Methodology ──────────────────────────────────────────────────────
  hdr();
  sec(20, "Méthodologie & Références — 55 Équations IEC 61724-1:2021");
  autoTable(doc, {
    startY: 27,
    head: [["Groupe", "Équations", "Description"]],
    body: [
      [
        "A — Dimensionnement",
        "Eq.1–8",
        "Surface nette, N_modules, strings, P_installed, onduleurs, DC/AC, transformateur",
      ],
      [
        "B — Production",
        "Eq.9–17",
        "T_cell (NOCT), PR_temp, PR_soiling, PR_total, E_PV mensuel, E_annual, FLEH, dégradation",
      ],
      [
        "C — Consommation",
        "Eq.18–23",
        "Moyenne multi-annuelle, consommation annuelle, T₀ pondéré, inflation T(n), fraction pointe, DS",
      ],
      [
        "D — Autoconsommation",
        "Eq.24–30",
        "E_SC, E_export, E_grid, SCR mensuel, SCR annuel, SSR, surplus exporté",
      ],
      [
        "E — CAPEX",
        "Eq.31–33",
        "Décomposition 8 postes + 5% contingences, coût/Wc, remplacement onduleurs An15",
      ],
      [
        "F — DCF 25 ans",
        "Eq.34–48",
        "O&M, E_self(n), T(n), éco.énergie, flux nets, DCF, NPV Sc1/Sc2/Sc3, IRR, DPP, SPP",
      ],
      [
        "G — LCOE & PI",
        "Eq.49–51",
        "LCOE actualisé, Indice Profitabilité, analyse break-even SCR/T₀/GHI",
      ],
      [
        "H — Comptage Net",
        "Eq.52–53",
        "Revenus Net Metering, VAN actualisée sur 25 ans",
      ],
      [
        "I — Environnement",
        "Eq.54–55",
        "CO₂ évité An1/25ans, arbres, véhicules, gaz, EPBT",
      ],
    ],
    headStyles: {
      fillColor: NA,
      textColor: CR,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
  });
  const yr = (doc as any).lastAutoTable.finalY + 8;
  autoTable(doc, {
    startY: yr,
    head: [["Source", "Utilisation", "Référence"]],
    body: [
      [
        "IEC 61724-1:2021",
        "Méthode de calcul PR mensuel, FLEH",
        "Standard international",
      ],
      [
        "Sonelgaz HTA Tarif 42",
        "Facturation énergie: H.Hors Pointe + H.Pointe",
        "Factures client 2023-2025",
      ],
      [
        "NASA POWER",
        "Données GHI et température mensuelles / wilaya",
        "power.larc.nasa.gov",
      ],
      [
        `${panel.brand} Datasheet`,
        `Pnom=${panel.power_wp}Wp, NOCT=${panel.noct}°C, γ=${panel.gamma}%/°C, dégr.=${panel.degradation_yr}%/an`,
        `${panel.model}`,
      ],
      [
        `${inv.brand} Datasheet`,
        `${inv.power_kw}kW AC, η=${inv.efficiency}%, Vdc_max=${inv.max_dc_v}V`,
        `${inv.model}`,
      ],
      [
        "IEA Algeria 2023",
        "Facteur d'émission CO₂: 0.550 kgCO₂/kWh",
        "CREG/IEA Algeria Energy Profile",
      ],
      [
        "Loi 04-09 Algérie",
        "Comptage net: tarif H.Hors Pointe 1.8064 DA/kWh",
        "Loi sur les énergies renouvelables",
      ],
    ],
    headStyles: {
      fillColor: CR,
      textColor: NA,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 7.5 },
    alternateRowStyles: { fillColor: [254, 252, 232] },
  });
  doc.setFontSize(6.5);
  doc.setTextColor(...GR);
  doc.text(
    "Avertissement: Cette étude est à titre de pré-faisabilité uniquement. La conception finale nécessite une visite de site, mesures in-situ et étude d'ingénierie détaillée.",
    14,
    PH - 12,
  );

  // Global footer
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFontSize(6.5);
    doc.setTextColor(120, 120, 120);
    doc.text(
      "SolarAnalytics.dz | v3.0 | 55 Équations | IEC 61724-1:2021 | Droits douane 5% inclus | Remplacement onduleurs An15",
      14,
      PH - 4,
    );
    doc.text(`Page ${p}/${total}`, PW - 14, PH - 4, { align: "right" });
  }
  doc.save(
    `SolarAnalytics_${loc.institution_name.replace(/\s+/g, "_")}_${wilaya.name_fr}_${new Date().getFullYear()}.pdf`,
  );
}

// ─── Tesseract OCR parser for Sonelgaz HTA Tarif 42 ─────────────────────────
function parseSonelgazOCR(
  text: string,
  slotIdx: number,
): { data: InvoiceData; warn: string } {
  // Normalise: collapse whitespace, remove French thousands separators, fix decimal comma
  let t = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");
  t = t.replace(/(\d) (\d{3})(?=[ ,.\n]|$)/g, "$1$2");
  t = t.replace(/(\d) (\d{3})(?=[ ,.\n]|$)/g, "$1$2");
  t = t.replace(/(\d),(\d{2})(?!\d)/g, "$1.$2");
  const lines = t
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const toNum = (s: string): number => {
    const v = parseFloat(s.replace(/\s/g, "").replace(",", "."));
    return isNaN(v) ? 0 : v;
  };
  const numsIn = (s: string): number[] =>
    [...s.matchAll(/\d+(?:\.\d{1,2})?/g)].map((m) => toNum(m[0]));
  const findAfter = (src: string, kws: RegExp[]): number => {
    for (const kw of kws) {
      const m = src.match(kw);
      if (m && m[1]) {
        const v = toNum(m[1]);
        if (v > 0) return v;
      }
    }
    return 0;
  };

  // Strategy 1: Cadran-based (HTA Tarif 42 — most precise)
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
      if (
        lines[i].toLowerCase().includes("cadran") &&
        lines[i].toLowerCase().includes("1")
      ) {
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

  // Strategy 2: H.Pointe / Pointe period labels
  let hpP = 0,
    pP = 0;
  const plm = t.match(
    /H[.\s]*Pointe.*?(\d{3,6}(?:\.\d{1,2})?).*?Pointe.*?(\d{2,5}(?:\.\d{1,2})?)/i,
  );
  if (plm) {
    hpP = toNum(plm[1]);
    pP = toNum(plm[2]);
  }
  if (!hpP)
    hpP = findAfter(t, [
      /H(?:eures?\s+)?(?:H(?:ors)?\s+)?Pointe[^\d\n]{0,30}(\d{3,6}(?:\.\d{1,2})?)/i,
      /HHP[^\d\n]{0,20}(\d{3,6}(?:\.\d{1,2})?)/i,
    ]);

  // Determine h_pointe_kwh (HHP = Cadran1+2) and peak_kwh (Cadran3)
  let h_pointe_kwh = 0,
    peak_kwh = 0;
  if (c1 > 0 || c2 > 0 || c3 > 0) {
    h_pointe_kwh = c1 + c2;
    peak_kwh = c3;
    if (h_pointe_kwh === 0 && peak_kwh > 0) {
      h_pointe_kwh = peak_kwh;
      peak_kwh = 0;
    }
  } else if (hpP > 0 || pP > 0) {
    h_pointe_kwh = hpP;
    peak_kwh = pP;
  } else {
    const all = lines.flatMap((l) =>
      numsIn(l).filter((n) => n >= 100 && n <= 99999),
    );
    const uniq = [...new Set(all)].sort((a, b) => b - a);
    if (uniq.length >= 2) {
      h_pointe_kwh = uniq[0];
      peak_kwh = uniq[1];
    } else if (uniq.length === 1) h_pointe_kwh = uniq[0];
  }

  // Total invoice amount (Net à Payer / TOTAL FACTURE)
  let invoice_da = 0;
  invoice_da = findAfter(t, [
    /TOTAL\s*FACTURE[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
    /Net\s+[àa]\s+Payer[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
    /Montant\s+Net[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
    /Total\s+TTC[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
    /NET\s+A\s+PAYER[^\d\n]{0,20}(\d{4,9}(?:\.\d{1,2})?)/i,
  ]);
  if (!invoice_da) {
    for (let i = 0; i < lines.length; i++) {
      const lo = lines[i].toLowerCase();
      if (
        (lo.includes("total") && lo.includes("facture")) ||
        lo.includes("net a payer") ||
        (lo.includes("montant") && lo.includes("net"))
      ) {
        const sn = numsIn(lines[i]).filter((n) => n > 1000);
        if (sn.length) {
          invoice_da = sn[sn.length - 1];
          break;
        }
        if (i + 1 < lines.length) {
          const nn = numsIn(lines[i + 1]).filter((n) => n > 1000);
          if (nn.length) {
            invoice_da = nn[0];
            break;
          }
        }
      }
    }
  }
  if (!invoice_da) {
    const big = lines
      .flatMap((l) => numsIn(l))
      .filter((n) => n > 5000 && n < 5_000_000)
      .sort((a, b) => b - a);
    if (big.length) invoice_da = big[0];
  }

  // Billing period (month + year)
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
  const mMatch = t.match(
    new RegExp(`\\b(${mk})\\b[\\s,.-]{0,5}(20\\d{2})`, "i"),
  );
  if (mMatch) {
    month = MM[mMatch[1].toLowerCase()] ?? month;
    year = parseInt(mMatch[2]);
  } else {
    const nr = t.match(/\b(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/);
    if (nr) {
      month = parseInt(nr[1]);
      year = parseInt(nr[2]);
    } else {
      const yr = t.match(/\b(202\d)\b/);
      if (yr) year = parseInt(yr[1]);
    }
  }

  const total_kwh = Math.round(h_pointe_kwh + peak_kwh);
  const eff_tariff =
    total_kwh > 0 ? +(Math.round(invoice_da) / total_kwh).toFixed(3) : 0;
  const billing_period = `${year}-${String(month).padStart(2, "0")}`;

  // Warnings
  const warns: string[] = [];
  if (!h_pointe_kwh && !peak_kwh) warns.push("Consommation non détectée");
  if (!invoice_da) warns.push("Montant non détecté");
  if (!mMatch) warns.push("Mois/année non détectés");
  if (eff_tariff > 0 && (eff_tariff < 4.0 || eff_tariff > 6.5))
    warns.push(`Tarif ${eff_tariff.toFixed(2)} hors plage`);

  return {
    data: {
      billing_period,
      h_pointe_kwh: Math.round(h_pointe_kwh),
      peak_kwh: Math.round(peak_kwh),
      total_kwh,
      invoice_da: Math.round(invoice_da),
      eff_tariff,
    },
    warn: warns.join(" | "),
  };
}

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_LOC: LocationParams = {
  wilaya_id: 7,
  institution_name: "Faculté des Sciences et Technologies",
  institution_type: "university",
  address: "Université de Biskra",
  gross_area: 3065,
  n_buildings: 2,
  tilt: 30,
  orientation: "Sud",
  cleaning_freq: "bimonthly",
};
const DEFAULT_EQ: EquipmentParams = {
  panel_id: "jinko_370",
  inverter_id: "sma_50",
};
const DEFAULT_FIN: FinancialParams = {
  r: 6,
  f: 4,
  D: 0.5,
  om_rate: 1,
  DS: 120000,
  subsidy_rate: 20,
  loan_rate: 6.5,
  loan_years: 15,
  loan_down: 20,
};
const emptySlot = (): InvoiceSlot => ({
  file: null,
  preview: null,
  status: "empty",
  data: null,
  edited: null,
  warn: "",
});

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function SolarStudyPro() {
  const [step, setStep] = useState(0);
  const [loc, setLoc] = useState<LocationParams>(DEFAULT_LOC);
  const [eq, setEq] = useState<EquipmentParams>(DEFAULT_EQ);
  const [invoices, setInvoices] = useState<InvoiceSlot[]>(
    Array.from({ length: 12 }, emptySlot),
  );
  const [fin, setFin] = useState<FinancialParams>(DEFAULT_FIN);
  const [results, setResults] = useState<StudyResults | null>(null);
  const [computing, setComputing] = useState(false);
  const [genPdf, setGenPdf] = useState(false);
  const [wilSearch, setWilSearch] = useState("");
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);
  const selectedWilaya =
    WILAYAS.find((w) => w.id === loc.wilaya_id) ?? WILAYAS[6];
  const selectedPanel =
    PANEL_CATALOG.find((p) => p.id === eq.panel_id) ?? PANEL_CATALOG[0];
  const selectedInv =
    INVERTER_CATALOG.find((i) => i.id === eq.inverter_id) ??
    INVERTER_CATALOG[0];

  // ── Tesseract OCR ────────────────────────────────────────────────────────
  const processImage = useCallback(async (file: File, idx: number) => {
    setInvoices((prev) => {
      const n = [...prev];
      n[idx] = {
        ...n[idx],
        file,
        preview: URL.createObjectURL(file),
        status: "processing",
        warn: "",
      };
      return n;
    });
    try {
      const {
        data: { text },
      } = await Tesseract.recognize(file, "fra", { logger: () => {} });
      const { data, warn } = parseSonelgazOCR(text, idx);
      setInvoices((prev) => {
        const n = [...prev];
        n[idx] = { ...n[idx], status: "done", data, edited: { ...data }, warn };
        return n;
      });
    } catch {
      const fb: InvoiceData = {
        billing_period: "",
        h_pointe_kwh: 0,
        peak_kwh: 0,
        total_kwh: 0,
        invoice_da: 0,
        eff_tariff: 0,
      };
      setInvoices((prev) => {
        const n = [...prev];
        n[idx] = {
          ...n[idx],
          status: "error",
          data: fb,
          edited: { ...fb },
          warn: "OCR échoué — saisie manuelle requise",
        };
        return n;
      });
    }
  }, []);

  const manualSlot = (idx: number) => {
    const fb: InvoiceData = {
      billing_period: "",
      h_pointe_kwh: 0,
      peak_kwh: 0,
      total_kwh: 0,
      invoice_da: 0,
      eff_tariff: 0,
    };
    setInvoices((prev) => {
      const n = [...prev];
      n[idx] = {
        ...n[idx],
        status: "done",
        data: fb,
        edited: { ...fb },
        warn: "Saisie manuelle",
      };
      return n;
    });
  };
  const updInv = (idx: number, field: keyof InvoiceData, val: any) => {
    setInvoices((prev) => {
      const n = [...prev];
      if (!n[idx].edited) return n;
      const ed = { ...n[idx].edited!, [field]: val };
      if (field === "h_pointe_kwh" || field === "peak_kwh")
        ed.total_kwh = (ed.h_pointe_kwh || 0) + (ed.peak_kwh || 0);
      if (ed.total_kwh > 0 && ed.invoice_da > 0)
        ed.eff_tariff = +(ed.invoice_da / ed.total_kwh).toFixed(3);
      n[idx] = { ...n[idx], edited: ed };
      return n;
    });
  };

  const doneBills = invoices.filter(
    (s) => s.status === "done" || s.status === "error",
  ).length;

  const compute = () => {
    setComputing(true);
    setTimeout(() => {
      setResults(runStudy(loc, eq, invoices, fin));
      setComputing(false);
      setStep(6);
    }, 500);
  };
  const dlPDF = () => {
    if (!results) return;
    setGenPdf(true);
    setTimeout(() => {
      generatePDF(results, loc, eq, fin);
      setGenPdf(false);
    }, 150);
  };

  // ── Shared atoms ──────────────────────────────────────────────────────────
  const iSt = {
    backgroundColor: C.navy,
    border: `1px solid ${C.border}`,
    color: C.light,
  };
  const iCls = "w-full px-3 py-2 rounded-xl text-sm outline-none";
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
          className={iCls}
          style={iSt}
        />
        {unit && (
          <span className="text-xs shrink-0" style={{ color: C.gold }}>
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
        className={iCls}
        style={iSt}
      />
    </div>
  );
  const SF2 = ({
    label,
    value,
    onChange,
    opts,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    opts: { v: string; l: string }[];
  }) => (
    <div>
      <label className="block text-xs mb-1" style={{ color: C.muted }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={iCls}
        style={{ ...iSt, appearance: "none" }}
      >
        {opts.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
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
      <div className="text-xs font-bold tracking-[0.2em] mb-4 uppercase flex items-center gap-2">
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
      <div className="flex gap-1 mb-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
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
        ÉTAPE {s}/6
      </div>
      <h2 className="text-2xl font-bold" style={{ color: C.light }}>
        {t}
      </h2>
      <p className="text-sm mt-1" style={{ color: C.muted }}>
        {sub}
      </p>
    </div>
  );
  const NB = ({
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
        style={{ backgroundColor: C.bg, minHeight: "100vh" }}
        className="flex items-center justify-center p-6"
      >
        <div className="max-w-lg w-full">
          <div className="mb-4">
            <span
              className="text-xs tracking-[0.4em] font-bold px-3 py-1 rounded-full border"
              style={{ color: C.gold, borderColor: C.gold + "40" }}
            >
              SOLARANALYTICS.DZ — v3.0
            </span>
          </div>
          <h1
            className="text-4xl font-black mt-5 mb-4 leading-[1.1]"
            style={{ color: C.light }}
          >
            Étude PV
            <br />
            <span style={{ color: C.gold }}>Technico-Économique</span>
            <br />
            <span
              style={{ fontSize: "1.1rem", fontWeight: 500, color: C.muted }}
            >
              Algérie — 55 Équations IEC 61724
            </span>
          </h1>
          <p
            className="mb-8 leading-relaxed text-sm"
            style={{ color: C.muted }}
          >
            Choisissez votre wilaya + surface toiture, sélectionnez les
            équipements, importez vos factures Sonelgaz. Le moteur exécute les
            55 équations et génère un rapport PDF professionnel de 12 pages avec
            3 scénarios.
          </p>
          <div className="grid grid-cols-2 gap-3 mb-8">
            {[
              ["55 Équations", "IEC 61724-1:2021 complet"],
              ["Tesseract OCR", "Lecture factures HTA/Arabe+Français"],
              ["3 Scénarios", "Sans/Avec subvention/Crédit bancaire"],
              ["Rapport 12p PDF", "DCF 25 ans + Sensibilité + Env."],
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
            Démarrer l&apos;étude →
          </button>
          <p
            className="text-center text-xs mt-4"
            style={{ color: C.muted + "50" }}
          >
            Droits douane 5% inclus · Remplacement onduleurs An 15 · Comptage
            net Loi 04-09
          </p>
        </div>
      </div>
    );

  // ── STEP 1: Location ───────────────────────────────────────────────────────
  if (step === 1) {
    const filtW = wilSearch
      ? WILAYAS.filter(
          (w) =>
            w.name_fr.toLowerCase().includes(wilSearch.toLowerCase()) ||
            w.name_ar.includes(wilSearch),
        )
      : WILAYAS;
    return (
      <div
        style={{ backgroundColor: C.bg, minHeight: "100vh" }}
        className="p-5"
      >
        <WH
          s={1}
          t="Localisation & Institution"
          sub="Wilaya, type d'institution, surface de toiture"
        />
        <div className="max-w-3xl mx-auto space-y-5">
          <Card title="Identification du Projet">
            <TF
              label="Nom de l'institution"
              value={loc.institution_name}
              onChange={(v) => setLoc({ ...loc, institution_name: v })}
            />
            <TF
              label="Adresse"
              value={loc.address}
              onChange={(v) => setLoc({ ...loc, address: v })}
            />
            <SF2
              label="Type d'institution"
              value={loc.institution_type}
              onChange={(v) => {
                setLoc({ ...loc, institution_type: v });
                setFin((prev) => ({ ...prev, DS: dsDefault(v) }));
              }}
              opts={[
                { v: "university", l: "Université / École (DS=120 000 DA/an)" },
                { v: "hospital", l: "Hôpital / Clinique (DS=180 000 DA/an)" },
                { v: "admin", l: "Bâtiment administratif (DS=90 000 DA/an)" },
                { v: "other", l: "Autre" },
              ]}
            />
          </Card>
          <Card title="Wilaya — Données GHI (NASA POWER)">
            <div>
              <label className="block text-xs mb-1" style={{ color: C.muted }}>
                Rechercher une wilaya
              </label>
              <input
                type="text"
                placeholder="ex: Biskra, Alger, أدرار..."
                value={wilSearch}
                onChange={(e) => setWilSearch(e.target.value)}
                className={iCls}
                style={iSt}
              />
            </div>
            <div
              className="grid grid-cols-3 gap-1.5 max-h-56 overflow-y-auto pr-1"
              style={{ scrollbarWidth: "thin" }}
            >
              {filtW.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setLoc({ ...loc, wilaya_id: w.id })}
                  className="text-left p-2.5 rounded-xl border text-xs transition-all"
                  style={{
                    backgroundColor:
                      loc.wilaya_id === w.id ? C.gold + "22" : C.navy,
                    borderColor: loc.wilaya_id === w.id ? C.gold : C.border,
                    color: loc.wilaya_id === w.id ? C.gold : C.muted,
                  }}
                >
                  <span className="font-semibold block">{w.name_fr}</span>
                  <span
                    style={{
                      color: loc.wilaya_id === w.id ? C.goldL : C.muted + "60",
                    }}
                  >
                    {w.ghi_annual} kWh/m²/j
                  </span>
                </button>
              ))}
            </div>
            <div
              className="rounded-xl p-4 border"
              style={{ backgroundColor: C.navy, borderColor: C.gold + "40" }}
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-bold text-sm" style={{ color: C.gold }}>
                    {selectedWilaya.name_fr} — {selectedWilaya.name_ar}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: C.muted }}>
                    GHI annuel:{" "}
                    <span style={{ color: C.cream }}>
                      {selectedWilaya.ghi_annual} kWh/m²/j
                    </span>
                    {" | "}Latitude:{" "}
                    <span style={{ color: C.cream }}>
                      {selectedWilaya.latitude}°N
                    </span>
                    {" | "}PR_soiling:{" "}
                    <span style={{ color: C.cream }}>
                      {(selectedWilaya.pr_soiling_base * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                <span
                  className="text-xs px-2 py-1 rounded-lg font-semibold"
                  style={{
                    backgroundColor:
                      selectedWilaya.ghi_annual > 5.5
                        ? C.gold + "20"
                        : "#4a9eff20",
                    color: selectedWilaya.ghi_annual > 5.5 ? C.gold : C.blue,
                  }}
                >
                  {selectedWilaya.ghi_annual > 5.5
                    ? "Potentiel Élevé"
                    : "Potentiel Modéré"}
                </span>
              </div>
            </div>
          </Card>
          <Card title="Toiture & Configuration (Eq. 1-8)">
            <div className="grid grid-cols-2 gap-3">
              <NF
                label="Surface brute toiture (m²)"
                value={loc.gross_area}
                onChange={(v) => setLoc({ ...loc, gross_area: v })}
                hint="Mesurée sur Google Earth / plans"
              />
              <NF
                label="Nombre de bâtiments"
                value={loc.n_buildings}
                onChange={(v) => setLoc({ ...loc, n_buildings: v })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <NF
                label="Inclinaison (°)"
                value={loc.tilt}
                onChange={(v) => setLoc({ ...loc, tilt: v })}
                step={5}
                hint="30° optimal Algérie"
              />
              <SF2
                label="Orientation"
                value={loc.orientation}
                onChange={(v) => setLoc({ ...loc, orientation: v })}
                opts={[
                  { v: "Sud", l: "Sud (optimal)" },
                  { v: "SSE", l: "SSE" },
                  { v: "SSO", l: "SSO" },
                ]}
              />
              <SF2
                label="Fréquence nettoyage"
                value={loc.cleaning_freq}
                onChange={(v) => setLoc({ ...loc, cleaning_freq: v })}
                opts={[
                  { v: "monthly", l: "Mensuel (PR_s=0.977)" },
                  { v: "bimonthly", l: "Bi-mensuel (déf.)" },
                  { v: "quarterly", l: "Trimestriel (0.963)" },
                  { v: "annual", l: "Annuel (0.950)" },
                ]}
              />
            </div>
            {/* Auto-sizing preview */}
            {loc.gross_area >= 50 &&
              (() => {
                const a_av = (loc.gross_area * 0.7).toFixed(1);
                const n_mod = Math.floor((loc.gross_area * 0.7) / 2.77);
                const n_str = Math.floor(n_mod / 14);
                const nm = n_str * 14;
                const kw = ((nm * selectedPanel.power_wp) / 1000).toFixed(2);
                return (
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    {[
                      ["Surface nette", `${a_av} m²`, C.gold],
                      ["Modules auto", `${nm}`, C.green],
                      ["kWp estimé", `${kw}`, C.blue],
                    ].map(([l, v, c]) => (
                      <div
                        key={l}
                        className="rounded-xl p-3 border text-center"
                        style={{
                          backgroundColor: C.navy,
                          borderColor: (c as string) + "30",
                        }}
                      >
                        <div className="text-xs" style={{ color: C.muted }}>
                          {l}
                        </div>
                        <div
                          className="font-black text-base"
                          style={{ color: c as string }}
                        >
                          {v}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
          </Card>
          <NB
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
            nextLabel="Suivant — Équipements"
            disabled={loc.gross_area < 50}
          />
        </div>
      </div>
    );
  }

  // ── STEP 2: Equipment ─────────────────────────────────────────────────────
  if (step === 2)
    return (
      <div
        style={{ backgroundColor: C.bg, minHeight: "100vh" }}
        className="p-5"
      >
        <WH
          s={2}
          t="Sélection des Équipements"
          sub="Modules PV et onduleurs — prix DZD toutes taxes (5% douanes inclus)"
        />
        <div className="max-w-4xl mx-auto space-y-5">
          <Card title="Modules Photovoltaïques — Sélectionnez votre modèle">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {PANEL_CATALOG.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setEq({ ...eq, panel_id: p.id })}
                  className="text-left p-3 rounded-xl border transition-all"
                  style={{
                    backgroundColor:
                      eq.panel_id === p.id ? C.gold + "18" : C.navy,
                    borderColor: eq.panel_id === p.id ? C.gold : C.border,
                  }}
                >
                  <div
                    className="font-bold text-xs"
                    style={{ color: eq.panel_id === p.id ? C.gold : C.cream }}
                  >
                    {p.brand}
                  </div>
                  <div
                    className="text-xs font-semibold mt-0.5"
                    style={{ color: eq.panel_id === p.id ? C.goldL : C.muted }}
                  >
                    {p.model}
                  </div>
                  <div
                    className="text-lg font-black mt-1"
                    style={{ color: eq.panel_id === p.id ? C.gold : C.cream }}
                  >
                    {p.power_wp}W
                  </div>
                  <div className="text-xs mt-1" style={{ color: C.muted }}>
                    <span
                      className="px-1.5 py-0.5 rounded mr-1"
                      style={{
                        backgroundColor: C.navy3,
                        color: eq.panel_id === p.id ? C.goldL : C.muted,
                      }}
                    >
                      {p.technology}
                    </span>
                  </div>
                  <div className="text-xs mt-1.5" style={{ color: C.muted }}>
                    η={p.efficiency}% | γ={p.gamma}%/°C | {p.warranty_yrs}ans
                  </div>
                  <div
                    className="font-bold text-sm mt-2"
                    style={{ color: eq.panel_id === p.id ? C.gold : C.cream }}
                  >
                    {p.price_dz.toLocaleString()} DA
                    <span
                      className="text-xs font-normal ml-1"
                      style={{ color: C.muted }}
                    >
                      /unité
                    </span>
                  </div>
                  <div className="text-xs" style={{ color: C.muted + "70" }}>
                    Douanes 5% inclus
                  </div>
                </button>
              ))}
            </div>
          </Card>
          <Card title="Onduleurs — Sélectionnez votre modèle">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {INVERTER_CATALOG.map((inv) => (
                <button
                  key={inv.id}
                  onClick={() => setEq({ ...eq, inverter_id: inv.id })}
                  className="text-left p-3 rounded-xl border transition-all"
                  style={{
                    backgroundColor:
                      eq.inverter_id === inv.id ? C.blue + "20" : C.navy,
                    borderColor: eq.inverter_id === inv.id ? C.blue : C.border,
                  }}
                >
                  <div
                    className="font-bold text-xs"
                    style={{
                      color: eq.inverter_id === inv.id ? C.blue : C.cream,
                    }}
                  >
                    {inv.brand}
                  </div>
                  <div
                    className="text-xs font-semibold mt-0.5"
                    style={{ color: C.muted }}
                  >
                    {inv.model}
                  </div>
                  <div
                    className="text-lg font-black mt-1"
                    style={{
                      color: eq.inverter_id === inv.id ? C.blue : C.cream,
                    }}
                  >
                    {inv.power_kw} kW
                  </div>
                  <div className="text-xs mt-1" style={{ color: C.muted }}>
                    η={inv.efficiency}% | {inv.warranty_yrs}ans garantie
                  </div>
                  <div className="text-xs" style={{ color: C.muted }}>
                    Vdc max {inv.max_dc_v}V | MPPT {inv.mppt_min_v}–
                    {inv.mppt_max_v}V
                  </div>
                  <div
                    className="font-bold text-sm mt-2"
                    style={{
                      color: eq.inverter_id === inv.id ? C.blue : C.cream,
                    }}
                  >
                    {inv.price_dz.toLocaleString()} DA
                    <span
                      className="text-xs font-normal ml-1"
                      style={{ color: C.muted }}
                    >
                      /unité
                    </span>
                  </div>
                  <div className="text-xs" style={{ color: C.muted + "70" }}>
                    Douanes 5% inclus
                  </div>
                </button>
              ))}
            </div>
          </Card>
          <div
            className="rounded-xl p-4 border"
            style={{ backgroundColor: C.navy2, borderColor: C.gold + "30" }}
          >
            <div className="text-xs font-bold" style={{ color: C.gold }}>
              Équipement sélectionné
            </div>
            <div
              className="flex justify-between mt-2 text-xs"
              style={{ color: C.muted }}
            >
              <span>
                Module:{" "}
                <span style={{ color: C.cream }}>
                  {selectedPanel.brand} {selectedPanel.model} —{" "}
                  {selectedPanel.power_wp}Wp —{" "}
                  {selectedPanel.price_dz.toLocaleString()} DA
                </span>
              </span>
              <span>
                Onduleur:{" "}
                <span style={{ color: C.cream }}>
                  {selectedInv.brand} {selectedInv.model} —{" "}
                  {selectedInv.power_kw}kW —{" "}
                  {selectedInv.price_dz.toLocaleString()} DA
                </span>
              </span>
            </div>
          </div>
          <NB
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextLabel="Suivant — Factures"
          />
        </div>
      </div>
    );

  // ── STEP 3: Invoices ──────────────────────────────────────────────────────
  if (step === 3)
    return (
      <div
        style={{ backgroundColor: C.bg, minHeight: "100vh" }}
        className="p-5"
      >
        <WH
          s={3}
          t="Factures Sonelgaz"
          sub="Importez 12 à 36 factures — OCR Tesseract (Arabe+Français)"
        />
        <div className="max-w-5xl mx-auto">
          <div
            className="rounded-xl p-3 mb-5 border text-xs"
            style={{
              backgroundColor: C.navy2,
              borderColor: C.gold + "25",
              color: C.muted,
            }}
          >
            <span style={{ color: C.gold }} className="font-semibold">
              HTA Tarif 42 :
            </span>{" "}
            L&apos;OCR Tesseract extrait Cadran 1+2 (H.Hors Pointe) + Cadran 3
            (H.Pointe) + Net à Payer. Corrigez dans le tableau ci-dessous.
            Minimum 12 factures recommandé — 24-36 pour moyenne fiable.
          </div>
          <div className="grid grid-cols-4 md:grid-cols-6 gap-2 mb-5">
            {invoices.slice(0, 12).map((slot, i) => (
              <div key={i}>
                <input
                  ref={(el) => {
                    fileRefs.current[i] = el;
                  }}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) =>
                    e.target.files?.[0] && processImage(e.target.files[0], i)
                  }
                />
                <div
                  onClick={() =>
                    slot.status !== "processing" && fileRefs.current[i]?.click()
                  }
                  className="relative rounded-xl border cursor-pointer overflow-hidden"
                  style={{
                    aspectRatio: "3/4",
                    borderColor:
                      slot.status === "empty"
                        ? C.border
                        : slot.status === "processing"
                          ? C.gold
                          : slot.status === "error"
                            ? "#ef444433"
                            : "#22c55e33",
                    backgroundColor: C.navy2,
                  }}
                >
                  {slot.preview ? (
                    <img
                      src={slot.preview}
                      className="w-full h-full object-cover"
                      style={{ opacity: 0.6 }}
                      alt=""
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className="text-sm mb-0.5">📄</div>
                      <div className="text-xs" style={{ color: C.gold + "70" }}>
                        {i + 1}
                      </div>
                    </div>
                  )}
                  {slot.status === "processing" && (
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ backgroundColor: C.navy + "cc" }}
                    >
                      <div
                        className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                        style={{ borderColor: C.gold }}
                      />
                    </div>
                  )}
                  {(slot.status === "done" || slot.status === "error") && (
                    <div
                      className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{
                        backgroundColor: slot.warn
                          ? "#f59e0b"
                          : slot.status === "error"
                            ? "#ef4444"
                            : "#22c55e",
                        color: C.navy,
                      }}
                    >
                      {slot.warn || slot.status === "error" ? "!" : "✓"}
                    </div>
                  )}
                </div>
                {slot.status === "empty" && (
                  <button
                    onClick={() => manualSlot(i)}
                    className="w-full mt-1 text-xs py-0.5 rounded-lg"
                    style={{
                      backgroundColor: C.navy2,
                      color: C.muted + "50",
                      border: `1px solid ${C.border}`,
                    }}
                  >
                    Manuel
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
                className="px-4 py-3 font-bold text-sm flex justify-between"
                style={{ backgroundColor: C.navy2, color: C.gold }}
              >
                <span>Vérification & Correction — Données OCR</span>
                <span
                  className="text-xs font-normal"
                  style={{ color: C.muted }}
                >
                  {doneBills} factures
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ backgroundColor: C.navy2 }}>
                      {[
                        "#",
                        "Img",
                        "Période (AAAA-MM)",
                        "HHP kWh (Cad.1+2)",
                        "HP Pointe kWh (Cad.3)",
                        "Total kWh",
                        "Montant DA",
                        "Tarif eff.",
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
                    {invoices.map((s, i) =>
                      s.status === "done" && s.edited ? (
                        <tr
                          key={i}
                          className="border-t"
                          style={{ borderColor: C.border + "40" }}
                        >
                          <td
                            className="py-1 px-2 font-semibold"
                            style={{ color: C.gold + "aa" }}
                          >
                            {i + 1}
                            {s.warn && (
                              <div
                                className="text-xs"
                                style={{ color: "#f59e0b" }}
                              >
                                {s.warn}
                              </div>
                            )}
                          </td>
                          <td className="py-1 px-2">
                            {s.preview && (
                              <img
                                src={s.preview}
                                className="w-8 h-11 object-cover rounded"
                                alt=""
                              />
                            )}
                          </td>
                          <td className="py-1 px-1.5">
                            <input
                              type="text"
                              value={s.edited.billing_period || ""}
                              onChange={(e) =>
                                updInv(i, "billing_period", e.target.value)
                              }
                              placeholder="2024-01"
                              className="w-24 text-center px-2 py-1.5 rounded-lg text-xs outline-none"
                              style={{
                                backgroundColor: C.navy,
                                border: `1px solid ${C.border}`,
                                color: C.light,
                              }}
                            />
                          </td>
                          {(
                            [
                              "h_pointe_kwh",
                              "peak_kwh",
                              "total_kwh",
                              "invoice_da",
                            ] as const
                          ).map((f) => (
                            <td key={f} className="py-1 px-1">
                              <input
                                type="number"
                                value={s.edited![f] || ""}
                                onChange={(e) =>
                                  updInv(i, f, parseFloat(e.target.value) || 0)
                                }
                                className="w-full text-right px-2 py-1.5 rounded-lg text-xs outline-none"
                                style={{
                                  backgroundColor: C.navy,
                                  border: `1px solid ${s.warn && !s.edited![f] ? "#f59e0b44" : C.border}`,
                                  color: C.light,
                                }}
                              />
                            </td>
                          ))}
                          <td
                            className="py-1 px-2 text-right"
                            style={{
                              color:
                                s.edited.eff_tariff < 4 ||
                                s.edited.eff_tariff > 6.5
                                  ? "#f59e0b"
                                  : C.green,
                            }}
                          >
                            {s.edited.eff_tariff?.toFixed(3) || "—"}
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
                Tarif eff. attendu HTA 42: 4.50–5.60 DA/kWh | Mois manquants →
                moyenne des mois disponibles
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-3 rounded-xl text-sm"
              style={{ border: `1px solid ${C.border}`, color: C.muted }}
            >
              Retour
            </button>
            <button
              onClick={() => setStep(4)}
              disabled={doneBills < 1}
              className="flex-grow py-3 rounded-xl font-bold disabled:opacity-30"
              style={{ backgroundColor: C.gold, color: C.navy }}
            >
              Suivant — Système ({doneBills} factures)
            </button>
          </div>
        </div>
      </div>
    );

  // ── STEP 4: System review ─────────────────────────────────────────────────
  if (step === 4)
    return (
      <div
        style={{ backgroundColor: C.bg, minHeight: "100vh" }}
        className="p-5"
      >
        <WH
          s={4}
          t="Paramètres Système"
          sub="Valeurs auto-calculées — toutes éditables"
        />
        <div className="max-w-2xl mx-auto space-y-5">
          {/* Show auto-sizing */}
          {(() => {
            const a_av = +(loc.gross_area * 0.7).toFixed(2);
            const n_max = Math.floor(a_av / 2.77);
            const n_str = Math.floor(n_max / 14);
            const nm = n_str * 14;
            const kw = +((nm * selectedPanel.power_wp) / 1000).toFixed(2);
            const ni = Math.max(1, Math.ceil(kw / selectedInv.power_kw));
            const dc_ac = +(kw / (ni * selectedInv.power_kw)).toFixed(3);
            return (
              <div
                className="rounded-xl p-4 border"
                style={{ backgroundColor: C.navy2, borderColor: C.gold + "30" }}
              >
                <div
                  className="text-xs font-bold uppercase tracking-widest mb-3"
                  style={{ color: C.gold }}
                >
                  Dimensionnement Auto (Éq. 1-8)
                </div>
                <div className="grid grid-cols-4 gap-3 text-center">
                  {[
                    [`${a_av} m²`, "Surface nette"],
                    [`${nm}`, "Modules"],
                    [`${kw} kWp`, "P installée"],
                    [`${ni}`, "Onduleurs"],
                  ].map(([v, l]) => (
                    <div key={l}>
                      <div
                        className="text-sm font-black"
                        style={{ color: C.cream }}
                      >
                        {v}
                      </div>
                      <div className="text-xs" style={{ color: C.muted }}>
                        {l}
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  className="mt-2 text-xs text-center"
                  style={{
                    color: dc_ac >= 1.05 && dc_ac <= 1.3 ? C.green : C.orange,
                  }}
                >
                  Ratio DC/AC: {dc_ac}{" "}
                  {dc_ac >= 1.05 && dc_ac <= 1.3
                    ? "✓ [1.05–1.30]"
                    : "⚠ Hors plage"}
                </div>
              </div>
            );
          })()}
          <Card title="Performance Ratio">
            <NF
              label="Performance Ratio PR (%)"
              value={80}
              onChange={() => {}}
              step={1}
              hint="80% par défaut — ajusté mensuellement par la température"
            />
            <div className="text-xs" style={{ color: C.muted }}>
              Éq. 11 — PR_soiling=
              {`${(selectedWilaya.pr_soiling_base * 100).toFixed(1)}%`}{" "}
              (nettoyage {loc.cleaning_freq})
            </div>
          </Card>
          <NB
            onBack={() => setStep(3)}
            onNext={() => setStep(5)}
            nextLabel="Suivant — Paramètres Financiers"
          />
        </div>
      </div>
    );

  // ── STEP 5: Financial ─────────────────────────────────────────────────────
  if (step === 5)
    return (
      <div
        style={{ backgroundColor: C.bg, minHeight: "100vh" }}
        className="p-5"
      >
        <WH
          s={5}
          t="Paramètres Financiers"
          sub="Modèle DCF 25 ans — 3 scénarios"
        />
        <div className="max-w-2xl mx-auto space-y-5">
          <Card title="Taux de Référence">
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
              hint="4%/an — CAGR observé Sonelgaz 2023-2025 (marge sécurité)"
            />
            <NF
              label="O&M (% CAPEX/an)"
              value={fin.om_rate}
              onChange={(v) => setFin({ ...fin, om_rate: v })}
              step={0.1}
              hint="1% standard (maintenance + assurance + nettoyage)"
            />
          </Card>
          <Card title="Économies Demande (DS — TOUJOURS FIXE)" accent={C.green}>
            <NF
              label="DS (DA/an) — ne pas indexer à f"
              value={fin.DS}
              onChange={(v) => setFin({ ...fin, DS: v })}
              step={5000}
              hint={`Défaut ${fin.DS.toLocaleString()} DA/an (type: ${loc.institution_type})`}
            />
            <div
              className="rounded-xl p-3 border text-xs"
              style={{
                backgroundColor: C.navy,
                borderColor: C.gold + "30",
                color: C.muted,
              }}
            >
              ⚠ DS est une constante sur 25 ans. L&apos;indexer à f est une
              erreur méthodologique grave.
            </div>
          </Card>
          <Card title="Scénarios Financiers" accent={C.blue}>
            <NF
              label="Taux subvention Sc2 (%) — PREREC/APRUE"
              value={fin.subsidy_rate}
              onChange={(v) => setFin({ ...fin, subsidy_rate: v })}
              step={5}
              hint="20% standard programme PREREC"
            />
            <NF
              label="Taux crédit bancaire Sc3 (%)"
              value={fin.loan_rate}
              onChange={(v) => setFin({ ...fin, loan_rate: v })}
              step={0.5}
              hint="6.5% — banques algériennes 2025"
            />
            <NF
              label="Durée crédit Sc3 (ans)"
              value={fin.loan_years}
              onChange={(v) => setFin({ ...fin, loan_years: v })}
              step={1}
              hint="15 ans recommandé"
            />
            <NF
              label="Apport Sc3 (% du CAPEX)"
              value={fin.loan_down}
              onChange={(v) => setFin({ ...fin, loan_down: v })}
              step={5}
              hint="20% minimum"
            />
          </Card>
          <div className="flex gap-3">
            <button
              onClick={() => setStep(4)}
              className="flex-1 py-3 rounded-xl text-sm"
              style={{ border: `1px solid ${C.border}`, color: C.muted }}
            >
              Retour
            </button>
            <button
              onClick={compute}
              disabled={computing}
              className="flex-grow py-3 rounded-xl font-bold disabled:opacity-40"
              style={{ backgroundColor: C.gold, color: C.navy }}
            >
              {computing ? (
                <span className="flex items-center justify-center gap-2">
                  <span
                    className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                    style={{ borderColor: C.navy }}
                  />
                  Calcul des 55 équations...
                </span>
              ) : (
                "Lancer l'étude complète →"
              )}
            </button>
          </div>
        </div>
      </div>
    );

  // ── STEP 6: Results ───────────────────────────────────────────────────────
  if (step === 6 && results) {
    const r = results;
    return (
      <div
        style={{ backgroundColor: C.bg, minHeight: "100vh" }}
        className="p-5"
      >
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="flex items-start justify-between mb-5 gap-4">
            <div>
              <div
                className="text-xs tracking-widest mb-1"
                style={{ color: C.gold + "80" }}
              >
                RÉSULTATS — 55 ÉQUATIONS IEC 61724
              </div>
              <h1 className="text-2xl font-bold" style={{ color: C.light }}>
                {loc.institution_name}
              </h1>
              <p className="text-sm mt-1" style={{ color: C.muted }}>
                {selectedWilaya.name_fr} · {r.sizing.p_installed} kWp ·{" "}
                {r.sizing.n_modules} modules {selectedPanel.brand} · T₀={r.t0}{" "}
                DA/kWh
              </p>
            </div>
            <button
              onClick={dlPDF}
              disabled={genPdf}
              className="shrink-0 px-5 py-3 rounded-xl font-bold transition-opacity hover:opacity-90 disabled:opacity-40 text-sm"
              style={{ backgroundColor: C.gold, color: C.navy }}
            >
              {genPdf ? "Génération..." : "📄 PDF (12 pages)"}
            </button>
          </div>

          {/* Warnings */}
          {r.warnings.length > 0 && (
            <div
              className="rounded-xl p-3 mb-4 border"
              style={{ backgroundColor: "#7c2d1220", borderColor: "#f97316" }}
            >
              <div
                className="font-bold text-xs mb-1"
                style={{ color: C.orange }}
              >
                ⚠ Avertissements ({r.warnings.length})
              </div>
              {r.warnings.map((w, i) => (
                <div key={i} className="text-xs" style={{ color: C.cream }}>
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              {
                l: "VAN Sc1",
                v: `${(r.npv_sc1 / 1e6).toFixed(2)} M DA`,
                ok: r.npv_sc1 > 0,
                c: C.gold,
              },
              {
                l: "TRI Sc1",
                v: `${r.irr_sc1}%`,
                ok: r.irr_sc1 > fin.r,
                c: C.green,
              },
              { l: "DRS Sc1", v: `${r.spp_sc1} ans`, ok: true, c: C.cream },
              { l: "LCOE", v: `${r.lcoe} DA/kWh`, ok: true, c: C.blue },
              { l: "SCR (Éq.28)", v: `${r.scr_annual}%`, ok: true, c: C.gold },
              {
                l: "E_annual",
                v: `${(r.e_annual / 1000).toFixed(0)} MWh`,
                ok: true,
                c: C.cream,
              },
              {
                l: "VAN Sc2",
                v: `${(r.npv_sc2 / 1e6).toFixed(2)} M DA`,
                ok: r.npv_sc2 > 0,
                c: C.blue,
              },
              { l: "CO₂ évité", v: `${r.co2_yr1} t/an`, ok: true, c: C.green },
            ].map((k) => (
              <div
                key={k.l}
                className="rounded-xl p-4 border"
                style={{ backgroundColor: C.navy2, borderColor: k.c + "25" }}
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

          {/* Sizing */}
          <div
            className="rounded-xl border p-4 mb-4"
            style={{ backgroundColor: C.navy2, borderColor: C.border }}
          >
            <div
              className="font-bold text-xs uppercase tracking-widest mb-3"
              style={{ color: C.gold }}
            >
              Dimensionnement (Éq. 1-8) & CAPEX (Éq. 31)
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {[
                [`${r.sizing.a_available} m²`, "Surface nette"],
                [`${r.sizing.n_modules}`, "Modules"],
                [`${r.sizing.p_installed} kWp`, "P installée"],
                [`${r.sizing.n_inverters}`, "Onduleurs"],
                [`${r.sizing.dc_ac_ratio}`, "DC/AC"],
                [`${(r.capex / 1e6).toFixed(2)} M DA`, "CAPEX (Éq.18)"],
              ].map(([v, l]) => (
                <div key={l} className="text-center">
                  <div
                    className="text-sm font-black"
                    style={{ color: C.cream }}
                  >
                    {v}
                  </div>
                  <div className="text-xs" style={{ color: C.muted }}>
                    {l}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Monthly table */}
          <div
            className="rounded-xl border overflow-hidden mb-4"
            style={{ borderColor: C.border }}
          >
            <div
              className="px-4 py-3 font-bold text-sm"
              style={{ backgroundColor: C.navy2, color: C.gold }}
            >
              Production & SCR Mensuels (Éq. 9-30)
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
                    {M_S.map((m) => (
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
                      label: "PR_total % (Éq.12)",
                      vals: r.monthly.map((m) => m.pr_total),
                      color: "#fb923c",
                      unit: "%",
                      avg: true,
                    },
                    {
                      label: "E_PV kWh (Éq.13)",
                      vals: r.monthly_pv,
                      color: C.gold,
                      sum: true,
                    },
                    {
                      label: "E_Cons kWh",
                      vals: r.monthly_cons,
                      color: C.blue,
                      sum: true,
                    },
                    {
                      label: "E_SC kWh (Éq.24)",
                      vals: r.monthly_sc,
                      color: C.green,
                      sum: true,
                    },
                    {
                      label: "SCR% (Éq.27)",
                      vals: r.monthly_scr,
                      color: C.muted,
                      unit: "%",
                      avg: true,
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
                        {row.sum
                          ? row.vals.reduce((a, b) => a + b, 0).toLocaleString()
                          : `${Math.round(row.vals.reduce((a, b) => a + b, 0) / row.vals.length)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3 scenarios */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              {
                title: "Sc1 — Sans subvention",
                npv: r.npv_sc1,
                irr: r.irr_sc1,
                spp: r.spp_sc1,
                dpp: r.dpp_sc1,
                pi: r.pi_sc1,
                cap: r.capex,
                c: C.gold,
              },
              {
                title: `Sc2 — ${fin.subsidy_rate}% Subvention`,
                npv: r.npv_sc2,
                irr: r.irr_sc2,
                spp: r.spp_sc2,
                dpp: r.dpp_sc2,
                pi: r.pi_sc2,
                cap: r.capex_sc2,
                c: C.blue,
              },
              {
                title: `Sc3 — Crédit ${fin.loan_rate}%/${fin.loan_years}ans`,
                npv: r.npv_sc3,
                irr: r.irr_sc3,
                spp: 0,
                dpp: r.dpp_sc3,
                pi: r.pi_sc3,
                cap: r.capex,
                c: C.green,
              },
            ].map((sc) => (
              <div
                key={sc.title}
                className="rounded-xl border p-4"
                style={{ backgroundColor: C.navy2, borderColor: sc.c + "33" }}
              >
                <div className="font-bold text-xs mb-3" style={{ color: sc.c }}>
                  {sc.title}
                </div>
                {[
                  ["CAPEX", sc.cap.toLocaleString() + " DA"],
                  ["VAN (Éq.42)", sc.npv.toLocaleString() + " DA"],
                  ["TRI (Éq.48)", sc.irr + "%"],
                  ["DRA (Éq.47)", (sc.dpp ?? ">25") + " ans"],
                  ["IP (Éq.50)", String(sc.pi)],
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

          {/* Break-even + net metering */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div
              className="rounded-xl border p-4"
              style={{ backgroundColor: C.navy2, borderColor: C.border }}
            >
              <div className="font-bold text-xs mb-2" style={{ color: C.gold }}>
                Break-Even (Éq.51)
              </div>
              <div className="text-xs" style={{ color: C.muted }}>
                SCR break-even:{" "}
                <span style={{ color: C.cream }}>{r.be_scr}%</span> (actuel:{" "}
                {r.scr_annual}%, marge: {(r.scr_annual - r.be_scr).toFixed(0)}{" "}
                pts)
              </div>
              <div className="text-xs mt-1" style={{ color: C.muted }}>
                T₀ break-even:{" "}
                <span style={{ color: C.cream }}>{r.be_tariff} DA/kWh</span>{" "}
                (actuel: {r.t0})
              </div>
            </div>
            <div
              className="rounded-xl border p-4"
              style={{ backgroundColor: C.navy2, borderColor: C.green + "22" }}
            >
              <div
                className="font-bold text-xs mb-2"
                style={{ color: C.green }}
              >
                Comptage Net (Éq.52-53)
              </div>
              <div className="text-xs" style={{ color: C.muted }}>
                Surplus exporté (Éq.30):{" "}
                <span style={{ color: C.cream }}>
                  {r.e_surplus.toLocaleString()} kWh/an
                </span>
              </div>
              <div className="text-xs mt-1" style={{ color: C.muted }}>
                Revenus NM:{" "}
                <span style={{ color: C.cream }}>
                  {r.nm_revenue.toLocaleString()} DA/an
                </span>{" "}
                | VAN NM: {r.npv_nm.toLocaleString()} DA
              </div>
            </div>
          </div>

          {/* Environmental */}
          <div
            className="rounded-xl border p-4 mb-4"
            style={{ backgroundColor: C.navy2, borderColor: C.green + "22" }}
          >
            <div className="font-bold text-xs mb-3" style={{ color: C.green }}>
              Impact Environnemental (Éq. 54-55)
            </div>
            <div className="grid grid-cols-4 gap-3 text-center">
              {[
                ["tCO₂/an", r.co2_yr1, "CO₂ évité"],
                [`${r.co2_25yr}t`, "25 ans", "CO₂ total"],
                [r.trees_yr, "arbres", "Équiv. arbres"],
                [r.vehi_yr, "veh.", "Véhicules"],
              ].map(([v, u, l]) => (
                <div
                  key={l as string}
                  className="rounded-lg p-3"
                  style={{ backgroundColor: C.green + "0a" }}
                >
                  <div
                    className="text-xl font-black"
                    style={{ color: C.green }}
                  >
                    {v}
                  </div>
                  <div className="text-xs" style={{ color: C.green + "80" }}>
                    {u}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: C.muted }}>
                    {l}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(5)}
              className="py-3 px-6 rounded-xl text-sm"
              style={{ border: `1px solid ${C.border}`, color: C.muted }}
            >
              Modifier
            </button>
            <button
              onClick={dlPDF}
              disabled={genPdf}
              className="flex-grow py-3 rounded-xl font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: C.gold, color: C.navy }}
            >
              {genPdf
                ? "Génération PDF (12 pages)..."
                : "📄 Télécharger Rapport PDF Complet (12 pages)"}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
