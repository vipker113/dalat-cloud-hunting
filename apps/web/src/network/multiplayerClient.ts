import { Client, getStateCallbacks, type Room } from '@colyseus/sdk';
import {
  type AcousticJamNote,
  type AvatarGender,
  type BagStyleId,
  type ChatBubbleMessage,
  type ClientMoveInput,
  type CoatStyleId,
  decodeWorldSnapshot,
  DEFAULT_OUTFIT,
  type EmoteId,
  encodeClientMove,
  ensureCoatMatchesGender,
  type EyewearId,
  type FarPeerBeacon,
  getCoatGender,
  type HeadwearId,
  type HeldItemId,
  type NeckwearId,
  type PlayerOutfit,
  type PolaroidEntry,
  resolveBenchSeatTransform,
  resolveEffectiveGender,
  sampleWalkableHeight,
  SHARED_BENCHES,
  type WindChimeNote,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
import {
  type RemotePeerState,
  type RoomChannelInfo,
  useGameStore,
} from '../store/gameStore';
import type { IMultiplayerController } from './types';

const ROOM_NAME = 'cloud_hunting';
const RING_BUFFER_CAPACITY = 4;

interface ReflectedPlayer {
  numericId: number;
  sessionId: string;
  displayName: string;
  gender?: string;
  coatStyle: string;
  coatColor: string;
  scarfColor: string;
  headwear: string;
  neckwear?: string;
  eyewear?: string;
  bagStyle?: string;
  hairColor: string;
  backpack: boolean;
  heldItem: string;
  emote: string;
  seatId: string;
  isBot: boolean;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
  spawnYaw: number;
}

function buildProfileKey(displayName: string, o: PlayerOutfit): string {
  return `${displayName}|${o.gender || ''}|${o.coatStyle}|${o.coatColor}|${o.scarfColor}|${o.headwear}|${o.neckwear || ''}|${o.eyewear || ''}|${o.bagStyle || ''}|${o.hairColor}|${o.backpack ? 1 : 0}`;
}

interface ReflectedRoomState {
  roomCode?: string;
  channelName?: string;
  players?: Map<string, ReflectedPlayer> & {
    forEach: (cb: (val: ReflectedPlayer, key: string) => void) => void;
    get: (key: string) => ReflectedPlayer | undefined;
    has: (key: string) => boolean;
  };
  occupiedBenches?: Map<string, string> & {
    forEach: (cb: (val: string, key: string) => void) => void;
  };
}

interface SnapshotSample {
  recvMs: number;
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
}

class PeerSnapshotRingBuffer {
  private readonly slots: SnapshotSample[];
  private head = 0; // Points to next write index
  public count = 0;

  constructor() {
    this.slots = Array.from({ length: RING_BUFFER_CAPACITY }, () => ({
      recvMs: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      vx: 0,
      vz: 0,
      moving: false,
      running: false,
      grounded: true,
      warmBuff: false,
    }));
  }

  public push(
    recvMs: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    vx: number,
    vz: number,
    moving: boolean,
    running: boolean,
    grounded: boolean,
    warmBuff: boolean
  ): void {
    // Coalesce burst frames arriving within < 4ms of each other
    if (this.count > 0) {
      const newestIdx = (this.head - 1 + RING_BUFFER_CAPACITY) % RING_BUFFER_CAPACITY;
      if (recvMs - this.slots[newestIdx].recvMs < 4) {
        const s = this.slots[newestIdx];
        s.recvMs = recvMs;
        s.x = x;
        s.y = y;
        s.z = z;
        s.yaw = yaw;
        s.vx = vx;
        s.vz = vz;
        s.moving = moving;
        s.running = running;
        s.grounded = grounded;
        s.warmBuff = warmBuff;
        return;
      }
    }

    const slot = this.slots[this.head];
    slot.recvMs = recvMs;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.yaw = yaw;
    slot.vx = vx;
    slot.vz = vz;
    slot.moving = moving;
    slot.running = running;
    slot.grounded = grounded;
    slot.warmBuff = warmBuff;

    this.head = (this.head + 1) % RING_BUFFER_CAPACITY;
    if (this.count < RING_BUFFER_CAPACITY) {
      this.count++;
    }
  }

  /** Access chronological sample where 0 = oldest, count - 1 = newest */
  public at(chronologicalIndex: number): SnapshotSample {
    const start = (this.head - this.count + RING_BUFFER_CAPACITY) % RING_BUFFER_CAPACITY;
    return this.slots[(start + chronologicalIndex) % RING_BUFFER_CAPACITY];
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function wrapAnglePi(rad: number): number {
  let r = (rad + Math.PI) % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r - Math.PI;
}

function resolveServerEndpoints(): { wsUrl: string; httpUrl: string } {
  const envUrl = (import.meta.env?.VITE_SERVER_URL as string | undefined)?.trim();
  if (envUrl) {
    if (envUrl.startsWith('ws://') || envUrl.startsWith('wss://')) {
      return {
        wsUrl: envUrl.replace(/\/+$/, ''),
        httpUrl: envUrl
          .replace(/^wss:/i, 'https:')
          .replace(/^ws:/i, 'http:')
          .replace(/\/+$/, ''),
      };
    }
    if (envUrl.startsWith('http://') || envUrl.startsWith('https://')) {
      return {
        httpUrl: envUrl.replace(/\/+$/, ''),
        wsUrl: envUrl
          .replace(/^https:/i, 'wss:')
          .replace(/^http:/i, 'ws:')
          .replace(/\/+$/, ''),
      };
    }
  }

  if (typeof window !== 'undefined') {
    const isSecure = window.location.protocol === 'https:';
    const host = window.location.hostname || 'localhost';
    const port = window.location.port;
    const isViteDevPort = port === '5173' || port === '4173' || port === '4179';

    if (isViteDevPort) {
      return {
        wsUrl: `${isSecure ? 'wss' : 'ws'}://${host}:2567`,
        httpUrl: `${isSecure ? 'https' : 'http'}://${host}:2567`,
      };
    }

    // Production unified server or reverse-proxy mode: use same host & port
    return {
      wsUrl: `${isSecure ? 'wss' : 'ws'}://${window.location.host}`,
      httpUrl: window.location.origin,
    };
  }

  return {
    wsUrl: 'ws://localhost:2567',
    httpUrl: 'http://localhost:2567',
  };
}

function readUrlRoomCode(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const code = new URLSearchParams(window.location.search).get('room');
    return code && code.trim() ? code.trim() : undefined;
  } catch {
    return undefined;
  }
}

function syncUrlRoomCode(roomCode: string): void {
  if (typeof window === 'undefined' || !roomCode) return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('room') !== roomCode) {
      url.searchParams.set('room', roomCode);
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // ignore history security restrictions in sandboxed iframes
  }
}

const OFFLINE_STARTER_NOTES: WindChimeNote[] = [
  {
    id: 'offline-chime-1',
    authorName: 'Thảo Vy',
    message: 'Mong những người thương nhau sẽ luôn tìm thấy nhau giữa sương mù Đà Lạt.',
    createdAt: Date.now() - 1000 * 60 * 20,
  },
  {
    id: 'offline-chime-2',
    authorName: 'Bảo Khánh',
    message: 'Chúc bản thân tuổi mới bình yên như sáng sớm ngồi nghe gió đồi Cầu Đất.',
    createdAt: Date.now() - 1000 * 60 * 55,
  },
];

class MultiplayerClientController implements IMultiplayerController {
  private client: Client | null = null;
  private room: Room<any, ReflectedRoomState> | null = null;
  private connectPromise: Promise<void> | null = null;
  private manuallyDisconnected = false;
  private desiredRoomCode: string | undefined = undefined;

  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private periodicSyncTimer: ReturnType<typeof setInterval> | null = null;
  private syncBurstTimers: Array<ReturnType<typeof setTimeout>> = [];

  private localNumericId = -1;
  private readonly numericIdToSessionId = new Map<number, string>();
  private readonly peerBuffers = new Map<number, PeerSnapshotRingBuffer>();
  private clockSamples: Array<{ rttMs: number; offsetMs: number }> = [];

  // Track last sent metadata so store subscriptions & direct controller calls never double-send
  private lastSentProfileKey = '';
  private lastSentHeldItem: HeldItemId = 'soy_milk';
  private lastSentEmote: EmoteId = 'none';
  private storeSubscribed = false;

  private ensureStoreBridge(): void {
    if (this.storeSubscribed) return;
    this.storeSubscribed = true;

    useGameStore.subscribe((state, prev) => {
      if (!this.room || !state.connected) return;

      const profileKey = buildProfileKey(state.displayName, state.outfit);
      if (
        (state.displayName !== prev.displayName || state.outfit !== prev.outfit) &&
        profileKey !== this.lastSentProfileKey
      ) {
        this.sendProfile(state.displayName, state.outfit);
      }

      if (state.heldItem !== prev.heldItem && state.heldItem !== this.lastSentHeldItem) {
        this.sendHeldItem(state.heldItem);
      }

      if (state.activeEmote !== prev.activeEmote && state.activeEmote !== this.lastSentEmote) {
        this.sendEmote(state.activeEmote);
      }
    });
  }

  public async connect(preferredRoomCode?: string): Promise<void> {
    this.ensureStoreBridge();
    this.manuallyDisconnected = false;
    this.clearRetryTimer();

    const targetCode = preferredRoomCode?.trim() || readUrlRoomCode() || this.desiredRoomCode;
    this.desiredRoomCode = targetCode;

    if (this.room && useGameStore.getState().connected) {
      if (!preferredRoomCode || preferredRoomCode.toUpperCase() === useGameStore.getState().roomCode.toUpperCase()) {
        return;
      }
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.performConnect(targetCode).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async performConnect(preferredRoomCode?: string): Promise<void> {
    const store = useGameStore.getState();
    store.setNetworkStatus({ connecting: true });

    const { wsUrl, httpUrl } = resolveServerEndpoints();
    const joinOptions = {
      displayName: store.displayName,
      outfit: store.outfit,
      heldItem: store.heldItem,
      x: store.localTransient.x,
      z: store.localTransient.z,
    };

    try {
      this.client = new Client(wsUrl);

      let resolvedRoomId: string | undefined;
      let resolvedRoomCode: string | undefined;
      let resolvedChannelName: string | undefined;
      let seatReservation: Parameters<Client['consumeSeatReservation']>[0] | undefined;

      try {
        const res = await fetch(`${httpUrl}/api/resolve-room`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            preferredRoomCode,
            reserveSeat: true,
            clientOptions: joinOptions,
          }),
          signal: AbortSignal.timeout(3500),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            roomId: string;
            roomCode: string;
            channelName: string;
            fallbackFromFull?: boolean;
            seatReservation?: Parameters<Client['consumeSeatReservation']>[0];
          };
          resolvedRoomId = data.roomId;
          resolvedRoomCode = data.roomCode;
          resolvedChannelName = data.channelName;
          seatReservation = data.seatReservation;

          if (data.fallbackFromFull) {
            useGameStore
              .getState()
              .showToast('Kênh bạn chọn đã đầy 50/50 người, đã chuyển sang đồi mây gần nhất!');
          }
        }
      } catch {
        // Fallback to direct Colyseus matchmaking below if HTTP pre-resolve failed
      }

      let joinedRoom: Room<any, ReflectedRoomState>;
      if (seatReservation) {
        joinedRoom = await this.client.consumeSeatReservation<ReflectedRoomState>(seatReservation);
      } else if (resolvedRoomId) {
        joinedRoom = await this.client.joinById<ReflectedRoomState>(resolvedRoomId, joinOptions);
      } else {
        joinedRoom = await this.client.joinOrCreate<ReflectedRoomState>(ROOM_NAME, joinOptions);
      }

      // Configure automatic Colyseus SDK reconnection (matches server allowReconnection(45))
      joinedRoom.reconnection.enabled = true;
      joinedRoom.reconnection.minUptime = 0;
      joinedRoom.reconnection.maxRetries = 15;

      this.teardownActiveRoomResources();
      this.room = joinedRoom;
      this.retryAttempt = 0;

      const finalCode = resolvedRoomCode || store.roomCode || 'MAY-01';
      const finalChannel = resolvedChannelName || store.channelName || 'Sương Sớm Cầu Đất #1';
      this.desiredRoomCode = finalCode;
      syncUrlRoomCode(finalCode);

      this.lastSentProfileKey = buildProfileKey(store.displayName, store.outfit);
      this.lastSentHeldItem = store.heldItem;
      this.lastSentEmote = store.activeEmote;

      useGameStore.getState().resetPeers();
      useGameStore.getState().setNetworkStatus({
        connected: true,
        connecting: false,
        localSessionId: joinedRoom.sessionId,
        roomId: joinedRoom.roomId,
        roomCode: finalCode,
        channelName: finalChannel,
      });

      this.bindRoomHandlers(joinedRoom);
      joinedRoom.send('req_world_init');
      this.startCristianClockSync(joinedRoom);
      void this.refreshChannels();
    } catch {
      // Graceful offline fallback: never crash the 3D Highland world!
      const st = useGameStore.getState();
      if (st.windChimeNotes.length === 0) {
        st.setWindChimeNotes(OFFLINE_STARTER_NOTES);
      }
      st.setNetworkStatus({
        connected: false,
        connecting: false,
      });
      this.scheduleSoftReconnect();
    }
  }

  public async disconnect(): Promise<void> {
    this.manuallyDisconnected = true;
    this.clearRetryTimer();
    this.clearSyncTimers();

    const active = this.room;
    this.room = null;
    this.localNumericId = -1;
    this.numericIdToSessionId.clear();
    this.peerBuffers.clear();

    if (active) {
      try {
        await active.leave(true);
      } catch {
        // ignore socket close errors
      }
    }

    const st = useGameStore.getState();
    st.resetPeers();
    st.setNetworkStatus({
      connected: false,
      connecting: false,
      occupiedBenches: {},
    });
  }

  public async switchChannel(roomCodeOrId: string): Promise<void> {
    const target = roomCodeOrId.trim();
    if (!target) return;
    await this.disconnect();
    this.manuallyDisconnected = false;
    this.desiredRoomCode = target;
    await this.connect(target);
  }

  public async refreshChannels(): Promise<void> {
    const { httpUrl } = resolveServerEndpoints();
    try {
      const res = await fetch(`${httpUrl}/api/channels`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return;
      const payload = (await res.json()) as RoomChannelInfo[] | { channels?: RoomChannelInfo[] };
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.channels)
          ? payload.channels
          : [];
      useGameStore.getState().setNetworkStatus({ availableChannels: list });
    } catch {
      // ignore background channel poll errors when offline
    }
  }

  public sendMove(input: ClientMoveInput): void {
    if (!this.room || !useGameStore.getState().connected) return;
    try {
      const packet = encodeClientMove(input);
      this.room.sendBytes('mv', packet);
    } catch {
      // ignore transient socket buffer errors during reconnect
    }
  }

  public sendChat(text: string): void {
    const trimmed = text.trim().slice(0, 120);
    if (!trimmed) return;

    if (this.room && useGameStore.getState().connected) {
      this.room.send('chat', { text: trimmed });
      return;
    }

    // Offline solo fallback bubble
    const st = useGameStore.getState();
    st.pushChatBubble({
      id: `local-${Date.now()}`,
      senderId: st.localSessionId || 'local',
      senderName: st.displayName,
      text: trimmed,
      x: st.localTransient.x,
      y: st.localTransient.y,
      z: st.localTransient.z,
      timestamp: Date.now(),
    });
  }

  public sendProfile(displayName: string, outfit: PlayerOutfit): void {
    this.lastSentProfileKey = buildProfileKey(displayName, outfit);
    const st = useGameStore.getState();
    if (st.displayName !== displayName) {
      st.setDisplayName(displayName);
    }
    if (buildProfileKey(st.displayName, st.outfit) !== buildProfileKey(st.displayName, outfit)) {
      st.updateOutfit(outfit);
    }
    if (!this.room || !useGameStore.getState().connected) return;
    this.room.send('profile', { displayName, outfit });
  }

  public sendHeldItem(item: HeldItemId): void {
    this.lastSentHeldItem = item;
    const st = useGameStore.getState();
    if (st.heldItem !== item) {
      st.setHeldItem(item);
    }
    if (!this.room || !useGameStore.getState().connected) return;
    this.room.send('held_item', { item });
  }

  public sendEmote(emote: EmoteId): void {
    this.lastSentEmote = emote;
    const st = useGameStore.getState();
    if (st.activeEmote !== emote) {
      st.triggerEmote(emote);
    }
    if (!this.room || !useGameStore.getState().connected) return;
    this.room.send('emote', { emote });
  }

  public sendSocialInteract(
    targetSessionId: string,
    kind: 'greet' | 'cheers' | 'cheer'
  ): void {
    if (!targetSessionId) return;
    if (this.room && useGameStore.getState().connected) {
      this.room.send('social_interact', { targetSessionId, kind });
      return;
    }

    // Offline fallback reciprocal reaction for local peers/bots
    const st = useGameStore.getState();
    const peer = st.peers[targetSessionId];
    if (!peer || !peer.isBot) return;
    const replyEmote: EmoteId =
      kind === 'cheers' ? 'cheers_cup' : kind === 'cheer' ? 'cheer_sunrise' : 'wave';
    const faceYaw = Math.atan2(st.localTransient.x - peer.x, st.localTransient.z - peer.z);
    st.upsertPeer({ ...peer, yaw: faceYaw, moving: false, emote: replyEmote });
    const replyLine =
      kind === 'cheers'
        ? `Cụng ly ấm nhé ${st.displayName}! Sáng Cầu Đất có ly nóng ấm lòng ghê ☕✨`
        : kind === 'cheer'
          ? `Đẹp mê hồn luôn ${st.displayName} ơi! Biển mây hôm nay dày quá! 🌅`
          : `Chào ${st.displayName} nha! Đi săn mây sớm vậy 👋`;
    setTimeout(() => {
      useGameStore.getState().pushChatBubble({
        id: `offline-social-${Date.now()}`,
        senderId: peer.sessionId,
        senderName: peer.displayName,
        text: replyLine,
        x: peer.x,
        y: peer.y,
        z: peer.z,
        timestamp: Date.now(),
      });
    }, 420);
  }

  public requestBenchSeat(benchId: string | null): void {
    if (this.room && useGameStore.getState().connected) {
      this.room.send('seat_req', { benchId });
      return;
    }

    // Offline solo bench seating fallback
    const st = useGameStore.getState();
    if (!benchId) {
      st.setSeatedBench(null);
      return;
    }
    const seatTransform = resolveBenchSeatTransform(benchId);
    if (seatTransform) {
      st.localTransient.x = seatTransform.position[0];
      st.localTransient.y = seatTransform.position[1];
      st.localTransient.z = seatTransform.position[2];
      st.localTransient.yaw = seatTransform.yaw;
      st.localTransient.vx = 0;
      st.localTransient.vz = 0;
      st.setSeatedBench(seatTransform.seatId);
    }
  }

  public sendJamNote(chordIndex: number, instrument: AcousticJamNote['instrument']): void {
    const clampedChord = clamp(Math.round(chordIndex), 0, 5);
    if (this.room && useGameStore.getState().connected) {
      this.room.send('jam_note', { chordIndex: clampedChord, instrument });
      return;
    }

    const st = useGameStore.getState();
    st.setLastJamNote({
      senderId: st.localSessionId || 'local',
      senderName: st.displayName,
      chordIndex: clampedChord,
      instrument,
      timestamp: Date.now(),
    });
  }

  public pinPolaroid(entry: Omit<PolaroidEntry, 'id' | 'likes' | 'createdAt'>): void {
    if (this.room && useGameStore.getState().connected) {
      this.room.send('polaroid_pin', entry);
      return;
    }

    useGameStore.getState().prependPolaroid({
      ...entry,
      id: `local-pol-${Date.now()}`,
      likes: 1,
      createdAt: Date.now(),
    });
  }

  public likePolaroid(polaroidId: string): void {
    if (this.room && useGameStore.getState().connected) {
      this.room.send('polaroid_like', { polaroidId });
      return;
    }

    const st = useGameStore.getState();
    st.setPolaroids(
      st.polaroids.map((p) => (p.id === polaroidId ? { ...p, likes: p.likes + 1 } : p))
    );
  }

  public addWindChimeNote(message: string): void {
    const trimmed = message.trim().slice(0, 140);
    if (!trimmed) return;

    if (this.room && useGameStore.getState().connected) {
      this.room.send('windchime_add', { message: trimmed });
      return;
    }

    const st = useGameStore.getState();
    st.prependWindChimeNote({
      id: `local-chime-${Date.now()}`,
      authorName: st.displayName,
      message: trimmed,
      createdAt: Date.now(),
    });
  }

  /**
   * 60 FPS Zero-Churn Peer Transform Interpolator:
   * Evaluates a 130ms buffered Cubic Hermite position spline + shortest-arc yaw Slerp
   * and mutates `peer.x, peer.y, peer.z, peer.yaw, peer.moving, peer.running` in-place
   * inside `useGameStore.getState().peers` without triggering React state re-renders!
   */
  public interpolatePeers(nowMs: number): void {
    const perfNow = performance.now();
    // Normalize caller clock base (supports performance.now(), Date.now(), or R3F elapsed ms)
    const frameNowMs =
      Number.isFinite(nowMs) && Math.abs(nowMs - perfNow) < 250 ? nowMs : perfNow;
    const renderTimeMs = frameNowMs - WORLD_CONSTANTS.INTERPOLATION_DELAY_MS;

    const peers = useGameStore.getState().peers;
    for (const sessionId in peers) {
      const peer = peers[sessionId];
      if (!peer) continue;

      if (peer.seatId) {
        const seatTransform = resolveBenchSeatTransform(peer.seatId);
        if (seatTransform) {
          peer.x = seatTransform.position[0];
          peer.y = seatTransform.position[1];
          peer.z = seatTransform.position[2];
          peer.yaw = seatTransform.yaw;
        }
        peer.vx = 0;
        peer.vz = 0;
        peer.moving = false;
        peer.running = false;
        peer.grounded = true;
        continue;
      }

      const buf = this.peerBuffers.get(peer.numericId);
      if (!buf || buf.count === 0) continue;

      const oldest = buf.at(0);
      if (buf.count === 1 || renderTimeMs <= oldest.recvMs) {
        peer.x = oldest.x;
        peer.y = oldest.y;
        peer.z = oldest.z;
        peer.yaw = oldest.yaw;
        peer.vx = oldest.vx;
        peer.vz = oldest.vz;
        peer.moving = oldest.moving;
        peer.running = oldest.running;
        peer.grounded = oldest.grounded;
        peer.warmBuff = oldest.warmBuff;
        continue;
      }

      const newest = buf.at(buf.count - 1);
      if (renderTimeMs >= newest.recvMs) {
        // Gentle bounded dead-reckoning for up to 120ms if a network packet is late
        const overshootMs = renderTimeMs - newest.recvMs;
        const extrapSec = Math.min(0.12, overshootMs / 1000);
        if (newest.moving && overshootMs < 260) {
          peer.x = newest.x + newest.vx * extrapSec * 0.65;
          peer.z = newest.z + newest.vz * extrapSec * 0.65;
          peer.y = newest.grounded ? sampleWalkableHeight(peer.x, peer.z) : newest.y;
          peer.moving = true;
          peer.running = newest.running;
        } else {
          peer.x = newest.x;
          peer.y = newest.y;
          peer.z = newest.z;
          peer.moving = false;
          peer.running = false;
        }
        peer.yaw = newest.yaw;
        peer.vx = newest.vx;
        peer.vz = newest.vz;
        peer.grounded = newest.grounded;
        peer.warmBuff = newest.warmBuff;
        continue;
      }

      // Locate bracketing snapshot pair [a, b] around renderTimeMs
      let a = oldest;
      let b = newest;
      for (let i = 0; i < buf.count - 1; i++) {
        const s0 = buf.at(i);
        const s1 = buf.at(i + 1);
        if (renderTimeMs >= s0.recvMs && renderTimeMs <= s1.recvMs) {
          a = s0;
          b = s1;
          break;
        }
      }

      const spanMs = b.recvMs - a.recvMs;
      const stepDist = Math.hypot(b.x - a.x, b.z - a.z);

      // Snap cleanly on Landmark Fast-Travel jumps (> 18m)
      if (spanMs < 1 || stepDist > 18) {
        peer.x = b.x;
        peer.y = b.y;
        peer.z = b.z;
        peer.yaw = b.yaw;
        peer.vx = b.vx;
        peer.vz = b.vz;
        peer.moving = b.moving;
        peer.running = b.running;
        peer.grounded = b.grounded;
        peer.warmBuff = b.warmBuff;
        continue;
      }

      const t = clamp((renderTimeMs - a.recvMs) / spanMs, 0, 1);
      const t2 = t * t;
      const t3 = t2 * t;
      const dtSec = spanMs / 1000;

      // Cubic Hermite basis functions
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;

      const m0x = a.vx * dtSec;
      const m1x = b.vx * dtSec;
      const m0z = a.vz * dtSec;
      const m1z = b.vz * dtSec;

      const ix = h00 * a.x + h10 * m0x + h01 * b.x + h11 * m1x;
      const iz = h00 * a.z + h10 * m0z + h01 * b.z + h11 * m1z;

      const smoothT = t2 * (3 - 2 * t);
      let iy = a.y + (b.y - a.y) * smoothT;
      if (a.grounded && b.grounded && Math.abs(b.y - a.y) < 1.5) {
        iy = Math.max(iy, sampleWalkableHeight(ix, iz));
      }

      // Shortest-arc circular yaw Slerp on S^1
      const deltaYaw = wrapAnglePi(b.yaw - a.yaw);
      const iyaw = wrapAnglePi(a.yaw + deltaYaw * t);

      peer.x = ix;
      peer.y = iy;
      peer.z = iz;
      peer.yaw = iyaw;
      peer.vx = a.vx + (b.vx - a.vx) * t;
      peer.vz = a.vz + (b.vz - a.vz) * t;
      peer.moving = t < 0.5 ? a.moving : b.moving;
      peer.running = t < 0.5 ? a.running : b.running;
      peer.grounded = t < 0.5 ? a.grounded : b.grounded;
      peer.warmBuff = t < 0.5 ? a.warmBuff : b.warmBuff;
    }
  }

  private bindRoomHandlers(room: Room<any, ReflectedRoomState>): void {
    // 1. Schema v5 state callbacks for low-frequency metadata
    const $ = getStateCallbacks(room) as unknown as
      | ((instance: unknown) => Record<string, any>)
      | undefined;

    if ($ && room.state) {
      const rootProxy = $(room.state);
      if (rootProxy?.players) {
        rootProxy.players.onAdd((player: ReflectedPlayer, sessionId: string) => {
          this.handleSchemaPlayerAddedOrUpdated(room, player, sessionId);
          const playerProxy = $(player);
          playerProxy?.onChange?.(() => {
            this.handleSchemaPlayerAddedOrUpdated(room, player, sessionId);
          });
        }, true);

        rootProxy.players.onRemove((player: ReflectedPlayer, sessionId: string) => {
          this.handleSchemaPlayerRemoved(player, sessionId);
        });
      }

      if (rootProxy?.occupiedBenches) {
        const syncBenches = () => this.reconcileOccupiedBenches(room.state);
        rootProxy.occupiedBenches.onAdd(syncBenches, true);
        rootProxy.occupiedBenches.onChange(syncBenches);
        rootProxy.occupiedBenches.onRemove(syncBenches);
      }
    }

    // Reconcile full state on initial ROOM_STATE & after reconnect decodeResync
    room.onStateChange((state) => {
      if (!state) return;
      if (state.roomCode || state.channelName) {
        const st = useGameStore.getState();
        if (
          (state.roomCode && state.roomCode !== st.roomCode) ||
          (state.channelName && state.channelName !== st.channelName)
        ) {
          st.setNetworkStatus({
            roomCode: state.roomCode || st.roomCode,
            channelName: state.channelName || st.channelName,
          });
          if (state.roomCode) syncUrlRoomCode(state.roomCode);
        }
      }
      this.reconcilePlayersDiff(room, state);
      this.reconcileOccupiedBenches(state);
    });

    // 2. 12 Hz Binary Snapshot Stream
    room.onMessage('snap', (bytes: Uint8Array) => {
      const decoded = decodeWorldSnapshot(bytes);
      if (!decoded) return;
      const recvMs = performance.now();

      for (let i = 0; i < decoded.nearPeers.length; i++) {
        const p = decoded.nearPeers[i];
        if (p.numericId === this.localNumericId) continue;

        let buf = this.peerBuffers.get(p.numericId);
        if (!buf) {
          buf = new PeerSnapshotRingBuffer();
          this.peerBuffers.set(p.numericId, buf);
        }
        buf.push(
          recvMs,
          p.x,
          p.y,
          p.z,
          p.yaw,
          p.vx,
          p.vz,
          p.moving,
          p.running,
          p.grounded,
          p.warmBuff
        );
      }

      // Update 2 Hz far-tier lantern silhouettes when sent (every 6th tick)
      if (decoded.serverTick % 6 === 0 || decoded.farPeers.length > 0) {
        const filteredFar: FarPeerBeacon[] =
          decoded.farPeers.length > 0
            ? decoded.farPeers.filter((b) => b.numericId !== this.localNumericId)
            : [];
        const currentFar = useGameStore.getState().farBeacons;
        if (filteredFar.length > 0 || currentFar.length > 0) {
          useGameStore.getState().setFarBeacons(filteredFar);
        }
      }
    });

    // 3. Initial World Memory Hydration
    room.onMessage(
      'world_init',
      (payload: {
        numericId?: number;
        roomId?: string;
        roomCode?: string;
        channelName?: string;
        serverEpochMs?: number;
        polaroids?: PolaroidEntry[];
        windChimeNotes?: WindChimeNote[];
      }) => {
        if (typeof payload?.numericId === 'number') {
          this.localNumericId = payload.numericId;
        }
        const st = useGameStore.getState();
        if (Array.isArray(payload?.polaroids)) {
          st.setPolaroids(payload.polaroids);
        }
        if (Array.isArray(payload?.windChimeNotes)) {
          st.setWindChimeNotes(payload.windChimeNotes);
        }
        if (payload?.roomCode || payload?.channelName) {
          const nextCode = payload.roomCode || st.roomCode;
          st.setNetworkStatus({
            roomId: payload.roomId || room.roomId,
            roomCode: nextCode,
            channelName: payload.channelName || st.channelName,
          });
          syncUrlRoomCode(nextCode);
        }
      }
    );

    // 4. Cristian Clock Sync Pong
    room.onMessage(
      'pong_sync',
      (payload: { clientSendMs?: number; serverEpochMs?: number }) => {
        if (
          typeof payload?.clientSendMs !== 'number' ||
          typeof payload?.serverEpochMs !== 'number'
        ) {
          return;
        }
        const recvEpochMs = Date.now();
        const rttMs = Math.max(1, recvEpochMs - payload.clientSendMs);
        const estimatedServerNow = payload.serverEpochMs + rttMs * 0.5;
        const offsetMs = estimatedServerNow - recvEpochMs;

        this.clockSamples.push({ rttMs, offsetMs });
        if (this.clockSamples.length > 7) {
          this.clockSamples.shift();
        }

        // Cristian's best-sample selection: lowest RTT has minimal asymmetric queueing noise
        const sorted = [...this.clockSamples].sort((a, b) => a.rttMs - b.rttMs);
        const bestOffset = sorted[0].offsetMs;
        const topCount = Math.min(3, sorted.length);
        let rttSum = 0;
        for (let i = 0; i < topCount; i++) {
          rttSum += sorted[i].rttMs;
        }

        const st = useGameStore.getState();
        st.setNetworkStatus({
          rttMs: Math.round(rttSum / topCount),
          serverTimeOffsetMs: Math.round(bestOffset),
        });
        st.tickWarmthAndAtmosphere(0);
      }
    );

    // 5. Proximity Chat Bubbles
    room.onMessage('chat_bubble', (bubble: ChatBubbleMessage) => {
      if (bubble && typeof bubble.text === 'string') {
        useGameStore.getState().pushChatBubble(bubble);
      }
    });

    // 5b. Quick Social Interactions (Wave / Warm Cup Clink / Cheer Sunrise)
    room.onMessage(
      'social_event',
      (evt: {
        fromId?: string;
        fromName?: string;
        targetId?: string;
        kind?: 'greet' | 'cheers' | 'cheer';
        x?: number;
        y?: number;
        z?: number;
      }) => {
        if (!evt || !evt.kind) return;
        const st = useGameStore.getState();
        if (
          evt.fromId !== room.sessionId &&
          typeof evt.x === 'number' &&
          typeof evt.y === 'number' &&
          typeof evt.z === 'number'
        ) {
          st.triggerSocialSparkle(evt.kind, evt.x, evt.y, evt.z);
        }
        if (evt.targetId === room.sessionId && evt.fromId !== room.sessionId) {
          const sender = evt.fromName || 'Một lữ khách';
          if (evt.kind === 'cheers') {
            st.grantWarmthBuff(480);
            st.showToast(`☕ ${sender} vừa cụng ly ấm cùng bạn — Giữ ấm +8 phút (+12% bước chân)!`);
          } else if (evt.kind === 'greet') {
            st.showToast(`👋 ${sender} đang vẫy tay chào bạn giữa sương sớm!`);
          } else if (evt.kind === 'cheer') {
            st.showToast(`🙌 ${sender} đang reo vui đón biển mây cùng bạn!`);
          }
        }
      }
    );

    // 6. Atomic Shared Bench Ack
    room.onMessage(
      'seat_ack',
      (ack: {
        benchId: string | null;
        ok: boolean;
        position?: [number, number, number];
        yaw?: number;
        reason?: string;
      }) => {
        const st = useGameStore.getState();
        if (ack?.ok) {
          if (ack.benchId && ack.position) {
            st.localTransient.x = ack.position[0];
            st.localTransient.y = ack.position[1];
            st.localTransient.z = ack.position[2];
            if (typeof ack.yaw === 'number') {
              st.localTransient.yaw = ack.yaw;
            }
            st.localTransient.vx = 0;
            st.localTransient.vz = 0;
          }
          st.setSeatedBench(ack.benchId ?? null);
        } else {
          const prevSeat = st.seatedBenchId ? resolveBenchSeatTransform(st.seatedBenchId) : null;
          if (prevSeat) {
            st.localTransient.x = prevSeat.position[0] + Math.sin(prevSeat.yaw) * 0.85;
            st.localTransient.z = prevSeat.position[2] + Math.cos(prevSeat.yaw) * 0.85;
            st.localTransient.y = sampleWalkableHeight(st.localTransient.x, st.localTransient.z);
          }
          st.setSeatedBench(null);
          if (ack?.reason) {
            st.showToast(ack.reason);
          }
        }
      }
    );

    // 7. Acoustic Campfire Jam
    room.onMessage('jam_note', (jam: AcousticJamNote) => {
      if (jam && typeof jam.chordIndex === 'number') {
        useGameStore.getState().setLastJamNote(jam);
      }
    });

    // 8. Polaroid Wall & Wind-Chime Live Broadcasts
    room.onMessage('polaroid_added', (entry: PolaroidEntry) => {
      if (entry && entry.id) {
        useGameStore.getState().prependPolaroid(entry);
      }
    });

    room.onMessage('polaroid_liked', (patch: { id: string; likes: number }) => {
      if (!patch?.id) return;
      const st = useGameStore.getState();
      st.setPolaroids(
        st.polaroids.map((p) => (p.id === patch.id ? { ...p, likes: patch.likes } : p))
      );
    });

    room.onMessage('windchime_added', (note: WindChimeNote) => {
      if (note && note.id) {
        useGameStore.getState().prependWindChimeNote(note);
      }
    });

    // 9. Connection Drop / Reconnect / Leave Lifecycle
    room.onDrop(() => {
      useGameStore.getState().setNetworkStatus({ connecting: true });
    });

    room.onReconnect(() => {
      useGameStore.getState().setNetworkStatus({
        connected: true,
        connecting: false,
        localSessionId: room.sessionId,
      });
      this.startCristianClockSync(room);
    });

    room.onLeave(() => {
      if (this.room !== room) return;
      this.room = null;
      this.clearSyncTimers();
      this.numericIdToSessionId.clear();
      this.peerBuffers.clear();

      const st = useGameStore.getState();
      st.resetPeers();
      st.setNetworkStatus({
        connected: false,
        connecting: false,
        occupiedBenches: {},
      });

      if (!this.manuallyDisconnected) {
        this.scheduleSoftReconnect();
      }
    });
  }

  private handleSchemaPlayerAddedOrUpdated(
    room: Room<any, ReflectedRoomState>,
    player: ReflectedPlayer,
    sessionId: string
  ): void {
    if (!player || player.isBot) return;
    if (sessionId === room.sessionId) {
      this.localNumericId = player.numericId;
      return;
    }

    this.numericIdToSessionId.set(player.numericId, sessionId);
    const existing = useGameStore.getState().peers[sessionId];

    const rawCoatStyle = (player.coatStyle as CoatStyleId) || DEFAULT_OUTFIT.coatStyle;
    const effGender: AvatarGender =
      player.gender === 'male' || player.gender === 'female'
        ? player.gender
        : getCoatGender(rawCoatStyle);
    const outfit: PlayerOutfit = {
      gender: effGender,
      coatStyle: ensureCoatMatchesGender(rawCoatStyle, effGender),
      coatColor: player.coatColor || DEFAULT_OUTFIT.coatColor,
      scarfColor: player.scarfColor || DEFAULT_OUTFIT.scarfColor,
      headwear: (player.headwear as HeadwearId) || DEFAULT_OUTFIT.headwear,
      neckwear: (player.neckwear as NeckwearId) || DEFAULT_OUTFIT.neckwear,
      eyewear: (player.eyewear as EyewearId) || DEFAULT_OUTFIT.eyewear,
      bagStyle:
        (player.bagStyle as BagStyleId) ||
        (typeof player.backpack === 'boolean' && !player.backpack ? 'none' : 'trek_pack'),
      hairColor: player.hairColor || DEFAULT_OUTFIT.hairColor,
      backpack: typeof player.backpack === 'boolean' ? player.backpack : true,
    };

    const heldItem = (player.heldItem as HeldItemId) || 'none';
    const emote = (player.emote as EmoteId) || 'none';
    const seatId = player.seatId || '';
    const displayName = player.displayName || 'Lữ Khách';
    const isBot = Boolean(player.isBot);

    if (
      existing &&
      existing.numericId === player.numericId &&
      existing.displayName === displayName &&
      existing.heldItem === heldItem &&
      existing.emote === emote &&
      existing.seatId === seatId &&
      existing.outfit.gender === outfit.gender &&
      existing.outfit.coatStyle === outfit.coatStyle &&
      existing.outfit.coatColor === outfit.coatColor &&
      existing.outfit.scarfColor === outfit.scarfColor &&
      existing.outfit.headwear === outfit.headwear &&
      existing.outfit.neckwear === outfit.neckwear &&
      existing.outfit.eyewear === outfit.eyewear &&
      existing.outfit.bagStyle === outfit.bagStyle &&
      existing.outfit.hairColor === outfit.hairColor &&
      existing.outfit.backpack === outfit.backpack
    ) {
      return; // Zero React state churn if metadata hasn't changed!
    }

    // Seed transform from latest ring-buffer sample if already received, else spawn anchor
    const buf = this.peerBuffers.get(player.numericId);
    const latestSample = buf && buf.count > 0 ? buf.at(buf.count - 1) : null;

    const initialX = existing
      ? existing.x
      : latestSample
        ? latestSample.x
        : Number.isFinite(player.spawnX)
          ? player.spawnX
          : -38;
    const initialZ = existing
      ? existing.z
      : latestSample
        ? latestSample.z
        : Number.isFinite(player.spawnZ)
          ? player.spawnZ
          : 30;
    const initialY = existing
      ? existing.y
      : latestSample
        ? latestSample.y
        : Number.isFinite(player.spawnY)
          ? player.spawnY
          : sampleWalkableHeight(initialX, initialZ);
    const initialYaw = existing
      ? existing.yaw
      : latestSample
        ? latestSample.yaw
        : Number.isFinite(player.spawnYaw)
          ? player.spawnYaw
          : 0;

    const nextPeer: RemotePeerState = {
      sessionId,
      numericId: player.numericId,
      displayName,
      outfit,
      heldItem,
      emote,
      seatId,
      isBot,
      x: initialX,
      y: initialY,
      z: initialZ,
      yaw: initialYaw,
      vx: existing?.vx ?? latestSample?.vx ?? 0,
      vz: existing?.vz ?? latestSample?.vz ?? 0,
      moving: existing?.moving ?? latestSample?.moving ?? false,
      running: existing?.running ?? latestSample?.running ?? false,
      grounded: existing?.grounded ?? latestSample?.grounded ?? true,
      warmBuff: existing?.warmBuff ?? latestSample?.warmBuff ?? true,
    };

    useGameStore.getState().upsertPeer(nextPeer);
  }

  private handleSchemaPlayerRemoved(player: ReflectedPlayer | undefined, sessionId: string): void {
    if (player?.numericId !== undefined) {
      this.numericIdToSessionId.delete(player.numericId);
      this.peerBuffers.delete(player.numericId);
    }
    if (useGameStore.getState().peers[sessionId]) {
      useGameStore.getState().removePeer(sessionId);
    }
  }

  private reconcilePlayersDiff(
    room: Room<any, ReflectedRoomState>,
    state: ReflectedRoomState
  ): void {
    if (!state.players) return;
    const seenSessions = new Set<string>();
    state.players.forEach((player, sessionId) => {
      seenSessions.add(sessionId);
      this.handleSchemaPlayerAddedOrUpdated(room, player, sessionId);
    });

    const currentPeers = useGameStore.getState().peers;
    for (const sessionId in currentPeers) {
      if (!seenSessions.has(sessionId)) {
        const peer = currentPeers[sessionId];
        this.numericIdToSessionId.delete(peer.numericId);
        this.peerBuffers.delete(peer.numericId);
        useGameStore.getState().removePeer(sessionId);
      }
    }
  }

  private reconcileOccupiedBenches(state: ReflectedRoomState): void {
    if (!state?.occupiedBenches) return;
    const nextMap: Record<string, string> = {};
    state.occupiedBenches.forEach((holderSessionId, benchId) => {
      if (holderSessionId) {
        nextMap[benchId] = holderSessionId;
      }
    });

    const prevMap = useGameStore.getState().occupiedBenches;
    const prevKeys = Object.keys(prevMap);
    const nextKeys = Object.keys(nextMap);
    let changed = prevKeys.length !== nextKeys.length;
    if (!changed) {
      for (let i = 0; i < nextKeys.length; i++) {
        const k = nextKeys[i];
        if (prevMap[k] !== nextMap[k]) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      useGameStore.getState().setNetworkStatus({ occupiedBenches: nextMap });
    }
  }

  private startCristianClockSync(room: Room<any, ReflectedRoomState>): void {
    this.clearSyncTimers();
    this.clockSamples = [];

    // 5-sample burst on join spaced 160ms apart for accurate Cristian offset lock
    for (let i = 0; i < 5; i++) {
      const t = setTimeout(() => {
        if (this.room === room) {
          room.send('ping_sync', { clientSendMs: Date.now() });
        }
      }, i * 160);
      this.syncBurstTimers.push(t);
    }

    // Gentle drift refresh + channel count refresh every 25s
    this.periodicSyncTimer = setInterval(() => {
      if (this.room === room && useGameStore.getState().connected) {
        room.send('ping_sync', { clientSendMs: Date.now() });
        void this.refreshChannels();
      }
    }, 25_000);
  }

  private scheduleSoftReconnect(): void {
    if (this.manuallyDisconnected || this.retryTimer) return;
    const delayMs = Math.min(15_000, 3500 + this.retryAttempt * 2500);
    this.retryAttempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.manuallyDisconnected && !useGameStore.getState().connected) {
        void this.connect(this.desiredRoomCode);
      }
    }, delayMs);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private clearSyncTimers(): void {
    for (const t of this.syncBurstTimers) {
      clearTimeout(t);
    }
    this.syncBurstTimers = [];
    if (this.periodicSyncTimer) {
      clearInterval(this.periodicSyncTimer);
      this.periodicSyncTimer = null;
    }
  }

  private teardownActiveRoomResources(): void {
    this.clearSyncTimers();
    if (this.room) {
      const stale = this.room;
      this.room = null;
      void stale.leave(true).catch(() => {});
    }
    this.localNumericId = -1;
    this.numericIdToSessionId.clear();
    this.peerBuffers.clear();
  }
}

export const multiplayerManager: IMultiplayerController = new MultiplayerClientController();
export const multiplayerClient = multiplayerManager;
