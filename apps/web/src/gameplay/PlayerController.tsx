import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  getSurfaceType,
  LANDMARK_LIST,
  sampleWalkableHeight,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
import type { IMultiplayerController } from '../network/types';
import { useGameStore } from '../store/gameStore';
import { worldColliderRegistry } from '../world/colliderRegistry';
import {
  evaluateNearbyPrompt,
  executeInteractPrompt,
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
const GRAVITY = -19.0;
const JUMP_VELOCITY = 6.2;
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
    distance: 4.5,
    targetDistance: 4.5,
    currentFov: 52,
    smoothCamPos: new THREE.Vector3(-42, 138, 38),
    smoothLookAt: new THREE.Vector3(-35, 136.5, 28),
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
    lastTeleportNonce: 0,
    wasPhotoMode: false,
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingInInput()) {
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement | null)?.blur();
        }
        return;
      }

      const st = useGameStore.getState();
      const code = e.code;

      // Movement keys
      if (code === 'KeyW' || code === 'ArrowUp') keysRef.current.forward = true;
      if (code === 'KeyS' || code === 'ArrowDown') keysRef.current.backward = true;
      if (code === 'KeyA' || code === 'ArrowLeft') keysRef.current.left = true;
      if (code === 'KeyD' || code === 'ArrowRight') keysRef.current.right = true;
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

      // Escape exits Photo Mode or closes open Modal
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
        }
        return;
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

      // Quick Diegetic Shortcuts: [P] Film Camera, [M] Pocket Map, [J] Cloud Almanac
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
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const code = e.code;
      if (code === 'KeyW' || code === 'ArrowUp') keysRef.current.forward = false;
      if (code === 'KeyS' || code === 'ArrowDown') keysRef.current.backward = false;
      if (code === 'KeyA' || code === 'ArrowLeft') keysRef.current.left = false;
      if (code === 'KeyD' || code === 'ArrowRight') keysRef.current.right = false;
      if (code === 'ShiftLeft' || code === 'ShiftRight') keysRef.current.shift = false;
    };

    const onWindowBlur = () => {
      keysRef.current.forward = false;
      keysRef.current.backward = false;
      keysRef.current.left = false;
      keysRef.current.right = false;
      keysRef.current.shift = false;
      orbitStateRef.current.dragging = false;
    };

    const dom = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      const st = useGameStore.getState();
      if (!st.hasEnteredWorld || st.activeModal !== 'none') return;
      if (e.button === 0 || e.button === 2) {
        orbitStateRef.current.dragging = true;
        orbitStateRef.current.lastX = e.clientX;
        orbitStateRef.current.lastY = e.clientY;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const st = useGameStore.getState();
      if (!st.hasEnteredWorld || st.activeModal !== 'none') return;

      const isLocked = document.pointerLockElement === dom;
      if (!orbitStateRef.current.dragging && !isLocked) return;

      const dx = isLocked ? e.movementX : e.clientX - orbitStateRef.current.lastX;
      const dy = isLocked ? e.movementY : e.clientY - orbitStateRef.current.lastY;
      orbitStateRef.current.lastX = e.clientX;
      orbitStateRef.current.lastY = e.clientY;

      const sens = st.photoModeActive ? 0.0028 : 0.0042;
      st.localTransient.cameraYaw -= dx * sens;
      const minPitch = st.photoModeActive ? -0.85 : -0.36;
      const maxPitch = st.photoModeActive ? 0.95 : 1.02;
      st.localTransient.cameraPitch = THREE.MathUtils.clamp(
        st.localTransient.cameraPitch + dy * sens,
        minPitch,
        maxPitch
      );
    };

    const onPointerUp = () => {
      orbitStateRef.current.dragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      const st = useGameStore.getState();
      if (!st.hasEnteredWorld || st.activeModal !== 'none') return;
      if (st.photoModeActive) {
        // Scroll wheel cycles or zooms lens gently in Photo Mode!
        const steps: Array<24 | 35 | 50 | 85> = [24, 35, 50, 85];
        const curIdx = steps.indexOf(st.photoFocalMm);
        const nextIdx = THREE.MathUtils.clamp(curIdx + (e.deltaY < 0 ? 1 : -1), 0, steps.length - 1);
        if (steps[nextIdx] !== st.photoFocalMm) {
          st.setPhotoOptions({ photoFocalMm: steps[nextIdx] });
        }
        return;
      }
      orbitStateRef.current.targetDistance = THREE.MathUtils.clamp(
        orbitStateRef.current.targetDistance + e.deltaY * 0.0045,
        2.35,
        8.6
      );
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('wheel', onWheel, { passive: true });
    dom.addEventListener('contextmenu', onContextMenu);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onContextMenu);
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

    // 2. Throttled atmosphere/warmth tick (~2 Hz) & renderer perf telemetry (~1 Hz)
    tState.atmoAccumSec += dt;
    if (tState.atmoAccumSec >= 0.5) {
      st.tickWarmthAndAtmosphere(tState.atmoAccumSec);
      tState.atmoAccumSec = 0;
    }

    tState.perfAccumSec += dt;
    tState.perfFrames += 1;
    if (tState.perfAccumSec >= 1.0) {
      const fps = Math.round(tState.perfFrames / tState.perfAccumSec);
      st.setPerfMetrics({
        fps,
        frameTimeMs: Math.round((1000 / Math.max(1, fps)) * 10) / 10,
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        textures: gl.info.memory.textures,
        geometries: gl.info.memory.geometries,
      });
      tState.perfAccumSec = 0;
      tState.perfFrames = 0;
    }

    // 3. Pre-Entry Panoramic Sunrise Camera (!hasEnteredWorld)
    if (!st.hasEnteredWorld) {
      const elapsed = clock.getElapsedTime();
      const angle = elapsed * 0.055;
      const panX = -30 + Math.sin(angle) * 14;
      const panZ = 28 + Math.cos(angle * 0.8) * 10;
      const panY = sampleWalkableHeight(panX, panZ) + 4.4;
      camera.position.set(panX, panY, panZ);
      camera.lookAt(135, 132, -32);
      if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.fov - 54) > 0.1) {
        camera.fov = 54;
        camera.updateProjectionMatrix();
      }
      return;
    }

    // Snap camera cleanly on fast-travel teleport
    if (st.teleportTarget && st.teleportTarget.nonce !== tState.lastTeleportNonce) {
      tState.lastTeleportNonce = st.teleportTarget.nonce;
      _photoOffset.set(0, 0, 0);
      oState.initialized = false;
    }

    // Reset photo camera offset when entering Photo Mode
    if (st.photoModeActive !== tState.wasPhotoMode) {
      tState.wasPhotoMode = st.photoModeActive;
      _photoOffset.set(0, 0, 0);
      if (st.photoModeActive) {
        // Point viewfinder initially in the direction the camera was already gazing!
        lt.cameraYaw = lt.cameraYaw + Math.PI;
        lt.cameraPitch = -lt.cameraPitch * 0.5;
      } else {
        lt.cameraYaw = lt.cameraYaw - Math.PI;
        lt.cameraPitch = Math.max(0.08, -lt.cameraPitch);
      }
    }

    // 4. Input Vector (Keyboard + Mobile Virtual Joystick)
    const keys = keysRef.current;
    const modalBlocking = st.activeModal !== 'none';
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
        const sinY = Math.sin(lt.cameraYaw);
        const cosY = Math.cos(lt.cameraYaw);
        const nx = rawInX / inputMag;
        const nz = rawInZ / inputMag;
        // camera faces (+sinY, -cosY) in photo mode
        const moveWorldX = nx * cosY - nz * sinY;
        const moveWorldZ = -nx * sinY - nz * cosY;
        _photoOffset.x += moveWorldX * 3.2 * dt;
        _photoOffset.z += moveWorldZ * 3.2 * dt;
        if (_photoOffset.length() > 3.2) {
          _photoOffset.setLength(3.2);
        }
      }
    } else {
      // Auto-stand up from bench if player moves or jumps
      if (st.seatedBenchId && (inputMag > 0.15 || lt.jumpRequested)) {
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

        const wantsRun = keys.shift || inputMag > 0.88 && (Math.abs(lt.moveInputX) > 0.05 || Math.abs(lt.moveInputZ) > 0.05);
        const warmBoost = st.warmthRemainingSec > 0 ? 1.12 : 1.0; // +12% Highland Warmth cozy boost!
        const maxSpeed = wantsRun
          ? WORLD_CONSTANTS.MAX_RUN_SPEED * warmBoost
          : WORLD_CONSTANTS.MAX_WALK_SPEED;

        const targetVx = wishDirX * maxSpeed * inputMag;
        const targetVz = wishDirZ * maxSpeed * inputMag;

        // Tactile momentum on damp red-basalt trails during Highland Drizzle!
        const surface = getSurfaceType(lt.x, lt.z);
        const isWetBasalt =
          surface === 'red_basalt_trail' &&
          (st.atmosphere.drizzleIntensity > 0.2 || st.atmosphere.weather === 'light_drizzle');
        const accelLambda = isWetBasalt ? 5.8 : 13.5;
        const blend = 1 - Math.exp(-accelLambda * dt);

        lt.vx += (targetVx - lt.vx) * blend;
        lt.vz += (targetVz - lt.vz) * blend;

        const horizSpeed = Math.hypot(lt.vx, lt.vz);
        lt.moving = inputMag > 0.06 && horizSpeed > 0.18;
        lt.running = lt.moving && wantsRun && horizSpeed > 3.3;

        if (lt.moving) {
          const desiredYaw = Math.atan2(wishDirX, wishDirZ);
          lt.yaw += shortestAngleDiff(lt.yaw, desiredYaw) * (1 - Math.exp(-12 * dt));
        }

        // Jump & Gravity
        if (lt.jumpRequested) {
          if (lt.grounded) {
            lt.vy = JUMP_VELOCITY;
            lt.grounded = false;
          }
          lt.jumpRequested = false;
        }

        if (!lt.grounded) {
          lt.vy += GRAVITY * dt;
        }

        // Advance horizontal position within 900m x 900m safe ridge boundary
        const bound = WORLD_CONSTANTS.HALF_SIZE - 14;
        lt.x = THREE.MathUtils.clamp(lt.x + lt.vx * dt, -bound, bound);
        lt.z = THREE.MathUtils.clamp(lt.z + lt.vz * dt, -bound, bound);
        lt.y += lt.vy * dt;

        // 5. BVH Capsule Obstacle Pushout + Downward Raycast + sampleWalkableHeight Safety Floor
        const collider = worldColliderRegistry.getCollider();
        let bvhFloorY: number | null = null;

        if (collider) {
          const { mesh, bvh } = collider;
          mesh.updateMatrixWorld();
          _invMat.copy(mesh.matrixWorld).invert();
          _normalMat.getNormalMatrix(mesh.matrixWorld);

          // 5a. Horizontal wall/railing capsule shapecast (starts 0.58m above feet so stairs climb freely!)
          _capsuleSeg.start.set(lt.x, lt.y + 0.58, lt.z).applyMatrix4(_invMat);
          _capsuleSeg.end.set(lt.x, lt.y + 1.52, lt.z).applyMatrix4(_invMat);
          _capsuleBox.makeEmpty();
          _capsuleBox.expandByPoint(_capsuleSeg.start);
          _capsuleBox.expandByPoint(_capsuleSeg.end);
          _capsuleBox.min.addScalar(-CAPSULE_RADIUS - 0.05);
          _capsuleBox.max.addScalar(CAPSULE_RADIUS + 0.05);

          bvh.shapecast({
            intersectsBounds: (box) => box.intersectsBox(_capsuleBox),
            intersectsTriangle: (tri) => {
              const dist = tri.closestPointToSegment(_capsuleSeg, _triPt, _capPt);
              if (dist < CAPSULE_RADIUS && dist > 1e-5) {
                tri.getNormal(_triNorm).applyMatrix3(_normalMat).normalize();
                // Push horizontally only against walls/railings/trunks, not walkable ramps
                if (Math.abs(_triNorm.y) < 0.62) {
                  _pushDir.subVectors(_capPt, _triPt);
                  _pushDir.y = 0;
                  const len = _pushDir.length();
                  if (len > 1e-5) {
                    const depth = CAPSULE_RADIUS - dist;
                    _pushDir.multiplyScalar(depth / len);
                    _capsuleSeg.start.add(_pushDir);
                    _capsuleSeg.end.add(_pushDir);
                  }
                }
              }
            },
          });

          // Transform resolved capsule XZ back to world space
          _hitWorld.copy(_capsuleSeg.start).applyMatrix4(mesh.matrixWorld);
          lt.x = _hitWorld.x;
          lt.z = _hitWorld.z;

          // 5b. Downward raycast from chest height (avoids snapping onto veranda/hut roofs overhead!)
          _ray.origin.set(lt.x, lt.y + 1.32, lt.z).applyMatrix4(_invMat);
          _ray.direction.copy(_downDir).transformDirection(_invMat).normalize();

          const hit = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, 3.1);
          if (hit) {
            _hitWorld.copy(hit.point).applyMatrix4(mesh.matrixWorld);
            if (hit.face) {
              _hitNormal.copy(hit.face.normal).applyMatrix3(_normalMat).normalize();
            } else {
              _hitNormal.set(0, 1, 0);
            }
            if (_hitNormal.y >= 0.45 && _hitWorld.y <= lt.y + 0.85) {
              bvhFloorY = _hitWorld.y;
            }
          }
        }

        const analyticalFloorY = sampleWalkableHeight(lt.x, lt.z);
        const targetFloorY =
          bvhFloorY !== null ? Math.max(bvhFloorY, analyticalFloorY) : analyticalFloorY;

        if (lt.vy <= 0.05 && lt.y <= targetFloorY + 0.34) {
          // Smooth step-up / slope-hug when grounded
          lt.y = THREE.MathUtils.lerp(lt.y, targetFloorY, 1 - Math.exp(-24 * dt));
          if (Math.abs(lt.y - targetFloorY) < 0.015) lt.y = targetFloorY;
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

    // 6. Cinematic Horizon Framing & Photo Mode Viewfinder Camera
    if (st.photoModeActive) {
      const eyeX = lt.x + _photoOffset.x;
      const eyeZ = lt.z + _photoOffset.z;
      const floorAtCam = sampleWalkableHeight(eyeX, eyeZ);
      const eyeY = Math.max(lt.y + 1.56, floorAtCam + 1.15);

      const cosP = Math.cos(lt.cameraPitch);
      const lookDirX = Math.sin(lt.cameraYaw) * cosP;
      const lookDirY = -Math.sin(lt.cameraPitch);
      const lookDirZ = -Math.cos(lt.cameraYaw) * cosP;

      camera.position.set(eyeX, eyeY, eyeZ);
      camera.lookAt(eyeX + lookDirX * 20, eyeY + lookDirY * 20, eyeZ + lookDirZ * 20);

      const targetFov = FOCAL_TO_FOV[st.photoFocalMm] || 54;
      oState.currentFov += (targetFov - oState.currentFov) * (1 - Math.exp(-14 * dt));
    } else {
      // Detect iconic Da Lat cloud-hunting viewpoints for wide horizon framing (52° -> 58°)
      const nearPierTip = Math.hypot(lt.x - 91, lt.z - -75) < 13.5;
      const nearValleyOverlook = Math.hypot(lt.x - 18, lt.z - 128) < 16.0;
      const nearLonelyPine = Math.hypot(lt.x - -94, lt.z - -146) < 17.0;
      const nearPinkHollow = Math.hypot(lt.x - -12, lt.z - -174) < 15.0;
      const isScenicOverlook =
        nearPierTip || nearValleyOverlook || nearLonelyPine || nearPinkHollow;

      const targetFov = isScenicOverlook ? 58 : 52;
      oState.currentFov += (targetFov - oState.currentFov) * (1 - Math.exp(-3.5 * dt));

      const scenicDistBoost = isScenicOverlook ? 0.65 : 0;
      oState.distance +=
        (oState.targetDistance + scenicDistBoost - oState.distance) * (1 - Math.exp(-9 * dt));

      const pivotLift = (st.seatedBenchId ? 1.24 : 1.48) + (isScenicOverlook ? 0.34 : 0);
      _camPivot.set(lt.x, lt.y + pivotLift, lt.z);

      const cosPitch = Math.cos(lt.cameraPitch);
      const offsetX = Math.sin(lt.cameraYaw) * cosPitch * oState.distance;
      const offsetY = Math.sin(lt.cameraPitch) * oState.distance;
      const offsetZ = Math.cos(lt.cameraYaw) * cosPitch * oState.distance;

      _camDesired.set(_camPivot.x + offsetX, _camPivot.y + offsetY, _camPivot.z + offsetZ);

      // Prevent camera from dipping below terrain or wooden decks
      const minCamY = sampleWalkableHeight(_camDesired.x, _camDesired.z) + 0.62;
      if (_camDesired.y < minCamY) _camDesired.y = minCamY;

      _camLookAt.set(
        lt.x - Math.sin(lt.cameraYaw) * 1.2,
        lt.y + (st.seatedBenchId ? 1.18 : 1.42) + (isScenicOverlook ? 0.28 : 0),
        lt.z - Math.cos(lt.cameraYaw) * 1.2
      );

      if (!oState.initialized) {
        oState.smoothCamPos.copy(_camDesired);
        oState.smoothLookAt.copy(_camLookAt);
        oState.initialized = true;
      } else {
        const camBlend = 1 - Math.exp(-15 * dt);
        oState.smoothCamPos.lerp(_camDesired, camBlend);
        oState.smoothLookAt.lerp(_camLookAt, camBlend);
      }

      camera.position.copy(oState.smoothCamPos);
      camera.lookAt(oState.smoothLookAt);
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
