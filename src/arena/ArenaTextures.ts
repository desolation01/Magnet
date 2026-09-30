import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Material } from "@babylonjs/core/Materials/material";
import { TEXTURES } from "../config";
import { Rng } from "../util/rng";
import { createStripeTexture, drawTexture, PERIOD, type TexKind } from "./ArenaTexturePaint";
import type { Arena, ArenaMeshTag, Platform } from "./Arena";

/**
 * Procedural arena textures and hazard edge trim (arena expansion spec §5).
 *
 * Every texture is drawn once, in grayscale, on a small canvas and multiplies the material's own color,
 * so the palette stays the same. UVs are rewritten in world units per mesh (tops: planar XZ, box sides:
 * planar along the face, cylinder sides: arc length), so one shared texture tiles at the same scale on
 * every mesh. Base platforms get two submeshes: textured top + rock sides.
 */

export class ArenaTextures {
  private readonly textures = new Map<TexKind, DynamicTexture>();
  /** Materials this class created (textured copies, multi-materials, trim). */
  private readonly owned: Material[] = [];
  /** Arena materials already given a texture kind (mutated in place) and copies made for other kinds. */
  private readonly claimed = new Map<StandardMaterial, TexKind>();
  private readonly copies = new Map<string, StandardMaterial>();
  private readonly multis = new Map<string, MultiMaterial>();
  private stripeTex: DynamicTexture | null = null;
  private trim: Mesh | null = null;
  private readonly rng = new Rng(TEXTURES.seed);

  constructor(private readonly scene: Scene, private readonly arena: Arena) {
    this.applyTextures();
    this.buildEdgeTrim();
  }

  private texture(kind: TexKind): DynamicTexture {
    let tex = this.textures.get(kind);
    if (!tex) {
      tex = drawTexture(this.scene, kind, this.rng);
      this.textures.set(kind, tex);
    }
    return tex;
  }

  /**
   * The mesh's material with `kind` as its diffuse texture. The first kind a shared arena material needs
   * is set on it directly (nothing else uses it untextured); other kinds get a copy with the same colors.
   */
  private textured(base: StandardMaterial, kind: TexKind, keepUntextured: boolean): StandardMaterial {
    if (!keepUntextured && (this.claimed.get(base) ?? kind) === kind) {
      this.claimed.set(base, kind);
      base.diffuseTexture = this.texture(kind);
      return base;
    }
    const key = `${base.uniqueId}|${kind}`;
    let mat = this.copies.get(key);
    if (!mat) {
      mat = new StandardMaterial(`${base.name}-${kind}`, this.scene);
      mat.diffuseColor.copyFrom(base.diffuseColor);
      mat.specularColor.copyFrom(base.specularColor);
      mat.specularPower = base.specularPower;
      mat.emissiveColor.copyFrom(base.emissiveColor);
      mat.ambientColor.copyFrom(base.ambientColor);
      mat.diffuseTexture = this.texture(kind);
      this.copies.set(key, mat);
      this.owned.push(mat);
    }
    return mat;
  }

  private applyTextures(): void {
    const styled: { mesh: Mesh; top: TexKind; side: TexKind | undefined }[] = [];
    const styledSet = new Set<Mesh>();
    for (const mesh of this.arena.staticMeshes) {
      const tag = mesh.metadata as ArenaMeshTag | null;
      const style = tag ? TEXTURES.surfaces[tag.surface] : undefined;
      if (!style || !(mesh.material instanceof StandardMaterial) || mesh.material.diffuseTexture) continue;
      styled.push({ mesh, top: style.top, side: style.side });
      styledSet.add(mesh);
    }
    // Arena materials also used by meshes we do not texture must stay untextured.
    const keep = new Set<Material>();
    for (const m of this.scene.meshes) {
      if (m.material && !styledSet.has(m as Mesh)) keep.add(m.material);
    }
    for (const { mesh, top, side } of styled) {
      const base = mesh.material as StandardMaterial;
      const topMat = this.textured(base, top, keep.has(base));
      if (!side || side === top) {
        this.writeUVs(mesh, PERIOD[top], PERIOD[top], false);
        mesh.material = topMat;
        continue;
      }
      const sideMat = this.textured(base, side, true);
      this.writeUVs(mesh, PERIOD[top], PERIOD[side], true);
      const key = `${topMat.uniqueId}|${sideMat.uniqueId}`;
      let multi = this.multis.get(key);
      if (!multi) {
        multi = new MultiMaterial(`${base.name}-multi`, this.scene);
        multi.subMaterials = [topMat, sideMat];
        this.multis.set(key, multi);
        this.owned.push(multi);
      }
      mesh.material = multi;
    }
  }

  /**
   * Rewrites UVs in world units. Up-facing faces use planar X/Z (with the mesh offset so neighbouring
   * platforms line up); box sides project along the face; cylinder sides use arc length (whole number of
   * repeats so the seam is invisible). With `split`, the index buffer is reordered into two submeshes:
   * top faces (material 0) and everything else (material 1).
   */
  private writeUVs(mesh: Mesh, topPeriod: number, sidePeriod: number, split: boolean): void {
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
    const nrm = mesh.getVerticesData(VertexBuffer.NormalKind);
    const oldUV = mesh.getVerticesData(VertexBuffer.UVKind);
    const indices = mesh.getIndices();
    if (!pos || !nrm || !indices) return;
    const count = pos.length / 3;
    const sx = Math.abs(mesh.scaling.x);
    const sy = Math.abs(mesh.scaling.y);
    const sz = Math.abs(mesh.scaling.z);
    const ox = mesh.position.x;
    const oy = mesh.position.y;
    const oz = mesh.position.z;

    // Cylinder-like meshes have side normals that are not axis-aligned.
    let cylinder = false;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < count; i++) {
      const nx = nrm[i * 3];
      const ny = nrm[i * 3 + 1];
      const nz = nrm[i * 3 + 2];
      if (Math.abs(ny) < 0.5 && Math.min(Math.abs(nx), Math.abs(nz)) > 0.01) cylinder = true;
      minX = Math.min(minX, pos[i * 3]);
      maxX = Math.max(maxX, pos[i * 3]);
    }
    const circumference = Math.PI * (maxX - minX) * sx;
    const repeats = Math.max(1, Math.round(circumference / sidePeriod));

    const uv = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = pos[i * 3] * sx;
      const y = pos[i * 3 + 1] * sy;
      const z = pos[i * 3 + 2] * sz;
      const nx = nrm[i * 3];
      const ny = nrm[i * 3 + 1];
      const nz = nrm[i * 3 + 2];
      if (Math.abs(ny) >= 0.5) {
        const p = ny > 0 ? topPeriod : sidePeriod;
        uv[i * 2] = (x + ox) / p;
        uv[i * 2 + 1] = (z + oz) / p;
      } else if (cylinder && oldUV) {
        uv[i * 2] = oldUV[i * 2] * repeats;
        uv[i * 2 + 1] = (y + oy) / sidePeriod;
      } else {
        uv[i * 2] = (Math.abs(nx) > Math.abs(nz) ? z + oz : x + ox) / sidePeriod;
        uv[i * 2 + 1] = (y + oy) / sidePeriod;
      }
    }
    mesh.setVerticesData(VertexBuffer.UVKind, uv, false);
    if (!split) return;

    // Top triangles first, then sides/bottom.
    const tops: number[] = [];
    const rest: number[] = [];
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t];
      const b = indices[t + 1];
      const c = indices[t + 2];
      const ny = nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1];
      (ny > 1.5 ? tops : rest).push(a, b, c);
    }
    const reordered = tops.concat(rest);
    mesh.setIndices(reordered, count);
    mesh.subMeshes = [];
    SubMesh.AddToMesh(0, 0, count, 0, tops.length, mesh);
    SubMesh.AddToMesh(1, 0, count, tops.length, rest.length, mesh);
  }

  // ---------------------------------------------------------------- hazard edge trim

  /**
   * One flat mesh with a hazard-stripe band along every base-platform rim, cut where a walkway meets the
   * rim. Visual only: not pickable, no physics, no ground/camera tags, casts no shadow.
   */
  private buildEdgeTrim(): void {
    const cfg = TEXTURES.trim;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const y = cfg.lift;
    const quad = (
      ox0: number, oz0: number, ix0: number, iz0: number, u0o: number, u0i: number,
      ox1: number, oz1: number, ix1: number, iz1: number, u1o: number, u1i: number, vIn: number,
    ): void => {
      const base = positions.length / 3;
      positions.push(ox0, y, oz0, ix0, y, iz0, ox1, y, oz1, ix1, y, iz1);
      uvs.push(u0o, 0, u0i, vIn, u1o, 0, u1i, vIn);
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    };

    for (const p of this.arena.platforms) {
      if (p.kind === "bridge") continue;
      const walkways = this.arena.walkways.filter((w) => w.ends!.includes(p));
      if (p.shape === "circle") this.circleTrim(p, walkways, quad);
      else this.rectTrim(p, walkways, quad);
    }
    if (indices.length === 0) return;

    const normals = new Array<number>(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      normals[i] = 0;
      normals[i + 1] = 1;
      normals[i + 2] = 0;
    }
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.uvs = uvs;
    const mesh = new Mesh("edge-trim", this.scene);
    data.applyToMesh(mesh, false);
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.metadata = null;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;

    this.stripeTex = createStripeTexture(this.scene);
    const mat = new StandardMaterial("edge-trim", this.scene);
    mat.diffuseTexture = this.stripeTex;
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    mat.backFaceCulling = false;
    mat.zOffset = -1; // extra safety against z-fighting with the platform top at grazing angles
    mesh.material = mat;
    this.owned.push(mat);
    this.trim = mesh;
  }

  /** Walkway cut on a rim point: within the walkway's half width (+ margin) on the walkway's side of the platform. */
  private static cutInfo(p: Platform, w: Platform): { ax: number; az: number; lo: number; hi: number } {
    // Axis direction pointing from the platform toward the walkway.
    const s = (w.cx - p.cx) * w.axisX + (w.cz - p.cz) * w.axisZ >= 0 ? 1 : -1;
    const ax = w.axisX * s;
    const az = w.axisZ * s;
    const half = w.halfWidth + TEXTURES.trim.entranceMargin;
    return { ax, az, lo: -half, hi: half };
  }

  private static lateral(w: Platform, ax: number, az: number, x: number, z: number): number {
    return ax * (z - w.cz) - az * (x - w.cx);
  }

  private circleTrim(p: Platform, walkways: Platform[], quad: QuadFn): void {
    const cfg = TEXTURES.trim;
    const R = p.radius;
    const r = R - cfg.width;
    const circumference = Math.PI * 2 * R;
    const period = circumference / Math.max(1, Math.round(circumference / cfg.stripePeriod));
    // Cut angle intervals (relative to 0..2π, may wrap).
    const cuts: [number, number][] = [];
    for (const w of walkways) {
      const { ax, az, lo, hi } = ArenaTextures.cutInfo(p, w);
      const thetaW = Math.atan2(az, ax);
      const d0 = ArenaTextures.lateral(w, ax, az, p.cx, p.cz);
      // lateral(θ) = R·sin(θ − θw) + d0
      const a = Math.asin(Math.max(-1, Math.min(1, (lo - d0) / R)));
      const b = Math.asin(Math.max(-1, Math.min(1, (hi - d0) / R)));
      cuts.push([thetaW + a, thetaW + b]);
    }
    const kept = keptIntervals(cuts, Math.PI * 2);
    const vIn = cfg.width / period;
    for (const [t0, t1] of kept) {
      const n = Math.max(1, Math.ceil(((t1 - t0) * R) / cfg.segment));
      for (let i = 0; i < n; i++) {
        const a0 = t0 + ((t1 - t0) * i) / n;
        const a1 = t0 + ((t1 - t0) * (i + 1)) / n;
        const c0 = Math.cos(a0);
        const s0 = Math.sin(a0);
        const c1 = Math.cos(a1);
        const s1 = Math.sin(a1);
        const u0 = (a0 * R) / period;
        const u1 = (a1 * R) / period;
        quad(
          p.cx + c0 * R, p.cz + s0 * R, p.cx + c0 * r, p.cz + s0 * r, u0, u0,
          p.cx + c1 * R, p.cz + s1 * R, p.cx + c1 * r, p.cz + s1 * r, u1, u1, vIn,
        );
      }
    }
  }

  private rectTrim(p: Platform, walkways: Platform[], quad: QuadFn): void {
    const cfg = TEXTURES.trim;
    const W = cfg.width;
    const perimeter = 4 * (p.hx + p.hz);
    const period = perimeter / Math.max(1, Math.round(perimeter / cfg.stripePeriod));
    const vIn = W / period;
    // Corners in order; each edge runs from corner i to corner i+1, with an inward normal.
    const corners: [number, number][] = [
      [p.cx - p.hx, p.cz - p.hz], [p.cx + p.hx, p.cz - p.hz], [p.cx + p.hx, p.cz + p.hz], [p.cx - p.hx, p.cz + p.hz],
    ];
    let sStart = 0;
    for (let e = 0; e < 4; e++) {
      const [x0, z0] = corners[e];
      const [x1, z1] = corners[(e + 1) % 4];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const dx = (x1 - x0) / len;
      const dz = (z1 - z0) / len;
      // Inward normal: toward the platform center.
      let nx = -dz;
      let nz = dx;
      if ((p.cx - x0) * nx + (p.cz - z0) * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const cuts: [number, number][] = [];
      for (const w of walkways) {
        const { ax, az, lo, hi } = ArenaTextures.cutInfo(p, w);
        const l0 = ArenaTextures.lateral(w, ax, az, x0, z0);
        const l1 = ArenaTextures.lateral(w, ax, az, x1, z1);
        if (Math.abs(l1 - l0) < 1e-6) continue;
        let ta = (lo - l0) / (l1 - l0);
        let tb = (hi - l0) / (l1 - l0);
        if (ta > tb) [ta, tb] = [tb, ta];
        ta = Math.max(0, ta);
        tb = Math.min(1, tb);
        if (tb <= ta) continue;
        // Only on the walkway's side of the platform (the axis line also crosses the opposite edge).
        const tm = (ta + tb) / 2;
        if ((x0 + (x1 - x0) * tm - p.cx) * ax + (z0 + (z1 - z0) * tm - p.cz) * az <= 0) continue;
        cuts.push([ta * len, tb * len]);
      }
      for (const [a, b] of keptIntervals(cuts, len, false)) {
        // Inner corners are mitred: the inner edge is shortened by the band width at each corner.
        const ia = Math.min(Math.max(a, W), len - W);
        const ib = Math.min(Math.max(b, W), len - W);
        quad(
          x0 + dx * a, z0 + dz * a, x0 + dx * ia + nx * W, z0 + dz * ia + nz * W, (sStart + a) / period, (sStart + ia) / period,
          x0 + dx * b, z0 + dz * b, x0 + dx * ib + nx * W, z0 + dz * ib + nz * W, (sStart + b) / period, (sStart + ib) / period, vIn,
        );
      }
      sStart += len;
    }
  }

  dispose(): void {
    this.trim?.dispose();
    for (const m of this.owned) m.dispose();
    for (const base of this.claimed.keys()) base.diffuseTexture = null;
    for (const t of this.textures.values()) t.dispose();
    this.stripeTex?.dispose();
    this.textures.clear();
  }
}

type QuadFn = (
  ox0: number, oz0: number, ix0: number, iz0: number, u0o: number, u0i: number,
  ox1: number, oz1: number, ix1: number, iz1: number, u1o: number, u1i: number, vIn: number,
) => void;

/**
 * Complement of the cut intervals within [0, length). With `wrap`, cuts are taken modulo `length`
 * (angles) and a kept interval may run past `length` so it stays continuous.
 */
function keptIntervals(cuts: [number, number][], length: number, wrap = true): [number, number][] {
  const norm: [number, number][] = [];
  for (const [a0, b0] of cuts) {
    if (!wrap) {
      norm.push([a0, b0]);
      continue;
    }
    const a = ((a0 % length) + length) % length;
    const b = a + (b0 - a0);
    if (b > length) {
      norm.push([a, length], [0, b - length]);
    } else {
      norm.push([a, b]);
    }
  }
  norm.sort((p, q) => p[0] - q[0]);
  const kept: [number, number][] = [];
  let at = 0;
  for (const [a, b] of norm) {
    if (a > at) kept.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < length) kept.push([at, length]);
  // Join the pieces across the wrap point (0 = length) into one continuous interval.
  if (wrap && kept.length > 1 && kept[0][0] === 0 && kept[kept.length - 1][1] === length) {
    const first = kept.shift()!;
    kept[kept.length - 1][1] = length + first[1];
  }
  return kept;
}

/** Textures the arena's static meshes, builds the edge trim, and registers both for disposal with the arena. */
export function applyArenaTextures(scene: Scene, arena: Arena): ArenaTextures {
  const textures = new ArenaTextures(scene, arena);
  arena.disposables.push(textures);
  return textures;
}
