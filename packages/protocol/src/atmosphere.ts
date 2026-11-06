import { WeatherStateId, WORLD_CONSTANTS } from './types';

export interface AtmosphereSnapshot {
  /** In-game 24h decimal hour [0..24) */
  gameHour: number;
  /** Formatted HH:MM AM/PM */
  timeLabel: string;
  /** Phase label in Vietnamese */
  phaseTitle: string;
  /** Active weather state */
  weather: WeatherStateId;
  weatherLabel: string;
  /** Sun elevation in radians (-PI/2 .. +PI/2) */
  sunElevationRad: number;
  /** Sun azimuth in radians (East = 0, slightly ESE ~ 0.18 rad like Da Lat autumn) */
  sunAzimuthRad: number;
  /** Normalized sun direction vector [x, y, z] where +X is East */
  sunDirection: [number, number, number];
  /** Cloud sea bottom & top in normalized game Y meters */
  cloudBottomY: number;
  cloudTopY: number;
  cloudDensity: number;
  /** 0..1 intensity of 2,700K Thai Phien greenhouse night-break lights under the cloud sea */
  greenhouseGlow: number;
  /** Ambient highland temperature in Celsius */
  temperatureC: number;
  /** Wind speed factor 0.2 .. 1.8 */
  windStrength: number;
  /** Rain drizzle factor 0..1 */
  drizzleIntensity: number;
  /** True when within 90 seconds before sunrise or during peak golden sunrise */
  isSunriseWindow: boolean;
  /** Sky & fog palette colors (hex) */
  skyZenithHex: string;
  skyHorizonHex: string;
  cloudLitHex: string;
  cloudShadowHex: string;
  fogHex: string;
  sunLightHex: string;
  sunIntensity: number;
  ambientIntensity: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function lerpHex(hexA: string, hexB: string, t: number): string {
  const u = clamp01(t);
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(lerp(ar, br, u));
  const g = Math.round(lerp(ag, bg, u));
  const bl = Math.round(lerp(ab, bb, u));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/**
 * Non-linear mapping from 30-minute real-clock progress u in [0, 1) (anchored at :00 and :30)
 * to 24-hour Da Lat time so that 04:30 -> 06:45 Golden Cloud-Hunting occupies ~10 full real minutes!
 */
export function cycleProgressToGameHour(uRaw: number): number {
  const u = ((uRaw % 1) + 1) % 1;
  // Piecewise keyframes: [realProgress, gameHour]
  // :00 (u=0.00) -> 04:20 AM (Pre-dawn Thung Lung Den)
  // :03 (u=0.10) -> 05:05 AM (First blush on horizon)
  // :12 (u=0.40) -> 06:35 AM (9 full minutes of Golden Sunrise!)
  // :16 (u=0.53) -> 07:50 AM (Morning Mist Boil-Up)
  // :22 (u=0.73) -> 15:30 PM (Clear Highland Afternoon)
  // :26 (u=0.87) -> 18:20 PM (Purple Pine Dusk & Cafe Lights)
  // :30 (u=1.00) -> 28:20 (wraps seamlessly to 04:20 AM!)
  const keys: Array<[number, number]> = [
    [0.0, 4.33],
    [0.1, 5.08],
    [0.4, 6.58],
    [0.53, 7.83],
    [0.73, 15.5],
    [0.87, 18.33],
    [1.0, 28.33],
  ];
  for (let i = 0; i < keys.length - 1; i++) {
    const [u0, h0] = keys[i];
    const [u1, h1] = keys[i + 1];
    if (u >= u0 && u <= u1) {
      const t = (u - u0) / (u1 - u0);
      return (lerp(h0, h1, t) % 24 + 24) % 24;
    }
  }
  return 5.5;
}

export const WEATHER_LABELS: Record<WeatherStateId, string> = {
  golden_cloud_sea: 'Biển Mây Vàng Bình Minh',
  morning_mist_boil: 'Sương Sôi Lưng Đồi',
  clear_highland_sun: 'Nắng Trong Cao Nguyên',
  cloudy_breeze: 'Gió Đồi & Bóng Mây Trôi',
  deep_evening_fog: 'Mù Sương Chiều Đà Lạt',
  light_drizzle: 'Mưa Phùn Se Lạnh',
};

export function formatGameHour(gameHour: number): string {
  const totalMin = Math.floor(((gameHour % 24) + 24) % 24 * 60);
  const hh24 = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  const suffix = hh24 >= 12 ? 'PM' : 'AM';
  const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return `${String(hh12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${suffix}`;
}

export function computeWorldAtmosphere(
  epochMs: number,
  overrideGameHour?: number | null,
  overrideWeather?: WeatherStateId | null
): AtmosphereSnapshot {
  const cycleIndex = Math.floor(epochMs / WORLD_CONSTANTS.CYCLE_DURATION_MS);
  const cycleProgress = (epochMs % WORLD_CONSTANTS.CYCLE_DURATION_MS) / WORLD_CONSTANTS.CYCLE_DURATION_MS;
  const gameHour =
    overrideGameHour !== undefined && overrideGameHour !== null
      ? ((overrideGameHour % 24) + 24) % 24
      : cycleProgressToGameHour(cycleProgress);

  // Deterministic weather schedule seeded by cycleIndex + time of day
  let weather: WeatherStateId;
  if (overrideWeather) {
    weather = overrideWeather;
  } else if (gameHour >= 4.5 && gameHour < 6.45) {
    weather = 'golden_cloud_sea';
  } else if (gameHour >= 6.45 && gameHour < 7.85) {
    weather = 'morning_mist_boil';
  } else if (gameHour >= 7.85 && gameHour < 15.8) {
    weather = cycleIndex % 3 === 1 ? 'cloudy_breeze' : 'clear_highland_sun';
  } else if (gameHour >= 15.8 && gameHour < 18.8) {
    weather = cycleIndex % 4 === 2 ? 'light_drizzle' : 'deep_evening_fog';
  } else {
    weather = 'golden_cloud_sea';
  }

  // Sun path: rises at 05:20 in the East (+X, slight South +Z = azimuth 12 deg)
  const dayAngle = ((gameHour - 5.33) / 12.5) * Math.PI;
  const sunElevationRad = Math.sin(dayAngle) * 1.18; // Peaks ~67 deg, negative at night
  const sunAzimuthRad = lerp(0.22, -0.18, clamp01((gameHour - 5.0) / 13.0));
  const cosEl = Math.cos(Math.max(-0.35, sunElevationRad));
  const sx = cosEl * Math.cos(sunAzimuthRad) * (gameHour > 18.5 || gameHour < 4.2 ? -0.4 : 1.0);
  const sy = Math.sin(Math.max(-0.28, sunElevationRad));
  const sz = cosEl * Math.sin(sunAzimuthRad);
  const len = Math.hypot(sx, sy, sz) || 1;
  const sunDirection: [number, number, number] = [sx / len, sy / len, sz / len];

  // Keyframe palette interpolation across Da Lat's day (luminous cobalt twilight at pre-dawn!)
  let skyZenithHex = '#1F3666';
  let skyHorizonHex = '#4F6BA3';
  let cloudLitHex = '#9EB4DE';
  let cloudShadowHex = '#435882';
  let fogHex = '#384E7A';
  let sunLightHex = '#A8C2F0';
  let sunIntensity = 0.95;
  let ambientIntensity = 0.88;
  let phaseTitle = 'Sương Đêm & Thung Lũng Đèn';

  if (gameHour >= 4.2 && gameHour < 5.15) {
    const t = (gameHour - 4.2) / 0.95;
    skyZenithHex = lerpHex('#16264C', '#2E4678', t);
    skyHorizonHex = lerpHex('#3E568C', '#F08A78', t * t);
    cloudLitHex = lerpHex('#586F9E', '#F7B094', t * t);
    cloudShadowHex = lerpHex('#273659', '#5B6F99', t);
    fogHex = lerpHex('#2E426B', '#70789E', t);
    sunLightHex = lerpHex('#8FAEE0', '#FFA882', t);
    sunIntensity = lerp(0.82, 1.68, t);
    ambientIntensity = lerp(0.76, 0.95, t);
    phaseTitle = t < 0.55 ? 'Chạng Vạng Thung Lũng Đèn' : 'Chân Trời Hửng Hồng';
  } else if (gameHour >= 5.15 && gameHour < 6.6) {
    const t = (gameHour - 5.15) / 1.45;
    skyZenithHex = lerpHex('#24355C', '#3E7CB8', t);
    skyHorizonHex = lerpHex('#FF8E72', '#FFD194', t);
    cloudLitHex = lerpHex('#FFB694', '#FFF6EB', t);
    cloudShadowHex = lerpHex('#566B94', '#7C98BD', t);
    fogHex = lerpHex('#7A7391', '#C9D6E8', t);
    sunLightHex = lerpHex('#FF9A62', '#FFE0A3', t);
    sunIntensity = lerp(1.55, 2.45, t);
    ambientIntensity = lerp(0.6, 0.85, t);
    phaseTitle = 'Khoảnh Khắc Vàng Săn Mây';
  } else if (gameHour >= 6.6 && gameHour < 15.6) {
    const t = clamp01((gameHour - 6.6) / 2.0);
    skyZenithHex = lerpHex('#3E7CB8', '#3B82C4', t);
    skyHorizonHex = lerpHex('#FFD194', '#B8DCFA', t);
    cloudLitHex = '#FFFFFF';
    cloudShadowHex = '#8FAAC7';
    fogHex = lerpHex('#C9D6E8', '#B8D4EE', t);
    sunLightHex = '#FFF6E0';
    sunIntensity = 2.35;
    ambientIntensity = 0.92;
    phaseTitle = gameHour < 8.0 ? 'Sương Sớm Tan Dần' : 'Nắng Cao Nguyên Trong Trẻo';
  } else if (gameHour >= 15.6 && gameHour < 18.6) {
    const t = (gameHour - 15.6) / 3.0;
    skyZenithHex = lerpHex('#3B82C4', '#26294A', t);
    skyHorizonHex = lerpHex('#B8DCFA', '#E07A5F', Math.sin(t * Math.PI));
    cloudLitHex = lerpHex('#FFFFFF', '#F29E79', t);
    cloudShadowHex = lerpHex('#8FAAC7', '#3D426B', t);
    fogHex = lerpHex('#B8D4EE', '#4E4A6E', t);
    sunLightHex = lerpHex('#FFE6B8', '#FF7F50', t);
    sunIntensity = lerp(2.1, 0.45, t);
    ambientIntensity = lerp(0.85, 0.45, t);
    phaseTitle = 'Hoàng Hôn Tím Đồi Thông';
  }

  // Weather modulations
  let cloudBottomY = 30;
  let cloudTopY = gameHour < 4.88 ? lerp(74, 108, clamp01((gameHour - 4.65) / 0.23)) : 108; // ~1,558m ASL inversion lid!
  let cloudDensity = gameHour < 4.92 || gameHour > 18.5 ? 0.56 : 0.88;
  let windStrength = 0.55;
  let drizzleIntensity = 0;

  if (weather === 'morning_mist_boil') {
    cloudTopY = 136; // Thermal boil wraps Tiệm Cà Phê Mơ Sương in soft mist!
    cloudDensity = 0.72;
  } else if (weather === 'clear_highland_sun') {
    cloudTopY = 78;
    cloudDensity = 0.36;
  } else if (weather === 'cloudy_breeze') {
    cloudTopY = 102;
    cloudDensity = 0.68;
    windStrength = 1.35;
  } else if (weather === 'deep_evening_fog') {
    cloudTopY = 142;
    cloudDensity = 0.82;
    fogHex = lerpHex(fogHex, '#5A6680', 0.45);
  } else if (weather === 'light_drizzle') {
    cloudTopY = 132;
    cloudDensity = 0.8;
    drizzleIntensity = 0.85;
    windStrength = 0.9;
    sunIntensity *= 0.65;
  }

  // 2,700K Thai Phien Chrysanthemum Greenhouse Night-Break LEDs (active 18:00 -> 05:25 AM!)
  let greenhouseGlow = 0;
  if (gameHour >= 18.0 || gameHour < 4.85) {
    greenhouseGlow = 1.0;
  } else if (gameHour >= 4.85 && gameHour < 5.55) {
    greenhouseGlow = 1.0 - (gameHour - 4.85) / 0.7;
  } else if (gameHour >= 17.3 && gameHour < 18.0) {
    greenhouseGlow = (gameHour - 17.3) / 0.7;
  }

  // Realistic Da Lat altitude temperature curve (9.5°C pre-dawn -> 19.5°C afternoon)
  const tempBase =
    gameHour >= 4 && gameHour <= 14
      ? lerp(10.0, 19.2, smoothstepLocal(4.5, 13.0, gameHour))
      : lerp(19.2, 10.5, smoothstepLocal(14.0, 23.5, gameHour < 4 ? gameHour + 20 : gameHour));
  const temperatureC = Math.round((tempBase - drizzleIntensity * 1.8) * 10) / 10;

  return {
    gameHour,
    timeLabel: formatGameHour(gameHour),
    phaseTitle,
    weather,
    weatherLabel: WEATHER_LABELS[weather],
    sunElevationRad,
    sunAzimuthRad,
    sunDirection,
    cloudBottomY,
    cloudTopY,
    cloudDensity,
    greenhouseGlow,
    temperatureC,
    windStrength,
    drizzleIntensity,
    isSunriseWindow: gameHour >= 4.95 && gameHour <= 6.35,
    skyZenithHex,
    skyHorizonHex,
    cloudLitHex,
    cloudShadowHex,
    fogHex,
    sunLightHex,
    sunIntensity,
    ambientIntensity,
  };
}

function smoothstepLocal(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

