import { useEffect, useMemo, useState } from 'react';
import { Camera, Heart } from 'lucide-react';
import { PolaroidEntry } from '@dalat/protocol';
import type { IMultiplayerController } from '../../network/types';
import { useNetController } from '../../gameplay/netBridge';
import { useGameStore } from '../../store/gameStore';
import { UI_COLORS, UI_FONTS } from '../uiStyles';
import { JournalNavBar } from './JournalNavBar';
import { ModalShell } from './ModalShell';

// Registered at module evaluation (before PlayerController/ModalShell mount) so capture-phase
// Escape closes ONLY the open Polaroid lightbox without closing the parent modal or triggering HUD Esc.
let activePolaroidLightboxCloser: (() => void) | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activePolaroidLightboxCloser) {
        e.preventDefault();
        e.stopImmediatePropagation();
        activePolaroidLightboxCloser();
      }
    },
    { capture: true }
  );
}

function makeStarterPolaroidSvg(
  skyTop: string,
  skyBot: string,
  cloudHex: string,
  title: string,
  timeText: string
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="630" viewBox="0 0 520 630">
    <rect width="520" height="630" fill="#F8F2E6"/>
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${skyTop}"/>
        <stop offset="68%" stop-color="${skyBot}"/>
        <stop offset="100%" stop-color="#2D384F"/>
      </linearGradient>
    </defs>
    <rect x="28" y="28" width="464" height="464" fill="url(#g)"/>
    <circle cx="362" cy="215" r="38" fill="#FFE6B3" opacity="0.88"/>
    <ellipse cx="260" cy="370" rx="260" ry="72" fill="${cloudHex}" opacity="0.85"/>
    <ellipse cx="150" cy="395" rx="190" ry="58" fill="#FFF7EB" opacity="0.72"/>
    <path d="M28 492 L28 388 Q135 342 252 405 Q372 455 492 396 L492 492 Z" fill="#22312B"/>
    <text x="34" y="538" fill="#262C38" font-family="Georgia, serif" font-style="italic" font-size="20">${title}</text>
    <text x="34" y="572" fill="#6E665B" font-family="sans-serif" font-size="13">${timeText}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const STARTER_POLAROIDS: PolaroidEntry[] = [
  {
    id: 'seed-pol-1',
    authorName: 'Minh Khuê',
    caption: 'Biển mây đầu mùa tràn qua chân cầu gỗ...',
    landmarkId: 'cau-go-san-may',
    landmarkName: 'Cầu Gỗ Săn Mây Cầu Đất',
    weatherId: 'golden_cloud_sea',
    gameTimeLabel: '05:24',
    altitudeASL: 1648,
    imageDataUrl: makeStarterPolaroidSvg(
      '#283B66',
      '#F59D73',
      '#FFEAD4',
      'Biển mây đầu mùa tràn qua chân cầu gỗ...',
      '05:24 • Đồi Cầu Đất 1.648m • Biển Mây Vàng'
    ),
    likes: 14,
    createdAt: Date.now() - 1800000,
  },
  {
    id: 'seed-pol-2',
    authorName: 'Hoàng Nam',
    caption: 'Ly phin nóng bốc khói trên hiên gỗ Mơ Sương',
    landmarkId: 'quan-mo-suong',
    landmarkName: 'Tiệm Cà Phê Gỗ "Mơ Sương"',
    weatherId: 'morning_mist_boil',
    gameTimeLabel: '06:48',
    altitudeASL: 1585,
    imageDataUrl: makeStarterPolaroidSvg(
      '#3D6EA6',
      '#FFD49E',
      '#F5F8FC',
      'Ly phin nóng bốc khói trên hiên gỗ Mơ Sương',
      '06:48 • Tiệm Mơ Sương 1.585m • Sương Sôi Lưng Đồi'
    ),
    likes: 9,
    createdAt: Date.now() - 3600000,
  },
  {
    id: 'seed-pol-3',
    authorName: 'Thảo Nguyên',
    caption: 'Thung lũng đèn vàng thức trắng dưới làn sương',
    landmarkId: 'dai-ngam-den',
    landmarkName: 'Đài Ngắm Thung Lũng Đèn',
    weatherId: 'deep_evening_fog',
    gameTimeLabel: '04:42',
    altitudeASL: 1534,
    imageDataUrl: makeStarterPolaroidSvg(
      '#141E36',
      '#3B4C73',
      '#F3B969',
      'Thung lũng đèn vàng thức trắng dưới làn sương',
      '04:42 • Thung Lũng Đèn 1.534m • Chạng Vạng'
    ),
    likes: 19,
    createdAt: Date.now() - 5400000,
  },
];

export function PolaroidWallModal({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);
  const polaroids = useGameStore((s) => s.polaroids);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const setPhotoMode = useGameStore((s) => s.setPhotoMode);
  const setHeldItem = useGameStore((s) => s.setHeldItem);

  const [likedIds, setLikedIds] = useState<Record<string, boolean>>({});
  const [localStarterLikes, setLocalStarterLikes] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<PolaroidEntry | null>(null);

  useEffect(() => {
    if (!selected) {
      activePolaroidLightboxCloser = null;
      return;
    }
    const closeLightbox = () => setSelected(null);
    activePolaroidLightboxCloser = closeLightbox;
    return () => {
      if (activePolaroidLightboxCloser === closeLightbox) {
        activePolaroidLightboxCloser = null;
      }
    };
  }, [selected]);

  const displayList = useMemo(() => {
    if (polaroids.length > 0) return polaroids;
    return STARTER_POLAROIDS;
  }, [polaroids]);

  const handleLike = (item: PolaroidEntry) => {
    if (likedIds[item.id]) return;
    setLikedIds((s) => ({ ...s, [item.id]: true }));

    if (item.id.startsWith('seed-pol-')) {
      setLocalStarterLikes((s) => ({ ...s, [item.id]: (s[item.id] || 0) + 1 }));
      return;
    }

    const st = useGameStore.getState();
    const before = st.polaroids.find((p) => p.id === item.id)?.likes ?? 0;
    net.likePolaroid(item.id);
    if (!st.connected) {
      const after = useGameStore.getState().polaroids.find((p) => p.id === item.id)?.likes ?? 0;
      if (after === before) {
        st.setPolaroids(
          st.polaroids.map((p) => (p.id === item.id ? { ...p, likes: p.likes + 1 } : p))
        );
      }
    }
  };

  return (
    <ModalShell
      title="Bảng Ảnh Kỷ Niệm Săn Mây"
      subtitle="Những tấm ảnh Polaroid 35mm được lữ khách chụp và ghim lại trên vách gỗ Tiệm Mơ Sương"
      maxWidth="820px"
    >
      <JournalNavBar active="polaroids" />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
        <button
          type="button"
          onClick={() => {
            setActiveModal('none');
            setHeldItem('film_camera');
            net.sendHeldItem('film_camera');
            setPhotoMode(true);
          }}
          className="dalat-glass-btn"
          style={{
            minHeight: '44px',
            padding: '8px 16px',
            borderRadius: '999px',
            background:
              'linear-gradient(135deg, rgba(243, 195, 130, 0.94), rgba(226, 148, 86, 0.92))',
            border: '1px solid rgba(255, 226, 182, 0.52)',
            color: '#171D2A',
            fontSize: '12.5px',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
          }}
        >
          <Camera size={15} />
          <span>Mở Máy Ảnh Film Chụp Ngay</span>
        </button>
      </div>

      {/* Selected Lightbox View */}
      {selected && (
        <button
          type="button"
          data-testid="polaroid-lightbox-close"
          aria-label={`Thu gọn ảnh kỷ niệm của ${selected.authorName}`}
          onClick={() => setSelected(null)}
          className="dalat-glass-btn"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            marginBottom: '18px',
            padding: '16px',
            borderRadius: '18px',
            background: 'rgba(8, 12, 20, 0.78)',
            border: `1px solid ${UI_COLORS.borderStrong}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
            fontFamily: UI_FONTS.sans,
          }}
        >
          <img
            src={selected.imageDataUrl}
            alt={selected.caption}
            style={{
              maxWidth: '340px',
              width: '100%',
              borderRadius: '6px',
              boxShadow: '0 14px 36px rgba(0,0,0,0.5)',
            }}
          />
          <div style={{ fontSize: '12px', color: UI_COLORS.mistText, textAlign: 'center' }}>
            Chụp bởi <strong style={{ color: UI_COLORS.cream }}>{selected.authorName}</strong> tại{' '}
            {selected.landmarkName} • Chạm vào ảnh hoặc nhấn Esc để thu gọn
          </div>
        </button>
      )}

      {/* Polaroid Corkboard Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 210px), 1fr))',
          gap: '16px',
        }}
      >
        {displayList.map((item, idx) => {
          const tilt = idx % 3 === 0 ? -1.1 : idx % 3 === 1 ? 1.0 : -0.4;
          const totalLikes = item.likes + (localStarterLikes[item.id] || 0);
          const isLiked = Boolean(likedIds[item.id]);

          return (
            <div
              key={item.id}
              style={{
                padding: '10px 10px 12px',
                borderRadius: '12px',
                background: 'rgba(250, 244, 233, 0.96)',
                color: '#232834',
                boxShadow: '0 12px 28px rgba(4, 8, 16, 0.42)',
                transform: `rotate(${tilt}deg)`,
                transition: 'transform 180ms ease',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                boxSizing: 'border-box',
                minWidth: 0,
              }}
            >
              <button
                type="button"
                onClick={() => setSelected(item)}
                aria-label={`Phóng to ảnh của ${item.authorName}: ${item.caption}`}
                style={{
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  width: '100%',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'block',
                }}
              >
                <img
                  src={item.imageDataUrl}
                  alt={item.caption}
                  style={{
                    width: '100%',
                    borderRadius: '4px',
                    display: 'block',
                  }}
                />
              </button>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 4px',
                  gap: '6px',
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    color: '#484038',
                    fontFamily: UI_FONTS.sans,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  📷 {item.authorName}
                </span>

                <button
                  type="button"
                  aria-label={`Thả tim ảnh của ${item.authorName} (${totalLikes} lượt thích)`}
                  aria-pressed={isLiked}
                  onClick={() => handleLike(item)}
                  style={{
                    minHeight: '36px',
                    minWidth: '44px',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    border: '1px solid rgba(198, 92, 82, 0.38)',
                    background: isLiked ? 'rgba(218, 92, 82, 0.16)' : 'rgba(0,0,0,0.04)',
                    color: isLiked ? '#B83D33' : '#4E453D',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    flexShrink: 0,
                  }}
                >
                  <Heart size={13} fill={isLiked ? '#B83D33' : 'none'} />
                  <span>{totalLikes}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}
