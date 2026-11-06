import { FormEvent, useEffect, useState } from 'react';
import { CloudSun, Compass, Sparkles } from 'lucide-react';
import { CoatStyleId, HIGHLAND_PALETTE } from '@dalat/protocol';
import type { IMultiplayerController } from '../network/types';
import { useNetController } from '../gameplay/netBridge';
import { useGameStore } from '../store/gameStore';
import { GLASS_MODAL_STYLE, UI_COLORS, UI_FONTS } from './uiStyles';

const COAT_QUICK_LABELS: Array<{ id: CoatStyleId; label: string }> = [
  { id: 'wool_trench', label: 'Măng-tô dạ' },
  { id: 'knit_sweater', label: 'Len đan' },
  { id: 'puffer_vest', label: 'Gile phao' },
  { id: 'vintage_poncho', label: 'Poncho đồi' },
];

export function LandingOverlay({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);
  const displayName = useGameStore((s) => s.displayName);
  const outfit = useGameStore((s) => s.outfit);
  const atmosphere = useGameStore((s) => s.atmosphere);
  const connected = useGameStore((s) => s.connected);
  const currentRoomCode = useGameStore((s) => s.roomCode);

  const setDisplayName = useGameStore((s) => s.setDisplayName);
  const updateOutfit = useGameStore((s) => s.updateOutfit);
  const enterWorld = useGameStore((s) => s.enterWorld);

  const [nameInput, setNameInput] = useState(displayName);
  const [roomInput, setRoomInput] = useState(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') || '').trim().toUpperCase();
  });
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    setNameInput(displayName);
  }, [displayName]);

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
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        background:
          'radial-gradient(circle at 62% 44%, rgba(16, 24, 38, 0.08) 0%, rgba(12, 18, 30, 0.56) 100%)',
        pointerEvents: 'auto',
      }}
    >
      <form
        onSubmit={handleEnter}
        style={{
          ...GLASS_MODAL_STYLE,
          width: '100%',
          maxWidth: '460px',
          borderRadius: '26px',
          padding: '30px 30px 26px',
          animation: 'dalatFadeUp 480ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Poetic Eyebrow */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
            padding: '4px 11px',
            borderRadius: '999px',
            background: 'rgba(243, 195, 130, 0.12)',
            border: '1px solid rgba(243, 195, 130, 0.28)',
            color: UI_COLORS.warmAmber,
            fontSize: '11.5px',
            fontWeight: 500,
            letterSpacing: '0.04em',
            marginBottom: '14px',
          }}
        >
          <CloudSun size={13} strokeWidth={1.8} />
          <span>KHÔNG GIAN ĐA NGƯỜI CHƠI • CẦU ĐẤT 1,648M</span>
        </div>

        {/* Poetic Title */}
        <h1
          style={{
            fontFamily: UI_FONTS.serif,
            fontSize: '36px',
            fontWeight: 600,
            lineHeight: 1.12,
            letterSpacing: '-0.01em',
            color: UI_COLORS.cream,
            marginBottom: '8px',
          }}
        >
          Chạm Mây Đà Lạt
        </h1>

        <p
          style={{
            fontSize: '13.5px',
            lineHeight: 1.55,
            color: UI_COLORS.mistText,
            marginBottom: '16px',
          }}
        >
          Dạo bước giữa đồi chè mờ sương, cầm ly sữa đậu nành nóng, nghe tiếng đàn Guitar bên bếp
          lửa hồng và đón khoảnh khắc biển mây vàng rạng đông cùng bạn bè.
        </p>

        {/* Live World Weather & Telemetry Line */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 13px',
            borderRadius: '13px',
            background: 'rgba(10, 15, 25, 0.46)',
            border: `1px solid ${UI_COLORS.border}`,
            fontFamily: UI_FONTS.mono,
            fontSize: '11.5px',
            color: '#F5DEC0',
            marginBottom: '20px',
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
            gap: '10px',
            marginBottom: '16px',
          }}
        >
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11.5px',
                color: UI_COLORS.mistText,
                marginBottom: '6px',
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
                padding: '10px 12px',
                borderRadius: '12px',
                background: 'rgba(10, 15, 25, 0.55)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.cream,
                fontSize: '13.5px',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11.5px',
                color: UI_COLORS.mistText,
                marginBottom: '6px',
              }}
            >
              Mã phòng (tùy chọn)
            </label>
            <input
              type="text"
              value={roomInput}
              maxLength={14}
              onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
              placeholder="Tự động (MAY-01)"
              style={{
                width: '100%',
                padding: '10px 11px',
                borderRadius: '12px',
                background: 'rgba(10, 15, 25, 0.55)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.warmAmber,
                fontFamily: UI_FONTS.mono,
                fontSize: '12.5px',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Quick Coat Style Pills */}
        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '11.5px', color: UI_COLORS.mistText, marginBottom: '6px' }}>
            Áo ấm cao nguyên
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            {COAT_QUICK_LABELS.map((item) => {
              const active = outfit.coatStyle === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => updateOutfit({ coatStyle: item.id })}
                  className="dalat-glass-btn"
                  style={{
                    padding: '7px 6px',
                    borderRadius: '10px',
                    fontSize: '11.5px',
                    fontWeight: active ? 600 : 400,
                    background: active
                      ? 'rgba(243, 195, 130, 0.22)'
                      : 'rgba(255, 255, 255, 0.04)',
                    border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                    color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick Coat & Scarf Color Swatches */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '14px',
            marginBottom: '22px',
          }}
        >
          <div>
            <div style={{ fontSize: '11.5px', color: UI_COLORS.mistText, marginBottom: '7px' }}>
              Màu áo khoác
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {HIGHLAND_PALETTE.coats.map((hex) => {
                const selected = outfit.coatColor === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Màu áo ${hex}`}
                    onClick={() => updateOutfit({ coatColor: hex })}
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      background: hex,
                      cursor: 'pointer',
                      border: selected ? '2.5px solid #FFF8EB' : '1px solid rgba(255,255,255,0.25)',
                      boxShadow: selected ? '0 0 0 2px rgba(243,195,130,0.55)' : 'none',
                      transform: selected ? 'scale(1.1)' : 'scale(1)',
                      transition: 'transform 140ms ease',
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '11.5px', color: UI_COLORS.mistText, marginBottom: '7px' }}>
              Màu khăn len
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {HIGHLAND_PALETTE.scarves.map((hex) => {
                const selected = outfit.scarfColor === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Màu khăn ${hex}`}
                    onClick={() => updateOutfit({ scarfColor: hex })}
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      background: hex,
                      cursor: 'pointer',
                      border: selected ? '2.5px solid #FFF8EB' : '1px solid rgba(255,255,255,0.25)',
                      boxShadow: selected ? '0 0 0 2px rgba(243,195,130,0.55)' : 'none',
                      transform: selected ? 'scale(1.1)' : 'scale(1)',
                      transition: 'transform 140ms ease',
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Warm Entry CTA Button */}
        <button
          type="submit"
          disabled={entering}
          className="dalat-glass-btn"
          style={{
            width: '100%',
            padding: '13px 18px',
            borderRadius: '14px',
            border: '1px solid rgba(255, 226, 182, 0.55)',
            background:
              'linear-gradient(135deg, rgba(226, 152, 86, 0.92) 0%, rgba(196, 112, 68, 0.92) 100%)',
            color: '#161B26',
            fontFamily: UI_FONTS.sans,
            fontSize: '14.5px',
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
            marginTop: '12px',
            textAlign: 'center',
            fontSize: '11px',
            color: UI_COLORS.mutedText,
          }}
        >
          WASD di chuyển • Kéo chuột xoay góc nhìn • [P] Máy ảnh Film • [E] Tương tác
        </div>
      </form>
    </div>
  );
}
