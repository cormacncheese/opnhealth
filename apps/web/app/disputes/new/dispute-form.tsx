"use client";

import { RequireUser } from "@/components/require-user";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button, Empty, ErrorNote, Field, fieldClass } from "@/components/ui";
import { browserClient } from "@/lib/supabase/browser";

const CATEGORIES = [
  ["factual_error", "A result does not match the report"],
  ["wrong_product", "The report is for a different product"],
  ["fraudulent_document", "The document is not genuine"],
  ["outdated", "The report is out of date"],
  ["legal", "A legal concern"],
  ["other", "Something else"],
] as const;

const RELATIONSHIPS = [
  ["consumer", "A consumer"],
  ["brand", "I work for the brand"],
  ["lab", "I work for the lab"],
  ["other", "Other"],
] as const;

const MIN_REASON = 20;

function DisputeFormInner() {
  const router = useRouter();
  const submissionId = useSearchParams().get("submission");
  const [category, setCategory] = useState<string>(CATEGORIES[0][0]);
  const [relationship, setRelationship] = useState<string>(RELATIONSHIPS[0][0]);
  const [reason, setReason] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!submissionId) {
    return (
      <Empty>
        Open a dispute from the report it is about. Find the product, open the report, then choose “Dispute
        this report”. <Link href="/" className="underline">Search products</Link>
      </Empty>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!submissionId) return;
    setBusy(true);
    setError(null);
    const supabase = browserClient();

    // If the explanation failed to save last time, finish that dispute rather than open a second.
    const dispute = savedId
      ? { data: { id: savedId }, error: null }
      : await supabase.from("disputes").insert({ submission_id: submissionId, category }).select("id").single();
    if (dispute.error) {
      setBusy(false);
      setError(
        /unresolved/i.test(dispute.error.message)
          ? "You already have several open disputes. Wait for one to be resolved before opening another."
          : /published/i.test(dispute.error.message)
            ? "Only published reports can be disputed, and this one is not published."
            : "The dispute was not saved. Try again.",
      );
      return;
    }

    setSavedId(dispute.data.id);

    const detail = await supabase.from("dispute_details").insert({
      dispute_id: dispute.data.id,
      relationship,
      reason: reason.trim(),
      evidence_url: evidenceUrl.trim() || null,
    });
    setBusy(false);
    if (detail.error) {
      setError("Your explanation was not saved, so the dispute cannot be reviewed yet. Submit again to retry.");
      return;
    }
    router.push(`/submissions/${submissionId}`);
  }

  const remaining = MIN_REASON - reason.trim().length;

  return (
    <form onSubmit={submit} className="space-y-6">
      <Field label="What is wrong?">
        <select className={fieldClass} value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Who are you in relation to this product?">
        <select className={fieldClass} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
          {RELATIONSHIPS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Explain what should change"
        hint={
          remaining > 0
            ? `Be specific: name the result, page or detail. At least ${remaining} more ${remaining === 1 ? "character" : "characters"}.`
            : "Be specific: name the result, page or detail that is wrong."
        }
      >
        <textarea
          className={`${fieldClass} min-h-36`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={5000}
          required
        />
      </Field>
      <Field label="Link to supporting evidence (optional)">
        <input
          className={fieldClass}
          type="url"
          value={evidenceUrl}
          onChange={(e) => setEvidenceUrl(e.target.value)}
          placeholder="https://"
        />
      </Field>
      {category === "legal" && (
        <p className="text-sm text-neutral-600">Legal concerns go straight to a human maintainer. The report stays published while they review it.</p>
      )}
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={busy || remaining > 0}>
        Open dispute
      </Button>
    </form>
  );
}

export function DisputeForm() {
  return <RequireUser reason="Sign in to open a dispute, so we can tell you the outcome.">{() => <DisputeFormInner />}</RequireUser>;
}
