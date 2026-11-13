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
  normalizeRoomCode,
  type PlayerOutfit,
  type PolaroidEntry,
  type PolaroidPinAck,
  resolveBenchSeatTransform,
  resolveEffectiveGender,
  ROOM_CODE_REGEX,
  sampleWalkableHeight,
  type ServerPoseCorrection,
  type SocialInteractKind,
  type WindChimeNote,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
import { computeBenchStandUpPosition } from '../gameplay/interactions';
import {
  type RemotePeerState,
  type RoomChannelInfo,
  useGameStore,
} from '../store/gameStore';
import type { IMultiplayerController, SwitchChannelResult } from './types';

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
  serverTick: number;
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
      serverTick: 0,
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
    serverTick: number,
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
    if (this.count > 0) {
      const newestIdx = (this.head - 1 + RING_BUFFER_CAPACITY) % RING_BUFFER_CAPACITY;
      const newest = this.slots[newestIdx];
      // uint16 serverTick wraparound guard: ignore stale out-of-order snapshots
      const tickDelta = (serverTick - newest.serverTick + 65536) % 65536;
      if (tickDelta > 32768) {
        return;
      }
      // Coalesce burst frames arriving within < 4ms or duplicate serverTick
      if (recvMs - newest.recvMs < 4 || tickDelta === 0) {
        newest.recvMs = recvMs;
        newest.serverTick = serverTick;
        newest.x = x;
        newest.y = y;
        newest.z = z;
        newest.yaw = yaw;
        newest.vx = vx;
        newest.vz = vz;
        newest.moving = moving;
        newest.running = running;
        newest.grounded = grounded;
        newest.warmBuff = warmBuff;
        return;
      }
    }

    const slot = this.slots[this.head];
    slot.recvMs = recvMs;
    slot.serverTick = serverTick;
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

const TAB_NAME_PREFIX = 'dalat_tab_v1:';
const TAB_LEAVE_SECRET_KEY = 'dalat_tab_leave_secret_v1';
let fallbackTabId = '';
let fallbackLeaveSecret = '';

function generateRandomHex(minLength = 32): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(Math.ceil(minLength / 2));
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let out = '';
  while (out.length < minLength) {
    out += Math.random().toString(16).slice(2);
  }
  return out.slice(0, minLength);
}

/**
 * Generates & persists a private per-tab `leaveSecret` (>=24 chars) stored in `sessionStorage`
 * (`dalat_tab_leave_secret_v1`) so it survives reload in the same tab while preventing spoofed evictions.
 */
function getOrCreateTabLeaveSecret(): string {
  if (typeof window === 'undefined') {
    if (!fallbackLeaveSecret) {
      fallbackLeaveSecret = generateRandomHex(32);
    }
    return fallbackLeaveSecret;
  }
  try {
    const existing = sessionStorage.getItem(TAB_LEAVE_SECRET_KEY)?.trim();
    if (existing && existing.length >= 24 && existing.length <= 80) {
      fallbackLeaveSecret = existing;
      return existing;
    }
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : generateRandomHex(32);
    sessionStorage.setItem(TAB_LEAVE_SECRET_KEY, generated);
    fallbackLeaveSecret = generated;
    return generated;
  } catch {
    if (!fallbackLeaveSecret) {
      fallbackLeaveSecret =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : generateRandomHex(32);
    }
    return fallbackLeaveSecret;
  }
}

/**
 * Returns a stable identifier for THIS specific browser tab:
 * - Persists across F5 / Cmd+R / page.reload() in the same browsing context (via window.name)
 * - Starts empty ("") in every new tab, new window, or duplicated tab -> distinct tabId for multi-tab testing!
 */
function getOrCreateTabSessionId(): string {
  if (typeof window === 'undefined') {
    if (!fallbackTabId) {
      fallbackTabId = `tab-${Math.random().toString(36).slice(2, 12)}`;
    }
    return fallbackTabId;
  }
  try {
    if (typeof window.name === 'string' && window.name.startsWith(TAB_NAME_PREFIX)) {
      const existing = window.name.slice(TAB_NAME_PREFIX.length).trim();
      if (existing.length >= 6 && existing.length <= 60) {
        return existing;
      }
    }
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.name = `${TAB_NAME_PREFIX}${generated}`;
    return generated;
  } catch {
    if (!fallbackTabId) {
      fallbackTabId = `tab-${Math.random().toString(36).slice(2, 12)}`;
    }
    return fallbackTabId;
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
  private silenceWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private syncBurstTimers: Array<ReturnType<typeof setTimeout>> = [];

  private localNumericId = -1;
  private lastPacketRecvMs = 0;
  private readonly numericIdToSessionId = new Map<number, string>();
  private readonly peerBuffers = new Map<number, PeerSnapshotRingBuffer>();
  private clockSamples: Array<{ rttMs: number; offsetMs: number }> = [];
  private pendingPolaroidAcks: Array<{
    resolve: (ack: PolaroidPinAck) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  // Track last sent metadata so store subscriptions & direct controller calls never double-send
  private lastSentProfileKey = '';
  private lastSentHeldItem: HeldItemId = 'soy_milk';
  private lastSentEmote: EmoteId = 'none';
  private storeSubscribed = false;
  private unloadSubscribed = false;
  private networkEventsSubscribed = false;
  private unloadBeaconSent = false;

  private markPacketReceived(): void {
    this.lastPacketRecvMs = performance.now();
    if (this.room && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      const st = useGameStore.getState();
      if (!st.connected || st.connecting) {
        st.setNetworkStatus({ connected: true, connecting: false });
      }
    }
  }

  private flushPendingPolaroidAcks(reason: string): void {
    while (this.pendingPolaroidAcks.length > 0) {
      const item = this.pendingPolaroidAcks.shift()!;
      clearTimeout(item.timer);
      item.resolve({ ok: false, reason });
    }
  }

  private sendLeaveTabSignal(roomId: string, sessionId: string, preferBeacon: boolean): void {
    if (!roomId || !sessionId) return;
    const tabId = getOrCreateTabSessionId();
    const leaveSecret = getOrCreateTabLeaveSecret();
    const { httpUrl } = resolveServerEndpoints();
    const payload = JSON.stringify({
      roomId,
      sessionId,
      tabId,
      leaveSecret,
    });

    if (
      preferBeacon &&
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function'
    ) {
      try {
        const queued = navigator.sendBeacon(
          `${httpUrl}/api/leave-tab`,
          new Blob([payload], { type: 'text/plain;charset=UTF-8' })
        );
        if (queued) return;
      } catch {
        // fall through to keepalive fetch
      }
    }

    try {
      void fetch(`${httpUrl}/api/leave-tab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // ignore unload fetch errors
    }
  }

  private ensureNetworkLifecycleBridge(): void {
    if (this.networkEventsSubscribed || typeof window === 'undefined') return;
    this.networkEventsSubscribed = true;

    window.addEventListener('offline', () => {
      if (this.manuallyDisconnected) return;
      useGameStore.getState().setNetworkStatus({ connected: false, connecting: true });
    });

    window.addEventListener('online', () => {
      if (this.manuallyDisconnected) return;
      if (this.room) {
        try {
          this.room.send('ping_sync', { clientSendMs: Date.now() });
        } catch {
          // ignore transient socket error while Colyseus reconnects
        }
      } else {
        this.clearRetryTimer();
        void this.connect(this.desiredRoomCode);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.room) {
        this.lastPacketRecvMs = performance.now();
        try {
          this.room.send('ping_sync', { clientSendMs: Date.now() });
        } catch {
          // ignore
        }
      }
    });
  }

  private ensureUnloadBridge(): void {
    if (this.unloadSubscribed || typeof window === 'undefined') return;
    this.unloadSubscribed = true;

    const handleTabUnload = () => {
      if (this.unloadBeaconSent) return;
      const activeRoom = this.room;
      if (!activeRoom) return;
      this.unloadBeaconSent = true;

      this.sendLeaveTabSignal(activeRoom.roomId, activeRoom.sessionId, true);

      try {
        void activeRoom.leave(true).catch(() => {});
      } catch {
        // ignore socket close errors during page unload
      }
    };

    window.addEventListener('pagehide', handleTabUnload);
    window.addEventListener('beforeunload', handleTabUnload);
  }

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

  private buildJoinClientOptions() {
    const store = useGameStore.getState();
    return {
      tabId: getOrCreateTabSessionId(),
      leaveSecret: getOrCreateTabLeaveSecret(),
      displayName: store.displayName,
      outfit: store.outfit,
      heldItem: store.heldItem,
      x: store.localTransient.x,
      z: store.localTransient.z,
    };
  }

  public async connect(preferredRoomCode?: string): Promise<void> {
    this.ensureStoreBridge();
    this.ensureUnloadBridge();
    this.ensureNetworkLifecycleBridge();
    this.unloadBeaconSent = false;
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
    const joinOptions = this.buildJoinClientOptions();

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

      this.activateJoinedRoom(joinedRoom, resolvedRoomCode, resolvedChannelName);
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

  private activateJoinedRoom(
    joinedRoom: Room<any, ReflectedRoomState>,
    resolvedRoomCode?: string,
    resolvedChannelName?: string
  ): { finalCode: string; finalChannel: string } {
    const store = useGameStore.getState();

    // Configure automatic Colyseus SDK reconnection (matches server allowReconnection(45))
    joinedRoom.reconnection.enabled = true;
    joinedRoom.reconnection.minUptime = 0;
    joinedRoom.reconnection.maxRetries = 15;

    this.teardownActiveRoomResources();
    this.room = joinedRoom;
    this.retryAttempt = 0;
    this.lastPacketRecvMs = performance.now();

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
      occupiedBenches: {},
    });

    this.bindRoomHandlers(joinedRoom);
    joinedRoom.send('req_world_init');
    this.startCristianClockSync(joinedRoom);
    void this.refreshChannels();
    return { finalCode, finalChannel };
  }

  public async disconnect(): Promise<void> {
    this.manuallyDisconnected = true;
    this.clearRetryTimer();
    this.clearSyncTimers();
    this.flushPendingPolaroidAcks('Đã ngắt kết nối khỏi phòng săn mây.');

    const active = this.room;
    this.room = null;
    this.localNumericId = -1;
    this.numericIdToSessionId.clear();
    this.peerBuffers.clear();

    if (active) {
      this.sendLeaveTabSignal(active.roomId, active.sessionId, false);
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

  public async switchChannel(roomCodeOrId: string): Promise<SwitchChannelResult> {
    this.ensureStoreBridge();
    this.ensureUnloadBridge();
    this.ensureNetworkLifecycleBridge();

    const rawTarget = (roomCodeOrId || '').trim();
    if (!rawTarget) {
      const msg = 'Vui lòng nhập mã phòng hợp lệ (3–14 ký tự chữ hoặc số).';
      useGameStore.getState().showToast(msg);
      return { ok: false, error: msg };
    }

    const stBefore = useGameStore.getState();
    const isKnownRoomId = stBefore.availableChannels.some((c) => c.roomId === rawTarget);
    const normalized = isKnownRoomId ? rawTarget : normalizeRoomCode(rawTarget);

    if (!isKnownRoomId && !ROOM_CODE_REGEX.test(normalized)) {
      const msg = 'Mã phòng cần từ 3–14 ký tự chữ, số hoặc dấu gạch ngang (VD: DALAT-01).';
      stBefore.showToast(msg);
      return { ok: false, error: msg };
    }

    const { wsUrl, httpUrl } = resolveServerEndpoints();
    const joinOptions = this.buildJoinClientOptions();

    try {
      const res = await fetch(`${httpUrl}/api/join-channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCodeOrId: normalized,
          strictCustomCode: !isKnownRoomId,
          reserveSeat: true,
          clientOptions: joinOptions,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        const errPayload = (await res.json().catch(() => null)) as { error?: string } | null;
        const msg =
          (errPayload && typeof errPayload.error === 'string' && errPayload.error) ||
          (res.status === 429
            ? 'Bạn đổi phòng quá nhanh, vui lòng đợi ít giây rồi thử lại nhé.'
            : 'Không thể chuyển sang kênh săn mây này lúc này.');
        useGameStore.getState().showToast(msg);
        return { ok: false, error: msg };
      }

      const data = (await res.json()) as {
        roomId: string;
        roomCode: string;
        channelName: string;
        fallbackFromFull?: boolean;
        seatReservation?: Parameters<Client['consumeSeatReservation']>[0];
      };

      if (data.fallbackFromFull) {
        useGameStore
          .getState()
          .showToast('Kênh bạn chọn đã đầy 50/50 người, đã chuyển sang đồi mây gần nhất!');
      }

      this.manuallyDisconnected = false;
      this.unloadBeaconSent = false;
      this.clearRetryTimer();
      useGameStore.getState().setNetworkStatus({ connecting: true });

      if (!this.client) {
        this.client = new Client(wsUrl);
      }

      const joinedRoom = data.seatReservation
        ? await this.client.consumeSeatReservation<ReflectedRoomState>(data.seatReservation)
        : await this.client.joinById<ReflectedRoomState>(data.roomId, joinOptions);

      const { finalCode, finalChannel } = this.activateJoinedRoom(
        joinedRoom,
        data.roomCode,
        data.channelName
      );
      return { ok: true, roomCode: finalCode, channelName: finalChannel };
    } catch {
      const msg = 'Không thể kết nối tới kênh săn mây lúc này, vui lòng thử lại.';
      useGameStore.getState().setNetworkStatus({
        connected: Boolean(this.room),
        connecting: false,
      });
      useGameStore.getState().showToast(msg);
      return { ok: false, error: msg };
    }
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
    const st = useGameStore.getState();
    if (!this.room || (!st.connected && !st.connecting)) return;
    try {
      const packet = encodeClientMove(input);
      this.room.sendBytes('mv', packet);
    } catch {
      // ignore transient socket buffer errors during reconnect
    }
  }

  public sendTeleport(
    x: number,
    z: number,
    yaw?: number,
    opts?: { y?: number; qaOverride?: boolean }
  ): void {
    if (!this.room) return;
    try {
      this.room.send('teleport', {
        x,
        z,
        yaw,
        ...(opts?.y !== undefined ? { y: opts.y } : {}),
        ...(opts?.qaOverride ? { qaOverride: true } : {}),
      });
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
    kind: SocialInteractKind
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

  public async pinPolaroid(
    entry: Omit<PolaroidEntry, 'id' | 'likes' | 'createdAt'>
  ): Promise<PolaroidPinAck> {
    if (this.room && useGameStore.getState().connected) {
      const activeRoom = this.room;
      return new Promise<PolaroidPinAck>((resolve) => {
        const timer = setTimeout(() => {
          const idx = this.pendingPolaroidAcks.findIndex((p) => p.timer === timer);
          if (idx >= 0) {
            this.pendingPolaroidAcks.splice(idx, 1);
          }
          const reason = 'Máy chủ phản hồi chậm, vui lòng thử lại.';
          useGameStore.getState().showToast(reason);
          resolve({ ok: false, reason });
        }, 6000);

        this.pendingPolaroidAcks.push({ resolve, timer });
        try {
          activeRoom.send('polaroid_pin', entry);
        } catch {
          clearTimeout(timer);
          const idx = this.pendingPolaroidAcks.findIndex((p) => p.timer === timer);
          if (idx >= 0) {
            this.pendingPolaroidAcks.splice(idx, 1);
          }
          const reason = 'Không thể gửi ảnh lên bảng kỷ niệm lúc này.';
          useGameStore.getState().showToast(reason);
          resolve({ ok: false, reason });
        }
      });
    }

    const polaroidId = `local-pol-${Date.now()}`;
    useGameStore.getState().prependPolaroid({
      ...entry,
      id: polaroidId,
      likes: 1,
      createdAt: Date.now(),
    });
    return { ok: true, polaroidId };
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
      const tickDelta = (b.serverTick - a.serverTick + 65536) % 65536;
      const stepDist = Math.hypot(b.x - a.x, b.z - a.z);

      // Snap cleanly on >12m teleports or wraparound tick jumps without velocity tangent overshoot!
      if (spanMs < 1 || stepDist > 12 || tickDelta > 120) {
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
      const dtSec =
        tickDelta > 0 && tickDelta <= 48
          ? tickDelta / WORLD_CONSTANTS.NET_TICK_HZ
          : spanMs / 1000;

      // Cubic Hermite basis functions
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;

      const maxTangent = Math.max(0.25, stepDist * 1.35);
      let m0x = a.vx * dtSec;
      let m0z = a.vz * dtSec;
      const m0Len = Math.hypot(m0x, m0z);
      if (m0Len > maxTangent) {
        m0x = (m0x / m0Len) * maxTangent;
        m0z = (m0z / m0Len) * maxTangent;
      }

      let m1x = b.vx * dtSec;
      let m1z = b.vz * dtSec;
      const m1Len = Math.hypot(m1x, m1z);
      if (m1Len > maxTangent) {
        m1x = (m1x / m1Len) * maxTangent;
        m1z = (m1z / m1Len) * maxTangent;
      }

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
      this.markPacketReceived();
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

    // 2. 12 Hz Binary Snapshot Stream + AOI Tracking
    room.onMessage('snap', (bytes: Uint8Array) => {
      const decoded = decodeWorldSnapshot(bytes);
      if (!decoded) return;
      this.markPacketReceived();
      const recvMs = performance.now();
      const stSnap = useGameStore.getState();

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
          decoded.serverTick,
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

        const sid = this.numericIdToSessionId.get(p.numericId);
        if (sid && stSnap.peers[sid]) {
          stSnap.peers[sid].lastNearSnapMs = recvMs;
          stSnap.peers[sid].inNearAoi = true;
        }
      }

      // Update 2 Hz far-tier lantern silhouettes when sent (every 6th tick)
      if (decoded.serverTick % 6 === 0 || decoded.farPeers.length > 0) {
        const filteredFar: FarPeerBeacon[] =
          decoded.farPeers.length > 0
            ? decoded.farPeers.filter((b) => b.numericId !== this.localNumericId)
            : [];
        const stNow = useGameStore.getState();
        if (filteredFar.length > 0 || stNow.farBeacons.length > 0) {
          stNow.setFarBeacons(filteredFar);
        }
        // Keep far human/NPC peer coordinates fresh at 2 Hz for PocketMap & "Tới chỗ bạn" teleport, and mark out of near AOI!
        for (let i = 0; i < filteredFar.length; i++) {
          const b = filteredFar[i];
          const sid = this.numericIdToSessionId.get(b.numericId);
          if (!sid) continue;
          const peer = stNow.peers[sid];
          if (peer) {
            peer.inNearAoi = false;
            if (Math.abs(peer.x - b.x) > 0.2 || Math.abs(peer.z - b.z) > 0.2) {
              peer.x = b.x;
              peer.y = b.y;
              peer.z = b.z;
            }
          }
        }
      }

      // Mark peers whose near-tier snapshots stopped arriving (>1500ms) as out of near AOI
      for (const sid in stSnap.peers) {
        const peer = stSnap.peers[sid];
        if (
          peer &&
          peer.inNearAoi !== false &&
          peer.lastNearSnapMs !== undefined &&
          recvMs - peer.lastNearSnapMs > 1500
        ) {
          peer.inNearAoi = false;
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
        this.markPacketReceived();
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

    // 3b. Authoritative Server Pose Correction (e.g. teleport cooldown / clamp reconciliation)
    room.onMessage('pose_correct', (corr: ServerPoseCorrection) => {
      this.markPacketReceived();
      if (!corr || !Number.isFinite(corr.x) || !Number.isFinite(corr.z)) return;
      const lt = useGameStore.getState().localTransient;
      lt.x = corr.x;
      lt.y = Number.isFinite(corr.y) ? corr.y : sampleWalkableHeight(corr.x, corr.z);
      lt.z = corr.z;
      if (typeof corr.yaw === 'number' && Number.isFinite(corr.yaw)) {
        lt.yaw = corr.yaw;
      }
      lt.vx = 0;
      lt.vy = 0;
      lt.vz = 0;
    });

    // 4. Cristian Clock Sync Pong
    room.onMessage(
      'pong_sync',
      (payload: { clientSendMs?: number; serverEpochMs?: number }) => {
        this.markPacketReceived();
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

    // 5b. Quick Social Interactions (Wave / Warm Cup Clink / Cheer Sunrise / Gift Flower / Sparkler)
    room.onMessage(
      'social_event',
      (evt: {
        fromId?: string;
        fromName?: string;
        targetId?: string;
        targetName?: string;
        kind?: SocialInteractKind;
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
          if (evt.fromId) {
            st.setSelectedPeer(evt.fromId);
            const promptObj = {
              fromId: evt.fromId,
              fromName: sender,
              kind: evt.kind,
              timestamp: Date.now(),
            };
            st.setIncomingSocialPrompt(promptObj);
            setTimeout(() => {
              const cur = useGameStore.getState().incomingSocialPrompt;
              if (cur && cur.timestamp === promptObj.timestamp) {
                useGameStore.getState().setIncomingSocialPrompt(null);
              }
            }, 8500);
          }

          if (evt.kind === 'cheers') {
            st.grantWarmthBuff(480);
            st.showToast(`☕ ${sender} vừa cụng ly ấm cùng bạn — Giữ ấm +8 phút (+12% bước chân)!`);
          } else if (evt.kind === 'gift_flower') {
            st.setHeldItem('hydrangea_bouquet');
            this.lastSentHeldItem = 'hydrangea_bouquet';
            st.grantWarmthBuff(480);
            st.showToast(`💐 ${sender} vừa tặng bạn bó hoa Cẩm Tú Cầu Đà Lạt! (+8 phút ấm áp)`);
          } else if (evt.kind === 'sparkler') {
            st.setHeldItem('sparkler');
            this.lastSentHeldItem = 'sparkler';
            st.showToast(`✨ ${sender} vừa cùng bạn đốt pháo bông sương sớm!`);
          } else if (evt.kind === 'greet') {
            st.showToast(`👋 ${sender} đang vẫy tay chào bạn — Nhấn [G] để đáp lại!`);
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
          const standPos = st.seatedBenchId ? computeBenchStandUpPosition(st.seatedBenchId) : null;
          if (standPos) {
            st.localTransient.x = standPos[0];
            st.localTransient.y = standPos[1];
            st.localTransient.z = standPos[2];
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
      this.markPacketReceived();
      if (jam && typeof jam.chordIndex === 'number') {
        useGameStore.getState().setLastJamNote(jam);
      }
    });

    // 8. Polaroid Wall Ack & Wind-Chime Live Broadcasts
    room.onMessage('polaroid_pin_ack', (ack: PolaroidPinAck) => {
      this.markPacketReceived();
      const pending = this.pendingPolaroidAcks.shift();
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(ack || { ok: false, reason: 'Không thể ghim ảnh lúc này.' });
      }
      if (ack && !ack.ok && ack.reason) {
        useGameStore.getState().showToast(ack.reason);
      }
    });

    room.onMessage('polaroid_added', (entry: PolaroidEntry) => {
      this.markPacketReceived();
      if (entry && entry.id) {
        useGameStore.getState().prependPolaroid(entry);
      }
    });

    room.onMessage('polaroid_liked', (patch: { id: string; likes: number }) => {
      this.markPacketReceived();
      if (!patch?.id) return;
      const st = useGameStore.getState();
      st.setPolaroids(
        st.polaroids.map((p) => (p.id === patch.id ? { ...p, likes: patch.likes } : p))
      );
    });

    room.onMessage('windchime_added', (note: WindChimeNote) => {
      this.markPacketReceived();
      if (note && note.id) {
        useGameStore.getState().prependWindChimeNote(note);
      }
    });

    // 9. Connection Drop / Reconnect / Leave Lifecycle
    room.onDrop(() => {
      useGameStore.getState().setNetworkStatus({ connected: false, connecting: true });
    });

    room.onReconnect(() => {
      this.lastPacketRecvMs = performance.now();
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
      this.flushPendingPolaroidAcks('Phiên kết nối đã đóng, vui lòng ghim lại ảnh.');
      this.numericIdToSessionId.clear();
      this.peerBuffers.clear();

      const st = useGameStore.getState();
      st.resetPeers();
      st.setNetworkStatus({
        connected: false,
        connecting: !this.manuallyDisconnected,
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
    if (!player) return;
    if (sessionId === room.sessionId) {
      if (this.localNumericId === -1 && Number.isFinite(player.spawnX) && Number.isFinite(player.spawnZ)) {
        const lt = useGameStore.getState().localTransient;
        if (!lt.moving && Math.hypot(lt.x - -29.2, lt.z - 33.2) < 0.25) {
          lt.x = player.spawnX;
          lt.z = player.spawnZ;
          lt.y = Number.isFinite(player.spawnY) ? player.spawnY : sampleWalkableHeight(lt.x, lt.z);
        }
      }
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
      existing.isBot === isBot &&
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
      lastNearSnapMs: existing?.lastNearSnapMs ?? latestSample?.recvMs,
      inNearAoi: existing?.inNearAoi ?? Boolean(latestSample),
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

    // Packet-silence detector (<4s watchdog; triggers within a 3s network outage!)
    this.silenceWatchdogTimer = setInterval(() => {
      if (this.room !== room) return;
      if (typeof document !== 'undefined' && document.hidden) {
        this.lastPacketRecvMs = performance.now();
        return;
      }
      const silenceMs = performance.now() - this.lastPacketRecvMs;
      const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

      if (browserOffline || silenceMs > 2600) {
        const st = useGameStore.getState();
        if (st.connected || !st.connecting) {
          st.setNetworkStatus({ connected: false, connecting: true });
        }
      }

      if (!browserOffline && silenceMs > 1600) {
        try {
          room.send('ping_sync', { clientSendMs: Date.now() });
        } catch {
          // ignore transient socket buffer error while reconnecting
        }
      }
    }, 500);

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
    if (this.silenceWatchdogTimer) {
      clearInterval(this.silenceWatchdogTimer);
      this.silenceWatchdogTimer = null;
    }
  }

  private teardownActiveRoomResources(): void {
    this.clearSyncTimers();
    this.flushPendingPolaroidAcks('Đã chuyển kênh săn mây.');
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
