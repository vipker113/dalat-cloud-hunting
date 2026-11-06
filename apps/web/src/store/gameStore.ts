import { create } from 'zustand';
import {
  AcousticJamNote,
  AtmosphereSnapshot,
  ChatBubbleMessage,
  computeWorldAtmosphere,
  DEFAULT_OUTFIT,
  EmoteId,
  FarPeerBeacon,
  HeldItemId,
  LANDMARKS,
  LandmarkId,
  PlayerOutfit,
  PolaroidEntry,
  sampleWalkableHeight,
  WeatherStateId,
  WindChimeNote,
} from '@dalat/protocol';

export type QualityTier = 'high' | 'medium' | 'mobile';
export type UIOverlayModal = 'none' | 'wardrobe' | 'channels' | 'map' | 'almanac' | 'polaroids' | 'windchimes' | 'settings';

export interface RemotePeerState {
  sessionId: string;
  numericId: number;
  displayName: string;
  outfit: PlayerOutfit;
  heldItem: HeldItemId;
  emote: EmoteId;
  seatId: string;
  isBot: boolean;
  // Latest interpolated world transform updated inside useFrame without React re-render
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

export interface RoomChannelInfo {
  roomId: string;
  roomCode: string;
  channelName: string;
  playerCount: number;
  softCap: number;
  hardCap: number;
}

export interface LocalPlayerTransient {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  cameraYaw: number;
  cameraPitch: number;
  moving: boolean;
  running: boolean;
  grounded: boolean;
  jumpRequested: boolean;
  moveInputX: number; // -1..1 mobile/virtual joystick or keyboard
  moveInputZ: number; // -1..1
}

export interface PerfMetricsSnapshot {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
}

export interface InteractPrompt {
  id: string;
  label: string;
  sublabel?: string;
  actionType: 'brew_phin' | 'soy_milk' | 'sit_bench' | 'polaroid_board' | 'wind_chime' | 'acoustic_jam' | 'cub_photo';
  benchId?: string;
  position: [number, number, number];
}

export interface GameStoreState {
  // Entry & Session
  hasEnteredWorld: boolean;
  displayName: string;
  outfit: PlayerOutfit;
  heldItem: HeldItemId;
  activeEmote: EmoteId;
  seatedBenchId: string | null;
  warmthRemainingSec: number; // >0 grants Highland Warmth cozy buff!

  // Networking
  connected: boolean;
  connecting: boolean;
  localSessionId: string;
  roomCode: string;
  channelName: string;
  roomId: string;
  rttMs: number;
  serverTimeOffsetMs: number;
  peers: Record<string, RemotePeerState>;
  farBeacons: FarPeerBeacon[];
  availableChannels: RoomChannelInfo[];
  occupiedBenches: Record<string, string>; // benchId -> sessionId

  // Mutable high-frequency transient ref read/written inside useFrame (0 React re-renders!)
  localTransient: LocalPlayerTransient;
  teleportTarget: { position: [number, number, number]; lookAt?: [number, number, number]; nonce: number } | null;

  // Atmosphere & Quality
  atmosphere: AtmosphereSnapshot;
  overrideGameHour: number | null;
  overrideWeather: WeatherStateId | null;
  qualityTier: QualityTier;
  autoQuality: boolean;
  audioEnabled: boolean;
  masterVolume: number;

  // Social & World Persistence
  chatBubbles: ChatBubbleMessage[];
  polaroids: PolaroidEntry[];
  windChimeNotes: WindChimeNote[];
  lastJamNote: AcousticJamNote | null;
  discoveredLandmarks: Record<LandmarkId, boolean>;
  discoveredWeathers: Partial<Record<WeatherStateId, boolean>>;

  // UI & Photo Mode
  activeModal: UIOverlayModal;
  photoModeActive: boolean;
  photoFocalMm: 24 | 35 | 50 | 85;
  photoFilter: 'natural' | 'kodak_dawn' | 'fuji_pine' | 'dreamy_mist';
  photoHideCrowd: boolean;
  photoCountdown: number; // 0 = idle, 3..1 = counting
  photoShutterNonce: number;
  latestCapturedPolaroid: PolaroidEntry | null;
  nearbyPrompt: InteractPrompt | null;
  toastBanner: string | null;
  perfMetrics: PerfMetricsSnapshot;

  // Actions
  setDisplayName: (name: string) => void;
  updateOutfit: (partial: Partial<PlayerOutfit>) => void;
  enterWorld: () => void;
  setHeldItem: (item: HeldItemId) => void;
  triggerEmote: (emote: EmoteId) => void;
  setSeatedBench: (benchId: string | null) => void;
  grantWarmthBuff: (seconds?: number) => void;
  tickWarmthAndAtmosphere: (dtSec: number) => void;
  teleportTo: (position: [number, number, number], lookAt?: [number, number, number]) => void;
  teleportToLandmark: (id: LandmarkId) => void;
  setOverrideAtmosphere: (gameHour: number | null, weather: WeatherStateId | null) => void;
  setQualityTier: (tier: QualityTier, auto?: boolean) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setMasterVolume: (v: number) => void;
  setActiveModal: (modal: UIOverlayModal) => void;
  setPhotoMode: (active: boolean) => void;
  setPhotoOptions: (opts: Partial<Pick<GameStoreState, 'photoFocalMm' | 'photoFilter' | 'photoHideCrowd' | 'photoCountdown'>>) => void;
  requestPhotoShutter: () => void;
  setLatestCapturedPolaroid: (entry: PolaroidEntry | null) => void;
  setNearbyPrompt: (prompt: InteractPrompt | null) => void;
  showToast: (msg: string) => void;
  markLandmarkDiscovered: (id: LandmarkId) => void;
  setPerfMetrics: (metrics: PerfMetricsSnapshot) => void;

  // Network Mutators (called by network/multiplayerClient.ts)
  setNetworkStatus: (patch: Partial<Pick<GameStoreState, 'connected' | 'connecting' | 'localSessionId' | 'roomCode' | 'channelName' | 'roomId' | 'rttMs' | 'serverTimeOffsetMs' | 'availableChannels' | 'occupiedBenches'>>) => void;
  upsertPeer: (peer: RemotePeerState) => void;
  removePeer: (sessionId: string) => void;
  resetPeers: () => void;
  setFarBeacons: (beacons: FarPeerBeacon[]) => void;
  pushChatBubble: (msg: ChatBubbleMessage) => void;
  setPolaroids: (items: PolaroidEntry[]) => void;
  prependPolaroid: (item: PolaroidEntry) => void;
  setWindChimeNotes: (notes: WindChimeNote[]) => void;
  prependWindChimeNote: (note: WindChimeNote) => void;
  setLastJamNote: (jam: AcousticJamNote) => void;
}

const spawn = LANDMARKS['quan-mo-suong'].position;

function loadSavedProfile(): { name: string; outfit: PlayerOutfit } {
  try {
    const raw = localStorage.getItem('dalat_profile_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : 'Người Săn Mây',
        outfit: { ...DEFAULT_OUTFIT, ...(parsed.outfit || {}) },
      };
    }
  } catch {
    // ignore storage errors
  }
  const suffix = Math.floor(10 + Math.random() * 89);
  return { name: `Lữ Khách #${suffix}`, outfit: { ...DEFAULT_OUTFIT } };
}

const initialProfile = typeof window !== 'undefined' ? loadSavedProfile() : { name: 'Lữ Khách', outfit: DEFAULT_OUTFIT };

export const useGameStore = create<GameStoreState>((set, get) => ({
  hasEnteredWorld: false,
  displayName: initialProfile.name,
  outfit: initialProfile.outfit,
  heldItem: 'soy_milk',
  activeEmote: 'none',
  seatedBenchId: null,
  warmthRemainingSec: 180,

  connected: false,
  connecting: false,
  localSessionId: '',
  roomCode: 'MAY-01',
  channelName: 'Sương Sớm Cầu Đất #1',
  roomId: '',
  rttMs: 28,
  serverTimeOffsetMs: 0,
  peers: {},
  farBeacons: [],
  availableChannels: [],
  occupiedBenches: {},

  localTransient: {
    x: spawn[0] - 4,
    y: sampleWalkableHeight(spawn[0] - 4, spawn[2] + 3),
    z: spawn[2] + 3,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 1.35,
    cameraYaw: -0.25,
    cameraPitch: 0.14,
    moving: false,
    running: false,
    grounded: true,
    jumpRequested: false,
    moveInputX: 0,
    moveInputZ: 0,
  },
  teleportTarget: null,

  // Start initial preview in the magical pre-sunrise window if not yet synced, then sync seamlessly!
  atmosphere: computeWorldAtmosphere(Date.now(), null, null),
  overrideGameHour: null,
  overrideWeather: null,
  qualityTier:
    typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
      ? 'mobile'
      : 'high',
  autoQuality: true,
  audioEnabled: true,
  masterVolume: 0.65,

  chatBubbles: [],
  polaroids: [],
  windChimeNotes: [],
  lastJamNote: null,
  discoveredLandmarks: {
    'quan-mo-suong': true,
    'cau-go-san-may': false,
    'cay-thong-co-don': false,
    'dai-ngam-den': false,
    'gac-che-1927': false,
  },
  discoveredWeathers: { golden_cloud_sea: true },

  activeModal: 'none',
  photoModeActive: false,
  photoFocalMm: 35,
  photoFilter: 'kodak_dawn',
  photoHideCrowd: false,
  photoCountdown: 0,
  photoShutterNonce: 0,
  latestCapturedPolaroid: null,
  nearbyPrompt: null,
  toastBanner: null,
  perfMetrics: {
    fps: 60,
    frameTimeMs: 16.6,
    drawCalls: 0,
    triangles: 0,
    textures: 0,
    geometries: 0,
  },

  setDisplayName: (displayName) => {
    set({ displayName });
    try {
      localStorage.setItem('dalat_profile_v1', JSON.stringify({ name: displayName, outfit: get().outfit }));
    } catch {}
  },

  updateOutfit: (partial) => {
    const next = { ...get().outfit, ...partial };
    set({ outfit: next });
    try {
      localStorage.setItem('dalat_profile_v1', JSON.stringify({ name: get().displayName, outfit: next }));
    } catch {}
  },

  enterWorld: () => set({ hasEnteredWorld: true, activeModal: 'none' }),
  setHeldItem: (heldItem) => set({ heldItem }),
  triggerEmote: (activeEmote) => set({ activeEmote }),
  setSeatedBench: (seatedBenchId) => set({ seatedBenchId }),

  grantWarmthBuff: (seconds = 480) => {
    set({ warmthRemainingSec: seconds });
  },

  tickWarmthAndAtmosphere: (dtSec) => {
    const st = get();
    const syncedEpoch = Date.now() + st.serverTimeOffsetMs;
    const nextAtmo = computeWorldAtmosphere(syncedEpoch, st.overrideGameHour, st.overrideWeather);
    const nextWarmth = Math.max(0, st.warmthRemainingSec - dtSec);
    const nowMs = Date.now();
    const filteredBubbles =
      st.chatBubbles.length > 0 && st.chatBubbles.some((b) => nowMs - b.timestamp > 8500)
        ? st.chatBubbles.filter((b) => nowMs - b.timestamp <= 8500)
        : st.chatBubbles;

    const weatherSeen = st.discoveredWeathers[nextAtmo.weather]
      ? st.discoveredWeathers
      : { ...st.discoveredWeathers, [nextAtmo.weather]: true };

    set({
      atmosphere: nextAtmo,
      warmthRemainingSec: nextWarmth,
      chatBubbles: filteredBubbles,
      discoveredWeathers: weatherSeen,
    });
  },

  teleportTo: (position, lookAt) => {
    const st = get();
    st.localTransient.x = position[0];
    st.localTransient.y = position[1];
    st.localTransient.z = position[2];
    st.localTransient.vx = 0;
    st.localTransient.vy = 0;
    st.localTransient.vz = 0;
    if (lookAt) {
      const dx = lookAt[0] - position[0];
      const dz = lookAt[2] - position[2];
      const yaw = Math.atan2(dx, dz);
      st.localTransient.yaw = yaw;
      st.localTransient.cameraYaw = Math.atan2(-dx, -dz);
    }
    set({
      seatedBenchId: null,
      teleportTarget: { position, lookAt, nonce: Date.now() + Math.random() },
    });
  },

  teleportToLandmark: (id) => {
    const lm = LANDMARKS[id];
    if (!lm) return;
    get().teleportTo(lm.position, lm.lookAt);
    get().markLandmarkDiscovered(id);
    set({ activeModal: 'none' });
  },

  setOverrideAtmosphere: (overrideGameHour, overrideWeather) => {
    const syncedEpoch = Date.now() + get().serverTimeOffsetMs;
    set({
      overrideGameHour,
      overrideWeather,
      atmosphere: computeWorldAtmosphere(syncedEpoch, overrideGameHour, overrideWeather),
    });
  },

  setQualityTier: (qualityTier, auto = false) => set({ qualityTier, autoQuality: auto }),
  setAudioEnabled: (audioEnabled) => set({ audioEnabled }),
  setMasterVolume: (masterVolume) => set({ masterVolume }),
  setActiveModal: (activeModal) => set({ activeModal }),
  setPhotoMode: (photoModeActive) =>
    set({ photoModeActive, activeModal: 'none', latestCapturedPolaroid: photoModeActive ? get().latestCapturedPolaroid : null }),
  setPhotoOptions: (opts) => set(opts),
  requestPhotoShutter: () => set((s) => ({ photoShutterNonce: s.photoShutterNonce + 1 })),
  setLatestCapturedPolaroid: (latestCapturedPolaroid) => set({ latestCapturedPolaroid }),
  setNearbyPrompt: (nearbyPrompt) => set({ nearbyPrompt }),

  showToast: (msg) => {
    set({ toastBanner: msg });
    setTimeout(() => {
      if (get().toastBanner === msg) {
        set({ toastBanner: null });
      }
    }, 4200);
  },

  markLandmarkDiscovered: (id) => {
    if (get().discoveredLandmarks[id]) return;
    set((s) => ({
      discoveredLandmarks: { ...s.discoveredLandmarks, [id]: true },
    }));
  },

  setPerfMetrics: (perfMetrics) => set({ perfMetrics }),

  setNetworkStatus: (patch) => set(patch),
  upsertPeer: (peer) =>
    set((s) => ({
      peers: { ...s.peers, [peer.sessionId]: peer },
    })),
  removePeer: (sessionId) =>
    set((s) => {
      const next = { ...s.peers };
      delete next[sessionId];
      return { peers: next };
    }),
  resetPeers: () => set({ peers: {}, farBeacons: [] }),
  setFarBeacons: (farBeacons) => set({ farBeacons }),
  pushChatBubble: (msg) =>
    set((s) => ({
      chatBubbles: [...s.chatBubbles.slice(-24), msg],
    })),
  setPolaroids: (polaroids) => set({ polaroids }),
  prependPolaroid: (item) =>
    set((s) => ({
      polaroids: [item, ...s.polaroids.filter((p) => p.id !== item.id)].slice(0, 24),
    })),
  setWindChimeNotes: (windChimeNotes) => set({ windChimeNotes }),
  prependWindChimeNote: (note) =>
    set((s) => ({
      windChimeNotes: [note, ...s.windChimeNotes.filter((n) => n.id !== note.id)].slice(0, 30),
    })),
  setLastJamNote: (lastJamNote) => set({ lastJamNote }),
}));
