import { schema, t, MapSchema, type SchemaType } from '@colyseus/schema';
import { DEFAULT_OUTFIT } from '@dalat/protocol';

/**
 * Low-frequency synchronized player metadata via @colyseus/schema v5.
 * High-frequency 12 Hz transforms (x, y, z, yaw, vx, vz, locomotion flags)
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
    hairColor: t.string().default(DEFAULT_OUTFIT.hairColor),
    backpack: t.boolean().default(DEFAULT_OUTFIT.backpack),
    heldItem: t.string().default('soy_milk'),
    emote: t.string().default('none'),
    seatId: t.string().default(''),
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

export const CloudRoomState = schema(
  {
    roomCode: t.string().default('MAY-01'),
    channelName: t.string().default('Sương Sớm Cầu Đất #1'),
    players: t.map(PlayerSchema),
    occupiedBenches: t.map('string'),
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
