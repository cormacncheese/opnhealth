// Receives a COA upload from a signed-in user, stores the original in the
// private bucket and starts the pipeline.

import { createClient } from "@supabase/supabase-js";
import { enqueue, getDb, recordEvent } from "../_shared/db.ts";
import { config, requireEnv } from "../_shared/env.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { sha256Hex, sniffFileKind } from "../_shared/pdf.ts";
import { createSupabaseStore, ORIGINALS_BUCKET } from "../_shared/pipeline/context.ts";

const DAILY_LIMIT = 10;
const RELATIONSHIPS = ["consumer", "brand", "lab"] as const;
type Relationship = (typeof RELATIONSHIPS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reply = (body: unknown, status = 200) => jsonResponse(body, status, corsHeaders);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Use POST" }, 405);

  // Who is submitting.
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user || user.is_anonymous) return reply({ error: "Sign in to submit a document." }, 401);

  // What they sent.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return reply({ error: "Send the file as multipart form data." }, 400);
  }
  const file = form.get("file");
  const relationship = String(form.get("relationship") ?? "") as Relationship;
  const productId = String(form.get("product_id") ?? "") || null;
  const productText = String(form.get("product_text") ?? "").trim().slice(0, 300) || null;
  const notes = String(form.get("notes") ?? "").trim().slice(0, 2000) || null;

  if (!(file instanceof File)) return reply({ error: "Attach a file." }, 400);
  if (!RELATIONSHIPS.includes(relationship)) return reply({ error: "Say how you relate to the product." }, 400);
  if (productId && !UUID.test(productId)) return reply({ error: "Unknown product." }, 400);
  if (!productId && !productText) return reply({ error: "Choose a product or describe it." }, 400);
  if (file.size > config.maxFileBytes) return reply({ error: "The file is larger than 10 MB." }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffFileKind(bytes);
  if (!mime) return reply({ error: "Upload a PDF, PNG or JPEG." }, 415);

  const sql = getDb();

  const [{ recent }] = await sql`
    select count(*)::int as recent from public.submission_owners
    where user_id = ${user.id} and created_at > now() - interval '24 hours'`;
  if (recent >= DAILY_LIMIT) {
    return reply({ error: `You can submit ${DAILY_LIMIT} documents a day. Try again tomorrow.` }, 429);
  }

  if (productId) {
    const [product] = await sql`select brand_id from public.products where id = ${productId}`;
    if (!product) return reply({ error: "Unknown product." }, 400);
    if (relationship === "brand") {
      const [member] = await sql`
        select 1 from public.brand_members
        where user_id = ${user.id} and brand_id = ${product.brand_id} and status = 'verified'`;
      if (!member) {
        return reply({ error: "Verify your brand account for this product's brand before submitting as the brand." }, 403);
      }
    }
  } else if (relationship === "brand") {
    return reply({ error: "Choose your product from the catalog to submit as the brand." }, 400);
  }

  // The same file is only processed once while an earlier copy is live.
  const sha256 = await sha256Hex(bytes);
  const [existing] = await sql`
    select s.id from public.submissions s
    join public.documents d on d.id = s.document_id
    where d.sha256 = ${sha256} and s.status not in ('rejected', 'failed', 'withdrawn', 'duplicate')
    order by s.created_at
    limit 1`;
  if (existing) return reply({ submission_id: existing.id, duplicate: true });

  const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const path = `${sha256}.${ext}`;
  await createSupabaseStore().upload(ORIGINALS_BUCKET, path, bytes, mime);

  // Only verified brand accounts get the brand source; a declared lab is not
  // verified yet, so it is recorded at consumer trust.
  const sourceSlug = relationship === "brand" ? "brand-submission" : "consumer-submission";

  const submissionId = await sql.begin(async (tx) => {
    const [source] = await tx`select id from public.sources where slug = ${sourceSlug}`;
    const [doc] = await tx`
      insert into public.documents (sha256, storage_bucket, storage_path, mime_type, byte_size)
      values (${sha256}, ${ORIGINALS_BUCKET}, ${path}, ${mime}, ${bytes.length})
      on conflict (sha256) do update set sha256 = excluded.sha256
      returning id`;
    const [submission] = await tx`
      insert into public.submissions (document_id, source_id, relationship, claimed_product_id)
      values (${doc.id}, ${source.id}, ${relationship}, ${productId})
      returning id`;
    await tx`insert into public.submission_owners (submission_id, user_id) values (${submission.id}, ${user.id})`;
    await tx`
      insert into public.submission_private (submission_id, claimed_product_text, notes)
      values (${submission.id}, ${productText}, ${notes})`;
    await recordEvent(tx, {
      type: "submission.received",
      subjectType: "submission",
      subjectId: submission.id,
      actor: "user",
      payload: { relationship, sha256, claimed_product_id: productId },
    });
    await enqueue(tx, "intake", { submission_id: submission.id });
    return submission.id as string;
  });

  return reply({ submission_id: submissionId, duplicate: false }, 201);
});
