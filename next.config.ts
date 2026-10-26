import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships Postgres as WebAssembly plus data files; load it with Node's own require.
  serverExternalPackages: ["@electric-sql/pglite"],
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
