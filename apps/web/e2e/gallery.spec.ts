import { expect, test } from "@playwright/test";
import { expectAccessible, snapshotForReview } from "./helpers";

test.describe("Component gallery", () => {
  test("every component section renders and the page has no accessibility violations", async ({
    page,
  }, testInfo) => {
    await page.goto("/dev/components");
    for (const name of [
      "Ring",
      "Button",
      "Banner, toast, empty and error",
      "Plate and label strip",
      "Reading and swatch",
      "Step rail, quote sheet and verdict",
      "Field, toggle, dialog and tabs",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
    }
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "gallery");
  });

  test("Ring: run mode is a progressbar; capture and reading are images", async ({ page }) => {
    await page.goto("/dev/components");
    await expect(
      page.getByRole("progressbar", { name: "Building your sangeet look" }),
    ).toHaveAttribute("aria-valuenow", "4");
    await expect(page.getByRole("img", { name: "Capture checks: 2 of 4 passed" })).toBeVisible();
    await expect(page.getByText("Move a little closer")).toBeVisible();
    await expect(page.getByText("Ready to capture")).toBeVisible();
  });

  test("Dialog is modal, labelled and closes with Escape", async ({ page }) => {
    await page.goto("/dev/components");
    await page.getByRole("button", { name: "Open the confirm dialog" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete your profile?" });
    await expect(dialog).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open the confirm dialog" })).toBeFocused();
  });

  test("Tabs: arrow keys move between tabs", async ({ page }) => {
    await page.goto("/dev/components");
    await page.getByRole("tab", { name: "Skin" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Colouring", selected: true })).toBeVisible();
    await expect(page.getByRole("tabpanel")).toContainText("Colouring readings");
  });

  test("Toggle works from the keyboard", async ({ page }) => {
    await page.goto("/dev/components");
    const sw = page.getByRole("switch", { name: "Allow skin smoothing" });
    await sw.focus();
    await page.keyboard.press("Space");
    await expect(sw).toBeChecked();
  });

  test("tabular figures: '1111.00' and '0000.11' render at equal width", async ({ page }) => {
    await page.goto("/dev/components");
    await page.evaluate(() => document.fonts.ready);
    // Chromium rounds each glyph advance to whole pixels at small sizes, so measure large and
    // compare the ratio. Proportional figures would put "1111.00" about 25% narrower.
    const ratio = await page.evaluate(() => {
      const host = document.createElement("div");
      host.className = "mira-body mira-figures";
      host.style.cssText = "position:absolute;left:0;top:0;font-size:200px;white-space:nowrap";
      document.body.append(host);
      const width = (text: string) => {
        host.textContent = text;
        return host.getBoundingClientRect().width;
      };
      const out = width("1111.00") / width("0000.11");
      host.remove();
      return out;
    });
    expect(Math.abs(ratio - 1)).toBeLessThan(0.015);
  });

  test("touch targets are at least 44 px", async ({ page }) => {
    await page.goto("/dev/components");
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "button, [role=switch], [role=tab], input:not([aria-hidden=true])",
        ),
      ]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.height < 43.5 || r.width < 43.5))
        .map(({ el }) => `${el.tagName} ${el.textContent.trim().slice(0, 30)}`),
    );
    expect(small).toEqual([]);
  });
});
