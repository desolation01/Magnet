import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CHARACTER, STABILITY } from "../config";
import type { MagneticObject } from "../arena/ArenaObjects";
import type { Character } from "../character/Character";

export interface ImpactEvents {
  /** A projectile (object or flying character) hit a character. */
  onImpact(victim: Character, position: Vector3, speed: number): void;
}

/**
 * Turns fast-moving objects and knocked-back characters into projectiles (AGENTS.md §24).
 * Physics already handles the collision itself; this adds the knockback state, the
 * stability loss and a velocity transfer so the victim's movement controller does
 * not cancel the hit.
 */
export class KnockbackSystem {
  private readonly v = new Vector3();
  private readonly dv = new Vector3();
  private readonly victimV = new Vector3();
  private readonly minSpeedSq = STABILITY.objectHitSpeed * STABILITY.objectHitSpeed;

  constructor(private readonly events: ImpactEvents) {}

  update(time: number, characters: Character[], objects: MagneticObject[]): void {
    for (const o of objects) {
      if (!o.alive || o.heldBy) continue;
      o.body.getLinearVelocityToRef(this.v);
      if (this.v.lengthSquared() < this.minSpeedSq) continue;
      this.checkHits(o, o.position, o.radius, time, characters, null);
    }
    for (const c of characters) {
      if (!c.alive || c.knockbackTimer <= 0 || c.heldBy) continue;
      c.body.getLinearVelocityToRef(this.v);
      if (this.v.lengthSquared() < this.minSpeedSq) continue;
      this.checkHits(c, c.position, CHARACTER.radius, time, characters, c);
    }
  }

  private checkHits(
    projectile: object,
    p: Vector3,
    radius: number,
    time: number,
    characters: Character[],
    self: Character | null,
  ): void {
    const reach = radius + CHARACTER.radius + 0.25;
    const reachSq = reach * reach;
    for (const t of characters) {
      if (t === self || !t.alive || t.heldBy) continue;
      const dx = t.position.x - p.x;
      const dz = t.position.z - p.z;
      if (dx * dx + dz * dz > reachSq) continue;
      if (Math.abs(t.position.y - p.y) > CHARACTER.height / 2 + radius) continue;
      const until = t.hitCooldowns.get(projectile) ?? 0;
      if (until > time) continue;

      // Only the closing speed counts, so two characters flying together never feed each other.
      const h = Math.sqrt(dx * dx + dz * dz) || 1;
      const nx = dx / h;
      const nz = dz / h;
      t.body.getLinearVelocityToRef(this.victimV);
      const closing = (this.v.x - this.victimV.x) * nx + (this.v.z - this.victimV.z) * nz;
      if (closing < STABILITY.objectHitSpeed) continue;
      t.hitCooldowns.set(projectile, time + STABILITY.objectHitCooldown);

      // Physics already transferred momentum; top the victim up to at least `push` along
      // the hit direction instead of adding on top of it.
      const push = closing * STABILITY.objectHitTransfer;
      const along = this.victimV.x * nx + this.victimV.z * nz;
      const extra = Math.max(0, push - along);
      this.dv.set(nx * extra, STABILITY.objectHitLift, nz * extra);
      t.applyKnockback(this.dv, self ?? t.lastHitBy, STABILITY.objectHit, self ? "charHit" : "objHit");
      this.events.onImpact(t, t.position, closing);
    }
  }

  /** Drops stale per-projectile cooldown entries so the maps never grow unbounded. */
  prune(time: number, characters: Character[]): void {
    for (const c of characters) {
      for (const [k, until] of c.hitCooldowns) if (until <= time) c.hitCooldowns.delete(k);
      for (const [k, until] of c.regrabLockUntil) if (until <= time) c.regrabLockUntil.delete(k);
      for (const k of c.pullTime.keys()) if (!k.alive || !k.attracting) c.pullTime.delete(k);
    }
  }
}
