import {
  isWarmEdibleOrDrinkProp,
  resolveBenchSeatTransform,
  sampleWalkableHeight,
  SHARED_BENCHES,
} from '@dalat/protocol';
import type { IMultiplayerController } from '../network/types';
import { InteractPrompt, NearbyPeerInfo, useGameStore } from '../store/gameStore';

export const INTERACTION_SPOTS = {
  CAFE_PHIN_COUNTER: [-39.1, sampleWalkableHeight(-39.1, 30.0), 30.0] as [number, number, number],
  CAFE_SOY_KETTLE: [-38.8, sampleWalkableHeight(-38.8, 28.6), 28.6] as [number, number, number],
  CAMPFIRE_STAGE: [-53.0, sampleWalkableHeight(-53.0, 24.0), 24.0] as [number, number, number],
  POLAROID_WALL: [-40.5, sampleWalkableHeight(-40.5, 26.2), 26.2] as [number, number, number],
  LONELY_PINE_WISH: [-95.0, sampleWalkableHeight(-95.0, -155.0), -155.0] as [
    number,
    number,
    number,
  ],
  CUB_OVERLOOK: [19.8, sampleWalkableHeight(19.8, 125.2), 125.2] as [number, number, number],
} as const;

export function computeBenchStandUpPosition(seatId: string): [number, number, number] | null {
  const seatTransform = resolveBenchSeatTransform(seatId);
  if (!seatTransform) return null;
  const benchId = seatTransform.bench.id;
  if (benchId === 'bench-cafe-1' || benchId === 'bench-cafe-2') {
    // Step inward onto clear Café Mơ Sương veranda planks (x - 0.72), never into the (-26.5, 24.5) lantern pole or east railing!
    const standX = seatTransform.position[0] - 0.72;
    const standZ = seatTransform.position[2];
    return [standX, sampleWalkableHeight(standX, standZ), standZ];
  }
  const standX = seatTransform.position[0] + Math.sin(seatTransform.yaw) * 0.78;
  const standZ = seatTransform.position[2] + Math.cos(seatTransform.yaw) * 0.78;
  return [standX, sampleWalkableHeight(standX, standZ), standZ];
}

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

const MAX_VERTICAL_INTERACT_DIST = 2.3;

/**
 * Computes the highest-priority context-aware proximity prompt for the local player.
 */
export function evaluateNearbyPrompt(px: number, pz: number, py?: number): InteractPrompt | null {
  const st = useGameStore.getState();
  const playerY = typeof py === 'number' && Number.isFinite(py) ? py : st.localTransient.y;

  // If currently seated on a bench, allow standing up cleanly with [E]
  if (st.seatedBenchId) {
    const seatTransform = resolveBenchSeatTransform(st.seatedBenchId);
    const bench = seatTransform?.bench;
    return {
      id: `stand-${st.seatedBenchId}`,
      label: 'Đứng dậy dạo bước săn mây',
      sublabel: bench ? bench.label : 'Rời ghế gỗ',
      actionType: 'sit_bench',
      benchId: undefined,
      position: seatTransform ? seatTransform.position : [px, sampleWalkableHeight(px, pz), pz],
    };
  }

  let bestPrompt: InteractPrompt | null = null;
  let bestScore = Infinity;

  // 1. Shared 2-Seater Benches (< 2.8m horizontal, <= 2.3m vertical)
  for (let i = 0; i < SHARED_BENCHES.length; i++) {
    const bench = SHARED_BENCHES[i];
    if (Math.abs(playerY - bench.position[1]) > MAX_VERTICAL_INTERACT_DIST) continue;
    const occ0 = st.occupiedBenches[`${bench.id}:0`] || st.occupiedBenches[bench.id];
    const occ1 = st.occupiedBenches[`${bench.id}:1`];
    const slot0Free = !occ0 || occ0 === st.localSessionId;
    const slot1Free = !occ1 || occ1 === st.localSessionId;
    if (!slot0Free && !slot1Free) continue;
    const d = dist2D(px, pz, bench.position[0], bench.position[2]);
    if (d < 2.8 && d < bestScore) {
      bestScore = d;
      bestPrompt = {
        id: `bench-${bench.id}`,
        label: 'Ngồi ngắm mây cùng nhau',
        sublabel: bench.label,
        actionType: 'sit_bench',
        benchId: slot0Free ? `${bench.id}:0` : `${bench.id}:1`,
        position: bench.position,
      };
    }
  }

  // 2. Polaroid Community Wall ([-40.5, 135.31, 26.2], < 3.3m horizontal, <= 2.3m vertical)
  const dPolaroid = dist2D(
    px,
    pz,
    INTERACTION_SPOTS.POLAROID_WALL[0],
    INTERACTION_SPOTS.POLAROID_WALL[2]
  );
  if (
    Math.abs(playerY - INTERACTION_SPOTS.POLAROID_WALL[1]) <= MAX_VERTICAL_INTERACT_DIST &&
    dPolaroid < 3.3 &&
    dPolaroid < bestScore
  ) {
    bestScore = dPolaroid;
    bestPrompt = {
      id: 'polaroid-wall',
      label: 'Xem Bảng Ảnh Kỷ Niệm Săn Mây',
      sublabel: 'Góc lưu giữ khoảnh khắc Polaroid tại Mơ Sương',
      actionType: 'polaroid_board',
      position: INTERACTION_SPOTS.POLAROID_WALL,
    };
  }

  // 3. Cafe Counter Drinks ([-39.1, 135.31, 30.0] & Soy Milk Kettle, < 3.8m horizontal, <= 2.3m vertical)
  const dPhin = dist2D(
    px,
    pz,
    INTERACTION_SPOTS.CAFE_PHIN_COUNTER[0],
    INTERACTION_SPOTS.CAFE_PHIN_COUNTER[2]
  );
  const dSoy = dist2D(
    px,
    pz,
    INTERACTION_SPOTS.CAFE_SOY_KETTLE[0],
    INTERACTION_SPOTS.CAFE_SOY_KETTLE[2]
  );
  const dCafe = Math.min(dPhin, dSoy);
  const cafeTargetY = INTERACTION_SPOTS.CAFE_PHIN_COUNTER[1];
  if (
    Math.abs(playerY - cafeTargetY) <= MAX_VERTICAL_INTERACT_DIST &&
    dCafe < 3.8 &&
    dCafe < bestScore
  ) {
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

  // 4. Campfire Acoustic Stage ([-53, y, 24], < 5.5m horizontal, <= 2.3m vertical)
  const dFire = dist2D(
    px,
    pz,
    INTERACTION_SPOTS.CAMPFIRE_STAGE[0],
    INTERACTION_SPOTS.CAMPFIRE_STAGE[2]
  );
  if (
    Math.abs(playerY - INTERACTION_SPOTS.CAMPFIRE_STAGE[1]) <= MAX_VERTICAL_INTERACT_DIST &&
    dFire < 5.5 &&
    dFire < bestScore
  ) {
    bestScore = dFire;
    bestPrompt = {
      id: 'campfire-acoustic',
      label: 'Gảy hợp âm Guitar bên lửa hồng (Phím 1–6)',
      sublabel: 'Đêm nhạc mộc Mơ Sương • Bấm 1–6 để hòa âm cùng bạn bè',
      actionType: 'acoustic_jam',
      position: INTERACTION_SPOTS.CAMPFIRE_STAGE,
    };
  }

  // 5. Cây Thông Cô Đơn Wind-Chime Wish Tree ([-95, y, -155], < 5.4m horizontal, <= 2.3m vertical)
  const dPine = dist2D(
    px,
    pz,
    INTERACTION_SPOTS.LONELY_PINE_WISH[0],
    INTERACTION_SPOTS.LONELY_PINE_WISH[2]
  );
  if (
    Math.abs(playerY - INTERACTION_SPOTS.LONELY_PINE_WISH[1]) <= MAX_VERTICAL_INTERACT_DIST &&
    dPine < 5.4 &&
    dPine < bestScore
  ) {
    bestScore = dPine;
    bestPrompt = {
      id: 'lonely-pine-wish',
      label: 'Đọc & Treo Thẻ Gỗ Ước Nguyện (Mộc Diệp)',
      sublabel: 'Gửi đôi lời bình yên theo gió đồi Thiên Phúc Đức',
      actionType: 'wind_chime',
      position: INTERACTION_SPOTS.LONELY_PINE_WISH,
    };
  }

  // 6. Vintage Super Cub Overlook at Thung Lũng Đèn (< 3.6m horizontal, <= 2.3m vertical)
  const dCub = dist2D(px, pz, INTERACTION_SPOTS.CUB_OVERLOOK[0], INTERACTION_SPOTS.CUB_OVERLOOK[2]);
  if (
    Math.abs(playerY - INTERACTION_SPOTS.CUB_OVERLOOK[1]) <= MAX_VERTICAL_INTERACT_DIST &&
    dCub < 3.6 &&
    dCub < bestScore
  ) {
    bestScore = dCub;
    bestPrompt = {
      id: 'cub-photo-spot',
      label: 'Ngắm Thung Lũng Đèn bên xe Super Cub 50',
      sublabel: 'Mở ống kính Film 35mm bắt trọn biển đèn vàng Thái Phiên',
      actionType: 'cub_photo',
      position: INTERACTION_SPOTS.CUB_OVERLOOK,
    };
  }

  // 7. Deep Valley Safety Return Prompt when hiked down below y < 88m
  if (!bestPrompt && playerY < 88) {
    bestPrompt = {
      id: 'valley-cub-return',
      label: '🛵 Nhờ xe Cub chở lại Đài Ngắm Đèn [E]',
      sublabel: 'Quay lại đỉnh đồi săn mây nhanh chóng & an toàn',
      actionType: 'valley_return',
      position: [px, playerY + 0.35, pz],
    };
  }

  return bestPrompt;
}

export function isNearCampfireStage(px: number, pz: number): boolean {
  return dist2D(px, pz, INTERACTION_SPOTS.CAMPFIRE_STAGE[0], INTERACTION_SPOTS.CAMPFIRE_STAGE[2]) <= 6.2;
}

/**
 * Finds the selected or closest fellow cloud-hunter within greeting proximity (<= 9.5m auto, <= 18m when clicked).
 */
export function evaluateNearbyPeer(
  px: number,
  py: number,
  pz: number
): NearbyPeerInfo | null {
  const st = useGameStore.getState();
  const peers = st.peers;

  // 1. Prioritize explicitly clicked/focused peer if still within 18m
  if (st.selectedPeerSessionId) {
    const sel = peers[st.selectedPeerSessionId];
    if (sel && Math.abs(sel.y - py) <= 4.5) {
      const selDist = dist2D(px, pz, sel.x, sel.z);
      if (selDist <= 18.0) {
        return {
          sessionId: sel.sessionId,
          displayName: sel.displayName,
          isBot: sel.isBot,
          heldItem: sel.heldItem,
          emote: sel.emote,
          seatId: sel.seatId,
          x: Math.round(sel.x * 10) / 10,
          y: Math.round(sel.y * 10) / 10,
          z: Math.round(sel.z * 10) / 10,
          distance: Math.round(selDist * 10) / 10,
        };
      }
    }
    st.setSelectedPeer(null);
  }

  // 2. Otherwise auto-detect the closest nearby player within 9.5m
  let closest: NearbyPeerInfo | null = null;
  let bestDist = 9.5;

  for (const sessionId in peers) {
    const p = peers[sessionId];
    if (!p) continue;
    if (Math.abs(p.y - py) > 3.4) continue;
    const d = dist2D(px, pz, p.x, p.z);
    if (d <= bestDist) {
      bestDist = d;
      closest = {
        sessionId: p.sessionId,
        displayName: p.displayName,
        isBot: p.isBot,
        heldItem: p.heldItem,
        emote: p.emote,
        seatId: p.seatId,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        z: Math.round(p.z * 10) / 10,
        distance: Math.round(d * 10) / 10,
      };
    }
  }

  return closest;
}

export type PeerSocialActionKind =
  | 'greet'
  | 'cheers'
  | 'cheer'
  | 'gift_flower'
  | 'sparkler'
  | 'photo'
  | 'sit_together';

let lastSocialChatMs = 0;

/**
 * Executes a cozy quick-social interaction with a nearby cloud-hunter.
 */
export function executePeerSocialAction(
  kind: PeerSocialActionKind,
  peerSnapshot: NearbyPeerInfo,
  net: IMultiplayerController
): void {
  const st = useGameStore.getState();
  const lt = st.localTransient;
  const livePeer = st.peers[peerSnapshot.sessionId] ?? peerSnapshot;

  // Clear incoming prompt once we interact back
  if (st.incomingSocialPrompt?.fromId === livePeer.sessionId) {
    st.setIncomingSocialPrompt(null);
  }

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
    if (now - lastSocialChatMs > 2200) {
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
    if (now - lastSocialChatMs > 2200) {
      lastSocialChatMs = now;
      net.sendChat(`Cụng ly ấm nhé ${livePeer.displayName}! ☕✨`);
    }
    st.showToast(
      `☕ Cụng ly ấm cùng ${livePeer.displayName} — Cả hai giữ ấm +8 phút (+12% bước chân)!`
    );
    return;
  }

  if (kind === 'cheer') {
    playTemporaryEmote('cheer_sunrise', net, 4000);
    st.triggerSocialSparkle('cheer', midX, midY + 0.18, midZ);
    net.sendSocialInteract(livePeer.sessionId, 'cheer');
    if (now - lastSocialChatMs > 2200) {
      lastSocialChatMs = now;
      net.sendChat(`Tuyệt vời quá ${livePeer.displayName} ơi, biển mây hôm nay đỉnh thật! 🌅`);
    }
    st.showToast(`🙌 Cùng ${livePeer.displayName} reo đón biển mây Đà Lạt!`);
    return;
  }

  if (kind === 'gift_flower') {
    st.setHeldItem('hydrangea_bouquet');
    net.sendHeldItem('hydrangea_bouquet');
    st.grantWarmthBuff(480);
    playTemporaryEmote('wave', net, 3600);
    st.triggerSocialSparkle('gift_flower', midX, midY + 0.12, midZ);
    net.sendSocialInteract(livePeer.sessionId, 'gift_flower');
    if (now - lastSocialChatMs > 2200) {
      lastSocialChatMs = now;
      net.sendChat(`Tặng ${livePeer.displayName} bó hoa Cẩm Tú Cầu Đà Lạt sương sớm nè! 💐✨`);
    }
    st.showToast(`💐 Đã trao tặng hoa Cẩm Tú Cầu cho ${livePeer.displayName}!`);
    return;
  }

  if (kind === 'sparkler') {
    st.setHeldItem('sparkler');
    net.sendHeldItem('sparkler');
    playTemporaryEmote('cheer_sunrise', net, 3800);
    st.triggerSocialSparkle('sparkler', midX, midY + 0.16, midZ);
    net.sendSocialInteract(livePeer.sessionId, 'sparkler');
    if (now - lastSocialChatMs > 2200) {
      lastSocialChatMs = now;
      net.sendChat(`Cùng thắp pháo bông giữa sương mờ nhé ${livePeer.displayName}! ✨🎇`);
    }
    st.showToast(`✨ Cùng ${livePeer.displayName} thắp sáng pháo bông Đà Lạt!`);
    return;
  }

  if (kind === 'sit_together') {
    const peerSeatId = livePeer.seatId || '';
    const baseBenchId = peerSeatId.split(':')[0];
    if (baseBenchId) {
      const targetSlotId = peerSeatId.endsWith(':0') ? `${baseBenchId}:1` : `${baseBenchId}:0`;
      const seatTransform = resolveBenchSeatTransform(targetSlotId);
      if (seatTransform) {
        lt.x = seatTransform.position[0];
        lt.y = seatTransform.position[1];
        lt.z = seatTransform.position[2];
        lt.vx = 0;
        lt.vy = 0;
        lt.vz = 0;
        lt.moving = false;
        lt.running = false;
        lt.yaw = seatTransform.yaw;
        st.setSeatedBench(seatTransform.seatId);
        net.requestBenchSeat(seatTransform.seatId);
        st.showToast(`🪑 Đã ngồi cạnh ${livePeer.displayName} trên ${seatTransform.bench.label}!`);
        return;
      }
    }
    // Or find the nearest bench with a free slot within 8m
    for (const bench of SHARED_BENCHES) {
      if (dist2D(lt.x, lt.z, bench.position[0], bench.position[2]) <= 8.5) {
        const occ0 = st.occupiedBenches[`${bench.id}:0`];
        const occ1 = st.occupiedBenches[`${bench.id}:1`];
        const freeSlot = !occ0 ? `${bench.id}:0` : !occ1 ? `${bench.id}:1` : null;
        if (freeSlot) {
          const seatTransform = resolveBenchSeatTransform(freeSlot);
          if (seatTransform) {
            lt.x = seatTransform.position[0];
            lt.y = seatTransform.position[1];
            lt.z = seatTransform.position[2];
            lt.vx = 0;
            lt.vy = 0;
            lt.vz = 0;
            lt.moving = false;
            lt.running = false;
            lt.yaw = seatTransform.yaw;
            st.setSeatedBench(seatTransform.seatId);
            net.requestBenchSeat(seatTransform.seatId);
            net.sendChat(`Qua ngồi ghế gỗ ngắm mây cùng mình nè ${livePeer.displayName} ơi! 🪑✨`);
            st.showToast(`🪑 Đã ngồi tại ${seatTransform.bench.label} và mời ${livePeer.displayName} ngồi cùng!`);
            return;
          }
        }
      }
    }
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
  st.recordUXEvent('context_interact');
  st.advanceOnboarding('interact');

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
        // Stand up smoothly and step onto clear walkable ground away from poles/railings
        const standPos = st.seatedBenchId ? computeBenchStandUpPosition(st.seatedBenchId) : null;
        if (standPos) {
          st.localTransient.x = standPos[0];
          st.localTransient.y = standPos[1];
          st.localTransient.z = standPos[2];
        }
        st.setSeatedBench(null);
        net.requestBenchSeat(null);
        st.triggerEmote('none');
        net.sendEmote('none');
        return;
      }
      const seatTransform = resolveBenchSeatTransform(prompt.benchId);
      if (seatTransform) {
        // Snap local player gently onto the assigned side-by-side seat slot facing the scenic horizon
        st.localTransient.x = seatTransform.position[0];
        st.localTransient.y = seatTransform.position[1];
        st.localTransient.z = seatTransform.position[2];
        st.localTransient.vx = 0;
        st.localTransient.vy = 0;
        st.localTransient.vz = 0;
        st.localTransient.moving = false;
        st.localTransient.running = false;
        st.localTransient.yaw = seatTransform.yaw;
        st.setSeatedBench(seatTransform.seatId);
        net.requestBenchSeat(seatTransform.seatId);
        st.showToast(`🪑 Đang ngồi tại ${seatTransform.bench.label} — Bấm WASD hoặc [E] để đứng dậy`);
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
    case 'valley_return': {
      st.teleportToLandmark('dai-ngam-den');
      st.showToast('🛵 Đã chở bạn quay lại Đài Ngắm Thung Lũng Đèn!');
      break;
    }
  }
}
