import { schema, t, MapSchema, type SchemaType } from '@colyseus/schema';
import { DEFAULT_OUTFIT } from '@dalat/protocol';

/**
 * Low-frequency synchronized player metadata via @colyseus/schema v5.
 * High-frequency 12 Hz transforms (x, y, z, yaw, vx, vz, locomotion & vehicle flags)
 * travel over compact 12-byte binary snapshots (`wire.ts`) for minimal GC & bandwidth.
 */
export const PlayerSchema = schema(
  {
    numericId: t.uint16().default(0),
    sessionId: t.string().default(''),
    displayName: t.string().default('Lữ Khách'),
    gender: t.string().default(DEFAULT_OUTFIT.gender || 'female'),
    coatStyle: t.string().default(DEFAULT_OUTFIT.coatStyle),
    coatColor: t.string().default(DEFAULT_OUTFIT.coatColor),
    scarfColor: t.string().default(DEFAULT_OUTFIT.scarfColor),
    headwear: t.string().default(DEFAULT_OUTFIT.headwear),
    neckwear: t.string().default(DEFAULT_OUTFIT.neckwear || 'knit_scarf'),
    eyewear: t.string().default(DEFAULT_OUTFIT.eyewear || 'none'),
    bagStyle: t.string().default(DEFAULT_OUTFIT.bagStyle || 'trek_pack'),
    scooterPaint: t.string().default(DEFAULT_OUTFIT.scooterPaint || 'moss_green'),
    hairColor: t.string().default(DEFAULT_OUTFIT.hairColor),
    backpack: t.boolean().default(DEFAULT_OUTFIT.backpack),
    heldItem: t.string().default('soy_milk'),
    emote: t.string().default('none'),
    seatId: t.string().default(''),
    vehicleId: t.string().default(''),
    vehicleRole: t.string().default(''),
    isBot: t.boolean().default(false),
    // Initial/teleport anchor coordinates so newly-joined clients place peers immediately
    spawnX: t.float32().default(-42),
    spawnY: t.float32().default(135.15),
    spawnZ: t.float32().default(33),
    spawnYaw: t.float32().default(1.35),
  },
  'PlayerSchema'
);

export type PlayerSchema = SchemaType<typeof PlayerSchema>;

/**
 * Synchronized Vintage Honda Super Cub 50 state (5 station scooters + player-summoned scooters).
 * When `driverSessionId` is non-empty, clients lock the scooter's 60 FPS motion to that driver's
 * live/interpolated transform and parent both Driver & Passenger avatars directly onto its anchors!
 */
export const ScooterSchema = schema(
  {
    scooterId: t.string().default(''),
    kind: t.string().default('station'), // 'station' | 'personal'
    ownerSessionId: t.string().default(''),
    paintId: t.string().default('moss_green'),
    plateLabel: t.string().default('49-AA 1968'),
    driverSessionId: t.string().default(''),
    passengerSessionId: t.string().default(''),
    passengerPose: t.string().default('hold_waist'), // 'hold_waist' | 'free_hands'
    headlightOn: t.boolean().default(true),
    parkedX: t.float32().default(0),
    parkedY: t.float32().default(0),
    parkedZ: t.float32().default(0),
    parkedYaw: t.float32().default(0),
  },
  'ScooterSchema'
);

export type ScooterSchema = SchemaType<typeof ScooterSchema>;

export const CloudRoomState = schema(
  {
    roomCode: t.string().default('MAY-01'),
    channelName: t.string().default('Sương Sớm Cầu Đất #1'),
    players: t.map(PlayerSchema),
    occupiedBenches: t.map('string'),
    scooters: t.map(ScooterSchema),
  },
  'CloudRoomState'
);

export type CloudRoomState = SchemaType<typeof CloudRoomState>;
export { MapSchema };

export interface CloudRoomMetadata {
  roomCode: string;
  channelName: string;
  shardIndex: number;
  softCap: number;
  hardCap: number;
}
