import { expect, test, type Page } from "@playwright/test";
import type { ResourceCounts } from "../src/game/DebugHooks";
import {
  eliminate,
  eliminateAllAI,
  expectNoErrors,
  freezeAI,
  openGame,
  startMatch,
  teleport,
  teleportObject,
  trackErrors,
  waitState,
} from "./helpers";

type Counts = ResourceCounts & { nameplates: number; notifications: number };

async function snapshot(page: Page): Promise<Counts> {
  return page.evaluate(() => ({
    ...window.__MM_TEST__!.counts(),
    nameplates: window.__MM_DEBUG__.nameplates,
    notifications: document.querySelectorAll("#notifications .notification").length,
  }));
}

/** Measures once the match is PLAYING and quiet (AI frozen, countdown text gone). */
async function measure(page: Page): Promise<Counts> {
  await waitState(page, "PLAYING");
  await freezeAI(page, true);
  await expect(page.locator("#countdown")).toBeHidden({ timeout: 3_000 });
  await page.waitForTimeout(300);
  return snapshot(page);
}

/** Plays a busy match: eliminations, a thrown-off object, a repulse burst, then ends it. */
async function churn(page: Page): Promise<void> {
  await freezeAI(page, false);
  await page.waitForTimeout(1_500); // let the AI fight a little (particles, sounds, holds)
  await freezeAI(page, true);
  await eliminate(page, "AI-01");
  await teleport(page, "AI-02", 40, 3, 0);
  await teleportObject(page, 0, 0, 3, 40); // the big block falls; a respawn timer is pending
  await page.evaluate(() => window.__MM_TEST__!.playerInput({ repulse: true }));
  await page.waitForTimeout(1_500);
}

test("restarting 5 times returns resource counts to the first-match baseline (§32, §38)", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await openGame(page);
  await startMatch(page, { freezeAI: true });
  const baseline = await measure(page);
  console.log("baseline", JSON.stringify(baseline));

  const history: Counts[] = [];
  for (let i = 0; i < 5; i++) {
    await churn(page);
    // Alternate between the three ways out of a match.
    if (i % 3 === 0) {
      await eliminate(page, "PLAYER");
      await waitState(page, "PLAYER_ELIMINATED");
      await page.locator("#btn-restart").click();
    } else if (i % 3 === 1) {
      await eliminateAllAI(page);
      await waitState(page, "VICTORY");
      await page.locator("#btn-restart").click(); // PLAY AGAIN
    } else {
      await eliminate(page, "PLAYER");
      await waitState(page, "PLAYER_ELIMINATED");
      await page.locator("#btn-menu").click();
      await waitState(page, "MENU");
      await page.locator("#btn-play").click();
    }
    const c = await measure(page);
    history.push(c);
    console.log(`restart ${i + 1}`, JSON.stringify(c));
  }

  // Exact equality: every per-match resource is disposed on reset. The countdown pop / burst
  // particle systems are disposed with the match, so no tolerance is needed.
  for (const [i, c] of history.entries()) {
    expect(c, `resource counts after restart ${i + 1}`).toEqual(baseline);
  }
  expectNoErrors(errors);
});
