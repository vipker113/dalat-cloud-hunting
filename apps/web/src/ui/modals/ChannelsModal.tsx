import { FormEvent, useState } from 'react';
import { Check, Copy, Link2, RefreshCw, Users } from 'lucide-react';
import type { IMultiplayerController } from '../../network/types';
import { useNetController } from '../../gameplay/netBridge';
import { useGameStore } from '../../store/gameStore';
import { UI_COLORS, UI_FONTS } from '../uiStyles';
import { ModalShell } from './ModalShell';

export function ChannelsModal({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);

  const connected = useGameStore((s) => s.connected);
  const roomCode = useGameStore((s) => s.roomCode);
  const channelName = useGameStore((s) => s.channelName);
  const rttMs = useGameStore((s) => s.rttMs);
  const availableChannels = useGameStore((s) => s.availableChannels);
  const peerCount = useGameStore((s) => Object.keys(s.peers).length + s.farBeacons.length);
  const showToast = useGameStore((s) => s.showToast);

  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [switching, setSwitching] = useState(false);

  const inviteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomCode || 'MAY-01')}`
      : `?room=${roomCode || 'MAY-01'}`;

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      showToast(`🔗 Đã sao chép link mời bạn bè vào phòng ${roomCode || 'MAY-01'}!`);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      showToast(`Link phòng của bạn: ${inviteUrl}`);
    }
  };

  const handleJoinCustom = async (e: FormEvent) => {
    e.preventDefault();
    const target = joinCode.trim().toUpperCase();
    if (!target || switching) return;
    setSwitching(true);
    try {
      await net.switchChannel(target);
      showToast(`☁️ Đã chuyển sang kênh sương sớm ${target}`);
      setJoinCode('');
    } catch {
      showToast('Không thể chuyển kênh lúc này, vui lòng thử lại.');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <ModalShell
      title="Kênh Đồi Sương & Mời Bạn Bè"
      subtitle="Mỗi kênh tối ưu 35–50 lữ khách để không gian săn mây luôn yên bình và mượt mà"
      maxWidth="560px"
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
            }}
          >
            <div>
              <div style={{ fontSize: '11px', color: UI_COLORS.warmAmber, fontFamily: UI_FONTS.mono }}>
                PHÒNG HIỆN TẠI • {connected ? `Độ trễ ${rttMs}ms` : 'Chế độ Dạo Đồi'}
              </div>
              <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '2px' }}>
                {channelName || 'Sương Sớm Cầu Đất'} ({roomCode || 'MAY-01'})
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
              }}
            >
              <Users size={13} style={{ color: UI_COLORS.warmAmber }} />
              <span>{peerCount + 1} người</span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '12px',
            }}
          >
            <div
              style={{
                flex: 1,
                padding: '9px 12px',
                borderRadius: '11px',
                background: 'rgba(8, 12, 20, 0.52)',
                border: `1px solid ${UI_COLORS.border}`,
                fontFamily: UI_FONTS.mono,
                fontSize: '11.5px',
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
                padding: '9px 14px',
                borderRadius: '11px',
                background: copied
                  ? 'rgba(130, 179, 154, 0.25)'
                  : 'linear-gradient(135deg, rgba(226, 152, 86, 0.92), rgba(196, 112, 68, 0.92))',
                border: '1px solid rgba(255, 226, 182, 0.45)',
                color: copied ? '#C6EBD5' : '#171D2A',
                fontSize: '12px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                flexShrink: 0,
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? 'Đã chép link' : 'Mời bạn bè'}</span>
            </button>
          </div>
        </div>

        {/* Join / Create Specific Friend Room Code */}
        <form onSubmit={handleJoinCustom} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={joinCode}
            maxLength={14}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Nhập mã phòng bạn bè (VD: MAY-02, NHOM-BAN)..."
            style={{
              flex: 1,
              padding: '10px 13px',
              borderRadius: '12px',
              background: 'rgba(10, 15, 25, 0.55)',
              border: `1px solid ${UI_COLORS.border}`,
              color: UI_COLORS.cream,
              fontFamily: UI_FONTS.mono,
              fontSize: '12.5px',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={switching}
            className="dalat-glass-btn"
            style={{
              padding: '10px 16px',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.08)',
              border: `1px solid ${UI_COLORS.borderStrong}`,
              color: UI_COLORS.warmAmber,
              fontSize: '12.5px',
              fontWeight: 600,
            }}
          >
            Chuyển phòng
          </button>
        </form>

        {/* Active Server Channels List */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
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
                padding: '4px 9px',
                borderRadius: '999px',
                background: 'transparent',
                border: `1px solid ${UI_COLORS.border}`,
                color: UI_COLORS.mistText,
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <RefreshCw size={11} />
              <span>Làm mới</span>
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {availableChannels.length === 0 ? (
              <div
                style={{
                  padding: '14px',
                  borderRadius: '13px',
                  background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${UI_COLORS.border}`,
                  fontSize: '12.5px',
                  color: UI_COLORS.mistText,
                }}
              >
                Đang đồng bộ cùng kênh <strong style={{ color: UI_COLORS.warmAmber }}>{roomCode || 'MAY-01'}</strong>.
                Bạn có thể gửi link mời ở trên để bạn bè bước vào đúng đồi mây này!
              </div>
            ) : (
              availableChannels.map((ch) => {
                const isCurrent = ch.roomCode === roomCode || ch.roomId === roomCode;
                return (
                  <button
                    key={ch.roomId}
                    type="button"
                    disabled={isCurrent || switching}
                    onClick={async () => {
                      setSwitching(true);
                      try {
                        await net.switchChannel(ch.roomCode || ch.roomId);
                      } finally {
                        setSwitching(false);
                      }
                    }}
                    className="dalat-glass-btn"
                    style={{
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
                    }}
                  >
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>
                        {ch.channelName}{' '}
                        <span style={{ fontFamily: UI_FONTS.mono, color: UI_COLORS.warmAmber }}>
                          ({ch.roomCode})
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: UI_COLORS.mistText }}>
                        {isCurrent ? 'Đang ở kênh này' : 'Nhấn để ghé sang'}
                      </div>
                    </div>
                    <span style={{ fontFamily: UI_FONTS.mono, fontSize: '12px', color: UI_COLORS.warmAmber }}>
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
