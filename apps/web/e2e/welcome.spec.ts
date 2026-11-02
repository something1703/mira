import { expect, test } from "@playwright/test";
import { sessionOf, setCap } from "./fixtures";
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

  test("See a recorded run measures the drawn sample face and ends on a sample profile", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await page.goto("/");
    // Its own allowance, so units other tests spent in this session cannot block the build.
    await setCap(request, await sessionOf(context, page), 400);
    await page.getByRole("link", { name: "See a recorded run" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "A sample run" })).toBeVisible();
    await expect(page.getByText("Drawn sample face, not a real person")).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "sample-run");

    await page.getByRole("button", { name: "Start the sample run" }).click();
    // The same price step a real photo gets, then the same build.
    await page.getByRole("button", { name: "Start measuring" }).click();
    await expect(page).toHaveURL(/\/profile/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Your measured profile" }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Sample results/).first()).toBeVisible();
  });

  test("the sample run never replaces a profile the person already has", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "mira_profile", value: "exists", url: "http://localhost:3100" },
    ]);
    await page.goto("/runs/recorded");
    await expect(
      page.getByRole("heading", { name: "You already have a measured profile." }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Start the sample run" })).toHaveCount(0);
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
