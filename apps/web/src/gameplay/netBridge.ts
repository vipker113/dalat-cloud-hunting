import { createContext, useContext } from 'react';
import type { IMultiplayerController } from '../network/types';
import { useGameStore } from '../store/gameStore';

let registeredController: IMultiplayerController | null = null;

/**
 * Safe local-only fallback used only if neither a prop `net` nor `setNetController(net)`
 * has been supplied yet. As soon as the real multiplayer controller is provided, all calls
 * route directly to it.
 */
const offlineFallbackController: IMultiplayerController = {
  async connect(preferredRoomCode?: string) {
    const st = useGameStore.getState();
    if (preferredRoomCode && preferredRoomCode.trim()) {
      st.setNetworkStatus({ roomCode: preferredRoomCode.trim().toUpperCase() });
    }
  },
  async disconnect() {
    useGameStore.getState().setNetworkStatus({ connected: false, connecting: false });
  },
  async switchChannel(roomCodeOrId: string) {
    const code = roomCodeOrId.trim().toUpperCase() || 'MAY-01';
    useGameStore.getState().setNetworkStatus({
      roomCode: code,
      channelName: `Sương Sớm Cầu Đất (${code})`,
    });
  },
  async refreshChannels() {
    // No-op when offline
  },
  sendMove() {
    // No-op when offline
  },
  sendChat(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const st = useGameStore.getState();
    st.pushChatBubble({
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderId: st.localSessionId || 'local',
      senderName: st.displayName,
      text: trimmed,
      x: st.localTransient.x,
      y: st.localTransient.y,
      z: st.localTransient.z,
      timestamp: Date.now(),
    });
  },
  sendProfile(displayName, outfit) {
    const st = useGameStore.getState();
    st.setDisplayName(displayName);
    st.updateOutfit(outfit);
  },
  sendHeldItem(item) {
    useGameStore.getState().setHeldItem(item);
  },
  sendEmote(emote) {
    useGameStore.getState().triggerEmote(emote);
  },
  sendSocialInteract(targetSessionId, kind) {
    const st = useGameStore.getState();
    const peer = st.peers[targetSessionId];
    if (!peer || !peer.isBot) return;
    // Offline fallback reciprocal reaction for local bots
    const replyEmote =
      kind === 'cheers' ? 'cheers_cup' : kind === 'cheer' ? 'cheer_sunrise' : 'wave';
    const faceYaw = Math.atan2(st.localTransient.x - peer.x, st.localTransient.z - peer.z);
    st.upsertPeer({ ...peer, yaw: faceYaw, moving: false, emote: replyEmote });
    const replyLine =
      kind === 'cheers'
        ? `Cụng ly ấm nhé ${st.displayName}! Chúc buổi sáng săn mây thật chill ☕✨`
        : kind === 'cheer'
          ? `Tuyệt quá ${st.displayName} ơi, biển mây Cầu Đất đỉnh thật sự! 🌅`
          : `Chào ${st.displayName} nha! Sáng nay trời se lạnh dễ chịu ghê 👋`;
    setTimeout(() => {
      useGameStore.getState().pushChatBubble({
        id: `bot-social-${Date.now()}`,
        senderId: peer.sessionId,
        senderName: peer.displayName,
        text: replyLine,
        x: peer.x,
        y: peer.y,
        z: peer.z,
        timestamp: Date.now(),
      });
    }, 420);
  },
  requestBenchSeat(benchId) {
    const st = useGameStore.getState();
    st.setSeatedBench(benchId);
    const nextOccupied = { ...st.occupiedBenches };
    const myId = st.localSessionId || 'local';
    for (const [k, v] of Object.entries(nextOccupied)) {
      if (v === myId) delete nextOccupied[k];
    }
    if (benchId) {
      nextOccupied[benchId] = myId;
    }
    st.setNetworkStatus({ occupiedBenches: nextOccupied });
  },
  sendJamNote(chordIndex, instrument) {
    const st = useGameStore.getState();
    st.setLastJamNote({
      senderId: st.localSessionId || 'local',
      senderName: st.displayName,
      chordIndex,
      instrument,
      timestamp: Date.now(),
    });
  },
  pinPolaroid(entry) {
    useGameStore.getState().prependPolaroid({
      ...entry,
      id: `pol-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      likes: 1,
      createdAt: Date.now(),
    });
  },
  likePolaroid(polaroidId) {
    const st = useGameStore.getState();
    st.setPolaroids(
      st.polaroids.map((p) => (p.id === polaroidId ? { ...p, likes: p.likes + 1 } : p))
    );
  },
  addWindChimeNote(message) {
    const trimmed = message.trim();
    if (!trimmed) return;
    const st = useGameStore.getState();
    st.prependWindChimeNote({
      id: `wish-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      authorName: st.displayName,
      message: trimmed,
      createdAt: Date.now(),
    });
  },
  interpolatePeers() {
    // No-op when offline
  },
};

export function setNetController(controller: IMultiplayerController | null): void {
  registeredController = controller;
}

export function getNetController(): IMultiplayerController {
  return registeredController ?? offlineFallbackController;
}

export const NetControllerContext = createContext<IMultiplayerController | null>(null);

export function useNetController(propNet?: IMultiplayerController): IMultiplayerController {
  const ctxNet = useContext(NetControllerContext);
  if (propNet && registeredController !== propNet) {
    registeredController = propNet;
  }
  return propNet ?? ctxNet ?? registeredController ?? offlineFallbackController;
}
