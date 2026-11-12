import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, Empty, Loading, Panel, Section } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/format";
import { publicClient } from "@/lib/supabase/public";

export const metadata: Metadata = { title: "Agent run" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function RunPage({ params }: PageProps<"/records/runs/[id]">) {
  return (
    <Suspense fallback={<Loading lines={4} />}>
      <Run params={params} />
    </Suspense>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

async function Run({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = publicClient();
  const [run, steps, io] = await Promise.all([
    supabase.from("agent_runs").select("*").eq("id", id).maybeSingle(),
    supabase.from("agent_steps").select("*").eq("run_id", id).order("idx"),
    supabase.from("agent_run_io").select("input, output, error").eq("run_id", id).maybeSingle(),
  ]);
  const failed = run.error ?? steps.error ?? io.error;
  if (failed) throw new Error(`Could not load this run: ${failed.message}`);
  if (!run.data) notFound();

  const r = run.data;
  const seconds =
    r.finished_at && r.started_at
      ? (new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000
      : null;

  return (
    <>
      <p className="text-neutral-600">Agent run</p>
      <h1 className="mt-1 text-3xl font-semibold capitalize tracking-tight">{r.agent.replaceAll("_", " ")}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-neutral-600">
        <Badge tone={r.status === "succeeded" ? "good" : "bad"}>{r.status === "succeeded" ? "Completed" : "Failed"}</Badge>
        <span>{formatDateTime(r.started_at)}</span>
        {r.submission_id && (
          <Link href={`/submissions/${r.submission_id}`} className="underline">
            View the submission
          </Link>
        )}
      </div>

      <Section title="Run">
        <Panel>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {[
              ["Model", r.model ?? "No model used"],
              ["Prompt version", r.prompt_version],
              ["Duration", seconds === null ? "Unknown" : `${formatNumber(seconds)} s`],
              ["Input tokens", formatNumber(r.input_tokens)],
              ["Output tokens", formatNumber(r.output_tokens)],
              ["Cost", `$${Number(r.cost_usd ?? 0).toFixed(4)}`],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-neutral-600">{label}</dt>
                <dd className="break-words font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </Section>

      <Section title="Steps">
        {(steps.data ?? []).length === 0 ? (
          <Empty>This run recorded no steps.</Empty>
        ) : (
          <ol className="space-y-2">
            {(steps.data ?? []).map((step) => (
              <li key={step.id} className="rounded-2xl bg-neutral-100 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-medium">
                    {step.kind === "model_call" ? "Model call" : "Check"}: {step.name.replaceAll("_", " ")}
                  </span>
                  {step.duration_ms != null && (
                    <span className="text-sm text-neutral-600">{formatNumber(step.duration_ms)} ms</span>
                  )}
                </div>
                {step.detail != null && (
                  <p className="mt-1 break-words font-mono text-[13px] text-neutral-600">{JSON.stringify(step.detail)}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Input and output">
        {io.data ? (
          <div className="space-y-3">
            {io.data.error && (
              <div className="rounded-[22px] bg-red-50 p-5">
                <p className="mb-2 text-sm text-red-900">Error</p>
                <pre className="whitespace-pre-wrap break-words font-mono text-[13px] text-red-950">{io.data.error}</pre>
              </div>
            )}
            <Panel>
              <p className="mb-2 text-sm text-neutral-600">Input</p>
              <Json value={io.data.input} />
            </Panel>
            <Panel>
              <p className="mb-2 text-sm text-neutral-600">Output</p>
              <Json value={io.data.output} />
            </Panel>
          </div>
        ) : (
          <Empty>
            The input and output of this run are private. They are shown once the submission is published,
            because an unpublished document may contain personal details or be about the wrong product.
          </Empty>
        )}
      </Section>
    </>
  );
}
