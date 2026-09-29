import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CHARACTER, COLORS } from "../config";
import { clamp, smoothFactor } from "../util/math";

/** Full-body animation states (AGENTS.md §14). MAGNET is an upper-body overlay flag. */
/** Character parts that cast shadows (arms, eyes and magnet are too small to matter). */
const SHADOW_CASTERS = new Set(["torsoMesh", "head", "legL", "legR"]);

export enum AnimState {
  IDLE,
  MOVE,
  AIR,
  KNOCKBACK,
  ELIMINATED,
}

interface SharedMaterials {
  skin: StandardMaterial;
  pants: StandardMaterial;
  silver: StandardMaterial;
  eye: StandardMaterial;
}

const shared = new WeakMap<Scene, SharedMaterials>();

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
  private readonly torsoPivot: TransformNode;
  private readonly armL: Joint;
  private readonly armR: Joint;
  private readonly legL: Joint;
  private readonly legR: Joint;
  private readonly meshes: Mesh[] = [];
  private readonly ownMaterials: StandardMaterial[] = [];
  private readonly magnetMat: StandardMaterial;
  private readonly magnetBaseEmissive: Color3;
  private time = Math.random() * 10;
  private walkPhase = 0;
  private spin = 0;

  constructor(scene: Scene, parent: Mesh, color: string, isPlayer: boolean, shadows: ShadowGenerator) {
    const mats = sharedMaterials(scene);
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

    // Legs
    const hipL = node("hipL", this.root, -0.2, 0.7, 0);
    const hipR = node("hipR", this.root, 0.2, 0.7, 0);
    box("legL", hipL, 0.3, 0.7, 0.32, 0, -0.35, 0, mats.pants);
    box("legR", hipR, 0.3, 0.7, 0.32, 0, -0.35, 0, mats.pants);
    this.legL = new Joint(hipL);
    this.legR = new Joint(hipR);

    // Torso + head
    this.torsoPivot = node("torso", this.root, 0, 0.7, 0);
    box("torsoMesh", this.torsoPivot, 0.85, 0.72, 0.48, 0, 0.36, 0, bodyMat);
    const head = CreateSphere("head", { diameter: 0.78, segments: 8 }, scene);
    head.parent = this.torsoPivot;
    head.position.set(0, 1.1, 0);
    head.material = mats.skin;
    this.meshes.push(head);
    box("eyeL", this.torsoPivot, 0.09, 0.16, 0.05, -0.14, 1.15, 0.37, mats.eye);
    box("eyeR", this.torsoPivot, 0.09, 0.16, 0.05, 0.14, 1.15, 0.37, mats.eye);

    // Arms
    const shL = node("shoulderL", this.torsoPivot, -0.55, 0.62, 0);
    const shR = node("shoulderR", this.torsoPivot, 0.55, 0.62, 0);
    box("armL", shL, 0.26, 0.62, 0.26, 0, -0.28, 0, bodyMat);
    box("armR", shR, 0.26, 0.62, 0.26, 0, -0.28, 0, bodyMat);
    this.armL = new Joint(shL);
    this.armR = new Joint(shR);

    // U-shaped magnet in the right hand; prongs continue along the arm (−Y in arm space).
    box("magnetBase", shR, 0.52, 0.14, 0.18, 0, -0.64, 0, this.magnetMat);
    box("prongL", shR, 0.14, 0.32, 0.18, -0.19, -0.86, 0, this.magnetMat);
    box("prongR", shR, 0.14, 0.32, 0.18, 0.19, -0.86, 0, this.magnetMat);
    box("tipL", shR, 0.15, 0.12, 0.19, -0.19, -1.07, 0, this.magnetMat);
    box("tipR", shR, 0.15, 0.12, 0.19, 0.19, -1.07, 0, mats.silver);

    for (const m of this.meshes) {
      m.isPickable = false;
      // Only the big parts cast shadows: halves the shadow pass for 11 characters, looks the same.
      if (SHADOW_CASTERS.has(m.name)) shadows.addShadowCaster(m, false);
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
    let armLx = 0, armLz = -0.08, armRx = 0, armRz = 0.08, legLx = 0, legRx = 0;

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
    }

    // MAGNET upper-body overlay (not during KNOCKBACK / ELIMINATED)
    const overlay = (attracting || repulsing) && state !== AnimState.KNOCKBACK && state !== AnimState.ELIMINATED;
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
    this.legL.set(legLx, 0, t);
    this.legR.set(legRx, 0, t);

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

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    for (const mat of this.ownMaterials) mat.dispose();
    this.root.dispose();
  }
}
