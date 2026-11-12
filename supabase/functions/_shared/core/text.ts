// Small pure text helpers.

export const REDACTED = "[REDACTED]";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces every occurrence of the given terms, ignoring case. */
export function scrubText(text: string, terms: string[]): string {
  let out = text;
  for (const term of terms) {
    const t = term.trim();
    // Very short terms would redact fragments of ordinary words.
    if (t.length < 3) continue;
    out = out.replace(new RegExp(escapeRegExp(t).replace(/\s+/g, "\\s+"), "gi"), REDACTED);
  }
  return out;
}

/** Applies scrubText to every string inside a JSON-like value. */
export function scrubDeep<T>(value: T, terms: string[]): T {
  if (terms.length === 0) return value;
  if (typeof value === "string") return scrubText(value, terms) as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, terms)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, scrubDeep(v, terms)]),
    ) as T;
  }
  return value;
}

/**
 * Returns the barcode as a 14-digit GTIN, or null when it is not a valid
 * GTIN-8, -12, -13 or -14 (wrong length or check digit).
 */
export function normaliseGtin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  const padded = digits.padStart(14, "0");
  if (/^0+$/.test(padded)) return null;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += Number(padded[i]) * (i % 2 === 0 ? 3 : 1);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(padded[13]) ? padded : null;
}

/** Returns the ISO date if the string is a real calendar date, else null. */
export function parseIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === raw.trim() ? raw.trim() : null;
}

export function normaliseName(name: string): string {
  const stripped = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return stripped || name.toLowerCase().trim();
}

/** Marks text as data. The closing tag is removed so it cannot be forged. */
export function untrusted(label: string, text: string | null | undefined): string {
  const body = (text ?? "").replace(/<\/?untrusted[^>]*>/gi, "");
  return `<untrusted source="${label}">\n${body}\n</untrusted>`;
}

export function errorMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  // Some libraries colour their messages for a terminal; these end up in public records.
  // deno-lint-ignore no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "").trim();
}
