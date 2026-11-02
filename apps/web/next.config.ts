import type { NextConfig } from "next";
import { resolve } from "node:path";

const config: NextConfig = {
  // The e2e tests run their own dev server (apps/web/playwright.config.ts) in a separate build
  // folder. Two dev servers sharing `.next` corrupt its cache and make the browser reload forever.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: {
    // Next 16 keeps a Turbopack cache on disk between dev runs. After a dev server was stopped or
    // restarted mid-write, that cache made every page load bump the HMR version, so the browser
    // reloaded ~15 times a second (D46). A cold start takes a few seconds longer without it.
    turbopackFileSystemCacheForDev: false,
  },
  // Self-contained server for the Cloud Run image.
  output: "standalone",
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  transpilePackages: ["@mira/schemas", "@mira/ui", "@mira/youcam-client", "@mira/runtime"],
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Directives that do not depend on what the Camera Kit SDK loads. A script-src waits for
          // a capture with the real SDK to show what it needs (docs/FACTS.md F33), because a wrong
          // one would stop the camera.
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
          },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
            : []),
          // The camera is used only by the capture screens, from this origin.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ]);
  },
};

export default config;
