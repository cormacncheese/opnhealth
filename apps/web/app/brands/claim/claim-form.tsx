"use client";

import { RequireUser } from "@/components/require-user";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, ErrorNote, Field, fieldClass, Loading, Mono, Panel, Section } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { browserClient } from "@/lib/supabase/browser";

interface Brand {
  id: string;
  slug: string;
  name: string;
  website: string | null;
}

async function loadClaims(userId: string) {
  const { data, error } = await browserClient()
    .from("brand_members")
    .select("id, status, method, note, challenge_token, email_domain, created_at, brands(name, slug, website)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

type Claims = Awaited<ReturnType<typeof loadClaims>>;

/** The domain a claim is checked against: the website's host without "www". */
function domainOf(website: string | null | undefined): string | null {
  try {
    return website ? new URL(website).hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

const CLAIM_STATUS = {
  pending: { tone: "warn", label: "Checking" },
  verified: { tone: "good", label: "Verified" },
  rejected: { tone: "bad", label: "Not verified" },
} as const;

function ClaimFormInner({ userId }: { userId: string }) {
  const preset = useSearchParams().get("brand");
  const [claims, setClaims] = useState<Claims | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Brand[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    loadClaims(userId).then(setClaims, () => setError("Your claims could not be loaded. Refresh to try again."));
  }, [userId]);

  useEffect(() => {
    refresh();
    // The agent re-checks pending claims in the background.
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!preset) return;
    let cancelled = false;
    browserClient()
      .from("brands")
      .select("id, slug, name, website")
      .eq("slug", preset)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setBrand(data);
      });
    return () => {
      cancelled = true;
    };
  }, [preset]);

  const term = query.trim();
  useEffect(() => {
    if (term.length < 2) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const { data } = await browserClient()
        .from("brands")
        .select("id, slug, name, website")
        .ilike("name", `%${term.replace(/[%_\\]/g, "\\$&")}%`)
        .order("name")
        .limit(8);
      if (!stale) setMatches(data ?? []);
    }, 220);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [term]);

  async function claim() {
    if (!brand) return;
    setBusy(true);
    setError(null);
    const { error } = await browserClient().from("brand_members").insert({ brand_id: brand.id });
    setBusy(false);
    if (error) {
      setError(
        error.code === "23505"
          ? `You have already asked to verify ${brand.name}. Its status is shown below.`
          : `The request for ${brand.name} was not saved. Try again.`,
      );
      return;
    }
    setBrand(null);
    setQuery("");
    refresh();
  }

  return (
    <>
      {brand ? (
        <Panel>
          <p className="font-semibold">{brand.name}</p>
          <p className="mt-1 text-sm text-neutral-600">
            {domainOf(brand.website)
              ? `We will check that your email address or a DNS record belongs to ${domainOf(brand.website)}.`
              : "This brand has no confirmed website yet. An agent will look for it first, which can take a while."}
          </p>
          <div className="mt-4 flex gap-3">
            <Button type="button" onClick={claim} disabled={busy}>
              Verify {brand.name}
            </Button>
            <button type="button" className="text-sm font-medium underline" onClick={() => setBrand(null)}>
              Choose another brand
            </button>
          </div>
        </Panel>
      ) : (
        <Field label="Your brand">
          <input
            className={fieldClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for the brand name"
          />
          {term.length >= 2 && (
            <ul className="mt-3 space-y-2">
              {matches.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setBrand(b)}
                    className="block w-full rounded-2xl bg-neutral-100 px-4 py-3 text-left font-medium hover:bg-neutral-200/70"
                  >
                    {b.name}
                  </button>
                </li>
              ))}
              {matches.length === 0 && (
                <li className="px-4 py-2 text-sm text-neutral-600">
                  No brand with that name is in the catalog yet. Brands are added when one of their products is.
                </li>
              )}
            </ul>
          )}
        </Field>
      )}

      <div className="mt-4">
        <ErrorNote>{error}</ErrorNote>
      </div>

      <Section title="Your brand accounts">
        {!claims ? (
          <Loading lines={1} />
        ) : claims.length === 0 ? (
          <p className="text-neutral-600">You have not asked to verify a brand yet.</p>
        ) : (
          <div className="space-y-3">
            {claims.map((c) => {
              const status = CLAIM_STATUS[c.status as keyof typeof CLAIM_STATUS] ?? CLAIM_STATUS.pending;
              const domain = domainOf(c.brands?.website);
              return (
                <Panel key={c.id}>
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-semibold">{c.brands?.name}</p>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-neutral-600">
                    Requested {formatDate(c.created_at)}
                    {c.note && ` · ${c.note}`}
                  </p>
                  {c.status === "pending" && (
                    <div className="mt-4 space-y-2 text-sm text-neutral-700">
                      <p>
                        To verify{domain ? ` ${domain}` : ""}, either sign in with an email address at the brand&apos;s
                        domain, or add this DNS TXT record. It is checked automatically every two hours.
                      </p>
                      <p>
                        Name: <Mono>_odil-challenge{domain ? `.${domain}` : ""}</Mono>
                      </p>
                      <p>
                        Value: <Mono>odil-verify={c.challenge_token}</Mono>
                      </p>
                    </div>
                  )}
                </Panel>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}

export function ClaimForm() {
  return <RequireUser reason="Sign in with your work email to verify a brand.">{(user) => <ClaimFormInner userId={user.id} />}</RequireUser>;
}
