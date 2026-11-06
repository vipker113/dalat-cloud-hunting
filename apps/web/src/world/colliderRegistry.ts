import type * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

interface WorldColliderEntry {
  mesh: THREE.Mesh;
  bvh: MeshBVH;
}

let activeCollider: WorldColliderEntry | null = null;

export const worldColliderRegistry = {
  setCollider(mesh: THREE.Mesh, bvh: MeshBVH) {
    activeCollider = { mesh, bvh };
  },
  clearCollider(mesh?: THREE.Mesh) {
    if (!mesh || activeCollider?.mesh === mesh) {
      activeCollider = null;
    }
  },
  getCollider(): WorldColliderEntry | null {
    return activeCollider;
  },
};
