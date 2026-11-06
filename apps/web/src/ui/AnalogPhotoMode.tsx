import { useEffect, useState } from 'react';
import { Camera, Download, EyeOff, Pin, RotateCcw, Timer, Users, X } from 'lucide-react';
import { gameYToASL } from '@dalat/protocol';
import type { IMultiplayerController } from '../network/types';
import { useNetController } from '../gameplay/netBridge';
import {
  PHOTO_FILTER_LABELS,
  PhotoFilterId,
  updatePolaroidCaption,
} from '../gameplay/polaroidComposer';
import { useGameStore } from '../store/gameStore';
import { GLASS_MODAL_STYLE, GLASS_PILL_STYLE, UI_COLORS, UI_FONTS } from './uiStyles';

const FOCAL_OPTIONS: Array<24 | 35 | 50 | 85> = [24, 35, 50, 85];
const FILTER_ORDER: PhotoFilterId[] = ['kodak_dawn', 'fuji_pine', 'dreamy_mist', 'natural'];

export function AnalogPhotoMode({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);

  const atmosphere = useGameStore((s) => s.atmosphere);
  const photoFocalMm = useGameStore((s) => s.photoFocalMm);
  const photoFilter = useGameStore((s) => s.photoFilter);
  const photoHideCrowd = useGameStore((s) => s.photoHideCrowd);
  const photoCountdown = useGameStore((s) => s.photoCountdown);
  const latestCapturedPolaroid = useGameStore((s) => s.latestCapturedPolaroid);
  const photoShutterNonce = useGameStore((s) => s.photoShutterNonce);

  const setPhotoMode = useGameStore((s) => s.setPhotoMode);
  const setPhotoOptions = useGameStore((s) => s.setPhotoOptions);
  const requestPhotoShutter = useGameStore((s) => s.requestPhotoShutter);
  const setLatestCapturedPolaroid = useGameStore((s) => s.setLatestCapturedPolaroid);
  const showToast = useGameStore((s) => s.showToast);

  const [shutterFlashKey, setShutterFlashKey] = useState(0);
  const [captionDraft, setCaptionDraft] = useState('');
  const [hasPinned, setHasPinned] = useState(false);

  // Trigger white optical shutter flash whenever shutter fires
  useEffect(() => {
    if (photoShutterNonce > 0) {
      setShutterFlashKey(photoShutterNonce);
      setHasPinned(false);
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

  const handleCaptionChange = (nextText: string) => {
    setCaptionDraft(nextText);
    if (latestCapturedPolaroid) {
      const updated = updatePolaroidCaption(latestCapturedPolaroid, nextText);
      setLatestCapturedPolaroid(updated);
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

  const handlePinToWall = () => {
    if (!latestCapturedPolaroid || hasPinned) return;
    const st = useGameStore.getState();
    const prevTopId = st.polaroids[0]?.id;

    net.pinPolaroid({
      authorName: latestCapturedPolaroid.authorName,
      caption: latestCapturedPolaroid.caption,
      landmarkId: latestCapturedPolaroid.landmarkId,
      landmarkName: latestCapturedPolaroid.landmarkName,
      weatherId: latestCapturedPolaroid.weatherId,
      gameTimeLabel: latestCapturedPolaroid.gameTimeLabel,
      altitudeASL: latestCapturedPolaroid.altitudeASL,
      imageDataUrl: latestCapturedPolaroid.imageDataUrl,
    });

    // Ensure immediate local board update if offline
    if (!st.connected && useGameStore.getState().polaroids[0]?.id === prevTopId) {
      st.prependPolaroid({
        ...latestCapturedPolaroid,
        id: `pol-${Date.now()}`,
        likes: 1,
        createdAt: Date.now(),
      });
    }

    setHasPinned(true);
    showToast('📌 Đã ghim ảnh lên Bảng Kỷ Niệm Săn Mây tại Tiệm Mơ Sương!');
  };

  const altitudeASL = gameYToASL(useGameStore.getState().localTransient.y);

  // Subtle viewfinder CSS film preview tint
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
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 45,
        pointerEvents: 'none',
        fontFamily: UI_FONTS.sans,
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
            inset: '68px 56px 108px 56px',
            border: '1px solid rgba(255, 244, 224, 0.22)',
            borderRadius: '6px',
            pointerEvents: 'none',
          }}
        >
          {/* Rule of Thirds Vertical Hairlines */}
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
          {/* Rule of Thirds Horizontal Hairlines */}
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

          {/* Rangefinder Center Split-Prism Reticle */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '44px',
              height: '44px',
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              border: '1px solid rgba(255, 232, 196, 0.42)',
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
                background: 'rgba(255, 206, 138, 0.78)',
              }}
            />
          </div>

          {/* Corner Brackets */}
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

      {/* Top Viewfinder Exposure Telemetry Bar + Close Button */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '20px',
          right: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pointerEvents: 'auto',
        }}
      >
        <div
          style={{
            ...GLASS_PILL_STYLE,
            borderRadius: '999px',
            padding: '7px 15px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontFamily: UI_FONTS.mono,
            fontSize: '11.5px',
          }}
        >
          <span style={{ color: UI_COLORS.warmAmber }}>35MM RANGEFINDER</span>
          <span style={{ opacity: 0.35 }}>•</span>
          <span>ISO 400</span>
          <span style={{ opacity: 0.35 }}>•</span>
          <span>f/2.8</span>
          <span style={{ opacity: 0.35 }}>•</span>
          <span>{photoFocalMm}mm</span>
          <span style={{ opacity: 0.35 }}>•</span>
          <span>
            {atmosphere.timeLabel} ({altitudeASL.toLocaleString('en-US')}m)
          </span>
        </div>

        <button
          type="button"
          onClick={() => setPhotoMode(false)}
          className="dalat-glass-btn"
          style={{
            ...GLASS_PILL_STYLE,
            borderRadius: '999px',
            padding: '7px 14px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
          }}
        >
          <X size={14} />
          <span>Thoát [Esc]</span>
        </button>
      </div>

      {/* Bottom Camera Controls Bar (when composing) */}
      {!latestCapturedPolaroid && (
        <div
          style={{
            position: 'absolute',
            bottom: '18px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            width: 'max-content',
            maxWidth: 'calc(100vw - 24px)',
            pointerEvents: 'auto',
          }}
        >
          {/* Focal Length Selector: 24mm | 35mm | 50mm | 85mm */}
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '5px',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
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
                    padding: '6px 10px',
                    borderRadius: '999px',
                    fontFamily: UI_FONTS.mono,
                    fontSize: '11.5px',
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
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '5px',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
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
                    padding: '6px 11px',
                    borderRadius: '999px',
                    fontSize: '11.5px',
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

          {/* Analog Silver Shutter Button [Space / Click] */}
          <button
            type="button"
            onClick={() => {
              if (photoCountdown === 0) requestPhotoShutter();
            }}
            title="Bấm chụp ảnh [Space / Click]"
            className="dalat-glass-btn"
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, #FFF8EC 0%, #E7D2B0 100%)',
              border: '3px solid rgba(255, 255, 255, 0.85)',
              boxShadow: '0 0 0 3px rgba(18, 25, 38, 0.7), 0 8px 24px rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#1C2331',
            }}
          >
            <Camera size={22} strokeWidth={2} />
          </button>

          {/* [Ẩn đám đông] & [Hẹn giờ nhóm 3s] */}
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '5px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <button
              type="button"
              onClick={() => setPhotoOptions({ photoHideCrowd: !photoHideCrowd })}
              className="dalat-glass-btn"
              style={{
                padding: '6px 12px',
                borderRadius: '999px',
                fontSize: '11.5px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
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
              onClick={() => {
                if (photoCountdown === 0) setPhotoOptions({ photoCountdown: 3 });
              }}
              className="dalat-glass-btn"
              style={{
                padding: '6px 12px',
                borderRadius: '999px',
                fontSize: '11.5px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: photoCountdown > 0 ? 'rgba(243, 195, 130, 0.24)' : 'transparent',
                border: `1px solid ${photoCountdown > 0 ? UI_COLORS.warmAmber : 'transparent'}`,
                color: photoCountdown > 0 ? UI_COLORS.warmAmber : UI_COLORS.cream,
              }}
            >
              <Timer size={13} />
              <span>Hẹn giờ nhóm 3s</span>
            </button>
          </div>
        </div>
      )}

      {/* DEVELOPED POLAROID PREVIEW CARD */}
      {latestCapturedPolaroid && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(8, 12, 20, 0.68)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              ...GLASS_MODAL_STYLE,
              borderRadius: '24px',
              padding: '22px',
              width: 'min(440px, 100%)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              animation: 'dalatFadeUp 320ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <img
              src={latestCapturedPolaroid.imageDataUrl}
              alt="Ảnh Polaroid Đà Lạt"
              style={{
                width: '100%',
                borderRadius: '8px',
                boxShadow: '0 14px 36px rgba(0, 0, 0, 0.48)',
                display: 'block',
              }}
            />

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '11.5px',
                  color: UI_COLORS.mistText,
                  marginBottom: '6px',
                }}
              >
                Dòng lưu bút trên ảnh Polaroid
              </label>
              <input
                type="text"
                value={captionDraft}
                maxLength={54}
                onChange={(e) => handleCaptionChange(e.target.value)}
                placeholder="Ghi đôi lời kỷ niệm săn mây..."
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '11px',
                  background: 'rgba(10, 14, 24, 0.55)',
                  border: `1px solid ${UI_COLORS.border}`,
                  color: UI_COLORS.cream,
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                onClick={handleDownload}
                className="dalat-glass-btn"
                style={{
                  padding: '10px 12px',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.07)',
                  border: `1px solid ${UI_COLORS.borderStrong}`,
                  color: UI_COLORS.cream,
                  fontSize: '12.5px',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                }}
              >
                <Download size={14} />
                <span>Tải ảnh về máy</span>
              </button>

              <button
                type="button"
                disabled={hasPinned}
                onClick={handlePinToWall}
                className="dalat-glass-btn"
                style={{
                  padding: '10px 12px',
                  borderRadius: '12px',
                  background: hasPinned
                    ? 'rgba(130, 179, 154, 0.24)'
                    : 'linear-gradient(135deg, rgba(226, 152, 86, 0.9), rgba(196, 112, 68, 0.9))',
                  border: `1px solid ${hasPinned ? '#82B39A' : 'rgba(255, 226, 182, 0.5)'}`,
                  color: hasPinned ? '#C6EBD5' : '#181E2B',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                }}
              >
                <Pin size={14} />
                <span>{hasPinned ? 'Đã ghim lên bảng' : 'Ghim lên Bảng ảnh'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setLatestCapturedPolaroid(null)}
              className="dalat-glass-btn"
              style={{
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
