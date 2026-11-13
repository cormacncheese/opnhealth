import Link from "next/link";
import { Suspense } from "react";
import { ProductCard, type ProductCardData } from "@/components/product-card";
import { ProductSearch } from "@/components/product-search";
import { Empty } from "@/components/ui";
import { publicClient } from "@/lib/supabase/public";

const SHOWN = 30;

export default function Home() {
  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">What is in the products you buy</h1>
        <p className="mt-2 text-neutral-600">
          Lab reports and public data, reviewed by AI agents, with every decision on the public record.
        </p>
        <div className="mt-6">
          <ProductSearch floating />
        </div>
      </div>

      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">New and updated</h2>
        <Link href="/records" className="text-sm text-neutral-600 hover:underline">
          Live activity
        </Link>
      </div>
      <Suspense fallback={<GridSkeleton />}>
        <LatestProducts />
      </Suspense>
    </>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3" aria-busy="true" aria-label="Loading products">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i}>
          <div className="aspect-square animate-pulse rounded-[22px] bg-neutral-100" />
          <div className="mt-3 h-4 w-2/3 animate-pulse rounded bg-neutral-100" />
        </div>
      ))}
    </div>
  );
}

async function LatestProducts() {
  const supabase = publicClient();
  const columns = "id, name, brand_name, category, categories, image_url, created_at, updated_at";
  // Products with a photo first; many catalog sources have none.
  const [withImages, latest] = await Promise.all([
    supabase.from("products").select(columns).not("image_url", "is", null).order("updated_at", { ascending: false }).limit(SHOWN),
    supabase.from("products").select(columns).order("updated_at", { ascending: false }).limit(SHOWN),
  ]);
  const error = withImages.error ?? latest.error;
  if (error) throw new Error(`Could not load products: ${error.message}`);
  const seen = new Set<string>();
  const products = [...(withImages.data ?? []), ...(latest.data ?? [])]
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .slice(0, SHOWN);
  if (!products?.length) return <Empty>No products have been added yet. The first sync runs within ten minutes.</Empty>;

  const ids = products.map((p) => p.id);
  const [reports, recalls] = await Promise.all([
    supabase.from("published_measurements").select("product_id, submission_id").in("product_id", ids),
    supabase.from("recall_products").select("product_id").in("product_id", ids),
  ]);

  const reportsByProduct = new Map<string, Set<string>>();
  for (const r of reports.data ?? []) {
    if (!r.product_id || !r.submission_id) continue;
    reportsByProduct.set(r.product_id, (reportsByProduct.get(r.product_id) ?? new Set()).add(r.submission_id));
  }
  const recalled = new Set((recalls.data ?? []).map((r) => r.product_id));

  const cards: ProductCardData[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    brandName: p.brand_name,
    category: p.category ?? p.categories?.[0] ?? null,
    imageUrl: p.image_url,
    reports: reportsByProduct.get(p.id)?.size ?? 0,
    recalled: recalled.has(p.id),
    // Created and last changed within the same minute.
    isNew: Math.abs(new Date(p.updated_at).getTime() - new Date(p.created_at).getTime()) < 60_000,
  }));

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
      {cards.map((card, i) => (
        <ProductCard key={card.id} product={card} eager={i < 6} />
      ))}
    </div>
  );
}
