import {
  AtmosphereSnapshot,
  gameYToASL,
  LANDMARK_LIST,
  PolaroidEntry,
  WEATHER_LABELS,
} from '@dalat/protocol';

export type PhotoFilterId = 'natural' | 'kodak_dawn' | 'fuji_pine' | 'dreamy_mist';

export const PHOTO_FILTER_LABELS: Record<PhotoFilterId, { name: string; subtitle: string }> = {
  kodak_dawn: { name: 'Kodak Bình Minh', subtitle: 'Ấm áp sắc vàng cam rạng đông' },
  fuji_pine: { name: 'Fuji Thông Trầm', subtitle: 'Xanh rừng thông cổ điển & tương phản sâu' },
  dreamy_mist: { name: 'Sương Mơ', subtitle: 'Mờ ảo ánh sương mai & quầng sáng dịu' },
  natural: { name: 'Nguyên Bản', subtitle: 'Ánh sáng tự nhiên trong trẻo Cầu Đất' },
};

let cachedGrainCanvas: HTMLCanvasElement | null = null;
let lastGradedFrameCanvas: HTMLCanvasElement | null = null;
let lastSnapshotMeta: {
  landmarkId: string;
  landmarkName: string;
  shortSpotName: string;
  altitudeASL: number;
  timeLabel: string;
  weather: AtmosphereSnapshot['weather'];
  weatherShort: string;
  authorName: string;
  focalMm: number;
  filter: PhotoFilterId;
} | null = null;

function getGrainTile(): HTMLCanvasElement {
  if (cachedGrainCanvas) return cachedGrainCanvas;
  const tile = document.createElement('canvas');
  tile.width = 128;
  tile.height = 128;
  const ctx = tile.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(128, 128);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = Math.floor(Math.random() * 255);
      d[i] = n;
      d[i + 1] = n;
      d[i + 2] = n;
      d[i + 3] = 20;
    }
    ctx.putImageData(img, 0, 0);
  }
  cachedGrainCanvas = tile;
  return tile;
}

function findNearestLandmark(x: number, z: number): { id: string; name: string; shortName: string } {
  let nearest = LANDMARK_LIST[0];
  let minDist = Infinity;
  for (const lm of LANDMARK_LIST) {
    const d = Math.hypot(x - lm.position[0], z - lm.position[2]);
    if (d < minDist) {
      minDist = d;
      nearest = lm;
    }
  }
  const shortMap: Record<string, string> = {
    'quan-mo-suong': 'Tiệm Mơ Sương',
    'cau-go-san-may': 'Đồi Cầu Đất',
    'cay-thong-co-don': 'Thông Cô Đơn',
    'dai-ngam-den': 'Thung Lũng Đèn',
    'gac-che-1927': 'Gác Chè 1927',
  };
  return {
    id: nearest.id,
    name: nearest.name,
    shortName: shortMap[nearest.id] || 'Đồi Cầu Đất',
  };
}

function renderPolaroidCardFromPhoto(
  photoCanvas: HTMLCanvasElement,
  caption: string,
  meta: NonNullable<typeof lastSnapshotMeta>
): string {
  const cardW = 1040;
  const cardH = 1260;
  const padX = 56;
  const padTop = 56;
  const photoW = cardW - padX * 2; // 928
  const photoH = 928;

  const out = document.createElement('canvas');
  out.width = cardW;
  out.height = cardH;
  const ctx = out.getContext('2d');
  if (!ctx) return '';

  // 1. Warm instant-film ivory paper stock with subtle paper gradient
  const paperGrad = ctx.createLinearGradient(0, 0, cardW, cardH);
  paperGrad.addColorStop(0, '#FCF8F0');
  paperGrad.addColorStop(0.65, '#F7F1E5');
  paperGrad.addColorStop(1, '#EFE6D5');
  ctx.fillStyle = paperGrad;
  ctx.fillRect(0, 0, cardW, cardH);

  // Subtle paper fiber texture via grain tile
  const grain = getGrainTile();
  const pat = ctx.createPattern(grain, 'repeat');
  if (pat) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, cardW, cardH);
    ctx.restore();
  }

  // 2. Inner recessed frame border
  ctx.fillStyle = '#1B2230';
  ctx.fillRect(padX - 2, padTop - 2, photoW + 4, photoH + 4);
  ctx.drawImage(photoCanvas, padX, padTop, photoW, photoH);

  // Subtle inner emulsion shadow
  ctx.strokeStyle = 'rgba(18, 22, 30, 0.22)';
  ctx.lineWidth = 3;
  ctx.strokeRect(padX + 1.5, padTop + 1.5, photoW - 3, photoH - 3);

  // Subtle orange analog date burn in bottom-right corner of the photo
  ctx.save();
  ctx.font = '500 21px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255, 162, 74, 0.82)';
  ctx.shadowColor = 'rgba(255, 110, 30, 0.55)';
  ctx.shadowBlur = 6;
  ctx.fillText(`'26  ${meta.timeLabel}`, padX + photoW - 22, padTop + photoH - 20);
  ctx.restore();

  // 3. Handwritten-style poetic caption on the Polaroid lower chin
  const displayCaption =
    caption.trim() || `Chạm mây sương sớm tại ${meta.shortSpotName}...`;

  ctx.save();
  ctx.fillStyle = '#252B36';
  ctx.font = 'italic 400 34px "Fraunces", Georgia, serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const maxTextW = photoW - 10;
  let trimmedCaption = displayCaption;
  while (trimmedCaption.length > 8 && ctx.measureText(trimmedCaption).width > maxTextW) {
    trimmedCaption = `${trimmedCaption.slice(0, -2)}…`;
  }
  ctx.fillText(trimmedCaption, padX + 4, padTop + photoH + 38);

  // 4. Crisp Da Lat Highland telemetry stamp line
  const stampLine = `${meta.timeLabel} • ${meta.shortSpotName} ${meta.altitudeASL.toLocaleString('en-US')}m • ${meta.weatherShort}`;
  ctx.fillStyle = '#6A655C';
  ctx.font = '400 20px "Be Vietnam Pro", sans-serif';
  ctx.fillText(stampLine, padX + 4, padTop + photoH + 92);

  // Author & Film Stock signature right-aligned
  const filmLabel = PHOTO_FILTER_LABELS[meta.filter].name;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8A7E6E';
  ctx.font = '500 18px "JetBrains Mono", monospace';
  ctx.fillText(
    `${meta.focalMm}mm • ${filmLabel} • 📷 ${meta.authorName}`,
    padX + photoW - 4,
    padTop + photoH + 138
  );
  ctx.restore();

  // Export crisp WebP with PNG fallback
  const webp = out.toDataURL('image/webp', 0.9);
  if (webp.startsWith('data:image/webp')) return webp;
  return out.toDataURL('image/png');
}

/**
 * Captures the WebGL canvas immediately post-render and composites a graded 35mm Da Lat Polaroid.
 */
export function captureAndComposePolaroid(params: {
  sourceCanvas: HTMLCanvasElement;
  filter: PhotoFilterId;
  focalMm: number;
  caption: string;
  authorName: string;
  playerX: number;
  playerY: number;
  playerZ: number;
  atmosphere: AtmosphereSnapshot;
}): PolaroidEntry {
  const { sourceCanvas, filter, focalMm, caption, authorName, playerX, playerY, playerZ, atmosphere } = params;

  const size = 928;
  const photoCanvas = document.createElement('canvas');
  photoCanvas.width = size;
  photoCanvas.height = size;
  const ctx = photoCanvas.getContext('2d');

  if (ctx) {
    // Center-crop square 1:1 Polaroid frame from WebGL viewport
    const sw = sourceCanvas.width || 1;
    const sh = sourceCanvas.height || 1;
    const crop = Math.min(sw, sh);
    const sx = Math.floor((sw - crop) * 0.5);
    const sy = Math.floor((sh - crop) * 0.5);

    // Apply base analog film curve via CSS canvas filter where supported
    if (filter === 'kodak_dawn') {
      ctx.filter = 'contrast(1.06) saturate(1.18) sepia(0.14) brightness(1.03)';
    } else if (filter === 'fuji_pine') {
      ctx.filter = 'contrast(1.12) saturate(1.08) hue-rotate(-5deg) brightness(0.99)';
    } else if (filter === 'dreamy_mist') {
      ctx.filter = 'contrast(0.94) saturate(0.95) brightness(1.06)';
    } else {
      ctx.filter = 'contrast(1.03) saturate(1.04)';
    }

    ctx.drawImage(sourceCanvas, sx, sy, crop, crop, 0, 0, size, size);
    ctx.filter = 'none';

    // Film-specific split-toning & halation pass
    if (filter === 'kodak_dawn') {
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      const warmGrad = ctx.createLinearGradient(0, 0, 0, size);
      warmGrad.addColorStop(0, 'rgba(255, 186, 118, 0.36)');
      warmGrad.addColorStop(0.6, 'rgba(255, 214, 165, 0.16)');
      warmGrad.addColorStop(1, 'rgba(62, 42, 58, 0.24)');
      ctx.fillStyle = warmGrad;
      ctx.fillRect(0, 0, size, size);
      ctx.restore();
    } else if (filter === 'fuji_pine') {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = 'rgba(34, 88, 78, 0.18)';
      ctx.fillRect(0, 0, size, size);
      ctx.restore();
    } else if (filter === 'dreamy_mist') {
      // Soft dreamy bloom pass!
      const bloom = document.createElement('canvas');
      bloom.width = 232;
      bloom.height = 232;
      const bctx = bloom.getContext('2d');
      if (bctx) {
        bctx.filter = 'blur(8px) brightness(1.15)';
        bctx.drawImage(photoCanvas, 0, 0, 232, 232);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.28;
        ctx.drawImage(bloom, 0, 0, size, size);
        ctx.restore();
      }
    }

    // Subtle 35mm optical lens vignette
    const vig = ctx.createRadialGradient(
      size * 0.5,
      size * 0.5,
      size * 0.32,
      size * 0.5,
      size * 0.5,
      size * 0.74
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(10, 14, 24, 0.42)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, size, size);

    // Fine 35mm film grain overlay
    const pat = ctx.createPattern(getGrainTile(), 'repeat');
    if (pat) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, size, size);
      ctx.restore();
    }
  }

  const lm = findNearestLandmark(playerX, playerZ);
  const altitudeASL = gameYToASL(playerY);
  const weatherFull = WEATHER_LABELS[atmosphere.weather] || atmosphere.weatherLabel;
  const weatherShort = weatherFull.replace(' Bình Minh', '');

  lastGradedFrameCanvas = photoCanvas;
  lastSnapshotMeta = {
    landmarkId: lm.id,
    landmarkName: lm.name,
    shortSpotName: lm.shortName,
    altitudeASL,
    timeLabel: atmosphere.timeLabel,
    weather: atmosphere.weather,
    weatherShort,
    authorName,
    focalMm,
    filter,
  };

  const imageDataUrl = renderPolaroidCardFromPhoto(photoCanvas, caption, lastSnapshotMeta);

  return {
    id: `local-pol-${Date.now()}`,
    authorName,
    caption: caption.trim() || `Chạm mây sương sớm tại ${lm.shortName}...`,
    landmarkId: lm.id,
    landmarkName: lm.name,
    weatherId: atmosphere.weather,
    gameTimeLabel: atmosphere.timeLabel,
    altitudeASL,
    imageDataUrl,
    likes: 0,
    createdAt: Date.now(),
  };
}

/**
 * Re-renders the Polaroid caption cleanly on the cached high-res photo frame without re-shooting WebGL.
 */
export function updatePolaroidCaption(entry: PolaroidEntry, nextCaption: string): PolaroidEntry {
  if (!lastGradedFrameCanvas || !lastSnapshotMeta) {
    return { ...entry, caption: nextCaption };
  }
  const imageDataUrl = renderPolaroidCardFromPhoto(lastGradedFrameCanvas, nextCaption, lastSnapshotMeta);
  return {
    ...entry,
    caption: nextCaption,
    imageDataUrl,
  };
}
