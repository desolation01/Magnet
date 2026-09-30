import { DEFAULT_DIFFICULTY, type Difficulty } from "../config";
import { el, show } from "./dom";

/** Title, difficulty selector and PLAY button (AGENTS.md §34). */
export class MainMenu {
  private readonly root = el("menu");
  private readonly buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>("button.diff"));
  difficulty: Difficulty = DEFAULT_DIFFICULTY;

  constructor(onPlay: (difficulty: Difficulty) => void) {
    for (const b of this.buttons) {
      b.addEventListener("click", () => this.select(b.dataset.difficulty as Difficulty));
    }
    el("btn-play").addEventListener("click", () => onPlay(this.difficulty));
    this.select(this.difficulty);
  }

  private select(d: Difficulty): void {
    this.difficulty = d;
    for (const b of this.buttons) b.classList.toggle("selected", b.dataset.difficulty === d);
  }

  setVisible(visible: boolean): void {
    show(this.root, visible);
  }
}
