// Shared by the database tests: a model that replies from a script, an
// in-memory file store, and a generator for small PDFs.

import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Llm, LlmRequest } from "../supabase/functions/_shared/llm.ts";
import type { DocumentStore } from "../supabase/functions/_shared/pipeline/context.ts";

export type Script = Record<string, (req: LlmRequest<unknown>) => unknown>;

export function scriptedLlm(script: Script): Llm {
  return {
    async generate<T>(req: LlmRequest<T>) {
      const reply = script[req.name];
      if (!reply) throw new Error(`No scripted reply for "${req.name}"`);
      const output = req.schema.parse(reply(req as LlmRequest<unknown>)) as T;
      return {
        output,
        usage: { name: req.name, model: "test/scripted", inputTokens: 100, outputTokens: 50, costUsd: 0.001, durationMs: 1 },
      };
    },
  };
}

export function memoryStore(): DocumentStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async download(bucket, path) {
      const f = files.get(`${bucket}/${path}`);
      if (!f) throw new Error(`Missing ${bucket}/${path}`);
      return f;
    },
    async upload(bucket, path, bytes) {
      files.set(`${bucket}/${path}`, bytes);
    },
  };
}

export async function makePdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 740 - i * 18, size: 11, font }));
  return await doc.save();
}
