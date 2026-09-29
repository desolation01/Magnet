import { expect, test, type Page } from "@playwright/test";
import { SPAWN } from "../src/config";
import {
  arenaSnapshot,
  dist2D,
  expectNoErrors,
  footprintDistance,
  freeSpots,
  getObjects,
  getPlayer,
  openGame,
  parkAIFarAway,
  route,
  SITES,
  startMatch,
  teleportObject,
  trackErrors,
  waitGrounded,
  type ArenaSnapshot,
  type XZ,
} from "./helpers";

/**
 * Arena expansion layout checks (docs/superpowers/specs/2026-09-29-arena-expansion-design.md §1, §7–§9):
 * routing between every pair of base platforms, spawn/object clearance, and reaching remote platforms on foot.
 */

/** Waypoint budget for one route: two waypoints per walkway crossed (its near and far entry) plus the target. */
const MAX_CROSSINGS = 8;
const MAX_WAYPOINTS = 2 * MAX_CROSSINGS + 1;
/** Sampling step along route segments, in world units. */
const STEP = 0.25;

const nodesOf = (a: ArenaSnapshot) => a.platforms.filter((p) => p.kind !== "bridge");

test.describe("arena layout (spec §1, §7, §8)", () => {
  let errors: string[] = [];
  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
    await openGame(page);
  });

  test("the layout has a hub, 4 cardinals, 4 islands and 12 walkways", async ({ page }) => {
    const a = await arenaSnapshot(page);
    const nodes = nodesOf(a);
    const walkways = a.platforms.filter((p) => p.kind === "bridge");
    expect(nodes.map((n) => n.name).sort()).toEqual(["E", "N", "NE", "NW", "S", "SE", "SW", "W", "hub"]);
    expect(walkways).toHaveLength(12);
    for (const [name, site] of Object.entries(SITES)) {
      if (name === "HUB" || name === "PLAYER_SPAWN") continue;
      const n = nodes.find((p) => p.name === name)!;
      expect({ x: n.cx, z: n.cz }, `SITES.${name} matches the layout`).toEqual(site);
    }
    // Every walkway joins two base platforms, and every base platform is joined to at least one walkway.
    for (const w of walkways) expect(w.ends, `${w.name} ends`).not.toBeNull();
    for (const n of nodes) expect(walkways.some((w) => w.ends!.includes(n.name)), `${n.name} has a walkway`).toBe(true);
    expectNoErrors(errors);
  });

  test("routing: every platform reaches every other one over platforms and walkways only", async ({ page }) => {
    const a = await arenaSnapshot(page);
    const nodes = nodesOf(a);
    const failures: string[] = [];
    const summary: string[] = [];
    for (const from of nodes) {
      for (const to of nodes) {
        if (from === to) continue;
        const start = { x: from.cx, z: from.cz };
        const target = { x: to.cx, z: to.cz };
        const r = await route(page, start, target, MAX_WAYPOINTS);
        const tag = `${from.name}→${to.name}`;
        if (!r.reached) {
          failures.push(`${tag}: not reached in ${MAX_WAYPOINTS} waypoints: ${JSON.stringify(r.points)}`);
          continue;
        }
        const last = r.points[r.points.length - 1];
        if (dist2D(last, target) > 1e-6) failures.push(`${tag}: ends at ${JSON.stringify(last)}, not the target`);

        // Every sample along every segment (from the start through each waypoint) lies over ground,
        // and the platforms visited change only through walkways.
        const check = await page.evaluate(([pts, step]) => {
          const api = window.__MM_TEST__!;
          const bad: string[] = [];
          const visited: string[] = [];
          for (let i = 1; i < pts.length; i++) {
            const p = pts[i - 1];
            const q = pts[i];
            const len = Math.hypot(q.x - p.x, q.z - p.z);
            const n = Math.max(1, Math.ceil(len / step));
            for (let k = 0; k <= n; k++) {
              const x = p.x + ((q.x - p.x) * k) / n;
              const z = p.z + ((q.z - p.z) * k) / n;
              const e = api.edgeInfo(x, z);
              if (e.distance < 0 || !e.platform) bad.push(`segment ${i} (${x.toFixed(2)}, ${z.toFixed(2)}) over the void`);
              else if (visited[visited.length - 1] !== e.platform) visited.push(e.platform);
            }
          }
          return { bad, visited };
        }, [[start, ...r.points], STEP] as const);
        for (const b of check.bad.slice(0, 3)) failures.push(`${tag}: ${b}`);
        // Walkway names are "spoke-*" / "catwalk-*"; base platforms must never touch without one between.
        const isWalkway = (n: string) => a.platforms.find((p) => p.name === n)?.kind === "bridge";
        for (let i = 1; i < check.visited.length; i++) {
          if (!isWalkway(check.visited[i - 1]) && !isWalkway(check.visited[i])) {
            failures.push(`${tag}: jumps from ${check.visited[i - 1]} to ${check.visited[i]} without a walkway`);
          }
        }
        const crossings = check.visited.filter(isWalkway).length;
        if (crossings > MAX_CROSSINGS) failures.push(`${tag}: crosses ${crossings} walkways`);
        summary.push(`${tag}: ${r.points.length} wp, ${check.visited.join(">")}`);
      }
    }
    console.log(summary.join("\n"));
    expect(failures, failures.join("\n")).toEqual([]);
    expectNoErrors(errors);
  });

  test("routing: a target over the void is clamped onto a platform", async ({ page }) => {
    // Between the hub and the E cardinal, off the spoke bridge (the old E platform location).
    const r = await route(page, SITES.HUB, { x: 24, z: 6 }, MAX_WAYPOINTS);
    expect(r.reached).toBe(true);
    const last = r.points[r.points.length - 1];
    const e = await page.evaluate(([x, z]) => window.__MM_TEST__!.edgeInfo(x, z), [last.x, last.z] as const);
    expect(e.platform, `clamped target ${JSON.stringify(last)}`).not.toBeNull();
    expect(e.distance).toBeGreaterThanOrEqual(0);
    expectNoErrors(errors);
  });

  test("clearance: spawns and object spawns sit on platforms, clear of colliders and of each other", async ({ page }) => {
    const a = await arenaSnapshot(page);
    const blockers = [...a.colliders.map((c) => ({ ...c, label: c.name! })), ...a.obstacles.map((o, i) => ({ ...o, label: `obstacle#${i}` }))];
    const failures: string[] = [];
    const edge = (p: XZ) => page.evaluate(([x, z]) => window.__MM_TEST__!.edgeInfo(x, z), [p.x, p.z] as const);

    expect(a.spawns).toHaveLength(11);
    expect(a.spawns).toEqual(SPAWN.points);
    const spawns = a.spawns.map(([x, z]) => ({ x, z }));
    for (const [i, s] of spawns.entries()) {
      const e = await edge(s);
      if (!e.platform || e.kind === "bridge" || e.distance < 2) failures.push(`spawn ${i} ${JSON.stringify(s)}: edge ${JSON.stringify(e)}`);
      for (const b of blockers) {
        const d = footprintDistance(s, b);
        if (d < 2) failures.push(`spawn ${i} ${JSON.stringify(s)}: ${d.toFixed(2)} from ${b.label}`);
      }
      for (let j = i + 1; j < spawns.length; j++) {
        const d = dist2D(s, spawns[j]);
        if (d < 4) failures.push(`spawns ${i} and ${j}: ${d.toFixed(2)} apart`);
      }
    }

    expect(a.objectSpawns.length).toBeGreaterThanOrEqual(16);
    for (const [i, o] of a.objectSpawns.entries()) {
      const e = await edge(o);
      if (!e.platform || e.kind === "bridge" || e.distance < 1) failures.push(`object ${i} ${o.kind} ${JSON.stringify(o)}: edge ${JSON.stringify(e)}`);
      for (const b of blockers) {
        const d = footprintDistance(o, b);
        if (d < 0.8) failures.push(`object ${i} ${o.kind} ${JSON.stringify(o)}: ${d.toFixed(2)} from ${b.label}`);
      }
      for (const [j, s] of spawns.entries()) {
        const d = dist2D(o, s);
        if (d < 1.5) failures.push(`object ${i} ${o.kind}: ${d.toFixed(2)} from character spawn ${j}`);
      }
      for (let j = i + 1; j < a.objectSpawns.length; j++) {
        const d = dist2D(o, a.objectSpawns[j]);
        if (d < 1.5) failures.push(`objects ${i} and ${j}: ${d.toFixed(2)} apart`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
    expectNoErrors(errors);
  });
});

/** Distance from a point to the polyline through `pts`. */
function polylineDistance(p: XZ, pts: XZ[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const lx = b.x - a.x;
    const lz = b.z - a.z;
    const l2 = lx * lx + lz * lz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * lx + (p.z - a.z) * lz) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + lx * t), p.z - (a.z + lz * t)));
  }
  return best;
}

interface WalkResult {
  arrived: boolean;
  alive: boolean;
  seconds: number;
  minY: number;
  end: XZ;
  platform: string | null;
  jumps: number;
  trail: string[];
}

/**
 * Walks the player to `target` with the test input override, steering every frame toward the first
 * waypoint of Arena.nextWaypoint from the current position (what an AI does). Jumps once when it makes no
 * progress for a second. Arrives within 1 unit of the target, or anywhere at least 2 units inside the target
 * platform when the target point itself is blocked by terrain.
 */
function walkTo(page: Page, target: XZ, platform: string, timeoutMs: number): Promise<WalkResult> {
  return page.evaluate(
    ([t, name, timeout]) =>
      new Promise<WalkResult>((resolve) => {
        const api = window.__MM_TEST__!;
        const start = performance.now();
        const blocked = api.isObstructed(t.x, t.z, 0.6);
        let minY = Infinity;
        let jumps = 0;
        let lastProgress = start;
        let best = Infinity;
        let lastTrail = 0;
        const trail: string[] = [];
        const finish = (arrived: boolean): void => {
          api.playerInput({ moveDir: { x: 0, z: 0 } });
          const p = api.getPlayer();
          const e = p ? api.edgeInfo(p.x, p.z) : null;
          resolve({
            arrived, alive: !!p?.alive, seconds: (performance.now() - start) / 1000, minY,
            end: { x: p?.x ?? NaN, z: p?.z ?? NaN }, platform: e?.platform ?? null, jumps, trail,
          });
        };
        const tick = (): void => {
          const now = performance.now();
          const p = api.getPlayer();
          if (!p || !p.alive) return finish(false);
          minY = Math.min(minY, p.y);
          const e = api.edgeInfo(p.x, p.z);
          const d = Math.hypot(t.x - p.x, t.z - p.z);
          if (d < 1 || (blocked && e.platform === name && e.distance >= 2)) return finish(true);
          if (now - start > timeout) return finish(false);
          if (now - lastTrail > 1000) {
            lastTrail = now;
            trail.push(`${((now - start) / 1000).toFixed(0)}s (${p.x.toFixed(1)},${p.z.toFixed(1)}) ${e.platform}`);
          }
          const wp = api.route(p.x, p.z, t.x, t.z, 1).points[0] ?? t;
          const dx = wp.x - p.x;
          const dz = wp.z - p.z;
          const len = Math.hypot(dx, dz) || 1;
          api.playerInput({ moveDir: { x: dx / len, z: dz / len }, sprint: false });
          if (d < best - 0.3) {
            best = d;
            lastProgress = now;
          } else if (now - lastProgress > 1000 && p.grounded) {
            api.playerInput({ jump: true });
            jumps++;
            lastProgress = now;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [target, platform, timeoutMs] as const,
  );
}

/**
 * Gets the route from the player's spawn out of the way: AI are parked on platforms the route does not use,
 * and magnetic objects within 2.5 units of the route are moved to free hub spots away from it.
 */
async function clearRoute(page: Page, target: XZ): Promise<XZ[]> {
  const p = await getPlayer(page);
  const r = await route(page, p, target, MAX_WAYPOINTS);
  expect(r.reached, `route to ${JSON.stringify(target)}`).toBe(true);
  const path = [{ x: p.x, z: p.z }, ...r.points];
  const used = new Set<string>();
  for (const q of path) {
    const e = await page.evaluate(([x, z]) => window.__MM_TEST__!.edgeInfo(x, z), [q.x, q.z] as const);
    if (e.platform) used.add(e.platform);
  }
  const a = await arenaSnapshot(page);
  const parking = nodesOf(a).map((n) => n.name).filter((n) => n !== "hub" && !used.has(n)).slice(0, 3);
  await parkAIFarAway(page, parking);

  const objs = (await getObjects(page)).filter((o) => o.alive && polylineDistance(o, path) < 2.5);
  const spots = (await freeSpots(page, "hub", { avoid: (await getObjects(page)).filter((o) => o.alive) }))
    .filter((s) => polylineDistance(s, path) > 4);
  expect(spots.length, "free hub spots for moved objects").toBeGreaterThanOrEqual(objs.length);
  for (const [i, o] of objs.entries()) await teleportObject(page, o.index, spots[i].x, 1.5, spots[i].z);
  return path;
}

test.describe("reach on foot (spec §9.4)", () => {
  let errors: string[] = [];
  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
    await openGame(page);
    await startMatch(page, { freezeAI: true });
    await waitGrounded(page);
  });

  for (const dest of ["NE", "W"] as const) {
    test(`the player walks from its hub spawn to the ${dest} platform along the routing waypoints`, async ({ page }) => {
      test.setTimeout(120_000);
      const target = SITES[dest];
      const path = await clearRoute(page, target);
      console.log(`route to ${dest}: ${path.map((q) => `(${q.x.toFixed(1)},${q.z.toFixed(1)})`).join(" → ")}`);
      const res = await walkTo(page, target, dest, 60_000);
      console.log(`walk to ${dest}: ${JSON.stringify({ ...res, trail: undefined })}\n  ${res.trail.join("\n  ")}`);
      expect(res.alive, "the player must not fall off on the way").toBe(true);
      expect(res.minY, "the player never drops below the platform tops").toBeGreaterThan(-0.5);
      expect(res.arrived, `arrive at ${dest} (ended at ${JSON.stringify(res.end)} on ${res.platform})`).toBe(true);
      expect(res.platform).toBe(dest);
      expectNoErrors(errors);
    });
  }
});
