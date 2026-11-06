import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  distanceToTrail,
  fbm2D,
  sampleGroundHeight,
  SHARED_BENCHES,
  TRAIL_SEGMENTS,
} from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';

const TARGET_PINE_COUNT = 460;
const TARGET_TEA_HEDGE_COUNT = 380;
const TARGET_GREENHOUSE_COUNT = 160;

const TURBINE_PEDESTALS: ReadonlyArray<[number, number]> = [
  [185, -145],
  [235, -65],
  [215, 28],
  [295, -185],
  [310, -15],
];

function seededHash(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function colorizeGeometry(geo: THREE.BufferGeometry, hex: string, shadeBottomHex?: string): THREE.BufferGeometry {
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo.clone();
  // Ensure clean position + normal only before merging
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

/**
 * Builds authentic Da Lat Pinus kesiya (three-needle highland pine) trunk + umbrella-tiered canopy geometries.
 */
function buildPinusKesiyaGeometries(): {
  trunkGeo: THREE.BufferGeometry;
  canopyGeo: THREE.BufferGeometry;
} {
  // Slender reddish-bark highland trunk with slight organic lean (low-poly painterly)
  const lowerTrunk = new THREE.CylinderGeometry(0.16, 0.28, 5.6, 5, 2);
  lowerTrunk.translate(0, 2.8, 0);
  const ltPos = lowerTrunk.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < ltPos.count; i++) {
    const y = ltPos.getY(i);
    const bend = (y / 5.6) * (y / 5.6) * 0.28;
    ltPos.setX(i, ltPos.getX(i) + bend);
  }

  const upperTrunk = new THREE.CylinderGeometry(0.08, 0.16, 4.2, 5, 1);
  upperTrunk.rotateZ(-0.07);
  upperTrunk.translate(0.42, 7.5, 0);

  const partsTrunk = [
    colorizeGeometry(lowerTrunk, '#6E4534', '#3E271E'),
    colorizeGeometry(upperTrunk, '#7D4E3A', '#593729'),
  ];
  const trunkGeo = mergeGeometries(partsTrunk, false);

  lowerTrunk.dispose();
  upperTrunk.dispose();
  for (const p of partsTrunk) p.dispose();

  // Layered three-needle pine umbrella crown pads (sculpted Dodecahedron pads for ultra-low-poly painterly volume)
  const padSpecs: Array<[number, number, number, number, number, string, string]> = [
    [-0.85, 7.65, 0.2, 1.85, 0.72, '#3F6E49', '#1E382A'],
    [0.95, 8.65, -0.25, 1.95, 0.76, '#47784F', '#223E2E'],
    [0.12, 9.95, 0.05, 2.25, 0.84, '#548858', '#264433'],
  ];

  const padGeos: THREE.BufferGeometry[] = [];
  for (const [px, py, pz, rad, squashY, topHex, botHex] of padSpecs) {
    const ico = new THREE.DodecahedronGeometry(rad, 0);
    ico.scale(1.05, squashY, 0.96);
    ico.translate(px, py, pz);
    padGeos.push(colorizeGeometry(ico, topHex, botHex));
    ico.dispose();
  }
  const canopyGeo = mergeGeometries(padGeos, false);
  for (const g of padGeos) g.dispose();

  return { trunkGeo, canopyGeo };
}

/**
 * Builds sculpted rounded Cầu Đất tea hedge segment (2.6m long x 1.05m high x 1.25m wide).
 */
function buildTeaHedgeGeometry(): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(2.65, 0.98, 1.28, 2, 2, 2);
  const pos = box.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    if (y > 0) {
      const nz = z / 0.64;
      const nx = x / 1.325;
      const arch = Math.sqrt(Math.max(0.12, 1.0 - nz * nz * 0.72 - nx * nx * 0.18));
      y *= arch;
      z *= 0.92;
    }
    pos.setXYZ(i, x, y + 0.46, z);
  }
  const out = colorizeGeometry(box, '#68A63F', '#2B5223');
  box.dispose();
  return out;
}

/**
 * Builds Golden Hoa Dã Quỳ (Wild Sunflower) bush + 4 bright golden blossoms.
 */
function buildDaQuyClusterGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bush = new THREE.DodecahedronGeometry(0.78, 0);
  bush.scale(1.15, 0.85, 1.15);
  bush.translate(0, 0.52, 0);
  parts.push(colorizeGeometry(bush, '#3D6E38', '#214022'));
  bush.dispose();

  const flowerOffsets: Array<[number, number, number]> = [
    [0.0, 1.02, 0.0],
    [0.46, 0.86, 0.3],
    [-0.44, 0.88, 0.26],
    [0.18, 0.84, -0.44],
  ];
  for (const [fx, fy, fz] of flowerOffsets) {
    const petals = new THREE.CylinderGeometry(0.24, 0.18, 0.06, 6);
    petals.rotateX(fx * 0.4);
    petals.rotateZ(-fz * 0.4);
    petals.translate(fx, fy, fz);
    parts.push(colorizeGeometry(petals, '#FFB81C', '#D97B0C'));
    petals.dispose();
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

/**
 * Builds Blue-Violet Cẩm Tú Cầu (Da Lat Hydrangea) bush + pastel pom-pom blooms.
 */
function buildHydrangeaGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const foliage = new THREE.DodecahedronGeometry(0.65, 0);
  foliage.scale(1.15, 0.72, 1.15);
  foliage.translate(0, 0.36, 0);
  parts.push(colorizeGeometry(foliage, '#35633B', '#1D3B24'));
  foliage.dispose();

  const blooms: Array<[number, number, number, string]> = [
    [-0.25, 0.68, 0.16, '#85A6F2'],
    [0.26, 0.72, 0.12, '#9E8DF2'],
    [0.0, 0.75, -0.22, '#7698E8'],
  ];
  for (const [bx, by, bz, hex] of blooms) {
    const head = new THREE.DodecahedronGeometry(0.24, 0);
    head.translate(bx, by, bz);
    parts.push(colorizeGeometry(head, hex, '#5368A6'));
    head.dispose();
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

/**
 * Builds feathery Cỏ Tuyết / Cỏ Hồng highland grass plume tuft.
 */
function buildPinkGrassTuftGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  const count = 7;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + 0.3;
    const cone = new THREE.ConeGeometry(0.075, 0.68, 4);
    cone.translate(0, 0.34, 0);
    cone.rotateX(0.26);
    cone.rotateY(ang);
    blades.push(colorizeGeometry(cone, '#FFFFFF', '#B8C4D0'));
    cone.dispose();
  }
  const merged = mergeGeometries(blades, false);
  for (const b of blades) b.dispose();
  return merged;
}

/**
 * Builds arched Thai Phien "nhà lồng" chrysanthemum greenhouse geometry.
 */
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

/**
 * Builds Langbiang 2,167m Twin-Peaked North Vista Mountain Range (Núi Bà & Đồi Ra-đa) around z = -720m.
 */
function buildLangbiangVistaGeometry(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(1900, 480, 84, 24);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i); // [-950, 950]
    const lz = pos.getZ(i); // [-240, 240]

    // Envelope tapers cleanly to 0 at front/back & lateral skirts
    const depthEnv = Math.sin(clamp((lz + 240) / 480, 0, 1) * Math.PI);
    const sideEnv = 1.0 - smoothstep(640, 940, Math.abs(lx));

    // Twin iconic peaks aligned directly with Cây Thông Cô Đơn North sightline (-95 -> z=-720):
    // 1. Núi Bà (2,167m taller eastern crown) around x = -52
    const nuiBa = 448 * Math.exp(-((lx - -52) * (lx - -52)) / (165 * 165) - (lz * lz) / (145 * 145));
    // 2. Đồi Ra-đa (1,929m rounded western twin peak) around x = -238
    const doiRaDa = 378 * Math.exp(-((lx - -238) * (lx - -238)) / (145 * 145) - ((lz - 14) * (lz - 14)) / (135 * 135));
    // Flanking Dankia & Bidoup distant highland shoulders
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

/**
 * Builds Gác Chè Cổ 1927 Weathered Timber Tea-Lookout Pavilion as 1 merged vertex-colored mesh.
 */
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

/**
 * Builds warm handcrafted highland wooden bench geometry for SHARED_BENCHES.
 */
function buildSharedBenchGeometry(): THREE.BufferGeometry {
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

  for (const lx of [-0.88, 0.88]) {
    const legF = new THREE.BoxGeometry(0.1, 0.46, 0.1);
    legF.translate(lx, 0.23, 0.18);
    parts.push(colorizeGeometry(legF, '#4A3529', '#2E2018'));
    legF.dispose();

    const legB = new THREE.BoxGeometry(0.1, 0.88, 0.1);
    legB.rotateX(-0.08);
    legB.translate(lx, 0.44, -0.2);
    parts.push(colorizeGeometry(legB, '#4A3529', '#2E2018'));
    legB.dispose();
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

/**
 * Builds timber lantern hook-post + warm glass lantern bulb geometries.
 */
function buildTrailLanternGeometries(): {
  postGeo: THREE.BufferGeometry;
  bulbGeo: THREE.BufferGeometry;
} {
  const postParts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.105, 0.14, 2.75, 6);
  pole.translate(0, 1.375, 0);
  postParts.push(colorizeGeometry(pole, '#6B4631', '#3E271B'));
  pole.dispose();

  const arm = new THREE.BoxGeometry(0.62, 0.11, 0.11);
  arm.translate(0.24, 2.66, 0);
  postParts.push(colorizeGeometry(arm, '#6B4631', '#4A2F20'));
  arm.dispose();

  const cap = new THREE.ConeGeometry(0.22, 0.16, 6);
  cap.translate(0.46, 2.55, 0);
  postParts.push(colorizeGeometry(cap, '#362B26', '#241C19'));
  cap.dispose();

  const postGeo = mergeGeometries(postParts, false);
  for (const p of postParts) p.dispose();

  const bulbGeo = new THREE.CylinderGeometry(0.11, 0.09, 0.24, 8);
  bulbGeo.translate(0.46, 2.38, 0);

  return { postGeo, bulbGeo };
}

function isValidPineLocation(x: number, z: number, y: number): boolean {
  if (y < 72.0) return false;
  if (distanceToTrail(x, z) < 6.2) return false;

  // Tiệm Cà Phê Mơ Sương + Campfire Stage + East veranda vista
  if (x >= -65 && x <= 140 && z >= 10 && z <= 50) return false;

  // Cầu Gỗ Săn Mây plateau + unobstructed East sunrise sightline!
  if (Math.hypot(x - 52, z - -75) < 24) return false;
  if (x >= 38 && x <= 380 && z >= -118 && z <= -34) return false;

  // Đài Ngắm Thung Lũng Đèn (18, 128) & unobstructed East greenhouse valley sightline!
  if (Math.hypot(x - 18, z - 128) < 25) return false;
  if (x >= 8 && x <= 380 && z >= 65 && z <= 215) return false;

  // Cây Thông Cô Đơn solitary knoll + unobstructed North sightline toward Langbiang 2,167m!
  if (Math.hypot(x - -95, z - -149) < 28) return false;
  if (Math.abs(x - -95) < 24 && z < -130 && z > -380) return false;

  // Cầu Đất Tea Terraces
  if (Math.hypot(x - 36, z - -58) < 58) return false;

  // Hõm Cỏ Tuyết & Gác Chè 1927 hollow
  if (Math.hypot(x - -14, z - -175) < 32) return false;

  // Wind turbine hilltops
  for (let i = 0; i < TURBINE_PEDESTALS.length; i++) {
    const [tx, tz] = TURBINE_PEDESTALS[i];
    if (Math.hypot(x - tx, z - tz) < 34) return false;
  }

  return true;
}

export function HighlandFoliageAndProps() {
  const pineTrunkRef = useRef<THREE.InstancedMesh>(null);
  const pineCanopyRef = useRef<THREE.InstancedMesh>(null);
  const teaRef = useRef<THREE.InstancedMesh>(null);
  const daQuyRef = useRef<THREE.InstancedMesh>(null);
  const hydrangeaRef = useRef<THREE.InstancedMesh>(null);
  const pinkTuftRef = useRef<THREE.InstancedMesh>(null);
  const greenhouseRef = useRef<THREE.InstancedMesh>(null);
  const stepRef = useRef<THREE.InstancedMesh>(null);
  const lanternPostRef = useRef<THREE.InstancedMesh>(null);
  const lanternBulbRef = useRef<THREE.InstancedMesh>(null);
  const benchRef = useRef<THREE.InstancedMesh>(null);

  // Shared wind & sunrise uniforms for custom foliage shaders
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

  // Build all procedural highland geometries & deterministic placement matrices once
  const assets = useMemo(() => {
    const dummy = new THREE.Object3D();

    // 1. Pinus kesiya Pine Forest (~850 trees)
    const { trunkGeo, canopyGeo } = buildPinusKesiyaGeometries();
    const pineMatrices: THREE.Matrix4[] = [];
    let attempt = 0;
    while (pineMatrices.length < TARGET_PINE_COUNT && attempt < 18000) {
      attempt++;
      const rx = (seededHash(attempt * 3.17) - 0.5) * 856;
      const rz = (seededHash(attempt * 7.31) - 0.5) * 856;
      const ry = sampleGroundHeight(rx, rz);

      // Clump naturally using FBM forest density
      const groveDensity = 0.55 + 0.45 * fbm2D(rx * 0.015, rz * 0.015, 2);
      if (seededHash(attempt * 11.9) > groveDensity) continue;
      if (!isValidPineLocation(rx, rz, ry)) continue;

      const scaleXZ = 0.78 + seededHash(attempt * 13.7) * 0.58;
      const scaleY = 0.82 + seededHash(attempt * 17.3) * 0.68;
      const yaw = seededHash(attempt * 23.1) * Math.PI * 2;
      const tiltX = (seededHash(attempt * 29.5) - 0.5) * 0.08;
      const tiltZ = (seededHash(attempt * 31.9) - 0.5) * 0.08;

      dummy.position.set(rx, ry - 0.25, rz);
      dummy.rotation.set(tiltX, yaw, tiltZ);
      dummy.scale.set(scaleXZ, scaleY, scaleXZ);
      dummy.updateMatrix();
      pineMatrices.push(dummy.matrix.clone());
    }

    // 2. Cầu Đất Contour Tea Rows (~420 sculpted rounded hedge segments)
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
        // Orient hedge tangent to local terrain iso-elevation contour
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

    // 3. Seasonal Highland Wildflowers: Hoa Dã Quỳ along Dốc Dã Quỳ & Đài Ngắm Thung Lũng Đèn (18, 128) -> (-51, 28)
    const daQuyGeo = buildDaQuyClusterGeometry();
    const daQuyMatrices: THREE.Matrix4[] = [];
    for (let i = 0; i < 1600 && daQuyMatrices.length < 185; i++) {
      const tAlong = seededHash(i * 5.1 + 101);
      const baseX = 18 - tAlong * 69 + (seededHash(i * 7.7 + 202) - 0.5) * 32;
      const baseZ = 128 - tAlong * 100 + (seededHash(i * 9.3 + 303) - 0.5) * 32;
      const dTrail = distanceToTrail(baseX, baseZ);
      if (dTrail < 3.6 || dTrail > 14.5) continue;
      if (baseX > 20.5 && baseZ > 116) continue; // Keep East cliff edge sightline open
      if (baseX >= -55 && baseX <= -22 && baseZ >= 18 && baseZ <= 42) continue;

      const by = sampleGroundHeight(baseX, baseZ);
      const sc = 0.78 + seededHash(i * 13.1) * 0.62;
      dummy.position.set(baseX, by - 0.08, baseZ);
      dummy.rotation.set(0, seededHash(i * 17.9) * Math.PI * 2, 0);
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
        : -16 + (seededHash(i * 4.3 + 11) - 0.5) * 42;
      const hz = nearCafe
        ? 30 + (seededHash(i * 6.7 + 29) - 0.5) * 38
        : -178 + (seededHash(i * 6.7 + 29) - 0.5) * 38;

      if (distanceToTrail(hx, hz) < 3.5) continue;
      // Keep clear of Mơ Sương wooden veranda & campfire pit
      if (hx >= -56 && hx <= -22 && hz >= 18 && hz <= 42) continue;
      if (Math.hypot(hx - -53, hz - 24) < 5.5) continue;

      const hy = sampleGroundHeight(hx, hz);
      const sc = 0.78 + seededHash(i * 15.3) * 0.52;
      dummy.position.set(hx, hy - 0.06, hz);
      dummy.rotation.set(0, seededHash(i * 19.7) * Math.PI * 2, 0);
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

    // 4. Thung Lũng Đèn Greenhouses (~140 arched nhà lồng in x in [145, 380], z in [-45, 230])
    const greenhouseGeo = buildGreenhouseGeometry();
    const greenhouseMatrices: THREE.Matrix4[] = [];
    for (let gx = 148; gx <= 378 && greenhouseMatrices.length < TARGET_GREENHOUSE_COUNT; gx += 16.5) {
      for (let gz = -42; gz <= 228 && greenhouseMatrices.length < TARGET_GREENHOUSE_COUNT; gz += 19.5) {
        const jx = gx + (seededHash(gx * 13 + gz * 7) - 0.5) * 5.0;
        const jz = gz + (seededHash(gx * 19 + gz * 11) - 0.5) * 5.0;
        if (jx < 145 || jx > 380 || jz < -45 || jz > 230) continue;

        const gy = sampleGroundHeight(jx, jz);
        // Place in Eastern/SE valley basins below 66m, naturally filling Thung Lũng Đèn
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

    // 5. Trail Timber Steps & Warm Post Lanterns along TRAIL_SEGMENTS
    const stepBox = new THREE.BoxGeometry(2.6, 0.16, 0.42);
    const stepGeo = colorizeGeometry(stepBox, '#7D5338', '#4F3220');
    stepBox.dispose();

    const stepMatrices: THREE.Matrix4[] = [];
    const lanternMatrices: THREE.Matrix4[] = [];

    for (let segIdx = 0; segIdx < TRAIL_SEGMENTS.length; segIdx++) {
      const [ax, az, bx, bz] = TRAIL_SEGMENTS[segIdx];
      const segLen = Math.hypot(bx - ax, bz - az);
      const dirX = (bx - ax) / segLen;
      const dirZ = (bz - az) / segLen;
      const perpX = -dirZ;
      const perpZ = dirX;
      const trailYaw = Math.atan2(dirX, dirZ);

      // Timber steps on steeper trail grades
      const numChecks = Math.floor(segLen / 1.85);
      for (let k = 1; k < numChecks; k++) {
        const t = k / numChecks;
        const sx = ax + (bx - ax) * t;
        const sz = az + (bz - az) * t;
        const y0 = sampleGroundHeight(sx - dirX * 0.9, sz - dirZ * 0.9);
        const y1 = sampleGroundHeight(sx + dirX * 0.9, sz + dirZ * 0.9);
        const slope = Math.abs(y1 - y0) / 1.8;
        if (slope > 0.115) {
          const sy = sampleGroundHeight(sx, sz);
          dummy.position.set(sx, sy + 0.02, sz);
          dummy.rotation.set(0, trailYaw, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          stepMatrices.push(dummy.matrix.clone());
        }
      }

      // Warm post lanterns every ~26m alternating gently beside the trail
      const lanternSpacing = 26;
      const lCount = Math.max(1, Math.floor(segLen / lanternSpacing));
      for (let l = 0; l < lCount; l++) {
        const t = (l + 0.5) / lCount;
        const side = (segIdx + l) % 2 === 0 ? 1 : -1;
        const lx = ax + (bx - ax) * t + perpX * 3.65 * side;
        const lz = az + (bz - az) * t + perpZ * 3.65 * side;
        const ly = sampleGroundHeight(lx, lz);
        // Aim lantern arm inward over the red-basalt trail
        const inwardYaw = Math.atan2(-perpX * side, -perpZ * side);

        dummy.position.set(lx, ly - 0.1, lz);
        dummy.rotation.set(0, inwardYaw, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        lanternMatrices.push(dummy.matrix.clone());
      }
    }

    // Add dedicated lantern beside Gác Chè Cổ 1927 secret lookout
    {
      const gx = -18.2;
      const gz = -178.5;
      dummy.position.set(gx, sampleGroundHeight(gx, gz) - 0.1, gz);
      dummy.rotation.set(0, 0.8, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      lanternMatrices.push(dummy.matrix.clone());
    }

    const { postGeo, bulbGeo } = buildTrailLanternGeometries();

    // 6. Shared Wooden Benches at exact SHARED_BENCHES coordinates
    const benchGeo = buildSharedBenchGeometry();
    const benchMatrices: THREE.Matrix4[] = SHARED_BENCHES.map((b) => {
      dummy.position.set(b.position[0], b.position[1], b.position[2]);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });

    // 7. Langbiang 2,167m North Vista Mountain Silhouette + Gác Chè 1927 Pavilion
    const langbiangGeo = buildLangbiangVistaGeometry();
    const gacCheGeo = buildGacChePavilionGeometry();

    return {
      trunkGeo,
      canopyGeo,
      pineMatrices,
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
      benchGeo,
      benchMatrices,
      langbiangGeo,
      gacCheGeo,
    };
  }, []);

  // Custom wind-swaying materials & PBR materials
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
            float hFactor = clamp(transformed.y / 10.5, 0.0, 1.25);
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
    injectPineWind(pineTrunkMat, 0.34, 'dalat-pine-trunk-wind-v1');

    const pineCanopyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.02,
    });
    injectPineWind(pineCanopyMat, 0.42, 'dalat-pine-canopy-wind-v1');

    const teaMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.66, // Vibrant young Camellia sinensis leaf sheen
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

  // Populate all InstancedMesh matrices once on mount & dispose everything cleanly on unmount
  useEffect(() => {
    const applyMatrices = (mesh: THREE.InstancedMesh | null, list: THREE.Matrix4[]) => {
      if (!mesh) return;
      for (let i = 0; i < list.length; i++) {
        mesh.setMatrixAt(i, list[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };

    applyMatrices(pineTrunkRef.current, assets.pineMatrices);
    applyMatrices(pineCanopyRef.current, assets.pineMatrices);
    applyMatrices(teaRef.current, assets.teaMatrices);
    applyMatrices(daQuyRef.current, assets.daQuyMatrices);
    applyMatrices(hydrangeaRef.current, assets.hydrangeaMatrices);
    applyMatrices(pinkTuftRef.current, assets.pinkTuftMatrices);
    applyMatrices(greenhouseRef.current, assets.greenhouseMatrices);
    applyMatrices(stepRef.current, assets.stepMatrices);
    applyMatrices(lanternPostRef.current, assets.lanternMatrices);
    applyMatrices(lanternBulbRef.current, assets.lanternMatrices);
    applyMatrices(benchRef.current, assets.benchMatrices);

    return () => {
      assets.trunkGeo.dispose();
      assets.canopyGeo.dispose();
      assets.teaGeo.dispose();
      assets.daQuyGeo.dispose();
      assets.hydrangeaGeo.dispose();
      assets.pinkTuftGeo.dispose();
      assets.greenhouseGeo.dispose();
      assets.stepGeo.dispose();
      assets.postGeo.dispose();
      assets.bulbGeo.dispose();
      assets.benchGeo.dispose();
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

  // Animate wind sway, 2,700K greenhouse night-break glow, trail lanterns & Cỏ Hồng sunrise shift
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

    // 2,700K Thai Phien greenhouse amber glow
    const targetGhEmissive = atmo.greenhouseGlow * 5.8;
    materials.greenhouseMat.emissiveIntensity +=
      (targetGhEmissive - materials.greenhouseMat.emissiveIntensity) * lerpRate;

    // Subtle aerial perspective rim tint on Langbiang twin peaks matching Da Lat sky
    materials.langbiangMat.emissive.set(atmo.fogHex).multiplyScalar(0.55);

    // Trail & landmark post lanterns turn on automatically at dusk & pre-dawn
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

  return (
    <group name="DaLatHighlandFoliageAndProps">
      {/* Pinus kesiya Three-Needle Highland Pine Forest (~460 trees) */}
      <instancedMesh
        ref={pineTrunkRef}
        args={[assets.trunkGeo, materials.pineTrunkMat, assets.pineMatrices.length]}
        receiveShadow
      />
      <instancedMesh
        ref={pineCanopyRef}
        args={[assets.canopyGeo, materials.pineCanopyMat, assets.pineMatrices.length]}
        castShadow
        receiveShadow
      />

      {/* Cầu Đất Contour Tea Rows (~380 sculpted hedge segments) */}
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

      {/* Thung Lũng Đèn Greenhouses (~160 glowing 2,700K arched nhà lồng) */}
      <instancedMesh
        ref={greenhouseRef}
        args={[assets.greenhouseGeo, materials.greenhouseMat, assets.greenhouseMatrices.length]}
        receiveShadow
      />

      {/* Trail Timber Steps, Post Lanterns & Shared Wooden Benches */}
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
        ref={benchRef}
        args={[assets.benchGeo, materials.woodPropMat, assets.benchMatrices.length]}
        castShadow
        receiveShadow
      />

      {/* Secret Landmark #5: Gác Chè Cổ 1927 Weathered Timber Tea-Lookout Pavilion (1 merged draw call) */}
      <mesh
        position={[-21, gacCheY, -181]}
        rotation={[0, 0.65, 0]}
        name="GacChe1927Pavilion"
        geometry={assets.gacCheGeo}
        material={materials.woodPropMat}
        castShadow
        receiveShadow
      />

      {/* Langbiang 2,167m Twin-Peaked North Vista Mountain Silhouette (z = -720) */}
      <mesh
        name="LangbiangNorthVista"
        geometry={assets.langbiangGeo}
        material={materials.langbiangMat}
        position={[0, 0, -720]}
      />
    </group>
  );
}
