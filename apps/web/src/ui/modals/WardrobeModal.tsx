import { useState } from 'react';
import { Backpack, Check } from 'lucide-react';
import {
  CoatStyleId,
  HeadwearId,
  HIGHLAND_PALETTE,
  PlayerOutfit,
} from '@dalat/protocol';
import type { IMultiplayerController } from '../../network/types';
import { useNetController } from '../../gameplay/netBridge';
import { useGameStore } from '../../store/gameStore';
import { UI_COLORS, UI_FONTS } from '../uiStyles';
import { ModalShell } from './ModalShell';

const COAT_STYLES: Array<{ id: CoatStyleId; title: string; desc: string }> = [
  { id: 'wool_trench', title: 'Áo Măng-tô Dạ Dài', desc: 'Cổ điển Đà Lạt, thắt đai ấm áp' },
  { id: 'knit_sweater', title: 'Áo Len Đan Thừng', desc: 'Mềm mại, dạo phố sương mờ' },
  { id: 'puffer_vest', title: 'Gile Phao Đồi Chè', desc: 'Năng động leo dốc săn mây' },
  { id: 'vintage_poncho', title: 'Áo Choàng Poncho', desc: 'Phóng khoáng du mục cao nguyên' },
];

const HEADWEAR_STYLES: Array<{ id: HeadwearId; title: string }> = [
  { id: 'beanie', title: 'Mũ Len Quả Bông' },
  { id: 'beret', title: 'Mũ Nồi Beret Pháp' },
  { id: 'scarf_only', title: 'Quàng Khăn Cao Cổ' },
  { id: 'none', title: 'Tóc Gió Tự Nhiên' },
];

export function WardrobeModal({ net: propNet }: { net?: IMultiplayerController }) {
  const net = useNetController(propNet);
  const displayName = useGameStore((s) => s.displayName);
  const outfit = useGameStore((s) => s.outfit);
  const setDisplayName = useGameStore((s) => s.setDisplayName);
  const updateOutfit = useGameStore((s) => s.updateOutfit);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const showToast = useGameStore((s) => s.showToast);

  const [nameDraft, setNameDraft] = useState(displayName);

  const applyPatch = (patch: Partial<PlayerOutfit>) => {
    const next = { ...outfit, ...patch };
    updateOutfit(patch);
    net.sendProfile(nameDraft.trim() || displayName, next);
  };

  const handleSaveAndClose = () => {
    const cleanName = nameDraft.trim().slice(0, 24) || displayName;
    setDisplayName(cleanName);
    net.sendProfile(cleanName, useGameStore.getState().outfit);
    showToast('🧣 Đã cập nhật trang phục săn mây của bạn!');
    setActiveModal('none');
  };

  return (
    <ModalShell
      title="Tủ Đồ Áo Ấm Cao Nguyên"
      subtitle="Phối áo khoác dạ, khăn len đan tay và balo dã ngoại cho buổi sớm Cầu Đất se lạnh"
      maxWidth="620px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {/* Display Name */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              color: UI_COLORS.mistText,
              marginBottom: '6px',
            }}
          >
            Tên hiển thị trên đồi
          </label>
          <input
            type="text"
            value={nameDraft}
            maxLength={24}
            onChange={(e) => setNameDraft(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 13px',
              borderRadius: '12px',
              background: 'rgba(10, 15, 25, 0.55)',
              border: `1px solid ${UI_COLORS.border}`,
              color: UI_COLORS.cream,
              fontSize: '13.5px',
              outline: 'none',
            }}
          />
        </div>

        {/* Coat Style */}
        <div>
          <div style={{ fontSize: '12px', color: UI_COLORS.mistText, marginBottom: '8px' }}>
            Kiểu áo khoác mùa lạnh
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '8px',
            }}
          >
            {COAT_STYLES.map((c) => {
              const active = outfit.coatStyle === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => applyPatch({ coatStyle: c.id })}
                  className="dalat-glass-btn"
                  style={{
                    padding: '11px 13px',
                    borderRadius: '14px',
                    background: active
                      ? 'rgba(243, 195, 130, 0.2)'
                      : 'rgba(255, 255, 255, 0.04)',
                    border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                    color: UI_COLORS.cream,
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{c.title}</div>
                  <div style={{ fontSize: '11px', color: UI_COLORS.mistText, marginTop: '2px' }}>
                    {c.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Headwear */}
        <div>
          <div style={{ fontSize: '12px', color: UI_COLORS.mistText, marginBottom: '8px' }}>
            Mũ len & Phụ kiện đầu
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            {HEADWEAR_STYLES.map((h) => {
              const active = outfit.headwear === h.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => applyPatch({ headwear: h.id })}
                  className="dalat-glass-btn"
                  style={{
                    padding: '9px 12px',
                    borderRadius: '12px',
                    background: active
                      ? 'rgba(243, 195, 130, 0.2)'
                      : 'rgba(255, 255, 255, 0.04)',
                    border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                    color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                    fontSize: '12.5px',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {h.title}
                </button>
              );
            })}
          </div>
        </div>

        {/* Color Palettes */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
            gap: '14px',
          }}
        >
          <SwatchGroup
            title="Sắc màu áo khoác"
            colors={HIGHLAND_PALETTE.coats}
            selected={outfit.coatColor}
            onSelect={(coatColor) => applyPatch({ coatColor })}
          />
          <SwatchGroup
            title="Sắc màu khăn & mũ len"
            colors={HIGHLAND_PALETTE.scarves}
            selected={outfit.scarfColor}
            onSelect={(scarfColor) => applyPatch({ scarfColor })}
          />
          <SwatchGroup
            title="Màu tóc"
            colors={HIGHLAND_PALETTE.hair}
            selected={outfit.hairColor}
            onSelect={(hairColor) => applyPatch({ hairColor })}
          />
        </div>

        {/* Hiking Backpack Toggle + Save */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            paddingTop: '6px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => applyPatch({ backpack: !outfit.backpack })}
            className="dalat-glass-btn"
            style={{
              padding: '10px 15px',
              borderRadius: '12px',
              background: outfit.backpack
                ? 'rgba(243, 195, 130, 0.18)'
                : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${outfit.backpack ? UI_COLORS.warmAmber : UI_COLORS.border}`,
              color: UI_COLORS.cream,
              fontSize: '12.5px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Backpack size={15} style={{ color: UI_COLORS.warmAmber }} />
            <span>Balo vải bố & Thảm cuộn dã ngoại: {outfit.backpack ? 'Đang đeo' : 'Đã cất'}</span>
          </button>

          <button
            type="button"
            onClick={handleSaveAndClose}
            className="dalat-glass-btn"
            style={{
              padding: '10px 20px',
              borderRadius: '12px',
              background:
                'linear-gradient(135deg, rgba(226, 152, 86, 0.92), rgba(196, 112, 68, 0.92))',
              border: '1px solid rgba(255, 226, 182, 0.5)',
              color: '#171D2A',
              fontFamily: UI_FONTS.sans,
              fontSize: '13px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Check size={15} />
            <span>Hoàn tất</span>
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function SwatchGroup(props: {
  title: string;
  colors: readonly string[];
  selected: string;
  onSelect: (hex: string) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: '11.5px', color: UI_COLORS.mistText, marginBottom: '7px' }}>
        {props.title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
        {props.colors.map((hex) => {
          const active = props.selected === hex;
          return (
            <button
              key={hex}
              type="button"
              onClick={() => props.onSelect(hex)}
              style={{
                width: '25px',
                height: '25px',
                borderRadius: '50%',
                background: hex,
                cursor: 'pointer',
                border: active ? '2.5px solid #FFF8EB' : '1px solid rgba(255,255,255,0.24)',
                boxShadow: active ? '0 0 0 2px rgba(243,195,130,0.6)' : 'none',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
