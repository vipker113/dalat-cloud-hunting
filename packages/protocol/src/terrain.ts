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
 * Graded trail segments [ax, az, bx, bz] with target endpoint heights [ya, yb]
 * guaranteeing gentle highland grades (< 24 deg everywhere) and flush deck transitions.
 */
const GRADED_TRAILS: ReadonlyArray<[number, number, number, number, number, number]> = [
  // 0: Đài Ngắm Thung Lũng Đèn (18, 128, y=112) -> Dốc Hoa Dã Quỳ (-52.5, 58, y=131.0)
  [18, 128, -52.5, 58, 112.0, 131.0],
  // 1: Dốc Hoa Dã Quỳ (-52.5, 58, y=131.0) -> Sân Tây Tiệm Cà Phê Mơ Sương (-52.5, 28, y=135.15)
  [-52.5, 58, -52.5, 28, 131.0, 135.15],
  // 2: Mơ Sương (-52.5, 28, y=135.15) -> Triền Chè Dưới (-24, -12, y=154.5)
  [-52.5, 28, -24, -12, 135.15, 154.5],
  // 3: Triền Chè Dưới (-24, -12, y=154.5) -> Yên Đồi Chè Cầu Đất (14, -45, y=175.5)
  [-24, -12, 14, -45, 154.5, 175.5],
  // 4: Yên Đồi Chè (14, -45, y=175.5) -> Đầu Cầu Gỗ Săn Mây (50, -75, y=196.15)
  [14, -45, 50, -75, 175.5, 196.15],
  // 5: Yên Đồi Chè (14, -45, y=175.5) -> Hõm Cỏ Tuyết / Gác Chè 1927 (-12, -174, y=168.0)
  [14, -45, -12, -174, 175.5, 168.0],
  // 6: Hõm Cỏ Tuyết (-12, -174, y=168.0) -> Đồi Thông Cô Đơn (-94.5, -140.5, y=176.0)
  [-12, -174, -94.5, -140.5, 168.0, 176.0],
  // 7: Đồi Thông Cô Đơn (-94.5, -140.5, y=176.0) -> Rừng Thông Tây (-84, -52, y=155.5)
  [-94.5, -140.5, -84, -52, 176.0, 155.5],
  // 8: Rừng Thông Tây (-84, -52, y=155.5) -> Sân Tây Mơ Sương (-52.5, 28, y=135.15)
  [-84, -52, -52.5, 28, 155.5, 135.15],
];

/**
 * Trail network segments [ax, az, bx, bz] connecting all 5 signature Da Lat landmarks smoothly.
 */
export const TRAIL_SEGMENTS: Array<[number, number, number, number]> = GRADED_TRAILS.map(
  ([ax, az, bx, bz]) => [ax, az, bx, bz]
);

export function distanceToTrail(x: number, z: number): number {
  let minD = 9999;
  for (let i = 0; i < GRADED_TRAILS.length; i++) {
    const [ax, az, bx, bz] = GRADED_TRAILS[i];
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
  // 1. Base highland ridge sloping down toward East (+X) and Northern Suối Vàng / Dankia valley (-Z)
  const eastDrop = smoothstep(-90, 185, x + z * 0.26);
  let h = 136 * (1 - eastDrop) + 14 * eastDrop;

  const northValleyDrop = smoothstep(-165, -285, z);
  h = h * (1 - northValleyDrop * 0.62) + 54 * (northValleyDrop * 0.62);

  // 2. Summit 1: Đồi Chè Cầu Đất & Cầu Gỗ Crest around (48, -76) -> ~196.15m (1,646m ASL)
  h += 101 * gaussian2D(x, z, 48, -76, 106, 94);

  // 3. Summit 2: Đồi Thông Cô Đơn North Knoll around (-95, -148) -> ~176m (1,626m ASL)
  h += 42 * gaussian2D(x, z, -96, -148, 76, 58);

  // 4. Secret Pink-Grass Hollow (Hõm Cỏ Tuyết / Gác Chè 1927) around (-15, -176) -> ~168m
  h += 26 * gaussian2D(x, z, -15, -176, 48, 42);

  // 5. Southeast Scenic Bluff (Đài Ngắm Thung Lũng Đèn) around (18, 128) -> ~112m overlooking valley
  h += 28 * gaussian2D(x, z, 14, 128, 44, 42);

  // 6. Western Pine Backdrop Ridge (south of z = -135 so northern Langbiang sightline stays wide open)
  h += 44 * smoothstep(-175, -390, x) * (1 - smoothstep(-125, -210, z));

  // 7. Gentle organic highland undulation (damped near plateaus & trails)
  const undulation = fbm2D(x * 0.011, z * 0.011, 3) * 4.6;
  const cafeFlatMask = smoothstep(38, 15, Math.hypot(x - -46, z - 28));
  const pierEntryFlat = smoothstep(28, 12, Math.hypot(x - 50, z - -75));
  const overlookFlat = smoothstep(26, 11, Math.hypot(x - 18, z - 128));
  const lonelyFlat = smoothstep(30, 14, Math.hypot(x - -95, z - -149));
  const pinkHollowFlat = smoothstep(28, 12, Math.hypot(x - -15, z - -176));

  const flattenWeight = clamp(
    cafeFlatMask + pierEntryFlat + overlookFlat + lonelyFlat + pinkHollowFlat,
    0,
    1
  );
  h += undulation * (1 - flattenWeight * 0.96);

  // Lock exact landmark plateau elevations smoothly to match surrounding hill crests
  if (cafeFlatMask > 0.001) {
    h = h * (1 - cafeFlatMask) + 135.15 * cafeFlatMask;
  }
  if (pierEntryFlat > 0.001) {
    h = h * (1 - pierEntryFlat) + 196.15 * pierEntryFlat;
  }
  if (overlookFlat > 0.001) {
    h = h * (1 - overlookFlat) + 112.0 * overlookFlat;
  }
  if (lonelyFlat > 0.001) {
    h = h * (1 - lonelyFlat) + 176.0 * lonelyFlat;
  }
  if (pinkHollowFlat > 0.001) {
    h = h * (1 - pinkHollowFlat) + 168.0 * pinkHollowFlat;
  }

  // Smooth inverse-distance blended trail elevation across junctions
  let minTrailDist = 9999;
  let weightSum = 0;
  let weightedTrailY = 0;
  for (let i = 0; i < GRADED_TRAILS.length; i++) {
    const [ax, az, bx, bz, ya, yb] = GRADED_TRAILS[i];
    const { dist, t } = distToSegment2D(x, z, ax, az, bx, bz);
    if (dist < minTrailDist) {
      minTrailDist = dist;
    }
    if (dist < 9.5) {
      const segY = ya + (yb - ya) * t;
      const w = Math.pow(1 - dist / 9.5, 3) / (dist * dist + 0.35);
      weightedTrailY += segY * w;
      weightSum += w;
    }
  }
  const gradedTrailY = weightSum > 0 ? weightedTrailY / weightSum : h;

  // Subtle terraced steps on Cầu Đất tea slopes (away from trails & plateaus)
  const teaZone = gaussian2D(x, z, 36, -58, 66, 66) * (1 - flattenWeight);
  if (teaZone > 0.22 && minTrailDist > 6.5) {
    const stepH = 1.65;
    const terraced =
      Math.floor(h / stepH) * stepH + smoothstep(0.0, 0.48, (h % stepH) / stepH) * stepH;
    h = h * (1 - teaZone * 0.62) + terraced * (teaZone * 0.62);
  }

  // Smooth graded red-basalt trail embankment (< 24 deg guaranteed everywhere!)
  if (minTrailDist < 9.0) {
    const trailBlend = 1 - smoothstep(2.8, 9.0, minTrailDist);
    h = h * (1 - trailBlend) + gradedTrailY * trailBlend;
  }

  // Wind turbine valley pedestals (submerged cleanly at 42..48m beneath the cloud sea)
  const turbineCoords: Array<[number, number, number]> = [
    [185, -145, 48],
    [235, -65, 46],
    [215, 28, 44],
    [295, -185, 48],
    [310, -15, 42],
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

  // 1. Cầu Gỗ Săn Mây wooden bridge (x=52..84.5 ramp + flat circular sunrise deck centered at 91,-75 at y=198.28m)
  if (x >= 50 && x <= 98.5 && Math.abs(z - -75) <= 7.0) {
    const distDeck = Math.hypot(x - 91, z - -75);
    if (distDeck <= 6.75) {
      return Math.max(ground, 198.28);
    }
    if (x <= 85.0 && Math.abs(z - -75) <= 2.7) {
      const rampY = 196.15 + clamp(x - 52, 0, 32.5) * 0.0525;
      const deckBlend = smoothstep(83.2, 84.6, x);
      const bridgeY = rampY * (1 - deckBlend) + 198.28 * deckBlend;
      return Math.max(ground, bridgeY);
    }
  }

  // 2. Tiệm Cà Phê Mơ Sương stilted wooden scenic deck (-51.85..-24.15, z: 19.65..40.35, plank top = 135.307m)
  if (x >= -51.85 && x <= -24.15 && z >= 19.65 && z <= 40.35) {
    return Math.max(ground, 135.307);
  }

  return ground;
}

export function getSurfaceType(x: number, z: number): SurfaceType {
  if (
    (x >= 50 && x <= 98.5 && (Math.abs(z - -75) <= 2.7 || Math.hypot(x - 91, z - -75) <= 6.75)) ||
    (x >= -51.85 && x <= -24.15 && z >= 19.65 && z <= 40.35)
  ) {
    return 'wood_deck';
  }
  const ground = sampleGroundHeight(x, z);
  if (ground < 52) return 'valley_floor';
  if (distanceToTrail(x, z) < 3.1) return 'red_basalt_trail';
  if (gaussian2D(x, z, -14, -175, 42, 38) > 0.42) return 'pink_grass_meadow';
  if (gaussian2D(x, z, 36, -58, 62, 62) > 0.32) return 'tea_terrace';
  return 'pine_grass';
}

export function gameYToASL(y: number): number {
  return Math.round(WORLD_CONSTANTS.BASE_ASL_METERS + y);
}
