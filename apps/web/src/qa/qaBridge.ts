import * as THREE from 'three';
import {
  DISTANCE_CHECK_STEP,
} from './qaConstants';
import {
  gameYToASL,
  getSurfaceType,
  LANDMARKS,
  LandmarkId,
  sampleWalkableHeight,
  SHARED_BENCHES,
  TRAIL_SEGMENTS,
  WeatherStateId,
} from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';
import { worldColliderRegistry } from '../world/colliderRegistry';
import type { IMultiplayerController } from '../network/types';

export interface DalatQAHook {
  inspectScene: () => Record<string, unknown>;
  getPlayerState: () => Record<string, unknown>;
  teleportPlayer: (opts: { landmarkId?: LandmarkId; position?: [number, number, number]; lookAt?: [number, number, number] }) => Record<string, unknown>;
  inspectCollision: (opts?: { sampleStep?: number }) => Record<string, unknown>;
  triggerInteraction: (action: string, payload?: Record<string, unknown>) => Record<string, unknown>;
  setWorldAtmosphere: (gameHour: number | null, weather: WeatherStateId | null) => Record<string, unknown>;
  measureFps: (durationMs?: number) => Promise<Record<string, unknown>>;
}

declare global {
  interface Window {
    __DALAT_QA__?: DalatQAHook;
  }
}

let boundRenderer: THREE.WebGLRenderer | null = null;
let boundNet: IMultiplayerController | null = null;

export function bindQARendererAndNet(renderer: THREE.WebGLRenderer | null, net: IMultiplayerController | null) {
  boundRenderer = renderer;
  boundNet = net;
}

export function installDalatQABridge() {
  if (typeof window === 'undefined') return;

  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3(0, -1, 0);
  const ray = new THREE.Ray(rayOrigin, rayDir);

  window.__DALAT_QA__ = {
    inspectScene: () => {
      const st = useGameStore.getState();
      const info = boundRenderer?.info;
      const textures = info?.memory?.textures ?? st.perfMetrics.textures;
      const geometries = info?.memory?.geometries ?? st.perfMetrics.geometries;
      const drawCalls = info?.render?.calls ?? st.perfMetrics.drawCalls;
      const triangles = info?.render?.triangles ?? st.perfMetrics.triangles;
      // Conservative VRAM estimate based on buffers + KTX2/DataTextures
      const estimatedVramMB = Math.round((geometries * 0.18 + textures * 0.65 + 14.5) * 10) / 10;

      return {
        connected: st.connected,
        roomCode: st.roomCode,
        channelName: st.channelName,
        rttMs: st.rttMs,
        peerCount: Object.keys(st.peers).length,
        farBeaconCount: st.farBeacons.length,
        qualityTier: st.qualityTier,
        drawCalls,
        triangles,
        geometries,
        textures,
        estimatedVramMB,
        gameTime: st.atmosphere.timeLabel,
        weather: st.atmosphere.weather,
      };
    },

    getPlayerState: () => {
      const st = useGameStore.getState();
      const lt = st.localTransient;
      return {
        x: Math.round(lt.x * 100) / 100,
        y: Math.round(lt.y * 100) / 100,
        z: Math.round(lt.z * 100) / 100,
        yaw: Math.round(lt.yaw * 1000) / 1000,
        cameraYaw: Math.round(lt.cameraYaw * 1000) / 1000,
        cameraPitch: Math.round(lt.cameraPitch * 1000) / 1000,
        photoModeActive: st.photoModeActive,
        altitudeASL: gameYToASL(lt.y),
        surfaceType: getSurfaceType(lt.x, lt.z),
        moving: lt.moving,
        running: lt.running,
        grounded: lt.grounded,
        warmthRemainingSec: Math.round(st.warmthRemainingSec),
        heldItem: st.heldItem,
        activeEmote: st.activeEmote,
        seatedBenchId: st.seatedBenchId,
        nearbyPeer: st.nearbyPeer,
        previewYaw: Math.round(lt.previewCurrentYaw * 1000) / 1000,
        previewPanY: Math.round(lt.previewCurrentPanY * 1000) / 1000,
        previewZoom: Math.round(lt.previewCurrentZoom * 1000) / 1000,
        peersList: Object.values(st.peers).map((p) => ({
          sessionId: p.sessionId,
          displayName: p.displayName,
          x: Math.round(p.x * 10) / 10,
          y: Math.round(p.y * 10) / 10,
          z: Math.round(p.z * 10) / 10,
          emote: p.emote,
          heldItem: p.heldItem,
        })),
        discoveredLandmarks: st.discoveredLandmarks,
      };
    },

    teleportPlayer: ({ landmarkId, position, lookAt }) => {
      const st = useGameStore.getState();
      if (landmarkId && LANDMARKS[landmarkId]) {
        st.teleportToLandmark(landmarkId);
      } else if (position) {
        st.teleportTo(position, lookAt);
      }
      if (!st.hasEnteredWorld) {
        st.enterWorld();
      }
      const lt = useGameStore.getState().localTransient;
      boundNet?.sendMove({
        seq: Math.floor(performance.now() / 83) & 0xffff,
        x: lt.x,
        y: lt.y,
        z: lt.z,
        yaw: lt.yaw,
        vx: 0,
        vz: 0,
        moving: false,
        running: false,
        grounded: true,
        warmBuff: useGameStore.getState().warmthRemainingSec > 0,
      });
      return window.__DALAT_QA__!.getPlayerState();
    },

    inspectCollision: (opts) => {
      const col = worldColliderRegistry.getCollider();
      const step = opts?.sampleStep ?? DISTANCE_CHECK_STEP;
      let checkedPoints = 0;
      let holesCount = 0;
      let maxMismatchM = 0;

      // 1. Check all 5 landmarks
      for (const lm of Object.values(LANDMARKS)) {
        checkedPoints++;
        const [lx, expectedY, lz] = lm.position;
        if (col?.bvh) {
          rayOrigin.set(lx, 320, lz);
          const hit = col.bvh.raycastFirst(ray, THREE.DoubleSide);
          if (!hit) {
            holesCount++;
          } else {
            const diff = Math.abs(hit.point.y - expectedY);
            if (diff > maxMismatchM) maxMismatchM = diff;
          }
        }
      }

      // 2. Check all trail segments & Cầu Gỗ wooden bridge walkability
      let steepestTrailDeg = 0;
      for (const [ax, az, bx, bz] of TRAIL_SEGMENTS) {
        const len = Math.hypot(bx - ax, bz - az);
        const samples = Math.max(4, Math.ceil(len / step));
        let prevY = sampleWalkableHeight(ax, az);
        for (let i = 1; i <= samples; i++) {
          const t = i / samples;
          const sx = ax + (bx - ax) * t;
          const sz = az + (bz - az) * t;
          const sy = sampleWalkableHeight(sx, sz);
          const segDist = len / samples;
          const slopeDeg = (Math.atan2(Math.abs(sy - prevY), segDist) * 180) / Math.PI;
          if (slopeDeg > steepestTrailDeg) steepestTrailDeg = slopeDeg;
          prevY = sy;

          if (col?.bvh) {
            checkedPoints++;
            rayOrigin.set(sx, 320, sz);
            const hit = col.bvh.raycastFirst(ray, THREE.DoubleSide);
            if (!hit) holesCount++;
          }
        }
      }

      return {
        bvhReady: Boolean(col?.bvh),
        checkedPoints,
        holesCount,
        maxLandmarkMismatchM: Math.round(maxMismatchM * 1000) / 1000,
        steepestTrailDeg: Math.round(steepestTrailDeg * 10) / 10,
        pass: Boolean(col?.bvh) && holesCount === 0 && steepestTrailDeg < 32,
      };
    },

    triggerInteraction: (action, payload = {}) => {
      const st = useGameStore.getState();
      switch (action) {
        case 'enter_world':
          st.enterWorld();
          break;
        case 'brew_coffee':
          st.setHeldItem('phin_coffee');
          st.grantWarmthBuff(480);
          boundNet?.sendHeldItem('phin_coffee');
          break;
        case 'pour_soy_milk':
          st.setHeldItem('soy_milk');
          st.grantWarmthBuff(480);
          boundNet?.sendHeldItem('soy_milk');
          break;
        case 'sit_bench': {
          const benchId = (payload.benchId as string) || SHARED_BENCHES[0].id;
          const bench = SHARED_BENCHES.find((b) => b.id === benchId);
          if (bench) {
            st.localTransient.x = bench.position[0];
            st.localTransient.y = bench.position[1];
            st.localTransient.z = bench.position[2];
            st.localTransient.vx = 0;
            st.localTransient.vy = 0;
            st.localTransient.vz = 0;
            st.localTransient.moving = false;
            st.localTransient.running = false;
            st.localTransient.yaw = bench.yaw;
          }
          boundNet?.requestBenchSeat(benchId);
          st.setSeatedBench(benchId);
          break;
        }
        case 'stand_up': {
          boundNet?.requestBenchSeat(null);
          st.setSeatedBench(null);
          break;
        }
        case 'set_outfit': {
          st.updateOutfit(payload as Partial<typeof st.outfit>);
          const updated = useGameStore.getState();
          boundNet?.sendProfile(updated.displayName, updated.outfit);
          break;
        }
        case 'jam_guitar': {
          const chordIndex = Number(payload.chordIndex ?? 0);
          st.triggerEmote('play_guitar');
          boundNet?.sendJamNote(chordIndex, 'guitar');
          break;
        }
        case 'send_chat': {
          const text = String(payload.text || 'Chào buổi sáng Cầu Đất nhé!');
          boundNet?.sendChat(text);
          break;
        }
        case 'open_photo_mode':
          st.setPhotoMode(true);
          break;
        case 'close_photo_mode':
          st.setPhotoMode(false);
          break;
        case 'snap_polaroid':
          st.setPhotoMode(true);
          st.requestPhotoShutter();
          break;
        default:
          return { ok: false, error: `Unknown action: ${action}` };
      }
      return { ok: true, action, state: window.__DALAT_QA__!.getPlayerState() };
    },

    setWorldAtmosphere: (gameHour, weather) => {
      const st = useGameStore.getState();
      st.setOverrideAtmosphere(gameHour, weather);
      const next = useGameStore.getState().atmosphere;
      return {
        gameHour: next.gameHour,
        timeLabel: next.timeLabel,
        phaseTitle: next.phaseTitle,
        weather: next.weather,
        weatherLabel: next.weatherLabel,
        temperatureC: next.temperatureC,
        greenhouseGlow: next.greenhouseGlow,
      };
    },

    measureFps: (durationMs = 2000) =>
      new Promise((resolve) => {
        const frameDeltas: number[] = [];
        let last = performance.now();
        const start = last;

        function sample(now: number) {
          const dt = now - last;
          last = now;
          if (dt > 0 && dt < 250) {
            frameDeltas.push(dt);
          }
          if (now - start < durationMs) {
            requestAnimationFrame(sample);
          } else {
            const sorted = [...frameDeltas].sort((a, b) => a - b);
            const avgDt =
              frameDeltas.reduce((s, v) => s + v, 0) / Math.max(1, frameDeltas.length);
            const p95Dt = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || avgDt;
            const maxDt = sorted[sorted.length - 1] || avgDt;
            const sceneStats = window.__DALAT_QA__!.inspectScene();
            const perfMem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
            resolve({
              samples: frameDeltas.length,
              fpsAvg: Math.round((1000 / Math.max(1, avgDt)) * 10) / 10,
              fpsP95: Math.round((1000 / Math.max(1, p95Dt)) * 10) / 10,
              fpsMin: Math.round((1000 / Math.max(1, maxDt)) * 10) / 10,
              frameTimeMsP95: Math.round(p95Dt * 100) / 100,
              jsHeapMB: perfMem ? Math.round((perfMem.usedJSHeapSize / (1024 * 1024)) * 10) / 10 : null,
              ...sceneStats,
            });
          }
        }
        requestAnimationFrame(sample);
      }),
  };
}

