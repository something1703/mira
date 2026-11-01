/**
 * App icons from the brand mark (docs/BRAND.md, "App icon"): the mark on --mira-surface, centred
 * at 62% of the icon's width, which keeps the ring well inside the maskable safe zone (the
 * central 80% circle). Rendered with Chromium from assets/brand/mira-mark.svg, so the icons are
 * generated, not drawn. Run: pnpm --filter @mira/web exec tsx scripts/generate-icons.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { color } from "@mira/ui/tokens";

const ROOT = join(import.meta.dirname, "../../..");
const OUT = join(import.meta.dirname, "../public/icons");
const mark = readFileSync(join(ROOT, "assets/brand/mira-mark.svg"), "utf8");
const src = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;

const ICONS = [
  { file: "icon-180.png", size: 180 },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-512.png", size: 512 },
];

const browser = await chromium.launch();
try {
  for (const { file, size } of ICONS) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<html><body style="margin:0;background:${color.light.surface};display:grid;place-items:center;width:${String(size)}px;height:${String(size)}px">` +
        `<img src="${src}" style="width:${String(Math.round(size * 0.62))}px;height:auto" alt=""></body></html>`,
    );
    await page.waitForFunction(() => document.images[0]?.complete === true);
    writeFileSync(join(OUT, file), await page.screenshot({ type: "png" }));
    await page.close();
    console.log(`wrote public/icons/${file}`);
  }
} finally {
  await browser.close();
}
