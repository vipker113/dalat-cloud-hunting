import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useFrame } from '@react-three/fiber';
import { EmoteId, HeldItemId, PlayerOutfit } from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';

export interface AvatarMotionSample {
  moving: boolean;
  running: boolean;
  grounded: boolean;
  speed: number;
  seated: boolean;
  emote: EmoteId;
  warmBuff: boolean;
  temperatureC: number;
  windStrength: number;
  jamPulse?: number; // 0..1 recent guitar strum energy
}

export interface HighlandAvatarProps {
  outfit: PlayerOutfit;
  heldItem: HeldItemId;
  isLocal?: boolean;
  seed?: number;
  /** Read every frame inside useFrame with zero React re-renders */
  getMotion: () => AvatarMotionSample;
}

function makeLathe(points: Array<[number, number]>, segments = 14): THREE.LatheGeometry {
  const vecs = points.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(vecs, segments);
  geo.computeVertexNormals();
  return geo;
}

function stripUvAndMerge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const cleaned = parts.map((src) => {
    const g = src.index ? src.toNonIndexed() : src.clone();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.getAttribute('position'));
    out.setAttribute('normal', g.getAttribute('normal'));
    return out;
  });
  const merged = mergeGeometries(cleaned, false);
  for (const c of cleaned) c.dispose();
  for (const p of parts) p.dispose();
  return merged;
}

const _tmpMat4 = new THREE.Matrix4();
const _tmpMat4Parent = new THREE.Matrix4();
const _tmpQuat = new THREE.Quaternion();
const _tmpEuler = new THREE.Euler();
const _tmpPos = new THREE.Vector3();
const _tmpScale = new THREE.Vector3();

function buildLocalMatrix(
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
  target = _tmpMat4
): THREE.Matrix4 {
  _tmpPos.set(pos[0], pos[1], pos[2]);
  _tmpEuler.set(rot[0], rot[1], rot[2], 'XYZ');
  _tmpQuat.setFromEuler(_tmpEuler);
  _tmpScale.set(scale[0], scale[1], scale[2]);
  return target.compose(_tmpPos, _tmpQuat, _tmpScale);
}

function paintGeometry(
  src: THREE.BufferGeometry,
  colorInput: string | THREE.Color,
  matrix?: THREE.Matrix4
): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  if (matrix) {
    g.applyMatrix4(matrix);
  }
  g.computeVertexNormals();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const norm = g.getAttribute('normal') as THREE.BufferAttribute;

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', pos);
  out.setAttribute('normal', norm);

  const col = typeof colorInput === 'string' ? new THREE.Color(colorInput) : colorInput;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return out;
}

function mergePaintedParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

// Shared module-level vertex-colored PBR material across all avatars (zero shader/material state thrash!)
const SHARED_VERTEX_PBR_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.83,
  metalness: 0.03,
});
const SHARED_PANTS_MAT = new THREE.MeshStandardMaterial({
  color: '#2C3340',
  roughness: 0.85,
});

// Shared module-level smooth & pre-merged geometries so 33 avatars share exact GPU buffers with minimal draw calls!
const SHARED_GEO = (() => {
  // Hair cap + bangs + side locks merged
  const hCap = new THREE.SphereGeometry(0.176, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  hCap.rotateX(-0.18);
  hCap.translate(0, 0.012, -0.006);
  const bL = new THREE.CapsuleGeometry(0.038, 0.065, 4, 6);
  bL.rotateZ(0.35);
  bL.rotateX(0.35);
  bL.translate(-0.045, 0.088, 0.142);
  const bR = new THREE.CapsuleGeometry(0.038, 0.065, 4, 6);
  bR.rotateZ(-0.28);
  bR.rotateX(0.35);
  bR.translate(0.032, 0.092, 0.145);
  const sL = new THREE.CapsuleGeometry(0.032, 0.095, 4, 6);
  sL.rotateZ(0.12);
  sL.rotateX(0.12);
  sL.translate(-0.148, -0.015, 0.045);
  const sR = new THREE.CapsuleGeometry(0.032, 0.095, 4, 6);
  sR.rotateZ(-0.12);
  sR.rotateX(0.12);
  sR.translate(0.148, -0.015, 0.045);
  const hairFull = stripUvAndMerge([hCap, bL, bR, sL, sR]);

  // 4 Trench coat brass buttons merged
  const btns: THREE.BufferGeometry[] = [];
  for (const bx of [-0.045, 0.045]) {
    for (const [by, bz] of [[0.09, 0.168], [-0.01, 0.166]] as const) {
      const b = new THREE.CylinderGeometry(0.013, 0.013, 0.008, 7);
      b.rotateX(Math.PI / 2);
      b.translate(bx, by, bz);
      btns.push(b);
    }
  }
  const trenchButtons = stripUvAndMerge(btns);

  // 3 Puffer vest quilted rings merged
  const pRings = [-0.14, -0.02, 0.1].map((py, idx) => {
    const r = new THREE.TorusGeometry(0.195, 0.044, 7, 14);
    r.rotateX(Math.PI / 2);
    r.scale(1.02 - idx * 0.03, 1.15, 0.86);
    r.translate(0, py, 0);
    return r;
  });
  const pufferRings = stripUvAndMerge(pRings);

  // Paired facial features
  const cL = new THREE.SphereGeometry(0.028, 7, 6);
  cL.scale(1.25, 0.78, 0.45);
  cL.translate(-0.078, -0.026, 0.138);
  const cR = new THREE.SphereGeometry(0.028, 7, 6);
  cR.scale(1.25, 0.78, 0.45);
  cR.translate(0.078, -0.026, 0.138);
  const cheeksPair = stripUvAndMerge([cL, cR]);

  const eL = new THREE.SphereGeometry(0.018, 7, 6);
  eL.scale(0.95, 1.18, 0.65);
  eL.translate(-0.054, 0, 0);
  const eR = new THREE.SphereGeometry(0.018, 7, 6);
  eR.scale(0.95, 1.18, 0.65);
  eR.translate(0.054, 0, 0);
  const eyesPair = stripUvAndMerge([eL, eR]);

  const ecL = new THREE.SphereGeometry(0.0065, 5, 5);
  ecL.translate(-0.048, 0.007, 0.012);
  const ecR = new THREE.SphereGeometry(0.0065, 5, 5);
  ecR.translate(0.06, 0.007, 0.012);
  const eyeCatchesPair = stripUvAndMerge([ecL, ecR]);

  const eyesWithCatch = mergePaintedParts([
    paintGeometry(eyesPair, '#1C1618'),
    paintGeometry(eyeCatchesPair, '#FFFFFF'),
  ]);

  // Beanie dome + cuff merged
  const bDome = new THREE.SphereGeometry(0.182, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.56);
  const bCuff = new THREE.TorusGeometry(0.172, 0.034, 7, 14);
  bCuff.rotateX(Math.PI / 2);
  bCuff.translate(0, 0.022, 0);
  const beanieCombined = stripUvAndMerge([bDome, bCuff]);

  // Backpack full assembly (canvas pack + leather flap + rolled mat + straps = 1 draw call!)
  const pBody = new THREE.CapsuleGeometry(0.125, 0.16, 6, 10);
  pBody.scale(1.08, 1, 0.78);
  const pPock = new THREE.CapsuleGeometry(0.052, 0.07, 4, 8);
  pPock.scale(1.4, 1, 0.65);
  pPock.translate(0, -0.04, -0.085);
  const packCombined = stripUvAndMerge([pBody, pPock]);

  const st1 = new THREE.TorusGeometry(0.054, 0.008, 5, 10);
  st1.rotateX(Math.PI / 2);
  st1.translate(0, -0.085, 0);
  const st2 = new THREE.TorusGeometry(0.054, 0.008, 5, 10);
  st2.rotateX(Math.PI / 2);
  st2.translate(0, 0.085, 0);
  const sleepStrapsPair = stripUvAndMerge([st1, st2]);

  const packFlap = new THREE.SphereGeometry(0.128, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const sleepMat = new THREE.CylinderGeometry(0.052, 0.052, 0.31, 10);

  const packParent = buildLocalMatrix([0, 0.05, -0.215], [0, 0, 0], [1, 1, 1], new THREE.Matrix4());
  const rollLocal = buildLocalMatrix([0, 0.195, -0.01], [0, 0, Math.PI / 2], [1, 1, 1], new THREE.Matrix4());
  const rollWorld = packParent.clone().multiply(rollLocal);
  const flapWorld = packParent.clone().multiply(buildLocalMatrix([0, 0.075, 0], [0, 0, 0], [1.1, 0.72, 0.8], new THREE.Matrix4()));

  const backpackTorsoSpace = mergePaintedParts([
    paintGeometry(packCombined, '#6E6652', packParent),
    paintGeometry(packFlap, '#6A4129', flapWorld),
    paintGeometry(sleepMat, '#C97B4B', rollWorld),
    paintGeometry(sleepStrapsPair, '#6A4129', rollWorld),
  ]);

  // Lower leg + trekking boot + sole merged into 1 single draw call per leg!
  const calf = new THREE.CapsuleGeometry(0.058, 0.23, 5, 8);
  const boot = new THREE.CapsuleGeometry(0.066, 0.095, 5, 8);
  const bootSole = new THREE.CylinderGeometry(0.068, 0.072, 0.026, 8);
  const lowerLegFull = mergePaintedParts([
    paintGeometry(calf, '#2C3340', buildLocalMatrix([0, -0.15, 0])),
    paintGeometry(boot, '#593A27', buildLocalMatrix([0, -0.34, 0.03], [Math.PI / 2, 0, 0])),
    paintGeometry(bootSole, '#221C1A', buildLocalMatrix([0, -0.392, 0.03], [0, 0, 0], [0.92, 1, 1.38])),
  ]);

  // Phin core (milk + coffee + silver phin filter = 1 draw call!)
  const phPlate = new THREE.CylinderGeometry(0.052, 0.052, 0.006, 10);
  phPlate.translate(0, 0.048, 0);
  const phChamber = new THREE.CylinderGeometry(0.038, 0.036, 0.052, 10);
  phChamber.translate(0, 0.076, 0);
  const phLid = new THREE.CylinderGeometry(0.041, 0.04, 0.008, 10);
  phLid.translate(0, 0.104, 0);
  const phinSilverCombined = stripUvAndMerge([phPlate, phChamber, phLid]);
  const phinMilkLayer = new THREE.CylinderGeometry(0.033, 0.031, 0.022, 10);
  const phinCoffeeLiquid = new THREE.CylinderGeometry(0.037, 0.033, 0.056, 10);
  const phinCoreFull = mergePaintedParts([
    paintGeometry(phinMilkLayer, '#FCF3D9', buildLocalMatrix([0, -0.028, 0])),
    paintGeometry(phinCoffeeLiquid, '#2B160E', buildLocalMatrix([0, 0.004, 0])),
    paintGeometry(phinSilverCombined, '#D5DCE4'),
  ]);

  // Acoustic Guitar merged into 1 single draw call!
  const gLow = new THREE.CylinderGeometry(0.135, 0.135, 0.068, 12);
  gLow.rotateX(Math.PI / 2);
  gLow.scale(1, 1, 0.92);
  gLow.translate(0, -0.09, 0);
  const gUp = new THREE.CylinderGeometry(0.098, 0.098, 0.066, 12);
  gUp.rotateX(Math.PI / 2);
  gUp.scale(1, 1, 0.92);
  gUp.translate(0, 0.05, 0);
  const guitarSpruceCombined = stripUvAndMerge([gLow, gUp]);

  const gHole = new THREE.CylinderGeometry(0.042, 0.042, 0.071, 10);
  gHole.rotateX(Math.PI / 2);
  gHole.translate(0, 0.01, 0.002);
  const gNeck = new THREE.BoxGeometry(0.034, 0.34, 0.022);
  gNeck.translate(0, 0.28, 0.01);
  const gHead = new THREE.BoxGeometry(0.046, 0.085, 0.018);
  gHead.rotateX(-0.14);
  gHead.translate(0, 0.47, 0.004);
  const guitarMahoganyCombined = stripUvAndMerge([gHole, gNeck, gHead]);
  const guitarFull = mergePaintedParts([
    paintGeometry(guitarSpruceCombined, '#CA8E52'),
    paintGeometry(guitarMahoganyCombined, '#4B2818'),
  ]);

  // 35mm Analog Film Camera merged into 1 single draw call!
  const cameraBody = new THREE.CapsuleGeometry(0.038, 0.095, 5, 8);
  const cameraLens = new THREE.CylinderGeometry(0.032, 0.035, 0.042, 10);
  const cameraGlass = new THREE.CylinderGeometry(0.026, 0.026, 0.006, 10);
  const cameraFull = mergePaintedParts([
    paintGeometry(cameraBody, '#1E2128', buildLocalMatrix([0, 0, 0], [0, 0, 0], [0.72, 1, 1.05])),
    paintGeometry(cameraBody, '#D5DCE4', buildLocalMatrix([0.018, 0, 0], [0, 0, 0], [0.32, 1.01, 1.06])),
    paintGeometry(cameraLens, '#D5DCE4', buildLocalMatrix([0, 0, 0.048], [Math.PI / 2, 0, 0])),
    paintGeometry(cameraGlass, '#1C1618', buildLocalMatrix([0, 0, 0.07], [Math.PI / 2, 0, 0])),
  ]);

  // Brass Lantern Frame merged into 1 single draw call!
  const lanternBase = new THREE.CylinderGeometry(0.052, 0.062, 0.038, 10);
  const lanternCap = new THREE.ConeGeometry(0.062, 0.042, 10);
  const lanternHandle = new THREE.TorusGeometry(0.068, 0.005, 5, 10, Math.PI);
  const lanternBrassFull = mergePaintedParts([
    paintGeometry(lanternHandle, '#D8A24A', buildLocalMatrix([0, 0.04, 0])),
    paintGeometry(lanternCap, '#D8A24A', buildLocalMatrix([0, 0.032, 0])),
    paintGeometry(lanternBase, '#D8A24A', buildLocalMatrix([0, -0.068, 0])),
  ]);

  return {
    trenchBody: makeLathe(
      [
        [0.01, -0.42],
        [0.255, -0.42],
        [0.245, -0.30],
        [0.205, -0.12],
        [0.185, 0.04],
        [0.205, 0.20],
        [0.165, 0.28],
        [0.01, 0.28],
      ],
      14
    ),
    sweaterBody: makeLathe(
      [
        [0.01, -0.25],
        [0.205, -0.25],
        [0.228, -0.14],
        [0.232, 0.04],
        [0.215, 0.20],
        [0.165, 0.28],
        [0.01, 0.28],
      ],
      14
    ),
    ponchoBody: makeLathe(
      [
        [0.01, -0.32],
        [0.315, -0.30],
        [0.295, -0.14],
        [0.255, 0.06],
        [0.215, 0.22],
        [0.16, 0.285],
        [0.01, 0.285],
      ],
      14
    ),
    beret: makeLathe(
      [
        [0.135, -0.015],
        [0.182, 0.012],
        [0.192, 0.038],
        [0.155, 0.068],
        [0.075, 0.082],
        [0.001, 0.086],
      ],
      12
    ),
    head: new THREE.SphereGeometry(0.168, 14, 12),
    hairFull,
    trenchButtons,
    pufferRings,
    cheeksPair,
    eyesWithCatch,
    beanieCombined,
    backpackTorsoSpace,
    lowerLegFull,
    phinCoreFull,
    guitarFull,
    cameraFull,
    lanternBrassFull,
    nose: new THREE.SphereGeometry(0.015, 6, 6),
    pomPom: new THREE.SphereGeometry(0.048, 8, 8),
    scarfLoop: new THREE.TorusGeometry(0.148, 0.046, 8, 14),
    scarfLoopUpper: new THREE.TorusGeometry(0.136, 0.038, 7, 12),
    scarfTail: new THREE.CapsuleGeometry(0.036, 0.21, 4, 8),
    belt: new THREE.TorusGeometry(0.192, 0.016, 6, 14),
    button: new THREE.CylinderGeometry(0.013, 0.013, 0.008, 7),
    upperLimb: new THREE.CapsuleGeometry(0.056, 0.21, 5, 8),
    lowerArm: new THREE.CapsuleGeometry(0.048, 0.17, 5, 8),
    mitten: new THREE.SphereGeometry(0.052, 8, 6),
    thigh: new THREE.CapsuleGeometry(0.068, 0.24, 5, 8),
    soyGlass: new THREE.CylinderGeometry(0.042, 0.035, 0.108, 10),
    soyLiquid: new THREE.CylinderGeometry(0.038, 0.032, 0.088, 10),
    phinCup: new THREE.CylinderGeometry(0.041, 0.035, 0.092, 10),
    lanternGlobe: new THREE.SphereGeometry(0.056, 8, 8),
    lanternHalo: new THREE.SphereGeometry(0.115, 8, 8),
    vaporPuff: new THREE.SphereGeometry(0.028, 6, 6),
    shadowBlob: new THREE.CircleGeometry(0.38, 14),
  };
})();

interface OutfitBakedAssemblies {
  torsoAssembly: THREE.BufferGeometry;
  headAssembly: THREE.BufferGeometry;
  foreArmAssembly: THREE.BufferGeometry;
}

const OUTFIT_ASSEMBLY_CACHE = new Map<string, OutfitBakedAssemblies>();

function getOutfitBakedAssemblies(outfit: PlayerOutfit): OutfitBakedAssemblies {
  const key = `${outfit.coatStyle}|${outfit.coatColor}|${outfit.scarfColor}|${outfit.headwear}|${outfit.hairColor}|${outfit.backpack ? 1 : 0}`;
  const cached = OUTFIT_ASSEMBLY_CACHE.get(key);
  if (cached) return cached;

  const coatCol = new THREE.Color(outfit.coatColor);
  const trimCol = new THREE.Color(outfit.coatColor).offsetHSL(0, -0.05, -0.12);
  const scarfCol = new THREE.Color(outfit.scarfColor);
  const hairCol = new THREE.Color(outfit.hairColor);
  const creamCol = '#EAE0D0';

  // 1. Merged Torso Assembly (Coat + Belt/Buttons + Scarf Loop + Optional Backpack = 1 single draw call!)
  const torsoParts: THREE.BufferGeometry[] = [];
  if (outfit.coatStyle === 'wool_trench') {
    torsoParts.push(paintGeometry(SHARED_GEO.trenchBody, coatCol, buildLocalMatrix([0, 0, 0], [0, 0, 0], [1.04, 1, 0.86])));
    torsoParts.push(paintGeometry(SHARED_GEO.belt, trimCol, buildLocalMatrix([0, -0.06, 0], [Math.PI / 2, 0, 0], [1.04, 0.86, 1])));
    torsoParts.push(paintGeometry(SHARED_GEO.trenchButtons, '#D8A24A'));
  } else if (outfit.coatStyle === 'knit_sweater') {
    torsoParts.push(paintGeometry(SHARED_GEO.sweaterBody, coatCol, buildLocalMatrix([0, 0, 0], [0, 0, 0], [1.05, 1, 0.88])));
    torsoParts.push(paintGeometry(SHARED_GEO.belt, trimCol, buildLocalMatrix([0, -0.23, 0], [Math.PI / 2, 0, 0], [1.06, 0.88, 1.4])));
  } else if (outfit.coatStyle === 'puffer_vest') {
    torsoParts.push(paintGeometry(SHARED_GEO.sweaterBody, creamCol, buildLocalMatrix([0, 0, 0], [0, 0, 0], [1.0, 1, 0.84])));
    torsoParts.push(paintGeometry(SHARED_GEO.pufferRings, coatCol));
  } else {
    torsoParts.push(paintGeometry(SHARED_GEO.ponchoBody, coatCol, buildLocalMatrix([0, 0, 0], [0, 0, 0], [1.06, 1, 0.88])));
  }

  const scarfRoot = buildLocalMatrix([0, 0.295, 0.01], [0, 0, 0], [1, 1, 1], new THREE.Matrix4());
  const loopMat4 = scarfRoot.clone().multiply(buildLocalMatrix([0, 0, 0], [Math.PI / 2 + 0.08, 0, 0], [1.02, 0.96, 1.05], new THREE.Matrix4()));
  torsoParts.push(paintGeometry(SHARED_GEO.scarfLoop, scarfCol, loopMat4));
  if (outfit.headwear === 'scarf_only') {
    const upperMat4 = scarfRoot.clone().multiply(buildLocalMatrix([0, 0.048, 0.005], [Math.PI / 2 - 0.05, 0, 0], [1, 1, 1], new THREE.Matrix4()));
    torsoParts.push(paintGeometry(SHARED_GEO.scarfLoopUpper, scarfCol, upperMat4));
  }

  if (outfit.backpack) {
    torsoParts.push(SHARED_GEO.backpackTorsoSpace.clone());
  }
  const torsoAssembly = mergePaintedParts(torsoParts);

  // 2. Merged Head Assembly (Head + Rosy Nose + Blush Cheeks + Layered Hair + Beanie/Beret = 1 single draw call!)
  const headParts: THREE.BufferGeometry[] = [
    paintGeometry(SHARED_GEO.head, '#F5D6BF', buildLocalMatrix([0, 0, 0], [0, 0, 0], [0.97, 1.03, 0.96])),
    paintGeometry(SHARED_GEO.nose, '#ECB59A', buildLocalMatrix([0, -0.012, 0.162], [0, 0, 0], [0.9, 0.8, 1.1])),
    paintGeometry(SHARED_GEO.cheeksPair, '#EC9890'),
    paintGeometry(SHARED_GEO.hairFull, hairCol),
  ];

  if (outfit.headwear === 'beanie') {
    const beanieRoot = buildLocalMatrix([0, 0.052, -0.012], [-0.14, 0, 0], [1, 1, 1], new THREE.Matrix4());
    const pomMat4 = beanieRoot.clone().multiply(buildLocalMatrix([0, 0.195, -0.01], [0, 0, 0], [1, 1, 1], new THREE.Matrix4()));
    headParts.push(paintGeometry(SHARED_GEO.beanieCombined, scarfCol, beanieRoot));
    headParts.push(paintGeometry(SHARED_GEO.pomPom, creamCol, pomMat4));
  } else if (outfit.headwear === 'beret') {
    const beretRoot = buildLocalMatrix([0.028, 0.128, -0.008], [-0.08, 0.1, -0.24], [1, 1, 1], new THREE.Matrix4());
    const stemMat4 = beretRoot.clone().multiply(buildLocalMatrix([0, 0.088, 0], [0, 0, 0], [0.45, 2.2, 0.45], new THREE.Matrix4()));
    headParts.push(paintGeometry(SHARED_GEO.beret, coatCol, beretRoot));
    headParts.push(paintGeometry(SHARED_GEO.button, trimCol, stemMat4));
  }
  const headAssembly = mergePaintedParts(headParts);

  // 3. Merged Forearm + Mitten Assembly (1 single draw call per arm!)
  const sleeveCol = outfit.coatStyle === 'puffer_vest' ? creamCol : coatCol;
  const foreArmAssembly = mergePaintedParts([
    paintGeometry(SHARED_GEO.lowerArm, sleeveCol, buildLocalMatrix([0, -0.10, 0])),
    paintGeometry(SHARED_GEO.mitten, '#F5D6BF', buildLocalMatrix([0, -0.215, 0.01], [0, 0, 0], [0.88, 1.0, 0.95])),
  ]);

  const built: OutfitBakedAssemblies = { torsoAssembly, headAssembly, foreArmAssembly };
  if (OUTFIT_ASSEMBLY_CACHE.size > 48) {
    const oldestKey = OUTFIT_ASSEMBLY_CACHE.keys().next().value;
    if (oldestKey) {
      const old = OUTFIT_ASSEMBLY_CACHE.get(oldestKey);
      old?.torsoAssembly.dispose();
      old?.headAssembly.dispose();
      old?.foreArmAssembly.dispose();
      OUTFIT_ASSEMBLY_CACHE.delete(oldestKey);
    }
  }
  OUTFIT_ASSEMBLY_CACHE.set(key, built);
  return built;
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function HighlandAvatar({
  outfit,
  heldItem,
  isLocal = false,
  seed = 0.37,
  getMotion,
}: HighlandAvatarProps) {
  const pelvisRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const eyesBlinkRef = useRef<THREE.Group>(null);
  const scarfTailFrontRef = useRef<THREE.Mesh>(null);
  const scarfTailBackRef = useRef<THREE.Mesh>(null);

  const armLRef = useRef<THREE.Group>(null);
  const foreArmLRef = useRef<THREE.Group>(null);
  const armRRef = useRef<THREE.Group>(null);
  const foreArmRRef = useRef<THREE.Group>(null);

  const legLRef = useRef<THREE.Group>(null);
  const calfLRef = useRef<THREE.Group>(null);
  const legRRef = useRef<THREE.Group>(null);
  const calfRRef = useRef<THREE.Group>(null);

  const guitarTorsoRef = useRef<THREE.Group>(null);
  const steam1Ref = useRef<THREE.Mesh>(null);
  const steam2Ref = useRef<THREE.Mesh>(null);
  const steam3Ref = useRef<THREE.Mesh>(null);
  const breath1Ref = useRef<THREE.Mesh>(null);
  const breath2Ref = useRef<THREE.Mesh>(null);
  const shadowRef = useRef<THREE.Mesh>(null);

  // Per-instance smooth animation state (0 GC in useFrame!)
  const animState = useRef({
    walkPhase: seed * Math.PI * 2,
    idleClock: seed * 17.3,
    blinkTimer: 1.8 + (seed % 1) * 2.5,
    blinkProgress: 0,
    breathCycle: (seed * 3.2) % 3.2,
    pelvisY: 0.78,
    pelvisZ: 0,
    torsoPitch: 0,
    torsoRoll: 0,
    torsoYaw: 0,
    headPitch: 0,
    headYaw: 0,
    armLPitch: 0,
    armLRoll: 0.1,
    foreLPitch: -0.18,
    armRPitch: 0,
    armRRoll: -0.1,
    foreRPitch: -0.18,
    legLPitch: 0,
    calfLPitch: 0,
    legRPitch: 0,
    calfRPitch: 0,
  });

  const outfitAssemblies = useMemo(
    () => getOutfitBakedAssemblies(outfit),
    [outfit.coatStyle, outfit.coatColor, outfit.scarfColor, outfit.headwear, outfit.hairColor, outfit.backpack]
  );

  // Painterly highland PBR materials memoized by color palette (shared vertex-color PBR handles 80% of parts!)
  const mats = useMemo(() => {
    const coatMat = new THREE.MeshStandardMaterial({
      color: outfit.coatColor,
      roughness: 0.86,
      metalness: 0.02,
    });
    const underSweaterMat = new THREE.MeshStandardMaterial({
      color: '#EAE0D0',
      roughness: 0.9,
      metalness: 0.01,
    });
    const scarfMat = new THREE.MeshStandardMaterial({
      color: outfit.scarfColor,
      roughness: 0.92,
      metalness: 0.01,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#E6F2F8',
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.52,
    });
    const soyMat = new THREE.MeshStandardMaterial({
      color: '#FCF3D9',
      roughness: 0.45,
      emissive: '#FFF2CC',
      emissiveIntensity: 0.18,
    });
    const lanternGlowMat = new THREE.MeshStandardMaterial({
      color: '#FFD28A',
      emissive: '#FFA938',
      emissiveIntensity: 2.5,
      roughness: 0.2,
    });
    const lanternHaloMat = new THREE.MeshBasicMaterial({
      color: '#FFB347',
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    const vaporMat1 = new THREE.MeshBasicMaterial({
      color: '#F6FAFF',
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const vaporMat2 = new THREE.MeshBasicMaterial({
      color: '#F6FAFF',
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const steamMat = new THREE.MeshBasicMaterial({
      color: '#FFFDF8',
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const shadowMat = new THREE.MeshBasicMaterial({
      color: '#0D1320',
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });

    return {
      coatMat,
      underSweaterMat,
      scarfMat,
      glassMat,
      soyMat,
      lanternGlowMat,
      lanternHaloMat,
      vaporMat1,
      vaporMat2,
      steamMat,
      shadowMat,
    };
  }, [outfit.coatColor, outfit.scarfColor]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.06);
    const m = getMotion();
    const s = animState.current;
    s.idleClock += dt;

    // 1. Natural Eye Blink
    s.blinkTimer -= dt;
    if (s.blinkTimer <= 0) {
      s.blinkProgress += dt * 11.0;
      if (s.blinkProgress >= Math.PI) {
        s.blinkProgress = 0;
        s.blinkTimer = 2.6 + ((Math.sin(s.idleClock * 3.7) * 0.5 + 0.5) * 3.1);
      }
    }
    if (eyesBlinkRef.current) {
      const blinkScale = s.blinkProgress > 0 ? Math.max(0.08, 1 - Math.sin(s.blinkProgress) * 0.95) : 1;
      eyesBlinkRef.current.scale.y = blinkScale;
    }

    // 2. Locomotion & Posture Targets
    const isSeated = m.seated || m.emote === 'sit_chill';
    const isPlayingGuitar =
      m.emote === 'play_guitar' ||
      (heldItem === 'guitar' && !m.moving && (m.jamPulse ?? 0) > 0.05);

    const freq = m.running ? 9.6 : 6.4;
    if (m.moving && !isSeated) {
      s.walkPhase += dt * freq * Math.max(0.55, Math.min(1.35, m.speed / (m.running ? 5.2 : 2.8)));
    }

    const strideAmp = !m.moving || isSeated ? 0 : m.running ? 0.68 : 0.42;
    const bounceY = !m.moving || isSeated ? 0 : Math.abs(Math.sin(s.walkPhase * 2)) * (m.running ? 0.048 : 0.026);
    const breathe = Math.sin(s.idleClock * 2.1) * 0.012;

    let targetPelvisY = isSeated ? 0.49 : 0.78 + bounceY;
    let targetPelvisZ = isSeated ? 0.06 : 0;
    let targetTorsoPitch = isSeated ? -0.05 : m.moving ? (m.running ? 0.14 : 0.05) : breathe;
    let targetTorsoRoll = m.moving && !isSeated ? Math.sin(s.walkPhase) * 0.035 : 0;
    let targetTorsoYaw = m.moving && !isSeated ? -Math.sin(s.walkPhase) * 0.06 : 0;
    let targetHeadPitch = Math.sin(s.idleClock * 1.1) * 0.025;
    let targetHeadYaw = Math.sin(s.idleClock * 0.65) * 0.06;

    // Leg targets
    let targetLegL = isSeated ? -1.42 : Math.sin(s.walkPhase) * strideAmp;
    let targetLegR = isSeated ? -1.42 : -Math.sin(s.walkPhase) * strideAmp;
    let targetCalfL = isSeated
      ? 1.38 + Math.sin(s.idleClock * 1.8) * 0.06
      : Math.max(0, -Math.cos(s.walkPhase) * strideAmp * 0.85);
    let targetCalfR = isSeated
      ? 1.38 - Math.sin(s.idleClock * 1.8) * 0.06
      : Math.max(0, Math.cos(s.walkPhase) * strideAmp * 0.85);

    if (!m.grounded && !isSeated) {
      targetLegL = -0.38;
      targetLegR = 0.24;
      targetCalfL = 0.55;
      targetCalfR = 0.35;
    }

    // Default Arm targets (gentle swing, stabilized right hand when holding hot cup or lantern!)
    const carryingSteadyProp =
      heldItem === 'soy_milk' || heldItem === 'phin_coffee' || heldItem === 'lantern';

    let targetArmLPitch = isSeated ? -0.22 : -Math.sin(s.walkPhase) * strideAmp * 0.75;
    let targetArmLRoll = 0.1;
    let targetForeLPitch = isSeated ? -0.45 : m.running ? -0.58 : -0.22;

    let targetArmRPitch = carryingSteadyProp
      ? -0.46 + Math.sin(s.idleClock * 2.0) * 0.025
      : isSeated
        ? -0.22
        : Math.sin(s.walkPhase) * strideAmp * 0.75;
    let targetArmRRoll = carryingSteadyProp ? -0.14 : -0.1;
    let targetForeRPitch = carryingSteadyProp
      ? -0.92
      : heldItem === 'film_camera'
        ? -0.52
        : isSeated
          ? -0.45
          : m.running
            ? -0.58
            : -0.22;

    // 3. Expressive Highland Emotes!
    if (m.emote === 'wave') {
      targetArmRPitch = -2.35;
      targetArmRRoll = -0.35 + Math.sin(s.idleClock * 8.5) * 0.28;
      targetForeRPitch = -0.35 + Math.sin(s.idleClock * 8.5) * 0.22;
      targetHeadYaw = -0.12;
    } else if (m.emote === 'warm_hands') {
      const rub = Math.sin(s.idleClock * 12.0) * 0.09;
      targetArmLPitch = -0.92 + rub;
      targetArmLRoll = -0.28;
      targetForeLPitch = -1.25;
      targetArmRPitch = -0.92 - rub;
      targetArmRRoll = 0.28;
      targetForeRPitch = -1.25;
      targetHeadPitch = 0.16;
    } else if (m.emote === 'sip_drink') {
      targetArmRPitch = -1.12;
      targetArmRRoll = 0.22;
      targetForeRPitch = -1.32;
      targetHeadPitch = -0.14;
    } else if (m.emote === 'cheers_cup') {
      targetArmRPitch = -1.48 + Math.sin(s.idleClock * 5.0) * 0.08;
      targetArmRRoll = -0.12;
      targetForeRPitch = -0.65;
      targetHeadPitch = -0.1;
    } else if (m.emote === 'cheer_sunrise') {
      const joy = Math.sin(s.idleClock * 6.5) * 0.14;
      targetArmLPitch = -2.55 + joy;
      targetArmLRoll = 0.28;
      targetForeLPitch = -0.2;
      targetArmRPitch = -2.55 - joy;
      targetArmRRoll = -0.28;
      targetForeRPitch = -0.2;
      targetPelvisY += Math.abs(Math.sin(s.idleClock * 6.5)) * 0.05;
      targetHeadPitch = -0.18;
    } else if (m.emote === 'snap_photo') {
      targetArmRPitch = -1.32;
      targetArmRRoll = 0.24;
      targetForeRPitch = -1.18;
      targetArmLPitch = -1.18;
      targetArmLRoll = -0.24;
      targetForeLPitch = -1.12;
      targetHeadPitch = -0.04;
    } else if (isPlayingGuitar) {
      const jamEnergy = 1 + (m.jamPulse ?? 0) * 1.6;
      const strum = Math.sin(s.idleClock * 9.5) * 0.22 * jamEnergy;
      targetTorsoRoll = Math.sin(s.idleClock * 2.4) * 0.05;
      targetHeadPitch = 0.1 + Math.sin(s.idleClock * 4.8) * 0.04;
      // Left hand frets guitar neck, right hand strums across soundhole!
      targetArmLPitch = -0.68;
      targetArmLRoll = 0.26;
      targetForeLPitch = -0.95;
      targetArmRPitch = -0.58 + strum * 0.35;
      targetArmRRoll = -0.18;
      targetForeRPitch = -1.05 + strum;
    }

    // Smooth exponential damping across all joints
    const k = 14;
    s.pelvisY = damp(s.pelvisY, targetPelvisY, k, dt);
    s.pelvisZ = damp(s.pelvisZ, targetPelvisZ, k, dt);
    s.torsoPitch = damp(s.torsoPitch, targetTorsoPitch, k, dt);
    s.torsoRoll = damp(s.torsoRoll, targetTorsoRoll, k, dt);
    s.torsoYaw = damp(s.torsoYaw, targetTorsoYaw, k, dt);
    s.headPitch = damp(s.headPitch, targetHeadPitch, 10, dt);
    s.headYaw = damp(s.headYaw, targetHeadYaw, 8, dt);

    s.armLPitch = damp(s.armLPitch, targetArmLPitch, k, dt);
    s.armLRoll = damp(s.armLRoll, targetArmLRoll, k, dt);
    s.foreLPitch = damp(s.foreLPitch, targetForeLPitch, k, dt);
    s.armRPitch = damp(s.armRPitch, targetArmRPitch, k, dt);
    s.armRRoll = damp(s.armRRoll, targetArmRRoll, k, dt);
    s.foreRPitch = damp(s.foreRPitch, targetForeRPitch, k, dt);

    s.legLPitch = damp(s.legLPitch, targetLegL, k, dt);
    s.calfLPitch = damp(s.calfLPitch, targetCalfL, k, dt);
    s.legRPitch = damp(s.legRPitch, targetLegR, k, dt);
    s.calfRPitch = damp(s.calfRPitch, targetCalfR, k, dt);

    if (pelvisRef.current) {
      pelvisRef.current.position.set(0, s.pelvisY, s.pelvisZ);
    }
    if (torsoRef.current) {
      torsoRef.current.rotation.set(s.torsoPitch, s.torsoYaw, s.torsoRoll);
    }
    if (headRef.current) {
      headRef.current.rotation.set(s.headPitch, s.headYaw, 0);
    }
    if (armLRef.current) {
      armLRef.current.rotation.set(s.armLPitch, 0, s.armLRoll);
    }
    if (foreArmLRef.current) {
      foreArmLRef.current.rotation.x = s.foreLPitch;
    }
    if (armRRef.current) {
      armRRef.current.rotation.set(s.armRPitch, 0, s.armRRoll);
    }
    if (foreArmRRef.current) {
      foreArmRRef.current.rotation.x = s.foreRPitch;
    }
    if (legLRef.current) {
      legLRef.current.rotation.x = s.legLPitch;
    }
    if (calfLRef.current) {
      calfLRef.current.rotation.x = s.calfLPitch;
    }
    if (legRRef.current) {
      legRRef.current.rotation.x = s.legRPitch;
    }
    if (calfRRef.current) {
      calfRRef.current.rotation.x = s.calfRPitch;
    }

    // Scarf tail wind & stride flutter
    const windSway = Math.sin(s.idleClock * 2.8 + seed * 5) * 0.08 * m.windStrength;
    if (scarfTailFrontRef.current) {
      scarfTailFrontRef.current.rotation.z = 0.08 + windSway;
      scarfTailFrontRef.current.rotation.x = -0.14 - (m.moving ? 0.08 : 0);
    }
    if (scarfTailBackRef.current) {
      scarfTailBackRef.current.rotation.z = -0.08 - windSway * 1.2;
      scarfTailBackRef.current.rotation.x = 0.22 + (m.moving ? (m.running ? 0.36 : 0.18) : 0);
    }

    // Toggle guitar torso vs hand-carry smoothly
    if (guitarTorsoRef.current) {
      guitarTorsoRef.current.visible = heldItem === 'guitar';
      if (heldItem === 'guitar') {
        if (isPlayingGuitar) {
          guitarTorsoRef.current.position.set(0.02, 0.14, 0.24);
          guitarTorsoRef.current.rotation.set(-0.12, 0.15, -1.12);
        } else {
          // Comfortable slung side/back acoustic carry when walking!
          guitarTorsoRef.current.position.set(0.18, 0.16, -0.16);
          guitarTorsoRef.current.rotation.set(0.24, -0.45, -0.58);
        }
      }
    }

    // 4. Rising Hot Drink Steam Wisps (soy_milk & phin_coffee)
    const hasHotSteam = heldItem === 'soy_milk' || heldItem === 'phin_coffee';
    const steamMeshes = [steam1Ref.current, steam2Ref.current, steam3Ref.current];
    for (let i = 0; i < 3; i++) {
      const sm = steamMeshes[i];
      if (!sm) continue;
      sm.visible = hasHotSteam;
      if (hasHotSteam) {
        const u = ((s.idleClock * 0.65 + i * 0.33) % 1 + 1) % 1;
        sm.position.set(
          Math.sin(s.idleClock * 2.4 + i * 2.1) * 0.018,
          0.075 + u * 0.16,
          Math.cos(s.idleClock * 1.9 + i) * 0.014
        );
        const sc = (0.35 + u * 0.85) * Math.sin(u * Math.PI);
        sm.scale.setScalar(Math.max(0.001, sc));
      }
    }

    // 5. Cold Highland Breath Vapor Puffs (< 13.5°C and not warm-buffed, every 3.2s!)
    const emitColdBreath = m.temperatureC < 13.5 && !m.warmBuff;
    s.breathCycle = (s.breathCycle + dt) % 3.2;
    const breathActive = emitColdBreath && s.breathCycle < 1.35;
    const puffs = [breath1Ref.current, breath2Ref.current];
    const puffMats = [mats.vaporMat1, mats.vaporMat2];
    for (let i = 0; i < 2; i++) {
      const pf = puffs[i];
      if (!pf) continue;
      const delay = i * 0.16;
      const age = s.breathCycle - delay;
      if (breathActive && age > 0 && age < 1.15) {
        const t = age / 1.15;
        pf.visible = true;
        pf.position.set(
          (i === 0 ? -0.012 : 0.014) + Math.sin(s.idleClock * 3 + i) * 0.018 * t,
          -0.055 + t * 0.095,
          0.185 + t * 0.21
        );
        pf.scale.setScalar(0.45 + t * 1.65);
        puffMats[i].opacity = Math.sin(t * Math.PI) * 0.44;
      } else {
        pf.visible = false;
      }
    }

    // Ground contact blob shadow subtle scale when jumping
    if (shadowRef.current) {
      shadowRef.current.scale.setScalar(m.grounded ? 1 : 0.72);
    }
  });

  return (
    <group>
      {/* Soft Ground Contact Shadow */}
      <mesh
        ref={shadowRef}
        geometry={SHARED_GEO.shadowBlob}
        material={mats.shadowMat}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
      />

      {/* Pelvis Root (~0.78m standing) */}
      <group ref={pelvisRef} position={[0, 0.78, 0]}>
        {/* Left Leg */}
        <group ref={legLRef} position={[-0.095, 0, 0]}>
          <mesh
            geometry={SHARED_GEO.thigh}
            material={SHARED_PANTS_MAT}
            position={[0, -0.16, 0]}
          />
          <group ref={calfLRef} position={[0, -0.33, 0]}>
            <mesh geometry={SHARED_GEO.lowerLegFull} material={SHARED_VERTEX_PBR_MAT} />
          </group>
        </group>

        {/* Right Leg */}
        <group ref={legRRef} position={[0.095, 0, 0]}>
          <mesh
            geometry={SHARED_GEO.thigh}
            material={SHARED_PANTS_MAT}
            position={[0, -0.16, 0]}
          />
          <group ref={calfRRef} position={[0, -0.33, 0]}>
            <mesh geometry={SHARED_GEO.lowerLegFull} material={SHARED_VERTEX_PBR_MAT} />
          </group>
        </group>

        {/* Articulated Torso + Merged Winter Coat + Scarf Loop + Optional Backpack (1 single draw call!) */}
        <group ref={torsoRef} position={[0, 0.24, 0]}>
          <mesh
            geometry={outfitAssemblies.torsoAssembly}
            material={SHARED_VERTEX_PBR_MAT}
            castShadow={isLocal}
            receiveShadow
          />

          {/* Wind-fluttering Knitted Scarf Tails */}
          <group position={[0, 0.295, 0.01]}>
            <mesh
              ref={scarfTailFrontRef}
              geometry={SHARED_GEO.scarfTail}
              material={mats.scarfMat}
              position={[0.068, -0.14, 0.145]}
            />
            <mesh
              ref={scarfTailBackRef}
              geometry={SHARED_GEO.scarfTail}
              material={mats.scarfMat}
              position={[-0.058, -0.13, -0.14]}
            />
          </group>

          {/* Spruce-Wood Acoustic Guitar (1 merged draw call) */}
          <group ref={guitarTorsoRef} visible={heldItem === 'guitar'}>
            <mesh geometry={SHARED_GEO.guitarFull} material={SHARED_VERTEX_PBR_MAT} />
          </group>

          {/* Left Arm */}
          <group ref={armLRef} position={[-0.225, 0.21, 0]}>
            <mesh
              geometry={SHARED_GEO.upperLimb}
              material={outfit.coatStyle === 'puffer_vest' ? mats.underSweaterMat : mats.coatMat}
              position={[0, -0.12, 0]}
            />
            <group ref={foreArmLRef} position={[0, -0.25, 0]}>
              <mesh geometry={outfitAssemblies.foreArmAssembly} material={SHARED_VERTEX_PBR_MAT} />
            </group>
          </group>

          {/* Right Arm + Held Da Lat Props */}
          <group ref={armRRef} position={[0.225, 0.21, 0]}>
            <mesh
              geometry={SHARED_GEO.upperLimb}
              material={outfit.coatStyle === 'puffer_vest' ? mats.underSweaterMat : mats.coatMat}
              position={[0, -0.12, 0]}
            />
            <group ref={foreArmRRef} position={[0, -0.25, 0]}>
              <mesh geometry={outfitAssemblies.foreArmAssembly} material={SHARED_VERTEX_PBR_MAT} />

              {/* Hand Attachment Socket */}
              <group position={[0, -0.225, 0.045]} rotation={[Math.PI / 2, 0, 0]}>
                {heldItem === 'soy_milk' && (
                  <group position={[0, 0.02, 0]}>
                    <mesh geometry={SHARED_GEO.soyLiquid} material={mats.soyMat} position={[0, -0.004, 0]} />
                    <mesh geometry={SHARED_GEO.soyGlass} material={mats.glassMat} />
                  </group>
                )}

                {heldItem === 'phin_coffee' && (
                  <group position={[0, 0.02, 0]}>
                    <mesh geometry={SHARED_GEO.phinCoreFull} material={SHARED_VERTEX_PBR_MAT} />
                    <mesh geometry={SHARED_GEO.phinCup} material={mats.glassMat} />
                  </group>
                )}

                <group position={[0, 0.04, 0]}>
                  <mesh ref={steam1Ref} geometry={SHARED_GEO.vaporPuff} material={mats.steamMat} visible={false} />
                  <mesh ref={steam2Ref} geometry={SHARED_GEO.vaporPuff} material={mats.steamMat} visible={false} />
                  <mesh ref={steam3Ref} geometry={SHARED_GEO.vaporPuff} material={mats.steamMat} visible={false} />
                </group>

                {heldItem === 'film_camera' && (
                  <group position={[-0.02, 0.02, 0]} rotation={[0, 0, Math.PI / 2]}>
                    <mesh geometry={SHARED_GEO.cameraFull} material={SHARED_VERTEX_PBR_MAT} />
                  </group>
                )}

                {heldItem === 'lantern' && (
                  <group position={[0, -0.09, 0.04]} rotation={[-Math.PI / 2, 0, 0]}>
                    <mesh geometry={SHARED_GEO.lanternBrassFull} material={SHARED_VERTEX_PBR_MAT} />
                    <mesh geometry={SHARED_GEO.lanternGlobe} material={mats.lanternGlowMat} position={[0, -0.018, 0]} />
                    <mesh geometry={SHARED_GEO.lanternHalo} material={mats.lanternHaloMat} position={[0, -0.018, 0]} />
                    {isLocal && (
                      <pointLight
                        color="#FFB347"
                        intensity={2.3}
                        distance={12}
                        decay={1.8}
                        position={[0, -0.02, 0.08]}
                      />
                    )}
                  </group>
                )}
              </group>
            </group>
          </group>

          {/* Expressive Stylized Head + Hair + Headwear (1 merged draw call + 1 blinking eye draw call!) */}
          <group ref={headRef} position={[0, 0.485, 0.01]}>
            <mesh
              geometry={outfitAssemblies.headAssembly}
              material={SHARED_VERTEX_PBR_MAT}
              castShadow={isLocal}
            />

            <group ref={eyesBlinkRef} position={[0, 0.016, 0.148]}>
              <mesh geometry={SHARED_GEO.eyesWithCatch} material={SHARED_VERTEX_PBR_MAT} />
            </group>

            <mesh ref={breath1Ref} geometry={SHARED_GEO.vaporPuff} material={mats.vaporMat1} visible={false} />
            <mesh ref={breath2Ref} geometry={SHARED_GEO.vaporPuff} material={mats.vaporMat2} visible={false} />
          </group>
        </group>
      </group>
    </group>
  );
}

/**
 * Convenience wrapper for the Local Player avatar inside GameplayRoot.
 */
export function LocalPlayerAvatar() {
  const outfit = useGameStore((s) => s.outfit);
  const heldItem = useGameStore((s) => s.heldItem);
  const photoModeActive = useGameStore((s) => s.photoModeActive);
  const groupRef = useRef<THREE.Group>(null);

  const motionSample = useRef<AvatarMotionSample>({
    moving: false,
    running: false,
    grounded: true,
    speed: 0,
    seated: false,
    emote: 'none',
    warmBuff: true,
    temperatureC: 11,
    windStrength: 0.5,
    jamPulse: 0,
  });

  useFrame(() => {
    const st = useGameStore.getState();
    const lt = st.localTransient;
    if (groupRef.current) {
      // Hide local avatar only if camera is directly inside head in first-person photo mode
      groupRef.current.visible = !st.photoModeActive;
      groupRef.current.position.set(lt.x, lt.y, lt.z);
      groupRef.current.rotation.y = lt.yaw;
    }

    const jamAge = st.lastJamNote ? (Date.now() - st.lastJamNote.timestamp) / 1000 : 99;
    const isMyJam =
      st.lastJamNote &&
      (st.lastJamNote.senderId === st.localSessionId || st.lastJamNote.senderId === 'local');

    const m = motionSample.current;
    m.moving = lt.moving;
    m.running = lt.running;
    m.grounded = lt.grounded;
    m.speed = Math.hypot(lt.vx, lt.vz);
    m.seated = Boolean(st.seatedBenchId);
    m.emote = st.activeEmote;
    m.warmBuff = st.warmthRemainingSec > 0;
    m.temperatureC = st.atmosphere.temperatureC;
    m.windStrength = st.atmosphere.windStrength;
    m.jamPulse = isMyJam && jamAge < 1.4 ? 1 - jamAge / 1.4 : 0;
  });

  // Also show local player's own proximity chat bubble cleanly if active
  return (
    <group ref={groupRef} visible={!photoModeActive}>
      <HighlandAvatar
        outfit={outfit}
        heldItem={heldItem}
        isLocal={true}
        seed={0.19}
        getMotion={() => motionSample.current}
      />
    </group>
  );
}
