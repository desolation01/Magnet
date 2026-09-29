import { expect, test, type Page } from "@playwright/test";
import {
  dist2D,
  expectNoErrors,
  getCharacter,
  getObjects,
  getPlayer,
  maxStep,
  openGame,
  parkAIFarAway,
  playerInput,
  sampleFrames,
  startMatch,
  teleport,
  teleportObject,
  trackErrors,
  waitGrounded,
} from "./helpers";

// Test site: the E outer platform (x 19..29, z −5..5). The player stands at its east end and aims
// west (−X, yaw −π/2) along the platform toward the bridge. AI are frozen and parked elsewhere.
const WEST = -Math.PI / 2;
const NORTH_Z = 0; // yaw 0 faces +Z
const SITE = { x: 27.5, y: 1.2, z: 0 };
const CRATE = 13; // spawns at (26, −3) on the E platform
const BALL = 14; // spawns at (22, 3) on the E platform

const getObject = async (page: Page, index: number) => (await getObjects(page)).find((o) => o.index === index)!;

async function setupSite(page: Page): Promise<void> {
  await openGame(page);
  await startMatch(page, { freezeAI: true });
  await parkAIFarAway(page);
  // Clear the E platform props out of the firing lane.
  await teleportObject(page, BALL, 27, 0.6, -4.2);
  await teleportObject(page, CRATE, 25, 0.6, -4.2);
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
    await teleportObject(page, CRATE, 21.5, 0.6, 0);
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

  test("attract pulls an AI toward the player", async ({ page }) => {
    await teleport(page, "AI-01", 21.5, 1.2, 0);
    await waitGrounded(page, "AI-01");
    const player = await getPlayer(page);
    const a0 = (await getCharacter(page, "AI-01"))!;
    const d0 = dist2D(a0, player);

    await playerInput(page, { attract: true });
    // The capture must happen inside the 1 s pull window (ATTRACT.characterPullTime).
    const [samples] = await Promise.all([
      sampleFrames(page, { character: "AI-01" }, 1_000),
      expect.poll(async () => (await getCharacter(page, "AI-01"))!.heldBy, { timeout: 1_000, intervals: [50] }).toBe("PLAYER"),
    ]);
    const d1 = dist2D(samples[samples.length - 1], player);
    console.log(`AI distance ${d0.toFixed(2)} → ${d1.toFixed(2)}, max per-frame step ${maxStep(samples).toFixed(2)}`);
    expect(d1).toBeLessThan(d0 - 1.5);
    expect(maxStep(samples)).toBeLessThan(1.5);
    await playerInput(page, { attract: false });
    await expect.poll(async () => (await getCharacter(page, "AI-01"))!.heldBy).toBeNull();
    expectNoErrors(errors);
  });

  test("a character can only be pulled for 1 s in a row, then is ignored for 3 s", async ({ page }) => {
    await teleport(page, "AI-01", 21.5, 1.2, 0);
    await waitGrounded(page, "AI-01");
    // Per frame, for `ms`: is AI-01 being dragged or held by the player's magnet?
    const sample = (ms: number) =>
      page.evaluate(
        (dur) =>
          new Promise<{ t: number; on: boolean }[]>((resolve) => {
            const out: { t: number; on: boolean }[] = [];
            const start = performance.now();
            const tick = (): void => {
              const s = window.__MM_TEST__!.getCharacter("AI-01");
              out.push({ t: performance.now() - start, on: !!s && (s.pulled || s.heldBy === "PLAYER") });
              if (performance.now() - start < dur) requestAnimationFrame(tick);
              else resolve(out);
            };
            requestAnimationFrame(tick);
          }),
        ms,
      );
    // Contiguous runs of contact / no contact, in ms.
    const toRuns = (samples: { t: number; on: boolean }[]) => {
      const runs: { on: boolean; ms: number }[] = [];
      for (let i = 1; i < samples.length; i++) {
        const on = samples[i].on;
        const ms = samples[i].t - samples[i - 1].t;
        if (runs.length && runs[runs.length - 1].on === on) runs[runs.length - 1].ms += ms;
        else runs.push({ on, ms });
      }
      return runs;
    };

    // Attract held for 3.8 s (magnet power lasts 4 s): one ~1 s pull, then nothing.
    await playerInput(page, { attract: true });
    const runs = toRuns(await sample(3_800));
    await playerInput(page, { attract: false });
    console.log(`pull runs: ${runs.map((r) => `${r.on ? "ON" : "off"} ${Math.round(r.ms)}`).join(", ")}`);
    const first = runs.findIndex((r) => r.on);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(runs[first].ms).toBeGreaterThan(850);
    expect(runs[first].ms).toBeLessThan(1_150);
    expect(runs.slice(first + 1).every((r) => !r.on), "no second pull during the 3 s lockout").toBe(true);
    expect(runs[first + 1].ms).toBeGreaterThan(2_500);

    // After the lockout (and some power regen) the same magnet can pull it again.
    await page.waitForTimeout(1_500);
    await playerInput(page, { attract: true });
    const again = toRuns(await sample(500));
    await playerInput(page, { attract: false });
    expect(again.some((r) => r.on), "pull works again after the lockout").toBe(true);
    expectNoErrors(errors);
  });

  test("attract does not reach targets beyond ~10.5 units or outside the cone", async ({ page }) => {
    // 12 units west (on the E bridge) and 6 units behind-left (outside the cone).
    await teleportObject(page, CRATE, 15.5, 0.6, 0);
    await teleport(page, "AI-01", 24, 1.2, 4);
    await page.waitForTimeout(500);
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
    await teleport(page, "AI-01", 23.5, 1.2, 0.8);
    await teleportObject(page, CRATE, 24, 0.6, -1);
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
    expect(numbers[0]).toBeGreaterThanOrEqual(3.8);
    for (let i = 1; i < numbers.length; i++) expect(numbers[i]).toBeLessThanOrEqual(numbers[i - 1]);
    const duration = (seen[seen.length - 1].t - seen[first].t) / 1000;
    console.log(`cooldown wall-clock duration ${duration.toFixed(2)} s`);
    expect(duration).toBeGreaterThan(3.6);
    expect(duration).toBeLessThan(5.5);
    expectNoErrors(errors);
  });

  test("repulse can knock an AI off a platform, which eliminates it", async ({ page }) => {
    await teleport(page, "PLAYER", 24, 1.2, -2);
    await teleport(page, "AI-01", 24, 1.2, 1.5);
    await playerInput(page, { aimYaw: NORTH_Z });
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
      await teleportObject(page, CRATE, 23, 0.6, 0);
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
      await expect.poll(async () => (await getPlayer(page)).repulseCooldown, { timeout: 4_000 }).toBe(0);
      await playerInput(page, { repulse: true });
      await page.waitForTimeout(300);
    }
    // Each burst lives 0.6 s (targetStopDuration) plus particle lifetime, then disposes itself.
    await expect.poll(async () => (await page.evaluate(() => window.__MM_TEST__!.particleSystems()))
      .filter((p) => p.name === "burst").length, { timeout: 4_000 }).toBe(0);
  });
});
