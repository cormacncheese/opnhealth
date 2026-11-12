// Direct Postgres access for Edge Functions. Stage commits need real
// transactions (results, ledger event and next-stage message together),
// which the REST API cannot give.

// postgres.js is pinned to the 3.4 line in every function's deno.json: 4.x
// failed with message-framing errors on large result sets in the Edge runtime.
import postgres from "postgres";
import { requireEnv } from "./env.ts";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
/** Anything a query can run on: the pool or an open transaction. */
export type Db = Sql | Tx;

let pool: Sql | undefined;

export function getDb(): Sql {
  pool ??= postgres(requireEnv("SUPABASE_DB_URL"), {
    // Each isolate handles one job at a time; keep the footprint small.
    max: 2,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
  });
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end({ timeout: 5 });
  pool = undefined;
}

export interface EventInput {
  type: string;
  subjectType: string;
  subjectId: string;
  actor: string;
  payload?: Record<string, unknown>;
  runId?: string | null;
}

/** Appends to the public ledger. Payloads must never contain personal data. */
export async function recordEvent(db: Db, e: EventInput): Promise<number> {
  const [row] = await db`
    select private.record_event(
      ${e.type}, ${e.subjectType}, ${e.subjectId}, ${e.actor},
      ${db.json((e.payload ?? {}) as postgres.JSONValue)}, ${e.runId ?? null}
    ) as seq`;
  return Number(row.seq);
}

export async function enqueue(
  db: Db,
  queue: string,
  payload: Record<string, unknown>,
  delaySeconds = 0,
): Promise<void> {
  await db`select pgmq.send(${queue}, ${db.json(payload as postgres.JSONValue)}, ${delaySeconds}::integer)`;
}

export async function setSubmissionStatus(
  db: Db,
  submissionId: string,
  status: string,
  actor: string,
  payload: Record<string, unknown> = {},
  runId: string | null = null,
): Promise<void> {
  await db`
    select private.set_submission_status(
      ${submissionId}, ${status}::public.submission_status, ${actor},
      ${db.json(payload as postgres.JSONValue)}, ${runId}
    )`;
}

export function json(db: Db, value: unknown) {
  return db.json(value as postgres.JSONValue);
}
