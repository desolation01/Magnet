import type { Character } from "../character/Character";
import { REPULSE } from "../config";
import { el, show } from "./dom";

/** HTML HUD (AGENTS.md §26–27). Only writes to the DOM when a displayed value changes. */
export class HUD {
  private readonly root = el("hud");
  private readonly stability = el("bar-stability");
  private readonly power = el("bar-power");
  private readonly opponents = el("opponents-left");
  private readonly time = el("match-time");
  private readonly repulsePanel = el("hud-repulse");
  private readonly repulseStatus = el("repulse-status");
  private readonly lockHint = el("lock-hint");

  private last = { stability: -1, power: -1, opponents: -1, time: "", repulse: "", ready: true };

  setVisible(visible: boolean): void {
    show(this.root, visible);
  }

  setLockHint(visible: boolean): void {
    show(this.lockHint, visible);
  }

  reset(): void {
    this.last = { stability: -1, power: -1, opponents: -1, time: "", repulse: "", ready: true };
  }

  update(player: Character, opponentsLeft: number, matchTime: number): void {
    const stab = Math.round(player.stability);
    if (stab !== this.last.stability) {
      this.last.stability = stab;
      this.stability.style.width = `${stab}%`;
    }
    const pow = Math.round(player.power);
    if (pow !== this.last.power) {
      this.last.power = pow;
      this.power.style.width = `${pow}%`;
    }
    if (opponentsLeft !== this.last.opponents) {
      this.last.opponents = opponentsLeft;
      this.opponents.textContent = String(opponentsLeft);
    }
    const t = formatTime(matchTime);
    if (t !== this.last.time) {
      this.last.time = t;
      this.time.textContent = t;
    }

    const ready = player.repulseCooldown <= 0;
    // Round up so the last frames read 0.1s, never 0.0s.
    const text = ready ? "READY" : `${(Math.ceil(Math.min(REPULSE.cooldown, player.repulseCooldown) * 10) / 10).toFixed(1)}s`;
    if (text !== this.last.repulse) {
      this.last.repulse = text;
      this.repulseStatus.textContent = text;
    }
    if (ready !== this.last.ready) {
      this.last.ready = ready;
      this.repulsePanel.classList.toggle("cooling", !ready);
      this.repulsePanel.classList.toggle("ready", ready);
      if (ready) {
        this.repulsePanel.classList.remove("pulse");
        void this.repulsePanel.offsetWidth; // restart the animation
        this.repulsePanel.classList.add("pulse");
      }
    }
  }
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
