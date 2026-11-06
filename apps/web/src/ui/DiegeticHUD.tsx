import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Camera,
  Coffee,
  Flame,
  Map as MapIcon,
  MessageCircle,
  Music,
  Shirt,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Sunrise,
  Users,
} from 'lucide-react';
import { EmoteId, gameYToASL, HeldItemId } from '@dalat/protocol';
import type { IMultiplayerController } from '../network/types';
import {
  executeInteractPrompt,
  HIGHLAND_GUITAR_CHORDS,
  isNearCampfireStage,
  playTemporaryEmote,
  triggerGuitarChord,
} from '../gameplay/interactions';
import { useNetController } from '../gameplay/netBridge';
import { UIOverlayModal, useGameStore } from '../store/gameStore';
import { GLASS_PILL_STYLE, UI_COLORS, UI_FONTS } from './uiStyles';

const HELD_PROP_OPTIONS: Array<{ id: HeldItemId; label: string; badge: string }> = [
  { id: 'soy_milk', label: 'Sữa đậu nành nóng', badge: '🥛' },
  { id: 'phin_coffee', label: 'Phin cà phê', badge: '☕' },
  { id: 'lantern', label: 'Đèn bão đồng', badge: '🏮' },
  { id: 'film_camera', label: 'Máy ảnh 35mm', badge: '📷' },
  { id: 'guitar', label: 'Guitar gỗ thông', badge: '🎸' },
  { id: 'none', label: 'Thả tay tự do', badge: '✨' },
];

const EMOTE_OPTIONS: Array<{ id: EmoteId; label: string }> = [
  { id: 'wave', label: '👋 Vẫy chào' },
  { id: 'warm_hands', label: '🤲 Xoa tay sưởi ấm' },
  { id: 'sip_drink', label: '☕ Nhấp ngụm ấm' },
  { id: 'cheers_cup', label: '🥂 Nâng ly cụng' },
  { id: 'cheer_sunrise', label: '🌅 Reo đón bình minh' },
  { id: 'sit_chill', label: '🧘 Ngồi ngắm mây' },
  { id: 'play_guitar', label: '🎶 Gảy đàn mộc' },
];

function formatWarmthTimer(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

export function DiegeticHUD({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);

  const atmosphere = useGameStore((s) => s.atmosphere);
  const warmthRemainingSec = useGameStore((s) => s.warmthRemainingSec);
  const roomCode = useGameStore((s) => s.roomCode);
  const connected = useGameStore((s) => s.connected);
  const peerCount = useGameStore((s) => Object.keys(s.peers).length + s.farBeacons.length);
  const heldItem = useGameStore((s) => s.heldItem);
  const activeEmote = useGameStore((s) => s.activeEmote);
  const activeModal = useGameStore((s) => s.activeModal);
  const nearbyPrompt = useGameStore((s) => s.nearbyPrompt);
  const toastBanner = useGameStore((s) => s.toastBanner);
  const lastJamNote = useGameStore((s) => s.lastJamNote);

  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const setPhotoMode = useGameStore((s) => s.setPhotoMode);
  const setHeldItem = useGameStore((s) => s.setHeldItem);

  const [altitudeASL, setAltitudeASL] = useState<number>(() =>
    gameYToASL(useGameStore.getState().localTransient.y)
  );
  const [nearCampfire, setNearCampfire] = useState<boolean>(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [emoteTrayOpen, setEmoteTrayOpen] = useState(false);
  const [stillnessFaded, setStillnessFaded] = useState(false);
  const [sunriseWhisper, setSunriseWhisper] = useState(false);

  const chatInputRef = useRef<HTMLInputElement>(null);
  const prevSunriseRef = useRef<boolean>(false);
  const lastActivityRef = useRef<number>(Date.now());

  // Poll live altitude & campfire proximity gently at 2.5 Hz (zero 60Hz re-renders!)
  useEffect(() => {
    const timer = setInterval(() => {
      const lt = useGameStore.getState().localTransient;
      const nextAlt = gameYToASL(lt.y);
      setAltitudeASL((prev) => (prev !== nextAlt ? nextAlt : prev));
      const nextCamp = isNearCampfireStage(lt.x, lt.z);
      setNearCampfire((prev) => (prev !== nextCamp ? nextCamp : prev));
    }, 400);
    return () => clearInterval(timer);
  }, []);

  // Poetic Sunrise Whisper Banner when isSunriseWindow transitions in
  useEffect(() => {
    if (atmosphere.isSunriseWindow && !prevSunriseRef.current) {
      setSunriseWhisper(true);
      const t = setTimeout(() => setSunriseWhisper(false), 9000);
      prevSunriseRef.current = true;
      return () => clearTimeout(t);
    }
    if (!atmosphere.isSunriseWindow) {
      prevSunriseRef.current = false;
    }
  }, [atmosphere.isSunriseWindow]);

  // 4.5s Stillness Auto-Fade when no modal, chat, or tray is open
  useEffect(() => {
    const markActive = () => {
      lastActivityRef.current = Date.now();
      setStillnessFaded((prev) => (prev ? false : prev));
    };

    window.addEventListener('pointermove', markActive, { passive: true });
    window.addEventListener('pointerdown', markActive, { passive: true });
    window.addEventListener('keydown', markActive);
    window.addEventListener('touchstart', markActive, { passive: true });

    const checkInterval = setInterval(() => {
      const st = useGameStore.getState();
      const idleMs = Date.now() - lastActivityRef.current;
      const canFade =
        st.activeModal === 'none' &&
        !chatOpen &&
        !emoteTrayOpen &&
        !st.photoModeActive &&
        idleMs >= 4500;
      setStillnessFaded((prev) => (prev !== canFade ? canFade : prev));
    }, 500);

    return () => {
      window.removeEventListener('pointermove', markActive);
      window.removeEventListener('pointerdown', markActive);
      window.removeEventListener('keydown', markActive);
      window.removeEventListener('touchstart', markActive);
      clearInterval(checkInterval);
    };
  }, [chatOpen, emoteTrayOpen]);

  // Global [Enter] for Proximity Chat & [Tab] for Emote/Prop tray
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const st = useGameStore.getState();
      if (!st.hasEnteredWorld || st.photoModeActive) return;

      const activeTag = document.activeElement?.tagName;
      const inInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA';

      if (e.key === 'Enter' && st.activeModal === 'none') {
        if (!chatOpen && !inInput) {
          e.preventDefault();
          setEmoteTrayOpen(false);
          setChatOpen(true);
          setTimeout(() => chatInputRef.current?.focus(), 20);
        }
      } else if (e.key === 'Tab' && st.activeModal === 'none' && !inInput) {
        e.preventDefault();
        setChatOpen(false);
        setEmoteTrayOpen((v) => !v);
      } else if (e.key === 'Escape') {
        if (chatOpen) {
          setChatOpen(false);
          chatInputRef.current?.blur();
        }
        if (emoteTrayOpen) {
          setEmoteTrayOpen(false);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chatOpen, emoteTrayOpen]);

  const handleSendChat = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = chatText.trim().slice(0, 140);
    if (trimmed) {
      const st = useGameStore.getState();
      const prevCount = st.chatBubbles.length;
      net.sendChat(trimmed);
      // Ensure immediate local chat bubble even if disconnected/offline
      if (!st.connected && useGameStore.getState().chatBubbles.length === prevCount) {
        st.pushChatBubble({
          id: `local-${Date.now()}`,
          senderId: st.localSessionId || 'local',
          senderName: st.displayName,
          text: trimmed,
          x: st.localTransient.x,
          y: st.localTransient.y,
          z: st.localTransient.z,
          timestamp: Date.now(),
        });
      }
    }
    setChatText('');
    setChatOpen(false);
  };

  const toggleModal = (modal: UIOverlayModal) => {
    setChatOpen(false);
    setEmoteTrayOpen(false);
    if (modal === 'channels') {
      net.refreshChannels().catch(() => {});
    }
    setActiveModal(activeModal === modal ? 'none' : modal);
  };

  const selectProp = (item: HeldItemId) => {
    setHeldItem(item);
    net.sendHeldItem(item);
  };

  const showGuitarChordBar = nearCampfire || heldItem === 'guitar';
  const recentJamActive = lastJamNote && Date.now() - lastJamNote.timestamp < 4200;
  const hudChromeOpacity = stillnessFaded ? 0.2 : 1;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 30,
        pointerEvents: 'none',
        fontFamily: UI_FONTS.sans,
      }}
    >
      {/* TOP-LEFT: Micro Weather, Altitude, Warmth Badge & Channel Pill */}
      <div
        style={{
          position: 'absolute',
          top: '18px',
          left: '18px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '8px',
          opacity: hudChromeOpacity,
          transition: 'opacity 550ms ease',
          pointerEvents: 'auto',
        }}
      >
        <div
          style={{
            ...GLASS_PILL_STYLE,
            borderRadius: '999px',
            padding: '7px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            fontSize: '12px',
          }}
        >
          <span style={{ fontFamily: UI_FONTS.mono, color: UI_COLORS.warmAmber, fontWeight: 500 }}>
            {atmosphere.timeLabel}
          </span>
          <span style={{ opacity: 0.35 }}>•</span>
          <span style={{ fontFamily: UI_FONTS.mono }}>
            {altitudeASL.toLocaleString('en-US')}m ASL
          </span>
          <span style={{ opacity: 0.35 }}>•</span>
          <span style={{ fontFamily: UI_FONTS.mono }}>
            {atmosphere.temperatureC.toFixed(1)}°C
          </span>
          <span style={{ opacity: 0.35 }}>•</span>
          <span style={{ color: '#EFE7DA', fontWeight: 400 }}>{atmosphere.weatherLabel}</span>

          {warmthRemainingSec > 0 && (
            <span
              title="Hơi ấm cao nguyên: +12% tốc độ bước chạy & giữ ấm hơi thở"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                marginLeft: '4px',
                padding: '2px 8px',
                borderRadius: '999px',
                background: 'rgba(236, 154, 108, 0.22)',
                border: '1px solid rgba(243, 195, 130, 0.42)',
                color: UI_COLORS.warmAmber,
                fontFamily: UI_FONTS.mono,
                fontSize: '11px',
              }}
            >
              <Coffee size={11} strokeWidth={2} />
              <span>{formatWarmthTimer(warmthRemainingSec)}</span>
            </span>
          )}
        </div>

        {/* Channel & Live Cloud-Hunter Count Pill */}
        <button
          type="button"
          onClick={() => toggleModal('channels')}
          className="dalat-glass-btn"
          style={{
            ...GLASS_PILL_STYLE,
            borderRadius: '999px',
            padding: '6px 13px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
            fontSize: '11.5px',
          }}
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: connected ? '#82D69E' : UI_COLORS.warmAmber,
              boxShadow: connected
                ? '0 0 8px rgba(130, 214, 158, 0.7)'
                : '0 0 8px rgba(243, 195, 130, 0.6)',
            }}
          />
          <span style={{ fontFamily: UI_FONTS.mono, color: UI_COLORS.warmAmber, fontWeight: 500 }}>
            {roomCode || 'MAY-01'}
          </span>
          <span style={{ opacity: 0.4 }}>•</span>
          <Users size={12} strokeWidth={1.8} style={{ opacity: 0.8 }} />
          <span>{peerCount + 1} người đang săn mây</span>
        </button>
      </div>

      {/* TOP-CENTER: Poetic Sunrise Whisper Banner & Discovery Toasts */}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          maxWidth: '90vw',
          pointerEvents: 'none',
        }}
      >
        {sunriseWhisper && (
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '9px 20px',
              border: '1px solid rgba(255, 210, 154, 0.42)',
              background:
                'linear-gradient(90deg, rgba(28, 24, 38, 0.72) 0%, rgba(56, 36, 42, 0.74) 50%, rgba(28, 24, 38, 0.72) 100%)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              animation: 'dalatFadeUp 600ms ease',
            }}
          >
            <Sunrise size={16} strokeWidth={1.8} style={{ color: '#FFB87A', flexShrink: 0 }} />
            <span
              style={{
                fontFamily: UI_FONTS.serif,
                fontStyle: 'italic',
                fontSize: '14px',
                color: '#FFF3E2',
              }}
            >
              Chân trời phía Đông đang ửng hồng... Bình minh Cầu Đất đang lên.
            </span>
          </div>
        )}

        {toastBanner && (
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '8px 18px',
              border: `1px solid ${UI_COLORS.borderStrong}`,
              fontSize: '12.5px',
              color: UI_COLORS.cream,
              animation: 'dalatFadeUp 260ms ease',
              textAlign: 'center',
            }}
          >
            {toastBanner}
          </div>
        )}
      </div>

      {/* LOWER-CENTER STACK: Acoustic Guitar Bar, Context [E] Prompt, Chat Input, Emote Tray, & Floating Glass Dock */}
      <div
        style={{
          position: 'absolute',
          bottom: '18px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px',
          width: 'max-content',
          maxWidth: 'calc(100vw - 24px)',
          pointerEvents: 'none',
        }}
      >
        {/* Campfire Acoustic Guitar 1-6 Chord Bar */}
        {showGuitarChordBar && activeModal === 'none' && (
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '18px',
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              pointerEvents: 'auto',
              animation: 'dalatFadeUp 240ms ease',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                color: UI_COLORS.warmAmber,
              }}
            >
              <Flame size={12} strokeWidth={2} />
              <span>Hòa âm Guitar Acoustic bên lửa hồng (Phím 1–6)</span>
              {recentJamActive && lastJamNote && (
                <span style={{ color: '#FFEBD0', marginLeft: '4px' }}>
                  • ♪ {lastJamNote.senderName}:{' '}
                  {HIGHLAND_GUITAR_CHORDS[lastJamNote.chordIndex]?.name || 'Cadd9'}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px' }}>
              {HIGHLAND_GUITAR_CHORDS.map((ch) => {
                const justPlayed =
                  recentJamActive && lastJamNote?.chordIndex === ch.index;
                return (
                  <button
                    key={ch.index}
                    type="button"
                    onClick={() => triggerGuitarChord(ch.index, net)}
                    className="dalat-glass-btn"
                    title={ch.mood}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '10px',
                      background: justPlayed
                        ? 'rgba(243, 195, 130, 0.28)'
                        : 'rgba(255, 255, 255, 0.05)',
                      border: `1px solid ${justPlayed ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: UI_COLORS.cream,
                      fontSize: '11.5px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: UI_FONTS.mono,
                        fontSize: '10.5px',
                        color: UI_COLORS.warmAmber,
                      }}
                    >
                      [{ch.key}]
                    </span>
                    <span style={{ fontWeight: 500 }}>{ch.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Context-Aware Soft Glowing Proximity Interaction Pill [E] */}
        {nearbyPrompt && activeModal === 'none' && !chatOpen && (
          <button
            type="button"
            onClick={() => executeInteractPrompt(nearbyPrompt, net)}
            className="dalat-glass-btn"
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '9px 18px',
              border: '1px solid rgba(243, 195, 130, 0.45)',
              boxShadow: '0 8px 28px rgba(10, 14, 24, 0.45), 0 0 18px rgba(243, 195, 130, 0.16)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              pointerEvents: 'auto',
              animation: 'dalatFadeUp 200ms ease',
            }}
          >
            <span
              style={{
                padding: '2px 7px',
                borderRadius: '6px',
                background: 'rgba(243, 195, 130, 0.22)',
                border: '1px solid rgba(243, 195, 130, 0.5)',
                color: UI_COLORS.warmAmber,
                fontFamily: UI_FONTS.mono,
                fontSize: '11.5px',
                fontWeight: 600,
              }}
            >
              E
            </span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '13px', fontWeight: 500, color: UI_COLORS.cream }}>
                {nearbyPrompt.label}
              </div>
              {nearbyPrompt.sublabel && (
                <div style={{ fontSize: '10.5px', color: UI_COLORS.mistText }}>
                  {nearbyPrompt.sublabel}
                </div>
              )}
            </div>
          </button>
        )}

        {/* [Tab] Emotes & Da Lat Props Drawer */}
        {emoteTrayOpen && activeModal === 'none' && (
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '20px',
              padding: '14px 16px',
              width: 'min(480px, calc(100vw - 28px))',
              pointerEvents: 'auto',
              animation: 'dalatFadeUp 200ms ease',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                color: UI_COLORS.warmAmber,
                letterSpacing: '0.04em',
                marginBottom: '8px',
                fontWeight: 600,
              }}
            >
              ĐẠO CỤ ĐÀ LẠT TRÊN TAY
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '6px',
                marginBottom: '12px',
              }}
            >
              {HELD_PROP_OPTIONS.map((p) => {
                const selected = heldItem === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProp(p.id)}
                    className="dalat-glass-btn"
                    style={{
                      padding: '7px 8px',
                      borderRadius: '11px',
                      background: selected
                        ? 'rgba(243, 195, 130, 0.24)'
                        : 'rgba(255, 255, 255, 0.04)',
                      border: `1px solid ${selected ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: UI_COLORS.cream,
                      fontSize: '11.5px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>{p.badge}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              style={{
                fontSize: '11px',
                color: UI_COLORS.warmAmber,
                letterSpacing: '0.04em',
                marginBottom: '8px',
                fontWeight: 600,
              }}
            >
              BIỂU CẢM SƯƠNG SỚM
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {EMOTE_OPTIONS.map((em) => {
                const active = activeEmote === em.id;
                return (
                  <button
                    key={em.id}
                    type="button"
                    onClick={() => playTemporaryEmote(em.id, net, 4000)}
                    className="dalat-glass-btn"
                    style={{
                      padding: '6px 10px',
                      borderRadius: '999px',
                      background: active
                        ? 'rgba(243, 195, 130, 0.24)'
                        : 'rgba(255, 255, 255, 0.04)',
                      border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: UI_COLORS.cream,
                      fontSize: '11.5px',
                    }}
                  >
                    {em.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* [Enter] Proximity Chat Floating Bar */}
        {chatOpen && (
          <form
            onSubmit={handleSendChat}
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '6px 8px 6px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: 'min(430px, calc(100vw - 28px))',
              pointerEvents: 'auto',
              animation: 'dalatFadeUp 160ms ease',
            }}
          >
            <input
              ref={chatInputRef}
              type="text"
              value={chatText}
              maxLength={140}
              onChange={(e) => setChatText(e.target.value)}
              placeholder="Trò chuyện cùng người quanh đồi (35m)..."
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: UI_COLORS.cream,
                fontSize: '13px',
              }}
            />
            <button
              type="submit"
              className="dalat-glass-btn"
              style={{
                padding: '6px 13px',
                borderRadius: '999px',
                background: 'rgba(243, 195, 130, 0.24)',
                border: `1px solid ${UI_COLORS.warmAmber}`,
                color: UI_COLORS.warmAmber,
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              Gửi
            </button>
          </form>
        )}

        {/* Bottom-Center Floating Glass Dock */}
        <div
          style={{
            ...GLASS_PILL_STYLE,
            borderRadius: '999px',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            opacity: hudChromeOpacity,
            transition: 'opacity 550ms ease',
            pointerEvents: 'auto',
          }}
        >
          <DockIconButton
            icon={<MessageCircle size={16} strokeWidth={1.75} />}
            label="Trò chuyện"
            shortcut="Enter"
            active={chatOpen}
            onClick={() => {
              setEmoteTrayOpen(false);
              setChatOpen((v) => {
                const next = !v;
                if (next) setTimeout(() => chatInputRef.current?.focus(), 20);
                return next;
              });
            }}
          />
          <DockIconButton
            icon={<Smile size={16} strokeWidth={1.75} />}
            label="Biểu cảm & Đạo cụ"
            shortcut="Tab"
            active={emoteTrayOpen}
            onClick={() => {
              setChatOpen(false);
              setEmoteTrayOpen((v) => !v);
            }}
          />
          <DockIconButton
            icon={<Camera size={16} strokeWidth={1.75} />}
            label="Máy ảnh Film"
            shortcut="P"
            active={false}
            highlight
            onClick={() => {
              if (heldItem !== 'film_camera') {
                setHeldItem('film_camera');
                net.sendHeldItem('film_camera');
              }
              setPhotoMode(true);
            }}
          />
          <DockIconButton
            icon={<MapIcon size={16} strokeWidth={1.75} />}
            label="Bản đồ Sổ tay"
            shortcut="M"
            active={activeModal === 'map'}
            onClick={() => toggleModal('map')}
          />
          <DockIconButton
            icon={<BookOpen size={16} strokeWidth={1.75} />}
            label="Sổ tay Săn mây"
            shortcut="J"
            active={activeModal === 'almanac'}
            onClick={() => toggleModal('almanac')}
          />
          <DockIconButton
            icon={<Shirt size={16} strokeWidth={1.75} />}
            label="Tủ đồ Áo ấm"
            active={activeModal === 'wardrobe'}
            onClick={() => toggleModal('wardrobe')}
          />
          <DockIconButton
            icon={<Sparkles size={16} strokeWidth={1.75} />}
            label="Bảng ảnh Polaroid"
            active={activeModal === 'polaroids'}
            onClick={() => toggleModal('polaroids')}
          />
          <DockIconButton
            icon={<Music size={16} strokeWidth={1.75} />}
            label="Thẻ ước nguyện"
            active={activeModal === 'windchimes'}
            onClick={() => toggleModal('windchimes')}
          />
          <DockIconButton
            icon={<SlidersHorizontal size={16} strokeWidth={1.75} />}
            label="Cài đặt & Giờ Khí Tượng"
            active={activeModal === 'settings'}
            onClick={() => toggleModal('settings')}
          />
        </div>
      </div>
    </div>
  );
}

function DockIconButton(props: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  highlight?: boolean;
  onClick: () => void;
}) {
  const { icon, label, shortcut, active, highlight, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      title={shortcut ? `[${shortcut}] ${label}` : label}
      aria-label={label}
      className="dalat-glass-btn"
      style={{
        padding: '8px 11px',
        borderRadius: '999px',
        background: active
          ? 'rgba(243, 195, 130, 0.24)'
          : highlight
            ? 'rgba(243, 195, 130, 0.11)'
            : 'transparent',
        border: `1px solid ${
          active
            ? UI_COLORS.warmAmber
            : highlight
              ? 'rgba(243, 195, 130, 0.26)'
              : 'transparent'
        }`,
        color: active || highlight ? UI_COLORS.warmAmber : UI_COLORS.cream,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '12px',
      }}
    >
      {icon}
      {shortcut && (
        <span
          style={{
            fontFamily: UI_FONTS.mono,
            fontSize: '10px',
            opacity: 0.72,
          }}
        >
          {shortcut}
        </span>
      )}
    </button>
  );
}
