// Environment access that works in the Edge runtime (Deno) and in Node,
// where the same code runs for tests and evals.

type Globals = {
  Deno?: { env: { get(name: string): string | undefined } };
  process?: { env: Record<string, string | undefined> };
};

export function env(name: string): string | undefined {
  const g = globalThis as Globals;
  return g.Deno?.env.get(name) ?? g.process?.env[name] ?? undefined;
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const config = {
  /** Model for extraction, verification, adjudication and redaction. */
  model: () => env("AGENT_MODEL") ?? "anthropic/claude-sonnet-5.5",
  /** Cheaper model for classification and triage. */
  fastModel: () => env("AGENT_MODEL_FAST") ?? "google/gemini-3.8-flash",
  /** Sent to public APIs and brand websites. Set it to include a contact address. */
  userAgent: () => env("CRAWLER_USER_AGENT") ?? "OpenDataIntelligenceLayer/0.1",
  maxAttempts: 4,
  maxFileBytes: 10 * 1024 * 1024,
  maxPages: 30,
  /** Reports older than this are flagged as stale. */
  staleAfterMonths: 12,
  /** Below this confidence a publish decision goes to a maintainer instead. */
  publishConfidence: 0.8,
};
