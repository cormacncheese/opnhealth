// Request helpers for the Edge Functions.

import { env } from "./env.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Internal functions are called by pg_cron with a shared secret. They are
 * deployed without JWT verification, so this check is what keeps them private.
 */
export function isInternalCall(req: Request): boolean {
  const expected = env("WORKER_SECRET");
  const given = req.headers.get("x-worker-secret");
  return Boolean(expected && given && timingSafeEqual(given, expected));
}

/** Lets work continue after the response is sent, where the runtime supports it. */
export function runInBackground(work: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  const guarded = work.catch((e) => console.error("Background task failed:", e));
  if (runtime) runtime.waitUntil(guarded);
}
