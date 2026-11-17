import { Room, type Client } from '@colyseus/core';
import {
  type AcousticJamNote,
  type AvatarGender,
  BAG_CATALOG,
  type BagStyleId,
  type ChatBubbleMessage,
  checkPedestrianDeckZone,
  COAT_CATALOG,
  type CoatStyleId,
  decodeClientMove,
  DEFAULT_OUTFIT,
  type EmoteId,
  encodeWorldSnapshot,
  ensureCoatMatchesGender,
  EYEWEAR_CATALOG,
  type EyewearId,
  type FarPeerBeacon,
  getCoatGender,
  HEADWEAR_CATALOG,
  type HeadwearId,
  HELD_PROP_CATALOG,
  type HeldItemId,
  LANDMARK_LIST,
  LANDMARK_SCOOTER_PARKING,
  LANDMARKS,
  type NearPeerTransform,
  NECKWEAR_CATALOG,
  type NeckwearId,
  normalizeRoomCode,
  parseBenchSeatId,
  type PassengerPoseStyle,
  type PlayerOutfit,
  type PolaroidEntry,
  type PolaroidPinAck,
  resolveBenchSeatTransform,
  resolveEffectiveBagStyle,
  resolveEffectiveEyewear,
  resolveEffectiveGender,
  resolveEffectiveNeckwear,
  resolveEffectiveScooterPaint,
  sampleGroundHeight,
  sampleWalkableHeight,
  SCOOTER_PAINT_CATALOG,
  type ScooterPaintId,
  type ServerPoseCorrection,
  SHARED_BENCHES,
  type SocialInteractKind,
  STATION_SCOOTERS,
  type VehicleAckPayload,
  type VehicleDuoTeleportEvent,
  type VehicleHornEvent,
  type VehicleRideInvite,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
import { AmbientHikerController, type AmbientHikerRuntime } from './ambientHikers';
import { MAX_IMAGE_DATA_LEN, sanitizeSocialText, worldPersistence } from './persistence';
import { CloudRoomState, PlayerSchema, ScooterSchema, type CloudRoomMetadata } from './schema';

const POETIC_CHANNEL_NAMES = [
  'Sương Sớm Cầu Đất',
  'Đồi Thông Mơ Màng',
  'Thung Lũng Đèn',
  'Bình Minh Đồi Chè',
  'Hiên Gỗ Mơ Sương',
  'Gió Thông Thiên Phúc',
  'Hõm Cỏ Tuyết Hồng',
  'Dốc Dã Quỳ Vàng',
] as const;

const VALID_COAT_STYLES = new Set<CoatStyleId>(COAT_CATALOG.map((c) => c.id));
const VALID_HEADWEAR = new Set<HeadwearId>([
  ...HEADWEAR_CATALOG.map((h) => h.id),
  'scarf_only',
]);
const VALID_NECKWEAR = new Set<NeckwearId>(NECKWEAR_CATALOG.map((n) => n.id));
const VALID_EYEWEAR = new Set<EyewearId>(EYEWEAR_CATALOG.map((e) => e.id));
const VALID_BAG_STYLES = new Set<BagStyleId>(BAG_CATALOG.map((b) => b.id));
const VALID_SCOOTER_PAINTS = new Set<ScooterPaintId>(SCOOTER_PAINT_CATALOG.map((p) => p.id));
const VALID_HELD_ITEMS = new Set<HeldItemId>(HELD_PROP_CATALOG.map((p) => p.id));
const VALID_EMOTES = new Set<EmoteId>([
  'none',
  'wave',
  'warm_hands',
  'sip_drink',
  'sit_chill',
  'snap_photo',
  'play_guitar',
  'cheers_cup',
  'cheer_sunrise',
]);
const VALID_INSTRUMENTS = new Set<AcousticJamNote['instrument']>(['guitar', 'cajon', 'chime']);
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

const BENCH_BY_ID = new Map(SHARED_BENCHES.map((b) => [b.id, b]));

const AOI_POPULATION_THRESHOLD = 40;
const AOI_NEAR_RADIUS_SQ = 95 * 95;
const AOI_MAX_NEAR_PEERS = 24;
const JAM_BROADCAST_RADIUS = 45;

interface HumanEntityTransform {
  sessionId: string;
  tabId: string;
  leaveSecret: string;
  numericId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  moving: boolean;
  running: boolean;
  grounded: boolean;
  warmBuff: boolean;
  isDriving: boolean;
  isPassenger: boolean;
  isBraking: boolean;
  headlightOn: boolean;
  hasReceivedMove: boolean;
  hydratedWorldInit: boolean;
  clampStreak: number;
  lastSeq: number;
  lastMoveAtMs: number;
  burstSlackMeters: number;
  lastTeleportAtMs: number;
  lastChatAtMs: number;
  lastSocialAtMs: number;
  lastJamAtMs: number;
  lastHornAtMs: number;
  lastPolaroidAtMs: number;
  lastChimeAtMs: number;
  likedPolaroids: Set<string>;
}

interface ScooterRuntimeState {
  scooterId: string;
  kind: 'station' | 'personal';
  homeX: number;
  homeY: number;
  homeZ: number;
  homeYaw: number;
  liveX: number;
  liveY: number;
  liveZ: number;
  liveYaw: number;
  lastActiveAtMs: number;
  lastSchemaSyncAtMs: number;
}

export const activeCloudRooms = new Map<string, CloudHuntingRoom>();
const usedShardIndices = new Set<number>();

function allocateChannelIdentity(requestedCode?: string): {
  roomCode: string;
  channelName: string;
  shardIndex: number;
} {
  const cleaned = normalizeRoomCode(requestedCode);

  const mayMatch = cleaned.match(/^MAY-0*(\d+)$/);
  if (mayMatch) {
    const idx = Math.max(1, Number.parseInt(mayMatch[1], 10) || 1);
    usedShardIndices.add(idx);
    const title = POETIC_CHANNEL_NAMES[(idx - 1) % POETIC_CHANNEL_NAMES.length];
    return {
      roomCode: `MAY-${String(idx).padStart(2, '0')}`,
      channelName: `${title} #${idx}`,
      shardIndex: idx,
    };
  }

  let idx = 1;
  while (usedShardIndices.has(idx)) {
    idx++;
  }
  usedShardIndices.add(idx);
  const title = POETIC_CHANNEL_NAMES[(idx - 1) % POETIC_CHANNEL_NAMES.length];

  if (cleaned.length >= 3) {
    return {
      roomCode: cleaned,
      channelName: title,
      shardIndex: idx,
    };
  }

  return {
    roomCode: `MAY-${String(idx).padStart(2, '0')}`,
    channelName: `${title} #${idx}`,
    shardIndex: idx,
  };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function sanitizeHexColor(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && HEX_COLOR_RE.test(raw.trim()) ? raw.trim() : fallback;
}

function sanitizeOutfit(raw: Partial<PlayerOutfit> | undefined | null): PlayerOutfit {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_OUTFIT };
  }
  const headwear: HeadwearId =
    typeof raw.headwear === 'string' && VALID_HEADWEAR.has(raw.headwear as HeadwearId)
      ? (raw.headwear as HeadwearId)
      : DEFAULT_OUTFIT.headwear;
  const backpackBool = typeof raw.backpack === 'boolean' ? raw.backpack : DEFAULT_OUTFIT.backpack;
  const bagStyle: BagStyleId =
    typeof raw.bagStyle === 'string' && VALID_BAG_STYLES.has(raw.bagStyle as BagStyleId)
      ? (raw.bagStyle as BagStyleId)
      : backpackBool
        ? 'trek_pack'
        : 'none';
  const neckwear: NeckwearId =
    typeof raw.neckwear === 'string' && VALID_NECKWEAR.has(raw.neckwear as NeckwearId)
      ? (raw.neckwear as NeckwearId)
      : headwear === 'none'
        ? 'none'
        : 'knit_scarf';
  const eyewear: EyewearId =
    typeof raw.eyewear === 'string' && VALID_EYEWEAR.has(raw.eyewear as EyewearId)
      ? (raw.eyewear as EyewearId)
      : 'none';

  const rawCoatStyle: CoatStyleId =
    typeof raw.coatStyle === 'string' && VALID_COAT_STYLES.has(raw.coatStyle as CoatStyleId)
      ? (raw.coatStyle as CoatStyleId)
      : DEFAULT_OUTFIT.coatStyle;
  const gender: AvatarGender =
    raw.gender === 'male' || raw.gender === 'female'
      ? raw.gender
      : getCoatGender(rawCoatStyle);
  const coatStyle: CoatStyleId = ensureCoatMatchesGender(rawCoatStyle, gender);
  const scooterPaint: ScooterPaintId =
    typeof raw.scooterPaint === 'string' && VALID_SCOOTER_PAINTS.has(raw.scooterPaint as ScooterPaintId)
      ? (raw.scooterPaint as ScooterPaintId)
      : resolveEffectiveScooterPaint(DEFAULT_OUTFIT);

  return {
    gender,
    coatStyle,
    coatColor: sanitizeHexColor(raw.coatColor, DEFAULT_OUTFIT.coatColor),
    scarfColor: sanitizeHexColor(raw.scarfColor, DEFAULT_OUTFIT.scarfColor),
    headwear,
    neckwear,
    eyewear,
    bagStyle,
    scooterPaint,
    hairColor: sanitizeHexColor(raw.hairColor, DEFAULT_OUTFIT.hairColor),
    backpack: bagStyle !== 'none',
  };
}

function isNearAnyLandmark(x: number, z: number): boolean {
  for (let i = 0; i < LANDMARK_LIST.length; i++) {
    const [lx, , lz] = LANDMARK_LIST[i].position;
    if (Math.hypot(x - lx, z - lz) <= 18.0) {
      return true;
    }
  }
  // Allow full Cầu Gỗ Săn Mây bridge ramp/deck & Tiệm Cà Phê Mơ Sương veranda
  if (x >= 44 && x <= 100 && Math.abs(z - -75) <= 9.0) return true;
  if (x >= -56 && x <= -22 && z >= 18 && z <= 42) return true;
  return false;
}

export class CloudHuntingRoom extends Room<{
  state: CloudRoomState;
  metadata: CloudRoomMetadata;
}> {
  private nextNumericId = 1;
  private nextBotNumericId = 60001;
  private serverTick = 0;
  private shardIndex = 1;
  public roomCode = 'MAY-01';
  public channelName = 'Sương Sớm Cầu Đất #1';

  private readonly humanEntities = new Map<string, HumanEntityTransform>();
  private readonly scooterRuntimes = new Map<string, ScooterRuntimeState>();
  private readonly pendingReconnections = new Map<
    string,
    ReturnType<CloudHuntingRoom['allowReconnection']>
  >();
  private ambientHikers!: AmbientHikerController;

  public getHumanCount(): number {
    return this.humanEntities.size;
  }

  /**
   * Immediately evicts a prior session belonging to the same browser tab (on reload / tab close)
   * ONLY when the caller proves ownership via the private per-tab `leaveSecret`.
   */
  public evictClientSession(
    sessionId?: string,
    tabId?: string,
    leaveSecret?: string,
    excludeSessionId?: string
  ): {
    matched: boolean;
    authorized: boolean;
    lastPose: { x: number; z: number; yaw: number } | null;
  } {
    const cleanSid = typeof sessionId === 'string' ? sessionId.trim() : '';
    const cleanTabId = typeof tabId === 'string' ? tabId.trim().slice(0, 64) : '';
    const cleanSecret = typeof leaveSecret === 'string' ? leaveSecret.trim().slice(0, 128) : '';
    if (!cleanSid && !cleanTabId) {
      return { matched: false, authorized: false, lastPose: null };
    }

    let lastPose: { x: number; z: number; yaw: number } | null = null;
    const candidates: HumanEntityTransform[] = [];

    for (const [sid, ent] of this.humanEntities) {
      if (excludeSessionId && sid === excludeSessionId) continue;
      if ((cleanSid && sid === cleanSid) || (cleanTabId && ent.tabId === cleanTabId)) {
        candidates.push(ent);
      }
    }

    if (candidates.length === 0) {
      return { matched: false, authorized: cleanSecret.length >= 12, lastPose: null };
    }

    const toEvict: string[] = [];
    for (const ent of candidates) {
      if (cleanSecret && ent.leaveSecret && ent.leaveSecret === cleanSecret) {
        lastPose = { x: ent.x, z: ent.z, yaw: ent.yaw };
        toEvict.push(ent.sessionId);
      }
    }

    if (toEvict.length === 0) {
      return { matched: true, authorized: false, lastPose: null };
    }

    for (const sid of toEvict) {
      this.releaseClientBench(sid);
      this.releaseClientVehicle(sid, true);
      this.humanEntities.delete(sid);
      this.state.players.delete(sid);

      const pending = this.pendingReconnections.get(sid);
      if (pending) {
        this.pendingReconnections.delete(sid);
        try {
          pending.reject(false);
        } catch {
          // ignore already-settled deferred
        }
      }

      for (const activeClient of this.clients) {
        if (activeClient.sessionId === sid) {
          try {
            activeClient.leave(4001, 'tab_reloaded');
          } catch {
            // ignore closing socket
          }
        }
      }
    }

    this.syncAmbientBots();
    return { matched: true, authorized: true, lastPose };
  }

  private syncAmbientBots(): void {
    if (!this.ambientHikers || !this.state) return;
    const { added, removed } = this.ambientHikers.reconcilePopulation(this.humanEntities.size);
    for (const bot of removed) {
      this.state.players.delete(bot.spec.sessionId);
    }
    for (const bot of added) {
      this.upsertBotSchema(bot);
    }
  }

  private upsertBotSchema(bot: AmbientHikerRuntime): void {
    const ps = new PlayerSchema();
    ps.numericId = bot.numericId;
    ps.sessionId = bot.spec.sessionId;
    ps.displayName = bot.spec.displayName;
    ps.gender = getCoatGender(bot.spec.coatStyle);
    ps.coatStyle = bot.spec.coatStyle;
    ps.coatColor = bot.spec.coatColor;
    ps.scarfColor = bot.spec.scarfColor;
    ps.headwear = bot.spec.headwear;
    ps.neckwear = bot.spec.neckwear;
    ps.eyewear = bot.spec.eyewear;
    ps.bagStyle = bot.spec.bagStyle;
    ps.hairColor = bot.spec.hairColor;
    ps.backpack = bot.spec.backpack;
    ps.heldItem = bot.heldItem;
    ps.emote = bot.emote;
    ps.seatId = '';
    ps.isBot = true;
    ps.spawnX = bot.x;
    ps.spawnY = bot.y;
    ps.spawnZ = bot.z;
    ps.spawnYaw = bot.yaw;
    this.state.players.set(bot.spec.sessionId, ps);
  }

  private isNearAnyPlayer(x: number, z: number, excludeSessionId: string): boolean {
    for (const [sid, other] of this.humanEntities) {
      if (sid !== excludeSessionId && Math.hypot(x - other.x, z - other.z) <= 6.0) {
        return true;
      }
    }
    if (this.ambientHikers) {
      for (const bot of this.ambientHikers.getAll()) {
        if (bot.active && Math.hypot(x - bot.x, z - bot.z) <= 6.0) {
          return true;
        }
      }
    }
    return false;
  }

  private allocateNumericId(): number {
    // Human numeric IDs stay strictly in 1..59999 so 60001+ bot IDs never collide
    for (let guard = 0; guard < 59999; guard++) {
      const candidate = this.nextNumericId;
      this.nextNumericId = this.nextNumericId >= 59999 ? 1 : this.nextNumericId + 1;
      let collision = false;
      for (const h of this.humanEntities.values()) {
        if (h.numericId === candidate) {
          collision = true;
          break;
        }
      }
      if (!collision) return candidate;
    }
    return 1;
  }

  async onCreate(options: { customRoomCode?: string; keepAlive?: boolean } = {}): Promise<void> {
    const identity = allocateChannelIdentity(options?.customRoomCode);
    this.roomCode = identity.roomCode;
    this.channelName = identity.channelName;
    this.shardIndex = identity.shardIndex;

    const primaryMay01Exists = Array.from(activeCloudRooms.values()).some(
      (r) => r !== this && r.roomCode === 'MAY-01'
    );
    this.maxClients = WORLD_CONSTANTS.HARD_ROOM_CAP;
    this.autoDispose =
      options?.keepAlive === true || (this.roomCode === 'MAY-01' && !primaryMay01Exists)
        ? false
        : true;
    this.patchRate = 100; // 10 Hz low-frequency Schema metadata patches
    this.seatReservationTimeout = 8;
    this.maxMessagesPerSecond = 90;

    const state = new CloudRoomState();
    state.roomCode = this.roomCode;
    state.channelName = this.channelName;
    this.state = state;

    // Seed the 5 shared vintage Honda Super Cub 50 station scooters across Da Lat landmarks
    const bootMs = Date.now();
    for (let i = 0; i < STATION_SCOOTERS.length; i++) {
      const spec = STATION_SCOOTERS[i];
      const sc = new ScooterSchema();
      sc.scooterId = spec.scooterId;
      sc.kind = 'station';
      sc.ownerSessionId = '';
      sc.paintId = spec.paintId;
      sc.plateLabel = spec.plateLabel;
      sc.driverSessionId = '';
      sc.passengerSessionId = '';
      sc.passengerPose = 'hold_waist';
      sc.headlightOn = true;
      sc.parkedX = spec.x;
      sc.parkedY = spec.y;
      sc.parkedZ = spec.z;
      sc.parkedYaw = spec.yaw;
      state.scooters.set(spec.scooterId, sc);
      this.scooterRuntimes.set(spec.scooterId, {
        scooterId: spec.scooterId,
        kind: 'station',
        homeX: spec.x,
        homeY: spec.y,
        homeZ: spec.z,
        homeYaw: spec.yaw,
        liveX: spec.x,
        liveY: spec.y,
        liveZ: spec.z,
        liveYaw: spec.yaw,
        lastActiveAtMs: bootMs,
        lastSchemaSyncAtMs: bootMs,
      });
    }

    this.ambientHikers = new AmbientHikerController(() => this.nextBotNumericId++);

    await this.setMatchmaking({
      maxClients: WORLD_CONSTANTS.HARD_ROOM_CAP,
      metadata: {
        roomCode: this.roomCode,
        channelName: this.channelName,
        shardIndex: this.shardIndex,
        softCap: WORLD_CONSTANTS.SOFT_ROOM_CAP,
        hardCap: WORLD_CONSTANTS.HARD_ROOM_CAP,
      },
    });

    this.registerMessageHandlers();

    const tickIntervalMs = 1000 / WORLD_CONSTANTS.NET_TICK_HZ; // 83.333ms (12 Hz)
    this.setTimestep((dtMs) => this.tickSimulation(dtMs), tickIntervalMs);

    activeCloudRooms.set(this.roomId, this);
  }

  private registerMessageHandlers(): void {
    // 1. 12 Hz 11-byte binary locomotion packet
    this.onMessageBytes('mv', (client, bytes: Uint8Array) => {
      this.handleMovePacket(client, bytes);
    });

    // 2. Cristian RTT clock synchronization
    this.onMessage('ping_sync', (client, payload: { clientSendMs?: number }) => {
      const clientSendMs =
        typeof payload?.clientSendMs === 'number' && Number.isFinite(payload.clientSendMs)
          ? payload.clientSendMs
          : Date.now();
      client.send('pong_sync', {
        clientSendMs,
        serverEpochMs: Date.now(),
      });
    });

    // 2b. Explicit client hydration request (guaranteed after client binds room.onMessage handlers)
    this.onMessage('req_world_init', (client) => {
      const ent = this.humanEntities.get(client.sessionId);
      if (ent && !ent.hydratedWorldInit) {
        ent.hydratedWorldInit = true;
        this.sendWorldHydration(client, ent.numericId);
      }
    });

    // 2c. Authoritative fast-travel / companion teleport (releases bench & reconciles cooldown rejections)
    this.onMessage(
      'teleport',
      (
        client,
        payload: { x?: number; y?: number; z?: number; yaw?: number; qaOverride?: boolean }
      ) => {
        const ent = this.humanEntities.get(client.sessionId);
        const ps = this.state.players.get(client.sessionId);
        if (!ent || !ps) return;

        // Always release any occupied bench immediately when fast-traveling
        this.releaseClientBench(client.sessionId);

        // If a passenger independently fast-travels via Map, detach them cleanly from the pillion seat first
        if (ps.vehicleRole === 'passenger') {
          this.releaseClientVehicle(client.sessionId, false);
        }

        const rawX = typeof payload?.x === 'number' ? payload.x : NaN;
        const rawZ = typeof payload?.z === 'number' ? payload.z : NaN;
        if (!Number.isFinite(rawX) || !Number.isFinite(rawZ)) return;

        let nx = clamp(rawX, -445, 445);
        let nz = clamp(rawZ, -445, 445);
        const wallNow = Date.now();
        const allowQaOverride =
          payload?.qaOverride === true && process.env.NODE_ENV !== 'production';
        const validTarget =
          allowQaOverride ||
          isNearAnyLandmark(nx, nz) ||
          this.isNearAnyPlayer(nx, nz, client.sessionId);

        if (validTarget && (allowQaOverride || wallNow - ent.lastTeleportAtMs >= 300)) {
          let matchedLandmarkName = '';
          let targetYaw =
            typeof payload?.yaw === 'number' && Number.isFinite(payload.yaw) ? payload.yaw : ent.yaw;

          // When a scooter driver fast-travels to a landmark, snap to that landmark's roadside parking turnout
          // and bring both the Super Cub AND any attached passenger along together!
          if (ps.vehicleRole === 'driver' && ps.vehicleId && !allowQaOverride) {
            for (let i = 0; i < LANDMARK_LIST.length; i++) {
              const lm = LANDMARK_LIST[i];
              if (Math.hypot(nx - lm.position[0], nz - lm.position[2]) <= 18.5) {
                const spot = LANDMARK_SCOOTER_PARKING[lm.id];
                if (spot) {
                  nx = spot.x;
                  nz = spot.z;
                  targetYaw = spot.yaw;
                  matchedLandmarkName = lm.name;
                }
                break;
              }
            }
          }

          const walkY = sampleWalkableHeight(nx, nz);
          const groundY = sampleGroundHeight(nx, nz);
          const requestedY =
            allowQaOverride && typeof payload?.y === 'number' && Number.isFinite(payload.y)
              ? clamp(payload.y, groundY - 0.5, walkY + 4.0)
              : walkY;
          ent.x = nx;
          ent.y = requestedY;
          ent.z = nz;
          ent.yaw = targetYaw;
          ent.vx = 0;
          ent.vz = 0;
          ent.moving = false;
          ent.running = false;
          if (!allowQaOverride) {
            ent.lastTeleportAtMs = wallNow;
          }
          ent.burstSlackMeters = ps.vehicleRole === 'driver' ? 24.0 : 8.5;
          ent.clampStreak = 0; // Reset token-bucket streak on valid fast-travel

          ps.spawnX = ent.x;
          ps.spawnY = ent.y;
          ps.spawnZ = ent.z;
          ps.spawnYaw = ent.yaw;

          if (ps.vehicleRole === 'driver' && ps.vehicleId) {
            const sc = this.state.scooters.get(ps.vehicleId);
            const rt = this.scooterRuntimes.get(ps.vehicleId);
            if (sc && rt) {
              sc.parkedX = nx;
              sc.parkedY = requestedY;
              sc.parkedZ = nz;
              sc.parkedYaw = targetYaw;
              rt.liveX = nx;
              rt.liveY = requestedY;
              rt.liveZ = nz;
              rt.liveYaw = targetYaw;
              rt.lastActiveAtMs = wallNow;
              rt.lastSchemaSyncAtMs = wallNow;

              if (sc.passengerSessionId) {
                const pEnt = this.humanEntities.get(sc.passengerSessionId);
                const pPs = this.state.players.get(sc.passengerSessionId);
                const backOff = WORLD_CONSTANTS.SCOOTER_PILLION_BACK_OFFSET;
                const px = nx - Math.sin(targetYaw) * backOff;
                const pz = nz - Math.cos(targetYaw) * backOff;
                if (pEnt) {
                  pEnt.x = px;
                  pEnt.y = requestedY;
                  pEnt.z = pz;
                  pEnt.yaw = targetYaw;
                  pEnt.vx = 0;
                  pEnt.vz = 0;
                  pEnt.lastTeleportAtMs = wallNow;
                  pEnt.burstSlackMeters = 8.5;
                }
                if (pPs) {
                  pPs.spawnX = px;
                  pPs.spawnY = requestedY;
                  pPs.spawnZ = pz;
                  pPs.spawnYaw = targetYaw;
                }
                const pClient = this.clients.find((c) => c.sessionId === sc.passengerSessionId);
                if (pClient) {
                  const duoEvt: VehicleDuoTeleportEvent = {
                    scooterId: sc.scooterId,
                    landmarkName: matchedLandmarkName || 'điểm dừng mới',
                    x: nx,
                    y: requestedY,
                    z: nz,
                    yaw: targetYaw,
                  };
                  pClient.send('vehicle_duo_teleport', duoEvt);
                }
              }
            }
          }
        } else {
          const correction: ServerPoseCorrection = {
            x: ent.x,
            y: ent.y,
            z: ent.z,
            yaw: ent.yaw,
            reason: validTarget ? 'teleport_cooldown' : 'invalid_target',
          };
          client.send('pose_correct', correction);
        }
      }
    );

    // 3. Profile & highland coat/scarf customization
    this.onMessage(
      'profile',
      (client, payload: { displayName?: string; outfit?: Partial<PlayerOutfit> }) => {
        const ps = this.state.players.get(client.sessionId);
        if (!ps || ps.isBot) return;
        if (typeof payload?.displayName === 'string') {
          const cleanName = sanitizeSocialText(payload.displayName, 28);
          if (cleanName.length >= 1) {
            ps.displayName = cleanName;
          }
        }
        if (payload?.outfit) {
          const outfit = sanitizeOutfit(payload.outfit);
          ps.gender = resolveEffectiveGender(outfit);
          ps.coatStyle = outfit.coatStyle;
          ps.coatColor = outfit.coatColor;
          ps.scarfColor = outfit.scarfColor;
          ps.headwear = outfit.headwear;
          ps.neckwear = resolveEffectiveNeckwear(outfit);
          ps.eyewear = resolveEffectiveEyewear(outfit);
          ps.bagStyle = resolveEffectiveBagStyle(outfit);
          ps.scooterPaint = resolveEffectiveScooterPaint(outfit);
          ps.hairColor = outfit.hairColor;
          ps.backpack = outfit.backpack;
          const ownScooter = this.state.scooters.get(`cub-own-${client.sessionId}`);
          if (ownScooter) {
            ownScooter.paintId = ps.scooterPaint;
          }
        }
      }
    );

    // 4. Held warm drink / camera / lantern / guitar
    this.onMessage('held_item', (client, payload: { item?: HeldItemId }) => {
      const ps = this.state.players.get(client.sessionId);
      if (!ps || ps.isBot) return;
      if (typeof payload?.item === 'string' && VALID_HELD_ITEMS.has(payload.item)) {
        ps.heldItem = payload.item;
      }
    });

    // 5. Cozy social emotes
    this.onMessage('emote', (client, payload: { emote?: EmoteId }) => {
      const ps = this.state.players.get(client.sessionId);
      if (!ps || ps.isBot) return;
      if (typeof payload?.emote === 'string' && VALID_EMOTES.has(payload.emote)) {
        ps.emote = payload.emote;
      }
    });

    // 6. Proximity text chat (<= 120 chars, 1.2s rate limit, 35m spatial radius)
    this.onMessage('chat', (client, payload: { text?: string }) => {
      const ent = this.humanEntities.get(client.sessionId);
      const ps = this.state.players.get(client.sessionId);
      if (!ent || !ps) return;

      const now = Date.now();
      if (now - ent.lastChatAtMs < 1200) {
        return;
      }
      const cleanText = sanitizeSocialText(payload?.text, 120);
      if (!cleanText) return;
      ent.lastChatAtMs = now;

      const bubble: ChatBubbleMessage = {
        id: `msg-${now}-${Math.random().toString(36).slice(2, 7)}`,
        senderId: client.sessionId,
        senderName: ps.displayName,
        text: cleanText,
        x: ent.x,
        y: ent.y,
        z: ent.z,
        timestamp: now,
      };

      const maxDist = WORLD_CONSTANTS.PROXIMITY_CHAT_RADIUS;
      for (let i = 0; i < this.clients.length; i++) {
        const target = this.clients[i];
        if (target.sessionId === client.sessionId) {
          target.send('chat_bubble', bubble);
          continue;
        }
        const other = this.humanEntities.get(target.sessionId);
        if (other && Math.hypot(other.x - ent.x, other.z - ent.z) <= maxDist) {
          target.send('chat_bubble', bubble);
        }
      }
    });

    // 6b. Quick Social Interactions (Wave / Warm Cup Clink / Cheer Sunrise / Gift Flower / Sparkler)
    this.onMessage(
      'social_interact',
      (
        client,
        payload: {
          targetSessionId?: string;
          kind?: SocialInteractKind;
        }
      ) => {
        const ent = this.humanEntities.get(client.sessionId);
        const ps = this.state.players.get(client.sessionId);
        if (!ent || !ps) return;

        const now = Date.now();
        if (now - ent.lastSocialAtMs < 650) return;

        const targetId =
          typeof payload?.targetSessionId === 'string' ? payload.targetSessionId.trim() : '';
        const kind = payload?.kind;
        if (
          !targetId ||
          (kind !== 'greet' &&
            kind !== 'cheers' &&
            kind !== 'cheer' &&
            kind !== 'gift_flower' &&
            kind !== 'sparkler' &&
            kind !== 'invite_ride')
        ) {
          return;
        }
        ent.lastSocialAtMs = now;

        // Special 1-click Scooter Ride Invitation when driver invites a nearby friend onto the rear seat!
        if (kind === 'invite_ride') {
          if (ps.vehicleRole !== 'driver' || !ps.vehicleId) return;
          const sc = this.state.scooters.get(ps.vehicleId);
          const targetHuman = this.humanEntities.get(targetId);
          const targetClient = this.clients.find((c) => c.sessionId === targetId);
          if (!sc || !targetHuman || !targetClient) return;
          if (sc.passengerSessionId && sc.passengerSessionId !== targetId) return;
          if (Math.hypot(targetHuman.x - ent.x, targetHuman.z - ent.z) > 18.5) return;
          const invitePayload: VehicleRideInvite = {
            fromId: client.sessionId,
            fromName: ps.displayName,
            scooterId: sc.scooterId,
            timestamp: now,
          };
          targetClient.send('vehicle_invite', invitePayload);
          return;
        }

        // Handle ambient highland hiker social reactions (greeting, clinking warm cups, cheering sunrise)
        if (targetId.startsWith('bot-') && this.ambientHikers) {
          const botKind = kind === 'cheers' ? 'cheers' : kind === 'cheer' ? 'cheer' : 'greet';
          const reaction = this.ambientHikers.reactToSocial(
            targetId,
            ent.x,
            ent.z,
            ps.displayName,
            botKind
          );
          if (reaction) {
            const { bot, emote, heldItem, replyText } = reaction;
            if (Math.hypot(bot.x - ent.x, bot.z - ent.z) <= 18.5) {
              const botPs = this.state.players.get(targetId);
              if (botPs) {
                botPs.emote = emote;
                botPs.heldItem = heldItem;
              }
              ent.warmBuff = true;
              const midX = (ent.x + bot.x) * 0.5;
              const midY = (ent.y + bot.y) * 0.5 + 1.48;
              const midZ = (ent.z + bot.z) * 0.5;
              client.send('social_event', {
                fromId: client.sessionId,
                fromName: ps.displayName,
                targetId,
                targetName: bot.spec.displayName,
                kind,
                x: midX,
                y: midY,
                z: midZ,
              });
              client.send('chat_bubble', {
                id: `msg-${now}-${Math.random().toString(36).slice(2, 7)}`,
                senderId: targetId,
                senderName: bot.spec.displayName,
                text: replyText,
                x: bot.x,
                y: bot.y,
                z: bot.z,
                timestamp: now,
              } satisfies ChatBubbleMessage);
            }
          }
          return;
        }

        // Check if target is a human peer within 18m
        const targetHuman = this.humanEntities.get(targetId);
        const targetPs = this.state.players.get(targetId);
        if (!targetHuman || !targetPs) return;
        if (Math.hypot(targetHuman.x - ent.x, targetHuman.z - ent.z) > 18.5) return;

        const midX = (ent.x + targetHuman.x) * 0.5;
        const midY = (ent.y + targetHuman.y) * 0.5 + 1.48;
        const midZ = (ent.z + targetHuman.z) * 0.5;
        if (kind === 'cheers') {
          ent.warmBuff = true;
          targetHuman.warmBuff = true;
        } else if (kind === 'gift_flower') {
          targetPs.heldItem = 'hydrangea_bouquet';
          ent.warmBuff = true;
          targetHuman.warmBuff = true;
        } else if (kind === 'sparkler') {
          ps.heldItem = 'sparkler';
          targetPs.heldItem = 'sparkler';
        }

        // Broadcast 3D social sparkle & toast event to nearby clients
        const evtPayload = {
          fromId: client.sessionId,
          fromName: ps.displayName,
          targetId,
          targetName: targetPs.displayName,
          kind,
          x: midX,
          y: midY,
          z: midZ,
        };
        for (let i = 0; i < this.clients.length; i++) {
          const c = this.clients[i];
          const other = this.humanEntities.get(c.sessionId);
          if (
            c.sessionId === client.sessionId ||
            c.sessionId === targetId ||
            (other && Math.hypot(other.x - midX, other.z - midZ) <= 38)
          ) {
            c.send('social_event', evtPayload);
          }
        }
      }
    );

    // 7. Atomic shared bench seating (supports 2 side-by-side seats per bench: `:0` and `:1`)
    this.onMessage('seat_req', (client, payload: { benchId?: string | null }) => {
      const ent = this.humanEntities.get(client.sessionId);
      const ps = this.state.players.get(client.sessionId);
      if (!ent || !ps) return;

      const requestedId = typeof payload?.benchId === 'string' ? payload.benchId.trim() : null;

      if (!requestedId) {
        this.releaseClientBench(client.sessionId);
        client.send('seat_ack', { benchId: null, ok: true });
        return;
      }

      const { benchId: baseBenchId } = parseBenchSeatId(requestedId);
      const bench = BENCH_BY_ID.get(baseBenchId);
      if (!bench) {
        client.send('seat_ack', { benchId: null, ok: false });
        return;
      }

      const slot0Id = `${bench.id}:0`;
      const slot1Id = `${bench.id}:1`;
      const occ0 = this.state.occupiedBenches.get(slot0Id) || this.state.occupiedBenches.get(bench.id);
      const occ1 = this.state.occupiedBenches.get(slot1Id);

      let chosenSeatId: string | null = null;
      if (!occ0 || occ0 === client.sessionId) {
        chosenSeatId = slot0Id;
      } else if (!occ1 || occ1 === client.sessionId) {
        chosenSeatId = slot1Id;
      }

      if (!chosenSeatId) {
        client.send('seat_ack', {
          benchId: null,
          ok: false,
          reason: 'Ghế đôi này đã có đủ 2 lữ khách đang ngồi ngắm mây!',
        });
        return;
      }

      const seatTransform = resolveBenchSeatTransform(chosenSeatId);
      if (!seatTransform) {
        client.send('seat_ack', { benchId: null, ok: false });
        return;
      }

      // Release any previous seat held by this client first
      if (ps.seatId && ps.seatId !== chosenSeatId) {
        this.releaseClientBench(client.sessionId);
      }

      this.state.occupiedBenches.set(chosenSeatId, client.sessionId);
      ps.seatId = chosenSeatId;
      ps.emote = 'sit_chill';

      ent.x = seatTransform.position[0];
      ent.y = seatTransform.position[1];
      ent.z = seatTransform.position[2];
      ent.yaw = seatTransform.yaw;
      ent.vx = 0;
      ent.vz = 0;
      ent.moving = false;
      ent.running = false;
      ent.lastTeleportAtMs = Date.now();

      ps.spawnX = ent.x;
      ps.spawnY = ent.y;
      ps.spawnZ = ent.z;
      ps.spawnYaw = ent.yaw;

      client.send('seat_ack', {
        benchId: chosenSeatId,
        ok: true,
        position: seatTransform.position,
        yaw: seatTransform.yaw,
      });
    });

    // 7b. Authoritative Vintage Super Cub 50 Summon, Tandem Mount/Dismount, Headlight, Pose & Horn
    this.onMessage(
      'vehicle_summon',
      (client, payload: { paintId?: ScooterPaintId; autoMount?: boolean }) => {
        const ent = this.humanEntities.get(client.sessionId);
        const ps = this.state.players.get(client.sessionId);
        if (!ent || !ps || ps.isBot) return;

        const personalId = `cub-own-${client.sessionId}`;
        // Pressing X while already driving your own personal scooter stows it cleanly!
        if (ps.vehicleId === personalId && ps.vehicleRole === 'driver') {
          this.stowPersonalScooter(client.sessionId);
          return;
        }

        this.releaseClientBench(client.sessionId);
        if (ps.vehicleId) {
          this.releaseClientVehicle(client.sessionId, false);
        }

        const paintId: ScooterPaintId =
          typeof payload?.paintId === 'string' && VALID_SCOOTER_PAINTS.has(payload.paintId)
            ? payload.paintId
            : VALID_SCOOTER_PAINTS.has(ps.scooterPaint as ScooterPaintId)
              ? (ps.scooterPaint as ScooterPaintId)
              : 'moss_green';
        ps.scooterPaint = paintId;

        // Place outside wooden pedestrian sanctuaries so bridges/verandas stay peaceful
        const pedCheck = checkPedestrianDeckZone(ent.x, ent.z);
        const spawnX = clamp(pedCheck.inside ? pedCheck.pushX : ent.x, -442, 442);
        const spawnZ = clamp(pedCheck.inside ? pedCheck.pushZ : ent.z, -442, 442);
        const spawnY = sampleGroundHeight(spawnX, spawnZ);
        const spawnYaw = ent.yaw;
        const now = Date.now();

        let sc = this.state.scooters.get(personalId);
        if (!sc) {
          sc = new ScooterSchema();
          sc.scooterId = personalId;
          sc.kind = 'personal';
          sc.ownerSessionId = client.sessionId;
          sc.plateLabel = `49-B1 ${String(1000 + (ps.numericId % 8999))}`;
          sc.passengerPose = 'hold_waist';
          sc.headlightOn = true;
          this.state.scooters.set(personalId, sc);
        } else if (sc.passengerSessionId && sc.passengerSessionId !== client.sessionId) {
          // Safely dismount any prior passenger before relocating personal scooter
          this.dismountSingleRider(sc.passengerSessionId);
        } else if (sc.driverSessionId && sc.driverSessionId !== client.sessionId) {
          this.dismountSingleRider(sc.driverSessionId);
        }

        sc.paintId = paintId;
        sc.parkedX = spawnX;
        sc.parkedY = spawnY;
        sc.parkedZ = spawnZ;
        sc.parkedYaw = spawnYaw;

        this.scooterRuntimes.set(personalId, {
          scooterId: personalId,
          kind: 'personal',
          homeX: spawnX,
          homeY: spawnY,
          homeZ: spawnZ,
          homeYaw: spawnYaw,
          liveX: spawnX,
          liveY: spawnY,
          liveZ: spawnZ,
          liveYaw: spawnYaw,
          lastActiveAtMs: now,
          lastSchemaSyncAtMs: now,
        });

        const shouldAutoMount =
          payload?.autoMount !== false && Math.hypot(spawnX - ent.x, spawnZ - ent.z) <= 5.5;
        if (shouldAutoMount) {
          this.mountClientOntoScooter(client, sc, 'driver');
        } else {
          const ack: VehicleAckPayload = {
            ok: true,
            scooterId: null,
            role: 'none',
            x: spawnX,
            y: spawnY,
            z: spawnZ,
            yaw: spawnYaw,
            reason: pedCheck.inside
              ? `🛵 Đã dựng xe Super Cub chờ bạn ngay bên ngoài ${pedCheck.zoneLabel}!`
              : '🛵 Đã gọi xe Super Cub 50 bên cạnh bạn!',
          };
          client.send('vehicle_ack', ack);
        }
      }
    );

    this.onMessage(
      'vehicle_interact',
      (
        client,
        payload: {
          scooterId?: string;
          action?:
            | 'mount_any'
            | 'mount_driver'
            | 'mount_passenger'
            | 'dismount'
            | 'toggle_light'
            | 'toggle_pose'
            | 'stow';
        }
      ) => {
        const ent = this.humanEntities.get(client.sessionId);
        const ps = this.state.players.get(client.sessionId);
        if (!ent || !ps || ps.isBot) return;

        const action = payload?.action || 'mount_any';

        if (action === 'dismount') {
          this.dismountSingleRider(client.sessionId);
          return;
        }

        if (action === 'stow') {
          this.stowPersonalScooter(client.sessionId);
          return;
        }

        if (action === 'toggle_light') {
          if (ps.vehicleRole === 'driver' && ps.vehicleId) {
            const sc = this.state.scooters.get(ps.vehicleId);
            if (sc) {
              sc.headlightOn = !sc.headlightOn;
              ent.headlightOn = sc.headlightOn;
            }
          }
          return;
        }

        if (action === 'toggle_pose') {
          if (ps.vehicleRole === 'passenger' && ps.vehicleId) {
            const sc = this.state.scooters.get(ps.vehicleId);
            if (sc) {
              const nextPose: PassengerPoseStyle =
                sc.passengerPose === 'hold_waist' ? 'free_hands' : 'hold_waist';
              sc.passengerPose = nextPose;
            }
          }
          return;
        }

        const targetScooterId =
          typeof payload?.scooterId === 'string' ? payload.scooterId.trim() : '';
        const sc = this.state.scooters.get(targetScooterId);
        const rt = this.scooterRuntimes.get(targetScooterId);
        if (!sc || !rt) {
          client.send('vehicle_ack', {
            ok: false,
            scooterId: null,
            role: 'none',
            reason: 'Không tìm thấy chiếc xe Cub này.',
          } satisfies VehicleAckPayload);
          return;
        }

        // Verify proximity to live scooter position (generous 6.5m tolerance for moving friend pickup!)
        let bikeX = rt.liveX;
        let bikeZ = rt.liveZ;
        if (sc.driverSessionId) {
          const dEnt = this.humanEntities.get(sc.driverSessionId);
          if (dEnt) {
            bikeX = dEnt.x;
            bikeZ = dEnt.z;
          }
        }
        if (Math.hypot(ent.x - bikeX, ent.z - bikeZ) > 6.8) {
          client.send('vehicle_ack', {
            ok: false,
            scooterId: null,
            role: 'none',
            reason: 'Xe đang ở hơi xa — lại gần thêm một chút để lên xe nhé!',
          } satisfies VehicleAckPayload);
          return;
        }

        const canDriveThisBike =
          sc.kind === 'station' || sc.ownerSessionId === client.sessionId;
        const driverFree = !sc.driverSessionId || sc.driverSessionId === client.sessionId;
        const passengerFree =
          !sc.passengerSessionId || sc.passengerSessionId === client.sessionId;

        if (
          (action === 'mount_driver' || action === 'mount_any') &&
          driverFree &&
          canDriveThisBike
        ) {
          this.mountClientOntoScooter(client, sc, 'driver');
          return;
        }

        if ((action === 'mount_passenger' || action === 'mount_any') && passengerFree) {
          this.mountClientOntoScooter(client, sc, 'passenger');
          return;
        }

        if (!canDriveThisBike && driverFree && action === 'mount_driver') {
          client.send('vehicle_ack', {
            ok: false,
            scooterId: null,
            role: 'none',
            reason: 'Đây là xe cá nhân của lữ khách khác — bạn có thể ngồi yên sau hoặc nhấn [X] gọi xe riêng nhé!',
          } satisfies VehicleAckPayload);
          return;
        }

        client.send('vehicle_ack', {
          ok: false,
          scooterId: null,
          role: 'none',
          reason: 'Chiếc Super Cub này đã đủ 2 người ngồi rồi!',
        } satisfies VehicleAckPayload);
      }
    );

    this.onMessage('vehicle_accept_invite', (client, payload: { scooterId?: string }) => {
      const ent = this.humanEntities.get(client.sessionId);
      const ps = this.state.players.get(client.sessionId);
      if (!ent || !ps || ps.isBot) return;

      const scooterId = typeof payload?.scooterId === 'string' ? payload.scooterId.trim() : '';
      const sc = this.state.scooters.get(scooterId);
      if (!sc || (sc.passengerSessionId && sc.passengerSessionId !== client.sessionId)) {
        client.send('vehicle_ack', {
          ok: false,
          scooterId: null,
          role: 'none',
          reason: 'Yên sau xe vừa có người ngồi mất rồi!',
        } satisfies VehicleAckPayload);
        return;
      }

      const dEnt = sc.driverSessionId ? this.humanEntities.get(sc.driverSessionId) : null;
      const bikeX = dEnt ? dEnt.x : sc.parkedX;
      const bikeZ = dEnt ? dEnt.z : sc.parkedZ;
      if (Math.hypot(ent.x - bikeX, ent.z - bikeZ) > 22.0) {
        client.send('vehicle_ack', {
          ok: false,
          scooterId: null,
          role: 'none',
          reason: 'Tài xế đã chạy hơi xa — hãy lại gần hơn để lên xe nhé!',
        } satisfies VehicleAckPayload);
        return;
      }

      this.mountClientOntoScooter(client, sc, 'passenger');
    });

    this.onMessage('vehicle_horn', (client) => {
      const ent = this.humanEntities.get(client.sessionId);
      const ps = this.state.players.get(client.sessionId);
      if (!ent || !ps || ps.vehicleRole !== 'driver' || !ps.vehicleId) return;

      const now = Date.now();
      if (now - ent.lastHornAtMs < 320) return;
      ent.lastHornAtMs = now;

      const hornEvt: VehicleHornEvent = {
        scooterId: ps.vehicleId,
        senderId: client.sessionId,
        senderName: ps.displayName,
        x: ent.x,
        y: ent.y,
        z: ent.z,
        timestamp: now,
      };

      for (let i = 0; i < this.clients.length; i++) {
        const c = this.clients[i];
        if (c.sessionId === client.sessionId) {
          c.send('vehicle_horn', hornEvt);
          continue;
        }
        const other = this.humanEntities.get(c.sessionId);
        if (other && Math.hypot(other.x - ent.x, other.z - ent.z) <= 42) {
          c.send('vehicle_horn', hornEvt);
        }
      }
    });

    // 8. Acoustic campfire jam around Tiệm Cà Phê Mơ Sương (45m radius)
    this.onMessage(
      'jam_note',
      (
        client,
        payload: { chordIndex?: number; instrument?: AcousticJamNote['instrument'] }
      ) => {
        const ent = this.humanEntities.get(client.sessionId);
        const ps = this.state.players.get(client.sessionId);
        if (!ent || !ps) return;

        const now = Date.now();
        if (now - ent.lastJamAtMs < 85) return;
        ent.lastJamAtMs = now;

        const rawChord = typeof payload?.chordIndex === 'number' ? Math.round(payload.chordIndex) : 0;
        const chordIndex = clamp(rawChord, 0, 5);
        const instrument: AcousticJamNote['instrument'] =
          typeof payload?.instrument === 'string' && VALID_INSTRUMENTS.has(payload.instrument)
            ? payload.instrument
            : 'guitar';

        const jam: AcousticJamNote = {
          senderId: client.sessionId,
          senderName: ps.displayName,
          chordIndex,
          instrument,
          timestamp: now,
        };

        for (let i = 0; i < this.clients.length; i++) {
          const target = this.clients[i];
          if (target.sessionId === client.sessionId) {
            target.send('jam_note', jam);
            continue;
          }
          const other = this.humanEntities.get(target.sessionId);
          if (other && Math.hypot(other.x - ent.x, other.z - ent.z) <= JAM_BROADCAST_RADIUS) {
            target.send('jam_note', jam);
          }
        }
      }
    );

    // 9. Durable Polaroid Wall pin & like (with explicit polaroid_pin_ack so UI never falsely toasts success)
    this.onMessage(
      'polaroid_pin',
      (client, payload: Partial<Omit<PolaroidEntry, 'id' | 'likes' | 'createdAt'>>) => {
        const ent = this.humanEntities.get(client.sessionId);
        const ps = this.state.players.get(client.sessionId);
        if (!ent || !ps) return;

        const now = Date.now();
        if (now - ent.lastPolaroidAtMs < 2500) {
          const ack: PolaroidPinAck = {
            ok: false,
            reason: 'Bạn vừa ghim ảnh, vui lòng đợi vài giây nhé.',
          };
          client.send('polaroid_pin_ack', ack);
          return;
        }

        const rawImage = typeof payload?.imageDataUrl === 'string' ? payload.imageDataUrl.trim() : '';
        if (!rawImage.startsWith('data:image/') || rawImage.length > MAX_IMAGE_DATA_LEN) {
          const ack: PolaroidPinAck = {
            ok: false,
            reason: 'Ảnh quá lớn hoặc không hợp lệ để ghim lên bảng chung.',
          };
          client.send('polaroid_pin_ack', ack);
          return;
        }

        ent.lastPolaroidAtMs = now;
        const created = worldPersistence.addPolaroid(payload || {}, ps.displayName);
        if (created) {
          CloudHuntingRoom.broadcastAcrossShards('polaroid_added', created);
          const ack: PolaroidPinAck = { ok: true, polaroidId: created.id };
          client.send('polaroid_pin_ack', ack);
        } else {
          const ack: PolaroidPinAck = {
            ok: false,
            reason: 'Không thể lưu tấm ảnh lên bảng lúc này.',
          };
          client.send('polaroid_pin_ack', ack);
        }
      }
    );

    this.onMessage('polaroid_like', (client, payload: { polaroidId?: string }) => {
      const ent = this.humanEntities.get(client.sessionId);
      if (!ent || typeof payload?.polaroidId !== 'string') return;
      if (ent.likedPolaroids.has(payload.polaroidId)) return;

      const updated = worldPersistence.likePolaroid(payload.polaroidId);
      if (updated) {
        ent.likedPolaroids.add(payload.polaroidId);
        CloudHuntingRoom.broadcastAcrossShards('polaroid_liked', updated);
      }
    });

    // 10. Durable Wind-Chime wish on Cây Thông Cô Đơn
    this.onMessage('windchime_add', (client, payload: { message?: string }) => {
      const ent = this.humanEntities.get(client.sessionId);
      const ps = this.state.players.get(client.sessionId);
      if (!ent || !ps) return;

      const now = Date.now();
      if (now - ent.lastChimeAtMs < 2000) return;
      ent.lastChimeAtMs = now;

      const note = worldPersistence.addWindChime(payload?.message, ps.displayName);
      if (note) {
        CloudHuntingRoom.broadcastAcrossShards('windchime_added', note);
      }
    });

    // Graceful catch-all so unknown message types never disconnect a client
    this.onUnhandledMessage = () => {};
  }

  private static broadcastAcrossShards(type: string, payload: unknown): void {
    for (const room of activeCloudRooms.values()) {
      room.broadcast(type, payload);
    }
  }

  private releaseClientBench(sessionId: string): void {
    const ps = this.state.players.get(sessionId);
    if (ps) {
      if (ps.seatId) {
        if (this.state.occupiedBenches.get(ps.seatId) === sessionId) {
          this.state.occupiedBenches.delete(ps.seatId);
        }
        ps.seatId = '';
      }
      if (ps.emote === 'sit_chill') {
        ps.emote = 'none';
      }
    }
    for (const [benchId, holder] of this.state.occupiedBenches.entries()) {
      if (holder === sessionId) {
        this.state.occupiedBenches.delete(benchId);
      }
    }
  }

  private mountClientOntoScooter(
    client: Client,
    sc: ScooterSchema,
    role: 'driver' | 'passenger'
  ): void {
    const ent = this.humanEntities.get(client.sessionId);
    const ps = this.state.players.get(client.sessionId);
    if (!ent || !ps) return;

    this.releaseClientBench(client.sessionId);
    if (ps.vehicleId && (ps.vehicleId !== sc.scooterId || ps.vehicleRole !== role)) {
      this.releaseClientVehicle(client.sessionId, false);
    }

    const rt = this.scooterRuntimes.get(sc.scooterId);
    const dEnt = sc.driverSessionId ? this.humanEntities.get(sc.driverSessionId) : null;
    const baseX = dEnt ? dEnt.x : rt ? rt.liveX : sc.parkedX;
    const baseY = dEnt ? dEnt.y : rt ? rt.liveY : sc.parkedY;
    const baseZ = dEnt ? dEnt.z : rt ? rt.liveZ : sc.parkedZ;
    const baseYaw = dEnt ? dEnt.yaw : rt ? rt.liveYaw : sc.parkedYaw;
    const now = Date.now();

    if (role === 'driver') {
      sc.driverSessionId = client.sessionId;
      ps.vehicleId = sc.scooterId;
      ps.vehicleRole = 'driver';
      ps.emote = 'none';
      ent.x = baseX;
      ent.y = baseY;
      ent.z = baseZ;
      ent.yaw = baseYaw;
      ent.vx = 0;
      ent.vz = 0;
      ent.isDriving = true;
      ent.isPassenger = false;
      ent.isBraking = false;
      ent.headlightOn = sc.headlightOn;
      ent.burstSlackMeters = 24.0;
      ent.clampStreak = 0;
      ent.lastTeleportAtMs = now;
    } else {
      sc.passengerSessionId = client.sessionId;
      ps.vehicleId = sc.scooterId;
      ps.vehicleRole = 'passenger';
      ps.emote = 'none';
      const backOff = WORLD_CONSTANTS.SCOOTER_PILLION_BACK_OFFSET;
      ent.x = baseX - Math.sin(baseYaw) * backOff;
      ent.y = baseY;
      ent.z = baseZ - Math.cos(baseYaw) * backOff;
      ent.yaw = baseYaw;
      ent.vx = dEnt ? dEnt.vx : 0;
      ent.vz = dEnt ? dEnt.vz : 0;
      ent.isDriving = false;
      ent.isPassenger = true;
      ent.isBraking = false;
      ent.headlightOn = sc.headlightOn;
      ent.burstSlackMeters = 8.5;
      ent.clampStreak = 0;
      ent.lastTeleportAtMs = now;

      if (sc.driverSessionId && sc.driverSessionId !== client.sessionId) {
        const driverClient = this.clients.find((c) => c.sessionId === sc.driverSessionId);
        if (driverClient) {
          driverClient.send('vehicle_passenger_event', {
            scooterId: sc.scooterId,
            passengerId: client.sessionId,
            passengerName: ps.displayName,
            joined: true,
          });
        }
      }
    }

    ps.spawnX = ent.x;
    ps.spawnY = ent.y;
    ps.spawnZ = ent.z;
    ps.spawnYaw = ent.yaw;
    if (rt) {
      rt.lastActiveAtMs = now;
    }

    const ack: VehicleAckPayload = {
      ok: true,
      scooterId: sc.scooterId,
      role,
      x: baseX,
      y: baseY,
      z: baseZ,
      yaw: baseYaw,
    };
    client.send('vehicle_ack', ack);
  }

  private dismountSingleRider(sessionId: string, reasonToast?: string): void {
    const ent = this.humanEntities.get(sessionId);
    const ps = this.state.players.get(sessionId);
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!ps || !ps.vehicleId) {
      if (ent) {
        ent.isDriving = false;
        ent.isPassenger = false;
        ent.isBraking = false;
      }
      return;
    }

    const sc = this.state.scooters.get(ps.vehicleId);
    const rt = this.scooterRuntimes.get(ps.vehicleId);
    const wasDriver = ps.vehicleRole === 'driver';
    const dEnt = sc?.driverSessionId ? this.humanEntities.get(sc.driverSessionId) : null;
    const bikeX = dEnt ? dEnt.x : rt ? rt.liveX : ent ? ent.x : 0;
    const bikeZ = dEnt ? dEnt.z : rt ? rt.liveZ : ent ? ent.z : 0;
    const bikeYaw = dEnt ? dEnt.yaw : rt ? rt.liveYaw : ent ? ent.yaw : 0;
    const now = Date.now();

    if (sc) {
      if (sc.driverSessionId === sessionId) {
        sc.driverSessionId = '';
        const groundY = sampleGroundHeight(bikeX, bikeZ);
        sc.parkedX = bikeX;
        sc.parkedY = groundY;
        sc.parkedZ = bikeZ;
        sc.parkedYaw = bikeYaw;
        if (rt) {
          rt.liveX = bikeX;
          rt.liveY = groundY;
          rt.liveZ = bikeZ;
          rt.liveYaw = bikeYaw;
          rt.lastActiveAtMs = now;
          rt.lastSchemaSyncAtMs = now;
        }
      }
      if (sc.passengerSessionId === sessionId) {
        sc.passengerSessionId = '';
        if (sc.driverSessionId && sc.driverSessionId !== sessionId) {
          const driverClient = this.clients.find((c) => c.sessionId === sc.driverSessionId);
          if (driverClient) {
            driverClient.send('vehicle_passenger_event', {
              scooterId: sc.scooterId,
              passengerId: sessionId,
              passengerName: ps.displayName,
              joined: false,
            });
          }
        }
      }
    }

    // Step off cleanly to left (-0.92m) for driver, right (+0.92m) for passenger
    const sideSign = wasDriver ? -1 : 1;
    const rawExitX = clamp(bikeX + Math.cos(bikeYaw) * 0.92 * sideSign, -444, 444);
    const rawExitZ = clamp(bikeZ - Math.sin(bikeYaw) * 0.92 * sideSign, -444, 444);
    const exitY = sampleWalkableHeight(rawExitX, rawExitZ);

    ps.vehicleId = '';
    ps.vehicleRole = '';
    if (ent) {
      ent.x = rawExitX;
      ent.y = exitY;
      ent.z = rawExitZ;
      ent.vx = 0;
      ent.vz = 0;
      ent.moving = false;
      ent.running = false;
      ent.grounded = true;
      ent.isDriving = false;
      ent.isPassenger = false;
      ent.isBraking = false;
      ent.burstSlackMeters = 6.5;
      ent.clampStreak = 0;
      ent.lastTeleportAtMs = now;
      ps.spawnX = rawExitX;
      ps.spawnY = exitY;
      ps.spawnZ = rawExitZ;
    }

    if (client) {
      const ack: VehicleAckPayload = {
        ok: true,
        scooterId: null,
        role: 'none',
        x: rawExitX,
        y: exitY,
        z: rawExitZ,
        yaw: bikeYaw,
        reason: reasonToast,
      };
      client.send('vehicle_ack', ack);
    }
  }

  private stowPersonalScooter(ownerSessionId: string): void {
    const personalId = `cub-own-${ownerSessionId}`;
    const sc = this.state.scooters.get(personalId);
    if (!sc) return;

    if (sc.passengerSessionId) {
      this.dismountSingleRider(
        sc.passengerSessionId,
        '🛵 Chủ xe đã cất chiếc Super Cub — bạn đã xuống xe an toàn!'
      );
    }
    if (sc.driverSessionId) {
      this.dismountSingleRider(sc.driverSessionId, '🛵 Đã cất xe Super Cub 50 gọn gàng.');
    } else {
      const ownerClient = this.clients.find((c) => c.sessionId === ownerSessionId);
      if (ownerClient) {
        ownerClient.send('vehicle_ack', {
          ok: true,
          scooterId: null,
          role: 'none',
          reason: '🛵 Đã cất xe Super Cub 50 gọn gàng.',
        } satisfies VehicleAckPayload);
      }
    }

    this.state.scooters.delete(personalId);
    this.scooterRuntimes.delete(personalId);
  }

  private releaseClientVehicle(sessionId: string, destroyOwnedPersonal: boolean): void {
    const ps = this.state.players.get(sessionId);
    const activeVehId = ps?.vehicleId || '';
    if (activeVehId) {
      const sc = this.state.scooters.get(activeVehId);
      const wasDriver = sc?.driverSessionId === sessionId;
      const attachedPassenger = wasDriver ? sc?.passengerSessionId || '' : '';
      this.dismountSingleRider(sessionId);
      if (destroyOwnedPersonal && attachedPassenger) {
        this.dismountSingleRider(
          attachedPassenger,
          '🛵 Tài xế vừa rời kênh — bạn đã xuống xe an toàn!'
        );
      }
    }

    // Also sweep any scooter still referencing sessionId
    for (const [sid, sc] of this.state.scooters.entries()) {
      if (sc.driverSessionId === sessionId) {
        sc.driverSessionId = '';
      }
      if (sc.passengerSessionId === sessionId) {
        sc.passengerSessionId = '';
      }
      if (destroyOwnedPersonal && sc.kind === 'personal' && sc.ownerSessionId === sessionId) {
        if (sc.passengerSessionId) {
          this.dismountSingleRider(
            sc.passengerSessionId,
            '🛵 Tài xế vừa rời kênh — bạn đã xuống xe an toàn!'
          );
        }
        if (sc.driverSessionId) {
          this.dismountSingleRider(sc.driverSessionId);
        }
        this.state.scooters.delete(sid);
        this.scooterRuntimes.delete(sid);
      }
    }
  }

  private handleMovePacket(client: Client, bytes: Uint8Array): void {
    const ent = this.humanEntities.get(client.sessionId);
    if (!ent) return;

    const pkt = decodeClientMove(bytes);
    if (!pkt) return;
    if (
      !Number.isFinite(pkt.x) ||
      !Number.isFinite(pkt.y) ||
      !Number.isFinite(pkt.z) ||
      !Number.isFinite(pkt.yaw)
    ) {
      return;
    }

    if (ent.hasReceivedMove) {
      const seqDiff = ((pkt.seq - ent.lastSeq) << 16) >> 16;
      if (seqDiff < 0) {
        return; // Out-of-order stale frame
      }
    }

    const ps = this.state.players.get(client.sessionId);
    if (!ps) return;

    // Passengers are authoritatively mirrored directly onto their driver's scooter rear anchor!
    if (ps.vehicleRole === 'passenger' && ps.vehicleId) {
      ent.warmBuff = pkt.warmBuff;
      ent.lastSeq = pkt.seq;
      ent.lastMoveAtMs = performance.now();
      ent.hasReceivedMove = true;
      return;
    }

    const isDriver = ps.vehicleRole === 'driver' && Boolean(ps.vehicleId);

    const now = performance.now();
    const wallNow = Date.now();
    const rawWallDtSec = ent.hasReceivedMove ? clamp((now - ent.lastMoveAtMs) / 1000, 0, 2.5) : 0.083;
    const dtSec = clamp(rawWallDtSec, 0.015, 0.5);

    // 1. Clamp horizontal world bounds [-445, 445]
    let nx = clamp(pkt.x, -445, 445);
    let nz = clamp(pkt.z, -445, 445);

    // 2. O(1) jitter-tolerant Wall-Clock Token Bucket horizontal speed validation
    // Absorbs up to ~1.2s of Wi-Fi / GC TCP packet batching at 69 km/h with zero false pose_correct rubber-banding!
    if (ent.hasReceivedMove) {
      const dx = nx - ent.x;
      const dz = nz - ent.z;
      const horizDist = Math.hypot(dx, dz);
      const maxAllowedSpeed = isDriver ? 26.5 : WORLD_CONSTANTS.MAX_RUN_SPEED * 1.65;
      const maxSlack = isDriver ? 24.0 : 6.5;
      const stepBudget = Math.min(maxSlack + rawWallDtSec * maxAllowedSpeed, ent.burstSlackMeters + rawWallDtSec * maxAllowedSpeed);

      if (horizDist > stepBudget) {
        // Allow legitimate Landmark Fast-Travel or Companion Friend-Teleport with a 200ms cooldown
        if (
          (isNearAnyLandmark(nx, nz) || this.isNearAnyPlayer(nx, nz, client.sessionId)) &&
          wallNow - ent.lastTeleportAtMs > 200
        ) {
          this.releaseClientBench(client.sessionId);
          ent.lastTeleportAtMs = wallNow;
          ent.burstSlackMeters = maxSlack;
          ent.clampStreak = 0;
          ps.spawnX = nx;
          ps.spawnY = sampleWalkableHeight(nx, nz);
          ps.spawnZ = nz;
          ps.spawnYaw = pkt.yaw;
        } else {
          // Clamp horizontal displacement to token-bucket budget & reconcile persistent speed-hack drift
          const cutMeters = horizDist - stepBudget;
          const scale = stepBudget / (horizDist || 1);
          nx = ent.x + dx * scale;
          nz = ent.z + dz * scale;
          ent.burstSlackMeters = 0;
          if (cutMeters > (isDriver ? 24.0 : 8.5)) {
            ent.clampStreak += 1;
            if (ent.clampStreak >= 6) {
              ent.clampStreak = 0;
              const groundClampY = sampleGroundHeight(nx, nz);
              const walkClampY = sampleWalkableHeight(nx, nz);
              const maxAir = isDriver ? 28.0 : 6.5;
              const correction: ServerPoseCorrection = {
                x: nx,
                y: clamp(pkt.y, groundClampY - 0.5, walkClampY + maxAir),
                z: nz,
                yaw: pkt.yaw,
                reason: 'speed_clamp',
              };
              client.send('pose_correct', correction);
            }
          }
        }
      } else {
        ent.burstSlackMeters = Math.min(maxSlack, stepBudget - horizDist);
        ent.clampStreak = 0;
      }
    }

    // 3. Terrain walkable height & ballistic crest-jump airtime validation (+26m envelope for flying scooters!)
    const walkY = sampleWalkableHeight(nx, nz);
    const maxAirHeight = isDriver ? 26.0 : 6.5;
    let ny = clamp(pkt.y, walkY - 2.5, walkY + maxAirHeight);
    if (pkt.grounded && ny < walkY - 0.35) {
      ny = walkY;
    }

    // 4. Smooth horizontal velocity estimate for client Cubic Hermite spline tangents
    const maxVelClamp = isDriver ? 24.5 : 11.5;
    if (ent.hasReceivedMove && pkt.moving && wallNow - ent.lastTeleportAtMs > 250) {
      const instVx = clamp((nx - ent.x) / dtSec, -maxVelClamp, maxVelClamp);
      const instVz = clamp((nz - ent.z) / dtSec, -maxVelClamp, maxVelClamp);
      ent.vx = ent.vx * 0.32 + instVx * 0.68;
      ent.vz = ent.vz * 0.32 + instVz * 0.68;
    } else if (!pkt.moving) {
      ent.vx = 0;
      ent.vz = 0;
    }

    ent.x = nx;
    ent.y = ny;
    ent.z = nz;
    ent.yaw = pkt.yaw;
    ent.moving = pkt.moving;
    ent.running = pkt.running;
    ent.grounded = pkt.grounded;
    ent.warmBuff = pkt.warmBuff;
    ent.isDriving = isDriver;
    ent.isPassenger = false;
    ent.isBraking = isDriver ? Boolean(pkt.isBraking) : false;
    ent.lastSeq = pkt.seq;
    ent.lastMoveAtMs = now;
    ent.hasReceivedMove = true;

    // 4b. Mirror live scooter transform & lock attached passenger's server entity 1:1 to rear pillion!
    if (isDriver && ps.vehicleId) {
      const sc = this.state.scooters.get(ps.vehicleId);
      const rt = this.scooterRuntimes.get(ps.vehicleId);
      if (sc) {
        ent.headlightOn = sc.headlightOn;
        if (rt) {
          rt.liveX = nx;
          rt.liveY = ny;
          rt.liveZ = nz;
          rt.liveYaw = pkt.yaw;
          rt.lastActiveAtMs = wallNow;
          // Only sync parked Schema coords when scooter is stationary (zero 1Hz React re-renders while driving!)
          if (!pkt.moving && wallNow - rt.lastSchemaSyncAtMs >= 2500) {
            sc.parkedX = nx;
            sc.parkedY = sampleGroundHeight(nx, nz);
            sc.parkedZ = nz;
            sc.parkedYaw = pkt.yaw;
            rt.lastSchemaSyncAtMs = wallNow;
          }
        }
        if (sc.passengerSessionId) {
          const pEnt = this.humanEntities.get(sc.passengerSessionId);
          if (pEnt) {
            const backOff = WORLD_CONSTANTS.SCOOTER_PILLION_BACK_OFFSET;
            pEnt.x = nx - Math.sin(pkt.yaw) * backOff;
            pEnt.y = ny;
            pEnt.z = nz - Math.cos(pkt.yaw) * backOff;
            pEnt.yaw = pkt.yaw;
            pEnt.vx = ent.vx;
            pEnt.vz = ent.vz;
            pEnt.moving = pkt.moving;
            pEnt.running = pkt.running;
            pEnt.grounded = pkt.grounded;
            pEnt.isDriving = false;
            pEnt.isPassenger = true;
            pEnt.isBraking = ent.isBraking;
            pEnt.headlightOn = sc.headlightOn;
          }
        }
      }
    }

    // 5. Auto-release bench seat if player walks or fast-travels away (even if stationary on arrival)
    if (ps.seatId) {
      const seatTransform = resolveBenchSeatTransform(ps.seatId);
      if (
        !seatTransform ||
        Math.hypot(nx - seatTransform.position[0], nz - seatTransform.position[2]) > 1.05
      ) {
        this.releaseClientBench(client.sessionId);
      }
    }
  }

  onJoin(
    client: Client,
    options?: {
      tabId?: string;
      leaveSecret?: string;
      displayName?: string;
      outfit?: Partial<PlayerOutfit>;
      heldItem?: HeldItemId;
      x?: number;
      z?: number;
    }
  ): void {
    const cleanTabId =
      typeof options?.tabId === 'string' ? options.tabId.trim().slice(0, 64) : '';
    const cleanSecret =
      typeof options?.leaveSecret === 'string' && options.leaveSecret.trim().length >= 12
        ? options.leaveSecret.trim().slice(0, 128)
        : crypto.randomUUID();
    if (cleanTabId) {
      this.evictClientSession(undefined, cleanTabId, cleanSecret, client.sessionId);
    }

    const numericId = this.allocateNumericId();
    const defaultSpawn = LANDMARKS['quan-mo-suong'].position;
    // Slight ring jitter around Mơ Sương courtyard so simultaneous joiners never stack identically
    const angle = (numericId * 2.39996) % (Math.PI * 2);
    const radius = 2.2 + (numericId % 4) * 0.85;
    let rawX =
      typeof options?.x === 'number' && Number.isFinite(options.x)
        ? clamp(options.x, -445, 445)
        : defaultSpawn[0] - 4 + Math.cos(angle) * radius;
    let rawZ =
      typeof options?.z === 'number' && Number.isFinite(options.z)
        ? clamp(options.z, -445, 445)
        : defaultSpawn[2] + 3 + Math.sin(angle) * radius;

    // Prevent spawning directly on top of another player (0.0m overlap)
    for (let attempt = 0; attempt < 8; attempt++) {
      let tooClose = false;
      for (const other of this.humanEntities.values()) {
        if (Math.hypot(other.x - rawX, other.z - rawZ) < 1.15) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) break;
      const offsetAngle = angle + attempt * 1.15;
      rawX = -30.2 + Math.cos(offsetAngle) * (1.35 + attempt * 0.35);
      rawZ = 31.8 + Math.sin(offsetAngle) * (1.55 + attempt * 0.45);
    }
    const spawnY = sampleWalkableHeight(rawX, rawZ);

    const outfit = sanitizeOutfit(options?.outfit);
    const cleanName =
      sanitizeSocialText(options?.displayName, 28) || `Lữ Khách #${10 + (numericId % 89)}`;
    const heldItem: HeldItemId =
      typeof options?.heldItem === 'string' && VALID_HELD_ITEMS.has(options.heldItem)
        ? options.heldItem
        : 'soy_milk';

    const ps = new PlayerSchema();
    ps.numericId = numericId;
    ps.sessionId = client.sessionId;
    ps.displayName = cleanName;
    ps.gender = resolveEffectiveGender(outfit);
    ps.coatStyle = outfit.coatStyle;
    ps.coatColor = outfit.coatColor;
    ps.scarfColor = outfit.scarfColor;
    ps.headwear = outfit.headwear;
    ps.neckwear = resolveEffectiveNeckwear(outfit);
    ps.eyewear = resolveEffectiveEyewear(outfit);
    ps.bagStyle = resolveEffectiveBagStyle(outfit);
    ps.scooterPaint = resolveEffectiveScooterPaint(outfit);
    ps.hairColor = outfit.hairColor;
    ps.backpack = outfit.backpack;
    ps.heldItem = heldItem;
    ps.emote = 'none';
    ps.seatId = '';
    ps.vehicleId = '';
    ps.vehicleRole = '';
    ps.isBot = false;
    ps.spawnX = rawX;
    ps.spawnY = spawnY;
    ps.spawnZ = rawZ;
    ps.spawnYaw = 1.35;

    this.state.players.set(client.sessionId, ps);

    this.humanEntities.set(client.sessionId, {
      sessionId: client.sessionId,
      tabId: cleanTabId,
      leaveSecret: cleanSecret,
      numericId,
      x: rawX,
      y: spawnY,
      z: rawZ,
      yaw: 1.35,
      vx: 0,
      vz: 0,
      moving: false,
      running: false,
      grounded: true,
      warmBuff: true,
      isDriving: false,
      isPassenger: false,
      isBraking: false,
      headlightOn: true,
      hasReceivedMove: false,
      hydratedWorldInit: false,
      clampStreak: 0,
      lastSeq: 0,
      lastMoveAtMs: performance.now(),
      burstSlackMeters: 4.5,
      lastTeleportAtMs: 0,
      lastChatAtMs: 0,
      lastSocialAtMs: 0,
      lastJamAtMs: 0,
      lastHornAtMs: 0,
      lastPolaroidAtMs: 0,
      lastChimeAtMs: 0,
      likedPolaroids: new Set<string>(),
    });

    this.syncAmbientBots();

    // Fallback hydration ONLY if client did not already pull via `req_world_init` (prevents 2x world_init!)
    setTimeout(() => {
      const ent = this.humanEntities.get(client.sessionId);
      if (ent && !ent.hydratedWorldInit) {
        ent.hydratedWorldInit = true;
        this.sendWorldHydration(client, numericId);
      }
    }, 350);
  }

  private sendWorldHydration(client: Client, numericId: number): void {
    client.send('world_init', {
      numericId,
      roomId: this.roomId,
      roomCode: this.roomCode,
      channelName: this.channelName,
      serverEpochMs: Date.now(),
      polaroids: worldPersistence.getPolaroids(),
      windChimeNotes: worldPersistence.getWindChimeNotes(),
    });
  }

  onDrop(client: Client): void {
    // Free shared bench & vehicle seat immediately while holding player's room slot for 45s reconnection
    this.releaseClientBench(client.sessionId);
    this.releaseClientVehicle(client.sessionId, false);
    const ent = this.humanEntities.get(client.sessionId);
    if (ent) {
      ent.moving = false;
      ent.running = false;
      ent.vx = 0;
      ent.vz = 0;
    }
    const deferred = this.allowReconnection(client, 45);
    this.pendingReconnections.set(client.sessionId, deferred);
    deferred
      .then(() => {
        this.pendingReconnections.delete(client.sessionId);
      })
      .catch(() => {
        this.pendingReconnections.delete(client.sessionId);
        this.releaseClientBench(client.sessionId);
        this.releaseClientVehicle(client.sessionId, true);
        this.humanEntities.delete(client.sessionId);
        this.state.players.delete(client.sessionId);
        this.syncAmbientBots();
      });
  }

  onReconnect(client: Client): void {
    this.pendingReconnections.delete(client.sessionId);
    const ent = this.humanEntities.get(client.sessionId);
    if (ent) {
      ent.hydratedWorldInit = true;
      this.sendWorldHydration(client, ent.numericId);
    }
  }

  onLeave(client: Client): void {
    this.pendingReconnections.delete(client.sessionId);
    this.releaseClientBench(client.sessionId);
    this.releaseClientVehicle(client.sessionId, true);
    this.humanEntities.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.syncAmbientBots();
  }

  onDispose(): void {
    activeCloudRooms.delete(this.roomId);
    usedShardIndices.delete(this.shardIndex);
    worldPersistence.flushToDiskNow();
  }

  private tickSimulation(dtMs: number): void {
    this.serverTick = (this.serverTick + 1) & 0xffff;

    if (this.clients.length === 0) {
      return;
    }

    // Step friendly ambient highland hikers when shard has < 6 human explorers
    if (this.ambientHikers) {
      this.syncAmbientBots();
      const botChanges = this.ambientHikers.step(clamp(dtMs / 1000, 0.02, 0.25));
      for (let i = 0; i < botChanges.length; i++) {
        const ch = botChanges[i];
        const botPs = this.state.players.get(ch.sessionId);
        if (botPs) {
          botPs.emote = ch.emote;
          botPs.heldItem = ch.heldItem;
        }
      }
    }

    // Auto-return unoccupied station scooters abandoned > 90s away from their landmark home turnout
    if (this.serverTick % 24 === 0) {
      const wallNow = Date.now();
      for (const [sid, rt] of this.scooterRuntimes.entries()) {
        if (rt.kind !== 'station') continue;
        const sc = this.state.scooters.get(sid);
        if (!sc || sc.driverSessionId || sc.passengerSessionId) {
          rt.lastActiveAtMs = wallNow;
          continue;
        }
        const distFromHome = Math.hypot(rt.liveX - rt.homeX, rt.liveZ - rt.homeZ);
        if (distFromHome > 4.0 && wallNow - rt.lastActiveAtMs >= 90_000) {
          rt.liveX = rt.homeX;
          rt.liveY = rt.homeY;
          rt.liveZ = rt.homeZ;
          rt.liveYaw = rt.homeYaw;
          rt.lastActiveAtMs = wallNow;
          rt.lastSchemaSyncAtMs = wallNow;
          sc.parkedX = rt.homeX;
          sc.parkedY = rt.homeY;
          sc.parkedZ = rt.homeZ;
          sc.parkedYaw = rt.homeYaw;
          sc.headlightOn = true;
        }
      }
    }

    // Collect all active human & ambient hiker peer transforms
    const allEntities: NearPeerTransform[] = [];
    for (const h of this.humanEntities.values()) {
      allEntities.push({
        numericId: h.numericId,
        x: h.x,
        y: h.y,
        z: h.z,
        yaw: h.yaw,
        vx: h.vx,
        vz: h.vz,
        moving: h.moving,
        running: h.running,
        grounded: h.grounded,
        warmBuff: h.warmBuff,
        isDriving: h.isDriving,
        isPassenger: h.isPassenger,
        isBraking: h.isBraking,
        headlightOn: h.headlightOn,
      });
    }
    if (this.ambientHikers) {
      for (const bot of this.ambientHikers.getAll()) {
        if (bot.active) {
          allEntities.push(this.ambientHikers.toNearTransform(bot));
        }
      }
    }

    // Standard Cozy Shard (<= 40 entities): single zero-copy broadcast frame to all clients
    if (allEntities.length <= AOI_POPULATION_THRESHOLD) {
      const packet = encodeWorldSnapshot(this.serverTick, allEntities, []);
      this.broadcastBytes('snap', packet, {});
      return;
    }

    // Crowded / Sunrise Festival Mode (> 40 entities): Two-Tier Spatial AOI!
    // Tier 1: Nearest 24 peers within 95m at full 12 Hz
    // Tier 2: Farther peers as compact 8-byte lantern silhouette beacons every 6th tick (2 Hz)
    const sendFarBeacons = this.serverTick % 6 === 0;

    for (let cIdx = 0; cIdx < this.clients.length; cIdx++) {
      const client = this.clients[cIdx];
      const viewer = this.humanEntities.get(client.sessionId);
      if (!viewer) continue;

      const scored: Array<{ ent: NearPeerTransform; distSq: number }> = [];
      for (let i = 0; i < allEntities.length; i++) {
        const candidate = allEntities[i];
        if (candidate.numericId === viewer.numericId) continue;
        const dx = candidate.x - viewer.x;
        const dz = candidate.z - viewer.z;
        scored.push({ ent: candidate, distSq: dx * dx + dz * dz });
      }

      scored.sort((a, b) => a.distSq - b.distSq);

      const nearPeers: NearPeerTransform[] = [];
      const farPeers: FarPeerBeacon[] = [];

      for (let i = 0; i < scored.length; i++) {
        const item = scored[i];
        if (nearPeers.length < AOI_MAX_NEAR_PEERS && item.distSq <= AOI_NEAR_RADIUS_SQ) {
          nearPeers.push(item.ent);
        } else if (sendFarBeacons && farPeers.length < 96) {
          farPeers.push({
            numericId: item.ent.numericId,
            x: item.ent.x,
            y: item.ent.y,
            z: item.ent.z,
          });
        }
      }

      const packet = encodeWorldSnapshot(this.serverTick, nearPeers, farPeers);
      client.sendBytes('snap', packet);
    }
  }
}
