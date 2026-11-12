// Everything around the COA pipeline: disputes, brand claims, discovery,
// monitoring and supervision.

import { BRAND_VERIFIER_VERSION, CLAIM_RETRY_SECONDS, verifyClaim } from "../agents/brand_verifier.ts";
import { discoverBrandDocuments, DISCOVERY_PROMPT_VERSION, isSafePublicUrl } from "../agents/discovery.ts";
import { DISPUTE_PROMPT_VERSION, triageDispute } from "../agents/dispute.ts";
import { matchRecall, MONITOR_PROMPT_VERSION } from "../agents/monitor.ts";
import type { ProductCandidate } from "../agents/resolver.ts";
import {
  isTransientError,
  type PipelineHealth,
  planSupervision,
  SUPERVISOR_VERSION,
} from "../agents/supervisor.ts";
import { enqueue, json, recordEvent, type Sql } from "../db.ts";
import { config } from "../env.ts";
import { sha256Hex, sniffFileKind } from "../pdf.ts";
import { type Handler, insertDecision, nothingToCommit, ORIGINALS_BUCKET, saveRun } from "./context.ts";

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

const dispute: Handler = async (ctx, payload) => {
  const { sql } = ctx;
  const disputeId = payload.dispute_id;
  if (typeof disputeId !== "string") throw new Error("Job payload has no dispute_id");

  const [d] = await sql`
    select d.id, d.submission_id, d.category, d.status, dd.relationship, dd.reason, dd.evidence_url
    from public.disputes d
    join public.dispute_details dd on dd.dispute_id = d.id
    where d.id = ${disputeId}`;
  if (!d || d.status !== "open") return nothingToCommit;
  const startedAt = ctx.now();

  const [record] = await sql`
    select
      p.name as product, l.name as lab, r.report_date,
      (select dt.summary from public.review_decisions rd
         join public.review_decision_details dt on dt.decision_id = rd.id
        where rd.submission_id = s.id order by rd.created_at desc limit 1) as decision_summary,
      (select v.checks from public.verification_reports v
        where v.submission_id = s.id order by v.created_at desc limit 1) as checks
    from public.submissions s
    left join public.products p on p.id = s.product_id
    left join public.labs l on l.id = s.lab_id
    left join lateral (
      select report_date from public.coa_reports c
      where c.submission_id = s.id order by c.created_at desc limit 1
    ) r on true
    where s.id = ${d.submission_id}`;

  const result = await triageDispute(ctx.llm, {
    category: d.category,
    relationship: d.relationship,
    reason: d.reason,
    evidenceUrl: d.evidence_url,
    record: {
      product: record?.product ?? null,
      lab: record?.lab ?? null,
      report_date: record?.report_date ? new Date(record.report_date).toISOString().slice(0, 10) : null,
      decision_summary: record?.decision_summary ?? null,
      checks: record?.checks ?? [],
    },
  });
  const out = result.output;
  const status = out.action === "dismiss" ? "dismissed" : out.action === "reopen" ? "reopened" : "escalated";

  return async (tx) => {
    // Not linked to the submission: the dispute text is private to its author.
    const runId = await saveRun(tx, {
      agent: "dispute",
      promptVersion: DISPUTE_PROMPT_VERSION,
      subjectType: "dispute",
      subjectId: d.id,
      status: "succeeded",
      input: { submission_id: d.submission_id, category: d.category },
      output: out,
      usage: result.usage,
      steps: result.steps,
      startedAt,
    });
    await tx`
      update public.disputes
      set status = ${status}, resolution_code = ${out.resolution_code},
          resolved_at = ${out.action === "dismiss" ? ctx.now() : null}
      where id = ${d.id}`;
    await tx`update public.dispute_details set resolution = ${out.rationale} where dispute_id = ${d.id}`;
    await recordEvent(tx, {
      type: out.action === "dismiss" ? "dispute.resolved" : `dispute.${status}`,
      subjectType: "dispute",
      subjectId: d.id,
      actor: "agent:dispute",
      payload: { submission_id: d.submission_id, resolution_code: out.resolution_code },
      runId,
    });
    if (out.action === "reopen") {
      await enqueue(tx, "verification", { submission_id: d.submission_id, dispute_id: d.id });
    }
  };
};

// ---------------------------------------------------------------------------
// Brand claims
// ---------------------------------------------------------------------------

const brandVerification: Handler = async (ctx, payload) => {
  const { sql } = ctx;
  if (typeof payload.claim_id !== "string") throw new Error("Job payload has no claim_id");
  const [claim] = await sql`
    select m.id, m.brand_id, m.status, m.email_domain, m.challenge_token, m.attempts, b.website
    from public.brand_members m
    join public.brands b on b.id = m.brand_id
    where m.id = ${payload.claim_id}`;
  if (!claim || claim.status !== "pending") return nothingToCommit;
  const startedAt = ctx.now();

  const verdict = await verifyClaim({
    brandWebsite: claim.website,
    emailDomain: claim.email_domain,
    challengeToken: claim.challenge_token,
    attempts: claim.attempts,
  });

  return async (tx) => {
    await saveRun(tx, {
      agent: "brand_verifier",
      promptVersion: BRAND_VERIFIER_VERSION,
      subjectType: "brand",
      subjectId: claim.brand_id,
      status: "succeeded",
      input: { claim_id: claim.id, attempt: claim.attempts + 1 },
      output: verdict,
      usage: [],
      steps: [],
      startedAt,
    });
    // The brand_claim_decided trigger writes the ledger entry on a status change.
    await tx`
      update public.brand_members
      set status = ${verdict.status},
          method = ${verdict.status === "verified" ? verdict.method : null},
          note = ${verdict.note},
          attempts = attempts + 1
      where id = ${claim.id}`;
    if (verdict.status === "pending") {
      await enqueue(tx, "brand_verification", { claim_id: claim.id }, CLAIM_RETRY_SECONDS);
      if (!claim.website) {
        await tx`select private.enqueue_once('discovery', ${json(tx, { brand_id: claim.brand_id })})`;
      }
    }
  };
};

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

interface Downloaded {
  url: string;
  bytes: Uint8Array;
  mime: string;
  sha256: string;
}

async function downloadDocument(url: string): Promise<Downloaded | null> {
  if (!isSafePublicUrl(url)) return null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": config.userAgent() },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok || !isSafePublicUrl(res.url)) return null;
    if (Number(res.headers.get("content-length") ?? 0) > config.maxFileBytes) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > config.maxFileBytes) return null;
    const mime = sniffFileKind(bytes);
    return mime ? { url, bytes, mime, sha256: await sha256Hex(bytes) } : null;
  } catch {
    return null;
  }
}

const discovery: Handler = async (ctx, payload) => {
  const { sql } = ctx;
  if (typeof payload.brand_id !== "string") throw new Error("Job payload has no brand_id");
  const [brand] = await sql`select id, name, website from public.brands where id = ${payload.brand_id}`;
  if (!brand) return nothingToCommit;
  const startedAt = ctx.now();

  const result = await discoverBrandDocuments(ctx.llm, { name: brand.name, website: brand.website }, new Set());
  const out = result.output;

  const fresh: (Downloaded & { path: string })[] = [];
  for (const doc of out.documents) {
    const [seen] = await sql`select 1 from public.documents where origin_url = ${doc.url} limit 1`;
    if (seen) continue;
    const file = await downloadDocument(doc.url);
    if (!file || fresh.some((f) => f.sha256 === file.sha256)) continue;
    const [known] = await sql`select 1 from public.documents where sha256 = ${file.sha256}`;
    if (known) continue;
    const ext = file.mime === "application/pdf" ? "pdf" : file.mime === "image/png" ? "png" : "jpg";
    const path = `${file.sha256}.${ext}`;
    await ctx.store.upload(ORIGINALS_BUCKET, path, file.bytes, file.mime);
    fresh.push({ ...file, path });
  }

  return async (tx) => {
    const runId = await saveRun(tx, {
      agent: "discovery",
      promptVersion: DISCOVERY_PROMPT_VERSION,
      subjectType: "brand",
      subjectId: brand.id,
      // Only public web pages went in and came out.
      isPublic: true,
      status: "succeeded",
      input: { brand: brand.name, website_on_record: brand.website },
      output: { ...out, new_documents: fresh.map((f) => f.url) },
      usage: result.usage,
      steps: result.steps,
      startedAt,
    });

    await tx`
      update public.brands
      set last_crawled_at = now(), website = coalesce(website, ${out.website})
      where id = ${brand.id}`;
    if (!brand.website && out.website) {
      await recordEvent(tx, {
        type: "brand.website_confirmed",
        subjectType: "brand",
        subjectId: brand.id,
        actor: "agent:discovery",
        payload: { website: out.website, method: out.websiteMethod },
        runId,
      });
    }

    const [source] = await tx`select id from public.sources where slug = 'brand-website'`;
    for (const f of fresh) {
      const [doc] = await tx`
        insert into public.documents (sha256, storage_bucket, storage_path, mime_type, byte_size, origin_url)
        values (${f.sha256}, ${ORIGINALS_BUCKET}, ${f.path}, ${f.mime}, ${f.bytes.length}, ${f.url})
        on conflict (sha256) do nothing
        returning id`;
      if (!doc) continue;
      const [submission] = await tx`
        insert into public.submissions (document_id, source_id, relationship)
        values (${doc.id}, ${source.id}, 'crawler')
        returning id`;
      await tx`
        insert into public.submission_private (submission_id, claimed_product_text)
        values (${submission.id}, ${brand.name})`;
      await recordEvent(tx, {
        type: "submission.received",
        subjectType: "submission",
        subjectId: submission.id,
        actor: "agent:discovery",
        payload: { relationship: "crawler", brand_id: brand.id, origin_url: f.url, sha256: f.sha256 },
        runId,
      });
      await enqueue(tx, "intake", { submission_id: submission.id });
    }
  };
};

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

const RECALL_BATCH = 5;

async function recallCandidates(sql: Sql, firm: string | null, description: string | null): Promise<ProductCandidate[]> {
  const found = new Map<string, ProductCandidate>();
  const add = (rows: readonly Record<string, unknown>[]) => {
    for (const r of rows) {
      found.set(r.id as string, {
        id: r.id as string,
        name: r.name as string,
        brand_name: (r.brand_name as string) ?? null,
        gtin: (r.gtin as string) ?? null,
        category: (r.category as string) ?? null,
      });
    }
  };
  if (firm) {
    add(await sql`
      select p.id, p.name, p.brand_name, p.gtin, p.category
      from public.brands b
      join public.products p on p.brand_id = b.id
      where extensions.similarity(b.name, ${firm}) > 0.45
      order by extensions.similarity(p.name, ${description ?? ""}) desc
      limit 8`);
  }
  if (description && found.size < 8) {
    add(await sql`
      select id, name, brand_name, gtin, category
      from public.search_products(${description.slice(0, 120)}, 6)`);
  }
  return [...found.values()].slice(0, 10);
}

const monitor: Handler = async (ctx, payload) => {
  const { sql } = ctx;
  const startedAt = ctx.now();

  if (payload.task === "recalls") {
    const recalls = await sql`
      select id, firm, product_description, reason from public.recalls
      where matched_at is null
      order by created_at
      limit ${RECALL_BATCH}`;
    if (recalls.length === 0) return nothingToCommit;

    const outcomes: { recall: { id: string }; candidates: number; result: Awaited<ReturnType<typeof matchRecall>> }[] = [];
    for (const r of recalls) {
      const candidates = await recallCandidates(sql, r.firm, r.product_description);
      const result = await matchRecall(ctx.llm, {
        firm: r.firm, product_description: r.product_description, reason: r.reason, candidates,
      });
      outcomes.push({ recall: { id: r.id }, candidates: candidates.length, result });
    }

    return async (tx) => {
      const runId = await saveRun(tx, {
        agent: "monitor",
        promptVersion: MONITOR_PROMPT_VERSION,
        subjectType: "job",
        subjectId: "recalls",
        isPublic: true,
        status: "succeeded",
        input: { recalls: recalls.map((r) => r.id) },
        output: outcomes.map((o) => ({ recall_id: o.recall.id, candidates: o.candidates, matches: o.result.output.matches })),
        usage: outcomes.flatMap((o) => o.result.usage),
        steps: [],
        startedAt,
      });
      for (const o of outcomes) {
        for (const m of o.result.output.matches) {
          await tx`
            insert into public.recall_products (recall_id, product_id, confidence, rationale, agent_run_id)
            values (${o.recall.id}, ${m.product_id}, ${Math.min(1, m.confidence)}, ${m.rationale}, ${runId})
            on conflict (recall_id, product_id) do nothing`;
        }
        await tx`update public.recalls set matched_at = now() where id = ${o.recall.id}`;
        if (o.result.output.matches.length > 0) {
          await recordEvent(tx, {
            type: "recall.matched",
            subjectType: "recall",
            subjectId: o.recall.id,
            actor: "agent:monitor",
            payload: { product_ids: o.result.output.matches.map((m) => m.product_id) },
            runId,
          });
        }
      }
      // Keep going while a backlog remains; the budget check can pause it.
      if (recalls.length === RECALL_BATCH) {
        await tx`select private.enqueue_once('monitor', ${json(tx, { task: "recalls" })})`;
      }
    };
  }

  // Daily sweep: flag stale reports, and re-check records from labs whose
  // accreditation has since been revoked.
  const stale = await sql`
    select s.id, r.report_date
    from public.submissions s
    join lateral (
      select report_date from public.coa_reports c
      where c.submission_id = s.id order by c.created_at desc limit 1
    ) r on true
    where s.status = 'published'
      and r.report_date < (now() - make_interval(months => ${config.staleAfterMonths}))::date
      and not exists (
        select 1 from public.events e
        where e.subject_type = 'submission' and e.subject_id = s.id::text and e.event_type = 'coa.stale'
      )
    limit 500`;
  const recheck = await sql`
    select s.id
    from public.submissions s
    join public.labs l on l.id = s.lab_id
    where s.status = 'published'
      and l.accreditation_status = 'revoked'
      and not exists (
        select 1 from public.events e
        where e.subject_type = 'submission' and e.subject_id = s.id::text
          and e.event_type = 'submission.reverification_scheduled'
          and e.occurred_at > coalesce(l.accreditation_checked_at, '-infinity')
      )
    limit 100`;
  if (stale.length === 0 && recheck.length === 0) return nothingToCommit;

  return async (tx) => {
    const runId = await saveRun(tx, {
      agent: "monitor",
      promptVersion: MONITOR_PROMPT_VERSION,
      subjectType: "job",
      subjectId: "daily",
      isPublic: true,
      status: "succeeded",
      input: {},
      output: { stale: stale.length, reverification_scheduled: recheck.length },
      usage: [],
      steps: [],
      startedAt,
    });
    for (const s of stale) {
      await recordEvent(tx, {
        type: "coa.stale",
        subjectType: "submission",
        subjectId: s.id,
        actor: "agent:monitor",
        payload: { report_date: new Date(s.report_date).toISOString().slice(0, 10) },
        runId,
      });
    }
    for (const s of recheck) {
      await recordEvent(tx, {
        type: "submission.reverification_scheduled",
        subjectType: "submission",
        subjectId: s.id,
        actor: "agent:monitor",
        payload: { reason: "lab_accreditation_revoked" },
        runId,
      });
      await enqueue(tx, "verification", { submission_id: s.id, reverify: true });
    }
  };
};

// ---------------------------------------------------------------------------
// Supervisor
// ---------------------------------------------------------------------------

const supervisor: Handler = async (ctx) => {
  const { sql } = ctx;
  const startedAt = ctx.now();

  const dead = await sql`select msg_id, message from pgmq.read('dead_letter', 120, 20)`;

  const pipelines = await sql`
    select
      c.pipeline, c.paused, c.paused_reason, c.daily_budget_usd,
      coalesce((
        select sum(r.cost_usd) from public.agent_runs r
        where r.finished_at >= date_trunc('day', now())
          and case
            when r.agent = 'discovery' then 'discovery'
            when r.agent = 'monitor' then 'monitor'
            else 'coa'
          end = c.pipeline
      ), 0) as spent
    from public.pipeline_controls c`;
  const health: PipelineHealth[] = pipelines.map((p) => ({
    pipeline: p.pipeline,
    paused: p.paused,
    pausedReason: p.paused_reason,
    dailyBudgetUsd: Number(p.daily_budget_usd),
    spentTodayUsd: Number(p.spent),
  }));

  const [q] = await sql`
    select
      (select passed from public.eval_runs order by created_at desc limit 1) as latest_eval_passed,
      (select count(*)::int from public.review_decisions d
        where d.stage = 'adjudicator' and d.outcome = 'publish'
          and d.created_at > now() - interval '7 days') as agent_publishes,
      (select count(distinct d.submission_id)::int from public.review_decisions d
        join public.submissions s on s.id = d.submission_id
        where d.stage = 'adjudicator' and d.outcome = 'publish'
          and d.created_at > now() - interval '7 days' and s.status = 'withdrawn') as overturned,
      (select count(*)::int from public.agent_runs r
        where r.finished_at > now() - interval '1 hour'
          and r.agent not in ('discovery', 'monitor', 'supervisor', 'brand_verifier')) as runs,
      (select count(*)::int from public.agent_runs r
        where r.finished_at > now() - interval '1 hour' and r.status = 'failed'
          and r.agent not in ('discovery', 'monitor', 'supervisor', 'brand_verifier')) as runs_failed`;

  const actions = planSupervision(health, {
    latestEvalPassed: q.latest_eval_passed,
    agentPublishes: q.agent_publishes,
    publishesOverturned: q.overturned,
    runs: q.runs,
    runsFailed: q.runs_failed,
  });

  if (dead.length === 0 && actions.length === 0) return nothingToCommit;

  return async (tx) => {
    const runId = await saveRun(tx, {
      agent: "supervisor",
      promptVersion: SUPERVISOR_VERSION,
      subjectType: "job",
      subjectId: "sweep",
      isPublic: true,
      status: "succeeded",
      input: { dead_letters: dead.length, pipelines: health },
      output: { actions },
      usage: [],
      steps: [],
      startedAt,
    });

    for (const m of dead) {
      const job = m.message as {
        queue: string;
        payload: Record<string, unknown>;
        error: string;
      };
      const submissionId = typeof job.payload.submission_id === "string" ? job.payload.submission_id : null;

      if (isTransientError(job.error) && !job.payload._retried_by_supervisor) {
        await enqueue(tx, job.queue, { ...job.payload, _retried_by_supervisor: true });
      } else if (submissionId) {
        await insertDecision(tx, {
          submissionId,
          stage: "supervisor",
          outcome: "escalate",
          reasonCodes: ["pipeline_failure"],
          summary: `Processing failed at the ${job.queue} stage after repeated attempts, so a maintainer needs to look at this submission.`,
          runId,
        });
      } else {
        await recordEvent(tx, {
          type: "job.abandoned",
          subjectType: "job",
          subjectId: job.queue,
          actor: "agent:supervisor",
          payload: { queue: job.queue },
          runId,
        });
      }
      await tx`select pgmq.archive('dead_letter', ${m.msg_id}::bigint)`;
    }

    for (const a of actions) {
      await tx`
        update public.pipeline_controls
        set paused = ${a.action === "pause"},
            paused_reason = ${a.action === "pause" ? a.reason : null},
            paused_at = ${a.action === "pause" ? ctx.now() : null}
        where pipeline = ${a.pipeline}`;
      await recordEvent(tx, {
        type: a.action === "pause" ? "pipeline.paused" : "pipeline.resumed",
        subjectType: "pipeline",
        subjectId: a.pipeline,
        actor: "agent:supervisor",
        payload: { reason: a.reason },
        runId,
      });
    }
  };
};

export const opsHandlers = { dispute, brandVerification, discovery, monitor, supervisor };
