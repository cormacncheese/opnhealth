// A connector brings one public source into the database.
//
//   fetch              pull the next batch, given where the last run stopped
//   normalise          map one raw item to the shared record shape
//   upsertObservations write a batch; identical records are skipped
//
// New domains (tap water, air quality, restaurants) add connectors with
// their own record shapes; the sync runner does not change.

import { type Db, json } from "../db.ts";

export interface CatalogRecord {
  /** Stable id of the item within the source. */
  external_ref: string;
  /** 14-digit GTIN, already validated. */
  gtin: string | null;
  name: string;
  brand_name: string | null;
  categories: string[];
  image_url: string | null;
  ingredients_text: string | null;
  serving_size: string | null;
  /** Per 100 g or 100 ml, as stated by the source. */
  nutrition: Record<string, number> | null;
  source_url: string;
}

export interface RecallRecord {
  external_ref: string;
  firm: string | null;
  product_description: string | null;
  reason: string | null;
  classification: string | null;
  status: string | null;
  recall_date: string | null;
  report_date: string | null;
  url: string;
  raw: Record<string, unknown>;
}

export interface Counts {
  created: number;
  changed: number;
  skipped: number;
}

export interface Connector<Raw, Cursor, Rec> {
  id: string;
  /** Slug of the row in public.sources. */
  sourceSlug: string;
  fetch(cursor: Cursor | null): Promise<{ items: Raw[]; cursor: Cursor }>;
  normalise(raw: Raw): Rec | null;
  upsertObservations(db: Db, sourceId: string, records: Rec[]): Promise<Counts>;
}

export async function upsertCatalogRecords(db: Db, sourceId: string, records: CatalogRecord[]): Promise<Counts> {
  if (records.length === 0) return { created: 0, changed: 0, skipped: 0 };
  const [row] = await db`select private.upsert_catalog_records(${sourceId}, ${json(db, records)}) as counts`;
  return row.counts as Counts;
}

export async function upsertRecalls(db: Db, sourceId: string, records: RecallRecord[]): Promise<Counts> {
  if (records.length === 0) return { created: 0, changed: 0, skipped: 0 };
  const [row] = await db`select private.upsert_recalls(${sourceId}, ${json(db, records)}) as counts`;
  return row.counts as Counts;
}

/** GET returning JSON. Errors carry the status only, never the URL, which may hold an API key. */
export async function getJson<T>(url: string, userAgent: string, source: string): Promise<T | null> {
  // Public data APIs answer bursts with 429s and 5xxs. Open Food Facts search
  // in particular refuses requests less than several seconds apart.
  const attempts = 4;
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": userAgent, Accept: "application/json" },
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      if (attempt < attempts) continue;
      throw new Error(`${source} could not be reached`);
    }
    if (res.status === 404) return null;
    if (res.ok) return (await res.json()) as T;
    await res.body?.cancel();
    const transient = res.status === 429 || res.status >= 500;
    if (!transient || attempt >= attempts) throw new Error(`${source} responded with status ${res.status}`);
    await new Promise((resolve) => setTimeout(resolve, 8000 * attempt));
  }
}

export function clean(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}
