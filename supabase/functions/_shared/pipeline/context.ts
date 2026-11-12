// What every stage handler is given, and how runs are recorded.

import { createClient } from "@supabase/supabase-js";
import type { Step } from "../agents/types.ts";
import { type Db, json, type Sql, type Tx } from "../db.ts";
import { requireEnv } from "../env.ts";
import type { Llm, LlmUsage } from "../llm.ts";

/** Where original files live. Swapped for an in-memory store in tests. */
export interface DocumentStore {
  download(bucket: string, path: string): Promise<Uint8Array>;
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export interface Ctx {
  sql: Sql;
  llm: Llm;
  store: DocumentStore;
  now: () => Date;
}

/** Writes a stage's results. Runs inside the transaction that also removes the job from its queue. */
export type Commit = (tx: Tx) => Promise<void>;
export type Handler = (ctx: Ctx, payload: Record<string, unknown>) => Promise<Commit>;

/** For jobs that turn out to have nothing to do, e.g. a redelivered message. */
export const nothingToCommit: Commit = async () => {};

export const ORIGINALS_BUCKET = "coa-originals";

export function createSupabaseStore(): DocumentStore {
  const client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async download(bucket, path) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error) throw new Error(`Could not read ${bucket}/${path}: ${error.message}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async upload(bucket, path, bytes, contentType) {
      const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`Could not write ${bucket}/${path}: ${error.message}`);
    },
  };
}

export interface RunRecord {
  agent: string;
  promptVersion: string;
  subjectType: string;
  subjectId: string;
  /** Ties the run's detail to the submission's visibility. */
  submissionId?: string | null;
  /** True only when input and output hold nothing but public data. */
  isPublic?: boolean;
  status: "succeeded" | "failed";
  input: unknown;
  output?: unknown;
  error?: string;
  usage: LlmUsage[];
  steps: Step[];
  startedAt: Date;
}

/** Stores a finished run with its inputs, outputs and steps. Returns the run id. */
export async function saveRun(db: Db, run: RunRecord): Promise<string> {
  const inputTokens = run.usage.reduce((n, u) => n + u.inputTokens, 0);
  const outputTokens = run.usage.reduce((n, u) => n + u.outputTokens, 0);
  const costs = run.usage.map((u) => u.costUsd);
  const cost = costs.length > 0 && costs.every((c) => c !== null)
    ? costs.reduce<number>((n, c) => n + (c ?? 0), 0)
    : null;

  const [row] = await db`
    insert into public.agent_runs (
      agent, prompt_version, model, subject_type, subject_id, submission_id, status,
      input_tokens, output_tokens, cost_usd, started_at
    ) values (
      ${run.agent}, ${run.promptVersion}, ${run.usage[0]?.model ?? null}, ${run.subjectType},
      ${run.subjectId}, ${run.submissionId ?? null}, ${run.status},
      ${run.usage.length > 0 ? inputTokens : null}, ${run.usage.length > 0 ? outputTokens : null},
      ${cost}, ${run.startedAt}
    )
    returning id`;
  const runId = row.id as string;

  await db`
    insert into public.agent_run_io (run_id, is_public, input, output, error)
    values (
      ${runId}, ${run.isPublic ?? false}, ${json(db, run.input ?? {})},
      ${run.output === undefined ? null : json(db, run.output)}, ${run.error ?? null}
    )`;

  const steps: Step[] = [
    ...run.usage.map((u) => ({
      kind: "model_call" as const,
      name: u.name,
      durationMs: u.durationMs,
      detail: { model: u.model, input_tokens: u.inputTokens, output_tokens: u.outputTokens, cost_usd: u.costUsd },
    })),
    ...run.steps,
  ];
  for (const [idx, step] of steps.entries()) {
    await db`
      insert into public.agent_steps (run_id, idx, kind, name, duration_ms, detail)
      values (${runId}, ${idx}, ${step.kind}, ${step.name}, ${step.durationMs ?? null}, ${json(db, step.detail)})`;
  }
  return runId;
}

export interface DecisionInput {
  submissionId: string;
  coaReportId?: string | null;
  disputeId?: string | null;
  stage: "intake" | "extraction" | "adjudicator" | "supervisor";
  outcome: "publish" | "reject" | "escalate";
  confidence?: number | null;
  reasonCodes: string[];
  summary: string;
  reasons?: unknown[];
  runId: string | null;
}

/**
 * Records a decision. The database trigger on review_decisions changes the
 * submission's status, writes the ledger entry and queues redaction.
 */
export async function insertDecision(tx: Tx, d: DecisionInput): Promise<string> {
  const [row] = await tx`
    insert into public.review_decisions (
      submission_id, coa_report_id, dispute_id, stage, outcome, confidence, reason_codes, agent_run_id
    ) values (
      ${d.submissionId}, ${d.coaReportId ?? null}, ${d.disputeId ?? null}, ${d.stage}, ${d.outcome},
      ${d.confidence ?? null}, ${d.reasonCodes}::text[], ${d.runId}
    )
    returning id`;
  await tx`
    insert into public.review_decision_details (decision_id, submission_id, summary, reasons)
    values (${row.id}, ${d.submissionId}, ${d.summary}, ${json(tx, d.reasons ?? [])})`;
  return row.id as string;
}
