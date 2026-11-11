import { useEffect, useState } from 'react';
import { Check, Dices, RotateCw, X } from 'lucide-react';
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
  EyewearThumbnail,
  HeadwearThumbnail,
  HeldPropThumbnail,
  NeckwearThumbnail,
  pickRandomHighlandLook,
  VisualChoiceCard,
} from '../GarmentAndPropThumbnail';
import { GLASS_MODAL_STYLE, GLASS_PILL_STYLE, UI_COLORS, UI_FONTS } from '../uiStyles';

type WardrobeCategoryId = 'coats' | 'headwear' | 'neckwear' | 'eyewear' | 'bags' | 'props';

const CATEGORY_TABS: ReadonlyArray<{ id: WardrobeCategoryId; label: string; count: number }> = [
  { id: 'coats', label: 'Áo ấm', count: 6 },
  { id: 'headwear', label: 'Mũ & Tóc', count: HEADWEAR_CATALOG.length },
  { id: 'neckwear', label: 'Khăn cổ', count: NECKWEAR_CATALOG.length },
  { id: 'eyewear', label: 'Kính & Mặt', count: EYEWEAR_CATALOG.length },
  { id: 'bags', label: 'Balo & Túi', count: BAG_CATALOG.length },
  { id: 'props', label: 'Đạo cụ', count: HELD_PROP_CATALOG.length },
];

const QUICK_STAGE_PROP_IDS: ReadonlyArray<HeldItemId> = [
  'soy_milk',
  'phin_coffee',
  'roasted_corn',
  'hydrangea_bouquet',
  'lantern',
  'sparkler',
];

export function WardrobeModal({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);
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
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 820 : true
  );

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 820);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const effGender: AvatarGender = resolveEffectiveGender(outfit);
  const genderCoats = getCoatsForGender(effGender);
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

  const handleSaveAndClose = () => {
    const cleanName = nameDraft.trim().slice(0, 24) || displayName;
    setDisplayName(cleanName);
    net.sendProfile(cleanName, useGameStore.getState().outfit);
    showToast('🧣 Đã cập nhật trang phục săn mây của bạn!');
    setActiveModal('none');
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 55,
        display: 'flex',
        flexDirection: isDesktop ? 'row' : 'column',
        alignItems: isDesktop ? 'center' : 'stretch',
        justifyContent: isDesktop ? 'space-between' : 'flex-end',
        padding: isDesktop ? '20px 24px' : '12px',
        background: isDesktop
          ? 'linear-gradient(90deg, rgba(10, 15, 26, 0.74) 0%, rgba(10, 15, 26, 0.24) 38%, rgba(10, 15, 26, 0.0) 60%)'
          : 'linear-gradient(0deg, rgba(10, 15, 26, 0.82) 0%, rgba(10, 15, 26, 0.16) 56%, rgba(10, 15, 26, 0.0) 100%)',
        pointerEvents: 'auto',
        cursor: isDraggingPreview ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
        fontFamily: UI_FONTS.sans,
      }}
    >
      {/* LEFT GLASS WARDROBE DRAWER */}
      <div
        data-dalat-drawer="true"
        style={{
          ...GLASS_MODAL_STYLE,
          width: '100%',
          maxWidth: isDesktop ? '474px' : '100%',
          maxHeight: isDesktop ? 'calc(100vh - 40px)' : '58vh',
          overflowY: 'auto',
          borderRadius: '24px',
          padding: isDesktop ? '20px 22px 18px' : '16px',
          pointerEvents: 'auto',
          cursor: 'default',
          touchAction: 'pan-y',
          userSelect: 'auto',
          animation: 'dalatFadeUp 240ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Drawer Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '10px',
            marginBottom: '13px',
            paddingBottom: '11px',
            borderBottom: `1px solid ${UI_COLORS.border}`,
          }}
        >
          <div>
            <h2
              style={{
                fontFamily: UI_FONTS.serif,
                fontSize: '23px',
                fontWeight: 600,
                color: UI_COLORS.cream,
                lineHeight: 1.18,
              }}
            >
              Tủ Đồ Áo Ấm Cao Nguyên
            </h2>
            <p style={{ fontSize: '11.5px', color: UI_COLORS.mistText, marginTop: '3px' }}>
              Ảnh thẻ 3D đồng bộ 1:1 với nhân vật • Kéo chuột xoay 360° & cuộn zoom
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleRandomize}
              title="Phối ngẫu nhiên trang phục & phụ kiện Đà Lạt"
              className="dalat-glass-btn"
              style={{
                padding: '6px 10px',
                borderRadius: '999px',
                background: 'rgba(243, 195, 130, 0.14)',
                border: '1px solid rgba(243, 195, 130, 0.36)',
                color: UI_COLORS.warmAmber,
                fontSize: '11px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <Dices size={13} />
              <span>Ngẫu nhiên</span>
            </button>

            <button
              type="button"
              aria-label="Đóng tủ đồ"
              onClick={() => setActiveModal('none')}
              className="dalat-glass-btn"
              style={{
                width: '31px',
                height: '31px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.06)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.cream,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
          {/* Display Name */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                color: UI_COLORS.mistText,
                marginBottom: '4px',
              }}
            >
              Tên hiển thị trên đồi
            </label>
            <input
              type="text"
              value={nameDraft}
              maxLength={24}
              onChange={(e) => setNameDraft(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 11px',
                borderRadius: '11px',
                background: 'rgba(10, 15, 25, 0.55)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.cream,
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>

          {/* Character Gender Selector (Nữ / Nam) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              padding: '7px 9px',
              borderRadius: '13px',
              background: 'rgba(10, 15, 25, 0.5)',
              border: `1px solid ${UI_COLORS.border}`,
            }}
          >
            <span
              style={{
                fontSize: '11.5px',
                fontWeight: 600,
                color: UI_COLORS.mistText,
                paddingLeft: '4px',
              }}
            >
              Giới tính nhân vật
            </span>
            <div
              role="radiogroup"
              aria-label="Chọn giới tính nhân vật"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '6px',
                flex: 1,
                maxWidth: '256px',
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
                      padding: '6px 10px',
                      borderRadius: '9px',
                      fontSize: '11.5px',
                      fontWeight: active ? 600 : 500,
                      background: active
                        ? 'rgba(243, 195, 130, 0.24)'
                        : 'rgba(255, 255, 255, 0.04)',
                      border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px',
                    }}
                  >
                    <span>{g.label}</span>
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
              gridTemplateColumns: 'repeat(3, 1fr)',
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
                    padding: '6px 8px',
                    borderRadius: '11px',
                    fontSize: '11.5px',
                    fontWeight: active ? 600 : 500,
                    background: active
                      ? 'rgba(243, 195, 130, 0.22)'
                      : 'rgba(255, 255, 255, 0.045)',
                    border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                    color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '5px',
                  }}
                >
                  <span>{tab.label}</span>
                  <span
                    style={{
                      fontSize: '10px',
                      opacity: active ? 0.92 : 0.55,
                      fontFamily: UI_FONTS.mono,
                    }}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Active Category 3D Studio Cards Grid */}
          <div
            style={{
              maxHeight: isDesktop ? '326px' : '215px',
              overflowY: 'auto',
              paddingRight: '2px',
            }}
          >
            {activeTab === 'coats' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '7px' }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '7px' }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '7px' }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '7px' }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '7px' }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '7px' }}>
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

          {/* Expanded Highland Color Swatches */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <SwatchGroup
              title="Màu áo khoác (12 sắc)"
              colors={HIGHLAND_PALETTE.coats}
              selected={outfit.coatColor}
              onSelect={(coatColor) => applyPatch({ coatColor })}
            />
            <SwatchGroup
              title="Màu khăn & mũ (10 sắc)"
              colors={HIGHLAND_PALETTE.scarves}
              selected={outfit.scarfColor}
              onSelect={(scarfColor) => applyPatch({ scarfColor })}
            />
          </div>

          <SwatchGroup
            title="Màu tóc tự nhiên"
            colors={HIGHLAND_PALETTE.hair}
            selected={outfit.hairColor}
            onSelect={(hairColor) => applyPatch({ hairColor })}
          />

          {/* Save & Close */}
          <div style={{ paddingTop: '2px' }}>
            <button
              type="button"
              onClick={handleSaveAndClose}
              className="dalat-glass-btn"
              style={{
                width: '100%',
                padding: '10px 18px',
                borderRadius: '13px',
                background:
                  'linear-gradient(135deg, rgba(226, 152, 86, 0.94), rgba(196, 112, 68, 0.94))',
                border: '1px solid rgba(255, 226, 182, 0.5)',
                color: '#171D2A',
                fontFamily: UI_FONTS.sans,
                fontSize: '13px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Check size={15} />
              <span>Hoàn tất trang phục</span>
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT 3D LIVE WARDROBE TURNTABLE CONTROLS */}
      {isDesktop && (
        <div
          style={{
            flex: 1,
            alignSelf: 'stretch',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            alignItems: 'center',
            padding: '0 0 8px 20px',
            gap: '8px',
            pointerEvents: 'none',
          }}
        >
          {/* Prop & Pose Visual Preview Row */}
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '18px',
              padding: '6px 9px',
              display: 'flex',
              alignItems: 'stretch',
              gap: '6px',
              pointerEvents: 'auto',
              cursor: 'default',
            }}
          >
            {QUICK_STAGE_PROP_IDS.map((pid) => {
              const meta = HELD_PROP_CATALOG.find((m) => m.id === pid)!;
              return (
                <div key={pid} style={{ width: '92px' }}>
                  <VisualChoiceCard
                    active={heldItem === pid}
                    label={meta.shortLabel}
                    compact
                    thumbHeight={40}
                    onClick={() => selectHeldProp(pid)}
                    thumbnail={<HeldPropThumbnail itemId={pid} size={38} />}
                  />
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => playTemporaryEmote('cheers_cup', net, 3200)}
              className="dalat-glass-btn"
              style={{
                padding: '6px 12px',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: 600,
                background: 'rgba(243, 195, 130, 0.14)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.warmAmber,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <span style={{ fontSize: '18px', lineHeight: 1 }}>🥂</span>
              <span>Thử nâng ly</span>
            </button>
          </div>

          {/* 360° Turntable Angle Presets & Pan/Zoom Hint */}
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '5px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: UI_COLORS.mistText,
              pointerEvents: 'auto',
              cursor: 'default',
            }}
          >
            <RotateCw size={12} style={{ color: UI_COLORS.warmAmber }} />
            <span>Kéo chuột / vuốt xoay 360° • Cuộn zoom:</span>
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
                    padding: '3px 9px',
                    borderRadius: '999px',
                    fontSize: '11px',
                    background: active
                      ? 'rgba(243, 195, 130, 0.22)'
                      : 'rgba(255, 255, 255, 0.05)',
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
              onClick={() => resetPreviewStage()}
              title="Đặt lại góc nhìn & độ phóng to (hoặc nhấp đúp lên nhân vật)"
              className="dalat-glass-btn"
              style={{
                padding: '3px 9px',
                borderRadius: '999px',
                fontSize: '11px',
                background: 'rgba(255, 255, 255, 0.05)',
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
  onSelect: (hex: string) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: '11px', color: UI_COLORS.mistText, marginBottom: '5px' }}>
        {props.title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
        {props.colors.map((hex) => {
          const active = props.selected === hex;
          return (
            <button
              key={hex}
              type="button"
              onClick={() => props.onSelect(hex)}
              style={{
                width: '21px',
                height: '21px',
                borderRadius: '50%',
                background: hex,
                cursor: 'pointer',
                border: active ? '2.5px solid #FFF8EB' : '1px solid rgba(255,255,255,0.24)',
                boxShadow: active ? '0 0 0 2px rgba(243,195,130,0.6)' : 'none',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
