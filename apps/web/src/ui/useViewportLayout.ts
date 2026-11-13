import { useEffect, useState } from 'react';

export interface ViewportLayoutState {
  width: number;
  height: number;
  isCoarsePointer: boolean;
  isTouchCapable: boolean;
  /** True on narrow phones (<768px) OR short landscape phones (<520px tall) */
  isMobileLayout: boolean;
  /** True on ultra-narrow viewports (<380px, e.g. 320x568 iPhone SE) */
  isCompactMobile: boolean;
  /** True specifically on landscape mobile phones (e.g. 844x390) */
  isLandscapeMobile: boolean;
  /** True when viewport has room for side-by-side 3D stage + left drawer (>=860x540) */
  isDesktopStage: boolean;
  /** True when keyboard keycap badges ([G], [Enter], [Tab]) should be rendered */
  showKeycaps: boolean;
  prefersReducedMotion: boolean;
}

function readViewportState(): ViewportLayoutState {
  if (typeof window === 'undefined') {
    return {
      width: 1440,
      height: 900,
      isCoarsePointer: false,
      isTouchCapable: false,
      isMobileLayout: false,
      isCompactMobile: false,
      isLandscapeMobile: false,
      isDesktopStage: true,
      showKeycaps: true,
      prefersReducedMotion: false,
    };
  }

  const width = window.innerWidth || 1440;
  const height = window.innerHeight || 900;
  const coarseMq = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const reducedMq = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  const isCoarsePointer = coarseMq || (hasTouch && width < 960);
  const isLandscapeMobile = height < 520 && width > height;
  const isMobileLayout = width < 768 || isLandscapeMobile;
  const isCompactMobile = width < 380;
  const isDesktopStage = width >= 860 && height >= 540;
  const showKeycaps = !isCoarsePointer && !isMobileLayout;

  return {
    width,
    height,
    isCoarsePointer,
    isTouchCapable: hasTouch || coarseMq,
    isMobileLayout,
    isCompactMobile,
    isLandscapeMobile,
    isDesktopStage,
    showKeycaps,
    prefersReducedMotion: reducedMq,
  };
}

/**
 * Shared responsive + input-capability layout engine.
 * Prevents mobile landscape (844x390) from being misclassified as desktop,
 * and hides irrelevant desktop keyboard badges on touch screens.
 */
export function useViewportLayout(): ViewportLayoutState {
  const [state, setState] = useState<ViewportLayoutState>(readViewportState);

  useEffect(() => {
    const update = () => setState(readViewportState());
    const coarseMql = window.matchMedia?.('(pointer: coarse)');
    const motionMql = window.matchMedia?.('(prefers-reduced-motion: reduce)');

    window.addEventListener('resize', update, { passive: true });
    window.addEventListener('orientationchange', update, { passive: true });
    coarseMql?.addEventListener?.('change', update);
    motionMql?.addEventListener?.('change', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      coarseMql?.removeEventListener?.('change', update);
      motionMql?.removeEventListener?.('change', update);
    };
  }, []);

  return state;
}
