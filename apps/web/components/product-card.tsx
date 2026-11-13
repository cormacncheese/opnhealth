import { Package } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "./ui";

export interface ProductCardData {
  id: string;
  name: string;
  brandName: string | null;
  category: string | null;
  imageUrl: string | null;
  reports: number;
  recalled: boolean;
  isNew: boolean;
}

/** "en:cocoa-powders" reads as "Cocoa powders". */
function categoryLabel(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw.replace(/^[a-z]{2}:/, "").replaceAll("-", " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : null;
}

export function ProductCard({ product, eager = false }: { product: ProductCardData; eager?: boolean }) {
  const category = categoryLabel(product.category);
  return (
    <Link href={`/products/${product.id}`} className="group block">
      <div className="relative aspect-square overflow-hidden rounded-[22px] bg-neutral-100">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt=""
            fill
            loading={eager ? "eager" : "lazy"}
            sizes="(min-width: 768px) 240px, 50vw"
            className="object-contain p-4 mix-blend-multiply transition-transform group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-400">
            <Package size={28} aria-hidden />
          </div>
        )}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {product.recalled && <Badge tone="bad">Recall</Badge>}
          {product.reports > 0 && (
            <Badge tone="good">
              {product.reports} lab {product.reports === 1 ? "report" : "reports"}
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-2.5 px-1">
        <p className="truncate text-sm text-neutral-600">{product.brandName ?? "Brand not recorded"}</p>
        <p className="line-clamp-2 font-medium leading-snug">{product.name}</p>
        <p className="mt-0.5 truncate text-sm text-neutral-500">
          {[product.isNew ? "New" : "Updated", category].filter(Boolean).join(" · ")}
        </p>
      </div>
    </Link>
  );
}
