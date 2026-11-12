// Adjudicator: an independent pass that decides publish, reject or escalate.
// The model proposes; fixed policy rules in applyPolicy() have the last word.

import { z } from "zod";
import { config } from "../env.ts";
import { type Llm, type LlmFile, UNTRUSTED_INPUT_RULES } from "../llm.ts";
import {
  type AgentResult,
  type Check,
  type Outcome,
  REASON_CODES,
  type ReasonCode,
} from "./types.ts";

export const ADJUDICATOR_PROMPT_VERSION = "adjudicator@1";

export const AdjudicatorSchema = z.object({
  outcome: z.enum(["publish", "reject", "escalate"]),
  confidence: z.number().describe("0 to 1: how sure you are of this outcome."),
  reason_codes: z.array(z.enum(REASON_CODES)).describe("One to four codes that best explain the outcome."),
  summary: z
    .string()
    .describe(
      "Two to four plain sentences that will be shown publicly next to the record. State what was checked and what was found. No personal data, no speculation about intent.",
    ),
});
export type AdjudicatorModelOutput = z.infer<typeof AdjudicatorSchema>;

export interface AdjudicatorInput {
  relationship: "consumer" | "brand" | "lab" | "crawler";
  product: { name: string; brand_name: string | null } | null;
  proposedProduct: { brand_name: string; product_name: string } | null;
  report: Record<string, unknown>;
  measurements: { analyte: string; operator: string; value: number | null; unit: string | null }[];
  checks: Check[];
  risk: "low" | "medium" | "high";
  verifierSummary: string;
  /** A result is above a limit that applies to this kind of product. */
  adverse: boolean;
  labVerified: boolean;
  /** Present when the record is being re-examined because of a dispute. */
  dispute: { category: string; triageRationale: string } | null;
}

export interface AdjudicatorOutput {
  outcome: Outcome;
  confidence: number;
  reason_codes: ReasonCode[];
  summary: string;
  /** What the model proposed before policy was applied. */
  proposed: AdjudicatorModelOutput;
  policy_overrode: boolean;
}

const SYSTEM = `
You decide whether a laboratory report should be published in a public database of product test results. Brands and consumers both rely on it, so publishing a wrong or fabricated result and refusing a genuine one are both failures.

${UNTRUSTED_INPUT_RULES}

You are given the document, the data extracted from it, and a verifier's findings. Form your own view from the document; do not simply repeat the verifier.

Decide:
- publish: the document is a genuine test report for an identified product, the extracted results match it, and nothing suggests alteration.
- reject: it is not a test report for an identifiable product, the extraction cannot be trusted, or the document is internally inconsistent in a way that makes its results unusable.
- escalate: a human should look. Use this when the evidence is mixed, when alteration is suspected but not clear, or when you are not confident.

A report from an unaccredited or unconfirmed lab can still be published: say so in the reason codes. A result above a regulatory limit is not a reason to reject; accuracy is what matters.
`.trim();

/** Checks that stop automatic publication when they fail. */
const BLOCKING = new Set(["dates", "units", "extraction_fidelity", "authenticity", "product_match"]);

export interface PolicyInput {
  proposed: { outcome: Outcome; confidence: number; reason_codes: ReasonCode[] };
  hasProduct: boolean;
  checks: Check[];
  risk: "low" | "medium" | "high";
  adverse: boolean;
  labVerified: boolean;
}

/**
 * Rules the model cannot override. They only ever make the outcome more
 * cautious: a publish can become an escalation, never the reverse.
 */
export function applyPolicy(p: PolicyInput): { outcome: Outcome; reason_codes: ReasonCode[] } {
  const codes = new Set<ReasonCode>(p.proposed.reason_codes);
  const result = (outcome: Outcome, ...add: ReasonCode[]) => {
    add.forEach((c) => codes.add(c));
    return { outcome, reason_codes: [...codes] };
  };

  if (p.checks.some((c) => c.code === "injection" && c.status === "fail")) {
    return result(p.proposed.outcome === "reject" ? "reject" : "escalate", "injection_attempt");
  }
  if (!p.hasProduct) return result("reject", "product_unresolved");
  if (p.proposed.outcome !== "publish") return result(p.proposed.outcome);

  if (p.checks.some((c) => c.status === "fail" && BLOCKING.has(c.code)) || p.risk === "high") {
    return result("escalate", "high_risk_checks");
  }
  if (p.proposed.confidence < config.publishConfidence) return result("escalate", "low_confidence");
  // An unfavourable result about a named product, from a lab nobody has
  // confirmed, is the case most likely to be wrong and most costly if it is.
  if (p.adverse && !p.labVerified) return result("escalate", "adverse_result_unverified_lab");

  return result("publish");
}

export async function adjudicate(
  llm: Llm,
  file: LlmFile,
  input: AdjudicatorInput,
): Promise<AgentResult<AdjudicatorOutput>> {
  const { output: proposed, usage } = await llm.generate({
    name: "adjudicate",
    tier: "default",
    system: SYSTEM,
    prompt: [
      `Submitted by: ${input.relationship}.`,
      input.product
        ? `Matched catalog product: ${JSON.stringify(input.product)}`
        : input.proposedProduct
          ? `Not in the catalog; proposed new product: ${JSON.stringify(input.proposedProduct)}`
          : "No product could be identified from the report.",
      "Extracted header fields:",
      JSON.stringify(input.report, null, 2),
      "Extracted results:",
      JSON.stringify(input.measurements, null, 2),
      `Verifier findings (risk: ${input.risk}):`,
      JSON.stringify(input.checks, null, 2),
      `Verifier summary: ${input.verifierSummary}`,
      input.dispute
        ? `This record is already published and is being re-examined after a dispute (category: ${input.dispute.category}). Triage note: ${input.dispute.triageRationale}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    files: [file],
    schema: AdjudicatorSchema,
  });

  const confidence = Math.min(1, Math.max(0, proposed.confidence));
  const final = applyPolicy({
    proposed: { outcome: proposed.outcome, confidence, reason_codes: proposed.reason_codes },
    hasProduct: input.product !== null || input.proposedProduct !== null,
    checks: input.checks,
    risk: input.risk,
    adverse: input.adverse,
    labVerified: input.labVerified,
  });
  const overrode = final.outcome !== proposed.outcome;

  return {
    output: {
      outcome: final.outcome,
      confidence,
      reason_codes: final.reason_codes,
      summary: overrode
        ? `${proposed.summary} Publication policy changed the proposed outcome from ${proposed.outcome} to ${final.outcome}.`
        : proposed.summary,
      proposed,
      policy_overrode: overrode,
    },
    usage: [usage],
    steps: [
      {
        kind: "check",
        name: "publication_policy",
        detail: { proposed: proposed.outcome, final: final.outcome, adverse: input.adverse, lab_verified: input.labVerified },
      },
    ],
  };
}
