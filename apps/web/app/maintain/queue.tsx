"use client";

import { RequireUser } from "@/components/require-user";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Empty, ErrorNote, fieldClass, Loading, Panel, QuietButton, Section } from "@/components/ui";
import { formatDate, reasonLabel, RELATIONSHIP } from "@/lib/format";
import { browserClient } from "@/lib/supabase/browser";

const ORIGINALS_BUCKET = "coa-originals";
const EXTENSION: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

async function load(userId: string) {
  const supabase = browserClient();
  const maintainer = await supabase.from("maintainers").select("user_id").eq("user_id", userId).maybeSingle();
  if (maintainer.error) throw new Error(maintainer.error.message);
  if (!maintainer.data) return null;

  const [submissions, disputes, claims, controls] = await Promise.all([
    supabase
      .from("submissions")
      .select(
        "id, relationship, created_at, products!submissions_product_id_fkey(name), documents(sha256, mime_type), review_decisions(stage, outcome, reason_codes, created_at), coa_reports(id, created_at)",
      )
      .eq("status", "escalated")
      .order("created_at"),
    supabase
      .from("disputes")
      .select("id, submission_id, category, status, created_at, dispute_details(relationship, reason, evidence_url)")
      .in("status", ["escalated", "open", "reopened"])
      .order("created_at"),
    supabase
      .from("brand_members")
      .select("id, email_domain, attempts, note, created_at, brands(name, website)")
      .eq("status", "pending")
      .order("created_at"),
    supabase.from("pipeline_controls").select("pipeline, paused, paused_reason").eq("paused", true),
  ]);
  const error = submissions.error ?? disputes.error ?? claims.error ?? controls.error;
  if (error) throw new Error(error.message);
  return {
    submissions: submissions.data ?? [],
    disputes: disputes.data ?? [],
    claims: claims.data ?? [],
    paused: controls.data ?? [],
  };
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

function QueueInner({ userId }: { userId: string }) {
  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    load(userId).then(setData, () => setFailed(true));
  }, [userId]);
  useEffect(refresh, [refresh]);

  if (failed) return <Empty>The queue could not be loaded. Refresh to try again.</Empty>;
  if (data === undefined) return <Loading lines={3} />;
  if (data === null) return <Empty>This account is not a maintainer. Maintainers are added by the project&apos;s operators.</Empty>;

  return (
    <>
      {data.paused.map((p) => (
        <p key={p.pipeline} role="status" className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The {p.pipeline} pipeline is paused{p.paused_reason ? `: ${p.paused_reason}` : "."}
        </p>
      ))}

      <Section title="Reports waiting for a decision" aside={`${data.submissions.length}`}>
        {data.submissions.length === 0 ? (
          <Empty>No reports are waiting.</Empty>
        ) : (
          <div className="space-y-3">
            {data.submissions.map((s) => {
              const last = [...s.review_decisions].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
              const report = [...s.coa_reports].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
              return (
                <Panel key={s.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/submissions/${s.id}`} className="font-semibold underline">
                      {s.products?.name ?? "Product not identified"}
                    </Link>
                    <span className="text-sm text-neutral-600">
                      From {RELATIONSHIP[s.relationship]} · {formatDate(s.created_at)}
                    </span>
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {last?.reason_codes.map((code) => (
                      <li key={code}>
                        <Badge tone="warn">{reasonLabel(code)}</Badge>
                      </li>
                    ))}
                  </ul>
                  <OriginalLink sha256={s.documents?.sha256} mime={s.documents?.mime_type} />
                  <DecisionForm
                    submissionId={s.id}
                    coaReportId={report?.id ?? null}
                    canPublish={Boolean(report)}
                    onDone={refresh}
                  />
                </Panel>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Disputes" aside={`${data.disputes.length}`}>
        {data.disputes.length === 0 ? (
          <Empty>No disputes are open.</Empty>
        ) : (
          <div className="space-y-3">
            {data.disputes.map((d) => {
              const detail = Array.isArray(d.dispute_details) ? d.dispute_details[0] : d.dispute_details;
              return (
                <Panel key={d.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/submissions/${d.submission_id}`} className="font-semibold capitalize underline">
                      {d.category.replaceAll("_", " ")}
                    </Link>
                    <span className="text-sm text-neutral-600">
                      {d.status === "escalated" ? "Sent to you by the dispute agent" : "With the dispute agent"} ·{" "}
                      {formatDate(d.created_at)}
                    </span>
                  </div>
                  {detail && (
                    <>
                      <p className="mt-3 whitespace-pre-wrap text-neutral-700">{detail.reason}</p>
                      <p className="mt-2 text-sm text-neutral-600">
                        From: {detail.relationship}
                        {detail.evidence_url && (
                          <>
                            {" · "}
                            <a href={detail.evidence_url} className="underline" rel="noreferrer nofollow">
                              Evidence link
                            </a>
                          </>
                        )}
                      </p>
                    </>
                  )}
                  {d.status === "escalated" && (
                    <DecisionForm submissionId={d.submission_id} coaReportId={null} disputeId={d.id} canPublish onDone={refresh} />
                  )}
                </Panel>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Brand claims" aside={`${data.claims.length}`}>
        {data.claims.length === 0 ? (
          <Empty>No brand claims are pending.</Empty>
        ) : (
          <div className="space-y-3">
            {data.claims.map((c) => (
              <Panel key={c.id}>
                <p className="font-semibold">{c.brands?.name}</p>
                <p className="mt-1 text-sm text-neutral-600">
                  Claimant&apos;s email domain: {c.email_domain ?? "unknown"} · Brand website:{" "}
                  {c.brands?.website ?? "not confirmed"} · {c.attempts} automatic {c.attempts === 1 ? "check" : "checks"} so far
                </p>
                {c.note && <p className="mt-1 text-sm text-neutral-600">{c.note}</p>}
                <ClaimButtons claimId={c.id} brand={c.brands?.name ?? "this brand"} onDone={refresh} />
              </Panel>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

/** Opens the private original through a short-lived signed link. */
function OriginalLink({ sha256, mime }: { sha256?: string; mime?: string }) {
  const [error, setError] = useState(false);
  const extension = mime ? EXTENSION[mime] : undefined;
  if (!sha256 || !extension) return null;

  async function open() {
    setError(false);
    const { data, error } = await browserClient()
      .storage.from(ORIGINALS_BUCKET)
      .createSignedUrl(`${sha256}.${extension}`, 120);
    if (error || !data) setError(true);
    else window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <p className="mt-3 text-sm">
      <button type="button" className="font-medium underline" onClick={open}>
        Open the original document
      </button>
      {error && <span className="ml-2 text-red-800">The original could not be opened.</span>}
    </p>
  );
}

const PUBLISH_REASONS = ["results_verified", "lab_accreditation_confirmed", "dispute_not_supported"];
const REJECT_REASONS = [
  "not_a_test_report",
  "no_measurements",
  "product_unresolved",
  "extraction_unreliable",
  "document_inconsistent",
  "suspected_tampering",
  "injection_attempt",
  "legal_claim",
  "dispute_upheld",
];

function DecisionForm(props: {
  submissionId: string;
  coaReportId: string | null;
  disputeId?: string;
  canPublish: boolean;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState<"publish" | "reject" | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = outcome === "publish" ? PUBLISH_REASONS : REJECT_REASONS;
  const publishLabel = props.disputeId ? "Keep published" : "Publish";
  const rejectLabel = props.disputeId ? "Withdraw the report" : "Do not publish";

  async function decide() {
    if (!outcome) return;
    setBusy(true);
    setError(null);
    const supabase = browserClient();
    const decision = await supabase
      .from("review_decisions")
      .insert({
        submission_id: props.submissionId,
        coa_report_id: props.coaReportId,
        dispute_id: props.disputeId ?? null,
        stage: "maintainer",
        outcome,
        reason_codes: reasons,
      })
      .select("id")
      .single();
    if (decision.error) {
      setBusy(false);
      setError("The decision was not recorded. Nothing has changed. Try again.");
      return;
    }
    const detail = await supabase
      .from("review_decision_details")
      .insert({ decision_id: decision.data.id, submission_id: props.submissionId, summary: summary.trim() });
    setBusy(false);
    if (detail.error) {
      setError("The decision was recorded, but your explanation was not saved.");
    }
    props.onDone();
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-3">
        <QuietButton
          type="button"
          disabled={!props.canPublish}
          aria-pressed={outcome === "publish"}
          className={`bg-white ${outcome === "publish" ? "ring-2 ring-inset ring-neutral-950" : ""}`}
          onClick={() => {
            setOutcome("publish");
            setReasons([]);
          }}
        >
          {publishLabel}
        </QuietButton>
        <QuietButton
          type="button"
          aria-pressed={outcome === "reject"}
          className={`bg-white ${outcome === "reject" ? "ring-2 ring-inset ring-neutral-950" : ""}`}
          onClick={() => {
            setOutcome("reject");
            setReasons([]);
          }}
        >
          {rejectLabel}
        </QuietButton>
      </div>
      {!props.canPublish && (
        <p className="text-sm text-neutral-600">
          No results were read from this document, so there is nothing to publish.
        </p>
      )}

      {outcome && (
        <>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Reasons (public)</legend>
            <div className="flex flex-wrap gap-2">
              {options.map((code) => {
                const on = reasons.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setReasons(on ? reasons.filter((r) => r !== code) : [...reasons, code])}
                    className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-neutral-950 text-white" : "bg-white"}`}
                  >
                    {reasonLabel(code)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">
              Explanation (public once published; do not include personal details)
            </span>
            <textarea
              className={`${fieldClass} min-h-24 bg-white focus:bg-white`}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={2000}
            />
          </label>
          <ErrorNote>{error}</ErrorNote>
          <Button type="button" onClick={decide} disabled={busy || reasons.length === 0 || summary.trim().length < 10}>
            Record decision: {outcome === "publish" ? publishLabel : rejectLabel}
          </Button>
        </>
      )}
    </div>
  );
}

function ClaimButtons({ claimId, brand, onDone }: { claimId: string; brand: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(status: "verified" | "rejected") {
    setBusy(true);
    setError(null);
    const { error } = await browserClient()
      .from("brand_members")
      .update({ status, method: "maintainer", note: status === "verified" ? "Confirmed by a maintainer" : "Declined by a maintainer" })
      .eq("id", claimId);
    setBusy(false);
    if (error) setError(`The claim for ${brand} was not updated. Try again.`);
    else onDone();
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-3">
        <QuietButton type="button" className="bg-white" disabled={busy} onClick={() => decide("verified")}>
          Verify
        </QuietButton>
        <QuietButton type="button" className="bg-white" disabled={busy} onClick={() => decide("rejected")}>
          Decline
        </QuietButton>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

export function Queue() {
  return <RequireUser reason="Sign in with a maintainer account to open the review queue.">{(user) => <QueueInner userId={user.id} />}</RequireUser>;
}
