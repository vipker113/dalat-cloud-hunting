import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import {
  distanceToTrail,
  fbm2D,
  getSurfaceType,
  sampleGroundHeight,
  SHARED_BENCHES,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';
import { worldColliderRegistry } from './colliderRegistry';
import {
  getDeterministicPinesAndLanterns,
  isInsideStiltedDeckFootprint,
  seededHash,
  TURBINE_PEDESTALS,
} from './worldScatterDeterministic';

const TERRAIN_SEGMENTS = 256;
const WORLD_SPAN = WORLD_CONSTANTS.HALF_SIZE * 2; // 900m [-450, 450]

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function gaussian2D(x: number, z: number, cx: number, cz: number, rx: number, rz: number): number {
  const dx = (x - cx) / rx;
  const dz = (z - cz) / rz;
  return Math.exp(-(dx * dx + dz * dz));
}

/**
 * Strips non-position attributes from a geometry so mergeGeometries + MeshBVH stay compact & fast.
 */
function toPositionOnlyGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const pos = src.getAttribute('position');
  geo.setAttribute('position', pos.clone());
  if (src.index) {
    geo.setIndex(src.index.clone());
  }
  return geo;
}

/**
 * Builds the exact walkable collider geometry for Cầu Gỗ Săn Mây (x: 50..97.8, z: -75, ramp + flat 198.28m sunrise deck),
 * Tiệm Cà Phê Mơ Sương stilted veranda deck (x: -51.8..-23, z: 19..41, y: 135.15),
 * and Gác Chè Cổ 1927 timber pavilion platform.
 */
function createWalkableDeckColliders(): THREE.BufferGeometry[] {
  // 1. Cầu Gỗ Săn Mây inclined wooden bridge corridor: x in [50, 85.2], z in [-77.7, -72.3]
  const bridgeLen = 35.2;
  const bridgeWidth = 5.4;
  const bridgeThickness = 0.5;
  const bridgeBox = new THREE.BoxGeometry(bridgeLen, bridgeThickness, bridgeWidth, 28, 1, 2);
  bridgeBox.translate(50 + bridgeLen * 0.5, -bridgeThickness * 0.5, -75);

  const bPos = bridgeBox.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < bPos.count; i++) {
    const wx = bPos.getX(i);
    const localY = bPos.getY(i); // 0 on top face, -0.5 on bottom face
    const rampY = 196.15 + clamp(wx - 52, 0, 32.5) * 0.0525;
    const deckBlend = smoothstep(83.2, 84.6, wx);
    const surfaceY = rampY * (1 - deckBlend) + 198.28 * deckBlend;
    bPos.setY(i, surfaceY + localY);
  }

  // 2. Cầu Gỗ Săn Mây flat circular sunrise deck centered at (91, -75), radius 6.75m, exact plank top y = 198.28m
  const roundDeck = new THREE.CylinderGeometry(6.75, 6.75, bridgeThickness, 32, 1);
  roundDeck.translate(91, 198.28 - bridgeThickness * 0.5, -75);

  // 3. Tiệm Cà Phê Mơ Sương stilted veranda deck: x in [-51.85, -24.15], z in [19.65, 40.35], exact plank top y = 135.307m
  const cafeWidthX = -24.15 - -51.85; // 27.7m
  const cafeDepthZ = 40.35 - 19.65; // 20.7m
  const cafeThickness = 0.8;
  const cafeDeck = new THREE.BoxGeometry(cafeWidthX, cafeThickness, cafeDepthZ, 4, 1, 4);
  cafeDeck.translate(-38.0, 135.307 - cafeThickness * 0.5, 30);

  // 4. Gác Chè Cổ 1927 weathered timber pavilion platform at [-21, gacCheY, -181] (4.2 x 0.5 x 3.6, yaw 0.65)
  const gacCheGroundY = sampleGroundHeight(-21, -181);
  const gacCheDeck = new THREE.BoxGeometry(4.2, 0.5, 3.6);
  gacCheDeck.rotateY(0.65);
  gacCheDeck.translate(-21, gacCheGroundY + 0.25, -181);

  const out = [
    toPositionOnlyGeometry(bridgeBox),
    toPositionOnlyGeometry(roundDeck),
    toPositionOnlyGeometry(cafeDeck),
    toPositionOnlyGeometry(gacCheDeck),
  ];

  bridgeBox.dispose();
  roundDeck.dispose();
  cafeDeck.dispose();
  gacCheDeck.dispose();

  return out;
}

/**
 * Open-ended 4-wall vertical prism (zero top/bottom caps -> normal.y === 0 everywhere,
 * so downward floor raycasts never step onto walls, railings, cabins, benches, or tables!).
 */
function makeOpenWallPrism(
  width: number,
  height: number,
  depth: number,
  cx: number,
  bottomY: number,
  cz: number,
  yaw = 0
): THREE.BufferGeometry {
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const positions = new Float32Array([
    -hw, 0, -hd,
     hw, 0, -hd,
     hw, 0,  hd,
    -hw, 0,  hd,
    -hw, height, -hd,
     hw, height, -hd,
     hw, height,  hd,
    -hw, height,  hd,
  ]);
  const indices = new Uint16Array([
    1, 0, 4,  1, 4, 5, // North (-Z)
    2, 1, 5,  2, 5, 6, // East (+X)
    3, 2, 6,  3, 6, 7, // South (+Z)
    0, 3, 7,  0, 7, 4, // West (-X)
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  if (yaw !== 0) {
    geo.rotateY(yaw);
  }
  geo.translate(cx, bottomY, cz);
  return geo;
}

function makeWallSegment2D(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  bottomY: number,
  height: number,
  thickness = 0.34
): THREE.BufferGeometry {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 0.1;
  const yaw = Math.atan2(-dz, dx);
  return makeOpenWallPrism(len + 0.08, height, thickness, (ax + bx) * 0.5, bottomY, (az + bz) * 0.5, yaw);
}

function makeOpenCylinderCollider(
  radius: number,
  height: number,
  cx: number,
  bottomY: number,
  cz: number,
  radialSegments = 8
): THREE.BufferGeometry {
  const cyl = new THREE.CylinderGeometry(radius, radius, height, radialSegments, 1, true);
  cyl.translate(cx, bottomY + height * 0.5, cz);
  const out = toPositionOnlyGeometry(cyl);
  cyl.dispose();
  return out;
}

/**
 * Watertight solid obstacle colliders for all buildings, railings, tables, benches,
 * campfire stones, Vintage Super Cub 50, pavilion pillars, support stilts, wind turbines,
 * trail lanterns, greenhouses & highland pine trunks!
 */
function createObstacleWallAndPropColliders(): THREE.BufferGeometry[] {
  const obs: THREE.BufferGeometry[] = [];

  // 1. Tiệm Cà Phê Gỗ "Mơ Sương" (origin [-38, 135.15, 30])
  // Main A-frame wooden cabin body + front espresso service counter
  obs.push(makeOpenWallPrism(9.1, 5.8, 12.75, -45.6, 134.8, 29.95));
  obs.push(makeOpenWallPrism(1.6, 2.0, 4.5, -40.35, 135.0, 30.0));

  // Veranda wooden railings along North (z=20.05), South (z=39.95), and East cliff edge (x=-24.42)
  obs.push(makeWallSegment2D(-41.55, 20.05, -24.3, 20.05, 135.0, 1.75, 0.36));
  obs.push(makeWallSegment2D(-41.55, 39.95, -24.3, 39.95, 135.0, 1.75, 0.36));
  obs.push(makeWallSegment2D(-24.42, 19.95, -24.42, 40.05, 135.0, 1.75, 0.36));

  // Veranda string-light timber poles & 3 bistro table sets
  obs.push(makeOpenCylinderCollider(0.24, 4.0, -26.5, 135.0, 24.5, 8));
  obs.push(makeOpenCylinderCollider(0.24, 4.0, -26.5, 135.0, 35.5, 8));
  obs.push(makeOpenCylinderCollider(0.74, 1.45, -32.5, 135.0, 35.0, 10));
  obs.push(makeOpenCylinderCollider(0.74, 1.45, -32.5, 135.0, 25.5, 10));
  obs.push(makeOpenCylinderCollider(0.74, 1.45, -28.5, 135.0, 30.0, 10));

  // Under-veranda timber support stilts
  for (const sx of [-50.5, -42.0, -33.0, -25.0]) {
    for (const sz of [20.5, 30.0, 39.5]) {
      const gy = sampleGroundHeight(sx, sz);
      const h = Math.max(0.8, 135.06 - gy + 0.4);
      obs.push(makeOpenCylinderCollider(0.2, h, sx, gy - 0.3, sz, 6));
    }
  }

  // 2. Cầu Gỗ Săn Mây (ramp x=51.8..85.4, z=-75 ± 2.32 + circular sunrise deck at (91, -75) r=6.68m)
  const rampSegs = 6;
  for (let s = 0; s < rampSegs; s++) {
    const x0 = 51.8 + (33.6 * s) / rampSegs;
    const x1 = 51.8 + (33.6 * (s + 1)) / rampSegs;
    const xm = (x0 + x1) * 0.5;
    const baseY = 195.85 + clamp(xm - 52, 0, 32.5) * 0.0525;
    obs.push(makeWallSegment2D(x0, -77.34, x1, -77.34, baseY, 2.05, 0.36));
    obs.push(makeWallSegment2D(x0, -72.66, x1, -72.66, baseY, 2.05, 0.36));
  }

  // Circular sunrise deck perimeter railing (28 segments, leaving only West ramp entrance open!)
  const ringSegs = 28;
  const deckR = 6.68;
  for (let k = 0; k < ringSegs; k++) {
    const a0 = (k / ringSegs) * Math.PI * 2;
    const a1 = ((k + 1) / ringSegs) * Math.PI * 2;
    const am = (a0 + a1) * 0.5;
    const mx = 91.0 + Math.cos(am) * deckR;
    const mz = -75.0 + Math.sin(am) * deckR;
    // Leave West bridge corridor mouth open
    if (mx < 85.7 && Math.abs(mz - -75.0) < 2.28) continue;
    obs.push(
      makeWallSegment2D(
        91.0 + Math.cos(a0) * deckR,
        -75.0 + Math.sin(a0) * deckR,
        91.0 + Math.cos(a1) * deckR,
        -75.0 + Math.sin(a1) * deckR,
        198.0,
        1.85,
        0.36
      )
    );
  }
  // Wooden check-in signboard on circular sunrise deck
  obs.push(makeOpenWallPrism(0.8, 2.5, 1.7, 96.2, 198.05, -78.3));

  // Under-bridge timber support stilts
  for (const bx of [58, 66, 74, 82, 91, 96]) {
    const zOffsets = bx >= 88 ? [-4.6, 4.6] : [-2.1, 2.1];
    for (const dz of zOffsets) {
      const bz = -75 + dz;
      const gy = sampleGroundHeight(bx, bz);
      const topY = bx >= 85 ? 198.08 : 196.0 + Math.max(0, bx - 52) * 0.0525;
      obs.push(makeOpenCylinderCollider(0.2, Math.max(1.2, topY - gy + 0.5), bx, gy - 0.3, bz, 6));
    }
  }

  // 3. Gác Chè Cổ 1927 timber pavilion 4 corner columns at [-21, gacCheGroundY, -181] (yaw 0.65)
  const gacCheY = sampleGroundHeight(-21, -181);
  const cosG = Math.cos(0.65);
  const sinG = Math.sin(0.65);
  for (const [lx, lz] of [
    [-1.75, -1.45],
    [1.75, -1.45],
    [-1.75, 1.45],
    [1.75, 1.45],
  ] as const) {
    const wx = -21 + lx * cosG + lz * sinG;
    const wz = -181 - lx * sinG + lz * cosG;
    obs.push(makeOpenWallPrism(0.32, 2.7, 0.32, wx, gacCheY + 0.2, wz, 0.65));
  }

  // 4. Campfire Stone Pit, Vintage Super Cub 50, Lonely Pine Hero Trunk & 5 Wind Turbine Towers
  obs.push(makeOpenCylinderCollider(1.16, 1.45, -53.0, 134.95, 24.0, 10));
  obs.push(
    makeOpenWallPrism(1.92, 1.45, 0.78, 19.8, sampleGroundHeight(19.8, 125.2) - 0.15, 125.2, -0.68)
  );
  obs.push(
    makeOpenCylinderCollider(0.84, 6.8, -95.0, sampleGroundHeight(-95, -155) - 0.5, -155.0, 10)
  );
  for (const [tx, tz] of TURBINE_PEDESTALS) {
    obs.push(makeOpenCylinderCollider(6.2, 18.0, tx, sampleGroundHeight(tx, tz) - 1.0, tz, 12));
  }

  // 5. All Shared Wooden Benches (players still sit smoothly via [E], blocked from walking through!)
  for (const b of SHARED_BENCHES) {
    obs.push(makeOpenWallPrism(1.82, 1.2, 0.64, b.position[0], b.position[1] - 0.1, b.position[2], b.yaw));
  }

  // 6. All ~460 Highland Pine Tree Trunks & Trail Lantern Posts
  const { pines, lanterns } = getDeterministicPinesAndLanterns();
  for (const p of pines) {
    obs.push(makeOpenCylinderCollider(0.42 * p.scaleXZ, 4.2, p.x, p.y - 0.25, p.z, 7));
  }
  for (const lp of lanterns) {
    obs.push(makeOpenCylinderCollider(0.22, 2.85, lp.x, lp.y - 0.1, lp.z, 6));
  }

  // 6b. Trailside Mossy Boulders (synced 1:1 with HighlandFoliageAndProps deterministic scatter)
  let fernCount = 0;
  let shrubCount = 0;
  let mossRockCount = 0;
  for (let i = 0; i < 2200 && fernCount < 160; i++) {
    const fx = (seededHash(i * 6.13 + 71) - 0.5) * 420;
    const fz = (seededHash(i * 9.47 + 19) - 0.5) * 420;
    const dTrail = distanceToTrail(fx, fz);
    if (dTrail < 3.4 || dTrail > 26) continue;
    if (isInsideStiltedDeckFootprint(fx, fz)) continue;
    if (fx >= -56 && fx <= -20 && fz >= 16 && fz <= 43) continue;
    const fy = sampleGroundHeight(fx, fz);
    if (fy < 88) continue;

    const gx = (sampleGroundHeight(fx + 0.8, fz) - sampleGroundHeight(fx - 0.8, fz)) / 1.6;
    const gz = (sampleGroundHeight(fx, fz + 0.8) - sampleGroundHeight(fx, fz - 0.8)) / 1.6;
    if (Math.hypot(gx, gz) > 0.62) continue;

    if (i % 3 === 0 && shrubCount < 110) {
      shrubCount++;
    } else {
      fernCount++;
    }

    if (i % 5 === 0 && mossRockCount < 85 && dTrail > 4.6) {
      const rkSc = 1.1 + seededHash(i * 31.1) * 1.65;
      const rx = fx + 1.1;
      obs.push(
        makeOpenCylinderCollider(
          0.54 * rkSc,
          1.35 * rkSc,
          rx,
          sampleGroundHeight(rx, fz) - 0.35,
          fz,
          7
        )
      );
      mossRockCount++;
    }
  }

  // 6c. Cầu Đất Contour Tea Hedge Rows (aisles between rings stay open for strolling; solid bushes block!)
  let teaCount = 0;
  for (let ring = 0; ring < 14 && teaCount < 380; ring++) {
    const radius = 14 + ring * 3.7;
    const segCount = Math.floor((2 * Math.PI * radius) / 2.65);
    for (let s = 0; s < segCount && teaCount < 380; s++) {
      const angle = (s / segCount) * Math.PI * 2 + ring * 0.19;
      const hx = 36 + Math.cos(angle) * radius;
      const hz = -58 + Math.sin(angle) * radius * 0.95;
      if (distanceToTrail(hx, hz) < 4.7) continue;
      if (Math.hypot(hx - 52, hz - -75) < 15.5) continue;
      const hy = sampleGroundHeight(hx, hz);
      const gx = sampleGroundHeight(hx + 1.2, hz) - sampleGroundHeight(hx - 1.2, hz);
      const gz = sampleGroundHeight(hx, hz + 1.2) - sampleGroundHeight(hx, hz - 1.2);
      const contourYaw = Math.atan2(gx, -gz);
      obs.push(makeOpenWallPrism(2.48, 1.15, 1.12, hx, hy - 0.25, hz, contourYaw));
      teaCount++;
    }
  }

  // 7. Thung Lũng Đèn Valley Greenhouses
  let ghCount = 0;
  for (let gx = 148; gx <= 378 && ghCount < 160; gx += 16.5) {
    for (let gz = -42; gz <= 228 && ghCount < 160; gz += 19.5) {
      const jx = gx + (seededHash(gx * 13 + gz * 7) - 0.5) * 5.0;
      const jz = gz + (seededHash(gx * 19 + gz * 11) - 0.5) * 5.0;
      if (jx < 145 || jx > 380 || jz < -45 || jz > 230) continue;
      const gy = sampleGroundHeight(jx, jz);
      if (gy > 66) continue;
      if (seededHash(gx * 31 + gz * 17) < 0.08) continue;
      const yaw = 0.12 + (seededHash(gx * 7 + gz * 23) - 0.5) * 0.18;
      const sc = 0.86 + seededHash(gx * 41 + gz * 3) * 0.34;
      const scZ = sc * (0.9 + seededHash(gx + gz) * 0.25);
      obs.push(makeOpenWallPrism(5.6 * sc, 2.8 * sc, 11.4 * scZ, jx, gy - 0.5, jz, yaw));
      ghCount++;
    }
  }

  return obs;
}

interface TerrainShaderUniforms {
  uDrizzle: { value: number };
  uPinkGrassPhase: { value: number };
  uPinkDayFade: { value: number };
  uSnowGrassColor: { value: THREE.Color };
  uRosePinkColor: { value: THREE.Color };
  uDayPinkMeadowColor: { value: THREE.Color };
  uBasaltDiff: { value: THREE.Texture };
  uBasaltNor: { value: THREE.Texture };
  uForestDiff: { value: THREE.Texture };
  uForestNor: { value: THREE.Texture };
}

function make1x1FallbackTex(r: number, g: number, b: number, srgb: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function DaLatWorldTerrain() {
  // Construct sculpted 240x240 terrain + splatmap attributes + merged MeshBVH collider once
  const { terrainGeometry, colliderMesh, bvh } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(
      WORLD_SPAN,
      WORLD_SPAN,
      TERRAIN_SEGMENTS,
      TERRAIN_SEGMENTS
    );
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const vertCount = posAttr.count;

    // 1. Displace Y using exact shared protocol terrain heightfield
    for (let i = 0; i < vertCount; i++) {
      const wx = posAttr.getX(i);
      const wz = posAttr.getZ(i);
      posAttr.setY(i, sampleGroundHeight(wx, wz));
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();

    const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
    const colors = new Float32Array(vertCount * 3);
    // vec4: x = redBasaltTrailMask, y = pinkGrassMeadowMask, z = teaTerraceMask, w = morningDewMask
    const surfaceWeights = new Float32Array(vertCount * 4);

    // Linear-sRGB palette colors via THREE.Color
    const cGrassLight = new THREE.Color('#3E6B48');
    const cGrassDeep = new THREE.Color('#2A4B3C');
    const cBasaltClay = new THREE.Color('#8F4933');
    const cBasaltEdge = new THREE.Color('#704432');
    const cTeaLeaf = new THREE.Color('#4F7D3B');
    const cTeaSoil = new THREE.Color('#5A3B2B');
    const cValleySoil = new THREE.Color('#324433');
    const cScratch = new THREE.Color();
    const cBlend = new THREE.Color();

    for (let i = 0; i < vertCount; i++) {
      const wx = posAttr.getX(i);
      const wy = posAttr.getY(i);
      const wz = posAttr.getZ(i);
      const ny = normAttr.getY(i);

      const dapple = clamp(0.5 + fbm2D(wx * 0.045, wz * 0.045, 2) * 0.65, 0, 1);
      const slopeSteepness = clamp((1.0 - ny) * 3.2, 0, 1);

      // Base Highland Dewy Pine Grass (#3E6B48 -> #2A4B3C)
      const grassMix = clamp(slopeSteepness * 0.55 + (1.0 - dapple) * 0.45, 0, 1);
      cScratch.copy(cGrassLight).lerp(cGrassDeep, grassMix);

      // Valley floor transition below Y = 52m
      const valleyMask = smoothstep(56, 38, wy);
      if (valleyMask > 0.001) {
        cScratch.lerp(cValleySoil, valleyMask * 0.72);
      }

      // Cầu Đất Tea Terrace soil & contour stripes (#4F7D3B)
      const surfaceType = getSurfaceType(wx, wz);
      const teaFieldGauss = gaussian2D(wx, wz, 36, -58, 64, 64);
      const teaMask =
        surfaceType === 'tea_terrace'
          ? clamp(teaFieldGauss * 1.65, 0, 1)
          : smoothstep(0.24, 0.42, teaFieldGauss);

      if (teaMask > 0.001) {
        const stepPhase = ((wy % 1.65) + 1.65) % 1.65 / 1.65;
        const riserSoil = smoothstep(0.0, 0.28, stepPhase) * (1.0 - smoothstep(0.28, 0.55, stepPhase));
        cBlend.copy(cTeaLeaf).lerp(cTeaSoil, riserSoil * 0.58 + slopeSteepness * 0.25);
        cScratch.lerp(cBlend, teaMask * 0.88);
      }

      // Secret Hõm Cỏ Tuyết / Cỏ Hồng meadow mask around (-12, -175)
      const pinkGauss = gaussian2D(wx, wz, -12, -175, 42, 38);
      const pinkMask =
        surfaceType === 'pink_grass_meadow'
          ? clamp((pinkGauss - 0.25) * 1.8, 0.45, 1.0)
          : smoothstep(0.28, 0.48, pinkGauss);

      // Da Lat Red-Basalt Clay (#8F4933) along TRAIL_SEGMENTS + landmark footpaths
      const distTrail = distanceToTrail(wx, wz);
      const trailCore = 1.0 - smoothstep(2.35, 3.85, distTrail);
      const trailMask = surfaceType === 'red_basalt_trail' ? Math.max(0.85, trailCore) : trailCore;

      if (trailMask > 0.001) {
        const pebble = 0.88 + 0.22 * fbm2D(wx * 0.28, wz * 0.28, 2);
        cBlend.copy(cBasaltEdge).lerp(cBasaltClay, smoothstep(0.15, 0.78, trailMask));
        cBlend.multiplyScalar(pebble);
        cScratch.lerp(cBlend, trailMask);
      }

      colors[i * 3] = cScratch.r;
      colors[i * 3 + 1] = cScratch.g;
      colors[i * 3 + 2] = cScratch.b;

      surfaceWeights[i * 4] = trailMask;
      surfaceWeights[i * 4 + 1] = pinkMask * (1.0 - trailMask * 0.92);
      surfaceWeights[i * 4 + 2] = teaMask * (1.0 - trailMask);
      surfaceWeights[i * 4 + 3] = clamp((1.0 - trailMask) * ny, 0, 1);
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSurfaceWeights', new THREE.BufferAttribute(surfaceWeights, 4));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    // 2. Build combined walkable + solid obstacle MeshBVH collider (Terrain + Decks + Walls/Railings/Props/Trees)
    const terrainPosGeo = toPositionOnlyGeometry(geo);
    const deckGeos = createWalkableDeckColliders();
    const obstacleGeos = createObstacleWallAndPropColliders();
    const mergedColliderGeo = mergeGeometries(
      [terrainPosGeo, ...deckGeos, ...obstacleGeos],
      false
    );

    terrainPosGeo.dispose();
    for (const dg of deckGeos) dg.dispose();
    for (const og of obstacleGeos) og.dispose();

    const builtBvh = new MeshBVH(mergedColliderGeo, { maxLeafSize: 12 });
    (mergedColliderGeo as unknown as { boundsTree: MeshBVH }).boundsTree = builtBvh;

    const colMat = new THREE.MeshBasicMaterial({ visible: false });
    const colMesh = new THREE.Mesh(mergedColliderGeo, colMat);
    colMesh.name = 'DaLatWorldWalkableCollider';
    colMesh.visible = false;
    colMesh.raycast = acceleratedRaycast;
    colMesh.updateMatrixWorld(true);

    return {
      terrainGeometry: geo,
      colliderMesh: colMesh,
      bvh: builtBvh,
    };
  }, []);

  // Custom shader uniforms shared with MeshStandardMaterial.onBeforeCompile
  const shaderUniforms = useMemo<TerrainShaderUniforms>(
    () => ({
      uDrizzle: { value: 0 },
      uPinkGrassPhase: { value: 0 }, // 0 = frosty silver-white (#DCE8F2), 1 = sunrise rose-pink (#F28DB2)
      uPinkDayFade: { value: 0 }, // >07:00 soft sunlit meadow blend
      uSnowGrassColor: { value: new THREE.Color('#DCE8F2') },
      uRosePinkColor: { value: new THREE.Color('#F28DB2') },
      uDayPinkMeadowColor: { value: new THREE.Color('#C88BA6') },
      uBasaltDiff: { value: make1x1FallbackTex(160, 102, 78, true) },
      uBasaltNor: { value: make1x1FallbackTex(128, 128, 255, false) },
      uForestDiff: { value: make1x1FallbackTex(96, 122, 88, true) },
      uForestNor: { value: make1x1FallbackTex(128, 128, 255, false) },
    }),
    []
  );

  // Stream compact 512x512 WebP Poly Haven PBR ground detail maps seamlessly
  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    const loaded: THREE.Texture[] = [];

    const loadMap = (
      url: string,
      srgb: boolean,
      assign: (tex: THREE.Texture) => void
    ) => {
      loader.load(url, (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        loaded.push(tex);
        assign(tex);
      });
    };

    loadMap('/assets/textures/basalt_diff.webp', true, (t) => {
      shaderUniforms.uBasaltDiff.value = t;
    });
    loadMap('/assets/textures/basalt_nor.webp', false, (t) => {
      shaderUniforms.uBasaltNor.value = t;
    });
    loadMap('/assets/textures/forest_diff.webp', true, (t) => {
      shaderUniforms.uForestDiff.value = t;
    });
    loadMap('/assets/textures/forest_nor.webp', false, (t) => {
      shaderUniforms.uForestNor.value = t;
    });

    return () => {
      cancelled = true;
      for (const t of loaded) t.dispose();
    };
  }, [shaderUniforms]);

  const terrainMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.03,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDrizzle = shaderUniforms.uDrizzle;
      shader.uniforms.uPinkGrassPhase = shaderUniforms.uPinkGrassPhase;
      shader.uniforms.uPinkDayFade = shaderUniforms.uPinkDayFade;
      shader.uniforms.uSnowGrassColor = shaderUniforms.uSnowGrassColor;
      shader.uniforms.uRosePinkColor = shaderUniforms.uRosePinkColor;
      shader.uniforms.uDayPinkMeadowColor = shaderUniforms.uDayPinkMeadowColor;
      shader.uniforms.uBasaltDiff = shaderUniforms.uBasaltDiff;
      shader.uniforms.uBasaltNor = shaderUniforms.uBasaltNor;
      shader.uniforms.uForestDiff = shaderUniforms.uForestDiff;
      shader.uniforms.uForestNor = shaderUniforms.uForestNor;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          attribute vec4 aSurfaceWeights;
          varying vec4 vSurfaceWeights;
          varying vec3 vTerrainWorldPos;
          `
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          vSurfaceWeights = aSurfaceWeights;
          vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform float uDrizzle;
          uniform float uPinkGrassPhase;
          uniform float uPinkDayFade;
          uniform vec3 uSnowGrassColor;
          uniform vec3 uRosePinkColor;
          uniform vec3 uDayPinkMeadowColor;
          uniform sampler2D uBasaltDiff;
          uniform sampler2D uBasaltNor;
          uniform sampler2D uForestDiff;
          uniform sampler2D uForestNor;
          varying vec4 vSurfaceWeights;
          varying vec3 vTerrainWorldPos;

          float terrainGrain(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
            float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
            float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
            float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }
          `
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          float trailW = vSurfaceWeights.x;
          float pinkW = vSurfaceWeights.y;
          float teaW = vSurfaceWeights.z;
          float pbrNearFade = 1.0 - smoothstep(28.0, 105.0, length(vViewPosition));

          // Dual-scale Poly Haven PBR micro-albedo (forest needles & red-basalt laterite pebbles!)
          if (pbrNearFade > 0.01) {
            vec2 uvFine = vTerrainWorldPos.xz * 0.36;
            vec2 uvMacro = vTerrainWorldPos.xz * 0.095 + vec2(0.37, 0.61);
            vec3 forestSample = mix(texture2D(uForestDiff, uvFine).rgb, texture2D(uForestDiff, uvMacro).rgb, 0.35);
            vec3 basaltSample = mix(texture2D(uBasaltDiff, uvFine * 1.15).rgb, texture2D(uBasaltDiff, uvMacro).rgb, 0.32);

            float forestLum = clamp(dot(forestSample, vec3(0.333)) * 2.35, 0.78, 1.24);
            diffuseColor.rgb *= mix(1.0, forestLum, (1.0 - trailW) * pbrNearFade * 0.58);

            if (trailW > 0.01) {
              vec3 richTrail = mix(diffuseColor.rgb, basaltSample * 1.12, 0.46);
              diffuseColor.rgb = mix(diffuseColor.rgb, richTrail, trailW * pbrNearFade);
            }
          }

          // Subtle painterly micro-grain across grass, tea contours & basalt clay
          float micro = terrainGrain(vTerrainWorldPos.xz * 1.35);
          diffuseColor.rgb *= (0.94 + 0.12 * micro);

          // Crisp Cầu Đất tea terrace contour stripe accent
          if (teaW > 0.01) {
            float contourWave = 0.5 + 0.5 * sin(vTerrainWorldPos.y * (6.28318 / 1.65));
            diffuseColor.rgb *= mix(1.0, 0.88 + 0.22 * contourWave, teaW * 0.75);
          }

          // Magical Cỏ Tuyết (#DCE8F2 before 05:15) -> Cỏ Hồng (#F28DB2 during 05:15-07:00 sunrise)
          if (pinkW > 0.01) {
            vec3 meadowTint = mix(uSnowGrassColor, uRosePinkColor, uPinkGrassPhase);
            meadowTint = mix(meadowTint, uDayPinkMeadowColor, uPinkDayFade);
            float frostSparkle = 0.90 + 0.18 * terrainGrain(vTerrainWorldPos.xz * 3.6);
            diffuseColor.rgb = mix(diffuseColor.rgb, meadowTint * frostSparkle, pinkW * 0.88);
          }

          // Red-Basalt clay trail darkens richly when wet from Highland Drizzle
          if (trailW > 0.01 && uDrizzle > 0.01) {
            float puddlePatch = smoothstep(0.42, 0.78, terrainGrain(vTerrainWorldPos.xz * 0.55));
            float wetDarken = mix(1.0, 0.56 - 0.14 * puddlePatch, trailW * uDrizzle);
            diffuseColor.rgb *= wetDarken;
          }
          `
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          #include <normal_fragment_maps>
          float nNear = 1.0 - smoothstep(24.0, 88.0, length(vViewPosition));
          if (nNear > 0.01) {
            vec2 nUv = vTerrainWorldPos.xz * 0.36;
            vec3 fNor = texture2D(uForestNor, nUv).xyz * 2.0 - 1.0;
            vec3 bNor = texture2D(uBasaltNor, nUv * 1.15).xyz * 2.0 - 1.0;
            vec2 xzSlope = mix(fNor.xy * 0.42, bNor.xy * 0.68, vSurfaceWeights.x) * nNear;
            // Dampen pebble micro-normals inside smooth water puddles during drizzle
            float puddleFlatten = 1.0 - vSurfaceWeights.x * uDrizzle * 0.55;
            vec3 worldPerturb = vec3(xzSlope.x, 0.0, xzSlope.y) * puddleFlatten;
            vec3 viewPerturb = (viewMatrix * vec4(worldPerturb, 0.0)).xyz;
            normal = normalize(normal + viewPerturb);
          }
          `
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `
          #include <roughnessmap_fragment>
          // Wet red-basalt clay puddles & morning dew shimmer reduce surface roughness for live sky reflections!
          float puddleMask = smoothstep(0.44, 0.76, terrainGrain(vTerrainWorldPos.xz * 0.55));
          float wetTrailSheen = vSurfaceWeights.x * uDrizzle * (0.42 + 0.34 * puddleMask);
          float morningDewSheen = vSurfaceWeights.w * (1.0 - uPinkDayFade) * 0.14;
          roughnessFactor = clamp(roughnessFactor - wetTrailSheen - morningDewSheen, 0.16, 0.95);
          `
        );
    };

    mat.customProgramCacheKey = () => 'dalat-painterly-pbr-terrain-v2';
    return mat;
  }, [shaderUniforms]);

  // Register MeshBVH collider immediately on mount & clean up on unmount
  useEffect(() => {
    colliderMesh.updateMatrixWorld(true);
    worldColliderRegistry.setCollider(colliderMesh, bvh);

    return () => {
      worldColliderRegistry.clearCollider(colliderMesh);
      terrainGeometry.dispose();
      terrainMaterial.dispose();
      colliderMesh.geometry.dispose();
      (colliderMesh.material as THREE.Material).dispose();
    };
  }, [colliderMesh, bvh, terrainGeometry, terrainMaterial]);

  // Animate dynamic Cỏ Tuyết / Cỏ Hồng sunrise shift & wet basalt drizzle sheen (zero allocations)
  useFrame((_, dt) => {
    const atmo = useGameStore.getState().atmosphere;
    const lerpRate = Math.min(1, dt * 4.0);
    const gh = atmo.gameHour;

    // Frosty silver-white (#DCE8F2) before 05:15 -> glowing rose-pink (#F28DB2) during 05:15-07:00 sunrise!
    let targetPinkPhase = 0.0;
    let targetDayFade = 0.0;
    if (gh >= 5.15 && gh <= 7.15) {
      targetPinkPhase = smoothstep(5.12, 5.45, gh);
      targetDayFade = smoothstep(6.75, 7.25, gh) * 0.55;
    } else if (gh > 7.15 && gh < 17.6) {
      targetPinkPhase = 1.0;
      targetDayFade = 0.65;
    } else if (gh >= 17.6 && gh < 18.8) {
      targetPinkPhase = 1.0 - smoothstep(17.6, 18.7, gh);
      targetDayFade = 0.3 * (1.0 - smoothstep(17.6, 18.4, gh));
    }

    shaderUniforms.uDrizzle.value +=
      (atmo.drizzleIntensity - shaderUniforms.uDrizzle.value) * lerpRate;
    shaderUniforms.uPinkGrassPhase.value +=
      (targetPinkPhase - shaderUniforms.uPinkGrassPhase.value) * lerpRate;
    shaderUniforms.uPinkDayFade.value +=
      (targetDayFade - shaderUniforms.uPinkDayFade.value) * lerpRate;
  });

  return (
    <group name="DaLatWorldTerrainGroup">
      <mesh
        name="DaLatSculptedTerrain"
        geometry={terrainGeometry}
        material={terrainMaterial}
        receiveShadow
      />
      <primitive object={colliderMesh} />
    </group>
  );
}
