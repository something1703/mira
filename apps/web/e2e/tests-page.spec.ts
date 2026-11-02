import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { expectAccessible, snapshotForReview } from "./helpers";

const results = JSON.parse(
  readFileSync(new URL("../src/tests/results.json", import.meta.url), "utf8"),
) as { balanceBefore: number; balanceAfter: number; people: { shade: unknown }[] };

test.describe("How it works and the live test results", () => {
  test("How it works explains the loop and says what is real today", async ({ page }, testInfo) => {
    await page.goto("/how-it-works");
    await expect(page.getByRole("heading", { level: 1, name: "How MIRA works" })).toBeVisible();
    await expect(page.getByText("Tested on real photos").first()).toBeVisible();
    await expect(page.getByText("Built; runs on sample data so far").first()).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "how-it-works");
    await page.getByRole("link", { name: "See the real test results" }).click();
    await expect(page).toHaveURL(/\/tests$/);
  });

  test("the results page shows every person, the shade matches, the ledger and the credits", async ({
    page,
  }, testInfo) => {
    await page.goto("/tests");
    await expect(
      page.getByRole("heading", { level: 1, name: "What we tested, for real" }),
    ).toBeVisible();
    for (let i = 1; i <= results.people.length; i++) {
      await expect(
        page.getByRole("heading", { name: `Person ${String(i)}`, exact: true }),
      ).toBeVisible();
    }
    await expect(
      page.getByText(`${String(results.balanceBefore)} to ${String(results.balanceAfter)}`),
    ).toBeVisible();
    // Every photo is credited with its licence, as CC BY-SA requires.
    await expect(page.getByRole("link", { name: "Wikimedia Commons" })).toHaveCount(
      results.people.length,
    );
    const shadeRuns = results.people.filter((p) => p.shade).length;
    await expect(page.getByRole("img", { name: /an unretouched YouCam preview/ })).toHaveCount(
      shadeRuns * 3,
    );
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "tests-page");
  });

  test("the header and footer link to both pages", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "How it works" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "More" }).getByRole("link", { name: "What we tested" }),
    ).toBeVisible();
  });
});
