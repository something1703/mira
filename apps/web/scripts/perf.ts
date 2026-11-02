/**
 * First paint under a throttled phone profile (docs/PERFORMANCE.md). Run against a production
 * build: `pnpm --filter @mira/web build`, then `pnpm --filter @mira/web start` in mock mode with MIRA_SESSION_SECRET set to any 32+ characters, then
 * `pnpm --filter @mira/web exec tsx scripts/perf.ts http://localhost:3000`.
 *
 * It uses headless Chromium with CPU slowed 4x and the "Slow 4G" network of Lighthouse (1.6 Mbit/s
 * down, 0.75 up, 150 ms round trip). That is a stand-in for a mid-range phone, not a phone.
 */
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const PAGES = ["/", "/consent", "/dev/components"];
const RUNS = 5;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;

const browser = await chromium.launch();
const rows: string[] = [];
for (const path of PAGES) {
  const fcp: number[] = [];
  const lcp: number[] = [];
  const bytes: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    let transferred = 0;
    cdp.on("Network.loadingFinished", (e: { encodedDataLength: number }) => {
      transferred += e.encodedDataLength;
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __lcp: number };
      w.__lcp = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    const res = await page.goto(base + path, { waitUntil: "load" });
    if (res?.status() !== 200) throw new Error(`${path} answered ${res?.status()}`);
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => ({
      fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? NaN,
      lcp: (window as unknown as { __lcp: number }).__lcp,
    }));
    fcp.push(m.fcp);
    lcp.push(m.lcp);
    bytes.push(transferred);
    await context.close();
  }
  rows.push(
    `| ${path} | ${Math.round(median(fcp))} | ${Math.round(median(lcp))} | ${Math.round(median(bytes) / 1024)} |`,
  );
}
// Frame cadence on the page that shows the Ring in its states, with the CPU slowed 4x. The Ring is
// drawn with CSS animation, so this measures the page around it, not Camera Kit's video.
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(base + "/dev/components", { waitUntil: "load" });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.waitForTimeout(500);
  // A string, not a function: tsx adds helpers to functions that do not exist in the page.
  const frames = await page.evaluate<number[]>(`new Promise((resolve) => {
    const gaps = [];
    let last = performance.now();
    const end = last + 4000;
    const tick = (now) => {
      gaps.push(now - last);
      last = now;
      if (now < end) requestAnimationFrame(tick);
      else resolve(gaps);
    };
    requestAnimationFrame(tick);
  })`);
  const slow = frames.filter((g) => g > 20).length;
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  console.log(
    `Frame cadence with CPU 4x: ${frames.length} frames in 4 s, mean gap ${avg.toFixed(1)} ms, ${slow} frames over 20 ms`,
  );
  await context.close();
}
await browser.close();
console.log(
  "| Page | First contentful paint (ms, median of 5) | Largest contentful paint (ms) | Transferred (KiB) |",
);
console.log("| --- | --- | --- | --- |");
console.log(rows.join("\n"));
