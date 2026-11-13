import { useEffect, useState } from 'react';
import { Camera, Download, EyeOff, Images, Pin, RotateCcw, Timer, Users, X } from 'lucide-react';
import { gameYToASL } from '@dalat/protocol';
import type { IMultiplayerController } from '../network/types';
import { playTemporaryEmote } from '../gameplay/interactions';
import { useNetController } from '../gameplay/netBridge';
import {
  PHOTO_FILTER_LABELS,
  PhotoFilterId,
  updatePolaroidCaption,
} from '../gameplay/polaroidComposer';
import { useGameStore } from '../store/gameStore';
import { GLASS_MODAL_STYLE, GLASS_PILL_STYLE, UI_COLORS, UI_FONTS } from './uiStyles';
import { useViewportLayout } from './useViewportLayout';

const FOCAL_OPTIONS: Array<24 | 35 | 50 | 85> = [24, 35, 50, 85];
const FILTER_ORDER: PhotoFilterId[] = ['kodak_dawn', 'fuji_pine', 'dreamy_mist', 'natural'];

export function AnalogPhotoMode({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);
  const { isMobileLayout, isCompactMobile, isLandscapeMobile, showKeycaps } = useViewportLayout();

  const timeLabel = useGameStore((s) => s.atmosphere.timeLabel);
  const roomCode = useGameStore((s) => s.roomCode);
  const polaroidCount = useGameStore((s) => s.polaroids.length);
  const photoFocalMm = useGameStore((s) => s.photoFocalMm);
  const photoFilter = useGameStore((s) => s.photoFilter);
  const photoHideCrowd = useGameStore((s) => s.photoHideCrowd);
  const photoIncludeInviteCode = useGameStore((s) => s.photoIncludeInviteCode);
  const photoCountdown = useGameStore((s) => s.photoCountdown);
  const latestCapturedPolaroid = useGameStore((s) => s.latestCapturedPolaroid);
  const photoShutterNonce = useGameStore((s) => s.photoShutterNonce);
  const toastBanner = useGameStore((s) => s.toastBanner);

  const setPhotoMode = useGameStore((s) => s.setPhotoMode);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const setPhotoOptions = useGameStore((s) => s.setPhotoOptions);
  const requestPhotoShutter = useGameStore((s) => s.requestPhotoShutter);
  const setLatestCapturedPolaroid = useGameStore((s) => s.setLatestCapturedPolaroid);
  const saveCapturedPolaroid = useGameStore((s) => s.saveCapturedPolaroid);
  const showToast = useGameStore((s) => s.showToast);

  const [shutterFlashKey, setShutterFlashKey] = useState(0);
  const [captionDraft, setCaptionDraft] = useState('');
  const [hasPinned, setHasPinned] = useState(false);
  const [isPinning, setIsPinning] = useState(false);
  const [pinFeedback, setPinFeedback] = useState<{
    tone: 'pending' | 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (photoShutterNonce > 0) {
      setShutterFlashKey(photoShutterNonce);
      setHasPinned(false);
      setIsPinning(false);
      setPinFeedback(null);
      setCaptionDraft('');
    }
  }, [photoShutterNonce]);

  // 3-second Group Countdown Timer
  useEffect(() => {
    if (photoCountdown <= 0) return;
    const t = setTimeout(() => {
      const cur = useGameStore.getState().photoCountdown;
      if (cur <= 1) {
        setPhotoOptions({ photoCountdown: 0 });
        requestPhotoShutter();
      } else {
        setPhotoOptions({ photoCountdown: cur - 1 });
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [photoCountdown, requestPhotoShutter, setPhotoOptions]);

  const handleStartGroupCountdown = () => {
    if (photoCountdown > 0) return;
    setPhotoOptions({ photoCountdown: 3 });
    playTemporaryEmote('wave', net, 2800);
    net.sendChat('📸 Chuẩn bị chụp ảnh kỷ niệm sau 3 giây — cùng nhìn vào ống kính nhé! ✨');
  };

  const handleCaptionChange = (nextText: string) => {
    setCaptionDraft(nextText);
    if (latestCapturedPolaroid) {
      const updated = updatePolaroidCaption(
        latestCapturedPolaroid,
        nextText,
        photoIncludeInviteCode ? roomCode || 'MAY-01' : ''
      );
      setLatestCapturedPolaroid(updated);
      saveCapturedPolaroid(updated);
    }
  };

  const handleToggleInviteStamp = (checked: boolean) => {
    setPhotoOptions({ photoIncludeInviteCode: checked });
    if (latestCapturedPolaroid) {
      const updated = updatePolaroidCaption(
        latestCapturedPolaroid,
        captionDraft,
        checked ? roomCode || 'MAY-01' : ''
      );
      setLatestCapturedPolaroid(updated);
      saveCapturedPolaroid(updated);
    }
  };

  const handleDownload = () => {
    if (!latestCapturedPolaroid) return;
    const isWebp = latestCapturedPolaroid.imageDataUrl.startsWith('data:image/webp');
    const ext = isWebp ? 'webp' : 'png';
    const a = document.createElement('a');
    a.href = latestCapturedPolaroid.imageDataUrl;
    a.download = `cham-may-dalat-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`📥 Đã lưu tấm ảnh Polaroid (.${ext}) về máy của bạn!`);
  };

  const handlePinToWall = async () => {
    if (!latestCapturedPolaroid || hasPinned || isPinning) return;

    setIsPinning(true);
    setPinFeedback({ tone: 'pending', message: 'Đang ghim lên bảng...' });
    showToast('Đang ghim lên bảng...');

    try {
      const ack = await net.pinPolaroid({
        authorName: latestCapturedPolaroid.authorName,
        caption: latestCapturedPolaroid.caption,
        landmarkId: latestCapturedPolaroid.landmarkId,
        landmarkName: latestCapturedPolaroid.landmarkName,
        weatherId: latestCapturedPolaroid.weatherId,
        gameTimeLabel: latestCapturedPolaroid.gameTimeLabel,
        altitudeASL: latestCapturedPolaroid.altitudeASL,
        imageDataUrl: latestCapturedPolaroid.imageDataUrl,
      });

      if (ack?.ok === false) {
        const errMsg = ack.reason || 'Không thể ghim ảnh lúc này.';
        setPinFeedback({ tone: 'error', message: errMsg });
        showToast(`⚠️ ${errMsg}`);
        return;
      }

      if (ack?.polaroidId) {
        const promoted = { ...latestCapturedPolaroid, id: ack.polaroidId };
        setLatestCapturedPolaroid(promoted);
        saveCapturedPolaroid(promoted);
      }
      setHasPinned(true);
      setPinFeedback({ tone: 'success', message: '✓ Đã ghim lên bảng ảnh chung!' });
      showToast('✓ Đã ghim lên bảng ảnh chung!');
    } catch {
      const errMsg = 'Không thể ghim ảnh lúc này.';
      setPinFeedback({ tone: 'error', message: errMsg });
      showToast(`⚠️ ${errMsg}`);
    } finally {
      setIsPinning(false);
    }
  };

  const altitudeASL = gameYToASL(useGameStore.getState().localTransient.y);

  const previewTintStyle: React.CSSProperties =
    photoFilter === 'kodak_dawn'
      ? { background: 'linear-gradient(180deg, rgba(255,180,108,0.09), rgba(45,30,48,0.08))' }
      : photoFilter === 'fuji_pine'
        ? { background: 'rgba(30, 86, 76, 0.08)' }
        : photoFilter === 'dreamy_mist'
          ? { background: 'rgba(240, 236, 255, 0.08)', backdropFilter: 'blur(0.4px)' }
          : {};

  return (
    <div
      className="dalat-full-viewport"
      style={{
        position: 'fixed',
        inset: 0,
        height: 'var(--dl-vh, 100vh)',
        zIndex: 45,
        pointerEvents: 'none',
        fontFamily: UI_FONTS.sans,
        boxSizing: 'border-box',
      }}
    >
      {/* Live Viewfinder Film Tint + Optical Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          ...previewTintStyle,
          boxShadow: 'inset 0 0 110px rgba(6, 9, 16, 0.55)',
          pointerEvents: 'none',
        }}
      />

      {/* Shutter Flash Effect */}
      {shutterFlashKey > 0 && (
        <div
          key={shutterFlashKey}
          style={{
            position: 'absolute',
            inset: 0,
            background: '#FFFDF8',
            animation: 'dalatShutterFlash 420ms ease-out forwards',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* 35mm Rangefinder Frame, Rule of Thirds Hairlines & Micro-Prism Center Circle */}
      {!latestCapturedPolaroid && (
        <div
          style={{
            position: 'absolute',
            inset: isMobileLayout
              ? isLandscapeMobile
                ? '54px 28px 82px 28px'
                : '64px 18px 146px 18px'
              : '68px 56px 116px 56px',
            border: '1px solid rgba(255, 244, 224, 0.22)',
            borderRadius: '6px',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '33.333%',
              width: '1px',
              background: 'rgba(255, 244, 224, 0.14)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '66.666%',
              width: '1px',
              background: 'rgba(255, 244, 224, 0.14)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '33.333%',
              height: '1px',
              background: 'rgba(255, 244, 224, 0.14)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '66.666%',
              height: '1px',
              background: 'rgba(255, 244, 224, 0.14)',
            }}
          />

          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '42px',
              height: '42px',
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              border: '1px solid rgba(255, 232, 196, 0.44)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                background: 'rgba(255, 206, 138, 0.8)',
              }}
            />
          </div>

          {[
            { top: -2, left: -2, borderTop: '2px solid #F3C382', borderLeft: '2px solid #F3C382' },
            { top: -2, right: -2, borderTop: '2px solid #F3C382', borderRight: '2px solid #F3C382' },
            { bottom: -2, left: -2, borderBottom: '2px solid #F3C382', borderLeft: '2px solid #F3C382' },
            { bottom: -2, right: -2, borderBottom: '2px solid #F3C382', borderRight: '2px solid #F3C382' },
          ].map((cornerStyle, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                width: '18px',
                height: '18px',
                ...cornerStyle,
              }}
            />
          ))}
        </div>
      )}

      {/* Group Countdown Overlay */}
      {photoCountdown > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontFamily: UI_FONTS.serif,
            fontSize: '92px',
            fontWeight: 600,
            color: '#FFF6E6',
            textShadow: '0 8px 36px rgba(0, 0, 0, 0.65)',
          }}
        >
          {photoCountdown}
        </div>
      )}

      {/* Top Viewfinder Exposure Telemetry Bar + Album Counter + Close Button */}
      <div
        data-ui-overlay="true"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 'var(--dl-safe-top)',
          left: 'var(--dl-safe-left)',
          right: 'var(--dl-safe-right)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: isCompactMobile ? '5px' : '8px',
          pointerEvents: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            ...GLASS_PILL_STYLE,
            minHeight: '42px',
            borderRadius: '999px',
            padding: isCompactMobile ? '6px 9px' : isMobileLayout ? '6px 11px' : '7px 15px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: isCompactMobile ? '5px' : isMobileLayout ? '6px' : '10px',
            fontFamily: UI_FONTS.mono,
            fontSize: '12px',
            minWidth: 0,
          }}
        >
          <span style={{ color: UI_COLORS.warmAmber, fontWeight: 600 }}>35MM</span>
          {!isMobileLayout && (
            <>
              <span style={{ opacity: 0.35 }}>•</span>
              <span>ISO 400</span>
              <span style={{ opacity: 0.35 }}>•</span>
              <span>f/2.8</span>
            </>
          )}
          <span style={{ opacity: 0.35 }}>•</span>
          <span>{photoFocalMm}mm</span>
          {!isCompactMobile && (
            <>
              <span style={{ opacity: 0.35 }}>•</span>
              <span style={{ whiteSpace: 'nowrap' }}>
                {timeLabel}
                {!isMobileLayout ? ` (${altitudeASL.toLocaleString('en-US')}m)` : ''}
              </span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <button
            type="button"
            aria-label={`Album kỷ niệm (${polaroidCount})`}
            onClick={() => {
              setPhotoMode(false);
              setActiveModal('polaroids');
            }}
            className="dalat-glass-btn"
            style={{
              ...GLASS_PILL_STYLE,
              minHeight: '44px',
              minWidth: '44px',
              borderRadius: '999px',
              padding: isCompactMobile ? '6px 10px' : '6px 12px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '12px',
              color: UI_COLORS.warmAmber,
            }}
          >
            <Images size={14} />
            <span>{isMobileLayout ? `${polaroidCount}` : `Album (${polaroidCount})`}</span>
          </button>

          <button
            type="button"
            aria-label="Thoát chế độ chụp ảnh"
            onClick={() => setPhotoMode(false)}
            className="dalat-glass-btn"
            style={{
              ...GLASS_PILL_STYLE,
              minHeight: '44px',
              minWidth: '44px',
              borderRadius: '999px',
              padding: isCompactMobile ? '6px 10px' : '6px 13px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '12px',
            }}
          >
            <X size={14} />
            {!isCompactMobile && <span>{showKeycaps ? 'Thoát [Esc]' : 'Thoát'}</span>}
          </button>
        </div>
      </div>

      {/* Live Toast Banner inside Photo Mode (visible while DiegeticHUD is unmounted) */}
      {toastBanner && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            top: 'calc(var(--dl-safe-top) + 52px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 48,
            pointerEvents: 'none',
            maxWidth: 'calc(100vw - 24px)',
          }}
        >
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '7px 16px',
              border: `1px solid ${UI_COLORS.borderStrong}`,
              fontSize: '12.5px',
              fontWeight: 500,
              color: UI_COLORS.cream,
              textAlign: 'center',
            }}
          >
            {toastBanner}
          </div>
        </div>
      )}

      {/* Bottom Camera Controls Bar (when composing) */}
      {!latestCapturedPolaroid && (
        <div
          data-ui-overlay="true"
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: 'var(--dl-safe-bottom)',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: isMobileLayout ? '6px' : '10px',
            width: 'max-content',
            maxWidth: 'calc(100vw - 12px)',
            boxSizing: 'border-box',
            pointerEvents: 'auto',
          }}
        >
          {/* Focal Length Selector: 24mm | 35mm | 50mm | 85mm */}
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              maxWidth: 'calc(100vw - 16px)',
              boxSizing: 'border-box',
            }}
          >
            {FOCAL_OPTIONS.map((mm) => {
              const active = photoFocalMm === mm;
              return (
                <button
                  key={mm}
                  type="button"
                  onClick={() => setPhotoOptions({ photoFocalMm: mm })}
                  className="dalat-glass-btn"
                  style={{
                    minHeight: isMobileLayout ? '40px' : '36px',
                    minWidth: isMobileLayout ? '44px' : undefined,
                    padding: isMobileLayout ? '5px 8px' : '6px 10px',
                    borderRadius: '999px',
                    fontFamily: UI_FONTS.mono,
                    fontSize: '12px',
                    background: active ? 'rgba(243, 195, 130, 0.25)' : 'transparent',
                    border: `1px solid ${active ? UI_COLORS.warmAmber : 'transparent'}`,
                    color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                  }}
                >
                  {mm}mm
                </button>
              );
            })}
          </div>

          {/* 4 Da Lat Film Looks */}
          <div
            className="dalat-scroll"
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              maxWidth: 'calc(100vw - 16px)',
              boxSizing: 'border-box',
              overflowX: 'auto',
            }}
          >
            {FILTER_ORDER.map((fid) => {
              const active = photoFilter === fid;
              return (
                <button
                  key={fid}
                  type="button"
                  onClick={() => setPhotoOptions({ photoFilter: fid })}
                  className="dalat-glass-btn"
                  title={PHOTO_FILTER_LABELS[fid].subtitle}
                  style={{
                    minHeight: isMobileLayout ? '40px' : '36px',
                    padding: isMobileLayout ? '5px 9px' : '6px 11px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    whiteSpace: 'nowrap',
                    background: active ? 'rgba(243, 195, 130, 0.25)' : 'transparent',
                    border: `1px solid ${active ? UI_COLORS.warmAmber : 'transparent'}`,
                    color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                  }}
                >
                  {PHOTO_FILTER_LABELS[fid].name}
                </button>
              );
            })}
          </div>

          {/* Analog Silver Shutter Button with Explicit [Space] Affordance on Desktop */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
            <button
              type="button"
              aria-label="Chụp ảnh Polaroid"
              data-testid="photo-shutter-btn"
              onClick={() => {
                if (photoCountdown === 0) requestPhotoShutter();
              }}
              title={showKeycaps ? 'Bấm chụp ảnh [Space / Click]' : 'Chạm để chụp ảnh'}
              className="dalat-glass-btn"
              style={{
                width: '56px',
                height: '56px',
                padding: 0,
                borderRadius: '50%',
                background: 'radial-gradient(circle, #FFF8EC 0%, #E7D2B0 100%)',
                border: '3px solid rgba(255, 255, 255, 0.88)',
                boxShadow: '0 0 0 3px rgba(15, 22, 34, 0.78), 0 8px 24px rgba(0,0,0,0.48)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#1C2331',
              }}
            >
              <Camera size={22} strokeWidth={2.1} />
            </button>
            {showKeycaps && (
              <span
                style={{
                  fontSize: '12px',
                  fontFamily: UI_FONTS.mono,
                  color: UI_COLORS.warmAmber,
                  background: 'rgba(15, 22, 34, 0.82)',
                  padding: '1px 7px',
                  borderRadius: '999px',
                  border: `1px solid ${UI_COLORS.border}`,
                }}
              >
                [Space]
              </span>
            )}
          </div>

          {/* [Ẩn đám đông] & [Hẹn giờ nhóm 3s] */}
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              maxWidth: 'calc(100vw - 16px)',
              boxSizing: 'border-box',
            }}
          >
            <button
              type="button"
              onClick={() => setPhotoOptions({ photoHideCrowd: !photoHideCrowd })}
              className="dalat-glass-btn"
              style={{
                minHeight: isMobileLayout ? '40px' : '36px',
                padding: isCompactMobile ? '5px 9px' : '5px 11px',
                borderRadius: '999px',
                fontSize: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: photoHideCrowd ? 'rgba(243, 195, 130, 0.24)' : 'transparent',
                border: `1px solid ${photoHideCrowd ? UI_COLORS.warmAmber : 'transparent'}`,
                color: photoHideCrowd ? UI_COLORS.warmAmber : UI_COLORS.cream,
              }}
            >
              {photoHideCrowd ? <EyeOff size={13} /> : <Users size={13} />}
              <span>Ẩn đám đông</span>
            </button>

            <button
              type="button"
              onClick={handleStartGroupCountdown}
              className="dalat-glass-btn"
              style={{
                minHeight: isMobileLayout ? '40px' : '36px',
                padding: isCompactMobile ? '5px 9px' : '5px 11px',
                borderRadius: '999px',
                fontSize: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: photoCountdown > 0 ? 'rgba(243, 195, 130, 0.24)' : 'transparent',
                border: `1px solid ${photoCountdown > 0 ? UI_COLORS.warmAmber : 'transparent'}`,
                color: photoCountdown > 0 ? UI_COLORS.warmAmber : UI_COLORS.cream,
              }}
            >
              <Timer size={13} />
              <span>Hẹn giờ 3s</span>
            </button>
          </div>
        </div>
      )}

      {/* DEVELOPED POLAROID PREVIEW CARD */}
      {latestCapturedPolaroid && (
        <div
          data-ui-overlay="true"
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(8, 12, 20, 0.74)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: isCompactMobile ? '8px' : '14px',
            boxSizing: 'border-box',
            pointerEvents: 'auto',
          }}
        >
          <div
            className="dalat-scroll"
            style={{
              ...GLASS_MODAL_STYLE,
              borderRadius: '24px',
              padding: isCompactMobile ? '13px' : isMobileLayout ? '16px' : '20px',
              width: 'min(430px, 100%)',
              maxHeight: 'calc(var(--dl-vh, 100vh) - 24px)',
              boxSizing: 'border-box',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              animation: 'dalatFadeUp 300ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <img
              src={latestCapturedPolaroid.imageDataUrl}
              alt="Ảnh Polaroid Đà Lạt"
              style={{
                width: '100%',
                maxHeight: isLandscapeMobile
                  ? 'calc(var(--dl-vh, 100vh) * 0.42)'
                  : 'calc(var(--dl-vh, 100vh) * 0.48)',
                objectFit: 'contain',
                borderRadius: '8px',
                boxShadow: '0 14px 36px rgba(0, 0, 0, 0.48)',
                display: 'block',
              }}
            />

            <div>
              <label
                htmlFor="polaroid-caption-input"
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: UI_COLORS.mistText,
                  marginBottom: '5px',
                }}
              >
                Dòng lưu bút trên ảnh Polaroid
              </label>
              <input
                id="polaroid-caption-input"
                type="text"
                value={captionDraft}
                maxLength={54}
                onChange={(e) => handleCaptionChange(e.target.value)}
                placeholder="Ghi đôi lời kỷ niệm săn mây…"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '9px 12px',
                  borderRadius: '11px',
                  background: 'rgba(10, 14, 24, 0.58)',
                  border: `1px solid ${UI_COLORS.border}`,
                  color: UI_COLORS.cream,
                  fontSize: isMobileLayout ? '16px' : '13.5px',
                  outline: 'none',
                }}
              />
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                minHeight: '36px',
                fontSize: '12px',
                color: UI_COLORS.cream,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={photoIncludeInviteCode}
                onChange={(e) => handleToggleInviteStamp(e.target.checked)}
                style={{ accentColor: UI_COLORS.warmAmber, width: '18px', height: '18px', flexShrink: 0 }}
              />
              <span>In mã phòng mời bạn ({roomCode || 'MAY-01'}) lên lề ảnh</span>
            </label>

            {pinFeedback && (
              <div
                role="status"
                aria-live="polite"
                data-testid="polaroid-pin-status"
                style={{
                  padding: '8px 11px',
                  borderRadius: '11px',
                  fontSize: '12px',
                  fontWeight: 600,
                  background:
                    pinFeedback.tone === 'error'
                      ? 'rgba(232, 139, 110, 0.16)'
                      : pinFeedback.tone === 'success'
                        ? 'rgba(130, 214, 158, 0.16)'
                        : 'rgba(243, 195, 130, 0.14)',
                  border: `1px solid ${
                    pinFeedback.tone === 'error'
                      ? 'rgba(232, 139, 110, 0.58)'
                      : pinFeedback.tone === 'success'
                        ? 'rgba(130, 214, 158, 0.52)'
                        : UI_COLORS.borderStrong
                  }`,
                  color:
                    pinFeedback.tone === 'error'
                      ? '#FFD2C4'
                      : pinFeedback.tone === 'success'
                        ? '#C8F4D8'
                        : UI_COLORS.warmAmber,
                }}
              >
                {pinFeedback.message}
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isCompactMobile ? '1fr' : '1fr 1fr',
                gap: '8px',
              }}
            >
              <button
                type="button"
                onClick={handleDownload}
                className="dalat-glass-btn"
                style={{
                  minHeight: '44px',
                  padding: '9px 12px',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: `1px solid ${UI_COLORS.borderStrong}`,
                  color: UI_COLORS.cream,
                  fontSize: '12.5px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <Download size={14} />
                <span>Tải ảnh về</span>
              </button>

              <button
                type="button"
                data-testid="polaroid-pin-btn"
                disabled={hasPinned || isPinning}
                onClick={handlePinToWall}
                className="dalat-glass-btn"
                style={{
                  minHeight: '44px',
                  padding: '9px 12px',
                  borderRadius: '12px',
                  background: hasPinned
                    ? 'rgba(130, 179, 154, 0.24)'
                    : 'linear-gradient(135deg, rgba(243, 195, 130, 0.94), rgba(226, 148, 86, 0.92))',
                  border: `1px solid ${hasPinned ? '#82B39A' : 'rgba(255, 226, 182, 0.52)'}`,
                  color: hasPinned ? '#C6EBD5' : '#181E2B',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <Pin size={14} />
                <span>
                  {isPinning
                    ? 'Đang ghim...'
                    : hasPinned
                      ? '✓ Đã ghim bảng'
                      : 'Ghim lên Bảng'}
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setHasPinned(false);
                setIsPinning(false);
                setPinFeedback(null);
                setLatestCapturedPolaroid(null);
              }}
              className="dalat-glass-btn"
              style={{
                minHeight: '42px',
                padding: '8px 12px',
                borderRadius: '11px',
                background: 'transparent',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.mistText,
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <RotateCcw size={13} />
              <span>Chụp thêm tấm khác</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
