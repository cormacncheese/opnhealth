"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RequireUser } from "@/components/require-user";
import { Badge, Empty, Loading, Panel, QuietButton, Section } from "@/components/ui";
import { formatDateTime, formatNumber, STATUS } from "@/lib/format";
import { browserClient } from "@/lib/supabase/browser";

const REFRESH_MS = 5000;

const PIPELINE_AGENTS: Record<string, string[]> = {
  coa: ["intake", "extraction", "resolver", "verifier", "adjudicator", "redactor", "dispute"],
  discovery: ["discovery"],
  monitor: ["monitor"],
};

interface Overview {
  queues: { name: string; waiting: number; working: number; total: number; oldest_seconds: number | null }[];
  dead_letters: { msg_id: number; enqueued_at: string; message: Record<string, unknown> }[];
  submissions_by_status: Record<string, number>;
  spend_today: Record<string, number>;
  runs_last_hour: { succeeded: number; failed: number };
  scheduler: {
    jobname: string;
    schedule: string;
    active: boolean;
    last_status: string | null;
    last_run_at: string | null;
    last_message: string | null;
  }[];
  function_calls: { last_hour: number; failed: number; last_error: string | null };
}

async function load() {
  const supabase = browserClient();
  const [overview, runs, failures, controls, syncs] = await Promise.all([
    supabase.rpc("admin_overview"),
    supabase
      .from("agent_runs")
      .select("id, agent, status, model, prompt_version, cost_usd, input_tokens, output_tokens, started_at, finished_at, subject_type, subject_id, submission_id")
      .order("started_at", { ascending: false })
      .limit(40),
    supabase
      .from("agent_runs")
      .select("id, agent, started_at, submission_id, agent_run_io(error)")
      .eq("status", "failed")
      .order("started_at", { ascending: false })
      .limit(10),
    supabase.from("pipeline_controls").select("*").order("pipeline"),
    supabase.from("sync_state").select("*").order("connector"),
  ]);
  const error = overview.error ?? runs.error ?? failures.error ?? controls.error ?? syncs.error;
  if (error) throw error;
  return {
    overview: overview.data as unknown as Overview,
    runs: runs.data ?? [],
    failures: failures.data ?? [],
    controls: controls.data ?? [],
    syncs: syncs.data ?? [],
  };
}

type Loaded = Awaited<ReturnType<typeof load>>;

function seconds(from: string | null, to: string | null) {
  if (!from || !to) return null;
  return (new Date(to).getTime() - new Date(from).getTime()) / 1000;
}

const money = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

function Inner() {
  const [data, setData] = useState<Loaded | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "forbidden" | "error">("loading");

  const refresh = useCallback(() => {
    load().then(
      (loaded) => {
        setData(loaded);
        setState("ok");
      },
      (e: { code?: string; message?: string }) => setState(e?.code === "42501" ? "forbidden" : "error"),
    );
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (state === "forbidden") {
    return <Empty>This account is not a maintainer, so the admin view is not available.</Empty>;
  }
  if (!data) {
    return state === "error" ? <Empty>The admin data could not be loaded. Retrying.</Empty> : <Loading lines={4} />;
  }

  const { overview, runs, failures, controls, syncs } = data;
  const spendTotal = Object.values(overview.spend_today).reduce((n, v) => n + Number(v), 0);
  const waiting = overview.queues.filter((q) => q.name !== "dead_letter").reduce((n, q) => n + q.waiting, 0);
  const working = overview.queues.reduce((n, q) => n + q.working, 0);
  const deadLetters = overview.queues.find((q) => q.name === "dead_letter")?.total ?? 0;

  return (
    <>
      {state === "error" && (
        <p role="status" className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The last refresh failed. Showing data from the previous one.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Agents working", working],
          ["Jobs waiting", waiting],
          ["Runs in the last hour", `${overview.runs_last_hour.succeeded} of ${overview.runs_last_hour.succeeded + overview.runs_last_hour.failed} succeeded`],
          ["Model spend today", money(spendTotal)],
          ["Dead letters", deadLetters],
        ].map(([label, value]) => (
          <Panel key={label as string} className="p-4">
            <dd className="text-xl font-semibold tracking-tight">{value}</dd>
            <dt className="text-sm text-neutral-600">{label}</dt>
          </Panel>
        ))}
      </dl>

      <Section title="Pipelines">
        <div className="grid gap-3 sm:grid-cols-3">
          {controls.map((c) => {
            const spend = (PIPELINE_AGENTS[c.pipeline] ?? []).reduce((n, a) => n + Number(overview.spend_today[a] ?? 0), 0);
            const budget = Number(c.daily_budget_usd);
            return (
              <Panel key={c.pipeline}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold uppercase tracking-wide">{c.pipeline}</p>
                  <Badge tone={c.paused ? "bad" : "good"}>{c.paused ? "Paused" : "Running"}</Badge>
                </div>
                {c.paused && c.paused_reason && (
                  <p className="mt-1 text-sm text-neutral-600">{c.paused_reason.replaceAll("_", " ")}</p>
                )}
                <p className="mt-3 text-sm text-neutral-700">
                  {money(spend)} of {money(budget)} daily budget
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                  <div className="h-full rounded-full bg-neutral-950" style={{ width: `${Math.min(100, (spend / budget) * 100)}%` }} />
                </div>
                <PipelineToggle pipeline={c.pipeline} paused={c.paused} onDone={refresh} />
              </Panel>
            );
          })}
        </div>
      </Section>

      <Section title="Queues" aside="One per agent stage">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {overview.queues.map((q) => (
            <div key={q.name} className="rounded-2xl bg-neutral-100 px-4 py-3">
              <p className="text-sm font-medium">{q.name.replaceAll("_", " ")}</p>
              <p className="mt-0.5 text-sm text-neutral-600">
                {q.working > 0 ? `${q.working} working · ` : ""}
                {q.waiting} waiting
                {q.oldest_seconds != null && q.waiting > 0 ? ` · oldest ${formatNumber(q.oldest_seconds)}s` : ""}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-neutral-600">
          Submissions:{" "}
          {Object.entries(overview.submissions_by_status)
            .map(([s, n]) => `${STATUS[s]?.label ?? s} ${n}`)
            .join(" · ") || "none yet"}
        </p>
      </Section>

      <Section title="Agent runs" aside="Latest 40">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-neutral-500">
              <tr>
                {["Agent", "Status", "Subject", "Model", "Tokens", "Cost", "Time", "Started"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const secs = seconds(r.started_at, r.finished_at);
                return (
                  <tr key={r.id} className="odd:bg-neutral-50">
                    <td className="px-3 py-2">
                      <Link href={`/records/runs/${r.id}`} className="font-medium capitalize underline">
                        {r.agent.replaceAll("_", " ")}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={r.status === "succeeded" ? "good" : "bad"}>{r.status}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {r.submission_id ? (
                        <Link href={`/submissions/${r.submission_id}`} className="underline">submission</Link>
                      ) : (
                        <span className="text-neutral-600">{r.subject_type}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{r.model ?? "no model"}</td>
                    <td className="px-3 py-2 text-neutral-600">
                      {r.input_tokens ? `${formatNumber(r.input_tokens)} / ${formatNumber(r.output_tokens)}` : ""}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{Number(r.cost_usd) > 0 ? money(Number(r.cost_usd)) : ""}</td>
                    <td className="px-3 py-2 text-neutral-600">{secs != null ? `${formatNumber(secs)}s` : ""}</td>
                    <td className="px-3 py-2 text-neutral-600">{formatDateTime(r.started_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {runs.length === 0 && <Empty>No agent has run yet.</Empty>}
        </div>
      </Section>

      <Section title="Recent failures">
        {failures.length === 0 ? (
          <Empty>No failed runs.</Empty>
        ) : (
          <ul className="space-y-2">
            {failures.map((f) => {
              const io = Array.isArray(f.agent_run_io) ? f.agent_run_io[0] : f.agent_run_io;
              return (
                <li key={f.id} className="rounded-2xl bg-red-50 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <Link href={`/records/runs/${f.id}`} className="font-medium capitalize text-red-950 underline">
                      {f.agent.replaceAll("_", " ")}
                    </Link>
                    <span className="text-red-900">{formatDateTime(f.started_at)}</span>
                  </div>
                  {io?.error && <p className="mt-1 line-clamp-3 font-mono text-[13px] text-red-950">{io.error}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Dead letters" aside="Jobs that failed every retry; the Supervisor escalates these">
        {overview.dead_letters.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className="space-y-2">
            {overview.dead_letters.map((d) => (
              <li key={d.msg_id} className="rounded-2xl bg-neutral-100 px-4 py-3">
                <p className="text-sm text-neutral-600">{formatDateTime(d.enqueued_at)}</p>
                <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[13px]">{JSON.stringify(d.message)}</pre>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Data sources">
        <ul className="space-y-2">
          {syncs.map((s) => (
            <li key={s.connector} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-neutral-100 px-4 py-3 text-sm">
              <span>
                <span className="font-medium">{s.connector}</span>
                <span className="ml-2 text-neutral-600">
                  {formatNumber(s.items_total)} records · last run {formatDateTime(s.last_run_at)}
                </span>
                {s.last_error && <span className="mt-1 block text-red-800">{s.last_error}</span>}
              </span>
              <Badge tone={s.last_status === "ok" ? "good" : "bad"}>{s.last_status ?? "never run"}</Badge>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Scheduler"
        aside={`${overview.function_calls.last_hour} function calls in the last hour, ${overview.function_calls.failed} failed`}
      >
        {overview.function_calls.last_error && (
          <p className="mb-3 rounded-2xl bg-red-50 px-4 py-3 font-mono text-[13px] text-red-950">
            Last failed call: {overview.function_calls.last_error}
          </p>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {overview.scheduler.map((j) => (
            <li key={j.jobname} className="rounded-2xl bg-neutral-100 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{j.jobname}</span>
                <Badge tone={!j.active ? "neutral" : j.last_status === "failed" ? "bad" : j.last_status ? "good" : "neutral"}>
                  {!j.active ? "off" : (j.last_status ?? "not run yet")}
                </Badge>
              </div>
              <p className="mt-0.5 text-neutral-600">
                {j.schedule}
                {j.last_run_at && ` · last ${formatDateTime(j.last_run_at)}`}
              </p>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function PipelineToggle({ pipeline, paused, onDone }: { pipeline: string; paused: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    setBusy(true);
    setFailed(false);
    const { error } = await browserClient().rpc("admin_set_pipeline", {
      p_pipeline: pipeline,
      p_paused: !paused,
      p_reason: paused ? undefined : "paused_by_maintainer",
    });
    setBusy(false);
    if (error) setFailed(true);
    else onDone();
  }

  return (
    <div className="mt-4">
      <QuietButton type="button" onClick={toggle} disabled={busy} className="h-10 bg-white px-4 text-sm">
        {paused ? "Resume" : "Pause"}
      </QuietButton>
      {failed && <p className="mt-2 text-sm text-red-800">That did not go through. Try again.</p>}
    </div>
  );
}

export function Dashboard() {
  return <RequireUser reason="Sign in with a maintainer account to see the admin view.">{() => <Inner />}</RequireUser>;
}
