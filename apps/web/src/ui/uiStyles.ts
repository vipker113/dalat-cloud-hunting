import type { CSSProperties } from 'react';

export const UI_FONTS = {
  serif: '"Fraunces", Georgia, serif',
  sans: '"Be Vietnam Pro", -apple-system, BlinkMacSystemFont, sans-serif',
  mono: '"JetBrains Mono", monospace',
} as const;

/**
 * Mist & Pine Editorial Minimalism Tokens
 * WCAG 2.2 AA verified (>= 4.5:1 to 9.03:1 contrast even directly over #EBE1D4 sunlit clouds).
 */
export const UI_COLORS = {
  glassBg: 'rgba(11, 16, 25, 0.84)',
  glassMobileBg: 'rgba(11, 16, 25, 0.90)',
  glassDeepBg: 'rgba(11, 16, 26, 0.92)',
  glassCardBg: 'rgba(22, 31, 48, 0.74)',
  paperBg: '#F5ECDC',
  paperInk: '#241E18',
  border: 'rgba(255, 232, 204, 0.24)',
  borderStrong: 'rgba(243, 195, 130, 0.54)',
  cream: '#F8F3EB',
  warmAmber: '#F3C382',
  sunriseCoral: '#EC9A6C',
  offlineCoral: '#E88B6E',
  npcIce: '#9CC0D8',
  mistText: 'rgba(240, 236, 228, 0.90)',
  mutedText: '#B6C2D6',
  pineSage: '#82D69E',
} as const;

export const GLASS_PILL_STYLE: CSSProperties = {
  background: 'var(--dl-surface-hud, rgba(11, 16, 25, 0.84))',
  backdropFilter: 'var(--dl-hud-blur, blur(12px))',
  WebkitBackdropFilter: 'var(--dl-hud-blur, blur(12px))',
  border: `1px solid ${UI_COLORS.border}`,
  boxShadow: '0 10px 30px rgba(6, 10, 18, 0.42)',
  color: UI_COLORS.cream,
  textShadow: '0 1px 2px rgba(4, 8, 16, 0.88)',
};

export function getHudPillStyle(lowGpuMobile = false): CSSProperties {
  if (lowGpuMobile) {
    return {
      background: UI_COLORS.glassMobileBg,
      border: `1px solid ${UI_COLORS.border}`,
      boxShadow: '0 8px 22px rgba(6, 10, 18, 0.44)',
      color: UI_COLORS.cream,
      textShadow: '0 1px 2px rgba(4, 8, 16, 0.88)',
    };
  }
  return GLASS_PILL_STYLE;
}

export const GLASS_MODAL_STYLE: CSSProperties = {
  background: UI_COLORS.glassDeepBg,
  backdropFilter: 'var(--dl-modal-blur, blur(16px))',
  WebkitBackdropFilter: 'var(--dl-modal-blur, blur(16px))',
  border: `1px solid ${UI_COLORS.border}`,
  boxShadow: '0 24px 64px rgba(4, 8, 16, 0.62)',
  color: UI_COLORS.cream,
};

export const DIEGETIC_GLOBAL_CSS = `
:root {
  --dl-vh: 100vh;
  --dl-surface-hud: rgba(11, 16, 25, 0.84);
  --dl-surface-hud-mobile: rgba(11, 16, 25, 0.90);
  --dl-surface-modal: rgba(11, 16, 26, 0.92);
  --dl-surface-card: rgba(255, 248, 236, 0.065);
  --dl-surface-paper: #F5ECDC;
  --dl-text-primary: #F8F3EB;
  --dl-text-secondary: rgba(240, 236, 228, 0.90);
  --dl-text-muted: #B6C2D6;
  --dl-accent-amber: #F3C382;
  --dl-accent-cta: #E29856;
  --dl-status-online: #82D69E;
  --dl-status-offline: #E88B6E;
  --dl-status-npc: #9CC0D8;
  --dl-border-subtle: rgba(255, 232, 204, 0.24);
  --dl-border-active: rgba(243, 195, 130, 0.56);
  --dl-focus-ring: 0 0 0 2px #121926, 0 0 0 4px #F3C382;
  --dl-hud-blur: blur(12px);
  --dl-modal-blur: blur(16px);
  --dl-safe-top: max(14px, env(safe-area-inset-top, 14px));
  --dl-safe-bottom: max(14px, env(safe-area-inset-bottom, 14px));
  --dl-safe-left: max(14px, env(safe-area-inset-left, 14px));
  --dl-safe-right: max(14px, env(safe-area-inset-right, 14px));
}

@supports (height: 100dvh) {
  :root {
    --dl-vh: 100dvh;
  }
}

@media (max-width: 380px) {
  :root {
    --dl-safe-top: max(8px, env(safe-area-inset-top, 8px));
    --dl-safe-bottom: max(8px, env(safe-area-inset-bottom, 8px));
    --dl-safe-left: max(8px, env(safe-area-inset-left, 8px));
    --dl-safe-right: max(8px, env(safe-area-inset-right, 8px));
  }
}

.dalat-full-viewport {
  width: 100%;
  height: 100vh;
  height: 100dvh;
}

body[data-quality-tier="mobile"] {
  --dl-surface-hud: rgba(11, 16, 25, 0.90);
  --dl-hud-blur: none;
  --dl-modal-blur: none;
}

h1, h2, h3, .dalat-serif {
  font-variation-settings: "WONK" 0;
}

@keyframes dalatFadeUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dalatSoftPulse {
  0%, 100% { opacity: 0.78; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.04); }
}
@keyframes dalatPlaqueSway {
  0%, 100% { transform: rotate(-1.1deg); }
  50% { transform: rotate(1.1deg); }
}
@keyframes dalatShutterFlash {
  0% { opacity: 0.92; }
  100% { opacity: 0; }
}
@keyframes dalatMistBreath {
  0%, 100% { opacity: 0.65; transform: translateY(0px); }
  50% { opacity: 0.95; transform: translateY(-3px); }
}

.dalat-glass-btn {
  cursor: pointer;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), background 180ms ease, border-color 180ms ease, opacity 180ms ease, box-shadow 180ms ease;
}
.dalat-glass-btn:hover:not(:disabled) {
  background: rgba(255, 232, 204, 0.14) !important;
  border-color: rgba(255, 232, 204, 0.38) !important;
  transform: translateY(-1px);
}
.dalat-glass-btn:active:not(:disabled) {
  transform: translateY(0px) scale(0.98);
}
.dalat-glass-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible,
[role="button"]:focus-visible,
[role="tab"]:focus-visible,
[role="radio"]:focus-visible {
  outline: none !important;
  box-shadow: var(--dl-focus-ring) !important;
}

.dalat-scroll::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
.dalat-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.dalat-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 232, 204, 0.24);
  border-radius: 999px;
}

@media (max-width: 860px), (pointer: coarse) {
  input, textarea, select {
    font-size: 16px !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

[data-reduced-motion="true"] *,
[data-reduced-motion="true"] *::before,
[data-reduced-motion="true"] *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}
`;
