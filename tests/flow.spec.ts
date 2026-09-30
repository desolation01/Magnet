import { expect, test } from "@playwright/test";
import {
  eliminate,
  eliminateAllAI,
  expectNoErrors,
  freezeAI,
  getCharacters,
  getPlayer,
  openGame,
  playerInput,
  startMatch,
  state,
  trackErrors,
  waitState,
} from "./helpers";

test.describe("match flow (§3, §34, §35, §37, §38)", () => {
  test("menu → countdown 3-2-1-GO! with input disabled → PLAYING", async ({ page }) => {
    const errors = trackErrors(page);
    await openGame(page);
    expect(await state(page)).toBe("MENU");
    await expect(page.locator("#hud")).toHaveClass(/hidden/);

    // Record every countdown label shown.
    await page.evaluate(() => {
      const node = document.getElementById("countdown")!;
      const seen: string[] = [];
      (window as unknown as { __countdownSeen: string[] }).__countdownSeen = seen;
      new MutationObserver(() => {
        const t = node.textContent ?? "";
        if (t && seen[seen.length - 1] !== t) seen.push(t);
      }).observe(node, { childList: true, characterData: true, subtree: true });
    });

    await page.locator("#btn-play").click();
    await waitState(page, "COUNTDOWN", 5_000);
    await expect(page.locator("#menu")).toBeHidden();
    await expect(page.locator("#hud")).not.toHaveClass(/hidden/);
    await expect(page.locator("#opponents-left")).toHaveText("10");
    expect(await page.evaluate(() => window.__MM_DEBUG__.aliveCount)).toBe(11);

    // Try to act during the countdown: move, sprint, jump, attract, repulse.
    await page.waitForTimeout(300); // let characters settle onto the platform
    const p0 = await getPlayer(page);
    const ai0 = (await getCharacters(page)).filter((c) => c.name !== "PLAYER");
    expect(ai0).toHaveLength(10);
    await playerInput(page, { moveDir: { x: 1, z: 0 }, sprint: true, attract: true, jump: true, repulse: true });
    await page.waitForTimeout(800);
    await playerInput(page, { jump: true, repulse: true });
    await page.waitForTimeout(400);
    expect(await state(page)).toBe("COUNTDOWN");
    const p1 = await getPlayer(page);
    expect(p1.controlEnabled).toBe(false);
    expect(Math.hypot(p1.x - p0.x, p1.z - p0.z), "player must not move during countdown").toBeLessThan(0.2);
    expect(p1.y - p0.y, "player must not jump during countdown").toBeLessThan(0.2);
    expect(p1.attracting).toBe(false);
    expect(p1.repulseCooldown).toBe(0);
    expect(p1.power).toBe(100);
    await expect(page.locator("#repulse-status")).toHaveText("READY");
    await expect(page.locator("#match-time")).toHaveText("00:00");
    // AI do not act during the countdown either.
    const ai1 = (await getCharacters(page)).filter((c) => c.name !== "PLAYER");
    for (const a of ai1) {
      const b = ai0.find((x) => x.name === a.name)!;
      expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.name} moved during countdown`).toBeLessThan(0.3);
      expect(a.controlEnabled).toBe(false);
    }

    await waitState(page, "PLAYING", 5_000);
    const seen = await page.evaluate(() => (window as unknown as { __countdownSeen: string[] }).__countdownSeen);
    expect(seen).toEqual(["3", "2", "1", "GO!"]);
    // GO! disappears shortly after.
    await expect(page.locator("#countdown")).toBeHidden({ timeout: 3_000 });

    // Once PLAYING, the still-held move input takes effect and the timer runs.
    await expect.poll(async () => (await getPlayer(page)).x - p1.x, { timeout: 5_000 }).toBeGreaterThan(1);
    await expect(page.locator("#match-time")).not.toHaveText("00:00", { timeout: 3_000 });
    expectNoErrors(errors);
  });

  test("difficulty selection sticks across matches", async ({ page }) => {
    const errors = trackErrors(page);
    await openGame(page);
    const selected = page.locator("#menu button.diff.selected");
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute("data-difficulty", "NORMAL"); // §21 default

    await page.locator('#menu button.diff[data-difficulty="HARD"]').click();
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute("data-difficulty", "HARD");
    await startMatch(page, { freezeAI: true });
    expect(await page.evaluate(() => window.__MM_TEST__!.difficulty())).toBe("HARD");

    // Back to the menu through the end screen; HARD must still be selected and used.
    await eliminate(page, "PLAYER");
    await waitState(page, "PLAYER_ELIMINATED");
    await page.locator("#btn-menu").click();
    await waitState(page, "MENU");
    await expect(selected).toHaveAttribute("data-difficulty", "HARD");
    await startMatch(page, { freezeAI: true });
    expect(await page.evaluate(() => window.__MM_TEST__!.difficulty())).toBe("HARD");

    // RESTART keeps the difficulty too.
    await eliminate(page, "PLAYER");
    await waitState(page, "PLAYER_ELIMINATED");
    await page.locator("#btn-restart").click();
    await waitState(page, "PLAYING");
    expect(await page.evaluate(() => window.__MM_TEST__!.difficulty())).toBe("HARD");

    // And EASY can be picked afterwards.
    await eliminate(page, "PLAYER");
    await waitState(page, "PLAYER_ELIMINATED");
    await page.locator("#btn-menu").click();
    await startMatch(page, { difficulty: "EASY", freezeAI: true });
    expect(await page.evaluate(() => window.__MM_TEST__!.difficulty())).toBe("EASY");
    expectNoErrors(errors);
  });

  test("player elimination → GAME OVER → RESTART without reload", async ({ page }) => {
    const errors = trackErrors(page);
    await openGame(page);
    await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 42));
    await startMatch(page, { freezeAI: true });

    await eliminate(page, "AI-02");
    await expect(page.locator("#opponents-left")).toHaveText("9");
    await eliminate(page, "PLAYER");
    await waitState(page, "PLAYER_ELIMINATED");
    await expect(page.locator("#endscreen")).toBeVisible();
    await expect(page.locator("#end-title")).toHaveText("GAME OVER");
    await expect(page.locator("#end-line1")).toHaveText("Opponents Remaining: 9");
    await expect(page.locator("#btn-restart")).toHaveText("RESTART");
    await expect(page.locator("#hud")).toHaveClass(/hidden/);

    await page.locator("#btn-restart").click();
    await waitState(page, "COUNTDOWN", 5_000);
    await expect(page.locator("#endscreen")).toBeHidden();
    await expect(page.locator("#opponents-left")).toHaveText("10");
    await expect(page.locator("#repulse-status")).toHaveText("READY");
    await expect(page.locator("#match-time")).toHaveText("00:00");
    expect(await page.evaluate(() => window.__MM_DEBUG__.aliveCount)).toBe(11);
    const names = await page.evaluate(() => window.__MM_TEST__!.names().sort());
    expect(names).toEqual(["AI-01", "AI-02", "AI-03", "AI-04", "AI-05", "AI-06", "AI-07", "AI-08", "AI-09", "AI-10", "PLAYER"]);
    const p = await getPlayer(page);
    expect(p.alive).toBe(true);
    expect(p.power).toBe(100);
    expect(p.stability).toBe(100);
    await waitState(page, "PLAYING");
    // Same page: no reload happened.
    expect(await page.evaluate(() => (window as unknown as { __marker: number }).__marker)).toBe(42);
    expectNoErrors(errors);
  });

  test("eliminating all AI → YOU WIN → PLAY AGAIN, then MENU", async ({ page }) => {
    const errors = trackErrors(page);
    await openGame(page);
    await startMatch(page, { freezeAI: true });

    expect(await eliminateAllAI(page)).toBe(10);
    await waitState(page, "VICTORY");
    await expect(page.locator("#end-title")).toHaveText("YOU WIN!");
    await expect(page.locator("#end-line1")).toHaveText("Opponents Eliminated: 10");
    await expect(page.locator("#btn-restart")).toHaveText("PLAY AGAIN");
    expect((await getPlayer(page)).alive).toBe(true);

    await page.locator("#btn-restart").click();
    await waitState(page, "COUNTDOWN", 5_000);
    await expect(page.locator("#endscreen")).toBeHidden();
    await expect(page.locator("#opponents-left")).toHaveText("10");
    await waitState(page, "PLAYING");
    await freezeAI(page, true);

    await eliminateAllAI(page);
    await waitState(page, "VICTORY");
    await page.locator("#btn-menu").click();
    await waitState(page, "MENU");
    await expect(page.locator("#menu")).toBeVisible();
    await expect(page.locator("#endscreen")).toBeHidden();
    await expect(page.locator("#hud")).toHaveClass(/hidden/);
    await expect.poll(() => page.evaluate(() => window.__MM_TEST__!.names().length)).toBe(0);

    await startMatch(page, { freezeAI: true });
    expect(await page.evaluate(() => window.__MM_DEBUG__.aliveCount)).toBe(11);
    expectNoErrors(errors);
  });
});
