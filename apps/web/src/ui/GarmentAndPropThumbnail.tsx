import React, { useEffect, useState } from 'react';
import {
  AvatarGender,
  BAG_CATALOG,
  BagStyleId,
  CoatStyleId,
  EYEWEAR_CATALOG,
  EyewearId,
  getCoatsForGender,
  HEADWEAR_CATALOG,
  HeadwearId,
  HELD_PROP_CATALOG,
  HeldItemId,
  HIGHLAND_PALETTE,
  NECKWEAR_CATALOG,
  NeckwearId,
  PlayerOutfit,
} from '@dalat/protocol';
import {
  getCachedStudioThumbnail,
  prewarmHudPropThumbnails,
  renderBagStudioThumbnail,
  renderCoatStudioThumbnail,
  renderEyewearStudioThumbnail,
  renderHeadwearStudioThumbnail,
  renderHeldPropStudioThumbnail,
  renderNeckwearStudioThumbnail,
} from './StudioThumbnailRenderer';
import { UI_COLORS } from './uiStyles';

function useStudioThumb(
  key: string,
  producer: () => { key: string; promise: Promise<string> },
  deps: React.DependencyList
): string {
  const [url, setUrl] = useState<string>(() => getCachedStudioThumbnail(key) || '');

  useEffect(() => {
    let alive = true;
    const cached = getCachedStudioThumbnail(key);
    if (cached) {
      setUrl(cached);
      return;
    }
    const { promise } = producer();
    void promise.then((res) => {
      if (alive && res) setUrl(res);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return getCachedStudioThumbnail(key) || url;
}

export { prewarmHudPropThumbnails };

function StudioImageFrame(props: { src: string; size: number; alt?: string }) {
  const { src, size, alt = '' } = props;
  if (!src) {
    return (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: Math.round(size * 0.44),
            height: Math.round(size * 0.44),
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(243,195,130,0.28), rgba(255,255,255,0.03))',
          }}
        />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        objectFit: 'contain',
        display: 'block',
        flexShrink: 0,
        filter: 'drop-shadow(0 4px 7px rgba(0, 0, 0, 0.48))',
        pointerEvents: 'none',
      }}
    />
  );
}

function MinimalNoneBadge(props: { size: number; label?: string }) {
  const { size } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <circle
        cx="32"
        cy="32"
        r="16"
        fill="rgba(243, 195, 130, 0.08)"
        stroke="rgba(243, 195, 130, 0.36)"
        strokeWidth="1.4"
        strokeDasharray="3.2 3.2"
      />
      <path
        d="M32 21 L33.8 26.8 L39.5 28.5 L33.8 30.2 L32 36 L30.2 30.2 L24.5 28.5 L30.2 26.8 Z"
        fill="#F3C382"
        opacity="0.9"
      />
      <circle cx="23" cy="39" r="1.8" fill="#FDE68A" opacity="0.75" />
      <circle cx="40.5" cy="39.5" r="1.5" fill="#FDE68A" opacity="0.65" />
    </svg>
  );
}

export function CoatThumbnail(props: {
  styleId: CoatStyleId;
  coatColor: string;
  scarfColor: string;
  size?: number;
}) {
  const { styleId, coatColor, scarfColor, size = 58 } = props;
  const key = `coat|${styleId}|${coatColor}|${scarfColor}`;
  const src = useStudioThumb(
    key,
    () => renderCoatStudioThumbnail(styleId, coatColor, scarfColor),
    [styleId, coatColor, scarfColor]
  );
  return <StudioImageFrame src={src} size={size} />;
}

export function HeadwearThumbnail(props: {
  headwearId: HeadwearId;
  coatColor?: string;
  scarfColor: string;
  hairColor: string;
  gender?: AvatarGender;
  size?: number;
}) {
  const {
    headwearId,
    coatColor = '#C87D55',
    scarfColor,
    hairColor,
    gender = 'female',
    size = 54,
  } = props;
  const effId: HeadwearId = headwearId === 'scarf_only' ? 'none' : headwearId;
  const rigKey = effId === 'none' || effId === 'beanie' || effId === 'beret' ? gender : 'any';
  const key = `head|${effId}|${rigKey}|${coatColor}|${scarfColor}|${hairColor}`;
  const src = useStudioThumb(
    key,
    () => renderHeadwearStudioThumbnail(headwearId, coatColor, scarfColor, hairColor, gender),
    [headwearId, coatColor, scarfColor, hairColor, gender]
  );
  return <StudioImageFrame src={src} size={size} />;
}

export function NeckwearThumbnail(props: {
  neckwearId: NeckwearId;
  scarfColor: string;
  size?: number;
}) {
  const { neckwearId, scarfColor, size = 54 } = props;
  const key = neckwearId === 'none' ? 'neck|none' : `neck|${neckwearId}|${scarfColor}`;
  const src = useStudioThumb(
    key,
    () => renderNeckwearStudioThumbnail(neckwearId, scarfColor),
    [neckwearId, scarfColor]
  );
  if (neckwearId === 'none') return <MinimalNoneBadge size={size} />;
  return <StudioImageFrame src={src} size={size} />;
}

export function EyewearThumbnail(props: { eyewearId: EyewearId; size?: number }) {
  const { eyewearId, size = 54 } = props;
  const key = eyewearId === 'none' ? 'eye|none' : `eye|${eyewearId}`;
  const src = useStudioThumb(key, () => renderEyewearStudioThumbnail(eyewearId), [eyewearId]);
  if (eyewearId === 'none') return <MinimalNoneBadge size={size} />;
  return <StudioImageFrame src={src} size={size} />;
}

export function BagThumbnail(props: {
  bagId: BagStyleId;
  coatColor?: string;
  scarfColor?: string;
  size?: number;
}) {
  const { bagId, coatColor = '#C87D55', scarfColor = '#E8D5B7', size = 54 } = props;
  const key = bagId === 'none' ? 'bag|none' : `bag|${bagId}|${coatColor}|${scarfColor}`;
  const src = useStudioThumb(
    key,
    () => renderBagStudioThumbnail(bagId, coatColor, scarfColor),
    [bagId, coatColor, scarfColor]
  );
  if (bagId === 'none') return <MinimalNoneBadge size={size} />;
  return <StudioImageFrame src={src} size={size} />;
}

export function HeldPropThumbnail(props: { itemId: HeldItemId; size?: number }) {
  const { itemId, size = 50 } = props;
  const key = itemId === 'none' ? 'prop|none' : `prop|${itemId}`;
  const src = useStudioThumb(key, () => renderHeldPropStudioThumbnail(itemId), [itemId]);
  if (itemId === 'none') return <MinimalNoneBadge size={size} />;
  return <StudioImageFrame src={src} size={size} />;
}

/**
 * Picks a harmonious random Da Lat outfit + handheld prop for the selected gender.
 */
export function pickRandomHighlandLook(preferredGender?: AvatarGender): {
  outfit: PlayerOutfit;
  heldItem: HeldItemId;
} {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const gender: AvatarGender =
    preferredGender === 'male' || preferredGender === 'female'
      ? preferredGender
      : Math.random() < 0.5
        ? 'female'
        : 'male';
  const coatStyle = pick(getCoatsForGender(gender)).id;
  const coatColor = pick(HIGHLAND_PALETTE.coats);
  const scarfColor = pick(HIGHLAND_PALETTE.scarves);
  const hairColor = pick(HIGHLAND_PALETTE.hair);
  const headwear = pick(HEADWEAR_CATALOG).id;
  const neckwear = pick(NECKWEAR_CATALOG).id;
  const eyewear = pick(EYEWEAR_CATALOG).id;
  const bagChoices = BAG_CATALOG.filter((b) => b.id !== 'none');
  const bagStyle = Math.random() < 0.86 ? pick(bagChoices).id : 'none';
  const propChoices = HELD_PROP_CATALOG.filter((p) => p.id !== 'none');
  const heldItem = pick(propChoices).id;

  return {
    outfit: {
      gender,
      coatStyle,
      coatColor,
      scarfColor,
      hairColor,
      headwear,
      neckwear,
      eyewear,
      bagStyle,
      backpack: bagStyle !== 'none',
    },
    heldItem,
  };
}

export interface CuratedDalatPreset {
  id: string;
  title: string;
  subtitle: string;
  outfit: PlayerOutfit;
  heldItem: HeldItemId;
}

export const CURATED_DALAT_PRESETS: Record<AvatarGender, ReadonlyArray<CuratedDalatPreset>> = {
  female: [
    {
      id: 'f-suong-som',
      title: 'Sương Sớm Mơ Sương',
      subtitle: 'Măng-tô dạ • Sữa đậu nành',
      outfit: {
        gender: 'female',
        coatStyle: 'wool_trench',
        coatColor: '#C87D55',
        scarfColor: '#E8D5B7',
        headwear: 'beanie',
        neckwear: 'knit_scarf',
        eyewear: 'none',
        bagStyle: 'trek_pack',
        hairColor: '#231B18',
        backpack: true,
      },
      heldItem: 'soy_milk',
    },
    {
      id: 'f-doi-che',
      title: 'Thơ Mộng Đồi Chè',
      subtitle: 'Choàng cừu • Hoa Tú Cầu',
      outfit: {
        gender: 'female',
        coatStyle: 'sherpa_cape',
        coatColor: '#D8CBB8',
        scarfColor: '#9E8AC4',
        headwear: 'beret',
        neckwear: 'plaid_shawl',
        eyewear: 'round_vintage',
        bagStyle: 'rattan_basket',
        hairColor: '#4A3326',
        backpack: true,
      },
      heldItem: 'hydrangea_bouquet',
    },
    {
      id: 'f-da-quy',
      title: 'Nắng Sớm Dã Quỳ',
      subtitle: 'Gile cổ nơ • Máy ảnh 35mm',
      outfit: {
        gender: 'female',
        coatStyle: 'cardigan_vest',
        coatColor: '#D9A441',
        scarfColor: '#F2E9E4',
        headwear: 'flower_crown',
        neckwear: 'camera_strap',
        eyewear: 'sun_amber',
        bagStyle: 'canvas_tote',
        hairColor: '#6E4730',
        backpack: true,
      },
      heldItem: 'film_camera',
    },
    {
      id: 'f-du-ca',
      title: 'Đêm Thông Du Ca',
      subtitle: 'Poncho thổ cẩm • Đèn bão',
      outfit: {
        gender: 'female',
        coatStyle: 'highland_poncho',
        coatColor: '#4A6B5D',
        scarfColor: '#C94A38',
        headwear: 'cat_beanie',
        neckwear: 'knit_scarf',
        eyewear: 'blush_cheeks',
        bagStyle: 'guitar_case',
        hairColor: '#2C3545',
        backpack: true,
      },
      heldItem: 'lantern',
    },
  ],
  male: [
    {
      id: 'm-san-may',
      title: 'Săn Mây Cầu Gỗ',
      subtitle: 'Khoác gió • Phin cà phê',
      outfit: {
        gender: 'male',
        coatStyle: 'puffer_vest',
        coatColor: '#4A6B5D',
        scarfColor: '#E8D5B7',
        headwear: 'beanie',
        neckwear: 'knit_scarf',
        eyewear: 'none',
        bagStyle: 'trek_pack',
        hairColor: '#231B18',
        backpack: true,
      },
      heldItem: 'phin_coffee',
    },
    {
      id: 'm-nhiep-anh',
      title: 'Nhiếp Ảnh Phố Núi',
      subtitle: 'Măng-tô Tweed • Máy 35mm',
      outfit: {
        gender: 'male',
        coatStyle: 'tweed_overcoat',
        coatColor: '#7C6A56',
        scarfColor: '#E09F3E',
        headwear: 'fedora_wool',
        neckwear: 'camera_strap',
        eyewear: 'round_vintage',
        bagStyle: 'leather_satchel',
        hairColor: '#4A3326',
        backpack: true,
      },
      heldItem: 'film_camera',
    },
    {
      id: 'm-du-muc',
      title: 'Du Ca Thông Cô Đơn',
      subtitle: 'Poncho nam • Đàn Guitar',
      outfit: {
        gender: 'male',
        coatStyle: 'vintage_poncho',
        coatColor: '#3B526B',
        scarfColor: '#C94A38',
        headwear: 'bucket_hat',
        neckwear: 'bandana',
        eyewear: 'sun_amber',
        bagStyle: 'guitar_case',
        hairColor: '#2C3545',
        backpack: true,
      },
      heldItem: 'guitar',
    },
    {
      id: 'm-suong-dem',
      title: 'Lửa Trại Sương Đêm',
      subtitle: 'Parka khuy sừng • Đèn bão',
      outfit: {
        gender: 'male',
        coatStyle: 'duffle_parka',
        coatColor: '#C87D55',
        scarfColor: '#355849',
        headwear: 'beret',
        neckwear: 'plaid_shawl',
        eyewear: 'retro_tortoise',
        bagStyle: 'trek_pack',
        hairColor: '#6E4730',
        backpack: true,
      },
      heldItem: 'lantern',
    },
  ],
};

function isLightHex(hex: string): boolean {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return false;
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return 0.299 * r + 0.587 * g + 0.114 * b > 155;
}

/**
 * Accessible color swatch button with generous touch hit area (>=36px desktop / >=42px touch)
 * and a high-contrast central checkmark icon so selection never relies on color alone.
 */
export function ColorSwatchButton(props: {
  hex: string;
  selected: boolean;
  onClick: () => void;
  label?: string;
  touchMode?: boolean;
}) {
  const { hex, selected, onClick, label, touchMode = false } = props;
  const light = isLightHex(hex);
  const hitSize = touchMode ? 44 : 36;
  const circleSize = touchMode ? 26 : 24;

  return (
    <button
      type="button"
      aria-label={label || `Màu ${hex}`}
      aria-pressed={selected}
      title={label || hex}
      onClick={onClick}
      className="dalat-glass-btn"
      style={{
        width: `${hitSize}px`,
        height: `${hitSize}px`,
        minWidth: `${hitSize}px`,
        minHeight: `${hitSize}px`,
        padding: 0,
        boxSizing: 'border-box',
        borderRadius: '11px',
        background: selected ? 'rgba(243, 195, 130, 0.18)' : 'rgba(255, 255, 255, 0.03)',
        border: selected
          ? `1.5px solid ${UI_COLORS.warmAmber}`
          : '1px solid rgba(255, 232, 204, 0.14)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: `${circleSize}px`,
          height: `${circleSize}px`,
          borderRadius: '50%',
          background: hex,
          border: selected ? '2px solid #FFF8EE' : '1.5px solid rgba(255, 255, 255, 0.28)',
          boxShadow: selected
            ? '0 0 0 2px rgba(15, 22, 34, 0.75), 0 3px 8px rgba(0,0,0,0.45)'
            : '0 2px 5px rgba(0,0,0,0.32)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected && (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3.5 8.4L6.6 11.4L12.6 4.8"
              stroke={light ? '#18202C' : '#FFFDF9'}
              strokeWidth="2.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
    </button>
  );
}

/**
 * Reusable visual item card: renders the 1:1 3D WebGL studio thumbnail on top
 * and the Vietnamese item name (plus optional subtitle) underneath (>=12px WCAG legible).
 */
export function VisualChoiceCard(props: {
  active: boolean;
  label: string;
  subtitle?: string;
  onClick: () => void;
  thumbnail: React.ReactNode;
  thumbHeight?: number;
  compact?: boolean;
  title?: string;
}) {
  const {
    active,
    label,
    subtitle,
    onClick,
    thumbnail,
    thumbHeight = 58,
    compact = false,
    title,
  } = props;

  return (
    <button
      type="button"
      aria-pressed={active}
      title={title || label}
      onClick={onClick}
      className="dalat-glass-btn"
      style={{
        padding: compact ? '6px 5px 7px' : '7px 6px 8px',
        borderRadius: compact ? '12px' : '14px',
        background: active
          ? 'linear-gradient(180deg, rgba(243, 195, 130, 0.25) 0%, rgba(243, 195, 130, 0.11) 100%)'
          : 'rgba(255, 255, 255, 0.045)',
        border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
        boxShadow: active ? '0 4px 14px rgba(243, 195, 130, 0.18)' : 'none',
        color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: compact ? '4px' : '5px',
        textAlign: 'center',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          height: `${thumbHeight}px`,
          borderRadius: '10px',
          background: active
            ? 'radial-gradient(circle at 50% 42%, rgba(243, 195, 130, 0.24), rgba(10, 15, 25, 0.52))'
            : 'radial-gradient(circle at 50% 42%, rgba(255, 255, 255, 0.085), rgba(10, 15, 25, 0.48))',
          border: `1px solid ${active ? 'rgba(243, 195, 130, 0.34)' : 'rgba(255, 255, 255, 0.06)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {thumbnail}
      </div>

      <span
        style={{
          fontSize: '12px',
          fontWeight: active ? 600 : 500,
          lineHeight: 1.25,
          color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
          display: 'block',
          width: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>

      {subtitle && (
        <span
          style={{
            fontSize: '12px',
            lineHeight: 1.2,
            color: UI_COLORS.mistText,
            display: 'block',
            width: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {subtitle}
        </span>
      )}
    </button>
  );
}
