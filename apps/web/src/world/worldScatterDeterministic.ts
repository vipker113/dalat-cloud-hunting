import {
  distanceToTrail,
  fbm2D,
  sampleGroundHeight,
  TRAIL_SEGMENTS,
} from '@dalat/protocol';

export const TARGET_PINE_COUNT = 460;

export const TURBINE_PEDESTALS: ReadonlyArray<[number, number]> = [
  [185, -145],
  [235, -65],
  [215, 28],
  [295, -185],
  [310, -15],
];

export function seededHash(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function isInsideStiltedDeckFootprint(x: number, z: number): boolean {
  // Café Mơ Sương veranda & cabin footprint
  if (x >= -53.2 && x <= -23.0 && z >= 18.5 && z <= 41.5) return true;
  // Cầu Gỗ Săn Mây bridge & circular sunrise deck footprint
  if (x >= 49.0 && x <= 99.0 && Math.abs(z - -75.0) <= 8.2) return true;
  return false;
}

export function isValidPineLocation(x: number, z: number, y: number): boolean {
  if (y < 72.0) return false;
  if (distanceToTrail(x, z) < 6.2) return false;
  if (isInsideStiltedDeckFootprint(x, z)) return false;

  if (x >= -65 && x <= 140 && z >= 10 && z <= 50) return false;
  if (Math.hypot(x - 52, z - -75) < 24) return false;
  if (x >= 38 && x <= 380 && z >= -118 && z <= -34) return false;
  if (Math.hypot(x - 18, z - 128) < 25) return false;
  if (x >= 8 && x <= 380 && z >= 65 && z <= 215) return false;
  if (Math.hypot(x - -95, z - -149) < 28) return false;
  if (Math.abs(x - -95) < 24 && z < -130 && z > -380) return false;
  if (Math.hypot(x - 36, z - -58) < 58) return false;
  if (Math.hypot(x - -14, z - -175) < 32) return false;

  for (let i = 0; i < TURBINE_PEDESTALS.length; i++) {
    const [tx, tz] = TURBINE_PEDESTALS[i];
    if (Math.hypot(x - tx, z - tz) < 34) return false;
  }

  return true;
}

export interface PinePlacement {
  x: number;
  y: number;
  z: number;
  scaleXZ: number;
  scaleY: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
  species: 'A' | 'B';
}

export interface LanternPlacement {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

let cachedScatter: { pines: PinePlacement[]; lanterns: LanternPlacement[] } | null = null;

/**
 * Computes exact deterministic pine trunk & trail lantern placements once,
 * shared identically by `HighlandFoliageAndProps` (GPU InstancedMesh) and
 * `DaLatWorldTerrain` (static MeshBVH obstacle colliders).
 */
export function getDeterministicPinesAndLanterns(): {
  pines: PinePlacement[];
  lanterns: LanternPlacement[];
} {
  if (cachedScatter) return cachedScatter;

  const pines: PinePlacement[] = [];
  let attempt = 0;
  while (pines.length < TARGET_PINE_COUNT && attempt < 18000) {
    attempt++;
    const rx = (seededHash(attempt * 3.17) - 0.5) * 856;
    const rz = (seededHash(attempt * 7.31) - 0.5) * 856;
    const ry = sampleGroundHeight(rx, rz);

    const groveDensity = 0.55 + 0.45 * fbm2D(rx * 0.015, rz * 0.015, 2);
    if (seededHash(attempt * 11.9) > groveDensity) continue;
    if (!isValidPineLocation(rx, rz, ry)) continue;

    const scaleXZ = 0.78 + seededHash(attempt * 13.7) * 0.54;
    const scaleY = 0.82 + seededHash(attempt * 17.3) * 0.62;
    const yaw = seededHash(attempt * 23.1) * Math.PI * 2;
    const tiltX = (seededHash(attempt * 29.5) - 0.5) * 0.07;
    const tiltZ = (seededHash(attempt * 31.9) - 0.5) * 0.07;

    pines.push({
      x: rx,
      y: ry - 0.22,
      z: rz,
      scaleXZ,
      scaleY,
      yaw,
      tiltX,
      tiltZ,
      species: pines.length % 2 === 0 ? 'A' : 'B',
    });
  }

  const lanterns: LanternPlacement[] = [];
  for (let segIdx = 0; segIdx < TRAIL_SEGMENTS.length; segIdx++) {
    const [ax, az, bx, bz] = TRAIL_SEGMENTS[segIdx];
    const segLen = Math.hypot(bx - ax, bz - az);
    const dirX = (bx - ax) / segLen;
    const dirZ = (bz - az) / segLen;
    const perpX = -dirZ;
    const perpZ = dirX;

    const lanternSpacing = 26;
    const lCount = Math.max(1, Math.floor(segLen / lanternSpacing));
    for (let l = 0; l < lCount; l++) {
      const t = (l + 0.5) / lCount;
      const side = (segIdx + l) % 2 === 0 ? 1 : -1;
      const lx = ax + (bx - ax) * t + perpX * 3.65 * side;
      const lz = az + (bz - az) * t + perpZ * 3.65 * side;
      if (isInsideStiltedDeckFootprint(lx, lz)) continue;
      if (Math.hypot(lx - -53.0, lz - 24.0) < 3.6) continue;
      const ly = sampleGroundHeight(lx, lz);
      const inwardYaw = Math.atan2(-perpX * side, -perpZ * side);
      lanterns.push({ x: lx, y: ly - 0.1, z: lz, yaw: inwardYaw });
    }
  }

  {
    const gx = -18.2;
    const gz = -178.5;
    lanterns.push({
      x: gx,
      y: sampleGroundHeight(gx, gz) - 0.1,
      z: gz,
      yaw: 0.8,
    });
  }

  cachedScatter = { pines, lanterns };
  return cachedScatter;
}
