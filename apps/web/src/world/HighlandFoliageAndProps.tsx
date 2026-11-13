import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'meshoptimizer';
import {
  distanceToTrail,
  fbm2D,
  sampleGroundGradient,
  sampleGroundHeight,
  SHARED_BENCHES,
  TRAIL_SEGMENTS,
} from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';
import {
  getDeterministicPinesAndLanterns,
  isInsideStiltedDeckFootprint,
  seededHash,
} from './worldScatterDeterministic';

const TARGET_TEA_HEDGE_COUNT = 380;
const TARGET_GREENHOUSE_COUNT = 275;
const FOLIAGE_SECTOR_GRID = 5; // 5x5 spatial sector bucketing for tight frustum & shadow culling

function bucketMatricesBySector(
  matrices: THREE.Matrix4[],
  gridN = FOLIAGE_SECTOR_GRID,
  minCoord = -260,
  maxCoord = 390
): THREE.Matrix4[][] {
  if (matrices.length === 0) return [];
  const buckets: THREE.Matrix4[][] = Array.from({ length: gridN * gridN }, () => []);
  const span = maxCoord - minCoord;
  for (let i = 0; i < matrices.length; i++) {
    const m = matrices[i];
    const wx = m.elements[12];
    const wz = m.elements[14];
    const gx = Math.min(gridN - 1, Math.max(0, Math.floor(((wx - minCoord) / span) * gridN)));
    const gz = Math.min(gridN - 1, Math.max(0, Math.floor(((wz - minCoord) / span) * gridN)));
    buckets[gz * gridN + gx].push(m);
  }
  return buckets.filter((b) => b.length > 0);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function colorizeGeometry(
  geo: THREE.BufferGeometry,
  hex: string,
  shadeBottomHex?: string,
  smoothNormals = false
): THREE.BufferGeometry {
  let working: THREE.BufferGeometry;
  if (smoothNormals) {
    const posOnly = new THREE.BufferGeometry();
    posOnly.setAttribute('position', (geo.getAttribute('position') as THREE.BufferAttribute).clone());
    if (geo.index) {
      posOnly.setIndex(geo.index.clone());
    }
    const welded = mergeVertices(posOnly, 1e-4);
    posOnly.dispose();
    welded.computeVertexNormals();
    working = welded.index ? welded.toNonIndexed() : welded;
    if (working !== welded) welded.dispose();
  } else {
    working = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!working.getAttribute('normal')) {
      working.computeVertexNormals();
    }
  }

  const keep = new THREE.BufferGeometry();
  const pos = working.getAttribute('position') as THREE.BufferAttribute;
  keep.setAttribute('position', pos.clone());
  keep.setAttribute('normal', (working.getAttribute('normal') as THREE.BufferAttribute).clone());

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanY = Math.max(0.001, maxY - minY);

  const topCol = new THREE.Color(hex);
  const botCol = new THREE.Color(shadeBottomHex ?? hex);
  if (!shadeBottomHex) {
    botCol.multiplyScalar(0.68);
  }

  const tmp = new THREE.Color();
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = clamp((pos.getY(i) - minY) / spanY, 0, 1);
    tmp.copy(botCol).lerp(topCol, t);
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  keep.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  working.dispose();
  return keep;
}

interface RealFoliageGlbBundle {
  pineATrunkGeo: THREE.BufferGeometry;
  pineACanopyGeo: THREE.BufferGeometry;
  pineBTrunkGeo: THREE.BufferGeometry;
  pineBCanopyGeo: THREE.BufferGeometry;
  phBenchGeo: THREE.BufferGeometry;
  phBenchMat: THREE.Material;
  phFernGeo: THREE.BufferGeometry;
  phFernMat: THREE.Material;
  phShrubGeo: THREE.BufferGeometry;
  phShrubMat: THREE.Material;
  mossRockGeo: THREE.BufferGeometry;
}

let realFoliageBundlePromise: Promise<RealFoliageGlbBundle | null> | null = null;

function dequantizeGeometryToFloat32(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const dst = new THREE.BufferGeometry();
  if (src.index) {
    dst.setIndex(src.index.clone());
  }
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const attr = src.getAttribute(name);
    if (!attr) continue;
    const itemSize = attr.itemSize;
    const arr = new Float32Array(attr.count * itemSize);
    for (let i = 0; i < attr.count; i++) {
      arr[i * itemSize] = attr.getX(i);
      if (itemSize >= 2) arr[i * itemSize + 1] = attr.getY(i);
      if (itemSize >= 3) arr[i * itemSize + 2] = attr.getZ(i);
      if (itemSize >= 4) arr[i * itemSize + 3] = attr.getW(i);
    }
    dst.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  }
  return dst;
}

function extractWorldBakedMesh(
  root: THREE.Group,
  nodePrefix: string
): { geo: THREE.BufferGeometry; mat: THREE.Material } | null {
  root.updateMatrixWorld(true);
  let found: THREE.Mesh | null = null;
  root.traverse((obj) => {
    if (!found && (obj as THREE.Mesh).isMesh && obj.name.startsWith(nodePrefix)) {
      found = obj as THREE.Mesh;
    }
  });
  if (!found) return null;
  const mesh = found as THREE.Mesh;
  const geo = dequantizeGeometryToFloat32(mesh.geometry);
  geo.applyMatrix4(mesh.matrixWorld);
  if (!geo.getAttribute('normal')) {
    geo.computeVertexNormals();
  }
  const mat = Array.isArray(mesh.material) ? mesh.material[0].clone() : mesh.material.clone();
  return { geo, mat };
}

function loadRealFoliageGlbBundle(): Promise<RealFoliageGlbBundle | null> {
  if (realFoliageBundlePromise) return realFoliageBundlePromise;

  realFoliageBundlePromise = (async () => {
    try {
      await Promise.resolve(MeshoptDecoder.ready).catch(() => {});
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);

      const [pinesGltf, benchGltf, botGltf, rocksGltf] = await Promise.all([
        loader.loadAsync('/assets/models/highland_pines.glb'),
        loader.loadAsync('/assets/models/ph_wooden_bench.glb'),
        loader.loadAsync('/assets/models/ph_botanicals.glb'),
        loader.loadAsync('/assets/models/highland_rocks_and_clouds.glb'),
      ]);

      const pAT = extractWorldBakedMesh(pinesGltf.scene, 'PineA_Trunk');
      const pAC = extractWorldBakedMesh(pinesGltf.scene, 'PineA_Canopy');
      const pBT = extractWorldBakedMesh(pinesGltf.scene, 'PineB_Trunk');
      const pBC = extractWorldBakedMesh(pinesGltf.scene, 'PineB_Canopy');
      const bench = extractWorldBakedMesh(benchGltf.scene, 'PH_WoodenBench');
      const fern = extractWorldBakedMesh(botGltf.scene, 'PH_Fern');
      const shrub = extractWorldBakedMesh(botGltf.scene, 'PH_Shrub');

      // Merge MossRockA primitives into 1 vertex-colored geometry
      rocksGltf.scene.updateMatrixWorld(true);
      const rockParts: THREE.BufferGeometry[] = [];
      rocksGltf.scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh && (obj.name.startsWith('MossRockA') || obj.parent?.name === 'MossRockA')) {
          const m = obj as THREE.Mesh;
          const g = dequantizeGeometryToFloat32(m.geometry);
          g.applyMatrix4(m.matrixWorld);
          const mName = ((Array.isArray(m.material) ? m.material[0] : m.material)?.name || '').toLowerCase();
          rockParts.push(
            colorizeGeometry(
              g,
              mName.includes('green') ? '#4A7C44' : '#6A717A',
              mName.includes('green') ? '#2B4E2B' : '#3E444D',
              true
            )
          );
          g.dispose();
        }
      });
      const mossRockGeo = rockParts.length > 0 ? mergeGeometries(rockParts, false) : new THREE.DodecahedronGeometry(0.6, 0);
      for (const rp of rockParts) rp.dispose();

      if (!pAT || !pAC || !pBT || !pBC || !bench || !fern || !shrub) {
        return null;
      }

      // Configure Poly Haven botanical alpha clip materials cleanly so instanced ferns/shrubs cast crisp foliage silhouettes
      for (const botMat of [fern.mat, shrub.mat]) {
        if (botMat instanceof THREE.MeshStandardMaterial) {
          botMat.alphaTest = 0.42;
          botMat.transparent = false;
          botMat.side = THREE.DoubleSide;
          botMat.roughness = 0.78;
          botMat.needsUpdate = true;
        }
      }

      if (bench.mat instanceof THREE.MeshStandardMaterial) {
        bench.mat.roughness = 0.82;
        bench.mat.needsUpdate = true;
      }

      const pineATrunkGeo = colorizeGeometry(pAT.geo, '#744835', '#3D251C', true);
      const pineACanopyGeo = colorizeGeometry(pAC.geo, '#4E8252', '#1D3A28', true);
      const pineBTrunkGeo = colorizeGeometry(pBT.geo, '#6C4331', '#382219', true);
      const pineBCanopyGeo = colorizeGeometry(pBC.geo, '#44764B', '#193424', true);
      pAT.geo.dispose();
      pAC.geo.dispose();
      pBT.geo.dispose();
      pBC.geo.dispose();

      return {
        pineATrunkGeo,
        pineACanopyGeo,
        pineBTrunkGeo,
        pineBCanopyGeo,
        phBenchGeo: bench.geo,
        phBenchMat: bench.mat,
        phFernGeo: fern.geo,
        phFernMat: fern.mat,
        phShrubGeo: shrub.geo,
        phShrubMat: shrub.mat,
        mossRockGeo,
      };
    } catch {
      realFoliageBundlePromise = null;
      return null;
    }
  })();

  return realFoliageBundlePromise;
}

if (typeof window !== 'undefined') {
  void loadRealFoliageGlbBundle();
}

function buildPinusKesiyaFallbackGeometries(): {
  trunkGeo: THREE.BufferGeometry;
  canopyGeo: THREE.BufferGeometry;
} {
  const lowerTrunk = new THREE.CylinderGeometry(0.16, 0.28, 5.6, 5, 2);
  lowerTrunk.translate(0, 2.8, 0);
  const trunkGeo = colorizeGeometry(lowerTrunk, '#6E4534', '#3E271E');
  lowerTrunk.dispose();

  const ico = new THREE.ConeGeometry(2.1, 7.2, 7);
  ico.translate(0, 7.2, 0);
  const canopyGeo = colorizeGeometry(ico, '#47784F', '#1E382A');
  ico.dispose();

  return { trunkGeo, canopyGeo };
}

function buildTeaHedgeGeometry(): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(2.68, 0.96, 1.32, 6, 3, 4);
  const pos = box.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const nx = x / 1.34;
    const nz = z / 0.66;
    if (y > -0.35) {
      const dome = Math.sqrt(Math.max(0.08, 1.0 - nz * nz * 0.84 - nx * nx * 0.24));
      const leafRipple =
        0.052 * Math.sin(x * 5.6 + z * 3.8) + 0.036 * Math.cos(x * 9.1 - z * 6.7);
      y = (y + 0.48) * dome - 0.48 + (y > 0 ? leafRipple : 0);
      z *= 0.86 + 0.14 * dome;
    }
    pos.setXYZ(i, x, y + 0.44, z);
  }
  const out = colorizeGeometry(box, '#64A23A', '#21421C', true);
  box.dispose();
  return out;
}

/**
 * Builds an arched, tapered botanical leaf blade with a natural midrib V-fold (double-sided).
 */
function buildBotanicalLeafBlade(width: number, length: number, arch: number): THREE.BufferGeometry {
  const plane = new THREE.PlaneGeometry(width, length, 2, 3);
  const pos = plane.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const u = (pos.getY(i) + length * 0.5) / length; // 0 (stem) -> 1 (tip)
    // Natural ovate leaf silhouette: narrow petiole -> broad belly -> pointed tip
    const profile = Math.sin(Math.pow(clamp(u, 0, 1), 0.72) * Math.PI);
    const lx = x * (0.14 + 0.86 * profile);
    const vFold = Math.abs(x / (width * 0.5 + 1e-4)) * width * 0.16 * profile;
    const droop = -arch * u * u * length;
    pos.setXYZ(i, lx, u * length * 0.86, vFold + droop);
  }
  return plane;
}

function buildDaQuyClusterGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1. Lush layered rosette of 14 arched botanical leaves + woody stems (zero rock-like Icosahedron blobs!)
  const leafCount = 14;
  for (let i = 0; i < leafCount; i++) {
    const ring = i < 8 ? 0 : 1;
    const ang = (i / (ring === 0 ? 8 : 6)) * Math.PI * 2 + ring * 0.42;
    const len = ring === 0 ? 0.52 + (i % 3) * 0.06 : 0.42 + (i % 2) * 0.06;
    const wid = ring === 0 ? 0.24 : 0.2;
    const leaf = buildBotanicalLeafBlade(wid, len, 0.34);
    leaf.rotateX(ring === 0 ? 0.78 : 0.48);
    leaf.rotateY(ang);
    leaf.translate(Math.sin(ang) * 0.08, ring === 0 ? 0.12 : 0.28, Math.cos(ang) * 0.08);
    parts.push(colorizeGeometry(leaf, ring === 0 ? '#467E3B' : '#538E43', '#1E3D1C', true));
    leaf.dispose();
  }

  const flowerOffsets: Array<[number, number, number, number]> = [
    [0.0, 0.74, 0.02, 1.05],
    [0.32, 0.62, 0.2, 0.92],
    [-0.31, 0.64, 0.16, 0.95],
    [0.04, 0.63, -0.29, 0.9],
    [-0.18, 0.56, -0.18, 0.84],
  ];

  for (const [fx, fy, fz, sc] of flowerOffsets) {
    // Slender green flower stalk
    const stalk = new THREE.CylinderGeometry(0.014, 0.022, fy, 5);
    stalk.translate(fx * 0.55, fy * 0.5, fz * 0.55);
    parts.push(colorizeGeometry(stalk, '#487E3A', '#22421F', true));
    stalk.dispose();

    // 8 golden-amber Dã Quỳ ray petals per blossom head
    const petalCount = 8;
    for (let p = 0; p < petalCount; p++) {
      const a = (p / petalCount) * Math.PI * 2 + fx;
      const petal = buildBotanicalLeafBlade(0.062 * sc, 0.175 * sc, 0.22);
      petal.rotateX(Math.PI * 0.44);
      petal.rotateY(a);
      petal.rotateX(fx * 0.32 + 0.12);
      petal.rotateZ(-fz * 0.32);
      petal.translate(fx, fy, fz);
      parts.push(colorizeGeometry(petal, '#FFC824', '#DF7B08', true));
      petal.dispose();
    }

    const disc = new THREE.IcosahedronGeometry(0.056 * sc, 1);
    disc.scale(1.0, 0.52, 1.0);
    disc.translate(fx, fy + 0.014, fz);
    parts.push(colorizeGeometry(disc, '#8F4408', '#4A2004', true));
    disc.dispose();
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

function buildHydrangeaGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1. Broad, serrated-silhouette glossy green Hydrangea leaves in 2 organic tiers (zero boulder blocks!)
  const leafCount = 14;
  for (let i = 0; i < leafCount; i++) {
    const tier = i < 8 ? 0 : 1;
    const ang = (i / (tier === 0 ? 8 : 6)) * Math.PI * 2 + tier * 0.52;
    const len = tier === 0 ? 0.46 + (i % 3) * 0.05 : 0.36 + (i % 2) * 0.05;
    const wid = tier === 0 ? 0.26 : 0.22;
    const leaf = buildBotanicalLeafBlade(wid, len, 0.3);
    leaf.rotateX(tier === 0 ? 0.84 : 0.52);
    leaf.rotateY(ang);
    leaf.translate(Math.sin(ang) * 0.09, tier === 0 ? 0.1 : 0.24, Math.cos(ang) * 0.09);
    parts.push(colorizeGeometry(leaf, tier === 0 ? '#3A6F3E' : '#48824B', '#19361E', true));
    leaf.dispose();
  }

  // 2. Plush spherical Da Lat Cẩm Tú Cầu flower heads with delicate outer florets
  const panicles: Array<[number, number, number, number, string, string]> = [
    [-0.19, 0.48, 0.13, 0.145, '#9EC0FA', '#6585CE'],
    [0.2, 0.51, 0.09, 0.152, '#C2B3FA', '#7F70C4'],
    [-0.02, 0.54, -0.15, 0.158, '#8EB2F5', '#5B7AC2'],
    [0.05, 0.44, 0.21, 0.132, '#D2E2FF', '#88A4DA'],
  ];

  const floretDirs: ReadonlyArray<[number, number, number]> = [
    [0.0, 1.0, 0.0],
    [0.72, 0.65, 0.24],
    [-0.68, 0.66, 0.31],
    [0.18, 0.68, -0.71],
    [-0.22, 0.64, 0.73],
    [0.86, 0.28, -0.42],
    [-0.84, 0.3, -0.45],
  ];

  for (const [bx, by, bz, rad, topHex, botHex] of panicles) {
    const stem = new THREE.CylinderGeometry(0.014, 0.02, by, 5);
    stem.translate(bx * 0.6, by * 0.5, bz * 0.6);
    parts.push(colorizeGeometry(stem, '#3E7240', '#1D3920', true));
    stem.dispose();

    const core = new THREE.IcosahedronGeometry(rad, 1);
    core.scale(1.06, 0.86, 1.06);
    core.translate(bx, by, bz);
    parts.push(colorizeGeometry(core, topHex, botHex, true));
    core.dispose();

    for (const [dx, dy, dz] of floretDirs) {
      const f = new THREE.IcosahedronGeometry(rad * 0.44, 0);
      f.scale(1.12, 0.62, 1.12);
      f.translate(bx + dx * rad * 0.78, by + dy * rad * 0.68, bz + dz * rad * 0.78);
      parts.push(colorizeGeometry(f, topHex, botHex, true));
      f.dispose();
    }
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

function buildPinkGrassTuftGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  const count = 6;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + (i % 2) * 0.24;
    const tilt = 0.18 + (i % 3) * 0.14;
    const h = 0.52 + (i % 4) * 0.08;
    const cone = new THREE.ConeGeometry(0.042, h, 3, 1, true);
    cone.scale(1.0, 1.0, 0.45);
    cone.translate(0, h * 0.5, 0);
    cone.rotateX(tilt);
    cone.rotateY(ang);
    blades.push(colorizeGeometry(cone, '#FFF6F8', '#B69EA8'));
    cone.dispose();
  }
  const merged = mergeGeometries(blades, false);
  for (const b of blades) b.dispose();
  return merged;
}

function buildGreenhouseGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1. Dark terraced earth/concrete foundation skirt (non-emissive dark vertex color!)
  const baseSkirt = new THREE.BoxGeometry(5.68, 2.0, 11.5);
  baseSkirt.translate(0, -0.60, 0); // spans [-1.60m, +0.40m]
  parts.push(colorizeGeometry(baseSkirt, '#2A2622', '#181512'));
  baseSkirt.dispose();

  // 2. Translucent polyethylene side walls
  const sideWalls = new THREE.BoxGeometry(5.52, 1.48, 11.34);
  sideWalls.translate(0, 1.12, 0); // spans [+0.38m, +1.86m]
  parts.push(colorizeGeometry(sideWalls, '#F2DCAB', '#BFA16E'));
  sideWalls.dispose();

  // 3. Smooth curved polyethylene arch tunnel roof
  const archRoof = new THREE.CylinderGeometry(2.79, 2.79, 11.36, 12, 1, false, 0, Math.PI);
  archRoof.rotateZ(Math.PI / 2);
  archRoof.rotateY(Math.PI / 2);
  archRoof.scale(1.0, 0.62, 1.0);
  archRoof.translate(0, 1.85, 0);
  parts.push(colorizeGeometry(archRoof, '#FFF6DC', '#DCBF88', true));
  archRoof.dispose();

  // 4. Iconic Da Lat raised ridge-vent roof cap (cửa thông gió đỉnh vòm nhà lồng)
  const ridgeVent = new THREE.BoxGeometry(1.08, 0.30, 10.7);
  ridgeVent.translate(0, 3.64, 0);
  parts.push(colorizeGeometry(ridgeVent, '#272C35', '#1B1F26'));
  ridgeVent.dispose();

  // 5. Dark galvanized steel structural arch ribs & vertical posts every ~2.25m + gable doors
  const ribZOffsets = [-5.60, -3.36, -1.12, 1.12, 3.36, 5.60];
  for (let i = 0; i < ribZOffsets.length; i++) {
    const rz = ribZOffsets[i];
    const postFrame = new THREE.BoxGeometry(5.68, 1.52, 0.26);
    postFrame.translate(0, 1.12, rz);
    parts.push(colorizeGeometry(postFrame, '#232830', '#181C22'));
    postFrame.dispose();

    const archRib = new THREE.CylinderGeometry(2.87, 2.87, 0.26, 12, 1, true, 0, Math.PI);
    archRib.rotateZ(Math.PI / 2);
    archRib.rotateY(Math.PI / 2);
    archRib.scale(1.0, 0.635, 1.0);
    archRib.translate(0, 1.85, rz);
    parts.push(colorizeGeometry(archRib, '#252B34', '#1A1E26', true));
    archRib.dispose();
  }

  // Dark agricultural double-doors on both gable ends
  const gableDoors = new THREE.BoxGeometry(1.65, 1.55, 11.46);
  gableDoors.translate(0, 1.08, 0);
  parts.push(colorizeGeometry(gableDoors, '#20242B', '#16191F'));
  gableDoors.dispose();

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

function buildCauGoTrestleBeamGeometry(): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const out = colorizeGeometry(box, '#6E4831', '#3E271A');
  box.dispose();
  return out;
}

/**
 * Generates weathered-timber trestle bents (heavy vertical columns anchored 1.25m deep into terrain +
 * multi-story horizontal ledgers + diagonal X-cross-braces + longitudinal sway braces) underneath
 * Cầu Gỗ Săn Mây (x = 63.5..95.6, z ≈ -75), preserving REG-09 walkable ramp entry (x = 47.8..52).
 */
function buildCauGoTrestleMatrices(): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = [];
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion();
  const scVec = new THREE.Vector3();
  const mat = new THREE.Matrix4();

  const pushBeamBetween = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    thickness: number
  ) => {
    pA.set(ax, ay, az);
    pB.set(bx, by, bz);
    dir.subVectors(pB, pA);
    const len = dir.length();
    if (len < 0.25) return;
    mid.addVectors(pA, pB).multiplyScalar(0.5);
    dir.divideScalar(len);
    quat.setFromUnitVectors(up, dir);
    scVec.set(thickness, len, thickness);
    mat.compose(mid, quat, scVec);
    matrices.push(mat.clone());
  };

  const bents: Array<{ bx: number; zNorth: number; zSouth: number; topY: number }> = [
    { bx: 63.5, zNorth: -77.15, zSouth: -72.85, topY: 196.15 + (63.5 - 52) * 0.0525 - 0.28 },
    { bx: 69.0, zNorth: -77.15, zSouth: -72.85, topY: 196.15 + (69.0 - 52) * 0.0525 - 0.28 },
    { bx: 74.5, zNorth: -77.15, zSouth: -72.85, topY: 196.15 + (74.5 - 52) * 0.0525 - 0.28 },
    { bx: 80.0, zNorth: -77.15, zSouth: -72.85, topY: 196.15 + (80.0 - 52) * 0.0525 - 0.28 },
    { bx: 84.5, zNorth: -77.15, zSouth: -72.85, topY: 198.0 },
    { bx: 86.4, zNorth: -77.8, zSouth: -72.2, topY: 198.0 },
    { bx: 91.0, zNorth: -80.4, zSouth: -69.6, topY: 198.0 },
    { bx: 91.0, zNorth: -77.4, zSouth: -72.6, topY: 198.0 },
    { bx: 95.6, zNorth: -77.8, zSouth: -72.2, topY: 198.0 },
  ];

  const storyStep = 6.8;
  for (let idx = 0; idx < bents.length; idx++) {
    const { bx, zNorth, zSouth, topY } = bents[idx];
    const gyN = sampleGroundHeight(bx, zNorth);
    const gyS = sampleGroundHeight(bx, zSouth);
    const botN = gyN - 1.25;
    const botS = gyS - 1.25;

    // Main vertical columns anchored deep into the eastern mountain slope
    if (topY - gyN > 1.2) {
      pushBeamBetween(bx, botN, zNorth, bx, topY, zNorth, 0.34);
    }
    if (topY - gyS > 1.2) {
      pushBeamBetween(bx, botS, zSouth, bx, topY, zSouth, 0.34);
    }

    // Top cap beam under deck stringers
    pushBeamBetween(bx, topY - 0.16, zNorth - 0.18, bx, topY - 0.16, zSouth + 0.18, 0.28);

    // Multi-tier horizontal ledger beams & diagonal X-cross-braces down to slope contact
    const minSharedClearY = Math.max(gyN, gyS) + 0.65;
    let prevY = topY - 0.25;
    for (let y = topY - storyStep; y > minSharedClearY; y -= storyStep) {
      pushBeamBetween(bx, y, zNorth, bx, y, zSouth, 0.24);
      pushBeamBetween(bx, prevY, zNorth, bx, y, zSouth, 0.16);
      pushBeamBetween(bx, prevY, zSouth, bx, y, zNorth, 0.16);
      prevY = y;
    }

    // Longitudinal sway braces between consecutive ramp/platform bents
    if (idx > 0 && idx !== 7) {
      const prev = bents[idx === 8 ? 6 : idx - 1];
      if (Math.abs(bx - prev.bx) <= 6.2) {
        const prevGyN = sampleGroundHeight(prev.bx, prev.zNorth);
        const prevGyS = sampleGroundHeight(prev.bx, prev.zSouth);
        const braceTop = Math.min(topY, prev.topY) - 0.35;
        const braceMid = braceTop - storyStep;
        if (braceMid > Math.max(gyN, prevGyN) + 0.8) {
          pushBeamBetween(prev.bx, braceMid, prev.zNorth, bx, braceMid, zNorth, 0.2);
          pushBeamBetween(prev.bx, braceTop, prev.zNorth, bx, braceMid, zNorth, 0.15);
        }
        if (braceMid > Math.max(gyS, prevGyS) + 0.8) {
          pushBeamBetween(prev.bx, braceMid, prev.zSouth, bx, braceMid, zSouth, 0.2);
          pushBeamBetween(prev.bx, braceTop, prev.zSouth, bx, braceMid, zSouth, 0.15);
        }
      }
    }
  }

  return matrices;
}

function buildLangbiangVistaGeometry(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(1900, 480, 84, 24);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);

    const depthEnv = Math.sin(clamp((lz + 240) / 480, 0, 1) * Math.PI);
    const sideEnv = 1.0 - smoothstep(640, 940, Math.abs(lx));

    const nuiBa = 448 * Math.exp(-((lx - -52) * (lx - -52)) / (165 * 165) - (lz * lz) / (145 * 145));
    const doiRaDa = 378 * Math.exp(-((lx - -238) * (lx - -238)) / (145 * 145) - ((lz - 14) * (lz - 14)) / (135 * 135));
    const westSpur = 245 * Math.exp(-((lx - -510) * (lx - -510)) / (220 * 220));
    const eastSpur = 258 * Math.exp(-((lx - 260) * (lx - 260)) / (240 * 240));

    const ridgeNoise = fbm2D(lx * 0.007, (lz - 720) * 0.007, 3) * 24 * depthEnv;
    const h = Math.max(8, (Math.max(nuiBa, doiRaDa * 0.98, westSpur, eastSpur) + ridgeNoise) * Math.pow(depthEnv, 0.52) * sideEnv);
    pos.setY(i, h);
  }
  geo.computeVertexNormals();

  const colors = new Float32Array(pos.count * 3);
  const cBase = new THREE.Color('#2B3F5E');
  const cMid = new THREE.Color('#425D82');
  const cPeak = new THREE.Color('#667EA6');
  const cTmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = clamp(y / 430, 0, 1);
    if (t < 0.5) {
      cTmp.copy(cBase).lerp(cMid, t * 2);
    } else {
      cTmp.copy(cMid).lerp(cPeak, (t - 0.5) * 2);
    }
    colors[i * 3] = cTmp.r;
    colors[i * 3 + 1] = cTmp.g;
    colors[i * 3 + 2] = cTmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function buildGacChePavilionGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.BoxGeometry(4.2, 0.5, 3.6);
  base.translate(0, 0.25, 0);
  parts.push(colorizeGeometry(base, '#6B4730', '#452D1E'));
  base.dispose();

  for (const [px, py, pz] of [
    [-1.75, 1.65, -1.45],
    [1.75, 1.65, -1.45],
    [-1.75, 1.65, 1.45],
    [1.75, 1.65, 1.45],
  ] as const) {
    const col = new THREE.BoxGeometry(0.18, 2.4, 0.18);
    col.translate(px, py, pz);
    parts.push(colorizeGeometry(col, '#6B4730', '#4A3020'));
    col.dispose();
  }

  const roof = new THREE.ConeGeometry(3.35, 1.25, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 3.15, 0);
  parts.push(colorizeGeometry(roof, '#824B36', '#543022'));
  roof.dispose();

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

function buildSharedBenchFallbackGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const seat = new THREE.BoxGeometry(2.15, 0.09, 0.56);
  seat.translate(0, 0.46, 0);
  parts.push(colorizeGeometry(seat, '#9C6640', '#6E452A'));
  seat.dispose();

  const backrest = new THREE.BoxGeometry(2.15, 0.42, 0.07);
  backrest.rotateX(-0.16);
  backrest.translate(0, 0.78, -0.24);
  parts.push(colorizeGeometry(backrest, '#A86F47', '#754A2D'));
  backrest.dispose();

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

function buildTrailLanternGeometries(): {
  postGeo: THREE.BufferGeometry;
  bulbGeo: THREE.BufferGeometry;
} {
  const postParts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.105, 0.14, 2.75, 8);
  pole.translate(0, 1.375, 0);
  postParts.push(colorizeGeometry(pole, '#6B4631', '#3E271B'));
  pole.dispose();

  const arm = new THREE.BoxGeometry(0.62, 0.11, 0.11);
  arm.translate(0.24, 2.66, 0);
  postParts.push(colorizeGeometry(arm, '#6B4631', '#4A2F20'));
  arm.dispose();

  const cap = new THREE.ConeGeometry(0.24, 0.18, 8);
  cap.translate(0.46, 2.55, 0);
  postParts.push(colorizeGeometry(cap, '#362B26', '#241C19'));
  cap.dispose();

  const postGeo = mergeGeometries(postParts, false);
  for (const p of postParts) p.dispose();

  const bulbGeo = new THREE.CylinderGeometry(0.11, 0.09, 0.24, 8);
  bulbGeo.translate(0.46, 2.38, 0);

  return { postGeo, bulbGeo };
}

function SingleSectorInstancedMesh({
  geometry,
  material,
  customDepthMaterial,
  matrices,
  castShadow = false,
  receiveShadow = false,
  shadowCullRadius = 0,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  customDepthMaterial?: THREE.Material;
  matrices: THREE.Matrix4[];
  castShadow?: boolean;
  receiveShadow?: boolean;
  shadowCullRadius?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const frameTickRef = useRef(0);

  const sectorCenter = useMemo(() => {
    if (matrices.length === 0) return { x: 0, z: 0 };
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < matrices.length; i++) {
      sx += matrices[i].elements[12];
      sz += matrices[i].elements[14];
    }
    return { x: sx / matrices.length, z: sz / matrices.length };
  }, [matrices]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [matrices, geometry]);

  useFrame(() => {
    if (!castShadow || shadowCullRadius <= 0) return;
    frameTickRef.current = (frameTickRef.current + 1) % 12;
    if (frameTickRef.current !== 0) return;
    const mesh = ref.current;
    if (!mesh) return;
    const lt = useGameStore.getState().localTransient;
    const dx = sectorCenter.x - lt.x;
    const dz = sectorCenter.z - lt.z;
    const withinShadowBox = dx * dx + dz * dz <= shadowCullRadius * shadowCullRadius;
    if (mesh.castShadow !== withinShadowBox) {
      mesh.castShadow = withinShadowBox;
    }
  });

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, matrices.length]}
      customDepthMaterial={customDepthMaterial}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      frustumCulled
    />
  );
}

function SectoredInstancedGroup({
  name,
  sectors,
  geometry,
  material,
  customDepthMaterial,
  castShadow = false,
  receiveShadow = false,
  shadowCullRadius = 0,
}: {
  name: string;
  sectors: THREE.Matrix4[][];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  customDepthMaterial?: THREE.Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
  shadowCullRadius?: number;
}) {
  return (
    <group name={name}>
      {sectors.map((list, idx) => (
        <SingleSectorInstancedMesh
          key={`${idx}-${list.length}`}
          geometry={geometry}
          material={material}
          customDepthMaterial={customDepthMaterial}
          matrices={list}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          shadowCullRadius={shadowCullRadius}
        />
      ))}
    </group>
  );
}

export function HighlandFoliageAndProps() {
  const [realBundle, setRealBundle] = useState<RealFoliageGlbBundle | null>(null);

  const stepRef = useRef<THREE.InstancedMesh>(null);
  const trestleRef = useRef<THREE.InstancedMesh>(null);
  const lanternPostRef = useRef<THREE.InstancedMesh>(null);
  const lanternBulbRef = useRef<THREE.InstancedMesh>(null);
  const benchRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    let cancelled = false;
    void loadRealFoliageGlbBundle().then((bundle) => {
      if (!cancelled && bundle) {
        setRealBundle(bundle);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const foliageUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uWindStrength: { value: 0.55 },
      uPinkPhase: { value: 0 },
      uSnowTuftColor: { value: new THREE.Color('#E3EEF7') },
      uRoseTuftColor: { value: new THREE.Color('#F592B8') },
      uSunDir: { value: new THREE.Vector3(0.85, 0.22, 0.1) },
      uSunColor: { value: new THREE.Color('#FFD29D') },
      uSunIntensity: { value: 1.4 },
    }),
    []
  );

  const assets = useMemo(() => {
    const dummy = new THREE.Object3D();

    // 1. Highland Pine Forest split into Species A & Species B (synced 1:1 with BVH trunk colliders!)
    const { trunkGeo: fallbackTrunkGeo, canopyGeo: fallbackCanopyGeo } = buildPinusKesiyaFallbackGeometries();
    const { pines: deterministicPines, lanterns: deterministicLanterns } =
      getDeterministicPinesAndLanterns();
    const pineAMatrices: THREE.Matrix4[] = [];
    const pineBMatrices: THREE.Matrix4[] = [];
    for (const p of deterministicPines) {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.tiltX, p.yaw, p.tiltZ);
      dummy.scale.set(p.scaleXZ, p.scaleY, p.scaleXZ);
      dummy.updateMatrix();
      if (p.species === 'A') {
        pineAMatrices.push(dummy.matrix.clone());
      } else {
        pineBMatrices.push(dummy.matrix.clone());
      }
    }

    // 1b. Poly Haven Botanical Ferns, Shrubs & Quaternius Mossy Rocks along pine forest edges & trails!
    const fernMatrices: THREE.Matrix4[] = [];
    const shrubMatrices: THREE.Matrix4[] = [];
    const mossRockMatrices: THREE.Matrix4[] = [];
    for (let i = 0; i < 2200 && fernMatrices.length < 160; i++) {
      const fx = (seededHash(i * 6.13 + 71) - 0.5) * 420;
      const fz = (seededHash(i * 9.47 + 19) - 0.5) * 420;
      const dTrail = distanceToTrail(fx, fz);
      if (dTrail < 3.4 || dTrail > 26) continue;
      if (isInsideStiltedDeckFootprint(fx, fz)) continue;
      if (fx >= -56 && fx <= -20 && fz >= 16 && fz <= 43) continue;
      const fy = sampleGroundHeight(fx, fz);
      if (fy < 88) continue;

      const gx = (sampleGroundHeight(fx + 0.8, fz) - sampleGroundHeight(fx - 0.8, fx * 0 + fz)) / 1.6;
      const gz = (sampleGroundHeight(fx, fz + 0.8) - sampleGroundHeight(fx, fz - 0.8)) / 1.6;
      const slopeMag = Math.hypot(gx, gz);
      if (slopeMag > 0.62) continue;

      const sc = 0.85 + seededHash(i * 14.3) * 0.75;
      dummy.position.set(fx, fy - 0.14 - slopeMag * 0.22, fz);
      dummy.rotation.set(
        Math.atan(gz) * 0.75,
        seededHash(i * 21.7) * Math.PI * 2,
        -Math.atan(gx) * 0.75
      );
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      if (i % 3 === 0 && shrubMatrices.length < 110) {
        shrubMatrices.push(dummy.matrix.clone());
      } else {
        fernMatrices.push(dummy.matrix.clone());
      }

      if (i % 5 === 0 && mossRockMatrices.length < 85 && dTrail > 4.6) {
        const rkSc = 1.1 + seededHash(i * 31.1) * 1.65;
        dummy.position.set(fx + 1.1, sampleGroundHeight(fx + 1.1, fz) - 0.12, fz);
        dummy.rotation.set(
          (seededHash(i * 3.3) - 0.5) * 0.25,
          seededHash(i * 18.9) * Math.PI * 2,
          (seededHash(i * 5.7) - 0.5) * 0.25
        );
        dummy.scale.set(rkSc * 1.15, rkSc * 0.82, rkSc);
        dummy.updateMatrix();
        mossRockMatrices.push(dummy.matrix.clone());
      }
    }

    // 2. Cầu Đất Contour Tea Rows (steep cliffs filtered where normalY < 0.84, synced with BVH!)
    const teaGeo = buildTeaHedgeGeometry();
    const teaMatrices: THREE.Matrix4[] = [];
    for (let ring = 0; ring < 14 && teaMatrices.length < TARGET_TEA_HEDGE_COUNT; ring++) {
      const radius = 14 + ring * 3.7;
      const circumference = 2 * Math.PI * radius;
      const segCount = Math.floor(circumference / 2.65);

      for (let s = 0; s < segCount && teaMatrices.length < TARGET_TEA_HEDGE_COUNT; s++) {
        // Leave natural farmer footpath openings across contour rings (matches BVH obstacle gaps 1:1!)
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

        dummy.position.set(hx, hy - 0.14, hz);
        dummy.rotation.set(0, contourYaw, 0);
        dummy.scale.set(1.02, 0.92 + seededHash(ring * 100 + s) * 0.22, 1.0);
        dummy.updateMatrix();
        teaMatrices.push(dummy.matrix.clone());
      }
    }

    // 3. Seasonal Highland Wildflowers
    const daQuyGeo = buildDaQuyClusterGeometry();
    const daQuyMatrices: THREE.Matrix4[] = [];
    for (let i = 0; i < 1600 && daQuyMatrices.length < 185; i++) {
      const tAlong = seededHash(i * 5.1 + 101);
      const baseX = 18 - tAlong * 69 + (seededHash(i * 7.7 + 202) - 0.5) * 32;
      const baseZ = 128 - tAlong * 100 + (seededHash(i * 9.3 + 303) - 0.5) * 32;
      const dTrail = distanceToTrail(baseX, baseZ);
      if (dTrail < 3.6 || dTrail > 14.5) continue;
      if (baseX > 20.5 && baseZ > 116) continue;
      if (baseX >= -55 && baseX <= -22 && baseZ >= 18 && baseZ <= 42) continue;

      const by = sampleGroundHeight(baseX, baseZ);
      const dgx = (sampleGroundHeight(baseX + 0.8, baseZ) - sampleGroundHeight(baseX - 0.8, baseZ)) / 1.6;
      const dgz = (sampleGroundHeight(baseX, baseZ + 0.8) - sampleGroundHeight(baseX, baseZ - 0.8)) / 1.6;
      const dSlope = Math.hypot(dgx, dgz);
      if (dSlope > 0.58) continue;
      const sc = 0.78 + seededHash(i * 13.1) * 0.62;
      dummy.position.set(baseX, by - 0.12 - dSlope * 0.16, baseZ);
      dummy.rotation.set(Math.atan(dgz) * 0.68, seededHash(i * 17.9) * Math.PI * 2, -Math.atan(dgx) * 0.68);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      daQuyMatrices.push(dummy.matrix.clone());
    }

    const hydrangeaGeo = buildHydrangeaGeometry();
    const hydrangeaMatrices: THREE.Matrix4[] = [];
    for (let i = 0; i < 1400 && hydrangeaMatrices.length < 175; i++) {
      const nearCafe = i % 2 === 0;
      const hx = nearCafe
        ? -42 + (seededHash(i * 4.3 + 11) - 0.5) * 44
        : -21 + (seededHash(i * 4.3 + 11) - 0.5) * 28;
      const hz = nearCafe
        ? 30 + (seededHash(i * 6.7 + 29) - 0.5) * 38
        : -181 + (seededHash(i * 6.7 + 29) - 0.5) * 26;

      if (distanceToTrail(hx, hz) < 3.5) continue;
      if (hx >= -56 && hx <= -22 && hz >= 18 && hz <= 42) continue;
      if (Math.hypot(hx - -53, hz - 24) < 5.5) continue;
      if (Math.hypot(hx - -21, hz - -181) < 4.4) continue;

      const hy = sampleGroundHeight(hx, hz);
      const hgx = (sampleGroundHeight(hx + 0.8, hz) - sampleGroundHeight(hx - 0.8, hz)) / 1.6;
      const hgz = (sampleGroundHeight(hx, hz + 0.8) - sampleGroundHeight(hx, hz - 0.8)) / 1.6;
      const hSlope = Math.hypot(hgx, hgz);
      if (hSlope > 0.55) continue;
      const sc = 0.78 + seededHash(i * 15.3) * 0.52;
      dummy.position.set(hx, hy - 0.11 - hSlope * 0.15, hz);
      dummy.rotation.set(Math.atan(hgz) * 0.68, seededHash(i * 19.7) * Math.PI * 2, -Math.atan(hgx) * 0.68);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      hydrangeaMatrices.push(dummy.matrix.clone());
    }

    const pinkTuftGeo = buildPinkGrassTuftGeometry();
    const pinkTuftMatrices: THREE.Matrix4[] = [];
    for (let i = 0; i < 1200 && pinkTuftMatrices.length < 320; i++) {
      const r = Math.sqrt(seededHash(i * 3.7 + 55)) * 36;
      const ang = seededHash(i * 8.1 + 77) * Math.PI * 2;
      const px = -12 + Math.cos(ang) * r * 1.05;
      const pz = -175 + Math.sin(ang) * r * 0.92;
      if (distanceToTrail(px, pz) < 3.4) continue;
      if (Math.hypot(px - -21, pz - -181) < 5.0) continue;

      const py = sampleGroundHeight(px, pz);
      const sc = 0.75 + seededHash(i * 12.9) * 0.65;
      dummy.position.set(px, py - 0.04, pz);
      dummy.rotation.set(0, seededHash(i * 21.3) * Math.PI * 2, 0);
      dummy.scale.set(sc, sc * (0.85 + seededHash(i * 5.5) * 0.4), sc);
      dummy.updateMatrix();
      pinkTuftMatrices.push(dummy.matrix.clone());
    }

    // 4. Grounded Thung Lũng Đèn Greenhouses (contour-aligned terraced parcels, synced 1:1 with BVH!)
    const greenhouseGeo = buildGreenhouseGeometry();
    const greenhouseMatrices: THREE.Matrix4[] = [];
    // 4a. Southern & Southeastern Valley directly below Đài Ngắm Thung Lũng Đèn (x in [-32, 260], z in [148, 378])
    for (let gx = -32; gx <= 260 && greenhouseMatrices.length < 135; gx += 17.5) {
      for (let gz = 148; gz <= 378 && greenhouseMatrices.length < 135; gz += 19.5) {
        const jx = gx + (seededHash(gx * 13 + gz * 7 + 5) - 0.5) * 6.4;
        const jz = gz + (seededHash(gx * 19 + gz * 11 + 9) - 0.5) * 6.4;
        if (jx < -36 || jx > 264 || jz < 144 || jz > 382) continue;
        if (jx >= 145 && jz <= 230) continue;
        if (distanceToTrail(jx, jz) < 10.0) continue;

        const gy = sampleGroundHeight(jx, jz);
        if (gy > 86) continue;
        const grad = sampleGroundGradient(jx, jz);
        if (grad.normalY < 0.80) continue;
        if (seededHash(gx * 31 + gz * 17) < 0.18) continue;

        const contourYaw = grad.slopeTan > 0.04 ? Math.atan2(-grad.dhdz, grad.dhdx) : 0.14;
        const yaw = contourYaw + (seededHash(gx * 7 + gz * 23) - 0.5) * 0.26;
        const sc = 0.88 + seededHash(gx * 41 + gz * 3) * 0.36;
        dummy.position.set(jx, gy - 0.08, jz);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(sc, sc * 0.95, sc * (0.85 + seededHash(gx + gz) * 0.35));
        dummy.updateMatrix();
        greenhouseMatrices.push(dummy.matrix.clone());
      }
    }
    // 4b. Eastern Thái Phiên Basin (unobstructed az=-35°..+25° amphitheater from Đài Ngắm Thung Lũng Đèn)
    for (let gx = 148; gx <= 378 && greenhouseMatrices.length < TARGET_GREENHOUSE_COUNT; gx += 16.5) {
      for (let gz = -42; gz <= 232 && greenhouseMatrices.length < TARGET_GREENHOUSE_COUNT; gz += 19.0) {
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
        dummy.position.set(jx, gy - 0.08, jz);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(sc, sc * 0.95, sc * (0.85 + seededHash(gx + gz) * 0.35));
        dummy.updateMatrix();
        greenhouseMatrices.push(dummy.matrix.clone());
      }
    }

    // 5. Trail Timber Steps (+0.36m buried side-skirt so cross-slope sleepers never float, top face flush!)
    const stepBox = new THREE.BoxGeometry(2.6, 0.44, 0.44);
    stepBox.translate(0, -0.18, 0); // top face at +0.04m (sy + 0.012m), bottom skirt buried at -0.40m
    const stepGeo = colorizeGeometry(stepBox, '#7D5338', '#442A1B');
    stepBox.dispose();

    const stepMatrices: THREE.Matrix4[] = [];
    const lanternMatrices: THREE.Matrix4[] = [];

    for (let segIdx = 0; segIdx < TRAIL_SEGMENTS.length; segIdx++) {
      const [ax, az, bx, bz] = TRAIL_SEGMENTS[segIdx];
      const segLen = Math.hypot(bx - ax, bz - az);
      const dirX = (bx - ax) / segLen;
      const dirZ = (bz - az) / segLen;
      const trailYaw = Math.atan2(dirX, dirZ);

      const numChecks = Math.floor(segLen / 1.85);
      for (let k = 1; k < numChecks; k++) {
        const t = k / numChecks;
        const sx = ax + (bx - ax) * t;
        const sz = az + (bz - az) * t;
        if (isInsideStiltedDeckFootprint(sx, sz)) continue;
        const y0 = sampleGroundHeight(sx - dirX * 0.9, sz - dirZ * 0.9);
        const y1 = sampleGroundHeight(sx + dirX * 0.9, sz + dirZ * 0.9);
        const slope = Math.abs(y1 - y0) / 1.8;
        if (slope > 0.115) {
          const sy = sampleGroundHeight(sx, sz);
          dummy.position.set(sx, sy - 0.028, sz);
          dummy.rotation.set(0, trailYaw, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          stepMatrices.push(dummy.matrix.clone());
        }
      }
    }

    for (const lp of deterministicLanterns) {
      dummy.position.set(lp.x, lp.y, lp.z);
      dummy.rotation.set(0, lp.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      lanternMatrices.push(dummy.matrix.clone());
    }

    const { postGeo, bulbGeo } = buildTrailLanternGeometries();

    // 5b. Grounded Cầu Gỗ Săn Mây Timber Trestle Viaduct (columns + ledgers + X-braces down into eastern slope)
    const trestleGeo = buildCauGoTrestleBeamGeometry();
    const trestleMatrices = buildCauGoTrestleMatrices();

    // 6. Shared Wooden Benches (Poly Haven painted_wooden_bench at exact SHARED_BENCHES coordinates)
    const fallbackBenchGeo = buildSharedBenchFallbackGeometry();
    const benchMatrices: THREE.Matrix4[] = SHARED_BENCHES.map((b) => {
      dummy.position.set(b.position[0], b.position[1], b.position[2]);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });

    const rawFallbackRock = new THREE.DodecahedronGeometry(0.24, 0);
    const fallbackMossRockGeo = colorizeGeometry(rawFallbackRock, '#5B6E54', '#364035');
    rawFallbackRock.dispose();
    const langbiangGeo = buildLangbiangVistaGeometry();
    const gacCheGeo = buildGacChePavilionGeometry();

    return {
      fallbackTrunkGeo,
      fallbackCanopyGeo,
      fallbackMossRockGeo,
      pineASectors: bucketMatricesBySector(pineAMatrices),
      pineBSectors: bucketMatricesBySector(pineBMatrices),
      fernSectors: bucketMatricesBySector(fernMatrices),
      shrubSectors: bucketMatricesBySector(shrubMatrices),
      mossRockSectors: bucketMatricesBySector(mossRockMatrices),
      teaGeo,
      teaSectors: bucketMatricesBySector(teaMatrices),
      daQuyGeo,
      daQuySectors: bucketMatricesBySector(daQuyMatrices),
      hydrangeaGeo,
      hydrangeaSectors: bucketMatricesBySector(hydrangeaMatrices),
      pinkTuftGeo,
      pinkTuftSectors: bucketMatricesBySector(pinkTuftMatrices),
      greenhouseGeo,
      greenhouseSectors: bucketMatricesBySector(greenhouseMatrices),
      stepGeo,
      stepMatrices,
      trestleGeo,
      trestleMatrices,
      postGeo,
      bulbGeo,
      lanternMatrices,
      fallbackBenchGeo,
      benchMatrices,
      langbiangGeo,
      gacCheGeo,
    };
  }, []);

  const materials = useMemo(() => {
    const injectPineWind = (mat: THREE.Material, swayAmp: number, cacheKey: string) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = foliageUniforms.uTime;
        shader.uniforms.uWindStrength = foliageUniforms.uWindStrength;
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            /* glsl */ `
            #include <common>
            uniform float uTime;
            uniform float uWindStrength;
            `
          )
          .replace(
            '#include <begin_vertex>',
            /* glsl */ `
            #include <begin_vertex>
            #ifdef USE_INSTANCING
              vec3 instOrigin = instanceMatrix[3].xyz;
            #else
              vec3 instOrigin = vec3(0.0);
            #endif
            float hFactor = clamp(transformed.y / 11.2, 0.0, 1.25);
            float bendWeight = hFactor * hFactor;
            float gustPhase = uTime * (1.25 + uWindStrength * 0.85) + instOrigin.x * 0.07 + instOrigin.z * 0.05;
            float swayX = sin(gustPhase) * ${swayAmp.toFixed(3)} * uWindStrength * bendWeight;
            float swayZ = cos(gustPhase * 0.83 + 1.1) * ${(swayAmp * 0.65).toFixed(3)} * uWindStrength * bendWeight;
            transformed.x += swayX;
            transformed.z += swayZ;
            `
          );
      };
      mat.customProgramCacheKey = () => cacheKey;
    };

    const pineTrunkMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
    });
    pineTrunkMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = foliageUniforms.uTime;
      shader.uniforms.uWindStrength = foliageUniforms.uWindStrength;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform float uTime;
          uniform float uWindStrength;
          varying vec3 vBarkLocal;
          `
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          vBarkLocal = position;
          #ifdef USE_INSTANCING
            vec3 instOrigin = instanceMatrix[3].xyz;
          #else
            vec3 instOrigin = vec3(0.0);
          #endif
          float hFactor = clamp(transformed.y / 11.2, 0.0, 1.25);
          float bendWeight = hFactor * hFactor;
          float gustPhase = uTime * (1.25 + uWindStrength * 0.85) + instOrigin.x * 0.07 + instOrigin.z * 0.05;
          transformed.x += sin(gustPhase) * 0.220 * uWindStrength * bendWeight;
          transformed.z += cos(gustPhase * 0.83 + 1.1) * 0.143 * uWindStrength * bendWeight;
          `
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying vec3 vBarkLocal;
          float barkHash(vec2 p) {
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
          // Pinus kesiya scaly vertical bark fissures + mossy root base
          float ang = atan(vBarkLocal.z, vBarkLocal.x);
          float fissure = barkHash(vec2(ang * 4.5, vBarkLocal.y * 2.8)) * 0.65
                        + barkHash(vec2(ang * 11.0, vBarkLocal.y * 7.5)) * 0.35;
          float plate = smoothstep(0.32, 0.74, fissure);
          diffuseColor.rgb *= mix(0.62, 1.18, plate);
          float baseMoss = 1.0 - smoothstep(0.15, 1.45, vBarkLocal.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.14, 0.24, 0.13), baseMoss * 0.42 * fissure);
          `
        );
    };
    pineTrunkMat.customProgramCacheKey = () => 'dalat-pine-trunk-bark-v3';

    const pineTrunkDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    });
    injectPineWind(pineTrunkDepthMat, 0.22, 'dalat-pine-trunk-depth-wind-v2');

    const pineCanopyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.02,
    });
    pineCanopyMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = foliageUniforms.uTime;
      shader.uniforms.uWindStrength = foliageUniforms.uWindStrength;
      shader.uniforms.uSunDir = foliageUniforms.uSunDir;
      shader.uniforms.uSunColor = foliageUniforms.uSunColor;
      shader.uniforms.uSunIntensity = foliageUniforms.uSunIntensity;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform float uTime;
          uniform float uWindStrength;
          varying vec3 vCanopyWorldPos;
          `
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 instOrigin = instanceMatrix[3].xyz;
            mat4 mWorld = modelMatrix * instanceMatrix;
          #else
            vec3 instOrigin = vec3(0.0);
            mat4 mWorld = modelMatrix;
          #endif
          float hFactor = clamp(transformed.y / 11.2, 0.0, 1.25);
          float bendWeight = hFactor * hFactor;
          float gustPhase = uTime * (1.25 + uWindStrength * 0.85) + instOrigin.x * 0.07 + instOrigin.z * 0.05;
          float flutter = sin(uTime * 4.2 + transformed.x * 3.1 + transformed.z * 2.7) * 0.032 * uWindStrength;
          transformed.x += sin(gustPhase) * 0.440 * uWindStrength * bendWeight + flutter;
          transformed.z += cos(gustPhase * 0.83 + 1.1) * 0.286 * uWindStrength * bendWeight;
          vCanopyWorldPos = (mWorld * vec4(transformed, 1.0)).xyz;
          `
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform float uSunIntensity;
          varying vec3 vCanopyWorldPos;
          float needleGrain(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float n = dot(i, vec3(17.1, 59.4, 113.7));
            return mix(
              mix(fract(sin(n) * 43758.5), fract(sin(n + 17.1) * 43758.5), f.x),
              mix(fract(sin(n + 59.4) * 43758.5), fract(sin(n + 76.5) * 43758.5), f.x),
              f.z
            );
          }
          `
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          float tuft = needleGrain(vCanopyWorldPos * 2.3) * 0.65 + needleGrain(vCanopyWorldPos * 6.4) * 0.35;
          diffuseColor.rgb *= (0.82 + 0.34 * tuft);
          `
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `
          #include <emissivemap_fragment>
          // Golden backlit pine-needle subsurface translucency at sunrise!
          vec3 viewRay = normalize(cameraPosition - vCanopyWorldPos);
          float backScatter = pow(clamp(dot(-viewRay, normalize(uSunDir)), 0.0, 1.0), 3.2);
          totalEmissiveRadiance += diffuseColor.rgb * uSunColor * backScatter * uSunIntensity * 0.48;
          `
        );
    };
    pineCanopyMat.customProgramCacheKey = () => 'dalat-pine-canopy-sss-v3';

    const pineCanopyDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    });
    injectPineWind(pineCanopyDepthMat, 0.44, 'dalat-pine-canopy-depth-wind-v2');

    const teaMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.03,
    });
    teaMat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDir = foliageUniforms.uSunDir;
      shader.uniforms.uSunColor = foliageUniforms.uSunColor;
      shader.uniforms.uSunIntensity = foliageUniforms.uSunIntensity;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying vec3 vTeaWorldPos;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>\n#ifdef USE_INSTANCING\nvTeaWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvTeaWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform float uSunIntensity;
          varying vec3 vTeaWorldPos;
          float teaLeafNoise(vec2 p) {
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
          float leafTex = teaLeafNoise(vTeaWorldPos.xz * 7.5) * 0.6 + teaLeafNoise(vTeaWorldPos.xz * 18.0) * 0.4;
          diffuseColor.rgb *= (0.82 + 0.36 * leafTex);
          `
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `
          #include <emissivemap_fragment>
          vec3 vRay = normalize(cameraPosition - vTeaWorldPos);
          float sss = pow(clamp(dot(-vRay, normalize(uSunDir)), 0.0, 1.0), 2.8);
          totalEmissiveRadiance += diffuseColor.rgb * uSunColor * sss * uSunIntensity * 0.38;
          `
        );
    };
    teaMat.customProgramCacheKey = () => 'dalat-tea-hedge-sss-v2';

    const wildflowerMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.68,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    wildflowerMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = foliageUniforms.uTime;
      shader.uniforms.uWindStrength = foliageUniforms.uWindStrength;
      shader.uniforms.uSunDir = foliageUniforms.uSunDir;
      shader.uniforms.uSunColor = foliageUniforms.uSunColor;
      shader.uniforms.uSunIntensity = foliageUniforms.uSunIntensity;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nuniform float uTime;\nuniform float uWindStrength;\nvarying vec3 vFlowerWorldPos;`
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 fOrigin = instanceMatrix[3].xyz;
            mat4 fWorld = modelMatrix * instanceMatrix;
          #else
            vec3 fOrigin = vec3(0.0);
            mat4 fWorld = modelMatrix;
          #endif
          float stemFlex = clamp(transformed.y / 0.72, 0.0, 1.1);
          float breeze = sin(uTime * 2.3 + fOrigin.x * 0.31 + fOrigin.z * 0.27) * 0.055 * uWindStrength * stemFlex * stemFlex;
          transformed.x -= breeze;
          transformed.z += breeze * 0.45;
          vFlowerWorldPos = (fWorld * vec4(transformed, 1.0)).xyz;
          `
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;\nuniform float uSunIntensity;\nvarying vec3 vFlowerWorldPos;`
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `
          #include <emissivemap_fragment>
          vec3 vRay = normalize(cameraPosition - vFlowerWorldPos);
          float petalSss = pow(clamp(dot(-vRay, normalize(uSunDir)), 0.0, 1.0), 2.4);
          totalEmissiveRadiance += diffuseColor.rgb * uSunColor * petalSss * uSunIntensity * 0.34;
          `
        );
    };
    wildflowerMat.customProgramCacheKey = () => 'dalat-wildflower-sss-v2';

    const pinkTuftMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.68,
      metalness: 0.02,
    });
    pinkTuftMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = foliageUniforms.uTime;
      shader.uniforms.uWindStrength = foliageUniforms.uWindStrength;
      shader.uniforms.uPinkPhase = foliageUniforms.uPinkPhase;
      shader.uniforms.uSnowTuftColor = foliageUniforms.uSnowTuftColor;
      shader.uniforms.uRoseTuftColor = foliageUniforms.uRoseTuftColor;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform float uTime;
          uniform float uWindStrength;
          `
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 tuftOrigin = instanceMatrix[3].xyz;
          #else
            vec3 tuftOrigin = vec3(0.0);
          #endif
          float bladeTip = clamp(transformed.y / 0.68, 0.0, 1.0);
          float breeze = sin(uTime * 2.1 + tuftOrigin.x * 0.25 + tuftOrigin.z * 0.25) * 0.09 * uWindStrength;
          transformed.x -= breeze * bladeTip * bladeTip;
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform float uPinkPhase;
          uniform vec3 uSnowTuftColor;
          uniform vec3 uRoseTuftColor;
          `
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          diffuseColor.rgb *= mix(uSnowTuftColor, uRoseTuftColor, uPinkPhase);
          `
        );
    };
    pinkTuftMat.customProgramCacheKey = () => 'dalat-pink-grass-tuft-v1';

    const greenhouseMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.04,
      fog: true,
      emissive: new THREE.Color('#FFFFFF'),
      emissiveIntensity: 1.25,
    });
    greenhouseMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vGhLocalPos;
          varying float vGhSeed;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vGhLocalPos = position;
          #ifdef USE_INSTANCING
          vec2 ghOriginXZ = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
          #else
          vec2 ghOriginXZ = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
          #endif
          vGhSeed = fract(sin(dot(floor(ghOriginXZ * 0.5), vec2(12.9898, 78.233))) * 43758.5453);`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vGhLocalPos;
          varying float vGhSeed;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float ghPanelLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          float ghPlasticMask = smoothstep(0.06, 0.28, ghPanelLum);
          float ghNightMix = clamp(emissive.r, 0.0, 1.0);
          // Unlit greenhouses (~24%) show cool moonlit plastic sheeting at night while daytime stays natural milky-cream
          if (vGhSeed < 0.24) {
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.54, 0.62, 0.76), ghNightMix * ghPlasticMask);
          } else {
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.75, 0.70, 0.64), ghNightMix * ghPlasticMask);
          }`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // Keep dark steel arch ribs, ridge vent, doors & soil skirt non-emissive for crisp greenhouse structure!
          float parcelLit = step(0.24, vGhSeed);
          float parcelDim = 0.50 + 0.55 * fract(vGhSeed * 13.7);
          // Warm 2,400K sodium-gold to 3,100K warm-white chrysanthemum night-break bulbs
          vec3 bulbTemp = mix(vec3(1.0, 0.52, 0.14), vec3(1.0, 0.78, 0.40), fract(vGhSeed * 7.3));
          // Interior hanging agricultural bulb rows + anti-aliased steel hoop & eave purlin silhouettes
          float bulbRows = 0.62 + 0.38 * (0.5 + 0.5 * cos(vGhLocalPos.z * 2.65)) * (0.55 + 0.45 * cos(vGhLocalPos.x * 1.65));
          float hoopWave = abs(sin(vGhLocalPos.z * 1.3962634));
          float hoopFw = max(0.04, fwidth(vGhLocalPos.z) * 1.35);
          float hoopRibShadow = mix(0.38, 1.0, smoothstep(0.045, 0.045 + hoopFw, hoopWave));
          float eaveSeam = mix(0.45, 1.0, smoothstep(0.05, 0.20, abs(vGhLocalPos.y - 1.85)));
          float domeGlow = smoothstep(0.30, 2.35, vGhLocalPos.y) * 0.62 + 0.38;
          totalEmissiveRadiance = bulbTemp * emissive.r * ghPlasticMask * parcelLit * parcelDim * bulbRows * hoopRibShadow * eaveSeam * domeGlow;`
        );
    };
    greenhouseMat.customProgramCacheKey = () => 'dalat-thai-phien-greenhouse-v3';

    const woodPropMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.03,
    });
    woodPropMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWoodWorldPos;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>\n#ifdef USE_INSTANCING\nvWoodWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvWoodWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying vec3 vWoodWorldPos;
          float woodGrainHash(vec2 p) {
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
          // 3D weathered highland cedar wood-grain fibers & plank variation
          float fiber = woodGrainHash(vec2(vWoodWorldPos.x * 16.0 + vWoodWorldPos.z * 16.0, vWoodWorldPos.y * 2.4)) * 0.65
                      + woodGrainHash(vec2(vWoodWorldPos.x * 38.0 - vWoodWorldPos.z * 34.0, vWoodWorldPos.y * 5.8)) * 0.35;
          float rings = 0.5 + 0.5 * sin((vWoodWorldPos.x + vWoodWorldPos.z) * 19.0 + fiber * 4.2);
          diffuseColor.rgb *= mix(0.78, 1.14, rings * 0.55 + fiber * 0.45);
          `
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `
          #include <roughnessmap_fragment>
          float wGrain = woodGrainHash(vec2(vWoodWorldPos.x * 22.0 + vWoodWorldPos.z * 22.0, vWoodWorldPos.y * 3.5));
          roughnessFactor = clamp(roughnessFactor + (wGrain - 0.5) * 0.16, 0.54, 0.96);
          `
        );
    };
    woodPropMat.customProgramCacheKey = () => 'dalat-weathered-cedar-wood-v2';

    const lanternBulbMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#FFF2D6'),
      emissive: new THREE.Color('#FFA94D'),
      emissiveIntensity: 2.2,
      roughness: 0.25,
      metalness: 0.0,
    });

    const langbiangMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
      fog: false,
      emissive: new THREE.Color('#384B6E'),
      emissiveIntensity: 0.38,
    });

    return {
      pineTrunkMat,
      pineTrunkDepthMat,
      pineCanopyMat,
      pineCanopyDepthMat,
      teaMat,
      wildflowerMat,
      pinkTuftMat,
      greenhouseMat,
      woodPropMat,
      lanternBulbMat,
      langbiangMat,
    };
  }, [foliageUniforms]);

  // Apply non-sectored prop instance matrices whenever base assets or async real GLB bundle resolves
  useEffect(() => {
    const applyMatrices = (mesh: THREE.InstancedMesh | null, list: THREE.Matrix4[]) => {
      if (!mesh) return;
      for (let i = 0; i < list.length; i++) {
        mesh.setMatrixAt(i, list[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    };

    applyMatrices(stepRef.current, assets.stepMatrices);
    applyMatrices(trestleRef.current, assets.trestleMatrices);
    applyMatrices(lanternPostRef.current, assets.lanternMatrices);
    applyMatrices(lanternBulbRef.current, assets.lanternMatrices);
    applyMatrices(benchRef.current, assets.benchMatrices);
  }, [assets, realBundle]);

  useEffect(() => {
    return () => {
      assets.fallbackTrunkGeo.dispose();
      assets.fallbackCanopyGeo.dispose();
      assets.fallbackMossRockGeo.dispose();
      assets.teaGeo.dispose();
      assets.daQuyGeo.dispose();
      assets.hydrangeaGeo.dispose();
      assets.pinkTuftGeo.dispose();
      assets.greenhouseGeo.dispose();
      assets.stepGeo.dispose();
      assets.trestleGeo.dispose();
      assets.postGeo.dispose();
      assets.bulbGeo.dispose();
      assets.fallbackBenchGeo.dispose();
      assets.langbiangGeo.dispose();
      assets.gacCheGeo.dispose();

      materials.pineTrunkMat.dispose();
      materials.pineTrunkDepthMat.dispose();
      materials.pineCanopyMat.dispose();
      materials.pineCanopyDepthMat.dispose();
      materials.teaMat.dispose();
      materials.wildflowerMat.dispose();
      materials.pinkTuftMat.dispose();
      materials.greenhouseMat.dispose();
      materials.woodPropMat.dispose();
      materials.lanternBulbMat.dispose();
      materials.langbiangMat.dispose();
    };
  }, [assets, materials]);

  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime();
    const atmo = useGameStore.getState().atmosphere;
    const lerpRate = Math.min(1, dt * 4.0);

    foliageUniforms.uTime.value = t;
    foliageUniforms.uWindStrength.value +=
      (atmo.windStrength - foliageUniforms.uWindStrength.value) * lerpRate;
    foliageUniforms.uSunDir.value
      .set(atmo.sunDirection[0], atmo.sunDirection[1], atmo.sunDirection[2])
      .normalize();
    foliageUniforms.uSunColor.value.set(atmo.sunLightHex);
    foliageUniforms.uSunIntensity.value = atmo.sunIntensity;

    const gh = atmo.gameHour;
    const targetPink = gh >= 5.15 && gh <= 18.2 ? smoothstep(5.12, 5.48, gh) : 0.0;
    foliageUniforms.uPinkPhase.value +=
      (targetPink - foliageUniforms.uPinkPhase.value) * lerpRate;

    // Warm 2700K Thái Phiên flower greenhouse interior bulb glow during pre-dawn, night & evening (rich amber, never blown-out white!)
    const targetGhEmissive = atmo.greenhouseGlow * 2.95;
    materials.greenhouseMat.emissiveIntensity +=
      (targetGhEmissive - materials.greenhouseMat.emissiveIntensity) * lerpRate;

    materials.langbiangMat.emissive.set(atmo.fogHex).multiplyScalar(0.55);

    const lanternFactor =
      gh < 5.45
        ? 1.0
        : gh < 6.25
          ? 1.0 - smoothstep(5.45, 6.25, gh) * 0.92
          : gh > 17.65
            ? 1.0
            : gh > 16.95
              ? 0.08 + smoothstep(16.95, 17.65, gh) * 0.92
              : 0.08;
    const targetLanternEmissive = lanternFactor * 2.9;
    materials.lanternBulbMat.emissiveIntensity +=
      (targetLanternEmissive - materials.lanternBulbMat.emissiveIntensity) * lerpRate;
  });

  const gacCheY = useMemo(() => sampleGroundHeight(-21, -181), []);

  const pineATrunkGeo = realBundle ? realBundle.pineATrunkGeo : assets.fallbackTrunkGeo;
  const pineACanopyGeo = realBundle ? realBundle.pineACanopyGeo : assets.fallbackCanopyGeo;
  const pineBTrunkGeo = realBundle ? realBundle.pineBTrunkGeo : assets.fallbackTrunkGeo;
  const pineBCanopyGeo = realBundle ? realBundle.pineBCanopyGeo : assets.fallbackCanopyGeo;
  const benchGeo = realBundle ? realBundle.phBenchGeo : assets.fallbackBenchGeo;
  const benchMat = realBundle ? realBundle.phBenchMat : materials.woodPropMat;

  return (
    <group name="DaLatHighlandFoliageAndProps">
      {/* Real CC0 Sculpted Pine Forest (~460 trees, 4x4 frustum-culled sectors + wind-synced shadow depth!) */}
      <SectoredInstancedGroup
        name="PineA_Trunks"
        sectors={assets.pineASectors}
        geometry={pineATrunkGeo}
        material={materials.pineTrunkMat}
        customDepthMaterial={materials.pineTrunkDepthMat}
        receiveShadow
      />
      <SectoredInstancedGroup
        name="PineA_Canopies"
        sectors={assets.pineASectors}
        geometry={pineACanopyGeo}
        material={materials.pineCanopyMat}
        customDepthMaterial={materials.pineCanopyDepthMat}
        castShadow
        receiveShadow
        shadowCullRadius={105}
      />
      <SectoredInstancedGroup
        name="PineB_Trunks"
        sectors={assets.pineBSectors}
        geometry={pineBTrunkGeo}
        material={materials.pineTrunkMat}
        customDepthMaterial={materials.pineTrunkDepthMat}
        receiveShadow
      />
      <SectoredInstancedGroup
        name="PineB_Canopies"
        sectors={assets.pineBSectors}
        geometry={pineBCanopyGeo}
        material={materials.pineCanopyMat}
        customDepthMaterial={materials.pineCanopyDepthMat}
        castShadow
        receiveShadow
        shadowCullRadius={105}
      />

      {/* Poly Haven CC0 Botanical Ferns, Shrubs & Quaternius Mossy Rocks (5x5 frustum-culled sectors) */}
      {realBundle && (
        <>
          <SectoredInstancedGroup
            name="PH_Ferns"
            sectors={assets.fernSectors}
            geometry={realBundle.phFernGeo}
            material={realBundle.phFernMat}
            receiveShadow
          />
          <SectoredInstancedGroup
            name="PH_Shrubs"
            sectors={assets.shrubSectors}
            geometry={realBundle.phShrubGeo}
            material={realBundle.phShrubMat}
            receiveShadow
          />
        </>
      )}
      <SectoredInstancedGroup
        name="MossRocks"
        sectors={assets.mossRockSectors}
        geometry={realBundle ? realBundle.mossRockGeo : assets.fallbackMossRockGeo}
        material={materials.wildflowerMat}
        receiveShadow
      />

      {/* Cầu Đất Contour Tea Rows (4x4 frustum-culled sectors, steep cliff bushes filtered) */}
      <SectoredInstancedGroup
        name="CauDatTeaRows"
        sectors={assets.teaSectors}
        geometry={assets.teaGeo}
        material={materials.teaMat}
        receiveShadow
      />

      {/* Seasonal Highland Wildflowers: Hoa Dã Quỳ, Cẩm Tú Cầu & Cỏ Tuyết / Cỏ Hồng (4x4 sectors) */}
      <SectoredInstancedGroup
        name="DaQuyClusters"
        sectors={assets.daQuySectors}
        geometry={assets.daQuyGeo}
        material={materials.wildflowerMat}
        receiveShadow
      />
      <SectoredInstancedGroup
        name="HydrangeaClusters"
        sectors={assets.hydrangeaSectors}
        geometry={assets.hydrangeaGeo}
        material={materials.wildflowerMat}
        receiveShadow
      />
      <SectoredInstancedGroup
        name="PinkGrassTufts"
        sectors={assets.pinkTuftSectors}
        geometry={assets.pinkTuftGeo}
        material={materials.pinkTuftMat}
        receiveShadow
      />

      {/* Grounded Thung Lũng Đèn Greenhouses across Southern/SE Vista & Eastern Basin */}
      <SectoredInstancedGroup
        name="ValleyGreenhouses"
        sectors={assets.greenhouseSectors}
        geometry={assets.greenhouseGeo}
        material={materials.greenhouseMat}
        receiveShadow
      />

      {/* Grounded Weathered-Timber Trestle Viaduct beneath Cầu Gỗ Săn Mây */}
      <instancedMesh
        name="CauGoTimberTrestle"
        ref={trestleRef}
        args={[assets.trestleGeo, materials.woodPropMat, assets.trestleMatrices.length]}
        castShadow
        receiveShadow
      />

      {/* Trail Timber Steps, Post Lanterns & Poly Haven Shared Wooden Benches */}
      <instancedMesh
        ref={stepRef}
        args={[assets.stepGeo, materials.woodPropMat, assets.stepMatrices.length]}
        receiveShadow
      />
      <instancedMesh
        ref={lanternPostRef}
        args={[assets.postGeo, materials.woodPropMat, assets.lanternMatrices.length]}
        receiveShadow
      />
      <instancedMesh
        ref={lanternBulbRef}
        args={[assets.bulbGeo, materials.lanternBulbMat, assets.lanternMatrices.length]}
      />
      <instancedMesh
        key={realBundle ? 'ph-bench-real' : 'ph-bench-fb'}
        ref={benchRef}
        args={[benchGeo, benchMat, assets.benchMatrices.length]}
        castShadow
        receiveShadow
      />

      {/* Secret Landmark #5: Gác Chè Cổ 1927 Weathered Timber Tea-Lookout Pavilion */}
      <mesh
        position={[-21, gacCheY, -181]}
        rotation={[0, 0.65, 0]}
        name="GacChe1927Pavilion"
        geometry={assets.gacCheGeo}
        material={materials.woodPropMat}
        castShadow
        receiveShadow
      />

      {/* Langbiang 2,167m Twin-Peaked North Vista Mountain Silhouette */}
      <mesh
        name="LangbiangNorthVista"
        geometry={assets.langbiangGeo}
        material={materials.langbiangMat}
        position={[0, 0, -720]}
      />
    </group>
  );
}
