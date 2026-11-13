import type * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

interface WorldColliderEntry {
  mesh: THREE.Mesh;
  bvh: MeshBVH;
}

let activeCollider: WorldColliderEntry | null = null;
let activeObstacleCollider: WorldColliderEntry | null = null;

export const worldColliderRegistry = {
  setCollider(
    mesh: THREE.Mesh,
    bvh: MeshBVH,
    obstacleMesh?: THREE.Mesh,
    obstacleBvh?: MeshBVH
  ) {
    activeCollider = { mesh, bvh };
    activeObstacleCollider =
      obstacleMesh && obstacleBvh ? { mesh: obstacleMesh, bvh: obstacleBvh } : { mesh, bvh };
  },
  clearCollider(mesh?: THREE.Mesh) {
    if (!mesh || activeCollider?.mesh === mesh) {
      activeCollider = null;
      activeObstacleCollider = null;
    }
  },
  getCollider(): WorldColliderEntry | null {
    return activeCollider;
  },
  getObstacleCollider(): WorldColliderEntry | null {
    return activeObstacleCollider;
  },
};

