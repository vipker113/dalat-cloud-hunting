import { sampleWalkableHeight, sampleGroundHeight, gameYToASL } from './terrain';
import type { ScooterPaintId } from './types';

export type LandmarkId =
  | 'quan-mo-suong'
  | 'cau-go-san-may'
  | 'cay-thong-co-don'
  | 'dai-ngam-den'
  | 'gac-che-1927';

export interface LandmarkSpec {
  id: LandmarkId;
  name: string;
  subtitle: string;
  position: [number, number, number];
  lookAt: [number, number, number];
  altitudeASL: number;
  bestTimeHint: string;
  isHiddenSpot?: boolean;
}

function makeLandmark(
  id: LandmarkId,
  name: string,
  subtitle: string,
  x: number,
  z: number,
  lookAt: [number, number, number],
  bestTimeHint: string,
  isHiddenSpot = false
): LandmarkSpec {
  const y = sampleWalkableHeight(x, z);
  return {
    id,
    name,
    subtitle,
    position: [x, y, z],
    lookAt,
    altitudeASL: gameYToASL(y),
    bestTimeHint,
    isHiddenSpot,
  };
}

export const LANDMARKS: Record<LandmarkId, LandmarkSpec> = {
  'quan-mo-suong': makeLandmark(
    'quan-mo-suong',
    'Tiệm Cà Phê Gỗ "Mơ Sương"',
    'Hiên gỗ lưng đồi, phin cà phê nóng, bếp lửa hồng & góc Guitar Acoustic',
    -30.8,
    32.5,
    [185, 146, -25],
    '04:30 – 07:00 AM & Chiều sương'
  ),
  'cau-go-san-may': makeLandmark(
    'cau-go-san-may',
    'Cầu Gỗ Săn Mây Cầu Đất',
    'Đỉnh đồi chè cổ 1927 hướng thẳng Mặt Trời mọc & 5 tua-bin điện gió',
    89,
    -75,
    [260, 215, -75],
    '05:05 – 06:30 AM (Khoảnh khắc Vàng)'
  ),
  'cay-thong-co-don': makeLandmark(
    'cay-thong-co-don',
    'Đồi Thông Cô Đơn Thiên Phúc Đức',
    'Cây thông nghiêng gió treo thẻ ước nguyện nhìn về núi đôi Langbiang 2.167m',
    -94.5,
    -140.5,
    [-96, 198, -420],
    '05:20 – 06:45 AM (Nắng xiên ngang)'
  ),
  'dai-ngam-den': makeLandmark(
    'dai-ngam-den',
    'Đài Ngắm Thung Lũng Đèn & Dốc Dã Quỳ',
    'Rìa sương sớm bên xe Super Cub 50 nhìn xuống biển đèn vàng nhà lồng Thái Phiên',
    21.6,
    125.8,
    [195, 24, 108],
    '04:15 – 05:15 AM (Trước rạng đông)'
  ),
  'gac-che-1927': makeLandmark(
    'gac-che-1927',
    'Hõm Cỏ Tuyết & Gác Chè Cổ 1927',
    'Điểm ẩn khuất gió nơi thảm cỏ sương trắng chuyển hồng phấn khi chạm nắng đầu',
    -12,
    -174,
    [160, 178, -140],
    '05:10 – 06:00 AM (Điểm ẩn)',
    true
  ),
};

export const LANDMARK_LIST: LandmarkSpec[] = Object.values(LANDMARKS);

export interface BenchSpot {
  id: string;
  label: string;
  position: [number, number, number];
  yaw: number;
}

export const SHARED_BENCHES: BenchSpot[] = [
  {
    id: 'bench-cafe-1',
    label: 'Ghế đôi hiên Mơ Sương #1',
    position: [-27.5, sampleWalkableHeight(-27.5, 25), 25],
    yaw: Math.PI / 2,
  },
  {
    id: 'bench-cafe-2',
    label: 'Ghế đôi hiên Mơ Sương #2',
    position: [-27.5, sampleWalkableHeight(-27.5, 35.5), 35.5],
    yaw: Math.PI / 2,
  },
  {
    id: 'bench-fire-1',
    label: 'Ghế gỗ bên bếp lửa Guitar',
    position: [-55, sampleWalkableHeight(-55, 23), 23],
    yaw: 0.55,
  },
  {
    id: 'bench-pier-1',
    label: 'Băng ghế ngắm bình minh Cầu Đất',
    position: [88, sampleWalkableHeight(88, -79.2), -79.2],
    yaw: Math.PI / 2,
  },
  {
    id: 'bench-pine-1',
    label: 'Ghế dưới tán Thông Cô Đơn',
    position: [-98, sampleWalkableHeight(-98, -154), -154],
    yaw: Math.PI,
  },
];

export const BENCH_SEAT_LATERAL_OFFSET = 0.34;

export function parseBenchSeatId(rawSeatOrBenchId: string): {
  benchId: string;
  slotIndex: 0 | 1;
} {
  const cleaned = (rawSeatOrBenchId || '').trim();
  if (cleaned.endsWith(':1')) {
    return { benchId: cleaned.slice(0, -2), slotIndex: 1 };
  }
  if (cleaned.endsWith(':0')) {
    return { benchId: cleaned.slice(0, -2), slotIndex: 0 };
  }
  return { benchId: cleaned, slotIndex: 0 };
}

export function resolveBenchSeatTransform(rawSeatOrBenchId: string): {
  bench: BenchSpot;
  seatId: string;
  slotIndex: 0 | 1;
  position: [number, number, number];
  yaw: number;
} | null {
  const { benchId, slotIndex } = parseBenchSeatId(rawSeatOrBenchId);
  const bench = SHARED_BENCHES.find((b) => b.id === benchId);
  if (!bench) return null;
  const lateral = (slotIndex === 0 ? -1 : 1) * BENCH_SEAT_LATERAL_OFFSET;
  const x = bench.position[0] + Math.cos(bench.yaw) * lateral;
  const z = bench.position[2] - Math.sin(bench.yaw) * lateral;
  return {
    bench,
    seatId: `${bench.id}:${slotIndex}`,
    slotIndex,
    position: [x, bench.position[1], z],
    yaw: bench.yaw,
  };
}

export interface StationScooterSpec {
  scooterId: string;
  label: string;
  paintId: ScooterPaintId;
  plateLabel: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export const STATION_SCOOTERS: ReadonlyArray<StationScooterSpec> = [
  {
    scooterId: 'cub-station-cafe-1',
    label: 'Super Cub 50 Đầu Đường Đất Đỏ Mơ Sương #1',
    paintId: 'moss_green',
    plateLabel: '49-AA 1968',
    x: -51.2,
    y: sampleGroundHeight(-51.2, 42.2),
    z: 42.2,
    yaw: -0.04,
  },
  {
    scooterId: 'cub-station-cafe-2',
    label: 'Super Cub 50 Đầu Đường Đất Đỏ Mơ Sương #2',
    paintId: 'mist_cream',
    plateLabel: '49-AB 1979',
    x: -51.2,
    y: sampleGroundHeight(-51.2, 45.6),
    z: 45.6,
    yaw: -0.04,
  },
  {
    scooterId: 'cub-station-den-1',
    label: 'Super Cub 50 Đài Ngắm Đèn',
    paintId: 'moss_green',
    plateLabel: '49-AA 0520',
    x: 19.8,
    y: sampleGroundHeight(19.8, 125.2),
    z: 125.2,
    yaw: 0.88,
  },
  {
    scooterId: 'cub-station-cau-go-1',
    label: 'Super Cub 50 Đầu Cầu Gỗ Cầu Đất',
    paintId: 'plum_red',
    plateLabel: '49-AC 1927',
    x: 46.2,
    y: sampleGroundHeight(46.2, -72.5),
    z: -72.5,
    yaw: 1.52,
  },
  {
    scooterId: 'cub-station-thong-1',
    label: 'Super Cub 50 Đồi Thông Cô Đơn',
    paintId: 'peace_blue',
    plateLabel: '49-AD 2167',
    x: -89.5,
    y: sampleGroundHeight(-89.5, -138.0),
    z: -138.0,
    yaw: -0.45,
  },
];

export const LANDMARK_SCOOTER_PARKING: Record<
  LandmarkId,
  { x: number; y: number; z: number; yaw: number }
> = {
  'quan-mo-suong': {
    x: -51.0,
    y: sampleGroundHeight(-51.0, 48.6),
    z: 48.6,
    yaw: -0.04,
  },
  'cau-go-san-may': {
    x: 44.8,
    y: sampleGroundHeight(44.8, -74.5),
    z: -74.5,
    yaw: Math.PI / 2,
  },
  'cay-thong-co-don': {
    x: -89.5,
    y: sampleGroundHeight(-89.5, -139.5),
    z: -139.5,
    yaw: -0.35,
  },
  'dai-ngam-den': {
    x: 23.2,
    y: sampleGroundHeight(23.2, 124.2),
    z: 124.2,
    yaw: 1.65,
  },
  'gac-che-1927': {
    x: -12.5,
    y: sampleGroundHeight(-12.5, -172.0),
    z: -172.0,
    yaw: 1.35,
  },
};

export interface PedestrianZoneCheck {
  inside: boolean;
  pushX: number;
  pushZ: number;
  zoneLabel: string;
}

/**
 * Checks whether (x, z) intrudes into one of the 3 peaceful wooden pedestrian sanctuaries
 * (Cầu Gỗ Săn Mây, Hiên Gỗ Tiệm Cà Phê Mơ Sương, Vòng Bếp Lửa Acoustic) and returns a smooth
 * outward boundary normal + clamped position so scooters stop politely outside!
 */
export function checkPedestrianDeckZone(x: number, z: number): PedestrianZoneCheck {
  // 1. Cầu Gỗ Săn Mây Cầu Đất wooden pier & eastern viewing deck (x in [50.2, 102.5], z in [-81.2, -68.8])
  if (x >= 50.2 && x <= 102.5 && z >= -81.2 && z <= -68.8) {
    const dWest = x - 50.2;
    const distNorth = z - -81.2;
    const distSouth = -68.8 - z;
    if (dWest <= distNorth && dWest <= distSouth) {
      return {
        inside: true,
        pushX: 50.05,
        pushZ: z,
        zoneLabel: 'Cầu Gỗ Săn Mây Cầu Đất',
      };
    }
    if (distNorth < distSouth) {
      return {
        inside: true,
        pushX: x,
        pushZ: -81.35,
        zoneLabel: 'Cầu Gỗ Săn Mây Cầu Đất',
      };
    }
    return {
      inside: true,
      pushX: x,
      pushZ: -68.65,
      zoneLabel: 'Cầu Gỗ Săn Mây Cầu Đất',
    };
  }

  // 2. Hiên Gỗ Tiệm Cà Phê Mơ Sương wooden veranda & cabin (x in [-52.2, -24.2], z in [19.4, 40.6])
  // Note: East edge (x = -24.4) is a raised cliff railing, so push out toward the flat South/North/West courtyard!
  if (x >= -52.2 && x <= -24.2 && z >= 19.4 && z <= 40.6) {
    const dWest = x - -52.2;
    const dNorth = z - 19.4;
    const dSouth = 40.6 - z;
    const m = Math.min(dWest, dNorth, dSouth);
    if (m === dSouth) {
      return {
        inside: true,
        pushX: Math.min(-26.5, x),
        pushZ: 41.1,
        zoneLabel: 'Hiên Gỗ Tiệm Cà Phê Mơ Sương',
      };
    }
    if (m === dNorth) {
      return {
        inside: true,
        pushX: Math.min(-26.5, x),
        pushZ: 18.9,
        zoneLabel: 'Hiên Gỗ Tiệm Cà Phê Mơ Sương',
      };
    }
    return { inside: true, pushX: -52.6, pushZ: z, zoneLabel: 'Hiên Gỗ Tiệm Cà Phê Mơ Sương' };
  }

  // 3. Acoustic Campfire Guitar Circle at [-53, 24], radius 4.6m
  const dx = x - -53.0;
  const dz = z - 24.0;
  const rSq = dx * dx + dz * dz;
  if (rSq < 4.6 * 4.6) {
    const r = Math.sqrt(rSq) || 0.001;
    return {
      inside: true,
      pushX: -53.0 + (dx / r) * 4.7,
      pushZ: 24.0 + (dz / r) * 4.7,
      zoneLabel: 'Vòng Bếp Lửa Acoustic',
    };
  }

  return { inside: false, pushX: x, pushZ: z, zoneLabel: '' };
}
