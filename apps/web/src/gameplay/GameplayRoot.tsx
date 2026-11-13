import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { SocialInteractKind } from '@dalat/protocol';
import type { IMultiplayerController } from '../network/types';
import { useGameStore } from '../store/gameStore';
import { LocalPlayerAvatar } from './HighlandAvatar';
import { InteractableBeacons3D } from './InteractableBeacons3D';
import { PeerCrowdRenderer } from './PeerCrowdRenderer';
import { PhotoCaptureBridge } from './PhotoCaptureBridge';
import { PlayerController } from './PlayerController';
import { NetControllerContext, setNetController } from './netBridge';

export interface GameplayRootProps {
  net?: IMultiplayerController;
}

const SPARKLE_COUNT = 14;
const _dummy = new THREE.Object3D();

/**
 * Lightweight 1-draw-call 3D golden mote & warm steam ring burst when two cloud-hunters
 * greet each other, clink warm soy-milk/phin cups, or cheer at sunrise together.
 */
function SocialSparkleFX() {
  const burst = useGameStore((s) => s.socialSparkleBurst);
  const instRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const activeBurstRef = useRef<{
    nonce: number;
    age: number;
    kind: SocialInteractKind;
    x: number;
    y: number;
    z: number;
  } | null>(null);

  const { moteGeo, moteMat, ringGeo, ringMat, seeds } = useMemo(() => {
    const g = new THREE.OctahedronGeometry(0.052, 0);
    const m = new THREE.MeshBasicMaterial({
      color: '#FFD998',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const rg = new THREE.RingGeometry(0.16, 0.22, 24);
    rg.rotateX(-Math.PI / 2);
    const rm = new THREE.MeshBasicMaterial({
      color: '#FFE6BA',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const s = Array.from({ length: SPARKLE_COUNT }, (_, i) => ({
      angle: (i / SPARKLE_COUNT) * Math.PI * 2 + (i % 3) * 0.21,
      radius: 0.16 + ((i * 37) % 10) * 0.042,
      rise: 0.45 + ((i * 53) % 9) * 0.09,
      spin: (i % 2 === 0 ? 1 : -1) * (2.4 + (i % 4) * 0.8),
      scale: 0.72 + (i % 5) * 0.16,
    }));
    return { moteGeo: g, moteMat: m, ringGeo: rg, ringMat: rm, seeds: s };
  }, []);

  useEffect(() => {
    if (!burst) return;
    activeBurstRef.current = {
      nonce: burst.id,
      age: 0,
      kind: burst.kind,
      x: burst.x,
      y: burst.y,
      z: burst.z,
    };
    if (burst.kind === 'cheers') {
      moteMat.color.set('#FFD27D');
      ringMat.color.set('#FFF0CA');
    } else if (burst.kind === 'gift_flower') {
      moteMat.color.set('#C9A8FF');
      ringMat.color.set('#F4E2FF');
    } else if (burst.kind === 'sparkler') {
      moteMat.color.set('#FFF4B8');
      ringMat.color.set('#FFE89E');
    } else if (burst.kind === 'cheer') {
      moteMat.color.set('#FFB978');
      ringMat.color.set('#FFD9A0');
    } else {
      moteMat.color.set('#FFE6B3');
      ringMat.color.set('#FFF4DC');
    }
  }, [burst, moteMat, ringMat]);

  useFrame((_, rawDt) => {
    const cur = activeBurstRef.current;
    const inst = instRef.current;
    const ring = ringRef.current;
    if (!inst || !ring) return;

    if (!cur) {
      inst.visible = false;
      ring.visible = false;
      return;
    }

    const dur = 1.95;
    cur.age += Math.min(rawDt, 0.06);
    if (cur.age >= dur) {
      activeBurstRef.current = null;
      inst.visible = false;
      ring.visible = false;
      return;
    }

    const u = cur.age / dur;
    const fade = Math.sin(Math.min(1, u * 4.5) * (Math.PI * 0.5)) * Math.pow(1 - u, 1.35);
    inst.visible = true;
    ring.visible = true;
    moteMat.opacity = fade * 0.92;
    ringMat.opacity = Math.pow(1 - u, 2.0) * 0.55;

    ring.position.set(cur.x, cur.y - 1.12, cur.z);
    const ringScale = 0.85 + u * 3.4;
    ring.scale.set(ringScale, 1, ringScale);

    for (let i = 0; i < SPARKLE_COUNT; i++) {
      const sd = seeds[i];
      const spiral = sd.angle + cur.age * 1.35;
      const rad = sd.radius * (0.45 + u * 1.85);
      _dummy.position.set(
        cur.x + Math.cos(spiral) * rad,
        cur.y + cur.age * sd.rise,
        cur.z + Math.sin(spiral) * rad
      );
      _dummy.rotation.set(cur.age * sd.spin, spiral, cur.age * 1.8);
      const sc = sd.scale * (1.0 - u * 0.55);
      _dummy.scale.setScalar(Math.max(0.05, sc));
      _dummy.updateMatrix();
      inst.setMatrixAt(i, _dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        ref={instRef}
        args={[moteGeo, moteMat, SPARKLE_COUNT]}
        visible={false}
        frustumCulled={false}
      />
      <mesh ref={ringRef} geometry={ringGeo} material={ringMat} visible={false} />
    </group>
  );
}

/**
 * Wraps the local player's HighlandAvatar so 35mm viewfinder shots never catch
 * the local player's hair or beret in the bottom-right corner (`photoModeActive && photoCountdown === 0`).
 */
function LocalPlayerRig() {
  const rigRef = useRef<THREE.Group>(null);
  const hideAvatar = useGameStore(
    (s) => s.photoModeActive && s.photoCountdown === 0
  );

  useFrame(() => {
    if (!rigRef.current) return;
    const st = useGameStore.getState();
    rigRef.current.visible =
      !(st.photoModeActive && st.photoCountdown === 0) &&
      !st.localTransient.cameraOccludesSelf;
  });

  return (
    <group ref={rigRef} visible={!hideAvatar}>
      <LocalPlayerAvatar />
    </group>
  );
}

/**
 * Root 3D Gameplay graph mounted inside the R3F <Canvas>.
 * Coordinates third-person BVH capsule locomotion, local HighlandAvatar,
 * 16/32 near peer crowd + distant storm-lantern beacons, social FX, and Polaroid frame capture.
 */
export function GameplayRoot({ net }: GameplayRootProps) {
  useEffect(() => {
    if (net) {
      setNetController(net);
    }
  }, [net]);

  return (
    <NetControllerContext.Provider value={net ?? null}>
      <PlayerController net={net} />
      <LocalPlayerRig />
      <PeerCrowdRenderer />
      <InteractableBeacons3D net={net} />
      <SocialSparkleFX />
      <PhotoCaptureBridge />
    </NetControllerContext.Provider>
  );
}
