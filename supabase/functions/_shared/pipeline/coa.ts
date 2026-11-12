// The COA pipeline: intake, extraction, resolution, verification,
// adjudication, redaction. Each handler reads what it needs, runs its
// agent, and returns a commit that writes results and queues the next stage.

import { adjudicate, ADJUDICATOR_PROMPT_VERSION } from "../agents/adjudicator.ts";
import { extractReport, EXTRACTION_PROMPT_VERSION } from "../agents/extraction.ts";
import { classifyDocument, INTAKE_PROMPT_VERSION } from "../agents/intake.ts";
import { redactDocument, REDACTOR_PROMPT_VERSION } from "../agents/redactor.ts";
import { type ProductCandidate, resolveProduct, RESOLVER_PROMPT_VERSION } from "../agents/resolver.ts";
import type { Check } from "../agents/types.ts";
import { VERIFIER_PROMPT_VERSION, type VerifierMeasurement, verifyReport } from "../agents/verifier.ts";
import { hasAdverseResult, type LimitLike, type MeasurementLike } from "../core/limits.ts";
import { normaliseGtin, normaliseName, parseIsoDate, scrubDeep, scrubText } from "../core/text.ts";
import { normaliseMeasurement } from "../core/units.ts";
import { enqueue, json, recordEvent, setSubmissionStatus, type Sql } from "../db.ts";
import { config } from "../env.ts";
import type { LlmFile } from "../llm.ts";
import { inspectPdf, type PdfInfo, sniffFileKind } from "../pdf.ts";
import { type Ctx, type Handler, insertDecision, nothingToCommit, saveRun } from "./context.ts";

interface SubmissionRow {
  id: string;
  status: string;
  relationship: "consumer" | "brand" | "lab" | "crawler";
  source_id: string;
  product_id: string | null;
  lab_id: string | null;
  claimed_product_id: string | null;
  claimed_product_text: string | null;
  pii_terms: string[];
  document_id: string;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  sha256: string;
}

async function loadSubmission(sql: Sql, id: unknown): Promise<SubmissionRow | null> {
  if (typeof id !== "string") throw new Error("Job payload has no submission_id");
  const [row] = await sql<SubmissionRow[]>`
    select
      s.id, s.status, s.relationship, s.source_id, s.product_id, s.lab_id, s.claimed_product_id,
      p.claimed_product_text, coalesce(p.pii_terms, '{}') as pii_terms,
      d.id as document_id, d.storage_bucket, d.storage_path, d.mime_type, d.sha256
    from public.submissions s
    join public.documents d on d.id = s.document_id
    left join public.submission_private p on p.submission_id = s.id
    where s.id = ${id}`;
  return row ?? null;
}

async function loadFile(ctx: Ctx, sub: SubmissionRow): Promise<{ bytes: Uint8Array; file: LlmFile }> {
  const bytes = await ctx.store.download(sub.storage_bucket, sub.storage_path);
  const ext = sub.mime_type === "application/pdf" ? "pdf" : sub.mime_type === "image/png" ? "png" : "jpg";
  return { bytes, file: { data: bytes, mediaType: sub.mime_type, filename: `report.${ext}` } };
}

async function latestReport(sql: Sql, submissionId: string) {
  const [report] = await sql`
    select * from public.coa_reports
    where submission_id = ${submissionId}
    order by created_at desc
    limit 1`;
  return report ?? null;
}

function isoDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === "string" ? value.slice(0, 10) : null;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

const intake: Handler = async (ctx, payload) => {
  const sub = await loadSubmission(ctx.sql, payload.submission_id);
  if (!sub || sub.status !== "received") return nothingToCommit;
  const startedAt = ctx.now();
  const { bytes, file } = await loadFile(ctx, sub);

  let problem: string | null = null;
  let pdf: PdfInfo | null = null;
  const kind = sniffFileKind(bytes);
  if (kind === null) problem = "The file is not a PDF, PNG or JPEG.";
  else if (kind !== sub.mime_type) problem = "The file's contents do not match its declared type.";
  else if (bytes.length > config.maxFileBytes) problem = "The file is larger than 10 MB.";
  else if (kind === "application/pdf") {
    try {
      pdf = await inspectPdf(bytes);
      if (pdf.encrypted) problem = "The PDF is password-protected.";
      else if (pdf.pageCount > config.maxPages) problem = `The PDF has more than ${config.maxPages} pages.`;
      else if (pdf.pageCount === 0) problem = "The PDF has no pages.";
    } catch {
      problem = "The PDF could not be opened.";
    }
  }

  const base = {
    agent: "intake",
    promptVersion: INTAKE_PROMPT_VERSION,
    subjectType: "submission",
    subjectId: sub.id,
    submissionId: sub.id,
    status: "succeeded" as const,
    input: { document_id: sub.document_id, sha256: sub.sha256, mime_type: sub.mime_type, bytes: bytes.length },
    startedAt,
  };

  if (problem) {
    return async (tx) => {
      const runId = await saveRun(tx, {
        ...base,
        output: { valid: false, problem },
        usage: [],
        steps: [{ kind: "check", name: "file_validation", detail: { problem } }],
      });
      await insertDecision(tx, {
        submissionId: sub.id, stage: "intake", outcome: "reject",
        reasonCodes: ["invalid_file"], summary: problem!, runId,
      });
    };
  }

  const result = await classifyDocument(ctx.llm, file);
  const accepted = result.output.reports_product_test_results;

  return async (tx) => {
    const runId = await saveRun(tx, {
      ...base,
      output: result.output,
      usage: result.usage,
      steps: [{ kind: "check", name: "file_validation", detail: { kind, pages: pdf?.pageCount ?? null } }],
    });
    if (pdf) {
      await tx`update public.documents set page_count = ${pdf.pageCount} where id = ${sub.document_id}`;
    }
    if (!accepted) {
      await insertDecision(tx, {
        submissionId: sub.id, stage: "intake", outcome: "reject",
        confidence: result.output.confidence, reasonCodes: ["not_a_test_report"],
        summary: result.output.rationale, runId,
      });
      return;
    }
    await setSubmissionStatus(tx, sub.id, "processing", "agent:intake", {
      document_type: result.output.document_type,
    }, runId);
    await enqueue(tx, "extraction", { submission_id: sub.id });
  };
};

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

async function analyteIndex(sql: Sql): Promise<Map<string, string>> {
  const rows = await sql`select id, slug, name, synonyms from public.analytes`;
  const index = new Map<string, string>();
  for (const a of rows) {
    for (const label of [a.slug, a.name, ...(a.synonyms as string[])]) {
      index.set(normaliseName(label), a.id);
    }
  }
  return index;
}

function matchAnalyte(index: Map<string, string>, raw: string): string | null {
  return (
    index.get(normaliseName(raw)) ??
    // "Lead (Pb)" and "Lead, total" should still find "Lead".
    index.get(normaliseName(raw.replace(/\(.*?\)/g, "").split(",")[0])) ??
    null
  );
}

const extraction: Handler = async (ctx, payload) => {
  const sub = await loadSubmission(ctx.sql, payload.submission_id);
  if (!sub || sub.status !== "processing") return nothingToCommit;
  const startedAt = ctx.now();
  const { file } = await loadFile(ctx, sub);

  const result = await extractReport(ctx.llm, file);
  const pii = [...new Set(result.output.personal_data_terms.map((t) => t.trim()).filter(Boolean))];
  const { personal_data_terms: _dropped, ...withoutPii } = result.output;
  const out = scrubDeep(withoutPii, pii);

  const analytes = await analyteIndex(ctx.sql);
  const previous = await latestReport(ctx.sql, sub.id);

  const rows = out.results.map((r) => {
    const value = r.operator === "nd" && r.value === null ? null : r.value;
    const normalised = normaliseMeasurement(value, r.unit);
    return {
      analyte_id: matchAnalyte(analytes, r.analyte),
      analyte_name_raw: r.analyte,
      operator: r.operator,
      value,
      unit: r.unit,
      lod: r.lod,
      loq: r.loq,
      normalised_value: normalised?.value ?? null,
      normalised_unit: normalised?.unit ?? null,
      method: r.method,
      page_number: r.page !== null && Number.isInteger(r.page) ? r.page : null,
      citation: r.citation,
    };
  });

  return async (tx) => {
    const runId = await saveRun(tx, {
      agent: "extraction",
      promptVersion: EXTRACTION_PROMPT_VERSION,
      subjectType: "submission",
      subjectId: sub.id,
      submissionId: sub.id,
      status: "succeeded",
      input: { document_id: sub.document_id },
      output: out,
      usage: result.usage,
      steps: [{
        kind: "check",
        name: "normalise_results",
        detail: {
          rows: rows.length,
          analytes_matched: rows.filter((r) => r.analyte_id).length,
          units_normalised: rows.filter((r) => r.normalised_unit).length,
          personal_data_terms_removed: pii.length,
        },
      }],
      startedAt,
    });

    await tx`
      insert into public.submission_private (submission_id, pii_terms)
      values (${sub.id}, ${pii}::text[])
      on conflict (submission_id) do update
        set pii_terms = excluded.pii_terms, updated_at = now()`;

    const accreditation = out.lab.accreditation_body || out.lab.accreditation_number
      ? { body: out.lab.accreditation_body, number: out.lab.accreditation_number }
      : null;

    const [report] = await tx`
      insert into public.coa_reports (
        submission_id, document_id, document_type, lab_name_raw, accreditation_stated,
        report_number, lot_number, sample_description, sample_brand_raw, sample_product_raw,
        sample_matrix, sample_received_on, tested_on, report_date, methods,
        extraction_confidence, agent_run_id, supersedes_id
      ) values (
        ${sub.id}, ${sub.document_id}, 'test_report', ${out.lab.name},
        ${accreditation ? json(tx, accreditation) : null},
        ${out.report_number}, ${out.sample.lot_number}, ${out.sample.description},
        ${out.sample.brand}, ${out.sample.product_name}, ${out.sample.matrix},
        ${parseIsoDate(out.sample_received_date)}, ${parseIsoDate(out.tested_date)},
        ${parseIsoDate(out.report_date)}, ${out.methods}::text[],
        ${Math.min(1, Math.max(0, out.confidence))}, ${runId}, ${previous?.id ?? null}
      )
      returning id`;

    if (rows.length === 0) {
      await insertDecision(tx, {
        submissionId: sub.id, coaReportId: report.id, stage: "extraction", outcome: "reject",
        reasonCodes: ["no_measurements"],
        summary: "No test results could be read from the document.", runId,
      });
      return;
    }

    await tx`
      insert into public.measurements ${tx(
        rows.map((r) => ({ ...r, coa_report_id: report.id, submission_id: sub.id })),
      )}`;

    await recordEvent(tx, {
      type: "submission.extracted",
      subjectType: "submission",
      subjectId: sub.id,
      actor: "agent:extraction",
      payload: { coa_report_id: report.id, measurements: rows.length },
      runId,
    });
    await enqueue(tx, "resolution", { submission_id: sub.id, gtin: normaliseGtin(out.sample.gtin) });
  };
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

async function findCandidates(
  sql: Sql,
  queries: (string | null)[],
  gtin: string | null,
  claimedId: string | null,
): Promise<ProductCandidate[]> {
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
  if (gtin) add(await sql`select id, name, brand_name, gtin, category from public.products where gtin = ${gtin}`);
  if (claimedId) add(await sql`select id, name, brand_name, gtin, category from public.products where id = ${claimedId}`);
  for (const q of queries) {
    if (found.size >= 12) break;
    const text = q?.trim();
    if (!text || text.length < 3) continue;
    add(await sql`select id, name, brand_name, gtin, category from public.search_products(${text.slice(0, 200)}, 6)`);
  }
  return [...found.values()].slice(0, 12);
}

const resolution: Handler = async (ctx, payload) => {
  const sub = await loadSubmission(ctx.sql, payload.submission_id);
  if (!sub || sub.status !== "processing") return nothingToCommit;
  const report = await latestReport(ctx.sql, sub.id);
  if (!report) throw new Error("No extracted report to resolve");
  const startedAt = ctx.now();
  const gtin = typeof payload.gtin === "string" ? payload.gtin : null;

  const sample = {
    description: report.sample_description as string | null,
    brand: report.sample_brand_raw as string | null,
    product_name: report.sample_product_raw as string | null,
    lot_number: report.lot_number as string | null,
    gtin,
    matrix: report.sample_matrix as string | null,
  };
  const candidates = await findCandidates(
    ctx.sql,
    [
      [sample.brand, sample.product_name].filter(Boolean).join(" "),
      sample.description,
      sub.claimed_product_text,
    ],
    gtin,
    sub.claimed_product_id,
  );

  const result = await resolveProduct(ctx.llm, {
    sample,
    claimedProductText: sub.claimed_product_text,
    claimedProductId: sub.claimed_product_id,
    candidates,
  });
  const out = scrubDeep(result.output, sub.pii_terms);

  return async (tx) => {
    const runId = await saveRun(tx, {
      agent: "resolver",
      promptVersion: RESOLVER_PROMPT_VERSION,
      subjectType: "submission",
      subjectId: sub.id,
      submissionId: sub.id,
      status: "succeeded",
      input: { coa_report_id: report.id, sample, candidates: candidates.map((c) => c.id) },
      output: out,
      usage: result.usage,
      steps: result.steps,
      startedAt,
    });

    const [lab] = await tx`
      select private.ensure_lab(
        ${report.lab_name_raw},
        ${report.accreditation_stated ? json(tx, report.accreditation_stated) : null}
      ) as id`;
    const productId = out.match === "existing" ? out.product_id : null;

    await tx`
      insert into public.coa_resolutions (
        coa_report_id, submission_id, match_kind, product_id, proposed_product, lab_id,
        confidence, rationale, agent_run_id
      ) values (
        ${report.id}, ${sub.id}, ${out.match}, ${productId},
        ${out.match === "new" && out.new_product ? json(tx, { ...out.new_product, gtin }) : null},
        ${lab.id}, ${Math.min(1, Math.max(0, out.confidence))}, ${out.rationale}, ${runId}
      )`;
    await tx`
      update public.submissions
      set product_id = ${productId}, lab_id = ${lab.id}, updated_at = now()
      where id = ${sub.id}`;
    await recordEvent(tx, {
      type: "submission.resolved",
      subjectType: "submission",
      subjectId: sub.id,
      actor: "agent:resolver",
      payload: { match: out.match, product_id: productId, lab_id: lab.id },
      runId,
    });
    await enqueue(tx, "verification", { submission_id: sub.id });
  };
};

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function loadMeasurements(sql: Sql, reportId: string): Promise<VerifierMeasurement[]> {
  const rows = await sql`
    select analyte_id, analyte_name_raw, operator, value, unit, lod, loq,
           normalised_value, normalised_unit, page_number, citation
    from public.measurements
    where coa_report_id = ${reportId}
    order by created_at, id`;
  return rows.map((r) => ({
    analyte_id: r.analyte_id,
    analyte_name_raw: r.analyte_name_raw,
    operator: r.operator,
    value: num(r.value),
    unit: r.unit,
    lod: num(r.lod),
    loq: num(r.loq),
    normalised_value: num(r.normalised_value),
    normalised_unit: r.normalised_unit,
    page_number: r.page_number,
    citation: r.citation,
  }));
}

/** A published record may be verified again only as part of a dispute or scheduled re-check. */
function canReverify(sub: SubmissionRow, payload: Record<string, unknown>): boolean {
  const recheck = typeof payload.dispute_id === "string" || payload.reverify === true;
  return sub.status === "processing" || (recheck && sub.status === "published");
}

const verification: Handler = async (ctx, payload) => {
  const sub = await loadSubmission(ctx.sql, payload.submission_id);
  if (!sub || !canReverify(sub, payload)) return nothingToCommit;
  const report = await latestReport(ctx.sql, sub.id);
  if (!report) throw new Error("No extracted report to verify");
  const startedAt = ctx.now();
  const { sql } = ctx;
  const disputeId = typeof payload.dispute_id === "string" ? payload.dispute_id : null;

  const { bytes, file } = await loadFile(ctx, sub);
  const measurements = await loadMeasurements(sql, report.id);
  const [product] = sub.product_id
    ? await sql`select name, brand_name from public.products where id = ${sub.product_id}`
    : [];
  const [lab] = sub.lab_id
    ? await sql`select accreditation_status from public.labs where id = ${sub.lab_id}`
    : [];
  const priors = sub.product_id
    ? await sql`
        select analyte_id, normalised_value, normalised_unit
        from public.published_measurements
        where product_id = ${sub.product_id}
          and submission_id <> ${sub.id}
          and analyte_id is not null
          and normalised_value is not null
          and operator = 'eq'`
    : [];
  const [dupes] = report.report_number && report.lab_name_raw
    ? await sql`
        select count(distinct document_id)::int as n
        from public.coa_reports
        where report_number = ${report.report_number}
          and lower(lab_name_raw) = lower(${report.lab_name_raw})
          and document_id <> ${sub.document_id}`
    : [{ n: 0 }];
  let pdf: PdfInfo | null = null;
  if (sub.mime_type === "application/pdf") {
    pdf = await inspectPdf(bytes).catch(() => null);
  }

  const result = await verifyReport(ctx.llm, file, {
    today: ctx.now().toISOString().slice(0, 10),
    relationship: sub.relationship,
    report: {
      lab_name_raw: report.lab_name_raw,
      report_number: report.report_number,
      report_date: isoDate(report.report_date),
      sample_received_on: isoDate(report.sample_received_on),
      tested_on: isoDate(report.tested_on),
      sample_description: report.sample_description,
      sample_brand_raw: report.sample_brand_raw,
      sample_product_raw: report.sample_product_raw,
    },
    product: product ? { name: product.name, brand_name: product.brand_name } : null,
    lab: lab ? { accreditation_status: lab.accreditation_status } : null,
    measurements,
    priorResults: priors.map((p) => ({
      analyte_id: p.analyte_id,
      normalised_value: Number(p.normalised_value),
      normalised_unit: p.normalised_unit,
    })),
    duplicateReportNumbers: dupes.n,
    pdf,
  });
  const out = scrubDeep(result.output, sub.pii_terms);

  return async (tx) => {
    const runId = await saveRun(tx, {
      agent: "verifier",
      promptVersion: VERIFIER_PROMPT_VERSION,
      subjectType: "submission",
      subjectId: sub.id,
      submissionId: sub.id,
      status: "succeeded",
      input: { coa_report_id: report.id, dispute_id: disputeId, measurements: measurements.length },
      output: out,
      usage: result.usage,
      steps: scrubDeep(result.steps, sub.pii_terms),
      startedAt,
    });
    await tx`
      insert into public.verification_reports (
        submission_id, coa_report_id, dispute_id, risk, checks, summary, agent_run_id
      ) values (
        ${sub.id}, ${report.id}, ${disputeId}, ${out.risk}, ${json(tx, out.checks)}, ${out.summary}, ${runId}
      )`;
    await recordEvent(tx, {
      type: "submission.verified",
      subjectType: "submission",
      subjectId: sub.id,
      actor: "agent:verifier",
      payload: {
        risk: out.risk,
        failed: out.checks.filter((c) => c.status === "fail").map((c) => c.code),
        warned: out.checks.filter((c) => c.status === "warn").map((c) => c.code),
        dispute_id: disputeId,
      },
      runId,
    });
    await enqueue(tx, "adjudication", {
      submission_id: sub.id,
      ...(disputeId ? { dispute_id: disputeId } : {}),
      ...(payload.reverify === true ? { reverify: true } : {}),
    });
  };
};

// ---------------------------------------------------------------------------
// Adjudication
// ---------------------------------------------------------------------------

const adjudication: Handler = async (ctx, payload) => {
  const sub = await loadSubmission(ctx.sql, payload.submission_id);
  if (!sub || !canReverify(sub, payload)) return nothingToCommit;
  const { sql } = ctx;
  const report = await latestReport(sql, sub.id);
  if (!report) throw new Error("No extracted report to adjudicate");
  const [verification] = await sql`
    select risk, checks, summary from public.verification_reports
    where coa_report_id = ${report.id}
    order by created_at desc limit 1`;
  if (!verification) throw new Error("No verification report to adjudicate on");
  const startedAt = ctx.now();
  const disputeId = typeof payload.dispute_id === "string" ? payload.dispute_id : null;

  const { file } = await loadFile(ctx, sub);
  const measurements = await loadMeasurements(sql, report.id);
  const [resolution] = await sql`
    select match_kind, proposed_product from public.coa_resolutions
    where coa_report_id = ${report.id}
    order by created_at desc limit 1`;
  const [product] = sub.product_id
    ? await sql`select name, brand_name, categories from public.products where id = ${sub.product_id}`
    : [];
  const [lab] = sub.lab_id
    ? await sql`select accreditation_status from public.labs where id = ${sub.lab_id}`
    : [];
  const proposed = resolution?.match_kind === "new" ? resolution.proposed_product : null;

  const analyteIds = [...new Set(measurements.map((m) => m.analyte_id).filter((id): id is string => id !== null))];
  const limits = analyteIds.length
    ? await sql`
        select analyte_id, basis, normalised_value, normalised_unit, category_keywords
        from public.reference_limits
        where analyte_id in ${sql(analyteIds)}`
    : [];
  const categories = [
    ...((product?.categories as string[] | undefined) ?? []),
    report.sample_matrix as string | null,
    (proposed?.category as string | undefined) ?? null,
  ].filter((c): c is string => Boolean(c));
  const adverse = hasAdverseResult(
    measurements as MeasurementLike[],
    limits.map((l) => ({
      analyte_id: l.analyte_id,
      basis: l.basis,
      normalised_value: num(l.normalised_value),
      normalised_unit: l.normalised_unit,
      category_keywords: l.category_keywords,
    })) as LimitLike[],
    categories,
  );

  const [dispute] = disputeId
    ? await sql`
        select d.category, coalesce(dd.resolution, '') as resolution
        from public.disputes d
        join public.dispute_details dd on dd.dispute_id = d.id
        where d.id = ${disputeId}`
    : [];

  const result = await adjudicate(ctx.llm, file, {
    relationship: sub.relationship,
    product: product ? { name: product.name, brand_name: product.brand_name } : null,
    proposedProduct: proposed
      ? { brand_name: proposed.brand_name, product_name: proposed.product_name }
      : null,
    report: {
      lab: report.lab_name_raw,
      accreditation_stated: report.accreditation_stated,
      report_number: report.report_number,
      report_date: isoDate(report.report_date),
      lot_number: report.lot_number,
      sample: report.sample_description,
      extraction_confidence: num(report.extraction_confidence),
    },
    measurements: measurements.map((m) => ({
      analyte: m.analyte_name_raw, operator: m.operator, value: m.value, unit: m.unit,
    })),
    checks: verification.checks as Check[],
    risk: verification.risk,
    verifierSummary: verification.summary ?? "",
    adverse,
    labVerified: lab?.accreditation_status === "verified",
    dispute: dispute ? { category: dispute.category, triageRationale: dispute.resolution } : null,
  });
  const out = scrubDeep(result.output, sub.pii_terms);

  return async (tx) => {
    const runId = await saveRun(tx, {
      agent: "adjudicator",
      promptVersion: ADJUDICATOR_PROMPT_VERSION,
      subjectType: "submission",
      subjectId: sub.id,
      submissionId: sub.id,
      status: "succeeded",
      input: { coa_report_id: report.id, dispute_id: disputeId, risk: verification.risk, adverse },
      output: out,
      usage: result.usage,
      steps: result.steps,
      startedAt,
    });
    await insertDecision(tx, {
      submissionId: sub.id,
      coaReportId: report.id,
      disputeId,
      stage: "adjudicator",
      outcome: out.outcome,
      confidence: out.confidence,
      reasonCodes: out.reason_codes,
      summary: out.summary,
      reasons: verification.checks as unknown[],
      runId,
    });
  };
};

// ---------------------------------------------------------------------------
// Redaction and publication
// ---------------------------------------------------------------------------

const redaction: Handler = async (ctx, payload) => {
  const sub = await loadSubmission(ctx.sql, payload.submission_id);
  if (!sub || sub.status !== "approved") return nothingToCommit;
  const { sql } = ctx;
  const report = await latestReport(sql, sub.id);
  if (!report) throw new Error("No extracted report to publish");
  const startedAt = ctx.now();

  const [resolution] = await sql`
    select match_kind, proposed_product from public.coa_resolutions
    where coa_report_id = ${report.id}
    order by created_at desc limit 1`;
  const proposed = !sub.product_id && resolution?.match_kind === "new" ? resolution.proposed_product : null;

  if (!sub.product_id && !proposed) {
    // A maintainer approved something that was never tied to a product.
    return async (tx) => {
      await insertDecision(tx, {
        submissionId: sub.id, coaReportId: report.id, stage: "supervisor", outcome: "reject",
        reasonCodes: ["product_unresolved"],
        summary: "The report could not be tied to a product, so it cannot be published.",
        runId: null,
      });
    };
  }

  const { file } = await loadFile(ctx, sub);
  const result = await redactDocument(ctx.llm, file, sub.pii_terms);
  const { pages, personal_data_terms: terms } = result.output;
  if (pages.length === 0) throw new Error("Redaction produced no pages");

  return async (tx) => {
    const runId = await saveRun(tx, {
      agent: "redactor",
      promptVersion: REDACTOR_PROMPT_VERSION,
      subjectType: "submission",
      subjectId: sub.id,
      submissionId: sub.id,
      status: "succeeded",
      input: { document_id: sub.document_id },
      // The transcript itself is stored in document_pages.
      output: { pages: pages.length, personal_data_terms_removed: terms.length },
      usage: result.usage,
      steps: result.steps,
      startedAt,
    });

    let productId = sub.product_id;
    if (!productId) {
      const gtin = normaliseGtin(proposed.gtin);
      const [taken] = gtin ? await tx`select id from public.products where gtin = ${gtin}` : [];
      if (taken) {
        productId = taken.id as string;
      } else {
        const [created] = await tx`
          select private.create_product(
            ${sub.source_id}, ${scrubText(proposed.product_name, terms)}, ${proposed.brand_name},
            ${gtin}, ${proposed.category ? [proposed.category] : []}::text[]
          ) as id`;
        productId = created.id as string;
        await recordEvent(tx, {
          type: "product.created",
          subjectType: "product",
          subjectId: productId,
          actor: "agent:redactor",
          payload: { from_submission: sub.id },
          runId,
        });
      }
      await tx`update public.submissions set product_id = ${productId}, updated_at = now() where id = ${sub.id}`;
    }

    for (const page of pages) {
      await tx`
        insert into public.document_pages (document_id, page_number, redacted_text, agent_run_id)
        values (${sub.document_id}, ${page.page}, ${page.text}, ${runId})
        on conflict (document_id, page_number) do update
          set redacted_text = excluded.redacted_text, agent_run_id = excluded.agent_run_id, created_at = now()`;
    }
    await tx`
      update public.documents
      set redaction_status = 'redacted', page_count = coalesce(page_count, ${pages.length})
      where id = ${sub.document_id}`;
    await tx`
      insert into public.submission_private (submission_id, pii_terms)
      values (${sub.id}, ${terms}::text[])
      on conflict (submission_id) do update set pii_terms = excluded.pii_terms, updated_at = now()`;

    const value = { submission_id: sub.id, coa_report_id: report.id, report_date: isoDate(report.report_date) };
    await tx`
      insert into public.observations (entity_id, source_id, attribute, value, document_id, agent_run_id, content_hash)
      values (
        ${productId}, ${sub.source_id}, 'coa_published', ${json(tx, value)}, ${sub.document_id}, ${runId},
        md5(${JSON.stringify(value)})
      )
      on conflict (entity_id, source_id, attribute, content_hash) do nothing`;

    await setSubmissionStatus(tx, sub.id, "published", "agent:redactor", { product_id: productId }, runId);
  };
};

export const coaHandlers = { intake, extraction, resolution, verification, adjudication, redaction };
