import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Ray } from "@babylonjs/core/Culling/ray";
import type { Scene } from "@babylonjs/core/scene";

interface GroundTag {
  ground?: boolean;
}

/** Cheap reject: does the ray segment pass within the mesh's world bounding sphere? (Ray.intersectsSphere uses local space.) */
function segmentNearSphere(ray: Ray, m: AbstractMesh): boolean {
  const s = m.getBoundingInfo().boundingSphere;
  const c = s.centerWorld;
  const o = ray.origin;
  const d = ray.direction;
  const cx = c.x - o.x;
  const cy = c.y - o.y;
  const cz = c.z - o.z;
  const t = Math.max(0, Math.min(ray.length, cx * d.x + cy * d.y + cz * d.z));
  const dx = cx - d.x * t;
  const dy = cy - d.y * t;
  const dz = cz - d.z * t;
  return dx * dx + dy * dy + dz * dz <= s.radiusWorld * s.radiusWorld;
}

/**
 * Cached "is there walkable ground under this ray" query (AGENTS.md §32).
 * Instead of `scene.pickWithRay` over every mesh, it keeps the list of meshes tagged
 * `metadata.ground` (arena pieces and magnetic objects), rebuilt lazily whenever meshes are
 * added or removed, and tests the cheap bounding sphere before the exact mesh intersection.
 */
export class GroundQuery {
  private static readonly perScene = new WeakMap<Scene, GroundQuery>();
  private readonly meshes: AbstractMesh[] = [];
  private dirty = true;

  static for(scene: Scene): GroundQuery {
    let q = GroundQuery.perScene.get(scene);
    if (!q) {
      q = new GroundQuery(scene);
      GroundQuery.perScene.set(scene, q);
    }
    return q;
  }

  private constructor(private readonly scene: Scene) {
    const markDirty = (): void => {
      this.dirty = true;
    };
    scene.onNewMeshAddedObservable.add(markDirty);
    scene.onMeshRemovedObservable.add(markDirty);
  }

  private rebuild(): void {
    this.meshes.length = 0;
    for (const m of this.scene.meshes) {
      if ((m.metadata as GroundTag | null)?.ground === true) this.meshes.push(m);
    }
    this.dirty = false;
  }

  /** True if the ray hits an enabled ground mesh within its length. */
  hit(ray: Ray): boolean {
    // Metadata is assigned right after a mesh is created, so rebuild on the first query after a change.
    if (this.dirty) this.rebuild();
    for (const m of this.meshes) {
      if (!m.isEnabled() || m.isDisposed()) continue;
      if (!segmentNearSphere(ray, m)) continue;
      const info = ray.intersectsMesh(m, true);
      if (info.hit && info.distance <= ray.length) return true;
    }
    return false;
  }
}
