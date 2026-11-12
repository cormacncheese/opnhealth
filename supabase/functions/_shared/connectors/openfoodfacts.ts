// Open Food Facts (ODbL). Reads the search API ordered by last modification:
// each run takes the newest page, then walks one page further back through
// the existing catalog until it has seen everything.

import { normaliseGtin } from "../core/text.ts";
import { config } from "../env.ts";
import { type CatalogRecord, clean, type Connector, getJson, upsertCatalogRecords } from "./types.ts";

interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  categories_tags?: string[] | null;
  image_front_url?: string;
  ingredients_text?: string;
  serving_size?: string;
  last_modified_t?: number;
  nutriments?: Record<string, unknown>;
}

export interface OffCursor {
  /** last_modified_t of the newest product seen. */
  high_water: number;
  backfill_page: number;
  backfill_done: boolean;
}

const FIELDS =
  "code,product_name,brands,categories_tags,image_front_url,ingredients_text,serving_size,last_modified_t,nutriments";
const BACKFILL_PAGE_SIZE = 500;

const NUTRIENTS: Record<string, string> = {
  "energy-kcal_100g": "energy_kcal",
  proteins_100g: "protein_g",
  fat_100g: "fat_g",
  "saturated-fat_100g": "saturated_fat_g",
  carbohydrates_100g: "carbohydrate_g",
  sugars_100g: "sugars_g",
  fiber_100g: "fibre_g",
  sodium_100g: "sodium_g",
};

function searchUrl(page: number, pageSize: number): string {
  const params = new URLSearchParams({
    countries_tags_en: "united-states",
    sort_by: "last_modified_t",
    page_size: String(pageSize),
    page: String(page),
    fields: FIELDS,
  });
  return `https://world.openfoodfacts.org/api/v2/search?${params}`;
}

async function page(n: number, size: number): Promise<OffProduct[]> {
  const body = await getJson<{ products?: OffProduct[] }>(searchUrl(n, size), config.userAgent(), "Open Food Facts");
  return body?.products ?? [];
}

export const openFoodFacts: Connector<OffProduct, OffCursor, CatalogRecord> = {
  id: "openfoodfacts",
  sourceSlug: "openfoodfacts",

  async fetch(cursor) {
    const state = cursor ?? { high_water: 0, backfill_page: 2, backfill_done: false };

    const head = await page(1, 100);
    const fresh = head.filter((p) => (p.last_modified_t ?? 0) > state.high_water);
    const highWater = Math.max(state.high_water, ...head.map((p) => p.last_modified_t ?? 0));

    let backfill: OffProduct[] = [];
    let { backfill_page, backfill_done } = state;
    if (!backfill_done) {
      // Search requests closer together than this are refused.
      await new Promise((resolve) => setTimeout(resolve, 8000));
      backfill = await page(backfill_page, BACKFILL_PAGE_SIZE);
      if (backfill.length === 0) backfill_done = true;
      else backfill_page += 1;
    }

    return {
      items: [...fresh, ...backfill],
      cursor: { high_water: highWater, backfill_page, backfill_done },
    };
  },

  normalise(p) {
    const gtin = normaliseGtin(p.code);
    const name = clean(p.product_name, 300);
    // Entries without a valid barcode or a name cannot be tied to a product.
    if (!gtin || !name || !p.code) return null;

    const nutrition: Record<string, number> = {};
    for (const [key, label] of Object.entries(NUTRIENTS)) {
      const value = Number(p.nutriments?.[key]);
      if (p.nutriments?.[key] !== undefined && Number.isFinite(value)) {
        nutrition[label] = Number(value.toFixed(3));
      }
    }

    return {
      external_ref: p.code,
      gtin,
      name,
      brand_name: clean(p.brands?.split(",")[0], 200),
      categories: (p.categories_tags ?? []).slice(0, 12),
      image_url: clean(p.image_front_url, 500),
      ingredients_text: clean(p.ingredients_text, 4000),
      serving_size: clean(p.serving_size, 100),
      nutrition: Object.keys(nutrition).length > 0 ? nutrition : null,
      source_url: `https://world.openfoodfacts.org/product/${p.code}`,
    };
  },

  upsertObservations: upsertCatalogRecords,
};
