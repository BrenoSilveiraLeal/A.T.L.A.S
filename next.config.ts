import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  // Opt-in for constrained local builds; production builds keep the default cache and workers.
  ...(process.env.ATLAS_LOW_DISK_BUILD === "true" ? { distDir: ".next-low-disk", experimental: { cpus: 2 } } : {}),
  webpack(webpackConfig) {
    if (process.env.ATLAS_LOW_DISK_BUILD === "true") webpackConfig.cache = false;
    return webpackConfig;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
