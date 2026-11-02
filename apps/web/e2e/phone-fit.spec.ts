import { expect, test } from "@playwright/test";

const PAGES = [
  "/",
  "/how-it-works",
  "/tests",
  "/consent",
  "/capture",
  "/profile",
  "/shade",
  "/look",
  "/event",
  "/proof",
  "/brand",
  "/settings/privacy",
  "/runs/recorded",
];

/**
 * A page wider than the phone makes the browser zoom out the whole page: text turns small and
 * taps land beside their target. Hidden tables and file choosers did this before (D47).
 */
test.describe("Every page fits a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "phone layout only");
  for (const path of PAGES) {
    test(`${path} is no wider than the screen`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const { layout, screen } = await page.evaluate(() => ({
        layout: document.documentElement.scrollWidth,
        screen: window.visualViewport?.width ?? window.innerWidth,
      }));
      expect(layout).toBeLessThanOrEqual(Math.ceil(screen) + 1);
    });
  }
});
