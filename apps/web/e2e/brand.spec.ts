import { expect, test, type Page } from "@playwright/test";
import { makeTwin, seedTwin, sessionOf } from "./fixtures";
import { expectAccessible, snapshotForReview } from "./helpers";

/** Brand console (docs/UX_FLOWS.md §10): every state, and the privacy choice that feeds it. */

const h1 = (page: Page, name: string | RegExp) => page.getByRole("heading", { level: 1, name });

test.describe("Brand console", () => {
  test("no catalogue: invites one action and says how to add a range", async ({
    page,
  }, testInfo) => {
    await page.goto("/brand");
    await expect(page.getByText("Add your range to see who it serves.")).toBeVisible();
    await expect(page.getByLabel("Spreadsheet (CSV)")).toBeVisible();
    await expect(page.getByLabel(/Product page links/)).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "brand-empty");
  });

  test("a spreadsheet with a bad line names the line and keeps nothing", async ({ page }) => {
    await page.goto("/brand");
    await page.getByLabel("Spreadsheet (CSV)").setInputFiles({
      name: "range.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("product,shade,hex\nFoundation,Ivory,#F1D5BF\nFoundation,Sand,tan\n"),
    });
    await expect(page.locator(".brand__problems")).toContainText(
      "Line 3 is not a colour. Use a code like #C99870.",
    );
    await expect(page.getByText("Add your range to see who it serves.")).toBeVisible();
  });

  test("a spreadsheet with the wrong columns says what it needs", async ({ page }) => {
    await page.goto("/brand");
    await page.getByLabel("Spreadsheet (CSV)").setInputFiles({
      name: "range.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,colour\nA,#FFFFFF\n"),
    });
    await expect(page.locator(".brand__problems")).toContainText(
      "needs the columns product, shade and hex",
    );
  });

  test("a good spreadsheet shows the range, the recorded banner and the Shade Gap Map", async ({
    page,
  }, testInfo) => {
    await page.goto("/brand");
    await page.getByLabel("Spreadsheet (CSV)").setInputFiles({
      name: "range.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "product,shade,hex\nFoundation,Ivory,#F1D5BF\nFoundation,Sand,#D9AE8A\nFoundation,Honey,#C99870\n",
      ),
    });
    await expect(h1(page, "Sample brand")).toBeVisible();
    await expect(page.getByText("1 product, 3 shades.")).toBeVisible();
    await expect(page.getByText(/^Recorded data\./)).toBeVisible();
    await expect(page.getByRole("tab", { name: "Shade Gap Map" })).toHaveAttribute(
      "data-state",
      "active",
    );
    await expect(
      page.getByText(/of shoppers have no shade in your range within ΔE 3.5/),
    ).toBeVisible();
    await expect(page.getByTestId("gap-cell").first()).toBeAttached();
    // A light range does not serve deep skin: some cell is hatched.
    await expect(
      page.locator('[data-testid="gap-cell"][data-unserved="true"]').first(),
    ).toBeAttached();
    await expect(page.getByRole("img", { name: /Shade gap map of \d+ shoppers/ })).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Skin colours your range does not serve" }),
    ).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "brand-gap-map");
  });

  test("the sample range is offered and says it is a sample", async ({ page }) => {
    await page.goto("/brand");
    await page.getByRole("button", { name: "Use the sample range" }).click();
    await expect(page.getByText(/\(a sample range\)/)).toBeVisible();
  });

  test("the gap map exports only what it shows", async ({ page }) => {
    await page.goto("/brand");
    await page.getByRole("button", { name: "Use the sample range" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export" }).first().click(),
    ]);
    expect(download.suggestedFilename()).toBe("shade-gap-map.csv");
    const text = await (await import("node:fs/promises")).readFile(await download.path(), "utf8");
    expect(text.split("\r\n")[0]).toBe(
      "hue_from,hue_to,lightness_from,lightness_to,share_of_shoppers,share_unserved",
    );
    expect(text).not.toMatch(/user|usr_|photo/i);
  });

  test("efficacy: completed proofs by band, with the sample products labelled as recorded", async ({
    page,
  }, testInfo) => {
    await page.goto("/brand");
    await page.getByRole("button", { name: "Use the sample range" }).click();
    await page.getByRole("tab", { name: "Efficacy" }).click();
    const table = page.getByRole("table", { name: /Completed progress checks/ });
    await expect(table).toContainText("Sample pore serum");
    await expect(table).toContainText("Changed more than their own variation");
    await expect(table.getByRole("row").filter({ hasText: "all" }).first()).toContainText("%");
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "brand-efficacy");
  });

  test("attach: looks that pair apparel with beauty", async ({ page }) => {
    await page.goto("/brand");
    await page.getByRole("button", { name: "Use the sample range" }).click();
    await page.getByRole("tab", { name: "Attach" }).click();
    await expect(page.getByRole("table", { name: /combine apparel and beauty/ })).toContainText(
      "apparel + beauty",
    );
  });

  test("a range can be replaced", async ({ page }) => {
    await page.goto("/brand");
    await page.getByRole("button", { name: "Use the sample range" }).click();
    await page.getByRole("button", { name: "Replace this range" }).click();
    await expect(page.getByText("Add your range to see who it serves.")).toBeVisible();
  });
});

test.describe("Privacy: contributing to brand summaries", () => {
  test("starts off, says what is shared, and can be turned on and off", async ({
    page,
    context,
    request,
  }) => {
    const who = await sessionOf(context, page);
    await seedTwin(request, makeTwin(who.userId));
    await page.goto("/settings/privacy");
    const toggle = page.getByRole("switch", {
      name: "Share anonymised readings with brand summaries",
    });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByText(/No name, no photo, no user id\./)).toBeVisible();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.reload();
    await expect(
      page.getByRole("switch", { name: "Share anonymised readings with brand summaries" }),
    ).toBeChecked();
    await page
      .getByRole("switch", { name: "Share anonymised readings with brand summaries" })
      .click();
    await page.reload();
    await expect(
      page.getByRole("switch", { name: "Share anonymised readings with brand summaries" }),
    ).not.toBeChecked();
    await expectAccessible(page);
  });
});
