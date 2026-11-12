"use client";

import { useEffect, useState } from "react";
import type { LedgerEvent } from "@/lib/format";
import { browserClient } from "@/lib/supabase/browser";
import { EventRow } from "./event-row";
import { Empty, Loading } from "./ui";

const COLUMNS = "seq, occurred_at, event_type, subject_type, subject_id, actor, agent_run_id, payload, hash";
const SHOWN = 15;

/** The newest ledger entries, updated as agents and connectors write new ones. */
export function ActivityFeed() {
  const [events, setEvents] = useState<LedgerEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = browserClient();
    let cancelled = false;

    const merge = (incoming: LedgerEvent[]) =>
      setEvents((current) => {
        const bySeq = new Map([...(current ?? []), ...incoming].map((e) => [e.seq, e]));
        return [...bySeq.values()].sort((a, b) => b.seq - a.seq).slice(0, SHOWN);
      });

    supabase
      .from("events")
      .select(COLUMNS)
      .order("seq", { ascending: false })
      .limit(SHOWN)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setFailed(true);
        else merge(data as LedgerEvent[]);
      });

    const channel = supabase
      .channel("ledger-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "events" }, (change) =>
        merge([change.new as LedgerEvent]),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  if (failed) return <Empty>The ledger could not be loaded. Refresh to try again.</Empty>;
  if (!events) return <Loading lines={4} />;
  if (events.length === 0) return <Empty>Nothing has been recorded yet.</Empty>;

  return (
    <ul className="-mx-4">
      {events.map((event) => (
        <li key={event.seq} className="status-line">
          <EventRow event={event} />
        </li>
      ))}
    </ul>
  );
}
