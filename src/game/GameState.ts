/** Game states (AGENTS.md §34). */
export type GameState = "MENU" | "COUNTDOWN" | "PLAYING" | "PLAYER_ELIMINATED" | "VICTORY";

export class GameStateMachine {
  private current: GameState = "MENU";
  private readonly listeners: ((next: GameState, prev: GameState) => void)[] = [];

  get state(): GameState {
    return this.current;
  }

  onChange(fn: (next: GameState, prev: GameState) => void): void {
    this.listeners.push(fn);
  }

  set(next: GameState): void {
    const prev = this.current;
    if (prev === next) return;
    this.current = next;
    for (const fn of this.listeners) fn(next, prev);
  }

  is(...states: GameState[]): boolean {
    return states.includes(this.current);
  }
}
