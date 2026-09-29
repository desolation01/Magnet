// Deep imports keep the bundle small; these side-effect modules register the scene components
// the game relies on (physics stepping, shadows, player outline, particles, ray picking).
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import "@babylonjs/core/Rendering/outlineRenderer";
import "@babylonjs/core/Particles/particleSystemComponent";
import "@babylonjs/core/Culling/ray";
import { Engine } from "@babylonjs/core/Engines/engine";
import HavokPhysics from "@babylonjs/havok";
import { Game } from "./game/Game";

async function main(): Promise<void> {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  const engine = new Engine(canvas, true, { stencil: true, antialias: true }, true);
  const havok = await HavokPhysics();
  const game = new Game(engine, canvas, havok);

  engine.runRenderLoop(() => game.scene.render());
  window.addEventListener("resize", () => engine.resize());
}

main().catch((err) => {
  console.error("Magnet Mayhem failed to start", err);
});
