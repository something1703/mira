import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers";

test.describe("anonymous session (D14)", () => {
  test("every visitor gets one signed, HttpOnly session cookie that stays the same", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    const first = (await context.cookies()).find((c) => c.name === "mira_session");
    expect(first).toBeDefined();
    expect(first?.httpOnly).toBe(true);
    expect(first?.sameSite).toBe("Lax");
    await page.goto("/consent");
    const second = (await context.cookies()).find((c) => c.name === "mira_session");
    expect(second?.value).toBe(first?.value);
  });

  test("a forged cookie is replaced, not trusted", async ({ page, context }) => {
    await context.addCookies([
      { name: "mira_session", value: "forged.value", url: "http://localhost:3100" },
    ]);
    await page.goto("/");
    const cookie = (await context.cookies()).find((c) => c.name === "mira_session");
    expect(cookie?.value).not.toBe("forged.value");
  });
});

test.describe("session budget banner (UX_FLOWS §0)", () => {
  test("appears once the session's units fall under 20% of its cap", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-light",
      "One project is enough for a run that spends units.",
    );
    test.setTimeout(60_000);
    await page.goto("/");
    await expect(page.getByText(/Units left in this session/)).toHaveCount(0);

    // Its own placeholder photo: this run must not warm the cache other tests start cold.
    const started = await page.request.post(`/dev/api/runs?tag=budget-${String(Date.now())}`);
    expect(started.status()).toBe(201);
    const { runId } = (await started.json()) as { runId: string };
    await expect
      .poll(
        async () =>
          (
            (await (await page.request.get(`/dev/api/runs/${runId}`)).json()) as {
              run: { status: string };
            }
          ).run.status,
        {
          timeout: 40_000,
        },
      )
      .toBe("succeeded");

    await page.reload();
    // The test server's cap is 45; one demo run spent 40.
    await expect(
      page.getByRole("status").filter({ hasText: "Units left in this session: 5." }),
    ).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe("unexpected error (UX_FLOWS §0)", () => {
  test("says what happened, that no units were charged, and offers a retry and a way home", async ({
    page,
  }) => {
    await page.goto("/dev/error");
    const panel = page.getByRole("alert").filter({ hasText: "Something failed on our side." });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("no units were charged for unfinished steps");
    await expect(panel).not.toContainText("Deliberate test error");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await page.getByRole("link", { name: "Go home" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Look, measured." })).toBeVisible();
  });
});

test.describe("install surface", () => {
  test("the manifest names MIRA and its icons exist at their stated sizes", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBe(true);
    const manifest = (await res.json()) as {
      name: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifest.name).toBe("MIRA — look, measured");
    for (const icon of manifest.icons) {
      const png = await request.get(icon.src);
      expect(png.ok()).toBe(true);
      const body = await png.body();
      const [w, h] = [body.readUInt32BE(16), body.readUInt32BE(20)];
      expect(`${String(w)}x${String(h)}`).toBe(icon.sizes);
    }
    expect((await request.get("/icons/icon-180.png")).ok()).toBe(true);
  });

  test("the page links the manifest and the Apple touch icon", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/icons/icon-180.png",
    );
  });
});

test("the gallery shows all seven Ring states", async ({ page }) => {
  await page.goto("/dev/components");
  for (const state of ["idle", "checking", "ready", "capturing", "measuring", "done", "blocked"]) {
    await expect(page.locator(`figure.mira-ring-wrap[data-state="${state}"]`)).toHaveCount(1);
  }
  await expect(page.getByText("Hold still. Taking the photo in 2")).toBeVisible();
});
