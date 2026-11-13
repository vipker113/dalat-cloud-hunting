import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { computeWorldAtmosphere } from '@dalat/protocol';
import { CloudSeaSystem } from '../environment/CloudSeaSystem';
import { SkyAndLighting } from '../environment/SkyAndLighting';
import { CinematicPostProcessing } from '../environment/CinematicPostProcessing';
import { HighlandAtmosphereParticles } from '../environment/HighlandAtmosphereParticles';
import { useGameStore } from '../store/gameStore';
import { DaLatWorldTerrain } from './DaLatWorldTerrain';
import { HighlandFoliageAndProps } from './HighlandFoliageAndProps';
import { HighlandMeadowGrass } from './HighlandMeadowGrass';
import { HeroLandmarks } from './HeroLandmarks';
import { worldColliderRegistry } from './colliderRegistry';
import { sceneRenderStats } from './sceneRenderStats';

function AdaptiveQualityAndAtmosphereGovernor() {
  const { gl, scene } = useThree();

  const precompiledShadersRef = useRef(false);
  const atmoAccumSecRef = useRef(0);
  const pendingUiDtSecRef = useRef(0);
  const perfFramesRef = useRef(0);
  const lastPerfTimestampMsRef = useRef<number>(
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  );
  const lowFpsStreakRef = useRef(0);
  const highFpsStreakRef = useRef(0);
  const tierCooldownSecRef = useRef(4.0); // Grace warmup after initial shader compile

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);

    // 0. One-time offscreen Metal/ANGLE PSO & shadow pre-warm on Landing once world BVH & hero GLBs mount.
    // On macOS Metal/ANGLE, pipeline state objects (PSOs) compile on the first actual draw call of each
    // material rather than gl.compile(), so rendering 1 wide offscreen 64x64 frame eliminates the ~350ms entry hitch!
    if (
      !precompiledShadersRef.current &&
      !useGameStore.getState().hasEnteredWorld &&
      tierCooldownSecRef.current <= 3.4 &&
      worldColliderRegistry.getCollider() &&
      gl.info.memory.geometries >= 75
    ) {
      precompiledShadersRef.current = true;
      const savedCulled: Array<{ obj: THREE.Object3D; culled: boolean }> = [];
      const prevRt = gl.getRenderTarget();
      const warmDepthTex = new THREE.DepthTexture(64, 64);
      warmDepthTex.type = THREE.UnsignedIntType;
      warmDepthTex.format = THREE.DepthFormat;
      const warmRt = new THREE.WebGLRenderTarget(64, 64, {
        type: THREE.HalfFloatType,
        colorSpace: THREE.LinearSRGBColorSpace,
        depthBuffer: true,
        stencilBuffer: false,
        depthTexture: warmDepthTex,
      });
      const warmCam = new THREE.PerspectiveCamera(135, 1, 0.25, 2600);
      warmCam.layers.enableAll();
      warmCam.position.set(-30.8, 142.0, 32.5);
      warmCam.lookAt(85, 150, -65);
      warmCam.updateMatrixWorld(true);
      try {
        scene.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh && obj.frustumCulled) {
            savedCulled.push({ obj, culled: obj.frustumCulled });
            obj.frustumCulled = false;
          }
        });
        gl.setRenderTarget(warmRt);
        gl.render(scene, warmCam);
      } catch {
        // Ignore non-fatal warmup errors
      } finally {
        for (let i = 0; i < savedCulled.length; i++) {
          savedCulled[i].obj.frustumCulled = savedCulled[i].culled;
        }
        gl.setRenderTarget(prevRt);
        warmDepthTex.dispose();
        warmRt.dispose();
      }
    }

    // 0b. One-time satin-enamel roughness polish on Vintage Super Cub 50 once its mesh mounts
    const cubGroup = scene.getObjectByName('Landmark_VintageCub50');
    const cubRoot = cubGroup?.children[0];
    if (cubRoot && !cubRoot.userData.__cubRoughnessTuned) {
      cubRoot.userData.__cubRoughnessTuned = true;
      cubRoot.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i] as THREE.MeshStandardMaterial;
          if (m && typeof m.roughness === 'number') {
            m.roughness = Math.max(m.roughness, 0.44);
            if (typeof m.metalness === 'number') {
              m.metalness = Math.min(m.metalness, 0.58);
            }
            if (typeof m.envMapIntensity === 'number') {
              m.envMapIntensity = Math.min(m.envMapIntensity, 0.68);
            }
            m.needsUpdate = true;
          }
        }
      });
    }

    // 1. Update 3D atmosphere continuously in-place at 4 Hz, and only notify Zustand/React HUD
    // when UI-visible fields (clock minute, weather, integer temp, warmth second, expired bubble) actually change!
    atmoAccumSecRef.current += dt;
    if (atmoAccumSecRef.current >= 0.25) {
      const stepDt = atmoAccumSecRef.current;
      atmoAccumSecRef.current = 0;
      pendingUiDtSecRef.current += stepDt;

      const st = useGameStore.getState();
      const nowEpoch = Date.now();
      const nextAtmo = computeWorldAtmosphere(
        nowEpoch + st.serverTimeOffsetMs,
        st.overrideGameHour,
        st.overrideWeather
      );

      const prevAtmo = st.atmosphere;
      const prevSunriseStep = Math.round(
        Math.max(0, Math.min(1, (prevAtmo.gameHour - 4.95) / 1.4)) * 25
      );
      const nextSunriseStep = Math.round(
        Math.max(0, Math.min(1, (nextAtmo.gameHour - 4.95) / 1.4)) * 25
      );
      const hasExpiredBubble =
        st.chatBubbles.length > 0 &&
        st.chatBubbles.some((b) => nowEpoch - b.timestamp > 8500);
      const nextWarmth = Math.max(0, st.warmthRemainingSec - pendingUiDtSecRef.current);
      const warmthSecondChanged =
        st.warmthRemainingSec > 0 &&
        Math.ceil(nextWarmth) !== Math.ceil(st.warmthRemainingSec);

      const uiChanged =
        nextAtmo.timeLabel !== prevAtmo.timeLabel ||
        nextAtmo.phaseTitle !== prevAtmo.phaseTitle ||
        nextAtmo.weather !== prevAtmo.weather ||
        !st.discoveredWeathers[nextAtmo.weather] ||
        Math.round(nextAtmo.temperatureC) !== Math.round(prevAtmo.temperatureC) ||
        nextAtmo.isSunriseWindow !== prevAtmo.isSunriseWindow ||
        (nextAtmo.isSunriseWindow && nextSunriseStep !== prevSunriseStep) ||
        hasExpiredBubble ||
        warmthSecondChanged;

      // Mutate live 3D shader atmosphere reference in-place every 0.25s (zero React re-renders)
      Object.assign(st.atmosphere, nextAtmo);

      if (uiChanged) {
        const uiDt = pendingUiDtSecRef.current;
        pendingUiDtSecRef.current = 0;
        st.tickWarmthAndAtmosphere(uiDt);
      }
    }

    // 2. AdaptiveQualityGovernor & 1.0s perfMetrics reporter (reads real 3D scene drawCalls/triangles)
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

      const drawCalls =
        sceneRenderStats.drawCalls > 0 ? sceneRenderStats.drawCalls : gl.info.render.calls;
      const triangles =
        sceneRenderStats.triangles > 0 ? sceneRenderStats.triangles : gl.info.render.triangles;

      const st = useGameStore.getState();
      st.setPerfMetrics({
        fps,
        frameTimeMs,
        drawCalls,
        triangles,
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
      <SkyAndLighting />
      <DaLatWorldTerrain />
      <HighlandMeadowGrass />
      <HighlandFoliageAndProps />
      <HeroLandmarks />
      <HighlandAtmosphereParticles />
      <CloudSeaSystem />
      <CinematicPostProcessing />
    </group>
  );
}
