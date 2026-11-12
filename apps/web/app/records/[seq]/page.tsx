import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading, Mono, Panel, Section } from "@/components/ui";
import { actorLabel, eventLabel, formatDateTime, subjectHref } from "@/lib/format";
import { publicClient } from "@/lib/supabase/public";

export const metadata: Metadata = { title: "Ledger entry" };

export default function RecordPage({ params }: PageProps<"/records/[seq]">) {
  return (
    <Suspense fallback={<Loading lines={3} />}>
      <Entry params={params} />
    </Suspense>
  );
}

async function Entry({ params }: { params: Promise<{ seq: string }> }) {
  const { seq } = await params;
  if (!/^\d{1,15}$/.test(seq)) notFound();

  const { data: event, error } = await publicClient().from("events").select("*").eq("seq", Number(seq)).maybeSingle();
  if (error) throw new Error(`Could not load this entry: ${error.message}`);
  if (!event) notFound();

  const href = subjectHref(event.subject_type, event.subject_id);
  return (
    <>
      <p className="font-mono text-sm text-neutral-500">Ledger entry #{event.seq}</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{eventLabel(event.event_type)}</h1>
      <p className="mt-2 text-neutral-600">
        Recorded by {actorLabel(event.actor)} on {formatDateTime(event.occurred_at)}
      </p>

      <div className="mt-5 flex flex-wrap gap-5 text-sm font-medium">
        {href && (
          <Link href={href} className="underline">
            View the {event.subject_type}
          </Link>
        )}
        {event.agent_run_id && (
          <Link href={`/records/runs/${event.agent_run_id}`} className="underline">
            View the agent run
          </Link>
        )}
        {event.seq > 1 && (
          <Link href={`/records/${event.seq - 1}`} className="underline">
            Previous entry
          </Link>
        )}
        <Link href={`/records/${event.seq + 1}`} className="underline">
          Next entry
        </Link>
      </div>

      <Section title="Entry">
        <Panel>
          <dl className="space-y-3">
            {[
              ["Type", event.event_type],
              ["Subject", `${event.subject_type} ${event.subject_id}`],
              ["Actor", event.actor],
              ["Recorded at", event.occurred_at],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-neutral-600">{label}</dt>
                <dd>
                  <Mono>{value}</Mono>
                </dd>
              </div>
            ))}
            <div>
              <dt className="text-sm text-neutral-600">Details</dt>
              <dd>
                <pre className="whitespace-pre-wrap break-all font-mono text-[13px]">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </dd>
            </div>
          </dl>
        </Panel>
      </Section>

      <Section title="Hash chain">
        <Panel>
          <dl className="space-y-3">
            <div>
              <dt className="text-sm text-neutral-600">Hash of the previous entry</dt>
              <dd>
                <Mono>{event.prev_hash}</Mono>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-neutral-600">Hash of this entry</dt>
              <dd>
                <Mono>{event.hash}</Mono>
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-neutral-600">
            The hash is the SHA-256 of the previous hash, entry number, time, type, subject, actor, agent run
            and details, joined with “|”. Changing any earlier entry changes every hash after it. The exact
            formula is in the{" "}
            <Link href="/data" className="underline">
              data documentation
            </Link>
            .
          </p>
        </Panel>
      </Section>
    </>
  );
}
