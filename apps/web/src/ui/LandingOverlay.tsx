import { FormEvent, useEffect, useState } from 'react';
import { CloudSun, Compass, Dices, RotateCw, Sparkles } from 'lucide-react';
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
  resolveEffectiveBagStyle,
  resolveEffectiveEyewear,
  resolveEffectiveGender,
  resolveEffectiveNeckwear,
} from '@dalat/protocol';
import type { IMultiplayerController } from '../network/types';
import { useNetController } from '../gameplay/netBridge';
import { useGameStore } from '../store/gameStore';
import {
  BagThumbnail,
  CoatThumbnail,
  EyewearThumbnail,
  HeadwearThumbnail,
  HeldPropThumbnail,
  NeckwearThumbnail,
  pickRandomHighlandLook,
  VisualChoiceCard,
} from './GarmentAndPropThumbnail';
import { GLASS_MODAL_STYLE, GLASS_PILL_STYLE, UI_COLORS, UI_FONTS } from './uiStyles';

type LandingTabId = 'coats' | 'headwear' | 'face_neck' | 'bags' | 'props';

const LANDING_TABS: ReadonlyArray<{ id: LandingTabId; label: string }> = [
  { id: 'coats', label: 'Áo ấm (6)' },
  { id: 'headwear', label: 'Mũ & Tóc (10)' },
  { id: 'face_neck', label: 'Khăn & Kính' },
  { id: 'bags', label: 'Balo & Túi (6)' },
  { id: 'props', label: 'Đạo cụ (11)' },
];

const QUICK_PREVIEW_PROPS: ReadonlyArray<HeldItemId> = [
  'soy_milk',
  'phin_coffee',
  'roasted_corn',
  'hydrangea_bouquet',
  'lantern',
];

export function LandingOverlay({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);
  const displayName = useGameStore((s) => s.displayName);
  const outfit = useGameStore((s) => s.outfit);
  const heldItem = useGameStore((s) => s.heldItem);
  const atmosphere = useGameStore((s) => s.atmosphere);
  const connected = useGameStore((s) => s.connected);
  const currentRoomCode = useGameStore((s) => s.roomCode);
  const previewYawOffset = useGameStore((s) => s.previewYawOffset);
  const isDraggingPreview = useGameStore((s) => s.isDraggingPreview);

  const setDisplayName = useGameStore((s) => s.setDisplayName);
  const updateOutfit = useGameStore((s) => s.updateOutfit);
  const setHeldItem = useGameStore((s) => s.setHeldItem);
  const setPreviewYawOffset = useGameStore((s) => s.setPreviewYawOffset);
  const resetPreviewStage = useGameStore((s) => s.resetPreviewStage);
  const enterWorld = useGameStore((s) => s.enterWorld);

  const [nameInput, setNameInput] = useState(displayName);
  const [activeTab, setActiveTab] = useState<LandingTabId>('coats');
  const [roomInput, setRoomInput] = useState(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') || '').trim().toUpperCase();
  });
  const [entering, setEntering] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 820 : true
  );

  useEffect(() => {
    setNameInput(displayName);
  }, [displayName]);

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

  const handleSelectGender = (gender: AvatarGender) => {
    updateOutfit({ gender });
  };

  const handleSelectTab = (tab: LandingTabId) => {
    setActiveTab(tab);
    const wrappedBackDiff = Math.abs(
      Math.atan2(Math.sin(previewYawOffset - Math.PI), Math.cos(previewYawOffset - Math.PI))
    );
    if (tab === 'bags') {
      if (wrappedBackDiff > 1.1) {
        setPreviewYawOffset(effBag === 'canvas_tote' ? -1.05 : 2.55);
      }
    } else if (wrappedBackDiff < 1.25) {
      setPreviewYawOffset(0);
    }
  };

  const handleRandomize = () => {
    const rnd = pickRandomHighlandLook(effGender);
    updateOutfit(rnd.outfit);
    setHeldItem(rnd.heldItem);
  };

  const handleEnter = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (entering) return;
    setEntering(true);

    const finalName = nameInput.trim().slice(0, 24) || 'Lữ Khách Sương Sớm';
    setDisplayName(finalName);

    const preferredRoom = roomInput.trim().toUpperCase();
    enterWorld();

    try {
      if (!connected) {
        await net.connect(preferredRoom || undefined);
      } else if (preferredRoom && preferredRoom !== currentRoomCode) {
        await net.switchChannel(preferredRoom);
      }
      net.sendProfile(finalName, useGameStore.getState().outfit);
      net.sendHeldItem(useGameStore.getState().heldItem);
    } catch {
      // Allow seamless offline/local exploration even if multiplayer server isn't reachable
    } finally {
      setEntering(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        flexDirection: isDesktop ? 'row' : 'column',
        alignItems: isDesktop ? 'center' : 'stretch',
        justifyContent: isDesktop ? 'space-between' : 'flex-end',
        padding: isDesktop ? '20px 26px' : '12px',
        background: isDesktop
          ? 'linear-gradient(90deg, rgba(10, 15, 26, 0.7) 0%, rgba(10, 15, 26, 0.24) 37%, rgba(10, 15, 26, 0.0) 60%)'
          : 'linear-gradient(0deg, rgba(10, 15, 26, 0.8) 0%, rgba(10, 15, 26, 0.16) 56%, rgba(10, 15, 26, 0.0) 100%)',
        pointerEvents: 'auto',
        cursor: isDraggingPreview ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {/* LEFT GLASS CARD: Identity & Full 3D Highland Outfit Customizer */}
      <form
        data-dalat-drawer="true"
        onSubmit={handleEnter}
        style={{
          ...GLASS_MODAL_STYLE,
          width: '100%',
          maxWidth: isDesktop ? '456px' : '100%',
          maxHeight: isDesktop ? 'calc(100vh - 40px)' : '56vh',
          overflowY: 'auto',
          borderRadius: '24px',
          padding: isDesktop ? '22px 22px 18px' : '16px',
          pointerEvents: 'auto',
          cursor: 'default',
          touchAction: 'pan-y',
          userSelect: 'auto',
          animation: 'dalatFadeUp 440ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Poetic Eyebrow + Randomize */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            marginBottom: '8px',
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              padding: '4px 10px',
              borderRadius: '999px',
              background: 'rgba(243, 195, 130, 0.12)',
              border: '1px solid rgba(243, 195, 130, 0.28)',
              color: UI_COLORS.warmAmber,
              fontSize: '10.5px',
              fontWeight: 500,
              letterSpacing: '0.04em',
            }}
          >
            <CloudSun size={13} strokeWidth={1.8} />
            <span>ĐA NGƯỜI CHƠI • CẦU ĐẤT 1,648M</span>
          </div>

          <button
            type="button"
            onClick={handleRandomize}
            className="dalat-glass-btn"
            style={{
              padding: '4px 10px',
              borderRadius: '999px',
              background: 'rgba(243, 195, 130, 0.14)',
              border: '1px solid rgba(243, 195, 130, 0.34)',
              color: UI_COLORS.warmAmber,
              fontSize: '11px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <Dices size={12} />
            <span>Phối ngẫu nhiên</span>
          </button>
        </div>

        <h1
          style={{
            fontFamily: UI_FONTS.serif,
            fontSize: isDesktop ? '30px' : '25px',
            fontWeight: 600,
            lineHeight: 1.12,
            letterSpacing: '-0.01em',
            color: UI_COLORS.cream,
            marginBottom: '5px',
          }}
        >
          Chạm Mây Đà Lạt
        </h1>

        <p
          style={{
            fontSize: '12px',
            lineHeight: 1.45,
            color: UI_COLORS.mistText,
            marginBottom: '10px',
          }}
        >
          46+ trang phục & phụ kiện Đà Lạt render 3D 1:1 bên hiên gỗ Mơ Sương trước khi bước vào
          biển mây bình minh.
        </p>

        {/* Live World Weather & Telemetry Line */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '7px 11px',
            borderRadius: '11px',
            background: 'rgba(10, 15, 25, 0.46)',
            border: `1px solid ${UI_COLORS.border}`,
            fontFamily: UI_FONTS.mono,
            fontSize: '11px',
            color: '#F5DEC0',
            marginBottom: '11px',
            flexWrap: 'wrap',
          }}
        >
          <Compass size={13} strokeWidth={1.8} style={{ color: UI_COLORS.warmAmber, flexShrink: 0 }} />
          <span>
            Đồi Cầu Đất • {atmosphere.timeLabel} • {atmosphere.temperatureC.toFixed(1)}°C •{' '}
            {atmosphere.weatherLabel}
          </span>
        </div>

        {/* Display Name + Optional Room Code */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.35fr 0.85fr',
            gap: '8px',
            marginBottom: '11px',
          }}
        >
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '10.5px',
                color: UI_COLORS.mistText,
                marginBottom: '4px',
              }}
            >
              Tên lữ khách của bạn
            </label>
            <input
              type="text"
              value={nameInput}
              maxLength={24}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Ví dụ: An Nhiên"
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '10px',
                background: 'rgba(10, 15, 25, 0.55)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.cream,
                fontSize: '12.5px',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: '10.5px',
                color: UI_COLORS.mistText,
                marginBottom: '4px',
              }}
            >
              Mã phòng (tùy chọn)
            </label>
            <input
              type="text"
              value={roomInput}
              maxLength={14}
              onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
              placeholder="MAY-01"
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '10px',
                background: 'rgba(10, 15, 25, 0.55)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.warmAmber,
                fontFamily: UI_FONTS.mono,
                fontSize: '12px',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Character Gender Selector (Nữ / Nam) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            padding: '6px 8px',
            borderRadius: '13px',
            background: 'rgba(10, 15, 25, 0.5)',
            border: `1px solid ${UI_COLORS.border}`,
            marginBottom: '9px',
          }}
        >
          <span
            style={{
              fontSize: '11px',
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
              gap: '5px',
              flex: 1,
              maxWidth: '248px',
            }}
          >
            {(
              [
                { id: 'female' as const, label: '♀ Nữ Lữ Khách', sub: '6 áo nữ' },
                { id: 'male' as const, label: '♂ Nam Lữ Khách', sub: '6 áo nam' },
              ]
            ).map((g) => {
              const active = effGender === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`landing-gender-${g.id}`}
                  onClick={() => handleSelectGender(g.id)}
                  className="dalat-glass-btn"
                  style={{
                    padding: '5px 9px',
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
                    gap: '4px',
                  }}
                >
                  <span>{g.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Category Tabs */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '5px',
            marginBottom: '9px',
          }}
        >
          {LANDING_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectTab(tab.id)}
                className="dalat-glass-btn"
                style={{
                  padding: '5px 9px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: active ? 600 : 500,
                  background: active
                    ? 'rgba(243, 195, 130, 0.22)'
                    : 'rgba(255, 255, 255, 0.045)',
                  border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                  color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 1:1 3D Studio Cards Grid */}
        <div
          style={{
            maxHeight: isDesktop ? '210px' : '176px',
            overflowY: 'auto',
            paddingRight: '2px',
            marginBottom: '11px',
          }}
        >
          {activeTab === 'coats' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {genderCoats.map((item) => (
                <VisualChoiceCard
                  key={item.id}
                  active={outfit.coatStyle === item.id}
                  label={item.shortLabel}
                  title={`${item.title} — ${item.desc}`}
                  compact
                  thumbHeight={56}
                  onClick={() => updateOutfit({ coatStyle: item.id })}
                  thumbnail={
                    <CoatThumbnail
                      styleId={item.id}
                      coatColor={outfit.coatColor}
                      scarfColor={outfit.scarfColor}
                      size={52}
                    />
                  }
                />
              ))}
            </div>
          )}

          {activeTab === 'headwear' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              {HEADWEAR_CATALOG.map((item) => (
                <VisualChoiceCard
                  key={item.id}
                  active={outfit.headwear === item.id}
                  label={item.shortLabel}
                  title={`${item.title} — ${item.desc}`}
                  compact
                  thumbHeight={52}
                  onClick={() => updateOutfit({ headwear: item.id })}
                  thumbnail={
                    <HeadwearThumbnail
                      headwearId={item.id}
                      coatColor={outfit.coatColor}
                      scarfColor={outfit.scarfColor}
                      hairColor={outfit.hairColor}
                      gender={effGender}
                      size={48}
                    />
                  }
                />
              ))}
            </div>
          )}

          {activeTab === 'face_neck' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '5px' }}>
                {NECKWEAR_CATALOG.map((n) => (
                  <VisualChoiceCard
                    key={n.id}
                    active={effNeckwear === n.id}
                    label={n.shortLabel}
                    title={`${n.title} — ${n.desc}`}
                    compact
                    thumbHeight={48}
                    onClick={() => updateOutfit({ neckwear: n.id })}
                    thumbnail={
                      <NeckwearThumbnail
                        neckwearId={n.id}
                        scarfColor={outfit.scarfColor}
                        size={44}
                      />
                    }
                  />
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {EYEWEAR_CATALOG.map((ey) => (
                  <VisualChoiceCard
                    key={ey.id}
                    active={effEyewear === ey.id}
                    label={ey.shortLabel}
                    title={`${ey.title} — ${ey.desc}`}
                    compact
                    thumbHeight={48}
                    onClick={() => updateOutfit({ eyewear: ey.id })}
                    thumbnail={<EyewearThumbnail eyewearId={ey.id} size={44} />}
                  />
                ))}
              </div>
            </div>
          )}

          {activeTab === 'bags' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {BAG_CATALOG.map((bg) => (
                <VisualChoiceCard
                  key={bg.id}
                  active={effBag === bg.id}
                  label={bg.shortLabel}
                  subtitle={bg.desc}
                  compact
                  thumbHeight={52}
                  onClick={() => {
                    updateOutfit({ bagStyle: bg.id, backpack: bg.id !== 'none' });
                    if (bg.id === 'canvas_tote') {
                      setPreviewYawOffset(-1.05);
                    } else if (bg.id !== 'none') {
                      setPreviewYawOffset(2.55);
                    }
                  }}
                  thumbnail={
                    <BagThumbnail
                      bagId={bg.id}
                      coatColor={outfit.coatColor}
                      scarfColor={outfit.scarfColor}
                      size={48}
                    />
                  }
                />
              ))}
            </div>
          )}

          {activeTab === 'props' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              {HELD_PROP_CATALOG.map((prop) => (
                <VisualChoiceCard
                  key={prop.id}
                  active={heldItem === prop.id}
                  label={prop.shortLabel}
                  title={`${prop.title} — ${prop.desc}`}
                  compact
                  thumbHeight={50}
                  onClick={() => setHeldItem(prop.id)}
                  thumbnail={<HeldPropThumbnail itemId={prop.id} size={46} />}
                />
              ))}
            </div>
          )}
        </div>

        {/* Coat, Scarf & Hair Color Swatches */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '10px',
            marginBottom: '10px',
          }}
        >
          <div>
            <div style={{ fontSize: '10.5px', color: UI_COLORS.mistText, marginBottom: '5px' }}>
              Màu áo khoác
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4.5px' }}>
              {HIGHLAND_PALETTE.coats.map((hex) => {
                const selected = outfit.coatColor === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Màu áo ${hex}`}
                    onClick={() => updateOutfit({ coatColor: hex })}
                    style={{
                      width: '19px',
                      height: '19px',
                      borderRadius: '50%',
                      background: hex,
                      cursor: 'pointer',
                      border: selected ? '2px solid #FFF8EB' : '1px solid rgba(255,255,255,0.25)',
                      boxShadow: selected ? '0 0 0 2px rgba(243,195,130,0.55)' : 'none',
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '10.5px', color: UI_COLORS.mistText, marginBottom: '5px' }}>
              Màu khăn & mũ
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4.5px' }}>
              {HIGHLAND_PALETTE.scarves.map((hex) => {
                const selected = outfit.scarfColor === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Màu khăn ${hex}`}
                    onClick={() => updateOutfit({ scarfColor: hex })}
                    style={{
                      width: '19px',
                      height: '19px',
                      borderRadius: '50%',
                      background: hex,
                      cursor: 'pointer',
                      border: selected ? '2px solid #FFF8EB' : '1px solid rgba(255,255,255,0.25)',
                      boxShadow: selected ? '0 0 0 2px rgba(243,195,130,0.55)' : 'none',
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Hair Color Row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            marginBottom: '12px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '10.5px', color: UI_COLORS.mistText }}>Màu tóc tự nhiên:</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            {HIGHLAND_PALETTE.hair.map((hex) => {
              const selected = outfit.hairColor === hex;
              return (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Màu tóc ${hex}`}
                  onClick={() => updateOutfit({ hairColor: hex })}
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: hex,
                    cursor: 'pointer',
                    border: selected ? '2px solid #FFF8EB' : '1px solid rgba(255,255,255,0.25)',
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Warm Entry CTA Button */}
        <button
          type="submit"
          disabled={entering}
          className="dalat-glass-btn"
          style={{
            width: '100%',
            padding: '11px 18px',
            borderRadius: '14px',
            border: '1px solid rgba(255, 226, 182, 0.55)',
            background:
              'linear-gradient(135deg, rgba(226, 152, 86, 0.94) 0%, rgba(196, 112, 68, 0.94) 100%)',
            color: '#161B26',
            fontFamily: UI_FONTS.sans,
            fontSize: '14px',
            fontWeight: 600,
            letterSpacing: '0.01em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            boxShadow: '0 10px 28px rgba(218, 138, 76, 0.34)',
          }}
        >
          <Sparkles size={16} strokeWidth={2} />
          <span>{entering ? 'Đang bước vào sương sớm...' : 'Bước Vào Sương Sớm'}</span>
        </button>

        <div
          style={{
            marginTop: '8px',
            textAlign: 'center',
            fontSize: '10.5px',
            color: UI_COLORS.mutedText,
          }}
        >
          WASD di chuyển • [G/H] Chào & Cụng ly ấm khi gặp bạn mới • [P] Máy ảnh • [E] Tương tác
        </div>
      </form>

      {/* RIGHT 3D LIVE CHARACTER PREVIEW STAGE CONTROLS */}
      {isDesktop && (
        <div
          style={{
            flex: 1,
            alignSelf: 'stretch',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 0 4px 20px',
            pointerEvents: 'none',
          }}
        >
          {/* Floating Live Character Nameplate Pill at Top of Right Stage */}
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '6px 15px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: UI_COLORS.cream,
              pointerEvents: 'auto',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: '#82D69E',
                boxShadow: '0 0 8px rgba(130, 214, 158, 0.75)',
              }}
            />
            <span style={{ fontWeight: 600, color: UI_COLORS.warmAmber }}>
              {nameInput.trim() || displayName}
            </span>
            <span style={{ opacity: 0.4 }}>•</span>
            <span style={{ fontSize: '11px', color: UI_COLORS.mistText }}>
              Xem trước 3D trực tiếp
            </span>
          </div>

          {/* Bottom Turntable & Hand-Prop Preview Bar */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '7px',
              pointerEvents: 'none',
            }}
          >
            {/* Hand-Prop 3D Studio Preview Selector */}
            <div
              style={{
                ...GLASS_PILL_STYLE,
                borderRadius: '18px',
                padding: '6px 8px',
                display: 'grid',
                gridTemplateColumns: `repeat(${QUICK_PREVIEW_PROPS.length}, minmax(84px, 1fr))`,
                gap: '6px',
                pointerEvents: 'auto',
                cursor: 'default',
              }}
            >
              {QUICK_PREVIEW_PROPS.map((pid) => {
                const meta = HELD_PROP_CATALOG.find((m) => m.id === pid)!;
                return (
                  <VisualChoiceCard
                    key={pid}
                    active={heldItem === pid}
                    label={meta.shortLabel}
                    compact
                    thumbHeight={40}
                    onClick={() => setHeldItem(pid)}
                    thumbnail={<HeldPropThumbnail itemId={pid} size={38} />}
                  />
                );
              })}
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
        </div>
      )}
    </div>
  );
}
