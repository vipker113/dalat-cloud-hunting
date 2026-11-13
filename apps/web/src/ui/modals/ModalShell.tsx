import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { GLASS_MODAL_STYLE, UI_COLORS, UI_FONTS } from '../uiStyles';
import { useViewportLayout } from '../useViewportLayout';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalShell(props: {
  title: string;
  subtitle?: string;
  maxWidth?: string;
  children: React.ReactNode;
}) {
  const { title, subtitle, maxWidth = '720px', children } = props;
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const { isMobileLayout, isCompactMobile } = useViewportLayout();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Move initial focus inside dialog and restore focus when modal closes
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialogEl = dialogRef.current;
    if (dialogEl && !dialogEl.contains(previousFocus)) {
      const preferredBtn = dialogEl.querySelector<HTMLElement>('button:not([disabled])');
      const fallbackFocusable = dialogEl.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      const target = preferredBtn || fallbackFocusable || dialogEl;
      target.focus({ preventScroll: true });
    }

    return () => {
      if (
        useGameStore.getState().activeModal === 'none' &&
        previousFocus &&
        typeof previousFocus.focus === 'function' &&
        document.contains(previousFocus)
      ) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  // Keyboard Escape + Accessible Focus Cycling inside Dialog
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setActiveModal('none');
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
        if (focusables.length === 0) {
          e.preventDefault();
          dialogRef.current.focus({ preventScroll: true });
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !dialogRef.current.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setActiveModal]);

  return (
    <div
      className="dalat-full-viewport"
      data-ui-overlay="true"
      onClick={() => setActiveModal('none')}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        inset: 0,
        height: 'var(--dl-vh, 100vh)',
        maxWidth: '100vw',
        zIndex: 50,
        background: 'rgba(8, 12, 20, 0.58)',
        backdropFilter: 'var(--dl-modal-blur, blur(8px))',
        WebkitBackdropFilter: 'var(--dl-modal-blur, blur(8px))',
        display: 'flex',
        alignItems: isMobileLayout ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isCompactMobile ? '8px 6px 0' : isMobileLayout ? '10px 10px 0' : '20px',
        boxSizing: 'border-box',
        pointerEvents: 'auto',
        fontFamily: UI_FONTS.sans,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-ui-overlay="true"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="dalat-scroll"
        style={{
          ...GLASS_MODAL_STYLE,
          width: '100%',
          maxWidth,
          maxHeight: isMobileLayout
            ? 'calc(var(--dl-vh, 100vh) - 16px)'
            : 'calc(var(--dl-vh, 100vh) - 44px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          borderRadius: isMobileLayout ? '24px 24px 0 0' : '26px',
          padding: isCompactMobile
            ? '14px 12px max(22px, env(safe-area-inset-bottom, 22px))'
            : isMobileLayout
              ? '18px 15px max(24px, env(safe-area-inset-bottom, 24px))'
              : '24px 26px',
          boxSizing: 'border-box',
          outline: 'none',
          animation: 'dalatFadeUp 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              id={titleId}
              className="dalat-serif"
              style={{
                fontFamily: UI_FONTS.serif,
                fontSize: isMobileLayout ? '21px' : '24px',
                fontWeight: 600,
                color: UI_COLORS.cream,
                lineHeight: 1.2,
                margin: 0,
              }}
            >
              {title}
            </h2>
            {subtitle && (
              <p
                style={{
                  fontSize: '12.5px',
                  color: UI_COLORS.mistText,
                  marginTop: '4px',
                  marginBottom: 0,
                  lineHeight: 1.45,
                }}
              >
                {subtitle}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setActiveModal('none')}
            aria-label="Đóng"
            className="dalat-glass-btn"
            style={{
              width: '44px',
              height: '44px',
              padding: 0,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.07)',
              border: `1px solid ${UI_COLORS.border}`,
              color: UI_COLORS.cream,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
