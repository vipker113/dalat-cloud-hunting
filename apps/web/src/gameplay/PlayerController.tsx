import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  distanceToTrail,
  getSurfaceType,
  LANDMARK_LIST,
  sampleGroundGradient,
  sampleGroundHeight,
  sampleWalkableHeight,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
import { playLandingFootstep, playStrideFootstep } from '../audio/highlandAudio';
import type { IMultiplayerController } from '../network/types';
import { useGameStore } from '../store/gameStore';
import { worldColliderRegistry } from '../world/colliderRegistry';
import {
  computeBenchStandUpPosition,
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
const _camRayOrigin = new THREE.Vector3();
const _camRayDir = new THREE.Vector3();
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

function decodeTelexKeyFromComposedChar(rawKey: string): string {
  const nfd = rawKey.normalize('NFD');
  // 1. Tone marks always correspond to the most recently pressed Telex modifier key (s/f/r/x/j)
  if (nfd.includes('\u0301')) return 'KeyS'; // sắc
  if (nfd.includes('\u0300')) return 'KeyF'; // huyền
  if (nfd.includes('\u0309')) return 'KeyR'; // hỏi
  if (nfd.includes('\u0303')) return 'KeyX'; // ngã
  if (nfd.includes('\u0323')) return 'KeyJ'; // nặng
  // 2. Dyed consonant stroke (dd -> đ)
  if (rawKey === 'đ') return 'KeyD';
  // 3. Horn (ư, ơ) or breve (ă) triggered by W
  if (nfd.includes('\u031b') || nfd.includes('\u0306')) return 'KeyW';
  // 4. Circumflex (aa -> â, ee -> ê, oo -> ô)
  if (nfd.startsWith('a')) return 'KeyA';
  if (nfd.startsWith('e')) return 'KeyE';
  if (nfd.startsWith('o')) return 'KeyO';
  return '';
}

/**
 * Resolves a physical gameplay key code even when a Vietnamese IME
 * (EVKey, OpenKey, GoTiengViet on macOS via CGEventKeyboardSetUnicodeString virtualKey=0='KeyA',
 * Unikey on Windows, or built-in macOS/Windows Vietnamese Telex/VNI) intercepts WASD and emits
 * composed characters ('ư', 'ă', 'â', 'đ', 'ứ', 'á', etc.) or VK_PACKET (keyCode 229).
 */
function resolveGameKeyCode(e: KeyboardEvent): string {
  const code = e.code || '';
  const rawKey = (e.key || '').toLowerCase();

  // 1. Detect EVKey / OpenKey macOS CGEventKeyboardSetUnicodeString injection:
  // macOS Carbon virtualKey 0 is kVK_ANSI_A ('KeyA'), so synthetic Unicode chars ('ư', 'đ', 'ă', 'ứ')
  // and Telex undo chars ('w', 's', 'd' after Backspace) arrive with code === 'KeyA'!
  if (rawKey.length === 1 && rawKey.charCodeAt(0) > 127) {
    if (code && code !== 'KeyA' && code !== 'Unidentified' && code.startsWith('Key')) {
      return code;
    }
    const decoded = decodeTelexKeyFromComposedChar(rawKey);
    if (decoded) return decoded;
  }
  if (code === 'KeyA' && rawKey.length === 1 && /^[b-z0-9]$/.test(rawKey)) {
    return /^[b-z]$/.test(rawKey) ? `Key${rawKey.toUpperCase()}` : `Digit${rawKey}`;
  }

  // 2. Trust genuine physical USB HID e.code
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

  // 3. Fallback to legacy hardware virtual keyCode if available and not IME Process (229)
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
      case 70:
        return 'KeyF';
      case 66:
        return 'KeyB';
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

  if (rawKey.length === 1 && rawKey.charCodeAt(0) > 127) {
    const decoded = decodeTelexKeyFromComposedChar(rawKey);
    if (decoded) return decoded;
  }
  if (/^[a-z]$/.test(rawKey)) return `Key${rawKey.toUpperCase()}`;
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

  const camActualDistRef = useRef(4.35);
  const wasAirborneRef = useRef(false);

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
    strideDistAccum: 0.52,
    strideLeftFoot: false,
    stridePhaseRad: 0,
    gpBtnPrev: [false, false, false, false] as [boolean, boolean, boolean, boolean],
  });

  useEffect(() => {
    let lastBackspaceMs = -1000;
    let lastImeBurstMs = -1000;
    let pendingSyntheticAKeyUp = false;

    const clearAllKeys = () => {
      pendingSyntheticAKeyUp = false;
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

      const now = performance.now();
      const rawKey = (e.key || '').toLowerCase();
      const hwCode = e.code || '';
      const isComposing = Boolean(e.isComposing || e.keyCode === 229 || e.which === 229);
      const isNonAsciiChar = rawKey.length === 1 && rawKey.charCodeAt(0) > 127;
      const isCarbonVirtualZeroInjection =
        hwCode === 'KeyA' && rawKey.length === 1 && rawKey !== 'a';
      const isBackspace = hwCode === 'Backspace' || rawKey === 'backspace';
      const isImeSynthetic =
        isComposing || isNonAsciiChar || isCarbonVirtualZeroInjection || isBackspace;

      if (isBackspace) {
        lastBackspaceMs = now;
      } else if (hwCode === 'KeyA' && rawKey === 'a' && now - lastBackspaceMs < 12) {
        // Exact 1-for-1 match for EVKey/OpenKey 'â + a -> aa' undo (Backspace + synthetic 'a' down + synthetic 'a' up)
        pendingSyntheticAKeyUp = true;
      }
      if (isImeSynthetic) {
        lastImeBurstMs = now;
      }

      const st = useGameStore.getState();
      const activeEl = document.activeElement as HTMLElement | null;
      const isButtonFocused = Boolean(
        activeEl &&
          (activeEl.tagName === 'BUTTON' ||
            activeEl.getAttribute('role') === 'button' ||
            activeEl.closest?.('button, [role="button"]'))
      );
      const code = resolveGameKeyCode(e);
      const canWalk = st.hasEnteredWorld && st.activeModal === 'none' && !st.chatDrawerOpen;
      const shiftHeld = Boolean(e.shiftKey || e.getModifierState?.('Shift'));

      const isMoveCode =
        code === 'KeyW' ||
        code === 'KeyA' ||
        code === 'KeyS' ||
        code === 'KeyD' ||
        code.startsWith('Arrow');

      // Always preventDefault on WASD / Arrow / Shift / IME-Backspace when free-roaming (EVEN during isComposing!)
      // so macOS Press-and-Hold & built-in Vietnamese Telex preedit never interrupt key-repeat or swallow keys!
      if (
        canWalk &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (isMoveCode ||
          code === 'ShiftLeft' ||
          code === 'ShiftRight' ||
          (isBackspace && now - lastImeBurstMs < 60))
      ) {
        e.preventDefault();
      }

      if (canWalk) {
        // Release residual mouse-click focus on HUD buttons once the player starts walking so Space jumps cleanly
        if (isMoveCode && isButtonFocused) {
          activeEl?.blur();
        }
        if (code === 'KeyW' || code === 'ArrowUp') {
          keysRef.current.forward = true;
        }
        if (code === 'KeyS' || code === 'ArrowDown') {
          keysRef.current.backward = true;
        }
        if (code === 'KeyA' || code === 'ArrowLeft') {
          keysRef.current.left = true;
        }
        if (code === 'KeyD' || code === 'ArrowRight') {
          keysRef.current.right = true;
        }
        if (code === 'ShiftLeft' || code === 'ShiftRight' || shiftHeld) {
          keysRef.current.shift = true;
        } else if (!isImeSynthetic && isMoveCode && !shiftHeld) {
          keysRef.current.shift = false;
        }
      } else {
        clearAllKeys();
      }

      if (!st.hasEnteredWorld) return;

      if (code === 'Space') {
        // Never hijack Space when a <button> / [role="button"] has focus, when a modal is open, or when chat drawer is open!
        if (isButtonFocused || st.activeModal !== 'none' || st.chatDrawerOpen) {
          return;
        }
        e.preventDefault();
        if (shiftHeld) {
          keysRef.current.shift = true;
        }
        if (st.photoModeActive) {
          if (!st.latestCapturedPolaroid && st.photoCountdown === 0) {
            st.requestPhotoShutter();
          }
          return;
        }
        st.localTransient.jumpRequested = true;
        return;
      }

      // Hold Alt to temporarily unlock mouse cursor for clicking HUD buttons
      if (code === 'AltLeft' || code === 'AltRight') {
        if (document.pointerLockElement === gl.domElement) {
          document.exitPointerLock?.();
        }
      }

      // Escape exits Photo Mode, closes open Modal, yields to HUD submenus/chat drawer, or opens Settings in free-roam
      if (code === 'Escape') {
        if (st.photoModeActive) {
          st.setPhotoMode(false);
          return;
        }
        if (st.activeModal !== 'none') {
          st.setActiveModal('none');
          return;
        }
        if (document.body.dataset.hudSubmenuOpen === 'true' || st.chatDrawerOpen) {
          return;
        }
        if (document.pointerLockElement !== gl.domElement) {
          st.setActiveModal('settings');
          return;
        }
      }

      // Ignore all single-key shortcuts while Vietnamese Telex/VNI IME is composing (e.g. `oo -> ô`) or chat drawer is open!
      if (isComposing || isNonAsciiChar || st.chatDrawerOpen) {
        return;
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

      // Quick Social Interactions when near another cloud-hunter: [G] Greet, [H] Warm Cup Clink, [V] Cheer, [F] Gift Flower, [B] Sparkler, [C] Portrait
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
        if (code === 'KeyF') {
          executePeerSocialAction('gift_flower', st.nearbyPeer, net);
          return;
        }
        if (code === 'KeyB') {
          executePeerSocialAction('sparkler', st.nearbyPeer, net);
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
      const now = performance.now();
      const hwCode = e.code || '';
      const rawKey = (e.key || '').toLowerCase();

      // 1. Physical Shift release
      if (hwCode === 'ShiftLeft' || hwCode === 'ShiftRight' || rawKey === 'shift') {
        keysRef.current.shift = Boolean(e.shiftKey);
        return;
      }

      // 2. Ignore synthetic EVKey / OpenKey / Unikey Backspace & CGEventKeyboardSetUnicodeString keyups:
      // EVKey/OpenKey posts synthetic Backspace + virtualKey=0 ('KeyA') keydown+keyup bursts in <2ms with
      // e.shiftKey === false, whereas genuine physical kCGEventKeyUp passes through untouched!
      if (hwCode === 'Backspace' || rawKey === 'backspace') {
        return;
      }
      if (hwCode === 'KeyA' && rawKey === 'a' && pendingSyntheticAKeyUp) {
        pendingSyntheticAKeyUp = false;
        return;
      }
      const isNonAsciiChar = rawKey.length === 1 && rawKey.charCodeAt(0) > 127;
      const isCarbonVirtualZeroKeyUp =
        hwCode === 'KeyA' && rawKey.length === 1 && rawKey !== 'a';
      if (
        isCarbonVirtualZeroKeyUp ||
        (isNonAsciiChar && (hwCode === 'KeyA' || !hwCode || hwCode === 'Unidentified')) ||
        ((e.isComposing || e.keyCode === 229 || e.which === 229) &&
          (!hwCode || hwCode === 'Unidentified'))
      ) {
        return;
      }

      // Sync Shift state on genuine physical ASCII keyup without letting synthetic IME events clear Shift
      if (!isNonAsciiChar && !e.isComposing && e.keyCode !== 229 && !e.shiftKey) {
        keysRef.current.shift = false;
      }

      // 3. Always trust physical USB HID e.code first so releasing A/S/D never cancels a held W key under Telex!
      if (hwCode && hwCode !== 'Unidentified') {
        if (hwCode === 'KeyW' || hwCode === 'ArrowUp') {
          keysRef.current.forward = false;
          return;
        }
        if (hwCode === 'KeyS' || hwCode === 'ArrowDown') {
          keysRef.current.backward = false;
          return;
        }
        if (hwCode === 'KeyA' || hwCode === 'ArrowLeft') {
          keysRef.current.left = false;
          return;
        }
        if (hwCode === 'KeyD' || hwCode === 'ArrowRight') {
          keysRef.current.right = false;
          return;
        }
      }

      // 4. Fallback only when hardware e.code is missing (e.g. legacy Windows IME VK_PACKET)
      const code = resolveGameKeyCode(e);
      if (code === 'KeyW' || code === 'ArrowUp') keysRef.current.forward = false;
      if (code === 'KeyS' || code === 'ArrowDown') keysRef.current.backward = false;
      if (code === 'KeyA' || code === 'ArrowLeft') keysRef.current.left = false;
      if (code === 'KeyD' || code === 'ArrowRight') keysRef.current.right = false;
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
          '[data-dalat-drawer="true"], [data-dalat-peer-pill="true"], button, input, textarea, select, a, label, [role="button"]'
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
      // Release any residual focus on HUD buttons when clicking back into the 3D world
      const activeEl = document.activeElement as HTMLElement | null;
      if (
        activeEl &&
        (activeEl.tagName === 'BUTTON' ||
          activeEl.getAttribute('role') === 'button' ||
          activeEl.closest?.('button, [role="button"]'))
      ) {
        activeEl.blur();
      }
      if (!st.chatDrawerOpen) {
        keysRef.current.shift = Boolean(e.shiftKey);
      }
      if (e.button === 0 || e.button === 1 || e.button === 2) {
        orbitStateRef.current.dragging = true;
        orbitStateRef.current.lastX = e.clientX;
        orbitStateRef.current.lastY = e.clientY;
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
      if (!st.chatDrawerOpen && e.shiftKey && !keysRef.current.shift) {
        keysRef.current.shift = true;
      }

      const isLocked = document.pointerLockElement === dom;
      if (!orbitStateRef.current.dragging && !isLocked) return;

      const rawDx = isLocked ? e.movementX : e.clientX - orbitStateRef.current.lastX;
      const rawDy = isLocked ? e.movementY : e.clientY - orbitStateRef.current.lastY;
      orbitStateRef.current.lastX = e.clientX;
      orbitStateRef.current.lastY = e.clientY;

      // Guard against occasional OS pointer-lock warp spikes (>180px in 1 event)
      const dx = THREE.MathUtils.clamp(rawDx, -180, 180);
      const dy = THREE.MathUtils.clamp(rawDy, -180, 180);

      const baseSens = st.photoModeActive ? 0.0024 : isLocked ? 0.0029 : 0.0042;
      const sens = baseSens * st.cameraSensitivity;
      st.localTransient.cameraYaw -= dx * sens;
      const minPitch = st.photoModeActive ? -0.85 : -0.34;
      const maxPitch = st.photoModeActive ? 0.95 : 0.98;
      st.localTransient.cameraPitch = THREE.MathUtils.clamp(
        st.localTransient.cameraPitch + dy * sens,
        minPitch,
        maxPitch
      );
      if (Math.hypot(dx, dy) > 3) {
        st.advanceOnboarding('look');
      }
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
      // Two-finger horizontal trackpad pan rotates camera yaw smoothly in third-person mode
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.1 && Math.abs(e.deltaX) > 0.4) {
        e.preventDefault();
        st.localTransient.cameraYaw -= e.deltaX * 0.0042 * st.cameraSensitivity;
        st.advanceOnboarding('look');
        return;
      }
      const nextCamDist = THREE.MathUtils.clamp(
        st.localTransient.targetCameraDistance + e.deltaY * 0.0045,
        1.35,
        8.6
      );
      st.localTransient.targetCameraDistance = nextCamDist;
      orbitStateRef.current.targetDistance = nextCamDist;
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
      const isWideDesktop =
        typeof window !== 'undefined'
          ? (window.innerWidth >= 860 && window.innerHeight >= 540) ||
            (window.innerHeight < 520 && window.innerWidth > window.innerHeight)
          : true;
      const zoom = lt.previewCurrentZoom;
      const zoomPortraitLift = Math.max(0, 1.0 - zoom) * 0.36;
      const panY = lt.previewCurrentPanY;
      const breathAmp = st.reducedMotion ? 0 : 0.04 * zoom;

      const camX = lt.x - 2.66 * zoom + Math.sin(elapsed * 0.24) * breathAmp;
      const camZ = lt.z - 0.88 * zoom + Math.cos(elapsed * 0.19) * breathAmp;
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

    // 4. Input Vector (Keyboard + Mobile Virtual Joystick + Standard Web Gamepad API)
    const keys = keysRef.current;
    const modalBlocking = st.activeModal !== 'none';
    const movementBlocked =
      modalBlocking || st.chatDrawerOpen || !st.hasEnteredWorld || isTypingInInput();
    if (movementBlocked) {
      keys.forward = false;
      keys.backward = false;
      keys.left = false;
      keys.right = false;
      keys.shift = false;
    }
    if ((modalBlocking || st.chatDrawerOpen) && document.pointerLockElement === gl.domElement) {
      document.exitPointerLock?.();
    }

    let gpMoveX = 0;
    let gpMoveZ = 0;
    let gpSprint = false;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null;
    const pad = pads ? pads[0] || pads[1] || pads[2] || pads[3] : null;
    if (pad && pad.connected) {
      const deadzone = (v: number) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
      gpMoveX = deadzone(pad.axes[0] || 0);
      gpMoveZ = deadzone(pad.axes[1] || 0);
      const rx = deadzone(pad.axes[2] || 0);
      const ry = deadzone(pad.axes[3] || 0);
      if (!modalBlocking && (rx !== 0 || ry !== 0)) {
        const gpLookRate = (st.photoModeActive ? 1.5 : 2.35) * st.cameraSensitivity;
        lt.cameraYaw -= rx * gpLookRate * dt;
        const minP = st.photoModeActive ? -0.85 : -0.34;
        const maxP = st.photoModeActive ? 0.95 : 0.98;
        lt.cameraPitch = THREE.MathUtils.clamp(lt.cameraPitch + ry * gpLookRate * 0.72 * dt, minP, maxP);
        st.advanceOnboarding('look');
      }
      gpSprint = Boolean(pad.buttons[10]?.pressed || (pad.buttons[6]?.value ?? 0) > 0.4 || (pad.buttons[7]?.value ?? 0) > 0.4);

      if (!modalBlocking && !st.photoModeActive) {
        if (pad.buttons[12]?.pressed) {
          lt.targetCameraDistance = THREE.MathUtils.clamp(lt.targetCameraDistance - 2.6 * dt, 1.35, 8.6);
        }
        if (pad.buttons[13]?.pressed) {
          lt.targetCameraDistance = THREE.MathUtils.clamp(lt.targetCameraDistance + 2.6 * dt, 1.35, 8.6);
        }
      }

      const b0 = Boolean(pad.buttons[0]?.pressed); // A / Cross
      const b1 = Boolean(pad.buttons[1]?.pressed); // B / Circle
      const b2 = Boolean(pad.buttons[2]?.pressed); // X / Square
      const b3 = Boolean(pad.buttons[3]?.pressed); // Y / Triangle
      const prev = tState.gpBtnPrev;

      if (b0 && !prev[0]) {
        if (st.photoModeActive) {
          if (!st.latestCapturedPolaroid && st.photoCountdown === 0) st.requestPhotoShutter();
        } else if (!modalBlocking && st.nearbyPrompt) {
          executeInteractPrompt(st.nearbyPrompt, net);
        } else if (!modalBlocking) {
          lt.jumpRequested = true;
        }
      }
      if (b1 && !prev[1]) {
        if (st.photoModeActive) st.setPhotoMode(false);
        else if (modalBlocking) st.setActiveModal('none');
        else lt.jumpRequested = true;
      }
      if (b2 && !prev[2] && !modalBlocking && !st.photoModeActive && st.nearbyPeer) {
        executePeerSocialAction('greet', st.nearbyPeer, net);
      }
      if (b3 && !prev[3] && !modalBlocking) {
        const nextPhoto = !st.photoModeActive;
        if (nextPhoto && st.heldItem !== 'film_camera') {
          st.setHeldItem('film_camera');
          net.sendHeldItem('film_camera');
        }
        st.setPhotoMode(nextPhoto);
      }
      tState.gpBtnPrev = [b0, b1, b2, b3];
    }

    // Normalize keyboard (fwd, right) when Math.hypot(fwd, right) > 1 so diagonal W+D === straight W (ratio = 1.00)!
    let kbRight = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let kbFwd = (keys.backward ? 1 : 0) - (keys.forward ? 1 : 0);
    const kbHypot = Math.hypot(kbRight, kbFwd);
    if (kbHypot > 1) {
      kbRight /= kbHypot;
      kbFwd /= kbHypot;
    }

    const rawInX = movementBlocked ? 0 : kbRight + lt.moveInputX + gpMoveX;
    const rawInZ = movementBlocked ? 0 : kbFwd + lt.moveInputZ + gpMoveZ;
    const rawLen = Math.hypot(rawInX, rawInZ);
    const inputMag = Math.min(1, rawLen);

    // In Photo Mode, WASD gently pans the viewfinder within a cozy 3.2m tripod leash around the player
    if (st.photoModeActive) {
      lt.moving = false;
      lt.running = false;
      lt.vx = 0;
      lt.vz = 0;
      if (inputMag > 0.02 && rawLen > 0.001 && !st.latestCapturedPolaroid) {
        const forwardX = -Math.sin(lt.cameraYaw);
        const forwardZ = -Math.cos(lt.cameraYaw);
        const rightX = Math.cos(lt.cameraYaw);
        const rightZ = -Math.sin(lt.cameraYaw);
        const nx = rawInX / rawLen;
        const nz = rawInZ / rawLen;
        const moveWorldX = rightX * nx + forwardX * -nz;
        const moveWorldZ = rightZ * nx + forwardZ * -nz;
        _photoOffset.x += moveWorldX * 3.2 * inputMag * dt;
        _photoOffset.z += moveWorldZ * 3.2 * inputMag * dt;
        if (_photoOffset.length() > 3.2) {
          _photoOffset.setLength(3.2);
        }
      }
    } else {
      // Auto-stand up from bench if player moves or jumps (bench-cafe-1/2 steps inward to x - 0.72 onto clear planks!)
      if (st.seatedBenchId && (inputMag > 0.15 || lt.jumpRequested)) {
        const standPos = computeBenchStandUpPosition(st.seatedBenchId);
        if (standPos) {
          lt.x = standPos[0];
          lt.y = standPos[1];
          lt.z = standPos[2];
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
        wasAirborneRef.current = false;
        tState.coyoteTimerSec = COYOTE_TIME_SEC;
        tState.jumpBufferSec = 0;
      } else {
        // Compute camera-relative movement direction on XZ plane
        // Third-person camera sits at offset (+sin(cameraYaw), +cos(cameraYaw)) * dist, looking toward (-sin, -cos)
        const forwardX = -Math.sin(lt.cameraYaw);
        const forwardZ = -Math.cos(lt.cameraYaw);
        const rightX = Math.cos(lt.cameraYaw);
        const rightZ = -Math.sin(lt.cameraYaw);

        const nx = rawLen > 0.001 ? rawInX / rawLen : 0;
        const nz = rawLen > 0.001 ? rawInZ / rawLen : 0;
        const wishDirX = rightX * nx + forwardX * -nz;
        const wishDirZ = rightZ * nx + forwardZ * -nz;

        const wantsRun =
          keys.shift ||
          gpSprint ||
          (inputMag > 0.88 &&
            (Math.abs(lt.moveInputX) > 0.05 ||
              Math.abs(lt.moveInputZ) > 0.05 ||
              Math.abs(gpMoveX) > 0.05 ||
              Math.abs(gpMoveZ) > 0.05));
        const warmRunBoost = st.warmthRemainingSec > 0 ? 1.12 : 1.0; // +12% Highland Warmth sprint boost!
        const warmWalkBoost = st.warmthRemainingSec > 0 ? 1.05 : 1.0;
        const maxSpeed = wantsRun
          ? WORLD_CONSTANTS.MAX_RUN_SPEED * warmRunBoost
          : WORLD_CONSTANTS.MAX_WALK_SPEED * warmWalkBoost;

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
        lt.running = lt.moving && wantsRun && horizSpeed > 2.85;

        if (lt.moving) {
          const desiredYaw = Math.atan2(wishDirX, wishDirZ);
          const turnLambda = lt.running ? 18.0 : 16.0;
          lt.yaw += shortestAngleDiff(lt.yaw, desiredYaw) * (1 - Math.exp(-turnLambda * dt));
          st.advanceOnboarding('move');
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
          wasAirborneRef.current = true;
          tState.jumpBufferSec = 0;
          tState.coyoteTimerSec = 0;
          justJumped = true;
        }

        if (!wasGrounded || justJumped) {
          if (!justJumped) {
            lt.vy += GRAVITY * dt;
            if (lt.vy < -1.4) {
              wasAirborneRef.current = true;
            }
          }
        } else {
          lt.vy = 0;
        }

        // Advance horizontal position within 900m x 900m safe ridge boundary
        // (sub-stepped when stepDist > 0.12m so fast sprints never tunnel through thin railings/trunks)
        const bound = WORLD_CONSTANTS.HALF_SIZE - 14;
        const initialStepDist = Math.hypot(lt.vx * dt, lt.vz * dt);
        const horizSubSteps =
          initialStepDist > 0.12 ? Math.min(3, Math.ceil(initialStepDist / 0.12)) : 1;
        lt.y += lt.vy * dt;

        // Helper: block uphill velocity only on true >62.8° outer abyssal cliffs (macro slopeTan > 1.95),
        // never on open grassy hillsides, trail embankments, or Cầu Đất tea terraces!
        const applySteepCliffLimit = (prevX: number, prevZ: number, nextX: number, nextZ: number) => {
          const surfNext = getSurfaceType(nextX, nextZ);
          const walkNext = sampleWalkableHeight(nextX, nextZ);
          const groundNext = sampleGroundHeight(nextX, nextZ);
          const onWoodenDeck =
            surfNext === 'wood_deck' ||
            (walkNext > groundNext + 0.15 && lt.y >= walkNext - 1.45);
          if (onWoodenDeck || distanceToTrail(nextX, nextZ) <= 9.0) {
            return { x: nextX, z: nextZ };
          }
          const grad = sampleGroundGradient(nextX, nextZ, 2.2);
          if (grad.slopeTan > 1.95) {
            const upDot = lt.vx * grad.dhdx + lt.vz * grad.dhdz;
            if (upDot > 0) {
              const gradSq = grad.dhdx * grad.dhdx + grad.dhdz * grad.dhdz;
              if (gradSq > 1e-6) {
                lt.vx -= (upDot / gradSq) * grad.dhdx;
                lt.vz -= (upDot / gradSq) * grad.dhdz;
              }
              const subDt = dt / horizSubSteps;
              let slideX = THREE.MathUtils.clamp(prevX + lt.vx * subDt, -bound, bound);
              let slideZ = THREE.MathUtils.clamp(prevZ + lt.vz * subDt, -bound, bound);
              const prevG = sampleGroundHeight(prevX, prevZ);
              const slideG = sampleGroundHeight(slideX, slideZ);
              if (slideG > prevG && gradSq > 1e-6) {
                const excessH = slideG - prevG;
                slideX -= (excessH / gradSq) * grad.dhdx;
                slideZ -= (excessH / gradSq) * grad.dhdz;
              }
              return { x: slideX, z: slideZ };
            }
          }
          return { x: nextX, z: nextZ };
        };

        // 5. Watertight 2-Pass BVH Capsule Obstacle Pushout + Downward Raycast + Anti-Tunneling Floor Guard
        // Separate horizontal obstacle BVH (walls/railings/cabins/props/trunks ONLY) from floor BVH (terrain + decks)
        // so grassy terrain slopes NEVER act as invisible horizontal walls!
        const obsCollider = worldColliderRegistry.getObstacleCollider();
        const floorCollider = worldColliderRegistry.getCollider();
        let bvhFloorY: number | null = null;

        if (obsCollider) {
          const { mesh: obsMesh, bvh: obsBvh } = obsCollider;
          obsMesh.updateMatrixWorld();
          _invMat.copy(obsMesh.matrixWorld).invert();
          _normalMat.getNormalMatrix(obsMesh.matrixWorld);

          for (let sub = 0; sub < horizSubSteps; sub++) {
            const prevX = lt.x;
            const prevZ = lt.z;
            const subDt = dt / horizSubSteps;
            const candX = THREE.MathUtils.clamp(prevX + lt.vx * subDt, -bound, bound);
            const candZ = THREE.MathUtils.clamp(prevZ + lt.vz * subDt, -bound, bound);
            const cliffClamped = applySteepCliffLimit(prevX, prevZ, candX, candZ);
            lt.x = cliffClamped.x;
            lt.z = cliffClamped.z;

            // 5a. Two-iteration horizontal wall/railing/cabin/tree/prop capsule shapecast
            // With CAPSULE_RADIUS=0.38, start.y = lt.y + 0.66 places bottom sphere at lt.y + 0.28m (true 28cm step clearance!)
            _capsuleSeg.start.set(lt.x, lt.y + 0.66, lt.z).applyMatrix4(_invMat);
            _capsuleSeg.end.set(lt.x, lt.y + 1.56, lt.z).applyMatrix4(_invMat);

            for (let iter = 0; iter < 2; iter++) {
              _capsuleBox.makeEmpty();
              _capsuleBox.expandByPoint(_capsuleSeg.start);
              _capsuleBox.expandByPoint(_capsuleSeg.end);
              _capsuleBox.min.addScalar(-CAPSULE_RADIUS - 0.06);
              _capsuleBox.max.addScalar(CAPSULE_RADIUS + 0.06);

              let anyPush = false;
              obsBvh.shapecast({
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
            _hitWorld.copy(_capsuleSeg.start).applyMatrix4(obsMesh.matrixWorld);
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
        } else {
          for (let sub = 0; sub < horizSubSteps; sub++) {
            const prevX = lt.x;
            const prevZ = lt.z;
            const subDt = dt / horizSubSteps;
            const candX = THREE.MathUtils.clamp(prevX + lt.vx * subDt, -bound, bound);
            const candZ = THREE.MathUtils.clamp(prevZ + lt.vz * subDt, -bound, bound);
            const cliffClamped = applySteepCliffLimit(prevX, prevZ, candX, candZ);
            lt.x = cliffClamped.x;
            lt.z = cliffClamped.z;
          }
        }

        // 5b. Multi-point foot-base downward raycast from chest height against full floor BVH (terrain + decks)
        if (floorCollider) {
          const { mesh, bvh } = floorCollider;
          mesh.updateMatrixWorld();
          _invMat.copy(mesh.matrixWorld).invert();
          _normalMat.getNormalMatrix(mesh.matrixWorld);
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

        // 5c. Personal-space soft separation against visible nearby peers ONLY (never hidden/stale/seated peers!)
        const peers = st.peers;
        for (const peerId in peers) {
          const peer = peers[peerId];
          if (!peer) continue;
          if (peer.inNearAoi === false) continue;
          if (peer.lastNearSnapMs !== undefined && nowMs - peer.lastNearSnapMs > 1500) continue;
          if (peer.seatId) continue;
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

        // Trigger a soft tactile footstep/landing sound when landing from a jump or drop
        if (wasAirborneRef.current && lt.grounded) {
          wasAirborneRef.current = false;
          tState.strideDistAccum = 0.15;
          playLandingFootstep(getSurfaceType(lt.x, lt.z));
        }

        // Rhythmic surface-matched walking & running footsteps synced to biomechanical step length
        if (lt.grounded && lt.moving && !st.seatedBenchId) {
          const horizSpeed = Math.hypot(lt.vx, lt.vz);
          const stepLen = lt.running ? 1.42 : 0.91;
          tState.strideDistAccum += horizSpeed * dt;
          tState.stridePhaseRad =
            (tState.stridePhaseRad + (horizSpeed / stepLen) * Math.PI * dt) % (Math.PI * 2);
          if (tState.strideDistAccum >= stepLen) {
            tState.strideDistAccum %= stepLen;
            tState.strideLeftFoot = !tState.strideLeftFoot;
            playStrideFootstep(
              getSurfaceType(lt.x, lt.z),
              lt.running,
              tState.strideLeftFoot,
              st.atmosphere.drizzleIntensity
            );
          }
        } else {
          tState.strideDistAccum = 0.52;
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
      const collider = worldColliderRegistry.getObstacleCollider();
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
      lt.cameraOccludesSelf = false;

      const targetFov = FOCAL_TO_FOV[st.photoFocalMm] || 54;
      oState.currentFov += (targetFov - oState.currentFov) * (1 - Math.exp(-14 * dt));
    } else if (st.activeModal === 'wardrobe') {
      // Smooth Full-Body Live Wardrobe Portrait Camera (frames character on uncovered right 3D stage + live pan/zoom!)
      const isWideDesktop =
        typeof window !== 'undefined'
          ? (window.innerWidth >= 860 && window.innerHeight >= 540) ||
            (window.innerHeight < 520 && window.innerWidth > window.innerHeight)
          : true;
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
      lt.cameraOccludesSelf = false;
    } else {
      // Detect iconic Da Lat cloud-hunting viewpoints for wide horizon framing (52° -> 58°)
      const nearPierTip = Math.hypot(lt.x - 91, lt.z - -75) < 13.5;
      const nearValleyOverlook = Math.hypot(lt.x - 18, lt.z - 128) < 16.0;
      const nearLonelyPine = Math.hypot(lt.x - -94, lt.z - -146) < 17.0;
      const nearPinkHollow = Math.hypot(lt.x - -12, lt.z - -174) < 15.0;
      const isScenicOverlook =
        nearPierTip || nearValleyOverlook || nearLonelyPine || nearPinkHollow;

      const sprintFovBoost = !st.reducedMotion && lt.running ? 2.5 : 0;
      const targetFov = (isScenicOverlook && !st.reducedMotion ? 58 : 52) + sprintFovBoost;
      oState.currentFov += (targetFov - oState.currentFov) * (1 - Math.exp(-5.0 * dt));

      oState.targetDistance = lt.targetCameraDistance;
      const scenicDistBoost = isScenicOverlook ? 0.65 : 0;
      oState.distance +=
        (oState.targetDistance + scenicDistBoost - oState.distance) * (1 - Math.exp(-11 * dt));

      const strideCamBob =
        !st.reducedMotion && lt.grounded && lt.moving && !st.seatedBenchId
          ? Math.sin(tState.stridePhaseRad * 2) * (lt.running ? 0.011 : 0.0055)
          : 0;
      const pivotLift =
        (st.seatedBenchId ? 1.24 : 1.48) + (isScenicOverlook ? 0.34 : 0) + strideCamBob;
      _camPivot.set(lt.x, lt.y + pivotLift, lt.z);

      const wasUninitialized = !oState.initialized;
      if (wasUninitialized) {
        oState.smoothPivot.copy(_camPivot);
        oState.smoothFloorLift = 0;
        oState.initialized = true;
      } else {
        // Lock XZ pivot 1:1 to velocity-smoothed player position so avatar never jitters relative to camera!
        const yBlend = 1 - Math.exp(-18 * dt);
        oState.smoothPivot.x = _camPivot.x;
        oState.smoothPivot.z = _camPivot.z;
        oState.smoothPivot.y += (_camPivot.y - oState.smoothPivot.y) * yBlend;
      }

      // Compute spherical orbit direction from smoothPivot
      const cosPitch = Math.cos(lt.cameraPitch);
      const dirX = Math.sin(lt.cameraYaw) * cosPitch;
      const dirY = Math.sin(lt.cameraPitch);
      const dirZ = Math.cos(lt.cameraYaw) * cosPitch;
      const desiredDist = oState.distance;

      // Ideal unobstructed camera position
      _camDesired.set(
        oState.smoothPivot.x + dirX * desiredDist,
        oState.smoothPivot.y + dirY * desiredDist,
        oState.smoothPivot.z + dirZ * desiredDist
      );

      // Wall/Cabin Spring-Arm BVH Raycast from (lt.x, lt.y + 1.42, lt.z) toward _camDesired
      let targetCamDist = desiredDist;
      const camCollider = worldColliderRegistry.getCollider();
      if (camCollider) {
        const { mesh, bvh } = camCollider;
        mesh.updateMatrixWorld();
        _invMat.copy(mesh.matrixWorld).invert();
        _camRayOrigin.set(lt.x, lt.y + 1.42, lt.z);
        _camRayDir.subVectors(_camDesired, _camRayOrigin);
        const segLen = _camRayDir.length();
        if (segLen > 0.34) {
          _camRayDir.divideScalar(segLen);
          _ray.origin.copy(_camRayOrigin).applyMatrix4(_invMat);
          _ray.direction.copy(_camRayDir).transformDirection(_invMat).normalize();
          const hit = bvh.raycastFirst(_ray, THREE.DoubleSide, 0.32, segLen + 0.15);
          if (hit) {
            _hitWorld.copy(hit.point).applyMatrix4(mesh.matrixWorld);
            const hitDist = _hitWorld.distanceTo(_camRayOrigin);
            if (hitDist > 0.32 && hitDist < desiredDist + 0.15) {
              // Pull in to Math.max(0.82, hitDist - 0.28), capped to hitDist - 0.14 when backed tight (<1.1m) against a cabin wall!
              targetCamDist = Math.max(
                0.26,
                Math.min(hitDist - 0.14, Math.max(0.82, hitDist - 0.28))
              );
            }
          }
        }
      }

      if (wasUninitialized) {
        camActualDistRef.current = targetCamDist;
      } else if (targetCamDist < camActualDistRef.current) {
        // Fast pull-in (dt * 24) so walls never occlude the avatar
        camActualDistRef.current +=
          (targetCamDist - camActualDistRef.current) * Math.min(1, dt * 24);
      } else {
        // Smooth ease-out (dt * 7) so spring arm never pumps or jitters
        camActualDistRef.current +=
          (targetCamDist - camActualDistRef.current) * Math.min(1, dt * 7);
      }

      const actualDist = camActualDistRef.current;
      _camDesired.set(
        oState.smoothPivot.x + dirX * actualDist,
        oState.smoothPivot.y + dirY * actualDist,
        oState.smoothPivot.z + dirZ * actualDist
      );

      // Under-Deck +7..13m Snap Fix: check both walkable deck height and natural ground height!
      const walkH = sampleWalkableHeight(_camDesired.x, _camDesired.z);
      const groundH = sampleGroundHeight(_camDesired.x, _camDesired.z);
      if (lt.y < walkH - 1.5) {
        // Player is underneath an elevated stilted deck — never snap camera up onto walkH!
        oState.smoothFloorLift = 0;
        _camDesired.y = Math.min(walkH - 0.45, Math.max(groundH + 0.52, _camDesired.y));
      } else {
        const minCamY = walkH + 0.62;
        const neededLift = Math.max(0, minCamY - _camDesired.y);
        oState.smoothFloorLift +=
          (neededLift - oState.smoothFloorLift) * (1 - Math.exp(-20 * dt));
        _camDesired.y += oState.smoothFloorLift;
      }

      _camLookAt.set(
        oState.smoothPivot.x - Math.sin(lt.cameraYaw) * 1.15,
        oState.smoothPivot.y - 0.06,
        oState.smoothPivot.z - Math.cos(lt.cameraYaw) * 1.15
      );

      camera.position.copy(_camDesired);
      camera.lookAt(_camLookAt);
      lt.cameraOccludesSelf = actualDist < 0.88;
    }

    lt.camX = camera.position.x;
    lt.camY = camera.position.y;
    lt.camZ = camera.position.z;

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

      const nextPrompt = st.photoModeActive ? null : evaluateNearbyPrompt(lt.x, lt.z, lt.y);
      const nextId = nextPrompt ? nextPrompt.id : '';
      if (nextId !== tState.lastPromptId) {
        tState.lastPromptId = nextId;
        st.setNearbyPrompt(nextPrompt);
      }

      const nextPeer = st.photoModeActive ? null : evaluateNearbyPeer(lt.x, lt.y, lt.z);
      const nextPeerKey = nextPeer
        ? `${nextPeer.sessionId}:${nextPeer.displayName}:${nextPeer.heldItem}:${nextPeer.seatId || ''}:${Math.round(nextPeer.distance)}`
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
