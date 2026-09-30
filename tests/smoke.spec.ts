import { test, expect } from "@playwright/test";

test("game boots, starts a match and runs without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto("/");
  await page.getByRole("button", { name: "PLAY" }).click();

  await expect
    .poll(() => page.evaluate(() => (window as any).__MM_DEBUG__?.state), { timeout: 30_000 })
    .toBe("PLAYING");

  await page.waitForTimeout(3000);

  // The test-only API must not be installed during normal play (no `?test` in the URL).
  expect(await page.evaluate(() => "__MM_TEST__" in window)).toBe(false);

  const debug = await page.evaluate(() => (window as any).__MM_DEBUG__);
  console.log("debug:", JSON.stringify(debug));
  expect(errors, errors.join("\n")).toEqual([]);
});
