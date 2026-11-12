// Discovery: find a brand's official website and the test reports it
// already publishes there. Fetching is done by plain code with fixed limits;
// the model only ranks what was fetched.

import { z } from "zod";
import { normaliseName, untrusted } from "../core/text.ts";
import { config } from "../env.ts";
import { type Llm, UNTRUSTED_INPUT_RULES } from "../llm.ts";
import type { AgentResult, Step } from "./types.ts";

export const DISCOVERY_PROMPT_VERSION = "discovery@1";

const MAX_PAGES = 8;
const MAX_HTML_BYTES = 1_500_000;
const HINT_PATHS = ["/", "/coa", "/coas", "/lab-results", "/lab-reports", "/testing", "/quality", "/certificates", "/transparency"];
const LINK_HINT = /coa|certificate|analysis|lab|test|result|report|heavy.?metal|purity|quality|transparen/i;

export interface FoundLink {
  url: string;
  text: string;
  foundOn: string;
}

export interface DiscoveryOutput {
  website: string | null;
  websiteMethod: "on_record" | "model_proposed_and_confirmed" | null;
  pagesFetched: number;
  documents: { url: string; reason: string }[];
}

const WebsiteSchema = z.object({
  candidates: z
    .array(z.string())
    .describe("Up to three bare domains (no scheme or path) most likely to be the brand's official website. Empty if you do not know."),
});

const LinksSchema = z.object({
  selected: z.array(
    z.object({
      index: z.number().describe("Index of the link in the list you were given."),
      reason: z.string(),
    }),
  ),
});

const WEBSITE_SYSTEM = `
You suggest the official website of a consumer brand. Only suggest a domain you are confident belongs to that brand; retailers, marketplaces and social media are wrong answers. If you are unsure, return an empty list. Each suggestion is checked against the live site before it is used.

${UNTRUSTED_INPUT_RULES}
`.trim();

const LINKS_SYSTEM = `
You pick links that lead directly to laboratory test reports (certificates of analysis, heavy metal or contaminant test results) for a brand's products. You see link text and URLs collected from the brand's own website.

${UNTRUSTED_INPUT_RULES}

Select only links that are very likely to be a downloadable test report file. Skip brochures, labels, safety data sheets, nutrition facts, terms, and blog posts. Select at most five, preferring the most recent.
`.trim();

/** Rejects anything that is not a public http(s) host. */
export function isSafePublicUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "80" && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".")) return false;
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|corp|test|invalid|example)$/.test(host);
}

export function registrableDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

export function sameSite(url: string, site: string): boolean {
  try {
    const a = registrableDomain(new URL(url).hostname);
    const b = registrableDomain(new URL(site).hostname);
    return a === b || a.endsWith(`.${b}`);
  } catch {
    return false;
  }
}

/** Pulls anchors out of HTML without executing or rendering anything. */
export function extractLinks(html: string, baseUrl: string): FoundLink[] {
  const links: FoundLink[] = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const url = new URL(m[1], baseUrl).toString();
      const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      links.push({ url, text, foundOn: baseUrl });
    } catch {
      // Unparseable href: skip.
    }
  }
  return links;
}

async function fetchText(url: string): Promise<string | null> {
  if (!isSafePublicUrl(url)) return null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": config.userAgent(), Accept: "text/html,text/plain" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    // A redirect may have left the public web or the original site.
    if (!res.ok || !isSafePublicUrl(res.url)) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)/.test(type)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return new TextDecoder().decode(buf.subarray(0, MAX_HTML_BYTES));
  } catch {
    return null;
  }
}

/** Minimal robots.txt reader: Disallow rules under "User-agent: *". */
export function parseRobots(robots: string): string[] {
  const disallowed: string[] = [];
  let applies = false;
  for (const line of robots.split(/\r?\n/)) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").split("#")[0].trim();
    if (key === "user-agent") applies = value === "*";
    else if (applies && key === "disallow" && value) disallowed.push(value);
  }
  return disallowed;
}

function allowedByRobots(url: string, disallowed: string[]): boolean {
  const path = new URL(url).pathname;
  return !disallowed.some((rule) => path.startsWith(rule.replace(/\*.*$/, "")));
}

async function confirmWebsite(domain: string, brandName: string): Promise<string | null> {
  const site = `https://${registrableDomain(domain.replace(/^https?:\/\//, "").split("/")[0])}`;
  const html = await fetchText(site);
  if (!html) return null;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const siteName = /property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ?? "";
  const brand = normaliseName(brandName);
  const confirmed =
    brand.length >= 3 &&
    (normaliseName(title).includes(brand) || normaliseName(siteName).includes(brand));
  return confirmed ? site : null;
}

export async function discoverBrandDocuments(
  llm: Llm,
  brand: { name: string; website: string | null },
  knownUrls: Set<string>,
): Promise<AgentResult<DiscoveryOutput>> {
  const usage = [];
  const steps: Step[] = [];
  let website = brand.website;
  let websiteMethod: DiscoveryOutput["websiteMethod"] = website ? "on_record" : null;

  if (!website) {
    const proposal = await llm.generate({
      name: "propose_website",
      tier: "fast",
      system: WEBSITE_SYSTEM,
      prompt: `Brand name: ${untrusted("catalog", brand.name)}`,
      schema: WebsiteSchema,
    });
    usage.push(proposal.usage);
    for (const candidate of proposal.output.candidates.slice(0, 3)) {
      const confirmed = await confirmWebsite(candidate, brand.name);
      steps.push({ kind: "tool", name: "confirm_website", detail: { candidate, confirmed: confirmed !== null } });
      if (confirmed) {
        website = confirmed;
        websiteMethod = "model_proposed_and_confirmed";
        break;
      }
    }
  }

  if (!website) {
    return { output: { website: null, websiteMethod: null, pagesFetched: 0, documents: [] }, usage, steps };
  }

  const robots = await fetchText(new URL("/robots.txt", website).toString());
  const disallowed = robots ? parseRobots(robots) : [];

  const found = new Map<string, FoundLink>();
  let pagesFetched = 0;
  for (const path of HINT_PATHS) {
    if (pagesFetched >= MAX_PAGES) break;
    const pageUrl = new URL(path, website).toString();
    if (!allowedByRobots(pageUrl, disallowed)) continue;
    const html = await fetchText(pageUrl);
    if (!html) continue;
    pagesFetched++;
    for (const link of extractLinks(html, pageUrl)) {
      const isFile = /\.(pdf|png|jpe?g)(\?|$)/i.test(link.url);
      if (!isFile || !isSafePublicUrl(link.url) || knownUrls.has(link.url)) continue;
      if (!LINK_HINT.test(link.url) && !LINK_HINT.test(link.text)) continue;
      found.set(link.url, link);
    }
  }
  steps.push({ kind: "tool", name: "crawl", detail: { website, pages_fetched: pagesFetched, links_found: found.size } });

  const links = [...found.values()].slice(0, 60);
  if (links.length === 0) {
    return { output: { website, websiteMethod, pagesFetched, documents: [] }, usage, steps };
  }

  const pick = await llm.generate({
    name: "select_links",
    tier: "fast",
    system: LINKS_SYSTEM,
    prompt: [
      `Brand: ${untrusted("catalog", brand.name)}`,
      "Links found on the brand's website:",
      untrusted("website", JSON.stringify(links.map((l, index) => ({ index, url: l.url, text: l.text })), null, 2)),
    ].join("\n\n"),
    schema: LinksSchema,
  });
  usage.push(pick.usage);

  const documents = pick.output.selected
    .filter((s) => Number.isInteger(s.index) && s.index >= 0 && s.index < links.length)
    .slice(0, 5)
    .map((s) => ({ url: links[s.index].url, reason: s.reason }));

  return { output: { website, websiteMethod, pagesFetched, documents }, usage, steps };
}
