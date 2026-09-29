import { expect, test, type Page } from "@playwright/test";
import {
  dist2D,
  expectNoErrors,
  getObjects,
  getPlayer,
  openGame,
  parkAIFarAway,
  sampleFrames,
  startMatch,
  teleport,
  teleportObject,
  trackErrors,
  waitGrounded,
} from "./helpers";

/**
 * Drives the REAL input path (PlayerController) with page.mouse / page.keyboard. The test API is
 * used only for setup (freeze/park AI, teleports) and for reading state, never for player input.
 *
 * Headless Chromium cannot acquire pointer lock, so it is stubbed before any page script runs:
 * requestPointerLock() makes document.pointerLockElement return the canvas and fires
 * `pointerlockchange`, exactly like a browser that granted the lock.
 */
async function stubPointerLock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __fakeLock: boolean };
    w.__fakeLock = false;
    const fire = (): void => void setTimeout(() => document.dispatchEvent(new Event("pointerlockchange")), 0);
    Object.defineProperty(Document.prototype, "pointerLockElement", {
      configurable: true,
      get: () => (w.__fakeLock ? document.getElementById("renderCanvas") : null),
    });
    HTMLCanvasElement.prototype.requestPointerLock = function () {
      w.__fakeLock = true;
      fire();
      return Promise.resolve();
    } as typeof HTMLCanvasElement.prototype.requestPointerLock;
    Document.prototype.exitPointerLock = function () {
      w.__fakeLock = false;
      fire();
    };
  });
}

// A point over the canvas (the #ui overlay is pointer-events: none).
const X = 640;
const Y = 420;
const CRATE = 13; // E-platform crate
const BALL = 14; // E-platform ball

test.describe("real mouse + keyboard input (§6, §8, §9, §2.2)", () => {
  let errors: string[] = [];
  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
    await stubPointerLock(page);
    await openGame(page);
    await startMatch(page, { freezeAI: true });
    await parkAIFarAway(page);
    await teleportObject(page, BALL, 27, 0.6, -4.2);
    await teleportObject(page, CRATE, 20.5, 0.6, 4);
    await teleport(page, "PLAYER", 24, 1.2, 3);
    await waitGrounded(page);
    // Sanity: the stubbed lock was taken when the countdown started, and the canvas is under the cursor.
    expect(await page.evaluate(() => document.pointerLockElement?.id ?? null)).toBe("renderCanvas");
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id ?? null, [X, Y])).toBe("renderCanvas");
    await page.mouse.move(X, Y);
  });

  test.afterEach(async ({ page }) => {
    await page.mouse.up({ button: "left" }).catch(() => undefined);
    await page.mouse.up({ button: "right" }).catch(() => undefined);
  });

  test("(a) holding the left button attracts and drains magnet power", async ({ page }) => {
    await page.mouse.down({ button: "left" });
    await expect.poll(async () => (await getPlayer(page)).attracting, { timeout: 2_000, message: "left button held → attracting" }).toBe(true);
    await expect.poll(async () => (await getPlayer(page)).power, { timeout: 3_000 }).toBeLessThan(85);
    await page.mouse.up({ button: "left" });
    await expect.poll(async () => (await getPlayer(page)).attracting, { timeout: 2_000 }).toBe(false);
    expectNoErrors(errors);
  });

  test("(b) right click repulses (cooldown starts)", async ({ page }) => {
    expect((await getPlayer(page)).repulseCooldown).toBe(0);
    await page.mouse.click(X, Y, { button: "right" });
    await expect.poll(async () => (await getPlayer(page)).repulseCooldown, { timeout: 2_000, message: "right click → repulse cooldown" }).toBeGreaterThan(0);
    await expect(page.locator("#repulse-status")).not.toHaveText("READY");
    expectNoErrors(errors);
  });

  test("(c1) chorded: holding left, a right click repulses while still attracting", async ({ page }) => {
    await page.mouse.down({ button: "left" });
    await expect.poll(async () => (await getPlayer(page)).attracting, { timeout: 2_000, message: "left button held → attracting" }).toBe(true);
    await page.mouse.down({ button: "right" });
    await expect.poll(async () => (await getPlayer(page)).repulseCooldown, { timeout: 2_000, message: "right press while left held → repulse" }).toBeGreaterThan(0);
    await page.mouse.up({ button: "right" });
    expect((await getPlayer(page)).attracting, "attract continues after the chorded right click").toBe(true);
    await page.mouse.up({ button: "left" });
    expectNoErrors(errors);
  });

  test("(c2) chorded: a held crate is launched by right click while left is held", async ({ page }) => {
    // Put the crate 3.5 units in front of the player along the current camera aim.
    const p = await getPlayer(page);
    await teleportObject(page, CRATE, p.x + Math.sin(p.aimYaw) * 3.5, 0.6, p.z + Math.cos(p.aimYaw) * 3.5);
    await page.mouse.down({ button: "left" });
    await expect.poll(async () => (await getObjects(page)).find((o) => o.index === CRATE)?.heldBy ?? null,
      { timeout: 4_000, message: "crate captured by attract" }).toBe("PLAYER");
    await page.waitForTimeout(300);
    const player = await getPlayer(page);
    const held = (await getObjects(page)).find((o) => o.index === CRATE)!;

    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    const samples = await sampleFrames(page, { object: CRATE }, 700);
    const far = Math.max(...samples.map((s) => dist2D(s, player)));
    console.log(`chorded launch: crate max distance ${far.toFixed(1)} (held at ${dist2D(held, player).toFixed(1)})`);
    expect((await getPlayer(page)).repulseCooldown, "repulse fired").toBeGreaterThan(0);
    expect(far, "held crate launched along the aim").toBeGreaterThan(dist2D(held, player) + 5);
    await page.mouse.up({ button: "left" });
    expectNoErrors(errors);
  });

  test("(d) releasing left while right is held stops attract", async ({ page }) => {
    await page.mouse.down({ button: "left" });
    await expect.poll(async () => (await getPlayer(page)).attracting, { timeout: 2_000, message: "left button held → attracting" }).toBe(true);
    await page.mouse.down({ button: "right" });
    await page.waitForTimeout(100);
    await page.mouse.up({ button: "left" });
    await expect.poll(async () => (await getPlayer(page)).attracting, { timeout: 2_000, message: "left released → attract stops" }).toBe(false);
    await page.mouse.up({ button: "right" });
    expectNoErrors(errors);
  });

  test("(e) W moves the player camera-relative and mouse movement turns the camera", async ({ page }) => {
    const p0 = await getPlayer(page);
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(250);
    await page.keyboard.up("KeyW");
    const p1 = await getPlayer(page);
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const moved = Math.hypot(dx, dz);
    expect(moved, "W moves the player").toBeGreaterThan(0.8);
    // Forward is the camera aim: (sin yaw, cos yaw).
    const along = (dx * Math.sin(p0.aimYaw) + dz * Math.cos(p0.aimYaw)) / moved;
    expect(along, "W moves along the camera's forward direction").toBeGreaterThan(0.9);

    const yaw0 = (await getPlayer(page)).aimYaw;
    await page.mouse.move(X + 200, Y, { steps: 10 });
    await expect.poll(async () => Math.abs((await getPlayer(page)).aimYaw - yaw0), { timeout: 2_000, message: "mouse movement → camera yaw" })
      .toBeGreaterThan(0.1);
    expectNoErrors(errors);
  });
});
