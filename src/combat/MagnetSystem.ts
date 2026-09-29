import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ATTRACT, CHARACTER, OBJECTS, PARTICLES, POWER, REPULSE, STABILITY } from "../config";
import type { MagneticObject } from "../arena/ArenaObjects";
import type { Character } from "../character/Character";
import { clampHorizontal, DEG } from "../util/math";
import type { Effects } from "./Effects";

export interface MagnetEvents {
  onRepulse(user: Character, magnetPos: Vector3): void;
  onAttractChange(user: Character, active: boolean): void;
}

const ATTRACT_COS = Math.cos((ATTRACT.coneDeg / 2) * DEG);
const REPULSE_COS = Math.cos((REPULSE.coneDeg / 2) * DEG);
const REPULSE_COLOR = new Color4(0.55, 0.9, 1, 1);

/** Attract, hold and repulse for every character (AGENTS.md §8–9). */
export class MagnetSystem {
  private readonly v = new Vector3();
  private readonly holderV = new Vector3();
  private readonly hold = new Vector3();
  private readonly dir = new Vector3();
  private readonly dv = new Vector3();
  private readonly magnetPos = new Vector3();

  constructor(private readonly effects: Effects, private readonly events: MagnetEvents) {}

  /** Hold point: in front of the character at chest height. */
  holdPoint(c: Character, out: Vector3): Vector3 {
    const feetY = c.position.y - CHARACTER.height / 2;
    out.set(
      c.position.x + Math.sin(c.input.aimYaw) * ATTRACT.holdDistance,
      feetY + ATTRACT.holdHeight,
      c.position.z + Math.cos(c.input.aimYaw) * ATTRACT.holdDistance,
    );
    return out;
  }

  update(dt: number, time: number, characters: Character[], objects: MagneticObject[]): void {
    for (const c of characters) c.pulled = false;

    // 1. Attract state + magnet power
    for (const c of characters) {
      if (!c.alive) continue;
      const canUse = c.controlEnabled && c.knockbackTimer <= 0;
      let want = canUse && c.input.attract;
      if (want && !c.attracting && c.power < POWER.restartThreshold) want = false;
      if (want) {
        c.power -= POWER.drainPerSec * dt;
        if (c.power <= 0) {
          c.power = 0;
          want = false;
        }
      } else {
        c.power = Math.min(POWER.max, c.power + POWER.regenPerSec * dt);
      }
      if (want !== c.attracting) {
        c.attracting = want;
        if (!want) this.releaseAll(c, characters, objects, time);
        this.events.onAttractChange(c, want);
      }
      // Characters that are knocked back drop what they hold.
      if (c.knockbackTimer > 0) this.releaseAll(c, characters, objects, time);
    }

    // 2. Pull + capture
    for (const c of characters) {
      if (!c.alive || !c.attracting) continue;
      this.holdPoint(c, this.hold);
      let heldChars = 0;
      for (const t of characters) if (t.heldBy === c) heldChars++;

      for (const o of objects) {
        if (!o.alive || o.heldBy === c) continue;
        // A just-launched object is not pulled back by the magnet that launched it (attract may still be held).
        if (o.launchedBy === c && time < o.launchLockUntil) continue;
        const d = this.inCone(c, o.position, ATTRACT.range, ATTRACT_COS);
        if (d < 0) continue;
        this.pull(o.body, o.position, d, dt);
        if (!o.heldBy && Vector3.Distance(o.position, this.hold) <= ATTRACT.captureDistance + o.radius * 0.5) {
          o.heldBy = c;
          o.body.setGravityFactor(0);
        }
      }

      for (const t of characters) {
        if (t === c || !t.alive) continue;
        const held = t.heldBy === c;
        let d = 0;
        if (!held) {
          if ((t.regrabLockUntil.get(c) ?? 0) > time) continue;
          d = this.inCone(c, t.position, ATTRACT.range, ATTRACT_COS);
          if (d < 0) {
            t.pullTime.delete(c);
            continue;
          }
        }
        // A character can be pulled + held by the same attacker for a limited time in a row.
        const pullTime = (t.pullTime.get(c) ?? 0) + dt;
        if (pullTime >= ATTRACT.characterPullTime) {
          if (held) this.releaseCharacter(t, time);
          else this.lockOut(t, c, time);
          continue;
        }
        t.pullTime.set(c, pullTime);
        if (held) continue;
        this.pull(t.body, t.position, d, dt);
        t.pulled = true;
        t.lastHitBy = c; // a pull that drags someone off the edge earns the elimination credit
        if (
          heldChars < ATTRACT.maxHeldCharacters && !t.heldBy && c.heldBy !== t &&
          Vector3.Distance(t.position, this.hold) <= ATTRACT.captureDistance + CHARACTER.radius
        ) {
          t.heldBy = c;
          t.body.setGravityFactor(0);
          heldChars++;
        }
      }
    }

    // 3. Held targets follow the hold point with a damped spring.
    for (const o of objects) {
      const h = o.heldBy;
      if (!o.alive || !h) continue;
      if (!h.alive || !h.attracting) {
        this.releaseObject(o);
        continue;
      }
      if (!this.spring(h, o.body, o.position, dt)) this.releaseObject(o);
    }
    for (const t of characters) {
      const h = t.heldBy;
      if (!h) continue;
      if (!t.alive || !h.alive || !h.attracting) {
        this.releaseCharacter(t, time);
        continue;
      }
      if (!this.spring(h, t.body, t.position, dt)) this.releaseCharacter(t, time);
    }

    // 4. Repulse
    for (const c of characters) {
      const requested = c.input.repulse;
      c.input.repulse = false;
      if (!requested || !c.alive || !c.controlEnabled || c.repulseCooldown > 0) continue;
      this.repulse(c, characters, objects, time);
    }
  }

  /** Returns distance if `p` is within range and cone of `c`'s aim, else −1. */
  private inCone(c: Character, p: Vector3, range: number, cosLimit: number): number {
    const dx = p.x - c.position.x;
    const dy = p.y - c.position.y;
    const dz = p.z - c.position.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > range) return -1;
    const h = Math.sqrt(dx * dx + dz * dz);
    if (h < 0.3) return d;
    const cos = (dx * Math.sin(c.input.aimYaw) + dz * Math.cos(c.input.aimYaw)) / h;
    return cos >= cosLimit ? d : -1;
  }

  private pull(body: { getLinearVelocityToRef(v: Vector3): void; setLinearVelocity(v: Vector3): void }, p: Vector3, d: number, dt: number): void {
    const a = ATTRACT.accel * (1 - d / ATTRACT.range);
    this.dir.copyFrom(this.hold).subtractInPlace(p);
    const len = this.dir.length();
    if (len < 1e-4) return;
    this.dir.scaleInPlace((a * dt) / len);
    body.getLinearVelocityToRef(this.v);
    this.v.addInPlace(this.dir);
    body.setLinearVelocity(this.v);
  }

  /** Damped spring toward the holder's hold point. Returns false if the target got stuck too far away. */
  private spring(holder: Character, body: { getLinearVelocityToRef(v: Vector3): void; setLinearVelocity(v: Vector3): void }, p: Vector3, dt: number): boolean {
    this.holdPoint(holder, this.hold);
    this.dir.copyFrom(this.hold).subtractInPlace(p);
    if (this.dir.lengthSquared() > 36) return false;
    holder.body.getLinearVelocityToRef(this.holderV);
    body.getLinearVelocityToRef(this.v);
    const k = ATTRACT.springStiffness;
    const c = ATTRACT.springDamping;
    this.v.x += (k * this.dir.x - c * (this.v.x - this.holderV.x)) * dt;
    this.v.y += (k * this.dir.y - c * (this.v.y - this.holderV.y)) * dt;
    this.v.z += (k * this.dir.z - c * (this.v.z - this.holderV.z)) * dt;
    body.setLinearVelocity(this.v);
    return true;
  }

  private repulse(c: Character, characters: Character[], objects: MagneticObject[], time: number): void {
    const sin = Math.sin(c.input.aimYaw);
    const cos = Math.cos(c.input.aimYaw);
    const launch = REPULSE.launchSpeed;

    // 1. Launch everything held.
    for (const o of objects) {
      if (o.heldBy !== c || !o.alive) continue;
      this.releaseObject(o);
      o.launchedBy = c;
      o.launchLockUntil = time + ATTRACT.objectRegrabLockout;
      this.v.set(sin * launch, launch * REPULSE.launchLift, cos * launch);
      o.body.setLinearVelocity(this.v);
    }
    for (const t of characters) {
      if (t.heldBy !== c) continue;
      this.releaseCharacter(t, time);
      this.v.set(0, 0, 0);
      t.setVelocity(this.v);
      this.dv.set(sin * launch, launch * REPULSE.launchLift, cos * launch);
      t.applyKnockback(this.dv, c, STABILITY.repulseHit, "launch");
      this.releaseAll(t, characters, objects, time);
    }

    // 2. Push everything else in the cone or point-blank radius.
    for (const o of objects) {
      if (!o.alive || o.heldBy) continue;
      const d = this.repulseDistance(c, o.position);
      if (d < 0) continue;
      this.pushVector(c, o.position, d, sin, cos);
      if (o.heavy) this.dv.scaleInPlace(REPULSE.heavyFactor);
      o.body.getLinearVelocityToRef(this.v);
      this.v.addInPlace(this.dv);
      clampHorizontal(this.v, OBJECTS.maxSpeed);
      o.body.setLinearVelocity(this.v);
    }
    for (const t of characters) {
      if (t === c || !t.alive || t.heldBy) continue;
      const d = this.repulseDistance(c, t.position);
      if (d < 0) continue;
      this.pushVector(c, t.position, d, sin, cos);
      this.dv.x *= REPULSE.characterFactor;
      this.dv.z *= REPULSE.characterFactor;
      t.applyKnockback(this.dv, c, STABILITY.repulseHit);
      this.releaseAll(t, characters, objects, time);
    }

    c.repulseCooldown = REPULSE.cooldown;
    c.repulseAnimTimer = 0.2;

    this.magnetPos.set(c.position.x + sin * 1.2, c.position.y + 0.2, c.position.z + cos * 1.2);
    this.effects.burst(this.magnetPos, REPULSE_COLOR, PARTICLES.repulseMax, 12);
    this.magnetPos.y = c.position.y - 0.9;
    this.effects.shockwave(this.magnetPos, 5);
    this.events.onRepulse(c, this.magnetPos);
  }

  private repulseDistance(c: Character, p: Vector3): number {
    const d = Vector3.Distance(c.position, p);
    if (d <= REPULSE.pointBlankRadius) return d;
    return this.inCone(c, p, REPULSE.range, REPULSE_COS);
  }

  /** Writes the repulse velocity change for a target at distance d into this.dv. */
  private pushVector(c: Character, p: Vector3, d: number, sin: number, cos: number): void {
    let dx = p.x - c.position.x;
    let dz = p.z - c.position.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    if (h < 0.2) {
      dx = sin;
      dz = cos;
    } else {
      dx /= h;
      dz /= h;
    }
    const falloff = 1 - REPULSE.falloff * (d / REPULSE.range);
    this.dv.set(dx * REPULSE.horizontalSpeed * falloff, REPULSE.upwardSpeed * falloff, dz * REPULSE.horizontalSpeed * falloff);
  }

  private releaseObject(o: MagneticObject): void {
    o.heldBy = null;
    if (o.alive) o.body.setGravityFactor(1);
  }

  private releaseCharacter(t: Character, time: number): void {
    const h = t.heldBy;
    t.heldBy = null;
    if (h) this.lockOut(t, h, time);
    if (t.alive) t.body.setGravityFactor(1);
  }

  /** Ends `attacker`'s pull on `t`; its magnet ignores `t` for the regrab lockout. */
  private lockOut(t: Character, attacker: Character, time: number): void {
    t.pullTime.delete(attacker);
    t.regrabLockUntil.set(attacker, time + ATTRACT.regrabLockout);
  }

  /** Drops everything held by `c`. */
  releaseAll(c: Character, characters: Character[], objects: MagneticObject[], time: number): void {
    for (const o of objects) if (o.heldBy === c) this.releaseObject(o);
    for (const t of characters) {
      if (t.heldBy === c) this.releaseCharacter(t, time);
      t.pullTime.delete(c);
    }
  }
}
