// Monitor: ties regulator recalls to catalog products.

import { z } from "zod";
import { untrusted } from "../core/text.ts";
import { type Llm, UNTRUSTED_INPUT_RULES } from "../llm.ts";
import type { AgentResult } from "./types.ts";
import type { ProductCandidate } from "./resolver.ts";

export const MONITOR_PROMPT_VERSION = "monitor@1";

/** Matches below this confidence are not recorded. */
export const RECALL_MATCH_CONFIDENCE = 0.8;

export const RecallMatchSchema = z.object({
  matches: z.array(
    z.object({
      product_id: z.string(),
      confidence: z.number().describe("0 to 1."),
      rationale: z.string().describe("One sentence."),
    }),
  ),
});

export interface RecallInput {
  firm: string | null;
  product_description: string | null;
  reason: string | null;
  candidates: ProductCandidate[];
}

export interface RecallMatchOutput {
  matches: { product_id: string; confidence: number; rationale: string }[];
}

const SYSTEM = `
You decide which catalog products, if any, are covered by a regulator's recall notice.

${UNTRUSTED_INPUT_RULES}

Rules:
- A match needs the same brand or firm and the same product. A barcode in the notice that equals a candidate's barcode settles it.
- Recalls are often limited to certain lots; a product still matches if the notice names it, whatever the lot.
- Similar products from other brands are not matches. If none of the candidates is clearly covered, return an empty list.
`.trim();

export async function matchRecall(
  llm: Llm,
  input: RecallInput,
): Promise<AgentResult<RecallMatchOutput>> {
  if (input.candidates.length === 0) {
    return {
      output: { matches: [] },
      usage: [],
      steps: [{ kind: "check", name: "no_candidates", detail: {} }],
    };
  }

  const { output, usage } = await llm.generate({
    name: "match_recall",
    tier: "fast",
    system: SYSTEM,
    prompt: [
      "Recall notice:",
      untrusted(
        "regulator",
        JSON.stringify(
          { firm: input.firm, product_description: input.product_description, reason: input.reason },
          null,
          2,
        ),
      ),
      "Catalog candidates:",
      JSON.stringify(input.candidates, null, 2),
    ].join("\n\n"),
    schema: RecallMatchSchema,
  });

  const ids = new Set(input.candidates.map((c) => c.id));
  return {
    output: {
      matches: output.matches.filter(
        (m) => ids.has(m.product_id) && m.confidence >= RECALL_MATCH_CONFIDENCE,
      ),
    },
    usage: [usage],
    steps: [],
  };
}
