import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsEventType, PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { ARENA, COLORS, OBJECTS, WORLD } from "../config";
import { clampHorizontal } from "../util/math";
import { createMetalPlateTexture } from "./ArenaTexturePaint";
import type { Character } from "../character/Character";

export type MagneticKind = "crate" | "barrel" | "ball" | "block" | "anvil" | "springBall";

interface KindSpec {
  mass: number;
  heavy: boolean;
  /** Approximate radius used for hit detection. */
  radius: number;
  /** Half the resting height: spawn height above the platform surface. */
  halfHeight: number;
  restitution: number;
  shape: PhysicsShapeType;
}

const ANVIL = OBJECTS.anvil;
const SPRING = OBJECTS.springBall;

const KIND_SPECS: Record<MagneticKind, KindSpec> = {
  crate: { mass: 2, heavy: false, radius: 0.6, halfHeight: 0.5, restitution: OBJECTS.restitution, shape: PhysicsShapeType.BOX },
  barrel: { mass: 1.5, heavy: false, radius: 0.55, halfHeight: 0.6, restitution: OBJECTS.restitution, shape: PhysicsShapeType.CYLINDER },
  ball: { mass: 1, heavy: false, radius: 0.5, halfHeight: 0.5, restitution: OBJECTS.restitution, shape: PhysicsShapeType.SPHERE },
  block: { mass: 6, heavy: true, radius: 1.1, halfHeight: 1, restitution: OBJECTS.restitution, shape: PhysicsShapeType.BOX },
  anvil: {
    mass: ANVIL.mass, heavy: true, radius: ANVIL.hitRadius, halfHeight: ANVIL.size[1] / 2,
    restitution: OBJECTS.restitution, shape: PhysicsShapeType.BOX,
  },
  springBall: {
    mass: SPRING.mass, heavy: false, radius: SPRING.hitRadius, halfHeight: SPRING.diameter / 2,
    restitution: SPRING.restitution, shape: PhysicsShapeType.SPHERE,
  },
};

/**
 * Fixed spawn list (arena expansion spec §4): hub 10, cardinal platforms 2 each, SE scrapyard 3,
 * NE/SW/NW islands 1 each. Every point is ≥ 2 from obstacles and bounce pads, ≥ 1.5 from character
 * spawns, and ≥ 1.5 inside its platform rim. Island props sit off-center on the side away from the hub.
 */
export const OBJECT_SPAWNS: { kind: MagneticKind; x: number; z: number }[] = [
  // hub
  { kind: "block", x: 0, z: 0 },
  { kind: "crate", x: 8, z: 10 },
  { kind: "crate", x: 1, z: -9 },
  { kind: "crate", x: -15, z: 6 },
  { kind: "barrel", x: -8, z: -11 },
  { kind: "barrel", x: -8, z: 11 },
  { kind: "ball", x: -2, z: 9 },
  { kind: "ball", x: 15, z: -9 },
  { kind: "anvil", x: 10, z: 2 },
  { kind: "springBall", x: 6, z: -11 },
  // cardinal platforms: one on the outer half, one on the hub side between the spoke and the catwalks
  { kind: "crate", x: 3.5, z: -37 },
  { kind: "springBall", x: -3, z: -29.5 },
  { kind: "block", x: -3.5, z: 37 },
  { kind: "barrel", x: 3, z: 29.5 },
  { kind: "anvil", x: 37, z: 3.5 },
  { kind: "crate", x: 29.5, z: -3 },
  { kind: "barrel", x: -37, z: -3.5 },
  { kind: "ball", x: -29.5, z: 3 },
  // SE scrapyard (center (24, 24)): hub side, clear of the scrap piles on the outward half
  { kind: "crate", x: 21.8, z: 22.4 },
  { kind: "crate", x: 24.6, z: 21.2 },
  { kind: "barrel", x: 21.2, z: 24.8 },
  // NE, SW, NW islands: beside the theme pieces, off the pad landing point at the center
  { kind: "springBall", x: 24, z: -27.5 },
  { kind: "ball", x: -21.6, z: 25 },
  { kind: "crate", x: -22, z: -22 },
];

export class MagneticObject {
  readonly mass: number;
  readonly heavy: boolean;
  readonly radius: number;
  /** Character currently holding this object with attract, if any. */
  heldBy: Character | null = null;
  /** Character that last launched this object with repulse; its magnet ignores the object until launchLockUntil. */
  launchedBy: Character | null = null;
  launchLockUntil = 0;
  alive = true;

  constructor(
    readonly kind: MagneticKind,
    readonly mesh: Mesh,
    readonly aggregate: PhysicsAggregate,
    readonly spawnIndex: number,
  ) {
    const spec = KIND_SPECS[kind];
    this.mass = spec.mass;
    this.heavy = spec.heavy;
    this.radius = spec.radius;
  }

  get body(): PhysicsBody {
    return this.aggregate.body;
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  dispose(): void {
    this.alive = false;
    this.heldBy = null;
    this.aggregate.dispose();
    this.mesh.dispose();
  }
}

export class ArenaObjects {
  readonly objects: MagneticObject[] = [];
  private readonly v = new Vector3();
  private readonly respawnTimers: { index: number; time: number }[] = [];
  private readonly templates: Record<MagneticKind, Mesh>;
  private readonly metal: StandardMaterial;
  private readonly metalDark: StandardMaterial;
  private readonly anvilMat: StandardMaterial;
  private readonly springMat: StandardMaterial;
  private readonly springTex: DynamicTexture;
  private readonly metalTex: DynamicTexture;
  /** Metal collision sound hook: (position, approximate impact speed). */
  onImpact: ((position: Vector3, speed: number) => void) | null = null;

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator) {
    this.metal = new StandardMaterial("metal", scene);
    this.metal.diffuseColor = Color3.FromHexString(COLORS.metal);
    this.metal.specularColor = new Color3(0.9, 0.9, 0.95);
    this.metal.specularPower = 48;
    this.metal.emissiveColor = Color3.FromHexString(COLORS.metalEmissive);

    this.metalDark = this.metal.clone("metal-dark");
    this.metalDark.diffuseColor = Color3.FromHexString(COLORS.metal).scale(0.65);

    this.anvilMat = this.metal.clone("metal-anvil");
    this.anvilMat.diffuseColor = Color3.FromHexString(ANVIL.color);
    this.anvilMat.emissiveColor = Color3.FromHexString(ANVIL.emissive);

    this.springMat = this.metal.clone("metal-spring");
    this.springMat.diffuseColor = Color3.White();
    this.springMat.emissiveColor = Color3.FromHexString(SPRING.emissive);
    this.springTex = createStripeTexture(scene);
    this.springMat.diffuseTexture = this.springTex;
    // Riveted plates on every metal prop (set after cloning so the clones share one texture).
    this.metalTex = createMetalPlateTexture(scene);
    for (const m of [this.metal, this.metalDark, this.anvilMat]) m.diffuseTexture = this.metalTex;

    this.templates = {
      crate: CreateBox("tpl-crate", { size: 1 }, scene),
      barrel: CreateCylinder("tpl-barrel", { diameter: 0.8, height: 1.2, tessellation: 12 }, scene),
      ball: CreateSphere("tpl-ball", { diameter: 1, segments: 10 }, scene),
      block: CreateBox("tpl-block", { size: 2 }, scene),
      anvil: createAnvilMesh(scene),
      springBall: CreateSphere("tpl-springBall", { diameter: SPRING.diameter, segments: 10 }, scene),
    };
    this.templates.crate.material = this.metal;
    this.templates.barrel.material = this.metalDark;
    this.templates.ball.material = this.metal;
    this.templates.block.material = this.metalDark;
    this.templates.anvil.material = this.anvilMat;
    this.templates.springBall.material = this.springMat;
    for (const t of Object.values(this.templates)) t.setEnabled(false);
  }

  /** Disposes every object and recreates all of them at their spawns. */
  reset(): void {
    for (const o of this.objects) o.dispose();
    this.objects.length = 0;
    this.respawnTimers.length = 0;
    OBJECT_SPAWNS.forEach((_, i) => this.spawn(i));
  }

  private spawn(index: number): void {
    const spec = OBJECT_SPAWNS[index];
    const kindSpec = KIND_SPECS[spec.kind];
    const mesh = this.templates[spec.kind].clone(`${spec.kind}-${index}`)!;
    mesh.setEnabled(true);
    mesh.position.set(spec.x, kindSpec.halfHeight + 0.05, spec.z);
    mesh.receiveShadows = true;
    mesh.metadata = { ground: true, cameraBlock: false };
    this.shadows.addShadowCaster(mesh);
    const aggregate = new PhysicsAggregate(
      mesh,
      kindSpec.shape,
      { mass: kindSpec.mass, friction: 0.35, restitution: kindSpec.restitution },
      this.scene,
    );
    aggregate.body.setAngularDamping(0.4);
    aggregate.body.setLinearDamping(0.05);
    aggregate.body.setCollisionCallbackEnabled(true);
    aggregate.body.getCollisionObservable().add((e) => {
      if (e.type !== PhysicsEventType.COLLISION_STARTED) return; // only the first contact makes a sound
      if (e.impulse && e.point) this.onImpact?.(e.point, e.impulse / kindSpec.mass);
    });
    this.objects.push(new MagneticObject(spec.kind, mesh, aggregate, index));
  }

  /** Disposes fallen objects and respawns them after a delay (AGENTS.md §5.3). */
  update(dt: number): void {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      o.body.getLinearVelocityToRef(this.v);
      if (clampHorizontal(this.v, OBJECTS.maxSpeed)) o.body.setLinearVelocity(this.v);
      if (o.position.y < WORLD.eliminationY) {
        this.shadows.removeShadowCaster(o.mesh);
        o.dispose();
        this.objects.splice(i, 1);
        this.respawnTimers.push({ index: o.spawnIndex, time: ARENA.objectRespawnDelay });
      }
    }
    for (let i = this.respawnTimers.length - 1; i >= 0; i--) {
      const t = this.respawnTimers[i];
      t.time -= dt;
      if (t.time <= 0) {
        this.respawnTimers.splice(i, 1);
        this.spawn(t.index);
      }
    }
  }
}

/**
 * Anvil visual: base, waist, face block and horn merged into one mesh (one draw call).
 * Its bounding box equals the collider (OBJECTS.anvil.size), centered on the origin, horn along +x.
 */
function createAnvilMesh(scene: Scene): Mesh {
  const [w, h, d] = ANVIL.size;
  const base = CreateBox("anvil-base", { width: w * 0.7, height: h * 0.25, depth: d * 0.85 }, scene);
  base.position.set(-w * 0.05, -h * 0.375, 0);
  const waist = CreateBox("anvil-waist", { width: w * 0.38, height: h * 0.3, depth: d * 0.5 }, scene);
  waist.position.set(-w * 0.05, -h * 0.1, 0);
  const faceW = w * 0.72;
  const faceH = h * 0.45;
  const face = CreateBox("anvil-face", { width: faceW, height: faceH, depth: d }, scene);
  face.position.set(-w / 2 + faceW / 2, h / 2 - faceH / 2, 0);
  const hornLen = w - faceW;
  const horn = CreateCylinder("anvil-horn", { height: hornLen, diameterTop: 0, diameterBottom: faceH * 0.9, tessellation: 8 }, scene);
  horn.rotation.z = -Math.PI / 2; // tip points along +x
  horn.position.set(w / 2 - hornLen / 2, h / 2 - faceH / 2, 0);
  const anvil = Mesh.MergeMeshes([base, waist, face, horn], true)!;
  anvil.name = "tpl-anvil";
  return anvil;
}

/** Striped wedges for the spring ball, drawn once and shared by every spring ball. */
function createStripeTexture(scene: Scene): DynamicTexture {
  const size = SPRING.textureSize;
  const tex = new DynamicTexture("spring-stripes", size, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const band = size / SPRING.stripes;
  for (let i = 0; i < SPRING.stripes; i++) {
    ctx.fillStyle = SPRING.stripeColors[i % 2];
    ctx.fillRect(i * band, 0, band, size); // columns = longitude wedges on the sphere
  }
  tex.update();
  return tex;
}
