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

export function loadMasterHikerGroup(url: string): Promise<THREE.Group | null> {
  const cached = masterHikerCache.get(url);
  if (cached) return cached;

  const p = (async () => {
    try {
      const loader = await getAvatarGltfLoader();
      const gltf = await loader.loadAsync(url);
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
const _tmpPalmNormal = new THREE.Vector3();
const _tmpFingerDir = new THREE.Vector3();
const _tmpEuler = new THREE.Euler();
const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _gripOffset = new THREE.Vector3();
const _invRootQuat = new THREE.Quaternion();

interface ClonedHikerRig {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  backpackObjs: THREE.Object3D[];
  shoulderRBone: THREE.Object3D | null;
  upperArmRBone: THREE.Object3D | null;
  lowerArmRBone: THREE.Object3D | null;
  handRBone: THREE.Object3D | null;
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
      mesh.castShadow = isLocal;
      mesh.receiveShadow = isLocal;
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
          std.roughness = Math.max(std.roughness, 0.78);
          std.metalness = Math.min(std.metalness, 0.04);
          std.envMapIntensity = 0.35;
          std.userData.bootTuned = true;
        }
        // Gentle warm dawn bounce on genuine Ready Player Me face/skin textures without washing out eyes/lips!
        if (
          (mName.includes('Wolf3D_Skin') ||
            mName.includes('Wolf3D_Head') ||
            mName.includes('Wolf3D_Body')) &&
          std.isMeshStandardMaterial &&
          !std.userData.warmTuned
        ) {
          std.emissive.set('#381810');
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
    lodAccumDt: 0,
    smoothSeatY: 0,
    smoothSeatZ: 0,
    smoothBankRoll: 0,
    smoothCarryWeight: 0,
    smoothSipWeight: 0,
    smoothCheersWeight: 0,
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

  // Load & clone rigged SkinnedMesh GLB + bind shared AnimationClips
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [masterScene, sharedAnim] = await Promise.all([
        loadMasterHikerGroup(modelUrl),
        loadSharedHikerClips(),
      ]);
      if (cancelled || !masterScene) return;

      const { clips: clipMap } = sharedAnim;
      const cloned = SkeletonUtils.clone(masterScene) as THREE.Group;
      // Scale comfortably to ~1.72m human highland hiker height
      cloned.scale.setScalar(0.94);

      const backpackObjs: THREE.Object3D[] = [];
      let shoulderRBone: THREE.Object3D | null = null;
      let upperArmRBone: THREE.Object3D | null = null;
      let lowerArmRBone: THREE.Object3D | null = null;
      let handRBone: THREE.Object3D | null = null;
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
      };

      setRigState({
        root: cloned,
        mixer,
        actions,
        backpackObjs,
        shoulderRBone,
        upperArmRBone,
        lowerArmRBone,
        handRBone,
        middleKnuckleRBone,
        chestBone,
        headBone,
        fingerRBones,
      });
    })();

    return () => {
      cancelled = true;
      setRigState((prev) => {
        if (prev) {
          prev.mixer.stopAllAction();
        }
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
      vaporMat1: new THREE.MeshBasicMaterial({
        color: '#F6FAFF',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
      vaporMat2: new THREE.MeshBasicMaterial({
        color: '#F6FAFF',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
      steamMat: new THREE.MeshBasicMaterial({
        color: '#FFFDF8',
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
      shadowMat: new THREE.MeshBasicMaterial({
        color: '#0D1320',
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      }),
    };
  }, []);

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
      const dz = pPos.z - camera.position.z;
      const distSq = dx * dx + dz * dz;
      cs.lodFrame = (cs.lodFrame + 1) % 3;
      cs.lodAccumDt += rawStep;
      // Throttle distant remote peer skeleton/socket updates (>24m -> 20 Hz) to keep 60 FPS locked!
      if (distSq > 24 * 24 && cs.lodFrame !== 0) {
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

      // 1. Continuous 4-way locomotion blend tree (Idle <-> Walk <-> Run <-> Sprint, zero .reset() snaps!)
      const effSpeed = !isSeated && m.grounded ? (m.moving ? m.speed : m.speed * 0.5) : 0;
      let rawIdle = 0;
      let rawWalk = 0;
      let rawRun = 0;
      let rawSprint = 0;

      if (effSpeed <= 0.05) {
        rawIdle = 1;
      } else if (effSpeed < 3.5) {
        const u = THREE.MathUtils.smoothstep(effSpeed, 0.05, 3.5);
        rawIdle = 1 - u;
        rawWalk = u;
      } else if (effSpeed < 6.0) {
        const u = THREE.MathUtils.clamp((effSpeed - 3.5) / 2.5, 0, 1);
        rawWalk = 1 - u;
        rawRun = u;
      } else {
        const u = THREE.MathUtils.clamp((effSpeed - 6.0) / 1.8, 0, 1);
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

      for (const name of LOCOMOTION_CLIPS) {
        const act = actions[name];
        if (!act) continue;
        const targetW = locoTargets[name];
        const prevW = cs.weights[name] ?? 0;
        const nextW = prevW + (targetW - prevW) * weightBlend;
        cs.weights[name] = nextW < 0.001 && targetW === 0 ? 0 : nextW;

        if (cs.weights[name] > 0.001) {
          act.enabled = true;
          act.setEffectiveWeight(cs.weights[name]);
        } else {
          act.enabled = false;
          act.setEffectiveWeight(0);
        }
      }

      // Match stride cadence directly to ground speed so feet never ice-skate
      if (actions.Walk) {
        actions.Walk.timeScale = THREE.MathUtils.clamp(Math.max(1.8, effSpeed) / 3.5, 0.72, 1.35);
      }
      if (actions.Run) {
        actions.Run.timeScale = THREE.MathUtils.clamp(Math.max(4.2, effSpeed) / 5.7, 0.8, 1.28);
      }
      if (actions.Sprint) {
        actions.Sprint.timeScale = THREE.MathUtils.clamp(Math.max(5.8, effSpeed) / 7.2, 0.85, 1.25);
      }

      mixer.update(dt);

      // 3. Per-rig sole contact calibration & ergonomic bench seating alignment (seat plank top = 0.451m)
      const baseGroundY = !isMaleRig ? 0.026 : 0.008;
      const targetSeatY = isSeated ? -0.41 + baseGroundY : baseGroundY;
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

      // 4. Organic subtle chest breathing & natural head look-into-turn micro-motion
      if (rigState.chestBone) {
        const breathPitch = Math.sin(cs.idleClock * 1.85) * 0.015;
        _tmpEuler.set(breathPitch, 0, 0);
        rigState.chestBone.quaternion.multiply(_tmpQuat.setFromEuler(_tmpEuler));
      }
      if (rigState.headBone) {
        const lookYaw = cs.smoothBankRoll * 0.95 + Math.sin(cs.idleClock * 0.68) * 0.022;
        const sipNod = cs.smoothSipWeight * 0.12;
        _tmpEuler.set(sipNod, lookYaw, 0);
        rigState.headBone.quaternion.multiply(_tmpQuat.setFromEuler(_tmpEuler));
      }

      // 5. Post-mixer twist-free anatomical right-arm carry, warm drink/snack sip & cheers IK blend
      const fullBodyEmoteActive =
        !isSeated &&
        !m.moving &&
        (m.emote === 'wave' || m.emote === 'warm_hands' || m.emote === 'cheer_sunrise');
      const wantsCarry =
        !fullBodyEmoteActive && heldItem !== 'none' && heldItem !== 'guitar';
      const isWarmItem = isWarmEdibleOrDrinkProp(heldItem);
      const wantsSip =
        !fullBodyEmoteActive && m.emote === 'sip_drink' && isWarmItem;
      const wantsCheers =
        !fullBodyEmoteActive &&
        m.emote === 'cheers_cup' &&
        (isWarmItem || heldItem === 'sparkler');

      const targetCarry = wantsCarry ? 1.0 : 0.0;
      const targetSip = wantsSip ? 1.0 : 0.0;
      const targetCheers = wantsCheers ? 1.0 : 0.0;
      cs.smoothCarryWeight += (targetCarry - cs.smoothCarryWeight) * (1 - Math.exp(-12 * dt));
      cs.smoothSipWeight += (targetSip - cs.smoothSipWeight) * (1 - Math.exp(-8 * dt));
      cs.smoothCheersWeight += (targetCheers - cs.smoothCheersWeight) * (1 - Math.exp(-9 * dt));

      const armInfluence = Math.max(cs.smoothCarryWeight, cs.smoothSipWeight, cs.smoothCheersWeight);
      if (armInfluence > 0.003 && rigState.upperArmRBone && rigState.lowerArmRBone) {
        const isLantern = heldItem === 'lantern';
        const baseUpper = isLantern ? Q_LANTERN_UPPER : Q_CUP_UPPER;
        const baseLower = isLantern ? Q_LANTERN_LOWER : Q_CUP_LOWER;
        const baseHand = isLantern ? Q_LANTERN_HAND : Q_CUP_HAND;

        _tmpQuatA.copy(baseUpper).slerp(Q_SIP_UPPER, cs.smoothSipWeight).slerp(Q_CHEERS_UPPER, cs.smoothCheersWeight);
        _tmpQuatB.copy(baseLower).slerp(Q_SIP_LOWER, cs.smoothSipWeight).slerp(Q_CHEERS_LOWER, cs.smoothCheersWeight);
        _tmpQuatC.copy(baseHand).slerp(Q_SIP_HAND, cs.smoothSipWeight).slerp(Q_CHEERS_HAND, cs.smoothCheersWeight);

        // Add subtle organic stride/breathing micro-bob around anatomical elbow flexion axis (+X)
        const microBob = m.moving
          ? Math.sin(cs.idleClock * (m.running ? 10.5 : 7.2)) * 0.028
          : Math.sin(cs.idleClock * 1.9) * 0.012;
        _tmpEuler.set(microBob, 0, 0);
        _tmpQuatB.multiply(_tmpQuat.setFromEuler(_tmpEuler));

        if (rigState.shoulderRBone) {
          rigState.shoulderRBone.quaternion.slerp(Q_CARRY_SHOULDER, armInfluence * 0.85);
        }
        rigState.upperArmRBone.quaternion.slerp(_tmpQuatA, armInfluence);
        rigState.lowerArmRBone.quaternion.slerp(_tmpQuatB, armInfluence);
        if (rigState.handRBone) {
          rigState.handRBone.quaternion.slerp(_tmpQuatC, armInfluence);
        }

        for (let i = 0; i < rigState.fingerRBones.length; i++) {
          const fb = rigState.fingerRBones[i];
          fb.bone.quaternion.slerp(fb.gripQuat, armInfluence * 0.96);
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
        pf.scale.setScalar(0.42 + t * 1.55);
        puffMats[i].opacity = Math.sin(t * Math.PI) * 0.42;
      } else {
        pf.visible = false;
      }
    }

    if (shadowRef.current) {
      shadowRef.current.scale.setScalar(isSeated ? 0.85 : m.grounded ? 1 : 0.72);
    }
  });

  const isPlayingGuitar = heldItem === 'guitar' && !getMotion().moving;
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

        {heldItem === 'lantern' && (
          <group position={[0, -0.098, 0]}>
            <mesh geometry={SHARED_HELD_PROPS.lanternBrassFull} material={SHARED_METALLIC_VCOLOR_MAT} />
            <mesh geometry={SHARED_HELD_PROPS.lanternGlobe} material={propMats.lanternGlowMat} position={[0, -0.018, 0]} />
            <mesh geometry={SHARED_HELD_PROPS.lanternHalo} material={propMats.lanternHaloMat} position={[0, -0.018, 0]} />
            {isLocal && (
              <pointLight
                color="#FFB347"
                intensity={2.4}
                distance={13}
                decay={1.8}
                position={[0, -0.02, 0.08]}
              />
            )}
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
            {isLocal && (
              <pointLight
                color="#FFD97D"
                intensity={1.5}
                distance={5.5}
                decay={2}
                position={[0, 0.145, 0.04]}
              />
            )}
          </group>
        )}
      </group>

      {/* Unscaled 1:1 Meter Chest Guitar Socket */}
      <group ref={chestSocketRef} visible={heldItem === 'guitar'}>
        <group
          position={isPlayingGuitar ? [0.02, -0.04, 0.2] : [0.15, 0.04, -0.18]}
          rotation={isPlayingGuitar ? [-0.12, 0.15, -1.12] : [0.24, -0.45, -0.58]}
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
  const isDressingPreview = useGameStore(
    (s) => !s.hasEnteredWorld || s.activeModal === 'wardrobe'
  );
  const groupRef = useRef<THREE.Group>(null);
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

    if (groupRef.current) {
      groupRef.current.visible = !st.photoModeActive;
      groupRef.current.position.set(lt.x, lt.y, lt.z);
      if (dressing) {
        // Face smoothly toward the dressing portrait camera + user's 360° turntable drag angle!
        const toCamYaw = Math.atan2(camera.position.x - lt.x, camera.position.z - lt.z);
        groupRef.current.rotation.y = toCamYaw - 0.16 + lt.previewCurrentYaw;
      } else {
        groupRef.current.rotation.y = lt.yaw;
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
    <group ref={groupRef} visible={!photoModeActive}>
      <HighlandAvatar
        outfit={outfit}
        heldItem={heldItem}
        isLocal={true}
        seed={0.19}
        getMotion={readCurrentMotion}
      />
      {/* Warm highland portrait key-light active during Landing / Wardrobe outfit selection */}
      {isDressingPreview && (
        <pointLight
          color="#FFF0D8"
          intensity={1.75}
          distance={6.2}
          decay={1.6}
          position={[0.45, 1.85, 1.85]}
        />
      )}
    </group>
  );
}
