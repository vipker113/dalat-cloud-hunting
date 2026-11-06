import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CloudSeaSystem } from '../environment/CloudSeaSystem';
import { SkyAndLighting } from '../environment/SkyAndLighting';
import { SoundscapeController } from '../audio/SoundscapeController';
import { useGameStore } from '../store/gameStore';
import { DaLatWorldTerrain } from './DaLatWorldTerrain';
import { HighlandFoliageAndProps } from './HighlandFoliageAndProps';
import { HeroLandmarks } from './HeroLandmarks';

function AdaptiveQualityAndAtmosphereGovernor() {
  const { gl } = useThree();

  const atmoAccumSecRef = useRef(0);
  const perfFramesRef = useRef(0);
  const lastPerfTimestampMsRef = useRef<number>(
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  );
  const lowFpsStreakRef = useRef(0);
  const highFpsStreakRef = useRef(0);
  const tierCooldownSecRef = useRef(4.0); // Grace warmup after initial shader compile

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);

    // 1. Tick atmosphere, warmth buff & chat bubble expiry smoothly (4 Hz to prevent React UI thrash)
    atmoAccumSecRef.current += dt;
    if (atmoAccumSecRef.current >= 0.25) {
      const stepDt = atmoAccumSecRef.current;
      atmoAccumSecRef.current = 0;
      useGameStore.getState().tickWarmthAndAtmosphere(stepDt);
    }

    // 2. AdaptiveQualityGovernor & 1.0s perfMetrics reporter
    perfFramesRef.current += 1;
    if (tierCooldownSecRef.current > 0) {
      tierCooldownSecRef.current = Math.max(0, tierCooldownSecRef.current - dt);
    }

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsedSec = (nowMs - lastPerfTimestampMsRef.current) / 1000;

    if (elapsedSec >= 1.0) {
      const frames = Math.max(1, perfFramesRef.current);
      const fps = Math.round(frames / elapsedSec);
      const frameTimeMs = Math.round(((elapsedSec * 1000) / frames) * 10) / 10;

      perfFramesRef.current = 0;
      lastPerfTimestampMsRef.current = nowMs;

      const st = useGameStore.getState();
      st.setPerfMetrics({
        fps,
        frameTimeMs,
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        textures: gl.info.memory.textures,
        geometries: gl.info.memory.geometries,
      });

      const tabVisible =
        typeof document === 'undefined' || document.visibilityState === 'visible';

      if (st.autoQuality && tabVisible && tierCooldownSecRef.current <= 0) {
        if (fps < 36) {
          lowFpsStreakRef.current += 1;
          highFpsStreakRef.current = 0;

          if (lowFpsStreakRef.current >= 3) {
            lowFpsStreakRef.current = 0;
            tierCooldownSecRef.current = 6.0;
            if (st.qualityTier === 'high') {
              st.setQualityTier('medium', true);
            } else if (st.qualityTier === 'medium') {
              st.setQualityTier('mobile', true);
            }
          }
        } else if (fps >= 57) {
          highFpsStreakRef.current += 1;
          lowFpsStreakRef.current = 0;

          if (highFpsStreakRef.current >= 6) {
            highFpsStreakRef.current = 0;
            tierCooldownSecRef.current = 8.0;
            if (st.qualityTier === 'mobile') {
              st.setQualityTier('medium', true);
            } else if (st.qualityTier === 'medium') {
              st.setQualityTier('high', true);
            }
          }
        } else {
          lowFpsStreakRef.current = 0;
          highFpsStreakRef.current = 0;
        }
      }
    }
  });

  return null;
}

export function DaLatWorldRoot() {
  return (
    <group name="DaLatWorldRoot">
      <AdaptiveQualityAndAtmosphereGovernor />
      <SoundscapeController />
      <SkyAndLighting />
      <DaLatWorldTerrain />
      <HighlandFoliageAndProps />
      <HeroLandmarks />
      <CloudSeaSystem />
    </group>
  );
}
