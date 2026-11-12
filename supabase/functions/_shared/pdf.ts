// Structural facts about an uploaded file, read without rendering it.

import { PDFDocument } from "pdf-lib";

export interface PdfInfo {
  pageCount: number;
  encrypted: boolean;
  producer: string | null;
  creator: string | null;
  /** Times the file was appended to after first being written. */
  incrementalUpdates: number;
  /** Set when the last tool to write the file is a general-purpose editor. */
  editorProducer: string | null;
}

const EDITORS =
  /ilovepdf|smallpdf|sejda|pdfescape|pdffiller|pdf-xchange editor|photoshop|illustrator|canva|inkscape|gimp|libreoffice draw/i;

export type FileKind = "application/pdf" | "image/png" | "image/jpeg";

/** Identifies the file from its leading bytes, ignoring the declared type. */
export function sniffFileKind(bytes: Uint8Array): FileKind | null {
  const head = (n: number) => Array.from(bytes.subarray(0, n));
  const startsWith = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (bytes.length < 8) return null;
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (head(3).join() === [0xff, 0xd8, 0xff].join()) return "image/jpeg";
  return null;
}

function countMarker(bytes: Uint8Array, marker: string): number {
  const m = new TextEncoder().encode(marker);
  let count = 0;
  outer: for (let i = 0; i <= bytes.length - m.length; i++) {
    for (let j = 0; j < m.length; j++) {
      if (bytes[i + j] !== m[j]) continue outer;
    }
    count++;
  }
  return count;
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInfo> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const producer = doc.getProducer() ?? null;
  const creator = doc.getCreator() ?? null;
  const editor = [producer, creator].find((s) => s && EDITORS.test(s)) ?? null;
  return {
    pageCount: doc.getPageCount(),
    encrypted: doc.isEncrypted,
    producer,
    creator,
    // Every save writes one %%EOF; more than one means later appends.
    incrementalUpdates: Math.max(0, countMarker(bytes, "%%EOF") - 1),
    editorProducer: editor,
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
