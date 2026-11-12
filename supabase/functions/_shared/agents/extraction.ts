// Extraction: turn a test report into structured fields, each result tied
// to the page and row it was read from.

import { z } from "zod";
import { type Llm, type LlmFile, UNTRUSTED_INPUT_RULES } from "../llm.ts";
import type { AgentResult } from "./types.ts";

export const EXTRACTION_PROMPT_VERSION = "extraction@1";

const nullableText = z.string().nullable();

export const ExtractionSchema = z.object({
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
export type ExtractionOutput = z.infer<typeof ExtractionSchema>;

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
    schema: ExtractionSchema,
    maxOutputTokens: 16000,
  });
  return { output, usage: [usage], steps: [] };
}
