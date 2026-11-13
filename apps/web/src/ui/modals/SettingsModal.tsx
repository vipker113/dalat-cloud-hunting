import { useEffect, useState } from 'react';
import { Accessibility, Clock, Cpu, Gamepad2, Sun, Volume2, VolumeX } from 'lucide-react';
import {
  formatGameHour,
  WEATHER_LABELS,
  WeatherStateId,
} from '@dalat/protocol';
import { QualityTier, useGameStore } from '../../store/gameStore';
import { sceneRenderStats } from '../../world/sceneRenderStats';
import { UI_COLORS, UI_FONTS } from '../uiStyles';
import { ModalShell } from './ModalShell';

const TIME_PRESETS: Array<{ label: string; hour: number; weather: WeatherStateId }> = [
  { label: '04:35 • Thung Lũng Đèn Đêm', hour: 4.58, weather: 'golden_cloud_sea' },
  { label: '05:25 • Bình Minh Biển Mây Vàng', hour: 5.42, weather: 'golden_cloud_sea' },
  { label: '07:05 • Sương Sôi Lưng Đồi', hour: 7.08, weather: 'morning_mist_boil' },
  { label: '14:30 • Nắng Trong Đồi Chè', hour: 14.5, weather: 'clear_highland_sun' },
  { label: '16:40 • Mưa Phùn Se Lạnh', hour: 16.66, weather: 'light_drizzle' },
  { label: '17:50 • Hoàng Hôn Tím Đồi Thông', hour: 17.83, weather: 'deep_evening_fog' },
];

const QUALITY_OPTIONS: Array<{ tier: QualityTier; label: string }> = [
  { tier: 'high', label: 'Cao (Đầy đủ sương & bóng)' },
  { tier: 'medium', label: 'Trung bình (Cân bằng)' },
  { tier: 'mobile', label: 'Di động (Tiết kiệm pin)' },
];

const WEATHER_IDS = Object.keys(WEATHER_LABELS) as WeatherStateId[];

export function SettingsModal() {
  const atmoGameHour = useGameStore((s) => s.atmosphere.gameHour);
  const atmoPhaseTitle = useGameStore((s) => s.atmosphere.phaseTitle);
  const atmoWeather = useGameStore((s) => s.atmosphere.weather);
  const overrideGameHour = useGameStore((s) => s.overrideGameHour);
  const overrideWeather = useGameStore((s) => s.overrideWeather);
  const qualityTier = useGameStore((s) => s.qualityTier);
  const autoQuality = useGameStore((s) => s.autoQuality);
  const audioEnabled = useGameStore((s) => s.audioEnabled);
  const masterVolume = useGameStore((s) => s.masterVolume);
  const cameraSensitivity = useGameStore((s) => s.cameraSensitivity);
  const reducedMotion = useGameStore((s) => s.reducedMotion);
  const quietMode = useGameStore((s) => s.quietMode);
  const perfMetrics = useGameStore((s) => s.perfMetrics);

  const setOverrideAtmosphere = useGameStore((s) => s.setOverrideAtmosphere);
  const setQualityTier = useGameStore((s) => s.setQualityTier);
  const setAudioEnabled = useGameStore((s) => s.setAudioEnabled);
  const setMasterVolume = useGameStore((s) => s.setMasterVolume);
  const setCameraSensitivity = useGameStore((s) => s.setCameraSensitivity);
  const setReducedMotion = useGameStore((s) => s.setReducedMotion);
  const setQuietMode = useGameStore((s) => s.setQuietMode);

  const [liveDrawCalls, setLiveDrawCalls] = useState<number>(() =>
    sceneRenderStats.drawCalls > 0 ? sceneRenderStats.drawCalls : perfMetrics.drawCalls
  );

  useEffect(() => {
    const syncDrawCalls = () => {
      const dc = sceneRenderStats.drawCalls;
      setLiveDrawCalls(dc > 0 ? dc : useGameStore.getState().perfMetrics.drawCalls);
    };
    syncDrawCalls();
    const timer = window.setInterval(syncDrawCalls, 400);
    return () => window.clearInterval(timer);
  }, []);

  const isSyncedToServer = overrideGameHour === null && overrideWeather === null;
  const effectiveHour = overrideGameHour ?? atmoGameHour;

  return (
    <ModalShell
      title="Cài Đặt, Trợ Năng & Khí Tượng"
      subtitle="Đồng bộ theo bình minh chung toàn phòng (:00 & :30) hoặc tùy chỉnh âm thanh, điều khiển và trợ năng"
      maxWidth="680px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', paddingBottom: '6px' }}>
        {/* 1. Shared Sky vs Local Preview Segmented Switch */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: '16px',
            background: 'rgba(243, 195, 130, 0.08)',
            border: `1px solid ${UI_COLORS.borderStrong}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '9px',
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
              <span style={{ fontSize: '14px', fontWeight: 600 }}>
                Nhịp Mặt Trời & Thời Tiết
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label="Chế độ bầu trời"
              style={{
                display: 'inline-flex',
                flexWrap: 'wrap',
                padding: '4px',
                borderRadius: '16px',
                background: 'rgba(8, 12, 20, 0.58)',
                border: `1px solid ${UI_COLORS.border}`,
                gap: '4px',
                maxWidth: '100%',
                boxSizing: 'border-box',
              }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={isSyncedToServer}
                onClick={() => setOverrideAtmosphere(null, null)}
                className="dalat-glass-btn"
                style={{
                  minHeight: '40px',
                  padding: '6px 12px',
                  borderRadius: '999px',
                  background: isSyncedToServer
                    ? 'linear-gradient(135deg, rgba(243, 195, 130, 0.94), rgba(226, 148, 86, 0.92))'
                    : 'transparent',
                  border: 'none',
                  color: isSyncedToServer ? '#171D2A' : UI_COLORS.cream,
                  fontSize: '12px',
                  fontWeight: 700,
                  flex: '1 1 auto',
                }}
              >
                🌍 Bầu Trời Chung (:00/:30)
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={!isSyncedToServer}
                onClick={() => {
                  if (isSyncedToServer) {
                    setOverrideAtmosphere(5.42, 'golden_cloud_sea');
                  }
                }}
                className="dalat-glass-btn"
                style={{
                  minHeight: '40px',
                  padding: '6px 12px',
                  borderRadius: '999px',
                  background: !isSyncedToServer ? 'rgba(243, 195, 130, 0.24)' : 'transparent',
                  border: 'none',
                  color: !isSyncedToServer ? UI_COLORS.warmAmber : UI_COLORS.cream,
                  fontSize: '12px',
                  fontWeight: 600,
                  flex: '1 1 auto',
                }}
              >
                🎞️ Xem Thử Cục Bộ
              </button>
            </div>
          </div>

          <div style={{ fontSize: '12px', color: UI_COLORS.mistText }}>
            {isSyncedToServer
              ? 'Mọi lữ khách trong phòng đang ngắm chung một bầu trời thời gian thực.'
              : 'Đang xem thử ánh sáng riêng trên máy của bạn (không ảnh hưởng người chơi khác).'}
          </div>

          {/* Quick Golden Hour / Weather Presets */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 195px), 1fr))',
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
                    minHeight: '38px',
                    padding: '8px 11px',
                    borderRadius: '11px',
                    background: active
                      ? 'rgba(243, 195, 130, 0.24)'
                      : 'rgba(255, 255, 255, 0.045)',
                    border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                    color: UI_COLORS.cream,
                    fontSize: '12px',
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
                fontSize: '12px',
                color: UI_COLORS.mistText,
                marginBottom: '6px',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <Sun size={13} style={{ color: UI_COLORS.warmAmber }} />
                <span>Xoay kim giờ xem thử ánh sáng:</span>
              </span>
              <span style={{ fontFamily: UI_FONTS.mono, color: UI_COLORS.warmAmber }}>
                {formatGameHour(effectiveHour)} • {atmoPhaseTitle}
              </span>
            </div>
            <input
              type="range"
              aria-label="Giờ ánh sáng trong ngày"
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
            <div style={{ fontSize: '12px', color: UI_COLORS.mistText, marginBottom: '6px' }}>
              Kiểu sương mây (xem thử cục bộ):
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {WEATHER_IDS.map((wid) => {
                const active = !isSyncedToServer && atmoWeather === wid && overrideWeather === wid;
                return (
                  <button
                    key={wid}
                    type="button"
                    onClick={() => setOverrideAtmosphere(effectiveHour, wid)}
                    className="dalat-glass-btn"
                    style={{
                      minHeight: '38px',
                      padding: '6px 11px',
                      borderRadius: '999px',
                      background: active
                        ? 'rgba(243, 195, 130, 0.24)'
                        : 'rgba(255, 255, 255, 0.045)',
                      border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                      fontSize: '12px',
                    }}
                  >
                    {WEATHER_LABELS[wid]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 2. Comfort, Accessibility & Camera Sensitivity */}
        <div
          style={{
            padding: '11px 14px',
            borderRadius: '15px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${UI_COLORS.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '9px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', fontWeight: 600 }}>
            <Accessibility size={16} style={{ color: UI_COLORS.warmAmber }} />
            <span>Điều Khiển & Trợ Năng Thoải Mái</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: UI_COLORS.mistText, minWidth: 'min(100%, 150px)' }}>
              Độ nhạy xoay góc nhìn
            </span>
            <input
              type="range"
              aria-label="Độ nhạy xoay góc nhìn"
              min={0.4}
              max={1.8}
              step={0.05}
              value={cameraSensitivity}
              onChange={(e) => setCameraSensitivity(parseFloat(e.target.value))}
              style={{ flex: 1, minWidth: 'min(100%, 130px)', accentColor: '#F3C382', cursor: 'pointer' }}
            />
            <span style={{ fontFamily: UI_FONTS.mono, fontSize: '12px', width: '44px', textAlign: 'right' }}>
              {Math.round(cameraSensitivity * 100)}%
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button
              type="button"
              aria-pressed={reducedMotion}
              onClick={() => setReducedMotion(!reducedMotion)}
              className="dalat-glass-btn"
              style={{
                minHeight: '42px',
                padding: '8px 13px',
                borderRadius: '11px',
                background: reducedMotion ? 'rgba(243, 195, 130, 0.22)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${reducedMotion ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                color: reducedMotion ? UI_COLORS.warmAmber : UI_COLORS.cream,
                fontSize: '12px',
                fontWeight: 500,
                textAlign: 'left',
                boxSizing: 'border-box',
              }}
            >
              Giảm chuyển động (Chống say 3D): {reducedMotion ? 'Đang bật' : 'Tắt'}
            </button>

            <button
              type="button"
              aria-pressed={quietMode}
              onClick={() => setQuietMode(!quietMode)}
              className="dalat-glass-btn"
              style={{
                minHeight: '42px',
                padding: '8px 13px',
                borderRadius: '11px',
                background: quietMode ? 'rgba(243, 195, 130, 0.22)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${quietMode ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                color: quietMode ? UI_COLORS.warmAmber : UI_COLORS.cream,
                fontSize: '12px',
                fontWeight: 500,
                textAlign: 'left',
                boxSizing: 'border-box',
              }}
            >
              Chế độ tĩnh lặng (Dịu âm thanh & bong bóng xa): {quietMode ? 'Đang bật' : 'Tắt'}
            </button>
          </div>
        </div>

        {/* 3. Audio & Highland Soundscape Volume */}
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '15px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${UI_COLORS.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            aria-pressed={audioEnabled}
            onClick={() => setAudioEnabled(!audioEnabled)}
            className="dalat-glass-btn"
            style={{
              minHeight: '42px',
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
              textAlign: 'left',
              boxSizing: 'border-box',
            }}
          >
            {audioEnabled ? <Volume2 size={15} style={{ flexShrink: 0 }} /> : <VolumeX size={15} style={{ flexShrink: 0 }} />}
            <span>Âm thanh gió thông & Guitar: {audioEnabled ? 'Đang bật' : 'Đã tắt'}</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 'min(100%, 180px)' }}>
            <span style={{ fontSize: '12px', color: UI_COLORS.mistText }}>Âm lượng</span>
            <input
              type="range"
              aria-label="Âm lượng tổng"
              min={0}
              max={1}
              step={0.02}
              value={masterVolume}
              onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: '#F3C382', cursor: 'pointer' }}
            />
            <span style={{ fontFamily: UI_FONTS.mono, fontSize: '12px', width: '40px', textAlign: 'right' }}>
              {Math.round(masterVolume * 100)}%
            </span>
          </div>
        </div>

        {/* 4. Graphics Quality Tier & Live Telemetry */}
        <div
          style={{
            padding: '12px 14px 14px',
            borderRadius: '15px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${UI_COLORS.border}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '12px',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <span style={{ fontSize: '13.5px', fontWeight: 600 }}>Chất lượng đồ họa 3D</span>
            <span
              data-testid="settings-perf-telemetry"
              style={{
                fontFamily: UI_FONTS.mono,
                fontSize: '12px',
                color: UI_COLORS.mistText,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Cpu size={13} style={{ color: UI_COLORS.warmAmber }} />
              <span>
                {perfMetrics.fps} FPS • {perfMetrics.frameTimeMs}ms • {liveDrawCalls} draws
              </span>
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button
              type="button"
              aria-pressed={autoQuality}
              onClick={() => setQualityTier(qualityTier, true)}
              className="dalat-glass-btn"
              style={{
                minHeight: '42px',
                padding: '9px 14px',
                borderRadius: '11px',
                background: autoQuality
                  ? 'rgba(243, 195, 130, 0.22)'
                  : 'rgba(255, 255, 255, 0.045)',
                border: `1px solid ${autoQuality ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                color: autoQuality ? UI_COLORS.warmAmber : UI_COLORS.cream,
                fontSize: '12px',
                fontWeight: autoQuality ? 600 : 500,
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
                  aria-pressed={active}
                  onClick={() => setQualityTier(q.tier, false)}
                  className="dalat-glass-btn"
                  style={{
                    minHeight: '42px',
                    padding: '9px 14px',
                    borderRadius: '11px',
                    background: active
                      ? 'rgba(243, 195, 130, 0.22)'
                      : 'rgba(255, 255, 255, 0.045)',
                    border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                    color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                    fontSize: '12px',
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {q.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 5. Controls & Gamepad Reference Card */}
        <div
          style={{
            padding: '14px 16px',
            borderRadius: '16px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: `1px solid ${UI_COLORS.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', fontWeight: 600 }}>
            <Gamepad2 size={16} style={{ color: UI_COLORS.warmAmber }} />
            <span>Hướng dẫn Phím tắt, Cảm ứng & Tay cầm (Gamepad)</span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
              gap: '6px 14px',
              fontSize: '12px',
              color: UI_COLORS.mistText,
            }}
          >
            <div><b style={{ color: UI_COLORS.warmAmber }}>WASD / Joystick trái:</b> Di chuyển (Shift chạy)</div>
            <div><b style={{ color: UI_COLORS.warmAmber }}>Kéo chuột / Chụm 2 ngón:</b> Xoay & thu phóng</div>
            <div><b style={{ color: UI_COLORS.warmAmber }}>[E] / Chạm biểu tượng:</b> Pha cà phê, ngồi ghế</div>
            <div><b style={{ color: UI_COLORS.warmAmber }}>[Tab] (Giữ hoặc chạm):</b> Đạo cụ & biểu cảm</div>
            <div><b style={{ color: UI_COLORS.warmAmber }}>[P] Máy ảnh • [M] Bản đồ:</b> Chụp phim & dịch chuyển</div>
            <div><b style={{ color: UI_COLORS.warmAmber }}>[J] Sổ tay • [O] Tủ đồ:</b> Nhật ký mây & thay áo</div>
            <div><b style={{ color: UI_COLORS.warmAmber }}>Tay cầm (Xbox/PS):</b> Cần trái/phải, A tương tác, Y chụp</div>
            <div><b style={{ color: UI_COLORS.warmAmber }}>Bên lửa trại [1–6]:</b> Gảy hợp âm Guitar Acoustic</div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
