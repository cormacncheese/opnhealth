"use client";

import { useState } from "react";
import { QuietButton } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { browserClient } from "@/lib/supabase/browser";

const WINDOW = 2000;

type Result =
  | { kind: "intact"; from: number; to: number }
  | { kind: "broken"; seq: number }
  | { kind: "error" };

/** Asks the database to recompute the hash chain over the most recent entries. */
export function VerifyLedger() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function verify() {
    setBusy(true);
    setResult(null);
    const supabase = browserClient();
    const head = await supabase.from("events").select("seq").order("seq", { ascending: false }).limit(1).maybeSingle();
    if (head.error || !head.data) {
      setBusy(false);
      setResult({ kind: "error" });
      return;
    }
    const to = head.data.seq;
    const from = Math.max(1, to - WINDOW + 1);
    const check = await supabase.rpc("verify_ledger", { from_seq: from, to_seq: to });
    setBusy(false);
    if (check.error) setResult({ kind: "error" });
    else if (check.data === null) setResult({ kind: "intact", from, to });
    else setResult({ kind: "broken", seq: check.data });
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <QuietButton type="button" onClick={verify} disabled={busy}>
        {busy ? "Checking" : "Check the chain"}
      </QuietButton>
      <p className="text-sm" aria-live="polite">
        {result?.kind === "intact" && (
          <span className="status-line text-emerald-800">
            Entries {formatNumber(result.from)} to {formatNumber(result.to)} are intact.
          </span>
        )}
        {result?.kind === "broken" && (
          <span className="status-line text-red-800">Entry #{result.seq} does not match its hash.</span>
        )}
        {result?.kind === "error" && <span className="status-line text-red-800">The check could not be run. Try again.</span>}
      </p>
    </div>
  );
}
