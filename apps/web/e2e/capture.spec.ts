import { expect, test, type Page } from "@playwright/test";
import { blockCameraKit, initArgs, installFakeCameraKit } from "./fake-camera-kit";
import { WORKFLOWS, jpegBytes, sessionOf, setCap } from "./fixtures";
import { expectAccessible, snapshotForReview } from "./helpers";

const allow = async (page: Page) => {
  await page.getByRole("button", { name: "Allow camera" }).click();
};
/** MIRA checks the camera's resolution before loading Camera Kit, so the SDK arrives a moment later. */
const sdkReady = async (page: Page) => {
  await page.waitForFunction(() => "__ymk" in window);
};
const takePhoto = async (page: Page, size?: { width: number; height: number }) => {
  await page.waitForFunction(
    () => "__ymk" in window && window.__ymk.listenerCount("faceDetectionCaptured") > 0,
  );
  await page.evaluate((s) => window.__ymk.capture(s), size);
};
const good = async (page: Page) => {
  await page.waitForFunction(
    () => "__ymk" in window && window.__ymk.listenerCount("faceQualityChanged") > 0,
  );
  await page.evaluate(() => {
    window.__ymk.good();
  });
};
const quality = async (page: Page, q: object) => {
  await page.waitForFunction(
    () => "__ymk" in window && window.__ymk.listenerCount("faceQualityChanged") > 0,
  );
  await page.evaluate((payload) => {
    window.__ymk.emit("faceQualityChanged", payload);
  }, q);
};
const heading = (page: Page, name: string | RegExp) =>
  page.getByRole("heading", { level: 1, name });
const pendingPhotos = async (page: Page, request: Parameters<typeof setCap>[0]) => {
  const who = await sessionOf(page.context(), page);
  const inv = await request.get(`${WORKFLOWS}/internal/twin/${who.userId}/inventory`);
  return ((await inv.json()) as { pendingUploads: number }).pendingUploads;
};

test.describe("Capture: measuring is one face photo by default", () => {
  test("the default is one photo, then the price: no step rail, a plain step count", async ({
    page,
  }) => {
    await page.goto("/capture");
    await expect(page.getByText("Step 1 of 2: your photo")).toBeVisible();
    await expect(page.getByRole("list", { name: "Capture steps" })).toHaveCount(0);
    await page.getByRole("button", { name: "Upload a photo instead" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "me.jpg",
      mimeType: "image/jpeg",
      buffer: jpegBytes(1200, 1600, 4242),
    });
    await page.getByRole("button", { name: "Use this photo" }).click();
    await expect(page.getByText("Step 2 of 2: check the price and start")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start measuring" })).toBeVisible();
  });
});

test.describe("Capture: the camera (UX_FLOWS §3)", () => {
  test.beforeEach(async ({ page }) => {
    await installFakeCameraKit(page);
  });

  test("permission prompt: says what happens, offers the camera and an upload", async ({
    page,
  }, testInfo) => {
    await page.goto("/capture?step=all");
    await expect(heading(page, "Your face")).toBeVisible();
    await expect(
      page.getByText("MIRA needs your camera to measure. Nothing is recorded until you capture."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Allow camera" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload a photo instead" })).toBeVisible();
    // The face step is required: there is no skip.
    await expect(page.getByRole("button", { name: "Skip this step" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Capture steps" })).toContainText("Face photo");
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "capture-permission");
  });

  test("loads the SDK as documented: HD skin capture, 1080p, a 3 second hold, blob images", async ({
    page,
  }) => {
    await page.goto("/capture?step=all");
    await allow(page);
    const args = await initArgs(page);
    expect(args).toMatchObject({
      faceDetectionMode: "hdskincare",
      videoQuality: "1080p",
      imageFormat: "blob",
      countingDuration: 3000,
    });
  });

  test("checking: one instruction names the failing check, and the Ring counts the passes", async ({
    page,
  }, testInfo) => {
    await page.goto("/capture?step=all");
    await allow(page);
    const ring = page.getByRole("group", { name: /Capture checks/ });
    await quality(page, { hasFace: false });
    await expect(page.getByText("Bring your face into the frame.")).toBeVisible();
    await quality(page, { hasFace: true, position: "toosmall", frontal: "good", lighting: "good" });
    await expect(page.getByText("Move a little closer.")).toBeVisible();
    await expect(ring).toHaveAttribute("aria-label", /Capture checks: 2 of 4 passed/);
    await quality(page, { hasFace: true, position: "notgood", frontal: "good", lighting: "good" });
    await expect(page.getByText("Move back a little.")).toBeVisible();
    await quality(page, { hasFace: true, position: "good", frontal: "notgood", lighting: "good" });
    await expect(page.getByText("Look straight at the camera.")).toBeVisible();
    await expect(ring).toHaveAttribute("aria-label", /Capture checks: 2 of 4 passed/);
    await quality(page, { hasFace: true, position: "good", frontal: "good", lighting: "notgood" });
    await expect(
      page.getByText("Face a window or a lamp so your face is evenly lit."),
    ).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "capture-checking");
  });

  test("ready: all four ticks light after the face holds, then the countdown", async ({ page }) => {
    await page.goto("/capture?step=all");
    await allow(page);
    await good(page);
    await expect(page.getByRole("group", { name: /Capture checks/ })).toHaveAttribute(
      "aria-label",
      /Capture checks: 3 of 4 passed/,
    );
    await expect(page.getByText(/Hold still\. Taking the photo in \d/)).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole("group", { name: /Capture checks/ })).toHaveAttribute(
      "aria-label",
      /Capture checks: 4 of 4 passed/,
    );
  });

  test("permission denied: says how to turn the camera on, and offers an upload", async ({
    page,
  }, testInfo) => {
    await page.goto("/capture?step=all");
    await allow(page);
    await sdkReady(page);
    await page.evaluate(() => {
      window.__ymk.emit("cameraFailed", "error_permission_denied");
    });
    await expect(
      page.getByText(
        "Camera access is off. Turn it on in your browser settings, or upload a photo.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "How to turn it on" }).click();
    await expect(page.getByText("allow the camera for this site")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload a photo instead" })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "capture-denied");
  });

  test("low camera resolution: continues in standard detail with the standard capture mode", async ({
    page,
  }) => {
    await page.goto("/capture?step=all");
    await allow(page);
    await sdkReady(page);
    await page.evaluate(() => {
      window.__ymk.emit("unsupportedResolution");
    });
    await expect(
      page.getByText(
        "This camera cannot capture the detail HD measuring needs. MIRA will measure in standard detail.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload a sharper photo" })).toBeVisible();
    await page.getByRole("button", { name: "Continue in standard" }).click();
    const args = await initArgs(page);
    expect(args.faceDetectionMode).toBe("comprehensive");
    expect(args.videoQuality).toBeUndefined();
  });

  test("a laptop camera below the HD requirement gets MIRA's choice, not the SDK's refusal", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__cameraLongSide = 1920;
    });
    await page.goto("/capture?step=all");
    await allow(page);
    await expect(
      page.getByText(
        "This camera cannot capture the detail HD measuring needs. MIRA will measure in standard detail.",
      ),
    ).toBeVisible();
    // MIRA decided before the SDK was asked for HD, so the SDK never drew its own message.
    expect(
      await page.evaluate(
        () =>
          (window as { __ymk?: Window["__ymk"] }).__ymk?.calls.some((c) => c.op === "init") ??
          false,
      ),
    ).toBe(false);
    await page.getByRole("button", { name: "Continue in standard" }).click();
    const args = await initArgs(page);
    expect(args.faceDetectionMode).toBe("comprehensive");
  });

  test("camera failed for another reason: names it and offers retry and upload", async ({
    page,
  }) => {
    await page.goto("/capture?step=all");
    await allow(page);
    await sdkReady(page);
    await page.evaluate(() => {
      window.__ymk.emit("cameraFailed", "error_access_failed");
    });
    await expect(page.getByText(/The camera could not be opened/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try the camera again" })).toBeVisible();
  });

  test("capture, upload and review; Retake deletes the uploaded photo", async ({
    page,
    request,
  }, testInfo) => {
    await page.goto("/capture?step=all");
    await allow(page);
    await takePhoto(page);
    await expect(page.getByRole("img", { name: "The photo you just took" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use this photo" })).toBeVisible();
    expect(await pendingPhotos(page, request)).toBe(1);
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "capture-review");

    await page.getByRole("button", { name: "Retake" }).click();
    await expect.poll(() => pendingPhotos(page, request)).toBe(0);
    await expect(page.getByRole("group", { name: /Capture checks/ })).toBeVisible();
  });

  test("cancelling while a photo is in review deletes it", async ({ page, request }) => {
    await page.goto("/capture?step=all");
    await allow(page);
    await takePhoto(page);
    await expect(page.getByRole("button", { name: "Use this photo" })).toBeVisible();
    expect(await pendingPhotos(page, request)).toBe(1);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL("/");
    await expect.poll(() => pendingPhotos(page, request)).toBe(0);
  });

  test("a photo that is replaced is deleted, not left waiting", async ({ page, request }) => {
    await page.goto("/capture?step=all");
    await allow(page);
    await takePhoto(page);
    await page.getByRole("button", { name: "Use this photo" }).click();
    await expect(heading(page, /Two more photos/)).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(heading(page, "Your face")).toBeVisible();
    await allow(page);
    await takePhoto(page);
    await page.getByRole("button", { name: "Use this photo" }).click();
    await expect(heading(page, /Two more photos/)).toBeVisible();
    // Only the new face is held: the old one was replaced and deleted.
    await expect.poll(() => pendingPhotos(page, request)).toBe(1);
  });

  test("a build with no confirmed total is refused", async ({ page }) => {
    await page.goto("/");
    const res = await page.request.post("/api/twin/build", {
      data: {
        capture: {
          face: "uploads/x/y.jpg",
          mode: "hd",
          source: "upload",
          qualityChecksPassed: null,
        },
      },
    });
    expect(res.status()).toBe(400);
  });

  test("a photo below HD size is accepted for standard detail", async ({ page }) => {
    await page.goto("/capture?step=all");
    await allow(page);
    await takePhoto(page, { width: 720, height: 960 });
    await page.getByRole("button", { name: "Use this photo" }).click();
    await expect(heading(page, /Two more photos/)).toBeVisible();
  });

  test("the sequence: face, two repeats a few seconds apart, then the optional steps can be skipped", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/capture?step=all");
    await allow(page);
    await takePhoto(page);
    await page.getByRole("button", { name: "Use this photo" }).click();

    await expect(heading(page, "Two more photos: 1 of 2")).toBeVisible();
    // The repeats go straight to the camera: it was already allowed.
    await takePhoto(page);
    await expect(page.getByText("Stay where you are. The next photo is coming.")).toBeVisible();
    await expect(heading(page, "Two more photos: 2 of 2")).toBeVisible({ timeout: 8_000 });
    await takePhoto(page);

    await expect(heading(page, "Your full body")).toBeVisible();
    await expect(page.getByText("Wear a plain, light top.")).toBeVisible();
    await page.getByRole("button", { name: "Skip this step" }).click();
    await expect(heading(page, "Your hand")).toBeVisible();
    await page.getByRole("button", { name: "Skip this step" }).click();
    await expect(heading(page, "Your hair")).toBeVisible();
    await page.getByRole("button", { name: "Skip this step" }).click();

    // Now the price, before anything is spent.
    await expect(page.getByRole("heading", { name: "Measuring you" })).toBeVisible();
    expect(await pendingPhotos(page, request)).toBe(3);
  });
});

test.describe("Capture: uploading instead", () => {
  const photo = (name: string, buffer: Buffer, mimeType = "image/jpeg") => ({
    name,
    mimeType,
    buffer,
  });

  test("a good photo is checked on the server and reviewed", async ({ page }) => {
    await page.goto("/capture?step=all");
    await page.getByRole("button", { name: "Upload a photo instead" }).click();
    await page
      .locator('input[type="file"]')
      .setInputFiles(photo("me.jpg", jpegBytes(1200, 1600, 7)));
    await expect(page.getByRole("button", { name: "Use this photo" })).toBeVisible();
  });

  test("each refusal says what is wrong and how to fix it", async ({ page }, testInfo) => {
    await page.goto("/capture?step=all");
    await page.getByRole("button", { name: "Upload a photo instead" }).click();
    const file = page.locator('input[type="file"]');

    await file.setInputFiles(photo("notes.txt", Buffer.from("not a photo"), "text/plain"));
    await expect(
      page.getByText("That file is not a JPEG or PNG photo. Choose a different one."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Choose another photo" }).click();
    await file.setInputFiles(photo("tiny.jpg", jpegBytes(300, 400, 8)));
    await expect(
      page.getByText(
        "That photo is too small to measure. Use one at least 480 pixels on its shorter side.",
      ),
    ).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "capture-upload-error");

    await page.getByRole("button", { name: "Choose another photo" }).click();
    await file.setInputFiles(photo("empty.jpg", Buffer.alloc(0)));
    await expect(page.getByText("That file is empty. Choose a different photo.")).toBeVisible();
  });

  test("the camera can be chosen again from the upload screen", async ({ page }) => {
    await installFakeCameraKit(page);
    await page.goto("/capture?step=all");
    await page.getByRole("button", { name: "Upload a photo instead" }).click();
    await page.getByRole("button", { name: "Use the camera instead" }).click();
    await expect(page.getByRole("group", { name: /Capture checks/ })).toBeVisible();
  });

  test("hair: front is enough; right and left come as a pair", async ({ page }) => {
    await page.goto("/capture?only=hair");
    await expect(heading(page, "Your hair")).toBeVisible();
    await page.getByRole("button", { name: "Upload a photo instead" }).click();
    await expect(page.getByText("Hair, from the front")).toBeVisible();
    await expect(
      page.getByText(/Hair, from the right \(optional, right and left together\)/),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Use these photos" })).toBeDisabled();
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(photo("hf.jpg", jpegBytes(1200, 1600, 9)));
    await page.getByRole("button", { name: "Use these photos" }).click();
    await expect(page.getByRole("button", { name: "Use this photo" })).toBeVisible();
  });
});

test.describe("Capture: when the camera is not available", () => {
  test("a browser with no camera API goes to the upload path", async ({ page }) => {
    await installFakeCameraKit(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    });
    await page.goto("/capture?step=all");
    await allow(page);
    await expect(
      page.getByText("This browser cannot open the camera. Upload a photo instead."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload a photo instead" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try the camera again" })).toHaveCount(0);
    await expectAccessible(page);
  });

  test("a camera tool that cannot be loaded says so and offers an upload", async ({ page }) => {
    await blockCameraKit(page);
    await page.goto("/capture?step=all");
    await allow(page);
    await expect(page.getByText("The camera tool could not be loaded.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try the camera again" })).toBeVisible();
  });
});

test.describe("Capture: the price and the build", () => {
  const through = async (page: Page, size = { width: 1200, height: 1600 }) => {
    await installFakeCameraKit(page);
    await page.goto("/capture?step=all");
    await allow(page);
    await takePhoto(page, size);
    await page.getByRole("button", { name: "Use this photo" }).click();
    await page.getByRole("button", { name: "Skip this step" }).click(); // repeats
    await page.getByRole("button", { name: "Skip this step" }).click(); // body
    await page.getByRole("button", { name: "Skip this step" }).click(); // hand
    await page.getByRole("button", { name: "Skip this step" }).click(); // hair
  };

  test("quotes every step before spending: units per step and a total", async ({
    page,
    context,
    request,
  }, testInfo) => {
    const who = await sessionOf(context, page);
    await setCap(request, who, 400);
    await through(page);
    const sheet = page.locator(".mira-quote");
    await expect(sheet.getByRole("heading", { name: "Measuring you" })).toBeVisible();
    await expect(sheet.getByRole("row", { name: /Skin analysis/ })).toContainText("16");
    await expect(sheet.getByRole("row", { name: /Skin, lip, eye and hair colour/ })).toContainText(
      "20",
    );
    await expect(sheet.getByRole("row", { name: /Skin tone band/ })).toContainText("10");
    await expect(sheet.getByRole("row", { name: /Face proportions/ })).toContainText("10");
    await expect(sheet.getByRole("row", { name: /Total/ })).toContainText("56");
    await expect(
      page.getByText("Your photos are deleted when the run ends. A failed step is not charged."),
    ).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "capture-quote");
  });

  test("over the session's units: says so and does not allow starting", async ({
    page,
    context,
    request,
  }) => {
    const who = await sessionOf(context, page);
    await setCap(request, who, 30);
    await through(page);
    await expect(page.locator(".mira-quote__cap")).toContainText(
      "This plan would use 56 units and you have 30 left",
    );
    await expect(page.getByRole("button", { name: "Start measuring" })).toBeDisabled();
  });

  test("a photo below HD size says the profile will be measured in standard detail", async ({
    page,
    context,
    request,
  }) => {
    const who = await sessionOf(context, page);
    await setCap(request, who, 400);
    await through(page, { width: 720, height: 960 });
    await expect(
      page.getByText("A photo is below HD size, so MIRA will measure in standard detail."),
    ).toBeVisible();
    // Standard detail is priced from its own tier (8 concerns: 12 units, not 16).
    await expect(
      page.locator(".mira-quote").getByRole("row", { name: /Skin analysis/ }),
    ).toContainText("12");
  });

  test("cancelling deletes the photos and goes home", async ({ page, context, request }) => {
    const who = await sessionOf(context, page);
    await setCap(request, who, 400);
    await through(page);
    await expect(page.getByRole("heading", { name: "Measuring you" })).toBeVisible();
    expect(await pendingPhotos(page, request)).toBe(1);
    await page.locator(".mira-quote").getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL("/");
    await expect.poll(() => pendingPhotos(page, request)).toBe(0);
  });

  test("repeat photos can be left out, and the price follows", async ({
    page,
    context,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-light", "One pass is enough.");
    test.setTimeout(60_000);
    const who = await sessionOf(context, page);
    await setCap(request, who, 400);
    await installFakeCameraKit(page);
    await page.goto("/capture?step=all");
    await allow(page);
    await takePhoto(page);
    await page.getByRole("button", { name: "Use this photo" }).click();
    await takePhoto(page);
    await expect(heading(page, "Two more photos: 2 of 2")).toBeVisible({ timeout: 8_000 });
    await takePhoto(page);
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Skip this step" }).click();

    const sheet = page.locator(".mira-quote");
    await expect(sheet.getByRole("row", { name: /Total/ })).toContainText("88");
    const second = page.getByRole("checkbox", { name: /Repeat photo 2/ });
    await expect(second).toBeChecked();
    await second.uncheck();
    await expect(sheet.getByRole("row", { name: /Total/ })).toContainText("72", { timeout: 5_000 });
    await expect(sheet.getByRole("row", { name: /Repeat photo 2/ })).toHaveCount(0);
  });

  test("confirming starts the run, builds the profile and leaves no photo behind", async ({
    page,
    context,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-light", "One full run is enough.");
    test.setTimeout(120_000);
    const who = await sessionOf(context, page);
    await setCap(request, who, 400);
    await through(page);
    await page.getByRole("button", { name: "Start measuring" }).click();
    await expect(page).toHaveURL(/\/profile\?run=run_/);
    await expect(page.getByRole("heading", { name: "Measuring you" })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Your measured profile" }),
    ).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/in HD detail from the camera/)).toBeVisible();
    expect(await pendingPhotos(page, request)).toBe(0);
    await snapshotForReview(page, testInfo, "capture-to-profile");
  });

  test("a retry plan asks only for what it needs", async ({ page }) => {
    await page.goto("/capture?only=face");
    await expect(heading(page, "Your face")).toBeVisible();
    // One photo needs no list of steps.
    await expect(page.getByText("Step 1 of 2: your photo")).toBeVisible();
    await expect(page.getByRole("list", { name: "Capture steps" })).toHaveCount(0);
    await page.goto("/capture?step=repeats");
    await expect(
      page.getByRole("list", { name: "Capture steps" }).getByRole("listitem"),
    ).toHaveCount(2);
  });
});

test.describe("Capture: body and hand use a plain camera", () => {
  test.use({ permissions: ["camera"] });

  test("the full-body photo is taken on a timer and held, not measured", async ({
    page,
    context,
    request,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "The fake device is the same; one browser size is enough.",
    );
    test.setTimeout(60_000);
    const who = await sessionOf(context, page);
    await setCap(request, who, 400);
    await installFakeCameraKit(page);
    await page.goto("/capture?step=all");
    await allow(page);
    await takePhoto(page);
    await page.getByRole("button", { name: "Use this photo" }).click();
    await page.getByRole("button", { name: "Skip this step" }).click();

    await expect(heading(page, "Your full body")).toBeVisible();
    await page.getByRole("button", { name: "Allow camera" }).click();
    const timer = page.getByRole("button", { name: /Take photo in 5 seconds/ });
    await expect(timer).toBeEnabled({ timeout: 10_000 });
    await timer.click();
    await expect(page.getByRole("button", { name: /Taking photo in/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use this photo" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Use this photo" }).click();
    await expect(heading(page, "Your hand")).toBeVisible();

    // Two photos are held now: the face for the run and the body for later.
    expect(await pendingPhotos(page, request)).toBe(2);
    const inv = await request.get(`${WORKFLOWS}/internal/twin/${who.userId}/inventory`);
    const kinds = ((await inv.json()) as { heldPhotos: { kind: string }[] }).heldPhotos.map(
      (p) => p.kind,
    );
    expect(kinds).toContain("body");
  });
});
