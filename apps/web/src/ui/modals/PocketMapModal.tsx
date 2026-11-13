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
import { useViewportLayout } from '../useViewportLayout';
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

const EXTRA_POIS: Array<{ label: string; x: number; z: number; icon: string; minLabelZoom: number }> = [
  { label: 'Đồi Cỏ Hồng', x: -38, z: -122, icon: '🌸', minLabelZoom: 1.0 },
  { label: 'Lửa Trại Đêm', x: -53, z: 24, icon: '🔥', minLabelZoom: 1.38 },
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
  const vp = useViewportLayout();
  const discoveredLandmarks = useGameStore((s) => s.discoveredLandmarks);
  const teleportToLandmark = useGameStore((s) => s.teleportToLandmark);
  const teleportToPeer = useGameStore((s) => s.teleportToPeer);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const showToast = useGameStore((s) => s.showToast);

  const isWideGrid = !vp.isMobileLayout && vp.width >= 900;

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
        isNpc: Boolean(p.isBot || p.sessionId.startsWith('npc-')),
      })),
      beacons: st.farBeacons.map((b) => ({ id: b.numericId, x: b.x, z: b.z })),
    };
  });

  // Default selected landmark to nearest ahead or Cầu Gỗ Săn Mây
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
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchBaseDistRef = useRef<number | null>(null);
  const pinchBaseZoomRef = useRef<number>(1.22);

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
          isNpc: Boolean(p.isBot || p.sessionId.startsWith('npc-')),
        })),
        beacons: st.farBeacons.map((b) => ({ id: b.numericId, x: b.x, z: b.z })),
      });
    }, 220);
    return () => clearInterval(timer);
  }, []);

  const applyZoomAtRatio = useCallback((nextZoomRaw: number, rx = 0.5, ry = 0.5) => {
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
  }, []);

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
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      pinchBaseDistRef.current = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      pinchBaseZoomRef.current = zoom;
      dragStateRef.current.active = false;
      setIsDragging(false);
    } else if (activePointersRef.current.size === 1) {
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
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic pointer capture errors
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    if (activePointersRef.current.size === 2 && pinchBaseDistRef.current !== null) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const midX = (pts[0].x + pts[1].x) * 0.5;
      const midY = (pts[0].y + pts[1].y) * 0.5;
      const rx = Math.max(0, Math.min(1, (midX - rect.left) / rect.width));
      const ry = Math.max(0, Math.min(1, (midY - rect.top) / rect.height));
      const ratio = dist / pinchBaseDistRef.current;
      dragStateRef.current.movedPx = 20;
      applyZoomAtRatio(pinchBaseZoomRef.current * ratio, rx, ry);
      return;
    }

    const ds = dragStateRef.current;
    if (!ds.active || ds.pointerId !== e.pointerId) return;
    const dxPx = e.clientX - ds.startClientX;
    const dyPx = e.clientY - ds.startClientY;
    ds.movedPx = Math.hypot(dxPx, dyPx);

    const span = MAP_VB_SIZE / zoom;
    const nextCx = ds.startCenterX - (dxPx / rect.width) * span;
    const nextCy = ds.startCenterY - (dyPx / rect.height) * span;
    setCenter(clampPan(nextCx, nextCy, zoom));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchBaseDistRef.current = null;
    }
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

  const handleTeleportToFriend = (sessionId: string) => {
    const ok = teleportToPeer(sessionId);
    if (ok) {
      setActiveModal('none');
    }
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

  const sortedPeers = useMemo(() => {
    return [...livePositions.peers].sort((a, b) => {
      if (a.isNpc !== b.isNpc) return a.isNpc ? 1 : -1;
      const da = Math.hypot(a.x - livePositions.me.x, a.z - livePositions.me.z);
      const db = Math.hypot(b.x - livePositions.me.x, b.z - livePositions.me.z);
      return da - db;
    });
  }, [livePositions.peers, livePositions.me.x, livePositions.me.z]);

  const humanPeerCount = sortedPeers.filter((p) => !p.isNpc).length;

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
  const mapMinHeight = vp.isLandscapeMobile ? '260px' : isWideGrid ? '545px' : '320px';

  return (
    <ModalShell
      title="Bản Đồ Đồi Săn Mây Cầu Đất – Mơ Sương"
      subtitle={
        vp.isTouchCapable
          ? 'Chụm 2 ngón để phóng to • Kéo để di chuyển • Bấm «Đi ngay» để đi xe Cub tới liền'
          : 'Cuộn chuột để phóng to • Kéo để di chuyển bản đồ • Bấm «Đi ngay» hoặc nhấp đúp địa danh để đi xe Cub tới liền'
      }
      maxWidth="min(1180px, 95vw)"
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isWideGrid
            ? 'minmax(0, 1.48fr) minmax(0, 0.94fr)'
            : 'minmax(0, 1fr)',
          gap: vp.isMobileLayout ? '14px' : '18px',
          alignItems: 'stretch',
          width: '100%',
          maxWidth: '100%',
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
            minWidth: 0,
            maxWidth: '100%',
            borderRadius: '20px',
            overflow: 'hidden',
            border: '1px solid rgba(243, 195, 130, 0.36)',
            boxShadow: 'inset 0 0 36px rgba(20, 14, 10, 0.32), 0 12px 32px rgba(0, 0, 0, 0.28)',
            background: '#EFE5D1',
            position: 'relative',
            minHeight: mapMinHeight,
            cursor: isDragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          <svg
            viewBox={`${vbMinX.toFixed(2)} ${vbMinY.toFixed(2)} ${span.toFixed(2)} ${span.toFixed(2)}`}
            preserveAspectRatio="xMidYMid slice"
            style={{ width: '100%', height: '100%', minHeight: mapMinHeight, display: 'block' }}
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
                y="52"
                textAnchor="middle"
                fill="#4D5A66"
                fontSize="12"
                fontFamily={UI_FONTS.serif}
                fontStyle="italic"
              >
                ▲ BẮC • Đỉnh Langbiang 2,167m
              </text>
            </g>

            {/* East Sunrise Compass Rose */}
            <g transform="translate(526, 294)">
              <circle r="29" fill="rgba(255, 245, 228, 0.78)" stroke="#B87D44" strokeWidth="1.2" />
              <path
                d="M -12 0 L 14 0 M 6 -6 L 15 0 L 6 6"
                fill="none"
                stroke="#C46D34"
                strokeWidth="2"
              />
              <text x="0" y="-36" textAnchor="middle" fill="#8C4E24" fontSize="12" fontWeight="600">
                ĐÔNG ☀
              </text>
              <text x="0" y="45" textAnchor="middle" fill="#8C4E24" fontSize="12">
                Biển mây
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

            {/* Secondary Cozy POIs (Pink Grass & Campfire — Campfire label reveals on zoom >= 1.38) */}
            {EXTRA_POIS.map((poi) => {
              const [px, py] = worldToMap(poi.x, poi.z);
              const showLabel = zoom >= poi.minLabelZoom;
              return (
                <g
                  key={poi.label}
                  transform={`translate(${px}, ${py}) scale(${invPinScale})`}
                  opacity="0.88"
                >
                  <circle r="9.5" fill="rgba(255, 249, 238, 0.88)" stroke="#B88E65" strokeWidth="1" />
                  <text x="0" y="4" textAnchor="middle" fontSize="12">
                    {poi.icon}
                  </text>
                  {showLabel && (
                    <text
                      x="0"
                      y="22"
                      textAnchor="middle"
                      fill="#5C4734"
                      fontSize="12"
                      fontWeight="500"
                      style={{ paintOrder: 'stroke', stroke: '#F7EFE0', strokeWidth: '2.8px' }}
                    >
                      {poi.label}
                    </text>
                  )}
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
                    x="-26"
                    y="-10"
                    width="52"
                    height="20"
                    rx="10"
                    fill="#1E3A8A"
                    stroke="#FFFFFF"
                    strokeWidth="1.2"
                  />
                  <text
                    x="0"
                    y="4"
                    textAnchor="middle"
                    fill="#FFF8EB"
                    fontSize="12"
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

            {/* Nearby Remote Peers with Human vs Highland NPC Differentiation */}
            {sortedPeers.map((p) => {
              const [px, py] = worldToMap(p.x, p.z);
              const dotFill = p.isNpc ? '#5E8CA8' : '#2E7D68';
              const haloFill = p.isNpc ? 'rgba(94, 140, 168, 0.22)' : 'rgba(46, 125, 104, 0.24)';
              const textFill = p.isNpc ? '#2C495C' : '#1E463B';
              return (
                <g key={p.id} transform={`translate(${px}, ${py}) scale(${invPinScale})`}>
                  <circle r="8.5" fill={haloFill} />
                  <circle r="5" fill={dotFill} stroke="#FAF4E8" strokeWidth="1.6" />
                  <text
                    x="0"
                    y="-10"
                    textAnchor="middle"
                    fill={textFill}
                    fontSize="12"
                    fontWeight="600"
                    style={{ paintOrder: 'stroke', stroke: '#F7EFE0', strokeWidth: '2.8px' }}
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
                    fontSize="12"
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
              <g transform={`rotate(${gazeAngleDeg})`}>
                <path d="M 0 0 L 38 -18 A 42 42 0 0 1 38 18 Z" fill="url(#playerFovGrad)" />
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
                y="20"
                textAnchor="middle"
                fill="#1E3A8A"
                fontSize="12"
                fontWeight="700"
                style={{ paintOrder: 'stroke', stroke: '#FAF2E1', strokeWidth: '3px' }}
              >
                Bạn
              </text>
            </g>
          </svg>

          {/* TOP-RIGHT ZOOM & LOCATE CONTROLS (Keeps upper-left Gác Chè 1927 & Thông Cô Đơn 100% unobstructed) */}
          <div
            data-map-toolbar="true"
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              display: vp.isMobileLayout ? 'grid' : 'flex',
              gridTemplateColumns: vp.isMobileLayout ? 'repeat(2, 44px)' : undefined,
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '6px',
              pointerEvents: 'auto',
              cursor: 'default',
            }}
          >
            <MapControlBtn
              title="Phóng to bản đồ (+)"
              onClick={() => applyZoomAtRatio(zoom * 1.32, 0.5, 0.5)}
              icon={<Plus size={16} />}
            />
            <MapControlBtn
              title="Thu nhỏ bản đồ (-)"
              onClick={() => applyZoomAtRatio(zoom / 1.32, 0.5, 0.5)}
              icon={<Minus size={16} />}
            />
            <MapControlBtn
              title="Định vị vị trí của tôi"
              label={vp.isMobileLayout ? undefined : 'Vị trí tôi'}
              onClick={centerOnPlayer}
              icon={<Crosshair size={15} />}
              accent
            />
            <MapControlBtn
              title="Xem toàn cảnh đồi săn mây (1×)"
              label={vp.isMobileLayout ? undefined : 'Toàn đồi'}
              onClick={resetFullMap}
              icon={<RotateCcw size={15} />}
            />
          </div>

          {/* BOTTOM LEGEND, ALTITUDE/ZOOM TELEMETRY & DYNAMIC SCALE BAR */}
          <div
            data-map-toolbar="true"
            style={{
              position: 'absolute',
              bottom: '10px',
              left: '10px',
              right: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
              flexWrap: 'wrap',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                padding: '5px 10px',
                borderRadius: '999px',
                background: 'rgba(11, 16, 25, 0.88)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                color: UI_COLORS.cream,
                fontSize: '11.5px',
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                maxWidth: '100%',
                boxSizing: 'border-box',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#2563EB',
                    border: '1.5px solid #FFF',
                  }}
                />
                Bạn
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#C85A23',
                    border: '1.5px solid #FFF',
                  }}
                />
                Địa danh
              </span>
              {sortedPeers.length > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#2E7D68',
                      border: '1.5px solid #FFF',
                    }}
                  />
                  {humanPeerCount > 0 ? `${humanPeerCount} bạn` : `${sortedPeers.length} lữ khách`}
                </span>
              )}
            </div>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  padding: '4px 10px',
                  borderRadius: '999px',
                  background: 'rgba(11, 16, 25, 0.88)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(243, 195, 130, 0.36)',
                  color: UI_COLORS.cream,
                  fontFamily: UI_FONTS.mono,
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#3B82F6',
                    flexShrink: 0,
                  }}
                />
                <span>{gameYToASL(livePositions.me.y).toLocaleString('en-US')}m</span>
                <span style={{ opacity: 0.45 }}>•</span>
                <span style={{ color: UI_COLORS.warmAmber }}>{zoom.toFixed(1)}×</span>
              </div>

              {!vp.isMobileLayout && (
                <div
                  style={{
                    padding: '4px 10px',
                    borderRadius: '999px',
                    background: 'rgba(11, 16, 25, 0.88)',
                    border: '1px solid rgba(255, 255, 255, 0.18)',
                    color: '#F3DEC0',
                    fontFamily: UI_FONTS.mono,
                    fontSize: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: `${Math.max(28, Math.min(100, scale100mPx))}px`,
                      height: '3px',
                      background: UI_COLORS.warmAmber,
                      borderRadius: '2px',
                    }}
                  />
                  <span>100m</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: SELECTED LANDMARK DETAIL & 1-CLICK FAST TRAVEL DIRECTORY */}
        <div style={{ minWidth: 0, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Active Landmark Hero Card */}
          <div
            style={{
              padding: '15px 16px',
              borderRadius: '18px',
              background:
                'linear-gradient(180deg, rgba(243, 195, 130, 0.11) 0%, rgba(255, 255, 255, 0.04) 100%)',
              border: `1px solid ${UI_COLORS.borderStrong}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px',
                marginBottom: '6px',
              }}
            >
              <span
                style={{
                  fontFamily: UI_FONTS.mono,
                  fontSize: '12px',
                  color: UI_COLORS.warmAmber,
                }}
              >
                {selectedLandmark.altitudeASL.toLocaleString('en-US')}m ASL • Cách{' '}
                {landmarkDistances[selectedLandmark.id]}m
              </span>
              <span
                style={{
                  fontSize: '12px',
                  padding: '2px 9px',
                  borderRadius: '999px',
                  background: discoveredLandmarks[selectedLandmark.id]
                    ? 'rgba(130, 214, 158, 0.16)'
                    : 'rgba(255, 255, 255, 0.07)',
                  color: discoveredLandmarks[selectedLandmark.id] ? '#82D69E' : UI_COLORS.mistText,
                }}
              >
                {discoveredLandmarks[selectedLandmark.id] ? '✦ Đã đặt chân' : '◌ Chưa tới'}
              </span>
            </div>

            <h3
              style={{
                fontFamily: UI_FONTS.serif,
                fontSize: '20px',
                color: UI_COLORS.cream,
                marginBottom: '6px',
              }}
            >
              {selectedLandmark.name}
            </h3>

            <p
              style={{
                fontSize: '13px',
                lineHeight: 1.5,
                color: UI_COLORS.mistText,
                marginBottom: '10px',
              }}
            >
              {selectedLandmark.subtitle}
            </p>

            <div
              style={{
                fontSize: '12px',
                color: '#F3DEC0',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Compass size={14} style={{ color: UI_COLORS.warmAmber, flexShrink: 0 }} />
              <span>Khung giờ đẹp nhất: {selectedLandmark.bestTimeHint}</span>
            </div>

            <button
              type="button"
              onClick={() => handleFastTravel(selectedLandmark)}
              className="dalat-glass-btn"
              style={{
                width: '100%',
                minHeight: '44px',
                padding: '10px 14px',
                borderRadius: '12px',
                background:
                  'linear-gradient(135deg, rgba(226, 152, 86, 0.96), rgba(196, 112, 68, 0.96))',
                border: '1px solid rgba(255, 226, 182, 0.55)',
                color: '#171D2A',
                fontSize: '13.5px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <Navigation size={15} />
              <span>Đi xe Super Cub 50 tới ngay</span>
            </button>
          </div>

          {/* All 5 Landmarks Directory with Live Distance + Instant 1-Click Fast Travel */}
          <div>
            <div
              style={{
                fontSize: '12px',
                color: UI_COLORS.mistText,
                marginBottom: '7px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '6px',
              }}
            >
              <span style={{ fontWeight: 600 }}>Địa danh trên sườn đồi (5)</span>
              <span>Bấm «Đi ngay» để tới liền</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {LANDMARK_LIST.map((lm) => {
                const active = lm.id === selectedId;
                const distM = landmarkDistances[lm.id];
                return (
                  <div
                    key={lm.id}
                    style={{
                      padding: '8px 10px 8px 12px',
                      borderRadius: '13px',
                      background: active
                        ? 'rgba(243, 195, 130, 0.18)'
                        : 'rgba(255, 255, 255, 0.04)',
                      border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                      color: UI_COLORS.cream,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      boxSizing: 'border-box',
                      minWidth: 0,
                      transition: 'background 140ms ease, border-color 140ms ease',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => focusLandmarkOnMap(lm)}
                      style={{
                        minWidth: 0,
                        flex: 1,
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        textAlign: 'left',
                        cursor: 'pointer',
                        color: 'inherit',
                        fontFamily: 'inherit',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '7px',
                          fontSize: '13px',
                          fontWeight: active ? 600 : 500,
                          color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                        }}
                      >
                        <MapPin
                          size={14}
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
                          fontSize: '12px',
                          color: UI_COLORS.mistText,
                          marginTop: '2px',
                          paddingLeft: '21px',
                        }}
                      >
                        {lm.altitudeASL.toLocaleString('en-US')}m • Cách {distM}m
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFastTravel(lm);
                      }}
                      className="dalat-glass-btn"
                      style={{
                        minHeight: '40px',
                        padding: '6px 11px',
                        borderRadius: '9px',
                        background: active
                          ? 'rgba(243, 195, 130, 0.28)'
                          : 'rgba(255, 255, 255, 0.08)',
                        border: `1px solid ${active ? UI_COLORS.warmAmber : UI_COLORS.border}`,
                        color: active ? UI_COLORS.warmAmber : UI_COLORS.cream,
                        fontSize: '12px',
                        fontWeight: 600,
                        flexShrink: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <Navigation size={12} />
                      <span>Đi ngay</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Companions & Highland Hikers Quick Teleport */}
          {sortedPeers.length > 0 && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '14px',
                background: 'rgba(46, 125, 104, 0.14)',
                border: '1px solid rgba(130, 214, 158, 0.30)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div
                style={{
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
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#D8F3E5',
                  }}
                >
                  <Users size={14} style={{ color: '#82D69E' }} />
                  <span>
                    {humanPeerCount > 0
                      ? `${humanPeerCount} bạn đồng hành & lữ khách quanh đồi`
                      : `${sortedPeers.length} lữ khách đang dạo đồi`}
                  </span>
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {sortedPeers.slice(0, 3).map((peer) => {
                  const dist = Math.round(
                    Math.hypot(peer.x - livePositions.me.x, peer.z - livePositions.me.z)
                  );
                  return (
                    <div
                      key={peer.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        padding: '6px 8px',
                        borderRadius: '10px',
                        background: 'rgba(15, 22, 34, 0.45)',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '12px',
                          color: UI_COLORS.cream,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {peer.isNpc ? '🌲' : '🟢'} {peer.name}{' '}
                        <span style={{ color: UI_COLORS.mistText, fontFamily: UI_FONTS.mono }}>
                          ({dist}m)
                        </span>
                      </span>
                      <button
                        type="button"
                        data-testid={
                          peer.isNpc
                            ? `map-teleport-npc-${peer.id}`
                            : `map-teleport-friend-${peer.id}`
                        }
                        onClick={() => handleTeleportToFriend(peer.id)}
                        className="dalat-glass-btn"
                        style={{
                          minHeight: '40px',
                          padding: '4px 10px',
                          borderRadius: '999px',
                          background: 'rgba(130, 214, 158, 0.22)',
                          border: '1px solid rgba(130, 214, 158, 0.48)',
                          color: '#E6FAEF',
                          fontSize: '12px',
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        🛵 Tới chỗ bạn
                      </button>
                    </div>
                  );
                })}
              </div>
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
        minWidth: '44px',
        minHeight: '44px',
        height: '44px',
        padding: label ? '0 12px' : '0 10px',
        borderRadius: '999px',
        background: accent ? 'rgba(37, 99, 235, 0.90)' : 'rgba(11, 16, 25, 0.90)',
        backdropFilter: 'blur(8px)',
        border: `1px solid ${accent ? 'rgba(147, 197, 253, 0.70)' : 'rgba(243, 195, 130, 0.42)'}`,
        color: accent ? '#FFFFFF' : UI_COLORS.cream,
        fontSize: '12px',
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '5px',
        boxSizing: 'border-box',
      }}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}
