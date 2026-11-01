import { expect, test } from "@playwright/test";
import {
  buildFor,
  makeTwin,
  seedTwin,
  sessionOf,
  setCap,
  uploadPhoto,
  WORKFLOWS,
} from "./fixtures";
import { expectAccessible, snapshotForReview } from "./helpers";

test.describe("Settings and privacy (UX_FLOWS §11)", () => {
  test("nothing stored: says so and invites one action", async ({ page }, testInfo) => {
    await page.goto("/settings/privacy");
    await expect(
      page.getByRole("heading", { name: "MIRA is storing nothing about you." }),
    ).toBeVisible();
    await expect(page.getByText("Nothing has been deleted yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete my profile" })).toBeDisabled();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "privacy-empty");
  });

  test("default: every stored number, grouped, with where it came from", async ({
    page,
    context,
    request,
  }, testInfo) => {
    const who = await sessionOf(context, page);
    await seedTwin(request, makeTwin(who.userId, { noiseFloors: true }));
    await page.goto("/settings/privacy");

    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy and my data" }),
    ).toBeVisible();
    const skin = page.getByRole("table", { name: "Skin" });
    await expect(skin.getByRole("row", { name: /Visible pores/ })).toContainText("41.5 out of 100");
    await expect(skin.getByRole("row", { name: /Visible pores/ })).toContainText(
      "skin-analysis v2.1",
    );
    await expect(
      page.getByRole("table", { name: "Colouring" }).getByRole("row", { name: /Skin colour/ }),
    ).toContainText("#C79A78");
    await expect(page.getByRole("table", { name: "Face" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Hair" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Spread between repeat captures" })).toBeVisible();
    // The counts add up to everything the profile holds.
    const rows = await page.locator(".privacy__table tbody tr").count();
    expect(rows).toBe(3 + 5 + 3 + 2 + 1);
    await expect(page.getByText("Photos waiting to be used: 0")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download my data" })).toHaveAttribute(
      "href",
      "/api/twin/export",
    );
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "privacy-default");
  });

  test("Download my data is one JSON file of the stored values", async ({
    page,
    context,
    request,
  }) => {
    const who = await sessionOf(context, page);
    await seedTwin(request, makeTwin(who.userId));
    const res = await page.request.get("/api/twin/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const body = (await res.json()) as {
      format: string;
      profile: { metrics: Record<string, unknown> };
    };
    expect(body.format).toBe("mira-profile-export");
    expect(Object.keys(body.profile.metrics)).toContain("skin.hd_pore.whole");
    // No photo, and no address of one, is in the export.
    expect(JSON.stringify(body)).not.toMatch(/uploads\/|data:image|https?:\/\//);
  });

  test("Delete my profile asks first, can be cancelled, and then removes everything", async ({
    page,
    context,
    request,
  }, testInfo) => {
    const who = await sessionOf(context, page);
    await seedTwin(request, makeTwin(who.userId));
    await page.goto("/settings/privacy");

    await page.getByRole("button", { name: "Delete my profile" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete my profile?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("It cannot be undone.");
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "privacy-confirm");

    // Cancel changes nothing, and focus returns to the button that opened the dialog.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Delete my profile" })).toBeFocused();
    expect((await request.get(`${WORKFLOWS}/internal/twin/${who.userId}`)).status()).toBe(200);

    await page.getByRole("button", { name: "Delete my profile" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete my profile" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByText("Profile deleted")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Look, measured." })).toBeVisible();
    expect((await request.get(`${WORKFLOWS}/internal/twin/${who.userId}`)).status()).toBe(404);

    // The record of it stays, as counts, and the profile page says it was deleted.
    await page.goto("/settings/privacy");
    await expect(page.getByRole("heading", { name: "What was deleted" })).toBeVisible();
    await expect(page.getByText(/\d+ readings?, 0 runs?|readings?, \d+ runs?/)).toBeVisible();
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Your profile was deleted." })).toBeVisible();
    await expectAccessible(page);
  });

  test("only your own data is shown and deleted", async ({ page, context, browser, request }) => {
    const mine = await sessionOf(context, page);
    await seedTwin(request, makeTwin(mine.userId));

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    const theirs = await sessionOf(other, otherPage);
    await seedTwin(request, makeTwin(theirs.userId));
    await otherPage.goto("/settings/privacy");
    await otherPage.getByRole("button", { name: "Delete my profile" }).click();
    await otherPage.getByRole("dialog").getByRole("button", { name: "Delete my profile" }).click();
    await expect(otherPage).toHaveURL("/");
    await other.close();

    expect((await request.get(`${WORKFLOWS}/internal/twin/${mine.userId}`)).status()).toBe(200);
  });

  test("delete is refused while a run is going, and says why", async ({
    page,
    context,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-light", "Needs a real run.");
    test.setTimeout(90_000);
    const who = await sessionOf(context, page);
    await setCap(request, who, 400);
    await seedTwin(request, makeTwin(who.userId));
    const face = await uploadPhoto(page);
    expect((await buildFor(page, face)).status).toBe(201);

    await page.goto("/settings/privacy");
    await page.getByRole("button", { name: "Delete my profile" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete my profile" }).click();
    await expect(page.getByText("A measuring run is still going.")).toBeVisible();
    expect((await request.get(`${WORKFLOWS}/internal/twin/${who.userId}`)).status()).toBe(200);
  });
});
