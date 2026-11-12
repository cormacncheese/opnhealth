// Unit normalisation. Pure, shared by the Edge Functions and the website.

export interface Normalised {
  value: number;
  unit: CanonicalUnit;
}

export type CanonicalUnit = "ug/kg" | "ug/L" | "ug/serving" | "cfu/g" | "mpn/g";

const FACTORS: Record<string, [CanonicalUnit, number]> = {
  // Mass per mass. "ppm" and "ppb" are read as mass fractions, which is how
  // food and supplement labs report them.
  "ug/kg": ["ug/kg", 1],
  "ng/g": ["ug/kg", 1],
  ppb: ["ug/kg", 1],
  "mg/kg": ["ug/kg", 1e3],
  "ug/g": ["ug/kg", 1e3],
  ppm: ["ug/kg", 1e3],
  "ng/kg": ["ug/kg", 1e-3],
  "pg/g": ["ug/kg", 1e-3],
  ppt: ["ug/kg", 1e-3],
  "mg/g": ["ug/kg", 1e6],
  "g/kg": ["ug/kg", 1e6],
  "%": ["ug/kg", 1e7],
  "g/100g": ["ug/kg", 1e7],
  // Mass per volume.
  "ug/l": ["ug/L", 1],
  "ng/ml": ["ug/L", 1],
  "mg/l": ["ug/L", 1e3],
  "ug/ml": ["ug/L", 1e3],
  "ng/l": ["ug/L", 1e-3],
  // Per serving.
  "ug/serving": ["ug/serving", 1],
  "mg/serving": ["ug/serving", 1e3],
  // Microbial counts.
  "cfu/g": ["cfu/g", 1],
  "cfu/ml": ["cfu/g", 1],
  "mpn/g": ["mpn/g", 1],
};

export function cleanUnit(unit: string): string {
  return unit
    .trim()
    .toLowerCase()
    .replace(/[µμ]/g, "u")
    .replace(/\bmcg\b/g, "ug")
    .replace(/\s+/g, "")
    .replace(/%\(?w\/w\)?/, "%")
    .replace(/\/(svg|srv|serv)$/, "/serving");
}

export function normaliseMeasurement(
  value: number | null,
  unit: string | null,
): Normalised | null {
  if (value === null || unit === null || !Number.isFinite(value)) return null;
  const entry = FACTORS[cleanUnit(unit)];
  if (!entry) return null;
  // Round away floating point noise such as 0.30000000000000004.
  return { value: Number((value * entry[1]).toPrecision(12)), unit: entry[0] };
}

export function isRecognisedUnit(unit: string | null): boolean {
  return unit !== null && cleanUnit(unit) in FACTORS;
}
