import { color } from "@mira/ui/tokens";
import type { MetadataRoute } from "next";

/** Web app manifest: installs MIRA with the brand icons on the neutral surface (docs/BRAND.md). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MIRA — look, measured",
    short_name: "MIRA",
    description:
      "MIRA measures you once, then shows makeup and clothes on you without smoothing your skin, and checks every preview before you see it.",
    start_url: "/",
    display: "standalone",
    background_color: color.light.surface,
    theme_color: color.light.surface,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
