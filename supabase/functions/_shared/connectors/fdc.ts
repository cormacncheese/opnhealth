// USDA FoodData Central, branded foods (public domain). Same shape as the
// Open Food Facts connector: newest page first, then one page of backfill.

import { normaliseGtin } from "../core/text.ts";
import { config, env } from "../env.ts";
import { type CatalogRecord, clean, type Connector, getJson, upsertCatalogRecords } from "./types.ts";

interface FdcFood {
  fdcId: number;
  description?: string;
  gtinUpc?: string;
  publishedDate?: string;
  brandOwner?: string;
  brandName?: string;
  ingredients?: string;
  foodCategory?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: { nutrientNumber?: string; value?: number }[];
}

export interface FdcCursor {
  /** publishedDate of the newest food seen, YYYY-MM-DD. */
  high_water: string;
  backfill_page: number;
  backfill_done: boolean;
}

const PAGE_SIZE = 200;

/** USDA nutrient numbers. Branded food values are per 100 g or 100 ml. */
const NUTRIENTS: Record<string, [label: string, scale: number]> = {
  "208": ["energy_kcal", 1],
  "203": ["protein_g", 1],
  "204": ["fat_g", 1],
  "606": ["saturated_fat_g", 1],
  "205": ["carbohydrate_g", 1],
  "269": ["sugars_g", 1],
  "291": ["fibre_g", 1],
  // Reported in milligrams.
  "307": ["sodium_g", 0.001],
};

async function page(n: number): Promise<FdcFood[]> {
  const params = new URLSearchParams({
    dataType: "Branded",
    pageSize: String(PAGE_SIZE),
    pageNumber: String(n),
    sortBy: "publishedDate",
    sortOrder: "desc",
    api_key: env("FDC_API_KEY") ?? "DEMO_KEY",
  });
  const body = await getJson<{ foods?: FdcFood[] }>(
    `https://api.nal.usda.gov/fdc/v1/foods/search?${params}`,
    config.userAgent(),
    "USDA FoodData Central",
  );
  return body?.foods ?? [];
}

export const fdc: Connector<FdcFood, FdcCursor, CatalogRecord> = {
  id: "fdc",
  sourceSlug: "usda-fdc",

  async fetch(cursor) {
    const state = cursor ?? { high_water: "", backfill_page: 2, backfill_done: false };

    const head = await page(1);
    // Dates have day precision, so the boundary day is taken again; identical records are skipped on write.
    const fresh = head.filter((f) => (f.publishedDate ?? "") >= state.high_water);
    const highWater = head.reduce((max, f) => ((f.publishedDate ?? "") > max ? f.publishedDate! : max), state.high_water);

    let backfill: FdcFood[] = [];
    let { backfill_page, backfill_done } = state;
    if (!backfill_done) {
      backfill = await page(backfill_page);
      if (backfill.length === 0) backfill_done = true;
      else backfill_page += 1;
    }

    return {
      items: [...fresh, ...backfill],
      cursor: { high_water: highWater, backfill_page, backfill_done },
    };
  },

  normalise(f) {
    const name = clean(f.description, 300);
    if (!name || !f.fdcId) return null;

    const nutrition: Record<string, number> = {};
    for (const n of f.foodNutrients ?? []) {
      const spec = n.nutrientNumber ? NUTRIENTS[n.nutrientNumber] : undefined;
      if (spec && typeof n.value === "number" && Number.isFinite(n.value)) {
        nutrition[spec[0]] = Number((n.value * spec[1]).toFixed(3));
      }
    }

    return {
      external_ref: `fdc:${f.fdcId}`,
      gtin: normaliseGtin(f.gtinUpc),
      name,
      brand_name: clean(f.brandName, 200) ?? clean(f.brandOwner, 200),
      categories: f.foodCategory ? [f.foodCategory] : [],
      image_url: null,
      ingredients_text: clean(f.ingredients, 4000),
      serving_size:
        clean(f.householdServingFullText, 100) ??
        (f.servingSize ? `${f.servingSize} ${(f.servingSizeUnit ?? "").toLowerCase()}`.trim() : null),
      nutrition: Object.keys(nutrition).length > 0 ? nutrition : null,
      source_url: `https://fdc.nal.usda.gov/food-details/${f.fdcId}/nutrients`,
    };
  },

  upsertObservations: upsertCatalogRecords,
};
