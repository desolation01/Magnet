import { COUNTDOWN } from "../config";
import { el, show } from "./dom";
import { formatTime } from "./HUD";

/** Countdown text and the GAME OVER / YOU WIN screens (AGENTS.md §3, §35). */
export class Screens {
  private readonly countdown = el("countdown");
  private readonly end = el("endscreen");
  private readonly title = el("end-title");
  private readonly line1 = el("end-line1");
  private readonly line2 = el("end-line2");
  private readonly restart = el<HTMLButtonElement>("btn-restart");
  private lastCountdown = "";

  constructor(onRestart: () => void, onMenu: () => void) {
    this.restart.addEventListener("click", onRestart);
    el("btn-menu").addEventListener("click", onMenu);
  }

  /** Shows 3 / 2 / 1 / GO! for the elapsed countdown time. Returns the label shown. */
  setCountdown(elapsed: number): string {
    const step = COUNTDOWN.stepSeconds;
    let text = "";
    if (elapsed < step) text = "3";
    else if (elapsed < step * 2) text = "2";
    else if (elapsed < step * 3) text = "1";
    else if (elapsed < step * 3 + COUNTDOWN.goSeconds) text = "GO!";
    if (text !== this.lastCountdown) {
      this.lastCountdown = text;
      this.countdown.textContent = text;
      show(this.countdown, text !== "");
      this.countdown.classList.remove("pop");
      void this.countdown.offsetWidth;
      if (text) this.countdown.classList.add("pop");
    }
    return text;
  }

  hideCountdown(): void {
    this.lastCountdown = "";
    show(this.countdown, false);
  }

  showGameOver(opponentsRemaining: number): void {
    this.title.textContent = "GAME OVER";
    this.title.className = "title lose";
    this.line1.textContent = `Opponents Remaining: ${opponentsRemaining}`;
    this.line2.textContent = "";
    this.restart.textContent = "RESTART";
    show(this.end, true);
  }

  showVictory(eliminated: number, time: number): void {
    this.title.textContent = "YOU WIN!";
    this.title.className = "title win";
    this.line1.textContent = `Opponents Eliminated: ${eliminated}`;
    this.line2.textContent = `Time: ${formatTime(time)}`;
    this.restart.textContent = "PLAY AGAIN";
    show(this.end, true);
  }

  hideEnd(): void {
    show(this.end, false);
  }
}
