import { expect, test, type Page } from "@playwright/test";
import {
  makeTwin,
  outcome,
  seedTwin,
  serveCraftedRun,
  sessionOf,
  setCap,
  shadeResult,
} from "./fixtures";
import { installFakeCameraKit } from "./fake-camera-kit";
import { expectAccessible, snapshotForReview } from "./helpers";

const heading = (page: Page, name: string | RegExp) =>
  page.getByRole("heading", { level: 1, name });

async function withProfile(
  page: Page,
  context: Parameters<typeof sessionOf>[0],
  request: Parameters<typeof seedTwin>[0],
) {
  const who = await sessionOf(context, page);
  await seedTwin(request, makeTwin(who.userId, { noiseFloors: true }));
  await setCap(request, who, 400);
  return who;
}

test.describe("Shade: choosing a range (UX_FLOWS §5)", () => {
  test("no profile: says to measure first, with one action", async ({ page }, testInfo) => {
    await page.goto("/shade");
    await expect(
      page.getByRole("heading", { name: "Measure yourself first, then match a shade." }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Start measuring" })).toHaveAttribute(
      "href",
      "/consent",
    );
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "shade-no-profile");
  });

  test("choose range: sample ranges are listed and marked as samples, and can be searched", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await withProfile(page, context, request);
    await page.goto("/shade");
    await expect(heading(page, "Match my shade")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Sample foundation, warm-leaning/ }),
    ).toContainText("sample range");
    await expect(
      page.getByRole("button", { name: /Sample foundation, neutral-leaning/ }),
    ).toBeVisible();
    await page.getByLabel("Search ranges").fill("warm");
    await expect(page.getByRole("button", { name: /neutral-leaning/ })).toHaveCount(0);
    await page.getByLabel("Search ranges").fill("zzz");
    await expect(page.getByText("No range matches that search.")).toBeVisible();
    await page.getByLabel("Search ranges").fill("");
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "shade-choose");
  });

  test("a pasted link is read, and an unreadable page says so and what to try", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await withProfile(page, context, request);
    await page.goto("/shade");
    await page.getByLabel("Product page link").fill("fixture:unreadable");
    await page.getByRole("button", { name: "Read the range" }).click();
    await expect(
      page.getByText(
        "MIRA could not find shade colours on this page. Try the brand's shade-finder page or another product.",
      ),
    ).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "shade-unreadable");

    await page.getByLabel("Product page link").fill("fixture:sample-product");
    await page.getByRole("button", { name: "Read the range" }).click();
    await expect(heading(page, "Sample foundation, warm-leaning")).toBeVisible();
    await expect(page.getByText("Checked 7 shades for free.")).toBeVisible();
  });

  test("reading the range shows progress, costs nothing, and can be cancelled", async ({
    page,
    context,
    request,
  }) => {
    await withProfile(page, context, request);
    await page.route("**/api/shade/extract", async (route) => {
      await new Promise((r) => setTimeout(r, 1_500));
      await route.continue();
    });
    await page.goto("/shade");
    await page.getByLabel("Product page link").fill("fixture:sample-product");
    await page.getByRole("button", { name: "Read the range" }).click();
    await expect(heading(page, "Reading the shade range")).toBeVisible();
    await expect(page.getByText("This costs no units.")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(heading(page, "Match my shade")).toBeVisible();
  });

  test("an address MIRA will not open is refused with a reason", async ({
    page,
    context,
    request,
  }) => {
    await withProfile(page, context, request);
    await page.goto("/shade");
    await page.getByLabel("Product page link").fill("https://169.254.169.254/latest");
    await page.getByRole("button", { name: "Read the range" }).click();
    await expect(
      page.getByText("MIRA can only read public product pages that start with https."),
    ).toBeVisible();
  });
});

test.describe("Shade: ranked for free, then priced", () => {
  const rank = async (page: Page) => {
    await page.getByRole("button", { name: /Sample foundation, warm-leaning/ }).click();
    await expect(heading(page, "Sample foundation, warm-leaning")).toBeVisible();
  };

  test("pre-ranked: every shade checked at no cost, nearest first, nothing called a best match yet", async ({
    page,
    context,
    request,
  }, testInfo) => {
    const who = await withProfile(page, context, request);
    await page.goto("/shade");
    await rank(page);
    await expect(page.getByText("Checked 20 shades for free.")).toBeVisible();
    await expect(page.getByText("Sample range.", { exact: false })).toBeVisible();
    const swatches = page
      .getByRole("list", { name: "Shades closest to your skin, nearest first" })
      .getByRole("listitem");
    await expect(swatches).toHaveCount(12);
    const des = (await swatches.locator(".mira-swatch__de").allTextContents()).map((t) =>
      Number(t.replace("ΔE ", "")),
    );
    expect(des).toEqual([...des].sort((a, b) => a - b));
    await expect(page.getByText("Best match")).toHaveCount(0);
    await expect(
      page.getByText(/Medium coverage, because a visible-redness or acne reading was low\./),
    ).toBeVisible();
    // Ranking spent nothing.
    const budget = await request.get(
      `http://localhost:${process.env.E2E_WORKFLOWS_PORT ?? 4120}/internal/budgets/${who.sessionId}`,
    );
    expect(((await budget.json()) as { committed: number }).committed).toBe(0);
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "shade-ranked");
  });

  test("the price comes before any render: three shades, 21 units each, with more or fewer on request", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await withProfile(page, context, request);
    await installFakeCameraKit(page);
    await page.goto("/shade");
    await rank(page);
    await page.getByRole("button", { name: "Preview the closest shades" }).click();
    await expect(heading(page, "A photo to try the shades on")).toBeVisible();
    await page.getByRole("button", { name: "Allow camera" }).click();
    await page.waitForFunction(
      () => "__ymk" in window && window.__ymk.listenerCount("faceDetectionCaptured") > 0,
    );
    await page.evaluate(() => window.__ymk.capture());
    await page.getByRole("button", { name: "Use this photo" }).click();

    const sheet = page.locator(".mira-quote");
    await expect(
      sheet.getByRole("heading", { name: "Rendering the closest shades" }),
    ).toBeVisible();
    await expect(sheet.getByRole("row", { name: /render and measure/ })).toHaveCount(3);
    await expect(sheet.getByRole("row", { name: /Total/ })).toContainText("63 units");
    await expect(sheet.getByRole("row", { name: /render and measure/ }).first()).toContainText(
      "21 units",
    );

    await page.getByRole("button", { name: "Fewer" }).click();
    await expect(sheet.getByRole("row", { name: /Total/ })).toContainText("42 units");
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "More" }).click();
    await expect(sheet.getByRole("row", { name: /Total/ })).toContainText("84 units");
    await page
      .getByRole("checkbox", { name: /Include/ })
      .first()
      .uncheck();
    await expect(sheet.getByRole("row", { name: /Total/ })).toContainText("63 units");
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "shade-quote");

    // Cancelling deletes the photo.
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL("/");
  });

  test("over the session's units: says so and does not allow starting", async ({
    page,
    context,
    request,
  }) => {
    const who = await withProfile(page, context, request);
    await setCap(request, who, 30);
    await installFakeCameraKit(page);
    await page.goto("/shade");
    await rank(page);
    await page.getByRole("button", { name: "Preview the closest shades" }).click();
    await page.getByRole("button", { name: "Allow camera" }).click();
    await page.waitForFunction(
      () => "__ymk" in window && window.__ymk.listenerCount("faceDetectionCaptured") > 0,
    );
    await page.evaluate(() => window.__ymk.capture());
    await page.getByRole("button", { name: "Use this photo" }).click();
    await expect(page.locator(".mira-quote__cap")).toContainText(
      "This plan would use 63 units and you have 30 left",
    );
    await expect(page.getByRole("button", { name: "Start rendering" })).toBeDisabled();
  });
});

test.describe("Shade: a real run, start to finish", () => {
  test("renders, measures, ranks and shows the verified best match; the photo is gone", async ({
    page,
    context,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-light", "One full run is enough.");
    test.setTimeout(180_000);
    const who = await withProfile(page, context, request);
    await installFakeCameraKit(page);
    await page.goto("/shade");
    await page.getByRole("button", { name: /Sample foundation, warm-leaning/ }).click();
    await page.getByRole("button", { name: "Preview the closest shades" }).click();
    await page.getByRole("button", { name: "Allow camera" }).click();
    await page.waitForFunction(
      () => "__ymk" in window && window.__ymk.listenerCount("faceDetectionCaptured") > 0,
    );
    await page.evaluate(() => window.__ymk.capture());
    await page.getByRole("button", { name: "Use this photo" }).click();
    await page.getByRole("button", { name: "Start rendering" }).click();

    await expect(page).toHaveURL(/\/shade\?run=run_/);
    await expect(heading(page, "Trying the closest shades")).toBeVisible();
    await expect(page.getByRole("list", { name: "Steps in this run" })).toContainText("Trying");
    await expect(
      page.getByText("Sample results. The previews are placeholder pictures"),
    ).toBeVisible();

    await expect(heading(page, /is your closest match/)).toBeVisible({ timeout: 150_000 });
    await expect(page.getByRole("heading", { name: "Best match" })).toBeVisible();
    await expect(page.locator(".mira-label--verified").first()).toContainText("Verified");
    await expect(page.getByText(/blends within ΔE \d\.\d/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Why this finish and coverage" })).toBeVisible();
    await expect(page.getByRole("img", { name: /Unretouched preview of/ })).toBeVisible();
    await expect(
      page.getByText(/Previews are deleted \d+ minutes after the run unless you save one\./),
    ).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "shade-results");

    // The person's own photo is already gone; saving keeps the preview.
    const inv = await request.get(
      `http://localhost:${process.env.E2E_WORKFLOWS_PORT ?? 4120}/internal/twin/${who.userId}/inventory`,
    );
    expect(((await inv.json()) as { pendingUploads: number }).pendingUploads).toBe(0);
    await page.getByRole("button", { name: "Save this preview" }).click();
    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
    await expect(page.getByText("Look saved")).toBeVisible();
    const after = await request.get(
      `http://localhost:${process.env.E2E_WORKFLOWS_PORT ?? 4120}/internal/twin/${who.userId}/inventory`,
    );
    expect(((await after.json()) as { savedLooks: unknown[] }).savedLooks).toHaveLength(1);
  });
});

test.describe("Shade: every result state", () => {
  const run = "run_craftedshade01";
  const open = async (
    page: Page,
    context: Parameters<typeof sessionOf>[0],
    result: ReturnType<typeof shadeResult> | undefined,
    options: { previewsGone?: boolean } = {},
  ) => {
    const who = await sessionOf(context, page);
    await serveCraftedRun(page, who.userId, run, result, options);
    await page.goto(`/shade?run=${run}`);
  };

  test("results: best match, runners-up with their blends, and why this finish", async ({
    page,
    context,
  }, testInfo) => {
    await open(page, context, shadeResult([outcome(1), outcome(2), outcome(3)]));
    await expect(heading(page, "Shade 1 is your closest match")).toBeVisible();
    await expect(page.getByRole("img", { name: "Unretouched preview of Shade 1" })).toBeVisible();
    await expect(page.locator(".mira-strip")).toContainText(
      "Unretouched preview of Shade 1, smoothing off",
    );
    await expect(page.locator(".mira-strip")).toContainText("blends within ΔE 1.4");
    await expect(page.getByRole("heading", { name: "Other shades tried" })).toBeVisible();
    await expect(page.locator(".shade__row")).toHaveCount(2);
    await expect(
      page.getByText(
        "MIRA has no skin-type reading it can interpret yet, so it suggests satin, the middle finish.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("a starting value that has not been calibrated yet", { exact: false }),
    ).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "shade-state-results");
  });

  test("no match in range: the closest is shown and the sentence says how it reads", async ({
    page,
    context,
  }, testInfo) => {
    await open(
      page,
      context,
      shadeResult([outcome(1, { blendDe: 6.2 }), outcome(2, { blendDe: 7.9 })], {
        bestShadeId: undefined,
        noClosePick: true,
        closestLabel: "lighter",
      }),
    );
    await expect(heading(page, "No shade in this range blends closely")).toBeVisible();
    await expect(
      page.getByText("The closest shade, Shade 1, reads lighter than your skin."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Closest shade" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Best match" })).toHaveCount(0);
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "shade-state-no-match");
  });

  test("a render that drifted is shown with its label and is never the best match", async ({
    page,
    context,
  }, testInfo) => {
    await open(
      page,
      context,
      shadeResult([outcome(2), outcome(1, { verdict: "drift", blendDe: 0.3 })]),
    );
    await expect(heading(page, "Shade 2 is your closest match")).toBeVisible();
    const row = page.locator(".shade__row", { hasText: "Shade 1" });
    await expect(row.locator(".mira-label--drift")).toContainText("Colour drifted");
    await expect(row).toContainText("the wrong way");
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "shade-state-drift");
  });

  test("partial: says how many rendered, why the others did not, and offers a retry", async ({
    page,
    context,
  }, testInfo) => {
    await open(
      page,
      context,
      shadeResult([
        outcome(1),
        outcome(2, { verdict: "failed", blendDe: undefined, reason: "face_too_small" }),
        outcome(3, { verdict: "failed", blendDe: undefined, reason: "not_rendered" }),
      ]),
    );
    await expect(page.getByText("1 of 3 shades rendered.")).toBeVisible();
    const failed = page.locator(".shade__row", { hasText: "Shade 2" });
    await expect(failed).toContainText(
      "Your face needs to fill more of the photo. Move a little closer. No units were used.",
    );
    await expect(page.locator(".shade__row", { hasText: "Shade 3" })).toContainText(
      "Left out of this run.",
    );
    await expect(page.getByRole("button", { name: "Retry missing" })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "shade-state-partial");
  });

  test("a concealer pass is offered when the engine suggests one, and its result says so", async ({
    page,
    context,
  }) => {
    await open(page, context, shadeResult([outcome(1), outcome(2)], { concealerSuggested: true }));
    await expect(page.getByRole("button", { name: "Add a concealer to Shade 1" })).toBeVisible();

    const done = await context.newPage();
    const who = await sessionOf(context, done);
    await serveCraftedRun(
      done,
      who.userId,
      "run_craftedshade02",
      shadeResult([outcome(1)], { concealer: true, concealerSuggested: true }),
    );
    await done.goto("/shade?run=run_craftedshade02");
    await expect(done.locator(".mira-strip")).toContainText(
      "Unretouched preview of Shade 1 with concealer, smoothing off",
    );
    await expect(done.getByRole("button", { name: /Add a concealer/ })).toHaveCount(0);
  });

  test("Retry missing returns to the range with only the shades that failed, priced again", async ({
    page,
    context,
    request,
  }) => {
    const who = await sessionOf(context, page);
    await seedTwin(request, makeTwin(who.userId));
    await setCap(request, who, 400);
    const range = JSON.stringify(
      (
        (await (
          await request.get(
            `http://localhost:${process.env.E2E_WORKFLOWS_PORT ?? 4120}/internal/shade/ranges`,
          )
        ).json()) as { ranges: unknown[] }
      ).ranges[0],
    );
    await page.addInitScript((r) => {
      sessionStorage.setItem("mira-shade-range", r);
    }, range);
    await serveCraftedRun(
      page,
      who.userId,
      run,
      shadeResult([
        outcome(1),
        outcome(2, { verdict: "failed", blendDe: undefined, reason: "face_too_small" }),
      ]),
    );
    await page.goto(`/shade?run=${run}`);
    await page.getByRole("button", { name: "Retry missing" }).click();
    await expect(page).toHaveURL(/\/shade\?retry=1/);
    await expect(
      page.getByRole("button", { name: "Retry the shades that did not render" }),
    ).toBeVisible();
  });

  test("the previews were deleted: the plate says so and saving is off", async ({
    page,
    context,
  }) => {
    await open(page, context, shadeResult([outcome(1), outcome(2)]), { previewsGone: true });
    await expect(heading(page, "Shade 1 is your closest match")).toBeVisible();
    await expect(page.getByText("This image has expired and was deleted.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save this preview" })).toBeDisabled();
  });

  test("nothing could be measured: an error with the way forward", async ({ page, context }) => {
    await open(page, context, undefined);
    await expect(page.locator(".mira-error")).toContainText("No shade could be measured.");
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/shade");
  });

  test("another person's run cannot be read", async ({ page, context }) => {
    await sessionOf(context, page);
    await page.route(`**/api/runs/${run}`, (route) =>
      route.fulfill({ status: 404, json: { error: "run_not_found" } }),
    );
    await page.goto(`/shade?run=${run}`);
    await expect(page.locator(".mira-error")).toContainText("This shade run could not be found.");
  });
});
