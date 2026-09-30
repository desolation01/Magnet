// Side-effect import: adds createInstance to Mesh (deep imports do not register it).
import "@babylonjs/core/Meshes/instancedMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CHARACTER, COLORS } from "../config";
import { clamp, smoothFactor } from "../util/math";

/** Character parts that cast shadows (arms, eyes and magnet are too small to matter). */
const SHADOW_CASTERS = new Set(["torsoMesh", "head", "legL", "legR"]);

/** Full-body animation states (AGENTS.md §14). MAGNET is an upper-body overlay flag. */
export enum AnimState {
  IDLE,
  MOVE,
  AIR,
  KNOCKBACK,
  RAGDOLL,
  ELIMINATED,
}

interface SharedMaterials {
  skin: StandardMaterial;
  pants: StandardMaterial;
  silver: StandardMaterial;
  eye: StandardMaterial;
}

/**
 * Parts whose material is the same for every character. The AI draw them as instances of these
 * hidden source meshes, so each part type costs one draw call for all AI instead of one per AI.
 * The player uses plain copies (its outline must not spread to the instances).
 */
interface SharedParts {
  leg: Mesh;
  head: Mesh;
  eyes: Mesh;
  tip: Mesh;
}

const shared = new WeakMap<Scene, SharedMaterials>();
const sharedPartMeshes = new WeakMap<Scene, SharedParts>();

function sharedParts(scene: Scene, shadows: ShadowGenerator): SharedParts {
  let p = sharedPartMeshes.get(scene);
  if (!p) {
    const mats = sharedMaterials(scene);
    const source = (m: Mesh, mat: StandardMaterial, castShadow: boolean): Mesh => {
      m.material = mat;
      m.isPickable = false;
      m.isVisible = false; // only its instances are drawn
      m.doNotSyncBoundingInfo = true;
      if (castShadow) shadows.addShadowCaster(m, false);
      return m;
    };
    const eyeL = CreateBox("eyeL", { width: 0.09, height: 0.16, depth: 0.05 }, scene);
    const eyeR = CreateBox("eyeR", { width: 0.09, height: 0.16, depth: 0.05 }, scene);
    eyeL.position.set(-0.14, 0, 0);
    eyeR.position.set(0.14, 0, 0);
    p = {
      leg: source(CreateBox("leg-src", { width: 0.3, height: 0.7, depth: 0.32 }, scene), mats.pants, true),
      head: source(CreateSphere("head-src", { diameter: 0.78, segments: 8 }, scene), mats.skin, true),
      eyes: source(Mesh.MergeMeshes([eyeL, eyeR], true)!, mats.eye, false),
      tip: source(CreateBox("tip-src", { width: 0.15, height: 0.12, depth: 0.19 }, scene), mats.silver, false),
    };
    p.eyes.name = "eyes-src";
    sharedPartMeshes.set(scene, p);
  }
  return p;
}

function sharedMaterials(scene: Scene): SharedMaterials {
  let m = shared.get(scene);
  if (!m) {
    const make = (name: string, hex: string, emissive = 0.15): StandardMaterial => {
      const mat = new StandardMaterial(name, scene);
      mat.diffuseColor = Color3.FromHexString(hex);
      mat.emissiveColor = Color3.FromHexString(hex).scale(emissive);
      mat.specularColor = new Color3(0.1, 0.1, 0.1);
      return mat;
    };
    m = {
      skin: make("skin", COLORS.skin),
      pants: make("pants", COLORS.pants),
      silver: make("magnet-silver", COLORS.magnetSilver, 0.3),
      eye: make("eye", "#111111", 0),
    };
    shared.set(scene, m);
  }
  return m;
}

/** A limb pivot with current (smoothed) rotations. */
class Joint {
  constructor(readonly node: TransformNode) {}
  set(x: number, z: number, t: number): void {
    this.node.rotation.x += (x - this.node.rotation.x) * t;
    this.node.rotation.z += (z - this.node.rotation.z) * t;
  }
}

/** Chunky primitive character with procedural animation (AGENTS.md §13–14). */
export class CharacterVisual {
  readonly root: TransformNode;
  /** Whole body (legs + torso) under the yaw root; tipped over during RAGDOLL. */
  private readonly body: TransformNode;
  private readonly torsoPivot: TransformNode;
  private readonly armL: Joint;
  private readonly armR: Joint;
  private readonly legL: Joint;
  private readonly legR: Joint;
  private readonly meshes: AbstractMesh[] = [];
  private readonly ownMaterials: StandardMaterial[] = [];
  private readonly magnetMat: StandardMaterial;
  private readonly magnetBaseEmissive: Color3;
  private time = Math.random() * 10;
  private walkPhase = 0;
  private spin = 0;

  constructor(scene: Scene, parent: Mesh, color: string, isPlayer: boolean, shadows: ShadowGenerator) {
    const parts = sharedParts(scene, shadows);
    const bodyMat = new StandardMaterial(`body-${parent.name}`, scene);
    bodyMat.diffuseColor = Color3.FromHexString(color);
    bodyMat.emissiveColor = Color3.FromHexString(color).scale(0.2);
    bodyMat.specularColor = new Color3(0.15, 0.15, 0.15);
    this.magnetMat = new StandardMaterial(`magnet-${parent.name}`, scene);
    this.magnetMat.diffuseColor = Color3.FromHexString(COLORS.magnetRed);
    this.magnetBaseEmissive = Color3.FromHexString(COLORS.magnetRed).scale(0.25);
    this.magnetMat.emissiveColor = this.magnetBaseEmissive.clone();
    this.ownMaterials.push(bodyMat, this.magnetMat);

    this.root = new TransformNode(`visual-${parent.name}`, scene);
    this.root.parent = parent;
    this.root.position.y = -1; // feet

    const node = (name: string, p: TransformNode, x: number, y: number, z: number): TransformNode => {
      const n = new TransformNode(name, scene);
      n.parent = p;
      n.position.set(x, y, z);
      return n;
    };
    const box = (name: string, p: TransformNode, w: number, h: number, d: number, x: number, y: number, z: number, mat: StandardMaterial): Mesh => {
      const m = CreateBox(name, { width: w, height: h, depth: d }, scene);
      m.parent = p;
      m.position.set(x, y, z);
      m.material = mat;
      this.meshes.push(m);
      return m;
    };
    // A shared part: an instance for the AI, a visible copy (sharing the geometry) for the player.
    const part = (name: string, src: Mesh, p: TransformNode, x: number, y: number, z: number): AbstractMesh => {
      const m: AbstractMesh = isPlayer ? src.clone(name, null, true) : src.createInstance(name);
      if (isPlayer) {
        // clone() deep-copies the source's flags: undo the hidden-source ones, or the clone's bounds
        // stay frozen at the origin and frustum culling drops the part (looks invisible).
        m.isVisible = true;
        m.doNotSyncBoundingInfo = false;
      }
      m.parent = p;
      m.position.set(x, y, z);
      this.meshes.push(m);
      return m;
    };

    this.body = node("body", this.root, 0, 0, 0);

    // Legs
    const hipL = node("hipL", this.body, -0.2, 0.7, 0);
    const hipR = node("hipR", this.body, 0.2, 0.7, 0);
    part("legL", parts.leg, hipL, 0, -0.35, 0);
    part("legR", parts.leg, hipR, 0, -0.35, 0);
    this.legL = new Joint(hipL);
    this.legR = new Joint(hipR);

    // Torso + head
    this.torsoPivot = node("torso", this.body, 0, 0.7, 0);
    box("torsoMesh", this.torsoPivot, 0.85, 0.72, 0.48, 0, 0.36, 0, bodyMat);
    part("head", parts.head, this.torsoPivot, 0, 1.1, 0);
    part("eyes", parts.eyes, this.torsoPivot, 0, 1.15, 0.37);

    // Arms
    const shL = node("shoulderL", this.torsoPivot, -0.55, 0.62, 0);
    const shR = node("shoulderR", this.torsoPivot, 0.55, 0.62, 0);
    box("armL", shL, 0.26, 0.62, 0.26, 0, -0.28, 0, bodyMat);
    box("armR", shR, 0.26, 0.62, 0.26, 0, -0.28, 0, bodyMat);
    this.armL = new Joint(shL);
    this.armR = new Joint(shR);

    // U-shaped magnet in the right hand; prongs continue along the arm (−Y in arm space).
    // The red pieces are merged into one mesh (one draw call); the silver tip is a shared part.
    // Built unparented at their arm-space positions: MergeMeshes bakes world transforms.
    const piece = (w: number, h: number, d: number, x: number, y: number): Mesh => {
      const m = CreateBox("magnet-piece", { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, 0);
      return m;
    };
    const magnet = Mesh.MergeMeshes([
      piece(0.52, 0.14, 0.18, 0, -0.64),
      piece(0.14, 0.32, 0.18, -0.19, -0.86),
      piece(0.14, 0.32, 0.18, 0.19, -0.86),
      piece(0.15, 0.12, 0.19, -0.19, -1.07),
    ], true)!;
    magnet.name = "magnet";
    magnet.material = this.magnetMat;
    magnet.parent = shR;
    this.meshes.push(magnet);
    part("tipR", parts.tip, shR, 0.19, -1.07, 0);

    for (const m of this.meshes) {
      m.isPickable = false;
      // Only the big parts cast shadows: halves the shadow pass for 11 characters, looks the same.
      // AI legs and heads cast through their shared source mesh (one batched shadow draw).
      if (SHADOW_CASTERS.has(m.name) && (isPlayer || m instanceof Mesh)) shadows.addShadowCaster(m, false);
      if (isPlayer) {
        m.renderOutline = true;
        m.outlineColor = Color3.FromHexString(COLORS.playerOutline);
        m.outlineWidth = CHARACTER.playerOutlineWidth;
      }
    }
  }

  update(dt: number, state: AnimState, attracting: boolean, repulsing: boolean, speed: number): void {
    this.time += dt;
    const t = smoothFactor(16, dt);
    const time = this.time;
    let torsoLean = 0;
    let bob = 0;
    let armLx = 0, armLz = -0.08, armRx = 0, armRz = 0.08, legLx = 0, legRx = 0, legLz = 0, legRz = 0;
    // Body tip (RAGDOLL only): lying on its back, raised and shifted so it rests over the capsule.
    let tip = 0, tipY = 0, tipZ = 0;

    switch (state) {
      case AnimState.IDLE:
        bob = Math.sin(time * 2.2) * 0.025;
        armLx = Math.sin(time * 1.5) * 0.06;
        armRx = -Math.sin(time * 1.5) * 0.06;
        break;
      case AnimState.MOVE: {
        const frac = clamp(speed / 11, 0.3, 1);
        this.walkPhase += dt * (4 + speed * 1.1);
        const s = Math.sin(this.walkPhase);
        const amp = 0.35 + frac * 0.6;
        legLx = s * amp;
        legRx = -s * amp;
        armLx = -s * amp * 0.9;
        armRx = s * amp * 0.9;
        bob = Math.abs(Math.cos(this.walkPhase)) * 0.07 * frac;
        torsoLean = 0.06 + 0.12 * frac;
        break;
      }
      case AnimState.AIR:
        armLz = -2.3;
        armRz = 2.3;
        legLx = -0.5;
        legRx = 0.25;
        break;
      case AnimState.KNOCKBACK:
      case AnimState.ELIMINATED: {
        const f = Math.sin(time * 26);
        torsoLean = -0.45;
        armLz = -1.8 - f * 0.6;
        armRz = 1.8 + f * 0.6;
        armLx = f * 0.4;
        armRx = -f * 0.4;
        legLx = Math.sin(time * 20) * 0.6;
        legRx = -Math.sin(time * 20) * 0.6;
        break;
      }
      case AnimState.RAGDOLL: {
        const w = Math.sin(time * 7) * 0.12;
        tip = -1.4;
        tipY = 0.3;
        tipZ = 0.85;
        armLz = -1.3 - w;
        armRz = 1.3 + w;
        armLx = -0.3 + w;
        armRx = -0.2 - w;
        legLx = 0.15 + w * 0.5;
        legRx = -0.1 - w * 0.5;
        legLz = -0.25;
        legRz = 0.25;
        break;
      }
    }

    // MAGNET upper-body overlay (not during KNOCKBACK / ELIMINATED)
    const overlay = (attracting || repulsing) && state !== AnimState.KNOCKBACK && state !== AnimState.RAGDOLL && state !== AnimState.ELIMINATED;
    if (overlay) {
      armRx = -Math.PI / 2;
      armRz = 0;
      armLx = -0.9;
      armLz = -0.1;
      if (attracting) armRx += Math.sin(time * 60) * 0.03;
      if (repulsing) {
        armRx -= 0.35;
        torsoLean = -0.2;
      }
    }

    this.torsoPivot.position.y = 0.7 + bob;
    this.torsoPivot.rotation.x += (torsoLean - this.torsoPivot.rotation.x) * t;
    this.armL.set(armLx, armLz, t);
    this.armR.set(armRx, armRz, t);
    this.legL.set(legLx, legLz, t);
    this.legR.set(legRx, legRz, t);
    // Tipping over is a slower, heavier blend than the limbs.
    const tb = smoothFactor(9, dt);
    this.body.rotation.x += (tip - this.body.rotation.x) * tb;
    this.body.position.y += (tipY - this.body.position.y) * tb;
    this.body.position.z += (tipZ - this.body.position.z) * tb;

    if (state === AnimState.ELIMINATED) {
      this.spin += dt * 10;
      this.torsoPivot.rotation.y = this.spin;
    }

    // Magnet glow
    if (attracting) {
      const g = 0.7 + Math.sin(time * 18) * 0.3;
      this.magnetMat.emissiveColor.set(g, g * 0.35, g * 0.3);
    } else if (repulsing) {
      this.magnetMat.emissiveColor.set(1, 0.9, 0.9);
    } else {
      this.magnetMat.emissiveColor.copyFrom(this.magnetBaseEmissive);
    }
  }

  /**
   * Test/debug: per part, how far its culling bounding sphere is from where the part is actually drawn.
   * Anything above ~1 unit means frustum culling tests the wrong place and the part vanishes.
   */
  boundsReport(): { name: string; offset: number; noSync: boolean }[] {
    return this.meshes.map((m) => {
      m.computeWorldMatrix(true);
      const drawn = m.getAbsolutePosition();
      const c = m.getBoundingInfo().boundingSphere.centerWorld;
      return { name: m.name, offset: Math.hypot(c.x - drawn.x, c.y - drawn.y, c.z - drawn.z), noSync: m.doNotSyncBoundingInfo };
    });
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    for (const mat of this.ownMaterials) mat.dispose();
    this.root.dispose();
  }
}
