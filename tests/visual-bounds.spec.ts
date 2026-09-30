import { expect, test } from "@playwright/test";

// Regression: character parts must keep their culling bounds where they are drawn, otherwise they
// are frustum-culled and look invisible once the character leaves the origin.
test("player and AI visual parts keep synced bounding info", async ({ page }) => {
  await page.goto("/?test");
  await page.getByRole("button", { name: "PLAY" }).click();
  await page.waitForFunction(() => window.__MM_TEST__?.state() === "PLAYING", null, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  const player = await page.evaluate(() => window.__MM_TEST__!.visualBounds("PLAYER"));
  const ai = await page.evaluate(() => window.__MM_TEST__!.visualBounds("AI-01"));
  expect(player.length).toBeGreaterThan(0);
  for (const p of [...player, ...ai]) {
    expect(p.offset, `${p.name} bounds offset`).toBeLessThan(1);
  }
});
