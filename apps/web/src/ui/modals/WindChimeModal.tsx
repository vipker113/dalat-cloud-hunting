import { FormEvent, useMemo, useState } from 'react';
import { Feather, Wind } from 'lucide-react';
import { WindChimeNote } from '@dalat/protocol';
import type { IMultiplayerController } from '../../network/types';
import { useNetController } from '../../gameplay/netBridge';
import { useGameStore } from '../../store/gameStore';
import { UI_COLORS, UI_FONTS } from '../uiStyles';
import { ModalShell } from './ModalShell';

const STARTER_WISHES: WindChimeNote[] = [
  {
    id: 'seed-wish-1',
    authorName: 'An Nhiên',
    message: 'Mong những ngày sắp tới lòng mình luôn nhẹ tênh như làn mây sớm trên đồi Thiên Phúc Đức.',
    createdAt: Date.now() - 2400000,
  },
  {
    id: 'seed-wish-2',
    authorName: 'Gia Huy',
    message: 'Chúc người đọc được dòng chữ này một mùa thu Đà Lạt thật ấm áp và bình yên.',
    createdAt: Date.now() - 5100000,
  },
  {
    id: 'seed-wish-3',
    authorName: 'Mai Anh',
    message: 'Hẹn một buổi bình minh năm sau cùng quay lại gốc thông già này nhé!',
    createdAt: Date.now() - 8400000,
  },
  {
    id: 'seed-wish-4',
    authorName: 'Khánh Linh',
    message: 'Gửi lại mọi âu lo cho gió ngàn, giữ lại mùi hương cà phê nóng và nắng mai.',
    createdAt: Date.now() - 12000000,
  },
];

export function WindChimeModal({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);
  const windChimeNotes = useGameStore((s) => s.windChimeNotes);
  const showToast = useGameStore((s) => s.showToast);

  const [wishText, setWishText] = useState('');

  const notes = useMemo(
    () => (windChimeNotes.length > 0 ? windChimeNotes : STARTER_WISHES),
    [windChimeNotes]
  );

  const handleHangWish = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = wishText.trim().slice(0, 140);
    if (!trimmed) return;

    const st = useGameStore.getState();
    const prevFirst = st.windChimeNotes[0]?.id;
    net.addWindChimeNote(trimmed);

    if (!st.connected && useGameStore.getState().windChimeNotes[0]?.id === prevFirst) {
      st.prependWindChimeNote({
        id: `wish-${Date.now()}`,
        authorName: st.displayName,
        message: trimmed,
        createdAt: Date.now(),
      });
    }

    setWishText('');
    showToast('🎐 Đã treo thẻ gỗ Mộc Diệp lên tán Cây Thông Cô Đơn — Tiếng chuông gió khẽ ngân...');
  };

  return (
    <ModalShell
      title="Thẻ Gỗ Ước Nguyện (Mộc Diệp)"
      subtitle="Dưới tán Cây Thông Cô Đơn lộng gió nhìn về đỉnh Langbiang, mỗi thẻ gỗ gửi gắm một lời chúc lành"
      maxWidth="720px"
    >
      {/* Write & Hang New Wooden Plaque */}
      <form
        onSubmit={handleHangWish}
        style={{
          padding: '15px 16px',
          borderRadius: '18px',
          background: 'rgba(243, 195, 130, 0.08)',
          border: `1px solid ${UI_COLORS.borderStrong}`,
          marginBottom: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            fontSize: '12px',
            color: UI_COLORS.warmAmber,
          }}
        >
          <Feather size={14} />
          <span>Viết điều ước của bạn lên thẻ gỗ thông</span>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={wishText}
            maxLength={140}
            onChange={(e) => setWishText(e.target.value)}
            placeholder="Gửi đôi dòng ước nguyện theo gió cao nguyên..."
            style={{
              flex: 1,
              minWidth: '220px',
              padding: '10px 13px',
              borderRadius: '12px',
              background: 'rgba(10, 15, 25, 0.55)',
              border: `1px solid ${UI_COLORS.border}`,
              color: UI_COLORS.cream,
              fontSize: '13px',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            className="dalat-glass-btn"
            style={{
              padding: '10px 18px',
              borderRadius: '12px',
              background:
                'linear-gradient(135deg, rgba(226, 152, 86, 0.92), rgba(196, 112, 68, 0.92))',
              border: '1px solid rgba(255, 226, 182, 0.5)',
              color: '#171D2A',
              fontSize: '12.5px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Wind size={14} />
            <span>Treo thẻ gỗ</span>
          </button>
        </div>
      </form>

      {/* Swaying Cedar-Wood Wish Plaques */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '14px',
        }}
      >
        {notes.map((note, idx) => (
          <div
            key={note.id}
            style={{
              position: 'relative',
              padding: '20px 15px 15px',
              borderRadius: '10px 10px 16px 16px',
              background:
                'linear-gradient(180deg, rgba(168, 118, 74, 0.34) 0%, rgba(114, 76, 46, 0.38) 100%)',
              border: '1px solid rgba(235, 192, 140, 0.32)',
              transformOrigin: 'top center',
              animation: `dalatPlaqueSway ${4.4 + (idx % 4) * 0.6}s ease-in-out infinite`,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            {/* Red braided cord hole */}
            <div
              style={{
                position: 'absolute',
                top: '7px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#C95244',
                boxShadow: '0 0 0 2px rgba(20, 14, 10, 0.6)',
              }}
            />

            <p
              style={{
                fontFamily: UI_FONTS.serif,
                fontStyle: 'italic',
                fontSize: '13.5px',
                lineHeight: 1.52,
                color: '#FCF3E4',
              }}
            >
              “{note.message}”
            </p>

            <div
              style={{
                fontSize: '11px',
                color: UI_COLORS.warmAmber,
                textAlign: 'right',
                fontWeight: 500,
              }}
            >
              — {note.authorName}
            </div>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}
