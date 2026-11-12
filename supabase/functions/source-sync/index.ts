// Called by pg_cron on each connector's schedule.

import { CONNECTORS, runConnector } from "../_shared/connectors/sync.ts";
import { errorMessage } from "../_shared/core/text.ts";
import { getDb } from "../_shared/db.ts";
import { isInternalCall, jsonResponse } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (!isInternalCall(req)) return jsonResponse({ error: "Not authorised" }, 401);

  const body = await req.json().catch(() => ({}));
  const connector = CONNECTORS[body.connector];
  if (!connector) return jsonResponse({ error: "Unknown connector" }, 400);

  try {
    return jsonResponse(await runConnector(getDb(), connector));
  } catch (e) {
    console.error(`[source-sync] ${connector.id} failed:`, e);
    return jsonResponse({ error: errorMessage(e) }, 502);
  }
});
