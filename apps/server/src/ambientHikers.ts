import {
  type BagStyleId,
  type CoatStyleId,
  type EmoteId,
  type EyewearId,
  type HeadwearId,
  type HeldItemId,
  HIGHLAND_PALETTE,
  type NearPeerTransform,
  type NeckwearId,
  sampleWalkableHeight,
  TRAIL_SEGMENTS,
} from '@dalat/protocol';

export interface WaypointStop {
  x: number;
  z: number;
  pauseSec: number;
  emote: EmoteId;
  lookYaw?: number;
}

export interface AmbientHikerSpec {
  sessionId: string;
  displayName: string;
  coatStyle: CoatStyleId;
  coatColor: string;
  scarfColor: string;
  headwear: HeadwearId;
  neckwear: NeckwearId;
  eyewear: EyewearId;
  bagStyle: BagStyleId;
  hairColor: string;
  backpack: boolean;
  heldItem: HeldItemId;
  walkSpeed: number;
  lateralOffset: number;
  pingPong: boolean;
  initialWaypointIndex: number;
  waypoints: WaypointStop[];
}

export interface AmbientHikerRuntime {
  spec: AmbientHikerSpec;
  numericId: number;
  active: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  moving: boolean;
  heldItem: HeldItemId;
  emote: EmoteId;
  waypointIndex: number;
  direction: 1 | -1;
  pauseRemainingSec: number;
  socialLookYaw?: number;
}

// Reference TRAIL_SEGMENTS anchor nodes so bots follow the exact authored red-basalt trail network
const [TRAIL_HEAD_X, TRAIL_HEAD_Z, MID_SLOPE_X, MID_SLOPE_Z] = TRAIL_SEGMENTS[0];
const [, , CAFE_TRAIL_X, CAFE_TRAIL_Z] = TRAIL_SEGMENTS[1];
const [, , TEA_LOWER_X, TEA_LOWER_Z] = TRAIL_SEGMENTS[2];
const [, , SADDLE_X, SADDLE_Z] = TRAIL_SEGMENTS[3];
const [, , PIER_ENTRY_X, PIER_ENTRY_Z] = TRAIL_SEGMENTS[4];
const [, , PINK_GRASS_X, PINK_GRASS_Z] = TRAIL_SEGMENTS[5];
const [, , LONELY_PINE_X, LONELY_PINE_Z] = TRAIL_SEGMENTS[6];
const [, , WEST_RIDGE_X, WEST_RIDGE_Z] = TRAIL_SEGMENTS[7];

export const AMBIENT_HIKER_SPECS: AmbientHikerSpec[] = [
  {
    sessionId: 'bot-minh-thu',
    displayName: 'Minh Thư',
    coatStyle: 'sherpa_cape',
    coatColor: HIGHLAND_PALETTE.coats[0],
    scarfColor: HIGHLAND_PALETTE.scarves[0],
    headwear: 'beret',
    neckwear: 'camera_strap',
    eyewear: 'round_vintage',
    bagStyle: 'rattan_basket',
    hairColor: HIGHLAND_PALETTE.hair[0],
    backpack: true,
    heldItem: 'film_camera',
    walkSpeed: 2.25,
    lateralOffset: 0.45,
    pingPong: true,
    initialWaypointIndex: 2,
    waypoints: [
      { x: -34.5, z: 28.5, pauseSec: 6.5, emote: 'warm_hands', lookYaw: Math.PI / 2 },
      { x: CAFE_TRAIL_X, z: CAFE_TRAIL_Z, pauseSec: 0, emote: 'none' },
      { x: SADDLE_X, z: SADDLE_Z, pauseSec: 3.5, emote: 'snap_photo', lookYaw: 1.45 },
      { x: PIER_ENTRY_X, z: PIER_ENTRY_Z, pauseSec: 2.0, emote: 'none' },
      { x: 90.0, z: -74.2, pauseSec: 9.0, emote: 'snap_photo', lookYaw: Math.PI / 2 },
    ],
  },
  {
    sessionId: 'bot-hoang-nam',
    displayName: 'Hoàng Nam',
    coatStyle: 'quilted_gilet',
    coatColor: HIGHLAND_PALETTE.coats[1],
    scarfColor: HIGHLAND_PALETTE.scarves[2],
    headwear: 'fedora_wool',
    neckwear: 'knit_scarf',
    eyewear: 'sun_amber',
    bagStyle: 'trek_pack',
    hairColor: HIGHLAND_PALETTE.hair[1],
    backpack: true,
    heldItem: 'phin_coffee',
    walkSpeed: 2.42,
    lateralOffset: -0.5,
    pingPong: true,
    initialWaypointIndex: 3,
    waypoints: [
      { x: -39.0, z: 34.0, pauseSec: 7.5, emote: 'sip_drink', lookYaw: 1.2 },
      { x: CAFE_TRAIL_X, z: CAFE_TRAIL_Z, pauseSec: 0, emote: 'none' },
      { x: TEA_LOWER_X, z: TEA_LOWER_Z, pauseSec: 3.0, emote: 'warm_hands', lookYaw: 1.5 },
      { x: SADDLE_X, z: SADDLE_Z, pauseSec: 0, emote: 'none' },
      { x: PIER_ENTRY_X, z: PIER_ENTRY_Z, pauseSec: 2.5, emote: 'sip_drink', lookYaw: 1.55 },
      { x: 88.5, z: -76.4, pauseSec: 8.5, emote: 'cheer_sunrise', lookYaw: Math.PI / 2 },
    ],
  },
  {
    sessionId: 'bot-an-nhien',
    displayName: 'An Nhiên',
    coatStyle: 'knit_sweater',
    coatColor: HIGHLAND_PALETTE.coats[8],
    scarfColor: HIGHLAND_PALETTE.scarves[6],
    headwear: 'flower_crown',
    neckwear: 'plaid_shawl',
    eyewear: 'blush_cheeks',
    bagStyle: 'canvas_tote',
    hairColor: HIGHLAND_PALETTE.hair[2],
    backpack: true,
    heldItem: 'hydrangea_bouquet',
    walkSpeed: 2.15,
    lateralOffset: 0.25,
    pingPong: true,
    initialWaypointIndex: 0,
    waypoints: [
      { x: -36.0, z: 31.5, pauseSec: 5.5, emote: 'sip_drink', lookYaw: 1.4 },
      { x: CAFE_TRAIL_X, z: CAFE_TRAIL_Z, pauseSec: 2.5, emote: 'wave', lookYaw: 0.4 },
      { x: SADDLE_X, z: SADDLE_Z, pauseSec: 4.5, emote: 'sip_drink', lookYaw: 1.5 },
      { x: PIER_ENTRY_X, z: PIER_ENTRY_Z, pauseSec: 0, emote: 'none' },
      { x: 85.0, z: -75.0, pauseSec: 7.0, emote: 'warm_hands', lookYaw: 1.57 },
    ],
  },
  {
    sessionId: 'bot-bao-khanh',
    displayName: 'Bảo Khánh',
    coatStyle: 'duffle_parka',
    coatColor: HIGHLAND_PALETTE.coats[4],
    scarfColor: HIGHLAND_PALETTE.scarves[1],
    headwear: 'beanie',
    neckwear: 'bandana',
    eyewear: 'retro_tortoise',
    bagStyle: 'guitar_case',
    hairColor: HIGHLAND_PALETTE.hair[4],
    backpack: true,
    heldItem: 'guitar',
    walkSpeed: 2.35,
    lateralOffset: -0.35,
    pingPong: true,
    initialWaypointIndex: 2,
    waypoints: [
      { x: TRAIL_HEAD_X + 3, z: TRAIL_HEAD_Z - 3, pauseSec: 6.0, emote: 'warm_hands', lookYaw: 1.75 },
      { x: MID_SLOPE_X, z: MID_SLOPE_Z, pauseSec: 0, emote: 'none' },
      { x: -50.5, z: 25.0, pauseSec: 9.5, emote: 'play_guitar', lookYaw: 0.7 },
      { x: CAFE_TRAIL_X, z: CAFE_TRAIL_Z, pauseSec: 0, emote: 'none' },
      { x: SADDLE_X, z: SADDLE_Z, pauseSec: 4.0, emote: 'wave', lookYaw: 1.3 },
    ],
  },
  {
    sessionId: 'bot-thao-vy',
    displayName: 'Thảo Vy',
    coatStyle: 'highland_poncho',
    coatColor: HIGHLAND_PALETTE.coats[3],
    scarfColor: HIGHLAND_PALETTE.scarves[3],
    headwear: 'straw_boater',
    neckwear: 'knit_scarf',
    eyewear: 'rose_tinted',
    bagStyle: 'leather_satchel',
    hairColor: HIGHLAND_PALETTE.hair[3],
    backpack: true,
    heldItem: 'roasted_corn',
    walkSpeed: 2.28,
    lateralOffset: 0.0,
    pingPong: false,
    initialWaypointIndex: 0,
    waypoints: [
      { x: CAFE_TRAIL_X, z: CAFE_TRAIL_Z, pauseSec: 4.5, emote: 'warm_hands', lookYaw: 1.5 },
      { x: SADDLE_X, z: SADDLE_Z, pauseSec: 3.0, emote: 'none' },
      { x: PINK_GRASS_X, z: PINK_GRASS_Z, pauseSec: 6.5, emote: 'snap_photo', lookYaw: 1.65 },
      { x: LONELY_PINE_X + 2, z: LONELY_PINE_Z + 4, pauseSec: 7.5, emote: 'warm_hands', lookYaw: Math.PI },
      { x: WEST_RIDGE_X, z: WEST_RIDGE_Z, pauseSec: 0, emote: 'none' },
    ],
  },
];

function wrapAnglePi(a: number): number {
  let r = (a + Math.PI) % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r - Math.PI;
}

function lerpAngle(from: number, to: number, t: number): number {
  const diff = wrapAnglePi(to - from);
  return wrapAnglePi(from + diff * Math.min(1, Math.max(0, t)));
}

export class AmbientHikerController {
  private readonly bots: AmbientHikerRuntime[] = [];

  constructor(allocateNumericId: () => number) {
    for (const spec of AMBIENT_HIKER_SPECS) {
      const idx = Math.min(spec.initialWaypointIndex, spec.waypoints.length - 1);
      const wp = spec.waypoints[idx];
      const y = sampleWalkableHeight(wp.x, wp.z);
      this.bots.push({
        spec,
        numericId: allocateNumericId(),
        active: false,
        x: wp.x,
        y,
        z: wp.z,
        yaw: wp.lookYaw ?? 1.2,
        vx: 0,
        vz: 0,
        moving: false,
        heldItem: spec.heldItem,
        emote: wp.emote,
        waypointIndex: idx,
        direction: 1,
        pauseRemainingSec: wp.pauseSec * 0.5,
      });
    }
  }

  public getAll(): readonly AmbientHikerRuntime[] {
    return this.bots;
  }

  /**
   * Scales autonomous cloud-hunters down automatically if real human count approaches/exceeds 30.
   * Returns lists of newly activated or deactivated bots so the Room can sync `CloudRoomState.players`.
   */
  public reconcilePopulation(humanCount: number): {
    added: AmbientHikerRuntime[];
    removed: AmbientHikerRuntime[];
  } {
    // Gently populate lonely shards (1..5 human explorers) and yield 100% of GPU/network budget once >= 6 humans gather
    const desiredCount =
      humanCount <= 0 || humanCount >= 6
        ? 0
        : humanCount <= 2
          ? Math.min(4, this.bots.length)
          : Math.max(0, 6 - humanCount);

    const added: AmbientHikerRuntime[] = [];
    const removed: AmbientHikerRuntime[] = [];

    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      const shouldBeActive = i < desiredCount;
      if (shouldBeActive && !bot.active) {
        bot.active = true;
        added.push(bot);
      } else if (!shouldBeActive && bot.active) {
        bot.active = false;
        bot.vx = 0;
        bot.vz = 0;
        bot.moving = false;
        removed.push(bot);
      }
    }

    return { added, removed };
  }

  /**
   * Advances active hikers by `dtSec` along their highland routes.
   * Returns updates ONLY for bots whose emote or heldItem changed this tick.
   */
  public step(
    dtSec: number
  ): Array<{ sessionId: string; emote: EmoteId; heldItem: HeldItemId }> {
    const emoteChanges: Array<{ sessionId: string; emote: EmoteId; heldItem: HeldItemId }> = [];

    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      if (!bot.active) continue;

      const wps = bot.spec.waypoints;
      const targetWp = wps[bot.waypointIndex];

      if (bot.pauseRemainingSec > 0) {
        bot.pauseRemainingSec -= dtSec;
        bot.vx *= 0.6;
        bot.vz *= 0.6;
        if (Math.hypot(bot.vx, bot.vz) < 0.04) {
          bot.vx = 0;
          bot.vz = 0;
        }
        bot.moving = false;
        const desiredLook =
          bot.socialLookYaw !== undefined ? bot.socialLookYaw : targetWp.lookYaw;
        if (desiredLook !== undefined) {
          bot.yaw = lerpAngle(bot.yaw, desiredLook, dtSec * 6.5);
        }
        if (bot.pauseRemainingSec <= 0) {
          const hadSocial = bot.socialLookYaw !== undefined;
          bot.socialLookYaw = undefined;
          if (!hadSocial) {
            this.advanceTargetIndex(bot);
          }
          if (bot.emote !== 'none' || bot.heldItem !== bot.spec.heldItem) {
            bot.emote = 'none';
            bot.heldItem = bot.spec.heldItem;
            emoteChanges.push({
              sessionId: bot.spec.sessionId,
              emote: 'none',
              heldItem: bot.heldItem,
            });
          }
        }
        continue;
      }

      // Compute perpendicular lateral offset so hikers pass comfortably on trails
      const dxRaw = targetWp.x - bot.x;
      const dzRaw = targetWp.z - bot.z;
      const distRaw = Math.hypot(dxRaw, dzRaw);

      if (distRaw < 0.85) {
        if (targetWp.pauseSec > 0) {
          bot.pauseRemainingSec = targetWp.pauseSec;
          bot.moving = false;
          bot.vx = 0;
          bot.vz = 0;
          if (bot.emote !== targetWp.emote) {
            bot.emote = targetWp.emote;
            emoteChanges.push({
              sessionId: bot.spec.sessionId,
              emote: targetWp.emote,
              heldItem: bot.heldItem,
            });
          }
        } else {
          this.advanceTargetIndex(bot);
        }
        continue;
      }

      const dirX = dxRaw / distRaw;
      const dirZ = dzRaw / distRaw;
      // Gentle lateral offset tapers near endpoint so bot hits exact scenic overlook
      const offsetScale = Math.min(1, (distRaw - 0.85) / 6.0) * bot.spec.lateralOffset * bot.direction;
      const perpX = -dirZ * offsetScale;
      const perpZ = dirX * offsetScale;

      const steerX = targetWp.x + perpX - bot.x;
      const steerZ = targetWp.z + perpZ - bot.z;
      const steerLen = Math.hypot(steerX, steerZ) || 1;
      const desiredSpeed =
        targetWp.pauseSec > 0 && distRaw < 3.0
          ? bot.spec.walkSpeed * Math.max(0.38, distRaw / 3.0)
          : bot.spec.walkSpeed;

      const targetVx = (steerX / steerLen) * desiredSpeed;
      const targetVz = (steerZ / steerLen) * desiredSpeed;
      const blend = Math.min(1, dtSec * 6.0);

      bot.vx = bot.vx + (targetVx - bot.vx) * blend;
      bot.vz = bot.vz + (targetVz - bot.vz) * blend;
      bot.x += bot.vx * dtSec;
      bot.z += bot.vz * dtSec;
      bot.y = sampleWalkableHeight(bot.x, bot.z);
      bot.moving = true;

      const desiredYaw = Math.atan2(bot.vx, bot.vz);
      bot.yaw = lerpAngle(bot.yaw, desiredYaw, dtSec * 7.5);
    }

    return emoteChanges;
  }

  private advanceTargetIndex(bot: AmbientHikerRuntime): void {
    const count = bot.spec.waypoints.length;
    if (count <= 1) return;
    if (bot.spec.pingPong) {
      let next = bot.waypointIndex + bot.direction;
      if (next >= count) {
        bot.direction = -1;
        next = count - 2;
      } else if (next < 0) {
        bot.direction = 1;
        next = 1;
      }
      bot.waypointIndex = next;
    } else {
      bot.waypointIndex = (bot.waypointIndex + 1) % count;
    }
  }

  public reactToSocial(
    sessionId: string,
    fromX: number,
    fromZ: number,
    fromName: string,
    kind: 'greet' | 'cheers' | 'cheer'
  ): {
    bot: AmbientHikerRuntime;
    emote: EmoteId;
    heldItem: HeldItemId;
    replyText: string;
  } | null {
    const bot = this.bots.find((b) => b.active && b.spec.sessionId === sessionId);
    if (!bot) return null;

    bot.pauseRemainingSec = Math.max(bot.pauseRemainingSec, 4.8);
    bot.moving = false;
    bot.vx = 0;
    bot.vz = 0;
    bot.socialLookYaw = Math.atan2(fromX - bot.x, fromZ - bot.z);

    if (kind === 'cheers') {
      bot.emote = 'cheers_cup';
      if (bot.heldItem !== 'soy_milk' && bot.heldItem !== 'phin_coffee') {
        bot.heldItem = 'soy_milk';
      }
      const cheersReplies = [
        `Cụng ly ấm nhé ${fromName}! Sáng Cầu Đất se lạnh có ly nóng êm lòng ghê ☕✨`,
        `1, 2, 3 cụng ly nha ${fromName}! Chúc buổi sớm săn được biển mây vàng rực rỡ 🥛`,
        `Ấm áp quá ${fromName} ơi! Uống ngụm sữa đậu nành nóng rồi lên Cầu Gỗ ngắm bình minh nhé!`,
      ];
      const idx = Math.floor(Math.random() * cheersReplies.length);
      return { bot, emote: bot.emote, heldItem: bot.heldItem, replyText: cheersReplies[idx] };
    }

    if (kind === 'cheer') {
      bot.emote = 'cheer_sunrise';
      const cheerReplies = [
        `Tuyệt vời quá ${fromName} ơi! Biển mây Cầu Đất hôm nay đẹp mê hồn 🌅✨`,
        `Yeahhh! Khoảnh khắc sương tan trên đồi chè đỉnh thật sự ${fromName} ha! 🙌`,
      ];
      const idx = Math.floor(Math.random() * cheerReplies.length);
      return { bot, emote: bot.emote, heldItem: bot.heldItem, replyText: cheerReplies[idx] };
    }

    bot.emote = 'wave';
    const greetReplies = [
      `Chào ${fromName} nha! Bạn cũng dậy sớm đi săn mây Đà Lạt hả 👋✨`,
      `Xin chào ${fromName}! Không khí thông reo sáng nay trong lành quá chừng 🌲`,
      `Chào buổi sớm ${fromName} nhé! Chúc một ngày trên đồi thật bình yên ☁️`,
    ];
    const idx = Math.floor(Math.random() * greetReplies.length);
    return { bot, emote: bot.emote, heldItem: bot.heldItem, replyText: greetReplies[idx] };
  }

  public toNearTransform(bot: AmbientHikerRuntime): NearPeerTransform {
    return {
      numericId: bot.numericId,
      x: bot.x,
      y: bot.y,
      z: bot.z,
      yaw: bot.yaw,
      vx: bot.vx,
      vz: bot.vz,
      moving: bot.moving,
      running: false,
      grounded: true,
      warmBuff: true,
    };
  }
}
