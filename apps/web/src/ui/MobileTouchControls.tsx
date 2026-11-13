import { useEffect, useRef } from 'react';
import { ArrowUp, Sparkles } from 'lucide-react';
import { executeInteractPrompt } from '../gameplay/interactions';
import { useNetController } from '../gameplay/netBridge';
import { useGameStore } from '../store/gameStore';
import { GLASS_PILL_STYLE, UI_COLORS, UI_FONTS } from './uiStyles';
import { useViewportLayout } from './useViewportLayout';

const JOYSTICK_RADIUS = 48;
const UI_TOUCH_IGNORE_SELECTOR =
  '[data-ui-overlay="true"], [data-dalat-drawer="true"], [role="dialog"], button, input, textarea, select, label, a, form, nav';

export function MobileTouchControls() {
  const net = useNetController();
  const { isTouchCapable } = useViewportLayout();

  const hasEnteredWorld = useGameStore((s) => s.hasEnteredWorld);
  const activeModal = useGameStore((s) => s.activeModal);
  const photoModeActive = useGameStore((s) => s.photoModeActive);
  const qualityTier = useGameStore((s) => s.qualityTier);
  const nearbyPrompt = useGameStore((s) => s.nearbyPrompt);
  const seatedBenchId = useGameStore((s) => s.seatedBenchId);
  const onboardingStep = useGameStore((s) => s.onboardingStep);

  const isTouchDevice = isTouchCapable || qualityTier === 'mobile';

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
    pinchDist: 0,
  });

  useEffect(() => {
    if (!isTouchDevice || !hasEnteredWorld || activeModal !== 'none') {
      const lt = useGameStore.getState().localTransient;
      lt.moveInputX = 0;
      lt.moveInputZ = 0;
      return;
    }

    const showRing = (x: number, y: number, dx: number, dy: number, sprinting: boolean) => {
      if (ringRef.current) {
        ringRef.current.style.opacity = '1';
        ringRef.current.style.borderColor = sprinting
          ? 'rgba(243, 195, 130, 0.82)'
          : 'rgba(255, 232, 204, 0.34)';
        ringRef.current.style.boxShadow = sprinting
          ? '0 0 18px rgba(243, 195, 130, 0.35)'
          : 'none';
        ringRef.current.style.transform = `translate3d(${x - JOYSTICK_RADIUS}px, ${y - JOYSTICK_RADIUS}px, 0)`;
      }
      if (knobRef.current) {
        knobRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      }
    };

    const hideRing = () => {
      if (ringRef.current) {
        ringRef.current.style.opacity = '0';
        ringRef.current.style.boxShadow = 'none';
      }
      if (knobRef.current) {
        knobRef.current.style.transform = 'translate3d(0px, 0px, 0)';
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (useGameStore.getState().activeModal !== 'none') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(UI_TOUCH_IGNORE_SELECTOR)) return;

      const ts = touchState.current;

      // 2-finger pinch-to-zoom initialization when not dragging left-thumb movement joystick
      if (e.touches.length === 2 && ts.moveId === null) {
        const t0 = e.touches[0]?.target as HTMLElement | null;
        const t1 = e.touches[1]?.target as HTMLElement | null;
        if (t0?.closest(UI_TOUCH_IGNORE_SELECTOR) || t1?.closest(UI_TOUCH_IGNORE_SELECTOR)) {
          return;
        }
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        ts.pinchDist = Math.hypot(dx, dy);
        ts.lookId = null;
        return;
      }

      const halfW = window.innerWidth * 0.44;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const touchTarget = t.target as HTMLElement | null;
        if (touchTarget?.closest(UI_TOUCH_IGNORE_SELECTOR)) continue;
        if (t.clientX < halfW && ts.moveId === null) {
          ts.moveId = t.identifier;
          ts.originX = t.clientX;
          ts.originY = t.clientY;
          showRing(t.clientX, t.clientY, 0, 0, false);
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
      if (st.activeModal !== 'none') return;
      const target = e.target as HTMLElement | null;
      if (ts.moveId === null && ts.lookId === null && target?.closest(UI_TOUCH_IGNORE_SELECTOR)) {
        return;
      }
      const lt = st.localTransient;

      // 2-finger pinch-to-zoom camera distance
      if (e.touches.length === 2 && ts.moveId === null && !st.photoModeActive) {
        const t0 = e.touches[0]?.target as HTMLElement | null;
        const t1 = e.touches[1]?.target as HTMLElement | null;
        if (t0?.closest(UI_TOUCH_IGNORE_SELECTOR) || t1?.closest(UI_TOUCH_IGNORE_SELECTOR)) {
          return;
        }
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const nextDist = Math.hypot(dx, dy);
        if (ts.pinchDist > 8) {
          const delta = ts.pinchDist - nextDist;
          lt.targetCameraDistance = Math.max(
            1.45,
            Math.min(8.4, lt.targetCameraDistance + delta * 0.016)
          );
        }
        ts.pinchDist = nextDist;
        return;
      }

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
          const normMag = clampedDist / JOYSTICK_RADIUS;

          lt.moveInputX = kx / JOYSTICK_RADIUS;
          lt.moveInputZ = ky / JOYSTICK_RADIUS;
          showRing(ts.originX, ts.originY, kx, ky, normMag > 0.88);
          if (normMag > 0.25) {
            st.advanceOnboarding('move');
          }
        } else if (t.identifier === ts.lookId) {
          const dx = t.clientX - ts.lastLookX;
          const dy = t.clientY - ts.lastLookY;
          ts.lastLookX = t.clientX;
          ts.lastLookY = t.clientY;

          const baseSens = st.photoModeActive ? 0.0034 : 0.0052;
          const sens = baseSens * st.cameraSensitivity;
          lt.cameraYaw -= dx * sens;
          const minP = st.photoModeActive ? -0.8 : -0.34;
          const maxP = st.photoModeActive ? 0.9 : 1.0;
          lt.cameraPitch = Math.max(minP, Math.min(maxP, lt.cameraPitch + dy * sens));
          if (Math.hypot(dx, dy) > 4) {
            st.advanceOnboarding('look');
          }
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const ts = touchState.current;
      const lt = useGameStore.getState().localTransient;

      if (e.touches.length < 2) {
        ts.pinchDist = 0;
      }

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
    <div
      className="dalat-full-viewport"
      style={{
        position: 'fixed',
        inset: 0,
        height: 'var(--dl-vh, 100vh)',
        zIndex: 25,
        pointerEvents: 'none',
        fontFamily: UI_FONTS.sans,
      }}
    >
      {/* Resting Ghost Thumb Affordance Ring (Visible during initial 'move' onboarding step) */}
      {onboardingStep === 'move' && !photoModeActive && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 'calc(var(--dl-safe-left) + 14px)',
            bottom: 'calc(var(--dl-safe-bottom) + 74px)',
            width: '76px',
            height: '76px',
            borderRadius: '50%',
            border: '1.5px dashed rgba(243, 195, 130, 0.42)',
            background: 'rgba(15, 22, 34, 0.28)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.72,
          }}
        >
          <div
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: 'rgba(243, 195, 130, 0.36)',
            }}
          />
        </div>
      )}

      {/* Active Floating Virtual Joystick Ring */}
      <div
        ref={ringRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${JOYSTICK_RADIUS * 2}px`,
          height: `${JOYSTICK_RADIUS * 2}px`,
          borderRadius: '50%',
          background: 'rgba(15, 22, 34, 0.42)',
          border: '1.5px solid rgba(255, 232, 204, 0.34)',
          opacity: 0,
          transition: 'opacity 140ms ease',
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
            background: 'rgba(243, 195, 130, 0.78)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
          }}
        />
      </div>

      {/* Right-Thumb Ergonomic Cluster: Positioned strictly above the 1-Row Bottom Dock (Zero Overlap!) */}
      {!photoModeActive && (
        <div
          data-testid="mobile-thumb-cluster"
          data-ui-overlay="true"
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            right: 'var(--dl-safe-right)',
            bottom: 'calc(var(--dl-safe-bottom) + 72px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
            pointerEvents: 'auto',
          }}
        >
          {nearbyPrompt && !seatedBenchId && (
            <button
              type="button"
              aria-label={nearbyPrompt.label}
              title={nearbyPrompt.label}
              onClick={() => executeInteractPrompt(nearbyPrompt, net)}
              className="dalat-glass-btn"
              style={{
                ...GLASS_PILL_STYLE,
                width: '48px',
                height: '48px',
                padding: 0,
                borderRadius: '50%',
                border: `1.5px solid ${UI_COLORS.warmAmber}`,
                background: 'rgba(40, 30, 20, 0.88)',
                color: UI_COLORS.warmAmber,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 22px rgba(243, 195, 130, 0.25)',
              }}
            >
              <Sparkles size={20} strokeWidth={2.1} />
            </button>
          )}

          <button
            type="button"
            aria-label="Nhảy"
            data-testid="mobile-jump-btn"
            onTouchStart={(e) => {
              e.stopPropagation();
              useGameStore.getState().localTransient.jumpRequested = true;
            }}
            onClick={() => {
              useGameStore.getState().localTransient.jumpRequested = true;
            }}
            className="dalat-glass-btn"
            style={{
              ...GLASS_PILL_STYLE,
              width: '48px',
              height: '48px',
              padding: 0,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: UI_COLORS.warmAmber,
            }}
          >
            <ArrowUp size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
