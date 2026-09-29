import { expect, type Page } from "@playwright/test";
import type { CharacterSnapshot, MagnetStats, ObjectSnapshot, TestInput } from "../src/game/DebugHooks";

export type { CharacterSnapshot, ObjectSnapshot };

/** Collects console errors and uncaught page errors for the whole test. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

export function expectNoErrors(errors: string[]): void {
  expect(errors, errors.join("\n")).toEqual([]);
}

/** Opens the game with the test API enabled (plus any extra query flags such as `noend`). */
export async function openGame(page: Page, extra = ""): Promise<void> {
  await page.goto(`/?test${extra ? `&${extra}` : ""}`);
  await expect(page.locator("#menu")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => !!window.__MM_TEST__), { timeout: 30_000 }).toBe(true);
}

export const state = (page: Page): Promise<string> => page.evaluate(() => window.__MM_DEBUG__?.state ?? "");

export async function waitState(page: Page, s: string, timeout = 30_000): Promise<void> {
  await expect.poll(() => state(page), { timeout }).toBe(s);
}

/** Clicks PLAY (optionally after picking a difficulty) and waits for PLAYING. */
export async function startMatch(page: Page, opts: { difficulty?: string; freezeAI?: boolean } = {}): Promise<void> {
  if (opts.difficulty) await page.locator(`#menu button.diff[data-difficulty="${opts.difficulty}"]`).click();
  await page.locator("#btn-play").click();
  if (opts.freezeAI) await freezeAI(page, true);
  await waitState(page, "PLAYING");
}

export const debug = (page: Page) =>
  page.evaluate(() => ({ ...window.__MM_DEBUG__ }));

export const getPlayer = (page: Page): Promise<CharacterSnapshot> =>
  page.evaluate(() => window.__MM_TEST__!.getPlayer()!);

export const getCharacter = (page: Page, name: string): Promise<CharacterSnapshot | null> =>
  page.evaluate((n) => window.__MM_TEST__!.getCharacter(n), name);

export const getCharacters = (page: Page): Promise<CharacterSnapshot[]> =>
  page.evaluate(() => window.__MM_TEST__!.getCharacters());

export const getObjects = (page: Page): Promise<ObjectSnapshot[]> =>
  page.evaluate(() => window.__MM_TEST__!.getObjects());

export const playerInput = (page: Page, input: TestInput): Promise<void> =>
  page.evaluate((i) => window.__MM_TEST__!.playerInput(i), input);

export const clearInput = (page: Page): Promise<void> => page.evaluate(() => window.__MM_TEST__!.clearInput());

/** Resolves after `n` animation frames (the game updates once per frame). */
export const frames = (page: Page, n = 3): Promise<void> =>
  page.evaluate((count) => new Promise<void>((resolve) => {
    let left = count;
    const tick = (): void => (--left <= 0 ? resolve() : void requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);

/** Teleports a character and waits a few frames so physics and `grounded` catch up. */
export async function teleport(page: Page, name: string, x: number, y: number, z: number): Promise<boolean> {
  const ok = await page.evaluate(([n, a, b, c]) => window.__MM_TEST__!.teleport(n as string, a as number, b as number, c as number), [name, x, y, z] as const);
  await frames(page);
  return ok;
}

export async function teleportObject(page: Page, index: number, x: number, y: number, z: number): Promise<boolean> {
  const ok = await page.evaluate(([i, a, b, c]) => window.__MM_TEST__!.teleportObject(i, a, b, c), [index, x, y, z] as const);
  await frames(page);
  return ok;
}

export const eliminate = (page: Page, name: string): Promise<boolean> =>
  page.evaluate((n) => window.__MM_TEST__!.eliminate(n), name);

export const eliminateAllAI = (page: Page): Promise<number> => page.evaluate(() => window.__MM_TEST__!.eliminateAllAI());

export const freezeAI = (page: Page, frozen: boolean): Promise<void> =>
  page.evaluate((f) => window.__MM_TEST__!.freezeAI(f), frozen);

export const stats = (page: Page): Promise<Record<string, MagnetStats>> => page.evaluate(() => window.__MM_TEST__!.stats());

/**
 * Moves every AI to the W, N and S outer platforms (clear of props) so they cannot interfere with a
 * player-focused test. The E platform (x 19..29, z −5..5) and the E half of the central platform
 * are left free as the test site.
 */
export async function parkAIFarAway(page: Page): Promise<void> {
  const spots: [number, number][] = [[-22, -3], [-22, 3], [-26, -3], [0, -24], [3, -22], [-3, -26], [0, 24], [-3, 22], [-3, 26], [0, 21]];
  const names = (await getCharacters(page)).filter((c) => c.name !== "PLAYER" && c.alive).map((c) => c.name);
  for (let i = 0; i < names.length; i++) await teleport(page, names[i], spots[i][0], 1.5, spots[i][1]);
}

export const dist2D = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Yaw (0 = +Z) from `a` looking at `b`, matching the game's yawOf(dx, dz). */
export const yawTo = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.atan2(b.x - a.x, b.z - a.z);

/**
 * Samples a value every animation frame for `ms` milliseconds inside the page.
 * `what` selects a character (by name) or a magnetic object (by spawn index).
 */
export async function sampleFrames(
  page: Page,
  what: { character: string } | { object: number },
  ms: number,
): Promise<{ x: number; y: number; z: number; t: number }[]> {
  return page.evaluate(
    ([w, dur]) =>
      new Promise((resolve) => {
        const out: { x: number; y: number; z: number; t: number }[] = [];
        const start = performance.now();
        const tick = (): void => {
          const api = window.__MM_TEST__!;
          const s = "character" in w
            ? api.getCharacter(w.character)
            : api.getObjects().find((o) => o.index === w.object) ?? null;
          if (s) out.push({ x: s.x, y: s.y, z: s.z, t: performance.now() - start });
          if (performance.now() - start < dur) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    [what, ms] as const,
  );
}

/** Largest per-frame displacement in a sample list (teleport detector). */
export function maxStep(samples: { x: number; y: number; z: number }[]): number {
  let m = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    m = Math.max(m, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  return m;
}

/** Waits until the named character is standing on something and nearly at rest. */
export async function waitGrounded(page: Page, name = "PLAYER"): Promise<void> {
  await expect
    .poll(async () => {
      const c = await getCharacter(page, name);
      return !!c && c.grounded && Math.abs(c.vy) < 0.5 && Math.hypot(c.vx, c.vz) < 0.5;
    }, { timeout: 5_000 })
    .toBe(true);
}
