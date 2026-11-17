import type {
  AcousticJamNote,
  ClientMoveInput,
  EmoteId,
  HeldItemId,
  PlayerOutfit,
  PolaroidEntry,
  PolaroidPinAck,
  ScooterPaintId,
  SocialInteractKind,
} from '@dalat/protocol';

export interface SwitchChannelResult {
  ok: boolean;
  roomCode?: string;
  channelName?: string;
  error?: string;
}

export type ScooterInteractAction =
  | 'mount_any'
  | 'mount_driver'
  | 'mount_passenger'
  | 'dismount'
  | 'toggle_light'
  | 'toggle_pose'
  | 'stow';

export interface IMultiplayerController {
  connect(preferredRoomCode?: string): Promise<void>;
  disconnect(): Promise<void>;
  switchChannel(roomCodeOrId: string): Promise<SwitchChannelResult>;
  refreshChannels(): Promise<void>;
  sendMove(input: ClientMoveInput): void;
  sendTeleport?(
    x: number,
    z: number,
    yaw?: number,
    opts?: { y?: number; qaOverride?: boolean }
  ): void;
  sendChat(text: string): void;
  sendProfile(displayName: string, outfit: PlayerOutfit): void;
  sendHeldItem(item: HeldItemId): void;
  sendEmote(emote: EmoteId): void;
  sendSocialInteract(targetSessionId: string, kind: SocialInteractKind): void;
  requestBenchSeat(benchId: string | null): void;
  summonScooter(paintId?: ScooterPaintId, autoMount?: boolean): void;
  interactScooter(scooterId: string, action: ScooterInteractAction): void;
  acceptScooterInvite(scooterId: string): void;
  sendScooterHorn(): void;
  sendJamNote(chordIndex: number, instrument: AcousticJamNote['instrument']): void;
  pinPolaroid(entry: Omit<PolaroidEntry, 'id' | 'likes' | 'createdAt'>): Promise<PolaroidPinAck>;
  likePolaroid(polaroidId: string): void;
  addWindChimeNote(message: string): void;
  /** Called inside useFrame(dt) to smoothly interpolate remote peer transforms at 60 FPS */
  interpolatePeers(nowMs: number): void;
}
