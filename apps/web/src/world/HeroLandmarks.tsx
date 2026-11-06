import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { sampleGroundHeight } from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

const TURBINE_PLACEMENTS: ReadonlyArray<{
  pos: [number, number, number];
  yaw: number;
  phase: number;
  castShadow: boolean;
}> = [
  { pos: [185, 48, -145], yaw: 0.22, phase: 0.0, castShadow: true },
  { pos: [235, 46, -65], yaw: 0.14, phase: 1.35, castShadow: true },
  { pos: [215, 44, 28], yaw: -0.08, phase: 2.6, castShadow: false },
  { pos: [295, 48, -185], yaw: 0.28, phase: 3.9, castShadow: false },
  { pos: [310, 42, -15], yaw: 0.05, phase: 5.1, castShadow: false },
];

let sharedLoaderPromise: Promise<GLTFLoader> | null = null;
const glbMasterCache = new Map<string, Promise<THREE.Group | null>>();

function getConfiguredGltfLoader(): Promise<GLTFLoader> {
  if (!sharedLoaderPromise) {
    sharedLoaderPromise = Promise.resolve(MeshoptDecoder.ready)
      .catch(() => {
        // Continue even if WASM SIMD fallback triggers
      })
      .then(() => {
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        return loader;
      });
  }
  return sharedLoaderPromise;
}

async function fetchGlbMaster(url: string): Promise<THREE.Group | null> {
  const existing = glbMasterCache.get(url);
  if (existing) return existing;

  const task = (async () => {
    const loader = await getConfiguredGltfLoader();
    try {
      const gltf = await loader.loadAsync(url);
      gltf.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      return gltf.scene;
    } catch {
      // Allow retry if file is still being written during hot-reload
      glbMasterCache.delete(url);
      return null;
    }
  })();

  glbMasterCache.set(url, task);
  return task;
}

/**
 * Lightweight, crash-proof async GLB + Meshopt hook.
 * Never throws or suspends; retries gently if an asset is mid-export and swaps from architectural fallback seamlessly.
 */
function useSafeGlbClone(url: string, enableShadow = true): THREE.Group | null {
  const [clonedScene, setClonedScene] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const attemptLoad = async () => {
      const master = await fetchGlbMaster(url);
      if (cancelled) return;
      if (master) {
        const clone = master.clone(true);
        clone.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = enableShadow;
            child.receiveShadow = enableShadow;
          }
        });
        setClonedScene(clone);
      } else if (attempts < 6) {
        attempts++;
        retryTimer = setTimeout(attemptLoad, 2500);
      }
    };

    void attemptLoad();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [url, enableShadow]);

  return clonedScene;
}

function CafeMoSuongFallback() {
  return (
    <group name="CafeMoSuongFallback">
      {/* Stilted wooden veranda deck matching [-54..-23, z: 19..41, y: 135.15] */}
      <mesh position={[-0.5, -0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[31, 0.5, 22]} />
        <meshStandardMaterial color="#7C5134" roughness={0.85} />
      </mesh>
      {/* Cozy Da Lat A-frame / timber cabin body */}
      <mesh position={[-7.5, 2.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[11, 4.2, 13]} />
        <meshStandardMaterial color="#8C5B3C" roughness={0.82} />
      </mesh>
      {/* Warm pitched roof */}
      <mesh position={[-7.5, 5.2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[10.8, 2.8, 4]} />
        <meshStandardMaterial color="#4A3228" roughness={0.88} />
      </mesh>
      {/* Warm glowing cafe window */}
      <mesh position={[-1.95, 2.2, 0]}>
        <planeGeometry args={[0.1, 5.2]} />
        <meshStandardMaterial color="#FFE5B4" emissive="#FF9E44" emissiveIntensity={2.1} />
      </mesh>
    </group>
  );
}

function CauGoBridgeFallback() {
  return (
    <group name="CauGoBridgeFallback">
      {/* Inclined plank bridge from x=52 to x=91 */}
      <mesh position={[19.5, 0.9, 0]} rotation={[0, 0, 0.052]} castShadow receiveShadow>
        <boxGeometry args={[39, 0.32, 5.2]} />
        <meshStandardMaterial color="#8B5E3C" roughness={0.86} />
      </mesh>
      {/* Circular sunrise viewing deck at x=91 (+39 relative to 52) */}
      <mesh position={[39, 1.92, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[7.2, 7.2, 0.36, 28]} />
        <meshStandardMaterial color="#966642" roughness={0.84} />
      </mesh>
    </group>
  );
}

function WindTurbineFallback() {
  return (
    <group name="WindTurbineFallback">
      <mesh position={[0, 34, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.35, 2.45, 68, 14]} />
        <meshStandardMaterial color="#F0F4F8" roughness={0.38} metalness={0.18} />
      </mesh>
      <mesh position={[-1.2, 68.2, 0]} castShadow>
        <boxGeometry args={[6.4, 2.8, 2.8]} />
        <meshStandardMaterial color="#F4F7FA" roughness={0.35} metalness={0.2} />
      </mesh>
      <group name="RotorHub" position={[-4.5, 68.2, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[1.25, 2.6, 12]} />
          <meshStandardMaterial color="#FFFFFF" roughness={0.35} />
        </mesh>
        {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((ang, idx) => (
          <group key={idx} rotation={[ang, 0, 0]}>
            <mesh position={[0, 16.5, 0]} castShadow>
              <boxGeometry args={[0.35, 32, 1.45]} />
              <meshStandardMaterial color="#F7FAFC" roughness={0.34} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

function LonelyPineFallback() {
  return (
    <group name="LonelyPineFallback">
      <mesh position={[0, 4.2, 0]} rotation={[0.08, 0, -0.14]} castShadow receiveShadow>
        <cylinderGeometry args={[0.32, 0.58, 8.8, 9]} />
        <meshStandardMaterial color="#6B4230" roughness={0.9} />
      </mesh>
      <mesh position={[1.1, 8.6, -0.2]} scale={[1.45, 0.68, 1.35]} castShadow receiveShadow>
        <icosahedronGeometry args={[3.4, 1]} />
        <meshStandardMaterial color="#3A6644" roughness={0.82} />
      </mesh>
      <mesh position={[-0.9, 7.3, 0.5]} scale={[1.25, 0.62, 1.2]} castShadow receiveShadow>
        <icosahedronGeometry args={[2.5, 1]} />
        <meshStandardMaterial color="#46754E" roughness={0.82} />
      </mesh>
    </group>
  );
}

function VintageCubFallback() {
  return (
    <group name="VintageCubFallback">
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[1.45, 0.42, 0.34]} />
        <meshStandardMaterial color="#5E8C76" roughness={0.38} metalness={0.22} />
      </mesh>
      <mesh position={[0.42, 0.88, 0]} rotation={[0, 0, -0.22]} castShadow>
        <boxGeometry args={[0.18, 0.62, 0.52]} />
        <meshStandardMaterial color="#F2EAD8" roughness={0.42} />
      </mesh>
      {[-0.55, 0.55].map((wx, idx) => (
        <mesh key={idx} position={[wx, 0.32, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.26, 0.065, 8, 16]} />
          <meshStandardMaterial color="#242424" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function CampfireStageFallback() {
  return (
    <group name="CampfireStageFallback">
      {/* Stone fire ring */}
      <mesh position={[0, 0.14, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <torusGeometry args={[0.95, 0.22, 8, 14]} />
        <meshStandardMaterial color="#5C5552" roughness={0.92} />
      </mesh>
      {/* Crossed pine logs */}
      {[0, 1.05, 2.1].map((ry, idx) => (
        <mesh key={idx} position={[0, 0.24, 0]} rotation={[0.22, ry, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.11, 1.25, 6]} />
          <meshStandardMaterial color="#4A2E1E" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

interface SingleWindTurbineProps {
  position: [number, number, number];
  yaw: number;
  phase: number;
  castShadow: boolean;
  beaconMaterial: THREE.MeshStandardMaterial;
}

function SingleWindTurbine({ position, yaw, phase, castShadow, beaconMaterial }: SingleWindTurbineProps) {
  const glbScene = useSafeGlbClone('/assets/models/wind_turbine_ge137.glb', castShadow);
  const rootRef = useRef<THREE.Group>(null);
  const rotorRef = useRef<THREE.Object3D | null>(null);

  // Locate RotorHub child whenever GLB or fallback mounts
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let found: THREE.Object3D | null = null;
    root.traverse((obj) => {
      if (obj.name === 'RotorHub' || obj.name.toLowerCase().includes('rotorhub')) {
        found = obj;
      }
    });
    rotorRef.current = found;
  }, [glbScene]);

  useFrame((_, dt) => {
    const rotor = rotorRef.current;
    if (rotor) {
      const wind = useGameStore.getState().atmosphere.windStrength;
      const angularSpeed = 0.55 + wind * 0.92;
      rotor.rotation.x = (rotor.rotation.x + angularSpeed * dt) % (Math.PI * 2);
    }
  });

  return (
    <group ref={rootRef} position={position} rotation={[0, yaw, 0]} scale={2.48} name={`WindTurbine_${phase.toFixed(1)}`}>
      {glbScene ? <primitive object={glbScene} rotation={[0, phase * 0.02, 0]} /> : <WindTurbineFallback />}

      {/* Red ICAO aviation obstruction night beacon atop nacelle (y = 70.1m) */}
      <mesh position={[-0.6, 70.1, 0]} material={beaconMaterial}>
        <sphereGeometry args={[0.48, 6, 6]} />
      </mesh>
    </group>
  );
}

export function HeroLandmarks() {
  const cafeScene = useSafeGlbClone('/assets/models/cafe_mo_suong.glb');
  const cauGoScene = useSafeGlbClone('/assets/models/cau_go_bridge.glb');
  const lonelyPineScene = useSafeGlbClone('/assets/models/lonely_pine_hero.glb');
  const cub50Scene = useSafeGlbClone('/assets/models/vintage_cub50.glb');
  const campfireScene = useSafeGlbClone('/assets/models/campfire_stage.glb');

  const campfireLightRef = useRef<THREE.PointLight>(null);
  const cafeWarmLightRef = useRef<THREE.PointLight>(null);
  const flameCoreRef = useRef<THREE.Mesh>(null);

  const lonelyPineY = useMemo(() => sampleGroundHeight(-95, -155), []);
  const cub50Y = useMemo(() => sampleGroundHeight(19.8, 125.2), []);

  // Merge veranda sub-platform + all 24 timber stilts into ONE single GPU draw call!
  const mergedSubstructureGeo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];

    const verandaSlab = new THREE.BoxGeometry(28.3, 0.18, 21.8);
    verandaSlab.translate(-37.25, 135.06, 30);
    parts.push(verandaSlab);

    const xs = [-50.5, -42.0, -33.0, -24.0];
    const zs = [20.5, 30.0, 39.5];
    for (const x of xs) {
      for (const z of zs) {
        const groundY = sampleGroundHeight(x, z);
        const topY = 135.06;
        const height = Math.max(0.8, topY - groundY + 0.5);
        const cyl = new THREE.CylinderGeometry(0.14, 0.16, height, 6);
        cyl.translate(x, topY - height * 0.5, z);
        parts.push(cyl);
      }
    }

    const bridgeXs = [58, 66, 74, 82, 91, 96];
    for (const x of bridgeXs) {
      const zOffsets = x >= 88 ? [-4.6, 4.6] : [-2.1, 2.1];
      for (const dz of zOffsets) {
        const z = -75 + dz;
        const groundY = sampleGroundHeight(x, z);
        const t = clamp((x - 50) / 41, 0, 1);
        const deckY = 196.02 + t * 2.1;
        const height = Math.max(1.2, deckY - groundY + 0.6);
        const cyl = new THREE.CylinderGeometry(0.13, 0.16, height, 6);
        cyl.translate(x, deckY - height * 0.5, z);
        parts.push(cyl);
      }
    }

    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return merged;
  }, []);

  // Shared materials for ICAO beacon, campfire embers & timber under-structure
  const { beaconMaterial, flameMaterial, stiltTimberMaterial } = useMemo(() => {
    const beacon = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#FF2A1A'),
      emissive: new THREE.Color('#FF1E10'),
      emissiveIntensity: 3.5,
      roughness: 0.2,
    });
    const flame = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#FF9B3D'),
      transparent: true,
      opacity: 0.9,
    });
    const stilt = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#5C3C28'),
      roughness: 0.9,
      metalness: 0.03,
    });
    return { beaconMaterial: beacon, flameMaterial: flame, stiltTimberMaterial: stilt };
  }, []);

  useEffect(() => {
    return () => {
      mergedSubstructureGeo.dispose();
      beaconMaterial.dispose();
      flameMaterial.dispose();
      stiltTimberMaterial.dispose();
    };
  }, [mergedSubstructureGeo, beaconMaterial, flameMaterial, stiltTimberMaterial]);

  // Animate campfire flickering PointLight (#FF8C42), flame dance & ICAO aviation night beacon
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const gh = useGameStore.getState().atmosphere.gameHour;

    // Blinking ICAO red beacon (double-pulse aviation rhythm, brighter in pre-dawn & dusk)
    const cycle = (t * 0.72) % 1.0;
    const pulse =
      (cycle < 0.14 || (cycle > 0.24 && cycle < 0.36)) ? 1.0 : 0.08;
    const nightBoost = gh < 6.0 || gh > 17.2 ? 4.8 : 1.1;
    beaconMaterial.emissiveIntensity = pulse * nightBoost;

    // Cozy flickering campfire PointLight (#FF8C42)
    const flicker =
      1.0 +
      Math.sin(t * 7.3) * 0.14 +
      Math.sin(t * 13.7 + 1.4) * 0.09 +
      Math.cos(t * 21.1) * 0.05;

    if (campfireLightRef.current) {
      const duskWarmth = gh < 6.5 || gh > 16.5 ? 3.2 : 1.8;
      campfireLightRef.current.intensity = duskWarmth * flicker;
    }

    if (flameCoreRef.current) {
      const s = 0.88 + 0.18 * Math.sin(t * 9.5);
      flameCoreRef.current.scale.set(s, 0.85 + 0.26 * flicker, s);
      flameCoreRef.current.rotation.y = t * 1.8;
    }

    if (cafeWarmLightRef.current) {
      cafeWarmLightRef.current.intensity = gh < 6.3 || gh > 16.8 ? 2.6 : 0.85;
    }
  });

  return (
    <group name="DaLatHeroLandmarks">
      {/* 1. Tiệm Cà Phê Gỗ "Mơ Sương" at [-38, 135.15, 30] */}
      <group position={[-38, 135.15, 30]} name="Landmark_CafeMoSuong">
        {cafeScene ? <primitive object={cafeScene} /> : <CafeMoSuongFallback />}
        <pointLight
          ref={cafeWarmLightRef}
          position={[2.5, 2.8, 0]}
          color="#FFB668"
          intensity={2.4}
          distance={26}
          decay={1.8}
        />
      </group>

      {/* Single merged timber substructure mesh (veranda slab + 24 support stilts = 1 draw call!) */}
      <mesh
        name="MergedTimberSubstructure"
        geometry={mergedSubstructureGeo}
        material={stiltTimberMaterial}
        receiveShadow
      />

      {/* 2. Cầu Gỗ Săn Mây at [52, 196.15, -75] */}
      <group position={[52, 196.15, -75]} name="Landmark_CauGoSanMay">
        {cauGoScene ? <primitive object={cauGoScene} /> : <CauGoBridgeFallback />}
      </group>

      {/* 3. Five Cầu Đất GE-137 Wind Turbines rising smoothly through the eastern sea of clouds */}
      {TURBINE_PLACEMENTS.map((tb, idx) => (
        <SingleWindTurbine
          key={idx}
          position={tb.pos}
          yaw={tb.yaw}
          phase={tb.phase}
          castShadow={tb.castShadow}
          beaconMaterial={beaconMaterial}
        />
      ))}

      {/* 4. Cây Thông Cô Đơn Thiên Phúc Đức at [-95, sampleGroundHeight(-95, -155), -155] */}
      <group position={[-95, lonelyPineY, -155]} name="Landmark_LonelyPine">
        {lonelyPineScene ? <primitive object={lonelyPineScene} /> : <LonelyPineFallback />}
      </group>

      {/* 5. Vintage Honda Super Cub 50 parked at Đài Ngắm Thung Lũng Đèn [19.8, cub50Y, 125.2] */}
      <group
        position={[19.8, cub50Y, 125.2]}
        rotation={[0, -0.68, 0]}
        name="Landmark_VintageCub50"
      >
        {cub50Scene ? <primitive object={cub50Scene} /> : <VintageCubFallback />}
      </group>

      {/* 6. Acoustic Campfire Stage at [-53, 135.15, 24] with flickering #FF8C42 PointLight */}
      <group position={[-53, 135.15, 24]} name="Landmark_CampfireStage">
        {campfireScene ? <primitive object={campfireScene} /> : <CampfireStageFallback />}
        <mesh ref={flameCoreRef} position={[0, 0.42, 0]} material={flameMaterial}>
          <coneGeometry args={[0.28, 0.68, 7]} />
        </mesh>
        <pointLight
          ref={campfireLightRef}
          position={[0, 1.15, 0]}
          color="#FF8C42"
          intensity={2.8}
          distance={24}
          decay={1.7}
        />
      </group>
    </group>
  );
}
