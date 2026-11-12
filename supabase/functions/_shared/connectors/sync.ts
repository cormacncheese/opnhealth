// Runs one connector once: fetch, normalise, write, advance the cursor.

import { errorMessage } from "../core/text.ts";
import { json, recordEvent, type Sql } from "../db.ts";
import { fdc } from "./fdc.ts";
import { openFda } from "./openfda.ts";
import { openFoodFacts } from "./openfoodfacts.ts";
import type { Connector, Counts } from "./types.ts";

// deno-lint-ignore no-explicit-any
type AnyConnector = Connector<any, any, any>;

export const CONNECTORS: Record<string, AnyConnector> = {
  [openFoodFacts.id]: openFoodFacts,
  [fdc.id]: fdc,
  [openFda.id]: openFda,
};

export interface SyncResult extends Counts {
  connector: string;
  fetched: number;
}

export async function runConnector(sql: Sql, connector: AnyConnector): Promise<SyncResult> {
  const [source] = await sql`select id from public.sources where slug = ${connector.sourceSlug}`;
  if (!source) throw new Error(`Source ${connector.sourceSlug} is not registered`);
  const [state] = await sql`select cursor from public.sync_state where connector = ${connector.id}`;
  const previous = state && Object.keys(state.cursor).length > 0 ? state.cursor : null;

  try {
    const { items, cursor } = await connector.fetch(previous);
    const records = items.map((i) => connector.normalise(i)).filter((r) => r !== null);

    const counts = await sql.begin(async (tx) => {
      const c = await connector.upsertObservations(tx, source.id, records);
      await tx`
        insert into public.sync_state (connector, cursor, items_total, last_run_at, last_status, last_error)
        values (${connector.id}, ${json(tx, cursor)}, ${c.created}, now(), 'ok', null)
        on conflict (connector) do update set
          cursor = excluded.cursor,
          items_total = public.sync_state.items_total + excluded.items_total,
          last_run_at = now(), last_status = 'ok', last_error = null`;
      // One ledger entry per batch that changed something; per-item
      // provenance is in public.observations.
      if (c.created + c.changed > 0) {
        await recordEvent(tx, {
          type: "source.synced",
          subjectType: "source",
          subjectId: connector.sourceSlug,
          actor: `system:connector:${connector.id}`,
          payload: { created: c.created, changed: c.changed },
        });
      }
      return c;
    });

    return { connector: connector.id, fetched: items.length, ...counts, skipped: items.length - records.length + counts.skipped };
  } catch (e) {
    await sql`
      insert into public.sync_state (connector, last_run_at, last_status, last_error)
      values (${connector.id}, now(), 'error', ${errorMessage(e).slice(0, 500)})
      on conflict (connector) do update set
        last_run_at = now(), last_status = 'error', last_error = excluded.last_error`;
    throw e;
  }
}
