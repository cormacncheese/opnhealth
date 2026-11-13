// Extraction: turn a test report into structured fields, each result tied
// to the page and row it was read from.

import { z } from "zod";
import { type Llm, type LlmFile, UNTRUSTED_INPUT_RULES } from "../llm.ts";
import type { AgentResult } from "./types.ts";

export const EXTRACTION_PROMPT_VERSION = "extraction@2";

// Providers cap how many nullable fields a structured output may have, so the
// model returns "" for text that is not printed and toOutput() turns it into null.
const nullableText = z.string().describe("Empty string if not printed.");

const ModelSchema = z.object({
  lab: z.object({
    name: nullableText.describe("Testing laboratory, as printed."),
    accreditation_body: nullableText.describe(
      "Accreditor named on the document, e.g. A2LA, ANAB, PJLA, UKAS. Null if none is stated.",
    ),
    accreditation_number: nullableText.describe("Accreditation or certificate number, if printed."),
  }),
  report_number: nullableText,
  report_date: nullableText.describe("Date the report was issued, YYYY-MM-DD."),
  sample_received_date: nullableText.describe("YYYY-MM-DD."),
  tested_date: nullableText.describe("Date analysis was completed, YYYY-MM-DD."),
  sample: z.object({
    description: nullableText.describe("Sample name or description as printed."),
    brand: nullableText,
    product_name: nullableText,
    lot_number: nullableText.describe("Lot or batch number."),
    gtin: nullableText.describe("Barcode (UPC/EAN) if printed."),
    matrix: nullableText.describe("Kind of material tested, e.g. 'protein powder', 'bottled water'."),
  }),
  methods: z.array(z.string()).describe("Test methods named on the report, e.g. 'ICP-MS', 'AOAC 2015.01'."),
  results: z.array(
    z.object({
      analyte: z.string().describe("Analyte name exactly as printed."),
      operator: z
        .enum(["eq", "lt", "lte", "gt", "gte", "nd"])
        .describe(
          "eq for a plain number; lt for '<' results; nd when reported as not detected with no number.",
        ),
      value: z.number().nullable().describe("The number as printed. Null only for nd."),
      unit: nullableText.describe("Unit exactly as printed."),
      lod: z.number().nullable().describe("Limit of detection, in the same unit, if printed."),
      loq: z.number().nullable().describe("Limit of quantitation or reporting limit, if printed."),
      method: nullableText,
      page: z.number().nullable().describe("1-based page the row appears on."),
      citation: z.string().describe("The row copied verbatim from the document."),
    }),
  ),
  personal_data_terms: z
    .array(z.string())
    .describe(
      "Every name of an individual, personal email, personal phone number or home address in the document, copied verbatim. Company and lab names are not personal data.",
    ),
  confidence: z.number().describe("0 to 1: how sure you are that every result was read correctly."),
  notes: nullableText.describe("Anything that made extraction unreliable. No personal data."),
});
type ModelOutput = z.infer<typeof ModelSchema>;
type Nulled<T> = { [K in keyof T]: T[K] extends string ? string | null : T[K] };

type TopText = "report_number" | "report_date" | "sample_received_date" | "tested_date" | "notes";

export type ExtractionOutput = Omit<ModelOutput, "lab" | "sample" | "results" | TopText> &
  Nulled<Pick<ModelOutput, TopText>> & {
    lab: Nulled<ModelOutput["lab"]>;
    sample: Nulled<ModelOutput["sample"]>;
    results: (Omit<ModelOutput["results"][number], "unit" | "method"> & { unit: string | null; method: string | null })[];
  };

const orNull = (v: string | null | undefined) => (v && v.trim() ? v : null);

function toOutput(m: ModelOutput): ExtractionOutput {
  return {
    ...m,
    lab: { name: orNull(m.lab.name), accreditation_body: orNull(m.lab.accreditation_body), accreditation_number: orNull(m.lab.accreditation_number) },
    report_number: orNull(m.report_number),
    report_date: orNull(m.report_date),
    sample_received_date: orNull(m.sample_received_date),
    tested_date: orNull(m.tested_date),
    sample: {
      description: orNull(m.sample.description),
      brand: orNull(m.sample.brand),
      product_name: orNull(m.sample.product_name),
      lot_number: orNull(m.sample.lot_number),
      gtin: orNull(m.sample.gtin),
      matrix: orNull(m.sample.matrix),
    },
    results: m.results.map((r) => ({ ...r, unit: orNull(r.unit), method: orNull(r.method) })),
    notes: orNull(m.notes),
  };
}

const SYSTEM = `
You extract data from laboratory test reports for a public database. Accuracy matters more than completeness: a wrong number published under a brand's name does real harm.

${UNTRUSTED_INPUT_RULES}

Rules:
- Copy values exactly as printed. Do not convert units, round, or infer missing values.
- One entry in "results" per analyte row. Include every row that reports a measured result or a "not detected" / "less than" result. Skip specification-only rows that have no result.
- "<0.01" is operator lt with value 0.01. "ND" or "Not detected" with no number is operator nd with value null. "ND (<0.005)" is operator lt with value 0.005.
- If a field is not printed, return null. Never guess a brand, product or lot.
- If the document is illegible or the table cannot be read reliably, return the rows you are sure of, lower "confidence", and say why in "notes".
`.trim();

export async function extractReport(
  llm: Llm,
  file: LlmFile,
): Promise<AgentResult<ExtractionOutput>> {
  const { output, usage } = await llm.generate({
    name: "extract",
    tier: "default",
    system: SYSTEM,
    prompt: "Extract the attached laboratory report.",
    files: [file],
    schema: ModelSchema,
    maxOutputTokens: 16000,
  });
  return { output: toOutput(output), usage: [usage], steps: [] };
}
