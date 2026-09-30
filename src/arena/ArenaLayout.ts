import { ARENA, COLORS, DECOR } from "../config";

/**
 * The arena as data (docs/superpowers/specs/2026-09-29-arena-expansion-design.md §1–2).
 * Arena.ts builds geometry, edge footprints and the routing graph from these lists.
 * Coordinates: N = −Z, E = +X; base platform tops at y = 0.
 */

export type PlatformKind = "hub" | "cardinal" | "island" | "bridge";

/** Surface tag stored on every static arena mesh (metadata.surface), used for textures. */
export type SurfaceKind =
  | "hub" | "cardinal" | "island" | "walkway" | "block" | "ramp" | "pillar" | "wall"
  | "crystal" | "scrap" | "trunk" | "tower" | "pad";

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
  /** Yaw in radians (default 0). Rotated boxes register their axis-aligned bounds as the obstacle footprint. */
  rotY?: number;
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

// ---------------------------------------------------------------- island themes (spec §2)

/**
 * A point on a diagonal island, `out` units from its center away from the hub and `side` units across.
 * Catwalks enter each island from its two neighbouring cardinals, so the hub-facing half carries the
 * walking routes between them and every theme piece sits on the outward half, off the entry lines.
 * `yaw` turns a box's local +Z toward the outward direction (local +X then runs across it).
 */
function islandPoint(island: string, out: number, side: number): { x: number; z: number; yaw: number } {
  const p = PLATFORMS.find((d) => d.name === island)!;
  const len = Math.hypot(p.cx, p.cz);
  const ux = p.cx / len;
  const uz = p.cz / len;
  return { x: p.cx + ux * out - uz * side, z: p.cz + uz * out + ux * side, yaw: Math.atan2(ux, uz) };
}

const T = DECOR.themes;

const themeBox = (
  name: string, at: { x: number; z: number; yaw: number }, w: number, h: number, d: number,
  color: string, surface: SurfaceKind, yawOffset = 0,
): BoxDef => ({ name, x: at.x, z: at.z, w, h, d, rotY: at.yaw + yawOffset, color, surface, ground: true, obstacle: true });

// NW lookout tower: a 3×3×3 box turned to face the hub. Three 1-unit steps (tops at 1, 2 and 3) stand
// side by side against its hub-facing wall, so the climb runs across the wall and the island center stays free.
const tower = T.tower;
const stepOut = tower.distance - tower.size / 2 - tower.stepDepth / 2;
const stepWidth = tower.size / 3;
const towerSteps: BoxDef[] = [0, 1, 2].map((k) => themeBox(
  `tower-step-${k + 1}`, islandPoint("NW", stepOut, (1 - k) * stepWidth),
  stepWidth, (k + 1) * tower.stepRise, tower.stepDepth, tower.color, "tower",
));

const ISLAND_BOXES: BoxDef[] = [
  // SE scrapyard: two scrap piles on the outward half, turned a little so they do not read as crates.
  themeBox("scrap-pile-1", islandPoint("SE", 3, 2.1), 2.2, T.scrap.height, 1.8, T.scrap.color, "scrap", 0.35),
  themeBox("scrap-pile-2", islandPoint("SE", 2.9, -2.2), 1.8, T.scrap.height - 0.2, 2.2, T.scrap.color, "scrap", -0.5),
  themeBox("lookout-tower", islandPoint("NW", tower.distance, 0), tower.size, tower.size, tower.size, tower.color, "tower"),
  ...towerSteps,
];

const trunk = (name: string, at: { x: number; z: number }): CylinderDef => ({
  name, x: at.x, z: at.z, radius: T.trunk.radius, h: T.trunk.height, tessellation: 8,
  color: T.trunk.color, surface: "trunk", ground: false, obstacle: true,
});

const ISLAND_CYLINDERS: CylinderDef[] = [
  // NE crystal garden: one large hexagonal crystal, off-center on the outward half (hex-prism collider).
  {
    name: "crystal", x: islandPoint("NE", 3.3, 0.6).x, z: islandPoint("NE", 3.3, 0.6).z,
    radius: T.crystal.radius, h: T.crystal.height, tessellation: 6,
    color: T.crystal.color, surface: "crystal", ground: true, obstacle: true,
  },
  // SW grove: three trees. The trunks collide; the canopies are ArenaDecor dressing.
  trunk("tree-1", islandPoint("SW", 3.6, 0)),
  trunk("tree-2", islandPoint("SW", 1.2, 3)),
  trunk("tree-3", islandPoint("SW", 1.4, -3)),
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
  ...ISLAND_BOXES,
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
  ...ISLAND_CYLINDERS,
];

/** Ramps join the raised blocks: A on its west side, B on its east side. */
export const RAMPS: RampDef[] = [
  { name: "ramp-A", x: 9 - bs / 2 - ARENA.rampLength / 2, z: -4, riseDir: 1, color: COLORS.ramp },
  { name: "ramp-B", x: -9 + bs / 2 + ARENA.rampLength / 2, z: 4, riseDir: -1, color: COLORS.ramp },
];
