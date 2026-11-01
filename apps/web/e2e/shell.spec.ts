import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers";

test.describe("App shell", () => {
  test("recorded-run banner shows in mock mode and stays dismissed for the session", async ({
    page,
  }) => {
    await page.goto("/");
    const banner = page.getByRole("status").filter({ hasText: "You are viewing a recorded run" });
    await expect(banner).toBeVisible();
    await page.getByRole("button", { name: "Dismiss for this session" }).click();
    await expect(banner).toHaveCount(0);
    await page.goto("/consent");
    await expect(page.getByText("You are viewing a recorded run")).toHaveCount(0);
  });

  test("offline banner appears and clears", async ({ page, context }) => {
    await page.goto("/");
    await context.setOffline(true);
    await expect(
      page.getByText("You are offline. Measurements will resume when you reconnect."),
    ).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText("You are offline.")).toHaveCount(0);
  });

  test("theme switch flips the theme and remembers it", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const toggle = page.getByRole("button", { name: /^Switch (theme|to light|to dark)$/ });
    const before = await toggle.innerText();
    await toggle.click();
    const after = await html.getAttribute("data-theme");
    expect(["light", "dark"]).toContain(after);
    expect(await toggle.innerText()).not.toBe(before);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", after ?? "");
  });

  test("Ask MIRA opens as a labelled panel and closes with Escape, returning focus", async ({
    page,
  }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Ask MIRA" });
    await toggle.click();
    const panel = page.getByRole("complementary", { name: "Ask MIRA" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Ask MIRA" })).toBeFocused();
    await expect(
      panel.getByText(
        "The assistant is unavailable right now. Every tool still works from its own screen.",
      ),
    ).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });

  test("Ask MIRA closes with its close button", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Ask MIRA" }).click();
    await page.getByRole("button", { name: "Close Ask MIRA" }).click();
    await expect(page.getByRole("complementary")).toHaveCount(0);
  });

  test("the skip link moves focus to the main region", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });

  test("health still answers outside the shell", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.ok()).toBe(true);
    expect(await res.json()).toMatchObject({ ok: true, service: "mira-web", mode: "mock" });
  });
});
