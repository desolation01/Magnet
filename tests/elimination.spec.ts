import { expect, test } from "@playwright/test";
import {
  debug,
  eliminate,
  expectNoErrors,
  getCharacter,
  getObjects,
  openGame,
  startMatch,
  teleport,
  teleportObject,
  trackErrors,
  waitState,
} from "./helpers";

test.describe("falling and elimination (§4, §29, §37)", () => {
  let errors: string[] = [];
  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
    await openGame(page);
    await startMatch(page, { freezeAI: true });
  });

  test("an AI that falls off the arena is eliminated, counted, announced and cleaned up", async ({ page }) => {
    const before = await debug(page);
    expect(before.aliveCount).toBe(11);
    expect(before.nameplates).toBe(11);

    // Drop AI-05 into the void east of the arena and let gravity do the rest.
    await teleport(page, "AI-05", 40, 3, 0);
    const mid = await getCharacter(page, "AI-05");
    expect(mid!.alive).toBe(true);
    await expect.poll(async () => (await getCharacter(page, "AI-05"))?.alive ?? false, { timeout: 5_000 }).toBe(false);

    await expect(page.locator("#opponents-left")).toHaveText("9");
    const note = page.locator("#notifications .notification", { hasText: "AI-05 ELIMINATED" });
    await expect(note).toBeVisible();
    expect(await page.evaluate(() => window.__MM_DEBUG__.aliveCount)).toBe(10);
    expect(await page.evaluate(() => window.__MM_DEBUG__.nameplates)).toBe(10);

    // Body and meshes are disposed shortly after; the notification fades out.
    await expect.poll(() => page.evaluate(() => window.__MM_TEST__!.names().includes("AI-05")), { timeout: 5_000 }).toBe(false);
    await expect.poll(async () => (await debug(page)).bodies).toBe(before.bodies - 1);
    await expect(note).toHaveCount(0, { timeout: 5_000 });
    expect(await page.evaluate(() => window.__MM_DEBUG__.state)).toBe("PLAYING");
    expectNoErrors(errors);
  });

  test("a character just above the elimination plane is not eliminated; below it is", async ({ page }) => {
    // Hold AI-06 at y = −9 (above −10) for a moment by re-teleporting it; it must stay alive.
    for (let i = 0; i < 5; i++) {
      await teleport(page, "AI-06", 40, -9, 0);
      expect((await getCharacter(page, "AI-06"))!.alive).toBe(true);
    }
    await expect.poll(async () => (await getCharacter(page, "AI-06"))?.alive ?? false, { timeout: 5_000 }).toBe(false);
    expectNoErrors(errors);
  });

  test("opponents-left counts down with every elimination", async ({ page }) => {
    for (const [i, name] of ["AI-01", "AI-04", "AI-07", "AI-10"].entries()) {
      await eliminate(page, name);
      await expect(page.locator("#opponents-left")).toHaveText(String(9 - i));
    }
    expect(await page.evaluate(() => window.__MM_DEBUG__.aliveCount)).toBe(7);
    expectNoErrors(errors);
  });

  test("the player falling off the arena ends the match with GAME OVER", async ({ page }) => {
    await teleport(page, "PLAYER", 0, 3, -40);
    await waitState(page, "PLAYER_ELIMINATED", 8_000);
    await expect(page.locator("#end-title")).toHaveText("GAME OVER");
    await expect(page.locator("#end-line1")).toHaveText("Opponents Remaining: 10");
    await expect(page.locator("#notifications")).toContainText("PLAYER ELIMINATED");
    expectNoErrors(errors);
  });

  test("magnetic objects that fall off are disposed and respawn", async ({ page }) => {
    const count0 = (await getObjects(page)).length;
    const bodies0 = (await debug(page)).bodies;
    await teleportObject(page, 13, 40, 3, 0); // crate from the E platform
    await expect.poll(async () => (await getObjects(page)).some((o) => o.index === 13), { timeout: 5_000 }).toBe(false);
    expect((await getObjects(page)).length).toBe(count0 - 1);
    expect((await debug(page)).bodies).toBe(bodies0 - 1);
    // Respawns at its spawn point after ARENA.objectRespawnDelay (5 s).
    await expect.poll(async () => (await getObjects(page)).find((o) => o.index === 13) ?? null, { timeout: 10_000 })
      .toEqual(expect.objectContaining({ index: 13, alive: true }));
    const crate = (await getObjects(page)).find((o) => o.index === 13)!;
    expect(Math.hypot(crate.x - 26, crate.z + 3)).toBeLessThan(1);
    expect((await debug(page)).bodies).toBe(bodies0);
    expectNoErrors(errors);
  });
});
