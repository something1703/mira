import { expect, test, type Page } from "@playwright/test";
import { jpegBytes, makeProof, seedProof, sessionOf, setCap, type ProofOptions } from "./fixtures";
import { expectAccessible, snapshotForReview } from "./helpers";

/** Proof (docs/UX_FLOWS.md §8): every state. */

const h1 = (page: Page, name: string | RegExp) => page.getByRole("heading", { level: 1, name });
const PROOF = "prf_proofe2e0001";

async function seeded(
  page: Page,
  context: Parameters<typeof sessionOf>[0],
  request: Parameters<typeof seedProof>[0],
  options: ProofOptions = {},
) {
  const who = await sessionOf(context, page);
  await setCap(request, who, 400);
  await seedProof(request, makeProof(who.userId, PROOF, options));
  await page.goto(`/proof?p=${PROOF}`);
  return who;
}

let uploads = 0;
/** Each upload is a different picture in every project: identical pictures are answered from the saved-result cache and cost nothing. */
async function upload(page: Page, salt: number) {
  uploads += 1;
  const unique = salt * 1000 + uploads + (Date.now() % 997);
  await page.getByRole("button", { name: "Upload a photo instead" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: `p${String(salt)}.jpg`,
    mimeType: "image/jpeg",
    buffer: jpegBytes(1200, 1600, unique),
  });
  await page.getByRole("button", { name: "Use this photo" }).click();
}

const checkIn = (
  daysAgo: number,
  verdict: NonNullable<ProofOptions["checkIns"]>[number]["verdict"],
  words: NonNullable<ProofOptions["checkIns"]>[number]["words"],
  scores: [number, number, number],
) => ({ daysAgo, verdict, words, scores });

test.describe("Proof: adding a product", () => {
  test("empty: invites one action", async ({ page }, testInfo) => {
    await page.goto("/proof");
    await expect(page.getByText("You have not started a progress check.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a product" })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "proof-empty");
  });

  test("claim extracted: shown back, editable, then the product is added", async ({
    page,
  }, testInfo) => {
    await page.goto("/proof?add=1");
    await page.getByLabel("Product page address").fill("fixture:sample-serum");
    await page.getByRole("button", { name: "Read this page" }).click();
    await expect(h1(page, "Sample pore serum")).toBeVisible();
    await expect(page.getByText("This product claims: visible pores, over 28 days.")).toBeVisible();
    await expect(
      page.getByText("Pores look visibly smaller in 4 weeks with daily use."),
    ).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "proof-claim");
    await page.getByRole("button", { name: "Confirm claim" }).click();
    await expect(page).toHaveURL(/\/proof\?p=prf_/);
    await expect(page.getByRole("heading", { name: "Baseline needed" })).toBeVisible();
  });

  test("claim can be edited before it is confirmed", async ({ page }) => {
    await page.goto("/proof?add=1");
    await page.getByLabel("Product page address").fill("fixture:sample-serum");
    await page.getByRole("button", { name: "Read this page" }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("What do you want to track?").selectOption("texture");
    await page.getByLabel("Over how long?").selectOption("56");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("This product claims: skin texture, over 56 days.")).toBeVisible();
  });

  test("no claim found: says so and lets the person choose", async ({ page }, testInfo) => {
    await page.goto("/proof?add=1");
    await page.getByLabel("Product page address").fill("fixture:unreadable");
    await page.getByRole("button", { name: "Read this page" }).click();
    await expect(
      page.getByText("No measurable claim found on this page. Choose what you want to track."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await page.getByLabel("What do you want to track?").selectOption("oiliness");
    await page.getByLabel("Over how long?").selectOption("28");
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "proof-no-claim");
  });

  test("a page with a concern but no timeframe asks only for the timeframe", async ({ page }) => {
    await page.goto("/proof?add=1");
    await page.getByLabel("Product page address").fill("fixture:sample-toner");
    await page.getByRole("button", { name: "Read this page" }).click();
    await expect(page.getByLabel("What do you want to track?")).toHaveValue("redness");
    await expect(page.getByLabel("Over how long?")).toHaveValue("");
  });

  test("typing a name goes straight to choosing a concern", async ({ page }) => {
    await page.goto("/proof?add=1");
    await page.getByLabel("Or type the product's name").fill("My night cream");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(h1(page, "My night cream")).toBeVisible();
    await expect(page.getByLabel("What do you want to track?")).toBeVisible();
  });

  test("a private address is refused", async ({ page }) => {
    await page.goto("/proof?add=1");
    await page.getByLabel("Product page address").fill("https://169.254.169.254/x");
    await page.getByRole("button", { name: "Read this page" }).click();
    await expect(page.getByText("That address cannot be read.")).toBeVisible();
  });
});

test.describe("Proof: baseline and calibration", () => {
  test("baseline needed: the progress, and a session that is a different day", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await seeded(page, context, request, { baselineDaysAgo: [1] });
    await expect(
      page.getByText("MIRA needs 3 captures on different days to learn your day-to-day variation."),
    ).toBeVisible();
    await expect(page.getByText("1 of 3", { exact: true })).toBeVisible();
    // The last session was a day ago, so the next can be made now.
    await expect(page.getByRole("button", { name: "Capture now" })).toBeEnabled();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "proof-baseline");
  });

  test("a session the same day is held back, and says when", async ({ page, context, request }) => {
    await seeded(page, context, request, { baselineDaysAgo: [0.01] });
    await expect(page.getByRole("button", { name: "Capture now" })).toBeDisabled();
    await expect(page.getByText(/Your next session can be taken after/)).toBeVisible();
  });

  test("a session of three photos is quoted, measured and recorded", async ({
    page,
    context,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    await seeded(page, context, request, { baselineDaysAgo: [1] });
    await page.getByRole("button", { name: "Capture now" }).click();
    await expect(page.getByRole("heading", { name: "Photo 1 of 3" })).toBeVisible();
    await upload(page, 31);
    await expect(page.getByRole("heading", { name: "Photo 2 of 3" })).toBeVisible();
    await upload(page, 32);
    await expect(page.getByRole("heading", { name: "Photo 3 of 3" })).toBeVisible();
    await upload(page, 33);
    const sheet = page.locator(".mira-quote");
    await expect(sheet).toContainText("Measuring each photo");
    // Three analyses of one concern.
    await expect(sheet.getByRole("row", { name: /^Total/ })).toContainText("36 units");
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "proof-session-quote");
    await sheet.getByRole("button", { name: "Add this session" }).click();
    await page.getByRole("button", { name: "Continue" }).click({ timeout: 90_000 });
    await expect(page.getByText("2 of 3", { exact: true })).toBeVisible();
    // The chart now has two sessions.
    await expect(page.getByTestId("session")).toHaveCount(2);
  });

  test("baseline complete: the learned variation, and calibration is optional", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await seeded(page, context, request);
    await expect(page.getByRole("heading", { name: "Your baseline is set" })).toBeVisible();
    await expect(
      page.getByText(/A change smaller than 3.3 points is within your day-to-day variation/),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Calibrate the visualisation" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "I have started using it" })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "proof-ready");
  });

  test("variation not known: calibration is held back and the page says so", async ({
    page,
    context,
    request,
  }) => {
    await seeded(page, context, request, { mdc: null });
    await expect(page.getByText(/could not work out your day-to-day variation/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Calibrate the visualisation" })).toBeDisabled();
  });

  test("calibration not usable: numbers only", async ({ page, context, request }) => {
    await seeded(page, context, request, { phantom: "unusable" });
    await expect(
      page.getByText(
        "MIRA cannot visualise changes for this concern reliably, so it will report numbers only.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Preview the smallest change/ })).toHaveCount(0);
  });

  test("calibrated: the claim preview is labelled a visualisation", async ({
    page,
    context,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    await seeded(page, context, request, { phantom: "usable" });
    await page.getByRole("button", { name: /Preview the smallest change/ }).click();
    await upload(page, 41);
    await page.locator(".mira-quote").getByRole("button", { name: "Show it" }).click();
    await expect(page.getByText(/Visualisation, not a prediction/).first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByRole("img", { name: /visualisation of today's photo/ })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "proof-preview");
  });

  test("calibrating shows the steps and ends with a usable or unusable sweep", async ({
    page,
    context,
    request,
  }, testInfo) => {
    test.setTimeout(150_000);
    await seeded(page, context, request);
    await page.getByRole("button", { name: "Calibrate the visualisation" }).click();
    await upload(page, 51);
    const sheet = page.locator(".mira-quote");
    await expect(sheet.getByRole("row", { name: /^Total/ })).toContainText("80 units");
    await sheet.getByRole("button", { name: "Calibrate" }).click();
    await expect(page.getByRole("list", { name: "Calibrate the visualisation" })).toBeVisible();
    await snapshotForReview(page, testInfo, "proof-calibrating");
    await page.getByRole("button", { name: "Continue" }).click({ timeout: 120_000 });
    await expect(
      page
        .getByRole("button", { name: /Preview the smallest change/ })
        .or(page.getByText(/report numbers only/)),
    ).toBeVisible();
  });

  test("starting: the claim window begins when the person says they started", async ({
    page,
    context,
    request,
  }) => {
    await seeded(page, context, request);
    await page.getByRole("button", { name: "I have started using it" }).click();
    await expect(page.getByText("No check-in yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Check in now" })).toBeVisible();
    // A vertical rule has no width, so it is attached rather than "visible".
    await expect(page.getByTestId("claim-rule")).toBeAttached();
  });
});

test.describe("Proof: verdicts", () => {
  const tracking = (extra: ProofOptions): ProofOptions => ({
    status: "tracking",
    startedDaysAgo: 14,
    ...extra,
  });

  test("detected: the sentence, the reading against its noise band, the chart, the evidence", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await seeded(
      page,
      context,
      request,
      tracking({ checkIns: [checkIn(1, "detected", "clear", [66.2, 65.1, 66.9])] }),
    );
    await expect(
      page.getByRole("heading", {
        name: "Visible pores changed more than your day-to-day variation.",
      }),
    ).toBeVisible();
    await expect(page.getByText("a clear change", { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId("noise-band")).toBeVisible();
    // A vertical rule has no width, so it is attached rather than "visible".
    await expect(page.getByTestId("claim-rule")).toBeAttached();
    await expect(page.getByTestId("session")).toHaveCount(4);
    await expect(page.getByText("Your baseline", { exact: true })).toBeVisible();
    await expect(page.getByText("Smallest change MIRA can tell apart")).toBeVisible();
    // The chart is described for screen readers, with the numbers.
    await expect(page.getByRole("img", { name: /Timeline of 4 sessions/ })).toBeVisible();
    await expect(page.locator(".mira-sr-only table tbody tr")).toHaveCount(4);
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "proof-detected");
  });

  test("not yet: the day count of the claim window, not a verdict that it is not working", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await seeded(
      page,
      context,
      request,
      tracking({ checkIns: [checkIn(1, "not_yet", "within", [58.9, 59.6, 58.4])] }),
    );
    await expect(
      page.getByRole("heading", {
        name: /No change we can tell apart from your day-to-day variation yet\. You are on day 13 of a 28-day claim\./,
      }),
    ).toBeVisible();
    await expect(page.getByText(/not working/i)).toHaveCount(0);
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "proof-not-yet");
  });

  test("window ended with no change: the honest sentence, stop or leave a review", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await seeded(page, context, request, {
      status: "ended",
      startedDaysAgo: 30,
      checkIns: [checkIn(1, "window_ended_no_change", "within", [58.9, 59.6, 58.4])],
    });
    await expect(
      page.getByRole("heading", {
        name: "No change MIRA can tell apart from your day-to-day variation over the claimed period.",
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Leave a measured review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop tracking" })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "proof-ended");
  });

  test("the wrong direction is said plainly", async ({ page, context, request }) => {
    await seeded(
      page,
      context,
      request,
      tracking({ checkIns: [checkIn(1, "opposite", "opposite", [52.1, 51.4, 52.6])] }),
    );
    await expect(
      page.getByRole("heading", {
        name: "Visible pores changed, but not in the direction the product claims.",
      }),
    ).toBeVisible();
  });

  test("while the variation is unknown there is no verdict, and the page says why", async ({
    page,
    context,
    request,
  }) => {
    await seeded(
      page,
      context,
      request,
      tracking({ mdc: null, checkIns: [checkIn(1, "collecting", "n/a", [58.9, 59.6, 58.4])] }),
    );
    await expect(
      page.getByRole("heading", {
        name: /does not know your day-to-day variation well enough yet/,
      }),
    ).toBeVisible();
    await expect(page.getByTestId("noise-band")).toHaveCount(0);
    await expect(page.getByText("not known yet")).toBeVisible();
  });

  test("confound warning: another product started; keep tracking or pause", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await seeded(
      page,
      context,
      request,
      tracking({ confound: true, checkIns: [checkIn(1, "not_yet", "within", [58.9, 59.6, 58.4])] }),
    );
    const warning = page.getByRole("alert").filter({
      hasText: "Two new products at once means MIRA cannot tell which one changed things.",
    });
    await expect(warning).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "proof-confound");
    await warning.getByRole("button", { name: "Keep tracking anyway" }).click();
    await expect(warning).toHaveCount(0);
    // Keeping going does not hide it: it stays beside the verdict.
    await expect(
      page.getByText("Two new products at once means MIRA cannot tell which one changed things."),
    ).toBeVisible();
  });

  test("pausing stops tracking", async ({ page, context, request }) => {
    await seeded(page, context, request, tracking({ confound: true }));
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("button", { name: "Remove this product" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Check in now" })).toHaveCount(0);
  });

  test("reporting another product raises the warning", async ({ page, context, request }) => {
    await seeded(page, context, request, tracking({}));
    await page.getByRole("button", { name: "I started another product" }).click();
    await expect(
      page.getByText("Two new products at once means MIRA cannot tell which one changed things."),
    ).toBeVisible();
  });
});

test.describe("Proof: check-ins and reminders", () => {
  const due = (): ProofOptions => ({
    status: "tracking",
    startedDaysAgo: 9,
    checkIns: [checkIn(8, "not_yet", "within", [58.9, 59.6, 58.4])],
  });

  test("check-in due: a reminder, check in now or remind me tomorrow", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await seeded(page, context, request, due());
    await expect(page.getByText(/Check-in due\./)).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "proof-due");
    await page.getByRole("button", { name: "Remind me tomorrow" }).click();
    await expect(page.getByText(/Check-in due\./)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(/Check-in due\./)).toHaveCount(0);
  });

  test("the reminder can be downloaded for the person's own calendar", async ({
    page,
    context,
    request,
  }) => {
    await seeded(page, context, request, due());
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Add a reminder to my calendar" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("mira-check-in.ics");
    const text = await (await import("node:fs/promises")).readFile(await download.path(), "utf8");
    expect(text).toContain("BEGIN:VEVENT");
    expect(text).toContain("SUMMARY:MIRA check-in: Sample pore serum");
  });

  test("checking in asks whether anything else changed first", async ({
    page,
    context,
    request,
  }) => {
    await seeded(page, context, request, due());
    await page.getByRole("button", { name: "Check in now" }).click();
    await expect(page.getByText(/Has anything else in your routine changed/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Check in now" })).toBeVisible();
    await page.getByRole("button", { name: "Check in now" }).click();
    await page.getByRole("button", { name: "No, nothing changed" }).click();
    await expect(page.getByRole("heading", { name: "Photo 1 of 3" })).toBeVisible();
  });

  test("a check-in right after the last one is held back", async ({ page, context, request }) => {
    await seeded(page, context, request, {
      status: "tracking",
      startedDaysAgo: 3,
      checkIns: [checkIn(0.01, "not_yet", "within", [58.9, 59.6, 58.4])],
    });
    await expect(page.getByRole("button", { name: "Check in now" })).toBeDisabled();
  });
});

test.describe("Proof: the measured review", () => {
  test("needs a yes, says what is shared, and publishes once", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await seeded(page, context, request, {
      status: "ended",
      startedDaysAgo: 30,
      checkIns: [checkIn(1, "window_ended_no_change", "within", [58.9, 59.6, 58.4])],
    });
    await page.getByRole("button", { name: "Leave a measured review" }).click();
    const dialog = page.getByRole("dialog", { name: "Leave a measured review?" });
    await expect(dialog).toContainText("It does not name you or include a photo.");
    await expect(dialog).toContainText("the product, the concern, the size of the change");
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "proof-review");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Leave a measured review" })).toBeVisible();
    await page.getByRole("button", { name: "Leave a measured review" }).click();
    await dialog.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Review published, anonymously. Thank you.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Leave a measured review" })).toHaveCount(0);
  });

  test("a product can be removed", async ({ page, context, request }) => {
    await seeded(page, context, request, { status: "stopped", startedDaysAgo: 10 });
    await page.getByRole("button", { name: "Remove this product" }).click();
    await expect(page).toHaveURL(/\/proof$/);
    await expect(page.getByText("You have not started a progress check.")).toBeVisible();
  });

  test("another person's product cannot be opened", async ({ page }) => {
    await page.goto("/proof?p=prf_notmine000001");
    await expect(page.getByText("That product could not be found.")).toBeVisible();
  });
});
