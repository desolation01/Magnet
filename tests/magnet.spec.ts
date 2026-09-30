import { expect, test, type Page } from "@playwright/test";
import { ATTRACT, RAGDOLL, REPULSE } from "../src/config";
import {
  clearPlatformObjects,
  dist2D,
  expectNoErrors,
  findObject,
  getCharacter,
  getObjects,
  getPlayer,
  maxStep,
  openGame,
  parkAIFarAway,
  playerInput,
  sampleFrames,
  SITES,
  startMatch,
  teleport,
  teleportObject,
  trackErrors,
  waitGrounded,
} from "./helpers";

// Test site: the E cardinal platform (center E = (34, 0), 14 × 14). The player stands 3.5 east of its
// center and aims west (−X, yaw −π/2) along the platform toward the spoke bridge. AI are frozen and
// parked elsewhere; the platform's other props are moved to its north side, out of the firing lane.
const E = SITES.E;
const WEST = -Math.PI / 2;
const TOWARD_PLUS_Z = 0; // yaw 0 faces +Z (south)
const SITE = { x: E.x + 3.5, y: 1.2, z: 0 };
/** Spawn index of the crate used by the test (the crate nearest the E platform). */
let CRATE = -1;

const getObject = async (page: Page, index: number) => (await getObjects(page)).find((o) => o.index === index)!;
/** Puts a character into ragdoll as if a projectile hit it (no knockback). */
const ragdoll = (page: Page, name: string): Promise<boolean> => page.evaluate((n) => window.__MM_TEST__!.ragdoll(n), name);
/** Horizontal distance a character travels from `from` during `ms`, sampled every frame. */
async function maxTravel(page: Page, name: string, from: { x: number; z: number }, ms: number): Promise<number> {
  const samples = await sampleFrames(page, { character: name }, ms);
  return Math.max(0, ...samples.map((p) => dist2D(p, from)));
}

async function setupSite(page: Page): Promise<void> {
  await openGame(page);
  await startMatch(page, { freezeAI: true });
  await parkAIFarAway(page);
  CRATE = await findObject(page, "crate", E);
  await teleportObject(page, CRATE, E.x + 1, 0.6, -2.5);
  await clearPlatformObjects(page, "E", [CRATE]);
  await teleport(page, "PLAYER", SITE.x, SITE.y, SITE.z);
  await playerInput(page, { aimYaw: WEST });
  await waitGrounded(page);
}

test.describe("magnet: attract (§8, §25)", () => {
  let errors: string[] = [];
  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
    await setupSite(page);
  });

  test("attract pulls a crate physically toward the player and holds it", async ({ page }) => {
    await teleportObject(page, CRATE, E.x - 2.5, 0.6, 0);
    await page.waitForTimeout(300);
    const player = await getPlayer(page);
    const c0 = await getObject(page, CRATE);
    const d0 = dist2D(c0, player);
    expect(d0).toBeGreaterThan(5);

    await playerInput(page, { attract: true });
    const samples = await sampleFrames(page, { object: CRATE }, 1_500);
    const d1 = dist2D(samples[samples.length - 1], player);
    console.log(`crate distance ${d0.toFixed(2)} → ${d1.toFixed(2)}, max per-frame step ${maxStep(samples).toFixed(2)}`);
    expect(d1).toBeLessThan(d0 - 2);
    // No teleporting: motion is continuous frame to frame.
    expect(maxStep(samples)).toBeLessThan(1.5);
    await expect.poll(async () => (await getObject(page, CRATE)).heldBy, { timeout: 3_000 }).toBe("PLAYER");
    expect((await getPlayer(page)).attracting).toBe(true);

    // Releasing drops the crate.
    await playerInput(page, { attract: false });
    await expect.poll(async () => (await getObject(page, CRATE)).heldBy).toBeNull();
    expectNoErrors(errors);
  });

  test("attract does not pull a character that is not ragdolled", async ({ page }) => {
    await teleport(page, "AI-01", E.x - 2.5, 1.2, 0);
    await waitGrounded(page, "AI-01");
    const a0 = (await getCharacter(page, "AI-01"))!;
    await playerInput(page, { attract: true });
    const samples = await sampleFrames(page, { character: "AI-01" }, 1_000);
    const a1 = (await getCharacter(page, "AI-01"))!;
    await playerInput(page, { attract: false });
    expect(a1.pulled || a1.heldBy !== null, "a standing AI is never grabbed").toBe(false);
    expect(Math.max(...samples.map((p) => dist2D(p, a0))), "a standing AI does not move").toBeLessThan(0.3);
    expectNoErrors(errors);
  });

  test("a ragdolled AI is pulled and held until its ragdoll ends", async ({ page }) => {
    await teleport(page, "AI-01", E.x - 2.5, 1.2, 0);
    await waitGrounded(page, "AI-01");
    const player = await getPlayer(page);
    const d0 = dist2D((await getCharacter(page, "AI-01"))!, player);

    // Record every frame in the page, from the ragdoll + attract start, until a little after the ragdoll ends.
    await ragdoll(page, "AI-01");
    await playerInput(page, { attract: true });
    type Frame = { x: number; y: number; z: number; held: boolean; pulled: boolean; ragdoll: number; attracting: boolean };
    const frames = await page.evaluate((ms) => new Promise<Frame[]>((resolve) => {
      const api = window.__MM_TEST__!;
      const out: Frame[] = [];
      const start = performance.now();
      const tick = (): void => {
        const a = api.getCharacter("AI-01");
        const p = api.getCharacter("PLAYER");
        if (a && p) {
          out.push({ x: a.x, y: a.y, z: a.z, held: a.heldBy === "PLAYER", pulled: a.pulled, ragdoll: a.ragdoll, attracting: p.attracting });
        }
        if (performance.now() - start < ms) requestAnimationFrame(tick); else resolve(out);
      };
      requestAnimationFrame(tick);
    }), RAGDOLL.duration * 1000 + 600);
    await playerInput(page, { attract: false });

    const firstHeld = frames.findIndex((f) => f.held);
    expect(firstHeld, "the ragdolled AI is captured").toBeGreaterThanOrEqual(0);
    const closest = Math.min(...frames.map((f) => dist2D(f, player)));
    console.log(`AI distance ${d0.toFixed(2)} → ${closest.toFixed(2)}, max per-frame step ${maxStep(frames).toFixed(2)}`);
    expect(closest).toBeLessThan(d0 - 1.5);
    expect(maxStep(frames), "no teleporting").toBeLessThan(1.5);

    // Held for as long as the ragdoll lasts; released on the frame the ragdoll ends, with attract still on.
    const released = frames.findIndex((f, i) => i > firstHeld && !f.held);
    expect(released, "released before the recording ends").toBeGreaterThan(firstHeld);
    // The last held sample may already read ragdoll 0: the sample can land between the character update
    // (timer reaches 0) and the magnet update (release) of the same frame.
    const heldNotRagdolled = frames.slice(firstHeld, released).filter((f) => f.ragdoll <= 0).length;
    expect(heldNotRagdolled, "held only while ragdolled (± one frame)").toBeLessThanOrEqual(1);
    expect(frames[released].ragdoll).toBe(0);
    expect(frames[released].attracting, "released by the ragdoll ending, not by attract stopping").toBe(true);
    const after = frames.slice(released).filter((f) => f.attracting);
    console.log(`after the ragdoll: ${after.length} attracting frames, ${after.filter((f) => f.pulled || f.held).length} with the AI pulled`);
    expect(after.length).toBeGreaterThan(5);
    expect(after.every((f) => !f.pulled && !f.held), "no pull after the ragdoll").toBe(true);
    expectNoErrors(errors);
  });

  test("a thrown crate ragdolls the AI it hits, and a second hit does not extend the ragdoll", async ({ page }) => {
    // AI-01 on the spoke bridge, beyond repulse range, so only the crate reaches it.
    await teleport(page, "AI-01", SITE.x - (REPULSE.range + 1), 1.2, 0);
    await waitGrounded(page, "AI-01");
    await teleportObject(page, CRATE, E.x + 1, 0.6, 0);
    await playerInput(page, { attract: true });
    await expect.poll(async () => (await getObject(page, CRATE)).heldBy, { timeout: 4_000 }).toBe("PLAYER");
    expect((await getCharacter(page, "AI-01"))!.ragdoll).toBe(0);
    await playerInput(page, { repulse: true, attract: false });
    await expect.poll(async () => (await getCharacter(page, "AI-01"))?.ragdoll ?? 0, { timeout: 1_500, intervals: [30] }).toBeGreaterThan(0);

    // No extension: re-triggering a second later leaves the remaining time running down.
    await page.waitForTimeout(1_000);
    await ragdoll(page, "AI-01");
    const left = (await getCharacter(page, "AI-01"))?.ragdoll ?? 0;
    console.log(`ragdoll left after a second hit 1 s in: ${left}`);
    expect(left).toBeLessThan(RAGDOLL.duration - 0.7);
    expectNoErrors(errors);
  });

  test("a ragdolled AI is knocked back about twice as far by a repulse", async ({ page }) => {
    const spot = { x: SITE.x - 2, z: 0 };
    const travel = async (name: string, ragdolled: boolean): Promise<number> => {
      await teleport(page, name, spot.x, 1.2, spot.z);
      await waitGrounded(page, name);
      await page.waitForTimeout(200);
      if (ragdolled) await ragdoll(page, name);
      await playerInput(page, { repulse: true });
      return maxTravel(page, name, spot, 1_800);
    };
    const normal = await travel("AI-01", false);
    await teleport(page, "AI-01", E.x, 1.2, 5); // out of the lane
    await expect.poll(async () => (await getPlayer(page)).repulseCooldown, { timeout: REPULSE.cooldown * 1000 + 1_000 }).toBe(0);
    const limp = await travel("AI-02", true);
    console.log(`repulse travel from 2 units: normal ${normal.toFixed(2)}, ragdolled ${limp.toFixed(2)} (×${(limp / normal).toFixed(2)})`);
    expect(limp / normal).toBeGreaterThan(1.7);
    expect(limp / normal).toBeLessThan(2.4);
    expectNoErrors(errors);
  });

  test("a ragdolled player cannot move, attract or repulse", async ({ page }) => {
    await ragdoll(page, "PLAYER");
    await playerInput(page, { moveDir: { x: -1, z: 0 }, attract: true, repulse: true });
    await page.waitForTimeout(500);
    const p = await getPlayer(page);
    expect(p.ragdoll).toBeGreaterThan(0);
    expect(p.attracting).toBe(false);
    expect(p.repulseCooldown, "repulse did not fire").toBe(0);
    expect(Math.hypot(p.vx, p.vz), "no movement").toBeLessThan(0.5);
    // Control comes back when the ragdoll ends.
    await expect.poll(async () => (await getPlayer(page)).attracting, { timeout: RAGDOLL.duration * 1000 + 500 }).toBe(true);
    await playerInput(page, { moveDir: { x: 0, z: 0 }, attract: false });
    expectNoErrors(errors);
  });

  test(`attract does not reach targets beyond ~${ATTRACT.range} units or outside the cone`, async ({ page }) => {
    // 12 units west (on the E spoke bridge) and 6 units behind-left (outside the cone).
    await teleportObject(page, CRATE, SITE.x - (ATTRACT.range + 1.5), 0.6, 0);
    await teleport(page, "AI-01", E.x, 1.2, 4);
    await page.waitForTimeout(500);
    await ragdoll(page, "AI-01"); // pullable, but outside the cone
    const c0 = await getObject(page, CRATE);
    const a0 = (await getCharacter(page, "AI-01"))!;
    await playerInput(page, { attract: true });
    await page.waitForTimeout(1_000);
    const c1 = await getObject(page, CRATE);
    const a1 = (await getCharacter(page, "AI-01"))!;
    expect(dist2D(c0, c1), "crate out of range must not move").toBeLessThan(0.3);
    expect(dist2D(a0, a1), "AI outside the cone must not move").toBeLessThan(0.3);
    expectNoErrors(errors);
  });

  test("magnet power drains while attracting, empties, and regenerates", async ({ page }) => {
    await expect(page.locator("#bar-power")).toHaveAttribute("style", /width: 100%/);
    await playerInput(page, { attract: true });
    await page.waitForTimeout(1_500);
    const mid = await getPlayer(page);
    console.log(`power after 1.5 s of attract: ${mid.power}`);
    expect(mid.attracting).toBe(true);
    expect(mid.power).toBeLessThan(85);
    expect(mid.power).toBeGreaterThan(0);
    const width = await page.locator("#bar-power").evaluate((e) => parseFloat((e as HTMLElement).style.width));
    expect(width).toBeLessThan(90);

    // Keep holding until the magnet runs dry; attract switches itself off (and may only re-engage
    // once power has regenerated past POWER.restartThreshold = 20).
    await expect.poll(async () => (await getPlayer(page)).attracting, { timeout: 8_000 }).toBe(false);
    expect((await getPlayer(page)).power).toBeLessThanOrEqual(21);

    await playerInput(page, { attract: false });
    await expect.poll(async () => (await getPlayer(page)).power, { timeout: 8_000 }).toBe(100);
    await expect(page.locator("#bar-power")).toHaveAttribute("style", /width: 100%/);
    expectNoErrors(errors);
  });
});

test.describe("magnet: repulse (§9, §26)", () => {
  let errors: string[] = [];
  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
    await setupSite(page);
  });

  test("repulse pushes an AI and a crate away and shows the cooldown in the HUD", async ({ page }) => {
    await teleport(page, "AI-01", E.x - 0.5, 1.2, 0.8);
    await teleportObject(page, CRATE, E.x, 0.6, -1);
    await waitGrounded(page, "AI-01");
    await page.waitForTimeout(300);
    const player = await getPlayer(page);
    const a0 = (await getCharacter(page, "AI-01"))!;
    const c0 = await getObject(page, CRATE);
    await expect(page.locator("#repulse-status")).toHaveText("READY");

    // Record every HUD cooldown label.
    await page.evaluate(() => {
      const node = document.getElementById("repulse-status")!;
      const seen: { text: string; t: number }[] = [];
      (window as unknown as { __repulseSeen: typeof seen }).__repulseSeen = seen;
      new MutationObserver(() => seen.push({ text: node.textContent ?? "", t: performance.now() }))
        .observe(node, { childList: true, characterData: true, subtree: true });
    });

    await playerInput(page, { repulse: true });
    await expect.poll(async () => (await getPlayer(page)).repulseCooldown, { timeout: 2_000 }).toBeGreaterThan(1);
    await expect(page.locator("#repulse-status")).toHaveText(/^[0-4]\.\ds$/);
    await expect(page.locator("#hud-repulse")).toHaveClass(/cooling/);
    const a1 = (await getCharacter(page, "AI-01"))!;
    expect(a1.stability, "repulse hit costs stability").toBeLessThan(100);

    await expect.poll(async () => dist2D((await getCharacter(page, "AI-01"))!, player), { timeout: 3_000 })
      .toBeGreaterThan(dist2D(a0, player) + 2.5);
    await expect.poll(async () => dist2D(await getObject(page, CRATE), player), { timeout: 3_000 })
      .toBeGreaterThan(dist2D(c0, player) + 3);

    // A second repulse during the cooldown is ignored (cooldown keeps counting down).
    const before = (await getPlayer(page)).repulseCooldown;
    await playerInput(page, { repulse: true });
    await page.waitForTimeout(200);
    expect((await getPlayer(page)).repulseCooldown).toBeLessThan(before);

    await expect(page.locator("#repulse-status")).toHaveText("READY", { timeout: 6_000 });
    await expect(page.locator("#hud-repulse")).toHaveClass(/ready/);
    const seen = await page.evaluate(() => (window as unknown as { __repulseSeen: { text: string; t: number }[] }).__repulseSeen);
    const texts = seen.map((s) => s.text);
    console.log(`HUD: ${texts.join(" ")}`);
    const first = texts.findIndex((t) => t !== "READY");
    expect(first).toBeGreaterThanOrEqual(0);
    const numbers = texts.slice(first, texts.lastIndexOf("READY")).map((t) => parseFloat(t));
    expect(numbers.length).toBeGreaterThan(5);
    expect(numbers[0]).toBeGreaterThanOrEqual(REPULSE.cooldown - 0.2);
    for (let i = 1; i < numbers.length; i++) expect(numbers[i]).toBeLessThanOrEqual(numbers[i - 1]);
    const duration = (seen[seen.length - 1].t - seen[first].t) / 1000;
    console.log(`cooldown wall-clock duration ${duration.toFixed(2)} s`);
    expect(duration).toBeGreaterThan(REPULSE.cooldown - 0.4);
    expect(duration).toBeLessThan(REPULSE.cooldown + 1.5);
    expectNoErrors(errors);
  });

  test("repulse can knock an AI off a platform, which eliminates it", async ({ page }) => {
    // AI-01 stands 3.5 units in front of the player and 3.5 units from the platform's +Z edge.
    await teleport(page, "PLAYER", E.x, 1.2, 0);
    await teleport(page, "AI-01", E.x, 1.2, 3.5);
    await playerInput(page, { aimYaw: TOWARD_PLUS_Z });
    await waitGrounded(page);
    await waitGrounded(page, "AI-01");
    await playerInput(page, { repulse: true });

    await expect.poll(async () => (await getCharacter(page, "AI-01"))?.alive ?? false, { timeout: 8_000 }).toBe(false);
    await expect(page.locator("#opponents-left")).toHaveText("9");
    await expect(page.locator("#notifications")).toContainText("AI-01 ELIMINATED");
    const dump = (await page.evaluate(() => window.__MM_DUMP__())) as { eliminations: { name: string; by: string | null }[] };
    expect(dump.eliminations).toEqual([expect.objectContaining({ name: "AI-01", by: "PLAYER" })]);
    expect((await getPlayer(page)).alive).toBe(true);
    expectNoErrors(errors);
  });

  // Launch a held crate: hold LEFT (attract) until the crate is captured, then click RIGHT.
  // `releaseAttract` = whether the left button is released on the same frame as the right click.
  for (const releaseAttract of [true, false]) {
    const how = releaseAttract ? "releasing attract at the same time" : "while attract is still held (LMB held + RMB click)";
    test(`repulse launches a held crate ${how}`, async ({ page }) => {
      await teleportObject(page, CRATE, E.x - 1, 0.6, 0);
      await playerInput(page, { attract: true });
      await expect.poll(async () => (await getObject(page, CRATE)).heldBy, { timeout: 4_000 }).toBe("PLAYER");
      await page.waitForTimeout(300);
      const player = await getPlayer(page);
      const held = await getObject(page, CRATE);
      await playerInput(page, releaseAttract ? { repulse: true, attract: false } : { repulse: true });
      const samples = await sampleFrames(page, { object: CRATE }, 700);
      const far = Math.max(...samples.map((p) => dist2D(p, player)));
      const end = await getObject(page, CRATE);
      console.log(`${how}: crate max distance ${far.toFixed(1)} (held at ${dist2D(held, player).toFixed(1)}), heldBy after ${end.heldBy}`);
      expect(far, "launched crate must fly away from the player along the aim").toBeGreaterThan(dist2D(held, player) + 5);
      expect(end.heldBy, "launched crate must not be re-captured by the thrower").not.toBe("PLAYER");
      expectNoErrors(errors);
    });
  }

  test("particle bursts do not dispose the shared particle texture", async ({ page }) => {
    const before = await page.evaluate(() => window.__MM_TEST__!.counts().textures);
    await playerInput(page, { repulse: true }); // repulse burst: 0.6 s, then disposeOnStop
    await page.waitForTimeout(1_500);
    const after = await page.evaluate(() => window.__MM_TEST__!.counts().textures);
    // The attract stream shares the burst texture; it must still be renderable afterwards.
    await playerInput(page, { attract: true });
    await page.waitForTimeout(300);
    const systems = await page.evaluate(() => window.__MM_TEST__!.particleSystems());
    console.log(`textures ${before} → ${after}; particle systems ${JSON.stringify(systems)}`);
    const stream = systems.find((p) => p.name === "attract-stream");
    expect(stream?.started, "attract stream runs while attracting").toBe(true);
    expect(stream?.ready, "attract stream must be renderable (its texture must not be disposed)").toBe(true);
    expect(after, "a finished burst must not dispose textures shared with other particle systems").toBe(before);
    expectNoErrors(errors);
  });

  test("one-shot particle bursts finish and dispose themselves during a match", async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await expect.poll(async () => (await getPlayer(page)).repulseCooldown, { timeout: REPULSE.cooldown * 1000 + 1_500 }).toBe(0);
      await playerInput(page, { repulse: true });
      await page.waitForTimeout(300);
    }
    // Each burst lives 0.6 s (targetStopDuration) plus particle lifetime, then disposes itself.
    await expect.poll(async () => (await page.evaluate(() => window.__MM_TEST__!.particleSystems()))
      .filter((p) => p.name === "burst").length, { timeout: 4_000 }).toBe(0);
  });
});
