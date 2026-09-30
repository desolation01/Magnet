import { test } from "@playwright/test";
import { expectNoErrors, openGame, startMatch, trackErrors } from "./helpers";

/**
 * Balance playtest (AGENTS.md Phase 9 balance targets, arena expansion spec §8). Opt-in only:
 *
 *   PLAYTEST=1 npx playwright test tests/playtest.spec.ts
 *
 * Runs 3 NORMAL matches in a row with an idle player (no input, nothing frozen) and `?noend`, each until
 * at most one character is left or 240 s of match time, then prints a summary table built from
 * window.__MM_DUMP__(). It asserts nothing about balance (the numbers vary run to run); only page errors fail it.
 */

const MATCHES = Number(process.env.PLAYTEST_MATCHES ?? 3);
const MATCH_LIMIT_S = Number(process.env.PLAYTEST_LIMIT ?? 240);
/** PLAYTEST_PLAYER=idle keeps the player standing still; the default wanders the hub like a moving target. */
const PLAYER_MODE = process.env.PLAYTEST_PLAYER ?? "move";

interface Elimination {
  name: string;
  time: number;
  by: string | null;
  x: number;
  z: number;
  speed: number;
  gx?: number;
  gz?: number;
  behavior?: string;
  hit?: unknown;
}

interface Dump {
  time: number;
  eliminations: Elimination[];
  projectileHits?: number;
  ai: { name: string; personality: string; alive: boolean; stats?: Record<string, number> }[];
}

interface MatchSummary {
  match: number;
  firstElim: number | null;
  length: number;
  finished: boolean;
  selfFalls: number;
  maxSpeed: number;
  aliveAtEnd: number;
  playerOut: number | null;
}

test.skip(!process.env.PLAYTEST, "balance playtest: set PLAYTEST=1 to run");

test("balance playtest: NORMAL, idle player, noend", async ({ page }) => {
  test.setTimeout(MATCHES * (MATCH_LIMIT_S + 60) * 1000);
  const errors = trackErrors(page);
  const rows: MatchSummary[] = [];

  for (let m = 1; m <= MATCHES; m++) {
    await openGame(page, "noend");
    await startMatch(page, { difficulty: process.env.PLAYTEST_DIFFICULTY ?? "NORMAL" });
    if (PLAYER_MODE === "move") {
      // A moving target: walk (sometimes sprint) between random points on the hub, re-picked every 2–4 s.
      await page.evaluate(() => {
        const t = window.__MM_TEST__!;
        let wx = 0;
        let wz = 0;
        let next = 0;
        let sprint = false;
        setInterval(() => {
          const p = t.getPlayer();
          if (!p || !p.alive) return;
          const now = performance.now();
          if (now > next || Math.hypot(wx - p.x, wz - p.z) < 1.5) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * 12;
            wx = Math.cos(a) * r;
            wz = Math.sin(a) * r;
            next = now + 2000 + Math.random() * 2000;
            sprint = Math.random() < 0.3;
          }
          const dx = wx - p.x;
          const dz = wz - p.z;
          const l = Math.hypot(dx, dz) || 1;
          t.playerInput({ moveDir: { x: dx / l, z: dz / l }, sprint });
        }, 100);
      });
    }
    let dump: Dump;
    let alive: number;
    for (;;) {
      await page.waitForTimeout(1_000);
      dump = (await page.evaluate(() => window.__MM_DUMP__())) as Dump;
      alive = await page.evaluate(() => window.__MM_DEBUG__.aliveCount);
      if (alive <= 1 || dump.time >= MATCH_LIMIT_S) break;
    }
    const aiElims = dump.eliminations.filter((e) => e.name !== "PLAYER");
    const finished = alive <= 1;
    const player = dump.eliminations.find((e) => e.name === "PLAYER");
    const row: MatchSummary = {
      match: m,
      firstElim: aiElims.length ? Math.min(...aiElims.map((e) => e.time)) : null, // first AI elimination
      length: finished && aiElims.length ? Math.max(...aiElims.map((e) => e.time)) : MATCH_LIMIT_S,
      finished,
      selfFalls: dump.eliminations.filter((e) => e.by === null).length,
      maxSpeed: dump.eliminations.length ? Math.max(...dump.eliminations.map((e) => e.speed ?? 0)) : 0,
      aliveAtEnd: alive,
      playerOut: player ? player.time : null,
    };
    rows.push(row);
    console.log(`\n=== match ${m}: ${JSON.stringify(row)}`);
    console.log("personalities:", dump.ai.map((a) => `${a.name}=${a.personality}${a.alive ? "*" : ""}`).join(" "));
    console.log("eliminations (time, name, by, speed, ground x/z, behavior):");
    for (const e of dump.eliminations) {
      console.log(`  ${e.time.toFixed(1).padStart(6)}s  ${e.name.padEnd(6)} by ${String(e.by).padEnd(6)} `
        + `speed ${(e.speed ?? 0).toFixed(1).padStart(5)}  g(${e.gx ?? "?"}, ${e.gz ?? "?"})  ${e.behavior ?? ""}  ${String(e.hit ?? "")}`);
    }
    const totals: Record<string, number> = {};
    for (const a of dump.ai) for (const [k, v] of Object.entries(a.stats ?? {})) totals[k] = (totals[k] ?? 0) + v;
    console.log("AI kill-combo totals:", JSON.stringify(totals), "projectile hits:", dump.projectileHits ?? "?");
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  console.log("\nmatch | first AI elim (s) | length (s) | finished | self-falls | max speed | alive at end | player out (s)");
  for (const r of rows) {
    console.log(`${String(r.match).padStart(5)} | ${String(r.firstElim ?? "-").padStart(14)} | ${r.length.toFixed(1).padStart(10)} | `
      + `${String(r.finished).padStart(8)} | ${String(r.selfFalls).padStart(10)} | ${r.maxSpeed.toFixed(1).padStart(9)} | `
      + `${String(r.aliveAtEnd).padStart(12)} | ${String(r.playerOut ?? "-").padStart(13)}`);
  }
  console.log(`avg   | ${avg(rows.flatMap((r) => (r.firstElim === null ? [] : [r.firstElim]))).toFixed(1).padStart(14)} | `
    + `${avg(rows.map((r) => r.length)).toFixed(1).padStart(10)} |          | ${avg(rows.map((r) => r.selfFalls)).toFixed(1).padStart(10)} | `
    + `${Math.max(...rows.map((r) => r.maxSpeed)).toFixed(1).padStart(9)} |`);
  console.log("targets: first AI elim ~8 s; last-AI-standing 60–180 s; ≤ ~2 self-falls; speeds < 30 u/s caps");

  // Soft checks only (reported, never failing the run).
  for (const r of rows) {
    test.info().annotations.push({ type: "playtest", description: JSON.stringify(r) });
    if (r.maxSpeed >= 31) console.warn(`match ${r.match}: elimination speed ${r.maxSpeed} exceeds the 30 u/s caps`);
  }
  expectNoErrors(errors);
});
