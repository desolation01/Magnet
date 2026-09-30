import type { Arena } from "../arena/Arena";
import type { MagneticObject } from "../arena/ArenaObjects";
import type { Character } from "../character/Character";
import { AI, ATTRACT, CHARACTER, type DifficultySettings, type Personality } from "../config";
import type { Rng } from "../util/rng";

export enum EdgeZone {
  SAFE,
  WARNING,
  DANGER,
}

/** Everything an AI may perceive (AGENTS.md §18: 20-unit radius, no line of sight). */
export interface AIWorld {
  arena: Arena;
  characters: Character[];
  objects: MagneticObject[];
  time: number;
  rng: Rng;
}

export function edgeZone(arena: Arena, x: number, z: number, diff: DifficultySettings): { zone: EdgeZone; distance: number } {
  const info = arena.edgeInfo(x, z);
  const d = info.distance;
  const p = info.platform;
  if (!p || d < 0) return { zone: EdgeZone.DANGER, distance: d };
  if (p.kind === "bridge") return { zone: EdgeZone.WARNING, distance: d };
  const outer = p.kind !== "hub"; // cardinal platforms and islands use the smaller thresholds
  const danger = (outer ? AI.outerDangerEdge : AI.dangerEdge) * diff.edgeMultiplier;
  const safe = (outer ? AI.outerSafeEdge : AI.safeEdge) * diff.edgeMultiplier;
  if (d <= danger) return { zone: EdgeZone.DANGER, distance: d };
  if (d <= safe) return { zone: EdgeZone.WARNING, distance: d };
  return { zone: EdgeZone.SAFE, distance: d };
}

export function perceiveOpponents(self: Character, world: AIWorld, out: Character[]): Character[] {
  out.length = 0;
  const r2 = AI.perceptionRadius * AI.perceptionRadius;
  for (const c of world.characters) {
    if (c === self || !c.alive) continue;
    const dx = c.position.x - self.position.x;
    const dz = c.position.z - self.position.z;
    if (dx * dx + dz * dz <= r2) out.push(c);
  }
  return out;
}

/** Target score (AGENTS.md §18). Higher is better. */
/** True when at most AI.lateGameAliveAI AI opponents are still alive (late-game push). */
export function isLateGame(world: AIWorld): boolean {
  let alive = 0;
  for (const c of world.characters) if (c.alive && !c.isPlayer) alive++;
  return alive <= AI.lateGameAliveAI;
}

export function scoreTarget(
  self: Character,
  target: Character,
  personality: Personality,
  selfZone: EdgeZone,
  world: AIWorld,
  edgeWeight = 1,
): number {
  const dist = Math.hypot(target.position.x - self.position.x, target.position.z - self.position.z);
  const targetEdge = world.arena.edgeInfo(target.position.x, target.position.z).distance;
  const edgeBonus = Math.min(1, Math.max(0, 1 - targetEdge / AI.safeEdge));
  let score = personality.aggression - dist / AI.perceptionRadius + edgeBonus * edgeWeight + 0.5 * (1 - target.stability / 100);
  if (selfZone !== EdgeZone.SAFE) score -= 0.5;
  if (target.ragdolled) score += AI.ragdollTargetBonus; // helpless: grab it and throw it
  score += (world.rng.next() * 2 - 1) * personality.randomness * 0.5;
  return score;
}

export function selectTarget(
  self: Character,
  perceived: Character[],
  personality: Personality,
  selfZone: EdgeZone,
  world: AIWorld,
): Character | null {
  const edgeWeight = isLateGame(world) ? AI.lateGameEdgeWeight : 1;
  if (perceived.length === 0) return null;
  // Chaotic AIs sometimes just pick anyone.
  if (world.rng.chance(personality.randomness * 0.3)) {
    return perceived[Math.floor(world.rng.next() * perceived.length)];
  }
  let best: Character | null = null;
  let bestScore = -Infinity;
  for (const c of perceived) {
    const s = scoreTarget(self, c, personality, selfZone, world, edgeWeight);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

/**
 * Nearest free magnetic object within the search radius that is not much farther away than the target
 * (AGENTS.md §19).
 */
export function findComboObject(self: Character, target: Character, world: AIWorld): MagneticObject | null {
  const targetDist = Math.hypot(target.position.x - self.position.x, target.position.z - self.position.z);
  let best: MagneticObject | null = null;
  let bestDist = AI.objectSearchRadius;
  for (const o of world.objects) {
    if (!o.alive || (o.heldBy && o.heldBy !== self)) continue;
    const d = Math.hypot(o.position.x - self.position.x, o.position.z - self.position.z);
    if (d < bestDist && d < targetDist + AI.objectDetour) {
      // Ignore objects that are already falling off the arena.
      if (world.arena.edgeInfo(o.position.x, o.position.z).distance < 0.5) continue;
      best = o;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Nearest ragdolled opponent this AI can reach and grab before its ragdoll ends (AGENTS.md §19, §24.1).
 * Skips opponents held by someone else, already falling, or still in this AI's regrab lockout.
 */
export function findGrabTarget(self: Character, perceived: Character[], world: AIWorld): Character | null {
  let best: Character | null = null;
  let bestDist = AI.grabSearchRadius;
  for (const c of perceived) {
    if (!c.ragdolled || (c.heldBy && c.heldBy !== self) || c.position.y < -1) continue;
    if ((c.regrabLockUntil.get(self) ?? 0) > world.time) continue;
    const d = Math.hypot(c.position.x - self.position.x, c.position.z - self.position.z);
    if (d >= bestDist) continue;
    const reach = Math.max(0, d - ATTRACT.range * 0.5) / AI.grabApproachSpeed + AI.grabMinRagdollLeft;
    if (c.heldBy !== self && c.ragdollTimer < reach) continue;
    best = c;
    bestDist = d;
  }
  return best;
}

/**
 * Scans AI.dropDirSamples directions from (x, z) for the nearest point over the void that can be reached
 * without crossing an obstacle footprint (walls, blocks, pillars, bounce pads). Writes the unit direction
 * into `out` and returns the distance to the void, or −1 if none is within AI.dropScanMax.
 */
export function findDropDirection(arena: Arena, x: number, z: number, out: { x: number; z: number }): number {
  let bestDist = -1;
  for (let i = 0; i < AI.dropDirSamples; i++) {
    const a = (i / AI.dropDirSamples) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    for (let s = AI.dropScanStep; s <= AI.dropScanMax; s += AI.dropScanStep) {
      if (bestDist >= 0 && s >= bestDist) break;
      const px = x + dx * s;
      const pz = z + dz * s;
      if (arena.isObstructed(px, pz, CHARACTER.radius * 0.6)) break;
      if (arena.edgeInfo(px, pz).platform === null) {
        bestDist = s;
        out.x = dx;
        out.z = dz;
        break;
      }
    }
  }
  return bestDist;
}
