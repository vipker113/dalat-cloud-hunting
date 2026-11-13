import { Cloud, Compass, Sparkles } from 'lucide-react';
import {
  LANDMARK_LIST,
  WEATHER_LABELS,
  WeatherStateId,
} from '@dalat/protocol';
import { useGameStore } from '../../store/gameStore';
import { UI_COLORS, UI_FONTS } from '../uiStyles';
import { JournalNavBar } from './JournalNavBar';
import { ModalShell } from './ModalShell';

const WEATHER_LORE: Record<WeatherStateId, { inversion: string; note: string }> = {
  golden_cloud_sea: {
    inversion: 'Đỉnh mây ~1.558m ASL',
    note: 'Hiện tượng nghịch nhiệt rạng đông giữ biển mây đặc quánh dưới thung lũng khi nắng vàng đầu tiên chiếu xiên qua đồi chè.',
  },
  morning_mist_boil: {
    inversion: 'Sương dâng ~1.586m ASL',
    note: 'Khi nắng lên ấm dần, sương từ thung lũng cuộn nhẹ lên hiên gỗ Tiệm Cà Phê Mơ Sương.',
  },
  clear_highland_sun: {
    inversion: 'Trời quang ~1.528m ASL',
    note: 'Nắng cao nguyên trong vắt nhìn rõ 5 tua-bin điện gió Cầu Đất và đỉnh núi đôi Langbiang.',
  },
  cloudy_breeze: {
    inversion: 'Gió đồi se mát',
    note: 'Từng dải bóng mây lướt nhanh qua luống chè cổ thụ và thảm cỏ hồng tuyết.',
  },
  deep_evening_fog: {
    inversion: 'Mù sương ~1.592m ASL',
    note: 'Sương chiều Đà Lạt bảng lảng phủ tím rừng thông ba lá, ánh đèn lồng vàng bắt đầu thắp sáng.',
  },
  light_drizzle: {
    inversion: 'Mưa phùn 10–13°C',
    note: 'Mưa bụi mịn làm đất đỏ bazan ẩm mượt — lúc tuyệt nhất để cầm ly sữa đậu nành nóng bên bếp lửa.',
  },
};

const ALL_WEATHERS = Object.keys(WEATHER_LABELS) as WeatherStateId[];

export function AlmanacModal() {
  const discoveredLandmarks = useGameStore((s) => s.discoveredLandmarks);
  const discoveredWeathers = useGameStore((s) => s.discoveredWeathers);
  const teleportToLandmark = useGameStore((s) => s.teleportToLandmark);

  const landmarkCount = LANDMARK_LIST.filter((l) => discoveredLandmarks[l.id]).length;
  const weatherCount = ALL_WEATHERS.filter((w) => discoveredWeathers[w]).length;

  return (
    <ModalShell
      title="Sổ Tay Săn Mây Đà Lạt"
      subtitle="Ghi chép hành trình dạo bước qua các đỉnh đồi, ảnh Polaroid và thẻ ước nguyện cao nguyên"
      maxWidth="760px"
    >
      <JournalNavBar active="almanac" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Summary Ribbon */}
        <div
          style={{
            padding: '13px 16px',
            borderRadius: '15px',
            background: 'rgba(243, 195, 130, 0.09)',
            border: `1px solid ${UI_COLORS.borderStrong}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            fontSize: '12.5px',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
            <Compass size={15} style={{ color: UI_COLORS.warmAmber }} />
            <span>
              Địa danh đã đặt chân:{' '}
              <strong style={{ color: UI_COLORS.warmAmber, fontFamily: UI_FONTS.mono }}>
                {landmarkCount}/{LANDMARK_LIST.length}
              </strong>
            </span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
            <Cloud size={15} style={{ color: UI_COLORS.warmAmber }} />
            <span>
              Khoảnh khắc thời tiết:{' '}
              <strong style={{ color: UI_COLORS.warmAmber, fontFamily: UI_FONTS.mono }}>
                {weatherCount}/{ALL_WEATHERS.length}
              </strong>
            </span>
          </span>
          <span style={{ fontSize: '12px', color: UI_COLORS.mistText }}>
            Bình minh thực tế mỗi :00 & :30 hàng giờ
          </span>
        </div>

        {/* 5 Landmarks Section */}
        <div>
          <h3
            className="dalat-serif"
            style={{
              fontFamily: UI_FONTS.serif,
              fontSize: '17px',
              color: UI_COLORS.warmAmber,
              marginBottom: '10px',
            }}
          >
            5 Điểm Ngắm Mây Cầu Đất – Thiên Phúc Đức
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 270px), 1fr))',
              gap: '10px',
            }}
          >
            {LANDMARK_LIST.map((lm) => {
              const seen = Boolean(discoveredLandmarks[lm.id]);
              return (
                <div
                  key={lm.id}
                  style={{
                    padding: '13px 14px',
                    borderRadius: '14px',
                    background: seen
                      ? 'rgba(243, 195, 130, 0.10)'
                      : 'rgba(13, 19, 30, 0.78)',
                    border: `1px solid ${seen ? UI_COLORS.borderStrong : 'rgba(214, 224, 242, 0.24)'}`,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '10px',
                    boxSizing: 'border-box',
                    minWidth: 0,
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: '8px',
                      }}
                    >
                      <span style={{ fontSize: '14px', fontWeight: 600, color: UI_COLORS.cream }}>
                        {lm.name}
                      </span>
                      <span
                        style={{
                          padding: '3px 9px',
                          borderRadius: '999px',
                          fontSize: '12px',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          background: seen
                            ? 'rgba(130, 214, 158, 0.18)'
                            : 'rgba(15, 22, 34, 0.88)',
                          border: `1px solid ${seen ? 'rgba(130, 214, 158, 0.50)' : 'rgba(214, 224, 242, 0.34)'}`,
                          color: seen ? UI_COLORS.pineSage : '#DCE4F2',
                          flexShrink: 0,
                        }}
                      >
                        {seen ? '✦ Đã đặt chân' : '◌ Chưa tới'}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: '12px',
                        color: UI_COLORS.mistText,
                        lineHeight: 1.48,
                        marginTop: '6px',
                        marginBottom: 0,
                      }}
                    >
                      {lm.subtitle}
                    </p>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      fontSize: '12px',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: UI_FONTS.mono,
                        color: UI_COLORS.warmAmber,
                        minWidth: 0,
                      }}
                    >
                      {lm.altitudeASL.toLocaleString('en-US')}m • {lm.bestTimeHint}
                    </span>
                    <button
                      type="button"
                      onClick={() => teleportToLandmark(lm.id)}
                      className="dalat-glass-btn"
                      style={{
                        minHeight: '40px',
                        padding: '6px 13px',
                        borderRadius: '999px',
                        background: 'rgba(243, 195, 130, 0.20)',
                        border: `1px solid ${UI_COLORS.borderStrong}`,
                        color: UI_COLORS.warmAmber,
                        fontSize: '12px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      Ghé tới
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 6 Highland Weather Phenomena */}
        <div>
          <h3
            className="dalat-serif"
            style={{
              fontFamily: UI_FONTS.serif,
              fontSize: '17px',
              color: UI_COLORS.warmAmber,
              marginBottom: '10px',
            }}
          >
            6 Hiện Tượng Khí Tượng Cao Nguyên
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
              gap: '9px',
            }}
          >
            {ALL_WEATHERS.map((wid) => {
              const seen = Boolean(discoveredWeathers[wid]);
              const info = WEATHER_LORE[wid];
              return (
                <div
                  key={wid}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '13px',
                    background: seen
                      ? 'rgba(243, 195, 130, 0.10)'
                      : 'rgba(13, 19, 30, 0.78)',
                    border: `1px solid ${seen ? UI_COLORS.borderStrong : 'rgba(214, 224, 242, 0.24)'}`,
                    boxSizing: 'border-box',
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                      marginBottom: '4px',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 600, color: UI_COLORS.cream }}>
                      {WEATHER_LABELS[wid]}
                    </span>
                    {seen ? (
                      <Sparkles size={14} style={{ color: UI_COLORS.warmAmber, flexShrink: 0 }} />
                    ) : (
                      <span
                        style={{
                          fontSize: '11.5px',
                          fontWeight: 600,
                          color: '#DCE4F2',
                          flexShrink: 0,
                        }}
                      >
                        ◌ Chưa gặp
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: UI_FONTS.mono,
                      fontSize: '12px',
                      color: UI_COLORS.warmAmber,
                      marginBottom: '5px',
                    }}
                  >
                    {info.inversion}
                  </div>
                  <p style={{ fontSize: '12px', lineHeight: 1.48, color: UI_COLORS.mistText, margin: 0 }}>
                    {info.note}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
