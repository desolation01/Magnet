import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Scene } from "@babylonjs/core/scene";
import type { Character } from "../character/Character";
import { COLORS, NAMEPLATE } from "../config";

interface Plate {
  mesh: Mesh;
  mat: StandardMaterial;
  ui: AdvancedDynamicTexture;
}

/**
 * Floating Babylon GUI nameplates (AGENTS.md §28).
 *
 * Each plate is a small billboard with its own GUI texture, drawn once when created. A fullscreen
 * GUI with `linkWithMesh` redraws and re-uploads a screen-sized texture every frame the characters
 * move (59 MB/frame on a 5K display, the game's biggest GPU cost), so it is not used here.
 * Plates are rescaled every frame to keep a constant on-screen size.
 */
export class Nameplates {
  private readonly plates = new Map<Character, Plate>();
  private readonly forward = new Vector3();
  private readonly anchor = new Vector3();

  constructor(private readonly scene: Scene) {}

  add(c: Character): void {
    const s = NAMEPLATE.textureScale;
    const widthPx = c.isPlayer ? NAMEPLATE.playerWidthPx : NAMEPLATE.aiWidthPx;
    const aspect = widthPx / NAMEPLATE.heightPx;

    const mesh = CreatePlane(`plate-${c.name}`, { width: aspect, height: 1 }, this.scene);
    mesh.parent = c.nameAnchor;
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;
    mesh.renderingGroupId = NAMEPLATE.renderingGroup;

    const ui = new AdvancedDynamicTexture(`plate-ui-${c.name}`, widthPx * s, NAMEPLATE.heightPx * s, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const mat = new StandardMaterial(`plate-mat-${c.name}`, this.scene);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveTexture = ui;
    mat.opacityTexture = ui;
    mesh.material = mat;

    const rect = new Rectangle(`plate-${c.name}`);
    rect.width = 1;
    rect.height = 1;
    rect.cornerRadius = NAMEPLATE.cornerRadiusPx * s;
    rect.thickness = NAMEPLATE.borderPx * s;
    rect.color = "#1d2340";
    rect.background = c.isPlayer ? COLORS.player : c.color;
    rect.alpha = NAMEPLATE.alpha;
    const text = new TextBlock(`plate-text-${c.name}`, c.name);
    text.color = c.isPlayer ? "#1d2340" : "#ffffff";
    text.fontSize = NAMEPLATE.fontSizePx * s;
    text.fontWeight = "bold";
    text.outlineWidth = c.isPlayer ? 0 : NAMEPLATE.textOutlinePx * s;
    text.outlineColor = "#1d2340";
    rect.addControl(text);
    ui.addControl(rect);

    this.plates.set(c, { mesh, mat, ui });
  }

  /** Scales every plate so it keeps NAMEPLATE.heightPx on screen. Call after the camera has moved. */
  update(camera: Camera): void {
    if (this.plates.size === 0) return;
    const engine = this.scene.getEngine();
    const cssHeight = engine.getRenderHeight() * engine.getHardwareScalingLevel();
    if (cssHeight <= 0) return;
    // World units per CSS pixel at depth 1 (vertical FOV).
    const unitsPerPx = (2 * Math.tan(camera.fov / 2)) / cssHeight;
    camera.getDirectionToRef(Axis.Z, this.forward);
    const cam = camera.globalPosition;
    for (const [c, plate] of this.plates) {
      this.anchor.set(c.position.x, c.position.y + c.nameAnchor.position.y, c.position.z);
      const depth = Math.max(camera.minZ,
        (this.anchor.x - cam.x) * this.forward.x + (this.anchor.y - cam.y) * this.forward.y + (this.anchor.z - cam.z) * this.forward.z);
      plate.mesh.scaling.setAll(NAMEPLATE.heightPx * unitsPerPx * depth);
    }
  }

  remove(c: Character): void {
    const plate = this.plates.get(c);
    if (!plate) return;
    plate.ui.dispose();
    plate.mat.dispose();
    plate.mesh.dispose();
    this.plates.delete(c);
  }

  clear(): void {
    for (const c of [...this.plates.keys()]) this.remove(c);
  }

  get count(): number {
    return this.plates.size;
  }
}
