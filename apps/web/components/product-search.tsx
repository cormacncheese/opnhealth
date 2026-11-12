"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";

export interface ProductHit {
  id: string;
  name: string;
  brand_name: string | null;
  gtin: string | null;
}

interface Props {
  /** When given, results are buttons that pick a product instead of links to it. */
  onPick?: (product: ProductHit) => void;
  placeholder?: string;
  autoFocus?: boolean;
  floating?: boolean;
}

export function ProductSearch({ onPick, placeholder = "Search products, brands or barcodes", autoFocus, floating }: Props) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ for: string; hits: ProductHit[]; error: boolean } | null>(null);
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const { data, error } = await browserClient().rpc("search_products", { q: term, max_results: 12 });
      if (stale) return;
      setState({
        for: term,
        error: Boolean(error),
        hits: (data ?? []).map((p) => ({ id: p.id, name: p.name, brand_name: p.brand_name, gtin: p.gtin })),
      });
    }, 220);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [term]);

  const results = term.length >= 2 && state?.for === term ? state : null;
  const searching = term.length >= 2 && !results;

  return (
    <div>
      <div
        className={
          floating
            ? "flex items-center gap-3 rounded-full bg-white/55 px-5 py-4 shadow-[0_4px_14px_rgba(0,0,0,0.06)] backdrop-blur-xl"
            : "flex items-center gap-3 rounded-2xl bg-neutral-100 px-4 py-3"
        }
      >
        <Search size={20} className="shrink-0 text-neutral-500" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus={autoFocus}
          className="w-full bg-transparent text-base outline-none placeholder:text-neutral-500"
        />
      </div>

      {(results || searching) && (
        <ul className="mt-3 space-y-2" aria-live="polite">
          {searching && <li className="px-4 py-3 text-neutral-500">Searching for “{term}”</li>}
          {results?.error && <li className="px-4 py-3 text-red-800">Search is unavailable right now. Try again shortly.</li>}
          {results && !results.error && results.hits.length === 0 && (
            <li className="px-4 py-3 text-neutral-600">
              No products match “{term}”. You can still{" "}
              <Link href="/submit" className="underline">
                submit a report
              </Link>{" "}
              and describe the product.
            </li>
          )}
          {results?.hits.map((hit) => {
            const body = (
              <>
                <span className="block font-medium">{hit.name}</span>
                <span className="block text-sm text-neutral-600">
                  {[hit.brand_name, hit.gtin].filter(Boolean).join(" · ") || "Brand not recorded"}
                </span>
              </>
            );
            const className = "block w-full rounded-2xl bg-neutral-100 px-4 py-3 text-left hover:bg-neutral-200/70";
            return (
              <li key={hit.id}>
                {onPick ? (
                  <button type="button" className={className} onClick={() => onPick(hit)}>
                    {body}
                  </button>
                ) : (
                  <Link href={`/products/${hit.id}`} className={className}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
