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
import { EmoteId, gameYToASL, HELD_PROP_CATALOG, HeldItemId } from '@dalat/protocol';
import type { IMultiplayerController } from '../network/types';
import {
  executeInteractPrompt,
  executePeerSocialAction,
  HIGHLAND_GUITAR_CHORDS,
  isNearCampfireStage,
  playTemporaryEmote,
  triggerGuitarChord,
} from '../gameplay/interactions';
import { useNetController } from '../gameplay/netBridge';
import { UIOverlayModal, useGameStore } from '../store/gameStore';
import { HeldPropThumbnail, VisualChoiceCard } from './GarmentAndPropThumbnail';
import { GLASS_PILL_STYLE, UI_COLORS, UI_FONTS } from './uiStyles';

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
  const nearbyPeer = useGameStore((s) => s.nearbyPeer);
  const selectedPeerSessionId = useGameStore((s) => s.selectedPeerSessionId);
  const incomingSocialPrompt = useGameStore((s) => s.incomingSocialPrompt);
  const toastBanner = useGameStore((s) => s.toastBanner);
  const lastJamNote = useGameStore((s) => s.lastJamNote);

  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const setPhotoMode = useGameStore((s) => s.setPhotoMode);
  const setHeldItem = useGameStore((s) => s.setHeldItem);
  const setSelectedPeer = useGameStore((s) => s.setSelectedPeer);
  const setIncomingSocialPrompt = useGameStore((s) => s.setIncomingSocialPrompt);

  const [altitudeASL, setAltitudeASL] = useState<number>(() =>
    gameYToASL(useGameStore.getState().localTransient.y)
  );
  const [nearCampfire, setNearCampfire] = useState<boolean>(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [emoteTrayOpen, setEmoteTrayOpen] = useState(false);
  const [controlsGuideOpen, setControlsGuideOpen] = useState(true);
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
        !st.nearbyPeer &&
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

      {/* TOP-RIGHT: Clear Collapsible Controls & Actions Guide */}
      {activeModal === 'none' && (
        <div
          style={{
            position: 'absolute',
            top: '18px',
            right: '18px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '6px',
            opacity: hudChromeOpacity,
            transition: 'opacity 550ms ease',
            pointerEvents: 'auto',
            maxWidth: '305px',
          }}
        >
          <button
            type="button"
            onClick={() => setControlsGuideOpen((v) => !v)}
            className="dalat-glass-btn"
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '6px 13px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              fontSize: '11.5px',
              color: UI_COLORS.warmAmber,
              border: `1px solid ${controlsGuideOpen ? 'rgba(243, 195, 130, 0.42)' : UI_COLORS.border}`,
            }}
          >
            <span>⌨️ Hướng dẫn thao tác</span>
            <span style={{ opacity: 0.65, fontSize: '10px' }}>{controlsGuideOpen ? '▲ Thu gọn' : '▼ Mở xem'}</span>
          </button>

          {controlsGuideOpen && (
            <div
              style={{
                ...GLASS_PILL_STYLE,
                borderRadius: '16px',
                padding: '10px 13px',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                fontSize: '11.5px',
                color: UI_COLORS.cream,
                border: '1px solid rgba(255, 232, 204, 0.22)',
                lineHeight: 1.4,
                width: '100%',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                <span style={{ color: UI_COLORS.warmAmber, fontFamily: UI_FONTS.mono, fontWeight: 600 }}>WASD / ↑↓←→</span>
                <span style={{ color: UI_COLORS.mistText }}>Di chuyển • <b style={{ color: UI_COLORS.cream }}>Shift</b> Chạy</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                <span style={{ color: UI_COLORS.warmAmber, fontFamily: UI_FONTS.mono, fontWeight: 600 }}>Kéo chuột / 2 ngón</span>
                <span style={{ color: UI_COLORS.mistText }}>Xoay góc nhìn 360°</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                <span style={{ color: UI_COLORS.warmAmber, fontFamily: UI_FONTS.mono, fontWeight: 600 }}>Cuộn chuột / Space</span>
                <span style={{ color: UI_COLORS.mistText }}>Thu phóng • Nhảy</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                <span style={{ color: UI_COLORS.warmAmber, fontFamily: UI_FONTS.mono, fontWeight: 600 }}>Phím [E] / Click</span>
                <span style={{ color: UI_COLORS.mistText }}>Ngồi ghế, Pha cà phê, Đọc thẻ</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                <span style={{ color: UI_COLORS.warmAmber, fontFamily: UI_FONTS.mono, fontWeight: 600 }}>Click người chơi</span>
                <span style={{ color: UI_COLORS.mistText }}>Chào, Cụng ly, Tặng hoa, Chat</span>
              </div>
            </div>
          )}
        </div>
      )}

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

        {/* Quick-Meet Social Interaction Bar when encountering or clicking another cloud-hunter */}
        {nearbyPeer && activeModal === 'none' && !chatOpen && (
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '20px',
              padding: '10px 15px',
              border: '1px solid rgba(243, 195, 130, 0.48)',
              boxShadow: '0 10px 30px rgba(10, 14, 24, 0.52), 0 0 20px rgba(243, 195, 130, 0.16)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '7px',
              pointerEvents: 'auto',
              animation: 'dalatFadeUp 200ms ease',
              maxWidth: 'min(580px, calc(100vw - 24px))',
            }}
          >
            {/* Reciprocal Incoming Social Prompt Banner */}
            {incomingSocialPrompt && incomingSocialPrompt.fromId === nearbyPeer.sessionId && (
              <div
                style={{
                  width: '100%',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  background: 'rgba(243, 195, 130, 0.22)',
                  border: '1px solid rgba(243, 195, 130, 0.52)',
                  color: '#FFF3DC',
                  fontSize: '11.5px',
                  fontWeight: 500,
                  textAlign: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <span>
                  ✨ <b>{incomingSocialPrompt.fromName}</b> vừa{' '}
                  {incomingSocialPrompt.kind === 'cheers'
                    ? 'nâng ly cụng ấm cùng bạn'
                    : incomingSocialPrompt.kind === 'gift_flower'
                      ? 'tặng hoa Cẩm Tú Cầu cho bạn'
                      : incomingSocialPrompt.kind === 'sparkler'
                        ? 'rủ bạn đốt pháo bông'
                        : incomingSocialPrompt.kind === 'cheer'
                          ? 'reo vui đón mây cùng bạn'
                          : 'vẫy tay chào bạn'}{' '}
                  — Chọn hành động bên dưới để đáp lại!
                </span>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                gap: '8px',
                fontSize: '12px',
                color: UI_COLORS.mistText,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <Users size={13} strokeWidth={2} style={{ color: UI_COLORS.warmAmber }} />
                <span>Tương tác với:</span>
                <span style={{ fontWeight: 600, color: UI_COLORS.warmAmber, fontSize: '12.5px' }}>
                  {nearbyPeer.displayName}
                </span>
                <span style={{ opacity: 0.65, fontFamily: UI_FONTS.mono, fontSize: '11px' }}>
                  ({nearbyPeer.distance.toFixed(1)}m)
                </span>
                {nearbyPeer.seatId && (
                  <span
                    style={{
                      padding: '1px 7px',
                      borderRadius: '999px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      fontSize: '10.5px',
                      color: '#FFE6C2',
                    }}
                  >
                    🪑 Đang ngồi ngắm mây
                  </span>
                )}
              </div>

              {selectedPeerSessionId && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPeer(null);
                    setIncomingSocialPrompt(null);
                  }}
                  className="dalat-glass-btn"
                  title="Bỏ chọn người chơi này"
                  style={{
                    padding: '1px 7px',
                    borderRadius: '999px',
                    background: 'rgba(255,255,255,0.06)',
                    border: `1px solid ${UI_COLORS.border}`,
                    color: UI_COLORS.mistText,
                    fontSize: '10.5px',
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Primary Social Action Buttons */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px' }}>
              {[
                { kind: 'greet' as const, key: 'G', label: '👋 Vẫy chào' },
                { kind: 'cheers' as const, key: 'H', label: '☕ Cụng ly ấm (+8p)', highlight: true },
                { kind: 'cheer' as const, key: 'V', label: '🙌 Reo đón mây' },
                { kind: 'gift_flower' as const, key: 'F', label: '💐 Tặng hoa Tú Cầu', highlight: true },
                { kind: 'sparkler' as const, key: 'B', label: '✨ Đốt pháo bông' },
                { kind: 'photo' as const, key: 'C', label: '📸 Chụp chung' },
              ].map((btn) => (
                <button
                  key={btn.kind}
                  type="button"
                  onClick={() => executePeerSocialAction(btn.kind, nearbyPeer, net)}
                  className="dalat-glass-btn"
                  style={{
                    padding: '5px 11px',
                    borderRadius: '999px',
                    background: btn.highlight
                      ? 'rgba(243, 195, 130, 0.2)'
                      : 'rgba(255, 255, 255, 0.06)',
                    border: `1px solid ${
                      btn.highlight ? 'rgba(243, 195, 130, 0.48)' : UI_COLORS.border
                    }`,
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
                      fontSize: '10px',
                      padding: '1px 5px',
                      borderRadius: '5px',
                      background: 'rgba(243, 195, 130, 0.22)',
                      color: UI_COLORS.warmAmber,
                      fontWeight: 600,
                    }}
                  >
                    {btn.key}
                  </span>
                  <span>{btn.label}</span>
                </button>
              ))}

              {/* Sit Together Button if peer is on a 2-seater bench or near benches */}
              <button
                type="button"
                onClick={() => executePeerSocialAction('sit_together', nearbyPeer, net)}
                className="dalat-glass-btn"
                style={{
                  padding: '5px 11px',
                  borderRadius: '999px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: `1px solid ${UI_COLORS.border}`,
                  color: UI_COLORS.cream,
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <span>🪑 Ngồi cạnh nhau</span>
              </button>
            </div>

            {/* 1-Click Quick-Chat Greeting Chips */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '5px',
                paddingTop: '3px',
                borderTop: '1px solid rgba(255, 232, 204, 0.12)',
                width: '100%',
              }}
            >
              <span style={{ fontSize: '10.5px', color: UI_COLORS.mistText, marginRight: '2px' }}>
                💬 Nhắn nhanh:
              </span>
              {[
                { short: 'Sương đẹp quá ✨', full: `Sương sớm Đà Lạt hôm nay đẹp quá ${nearbyPeer.displayName} ơi! ✨` },
                { short: 'Uống sữa nóng không? 🥛', full: `Làm ly sữa đậu nành nóng cho ấm bụng nhé ${nearbyPeer.displayName}! 🥛` },
                { short: 'Qua ghế đôi ngồi nhé 🪑', full: `Qua ghế gỗ đôi ngồi ngắm biển mây cùng mình nè ${nearbyPeer.displayName}! 🪑` },
                { short: 'Gảy Guitar lửa trại 🎸', full: `Lại bếp lửa Mơ Sương gảy đàn Guitar cùng nhau đi ${nearbyPeer.displayName}! 🎸🔥` },
              ].map((preset) => (
                <button
                  key={preset.short}
                  type="button"
                  onClick={() => {
                    net.sendChat(preset.full);
                    useGameStore.getState().showToast(`💬 Đã gửi lời nhắn tới ${nearbyPeer.displayName}`);
                  }}
                  className="dalat-glass-btn"
                  style={{
                    padding: '3px 9px',
                    borderRadius: '999px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 232, 204, 0.18)',
                    color: '#EFE7DA',
                    fontSize: '10.5px',
                  }}
                >
                  {preset.short}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setEmoteTrayOpen(false);
                  setChatText(`@${nearbyPeer.displayName} `);
                  setChatOpen(true);
                  setTimeout(() => chatInputRef.current?.focus(), 20);
                }}
                className="dalat-glass-btn"
                style={{
                  padding: '3px 9px',
                  borderRadius: '999px',
                  background: 'rgba(243, 195, 130, 0.16)',
                  border: '1px solid rgba(243, 195, 130, 0.38)',
                  color: UI_COLORS.warmAmber,
                  fontSize: '10.5px',
                  fontWeight: 500,
                }}
              >
                ✏️ Tự gõ lời nhắn...
              </button>
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
              border: '1px solid rgba(243, 195, 130, 0.5)',
              boxShadow: '0 8px 28px rgba(10, 14, 24, 0.45), 0 0 18px rgba(243, 195, 130, 0.18)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              pointerEvents: 'auto',
              animation: 'dalatFadeUp 200ms ease',
            }}
          >
            <span
              style={{
                padding: '3px 8px',
                borderRadius: '7px',
                background: 'rgba(243, 195, 130, 0.25)',
                border: '1px solid rgba(243, 195, 130, 0.55)',
                color: UI_COLORS.warmAmber,
                fontFamily: UI_FONTS.mono,
                fontSize: '11.5px',
                fontWeight: 600,
              }}
            >
              Phím E / Click
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
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '6px',
                marginBottom: '12px',
                maxHeight: '210px',
                overflowY: 'auto',
                paddingRight: '2px',
              }}
            >
              {HELD_PROP_CATALOG.map((p) => (
                <VisualChoiceCard
                  key={p.id}
                  active={heldItem === p.id}
                  label={p.shortLabel}
                  title={`${p.title} — ${p.desc}`}
                  compact
                  thumbHeight={44}
                  onClick={() => selectProp(p.id)}
                  thumbnail={<HeldPropThumbnail itemId={p.id} size={42} />}
                />
              ))}
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

        {/* Bottom-Center Floating Glass Dock (hidden during full-stage Wardrobe preview) */}
        {activeModal !== 'wardrobe' && (
        <div
          style={{
            ...GLASS_PILL_STYLE,
            borderRadius: '999px',
            padding: '6px 10px',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '4px',
            opacity: hudChromeOpacity,
            transition: 'opacity 550ms ease',
            pointerEvents: 'auto',
          }}
        >
          <DockIconButton
            icon={<MessageCircle size={15} strokeWidth={1.75} />}
            label="Chat"
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
            icon={<Smile size={15} strokeWidth={1.75} />}
            label="Đạo cụ"
            shortcut="Tab"
            active={emoteTrayOpen}
            onClick={() => {
              setChatOpen(false);
              setEmoteTrayOpen((v) => !v);
            }}
          />
          <DockIconButton
            icon={<Camera size={15} strokeWidth={1.75} />}
            label="Máy ảnh"
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
            icon={<MapIcon size={15} strokeWidth={1.75} />}
            label="Bản đồ"
            shortcut="M"
            active={activeModal === 'map'}
            onClick={() => toggleModal('map')}
          />
          <DockIconButton
            icon={<BookOpen size={15} strokeWidth={1.75} />}
            label="Sổ tay"
            shortcut="J"
            active={activeModal === 'almanac'}
            onClick={() => toggleModal('almanac')}
          />
          <DockIconButton
            icon={<Shirt size={15} strokeWidth={1.75} />}
            label="Tủ đồ"
            shortcut="O"
            active={false}
            onClick={() => toggleModal('wardrobe')}
          />
          <DockIconButton
            icon={<Sparkles size={15} strokeWidth={1.75} />}
            label="Ảnh chung"
            active={activeModal === 'polaroids'}
            onClick={() => toggleModal('polaroids')}
          />
          <DockIconButton
            icon={<Music size={15} strokeWidth={1.75} />}
            label="Ước nguyện"
            active={activeModal === 'windchimes'}
            onClick={() => toggleModal('windchimes')}
          />
          <DockIconButton
            icon={<SlidersHorizontal size={15} strokeWidth={1.75} />}
            label="Giờ & Mây"
            active={activeModal === 'settings'}
            onClick={() => toggleModal('settings')}
          />
        </div>
        )}
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
        padding: '7px 11px',
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
        gap: '5px',
        fontSize: '11.5px',
      }}
    >
      {icon}
      <span style={{ fontWeight: 500 }}>{label}</span>
      {shortcut && (
        <span
          style={{
            fontFamily: UI_FONTS.mono,
            fontSize: '9.5px',
            padding: '1px 4px',
            borderRadius: '4px',
            background: 'rgba(255, 255, 255, 0.08)',
            opacity: 0.82,
          }}
        >
          {shortcut}
        </span>
      )}
    </button>
  );
}
