import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CHARACTER, MOVE, NO_PERKS, POWER, RAGDOLL, STABILITY, type MagnetPerks } from "../config";
import { clampHorizontal, lerpAngle, moveTowardsXZ, smoothFactor, yawOf } from "../util/math";
import { AnimState, CharacterVisual } from "./CharacterVisual";
import { GroundQuery } from "./GroundQuery";

/** What a controller (keyboard/mouse or AI) asks the character to do (AGENTS.md §16). */
export interface CharacterInput {
  moveDir: Vector3; // horizontal, length 0..1
  sprint: boolean;
  jump: boolean; // request, consumed by the character
  attract: boolean;
  repulse: boolean; // request, consumed by the magnet system
  aimYaw: number; // radians, yaw 0 faces +Z
}

export interface CharacterOptions {
  id: number;
  name: string;
  isPlayer: boolean;
  color: string;
  position: Vector3;
  yaw: number;
}


export class Character {
  readonly id: number;
  readonly name: string;
  readonly isPlayer: boolean;
  readonly color: string;
  readonly mesh: Mesh; // invisible physics capsule; position = body center
  readonly aggregate: PhysicsAggregate;
  readonly visual: CharacterVisual;
  readonly nameAnchor: TransformNode;
  readonly mass = CHARACTER.mass;
  readonly radius = CHARACTER.radius;

  readonly input: CharacterInput = {
    moveDir: new Vector3(),
    sprint: false,
    jump: false,
    attract: false,
    repulse: false,
    aimYaw: 0,
  };

  alive = true;
  /** False during the countdown and after the match ends. */
  controlEnabled = false;
  grounded = false;

  stability: number = STABILITY.max;
  power: number = POWER.max;
  repulseCooldown = 0;
  attracting = false;
  /** Magnet perks: NO_PERKS for the player, the difficulty's aiPerks for AI. */
  perks: MagnetPerks = NO_PERKS;

  knockbackTimer = 0;
  /** Bounce-pad flight (not a hit): seconds left, movement control, launch velocity and grounded lock. */
  private flightTimer = 0;
  private flightControl = 1;
  private flightVx = 0;
  private flightVz = 0;
  private flightGroundLock = 0;
  /** Set by the magnet system every frame this character is being pulled. */
  pulled = false;
  /** Character whose magnet is holding this one. */
  heldBy: Character | null = null;
  /** Seconds of ragdoll left (AGENTS.md §24.1): no control, can be attracted, extra knockback. */
  ragdollTimer = 0;
  /** Timestamps (match time) until which a given attacker may not pull or grab this character. */
  readonly regrabLockUntil = new Map<Character, number>();
  /** Per-projectile cooldown for stability hits (AGENTS.md §24). */
  readonly hitCooldowns = new Map<unknown, number>();

  facingYaw: number;
  repulseAnimTimer = 0;
  /** Most recent character to knock this one around (for credit/notifications). */
  lastHitBy: Character | null = null;
  /** Debug: cause and strength of the most recent knockback. */
  lastHitKind = "";

  private readonly velocity = new Vector3();
  private readonly ray = new Ray(Vector3.Zero(), Vector3.Down(), 1);
  private readonly ground: GroundQuery;
  private wasGrounded = false;
  landedThisFrame = false;
  /** Last position where the character stood on something (debug / playtest tracing). */
  readonly lastGroundPos = new Vector3();
  jumpedThisFrame = false;

  constructor(scene: Scene, shadows: ShadowGenerator, opts: CharacterOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.isPlayer = opts.isPlayer;
    this.color = opts.color;
    this.ground = GroundQuery.for(scene);
    this.facingYaw = opts.yaw;
    this.input.aimYaw = opts.yaw;

    this.mesh = CreateCapsule(`char-${opts.name}`, { radius: CHARACTER.radius, height: CHARACTER.height, tessellation: 8 }, scene);
    this.mesh.isVisible = false;
    this.mesh.isPickable = false;
    this.mesh.position.copyFrom(opts.position);
    this.mesh.metadata = { character: this };

    this.aggregate = new PhysicsAggregate(this.mesh, PhysicsShapeType.CAPSULE, { mass: CHARACTER.mass, friction: 0, restitution: 0 }, scene);
    this.aggregate.body.setMassProperties({ mass: CHARACTER.mass, inertia: Vector3.Zero() });
    this.aggregate.body.setAngularDamping(1);

    this.visual = new CharacterVisual(scene, this.mesh, opts.color, opts.isPlayer, shadows);
    this.visual.root.rotation.y = opts.yaw;

    this.nameAnchor = new TransformNode(`anchor-${opts.name}`, scene);
    this.nameAnchor.parent = this.mesh;
    this.nameAnchor.position.y = CHARACTER.nameplateOffset;
  }

  get body(): PhysicsBody {
    return this.aggregate.body;
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  /** Movement multiplier from knockback / being pulled / being held. */
  get ragdolled(): boolean {
    return this.ragdollTimer > 0;
  }

  /** Starts a ragdoll. A character that is already ragdolled keeps its current timer (no extension). */
  startRagdoll(): void {
    if (this.alive && !this.ragdolled) this.ragdollTimer = RAGDOLL.duration;
  }

  get controlFactor(): number {
    if (!this.controlEnabled || this.heldBy || this.ragdolled) return 0;
    if (this.knockbackTimer > 0 || this.pulled) return MOVE.knockbackControl;
    if (this.flightTimer > 0) return this.flightControl;
    return 1;
  }

  get stabilityMultiplier(): number {
    return 1 + STABILITY.extraKnockback * (STABILITY.max - this.stability) / STABILITY.max;
  }

  getVelocity(out: Vector3): Vector3 {
    this.body.getLinearVelocityToRef(out);
    return out;
  }

  setVelocity(v: Vector3): void {
    this.body.setLinearVelocity(v);
  }

  /** Adds a velocity change scaled by the stability multiplier and starts knockback (AGENTS.md §12, §24). */
  applyKnockback(dv: Vector3, attacker: Character | null, stabilityLoss: number, kind = "repulse"): void {
    if (!this.alive) return;
    const mult = this.stabilityMultiplier * (this.ragdolled ? RAGDOLL.knockbackMultiplier : 1);
    this.lastHitKind = `${kind}:${Math.round(Math.hypot(dv.x, dv.z) * mult)}`;
    this.body.getLinearVelocityToRef(this.velocity);
    // Only horizontal speed scales with stability; scaling lift too would square the flight distance.
    this.velocity.addInPlaceFromFloats(dv.x * mult, dv.y, dv.z * mult);
    clampHorizontal(this.velocity, MOVE.maxHorizontalSpeed);
    this.body.setLinearVelocity(this.velocity);
    this.knockbackTimer = MOVE.knockbackDuration;
    this.stability = Math.max(0, this.stability - stabilityLoss);
    this.grounded = false;
    if (attacker) this.lastHitBy = attacker;
  }

  /**
   * Bounce-pad launch: sets the velocity and lowers movement control for the flight. Not a hit:
   * no stability loss, no knockback state, hit credit (lastHitBy) untouched. The flight ends on
   * landing, on a knockback, or when a magnet grabs the character.
   */
  launch(v: Vector3, flightTime: number, control: number, groundLock: number): void {
    if (!this.alive) return;
    this.body.setLinearVelocity(v);
    this.knockbackTimer = 0;
    this.flightTimer = flightTime;
    this.flightControl = control;
    this.flightVx = v.x;
    this.flightVz = v.z;
    this.flightGroundLock = groundLock;
    this.grounded = false;
  }

  private checkGrounded(): boolean {
    const r = this.ray;
    r.origin.copyFrom(this.mesh.position);
    r.length = CHARACTER.height / 2 + MOVE.groundRayExtra;
    return this.ground.hit(r);
  }

  /** Movement, jumping and timers. Runs every frame before physics. */
  update(dt: number): void {
    if (!this.alive) {
      this.visual.update(dt, AnimState.ELIMINATED, false, false, 0);
      return;
    }

    if (this.knockbackTimer > 0) this.knockbackTimer = Math.max(0, this.knockbackTimer - dt);
    if (this.ragdollTimer > 0) this.ragdollTimer = Math.max(0, this.ragdollTimer - dt);
    if (this.repulseCooldown > 0) this.repulseCooldown = Math.max(0, this.repulseCooldown - dt);
    if (this.repulseAnimTimer > 0) this.repulseAnimTimer = Math.max(0, this.repulseAnimTimer - dt);
    this.stability = Math.min(STABILITY.max, this.stability + STABILITY.regenPerSec * dt);
    if (this.flightTimer > 0) {
      this.flightTimer = this.knockbackTimer > 0 || this.pulled || this.heldBy ? 0 : Math.max(0, this.flightTimer - dt);
      this.flightGroundLock = Math.max(0, this.flightGroundLock - dt);
    }

    this.wasGrounded = this.grounded;
    this.grounded = this.knockbackTimer > MOVE.knockbackDuration - 0.1 || (this.flightTimer > 0 && this.flightGroundLock > 0)
      ? false
      : this.checkGrounded();
    if (this.grounded) this.flightTimer = 0; // landed
    this.landedThisFrame = this.grounded && !this.wasGrounded;
    if (this.grounded) this.lastGroundPos.copyFrom(this.mesh.position);
    this.jumpedThisFrame = false;

    this.body.getLinearVelocityToRef(this.velocity);
    if (clampHorizontal(this.velocity, MOVE.maxHorizontalSpeed)) this.body.setLinearVelocity(this.velocity);
    const control = this.controlFactor;
    const input = this.input;

    if (control > 0) {
      const speed = input.sprint ? MOVE.sprintSpeed : MOVE.walkSpeed;
      const accel = MOVE.groundAccel * (this.grounded ? 1 : MOVE.airAccelFactor) * control;
      const moving = input.moveDir.lengthSquared() > 0.0001;
      if (this.flightTimer > 0) {
        // Pad flight: steer relative to the launch velocity, so a held key nudges the landing
        // point instead of braking the arc down to walking speed.
        moveTowardsXZ(this.velocity, this.flightVx + input.moveDir.x * speed * control, this.flightVz + input.moveDir.z * speed * control, accel * dt);
      } else if (moving || this.grounded) {
        // In the air without input, keep momentum so knockbacks carry the character.
        moveTowardsXZ(this.velocity, input.moveDir.x * speed, input.moveDir.z * speed, accel * dt);
      }
      if (input.jump && this.grounded && this.velocity.y < 1) {
        this.velocity.y = MOVE.jumpVelocity;
        this.grounded = false;
        this.jumpedThisFrame = true;
      }
      this.body.setLinearVelocity(this.velocity);
    } else if (this.grounded && !this.heldBy && !this.pulled) {
      // Frictionless capsules would slide forever with control disabled (countdown, end screens).
      // Same braking a controlled character without input gets, so knockback and pulls behave the same.
      const brake = this.knockbackTimer > 0 ? MOVE.knockbackControl : 1;
      moveTowardsXZ(this.velocity, 0, 0, MOVE.groundAccel * brake * dt);
      this.body.setLinearVelocity(this.velocity);
    }
    input.jump = false;

    // Facing: aim while using the magnet, otherwise movement direction.
    let targetYaw = this.facingYaw;
    if (this.ragdolled) {
      // A limp body does not turn.
    } else if (this.attracting || this.repulseAnimTimer > 0) {
      targetYaw = input.aimYaw;
    } else if (input.moveDir.lengthSquared() > 0.01 && control > 0) {
      targetYaw = yawOf(input.moveDir.x, input.moveDir.z);
    }
    this.facingYaw = lerpAngle(this.facingYaw, targetYaw, smoothFactor(MOVE.turnSpeed, dt));
    this.visual.root.rotation.y = this.facingYaw;

    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    let state: AnimState;
    if (this.ragdolled) state = AnimState.RAGDOLL;
    else if (this.knockbackTimer > 0 || this.heldBy) state = AnimState.KNOCKBACK;
    else if (!this.grounded) state = AnimState.AIR;
    else if (hSpeed > 0.5) state = AnimState.MOVE;
    else state = AnimState.IDLE;
    this.visual.update(dt, state, this.attracting, this.repulseAnimTimer > 0, hSpeed);
  }

  dispose(): void {
    this.alive = false;
    this.heldBy = null;
    this.ragdollTimer = 0;
    this.regrabLockUntil.clear();
    this.hitCooldowns.clear();
    this.visual.dispose();
    this.nameAnchor.dispose();
    this.aggregate.dispose();
    this.mesh.dispose();
  }
}
