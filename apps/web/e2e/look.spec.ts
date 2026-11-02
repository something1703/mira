import { expect, test, type Page } from "@playwright/test";
import {
  jpegBytes,
  lookResult,
  lookStep,
  lookTwin,
  seedTwin,
  serveCraftedLook,
  sessionOf,
  setCap,
} from "./fixtures";
import { expectAccessible, snapshotForReview } from "./helpers";

/** Look Studio (docs/UX_FLOWS.md §6): every state. */

const h1 = (page: Page, name: string | RegExp) => page.getByRole("heading", { level: 1, name });

async function withProfile(
  page: Page,
  context: Parameters<typeof sessionOf>[0],
  request: Parameters<typeof seedTwin>[0],
) {
  const who = await sessionOf(context, page);
  await seedTwin(request, lookTwin(who.userId));
  await setCap(request, who, 400);
  return who;
}

async function pickSample(page: Page, kind: "outfit" | "shoes" | "bag", name: RegExp) {
  await page
    .getByRole("button", { name: kind === "outfit" ? "Pick an outfit" : /Add (shoes|a bag)/ })
    .click();
  await page.getByRole("tab", { name: "Browse samples" }).click();
  await page.getByRole("button", { name }).click();
}

async function addPhoto(page: Page) {
  await page.getByRole("button", { name: /Add a photo|Take it again/ }).click();
  await page.getByRole("button", { name: "Upload a photo instead" }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: jpegBytes(1200, 1600, 11) });
  await page.getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByText("Full-length photo added.")).toBeVisible();
}

test.describe("Look Studio: starting", () => {
  test("no profile: says to measure first, with one action", async ({ page }, testInfo) => {
    await page.goto("/look");
    await expect(
      page.getByRole("heading", { name: "Measure yourself first, then build a look." }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Start measuring" })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "look-no-profile");
  });

  test("empty: invites one action, and the unavailable slot says why", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await withProfile(page, context, request);
    await page.goto("/look");
    await expect(h1(page, "Build a look")).toBeVisible();
    await expect(page.getByText("Pick an outfit to build your first look.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Build this look" })).toBeDisabled();
    await expect(page.getByText(/Jewellery try-on needs a mask/)).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "look-empty");
  });
});

test.describe("Look Studio: slots", () => {
  test("a sample outfit fills the slot, and the makeup suggestion says why", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await withProfile(page, context, request);
    await page.goto("/look");
    await pickSample(page, "outfit", /Sample lehenga, deep red/);
    await expect(page.getByText("Sample lehenga, deep red (sample)")).toBeVisible();
    // The suggestion names a lip colour and says which rule picked it.
    await expect(page.getByRole("list", { name: "Suggested makeup" })).toContainText("Lip: Sample");
    await expect(page.getByText(/Its hue sits near/).first()).toBeVisible();
    await expect(page.getByText("Pick an outfit to build your first look.")).toHaveCount(0);
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "look-slots");
  });

  test("a pasted product link is read, quoted, and then used", async ({
    page,
    context,
    request,
  }) => {
    await withProfile(page, context, request);
    await page.goto("/look");
    await page.getByRole("button", { name: "Pick an outfit" }).click();
    await page.getByLabel("Product page address").fill("fixture:sample-garment");
    await page.getByRole("button", { name: "Read this page" }).click();
    const sheet = page.locator(".mira-quote");
    await expect(sheet).toContainText("Read the colour of Sample lehenga, deep red?");
    await expect(sheet).toContainText("Removing the background");
    await sheet.getByRole("button", { name: "Read the colour" }).click();
    // The title came from the page. In sample mode the colour read is invented, so it says so.
    await expect(page.getByText("Sample lehenga, deep red (sample)")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole("button", { name: "Change outfit" })).toBeVisible();
  });

  test("a page with no garment picture says so and offers another way", async ({
    page,
    context,
    request,
  }) => {
    await withProfile(page, context, request);
    await page.goto("/look");
    await page.getByRole("button", { name: "Pick an outfit" }).click();
    await page.getByLabel("Product page address").fill("fixture:unreadable");
    await page.getByRole("button", { name: "Read this page" }).click();
    await expect(page.getByText(/No garment picture could be read from that page/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try another way" })).toBeVisible();
  });

  test("a private address is refused", async ({ page, context, request }) => {
    await withProfile(page, context, request);
    await page.goto("/look");
    await page.getByRole("button", { name: "Pick an outfit" }).click();
    await page.getByLabel("Product page address").fill("https://169.254.169.254/latest");
    await page.getByRole("button", { name: "Read this page" }).click();
    await expect(page.getByText("That address cannot be read.")).toBeVisible();
  });
});

test.describe("Look Studio: quote and build", () => {
  test("quote ready: per-step units, the video as the costliest step, and it can be removed", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await withProfile(page, context, request);
    await page.goto("/look");
    await pickSample(page, "outfit", /Sample lehenga, deep red/);
    await page.getByRole("switch", { name: "Make a short video" }).click();
    await addPhoto(page);
    await page.getByRole("button", { name: "Build this look" }).click();
    const sheet = page.locator(".mira-quote");
    await expect(sheet).toContainText("Trying on the outfit");
    await expect(sheet).toContainText("Making a short video");
    await expect(sheet).toContainText("Comparing your face with your profile");
    await expect(page.getByText(/The video is the costliest step/)).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "look-quote");
    await sheet.getByRole("button", { name: "Remove video" }).click();
    await expect(sheet).not.toContainText("Making a short video");
    await expect(page.getByText(/The video is the costliest step/)).toHaveCount(0);
  });

  test("over the session's units: Confirm is held back", async ({ page, context, request }) => {
    const who = await withProfile(page, context, request);
    await setCap(request, who, 5);
    await page.goto("/look");
    await pickSample(page, "outfit", /Sample lehenga, deep red/);
    await addPhoto(page);
    await page.getByRole("button", { name: "Build this look" }).click();
    await expect(page.locator(".mira-quote__cap")).toContainText("units and you have");
    await expect(page.getByRole("button", { name: "Build this look" }).last()).toBeDisabled();
  });

  test("a whole look is built in sample mode, labelled step by step, and can be saved", async ({
    page,
    context,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    await withProfile(page, context, request);
    await page.goto("/look");
    await pickSample(page, "outfit", /Sample lehenga, deep red/);
    await page.getByRole("button", { name: "Marigold-lit hall" }).click();
    await addPhoto(page);
    await page.getByRole("button", { name: "Build this look" }).click();
    await page.locator(".mira-quote").getByRole("button", { name: "Build this look" }).click();

    // Building: the steps in words, and the plate updates as they finish.
    await expect(h1(page, /Building your look|Your look/)).toBeVisible({ timeout: 30_000 });
    await expect(h1(page, /^Your look/)).toBeVisible({ timeout: 150_000 });
    await expect(page.getByText(/Sample results. The pictures are drawn/)).toBeVisible();
    await expect(page.getByText("Outfit verified").first()).toBeVisible();
    await expect(page.getByText("Makeup verified").first()).toBeVisible();
    // No check exists for these, and the label says so.
    await expect(page.getByText("Venue: no check exists for this yet").first()).toBeVisible();
    await expect(page.getByText("Your face is unchanged")).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "look-done");

    await page.getByRole("button", { name: "Save look" }).click();
    await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
  });
});

test.describe("Look Studio: results (crafted runs)", () => {
  const run = "run_lookcraft001";

  test("building: the steps in words, a plate so far, and a way to stop", async ({
    page,
    context,
    request,
  }, testInfo) => {
    const who = await withProfile(page, context, request);
    await serveCraftedLook(page, who.userId, run, undefined, {
      status: "running",
      running: ["outfit"],
    });
    await page.goto(`/look?run=${run}`);
    await expect(h1(page, "Building your look")).toBeVisible();
    await expect(page.getByRole("list", { name: "Building your look" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel remaining" })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "look-building");
  });

  test("video generating: a still plate is shown while the video is made", async ({
    page,
    context,
    request,
  }) => {
    const who = await withProfile(page, context, request);
    await serveCraftedLook(page, who.userId, run, undefined, {
      status: "running",
      running: ["video"],
    });
    await page.goto(`/look?run=${run}`);
    await expect(h1(page, "Making the video")).toBeVisible();
    await expect(page.getByText(/The video will follow/)).toBeVisible();
  });

  test("garment drift: the plate says the colour drifted, with Retry this step and Keep", async ({
    page,
    context,
    request,
  }, testInfo) => {
    const who = await withProfile(page, context, request);
    await serveCraftedLook(
      page,
      who.userId,
      run,
      lookResult({
        steps: [
          lookStep("outfit", { verdict: "drift", de: 9.1, direction: "lighter" }),
          lookStep("makeup", { verdict: "verified", de: 1.1 }),
        ],
        plate: "makeup",
        video: { status: "skipped", reason: "audit_not_passed" },
      }),
    );
    await page.goto(`/look?run=${run}`);
    await expect(page.getByText("Colour drifted").first()).toBeVisible();
    await expect(
      page.getByText("The garment's colour drifted from the product. Check before buying."),
    ).toBeVisible();
    await expect(
      page.getByText(/The garment reads lighter than the product, by ΔE 9.1/),
    ).toBeVisible();
    await expect(page.getByText(/A check did not pass, so no video was made/)).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "look-garment-drift");
    await page.getByRole("button", { name: "Keep" }).click();
    await expect(page.getByRole("button", { name: "Retry this step" })).toHaveCount(0);
    // Keeping it does not turn a drift into a pass: the label stays.
    await expect(page.getByText("Colour drifted").first()).toBeVisible();
  });

  test("identity drift: nothing is shown, and the person can retry or skip a step", async ({
    page,
    context,
    request,
  }, testInfo) => {
    const who = await withProfile(page, context, request);
    await serveCraftedLook(
      page,
      who.userId,
      run,
      lookResult({
        steps: [
          lookStep("outfit", { verdict: "withheld", reason: "identity_drift" }),
          lookStep("makeup", { verdict: "withheld", reason: "identity_drift" }),
        ],
        identity: { verdict: "withheld", drift: 0.14, max: 0.08 },
        plate: undefined,
        withheld: ["outfit", "makeup"],
      }),
      { withheld: true },
    );
    await page.goto(`/look?run=${run}`);
    await expect(
      page.getByText("This preview changed your face, so MIRA did not show it."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip step" })).toBeVisible();
    // A withheld look cannot be saved or shared.
    await expect(page.getByRole("button", { name: "Save look" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Share" })).toBeDisabled();
    await expect(page.getByRole("img", { name: "Your look, as built" })).toHaveCount(0);
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "look-identity-drift");
  });

  test("done with a video: the still and the video, a fidelity label per element", async ({
    page,
    context,
    request,
  }) => {
    const who = await withProfile(page, context, request);
    await serveCraftedLook(
      page,
      who.userId,
      run,
      lookResult({ video: { status: "done", node: "video" } }),
    );
    await page.goto(`/look?run=${run}`);
    await expect(page.getByText("Outfit verified").first()).toBeVisible();
    await expect(page.getByText("Makeup verified").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Motion" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save look" })).toBeEnabled();
  });

  test("a step that could not be checked is 'not checked', never 'verified'", async ({
    page,
    context,
    request,
  }) => {
    const who = await withProfile(page, context, request);
    await serveCraftedLook(
      page,
      who.userId,
      run,
      lookResult({
        steps: [
          lookStep("outfit", { verdict: "not_checked", reason: "torso_unchanged" }),
          lookStep("makeup", { verdict: "verified", de: 1.1 }),
        ],
        plate: "makeup",
        video: { status: "skipped", reason: "audit_not_passed" },
      }),
    );
    await page.goto(`/look?run=${run}`);
    await expect(page.getByText("Outfit not checked").first()).toBeVisible();
    await expect(page.getByText("The preview may still show your own clothes.")).toBeVisible();
    await expect(page.getByText("Outfit verified")).toHaveCount(0);
  });

  test("partial: a step that failed says why, and the rest still show", async ({
    page,
    context,
    request,
  }) => {
    const who = await withProfile(page, context, request);
    await serveCraftedLook(
      page,
      who.userId,
      run,
      lookResult({
        steps: [
          lookStep("outfit", { verdict: "verified", de: 2.4 }),
          lookStep("hair", { verdict: "failed", reason: "no_face" }),
        ],
        plate: "outfit",
        identity: { verdict: "not_checked", reason: "no_face_read" },
      }),
      { status: "partial" },
    );
    await page.goto(`/look?run=${run}`);
    await expect(page.getByText("Hair: No face was found in the photo.")).toBeVisible();
    await expect(page.getByText("Outfit verified").first()).toBeVisible();
    await expect(page.getByText("Your face was not compared")).toBeVisible();
  });

  test("a look that could not be made says so with a way on", async ({
    page,
    context,
    request,
  }) => {
    const who = await withProfile(page, context, request);
    await serveCraftedLook(page, who.userId, run, undefined, { status: "failed" });
    await page.goto(`/look?run=${run}`);
    await expect(page.locator(".mira-error")).toContainText("No look could be made.");
    await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
  });

  test("an expired preview says it was deleted", async ({ page, context, request }) => {
    const who = await withProfile(page, context, request);
    await serveCraftedLook(page, who.userId, run, lookResult());
    await page.route(`**/api/runs/${run}/images/*`, (route) =>
      route.fulfill({ status: 404, json: { error: "image_gone" } }),
    );
    await page.goto(`/look?run=${run}`);
    await expect(page.getByText("This image has expired and was deleted.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save look" })).toBeDisabled();
  });
});
