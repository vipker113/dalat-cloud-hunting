import type {
  AcousticJamNote,
  ClientMoveInput,
  EmoteId,
  HeldItemId,
  PlayerOutfit,
  PolaroidEntry,
} from '@dalat/protocol';

export interface IMultiplayerController {
  connect(preferredRoomCode?: string): Promise<void>;
  disconnect(): Promise<void>;
  switchChannel(roomCodeOrId: string): Promise<void>;
  refreshChannels(): Promise<void>;
  sendMove(input: ClientMoveInput): void;
  sendChat(text: string): void;
  sendProfile(displayName: string, outfit: PlayerOutfit): void;
  sendHeldItem(item: HeldItemId): void;
  sendEmote(emote: EmoteId): void;
  requestBenchSeat(benchId: string | null): void;
  sendJamNote(chordIndex: number, instrument: AcousticJamNote['instrument']): void;
  pinPolaroid(entry: Omit<PolaroidEntry, 'id' | 'likes' | 'createdAt'>): void;
  likePolaroid(polaroidId: string): void;
  addWindChimeNote(message: string): void;
  /** Called inside useFrame(dt) to smoothly interpolate remote peer transforms at 60 FPS */
  interpolatePeers(nowMs: number): void;
}
