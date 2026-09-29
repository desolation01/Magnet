import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AUDIO } from "../config";

/** All sound effects are synthesized with the Web Audio API (AGENTS.md §30). No audio files. */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly listener = new Vector3();
  /** Ring buffer of the last maxImpactsPerSecond impact start times (rate limiter, no allocations). */
  private readonly impactTimes = new Float64Array(AUDIO.maxImpactsPerSecond).fill(-Infinity);
  private impactIndex = 0;
  private hum: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null = null;

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = AUDIO.masterVolume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setListener(p: Vector3): void {
    this.listener.copyFrom(p);
  }

  /** Volume factor for a sound at `p` (1 when p is null = the player's own sound). */
  private attenuation(p: Vector3 | null): number {
    if (!p) return 1;
    const d = Vector3.Distance(p, this.listener);
    if (d >= AUDIO.aiMaxDistance) return 0;
    const t = 1 - d / AUDIO.aiMaxDistance;
    return t * t;
  }

  private ready(): boolean {
    return !!this.ctx && !!this.master && this.ctx.state === "running";
  }

  private tone(type: OscillatorType, f0: number, f1: number, duration: number, volume: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private noiseBurst(duration: number, volume: number, filterFreq: number, filterType: BiquadFilterType = "lowpass", q = 1): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  /** The signature sound: low whoomp sweeping down + noise burst. */
  repulse(p: Vector3 | null): void {
    if (!this.ready()) return;
    const a = this.attenuation(p);
    if (a <= 0) return;
    this.tone("sine", 220, 45, 0.45, 0.9 * a);
    this.tone("square", 440, 80, 0.18, 0.15 * a);
    this.noiseBurst(0.3, 0.5 * a, 1800);
  }

  /** Quiet looping hum while the player attracts. */
  setAttractHum(on: boolean): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    if (on && !this.hum) {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = 110;
      osc2.type = "sine";
      osc2.frequency.value = 6; // wobble
      const wobble = ctx.createGain();
      wobble.gain.value = 12;
      osc2.connect(wobble).connect(osc.frequency);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 600;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.08);
      osc.connect(filter).connect(gain).connect(this.master!);
      osc.start();
      osc2.start();
      this.hum = { osc, osc2, gain };
    } else if (!on && this.hum) {
      const h = this.hum;
      this.hum = null;
      const t = ctx.currentTime;
      h.gain.gain.cancelScheduledValues(t);
      h.gain.gain.setValueAtTime(Math.max(0.0001, h.gain.gain.value), t);
      h.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      h.osc.stop(t + 0.12);
      h.osc2.stop(t + 0.12);
    }
  }

  /** AI attract: a very short quiet zap (AI attract is otherwise silent). */
  aiAttract(p: Vector3): void {
    if (!this.ready()) return;
    const a = this.attenuation(p) * 0.25;
    if (a <= 0.01) return;
    this.tone("sawtooth", 160, 220, 0.12, 0.15 * a);
  }

  /** Metal clank; rate-limited and scaled by impact speed. */
  impact(p: Vector3 | null, speed: number): void {
    if (!this.ready() || speed < AUDIO.impactMinSpeed) return;
    const now = this.ctx!.currentTime;
    // The oldest of the last N impacts must be at least 1 s old.
    if (now - this.impactTimes[this.impactIndex] < 1) return;
    const a = this.attenuation(p) * Math.min(1, speed / 20);
    if (a <= 0.01) return;
    this.impactTimes[this.impactIndex] = now;
    this.impactIndex = (this.impactIndex + 1) % this.impactTimes.length;
    this.tone("triangle", 900, 500, 0.12, 0.4 * a);
    this.tone("square", 1400, 900, 0.06, 0.1 * a);
    this.noiseBurst(0.08, 0.3 * a, 3000, "bandpass", 3);
  }

  /** Bounce pad "boing": a springy sine sweep up with a quick decay and a bright overtone. */
  bounce(p: Vector3 | null): void {
    if (!this.ready()) return;
    const a = this.attenuation(p);
    if (a <= 0.01) return;
    this.tone("sine", 160, 620, 0.32, 0.5 * a);
    this.tone("sine", 240, 900, 0.2, 0.18 * a, 0.03);
    this.tone("triangle", 520, 1300, 0.1, 0.08 * a);
  }

  playerHit(): void {
    if (!this.ready()) return;
    this.tone("square", 300, 120, 0.15, 0.3);
  }

  elimination(p: Vector3 | null): void {
    if (!this.ready()) return;
    const a = Math.max(0.35, this.attenuation(p));
    this.tone("sine", 1200, 150, 0.8, 0.35 * a);
  }

  jump(): void {
    if (!this.ready()) return;
    this.tone("square", 300, 600, 0.12, 0.12);
  }

  land(): void {
    if (!this.ready()) return;
    this.noiseBurst(0.08, 0.2, 400);
  }

  countdown(go: boolean): void {
    if (!this.ready()) return;
    this.tone("square", go ? 880 : 440, go ? 880 : 440, go ? 0.35 : 0.15, 0.2);
  }

  victory(): void {
    if (!this.ready()) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone("square", f, f, 0.18, 0.2, i * 0.13));
  }

  defeat(): void {
    if (!this.ready()) return;
    [392, 330, 262, 196].forEach((f, i) => this.tone("triangle", f, f * 0.97, 0.25, 0.3, i * 0.18));
  }

  stopAll(): void {
    this.setAttractHum(false);
  }
}
