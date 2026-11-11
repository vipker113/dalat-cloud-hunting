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
  renderBagStudioThumbnail,
  renderCoatStudioThumbnail,
  renderEyewearStudioThumbnail,
  renderHeadwearStudioThumbnail,
  renderHeldPropStudioThumbnail,
  renderNeckwearStudioThumbnail,
} from './StudioThumbnailRenderer';
import { UI_COLORS } from './uiStyles';

function useStudioThumb(
  producer: () => { key: string; promise: Promise<string> },
  deps: React.DependencyList
): string {
  const initialKey = producer().key;
  const [url, setUrl] = useState<string>(() => getCachedStudioThumbnail(initialKey) || '');

  useEffect(() => {
    let alive = true;
    const { key, promise } = producer();
    const cached = getCachedStudioThumbnail(key);
    if (cached) {
      setUrl(cached);
      return;
    }
    void promise.then((res) => {
      if (alive && res) setUrl(res);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return url;
}

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
  const src = useStudioThumb(
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
  const src = useStudioThumb(
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
  const src = useStudioThumb(
    () => renderNeckwearStudioThumbnail(neckwearId, scarfColor),
    [neckwearId, scarfColor]
  );
  if (neckwearId === 'none') return <MinimalNoneBadge size={size} />;
  return <StudioImageFrame src={src} size={size} />;
}

export function EyewearThumbnail(props: { eyewearId: EyewearId; size?: number }) {
  const { eyewearId, size = 54 } = props;
  const src = useStudioThumb(() => renderEyewearStudioThumbnail(eyewearId), [eyewearId]);
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
  const src = useStudioThumb(
    () => renderBagStudioThumbnail(bagId, coatColor, scarfColor),
    [bagId, coatColor, scarfColor]
  );
  if (bagId === 'none') return <MinimalNoneBadge size={size} />;
  return <StudioImageFrame src={src} size={size} />;
}

export function HeldPropThumbnail(props: { itemId: HeldItemId; size?: number }) {
  const { itemId, size = 50 } = props;
  const src = useStudioThumb(() => renderHeldPropStudioThumbnail(itemId), [itemId]);
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

/**
 * Reusable visual item card: renders the 1:1 3D WebGL studio thumbnail on top
 * and the Vietnamese item name (plus optional micro-subtitle) underneath.
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
      title={title || label}
      onClick={onClick}
      className="dalat-glass-btn"
      style={{
        padding: compact ? '6px 5px 7px' : '7px 6px 8px',
        borderRadius: compact ? '12px' : '14px',
        background: active
          ? 'linear-gradient(180deg, rgba(243, 195, 130, 0.25) 0%, rgba(243, 195, 130, 0.11) 100%)'
          : 'rgba(255, 255, 255, 0.04)',
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
          fontSize: compact ? '10.5px' : '11.5px',
          fontWeight: active ? 600 : 500,
          lineHeight: 1.2,
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
            fontSize: '9.5px',
            lineHeight: 1.15,
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
