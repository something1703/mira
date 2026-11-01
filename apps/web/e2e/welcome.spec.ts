import { expect, test } from "@playwright/test";
import { expectAccessible, snapshotForReview } from "./helpers";

test.describe("Welcome (UX_FLOWS §1)", () => {
  test("first visit: the line, the Ring and the two actions", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Look, measured." })).toBeVisible();
    await expect(page.getByRole("img", { name: /The Ring/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start measuring" })).toHaveAttribute(
      "href",
      "/consent",
    );
    await expect(page.getByRole("link", { name: "See a recorded run" })).toBeVisible();
    await expect(page.getByRole("link", { name: "MIRA home" })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "welcome-first-visit");
  });

  test("returning with a profile: shortcuts to the three modules", async ({ page }, testInfo) => {
    await page.goto("/?profile=returning");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back." })).toBeVisible();
    for (const name of ["Match my shade", "Build a look", "Check my progress"]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Start measuring" })).toHaveCount(0);
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "welcome-returning");
  });

  test("returning with the profile deleted: the first-visit layout", async ({ page }) => {
    await page.goto("/?profile=deleted");
    await expect(page.getByRole("heading", { level: 1, name: "Look, measured." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start measuring" })).toBeVisible();
  });

  test("the profile cookie drives the state when no preview is given", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "mira_profile", value: "exists", url: "http://localhost:3100" },
    ]);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back." })).toBeVisible();
  });

  test("links to screens that later phases build land on an explained screen", async ({ page }) => {
    await page.goto("/?profile=returning");
    await page.getByRole("link", { name: "Match my shade" }).click();
    await expect(
      page.getByRole("heading", { name: "This screen is not available yet." }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Go home" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("the reading sweep runs once, and is off under reduced motion", async ({ page }) => {
    await page.goto("/");
    const name = () =>
      page.locator(".mira-ring__reading").evaluate((el) => getComputedStyle(el).animationName);
    expect(await name()).toBe("mira-sweep");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await name()).toBe("none");
  });
});
