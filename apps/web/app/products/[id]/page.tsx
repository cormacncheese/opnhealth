import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, ButtonLink, Empty, Loading, Panel, Section, type Tone } from "@/components/ui";
import { ACCREDITATION, formatDate, formatNumber, formatResult, RELATIONSHIP } from "@/lib/format";
import { publicClient } from "@/lib/supabase/public";
import { type Comparison, compareToLimit, limitApplies } from "@core/limits.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ProductPage({ params }: PageProps<"/products/[id]">) {
  return (
    <Suspense fallback={<Loading lines={5} />}>
      <Product params={params} />
    </Suspense>
  );
}

const NUTRIENTS: [string, string, string][] = [
  ["energy_kcal", "Energy", "kcal"],
  ["protein_g", "Protein", "g"],
  ["fat_g", "Fat", "g"],
  ["saturated_fat_g", "Saturated fat", "g"],
  ["carbohydrate_g", "Carbohydrate", "g"],
  ["sugars_g", "Sugars", "g"],
  ["fibre_g", "Fibre", "g"],
  ["sodium_g", "Sodium", "g"],
];

const COMPARISON: Record<Exclude<Comparison, "not_comparable">, { tone: Tone; label: string }> = {
  above: { tone: "bad", label: "Above" },
  within: { tone: "good", label: "Within" },
  inconclusive: { tone: "warn", label: "Cannot be compared with" },
};

async function Product({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = publicClient();
  const [product, measurements, limits, recalls, observations] = await Promise.all([
    supabase.from("products").select("*, brands(slug, name)").eq("id", id).maybeSingle(),
    supabase
      .from("published_measurements")
      .select("*")
      .eq("product_id", id)
      .order("report_date", { ascending: false, nullsFirst: false }),
    supabase.from("reference_limits").select("*"),
    supabase.from("recall_products").select("confidence, recalls(*)").eq("product_id", id),
    supabase
      .from("observations")
      .select("id, attribute, value, external_ref, observed_at, sources(name, url, license)")
      .eq("entity_id", id)
      .order("observed_at", { ascending: false })
      .limit(50),
  ]);
  const failed = product.error ?? measurements.error ?? limits.error ?? recalls.error ?? observations.error;
  if (failed) throw new Error(`Could not load this product: ${failed.message}`);
  if (!product.data) notFound();

  const p = product.data;
  const categories = [p.category, ...(p.categories ?? [])].filter((c): c is string => Boolean(c));
  const applicable = (limits.data ?? []).filter((l) => limitApplies(l, categories));

  // Newest result first within each analyte.
  const byAnalyte = new Map<string, NonNullable<typeof measurements.data>>();
  for (const m of measurements.data ?? []) {
    const key = m.analyte_name ?? m.analyte_name_raw ?? "Unnamed analyte";
    byAnalyte.set(key, [...(byAnalyte.get(key) ?? []), m]);
  }

  const reports = new Map<string, NonNullable<typeof measurements.data>[number]>();
  for (const m of measurements.data ?? []) if (m.submission_id && !reports.has(m.submission_id)) reports.set(m.submission_id, m);

  const nutrition = observations.data?.find((o) => o.attribute === "nutrition");
  const nutritionValues = (nutrition?.value ?? {}) as Record<string, number>;
  const catalogSources = (observations.data ?? []).filter((o) => o.attribute !== "coa_published");

  return (
    <>
      <div className="mb-8">
        {p.brands ? (
          <Link href={`/brands/${p.brands.slug}`} className="text-neutral-600 hover:underline">
            {p.brands.name}
          </Link>
        ) : (
          <span className="text-neutral-600">{p.brand_name ?? "Brand not recorded"}</span>
        )}
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{p.name}</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {[p.gtin && `Barcode ${p.gtin}`, p.serving_size && `Serving ${p.serving_size}`].filter(Boolean).join(" · ")}
        </p>
        <ButtonLink href={`/submit?product=${p.id}`} className="mt-5">
          Submit a lab report
        </ButtonLink>
      </div>

      {(recalls.data?.length ?? 0) > 0 && (
        <Section title="Recalls">
          <div className="space-y-3">
            {recalls.data!.map(({ recalls: r }) => (
              <div key={r.id} className="rounded-[22px] bg-red-50 p-5">
                <p className="font-medium text-red-950">{r.reason}</p>
                <p className="mt-1 text-sm text-red-900">
                  {[r.firm, r.classification, r.recall_date && formatDate(r.recall_date), r.status]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="mt-2 text-sm text-red-900">
                  Matched to this product from the recall notice by an agent.{" "}
                  {r.url && (
                    <a href={r.url} className="underline" rel="noreferrer">
                      Read the notice
                    </a>
                  )}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Lab results" aside={reports.size > 0 ? `From ${reports.size} published ${reports.size === 1 ? "report" : "reports"}` : undefined}>
        {byAnalyte.size === 0 ? (
          <Empty>
            No lab reports have been published for this product yet. If you have a certificate of analysis for
            it, you can submit it for review.
          </Empty>
        ) : (
          <div className="space-y-3">
            {[...byAnalyte.entries()].map(([name, rows]) => {
              const latest = rows[0];
              const compared = applicable
                .map((limit) => ({ limit, result: compareToLimit(latest as Parameters<typeof compareToLimit>[0], limit) }))
                .filter((c) => c.result !== "not_comparable");
              return (
                <Panel key={name}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="font-semibold">{name}</h3>
                    <p className="text-lg font-semibold">{formatResult(latest)}</p>
                  </div>
                  <p className="mt-1 text-sm text-neutral-600">
                    <Link href={`/submissions/${latest.submission_id}`} className="underline">
                      Report dated {formatDate(latest.report_date)}
                    </Link>
                    {latest.lab_name && ` · ${latest.lab_name}`}
                    {latest.lot_number && ` · Lot ${latest.lot_number}`}
                    {rows.length > 1 && ` · ${rows.length - 1} earlier ${rows.length === 2 ? "result" : "results"}`}
                  </p>
                  {compared.map(({ limit, result }) => {
                    const c = COMPARISON[result as keyof typeof COMPARISON];
                    return (
                      <p key={limit.id} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                        <Badge tone={c.tone}>{c.label}</Badge>
                        <span>
                          the {limit.authority} {limit.kind.replaceAll("_", " ")} of {formatNumber(limit.limit_value)}{" "}
                          {limit.unit}
                          {limit.applies_to && ` for ${limit.applies_to}`}
                        </span>
                        {limit.source_url && (
                          <a href={limit.source_url} className="text-neutral-500 underline" rel="noreferrer">
                            Source
                          </a>
                        )}
                      </p>
                    );
                  })}
                </Panel>
              );
            })}
          </div>
        )}
      </Section>

      {reports.size > 0 && (
        <Section title="Published reports">
          <ul className="space-y-3">
            {[...reports.values()].map((r) => (
              <li key={r.submission_id}>
                <Link href={`/submissions/${r.submission_id}`} className="block rounded-[22px] bg-neutral-100 p-5 hover:bg-neutral-200/70">
                  <span className="block font-medium">
                    {r.lab_name ?? "Lab not identified"} · {formatDate(r.report_date)}
                  </span>
                  <span className="mt-1 block text-sm text-neutral-600">
                    Submitted by {RELATIONSHIP[r.relationship ?? ""] ?? "an unknown party"} ·{" "}
                    {ACCREDITATION[r.lab_accreditation_status ?? "unknown"]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {nutrition && (
        <Section title="Nutrition per 100 g" aside={nutrition.sources?.name}>
          <Panel>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              {NUTRIENTS.filter(([key]) => nutritionValues[key] != null).map(([key, label, unit]) => (
                <div key={key}>
                  <dt className="text-sm text-neutral-600">{label}</dt>
                  <dd className="font-medium">
                    {formatNumber(nutritionValues[key])} {unit}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </Section>
      )}

      {p.ingredients_text && (
        <Section title="Ingredients">
          <p className="text-neutral-700">{p.ingredients_text}</p>
        </Section>
      )}

      <Section title="Where this data comes from">
        {catalogSources.length === 0 ? (
          <Empty>This product was created from a submitted report and has no public catalog record yet.</Empty>
        ) : (
          <ul className="space-y-2 text-sm">
            {catalogSources.map((o) => (
              <li key={o.id} className="flex flex-wrap gap-x-2 text-neutral-700">
                <span className="font-medium">{o.attribute === "nutrition" ? "Nutrition" : "Catalog record"}</span>
                <span>
                  from{" "}
                  {o.sources?.url ? (
                    <a href={o.sources.url} className="underline" rel="noreferrer">
                      {o.sources.name}
                    </a>
                  ) : (
                    o.sources?.name
                  )}
                </span>
                <span className="text-neutral-500">
                  {[o.sources?.license, `seen ${formatDate(o.observed_at)}`].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
