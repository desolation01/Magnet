import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { MagneticObject } from "../arena/ArenaObjects";
import type { Character } from "../character/Character";
import { AI, ATTRACT, POWER, REPULSE, type DifficultySettings, type Personality } from "../config";
import { angleDelta, DEG, yawOf } from "../util/math";
import { addCentering, addStrafe, aimAt, Behavior, interceptPoint, steerTo } from "./AIBehavior";
import {
  EdgeZone, edgeZone, findComboObject, findDropDirection, findGrabTarget, isLateGame, nearbyPlayer, perceiveOpponents, selectTarget,
  type AIWorld,
} from "./AITargeting";

interface Decision {
  behavior: Behavior;
  target: Character | null;
  object: MagneticObject | null;
  flank: boolean;
  useAttract: boolean;
}


const tmpVel = new Vector3();

/** Drives one AI character through the same CharacterInput the player uses (AGENTS.md §16, §22). */
export class AIController {
  behavior: Behavior = Behavior.WANDER;
  target: Character | null = null;
  zone: EdgeZone = EdgeZone.SAFE;
  /** Kill-combo counters for playtests (window.__MM_DUMP__). */
  readonly stats = { objectThrows: 0, grabStarts: 0, grabs: 0, drops: 0, charThrows: 0, finishers: 0 };

  private object: MagneticObject | null = null;
  private objectStart = 0;
  private objectCooldownUntil = 0;
  private targetUntil = 0;
  private flank = false;
  private useAttract = true;
  private aimError = 0;
  private decisionTimer: number;
  private pending: Decision | null = null;
  private reactionTimer = 0;
  private strafeDir = 1;
  private strafeTimer = 0;
  private dodgeTimer = 0;
  private dodgeX = 0;
  private dodgeZ = 0;
  private wanderX = 0;
  private wanderZ = 0;
  private hasWanderPoint = false;
  private readonly wanderPoint = { x: 0, z: 0 };
  /** At most AI.lateGameAliveAI AI left (refreshed every decision). */
  private lateGame = false;
  private stuckTimer = 0;
  /** Committed to firing repulse at the next good opportunity (rolled per decision). */
  private wantsRepulse = false;
  /** Match time before which this AI will not repulse (opening delay, then rest after each shot). */
  private repulseReadyAt: number;
  /** Match time before which this AI will not attract (opening delay). */
  private readonly attractReadyAt: number;
  /** Match time before which this AI will not repulse at all (opening delay; launches skip the later rests). */
  private readonly openingRepulseAt: number;
  /** Holding a grabbed character this frame (GRAB): relaxes the edge guard so it can reach the void. */
  private carrying = false;
  private readonly dropDir = { x: 0, z: 1 };
  private dropDist = -1;
  private dropDirAt = 0;
  private lastCarried: Character | null = null;
  /** Cached nearest void from the current target (edge-line throws and finishers). */
  private readonly voidDir = { x: 0, z: 1 };
  private voidDist = -1;
  private voidFor: Character | null = null;
  private voidAt = 0;
  private readonly aimPoint = { x: 0, z: 0 };
  /** Rolled each decision: ignore the per-frame edge guard until the next decision (§20 mistakes). */
  private edgeMistake = false;
  private readonly perceived: Character[] = [];
  private readonly outward = { x: 0, z: 0 };

  constructor(
    readonly self: Character,
    readonly personality: Personality,
    readonly difficulty: DifficultySettings,
    world: AIWorld,
  ) {
    // Stagger decision timers so the AIs never all think on the same frame.
    this.decisionTimer = world.rng.range(0, difficulty.decisionInterval);
    this.strafeTimer = world.rng.range(AI.strafeFlipMin, AI.strafeFlipMax);
    this.repulseReadyAt = world.rng.range(AI.openingRepulseMin, AI.openingRepulseMax);
    this.openingRepulseAt = this.repulseReadyAt;
    this.attractReadyAt = world.rng.range(AI.openingAttractMin, AI.openingAttractMax);
  }

  /** Repulse is off cooldown and this AI has finished resting since its last shot. */
  private canRepulse(world: AIWorld): boolean {
    return this.self.repulseCooldown <= 0 && world.time >= this.repulseReadyAt;
  }

  /**
   * Launching something held (an object or a grabbed character) only waits for the cooldown and the opening
   * delay, not the rest: the magnet power drains while holding, so a throw that waits for the rest is lost.
   */
  private canLaunch(world: AIWorld): boolean {
    return this.self.repulseCooldown <= 0 && world.time >= this.openingRepulseAt;
  }

  update(dt: number, world: AIWorld): void {
    const self = this.self;
    const input = self.input;
    input.moveDir.set(0, 0, 0);
    input.sprint = false;
    input.attract = false;
    this.carrying = false;
    if (!self.alive || !self.controlEnabled || self.ragdolled) return;
    const prevAim = input.aimYaw;

    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer += this.difficulty.decisionInterval;
      this.decide(world);
    }
    if (this.pending) {
      this.reactionTimer -= dt;
      if (this.reactionTimer <= 0) this.apply(this.pending, world);
    }

    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = world.rng.range(AI.strafeFlipMin, AI.strafeFlipMax);
      this.strafeDir = -this.strafeDir;
    }

    switch (this.behavior) {
      case Behavior.WANDER: this.wander(world); break;
      case Behavior.ATTACK: this.attack(world); break;
      case Behavior.RETREAT: this.retreat(world); break;
      case Behavior.DODGE: this.dodge(dt); break;
      case Behavior.USE_OBJECT: this.useObject(world); break;
      case Behavior.GRAB: this.grab(world); break;
    }

    this.separate(world);
    this.keepMoving(world);
    this.guardEdges(world);

    // Aim turns at a limited rate; only fire once roughly aligned.
    const wanted = input.aimYaw;
    const delta = angleDelta(prevAim, wanted);
    const maxStep = AI.aimTurnRateDeg * DEG * dt;
    input.aimYaw = prevAim + Math.max(-maxStep, Math.min(maxStep, delta));
    if (input.repulse) {
      if (Math.abs(angleDelta(input.aimYaw, wanted)) > AI.fireAlignDeg * DEG) input.repulse = false;
      else {
        this.wantsRepulse = false;
        const rest = world.rng.range(AI.repulseRestMin, AI.repulseRestMax)
          * Math.max(0, AI.repulseRestAggressionBase - this.personality.aggression)
          * this.difficulty.repulseRestMultiplier
          * (this.lateGame ? AI.lateGameRestMultiplier : 1);
        this.repulseReadyAt = world.time + REPULSE.cooldown * self.perks.cooldown + rest;
        if (this.carrying) this.stats.charThrows++;
        else if (this.behavior === Behavior.GRAB) this.stats.finishers++;
        else if (this.isHoldingObject(world)) this.stats.objectThrows++;
        if (this.behavior === Behavior.USE_OBJECT && this.object?.heldBy === self) {
          this.endObjectCombo(world);
          this.behavior = Behavior.ATTACK;
        }
      }
    }

    // Jump when blocked.
    const moving = input.moveDir.lengthSquared() > 0.09;
    self.body.getLinearVelocityToRef(tmpVel);
    if (moving && self.grounded && Math.hypot(tmpVel.x, tmpVel.z) < 1) {
      this.stuckTimer += dt;
      if (this.stuckTimer > AI.stuckTime) {
        input.jump = true;
        this.stuckTimer = 0;
        this.hasWanderPoint = false; // the wander point may be unreachable (e.g. on a raised block)
      }
    } else {
      this.stuckTimer = 0;
    }
  }

  /**
   * §16: an AI never stands still. If the behavior produced (almost) no steering — a steer target was
   * reached, or it is waiting on magnet power / an opening delay — circle sideways around the target
   * (or the arena center) instead.
   */
  private keepMoving(world: AIWorld): void {
    const self = this.self;
    const m = self.input.moveDir;
    if (m.x * m.x + m.z * m.z >= AI.minMoveInput * AI.minMoveInput) return;
    const here = world.arena.edgeInfo(self.position.x, self.position.z).platform;
    if (here && here.kind === "bridge") {
      // Sideways circling would walk off a walkway: step off it along its axis instead.
      const end = world.arena.nearerEnd(here, self.position.x, self.position.z);
      const sign = end === here.ends![1] ? 1 : -1;
      m.set(here.axisX * sign * AI.idleStrafe, 0, here.axisZ * sign * AI.idleStrafe);
      return;
    }
    // Circle around the target, or around the center of the platform we stand on.
    const t = this.target;
    const cx = here ? here.cx : 0;
    const cz = here ? here.cz : 0;
    let tx = t && t.alive ? t.position.x - self.position.x : cx - self.position.x;
    let tz = t && t.alive ? t.position.z - self.position.z : cz - self.position.z;
    if (tx * tx + tz * tz < 0.01) {
      tx = 1;
      tz = 0;
    }
    addStrafe(self, tx, tz, this.strafeDir, AI.idleStrafe);
  }

  /** Steers away from other characters closer than AI.separationRadius so AI do not pile up (not from the target). */
  private separate(world: AIWorld): void {
    if (this.carrying || this.behavior === Behavior.DODGE) return;
    const self = this.self;
    const here = world.arena.edgeInfo(self.position.x, self.position.z);
    if (!here.platform || here.platform.kind === "bridge" || here.distance < AI.separationEdgeClearance) return;
    let sx = 0;
    let sz = 0;
    for (const c of world.characters) {
      if (c === self || c === this.target || !c.alive || c.heldBy === self) continue;
      const dx = self.position.x - c.position.x;
      const dz = self.position.z - c.position.z;
      const d = Math.hypot(dx, dz);
      if (d >= AI.separationRadius || d < 0.01) continue;
      const w = 1 - d / AI.separationRadius;
      sx += (dx / d) * w;
      sz += (dz / d) * w;
    }
    if (sx === 0 && sz === 0) return;
    const m = self.input.moveDir;
    m.x += sx * AI.separationWeight;
    m.z += sz * AI.separationWeight;
    const ml = Math.hypot(m.x, m.z);
    if (ml > 1) {
      m.x /= ml;
      m.z /= ml;
    }
  }

  /**
   * Per-frame safety layer on top of the chosen behavior: on a bridge, keep to the centerline;
   * right at a platform edge, drop any outward component of the steering.
   */
  private guardEdges(world: AIWorld): void {
    if (this.edgeMistake) return;
    const self = this.self;
    const m = self.input.moveDir;
    const x = self.position.x;
    const z = self.position.z;
    const info = world.arena.edgeInfo(x, z);
    const p = info.platform;
    if (!p) return;
    if (p.kind === "bridge") {
      // Replace the sideways component (across the walkway axis) with a pull back to its centerline.
      const px = -p.axisZ;
      const pz = p.axisX;
      const side = m.x * px + m.z * pz;
      const pull = -world.arena.lateralOffset(p, x, z) * AI.bridgeCenterGain;
      m.x += px * (pull - side);
      m.z += pz * (pull - side);
      // Steering that was all sideways (e.g. strafing around a target along the walkway) would leave the
      // AI standing still here: step off along the axis toward its target (or the nearer end) instead (§16).
      const along = m.x * p.axisX + m.z * p.axisZ;
      if (Math.abs(along) < AI.minMoveInput) {
        const o = this.behavior === Behavior.USE_OBJECT && this.object && this.object.alive ? this.object : null;
        const t = o ?? (this.target && this.target.alive ? this.target : null);
        const toTarget = t ? (t.position.x - x) * p.axisX + (t.position.z - z) * p.axisZ : 0;
        const sign = toTarget !== 0 ? Math.sign(toTarget) : (world.arena.nearerEnd(p, x, z) === p.ends![1] ? 1 : -1);
        m.x += p.axisX * (sign * AI.idleStrafe - along);
        m.z += p.axisZ * (sign * AI.idleStrafe - along);
      }
    } else if (info.distance < (this.carrying ? AI.carryEdgeGuardDistance : AI.edgeGuardDistance)) {
      world.arena.outwardDir(x, z, this.outward);
      const out = m.x * this.outward.x + m.z * this.outward.z;
      if (out > 0) {
        m.x -= this.outward.x * out;
        m.z -= this.outward.z * out;
      }
    } else {
      return;
    }
    const ml = Math.hypot(m.x, m.z);
    if (ml > 1) {
      m.x /= ml;
      m.z /= ml;
    }
  }

  // ---------------------------------------------------------------- decisions

  private decide(world: AIWorld): void {
    const self = this.self;
    const rng = world.rng;
    const diff = this.difficulty;
    const pers = this.personality;

    this.lateGame = isLateGame(world);
    perceiveOpponents(self, world, this.perceived, this.lateGame ? AI.perceptionRadius : AI.localPerceptionRadius);
    const { zone } = edgeZone(world.arena, self.position.x, self.position.z, diff);
    this.zone = zone;

    let target = this.target;
    const targetValid = !!target && target.alive && this.perceived.includes(target);
    // The player coming close overrides the target hold time (player focus).
    const player = nearbyPlayer(self, this.perceived);
    if (!targetValid || world.time >= this.targetUntil || (player && target !== player)) {
      const next = selectTarget(self, this.perceived, pers, zone, world);
      if (next !== target || !targetValid) this.targetUntil = world.time + AI.targetHoldTime;
      target = next;
    }

    this.aimError = rng.range(-1, 1) * diff.aimErrorDeg * DEG;
    this.edgeMistake = rng.chance(diff.mistakeChance);
    const lateRepulse = this.lateGame ? AI.lateGameRepulseChanceBonus : 0;
    if (!this.wantsRepulse) this.wantsRepulse = rng.chance(AI.repulseChanceBase + AI.repulseChanceAggression * pers.aggression + lateRepulse);

    // A dodge in progress always finishes.
    if (this.behavior === Behavior.DODGE && this.dodgeTimer > 0) return;

    const d: Decision = { behavior: Behavior.WANDER, target, object: null, flank: this.flank, useAttract: this.useAttract };
    const carried = this.heldCharacter(world);
    const holdingObject = this.isHoldingObject(world);
    // With the player close by, only the player is worth grabbing.
    const grab = carried ?? findGrabTarget(self, this.perceived, world, player);
    // A kill is on (holding something, or a ragdolled opponent to finish): no caution retreats (only DANGER).
    const killOn = holdingObject || grab !== null;

    if (carried) {
      // Someone is in the magnet: finish the kill (drop or throw it off) instead of retreating or dodging.
      d.behavior = Behavior.GRAB;
      d.target = carried;
    } else if (zone === EdgeZone.DANGER && !rng.chance(diff.mistakeChance)) {
      d.behavior = Behavior.RETREAT;
    } else if (!this.lateGame && !killOn && self.stability < AI.lowStability && rng.chance(pers.edgeCaution * 0.5)) {
      // (Late game: no low-stability retreats — everyone is worn down by then, and retreating to the hub
      // center made the last AI stall there where no knockback reaches an edge.)
      d.behavior = Behavior.RETREAT;
    } else if (!killOn && zone === EdgeZone.WARNING && this.movingOutward(world, target) && rng.chance(pers.edgeCaution)
      && this.behavior !== Behavior.USE_OBJECT && this.behavior !== Behavior.GRAB) {
      d.behavior = Behavior.RETREAT;
    } else if (!holdingObject && this.findThreat() && rng.chance(diff.dodgeChance)) {
      d.behavior = Behavior.DODGE;
    } else if (grab && !holdingObject && world.time >= this.attractReadyAt) {
      // A ragdolled opponent is the best chance of a kill: grab it (§19, §24.1).
      d.behavior = Behavior.GRAB;
      d.target = grab;
    } else if (this.behavior === Behavior.USE_OBJECT && this.object?.alive && world.time - this.objectStart < AI.objectComboTimeout) {
      return; // keep working the combo
    } else if (target) {
      const canCombo = world.time >= this.objectCooldownUntil && world.time >= this.attractReadyAt;
      const obj = canCombo ? findComboObject(self, target, world) : null;
      if (obj && rng.chance(AI.objectComboChanceBase + pers.objectUse * diff.objectUseMultiplier)) {
        d.behavior = Behavior.USE_OBJECT;
        d.object = obj;
      } else {
        d.behavior = Behavior.ATTACK;
      }
    }

    if (d.behavior === Behavior.ATTACK && (d.target !== this.target || this.behavior !== Behavior.ATTACK)) {
      d.flank = rng.chance(Math.min(1, pers.flankBias + AI.flankBonus + (this.lateGame ? AI.lateGameFlankBonus : 0)));
      d.useAttract = rng.chance(AI.attractChanceBase + AI.attractChanceAggression * pers.aggression);
    }

    const changed = d.behavior !== this.behavior || d.target !== this.target;
    if (!changed) {
      this.apply(d, world);
    } else {
      // The reaction delay counts from the FIRST pending change: newer decisions replace the pending one
      // without restarting the timer, otherwise a delay longer than the decision interval (EASY) would
      // postpone every change forever.
      if (!this.pending) this.reactionTimer = diff.reactionDelay;
      this.pending = d;
    }
  }

  private apply(d: Decision, world: AIWorld): void {
    this.pending = null;
    if (d.behavior === Behavior.DODGE && this.behavior !== Behavior.DODGE) this.startDodge(world);
    if (d.behavior === Behavior.GRAB && (this.behavior !== Behavior.GRAB || d.target !== this.target)) this.stats.grabStarts++;
    if (d.behavior === Behavior.USE_OBJECT && d.object !== this.object) {
      this.object = d.object;
      this.objectStart = world.time;
    }
    if (d.behavior !== Behavior.USE_OBJECT && this.behavior === Behavior.USE_OBJECT) this.endObjectCombo(world);
    if (d.target !== this.target) this.targetUntil = Math.max(this.targetUntil, world.time + AI.targetHoldTime);
    this.behavior = d.behavior;
    this.target = d.target;
    this.flank = d.flank;
    this.useAttract = d.useAttract;
  }

  /**
   * WARNING only matters when the AI is heading (or being pushed) toward the edge, and not while it
   * is deliberately crossing to another platform (bridges are always WARNING, §20).
   */
  private movingOutward(world: AIWorld, target: Character | null): boolean {
    const self = this.self;
    const arena = world.arena;
    const here = arena.edgeInfo(self.position.x, self.position.z).platform;
    if (!here || here.kind === "bridge") return false;
    if (target && arena.edgeInfo(target.position.x, target.position.z).platform !== here) return false;
    if (this.behavior === Behavior.WANDER && this.hasWanderPoint && arena.edgeInfo(this.wanderX, this.wanderZ).platform !== here) return false;
    arena.outwardDir(self.position.x, self.position.z, this.outward);
    self.body.getLinearVelocityToRef(tmpVel);
    const m = self.input.moveDir;
    return tmpVel.x * this.outward.x + tmpVel.z * this.outward.z > AI.warningOutwardSpeed
      || m.x * this.outward.x + m.z * this.outward.z > 0.1;
  }

  /** An opponent within range facing this AI with repulse ready (AGENTS.md §23). */
  private findThreat(): Character | null {
    const self = this.self;
    for (const c of this.perceived) {
      if (c.repulseCooldown > 0) continue;
      const dx = self.position.x - c.position.x;
      const dz = self.position.z - c.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > AI.dodgeThreatRange || dist < 0.01) continue;
      const cos = (dx * Math.sin(c.input.aimYaw) + dz * Math.cos(c.input.aimYaw)) / dist;
      if (cos >= Math.cos(AI.dodgeFacingDeg * DEG)) return c;
    }
    return null;
  }

  private startDodge(world: AIWorld): void {
    const self = this.self;
    const threat = this.findThreat();
    let tx = 0;
    let tz = 1;
    if (threat) {
      tx = self.position.x - threat.position.x;
      tz = self.position.z - threat.position.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
    }
    // Perpendicular; pick the side that points more toward the arena center.
    let px = tz;
    let pz = -tx;
    if (px * -self.position.x + pz * -self.position.z < 0) {
      px = -px;
      pz = -pz;
    }
    this.dodgeX = px;
    this.dodgeZ = pz;
    this.dodgeTimer = AI.dodgeDuration;
    if (world.rng.chance(AI.dodgeJumpChance)) self.input.jump = true;
  }

  private endObjectCombo(world: AIWorld): void {
    this.object = null;
    this.objectCooldownUntil = world.time + AI.objectComboCooldown;
  }

  // ---------------------------------------------------------------- behaviors

  private wander(world: AIWorld): void {
    const self = this.self;
    if (!this.hasWanderPoint || Math.hypot(this.wanderX - self.position.x, this.wanderZ - self.position.z) < 1.5) {
      // Anywhere on the arena (by platform area), so fights also happen near the smaller platforms' edges.
      for (let i = 0; i < AI.wanderPickTries; i++) {
        world.arena.randomPoint(world.rng, AI.wanderEdgeMargin, AI.wanderRadius, this.wanderPoint);
        this.wanderX = this.wanderPoint.x;
        this.wanderZ = this.wanderPoint.z;
        if (!world.arena.isObstructed(this.wanderX, this.wanderZ, AI.wanderObstacleMargin)) break;
      }
      this.hasWanderPoint = true;
    }
    steerTo(self, world, this.wanderX, this.wanderZ);
    const m = self.input.moveDir;
    if (m.lengthSquared() > 0.01) self.input.aimYaw = yawOf(m.x, m.z);
  }

  private attack(world: AIWorld): void {
    const self = this.self;
    const t = this.target;
    if (!t || !t.alive) {
      this.behavior = Behavior.WANDER;
      this.decisionTimer = 0;
      return;
    }
    const input = self.input;
    const dx = t.position.x - self.position.x;
    const dz = t.position.z - self.position.z;
    const dist = Math.hypot(dx, dz);

    let flankX = 0;
    let flankZ = 0;
    let flank = this.flank;
    if (flank) {
      // Stand on the side of the target opposite its nearest edge, then push it outward.
      // A target on a bridge is flanked along the bridge axis (the sideways point is over the void).
      const tp = world.arena.edgeInfo(t.position.x, t.position.z).platform;
      if (tp && tp.kind === "bridge") {
        this.outward.x = tp.axisX;
        this.outward.z = tp.axisZ;
      } else {
        world.arena.outwardDir(t.position.x, t.position.z, this.outward);
      }
      flankX = t.position.x - this.outward.x * AI.flankDistance;
      flankZ = t.position.z - this.outward.z * AI.flankDistance;
      // Never walk to a flank point that is over the void or right at an edge: approach directly instead.
      if (world.arena.edgeInfo(flankX, flankZ).distance < AI.dangerEdge
        || world.arena.isObstructed(flankX, flankZ, AI.wanderObstacleMargin)) flank = false;
    }
    // No standoffs on a walkway (holding a 6–10 unit band along a narrow axis makes the AI jitter in place):
    // cross to the entry point on the target's side first. nextWaypoint returns that point.
    const here = world.arena.edgeInfo(self.position.x, self.position.z).platform;
    const onWalkway = here !== null && here.kind === "bridge"
      && world.arena.edgeInfo(t.position.x, t.position.z).platform !== here;

    if (onWalkway && !flank) {
      steerTo(self, world, t.position.x, t.position.z);
    } else if (flank) {
      const toFlank = steerTo(self, world, flankX, flankZ);
      input.sprint = toFlank > 4;
      if (toFlank < 2.5) addStrafe(self, dx, dz, this.strafeDir, 0.3);
    } else if (dist > AI.attackMaxDist) {
      steerTo(self, world, t.position.x, t.position.z);
      input.sprint = dist > 14;
    } else if (dist < AI.attackMinDist) {
      const l = dist || 1;
      input.moveDir.set((-dx / l) * 0.5, 0, (-dz / l) * 0.5);
      addStrafe(self, dx, dz, this.strafeDir, 0.6 + this.personality.randomness * 0.4);
    } else {
      input.moveDir.set(0, 0, 0);
      addStrafe(self, dx, dz, this.strafeDir, 0.6 + this.personality.randomness * 0.4);
    }

    if (this.zone === EdgeZone.WARNING) addCentering(self, world, this.personality.edgeCaution * 0.6);

    aimAt(self, t.position.x, t.position.z, this.aimError);
    this.useMagnetOn(dist, t.ragdolled, world);
  }

  /** Attract to pull a ragdolled target in, repulse when close or when holding something. */
  private useMagnetOn(dist: number, targetRagdolled: boolean, world: AIWorld): void {
    const self = this.self;
    const input = self.input;
    const holding = this.isHoldingAnything(world);
    if (holding) {
      input.attract = true;
      if (dist <= AI.repulseHeldRange && this.canLaunch(world)) input.repulse = true;
      return;
    }
    if (dist <= AI.repulseCloseRange && this.canRepulse(world) && this.wantsRepulse) {
      input.repulse = true;
      return;
    }
    const canAttract = self.attracting ? self.power > 0 : self.power >= POWER.restartThreshold;
    // Only a ragdolled character can be attracted (AGENTS.md §8.1).
    if (targetRagdolled && this.useAttract && canAttract && world.time >= this.attractReadyAt && dist <= ATTRACT.range && dist > 3) {
      input.attract = true;
    }
  }

  private isHoldingAnything(world: AIWorld): boolean {
    return this.isHoldingObject(world) || this.heldCharacter(world) !== null;
  }

  private isHoldingObject(world: AIWorld): boolean {
    for (const o of world.objects) if (o.heldBy === this.self) return true;
    return false;
  }

  private heldCharacter(world: AIWorld): Character | null {
    for (const c of world.characters) if (c.heldBy === this.self) return c;
    return null;
  }

  private retreat(world: AIWorld): void {
    const self = this.self;
    const info = world.arena.edgeInfo(self.position.x, self.position.z);
    const p = info.platform;
    if (p && p.kind === "hub") {
      // Move radially inward from where we are, so retreating AIs spread out instead of piling up at the center.
      const rx = self.position.x - p.cx;
      const rz = self.position.z - p.cz;
      const r = Math.hypot(rx, rz);
      const k = r > AI.retreatRadius ? AI.retreatRadius / r : 1;
      steerTo(self, world, p.cx + rx * k, p.cz + rz * k);
    } else if (p && p.kind === "bridge") {
      // Never head for a far platform from a walkway (the straight line leads off it sideways).
      const end = world.arena.nearerEnd(p, self.position.x, self.position.z);
      steerTo(self, world, end.cx, end.cz);
    } else if (p) {
      steerTo(self, world, p.cx, p.cz);
    } else {
      world.arena.clampToPlatform(self.position.x, self.position.z, 2, this.outward);
      steerTo(self, world, this.outward.x, this.outward.z);
    }
    self.input.sprint = true;
    const m = self.input.moveDir;
    if (m.lengthSquared() > 0.01) self.input.aimYaw = yawOf(m.x, m.z);

    // Self-defense: shove anyone right next to us.
    for (const c of this.perceived) {
      if (!c.alive) continue;
      const d = Math.hypot(c.position.x - self.position.x, c.position.z - self.position.z);
      if (d < 3 && this.canRepulse(world) && this.wantsRepulse) {
        aimAt(self, c.position.x, c.position.z, this.aimError);
        self.input.repulse = true;
        break;
      }
    }
  }

  private dodge(dt: number): void {
    const self = this.self;
    this.dodgeTimer -= dt;
    self.input.moveDir.set(this.dodgeX, 0, this.dodgeZ);
    self.input.sprint = true;
    if (this.dodgeTimer <= 0) {
      this.behavior = this.target ? Behavior.ATTACK : Behavior.WANDER;
      this.decisionTimer = 0;
    }
  }

  private useObject(world: AIWorld): void {
    const self = this.self;
    const o = this.object;
    const t = this.target;
    const timedOut = world.time - this.objectStart > AI.objectComboTimeout;
    if (!o || !o.alive || !t || !t.alive || (o.heldBy && o.heldBy !== self) || timedOut) {
      this.endObjectCombo(world);
      this.behavior = t && t.alive ? Behavior.ATTACK : Behavior.WANDER;
      this.decisionTimer = 0;
      return;
    }
    const input = self.input;
    if (o.heldBy === self) {
      this.throwHeld(t, world);
      return;
    }
    const dist = Math.hypot(o.position.x - self.position.x, o.position.z - self.position.z);
    if (dist > AI.objectApproachDist) {
      steerTo(self, world, o.position.x, o.position.z);
      input.sprint = dist > ATTRACT.range;
    } else {
      addStrafe(self, o.position.x - self.position.x, o.position.z - self.position.z, this.strafeDir, AI.idleStrafe);
    }
    aimAt(self, o.position.x, o.position.z, this.aimError * 0.5);
    if (dist <= ATTRACT.range - 0.5 && this.canAttract(world)) input.attract = true;
  }

  /**
   * Holding an object: get on the far side of the target from its nearest void when that void is close enough
   * for the hit to drive it off (edge-line throw), close in, and launch at the target's intercept point.
   * The combo ends once the repulse fires.
   */
  private throwHeld(t: Character, world: AIWorld): void {
    const self = this.self;
    const input = self.input;
    input.attract = true;
    const dist = Math.hypot(t.position.x - self.position.x, t.position.z - self.position.z);
    const lowPower = self.power < AI.throwLowPower;

    let lined = true;
    let spotX = t.position.x;
    let spotZ = t.position.z;
    const voidDist = this.targetVoid(t, world);
    if (!lowPower && voidDist >= 0 && voidDist <= AI.throwKillReach * t.stabilityMultiplier + AI.throwLineSlack) {
      spotX = t.position.x - this.voidDir.x * AI.throwStandoff;
      spotZ = t.position.z - this.voidDir.z * AI.throwStandoff;
      if (this.isStandable(world, spotX, spotZ)) lined = this.linedUp(t, dist);
      else {
        spotX = t.position.x;
        spotZ = t.position.z;
      }
    }

    const inRange = dist <= AI.throwRange || (lowPower && dist <= AI.repulseHeldRange);
    if (!lined) {
      const toSpot = steerTo(self, world, spotX, spotZ);
      input.sprint = toSpot > 3;
    } else if (!inRange) {
      steerTo(self, world, t.position.x, t.position.z);
      input.sprint = dist > AI.repulseHeldRange;
    }
    this.aimIntercept(t, AI.throwAimErrorScale);
    if (lined && inRange && this.canLaunch(world)) input.repulse = true;
  }

  /** Aims at where a launched projectile meets `t` (launch speed includes this AI's perk). */
  private aimIntercept(t: Character, errorScale: number): void {
    const self = this.self;
    t.body.getLinearVelocityToRef(tmpVel);
    interceptPoint(self.position.x, self.position.z, t.position.x, t.position.z, tmpVel.x, tmpVel.z,
      REPULSE.launchSpeed * self.perks.launch, this.aimPoint);
    aimAt(self, this.aimPoint.x, this.aimPoint.z, this.aimError * errorScale);
  }

  /** True when the direction from this AI to `t` points (within AI.throwLineDeg) at t's nearest void. */
  private linedUp(t: Character, dist: number): boolean {
    if (dist < 0.01) return false;
    const self = this.self;
    const cos = ((t.position.x - self.position.x) * this.voidDir.x + (t.position.z - self.position.z) * this.voidDir.z) / dist;
    return cos >= Math.cos(AI.throwLineDeg * DEG);
  }

  /** A point an AI can stand on: on a platform, clear of its edge and of obstacles. */
  private isStandable(world: AIWorld, x: number, z: number): boolean {
    const info = world.arena.edgeInfo(x, z);
    return info.platform !== null && info.distance >= AI.edgeGuardDistance && !world.arena.isObstructed(x, z, AI.wanderObstacleMargin);
  }

  /** Distance from `t` to its nearest reachable void (direction in this.voidDir), cached per target; −1 if none. */
  private targetVoid(t: Character, world: AIWorld): number {
    if (this.voidFor !== t || world.time >= this.voidAt) {
      this.voidFor = t;
      this.voidAt = world.time + AI.dropDirRefresh;
      this.voidDist = findDropDirection(world.arena, t.position.x, t.position.z, this.voidDir);
    }
    return this.voidDist;
  }

  /**
   * Finisher: repulse ready and a ragdolled opponent (not held) near a void: line up on its far side and
   * repulse it off (a ragdoll takes RAGDOLL.knockbackMultiplier). Returns false when it does not apply.
   */
  private finish(t: Character, dist: number, world: AIWorld): boolean {
    if (t.heldBy || !this.canLaunch(world)) return false;
    const voidDist = this.targetVoid(t, world);
    if (voidDist < 0 || voidDist > AI.finishReach * t.stabilityMultiplier) return false;
    const spotX = t.position.x - this.voidDir.x * AI.finishStandoff;
    const spotZ = t.position.z - this.voidDir.z * AI.finishStandoff;
    if (!this.isStandable(world, spotX, spotZ)) return false;
    const self = this.self;
    const input = self.input;
    const lined = this.linedUp(t, dist);
    if (!lined || dist > AI.finishFireDist) {
      const toSpot = steerTo(self, world, spotX, spotZ);
      input.sprint = toSpot > 3;
    }
    aimAt(self, t.position.x, t.position.z, this.aimError * AI.throwAimErrorScale);
    if (lined && dist <= AI.finishFireDist) input.repulse = true;
    return true;
  }

  private canAttract(world: AIWorld): boolean {
    const self = this.self;
    const powerOk = self.attracting ? self.power > 0 : self.power >= POWER.restartThreshold;
    return powerOk && world.time >= this.attractReadyAt;
  }

  /** GRAB: pull a ragdolled opponent into the magnet, then carry it off (AGENTS.md §19, §24.1). */
  private grab(world: AIWorld): void {
    const self = this.self;
    const t = this.target;
    if (!t || !t.alive || !t.ragdolled || (t.heldBy && t.heldBy !== self)) {
      this.behavior = t && t.alive ? Behavior.ATTACK : Behavior.WANDER;
      this.decisionTimer = 0;
      return;
    }
    if (t.heldBy === self) {
      this.carry(t, world);
      return;
    }
    this.lastCarried = null;
    const input = self.input;
    const dist = Math.hypot(t.position.x - self.position.x, t.position.z - self.position.z);
    if (this.finish(t, dist, world)) return;
    if (dist > AI.grabApproachDist) {
      steerTo(self, world, t.position.x, t.position.z);
      input.sprint = dist > ATTRACT.range * 0.6;
    }
    aimAt(self, t.position.x, t.position.z, this.aimError * AI.throwAimErrorScale);
    if (dist <= ATTRACT.range && this.canAttract(world)) input.attract = true;
  }

  /**
   * Holding a ragdolled opponent: throw it toward the nearest void when repulse is ready and the void is close
   * enough, otherwise walk it to the void and let go once it hangs over it.
   */
  private carry(t: Character, world: AIWorld): void {
    const self = this.self;
    const input = self.input;
    this.carrying = true;
    input.attract = true;
    if (this.lastCarried !== t) {
      this.lastCarried = t;
      this.stats.grabs++;
      this.dropDirAt = 0;
    }
    if (world.time >= this.dropDirAt) {
      this.dropDirAt = world.time + AI.dropDirRefresh;
      this.dropDist = findDropDirection(world.arena, self.position.x, self.position.z, this.dropDir);
      if (this.dropDist < 0) {
        world.arena.outwardDir(self.position.x, self.position.z, this.dropDir);
        this.dropDist = Math.max(0, world.arena.edgeInfo(self.position.x, self.position.z).distance);
      }
    }
    const dir = this.dropDir;
    input.aimYaw = yawOf(dir.x, dir.z);

    // Let go once it hangs far enough out over the void: it falls, and the pull already gave us the credit.
    if (world.arena.edgeInfo(t.position.x, t.position.z).platform === null) {
      world.arena.clampToPlatform(t.position.x, t.position.z, 0, this.outward);
      if (Math.hypot(t.position.x - this.outward.x, t.position.z - this.outward.z) >= AI.dropOverhang) {
        input.attract = false;
        this.stats.drops++;
        this.lastCarried = null;
        this.behavior = Behavior.ATTACK;
        this.decisionTimer = 0;
        return;
      }
    }
    if (this.dropDist <= AI.throwVoidRange && this.canLaunch(world)) {
      input.repulse = true;
      return;
    }
    const walk = this.dropDist - AI.carryStandoff;
    if (walk > 0.3) {
      steerTo(self, world, self.position.x + dir.x * walk, self.position.z + dir.z * walk);
      input.sprint = walk > 3;
      input.aimYaw = yawOf(dir.x, dir.z); // steerTo does not aim, but keep facing the void while walking
    }
  }
}
