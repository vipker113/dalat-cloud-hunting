import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  getSurfaceType,
  LANDMARK_LIST,
  resolveBenchSeatTransform,
  sampleGroundHeight,
  sampleWalkableHeight,
  SHARED_BENCHES,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
import type { IMultiplayerController } from '../network/types';
import { useGameStore } from '../store/gameStore';
import { worldColliderRegistry } from '../world/colliderRegistry';
import {
  evaluateNearbyPeer,
  evaluateNearbyPrompt,
  executeInteractPrompt,
  executePeerSocialAction,
  isNearCampfireStage,
  triggerGuitarChord,
} from './interactions';
import { useNetController } from './netBridge';

// Zero-GC module-level scratch math primitives
const _invMat = new THREE.Matrix4();
const _normalMat = new THREE.Matrix3();
const _ray = new THREE.Ray();
const _downDir = new THREE.Vector3(0, -1, 0);
const _hitWorld = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
const _capsuleSeg = new THREE.Line3();
const _capsuleBox = new THREE.Box3();
const _triPt = new THREE.Vector3();
const _capPt = new THREE.Vector3();
const _pushDir = new THREE.Vector3();
const _triNorm = new THREE.Vector3();
const _camPivot = new THREE.Vector3();
const _camDesired = new THREE.Vector3();
const _camLookAt = new THREE.Vector3();
const _photoOffset = new THREE.Vector3();

const CAPSULE_RADIUS = 0.34;
const GRAVITY = -19.5;
const JUMP_VELOCITY = 6.6;
const COYOTE_TIME_SEC = 0.14;
const JUMP_BUFFER_SEC = 0.14;
const NET_SEND_INTERVAL_MS = 1000 / WORLD_CONSTANTS.NET_TICK_HZ; // ~83.33ms (12 Hz)

const FOCAL_TO_FOV: Record<24 | 35 | 50 | 85, number> = {
  24: 74,
  35: 54,
  50: 40,
  85: 24,
};

function isTypingInInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

/**
 * Resolves a physical gameplay key code even when a Vietnamese IME
 * (Unikey, EVKey, OpenKey on Windows, or macOS/Linux Vietnamese Telex/VNI)
 * intercepts WASD and emits composed characters ('ư', 'ă', 'â', 'đ', 'ứ', 'á', etc.)
 * or VK_PACKET (keyCode 229 / code '' / 'Unidentified').
 */
function resolveGameKeyCode(e: KeyboardEvent): string {
  const code = e.code;
  if (
    code &&
    code !== 'Unidentified' &&
    (code.startsWith('Key') ||
      code.startsWith('Arrow') ||
      code.startsWith('Shift') ||
      code.startsWith('Digit') ||
      code.startsWith('Alt') ||
      code === 'Space' ||
      code === 'Escape')
  ) {
    return code;
  }

  // Fallback to legacy hardware virtual keyCode if available and not IME Process (229)
  const kc = e.keyCode || e.which;
  if (kc && kc !== 229 && kc !== 231) {
    switch (kc) {
      case 87:
        return 'KeyW';
      case 83:
        return 'KeyS';
      case 65:
        return 'KeyA';
      case 68:
        return 'KeyD';
      case 38:
        return 'ArrowUp';
      case 40:
        return 'ArrowDown';
      case 37:
        return 'ArrowLeft';
      case 39:
        return 'ArrowRight';
      case 16:
        return 'ShiftLeft';
      case 32:
        return 'Space';
      case 27:
        return 'Escape';
      case 69:
        return 'KeyE';
      case 71:
        return 'KeyG';
      case 72:
        return 'KeyH';
      case 86:
        return 'KeyV';
      case 67:
        return 'KeyC';
      case 80:
        return 'KeyP';
      case 77:
        return 'KeyM';
      case 74:
        return 'KeyJ';
      case 79:
        return 'KeyO';
    }
  }

  const rawKey = (e.key || '').toLowerCase();
  if (!rawKey || rawKey === 'process' || rawKey === 'dead' || rawKey === 'unidentified') {
    return '';
  }
  if (rawKey === ' ') return 'Space';
  if (rawKey === 'escape' || rawKey === 'esc') return 'Escape';
  if (rawKey === 'shift') return 'ShiftLeft';
  if (rawKey === 'alt') return 'AltLeft';
  if (rawKey === 'arrowup') return 'ArrowUp';
  if (rawKey === 'arrowdown') return 'ArrowDown';
  if (rawKey === 'arrowleft') return 'ArrowLeft';
  if (rawKey === 'arrowright') return 'ArrowRight';

  // Vietnamese Telex / VNI character decoding:
  // In Telex:
  // - W produces 'ư', or adds horn (\u031b) / breve (\u0306) to 'a'/'o'/'u'
  // - S adds acute tone (\u0301) to a vowel ('á', 'ứ', 'ắ', 'ấ', 'ế', 'ố', 'ớ')
  // - A produces 'a', 'ă', 'â'
  // - D produces 'd', 'đ'
  const nfd = rawKey.normalize('NFD');
  if (rawKey === 'w' || rawKey === 'ư' || rawKey === 'ứ' || rawKey === 'ừ' || rawKey === 'ử' || rawKey === 'ữ' || rawKey === 'ự') {
    return 'KeyW';
  }
  if (rawKey === 's' || nfd.includes('\u0301')) {
    return 'KeyS';
  }
  if (nfd.includes('\u031b') || nfd.includes('\u0306')) {
    return 'KeyW';
  }
  if (rawKey === 'd' || rawKey === 'đ') {
    return 'KeyD';
  }
  if (rawKey === 'a' || nfd.startsWith('a')) {
    return 'KeyA';
  }
  if (rawKey === 'e' || nfd.startsWith('e')) return 'KeyE';
  if (rawKey === 'g') return 'KeyG';
  if (rawKey === 'h') return 'KeyH';
  if (rawKey === 'v') return 'KeyV';
  if (rawKey === 'c') return 'KeyC';
  if (rawKey === 'p') return 'KeyP';
  if (rawKey === 'm') return 'KeyM';
  if (rawKey === 'j') return 'KeyJ';
  if (rawKey === 'o' || nfd.startsWith('o')) return 'KeyO';
  if (/^[1-6]$/.test(rawKey)) return `Digit${rawKey}`;

  return code || '';
}

function shortestAngleDiff(from: number, to: number): number {
  let d = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface PlayerControllerProps {
  net?: IMultiplayerController;
}

export function PlayerController({ net: propNet }: PlayerControllerProps) {
  const net = useNetController(propNet);
  const { camera, gl } = useThree();

  const keysRef = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    shift: false,
    space: false,
  });

  const orbitStateRef = useRef({
    dragging: false,
    lastX: 0,
    lastY: 0,
    distance: 4.35,
    targetDistance: 4.35,
    currentFov: 52,
    smoothPivot: new THREE.Vector3(-35, 136.5, 28),
    smoothFloorLift: 0,
    initialized: false,
  });

  const timersRef = useRef({
    lastNetSendMs: 0,
    moveSeq: 0,
    promptAccumSec: 0,
    atmoAccumSec: 0,
    perfAccumSec: 0,
    perfFrames: 0,
    lastPromptId: '' as string,
    lastPeerKey: '' as string,
    lastTeleportNonce: 0,
    wasPhotoMode: false,
    wasDressing: true,
    coyoteTimerSec: 0.14,
    jumpBufferSec: 0,
    lastLensWheelMs: 0,
  });

  useEffect(() => {
    const clearAllKeys = () => {
      keysRef.current.forward = false;
      keysRef.current.backward = false;
      keysRef.current.left = false;
      keysRef.current.right = false;
      keysRef.current.shift = false;
      keysRef.current.space = false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingInInput()) {
        clearAllKeys();
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement | null)?.blur();
        }
        return;
      }

      const st = useGameStore.getState();
      const code = resolveGameKeyCode(e);

      // Movement keys — also preventDefault so macOS Press-and-Hold accent popup and Vietnamese IME
      // composition do not swallow subsequent keyup events!
      if (code === 'KeyW' || code === 'ArrowUp') {
        if (!e.ctrlKey && !e.metaKey) e.preventDefault();
        keysRef.current.forward = true;
      }
      if (code === 'KeyS' || code === 'ArrowDown') {
        if (!e.ctrlKey && !e.metaKey) e.preventDefault();
        keysRef.current.backward = true;
      }
      if (code === 'KeyA' || code === 'ArrowLeft') {
        if (!e.ctrlKey && !e.metaKey) e.preventDefault();
        keysRef.current.left = true;
      }
      if (code === 'KeyD' || code === 'ArrowRight') {
        if (!e.ctrlKey && !e.metaKey) e.preventDefault();
        keysRef.current.right = true;
      }
      if (code === 'ShiftLeft' || code === 'ShiftRight') keysRef.current.shift = true;

      if (!st.hasEnteredWorld) return;

      if (code === 'Space') {
        e.preventDefault();
        if (st.photoModeActive) {
          if (!st.latestCapturedPolaroid && st.photoCountdown === 0) {
            st.requestPhotoShutter();
          }
          return;
        }
        if (st.activeModal === 'none') {
          st.localTransient.jumpRequested = true;
        }
        return;
      }

      // Hold Alt to temporarily unlock mouse cursor for clicking HUD buttons
      if (code === 'AltLeft' || code === 'AltRight') {
        if (document.pointerLockElement === gl.domElement) {
          document.exitPointerLock?.();
        }
      }

      // Escape exits Photo Mode or closes open Modal (and browser natively exits Pointer Lock)
      if (code === 'Escape') {
        if (st.photoModeActive) {
          st.setPhotoMode(false);
          return;
        }
        if (st.activeModal !== 'none') {
          st.setActiveModal('none');
          return;
        }
      }

      // Context Interaction [E]
      if (code === 'KeyE' && !e.repeat && !st.photoModeActive && st.activeModal === 'none') {
        if (st.nearbyPrompt) {
          executeInteractPrompt(st.nearbyPrompt, net);
        } else if (st.nearbyPeer) {
          executePeerSocialAction('greet', st.nearbyPeer, net);
        }
        return;
      }

      // Quick Social Interactions when near another cloud-hunter: [G] Greet, [H] Warm Cup Clink, [V] Cheer, [C] Portrait
      if (!e.repeat && !st.photoModeActive && st.activeModal === 'none' && st.nearbyPeer) {
        if (code === 'KeyG') {
          executePeerSocialAction('greet', st.nearbyPeer, net);
          return;
        }
        if (code === 'KeyH') {
          executePeerSocialAction('cheers', st.nearbyPeer, net);
          return;
        }
        if (code === 'KeyV') {
          executePeerSocialAction('cheer', st.nearbyPeer, net);
          return;
        }
        if (code === 'KeyC') {
          executePeerSocialAction('photo', st.nearbyPeer, net);
          return;
        }
      }

      // Campfire Acoustic Guitar Chords [1..6]
      if (
        !e.repeat &&
        !st.photoModeActive &&
        st.activeModal === 'none' &&
        (code === 'Digit1' ||
          code === 'Digit2' ||
          code === 'Digit3' ||
          code === 'Digit4' ||
          code === 'Digit5' ||
          code === 'Digit6')
      ) {
        const lt = st.localTransient;
        if (isNearCampfireStage(lt.x, lt.z) || st.heldItem === 'guitar') {
          const idx = parseInt(code.replace('Digit', ''), 10) - 1;
          triggerGuitarChord(idx, net);
          return;
        }
      }

      // Quick Diegetic Shortcuts: [P] Film Camera, [M] Pocket Map, [J] Cloud Almanac, [O] Wardrobe
      if (!e.repeat) {
        if (code === 'KeyP') {
          const nextPhoto = !st.photoModeActive;
          if (nextPhoto && st.heldItem !== 'film_camera') {
            st.setHeldItem('film_camera');
            net.sendHeldItem('film_camera');
          }
          st.setPhotoMode(nextPhoto);
        } else if (code === 'KeyM' && !st.photoModeActive) {
          st.setActiveModal(st.activeModal === 'map' ? 'none' : 'map');
        } else if (code === 'KeyJ' && !st.photoModeActive) {
          st.setActiveModal(st.activeModal === 'almanac' ? 'none' : 'almanac');
        } else if (code === 'KeyO' && !st.photoModeActive) {
          st.setActiveModal(st.activeModal === 'wardrobe' ? 'none' : 'wardrobe');
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const code = resolveGameKeyCode(e);
      if (code === 'KeyW' || code === 'ArrowUp') keysRef.current.forward = false;
      if (code === 'KeyS' || code === 'ArrowDown') keysRef.current.backward = false;
      if (code === 'KeyA' || code === 'ArrowLeft') keysRef.current.left = false;
      if (code === 'KeyD' || code === 'ArrowRight') keysRef.current.right = false;
      if (code === 'ShiftLeft' || code === 'ShiftRight') keysRef.current.shift = false;

      // Extra Unikey / Telex multi-character release safety:
      // In Telex, pressing W+S ('ứ') or A+W ('ă') or D+D ('đ') can emit a combined character on keyup.
      const rawKey = (e.key || '').toLowerCase();
      if (rawKey) {
        const nfd = rawKey.normalize('NFD');
        if (rawKey === 'w' || rawKey === 'ư' || nfd.includes('\u031b') || nfd.includes('\u0306')) {
          keysRef.current.forward = false;
        }
        if (rawKey === 's' || nfd.includes('\u0301')) {
          keysRef.current.backward = false;
        }
        if (rawKey === 'a' || nfd.startsWith('a')) {
          keysRef.current.left = false;
        }
        if (rawKey === 'd' || rawKey === 'đ') {
          keysRef.current.right = false;
        }
      }

      // If an IME emits an unidentified / VK_PACKET (229) keyup without a physical code, release all movement keys
      // so a swallowed Unikey packet can never leave WASD stuck.
      if (!code && (e.keyCode === 229 || rawKey === 'process' || rawKey === 'dead' || rawKey === 'unidentified')) {
        keysRef.current.forward = false;
        keysRef.current.backward = false;
        keysRef.current.left = false;
        keysRef.current.right = false;
      }
      if (!e.shiftKey) {
        keysRef.current.shift = false;
      }
    };

    const onCompositionEnd = () => {
      if (!isTypingInInput()) {
        // Ensure any IME composition session outside an input doesn't leave movement keys latched
        keysRef.current.forward = false;
        keysRef.current.backward = false;
        keysRef.current.left = false;
        keysRef.current.right = false;
      }
    };

    const onWindowBlur = () => {
      clearAllKeys();
      if (orbitStateRef.current.dragging) {
        orbitStateRef.current.dragging = false;
        const st = useGameStore.getState();
        if (st.isDraggingPreview) st.setIsDraggingPreview(false);
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        onWindowBlur();
      }
    };

    const dom = gl.domElement;
    dom.setAttribute('spellcheck', 'false');
    dom.setAttribute('autocapitalize', 'off');
    dom.setAttribute('autocomplete', 'off');
    dom.setAttribute('autocorrect', 'off');
    dom.setAttribute('inputmode', 'none');

    const isInteractiveDrawerOrControl = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el || typeof el.closest !== 'function') return false;
      return Boolean(
        el.closest(
          '[data-dalat-drawer="true"], button, input, textarea, select, a, label, [role="button"]'
        )
      );
    };

    const onWindowPointerDown = (e: PointerEvent) => {
      const st = useGameStore.getState();
      const isDressing = !st.hasEnteredWorld || st.activeModal === 'wardrobe';
      if (!isDressing) return;
      if (isInteractiveDrawerOrControl(e.target)) return;
      // Support Left (0), Middle/Blender Pan (1), Right (2), and Touch drag!
      if (e.button === 0 || e.button === 1 || e.button === 2 || e.pointerType === 'touch') {
        if (e.button === 1) e.preventDefault();
        orbitStateRef.current.dragging = true;
        orbitStateRef.current.lastX = e.clientX;
        orbitStateRef.current.lastY = e.clientY;
        st.localTransient.previewYawVel = 0;
        if (!st.isDraggingPreview) {
          st.setIsDraggingPreview(true);
        }
      }
    };

    const onCanvasPointerDown = (e: PointerEvent) => {
      const st = useGameStore.getState();
      const isDressing = !st.hasEnteredWorld || st.activeModal === 'wardrobe';
      if (isDressing) return;
      if (st.activeModal !== 'none') return;
      if (e.button === 0 || e.button === 1 || e.button === 2) {
        orbitStateRef.current.dragging = true;
        orbitStateRef.current.lastX = e.clientX;
        orbitStateRef.current.lastY = e.clientY;
      }
      // Click on 3D canvas engages smooth free-look Pointer Lock (Esc or Alt unlocks anytime; drag still works as fallback)
      if (
        e.button === 0 &&
        !e.altKey &&
        document.pointerLockElement !== dom &&
        !st.latestCapturedPolaroid
      ) {
        try {
          const maybePromise = dom.requestPointerLock?.() as unknown as Promise<void> | undefined;
          if (maybePromise && typeof maybePromise.catch === 'function') {
            maybePromise.catch(() => {});
          }
        } catch {
          // Ignore if sandboxed or headless browser declines Pointer Lock
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const st = useGameStore.getState();
      const isDressing = !st.hasEnteredWorld || st.activeModal === 'wardrobe';
      if (isDressing) {
        if (!orbitStateRef.current.dragging) return;
        const dx = THREE.MathUtils.clamp(e.clientX - orbitStateRef.current.lastX, -180, 180);
        const dy = THREE.MathUtils.clamp(e.clientY - orbitStateRef.current.lastY, -180, 180);
        orbitStateRef.current.lastX = e.clientX;
        orbitStateRef.current.lastY = e.clientY;
        const lt = st.localTransient;
        lt.previewTargetYaw += dx * 0.0128;
        lt.previewYawVel = THREE.MathUtils.clamp(dx * 0.22, -7.5, 7.5);
        lt.previewTargetPanY = THREE.MathUtils.clamp(
          lt.previewTargetPanY + dy * 0.0022,
          -0.38,
          0.44
        );
        return;
      }
      if (st.activeModal !== 'none') return;

      const isLocked = document.pointerLockElement === dom;
      if (!orbitStateRef.current.dragging && !isLocked) return;

      const rawDx = isLocked ? e.movementX : e.clientX - orbitStateRef.current.lastX;
      const rawDy = isLocked ? e.movementY : e.clientY - orbitStateRef.current.lastY;
      orbitStateRef.current.lastX = e.clientX;
      orbitStateRef.current.lastY = e.clientY;

      // Guard against occasional OS pointer-lock warp spikes (>180px in 1 event)
      const dx = THREE.MathUtils.clamp(rawDx, -180, 180);
      const dy = THREE.MathUtils.clamp(rawDy, -180, 180);

      const sens = st.photoModeActive ? 0.0024 : isLocked ? 0.0029 : 0.0042;
      st.localTransient.cameraYaw -= dx * sens;
      const minPitch = st.photoModeActive ? -0.85 : -0.34;
      const maxPitch = st.photoModeActive ? 0.95 : 0.98;
      st.localTransient.cameraPitch = THREE.MathUtils.clamp(
        st.localTransient.cameraPitch + dy * sens,
        minPitch,
        maxPitch
      );
    };

    const onPointerUp = () => {
      if (!orbitStateRef.current.dragging) return;
      orbitStateRef.current.dragging = false;
      const st = useGameStore.getState();
      const isDressing = !st.hasEnteredWorld || st.activeModal === 'wardrobe';
      if (isDressing) {
        useGameStore.setState({
          isDraggingPreview: false,
          previewYawOffset: st.localTransient.previewTargetYaw,
        });
      }
    };

    const onWindowDoubleClick = (e: MouseEvent) => {
      const st = useGameStore.getState();
      const isDressing = !st.hasEnteredWorld || st.activeModal === 'wardrobe';
      if (!isDressing) return;
      if (isInteractiveDrawerOrControl(e.target)) return;
      st.resetPreviewStage();
    };

    const onWheel = (e: WheelEvent) => {
      const st = useGameStore.getState();
      const isDressing = !st.hasEnteredWorld || st.activeModal === 'wardrobe';
      if (isDressing) {
        // Allow native scrolling inside the left outfit customizer drawer!
        if (isInteractiveDrawerOrControl(e.target)) return;
        e.preventDefault();
        const lt = st.localTransient;
        if (e.ctrlKey) {
          // macOS trackpad pinch-to-zoom
          lt.previewTargetZoom = THREE.MathUtils.clamp(
            lt.previewTargetZoom + e.deltaY * 0.0085,
            0.54,
            1.24
          );
        } else {
          // Two-finger horizontal trackpad / Magic Mouse pan rotates 360° smoothly!
          if (Math.abs(e.deltaX) > 0.25) {
            lt.previewTargetYaw -= e.deltaX * 0.011;
            lt.previewYawVel = THREE.MathUtils.clamp(-e.deltaX * 0.16, -6, 6);
          }
          // Scroll wheel / vertical scroll zooms portrait <-> full-body smoothly!
          if (Math.abs(e.deltaY) > 0.25 && Math.abs(e.deltaY) >= Math.abs(e.deltaX) * 0.75) {
            lt.previewTargetZoom = THREE.MathUtils.clamp(
              lt.previewTargetZoom + e.deltaY * 0.0018,
              0.54,
              1.24
            );
          }
        }
        return;
      }
      if (st.activeModal !== 'none') return;
      if (st.photoModeActive) {
        e.preventDefault();
        // Horizontal 2-finger trackpad pan smoothly rotates viewfinder
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.15 && Math.abs(e.deltaX) > 0.5) {
          st.localTransient.cameraYaw -= e.deltaX * 0.0028;
          return;
        }
        // Debounced lens step zoom (prevents rapid trackpad micro-delta jumps)
        const nowWheel = performance.now();
        if (Math.abs(e.deltaY) > 4 && nowWheel - timersRef.current.lastLensWheelMs > 180) {
          timersRef.current.lastLensWheelMs = nowWheel;
          const steps: Array<24 | 35 | 50 | 85> = [24, 35, 50, 85];
          const curIdx = steps.indexOf(st.photoFocalMm);
          const nextIdx = THREE.MathUtils.clamp(
            curIdx + (e.deltaY < 0 ? 1 : -1),
            0,
            steps.length - 1
          );
          if (steps[nextIdx] !== st.photoFocalMm) {
            st.setPhotoOptions({ photoFocalMm: steps[nextIdx] });
          }
        }
        return;
      }
      orbitStateRef.current.targetDistance = THREE.MathUtils.clamp(
        orbitStateRef.current.targetDistance + e.deltaY * 0.0045,
        1.35,
        8.6
      );
    };

    const onContextMenu = (e: MouseEvent) => {
      const st = useGameStore.getState();
      const isDressing = !st.hasEnteredWorld || st.activeModal === 'wardrobe';
      if (isDressing && !isInteractiveDrawerOrControl(e.target)) {
        e.preventDefault();
        return;
      }
      if (e.target === dom) e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('compositionend', onCompositionEnd, { capture: true });
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pointerdown', onWindowPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('dblclick', onWindowDoubleClick);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('contextmenu', onContextMenu);
    dom.addEventListener('pointerdown', onCanvasPointerDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('compositionend', onCompositionEnd, { capture: true });
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pointerdown', onWindowPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('dblclick', onWindowDoubleClick);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContextMenu);
      dom.removeEventListener('pointerdown', onCanvasPointerDown);
    };
  }, [gl, net]);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const nowMs = performance.now();
    const st = useGameStore.getState();
    const lt = st.localTransient;
    const tState = timersRef.current;
    const oState = orbitStateRef.current;

    // 1. Always interpolate remote peer snapshots at 60 FPS
    net.interpolatePeers(nowMs);

    // 2. 360° Live Dressing Stage Turntable, Coasting Inertia, Vertical Pan & Zoom
    const isDressing = !st.hasEnteredWorld || st.activeModal === 'wardrobe';
    if (tState.wasDressing && !isDressing) {
      tState.wasDressing = false;
      lt.previewTargetYaw = 0;
      lt.previewCurrentYaw = 0;
      lt.previewYawVel = 0;
      lt.previewTargetPanY = 0;
      lt.previewCurrentPanY = 0;
      lt.previewTargetZoom = 1;
      lt.previewCurrentZoom = 1;
      if (st.previewYawOffset !== 0 || st.isDraggingPreview) {
        useGameStore.setState({ previewYawOffset: 0, isDraggingPreview: false });
      }
    } else if (!tState.wasDressing && isDressing) {
      tState.wasDressing = true;
    }

    if (isDressing) {
      if (!oState.dragging) {
        if (Math.abs(lt.previewYawVel) > 0.005) {
          lt.previewTargetYaw += lt.previewYawVel * dt;
          lt.previewYawVel *= Math.exp(-7.5 * dt);
        } else {
          lt.previewYawVel = 0;
        }
      }
      if (!isTypingInInput()) {
        const keyTurn = (keysRef.current.right ? 1 : 0) - (keysRef.current.left ? 1 : 0);
        if (keyTurn !== 0) {
          lt.previewTargetYaw += keyTurn * 2.35 * dt;
        }
      }
      const turnAlpha = 1 - Math.exp(-18 * dt);
      lt.previewCurrentYaw += (lt.previewTargetYaw - lt.previewCurrentYaw) * turnAlpha;
      lt.previewCurrentPanY += (lt.previewTargetPanY - lt.previewCurrentPanY) * turnAlpha;
      lt.previewCurrentZoom +=
        (lt.previewTargetZoom - lt.previewCurrentZoom) * (1 - Math.exp(-14 * dt));
      if (!oState.dragging && Math.abs(lt.previewCurrentYaw - st.previewYawOffset) > 0.14) {
        useGameStore.setState({ previewYawOffset: lt.previewCurrentYaw });
      }
    }

    if (!st.hasEnteredWorld) {
      const elapsed = clock.getElapsedTime();
      const baseFloorY = sampleWalkableHeight(lt.x, lt.z);
      lt.y = Math.max(baseFloorY, 135.31);

      // Frame character on the open right stage with East Volumetric Cloud Sea & Sunrise behind + live pan/zoom!
      const isWideDesktop = typeof window !== 'undefined' ? window.innerWidth >= 820 : true;
      const zoom = lt.previewCurrentZoom;
      const zoomPortraitLift = Math.max(0, 1.0 - zoom) * 0.36;
      const panY = lt.previewCurrentPanY;

      const camX = lt.x - 2.66 * zoom + Math.sin(elapsed * 0.24) * 0.04 * zoom;
      const camZ = lt.z - 0.88 * zoom + Math.cos(elapsed * 0.19) * 0.04 * zoom;
      const camY = lt.y + (isWideDesktop ? 1.14 : 1.24) + zoomPortraitLift + panY * 0.82;
      camera.position.set(camX, camY, camZ);

      const fxRaw = lt.x - camX;
      const fzRaw = lt.z - camZ;
      const fLen = Math.hypot(fxRaw, fzRaw) || 1;
      const fx = fxRaw / fLen;
      const fz = fzRaw / fLen;
      // Scale rightShift proportionally with zoom so avatar stays centered on the right stage while zooming!
      const rightShift = isWideDesktop ? 0.56 * zoom : 0.0;
      const lookY = lt.y + (isWideDesktop ? 0.96 : 0.64) + zoomPortraitLift + panY;
      camera.lookAt(lt.x + fz * rightShift, lookY, lt.z - fx * rightShift);

      if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.fov - 44) > 0.1) {
        camera.fov = 44;
        camera.updateProjectionMatrix();
      }
      oState.currentFov = 44;
      return;
    }

    // Snap camera cleanly on fast-travel teleport
    if (st.teleportTarget && st.teleportTarget.nonce !== tState.lastTeleportNonce) {
      tState.lastTeleportNonce = st.teleportTarget.nonce;
      _photoOffset.set(0, 0, 0);
      oState.initialized = false;
    }

    // Reset photo camera offset when entering Photo Mode (keep exact third-person gaze direction!)
    if (st.photoModeActive !== tState.wasPhotoMode) {
      tState.wasPhotoMode = st.photoModeActive;
      _photoOffset.set(0, 0, 0);
      if (st.photoModeActive) {
        // Third-person camera already gazes along (-sin(cameraYaw), -sin(cameraPitch), -cos(cameraYaw)),
        // so keeping cameraYaw unchanged points the viewfinder straight ahead with zero 180° flip!
        lt.cameraPitch = THREE.MathUtils.clamp(lt.cameraPitch * 0.45, -0.45, 0.45);
      } else {
        lt.cameraPitch = THREE.MathUtils.clamp(Math.max(0.08, lt.cameraPitch), -0.25, 0.85);
      }
    }

    // 4. Input Vector (Keyboard + Mobile Virtual Joystick)
    const keys = keysRef.current;
    const modalBlocking = st.activeModal !== 'none';
    if (modalBlocking || isTypingInInput()) {
      keys.forward = false;
      keys.backward = false;
      keys.left = false;
      keys.right = false;
      keys.shift = false;
    }
    if (modalBlocking && document.pointerLockElement === gl.domElement) {
      document.exitPointerLock?.();
    }
    const rawInX = modalBlocking
      ? 0
      : THREE.MathUtils.clamp((keys.right ? 1 : 0) - (keys.left ? 1 : 0) + lt.moveInputX, -1, 1);
    const rawInZ = modalBlocking
      ? 0
      : THREE.MathUtils.clamp((keys.backward ? 1 : 0) - (keys.forward ? 1 : 0) + lt.moveInputZ, -1, 1);
    const inputMag = Math.min(1, Math.hypot(rawInX, rawInZ));

    // In Photo Mode, WASD gently pans the viewfinder within a cozy 3.2m tripod leash around the player
    if (st.photoModeActive) {
      lt.moving = false;
      lt.running = false;
      lt.vx = 0;
      lt.vz = 0;
      if (inputMag > 0.02 && !st.latestCapturedPolaroid) {
        const forwardX = -Math.sin(lt.cameraYaw);
        const forwardZ = -Math.cos(lt.cameraYaw);
        const rightX = Math.cos(lt.cameraYaw);
        const rightZ = -Math.sin(lt.cameraYaw);
        const nx = rawInX / inputMag;
        const nz = rawInZ / inputMag;
        const moveWorldX = rightX * nx + forwardX * -nz;
        const moveWorldZ = rightZ * nx + forwardZ * -nz;
        _photoOffset.x += moveWorldX * 3.2 * dt;
        _photoOffset.z += moveWorldZ * 3.2 * dt;
        if (_photoOffset.length() > 3.2) {
          _photoOffset.setLength(3.2);
        }
      }
    } else {
      // Auto-stand up from bench if player moves or jumps (step slightly forward clear of bench box)
      if (st.seatedBenchId && (inputMag > 0.15 || lt.jumpRequested)) {
        const seatTransform = resolveBenchSeatTransform(st.seatedBenchId);
        if (seatTransform) {
          lt.x = seatTransform.position[0] + Math.sin(seatTransform.yaw) * 0.78;
          lt.z = seatTransform.position[2] + Math.cos(seatTransform.yaw) * 0.78;
        }
        st.setSeatedBench(null);
        net.requestBenchSeat(null);
      }

      if (st.seatedBenchId) {
        lt.vx = 0;
        lt.vy = 0;
        lt.vz = 0;
        lt.moving = false;
        lt.running = false;
        lt.grounded = true;
        lt.jumpRequested = false;
        tState.coyoteTimerSec = COYOTE_TIME_SEC;
        tState.jumpBufferSec = 0;
      } else {
        // Compute camera-relative movement direction on XZ plane
        // Third-person camera sits at offset (+sin(cameraYaw), +cos(cameraYaw)) * dist, looking toward (-sin, -cos)
        const forwardX = -Math.sin(lt.cameraYaw);
        const forwardZ = -Math.cos(lt.cameraYaw);
        const rightX = Math.cos(lt.cameraYaw);
        const rightZ = -Math.sin(lt.cameraYaw);

        const nx = inputMag > 0.001 ? rawInX / inputMag : 0;
        const nz = inputMag > 0.001 ? rawInZ / inputMag : 0;
        const wishDirX = rightX * nx + forwardX * -nz;
        const wishDirZ = rightZ * nx + forwardZ * -nz;

        const wantsRun =
          keys.shift ||
          (inputMag > 0.88 && (Math.abs(lt.moveInputX) > 0.05 || Math.abs(lt.moveInputZ) > 0.05));
        const warmBoost = st.warmthRemainingSec > 0 ? 1.12 : 1.0; // +12% Highland Warmth cozy boost!
        const maxSpeed = wantsRun
          ? WORLD_CONSTANTS.MAX_RUN_SPEED * warmBoost
          : WORLD_CONSTANTS.MAX_WALK_SPEED;

        const targetVx = wishDirX * maxSpeed * inputMag;
        const targetVz = wishDirZ * maxSpeed * inputMag;

        // Crisp acceleration & direction pivots + tactile deceleration on damp red-basalt trails
        const surface = getSurfaceType(lt.x, lt.z);
        const isWetBasalt =
          surface === 'red_basalt_trail' &&
          (st.atmosphere.drizzleIntensity > 0.2 || st.atmosphere.weather === 'light_drizzle');

        const dotDir = wishDirX * lt.vx + wishDirZ * lt.vz;
        const isAccelerating = inputMag > 0.06;
        const isPivoting = isAccelerating && dotDir < -0.15;
        const responseLambda = isWetBasalt
          ? isAccelerating
            ? 8.5
            : 5.8
          : isPivoting
            ? 24.0
            : isAccelerating
              ? 19.0
              : 15.0;
        const blend = 1 - Math.exp(-responseLambda * dt);

        lt.vx += (targetVx - lt.vx) * blend;
        lt.vz += (targetVz - lt.vz) * blend;
        if (!isAccelerating && Math.hypot(lt.vx, lt.vz) < 0.04) {
          lt.vx = 0;
          lt.vz = 0;
        }

        const horizSpeed = Math.hypot(lt.vx, lt.vz);
        lt.moving = inputMag > 0.06 && horizSpeed > 0.16;
        lt.running = lt.moving && wantsRun && horizSpeed > 4.4;

        if (lt.moving) {
          const desiredYaw = Math.atan2(wishDirX, wishDirZ);
          const turnLambda = lt.running ? 16.5 : 14.5;
          lt.yaw += shortestAngleDiff(lt.yaw, desiredYaw) * (1 - Math.exp(-turnLambda * dt));

          // Gentle auto-follow camera alignment when strafing/turning without mouse lock or drag
          const isPointerLocked = document.pointerLockElement === gl.domElement;
          if (!isPointerLocked && !oState.dragging && Math.abs(rawInX) > 0.15 && rawInZ <= 0.1) {
            const targetCamYaw = Math.atan2(-wishDirX, -wishDirZ);
            lt.cameraYaw +=
              shortestAngleDiff(lt.cameraYaw, targetCamYaw) *
              (1 - Math.exp(-1.15 * Math.abs(rawInX) * dt));
          }
        }

        // Coyote Time + Jump Input Buffer + Downhill Slope Grounding
        const wasGrounded = lt.grounded;
        if (wasGrounded) {
          tState.coyoteTimerSec = COYOTE_TIME_SEC;
        } else {
          tState.coyoteTimerSec = Math.max(0, tState.coyoteTimerSec - dt);
        }

        if (lt.jumpRequested) {
          tState.jumpBufferSec = JUMP_BUFFER_SEC;
          lt.jumpRequested = false;
        } else {
          tState.jumpBufferSec = Math.max(0, tState.jumpBufferSec - dt);
        }

        let justJumped = false;
        if (tState.jumpBufferSec > 0 && tState.coyoteTimerSec > 0) {
          lt.vy = JUMP_VELOCITY;
          lt.grounded = false;
          tState.jumpBufferSec = 0;
          tState.coyoteTimerSec = 0;
          justJumped = true;
        }

        if (!wasGrounded || justJumped) {
          if (!justJumped) {
            lt.vy += GRAVITY * dt;
          }
        } else {
          lt.vy = 0;
        }

        // Advance horizontal position within 900m x 900m safe ridge boundary
        // (sub-stepped when stepDist > 0.12m so fast sprints never tunnel through thin railings/trunks)
        const bound = WORLD_CONSTANTS.HALF_SIZE - 14;
        const totalDx = lt.vx * dt;
        const totalDz = lt.vz * dt;
        const stepDist = Math.hypot(totalDx, totalDz);
        const horizSubSteps = stepDist > 0.12 ? Math.min(3, Math.ceil(stepDist / 0.12)) : 1;
        lt.y += lt.vy * dt;

        // 5. Watertight 2-Pass BVH Capsule Obstacle Pushout + Downward Raycast + Anti-Tunneling Floor Guard
        const collider = worldColliderRegistry.getCollider();
        let bvhFloorY: number | null = null;

        if (collider) {
          const { mesh, bvh } = collider;
          mesh.updateMatrixWorld();
          _invMat.copy(mesh.matrixWorld).invert();
          _normalMat.getNormalMatrix(mesh.matrixWorld);

          for (let sub = 0; sub < horizSubSteps; sub++) {
            const prevX = lt.x;
            const prevZ = lt.z;
            lt.x = THREE.MathUtils.clamp(lt.x + totalDx / horizSubSteps, -bound, bound);
            lt.z = THREE.MathUtils.clamp(lt.z + totalDz / horizSubSteps, -bound, bound);

            // 5a. Two-iteration horizontal wall/railing/cabin/tree/prop capsule shapecast (starts 0.34m above feet)
            _capsuleSeg.start.set(lt.x, lt.y + 0.34, lt.z).applyMatrix4(_invMat);
            _capsuleSeg.end.set(lt.x, lt.y + 1.56, lt.z).applyMatrix4(_invMat);

            for (let iter = 0; iter < 2; iter++) {
              _capsuleBox.makeEmpty();
              _capsuleBox.expandByPoint(_capsuleSeg.start);
              _capsuleBox.expandByPoint(_capsuleSeg.end);
              _capsuleBox.min.addScalar(-CAPSULE_RADIUS - 0.06);
              _capsuleBox.max.addScalar(CAPSULE_RADIUS + 0.06);

              let anyPush = false;
              bvh.shapecast({
                intersectsBounds: (box) => box.intersectsBox(_capsuleBox),
                intersectsTriangle: (tri) => {
                  const dist = tri.closestPointToSegment(_capsuleSeg, _triPt, _capPt);
                  if (dist < CAPSULE_RADIUS) {
                    tri.getNormal(_triNorm).applyMatrix3(_normalMat).normalize();
                    // Push horizontally only against walls/railings/cabins/props/trunks, never walkable ramps
                    if (Math.abs(_triNorm.y) < 0.62) {
                      _pushDir.subVectors(_capPt, _triPt);
                      _pushDir.y = 0;
                      const len = _pushDir.length();
                      if (len > 1e-4) {
                        const depth = CAPSULE_RADIUS - dist + 0.002;
                        _pushDir.multiplyScalar(depth / len);
                      } else {
                        // Segment centerline touched or crossed a thin wall/railing face (dist ~ 0):
                        // resolve along horizontal triangle normal oriented toward player's approach side!
                        _pushDir.set(_triNorm.x, 0, _triNorm.z);
                        if (_pushDir.lengthSq() < 1e-6) {
                          _pushDir.set(prevX - _triPt.x, 0, prevZ - _triPt.z);
                        }
                        if (_pushDir.lengthSq() > 1e-8) {
                          _pushDir.normalize();
                          const approachSide =
                            (prevX - _triPt.x) * _pushDir.x + (prevZ - _triPt.z) * _pushDir.z;
                          if (approachSide < 0) {
                            _pushDir.negate();
                          }
                          _pushDir.multiplyScalar(CAPSULE_RADIUS + 0.015);
                        }
                      }
                      if (_pushDir.lengthSq() > 1e-10) {
                        _capsuleSeg.start.add(_pushDir);
                        _capsuleSeg.end.add(_pushDir);
                        anyPush = true;
                      }
                    }
                  }
                },
              });
              if (!anyPush) break;
            }

            // Transform resolved capsule XZ back to world space and damp velocity into blocked axis
            _hitWorld.copy(_capsuleSeg.start).applyMatrix4(mesh.matrixWorld);
            const corrDx = _hitWorld.x - lt.x;
            const corrDz = _hitWorld.z - lt.z;
            if (corrDx * corrDx + corrDz * corrDz > 1e-6) {
              const cLen = Math.hypot(corrDx, corrDz);
              const nxWall = corrDx / cLen;
              const nzWall = corrDz / cLen;
              const intoWallVel = lt.vx * nxWall + lt.vz * nzWall;
              if (intoWallVel < 0) {
                lt.vx -= nxWall * intoWallVel;
                lt.vz -= nzWall * intoWallVel;
              }
            }
            lt.x = _hitWorld.x;
            lt.z = _hitWorld.z;
          }

          // 5b. Multi-point foot-base downward raycast from chest height (prevents upslope toe/heel ground clipping!)
          _ray.direction.copy(_downDir).transformDirection(_invMat).normalize();
          const fwdX = Math.sin(lt.yaw);
          const fwdZ = Math.cos(lt.yaw);
          const rightX = fwdZ;
          const rightZ = -fwdX;

          const probeOffsets: Array<[number, number, number]> = [
            [0, 0, 0.85],
            [fwdX * 0.2, fwdZ * 0.2, 0.45],
            [-fwdX * 0.2, -fwdZ * 0.2, 0.45],
            [rightX * 0.11, rightZ * 0.11, 0.42],
            [-rightX * 0.11, -rightZ * 0.11, 0.42],
          ];

          for (let pIdx = 0; pIdx < probeOffsets.length; pIdx++) {
            const [ox, oz, maxStep] = probeOffsets[pIdx];
            _ray.origin.set(lt.x + ox, lt.y + 1.32, lt.z + oz).applyMatrix4(_invMat);
            const hit = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, 3.2);
            if (!hit) continue;
            _hitWorld.copy(hit.point).applyMatrix4(mesh.matrixWorld);
            if (hit.face) {
              _hitNormal.copy(hit.face.normal).applyMatrix3(_normalMat).normalize();
            } else {
              _hitNormal.set(0, 1, 0);
            }
            if (_hitNormal.y >= 0.45 && _hitWorld.y <= lt.y + maxStep) {
              if (bvhFloorY === null || _hitWorld.y > bvhFloorY) {
                bvhFloorY = _hitWorld.y;
              }
            }
          }
        }

        // 5c. Personal-space soft separation against remote human peers so players never stack at 0.0m
        const peers = st.peers;
        for (const peerId in peers) {
          const peer = peers[peerId];
          if (!peer) continue;
          if (Math.abs(peer.y - lt.y) > 1.8) continue;
          const pdx = lt.x - peer.x;
          const pdz = lt.z - peer.z;
          const pdist = Math.hypot(pdx, pdz);
          const minSep = 0.72;
          if (pdist < minSep) {
            if (pdist > 0.001) {
              const push = (minSep - pdist) * Math.min(1, dt * 16);
              lt.x += (pdx / pdist) * push;
              lt.z += (pdz / pdist) * push;
            } else {
              const fallbackAngle = ((peer.numericId || 1) * 2.39996) % (Math.PI * 2);
              lt.x += Math.cos(fallbackAngle) * 0.72;
              lt.z += Math.sin(fallbackAngle) * 0.72;
            }
          }
        }

        // Guard against snapping up onto stilted decks from underneath the cliffside stilts
        const rawWalkableY = sampleWalkableHeight(lt.x, lt.z);
        const groundOnlyY = sampleGroundHeight(lt.x, lt.z);
        const analyticalFloorY = rawWalkableY > lt.y + 1.45 ? groundOnlyY : rawWalkableY;
        const targetFloorY =
          (bvhFloorY !== null ? Math.max(bvhFloorY, analyticalFloorY) : analyticalFloorY) + 0.01;

        // Generous downhill snap tolerance when already grounded eliminates downhill micro-hop!
        const snapTolerance = wasGrounded && !justJumped ? 0.64 : 0.28;
        if (!justJumped && lt.vy <= 0.05 && lt.y <= targetFloorY + snapTolerance) {
          lt.y = THREE.MathUtils.lerp(lt.y, targetFloorY, 1 - Math.exp(-30 * dt));
          if (Math.abs(lt.y - targetFloorY) < 0.012) lt.y = targetFloorY;
          lt.vy = 0;
          lt.grounded = true;
        } else if (lt.y < targetFloorY) {
          lt.y = targetFloorY;
          lt.vy = 0;
          lt.grounded = true;
        } else {
          lt.grounded = false;
        }
      }
    }

    // 6. Cinematic Horizon Framing, Wardrobe Live Portrait Camera & Zero-Rubber-Band Third-Person Orbit
    if (st.photoModeActive) {
      let eyeX = lt.x + _photoOffset.x;
      let eyeZ = lt.z + _photoOffset.z;
      const floorAtCam = sampleWalkableHeight(eyeX, eyeZ);
      const eyeY = Math.max(lt.y + 1.56, Math.min(lt.y + 2.2, floorAtCam + 1.15));

      // Prevent Photo Mode tripod camera from pushing inside cabin walls or railings
      const collider = worldColliderRegistry.getCollider();
      if (collider) {
        const { mesh, bvh } = collider;
        mesh.updateMatrixWorld();
        _invMat.copy(mesh.matrixWorld).invert();
        _normalMat.getNormalMatrix(mesh.matrixWorld);
        _capsuleSeg.start.set(eyeX, eyeY - 0.35, eyeZ).applyMatrix4(_invMat);
        _capsuleSeg.end.set(eyeX, eyeY + 0.25, eyeZ).applyMatrix4(_invMat);
        _capsuleBox.makeEmpty();
        _capsuleBox.expandByPoint(_capsuleSeg.start);
        _capsuleBox.expandByPoint(_capsuleSeg.end);
        _capsuleBox.min.addScalar(-0.32);
        _capsuleBox.max.addScalar(0.32);
        bvh.shapecast({
          intersectsBounds: (box) => box.intersectsBox(_capsuleBox),
          intersectsTriangle: (tri) => {
            const dist = tri.closestPointToSegment(_capsuleSeg, _triPt, _capPt);
            if (dist < 0.28) {
              tri.getNormal(_triNorm).applyMatrix3(_normalMat).normalize();
              if (Math.abs(_triNorm.y) < 0.62) {
                _pushDir.subVectors(_capPt, _triPt);
                _pushDir.y = 0;
                const len = _pushDir.length();
                if (len > 1e-4) {
                  _pushDir.multiplyScalar((0.28 - dist) / len);
                  _capsuleSeg.start.add(_pushDir);
                  _capsuleSeg.end.add(_pushDir);
                }
              }
            }
          },
        });
        _hitWorld.copy(_capsuleSeg.start).applyMatrix4(mesh.matrixWorld);
        eyeX = _hitWorld.x;
        eyeZ = _hitWorld.z;
        _photoOffset.x = eyeX - lt.x;
        _photoOffset.z = eyeZ - lt.z;
      }

      // Unified right-handed gaze vector matching Third-Person Orbit:
      // dx > 0 (mouse right) -> cameraYaw decreases -> -sin(cameraYaw) increases -> pans RIGHT!
      // dy < 0 (mouse up)    -> cameraPitch decreases -> -sin(cameraPitch) increases -> tilts UP!
      const cosP = Math.cos(lt.cameraPitch);
      const lookDirX = -Math.sin(lt.cameraYaw) * cosP;
      const lookDirY = -Math.sin(lt.cameraPitch);
      const lookDirZ = -Math.cos(lt.cameraYaw) * cosP;

      camera.position.set(eyeX, eyeY, eyeZ);
      camera.lookAt(eyeX + lookDirX * 20, eyeY + lookDirY * 20, eyeZ + lookDirZ * 20);

      const targetFov = FOCAL_TO_FOV[st.photoFocalMm] || 54;
      oState.currentFov += (targetFov - oState.currentFov) * (1 - Math.exp(-14 * dt));
    } else if (st.activeModal === 'wardrobe') {
      // Smooth Full-Body Live Wardrobe Portrait Camera (frames character on uncovered right 3D stage + live pan/zoom!)
      const isWideDesktop = typeof window !== 'undefined' ? window.innerWidth >= 820 : true;
      const targetFov = 44;
      oState.currentFov += (targetFov - oState.currentFov) * (1 - Math.exp(-10 * dt));

      const zoom = lt.previewCurrentZoom;
      const zoomPortraitLift = Math.max(0, 1.0 - zoom) * 0.36;
      const panY = lt.previewCurrentPanY;

      let portraitDist = (isWideDesktop ? 2.82 : 3.05) * zoom;
      const dirX = Math.sin(lt.cameraYaw);
      const dirZ = Math.cos(lt.cameraYaw);

      // Ensure no cabin wall or wooden post blocks the wardrobe portrait camera
      const collider = worldColliderRegistry.getCollider();
      if (collider) {
        const { mesh, bvh } = collider;
        mesh.updateMatrixWorld();
        _invMat.copy(mesh.matrixWorld).invert();
        _ray.origin.set(lt.x, lt.y + 1.18, lt.z).applyMatrix4(_invMat);
        _ray.direction.set(dirX, 0.02, dirZ).transformDirection(_invMat).normalize();
        const hit = bvh.raycastFirst(_ray, THREE.DoubleSide, 0.25, portraitDist + 0.25);
        if (hit) {
          _hitWorld.copy(hit.point).applyMatrix4(mesh.matrixWorld);
          const worldHitDist = Math.hypot(_hitWorld.x - lt.x, _hitWorld.z - lt.z);
          if (worldHitDist < portraitDist + 0.15) {
            portraitDist = Math.max(1.35, worldHitDist - 0.24);
          }
        }
      }

      const desX = lt.x + dirX * portraitDist;
      const desZ = lt.z + dirZ * portraitDist;
      const desY = Math.max(
        lt.y + (isWideDesktop ? 1.14 : 1.24) + zoomPortraitLift + panY * 0.82,
        sampleWalkableHeight(desX, desZ) + 0.56
      );
      _camDesired.set(desX, desY, desZ);

      const camBlend = 1 - Math.exp(-14 * dt);
      camera.position.lerp(_camDesired, camBlend);

      const fxRaw = lt.x - camera.position.x;
      const fzRaw = lt.z - camera.position.z;
      const fLen = Math.hypot(fxRaw, fzRaw) || 1;
      const fx = fxRaw / fLen;
      const fz = fzRaw / fLen;
      const rightShift = isWideDesktop ? 0.56 * (portraitDist / 2.82) : 0.0;
      const lookY = lt.y + (isWideDesktop ? 0.96 : 0.64) + zoomPortraitLift + panY;
      _camLookAt.set(lt.x + fz * rightShift, lookY, lt.z - fx * rightShift);
      camera.lookAt(_camLookAt);
    } else {
      // Detect iconic Da Lat cloud-hunting viewpoints for wide horizon framing (52° -> 58°)
      const nearPierTip = Math.hypot(lt.x - 91, lt.z - -75) < 13.5;
      const nearValleyOverlook = Math.hypot(lt.x - 18, lt.z - 128) < 16.0;
      const nearLonelyPine = Math.hypot(lt.x - -94, lt.z - -146) < 17.0;
      const nearPinkHollow = Math.hypot(lt.x - -12, lt.z - -174) < 15.0;
      const isScenicOverlook =
        nearPierTip || nearValleyOverlook || nearLonelyPine || nearPinkHollow;

      const sprintFovBoost = lt.running ? 2.5 : 0;
      const targetFov = (isScenicOverlook ? 58 : 52) + sprintFovBoost;
      oState.currentFov += (targetFov - oState.currentFov) * (1 - Math.exp(-5.0 * dt));

      const scenicDistBoost = isScenicOverlook ? 0.65 : 0;
      oState.distance +=
        (oState.targetDistance + scenicDistBoost - oState.distance) * (1 - Math.exp(-11 * dt));

      const pivotLift = (st.seatedBenchId ? 1.24 : 1.48) + (isScenicOverlook ? 0.34 : 0);
      _camPivot.set(lt.x, lt.y + pivotLift, lt.z);

      if (!oState.initialized) {
        oState.smoothPivot.copy(_camPivot);
        oState.smoothFloorLift = 0;
        oState.initialized = true;
      } else {
        const xzBlend = 1 - Math.exp(-28 * dt);
        const yBlend = 1 - Math.exp(-18 * dt);
        oState.smoothPivot.x += (_camPivot.x - oState.smoothPivot.x) * xzBlend;
        oState.smoothPivot.z += (_camPivot.z - oState.smoothPivot.z) * xzBlend;
        oState.smoothPivot.y += (_camPivot.y - oState.smoothPivot.y) * yBlend;
      }

      // Compute exact spherical orbit directly from smoothPivot (zero mouse-look lag or chord-cutting!)
      const cosPitch = Math.cos(lt.cameraPitch);
      const offsetX = Math.sin(lt.cameraYaw) * cosPitch * oState.distance;
      const offsetY = Math.sin(lt.cameraPitch) * oState.distance;
      const offsetZ = Math.cos(lt.cameraYaw) * cosPitch * oState.distance;

      _camDesired.set(
        oState.smoothPivot.x + offsetX,
        oState.smoothPivot.y + offsetY,
        oState.smoothPivot.z + offsetZ
      );

      // Smoothly lift camera above sloped terrain or wooden decks
      const minCamY = sampleWalkableHeight(_camDesired.x, _camDesired.z) + 0.62;
      const neededLift = Math.max(0, minCamY - _camDesired.y);
      oState.smoothFloorLift +=
        (neededLift - oState.smoothFloorLift) * (1 - Math.exp(-20 * dt));
      _camDesired.y += oState.smoothFloorLift;

      _camLookAt.set(
        oState.smoothPivot.x - Math.sin(lt.cameraYaw) * 1.15,
        oState.smoothPivot.y - 0.06,
        oState.smoothPivot.z - Math.cos(lt.cameraYaw) * 1.15
      );

      camera.position.copy(_camDesired);
      camera.lookAt(_camLookAt);
    }

    if (
      camera instanceof THREE.PerspectiveCamera &&
      Math.abs(camera.fov - oState.currentFov) > 0.02
    ) {
      camera.fov = oState.currentFov;
      camera.updateProjectionMatrix();
    }

    // 7. Landmark Auto-Discovery (within 22m) + Context Proximity Prompts (~8 Hz)
    tState.promptAccumSec += dt;
    if (tState.promptAccumSec >= 0.12) {
      tState.promptAccumSec = 0;

      for (let i = 0; i < LANDMARK_LIST.length; i++) {
        const lm = LANDMARK_LIST[i];
        if (!st.discoveredLandmarks[lm.id]) {
          const d = Math.hypot(lt.x - lm.position[0], lt.z - lm.position[2]);
          if (d <= 22) {
            st.markLandmarkDiscovered(lm.id);
            st.showToast(
              `✦ Đã đặt chân tới ${lm.name} (${lm.altitudeASL.toLocaleString('en-US')}m ASL)`
            );
          }
        }
      }

      const nextPrompt = st.photoModeActive ? null : evaluateNearbyPrompt(lt.x, lt.z);
      const nextId = nextPrompt ? nextPrompt.id : '';
      if (nextId !== tState.lastPromptId) {
        tState.lastPromptId = nextId;
        st.setNearbyPrompt(nextPrompt);
      }

      const nextPeer = st.photoModeActive ? null : evaluateNearbyPeer(lt.x, lt.y, lt.z);
      const nextPeerKey = nextPeer
        ? `${nextPeer.sessionId}:${nextPeer.displayName}:${Math.round(nextPeer.distance * 2)}`
        : '';
      if (nextPeerKey !== tState.lastPeerKey) {
        tState.lastPeerKey = nextPeerKey;
        st.setNearbyPeer(nextPeer);
      }
    }

    // 8. 12 Hz (every ~83ms) Binary Move Packet Sync
    if (nowMs - tState.lastNetSendMs >= NET_SEND_INTERVAL_MS) {
      tState.lastNetSendMs = nowMs;
      tState.moveSeq = (tState.moveSeq + 1) & 0xffff;
      net.sendMove({
        seq: tState.moveSeq,
        x: lt.x,
        y: lt.y,
        z: lt.z,
        yaw: lt.yaw,
        vx: lt.vx,
        vz: lt.vz,
        moving: lt.moving,
        running: lt.running,
        grounded: lt.grounded,
        warmBuff: st.warmthRemainingSec > 0,
      });
    }
  });

  return null;
}
