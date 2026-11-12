import Link from "next/link";
import { actorLabel, eventLabel, formatDateTime, type LedgerEvent, shortHash } from "@/lib/format";

export function EventRow({ event }: { event: LedgerEvent }) {
  return (
    <Link
      href={`/records/${event.seq}`}
      className="flex items-baseline gap-4 rounded-2xl px-4 py-3 hover:bg-neutral-100"
    >
      <span className="w-14 shrink-0 font-mono text-[13px] text-neutral-500">#{event.seq}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{eventLabel(event.event_type)}</span>
        <span className="block text-sm text-neutral-600">
          By {actorLabel(event.actor)} · {formatDateTime(event.occurred_at)}
        </span>
      </span>
      <span className="hidden shrink-0 font-mono text-[13px] text-neutral-400 sm:block">{shortHash(event.hash)}</span>
    </Link>
  );
}
