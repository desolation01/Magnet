// Side-effect import: adds thinInstance* methods to Mesh (deep imports do not register them).
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { ARENA, DECOR } from "../config";
import { Rng } from "../util/rng";
import { BOXES, CYLINDERS, PLATFORMS, WALKWAYS, type PlatformDef } from "./ArenaLayout";

/** Line segment (between two platform centers) that a walkway runs along, for keeping dressing off it. */
interface Lane {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
}

/**
 * Visual-only arena dressing (spec §6): rocky undersides, grass, island props, floating rocks, clouds.
 * Built once with the arena, never per match. Nothing here has physics, is pickable or carries the
 * `ground` / `cameraBlock` tags, and only the tree canopies cast shadows. Repeated items are thin
 * instances, so each kind is one draw call.
 */
export class ArenaDecor {
  private readonly meshes: Mesh[] = [];
  private readonly materials: StandardMaterial[] = [];
  private readonly lanes: Lane[] = [];
  private rocks: Mesh | null = null;
  private rockMatrices = new Float32Array(0);
  /** Per floating rock: x, base y, z, scale, y scale, yaw, phase. */
  private rockParams = new Float32Array(0);
  private flag: Mesh | null = null;
  private flagYaw = 0;
  private time = 0;

  constructor(private readonly scene: Scene, private readonly shadows?: ShadowGenerator) {
    for (const w of WALKWAYS) {
      const a = ArenaDecor.platform(w.from);
      const b = ArenaDecor.platform(w.to);
      this.lanes.push({ ax: a.cx, az: a.cz, bx: b.cx, bz: b.cz, half: w.width / 2 });
    }
    this.buildUndersides();
    this.buildGrass();
    this.buildCrystals();
    this.buildScrap();
    this.buildCanopies();
    this.buildFlag();
    this.buildFloatingRocks();
    this.buildClouds();
  }

  /** Bobs the floating rocks and waves the flag. No allocations. */
  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    if (this.rocks) {
      const fr = DECOR.floatingRocks;
      const m = this.rockMatrices;
      const p = this.rockParams;
      for (let i = 0; i < fr.count; i++) {
        const o = i * 16;
        const q = i * 7;
        const yaw = p[q + 5] + t * fr.spinSpeed;
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        const sc = p[q + 3];
        // Scale × RotationY × Translation, written in place.
        m[o] = c * sc;
        m[o + 2] = -s * sc;
        m[o + 5] = sc * p[q + 4];
        m[o + 8] = s * sc;
        m[o + 10] = c * sc;
        m[o + 12] = p[q];
        m[o + 13] = p[q + 1] + Math.sin(t * fr.bobSpeed + p[q + 6]) * fr.bobAmp;
        m[o + 14] = p[q + 2];
        m[o + 15] = 1;
      }
      this.rocks.thinInstanceBufferUpdated("matrix");
    }
    if (this.flag) {
      const f = DECOR.flag;
      this.flag.rotation.y = this.flagYaw + Math.sin(t * f.waveSpeed) * f.waveAmp + Math.sin(t * f.waveSpeed * 2.3) * f.waveAmp * 0.3;
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    for (const mat of this.materials) mat.dispose();
    this.meshes.length = 0;
    this.materials.length = 0;
    this.rocks = null;
    this.flag = null;
  }

  // ------------------------------------------------------------ helpers

  private static platform(name: string): PlatformDef {
    const p = PLATFORMS.find((d) => d.name === name);
    if (!p) throw new Error(`decor: unknown platform ${name}`);
    return p;
  }

  private material(name: string, color: string, emissive: number, specular = 0.08): StandardMaterial {
    const mat = new StandardMaterial(`decor-${name}`, this.scene);
    mat.diffuseColor = Color3.FromHexString(color);
    mat.emissiveColor = Color3.FromHexString(color).scale(emissive);
    mat.specularColor = new Color3(specular, specular, specular);
    this.materials.push(mat);
    return mat;
  }

  /** Registers a finished decor mesh: not pickable, no shadows, static unless `dynamic`. */
  private add(mesh: Mesh, mat: StandardMaterial, dynamic = false): Mesh {
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    if (!dynamic) mesh.freezeWorldMatrix();
    this.meshes.push(mesh);
    return mesh;
  }

  /** Turns a list of matrices into the mesh's thin instances (static buffer). */
  private setInstances(mesh: Mesh, matrices: Matrix[]): void {
    const buf = new Float32Array(matrices.length * 16);
    matrices.forEach((m, i) => m.copyToArray(buf, i * 16));
    mesh.thinInstanceSetBuffer("matrix", buf, 16, true);
    mesh.thinInstanceRefreshBoundingInfo(false);
  }

  private static matrix(x: number, y: number, z: number, yaw: number, scale: number, pitch = 0, roll = 0): Matrix {
    return Matrix.Compose(new Vector3(scale, scale, scale), Quaternion.RotationYawPitchRoll(yaw, pitch, roll), new Vector3(x, y, z));
  }

  /** True when (x, z) lies within `margin` of a walkway's line (keeps entrances and walking lanes clear). */
  private nearLane(x: number, z: number, margin: number): boolean {
    for (const l of this.lanes) {
      const dx = l.bx - l.ax;
      const dz = l.bz - l.az;
      const t = Math.max(0, Math.min(1, ((x - l.ax) * dx + (z - l.az) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(x - (l.ax + dx * t), z - (l.az + dz * t)) < l.half + margin) return true;
    }
    return false;
  }

  /** True when (x, z) lies within `margin` of a static collider's bounding circle. */
  private static nearCollider(x: number, z: number, margin: number): boolean {
    for (const b of BOXES) if (Math.hypot(x - b.x, z - b.z) < Math.hypot(b.w, b.d) / 2 + margin) return true;
    for (const c of CYLINDERS) if (Math.hypot(x - c.x, z - c.z) < c.radius + margin) return true;
    return false;
  }

  /** Moves vertices by a seeded jitter keyed by position, so duplicated seam/cap vertices move together. */
  private static jitterKey(x: number, y: number, z: number): string {
    return `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  }

  /** Flat-shades a mesh and colors each triangle with `pick(triangle, normalY, centroidY)`. */
  private static colorFaces(mesh: Mesh, pick: (normalY: number, centroidY: number) => Color3): void {
    mesh.convertToFlatShadedMesh();
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const nrm = mesh.getVerticesData(VertexBuffer.NormalKind)!;
    const count = pos.length / 3;
    const colors = new Float32Array(count * 4);
    for (let v = 0; v + 2 < count; v += 3) {
      const cy = (pos[v * 3 + 1] + pos[v * 3 + 4] + pos[v * 3 + 7]) / 3;
      const c = pick(nrm[v * 3 + 1], cy);
      for (let k = 0; k < 3; k++) {
        const o = (v + k) * 4;
        colors[o] = c.r;
        colors[o + 1] = c.g;
        colors[o + 2] = c.b;
        colors[o + 3] = 1;
      }
    }
    mesh.setVerticesData(VertexBuffer.ColorKind, colors, false, 4);
  }

  // ------------------------------------------------------------ rocky undersides

  /** An inverted, jittered, flat-shaded rock under every base platform, merged into one mesh. */
  private buildUndersides(): void {
    const cfg = DECOR.underside;
    const rng = new Rng(cfg.seed);
    const palette = cfg.colors.map((c) => Color3.FromHexString(c));
    const minSize = ARENA.islandRadius;
    const maxSize = ARENA.hubRadius;
    const parts: Mesh[] = [];
    for (const p of PLATFORMS) {
      const size = p.shape === "circle" ? p.radius : Math.max(p.hx, p.hz);
      const k = Math.max(0, Math.min(1, (size - minSize) / (maxSize - minSize)));
      const depth = cfg.depthMin + (cfg.depthMax - cfg.depthMin) * k + rng.range(-cfg.depthJitter, cfg.depthJitter);
      const sides = p.kind === "hub" ? cfg.hubSides : p.shape === "rect" ? cfg.rectSides : cfg.circleSides;
      const m = CreateCylinder(`underside-${p.name}`, { height: 1, diameter: 2, tessellation: sides, subdivisions: cfg.rings }, this.scene);
      const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
      const jitter = new Map<string, [number, number, number]>();
      const tipX = rng.range(-1, 1) * cfg.tipWander;
      const tipZ = rng.range(-1, 1) * cfg.tipWander;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i];
        const y = pos[i + 1];
        const z = pos[i + 2];
        const key = ArenaDecor.jitterKey(x, y, z);
        let j = jitter.get(key);
        if (!j) {
          j = [rng.range(-1, 1), rng.range(-1, 1), rng.next()];
          jitter.set(key, j);
        }
        const t = 0.5 - y; // 0 at the top ring, 1 at the tip
        const top = t < 1e-4;
        const bottom = t > 1 - 1e-4;
        const rho = Math.hypot(x, z);
        const theta = Math.atan2(z, x);
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        // Footprint radius along this direction: the circle, or the square's boundary.
        const rim = (p.shape === "circle"
          ? p.radius
          : Math.min(p.hx / Math.max(Math.abs(cos), 1e-6), p.hz / Math.max(Math.abs(sin), 1e-6))) * cfg.inset;
        const profile = 1 - (1 - cfg.tipRadius) * Math.pow(t, cfg.taperPower);
        // The top ring only ever shrinks, so the rock never shows outside the platform it hangs under.
        const radial = top ? 1 - cfg.radialJitter * 0.5 * j[2] : 1 + cfg.radialJitter * j[0];
        const r = rim * profile * radial * rho;
        const wander = t * t;
        pos[i] = cos * r + tipX * wander;
        pos[i + 1] = top ? 0 : bottom ? (rho < 1e-3 ? -depth * 1.1 : -depth) : -t * depth + cfg.verticalJitter * j[1];
        pos[i + 2] = sin * r + tipZ * wander;
      }
      m.setVerticesData(VertexBuffer.PositionKind, pos);
      ArenaDecor.colorFaces(m, (_ny, cy) => {
        const shade = 1 - cfg.bottomDarken * Math.min(1, -cy / depth);
        return palette[Math.floor(rng.next() * palette.length)].scale(shade);
      });
      m.position.set(p.cx, -ARENA.platformThickness - cfg.gap, p.cz);
      parts.push(m);
    }
    const merged = Mesh.MergeMeshes(parts, true, true);
    if (merged) {
      merged.name = "decor-undersides";
      this.add(merged, this.material("underside", "#ffffff", 0.08));
    }
  }

  // ------------------------------------------------------------ grass tufts

  private buildGrass(): void {
    const g = DECOR.grass;
    const rng = new Rng(g.seed);
    const blades: Mesh[] = [];
    for (let b = 0; b < g.blades; b++) {
      const a = (b / g.blades) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const h = rng.range(g.bladeHeightMin, g.bladeHeightMax);
      const blade = CreateCylinder("grass-blade", { height: h, diameterTop: 0, diameterBottom: g.bladeRadius * 2, tessellation: 4 }, this.scene);
      const r = b === 0 ? 0 : g.spread;
      blade.position.set(Math.cos(a) * r, h / 2 - 0.03, Math.sin(a) * r);
      blade.rotation.set(g.tilt * Math.sin(a) * (r > 0 ? 1 : 0.3), rng.range(0, Math.PI), -g.tilt * Math.cos(a) * (r > 0 ? 1 : 0.3));
      blade.bakeCurrentTransformIntoVertices();
      blades.push(blade);
    }
    const tuft = Mesh.MergeMeshes(blades, true);
    if (!tuft) return;
    tuft.name = "decor-grass";
    tuft.convertToFlatShadedMesh();

    const mats: Matrix[] = [];
    const place = (x: number, z: number): void => {
      mats.push(ArenaDecor.matrix(x, 0, z, rng.range(0, Math.PI * 2), rng.range(g.scaleMin, g.scaleMax)));
    };
    const ok = (x: number, z: number): boolean => !this.nearLane(x, z, g.walkwayMargin) && !ArenaDecor.nearCollider(x, z, g.obstacleMargin);
    for (const p of PLATFORMS) {
      if (p.kind === "island") {
        for (let n = 0, tries = 0; n < g.perIsland && tries < g.perIsland * 20; tries++) {
          const a = rng.range(0, Math.PI * 2);
          const r = rng.range(g.islandMinRadius, p.radius - g.rimInset);
          const x = p.cx + Math.cos(a) * r;
          const z = p.cz + Math.sin(a) * r;
          if (ok(x, z)) {
            place(x, z);
            n++;
          }
        }
      } else if (p.kind === "cardinal") {
        for (let n = 0, tries = 0; n < g.perCardinal && tries < g.perCardinal * 20; tries++) {
          const side = Math.floor(rng.next() * 4);
          const along = rng.range(-1, 1) * (p.hx - g.rimInset);
          const depth = rng.range(g.rimInset, g.cardinalBand);
          const sx = side === 0 ? 1 : side === 1 ? -1 : 0;
          const sz = side === 2 ? 1 : side === 3 ? -1 : 0;
          const x = p.cx + (sx !== 0 ? sx * (p.hx - depth) : along);
          const z = p.cz + (sz !== 0 ? sz * (p.hz - depth) : along);
          if (ok(x, z)) {
            place(x, z);
            n++;
          }
        }
      }
    }
    this.setInstances(tuft, mats);
    this.add(tuft, this.material("grass", g.color, 0.12));
  }

  // ------------------------------------------------------------ NE crystal garden

  private buildCrystals(): void {
    const c = DECOR.crystals;
    const rng = new Rng(c.seed);
    const shards: Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const s = i === 0 ? 1 : rng.range(0.55, 0.8);
      const h = c.shardHeight * s;
      const shaft = CreateCylinder("crystal-shaft", { height: h, diameter: c.shardRadius * 2 * s, tessellation: 6 }, this.scene);
      shaft.position.y = h / 2;
      const tip = CreateCylinder("crystal-tip", { height: c.tipHeight * s, diameterTop: 0, diameterBottom: c.shardRadius * 2 * s, tessellation: 6 }, this.scene);
      tip.position.y = h + (c.tipHeight * s) / 2;
      const shard = Mesh.MergeMeshes([shaft, tip], true)!;
      const a = (i / 3) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const r = i === 0 ? 0 : c.shardRadius * 1.3;
      shard.position.set(Math.cos(a) * r, -0.05, Math.sin(a) * r);
      shard.rotation.set(i === 0 ? 0 : 0.45 * Math.sin(a), 0, i === 0 ? 0 : -0.45 * Math.cos(a));
      shard.bakeCurrentTransformIntoVertices();
      shards.push(shard);
    }
    const cluster = Mesh.MergeMeshes(shards, true);
    if (!cluster) return;
    cluster.name = "decor-crystals";
    cluster.convertToFlatShadedMesh();

    const ne = ArenaDecor.platform("NE");
    // Clusters line the outward half of the rim, away from the walking routes on the hub-facing half.
    const outA = Math.atan2(ne.cz, ne.cx);
    const mats: Matrix[] = [];
    for (let n = 0, tries = 0; n < c.count && tries < c.count * 30; tries++) {
      const a = outA + rng.range(-1, 1) * c.arcHalf;
      const r = rng.range(c.rimMin, c.rimMax);
      const x = ne.cx + Math.cos(a) * r;
      const z = ne.cz + Math.sin(a) * r;
      if (this.nearLane(x, z, DECOR.grass.walkwayMargin) || ArenaDecor.nearCollider(x, z, 0.3)) continue;
      mats.push(ArenaDecor.matrix(x, 0, z, rng.range(0, Math.PI * 2), rng.range(c.scaleMin, c.scaleMax)));
      n++;
    }
    this.setInstances(cluster, mats);
    this.add(cluster, this.material("crystal", c.color, c.emissive, 0.5));

    // Pointed cap on the big hex-prism crystal (its collider stops at the flat top).
    const big = CYLINDERS.find((d) => d.surface === "crystal");
    if (big) {
      const t = DECOR.themes.crystal;
      const cap = CreateCylinder("decor-crystal-cap", { height: t.capHeight, diameterTop: 0, diameterBottom: big.radius * 2, tessellation: big.tessellation }, this.scene);
      cap.convertToFlatShadedMesh();
      cap.position.set(big.x, big.h + t.capHeight / 2, big.z);
      this.add(cap, this.material("crystal-cap", big.color, ARENA.emissiveFactor));
    }
  }

  // ------------------------------------------------------------ SE scrapyard

  private buildScrap(): void {
    const s = DECOR.scrapBits;
    const rng = new Rng(s.seed);
    const piles = BOXES.filter((b) => b.surface === "scrap");
    const se = ArenaDecor.platform("SE");

    const pipe = CreateCylinder("decor-pipes", { height: s.pipeLength, diameter: s.pipeRadius * 2, tessellation: 8 }, this.scene);
    pipe.rotation.z = Math.PI / 2; // lying along X
    pipe.position.y = s.pipeRadius;
    pipe.bakeCurrentTransformIntoVertices();
    const bolt = CreateCylinder("decor-bolts", { height: s.boltHeight, diameter: s.boltRadius * 2, tessellation: 6 }, this.scene);
    bolt.position.y = s.boltHeight / 2 - 0.01;
    bolt.bakeCurrentTransformIntoVertices();
    bolt.convertToFlatShadedMesh();

    const scatter = (count: number): Matrix[] => {
      const mats: Matrix[] = [];
      for (let n = 0, tries = 0; n < count && tries < count * 30; tries++) {
        const yaw = rng.range(0, Math.PI * 2);
        if (piles.length > 0 && rng.chance(s.onPile)) {
          const p = piles[Math.floor(rng.next() * piles.length)];
          const r = Math.min(p.w, p.d) / 2 - 0.45;
          mats.push(ArenaDecor.matrix(p.x + rng.range(-r, r), p.h, p.z + rng.range(-r, r), yaw, 1));
          n++;
          continue;
        }
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(s.scatterMin, s.scatterMax);
        const x = se.cx + Math.cos(a) * r;
        const z = se.cz + Math.sin(a) * r;
        if (this.nearLane(x, z, 0.8) || ArenaDecor.nearCollider(x, z, 0.4)) continue;
        mats.push(ArenaDecor.matrix(x, 0, z, yaw, 1));
        n++;
      }
      return mats;
    };
    this.setInstances(pipe, scatter(s.pipes));
    this.setInstances(bolt, scatter(s.bolts));
    this.add(pipe, this.material("pipe", s.pipeColor, 0.1, 0.4));
    this.add(bolt, this.material("bolt", s.boltColor, 0.1, 0.5));

    // Tilted sheet-metal plates on the pile tops (one edge sunk into the pile), so the boxes read as heaps.
    if (piles.length === 0) return;
    const plate = CreateBox("decor-plates", { width: s.plateWidth, height: s.plateThickness, depth: s.plateDepth }, this.scene);
    const plates: Matrix[] = [];
    for (let i = 0; i < s.plates; i++) {
      const p = piles[i % piles.length];
      const r = Math.min(p.w, p.d) / 2 - s.plateWidth / 2;
      plates.push(ArenaDecor.matrix(
        p.x + rng.range(-r, r), p.h + s.plateThickness, p.z + rng.range(-r, r),
        rng.range(0, Math.PI * 2), 1, rng.range(-s.plateTilt, s.plateTilt), rng.range(-s.plateTilt, s.plateTilt),
      ));
    }
    this.setInstances(plate, plates);
    this.add(plate, this.material("plate", s.plateColor, 0.1, 0.3));
  }

  // ------------------------------------------------------------ SW grove

  private buildCanopies(): void {
    const c = DECOR.canopy;
    const rng = new Rng(c.seed);
    const blobs: Mesh[] = [];
    for (let i = 0; i < c.blobs; i++) {
      const blob = CreateIcoSphere("canopy-blob", { radius: i === 0 ? 1 : rng.range(0.6, 0.75), subdivisions: 1 }, this.scene);
      const a = (i / c.blobs) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.55;
      blob.position.set(Math.cos(a) * r, i === 0 ? 0 : rng.range(0.1, 0.35), Math.sin(a) * r);
      blob.bakeCurrentTransformIntoVertices();
      blobs.push(blob);
    }
    const canopy = Mesh.MergeMeshes(blobs, true);
    if (!canopy) return;
    canopy.name = "decor-canopies";
    canopy.convertToFlatShadedMesh();

    const mats: Matrix[] = [];
    for (const t of CYLINDERS) {
      if (t.surface !== "trunk") continue;
      const s = c.radius * rng.range(c.scaleMin, c.scaleMax);
      const m = Matrix.Compose(
        new Vector3(s, s * c.heightScale, s),
        Quaternion.RotationYawPitchRoll(rng.range(0, Math.PI * 2), 0, 0),
        new Vector3(t.x, t.h + c.lift, t.z),
      );
      mats.push(m);
    }
    this.setInstances(canopy, mats);
    this.add(canopy, this.material("canopy", c.color, 0.12));
    this.shadows?.addShadowCaster(canopy);
  }

  // ------------------------------------------------------------ NW lookout flag

  private buildFlag(): void {
    const f = DECOR.flag;
    const tower = BOXES.find((b) => b.name === "lookout-tower");
    if (!tower) return;
    // Outward from the hub (the island sits on a diagonal).
    const len = Math.hypot(tower.x, tower.z);
    const ux = tower.x / len;
    const uz = tower.z / len;
    const out = tower.d / 2 - f.inset;
    const px = tower.x + ux * out;
    const pz = tower.z + uz * out;
    const top = (tower.y ?? 0) + tower.h;

    const pole = CreateCylinder("decor-flag-pole", { height: f.poleHeight, diameter: f.poleRadius * 2, tessellation: 6 }, this.scene);
    pole.position.set(px, top + f.poleHeight / 2, pz);
    this.add(pole, this.material("flag-pole", f.poleColor, 0.1, 0.3));

    const flag = CreateBox("decor-flag", { width: f.width, height: f.height, depth: 0.05 }, this.scene);
    flag.bakeTransformIntoVertices(Matrix.Translation(f.width / 2 + f.poleRadius, 0, 0)); // hinge on the pole
    flag.position.set(px, top + f.poleHeight - f.height / 2 - 0.05, pz);
    // Local +X (the fly end) points across the island, so the flag reads from the hub.
    this.flagYaw = Math.atan2(-ux, -uz);
    flag.rotation.y = this.flagYaw;
    this.flag = this.add(flag, this.material("flag", f.color, 0.2), true);
  }

  // ------------------------------------------------------------ floating rocks

  private buildFloatingRocks(): void {
    const fr = DECOR.floatingRocks;
    const rng = new Rng(fr.seed);
    const rock = CreateIcoSphere("decor-floating-rocks", { radius: 1, subdivisions: 1 }, this.scene);
    const pos = rock.getVerticesData(VertexBuffer.PositionKind)!;
    const jitter = new Map<string, number>();
    for (let i = 0; i < pos.length; i += 3) {
      const key = ArenaDecor.jitterKey(pos[i], pos[i + 1], pos[i + 2]);
      let j = jitter.get(key);
      if (j === undefined) {
        j = rng.range(0.8, 1.2);
        jitter.set(key, j);
      }
      let y = pos[i + 1];
      // A flat grassy top and a long rocky point below: a mini floating island.
      y = y > 0.3 ? 0.3 + (y - 0.3) * 0.15 : y < 0 ? y * 1.7 : y;
      pos[i] *= j;
      pos[i + 1] = y * (y < 0 ? j : 1);
      pos[i + 2] *= j;
    }
    rock.setVerticesData(VertexBuffer.PositionKind, pos);
    const rockColor = Color3.FromHexString(fr.rockColor);
    const grass = Color3.FromHexString(fr.grassColor);
    ArenaDecor.colorFaces(rock, (ny) => (ny > 0.6 ? grass : rockColor.scale(rng.range(0.8, 1.05))));

    this.rockMatrices = new Float32Array(fr.count * 16);
    this.rockParams = new Float32Array(fr.count * 7);
    for (let i = 0; i < fr.count; i++) {
      const a = (i / fr.count) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const r = rng.range(fr.radiusMin, fr.radiusMax);
      const q = i * 7;
      this.rockParams[q] = Math.cos(a) * r;
      this.rockParams[q + 1] = rng.range(fr.yMin, fr.yMax);
      this.rockParams[q + 2] = Math.sin(a) * r;
      this.rockParams[q + 3] = rng.range(fr.scaleMin, fr.scaleMax);
      this.rockParams[q + 4] = rng.range(0.7, 1);
      this.rockParams[q + 5] = rng.range(0, Math.PI * 2);
      this.rockParams[q + 6] = rng.range(0, Math.PI * 2);
    }
    rock.thinInstanceSetBuffer("matrix", this.rockMatrices, 16, false);
    // They ring the whole arena and move every frame: skip frustum culling instead of refreshing bounds.
    rock.alwaysSelectAsActiveMesh = true;
    this.rocks = this.add(rock, this.material("floating-rock", "#ffffff", 0.1));
    this.update(0);
  }

  // ------------------------------------------------------------ clouds

  private buildClouds(): void {
    const c = DECOR.clouds;
    const rng = new Rng(c.seed);
    const parts: Mesh[] = [];
    for (let i = 0; i < c.count; i++) {
      const a = (i / c.count) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const r = rng.range(c.radiusMin, c.radiusMax);
      const y = rng.range(c.yMin, c.yMax);
      for (let j = 0; j < c.parts; j++) {
        const s = CreateSphere("cloud-part", { diameter: rng.range(c.partSizeMin, c.partSizeMax), segments: 6 }, this.scene);
        s.scaling.y = c.flatten;
        const off = (j - (c.parts - 1) / 2) * c.partSpacing;
        s.position.set(Math.cos(a) * r - Math.sin(a) * off, y + rng.range(-1, 1), Math.sin(a) * r + Math.cos(a) * off + rng.range(-2, 2));
        parts.push(s);
      }
    }
    const clouds = Mesh.MergeMeshes(parts, true);
    if (!clouds) return;
    clouds.name = "decor-clouds";
    const mat = new StandardMaterial("cloud", this.scene);
    mat.diffuseColor = Color3.FromHexString(c.color);
    mat.emissiveColor = Color3.FromHexString(c.emissive);
    mat.specularColor = Color3.Black();
    this.materials.push(mat);
    this.add(clouds, mat);
  }
}
