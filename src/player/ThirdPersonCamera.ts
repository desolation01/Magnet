import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CAMERA } from "../config";
import { clamp, DEG, smoothFactor } from "../util/math";

const CAMERA_BLOCK = (m: AbstractMesh): boolean => (m.metadata as { cameraBlock?: boolean } | null)?.cameraBlock === true;

/** Orbiting third-person camera with collision ray and shake (AGENTS.md §7). */
export class ThirdPersonCamera {
  readonly camera: FreeCamera;
  yaw = Math.PI; // facing −Z (toward the arena center from the player spawn)
  pitch = Math.atan2(CAMERA.height, CAMERA.distance);
  private readonly radius = Math.hypot(CAMERA.distance, CAMERA.height);
  private readonly lookAt = new Vector3();
  private readonly desired = new Vector3();
  private readonly dir = new Vector3();
  private readonly ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1);
  private shakeTime = 0;
  private shakeAmp = 0;
  private menuAngle = 0;
  private initialized = false;

  constructor(private readonly scene: Scene) {
    this.camera = new FreeCamera("camera", new Vector3(0, 20, 40), scene);
    this.camera.fov = CAMERA.fov;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 500;
    this.camera.inputs.clear();
    this.camera.setTarget(Vector3.Zero());
  }

  rotate(dx: number, dy: number): void {
    this.yaw += dx * CAMERA.sensitivity;
    this.pitch = clamp(this.pitch + dy * CAMERA.sensitivity, CAMERA.minPitchDeg * DEG, CAMERA.maxPitchDeg * DEG);
  }

  shake(duration: number, amplitude: number): void {
    this.shakeTime = Math.max(this.shakeTime, duration);
    this.shakeAmp = Math.max(this.shakeAmp, amplitude);
  }

  /** Snap behind a target (used at spawn). */
  snapTo(feet: Vector3, yaw: number): void {
    this.yaw = yaw;
    this.pitch = Math.atan2(CAMERA.height, CAMERA.distance);
    this.lookAt.set(feet.x, feet.y + CAMERA.lookAtHeight, feet.z);
    this.initialized = true;
  }

  /** Follows a character whose feet are at `feet`. */
  follow(feet: Vector3, dt: number): void {
    const targetY = feet.y + CAMERA.lookAtHeight;
    if (!this.initialized) {
      this.lookAt.set(feet.x, targetY, feet.z);
      this.initialized = true;
    } else {
      const k = smoothFactor(CAMERA.followLerp, dt);
      this.lookAt.x += (feet.x - this.lookAt.x) * k;
      this.lookAt.y += (targetY - this.lookAt.y) * k;
      this.lookAt.z += (feet.z - this.lookAt.z) * k;
    }

    const cp = Math.cos(this.pitch);
    this.dir.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);

    // Collision: one ray from the look-at point toward the desired position.
    let dist = this.radius;
    this.ray.origin.copyFrom(this.lookAt);
    this.ray.direction.copyFrom(this.dir);
    this.ray.length = this.radius;
    const hit = this.scene.pickWithRay(this.ray, CAMERA_BLOCK, false); // nearest hit, not the first found
    if (hit?.hit) dist = Math.max(0.5, hit.distance - CAMERA.collisionPadding);

    this.desired.copyFrom(this.dir).scaleInPlace(dist).addInPlace(this.lookAt);
    this.applyShake(dt);
    this.camera.position.copyFrom(this.desired);
    this.camera.setTarget(this.lookAt);
  }

  /** Slow orbit around the arena for the main menu. */
  private readonly menuTarget = new Vector3();

  orbitMenu(dt: number): void {
    this.menuAngle += dt * CAMERA.menuOrbitSpeed;
    const sin = Math.sin(this.menuAngle);
    const cos = Math.cos(this.menuAngle);
    // Pure sideways pan: shift both the eye and the target toward the camera's left.
    const px = cos * CAMERA.menuPan;
    const pz = -sin * CAMERA.menuPan;
    this.desired.set(sin * CAMERA.menuOrbitRadius + px, CAMERA.menuOrbitHeight, cos * CAMERA.menuOrbitRadius + pz);
    this.camera.position.copyFrom(this.desired);
    this.menuTarget.set(px, 0, pz);
    this.camera.setTarget(this.menuTarget);
    this.initialized = false;
  }

  private applyShake(dt: number): void {
    if (this.shakeTime <= 0) return;
    this.shakeTime -= dt;
    const a = this.shakeAmp;
    this.desired.x += (Math.random() * 2 - 1) * a;
    this.desired.y += (Math.random() * 2 - 1) * a;
    this.desired.z += (Math.random() * 2 - 1) * a;
    if (this.shakeTime <= 0) this.shakeAmp = 0;
  }

  /** Horizontal aim yaw (camera forward projected on the ground). */
  get aimYaw(): number {
    return this.yaw;
  }
}
