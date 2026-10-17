import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Files the API reads at runtime, which file tracing cannot see: the expected decisions for
  // /api/metrics, and the extraction cache, so the deploy decides known invoices without an API key.
  outputFileTracingIncludes: {
    "/api/metrics": ["./data/expected.csv"],
    "/api/invoices": ["./data/cache/**/*.json"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
