import { BookOpen, Images, Shirt, Wind } from 'lucide-react';
import { UIOverlayModal, useGameStore } from '../../store/gameStore';
import { UI_COLORS } from '../uiStyles';
import { useViewportLayout } from '../useViewportLayout';

const JOURNAL_TABS: ReadonlyArray<{
  modal: 'almanac' | 'polaroids' | 'windchimes' | 'wardrobe';
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
}> = [
  { modal: 'almanac', label: 'Địa danh & Mây', shortLabel: 'Địa danh', icon: <BookOpen size={14} /> },
  { modal: 'polaroids', label: 'Bảng ảnh chung', shortLabel: 'Bảng ảnh', icon: <Images size={14} /> },
  { modal: 'windchimes', label: 'Thẻ ước nguyện', shortLabel: 'Ước nguyện', icon: <Wind size={14} /> },
  { modal: 'wardrobe', label: 'Tủ đồ 3D', shortLabel: 'Tủ đồ 3D', icon: <Shirt size={14} /> },
];

export function JournalNavBar({
  active,
}: {
  active: 'almanac' | 'polaroids' | 'windchimes' | 'wardrobe';
}) {
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const { isCompactMobile } = useViewportLayout();

  return (
    <div
      role="tablist"
      aria-label="Mục lục Sổ tay Đà Lạt"
      style={{
        display: isCompactMobile ? 'grid' : 'flex',
        gridTemplateColumns: isCompactMobile ? 'repeat(2, minmax(0, 1fr))' : undefined,
        flexWrap: isCompactMobile ? undefined : 'wrap',
        gap: '6px',
        width: '100%',
        boxSizing: 'border-box',
        paddingBottom: '14px',
        marginBottom: '16px',
        borderBottom: `1px solid ${UI_COLORS.border}`,
      }}
    >
      {JOURNAL_TABS.map((tab) => {
        const isCurrent = tab.modal === active;
        return (
          <button
            key={tab.modal}
            type="button"
            role="tab"
            aria-selected={isCurrent}
            onClick={() => setActiveModal(tab.modal as UIOverlayModal)}
            className="dalat-glass-btn"
            style={{
              minHeight: '40px',
              minWidth: 0,
              boxSizing: 'border-box',
              padding: isCompactMobile ? '6px 8px' : '6px 12px',
              borderRadius: '999px',
              background: isCurrent
                ? 'rgba(243, 195, 130, 0.24)'
                : 'rgba(255, 255, 255, 0.06)',
              border: `1px solid ${isCurrent ? UI_COLORS.warmAmber : UI_COLORS.border}`,
              color: isCurrent ? UI_COLORS.warmAmber : UI_COLORS.cream,
              fontSize: isCompactMobile ? '11.5px' : '12px',
              fontWeight: isCurrent ? 600 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
            }}
          >
            <span style={{ display: 'inline-flex', flexShrink: 0 }}>{tab.icon}</span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {isCompactMobile ? tab.shortLabel : tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
