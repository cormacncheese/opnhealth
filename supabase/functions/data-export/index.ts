// Nightly public dump. Writes every public table as gzipped NDJSON to the
// public "exports" bucket, then a manifest that records the ledger head so a
// copy can be checked against the hash chain.
//
// Each call exports one slice of one table and then calls itself for the
// next slice, which keeps every invocation small. Rows are read as the
// anonymous role, so the dump can never hold more than the public API does.

import { getDb, json, recordEvent } from "../_shared/db.ts";
import { isInternalCall, jsonResponse, runInBackground } from "../_shared/http.ts";
import { createSupabaseStore } from "../_shared/pipeline/context.ts";

const BUCKET = "exports";
const ROWS_PER_PART = 20_000;

interface TableSpec {
  name: string;
  /** Column list; "*" where the anonymous role may read every column. */
  columns: string;
  /** Unique expression to page by. */
  key: string;
}

const TABLES: TableSpec[] = [
  { name: "sources", columns: "*", key: "id::text" },
  { name: "analytes", columns: "*", key: "id::text" },
  { name: "reference_limits", columns: "*", key: "id::text" },
  { name: "labs", columns: "*", key: "id::text" },
  { name: "brands", columns: "*", key: "id::text" },
  { name: "entities", columns: "*", key: "id::text" },
  {
    name: "products",
    columns:
      "id, brand_id, brand_name, name, gtin, category, categories, image_url, ingredients_text, serving_size, first_source_id, created_at, updated_at",
    key: "id::text",
  },
  { name: "observations", columns: "*", key: "lpad(id::text, 20, '0')" },
  { name: "submissions", columns: "*", key: "id::text" },
  {
    name: "documents",
    columns: "id, sha256, mime_type, byte_size, page_count, origin_url, redaction_status, created_at",
    key: "id::text",
  },
  { name: "document_pages", columns: "*", key: "document_id::text || ':' || lpad(page_number::text, 6, '0')" },
  { name: "coa_reports", columns: "*", key: "id::text" },
  { name: "coa_resolutions", columns: "*", key: "id::text" },
  { name: "measurements", columns: "*", key: "id::text" },
  { name: "verification_reports", columns: "*", key: "id::text" },
  { name: "review_decisions", columns: "*", key: "id::text" },
  { name: "review_decision_details", columns: "*", key: "decision_id::text" },
  {
    name: "disputes",
    columns: "id, submission_id, category, status, resolution_code, created_at, resolved_at",
    key: "id::text",
  },
  { name: "recalls", columns: "*", key: "id::text" },
  { name: "recall_products", columns: "*", key: "recall_id::text || ':' || product_id::text" },
  { name: "agent_runs", columns: "*", key: "id::text" },
  { name: "agent_run_io", columns: "*", key: "run_id::text" },
  { name: "agent_steps", columns: "*", key: "lpad(id::text, 20, '0')" },
  { name: "eval_runs", columns: "*", key: "id::text" },
  { name: "events", columns: "*", key: "lpad(seq::text, 20, '0')" },
];

interface ExportFile {
  table: string;
  path: string;
  rows: number;
  bytes: number;
}

interface State {
  run: string;
  table: number;
  after: string;
  part: number;
  files: ExportFile[];
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function step(state: State): Promise<void> {
  const sql = getDb();
  const store = createSupabaseStore();

  if (state.table >= TABLES.length) {
    const [head] = await sql`select seq, hash from public.events order by seq desc limit 1`;
    const manifest = {
      generated_at: new Date().toISOString(),
      run: state.run,
      format: "NDJSON, gzip, one JSON object per row",
      licence: "ODbL-1.0",
      ledger_head: head ? { seq: Number(head.seq), hash: head.hash } : null,
      files: state.files,
    };
    const body = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    await store.upload(BUCKET, `${state.run}/manifest.json`, body, "application/json");
    await store.upload(BUCKET, "latest/manifest.json", body, "application/json");
    await sql.begin(async (tx) => {
      await tx`
        insert into public.data_exports (manifest_path, ledger_head_seq, ledger_head_hash, tables)
        values (${`${state.run}/manifest.json`}, ${head?.seq ?? null}, ${head?.hash ?? null}, ${json(tx, state.files)})`;
      await recordEvent(tx, {
        type: "export.published",
        subjectType: "export",
        subjectId: state.run,
        actor: "system:data-export",
        payload: { files: state.files.length, rows: state.files.reduce((n, f) => n + f.rows, 0) },
      });
    });
    return;
  }

  const spec = TABLES[state.table];
  // Table and column names come from the constant above, never from input.
  const rows = await sql.begin(async (tx) => {
    await tx`set local role anon`;
    return await tx.unsafe(
      `select ${spec.key} as k, to_jsonb(t) as row
         from (select ${spec.columns} from public.${spec.name}) t
        where ${spec.key} > $1
        order by ${spec.key}
        limit ${ROWS_PER_PART}`,
      [state.after],
    );
  });

  let next: State;
  if (rows.length === 0) {
    next = { ...state, table: state.table + 1, after: "", part: 1 };
  } else {
    const ndjson = rows.map((r) => JSON.stringify(r.row)).join("\n") + "\n";
    const bytes = await gzip(ndjson);
    const path = `${state.run}/${spec.name}/part-${String(state.part).padStart(5, "0")}.ndjson.gz`;
    await store.upload(BUCKET, path, bytes, "application/gzip");
    const files = [...state.files, { table: spec.name, path, rows: rows.length, bytes: bytes.length }];
    next = rows.length < ROWS_PER_PART
      ? { run: state.run, table: state.table + 1, after: "", part: 1, files }
      : { run: state.run, table: state.table, after: rows.at(-1)!.k as string, part: state.part + 1, files };
  }

  await sql`select private.invoke_function('data-export', ${json(sql, next)})`;
}

Deno.serve(async (req) => {
  if (!isInternalCall(req)) return jsonResponse({ error: "Not authorised" }, 401);
  const body = await req.json().catch(() => ({}));
  const state: State = typeof body.run === "string"
    ? body
    : { run: new Date().toISOString().slice(0, 10), table: 0, after: "", part: 1, files: [] };

  runInBackground(step(state));
  return jsonResponse({ accepted: true, run: state.run, table: TABLES[state.table]?.name ?? "manifest" }, 202);
});
