// Runs the golden set through the real agents and pipeline against a local
// database, scores the outcome and compares it with baseline.json.
//
//   supabase start && yarn evals            # needs AI_GATEWAY_API_KEY
//   yarn evals --update-baseline            # accept the new scores
//
// Exits non-zero when a score drops below the baseline, which is what CI gates on.

import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { createGatewayLlm } from "../supabase/functions/_shared/llm.ts";
import { sha256Hex } from "../supabase/functions/_shared/pdf.ts";
import type { Ctx } from "../supabase/functions/_shared/pipeline/context.ts";
import { drainQueue } from "../supabase/functions/_shared/pipeline/worker.ts";
import { config, env } from "../supabase/functions/_shared/env.ts";
import { makePdf, memoryStore } from "../tests/helpers.ts";
import { CASES, type EvalCase, type ExpectedResult } from "./cases.ts";

const STAGES = ["intake", "extraction", "resolution", "verification", "adjudication", "redaction"];
const FINAL = new Set(["published", "rejected", "escalated", "withdrawn", "failed"]);
const TOLERANCE = 0.02;
const BASELINE_PATH = new URL("./baseline.json", import.meta.url);

const dbUrl = env("EVAL_DATABASE_URL") ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

if (!env("AI_GATEWAY_API_KEY")) {
  console.error("AI_GATEWAY_API_KEY is not set, so the agents cannot call a model. Set it to run the evals.");
  process.exit(2);
}

const sql = postgres(dbUrl, { max: 2, onnotice: () => {} });
const store = memoryStore();
const ctx: Ctx = { sql, llm: createGatewayLlm(), store, now: () => new Date() };
const run = Math.random().toString(36).slice(2, 8);

function sameNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 0.01);
}

function sameUnit(a: string | null, b: string | null): boolean {
  const n = (u: string | null) => (u ?? "").toLowerCase().replace(/[µμ]/g, "u").replace(/\s/g, "");
  return n(a) === n(b);
}

async function submit(c: EvalCase): Promise<string> {
  const bytes = await makePdf([...c.lines, `eval ${run} ${c.id}`]);
  const sha = await sha256Hex(bytes);
  store.files.set(`coa-originals/${sha}.pdf`, bytes);
  return await sql.begin(async (tx) => {
    const [openSource] = await tx`select id from public.sources where slug = 'openfoodfacts'`;
    const [p] = await tx`
      select private.create_product(${openSource.id}, ${c.product.name}, ${`${c.product.brand} ${run}`},
                                    null, ${c.product.categories}) as id`;
    const slug = c.relationship === "brand" ? "brand-submission" : "consumer-submission";
    const [source] = await tx`select id from public.sources where slug = ${slug}`;
    const [doc] = await tx`
      insert into public.documents (sha256, storage_bucket, storage_path, mime_type, byte_size)
      values (${sha}, 'coa-originals', ${`${sha}.pdf`}, 'application/pdf', ${bytes.length}) returning id`;
    const [s] = await tx`
      insert into public.submissions (document_id, source_id, relationship, claimed_product_id)
      values (${doc.id}, ${source.id}, ${c.relationship}::public.submitter_relationship, ${p.id}) returning id`;
    await tx`insert into public.submission_private (submission_id, claimed_product_text) values (${s.id}, ${c.product.name})`;
    await tx`select pgmq.send('intake', ${tx.json({ submission_id: s.id })})`;
    return s.id as string;
  });
}

async function status(id: string): Promise<string> {
  const [row] = await sql`select status from public.submissions where id = ${id}`;
  return row.status;
}

interface CaseScore {
  id: string;
  accepted: boolean;
  intakeCorrect: boolean;
  matched: number;
  expectedRows: number;
  extractedRows: number;
  status: string;
  decisionCorrect: boolean;
  costUsd: number;
}

async function score(c: EvalCase, id: string): Promise<CaseScore> {
  const finalStatus = await status(id);
  const [intake] = await sql`
    select (io.output ->> 'reports_product_test_results')::boolean as accepted
    from public.agent_runs r join public.agent_run_io io on io.run_id = r.id
    where r.submission_id = ${id} and r.agent = 'intake' and r.status = 'succeeded'
    order by r.started_at desc limit 1`;
  const rows = await sql`
    select m.operator, m.value::float8 as value, m.unit, a.slug
    from public.measurements m
    left join public.analytes a on a.id = m.analyte_id
    where m.submission_id = ${id}`;
  const [{ cost }] = await sql`
    select coalesce(sum(cost_usd), 0)::float8 as cost from public.agent_runs where submission_id = ${id}`;

  const unused = [...rows];
  let matched = 0;
  for (const want of c.expect.results as ExpectedResult[]) {
    const i = unused.findIndex(
      (r) => r.slug === want.analyte && r.operator === want.operator && sameNumber(r.value, want.value) && sameUnit(r.unit, want.unit),
    );
    if (i >= 0) {
      matched++;
      unused.splice(i, 1);
    }
  }

  const accepted = Boolean(intake?.accepted);
  return {
    id: c.id,
    accepted,
    intakeCorrect: accepted === c.expect.accepted,
    matched,
    expectedRows: c.expect.results.length,
    extractedRows: rows.length,
    status: finalStatus,
    decisionCorrect: (c.expect.status as string[]).includes(finalStatus),
    costUsd: cost,
  };
}

async function main() {
  // The real workers would otherwise pick up these jobs halfway through.
  await sql`select cron.alter_job(jobid, active := false) from cron.job where jobname = 'dispatch-workers'`;
  try {
    for (const q of [...STAGES, "dead_letter"]) await sql`select pgmq.purge_queue(${q})`;
    // Earlier local test runs can leave the Supervisor's pause on; evals need the pipeline running.
    await sql`update public.pipeline_controls set paused = false, paused_reason = null, paused_at = null where pipeline = 'coa'`;
    const ids = new Map<string, string>();
    for (const c of CASES) ids.set(c.id, await submit(c));

    // Each pass moves every submission at most one stage forward.
    for (let pass = 0; pass < STAGES.length + 2; pass++) {
      for (const q of STAGES) {
        await sql`update ${sql(`pgmq.q_${q}`)} set vt = now()`;
        while ((await drainQueue(ctx, q, 5)).completed > 0);
      }
      const statuses = await Promise.all([...ids.values()].map(status));
      if (statuses.every((s) => FINAL.has(s))) break;
    }

    const scores: CaseScore[] = [];
    for (const c of CASES) scores.push(await score(c, ids.get(c.id)!));

    const expectedRows = scores.reduce((n, s) => n + s.expectedRows, 0);
    const extractedRows = scores.reduce((n, s) => n + s.extractedRows, 0);
    const matched = scores.reduce((n, s) => n + s.matched, 0);
    const metrics = {
      cases: scores.length,
      intake_accuracy: scores.filter((s) => s.intakeCorrect).length / scores.length,
      extraction_recall: expectedRows ? matched / expectedRows : 1,
      extraction_precision: extractedRows ? matched / extractedRows : 1,
      decision_accuracy: scores.filter((s) => s.decisionCorrect).length / scores.length,
      cost_usd: Number(scores.reduce((n, s) => n + s.costUsd, 0).toFixed(4)),
    };

    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<string, number | string>;
    const gated = ["intake_accuracy", "extraction_recall", "extraction_precision", "decision_accuracy"] as const;
    const failures = gated.filter((k) => metrics[k] < Number(baseline[k]) - TOLERANCE);
    const passed = failures.length === 0;

    console.table(scores.map((s) => ({ case: s.id, intake: s.intakeCorrect ? "ok" : "WRONG", rows: `${s.matched} of ${s.expectedRows}`, status: s.status, decision: s.decisionCorrect ? "ok" : "WRONG" })));
    console.log(JSON.stringify(metrics, null, 2));

    const [{ versions }] = await sql`
      select coalesce(jsonb_object_agg(agent, prompt_version), '{}') as versions
      from (select distinct on (agent) agent, prompt_version from public.agent_runs order by agent, started_at desc) v`;
    // Recorded where the run happened and, for scheduled runs on main, in the
    // hosted database too, where a failure makes the Supervisor pause publishing.
    const targets = [sql];
    const results = env("EVAL_RESULTS_DATABASE_URL");
    const hosted = results ? postgres(results, { max: 1, prepare: false, onnotice: () => {} }) : null;
    if (hosted) targets.push(hosted);
    for (const db of targets) {
      await db`
        insert into public.eval_runs (git_sha, model, prompt_versions, metrics, passed)
        values (${env("GITHUB_SHA") ?? null}, ${config.model()}, ${db.json(versions)}, ${db.json(metrics)}, ${passed})`;
    }
    await hosted?.end();

    if (process.argv.includes("--update-baseline")) {
      for (const k of gated) baseline[k] = Number(metrics[k].toFixed(3));
      writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
      console.log("Baseline updated.");
      return 0;
    }
    if (!passed) {
      console.error(`Below baseline: ${failures.map((k) => `${k} ${metrics[k].toFixed(3)} < ${baseline[k]}`).join(", ")}`);
      return 1;
    }
    console.log("All scores meet the baseline.");
    return 0;
  } finally {
    await sql`select cron.alter_job(jobid, active := true) from cron.job where jobname = 'dispatch-workers'`;
    await sql.end();
  }
}

process.exit(await main());
