// Brand verifier: proves that an account acts for a brand. Two methods,
// both checked by code: a confirmed email address at the brand's domain, or
// a DNS TXT record on that domain carrying the claim's token.

import { registrableDomain } from "./discovery.ts";

export const BRAND_VERIFIER_VERSION = "brand_verifier@1";

/** How often a pending claim is re-checked before it is rejected. */
export const MAX_CLAIM_ATTEMPTS = 24;
export const CLAIM_RETRY_SECONDS = 2 * 60 * 60;

export interface ClaimInput {
  brandWebsite: string | null;
  emailDomain: string | null;
  challengeToken: string;
  attempts: number;
}

export type ClaimVerdict =
  | { status: "verified"; method: "email_domain" | "dns_txt"; note: string }
  | { status: "pending"; note: string }
  | { status: "rejected"; note: string };

export function txtRecordName(domain: string): string {
  return `_odil-challenge.${domain}`;
}

export function txtRecordValue(token: string): string {
  return `odil-verify=${token}`;
}

type TxtLookup = (name: string) => Promise<string[]>;

/** DNS over HTTPS, so the lookup works from the Edge runtime. */
export const lookupTxt: TxtLookup = async (name) => {
  const res = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
    { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(`DNS lookup failed with status ${res.status}`);
  const body = (await res.json()) as { Answer?: { data: string }[] };
  return (body.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s+"/g, ""));
};

export async function verifyClaim(
  input: ClaimInput,
  lookup: TxtLookup = lookupTxt,
): Promise<ClaimVerdict> {
  if (!input.brandWebsite) {
    return input.attempts + 1 >= MAX_CLAIM_ATTEMPTS
      ? { status: "rejected", note: "No official website is on record for this brand, so the claim could not be checked." }
      : { status: "pending", note: "Waiting for the brand's official website to be confirmed." };
  }

  const domain = registrableDomain(new URL(input.brandWebsite).hostname);

  if (input.emailDomain && (input.emailDomain === domain || input.emailDomain.endsWith(`.${domain}`))) {
    return { status: "verified", method: "email_domain", note: `Confirmed email address at ${domain}.` };
  }

  const records = await lookup(txtRecordName(domain));
  if (records.includes(txtRecordValue(input.challengeToken))) {
    return { status: "verified", method: "dns_txt", note: `TXT record found on ${domain}.` };
  }

  return input.attempts + 1 >= MAX_CLAIM_ATTEMPTS
    ? { status: "rejected", note: `No matching TXT record appeared on ${domain} in time.` }
    : { status: "pending", note: `Add the TXT record to ${domain}; it is checked every two hours.` };
}
