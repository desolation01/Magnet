import { expect, test } from "@playwright/test";
import {
  expectNoErrors,
  getPlayer,
  openGame,
  parkAIFarAway,
  playerInput,
  sampleFrames,
  startMatch,
  teleport,
  trackErrors,
  waitGrounded,
} from "./helpers";

// Test site: the E outer platform (x 19..29, z −5..5, top at y = 0). AI are frozen and parked elsewhere.
test.describe("player movement (§6)", () => {
  let errors: string[] = [];
  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
    await openGame(page);
    await startMatch(page, { freezeAI: true });
    await parkAIFarAway(page);
  });

  test("moves with moveDir in both axes and stops quickly when released", async ({ page }) => {
    await teleport(page, "PLAYER", 24, 1.2, -3);
    await waitGrounded(page);
    const p0 = await getPlayer(page);

    await playerInput(page, { moveDir: { x: 0, z: 1 } });
    await expect.poll(async () => (await getPlayer(page)).z, { timeout: 3_000 }).toBeGreaterThan(p0.z + 2);
    await playerInput(page, { moveDir: { x: 0, z: 0 } });
    // Arcade stop: the velocity dies within a fraction of a second.
    await expect.poll(async () => Math.abs((await getPlayer(page)).vz), { timeout: 1_000 }).toBeLessThan(0.3);
    const p1 = await getPlayer(page);
    expect(Math.abs(p1.x - p0.x), "moving along +Z must not drift in X").toBeLessThan(0.3);

    await playerInput(page, { moveDir: { x: 1, z: 0 } });
    await expect.poll(async () => (await getPlayer(page)).x, { timeout: 3_000 }).toBeGreaterThan(p1.x + 1.5);
    await playerInput(page, { moveDir: { x: -1, z: 0 } });
    await expect.poll(async () => (await getPlayer(page)).x, { timeout: 3_000 }).toBeLessThan(p1.x - 1.5);
    await playerInput(page, { moveDir: { x: 0, z: 0 } });
    expect((await getPlayer(page)).alive).toBe(true);
    expectNoErrors(errors);
  });

  test("jump raises the player and lands again", async ({ page }) => {
    await teleport(page, "PLAYER", 24, 1.2, 0);
    await waitGrounded(page);
    const y0 = (await getPlayer(page)).y;

    await playerInput(page, { jump: true });
    const samples = await sampleFrames(page, { character: "PLAYER" }, 1_500);
    const peak = Math.max(...samples.map((s) => s.y));
    console.log(`jump: ground y=${y0}, peak y=${peak.toFixed(2)}`);
    expect(peak - y0).toBeGreaterThan(1);
    expect(peak - y0).toBeLessThan(4);
    await waitGrounded(page);
    expect(Math.abs((await getPlayer(page)).y - y0)).toBeLessThan(0.2);

    // Jump is a one-shot request: a single request does not produce a second jump.
    const again = await sampleFrames(page, { character: "PLAYER" }, 600);
    expect(Math.max(...again.map((s) => s.y)) - y0).toBeLessThan(0.2);
    expectNoErrors(errors);
  });

  test("sprint is faster than walk", async ({ page }) => {
    const speedAfterRun = async (sprint: boolean): Promise<number> => {
      await teleport(page, "PLAYER", 24, 1.2, -4);
      await waitGrounded(page);
      await playerInput(page, { sprint, moveDir: { x: 0, z: 1 } });
      await page.waitForTimeout(350);
      const p = await getPlayer(page);
      await playerInput(page, { sprint: false, moveDir: { x: 0, z: 0 } });
      return Math.hypot(p.vx, p.vz);
    };
    const walk = await speedAfterRun(false);
    const sprint = await speedAfterRun(true);
    console.log(`walk speed ${walk.toFixed(2)}, sprint speed ${sprint.toFixed(2)}`);
    expect(walk).toBeGreaterThan(4);
    expect(sprint).toBeGreaterThan(walk * 1.3);
    expectNoErrors(errors);
  });
});
