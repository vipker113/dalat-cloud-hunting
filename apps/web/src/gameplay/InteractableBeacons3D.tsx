import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { IMultiplayerController } from '../network/types';
import { useGameStore } from '../store/gameStore';
import { INTERACTION_SPOTS } from './interactions';

const SPOT_POSITIONS: ReadonlyArray<[number, number, number]> = [
  INTERACTION_SPOTS.CAFE_PHIN_COUNTER,
  INTERACTION_SPOTS.CAFE_SOY_KETTLE,
  INTERACTION_SPOTS.CAMPFIRE_STAGE,
  INTERACTION_SPOTS.POLAROID_WALL,
  INTERACTION_SPOTS.LONELY_PINE_WISH,
  INTERACTION_SPOTS.CUB_OVERLOOK,
];

const MOTES_PER_SPOT = 4;
const TOTAL_MOTES = SPOT_POSITIONS.length * MOTES_PER_SPOT;

const _dummy = new THREE.Object3D();
const _proj = new THREE.Vector3();

/**
 * Pure Three.js Diegetic 3D World-Space Affordance Beacons (mounted inside R3F <Canvas>):
 * 1) 1-draw-call InstancedMesh warm golden steam/lantern motes rising softly over interactive props within 24m.
 * 2) Projects the active `nearbyPrompt.position` at 60Hz onto `#dalat-world-interact-pill` (rendered safely in react-dom by DiegeticHUD).
 */
export function InteractableBeacons3D(_props: { net?: IMultiplayerController }) {
  const { camera } = useThree();
  const instRef = useRef<THREE.InstancedMesh>(null);

  const { moteGeo, moteMat } = useMemo(() => {
    const g = new THREE.OctahedronGeometry(0.048, 0);
    const m = new THREE.MeshBasicMaterial({
      color: '#FFD79A',
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return { moteGeo: g, moteMat: m };
  }, []);

  useEffect(() => {
    return () => {
      moteGeo.dispose();
      moteMat.dispose();
    };
  }, [moteGeo, moteMat]);

  useFrame(({ clock }) => {
    const st = useGameStore.getState();
    const lt = st.localTransient;
    const inst = instRef.current;

    if (inst) {
      if (st.photoModeActive) {
        inst.visible = false;
      } else {
        inst.visible = true;
        const t = st.reducedMotion ? 0 : clock.getElapsedTime();
        let idx = 0;
        for (let s = 0; s < SPOT_POSITIONS.length; s++) {
          const [sx, sy, sz] = SPOT_POSITIONS[s];
          const dist = Math.hypot(lt.x - sx, lt.z - sz);
          const dy = Math.abs(lt.y - sy);
          const nearFactor =
            st.hasEnteredWorld && dist < 24 && dy < 4.5 ? Math.max(0, 1 - dist / 24) : 0;

          for (let m = 0; m < MOTES_PER_SPOT; m++) {
            if (nearFactor <= 0.02) {
              _dummy.position.set(0, -999, 0);
              _dummy.scale.setScalar(0.001);
            } else {
              const cycle = (((t * 0.42 + m * 0.25 + s * 0.17) % 1) + 1) % 1;
              const angle = t * 0.9 + m * 1.57 + s;
              const radius = 0.18 + Math.sin(cycle * Math.PI) * 0.14;
              _dummy.position.set(
                sx + Math.cos(angle) * radius,
                sy + 0.55 + cycle * 1.05,
                sz + Math.sin(angle) * radius
              );
              const pulse = Math.sin(cycle * Math.PI) * nearFactor;
              _dummy.scale.setScalar(Math.max(0.01, (0.65 + m * 0.12) * pulse));
              _dummy.rotation.set(t * 0.8, angle, 0);
            }
            _dummy.updateMatrix();
            inst.setMatrixAt(idx++, _dummy.matrix);
          }
        }
        inst.instanceMatrix.needsUpdate = true;
      }
    }

    // Project active nearbyPrompt onto #dalat-world-interact-pill (owned by react-dom DiegeticHUD) at 60Hz
    const prompt = st.nearbyPrompt;
    if (!prompt || st.seatedBenchId || st.photoModeActive || st.activeModal !== 'none') {
      return;
    }

    const btn = document.getElementById('dalat-world-interact-pill');
    if (!btn) return;

    const vw = window.innerWidth || 1440;
    const vh = window.innerHeight || 900;

    _proj.set(prompt.position[0], prompt.position[1] + 1.42, prompt.position[2]);
    _proj.project(camera);

    const inFront = _proj.z > 0 && _proj.z < 0.996;
    const rawX = (_proj.x * 0.5 + 0.5) * vw;
    const rawY = (-_proj.y * 0.5 + 0.5) * vh;

    const withinSafeViewport =
      inFront && rawX >= 96 && rawX <= vw - 96 && rawY >= 96 && rawY <= vh - 138;

    if (withinSafeViewport) {
      btn.style.transform = `translate3d(${Math.round(rawX)}px, ${Math.round(rawY)}px, 0) translate(-50%, -100%)`;
    } else {
      // Fallback safely above the bottom dock when player stands with back turned to prop
      btn.style.transform = `translate3d(${Math.round(vw * 0.5)}px, ${Math.round(vh - 86)}px, 0) translate(-50%, -100%)`;
    }
  });

  return (
    <instancedMesh
      ref={instRef}
      args={[moteGeo, moteMat, TOTAL_MOTES]}
      frustumCulled={false}
      visible={false}
    />
  );
}
