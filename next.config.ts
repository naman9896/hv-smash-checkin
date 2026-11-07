import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The manage link carries its token in the path: never send it on as a referrer, never index it
  // (API_SPEC conventions; SECURITY §3). T9 adds the site-wide security headers here.
  async headers() {
    const manage = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      { source: "/b/:token*", headers: manage },
      { source: "/api/booking/manage/:path*", headers: manage },
    ];
  },
  partialPrefetching: true,
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
