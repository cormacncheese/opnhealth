// Redactor: produces the public form of a document, a page-by-page
// transcript with personal data removed. The original file is never public.

import { z } from "zod";
import { scrubText } from "../core/text.ts";
import { type Llm, type LlmFile, UNTRUSTED_INPUT_RULES } from "../llm.ts";
import type { AgentResult } from "./types.ts";

export const REDACTOR_PROMPT_VERSION = "redactor@1";

export const RedactorSchema = z.object({
  pages: z.array(
    z.object({
      page: z.number().describe("1-based page number."),
      text: z.string().describe("Faithful transcript of the page with personal data replaced by [REDACTED]."),
    }),
  ),
  personal_data_terms: z
    .array(z.string())
    .describe("Every piece of personal data you replaced, copied verbatim from the document."),
});
export type RedactorOutput = z.infer<typeof RedactorSchema>;

const SYSTEM = `
You prepare laboratory reports for publication by transcribing them with personal data removed.

${UNTRUSTED_INPUT_RULES}

Transcribe every page faithfully as plain text. Keep tables readable: one row per line, cells separated by " | ". Do not summarise, correct or omit results.

Replace with [REDACTED]:
- names of individuals (analysts, approvers, contacts, customers who are private persons)
- signatures and initials
- personal email addresses and direct phone numbers
- home addresses

Keep:
- names and business addresses of laboratories, brands and companies
- accreditation numbers, report numbers, lot numbers, dates
- every analyte, result, unit, method and limit

List each replaced item verbatim in "personal_data_terms".
`.trim();

export async function redactDocument(
  llm: Llm,
  file: LlmFile,
  knownPiiTerms: string[],
): Promise<AgentResult<RedactorOutput>> {
  const { output, usage } = await llm.generate({
    name: "redact",
    tier: "default",
    system: SYSTEM,
    prompt: "Transcribe and redact the attached document.",
    files: [file],
    schema: RedactorSchema,
    maxOutputTokens: 32000,
  });

  // Belt and braces: anything either pass identified as personal is removed
  // from the transcript even if the model left it in.
  const terms = [...new Set([...knownPiiTerms, ...output.personal_data_terms])];
  const pages = output.pages
    .filter((p) => Number.isInteger(p.page) && p.page >= 1)
    .map((p) => ({ page: p.page, text: scrubText(p.text, terms) }));

  return {
    output: { pages, personal_data_terms: terms },
    usage: [usage],
    steps: [
      { kind: "check", name: "scrub_known_terms", detail: { terms_applied: terms.length, pages: pages.length } },
    ],
  };
}
