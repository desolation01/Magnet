import type { Character } from "../character/Character";
import type { ThirdPersonCamera } from "./ThirdPersonCamera";

/** Keyboard + mouse → CharacterInput (AGENTS.md §6). */
export class PlayerController {
  private readonly keys = new Set<string>();
  private attractHeld = false;
  /** Last seen `PointerEvent.buttons` mask (bit 1 = left, bit 2 = right). */
  private buttons = 0;
  private repulseRequested = false;
  private jumpRequested = false;
  /** Whether mouse input should drive the camera and magnet (COUNTDOWN / PLAYING). */
  active = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  /** Called on the first user click (for audio unlock). */
  onUserGesture: (() => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly camera: ThirdPersonCamera) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    // Pointer events only: Babylon calls preventDefault on the canvas pointerdown, which suppresses the
    // compatibility mouse events. A second button pressed/released while another is held (a chord) only
    // fires pointermove, so button changes are tracked by diffing `e.buttons` on every pointer event.
    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerButtons);
    window.addEventListener("pointermove", this.onPointerMove);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestLock(): void {
    if (!this.locked) {
      // Some browsers return a promise that rejects if the request is too soon after exiting.
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => undefined);
    }
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) this.jumpRequested = true;
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.attractHeld = false;
    this.buttons = 0;
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.onUserGesture?.();
    if (this.active && !this.locked) {
      // The click that acquires pointer lock is not an attack: just remember the buttons.
      this.buttons = e.buttons;
      this.requestLock();
      return;
    }
    this.onPointerButtons(e);
  };

  /** Turns changes in the pressed-buttons mask into attract hold / repulse requests. */
  private onPointerButtons = (e: PointerEvent): void => {
    const now = e.buttons;
    const pressed = now & ~this.buttons;
    const released = this.buttons & ~now;
    this.buttons = now;
    if (released & 1) this.attractHeld = false;
    if (!this.active || !this.locked) return;
    if (pressed & 1) this.attractHeld = true;
    if (pressed & 2) this.repulseRequested = true;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.buttons !== this.buttons) this.onPointerButtons(e);
    if (!this.active || !this.locked) return;
    this.camera.rotate(e.movementX, e.movementY);
  };

  private onPointerLockChange = (): void => {
    if (!this.locked) this.attractHeld = false;
    this.onLockChange?.(this.locked);
  };

  /** Writes the current input into the character. */
  apply(character: Character): void {
    const input = character.input;
    const yaw = this.camera.aimYaw;
    input.aimYaw = yaw;
    let f = 0;
    let r = 0;
    if (this.keys.has("KeyW")) f += 1;
    if (this.keys.has("KeyS")) f -= 1;
    if (this.keys.has("KeyD")) r += 1;
    if (this.keys.has("KeyA")) r -= 1;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // forward = (sin, 0, cos), right = (cos, 0, −sin)
    let x = sin * f + cos * r;
    let z = cos * f - sin * r;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    input.moveDir.set(x, 0, z);
    input.sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    input.attract = this.attractHeld && this.locked;
    if (this.jumpRequested) input.jump = true;
    if (this.repulseRequested) input.repulse = true;
    this.jumpRequested = false;
    this.repulseRequested = false;
  }

  /** Drops any buffered requests (e.g. when a match starts). */
  clear(): void {
    this.jumpRequested = false;
    this.repulseRequested = false;
    this.attractHeld = false;
  }
}
