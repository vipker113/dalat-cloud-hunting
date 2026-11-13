import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../store/gameStore';
import { captureAndComposePolaroidAsync } from './polaroidComposer';

const STAGING_CROP_SIZE = 572;

/**
 * Single-pass async Polaroid capture:
 * Runs at late `useFrame` priority `2` (immediately AFTER `CinematicPostProcessing` at priority `1`
 * has already rendered the post-processed frame into `gl.domElement`), blits the 1:1 center square
 * onto an offscreen staging canvas in <0.5ms, and defers film grading + WebP/JPEG encoding to
 * `setTimeout(..., 0)` so shutter frames never double-render EffectComposer or stall `rAF`.
 */
export function PhotoCaptureBridge() {
  const lastNonceRef = useRef<number>(useGameStore.getState().photoShutterNonce);
  const stagingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, []);

  useFrame(({ gl }) => {
    const st = useGameStore.getState();
    if (st.photoShutterNonce === lastNonceRef.current) return;
    lastNonceRef.current = st.photoShutterNonce;

    const src = gl.domElement;
    const sw = src.width || 1;
    const sh = src.height || 1;
    const crop = Math.min(sw, sh);
    const sx = Math.floor((sw - crop) * 0.5);
    const sy = Math.floor((sh - crop) * 0.5);

    if (!stagingCanvasRef.current) {
      const c = document.createElement('canvas');
      c.width = STAGING_CROP_SIZE;
      c.height = STAGING_CROP_SIZE;
      stagingCanvasRef.current = c;
    }
    const staging = stagingCanvasRef.current;
    const sctx = staging.getContext('2d');
    if (sctx) {
      sctx.drawImage(src, sx, sy, crop, crop, 0, 0, STAGING_CROP_SIZE, STAGING_CROP_SIZE);
    }

    const snapParams = {
      sourceCanvas: sctx ? staging : src,
      filter: st.photoFilter,
      focalMm: st.photoFocalMm,
      caption: '',
      authorName: st.displayName || 'Lữ Khách',
      playerX: st.localTransient.x,
      playerY: st.localTransient.y,
      playerZ: st.localTransient.z,
      atmosphere: { ...st.atmosphere },
      inviteRoomCode: st.photoIncludeInviteCode ? st.roomCode || 'MAY-01' : '',
    };

    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
    }
    pendingTimerRef.current = setTimeout(() => {
      pendingTimerRef.current = null;
      void captureAndComposePolaroidAsync(snapParams).then((entry) => {
        const cur = useGameStore.getState();
        cur.saveCapturedPolaroid(entry);
        cur.setLatestCapturedPolaroid(entry);
      });
    }, 16);
  }, 2);

  return null;
}
