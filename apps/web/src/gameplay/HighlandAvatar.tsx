import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { useFrame } from '@react-three/fiber';
import {
  EmoteId,
  ensureCoatMatchesGender,
  HeldItemId,
  isWarmEdibleOrDrinkProp,
  PlayerOutfit,
  resolveEffectiveBagStyle,
  resolveEffectiveEyewear,
  resolveEffectiveGender,
  resolveEffectiveNeckwear,
  sampleWalkableHeight,
} from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';
import {
  buildEyewearGroup,
  getCoatOverlayGeometry,
  getCustomBagGeometry,
  getCustomHeadwearGeometry,
  getCustomNeckwearGeometry,
  isMaleCoatStyle,
  resolveBaseGlbForCoat,
  SHARED_HELD_PROPS,
  SHARED_METALLIC_VCOLOR_MAT,
  SHARED_VCOLOR_MAT,
} from './WardrobeAssets3D';

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
  jamPulse?: number;
  turnBank?: number; // -1..1 subtle body roll into turns
}

export interface HighlandAvatarProps {
  outfit: PlayerOutfit;
  heldItem: HeldItemId;
  isLocal?: boolean;
  seed?: number;
  /** Read every frame inside useFrame with zero React re-renders */
  getMotion: () => AvatarMotionSample;
}

const ALL_HIKER_GLB_URLS = [
  '/assets/models/hiker_f_adventurer.glb?v=rpm2',
  '/assets/models/hiker_f_casual.glb?v=rpm2',
  '/assets/models/hiker_m_jacket.glb?v=rpm2',
  '/assets/models/hiker_m_sweater.glb?v=rpm2',
] as const;

const HIKER_ANIMATIONS_URL = '/assets/models/hiker_animations.glb?v=rpm2';

let sharedGltfLoaderPromise: Promise<GLTFLoader> | null = null;
const masterHikerCache = new Map<string, Promise<THREE.Group | null>>();
let sharedClipsPromise: Promise<{
  clips: Record<string, THREE.AnimationClip>;
  gripFingerQuats: Record<string, THREE.Quaternion>;
}> | null = null;

const RIGHT_FINGER_RE = /^RightHand(Index|Middle|Ring|Pinky|Thumb)[123]$/;

function getAvatarGltfLoader(): Promise<GLTFLoader> {
  if (!sharedGltfLoaderPromise) {
    sharedGltfLoaderPromise = Promise.resolve(MeshoptDecoder.ready)
      .catch(() => {})
      .then(() => {
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        return loader;
      });
  }
  return sharedGltfLoaderPromise;
}

const IDENTITY_MAT4 = new THREE.Matrix4();

/**
 * Normalizes a Meshopt-quantized multi-skin Ready Player Me GLTF scene once at load time:
 * bakes each SkinnedMesh's per-primitive dequantization matrix into Float32 attributes and
 * binds all 17 SkinnedMesh primitives to 1 canonical 67-bone Skeleton.
 */
function normalizeMasterHikerScene(scene: THREE.Group): void {
  scene.updateMatrixWorld(true);
  let canonBones: THREE.Bone[] | null = null;
  let canonInverses: THREE.Matrix4[] | null = null;
  const oldSkeletons = new Set<THREE.Skeleton>();
  const oldGeos = new Set<THREE.BufferGeometry>();
  const usedGeos = new Set<THREE.BufferGeometry>();
  const vTmp = new THREE.Vector3();
  const mDequant = new THREE.Matrix4();
  const normalMat = new THREE.Matrix3();

  scene.traverse((obj) => {
    const sm = obj as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || !sm.skeleton || sm.skeleton.bones.length === 0) return;

    if (!canonBones) {
      canonBones = sm.skeleton.bones;
      canonInverses = canonBones.map((b) => b.matrixWorld.clone().invert());
    }
    oldSkeletons.add(sm.skeleton);

    mDequant
      .multiplyMatrices(sm.skeleton.bones[0].matrixWorld, sm.skeleton.boneInverses[0])
      .multiply(sm.bindMatrix);

    const srcGeo = sm.geometry;
    oldGeos.add(srcGeo);
    const g = srcGeo.clone();
    const posAttr = g.attributes.position;
    if (posAttr) {
      const f32Pos = new Float32Array(posAttr.count * 3);
      for (let i = 0; i < posAttr.count; i++) {
        vTmp.fromBufferAttribute(posAttr, i).applyMatrix4(mDequant);
        f32Pos[i * 3] = vTmp.x;
        f32Pos[i * 3 + 1] = vTmp.y;
        f32Pos[i * 3 + 2] = vTmp.z;
      }
      g.setAttribute('position', new THREE.BufferAttribute(f32Pos, 3));
    }
    const normAttr = g.attributes.normal;
    if (normAttr) {
      normalMat.getNormalMatrix(mDequant);
      const f32Norm = new Float32Array(normAttr.count * 3);
      for (let i = 0; i < normAttr.count; i++) {
        vTmp.fromBufferAttribute(normAttr, i).applyMatrix3(normalMat).normalize();
        f32Norm[i * 3] = vTmp.x;
        f32Norm[i * 3 + 1] = vTmp.y;
        f32Norm[i * 3 + 2] = vTmp.z;
      }
      g.setAttribute('normal', new THREE.BufferAttribute(f32Norm, 3));
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    sm.geometry = g;
    usedGeos.add(g);
  });

  if (canonBones && canonInverses) {
    const masterSharedSkeleton = new THREE.Skeleton(canonBones, canonInverses);
    scene.traverse((obj) => {
      const sm = obj as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) {
        sm.bind(masterSharedSkeleton, IDENTITY_MAT4);
      } else if ((obj as THREE.Mesh).isMesh) {
        usedGeos.add((obj as THREE.Mesh).geometry);
      }
    });
    for (const skel of oldSkeletons) {
      if (skel !== masterSharedSkeleton) skel.dispose();
    }
    for (const g of oldGeos) {
      if (!usedGeos.has(g)) g.dispose();
    }
  }
}

/**
 * Collapses the 17 per-mesh Skeleton instances created by `SkeletonUtils.clone`
 * down to 1 single shared `THREE.Skeleton` (-92% CPU bone matrix work per avatar).
 */
export function deduplicateClonedSkeletons(clonedRoot: THREE.Group): THREE.Skeleton | null {
  let sharedSkeleton: THREE.Skeleton | null = null;
  clonedRoot.traverse((obj) => {
    const sm = obj as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || !sm.skeleton) return;
    if (!sharedSkeleton) {
      sharedSkeleton = sm.skeleton;
    } else if (sm.skeleton !== sharedSkeleton) {
      const redundant = sm.skeleton;
      sm.bind(sharedSkeleton, sm.bindMatrix);
      redundant.dispose();
    }
  });
  return sharedSkeleton;
}

export function loadMasterHikerGroup(url: string): Promise<THREE.Group | null> {
  const cached = masterHikerCache.get(url);
  if (cached) return cached;

  const p = (async () => {
    try {
      const loader = await getAvatarGltfLoader();
      const gltf = await loader.loadAsync(url);
      normalizeMasterHikerScene(gltf.scene);
      return gltf.scene;
    } catch {
      masterHikerCache.delete(url);
      return null;
    }
  })();

  masterHikerCache.set(url, p);
  return p;
}

export function loadSharedHikerClips(): Promise<{
  clips: Record<string, THREE.AnimationClip>;
  gripFingerQuats: Record<string, THREE.Quaternion>;
}> {
  if (sharedClipsPromise) return sharedClipsPromise;

  sharedClipsPromise = (async () => {
    try {
      const loader = await getAvatarGltfLoader();
      const gltf = await loader.loadAsync(HIKER_ANIMATIONS_URL);
      const clips: Record<string, THREE.AnimationClip> = {};
      const gripFingerQuats: Record<string, THREE.Quaternion> = {};

      for (const clip of gltf.animations) {
        clips[clip.name] = clip;
        if (clip.name === 'HoldProp') {
          for (const track of clip.tracks) {
            if (!track.name.endsWith('.quaternion') || track.values.length < 4) continue;
            const boneName = track.name.slice(0, -11);
            if (RIGHT_FINGER_RE.test(boneName)) {
              gripFingerQuats[boneName] = new THREE.Quaternion(
                track.values[0],
                track.values[1],
                track.values[2],
                track.values[3]
              );
            }
          }
        }
      }
      return { clips, gripFingerQuats };
    } catch {
      sharedClipsPromise = null;
      return { clips: {}, gripFingerQuats: {} };
    }
  })();

  return sharedClipsPromise;
}

// Kick off preload immediately so avatars and 3D studio thumbnails appear instantaneously!
if (typeof window !== 'undefined') {
  void loadSharedHikerClips();
  for (const url of ALL_HIKER_GLB_URLS) {
    void loadMasterHikerGroup(url);
  }
}

// Shared material pool keyed by slot + color so 33 avatars share exact GPU material programs
const TINTED_MAT_CACHE = new Map<string, THREE.MeshStandardMaterial>();
const TEXTURED_TINT_CACHE = new Map<string, THREE.MeshStandardMaterial>();

function attachWoolClothRimSheen(mat: THREE.MeshStandardMaterial, rimStrength = 0.24): void {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      /* glsl */ `
      float clothFresnel = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 3.1);
      vec3 dawnRimTint = mix(diffuseColor.rgb * 1.35, vec3(1.0, 0.80, 0.54), 0.52);
      outgoingLight += dawnRimTint * clothFresnel * ${rimStrength.toFixed(3)};
      #include <opaque_fragment>
      `
    );
  };
  mat.customProgramCacheKey = () => `dalat-wool-rim-${rimStrength.toFixed(2)}`;
}

export function getTintedStandardMaterial(
  slotKey: string,
  hexColor: string,
  roughness = 0.8,
  metalness = 0.02,
  emissiveHex?: string,
  emissiveIntensity = 0.06
): THREE.MeshStandardMaterial {
  const key = `${slotKey}|${hexColor}`;
  const hit = TINTED_MAT_CACHE.get(key);
  if (hit) return hit;

  const baseColor = new THREE.Color(hexColor);
  const emissiveColor = emissiveHex ? new THREE.Color(emissiveHex) : baseColor.clone();
  const mat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness,
    metalness,
    emissive: emissiveColor,
    emissiveIntensity,
  });
  if (slotKey === 'coat' || slotKey === 'scarf' || slotKey === 'beret') {
    attachWoolClothRimSheen(mat, slotKey === 'scarf' ? 0.28 : 0.24);
  }
  TINTED_MAT_CACHE.set(key, mat);
  return mat;
}

export function getTintedTexturedMaterial(
  origMat: THREE.MeshStandardMaterial,
  hexColor: string,
  emissiveIntensity = 0.045,
  enableClothRim = false
): THREE.MeshStandardMaterial {
  const key = `${origMat.uuid}|${hexColor}|${enableClothRim ? 'rim' : 'std'}`;
  const hit = TEXTURED_TINT_CACHE.get(key);
  if (hit) return hit;

  const mat = origMat.clone();
  const tint = new THREE.Color(hexColor);
  mat.color.copy(tint);
  mat.emissive.copy(tint);
  mat.emissiveIntensity = emissiveIntensity;
  if (enableClothRim) {
    attachWoolClothRimSheen(mat, 0.24);
  }
  TEXTURED_TINT_CACHE.set(key, mat);
  return mat;
}

// Twist-free anatomical right-arm & wrist target quaternions solved on the 0.94x Ready Player Me human rig:
// - RightHand local +X = Thumb side (aligned with +Y World UP for upright cylindrical cup grip!)
// - RightHand local +Z = Palm normal (aligned with +X World INWARD wrapping around cup!)
// - Finger flexion rotates around local +X into the +Z palm (never sideways around +Z!)
const Q_CARRY_SHOULDER = new THREE.Quaternion(0.5321, -0.4802, 0.4422, 0.5391);

const Q_CUP_UPPER = new THREE.Quaternion(0.6008, -0.1572, -0.2177, 0.753);
const Q_CUP_LOWER = new THREE.Quaternion(-0.1035, 0.282, -0.6559, 0.6925);
const Q_CUP_HAND = new THREE.Quaternion(0.0153, 0.0002, 0.0199, 0.9997);

const Q_SIP_UPPER = new THREE.Quaternion(0.407, -0.2073, -0.4973, 0.7376);
const Q_SIP_LOWER = new THREE.Quaternion(-0.2031, 0.3889, -0.7574, 0.4836);
const Q_SIP_HAND = new THREE.Quaternion(-0.0369, -0.0107, 0.13, 0.9908);

const Q_CHEERS_UPPER = new THREE.Quaternion(0.2039, -0.2325, -0.5929, 0.7435);
const Q_CHEERS_LOWER = new THREE.Quaternion(-0.2513, 0.6366, -0.4442, 0.5782);
const Q_CHEERS_HAND = new THREE.Quaternion(-0.0061, -0.0011, 0.1076, 0.9942);

const Q_LANTERN_UPPER = new THREE.Quaternion(0.3778, -0.4887, -0.5085, 0.5998);
const Q_LANTERN_LOWER = new THREE.Quaternion(-0.5418, 0.4276, -0.2758, 0.669);
const Q_LANTERN_HAND = new THREE.Quaternion(0.021, 0.0008, 0.0077, 0.9997);

// Raised eye-level viewfinder pose for snap_photo emote
const Q_PHOTO_R_UPPER = new THREE.Quaternion(0.4324, 0.1322, -0.4998, 0.7388);
const Q_PHOTO_R_LOWER = new THREE.Quaternion(-0.1238, 0.2313, -0.7815, 0.566);
const Q_PHOTO_R_HAND = new THREE.Quaternion(-0.0604, 0.1368, 0.5346, 0.8318);
const Q_PHOTO_L_SHOULDER = new THREE.Quaternion(0.5155, 0.4995, -0.466, 0.5172);
const Q_PHOTO_L_UPPER = new THREE.Quaternion(0.6338, -0.3104, 0.3424, 0.6202);
const Q_PHOTO_L_LOWER = new THREE.Quaternion(0.0849, 0.0308, 0.7597, 0.6439);
const Q_PHOTO_L_HAND = new THREE.Quaternion(-0.0436, -0.2921, -0.4734, 0.8298);

// Acoustic guitar fretting (left arm) & strumming (right arm) pose for play_guitar / jamPulse
const Q_GUITAR_R_UPPER = new THREE.Quaternion(0.344, 0.0202, -0.2364, 0.9085);
const Q_GUITAR_R_LOWER = new THREE.Quaternion(0.4467, 0.0853, -0.5119, 0.7288);
const Q_GUITAR_R_HAND = new THREE.Quaternion(0.1724, -0.0155, 0.2431, 0.9544);
const Q_GUITAR_L_SHOULDER = new THREE.Quaternion(0.5155, 0.4995, -0.466, 0.5172);
const Q_GUITAR_L_UPPER = new THREE.Quaternion(0.7487, -0.1931, 0.2175, 0.5957);
const Q_GUITAR_L_LOWER = new THREE.Quaternion(-0.2621, -0.2695, 0.6881, 0.6206);
const Q_GUITAR_L_HAND = new THREE.Quaternion(0.2147, -0.5697, -0.1619, 0.7766);

const ANATOMICAL_GRIP_FINGER_QUATS: Record<string, THREE.Quaternion> = (() => {
  const mk = (rx: number, ry = 0, rz = 0) =>
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  const map: Record<string, THREE.Quaternion> = {};
  for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
    map[`RightHand${f}1`] = mk(0.44, 0, 0);
    map[`RightHand${f}2`] = mk(0.64, 0, 0);
    map[`RightHand${f}3`] = mk(0.46, 0, 0);
  }
  map.RightHandThumb1 = mk(0.38, 0.24, -0.36);
  map.RightHandThumb2 = mk(0.22, 0.08, 0.06);
  map.RightHandThumb3 = mk(0.18, 0.04, 0.04);
  return map;
})();

const LOCOMOTION_CLIPS = ['Idle', 'Walk', 'Run', 'Sprint'] as const;
const OVERRIDE_CLIPS = ['Sit', 'Jump', 'Wave', 'WarmHands', 'Cheer'] as const;

const _tmpQuat = new THREE.Quaternion();
const _tmpQuatA = new THREE.Quaternion();
const _tmpQuatB = new THREE.Quaternion();
const _tmpQuatC = new THREE.Quaternion();
const _tmpQuatLA = new THREE.Quaternion();
const _tmpQuatLB = new THREE.Quaternion();
const _tmpQuatLC = new THREE.Quaternion();
const _tmpPalmNormal = new THREE.Vector3();
const _tmpFingerDir = new THREE.Vector3();
const _tmpEuler = new THREE.Euler();
const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _gripOffset = new THREE.Vector3();
const _invRootQuat = new THREE.Quaternion();
const _upAxisY = new THREE.Vector3(0, 1, 0);
const _shadowUpWorld = new THREE.Vector3(0, 1, 0);
const _shadowTiltQuat = new THREE.Quaternion();
const _shadowBaseQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

const SOFT_MIST_VERT = /* glsl */ `
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const SOFT_MIST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  void main() {
    float ndv = clamp(abs(dot(normalize(vViewNormal), normalize(vViewDir))), 0.0, 1.0);
    float wisp = pow(ndv, 2.25);
    float alpha = wisp * uOpacity;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

function createSoftMistWispMaterial(hexColor: string, initialOpacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(hexColor) },
      uOpacity: { value: initialOpacity },
    },
    vertexShader: SOFT_MIST_VERT,
    fragmentShader: SOFT_MIST_FRAG,
    transparent: true,
    depthWrite: false,
  });
}

const CONTACT_SHADOW_VERT = /* glsl */ `
  varying vec2 vShadowUv;
  void main() {
    vShadowUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CONTACT_SHADOW_FRAG = /* glsl */ `
  uniform float uOpacity;
  uniform float uBootSpread;
  varying vec2 vShadowUv;
  void main() {
    float radial = length(vShadowUv);
    float edgeFade = smoothstep(0.95, 0.14, radial);

    vec2 pBody = vShadowUv * vec2(1.08, 1.16);
    float bodyAo = exp(-dot(pBody, pBody) * 3.8) * edgeFade;

    vec2 pBootL = (vShadowUv - vec2(-0.21, uBootSpread)) * vec2(3.1, 2.25);
    vec2 pBootR = (vShadowUv - vec2(0.21, -uBootSpread)) * vec2(3.1, 2.25);
    float soleAo = (exp(-dot(pBootL, pBootL) * 2.4) + exp(-dot(pBootR, pBootR) * 2.4)) * 0.54 * edgeFade;

    float alpha = clamp((bodyAo * 0.62 + soleAo) * uOpacity, 0.0, 0.46);
    if (alpha < 0.003) discard;
    // Pure black attenuation in linear HDR so NormalBlending multiplies underlying soil/wood/grass by (1 - alpha) with zero blue tint!
    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
  }
`;

function createContactShadowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0.42 },
      uBootSpread: { value: 0.0 },
    },
    vertexShader: CONTACT_SHADOW_VERT,
    fragmentShader: CONTACT_SHADOW_FRAG,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

interface ClonedHikerRig {
  root: THREE.Group;
  sharedSkeleton: THREE.Skeleton | null;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  backpackObjs: THREE.Object3D[];
  shoulderRBone: THREE.Object3D | null;
  upperArmRBone: THREE.Object3D | null;
  lowerArmRBone: THREE.Object3D | null;
  handRBone: THREE.Object3D | null;
  shoulderLBone: THREE.Object3D | null;
  upperArmLBone: THREE.Object3D | null;
  lowerArmLBone: THREE.Object3D | null;
  handLBone: THREE.Object3D | null;
  middleKnuckleRBone: THREE.Object3D | null;
  chestBone: THREE.Object3D | null;
  headBone: THREE.Object3D | null;
  fingerRBones: Array<{ bone: THREE.Object3D; gripQuat: THREE.Quaternion }>;
}

export function applyOutfitToClonedHiker(
  clonedRoot: THREE.Group,
  outfit: PlayerOutfit,
  isLocal: boolean
): void {
  const effNeckwear = resolveEffectiveNeckwear(outfit);
  const effBag = resolveEffectiveBagStyle(outfit);
  const effGender = resolveEffectiveGender(outfit);
  const effCoatStyle = ensureCoatMatchesGender(outfit.coatStyle, effGender);
  const coatHasBuiltInCollar =
    effCoatStyle === 'sherpa_cape' ||
    effCoatStyle === 'highland_poncho' ||
    effCoatStyle === 'cardigan_vest' ||
    effCoatStyle === 'velvet_cloak' ||
    effCoatStyle === 'vintage_poncho' ||
    effCoatStyle === 'quilted_gilet' ||
    effCoatStyle === 'corduroy_safari' ||
    effCoatStyle === 'tweed_overcoat';

  const scarfMat = getTintedStandardMaterial('scarf', outfit.scarfColor, 0.85, 0.01, undefined, 0.06);
  const beretMat = getTintedStandardMaterial('beret', outfit.scarfColor, 0.8, 0.02, undefined, 0.05);
  const bootsMat = getTintedStandardMaterial('boots', '#3B251A', 0.56, 0.05, '#2A1810', 0.04);

  clonedRoot.traverse((obj) => {
    const oname = obj.name || '';
    if (oname.startsWith('Hiker_Backpack') || oname.startsWith('Backpack')) {
      obj.visible = effBag === 'trek_pack';
    } else if (oname.startsWith('Hiker_Beanie')) {
      obj.visible = outfit.headwear === 'beanie';
    } else if (oname.startsWith('Hiker_Beret')) {
      obj.visible = outfit.headwear === 'beret';
    } else if (oname.startsWith('Hiker_Scarf')) {
      obj.visible =
        !coatHasBuiltInCollar &&
        (effNeckwear === 'knit_scarf' || effNeckwear === 'plaid_shawl');
    }

    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        mesh.frustumCulled = false;
      }

      if (!mesh.userData.origMaterials) {
        mesh.userData.origMaterials = Array.isArray(mesh.material)
          ? [...mesh.material]
          : mesh.material
            ? [mesh.material]
            : [];
      }

      const origList = mesh.userData.origMaterials as THREE.Material[];
      const resolveMat = (orig: THREE.Material): THREE.Material => {
        const mName = orig.name || '';
        const std = orig as THREE.MeshStandardMaterial;

        if (mName.startsWith('Mat_Coat_Beret')) {
          return beretMat;
        }
        if (mName.startsWith('Mat_Coat')) {
          return std.map
            ? getTintedTexturedMaterial(std, outfit.coatColor, 0.045, true)
            : getTintedStandardMaterial('coat', outfit.coatColor, 0.78, 0.02, undefined, 0.05);
        }
        if (mName.startsWith('Mat_Hair')) {
          return std.map
            ? getTintedTexturedMaterial(std, outfit.hairColor, 0.03)
            : getTintedStandardMaterial('hair', outfit.hairColor, 0.74, 0.03, undefined, 0.04);
        }
        if (mName.startsWith('Mat_Scarf')) {
          return scarfMat;
        }
        if (mName.startsWith('Mat_Boots')) {
          return bootsMat;
        }
        if (mName.includes('Wolf3D_Outfit_Footwear') && std.isMeshStandardMaterial && !std.userData.bootTuned) {
          std.color.set('#CFC2B4');
          std.roughness = Math.max(std.roughness, 0.74);
          std.metalness = Math.min(std.metalness, 0.05);
          std.envMapIntensity = 0.42;
          std.userData.bootTuned = true;
        }
        if (mName.includes('Wolf3D_Outfit_Bottom') && std.isMeshStandardMaterial && !std.userData.bottomTuned) {
          std.roughness = 0.85;
          std.metalness = 0.02;
          std.emissive.set('#1C212C');
          std.emissiveIntensity = 0.095;
          attachWoolClothRimSheen(std, 0.15);
          std.userData.bottomTuned = true;
        }
        // Gentle warm dawn dermal bounce & soft subsurface rim on Ready Player Me face/skin textures
        if (
          (mName.includes('Wolf3D_Skin') ||
            mName.includes('Wolf3D_Head') ||
            mName.includes('Wolf3D_Body')) &&
          std.isMeshStandardMaterial &&
          !std.userData.warmTuned
        ) {
          std.roughness = 0.64;
          std.metalness = 0.01;
          std.emissive.set('#3A1A12');
          std.emissiveIntensity = 0.055;
          std.userData.warmTuned = true;
        }
        return orig;
      };

      if (Array.isArray(mesh.material)) {
        mesh.material = origList.map(resolveMat);
      } else if (origList[0]) {
        mesh.material = resolveMat(origList[0]);
      }
    }
  });
}

export function HighlandAvatar({
  outfit,
  heldItem,
  isLocal = false,
  seed = 0.37,
  getMotion,
}: HighlandAvatarProps) {
  const avatarRootRef = useRef<THREE.Group>(null);
  const charOffsetRef = useRef<THREE.Group>(null);
  const handSocketRef = useRef<THREE.Group>(null);
  const chestSocketRef = useRef<THREE.Group>(null);
  const guitarInnerGroupRef = useRef<THREE.Group>(null);
  const snapCameraFallbackRef = useRef<THREE.Group>(null);
  const wearableChestSocketRef = useRef<THREE.Group>(null);
  const wearableHeadSocketRef = useRef<THREE.Group>(null);
  const customBagMeshRef = useRef<THREE.Mesh>(null);
  const sparklerBurstRef = useRef<THREE.Mesh>(null);
  const headSocketRef = useRef<THREE.Group>(null);
  const shadowRef = useRef<THREE.Mesh>(null);

  const steam1Ref = useRef<THREE.Mesh>(null);
  const steam2Ref = useRef<THREE.Mesh>(null);
  const steam3Ref = useRef<THREE.Mesh>(null);
  const breath1Ref = useRef<THREE.Mesh>(null);
  const breath2Ref = useRef<THREE.Mesh>(null);

  const [rigState, setRigState] = useState<ClonedHikerRig | null>(null);
  const clockStateRef = useRef({
    idleClock: seed * 13.7,
    breathCycle: (seed * 3.2) % 3.2,
    lodFrame: Math.floor(seed * 10),
    lodAccumDt: (seed * 0.067) % 0.067,
    smoothSeatY: 0,
    smoothSeatZ: 0,
    smoothBankRoll: 0,
    smoothCarryWeight: 0,
    smoothSipWeight: 0,
    smoothCheersWeight: 0,
    smoothGuitarWeight: 0,
    smoothGuitarFront: heldItem === 'guitar' ? 1 : 0,
    smoothPhotoWeight: 0,
    weights: {
      Idle: 1,
      Walk: 0,
      Run: 0,
      Sprint: 0,
      Sit: 0,
      Jump: 0,
      Wave: 0,
      WarmHands: 0,
      Cheer: 0,
      HoldProp: 0,
    } as Record<string, number>,
  });

  const effGender = resolveEffectiveGender(outfit);
  const effCoatStyle = ensureCoatMatchesGender(outfit.coatStyle, effGender);
  const isMaleRig = isMaleCoatStyle(effCoatStyle, effGender);
  const modelUrl = resolveBaseGlbForCoat(effCoatStyle, effGender);
  const effNeckwear = resolveEffectiveNeckwear(outfit);
  const effEyewear = resolveEffectiveEyewear(outfit);
  const effBag = resolveEffectiveBagStyle(outfit);

  const coatOverlayGeo = useMemo(
    () => getCoatOverlayGeometry(effCoatStyle, outfit.coatColor, outfit.scarfColor),
    [effCoatStyle, outfit.coatColor, outfit.scarfColor]
  );

  const customNeckwearGeo = useMemo(
    () => getCustomNeckwearGeometry(effNeckwear, outfit.scarfColor, isMaleRig),
    [effNeckwear, outfit.scarfColor, isMaleRig]
  );

  const customBagGeo = useMemo(
    () => getCustomBagGeometry(effBag, outfit.coatColor, outfit.scarfColor, isMaleRig),
    [effBag, outfit.coatColor, outfit.scarfColor, isMaleRig]
  );

  const customHeadwearGeo = useMemo(
    () => getCustomHeadwearGeometry(outfit.headwear, outfit.coatColor, outfit.scarfColor),
    [outfit.headwear, outfit.coatColor, outfit.scarfColor]
  );

  const eyewearGroup = useMemo(() => buildEyewearGroup(effEyewear), [effEyewear]);

  // Dispose per-instance procedural eyewear geometries on eyewear change / unmount (keep shared materials intact)
  useEffect(() => {
    if (!eyewearGroup) return;
    return () => {
      eyewearGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).geometry?.dispose();
        }
      });
    };
  }, [eyewearGroup]);

  // Load & clone rigged SkinnedMesh GLB + deduplicate 13 -> 1 Skeleton + bind shared AnimationClips
  useEffect(() => {
    let cancelled = false;
    const disposeRig = (rig: ClonedHikerRig | null) => {
      if (!rig) return;
      rig.mixer.stopAllAction();
      rig.mixer.uncacheRoot(rig.root);
      rig.sharedSkeleton?.dispose();
    };

    void (async () => {
      const [masterScene, sharedAnim] = await Promise.all([
        loadMasterHikerGroup(modelUrl),
        loadSharedHikerClips(),
      ]);
      if (cancelled || !masterScene) return;

      const { clips: clipMap } = sharedAnim;
      const cloned = SkeletonUtils.clone(masterScene) as THREE.Group;
      const sharedSkeleton = deduplicateClonedSkeletons(cloned);
      // Scale comfortably to ~1.72m human highland hiker height
      cloned.scale.setScalar(0.94);

      const backpackObjs: THREE.Object3D[] = [];
      let shoulderRBone: THREE.Object3D | null = null;
      let upperArmRBone: THREE.Object3D | null = null;
      let lowerArmRBone: THREE.Object3D | null = null;
      let handRBone: THREE.Object3D | null = null;
      let shoulderLBone: THREE.Object3D | null = null;
      let upperArmLBone: THREE.Object3D | null = null;
      let lowerArmLBone: THREE.Object3D | null = null;
      let handLBone: THREE.Object3D | null = null;
      let middleKnuckleRBone: THREE.Object3D | null = null;
      let chestBone: THREE.Object3D | null = null;
      let headBone: THREE.Object3D | null = null;
      const fingerRBones: Array<{ bone: THREE.Object3D; gripQuat: THREE.Quaternion }> = [];

      cloned.traverse((node) => {
        const n = node.name || '';
        if (n.startsWith('Hiker_Backpack') || n.startsWith('Backpack')) backpackObjs.push(node);
        else if (n === 'RightShoulder' || n === 'ShoulderR' || n === 'Shoulder.R') shoulderRBone = node;
        else if (n === 'RightArm' || n === 'UpperArmR' || n === 'UpperArm.R') upperArmRBone = node;
        else if (n === 'RightForeArm' || n === 'LowerArmR' || n === 'LowerArm.R') lowerArmRBone = node;
        else if (n === 'RightHand' || n === 'HandR' || n === 'Hand.R') handRBone = node;
        else if (n === 'LeftShoulder' || n === 'ShoulderL' || n === 'Shoulder.L') shoulderLBone = node;
        else if (n === 'LeftArm' || n === 'UpperArmL' || n === 'UpperArm.L') upperArmLBone = node;
        else if (n === 'LeftForeArm' || n === 'LowerArmL' || n === 'LowerArm.L') lowerArmLBone = node;
        else if (n === 'LeftHand' || n === 'HandL' || n === 'Hand.L') handLBone = node;
        else if (n === 'Spine2' || n === 'Chest') chestBone = node;
        else if (n === 'Head') headBone = node;

        if (n === 'RightHandMiddle1') {
          middleKnuckleRBone = node;
        }
        if (ANATOMICAL_GRIP_FINGER_QUATS[n]) {
          fingerRBones.push({ bone: node, gripQuat: ANATOMICAL_GRIP_FINGER_QUATS[n] });
        }
      });

      applyOutfitToClonedHiker(cloned, outfit, isLocal);

      const mixer = new THREE.AnimationMixer(cloned);
      const actions: Record<string, THREE.AnimationAction> = {};
      for (const [name, clip] of Object.entries(clipMap)) {
        const act = mixer.clipAction(clip);
        if (name === 'Jump') {
          act.setLoop(THREE.LoopOnce, 1);
          act.clampWhenFinished = true;
        }
        act.enabled = name === 'Idle';
        act.setEffectiveTimeScale(1);
        act.setEffectiveWeight(name === 'Idle' ? 1 : 0);
        act.play();
        actions[name] = act;
      }

      // Stagger initial animation phase across multiplayer peers so crowd never breathes in lockstep!
      mixer.setTime((seed * 7.3) % 2.0);
      clockStateRef.current.weights = {
        Idle: 1,
        Walk: 0,
        Run: 0,
        Sprint: 0,
        Sit: 0,
        Jump: 0,
        Wave: 0,
        WarmHands: 0,
        Cheer: 0,
        HoldProp: 0,
      };

      const nextRig: ClonedHikerRig = {
        root: cloned,
        sharedSkeleton,
        mixer,
        actions,
        backpackObjs,
        shoulderRBone,
        upperArmRBone,
        lowerArmRBone,
        handRBone,
        shoulderLBone,
        upperArmLBone,
        lowerArmLBone,
        handLBone,
        middleKnuckleRBone,
        chestBone,
        headBone,
        fingerRBones,
      };

      if (cancelled) {
        disposeRig(nextRig);
        return;
      }

      setRigState((prev) => {
        disposeRig(prev);
        return nextRig;
      });
    })();

    return () => {
      cancelled = true;
      setRigState((prev) => {
        disposeRig(prev);
        return null;
      });
    };
  }, [modelUrl, isLocal, seed]);

  // Live-update outfit colors & accessory visibility without rebuilding skeleton/mixer!
  useEffect(() => {
    if (!rigState) return;
    applyOutfitToClonedHiker(rigState.root, outfit, isLocal);
  }, [
    rigState,
    outfit.gender,
    outfit.coatStyle,
    outfit.coatColor,
    outfit.scarfColor,
    outfit.hairColor,
    outfit.headwear,
    outfit.neckwear,
    outfit.eyewear,
    outfit.bagStyle,
    outfit.backpack,
    isLocal,
  ]);

  const propMats = useMemo(() => {
    return {
      glassMat: new THREE.MeshStandardMaterial({
        color: '#E6F2F8',
        roughness: 0.15,
        metalness: 0.1,
        transparent: true,
        opacity: 0.52,
      }),
      soyMat: new THREE.MeshStandardMaterial({
        color: '#FCF3D9',
        roughness: 0.45,
        emissive: '#FFF2CC',
        emissiveIntensity: 0.18,
      }),
      lanternGlowMat: new THREE.MeshStandardMaterial({
        color: '#FFD28A',
        emissive: '#FFA938',
        emissiveIntensity: 2.5,
        roughness: 0.2,
      }),
      lanternHaloMat: new THREE.MeshBasicMaterial({
        color: '#FFB347',
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      }),
      sparklerBurstMat: new THREE.MeshBasicMaterial({
        color: '#FFE484',
      }),
      vaporMat1: createSoftMistWispMaterial('#F6FAFF', 0),
      vaporMat2: createSoftMistWispMaterial('#F6FAFF', 0),
      steamMat: createSoftMistWispMaterial('#FFFDF8', 0.38),
      shadowMat: createContactShadowMaterial(),
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const mat of Object.values(propMats)) {
        mat.dispose();
      }
    };
  }, [propMats]);

  useFrame(({ camera }, rawDt) => {
    const rootNode = avatarRootRef.current;
    if (!isLocal && rootNode && rootNode.parent && !rootNode.parent.visible) {
      return;
    }

    const rawStep = Math.min(rawDt, 0.06);
    const cs = clockStateRef.current;

    if (!isLocal && rootNode && rootNode.parent) {
      const pPos = rootNode.parent.position;
      const dx = pPos.x - camera.position.x;
      const dy = pPos.y - camera.position.y;
      const dz = pPos.z - camera.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      cs.lodAccumDt += rawStep;
      // Distance-based AnimationMixer throttling: <=22m -> 60 Hz, 22..45m -> 30 Hz, >45m -> 15 Hz
      const minInterval = distSq > 45 * 45 ? 1 / 15 : distSq > 22 * 22 ? 1 / 30 : 0;
      if (minInterval > 0 && cs.lodAccumDt < minInterval) {
        return;
      }
    } else {
      cs.lodAccumDt = rawStep;
    }

    const dt = Math.min(cs.lodAccumDt, 0.12);
    cs.lodAccumDt = 0;
    const m = getMotion();
    cs.idleClock += dt;

    const isSeated = m.seated || m.emote === 'sit_chill';
    const jamLevel = Math.max(0, m.jamPulse ?? 0);
    const activeStrumming = m.emote === 'play_guitar' || jamLevel > 0.02;

    if (rigState) {
      const { mixer, actions } = rigState;

      // Tuck off bulky back-worn packs while seated against backrest so back leans flush on the wooden bench
      const showBuiltInTrekPack = effBag === 'trek_pack' && !isSeated;
      for (let i = 0; i < rigState.backpackObjs.length; i++) {
        rigState.backpackObjs[i].visible = showBuiltInTrekPack;
      }
      if (customBagMeshRef.current) {
        customBagMeshRef.current.visible = !isSeated || effBag === 'canvas_tote';
      }

      // 1. Gait-pure 4-way locomotion blend tree (Idle <-> Walk <-> Run <-> Sprint, zero .reset() snaps!)
      // Walking (!m.running && effSpeed <= 3.05) stays 100% pure Idle <-> Walk with zero Run forward-lean pollution!
      const effSpeed = !isSeated && m.grounded ? (m.moving ? m.speed : m.speed * 0.5) : 0;
      let rawIdle = 0;
      let rawWalk = 0;
      let rawRun = 0;
      let rawSprint = 0;

      if (effSpeed <= 0.05) {
        rawIdle = 1;
      } else if (!m.running && effSpeed <= 3.05) {
        const u = THREE.MathUtils.smoothstep(effSpeed, 0.05, 1.2);
        rawIdle = 1 - u;
        rawWalk = u;
      } else if (effSpeed < 5.4) {
        const u = THREE.MathUtils.clamp((effSpeed - 2.45) / 1.45, 0, 1);
        rawWalk = 1 - u;
        rawRun = u;
      } else {
        const u = THREE.MathUtils.clamp((effSpeed - 5.4) / 1.65, 0, 1);
        rawRun = 1 - u;
        rawSprint = u;
      }

      // 2. Smooth discrete posture/emote override layer
      let desiredOverride = '';
      if (isSeated && actions.Sit) {
        desiredOverride = 'Sit';
      } else if (!m.grounded && actions.Jump) {
        desiredOverride = 'Jump';
      } else if (!m.moving && m.speed < 0.35) {
        if (m.emote === 'wave' && actions.Wave) desiredOverride = 'Wave';
        else if (m.emote === 'warm_hands' && actions.WarmHands) desiredOverride = 'WarmHands';
        else if (m.emote === 'cheer_sunrise' && actions.Cheer) desiredOverride = 'Cheer';
      }

      const weightBlend = 1 - Math.exp(-12 * dt);
      let overrideSum = 0;
      for (const name of OVERRIDE_CLIPS) {
        const act = actions[name];
        if (!act) continue;
        const targetW = desiredOverride === name ? 1 : 0;
        const prevW = cs.weights[name] ?? 0;
        const nextW = prevW + (targetW - prevW) * weightBlend;
        cs.weights[name] = nextW < 0.001 && targetW === 0 ? 0 : nextW;

        if (cs.weights[name] > 0.001) {
          if (!act.enabled || prevW <= 0.001) {
            act.enabled = true;
            act.paused = false;
            act.time = 0;
          }
          act.setEffectiveWeight(cs.weights[name]);
          overrideSum += cs.weights[name];
        } else {
          act.enabled = false;
          act.setEffectiveWeight(0);
        }
      }

      const locoScale = Math.max(0, 1 - Math.min(1, overrideSum));
      const locoTargets: Record<(typeof LOCOMOTION_CLIPS)[number], number> = {
        Idle: rawIdle * locoScale,
        Walk: rawWalk * locoScale,
        Run: rawRun * locoScale,
        Sprint: rawSprint * locoScale,
      };

      // Capture active normalized gait-cycle phase [0, 1) before enabling any incoming gait clip
      // Note: Walk clip contains 2 full gait cycles (1.917s); Run (0.708s) & Sprint (0.583s) contain 1 cycle.
      let activeGaitPhase: number | null = null;
      let bestGaitWeight = 0.001;
      for (const gName of ['Walk', 'Run', 'Sprint'] as const) {
        const gAct = actions[gName];
        const gW = cs.weights[gName] ?? 0;
        if (gAct && gAct.enabled && gW > bestGaitWeight) {
          const gCycleDur =
            gName === 'Walk' ? gAct.getClip().duration * 0.5 : gAct.getClip().duration;
          if (gCycleDur > 0.01) {
            activeGaitPhase = ((gAct.time / gCycleDur) % 1 + 1) % 1;
            bestGaitWeight = gW;
          }
        }
      }

      for (const name of LOCOMOTION_CLIPS) {
        const act = actions[name];
        if (!act) continue;
        const targetW = locoTargets[name];
        const prevW = cs.weights[name] ?? 0;
        const nextW = prevW + (targetW - prevW) * weightBlend;
        cs.weights[name] = nextW < 0.001 && targetW === 0 ? 0 : nextW;

        if (cs.weights[name] > 0.001) {
          const wasDisabled = !act.enabled || prevW <= 0.001;
          act.enabled = true;
          if (wasDisabled && name !== 'Idle' && activeGaitPhase !== null) {
            const cycleDur =
              name === 'Walk' ? act.getClip().duration * 0.5 : act.getClip().duration;
            act.time = activeGaitPhase * cycleDur;
          }
          act.setEffectiveWeight(cs.weights[name]);
        } else {
          act.enabled = false;
          act.setEffectiveWeight(0);
        }
      }

      // Engage HoldProp finger grip clip during play_guitar / snap_photo / jamPulse
      if (actions.HoldProp) {
        const wantsHoldClip = activeStrumming || m.emote === 'snap_photo' ? 0.35 : 0;
        const prevHold = cs.weights.HoldProp ?? 0;
        const nextHold = prevHold + (wantsHoldClip - prevHold) * weightBlend;
        cs.weights.HoldProp = nextHold < 0.001 && wantsHoldClip === 0 ? 0 : nextHold;
        if (cs.weights.HoldProp > 0.001) {
          actions.HoldProp.enabled = true;
          actions.HoldProp.setEffectiveWeight(cs.weights.HoldProp);
        } else {
          actions.HoldProp.enabled = false;
          actions.HoldProp.setEffectiveWeight(0);
        }
      }

      // 1:1 biomechanical foot-locked stride cadence + unified sync-group cycle rate across Walk/Run/Sprint
      // Measured at 0.94x rig scale: Walk = 1.84 m/s (2 cycles / 1.917s), Run = 3.15..3.85 m/s, Sprint = 5.79 m/s
      const walkScaleNat = THREE.MathUtils.clamp(Math.max(0.95, effSpeed) / 1.9, 0.52, 1.38);
      const runScaleNat = THREE.MathUtils.clamp(Math.max(3.1, effSpeed) / 3.85, 0.82, 1.36);
      const sprintScaleNat = THREE.MathUtils.clamp(Math.max(5.4, effSpeed) / 5.9, 0.9, 1.28);

      const wWalk = cs.weights.Walk ?? 0;
      const wRun = cs.weights.Run ?? 0;
      const wSprint = cs.weights.Sprint ?? 0;
      const gaitSum = wWalk + wRun + wSprint;

      if (gaitSum > 0.001) {
        const walkCycleDur = actions.Walk ? actions.Walk.getClip().duration * 0.5 : 0.9583;
        const runCycleDur = actions.Run ? actions.Run.getClip().duration : 0.7083;
        const sprintCycleDur = actions.Sprint ? actions.Sprint.getClip().duration : 0.5833;

        const syncCycleHz =
          (wWalk * (walkScaleNat / walkCycleDur) +
            wRun * (runScaleNat / runCycleDur) +
            wSprint * (sprintScaleNat / sprintCycleDur)) /
          gaitSum;

        if (actions.Walk) actions.Walk.timeScale = syncCycleHz * walkCycleDur;
        if (actions.Run) actions.Run.timeScale = syncCycleHz * runCycleDur;
        if (actions.Sprint) actions.Sprint.timeScale = syncCycleHz * sprintCycleDur;
      } else {
        if (actions.Walk) actions.Walk.timeScale = walkScaleNat;
        if (actions.Run) actions.Run.timeScale = runScaleNat;
        if (actions.Sprint) actions.Sprint.timeScale = sprintScaleNat;
      }

      mixer.update(dt);

      // 3. Per-rig sole contact calibration, subtle biomechanical stride weight & ergonomic bench alignment
      let curCyclePhase = 0;
      if (actions.Walk && (cs.weights.Walk ?? 0) >= (cs.weights.Run ?? 0) && (cs.weights.Walk ?? 0) > 0.01) {
        const wDur = Math.max(0.1, actions.Walk.getClip().duration * 0.5);
        curCyclePhase = ((actions.Walk.time / wDur) % 1 + 1) % 1;
      } else if (actions.Run && (cs.weights.Run ?? 0) > 0.01) {
        const rDur = Math.max(0.1, actions.Run.getClip().duration);
        curCyclePhase = ((actions.Run.time / rDur) % 1 + 1) % 1;
      } else if (actions.Sprint && (cs.weights.Sprint ?? 0) > 0.01) {
        const sDur = Math.max(0.1, actions.Sprint.getClip().duration);
        curCyclePhase = ((actions.Sprint.time / sDur) % 1 + 1) % 1;
      }

      const strideBob =
        !isSeated && m.grounded && gaitSum > 0.02
          ? Math.sin(curCyclePhase * Math.PI * 4) * 0.008 * Math.min(1, gaitSum)
          : 0;
      const baseGroundY = !isMaleRig ? 0.006 : 0.003;
      const targetSeatY = isSeated ? -0.41 + baseGroundY : baseGroundY + strideBob;
      const targetSeatZ = isSeated ? 0.055 : 0;
      const seatBlend = 1 - Math.exp(-14 * dt);
      cs.smoothSeatY += (targetSeatY - cs.smoothSeatY) * seatBlend;
      cs.smoothSeatZ += (targetSeatZ - cs.smoothSeatZ) * seatBlend;

      const targetBank = !isSeated && m.moving ? (m.turnBank ?? 0) * 0.1 : 0;
      cs.smoothBankRoll += (targetBank - cs.smoothBankRoll) * (1 - Math.exp(-12 * dt));

      if (charOffsetRef.current) {
        charOffsetRef.current.position.set(0, cs.smoothSeatY, cs.smoothSeatZ);
        charOffsetRef.current.rotation.z = cs.smoothBankRoll;
      }

      propMats.shadowMat.uniforms.uBootSpread.value =
        !isSeated && m.grounded
          ? Math.sin(curCyclePhase * Math.PI * 2) * 0.15 * Math.min(1, gaitSum)
          : 0;

      // 4. Post-mixer twist-free anatomical carry, sip, cheers, guitar strum & camera viewfinder IK
      const fullBodyEmoteActive =
        !isSeated &&
        !m.moving &&
        (m.emote === 'wave' || m.emote === 'warm_hands' || m.emote === 'cheer_sunrise');
      const wantsPhoto = !fullBodyEmoteActive && m.emote === 'snap_photo';
      const wantsGuitar =
        !fullBodyEmoteActive &&
        !wantsPhoto &&
        (activeStrumming || (heldItem === 'guitar' && !m.moving));
      const wantsCarry =
        !fullBodyEmoteActive &&
        !wantsGuitar &&
        heldItem !== 'none' &&
        heldItem !== 'guitar';
      const isWarmItem = isWarmEdibleOrDrinkProp(heldItem);
      const wantsSip =
        !fullBodyEmoteActive && !wantsPhoto && m.emote === 'sip_drink' && isWarmItem;
      const wantsCheers =
        !fullBodyEmoteActive &&
        !wantsPhoto &&
        m.emote === 'cheers_cup' &&
        (isWarmItem || heldItem === 'sparkler');

      cs.smoothCarryWeight += ((wantsCarry ? 1 : 0) - cs.smoothCarryWeight) * (1 - Math.exp(-12 * dt));
      cs.smoothSipWeight += ((wantsSip ? 1 : 0) - cs.smoothSipWeight) * (1 - Math.exp(-8 * dt));
      cs.smoothCheersWeight += ((wantsCheers ? 1 : 0) - cs.smoothCheersWeight) * (1 - Math.exp(-9 * dt));
      cs.smoothGuitarWeight += ((wantsGuitar ? 1 : 0) - cs.smoothGuitarWeight) * (1 - Math.exp(-10 * dt));
      cs.smoothPhotoWeight += ((wantsPhoto ? 1 : 0) - cs.smoothPhotoWeight) * (1 - Math.exp(-11 * dt));

      const targetGuitarFront =
        activeStrumming || (heldItem === 'guitar' && !m.moving) ? 1.0 : 0.0;
      cs.smoothGuitarFront +=
        (targetGuitarFront - cs.smoothGuitarFront) * (1 - Math.exp(-10 * dt));

      if (chestSocketRef.current) {
        chestSocketRef.current.visible = heldItem === 'guitar' || cs.smoothGuitarWeight > 0.04;
      }
      if (guitarInnerGroupRef.current) {
        const gf = cs.smoothGuitarFront;
        guitarInnerGroupRef.current.position.set(
          THREE.MathUtils.lerp(0.15, 0.02, gf),
          THREE.MathUtils.lerp(0.04, -0.04, gf),
          THREE.MathUtils.lerp(-0.18, 0.2, gf)
        );
        guitarInnerGroupRef.current.rotation.set(
          THREE.MathUtils.lerp(0.24, -0.12, gf),
          THREE.MathUtils.lerp(-0.45, 0.15, gf),
          THREE.MathUtils.lerp(-0.58, -1.12, gf)
        );
      }
      if (snapCameraFallbackRef.current) {
        snapCameraFallbackRef.current.visible =
          heldItem !== 'film_camera' && cs.smoothPhotoWeight > 0.12;
      }

      // Organic subtle chest breathing, acoustic jam groove & head look/shutter nod
      if (rigState.chestBone) {
        const jamGroove = activeStrumming ? Math.sin(cs.idleClock * 5.2) * 0.028 : 0;
        const breathPitch = Math.sin(cs.idleClock * 1.85) * 0.015 + jamGroove;
        _tmpEuler.set(breathPitch, 0, activeStrumming ? Math.cos(cs.idleClock * 2.6) * 0.022 : 0);
        rigState.chestBone.quaternion.multiply(_tmpQuat.setFromEuler(_tmpEuler));
      }
      if (rigState.headBone) {
        const lookYaw = cs.smoothBankRoll * 0.95 + Math.sin(cs.idleClock * 0.68) * 0.022;
        const sipNod =
          cs.smoothSipWeight * 0.12 +
          cs.smoothPhotoWeight * 0.06 +
          (activeStrumming ? Math.sin(cs.idleClock * 5.2) * 0.045 : 0);
        _tmpEuler.set(sipNod, lookYaw, cs.smoothPhotoWeight * -0.05);
        rigState.headBone.quaternion.multiply(_tmpQuat.setFromEuler(_tmpEuler));
      }

      const rightArmInfluence = Math.max(
        cs.smoothCarryWeight,
        cs.smoothSipWeight,
        cs.smoothCheersWeight,
        cs.smoothGuitarWeight,
        cs.smoothPhotoWeight
      );
      if (rightArmInfluence > 0.003 && rigState.upperArmRBone && rigState.lowerArmRBone) {
        const isLantern = heldItem === 'lantern';
        const baseUpper = isLantern ? Q_LANTERN_UPPER : Q_CUP_UPPER;
        const baseLower = isLantern ? Q_LANTERN_LOWER : Q_CUP_LOWER;
        const baseHand = isLantern ? Q_LANTERN_HAND : Q_CUP_HAND;

        _tmpQuatA
          .copy(baseUpper)
          .slerp(Q_SIP_UPPER, cs.smoothSipWeight)
          .slerp(Q_CHEERS_UPPER, cs.smoothCheersWeight)
          .slerp(Q_GUITAR_R_UPPER, cs.smoothGuitarWeight)
          .slerp(Q_PHOTO_R_UPPER, cs.smoothPhotoWeight);
        _tmpQuatB
          .copy(baseLower)
          .slerp(Q_SIP_LOWER, cs.smoothSipWeight)
          .slerp(Q_CHEERS_LOWER, cs.smoothCheersWeight)
          .slerp(Q_GUITAR_R_LOWER, cs.smoothGuitarWeight)
          .slerp(Q_PHOTO_R_LOWER, cs.smoothPhotoWeight);
        _tmpQuatC
          .copy(baseHand)
          .slerp(Q_SIP_HAND, cs.smoothSipWeight)
          .slerp(Q_CHEERS_HAND, cs.smoothCheersWeight)
          .slerp(Q_GUITAR_R_HAND, cs.smoothGuitarWeight)
          .slerp(Q_PHOTO_R_HAND, cs.smoothPhotoWeight);

        if (cs.smoothGuitarWeight > 0.01) {
          const strumAmp = activeStrumming ? 0.16 + jamLevel * 0.14 : 0.024;
          const strumWave =
            Math.sin(cs.idleClock * 11.4) * strumAmp +
            Math.sin(cs.idleClock * 22.8 + 0.7) * (strumAmp * 0.35);
          _tmpEuler.set(strumWave * cs.smoothGuitarWeight, 0, strumWave * 0.45 * cs.smoothGuitarWeight);
          _tmpQuatB.multiply(_tmpQuat.setFromEuler(_tmpEuler));
          _tmpEuler.set(strumWave * 0.65 * cs.smoothGuitarWeight, 0, 0);
          _tmpQuatC.multiply(_tmpQuat.setFromEuler(_tmpEuler));
        } else {
          const microBob = m.moving
            ? Math.sin(cs.idleClock * (m.running ? 10.5 : 7.2)) * 0.028
            : Math.sin(cs.idleClock * 1.9) * 0.012;
          _tmpEuler.set(microBob * (1 - cs.smoothPhotoWeight * 0.7), 0, 0);
          _tmpQuatB.multiply(_tmpQuat.setFromEuler(_tmpEuler));
        }

        if (rigState.shoulderRBone) {
          rigState.shoulderRBone.quaternion.slerp(Q_CARRY_SHOULDER, rightArmInfluence * 0.85);
        }
        rigState.upperArmRBone.quaternion.slerp(_tmpQuatA, rightArmInfluence);
        rigState.lowerArmRBone.quaternion.slerp(_tmpQuatB, rightArmInfluence);
        if (rigState.handRBone) {
          rigState.handRBone.quaternion.slerp(_tmpQuatC, rightArmInfluence);
        }

        for (let i = 0; i < rigState.fingerRBones.length; i++) {
          const fb = rigState.fingerRBones[i];
          fb.bone.quaternion.slerp(fb.gripQuat, rightArmInfluence * 0.96);
        }
      }

      // Left-arm IK for guitar neck fretting & two-handed camera viewfinder support
      const leftArmInfluence = Math.max(cs.smoothGuitarWeight, cs.smoothPhotoWeight);
      if (leftArmInfluence > 0.003 && rigState.upperArmLBone && rigState.lowerArmLBone) {
        const photoMix =
          leftArmInfluence > 0.0001 ? THREE.MathUtils.clamp(cs.smoothPhotoWeight / leftArmInfluence, 0, 1) : 0;
        _tmpQuatLA.copy(Q_GUITAR_L_UPPER).slerp(Q_PHOTO_L_UPPER, photoMix);
        _tmpQuatLB.copy(Q_GUITAR_L_LOWER).slerp(Q_PHOTO_L_LOWER, photoMix);
        _tmpQuatLC.copy(Q_GUITAR_L_HAND).slerp(Q_PHOTO_L_HAND, photoMix);

        if (cs.smoothGuitarWeight > 0.01 && activeStrumming) {
          // Subtle chord-shift slide along guitar neck
          const chordShift = Math.sin(cs.idleClock * 2.6) * 0.045 * cs.smoothGuitarWeight;
          _tmpEuler.set(chordShift, 0, 0);
          _tmpQuatLB.multiply(_tmpQuat.setFromEuler(_tmpEuler));
        }

        if (rigState.shoulderLBone) {
          rigState.shoulderLBone.quaternion.slerp(
            photoMix > 0.5 ? Q_PHOTO_L_SHOULDER : Q_GUITAR_L_SHOULDER,
            leftArmInfluence * 0.85
          );
        }
        rigState.upperArmLBone.quaternion.slerp(_tmpQuatLA, leftArmInfluence);
        rigState.lowerArmLBone.quaternion.slerp(_tmpQuatLB, leftArmInfluence);
        if (rigState.handLBone) {
          rigState.handLBone.quaternion.slerp(_tmpQuatLC, leftArmInfluence);
        }
      }

      // Refresh world matrices once after procedural bone adjustments so sockets & skinning match 1:1!
      const avatarRoot = avatarRootRef.current;
      if (avatarRoot) {
        avatarRoot.updateWorldMatrix(true, true);
        avatarRoot.getWorldQuaternion(_invRootQuat).invert();

        if (rigState.handRBone && handSocketRef.current) {
          rigState.handRBone.getWorldQuaternion(_worldQuat);
          if (rigState.middleKnuckleRBone) {
            rigState.middleKnuckleRBone.getWorldPosition(_worldPos);
            // Offset along RightHand local +Z (palm normal) & -Y so both female & male hands wrap snugly around the prop!
            _tmpPalmNormal.set(0, 0, 1).applyQuaternion(_worldQuat);
            _tmpFingerDir.set(0, 1, 0).applyQuaternion(_worldQuat);
            const palmOut = heldItem === 'lantern' ? 0.026 : 0.041;
            const alongFinger = heldItem === 'lantern' ? 0.004 : -0.012;
            _worldPos.addScaledVector(_tmpPalmNormal, palmOut).addScaledVector(_tmpFingerDir, alongFinger);
          } else {
            rigState.handRBone.getWorldPosition(_worldPos);
            _gripOffset.set(0.0, 0.078, 0.048).applyQuaternion(_worldQuat);
            _worldPos.add(_gripOffset);
          }
          avatarRoot.worldToLocal(_worldPos);
          handSocketRef.current.position.copy(_worldPos);

          // Keep cups, bouquets, lanterns & cameras naturally upright relative to gravity
          const isLantern = heldItem === 'lantern';
          const swayFreq = m.moving ? 6.8 : 2.1;
          const swayAmp = isLantern ? (m.moving ? 0.085 : 0.025) : m.moving ? 0.016 : 0.005;
          const pitchTilt =
            -0.34 * cs.smoothSipWeight +
            0.09 * cs.smoothCheersWeight +
            Math.sin(cs.idleClock * swayFreq) * swayAmp;
          const rollTilt =
            0.06 * cs.smoothSipWeight -
            0.05 * cs.smoothCheersWeight +
            Math.cos(cs.idleClock * swayFreq * 0.83) * swayAmp * 0.7;
          handSocketRef.current.rotation.set(pitchTilt, 0, rollTilt);
        }

        if (rigState.chestBone) {
          rigState.chestBone.getWorldPosition(_worldPos);
          rigState.chestBone.getWorldQuaternion(_worldQuat);
          avatarRoot.worldToLocal(_worldPos);
          _tmpQuat.copy(_invRootQuat).multiply(_worldQuat);

          if (chestSocketRef.current) {
            chestSocketRef.current.position.copy(_worldPos);
            chestSocketRef.current.quaternion.copy(_tmpQuat);
          }
          if (wearableChestSocketRef.current) {
            wearableChestSocketRef.current.position.copy(_worldPos);
            wearableChestSocketRef.current.quaternion.copy(_tmpQuat);
          }
        }

        if (rigState.headBone) {
          rigState.headBone.getWorldPosition(_worldPos);
          rigState.headBone.getWorldQuaternion(_worldQuat);
          avatarRoot.worldToLocal(_worldPos);

          if (headSocketRef.current) {
            headSocketRef.current.position.copy(_worldPos);
          }
          if (wearableHeadSocketRef.current) {
            wearableHeadSocketRef.current.position.copy(_worldPos);
            wearableHeadSocketRef.current.quaternion.copy(_invRootQuat).multiply(_worldQuat);
          }
        }
      }
    }

    // Sparkler star-burst twinkle
    if (sparklerBurstRef.current && heldItem === 'sparkler') {
      sparklerBurstRef.current.rotation.y = cs.idleClock * 6.5;
      sparklerBurstRef.current.rotation.z = Math.sin(cs.idleClock * 14) * 0.35;
      const pulse = 0.88 + Math.sin(cs.idleClock * 22) * 0.18;
      sparklerBurstRef.current.scale.setScalar(pulse);
    }

    // Rising Hot Drink & Grilled Highland Snack Steam Wisps
    const hasHotSteam = isWarmEdibleOrDrinkProp(heldItem);
    const steamMeshes = [steam1Ref.current, steam2Ref.current, steam3Ref.current];
    for (let i = 0; i < 3; i++) {
      const sm = steamMeshes[i];
      if (!sm) continue;
      sm.visible = hasHotSteam;
      if (hasHotSteam) {
        const u = (((cs.idleClock * 0.65 + i * 0.33) % 1) + 1) % 1;
        sm.position.set(
          Math.sin(cs.idleClock * 2.4 + i * 2.1) * 0.018,
          0.075 + u * 0.15,
          Math.cos(cs.idleClock * 1.9 + i) * 0.014
        );
        const sc = (0.35 + u * 0.85) * Math.sin(u * Math.PI);
        sm.scale.setScalar(Math.max(0.001, sc));
      }
    }

    // Cold Highland Breath Vapor Puffs (< 13.5°C and not warm-buffed)
    const emitColdBreath = m.temperatureC < 13.5 && !m.warmBuff;
    cs.breathCycle = (cs.breathCycle + dt) % 3.2;
    const breathActive = emitColdBreath && cs.breathCycle < 1.35;
    const puffs = [breath1Ref.current, breath2Ref.current];
    const puffMats = [propMats.vaporMat1, propMats.vaporMat2];
    for (let i = 0; i < 2; i++) {
      const pf = puffs[i];
      if (!pf) continue;
      const age = cs.breathCycle - i * 0.16;
      if (breathActive && age > 0 && age < 1.15) {
        const t = age / 1.15;
        pf.visible = true;
        pf.position.set(
          (i === 0 ? -0.01 : 0.012) + Math.sin(cs.idleClock * 3 + i) * 0.018 * t,
          0.04 + t * 0.095,
          0.14 + t * 0.21
        );
        pf.scale.setScalar(0.45 + t * 1.65);
        puffMats[i].uniforms.uOpacity.value = Math.sin(t * Math.PI) * 0.36;
      } else {
        pf.visible = false;
      }
    }

    if (shadowRef.current && avatarRootRef.current) {
      const targetShadowScale = isSeated ? 0.86 : m.grounded ? 1.0 : 0.78;
      shadowRef.current.scale.setScalar(targetShadowScale);
      const targetShadowOpacity = isSeated ? 0.30 : m.grounded ? 0.42 : 0.15;
      const curOp = propMats.shadowMat.uniforms.uOpacity.value as number;
      propMats.shadowMat.uniforms.uOpacity.value =
        curOp + (targetShadowOpacity - curOp) * (1 - Math.exp(-14 * dt));

      // Align contact shadow smoothly to local terrain or wooden-bridge ramp slope!
      avatarRootRef.current.getWorldPosition(_worldPos);
      avatarRootRef.current.getWorldQuaternion(_invRootQuat);
      _invRootQuat.invert();

      const eps = 0.28;
      const hX1 = sampleWalkableHeight(_worldPos.x - eps, _worldPos.z);
      const hX2 = sampleWalkableHeight(_worldPos.x + eps, _worldPos.z);
      const hZ1 = sampleWalkableHeight(_worldPos.x, _worldPos.z - eps);
      const hZ2 = sampleWalkableHeight(_worldPos.x, _worldPos.z + eps);
      // Guard against sharp deck-ledge step drops (> 0.36m across 0.56m)
      const dhdx = Math.abs(hX2 - hX1) < 0.36 ? (hX2 - hX1) / (eps * 2) : 0;
      const dhdz = Math.abs(hZ2 - hZ1) < 0.36 ? (hZ2 - hZ1) / (eps * 2) : 0;
      _shadowUpWorld.set(-dhdx, 1, -dhdz).normalize().applyQuaternion(_invRootQuat).normalize();
      _shadowTiltQuat.setFromUnitVectors(_upAxisY, _shadowUpWorld);
      shadowRef.current.quaternion.copy(_shadowTiltQuat).multiply(_shadowBaseQuat);
      shadowRef.current.position.set(
        _shadowUpWorld.x * 0.015,
        _shadowUpWorld.y * 0.015,
        _shadowUpWorld.z * 0.015
      );
    }
  });

  const isCrownOrMuffs = outfit.headwear === 'earmuffs' || outfit.headwear === 'flower_crown';

  return (
    <group ref={avatarRootRef}>
      {/* Soft Ground Contact Shadow */}
      <mesh
        ref={shadowRef}
        geometry={SHARED_HELD_PROPS.shadowBlob}
        material={propMats.shadowMat}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.003, 0]}
      />

      {/* Real Rigged CC0 SkinnedMesh Hiker */}
      <group ref={charOffsetRef}>
        {rigState && <primitive object={rigState.root} />}
      </group>

      {/* 0.94x Rig-Matched Chest Wearable Socket (Coat Layering, Scarves/Camera Strap, Custom Bags) */}
      <group ref={wearableChestSocketRef} scale={0.94} visible={Boolean(rigState)}>
        {coatOverlayGeo && (
          <mesh
            geometry={coatOverlayGeo}
            material={SHARED_VCOLOR_MAT}
            castShadow={isLocal}
            receiveShadow
          />
        )}
        {customNeckwearGeo && !(effNeckwear === 'camera_strap' && heldItem === 'film_camera') && (
          <mesh
            geometry={customNeckwearGeo}
            material={SHARED_VCOLOR_MAT}
            castShadow={isLocal}
            receiveShadow
          />
        )}
        {customBagGeo && (
          <mesh
            ref={customBagMeshRef}
            geometry={customBagGeo}
            material={SHARED_VCOLOR_MAT}
            castShadow={isLocal}
            receiveShadow
          />
        )}
      </group>

      {/* 0.94x Rig-Matched Head Wearable Socket (Custom Hats, Flower Crowns, Earmuffs, Glasses, Blush) */}
      <group ref={wearableHeadSocketRef} scale={0.94} visible={Boolean(rigState)}>
        {customHeadwearGeo && (
          <mesh
            geometry={customHeadwearGeo}
            material={SHARED_VCOLOR_MAT}
            position={[
              0,
              isCrownOrMuffs
                ? isMaleRig
                  ? 0.160
                  : 0.153
                : isMaleRig
                  ? 0.155
                  : 0.146,
              isCrownOrMuffs
                ? isMaleRig
                  ? 0.006
                  : -0.004
                : isMaleRig
                  ? 0.008
                  : -0.008,
            ]}
            rotation={[isCrownOrMuffs ? 0 : -0.06, 0, 0]}
            scale={isCrownOrMuffs ? 1.15 : 1.18}
            castShadow={isLocal}
            receiveShadow
          />
        )}
        {eyewearGroup && (
          <primitive
            object={eyewearGroup}
            position={[0, 0.088, isMaleRig ? 0.119 : 0.102]}
          />
        )}
      </group>

      {/* Upright Gravity-Aligned 1:1 Meter Right-Palm Prop Socket */}
      <group ref={handSocketRef} position={[-0.06, 1.13, 0.31]}>
        {heldItem === 'soy_milk' && (
          <group position={[0, 0.004, 0]}>
            <mesh geometry={SHARED_HELD_PROPS.soyLiquid} material={propMats.soyMat} position={[0, -0.004, 0]} />
            <mesh geometry={SHARED_HELD_PROPS.soyGlass} material={propMats.glassMat} />
          </group>
        )}

        {heldItem === 'phin_coffee' && (
          <group position={[0, 0.004, 0]}>
            <mesh geometry={SHARED_HELD_PROPS.phinCoreFull} material={SHARED_VCOLOR_MAT} />
            <mesh geometry={SHARED_HELD_PROPS.phinCup} material={propMats.glassMat} />
          </group>
        )}

        {heldItem === 'roasted_corn' && (
          <group position={[0, 0.012, 0]} rotation={[0.12, 0, -0.08]}>
            <mesh geometry={SHARED_HELD_PROPS.roastedCornFull} material={SHARED_VCOLOR_MAT} />
          </group>
        )}

        {heldItem === 'sweet_potato' && (
          <group position={[0, 0.006, 0]} rotation={[0.1, 0, -0.06]}>
            <mesh geometry={SHARED_HELD_PROPS.sweetPotatoFull} material={SHARED_VCOLOR_MAT} />
          </group>
        )}

        {heldItem === 'hydrangea_bouquet' && (
          <group position={[0, 0.015, 0.01]} rotation={[0.2, 0, -0.14]}>
            <mesh geometry={SHARED_HELD_PROPS.hydrangeaBouquetFull} material={SHARED_VCOLOR_MAT} />
          </group>
        )}

        {heldItem === 'da_quy_bouquet' && (
          <group position={[0, 0.015, 0.01]} rotation={[0.22, 0, -0.14]}>
            <mesh geometry={SHARED_HELD_PROPS.daQuyBouquetFull} material={SHARED_VCOLOR_MAT} />
          </group>
        )}

        <group position={[0, 0.02, 0]}>
          <mesh ref={steam1Ref} geometry={SHARED_HELD_PROPS.vaporPuff} material={propMats.steamMat} visible={false} />
          <mesh ref={steam2Ref} geometry={SHARED_HELD_PROPS.vaporPuff} material={propMats.steamMat} visible={false} />
          <mesh ref={steam3Ref} geometry={SHARED_HELD_PROPS.vaporPuff} material={propMats.steamMat} visible={false} />
        </group>

        {heldItem === 'film_camera' && (
          <group position={[0, 0.015, 0.018]} rotation={[0, -0.25, 0]}>
            <mesh geometry={SHARED_HELD_PROPS.cameraFull} material={SHARED_METALLIC_VCOLOR_MAT} />
          </group>
        )}
        <group
          ref={snapCameraFallbackRef}
          position={[0, 0.015, 0.018]}
          rotation={[0, -0.25, 0]}
          visible={false}
        >
          <mesh geometry={SHARED_HELD_PROPS.cameraFull} material={SHARED_METALLIC_VCOLOR_MAT} />
        </group>

        {heldItem === 'lantern' && (
          <group position={[0, -0.098, 0]}>
            <mesh geometry={SHARED_HELD_PROPS.lanternBrassFull} material={SHARED_METALLIC_VCOLOR_MAT} />
            <mesh geometry={SHARED_HELD_PROPS.lanternGlobe} material={propMats.lanternGlowMat} position={[0, -0.018, 0]} />
            <mesh geometry={SHARED_HELD_PROPS.lanternHalo} material={propMats.lanternHaloMat} position={[0, -0.018, 0]} />
          </group>
        )}

        {heldItem === 'sparkler' && (
          <group position={[0, 0.01, 0]} rotation={[0.18, 0, -0.14]}>
            <mesh geometry={SHARED_HELD_PROPS.sparklerRodGeo} material={SHARED_METALLIC_VCOLOR_MAT} />
            <mesh
              ref={sparklerBurstRef}
              geometry={SHARED_HELD_PROPS.sparklerBurstGeo}
              material={propMats.sparklerBurstMat}
              position={[0, 0.145, 0]}
            />
          </group>
        )}
      </group>

      {/* Unscaled 1:1 Meter Chest Guitar Socket (updated live inside useFrame via guitarInnerGroupRef) */}
      <group ref={chestSocketRef} visible={heldItem === 'guitar'}>
        <group
          ref={guitarInnerGroupRef}
          position={[0.02, -0.04, 0.2]}
          rotation={[-0.12, 0.15, -1.12]}
        >
          <mesh geometry={SHARED_HELD_PROPS.guitarFull} material={SHARED_VCOLOR_MAT} />
        </group>
      </group>

      {/* Head Cold-Breath Vapor Socket */}
      <group ref={headSocketRef} position={[0, 1.54, 0]}>
        <mesh ref={breath1Ref} geometry={SHARED_HELD_PROPS.vaporPuff} material={propMats.vaporMat1} visible={false} />
        <mesh ref={breath2Ref} geometry={SHARED_HELD_PROPS.vaporPuff} material={propMats.vaporMat2} visible={false} />
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
  const localAuxLightRef = useRef<THREE.PointLight>(null);
  const prevYawRef = useRef<number>(0);

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
    turnBank: 0,
  });

  const readCurrentMotion = () => {
    const st = useGameStore.getState();
    const lt = st.localTransient;
    const dressing = !st.hasEnteredWorld || st.activeModal === 'wardrobe';
    const jamAge = st.lastJamNote ? (Date.now() - st.lastJamNote.timestamp) / 1000 : 99;
    const isMyJam =
      st.lastJamNote &&
      (st.lastJamNote.senderId === st.localSessionId || st.lastJamNote.senderId === 'local');

    const m = motionSample.current;
    m.moving = dressing ? false : lt.moving;
    m.running = dressing ? false : lt.running;
    m.grounded = dressing ? true : lt.grounded;
    m.speed = dressing ? 0 : Math.hypot(lt.vx, lt.vz);
    m.seated = dressing ? false : Boolean(st.seatedBenchId);
    m.emote = st.activeEmote;
    m.warmBuff = st.warmthRemainingSec > 0;
    m.temperatureC = st.atmosphere.temperatureC;
    m.windStrength = st.atmosphere.windStrength;
    m.jamPulse = isMyJam && jamAge < 1.4 ? 1 - jamAge / 1.4 : 0;
    return m;
  };

  useFrame(({ camera }, rawDt) => {
    const dt = Math.max(0.001, Math.min(rawDt, 0.06));
    const st = useGameStore.getState();
    const lt = st.localTransient;
    const dressing = !st.hasEnteredWorld || st.activeModal === 'wardrobe';

    let renderYaw = lt.yaw;
    if (groupRef.current) {
      groupRef.current.visible = !st.photoModeActive;
      groupRef.current.position.set(lt.x, lt.y, lt.z);
      if (dressing) {
        // Face smoothly toward the dressing portrait camera + user's 360° turntable drag angle!
        const toCamYaw = Math.atan2(camera.position.x - lt.x, camera.position.z - lt.z);
        renderYaw = toCamYaw - 0.16 + lt.previewCurrentYaw;
        groupRef.current.rotation.y = renderYaw;
      } else {
        groupRef.current.rotation.y = lt.yaw;
      }
    }

    // Keep exactly 1 permanently mounted local PointLight so Three.js numPointLights NEVER changes
    // across World Entry, Wardrobe, Photo Mode, or Held Prop switches (zero GLSL shader recompiles!).
    const auxLight = localAuxLightRef.current;
    if (auxLight) {
      const sinY = Math.sin(renderYaw);
      const cosY = Math.cos(renderYaw);
      if (dressing && !st.photoModeActive) {
        auxLight.color.setHex(0xfff0d8);
        auxLight.intensity = 1.75;
        auxLight.distance = 6.2;
        auxLight.decay = 1.6;
        auxLight.position.set(
          lt.x + 0.45 * cosY + 1.85 * sinY,
          lt.y + 1.85,
          lt.z - 0.45 * sinY + 1.85 * cosY
        );
      } else if (!st.photoModeActive && st.heldItem === 'lantern') {
        auxLight.color.setHex(0xffb347);
        auxLight.intensity = 2.4;
        auxLight.distance = 13.0;
        auxLight.decay = 1.8;
        auxLight.position.set(lt.x + 0.36 * sinY + 0.24 * cosY, lt.y + 1.05, lt.z + 0.36 * cosY - 0.24 * sinY);
      } else if (!st.photoModeActive && st.heldItem === 'sparkler') {
        auxLight.color.setHex(0xffd97d);
        auxLight.intensity = 1.5;
        auxLight.distance = 5.5;
        auxLight.decay = 2.0;
        auxLight.position.set(lt.x + 0.36 * sinY + 0.24 * cosY, lt.y + 1.22, lt.z + 0.36 * cosY - 0.24 * sinY);
      } else {
        auxLight.intensity = 0;
      }
    }

    let yawDelta = ((lt.yaw - prevYawRef.current + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    prevYawRef.current = lt.yaw;
    const yawRate = dressing
      ? THREE.MathUtils.clamp(lt.previewYawVel * 0.075, -0.6, 0.6)
      : THREE.MathUtils.clamp((yawDelta / dt) * 0.16, -1, 1);

    motionSample.current.turnBank = -yawRate;
  });

  return (
    <>
      <group ref={groupRef} visible={!photoModeActive}>
        <HighlandAvatar
          outfit={outfit}
          heldItem={heldItem}
          isLocal={true}
          seed={0.19}
          getMotion={readCurrentMotion}
        />
      </group>
      <pointLight
        ref={localAuxLightRef}
        color="#FFF0D8"
        intensity={1.75}
        distance={6.2}
        decay={1.6}
        position={[-30.35, 137.15, 34.35]}
      />
    </>
  );
}
