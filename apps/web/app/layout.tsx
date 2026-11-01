import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Gloock } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const display = Gloock({
  weight: "400",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-display",
  fallback: ["Georgia", "serif"],
});

const ui = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-ui",
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: { default: "MIRA — look, measured", template: "%s · MIRA" },
  description:
    "MIRA measures you once with YouCam, then matches foundation, composes complete looks and checks every preview before you see it.",
  icons: { icon: "/brand/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Applies a saved theme before first paint, so a returning person never sees a flash of the other
 * theme. With nothing saved, the CSS follows prefers-color-scheme on its own.
 */
const THEME_SCRIPT =
  "try{var t=localStorage.getItem('mira-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
