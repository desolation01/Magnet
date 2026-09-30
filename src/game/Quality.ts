import type { Engine } from "@babylonjs/core/Engines/engine";
import { QUALITY, RENDER } from "../config";

export type QualityTier = "high" | "low";

export interface QualitySettings {
  tier: QualityTier;
  antialias: boolean;
  maxPixelRatio: number;
  shadowMapSize: number;
}

const HIGH: Omit<QualitySettings, "tier"> = { antialias: true, maxPixelRatio: RENDER.maxPixelRatio, shadowMapSize: RENDER.shadowMapSize };

/** Startup quality tier (AGENTS.md §32). Runs before the engine exists, so it can pick antialiasing. */
export function detectQuality(): QualitySettings {
  const forced = new URLSearchParams(location.search).get("quality");
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowEnd =
    (nav.deviceMemory !== undefined && nav.deviceMemory <= QUALITY.lowMemoryGB) ||
    (nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= QUALITY.lowCores);
  const tier: QualityTier = forced === "low" || forced === "high" ? forced : lowEnd ? "low" : "high";
  return { tier, ...(tier === "low" ? QUALITY.low : HIGH) };
}

/** True when WebGL is rasterized on the CPU: treated as the low tier for everything decided after startup. */
export function isSoftwareRenderer(engine: Engine): boolean {
  return /swiftshader|llvmpipe|software/i.test(engine.getGlInfo().renderer);
}

/**
 * Lowers the render resolution when the frame rate drops and raises it again when there is headroom
 * (AGENTS.md §32). Decisions use the median frame time of each window, so a single hitch never
 * changes the resolution.
 */
export class AdaptiveResolution {
  private readonly base: number;
  private readonly samples = new Float32Array(1024);
  private count = 0;
  private windowTime = 0;
  private goodTime = 0;
  private sinceUpscale = Infinity;
  private blockTime = 0;
  private downBlockTime = 0;
  /** FPS of the window before the last downscale, until the next window checks the gain. */
  private fpsBeforeDownscale = 0;
  private shadowsOff = false;
  /** Hardware scaling factor on top of the pixel-ratio cap (1 = full resolution). */
  scale = 1;

  constructor(private readonly engine: Engine, private readonly disableShadows: () => void) {
    this.base = engine.getHardwareScalingLevel();
  }

  /** Call once per rendered frame with the unclamped frame time. */
  update(frameMs: number): void {
    if (document.hidden || frameMs <= 0 || frameMs > QUALITY.ignoreFrameMs) return;
    if (this.count < this.samples.length) this.samples[this.count++] = frameMs;
    const dt = frameMs / 1000;
    this.windowTime += dt;
    this.sinceUpscale += dt;
    this.blockTime = Math.max(0, this.blockTime - dt);
    this.downBlockTime = Math.max(0, this.downBlockTime - dt);
    if (this.windowTime < QUALITY.windowSeconds) return;

    const window = this.samples.subarray(0, this.count).sort();
    const fps = 1000 / window[this.count >> 1];
    const seconds = this.windowTime;
    this.count = 0;
    this.windowTime = 0;

    if (this.fpsBeforeDownscale > 0) {
      const gained = fps >= this.fpsBeforeDownscale * QUALITY.downscaleMinGain;
      this.fpsBeforeDownscale = 0;
      if (!gained) {
        // Not GPU-bound: the lower resolution did not help, so take it back.
        this.apply(Math.max(1, this.scale - QUALITY.scaleStep));
        this.downBlockTime = QUALITY.downscaleBlockSeconds;
        return;
      }
    }

    if (fps < QUALITY.downscaleBelowFps) {
      this.goodTime = 0;
      if (this.sinceUpscale < QUALITY.upscaleProbeSeconds) this.blockTime = QUALITY.upscaleBlockSeconds;
      if (this.downBlockTime > 0) return;
      if (this.scale < QUALITY.maxScale) {
        this.fpsBeforeDownscale = fps;
        this.apply(Math.min(QUALITY.maxScale, this.scale + QUALITY.scaleStep));
      } else if (fps < QUALITY.shadowsOffBelowFps && !this.shadowsOff) {
        this.shadowsOff = true;
        this.disableShadows();
      }
    } else if (fps >= QUALITY.upscaleAboveFps) {
      this.goodTime += seconds;
      if (this.goodTime >= QUALITY.upscaleAfterSeconds && this.scale > 1 && this.blockTime <= 0) {
        this.goodTime = 0;
        this.sinceUpscale = 0;
        this.apply(Math.max(1, this.scale - QUALITY.scaleStep / 2));
      }
    } else {
      this.goodTime = 0;
    }
  }

  private apply(scale: number): void {
    this.scale = scale;
    this.engine.setHardwareScalingLevel(this.base * scale);
  }
}
