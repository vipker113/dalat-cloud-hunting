import { WORLD_CONSTANTS } from './types';

export type SurfaceType =
  | 'pine_grass'
  | 'red_basalt_trail'
  | 'tea_terrace'
  | 'wood_deck'
  | 'pink_grass_meadow'
  | 'valley_floor';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function gaussian2D(x: number, z: number, cx: number, cz: number, rx: number, rz: number): number {
  const dx = (x - cx) / rx;
  const dz = (z - cz) / rz;
  return Math.exp(-(dx * dx + dz * dz));
}

function distToSegment2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): { dist: number; t: number } {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz || 1;
  const t = clamp(((px - ax) * abx + (pz - az) * abz) / lenSq, 0, 1);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return { dist: Math.hypot(px - cx, pz - cz), t };
}

// Deterministic pseudo-noise (0..1) shared identically across JS & GLSL baking
function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm2D(x: number, z: number, octaves = 3): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * (valueNoise(x * freq, z * freq) * 2 - 1);
    freq *= 2.03;
    amp *= 0.5;
  }
  return val;
}

/**
 * Trail network segments [x, z] connecting all 5 signature Da Lat landmarks smoothly
 */
export const TRAIL_SEGMENTS: Array<[number, number, number, number]> = [
  // Trail 1: Dai Ngam Thung Lung Den (-115, 145) -> Tiem Ca Phe Mo Suong (-45, 30)
  [-115, 145, -82, 92],
  [-82, 92, -45, 30],
  // Trail 2: Tiem Ca Phe Mo Suong (-45, 30) -> Tea Ridge Saddle (12, -25) -> Cau Go Summit (52, -75)
  [-45, 30, 12, -25],
  [12, -25, 52, -75],
  // Trail 3: Tea Ridge Saddle (12, -25) -> Hom Co Tuyet (-12, -165) -> Cay Thong Co Don (-95, -155)
  [12, -25, -12, -165],
  [-12, -165, -95, -155],
  // Trail 4: Forest loop Cay Thong Co Don (-95, -155) -> Mo Suong West Ridge (-85, -35) -> (-45, 30)
  [-95, -155, -85, -35],
  [-85, -35, -45, 30],
];

export function distanceToTrail(x: number, z: number): number {
  let minD = 9999;
  for (let i = 0; i < TRAIL_SEGMENTS.length; i++) {
    const [ax, az, bx, bz] = TRAIL_SEGMENTS[i];
    const { dist } = distToSegment2D(x, z, ax, az, bx, bz);
    if (dist < minD) minD = dist;
  }
  return minD;
}

/**
 * Natural ground elevation Y in meters (Y=0 corresponds to 1,450m ASL).
 * Sculpted specifically for the 900m x 900m "Cầu Đất – Mơ Sương" Hero Vertical Slice.
 */
export function sampleGroundHeight(x: number, z: number): number {
  // 1. Base highland ridge sloping down toward East (+X) and South-East (+X, +Z) valley basin
  const eastDrop = smoothstep(-90, 210, x + z * 0.28);
  let h = 136 * (1 - eastDrop) + 14 * eastDrop;

  // 2. Summit 1: Đồi Chè Cầu Đất & Cầu Gỗ Crest around (52, -75) -> ~196m (1,646m ASL)
  h += 78 * gaussian2D(x, z, 46, -78, 92, 86);

  // 3. Summit 2: Đồi Thông Cô Đơn North Knoll around (-95, -155) -> ~158m (1,608m ASL)
  h += 38 * gaussian2D(x, z, -98, -158, 82, 74);

  // 4. Secret Pink-Grass Hollow (Hõm Cỏ Tuyết / Gác Chè 1927) around (-12, -172) -> ~166m
  h += 34 * gaussian2D(x, z, -12, -178, 64, 58);

  // 5. Western Pine Backdrop Ridge so west horizon feels lush & sheltered
  h += 48 * smoothstep(-160, -390, x);

  // 6. Gentle organic highland undulation
  const undulation = fbm2D(x * 0.011, z * 0.011, 3) * 5.2;
  // Flatten undulation near key plateaus so buildings sit rock-solid!
  const cafeFlatMask = smoothstep(34, 15, Math.hypot(x - -45, z - 30));
  const pierEntryFlat = smoothstep(26, 11, Math.hypot(x - 52, z - -75));
  const trailheadFlat = smoothstep(24, 10, Math.hypot(x - -115, z - 145));
  const lonelyFlat = smoothstep(22, 9, Math.hypot(x - -95, z - -155));

  const flattenWeight = clamp(cafeFlatMask + pierEntryFlat + trailheadFlat + lonelyFlat, 0, 1);
  h += undulation * (1 - flattenWeight * 0.92);

  // Lock exact plateau elevations smoothly
  if (cafeFlatMask > 0.001) {
    h = h * (1 - cafeFlatMask) + 135.0 * cafeFlatMask;
  }
  if (pierEntryFlat > 0.001) {
    h = h * (1 - pierEntryFlat) + 196.0 * pierEntryFlat;
  }
  if (trailheadFlat > 0.001) {
    h = h * (1 - trailheadFlat) + 84.0 * trailheadFlat;
  }
  if (lonelyFlat > 0.001) {
    h = h * (1 - lonelyFlat) + 158.0 * lonelyFlat;
  }

  // Subtle terraced steps on Cầu Đất tea slopes!
  const teaZone = gaussian2D(x, z, 36, -58, 68, 68) * (1 - flattenWeight);
  if (teaZone > 0.22 && distanceToTrail(x, z) > 4.2) {
    const stepH = 1.65;
    const terraced = Math.floor(h / stepH) * stepH + smoothstep(0.0, 0.45, (h % stepH) / stepH) * stepH;
    h = h * (1 - teaZone * 0.65) + terraced * (teaZone * 0.65);
  }

  // Wind turbine hill pedestals rising through the eastern cloud sea
  const turbineCoords: Array<[number, number, number]> = [
    [185, -145, 92],
    [235, -65, 84],
    [215, 28, 78],
    [295, -185, 88],
    [310, -15, 72],
  ];
  for (const [tx, tz, peakY] of turbineCoords) {
    const g = gaussian2D(x, z, tx, tz, 36, 36);
    if (g > 0.02) {
      h = Math.max(h, peakY * g + 16 * (1 - g));
    }
  }

  return Math.max(6.0, h);
}

/**
 * Walkable surface height including elevated wooden pier of Cầu Gỗ Săn Mây
 * and stilted wooden veranda of Tiệm Cà Phê Mơ Sương.
 */
export function sampleWalkableHeight(x: number, z: number): number {
  const ground = sampleGroundHeight(x, z);

  // 1. Cầu Gỗ Săn Mây wooden bridge extending East from (52, -75) to circular deck at (92, -75)
  if (x >= 50 && x <= 99 && Math.abs(z - -75) <= 6.8) {
    const inBridgeCorridor = x <= 86 && Math.abs(z - -75) <= 2.7;
    const distDeck = Math.hypot(x - 91, z - -75);
    const inRoundDeck = distDeck <= 7.2;
    if (inBridgeCorridor || inRoundDeck) {
      const t = clamp((x - 52) / 40, 0, 1);
      const bridgeY = 196.15 + t * 2.1; // Rises gently to 198.25m (~1,648.3m ASL)
      return Math.max(ground, bridgeY);
    }
  }

  // 2. Tiệm Cà Phê Mơ Sương stilted wooden scenic deck extending East from (-46.. -24, z: 20..40)
  if (x >= -54 && x <= -23 && z >= 19 && z <= 41) {
    return Math.max(ground, 135.15);
  }

  return ground;
}

export function getSurfaceType(x: number, z: number): SurfaceType {
  // Wooden decks first
  if (
    (x >= 50 && x <= 99 && (Math.abs(z - -75) <= 2.7 || Math.hypot(x - 91, z - -75) <= 7.2)) ||
    (x >= -54 && x <= -23 && z >= 19 && z <= 41)
  ) {
    return 'wood_deck';
  }
  const ground = sampleGroundHeight(x, z);
  if (ground < 52) return 'valley_floor';
  if (distanceToTrail(x, z) < 3.1) return 'red_basalt_trail';
  if (gaussian2D(x, z, -12, -175, 42, 38) > 0.42) return 'pink_grass_meadow';
  if (gaussian2D(x, z, 36, -58, 62, 62) > 0.32) return 'tea_terrace';
  return 'pine_grass';
}

export function gameYToASL(y: number): number {
  return Math.round(WORLD_CONSTANTS.BASE_ASL_METERS + y);
}
