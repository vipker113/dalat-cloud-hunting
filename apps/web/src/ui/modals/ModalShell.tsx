import { X } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { GLASS_MODAL_STYLE, UI_COLORS, UI_FONTS } from '../uiStyles';

export function ModalShell(props: {
  title: string;
  subtitle?: string;
  maxWidth?: string;
  children: React.ReactNode;
}) {
  const { title, subtitle, maxWidth = '720px', children } = props;
  const setActiveModal = useGameStore((s) => s.setActiveModal);

  return (
    <div
      onClick={() => setActiveModal('none')}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(8, 12, 20, 0.46)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        pointerEvents: 'auto',
        fontFamily: UI_FONTS.sans,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="dalat-scroll"
        style={{
          ...GLASS_MODAL_STYLE,
          width: '100%',
          maxWidth,
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          borderRadius: '26px',
          padding: '24px 26px',
          animation: 'dalatFadeUp 240ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '14px',
            marginBottom: '18px',
          }}
        >
          <div>
            <h2
              style={{
                fontFamily: UI_FONTS.serif,
                fontSize: '24px',
                fontWeight: 600,
                color: UI_COLORS.cream,
                lineHeight: 1.2,
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
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.06)',
              border: `1px solid ${UI_COLORS.border}`,
              color: UI_COLORS.cream,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
