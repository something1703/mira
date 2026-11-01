import type { NextConfig } from "next";
import { resolve } from "node:path";

const config: NextConfig = {
  // Self-contained server for the Cloud Run image.
  output: "standalone",
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  transpilePackages: ["@mira/schemas", "@mira/ui", "@mira/youcam-client"],
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
          // The camera is used only by the capture screens, from this origin.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ]);
  },
};

export default config;
