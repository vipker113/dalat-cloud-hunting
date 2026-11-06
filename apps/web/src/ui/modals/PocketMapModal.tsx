import { useEffect, useState } from 'react';
import { Compass, MapPin, Navigation } from 'lucide-react';
import {
  LANDMARK_LIST,
  LandmarkId,
  LandmarkSpec,
  TRAIL_SEGMENTS,
} from '@dalat/protocol';
import { useGameStore } from '../../store/gameStore';
import { UI_COLORS, UI_FONTS } from '../uiStyles';
import { ModalShell } from './ModalShell';

// Convert world [x, z] in [-260..340, -260..240] cleanly onto the 520x520 pocket map viewport
function worldToMap(x: number, z: number): [number, number] {
  // Keep full 900m [-450..450] represented with gentle focus on the active highland ridge
  const u = (x + 280) / 640;
  const v = (z + 290) / 560;
  return [
    Math.max(24, Math.min(496, u * 472 + 24)),
    Math.max(24, Math.min(496, v * 472 + 24)),
  ];
}

const TURBINE_WORLD_COORDS: Array<[number, number]> = [
  [185, -145],
  [235, -65],
  [215, 28],
  [295, -185],
  [310, -15],
];

export function PocketMapModal() {
  const discoveredLandmarks = useGameStore((s) => s.discoveredLandmarks);
  const teleportToLandmark = useGameStore((s) => s.teleportToLandmark);
  const showToast = useGameStore((s) => s.showToast);

  const [selectedId, setSelectedId] = useState<LandmarkId>('cau-go-san-may');
  const [livePositions, setLivePositions] = useState(() => {
    const st = useGameStore.getState();
    return {
      me: { x: st.localTransient.x, z: st.localTransient.z, yaw: st.localTransient.yaw },
      peers: Object.values(st.peers).map((p) => ({ id: p.sessionId, x: p.x, z: p.z, name: p.displayName })),
      beacons: st.farBeacons.map((b) => ({ id: b.numericId, x: b.x, z: b.z })),
    };
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const st = useGameStore.getState();
      setLivePositions({
        me: { x: st.localTransient.x, z: st.localTransient.z, yaw: st.localTransient.yaw },
        peers: Object.values(st.peers).map((p) => ({ id: p.sessionId, x: p.x, z: p.z, name: p.displayName })),
        beacons: st.farBeacons.map((b) => ({ id: b.numericId, x: b.x, z: b.z })),
      });
    }, 350);
    return () => clearInterval(timer);
  }, []);

  const selectedLandmark: LandmarkSpec =
    LANDMARK_LIST.find((l) => l.id === selectedId) || LANDMARK_LIST[0];

  const handleFastTravel = (lm: LandmarkSpec) => {
    teleportToLandmark(lm.id);
    showToast(`🛵 Đã đi xe Super Cub 50 tới ${lm.name} (${lm.altitudeASL.toLocaleString('en-US')}m ASL)`);
  };

  const [meSvgX, meSvgY] = worldToMap(livePositions.me.x, livePositions.me.z);

  return (
    <ModalShell
      title="Bản Đồ Sổ Tay Cầu Đất – Mơ Sương"
      subtitle="Sườn đồi săn mây 900m × 900m • Chọn địa danh để xem gợi ý giờ vàng hoặc đi xe Cub tới ngay"
      maxWidth="840px"
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
          gap: '18px',
          alignItems: 'stretch',
        }}
      >
        {/* Illustrated Watercolor-Style SVG Highland Map */}
        <div
          style={{
            borderRadius: '20px',
            overflow: 'hidden',
            border: '1px solid rgba(243, 195, 130, 0.28)',
            boxShadow: 'inset 0 0 32px rgba(20, 14, 10, 0.35)',
            background: '#EFE5D1',
            position: 'relative',
          }}
        >
          <svg
            viewBox="0 0 520 520"
            style={{ width: '100%', height: 'auto', display: 'block' }}
          >
            <defs>
              <radialGradient id="parchmentWash" cx="42%" cy="46%" r="72%">
                <stop offset="0%" stopColor="#F5ECD9" />
                <stop offset="62%" stopColor="#E6D8BE" />
                <stop offset="100%" stopColor="#D3C0A1" />
              </radialGradient>
              <linearGradient id="eastCloudWash" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(255, 224, 182, 0)" />
                <stop offset="45%" stopColor="rgba(255, 214, 165, 0.45)" />
                <stop offset="100%" stopColor="rgba(248, 182, 122, 0.72)" />
              </linearGradient>
              <radialGradient id="teaHillWash" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(104, 152, 106, 0.38)" />
                <stop offset="100%" stopColor="rgba(104, 152, 106, 0)" />
              </radialGradient>
              <radialGradient id="pinkMeadowWash" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(226, 152, 168, 0.42)" />
                <stop offset="100%" stopColor="rgba(226, 152, 168, 0)" />
              </radialGradient>
            </defs>

            {/* Warm Watercolor Paper Base */}
            <rect x="0" y="0" width="520" height="520" fill="url(#parchmentWash)" />

            {/* Eastern Golden Cloud Sea Basin */}
            <rect x="300" y="0" width="220" height="520" fill="url(#eastCloudWash)" />

            {/* Watercolor Tea Terrace & Pink Grass Washes */}
            <circle cx="290" cy="205" r="105" fill="url(#teaHillWash)" />
            <circle cx="222" cy="126" r="68" fill="url(#pinkMeadowWash)" />
            <circle cx="145" cy="145" r="85" fill="url(#teaHillWash)" />

            {/* Topographic Contour Ellipses */}
            <ellipse
              cx="296"
              cy="206"
              rx="82"
              ry="68"
              fill="none"
              stroke="rgba(112, 92, 68, 0.22)"
              strokeWidth="1.2"
              strokeDasharray="6 4"
            />
            <ellipse
              cx="296"
              cy="206"
              rx="48"
              ry="38"
              fill="none"
              stroke="rgba(112, 92, 68, 0.3)"
              strokeWidth="1.2"
            />
            <ellipse
              cx="162"
              cy="138"
              rx="58"
              ry="46"
              fill="none"
              stroke="rgba(112, 92, 68, 0.24)"
              strokeWidth="1.2"
            />
            <ellipse
              cx="202"
              cy="296"
              rx="64"
              ry="48"
              fill="none"
              stroke="rgba(112, 92, 68, 0.22)"
              strokeWidth="1.2"
            />

            {/* North: Twin Peaks of Langbiang (2,167m) */}
            <g transform="translate(155, 22)">
              <path
                d="M 0 34 L 28 8 L 52 26 L 82 2 L 116 34 Z"
                fill="rgba(92, 114, 128, 0.28)"
                stroke="#5A6B78"
                strokeWidth="1.4"
              />
              <text
                x="58"
                y="47"
                textAnchor="middle"
                fill="#4D5A66"
                fontSize="9.5"
                fontFamily={UI_FONTS.serif}
                fontStyle="italic"
              >
                ▲ BẮC • Đỉnh Langbiang 2,167m
              </text>
            </g>

            {/* East Sunrise Compass Rose */}
            <g transform="translate(454, 255)">
              <circle r="28" fill="rgba(255, 245, 228, 0.72)" stroke="#B87D44" strokeWidth="1.2" />
              <path d="M -12 0 L 14 0 M 6 -6 L 15 0 L 6 6" fill="none" stroke="#C46D34" strokeWidth="2" />
              <text
                x="0"
                y="-34"
                textAnchor="middle"
                fill="#8C4E24"
                fontSize="9.5"
                fontWeight="600"
              >
                ĐÔNG ☀
              </text>
              <text
                x="0"
                y="42"
                textAnchor="middle"
                fill="#8C4E24"
                fontSize="8.5"
              >
                Bình minh
              </text>
            </g>

            {/* 5 Eastern Cầu Đất Wind Turbines */}
            {TURBINE_WORLD_COORDS.map(([tx, tz], i) => {
              const [sx, sy] = worldToMap(tx, tz);
              return (
                <g key={i} transform={`translate(${sx}, ${sy})`} opacity={0.72}>
                  <line x1="0" y1="0" x2="0" y2="16" stroke="#6E6558" strokeWidth="1.6" />
                  <line x1="0" y1="0" x2="0" y2="-9" stroke="#6E6558" strokeWidth="1.3" />
                  <line x1="0" y1="0" x2="8" y2="5" stroke="#6E6558" strokeWidth="1.3" />
                  <line x1="0" y1="0" x2="-8" y2="5" stroke="#6E6558" strokeWidth="1.3" />
                  <circle r="1.8" fill="#6E6558" />
                </g>
              );
            })}

            {/* Red-Basalt Highland Footpaths (TRAIL_SEGMENTS) */}
            {TRAIL_SEGMENTS.map(([ax, az, bx, bz], idx) => {
              const [x1, y1] = worldToMap(ax, az);
              const [x2, y2] = worldToMap(bx, bz);
              return (
                <line
                  key={idx}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#B56545"
                  strokeWidth="2.6"
                  strokeDasharray="5 4"
                  strokeLinecap="round"
                />
              );
            })}

            {/* Distant Lantern Beacons */}
            {livePositions.beacons.map((b) => {
              const [bx, by] = worldToMap(b.x, b.z);
              return <circle key={`b-${b.id}`} cx={bx} cy={by} r="2.6" fill="#E39A44" opacity={0.65} />;
            })}

            {/* Nearby Remote Peers */}
            {livePositions.peers.map((p) => {
              const [px, py] = worldToMap(p.x, p.z);
              return (
                <g key={p.id} transform={`translate(${px}, ${py})`}>
                  <circle r="4" fill="#4E7A6B" stroke="#FAF4E8" strokeWidth="1.4" />
                </g>
              );
            })}

            {/* 5 Interactive Landmark Pins */}
            {LANDMARK_LIST.map((lm) => {
              const [lx, ly] = worldToMap(lm.position[0], lm.position[2]);
              const active = lm.id === selectedId;
              const discovered = discoveredLandmarks[lm.id];
              return (
                <g
                  key={lm.id}
                  transform={`translate(${lx}, ${ly})`}
                  onClick={() => setSelectedId(lm.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {active && (
                    <circle
                      r="14"
                      fill="rgba(212, 118, 58, 0.22)"
                      stroke="#C46A32"
                      strokeWidth="1.4"
                    />
                  )}
                  <circle
                    r={active ? '7.5' : '6'}
                    fill={discovered ? '#C86733' : '#7E7466'}
                    stroke="#FFF9F0"
                    strokeWidth="2"
                  />
                  <text
                    x="0"
                    y="-12"
                    textAnchor="middle"
                    fill="#2D241C"
                    fontSize="10"
                    fontWeight={active ? '600' : '500'}
                    style={{ paintOrder: 'stroke', stroke: '#F6EEDB', strokeWidth: '3px' }}
                  >
                    {lm.id === 'quan-mo-suong'
                      ? 'Tiệm Mơ Sương'
                      : lm.id === 'cau-go-san-may'
                        ? 'Cầu Gỗ Săn Mây'
                        : lm.id === 'cay-thong-co-don'
                          ? 'Thông Cô Đơn'
                          : lm.id === 'dai-ngam-den'
                            ? 'Thung Lũng Đèn'
                            : 'Gác Chè 1927'}
                  </text>
                </g>
              );
            })}

            {/* Live Local Player Dot + Heading Arrow */}
            <g transform={`translate(${meSvgX}, ${meSvgY})`}>
              <circle r="10" fill="rgba(42, 110, 186, 0.22)" />
              <circle r="5.5" fill="#2563EB" stroke="#FFFFFF" strokeWidth="2" />
            </g>
          </svg>
        </div>

        {/* Right Column: Landmark Selector & Fast-Travel Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div
            style={{
              padding: '16px',
              borderRadius: '18px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${UI_COLORS.borderStrong}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                marginBottom: '6px',
              }}
            >
              <span
                style={{
                  fontFamily: UI_FONTS.mono,
                  fontSize: '11px',
                  color: UI_COLORS.warmAmber,
                }}
              >
                {selectedLandmark.altitudeASL.toLocaleString('en-US')}m ASL •{' '}
                {discoveredLandmarks[selectedLandmark.id] ? 'Đã khám phá' : 'Chưa đặt chân'}
              </span>
            </div>

            <h3
              style={{
                fontFamily: UI_FONTS.serif,
                fontSize: '19px',
                color: UI_COLORS.cream,
                marginBottom: '6px',
              }}
            >
              {selectedLandmark.name}
            </h3>

            <p
              style={{
                fontSize: '12.5px',
                lineHeight: 1.5,
                color: UI_COLORS.mistText,
                marginBottom: '10px',
              }}
            >
              {selectedLandmark.subtitle}
            </p>

            <div
              style={{
                fontSize: '11.5px',
                color: '#F3DEC0',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Compass size={13} style={{ color: UI_COLORS.warmAmber }} />
              <span>Khung giờ đẹp nhất: {selectedLandmark.bestTimeHint}</span>
            </div>

            <button
              type="button"
              onClick={() => handleFastTravel(selectedLandmark)}
              className="dalat-glass-btn"
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: '12px',
                background:
                  'linear-gradient(135deg, rgba(226, 152, 86, 0.92), rgba(196, 112, 68, 0.92))',
                border: '1px solid rgba(255, 226, 182, 0.5)',
                color: '#171D2A',
                fontSize: '13px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <Navigation size={14} />
              <span>Đi xe Cub tới điểm ngắm</span>
            </button>
          </div>

          {/* All 5 Landmarks Quick List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {LANDMARK_LIST.map((lm) => {
              const active = lm.id === selectedId;
              return (
                <button
                  key={lm.id}
                  type="button"
                  onClick={() => setSelectedId(lm.id)}
                  className="dalat-glass-btn"
                  style={{
                    padding: '9px 12px',
                    borderRadius: '12px',
                    background: active
                      ? 'rgba(243, 195, 130, 0.18)'
                      : 'rgba(255, 255, 255, 0.03)',
                    border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                    color: UI_COLORS.cream,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px' }}>
                    <MapPin
                      size={13}
                      style={{
                        color: discoveredLandmarks[lm.id] ? UI_COLORS.warmAmber : UI_COLORS.mutedText,
                        flexShrink: 0,
                      }}
                    />
                    <span>{lm.name}</span>
                  </span>
                  <span
                    style={{
                      fontFamily: UI_FONTS.mono,
                      fontSize: '11px',
                      color: UI_COLORS.mistText,
                      flexShrink: 0,
                    }}
                  >
                    {lm.altitudeASL}m
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
