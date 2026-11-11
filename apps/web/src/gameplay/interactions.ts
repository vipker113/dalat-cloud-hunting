import { isWarmEdibleOrDrinkProp, SHARED_BENCHES, sampleWalkableHeight } from '@dalat/protocol';
import type { IMultiplayerController } from '../network/types';
import { InteractPrompt, NearbyPeerInfo, useGameStore } from '../store/gameStore';

export const INTERACTION_SPOTS = {
  CAFE_PHIN_COUNTER: [-41.0, 135.15, 31.0] as [number, number, number],
  CAFE_SOY_KETTLE: [-38.8, 135.15, 29.5] as [number, number, number],
  CAMPFIRE_STAGE: [-53.0, 135.15, 24.0] as [number, number, number],
  POLAROID_WALL: [-43.0, 135.15, 24.0] as [number, number, number],
  LONELY_PINE_WISH: [-95.0, 176.0, -155.0] as [number, number, number],
  CUB_OVERLOOK: [19.8, 112.0, 125.2] as [number, number, number],
} as const;

export const HIGHLAND_GUITAR_CHORDS = [
  { index: 0, key: '1', name: 'Cadd9', mood: 'Sương mai ngân nhẹ' },
  { index: 1, key: '2', name: 'G6', mood: 'Nắng ấm đồi chè' },
  { index: 2, key: '3', name: 'Em7', mood: 'Thông reo chiều muộn' },
  { index: 3, key: '4', name: 'Dsus4', mood: 'Mây trôi thung lũng' },
  { index: 4, key: '5', name: 'Am7', mood: 'Khói bếp Mơ Sương' },
  { index: 5, key: '6', name: 'Bm7', mood: 'Chờ ánh bình minh' },
] as const;

function dist2D(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

/**
 * Computes the highest-priority context-aware proximity prompt for the local player.
 */
export function evaluateNearbyPrompt(px: number, pz: number): InteractPrompt | null {
  const st = useGameStore.getState();

  // If currently seated on a bench, allow standing up cleanly with [E]
  if (st.seatedBenchId) {
    const bench = SHARED_BENCHES.find((b) => b.id === st.seatedBenchId);
    return {
      id: `stand-${st.seatedBenchId}`,
      label: 'Đứng dậy dạo bước săn mây',
      sublabel: bench ? bench.label : 'Rời ghế gỗ',
      actionType: 'sit_bench',
      benchId: undefined,
      position: bench ? bench.position : [px, sampleWalkableHeight(px, pz), pz],
    };
  }

  let bestPrompt: InteractPrompt | null = null;
  let bestScore = Infinity;

  // 1. Unoccupied Shared Benches (< 2.8m)
  for (let i = 0; i < SHARED_BENCHES.length; i++) {
    const bench = SHARED_BENCHES[i];
    const occupiedBy = st.occupiedBenches[bench.id];
    const isUnoccupied = !occupiedBy || occupiedBy === st.localSessionId;
    if (!isUnoccupied) continue;
    const d = dist2D(px, pz, bench.position[0], bench.position[2]);
    if (d < 2.8 && d < bestScore) {
      bestScore = d;
      bestPrompt = {
        id: `bench-${bench.id}`,
        label: 'Ngồi ngắm mây cùng nhau',
        sublabel: bench.label,
        actionType: 'sit_bench',
        benchId: bench.id,
        position: bench.position,
      };
    }
  }

  // 2. Polaroid Community Wall ([-43, 135, 24], < 3.3m)
  const dPolaroid = dist2D(px, pz, INTERACTION_SPOTS.POLAROID_WALL[0], INTERACTION_SPOTS.POLAROID_WALL[2]);
  if (dPolaroid < 3.3 && dPolaroid < bestScore) {
    bestScore = dPolaroid;
    bestPrompt = {
      id: 'polaroid-wall',
      label: 'Xem Bảng Ảnh Kỷ Niệm Săn Mây',
      sublabel: 'Góc lưu giữ khoảnh khắc Polaroid tại Mơ Sương',
      actionType: 'polaroid_board',
      position: INTERACTION_SPOTS.POLAROID_WALL,
    };
  }

  // 3. Cafe Counter Drinks ([-41, 135, 31] & Soy Milk Kettle, < 3.8m)
  const dPhin = dist2D(px, pz, INTERACTION_SPOTS.CAFE_PHIN_COUNTER[0], INTERACTION_SPOTS.CAFE_PHIN_COUNTER[2]);
  const dSoy = dist2D(px, pz, INTERACTION_SPOTS.CAFE_SOY_KETTLE[0], INTERACTION_SPOTS.CAFE_SOY_KETTLE[2]);
  const dCafe = Math.min(dPhin, dSoy);
  if (dCafe < 3.8 && dCafe < bestScore) {
    bestScore = dCafe;
    // Offer soy milk if closer to soy kettle OR already holding phin_coffee; otherwise offer phin_coffee!
    const preferSoy = dSoy + 0.35 < dPhin || st.heldItem === 'phin_coffee';
    if (preferSoy) {
      bestPrompt = {
        id: 'cafe-soy-milk',
        label: 'Rót ly sữa đậu nành lá dứa nóng',
        sublabel: 'Giữ ấm cơ thể +8 phút • Tăng 12% tốc độ bước chân',
        actionType: 'soy_milk',
        position: INTERACTION_SPOTS.CAFE_SOY_KETTLE,
      };
    } else {
      bestPrompt = {
        id: 'cafe-brew-phin',
        label: 'Pha phin cà phê nóng & Giữ ấm (+8 phút)',
        sublabel: 'Cà phê Cầu Đất rang mộc • Hơi ấm sương sớm',
        actionType: 'brew_phin',
        position: INTERACTION_SPOTS.CAFE_PHIN_COUNTER,
      };
    }
  }

  // 4. Campfire Acoustic Stage ([-53, 135, 24], < 5.5m)
  const dFire = dist2D(px, pz, INTERACTION_SPOTS.CAMPFIRE_STAGE[0], INTERACTION_SPOTS.CAMPFIRE_STAGE[2]);
  if (dFire < 5.5 && dFire < bestScore) {
    bestScore = dFire;
    bestPrompt = {
      id: 'campfire-acoustic',
      label: 'Gảy hợp âm Guitar bên lửa hồng (Phím 1–6)',
      sublabel: 'Đêm nhạc mộc Mơ Sương • Bấm 1–6 để hòa âm cùng bạn bè',
      actionType: 'acoustic_jam',
      position: INTERACTION_SPOTS.CAMPFIRE_STAGE,
    };
  }

  // 5. Cây Thông Cô Đơn Wind-Chime Wish Tree ([-95, 158, -155], < 5.4m)
  const dPine = dist2D(px, pz, INTERACTION_SPOTS.LONELY_PINE_WISH[0], INTERACTION_SPOTS.LONELY_PINE_WISH[2]);
  if (dPine < 5.4 && dPine < bestScore) {
    bestScore = dPine;
    bestPrompt = {
      id: 'lonely-pine-wish',
      label: 'Đọc & Treo Thẻ Gỗ Ước Nguyện (Mộc Diệp)',
      sublabel: 'Gửi đôi lời bình yên theo gió đồi Thiên Phúc Đức',
      actionType: 'wind_chime',
      position: INTERACTION_SPOTS.LONELY_PINE_WISH,
    };
  }

  // 6. Vintage Super Cub Overlook at Thung Lũng Đèn ([-112, 84, 142], < 3.6m)
  const dCub = dist2D(px, pz, INTERACTION_SPOTS.CUB_OVERLOOK[0], INTERACTION_SPOTS.CUB_OVERLOOK[2]);
  if (dCub < 3.6 && dCub < bestScore) {
    bestScore = dCub;
    bestPrompt = {
      id: 'cub-photo-spot',
      label: 'Ngắm Thung Lũng Đèn bên xe Super Cub 50',
      sublabel: 'Mở ống kính Film 35mm bắt trọn biển đèn vàng Thái Phiên',
      actionType: 'cub_photo',
      position: INTERACTION_SPOTS.CUB_OVERLOOK,
    };
  }

  return bestPrompt;
}

export function isNearCampfireStage(px: number, pz: number): boolean {
  return dist2D(px, pz, INTERACTION_SPOTS.CAMPFIRE_STAGE[0], INTERACTION_SPOTS.CAMPFIRE_STAGE[2]) <= 6.2;
}

/**
 * Finds the closest fellow cloud-hunter or ambient hiker within quick-greeting proximity (<= 5.6m).
 */
export function evaluateNearbyPeer(
  px: number,
  py: number,
  pz: number
): NearbyPeerInfo | null {
  const peers = useGameStore.getState().peers;
  let closest: NearbyPeerInfo | null = null;
  let bestDist = 5.6;

  for (const sessionId in peers) {
    const p = peers[sessionId];
    if (!p) continue;
    if (Math.abs(p.y - py) > 2.8) continue;
    const d = dist2D(px, pz, p.x, p.z);
    if (d <= bestDist) {
      bestDist = d;
      closest = {
        sessionId: p.sessionId,
        displayName: p.displayName,
        isBot: p.isBot,
        heldItem: p.heldItem,
        emote: p.emote,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        z: Math.round(p.z * 10) / 10,
        distance: Math.round(d * 10) / 10,
      };
    }
  }

  return closest;
}

export type PeerSocialActionKind = 'greet' | 'cheers' | 'cheer' | 'photo';

let lastSocialChatMs = 0;

/**
 * Executes a cozy quick-social interaction with a nearby cloud-hunter (human or ambient hiker).
 */
export function executePeerSocialAction(
  kind: PeerSocialActionKind,
  peerSnapshot: NearbyPeerInfo,
  net: IMultiplayerController
): void {
  const st = useGameStore.getState();
  const lt = st.localTransient;
  const livePeer = st.peers[peerSnapshot.sessionId] ?? peerSnapshot;

  const dx = livePeer.x - lt.x;
  const dz = livePeer.z - lt.z;
  if (!st.seatedBenchId && Math.hypot(dx, dz) > 0.05) {
    lt.yaw = Math.atan2(dx, dz);
  }

  const midX = (lt.x + livePeer.x) * 0.5;
  const midY = (lt.y + livePeer.y) * 0.5 + 1.48;
  const midZ = (lt.z + livePeer.z) * 0.5;
  const now = Date.now();

  if (kind === 'greet') {
    playTemporaryEmote('wave', net, 3600);
    st.triggerSocialSparkle('greet', midX, midY, midZ);
    net.sendSocialInteract(livePeer.sessionId, 'greet');
    if (now - lastSocialChatMs > 2600) {
      lastSocialChatMs = now;
      net.sendChat(`Chào ${livePeer.displayName} nhé! Sương sớm Cầu Đất đẹp quá ✨`);
    }
    st.showToast(`👋 Đã vẫy tay chào ${livePeer.displayName}!`);
    return;
  }

  if (kind === 'cheers') {
    if (!isWarmEdibleOrDrinkProp(st.heldItem) && st.heldItem !== 'sparkler') {
      st.setHeldItem('soy_milk');
      net.sendHeldItem('soy_milk');
    }
    st.grantWarmthBuff(480);
    playTemporaryEmote('cheers_cup', net, 3900);
    st.triggerSocialSparkle('cheers', midX, midY + 0.1, midZ);
    net.sendSocialInteract(livePeer.sessionId, 'cheers');
    if (now - lastSocialChatMs > 2600) {
      lastSocialChatMs = now;
      net.sendChat(`Cụng ly ấm nhé ${livePeer.displayName}! ☕✨`);
    }
    st.showToast(
      `☕ Cụng ly ấm cùng ${livePeer.displayName} — Giữ ấm +8 phút (+12% bước chân)!`
    );
    return;
  }

  if (kind === 'cheer') {
    playTemporaryEmote('cheer_sunrise', net, 4000);
    st.triggerSocialSparkle('cheer', midX, midY + 0.18, midZ);
    net.sendSocialInteract(livePeer.sessionId, 'cheer');
    if (now - lastSocialChatMs > 2600) {
      lastSocialChatMs = now;
      net.sendChat(`Tuyệt vời quá ${livePeer.displayName} ơi, biển mây hôm nay đỉnh thật! 🌅`);
    }
    st.showToast(`🙌 Cùng ${livePeer.displayName} reo đón biển mây Đà Lạt!`);
    return;
  }

  if (kind === 'photo') {
    // Invite the peer to wave toward us and frame a flattering 50mm portrait!
    net.sendSocialInteract(livePeer.sessionId, 'greet');
    st.triggerSocialSparkle('greet', midX, midY, midZ);
    if (st.heldItem !== 'film_camera') {
      st.setHeldItem('film_camera');
      net.sendHeldItem('film_camera');
    }
    st.setPhotoOptions({ photoFocalMm: 50, photoHideCrowd: false });
    if (Math.hypot(dx, dz) > 0.05) {
      // Third-person camera looks toward (-sin(cameraYaw), -cos(cameraYaw)), and Photo Mode adds +PI on entry
      // Wait: lookDir in Photo Mode is (+sin(yaw+PI), -cos(yaw+PI)) = (-sin(yaw), +cos(yaw))!
      // Let's set cameraYaw so after +PI flip: sin(yaw+PI) = dx/d and -cos(yaw+PI) = dz/d => yaw+PI = atan2(dx, -dz) => yaw = atan2(dx, -dz) - PI!
      lt.cameraYaw = Math.atan2(dx, -dz) - Math.PI;
      lt.cameraPitch = 0.04;
    }
    st.setPhotoMode(true);
    st.showToast(`📸 Đã hướng ống kính 50mm về phía ${livePeer.displayName} — Nhấn Space để chụp!`);
  }
}

export function triggerGuitarChord(chordIndex: number, net: IMultiplayerController): void {
  const clamped = Math.max(0, Math.min(5, chordIndex));
  const st = useGameStore.getState();
  if (st.heldItem !== 'guitar') {
    st.setHeldItem('guitar');
    net.sendHeldItem('guitar');
  }
  st.triggerEmote('play_guitar');
  net.sendEmote('play_guitar');
  net.sendJamNote(clamped, 'guitar');
  // Update local jam feedback immediately so UI/audio reacts with zero latency
  st.setLastJamNote({
    senderId: st.localSessionId || 'local',
    senderName: st.displayName,
    chordIndex: clamped,
    instrument: 'guitar',
    timestamp: Date.now(),
  });
}

let emoteResetTimer: ReturnType<typeof setTimeout> | null = null;

export function playTemporaryEmote(
  emote: Parameters<IMultiplayerController['sendEmote']>[0],
  net: IMultiplayerController,
  durationMs = 3400
): void {
  const st = useGameStore.getState();
  st.triggerEmote(emote);
  net.sendEmote(emote);
  if (emoteResetTimer) clearTimeout(emoteResetTimer);
  if (emote !== 'none' && emote !== 'sit_chill') {
    emoteResetTimer = setTimeout(() => {
      if (useGameStore.getState().activeEmote === emote) {
        useGameStore.getState().triggerEmote('none');
        net.sendEmote('none');
      }
    }, durationMs);
  }
}

export function executeInteractPrompt(prompt: InteractPrompt, net: IMultiplayerController): void {
  const st = useGameStore.getState();

  switch (prompt.actionType) {
    case 'brew_phin': {
      st.setHeldItem('phin_coffee');
      st.grantWarmthBuff(480);
      net.sendHeldItem('phin_coffee');
      playTemporaryEmote('sip_drink', net, 3200);
      st.showToast('☕ Phin cà phê Cầu Đất nóng hổi — Giữ ấm +8 phút (+12% bước chạy)');
      break;
    }
    case 'soy_milk': {
      st.setHeldItem('soy_milk');
      st.grantWarmthBuff(480);
      net.sendHeldItem('soy_milk');
      playTemporaryEmote('sip_drink', net, 3200);
      st.showToast('🥛 Ly sữa đậu nành lá dứa bốc khói thơm lừng — Giữ ấm +8 phút!');
      break;
    }
    case 'sit_bench': {
      if (st.seatedBenchId || !prompt.benchId) {
        // Stand up smoothly
        st.setSeatedBench(null);
        net.requestBenchSeat(null);
        st.triggerEmote('none');
        net.sendEmote('none');
        return;
      }
      const bench = SHARED_BENCHES.find((b) => b.id === prompt.benchId);
      if (bench) {
        // Snap local player gently onto the wooden bench facing the scenic horizon
        st.localTransient.x = bench.position[0];
        st.localTransient.y = bench.position[1];
        st.localTransient.z = bench.position[2];
        st.localTransient.vx = 0;
        st.localTransient.vy = 0;
        st.localTransient.vz = 0;
        st.localTransient.moving = false;
        st.localTransient.running = false;
        st.localTransient.yaw = bench.yaw;
        st.setSeatedBench(bench.id);
        net.requestBenchSeat(bench.id);
        st.showToast(`🪑 Đang ngồi tại ${bench.label} — Bấm WASD hoặc [E] để đứng dậy`);
      }
      break;
    }
    case 'acoustic_jam': {
      st.grantWarmthBuff(Math.max(st.warmthRemainingSec, 300));
      triggerGuitarChord(0, net);
      st.showToast('🎸 Bên bếp lửa hồng Mơ Sương — Nhấn phím 1–6 để gảy hợp âm Guitar!');
      break;
    }
    case 'polaroid_board': {
      st.setActiveModal('polaroids');
      break;
    }
    case 'wind_chime': {
      st.setActiveModal('windchimes');
      break;
    }
    case 'cub_photo': {
      st.setHeldItem('film_camera');
      net.sendHeldItem('film_camera');
      st.setPhotoMode(true);
      break;
    }
  }
}
