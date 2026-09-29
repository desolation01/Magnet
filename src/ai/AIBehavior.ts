import type { Character } from "../character/Character";
import { yawOf } from "../util/math";
import type { AIWorld } from "./AITargeting";

export enum Behavior {
  WANDER = "WANDER",
  ATTACK = "ATTACK",
  RETREAT = "RETREAT",
  DODGE = "DODGE",
  USE_OBJECT = "USE_OBJECT",
}

const wp = { x: 0, z: 0 };

/**
 * Sets moveDir to walk toward (tx, tz), routing through bridges when the destination is
 * on another platform (AGENTS.md §23: simple steering, no navmesh).
 * Returns the straight-line distance to the destination.
 */
export function steerTo(self: Character, world: AIWorld, tx: number, tz: number, speedScale = 1): number {
  const p = self.position;
  world.arena.nextWaypoint(p.x, p.z, tx, tz, wp);
  const dx = wp.x - p.x;
  const dz = wp.z - p.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.3) {
    self.input.moveDir.set(0, 0, 0);
  } else {
    const s = Math.min(1, len / 1.5) * speedScale;
    self.input.moveDir.set((dx / len) * s, 0, (dz / len) * s);
  }
  return Math.hypot(tx - p.x, tz - p.z);
}

/** Adds a sideways component (strafe) to the current moveDir. */
export function addStrafe(self: Character, towardX: number, towardZ: number, dir: number, amount: number): void {
  const len = Math.hypot(towardX, towardZ);
  if (len < 0.01) return;
  // Perpendicular (right-hand) of the facing direction.
  const px = towardZ / len;
  const pz = -towardX / len;
  const m = self.input.moveDir;
  m.x += px * dir * amount;
  m.z += pz * dir * amount;
  const ml = Math.hypot(m.x, m.z);
  if (ml > 1) {
    m.x /= ml;
    m.z /= ml;
  }
}

/** Adds a pull toward the center of the platform below (used in WARNING zones). */
export function addCentering(self: Character, world: AIWorld, amount: number): void {
  const p = self.position;
  const platform = world.arena.edgeInfo(p.x, p.z).platform;
  if (!platform || platform.kind === "bridge") return;
  const dx = platform.cx - p.x;
  const dz = platform.cz - p.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const m = self.input.moveDir;
  m.x += (dx / len) * amount;
  m.z += (dz / len) * amount;
  const ml = Math.hypot(m.x, m.z);
  if (ml > 1) {
    m.x /= ml;
    m.z /= ml;
  }
}

export function aimAt(self: Character, x: number, z: number, errorRad: number): void {
  self.input.aimYaw = yawOf(x - self.position.x, z - self.position.z) + errorRad;
}
