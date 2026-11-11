import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'meshoptimizer';
import {
  distanceToTrail,
  fbm2D,
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
const TARGET_GREENHOUSE_COUNT = 160;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function colorizeGeometry(geo: THREE.BufferGeometry, hex: string, shadeBottomHex?: string): THREE.BufferGeometry {
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo.clone();
  const keep = new THREE.BufferGeometry();
  const pos = nonIndexed.getAttribute('position') as THREE.BufferAttribute;
  keep.setAttribute('position', pos.clone());
  nonIndexed.computeVertexNormals();
  keep.setAttribute('normal', (nonIndexed.getAttribute('normal') as THREE.BufferAttribute).clone());

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
  nonIndexed.dispose();
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
            colorizeGeometry(g, mName.includes('green') ? '#4A7C44' : '#6A717A', mName.includes('green') ? '#2B4E2B' : '#3E444D')
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

      const pineATrunkGeo = colorizeGeometry(pAT.geo, '#744835', '#3D251C');
      const pineACanopyGeo = colorizeGeometry(pAC.geo, '#4E8252', '#1D3A28');
      const pineBTrunkGeo = colorizeGeometry(pBT.geo, '#6C4331', '#382219');
      const pineBCanopyGeo = colorizeGeometry(pBC.geo, '#44764B', '#193424');
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
  const box = new THREE.BoxGeometry(2.68, 0.96, 1.32, 8, 4, 5);
  const pos = box.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const nx = x / 1.34;
    const nz = z / 0.66;
    if (y > -0.35) {
      const dome = Math.sqrt(Math.max(0.08, 1.0 - nz * nz * 0.82 - nx * nx * 0.22));
      const leafRipple =
        0.045 * Math.sin(x * 5.2 + z * 3.4) + 0.03 * Math.cos(x * 8.3 - z * 6.1);
      y = (y + 0.48) * dome - 0.48 + (y > 0 ? leafRipple : 0);
      z *= 0.88 + 0.12 * dome;
    }
    pos.setXYZ(i, x, y + 0.44, z);
  }
  const out = colorizeGeometry(box, '#6CAB3E', '#254A1F');
  box.dispose();
  return out;
}

function buildDaQuyClusterGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Multi-lobed leafy bush cushion + arched highland leaves
  const lobes: Array<[number, number, number, number, number]> = [
    [0.0, 0.34, 0.0, 0.52, 0.36],
    [-0.32, 0.28, 0.18, 0.42, 0.3],
    [0.34, 0.3, 0.14, 0.4, 0.29],
    [0.04, 0.32, -0.28, 0.44, 0.31],
  ];
  for (const [lx, ly, lz, rXZ, rY] of lobes) {
    const sph = new THREE.IcosahedronGeometry(1.0, 2);
    sph.scale(rXZ, rY, rXZ);
    sph.translate(lx, ly, lz);
    parts.push(colorizeGeometry(sph, '#447A3C', '#1E3C1E'));
    sph.dispose();
  }

  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * Math.PI * 2 + 0.2;
    const leaf = new THREE.ConeGeometry(0.14, 0.54, 5);
    leaf.scale(1.0, 1.0, 0.26);
    leaf.translate(0, 0.27, 0);
    leaf.rotateX(0.68);
    leaf.rotateY(ang);
    leaf.translate(0, 0.16, 0);
    parts.push(colorizeGeometry(leaf, '#4E8842', '#214220'));
    leaf.dispose();
  }

  const flowerOffsets: Array<[number, number, number]> = [
    [0.0, 0.72, 0.02],
    [0.36, 0.62, 0.24],
    [-0.35, 0.64, 0.2],
    [0.18, 0.6, -0.34],
    [-0.2, 0.66, -0.28],
    [0.28, 0.54, -0.06],
  ];
  for (const [fx, fy, fz] of flowerOffsets) {
    for (let p = 0; p < 7; p++) {
      const a = (p / 7) * Math.PI * 2;
      const petal = new THREE.ConeGeometry(0.048, 0.17, 4);
      petal.scale(1.0, 1.0, 0.25);
      petal.translate(0, 0.09, 0);
      petal.rotateX(Math.PI * 0.46);
      petal.rotateY(a);
      petal.rotateX(fx * 0.35);
      petal.rotateZ(-fz * 0.35);
      petal.translate(fx, fy, fz);
      parts.push(colorizeGeometry(petal, '#FFC928', '#E0860B'));
      petal.dispose();
    }
    const disc = new THREE.IcosahedronGeometry(0.052, 1);
    disc.scale(1.0, 0.55, 1.0);
    disc.translate(fx, fy + 0.015, fz);
    parts.push(colorizeGeometry(disc, '#8C4308', '#4F2404'));
    disc.dispose();
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

function buildHydrangeaGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Soft multi-lobe serrated leafy base (no blocky single dodecahedron!)
  const leafCushions: Array<[number, number, number, number, number]> = [
    [0.0, 0.24, 0.0, 0.44, 0.26],
    [-0.24, 0.2, 0.15, 0.34, 0.22],
    [0.25, 0.21, 0.12, 0.33, 0.22],
    [-0.04, 0.22, -0.22, 0.35, 0.23],
  ];
  for (const [cx, cy, cz, rxz, ry] of leafCushions) {
    const c = new THREE.IcosahedronGeometry(1.0, 2);
    c.scale(rxz, ry, rxz);
    c.translate(cx, cy, cz);
    parts.push(colorizeGeometry(c, '#3B6E3F', '#1B3821'));
    c.dispose();
  }

  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 + 0.4;
    const leaf = new THREE.ConeGeometry(0.13, 0.44, 5);
    leaf.scale(1.0, 1.0, 0.24);
    leaf.translate(0, 0.22, 0);
    leaf.rotateX(0.76);
    leaf.rotateY(ang);
    leaf.translate(0, 0.12, 0);
    parts.push(colorizeGeometry(leaf, '#467D48', '#1E3D23'));
    leaf.dispose();
  }

  // Delicate multi-floret Đà Lạt Cẩm Tú Cầu panicles (clusters of tiny pastel florets instead of 3 big spheres)
  const panicles: Array<[number, number, number, string, string]> = [
    [-0.2, 0.49, 0.13, '#A6C2FA', '#6E8AD1'],
    [0.21, 0.52, 0.1, '#C4B6FA', '#8678C9'],
    [-0.02, 0.54, -0.16, '#9AB8F5', '#6482C7'],
    [0.04, 0.45, 0.22, '#D4E2FF', '#8FA8DC'],
  ];
  const subOffsets: Array<[number, number, number, number]> = [
    [0.0, 0.045, 0.0, 0.068],
    [0.062, 0.015, 0.035, 0.058],
    [-0.06, 0.018, 0.038, 0.056],
    [0.038, 0.012, -0.058, 0.056],
    [-0.042, 0.016, -0.054, 0.058],
    [0.0, -0.01, 0.068, 0.052],
  ];
  for (const [bx, by, bz, topHex, botHex] of panicles) {
    for (const [ox, oy, oz, r] of subOffsets) {
      const floret = new THREE.IcosahedronGeometry(r, 1);
      floret.scale(1.05, 0.82, 1.05);
      floret.translate(bx + ox, by + oy, bz + oz);
      parts.push(colorizeGeometry(floret, topHex, botHex));
      floret.dispose();
    }
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

function buildPinkGrassTuftGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  const count = 13;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + (i % 2) * 0.24;
    const tilt = 0.18 + (i % 3) * 0.14;
    const h = 0.52 + (i % 4) * 0.08;
    const cone = new THREE.ConeGeometry(0.036, h, 4);
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
  const baseWalls = new THREE.BoxGeometry(5.6, 1.85, 11.4);
  baseWalls.translate(0, 0.925, 0);
  parts.push(colorizeGeometry(baseWalls, '#E8DFC8', '#C4B699'));
  baseWalls.dispose();

  const archRoof = new THREE.CylinderGeometry(2.82, 2.82, 11.5, 10, 1, false, 0, Math.PI);
  archRoof.rotateZ(Math.PI / 2);
  archRoof.rotateY(Math.PI / 2);
  archRoof.scale(1.0, 0.62, 1.0);
  archRoof.translate(0, 1.85, 0);
  parts.push(colorizeGeometry(archRoof, '#FFF5DE', '#E6D6B8'));
  archRoof.dispose();

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
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

export function HighlandFoliageAndProps() {
  const [realBundle, setRealBundle] = useState<RealFoliageGlbBundle | null>(null);

  const pineATrunkRef = useRef<THREE.InstancedMesh>(null);
  const pineACanopyRef = useRef<THREE.InstancedMesh>(null);
  const pineBTrunkRef = useRef<THREE.InstancedMesh>(null);
  const pineBCanopyRef = useRef<THREE.InstancedMesh>(null);

  const fernRef = useRef<THREE.InstancedMesh>(null);
  const shrubRef = useRef<THREE.InstancedMesh>(null);
  const mossRockRef = useRef<THREE.InstancedMesh>(null);

  const teaRef = useRef<THREE.InstancedMesh>(null);
  const daQuyRef = useRef<THREE.InstancedMesh>(null);
  const hydrangeaRef = useRef<THREE.InstancedMesh>(null);
  const pinkTuftRef = useRef<THREE.InstancedMesh>(null);
  const greenhouseRef = useRef<THREE.InstancedMesh>(null);
  const stepRef = useRef<THREE.InstancedMesh>(null);
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

      const gx = (sampleGroundHeight(fx + 0.8, fz) - sampleGroundHeight(fx - 0.8, fz)) / 1.6;
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

    // 2. Cầu Đất Contour Tea Rows
    const teaGeo = buildTeaHedgeGeometry();
    const teaMatrices: THREE.Matrix4[] = [];
    for (let ring = 0; ring < 14 && teaMatrices.length < TARGET_TEA_HEDGE_COUNT; ring++) {
      const radius = 14 + ring * 3.7;
      const circumference = 2 * Math.PI * radius;
      const segCount = Math.floor(circumference / 2.65);

      for (let s = 0; s < segCount && teaMatrices.length < TARGET_TEA_HEDGE_COUNT; s++) {
        const angle = (s / segCount) * Math.PI * 2 + ring * 0.19;
        const hx = 36 + Math.cos(angle) * radius;
        const hz = -58 + Math.sin(angle) * radius * 0.95;

        if (distanceToTrail(hx, hz) < 4.7) continue;
        if (Math.hypot(hx - 52, hz - -75) < 15.5) continue;

        const hy = sampleGroundHeight(hx, hz);
        const gx = sampleGroundHeight(hx + 1.2, hz) - sampleGroundHeight(hx - 1.2, hz);
        const gz = sampleGroundHeight(hx, hz + 1.2) - sampleGroundHeight(hx, hz - 1.2);
        const contourYaw = Math.atan2(gx, -gz);

        dummy.position.set(hx, hy - 0.12, hz);
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

    // 4. Thung Lũng Đèn Greenhouses
    const greenhouseGeo = buildGreenhouseGeometry();
    const greenhouseMatrices: THREE.Matrix4[] = [];
    for (let gx = 148; gx <= 378 && greenhouseMatrices.length < TARGET_GREENHOUSE_COUNT; gx += 16.5) {
      for (let gz = -42; gz <= 228 && greenhouseMatrices.length < TARGET_GREENHOUSE_COUNT; gz += 19.5) {
        const jx = gx + (seededHash(gx * 13 + gz * 7) - 0.5) * 5.0;
        const jz = gz + (seededHash(gx * 19 + gz * 11) - 0.5) * 5.0;
        if (jx < 145 || jx > 380 || jz < -45 || jz > 230) continue;

        const gy = sampleGroundHeight(jx, jz);
        if (gy > 66) continue;
        if (seededHash(gx * 31 + gz * 17) < 0.08) continue;

        const yaw = 0.12 + (seededHash(gx * 7 + gz * 23) - 0.5) * 0.18;
        const sc = 0.86 + seededHash(gx * 41 + gz * 3) * 0.34;
        dummy.position.set(jx, gy - 0.35, jz);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(sc, sc * 0.95, sc * (0.9 + seededHash(gx + gz) * 0.25));
        dummy.updateMatrix();
        greenhouseMatrices.push(dummy.matrix.clone());
      }
    }

    // 5. Trail Timber Steps (embedded flush sleepers so boots never clip into thick step boxes) & Warm Post Lanterns
    const stepBox = new THREE.BoxGeometry(2.6, 0.08, 0.42);
    const stepGeo = colorizeGeometry(stepBox, '#7D5338', '#4F3220');
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

    // 6. Shared Wooden Benches (Poly Haven painted_wooden_bench at exact SHARED_BENCHES coordinates)
    const fallbackBenchGeo = buildSharedBenchFallbackGeometry();
    const benchMatrices: THREE.Matrix4[] = SHARED_BENCHES.map((b) => {
      dummy.position.set(b.position[0], b.position[1], b.position[2]);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });

    const langbiangGeo = buildLangbiangVistaGeometry();
    const gacCheGeo = buildGacChePavilionGeometry();

    return {
      fallbackTrunkGeo,
      fallbackCanopyGeo,
      pineAMatrices,
      pineBMatrices,
      fernMatrices,
      shrubMatrices,
      mossRockMatrices,
      teaGeo,
      teaMatrices,
      daQuyGeo,
      daQuyMatrices,
      hydrangeaGeo,
      hydrangeaMatrices,
      pinkTuftGeo,
      pinkTuftMatrices,
      greenhouseGeo,
      greenhouseMatrices,
      stepGeo,
      stepMatrices,
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
    const injectPineWind = (mat: THREE.MeshStandardMaterial, swayAmp: number, cacheKey: string) => {
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
      roughness: 0.9,
      metalness: 0.02,
    });
    injectPineWind(pineTrunkMat, 0.22, 'dalat-pine-trunk-wind-v2');

    const pineCanopyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.02,
    });
    injectPineWind(pineCanopyMat, 0.44, 'dalat-pine-canopy-wind-v2');

    const teaMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.66,
      metalness: 0.04,
    });

    const wildflowerMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.74,
      metalness: 0.02,
    });

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
      roughness: 0.35,
      metalness: 0.04,
      transparent: true,
      opacity: 0.94,
      emissive: new THREE.Color('#FFA834'),
      emissiveIntensity: 3.6,
    });

    const woodPropMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.84,
      metalness: 0.04,
    });

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
      pineCanopyMat,
      teaMat,
      wildflowerMat,
      pinkTuftMat,
      greenhouseMat,
      woodPropMat,
      lanternBulbMat,
      langbiangMat,
    };
  }, [foliageUniforms]);

  // Apply instance matrices whenever base assets or async real GLB bundle resolves
  useEffect(() => {
    const applyMatrices = (mesh: THREE.InstancedMesh | null, list: THREE.Matrix4[]) => {
      if (!mesh) return;
      for (let i = 0; i < list.length; i++) {
        mesh.setMatrixAt(i, list[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };

    applyMatrices(pineATrunkRef.current, assets.pineAMatrices);
    applyMatrices(pineACanopyRef.current, assets.pineAMatrices);
    applyMatrices(pineBTrunkRef.current, assets.pineBMatrices);
    applyMatrices(pineBCanopyRef.current, assets.pineBMatrices);
    applyMatrices(fernRef.current, assets.fernMatrices);
    applyMatrices(shrubRef.current, assets.shrubMatrices);
    applyMatrices(mossRockRef.current, assets.mossRockMatrices);
    applyMatrices(teaRef.current, assets.teaMatrices);
    applyMatrices(daQuyRef.current, assets.daQuyMatrices);
    applyMatrices(hydrangeaRef.current, assets.hydrangeaMatrices);
    applyMatrices(pinkTuftRef.current, assets.pinkTuftMatrices);
    applyMatrices(greenhouseRef.current, assets.greenhouseMatrices);
    applyMatrices(stepRef.current, assets.stepMatrices);
    applyMatrices(lanternPostRef.current, assets.lanternMatrices);
    applyMatrices(lanternBulbRef.current, assets.lanternMatrices);
    applyMatrices(benchRef.current, assets.benchMatrices);
  }, [assets, realBundle]);

  useEffect(() => {
    return () => {
      assets.fallbackTrunkGeo.dispose();
      assets.fallbackCanopyGeo.dispose();
      assets.teaGeo.dispose();
      assets.daQuyGeo.dispose();
      assets.hydrangeaGeo.dispose();
      assets.pinkTuftGeo.dispose();
      assets.greenhouseGeo.dispose();
      assets.stepGeo.dispose();
      assets.postGeo.dispose();
      assets.bulbGeo.dispose();
      assets.fallbackBenchGeo.dispose();
      assets.langbiangGeo.dispose();
      assets.gacCheGeo.dispose();

      materials.pineTrunkMat.dispose();
      materials.pineCanopyMat.dispose();
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

    const gh = atmo.gameHour;
    const targetPink = gh >= 5.15 && gh <= 18.2 ? smoothstep(5.12, 5.48, gh) : 0.0;
    foliageUniforms.uPinkPhase.value +=
      (targetPink - foliageUniforms.uPinkPhase.value) * lerpRate;

    const targetGhEmissive = atmo.greenhouseGlow * 5.8;
    materials.greenhouseMat.emissiveIntensity +=
      (targetGhEmissive - materials.greenhouseMat.emissiveIntensity) * lerpRate;

    materials.langbiangMat.emissive.set(atmo.fogHex).multiplyScalar(0.55);

    const lanternFactor =
      gh < 5.35
        ? 1.0
        : gh < 5.95
          ? 1.0 - (gh - 5.35) / 0.6
          : gh > 17.65
            ? 1.0
            : gh > 17.05
              ? (gh - 17.05) / 0.6
              : 0.08;
    const targetLanternEmissive = lanternFactor * 2.8;
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
      {/* Real CC0 Sculpted Pine Forest (~460 trees across Species A & Species B) */}
      <instancedMesh
        key={realBundle ? 'pineA-trunk-real' : 'pineA-trunk-fb'}
        ref={pineATrunkRef}
        args={[pineATrunkGeo, materials.pineTrunkMat, assets.pineAMatrices.length]}
        receiveShadow
      />
      <instancedMesh
        key={realBundle ? 'pineA-canopy-real' : 'pineA-canopy-fb'}
        ref={pineACanopyRef}
        args={[pineACanopyGeo, materials.pineCanopyMat, assets.pineAMatrices.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        key={realBundle ? 'pineB-trunk-real' : 'pineB-trunk-fb'}
        ref={pineBTrunkRef}
        args={[pineBTrunkGeo, materials.pineTrunkMat, assets.pineBMatrices.length]}
        receiveShadow
      />
      <instancedMesh
        key={realBundle ? 'pineB-canopy-real' : 'pineB-canopy-fb'}
        ref={pineBCanopyRef}
        args={[pineBCanopyGeo, materials.pineCanopyMat, assets.pineBMatrices.length]}
        castShadow
        receiveShadow
      />

      {/* Poly Haven CC0 Botanical Ferns, Shrubs & Quaternius Mossy Rocks */}
      {realBundle && (
        <>
          <instancedMesh
            ref={fernRef}
            args={[realBundle.phFernGeo, realBundle.phFernMat, assets.fernMatrices.length]}
            receiveShadow
          />
          <instancedMesh
            ref={shrubRef}
            args={[realBundle.phShrubGeo, realBundle.phShrubMat, assets.shrubMatrices.length]}
            receiveShadow
          />
          <instancedMesh
            ref={mossRockRef}
            args={[realBundle.mossRockGeo, materials.wildflowerMat, assets.mossRockMatrices.length]}
            castShadow
            receiveShadow
          />
        </>
      )}

      {/* Cầu Đất Contour Tea Rows */}
      <instancedMesh
        ref={teaRef}
        args={[assets.teaGeo, materials.teaMat, assets.teaMatrices.length]}
        receiveShadow
      />

      {/* Seasonal Highland Wildflowers: Hoa Dã Quỳ, Cẩm Tú Cầu & Cỏ Tuyết / Cỏ Hồng */}
      <instancedMesh
        ref={daQuyRef}
        args={[assets.daQuyGeo, materials.wildflowerMat, assets.daQuyMatrices.length]}
        receiveShadow
      />
      <instancedMesh
        ref={hydrangeaRef}
        args={[assets.hydrangeaGeo, materials.wildflowerMat, assets.hydrangeaMatrices.length]}
        receiveShadow
      />
      <instancedMesh
        ref={pinkTuftRef}
        args={[assets.pinkTuftGeo, materials.pinkTuftMat, assets.pinkTuftMatrices.length]}
        receiveShadow
      />

      {/* Thung Lũng Đèn Greenhouses */}
      <instancedMesh
        ref={greenhouseRef}
        args={[assets.greenhouseGeo, materials.greenhouseMat, assets.greenhouseMatrices.length]}
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
