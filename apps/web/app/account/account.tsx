"use client";

import { RequireUser } from "@/components/require-user";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, ButtonLink, Empty, Loading, QuietButton, Section, statusTone } from "@/components/ui";
import { formatDate, STATUS } from "@/lib/format";
import { browserClient } from "@/lib/supabase/browser";

async function load(userId: string) {
  const supabase = browserClient();
  const [submissions, disputes, maintainer] = await Promise.all([
    supabase
      .from("submission_owners")
      .select("created_at, submissions(id, status, products!submissions_product_id_fkey(name))")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    // Row level security returns only the details of disputes this user opened.
    supabase
      .from("dispute_details")
      .select("created_at, resolution, disputes(id, submission_id, category, status)")
      .order("created_at", { ascending: false }),
    supabase.from("maintainers").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  const error = submissions.error ?? disputes.error ?? maintainer.error;
  if (error) throw new Error(error.message);
  return { submissions: submissions.data ?? [], disputes: disputes.data ?? [], isMaintainer: Boolean(maintainer.data) };
}

type Loaded = Awaited<ReturnType<typeof load>>;

function AccountInner({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load(userId).then(
      (loaded) => !cancelled && setData(loaded),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function signOut() {
    await browserClient().auth.signOut();
    router.replace("/");
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-neutral-700">Signed in as {email}</p>
        <QuietButton type="button" onClick={signOut}>
          Sign out
        </QuietButton>
      </div>

      {failed && <Empty>Your account details could not be loaded. Refresh to try again.</Empty>}
      {!data && !failed && (
        <div className="mt-10">
          <Loading lines={3} />
        </div>
      )}

      {data && (
        <>
          {data.isMaintainer && (
            <Section title="Maintainer">
              <ButtonLink href="/maintain">Open the review queue</ButtonLink>
            </Section>
          )}

          <Section title="Your submissions">
            {data.submissions.length === 0 ? (
              <Empty>
                You have not submitted a report yet.{" "}
                <Link href="/submit" className="underline">
                  Submit one
                </Link>
              </Empty>
            ) : (
              <ul className="space-y-2">
                {data.submissions.map(({ submissions: s, created_at }) => (
                  <li key={s.id}>
                    <Link
                      href={`/submissions/${s.id}`}
                      className="flex items-center justify-between gap-4 rounded-2xl bg-neutral-100 px-4 py-3 hover:bg-neutral-200/70"
                    >
                      <span>
                        <span className="block font-medium">{s.products?.name ?? "Product not yet identified"}</span>
                        <span className="block text-sm text-neutral-600">Submitted {formatDate(created_at)}</span>
                      </span>
                      <Badge tone={statusTone(s.status)}>{STATUS[s.status]?.label ?? s.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Your disputes">
            {data.disputes.length === 0 ? (
              <p className="text-neutral-600">You have not opened a dispute.</p>
            ) : (
              <ul className="space-y-2">
                {data.disputes.map(({ disputes: d, created_at, resolution }) => (
                  <li key={d.id}>
                    <Link
                      href={`/submissions/${d.submission_id}`}
                      className="block rounded-2xl bg-neutral-100 px-4 py-3 hover:bg-neutral-200/70"
                    >
                      <span className="flex items-center justify-between gap-4">
                        <span className="font-medium capitalize">{d.category.replaceAll("_", " ")}</span>
                        <Badge tone={d.status === "upheld" ? "good" : d.status === "dismissed" ? "neutral" : "warn"}>
                          {d.status}
                        </Badge>
                      </span>
                      <span className="mt-1 block text-sm text-neutral-600">
                        Opened {formatDate(created_at)}
                        {resolution && ` · ${resolution}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Brand accounts">
            <Link href="/brands/claim" className="underline">
              Verify a brand or see your brand accounts
            </Link>
          </Section>
        </>
      )}
    </>
  );
}

export function Account() {
  return <RequireUser reason="Sign in to see your submissions and disputes.">{(user) => <AccountInner userId={user.id} email={user.email ?? ""} />}</RequireUser>;
}
