import type { NextConfig } from "next";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      tailwindcss: require.resolve("tailwindcss"),
    },
  },
};

export default nextConfig;
