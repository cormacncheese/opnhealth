// Runs the agent pipeline on Cloudflare. pg_cron posts to /dispatch when a
// Postgres queue has work; the Worker hands that to a Cloudflare Queue, whose
// consumer has the CPU and wall-clock headroom long model calls need.
//
// Postgres (pgmq) stays the source of truth for jobs, retries and dead
// letters. The Cloudflare Queue only carries "go and drain queue X" signals.

import postgres from "postgres";
import { createGatewayLlm } from "../../../supabase/functions/_shared/llm.ts";
import { createSupabaseStore, type Ctx } from "../../../supabase/functions/_shared/pipeline/context.ts";
import { drainQueue, QUEUES } from "../../../supabase/functions/_shared/pipeline/worker.ts";

interface Signal {
  queue: string;
}

const TIME_BUDGET_MS = 10 * 60_000;
const MAX_JOBS = 20;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/dispatch") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (!env.WORKER_SECRET || request.headers.get("x-worker-secret") !== env.WORKER_SECRET) {
      return Response.json({ error: "Not authorised" }, { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as Partial<Signal>;
    if (typeof body.queue !== "string" || !(body.queue in QUEUES)) {
      return Response.json({ error: "Unknown queue" }, { status: 400 });
    }
    await env.AGENT_JOBS.send({ queue: body.queue });
    return Response.json({ accepted: true, queue: body.queue }, { status: 202 });
  },

  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      // A connection cannot outlive the invocation that opened it on Workers.
      const sql = postgres(env.SUPABASE_DB_URL, { max: 1, prepare: false, onnotice: () => {} });
      const ctx: Ctx = { sql, llm: createGatewayLlm(), store: createSupabaseStore(), now: () => new Date() };
      try {
        const started = Date.now();
        for (let i = 0; i < MAX_JOBS && Date.now() - started < TIME_BUDGET_MS; i++) {
          const result = await drainQueue(ctx, message.body.queue, 1);
          if (result.paused || result.completed + result.retried + result.deadLettered === 0) break;
        }
        message.ack();
      } catch (e) {
        console.error(JSON.stringify({ event: "drain_failed", queue: message.body.queue, error: String(e) }));
        message.retry({ delaySeconds: 30 });
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  },
} satisfies ExportedHandler<Env, Signal>;
