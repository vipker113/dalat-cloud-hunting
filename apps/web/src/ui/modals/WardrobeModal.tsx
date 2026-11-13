import { useEffect, useRef, useState } from 'react';
import { Check, Dices, RotateCw, Sparkles, X } from 'lucide-react';
import {
  AvatarGender,
  BAG_CATALOG,
  EYEWEAR_CATALOG,
  getCoatsForGender,
  HEADWEAR_CATALOG,
  HELD_PROP_CATALOG,
  HeldItemId,
  HIGHLAND_PALETTE,
  NECKWEAR_CATALOG,
  PlayerOutfit,
  resolveEffectiveBagStyle,
  resolveEffectiveEyewear,
  resolveEffectiveGender,
  resolveEffectiveNeckwear,
} from '@dalat/protocol';
import type { IMultiplayerController } from '../../network/types';
import { playTemporaryEmote } from '../../gameplay/interactions';
import { useNetController } from '../../gameplay/netBridge';
import { useGameStore } from '../../store/gameStore';
import {
  BagThumbnail,
  CoatThumbnail,
  ColorSwatchButton,
  CURATED_DALAT_PRESETS,
  EyewearThumbnail,
  HeadwearThumbnail,
  HeldPropThumbnail,
  NeckwearThumbnail,
  pickRandomHighlandLook,
  VisualChoiceCard,
} from '../GarmentAndPropThumbnail';
import { GLASS_MODAL_STYLE, GLASS_PILL_STYLE, UI_COLORS, UI_FONTS } from '../uiStyles';
import { useViewportLayout } from '../useViewportLayout';
import { JournalNavBar } from './JournalNavBar';

type WardrobeCategoryId = 'coats' | 'headwear' | 'neckwear' | 'eyewear' | 'bags' | 'props';

const CATEGORY_TABS: ReadonlyArray<{ id: WardrobeCategoryId; label: string; count: number }> = [
  { id: 'coats', label: 'Áo ấm', count: 6 },
  { id: 'headwear', label: 'Mũ & Tóc', count: HEADWEAR_CATALOG.length },
  { id: 'neckwear', label: 'Khăn cổ', count: NECKWEAR_CATALOG.length },
  { id: 'eyewear', label: 'Kính & Mặt', count: EYEWEAR_CATALOG.length },
  { id: 'bags', label: 'Balo & Túi', count: BAG_CATALOG.length },
  { id: 'props', label: 'Đạo cụ', count: HELD_PROP_CATALOG.length },
];

export function WardrobeModal({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);
  const vp = useViewportLayout();
  const displayName = useGameStore((s) => s.displayName);
  const outfit = useGameStore((s) => s.outfit);
  const heldItem = useGameStore((s) => s.heldItem);
  const previewYawOffset = useGameStore((s) => s.previewYawOffset);
  const isDraggingPreview = useGameStore((s) => s.isDraggingPreview);

  const setDisplayName = useGameStore((s) => s.setDisplayName);
  const updateOutfit = useGameStore((s) => s.updateOutfit);
  const setHeldItem = useGameStore((s) => s.setHeldItem);
  const setPreviewYawOffset = useGameStore((s) => s.setPreviewYawOffset);
  const resetPreviewStage = useGameStore((s) => s.resetPreviewStage);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const showToast = useGameStore((s) => s.showToast);

  const [nameDraft, setNameDraft] = useState(displayName);
  const [activeTab, setActiveTab] = useState<WardrobeCategoryId>('coats');
  const dialogRef = useRef<HTMLDivElement>(null);

  const isSideBySide = vp.isDesktopStage || vp.isLandscapeMobile;
  const studioGridCols = vp.isCompactMobile
    ? 'repeat(2, minmax(0, 1fr))'
    : 'repeat(3, minmax(0, 1fr))';

  // Move initial focus inside wardrobe dialog and restore focus when modal closes
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialogEl = dialogRef.current;
    if (dialogEl && !dialogEl.contains(previousFocus)) {
      const firstBtn = dialogEl.querySelector<HTMLElement>('button:not([disabled])');
      (firstBtn || dialogEl).focus({ preventScroll: true });
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

  useEffect(() => {
    const FOCUSABLE_SELECTOR =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        e.preventDefault();
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

  const effGender: AvatarGender = resolveEffectiveGender(outfit);
  const genderCoats = getCoatsForGender(effGender);
  const curatedPresets = CURATED_DALAT_PRESETS[effGender];
  const effNeckwear = resolveEffectiveNeckwear(outfit);
  const effEyewear = resolveEffectiveEyewear(outfit);
  const effBag = resolveEffectiveBagStyle(outfit);

  const applyPatch = (patch: Partial<PlayerOutfit>) => {
    updateOutfit(patch);
    const synced = useGameStore.getState().outfit;
    net.sendProfile(nameDraft.trim() || displayName, synced);
  };

  const selectHeldProp = (item: HeldItemId) => {
    setHeldItem(item);
    net.sendHeldItem(item);
  };

  const handleSelectTab = (tab: WardrobeCategoryId) => {
    setActiveTab(tab);
    const wrappedBackDiff = Math.abs(
      Math.atan2(Math.sin(previewYawOffset - Math.PI), Math.cos(previewYawOffset - Math.PI))
    );
    if (tab === 'bags') {
      if (wrappedBackDiff > 1.1) {
        setPreviewYawOffset(effBag === 'canvas_tote' ? -1.05 : 2.58);
      }
    } else if (wrappedBackDiff < 1.25) {
      setPreviewYawOffset(0);
    }
  };

  const handleRandomize = () => {
    const rnd = pickRandomHighlandLook(effGender);
    updateOutfit(rnd.outfit);
    setHeldItem(rnd.heldItem);
    const synced = useGameStore.getState().outfit;
    net.sendProfile(nameDraft.trim() || displayName, synced);
    net.sendHeldItem(rnd.heldItem);
  };

  const handleApplyPreset = (presetIndex: number) => {
    const preset = curatedPresets[presetIndex];
    if (!preset) return;
    updateOutfit(preset.outfit);
    setHeldItem(preset.heldItem);
    const synced = useGameStore.getState().outfit;
    net.sendProfile(nameDraft.trim() || displayName, synced);
    net.sendHeldItem(preset.heldItem);
  };

  const handleSaveAndClose = () => {
    const cleanName = nameDraft.trim().slice(0, 24) || displayName;
    setDisplayName(cleanName);
    net.sendProfile(cleanName, useGameStore.getState().outfit);
    showToast('🧣 Đã cập nhật trang phục săn mây của bạn!');
    setActiveModal('none');
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Tủ Đồ Áo Ấm Cao Nguyên"
      tabIndex={-1}
      className="dalat-full-viewport"
      style={{
        position: 'fixed',
        inset: 0,
        height: 'var(--dl-vh, 100vh)',
        maxWidth: '100vw',
        boxSizing: 'border-box',
        zIndex: 55,
        display: 'flex',
        flexDirection: isSideBySide ? 'row' : 'column',
        alignItems: isSideBySide ? 'center' : 'stretch',
        justifyContent: isSideBySide ? 'space-between' : 'flex-end',
        padding: vp.isLandscapeMobile
          ? 'calc(var(--dl-safe-top) + 8px) calc(var(--dl-safe-right) + 12px) calc(var(--dl-safe-bottom) + 8px) calc(var(--dl-safe-left) + 12px)'
          : isSideBySide
            ? '20px 24px'
            : vp.isCompactMobile
              ? 'calc(var(--dl-safe-top) + 6px) 6px calc(var(--dl-safe-bottom) + 6px)'
              : 'calc(var(--dl-safe-top) + 10px) 10px calc(var(--dl-safe-bottom) + 10px)',
        background: isSideBySide
          ? 'linear-gradient(90deg, rgba(10, 15, 26, 0.84) 0%, rgba(10, 15, 26, 0.28) 40%, rgba(10, 15, 26, 0.0) 64%)'
          : 'linear-gradient(0deg, rgba(10, 15, 26, 0.90) 0%, rgba(10, 15, 26, 0.24) 60%, rgba(10, 15, 26, 0.0) 100%)',
        pointerEvents: 'auto',
        cursor: isDraggingPreview ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
        outline: 'none',
        fontFamily: UI_FONTS.sans,
      }}
    >
      {/* LEFT / BOTTOM GLASS WARDROBE DRAWER WITH STICKY HEADER & STICKY FOOTER */}
      <div
        data-dalat-drawer="true"
        data-ui-overlay="true"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        style={{
          ...GLASS_MODAL_STYLE,
          background: vp.isMobileLayout ? UI_COLORS.glassMobileBg : UI_COLORS.glassBg,
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
          maxWidth: vp.isLandscapeMobile ? '420px' : isSideBySide ? '484px' : '100%',
          maxHeight: vp.isLandscapeMobile
            ? 'calc(var(--dl-vh, 100vh) - 16px)'
            : isSideBySide
              ? 'calc(var(--dl-vh, 100vh) - 40px)'
              : 'calc(var(--dl-vh, 100vh) * 0.66)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: vp.isCompactMobile ? '20px' : '24px',
          padding: vp.isCompactMobile
            ? '12px 10px'
            : vp.isLandscapeMobile
              ? '12px 14px'
              : isSideBySide
                ? '18px 20px 16px'
                : '14px 16px',
          pointerEvents: 'auto',
          cursor: 'default',
          touchAction: 'pan-y',
          userSelect: 'auto',
          animation: 'dalatFadeUp 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Sticky Drawer Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '8px',
            paddingBottom: '10px',
            marginBottom: '10px',
            borderBottom: `1px solid ${UI_COLORS.border}`,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              style={{
                fontFamily: UI_FONTS.serif,
                fontSize: vp.isCompactMobile ? '18px' : vp.isLandscapeMobile ? '19px' : '22px',
                fontWeight: 600,
                color: UI_COLORS.cream,
                lineHeight: 1.2,
                margin: 0,
              }}
            >
              Tủ Đồ Áo Ấm Cao Nguyên
            </h2>
            {!vp.isLandscapeMobile && (
              <p style={{ fontSize: '12px', color: UI_COLORS.mistText, marginTop: '3px', marginBottom: 0 }}>
                {vp.isTouchCapable
                  ? 'Đồng bộ 3D trực tiếp • Vuốt nhân vật để xoay 360°'
                  : 'Ảnh thẻ 3D đồng bộ 1:1 • Kéo chuột xoay 360° & cuộn zoom'}
              </p>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleRandomize}
              title="Phối ngẫu nhiên trang phục & phụ kiện Đà Lạt"
              aria-label="Phối ngẫu nhiên trang phục & phụ kiện Đà Lạt"
              className="dalat-glass-btn"
              style={{
                minHeight: '44px',
                padding: vp.isCompactMobile ? '6px 9px' : '6px 12px',
                borderRadius: '999px',
                background: 'rgba(243, 195, 130, 0.16)',
                border: '1px solid rgba(243, 195, 130, 0.42)',
                color: UI_COLORS.warmAmber,
                fontSize: '12px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                boxSizing: 'border-box',
              }}
            >
              <Dices size={14} />
              {!vp.isCompactMobile && <span>Ngẫu nhiên</span>}
            </button>

            <button
              type="button"
              aria-label="Đóng tủ đồ"
              onClick={() => setActiveModal('none')}
              className="dalat-glass-btn"
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.08)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.cream,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Scrollable Customization Body */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            paddingRight: '3px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {!vp.isLandscapeMobile && <JournalNavBar active="wardrobe" />}

          {/* Display Name */}
          <div>
            <label
              htmlFor="dalat-wardrobe-name"
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 500,
                color: UI_COLORS.mistText,
                marginBottom: '4px',
              }}
            >
              Tên hiển thị trên đồi
            </label>
            <input
              id="dalat-wardrobe-name"
              type="text"
              value={nameDraft}
              maxLength={24}
              onChange={(e) => setNameDraft(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                minHeight: '42px',
                padding: '8px 12px',
                borderRadius: '11px',
                background: 'rgba(10, 15, 25, 0.72)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.cream,
                fontSize: vp.isMobileLayout ? '16px' : '14px',
                outline: 'none',
              }}
            />
          </div>

          {/* Character Gender Selector (Nữ / Nam) — Preserves QA data-testid contract */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
              padding: '8px 10px',
              borderRadius: '13px',
              background: 'rgba(10, 15, 25, 0.56)',
              border: `1px solid ${UI_COLORS.border}`,
              boxSizing: 'border-box',
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: UI_COLORS.mistText,
                paddingLeft: '2px',
              }}
            >
              Dáng nhân vật
            </span>
            <div
              role="radiogroup"
              aria-label="Chọn giới tính nhân vật"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '6px',
                flex: vp.isCompactMobile ? '1 1 100%' : 1,
                minWidth: 0,
                maxWidth: vp.isCompactMobile ? '100%' : '276px',
                width: vp.isCompactMobile ? '100%' : undefined,
              }}
            >
              {(
                [
                  { id: 'female' as const, label: '♀ Nữ Lữ Khách' },
                  { id: 'male' as const, label: '♂ Nam Lữ Khách' },
                ]
              ).map((g) => {
                const active = effGender === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-testid={`wardrobe-gender-${g.id}`}
                    onClick={() => applyPatch({ gender: g.id })}
                    className="dalat-glass-btn"
                    style={{
                      minHeight: '40px',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      padding: '6px 8px',
                      borderRadius: '9px',
                      fontSize: '12px',
                      fontWeight: active ? 600 : 500,
                      background: active
                        ? 'rgba(243, 195, 130, 0.24)'
                        : 'rgba(255, 255, 255, 0.05)',
                      border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                    }}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {g.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4 Quick Curated Highland Outfit Presets */}
          <div>
            <div
              style={{
                fontSize: '12px',
                color: UI_COLORS.mistText,
                marginBottom: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <Sparkles size={13} style={{ color: UI_COLORS.warmAmber }} />
              <span>Bộ phối Đà Lạt gợi ý nhanh</span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '6px',
              }}
            >
              {curatedPresets.map((preset, idx) => {
                const isSelected =
                  outfit.coatStyle === preset.outfit.coatStyle &&
                  outfit.coatColor === preset.outfit.coatColor &&
                  heldItem === preset.heldItem;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyPreset(idx)}
                    className="dalat-glass-btn"
                    style={{
                      minHeight: '38px',
                      padding: '6px 10px',
                      borderRadius: '10px',
                      background: isSelected
                        ? 'rgba(243, 195, 130, 0.20)'
                        : 'rgba(255, 255, 255, 0.045)',
                      border: `1px solid ${isSelected ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: isSelected ? UI_COLORS.warmAmber : UI_COLORS.cream,
                      fontSize: '12px',
                      fontWeight: isSelected ? 600 : 500,
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                    }}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {preset.title}
                    </span>
                    <span
                      style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        background: preset.outfit.coatColor,
                        border: '1.5px solid rgba(255,255,255,0.65)',
                        flexShrink: 0,
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* 6 Category Filter Pills */}
          <div
            role="tablist"
            aria-label="Danh mục trang phục và phụ kiện"
            style={{
              display: 'grid',
              gridTemplateColumns: vp.isCompactMobile
                ? 'repeat(2, minmax(0, 1fr))'
                : 'repeat(3, minmax(0, 1fr))',
              gap: '6px',
            }}
          >
            {CATEGORY_TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleSelectTab(tab.id)}
                  className="dalat-glass-btn"
                  style={{
                    minHeight: '40px',
                    minWidth: 0,
                    boxSizing: 'border-box',
                    padding: '6px 8px',
                    borderRadius: '11px',
                    fontSize: '12px',
                    fontWeight: active ? 600 : 500,
                    background: active
                      ? 'rgba(243, 195, 130, 0.22)'
                      : 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                    color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '5px',
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tab.label}
                  </span>
                  <span
                    style={{
                      fontSize: '11.5px',
                      opacity: active ? 0.94 : 0.78,
                      fontFamily: UI_FONTS.mono,
                      flexShrink: 0,
                    }}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Active Category 3D Studio Cards Grid */}
          <div>
            {activeTab === 'coats' && (
              <div style={{ display: 'grid', gridTemplateColumns: studioGridCols, gap: '7px' }}>
                {genderCoats.map((c) => (
                  <VisualChoiceCard
                    key={c.id}
                    active={outfit.coatStyle === c.id}
                    label={c.title}
                    subtitle={c.desc}
                    thumbHeight={62}
                    onClick={() => applyPatch({ coatStyle: c.id })}
                    thumbnail={
                      <CoatThumbnail
                        styleId={c.id}
                        coatColor={outfit.coatColor}
                        scarfColor={outfit.scarfColor}
                        size={58}
                      />
                    }
                  />
                ))}
              </div>
            )}

            {activeTab === 'headwear' && (
              <div style={{ display: 'grid', gridTemplateColumns: studioGridCols, gap: '7px' }}>
                {HEADWEAR_CATALOG.map((h) => (
                  <VisualChoiceCard
                    key={h.id}
                    active={
                      outfit.headwear === h.id ||
                      (outfit.headwear === 'scarf_only' && h.id === 'none')
                    }
                    label={h.title}
                    subtitle={h.desc}
                    thumbHeight={60}
                    onClick={() => applyPatch({ headwear: h.id })}
                    thumbnail={
                      <HeadwearThumbnail
                        headwearId={h.id}
                        coatColor={outfit.coatColor}
                        scarfColor={outfit.scarfColor}
                        hairColor={outfit.hairColor}
                        gender={effGender}
                        size={56}
                      />
                    }
                  />
                ))}
              </div>
            )}

            {activeTab === 'neckwear' && (
              <div style={{ display: 'grid', gridTemplateColumns: studioGridCols, gap: '7px' }}>
                {NECKWEAR_CATALOG.map((n) => (
                  <VisualChoiceCard
                    key={n.id}
                    active={effNeckwear === n.id}
                    label={n.title}
                    subtitle={n.desc}
                    thumbHeight={60}
                    onClick={() =>
                      applyPatch({
                        neckwear: n.id,
                        ...(outfit.headwear === 'scarf_only' ? { headwear: 'none' } : {}),
                      })
                    }
                    thumbnail={
                      <NeckwearThumbnail
                        neckwearId={n.id}
                        scarfColor={outfit.scarfColor}
                        size={56}
                      />
                    }
                  />
                ))}
              </div>
            )}

            {activeTab === 'eyewear' && (
              <div style={{ display: 'grid', gridTemplateColumns: studioGridCols, gap: '7px' }}>
                {EYEWEAR_CATALOG.map((ey) => (
                  <VisualChoiceCard
                    key={ey.id}
                    active={effEyewear === ey.id}
                    label={ey.title}
                    subtitle={ey.desc}
                    thumbHeight={60}
                    onClick={() => applyPatch({ eyewear: ey.id })}
                    thumbnail={<EyewearThumbnail eyewearId={ey.id} size={56} />}
                  />
                ))}
              </div>
            )}

            {activeTab === 'bags' && (
              <div style={{ display: 'grid', gridTemplateColumns: studioGridCols, gap: '7px' }}>
                {BAG_CATALOG.map((bg) => (
                  <VisualChoiceCard
                    key={bg.id}
                    active={effBag === bg.id}
                    label={bg.title}
                    subtitle={bg.desc}
                    thumbHeight={60}
                    onClick={() => {
                      applyPatch({ bagStyle: bg.id, backpack: bg.id !== 'none' });
                      if (bg.id === 'canvas_tote') {
                        setPreviewYawOffset(-1.05);
                      } else if (bg.id !== 'none') {
                        const wrappedDiff = Math.abs(
                          Math.atan2(
                            Math.sin(previewYawOffset - Math.PI),
                            Math.cos(previewYawOffset - Math.PI)
                          )
                        );
                        if (wrappedDiff > 1.1) setPreviewYawOffset(2.58);
                      }
                    }}
                    thumbnail={
                      <BagThumbnail
                        bagId={bg.id}
                        coatColor={outfit.coatColor}
                        scarfColor={outfit.scarfColor}
                        size={56}
                      />
                    }
                  />
                ))}
              </div>
            )}

            {activeTab === 'props' && (
              <div style={{ display: 'grid', gridTemplateColumns: studioGridCols, gap: '7px' }}>
                {HELD_PROP_CATALOG.map((prop) => (
                  <VisualChoiceCard
                    key={prop.id}
                    active={heldItem === prop.id}
                    label={prop.title}
                    subtitle={prop.desc}
                    thumbHeight={60}
                    onClick={() => selectHeldProp(prop.id)}
                    thumbnail={<HeldPropThumbnail itemId={prop.id} size={56} />}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Accessible Highland Color Swatches (36px/42px hit targets + Checkmark) */}
          <SwatchGroup
            title="Màu áo khoác (12 sắc Đà Lạt)"
            colors={HIGHLAND_PALETTE.coats}
            selected={outfit.coatColor}
            isTouch={vp.isTouchCapable}
            onSelect={(coatColor) => applyPatch({ coatColor })}
          />
          <SwatchGroup
            title="Màu khăn & mũ len (10 sắc)"
            colors={HIGHLAND_PALETTE.scarves}
            selected={outfit.scarfColor}
            isTouch={vp.isTouchCapable}
            onSelect={(scarfColor) => applyPatch({ scarfColor })}
          />
          <SwatchGroup
            title="Màu tóc tự nhiên"
            colors={HIGHLAND_PALETTE.hair}
            selected={outfit.hairColor}
            isTouch={vp.isTouchCapable}
            onSelect={(hairColor) => applyPatch({ hairColor })}
          />
        </div>

        {/* Sticky Primary Save Footer */}
        <div
          style={{
            paddingTop: '10px',
            marginTop: '8px',
            borderTop: `1px solid ${UI_COLORS.border}`,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={handleSaveAndClose}
            className="dalat-glass-btn"
            style={{
              width: '100%',
              minHeight: '46px',
              padding: '10px 18px',
              borderRadius: '13px',
              background:
                'linear-gradient(135deg, rgba(226, 152, 86, 0.96), rgba(196, 112, 68, 0.96))',
              border: '1px solid rgba(255, 226, 182, 0.55)',
              color: '#171D2A',
              fontFamily: UI_FONTS.sans,
              fontSize: '14px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '7px',
            }}
          >
            <Check size={16} />
            <span>Hoàn tất trang phục</span>
          </button>
        </div>
      </div>

      {/* RIGHT 3D LIVE WARDROBE TURNTABLE CONTROLS */}
      {isSideBySide && (
        <div
          style={{
            flex: 1,
            alignSelf: 'stretch',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            alignItems: 'center',
            padding: '0 0 8px 16px',
            gap: '8px',
            pointerEvents: 'none',
          }}
        >
          <div
            data-ui-overlay="true"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '6px 12px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '12px',
              color: UI_COLORS.mistText,
              pointerEvents: 'auto',
              cursor: 'default',
            }}
          >
            <RotateCw size={13} style={{ color: UI_COLORS.warmAmber }} />
            {!vp.isLandscapeMobile && <span>Xoay góc nhìn:</span>}
            {[
              { label: 'Mặt trước', yaw: 0 },
              { label: 'Góc nghiêng', yaw: 0.72 },
              { label: 'Sau lưng / Balo', yaw: Math.PI },
            ].map((preset) => {
              const wrappedDiff = Math.atan2(
                Math.sin(previewYawOffset - preset.yaw),
                Math.cos(previewYawOffset - preset.yaw)
              );
              const active = Math.abs(wrappedDiff) < 0.28;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setPreviewYawOffset(preset.yaw)}
                  className="dalat-glass-btn"
                  style={{
                    minHeight: '34px',
                    padding: '4px 11px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    fontWeight: active ? 600 : 500,
                    background: active
                      ? 'rgba(243, 195, 130, 0.22)'
                      : 'rgba(255, 255, 255, 0.06)',
                    border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                    color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => playTemporaryEmote('cheers_cup', net, 3200)}
              className="dalat-glass-btn"
              style={{
                minHeight: '34px',
                padding: '4px 11px',
                borderRadius: '999px',
                fontSize: '12px',
                fontWeight: 600,
                background: 'rgba(243, 195, 130, 0.16)',
                border: `1px solid ${UI_COLORS.borderStrong}`,
                color: UI_COLORS.warmAmber,
              }}
            >
              🥂 Thử nâng ly
            </button>
            <button
              type="button"
              onClick={() => resetPreviewStage()}
              title="Đặt lại góc nhìn & độ phóng to"
              className="dalat-glass-btn"
              style={{
                minHeight: '34px',
                padding: '4px 11px',
                borderRadius: '999px',
                fontSize: '12px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.mistText,
              }}
            >
              Đặt lại
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SwatchGroup(props: {
  title: string;
  colors: readonly string[];
  selected: string;
  isTouch: boolean;
  onSelect: (hex: string) => void;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: '12px',
          fontWeight: 500,
          color: UI_COLORS.mistText,
          marginBottom: '4px',
        }}
      >
        {props.title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
        {props.colors.map((hex, i) => (
          <ColorSwatchButton
            key={hex}
            hex={hex}
            selected={props.selected === hex}
            label={`${props.title} #${i + 1}`}
            touchMode={props.isTouch}
            onClick={() => props.onSelect(hex)}
          />
        ))}
      </div>
    </div>
  );
}
