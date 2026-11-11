import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass,
  Crosshair,
  MapPin,
  Minus,
  Navigation,
  Plus,
  RotateCcw,
  Users,
} from 'lucide-react';
import {
  gameYToASL,
  LANDMARK_LIST,
  LandmarkId,
  LandmarkSpec,
  TRAIL_SEGMENTS,
} from '@dalat/protocol';
import { useGameStore } from '../../store/gameStore';
import { UI_COLORS, UI_FONTS } from '../uiStyles';
import { ModalShell } from './ModalShell';

const MAP_VB_SIZE = 600;

// Convert world [x, z] onto the 600x600 high-detail highland map coordinate space
function worldToMap(x: number, z: number): [number, number] {
  const u = (x + 270) / 630;
  const v = (z + 280) / 550;
  return [
    Math.max(24, Math.min(MAP_VB_SIZE - 24, u * (MAP_VB_SIZE - 48) + 24)),
    Math.max(24, Math.min(MAP_VB_SIZE - 24, v * (MAP_VB_SIZE - 48) + 24)),
  ];
}

const TURBINE_WORLD_COORDS: Array<[number, number]> = [
  [185, -145],
  [235, -65],
  [215, 28],
  [295, -185],
  [310, -15],
];

const EXTRA_POIS: Array<{ label: string; x: number; z: number; icon: string }> = [
  { label: 'Đồi Cỏ Hồng', x: -38, z: -122, icon: '🌸' },
  { label: 'Lửa Trại Đêm', x: -53, z: 24, icon: '🔥' },
];

const SHORT_LANDMARK_NAMES: Record<LandmarkId, string> = {
  'quan-mo-suong': 'Tiệm Mơ Sương',
  'cau-go-san-may': 'Cầu Gỗ Săn Mây',
  'cay-thong-co-don': 'Thông Cô Đơn',
  'dai-ngam-den': 'Thung Lũng Đèn',
  'gac-che-1927': 'Gác Chè 1927',
};

function clampPan(panX: number, panY: number, zoom: number): [number, number] {
  const halfSpan = MAP_VB_SIZE / (2 * zoom);
  const minCenter = halfSpan * 0.72;
  const maxCenter = MAP_VB_SIZE - halfSpan * 0.72;
  return [
    Math.max(minCenter, Math.min(maxCenter, panX)),
    Math.max(minCenter, Math.min(maxCenter, panY)),
  ];
}

export function PocketMapModal() {
  const discoveredLandmarks = useGameStore((s) => s.discoveredLandmarks);
  const teleportToLandmark = useGameStore((s) => s.teleportToLandmark);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const showToast = useGameStore((s) => s.showToast);

  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 900 : true
  );

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [livePositions, setLivePositions] = useState(() => {
    const st = useGameStore.getState();
    return {
      me: {
        x: st.localTransient.x,
        y: st.localTransient.y,
        z: st.localTransient.z,
        yaw: st.localTransient.yaw,
        cameraYaw: st.localTransient.cameraYaw,
      },
      peers: Object.values(st.peers).map((p) => ({
        id: p.sessionId,
        x: p.x,
        z: p.z,
        name: p.displayName,
      })),
      beacons: st.farBeacons.map((b) => ({ id: b.numericId, x: b.x, z: b.z })),
    };
  });

  // Default selected landmark to nearest or Cầu Gỗ Săn Mây
  const [selectedId, setSelectedId] = useState<LandmarkId>(() => {
    const st = useGameStore.getState();
    let best: LandmarkId = 'cau-go-san-may';
    let bestDist = Infinity;
    for (const lm of LANDMARK_LIST) {
      const d = Math.hypot(lm.position[0] - st.localTransient.x, lm.position[2] - st.localTransient.z);
      if (d < bestDist && d > 18) {
        bestDist = d;
        best = lm.id;
      }
    }
    return best;
  });

  // Interactive Zoom (1.0x .. 3.6x) & Center Pan in 600x600 viewBox units
  const [zoom, setZoom] = useState<number>(1.22);
  const [center, setCenter] = useState<[number, number]>(() => {
    const st = useGameStore.getState();
    const [mx, my] = worldToMap(st.localTransient.x, st.localTransient.z);
    return clampPan((mx + 300) * 0.5, (my + 275) * 0.5, 1.22);
  });
  const [isDragging, setIsDragging] = useState(false);

  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCenterX: number;
    startCenterY: number;
    movedPx: number;
  }>({
    active: false,
    pointerId: -1,
    startClientX: 0,
    startClientY: 0,
    startCenterX: 300,
    startCenterY: 300,
    movedPx: 0,
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const st = useGameStore.getState();
      setLivePositions({
        me: {
          x: st.localTransient.x,
          y: st.localTransient.y,
          z: st.localTransient.z,
          yaw: st.localTransient.yaw,
          cameraYaw: st.localTransient.cameraYaw,
        },
        peers: Object.values(st.peers).map((p) => ({
          id: p.sessionId,
          x: p.x,
          z: p.z,
          name: p.displayName,
        })),
        beacons: st.farBeacons.map((b) => ({ id: b.numericId, x: b.x, z: b.z })),
      });
    }, 220);
    return () => clearInterval(timer);
  }, []);

  const applyZoomAtRatio = useCallback(
    (nextZoomRaw: number, rx = 0.5, ry = 0.5) => {
      const nextZoom = Math.max(1.0, Math.min(3.6, nextZoomRaw));
      setZoom((prevZoom) => {
        setCenter(([cx, cy]) => {
          const prevSpan = MAP_VB_SIZE / prevZoom;
          const nextSpan = MAP_VB_SIZE / nextZoom;
          const worldTargetX = cx - prevSpan * 0.5 + rx * prevSpan;
          const worldTargetY = cy - prevSpan * 0.5 + ry * prevSpan;
          const nextCx = worldTargetX - (rx - 0.5) * nextSpan;
          const nextCy = worldTargetY - (ry - 0.5) * nextSpan;
          return clampPan(nextCx, nextCy, nextZoom);
        });
        return nextZoom;
      });
    },
    []
  );

  // Smooth non-passive wheel zoom centered on cursor
  useEffect(() => {
    const el = svgContainerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const rx = rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0.5;
      const ry = rect.height > 0 ? Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) : 0.5;
      const factor = Math.exp(-e.deltaY * 0.0016);
      setZoom((prevZoom) => {
        const nextZoom = Math.max(1.0, Math.min(3.6, prevZoom * factor));
        setCenter(([cx, cy]) => {
          const prevSpan = MAP_VB_SIZE / prevZoom;
          const nextSpan = MAP_VB_SIZE / nextZoom;
          const focusX = cx - prevSpan * 0.5 + rx * prevSpan;
          const focusY = cy - prevSpan * 0.5 + ry * prevSpan;
          return clampPan(
            focusX - (rx - 0.5) * nextSpan,
            focusY - (ry - 0.5) * nextSpan,
            nextZoom
          );
        });
        return nextZoom;
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement)?.closest('[data-map-toolbar="true"]')) return;
    dragStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCenterX: center[0],
      startCenterY: center[1],
      movedPx: 0,
    };
    setIsDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic pointer capture errors
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragStateRef.current;
    if (!ds.active || ds.pointerId !== e.pointerId) return;
    const dxPx = e.clientX - ds.startClientX;
    const dyPx = e.clientY - ds.startClientY;
    ds.movedPx = Math.hypot(dxPx, dyPx);

    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const span = MAP_VB_SIZE / zoom;
    const nextCx = ds.startCenterX - (dxPx / rect.width) * span;
    const nextCy = ds.startCenterY - (dyPx / rect.height) * span;
    setCenter(clampPan(nextCx, nextCy, zoom));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current.pointerId === e.pointerId) {
      dragStateRef.current.active = false;
      setIsDragging(false);
    }
  };

  const centerOnPlayer = () => {
    const [mx, my] = worldToMap(livePositions.me.x, livePositions.me.z);
    const targetZoom = Math.max(zoom, 2.05);
    setZoom(targetZoom);
    setCenter(clampPan(mx, my, targetZoom));
  };

  const resetFullMap = () => {
    setZoom(1.0);
    setCenter([MAP_VB_SIZE * 0.5, MAP_VB_SIZE * 0.5]);
  };

  const focusLandmarkOnMap = (lm: LandmarkSpec) => {
    setSelectedId(lm.id);
    const [lx, ly] = worldToMap(lm.position[0], lm.position[2]);
    if (zoom > 1.35) {
      setCenter(clampPan(lx, ly, zoom));
    }
  };

  const handleFastTravel = (lm: LandmarkSpec) => {
    teleportToLandmark(lm.id);
    setActiveModal('none');
    showToast(
      `🛵 Đã đi xe Super Cub 50 tới ${lm.name} (${lm.altitudeASL.toLocaleString('en-US')}m ASL)`
    );
  };

  const selectedLandmark: LandmarkSpec =
    LANDMARK_LIST.find((l) => l.id === selectedId) || LANDMARK_LIST[0];

  const landmarkDistances = useMemo(() => {
    const map: Record<string, number> = {};
    for (const lm of LANDMARK_LIST) {
      map[lm.id] = Math.round(
        Math.hypot(lm.position[0] - livePositions.me.x, lm.position[2] - livePositions.me.z)
      );
    }
    return map;
  }, [livePositions.me.x, livePositions.me.z]);

  const [meSvgX, meSvgY] = worldToMap(livePositions.me.x, livePositions.me.z);
  const [selSvgX, selSvgY] = worldToMap(
    selectedLandmark.position[0],
    selectedLandmark.position[2]
  );

  // Camera gaze angle on map: world gaze is (-sin(cameraYaw), -cos(cameraYaw))
  const gazeWorldX = -Math.sin(livePositions.me.cameraYaw);
  const gazeWorldZ = -Math.cos(livePositions.me.cameraYaw);
  const gazeAngleDeg = (Math.atan2(gazeWorldZ / 550, gazeWorldX / 630) * 180) / Math.PI;

  const span = MAP_VB_SIZE / zoom;
  const vbMinX = center[0] - span * 0.5;
  const vbMinY = center[1] - span * 0.5;
  const invPinScale = 1 / Math.pow(zoom, 0.55);
  const scale100mPx = Math.round((100 / 630) * (MAP_VB_SIZE - 48) * zoom * 0.85);

  return (
    <ModalShell
      title="Bản Đồ Đồi Săn Mây Cầu Đất – Mơ Sương"
      subtitle="Cuộn chuột để phóng to • Kéo để di chuyển bản đồ • Bấm «Đi ngay» hoặc nhấp đúp địa danh để đi xe Cub tới liền"
      maxWidth="min(1180px, 95vw)"
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isDesktop ? 'minmax(540px, 1.52fr) minmax(320px, 0.92fr)' : '1fr',
          gap: '18px',
          alignItems: 'stretch',
        }}
      >
        {/* LEFT: LARGE INTERACTIVE ZOOM/PAN WATERCOLOR HIGHLAND MAP */}
        <div
          ref={svgContainerRef}
          data-dalat-map-canvas="true"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement)?.closest('[data-map-pin="true"]')) return;
            if ((e.target as HTMLElement)?.closest('[data-map-toolbar="true"]')) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const rx = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
            const ry = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
            applyZoomAtRatio(Math.min(3.4, zoom * 1.45), rx, ry);
          }}
          style={{
            borderRadius: '22px',
            overflow: 'hidden',
            border: '1px solid rgba(243, 195, 130, 0.34)',
            boxShadow: 'inset 0 0 36px rgba(20, 14, 10, 0.32), 0 12px 32px rgba(0, 0, 0, 0.28)',
            background: '#EFE5D1',
            position: 'relative',
            minHeight: isDesktop ? '565px' : '400px',
            cursor: isDragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          <svg
            viewBox={`${vbMinX.toFixed(2)} ${vbMinY.toFixed(2)} ${span.toFixed(2)} ${span.toFixed(2)}`}
            preserveAspectRatio="xMidYMid slice"
            style={{ width: '100%', height: '100%', minHeight: isDesktop ? '565px' : '400px', display: 'block' }}
          >
            <defs>
              <radialGradient id="parchmentWash" cx="42%" cy="46%" r="72%">
                <stop offset="0%" stopColor="#F7EFE0" />
                <stop offset="62%" stopColor="#E8DAC0" />
                <stop offset="100%" stopColor="#D4C1A1" />
              </radialGradient>
              <linearGradient id="eastCloudWash" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(255, 224, 182, 0)" />
                <stop offset="42%" stopColor="rgba(255, 214, 165, 0.46)" />
                <stop offset="100%" stopColor="rgba(248, 182, 122, 0.76)" />
              </linearGradient>
              <radialGradient id="teaHillWash" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(96, 148, 98, 0.42)" />
                <stop offset="100%" stopColor="rgba(96, 148, 98, 0)" />
              </radialGradient>
              <radialGradient id="pinkMeadowWash" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(226, 146, 166, 0.46)" />
                <stop offset="100%" stopColor="rgba(226, 146, 166, 0)" />
              </radialGradient>
              <radialGradient id="playerFovGrad" cx="0%" cy="50%" r="100%">
                <stop offset="0%" stopColor="rgba(37, 99, 235, 0.42)" />
                <stop offset="100%" stopColor="rgba(37, 99, 235, 0.0)" />
              </radialGradient>
            </defs>

            {/* Warm Watercolor Paper Base */}
            <rect x="0" y="0" width={MAP_VB_SIZE} height={MAP_VB_SIZE} fill="url(#parchmentWash)" />

            {/* Subtle Cartographic Grid */}
            {[100, 200, 300, 400, 500].map((g) => (
              <g key={g} opacity="0.22">
                <line x1={g} y1="0" x2={g} y2={MAP_VB_SIZE} stroke="#8B775C" strokeWidth="0.6" />
                <line x1="0" y1={g} x2={MAP_VB_SIZE} y2={g} stroke="#8B775C" strokeWidth="0.6" />
              </g>
            ))}

            {/* Eastern Golden Cloud Sea Basin */}
            <rect x="345" y="0" width="255" height={MAP_VB_SIZE} fill="url(#eastCloudWash)" />

            {/* Watercolor Tea Terrace & Pink Grass Washes */}
            <circle cx="332" cy="236" r="122" fill="url(#teaHillWash)" />
            <circle cx="242" cy="175" r="78" fill="url(#pinkMeadowWash)" />
            <circle cx="166" cy="166" r="98" fill="url(#teaHillWash)" />
            <circle cx="198" cy="408" r="88" fill="url(#teaHillWash)" />

            {/* Topographic Contour Ellipses */}
            <ellipse
              cx="338"
              cy="238"
              rx="98"
              ry="80"
              fill="none"
              stroke="rgba(112, 92, 68, 0.24)"
              strokeWidth="1.2"
              strokeDasharray="6 4"
            />
            <ellipse
              cx="338"
              cy="238"
              rx="58"
              ry="45"
              fill="none"
              stroke="rgba(112, 92, 68, 0.32)"
              strokeWidth="1.2"
            />
            <ellipse
              cx="188"
              cy="160"
              rx="68"
              ry="54"
              fill="none"
              stroke="rgba(112, 92, 68, 0.25)"
              strokeWidth="1.2"
            />
            <ellipse
              cx="232"
              cy="342"
              rx="76"
              ry="56"
              fill="none"
              stroke="rgba(112, 92, 68, 0.24)"
              strokeWidth="1.2"
            />

            {/* North: Twin Peaks of Langbiang (2,167m) */}
            <g transform="translate(192, 22)">
              <path
                d="M 0 36 L 32 8 L 58 27 L 90 2 L 128 36 Z"
                fill="rgba(92, 114, 128, 0.28)"
                stroke="#5A6B78"
                strokeWidth="1.4"
              />
              <text
                x="64"
                y="50"
                textAnchor="middle"
                fill="#4D5A66"
                fontSize="10.5"
                fontFamily={UI_FONTS.serif}
                fontStyle="italic"
              >
                ▲ BẮC • Đỉnh Langbiang 2,167m
              </text>
            </g>

            {/* East Sunrise Compass Rose */}
            <g transform="translate(528, 294)">
              <circle r="29" fill="rgba(255, 245, 228, 0.78)" stroke="#B87D44" strokeWidth="1.2" />
              <path
                d="M -12 0 L 14 0 M 6 -6 L 15 0 L 6 6"
                fill="none"
                stroke="#C46D34"
                strokeWidth="2"
              />
              <text x="0" y="-35" textAnchor="middle" fill="#8C4E24" fontSize="10" fontWeight="600">
                ĐÔNG ☀
              </text>
              <text x="0" y="43" textAnchor="middle" fill="#8C4E24" fontSize="9">
                Biển mây bình minh
              </text>
            </g>

            {/* 5 Eastern Cầu Đất Wind Turbines */}
            {TURBINE_WORLD_COORDS.map(([tx, tz], i) => {
              const [sx, sy] = worldToMap(tx, tz);
              return (
                <g key={i} transform={`translate(${sx}, ${sy}) scale(${invPinScale})`} opacity={0.78}>
                  <line x1="0" y1="0" x2="0" y2="17" stroke="#6E6558" strokeWidth="1.7" />
                  <line x1="0" y1="0" x2="0" y2="-10" stroke="#6E6558" strokeWidth="1.4" />
                  <line x1="0" y1="0" x2="8.5" y2="5.5" stroke="#6E6558" strokeWidth="1.4" />
                  <line x1="0" y1="0" x2="-8.5" y2="5.5" stroke="#6E6558" strokeWidth="1.4" />
                  <circle r="2" fill="#6E6558" />
                </g>
              );
            })}

            {/* Red-Basalt Highland Footpaths (TRAIL_SEGMENTS) */}
            {TRAIL_SEGMENTS.map(([ax, az, bx, bz], idx) => {
              const [x1, y1] = worldToMap(ax, az);
              const [x2, y2] = worldToMap(bx, bz);
              return (
                <g key={idx}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="rgba(250, 240, 222, 0.68)"
                    strokeWidth={4.8 * invPinScale}
                    strokeLinecap="round"
                  />
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#B5603E"
                    strokeWidth={2.7 * invPinScale}
                    strokeDasharray={`${5.5 * invPinScale} ${4 * invPinScale}`}
                    strokeLinecap="round"
                  />
                </g>
              );
            })}

            {/* Secondary Cozy POIs (Pink Grass & Campfire) */}
            {EXTRA_POIS.map((poi) => {
              const [px, py] = worldToMap(poi.x, poi.z);
              return (
                <g
                  key={poi.label}
                  transform={`translate(${px}, ${py}) scale(${invPinScale})`}
                  opacity="0.88"
                >
                  <circle r="8.5" fill="rgba(255, 249, 238, 0.85)" stroke="#B88E65" strokeWidth="1" />
                  <text x="0" y="3.5" textAnchor="middle" fontSize="9.5">
                    {poi.icon}
                  </text>
                  <text
                    x="0"
                    y="19"
                    textAnchor="middle"
                    fill="#5C4734"
                    fontSize="8.8"
                    fontWeight="500"
                    style={{ paintOrder: 'stroke', stroke: '#F7EFE0', strokeWidth: '2.5px' }}
                  >
                    {poi.label}
                  </text>
                </g>
              );
            })}

            {/* Direct Waypoint Line from Player -> Selected Landmark */}
            {landmarkDistances[selectedLandmark.id] > 8 && (
              <g>
                <line
                  x1={meSvgX}
                  y1={meSvgY}
                  x2={selSvgX}
                  y2={selSvgY}
                  stroke="#2563EB"
                  strokeOpacity="0.52"
                  strokeWidth={1.8 * invPinScale}
                  strokeDasharray={`${4 * invPinScale} ${4 * invPinScale}`}
                />
                <g
                  transform={`translate(${(meSvgX + selSvgX) * 0.5}, ${(meSvgY + selSvgY) * 0.5}) scale(${invPinScale})`}
                >
                  <rect
                    x="-22"
                    y="-8.5"
                    width="44"
                    height="17"
                    rx="8.5"
                    fill="#1E3A8A"
                    stroke="#FFFFFF"
                    strokeWidth="1.2"
                  />
                  <text
                    x="0"
                    y="3.5"
                    textAnchor="middle"
                    fill="#FFF8EB"
                    fontSize="9"
                    fontFamily={UI_FONTS.mono}
                    fontWeight="600"
                  >
                    {landmarkDistances[selectedLandmark.id]}m
                  </text>
                </g>
              </g>
            )}

            {/* Distant Lantern Beacons */}
            {livePositions.beacons.map((b) => {
              const [bx, by] = worldToMap(b.x, b.z);
              return (
                <circle
                  key={`b-${b.id}`}
                  cx={bx}
                  cy={by}
                  r={3 * invPinScale}
                  fill="#E39A44"
                  opacity={0.7}
                />
              );
            })}

            {/* Nearby Remote Peers with Name Labels */}
            {livePositions.peers.map((p) => {
              const [px, py] = worldToMap(p.x, p.z);
              return (
                <g key={p.id} transform={`translate(${px}, ${py}) scale(${invPinScale})`}>
                  <circle r="8" fill="rgba(46, 125, 104, 0.22)" />
                  <circle r="4.8" fill="#2E7D68" stroke="#FAF4E8" strokeWidth="1.6" />
                  <text
                    x="0"
                    y="-9"
                    textAnchor="middle"
                    fill="#1E463B"
                    fontSize="9"
                    fontWeight="600"
                    style={{ paintOrder: 'stroke', stroke: '#F7EFE0', strokeWidth: '2.6px' }}
                  >
                    {p.name}
                  </text>
                </g>
              );
            })}

            {/* 5 Interactive Landmark Pins (Click to select, Double-Click to Fast Travel!) */}
            {LANDMARK_LIST.map((lm) => {
              const [lx, ly] = worldToMap(lm.position[0], lm.position[2]);
              const active = lm.id === selectedId;
              const discovered = discoveredLandmarks[lm.id];
              return (
                <g
                  key={lm.id}
                  data-map-pin="true"
                  transform={`translate(${lx}, ${ly}) scale(${invPinScale})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dragStateRef.current.movedPx > 6) return;
                    setSelectedId(lm.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleFastTravel(lm);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {active && (
                    <circle
                      r="17"
                      fill="rgba(212, 110, 48, 0.24)"
                      stroke="#C45E26"
                      strokeWidth="1.6"
                    />
                  )}
                  <circle
                    r={active ? '9.2' : '7.4'}
                    fill={active ? '#C85A23' : discovered ? '#C86D36' : '#746A5D'}
                    stroke="#FFF9F0"
                    strokeWidth="2.3"
                  />
                  <circle r="2.6" fill="#FFF9F0" />
                  <text
                    x="0"
                    y="-14"
                    textAnchor="middle"
                    fill={active ? '#7C2D12' : '#261E17'}
                    fontSize={active ? '11.5' : '10.5'}
                    fontWeight={active ? '700' : '600'}
                    style={{ paintOrder: 'stroke', stroke: '#FAF2E1', strokeWidth: '3.4px' }}
                  >
                    {SHORT_LANDMARK_NAMES[lm.id]}
                  </text>
                </g>
              );
            })}

            {/* Live Local Player Marker + Camera View Cone + Directional Arrow */}
            <g transform={`translate(${meSvgX}, ${meSvgY}) scale(${invPinScale})`}>
              {/* Camera Gaze Cone */}
              <g transform={`rotate(${gazeAngleDeg})`}>
                <path
                  d="M 0 0 L 38 -18 A 42 42 0 0 1 38 18 Z"
                  fill="url(#playerFovGrad)"
                />
                <path
                  d="M 11 0 L 4 -4.5 L 6 0 L 4 4.5 Z"
                  fill="#1D4ED8"
                  stroke="#FFFFFF"
                  strokeWidth="0.9"
                />
              </g>
              <circle r="12" fill="rgba(37, 99, 235, 0.2)" />
              <circle r="6.2" fill="#2563EB" stroke="#FFFFFF" strokeWidth="2.3" />
              <text
                x="0"
                y="18"
                textAnchor="middle"
                fill="#1E3A8A"
                fontSize="9.5"
                fontWeight="700"
                style={{ paintOrder: 'stroke', stroke: '#FAF2E1', strokeWidth: '3px' }}
              >
                Bạn
              </text>
            </g>
          </svg>

          {/* TOP-LEFT FLOATING TELEMETRY BADGE */}
          <div
            data-map-toolbar="true"
            style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              padding: '6px 11px',
              borderRadius: '999px',
              background: 'rgba(18, 23, 34, 0.82)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(243, 195, 130, 0.32)',
              color: UI_COLORS.cream,
              fontFamily: UI_FONTS.mono,
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              pointerEvents: 'auto',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: '#3B82F6',
                boxShadow: '0 0 8px rgba(59, 130, 246, 0.85)',
              }}
            />
            <span>Độ cao {gameYToASL(livePositions.me.y).toLocaleString('en-US')}m ASL</span>
            <span style={{ opacity: 0.4 }}>•</span>
            <span style={{ color: UI_COLORS.warmAmber }}>Zoom {zoom.toFixed(1)}×</span>
          </div>

          {/* TOP-RIGHT INTERACTIVE ZOOM & LOCATE TOOLBAR */}
          <div
            data-map-toolbar="true"
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              pointerEvents: 'auto',
              cursor: 'default',
            }}
          >
            <MapControlBtn
              title="Phóng to bản đồ (+)"
              onClick={() => applyZoomAtRatio(zoom * 1.32, 0.5, 0.5)}
              icon={<Plus size={15} />}
            />
            <MapControlBtn
              title="Thu nhỏ bản đồ (-)"
              onClick={() => applyZoomAtRatio(zoom / 1.32, 0.5, 0.5)}
              icon={<Minus size={15} />}
            />
            <MapControlBtn
              title="Định vị vị trí của tôi"
              label="Vị trí tôi"
              onClick={centerOnPlayer}
              icon={<Crosshair size={14} />}
              accent
            />
            <MapControlBtn
              title="Xem toàn cảnh đồi săn mây (1×)"
              label="Toàn đồi"
              onClick={resetFullMap}
              icon={<RotateCcw size={13} />}
            />
          </div>

          {/* BOTTOM-LEFT LEGEND & DYNAMIC SCALE BAR */}
          <div
            data-map-toolbar="true"
            style={{
              position: 'absolute',
              bottom: '12px',
              left: '12px',
              right: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              flexWrap: 'wrap',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                padding: '5px 11px',
                borderRadius: '999px',
                background: 'rgba(18, 23, 34, 0.8)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                color: UI_COLORS.cream,
                fontSize: '10.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#2563EB',
                    border: '1.5px solid #FFF',
                  }}
                />
                Bạn & hướng nhìn
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#C85A23',
                    border: '1.5px solid #FFF',
                  }}
                />
                Địa danh (nhấp đúp đi ngay)
              </span>
              {livePositions.peers.length > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#2E7D68',
                      border: '1.5px solid #FFF',
                    }}
                  />
                  {livePositions.peers.length} bạn quanh đồi
                </span>
              )}
            </div>

            <div
              style={{
                padding: '4px 10px',
                borderRadius: '999px',
                background: 'rgba(18, 23, 34, 0.78)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                color: '#F3DEC0',
                fontFamily: UI_FONTS.mono,
                fontSize: '10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: `${Math.max(28, Math.min(110, scale100mPx))}px`,
                  height: '3px',
                  background: UI_COLORS.warmAmber,
                  borderRadius: '2px',
                }}
              />
              <span>100m</span>
            </div>
          </div>
        </div>

        {/* RIGHT: SELECTED LANDMARK DETAIL & 1-CLICK FAST TRAVEL DIRECTORY */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Active Landmark Hero Card */}
          <div
            style={{
              padding: '16px 18px',
              borderRadius: '18px',
              background:
                'linear-gradient(180deg, rgba(243, 195, 130, 0.1) 0%, rgba(255, 255, 255, 0.04) 100%)',
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
                {selectedLandmark.altitudeASL.toLocaleString('en-US')}m ASL • Cách bạn{' '}
                {landmarkDistances[selectedLandmark.id]}m
              </span>
              <span
                style={{
                  fontSize: '10.5px',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: discoveredLandmarks[selectedLandmark.id]
                    ? 'rgba(130, 214, 158, 0.16)'
                    : 'rgba(255, 255, 255, 0.06)',
                  color: discoveredLandmarks[selectedLandmark.id] ? '#82D69E' : UI_COLORS.mistText,
                }}
              >
                {discoveredLandmarks[selectedLandmark.id] ? 'Đã khám phá' : 'Chưa đặt chân'}
              </span>
            </div>

            <h3
              style={{
                fontFamily: UI_FONTS.serif,
                fontSize: '21px',
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
                marginBottom: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Compass size={13} style={{ color: UI_COLORS.warmAmber, flexShrink: 0 }} />
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
                  'linear-gradient(135deg, rgba(226, 152, 86, 0.94), rgba(196, 112, 68, 0.94))',
                border: '1px solid rgba(255, 226, 182, 0.55)',
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
              <span>Đi xe Super Cub 50 tới ngay</span>
            </button>
          </div>

          {/* All 5 Landmarks Directory with Live Distance + Instant 1-Click Fast Travel */}
          <div>
            <div
              style={{
                fontSize: '11px',
                color: UI_COLORS.mistText,
                letterSpacing: '0.03em',
                marginBottom: '7px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>ĐỊA DANH TRÊN SƯỜN ĐỒI (5)</span>
              <span>Bấm «Đi ngay» để tới liền</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {LANDMARK_LIST.map((lm) => {
                const active = lm.id === selectedId;
                const distM = landmarkDistances[lm.id];
                return (
                  <div
                    key={lm.id}
                    onClick={() => focusLandmarkOnMap(lm)}
                    style={{
                      padding: '8px 10px 8px 12px',
                      borderRadius: '13px',
                      background: active
                        ? 'rgba(243, 195, 130, 0.18)'
                        : 'rgba(255, 255, 255, 0.035)',
                      border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: UI_COLORS.cream,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      cursor: 'pointer',
                      transition: 'background 140ms ease, border-color 140ms ease',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '7px',
                          fontSize: '12.5px',
                          fontWeight: active ? 600 : 500,
                          color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                        }}
                      >
                        <MapPin
                          size={13}
                          style={{
                            color: discoveredLandmarks[lm.id]
                              ? UI_COLORS.warmAmber
                              : UI_COLORS.mutedText,
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {lm.name}
                        </span>
                      </div>
                      <div
                        style={{
                          fontFamily: UI_FONTS.mono,
                          fontSize: '10.5px',
                          color: UI_COLORS.mistText,
                          marginTop: '2px',
                          paddingLeft: '20px',
                        }}
                      >
                        {lm.altitudeASL.toLocaleString('en-US')}m ASL • Cách {distM}m
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFastTravel(lm);
                      }}
                      className="dalat-glass-btn"
                      style={{
                        padding: '6px 10px',
                        borderRadius: '9px',
                        background: active
                          ? 'rgba(243, 195, 130, 0.28)'
                          : 'rgba(255, 255, 255, 0.07)',
                        border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                        color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                        fontSize: '11px',
                        fontWeight: 600,
                        flexShrink: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <Navigation size={11} />
                      <span>Đi ngay</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Online Peers Quick Locator (if any) */}
          {livePositions.peers.length > 0 && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '13px',
                background: 'rgba(46, 125, 104, 0.14)',
                border: '1px solid rgba(130, 214, 158, 0.28)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11.5px',
                  color: '#D8F3E5',
                }}
              >
                <Users size={13} style={{ color: '#82D69E' }} />
                <span>{livePositions.peers.length} bạn đồng hành đang trên đồi</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  const first = livePositions.peers[0];
                  if (!first) return;
                  const [px, py] = worldToMap(first.x, first.z);
                  const z = Math.max(zoom, 2.0);
                  setZoom(z);
                  setCenter(clampPan(px, py, z));
                }}
                className="dalat-glass-btn"
                style={{
                  padding: '4px 9px',
                  borderRadius: '999px',
                  background: 'rgba(130, 214, 158, 0.2)',
                  border: '1px solid rgba(130, 214, 158, 0.45)',
                  color: '#E6FAEF',
                  fontSize: '11px',
                }}
              >
                Xem trên bản đồ
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function MapControlBtn(props: {
  icon: React.ReactNode;
  label?: string;
  title: string;
  accent?: boolean;
  onClick: () => void;
}) {
  const { icon, label, title, accent, onClick } = props;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="dalat-glass-btn"
      style={{
        height: '32px',
        padding: label ? '0 11px' : '0 9px',
        borderRadius: '999px',
        background: accent ? 'rgba(37, 99, 235, 0.88)' : 'rgba(18, 23, 34, 0.84)',
        backdropFilter: 'blur(8px)',
        border: `1px solid ${accent ? 'rgba(147, 197, 253, 0.65)' : 'rgba(243, 195, 130, 0.34)'}`,
        color: accent ? '#FFFFFF' : UI_COLORS.cream,
        fontSize: '11.5px',
        fontWeight: 500,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '5px',
      }}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}
