import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import type { Scene } from "@babylonjs/core/scene";
import type { Character } from "../character/Character";
import { COLORS } from "../config";

/** Floating Babylon GUI nameplates (AGENTS.md §28). */
export class Nameplates {
  private readonly ui: AdvancedDynamicTexture;
  private readonly plates = new Map<Character, Rectangle>();

  constructor(scene: Scene) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("nameplates", true, scene);
  }

  add(c: Character): void {
    const rect = new Rectangle(`plate-${c.name}`);
    rect.width = c.isPlayer ? "86px" : "64px";
    rect.height = "24px";
    rect.cornerRadius = 8;
    rect.thickness = 2;
    rect.color = "#1d2340";
    rect.background = c.isPlayer ? COLORS.player : c.color;
    rect.alpha = 0.92;
    const text = new TextBlock(`plate-text-${c.name}`, c.name);
    text.color = c.isPlayer ? "#1d2340" : "#ffffff";
    text.fontSize = 14;
    text.fontWeight = "bold";
    text.outlineWidth = c.isPlayer ? 0 : 3;
    text.outlineColor = "#1d2340";
    rect.addControl(text);
    this.ui.addControl(rect);
    rect.linkWithMesh(c.nameAnchor);
    this.plates.set(c, rect);
  }

  remove(c: Character): void {
    const rect = this.plates.get(c);
    if (!rect) return;
    rect.linkWithMesh(null);
    this.ui.removeControl(rect);
    rect.dispose();
    this.plates.delete(c);
  }

  clear(): void {
    for (const c of [...this.plates.keys()]) this.remove(c);
  }

  get count(): number {
    return this.plates.size;
  }
}
