import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Arena } from "../arena/Arena";
import type { ArenaObjects } from "../arena/ArenaObjects";
import type { Character, CharacterInput } from "../character/Character";
import type { Difficulty } from "../config";
import type { PlayerController } from "../player/PlayerController";
import type { GameState } from "./GameState";
import type { MatchManager } from "./MatchManager";

/**
 * TEST-ONLY hooks for automated Playwright specs. Installed only when the URL contains `?test`,
 * so normal play is unaffected. Everything goes through the real game paths: player input is
 * written into CharacterInput after the keyboard/mouse controller, and elimination is triggered
 * by teleporting below the elimination plane (MatchManager does the rest).
 */

export interface CharacterSnapshot {
  name: string;
  alive: boolean;
  grounded: boolean;
  controlEnabled: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  stability: number;
  power: number;
  repulseCooldown: number;
  attracting: boolean;
  aimYaw: number;
  /** Name of the character holding this one with attract, if any. */
  heldBy: string | null;
  /** Being dragged by someone's attract this frame (not yet held). */
  pulled: boolean;
}

export interface ObjectSnapshot {
  index: number;
  kind: string;
  alive: boolean;
  heldBy: string | null;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

/** Serializable subset of CharacterInput. `jump` and `repulse` are one-shot requests. */
export interface TestInput {
  moveDir?: { x: number; z: number } | null;
  sprint?: boolean;
  attract?: boolean;
  aimYaw?: number | null;
  jump?: boolean;
  repulse?: boolean;
}

export interface MagnetStats {
  /** Number of false→true transitions of `attracting`. */
  attractStarts: number;
  /** Seconds spent attracting. */
  attractSeconds: number;
  /** Number of repulses fired (detected via the cooldown being reset). */
  repulses: number;
}

/** Scene resource counts used by the leak test. */
export interface ResourceCounts {
  meshes: number;
  transformNodes: number;
  materials: number;
  textures: number;
  geometries: number;
  particleSystems: number;
  bodies: number;
  beforeRenderObservers: number;
  beforeAnimationObservers: number;
  afterRenderObservers: number;
  domElements: number;
}

export interface TestApi {
  state(): GameState;
  difficulty(): Difficulty;
  names(): string[];
  getPlayer(): CharacterSnapshot | null;
  getCharacter(name: string): CharacterSnapshot | null;
  getCharacters(): CharacterSnapshot[];
  getObjects(): ObjectSnapshot[];
  /** Merges into the persistent player input override. */
  playerInput(input: TestInput): void;
  clearInput(): void;
  teleport(name: string, x: number, y: number, z: number): boolean;
  teleportObject(index: number, x: number, y: number, z: number): boolean;
  /** Drops the character below the elimination plane (y = −10). */
  eliminate(name: string): boolean;
  eliminateAllAI(): number;
  /** Freezes every AI controller (AI keep physics but receive no input). */
  freezeAI(frozen: boolean): void;
  /** Per-character magnet usage counters for the current match. */
  stats(): Record<string, MagnetStats>;
  counts(): ResourceCounts;
  /** Scene particle systems with their render readiness (a disposed texture makes them not ready). */
  particleSystems(): { name: string; started: boolean; ready: boolean }[];
}

declare global {
  interface Window {
    __MM_TEST__?: TestApi;
  }
}

export interface DebugContext {
  scene: Scene;
  arena: Arena;
  match: MatchManager;
  objects: ArenaObjects;
  controller: PlayerController;
  getState(): GameState;
  getDifficulty(): Difficulty;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

export function installDebugHooks(ctx: DebugContext): void {
  if (!new URLSearchParams(location.search).has("test")) return;
  const { scene, match, objects, controller } = ctx;

  // ---- player input override (applied right after the real controller writes its input)
  const override: TestInput = {};
  let jumpOnce = false;
  let repulseOnce = false;
  const apply = (input: CharacterInput): void => {
    if (override.moveDir) input.moveDir.set(override.moveDir.x, 0, override.moveDir.z);
    if (override.sprint !== undefined) input.sprint = override.sprint;
    if (override.attract !== undefined) input.attract = override.attract;
    if (override.aimYaw !== undefined && override.aimYaw !== null) input.aimYaw = override.aimYaw;
    if (jumpOnce) input.jump = true;
    if (repulseOnce) input.repulse = true;
    jumpOnce = false;
    repulseOnce = false;
  };
  const realApply = controller.apply.bind(controller);
  controller.apply = (c: Character): void => {
    realApply(c);
    apply(c.input);
  };

  // ---- teleports: enable the pre-step for one physics step so Havok copies the mesh transform
  const teleported = new Set<Character["body"]>();
  scene.onAfterPhysicsObservable.add(() => {
    for (const b of teleported) b.disablePreStep = true;
    teleported.clear();
  });
  const teleportBody = (mesh: Character["mesh"], body: Character["body"], x: number, y: number, z: number): void => {
    mesh.position.set(x, y, z);
    body.disablePreStep = false;
    body.setLinearVelocity(Vector3.Zero());
    body.setAngularVelocity(Vector3.Zero());
    teleported.add(body);
  };

  const find = (name: string): Character | undefined => match.characters.find((c) => c.name === name);

  const snap = (c: Character): CharacterSnapshot => {
    const v = c.body.getLinearVelocity();
    return {
      name: c.name, alive: c.alive, grounded: c.grounded, controlEnabled: c.controlEnabled,
      x: r2(c.position.x), y: r2(c.position.y), z: r2(c.position.z),
      vx: r2(v.x), vy: r2(v.y), vz: r2(v.z),
      stability: r2(c.stability), power: r2(c.power), repulseCooldown: r2(c.repulseCooldown),
      attracting: c.attracting, aimYaw: r2(c.input.aimYaw), heldBy: c.heldBy?.name ?? null,
      pulled: c.pulled,
    };
  };

  // ---- AI freeze: runs before the game update so AIController sees controlEnabled = false
  let frozen = false;
  scene.onBeforeAnimationsObservable.add(() => {
    if (!frozen) return;
    for (const c of match.characters) if (!c.isPlayer) c.controlEnabled = false;
  }, undefined, true);

  // ---- magnet usage counters (polled after the game update)
  const stats = new Map<string, MagnetStats>();
  const prev = new Map<string, { attracting: boolean; cooldown: number }>();
  let statsPlayer: Character | null = null;
  scene.onBeforeRenderObservable.add(() => {
    if (match.player !== statsPlayer) {
      statsPlayer = match.player;
      stats.clear();
      prev.clear();
    }
    const dt = scene.getEngine().getDeltaTime() / 1000;
    for (const c of match.characters) {
      if (!c.alive) continue;
      let s = stats.get(c.name);
      if (!s) stats.set(c.name, (s = { attractStarts: 0, attractSeconds: 0, repulses: 0 }));
      const p = prev.get(c.name) ?? { attracting: false, cooldown: 0 };
      if (c.attracting && !p.attracting) s.attractStarts++;
      if (c.attracting) s.attractSeconds += dt;
      if (c.repulseCooldown > p.cooldown + 0.01) s.repulses++;
      p.attracting = c.attracting;
      p.cooldown = c.repulseCooldown;
      prev.set(c.name, p);
    }
  });

  const api: TestApi = {
    state: () => ctx.getState(),
    difficulty: () => ctx.getDifficulty(),
    names: () => match.characters.map((c) => c.name),
    getPlayer: () => (match.player ? snap(match.player) : null),
    getCharacter: (name) => {
      const c = find(name);
      return c ? snap(c) : null;
    },
    getCharacters: () => match.characters.map(snap),
    getObjects: () =>
      objects.objects.map((o) => {
        const v = o.body.getLinearVelocity();
        return {
          index: o.spawnIndex, kind: o.kind, alive: o.alive, heldBy: o.heldBy?.name ?? null,
          x: r2(o.position.x), y: r2(o.position.y), z: r2(o.position.z),
          vx: r2(v.x), vy: r2(v.y), vz: r2(v.z),
        };
      }),
    playerInput: (input) => {
      const { jump, repulse, ...rest } = input;
      Object.assign(override, rest);
      if (jump) jumpOnce = true;
      if (repulse) repulseOnce = true;
    },
    clearInput: () => {
      for (const k of Object.keys(override)) delete override[k as keyof TestInput];
      jumpOnce = false;
      repulseOnce = false;
    },
    teleport: (name, x, y, z) => {
      const c = find(name);
      if (!c || !c.alive) return false;
      teleportBody(c.mesh, c.body, x, y, z);
      return true;
    },
    teleportObject: (index, x, y, z) => {
      const o = objects.objects.find((obj) => obj.spawnIndex === index);
      if (!o || !o.alive) return false;
      teleportBody(o.mesh, o.body, x, y, z);
      return true;
    },
    eliminate: (name) => {
      const c = find(name);
      if (!c || !c.alive) return false;
      teleportBody(c.mesh, c.body, c.position.x, -20, c.position.z);
      return true;
    },
    eliminateAllAI: () => {
      let n = 0;
      for (const c of match.characters) {
        if (c.isPlayer || !c.alive) continue;
        teleportBody(c.mesh, c.body, c.position.x, -20, c.position.z);
        n++;
      }
      return n;
    },
    freezeAI: (value) => {
      frozen = value;
      if (!value) {
        const playing = ctx.getState() === "PLAYING";
        for (const c of match.characters) if (!c.isPlayer) c.controlEnabled = playing && c.alive;
      }
    },
    stats: () => Object.fromEntries(stats),
    particleSystems: () =>
      scene.particleSystems.map((ps) => ({ name: ps.name, started: ps.isStarted(), ready: ps.isReady() })),
    counts: () => {
      const physics = scene.getPhysicsEngine() as unknown as { getBodies?: () => unknown[] } | null;
      return {
        meshes: scene.meshes.length,
        transformNodes: scene.transformNodes.length,
        materials: scene.materials.length,
        textures: scene.textures.length,
        geometries: scene.geometries.length,
        particleSystems: scene.particleSystems.length,
        bodies: physics?.getBodies?.().length ?? 0,
        beforeRenderObservers: scene.onBeforeRenderObservable.observers.length,
        beforeAnimationObservers: scene.onBeforeAnimationsObservable.observers.length,
        afterRenderObservers: scene.onAfterRenderObservable.observers.length,
        domElements: document.getElementsByTagName("*").length,
      };
    },
  };
  window.__MM_TEST__ = api;
}
