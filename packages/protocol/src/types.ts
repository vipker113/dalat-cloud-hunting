export type WeatherStateId =
  | 'golden_cloud_sea'
  | 'morning_mist_boil'
  | 'clear_highland_sun'
  | 'cloudy_breeze'
  | 'deep_evening_fog'
  | 'light_drizzle';

export type HeldItemId =
  | 'none'
  | 'soy_milk'
  | 'phin_coffee'
  | 'roasted_corn'
  | 'sweet_potato'
  | 'hydrangea_bouquet'
  | 'da_quy_bouquet'
  | 'film_camera'
  | 'lantern'
  | 'sparkler'
  | 'guitar';

export type EmoteId =
  | 'none'
  | 'wave'
  | 'warm_hands'
  | 'sip_drink'
  | 'sit_chill'
  | 'snap_photo'
  | 'play_guitar'
  | 'cheers_cup'
  | 'cheer_sunrise';

export type AvatarGender = 'female' | 'male';

export type CoatStyleId =
  | 'wool_trench'
  | 'knit_sweater'
  | 'sherpa_cape'
  | 'highland_poncho'
  | 'cardigan_vest'
  | 'velvet_cloak'
  | 'puffer_vest'
  | 'quilted_gilet'
  | 'vintage_poncho'
  | 'duffle_parka'
  | 'corduroy_safari'
  | 'tweed_overcoat';

export type HeadwearId =
  | 'beanie'
  | 'beret'
  | 'bucket_hat'
  | 'fedora_wool'
  | 'straw_boater'
  | 'non_la'
  | 'earmuffs'
  | 'flower_crown'
  | 'cat_beanie'
  | 'scarf_only'
  | 'none';

export type NeckwearId = 'knit_scarf' | 'plaid_shawl' | 'bandana' | 'camera_strap' | 'none';

export type EyewearId =
  | 'none'
  | 'round_vintage'
  | 'sun_amber'
  | 'retro_tortoise'
  | 'rose_tinted'
  | 'blush_cheeks';

export type BagStyleId =
  | 'trek_pack'
  | 'leather_satchel'
  | 'rattan_basket'
  | 'canvas_tote'
  | 'guitar_case'
  | 'none';

export interface PlayerOutfit {
  gender?: AvatarGender;
  coatStyle: CoatStyleId;
  coatColor: string;
  scarfColor: string;
  headwear: HeadwearId;
  neckwear?: NeckwearId;
  eyewear?: EyewearId;
  bagStyle?: BagStyleId;
  hairColor: string;
  backpack: boolean;
}

export interface CatalogItemMeta<T extends string> {
  id: T;
  title: string;
  shortLabel: string;
  desc: string;
  gender?: AvatarGender;
}

export const COAT_CATALOG: ReadonlyArray<CatalogItemMeta<CoatStyleId>> = [
  // Trang phục Nữ (6 mẫu)
  { id: 'wool_trench', title: 'Măng-tô dạ', shortLabel: 'Măng-tô dạ', desc: 'Thắt đai hai hàng cúc', gender: 'female' },
  { id: 'knit_sweater', title: 'Áo len dạo phố', shortLabel: 'Áo len đan', desc: 'Mềm mại sương mai', gender: 'female' },
  { id: 'sherpa_cape', title: 'Choàng lông cừu', shortLabel: 'Choàng cừu', desc: 'Khuy gỗ ấm vai', gender: 'female' },
  { id: 'highland_poncho', title: 'Poncho thổ cẩm', shortLabel: 'Poncho nữ', desc: 'Tua rua cao nguyên', gender: 'female' },
  { id: 'cardigan_vest', title: 'Gile len cổ nơ', shortLabel: 'Gile cổ nơ', desc: 'Nơ lụa & cúc gỗ thông', gender: 'female' },
  { id: 'velvet_cloak', title: 'Áo dạ cổ sen', shortLabel: 'Áo cổ sen', desc: 'Cổ sen đôi & túi ấm', gender: 'female' },
  // Trang phục Nam (6 mẫu)
  { id: 'puffer_vest', title: 'Áo khoác gió', shortLabel: 'Khoác gió', desc: 'Leo dốc săn mây', gender: 'male' },
  { id: 'quilted_gilet', title: 'Gile phao chần', shortLabel: 'Gile phao', desc: 'Chần bông giữ nhiệt', gender: 'male' },
  { id: 'vintage_poncho', title: 'Poncho du mục', shortLabel: 'Poncho nam', desc: 'Choàng dạ sườn đồi', gender: 'male' },
  { id: 'duffle_parka', title: 'Parka khuy sừng', shortLabel: 'Parka mũ', desc: 'Mũ viền lông ấm', gender: 'male' },
  { id: 'corduroy_safari', title: 'Jacket nhung tăm', shortLabel: 'Jacket nhung', desc: 'Cổ cừu 4 túi hộp', gender: 'male' },
  { id: 'tweed_overcoat', title: 'Măng-tô Tweed', shortLabel: 'Măng-tô nam', desc: 'Dạ cổ điển hai hàng cúc', gender: 'male' },
];

export const HEADWEAR_CATALOG: ReadonlyArray<CatalogItemMeta<HeadwearId>> = [
  { id: 'beanie', title: 'Mũ quả bông', shortLabel: 'Mũ quả bông', desc: 'Len dày giữ ấm' },
  { id: 'beret', title: 'Mũ nồi Pháp', shortLabel: 'Mũ nồi Pháp', desc: 'Hoài cổ Đà Lạt' },
  { id: 'bucket_hat', title: 'Mũ tai bèo', shortLabel: 'Mũ tai bèo', desc: 'Vải bố dã ngoại' },
  { id: 'fedora_wool', title: 'Mũ phớt dạ', shortLabel: 'Mũ phớt dạ', desc: 'Vành rộng lãng tử' },
  { id: 'straw_boater', title: 'Mũ cói hoa cúc', shortLabel: 'Mũ cói hoa', desc: 'Nắng sớm đồi chè' },
  { id: 'non_la', title: 'Nón lá sương mai', shortLabel: 'Nón lá', desc: 'Quai lụa truyền thống' },
  { id: 'earmuffs', title: 'Chụp tai lông cừu', shortLabel: 'Chụp tai ấm', desc: 'Bông mềm che gió' },
  { id: 'flower_crown', title: 'Vòng hoa Dã Quỳ', shortLabel: 'Vòng Dã Quỳ', desc: 'Hoa dại cao nguyên' },
  { id: 'cat_beanie', title: 'Mũ len tai mèo', shortLabel: 'Mũ tai mèo', desc: 'Len gân dễ thương' },
  { id: 'none', title: 'Tóc tự nhiên', shortLabel: 'Tóc tự nhiên', desc: 'Gió sương tự do' },
];

export const NECKWEAR_CATALOG: ReadonlyArray<CatalogItemMeta<NeckwearId>> = [
  { id: 'knit_scarf', title: 'Khăn len ống', shortLabel: 'Khăn len ống', desc: 'Quấn ấm quanh cổ' },
  { id: 'plaid_shawl', title: 'Khăn dạ thả tà', shortLabel: 'Khăn thả tà', desc: 'Tua rua bay gió' },
  { id: 'bandana', title: 'Khăn rằn cổ', shortLabel: 'Khăn rằn', desc: 'Thắt nút dã ngoại' },
  { id: 'camera_strap', title: 'Máy ảnh đeo cổ', shortLabel: 'Máy ảnh cổ', desc: 'Dây da nhiếp ảnh' },
  { id: 'none', title: 'Cổ áo thoáng', shortLabel: 'Không khăn', desc: 'Không quàng khăn' },
];

export const EYEWEAR_CATALOG: ReadonlyArray<CatalogItemMeta<EyewearId>> = [
  { id: 'none', title: 'Không đeo kính', shortLabel: 'Tự nhiên', desc: 'Ánh nhìn tự nhiên' },
  { id: 'round_vintage', title: 'Kính tròn thư sinh', shortLabel: 'Kính tròn', desc: 'Gọng vàng mảnh' },
  { id: 'sun_amber', title: 'Kính râm hổ phách', shortLabel: 'Kính hổ phách', desc: 'Đón nắng bình minh' },
  { id: 'retro_tortoise', title: 'Kính gọng đồi mồi', shortLabel: 'Gọng đồi mồi', desc: 'Cổ điển Đà Lạt' },
  { id: 'rose_tinted', title: 'Kính hồng sương', shortLabel: 'Kính hồng', desc: 'Tròng hồng mơ màng' },
  { id: 'blush_cheeks', title: 'Má ửng sương lạnh', shortLabel: 'Má hồng lạnh', desc: 'Má ửng & băng mũi' },
];

export const BAG_CATALOG: ReadonlyArray<CatalogItemMeta<BagStyleId>> = [
  { id: 'trek_pack', title: 'Balo cuộn chăn', shortLabel: 'Balo cuộn chăn', desc: 'Dã ngoại săn mây' },
  { id: 'leather_satchel', title: 'Balo da cổ điển', shortLabel: 'Balo da nâu', desc: 'Khóa đồng hai dây' },
  { id: 'rattan_basket', title: 'Giỏ mây đầy hoa', shortLabel: 'Giỏ mây hoa', desc: 'Dã Quỳ & Cẩm Tú Cầu' },
  { id: 'canvas_tote', title: 'Túi vải đeo chéo', shortLabel: 'Túi đeo chéo', desc: 'Vải mộc tiệm cà phê' },
  { id: 'guitar_case', title: 'Bao đàn du ca', shortLabel: 'Bao đàn lưng', desc: 'Đeo chéo sau lưng' },
  { id: 'none', title: 'Không đeo túi', shortLabel: 'Không đeo túi', desc: 'Nhẹ bước dạo đồi' },
];

export const HELD_PROP_CATALOG: ReadonlyArray<CatalogItemMeta<HeldItemId>> = [
  { id: 'soy_milk', title: 'Sữa đậu nành nóng', shortLabel: 'Sữa đậu nành', desc: 'Ly nóng bốc khói' },
  { id: 'phin_coffee', title: 'Cà phê phin sữa', shortLabel: 'Phin cà phê', desc: 'Thơm nồng hiên gỗ' },
  { id: 'roasted_corn', title: 'Bắp nướng mỡ hành', shortLabel: 'Bắp nướng', desc: 'Đặc sản sương đêm' },
  { id: 'sweet_potato', title: 'Khoai mật nướng', shortLabel: 'Khoai nướng', desc: 'Vàng ươm bốc khói' },
  { id: 'hydrangea_bouquet', title: 'Bó Cẩm Tú Cầu', shortLabel: 'Hoa Tú Cầu', desc: 'Giấy kraft Đà Lạt' },
  { id: 'da_quy_bouquet', title: 'Nhành hoa Dã Quỳ', shortLabel: 'Hoa Dã Quỳ', desc: 'Vàng rực triền đồi' },
  { id: 'lantern', title: 'Đèn bão đồng ấm', shortLabel: 'Đèn bão đồng', desc: 'Thắp sáng lối sương' },
  { id: 'film_camera', title: 'Máy ảnh phim 35mm', shortLabel: 'Máy ảnh 35mm', desc: 'Chụp ảnh Polaroid' },
  { id: 'sparkler', title: 'Pháo sáng bình minh', shortLabel: 'Pháo sáng', desc: 'Lấp lánh đón mây' },
  { id: 'guitar', title: 'Đàn Guitar thông', shortLabel: 'Guitar thông', desc: 'Hòa âm bên lửa' },
  { id: 'none', title: 'Thả tay tự do', shortLabel: 'Thả tay', desc: 'Rảnh tay dạo bước' },
];

export function getCoatGender(coatStyle: CoatStyleId): AvatarGender {
  switch (coatStyle) {
    case 'puffer_vest':
    case 'quilted_gilet':
    case 'vintage_poncho':
    case 'duffle_parka':
    case 'corduroy_safari':
    case 'tweed_overcoat':
      return 'male';
    case 'wool_trench':
    case 'knit_sweater':
    case 'sherpa_cape':
    case 'highland_poncho':
    case 'cardigan_vest':
    case 'velvet_cloak':
    default:
      return 'female';
  }
}

export function resolveEffectiveGender(outfit: PlayerOutfit): AvatarGender {
  if (outfit.gender === 'female' || outfit.gender === 'male') {
    return outfit.gender;
  }
  return getCoatGender(outfit.coatStyle);
}

export function getCoatsForGender(
  gender: AvatarGender
): ReadonlyArray<CatalogItemMeta<CoatStyleId>> {
  return COAT_CATALOG.filter((c) => c.gender === gender);
}

export function ensureCoatMatchesGender(
  coatStyle: CoatStyleId,
  targetGender: AvatarGender
): CoatStyleId {
  if (getCoatGender(coatStyle) === targetGender) {
    return coatStyle;
  }
  const currentList = getCoatsForGender(getCoatGender(coatStyle));
  const targetList = getCoatsForGender(targetGender);
  const idx = Math.max(
    0,
    currentList.findIndex((c) => c.id === coatStyle)
  );
  return (targetList[idx] ?? targetList[0]).id;
}

export function resolveEffectiveNeckwear(outfit: PlayerOutfit): NeckwearId {
  if (outfit.neckwear) return outfit.neckwear;
  if (outfit.headwear === 'none') return 'none';
  return 'knit_scarf';
}

export function resolveEffectiveBagStyle(outfit: PlayerOutfit): BagStyleId {
  if (outfit.bagStyle) return outfit.bagStyle;
  return outfit.backpack ? 'trek_pack' : 'none';
}

export function resolveEffectiveEyewear(outfit: PlayerOutfit): EyewearId {
  return outfit.eyewear ?? 'none';
}

export function isWarmEdibleOrDrinkProp(item: HeldItemId): boolean {
  return (
    item === 'soy_milk' ||
    item === 'phin_coffee' ||
    item === 'roasted_corn' ||
    item === 'sweet_potato'
  );
}

export interface PolaroidEntry {
  id: string;
  authorName: string;
  caption: string;
  landmarkId: string;
  landmarkName: string;
  weatherId: WeatherStateId;
  gameTimeLabel: string;
  altitudeASL: number;
  imageDataUrl: string;
  likes: number;
  createdAt: number;
}

export interface WindChimeNote {
  id: string;
  authorName: string;
  message: string;
  createdAt: number;
}

export interface ChatBubbleMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

export interface AcousticJamNote {
  senderId: string;
  senderName: string;
  chordIndex: number; // 0..5 pentatonic/major highland progression
  instrument: 'guitar' | 'cajon' | 'chime';
  timestamp: number;
}

export const WORLD_CONSTANTS = {
  HALF_SIZE: 450, // 900m x 900m [-450, +450]
  BASE_ASL_METERS: 1450, // Y=0 -> 1,450m ASL
  CYCLE_DURATION_MS: 30 * 60 * 1000, // 30 real minutes = 24 in-game hours (:00 and :30)
  SOFT_ROOM_CAP: 35,
  HARD_ROOM_CAP: 50,
  EVENT_ROOM_CAP: 100,
  NET_TICK_HZ: 12,
  INTERPOLATION_DELAY_MS: 130,
  PROXIMITY_CHAT_RADIUS: 35,
  MAX_WALK_SPEED: 4.1,
  MAX_RUN_SPEED: 7.4,
} as const;

export const DEFAULT_OUTFIT: PlayerOutfit = {
  gender: 'female',
  coatStyle: 'wool_trench',
  coatColor: '#C87D55',
  scarfColor: '#E8D5B7',
  headwear: 'beanie',
  neckwear: 'knit_scarf',
  eyewear: 'none',
  bagStyle: 'trek_pack',
  hairColor: '#2B211B',
  backpack: true,
};

export const HIGHLAND_PALETTE = {
  coats: [
    '#C87D55', // Đất nung cam ấm
    '#4A6B5D', // Rêu thông sương
    '#6E5A7A', // Tím oải hương trầm
    '#D9A441', // Vàng Dã Quỳ
    '#3B526B', // Xanh lam khói đồi
    '#A64B4B', // Đỏ hồng giòn
    '#7C6A56', // Nâu cà phê rang
    '#D8CBB8', // Kem yến mạch
    '#B97A8B', // Hồng đất sương mai
    '#6D8764', // Xanh trà Cầu Đất
    '#52688F', // Xanh denim mờ sương
    '#363942', // Xám than dạ cổ điển
  ],
  scarves: [
    '#E8D5B7', // Kem len mộc
    '#C94A38', // Đỏ cam hồng chín
    '#E09F3E', // Vàng mật ong
    '#5E8C6A', // Xanh lá trà
    '#6B8CAE', // Xanh sương sớm
    '#F2E9E4', // Trắng mây bông
    '#9E8AC4', // Tím Cẩm Tú Cầu
    '#B85D3B', // Nâu quế hồi
    '#355849', // Xanh thông già
    '#D4849A', // Hồng phấn cỏ tuyết
  ],
  hair: [
    '#231B18', // Đen gỗ mun
    '#4A3326', // Nâu hạt dẻ
    '#6E4730', // Nâu quế ấm
    '#8C6239', // Nâu vàng mật
    '#2C3545', // Đen ánh xanh đêm
    '#7D3828', // Đỏ đồng trầm
    '#B8AFA6', // Bạc khói sương
    '#5E3A46', // Nâu ánh tím trầm
  ],
} as const;
