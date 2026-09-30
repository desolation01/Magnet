import { expect, test } from "@playwright/test";
import { expectNoErrors, getCharacters, openGame, startMatch, stats, trackErrors, type CharacterSnapshot } from "./helpers";

interface Dump {
  time: number;
  eliminations: { name: string; time: number; by: string | null }[];
  ai: { name: string; personality: string; alive: boolean; behavior: string; zone: string; target: string | null }[];
}

test("10 AI move, target, attract and repulse on their own (§16–§22, §45)", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  // `noend` keeps the match running even if the (idle) player gets knocked off.
  await openGame(page, "noend");
  await startMatch(page, { difficulty: "NORMAL" });

  const start = new Map((await getCharacters(page)).map((c) => [c.name, c]));
  const aiNames = [...start.keys()].filter((n) => n !== "PLAYER");
  expect(aiNames).toHaveLength(10);

  // Track how far each AI gets from its spawn, which behaviors and targets show up, and the FPS.
  const maxTravel = new Map<string, number>(aiNames.map((n) => [n, 0]));
  const behaviors = new Set<string>();
  const targeted = new Set<string>();
  const fps: number[] = [];
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    const now: CharacterSnapshot[] = await getCharacters(page);
    for (const c of now) {
      const s = start.get(c.name);
      if (!s || c.name === "PLAYER") continue;
      maxTravel.set(c.name, Math.max(maxTravel.get(c.name)!, Math.hypot(c.x - s.x, c.z - s.z)));
    }
    const dump = (await page.evaluate(() => window.__MM_DUMP__())) as Dump;
    for (const a of dump.ai) {
      if (!a.alive) continue;
      behaviors.add(a.behavior);
      if (a.target) targeted.add(`${a.name}->${a.target}`);
    }
    fps.push(await page.evaluate(() => window.__MM_DEBUG__.fps));
  }

  const s = await stats(page);
  const dump = (await page.evaluate(() => window.__MM_DUMP__())) as Dump;
  const aiStats = aiNames.map((n) => ({ name: n, ...(s[n] ?? { attractStarts: 0, attractSeconds: 0, repulses: 0 }) }));
  const avgFps = fps.reduce((a, b) => a + b, 0) / fps.length;
  console.log("travel", JSON.stringify(Object.fromEntries([...maxTravel].map(([k, v]) => [k, +v.toFixed(1)]))));
  console.log("magnet", JSON.stringify(aiStats.map((a) => `${a.name}:A${a.attractStarts}/R${a.repulses}`)));
  console.log("behaviors", [...behaviors].join(","), "| distinct target pairs", targeted.size);
  console.log("eliminations", JSON.stringify(dump.eliminations));
  console.log(`fps avg ${avgFps.toFixed(0)} min ${Math.min(...fps)}`);

  // Every AI moves (eliminated ones count if they moved before falling).
  for (const [name, d] of maxTravel) expect(d, `${name} never moved more than 2 units`).toBeGreaterThan(2);
  // AI use both magnet abilities.
  expect(aiStats.filter((a) => a.attractStarts > 0).length, "AIs that used attract").toBeGreaterThanOrEqual(1);
  expect(aiStats.filter((a) => a.repulses > 0).length, "AIs that used repulse").toBeGreaterThanOrEqual(1);
  // AI pick targets and do more than one thing.
  expect(targeted.size).toBeGreaterThan(0);
  expect(behaviors.size).toBeGreaterThanOrEqual(2);
  // Not everyone walks off the map within 20 s (§ Phase 8 acceptance).
  const selfFalls = dump.eliminations.filter((e) => e.name !== "PLAYER" && e.by === null).length;
  expect(selfFalls, "AIs that fell without being hit").toBeLessThanOrEqual(5);
  expect(dump.ai.filter((a) => a.alive).length).toBeGreaterThanOrEqual(2);
  expectNoErrors(errors);
});
