"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { EventRow } from "@/components/event-row";
import { Badge, ButtonLink, Empty, Loading, Panel, Section, statusTone } from "@/components/ui";
import {
  ACCREDITATION,
  formatDate,
  formatDateTime,
  formatResult,
  type LedgerEvent,
  OUTCOME,
  reasonLabel,
  RELATIONSHIP,
  STAGE,
  STATUS,
} from "@/lib/format";
import { browserClient } from "@/lib/supabase/browser";

// What the agents are doing now, worded from the last thing they recorded.
const IN_FLIGHT: Record<string, string> = {
  "submission.received": "Waiting for an agent to pick this up",
  "submission.processing": "Reading the results from the document",
  "submission.extracted": "Matching the report to a product",
  "submission.resolved": "Checking each result against the document",
  "submission.verified": "Deciding whether to publish",
  "submission.approved": "Removing personal details before publishing",
  "dispute.reopened": "Checking the report again after a dispute",
  "submission.reverification_scheduled": "Checking the report again",
};

async function load(id: string) {
  const supabase = browserClient();
  const [submission, decisions, details, report, measurements, verification, pages, runs, events, disputes] =
    await Promise.all([
      supabase
        .from("submissions")
        .select(
          "id, status, relationship, created_at, product_id, products!submissions_product_id_fkey(id, name, brand_name), labs(name, accreditation_status), documents(sha256, page_count, mime_type)",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase.from("review_decisions").select("*").eq("submission_id", id).order("created_at"),
      supabase.from("review_decision_details").select("decision_id, summary").eq("submission_id", id),
      supabase
        .from("coa_reports")
        .select("*")
        .eq("submission_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("measurements")
        .select("id, coa_report_id, analyte_name_raw, operator, value, unit, loq, method, page_number, analytes(name)")
        .eq("submission_id", id)
        .order("created_at"),
      supabase
        .from("verification_reports")
        .select("risk, checks, summary, created_at")
        .eq("submission_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("document_pages")
        .select("page_number, redacted_text, documents!inner(submissions!inner(id))")
        .eq("documents.submissions.id", id)
        .order("page_number"),
      supabase
        .from("agent_runs")
        .select("id, agent, model, status, cost_usd, started_at, finished_at")
        .eq("submission_id", id)
        .order("started_at"),
      supabase
        .from("events")
        .select("seq, occurred_at, event_type, subject_type, subject_id, actor, agent_run_id, payload, hash")
        .eq("subject_type", "submission")
        .eq("subject_id", id)
        .order("seq", { ascending: false }),
      supabase.from("disputes").select("id, category, status, created_at").eq("submission_id", id).order("created_at"),
    ]);

  const error =
    submission.error ?? decisions.error ?? details.error ?? report.error ?? measurements.error ??
    verification.error ?? pages.error ?? runs.error ?? events.error ?? disputes.error;
  if (error) throw new Error(error.message);

  return {
    submission: submission.data,
    decisions: decisions.data ?? [],
    summaries: new Map((details.data ?? []).map((d) => [d.decision_id, d.summary])),
    report: report.data,
    // Only the results of the current reading of the document.
    measurements: (measurements.data ?? []).filter((m) => m.coa_report_id === report.data?.id),
    verification: verification.data,
    pages: pages.data ?? [],
    runs: runs.data ?? [],
    events: (events.data ?? []) as LedgerEvent[],
    disputes: disputes.data ?? [],
  };
}

type Loaded = Awaited<ReturnType<typeof load>>;

export function SubmissionView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    load(id).then(
      (loaded) => {
        setData(loaded);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [id]);

  // Reload whenever the ledger records something new about this submission.
  useEffect(() => {
    refresh();
    const supabase = browserClient();
    const channel = supabase
      .channel(`submission-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events", filter: `subject_id=eq.${id}` },
        refresh,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, refresh]);

  if (failed && !data) return <Empty>This report could not be loaded. Refresh to try again.</Empty>;
  if (!data) return <Loading lines={4} />;
  if (!data.submission) return <Empty>There is no submission with this address.</Empty>;

  const { submission: s, report, measurements, verification, pages, runs, events, decisions, summaries, disputes } = data;
  const status = STATUS[s.status] ?? { label: s.status, line: s.status };
  const inFlight = ["received", "processing", "approved"].includes(s.status);
  const line = (inFlight && IN_FLIGHT[events[0]?.event_type]) || status.line;
  const checks = Array.isArray(verification?.checks)
    ? (verification.checks as { code: string; status: string; detail: string }[])
    : [];

  return (
    <>
      <div className="mb-8">
        <p className="text-neutral-600">
          Lab report submitted by {RELATIONSHIP[s.relationship] ?? "an unknown party"} on {formatDate(s.created_at)}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {s.products ? (
            <Link href={`/products/${s.products.id}`} className="hover:underline">
              {s.products.name}
            </Link>
          ) : (
            (report?.sample_product_raw ?? "Product not yet identified")
          )}
        </h1>
        <div className="mt-4 flex items-center gap-3">
          <Badge tone={statusTone(s.status)}>{status.label}</Badge>
          <p key={line} className="status-line text-neutral-700" aria-live="polite">
            {line}
          </p>
        </div>
        {inFlight && (
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-neutral-950" />
          </div>
        )}
      </div>

      {decisions.length > 0 && (
        <Section title="Decisions">
          <div className="space-y-3">
            {decisions.map((d) => (
              <Panel key={d.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{OUTCOME[d.outcome] ?? d.outcome}</p>
                  <p className="text-sm text-neutral-600">
                    {STAGE[d.stage] ?? d.stage} · {formatDateTime(d.created_at)}
                  </p>
                </div>
                {summaries.get(d.id) && <p className="mt-2 text-neutral-700">{summaries.get(d.id)}</p>}
                <ul className="mt-3 flex flex-wrap gap-2">
                  {d.reason_codes.map((code) => (
                    <li key={code}>
                      <Badge>{reasonLabel(code)}</Badge>
                    </li>
                  ))}
                </ul>
                {d.agent_run_id && (
                  <Link href={`/records/runs/${d.agent_run_id}`} className="mt-3 inline-block text-sm underline">
                    See how the agent reached this
                  </Link>
                )}
              </Panel>
            ))}
          </div>
        </Section>
      )}

      {report && (
        <Section title="Report">
          <Panel>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {[
                ["Lab", s.labs?.name ?? report.lab_name_raw],
                ["Accreditation", ACCREDITATION[s.labs?.accreditation_status ?? "unknown"]],
                ["Report date", report.report_date && formatDate(report.report_date)],
                ["Report number", report.report_number],
                ["Sample", report.sample_description],
                ["Lot", report.lot_number],
                ["Tested on", report.tested_on && formatDate(report.tested_on)],
                ["Methods", report.methods?.join(", ")],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-sm text-neutral-600">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
            </dl>
          </Panel>
        </Section>
      )}

      {measurements.length > 0 && (
        <Section title="Results" aside={`${measurements.length} read from the document`}>
          <ul className="space-y-2">
            {measurements.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-x-4 rounded-2xl bg-neutral-100 px-4 py-3">
                <span>
                  <span className="font-medium">{m.analytes?.name ?? m.analyte_name_raw}</span>
                  <span className="ml-2 text-sm text-neutral-600">
                    {[m.method, m.page_number && `page ${m.page_number}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="font-semibold">{formatResult(m)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {checks.length > 0 && (
        <Section title="Verification checks" aside={verification?.risk ? `Risk: ${verification.risk}` : undefined}>
          <ul className="space-y-2">
            {checks.map((c, i) => (
              <li key={`${c.code}-${i}`} className="flex items-start gap-3 text-sm">
                <Badge tone={c.status === "pass" ? "good" : c.status === "warn" ? "warn" : "bad"}>
                  {c.status === "pass" ? "Passed" : c.status === "warn" ? "Warning" : "Failed"}
                </Badge>
                <span className="text-neutral-700">{c.detail}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {pages.length > 0 && (
        <Section title="Document text" aside="Personal details removed">
          <div className="space-y-3">
            {pages.map((page) => (
              <Panel key={page.page_number}>
                <p className="mb-2 text-sm text-neutral-600">Page {page.page_number}</p>
                <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed">{page.redacted_text}</pre>
              </Panel>
            ))}
          </div>
        </Section>
      )}

      {s.status === "published" && (
        <Section title="Something wrong?">
          <Panel>
            <p className="text-neutral-700">
              If a result here does not match the report, the report is for a different product, or the document
              is not genuine, open a dispute. An agent re-checks the record and the outcome is public.
            </p>
            <ButtonLink href={`/disputes/new?submission=${s.id}`} className="mt-4">
              Dispute this report
            </ButtonLink>
          </Panel>
        </Section>
      )}

      {disputes.length > 0 && (
        <Section title="Disputes">
          <ul className="space-y-2">
            {disputes.map((d) => (
              <li key={d.id} className="flex items-baseline justify-between gap-4 rounded-2xl bg-neutral-100 px-4 py-3">
                <span className="font-medium capitalize">{d.category.replaceAll("_", " ")}</span>
                <span className="text-sm text-neutral-600">
                  {d.status} · opened {formatDate(d.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {runs.length > 0 && (
        <Section title="Agent runs" aside="Every model call made for this report">
          <ul className="space-y-2">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/records/runs/${run.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 rounded-2xl bg-neutral-100 px-4 py-3 hover:bg-neutral-200/70"
                >
                  <span className="font-medium capitalize">{run.agent.replaceAll("_", " ")}</span>
                  <span className="text-sm text-neutral-600">
                    {[run.status === "succeeded" ? null : "Failed", run.model, formatDateTime(run.started_at)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Ledger history">
        <ul className="-mx-4">
          {events.map((event) => (
            <li key={event.seq}>
              <EventRow event={event} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-neutral-600">
          Original file fingerprint (SHA-256): <span className="break-all font-mono text-[13px]">{s.documents?.sha256}</span>
        </p>
      </Section>
    </>
  );
}
