// Brand verification, recall matching and brand-website discovery against
// the local database. The web is replaced by a fake brand site.

import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Ctx } from "../supabase/functions/_shared/pipeline/context.ts";
import { drainQueue } from "../supabase/functions/_shared/pipeline/worker.ts";
import { makePdf, memoryStore, type Script, scriptedLlm } from "./helpers.ts";

const url = process.env.TEST_DATABASE_URL;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

function fakeResponse(target: string, body: BodyInit, type: string, status = 200): Response {
  const res = new Response(body, { status, headers: { "content-type": type } });
  Object.defineProperty(res, "url", { value: target });
  return res;
}

describe.skipIf(!url)("operations agents against the database", () => {
  let sql: postgres.Sql;
  const store = memoryStore();
  const tag = Math.random().toString(36).slice(2, 8);
  const domain = `acme${tag}.com`;
  let brandId: string;
  let productId: string;

  const ctx = (script: Script): Ctx => ({ sql, llm: scriptedLlm(script), store, now: () => new Date() });

  beforeAll(async () => {
    sql = postgres(url!, { max: 2, onnotice: () => {} });
    await sql`select cron.alter_job(jobid, active := false) from cron.job where jobname = 'dispatch-workers'`;
    for (const q of ["brand_verification", "monitor", "discovery", "intake"]) await sql`select pgmq.purge_queue(${q})`;
    const [source] = await sql`select id from public.sources where slug = 'openfoodfacts'`;
    const [p] = await sql`
      select private.create_product(${source.id}, ${`Dark Chocolate Bar ${tag}`}, ${`Acme ${tag}`}, null, '{}') as id`;
    productId = p.id;
    [{ brand_id: brandId }] = await sql`select brand_id from public.products where id = ${productId}`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await sql`select cron.alter_job(jobid, active := true) from cron.job where jobname = 'dispatch-workers'`;
    await sql?.end();
  });

  it("verifies a brand claim from a work email at the brand's domain", async () => {
    await sql`update public.brands set website = ${`https://www.${domain}`} where id = ${brandId}`;
    const userId = crypto.randomUUID();
    await sql`
      insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
      values (${userId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              ${`quality@${domain}`}, now())`;

    // Claimed through row level security, with forged fields the trigger must ignore.
    await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
      await tx`set local role authenticated`;
      await tx`insert into public.brand_members (brand_id) values (${brandId})`;
    });
    // Only maintainers may decide claims; row level security makes the claimant's own update a no-op.
    await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
      await tx`set local role authenticated`;
      await tx`update public.brand_members set status = 'verified', method = 'maintainer' where user_id = ${userId}`;
    });
    const [before] = await sql`select status from public.brand_members where user_id = ${userId}`;
    expect(before.status).toBe("pending");

    await drainQueue(ctx({}), "brand_verification", 5);
    const [claim] = await sql`select status, method from public.brand_members where user_id = ${userId}`;
    expect(claim).toEqual({ status: "verified", method: "email_domain" });
    const [event] = await sql`
      select actor from public.events where event_type = 'brand_claim.verified' and subject_id = ${brandId}`;
    expect(event.actor).toBe("agent:brand_verification");
  });

  it("links a recall notice to the product it names", async () => {
    const [source] = await sql`select id from public.sources where slug = 'openfda'`;
    const [recall] = await sql`
      insert into public.recalls (source_id, external_ref, firm, product_description, reason, classification, status)
      values (${source.id}, ${`test-${tag}`}, ${`Acme ${tag} Inc.`}, ${`Acme ${tag} Dark Chocolate Bar, 3.5 oz`},
              'Elevated lead levels', 'Class II', 'Ongoing')
      returning id`;
    // Older unmatched recalls from the real sync would otherwise take the batch.
    await sql`update public.recalls set matched_at = now() where matched_at is null and id <> ${recall.id}`;
    await sql`select pgmq.send('monitor', '{"task":"recalls"}'::jsonb)`;

    await drainQueue(
      ctx({
        match_recall: (req) => {
          const ids = req.prompt.match(UUID) ?? [];
          expect(ids).toContain(productId);
          return { matches: [{ product_id: productId, confidence: 0.95, rationale: "Same brand and product." }] };
        },
      }),
      "monitor",
      1,
    );

    const links = await sql`select product_id from public.recall_products where recall_id = ${recall.id}`;
    expect(links.map((l) => l.product_id)).toEqual([productId]);
    const [event] = await sql`select 1 from public.events where event_type = 'recall.matched' and subject_id = ${recall.id}`;
    expect(event).toBeTruthy();
  });

  it("finds a report published on the brand's site and sends it to intake", async () => {
    const pdf = await makePdf(["Certificate of Analysis", `Acme ${tag}`, "Lead 0.02 mg/kg"]);
    const site = `https://www.${domain}`;
    const pages: Record<string, () => Response> = {
      [`${site}/robots.txt`]: () => fakeResponse(`${site}/robots.txt`, "User-agent: *\nDisallow: /private", "text/plain"),
      [`${site}/`]: () =>
        fakeResponse(
          `${site}/`,
          `<title>Acme ${tag}</title><a href="/files/lead-test-results.pdf">Lab test results</a>
           <a href="/files/brochure.pdf">Brochure</a><a href="/private/coa.pdf">Internal COA</a>`,
          "text/html",
        ),
      [`${site}/files/lead-test-results.pdf`]: () =>
        fakeResponse(`${site}/files/lead-test-results.pdf`, pdf as BodyInit, "application/pdf"),
    };
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return pages[target]?.() ?? fakeResponse(target, "Not found", "text/html", 404);
    });

    await sql`select pgmq.send('discovery', ${sql.json({ brand_id: brandId })})`;
    await drainQueue(
      ctx({
        select_links: (req) => {
          // The brochure has no report wording and the robots-excluded link is never fetched.
          expect(req.prompt).toContain("lead-test-results.pdf");
          expect(req.prompt).not.toContain("brochure.pdf");
          expect(req.prompt).not.toContain("/private/");
          return { selected: [{ index: 0, reason: "A lab test report." }] };
        },
      }),
      "discovery",
      1,
    );

    const [doc] = await sql`
      select d.origin_url, s.relationship, s.status from public.documents d
      join public.submissions s on s.document_id = d.id
      where d.origin_url = ${`${site}/files/lead-test-results.pdf`}`;
    expect(doc).toMatchObject({ relationship: "crawler", status: "received" });
    const [queued] = await sql`select count(*)::int as n from pgmq.q_intake`;
    expect(queued.n).toBe(1);
    const [brand] = await sql`select last_crawled_at from public.brands where id = ${brandId}`;
    expect(brand.last_crawled_at).not.toBeNull();
    await sql`select pgmq.purge_queue('intake')`;
  });
});
