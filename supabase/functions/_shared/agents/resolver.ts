// Resolver: which catalog product does this report describe?

import { z } from "zod";
import { untrusted } from "../core/text.ts";
import { type Llm, UNTRUSTED_INPUT_RULES } from "../llm.ts";
import type { AgentResult } from "./types.ts";

export const RESOLVER_PROMPT_VERSION = "resolver@1";

export interface ProductCandidate {
  id: string;
  name: string;
  brand_name: string | null;
  gtin: string | null;
  category: string | null;
}

export interface ResolverInput {
  sample: {
    description: string | null;
    brand: string | null;
    product_name: string | null;
    lot_number: string | null;
    gtin: string | null;
    matrix: string | null;
  };
  /** What the submitter said the product was. Not evidence by itself. */
  claimedProductText: string | null;
  claimedProductId: string | null;
  candidates: ProductCandidate[];
}

export const ResolverSchema = z.object({
  match: z
    .enum(["existing", "new", "none"])
    .describe(
      "existing: one candidate is the product on the report. new: the report names a specific product that is not among the candidates. none: the report does not identify a specific product.",
    ),
  product_id: z.string().nullable().describe("Candidate id when match is existing, else null."),
  new_product: z
    .object({
      brand_name: z.string(),
      product_name: z.string(),
      category: z.string().nullable(),
    })
    .nullable()
    .describe("Only when match is new. Use the brand and product exactly as printed on the report."),
  confidence: z.number().describe("0 to 1."),
  rationale: z.string().describe("One or two sentences. No personal data."),
});
export type ResolverOutput = z.infer<typeof ResolverSchema>;

const SYSTEM = `
You match a laboratory report to a product in a catalog.

${UNTRUSTED_INPUT_RULES}

Rules:
- The evidence is what the report itself says about the sample: brand, product name, barcode, description.
- The submitter's claim is a hint only. If the report does not support it, do not accept it.
- Choose "existing" only when brand and product on the report agree with a candidate. A matching barcode settles it. Different flavours, sizes or formulations are different products unless the report does not distinguish them and only one candidate fits.
- Choose "new" only when the report names both a brand and a specific product.
- Choose "none" for raw ingredients, internal sample codes, or anything that cannot be tied to a product a consumer could buy.
`.trim();

export async function resolveProduct(
  llm: Llm,
  input: ResolverInput,
): Promise<AgentResult<ResolverOutput>> {
  const prompt = [
    "Sample details read from the report:",
    untrusted("report", JSON.stringify(input.sample, null, 2)),
    "Submitter's claim about the product:",
    untrusted("submitter", input.claimedProductText ?? "(none)"),
    input.claimedProductId
      ? `The submitter selected candidate ${input.claimedProductId}.`
      : "The submitter did not select a catalog product.",
    "Catalog candidates:",
    JSON.stringify(input.candidates, null, 2),
  ].join("\n\n");

  const { output, usage } = await llm.generate({
    name: "resolve",
    tier: "default",
    system: SYSTEM,
    prompt,
    schema: ResolverSchema,
  });

  // The model may only pick from the candidates it was shown.
  const valid =
    output.match !== "existing" ||
    (output.product_id !== null && input.candidates.some((c) => c.id === output.product_id));

  return {
    output: valid
      ? output
      : {
          ...output,
          match: "none",
          product_id: null,
          rationale: "The selected product was not among the candidates.",
        },
    usage: [usage],
    steps: [],
  };
}
