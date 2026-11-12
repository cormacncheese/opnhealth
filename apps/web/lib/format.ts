// Wording and formatting shared by every page. Dates are formatted in UTC so
// the server and the browser always render the same text.

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Unknown date";
  // Date-only values are already calendar dates; do not shift them.
  return DATE.format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? `${DATE_TIME.format(new Date(value))} UTC` : "Unknown time";
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

const OPERATOR: Record<string, string> = { eq: "", lt: "< ", lte: "≤ ", gt: "> ", gte: "≥ " };

/** A lab result as it reads on the report, e.g. "< 0.01 mg/kg" or "Not detected". */
export function formatResult(m: {
  operator: string | null;
  value: number | string | null;
  unit: string | null;
  loq?: number | string | null;
}): string {
  if (m.operator === "nd") {
    return m.loq != null ? `Not detected (below ${formatNumber(m.loq)} ${m.unit ?? ""})`.trim() : "Not detected";
  }
  return `${OPERATOR[m.operator ?? "eq"] ?? ""}${formatNumber(m.value)} ${m.unit ?? ""}`.trim();
}

export const STATUS: Record<string, { label: string; line: string }> = {
  received: { label: "Received", line: "Waiting for an agent to pick this up" },
  processing: { label: "In review", line: "Agents are reading the document" },
  approved: { label: "Approved", line: "Approved. Removing personal details before publishing" },
  published: { label: "Published", line: "Published to the open record" },
  rejected: { label: "Not published", line: "Reviewed and not published" },
  escalated: { label: "With a maintainer", line: "Sent to a human maintainer for a decision" },
  withdrawn: { label: "Withdrawn", line: "Withdrawn from the open record" },
  duplicate: { label: "Duplicate", line: "This document was already submitted" },
  failed: { label: "Failed", line: "This could not be processed" },
};

export const REASON: Record<string, string> = {
  results_verified: "The results match the document",
  lab_accreditation_confirmed: "The lab's accreditation is confirmed",
  consistent_with_prior_reports: "Consistent with earlier reports",
  invalid_file: "The file could not be read",
  not_a_test_report: "The document is not a lab test report",
  no_measurements: "No test results were found in the document",
  product_unresolved: "The tested product could not be identified",
  extraction_unreliable: "The results could not be read reliably",
  document_inconsistent: "The document contradicts itself",
  suspected_tampering: "The document shows signs of alteration",
  low_confidence: "The agents were not confident enough to decide",
  high_risk_checks: "Verification checks raised concerns",
  adverse_result_unverified_lab: "An unfavourable result from a lab that is not yet confirmed",
  injection_attempt: "The document contains instructions aimed at the reviewer",
  legal_claim: "A legal claim was raised",
  pipeline_failure: "Automated processing failed",
  lab_accreditation_unconfirmed: "The lab's accreditation has not been confirmed",
  self_reported_by_brand: "Submitted by the brand itself",
  dispute_upheld: "A dispute was upheld",
  dispute_not_supported: "A dispute was not supported by the document",
};

export const reasonLabel = (code: string) => REASON[code] ?? code.replaceAll("_", " ");

export const RELATIONSHIP: Record<string, string> = {
  consumer: "a consumer",
  brand: "the brand",
  lab: "a lab",
  crawler: "the brand's website",
};

export const STAGE: Record<string, string> = {
  intake: "Intake agent",
  extraction: "Extraction agent",
  adjudicator: "Adjudicator agent",
  supervisor: "Supervisor agent",
  maintainer: "Human maintainer",
};

export const OUTCOME: Record<string, string> = {
  publish: "Publish",
  reject: "Do not publish",
  escalate: "Send to a maintainer",
};

export const ACCREDITATION: Record<string, string> = {
  verified: "Accreditation confirmed",
  stated: "Accreditation stated on the report, not yet confirmed",
  unknown: "Accreditation unknown",
  revoked: "Accreditation revoked",
};

export interface LedgerEvent {
  seq: number;
  occurred_at: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  actor: string;
  agent_run_id: string | null;
  payload: unknown;
  hash: string;
}

const EVENT: Record<string, string> = {
  "submission.received": "A document was submitted",
  "submission.processing": "A document passed intake",
  "submission.extracted": "Results were read from a document",
  "submission.resolved": "A report was matched to a product",
  "submission.verified": "A report was checked against its document",
  "submission.approved": "A report was approved",
  "submission.published": "A report was published",
  "submission.rejected": "A document was not published",
  "submission.escalated": "A report was sent to a maintainer",
  "submission.withdrawn": "A published report was withdrawn",
  "submission.reverification_scheduled": "A report was queued for re-checking",
  "decision.publish": "Decision: publish",
  "decision.reject": "Decision: do not publish",
  "decision.escalate": "Decision: send to a maintainer",
  "dispute.opened": "A dispute was opened",
  "dispute.reopened": "A dispute reopened a published report",
  "dispute.resolved": "A dispute was resolved",
  "dispute.escalated": "A dispute was sent to a maintainer",
  "brand_claim.opened": "Someone claimed a brand account",
  "brand_claim.verified": "A brand account was verified",
  "brand_claim.rejected": "A brand claim was rejected",
  "brand.website_confirmed": "A brand's website was confirmed",
  "product.created": "A product was added to the catalog",
  "source.synced": "A public data source was synced",
  "recall.matched": "A recall was matched to a product",
  "coa.stale": "A report was flagged as out of date",
  "export.published": "A data export was published",
  "job.dead_lettered": "A job failed after repeated attempts",
  "job.abandoned": "A failed job was abandoned",
  "pipeline.paused": "A pipeline was paused",
  "pipeline.resumed": "A pipeline was resumed",
};

export const eventLabel = (type: string) => EVENT[type] ?? type;

export function actorLabel(actor: string): string {
  if (actor.startsWith("agent:")) return `${actor.slice(6).replaceAll("_", " ")} agent`;
  if (actor.startsWith("system:connector:")) return `${actor.slice(17)} sync`;
  if (actor.startsWith("system:")) return "the system";
  if (actor === "user") return "a user";
  if (actor === "maintainer") return "a maintainer";
  return actor;
}

/** Where the thing an event is about can be viewed, if it has a page. */
export function subjectHref(subjectType: string, subjectId: string): string | null {
  if (subjectType === "submission") return `/submissions/${subjectId}`;
  if (subjectType === "product") return `/products/${subjectId}`;
  return null;
}

export const shortHash = (hash: string) => `${hash.slice(0, 10)}…`;
