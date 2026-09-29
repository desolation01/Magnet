import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AIController } from "../ai/AIController";
import type { AIWorld } from "../ai/AITargeting";
import { Character } from "../character/Character";
import { AI_ROSTER, COLORS, DIFFICULTY, ELIMINATION, PARTICLES, PERSONALITIES, SPAWN, WORLD, type Difficulty } from "../config";
import { yawOf } from "../util/math";
import type { Rng } from "../util/rng";

export interface MatchEvents {
  onEliminated(c: Character): void;
}

interface EffectsLike {
  burst(position: Vector3, color: Color4, count: number, power: number): void;
}

/** Spawning, alive tracking, elimination and reset (AGENTS.md §29, §36–38). */
export class MatchManager {
  readonly characters: Character[] = [];
  readonly controllers: AIController[] = [];
  player: Character | null = null;
  private readonly pendingDispose: { c: Character; time: number }[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly shadows: ShadowGenerator,
    private readonly rng: Rng,
    private readonly effects: EffectsLike,
    private readonly events: MatchEvents,
  ) {}

  get aliveCount(): number {
    let n = 0;
    for (const c of this.characters) if (c.alive) n++;
    return n;
  }

  get aiAlive(): number {
    let n = 0;
    for (const c of this.characters) if (c.alive && !c.isPlayer) n++;
    return n;
  }

  /** Disposes everything from the previous match. */
  clear(): void {
    for (const c of this.characters) c.dispose();
    for (const p of this.pendingDispose) if (!this.characters.includes(p.c)) p.c.dispose();
    this.characters.length = 0;
    this.controllers.length = 0;
    this.pendingDispose.length = 0;
    this.player = null;
  }

  /** Creates the player and 10 AI at their spawns (AI spawns shuffled). */
  spawn(difficulty: Difficulty, world: AIWorld): void {
    this.clear();
    const points = SPAWN.points;
    const aiSpawns = this.rng.shuffle(points.slice(1));

    const makeChar = (id: number, name: string, isPlayer: boolean, color: string, x: number, z: number): Character => {
      const c = new Character(this.scene, this.shadows, {
        id, name, isPlayer, color,
        position: new Vector3(x, SPAWN.height, z),
        yaw: yawOf(-x, -z),
      });
      this.characters.push(c);
      return c;
    };

    const [px, pz] = points[0];
    this.player = makeChar(0, "PLAYER", true, COLORS.player, px, pz);

    const diff = DIFFICULTY[difficulty];
    AI_ROSTER.forEach((personalityName, i) => {
      const [x, z] = aiSpawns[i];
      const name = `AI-${String(i + 1).padStart(2, "0")}`;
      const c = makeChar(i + 1, name, false, COLORS.ai[i % COLORS.ai.length], x, z);
      this.controllers.push(new AIController(c, PERSONALITIES[personalityName], diff, world));
    });
  }

  setControlEnabled(enabled: boolean): void {
    for (const c of this.characters) c.controlEnabled = enabled && c.alive;
  }

  /** Eliminates characters below the elimination plane and disposes them after a delay. */
  update(dt: number): void {
    for (const c of this.characters) {
      if (c.alive && c.position.y < WORLD.eliminationY) this.eliminate(c);
    }
    for (let i = this.pendingDispose.length - 1; i >= 0; i--) {
      const p = this.pendingDispose[i];
      p.time -= dt;
      if (p.time <= 0) {
        this.pendingDispose.splice(i, 1);
        const idx = this.characters.indexOf(p.c);
        if (idx >= 0) this.characters.splice(idx, 1);
        const ci = this.controllers.findIndex((ctrl) => ctrl.self === p.c);
        if (ci >= 0) this.controllers.splice(ci, 1);
        p.c.dispose();
      }
    }
  }

  private eliminate(c: Character): void {
    c.alive = false;
    c.controlEnabled = false;
    c.attracting = false;
    const color = Color4.FromHexString(`${c.isPlayer ? COLORS.player : c.color}ff`);
    this.effects.burst(c.position, color, PARTICLES.eliminationMax, 8);
    this.pendingDispose.push({ c, time: ELIMINATION.disposeDelay });
    this.events.onEliminated(c);
  }
}
