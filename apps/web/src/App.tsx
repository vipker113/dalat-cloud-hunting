import { useEffect } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { DaLatWorldRoot } from './world';
import { GameplayRoot, setNetController } from './gameplay';
import { DiegeticUIRoot } from './ui';
import { SoundscapeController } from './audio';
import { multiplayerManager } from './network';
import { useGameStore } from './store/gameStore';
import { bindQARendererAndNet, installDalatQABridge } from './qa/qaBridge';

setNetController(multiplayerManager);

if (import.meta.env.DEV) {
  installDalatQABridge();
}

export function App() {
  const qualityTier = useGameStore((s) => s.qualityTier);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const preferredRoom = (params.get('room') || '').trim().toUpperCase() || undefined;
    multiplayerManager.connect(preferredRoom).catch(() => {
      // Offline / solo exploration fallback handled inside multiplayerManager
    });
    return () => {
      multiplayerManager.disconnect().catch(() => {});
    };
  }, []);

  const maxDpr = qualityTier === 'mobile' ? 1.35 : qualityTier === 'medium' ? 1.5 : 2.0;

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <Canvas
        shadows
        dpr={[1, maxDpr]}
        camera={{ fov: 52, near: 0.25, far: 2600, position: [-45, 138, 42] }}
        gl={{
          antialias: qualityTier !== 'mobile',
          powerPreference: 'high-performance',
          preserveDrawingBuffer: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.08,
        }}
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
          if (import.meta.env.DEV) {
            bindQARendererAndNet(gl, multiplayerManager);
          }
        }}
      >
        <DaLatWorldRoot />
        <GameplayRoot net={multiplayerManager} />
      </Canvas>

      <div
        id="dalat-world-labels"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
          zIndex: 12,
        }}
      />
      <SoundscapeController />
      <DiegeticUIRoot net={multiplayerManager} />
    </div>
  );
}

