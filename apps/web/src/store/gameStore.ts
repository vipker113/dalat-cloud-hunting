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
  // High-frequency 360° Live Dressing Stage Turntable, Pan & Zoom (0 React re-renders during drag!)
  previewTargetYaw: number;
  previewCurrentYaw: number;
  previewYawVel: number;
  previewTargetPanY: number;
  previewCurrentPanY: number;
  previewTargetZoom: number;
  previewCurrentZoom: number;
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
  nearbyPeer: NearbyPeerInfo | null;
  selectedPeerSessionId: string | null;
  incomingSocialPrompt: IncomingSocialPrompt | null;
  previewYawOffset: number;
  isDraggingPreview: boolean;
  socialSparkleBurst: SocialSparkleBurst | null;
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
  setNearbyPeer: (peer: NearbyPeerInfo | null) => void;
  setSelectedPeer: (sessionId: string | null) => void;
  setIncomingSocialPrompt: (prompt: IncomingSocialPrompt | null) => void;
  setPreviewYawOffset: (yaw: number) => void;
  addPreviewYawOffset: (deltaYaw: number) => void;
  setIsDraggingPreview: (dragging: boolean) => void;
  resetPreviewStage: () => void;
  triggerSocialSparkle: (kind: SocialSparkleBurst['kind'], x: number, y: number, z: number) => void;
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
      const rawOutfit: PlayerOutfit = { ...DEFAULT_OUTFIT, ...(parsed.outfit || {}) };
      const effGender = resolveEffectiveGender(rawOutfit);
      rawOutfit.gender = effGender;
      rawOutfit.coatStyle = ensureCoatMatchesGender(rawOutfit.coatStyle, effGender);
      return {
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : 'Người Săn Mây',
        outfit: rawOutfit,
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
    x: -29.2,
    y: sampleWalkableHeight(-29.2, 33.2),
    z: 33.2,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 1.48,
    cameraYaw: -1.62,
    cameraPitch: 0.12,
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
  nearbyPeer: null,
  selectedPeerSessionId: null,
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

  setDisplayName: (displayName) => {
    set({ displayName });
    try {
      localStorage.setItem('dalat_profile_v1', JSON.stringify({ name: displayName, outfit: get().outfit }));
    } catch {}
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
      next.bagStyle = partial.backpack ? cur.bagStyle && cur.bagStyle !== 'none' ? cur.bagStyle : 'trek_pack' : 'none';
    }
    set({ outfit: next });
    try {
      localStorage.setItem('dalat_profile_v1', JSON.stringify({ name: get().displayName, outfit: next }));
    } catch {}
  },

  enterWorld: () =>
    set((s) => {
      // Prevent spawning directly on top of another player on the veranda deck
      for (let attempt = 0; attempt < 8; attempt++) {
        let tooClose = false;
        for (const peerId in s.peers) {
          const peer = s.peers[peerId];
          if (peer && Math.hypot(peer.x - s.localTransient.x, peer.z - s.localTransient.z) < 1.15) {
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

      // Face East toward the Volumetric Cloud Sea & Sunrise upon stepping into the world!
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
      return { hasEnteredWorld: true, activeModal: 'none', previewYawOffset: 0, isDraggingPreview: false };
    }),
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
  setPhotoMode: (photoModeActive) =>
    set({ photoModeActive, activeModal: 'none', latestCapturedPolaroid: photoModeActive ? get().latestCapturedPolaroid : null }),
  setPhotoOptions: (opts) => set(opts),
  requestPhotoShutter: () => set((s) => ({ photoShutterNonce: s.photoShutterNonce + 1 })),
  setLatestCapturedPolaroid: (latestCapturedPolaroid) => set({ latestCapturedPolaroid }),
  setNearbyPrompt: (nearbyPrompt) => set({ nearbyPrompt }),
  setNearbyPeer: (nearbyPeer) => set({ nearbyPeer }),
  setSelectedPeer: (selectedPeerSessionId) => set({ selectedPeerSessionId }),
  setIncomingSocialPrompt: (incomingSocialPrompt) => set({ incomingSocialPrompt }),
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

