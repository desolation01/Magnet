import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Arena } from "../arena/Arena";
import { BOXES, CYLINDERS, RAMPS } from "../arena/ArenaLayout";
import { OBJECT_SPAWNS, type ArenaObjects } from "../arena/ArenaObjects";
import type { Character, CharacterInput } from "../character/Character";
import { ARENA, SPAWN, type Difficulty } from "../config";
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
  /** Seconds of ragdoll left (0 = not ragdolled). */
  ragdoll: number;
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

/** Serializable footprint of a base platform or walkway (see Arena.Platform). */
export interface PlatformSnapshot {
  name: string;
  kind: string;
  shape: "circle" | "rect";
  cx: number;
  cz: number;
  radius: number;
  hx: number;
  hz: number;
  axisX: number;
  axisZ: number;
  halfLen: number;
  halfWidth: number;
  ends: [string, string] | null;
}

/** Axis-aligned rect (hx, hz half extents) or circle (radius hx) footprint on the XZ plane. */
export interface FootprintSnapshot {
  name?: string;
  x: number;
  z: number;
  hx: number;
  hz: number;
  circle: boolean;
}

export interface ArenaSnapshot {
  /** Base platforms first (routing nodes), then walkways. */
  platforms: PlatformSnapshot[];
  /** Footprints the AI avoids (Arena.obstacles). */
  obstacles: FootprintSnapshot[];
  /** Every static collider standing on the platforms (blocks, walls, pillars, ramps) from ArenaLayout. */
  colliders: FootprintSnapshot[];
  spawns: [number, number][];
  objectSpawns: { kind: string; x: number; z: number }[];
}

export interface EdgeSnapshot {
  platform: string | null;
  kind: string | null;
  distance: number;
}

export interface RouteResult {
  /** Waypoints returned by successive Arena.nextWaypoint calls, starting from the from-point. */
  points: { x: number; z: number }[];
  /** True when the last waypoint equals the (platform-clamped) target. */
  reached: boolean;
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
  /** Puts the character into ragdoll, as if hit by a projectile (no knockback). */
  ragdoll(name: string): boolean;
  eliminateAllAI(): number;
  /** Freezes every AI controller (AI keep physics but receive no input). */
  freezeAI(frozen: boolean): void;
  /** Per-character magnet usage counters for the current match. */
  stats(): Record<string, MagnetStats>;
  counts(): ResourceCounts;
  /** Scene particle systems with their render readiness (a disposed texture makes them not ready). */
  particleSystems(): { name: string; started: boolean; ready: boolean }[];
  /** Static arena layout: platforms, walkways, obstacle/collider footprints, spawn lists. */
  arena(): ArenaSnapshot;
  /** Arena.edgeInfo for a point. */
  edgeInfo(x: number, z: number): EdgeSnapshot;
  /** Arena.isObstructed for a point. */
  isObstructed(x: number, z: number, margin: number): boolean;
  /** Follows Arena.nextWaypoint from (fx, fz) toward (tx, tz) for at most `maxHops` waypoints. */
  route(fx: number, fz: number, tx: number, tz: number, maxHops: number): RouteResult;
  /** Frame-cost averages since the last call (resets the window). Profiling only. */
  perf(): PerfSample;
}

/** Averages over the frames since the previous perf() call. Times in ms. */
export interface PerfSample {
  frames: number;
  fps: number;
  medianMs: number;
  p95Ms: number;
  /** Frames longer than 50 ms (visible stutter). */
  hitches: number;
  frameMs: number;
  worstFrameMs: number;
  cpuMs: number;
  logicMs: number;
  physicsMs: number;
  renderMs: number;
  activeMeshesMs: number;
  drawCalls: number;
  activeMeshes: number;
  totalVertices: number;
  textureMB: number;
  jsHeapMB: number;
  renderWidth: number;
  renderHeight: number;
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
  const { scene, arena, match, objects, controller } = ctx;

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
    // An eliminated character's body is disposed 1 s after elimination: report zero velocity then.
    const v = c.alive ? c.body.getLinearVelocity() : { x: 0, y: 0, z: 0 };
    return {
      name: c.name, alive: c.alive, grounded: c.grounded, controlEnabled: c.controlEnabled,
      x: r2(c.position.x), y: r2(c.position.y), z: r2(c.position.z),
      vx: r2(v.x), vy: r2(v.y), vz: r2(v.z),
      stability: r2(c.stability), power: r2(c.power), repulseCooldown: r2(c.repulseCooldown),
      attracting: c.attracting, aimYaw: r2(c.input.aimYaw), heldBy: c.heldBy?.name ?? null,
      pulled: c.pulled,
      ragdoll: r2(c.ragdollTimer),
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

  const arenaSnapshot = (): ArenaSnapshot => ({
    platforms: arena.platforms.map((p) => ({
      name: p.name, kind: p.kind, shape: p.shape, cx: p.cx, cz: p.cz, radius: p.radius, hx: p.hx, hz: p.hz,
      axisX: p.axisX, axisZ: p.axisZ, halfLen: p.halfLen, halfWidth: p.halfWidth,
      ends: p.ends ? [p.ends[0].name, p.ends[1].name] : null,
    })),
    obstacles: arena.obstacles.map((o) => ({ x: o.x, z: o.z, hx: o.hx, hz: o.hz, circle: o.circle })),
    colliders: [
      ...BOXES.map((b) => ({ name: b.name, x: b.x, z: b.z, hx: b.w / 2, hz: b.d / 2, circle: false })),
      ...CYLINDERS.map((c) => ({ name: c.name, x: c.x, z: c.z, hx: c.radius, hz: c.radius, circle: true })),
      ...RAMPS.map((r) => ({ name: r.name, x: r.x, z: r.z, hx: ARENA.rampLength / 2, hz: ARENA.rampWidth / 2, circle: false })),
    ],
    spawns: SPAWN.points.map(([x, z]) => [x, z] as [number, number]),
    objectSpawns: OBJECT_SPAWNS.map((o) => ({ kind: o.kind, x: o.x, z: o.z })),
  });

  const route = (fx: number, fz: number, tx: number, tz: number, maxHops: number): RouteResult => {
    const points: { x: number; z: number }[] = [];
    const out = { x: 0, z: 0 };
    let x = fx;
    let z = fz;
    for (let i = 0; i < maxHops; i++) {
      arena.nextWaypoint(x, z, tx, tz, out);
      const same = Math.hypot(out.x - x, out.z - z) < 1e-6;
      if (same && points.length) return { points, reached: false }; // no progress: a routing loop or dead end
      points.push({ x: out.x, z: out.z });
      // nextWaypoint returns the (platform-clamped) target itself once no walkway is left to cross.
      arena.nextWaypoint(out.x, out.z, tx, tz, out);
      const last = points[points.length - 1];
      if (Math.hypot(out.x - last.x, out.z - last.z) < 1e-6) return { points, reached: true };
      x = last.x;
      z = last.z;
    }
    return { points, reached: false };
  };

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
    ragdoll: (name) => {
      const c = find(name);
      if (!c || !c.alive) return false;
      c.startRagdoll();
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
    arena: arenaSnapshot,
    edgeInfo: (x, z) => {
      const e = arena.edgeInfo(x, z);
      return { platform: e.platform?.name ?? null, kind: e.platform?.kind ?? null, distance: e.distance };
    },
    isObstructed: (x, z, margin) => arena.isObstructed(x, z, margin),
    route,
    perf: () => { throw new Error("perf probe not installed"); },
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
  installPerfProbe(scene, api);
  (window as unknown as { __MM_SCENE__: Scene }).__MM_SCENE__ = scene; // TEMP profiling
}

/** Per-frame timing via SceneInstrumentation (loaded lazily so it never ships in the main chunk). */
function installPerfProbe(scene: Scene, api: TestApi): void {
  let frames = 0, frameSum = 0, worst = 0, cpuSum = 0, logicSum = 0, physSum = 0, renderSum = 0, activeSum = 0;
  let drawSum = 0, meshSum = 0;
  const times: number[] = [];
  let logicStart = 0;
  let inst: import("@babylonjs/core/Instrumentation/sceneInstrumentation").SceneInstrumentation | null = null;
  void import("@babylonjs/core/Instrumentation/sceneInstrumentation").then(({ SceneInstrumentation }) => {
    inst = new SceneInstrumentation(scene);
    inst.captureFrameTime = true;
    inst.captureRenderTime = true;
    inst.capturePhysicsTime = true;
    inst.captureActiveMeshesEvaluationTime = true;
    inst.captureInterFrameTime = true;
  });
  scene.onBeforeAnimationsObservable.add(() => { logicStart = performance.now(); }, undefined, true);
  scene.onBeforeAnimationsObservable.add(() => { logicSum += performance.now() - logicStart; });
  scene.onAfterRenderObservable.add(() => {
    if (!inst) return;
    const dt = scene.getEngine().getDeltaTime();
    frames++;
    frameSum += dt;
    times.push(dt);
    worst = Math.max(worst, dt);
    cpuSum += inst.frameTimeCounter.current;
    physSum += inst.physicsTimeCounter.current;
    renderSum += inst.renderTimeCounter.current;
    activeSum += inst.activeMeshesEvaluationTimeCounter.current;
    drawSum += inst.drawCallsCounter.current;
    meshSum += scene.getActiveMeshes().length;
  });
  api.perf = () => {
    const n = Math.max(frames, 1);
    const sorted = [...times].sort((a, b) => a - b);
    let texBytes = 0;
    for (const t of scene.textures) {
      const s = t.getSize();
      texBytes += s.width * s.height * 4 * (t.isCube ? 6 : 1);
    }
    const eng = scene.getEngine();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    const out: PerfSample = {
      frames, fps: r2(1000 / (frameSum / n)),
      medianMs: r2(sorted[Math.floor(sorted.length / 2)] ?? 0), p95Ms: r2(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
      hitches: times.filter((t) => t > 50).length, frameMs: r2(frameSum / n), worstFrameMs: r2(worst),
      cpuMs: r2(cpuSum / n), logicMs: r2(logicSum / n), physicsMs: r2(physSum / n), renderMs: r2(renderSum / n),
      activeMeshesMs: r2(activeSum / n), drawCalls: Math.round(drawSum / n), activeMeshes: Math.round(meshSum / n),
      totalVertices: scene.getTotalVertices(), textureMB: r2(texBytes / 1048576),
      jsHeapMB: mem ? r2(mem.usedJSHeapSize / 1048576) : -1,
      renderWidth: eng.getRenderWidth(), renderHeight: eng.getRenderHeight(),
    };
    times.length = 0;
    frames = frameSum = worst = cpuSum = logicSum = physSum = renderSum = activeSum = drawSum = meshSum = 0;
    return out;
  };
}
