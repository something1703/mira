import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("placeholder page (mock mode)", () => {
  test("shows the lockup and the line", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("img", { name: "MIRA" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Look, measured." })).toBeVisible();
  });

  test("has no accessibility violations", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test("serves /health in mock mode", async ({ request }) => {
  const res = await request.get("/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ ok: true, service: "mira-web", mode: "mock" });
});
