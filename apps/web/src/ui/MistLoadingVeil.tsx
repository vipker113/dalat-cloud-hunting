import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { UI_COLORS, UI_FONTS } from './uiStyles';

/**
 * Soft Highland Mist Curtain that veils initial WebGL shader compilation / asset pop-in,
 * then parts smoothly into the live Cầu Đất cloud sea as soon as the 3D scene renders.
 */
export function MistLoadingVeil() {
  const sceneReady = useGameStore((s) => s.sceneReady);
  const markSceneReady = useGameStore((s) => s.markSceneReady);
  const [unmounted, setUnmounted] = useState(false);

  // Safety fallback so slow headless GPUs never stall the veil past 780ms
  useEffect(() => {
    if (sceneReady) return;
    const safety = window.setTimeout(() => {
      markSceneReady();
    }, 780);
    return () => window.clearTimeout(safety);
  }, [sceneReady, markSceneReady]);

  useEffect(() => {
    if (!sceneReady) return;
    const t = window.setTimeout(() => {
      setUnmounted(true);
    }, 520);
    return () => window.clearTimeout(t);
  }, [sceneReady]);

  if (unmounted) return null;

  return (
    <div
      aria-hidden="true"
      className="dalat-full-viewport"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 'var(--dl-vh, 100vh)',
        zIndex: 90,
        pointerEvents: 'none',
        opacity: sceneReady ? 0 : 1,
        transition: 'opacity 480ms cubic-bezier(0.22, 1, 0.36, 1)',
        background:
          'radial-gradient(circle at 58% 44%, rgba(31, 44, 62, 0.88) 0%, rgba(12, 18, 28, 0.96) 72%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        padding: '16px',
        textAlign: 'center',
        boxSizing: 'border-box',
        fontFamily: UI_FONTS.sans,
      }}
    >
      <div
        className="dalat-serif"
        style={{
          fontFamily: UI_FONTS.serif,
          fontSize: 'clamp(18px, 5vw, 22px)',
          fontWeight: 600,
          color: UI_COLORS.cream,
          letterSpacing: '-0.01em',
          animation: 'dalatMistBreath 2.4s ease-in-out infinite',
        }}
      >
        ☁️ Sương sớm Cầu Đất đang tan…
      </div>
      <div
        style={{
          fontSize: '12.5px',
          color: UI_COLORS.warmAmber,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        Đồi Chè 1.650m • Đà Lạt
      </div>
    </div>
  );
}
