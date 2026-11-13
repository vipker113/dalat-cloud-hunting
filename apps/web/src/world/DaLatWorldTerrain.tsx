import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import {
  distanceToTrail,
  fbm2D,
  getSurfaceType,
  sampleGroundGradient,
  sampleGroundHeight,
  SHARED_BENCHES,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';
import { worldColliderRegistry } from './colliderRegistry';
import {
  getDeterministicPinesAndLanterns,
  seededHash,
  TURBINE_PEDESTALS,
} from './worldScatterDeterministic';

const TERRAIN_SEGMENTS = 256;
const TERRAIN_TILE_GRID = 4; // 4x4 spatial terrain chunks (64x64 quads each) for frustum culling
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
 * Extracts only upward-facing walkable triangles (normal.y > 0.5) from a deck geometry,
 * stripping vertical perimeter side skirts and bottom caps so they never act as invisible walls!
 */
function toTopSurfaceOnlyGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const idx = src.getIndex();
  const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);

  const outPositions: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const norm = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    norm.crossVectors(ab, ac);
    const len = norm.length();
    if (len > 1e-8 && norm.y / len > 0.5) {
      outPositions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
  }

  const geo = new THREE.BufferGeometry();
  const vertArray = new Float32Array(outPositions);
  geo.setAttribute('position', new THREE.BufferAttribute(vertArray, 3));
  const vertCount = vertArray.length / 3;
  const indices = new Uint32Array(vertCount);
  for (let i = 0; i < vertCount; i++) indices[i] = i;
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/**
 * Builds the exact walkable collider geometry for Cầu Gỗ Săn Mây (x: 47.8..97.8, z: -75, smooth entry + ramp + flat 198.28m sunrise deck),
 * Tiệm Cà Phê Mơ Sương stilted veranda deck (x: -51.85..-24.15, z: 19.65..40.35, y: 135.307),
 * and Gác Chè Cổ 1927 timber pavilion platform.
 */
function createWalkableDeckColliders(): THREE.BufferGeometry[] {
  // 1. Cầu Gỗ Săn Mây inclined wooden bridge corridor + flush entry apron: x in [47.8, 85.2], z in [-77.7, -72.3]
  const bridgeStartX = 47.8;
  const bridgeLen = 85.2 - bridgeStartX;
  const bridgeWidth = 5.4;
  const bridgeThickness = 0.5;
  const bridgeBox = new THREE.BoxGeometry(bridgeLen, bridgeThickness, bridgeWidth, 34, 1, 6);
  bridgeBox.translate(bridgeStartX + bridgeLen * 0.5, -bridgeThickness * 0.5, -75);

  const bPos = bridgeBox.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < bPos.count; i++) {
    const wx = bPos.getX(i);
    const wz = bPos.getZ(i);
    const localY = bPos.getY(i); // 0 on top face, -0.5 on bottom face
    const groundY = sampleGroundHeight(wx, wz);
    const entryBlend = smoothstep(47.8, 52.0, wx);
    const rampY = 196.15 + clamp(wx - 52, 0, 32.5) * 0.0525;
    const deckBlend = smoothstep(83.2, 84.6, wx);
    const targetDeckY = rampY * (1 - deckBlend) + 198.28 * deckBlend;
    const surfaceY = Math.max(groundY, groundY * (1 - entryBlend) + targetDeckY * entryBlend);
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
    toTopSurfaceOnlyGeometry(bridgeBox),
    toTopSurfaceOnlyGeometry(roundDeck),
    toTopSurfaceOnlyGeometry(cafeDeck),
    toTopSurfaceOnlyGeometry(gacCheDeck),
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

  // Veranda string-light timber poles & 3 bistro table sets (tight radii so walkways never snag)
  obs.push(makeOpenCylinderCollider(0.18, 4.0, -26.5, 135.0, 24.5, 8));
  obs.push(makeOpenCylinderCollider(0.18, 4.0, -26.5, 135.0, 35.5, 8));
  obs.push(makeOpenCylinderCollider(0.42, 1.15, -32.5, 135.0, 35.0, 10));
  obs.push(makeOpenCylinderCollider(0.42, 1.15, -32.5, 135.0, 25.5, 10));
  obs.push(makeOpenCylinderCollider(0.42, 1.15, -28.5, 135.0, 30.0, 10));

  // Under-veranda timber support stilts (strictly below deck floor 135.06m so they never poke through!)
  for (const sx of [-50.5, -42.0, -33.0, -25.0]) {
    for (const sz of [20.5, 30.0, 39.5]) {
      const gy = sampleGroundHeight(sx, sz);
      const clearance = 135.06 - gy;
      if (clearance > 1.85) {
        const botY = gy - 0.2;
        const maxTopY = 135.06 - 0.6;
        const h = Math.max(0.5, maxTopY - botY);
        obs.push(makeOpenCylinderCollider(0.18, h, sx, botY, sz, 6));
      }
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

  // Under-bridge timber trestle columns (strictly below bridge deck & x >= 63.5 so REG-09 entry ramp never snags!)
  const cauGoTrestleCols: Array<[number, number, number]> = [
    [63.5, -77.15, 196.15 + (63.5 - 52) * 0.0525],
    [63.5, -72.85, 196.15 + (63.5 - 52) * 0.0525],
    [69.0, -77.15, 196.15 + (69.0 - 52) * 0.0525],
    [69.0, -72.85, 196.15 + (69.0 - 52) * 0.0525],
    [74.5, -77.15, 196.15 + (74.5 - 52) * 0.0525],
    [74.5, -72.85, 196.15 + (74.5 - 52) * 0.0525],
    [80.0, -77.15, 196.15 + (80.0 - 52) * 0.0525],
    [80.0, -72.85, 196.15 + (80.0 - 52) * 0.0525],
    [84.5, -77.15, 198.28],
    [84.5, -72.85, 198.28],
    [86.4, -77.8, 198.28],
    [86.4, -72.2, 198.28],
    [91.0, -80.4, 198.28],
    [91.0, -69.6, 198.28],
    [91.0, -77.4, 198.28],
    [91.0, -72.6, 198.28],
    [95.6, -77.8, 198.28],
    [95.6, -72.2, 198.28],
  ];
  for (const [bx, bz, topY] of cauGoTrestleCols) {
    const gy = sampleGroundHeight(bx, bz);
    if (topY - gy > 1.85) {
      const botY = gy - 1.2;
      const maxTopY = topY - 0.65;
      obs.push(makeOpenCylinderCollider(0.22, Math.max(0.5, maxTopY - botY), bx, botY, bz, 6));
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
    obs.push(makeOpenWallPrism(1.66, 1.1, 0.48, b.position[0], b.position[1] - 0.1, b.position[2], b.yaw));
  }

  // 6. All ~460 Highland Pine Tree Trunks & Trail Lantern Posts (tight bark/pole-flush radii!)
  const { pines, lanterns } = getDeterministicPinesAndLanterns();
  for (const p of pines) {
    obs.push(makeOpenCylinderCollider(0.26 * p.scaleXZ, 4.2, p.x, p.y - 0.25, p.z, 7));
  }
  for (const lp of lanterns) {
    obs.push(makeOpenCylinderCollider(0.14, 2.85, lp.x, lp.y - 0.1, lp.z, 6));
  }

  // Note: Low trailside mossy fieldstones (~0.24m radius nestled in meadow grass) intentionally omit
  // vertical wall cylinders so hikers never snag on grass-hidden stones alongside trails.

  // 6c. Cầu Đất Contour Tea Hedge Rows (farmer footpath gaps + leaf-flush bounds synced 1:1 with visual!)
  let teaCount = 0;
  for (let ring = 0; ring < 14 && teaCount < 380; ring++) {
    const radius = 14 + ring * 3.7;
    const segCount = Math.floor((2 * Math.PI * radius) / 2.65);
    for (let s = 0; s < segCount && teaCount < 380; s++) {
      if ((s + ring * 2) % 7 === 0) continue;
      const angle = (s / segCount) * Math.PI * 2 + ring * 0.19;
      const hx = 36 + Math.cos(angle) * radius;
      const hz = -58 + Math.sin(angle) * radius * 0.95;
      if (distanceToTrail(hx, hz) < 4.7) continue;
      if (Math.hypot(hx - 52, hz - -75) < 15.5) continue;
      if (sampleGroundGradient(hx, hz).normalY < 0.84) continue;
      const hy = sampleGroundHeight(hx, hz);
      const gx = sampleGroundHeight(hx + 1.2, hz) - sampleGroundHeight(hx - 1.2, hz);
      const gz = sampleGroundHeight(hx, hz + 1.2) - sampleGroundHeight(hx, hz - 1.2);
      const contourYaw = Math.atan2(gx, -gz);
      obs.push(makeOpenWallPrism(2.05, 0.95, 0.76, hx, hy - 0.25, hz, contourYaw));
      teaCount++;
    }
  }

  // 7. Thung Lũng Đèn Valley Greenhouses (contour-aligned terraced parcels, synced 1:1!)
  let ghCount = 0;
  // 7a. Southern & Southeastern Valley directly below Đài Ngắm Thung Lũng Đèn
  for (let gx = -32; gx <= 260 && ghCount < 135; gx += 17.5) {
    for (let gz = 148; gz <= 378 && ghCount < 135; gz += 19.5) {
      const jx = gx + (seededHash(gx * 13 + gz * 7 + 5) - 0.5) * 6.4;
      const jz = gz + (seededHash(gx * 19 + gz * 11 + 9) - 0.5) * 6.4;
      if (jx < -36 || jx > 264 || jz < 144 || jz > 382) continue;
      if (jx >= 145 && jz <= 230) continue; // Handled by Zone B
      if (distanceToTrail(jx, jz) < 10.0) continue;
      const gy = sampleGroundHeight(jx, jz);
      if (gy > 86) continue;
      const grad = sampleGroundGradient(jx, jz);
      if (grad.normalY < 0.80) continue;
      if (seededHash(gx * 31 + gz * 17) < 0.18) continue;
      const contourYaw = grad.slopeTan > 0.04 ? Math.atan2(-grad.dhdz, grad.dhdx) : 0.14;
      const yaw = contourYaw + (seededHash(gx * 7 + gz * 23) - 0.5) * 0.26;
      const sc = 0.88 + seededHash(gx * 41 + gz * 3) * 0.36;
      const scZ = sc * (0.85 + seededHash(gx + gz) * 0.35);
      obs.push(makeOpenWallPrism(5.6 * sc, 2.8 * sc, 11.4 * scZ, jx, gy - 1.4, jz, yaw));
      ghCount++;
    }
  }
  // 7b. Eastern Thái Phiên Basin
  for (let gx = 148; gx <= 378 && ghCount < 275; gx += 16.5) {
    for (let gz = -42; gz <= 232 && ghCount < 275; gz += 19.0) {
      const jx = gx + (seededHash(gx * 13 + gz * 7) - 0.5) * 6.2;
      const jz = gz + (seededHash(gx * 19 + gz * 11) - 0.5) * 6.2;
      if (jx < 145 || jx > 380 || jz < -45 || jz > 234) continue;
      const gy = sampleGroundHeight(jx, jz);
      if (gy > 78) continue;
      const grad = sampleGroundGradient(jx, jz);
      if (grad.normalY < 0.80) continue;
      if (seededHash(gx * 31 + gz * 17) < 0.18) continue;
      const contourYaw = grad.slopeTan > 0.04 ? Math.atan2(-grad.dhdz, grad.dhdx) : 0.12;
      const yaw = contourYaw + (seededHash(gx * 7 + gz * 23) - 0.5) * 0.24;
      const sc = 0.86 + seededHash(gx * 41 + gz * 3) * 0.36;
      const scZ = sc * (0.85 + seededHash(gx + gz) * 0.35);
      obs.push(makeOpenWallPrism(5.6 * sc, 2.8 * sc, 11.4 * scZ, jx, gy - 1.4, jz, yaw));
      ghCount++;
    }
  }

  return obs;
}

/**
 * Slices the precomputed 257x257 master terrain grid into a 4x4 seamless tile grid (64x64 quads each).
 * Shared boundary vertices copy the exact precomputed position, normal, uv, color & splat weights,
 * guaranteeing zero geometric or shading seams while letting Three.js frustum-cull ~70% of terrain!
 */
function sliceTerrainIntoSeamlessTiles(
  masterGeo: THREE.BufferGeometry,
  totalSegs: number,
  tileGrid: number
): THREE.BufferGeometry[] {
  const stride = totalSegs + 1;
  const tileSegs = totalSegs / tileGrid;
  const tileVertSide = tileSegs + 1;
  const tileVertCount = tileVertSide * tileVertSide;

  const srcPos = masterGeo.getAttribute('position') as THREE.BufferAttribute;
  const srcNorm = masterGeo.getAttribute('normal') as THREE.BufferAttribute;
  const srcUv = masterGeo.getAttribute('uv') as THREE.BufferAttribute;
  const srcCol = masterGeo.getAttribute('color') as THREE.BufferAttribute;
  const srcWeights = masterGeo.getAttribute('aSurfaceWeights') as THREE.BufferAttribute;

  const tiles: THREE.BufferGeometry[] = [];
  for (let tz = 0; tz < tileGrid; tz++) {
    for (let tx = 0; tx < tileGrid; tx++) {
      const posArr = new Float32Array(tileVertCount * 3);
      const normArr = new Float32Array(tileVertCount * 3);
      const uvArr = new Float32Array(tileVertCount * 2);
      const colArr = new Float32Array(tileVertCount * 3);
      const wArr = new Float32Array(tileVertCount * 4);

      for (let lz = 0; lz <= tileSegs; lz++) {
        const gz = tz * tileSegs + lz;
        for (let lx = 0; lx <= tileSegs; lx++) {
          const gx = tx * tileSegs + lx;
          const srcIdx = gz * stride + gx;
          const dstIdx = lz * tileVertSide + lx;

          posArr[dstIdx * 3] = srcPos.getX(srcIdx);
          posArr[dstIdx * 3 + 1] = srcPos.getY(srcIdx);
          posArr[dstIdx * 3 + 2] = srcPos.getZ(srcIdx);

          normArr[dstIdx * 3] = srcNorm.getX(srcIdx);
          normArr[dstIdx * 3 + 1] = srcNorm.getY(srcIdx);
          normArr[dstIdx * 3 + 2] = srcNorm.getZ(srcIdx);

          uvArr[dstIdx * 2] = srcUv.getX(srcIdx);
          uvArr[dstIdx * 2 + 1] = srcUv.getY(srcIdx);

          colArr[dstIdx * 3] = srcCol.getX(srcIdx);
          colArr[dstIdx * 3 + 1] = srcCol.getY(srcIdx);
          colArr[dstIdx * 3 + 2] = srcCol.getZ(srcIdx);

          wArr[dstIdx * 4] = srcWeights.getX(srcIdx);
          wArr[dstIdx * 4 + 1] = srcWeights.getY(srcIdx);
          wArr[dstIdx * 4 + 2] = srcWeights.getZ(srcIdx);
          wArr[dstIdx * 4 + 3] = srcWeights.getW(srcIdx);
        }
      }

      const indexArr = new Uint16Array(tileSegs * tileSegs * 6);
      let ptr = 0;
      for (let lz = 0; lz < tileSegs; lz++) {
        for (let lx = 0; lx < tileSegs; lx++) {
          const a = lz * tileVertSide + lx;
          const b = (lz + 1) * tileVertSide + lx;
          const c = (lz + 1) * tileVertSide + (lx + 1);
          const d = lz * tileVertSide + (lx + 1);
          indexArr[ptr++] = a;
          indexArr[ptr++] = b;
          indexArr[ptr++] = d;
          indexArr[ptr++] = b;
          indexArr[ptr++] = c;
          indexArr[ptr++] = d;
        }
      }

      const tGeo = new THREE.BufferGeometry();
      tGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      tGeo.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
      tGeo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
      tGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
      tGeo.setAttribute('aSurfaceWeights', new THREE.BufferAttribute(wArr, 4));
      tGeo.setIndex(new THREE.BufferAttribute(indexArr, 1));
      tGeo.computeBoundingBox();
      tGeo.computeBoundingSphere();
      tiles.push(tGeo);
    }
  }
  return tiles;
}

interface CachedTerrainBundle {
  tileGeometries: THREE.BufferGeometry[];
  colliderMesh: THREE.Mesh;
  bvh: MeshBVH;
  obstacleMesh: THREE.Mesh;
  obstacleBvh: MeshBVH;
}

let cachedWorldTerrainBundle: CachedTerrainBundle | null = null;

function getOrBuildWorldTerrainBundle(): CachedTerrainBundle {
  if (cachedWorldTerrainBundle) return cachedWorldTerrainBundle;

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
      const stepPhase = (((wy % 1.65) + 1.65) % 1.65) / 1.65;
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

  const tileGeometries = sliceTerrainIntoSeamlessTiles(geo, TERRAIN_SEGMENTS, TERRAIN_TILE_GRID);

  // 2a. Build dedicated horizontal obstacle MeshBVH (Walls/Railings/Cabins/Props/Trees ONLY — never terrain grass!)
  const obstacleGeos = createObstacleWallAndPropColliders();
  const mergedObstacleGeo = mergeGeometries(obstacleGeos, false);
  for (const og of obstacleGeos) og.dispose();

  const builtObstacleBvh = new MeshBVH(mergedObstacleGeo, { targetLeafSize: 12 });
  (mergedObstacleGeo as unknown as { boundsTree: MeshBVH }).boundsTree = builtObstacleBvh;

  const colMat = new THREE.MeshBasicMaterial({ visible: false });
  const obsMesh = new THREE.Mesh(mergedObstacleGeo, colMat);
  obsMesh.name = 'DaLatWorldObstacleCollider';
  obsMesh.visible = false;
  obsMesh.raycast = acceleratedRaycast;
  obsMesh.updateMatrixWorld(true);

  // 2b. Build combined walkable + camera occlusion MeshBVH (Terrain + Decks + Obstacles)
  const terrainPosGeo = toPositionOnlyGeometry(geo);
  geo.dispose();
  const deckGeos = createWalkableDeckColliders();
  const mergedColliderGeo = mergeGeometries(
    [terrainPosGeo, ...deckGeos, mergedObstacleGeo],
    false
  );

  terrainPosGeo.dispose();
  for (const dg of deckGeos) dg.dispose();

  const builtBvh = new MeshBVH(mergedColliderGeo, { targetLeafSize: 12 });
  (mergedColliderGeo as unknown as { boundsTree: MeshBVH }).boundsTree = builtBvh;

  const colMesh = new THREE.Mesh(mergedColliderGeo, colMat);
  colMesh.name = 'DaLatWorldWalkableCollider';
  colMesh.visible = false;
  colMesh.raycast = acceleratedRaycast;
  colMesh.updateMatrixWorld(true);

  cachedWorldTerrainBundle = {
    tileGeometries,
    colliderMesh: colMesh,
    bvh: builtBvh,
    obstacleMesh: obsMesh,
    obstacleBvh: builtObstacleBvh,
  };
  return cachedWorldTerrainBundle;
}

// Pre-warm static terrain tiles + MeshBVH on idle while user browses Landing / Dressing screen
if (typeof window !== 'undefined') {
  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(() => {
      getOrBuildWorldTerrainBundle();
    }, { timeout: 1500 });
  } else {
    setTimeout(() => {
      getOrBuildWorldTerrainBundle();
    }, 120);
  }
}

interface TerrainShaderUniforms {
  uTime: { value: number };
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
  // Retrieve pre-warmed 4x4 frustum-culled terrain tiles + singleton MeshBVH colliders (0ms world-entry stall!)
  const { tileGeometries, colliderMesh, bvh, obstacleMesh, obstacleBvh } = useMemo(
    () => getOrBuildWorldTerrainBundle(),
    []
  );

  // Custom shader uniforms shared with MeshStandardMaterial.onBeforeCompile
  const shaderUniforms = useMemo<TerrainShaderUniforms>(
    () => ({
      uTime: { value: 0 },
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
      shader.uniforms.uTime = shaderUniforms.uTime;
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
          varying vec3 vTerrainWorldNormal;
          `
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          vSurfaceWeights = aSurfaceWeights;
          vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTerrainWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform float uTime;
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
          varying vec3 vTerrainWorldNormal;

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

          float terrainFbm(vec2 p) {
            float s = 0.0;
            s += 0.54 * terrainGrain(p);
            s += 0.30 * terrainGrain(mat2(0.8, -0.6, 0.6, 0.8) * p * 2.13 + vec2(17.3, 9.1));
            s += 0.16 * terrainGrain(mat2(-0.6, 0.8, -0.8, -0.6) * p * 4.37 + vec2(5.7, 31.4));
            return s;
          }
          `
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          float viewDist = length(vViewPosition);
          float worldUpY = clamp(normalize(vTerrainWorldNormal).y, 0.0, 1.0);

          // Organic pebble-feathered red-basalt trail mask + natural exposed soil/rock on steep banks
          float edgeNoise = terrainFbm(vTerrainWorldPos.xz * 0.92);
          float trailW = clamp(vSurfaceWeights.x + (edgeNoise - 0.5) * 0.34 * smoothstep(0.04, 0.5, vSurfaceWeights.x) * (1.0 - smoothstep(0.65, 0.96, vSurfaceWeights.x)), 0.0, 1.0);
          float pinkW = vSurfaceWeights.y;
          float teaW = vSurfaceWeights.z;
          float slopeSoilMask = smoothstep(0.16, 0.44, 1.0 - worldUpY) * (1.0 - teaW * 0.65);

          float pbrNearFade = 1.0 - smoothstep(62.0, 188.0, viewDist);
          float pbrFineFade = 1.0 - smoothstep(22.0, 68.0, viewDist);

          // Stochastic multi-scale rotated PBR ground detail (zero tiling grid out to 188m!)
          if (pbrNearFade > 0.01) {
            vec2 uvFine = vTerrainWorldPos.xz * 0.44;
            vec2 uvRotMed = (mat2(0.866, -0.5, 0.5, 0.866) * vTerrainWorldPos.xz) * 0.118 + vec2(0.37, 0.61);
            vec2 uvMacro = (mat2(0.6, 0.8, -0.8, 0.6) * vTerrainWorldPos.xz) * 0.028 + vec2(0.19, 0.83);

            vec3 forestMed = mix(texture2D(uForestDiff, uvRotMed).rgb, texture2D(uForestDiff, uvMacro).rgb, 0.38);
            vec3 forestSample = mix(forestMed, texture2D(uForestDiff, uvFine).rgb, pbrFineFade * 0.62);

            vec3 basaltMed = mix(texture2D(uBasaltDiff, uvRotMed * 1.12).rgb, texture2D(uBasaltDiff, uvMacro * 1.1).rgb, 0.34);
            vec3 basaltSample = mix(basaltMed, texture2D(uBasaltDiff, uvFine * 1.25).rgb, pbrFineFade * 0.66);

            // Natural mossy humus, fallen pine needles & clover patches across grass
            float patchVar = terrainFbm(vTerrainWorldPos.xz * 0.085);
            vec3 forestRich = mix(diffuseColor.rgb * (0.72 + 0.58 * clamp(dot(forestSample, vec3(0.333)) * 2.4, 0.68, 1.32)), forestSample * 1.14, 0.36);
            forestRich = mix(forestRich * vec3(0.88, 0.96, 0.86), forestRich * vec3(1.12, 1.06, 0.88), patchVar);
            diffuseColor.rgb = mix(diffuseColor.rgb, forestRich, (1.0 - trailW) * pbrNearFade * 0.82);

            // Steep highland embankments expose weathered laterite clay & mossy granite
            if (slopeSoilMask > 0.01) {
              vec3 bankRock = mix(basaltSample * vec3(0.76, 0.72, 0.68), vec3(0.24, 0.23, 0.22), 0.38);
              diffuseColor.rgb = mix(diffuseColor.rgb, bankRock, slopeSoilMask * pbrNearFade * 0.72);
            }

            if (trailW > 0.01) {
              // Subtle wheel/footstep rut darkening along trail shoulder + rich Da Lat red basalt clay
              float rutPattern = terrainFbm(vTerrainWorldPos.xz * 0.42);
              vec3 richTrail = mix(diffuseColor.rgb, basaltSample * (0.94 + 0.32 * rutPattern), 0.68);
              diffuseColor.rgb = mix(diffuseColor.rgb, richTrail, trailW * pbrNearFade);
            }
          }

          // Macro terrain tonal richness + real-time drifting cloud-canopy dapple shadows across the whole mountain!
          float micro = terrainFbm(vTerrainWorldPos.xz * 1.45);
          float macroMottle = terrainFbm(vTerrainWorldPos.xz * 0.032);
          float cloudShadow = smoothstep(0.34, 0.72, terrainFbm(vTerrainWorldPos.xz * 0.0105 + vec2(uTime * 0.014, -uTime * 0.007)));
          diffuseColor.rgb *= (0.91 + 0.16 * micro) * (0.92 + 0.16 * macroMottle);
          diffuseColor.rgb *= mix(vec3(0.80, 0.85, 0.93), vec3(1.06, 1.03, 0.98), cloudShadow);

          // Crisp Cầu Đất tea terrace contour soil-and-leaf stripe accent
          if (teaW > 0.01) {
            float contourWave = 0.5 + 0.5 * sin(vTerrainWorldPos.y * (6.28318 / 1.65));
            diffuseColor.rgb *= mix(1.0, 0.84 + 0.26 * contourWave, teaW * 0.78);
          }

          // Magical Cỏ Tuyết (#DCE8F2 before 05:15) -> Cỏ Hồng (#F28DB2 during 05:15-07:00 sunrise)
          if (pinkW > 0.01) {
            vec3 meadowTint = mix(uSnowGrassColor, uRosePinkColor, uPinkGrassPhase);
            meadowTint = mix(meadowTint, uDayPinkMeadowColor, uPinkDayFade);
            float frostSparkle = 0.90 + 0.18 * terrainGrain(vTerrainWorldPos.xz * 3.6);
            diffuseColor.rgb = mix(diffuseColor.rgb, meadowTint * frostSparkle, pinkW * 0.88);
          }

          // Red-Basalt clay trail darkens richly with glossy rain puddles during Highland Drizzle
          if (trailW > 0.01 && uDrizzle > 0.01) {
            float puddlePatch = smoothstep(0.42, 0.76, terrainFbm(vTerrainWorldPos.xz * 0.48));
            float wetDarken = mix(1.0, 0.52 - 0.18 * puddlePatch, trailW * uDrizzle);
            diffuseColor.rgb *= wetDarken;
          }
          `
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          #include <normal_fragment_maps>
          float nDist = length(vViewPosition);
          float nNear = 1.0 - smoothstep(38.0, 145.0, nDist);
          float nFine = 1.0 - smoothstep(18.0, 56.0, nDist);
          if (nNear > 0.01) {
            vec2 nUvFine = vTerrainWorldPos.xz * 0.44;
            vec2 nUvMed = (mat2(0.866, -0.5, 0.5, 0.866) * vTerrainWorldPos.xz) * 0.118 + vec2(0.37, 0.61);

            vec3 fNorMed = texture2D(uForestNor, nUvMed).xyz * 2.0 - 1.0;
            vec3 fNor = mix(fNorMed, texture2D(uForestNor, nUvFine).xyz * 2.0 - 1.0, nFine * 0.68);

            vec3 bNorMed = texture2D(uBasaltNor, nUvMed * 1.12).xyz * 2.0 - 1.0;
            vec3 bNor = mix(bNorMed, texture2D(uBasaltNor, nUvFine * 1.25).xyz * 2.0 - 1.0, nFine * 0.72);

            float slopeBank = smoothstep(0.16, 0.44, 1.0 - clamp(normalize(vTerrainWorldNormal).y, 0.0, 1.0));
            float rockWeight = clamp(vSurfaceWeights.x + slopeBank * 0.65, 0.0, 1.0);
            vec2 xzSlope = mix(fNor.xy * 0.68, bNor.xy * 0.96, rockWeight) * nNear;

            // Flatten pebble micro-normals inside smooth mirror puddles during drizzle
            float puddleFlat = smoothstep(0.46, 0.76, terrainFbm(vTerrainWorldPos.xz * 0.48));
            float puddleFlatten = 1.0 - vSurfaceWeights.x * uDrizzle * (0.45 + 0.45 * puddleFlat);
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
          float puddleMask = smoothstep(0.46, 0.76, terrainFbm(vTerrainWorldPos.xz * 0.48));
          float microRough = (terrainGrain(vTerrainWorldPos.xz * 2.2) - 0.5) * 0.12;
          float wetTrailSheen = vSurfaceWeights.x * uDrizzle * (0.38 + 0.46 * puddleMask);
          float morningDewSheen = vSurfaceWeights.w * (1.0 - uPinkDayFade) * 0.22;
          roughnessFactor = clamp(roughnessFactor + microRough - wetTrailSheen - morningDewSheen, 0.08, 0.96);
          `
        );
    };

    mat.customProgramCacheKey = () => 'dalat-painterly-pbr-terrain-v3';
    return mat;
  }, [shaderUniforms]);

  // Register pre-warmed MeshBVH colliders immediately on mount & dispose only per-mount material on unmount
  useEffect(() => {
    colliderMesh.updateMatrixWorld(true);
    obstacleMesh.updateMatrixWorld(true);
    worldColliderRegistry.setCollider(colliderMesh, bvh, obstacleMesh, obstacleBvh);

    return () => {
      worldColliderRegistry.clearCollider(colliderMesh);
      terrainMaterial.dispose();
    };
  }, [colliderMesh, bvh, obstacleMesh, obstacleBvh, terrainMaterial]);

  // Animate dynamic Cỏ Tuyết / Cỏ Hồng sunrise shift, cloud dapple & wet basalt drizzle sheen (zero allocations)
  useFrame(({ clock }, dt) => {
    const atmo = useGameStore.getState().atmosphere;
    const lerpRate = Math.min(1, dt * 4.0);
    const gh = atmo.gameHour;
    shaderUniforms.uTime.value = clock.getElapsedTime();

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
      <group name="DaLatSculptedTerrain">
        {tileGeometries.map((tileGeo, idx) => (
          <mesh
            key={idx}
            name={`DaLatTerrainTile_${idx}`}
            geometry={tileGeo}
            material={terrainMaterial}
            receiveShadow
          />
        ))}
      </group>
      <primitive object={colliderMesh} />
    </group>
  );
}
