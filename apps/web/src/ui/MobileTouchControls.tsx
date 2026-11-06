import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import { GLASS_PILL_STYLE, UI_COLORS } from './uiStyles';

const JOYSTICK_RADIUS = 48;

export function MobileTouchControls() {
  const hasEnteredWorld = useGameStore((s) => s.hasEnteredWorld);
  const activeModal = useGameStore((s) => s.activeModal);
  const photoModeActive = useGameStore((s) => s.photoModeActive);
  const qualityTier = useGameStore((s) => s.qualityTier);

  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Refs for visual joystick ring updated via DOM styles (0 React re-renders during 60Hz drag!)
  const ringRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);

  const touchState = useRef({
    moveId: null as number | null,
    originX: 0,
    originY: 0,
    lookId: null as number | null,
    lastLookX: 0,
    lastLookY: 0,
  });

  useEffect(() => {
    const hasTouch =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0 || qualityTier === 'mobile');
    setIsTouchDevice(hasTouch);
  }, [qualityTier]);

  useEffect(() => {
    if (!isTouchDevice || !hasEnteredWorld || activeModal !== 'none') {
      const lt = useGameStore.getState().localTransient;
      lt.moveInputX = 0;
      lt.moveInputZ = 0;
      return;
    }

    const showRing = (x: number, y: number, dx: number, dy: number) => {
      if (ringRef.current) {
        ringRef.current.style.opacity = '1';
        ringRef.current.style.transform = `translate3d(${x - JOYSTICK_RADIUS}px, ${y - JOYSTICK_RADIUS}px, 0)`;
      }
      if (knobRef.current) {
        knobRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      }
    };

    const hideRing = () => {
      if (ringRef.current) ringRef.current.style.opacity = '0';
      if (knobRef.current) knobRef.current.style.transform = 'translate3d(0px, 0px, 0)';
    };

    const onTouchStart = (e: TouchEvent) => {
      // Ignore touches on interactive UI buttons/inputs
      const target = e.target as HTMLElement | null;
      if (target && target.closest('button, input, textarea, form')) return;

      const halfW = window.innerWidth * 0.46;
      const ts = touchState.current;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.clientX < halfW && ts.moveId === null) {
          ts.moveId = t.identifier;
          ts.originX = t.clientX;
          ts.originY = t.clientY;
          showRing(t.clientX, t.clientY, 0, 0);
        } else if (t.clientX >= halfW && ts.lookId === null) {
          ts.lookId = t.identifier;
          ts.lastLookX = t.clientX;
          ts.lastLookY = t.clientY;
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const ts = touchState.current;
      const st = useGameStore.getState();
      const lt = st.localTransient;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === ts.moveId) {
          const rawDx = t.clientX - ts.originX;
          const rawDy = t.clientY - ts.originY;
          const dist = Math.hypot(rawDx, rawDy);
          const clampedDist = Math.min(JOYSTICK_RADIUS, dist);
          const angle = Math.atan2(rawDy, rawDx);
          const kx = Math.cos(angle) * clampedDist;
          const ky = Math.sin(angle) * clampedDist;

          lt.moveInputX = kx / JOYSTICK_RADIUS;
          lt.moveInputZ = ky / JOYSTICK_RADIUS;
          showRing(ts.originX, ts.originY, kx, ky);
        } else if (t.identifier === ts.lookId) {
          const dx = t.clientX - ts.lastLookX;
          const dy = t.clientY - ts.lastLookY;
          ts.lastLookX = t.clientX;
          ts.lastLookY = t.clientY;

          const sens = st.photoModeActive ? 0.0034 : 0.0052;
          lt.cameraYaw -= dx * sens;
          const minP = st.photoModeActive ? -0.8 : -0.34;
          const maxP = st.photoModeActive ? 0.9 : 1.0;
          lt.cameraPitch = Math.max(minP, Math.min(maxP, lt.cameraPitch + dy * sens));
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const ts = touchState.current;
      const lt = useGameStore.getState().localTransient;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === ts.moveId) {
          ts.moveId = null;
          lt.moveInputX = 0;
          lt.moveInputZ = 0;
          hideRing();
        } else if (t.identifier === ts.lookId) {
          ts.lookId = null;
        }
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      hideRing();
    };
  }, [isTouchDevice, hasEnteredWorld, activeModal]);

  if (!isTouchDevice || !hasEnteredWorld || activeModal !== 'none') return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 25, pointerEvents: 'none' }}>
      {/* Whisper-Soft Floating Virtual Joystick Ring (only visible while dragging!) */}
      <div
        ref={ringRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${JOYSTICK_RADIUS * 2}px`,
          height: `${JOYSTICK_RADIUS * 2}px`,
          borderRadius: '50%',
          background: 'rgba(18, 25, 38, 0.32)',
          border: '1px solid rgba(255, 232, 204, 0.28)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          opacity: 0,
          transition: 'opacity 160ms ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          ref={knobRef}
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'rgba(243, 195, 130, 0.72)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          }}
        />
      </div>

      {/* Subtle Touch Jump Button (hidden in Photo Mode) */}
      {!photoModeActive && (
        <button
          type="button"
          aria-label="Nhảy"
          onTouchStart={(e) => {
            e.stopPropagation();
            useGameStore.getState().localTransient.jumpRequested = true;
          }}
          style={{
            ...GLASS_PILL_STYLE,
            position: 'absolute',
            right: '22px',
            bottom: '88px',
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: UI_COLORS.warmAmber,
            pointerEvents: 'auto',
          }}
        >
          <ArrowUp size={20} />
        </button>
      )}
    </div>
  );
}
