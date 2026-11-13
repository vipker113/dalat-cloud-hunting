import { FormEvent, useState } from 'react';
import { AlertTriangle, Check, Copy, Link2, Navigation, RefreshCw, Users } from 'lucide-react';
import { normalizeRoomCode, ROOM_CODE_REGEX } from '@dalat/protocol';
import type { IMultiplayerController } from '../../network/types';
import { useNetController } from '../../gameplay/netBridge';
import { useGameStore } from '../../store/gameStore';
import { UI_COLORS, UI_FONTS } from '../uiStyles';
import { useViewportLayout } from '../useViewportLayout';
import { ModalShell } from './ModalShell';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatChannelTitle(
  channelName: string | undefined,
  roomCode: string | undefined
): string {
  const fallback = 'Sương Sớm Cầu Đất';
  let title = (channelName || '').trim();
  if (!title) return fallback;
  const code = (roomCode || '').trim();
  if (code) {
    const trailingCodePattern = new RegExp(
      `(?:\\s*\\(\\s*${escapeRegExp(code)}\\s*\\))+\\s*$`,
      'i'
    );
    title = title.replace(trailingCodePattern, '').trim();
  }
  return title || fallback;
}

export function ChannelsModal({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);
  const { isMobileLayout } = useViewportLayout();

  const connected = useGameStore((s) => s.connected);
  const connecting = useGameStore((s) => s.connecting);
  const roomCode = useGameStore((s) => s.roomCode);
  const channelName = useGameStore((s) => s.channelName);
  const rttMs = useGameStore((s) => s.rttMs);
  const availableChannels = useGameStore((s) => s.availableChannels);
  const peers = useGameStore((s) => s.peers);
  const teleportToPeer = useGameStore((s) => s.teleportToPeer);
  const showToast = useGameStore((s) => s.showToast);
  const recordUXEvent = useGameStore((s) => s.recordUXEvent);

  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [codeValidationHint, setCodeValidationHint] = useState<string | null>(null);
  const [switchBanner, setSwitchBanner] = useState<{
    tone: 'success' | 'warning';
    message: string;
  } | null>(null);
  const [switching, setSwitching] = useState(false);

  const peerList = Object.values(peers);
  const humanPeers = peerList.filter((p) => !p.isBot);
  const orderedPeers = [...humanPeers, ...peerList.filter((p) => p.isBot)];
  const totalCount = 1 + humanPeers.length;
  const displayRoomCode = roomCode || 'MAY-01';
  const cleanActiveTitle = formatChannelTitle(channelName, displayRoomCode);

  const inviteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(displayRoomCode)}`
      : `?room=${displayRoomCode}`;

  const handleCopyInvite = async () => {
    recordUXEvent('invite_copy');
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      showToast(`🔗 Đã sao chép link mời bạn bè vào phòng ${displayRoomCode}!`);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      showToast(`Link phòng của bạn: ${inviteUrl}`);
    }
  };

  const executeSwitchChannel = async (targetCode: string) => {
    if (switching) return;
    setSwitching(true);
    setSwitchBanner(null);
    try {
      const res = await net.switchChannel(targetCode);
      if (res?.ok === false) {
        const errMsg = res.error || 'Không thể chuyển sang kênh này lúc này.';
        setSwitchBanner({ tone: 'warning', message: errMsg });
        showToast(`⚠️ ${errMsg}`);
        return;
      }
      const finalRoom = res?.roomCode || targetCode;
      const okMsg = `✓ Đã chuyển sang kênh sương sớm ${finalRoom}!`;
      setSwitchBanner({ tone: 'success', message: okMsg });
      showToast(okMsg);
      setJoinCode('');
      setCodeValidationHint(null);
    } catch {
      const errMsg = 'Không thể chuyển kênh lúc này, vui lòng thử lại.';
      setSwitchBanner({ tone: 'warning', message: errMsg });
      showToast(`⚠️ ${errMsg}`);
    } finally {
      setSwitching(false);
    }
  };

  const handleJoinCustom = async (e: FormEvent) => {
    e.preventDefault();
    const rawTrimmed = joinCode.trim();
    if (!rawTrimmed || switching) return;

    const normalized = normalizeRoomCode(rawTrimmed);
    if (/[^A-Za-z0-9-]/.test(rawTrimmed) || !ROOM_CODE_REGEX.test(normalized)) {
      setCodeValidationHint(
        'Mã phòng cần từ 3–14 ký tự chữ, số hoặc dấu gạch ngang (VD: MAY-02, BAN-BE-01).'
      );
      return;
    }

    setCodeValidationHint(null);
    await executeSwitchChannel(normalized);
  };

  return (
    <ModalShell
      title="Kênh Đồi Sương & Mời Bạn Bè"
      subtitle="Sao chép link mời bạn bè vào đúng ngọn đồi này hoặc dịch chuyển ngay tới cạnh người quen"
      maxWidth="580px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Active Room & 1-Click Copy Invite Link */}
        <div
          style={{
            padding: '16px',
            borderRadius: '18px',
            background: 'rgba(243, 195, 130, 0.08)',
            border: `1px solid ${UI_COLORS.borderStrong}`,
          }}
        >
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
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', color: UI_COLORS.warmAmber, fontFamily: UI_FONTS.mono }}>
                PHÒNG HIỆN TẠI •{' '}
                {connected
                  ? `Độ trễ ${rttMs}ms`
                  : connecting
                    ? 'Đang kết nối lại...'
                    : 'Chế độ Dạo Đồi Một Mình'}
              </div>
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 600,
                  marginTop: '2px',
                  wordBreak: 'break-word',
                }}
              >
                {cleanActiveTitle}{' '}
                <span style={{ fontFamily: UI_FONTS.mono, color: UI_COLORS.warmAmber }}>
                  ({displayRoomCode})
                </span>
              </div>
            </div>
            <div
              style={{
                padding: '5px 11px',
                borderRadius: '999px',
                background: 'rgba(255,255,255,0.06)',
                fontFamily: UI_FONTS.mono,
                fontSize: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                flexShrink: 0,
              }}
            >
              <Users size={13} style={{ color: UI_COLORS.warmAmber }} />
              <span>{totalCount} người</span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                flex: '1 1 200px',
                minWidth: 0,
                padding: '9px 12px',
                borderRadius: '11px',
                background: 'rgba(8, 12, 20, 0.54)',
                border: `1px solid ${UI_COLORS.border}`,
                fontFamily: UI_FONTS.mono,
                fontSize: '12px',
                color: UI_COLORS.mistText,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <Link2 size={12} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-1px' }} />
              {inviteUrl}
            </div>

            <button
              type="button"
              onClick={handleCopyInvite}
              className="dalat-glass-btn"
              style={{
                minHeight: '42px',
                padding: '9px 15px',
                borderRadius: '11px',
                background: copied
                  ? 'rgba(130, 179, 154, 0.25)'
                  : 'linear-gradient(135deg, rgba(243, 195, 130, 0.94), rgba(226, 148, 86, 0.92))',
                border: '1px solid rgba(255, 226, 182, 0.48)',
                color: copied ? '#C6EBD5' : '#171D2A',
                fontSize: '12.5px',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                flexShrink: 0,
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? 'Đã chép link' : 'Chép link mời bạn'}</span>
            </button>
          </div>
        </div>

        {/* Switch Channel Feedback Banner (Green on success, Amber warning on failure) */}
        {switchBanner && (
          <div
            role={switchBanner.tone === 'warning' ? 'alert' : 'status'}
            aria-live="polite"
            data-testid="channel-switch-banner"
            style={{
              padding: '10px 13px',
              borderRadius: '12px',
              background:
                switchBanner.tone === 'warning'
                  ? 'rgba(243, 195, 130, 0.14)'
                  : 'rgba(130, 214, 158, 0.15)',
              border: `1px solid ${
                switchBanner.tone === 'warning'
                  ? 'rgba(243, 195, 130, 0.56)'
                  : 'rgba(130, 214, 158, 0.52)'
              }`,
              color: switchBanner.tone === 'warning' ? '#FFE1AF' : '#C8F4D8',
              fontSize: '12.5px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {switchBanner.tone === 'warning' && (
              <AlertTriangle size={15} style={{ color: UI_COLORS.warmAmber, flexShrink: 0 }} />
            )}
            <span>{switchBanner.message}</span>
          </div>
        )}

        {/* People Currently on the Hill + 1-Tap Teleport to Friend */}
        {orderedPeers.length > 0 && (
          <div>
            <div
              style={{
                fontSize: '12.5px',
                fontWeight: 600,
                color: UI_COLORS.warmAmber,
                marginBottom: '8px',
              }}
            >
              Lữ khách đang trên đồi ({orderedPeers.length}) — Chạm để ghé tới cạnh nhau
            </div>
            <div
              className="dalat-scroll"
              style={{
                maxHeight: '164px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                paddingRight: '2px',
              }}
            >
              {orderedPeers.map((p) => (
                <div
                  key={p.sessionId}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.045)',
                    border: `1px solid ${UI_COLORS.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <span>{p.isBot ? '🌲' : '🟢'}</span>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: UI_COLORS.cream,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.displayName}
                    </span>
                    <span style={{ fontSize: '12px', color: UI_COLORS.mutedText, whiteSpace: 'nowrap' }}>
                      {p.isBot ? '• Lữ khách dạo đồi' : '• Người chơi'}
                    </span>
                  </div>

                  <button
                    type="button"
                    data-testid={`teleport-peer-${p.sessionId}`}
                    onClick={() => teleportToPeer(p.sessionId)}
                    className="dalat-glass-btn"
                    style={{
                      minHeight: '38px',
                      padding: '6px 12px',
                      borderRadius: '999px',
                      background: 'rgba(243, 195, 130, 0.16)',
                      border: `1px solid ${UI_COLORS.borderStrong}`,
                      color: UI_COLORS.warmAmber,
                      fontSize: '12px',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    <Navigation size={12} />
                    <span>Tới chỗ bạn</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Join / Create Specific Friend Room Code */}
        <div>
          <form onSubmit={handleJoinCustom} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="text"
              aria-label="Mã phòng bạn bè"
              aria-invalid={Boolean(codeValidationHint)}
              value={joinCode}
              maxLength={14}
              onChange={(e) => {
                setJoinCode(e.target.value.toUpperCase());
                if (codeValidationHint) setCodeValidationHint(null);
              }}
              placeholder="Nhập mã phòng (3–14 ký tự, VD: MAY-02)…"
              style={{
                flex: '1 1 200px',
                minWidth: 0,
                boxSizing: 'border-box',
                padding: '10px 13px',
                borderRadius: '12px',
                background: 'rgba(10, 15, 25, 0.58)',
                border: `1px solid ${codeValidationHint ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                color: UI_COLORS.cream,
                fontFamily: UI_FONTS.mono,
                fontSize: isMobileLayout ? '16px' : '13px',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={switching}
              className="dalat-glass-btn"
              style={{
                minHeight: '44px',
                padding: '10px 16px',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: `1px solid ${UI_COLORS.borderStrong}`,
                color: UI_COLORS.warmAmber,
                fontSize: '12.5px',
                fontWeight: 600,
              }}
            >
              {switching ? 'Đang chuyển…' : 'Chuyển phòng'}
            </button>
          </form>

          {codeValidationHint && (
            <div
              role="alert"
              data-testid="channel-code-validation-hint"
              style={{
                marginTop: '6px',
                fontSize: '12px',
                color: UI_COLORS.warmAmber,
                paddingLeft: '4px',
              }}
            >
              ⚠️ {codeValidationHint}
            </div>
          )}
        </div>

        {/* Active Server Channels List */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              marginBottom: '8px',
            }}
          >
            <span style={{ fontSize: '12px', color: UI_COLORS.mistText }}>
              Danh sách kênh sương sớm đang mở
            </span>
            <button
              type="button"
              onClick={() => net.refreshChannels().catch(() => {})}
              className="dalat-glass-btn"
              style={{
                minHeight: '40px',
                padding: '6px 12px',
                borderRadius: '999px',
                background: 'transparent',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.mistText,
                fontSize: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <RefreshCw size={12} />
              <span>Làm mới</span>
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {availableChannels.length === 0 ? (
              <div
                style={{
                  padding: '13px 14px',
                  borderRadius: '13px',
                  background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${UI_COLORS.border}`,
                  fontSize: '12.5px',
                  color: UI_COLORS.mistText,
                }}
              >
                Đang đồng bộ cùng kênh{' '}
                <strong style={{ color: UI_COLORS.warmAmber }}>{displayRoomCode}</strong>. Gửi link
                mời ở trên để bạn bè bước vào đúng đồi mây này!
              </div>
            ) : (
              availableChannels.map((ch) => {
                const normalizedChCode = normalizeRoomCode(ch.roomCode) || ch.roomCode;
                const isCurrent =
                  normalizedChCode === displayRoomCode ||
                  ch.roomCode === roomCode ||
                  ch.roomId === roomCode;
                const cleanTitle = formatChannelTitle(ch.channelName, ch.roomCode);
                return (
                  <button
                    key={ch.roomId}
                    type="button"
                    disabled={isCurrent || switching}
                    onClick={() => executeSwitchChannel(normalizedChCode || ch.roomId)}
                    className="dalat-glass-btn"
                    style={{
                      minHeight: '48px',
                      padding: '11px 14px',
                      borderRadius: '13px',
                      background: isCurrent
                        ? 'rgba(243, 195, 130, 0.16)'
                        : 'rgba(255, 255, 255, 0.04)',
                      border: `1px solid ${isCurrent ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: UI_COLORS.cream,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <div style={{ textAlign: 'left', minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, wordBreak: 'break-word' }}>
                        {cleanTitle}{' '}
                        <span style={{ fontFamily: UI_FONTS.mono, color: UI_COLORS.warmAmber }}>
                          ({ch.roomCode})
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: UI_COLORS.mistText }}>
                        {isCurrent ? 'Đang ở kênh này' : 'Nhấn để ghé sang'}
                      </div>
                    </div>
                    <span
                      style={{
                        fontFamily: UI_FONTS.mono,
                        fontSize: '12px',
                        color: UI_COLORS.warmAmber,
                        flexShrink: 0,
                      }}
                    >
                      {ch.playerCount}/{ch.softCap}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
