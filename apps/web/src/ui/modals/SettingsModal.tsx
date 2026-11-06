import { Clock, Cpu, Sun, Volume2, VolumeX } from 'lucide-react';
import {
  formatGameHour,
  WEATHER_LABELS,
  WeatherStateId,
} from '@dalat/protocol';
import { QualityTier, useGameStore } from '../../store/gameStore';
import { UI_COLORS, UI_FONTS } from '../uiStyles';
import { ModalShell } from './ModalShell';

const TIME_PRESETS: Array<{ label: string; hour: number; weather: WeatherStateId }> = [
  { label: '04:35 AM • Thung Lũng Đèn Đêm', hour: 4.58, weather: 'golden_cloud_sea' },
  { label: '05:25 AM • Bình Minh Biển Mây Vàng', hour: 5.42, weather: 'golden_cloud_sea' },
  { label: '07:05 AM • Sương Sôi Lưng Đồi', hour: 7.08, weather: 'morning_mist_boil' },
  { label: '14:30 PM • Nắng Trong Đồi Chè', hour: 14.5, weather: 'clear_highland_sun' },
  { label: '16:40 PM • Mưa Phùn Se Lạnh', hour: 16.66, weather: 'light_drizzle' },
  { label: '17:50 PM • Hoàng Hôn Tím Đồi Thông', hour: 17.83, weather: 'deep_evening_fog' },
];

const QUALITY_OPTIONS: Array<{ tier: QualityTier; label: string }> = [
  { tier: 'high', label: 'Cao (Đầy đủ sương & bóng)' },
  { tier: 'medium', label: 'Trung bình (Cân bằng)' },
  { tier: 'mobile', label: 'Di động (Tiết kiệm pin)' },
];

const WEATHER_IDS = Object.keys(WEATHER_LABELS) as WeatherStateId[];

export function SettingsModal() {
  const atmosphere = useGameStore((s) => s.atmosphere);
  const overrideGameHour = useGameStore((s) => s.overrideGameHour);
  const overrideWeather = useGameStore((s) => s.overrideWeather);
  const qualityTier = useGameStore((s) => s.qualityTier);
  const autoQuality = useGameStore((s) => s.autoQuality);
  const audioEnabled = useGameStore((s) => s.audioEnabled);
  const masterVolume = useGameStore((s) => s.masterVolume);
  const perfMetrics = useGameStore((s) => s.perfMetrics);

  const setOverrideAtmosphere = useGameStore((s) => s.setOverrideAtmosphere);
  const setQualityTier = useGameStore((s) => s.setQualityTier);
  const setAudioEnabled = useGameStore((s) => s.setAudioEnabled);
  const setMasterVolume = useGameStore((s) => s.setMasterVolume);

  const isSyncedToServer = overrideGameHour === null && overrideWeather === null;
  const effectiveHour = overrideGameHour ?? atmosphere.gameHour;

  return (
    <ModalShell
      title="Cài Đặt & Đồng Hồ Khí Tượng"
      subtitle="Đồng bộ theo nhịp mặt trời thực tế toàn máy chủ (:00 / :30) hoặc xoay kim đồng hồ ngắm thử mọi sắc trời Đà Lạt"
      maxWidth="660px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* 1. Atmospheric Time & Weather Preview Dial */}
        <div
          style={{
            padding: '16px',
            borderRadius: '18px',
            background: 'rgba(243, 195, 130, 0.08)',
            border: `1px solid ${UI_COLORS.borderStrong}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={16} style={{ color: UI_COLORS.warmAmber }} />
              <span style={{ fontSize: '13.5px', fontWeight: 600 }}>
                Chế độ Thời Gian & Khí Tượng
              </span>
            </div>

            <button
              type="button"
              onClick={() => setOverrideAtmosphere(null, null)}
              className="dalat-glass-btn"
              style={{
                padding: '7px 13px',
                borderRadius: '999px',
                background: isSyncedToServer
                  ? 'linear-gradient(135deg, rgba(226, 152, 86, 0.92), rgba(196, 112, 68, 0.92))'
                  : 'rgba(255, 255, 255, 0.06)',
                border: `1px solid ${isSyncedToServer ? 'rgba(255,226,182,0.55)' : UI_COLORS.border}`,
                color: isSyncedToServer ? '#171D2A' : UI_COLORS.cream,
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              Đồng Hồ Thực Toàn Server (:00/:30)
            </button>
          </div>

          {/* Quick Golden Hour / Weather Presets */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
              gap: '7px',
            }}
          >
            {TIME_PRESETS.map((preset) => {
              const active =
                !isSyncedToServer &&
                overrideGameHour !== null &&
                Math.abs(overrideGameHour - preset.hour) < 0.15 &&
                overrideWeather === preset.weather;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setOverrideAtmosphere(preset.hour, preset.weather)}
                  className="dalat-glass-btn"
                  style={{
                    padding: '8px 10px',
                    borderRadius: '11px',
                    background: active
                      ? 'rgba(243, 195, 130, 0.24)'
                      : 'rgba(255, 255, 255, 0.04)',
                    border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                    color: UI_COLORS.cream,
                    fontSize: '11.5px',
                    textAlign: 'left',
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* Continuous 24h Dial Slider */}
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '11.5px',
                color: UI_COLORS.mistText,
                marginBottom: '6px',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <Sun size={13} style={{ color: UI_COLORS.warmAmber }} />
                <span>Xoay kim giờ xem thử ánh sáng:</span>
              </span>
              <span style={{ fontFamily: UI_FONTS.mono, color: UI_COLORS.warmAmber }}>
                {formatGameHour(effectiveHour)} • {atmosphere.phaseTitle}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={23.95}
              step={0.05}
              value={effectiveHour}
              onChange={(e) =>
                setOverrideAtmosphere(parseFloat(e.target.value), overrideWeather)
              }
              style={{ width: '100%', accentColor: '#F3C382', cursor: 'pointer' }}
            />
          </div>

          {/* Explicit Weather Selector */}
          <div>
            <div style={{ fontSize: '11.5px', color: UI_COLORS.mistText, marginBottom: '6px' }}>
              Thử nghiệm kiểu sương mây (cục bộ trên máy bạn):
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {WEATHER_IDS.map((wid) => {
                const active = !isSyncedToServer && atmosphere.weather === wid && overrideWeather === wid;
                return (
                  <button
                    key={wid}
                    type="button"
                    onClick={() => setOverrideAtmosphere(effectiveHour, wid)}
                    className="dalat-glass-btn"
                    style={{
                      padding: '5px 10px',
                      borderRadius: '999px',
                      background: active
                        ? 'rgba(243, 195, 130, 0.24)'
                        : 'rgba(255, 255, 255, 0.04)',
                      border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                      fontSize: '11px',
                    }}
                  >
                    {WEATHER_LABELS[wid]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 2. Audio & Highland Soundscape Volume */}
        <div
          style={{
            padding: '14px 16px',
            borderRadius: '16px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${UI_COLORS.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => setAudioEnabled(!audioEnabled)}
            className="dalat-glass-btn"
            style={{
              padding: '8px 14px',
              borderRadius: '11px',
              background: audioEnabled
                ? 'rgba(243, 195, 130, 0.18)'
                : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${audioEnabled ? UI_COLORS.warmAmber : UI_COLORS.border}`,
              color: UI_COLORS.cream,
              fontSize: '12.5px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {audioEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span>Âm thanh gió thông & Guitar: {audioEnabled ? 'Đang bật' : 'Đã tắt'}</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '180px' }}>
            <span style={{ fontSize: '12px', color: UI_COLORS.mistText }}>Âm lượng</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={masterVolume}
              onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: '#F3C382', cursor: 'pointer' }}
            />
            <span style={{ fontFamily: UI_FONTS.mono, fontSize: '11.5px', width: '38px' }}>
              {Math.round(masterVolume * 100)}%
            </span>
          </div>
        </div>

        {/* 3. Graphics Quality Tier & Live Telemetry */}
        <div
          style={{
            padding: '14px 16px',
            borderRadius: '16px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${UI_COLORS.border}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 600 }}>Chất lượng đồ họa 3D</span>
            <span
              style={{
                fontFamily: UI_FONTS.mono,
                fontSize: '11px',
                color: UI_COLORS.mistText,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Cpu size={12} style={{ color: UI_COLORS.warmAmber }} />
              <span>
                {perfMetrics.fps} FPS • {perfMetrics.frameTimeMs}ms • {perfMetrics.drawCalls} draws
              </span>
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setQualityTier(qualityTier, true)}
              className="dalat-glass-btn"
              style={{
                padding: '8px 13px',
                borderRadius: '11px',
                background: autoQuality
                  ? 'rgba(243, 195, 130, 0.22)'
                  : 'rgba(255, 255, 255, 0.04)',
                border: `1px solid ${autoQuality ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                color: autoQuality ? UI_COLORS.warmAmber : UI_COLORS.cream,
                fontSize: '12px',
              }}
            >
              Tự động thích ứng
            </button>
            {QUALITY_OPTIONS.map((q) => {
              const active = !autoQuality && qualityTier === q.tier;
              return (
                <button
                  key={q.tier}
                  type="button"
                  onClick={() => setQualityTier(q.tier, false)}
                  className="dalat-glass-btn"
                  style={{
                    padding: '8px 13px',
                    borderRadius: '11px',
                    background: active
                      ? 'rgba(243, 195, 130, 0.22)'
                      : 'rgba(255, 255, 255, 0.04)',
                    border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                    color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                    fontSize: '12px',
                  }}
                >
                  {q.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
