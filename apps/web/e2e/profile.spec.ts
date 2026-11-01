import { expect, test } from "@playwright/test";
import {
  buildFor,
  HAIR_METRICS,
  SKIN_METRICS,
  makeTwin,
  seedTwin,
  sessionOf,
  setCap,
  uploadPhoto,
  WORKFLOWS,
} from "./fixtures";
import { expectAccessible, snapshotForReview } from "./helpers";

test.describe("Measured profile (UX_FLOWS §4)", () => {
  test("nothing yet: invites one action", async ({ page }, testInfo) => {
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "No measured profile yet." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start measuring" })).toHaveAttribute(
      "href",
      "/consent",
    );
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "profile-empty");
  });

  test("ready: Skin, Colouring, Face and Hair with units, swatches on the mat and actions", async ({
    page,
    context,
    request,
  }, testInfo) => {
    const who = await sessionOf(context, page);
    await seedTwin(request, makeTwin(who.userId, { noiseFloors: true }));
    await page.goto("/profile");

    await expect(
      page.getByRole("heading", { level: 1, name: "Your measured profile" }),
    ).toBeVisible();
    for (const g of ["Skin", "Colouring", "Face", "Hair"]) {
      await expect(page.getByRole("heading", { level: 2, name: g })).toBeVisible();
    }
    // Skin: a raw score with a unit and what the repeat captures showed.
    const pores = page.locator(".mira-reading-block", { hasText: "Visible pores" });
    await expect(pores).toContainText("41.5");
    await expect(pores).toContainText("out of 100");
    await expect(pores).toContainText(
      "Photos seconds apart moved this reading by about 1.4 points out of 100",
    );
    await expect(
      page.locator(".mira-reading-block", { hasText: "Under-eye darkness, left eye" }),
    ).toBeVisible();
    // Colouring: swatches with their hex, ITA with its unit, the band and the Fitzpatrick note.
    const swatches = page.getByRole("list", { name: "Measured colours" });
    await expect(swatches).toContainText("Skin colour");
    await expect(swatches).toContainText("#C79A78");
    await expect(
      page.locator(".mira-reading-block", { hasText: "Skin lightness angle" }),
    ).toContainText("42");
    await expect(page.getByText("It describes sun response only.")).toBeVisible();
    // Face and hair.
    await expect(
      page.locator(".mira-reading-block", { hasText: "Face height to width" }),
    ).toContainText("1.31");
    await expect(page.locator(".mira-reading-block", { hasText: "Hair type" })).toContainText(
      "wavy",
    );
    // Ready: the three next steps, and no sample-results banner for a real profile.
    for (const name of ["Match my shade", "Build a look", "Check my progress"]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }
    await expect(page.getByText("Sample results. This profile")).toHaveCount(0);
    await expect(page.getByText("Needs 2 more captures")).toHaveCount(0);
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "profile-ready");
  });

  test("a profile built from sample data says so", async ({ page, context, request }) => {
    const who = await sessionOf(context, page);
    await seedTwin(request, makeTwin(who.userId, { synthetic: true, noiseFloors: true }));
    await page.goto("/profile");
    await expect(page.getByText("Sample results. This profile")).toBeVisible();
    await expect(page.getByText("not from a photo of you")).toBeVisible();
  });

  test("repeat captures skipped: says what is missing and offers to add them", async ({
    page,
    context,
    request,
  }) => {
    const who = await sessionOf(context, page);
    await seedTwin(request, makeTwin(who.userId));
    await page.goto("/profile");
    await expect(
      page.getByText("Add 2 repeat photos to see how much a reading moves between captures."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Add captures" })).toHaveAttribute(
      "href",
      "/capture?step=repeats",
    );
    await expect(page.locator(".mira-reading-block", { hasText: "Visible pores" })).toContainText(
      "Day-to-day variation is not known yet.",
    );
  });

  test("partial: failed groups say Not measured, why, and offer a retry for that group", async ({
    page,
    context,
    request,
  }, testInfo) => {
    const who = await sessionOf(context, page);
    const at = "2026-11-01T09:00:05.000Z";
    await seedTwin(
      request,
      makeTwin(who.userId, {
        metrics: [...SKIN_METRICS, ...HAIR_METRICS.slice(0, 1)],
        noiseFloors: true,
        groups: {
          colouring: {
            status: "not_measured",
            missing: [{ reading: "colour", reason: "no_face", guidance: "retake" }],
            at,
          },
          face: {
            status: "not_measured",
            missing: [{ reading: "proportions", reason: "face_too_small", guidance: "retake" }],
            at,
          },
          hair: {
            status: "partial",
            missing: [{ reading: "hair_density", reason: "youcam_internal" }],
            at,
          },
        },
      }),
    );
    await page.goto("/profile");

    const face = page.locator("section", { has: page.getByRole("heading", { name: "Face" }) });
    await expect(face.getByText("Not measured").first()).toBeVisible();
    await expect(face).toContainText(
      "Your face needs to fill more of the photo. Move a little closer. No units were used.",
    );
    await expect(face.getByRole("link", { name: /Retake for face/ })).toHaveAttribute(
      "href",
      "/capture?only=face",
    );
    const hair = page.locator("section", { has: page.getByRole("heading", { name: "Hair" }) });
    await expect(hair).toContainText("Partly measured");
    await expect(hair).toContainText("Hair type");
    await expect(hair).toContainText("Hair density");
    await expect(hair).toContainText(
      "The measuring service had a problem. Try again in a moment. No units were used.",
    );
    await expect(hair.getByRole("link", { name: /Try hair again/ })).toBeVisible();
    // Skin was measured, so no retry on it.
    const skin = page.locator("section", { has: page.getByRole("heading", { name: "Skin" }) });
    await expect(skin.getByRole("link", { name: /Retake|again/ })).toHaveCount(0);
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "profile-partial");
  });

  test("a run that does not exist says so and offers to measure again", async ({ page }) => {
    await page.goto("/profile?run=run_doesnotexist1");
    await expect(page.locator(".mira-error")).toContainText(
      "This measuring run could not be found.",
    );
    await expect(page.getByRole("link", { name: "Measure again" })).toBeVisible();
  });

  test("building: steps light up, then the measured profile appears", async ({
    page,
    context,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-light", "One full run is enough.");
    test.setTimeout(120_000);
    const who = await sessionOf(context, page);
    await setCap(request, who, 400);
    const face = await uploadPhoto(page, "face");
    const quote = await page.request.post("/api/twin/quote", {
      data: { capture: { face, mode: "hd", source: "upload", qualityChecksPassed: null } },
    });
    expect(quote.status()).toBe(200);
    const total = ((await quote.json()) as { quote: { total: number } }).quote.total;
    expect(total).toBe(56);
    const build = await page.request.post("/api/twin/build", {
      data: {
        capture: { face, mode: "hd", source: "upload", qualityChecksPassed: null },
        confirmedTotal: total,
      },
    });
    expect(build.status()).toBe(201);
    const { runId } = (await build.json()) as { runId: string };

    await page.goto(`/profile?run=${runId}`);
    await expect(page.getByRole("heading", { name: "Measuring you" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Steps in this run" })).toContainText(
      "Measuring your skin",
    );
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();

    // The run ends, the profile is written and shown.
    await expect(
      page.getByRole("heading", { level: 1, name: "Your measured profile" }),
    ).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText("Sample results. This profile")).toBeVisible();
    await expect(page.locator(".mira-reading-block", { hasText: "Visible pores" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Measured colours" })).toContainText("Skin colour");
    // Colouring needed the engine; with it running the group is measured.
    await expect(
      page.locator("section", { has: page.getByRole("heading", { name: "Colouring" }) }),
    ).toContainText("Measured");

    // The photo is gone: nothing is held for this person.
    const inv = await request.get(`${WORKFLOWS}/internal/twin/${who.userId}/inventory`);
    expect(((await inv.json()) as { pendingUploads: number }).pendingUploads).toBe(0);
    // The Welcome screen now knows there is a profile.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
    await snapshotForReview(page, testInfo, "profile-built");
  });

  test("another person's run cannot be read", async ({ page, context, browser, request }) => {
    const who = await sessionOf(context, page);
    await setCap(request, who, 400);
    const face = await uploadPhoto(page);
    const { runId = "" } = await buildFor(page, face);

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto("/");
    const res = await otherPage.request.get(`/api/runs/${runId}`);
    expect(res.status()).toBe(404);
    const cancel = await otherPage.request.post(`/api/runs/${runId}/cancel`);
    expect(cancel.status()).toBe(404);
    await other.close();
  });
});
