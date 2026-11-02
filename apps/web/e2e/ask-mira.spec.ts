import { expect, test, type Page } from "@playwright/test";
import { makeTwin, outcome, seedTwin, sessionOf, shadeResult, shadeRunView } from "./fixtures";
import { expectAccessible, snapshotForReview } from "./helpers";

/** Ask MIRA (docs/UX_FLOWS.md §9): every state the panel can show. */

const PLAN = {
  id: "plan_abcdef123456",
  workflow: "match_shade",
  summary: "Match Sample brand Sample warm to your measured skin colour.",
  quote: {
    lines: [
      {
        nodeId: "render-1",
        label: "step.render_shade",
        feature: "makeup-vto",
        units: 1,
        cached: false,
        optional: false,
      },
      {
        nodeId: "measure-1",
        label: "step.measure_render",
        feature: "skin-tone-analysis",
        units: 20,
        cached: false,
        optional: false,
      },
      {
        nodeId: "render-2",
        label: "step.render_shade",
        feature: "makeup-vto",
        units: 1,
        cached: false,
        optional: true,
      },
    ],
    total: 22,
    sessionUnitsLeft: 300,
    overCap: false,
    pricing: { source: "feature-cost", pricedAt: "2026-11-01T09:00:00.000Z" },
  },
  expiresAt: "2099-01-01T00:00:00.000Z",
  confirmed: false,
};

const reply = (over: object) => ({
  state: "answer",
  segments: [{ text: "Here is what I would run. Check the quote.", readings: [] }],
  nextActions: [],
  plans: [],
  needs: [],
  renders: [],
  toolCalls: [],
  ...over,
});

const panel = (page: Page) => page.getByRole("complementary", { name: "Ask MIRA" });

async function open(page: Page, path = "/") {
  await page.goto(path);
  await page.getByRole("button", { name: "Ask MIRA" }).click();
  await expect(panel(page)).toBeVisible();
}

async function ask(page: Page, text: string) {
  await panel(page).getByLabel("Ask MIRA a question").fill(text);
  await panel(page).getByRole("button", { name: "Send" }).click();
}

test.describe("Ask MIRA panel", () => {
  test("idle: three suggestions for the screen, and they change with the screen", async ({
    page,
  }, testInfo) => {
    await open(page);
    const list = panel(page).getByRole("list", { name: "Suggestions" });
    await expect(list.getByRole("button")).toHaveCount(3);
    await expect(list.getByRole("button", { name: "What can you do?" })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "ask-idle");
    await page.keyboard.press("Escape");

    await open(page, "/shade");
    await expect(
      panel(page).getByRole("button", { name: "What does verified mean?" }),
    ).toBeVisible();
  });

  test("an answer: a reading the renderer filled from the profile", async ({
    page,
    context,
    request,
  }, testInfo) => {
    const who = await sessionOf(context, page);
    await seedTwin(request, makeTwin(who.userId));
    await open(page, "/profile");
    await panel(page).getByRole("button", { name: "What is my skin colour?" }).click();
    const answer = panel(page).locator('[data-state="answer"]');
    await expect(answer).toContainText(/Your measured skin colour is #[0-9A-F]{6}\./);
    // No digit in the sentence except the hex code the renderer put there.
    const shown = (await answer.first().innerText()).replace(/#[0-9A-F]{6}/g, "");
    expect(shown).not.toMatch(/\d/);
    await expect(answer.getByRole("link", { name: "Match my shade" })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "ask-answer");
  });

  test("an answer with no profile says so and offers to start measuring", async ({ page }) => {
    await open(page);
    await ask(page, "What is my skin colour?");
    await expect(panel(page)).toContainText("You have no measured profile yet.");
    await expect(panel(page).getByRole("link", { name: "Start measuring" })).toBeVisible();
  });

  test("a plan that needs a photo sends the person to the screen that takes it", async ({
    page,
    context,
    request,
  }) => {
    const who = await sessionOf(context, page);
    await seedTwin(request, makeTwin(who.userId));
    await open(page, "/shade");
    await panel(page).getByRole("button", { name: "Find my foundation in a range" }).click();
    await expect(panel(page)).toContainText("I need a photo of you first.");
    await expect(
      panel(page).getByRole("link", { name: "Add a photo on that screen" }),
    ).toHaveAttribute("href", "/shade");
    // Nothing was quoted or started.
    await expect(panel(page).getByRole("button", { name: "Confirm" })).toHaveCount(0);
  });

  test("out of scope: a medical question gets one fixed sentence", async ({ page }, testInfo) => {
    await open(page);
    await ask(page, "Can you diagnose this spot on my cheek?");
    const msg = panel(page).locator('[data-state="out_of_scope"]');
    await expect(msg).toContainText(
      "MIRA describes appearance only and cannot help with medical questions. A dermatologist can.",
    );
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "ask-out-of-scope");
  });

  test("thinking: names the work and can be stopped", async ({ page }) => {
    await page.route("**/api/ask", async (route) => {
      await new Promise((r) => setTimeout(r, 4_000));
      await route.fulfill({ json: reply({}) }).catch(() => undefined);
    });
    await open(page);
    await ask(page, "Match my shade");
    await expect(panel(page).getByRole("status")).toContainText("Working out a plan");
    await panel(page).getByRole("button", { name: "Stop" }).click();
    await expect(panel(page).getByText("Working out a plan")).toHaveCount(0);
    await expect(panel(page).getByLabel("Ask MIRA a question")).toBeEnabled();
  });

  test("model unavailable: says so and links to the tools", async ({ page }, testInfo) => {
    await page.route("**/api/ask", (route) =>
      route.fulfill({ status: 502, json: { error: "assistant_unavailable" } }),
    );
    await open(page);
    await ask(page, "Hello");
    await expect(panel(page)).toContainText(
      "The assistant is unavailable right now. Every tool still works from its own screen.",
    );
    await expect(panel(page).getByRole("link", { name: "Match my shade" })).toBeVisible();
    await expect(panel(page).getByRole("link", { name: "Start measuring" })).toBeVisible();
    await expectAccessible(page);
    await snapshotForReview(page, testInfo, "ask-unavailable");
  });

  test("fallback: a templated reply is labelled as one", async ({ page }) => {
    await page.route("**/api/ask", (route) =>
      route.fulfill({
        json: reply({
          state: "fallback",
          segments: [
            {
              text: "I could not put that into words safely. Every tool still works from its own screen.",
              readings: [],
            },
          ],
        }),
      }),
    );
    await open(page);
    await ask(page, "Hello");
    await expect(panel(page)).toContainText("This is a standard reply.");
    await expect(panel(page)).toContainText("I could not put that into words safely.");
  });

  test.describe("plan, quote and run", () => {
    test("a quote can be cancelled and nothing is used", async ({ page }) => {
      await page.route("**/api/ask", (route) =>
        route.fulfill({ json: reply({ state: "plan", plans: [PLAN] }) }),
      );
      await open(page);
      await ask(page, "Match my shade");
      const quote = panel(page).locator(".mira-quote");
      await expect(quote).toContainText("Match Sample brand Sample warm");
      await expect(quote).toContainText("Rendering the shade on your photo");
      // Two render lines are one line here.
      await expect(quote.getByRole("row", { name: /Rendering the shade/ })).toContainText(
        "2 units",
      );
      await expect(quote.getByRole("row", { name: /^Total/ })).toContainText("22 units");
      await quote.getByRole("button", { name: "Cancel" }).click();
      await expect(panel(page)).toContainText("Plan cancelled. Nothing was used.");
    });

    test("Change opens the full screen", async ({ page }) => {
      await page.route("**/api/ask", (route) =>
        route.fulfill({ json: reply({ state: "plan", plans: [PLAN] }) }),
      );
      await open(page);
      await ask(page, "Match my shade");
      await expect(panel(page).getByRole("link", { name: "Change" })).toHaveAttribute(
        "href",
        "/shade",
      );
    });

    test("over the session's units: Confirm is held back", async ({ page }) => {
      const over = { ...PLAN, quote: { ...PLAN.quote, overCap: true, sessionUnitsLeft: 5 } };
      await page.route("**/api/ask", (route) =>
        route.fulfill({ json: reply({ state: "plan", plans: [over] }) }),
      );
      await open(page);
      await ask(page, "Match my shade");
      await expect(panel(page).getByRole("alert")).toContainText(
        "This plan would use 22 units and you have 5 left in this session.",
      );
      await expect(panel(page).getByRole("button", { name: "Confirm" })).toBeDisabled();
    });

    test("confirm starts the run, shows the steps, then the assistant describes it", async ({
      page,
      context,
    }, testInfo) => {
      const who = await sessionOf(context, page);
      const runId = "run_askpanel0001";
      let confirms = 0;
      await page.route("**/api/ask", (route) =>
        route.fulfill({ json: reply({ state: "plan", plans: [PLAN] }) }),
      );
      await page.route("**/api/ask/confirm", (route) => {
        confirms += 1;
        return route.fulfill({ status: 201, json: { status: "started", runId } });
      });
      let polls = 0;
      await page.route(`**/api/runs/${runId}`, (route) => {
        polls += 1;
        const view = shadeRunView(who.userId, runId, shadeResult([outcome(1), outcome(2)]));
        if (polls < 2) {
          view.run.status = "running";
          view.nodes = view.nodes.map((n) => ({ ...n, status: "running" as const }));
        }
        return route.fulfill({ json: view });
      });
      await page.route("**/api/ask/narrate", (route) =>
        route.fulfill({
          json: reply({
            segments: [{ text: "Honey 140 blended within 1.4 ΔE2000 of your skin.", readings: [] }],
            renders: ["render-1"],
            nextActions: ["compose_look"],
          }),
        }),
      );

      await open(page);
      await ask(page, "Match my shade");
      await panel(page).locator(".mira-quote").getByRole("button", { name: "Confirm" }).click();

      // Running: the compact steps, linked to the full screen.
      await expect(panel(page).getByRole("list", { name: PLAN.summary })).toBeVisible();
      await expect(panel(page).getByRole("link", { name: "Open full view" })).toHaveAttribute(
        "href",
        `/shade?run=${runId}`,
      );
      await snapshotForReview(page, testInfo, "ask-running");
      // Finished: the assistant's description arrives with a link to the previews.
      await expect(panel(page)).toContainText("Honey 140 blended within 1.4 ΔE2000 of your skin.");
      await expect(panel(page).getByRole("link", { name: "Open the previews" })).toHaveAttribute(
        "href",
        `/shade?run=${runId}`,
      );
      expect(confirms).toBe(1);
      await expectAccessible(page);
    });

    test("a refused start says why and uses no units", async ({ page }) => {
      await page.route("**/api/ask", (route) =>
        route.fulfill({ json: reply({ state: "plan", plans: [PLAN] }) }),
      );
      await page.route("**/api/ask/confirm", (route) =>
        route.fulfill({ status: 409, json: { status: "refused", reason: "price_changed" } }),
      );
      await open(page);
      await ask(page, "Match my shade");
      await panel(page).locator(".mira-quote").getByRole("button", { name: "Confirm" }).click();
      await expect(panel(page).getByRole("alert")).toContainText(
        "The price changed since this quote. Ask again to get a new quote.",
      );
    });
  });

  test("the conversation survives moving between screens, and the panel remembers nothing after a reload", async ({
    page,
  }) => {
    await open(page);
    await ask(page, "What can you do?");
    await expect(panel(page)).toContainText(
      "I can match a shade, build a look or check your progress.",
    );
    await page.getByRole("link", { name: "Shade" }).first().click();
    await expect(page).toHaveURL(/\/shade/);
    // The shell, and so the panel and what was said in it, stays where it was.
    await expect(panel(page)).toContainText("What can you do?");
    await page.reload();
    await page.getByRole("button", { name: "Ask MIRA" }).click();
    await expect(panel(page).getByRole("list", { name: "Suggestions" })).toBeVisible();
  });
});
