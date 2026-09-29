import { expect, type Page } from "@playwright/test";
import { ARENA, SPAWN } from "../src/config";
import type {
  ArenaSnapshot,
  CharacterSnapshot,
  EdgeSnapshot,
  MagnetStats,
  ObjectSnapshot,
  RouteResult,
  TestInput,
} from "../src/game/DebugHooks";

export type { ArenaSnapshot, CharacterSnapshot, EdgeSnapshot, ObjectSnapshot, RouteResult };

export interface XZ {
  x: number;
  z: number;
}

const C = ARENA.cardinalDistance;
const I = ARENA.islandOffset;

/**
 * Named test sites derived from the layout in src/config.ts (N = −Z, E = +X, platform tops at y = 0).
 * Cardinal platforms are ARENA.cardinalSize squares centered at distance ARENA.cardinalDistance on the
 * axes; islands are circles of ARENA.islandRadius at (±islandOffset, ±islandOffset).
 */
export const SITES = {
  HUB: { x: 0, z: 0 },
  PLAYER_SPAWN: { x: SPAWN.points[0][0], z: SPAWN.points[0][1] },
  N: { x: 0, z: -C },
  S: { x: 0, z: C },
  E: { x: C, z: 0 },
  W: { x: -C, z: 0 },
  NE: { x: I, z: -I },
  SE: { x: I, z: I },
  SW: { x: -I, z: I },
  NW: { x: -I, z: -I },
} satisfies Record<string, XZ>;

/** Half size of a cardinal platform (E spans x = E.x ± CARDINAL_HALF, z = ± CARDINAL_HALF). */
export const CARDINAL_HALF = ARENA.cardinalSize / 2;

/** Open sky well beyond the E cardinal's outer edge (x = E.x + CARDINAL_HALF); anything here falls. */
export const VOID_EAST: XZ = { x: C + CARDINAL_HALF + 9, z: 0 };
/** Open sky well beyond the N cardinal's outer edge. */
export const VOID_NORTH: XZ = { x: 0, z: -(C + CARDINAL_HALF + 9) };
/** Open sky beyond the S cardinal's outer edge. */
export const VOID_SOUTH: XZ = { x: 0, z: C + CARDINAL_HALF + 9 };

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

// ---------------------------------------------------------------- arena queries (window.__MM_TEST__)

export const arenaSnapshot = (page: Page): Promise<ArenaSnapshot> => page.evaluate(() => window.__MM_TEST__!.arena());

export const edgeInfo = (page: Page, x: number, z: number): Promise<EdgeSnapshot> =>
  page.evaluate(([a, b]) => window.__MM_TEST__!.edgeInfo(a, b), [x, z] as const);

export const route = (page: Page, from: XZ, to: XZ, maxHops = 8): Promise<RouteResult> =>
  page.evaluate(([f, t, n]) => window.__MM_TEST__!.route(f.x, f.z, t.x, t.z, n), [from, to, maxHops] as const);

/** Distance from a point to a rect/circle footprint (0 inside). */
export function footprintDistance(p: XZ, f: { x: number; z: number; hx: number; hz: number; circle: boolean }): number {
  if (f.circle) return Math.max(0, Math.hypot(p.x - f.x, p.z - f.z) - f.hx);
  const dx = Math.max(0, Math.abs(p.x - f.x) - f.hx);
  const dz = Math.max(0, Math.abs(p.z - f.z) - f.hz);
  return Math.hypot(dx, dz);
}

/**
 * Spawn index of the live magnetic object of `kind` nearest to `near`. Object lists change as props are
 * added, so tests never hard-code spawn indices.
 */
export async function findObject(page: Page, kind: string, near: XZ): Promise<number> {
  const objs = (await getObjects(page)).filter((o) => o.kind === kind && o.alive);
  if (!objs.length) throw new Error(`no live ${kind} object`);
  objs.sort((a, b) => dist2D(a, near) - dist2D(b, near));
  return objs[0].index;
}

/**
 * Free standing spots on a base platform: a grid at `spacing`, at least `edge` inside the rim, clear of
 * static colliders/obstacles by `clear`, and at least `clear` from every point in `avoid`.
 */
export async function freeSpots(page: Page, platform: string, opts: { spacing?: number; edge?: number; clear?: number; avoid?: XZ[] } = {}): Promise<XZ[]> {
  const { spacing = 2.5, edge = 2, clear = 2, avoid = [] } = opts;
  const a = await arenaSnapshot(page);
  const p = a.platforms.find((q) => q.name === platform);
  if (!p) throw new Error(`unknown platform ${platform}`);
  const ext = p.shape === "circle" ? p.radius : Math.max(p.hx, p.hz);
  const blockers = [...a.colliders, ...a.obstacles];
  const out: XZ[] = [];
  for (let dx = -ext; dx <= ext; dx += spacing) {
    for (let dz = -ext; dz <= ext; dz += spacing) {
      const s = { x: p.cx + dx, z: p.cz + dz };
      const e = await edgeInfo(page, s.x, s.z);
      if (e.platform !== platform || e.distance < edge) continue;
      if (blockers.some((b) => footprintDistance(s, b) < clear)) continue;
      if (avoid.some((v) => dist2D(v, s) < clear)) continue;
      out.push(s);
    }
  }
  return out;
}

/**
 * Moves every AI onto the given platforms (default W, N and S cardinals), on free spots away from props,
 * so they cannot interfere with a player-focused test. The E cardinal and the hub are left free.
 */
export async function parkAIFarAway(page: Page, platforms: string[] = ["W", "N", "S"]): Promise<void> {
  const objs = (await getObjects(page)).filter((o) => o.alive);
  const lists = await Promise.all(platforms.map((p) => freeSpots(page, p, { avoid: objs })));
  const spots: XZ[] = [];
  for (let i = 0; spots.length < 10 && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) spots.push(l[i]);
  }
  const names = (await getCharacters(page)).filter((c) => c.name !== "PLAYER" && c.alive).map((c) => c.name);
  if (spots.length < names.length) throw new Error(`only ${spots.length} parking spots on ${platforms.join(",")}`);
  for (let i = 0; i < names.length; i++) await teleport(page, names[i], spots[i].x, SPAWN.height, spots[i].z);
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

/**
 * Moves every live magnetic object standing on `platform` (except `keep`) into a row along its north
 * (−Z) side, out of an east–west firing lane through the platform center. Returns the moved indices.
 */
export async function clearPlatformObjects(page: Page, platform: string, keep: number[] = []): Promise<number[]> {
  const a = await arenaSnapshot(page);
  const p = a.platforms.find((q) => q.name === platform)!;
  const moved: number[] = [];
  for (const o of await getObjects(page)) {
    if (!o.alive || keep.includes(o.index)) continue;
    if ((await edgeInfo(page, o.x, o.z)).platform !== platform) continue;
    const x = p.cx + 3 - 1.5 * moved.length;
    await teleportObject(page, o.index, x, 1.2, p.cz - (CARDINAL_HALF - 2));
    moved.push(o.index);
  }
  return moved;
}
