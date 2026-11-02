import { expect, test } from "@playwright/test";
import { expectAccessible, snapshotForReview } from "./helpers";

test.describe("Run viewer (UX_FLOWS §12)", () => {
  // The first demo run in a server's life pays 40 units and takes real time; the second is cached.
  test.describe.configure({ mode: "serial" });

  test("empty: invites one action", async ({ page }) => {
    await page.goto("/dev/runs");
    await expect(
      page.getByRole("heading", { name: "Start a demo run to watch the graph." }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Start a demo run" })).toBeVisible();
    await expectAccessible(page);
  });

  test("a demo run lights up node by node, spends units, then is cleaned up", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-light",
      "One full run is enough; the second run is the cache demo.",
    );
    test.setTimeout(60_000);
    await page.goto("/dev/runs");
    await page.getByRole("button", { name: "Start a demo run" }).click();
    await expect(page).toHaveURL(/\/dev\/runs\/run_[a-z0-9]+$/);
    await expect(page.getByText("This is a synthetic demo run.")).toBeVisible();

    // The Ring is a progressbar with one tick per node, and the rail words every state.
    const bar = page.getByRole("progressbar");
    await expect(bar).toHaveAttribute("aria-valuemax", "4");
    await expect(page.getByRole("heading", { level: 1, name: "Succeeded" })).toBeVisible({
      timeout: 40_000,
    });
    await expect(bar).toHaveAttribute("aria-valuenow", "4");
    for (const label of [
      "Measuring skin and lip colour",
      "Measuring the skin tone band",
      "Measuring face proportions",
      "Putting the readings together",
    ]) {
      await expect(
        page.getByRole("list", { name: "Steps in this run" }).getByText(label),
      ).toBeVisible();
    }

    const steps = page.getByRole("table").first();
    await expect(steps.getByRole("row", { name: /skin-tone-analysis/ })).toContainText("20");
    await expect(page.getByTestId("ledger-totals")).toHaveText(
      "Reserved 40, committed 40, released 0.",
    );
    await expect(
      page.getByText("Images and YouCam tasks for this run have been deleted."),
    ).toBeVisible({ timeout: 10_000 });
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "run-first");

    // The same graph again finishes from saved results at zero units.
    await page.getByRole("button", { name: "Run it again" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Succeeded" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Saved results cost nothing")).toBeVisible();
    await expect(page.getByText("Saved result").first()).toBeVisible();
    await expect(
      page.getByText("No units were reserved. Saved results do not reserve any."),
    ).toBeVisible();
    await expect(
      page
        .getByRole("table")
        .first()
        .getByRole("row", { name: /skin-tone-analysis/ }),
    ).toContainText("Saved result");
    await snapshotForReview(page, testInfo, "run-cached");
  });

  test("an unknown run says so and offers a way back", async ({ page }) => {
    await page.goto("/dev/runs/run_doesnotexist1");
    await expect(
      page.getByRole("alert").filter({ hasText: "This run does not exist." }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the run viewer" })).toBeVisible();
    await expectAccessible(page);
  });

  test("the proxy refuses a malformed run id", async ({ request }) => {
    const res = await request.get("/dev/api/runs/..%2Fetc");
    expect([400, 404]).toContain(res.status());
  });
});
