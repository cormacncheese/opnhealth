import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink, Empty, Loading, Section } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { publicClient } from "@/lib/supabase/public";

export const metadata: Metadata = { title: "Brand" };

export default function BrandPage({ params }: PageProps<"/brands/[slug]">) {
  return (
    <Suspense fallback={<Loading lines={4} />}>
      <Brand params={params} />
    </Suspense>
  );
}

async function Brand({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = publicClient();

  const brand = await supabase.from("brands").select("id, slug, name, website, last_crawled_at").eq("slug", slug).maybeSingle();
  if (brand.error) throw new Error(`Could not load this brand: ${brand.error.message}`);
  if (!brand.data) notFound();
  const b = brand.data;

  const [products, reports] = await Promise.all([
    supabase.from("products").select("id, name, gtin", { count: "exact" }).eq("brand_id", b.id).order("name").limit(200),
    supabase
      .from("submissions")
      .select("id, products!submissions_product_id_fkey!inner(brand_id)", { count: "exact", head: true })
      .eq("status", "published")
      .eq("products.brand_id", b.id),
  ]);
  if (products.error || reports.error) throw new Error("Could not load this brand's products.");

  return (
    <>
      <div className="mb-8">
        <p className="text-neutral-600">Brand</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{b.name}</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {[
            `${products.count ?? 0} ${products.count === 1 ? "product" : "products"}`,
            `${reports.count ?? 0} published lab ${reports.count === 1 ? "report" : "reports"}`,
            b.last_crawled_at && `website last checked for reports ${formatDate(b.last_crawled_at)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {b.website && (
          <p className="mt-1 text-sm">
            <a href={b.website} className="underline" rel="noreferrer">
              {b.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          </p>
        )}
        <ButtonLink href={`/brands/claim?brand=${b.slug}`} className="mt-5">
          I work for this brand
        </ButtonLink>
      </div>

      <Section title="Products" aside={(products.count ?? 0) > 200 ? "First 200 shown" : undefined}>
        {products.data.length === 0 ? (
          <Empty>No products are recorded for this brand yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {products.data.map((p) => (
              <li key={p.id}>
                <Link href={`/products/${p.id}`} className="block rounded-2xl bg-neutral-100 px-4 py-3 hover:bg-neutral-200/70">
                  <span className="block font-medium">{p.name}</span>
                  {p.gtin && <span className="block text-sm text-neutral-600">{p.gtin}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
