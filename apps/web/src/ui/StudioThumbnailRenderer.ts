import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type {
  AvatarGender,
  BagStyleId,
  CoatStyleId,
  EyewearId,
  HeadwearId,
  HeldItemId,
  NeckwearId,
  PlayerOutfit,
} from '@dalat/protocol';
import { DEFAULT_OUTFIT } from '@dalat/protocol';
import {
  applyOutfitToClonedHiker,
  loadMasterHikerGroup,
  loadSharedHikerClips,
} from '../gameplay/HighlandAvatar';
import {
  buildEyewearGroup,
  buildStandaloneHeldPropObject,
  getCoatOverlayGeometry,
  getCustomBagGeometry,
  getCustomHeadwearGeometry,
  getCustomNeckwearGeometry,
  isMaleCoatStyle,
  resolveBaseGlbForCoat,
  SHARED_VCOLOR_MAT,
} from '../gameplay/WardrobeAssets3D';

const THUMB_PX = 128;
const DEFAULT_REF_GLB = '/assets/models/hiker_f_adventurer.glb?v=rpm2';
const DEFAULT_MALE_REF_GLB = '/assets/models/hiker_m_jacket.glb?v=rpm2';

interface StudioPosedRig {
  root: THREE.Group;
  spine2MatrixWorld: THREE.Matrix4;
  bounds: {
    coat: THREE.Box3;
    beanie: THREE.Box3;
    beret: THREE.Box3;
    scarf: THREE.Box3;
    backpack: THREE.Box3;
    hair: THREE.Box3;
  };
}

const dataUrlCache = new Map<string, string>();
const inflightJobs = new Map<string, Promise<string>>();
const studioRigCache = new Map<string, Promise<StudioPosedRig | null>>();

let studioCtx: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  subjectRoot: THREE.Group;
  camera: THREE.PerspectiveCamera;
} | null = null;

const STUDIO_IDLE_DISPOSE_MS = 1500;
let idleDisposeTimer: ReturnType<typeof setTimeout> | null = null;

function cancelStudioIdleDispose(): void {
  if (idleDisposeTimer !== null) {
    clearTimeout(idleDisposeTimer);
    idleDisposeTimer = null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    const cleanup = () => {
      reader.onloadend = null;
      reader.onerror = null;
    };
    reader.onloadend = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      cleanup();
      resolve(res);
    };
    reader.onerror = () => {
      cleanup();
      resolve('');
    };
    reader.readAsDataURL(blob);
  });
}

async function canvasToThumbnailDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  if (typeof canvas.toBlob === 'function') {
    const webpBlob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b), 'image/webp', 0.86);
      } catch {
        resolve(null);
      }
    });
    if (webpBlob && webpBlob.type === 'image/webp') {
      const url = await blobToDataUrl(webpBlob);
      if (url) return url;
    }
    const pngBlob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b), 'image/png');
      } catch {
        resolve(null);
      }
    });
    if (pngBlob) {
      const url = await blobToDataUrl(pngBlob);
      if (url) return url;
    }
  }
  const webp = canvas.toDataURL('image/webp', 0.86);
  if (webp.startsWith('data:image/webp')) return webp;
  return canvas.toDataURL('image/png');
}

function getStudioContext() {
  cancelStudioIdleDispose();
  if (studioCtx) return studioCtx;

  const canvas = document.createElement('canvas');
  canvas.width = THUMB_PX;
  canvas.height = THUMB_PX;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(THUMB_PX, THUMB_PX, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();

  const hemi = new THREE.HemisphereLight('#FFF6E8', '#2E3B55', 1.28);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight('#FFF1DA', 2.15);
  keyLight.position.set(2.4, 3.4, 3.8);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight('#9EC5FF', 1.05);
  rimLight.position.set(-2.6, 2.2, -2.8);
  scene.add(rimLight);

  const fillLight = new THREE.DirectionalLight('#FFD7A8', 0.72);
  fillLight.position.set(-2.0, 0.7, 2.5);
  scene.add(fillLight);

  const backKeyLight = new THREE.DirectionalLight('#FFF0D8', 1.85);
  backKeyLight.position.set(-2.2, 3.0, -3.6);
  scene.add(backKeyLight);

  const subjectRoot = new THREE.Group();
  scene.add(subjectRoot);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 20);

  studioCtx = { renderer, scene, subjectRoot, camera };
  return studioCtx;
}

function computeSkinnedSubtreeBox(root: THREE.Group, predicate: (name: string) => boolean): THREE.Box3 {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();

  root.traverse((obj) => {
    const ownMatch = predicate(obj.name || '');
    const parentMatch = obj.parent ? predicate(obj.parent.name || '') : false;
    if (!ownMatch && !parentMatch) return;

    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = obj as THREE.SkinnedMesh;
      const pos = sm.geometry.getAttribute('position');
      if (!pos) return;
      const step = Math.max(1, Math.floor(pos.count / 450));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i);
        sm.applyBoneTransform(i, v);
        v.applyMatrix4(sm.matrixWorld);
        box.expandByPoint(v);
      }
    } else if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      m.geometry.computeBoundingBox();
      if (m.geometry.boundingBox) {
        const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
        box.union(b);
      }
    }
  });

  if (box.isEmpty()) {
    box.set(new THREE.Vector3(-0.15, 1.2, -0.15), new THREE.Vector3(0.15, 1.5, 0.15));
  }
  return box;
}

function getStudioPosedRig(url: string): Promise<StudioPosedRig | null> {
  const hit = studioRigCache.get(url);
  if (hit) return hit;

  const p = (async () => {
    const [master, sharedAnim] = await Promise.all([
      loadMasterHikerGroup(url),
      loadSharedHikerClips(),
    ]);
    if (!master) return null;

    const cloned = SkeletonUtils.clone(master) as THREE.Group;
    const mixer = new THREE.AnimationMixer(cloned);
    if (sharedAnim.clips.Idle) {
      const act = mixer.clipAction(sharedAnim.clips.Idle);
      act.play();
      mixer.update(0);
    }
    cloned.updateMatrixWorld(true);

    const spine2 = cloned.getObjectByName('Spine2') || cloned.getObjectByName('Chest');
    const spine2MatrixWorld = spine2 ? spine2.matrixWorld.clone() : new THREE.Matrix4();

    const bounds = {
      coat: computeSkinnedSubtreeBox(cloned, (n) => n === 'Wolf3D_Outfit_Top'),
      beanie: computeSkinnedSubtreeBox(cloned, (n) => n.startsWith('Hiker_Beanie')),
      beret: computeSkinnedSubtreeBox(cloned, (n) => n.startsWith('Hiker_Beret')),
      scarf: computeSkinnedSubtreeBox(cloned, (n) => n.startsWith('Hiker_Scarf')),
      backpack: computeSkinnedSubtreeBox(cloned, (n) => n.startsWith('Hiker_Backpack')),
      hair: computeSkinnedSubtreeBox(cloned, (n) => n === 'Wolf3D_Hair'),
    };

    mixer.stopAllAction();
    return { root: cloned, spine2MatrixWorld, bounds };
  })();

  studioRigCache.set(url, p);
  return p;
}

function setOnlyMatchingMeshesVisible(
  root: THREE.Group,
  allowMesh: (meshName: string, parentName: string) => boolean
): void {
  root.traverse((obj) => {
    if (obj === root) {
      obj.visible = true;
      return;
    }
    if ((obj as THREE.Bone).isBone) {
      obj.visible = true;
      return;
    }
    if ((obj as THREE.Mesh).isMesh) {
      const mName = obj.name || '';
      const pName = obj.parent?.name || '';
      const show = allowMesh(mName, pName);
      obj.visible = show;
      if (show && obj.parent) obj.parent.visible = true;
    } else {
      // Intermediate group (`Armature`, `Hiker_Beanie`, `Hiker_Backpack`, etc.)
      obj.visible = true;
    }
  });
}

function frameCameraToBox(
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3,
  viewDir: THREE.Vector3,
  padding = 1.16
): void {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.05);
  const halfFovRad = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const dist = (maxDim * 0.5) / Math.tan(halfFovRad) * padding;

  const dir = viewDir.clone().normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = Math.max(0.01, dist * 0.12);
  camera.far = Math.max(8, dist * 4.5);
  camera.updateProjectionMatrix();
  camera.lookAt(center);
}

function clearSubjectRoot(subjectRoot: THREE.Group): void {
  while (subjectRoot.children.length > 0) {
    subjectRoot.remove(subjectRoot.children[0]);
  }
}

type RenderJobTask = () => Promise<string>;
const jobQueue: Array<{
  key: string;
  task: RenderJobTask;
  resolve: (url: string) => void;
}> = [];
let queueScheduled = false;

function disposeStudioContext(): void {
  cancelStudioIdleDispose();
  if (!studioCtx) return;
  const { renderer, subjectRoot } = studioCtx;
  studioCtx = null;
  try {
    clearSubjectRoot(subjectRoot);
    renderer.renderLists?.dispose?.();
    renderer.dispose();
    renderer.forceContextLoss();
  } catch {
    // Ignore WebGL context disposal errors in headless or lost-context environments
  }
}

function scheduleStudioIdleDispose(): void {
  cancelStudioIdleDispose();
  if (!studioCtx || typeof window === 'undefined') return;
  idleDisposeTimer = setTimeout(() => {
    idleDisposeTimer = null;
    if (jobQueue.length === 0 && inflightJobs.size === 0 && !queueScheduled) {
      disposeStudioContext();
    }
  }, STUDIO_IDLE_DISPOSE_MS);
}

function scheduleQueueFlush(): void {
  if (queueScheduled || typeof window === 'undefined') return;
  queueScheduled = true;
  setTimeout(() => {
    void flushQueueBatch();
  }, 16);
}

async function flushQueueBatch(): Promise<void> {
  // Process 1 thumbnail per macrotask slice so offscreen studio rendering never steals >4ms from 60 FPS rAF!
  const batch = jobQueue.splice(0, 1);
  for (const item of batch) {
    try {
      const hit = dataUrlCache.get(item.key);
      if (hit) {
        item.resolve(hit);
      } else {
        const url = await item.task();
        if (url) dataUrlCache.set(item.key, url);
        item.resolve(url);
      }
    } catch {
      item.resolve('');
    } finally {
      inflightJobs.delete(item.key);
    }
  }
  queueScheduled = false;
  if (jobQueue.length > 0) {
    scheduleQueueFlush();
  } else {
    scheduleStudioIdleDispose();
  }
}

function enqueueThumbnailJob(key: string, task: RenderJobTask): Promise<string> {
  const cached = dataUrlCache.get(key);
  if (cached) return Promise.resolve(cached);

  const existing = inflightJobs.get(key);
  if (existing) return existing;

  cancelStudioIdleDispose();
  const p = new Promise<string>((resolve) => {
    jobQueue.push({ key, task, resolve });
    scheduleQueueFlush();
  });
  inflightJobs.set(key, p);
  return p;
}

export function getCachedStudioThumbnail(key: string): string | undefined {
  return dataUrlCache.get(key);
}

export function renderCoatStudioThumbnail(
  styleId: CoatStyleId,
  coatColor: string,
  scarfColor: string
): { key: string; promise: Promise<string> } {
  const key = `coat|${styleId}|${coatColor}|${scarfColor}`;
  const promise = enqueueThumbnailJob(key, async () => {
    const glbUrl = resolveBaseGlbForCoat(styleId);
    const rig = await getStudioPosedRig(glbUrl);
    if (!rig) return '';

    const { renderer, scene, subjectRoot, camera } = getStudioContext();
    clearSubjectRoot(subjectRoot);

    const outfit: PlayerOutfit = {
      ...DEFAULT_OUTFIT,
      coatStyle: styleId,
      coatColor,
      scarfColor,
      headwear: 'none',
      neckwear: 'none',
      eyewear: 'none',
      bagStyle: 'none',
      backpack: false,
    };
    applyOutfitToClonedHiker(rig.root, outfit, false);
    setOnlyMatchingMeshesVisible(rig.root, (mName) => mName === 'Wolf3D_Outfit_Top');
    subjectRoot.add(rig.root);

    const box = rig.bounds.coat.clone();
    // Focus tightly on the torso coat silhouette (clipping lower pant/thigh overhang if any)
    const isMale = isMaleCoatStyle(styleId);
    box.min.y = Math.max(box.min.y, isMale ? 0.90 : 0.84);
    box.max.y = Math.min(box.max.y, isMale ? 1.58 : 1.50);

    const overlayGeo = getCoatOverlayGeometry(styleId, coatColor, scarfColor);
    if (overlayGeo) {
      const overlayMesh = new THREE.Mesh(overlayGeo, SHARED_VCOLOR_MAT);
      overlayMesh.matrixAutoUpdate = false;
      overlayMesh.matrix.copy(rig.spine2MatrixWorld);
      overlayMesh.updateMatrixWorld(true);
      subjectRoot.add(overlayMesh);

      overlayGeo.computeBoundingBox();
      if (overlayGeo.boundingBox) {
        box.union(overlayGeo.boundingBox.clone().applyMatrix4(rig.spine2MatrixWorld));
      }
    }

    frameCameraToBox(camera, box, new THREE.Vector3(0.28, 0.14, 0.95), 1.12);
    renderer.render(scene, camera);
    clearSubjectRoot(subjectRoot);
    return await canvasToThumbnailDataUrl(renderer.domElement);
  });

  return { key, promise };
}

export function renderHeadwearStudioThumbnail(
  headwearId: HeadwearId,
  coatColor: string,
  scarfColor: string,
  hairColor: string,
  gender: AvatarGender = 'female'
): { key: string; promise: Promise<string> } {
  const effId: HeadwearId = headwearId === 'scarf_only' ? 'none' : headwearId;
  const rigKey = effId === 'none' || effId === 'beanie' || effId === 'beret' ? gender : 'any';
  const key = `head|${effId}|${rigKey}|${coatColor}|${scarfColor}|${hairColor}`;
  const promise = enqueueThumbnailJob(key, async () => {
    const { renderer, scene, subjectRoot, camera } = getStudioContext();
    clearSubjectRoot(subjectRoot);

    if (effId === 'beanie' || effId === 'beret' || effId === 'none') {
      const refGlb = gender === 'male' ? DEFAULT_MALE_REF_GLB : DEFAULT_REF_GLB;
      const rig = await getStudioPosedRig(refGlb);
      if (!rig) return '';

      applyOutfitToClonedHiker(
        rig.root,
        {
          ...DEFAULT_OUTFIT,
          gender,
          coatStyle: gender === 'male' ? 'puffer_vest' : 'wool_trench',
          coatColor,
          scarfColor,
          hairColor,
          headwear: effId,
          neckwear: 'none',
          bagStyle: 'none',
          backpack: false,
        },
        false
      );

      if (effId === 'beanie') {
        setOnlyMatchingMeshesVisible(
          rig.root,
          (mName, pName) => mName.startsWith('Hiker_Beanie') || pName.startsWith('Hiker_Beanie')
        );
        subjectRoot.add(rig.root);
        frameCameraToBox(camera, rig.bounds.beanie, new THREE.Vector3(0.36, 0.24, 0.9), 1.18);
      } else if (effId === 'beret') {
        setOnlyMatchingMeshesVisible(rig.root, (mName) => mName.startsWith('Hiker_Beret'));
        subjectRoot.add(rig.root);
        frameCameraToBox(camera, rig.bounds.beret, new THREE.Vector3(0.36, 0.28, 0.89), 1.18);
      } else {
        setOnlyMatchingMeshesVisible(rig.root, (mName) => mName === 'Wolf3D_Hair');
        subjectRoot.add(rig.root);
        frameCameraToBox(camera, rig.bounds.hair, new THREE.Vector3(0.38, 0.18, 0.91), 1.16);
      }
    } else {
      const geo = getCustomHeadwearGeometry(effId, coatColor, scarfColor);
      if (!geo) return '';
      const mesh = new THREE.Mesh(geo, SHARED_VCOLOR_MAT);
      subjectRoot.add(mesh);
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      const viewDir =
        effId === 'flower_crown'
          ? new THREE.Vector3(0.32, 0.48, 0.82)
          : effId === 'earmuffs'
            ? new THREE.Vector3(0.34, 0.18, 0.92)
            : new THREE.Vector3(0.36, 0.28, 0.89);
      frameCameraToBox(camera, box, viewDir, 1.18);
    }

    renderer.render(scene, camera);
    clearSubjectRoot(subjectRoot);
    return await canvasToThumbnailDataUrl(renderer.domElement);
  });

  return { key, promise };
}

export function renderNeckwearStudioThumbnail(
  neckwearId: NeckwearId,
  scarfColor: string
): { key: string; promise: Promise<string> } {
  if (neckwearId === 'none') {
    return { key: 'neck|none', promise: Promise.resolve('') };
  }

  const key = `neck|${neckwearId}|${scarfColor}`;
  const promise = enqueueThumbnailJob(key, async () => {
    const { renderer, scene, subjectRoot, camera } = getStudioContext();
    clearSubjectRoot(subjectRoot);

    if (neckwearId === 'knit_scarf' || neckwearId === 'plaid_shawl') {
      const rig = await getStudioPosedRig(DEFAULT_REF_GLB);
      if (!rig) return '';

      applyOutfitToClonedHiker(
        rig.root,
        {
          ...DEFAULT_OUTFIT,
          scarfColor,
          headwear: 'none',
          neckwear: neckwearId,
          bagStyle: 'none',
          backpack: false,
        },
        false
      );
      setOnlyMatchingMeshesVisible(rig.root, (mName) => mName.startsWith('Hiker_Scarf'));
      subjectRoot.add(rig.root);

      const box = rig.bounds.scarf.clone();
      if (neckwearId === 'plaid_shawl') {
        const tailsGeo = getCustomNeckwearGeometry('plaid_shawl', scarfColor, false);
        if (tailsGeo) {
          const tailsMesh = new THREE.Mesh(tailsGeo, SHARED_VCOLOR_MAT);
          tailsMesh.matrixAutoUpdate = false;
          tailsMesh.matrix.copy(rig.spine2MatrixWorld);
          tailsMesh.updateMatrixWorld(true);
          subjectRoot.add(tailsMesh);
          tailsGeo.computeBoundingBox();
          if (tailsGeo.boundingBox) {
            box.union(tailsGeo.boundingBox.clone().applyMatrix4(rig.spine2MatrixWorld));
          }
        }
      }
      frameCameraToBox(camera, box, new THREE.Vector3(0.32, 0.22, 0.92), 1.18);
    } else {
      const geo = getCustomNeckwearGeometry(neckwearId, scarfColor, false);
      if (!geo) return '';
      const mesh = new THREE.Mesh(geo, SHARED_VCOLOR_MAT);
      subjectRoot.add(mesh);
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      frameCameraToBox(camera, box, new THREE.Vector3(0.32, 0.22, 0.92), 1.18);
    }

    renderer.render(scene, camera);
    clearSubjectRoot(subjectRoot);
    return await canvasToThumbnailDataUrl(renderer.domElement);
  });

  return { key, promise };
}

export function renderEyewearStudioThumbnail(eyewearId: EyewearId): {
  key: string;
  promise: Promise<string>;
} {
  if (eyewearId === 'none') {
    return { key: 'eye|none', promise: Promise.resolve('') };
  }

  const key = `eye|${eyewearId}`;
  const promise = enqueueThumbnailJob(key, async () => {
    const group = buildEyewearGroup(eyewearId);
    if (!group) return '';

    const { renderer, scene, subjectRoot, camera } = getStudioContext();
    clearSubjectRoot(subjectRoot);
    subjectRoot.add(group);
    group.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(group);
    const dir =
      eyewearId === 'blush_cheeks'
        ? new THREE.Vector3(0.18, 0.1, 0.98)
        : new THREE.Vector3(0.36, 0.22, 0.9);
    frameCameraToBox(camera, box, dir, 1.2);

    renderer.render(scene, camera);
    clearSubjectRoot(subjectRoot);
    return await canvasToThumbnailDataUrl(renderer.domElement);
  });

  return { key, promise };
}

export function renderBagStudioThumbnail(
  bagId: BagStyleId,
  coatColor: string,
  scarfColor: string
): { key: string; promise: Promise<string> } {
  if (bagId === 'none') {
    return { key: 'bag|none', promise: Promise.resolve('') };
  }

  const key = `bag|${bagId}|${coatColor}|${scarfColor}`;
  const promise = enqueueThumbnailJob(key, async () => {
    const { renderer, scene, subjectRoot, camera } = getStudioContext();
    clearSubjectRoot(subjectRoot);

    if (bagId === 'trek_pack') {
      const rig = await getStudioPosedRig(DEFAULT_REF_GLB);
      if (!rig) return '';
      applyOutfitToClonedHiker(
        rig.root,
        {
          ...DEFAULT_OUTFIT,
          coatColor,
          scarfColor,
          bagStyle: 'trek_pack',
          backpack: true,
        },
        false
      );
      setOnlyMatchingMeshesVisible(
        rig.root,
        (mName, pName) => mName.startsWith('Hiker_Backpack') || pName.startsWith('Hiker_Backpack')
      );
      subjectRoot.add(rig.root);
      frameCameraToBox(camera, rig.bounds.backpack, new THREE.Vector3(-0.38, 0.22, -0.9), 1.16);
    } else {
      const geo = getCustomBagGeometry(bagId, coatColor, scarfColor, false);
      if (!geo) return '';
      const mesh = new THREE.Mesh(geo, SHARED_VCOLOR_MAT);
      subjectRoot.add(mesh);
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      const dir =
        bagId === 'canvas_tote'
          ? new THREE.Vector3(-0.78, 0.22, 0.58)
          : new THREE.Vector3(-0.38, 0.24, -0.89);
      frameCameraToBox(camera, box, dir, 1.16);
    }

    renderer.render(scene, camera);
    clearSubjectRoot(subjectRoot);
    return await canvasToThumbnailDataUrl(renderer.domElement);
  });

  return { key, promise };
}

export function renderHeldPropStudioThumbnail(itemId: HeldItemId): {
  key: string;
  promise: Promise<string>;
} {
  if (itemId === 'none') {
    return { key: 'prop|none', promise: Promise.resolve('') };
  }

  const key = `prop|${itemId}`;
  const promise = enqueueThumbnailJob(key, async () => {
    const obj = buildStandaloneHeldPropObject(itemId);
    if (!obj) return '';

    const { renderer, scene, subjectRoot, camera } = getStudioContext();
    clearSubjectRoot(subjectRoot);
    subjectRoot.add(obj);
    obj.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(obj);
    const dir =
      itemId === 'film_camera'
        ? new THREE.Vector3(0.36, 0.24, 0.9)
        : itemId === 'guitar'
          ? new THREE.Vector3(0.24, 0.12, 0.96)
          : new THREE.Vector3(0.32, 0.24, 0.92);
    frameCameraToBox(camera, box, dir, 1.16);

    renderer.render(scene, camera);
    clearSubjectRoot(subjectRoot);
    return await canvasToThumbnailDataUrl(renderer.domElement);
  });

  return { key, promise };
}

let hudPropsPrewarmed = false;

/**
 * Gently pre-warms the 4 favorite HUD quick-prop icons across staggered idle slices
 * so entering the world hits 100% cache with 0ms main-thread WebGL work.
 */
export function prewarmHudPropThumbnails(): void {
  if (hudPropsPrewarmed || typeof window === 'undefined') return;
  hudPropsPrewarmed = true;
  const ids: HeldItemId[] = ['soy_milk', 'phin_coffee', 'lantern', 'guitar'];
  ids.forEach((id, idx) => {
    setTimeout(() => {
      if (!dataUrlCache.has(`prop|${id}`)) {
        void renderHeldPropStudioThumbnail(id);
      }
    }, 50 + idx * 32);
  });
}
