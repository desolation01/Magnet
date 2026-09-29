import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { AI, ARENA, COLORS } from "../config";

export type PlatformKind = "central" | "outer" | "bridge";

/** Footprint of a base platform, used for edge awareness (AGENTS.md §20). */
export interface Platform {
  name: string;
  kind: PlatformKind;
  shape: "circle" | "rect";
  cx: number;
  cz: number;
  radius: number; // circle only
  hx: number; // rect half extents
  hz: number;
  /** Bridges only: unit axis pointing from the central platform outward. */
  axisX: number;
  axisZ: number;
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
}

/** Footprint of a static obstacle the AI should not pick as a destination. */
interface Obstacle {
  x: number;
  z: number;
  hx: number; // rect half extents, or radius (hx) for circles
  hz: number;
  circle: boolean;
}

export class Arena {
  readonly platforms: Platform[] = [];
  private readonly obstacles: Obstacle[] = [];
  readonly staticMeshes: Mesh[] = [];
  private readonly aggregates: PhysicsAggregate[] = [];
  private readonly materials = new Map<string, StandardMaterial>();

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator) {
    this.build();
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

  private addStatic(mesh: Mesh, shape: PhysicsShapeType, color: string, ground = true): Mesh {
    mesh.material = this.material(color);
    mesh.receiveShadows = true;
    mesh.metadata = { ground, cameraBlock: true } satisfies ArenaMeshTag;
    this.shadows.addShadowCaster(mesh);
    this.aggregates.push(new PhysicsAggregate(mesh, shape, { mass: 0, friction: 0.6, restitution: 0.1 }, this.scene));
    mesh.freezeWorldMatrix();
    this.staticMeshes.push(mesh);
    return mesh;
  }

  private build(): void {
    const s = this.scene;
    const t = ARENA.platformThickness;

    // Central platform
    const central = CreateCylinder("central", { diameter: ARENA.centralRadius * 2, height: t, tessellation: 48 }, s);
    central.position.set(0, -t / 2, 0);
    this.addStatic(central, PhysicsShapeType.CYLINDER, COLORS.centralPlatform);
    this.platforms.push({ name: "central", kind: "central", shape: "circle", cx: 0, cz: 0, radius: ARENA.centralRadius, hx: 0, hz: 0, axisX: 0, axisZ: 0 });

    // Outer platforms + bridges (N = −Z, S = +Z, E = +X, W = −X)
    const dirs: { name: string; x: number; z: number }[] = [
      { name: "N", x: 0, z: -1 },
      { name: "S", x: 0, z: 1 },
      { name: "E", x: 1, z: 0 },
      { name: "W", x: -1, z: 0 },
    ];
    const half = ARENA.outerSize / 2;
    const innerEdge = ARENA.outerDistance - half; // 19
    dirs.forEach((d, i) => {
      const outer = CreateBox(`outer-${d.name}`, { width: ARENA.outerSize, height: t, depth: ARENA.outerSize }, s);
      outer.position.set(d.x * ARENA.outerDistance, -t / 2, d.z * ARENA.outerDistance);
      this.addStatic(outer, PhysicsShapeType.BOX, COLORS.outerPlatforms[i]);
      this.platforms.push({
        name: `outer-${d.name}`, kind: "outer", shape: "rect",
        cx: outer.position.x, cz: outer.position.z, radius: 0, hx: half, hz: half, axisX: d.x, axisZ: d.z,
      });

      // Bridge from slightly inside the central rim to slightly inside the outer platform.
      const start = ARENA.centralRadius - 0.5;
      const end = innerEdge + 0.5;
      const len = end - start;
      const mid = (start + end) / 2;
      const alongX = d.x !== 0;
      const bridge = CreateBox(`bridge-${d.name}`, {
        width: alongX ? len : ARENA.bridgeWidth,
        height: ARENA.bridgeThickness,
        depth: alongX ? ARENA.bridgeWidth : len,
      }, s);
      bridge.position.set(d.x * mid, -ARENA.bridgeThickness / 2 - ARENA.bridgeTopOffset, d.z * mid);
      this.addStatic(bridge, PhysicsShapeType.BOX, COLORS.bridge);
      const bHalfLen = (innerEdge - ARENA.centralRadius) / 2;
      const bMid = (innerEdge + ARENA.centralRadius) / 2;
      this.platforms.push({
        name: `bridge-${d.name}`, kind: "bridge", shape: "rect",
        cx: d.x * bMid, cz: d.z * bMid, radius: 0,
        hx: alongX ? bHalfLen : ARENA.bridgeWidth / 2,
        hz: alongX ? ARENA.bridgeWidth / 2 : bHalfLen,
        axisX: d.x, axisZ: d.z,
      });
    });

    // Raised blocks with ramps (AGENTS.md §5.2)
    const bs = ARENA.raisedBlockSize;
    const bh = ARENA.raisedBlockHeight;
    for (const [bx, bz] of [[6, -6], [-6, 6]] as const) {
      const block = CreateBox("raised-block", { width: bs, height: bh, depth: bs }, s);
      block.position.set(bx, bh / 2, bz);
      this.addStatic(block, PhysicsShapeType.BOX, COLORS.raisedBlock);
      this.obstacles.push({ x: bx, z: bz, hx: bs / 2, hz: bs / 2, circle: false });
    }
    this.addRamp(1, -6, 1);
    this.addRamp(-1, 6, -1);

    // Pillars
    for (const [px, pz] of [[6.4, 6.4], [-6.4, -6.4], [3, 10], [-3, -10]] as const) {
      const pillar = CreateCylinder("pillar", { diameter: ARENA.pillarRadius * 2, height: ARENA.pillarHeight, tessellation: 16 }, s);
      pillar.position.set(px, ARENA.pillarHeight / 2, pz);
      this.addStatic(pillar, PhysicsShapeType.CYLINDER, COLORS.pillar, false);
      this.obstacles.push({ x: px, z: pz, hx: ARENA.pillarRadius, hz: ARENA.pillarRadius, circle: true });
    }

    // Low walls along the outer edges of E and W
    for (const x of [28.5, -28.5]) {
      const wall = CreateBox("wall", { width: ARENA.wallThickness, height: ARENA.wallHeight, depth: ARENA.wallLength }, s);
      wall.position.set(x, ARENA.wallHeight / 2, 0);
      this.addStatic(wall, PhysicsShapeType.BOX, COLORS.wall, false);
    }
  }

  /** Ramp rising along ±X from y = 0 to the raised block top, centered at (cx, cz). */
  private addRamp(cx: number, cz: number, riseDir: 1 | -1): void {
    const rise = ARENA.raisedBlockHeight;
    const run = ARENA.rampLength;
    const angle = Math.atan2(rise, run);
    const len = Math.hypot(rise, run) + 0.3;
    const thick = 0.3;
    const ramp = CreateBox("ramp", { width: len, height: thick, depth: ARENA.rampWidth }, this.scene);
    ramp.rotation.z = riseDir * angle;
    const nx = -Math.sin(riseDir * angle);
    const ny = Math.cos(angle);
    ramp.position.set(cx - nx * (thick / 2), rise / 2 - ny * (thick / 2), cz);
    this.addStatic(ramp, PhysicsShapeType.BOX, COLORS.ramp);
  }

  /** Edge info for a world position (AGENTS.md §20). */
  edgeInfo(x: number, z: number): EdgeInfo {
    let bridge: Platform | null = null;
    // Where a platform edge meets a bridge, stepping forward is safe: never report DANGER there.
    const corridorMin = this.inBridgeCorridor(x, z) ? AI.dangerEdge + 1 : 0;
    for (const p of this.platforms) {
      if (p.shape === "circle") {
        const d = p.radius - Math.hypot(x - p.cx, z - p.cz);
        if (d >= 0) return { platform: p, distance: Math.max(d, corridorMin) };
      } else {
        const dx = p.hx - Math.abs(x - p.cx);
        const dz = p.hz - Math.abs(z - p.cz);
        if (dx >= 0 && dz >= 0) {
          if (p.kind === "bridge") {
            bridge = p;
            continue;
          }
          return { platform: p, distance: Math.max(Math.min(dx, dz), corridorMin) };
        }
      }
    }
    // Bridges always count as WARNING (between the danger and safe thresholds).
    if (bridge) return { platform: bridge, distance: AI.dangerEdge + 1 };
    return { platform: null, distance: -1 };
  }

  /** True when (x, z) lies in line with a bridge, between the central rim and the outer platform. */
  private inBridgeCorridor(x: number, z: number): boolean {
    const half = ARENA.bridgeWidth / 2 - 0.3;
    const inner = ARENA.centralRadius - 3;
    const outer = ARENA.outerDistance - ARENA.outerSize / 2 + 2;
    const ax = Math.abs(x);
    const az = Math.abs(z);
    return (Math.abs(z) <= half && ax >= inner && ax <= outer) || (Math.abs(x) <= half && az >= inner && az <= outer);
  }

  /** True when (x, z) lies inside (or within `margin` of) a raised block or pillar footprint. */
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

  /** Writes the nearest point that lies at least `margin` inside some base platform (excluding bridges). */
  clampToPlatform(x: number, z: number, margin: number, out: { x: number; z: number }): void {
    let best = Infinity;
    for (const p of this.platforms) {
      if (p.kind === "bridge") continue;
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

  /** Unit vector (XZ) pointing toward the nearest edge of the platform at (x, z). */
  outwardDir(x: number, z: number, out: { x: number; z: number }): void {
    const info = this.edgeInfo(x, z);
    const p = info.platform;
    if (!p || p.shape === "circle") {
      const len = Math.hypot(x, z);
      if (len < 0.01) {
        out.x = 1;
        out.z = 0;
      } else {
        out.x = x / len;
        out.z = z / len;
      }
      return;
    }
    if (p.kind === "bridge") {
      // Sideways off the bridge.
      const side = p.axisX !== 0 ? Math.sign(z - p.cz) || 1 : Math.sign(x - p.cx) || 1;
      out.x = p.axisX !== 0 ? 0 : side;
      out.z = p.axisX !== 0 ? side : 0;
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

  /**
   * Next point to walk toward when travelling from one base platform to another.
   * Platforms connect only through bridges, so paths go center ↔ bridge ↔ outer platform.
   */
  nextWaypoint(fx: number, fz: number, tx: number, tz: number, out: { x: number; z: number }): void {
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
    const onCentral = from.kind === "central";
    const toCentral = to.kind === "central";
    const bridgeEntry = ARENA.centralRadius - 2; // point on the central platform in front of a bridge
    const outerEntry = ARENA.outerDistance - ARENA.outerSize / 2 + 1.5; // point on an outer platform in front of its bridge

    if (onCentral) {
      // Head to the bridge entrance of the destination's arm, then along the axis.
      const ax = to.axisX;
      const az = to.axisZ;
      const ex = ax * bridgeEntry;
      const ez = az * bridgeEntry;
      const lateral = Math.abs(ax !== 0 ? fz : fx);
      const along = ax * fx + az * fz;
      if (lateral < 0.8 && along > bridgeEntry - 1.5) {
        out.x = ax * ARENA.outerDistance;
        out.z = az * ARENA.outerDistance;
      } else {
        out.x = ex;
        out.z = ez;
      }
      return;
    }

    // On an outer platform or bridge: go back toward the central platform along the axis.
    const ax = from.axisX;
    const az = from.axisZ;
    if (from.kind === "bridge" && !toCentral && to.axisX === ax && to.axisZ === az) {
      out.x = ax * ARENA.outerDistance;
      out.z = az * ARENA.outerDistance;
      return;
    }
    const lateral = Math.abs(ax !== 0 ? fz : fx);
    if (from.kind === "outer" && lateral > 0.8) {
      out.x = ax * outerEntry;
      out.z = az * outerEntry;
    } else {
      out.x = ax * (bridgeEntry - 3);
      out.z = az * (bridgeEntry - 3);
    }
  }

  dispose(): void {
    for (const a of this.aggregates) a.dispose();
    for (const m of this.staticMeshes) m.dispose();
    for (const mat of this.materials.values()) mat.dispose();
  }
}

