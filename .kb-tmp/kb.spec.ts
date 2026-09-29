import { test } from "@playwright/test";
import { getCharacter, getObjects, getPlayer, openGame, parkAIFarAway, playerInput, startMatch, teleport, teleportObject, waitGrounded } from "../tests/helpers";

// Flat lane on the central platform: player at x=-12, pushing toward +X along z=0.
const EAST = Math.PI / 2;
async function setup(page: import("@playwright/test").Page) {
  await openGame(page);
  await startMatch(page, { freezeAI: true });
  await parkAIFarAway(page);
  const objs = await getObjects(page);
  for (let i = 0; i < objs.length; i++) await teleportObject(page, objs[i].index, -22 + (i % 3), 0.8, -4 + Math.floor(i / 3) * 1.6);
  await teleport(page, "PLAYER", -12, 1.2, 0);
  await playerInput(page, { aimYaw: EAST });
  await waitGrounded(page);
}
async function travel(page: import("@playwright/test").Page, x0: number) {
  return page.evaluate((x0) => new Promise<string>((resolve) => {
    let max = 0, peak = 0, alive = true;
    const start = performance.now();
    const tick = () => {
      const a = window.__MM_TEST__!.getCharacter("AI-01");
      if (a && a.alive && a.y > -1) { max = Math.max(max, a.x - x0); peak = Math.max(peak, Math.hypot(a.vx, a.vz)); }
      else alive = false;
      if (performance.now() - start < 3000) requestAnimationFrame(tick); else resolve(`${max.toFixed(2)} peak ${peak.toFixed(1)} u/s${alive ? "" : " (fell off)"} stab ${a?.stability}`);
    };
    requestAnimationFrame(tick);
  }), x0);
}

for (const d of [2, 4]) for (const run of [1, 2]) {
  test(`repulse d=${d} #${run}`, async ({ page }) => {
    await setup(page);
    await teleport(page, "AI-01", -12 + d, 1.2, 0);
    await waitGrounded(page, "AI-01");
    await page.waitForTimeout(300);
    const x0 = (await getCharacter(page, "AI-01"))!.x;
    await playerInput(page, { repulse: true });
    console.log(`RESULT repulse d=${d}: ${await travel(page, x0)}`);
  });
}
for (const run of [1, 2, 3]) {
  test(`crate throw #${run}`, async ({ page }) => {
    await setup(page);
    const crate = (await getObjects(page)).find((o) => o.kind === "crate")!.index;
    await teleportObject(page, crate, -9.5, 1.2, 0);
    await playerInput(page, { attract: true });
    for (let i = 0; i < 40 && (await getObjects(page)).find((o) => o.index === crate)!.heldBy !== "PLAYER"; i++) await page.waitForTimeout(50);
    await teleport(page, "AI-01", 1.5, 1.2, 0);
    await waitGrounded(page, "AI-01");
    const x0 = (await getCharacter(page, "AI-01"))!.x;
    await playerInput(page, { repulse: true });
    await page.waitForTimeout(50);
    await playerInput(page, { attract: false });
    console.log(`RESULT crate hit: ${await travel(page, x0)}`);
  });
}
