import type { Scene } from "@babylonjs/core/scene";

/**
 * TEST-ONLY frame-cost probe behind window.__MM_TEST__.perf() (`?test`). Used to profile the game
 * on simulated low-end devices (AGENTS.md §32): CPU throttling, software WebGL, high DPI.
 */

/** Averages over the frames since the previous perf() call. Times in ms. */
export interface PerfSample {
  frames: number;
  fps: number;
  medianMs: number;
  p95Ms: number;
  /** Frames longer than 50 ms (visible stutter). */
  hitches: number;
  frameMs: number;
  worstFrameMs: number;
  cpuMs: number;
  logicMs: number;
  physicsMs: number;
  renderMs: number;
  activeMeshesMs: number;
  drawCalls: number;
  activeMeshes: number;
  totalVertices: number;
  textureMB: number;
  jsHeapMB: number;
  renderWidth: number;
  renderHeight: number;
}

/** Per-frame timing via SceneInstrumentation (loaded lazily so it never ships in the main chunk). */
export function installPerfProbe(scene: Scene, api: { perf: () => PerfSample }): void {
  let frames = 0, frameSum = 0, worst = 0, cpuSum = 0, logicSum = 0, physSum = 0, renderSum = 0, activeSum = 0;
  let drawSum = 0, meshSum = 0;
  const times: number[] = [];
  let logicStart = 0;
  let inst: import("@babylonjs/core/Instrumentation/sceneInstrumentation").SceneInstrumentation | null = null;
  void import("@babylonjs/core/Instrumentation/sceneInstrumentation").then(({ SceneInstrumentation }) => {
    inst = new SceneInstrumentation(scene);
    inst.captureFrameTime = true;
    inst.captureRenderTime = true;
    inst.capturePhysicsTime = true;
    inst.captureActiveMeshesEvaluationTime = true;
    inst.captureInterFrameTime = true;
  });
  scene.onBeforeAnimationsObservable.add(() => { logicStart = performance.now(); }, undefined, true);
  scene.onBeforeAnimationsObservable.add(() => { logicSum += performance.now() - logicStart; });
  scene.onAfterRenderObservable.add(() => {
    if (!inst) return;
    const dt = scene.getEngine().getDeltaTime();
    frames++;
    frameSum += dt;
    times.push(dt);
    worst = Math.max(worst, dt);
    cpuSum += inst.frameTimeCounter.current;
    physSum += inst.physicsTimeCounter.current;
    renderSum += inst.renderTimeCounter.current;
    activeSum += inst.activeMeshesEvaluationTimeCounter.current;
    drawSum += inst.drawCallsCounter.current;
    meshSum += scene.getActiveMeshes().length;
  });
  api.perf = () => {
    const n = Math.max(frames, 1);
    const sorted = [...times].sort((a, b) => a - b);
    let texBytes = 0;
    for (const t of scene.textures) {
      const s = t.getSize();
      texBytes += s.width * s.height * 4 * (t.isCube ? 6 : 1);
    }
    const eng = scene.getEngine();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    const out: PerfSample = {
      frames, fps: r2(1000 / (frameSum / n)),
      medianMs: r2(sorted[Math.floor(sorted.length / 2)] ?? 0), p95Ms: r2(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
      hitches: times.filter((t) => t > 50).length, frameMs: r2(frameSum / n), worstFrameMs: r2(worst),
      cpuMs: r2(cpuSum / n), logicMs: r2(logicSum / n), physicsMs: r2(physSum / n), renderMs: r2(renderSum / n),
      activeMeshesMs: r2(activeSum / n), drawCalls: Math.round(drawSum / n), activeMeshes: Math.round(meshSum / n),
      totalVertices: scene.getTotalVertices(), textureMB: r2(texBytes / 1048576),
      jsHeapMB: mem ? r2(mem.usedJSHeapSize / 1048576) : -1,
      renderWidth: eng.getRenderWidth(), renderHeight: eng.getRenderHeight(),
    };
    times.length = 0;
    frames = frameSum = worst = cpuSum = logicSum = physSum = renderSum = activeSum = drawSum = meshSum = 0;
    return out;
  };
}
