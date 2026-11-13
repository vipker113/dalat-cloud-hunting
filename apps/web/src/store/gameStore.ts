import { create } from 'zustand';
import {
  AcousticJamNote,
  AtmosphereSnapshot,
  ChatBubbleMessage,
  computeWorldAtmosphere,
  DEFAULT_OUTFIT,
  EmoteId,
  ensureCoatMatchesGender,
  FarPeerBeacon,
  getCoatGender,
  HeldItemId,
  LANDMARK_LIST,
  LANDMARKS,
  LandmarkId,
  PlayerOutfit,
  PolaroidEntry,
  resolveEffectiveGender,
  sampleWalkableHeight,
  SocialInteractKind,
  WeatherStateId,
  WindChimeNote,
} from '@dalat/protocol';
import { getNetController } from '../gameplay/netBridge';

export type QualityTier = 'high' | 'medium' | 'mobile';
export type UIOverlayModal =
  | 'none'
  | 'wardrobe'
  | 'channels'
  | 'map'
  | 'almanac'
  | 'polaroids'
  | 'windchimes'
  | 'settings';

export type OnboardingStep = 'move' | 'look' | 'interact' | 'done';

export interface ChatLogEntry extends ChatBubbleMessage {
  landmarkShort?: string;
}

export interface UXSessionMetrics {
  mountedAtMs: number;
  enteredWorldAtMs: number | null;
  timeToEnterMs: number | null;
  firstWalkAtMs: number | null;
  firstOrbitAtMs: number | null;
  timeToControlsSec: number | null;
  mapFastTravels: number;
  friendTeleports: number;
  contextInteractions: number;
  socialInteractions: number;
  inviteCopies: number;
  photosCaptured: number;
}

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
  lastNearSnapMs?: number;
  inNearAoi?: boolean;
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
  targetCameraDistance: number;
  moving: boolean;
  running: boolean;
  grounded: boolean;
  jumpRequested: boolean;
  moveInputX: number; // -1..1 mobile/virtual joystick or keyboard
  moveInputZ: number; // -1..1
  // High-frequency 360° Live Dressing Stage Turntable, Pan & Zoom (0 React re-renders during drag!)
  previewTargetYaw: number;
  previewCurrentYaw: number;
  previewYawVel: number;
  previewTargetPanY: number;
  previewCurrentPanY: number;
  previewTargetZoom: number;
  previewCurrentZoom: number;
  camX: number;
  camY: number;
  camZ: number;
  cameraOccludesSelf: boolean;
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
  actionType:
    | 'brew_phin'
    | 'soy_milk'
    | 'sit_bench'
    | 'polaroid_board'
    | 'wind_chime'
    | 'acoustic_jam'
    | 'cub_photo'
    | 'valley_return';
  benchId?: string;
  position: [number, number, number];
}

export interface NearbyPeerInfo {
  sessionId: string;
  displayName: string;
  isBot: boolean;
  heldItem: HeldItemId;
  emote: EmoteId;
  seatId?: string;
  distance: number;
  x: number;
  y: number;
  z: number;
}

export interface SocialSparkleBurst {
  id: number;
  kind: SocialInteractKind;
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

export interface IncomingSocialPrompt {
  fromId: string;
  fromName: string;
  kind: SocialInteractKind;
  timestamp: number;
}

export interface GameStoreState {
  // Entry, Loading & Session
  sceneReady: boolean;
  hasEnteredWorld: boolean;
  visitCount: number;
  onboardingStep: OnboardingStep;
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
  teleportTarget: {
    position: [number, number, number];
    lookAt?: [number, number, number];
    nonce: number;
  } | null;

  // Atmosphere, Comfort & Quality
  atmosphere: AtmosphereSnapshot;
  overrideGameHour: number | null;
  overrideWeather: WeatherStateId | null;
  qualityTier: QualityTier;
  autoQuality: boolean;
  audioEnabled: boolean;
  masterVolume: number;
  cameraSensitivity: number;
  reducedMotion: boolean;
  quietMode: boolean;

  // Social & World Persistence
  chatBubbles: ChatBubbleMessage[];
  chatHistory: ChatLogEntry[];
  unreadChatCount: number;
  chatDrawerOpen: boolean;
  polaroids: PolaroidEntry[];
  capturedPolaroids: PolaroidEntry[];
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
  photoIncludeInviteCode: boolean;
  photoCountdown: number; // 0 = idle, 3..1 = counting
  photoShutterNonce: number;
  latestCapturedPolaroid: PolaroidEntry | null;
  nearbyPrompt: InteractPrompt | null;
  nearbyPeer: NearbyPeerInfo | null;
  selectedPeerSessionId: string | null;
  dismissedPeerId: string | null;
  incomingSocialPrompt: IncomingSocialPrompt | null;
  previewYawOffset: number;
  isDraggingPreview: boolean;
  socialSparkleBurst: SocialSparkleBurst | null;
  toastBanner: string | null;
  perfMetrics: PerfMetricsSnapshot;
  uxMetrics: UXSessionMetrics;

  // Actions
  markSceneReady: () => void;
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
  teleportToPeer: (sessionId: string) => boolean;
  setOverrideAtmosphere: (gameHour: number | null, weather: WeatherStateId | null) => void;
  setQualityTier: (tier: QualityTier, auto?: boolean) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setMasterVolume: (v: number) => void;
  setCameraSensitivity: (v: number) => void;
  setReducedMotion: (enabled: boolean) => void;
  setQuietMode: (enabled: boolean) => void;
  setActiveModal: (modal: UIOverlayModal) => void;
  setChatDrawerOpen: (open: boolean) => void;
  clearUnreadChat: () => void;
  setPhotoMode: (active: boolean) => void;
  setPhotoOptions: (
    opts: Partial<
      Pick<
        GameStoreState,
        | 'photoFocalMm'
        | 'photoFilter'
        | 'photoHideCrowd'
        | 'photoIncludeInviteCode'
        | 'photoCountdown'
      >
    >
  ) => void;
  requestPhotoShutter: () => void;
  setLatestCapturedPolaroid: (entry: PolaroidEntry | null) => void;
  setNearbyPrompt: (prompt: InteractPrompt | null) => void;
  setNearbyPeer: (peer: NearbyPeerInfo | null) => void;
  setSelectedPeer: (sessionId: string | null) => void;
  dismissPeerPrompt: (sessionId: string | null) => void;
  setIncomingSocialPrompt: (prompt: IncomingSocialPrompt | null) => void;
  setPreviewYawOffset: (yaw: number) => void;
  addPreviewYawOffset: (deltaYaw: number) => void;
  setIsDraggingPreview: (dragging: boolean) => void;
  resetPreviewStage: () => void;
  triggerSocialSparkle: (kind: SocialSparkleBurst['kind'], x: number, y: number, z: number) => void;
  showToast: (msg: string) => void;
  markLandmarkDiscovered: (id: LandmarkId) => void;
  advanceOnboarding: (action: 'move' | 'look' | 'interact' | 'skip') => void;
  recordUXEvent: (
    kind: 'context_interact' | 'social_interact' | 'invite_copy' | 'photo_capture'
  ) => void;
  setPerfMetrics: (metrics: PerfMetricsSnapshot) => void;

  // Network Mutators (called by network/multiplayerClient.ts)
  setNetworkStatus: (
    patch: Partial<
      Pick<
        GameStoreState,
        | 'connected'
        | 'connecting'
        | 'localSessionId'
        | 'roomCode'
        | 'channelName'
        | 'roomId'
        | 'rttMs'
        | 'serverTimeOffsetMs'
        | 'availableChannels'
        | 'occupiedBenches'
      >
    >
  ) => void;
  upsertPeer: (peer: RemotePeerState) => void;
  removePeer: (sessionId: string) => void;
  resetPeers: () => void;
  setFarBeacons: (beacons: FarPeerBeacon[]) => void;
  pushChatBubble: (msg: ChatBubbleMessage) => void;
  setPolaroids: (items: PolaroidEntry[]) => void;
  prependPolaroid: (item: PolaroidEntry) => void;
  saveCapturedPolaroid: (item: PolaroidEntry) => void;
  setWindChimeNotes: (notes: WindChimeNote[]) => void;
  prependWindChimeNote: (note: WindChimeNote) => void;
  setLastJamNote: (jam: AcousticJamNote) => void;
}

const STORAGE_KEY_V2 = 'dalat_state_v2';
const POLAROID_ALBUM_KEY = 'dalat_polaroid_album_v1';

const DEFAULT_LANDMARKS: Record<LandmarkId, boolean> = {
  'quan-mo-suong': true,
  'cau-go-san-may': false,
  'cay-thong-co-don': false,
  'dai-ngam-den': false,
  'gac-che-1927': false,
};

const SHORT_SPOT_NAMES: Record<LandmarkId, string> = {
  'quan-mo-suong': 'Mơ Sương',
  'cau-go-san-may': 'Cầu Gỗ',
  'cay-thong-co-don': 'Thông Cô Đơn',
  'dai-ngam-den': 'Thung Lũng Đèn',
  'gac-che-1927': 'Gác Chè 1927',
};

function resolveNearestShortLandmark(x: number, z: number): string {
  let best = LANDMARK_LIST[0];
  let minD = Infinity;
  for (let i = 0; i < LANDMARK_LIST.length; i++) {
    const lm = LANDMARK_LIST[i];
    const d = Math.hypot(x - lm.position[0], z - lm.position[2]);
    if (d < minD) {
      minD = d;
      best = lm;
    }
  }
  return SHORT_SPOT_NAMES[best.id] || 'Đồi Cầu Đất';
}

interface PersistedStateV2 {
  version: 2;
  name: string;
  outfit: PlayerOutfit;
  heldItem: HeldItemId;
  discoveredLandmarks: Record<LandmarkId, boolean>;
  discoveredWeathers: Partial<Record<WeatherStateId, boolean>>;
  audioEnabled: boolean;
  masterVolume: number;
  cameraSensitivity: number;
  reducedMotion: boolean;
  quietMode: boolean;
  visitCount: number;
  onboardingDone: boolean;
}

function syncBodyDataAttributes(qualityTier: QualityTier, reducedMotion: boolean) {
  if (typeof document === 'undefined' || !document.body) return;
  document.body.dataset.qualityTier = qualityTier;
  document.body.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
}

function loadInitialPolaroidAlbum(legacyPolaroids: PolaroidEntry[] = []): PolaroidEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(POLAROID_ALBUM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((p) => p && typeof p.id === 'string').slice(0, 8);
      }
    }
    if (legacyPolaroids.length > 0) {
      const migrated = legacyPolaroids.slice(0, 6);
      persistPolaroidAlbum(migrated);
      return migrated;
    }
  } catch {
    // ignore storage errors
  }
  return [];
}

function persistPolaroidAlbum(items: PolaroidEntry[]): void {
  if (typeof window === 'undefined') return;
  const trimmed = items.slice(0, 8);
  try {
    localStorage.setItem(POLAROID_ALBUM_KEY, JSON.stringify(trimmed));
  } catch {
    try {
      localStorage.setItem(POLAROID_ALBUM_KEY, JSON.stringify(trimmed.slice(0, 3)));
    } catch {}
  }
}

let legacyMigratedPolaroids: PolaroidEntry[] = [];

function loadInitialPersistedState(): PersistedStateV2 {
  const defaultReduced =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  const fallbackSuffix = Math.floor(10 + Math.random() * 89);
  const fallback: PersistedStateV2 = {
    version: 2,
    name: `Lữ Khách #${fallbackSuffix}`,
    outfit: { ...DEFAULT_OUTFIT },
    heldItem: 'soy_milk',
    discoveredLandmarks: { ...DEFAULT_LANDMARKS },
    discoveredWeathers: { golden_cloud_sea: true },
    audioEnabled: true,
    masterVolume: 0.65,
    cameraSensitivity: 1.0,
    reducedMotion: defaultReduced,
    quietMode: false,
    visitCount: 1,
    onboardingDone: false,
  };

  if (typeof window === 'undefined') return fallback;

  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (Array.isArray(parsed.savedPolaroids) && parsed.savedPolaroids.length > 0) {
        legacyMigratedPolaroids = parsed.savedPolaroids.slice(0, 6);
      }
      const rawOutfit: PlayerOutfit = { ...DEFAULT_OUTFIT, ...(parsed.outfit || {}) };
      const effGender = resolveEffectiveGender(rawOutfit);
      rawOutfit.gender = effGender;
      rawOutfit.coatStyle = ensureCoatMatchesGender(rawOutfit.coatStyle, effGender);

      const nextCount = typeof parsed.visitCount === 'number' ? parsed.visitCount + 1 : 2;
      const hydrated: PersistedStateV2 = {
        version: 2,
        name:
          typeof parsed.name === 'string' && parsed.name.trim()
            ? parsed.name.trim().slice(0, 24)
            : fallback.name,
        outfit: rawOutfit,
        heldItem: typeof parsed.heldItem === 'string' ? parsed.heldItem : 'soy_milk',
        discoveredLandmarks: {
          ...DEFAULT_LANDMARKS,
          ...(parsed.discoveredLandmarks || {}),
        },
        discoveredWeathers: {
          golden_cloud_sea: true,
          ...(parsed.discoveredWeathers || {}),
        },
        audioEnabled: typeof parsed.audioEnabled === 'boolean' ? parsed.audioEnabled : true,
        masterVolume:
          typeof parsed.masterVolume === 'number'
            ? Math.max(0, Math.min(1, parsed.masterVolume))
            : 0.65,
        cameraSensitivity:
          typeof parsed.cameraSensitivity === 'number'
            ? Math.max(0.4, Math.min(1.8, parsed.cameraSensitivity))
            : 1.0,
        reducedMotion:
          typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : defaultReduced,
        quietMode: Boolean(parsed.quietMode),
        visitCount: nextCount,
        onboardingDone: Boolean(parsed.onboardingDone),
      };
      try {
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(hydrated));
      } catch {}
      return hydrated;
    }

    // Migrate legacy dalat_profile_v1 seamlessly if present
    const rawV1 = localStorage.getItem('dalat_profile_v1');
    if (rawV1) {
      const parsed = JSON.parse(rawV1);
      const rawOutfit: PlayerOutfit = { ...DEFAULT_OUTFIT, ...(parsed.outfit || {}) };
      const effGender = resolveEffectiveGender(rawOutfit);
      rawOutfit.gender = effGender;
      rawOutfit.coatStyle = ensureCoatMatchesGender(rawOutfit.coatStyle, effGender);
      const migrated: PersistedStateV2 = {
        ...fallback,
        name:
          typeof parsed.name === 'string' && parsed.name.trim()
            ? parsed.name.trim().slice(0, 24)
            : fallback.name,
        outfit: rawOutfit,
        visitCount: 2,
      };
      try {
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(migrated));
      } catch {}
      return migrated;
    }

    try {
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(fallback));
    } catch {}
  } catch {
    // ignore storage errors
  }

  return fallback;
}

/**
 * Lightweight settings/profile save (<600 bytes) — never serializes Polaroid data URLs!
 */
function persistSave(st: GameStoreState): void {
  if (typeof window === 'undefined') return;
  const payload: PersistedStateV2 = {
    version: 2,
    name: st.displayName,
    outfit: st.outfit,
    heldItem: st.heldItem,
    discoveredLandmarks: st.discoveredLandmarks,
    discoveredWeathers: st.discoveredWeathers,
    audioEnabled: st.audioEnabled,
    masterVolume: st.masterVolume,
    cameraSensitivity: st.cameraSensitivity,
    reducedMotion: st.reducedMotion,
    quietMode: st.quietMode,
    visitCount: st.visitCount,
    onboardingDone: st.onboardingStep === 'done',
  };
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(payload));
    localStorage.setItem(
      'dalat_profile_v1',
      JSON.stringify({ name: st.displayName, outfit: st.outfit })
    );
  } catch {
    // ignore storage errors
  }
}

const persistSnapshot = persistSave;

const initialPersisted = loadInitialPersistedState();
const initialPolaroidAlbum = loadInitialPolaroidAlbum(legacyMigratedPolaroids);
const initialQualityTier: QualityTier =
  typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    ? 'mobile'
    : 'high';

syncBodyDataAttributes(initialQualityTier, initialPersisted.reducedMotion);

export const useGameStore = create<GameStoreState>((set, get) => ({
  sceneReady: false,
  hasEnteredWorld: false,
  visitCount: initialPersisted.visitCount,
  onboardingStep: initialPersisted.onboardingDone ? 'done' : 'move',
  displayName: initialPersisted.name,
  outfit: initialPersisted.outfit,
  heldItem: initialPersisted.heldItem,
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
    x: -29.2,
    y: sampleWalkableHeight(-29.2, 33.2),
    z: 33.2,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 1.48,
    cameraYaw: -1.62,
    cameraPitch: 0.12,
    targetCameraDistance: 4.35,
    moving: false,
    running: false,
    grounded: true,
    jumpRequested: false,
    moveInputX: 0,
    moveInputZ: 0,
    previewTargetYaw: 0,
    previewCurrentYaw: 0,
    previewYawVel: 0,
    previewTargetPanY: 0,
    previewCurrentPanY: 0,
    previewTargetZoom: 1,
    previewCurrentZoom: 1,
    camX: -33.5,
    camY: 137.0,
    camZ: 33.2,
    cameraOccludesSelf: false,
  },
  teleportTarget: null,

  atmosphere: computeWorldAtmosphere(Date.now(), null, null),
  overrideGameHour: null,
  overrideWeather: null,
  qualityTier: initialQualityTier,
  autoQuality: true,
  audioEnabled: initialPersisted.audioEnabled,
  masterVolume: initialPersisted.masterVolume,
  cameraSensitivity: initialPersisted.cameraSensitivity,
  reducedMotion: initialPersisted.reducedMotion,
  quietMode: initialPersisted.quietMode,

  chatBubbles: [],
  chatHistory: [],
  unreadChatCount: 0,
  chatDrawerOpen: false,
  polaroids: [],
  capturedPolaroids: initialPolaroidAlbum,
  windChimeNotes: [],
  lastJamNote: null,
  discoveredLandmarks: initialPersisted.discoveredLandmarks,
  discoveredWeathers: initialPersisted.discoveredWeathers,

  activeModal: 'none',
  photoModeActive: false,
  photoFocalMm: 35,
  photoFilter: 'kodak_dawn',
  photoHideCrowd: false,
  photoIncludeInviteCode: true,
  photoCountdown: 0,
  photoShutterNonce: 0,
  latestCapturedPolaroid: null,
  nearbyPrompt: null,
  nearbyPeer: null,
  selectedPeerSessionId: null,
  dismissedPeerId: null,
  incomingSocialPrompt: null,
  previewYawOffset: 0,
  isDraggingPreview: false,
  socialSparkleBurst: null,
  toastBanner: null,
  perfMetrics: {
    fps: 60,
    frameTimeMs: 16.6,
    drawCalls: 0,
    triangles: 0,
    textures: 0,
    geometries: 0,
  },
  uxMetrics: {
    mountedAtMs: typeof performance !== 'undefined' ? Math.round(performance.now()) : 0,
    enteredWorldAtMs: null,
    timeToEnterMs: null,
    firstWalkAtMs: null,
    firstOrbitAtMs: null,
    timeToControlsSec: null,
    mapFastTravels: 0,
    friendTeleports: 0,
    contextInteractions: 0,
    socialInteractions: 0,
    inviteCopies: 0,
    photosCaptured: 0,
  },

  markSceneReady: () => {
    if (!get().sceneReady) set({ sceneReady: true });
  },

  setDisplayName: (displayName) => {
    set({ displayName });
    persistSnapshot(get());
  },

  updateOutfit: (partial) => {
    const cur = get().outfit;
    const next: PlayerOutfit = { ...cur, ...partial };
    if (partial.gender !== undefined) {
      next.gender = partial.gender;
      next.coatStyle = ensureCoatMatchesGender(next.coatStyle, partial.gender);
    } else if (partial.coatStyle !== undefined) {
      next.gender = getCoatGender(partial.coatStyle);
    } else {
      next.gender = resolveEffectiveGender(next);
    }
    if (partial.bagStyle !== undefined) {
      next.backpack = partial.bagStyle !== 'none';
    } else if (partial.backpack !== undefined) {
      next.bagStyle = partial.backpack
        ? cur.bagStyle && cur.bagStyle !== 'none'
          ? cur.bagStyle
          : 'trek_pack'
        : 'none';
    }
    set({ outfit: next });
    persistSnapshot(get());
  },

  enterWorld: () =>
    set((s) => {
      for (let attempt = 0; attempt < 8; attempt++) {
        let tooClose = false;
        for (const peerId in s.peers) {
          const peer = s.peers[peerId];
          if (
            peer &&
            Math.hypot(peer.x - s.localTransient.x, peer.z - s.localTransient.z) < 1.15
          ) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) break;
        const offsetAngle = (attempt + 1) * 1.25;
        s.localTransient.x = -30.0 + Math.cos(offsetAngle) * (1.25 + attempt * 0.3);
        s.localTransient.z = 32.0 + Math.sin(offsetAngle) * (1.45 + attempt * 0.35);
        s.localTransient.y = sampleWalkableHeight(s.localTransient.x, s.localTransient.z);
      }

      s.localTransient.yaw = 1.48;
      s.localTransient.cameraYaw = -1.66;
      s.localTransient.cameraPitch = 0.11;
      s.localTransient.previewTargetYaw = 0;
      s.localTransient.previewCurrentYaw = 0;
      s.localTransient.previewYawVel = 0;
      s.localTransient.previewTargetPanY = 0;
      s.localTransient.previewCurrentPanY = 0;
      s.localTransient.previewTargetZoom = 1;
      s.localTransient.previewCurrentZoom = 1;

      const nowPerf = typeof performance !== 'undefined' ? Math.round(performance.now()) : 0;
      const nextMetrics: UXSessionMetrics = {
        ...s.uxMetrics,
        enteredWorldAtMs: s.uxMetrics.enteredWorldAtMs ?? nowPerf,
        timeToEnterMs:
          s.uxMetrics.timeToEnterMs ?? Math.max(0, nowPerf - s.uxMetrics.mountedAtMs),
      };

      return {
        hasEnteredWorld: true,
        activeModal: 'none',
        previewYawOffset: 0,
        isDraggingPreview: false,
        uxMetrics: nextMetrics,
      };
    }),

  setHeldItem: (heldItem) => {
    set({ heldItem });
    persistSnapshot(get());
  },
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

    const isNewWeather = !st.discoveredWeathers[nextAtmo.weather];
    const weatherSeen = isNewWeather
      ? { ...st.discoveredWeathers, [nextAtmo.weather]: true }
      : st.discoveredWeathers;

    set({
      atmosphere: nextAtmo,
      warmthRemainingSec: nextWarmth,
      chatBubbles: filteredBubbles,
      discoveredWeathers: weatherSeen,
    });

    if (isNewWeather) {
      persistSnapshot(get());
    }
  },

  teleportTo: (position, lookAt) => {
    const st = get();
    if (st.seatedBenchId) {
      getNetController().requestBenchSeat(null);
    }
    const floorY = sampleWalkableHeight(position[0], position[2]);
    const targetY = Number.isFinite(position[1]) ? position[1] : floorY;
    st.localTransient.x = position[0];
    st.localTransient.y = targetY;
    st.localTransient.z = position[2];
    st.localTransient.vx = 0;
    st.localTransient.vy = 0;
    st.localTransient.vz = 0;
    st.localTransient.grounded = Math.abs(targetY - floorY) <= 0.65;
    if (lookAt) {
      const dx = lookAt[0] - position[0];
      const dy = lookAt[1] - position[1];
      const dz = lookAt[2] - position[2];
      const horizDist = Math.max(10, Math.hypot(dx, dz));
      const yaw = Math.atan2(dx, dz);
      st.localTransient.yaw = yaw;
      st.localTransient.cameraYaw = Math.atan2(-dx, -dz);
      const pitchToTarget = -Math.atan2(dy, horizDist);
      st.localTransient.cameraPitch = Math.max(0.04, Math.min(0.28, pitchToTarget + 0.12));
    }
    set({
      seatedBenchId: null,
      teleportTarget: { position, lookAt, nonce: Date.now() + Math.random() },
    });
  },

  teleportToLandmark: (id) => {
    const lm = LANDMARKS[id];
    if (!lm) return;
    const net = getNetController();
    if (get().seatedBenchId) {
      net.requestBenchSeat(null);
    }
    get().teleportTo(lm.position, lm.lookAt);
    const lt = get().localTransient;
    net.sendTeleport?.(lt.x, lt.z, lt.yaw);
    get().markLandmarkDiscovered(id);
    set((s) => ({
      activeModal: 'none',
      uxMetrics: { ...s.uxMetrics, mapFastTravels: s.uxMetrics.mapFastTravels + 1 },
    }));
  },

  teleportToPeer: (sessionId) => {
    const st = get();
    const peer = st.peers[sessionId];
    if (!peer) return false;
    const net = getNetController();
    if (st.seatedBenchId) {
      net.requestBenchSeat(null);
    }
    const angle = (peer.yaw || 0) + Math.PI * 0.35;
    const arriveX = peer.x + Math.sin(angle) * 1.65;
    const arriveZ = peer.z + Math.cos(angle) * 1.65;
    const arriveY = sampleWalkableHeight(arriveX, arriveZ);
    st.teleportTo([arriveX, arriveY, arriveZ], [peer.x, peer.y + 1.25, peer.z]);
    const lt = get().localTransient;
    net.sendTeleport?.(lt.x, lt.z, lt.yaw);
    set((s) => ({
      activeModal: 'none',
      dismissedPeerId: null,
      uxMetrics: { ...s.uxMetrics, friendTeleports: s.uxMetrics.friendTeleports + 1 },
    }));
    st.showToast(`🛵 Đã ghé tới cạnh ${peer.displayName}!`);
    return true;
  },

  setOverrideAtmosphere: (overrideGameHour, overrideWeather) => {
    const syncedEpoch = Date.now() + get().serverTimeOffsetMs;
    set({
      overrideGameHour,
      overrideWeather,
      atmosphere: computeWorldAtmosphere(syncedEpoch, overrideGameHour, overrideWeather),
    });
  },

  setQualityTier: (qualityTier, auto = false) => {
    syncBodyDataAttributes(qualityTier, get().reducedMotion);
    set({ qualityTier, autoQuality: auto });
  },

  setAudioEnabled: (audioEnabled) => {
    set({ audioEnabled });
    persistSnapshot(get());
  },

  setMasterVolume: (masterVolume) => {
    set({ masterVolume });
    persistSnapshot(get());
  },

  setCameraSensitivity: (v) => {
    const cameraSensitivity = Math.max(0.4, Math.min(1.8, v));
    set({ cameraSensitivity });
    persistSnapshot(get());
  },

  setReducedMotion: (reducedMotion) => {
    syncBodyDataAttributes(get().qualityTier, reducedMotion);
    set({ reducedMotion });
    persistSnapshot(get());
  },

  setQuietMode: (quietMode) => {
    set({ quietMode });
    persistSnapshot(get());
  },

  setActiveModal: (activeModal) =>
    set((s) => {
      if (activeModal === 'wardrobe') {
        s.localTransient.previewTargetYaw = 0;
        s.localTransient.previewCurrentYaw = 0;
        s.localTransient.previewYawVel = 0;
        s.localTransient.previewTargetPanY = 0;
        s.localTransient.previewCurrentPanY = 0;
        s.localTransient.previewTargetZoom = 1;
        s.localTransient.previewCurrentZoom = 1;
      }
      return {
        activeModal,
        previewYawOffset: activeModal === 'wardrobe' ? 0 : s.previewYawOffset,
        isDraggingPreview: false,
      };
    }),

  setChatDrawerOpen: (chatDrawerOpen) =>
    set((s) => ({
      chatDrawerOpen,
      unreadChatCount: chatDrawerOpen ? 0 : s.unreadChatCount,
    })),

  clearUnreadChat: () => set({ unreadChatCount: 0 }),

  setPhotoMode: (photoModeActive) =>
    set({
      photoModeActive,
      activeModal: 'none',
      chatDrawerOpen: false,
      latestCapturedPolaroid: photoModeActive ? get().latestCapturedPolaroid : null,
    }),

  setPhotoOptions: (opts) => set(opts),

  requestPhotoShutter: () =>
    set((s) => ({
      photoShutterNonce: s.photoShutterNonce + 1,
      uxMetrics: { ...s.uxMetrics, photosCaptured: s.uxMetrics.photosCaptured + 1 },
    })),

  setLatestCapturedPolaroid: (latestCapturedPolaroid) => {
    if (!latestCapturedPolaroid) {
      set({ latestCapturedPolaroid: null });
      return;
    }
    set((s) => {
      const isLocal = latestCapturedPolaroid.id.startsWith('local-pol-');
      const nextPolaroids = s.polaroids.map((p) =>
        p.id === latestCapturedPolaroid.id ? latestCapturedPolaroid : p
      );
      const nextCaptured = isLocal
        ? s.capturedPolaroids.some((p) => p.id === latestCapturedPolaroid.id)
          ? s.capturedPolaroids.map((p) =>
              p.id === latestCapturedPolaroid.id ? latestCapturedPolaroid : p
            )
          : [latestCapturedPolaroid, ...s.capturedPolaroids].slice(0, 8)
        : s.capturedPolaroids;
      if (isLocal && nextCaptured !== s.capturedPolaroids) {
        persistPolaroidAlbum(nextCaptured);
      }
      return {
        latestCapturedPolaroid,
        polaroids: nextPolaroids,
        capturedPolaroids: nextCaptured,
      };
    });
  },

  setNearbyPrompt: (nearbyPrompt) => set({ nearbyPrompt }),

  setNearbyPeer: (nearbyPeer) =>
    set((s) => {
      let nextDismissed = s.dismissedPeerId;
      if (nextDismissed) {
        const dp = s.peers[nextDismissed];
        if (!dp) {
          nextDismissed = null;
        } else {
          const distToDismissed = Math.hypot(
            dp.x - s.localTransient.x,
            dp.z - s.localTransient.z
          );
          if (distToDismissed > 12.0) {
            nextDismissed = null;
          }
        }
      }
      return { nearbyPeer, dismissedPeerId: nextDismissed };
    }),

  setSelectedPeer: (selectedPeerSessionId) =>
    set((s) => ({
      selectedPeerSessionId,
      dismissedPeerId:
        selectedPeerSessionId && selectedPeerSessionId === s.dismissedPeerId
          ? null
          : s.dismissedPeerId,
    })),

  dismissPeerPrompt: (sessionId) =>
    set({
      dismissedPeerId: sessionId,
      selectedPeerSessionId: null,
      incomingSocialPrompt: null,
    }),

  setIncomingSocialPrompt: (incomingSocialPrompt) =>
    set((s) => ({
      incomingSocialPrompt,
      dismissedPeerId: incomingSocialPrompt ? null : s.dismissedPeerId,
    })),

  setPreviewYawOffset: (previewYawOffset) =>
    set((s) => {
      const cur = s.localTransient.previewCurrentYaw;
      const shortestDelta = Math.atan2(
        Math.sin(previewYawOffset - cur),
        Math.cos(previewYawOffset - cur)
      );
      const nextTarget = cur + shortestDelta;
      s.localTransient.previewTargetYaw = nextTarget;
      s.localTransient.previewYawVel = 0;
      return { previewYawOffset: nextTarget };
    }),

  addPreviewYawOffset: (deltaYaw) => {
    const lt = get().localTransient;
    lt.previewTargetYaw += deltaYaw;
    set({ previewYawOffset: lt.previewTargetYaw });
  },

  setIsDraggingPreview: (isDraggingPreview) => set({ isDraggingPreview }),

  resetPreviewStage: () =>
    set((s) => {
      const cur = s.localTransient.previewCurrentYaw;
      const shortestToFront = Math.atan2(Math.sin(0 - cur), Math.cos(0 - cur));
      const nextTarget = cur + shortestToFront;
      s.localTransient.previewTargetYaw = nextTarget;
      s.localTransient.previewYawVel = 0;
      s.localTransient.previewTargetPanY = 0;
      s.localTransient.previewTargetZoom = 1;
      return { previewYawOffset: nextTarget, isDraggingPreview: false };
    }),

  triggerSocialSparkle: (kind, x, y, z) =>
    set({
      socialSparkleBurst: {
        id: Date.now() + Math.random(),
        kind,
        x,
        y,
        z,
        timestamp: Date.now(),
      },
    }),

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
    persistSnapshot(get());
  },

  advanceOnboarding: (action) => {
    const st = get();
    const nowPerf = typeof performance !== 'undefined' ? Math.round(performance.now()) : 0;
    let metricsChanged = false;
    const nextMetrics = { ...st.uxMetrics };

    if (action === 'move' && nextMetrics.firstWalkAtMs === null) {
      nextMetrics.firstWalkAtMs = nowPerf;
      metricsChanged = true;
    }
    if (action === 'look' && nextMetrics.firstOrbitAtMs === null) {
      nextMetrics.firstOrbitAtMs = nowPerf;
      metricsChanged = true;
    }
    if (
      nextMetrics.timeToControlsSec === null &&
      nextMetrics.enteredWorldAtMs !== null &&
      nextMetrics.firstWalkAtMs !== null &&
      nextMetrics.firstOrbitAtMs !== null
    ) {
      nextMetrics.timeToControlsSec =
        Math.round(
          (Math.max(nextMetrics.firstWalkAtMs, nextMetrics.firstOrbitAtMs) -
            nextMetrics.enteredWorldAtMs) /
            100
        ) / 10;
      metricsChanged = true;
    }

    let nextStep = st.onboardingStep;
    if (action === 'skip') {
      nextStep = 'done';
    } else if (st.onboardingStep === 'move' && action === 'move') {
      nextStep = 'look';
    } else if (st.onboardingStep === 'look' && action === 'look') {
      nextStep = 'interact';
    } else if (st.onboardingStep === 'interact' && action === 'interact') {
      nextStep = 'done';
    }

    if (nextStep !== st.onboardingStep || metricsChanged) {
      set({ onboardingStep: nextStep, uxMetrics: nextMetrics });
      if (nextStep === 'done' && st.onboardingStep !== 'done') {
        persistSnapshot(get());
      }
    }
  },

  recordUXEvent: (kind) =>
    set((s) => {
      const m = { ...s.uxMetrics };
      if (kind === 'context_interact') m.contextInteractions += 1;
      if (kind === 'social_interact') m.socialInteractions += 1;
      if (kind === 'invite_copy') m.inviteCopies += 1;
      if (kind === 'photo_capture') m.photosCaptured += 1;
      return { uxMetrics: m };
    }),

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
    set((s) => {
      const isFromMe =
        msg.senderId === (s.localSessionId || 'local') || msg.senderId === 'local';
      const isBotSender = Boolean(s.peers[msg.senderId]?.isBot);
      const entry: ChatLogEntry = {
        ...msg,
        landmarkShort: resolveNearestShortLandmark(msg.x, msg.z),
      };
      const shouldIncrementUnread = !isFromMe && !isBotSender && !s.chatDrawerOpen;
      return {
        chatBubbles: [...s.chatBubbles.slice(-24), msg],
        chatHistory: [...s.chatHistory.slice(-29), entry],
        unreadChatCount: shouldIncrementUnread ? s.unreadChatCount + 1 : s.unreadChatCount,
      };
    }),
  setPolaroids: (polaroids) =>
    set(() => {
      const seenIds = new Set<string>();
      const seenImages = new Set<string>();
      const deduped: PolaroidEntry[] = [];
      for (const p of polaroids) {
        if (!p || !p.id) continue;
        const imgKey = p.imageDataUrl && p.imageDataUrl.length > 200 ? p.imageDataUrl : '';
        if (seenIds.has(p.id) || (imgKey && seenImages.has(imgKey))) continue;
        seenIds.add(p.id);
        if (imgKey) seenImages.add(imgKey);
        deduped.push(p);
        if (deduped.length >= 24) break;
      }
      return { polaroids: deduped };
    }),
  prependPolaroid: (item) => {
    let updatedCaptured: PolaroidEntry[] | null = null;
    set((s) => {
      const itemImgKey =
        item.imageDataUrl && item.imageDataUrl.length > 200 ? item.imageDataUrl : '';
      const nextPolaroids = [
        item,
        ...s.polaroids.filter(
          (p) => p.id !== item.id && (!itemImgKey || p.imageDataUrl !== itemImgKey)
        ),
      ].slice(0, 24);

      if (
        itemImgKey &&
        s.capturedPolaroids.some((p) => p.imageDataUrl === itemImgKey && p.id !== item.id)
      ) {
        updatedCaptured = s.capturedPolaroids.map((p) =>
          p.imageDataUrl === itemImgKey ? { ...p, id: item.id } : p
        );
        return {
          polaroids: nextPolaroids,
          capturedPolaroids: updatedCaptured,
        };
      }
      return { polaroids: nextPolaroids };
    });
    if (updatedCaptured) {
      persistPolaroidAlbum(updatedCaptured);
    }
  },
  saveCapturedPolaroid: (item) => {
    let updatedCaptured: PolaroidEntry[] | null = null;
    set((s) => {
      updatedCaptured = [item, ...s.capturedPolaroids.filter((p) => p.id !== item.id)].slice(0, 8);
      return { capturedPolaroids: updatedCaptured };
    });
    if (updatedCaptured) {
      persistPolaroidAlbum(updatedCaptured);
    }
  },
  setWindChimeNotes: (windChimeNotes) => set({ windChimeNotes }),
  prependWindChimeNote: (note) =>
    set((s) => ({
      windChimeNotes: [note, ...s.windChimeNotes.filter((n) => n.id !== note.id)].slice(0, 30),
    })),
  setLastJamNote: (lastJamNote) => set({ lastJamNote }),
}));
