import { expect, test } from "@playwright/test";
import { expectAccessible, snapshotForReview } from "./helpers";

test.describe("Consent (UX_FLOWS §2)", () => {
  test("default: unchecked box, disabled button with its reason", async ({ page }, testInfo) => {
    await page.goto("/consent");
    await expect(
      page.getByRole("heading", { level: 1, name: "Before the camera opens" }),
    ).toBeVisible();
    for (const h of [
      "What MIRA measures",
      "What happens to your photos",
      "What MIRA keeps",
      "What MIRA is not",
      "How to delete everything",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
    }
    await expect(
      page
        .getByRole("main")
        .getByText(
          "MIRA is a cosmetic and appearance tool. It does not diagnose, treat or give medical advice.",
        ),
    ).toBeVisible();
    const box = page.getByRole("checkbox", { name: "I understand and want to continue" });
    await expect(box).not.toBeChecked();
    const open = page.getByRole("button", { name: "Continue to your photo" });
    await expect(open).toBeDisabled();
    await expect(open).toHaveAccessibleDescription("Tick the box to continue");
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "consent-default");
  });

  test("ticked: the camera link is enabled", async ({ page }, testInfo) => {
    await page.goto("/consent");
    await page.getByRole("checkbox", { name: "I understand and want to continue" }).check();
    const open = page.getByRole("link", { name: "Continue to your photo" });
    await expect(open).toBeVisible();
    await expect(page.getByText("Tick the box to continue")).toHaveCount(0);
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "consent-ticked");
  });

  test("unticking disables it again", async ({ page }) => {
    await page.goto("/consent");
    const box = page.getByRole("checkbox", { name: "I understand and want to continue" });
    await box.check();
    await box.uncheck();
    await expect(page.getByRole("button", { name: "Continue to your photo" })).toBeDisabled();
  });

  test("declined: offers sample results, not a recorded run that does not exist (D25)", async ({
    page,
  }, testInfo) => {
    await page.goto("/consent");
    await page.getByRole("button", { name: "No thanks" }).click();
    await expect(
      page.getByRole("heading", { name: "You can still look around MIRA with sample results." }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "See sample results" })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "consent-declined");
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Before the camera opens" }),
    ).toBeVisible();
  });
});

test("keyboard-only path: Welcome to the camera link", async ({ page, browserName }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Keyboard path is checked on desktop");
  expect(browserName).toBe("chromium");
  await page.goto("/");
  // Skip link, home link, theme switch, Ask MIRA, then the page's own actions.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (
      await page
        .getByRole("link", { name: "Start measuring" })
        .evaluate((el) => el === document.activeElement)
    )
      break;
  }
  await expect(page.getByRole("link", { name: "Start measuring" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/consent$/);

  const box = page.getByRole("checkbox", { name: "I understand and want to continue" });
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (await box.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(box).toBeFocused();
  await page.keyboard.press("Space");
  await expect(box).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Continue to your photo" })).toBeFocused();
});
