import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import type { AudioManager } from "../audio/AudioManager";
import type { Character } from "../character/Character";
import type { Effects } from "../combat/Effects";
import { BOUNCE, CHARACTER, WORLD } from "../config";
import type { Arena, ArenaMeshTag } from "./Arena";
import type { MagneticObject } from "./ArenaObjects";
import { PLATFORMS } from "./ArenaLayout";

/** Read-only pad data for tests and playtests. */
export interface PadInfo {
  readonly x: number;
  readonly z: number;
  /** Center of the island the pad launches to. */
  readonly targetX: number;
  readonly targetZ: number;
  readonly island: string;
}

interface Pad {
  info: PadInfo;
  /** Launch velocity (set, not added): horizontal toward the island center, plus BOUNCE.launchVy. */
  launch: Vector3;
  /** Burst origin: the pad top center. */
  top: Vector3;
  topMat: StandardMaterial;
  pulse: number;
  /** Pad clock time until which a body may not be launched again by this pad. */
  cooldowns: WeakMap<object, number>;
}

/**
 * Bounce pads on the hub rim (arena expansion spec §3). A live character whose feet, or a magnetic
 * object whose bottom, rests on a pad is thrown in an arc that lands in the middle of the diagonal
 * island behind it. A launch is not a hit: no stability loss and no elimination credit.
 */
export class BouncePads {
  readonly pads: readonly PadInfo[];
  /** Launches this match (characters and objects), for playtests. Reset on match reset. */
  launches = 0;
  /** Seconds a launch arc takes from the pad top back down to platform height. */
  readonly flightTime: number;

  private readonly list: Pad[] = [];
  private readonly meshes: Mesh[] = [];
  private readonly materials: StandardMaterial[] = [];
  private readonly aggregates: PhysicsAggregate[] = [];
  private readonly glow = Color3.FromHexString(BOUNCE.topColor);
  private readonly burstColor = Color4.FromHexString(`${BOUNCE.burstColor}ff`);
  private readonly padTop = BOUNCE.padHeight;
  private time = 0;

  constructor(scene: Scene, arena: Arena, private readonly effects: Effects, private readonly audio: AudioManager) {
    // Flight from the pad top (h above the islands) back to y = 0: h + vy·t − |g|t²/2 = 0.
    const g = Math.abs(WORLD.gravity);
    const vy = BOUNCE.launchVy;
    this.flightTime = (vy + Math.sqrt(vy * vy + 2 * g * this.padTop)) / g;

    const baseMat = this.material(scene, "pad-base", BOUNCE.baseColor);
    baseMat.specularColor = new Color3(0.15, 0.15, 0.15);
    baseMat.emissiveColor = Color3.FromHexString(BOUNCE.baseColor).scale(0.15);
    const arrowMat = this.material(scene, "pad-arrow", BOUNCE.arrowColor);
    arrowMat.disableLighting = true;
    arrowMat.emissiveColor = Color3.FromHexString(BOUNCE.arrowColor);
    arrowMat.backFaceCulling = false;
    arrowMat.zOffset = -2; // drawn over the glowing top without z-fighting

    const islands = PLATFORMS.filter((p) => p.kind === "island");
    const r = BOUNCE.ringRadius * Math.SQRT1_2;
    const infos: PadInfo[] = [];
    for (const [sx, sz] of [[1, -1], [1, 1], [-1, 1], [-1, -1]]) {
      const x = sx * r;
      const z = sz * r;
      // The island on the same diagonal (nearest center).
      let island = islands[0];
      for (const p of islands) {
        if (Math.hypot(p.cx - x, p.cz - z) < Math.hypot(island.cx - x, island.cz - z)) island = p;
      }
      const dx = island.cx - x;
      const dz = island.cz - z;
      const d = Math.hypot(dx, dz);
      const vh = d / this.flightTime;
      const name = `bounce-pad-${island.name}`;

      const base = CreateCylinder(name, { diameter: BOUNCE.padRadius * 2, height: BOUNCE.padHeight, tessellation: BOUNCE.tessellation }, scene);
      base.position.set(x, BOUNCE.padHeight / 2, z);
      base.material = baseMat;
      base.receiveShadows = true;
      base.metadata = { ground: true, cameraBlock: true, surface: "pad" } satisfies ArenaMeshTag;
      this.aggregates.push(new PhysicsAggregate(base, PhysicsShapeType.CYLINDER, { mass: 0, friction: 0.6, restitution: 0.1 }, scene));
      this.addVisual(base);

      const topMat = this.material(scene, `${name}-top`, BOUNCE.topColor);
      topMat.disableLighting = true;
      topMat.zOffset = -1;
      this.glow.scaleToRef(BOUNCE.idleGlow, topMat.emissiveColor);
      const top = CreateCylinder(`${name}-top`, { diameter: BOUNCE.topRadius * 2, height: 0.01, tessellation: BOUNCE.tessellation }, scene);
      top.position.set(x, this.padTop + 0.006, z);
      top.material = topMat;
      top.isPickable = false;
      this.addVisual(top);

      const arrow = this.buildArrow(scene, `${name}-arrow`);
      arrow.material = arrowMat;
      arrow.position.set(x, this.padTop + 0.015, z);
      arrow.rotation.y = Math.atan2(dx, dz); // local +Z points at the island
      this.addVisual(arrow);

      const info: PadInfo = { x, z, targetX: island.cx, targetZ: island.cz, island: island.name };
      infos.push(info);
      this.list.push({
        info,
        launch: new Vector3((dx / d) * vh, vy, (dz / d) * vh),
        top: new Vector3(x, this.padTop + 0.1, z),
        topMat,
        pulse: 0,
        cooldowns: new WeakMap(),
      });
      arena.addObstacle({ x, z, hx: BOUNCE.padRadius + BOUNCE.obstacleClearance, hz: BOUNCE.padRadius + BOUNCE.obstacleClearance, circle: true });
    }
    this.pads = infos;
  }

  private material(scene: Scene, name: string, color: string): StandardMaterial {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = Color3.FromHexString(color);
    mat.specularColor = Color3.Black();
    this.materials.push(mat);
    return mat;
  }

  private addVisual(mesh: Mesh): void {
    mesh.freezeWorldMatrix();
    this.meshes.push(mesh);
  }

  /** Flat arrow in the XZ plane pointing +Z (shaft + triangular head), centered on the pad. */
  private buildArrow(scene: Scene, name: string): Mesh {
    const half = BOUNCE.arrowLength / 2;
    const neck = half - BOUNCE.arrowHeadLength;
    const sw = BOUNCE.arrowShaftWidth / 2;
    const hw = BOUNCE.arrowHeadWidth / 2;
    const positions = [
      -sw, 0, -half, sw, 0, -half, sw, 0, neck, -sw, 0, neck, // shaft
      -hw, 0, neck, hw, 0, neck, 0, 0, half, // head
    ];
    const indices = [0, 3, 2, 0, 2, 1, 4, 6, 5];
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    const mesh = new Mesh(name, scene);
    vd.applyToMesh(mesh);
    mesh.isPickable = false;
    return mesh;
  }

  /** True when a body whose bottom is at `bottom` and center at (x, z) stands on the pad. */
  private onPad(pad: Pad, x: number, z: number, bottom: number): boolean {
    const dx = x - pad.info.x;
    const dz = z - pad.info.z;
    if (dx * dx + dz * dz > BOUNCE.padRadius * BOUNCE.padRadius) return false;
    const above = bottom - this.padTop;
    return above <= BOUNCE.triggerHeight && above >= -BOUNCE.triggerBelow;
  }

  /** Ready to launch `body` from `pad` (per-body, per-pad cooldown); starts the cooldown if so. */
  private take(pad: Pad, body: object): boolean {
    const until = pad.cooldowns.get(body);
    if (until !== undefined && until > this.time) return false;
    pad.cooldowns.set(body, this.time + BOUNCE.cooldown);
    return true;
  }

  private feedback(pad: Pad, source: Vector3 | null): void {
    this.launches++;
    pad.pulse = BOUNCE.pulseDuration;
    this.effects.burst(pad.top, this.burstColor, BOUNCE.burstCount, BOUNCE.burstPower);
    this.audio.bounce(source);
  }

  /** Launches characters and objects standing on a pad; runs every frame physics runs. */
  update(dt: number, characters: readonly Character[], objects: readonly MagneticObject[]): void {
    this.time += dt;
    const feetOffset = CHARACTER.height / 2;
    for (const pad of this.list) {
      for (const c of characters) {
        if (!c.alive || c.heldBy) continue;
        const p = c.position;
        if (!this.onPad(pad, p.x, p.z, p.y - feetOffset) || !this.take(pad, c)) continue;
        c.launch(pad.launch, this.flightTime + BOUNCE.flightMargin, BOUNCE.controlFraction, BOUNCE.groundLock);
        this.feedback(pad, c.isPlayer ? null : p);
      }
      for (const o of objects) {
        if (!o.alive || o.heldBy) continue;
        const p = o.position;
        if (!this.onPad(pad, p.x, p.z, p.y - o.radius) || !this.take(pad, o)) continue;
        o.body.setLinearVelocity(pad.launch);
        this.feedback(pad, p);
      }
      if (pad.pulse > 0) {
        pad.pulse = Math.max(0, pad.pulse - dt);
        const k = pad.pulse / BOUNCE.pulseDuration;
        this.glow.scaleToRef(BOUNCE.idleGlow + (BOUNCE.pulseGlow - BOUNCE.idleGlow) * k * k, pad.topMat.emissiveColor);
      }
    }
  }

  /** Match reset: clears the launch counter, cooldowns and pulses. */
  reset(): void {
    this.launches = 0;
    for (const pad of this.list) {
      pad.cooldowns = new WeakMap();
      pad.pulse = 0;
      this.glow.scaleToRef(BOUNCE.idleGlow, pad.topMat.emissiveColor);
    }
  }

  dispose(): void {
    for (const a of this.aggregates) a.dispose();
    for (const m of this.meshes) m.dispose();
    for (const mat of this.materials) mat.dispose();
    this.aggregates.length = 0;
    this.meshes.length = 0;
    this.materials.length = 0;
    this.list.length = 0;
  }
}
