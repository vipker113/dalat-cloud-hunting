import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { PlayerOutfit, SHARED_BENCHES, WORLD_CONSTANTS } from '@dalat/protocol';
import { RemotePeerState, useGameStore } from '../store/gameStore';
import { AvatarMotionSample, HighlandAvatar } from './HighlandAvatar';

interface PeerAppearanceSlot {
  sessionId: string;
  numericId: number;
  displayName: string;
  outfit: PlayerOutfit;
  heldItem: RemotePeerState['heldItem'];
  isBot: boolean;
}

const _projVec = new THREE.Vector3();

function outfitSignature(p: PeerAppearanceSlot): string {
  const o = p.outfit;
  return `${p.sessionId}|${p.displayName}|${p.heldItem}|${o.coatStyle}|${o.coatColor}|${o.scarfColor}|${o.headwear}|${o.hairColor}|${o.backpack ? 1 : 0}`;
}

function shortestAngleDelta(from: number, to: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function getWorldLabelsContainer(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('dalat-world-labels');
}

function PeerAvatarSlot({ slot }: { slot: PeerAppearanceSlot }) {
  const groupRef = useRef<THREE.Group>(null);
  const labelElRef = useRef<HTMLDivElement | null>(null);
  const bubbleElRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const { camera, size } = useThree();

  const latestBubble = useGameStore((s) => {
    for (let i = s.chatBubbles.length - 1; i >= 0; i--) {
      const b = s.chatBubbles[i];
      if (b.senderId === slot.sessionId || b.senderName === slot.displayName) {
        return b;
      }
    }
    return null;
  });

  // Create lightweight native DOM pill inside #dalat-world-labels (zero React roots, zero unmount warnings!)
  useEffect(() => {
    const host = getWorldLabelsContainer();
    if (!host) return;

    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:absolute;top:0;left:0;display:none;flex-direction:column;align-items:center;gap:5px;pointer-events:none;user-select:none;will-change:transform,opacity;font-family:"Be Vietnam Pro",-apple-system,sans-serif;';

    const bubble = document.createElement('div');
    bubble.style.cssText =
      'display:none;max-width:230px;padding:6px 12px;border-radius:14px;background:rgba(252,247,238,0.94);color:#1D2432;font-size:12.5px;font-weight:500;line-height:1.38;box-shadow:0 6px 20px rgba(8,12,22,0.35);border:1px solid rgba(255,222,178,0.65);text-align:center;word-break:break-word;';

    const pill = document.createElement('div');
    pill.style.cssText =
      'display:inline-flex;align-items:center;gap:5px;padding:2.5px 9px;border-radius:999px;background:rgba(16,23,36,0.66);border:1px solid rgba(255,232,204,0.18);color:#F6EFE4;font-size:11px;font-weight:500;letter-spacing:0.01em;white-space:nowrap;';

    const dot = document.createElement('span');
    dot.style.cssText = `width:5px;height:5px;border-radius:50%;background:${slot.isBot ? '#A8C5DA' : '#F3C382'};`;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = slot.displayName;

    pill.appendChild(dot);
    pill.appendChild(nameSpan);
    wrap.appendChild(bubble);
    wrap.appendChild(pill);
    host.appendChild(wrap);

    labelElRef.current = wrap;
    bubbleElRef.current = bubble;

    return () => {
      wrap.remove();
      labelElRef.current = null;
      bubbleElRef.current = null;
    };
  }, [slot.displayName, slot.isBot]);

  useEffect(() => {
    const bEl = bubbleElRef.current;
    if (!bEl) return;
    if (latestBubble) {
      bEl.textContent = latestBubble.text;
      bEl.style.display = 'block';
    } else {
      bEl.textContent = '';
      bEl.style.display = 'none';
    }
  }, [latestBubble]);

  const motionRef = useRef<AvatarMotionSample>({
    moving: false,
    running: false,
    grounded: true,
    speed: 0,
    seated: false,
    emote: 'none',
    warmBuff: false,
    temperatureC: 11,
    windStrength: 0.5,
    jamPulse: 0,
  });

  const seed = useMemo(() => ((slot.numericId * 0.61803398875) % 1) || 0.42, [slot.numericId]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.06);
    const st = useGameStore.getState();
    const peer = st.peers[slot.sessionId];
    const grp = groupRef.current;
    const el = labelElRef.current;

    if (!grp || !peer) {
      if (grp) grp.visible = false;
      if (el) el.style.display = 'none';
      return;
    }

    const hideForPhoto = st.photoModeActive && st.photoHideCrowd;
    grp.visible = !hideForPhoto;
    if (hideForPhoto) {
      if (el) el.style.display = 'none';
      return;
    }

    let targetX = peer.x;
    let targetY = peer.y;
    let targetZ = peer.z;
    let targetYaw = peer.yaw;

    if (peer.seatId) {
      const bench = SHARED_BENCHES.find((b) => b.id === peer.seatId);
      if (bench) {
        targetX = bench.position[0];
        targetY = bench.position[1];
        targetZ = bench.position[2];
        targetYaw = bench.yaw;
      }
    }

    if (!initializedRef.current) {
      grp.position.set(targetX, targetY, targetZ);
      grp.rotation.y = targetYaw;
      initializedRef.current = true;
    } else {
      const blend = 1 - Math.exp(-16 * dt);
      grp.position.x += (targetX - grp.position.x) * blend;
      grp.position.y += (targetY - grp.position.y) * blend;
      grp.position.z += (targetZ - grp.position.z) * blend;
      grp.rotation.y += shortestAngleDelta(grp.rotation.y, targetYaw) * blend;
    }

    const jamAge = st.lastJamNote ? (Date.now() - st.lastJamNote.timestamp) / 1000 : 99;
    const isPeerJam =
      st.lastJamNote &&
      (st.lastJamNote.senderId === slot.sessionId || st.lastJamNote.senderName === slot.displayName);

    const m = motionRef.current;
    m.moving = peer.moving;
    m.running = peer.running;
    m.grounded = peer.grounded;
    m.speed = Math.hypot(peer.vx, peer.vz) || (peer.moving ? (peer.running ? 4.8 : 2.5) : 0);
    m.seated = Boolean(peer.seatId);
    m.emote = peer.emote;
    m.warmBuff = peer.warmBuff;
    m.temperatureC = st.atmosphere.temperatureC;
    m.windStrength = st.atmosphere.windStrength;
    m.jamPulse = isPeerJam && jamAge < 1.4 ? 1 - jamAge / 1.4 : 0;

    if (el) {
      if (st.photoModeActive || !st.hasEnteredWorld) {
        el.style.display = 'none';
      } else {
        const lt = st.localTransient;
        const dist = Math.hypot(grp.position.x - lt.x, grp.position.y - lt.y, grp.position.z - lt.z);
        const maxR = WORLD_CONSTANTS.PROXIMITY_CHAT_RADIUS;
        if (dist > maxR) {
          el.style.display = 'none';
        } else {
          _projVec.set(grp.position.x, grp.position.y + 1.96, grp.position.z).project(camera);
          if (_projVec.z > 1 || _projVec.z < -1) {
            el.style.display = 'none';
          } else {
            const sx = (_projVec.x * 0.5 + 0.5) * size.width;
            const sy = (-_projVec.y * 0.5 + 0.5) * size.height;
            const fade = dist <= 20 ? 1 : Math.max(0, 1 - (dist - 20) / (maxR - 20));
            el.style.display = 'flex';
            el.style.opacity = fade.toFixed(2);
            el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
          }
        }
      }
    }
  });

  return (
    <group ref={groupRef}>
      <HighlandAvatar
        outfit={slot.outfit}
        heldItem={slot.heldItem}
        isLocal={false}
        seed={seed}
        getMotion={() => motionRef.current}
      />
    </group>
  );
}

/**
 * Floating speech bubble above the Local Player when they send proximity chat.
 */
function LocalPlayerChatBubble() {
  const elRef = useRef<HTMLDivElement | null>(null);
  const { camera, size } = useThree();
  const photoModeActive = useGameStore((s) => s.photoModeActive);
  const myBubble = useGameStore((s) => {
    const myId = s.localSessionId || 'local';
    for (let i = s.chatBubbles.length - 1; i >= 0; i--) {
      const b = s.chatBubbles[i];
      if (b.senderId === myId || b.senderId === 'local') {
        return b;
      }
    }
    return null;
  });

  useEffect(() => {
    const host = getWorldLabelsContainer();
    if (!host) return;
    const div = document.createElement('div');
    div.style.cssText =
      'position:absolute;top:0;left:0;display:none;max-width:240px;padding:6px 13px;border-radius:14px;background:rgba(255,248,236,0.95);color:#1C2330;font-family:"Be Vietnam Pro",-apple-system,sans-serif;font-size:12.5px;font-weight:500;line-height:1.38;box-shadow:0 8px 22px rgba(8,12,22,0.36);border:1px solid rgba(243,195,130,0.65);text-align:center;word-break:break-word;pointer-events:none;';
    host.appendChild(div);
    elRef.current = div;
    return () => {
      div.remove();
      elRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (myBubble && !photoModeActive) {
      el.textContent = myBubble.text;
    } else {
      el.style.display = 'none';
    }
  }, [myBubble, photoModeActive]);

  useFrame(() => {
    const el = elRef.current;
    if (!el) return;
    if (!myBubble || photoModeActive) {
      el.style.display = 'none';
      return;
    }
    const lt = useGameStore.getState().localTransient;
    _projVec.set(lt.x, lt.y + 2.02, lt.z).project(camera);
    if (_projVec.z > 1 || _projVec.z < -1) {
      el.style.display = 'none';
    } else {
      const sx = (_projVec.x * 0.5 + 0.5) * size.width;
      const sy = (-_projVec.y * 0.5 + 0.5) * size.height;
      el.style.display = 'block';
      el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  });

  return null;
}

const MAX_FAR_LANTERNS = 128;

/**
 * Instanced distant Lantern Silhouettes for `farBeacons` + any peers beyond the 16/32 near avatar budget.
 */
function FarLanternSilhouettes({ nearSessionIds }: { nearSessionIds: Set<string> }) {
  const capeMeshRef = useRef<THREE.InstancedMesh>(null);
  const orbMeshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const { capeGeo, capeMat, orbGeo, orbMat } = useMemo(() => {
    return {
      capeGeo: new THREE.CapsuleGeometry(0.24, 1.05, 4, 8),
      capeMat: new THREE.MeshStandardMaterial({
        color: '#232F46',
        roughness: 0.92,
        transparent: true,
        opacity: 0.84,
      }),
      orbGeo: new THREE.SphereGeometry(0.16, 8, 6),
      orbMat: new THREE.MeshBasicMaterial({
        color: '#FFC46B',
        transparent: true,
        opacity: 0.92,
      }),
    };
  }, []);

  useFrame(({ clock }) => {
    const capeMesh = capeMeshRef.current;
    const orbMesh = orbMeshRef.current;
    if (!capeMesh || !orbMesh) return;

    const st = useGameStore.getState();
    if (st.photoModeActive && st.photoHideCrowd) {
      capeMesh.count = 0;
      orbMesh.count = 0;
      return;
    }

    const t = clock.getElapsedTime();
    let idx = 0;

    for (let i = 0; i < st.farBeacons.length && idx < MAX_FAR_LANTERNS; i++) {
      const b = st.farBeacons[i];
      const bob = Math.sin(t * 2.2 + b.numericId * 0.7) * 0.06;

      dummy.position.set(b.x, b.y + 0.82, b.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      capeMesh.setMatrixAt(idx, dummy.matrix);

      dummy.position.set(b.x + 0.22, b.y + 1.05 + bob, b.z + 0.12);
      const pulse = 0.88 + Math.sin(t * 3.4 + b.numericId) * 0.16;
      dummy.scale.setScalar(pulse);
      dummy.updateMatrix();
      orbMesh.setMatrixAt(idx, dummy.matrix);
      idx++;
    }

    const peerKeys = Object.keys(st.peers);
    for (let i = 0; i < peerKeys.length && idx < MAX_FAR_LANTERNS; i++) {
      const sid = peerKeys[i];
      if (nearSessionIds.has(sid)) continue;
      const p = st.peers[sid];
      const bob = Math.sin(t * 2.2 + p.numericId * 0.7) * 0.06;

      dummy.position.set(p.x, p.y + 0.82, p.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      capeMesh.setMatrixAt(idx, dummy.matrix);

      dummy.position.set(p.x + 0.22, p.y + 1.05 + bob, p.z + 0.12);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      orbMesh.setMatrixAt(idx, dummy.matrix);
      idx++;
    }

    capeMesh.count = idx;
    orbMesh.count = idx;
    capeMesh.instanceMatrix.needsUpdate = true;
    orbMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        ref={capeMeshRef}
        args={[capeGeo, capeMat, MAX_FAR_LANTERNS]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={orbMeshRef}
        args={[orbGeo, orbMat, MAX_FAR_LANTERNS]}
        frustumCulled={false}
      />
    </group>
  );
}

export function PeerCrowdRenderer() {
  const qualityTier = useGameStore((s) => s.qualityTier);
  const maxNearPeers = qualityTier === 'mobile' ? 16 : 32;

  const [nearSlots, setNearSlots] = useState<PeerAppearanceSlot[]>([]);
  const lastSigRef = useRef<string>('');

  useEffect(() => {
    const refreshNearestSlots = () => {
      const st = useGameStore.getState();
      const lt = st.localTransient;
      const allPeers = Object.values(st.peers);

      if (allPeers.length === 0) {
        if (lastSigRef.current !== '') {
          lastSigRef.current = '';
          setNearSlots([]);
        }
        return;
      }

      allPeers.sort((a, b) => {
        const da = (a.x - lt.x) * (a.x - lt.x) + (a.z - lt.z) * (a.z - lt.z);
        const db = (b.x - lt.x) * (b.x - lt.x) + (b.z - lt.z) * (b.z - lt.z);
        return da - db;
      });

      const selected: PeerAppearanceSlot[] = allPeers.slice(0, maxNearPeers).map((p) => ({
        sessionId: p.sessionId,
        numericId: p.numericId,
        displayName: p.displayName,
        outfit: p.outfit,
        heldItem: p.heldItem,
        isBot: p.isBot,
      }));

      const nextSig = selected.map(outfitSignature).join('||');
      if (nextSig !== lastSigRef.current) {
        lastSigRef.current = nextSig;
        setNearSlots(selected);
      }
    };

    refreshNearestSlots();
    const timer = setInterval(refreshNearestSlots, 450);
    return () => clearInterval(timer);
  }, [maxNearPeers]);

  const nearSessionIdSet = useMemo(
    () => new Set(nearSlots.map((s) => s.sessionId)),
    [nearSlots]
  );

  return (
    <group>
      <LocalPlayerChatBubble />
      {nearSlots.map((slot) => (
        <PeerAvatarSlot key={slot.sessionId} slot={slot} />
      ))}
      <FarLanternSilhouettes nearSessionIds={nearSessionIdSet} />
    </group>
  );
}
