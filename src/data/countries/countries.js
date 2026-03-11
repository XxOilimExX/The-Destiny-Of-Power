// BALANCED: Every nation's total (eco + mil + stb) = 180 ± 5
// Each nation has a unique profile — some excel in economy, others in military or stability
export const countries = [
  // ── North America ─────────────────────────────────────────────
  { code: "US", name: "United States",     capital: "Washington D.C.", region: "North America", color: "#c0392b", population: 335000000,  economyScore: 72, militaryScore: 68, stabilityScore: 40 },
  { code: "CA", name: "Canada",            capital: "Ottawa",          region: "North America", color: "#1a6b3c", population: 38300000,   economyScore: 55, militaryScore: 45, stabilityScore: 80 },
  { code: "MX", name: "Mexico",            capital: "Mexico City",     region: "North America", color: "#8e44ad", population: 129700000,  economyScore: 62, militaryScore: 52, stabilityScore: 66 },
  // ── South America ─────────────────────────────────────────────
  { code: "BR", name: "Brazil",            capital: "Brasília",        region: "South America", color: "#27ae60", population: 203000000,  economyScore: 60, militaryScore: 55, stabilityScore: 65 },
  { code: "AR", name: "Argentina",         capital: "Buenos Aires",    region: "South America", color: "#2980b9", population: 46000000,   economyScore: 58, militaryScore: 48, stabilityScore: 74 },
  { code: "CO", name: "Colombia",          capital: "Bogotá",          region: "South America", color: "#e67e22", population: 51300000,   economyScore: 56, militaryScore: 60, stabilityScore: 64 },
  { code: "VE", name: "Venezuela",         capital: "Caracas",         region: "South America", color: "#d35400", population: 28200000,   economyScore: 68, militaryScore: 42, stabilityScore: 70 },
  { code: "PE", name: "Peru",              capital: "Lima",            region: "South America", color: "#16a085", population: 32900000,   economyScore: 54, militaryScore: 50, stabilityScore: 76 },
  // ── Europe ────────────────────────────────────────────────────
  { code: "GB", name: "United Kingdom",    capital: "London",          region: "Europe",        color: "#2471a3", population: 67700000,   economyScore: 65, militaryScore: 58, stabilityScore: 57 },
  { code: "FR", name: "France",            capital: "Paris",           region: "Europe",        color: "#1f618d", population: 68100000,   economyScore: 63, militaryScore: 62, stabilityScore: 55 },
  { code: "DE", name: "Germany",           capital: "Berlin",          region: "Europe",        color: "#117a65", population: 84400000,   economyScore: 70, militaryScore: 42, stabilityScore: 68 },
  { code: "IT", name: "Italy",             capital: "Rome",            region: "Europe",        color: "#1e8449", population: 59000000,   economyScore: 64, militaryScore: 48, stabilityScore: 68 },
  { code: "ES", name: "Spain",             capital: "Madrid",          region: "Europe",        color: "#7d6608", population: 47400000,   economyScore: 60, militaryScore: 50, stabilityScore: 70 },
  { code: "PL", name: "Poland",            capital: "Warsaw",          region: "Europe",        color: "#6e2f1a", population: 37700000,   economyScore: 55, militaryScore: 58, stabilityScore: 67 },
  { code: "UA", name: "Ukraine",           capital: "Kyiv",            region: "Europe",        color: "#784212", population: 43500000,   economyScore: 50, militaryScore: 65, stabilityScore: 65 },
  { code: "SE", name: "Sweden",            capital: "Stockholm",       region: "Europe",        color: "#4a235a", population: 10500000,   economyScore: 58, militaryScore: 44, stabilityScore: 78 },
  { code: "TR", name: "Turkey",            capital: "Ankara",          region: "Europe/Asia",   color: "#935116", population: 84400000,   economyScore: 56, militaryScore: 64, stabilityScore: 60 },
  // ── Russia ────────────────────────────────────────────────────
  { code: "RU", name: "Russia",            capital: "Moscow",          region: "Eurasia",       color: "#6c3483", population: 145000000,  economyScore: 48, militaryScore: 72, stabilityScore: 60 },
  // ── Middle East ───────────────────────────────────────────────
  { code: "SA", name: "Saudi Arabia",      capital: "Riyadh",          region: "Middle East",   color: "#1a5276", population: 35000000,   economyScore: 70, militaryScore: 55, stabilityScore: 55 },
  { code: "IR", name: "Iran",              capital: "Tehran",          region: "Middle East",   color: "#7e5109", population: 88000000,   economyScore: 52, militaryScore: 66, stabilityScore: 62 },
  // ── Africa ────────────────────────────────────────────────────
  { code: "NG", name: "Nigeria",           capital: "Abuja",           region: "Africa",        color: "#0b5345", population: 223000000,  economyScore: 58, militaryScore: 56, stabilityScore: 66 },
  { code: "EG", name: "Egypt",             capital: "Cairo",           region: "Africa",        color: "#7b241c", population: 104000000,  economyScore: 54, militaryScore: 62, stabilityScore: 64 },
  { code: "ZA", name: "South Africa",      capital: "Pretoria",        region: "Africa",        color: "#1b4f72", population: 62400000,   economyScore: 60, militaryScore: 48, stabilityScore: 72 },
  { code: "ET", name: "Ethiopia",          capital: "Addis Ababa",     region: "Africa",        color: "#145a32", population: 126500000,  economyScore: 52, militaryScore: 58, stabilityScore: 70 },
  { code: "CD", name: "DR Congo",          capital: "Kinshasa",        region: "Africa",        color: "#4d1f09", population: 99000000,   economyScore: 56, militaryScore: 62, stabilityScore: 62 },
  // ── Asia ──────────────────────────────────────────────────────
  { code: "CN", name: "China",             capital: "Beijing",         region: "Asia",          color: "#922b21", population: 1412000000, economyScore: 66, militaryScore: 70, stabilityScore: 44 },
  { code: "IN", name: "India",             capital: "New Delhi",       region: "Asia",          color: "#f39c12", population: 1428000000, economyScore: 62, militaryScore: 60, stabilityScore: 58 },
  { code: "JP", name: "Japan",             capital: "Tokyo",           region: "Asia",          color: "#d98880", population: 124000000,  economyScore: 68, militaryScore: 40, stabilityScore: 72 },
  { code: "KR", name: "South Korea",       capital: "Seoul",           region: "Asia",          color: "#a9cce3", population: 51700000,   economyScore: 66, militaryScore: 54, stabilityScore: 60 },
  { code: "PK", name: "Pakistan",          capital: "Islamabad",       region: "Asia",          color: "#85929e", population: 231000000,  economyScore: 50, militaryScore: 64, stabilityScore: 66 },
  { code: "ID", name: "Indonesia",         capital: "Jakarta",         region: "Asia",          color: "#e74c3c", population: 277000000,  economyScore: 58, militaryScore: 54, stabilityScore: 68 },
  { code: "KZ", name: "Kazakhstan",        capital: "Astana",          region: "Asia",          color: "#5d6d7e", population: 19300000,   economyScore: 56, militaryScore: 52, stabilityScore: 72 },
  // ── Oceania ───────────────────────────────────────────────────
  { code: "AU", name: "Australia",         capital: "Canberra",        region: "Oceania",       color: "#e59866", population: 26000000,   economyScore: 62, militaryScore: 46, stabilityScore: 72 },
];