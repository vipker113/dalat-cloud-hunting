import { Room, type Client } from '@colyseus/core';
import {
  type AcousticJamNote,
  type AvatarGender,
  BAG_CATALOG,
  type BagStyleId,
  type ChatBubbleMessage,
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
  LANDMARKS,
  type NearPeerTransform,
  NECKWEAR_CATALOG,
  type NeckwearId,
  type PlayerOutfit,
  type PolaroidEntry,
  resolveEffectiveBagStyle,
  resolveEffectiveEyewear,
  resolveEffectiveGender,
  resolveEffectiveNeckwear,
  sampleWalkableHeight,
  SHARED_BENCHES,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
import { AmbientHikerController, type AmbientHikerRuntime } from './ambientHikers';
import { sanitizeSocialText, worldPersistence } from './persistence';
import { CloudRoomState, PlayerSchema, type CloudRoomMetadata } from './schema';

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
  hasReceivedMove: boolean;
  lastSeq: number;
  lastMoveAtMs: number;
  burstSlackMeters: number;
  lastTeleportAtMs: number;
  lastChatAtMs: number;
  lastSocialAtMs: number;
  lastJamAtMs: number;
  lastPolaroidAtMs: number;
  lastChimeAtMs: number;
  likedPolaroids: Set<string>;
}

export const activeCloudRooms = new Map<string, CloudHuntingRoom>();
const usedShardIndices = new Set<number>();

function allocateChannelIdentity(requestedCode?: string): {
  roomCode: string;
  channelName: string;
  shardIndex: number;
} {
  const cleaned =
    typeof requestedCode === 'string'
      ? requestedCode
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9-]/g, '')
          .slice(0, 10)
      : '';

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
      channelName: `${title} (${cleaned})`,
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

  return {
    gender,
    coatStyle,
    coatColor: sanitizeHexColor(raw.coatColor, DEFAULT_OUTFIT.coatColor),
    scarfColor: sanitizeHexColor(raw.scarfColor, DEFAULT_OUTFIT.scarfColor),
    headwear,
    neckwear,
    eyewear,
    bagStyle,
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
  return false;
}

export class CloudHuntingRoom extends Room<{
  state: CloudRoomState;
  metadata: CloudRoomMetadata;
}> {
  private nextNumericId = 1;
  private serverTick = 0;
  private shardIndex = 1;
  public roomCode = 'MAY-01';
  public channelName = 'Sương Sớm Cầu Đất #1';

  private readonly humanEntities = new Map<string, HumanEntityTransform>();
  private ambientHikers!: AmbientHikerController;

  private allocateNumericId(): number {
    // Wrap safely in 1..65534
    for (let guard = 0; guard < 65535; guard++) {
      const candidate = this.nextNumericId;
      this.nextNumericId = this.nextNumericId >= 65534 ? 1 : this.nextNumericId + 1;
      let collision = false;
      for (const h of this.humanEntities.values()) {
        if (h.numericId === candidate) {
          collision = true;
          break;
        }
      }
      if (!collision && this.ambientHikers) {
        for (const b of this.ambientHikers.getAll()) {
          if (b.numericId === candidate) {
            collision = true;
            break;
          }
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

    this.maxClients = WORLD_CONSTANTS.HARD_ROOM_CAP;
    this.autoDispose = options?.keepAlive === true || this.shardIndex === 1 ? false : true;
    this.patchRate = 100; // 10 Hz low-frequency Schema metadata patches
    this.seatReservationTimeout = 20;
    this.maxMessagesPerSecond = 90;

    const state = new CloudRoomState();
    state.roomCode = this.roomCode;
    state.channelName = this.channelName;
    this.state = state;

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

    // Spawn 5 autonomous server-driven Da Lat cloud-hunters
    this.ambientHikers = new AmbientHikerController(() => this.allocateNumericId());
    for (const bot of this.ambientHikers.getAll()) {
      if (bot.active) {
        this.upsertBotSchema(bot);
      }
    }

    this.registerMessageHandlers();

    const tickIntervalMs = 1000 / WORLD_CONSTANTS.NET_TICK_HZ; // 83.333ms (12 Hz)
    this.setTimestep((dtMs) => this.tickSimulation(dtMs), tickIntervalMs);

    activeCloudRooms.set(this.roomId, this);
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
      if (ent) {
        this.sendWorldHydration(client, ent.numericId);
      }
    });

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
          ps.hairColor = outfit.hairColor;
          ps.backpack = outfit.backpack;
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

    // 6b. Quick Social Interactions (Wave / Warm Cup Clink / Cheer Sunrise)
    this.onMessage(
      'social_interact',
      (
        client,
        payload: { targetSessionId?: string; kind?: 'greet' | 'cheers' | 'cheer' }
      ) => {
        const ent = this.humanEntities.get(client.sessionId);
        const ps = this.state.players.get(client.sessionId);
        if (!ent || !ps) return;

        const now = Date.now();
        if (now - ent.lastSocialAtMs < 900) return;

        const targetId =
          typeof payload?.targetSessionId === 'string' ? payload.targetSessionId.trim() : '';
        const kind = payload?.kind;
        if (!targetId || (kind !== 'greet' && kind !== 'cheers' && kind !== 'cheer')) {
          return;
        }
        ent.lastSocialAtMs = now;

        // Check if target is a human peer or an autonomous ambient hiker within 10m
        const targetHuman = this.humanEntities.get(targetId);
        let midX = ent.x;
        let midY = ent.y + 1.45;
        let midZ = ent.z;

        if (targetHuman) {
          if (Math.hypot(targetHuman.x - ent.x, targetHuman.z - ent.z) > 10.5) return;
          midX = (ent.x + targetHuman.x) * 0.5;
          midY = (ent.y + targetHuman.y) * 0.5 + 1.48;
          midZ = (ent.z + targetHuman.z) * 0.5;
          if (kind === 'cheers') {
            ent.warmBuff = true;
            targetHuman.warmBuff = true;
          }
        } else {
          const botReaction = this.ambientHikers.reactToSocial(
            targetId,
            ent.x,
            ent.z,
            ps.displayName,
            kind
          );
          if (!botReaction) return;
          const { bot, emote, heldItem, replyText } = botReaction;
          if (Math.hypot(bot.x - ent.x, bot.z - ent.z) > 10.5) return;
          midX = (ent.x + bot.x) * 0.5;
          midY = (ent.y + bot.y) * 0.5 + 1.48;
          midZ = (ent.z + bot.z) * 0.5;
          if (kind === 'cheers') {
            ent.warmBuff = true;
          }

          const botSchema = this.state.players.get(bot.spec.sessionId);
          if (botSchema) {
            botSchema.emote = emote;
            botSchema.heldItem = heldItem;
          }

          // Broadcast warm Đà Lạt reply bubble from the ambient hiker within proximity
          const botBubble: ChatBubbleMessage = {
            id: `bot-msg-${now}-${Math.random().toString(36).slice(2, 6)}`,
            senderId: bot.spec.sessionId,
            senderName: bot.spec.displayName,
            text: replyText,
            x: bot.x,
            y: bot.y,
            z: bot.z,
            timestamp: now,
          };
          for (let i = 0; i < this.clients.length; i++) {
            const c = this.clients[i];
            const other = this.humanEntities.get(c.sessionId);
            if (
              c.sessionId === client.sessionId ||
              (other &&
                Math.hypot(other.x - bot.x, other.z - bot.z) <=
                  WORLD_CONSTANTS.PROXIMITY_CHAT_RADIUS)
            ) {
              c.send('chat_bubble', botBubble);
            }
          }
        }

        // Broadcast 3D social sparkle & toast event to nearby clients
        const evtPayload = {
          fromId: client.sessionId,
          fromName: ps.displayName,
          targetId,
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

    // 7. Atomic shared bench seating
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

      const bench = BENCH_BY_ID.get(requestedId);
      if (!bench) {
        client.send('seat_ack', { benchId: null, ok: false });
        return;
      }

      const currentOccupant = this.state.occupiedBenches.get(bench.id);
      if (currentOccupant && currentOccupant !== client.sessionId) {
        client.send('seat_ack', {
          benchId: null,
          ok: false,
          reason: 'Ghế gỗ này đang có lữ khách ngồi ngắm mây rồi!',
        });
        return;
      }

      // Release any previous seat held by this client first
      if (ps.seatId && ps.seatId !== bench.id) {
        this.releaseClientBench(client.sessionId);
      }

      this.state.occupiedBenches.set(bench.id, client.sessionId);
      ps.seatId = bench.id;
      ps.emote = 'sit_chill';

      ent.x = bench.position[0];
      ent.y = bench.position[1];
      ent.z = bench.position[2];
      ent.yaw = bench.yaw;
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
        benchId: bench.id,
        ok: true,
        position: bench.position,
        yaw: bench.yaw,
      });
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

    // 9. Durable Polaroid Wall pin & like
    this.onMessage(
      'polaroid_pin',
      (client, payload: Partial<Omit<PolaroidEntry, 'id' | 'likes' | 'createdAt'>>) => {
        const ent = this.humanEntities.get(client.sessionId);
        const ps = this.state.players.get(client.sessionId);
        if (!ent || !ps) return;

        const now = Date.now();
        if (now - ent.lastPolaroidAtMs < 2500) return;
        ent.lastPolaroidAtMs = now;

        const created = worldPersistence.addPolaroid(payload || {}, ps.displayName);
        if (created) {
          CloudHuntingRoom.broadcastAcrossShards('polaroid_added', created);
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

    const now = performance.now();
    const wallNow = Date.now();
    const dtSec = ent.hasReceivedMove ? clamp((now - ent.lastMoveAtMs) / 1000, 0.015, 0.5) : 0.083;

    // 1. Clamp horizontal world bounds [-445, 445]
    let nx = clamp(pkt.x, -445, 445);
    let nz = clamp(pkt.z, -445, 445);

    // 2. O(1) jitter-tolerant leaky-bucket horizontal speed validation
    if (ent.hasReceivedMove) {
      const dx = nx - ent.x;
      const dz = nz - ent.z;
      const horizDist = Math.hypot(dx, dz);
      const maxAllowedSpeed = WORLD_CONSTANTS.MAX_RUN_SPEED * 1.6; // 8.64 m/s
      const stepBudget = dtSec * maxAllowedSpeed + ent.burstSlackMeters;

      if (horizDist > stepBudget) {
        // Allow legitimate Landmark Fast-Travel with a 200ms cooldown
        if (isNearAnyLandmark(nx, nz) && wallNow - ent.lastTeleportAtMs > 200) {
          ent.lastTeleportAtMs = wallNow;
          ent.burstSlackMeters = 4.5;
          const ps = this.state.players.get(client.sessionId);
          if (ps) {
            ps.spawnX = nx;
            ps.spawnY = sampleWalkableHeight(nx, nz);
            ps.spawnZ = nz;
            ps.spawnYaw = pkt.yaw;
          }
        } else {
          // Clamp horizontal displacement to leaky-bucket budget
          const scale = stepBudget / (horizDist || 1);
          nx = ent.x + dx * scale;
          nz = ent.z + dz * scale;
          ent.burstSlackMeters = 0;
        }
      } else {
        ent.burstSlackMeters = Math.min(4.5, stepBudget - horizDist);
      }
    }

    // 3. Terrain walkable height validation (prevents fly-hacks and underground clipping)
    const walkY = sampleWalkableHeight(nx, nz);
    let ny = clamp(pkt.y, walkY - 2.5, walkY + 6.5);
    if (pkt.grounded && ny < walkY - 0.35) {
      ny = walkY;
    }

    // 4. Smooth horizontal velocity estimate for client Cubic Hermite spline tangents
    if (ent.hasReceivedMove && pkt.moving && wallNow - ent.lastTeleportAtMs > 250) {
      const instVx = clamp((nx - ent.x) / dtSec, -11.5, 11.5);
      const instVz = clamp((nz - ent.z) / dtSec, -11.5, 11.5);
      ent.vx = ent.vx * 0.35 + instVx * 0.65;
      ent.vz = ent.vz * 0.35 + instVz * 0.65;
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
    ent.lastSeq = pkt.seq;
    ent.lastMoveAtMs = now;
    ent.hasReceivedMove = true;

    // 5. Auto-release bench seat if player walks away
    const ps = this.state.players.get(client.sessionId);
    if (ps && ps.seatId) {
      const bench = BENCH_BY_ID.get(ps.seatId);
      if (!bench || (pkt.moving && Math.hypot(nx - bench.position[0], nz - bench.position[2]) > 0.85)) {
        this.releaseClientBench(client.sessionId);
      }
    }
  }

  onJoin(
    client: Client,
    options?: {
      displayName?: string;
      outfit?: Partial<PlayerOutfit>;
      heldItem?: HeldItemId;
      x?: number;
      z?: number;
    }
  ): void {
    const numericId = this.allocateNumericId();
    const defaultSpawn = LANDMARKS['quan-mo-suong'].position;
    // Slight ring jitter around Mơ Sương courtyard so simultaneous joiners never stack identically
    const angle = (numericId * 2.39996) % (Math.PI * 2);
    const radius = 2.2 + (numericId % 4) * 0.85;
    const rawX =
      typeof options?.x === 'number' && Number.isFinite(options.x)
        ? clamp(options.x, -445, 445)
        : defaultSpawn[0] - 4 + Math.cos(angle) * radius;
    const rawZ =
      typeof options?.z === 'number' && Number.isFinite(options.z)
        ? clamp(options.z, -445, 445)
        : defaultSpawn[2] + 3 + Math.sin(angle) * radius;
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
    ps.hairColor = outfit.hairColor;
    ps.backpack = outfit.backpack;
    ps.heldItem = heldItem;
    ps.emote = 'none';
    ps.seatId = '';
    ps.isBot = false;
    ps.spawnX = rawX;
    ps.spawnY = spawnY;
    ps.spawnZ = rawZ;
    ps.spawnYaw = 1.35;

    this.state.players.set(client.sessionId, ps);

    this.humanEntities.set(client.sessionId, {
      sessionId: client.sessionId,
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
      hasReceivedMove: false,
      lastSeq: 0,
      lastMoveAtMs: performance.now(),
      burstSlackMeters: 4.5,
      lastTeleportAtMs: 0,
      lastChatAtMs: 0,
      lastSocialAtMs: 0,
      lastJamAtMs: 0,
      lastPolaroidAtMs: 0,
      lastChimeAtMs: 0,
      likedPolaroids: new Set<string>(),
    });

    this.syncAmbientBotPopulation();
    setTimeout(() => {
      if (this.humanEntities.has(client.sessionId)) {
        this.sendWorldHydration(client, numericId);
      }
    }, 50);
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
    // Free shared bench seat immediately while holding player's room slot for 45s reconnection
    this.releaseClientBench(client.sessionId);
    const ent = this.humanEntities.get(client.sessionId);
    if (ent) {
      ent.moving = false;
      ent.running = false;
      ent.vx = 0;
      ent.vz = 0;
    }
    this.allowReconnection(client, 45).catch(() => {});
  }

  onReconnect(client: Client): void {
    const ent = this.humanEntities.get(client.sessionId);
    if (ent) {
      this.sendWorldHydration(client, ent.numericId);
    }
  }

  onLeave(client: Client): void {
    this.releaseClientBench(client.sessionId);
    this.humanEntities.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.syncAmbientBotPopulation();
  }

  onDispose(): void {
    activeCloudRooms.delete(this.roomId);
    usedShardIndices.delete(this.shardIndex);
    worldPersistence.flushToDiskNow();
  }

  private syncAmbientBotPopulation(): void {
    const { added, removed } = this.ambientHikers.reconcilePopulation(this.clients.length);
    for (const bot of added) {
      this.upsertBotSchema(bot);
    }
    for (const bot of removed) {
      this.state.players.delete(bot.spec.sessionId);
    }
  }

  private tickSimulation(dtMs: number): void {
    this.serverTick = (this.serverTick + 1) & 0xffff;
    const dtSec = clamp(dtMs / 1000, 0.01, 0.25);

    // Step autonomous ambient cloud-hunters
    const emoteChanges = this.ambientHikers.step(dtSec);
    for (let i = 0; i < emoteChanges.length; i++) {
      const change = emoteChanges[i];
      const botSchema = this.state.players.get(change.sessionId);
      if (botSchema) {
        if (botSchema.emote !== change.emote) {
          botSchema.emote = change.emote;
        }
        if (botSchema.heldItem !== change.heldItem) {
          botSchema.heldItem = change.heldItem;
        }
      }
    }

    if (this.clients.length === 0) {
      return;
    }

    // Collect all active peer transforms (humans + active bots)
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
      });
    }
    for (const bot of this.ambientHikers.getAll()) {
      if (bot.active) {
        allEntities.push(this.ambientHikers.toNearTransform(bot));
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
