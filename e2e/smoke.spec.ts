import { expect, test } from "@playwright/test";

// Minimum viable e2e gate: the app boots and the landing route renders without
// a client-side crash. Feature specs live alongside this file, one per PLAN.md DoD.
test("landing page renders", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const res = await page.goto("/");
  expect(res?.status(), "landing page HTTP status").toBeLessThan(400);
  await expect(page.locator("body")).toBeVisible();
  expect(errors, "uncaught client errors").toEqual([]);
});
