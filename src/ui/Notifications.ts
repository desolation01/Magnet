import { ELIMINATION } from "../config";
import { el } from "./dom";

/** Elimination notification feed (AGENTS.md §29). */
export class Notifications {
  private readonly root = el("notifications");
  private readonly items: { node: HTMLElement; time: number }[] = [];

  push(text: string, isPlayer = false): void {
    const node = document.createElement("div");
    node.className = isPlayer ? "notification player" : "notification";
    node.textContent = text;
    this.root.appendChild(node);
    this.items.push({ node, time: ELIMINATION.notificationSeconds });
    while (this.items.length > ELIMINATION.maxNotifications) this.items.shift()!.node.remove();
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.time -= dt;
      if (it.time <= 0) {
        it.node.remove();
        this.items.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const it of this.items) it.node.remove();
    this.items.length = 0;
  }
}
