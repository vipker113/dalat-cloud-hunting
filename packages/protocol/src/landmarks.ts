import { sampleWalkableHeight, gameYToASL } from './terrain';

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
