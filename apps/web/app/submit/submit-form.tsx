"use client";

import { RequireUser } from "@/components/require-user";
import { Factory, FileUp, FlaskConical, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { type ProductHit, ProductSearch } from "@/components/product-search";
import { Button, ErrorNote, Field, fieldClass } from "@/components/ui";
import { browserClient } from "@/lib/supabase/browser";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/public";

const RELATIONSHIPS = [
  { id: "consumer", label: "I bought it", icon: ShoppingBag },
  { id: "brand", label: "I make it", icon: Factory },
  { id: "lab", label: "I tested it", icon: FlaskConical },
] as const;

type Relationship = (typeof RELATIONSHIPS)[number]["id"];

const MAX_BYTES = 10 * 1024 * 1024;
const tile = "flex h-24 flex-col items-center justify-center gap-2.5 rounded-[22px] bg-neutral-100 text-base font-semibold";

function SubmitFormInner() {
  const router = useRouter();
  const presetId = useSearchParams().get("product");
  const fileInput = useRef<HTMLInputElement>(null);

  const [product, setProduct] = useState<ProductHit | null>(null);
  const [describing, setDescribing] = useState(false);
  const [description, setDescription] = useState("");
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Arriving from a product page: start with that product chosen.
  useEffect(() => {
    if (!presetId) return;
    let cancelled = false;
    browserClient()
      .from("products")
      .select("id, name, brand_name, gtin")
      .eq("id", presetId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setProduct(data);
      });
    return () => {
      cancelled = true;
    };
  }, [presetId]);

  function chooseFile(chosen: File | undefined) {
    setError(null);
    if (!chosen) return;
    if (chosen.size > MAX_BYTES) {
      setFile(null);
      setError(`${chosen.name} is larger than 10 MB. Upload a smaller copy.`);
      return;
    }
    setFile(chosen);
  }

  const hasProduct = product !== null || description.trim().length > 2;
  const ready = hasProduct && relationship !== null && file !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || !file || !relationship) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await browserClient().auth.getSession();
      if (!data.session) throw new Error("Your session has ended. Sign in again to submit.");

      const form = new FormData();
      form.set("file", file);
      form.set("relationship", relationship);
      if (product) form.set("product_id", product.id);
      else form.set("product_text", description.trim());
      if (notes.trim()) form.set("notes", notes.trim());

      const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-coa`, {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: SUPABASE_KEY },
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.submission_id) {
        throw new Error(body?.error ?? "The upload did not go through. Your file was not submitted. Try again.");
      }
      router.push(`/submissions/${body.submission_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload did not go through. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-10">
      <fieldset>
        <legend className="mb-3 text-lg font-semibold">Which product is it for?</legend>
        {product ? (
          <div className="flex items-center justify-between gap-4 rounded-[22px] bg-neutral-100 p-5">
            <div>
              <p className="font-medium">{product.name}</p>
              <p className="text-sm text-neutral-600">{product.brand_name ?? "Brand not recorded"}</p>
            </div>
            <button type="button" className="text-sm font-medium underline" onClick={() => setProduct(null)}>
              Change
            </button>
          </div>
        ) : describing ? (
          <Field label="Describe the product" hint="Brand, product name and size, as printed on the pack.">
            <input
              className={fieldClass}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              autoFocus
              placeholder="Acme Organic Cocoa Powder, 250 g"
            />
            <button type="button" className="mt-2 text-sm font-medium underline" onClick={() => setDescribing(false)}>
              Search the catalog instead
            </button>
          </Field>
        ) : (
          <>
            <ProductSearch onPick={setProduct} />
            <button type="button" className="mt-3 text-sm font-medium underline" onClick={() => setDescribing(true)}>
              It is not in the catalog
            </button>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-lg font-semibold">How do you know this product?</legend>
        <div className="grid grid-cols-3 gap-3">
          {RELATIONSHIPS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={relationship === id}
              onClick={() => setRelationship(id)}
              className={`${tile} ${relationship === id ? "ring-2 ring-inset ring-neutral-950" : ""}`}
            >
              <Icon size={22} aria-hidden />
              {label}
            </button>
          ))}
        </div>
        {relationship === "brand" && (
          <p className="mt-3 text-sm text-neutral-600">
            Submitting as the brand needs a verified brand account.{" "}
            <Link href="/brands/claim" className="underline">
              Verify your brand
            </Link>
            . Reports from brands are published with a note that the brand supplied them.
          </p>
        )}
        {relationship === "lab" && (
          <p className="mt-3 text-sm text-neutral-600">
            Lab accounts are not verified yet, so this report is reviewed the same way as one from a consumer.
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-lg font-semibold">The report</legend>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          className="sr-only"
          onChange={(e) => chooseFile(e.target.files?.[0])}
        />
        <button type="button" onClick={() => fileInput.current?.click()} className={`${tile} w-full`}>
          <FileUp size={22} aria-hidden />
          <span className="max-w-full truncate px-4">{file ? file.name : "Choose a PDF or photo"}</span>
        </button>
        <p className="mt-3 text-sm text-neutral-600">
          PDF, PNG or JPEG, up to 10 MB. The original file stays private. If the report is published, people see
          the results and a text copy with names, signatures and contact details removed.
        </p>
      </fieldset>

      <Field label="Anything the reviewer should know (optional)" hint="Kept private. Not published.">
        <textarea
          className={`${fieldClass} min-h-24`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
        />
      </Field>

      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={!ready || busy} className="w-full sm:w-auto">
        {busy ? "Uploading" : "Submit for review"}
      </Button>
    </form>
  );
}

export function SubmitForm() {
  return <RequireUser reason="Sign in to submit a report, so you can follow its review and we can limit abuse.">{() => <SubmitFormInner />}</RequireUser>;
}
