// openFDA food enforcement reports (recalls). Walks forward by report date.

import { config } from "../env.ts";
import { clean, type Connector, getJson, type RecallRecord, upsertRecalls } from "./types.ts";

interface FdaRecall {
  recall_number?: string;
  recalling_firm?: string;
  product_description?: string;
  reason_for_recall?: string;
  classification?: string;
  status?: string;
  recall_initiation_date?: string;
  report_date?: string;
  code_info?: string;
  distribution_pattern?: string;
  product_quantity?: string;
  event_id?: string;
  state?: string;
  country?: string;
}

export interface FdaCursor {
  /** Fetch reports dated on or after this day, YYYYMMDD. */
  since: string;
  skip: number;
}

const LIMIT = 100;
/** openFDA refuses skip values above this. */
const MAX_SKIP = 25_000;
/** How far back the first run reaches. */
const INITIAL_YEARS = 2;

function compact(d: Date): string {
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

function isoFromCompact(s: string | undefined): string | null {
  return s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

export const openFda: Connector<FdaRecall, FdaCursor, RecallRecord> = {
  id: "openfda",
  sourceSlug: "openfda",

  async fetch(cursor) {
    const start = new Date();
    start.setUTCFullYear(start.getUTCFullYear() - INITIAL_YEARS);
    const state = cursor ?? { since: compact(start), skip: 0 };

    // openFDA's query syntax needs literal brackets and '+', so the URL is built by hand.
    const url =
      `https://api.fda.gov/food/enforcement.json?search=report_date:[${state.since}+TO+29991231]` +
      `&sort=report_date:asc&limit=${LIMIT}&skip=${state.skip}`;
    const body = await getJson<{ results?: FdaRecall[] }>(url, config.userAgent(), "openFDA");
    const items = body?.results ?? [];

    const lastDate = items.at(-1)?.report_date ?? state.since;
    const full = items.length === LIMIT;
    const next: FdaCursor =
      full && state.skip + LIMIT < MAX_SKIP
        ? { since: state.since, skip: state.skip + LIMIT }
        // Caught up, or at the paging limit: restart from the last day seen.
        : { since: lastDate, skip: 0 };

    return { items, cursor: next };
  },

  normalise(r) {
    if (!r.recall_number) return null;
    return {
      external_ref: r.recall_number,
      firm: clean(r.recalling_firm, 300),
      product_description: clean(r.product_description, 4000),
      reason: clean(r.reason_for_recall, 4000),
      classification: clean(r.classification, 50),
      status: clean(r.status, 50),
      recall_date: isoFromCompact(r.recall_initiation_date),
      report_date: isoFromCompact(r.report_date),
      url: `https://api.fda.gov/food/enforcement.json?search=recall_number:%22${encodeURIComponent(r.recall_number)}%22`,
      raw: {
        code_info: clean(r.code_info, 2000),
        distribution_pattern: clean(r.distribution_pattern, 1000),
        product_quantity: clean(r.product_quantity, 200),
        event_id: r.event_id ?? null,
        state: r.state ?? null,
        country: r.country ?? null,
      },
    };
  },

  upsertObservations: upsertRecalls,
};
