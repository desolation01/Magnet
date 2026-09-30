import type { Character } from "../character/Character";
import { AI } from "../config";
import { yawOf } from "../util/math";
import type { AIWorld } from "./AITargeting";

export enum Behavior {
  WANDER = "WANDER",
  ATTACK = "ATTACK",
  RETREAT = "RETREAT",
  DODGE = "DODGE",
  USE_OBJECT = "USE_OBJECT",
  /** Pull a ragdolled opponent in, carry it to the nearest void and drop or throw it off. */
  GRAB = "GRAB",
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

/**
 * Writes where a projectile fired from (sx, sz) at `speed` meets a target at (px, pz) moving at (vx, vz),
 * looking at most AI.maxLeadTime ahead. Falls back to the target's current position when there is no solution.
 */
export function interceptPoint(sx: number, sz: number, px: number, pz: number, vx: number, vz: number, speed: number, out: { x: number; z: number }): void {
  const rx = px - sx;
  const rz = pz - sz;
  // |r + v t| = speed t  →  (v·v − s²) t² + 2 (r·v) t + r·r = 0
  const a = vx * vx + vz * vz - speed * speed;
  const b = 2 * (rx * vx + rz * vz);
  const c = rx * rx + rz * rz;
  let t = -1;
  if (Math.abs(a) < 1e-6) {
    if (b < 0) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a);
      const t2 = (-b + sq) / (2 * a);
      t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
    }
  }
  if (!(t > 0)) t = 0;
  t = Math.min(t, AI.maxLeadTime);
  out.x = px + vx * t;
  out.z = pz + vz * t;
}

export function aimAt(self: Character, x: number, z: number, errorRad: number): void {
  self.input.aimYaw = yawOf(x - self.position.x, z - self.position.z) + errorRad;
}
