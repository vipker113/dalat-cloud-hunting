import { FormEvent, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, CloudSun, Compass, Dices, RotateCw, SlidersHorizontal, Sparkles } from 'lucide-react';
import {
  AvatarGender,
  BAG_CATALOG,
  EYEWEAR_CATALOG,
  getCoatsForGender,
  HEADWEAR_CATALOG,
  HELD_PROP_CATALOG,
  HIGHLAND_PALETTE,
  LANDMARK_LIST,
  NECKWEAR_CATALOG,
  normalizeRoomCode,
  resolveEffectiveBagStyle,
  resolveEffectiveEyewear,
  resolveEffectiveGender,
  resolveEffectiveNeckwear,
  ROOM_CODE_REGEX,
} from '@dalat/protocol';
import type { IMultiplayerController } from '../network/types';
import { useNetController } from '../gameplay/netBridge';
import { useGameStore } from '../store/gameStore';
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
  prewarmHudPropThumbnails,
  VisualChoiceCard,
} from './GarmentAndPropThumbnail';
import { GLASS_MODAL_STYLE, GLASS_PILL_STYLE, UI_COLORS, UI_FONTS } from './uiStyles';
import { useViewportLayout } from './useViewportLayout';

type LandingTabId = 'coats' | 'headwear' | 'face_neck' | 'bags' | 'props';

const LANDING_TABS: ReadonlyArray<{ id: LandingTabId; label: string }> = [
  { id: 'coats', label: 'Áo ấm (6)' },
  { id: 'headwear', label: 'Mũ & Tóc (10)' },
  { id: 'face_neck', label: 'Khăn & Kính' },
  { id: 'bags', label: 'Balo & Túi (6)' },
  { id: 'props', label: 'Đạo cụ (11)' },
];

export function LandingOverlay({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);
  const { isDesktopStage, isLandscapeMobile, isMobileLayout, isCompactMobile, isTouchCapable } =
    useViewportLayout();

  const displayName = useGameStore((s) => s.displayName);
  const outfit = useGameStore((s) => s.outfit);
  const heldItem = useGameStore((s) => s.heldItem);
  const timeLabel = useGameStore((s) => s.atmosphere.timeLabel);
  const tempLabel = useGameStore((s) => s.atmosphere.temperatureC.toFixed(1));
  const weatherLabel = useGameStore((s) => s.atmosphere.weatherLabel);
  const connected = useGameStore((s) => s.connected);
  const currentRoomCode = useGameStore((s) => s.roomCode);
  const previewYawOffset = useGameStore((s) => s.previewYawOffset);
  const isDraggingPreview = useGameStore((s) => s.isDraggingPreview);
  const visitCount = useGameStore((s) => s.visitCount);
  const discoveredCount = useGameStore((s) =>
    LANDMARK_LIST.reduce((acc, lm) => acc + (s.discoveredLandmarks[lm.id] ? 1 : 0), 0)
  );

  const setDisplayName = useGameStore((s) => s.setDisplayName);
  const updateOutfit = useGameStore((s) => s.updateOutfit);
  const setHeldItem = useGameStore((s) => s.setHeldItem);
  const setPreviewYawOffset = useGameStore((s) => s.setPreviewYawOffset);
  const resetPreviewStage = useGameStore((s) => s.resetPreviewStage);
  const enterWorld = useGameStore((s) => s.enterWorld);
  const showToast = useGameStore((s) => s.showToast);

  const [nameInput, setNameInput] = useState(displayName);
  const [studioExpanded, setStudioExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<LandingTabId>('coats');
  const [invitedFromUrl] = useState(() => {
    if (typeof window === 'undefined') return false;
    return Boolean((new URLSearchParams(window.location.search).get('room') || '').trim());
  });
  const [roomInput, setRoomInput] = useState(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get('room') || '').trim();
    return normalizeRoomCode(raw) || raw.toUpperCase();
  });
  const [roomValidationHint, setRoomValidationHint] = useState<string | null>(null);
  const [entering] = useState(false);
  const enteringRef = useRef(false);

  useEffect(() => {
    setNameInput(displayName);
  }, [displayName]);

  useEffect(() => {
    prewarmHudPropThumbnails();
  }, []);

  const effGender: AvatarGender = resolveEffectiveGender(outfit);
  const genderCoats = getCoatsForGender(effGender);
  const effNeckwear = resolveEffectiveNeckwear(outfit);
  const effEyewear = resolveEffectiveEyewear(outfit);
  const effBag = resolveEffectiveBagStyle(outfit);
  const curatedPresets = CURATED_DALAT_PRESETS[effGender];

  const sideBySide = isDesktopStage || isLandscapeMobile;

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
    if (enteringRef.current) return;

    const rawRoom = roomInput.trim();
    let normalizedRoom = '';
    if (rawRoom.length > 0) {
      normalizedRoom = normalizeRoomCode(rawRoom);
      if (/[^A-Za-z0-9-]/.test(rawRoom) || !ROOM_CODE_REGEX.test(normalizedRoom)) {
        setRoomValidationHint(
          'Mã phòng cần từ 3–14 ký tự chữ, số hoặc dấu gạch ngang (VD: MAY-01).'
        );
        return;
      }
    }
    enteringRef.current = true;
    const finalName = nameInput.trim().slice(0, 24) || 'Lữ Khách Sương Sớm';
    if (finalName !== displayName) {
      setDisplayName(finalName);
    }

    enterWorld();

    window.setTimeout(() => {
      void (async () => {
        try {
          if (!connected) {
            await net.connect(normalizedRoom || undefined);
          } else if (normalizedRoom && normalizedRoom !== currentRoomCode) {
            const res = await net.switchChannel(normalizedRoom);
            if (res?.ok === false) {
              showToast(`⚠️ ${res.error || 'Không thể chuyển sang kênh này lúc này.'}`);
            } else {
              showToast(`✓ Đã chuyển sang kênh ${res?.roomCode || normalizedRoom}!`);
            }
          }
          net.sendProfile(finalName, useGameStore.getState().outfit);
          net.sendHeldItem(useGameStore.getState().heldItem);
        } catch {
          // Allow seamless offline/local exploration even if multiplayer server isn't reachable
        } finally {
          enteringRef.current = false;
        }
      })();
    }, 32);
  };

  return (
    <div
      className="dalat-full-viewport"
      style={{
        position: 'fixed',
        inset: 0,
        height: 'var(--dl-vh, 100vh)',
        maxWidth: '100vw',
        overflow: 'hidden',
        boxSizing: 'border-box',
        zIndex: 60,
        display: 'flex',
        flexDirection: sideBySide ? 'row' : 'column',
        alignItems: sideBySide ? 'center' : 'stretch',
        justifyContent: sideBySide ? 'space-between' : 'flex-end',
        padding: isDesktopStage
          ? '20px 26px'
          : isLandscapeMobile
            ? '10px 16px'
            : isCompactMobile
              ? '8px 8px max(10px, env(safe-area-inset-bottom, 10px))'
              : '10px 12px max(12px, env(safe-area-inset-bottom, 12px))',
        background: sideBySide
          ? 'linear-gradient(90deg, rgba(10, 15, 26, 0.72) 0%, rgba(10, 15, 26, 0.24) 38%, rgba(10, 15, 26, 0.0) 62%)'
          : 'linear-gradient(0deg, rgba(10, 15, 26, 0.84) 0%, rgba(10, 15, 26, 0.22) 56%, rgba(10, 15, 26, 0.0) 100%)',
        pointerEvents: 'auto',
        cursor: isDraggingPreview ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
        fontFamily: UI_FONTS.sans,
      }}
    >
      {/* LEFT / BOTTOM GLASS DRAWER WITH STICKY ABOVE-THE-FOLD CTA */}
      <form
        data-dalat-drawer="true"
        data-ui-overlay="true"
        onTouchStart={(e) => e.stopPropagation()}
        onSubmit={handleEnter}
        style={{
          ...GLASS_MODAL_STYLE,
          width: '100%',
          maxWidth: isDesktopStage ? '468px' : isLandscapeMobile ? '418px' : '100%',
          maxHeight: isDesktopStage
            ? 'calc(var(--dl-vh, 100vh) - 40px)'
            : isLandscapeMobile
              ? 'calc(var(--dl-vh, 100vh) - 20px)'
              : studioExpanded
                ? 'calc(var(--dl-vh, 100vh) * 0.78)'
                : 'calc(var(--dl-vh, 100vh) * 0.62)',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: isLandscapeMobile ? '20px' : '24px',
          pointerEvents: 'auto',
          cursor: 'default',
          touchAction: 'pan-y',
          userSelect: 'auto',
          animation: 'dalatFadeUp 420ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* SCROLLABLE UPPER BODY */}
        <div
          className="dalat-scroll"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            padding: isDesktopStage ? '20px 22px 12px' : isLandscapeMobile ? '12px 14px 8px' : '14px 16px 10px',
          }}
        >
          {/* Eyebrow + Returning Badge + Randomize */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              marginBottom: isLandscapeMobile ? '6px' : '8px',
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '999px',
                background: 'rgba(243, 195, 130, 0.13)',
                border: '1px solid rgba(243, 195, 130, 0.3)',
                color: UI_COLORS.warmAmber,
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              <CloudSun size={14} strokeWidth={1.9} />
              <span>
                {visitCount >= 2
                  ? `Chào mừng trở lại • ${discoveredCount}/${LANDMARK_LIST.length} đỉnh đồi`
                  : 'Cầu Đất 1.650m • Săn mây trực tuyến'}
              </span>
            </div>

            <button
              type="button"
              onClick={handleRandomize}
              className="dalat-glass-btn"
              style={{
                padding: '5px 11px',
                minHeight: '32px',
                borderRadius: '999px',
                background: 'rgba(243, 195, 130, 0.15)',
                border: '1px solid rgba(243, 195, 130, 0.36)',
                color: UI_COLORS.warmAmber,
                fontSize: '12px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <Dices size={13} />
              <span>Phối ngẫu nhiên</span>
            </button>
          </div>

          <h1
            className="dalat-serif"
            style={{
              fontFamily: UI_FONTS.serif,
              fontSize: isDesktopStage ? '30px' : isLandscapeMobile ? '22px' : '24px',
              fontWeight: 600,
              lineHeight: 1.14,
              letterSpacing: '-0.01em',
              color: UI_COLORS.cream,
              margin: '0 0 5px 0',
            }}
          >
            Chạm Mây Đà Lạt
          </h1>

          {!isLandscapeMobile && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                padding: '6px 10px',
                borderRadius: '10px',
                background: 'rgba(10, 15, 25, 0.5)',
                border: `1px solid ${UI_COLORS.border}`,
                fontFamily: UI_FONTS.mono,
                fontSize: '12px',
                color: '#F5DEC0',
                marginBottom: '10px',
                flexWrap: 'wrap',
              }}
            >
              <Compass size={13} strokeWidth={1.9} style={{ color: UI_COLORS.warmAmber, flexShrink: 0 }} />
              <span>
                {timeLabel} • {tempLabel}°C • {weatherLabel}
              </span>
            </div>
          )}

          {/* Display Name + Optional Room Code */}
          <div style={{ marginBottom: '10px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isCompactMobile
                  ? '1fr'
                  : 'minmax(0, 1.35fr) minmax(0, 0.85fr)',
                gap: '8px',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <label
                  htmlFor="dalat-name-input"
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 500,
                    color: UI_COLORS.mistText,
                    marginBottom: '4px',
                  }}
                >
                  Tên lữ khách
                </label>
                <input
                  id="dalat-name-input"
                  type="text"
                  value={nameInput}
                  maxLength={24}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Ví dụ: An Nhiên"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    borderRadius: '10px',
                    background: 'rgba(10, 15, 25, 0.58)',
                    border: `1px solid ${UI_COLORS.border}`,
                    color: UI_COLORS.cream,
                    fontSize: isMobileLayout ? '16px' : '13px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ minWidth: 0 }}>
                <label
                  htmlFor="dalat-room-input"
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 500,
                    color: invitedFromUrl ? UI_COLORS.pineSage : UI_COLORS.mistText,
                    marginBottom: '4px',
                  }}
                >
                  {invitedFromUrl ? 'Lời mời phòng' : 'Mã phòng (tùy chọn)'}
                </label>
                <input
                  id="dalat-room-input"
                  type="text"
                  aria-invalid={Boolean(roomValidationHint)}
                  value={roomInput}
                  maxLength={14}
                  onChange={(e) => {
                    setRoomInput(e.target.value.toUpperCase());
                    if (roomValidationHint) setRoomValidationHint(null);
                  }}
                  placeholder="MAY-01"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    borderRadius: '10px',
                    background: invitedFromUrl
                      ? 'rgba(130, 214, 158, 0.12)'
                      : 'rgba(10, 15, 25, 0.58)',
                    border: `1px solid ${
                      roomValidationHint
                        ? UI_COLORS.warmAmber
                        : invitedFromUrl
                          ? 'rgba(130, 214, 158, 0.55)'
                          : UI_COLORS.border
                    }`,
                    color: UI_COLORS.warmAmber,
                    fontFamily: UI_FONTS.mono,
                    fontSize: isMobileLayout ? '16px' : '13px',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {roomValidationHint && (
              <div
                role="alert"
                data-testid="landing-room-validation-hint"
                style={{
                  marginTop: '6px',
                  fontSize: '12px',
                  color: UI_COLORS.warmAmber,
                  paddingLeft: '2px',
                }}
              >
                ⚠️ {roomValidationHint}
              </div>
            )}
          </div>

          {/* Character Gender Selector (Nữ / Nam) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
              padding: '6px 8px',
              borderRadius: '12px',
              background: 'rgba(10, 15, 25, 0.52)',
              border: `1px solid ${UI_COLORS.border}`,
              marginBottom: '10px',
            }}
          >
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: UI_COLORS.mistText,
                paddingLeft: '4px',
              }}
            >
              Dáng nhân vật
            </span>
            <div
              role="radiogroup"
              aria-label="Chọn giới tính nhân vật"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                gap: '6px',
                flex: '1 1 180px',
                maxWidth: isCompactMobile ? '100%' : '256px',
                minWidth: 0,
              }}
            >
              {(
                [
                  { id: 'female' as const, label: isCompactMobile ? '♀ Nữ' : '♀ Nữ Lữ Khách' },
                  { id: 'male' as const, label: isCompactMobile ? '♂ Nam' : '♂ Nam Lữ Khách' },
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
                      padding: '6px 9px',
                      minHeight: '38px',
                      borderRadius: '9px',
                      fontSize: '12px',
                      fontWeight: active ? 600 : 500,
                      background: active
                        ? 'rgba(243, 195, 130, 0.24)'
                        : 'rgba(255, 255, 255, 0.045)',
                      border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 0,
                    }}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* TIER 1: EXPRESS CURATED DA LAT OUTFIT PRESETS */}
          {!studioExpanded && (
            <div style={{ marginBottom: '8px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '4px',
                  marginBottom: '6px',
                  fontSize: '12px',
                  color: UI_COLORS.mistText,
                }}
              >
                <span style={{ fontWeight: 600 }}>Phong cách gợi ý Đà Lạt</span>
                {!isCompactMobile && (
                  <span style={{ color: UI_COLORS.mutedText }}>Chạm nhân vật để xoay 360°</span>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isCompactMobile
                    ? '1fr'
                    : 'repeat(2, minmax(0, 1fr))',
                  gap: '7px',
                }}
              >
                {curatedPresets.map((preset) => {
                  const isMatch =
                    outfit.coatStyle === preset.outfit.coatStyle &&
                    outfit.headwear === preset.outfit.headwear &&
                    outfit.coatColor.toLowerCase() === preset.outfit.coatColor.toLowerCase();

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={isMatch}
                      onClick={() => {
                        updateOutfit(preset.outfit);
                        setHeldItem(preset.heldItem);
                      }}
                      className="dalat-glass-btn"
                      style={{
                        padding: '7px 9px',
                        borderRadius: '13px',
                        background: isMatch
                          ? 'linear-gradient(180deg, rgba(243, 195, 130, 0.24) 0%, rgba(243, 195, 130, 0.09) 100%)'
                          : 'rgba(255, 255, 255, 0.045)',
                        border: `1px solid ${isMatch ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        textAlign: 'left',
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '10px',
                          background: 'rgba(10, 15, 25, 0.5)',
                          border: '1px solid rgba(255, 255, 255, 0.07)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <CoatThumbnail
                          styleId={preset.outfit.coatStyle}
                          coatColor={preset.outfit.coatColor}
                          scarfColor={preset.outfit.scarfColor}
                          size={40}
                        />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: '12.5px',
                            fontWeight: 600,
                            color: isMatch ? UI_COLORS.warmAmber : UI_COLORS.cream,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {preset.title}
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: UI_COLORS.mistText,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {preset.subtitle}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* TOGGLE BUTTON FOR TIER 2 FULL 46-ITEM STUDIO WARDROBE */}
          <button
            type="button"
            aria-expanded={studioExpanded}
            onClick={() => setStudioExpanded((v) => !v)}
            className="dalat-glass-btn"
            style={{
              width: '100%',
              padding: '8px 12px',
              minHeight: '38px',
              borderRadius: '12px',
              background: studioExpanded
                ? 'rgba(243, 195, 130, 0.16)'
                : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${studioExpanded ? UI_COLORS.warmAmber : UI_COLORS.border}`,
              color: studioExpanded ? UI_COLORS.warmAmber : UI_COLORS.cream,
              fontSize: '12.5px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              marginBottom: studioExpanded ? '10px' : '2px',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
              <SlidersHorizontal size={14} style={{ color: UI_COLORS.warmAmber }} />
              <span>Tùy chỉnh chi tiết 46+ món & Bảng màu</span>
            </span>
            {studioExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {/* TIER 2: FULL STUDIO WARDROBE & COLOR SWATCHES */}
          {studioExpanded && (
            <div>
              {/* Category Tabs */}
              <div
                role="tablist"
                aria-label="Danh mục trang phục"
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
                      role="tab"
                      aria-selected={active}
                      onClick={() => handleSelectTab(tab.id)}
                      className="dalat-glass-btn"
                      style={{
                        padding: '5px 10px',
                        minHeight: '32px',
                        borderRadius: '999px',
                        fontSize: '12px',
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
              <div style={{ marginBottom: '10px' }}>
                {activeTab === 'coats' && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isCompactMobile
                        ? 'repeat(2, minmax(0, 1fr))'
                        : 'repeat(3, minmax(0, 1fr))',
                      gap: '6px',
                    }}
                  >
                    {genderCoats.map((item) => (
                      <VisualChoiceCard
                        key={item.id}
                        active={outfit.coatStyle === item.id}
                        label={item.shortLabel}
                        title={`${item.title} — ${item.desc}`}
                        compact
                        thumbHeight={54}
                        onClick={() => updateOutfit({ coatStyle: item.id })}
                        thumbnail={
                          <CoatThumbnail
                            styleId={item.id}
                            coatColor={outfit.coatColor}
                            scarfColor={outfit.scarfColor}
                            size={50}
                          />
                        }
                      />
                    ))}
                  </div>
                )}

                {activeTab === 'headwear' && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isDesktopStage
                        ? 'repeat(4, minmax(0, 1fr))'
                        : isCompactMobile
                          ? 'repeat(2, minmax(0, 1fr))'
                          : 'repeat(3, minmax(0, 1fr))',
                      gap: '6px',
                    }}
                  >
                    {HEADWEAR_CATALOG.map((item) => (
                      <VisualChoiceCard
                        key={item.id}
                        active={outfit.headwear === item.id}
                        label={item.shortLabel}
                        title={`${item.title} — ${item.desc}`}
                        compact
                        thumbHeight={50}
                        onClick={() => updateOutfit({ headwear: item.id })}
                        thumbnail={
                          <HeadwearThumbnail
                            headwearId={item.id}
                            coatColor={outfit.coatColor}
                            scarfColor={outfit.scarfColor}
                            hairColor={outfit.hairColor}
                            gender={effGender}
                            size={46}
                          />
                        }
                      />
                    ))}
                  </div>
                )}

                {activeTab === 'face_neck' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isCompactMobile
                          ? 'repeat(2, minmax(0, 1fr))'
                          : 'repeat(3, minmax(0, 1fr))',
                        gap: '6px',
                      }}
                    >
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
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isCompactMobile
                          ? 'repeat(2, minmax(0, 1fr))'
                          : 'repeat(3, minmax(0, 1fr))',
                        gap: '6px',
                      }}
                    >
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
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isCompactMobile
                        ? 'repeat(2, minmax(0, 1fr))'
                        : 'repeat(3, minmax(0, 1fr))',
                      gap: '6px',
                    }}
                  >
                    {BAG_CATALOG.map((bag) => (
                      <VisualChoiceCard
                        key={bag.id}
                        active={effBag === bag.id}
                        label={bag.shortLabel}
                        title={`${bag.title} — ${bag.desc}`}
                        compact
                        thumbHeight={52}
                        onClick={() => updateOutfit({ bagStyle: bag.id, backpack: bag.id !== 'none' })}
                        thumbnail={
                          <BagThumbnail
                            bagId={bag.id}
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
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isCompactMobile
                        ? 'repeat(2, minmax(0, 1fr))'
                        : 'repeat(3, minmax(0, 1fr))',
                      gap: '6px',
                    }}
                  >
                    {HELD_PROP_CATALOG.map((prop) => (
                      <VisualChoiceCard
                        key={prop.id}
                        active={heldItem === prop.id}
                        label={prop.shortLabel}
                        title={`${prop.title} — ${prop.desc}`}
                        compact
                        thumbHeight={48}
                        onClick={() => setHeldItem(prop.id)}
                        thumbnail={<HeldPropThumbnail itemId={prop.id} size={44} />}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Accessible Color Swatch Palettes (Checkmark + >=36/42px Hit Targets) */}
              <div
                style={{
                  padding: '9px 10px',
                  borderRadius: '13px',
                  background: 'rgba(10, 15, 25, 0.48)',
                  border: `1px solid ${UI_COLORS.border}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '9px',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: UI_COLORS.mistText,
                      marginBottom: '5px',
                    }}
                  >
                    Màu áo khoác Đà Lạt
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {HIGHLAND_PALETTE.coats.map((hex) => (
                      <ColorSwatchButton
                        key={hex}
                        hex={hex}
                        selected={outfit.coatColor.toLowerCase() === hex.toLowerCase()}
                        onClick={() => updateOutfit({ coatColor: hex })}
                        label={`Màu áo ${hex}`}
                        touchMode={isTouchCapable}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: UI_COLORS.mistText,
                      marginBottom: '5px',
                    }}
                  >
                    Màu khăn choàng & mũ len
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {HIGHLAND_PALETTE.scarves.map((hex) => (
                      <ColorSwatchButton
                        key={hex}
                        hex={hex}
                        selected={outfit.scarfColor.toLowerCase() === hex.toLowerCase()}
                        onClick={() => updateOutfit({ scarfColor: hex })}
                        label={`Màu khăn ${hex}`}
                        touchMode={isTouchCapable}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: UI_COLORS.mistText,
                      marginBottom: '5px',
                    }}
                  >
                    Màu tóc
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {HIGHLAND_PALETTE.hair.map((hex) => (
                      <ColorSwatchButton
                        key={hex}
                        hex={hex}
                        selected={outfit.hairColor.toLowerCase() === hex.toLowerCase()}
                        onClick={() => updateOutfit({ hairColor: hex })}
                        label={`Màu tóc ${hex}`}
                        touchMode={isTouchCapable}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* STICKY ABOVE-THE-FOLD PRIMARY CTA FOOTER */}
        <div
          style={{
            flexShrink: 0,
            padding: isDesktopStage ? '11px 22px 16px' : isLandscapeMobile ? '8px 14px 10px' : '10px 16px 12px',
            borderTop: `1px solid ${UI_COLORS.border}`,
            background: 'rgba(13, 19, 30, 0.94)',
          }}
        >
          <button
            type="submit"
            disabled={entering}
            data-testid="landing-enter-btn"
            className="dalat-glass-btn"
            style={{
              width: '100%',
              minHeight: '46px',
              padding: '11px 16px',
              borderRadius: '14px',
              border: '1px solid rgba(255, 224, 178, 0.56)',
              background:
                'linear-gradient(135deg, rgba(243, 195, 130, 0.96) 0%, rgba(226, 148, 86, 0.94) 100%)',
              color: '#1D150E',
              fontSize: '14.5px',
              fontWeight: 700,
              letterSpacing: '0.01em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 10px 26px rgba(226, 148, 86, 0.34)',
            }}
          >
            <Sparkles size={17} strokeWidth={2.2} />
            <span>{entering ? 'Đang mở lối lên đồi…' : 'Bước Vào Sương Sớm'}</span>
          </button>
        </div>
      </form>

      {/* RIGHT 3D LIVE AVATAR TURNTABLE STAGE (Desktop & Landscape) */}
      {sideBySide && (
        <div
          style={{
            flex: 1,
            alignSelf: 'stretch',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: isLandscapeMobile ? '8px 0 6px 12px' : '14px 12px 10px 24px',
            pointerEvents: 'none',
          }}
        >
          {/* Floating Live Character Nameplate */}
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '7px 15px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13px',
              color: UI_COLORS.cream,
              pointerEvents: 'auto',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: UI_COLORS.pineSage,
                boxShadow: '0 0 8px rgba(130, 214, 158, 0.75)',
              }}
            />
            <span style={{ fontWeight: 600, color: UI_COLORS.warmAmber }}>
              {nameInput.trim() || displayName}
            </span>
            <span style={{ opacity: 0.45 }}>•</span>
            <span style={{ fontSize: '12px', color: UI_COLORS.mistText }}>
              Xem trước 3D trực tiếp
            </span>
          </div>

          {/* Clean 360° Turntable Angle Presets (No duplicate 5-prop bar!) */}
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '12px',
              color: UI_COLORS.mistText,
              pointerEvents: 'auto',
              cursor: 'default',
            }}
          >
            <RotateCw size={13} style={{ color: UI_COLORS.warmAmber }} />
            {!isLandscapeMobile && <span>Kéo xoay 360° • Cuộn zoom:</span>}
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
                    padding: '4px 10px',
                    minHeight: '30px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    fontWeight: active ? 600 : 500,
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
              title="Đặt lại góc nhìn & độ phóng to"
              className="dalat-glass-btn"
              style={{
                padding: '4px 10px',
                minHeight: '30px',
                borderRadius: '999px',
                fontSize: '12px',
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
