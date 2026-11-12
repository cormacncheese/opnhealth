import type { Metadata } from "next";
import { Suspense } from "react";
import { Badge, Empty, Loading, Mono, PageTitle, Panel, Section } from "@/components/ui";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { publicClient, SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/public";

export const metadata: Metadata = { title: "Data" };

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-2xl bg-neutral-950 p-4 font-mono text-[13px] leading-relaxed text-neutral-100">
      {children}
    </pre>
  );
}

const HASH_FORMULA = `sha256(
  prev_hash | seq | occurred_at | event_type | subject_type |
  subject_id | actor | agent_run_id | payload
)

occurred_at   UTC, formatted YYYY-MM-DDTHH:MI:SS.ffffffZ
agent_run_id  empty string when there is none
payload       the JSON text exactly as Postgres prints jsonb
first entry   prev_hash is 64 zeros`;

export default function DataPage() {
  const rest = `${SUPABASE_URL}/rest/v1`;
  const headers = `-H "apikey: ${SUPABASE_KEY || "<publishable key>"}"`;

  return (
    <>
      <PageTitle title="Data">
        Everything published here is open. Read it through the API, follow it live, or download all of it.
        The website uses this same API and has no private access of its own.
      </PageTitle>

      <Section title="API">
        <div className="space-y-4">
          <p className="text-neutral-700">
            A read-only REST API over every public table. Send the public key below with each request. No
            account is needed. Filtering, ordering and paging follow{" "}
            <a href="https://postgrest.org/en/stable/references/api/tables_views.html" className="underline" rel="noreferrer">
              PostgREST conventions
            </a>
            .
          </p>
          <Panel>
            <p className="text-sm text-neutral-600">Base address</p>
            <Mono>{rest}</Mono>
            <p className="mt-3 text-sm text-neutral-600">Public key</p>
            <Mono>{SUPABASE_KEY}</Mono>
          </Panel>
          <p className="font-medium">Search products</p>
          <Code>{`curl "${rest}/rpc/search_products?q=cocoa&max_results=10" ${headers}`}</Code>
          <p className="font-medium">Published lab results for a product</p>
          <Code>{`curl "${rest}/published_measurements?product_id=eq.<product id>" ${headers}`}</Code>
          <p className="font-medium">Ledger entries after a known point</p>
          <Code>{`curl "${rest}/events?seq=gt.1000&order=seq&limit=500" ${headers}`}</Code>
          <p className="text-neutral-700">
            Main tables: <Mono>products</Mono>, <Mono>brands</Mono>, <Mono>observations</Mono>,{" "}
            <Mono>submissions</Mono>, <Mono>coa_reports</Mono>, <Mono>measurements</Mono>,{" "}
            <Mono>published_measurements</Mono>, <Mono>reference_limits</Mono>, <Mono>review_decisions</Mono>,{" "}
            <Mono>agent_runs</Mono>, <Mono>agent_steps</Mono>, <Mono>recalls</Mono>, <Mono>disputes</Mono>,{" "}
            <Mono>events</Mono>. New ledger entries can also be followed live over Supabase Realtime by
            subscribing to inserts on <Mono>events</Mono>.
          </p>
        </div>
      </Section>

      <Section title="Full download">
        <Suspense fallback={<Loading lines={2} />}>
          <Export />
        </Suspense>
      </Section>

      <Section title="Checking the ledger yourself">
        <div className="space-y-4">
          <p className="text-neutral-700">
            Each ledger entry stores the hash of the entry before it and its own hash, computed as below.
            Recompute the chain from a download, or ask the database to do it. The call returns the first
            entry that does not match, or nothing when the range is intact.
          </p>
          <Code>{HASH_FORMULA}</Code>
          <Code>{`curl "${rest}/rpc/verify_ledger?from_seq=1&to_seq=5000" ${headers}`}</Code>
        </div>
      </Section>

      <Section title="Sources">
        <Suspense fallback={<Loading lines={3} />}>
          <Sources />
        </Suspense>
      </Section>

      <Section title="Agent accuracy">
        <Suspense fallback={<Loading lines={1} />}>
          <Evals />
        </Suspense>
      </Section>

      <Section title="Licence">
        <p className="text-neutral-700">
          The database is published under the Open Database License (ODbL 1.0): use it for anything,
          credit the source, and share changes to the data under the same terms. Records taken from public
          datasets keep the licence of their source, shown in the list above. The code is Apache-2.0.
        </p>
      </Section>
    </>
  );
}

async function Export() {
  const { data, error } = await publicClient()
    .from("data_exports")
    .select("manifest_path, ledger_head_seq, ledger_head_hash, tables, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load the export list: ${error.message}`);
  if (!data) return <Empty>The first full export has not run yet. Exports are produced nightly.</Empty>;

  const base = `${SUPABASE_URL}/storage/v1/object/public/exports`;
  const files = (Array.isArray(data.tables) ? data.tables : []) as { table: string; path: string; rows: number; bytes: number }[];
  return (
    <div className="space-y-4">
      <p className="text-neutral-700">
        A complete copy of the public data is written every night as gzipped NDJSON, one file set per
        table. The latest was made on {formatDateTime(data.created_at)} and covers the ledger up to entry #
        {data.ledger_head_seq}.
      </p>
      <p>
        <a href={`${base}/latest/manifest.json`} className="font-medium underline">
          Manifest of the latest export
        </a>
      </p>
      <ul className="space-y-2">
        {files.map((f) => (
          <li key={f.path}>
            <a
              href={`${base}/${f.path}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 rounded-2xl bg-neutral-100 px-4 py-3 hover:bg-neutral-200/70"
            >
              <span className="font-mono text-[13px]">{f.path.split("/").slice(1).join("/")}</span>
              <span className="text-sm text-neutral-600">
                {formatNumber(f.rows)} rows · {formatNumber(Math.max(1, Math.round(f.bytes / 1024)))} KB
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function Sources() {
  const supabase = publicClient();
  const [sources, syncs] = await Promise.all([
    supabase.from("sources").select("slug, name, url, license, kind").order("name"),
    supabase.from("sync_state").select("connector, items_total, last_run_at, last_status, last_error"),
  ]);
  if (sources.error || syncs.error) throw new Error("Could not load the source list.");

  return (
    <>
      {syncs.data.length > 0 && (
        <ul className="mb-6 space-y-2">
          {syncs.data.map((s) => (
            <li key={s.connector} className="flex flex-wrap items-center justify-between gap-x-4 rounded-2xl bg-neutral-100 px-4 py-3">
              <span>
                <span className="font-medium">{s.connector}</span>
                <span className="ml-2 text-sm text-neutral-600">
                  {formatNumber(s.items_total)} records · last synced {formatDateTime(s.last_run_at)}
                </span>
              </span>
              <Badge tone={s.last_status === "ok" ? "good" : "bad"}>
                {s.last_status === "ok" ? "Syncing" : "Last sync failed"}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-2 text-sm">
        {sources.data.map((s) => (
          <li key={s.slug} className="flex flex-wrap gap-x-2 text-neutral-700">
            {s.url ? (
              <a href={s.url} className="font-medium underline" rel="noreferrer">
                {s.name}
              </a>
            ) : (
              <span className="font-medium">{s.name}</span>
            )}
            <span className="text-neutral-500">{[s.kind.replaceAll("_", " "), s.license].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

async function Evals() {
  const { data, error } = await publicClient()
    .from("eval_runs")
    .select("id, model, metrics, passed, created_at, git_sha")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(`Could not load evaluation results: ${error.message}`);
  if (data.length === 0) {
    return (
      <Empty>
        No evaluation run has been recorded yet. Before a change to an agent ships, the agents are scored
        against a set of lab reports with known answers, and the scores are listed here.
      </Empty>
    );
  }
  return (
    <ul className="space-y-2">
      {data.map((run) => {
        const metrics = (run.metrics ?? {}) as Record<string, unknown>;
        const shown = Object.entries(metrics).filter(([, v]) => typeof v === "number") as [string, number][];
        return (
          <li key={run.id} className="rounded-2xl bg-neutral-100 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4">
              <span className="font-medium">
                {formatDate(run.created_at)} · {run.model}
              </span>
              <Badge tone={run.passed ? "good" : "bad"}>{run.passed ? "Passed" : "Below the bar"}</Badge>
            </div>
            <p className="mt-1 text-sm text-neutral-600">
              {shown.map(([name, value]) => `${name.replaceAll("_", " ")} ${formatNumber(value)}`).join(" · ")}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
