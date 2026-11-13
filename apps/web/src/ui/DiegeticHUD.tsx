import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Camera,
  ChevronDown,
  ChevronUp,
  Coffee,
  Flame,
  Link2,
  Map as MapIcon,
  MessageCircle,
  RotateCcw,
  Shirt,
  SlidersHorizontal,
  Smile,
  Sunrise,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import {
  EmoteId,
  gameYToASL,
  HELD_PROP_CATALOG,
  HeldItemId,
  resolveBenchSeatTransform,
  sampleWalkableHeight,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
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
import { useViewportLayout } from './useViewportLayout';

const EMOTE_OPTIONS: Array<{ id: EmoteId; label: string; short: string }> = [
  { id: 'wave', label: '👋 Vẫy chào', short: '👋 Vẫy chào' },
  { id: 'warm_hands', label: '🤲 Xoa tay sưởi ấm', short: '🤲 Sưởi ấm' },
  { id: 'sip_drink', label: '☕ Nhấp ngụm ấm', short: '☕ Nhấp ngụm' },
  { id: 'cheers_cup', label: '🥂 Nâng ly cụng', short: '🥂 Cụng ly' },
  { id: 'cheer_sunrise', label: '🌅 Reo đón bình minh', short: '🌅 Đón mây' },
  { id: 'sit_chill', label: '🧘 Ngồi ngắm mây', short: '🧘 Ngắm mây' },
  { id: 'play_guitar', label: '🎶 Gảy đàn mộc', short: '🎶 Gảy đàn' },
];

const FAVORITE_PROP_IDS: ReadonlyArray<HeldItemId> = [
  'soy_milk',
  'phin_coffee',
  'lantern',
  'guitar',
];

const FAVORITE_EMOTE_IDS: ReadonlyArray<EmoteId> = [
  'wave',
  'sip_drink',
  'cheers_cup',
  'cheer_sunrise',
];

function formatWarmthTimer(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

function computeNextSunriseSeconds(serverTimeOffsetMs: number): number {
  const syncedMs = Date.now() + serverTimeOffsetMs;
  const cycleMs = WORLD_CONSTANTS.CYCLE_DURATION_MS;
  const u = (((syncedMs % cycleMs) + cycleMs) % cycleMs) / cycleMs;
  // Sunrise window starts at u = 0.0827 (gameHour 4.95)
  const remainingU = u < 0.0827 ? 0.0827 - u : 1.0827 - u;
  return Math.max(1, Math.ceil((remainingU * cycleMs) / 1000));
}

function formatSunriseCountdown(sec: number, compact: boolean): string {
  const m = Math.floor(sec / 60);
  const rem = sec % 60;
  if (compact) {
    return m > 0 ? `${m}p` : `${rem}s`;
  }
  return m > 0 ? `${m}p ${String(rem).padStart(2, '0')}s` : `${rem}s`;
}

export function DiegeticHUD({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);
  const { isMobileLayout, isCompactMobile, showKeycaps, width } = useViewportLayout();

  const timeLabel = useGameStore((s) => s.atmosphere.timeLabel);
  const weatherLabel = useGameStore((s) => s.atmosphere.weatherLabel);
  const tempRoundedC = useGameStore((s) => Math.round(s.atmosphere.temperatureC));
  const isSunriseWindow = useGameStore((s) => s.atmosphere.isSunriseWindow);
  const phaseTitle = useGameStore((s) => s.atmosphere.phaseTitle);
  const rawPhase = useGameStore((s) => (s.atmosphere as { phase?: string }).phase ?? '');
  const overrideGameHour = useGameStore((s) => s.overrideGameHour);
  const overrideWeather = useGameStore((s) => s.overrideWeather);
  const serverTimeOffsetMs = useGameStore((s) => s.serverTimeOffsetMs);
  const warmthRemainingSec = useGameStore((s) => Math.max(0, Math.floor(s.warmthRemainingSec)));
  const roomCode = useGameStore((s) => s.roomCode);
  const connected = useGameStore((s) => s.connected);
  const connecting = useGameStore((s) => s.connecting);
  const humanPeerCount = useGameStore((s) => {
    let count = 0;
    for (const sid in s.peers) {
      if (!s.peers[sid]?.isBot) count++;
    }
    return count;
  });
  const heldItem = useGameStore((s) => s.heldItem);
  const activeEmote = useGameStore((s) => s.activeEmote);
  const seatedBenchId = useGameStore((s) => s.seatedBenchId);
  const activeModal = useGameStore((s) => s.activeModal);
  const nearbyPrompt = useGameStore((s) => s.nearbyPrompt);
  const reducedMotion = useGameStore((s) => s.reducedMotion);
  const nearbyPeer = useGameStore((s) => s.nearbyPeer);
  const selectedPeerSessionId = useGameStore((s) => s.selectedPeerSessionId);
  const dismissedPeerId = useGameStore((s) => s.dismissedPeerId);
  const incomingSocialPrompt = useGameStore((s) => s.incomingSocialPrompt);
  const toastBanner = useGameStore((s) => s.toastBanner);
  const lastJamNote = useGameStore((s) => s.lastJamNote);
  const onboardingStep = useGameStore((s) => s.onboardingStep);
  const chatHistory = useGameStore((s) => s.chatHistory);
  const unreadChatCount = useGameStore((s) => s.unreadChatCount);
  const chatOpen = useGameStore((s) => s.chatDrawerOpen);

  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const setChatOpen = useGameStore((s) => s.setChatDrawerOpen);
  const setPhotoMode = useGameStore((s) => s.setPhotoMode);
  const setHeldItem = useGameStore((s) => s.setHeldItem);
  const setSeatedBench = useGameStore((s) => s.setSeatedBench);
  const setSelectedPeer = useGameStore((s) => s.setSelectedPeer);
  const dismissPeerPrompt = useGameStore((s) => s.dismissPeerPrompt);
  const setIncomingSocialPrompt = useGameStore((s) => s.setIncomingSocialPrompt);
  const setOverrideAtmosphere = useGameStore((s) => s.setOverrideAtmosphere);
  const advanceOnboarding = useGameStore((s) => s.advanceOnboarding);
  const showToast = useGameStore((s) => s.showToast);
  const recordUXEvent = useGameStore((s) => s.recordUXEvent);

  const [altitudeASL, setAltitudeASL] = useState<number>(() =>
    gameYToASL(useGameStore.getState().localTransient.y)
  );
  const [nearCampfire, setNearCampfire] = useState<boolean>(false);
  const [sunriseCountdownSec, setSunriseCountdownSec] = useState<number>(() =>
    computeNextSunriseSeconds(serverTimeOffsetMs)
  );
  const [chatText, setChatText] = useState('');
  const [chatCooldownHint, setChatCooldownHint] = useState<string | null>(null);
  const [emoteTrayOpen, setEmoteTrayOpen] = useState(false);
  const [fullCatalogOpen, setFullCatalogOpen] = useState(false);
  const [peerMenuExpanded, setPeerMenuExpanded] = useState(false);
  const [stillnessFaded, setStillnessFaded] = useState(false);
  const [sunriseWhisper, setSunriseWhisper] = useState(false);
  const [hoveredQuickAction, setHoveredQuickAction] = useState<
    { type: 'prop'; id: HeldItemId } | { type: 'emote'; id: EmoteId } | null
  >(null);

  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatLogEndRef = useRef<HTMLDivElement>(null);
  const prevSunriseRef = useRef<boolean>(false);
  const lastActivityRef = useRef<number>(Date.now());
  const tabPressedAtRef = useRef<number>(0);
  const lastChatSentAtRef = useRef<number>(0);
  const chatCooldownTimerRef = useRef<number | null>(null);

  const isDawnPhaseAllowed =
    isSunriseWindow &&
    (rawPhase
      ? rawPhase === 'pre_dawn' || rawPhase === 'sunrise' || rawPhase === 'golden_hour'
      : phaseTitle === 'Chạng Vạng Thung Lũng Đèn' ||
        phaseTitle === 'Chân Trời Hửng Hồng' ||
        phaseTitle === 'Khoảnh Khắc Vàng Săn Mây');

  // Sync HUD submenu open flag to document.body so PlayerController knows Esc closed a HUD tray
  useEffect(() => {
    document.body.dataset.hudSubmenuOpen = emoteTrayOpen || peerMenuExpanded ? 'true' : 'false';
    return () => {
      document.body.dataset.hudSubmenuOpen = 'false';
    };
  }, [emoteTrayOpen, peerMenuExpanded]);

  useEffect(() => {
    return () => {
      if (chatCooldownTimerRef.current !== null) {
        window.clearTimeout(chatCooldownTimerRef.current);
      }
    };
  }, []);

  // Auto-expand peer social menu if user directly clicked a peer in 3D or received a social prompt
  useEffect(() => {
    if (
      nearbyPeer &&
      (selectedPeerSessionId === nearbyPeer.sessionId ||
        incomingSocialPrompt?.fromId === nearbyPeer.sessionId)
    ) {
      setPeerMenuExpanded(true);
    } else if (!nearbyPeer) {
      setPeerMenuExpanded(false);
    }
  }, [nearbyPeer, selectedPeerSessionId, incomingSocialPrompt]);

  // Scroll chat log to bottom when opened or new message arrives
  useEffect(() => {
    if (chatOpen) {
      chatLogEndRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }, [chatOpen, chatHistory.length, reducedMotion]);

  // Poll live altitude, campfire proximity & sunrise countdown gently at 1 Hz / 2 Hz
  useEffect(() => {
    const timer = setInterval(() => {
      const st = useGameStore.getState();
      const lt = st.localTransient;
      const nextAlt = gameYToASL(lt.y);
      setAltitudeASL((prev) => (prev !== nextAlt ? nextAlt : prev));
      const nextCamp = isNearCampfireStage(lt.x, lt.z);
      setNearCampfire((prev) => (prev !== nextCamp ? nextCamp : prev));
      setSunriseCountdownSec(computeNextSunriseSeconds(st.serverTimeOffsetMs));
    }, 500);
    return () => clearInterval(timer);
  }, []);

  // Poetic Sunrise Whisper Banner — immediately cleared if time leaves pre_dawn/sunrise/golden_hour
  useEffect(() => {
    if (!isDawnPhaseAllowed) {
      prevSunriseRef.current = false;
      setSunriseWhisper(false);
      return;
    }
    if (!prevSunriseRef.current) {
      prevSunriseRef.current = true;
      setSunriseWhisper(true);
      const t = setTimeout(() => setSunriseWhisper(false), 9000);
      return () => clearTimeout(t);
    }
  }, [isDawnPhaseAllowed]);

  // 4.5s Stillness Auto-Fade — keeps >=0.82 opacity so HUD pills retain >=4.5:1 contrast over sunlit clouds
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
        !st.chatDrawerOpen &&
        !emoteTrayOpen &&
        !peerMenuExpanded &&
        !st.incomingSocialPrompt &&
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
  }, [emoteTrayOpen, peerMenuExpanded]);

  // Global [Enter] for Proximity Chat, [Q] or un-focused [Tab] for Radial Tray (preserving Tab focus navigation!)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const st = useGameStore.getState();
      if (!st.hasEnteredWorld || st.photoModeActive) return;

      const activeEl = document.activeElement;
      const activeTag = activeEl?.tagName;
      const inInput =
        activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
      const hasFocusedControl =
        Boolean(activeEl) &&
        activeEl !== document.body &&
        activeEl !== document.documentElement;

      if (e.key === 'Enter' && st.activeModal === 'none') {
        if (!st.chatDrawerOpen && !inInput && !hasFocusedControl) {
          e.preventDefault();
          setEmoteTrayOpen(false);
          st.setChatDrawerOpen(true);
          setTimeout(() => chatInputRef.current?.focus(), 20);
        }
      } else if (
        e.code === 'KeyQ' &&
        st.activeModal === 'none' &&
        !inInput &&
        !st.chatDrawerOpen &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        if (e.repeat) return;
        tabPressedAtRef.current = Date.now();
        setEmoteTrayOpen((v) => !v);
      } else if (
        e.key === 'Tab' &&
        !e.shiftKey &&
        st.activeModal === 'none' &&
        !inInput &&
        !hasFocusedControl &&
        !st.chatDrawerOpen
      ) {
        e.preventDefault();
        if (e.repeat) return;
        st.setChatDrawerOpen(false);
        tabPressedAtRef.current = Date.now();
        setEmoteTrayOpen((v) => !v);
      } else if (e.key === 'Escape') {
        if (st.chatDrawerOpen) {
          st.setChatDrawerOpen(false);
          chatInputRef.current?.blur();
        }
        if (emoteTrayOpen) {
          setEmoteTrayOpen(false);
        }
        if (peerMenuExpanded) {
          setPeerMenuExpanded(false);
          st.setSelectedPeer(null);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' && e.code !== 'KeyQ') return;
      if (tabPressedAtRef.current <= 0) return;
      const heldMs = Date.now() - tabPressedAtRef.current;
      tabPressedAtRef.current = 0;
      if (heldMs >= 260 && emoteTrayOpen) {
        if (hoveredQuickAction) {
          if (hoveredQuickAction.type === 'prop') {
            setHeldItem(hoveredQuickAction.id);
            net.sendHeldItem(hoveredQuickAction.id);
          } else {
            playTemporaryEmote(hoveredQuickAction.id, net, 4000);
          }
        }
        setHoveredQuickAction(null);
        setEmoteTrayOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [emoteTrayOpen, hoveredQuickAction, net, peerMenuExpanded, setHeldItem]);

  const dispatchRateLimitedChat = (trimmed: string): boolean => {
    const now = Date.now();
    const elapsed = now - lastChatSentAtRef.current;
    if (elapsed < 1200) {
      const waitSec = Math.max(0.2, (1200 - elapsed) / 1000).toFixed(1);
      const hint = `Chậm một nhịp nhé — chờ ${waitSec}s để gửi tiếp.`;
      setChatCooldownHint(hint);
      showToast(`⏳ ${hint}`);
      if (chatCooldownTimerRef.current !== null) {
        window.clearTimeout(chatCooldownTimerRef.current);
      }
      chatCooldownTimerRef.current = window.setTimeout(() => {
        setChatCooldownHint(null);
        chatCooldownTimerRef.current = null;
      }, 1500);
      return false;
    }

    lastChatSentAtRef.current = now;
    setChatCooldownHint(null);
    const st = useGameStore.getState();
    const prevCount = st.chatBubbles.length;
    net.sendChat(trimmed);
    if (!st.connected && useGameStore.getState().chatBubbles.length === prevCount) {
      st.pushChatBubble({
        id: `local-${now}`,
        senderId: st.localSessionId || 'local',
        senderName: st.displayName,
        text: trimmed,
        x: st.localTransient.x,
        y: st.localTransient.y,
        z: st.localTransient.z,
        timestamp: now,
      });
    }
    return true;
  };

  const handleSendChat = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = chatText.trim().slice(0, 140);
    if (!trimmed) {
      setChatOpen(false);
      return;
    }
    if (!dispatchRateLimitedChat(trimmed)) {
      return;
    }
    setChatText('');
    setChatOpen(false);
  };

  const handleCopyInviteLink = async () => {
    const code = (roomCode || 'MAY-01').trim().toUpperCase();
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(code)}`;
    recordUXEvent('invite_copy');
    try {
      await navigator.clipboard.writeText(url);
      showToast(`🔗 Đã chép link mời bạn vào phòng ${code}!`);
    } catch {
      showToast(`🔗 Mã phòng của bạn: ${code}`);
    }
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

  const handleStandUpBench = () => {
    const st = useGameStore.getState();
    const curSeat = st.seatedBenchId ? resolveBenchSeatTransform(st.seatedBenchId) : null;
    if (curSeat) {
      st.localTransient.x = curSeat.position[0] + Math.sin(curSeat.yaw) * 0.78;
      st.localTransient.z = curSeat.position[2] + Math.cos(curSeat.yaw) * 0.78;
      st.localTransient.y = sampleWalkableHeight(st.localTransient.x, st.localTransient.z);
    }
    setSeatedBench(null);
    net.requestBenchSeat(null);
    st.triggerEmote('none');
    net.sendEmote('none');
  };

  const hasLocalOverride = overrideGameHour !== null || overrideWeather !== null;
  const showGuitarChordBar = nearCampfire || heldItem === 'guitar';
  const recentJamActive = lastJamNote && Date.now() - lastJamNote.timestamp < 4200;
  const hudChromeOpacity = stillnessFaded ? 0.82 : 1;
  const ultraCompactTop = width < 430;
  const isReconnecting = !connected && connecting;

  const peerVisible =
    nearbyPeer &&
    activeModal === 'none' &&
    !chatOpen &&
    (nearbyPeer.sessionId !== dismissedPeerId ||
      selectedPeerSessionId === nearbyPeer.sessionId ||
      incomingSocialPrompt?.fromId === nearbyPeer.sessionId);

  const isJournalActive =
    activeModal === 'almanac' || activeModal === 'polaroids' || activeModal === 'windchimes';

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
        zIndex: 30,
        pointerEvents: 'none',
        fontFamily: UI_FONTS.sans,
      }}
    >
      {/* WORLD-PROJECTED INTERACT PROMPT PILL (Positioned at 60Hz by InteractableBeacons3D, safely rendered in react-dom) */}
      {nearbyPrompt && activeModal === 'none' && !chatOpen && !seatedBenchId && (
        <button
          id="dalat-world-interact-pill"
          type="button"
          data-testid="world-interact-prompt"
          data-ui-overlay="true"
          onTouchStart={(e) => e.stopPropagation()}
          onClick={() => executeInteractPrompt(nearbyPrompt, net)}
          className="dalat-glass-btn"
          style={{
            ...GLASS_PILL_STYLE,
            position: 'absolute',
            top: 0,
            left: 0,
            transform: 'translate3d(50vw, calc(var(--dl-vh, 100vh) - 86px), 0) translate(-50%, -100%)',
            minHeight: '44px',
            minWidth: '44px',
            padding: '7px 14px 7px 10px',
            borderRadius: '999px',
            border: '1px solid rgba(243, 195, 130, 0.56)',
            boxShadow: '0 10px 28px rgba(8, 12, 22, 0.52), 0 0 18px rgba(243, 195, 130, 0.2)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '9px',
            pointerEvents: 'auto',
            fontFamily: UI_FONTS.sans,
            maxWidth: 'calc(100vw - 20px)',
            boxSizing: 'border-box',
            willChange: 'transform',
            transition: reducedMotion ? 'none' : 'background 160ms ease, border-color 160ms ease',
            zIndex: 32,
          }}
        >
          <span
            style={{
              padding: '3px 8px',
              borderRadius: '999px',
              background: 'rgba(243, 195, 130, 0.24)',
              border: '1px solid rgba(243, 195, 130, 0.55)',
              color: UI_COLORS.warmAmber,
              fontFamily: showKeycaps ? UI_FONTS.mono : UI_FONTS.sans,
              fontSize: '12px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {showKeycaps ? '[E]' : 'Chạm'}
          </span>
          <span
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              textAlign: 'left',
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: '12.5px',
                fontWeight: 600,
                color: UI_COLORS.cream,
                lineHeight: 1.25,
              }}
            >
              {nearbyPrompt.label}
            </span>
            {nearbyPrompt.sublabel && (
              <span
                style={{
                  fontSize: '12px',
                  color: UI_COLORS.mistText,
                  lineHeight: 1.2,
                }}
              >
                {nearbyPrompt.sublabel}
              </span>
            )}
          </span>
        </button>
      )}

      {/* COORDINATED SAFE-AREA TOP BAR (Zero Left/Right Collision on 320px-1440px) */}
      <div
        style={{
          position: 'absolute',
          top: 'var(--dl-safe-top)',
          left: 'var(--dl-safe-left)',
          right: 'var(--dl-safe-right)',
          display: 'flex',
          flexWrap: isCompactMobile && isReconnecting ? 'wrap' : 'nowrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: isCompactMobile ? '5px' : '8px',
          opacity: hudChromeOpacity,
          transition: 'opacity 520ms ease',
          pointerEvents: 'none',
          boxSizing: 'border-box',
        }}
      >
        {/* TOP-LEFT: Horizon Clock + Live Sunrise Countdown + Override/Offline Chips */}
        <div
          data-ui-overlay="true"
          onTouchStart={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '6px',
            minWidth: 0,
            flex: '0 1 auto',
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            onClick={() => toggleModal('settings')}
            title="Mở Bầu trời, Giờ săn mây & Cài đặt"
            data-testid="hud-horizon-pill"
            className="dalat-glass-btn"
            style={{
              ...GLASS_PILL_STYLE,
              minHeight: '44px',
              minWidth: '44px',
              borderRadius: '999px',
              padding: isCompactMobile ? '6px 9px' : ultraCompactTop ? '6px 10px' : '6px 13px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: isCompactMobile ? '5px' : ultraCompactTop ? '6px' : '8px',
              fontSize: '12px',
              maxWidth: '100%',
              boxSizing: 'border-box',
            }}
          >
            <span style={{ fontFamily: UI_FONTS.mono, color: UI_COLORS.warmAmber, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {timeLabel}
            </span>

            {!isCompactMobile && <span style={{ opacity: 0.35 }}>•</span>}

            {/* Live Sunrise Countdown */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                color: isSunriseWindow ? '#FFD59E' : UI_COLORS.cream,
                fontWeight: isSunriseWindow ? 600 : 500,
                whiteSpace: 'nowrap',
              }}
            >
              <Sunrise size={13} strokeWidth={2} style={{ color: UI_COLORS.warmAmber, flexShrink: 0 }} />
              <span>
                {isSunriseWindow
                  ? isCompactMobile
                    ? 'Mây!'
                    : 'Bình minh!'
                  : `${formatSunriseCountdown(sunriseCountdownSec, isMobileLayout)}`}
              </span>
            </span>

            {!ultraCompactTop && (
              <>
                <span style={{ opacity: 0.35 }}>•</span>
                <span style={{ fontFamily: UI_FONTS.mono, whiteSpace: 'nowrap' }}>
                  {tempRoundedC}°C
                </span>
              </>
            )}

            {!isMobileLayout && (
              <>
                <span style={{ opacity: 0.35 }}>•</span>
                <span style={{ fontFamily: UI_FONTS.mono, whiteSpace: 'nowrap' }}>
                  {altitudeASL.toLocaleString('en-US')}m
                </span>
                <span style={{ opacity: 0.35 }}>•</span>
                <span style={{ color: UI_COLORS.mistText, whiteSpace: 'nowrap' }}>
                  {weatherLabel}
                </span>
              </>
            )}

            {warmthRemainingSec > 0 && !ultraCompactTop && (
              <span
                title="Hơi ấm cao nguyên: +12% tốc độ bước chạy & giữ ấm hơi thở"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 7px',
                  borderRadius: '999px',
                  background: 'rgba(236, 154, 108, 0.24)',
                  border: '1px solid rgba(243, 195, 130, 0.44)',
                  color: UI_COLORS.warmAmber,
                  fontFamily: UI_FONTS.mono,
                  fontSize: '12px',
                }}
              >
                <Coffee size={12} strokeWidth={2} />
                <span>{formatWarmthTimer(warmthRemainingSec)}</span>
              </span>
            )}
          </button>

          {/* Local Preview Active Reset Chip (UX-13) */}
          {hasLocalOverride && (
            <button
              type="button"
              onClick={() => setOverrideAtmosphere(null, null)}
              className="dalat-glass-btn"
              style={{
                ...GLASS_PILL_STYLE,
                minHeight: '40px',
                borderRadius: '999px',
                padding: '6px 12px',
                border: `1px solid ${UI_COLORS.warmAmber}`,
                background: 'rgba(42, 31, 22, 0.9)',
                color: UI_COLORS.warmAmber,
                fontSize: '12px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <RotateCcw size={12} />
              <span>{isCompactMobile ? 'Về giờ chung' : 'Xem thử cục bộ • Về giờ chung'}</span>
            </button>
          )}

          {/* Honest Offline / Solo Exploration Pill (UX-19) */}
          {!connected && !connecting && (
            <button
              type="button"
              onClick={() => {
                net.connect(roomCode || undefined).catch(() => {});
              }}
              className="dalat-glass-btn"
              style={{
                ...GLASS_PILL_STYLE,
                minHeight: '40px',
                borderRadius: '999px',
                padding: '6px 12px',
                border: '1px solid rgba(232, 139, 110, 0.56)',
                color: '#FFB49C',
                fontSize: '12px',
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <WifiOff size={12} />
              <span>
                {isMobileLayout
                  ? 'Dạo một mình • Kết nối'
                  : 'Đang dạo đồi một mình • Kết nối lại'}
              </span>
            </button>
          )}
        </div>

        {/* TOP-RIGHT: Presence + Reconnecting Status + 1-Tap Invite Copy + Wardrobe + Settings */}
        <div
          data-ui-overlay="true"
          onTouchStart={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: isCompactMobile ? '4px' : '6px',
            flexShrink: 0,
            pointerEvents: 'auto',
          }}
        >
          {/* Combined Presence + Reconnecting Badge + 1-Click Invite Pill */}
          <div
            data-testid="hud-invite-pill"
            style={{
              ...GLASS_PILL_STYLE,
              minHeight: '44px',
              borderRadius: '999px',
              padding: '2px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px',
              boxSizing: 'border-box',
            }}
          >
            <button
              type="button"
              onClick={() => toggleModal('channels')}
              title="Danh sách Kênh đồi & Bạn săn mây"
              aria-label="Kênh đồi & người chơi"
              data-testid="hud-channels-btn"
              className="dalat-glass-btn"
              style={{
                minHeight: '40px',
                minWidth: '44px',
                padding: isCompactMobile ? '4px 8px' : ultraCompactTop ? '4px 9px' : '4px 11px',
                borderRadius: '999px',
                background:
                  activeModal === 'channels'
                    ? 'rgba(243, 195, 130, 0.22)'
                    : isReconnecting
                      ? 'rgba(243, 195, 130, 0.14)'
                      : 'transparent',
                border: isReconnecting ? '1px solid rgba(243, 195, 130, 0.48)' : 'none',
                color: isReconnecting ? UI_COLORS.warmAmber : UI_COLORS.cream,
                fontSize: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: connected
                    ? UI_COLORS.pineSage
                    : isReconnecting
                      ? UI_COLORS.warmAmber
                      : UI_COLORS.offlineCoral,
                  boxShadow: connected
                    ? '0 0 8px rgba(130, 214, 158, 0.75)'
                    : isReconnecting
                      ? '0 0 8px rgba(243, 195, 130, 0.8)'
                      : '0 0 8px rgba(232, 139, 110, 0.65)',
                }}
              />
              {isReconnecting ? (
                <span
                  data-testid="hud-reconnecting-badge"
                  style={{
                    color: UI_COLORS.warmAmber,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Đang kết nối lại...
                </span>
              ) : (
                <>
                  {!isMobileLayout && (
                    <span
                      style={{
                        fontFamily: UI_FONTS.mono,
                        color: UI_COLORS.warmAmber,
                        fontWeight: 600,
                      }}
                    >
                      {roomCode || 'MAY-01'}
                    </span>
                  )}
                  <Users size={13} strokeWidth={1.9} style={{ opacity: 0.88 }} />
                  <span style={{ fontWeight: 600 }}>{1 + humanPeerCount}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleCopyInviteLink}
              title="Sao chép link mời bạn bè vào cùng phòng săn mây"
              aria-label="Sao chép link mời bạn"
              data-testid="hud-invite-copy-btn"
              className="dalat-glass-btn"
              style={{
                minHeight: '40px',
                minWidth: '44px',
                padding: isCompactMobile ? '4px 8px' : ultraCompactTop ? '4px 9px' : '4px 11px',
                borderRadius: '999px',
                background: 'rgba(243, 195, 130, 0.16)',
                border: '1px solid rgba(243, 195, 130, 0.36)',
                color: UI_COLORS.warmAmber,
                fontSize: '12px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <Link2 size={14} />
              {!isCompactMobile && <span>{ultraCompactTop ? 'Mời' : 'Mời bạn'}</span>}
            </button>
          </div>

          {!isMobileLayout && (
            <button
              type="button"
              onClick={() => toggleModal('wardrobe')}
              title="[O] Tủ đồ & Trang phục 3D"
              aria-label="Tủ đồ"
              className="dalat-glass-btn"
              style={{
                ...GLASS_PILL_STYLE,
                minHeight: '44px',
                minWidth: '44px',
                padding: '6px 12px',
                borderRadius: '999px',
                border: `1px solid ${activeModal === 'wardrobe' ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                color: activeModal === 'wardrobe' ? UI_COLORS.warmAmber : UI_COLORS.cream,
                fontSize: '12px',
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
              }}
            >
              <Shirt size={14} strokeWidth={1.85} />
              <span>Tủ đồ</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => toggleModal('settings')}
            title="Cài đặt, Âm thanh, Trợ năng & Hướng dẫn phím"
            aria-label="Cài đặt"
            data-testid="hud-settings-btn"
            className="dalat-glass-btn"
            style={{
              ...GLASS_PILL_STYLE,
              width: '44px',
              height: '44px',
              minWidth: '44px',
              minHeight: '44px',
              padding: 0,
              borderRadius: '50%',
              border: `1px solid ${activeModal === 'settings' ? UI_COLORS.warmAmber : UI_COLORS.border}`,
              color: activeModal === 'settings' ? UI_COLORS.warmAmber : UI_COLORS.cream,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SlidersHorizontal size={15} strokeWidth={1.9} />
          </button>
        </div>
      </div>

      {/* DEDICATED SUB-HEADER WHISPER, TOAST & 3-BEAT ONBOARDING SLOT (Zero Top-Row Collision!) */}
      <div
        style={{
          position: 'absolute',
          top:
            isMobileLayout && (hasLocalOverride || (!connected && !connecting))
              ? 'calc(var(--dl-safe-top) + 94px)'
              : 'calc(var(--dl-safe-top) + 54px)',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '7px',
          width: 'max-content',
          maxWidth: 'calc(100vw - 16px)',
          boxSizing: 'border-box',
          pointerEvents: 'none',
          zIndex: 31,
        }}
      >
        {sunriseWhisper && isDawnPhaseAllowed && (
          <div
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '8px 18px',
              border: '1px solid rgba(255, 210, 154, 0.46)',
              background:
                'linear-gradient(90deg, rgba(24, 21, 34, 0.90) 0%, rgba(52, 34, 40, 0.92) 50%, rgba(24, 21, 34, 0.90) 100%)',
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
              maxWidth: '100%',
              boxSizing: 'border-box',
              animation: 'dalatFadeUp 500ms ease',
            }}
          >
            <Sunrise size={16} strokeWidth={1.9} style={{ color: '#FFB87A', flexShrink: 0 }} />
            <span
              className="dalat-serif"
              style={{
                fontFamily: UI_FONTS.serif,
                fontStyle: 'italic',
                fontSize: '13.5px',
                color: '#FFF3E2',
              }}
            >
              Chân trời phía Đông đang ửng hồng… Bình minh Cầu Đất đang lên.
            </span>
          </div>
        )}

        {toastBanner && (
          <div
            role="status"
            aria-live="polite"
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '7px 16px',
              border: `1px solid ${UI_COLORS.borderStrong}`,
              fontSize: '12.5px',
              fontWeight: 500,
              color: UI_COLORS.cream,
              maxWidth: '100%',
              boxSizing: 'border-box',
              animation: 'dalatFadeUp 240ms ease',
              textAlign: 'center',
            }}
          >
            {toastBanner}
          </div>
        )}

        {/* Progressive 3-Beat Diegetic Onboarding Whisper (Replaces Permanent 5-Row Cheat-Sheet) */}
        {onboardingStep !== 'done' && activeModal === 'none' && !toastBanner && (
          <div
            data-ui-overlay="true"
            onTouchStart={(e) => e.stopPropagation()}
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: '6px 8px 6px 14px',
              border: '1px solid rgba(243, 195, 130, 0.36)',
              fontSize: '12px',
              color: UI_COLORS.cream,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              maxWidth: '100%',
              boxSizing: 'border-box',
              pointerEvents: 'auto',
              animation: 'dalatFadeUp 320ms ease',
            }}
          >
            <span>
              {onboardingStep === 'move'
                ? isMobileLayout
                  ? '👣 Kéo vòng tròn góc trái để dạo bước trên đồi chè'
                  : '👣 Nhấn WASD hoặc phím mũi tên để dạo bước (Shift chạy nhanh)'
                : onboardingStep === 'look'
                  ? isMobileLayout
                    ? '🌤️ Vuốt màn hình xoay góc nhìn 360° • Chụm 2 ngón thu phóng'
                    : '🌤️ Kéo chuột để xoay góc nhìn 360° • Cuộn chuột thu phóng'
                  : '✨ Ghé hiên gỗ hoặc bếp lửa để thưởng thức sữa nóng & săn mây'}
            </span>
            <button
              type="button"
              onClick={() => advanceOnboarding('skip')}
              aria-label="Ẩn gợi ý mở đầu"
              className="dalat-glass-btn"
              style={{
                width: '32px',
                height: '32px',
                minWidth: '32px',
                minHeight: '32px',
                padding: 0,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.07)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.mistText,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>

      {/* LOWER-CENTER STACK: Bench Stand-Up, Guitar Bar, Compact Social Chip / Popover, Chat Log, Radial Tray & 5-Item Dock */}
      <div
        style={{
          position: 'absolute',
          bottom: 'var(--dl-safe-bottom)',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          width: 'max-content',
          maxWidth: 'calc(100vw - 12px)',
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }}
      >
        {/* Seated Bench Indicator & 1-Tap Stand Up */}
        {seatedBenchId && activeModal === 'none' && (
          <button
            type="button"
            data-ui-overlay="true"
            onTouchStart={(e) => e.stopPropagation()}
            onClick={handleStandUpBench}
            className="dalat-glass-btn"
            style={{
              ...GLASS_PILL_STYLE,
              minHeight: '42px',
              borderRadius: '999px',
              padding: '6px 14px',
              border: '1px solid rgba(243, 195, 130, 0.42)',
              color: UI_COLORS.warmAmber,
              fontSize: '12px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              pointerEvents: 'auto',
              opacity: hudChromeOpacity,
              transition: 'opacity 520ms ease',
            }}
          >
            <span>🪑 Đang ngồi ngắm mây</span>
            <span style={{ color: UI_COLORS.cream, fontWeight: 500 }}>• Đứng dậy</span>
          </button>
        )}

        {/* Campfire Acoustic Guitar 1-6 Chord Bar */}
        {showGuitarChordBar && activeModal === 'none' && !chatOpen && (
          <div
            data-ui-overlay="true"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '18px',
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              maxWidth: 'calc(100vw - 16px)',
              boxSizing: 'border-box',
              pointerEvents: 'auto',
              opacity: hudChromeOpacity,
              transition: 'opacity 520ms ease',
              animation: 'dalatFadeUp 220ms ease',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: UI_COLORS.warmAmber,
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              <Flame size={13} strokeWidth={2} />
              <span>
                {showKeycaps
                  ? 'Hòa âm Guitar bên lửa hồng (Phím 1–6)'
                  : 'Chạm hợp âm Guitar bên lửa hồng'}
              </span>
              {recentJamActive && lastJamNote && (
                <span style={{ color: '#FFEBD0' }}>
                  • ♪ {lastJamNote.senderName}:{' '}
                  {HIGHLAND_GUITAR_CHORDS[lastJamNote.chordIndex]?.name || 'Cadd9'}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px' }}>
              {HIGHLAND_GUITAR_CHORDS.map((ch) => {
                const justPlayed = recentJamActive && lastJamNote?.chordIndex === ch.index;
                return (
                  <button
                    key={ch.index}
                    type="button"
                    onClick={() => triggerGuitarChord(ch.index, net)}
                    className="dalat-glass-btn"
                    title={ch.mood}
                    style={{
                      minHeight: '38px',
                      padding: '5px 10px',
                      borderRadius: '10px',
                      background: justPlayed
                        ? 'rgba(243, 195, 130, 0.28)'
                        : 'rgba(255, 255, 255, 0.055)',
                      border: `1px solid ${justPlayed ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: UI_COLORS.cream,
                      fontSize: '12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    {showKeycaps && (
                      <span
                        style={{
                          fontFamily: UI_FONTS.mono,
                          fontSize: '12px',
                          color: UI_COLORS.warmAmber,
                        }}
                      >
                        [{ch.key}]
                      </span>
                    )}
                    <span style={{ fontWeight: 600 }}>{ch.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* SOCIAL COMPANION ENCOUNTER: 1-Line Greeting Chip by Default, Expandable on Demand! */}
        {peerVisible && nearbyPeer && !peerMenuExpanded && (
          <div
            data-testid="peer-greeting-chip"
            data-ui-overlay="true"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            style={{
              ...GLASS_PILL_STYLE,
              minHeight: '44px',
              borderRadius: '999px',
              padding: '4px 6px 4px 10px',
              border: '1px solid rgba(243, 195, 130, 0.42)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              pointerEvents: 'auto',
              opacity: hudChromeOpacity,
              transition: 'opacity 520ms ease',
              animation: 'dalatFadeUp 200ms ease',
              maxWidth: 'calc(100vw - 16px)',
              boxSizing: 'border-box',
            }}
          >
            <button
              type="button"
              onClick={() => {
                recordUXEvent('social_interact');
                executePeerSocialAction('greet', nearbyPeer, net);
              }}
              className="dalat-glass-btn"
              style={{
                minHeight: '36px',
                padding: '4px 10px',
                borderRadius: '999px',
                background: 'rgba(243, 195, 130, 0.18)',
                border: '1px solid rgba(243, 195, 130, 0.4)',
                color: UI_COLORS.warmAmber,
                fontSize: '12px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                👋 Chào {nearbyPeer.displayName}
              </span>
              {showKeycaps && (
                <span style={{ fontFamily: UI_FONTS.mono, opacity: 0.85 }}>[G]</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setPeerMenuExpanded(true)}
              data-testid="peer-expand-social-btn"
              className="dalat-glass-btn"
              style={{
                minHeight: '36px',
                padding: '4px 10px',
                borderRadius: '999px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.cream,
                fontSize: '12px',
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {!isCompactMobile && <span>Tương tác</span>}
              <ChevronUp size={14} />
            </button>

            <button
              type="button"
              aria-label="Tạm ẩn lời chào"
              title="Tạm ẩn thanh tương tác để ngắm mây"
              onClick={() => dismissPeerPrompt(nearbyPeer.sessionId)}
              data-testid="peer-dismiss-btn"
              className="dalat-glass-btn"
              style={{
                width: '36px',
                height: '36px',
                minWidth: '36px',
                minHeight: '36px',
                padding: 0,
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.mistText,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* EXPANDED SOCIAL POPOVER (Only when user expands, clicks avatar, or receives incoming gesture) */}
        {peerVisible && nearbyPeer && peerMenuExpanded && (
          <div
            data-testid="peer-social-popover"
            data-ui-overlay="true"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '20px',
              padding: '11px 14px',
              border: '1px solid rgba(243, 195, 130, 0.48)',
              boxShadow: '0 12px 32px rgba(8, 12, 22, 0.56)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              pointerEvents: 'auto',
              animation: 'dalatFadeUp 180ms ease',
              maxWidth: 'min(540px, calc(100vw - 16px))',
              boxSizing: 'border-box',
            }}
          >
            {incomingSocialPrompt && incomingSocialPrompt.fromId === nearbyPeer.sessionId && (
              <div
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '5px 11px',
                  borderRadius: '999px',
                  background: 'rgba(243, 195, 130, 0.22)',
                  border: '1px solid rgba(243, 195, 130, 0.52)',
                  color: '#FFF3DC',
                  fontSize: '12px',
                  fontWeight: 500,
                  textAlign: 'center',
                }}
              >
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
                — Chạm bên dưới để đáp lại!
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
                <span style={{ fontWeight: 600, color: UI_COLORS.warmAmber, fontSize: '13px' }}>
                  {nearbyPeer.displayName}
                </span>
                <span style={{ color: UI_COLORS.mutedText }}>
                  {nearbyPeer.isBot ? '• Lữ khách dạo đồi' : `• Cách ${nearbyPeer.distance.toFixed(1)}m`}
                </span>
                {nearbyPeer.seatId && (
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: '999px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      fontSize: '12px',
                      color: '#FFE6C2',
                    }}
                  >
                    🪑 Đang ngồi
                  </span>
                )}
              </div>

              <button
                type="button"
                aria-label="Thu gọn tương tác"
                onClick={() => {
                  setPeerMenuExpanded(false);
                  setSelectedPeer(null);
                  setIncomingSocialPrompt(null);
                }}
                className="dalat-glass-btn"
                style={{
                  minHeight: '36px',
                  padding: '5px 11px',
                  borderRadius: '999px',
                  background: 'rgba(255,255,255,0.07)',
                  border: `1px solid ${UI_COLORS.border}`,
                  color: UI_COLORS.cream,
                  fontSize: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  flexShrink: 0,
                }}
              >
                <span>Thu gọn</span>
                <ChevronDown size={13} />
              </button>
            </div>

            {/* Social Gesture Actions */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px' }}>
              {[
                { kind: 'greet' as const, key: 'G', label: '👋 Vẫy chào' },
                { kind: 'cheers' as const, key: 'H', label: '☕ Cụng ly ấm (+8p)', highlight: true },
                { kind: 'cheer' as const, key: 'V', label: '🙌 Reo đón mây' },
                { kind: 'gift_flower' as const, key: 'F', label: '💐 Tặng hoa', highlight: true },
                { kind: 'sparkler' as const, key: 'B', label: '✨ Pháo bông' },
                { kind: 'photo' as const, key: 'C', label: '📸 Chụp chung' },
              ].map((btn) => (
                <button
                  key={btn.kind}
                  type="button"
                  onClick={() => {
                    recordUXEvent('social_interact');
                    executePeerSocialAction(btn.kind, nearbyPeer, net);
                  }}
                  className="dalat-glass-btn"
                  style={{
                    minHeight: '38px',
                    padding: '5px 11px',
                    borderRadius: '999px',
                    background: btn.highlight
                      ? 'rgba(243, 195, 130, 0.2)'
                      : 'rgba(255, 255, 255, 0.06)',
                    border: `1px solid ${
                      btn.highlight ? 'rgba(243, 195, 130, 0.48)' : UI_COLORS.border
                    }`,
                    color: UI_COLORS.cream,
                    fontSize: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  {showKeycaps && (
                    <span
                      style={{
                        fontFamily: UI_FONTS.mono,
                        fontSize: '12px',
                        padding: '0 5px',
                        borderRadius: '5px',
                        background: 'rgba(243, 195, 130, 0.22)',
                        color: UI_COLORS.warmAmber,
                        fontWeight: 600,
                      }}
                    >
                      {btn.key}
                    </span>
                  )}
                  <span>{btn.label}</span>
                </button>
              ))}

              <button
                type="button"
                onClick={() => {
                  recordUXEvent('social_interact');
                  executePeerSocialAction('sit_together', nearbyPeer, net);
                }}
                className="dalat-glass-btn"
                style={{
                  minHeight: '38px',
                  padding: '5px 11px',
                  borderRadius: '999px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: `1px solid ${UI_COLORS.border}`,
                  color: UI_COLORS.cream,
                  fontSize: '12px',
                }}
              >
                🪑 Ngồi cạnh nhau
              </button>
            </div>

            {/* Quick-Chat Presets */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '5px',
                paddingTop: '6px',
                borderTop: '1px solid rgba(255, 232, 204, 0.14)',
                width: '100%',
              }}
            >
              {[
                {
                  short: 'Sương đẹp quá ✨',
                  full: `Sương sớm Đà Lạt hôm nay đẹp quá ${nearbyPeer.displayName} ơi! ✨`,
                },
                {
                  short: 'Uống sữa nóng 🥛',
                  full: `Làm ly sữa đậu nành nóng cho ấm bụng nhé ${nearbyPeer.displayName}! 🥛`,
                },
                {
                  short: 'Qua ghế ngồi nhé 🪑',
                  full: `Qua ghế gỗ đôi ngồi ngắm biển mây cùng mình nè ${nearbyPeer.displayName}! 🪑`,
                },
              ].map((preset) => (
                <button
                  key={preset.short}
                  type="button"
                  onClick={() => {
                    if (dispatchRateLimitedChat(preset.full)) {
                      showToast(`💬 Đã gửi lời nhắn tới ${nearbyPeer.displayName}`);
                    }
                  }}
                  className="dalat-glass-btn"
                  style={{
                    minHeight: '36px',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 232, 204, 0.2)',
                    color: UI_COLORS.cream,
                    fontSize: '12px',
                  }}
                >
                  {preset.short}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setEmoteTrayOpen(false);
                  setPeerMenuExpanded(false);
                  setChatText(`@${nearbyPeer.displayName} `);
                  setChatOpen(true);
                  setTimeout(() => chatInputRef.current?.focus(), 20);
                }}
                className="dalat-glass-btn"
                style={{
                  minHeight: '36px',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  background: 'rgba(243, 195, 130, 0.18)',
                  border: '1px solid rgba(243, 195, 130, 0.4)',
                  color: UI_COLORS.warmAmber,
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                ✏️ Tự gõ lời nhắn…
              </button>
            </div>
          </div>
        )}

        {/* HOLD/TAP [TAB] / [Q] RADIAL QUICK-EXPRESSION RING + FULL CATALOG DRAWER */}
        {emoteTrayOpen && activeModal === 'none' && (
          <div
            data-ui-overlay="true"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '22px',
              padding: isCompactMobile ? '11px 10px' : '13px 15px',
              width: 'min(480px, calc(100vw - 16px))',
              boxSizing: 'border-box',
              pointerEvents: 'auto',
              animation: 'dalatFadeUp 180ms ease',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px',
                gap: '8px',
              }}
            >
              <span style={{ fontSize: '12px', fontWeight: 700, color: UI_COLORS.warmAmber }}>
                {showKeycaps
                  ? 'ĐẠO CỤ & BIỂU CẢM NHANH ([Q] hoặc [Tab])'
                  : 'ĐẠO CỤ & BIỂU CẢM SƯƠNG SỚM'}
              </span>
              <button
                type="button"
                aria-label="Đóng khay đạo cụ"
                onClick={() => setEmoteTrayOpen(false)}
                className="dalat-glass-btn"
                style={{
                  width: '36px',
                  height: '36px',
                  minWidth: '36px',
                  minHeight: '36px',
                  padding: 0,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.06)',
                  border: `1px solid ${UI_COLORS.border}`,
                  color: UI_COLORS.mistText,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <X size={14} />
              </button>
            </div>

            {/* 8 Quick Favorites: 4 Signature Props + 4 Signature Emotes */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isCompactMobile
                  ? 'repeat(2, minmax(0, 1fr))'
                  : 'repeat(4, minmax(0, 1fr))',
                gap: '6px',
                marginBottom: '8px',
              }}
            >
              {FAVORITE_PROP_IDS.map((pid) => {
                const meta = HELD_PROP_CATALOG.find((m) => m.id === pid)!;
                return (
                  <div
                    key={pid}
                    onPointerEnter={() => setHoveredQuickAction({ type: 'prop', id: pid })}
                    onPointerLeave={() => setHoveredQuickAction(null)}
                  >
                    <VisualChoiceCard
                      active={heldItem === pid}
                      label={meta.shortLabel}
                      compact
                      thumbHeight={42}
                      onClick={() => selectProp(pid)}
                      thumbnail={<HeldPropThumbnail itemId={pid} size={40} />}
                    />
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '6px',
                marginBottom: '9px',
              }}
            >
              {FAVORITE_EMOTE_IDS.map((eid) => {
                const meta = EMOTE_OPTIONS.find((e) => e.id === eid)!;
                const active = activeEmote === eid;
                return (
                  <button
                    key={eid}
                    type="button"
                    onPointerEnter={() => setHoveredQuickAction({ type: 'emote', id: eid })}
                    onPointerLeave={() => setHoveredQuickAction(null)}
                    onClick={() => playTemporaryEmote(eid, net, 4000)}
                    className="dalat-glass-btn"
                    style={{
                      minHeight: '38px',
                      padding: '6px 10px',
                      borderRadius: '11px',
                      background: active
                        ? 'rgba(243, 195, 130, 0.24)'
                        : 'rgba(255, 255, 255, 0.05)',
                      border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: UI_COLORS.cream,
                      fontSize: '12px',
                      fontWeight: 500,
                    }}
                  >
                    {meta.short}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              aria-expanded={fullCatalogOpen}
              onClick={() => setFullCatalogOpen((v) => !v)}
              className="dalat-glass-btn"
              style={{
                width: '100%',
                minHeight: '38px',
                padding: '6px 12px',
                borderRadius: '11px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.warmAmber,
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Xem tất cả 11 đạo cụ & 7 biểu cảm</span>
              {fullCatalogOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {fullCatalogOpen && (
              <div
                className="dalat-scroll"
                style={{
                  marginTop: '10px',
                  maxHeight: '210px',
                  overflowY: 'auto',
                  paddingRight: '2px',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isCompactMobile
                      ? 'repeat(2, minmax(0, 1fr))'
                      : isMobileLayout
                        ? 'repeat(3, minmax(0, 1fr))'
                        : 'repeat(4, minmax(0, 1fr))',
                    gap: '6px',
                    marginBottom: '10px',
                  }}
                >
                  {HELD_PROP_CATALOG.map((p) => (
                    <VisualChoiceCard
                      key={p.id}
                      active={heldItem === p.id}
                      label={p.shortLabel}
                      title={`${p.title} — ${p.desc}`}
                      compact
                      thumbHeight={42}
                      onClick={() => selectProp(p.id)}
                      thumbnail={<HeldPropThumbnail itemId={p.id} size={40} />}
                    />
                  ))}
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
                          minHeight: '38px',
                          padding: '6px 11px',
                          borderRadius: '999px',
                          background: active
                            ? 'rgba(243, 195, 130, 0.24)'
                            : 'rgba(255, 255, 255, 0.05)',
                          border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                          color: UI_COLORS.cream,
                          fontSize: '12px',
                        }}
                      >
                        {em.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* WHISPER CHAT LOG + PROXIMITY CHAT INPUT BAR (UX-14) */}
        {chatOpen && (
          <div
            data-testid="whisper-chat-drawer"
            data-ui-overlay="true"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '20px',
              padding: '10px 12px',
              width: 'min(440px, calc(100vw - 16px))',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              pointerEvents: 'auto',
              animation: 'dalatFadeUp 160ms ease',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: UI_COLORS.mistText,
              }}
            >
              <span style={{ fontWeight: 600, color: UI_COLORS.warmAmber }}>
                💬 Trò chuyện quanh đồi (35m)
              </span>
              <button
                type="button"
                aria-label="Đóng trò chuyện"
                onClick={() => setChatOpen(false)}
                className="dalat-glass-btn"
                style={{
                  width: '34px',
                  height: '34px',
                  minWidth: '34px',
                  minHeight: '34px',
                  padding: 0,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.06)',
                  border: `1px solid ${UI_COLORS.border}`,
                  color: UI_COLORS.mistText,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={14} />
              </button>
            </div>

            {chatHistory.length > 0 ? (
              <div
                className="dalat-scroll"
                style={{
                  maxHeight: '132px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                  padding: '6px 8px',
                  borderRadius: '12px',
                  background: 'rgba(8, 12, 20, 0.56)',
                  border: '1px solid rgba(255, 232, 204, 0.12)',
                  touchAction: 'pan-y',
                }}
              >
                {chatHistory.slice(-18).map((msg) => (
                  <div
                    key={msg.id}
                    style={{
                      fontSize: '12px',
                      lineHeight: 1.38,
                      color: UI_COLORS.cream,
                      wordBreak: 'break-word',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: UI_COLORS.warmAmber }}>
                      {msg.senderName}
                    </span>
                    {msg.landmarkShort && (
                      <span style={{ color: UI_COLORS.mutedText }}>
                        {' '}
                        • 📍{msg.landmarkShort}
                      </span>
                    )}
                    <span>: {msg.text}</span>
                  </div>
                ))}
                <div ref={chatLogEndRef} />
              </div>
            ) : (
              <div
                style={{
                  fontSize: '12px',
                  color: UI_COLORS.mutedText,
                  padding: '4px 2px',
                }}
              >
                Chưa có lời nhắn nào gần bạn. Gửi lời chào đầu tiên nhé!
              </div>
            )}

            {chatCooldownHint && (
              <div
                role="status"
                aria-live="polite"
                data-testid="chat-cooldown-hint"
                style={{
                  fontSize: '12px',
                  color: UI_COLORS.warmAmber,
                  padding: '3px 6px',
                }}
              >
                ⏳ {chatCooldownHint}
              </div>
            )}

            <form
              onSubmit={handleSendChat}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 5px 4px 12px',
                borderRadius: '999px',
                background: 'rgba(8, 12, 20, 0.68)',
                border: `1px solid ${UI_COLORS.border}`,
              }}
            >
              <input
                ref={chatInputRef}
                type="text"
                value={chatText}
                maxLength={140}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Gửi lời nhắn tới bạn quanh đồi…"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: UI_COLORS.cream,
                  fontSize: isMobileLayout ? '16px' : '13.5px',
                }}
              />
              <button
                type="submit"
                className="dalat-glass-btn"
                style={{
                  minHeight: '38px',
                  minWidth: '48px',
                  padding: '6px 14px',
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
          </div>
        )}

        {/* STREAMLINED 1-ROW 5-ITEM FLOATING GLASS DOCK (Zero Overflow on 320px-1440px!) */}
        {activeModal !== 'wardrobe' && (
          <nav
            aria-label="Thanh công cụ chính"
            data-testid="hud-bottom-dock"
            data-ui-overlay="true"
            onTouchStart={(e) => e.stopPropagation()}
            style={{
              ...GLASS_PILL_STYLE,
              borderRadius: '999px',
              padding: isCompactMobile ? '4px 5px' : isMobileLayout ? '5px 6px' : '6px 10px',
              display: 'flex',
              flexWrap: 'nowrap',
              justifyContent: 'center',
              alignItems: 'center',
              gap: isCompactMobile ? '4px' : isMobileLayout ? '3px' : '6px',
              opacity: hudChromeOpacity,
              transition: 'opacity 520ms ease',
              pointerEvents: 'auto',
              maxWidth: 'calc(100vw - 12px)',
              boxSizing: 'border-box',
            }}
          >
            <DockIconButton
              testId="dock-btn-chat"
              icon={<MessageCircle size={16} strokeWidth={1.85} />}
              label="Chat"
              shortcut={showKeycaps ? 'Enter' : undefined}
              badgeCount={!chatOpen ? unreadChatCount : 0}
              compact={isMobileLayout}
              iconOnly={isCompactMobile}
              active={chatOpen}
              onClick={() => {
                setEmoteTrayOpen(false);
                const next = !chatOpen;
                setChatOpen(next);
                if (next) setTimeout(() => chatInputRef.current?.focus(), 20);
              }}
            />

            <DockIconButton
              testId="dock-btn-props"
              icon={<Smile size={16} strokeWidth={1.85} />}
              label="Đạo cụ"
              shortcut={showKeycaps ? 'Q' : undefined}
              compact={isMobileLayout}
              iconOnly={isCompactMobile}
              active={emoteTrayOpen}
              onClick={() => {
                setChatOpen(false);
                setEmoteTrayOpen((v) => !v);
              }}
            />

            <DockIconButton
              testId="dock-btn-photo"
              icon={<Camera size={16} strokeWidth={2} />}
              label="Máy ảnh"
              shortcut={showKeycaps ? 'P' : undefined}
              compact={isMobileLayout}
              iconOnly={isCompactMobile}
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
              testId="dock-btn-map"
              icon={<MapIcon size={16} strokeWidth={1.85} />}
              label="Bản đồ"
              shortcut={showKeycaps ? 'M' : undefined}
              compact={isMobileLayout}
              iconOnly={isCompactMobile}
              active={activeModal === 'map'}
              onClick={() => toggleModal('map')}
            />

            <DockIconButton
              testId="dock-btn-journal"
              icon={<BookOpen size={16} strokeWidth={1.85} />}
              label="Sổ tay"
              shortcut={showKeycaps ? 'J' : undefined}
              compact={isMobileLayout}
              iconOnly={isCompactMobile}
              active={isJournalActive}
              onClick={() => {
                if (isJournalActive) {
                  setActiveModal('none');
                } else {
                  toggleModal('almanac');
                }
              }}
            />
          </nav>
        )}
      </div>
    </div>
  );
}

function DockIconButton(props: {
  testId?: string;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  badgeCount?: number;
  compact?: boolean;
  iconOnly?: boolean;
  active?: boolean;
  highlight?: boolean;
  onClick: () => void;
}) {
  const {
    testId,
    icon,
    label,
    shortcut,
    badgeCount = 0,
    compact = false,
    iconOnly = false,
    active,
    highlight,
    onClick,
  } = props;
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      title={shortcut ? `[${shortcut}] ${label}` : label}
      aria-label={label}
      aria-pressed={active}
      className="dalat-glass-btn"
      style={{
        position: 'relative',
        minHeight: '44px',
        minWidth: iconOnly ? '46px' : '44px',
        padding: iconOnly ? '6px 8px' : compact ? '6px 8px' : '7px 12px',
        borderRadius: '999px',
        background: active
          ? 'rgba(243, 195, 130, 0.25)'
          : highlight
            ? 'rgba(243, 195, 130, 0.15)'
            : 'transparent',
        border: `1px solid ${
          active
            ? UI_COLORS.warmAmber
            : highlight
              ? 'rgba(243, 195, 130, 0.36)'
              : 'transparent'
        }`,
        color: active || highlight ? UI_COLORS.warmAmber : UI_COLORS.cream,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: compact ? '4px' : '6px',
        fontSize: '12px',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    >
      {icon}
      {!iconOnly && <span style={{ fontWeight: active || highlight ? 600 : 500 }}>{label}</span>}
      {!iconOnly && shortcut && (
        <span
          style={{
            fontFamily: UI_FONTS.mono,
            fontSize: '12px',
            padding: '1px 5px',
            borderRadius: '5px',
            background: 'rgba(255, 255, 255, 0.08)',
            opacity: 0.85,
          }}
        >
          {shortcut}
        </span>
      )}
      {badgeCount > 0 && (
        <span
          style={{
            position: iconOnly ? 'absolute' : 'static',
            top: iconOnly ? '2px' : undefined,
            right: iconOnly ? '2px' : undefined,
            minWidth: '18px',
            height: '18px',
            padding: '0 5px',
            borderRadius: '999px',
            background: UI_COLORS.warmAmber,
            color: '#1C140D',
            fontSize: '11px',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      )}
    </button>
  );
}
