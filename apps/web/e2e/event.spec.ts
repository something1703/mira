import { placeholderPng } from "@mira/fixtures/placeholder";
import { expect, test, type Page } from "@playwright/test";
import { lookTwin, seedTwin, sessionOf, setCap } from "./fixtures";
import { expectAccessible, snapshotForReview } from "./helpers";

/** Event Mode (docs/UX_FLOWS.md §7): every state. */

const KEY = "mira-event";
const h1 = (page: Page, name: string | RegExp) => page.getByRole("heading", { level: 1, name });

const plan = (lookIds: (string | undefined)[]) => ({
  name: "Aarav and Meera's wedding",
  functions: ["Haldi", "Mehendi", "Sangeet"].map((name, i) => ({
    id: `fn_test${String(i)}abc`,
    name,
    timeOfDay: "evening",
    venue: "hall",
    ...(lookIds[i] ? { lookId: lookIds[i] } : {}),
  })),
});

async function seedPlan(page: Page, value: unknown) {
  await page.addInitScript(
    ([key, json]) => {
      localStorage.setItem(key as string, json as string);
    },
    [KEY, JSON.stringify(value)],
  );
}

async function pictures(page: Page) {
  await page.route("**/api/looks/*/image", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(placeholderPng({ hex: "#C79A78" })),
    }),
  );
}

test.describe("Event Mode", () => {
  test("setup: the usual wedding functions are suggested, and every one can be edited", async ({
    page,
  }, testInfo) => {
    await page.goto("/event");
    await expect(h1(page, "Plan an event")).toBeVisible();
    const list = page.getByRole("list", { name: "Functions" });
    for (const name of ["Haldi", "Mehendi", "Sangeet", "Wedding", "Reception"]) {
      await expect(
        list.getByLabel("Function").and(page.locator(`input[value="${name}"]`)),
      ).toBeVisible();
    }
    await expect(list.getByLabel("Time of day")).toHaveCount(5);
    await expect(list.getByLabel("Venue type")).toHaveCount(5);
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "event-setup");
  });

  test("setup: add, rename and remove a function, then plan the looks", async ({ page }) => {
    await page.goto("/event");
    await page.getByRole("button", { name: "Add function" }).click();
    // A blank function name holds Plan looks back.
    await expect(page.getByRole("button", { name: "Plan looks" })).toBeDisabled();
    await expect(page.getByText("Give the event and every function a name.")).toBeVisible();
    await page.getByLabel("Function").last().fill("Cocktail night");
    await page.getByRole("button", { name: "Remove Reception" }).click();
    await page.getByLabel("Event name").fill("Our wedding");
    await page.getByRole("button", { name: "Plan looks" }).click();
    await expect(h1(page, "Our wedding")).toBeVisible();
    await expect(page.getByRole("link", { name: "Build a look for Cocktail night" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Reception/ })).toHaveCount(0);
  });

  test("planning: a card per function, each opens Look Studio for that function", async ({
    page,
    context,
    request,
  }, testInfo) => {
    const who = await sessionOf(context, page);
    await seedTwin(request, lookTwin(who.userId));
    await setCap(request, who, 400);
    await seedPlan(page, plan([]));
    await page.goto("/event");
    await expect(page.getByText("Plan a look for each function.")).toBeVisible();
    await expect(page.getByText("Not planned yet")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Download board" })).toBeDisabled();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "event-planning");
    await page.getByRole("link", { name: "Build a look for Sangeet" }).click();
    await expect(h1(page, "A look for Sangeet")).toBeVisible();
    // Its venue type is already chosen.
    await expect(page.getByLabel("Kind of venue")).toHaveValue("hall");
  });

  test("partially planned: built functions show their look, the rest say not planned yet", async ({
    page,
  }, testInfo) => {
    await pictures(page);
    await seedPlan(page, plan(["lk_looksaved001", undefined, "lk_looksaved003"]));
    await page.goto("/event");
    await expect(page.getByText("Some functions have a look.")).toBeVisible();
    await expect(page.getByRole("img", { name: "Look for Haldi" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Look for Sangeet" })).toBeVisible();
    await expect(page.getByText("Not planned yet")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Build a look for Mehendi" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Change the look for Haldi" })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "event-partial");
  });

  test("overview: every look side by side on the mat, and the board downloads as an image", async ({
    page,
  }, testInfo) => {
    await pictures(page);
    await seedPlan(page, plan(["lk_looksaved001", "lk_looksaved002", "lk_looksaved003"]));
    await page.goto("/event");
    await expect(page.getByText("Every function has a look.")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Looks by function" }).getByRole("img"),
    ).toHaveCount(3);
    await expect(page.getByText("Not planned yet")).toHaveCount(0);
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "event-overview");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download board" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("Aarav and Meera's wedding.png");
  });

  test("the plan stays in this browser and Clear this plan removes it", async ({ page }) => {
    await seedPlan(page, plan([]));
    await page.goto("/event");
    await expect(h1(page, "Aarav and Meera's wedding")).toBeVisible();
    await page.reload();
    await expect(h1(page, "Aarav and Meera's wedding")).toBeVisible();
    await page.getByRole("button", { name: "Clear this plan" }).click();
    await expect(h1(page, "Plan an event")).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
  });

  test("a plan that cannot be kept says so", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new Error("blocked");
      };
    });
    await page.goto("/event");
    await page.getByRole("button", { name: "Plan looks" }).click();
    await expect(page.getByText(/This browser is not keeping your plan/)).toBeVisible();
  });

  test("a damaged stored plan is ignored, not trusted", async ({ page }) => {
    await seedPlan(page, { name: "", functions: "nope" });
    await page.goto("/event");
    await expect(h1(page, "Plan an event")).toBeVisible();
  });
});
