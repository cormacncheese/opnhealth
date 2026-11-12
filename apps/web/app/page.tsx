import { FileUp, ScrollText } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ActivityFeed } from "@/components/activity-feed";
import { ProductSearch } from "@/components/product-search";
import { Section } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { publicClient } from "@/lib/supabase/public";

export default function Home() {
  return (
    <>
      <div className="rounded-[28px] bg-neutral-100 px-6 pb-8 pt-12 sm:px-10">
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight">An open record of what is in the products you buy.</h1>
        <p className="mt-4 max-w-xl text-neutral-600">
          Lab reports and public data on consumer products, reviewed by AI agents. Every source, every agent
          decision and every correction is public.
        </p>
        <div className="mt-8">
          <ProductSearch floating />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Link
          href="/submit"
          className="flex h-24 flex-col items-center justify-center gap-2.5 rounded-[22px] bg-neutral-100 text-base font-semibold"
        >
          <FileUp size={22} aria-hidden />
          Submit a report
        </Link>
        <Link
          href="/records"
          className="flex h-24 flex-col items-center justify-center gap-2.5 rounded-[22px] bg-neutral-100 text-base font-semibold"
        >
          <ScrollText size={22} aria-hidden />
          Browse the ledger
        </Link>
      </div>

      <Suspense fallback={<div className="mt-8 h-16" />}>
        <Totals />
      </Suspense>

      <Section title="Latest activity" aside="Updates live">
        <ActivityFeed />
      </Section>
    </>
  );
}

async function Totals() {
  const supabase = publicClient();
  const [products, reports, ledger] = await Promise.all([
    supabase.from("products").select("id", { count: "estimated", head: true }),
    supabase.from("submissions").select("id", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("events").select("seq").order("seq", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (products.error || reports.error || ledger.error) return null;

  const totals = [
    { label: "Products tracked", value: products.count ?? 0 },
    { label: "Lab reports published", value: reports.count ?? 0 },
    { label: "Ledger entries", value: ledger.data?.seq ?? 0 },
  ];
  return (
    <dl className="mt-8 grid grid-cols-3 gap-4">
      {totals.map((t) => (
        <div key={t.label}>
          <dd className="text-2xl font-semibold tracking-tight">{formatNumber(t.value)}</dd>
          <dt className="text-sm text-neutral-600">{t.label}</dt>
        </div>
      ))}
    </dl>
  );
}
