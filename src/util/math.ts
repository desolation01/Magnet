import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export const DEG = Math.PI / 180;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent lerp factor for "lerp factor k × dt" style smoothing. */
export function smoothFactor(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt);
}

/** Shortest signed difference b − a between two angles (radians). */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

/** Yaw (radians) of a horizontal direction, where yaw 0 faces +Z. */
export function yawOf(x: number, z: number): number {
  return Math.atan2(x, z);
}

export function setForwardFromYaw(yaw: number, out: Vector3): Vector3 {
  out.set(Math.sin(yaw), 0, Math.cos(yaw));
  return out;
}

export function horizontalDistance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Moves the XZ components of `current` toward `target` by at most `maxDelta`. */
export function moveTowardsXZ(current: Vector3, targetX: number, targetZ: number, maxDelta: number): void {
  const dx = targetX - current.x;
  const dz = targetZ - current.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len <= maxDelta || len < 1e-6) {
    current.x = targetX;
    current.z = targetZ;
  } else {
    current.x += (dx / len) * maxDelta;
    current.z += (dz / len) * maxDelta;
  }
}

/** Scales the XZ components of v down to at most `max`. Returns true if it clamped. */
export function clampHorizontal(v: Vector3, max: number): boolean {
  const h = Math.sqrt(v.x * v.x + v.z * v.z);
  if (h <= max) return false;
  const k = max / h;
  v.x *= k;
  v.z *= k;
  return true;
}
