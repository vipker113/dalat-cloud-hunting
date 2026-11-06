import type { CSSProperties } from 'react';

export const UI_FONTS = {
  serif: '"Fraunces", Georgia, serif',
  sans: '"Be Vietnam Pro", -apple-system, BlinkMacSystemFont, sans-serif',
  mono: '"JetBrains Mono", monospace',
} as const;

export const UI_COLORS = {
  glassBg: 'rgba(18, 25, 38, 0.58)',
  glassDeepBg: 'rgba(15, 22, 34, 0.78)',
  glassCardBg: 'rgba(24, 33, 50, 0.54)',
  border: 'rgba(255, 232, 204, 0.18)',
  borderStrong: 'rgba(255, 222, 178, 0.36)',
  cream: '#F8F3EB',
  warmAmber: '#F3C382',
  sunriseCoral: '#EC9A6C',
  mistText: 'rgba(232, 226, 216, 0.76)',
  mutedText: 'rgba(206, 202, 196, 0.55)',
  pineSage: '#82B39A',
} as const;

export const GLASS_PILL_STYLE: CSSProperties = {
  background: UI_COLORS.glassBg,
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border: `1px solid ${UI_COLORS.border}`,
  boxShadow: '0 10px 32px rgba(6, 10, 18, 0.34)',
  color: UI_COLORS.cream,
};

export const GLASS_MODAL_STYLE: CSSProperties = {
  background: UI_COLORS.glassDeepBg,
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  border: `1px solid ${UI_COLORS.border}`,
  boxShadow: '0 24px 64px rgba(4, 8, 16, 0.58)',
  color: UI_COLORS.cream,
};

export const DIEGETIC_GLOBAL_CSS = `
@keyframes dalatFadeUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dalatSoftPulse {
  0%, 100% { opacity: 0.78; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.04); }
}
@keyframes dalatPlaqueSway {
  0%, 100% { transform: rotate(-1.3deg); }
  50% { transform: rotate(1.3deg); }
}
@keyframes dalatShutterFlash {
  0% { opacity: 0.92; }
  100% { opacity: 0; }
}
.dalat-glass-btn {
  cursor: pointer;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), background 180ms ease, border-color 180ms ease, opacity 180ms ease;
}
.dalat-glass-btn:hover {
  background: rgba(255, 232, 204, 0.14) !important;
  border-color: rgba(255, 232, 204, 0.36) !important;
  transform: translateY(-1px);
}
.dalat-glass-btn:active {
  transform: translateY(0px) scale(0.98);
}
.dalat-scroll::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
.dalat-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.dalat-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 232, 204, 0.22);
  border-radius: 999px;
}
`;
