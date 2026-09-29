import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Scene } from "@babylonjs/core/scene";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { TEXTURES } from "../config";
import { Rng } from "../util/rng";

/**
 * Procedural texture painting for the arena (arena expansion spec §5). Every texture is drawn once,
 * in grayscale, on a small canvas (except the colored hazard stripes); all of them tile seamlessly.
 */

export type TexKind = "tiles" | "plates" | "turf" | "planks" | "rock" | "bricks";

const SIZE = TEXTURES.size;

/** World size of one repeat of each texture. */
export const PERIOD: Record<TexKind, number> = {
  tiles: TEXTURES.tiles.period,
  plates: TEXTURES.plates.period,
  turf: TEXTURES.turf.period,
  planks: TEXTURES.planks.period,
  rock: TEXTURES.rock.period,
  bricks: TEXTURES.bricks.period,
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Value noise that wraps every `cells` grid cells over the texture (seamless tiling). */
function wrapNoise(rng: Rng, cells: number): (x: number, y: number) => number {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const step = SIZE / cells;
  return (x, y) => {
    const gx = x / step;
    const gy = y / step;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = smooth(gx - x0);
    const ty = smooth(gy - y0);
    const i0 = ((x0 % cells) + cells) % cells;
    const j0 = ((y0 % cells) + cells) % cells;
    const i1 = (i0 + 1) % cells;
    const j1 = (j0 + 1) % cells;
    const a = lerp(grid[j0 * cells + i0], grid[j0 * cells + i1], tx);
    const b = lerp(grid[j1 * cells + i0], grid[j1 * cells + i1], tx);
    return lerp(a, b, ty);
  };
}

/** Fills a texture pixel by pixel from a grayscale function and returns it (wrap on, mipmapped). */
function paint(scene: Scene, name: string, size: number, fn: (x: number, y: number) => number, keepBrightness: boolean): DynamicTexture {
  const tex = new DynamicTexture(name, size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  let sum = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = clamp01(fn(x, y));
      sum += v;
      const g = Math.round(v * 255);
      const i = (y * size + x) * 4;
      img.data[i] = g;
      img.data[i + 1] = g;
      img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = TEXTURES.anisotropy;
  // Brighten by the mean so the average surface color matches the untextured material.
  if (keepBrightness) tex.level = (size * size) / sum;
  return tex;
}

/** Distance (px) from x to the nearest multiple of `cell` (wrapping). */
const lineDist = (x: number, cell: number): number => {
  const m = x % cell;
  return Math.min(m, cell - m);
};

export function drawTexture(scene: Scene, kind: TexKind, rng: Rng): DynamicTexture {
  const keep = TEXTURES.keepBrightness;
  switch (kind) {
    case "tiles": {
      const c = TEXTURES.tiles;
      const cell = SIZE / c.cells;
      const faces = Array.from({ length: c.cells * c.cells }, () => rng.range(c.face[0], c.face[1]));
      const n1 = wrapNoise(rng, 16);
      const n2 = wrapNoise(rng, 64);
      return paint(scene, "tex-tiles", SIZE, (x, y) => {
        const dx = lineDist(x + 0.5, cell);
        const dy = lineDist(y + 0.5, cell);
        const d = Math.min(dx, dy);
        if (d < c.groutPx / 2) return c.grout + n2(x, y) * 0.06;
        const face = faces[Math.floor(y / cell) * c.cells + Math.floor(x / cell)];
        // Worn, slightly raised edges: a thin lighter rim next to the grout.
        const rim = d < c.groutPx / 2 + 2 ? 0.03 : 0;
        return face + rim + (n1(x, y) - 0.5) * c.noise * 2 + (n2(x, y) - 0.5) * c.noise;
      }, keep);
    }
    case "plates": {
      const c = TEXTURES.plates;
      const cell = SIZE / c.cells;
      const faces = Array.from({ length: c.cells * c.cells }, () => rng.range(c.face[0], c.face[1]));
      const n1 = wrapNoise(rng, 32);
      return paint(scene, "tex-plates", SIZE, (x, y) => {
        const lx = (x + 0.5) % cell;
        const ly = (y + 0.5) % cell;
        if (Math.min(lineDist(x + 0.5, cell), lineDist(y + 0.5, cell)) < c.seamPx / 2) return c.seam;
        const face = faces[Math.floor(y / cell) * c.cells + Math.floor(x / cell)];
        // Bevel: lit on the top/left edges, shaded on the bottom/right edges.
        let bevel = 0;
        if (lx < c.bevelPx + c.seamPx / 2 || ly < c.bevelPx + c.seamPx / 2) bevel = c.bevel;
        if (cell - lx < c.bevelPx + c.seamPx / 2 || cell - ly < c.bevelPx + c.seamPx / 2) bevel = -c.bevel;
        return face + bevel + (n1(x, y) - 0.5) * c.noise * 2;
      }, keep);
    }
    case "turf": {
      const c = TEXTURES.turf;
      const n1 = wrapNoise(rng, c.blotchCells);
      const n2 = wrapNoise(rng, c.blotchCells * 4);
      const speck = new Float32Array(SIZE * SIZE);
      for (let i = 0; i < speck.length; i++) {
        if (rng.chance(c.speckleDensity)) speck[i] = rng.range(-c.speckle, c.speckle * 0.5);
      }
      return paint(scene, "tex-turf", SIZE, (x, y) => {
        const blotch = n1(x, y) * 0.65 + n2(x, y) * 0.35;
        return lerp(c.blotch[0], c.blotch[1], blotch) + speck[y * SIZE + x];
      }, keep);
    }
    case "planks": {
      const c = TEXTURES.planks;
      const cell = SIZE / c.cells; // plank width (px); planks run along v
      const segs = Math.max(1, c.joints);
      const shade = Array.from({ length: c.cells * segs }, () => rng.range(c.face[0], c.face[1]));
      const offset = Array.from({ length: c.cells }, () => rng.next());
      const grain = wrapNoise(rng, 64);
      return paint(scene, "tex-planks", SIZE, (x, y) => {
        const p = Math.floor(x / cell);
        if (lineDist(x + 0.5, cell) < c.seamPx / 2) return c.seam;
        // Staggered end joints along each plank.
        const along = ((y / SIZE + offset[p]) % 1) * segs;
        const seg = Math.floor(along);
        if (c.joints > 0 && lineDist(along * (SIZE / segs) + 0.5, SIZE / segs) < c.seamPx / 2) return c.seam + 0.08;
        // Grain: noise stretched along the plank.
        const g = grain(x * 4, y * 0.25);
        return shade[p * segs + seg] + (g - 0.5) * c.grain * 2;
      }, keep);
    }
    case "rock": {
      const c = TEXTURES.rock;
      const band = Array.from({ length: c.bands }, () => rng.range(c.band[0], c.band[1]));
      const phase = Array.from({ length: 3 }, () => rng.range(0, Math.PI * 2));
      const n1 = wrapNoise(rng, 32);
      const bandH = SIZE / c.bands;
      return paint(scene, "tex-rock", SIZE, (x, y) => {
        const t = (x / SIZE) * Math.PI * 2;
        // Wavy strata boundaries (integer frequencies keep the texture seamless).
        const wobble = c.wobble * (Math.sin(t + phase[0]) + 0.6 * Math.sin(2 * t + phase[1]) + 0.3 * Math.sin(5 * t + phase[2]));
        const yy = (((y + wobble) % SIZE) + SIZE) % SIZE;
        const b = Math.floor(yy / bandH);
        const edge = lineDist(yy, bandH) < 1.5 ? -0.08 : 0;
        return band[b % c.bands] + edge + (n1(x, y) - 0.5) * c.noise * 2;
      }, keep);
    }
    case "bricks": {
      const c = TEXTURES.bricks;
      const rowH = SIZE / c.rows;
      const brickW = SIZE / c.perRow;
      const shade = Array.from({ length: c.rows * c.perRow }, () => rng.range(c.face[0], c.face[1]));
      const n1 = wrapNoise(rng, 32);
      return paint(scene, "tex-bricks", SIZE, (x, y) => {
        const row = Math.floor(y / rowH);
        const xs = (x + (row % 2) * brickW * 0.5) % SIZE;
        const col = Math.floor(xs / brickW);
        if (lineDist(y + 0.5, rowH) < c.mortarPx / 2 || lineDist(xs + 0.5, brickW) < c.mortarPx / 2) return c.mortar;
        return shade[row * c.perRow + col] + (n1(x, y) - 0.5) * c.noise * 2;
      }, keep);
    }
  }
}

/** Riveted metal plate for magnetic props: one plate per face (default box UVs). */
export function createMetalPlateTexture(scene: Scene): DynamicTexture {
  const c = TEXTURES.metal;
  const rng = new Rng(TEXTURES.seed + 101);
  const brushed = wrapNoise(rng, 64);
  const rivets: [number, number][] = [];
  const n = c.rivetsPerSide;
  for (let i = 0; i < n; i++) {
    const t = c.rivetInset + ((SIZE - 2 * c.rivetInset) * i) / (n - 1);
    rivets.push([t, c.rivetInset], [t, SIZE - c.rivetInset], [c.rivetInset, t], [SIZE - c.rivetInset, t]);
  }
  const r2 = (c.rivetPx / 2) ** 2;
  return paint(scene, "tex-metal", SIZE, (x, y) => {
    for (const [rx, ry] of rivets) {
      const dx = x - rx;
      const dy = y - ry;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) return dx + dy < 0 ? 1 : c.rivet; // lit upper-left half
    }
    const edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
    if (edge < c.borderPx) return edge < 2 ? c.border - 0.1 : c.border + (edge / c.borderPx) * 0.1;
    return c.face + (brushed(x * 0.2, y * 3) - 0.5) * c.brushed * 2;
  }, TEXTURES.keepBrightness);
}

/** Diagonal yellow/black stripes: one stripe pair per texture repeat. */
export function createStripeTexture(scene: Scene): DynamicTexture {
  const size = TEXTURES.trim.textureSize;
  const tex = new DynamicTexture("tex-hazard", size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const [yellow, black] = TEXTURES.trim.colors;
  ctx.fillStyle = black;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = yellow;
  // Band where (x + y) mod size < size / 2, drawn as polygons so the edges are anti-aliased.
  const h = size / 2;
  for (const o of [-size, 0, size]) {
    ctx.beginPath();
    ctx.moveTo(o, 0);
    ctx.lineTo(o + h, 0);
    ctx.lineTo(o + h - size, size);
    ctx.lineTo(o - size, size);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(o + size, 0);
    ctx.lineTo(o + size + h, 0);
    ctx.lineTo(o + h, size);
    ctx.lineTo(o, size);
    ctx.closePath();
    ctx.fill();
  }
  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = TEXTURES.anisotropy;
  return tex;
}
