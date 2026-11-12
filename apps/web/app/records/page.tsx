import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EventRow } from "@/components/event-row";
import { Empty, Loading, PageTitle } from "@/components/ui";
import type { LedgerEvent } from "@/lib/format";
import { publicClient } from "@/lib/supabase/public";
import { VerifyLedger } from "./verify-ledger";

export const metadata: Metadata = { title: "Ledger" };

const PAGE_SIZE = 50;

export default function RecordsPage({ searchParams }: PageProps<"/records">) {
  return (
    <>
      <PageTitle title="Ledger">
        Everything that happens here is written to this list: documents received, agent decisions, data
        synced from public sources, disputes and corrections. Entries are never edited or deleted. Each one
        carries a hash of the entry before it, so any change to history is detectable.
      </PageTitle>
      <VerifyLedger />
      <Suspense fallback={<Loading lines={6} />}>
        <Events searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Events({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { before } = await searchParams;
  const beforeSeq = typeof before === "string" && /^\d+$/.test(before) ? Number(before) : null;

  let query = publicClient()
    .from("events")
    .select("seq, occurred_at, event_type, subject_type, subject_id, actor, agent_run_id, payload, hash")
    .order("seq", { ascending: false })
    .limit(PAGE_SIZE);
  if (beforeSeq) query = query.lt("seq", beforeSeq);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load the ledger: ${error.message}`);
  const events = data as LedgerEvent[];
  if (events.length === 0) return <Empty>{beforeSeq ? "There are no earlier entries." : "Nothing has been recorded yet."}</Empty>;

  const oldest = events[events.length - 1].seq;
  return (
    <>
      <ul className="-mx-4 mt-6">
        {events.map((event) => (
          <li key={event.seq}>
            <EventRow event={event} />
          </li>
        ))}
      </ul>
      <div className="mt-6 flex gap-6 text-sm font-medium">
        {beforeSeq && (
          <Link href="/records" className="underline">
            Newest entries
          </Link>
        )}
        {oldest > 1 && (
          <Link href={`/records?before=${oldest}`} className="underline">
            Earlier entries
          </Link>
        )}
      </div>
    </>
  );
}
