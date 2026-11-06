export type WeatherStateId =
  | 'golden_cloud_sea'
  | 'morning_mist_boil'
  | 'clear_highland_sun'
  | 'cloudy_breeze'
  | 'deep_evening_fog'
  | 'light_drizzle';

export type HeldItemId = 'none' | 'soy_milk' | 'phin_coffee' | 'film_camera' | 'lantern' | 'guitar';

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

export type CoatStyleId = 'wool_trench' | 'knit_sweater' | 'puffer_vest' | 'vintage_poncho';
export type HeadwearId = 'beanie' | 'beret' | 'scarf_only' | 'none';

export interface PlayerOutfit {
  coatStyle: CoatStyleId;
  coatColor: string;
  scarfColor: string;
  headwear: HeadwearId;
  hairColor: string;
  backpack: boolean;
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
  MAX_WALK_SPEED: 2.8,
  MAX_RUN_SPEED: 5.4,
} as const;

export const DEFAULT_OUTFIT: PlayerOutfit = {
  coatStyle: 'wool_trench',
  coatColor: '#C87D55',
  scarfColor: '#E8D5B7',
  headwear: 'beanie',
  hairColor: '#2B211B',
  backpack: true,
};

export const HIGHLAND_PALETTE = {
  coats: ['#C87D55', '#4A6B5D', '#6E5A7A', '#D9A441', '#3B526B', '#A64B4B', '#7C6A56', '#D8CBB8'],
  scarves: ['#E8D5B7', '#C94A38', '#E09F3E', '#5E8C6A', '#6B8CAE', '#F2E9E4'],
  hair: ['#231B18', '#4A3326', '#6E4730', '#8C6239', '#2C3545'],
} as const;
