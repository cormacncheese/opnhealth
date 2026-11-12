// Comparing a measurement with a reference limit. Pure, shared by the
// adjudication policy and the product page so both reach the same verdict.

export interface LimitLike {
  analyte_id: string;
  basis: string;
  normalised_value: number | null;
  normalised_unit: string | null;
  category_keywords: string[];
}

export interface MeasurementLike {
  analyte_id: string | null;
  operator: "eq" | "lt" | "lte" | "gt" | "gte" | "nd";
  normalised_value: number | null;
  normalised_unit: string | null;
}

export type Comparison =
  // The result is above the limit.
  | "above"
  // The result, or its reporting limit, is at or below the limit.
  | "within"
  // Reported as "less than X" where X is above the limit, so nothing can be said.
  | "inconclusive"
  // Different quantities (for example a daily dose against a concentration).
  | "not_comparable";

function normaliseCategory(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[a-z]{2}:/, "")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a limit is meant for this kind of product. A limit with no keywords
 * is never applied automatically: it is shown for context only.
 */
export function limitApplies(limit: LimitLike, productCategories: string[]): boolean {
  if (limit.category_keywords.length === 0) return false;
  const categories = productCategories.filter(Boolean).map(normaliseCategory);
  return limit.category_keywords.some((keyword) => {
    const k = normaliseCategory(keyword);
    return categories.some((c) => c === k || c.includes(k));
  });
}

function unitsComparable(measurementUnit: string, limitUnit: string): boolean {
  if (measurementUnit === limitUnit) return true;
  // Limits written per litre are for water-like products, where a litre
  // weighs a kilogram to within the precision that matters here.
  return limitUnit === "ug/L" && measurementUnit === "ug/kg";
}

export function compareToLimit(m: MeasurementLike, limit: LimitLike): Comparison {
  if (
    limit.basis !== "concentration" ||
    limit.normalised_value === null ||
    limit.normalised_unit === null ||
    m.analyte_id !== limit.analyte_id
  ) {
    return "not_comparable";
  }
  if (m.operator === "nd" && m.normalised_value === null) return "within";
  if (m.normalised_value === null || m.normalised_unit === null) return "not_comparable";
  if (!unitsComparable(m.normalised_unit, limit.normalised_unit)) return "not_comparable";

  const value = Number(m.normalised_value);
  const max = Number(limit.normalised_value);
  switch (m.operator) {
    case "eq":
    case "gte":
      return value > max ? "above" : "within";
    case "gt":
      return value >= max ? "above" : "inconclusive";
    case "lt":
    case "lte":
    case "nd":
      return value <= max ? "within" : "inconclusive";
  }
}

/** True when any measurement is above a limit that applies to the product. */
export function hasAdverseResult(
  measurements: MeasurementLike[],
  limits: LimitLike[],
  productCategories: string[],
): boolean {
  return measurements.some((m) =>
    limits.some(
      (l) => limitApplies(l, productCategories) && compareToLimit(m, l) === "above",
    ),
  );
}
