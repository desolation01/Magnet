import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { ATTRACT, COLORS, PARTICLES } from "../config";
import { DEG } from "../util/math";

interface Ring {
  mesh: Mesh;
  mat: StandardMaterial;
  time: number;
  duration: number;
  maxScale: number;
}

/** What the effects need to know about the player each frame (reused object, no per-frame allocation). */
export interface PlayerEffectsView {
  position: Vector3;
  aimYaw: number;
  attracting: boolean;
  alive: boolean;
}

/** Particles, shockwaves and the player's range indicator (AGENTS.md §10–11). */
export class Effects {
  private readonly texture: DynamicTexture;
  private readonly rings: Ring[] = [];
  private readonly bursts = new Set<ParticleSystem>();
  private readonly attractStream: ParticleSystem;
  private readonly attractEmitter = new Vector3();
  private readonly rangeIndicator: Mesh;
  private readonly rangeMat: StandardMaterial;
  private rangeAlpha = 0;

  constructor(private readonly scene: Scene) {
    this.texture = new DynamicTexture("particle-tex", 64, scene, false);
    const ctx = this.texture.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.8)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    this.texture.hasAlpha = true;
    this.texture.update();

    for (let i = 0; i < 8; i++) {
      const mesh = CreateTorus(`shockwave-${i}`, { diameter: 2, thickness: 0.12, tessellation: 32 }, scene);
      const mat = new StandardMaterial(`shockwave-mat-${i}`, scene);
      mat.emissiveColor = new Color3(0.6, 0.9, 1);
      mat.disableLighting = true;
      mat.alpha = 0;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.rings.push({ mesh, mat, time: 0, duration: 0, maxScale: 1 });
    }

    // Player attract stream: particles flowing toward the magnet.
    this.attractStream = new ParticleSystem("attract-stream", PARTICLES.attractMax, scene);
    this.attractStream.particleTexture = this.texture;
    this.attractStream.emitter = this.attractEmitter;
    // Emit box roughly matches the 60° cone's width at the emitter (7 units ahead: ±4 sideways).
    this.attractStream.minEmitBox = new Vector3(-3.5, -0.3, -3.5);
    this.attractStream.maxEmitBox = new Vector3(3.5, 1.5, 3.5);
    this.attractStream.color1 = new Color4(0.65, 1, 1, 1);
    this.attractStream.color2 = new Color4(1, 0.6, 0.35, 1);
    this.attractStream.colorDead = new Color4(1, 1, 1, 0);
    this.attractStream.minSize = PARTICLES.attractMinSize;
    this.attractStream.maxSize = PARTICLES.attractMaxSize;
    this.attractStream.minLifeTime = 0.35;
    this.attractStream.maxLifeTime = 0.6;
    this.attractStream.emitRate = 70;
    this.attractStream.minEmitPower = 9;
    this.attractStream.maxEmitPower = 14;
    this.attractStream.blendMode = ParticleSystem.BLENDMODE_ADD;

    // Flat 60° sector on the ground showing attract range.
    this.rangeIndicator = this.buildSector(ATTRACT.range, ATTRACT.coneDeg);
    this.rangeMat = new StandardMaterial("range-mat", scene);
    this.rangeMat.emissiveColor = Color3.FromHexString(COLORS.rangeIndicator);
    this.rangeMat.disableLighting = true;
    this.rangeMat.backFaceCulling = false;
    this.rangeMat.disableDepthWrite = true;
    this.rangeMat.alpha = 0;
    this.rangeIndicator.material = this.rangeMat;
    this.rangeIndicator.isPickable = false;
    this.rangeIndicator.setEnabled(false);
  }

  private buildSector(radius: number, coneDeg: number): Mesh {
    const segments = 24;
    const positions: number[] = [0, 0, 0];
    const indices: number[] = [];
    const half = (coneDeg / 2) * DEG;
    for (let i = 0; i <= segments; i++) {
      const a = -half + (2 * half * i) / segments;
      positions.push(Math.sin(a) * radius, 0, Math.cos(a) * radius);
      if (i > 0) indices.push(0, i, i + 1);
    }
    const mesh = new Mesh("range-indicator", this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.applyToMesh(mesh);
    return mesh;
  }

  /** One-shot particle burst that disposes itself. */
  burst(position: Vector3, color: Color4, count: number, power: number): void {
    const ps = new ParticleSystem("burst", count, this.scene);
    ps.particleTexture = this.texture;
    ps.emitter = position.clone();
    ps.createSphereEmitter(0.4);
    ps.color1 = color;
    ps.color2 = new Color4(1, 1, 1, color.a);
    ps.colorDead = new Color4(color.r, color.g, color.b, 0);
    ps.minSize = 0.15;
    ps.maxSize = 0.4;
    ps.minLifeTime = 0.25;
    ps.maxLifeTime = 0.5;
    ps.manualEmitCount = count;
    ps.minEmitPower = power * 0.6;
    ps.maxEmitPower = power;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.targetStopDuration = 0.6;
    // Not disposeOnStop: its dispose() would also destroy the shared particle texture.
    ps.disposeOnStop = false;
    ps.onAnimationEnd = () => {
      // Dispose outside the particle update loop, keeping the shared texture.
      this.scene.onAfterRenderObservable.addOnce(() => {
        if (!this.bursts.delete(ps)) return;
        ps.dispose(false);
      });
    };
    this.bursts.add(ps);
    ps.start();
  }

  /** Expanding flat ring (repulse shockwave). */
  shockwave(position: Vector3, radius: number): void {
    const ring = this.rings.find((r) => r.time >= r.duration) ?? this.rings[0];
    ring.time = 0;
    ring.duration = 0.3;
    ring.maxScale = radius;
    ring.mesh.position.copyFrom(position);
    ring.mesh.scaling.setAll(0.3);
    ring.mat.alpha = 0.8;
    ring.mesh.setEnabled(true);
  }

  /** Updates rings, the player's attract stream and range indicator. */
  update(dt: number, player: PlayerEffectsView | null): void {
    for (const r of this.rings) {
      if (r.time >= r.duration) continue;
      r.time += dt;
      const t = Math.min(1, r.time / r.duration);
      const s = 0.3 + (r.maxScale - 0.3) * (1 - (1 - t) * (1 - t));
      r.mesh.scaling.set(s, 1, s);
      r.mat.alpha = 0.8 * (1 - t);
      if (t >= 1) r.mesh.setEnabled(false);
    }

    const attracting = !!player && player.alive && player.attracting;
    if (player && attracting) {
      const sin = Math.sin(player.aimYaw);
      const cos = Math.cos(player.aimYaw);
      this.attractEmitter.set(player.position.x + sin * 7, player.position.y - 0.5, player.position.z + cos * 7);
      // Particles fly back toward the player.
      this.attractStream.direction1.set(-sin, 0.02, -cos);
      this.attractStream.direction2.set(-sin, 0.1, -cos);
      if (!this.attractStream.isStarted()) this.attractStream.start();
    } else if (this.attractStream.isStarted()) {
      this.attractStream.stop();
    }

    const target = attracting ? 0.15 : 0;
    const rate = attracting ? 0.15 / 0.1 : 0.15 / 0.2;
    this.rangeAlpha += Math.sign(target - this.rangeAlpha) * Math.min(Math.abs(target - this.rangeAlpha), rate * dt);
    this.rangeMat.alpha = this.rangeAlpha;
    this.rangeIndicator.setEnabled(this.rangeAlpha > 0.001);
    if (player && this.rangeAlpha > 0.001) {
      this.rangeIndicator.position.set(player.position.x, player.position.y - 0.95, player.position.z);
      this.rangeIndicator.rotation.y = player.aimYaw;
    }
  }

  /** Stops continuous effects and removes one-shot ones (match reset). */
  clear(): void {
    for (const ps of this.bursts) ps.dispose(false);
    this.bursts.clear();
    this.attractStream.stop();
    this.attractStream.reset();
    for (const r of this.rings) {
      r.time = r.duration;
      r.mesh.setEnabled(false);
    }
    this.rangeAlpha = 0;
    this.rangeIndicator.setEnabled(false);
  }

  get activeParticleSystems(): number {
    return this.bursts.size + (this.attractStream.isStarted() ? 1 : 0);
  }
}
