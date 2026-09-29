import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { AI, ARENA } from "../config";
import type { Rng } from "../util/rng";
import {
  BOXES, CYLINDERS, PLATFORMS, RAMPS, WALKWAYS,
  type PlatformDef, type PlatformKind, type SurfaceKind, type WalkwayDef,
} from "./ArenaLayout";

export type { PlatformKind, SurfaceKind } from "./ArenaLayout";

/** Footprint of a base platform or walkway, used for edge awareness (AGENTS.md §20) and routing. */
export interface Platform {
  name: string;
  kind: PlatformKind;
  shape: "circle" | "rect";
  cx: number;
  cz: number;
  radius: number; // circle only
  hx: number; // axis-aligned rect half extents (platforms only)
  hz: number;
  /** Walkways: unit axis pointing from `ends[0]` to `ends[1]`. */
  axisX: number;
  axisZ: number;
  /** Walkways: half length (along the axis, between the two platform rims) and half width. */
  halfLen: number;
  halfWidth: number;
  /** Walkways: the two platforms it connects. */
  ends: [Platform, Platform] | null;
  /** Routing graph index (platforms only, −1 for walkways). */
  node: number;
}

export interface EdgeInfo {
  platform: Platform | null;
  /** Distance to the edge of the platform below; negative when over a gap. */
  distance: number;
}

/** Tags stored in mesh.metadata. */
export interface ArenaMeshTag {
  ground: boolean;
  cameraBlock: boolean;
  surface: SurfaceKind;
}

/** Footprint of a static obstacle the AI should not pick as a destination. */
export interface Obstacle {
  x: number;
  z: number;
  hx: number; // rect half extents, or radius (hx) for circles
  hz: number;
  circle: boolean;
}

interface Pt {
  x: number;
  z: number;
}

export class Arena {
  /** Base platforms first (routing nodes), then walkways. */
  readonly platforms: Platform[] = [];
  readonly walkways: Platform[] = [];
  readonly obstacles: Obstacle[] = [];
  readonly staticMeshes: Mesh[] = [];
  /** Extra resources built on top of the arena (textures, trim), disposed with it. */
  readonly disposables: { dispose(): void }[] = [];
  private readonly nodes: Platform[] = [];
  private readonly aggregates: PhysicsAggregate[] = [];
  private readonly materials = new Map<string, StandardMaterial>();
  /** Shortest-path distances and first walkway between routing nodes. */
  private dist: number[][] = [];
  private nextHop: (Platform | null)[][] = [];
  private readonly tmp: Pt = { x: 0, z: 0 };

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator) {
    this.build();
    this.buildRoutes();
  }

  get hub(): Platform {
    return this.nodes[0];
  }

  private material(color: string): StandardMaterial {
    let mat = this.materials.get(color);
    if (!mat) {
      mat = new StandardMaterial(`arena-${color}`, this.scene);
      mat.diffuseColor = Color3.FromHexString(color);
      mat.specularColor = new Color3(0.08, 0.08, 0.08);
      mat.emissiveColor = Color3.FromHexString(color).scale(ARENA.emissiveFactor);
      this.materials.set(color, mat);
    }
    return mat;
  }

  private addStatic(mesh: Mesh, shape: PhysicsShapeType, color: string, surface: SurfaceKind, ground = true): Mesh {
    mesh.material = this.material(color);
    mesh.receiveShadows = true;
    mesh.metadata = { ground, cameraBlock: true, surface } satisfies ArenaMeshTag;
    this.shadows.addShadowCaster(mesh);
    this.aggregates.push(new PhysicsAggregate(mesh, shape, { mass: 0, friction: 0.6, restitution: 0.1 }, this.scene));
    mesh.freezeWorldMatrix();
    this.staticMeshes.push(mesh);
    return mesh;
  }

  private build(): void {
    for (const def of PLATFORMS) this.addPlatform(def);
    for (const def of WALKWAYS) this.addWalkway(def);

    const s = this.scene;
    for (const b of BOXES) {
      const mesh = CreateBox(b.name, { width: b.w, height: b.h, depth: b.d }, s);
      mesh.position.set(b.x, (b.y ?? 0) + b.h / 2, b.z);
      this.addStatic(mesh, PhysicsShapeType.BOX, b.color, b.surface, b.ground);
      if (b.obstacle) this.obstacles.push({ x: b.x, z: b.z, hx: b.w / 2, hz: b.d / 2, circle: false });
    }
    for (const c of CYLINDERS) {
      const mesh = CreateCylinder(c.name, { diameter: c.radius * 2, height: c.h, tessellation: c.tessellation }, s);
      mesh.position.set(c.x, c.h / 2, c.z);
      this.addStatic(mesh, PhysicsShapeType.CYLINDER, c.color, c.surface, c.ground);
      if (c.obstacle) this.obstacles.push({ x: c.x, z: c.z, hx: c.radius, hz: c.radius, circle: true });
    }
    for (const r of RAMPS) this.addRamp(r.name, r.x, r.z, r.riseDir, r.color);
  }

  private addPlatform(def: PlatformDef): void {
    const t = ARENA.platformThickness;
    const mesh = def.shape === "circle"
      ? CreateCylinder(def.name, { diameter: def.radius * 2, height: t, tessellation: def.kind === "hub" ? 64 : 36 }, this.scene)
      : CreateBox(def.name, { width: def.hx * 2, height: t, depth: def.hz * 2 }, this.scene);
    mesh.position.set(def.cx, -t / 2, def.cz);
    this.addStatic(mesh, def.shape === "circle" ? PhysicsShapeType.CYLINDER : PhysicsShapeType.BOX, def.color, def.kind);
    const p: Platform = {
      name: def.name, kind: def.kind, shape: def.shape, cx: def.cx, cz: def.cz, radius: def.radius, hx: def.hx, hz: def.hz,
      axisX: 0, axisZ: 0, halfLen: 0, halfWidth: 0, ends: null, node: this.nodes.length,
    };
    this.nodes.push(p);
    this.platforms.push(p);
  }

  /** Distance from a platform's center to its rim along the unit direction (dx, dz). */
  private static rimDistance(p: Platform, dx: number, dz: number): number {
    if (p.shape === "circle") return p.radius;
    const tx = Math.abs(dx) > 1e-6 ? p.hx / Math.abs(dx) : Infinity;
    const tz = Math.abs(dz) > 1e-6 ? p.hz / Math.abs(dz) : Infinity;
    return Math.min(tx, tz);
  }

  /** A straight walkway between two platforms, along the line between their centers. */
  private addWalkway(def: WalkwayDef): void {
    const a = this.nodes.find((n) => n.name === def.from);
    const b = this.nodes.find((n) => n.name === def.to);
    if (!a || !b) throw new Error(`walkway ${def.name}: unknown platform`);
    const len = Math.hypot(b.cx - a.cx, b.cz - a.cz);
    const ax = (b.cx - a.cx) / len;
    const az = (b.cz - a.cz) / len;
    const start = Arena.rimDistance(a, ax, az);
    const end = len - Arena.rimDistance(b, -ax, -az);
    const mid = (start + end) / 2;
    const cx = a.cx + ax * mid;
    const cz = a.cz + az * mid;

    const meshLen = end - start + ARENA.walkwayOverlap * 2;
    const mesh = CreateBox(def.name, { width: meshLen, height: ARENA.bridgeThickness, depth: def.width }, this.scene);
    // Babylon's rotation.y turns local +X toward (cos θ, −sin θ).
    mesh.rotation.y = Math.atan2(-az, ax);
    mesh.position.set(cx, -ARENA.bridgeThickness / 2 - ARENA.bridgeTopOffset, cz);
    this.addStatic(mesh, PhysicsShapeType.BOX, def.color, "walkway");

    const w: Platform = {
      name: def.name, kind: "bridge", shape: "rect", cx, cz, radius: 0, hx: 0, hz: 0,
      axisX: ax, axisZ: az, halfLen: (end - start) / 2, halfWidth: def.width / 2, ends: [a, b], node: -1,
    };
    this.walkways.push(w);
    this.platforms.push(w);
  }

  /** Ramp rising along ±X from y = 0 to the raised block top, centered at (cx, cz). */
  private addRamp(name: string, cx: number, cz: number, riseDir: 1 | -1, color: string): void {
    const rise = ARENA.raisedBlockHeight;
    const run = ARENA.rampLength;
    const angle = Math.atan2(rise, run);
    const len = Math.hypot(rise, run) + 0.3;
    const thick = 0.3;
    const ramp = CreateBox(name, { width: len, height: thick, depth: ARENA.rampWidth }, this.scene);
    ramp.rotation.z = riseDir * angle;
    const nx = -Math.sin(riseDir * angle);
    const ny = Math.cos(angle);
    ramp.position.set(cx - nx * (thick / 2), rise / 2 - ny * (thick / 2), cz);
    this.addStatic(ramp, PhysicsShapeType.BOX, color, "ramp");
  }

  // ---------------------------------------------------------------- routing graph

  /** All-pairs shortest paths over platforms (nodes) and walkways (edges); ≤ 9 nodes, built once. */
  private buildRoutes(): void {
    const n = this.nodes.length;
    this.dist = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
    this.nextHop = Array.from({ length: n }, () => Array.from({ length: n }, () => null as Platform | null));
    for (const w of this.walkways) {
      const [a, b] = w.ends!;
      const d = Math.hypot(b.cx - a.cx, b.cz - a.cz);
      this.dist[a.node][b.node] = this.dist[b.node][a.node] = d;
      this.nextHop[a.node][b.node] = this.nextHop[b.node][a.node] = w;
    }
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const d = this.dist[i][k] + this.dist[k][j];
          if (d < this.dist[i][j]) {
            this.dist[i][j] = d;
            this.nextHop[i][j] = this.nextHop[i][k];
          }
        }
      }
    }
  }

  /** Point `inset` inside `side`'s rim, on the walkway's centerline. */
  private walkwayEntry(w: Platform, side: Platform, inset: number, out: Pt): Pt {
    const sign = side === w.ends![0] ? -1 : 1;
    const along = w.halfLen + inset;
    out.x = w.cx + w.axisX * along * sign;
    out.z = w.cz + w.axisZ * along * sign;
    return out;
  }

  /** Graph distance from a routing node to a platform or walkway (via its nearer end). */
  private graphDist(from: Platform, to: Platform): number {
    if (to.node >= 0) return this.dist[from.node][to.node];
    const [a, b] = to.ends!;
    return Math.min(this.dist[from.node][a.node], this.dist[from.node][b.node]);
  }

  /**
   * Next point to walk toward when travelling between base platforms. Platforms connect only through
   * walkways, so paths go platform → walkway entry → along the walkway → next platform.
   */
  nextWaypoint(fx: number, fz: number, tx: number, tz: number, out: Pt): void {
    const from = this.edgeInfo(fx, fz).platform;
    let to = this.edgeInfo(tx, tz).platform;
    if (!to) {
      // Never walk toward a point over the void: use the nearest point on a platform instead.
      this.clampToPlatform(tx, tz, 1, out);
      tx = out.x;
      tz = out.z;
      to = this.edgeInfo(tx, tz).platform;
    }
    out.x = tx;
    out.z = tz;
    if (!from || !to || from === to) return;

    if (from.kind === "bridge") {
      // On a walkway: head for the end that is closer (in the graph) to the destination.
      const [a, b] = from.ends!;
      const end = to === a || to === b ? to : (this.graphDist(a, to) <= this.graphDist(b, to) ? a : b);
      this.walkwayEntry(from, end, AI.walkwayEntryInset, out);
      return;
    }

    let w: Platform | null;
    if (to.kind === "bridge") {
      const [a, b] = to.ends!;
      if (a === from || b === from) w = to;
      else w = this.nextHop[from.node][(this.dist[from.node][a.node] <= this.dist[from.node][b.node] ? a : b).node];
    } else {
      w = this.nextHop[from.node][to.node];
    }
    if (!w) return;
    const other = w.ends![0] === from ? w.ends![1] : w.ends![0];
    const entry = this.walkwayEntry(w, from, AI.walkwayEntryInset, this.tmp);
    // Lined up with the walkway and at (or past) its entry point: walk across to the far side.
    const perpX = -w.axisZ;
    const perpZ = w.axisX;
    const lateral = Math.abs((fx - w.cx) * perpX + (fz - w.cz) * perpZ);
    const outX = from === w.ends![0] ? w.axisX : -w.axisX;
    const outZ = from === w.ends![0] ? w.axisZ : -w.axisZ;
    const along = (fx - entry.x) * outX + (fz - entry.z) * outZ;
    if (lateral < AI.walkwayAlignLateral && along > -1.5) {
      this.walkwayEntry(w, other, AI.walkwayEntryInset, out);
    } else {
      out.x = entry.x;
      out.z = entry.z;
    }
  }

  // ---------------------------------------------------------------- edge queries

  /** Edge info for a world position (AGENTS.md §20). */
  edgeInfo(x: number, z: number): EdgeInfo {
    let bridge: Platform | null = null;
    // Where a platform edge meets a walkway, stepping forward is safe: never report DANGER there.
    const corridorMin = this.inWalkwayCorridor(x, z) ? AI.dangerEdge + 1 : 0;
    for (const p of this.platforms) {
      if (p.kind === "bridge") {
        if (!bridge && this.onWalkway(p, x, z, 0, 0)) bridge = p;
        continue;
      }
      if (p.shape === "circle") {
        const d = p.radius - Math.hypot(x - p.cx, z - p.cz);
        if (d >= 0) return { platform: p, distance: Math.max(d, corridorMin) };
      } else {
        const dx = p.hx - Math.abs(x - p.cx);
        const dz = p.hz - Math.abs(z - p.cz);
        if (dx >= 0 && dz >= 0) return { platform: p, distance: Math.max(Math.min(dx, dz), corridorMin) };
      }
    }
    // Walkways always count as WARNING (between the danger and safe thresholds).
    if (bridge) return { platform: bridge, distance: AI.dangerEdge + 1 };
    return { platform: null, distance: -1 };
  }

  /** True when (x, z) lies on the walkway footprint, extended by `extend` along and shrunk by `shrink` across. */
  private onWalkway(w: Platform, x: number, z: number, extend: number, shrink: number): boolean {
    const rx = x - w.cx;
    const rz = z - w.cz;
    const along = Math.abs(rx * w.axisX + rz * w.axisZ);
    const across = Math.abs(-rx * w.axisZ + rz * w.axisX);
    return along <= w.halfLen + extend && across <= w.halfWidth - shrink;
  }

  /** True when (x, z) lies in line with a walkway, near or on it. */
  private inWalkwayCorridor(x: number, z: number): boolean {
    for (const w of this.walkways) if (this.onWalkway(w, x, z, AI.walkwayCorridorExtend, 0.3)) return true;
    return false;
  }

  /** True when (x, z) lies inside (or within `margin` of) a static obstacle footprint. */
  isObstructed(x: number, z: number, margin: number): boolean {
    for (const o of this.obstacles) {
      if (o.circle) {
        if (Math.hypot(x - o.x, z - o.z) < o.hx + margin) return true;
      } else if (Math.abs(x - o.x) < o.hx + margin && Math.abs(z - o.z) < o.hz + margin) {
        return true;
      }
    }
    return false;
  }

  /**
   * Writes a random point on a random base platform (chosen by area), at least `margin` inside its rim.
   * Hub points stay within `hubRadius` of the center.
   */
  randomPoint(rng: Rng, margin: number, hubRadius: number, out: Pt): Platform {
    let total = 0;
    for (const p of this.nodes) total += Arena.area(p);
    let pick = rng.next() * total;
    let p = this.nodes[this.nodes.length - 1];
    for (const n of this.nodes) {
      pick -= Arena.area(n);
      if (pick <= 0) {
        p = n;
        break;
      }
    }
    if (p.shape === "circle") {
      const r = Math.sqrt(rng.next()) * (p.kind === "hub" ? Math.min(hubRadius, p.radius - margin) : p.radius - margin);
      const a = rng.range(0, Math.PI * 2);
      out.x = p.cx + Math.cos(a) * r;
      out.z = p.cz + Math.sin(a) * r;
    } else {
      out.x = p.cx + rng.range(-1, 1) * (p.hx - margin);
      out.z = p.cz + rng.range(-1, 1) * (p.hz - margin);
    }
    return p;
  }

  private static area(p: Platform): number {
    return p.shape === "circle" ? Math.PI * p.radius * p.radius : 4 * p.hx * p.hz;
  }

  /** Registers an extra obstacle footprint (bounce pads, island props). */
  addObstacle(o: Obstacle): void {
    this.obstacles.push(o);
  }

  /** Writes the nearest point that lies at least `margin` inside some base platform (excluding walkways). */
  clampToPlatform(x: number, z: number, margin: number, out: Pt): void {
    let best = Infinity;
    for (const p of this.nodes) {
      let px: number;
      let pz: number;
      if (p.shape === "circle") {
        const dx = x - p.cx;
        const dz = z - p.cz;
        const d = Math.hypot(dx, dz);
        const r = Math.max(0, p.radius - margin);
        const k = d > r ? r / d : 1;
        px = p.cx + dx * k;
        pz = p.cz + dz * k;
      } else {
        const hx = Math.max(0, p.hx - margin);
        const hz = Math.max(0, p.hz - margin);
        px = Math.min(p.cx + hx, Math.max(p.cx - hx, x));
        pz = Math.min(p.cz + hz, Math.max(p.cz - hz, z));
      }
      const d2 = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d2 < best) {
        best = d2;
        out.x = px;
        out.z = pz;
      }
    }
  }

  /** Signed distance of (x, z) from a walkway's centerline (positive on the left of its axis). */
  lateralOffset(w: Platform, x: number, z: number): number {
    return -(x - w.cx) * w.axisZ + (z - w.cz) * w.axisX;
  }

  /** The end platform of a walkway that (x, z) is closer to. */
  nearerEnd(w: Platform, x: number, z: number): Platform {
    const along = (x - w.cx) * w.axisX + (z - w.cz) * w.axisZ;
    return along < 0 ? w.ends![0] : w.ends![1];
  }

  /** Unit vector (XZ) pointing toward the nearest edge of the platform at (x, z). */
  outwardDir(x: number, z: number, out: Pt): void {
    const p = this.edgeInfo(x, z).platform;
    if (!p) {
      // Over the void: away from the nearest platform point.
      this.clampToPlatform(x, z, 0, this.tmp);
      Arena.normalize(x - this.tmp.x, z - this.tmp.z, x, z, out);
      return;
    }
    if (p.shape === "circle") {
      Arena.normalize(x - p.cx, z - p.cz, 1, 0, out);
      return;
    }
    if (p.kind === "bridge") {
      // Sideways off the walkway.
      const side = Math.sign(this.lateralOffset(p, x, z)) || 1;
      out.x = -p.axisZ * side;
      out.z = p.axisX * side;
      return;
    }
    const dx = p.hx - Math.abs(x - p.cx);
    const dz = p.hz - Math.abs(z - p.cz);
    if (dx < dz) {
      out.x = Math.sign(x - p.cx) || 1;
      out.z = 0;
    } else {
      out.x = 0;
      out.z = Math.sign(z - p.cz) || 1;
    }
  }

  private static normalize(x: number, z: number, fallbackX: number, fallbackZ: number, out: Pt): void {
    let len = Math.hypot(x, z);
    if (len < 0.01) {
      x = fallbackX;
      z = fallbackZ;
      len = Math.hypot(x, z) || 1;
      if (len < 0.01) {
        x = 1;
        z = 0;
        len = 1;
      }
    }
    out.x = x / len;
    out.z = z / len;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const a of this.aggregates) a.dispose();
    for (const m of this.staticMeshes) m.dispose();
    for (const mat of this.materials.values()) mat.dispose();
  }
}
