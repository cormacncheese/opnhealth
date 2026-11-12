// Called by pg_cron whenever a queue has work. Drains a few jobs from the
// named queue in the background and returns at once.

import { getDb } from "../_shared/db.ts";
import { isInternalCall, jsonResponse, runInBackground } from "../_shared/http.ts";
import { createGatewayLlm } from "../_shared/llm.ts";
import { createSupabaseStore, type Ctx } from "../_shared/pipeline/context.ts";
import { drainQueue, QUEUES } from "../_shared/pipeline/worker.ts";

/** Stop picking up new jobs after this long, leaving room to finish the current one. */
const TIME_BUDGET_MS = 60_000;
const MAX_JOBS = 5;

Deno.serve(async (req) => {
  if (!isInternalCall(req)) return jsonResponse({ error: "Not authorised" }, 401);

  const body = await req.json().catch(() => ({}));
  const queue = typeof body.queue === "string" ? body.queue : "";
  if (!(queue in QUEUES)) return jsonResponse({ error: "Unknown queue" }, 400);

  const ctx: Ctx = {
    sql: getDb(),
    llm: createGatewayLlm(),
    store: createSupabaseStore(),
    now: () => new Date(),
  };

  runInBackground(
    (async () => {
      const started = Date.now();
      for (let i = 0; i < MAX_JOBS && Date.now() - started < TIME_BUDGET_MS; i++) {
        const result = await drainQueue(ctx, queue, 1);
        if (result.paused || result.completed + result.retried + result.deadLettered === 0) break;
      }
    })(),
  );

  return jsonResponse({ accepted: true, queue }, 202);
});
