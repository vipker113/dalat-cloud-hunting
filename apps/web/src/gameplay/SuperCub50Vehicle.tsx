import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  type PassengerPoseStyle,
  sampleGroundHeight,
  SCOOTER_PAINT_CATALOG,
  type ScooterPaintId,
  type ScooterStateSnapshot,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
import { playScooterHorn } from '../audio/highlandAudio';
import { useGameStore } from '../store/gameStore';
import type { ScooterPhysicsState } from './scooterPhysics';

export interface LiveScooterPose {
  scooterId: string;
  paintId: ScooterPaintId;
  plateLabel: string;
  driverSessionId: string;
  passengerSessionId: string;
  passengerPose: PassengerPoseStyle;
  x: number;
  y: number;
  z: number;
  chassisY: number;
  chassisDipY: number;
  yaw: number;
  pitch: number;
  bankRoll: number;
  steerAngle: number;
  wheelRotRad: number;
  frontCompression: number;
  rearCompression: number;
  speedKmh: number;
  forwardSpeed: number;
  grounded: boolean;
  headlightOn: boolean;
  isBraking: boolean;
  isDrifting: boolean;
  parked: boolean;
  landingImpact: number;
  chassisQuat: THREE.Quaternion;
  driverAnchorPos: THREE.Vector3;
  pillionAnchorPos: THREE.Vector3;
}

interface RemoteScooterKinematics {
  prevX: number;
  prevY: number;
  prevZ: number;
  prevYaw: number;
  prevGrounded: boolean;
  smoothPitch: number;
  smoothBank: number;
  smoothSteer: number;
  wheelRotRad: number;
  landingImpact: number;
  initialized: boolean;
}

const WHEEL_RADIUS = 0.275;
const STEER_PIVOT_Z = 0.54;
const DRIVER_LOCAL_OFFSET = new THREE.Vector3(0, 0.255, -0.055);
const PILLION_LOCAL_OFFSET = new THREE.Vector3(
  0,
  0.275,
  -WORLD_CONSTANTS.SCOOTER_PILLION_BACK_OFFSET
);

const _poseEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _tmpVec = new THREE.Vector3();

let localDriverScooterId: string | null = null;
let localDriverPhysSnapshot: ScooterPhysicsState | null = null;

const livePosesMap = new Map<string, LiveScooterPose>();
const remoteKinematicsMap = new Map<string, RemoteScooterKinematics>();

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function wrapAnglePi(rad: number): number {
  let r = (rad + Math.PI) % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r - Math.PI;
}

export function setLocalDriverPhysicsPose(
  scooterId: string | null,
  phys: ScooterPhysicsState | null
): void {
  localDriverScooterId = scooterId;
  localDriverPhysSnapshot = phys;
}

function getOrCreatePoseRecord(scooterId: string): LiveScooterPose {
  let rec = livePosesMap.get(scooterId);
  if (!rec) {
    rec = {
      scooterId,
      paintId: 'moss_green',
      plateLabel: '49-AA 1893',
      driverSessionId: '',
      passengerSessionId: '',
      passengerPose: 'hold_waist',
      x: 0,
      y: 0,
      z: 0,
      chassisY: 0,
      chassisDipY: 0,
      yaw: 0,
      pitch: 0,
      bankRoll: 0,
      steerAngle: 0,
      wheelRotRad: 0,
      frontCompression: 0.04,
      rearCompression: 0.04,
      speedKmh: 0,
      forwardSpeed: 0,
      grounded: true,
      headlightOn: true,
      isBraking: false,
      isDrifting: false,
      parked: true,
      landingImpact: 0,
      chassisQuat: new THREE.Quaternion(),
      driverAnchorPos: new THREE.Vector3(),
      pillionAnchorPos: new THREE.Vector3(),
    };
    livePosesMap.set(scooterId, rec);
  }
  return rec;
}

/**
 * Returns the current frame's pre-computed scooter pose map in O(1) time.
 */
export function readLiveScooterPoses(): Map<string, LiveScooterPose> {
  return livePosesMap;
}

/**
 * Computes and caches the exact 60 FPS world-space chassis & seat transforms for all Super Cub 50
 * scooters in the room ONCE per frame inside PlayerController.
 * Both Driver and Passenger avatars read from this exact map via `readLiveScooterPoses()` (0.00ms lag!).
 */
export function computeFrameScooterPoses(rawDt: number): Map<string, LiveScooterPose> {
  const dt = Math.max(0.001, Math.min(rawDt, 0.05));
  const st = useGameStore.getState();
  const scooters = st.scooters;
  const localSid = st.localSessionId || 'local';
  const activeIds = new Set<string>();

  for (const id in scooters) {
    const sc: ScooterStateSnapshot | undefined = scooters[id];
    if (!sc) continue;
    activeIds.add(id);

    const pose = getOrCreatePoseRecord(id);
    pose.paintId = sc.paintId;
    pose.plateLabel = sc.plateLabel;
    pose.driverSessionId = sc.driverSessionId;
    pose.passengerSessionId = sc.passengerSessionId;
    pose.passengerPose = sc.passengerPose;

    const isLocalDrivingThis =
      st.localVehicleRole === 'driver' &&
      st.localVehicleId === id &&
      localDriverScooterId === id &&
      localDriverPhysSnapshot !== null;

    if (isLocalDrivingThis && localDriverPhysSnapshot) {
      const p = localDriverPhysSnapshot;
      pose.x = p.x;
      pose.y = p.y;
      pose.z = p.z;
      pose.yaw = p.yaw;
      pose.pitch = p.pitch;
      pose.bankRoll = p.bankRoll;
      pose.steerAngle = p.steerAngle;
      pose.wheelRotRad = p.wheelRotRad;
      pose.frontCompression = p.frontCompression;
      pose.rearCompression = p.rearCompression;
      pose.speedKmh = p.speedKmh;
      pose.forwardSpeed = p.forwardSpeed;
      pose.grounded = p.grounded;
      pose.headlightOn = sc.headlightOn;
      pose.isBraking = p.braking;
      pose.isDrifting = p.drifting;
      pose.parked = false;
      pose.landingImpact = p.landingImpact;
    } else if (
      sc.driverSessionId &&
      sc.driverSessionId !== localSid &&
      st.peers[sc.driverSessionId]
    ) {
      const driverPeer = st.peers[sc.driverSessionId];
      let kin = remoteKinematicsMap.get(id);
      if (!kin) {
        kin = {
          prevX: driverPeer.x,
          prevY: driverPeer.y,
          prevZ: driverPeer.z,
          prevYaw: driverPeer.yaw,
          prevGrounded: driverPeer.grounded,
          smoothPitch: 0,
          smoothBank: 0,
          smoothSteer: 0,
          wheelRotRad: 0,
          landingImpact: 0,
          initialized: false,
        };
        remoteKinematicsMap.set(id, kin);
      }

      const fwdX = Math.sin(driverPeer.yaw);
      const fwdZ = Math.cos(driverPeer.yaw);
      const dx = driverPeer.x - kin.prevX;
      const dy = driverPeer.y - kin.prevY;
      const dz = driverPeer.z - kin.prevZ;

      const velFwd = kin.initialized
        ? (dx * fwdX + dz * fwdZ) / dt
        : driverPeer.vx * fwdX + driverPeer.vz * fwdZ;
      const speedHoriz = Math.hypot(driverPeer.vx, driverPeer.vz);
      const effSpeed = Math.max(Math.abs(velFwd), speedHoriz);
      const yawRate = kin.initialized ? wrapAnglePi(driverPeer.yaw - kin.prevYaw) / dt : 0;

      // Ground slope vs ballistic jump pitch
      const halfWb = WORLD_CONSTANTS.SCOOTER_WHEELBASE * 0.5;
      const gFront = sampleGroundHeight(
        driverPeer.x + fwdX * halfWb,
        driverPeer.z + fwdZ * halfWb
      );
      const gRear = sampleGroundHeight(
        driverPeer.x - fwdX * halfWb,
        driverPeer.z - fwdZ * halfWb
      );
      const slopePitch = Math.atan2(gFront - gRear, WORLD_CONSTANTS.SCOOTER_WHEELBASE);
      const airPitch =
        !driverPeer.grounded && effSpeed > 1.5
          ? clamp(Math.atan2(dy / dt, effSpeed), -0.45, 0.52)
          : slopePitch;
      const targetPitch = clamp(driverPeer.grounded ? slopePitch : airPitch, -0.58, 0.58);

      const targetBank = driverPeer.grounded
        ? clamp(-yawRate * (0.12 + Math.min(effSpeed, 16) * 0.02), -0.4, 0.4)
        : 0;
      const targetSteer = clamp(yawRate * 0.3, -0.48, 0.48);

      const blend = 1 - Math.exp(-14 * dt);
      kin.smoothPitch += (targetPitch - kin.smoothPitch) * blend;
      kin.smoothBank += (targetBank - kin.smoothBank) * blend;
      kin.smoothSteer += (targetSteer - kin.smoothSteer) * blend;
      kin.wheelRotRad = (kin.wheelRotRad + (velFwd * dt) / WHEEL_RADIUS) % (Math.PI * 2000);

      if (!kin.prevGrounded && driverPeer.grounded) {
        kin.landingImpact = Math.min(1, Math.max(kin.landingImpact, 0.65));
      } else {
        kin.landingImpact = Math.max(0, kin.landingImpact - dt * 4.2);
      }

      kin.prevX = driverPeer.x;
      kin.prevY = driverPeer.y;
      kin.prevZ = driverPeer.z;
      kin.prevYaw = driverPeer.yaw;
      kin.prevGrounded = driverPeer.grounded;
      kin.initialized = true;

      pose.x = driverPeer.x;
      pose.y = driverPeer.y;
      pose.z = driverPeer.z;
      pose.yaw = driverPeer.yaw;
      pose.pitch = kin.smoothPitch;
      pose.bankRoll = kin.smoothBank;
      pose.steerAngle = kin.smoothSteer;
      pose.wheelRotRad = kin.wheelRotRad;
      pose.frontCompression = 0.04 + kin.landingImpact * 0.1;
      pose.rearCompression = 0.04 + kin.landingImpact * 0.11;
      pose.speedKmh = effSpeed * 3.6;
      pose.forwardSpeed = velFwd;
      pose.grounded = driverPeer.grounded;
      pose.headlightOn = driverPeer.headlightOn ?? sc.headlightOn;
      pose.isBraking = Boolean(driverPeer.isBraking);
      pose.isDrifting = Boolean(driverPeer.isBraking && effSpeed > 4.2 && Math.abs(yawRate) > 0.45);
      pose.parked = false;
      pose.landingImpact = kin.landingImpact;
    } else {
      // Parked / stationary Super Cub resting gently on its left kickstand (-5.4° lean)
      const fwdX = Math.sin(sc.parkedYaw);
      const fwdZ = Math.cos(sc.parkedYaw);
      const halfWb = WORLD_CONSTANTS.SCOOTER_WHEELBASE * 0.5;
      const gCenter = Number.isFinite(sc.parkedY)
        ? sc.parkedY
        : sampleGroundHeight(sc.parkedX, sc.parkedZ);
      const gFront = sampleGroundHeight(sc.parkedX + fwdX * halfWb, sc.parkedZ + fwdZ * halfWb);
      const gRear = sampleGroundHeight(sc.parkedX - fwdX * halfWb, sc.parkedZ - fwdZ * halfWb);
      const slopePitch = clamp(
        Math.atan2(gFront - gRear, WORLD_CONSTANTS.SCOOTER_WHEELBASE),
        -0.45,
        0.45
      );

      const occupiedByPassengerOnly = Boolean(sc.passengerSessionId);
      pose.x = sc.parkedX;
      pose.y = gCenter;
      pose.z = sc.parkedZ;
      pose.yaw = sc.parkedYaw;
      pose.pitch = slopePitch;
      pose.bankRoll = occupiedByPassengerOnly ? -0.04 : -0.095;
      pose.steerAngle = occupiedByPassengerOnly ? 0 : 0.22;
      pose.frontCompression = 0.035;
      pose.rearCompression = occupiedByPassengerOnly ? 0.055 : 0.035;
      pose.speedKmh = 0;
      pose.forwardSpeed = 0;
      pose.grounded = true;
      pose.headlightOn = occupiedByPassengerOnly ? sc.headlightOn : false;
      pose.isBraking = false;
      pose.isDrifting = false;
      pose.parked = true;
      pose.landingImpact = 0;
    }

    const avgExtraComp =
      Math.max(0, pose.frontCompression - 0.04) * 0.5 +
      Math.max(0, pose.rearCompression - 0.04) * 0.5;
    pose.chassisDipY = -avgExtraComp * 0.55 - pose.landingImpact * 0.045;
    pose.chassisY = pose.y + pose.chassisDipY;

    // Right-handed Three.js: local +Z is forward, so uphill nose-up (pitch > 0) is negative X rotation!
    const safePitch = Number.isFinite(pose.pitch) ? clamp(pose.pitch, -0.62, 0.62) : 0;
    const safeYaw = Number.isFinite(pose.yaw) ? pose.yaw : 0;
    const safeBank = Number.isFinite(pose.bankRoll) ? clamp(pose.bankRoll, -0.42, 0.42) : 0;
    _poseEuler.set(-safePitch, safeYaw, safeBank, 'YXZ');
    pose.chassisQuat.setFromEuler(_poseEuler);

    _tmpVec.copy(DRIVER_LOCAL_OFFSET).applyQuaternion(pose.chassisQuat);
    pose.driverAnchorPos.set(
      pose.x + _tmpVec.x,
      pose.chassisY + _tmpVec.y,
      pose.z + _tmpVec.z
    );

    _tmpVec.copy(PILLION_LOCAL_OFFSET).applyQuaternion(pose.chassisQuat);
    pose.pillionAnchorPos.set(
      pose.x + _tmpVec.x,
      pose.chassisY + _tmpVec.y,
      pose.z + _tmpVec.z
    );
  }

  // Prune stale scooter records
  for (const key of livePosesMap.keys()) {
    if (!activeIds.has(key)) {
      livePosesMap.delete(key);
      remoteKinematicsMap.delete(key);
    }
  }

  return livePosesMap;
}

// ============================================================================
// Procedural Vertex-Colored Vintage Honda Super Cub 50 ("49-AA") Mesh Builder
// ============================================================================

function paintPart(geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
  if (nonIndexed !== geo) geo.dispose();
  if (nonIndexed.getAttribute('uv')) {
    nonIndexed.deleteAttribute('uv');
  }
  if (!nonIndexed.getAttribute('normal')) {
    nonIndexed.computeVertexNormals();
  }
  const pos = nonIndexed.getAttribute('position');
  const col = new THREE.Color(hex);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // Subtle vertical ambient gradient so lower underbody feels grounded and top lacquer gleams
    const shade = 0.94 + Math.min(0.1, Math.max(-0.08, pos.getY(i) * 0.08));
    colors[i * 3] = Math.min(1, col.r * shade);
    colors[i * 3 + 1] = Math.min(1, col.g * shade);
    colors[i * 3 + 2] = Math.min(1, col.b * shade);
  }
  nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return nonIndexed;
}

interface PaintGeoPair {
  chassisGeo: THREE.BufferGeometry;
  forkGeo: THREE.BufferGeometry;
}

const paintGeoCache = new Map<ScooterPaintId, PaintGeoPair>();
let sharedWheelGeo: THREE.BufferGeometry | null = null;
let sharedKickstandGeo: THREE.BufferGeometry | null = null;
let sharedScooterBodyMat: THREE.MeshStandardMaterial | null = null;
const plateTextureCache = new Map<string, THREE.CanvasTexture>();

function getSharedScooterMaterial(): THREE.MeshStandardMaterial {
  if (!sharedScooterBodyMat) {
    sharedScooterBodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.24,
      envMapIntensity: 0.72,
    });
  }
  return sharedScooterBodyMat;
}

function getSharedWheelGeometry(): THREE.BufferGeometry {
  if (sharedWheelGeo) return sharedWheelGeo;
  const parts: THREE.BufferGeometry[] = [];

  // Black rubber tire tread (radius 0.275m, tube 0.052m -> outer ~0.275m)
  const tire = new THREE.TorusGeometry(0.223, 0.052, 10, 24);
  tire.rotateY(Math.PI / 2);
  parts.push(paintPart(tire, '#1F2124'));

  // Classic vintage cream whitewall side rings
  for (const sideX of [-0.043, 0.043]) {
    const ww = new THREE.TorusGeometry(0.195, 0.015, 6, 22);
    ww.rotateY(Math.PI / 2);
    ww.translate(sideX, 0, 0);
    parts.push(paintPart(ww, '#F3ECDC'));
  }

  // Chrome steel rim & drum brake hub
  const rim = new THREE.TorusGeometry(0.172, 0.016, 8, 20);
  rim.rotateY(Math.PI / 2);
  parts.push(paintPart(rim, '#DCE3EA'));

  const hub = new THREE.CylinderGeometry(0.064, 0.064, 0.095, 12);
  hub.rotateZ(Math.PI / 2);
  parts.push(paintPart(hub, '#BCC5CE'));

  // 8 crossed wire spokes so wheel spin is unmistakably visible at 60 km/h!
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI;
    const spoke = new THREE.CylinderGeometry(0.0045, 0.0045, 0.33, 5);
    spoke.rotateX(ang);
    spoke.translate((i % 2 === 0 ? 1 : -1) * 0.012, 0, 0);
    parts.push(paintPart(spoke, '#E4EBF2'));
  }

  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  sharedWheelGeo = merged;
  return merged;
}

function getSharedKickstandGeometry(): THREE.BufferGeometry {
  if (sharedKickstandGeo) return sharedKickstandGeo;
  const parts: THREE.BufferGeometry[] = [];

  const leg = new THREE.CylinderGeometry(0.011, 0.009, 0.29, 6);
  leg.translate(0, -0.14, 0);
  leg.rotateZ(0.38);
  leg.rotateX(-0.18);
  parts.push(paintPart(leg, '#4A5058'));

  const foot = new THREE.BoxGeometry(0.042, 0.012, 0.052);
  foot.translate(0.105, -0.26, -0.048);
  parts.push(paintPart(foot, '#2E3238'));

  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  sharedKickstandGeo = merged;
  return merged;
}

function getPaintGeometries(paintId: ScooterPaintId): PaintGeoPair {
  const cached = paintGeoCache.get(paintId);
  if (cached) return cached;

  const meta =
    SCOOTER_PAINT_CATALOG.find((c) => c.id === paintId) ?? SCOOTER_PAINT_CATALOG[0];
  const bodyHex = meta.hex;
  const trimHex = meta.trimHex;

  // 1. CHASSIS GEOMETRY (Step-through frame, cream leg-shield, 49cc engine, chrome exhaust, tandem seats, rattan flower basket)
  const cParts: THREE.BufferGeometry[] = [];

  // Curved step-through spine tube (from headtube down to floorboard)
  const downTube = new THREE.CylinderGeometry(0.042, 0.048, 0.56, 8);
  downTube.rotateX(0.68);
  downTube.translate(0, 0.52, 0.30);
  cParts.push(paintPart(downTube, bodyHex));

  // Underbone central frame belly
  const belly = new THREE.BoxGeometry(0.15, 0.14, 0.46);
  belly.translate(0, 0.33, 0.02);
  cParts.push(paintPart(belly, bodyHex));

  // Sculpted rear body & fuel-tank shell beneath saddle
  const rearBody = new THREE.BoxGeometry(0.24, 0.25, 0.62);
  rearBody.translate(0, 0.52, -0.32);
  cParts.push(paintPart(rearBody, bodyHex));

  // Vintage cream side battery covers ("Super Cub 50" oval side panels)
  for (const sx of [-0.126, 0.126]) {
    const cover = new THREE.CylinderGeometry(0.095, 0.085, 0.024, 12);
    cover.rotateZ(Math.PI / 2);
    cover.scale(1, 0.82, 1.25);
    cover.translate(sx, 0.49, -0.16);
    cParts.push(paintPart(cover, trimHex));
  }

  // Sweeping rear fender arch over rear wheel (z = -0.60)
  const rearFender = new THREE.TorusGeometry(0.305, 0.068, 8, 16, Math.PI * 0.92);
  rearFender.rotateY(Math.PI / 2);
  rearFender.rotateX(-0.12);
  rearFender.translate(0, 0.285, -0.60);
  cParts.push(paintPart(rearFender, bodyHex));

  // Classic wide cream front leg-shield ("bửng trắng Super Cub")
  for (const sx of [-0.145, 0.145]) {
    const wing = new THREE.BoxGeometry(0.15, 0.52, 0.055);
    wing.rotateX(-0.26);
    wing.rotateY(sx > 0 ? -0.18 : 0.18);
    wing.translate(sx, 0.54, 0.34);
    cParts.push(paintPart(wing, trimHex));

    const lowerFlare = new THREE.BoxGeometry(0.16, 0.16, 0.18);
    lowerFlare.translate(sx, 0.30, 0.24);
    cParts.push(paintPart(lowerFlare, trimHex));
  }
  const shieldBridge = new THREE.BoxGeometry(0.22, 0.26, 0.06);
  shieldBridge.rotateX(-0.28);
  shieldBridge.translate(0, 0.68, 0.41);
  cParts.push(paintPart(shieldBridge, trimHex));

  // Classic Honda front emblem badge
  const frontBadge = new THREE.BoxGeometry(0.09, 0.045, 0.02);
  frontBadge.rotateX(-0.28);
  frontBadge.translate(0, 0.72, 0.445);
  cParts.push(paintPart(frontBadge, '#C89B3C'));

  // Horizontal 49cc air-cooled engine crankcase & finned cylinder head
  const crankcase = new THREE.CylinderGeometry(0.088, 0.088, 0.23, 10);
  crankcase.rotateZ(Math.PI / 2);
  crankcase.translate(0, 0.26, 0.02);
  cParts.push(paintPart(crankcase, '#8C949E'));

  const cylHead = new THREE.BoxGeometry(0.14, 0.11, 0.19);
  cylHead.rotateX(-0.15);
  cylHead.translate(0, 0.27, 0.16);
  cParts.push(paintPart(cylHead, '#A8B1BC'));

  // Enclosed chain case on left side (+X) & dual rear chrome shock absorbers
  const chainCase = new THREE.BoxGeometry(0.036, 0.105, 0.58);
  chainCase.translate(0.115, 0.275, -0.31);
  cParts.push(paintPart(chainCase, '#7A828A'));

  for (const sx of [-0.125, 0.125]) {
    const shock = new THREE.CylinderGeometry(0.022, 0.02, 0.31, 8);
    shock.rotateX(0.16);
    shock.translate(sx, 0.43, -0.55);
    cParts.push(paintPart(shock, '#DCE4EC'));
  }

  // Polished chrome exhaust header + full-length cigar muffler on right side (-X)
  const headerPipe = new THREE.CylinderGeometry(0.018, 0.02, 0.34, 8);
  headerPipe.rotateX(Math.PI * 0.46);
  headerPipe.rotateZ(-0.22);
  headerPipe.translate(-0.11, 0.21, 0.09);
  cParts.push(paintPart(headerPipe, '#D8E0E8'));

  const muffler = new THREE.CylinderGeometry(0.038, 0.026, 0.68, 10);
  muffler.rotateX(Math.PI * 0.485);
  muffler.translate(-0.165, 0.235, -0.38);
  cParts.push(paintPart(muffler, '#E6EEF5'));

  // Front rider rubber footpegs & rear passenger folding pegs
  for (const sx of [-0.20, 0.20]) {
    const fPeg = new THREE.CylinderGeometry(0.016, 0.016, 0.11, 6);
    fPeg.rotateZ(Math.PI / 2);
    fPeg.translate(sx, 0.235, 0.12);
    cParts.push(paintPart(fPeg, '#23262A'));
  }
  for (const sx of [-0.21, 0.21]) {
    const rPeg = new THREE.CylinderGeometry(0.015, 0.015, 0.10, 6);
    rPeg.rotateZ(Math.PI / 2);
    rPeg.translate(sx, 0.265, -0.30);
    cParts.push(paintPart(rPeg, '#2A2E33'));
  }

  // Front solo saddle (warm cognac vintage leather with cream piping)
  const frontBase = new THREE.BoxGeometry(0.25, 0.035, 0.32);
  frontBase.translate(0, 0.655, -0.05);
  cParts.push(paintPart(frontBase, trimHex));

  const frontCushion = new THREE.BoxGeometry(0.24, 0.068, 0.30);
  frontCushion.translate(0, 0.695, -0.05);
  cParts.push(paintPart(frontCushion, '#7B4629'));

  // Rear pillion passenger seat ("yên sau chở người thương") + chrome grab bar
  const rearRack = new THREE.BoxGeometry(0.24, 0.024, 0.36);
  rearRack.translate(0, 0.665, -0.47);
  cParts.push(paintPart(rearRack, '#CFD8E0'));

  const pillionPad = new THREE.BoxGeometry(0.235, 0.068, 0.31);
  pillionPad.translate(0, 0.71, -0.46);
  cParts.push(paintPart(pillionPad, '#5B3420'));

  const pillionStripe = new THREE.BoxGeometry(0.24, 0.07, 0.07);
  pillionStripe.translate(0, 0.711, -0.46);
  cParts.push(paintPart(pillionStripe, '#9E5B36'));

  const grabRail = new THREE.TorusGeometry(0.125, 0.012, 6, 14, Math.PI);
  grabRail.rotateX(Math.PI * 0.42);
  grabRail.translate(0, 0.735, -0.60);
  cParts.push(paintPart(grabRail, '#E2EAF2'));

  // Cozy Đà Lạt woven rattan rear flower basket with Hydrangea & Dã Quỳ blooms
  const basket = new THREE.BoxGeometry(0.25, 0.15, 0.19);
  basket.translate(0, 0.755, -0.74);
  cParts.push(paintPart(basket, '#B68652'));

  const basketRim = new THREE.BoxGeometry(0.27, 0.026, 0.21);
  basketRim.translate(0, 0.83, -0.74);
  cParts.push(paintPart(basketRim, '#8F6337'));

  const foliage = new THREE.DodecahedronGeometry(0.085, 0);
  foliage.scale(1.25, 0.65, 0.95);
  foliage.translate(0, 0.85, -0.74);
  cParts.push(paintPart(foliage, '#466E49'));

  for (const [bx, by, bz, bcol] of [
    [-0.06, 0.88, -0.72, '#9E8BE8'],
    [0.05, 0.89, -0.75, '#86A8F0'],
    [0.0, 0.90, -0.70, '#EAB338'],
    [-0.04, 0.87, -0.78, '#F2C14E'],
  ] as const) {
    const bloom = new THREE.DodecahedronGeometry(0.042, 0);
    bloom.translate(bx, by, bz);
    cParts.push(paintPart(bloom, bcol));
  }

  // Rear license plate backing bracket & amber turn winkers
  const plateBack = new THREE.BoxGeometry(0.175, 0.115, 0.014);
  plateBack.rotateX(0.24);
  plateBack.translate(0, 0.43, -0.885);
  cParts.push(paintPart(plateBack, '#24282E'));

  for (const sx of [-0.14, 0.14]) {
    const rearWinker = new THREE.SphereGeometry(0.024, 8, 6);
    rearWinker.translate(sx, 0.54, -0.82);
    cParts.push(paintPart(rearWinker, '#F29B2E'));
  }

  const chassisGeo = mergeGeometries(cParts, false)!;
  for (const p of cParts) p.dispose();

  // 2. STEERING FORK & HANDLEBAR GEOMETRY (local origin at z = STEER_PIVOT_Z = +0.54, y = 0)
  const fParts: THREE.BufferGeometry[] = [];

  // Pressed-steel front fork legs
  for (const sx of [-0.072, 0.072]) {
    const forkLeg = new THREE.CylinderGeometry(0.022, 0.017, 0.62, 8);
    forkLeg.rotateX(-0.22);
    forkLeg.translate(sx, 0.55, -0.01);
    fParts.push(paintPart(forkLeg, bodyHex));
  }

  // Curved front fender over front wheel (hub at z = +0.06 relative to pivot)
  const frontFender = new THREE.TorusGeometry(0.295, 0.064, 8, 15, Math.PI * 0.78);
  frontFender.rotateY(Math.PI / 2);
  frontFender.rotateX(0.32);
  frontFender.translate(0, 0.28, 0.06);
  fParts.push(paintPart(frontFender, bodyHex));

  // Gull-wing Super Cub handlebar shroud
  const barCenter = new THREE.BoxGeometry(0.26, 0.085, 0.13);
  barCenter.translate(0, 0.90, -0.10);
  fParts.push(paintPart(barCenter, bodyHex));

  for (const sx of [-1, 1]) {
    const barArm = new THREE.CylinderGeometry(0.022, 0.018, 0.20, 8);
    barArm.rotateZ(Math.PI / 2 - sx * 0.12);
    barArm.rotateY(sx * 0.16);
    barArm.translate(sx * 0.18, 0.905, -0.12);
    fParts.push(paintPart(barArm, bodyHex));

    // Black ribbed rubber handgrips (driver hand target at x = ±0.27, y = 0.905, z = +0.39)
    const grip = new THREE.CylinderGeometry(0.019, 0.019, 0.115, 8);
    grip.rotateZ(Math.PI / 2);
    grip.rotateY(sx * 0.16);
    grip.translate(sx * 0.285, 0.905, -0.145);
    fParts.push(paintPart(grip, '#1E2024'));

    // Front amber winker pods
    const fWinker = new THREE.SphereGeometry(0.025, 8, 6);
    fWinker.translate(sx * 0.22, 0.88, -0.06);
    fParts.push(paintPart(fWinker, '#F59E2D'));

    // Tall chrome mirror stalks + round vintage mirrors
    const stalk = new THREE.CylinderGeometry(0.005, 0.005, 0.17, 5);
    stalk.rotateZ(-sx * 0.28);
    stalk.translate(sx * 0.23, 0.99, -0.11);
    fParts.push(paintPart(stalk, '#DCE4EC'));

    const mirrorDisk = new THREE.CylinderGeometry(0.044, 0.044, 0.014, 12);
    mirrorDisk.rotateX(Math.PI / 2);
    mirrorDisk.translate(sx * 0.27, 1.07, -0.11);
    fParts.push(paintPart(mirrorDisk, '#E8F0F8'));
  }

  // Round speedometer dial face atop shroud
  const speedo = new THREE.CylinderGeometry(0.048, 0.048, 0.018, 12);
  speedo.rotateX(-0.38);
  speedo.translate(0, 0.948, -0.095);
  fParts.push(paintPart(speedo, '#FAF5E6'));

  // Round chrome headlamp bezel
  const lampShell = new THREE.CylinderGeometry(0.072, 0.062, 0.065, 14);
  lampShell.rotateX(Math.PI / 2);
  lampShell.translate(0, 0.895, -0.015);
  fParts.push(paintPart(lampShell, '#E4ECF4'));

  // Optional front wire parcel rack above front fender
  const frontRack = new THREE.BoxGeometry(0.17, 0.016, 0.15);
  frontRack.rotateX(0.18);
  frontRack.translate(0, 0.63, 0.09);
  fParts.push(paintPart(frontRack, '#CFD8E0'));

  const forkGeo = mergeGeometries(fParts, false)!;
  for (const p of fParts) p.dispose();

  const pair = { chassisGeo, forkGeo };
  paintGeoCache.set(paintId, pair);
  return pair;
}

function getLicensePlateTexture(plateLabel: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const key = plateLabel || '49-AA 1893';
  const cached = plateTextureCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Classic vintage Vietnamese white/ivory metal plate with crisp dark border
    ctx.fillStyle = '#F6F1E3';
    ctx.fillRect(0, 0, 192, 128);
    ctx.strokeStyle = '#1E242B';
    ctx.lineWidth = 7;
    ctx.strokeRect(5, 5, 182, 118);

    const parts = key.trim().split(/\s+/);
    const topLine = parts[0] || '49-AA';
    const botLine = parts[1] || '1968';

    ctx.fillStyle = '#192028';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 38px "Be Vietnam Pro", system-ui, sans-serif';
    ctx.fillText(topLine, 96, 42);
    ctx.font = '800 42px "Be Vietnam Pro", system-ui, sans-serif';
    ctx.fillText(botLine, 96, 89);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  plateTextureCache.set(key, tex);
  return tex;
}

// ============================================================================
// Per-Scooter 3D Articulated Instance Component
// ============================================================================

interface SingleSuperCubProps {
  scooter: ScooterStateSnapshot;
  castBikeShadow: boolean;
}

function SingleSuperCub50({ scooter, castBikeShadow }: SingleSuperCubProps) {
  const rootRef = useRef<THREE.Group>(null);
  const steerRef = useRef<THREE.Group>(null);
  const frontWheelRef = useRef<THREE.Mesh>(null);
  const rearWheelRef = useRef<THREE.Mesh>(null);
  const kickstandRef = useRef<THREE.Mesh>(null);
  const lightConeRef = useRef<THREE.Mesh>(null);
  const hornRingRef = useRef<THREE.Mesh>(null);

  const puffRefs = useRef<Array<THREE.Mesh | null>>([null, null, null]);
  const dustRefs = useRef<Array<THREE.Mesh | null>>([null, null, null, null]);
  const hornAgeRef = useRef<number>(99);
  const lastHornTsRef = useRef<number>(0);

  const { chassisGeo, forkGeo } = useMemo(
    () => getPaintGeometries(scooter.paintId),
    [scooter.paintId]
  );
  const wheelGeo = useMemo(() => getSharedWheelGeometry(), []);
  const kickstandGeo = useMemo(() => getSharedKickstandGeometry(), []);
  const bodyMat = useMemo(() => getSharedScooterMaterial(), []);
  const plateTex = useMemo(
    () => getLicensePlateTexture(scooter.plateLabel),
    [scooter.plateLabel]
  );

  const fxMats = useMemo(() => {
    const headlampMat = new THREE.MeshStandardMaterial({
      color: '#FFF4D4',
      emissive: '#FFD07A',
      emissiveIntensity: 2.2,
      roughness: 0.15,
    });
    const coneGeo = new THREE.ConeGeometry(0.95, 5.6, 16, 1, true);
    coneGeo.rotateX(-Math.PI / 2);
    coneGeo.translate(0, 0, 2.85);
    const coneMat = new THREE.MeshBasicMaterial({
      color: '#FFE0A3',
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const brakeMat = new THREE.MeshStandardMaterial({
      color: '#B81D18',
      emissive: '#FF261B',
      emissiveIntensity: 0.8,
      roughness: 0.28,
    });
    const plateMat = new THREE.MeshStandardMaterial({
      map: plateTex ?? undefined,
      color: '#FFFFFF',
      roughness: 0.52,
      metalness: 0.12,
    });
    const vaporMat = new THREE.MeshBasicMaterial({
      color: '#F2F6FA',
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    const dustMat = new THREE.MeshBasicMaterial({
      color: '#B87452',
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    const hornRingMat = new THREE.MeshBasicMaterial({
      color: '#FFE49E',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const puffGeo = new THREE.DodecahedronGeometry(0.058, 0);
    const ringGeo = new THREE.RingGeometry(0.14, 0.21, 20);
    return {
      headlampMat,
      coneGeo,
      coneMat,
      brakeMat,
      plateMat,
      vaporMat,
      dustMat,
      hornRingMat,
      puffGeo,
      ringGeo,
    };
  }, [plateTex]);

  useEffect(() => {
    return () => {
      fxMats.headlampMat.dispose();
      fxMats.coneGeo.dispose();
      fxMats.coneMat.dispose();
      fxMats.brakeMat.dispose();
      fxMats.plateMat.dispose();
      fxMats.vaporMat.dispose();
      fxMats.dustMat.dispose();
      fxMats.hornRingMat.dispose();
      fxMats.puffGeo.dispose();
      fxMats.ringGeo.dispose();
    };
  }, [fxMats]);

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    const elapsed = performance.now() * 0.001;
    const pose = livePosesMap.get(scooter.scooterId);
    const root = rootRef.current;
    if (!pose || !root) return;

    const st = useGameStore.getState();
    // Hide local scooter only if player is in first-person viewfinder (photoModeActive && countdown === 0) AND driving within 0.6m of lens
    const camDistSq =
      (pose.x - st.localTransient.camX) * (pose.x - st.localTransient.camX) +
      (pose.z - st.localTransient.camZ) * (pose.z - st.localTransient.camZ);
    root.visible = !(st.photoModeActive && st.photoCountdown === 0 && camDistSq < 0.75);

    // Subtle 49cc single-cylinder idle thrum when occupied at rest
    const idleThrum =
      !pose.parked && pose.speedKmh < 3
        ? Math.sin(elapsed * 42) * 0.0022
        : 0;

    root.position.set(pose.x, pose.chassisY + idleThrum, pose.z);
    root.quaternion.copy(pose.chassisQuat);

    // Keep wheels planted on the ground surface even while chassis dips on suspension compression!
    const wheelLocalY = WHEEL_RADIUS - pose.chassisDipY;
    if (steerRef.current) {
      steerRef.current.position.set(0, 0, STEER_PIVOT_Z);
      steerRef.current.rotation.set(0, pose.steerAngle, 0);
    }
    if (frontWheelRef.current) {
      frontWheelRef.current.position.set(0, wheelLocalY, 0.06);
      frontWheelRef.current.rotation.set(pose.wheelRotRad, 0, 0);
    }
    if (rearWheelRef.current) {
      rearWheelRef.current.position.set(0, wheelLocalY, -0.60);
      rearWheelRef.current.rotation.set(pose.wheelRotRad, 0, 0);
    }

    // Kickstand: deployed down when parked, folded back along chainstay when riding
    if (kickstandRef.current) {
      kickstandRef.current.position.set(0.115, 0.255, -0.12);
      const targetRotX = pose.parked ? 0 : -1.32;
      kickstandRef.current.rotation.x +=
        (targetRotX - kickstandRef.current.rotation.x) * (1 - Math.exp(-16 * dt));
    }

    // Headlight & warm 2800K mist cone
    const gh = st.atmosphere.gameHour;
    const isLowLight =
      gh < 6.7 || gh > 16.8 || st.atmosphere.weather === 'deep_evening_fog';
    fxMats.headlampMat.emissiveIntensity = pose.headlightOn ? (isLowLight ? 3.8 : 1.6) : 0.05;

    if (lightConeRef.current) {
      lightConeRef.current.visible = pose.headlightOn;
      fxMats.coneMat.opacity = isLowLight ? 0.135 : 0.045;
    }

    // Rear brake light intensity
    fxMats.brakeMat.emissiveIntensity = pose.isBraking
      ? 4.6
      : pose.headlightOn
        ? 1.05
        : 0.12;

    // Horn pulse check ("Bíp-bíp!")
    const hornEvt = st.lastHornEvent;
    if (
      hornEvt &&
      hornEvt.scooterId === scooter.scooterId &&
      hornEvt.timestamp !== lastHornTsRef.current
    ) {
      lastHornTsRef.current = hornEvt.timestamp;
      hornAgeRef.current = 0;
      const dist = Math.hypot(
        pose.x - st.localTransient.x,
        pose.z - st.localTransient.z
      );
      if (dist < 48) {
        const atten = clamp(1 - dist / 48, 0.08, 1);
        playScooterHorn(atten);
      }
    }

    if (hornRingRef.current) {
      if (hornAgeRef.current < 0.75) {
        hornAgeRef.current += dt;
        const u = clamp(hornAgeRef.current / 0.75, 0, 1);
        hornRingRef.current.visible = true;
        hornRingRef.current.scale.setScalar(0.6 + u * 2.8);
        fxMats.hornRingMat.opacity = Math.sin(u * Math.PI) * 0.75;
      } else {
        hornRingRef.current.visible = false;
      }
    }

    // Exhaust cold-morning vapor wisps (from right-side muffler tip at [-0.165, 0.235, -0.73])
    const emitExhaust = !pose.parked;
    for (let i = 0; i < 3; i++) {
      const m = puffRefs.current[i];
      if (!m) continue;
      if (!emitExhaust) {
        m.visible = false;
        continue;
      }
      const rate = 1.4 + Math.min(2.6, pose.speedKmh * 0.05);
      const u = (((elapsed * rate + i * 0.33) % 1) + 1) % 1;
      m.visible = true;
      m.position.set(
        -0.165 + Math.sin(elapsed * 5 + i) * 0.03 * u,
        0.235 + u * 0.16,
        -0.73 - u * (0.38 + pose.speedKmh * 0.012)
      );
      m.scale.setScalar(0.45 + u * 1.45);
    }

    // Rear-tire red-basalt drift & landing dust puffs
    const emitDust =
      (pose.grounded && (pose.isDrifting || pose.speedKmh > 26)) ||
      pose.landingImpact > 0.15;
    for (let i = 0; i < 4; i++) {
      const dm = dustRefs.current[i];
      if (!dm) continue;
      if (!emitDust) {
        dm.visible = false;
        continue;
      }
      const u = (((elapsed * 2.8 + i * 0.25) % 1) + 1) % 1;
      const spread = pose.isDrifting || pose.landingImpact > 0.2 ? 0.26 : 0.1;
      dm.visible = true;
      dm.position.set(
        ((i % 2 === 0 ? -1 : 1) * spread + Math.sin(elapsed * 7 + i) * 0.08) * u,
        0.08 + u * 0.24 - pose.chassisDipY,
        -0.64 - u * 0.65
      );
      dm.scale.setScalar((0.6 + u * 1.9) * (pose.isDrifting ? 1.35 : 0.85));
    }
  });

  const isLocalScooter = useGameStore((s) => s.localVehicleId === scooter.scooterId);

  return (
    <group ref={rootRef} name={`SuperCub50_${scooter.scooterId}`}>
      {/* Sprung Chassis, Cream Leg-Shield, 49cc Engine, Muffler, Tandem Seats & Rattan Flower Basket */}
      <mesh
        geometry={chassisGeo}
        material={bodyMat}
        castShadow={isLocalScooter || castBikeShadow}
        receiveShadow
      />

      {/* Rear License Plate ("49-AA ...") */}
      <mesh
        position={[0, 0.43, -0.894]}
        rotation={[0.24, Math.PI, 0]}
        material={fxMats.plateMat}
      >
        <planeGeometry args={[0.16, 0.105]} />
      </mesh>

      {/* Rear Brake / Taillight Lens */}
      <mesh position={[0, 0.555, -0.855]} rotation={[0.18, 0, 0]} material={fxMats.brakeMat}>
        <boxGeometry args={[0.082, 0.046, 0.028]} />
      </mesh>

      {/* Rear 17" Spoked Whitewall Wheel */}
      <mesh
        ref={rearWheelRef}
        geometry={wheelGeo}
        material={bodyMat}
        castShadow={isLocalScooter}
      />

      {/* Articulated Left Kickstand */}
      <mesh
        ref={kickstandRef}
        geometry={kickstandGeo}
        material={bodyMat}
      />

      {/* Articulated Steering Fork, Gull-Wing Handlebars, Dual Mirrors, Headlamp & Front Spoked Wheel */}
      <group ref={steerRef}>
        <mesh
          geometry={forkGeo}
          material={bodyMat}
          castShadow={isLocalScooter || castBikeShadow}
          receiveShadow
        />

        {/* Warm 2800K Round Headlamp Lens */}
        <mesh
          position={[0, 0.895, 0.02]}
          rotation={[Math.PI / 2, 0, 0]}
          material={fxMats.headlampMat}
        >
          <cylinderGeometry args={[0.058, 0.058, 0.012, 14]} />
        </mesh>

        {/* Soft Volumetric Fog Cone */}
        <mesh
          ref={lightConeRef}
          position={[0, 0.89, 0.05]}
          rotation={[0.15, 0, 0]}
          geometry={fxMats.coneGeo}
          material={fxMats.coneMat}
        />

        {/* Horn Visual Soundwave Ring ("Bíp-bíp!") */}
        <mesh
          ref={hornRingRef}
          position={[0, 0.92, 0.14]}
          geometry={fxMats.ringGeo}
          material={fxMats.hornRingMat}
          visible={false}
        />

        {/* Front 17" Spoked Whitewall Wheel */}
        <mesh
          ref={frontWheelRef}
          geometry={wheelGeo}
          material={bodyMat}
          castShadow={isLocalScooter}
        />
      </group>

      {/* Cold-Morning Muffler Exhaust Vapor Wisps */}
      {[0, 1, 2].map((idx) => (
        <mesh
          key={`vap-${idx}`}
          ref={(el) => {
            puffRefs.current[idx] = el;
          }}
          geometry={fxMats.puffGeo}
          material={fxMats.vaporMat}
          visible={false}
        />
      ))}

      {/* Red-Basalt Trail Drift & Landing Dust Puffs */}
      {[0, 1, 2, 3].map((idx) => (
        <mesh
          key={`dust-${idx}`}
          ref={(el) => {
            dustRefs.current[idx] = el;
          }}
          geometry={fxMats.puffGeo}
          material={fxMats.dustMat}
          visible={false}
        />
      ))}
    </group>
  );
}

/**
 * Renders all shared landmark station Super Cubs (`STATION_SCOOTERS`) + personal player-summoned
 * Super Cubs in the current Colyseus shard.
 */
export function SuperCub50FleetRenderer() {
  const scootersMap = useGameStore((s) => s.scooters);
  const qualityTier = useGameStore((s) => s.qualityTier);
  const fleetHeadlightRef = useRef<THREE.PointLight>(null);

  const scooterList = useMemo(() => Object.values(scootersMap), [scootersMap]);

  // Keep exactly 1 permanently mounted headlamp PointLight across the entire fleet (0 GLSL shader recompiles!)
  useFrame(() => {
    const light = fleetHeadlightRef.current;
    if (!light) return;
    const st = useGameStore.getState();
    const gh = st.atmosphere.gameHour;
    const isLowLight =
      gh < 6.7 || gh > 16.8 || st.atmosphere.weather === 'deep_evening_fog';
    const activePose = st.localVehicleId ? livePosesMap.get(st.localVehicleId) : undefined;
    if (activePose && activePose.headlightOn && isLowLight && !st.photoModeActive) {
      const fwdYaw = activePose.yaw + activePose.steerAngle * 0.65;
      light.intensity = 2.5;
      light.position.set(
        activePose.x + Math.sin(fwdYaw) * 2.6,
        activePose.chassisY + 0.85,
        activePose.z + Math.cos(fwdYaw) * 2.6
      );
    } else {
      light.intensity = 0;
    }
  });

  return (
    <group name="SuperCub50Fleet">
      <pointLight
        ref={fleetHeadlightRef}
        color="#FFD58A"
        intensity={0}
        distance={15}
        decay={1.7}
        position={[0, -50, 0]}
      />
      {scooterList.map((sc) => (
        <SingleSuperCub50
          key={sc.scooterId}
          scooter={sc}
          castBikeShadow={qualityTier === 'high' && Boolean(sc.driverSessionId)}
        />
      ))}
    </group>
  );
}
