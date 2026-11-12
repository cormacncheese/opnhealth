// Queue consumer. One invocation drains a few messages from one queue:
// run the stage, commit its results and remove the message in a single
// transaction, or back off and retry, or move the job to the dead-letter queue.

import { errorMessage } from "../core/text.ts";
import { enqueue, recordEvent } from "../db.ts";
import { config } from "../env.ts";
import { coaHandlers } from "./coa.ts";
import { type Ctx, type Handler, saveRun } from "./context.ts";
import { opsHandlers } from "./ops.ts";

interface QueueSpec {
  handler: Handler;
  /** Agent name recorded on runs. */
  agent: string;
  /** Pipeline whose pause switch and budget govern this queue, if any. */
  pipeline: string | null;
}

export const QUEUES: Record<string, QueueSpec> = {
  intake: { handler: coaHandlers.intake, agent: "intake", pipeline: "coa" },
  extraction: { handler: coaHandlers.extraction, agent: "extraction", pipeline: "coa" },
  resolution: { handler: coaHandlers.resolution, agent: "resolver", pipeline: "coa" },
  verification: { handler: coaHandlers.verification, agent: "verifier", pipeline: "coa" },
  adjudication: { handler: coaHandlers.adjudication, agent: "adjudicator", pipeline: "coa" },
  redaction: { handler: coaHandlers.redaction, agent: "redactor", pipeline: "coa" },
  dispute: { handler: opsHandlers.dispute, agent: "dispute", pipeline: "coa" },
  brand_verification: { handler: opsHandlers.brandVerification, agent: "brand_verifier", pipeline: null },
  discovery: { handler: opsHandlers.discovery, agent: "discovery", pipeline: "discovery" },
  monitor: { handler: opsHandlers.monitor, agent: "monitor", pipeline: "monitor" },
  supervisor: { handler: opsHandlers.supervisor, agent: "supervisor", pipeline: null },
};

/** Seconds a message stays hidden while it is being worked on. */
const VISIBILITY_SECONDS = 300;

/** 30s, 2min, 8min between attempts. */
function backoffSeconds(attempt: number): number {
  return 30 * 4 ** Math.max(0, attempt - 1);
}

function subjectOf(payload: Record<string, unknown>): { type: string; id: string; submissionId: string | null } {
  if (typeof payload.submission_id === "string") {
    return { type: "submission", id: payload.submission_id, submissionId: payload.submission_id };
  }
  for (const [key, type] of [["dispute_id", "dispute"], ["brand_id", "brand"], ["claim_id", "brand_claim"]]) {
    if (typeof payload[key] === "string") return { type, id: payload[key] as string, submissionId: null };
  }
  return { type: "job", id: String(payload.task ?? "unknown"), submissionId: null };
}

export interface DrainResult {
  queue: string;
  paused: boolean;
  completed: number;
  retried: number;
  deadLettered: number;
}

export async function drainQueue(ctx: Ctx, queue: string, batch = 1): Promise<DrainResult> {
  const spec = QUEUES[queue];
  if (!spec) throw new Error(`Unknown queue: ${queue}`);
  const { sql } = ctx;
  const result: DrainResult = { queue, paused: false, completed: 0, retried: 0, deadLettered: 0 };

  if (spec.pipeline) {
    const [control] = await sql`
      select paused from public.pipeline_controls where pipeline = ${spec.pipeline}`;
    if (control?.paused) return { ...result, paused: true };
  }

  const messages = await sql`
    select msg_id, read_ct, message
    from pgmq.read(${queue}, ${VISIBILITY_SECONDS}::integer, ${batch}::integer)`;

  for (const m of messages) {
    const payload = m.message as Record<string, unknown>;
    const startedAt = ctx.now();
    try {
      const commit = await spec.handler(ctx, payload);
      await sql.begin(async (tx) => {
        await commit(tx);
        await tx`select pgmq.archive(${queue}, ${m.msg_id}::bigint)`;
      });
      result.completed++;
    } catch (e) {
      const error = errorMessage(e).slice(0, 2000);
      const subject = subjectOf(payload);
      const attempt = Number(m.read_ct);
      const exhausted = attempt >= config.maxAttempts;
      console.error(`[${queue}] attempt ${attempt} failed for ${subject.type} ${subject.id}: ${error}`);

      await sql.begin(async (tx) => {
        const runId = await saveRun(tx, {
          agent: spec.agent,
          promptVersion: "n/a",
          subjectType: subject.type,
          subjectId: subject.id,
          submissionId: subject.submissionId,
          status: "failed",
          input: { queue, attempt },
          error,
          usage: [],
          steps: [],
          startedAt,
        });
        if (exhausted) {
          await enqueue(tx, "dead_letter", { queue, payload, error, attempts: attempt });
          await tx`select pgmq.archive(${queue}, ${m.msg_id}::bigint)`;
          // The error text stays in the run record; the ledger only says that it happened.
          await recordEvent(tx, {
            type: "job.dead_lettered",
            subjectType: subject.type,
            subjectId: subject.id,
            actor: `agent:${spec.agent}`,
            payload: { queue, attempts: attempt },
            runId,
          });
        } else {
          await tx`select pgmq.set_vt(${queue}, ${m.msg_id}::bigint, ${backoffSeconds(attempt)}::integer)`;
        }
      });
      if (exhausted) result.deadLettered++;
      else result.retried++;
    }
  }
  return result;
}
