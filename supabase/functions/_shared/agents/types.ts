import type { LlmUsage } from "../llm.ts";

/** One recorded action inside an agent run. */
export interface Step {
  kind: "model_call" | "check" | "tool";
  name: string;
  durationMs?: number;
  detail: Record<string, unknown>;
}

export interface AgentResult<T> {
  output: T;
  usage: LlmUsage[];
  steps: Step[];
}

/** A single verification finding. */
export interface Check {
  code: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

/**
 * The closed set of reasons a decision may cite. These codes are public for
 * every submission, including rejected ones, so they must stay generic.
 */
export const REASON_CODES = [
  // publish
  "results_verified",
  "lab_accreditation_confirmed",
  "consistent_with_prior_reports",
  // reject
  "invalid_file",
  "not_a_test_report",
  "no_measurements",
  "product_unresolved",
  "extraction_unreliable",
  "document_inconsistent",
  "suspected_tampering",
  // escalate
  "low_confidence",
  "high_risk_checks",
  "adverse_result_unverified_lab",
  "injection_attempt",
  "legal_claim",
  "pipeline_failure",
  // context
  "lab_accreditation_unconfirmed",
  "self_reported_by_brand",
  "dispute_upheld",
  "dispute_not_supported",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export type Outcome = "publish" | "reject" | "escalate";
