import { ARENA, COLORS } from "../config";

/**
 * The arena as data (docs/superpowers/specs/2026-09-29-arena-expansion-design.md §1–2).
 * Arena.ts builds geometry, edge footprints and the routing graph from these lists.
 * Coordinates: N = −Z, E = +X; base platform tops at y = 0.
 */

export type PlatformKind = "hub" | "cardinal" | "island" | "bridge";

/** Surface tag stored on every static arena mesh (metadata.surface), used for textures. */
export type SurfaceKind = "hub" | "cardinal" | "island" | "walkway" | "block" | "ramp" | "pillar" | "wall" | "pad";

export interface PlatformDef {
  name: string;
  kind: Exclude<PlatformKind, "bridge">;
  shape: "circle" | "rect";
  cx: number;
  cz: number;
  radius: number; // circle only
  hx: number; // rect half extents
  hz: number;
  color: string;
}

export interface WalkwayDef {
  name: string;
  /** Platform names. The walkway axis points from `from` to `to`. */
  from: string;
  to: string;
  width: number;
  color: string;
}

export interface BoxDef {
  name: string;
  x: number;
  z: number;
  /** Full sizes. */
  w: number;
  h: number;
  d: number;
  /** Bottom of the box (default 0 = standing on the platform). */
  y?: number;
  color: string;
  surface: SurfaceKind;
  /** Characters can stand on it (grounded check). */
  ground: boolean;
  /** AI wander/flank points avoid it. */
  obstacle: boolean;
}

export interface CylinderDef {
  name: string;
  x: number;
  z: number;
  radius: number;
  h: number;
  tessellation: number;
  color: string;
  surface: SurfaceKind;
  ground: boolean;
  obstacle: boolean;
}

export interface RampDef {
  name: string;
  /** Center of the ramp footprint. */
  x: number;
  z: number;
  /** +1: rises toward +X, −1: rises toward −X. */
  riseDir: 1 | -1;
  color: string;
}

const C = ARENA.cardinalDistance;
const H = ARENA.cardinalSize / 2;
const I = ARENA.islandOffset;

export const PLATFORMS: PlatformDef[] = [
  { name: "hub", kind: "hub", shape: "circle", cx: 0, cz: 0, radius: ARENA.hubRadius, hx: 0, hz: 0, color: COLORS.centralPlatform },
  { name: "N", kind: "cardinal", shape: "rect", cx: 0, cz: -C, radius: 0, hx: H, hz: H, color: COLORS.cardinalPlatforms[0] },
  { name: "S", kind: "cardinal", shape: "rect", cx: 0, cz: C, radius: 0, hx: H, hz: H, color: COLORS.cardinalPlatforms[1] },
  { name: "E", kind: "cardinal", shape: "rect", cx: C, cz: 0, radius: 0, hx: H, hz: H, color: COLORS.cardinalPlatforms[2] },
  { name: "W", kind: "cardinal", shape: "rect", cx: -C, cz: 0, radius: 0, hx: H, hz: H, color: COLORS.cardinalPlatforms[3] },
  { name: "NE", kind: "island", shape: "circle", cx: I, cz: -I, radius: ARENA.islandRadius, hx: 0, hz: 0, color: COLORS.islandPlatforms[0] },
  { name: "SE", kind: "island", shape: "circle", cx: I, cz: I, radius: ARENA.islandRadius, hx: 0, hz: 0, color: COLORS.islandPlatforms[1] },
  { name: "SW", kind: "island", shape: "circle", cx: -I, cz: I, radius: ARENA.islandRadius, hx: 0, hz: 0, color: COLORS.islandPlatforms[2] },
  { name: "NW", kind: "island", shape: "circle", cx: -I, cz: -I, radius: ARENA.islandRadius, hx: 0, hz: 0, color: COLORS.islandPlatforms[3] },
];

const spoke = (to: string): WalkwayDef => ({ name: `spoke-${to}`, from: "hub", to, width: ARENA.spokeWidth, color: COLORS.bridge });
const catwalk = (from: string, to: string): WalkwayDef => ({ name: `catwalk-${from}-${to}`, from, to, width: ARENA.catwalkWidth, color: COLORS.catwalk });

export const WALKWAYS: WalkwayDef[] = [
  spoke("N"), spoke("S"), spoke("E"), spoke("W"),
  catwalk("N", "NE"), catwalk("N", "NW"),
  catwalk("S", "SE"), catwalk("S", "SW"),
  catwalk("E", "NE"), catwalk("E", "SE"),
  catwalk("W", "NW"), catwalk("W", "SW"),
];

const bs = ARENA.raisedBlockSize;
const bh = ARENA.raisedBlockHeight;
const wh = ARENA.wallHeight;
const edge = C + H - ARENA.wallThickness; // outer-edge walls sit just inside the platform rim
const railX = H - ARENA.guardRailLength / 2 - 0.5; // N/S rails hug the outer corners

/** Hub point symmetry: (x, z) mirrors (−x, −z). */
export const BOXES: BoxDef[] = [
  { name: "raised-block-A", x: 9, z: -4, w: bs, h: bh, d: bs, color: COLORS.raisedBlock, surface: "block", ground: true, obstacle: true },
  { name: "raised-block-B", x: -9, z: 4, w: bs, h: bh, d: bs, color: COLORS.raisedBlock, surface: "block", ground: true, obstacle: true },
  { name: "cover-wall-E", x: 14, z: 3.5, w: ARENA.coverWallThickness, h: wh, d: ARENA.coverWallLength, color: COLORS.coverWall, surface: "wall", ground: false, obstacle: true },
  { name: "cover-wall-W", x: -14, z: -3.5, w: ARENA.coverWallThickness, h: wh, d: ARENA.coverWallLength, color: COLORS.coverWall, surface: "wall", ground: false, obstacle: true },
  { name: "guard-wall-E", x: edge, z: 0, w: ARENA.wallThickness, h: wh, d: ARENA.guardWallLength, color: COLORS.wall, surface: "wall", ground: false, obstacle: false },
  { name: "guard-wall-W", x: -edge, z: 0, w: ARENA.wallThickness, h: wh, d: ARENA.guardWallLength, color: COLORS.wall, surface: "wall", ground: false, obstacle: false },
  { name: "guard-rail-N1", x: railX, z: -edge, w: ARENA.guardRailLength, h: wh, d: ARENA.wallThickness, color: COLORS.wall, surface: "wall", ground: false, obstacle: false },
  { name: "guard-rail-N2", x: -railX, z: -edge, w: ARENA.guardRailLength, h: wh, d: ARENA.wallThickness, color: COLORS.wall, surface: "wall", ground: false, obstacle: false },
  { name: "guard-rail-S1", x: railX, z: edge, w: ARENA.guardRailLength, h: wh, d: ARENA.wallThickness, color: COLORS.wall, surface: "wall", ground: false, obstacle: false },
  { name: "guard-rail-S2", x: -railX, z: edge, w: ARENA.guardRailLength, h: wh, d: ARENA.wallThickness, color: COLORS.wall, surface: "wall", ground: false, obstacle: false },
];

const pillar = (name: string, x: number, z: number): CylinderDef => ({
  name, x, z, radius: ARENA.pillarRadius, h: ARENA.pillarHeight, tessellation: 16,
  color: COLORS.pillar, surface: "pillar", ground: false, obstacle: true,
});

export const CYLINDERS: CylinderDef[] = [
  pillar("pillar-1", 11, 7),
  pillar("pillar-2", -11, -7),
  pillar("pillar-3", 4, 14),
  pillar("pillar-4", -4, -14),
];

/** Ramps join the raised blocks: A on its west side, B on its east side. */
export const RAMPS: RampDef[] = [
  { name: "ramp-A", x: 9 - bs / 2 - ARENA.rampLength / 2, z: -4, riseDir: 1, color: COLORS.ramp },
  { name: "ramp-B", x: -9 + bs / 2 + ARENA.rampLength / 2, z: 4, riseDir: -1, color: COLORS.ramp },
];
