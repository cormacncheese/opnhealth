import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  images: {
    // Product photos come from Open Food Facts.
    remotePatterns: [new URL("https://images.openfoodfacts.org/**")],
  },
  partialPrefetching: true,
  turbopack: {
    // Shared domain code lives in supabase/functions/_shared/core at the repository root.
    root: path.join(__dirname, "../.."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
