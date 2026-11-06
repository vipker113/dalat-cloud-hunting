import { Client, type Room } from '@colyseus/sdk';
import {
  type CoatStyleId,
  decodeWorldSnapshot,
  encodeClientMove,
  type HeadwearId,
  type HeldItemId,
  HIGHLAND_PALETTE,
  sampleWalkableHeight,
  WORLD_CONSTANTS,
} from '@dalat/protocol';

interface SwarmConfig {
  bots: number;
  durationSec: number;
  wsUrl: string;
  httpUrl: string;
  preferredRoomCode?: string;
}

function parseCliArgs(argv: string[]): SwarmConfig {
  let bots = 30;
  let durationSec = 15;
  const defaultPort = process.env.PORT || '2567';
  let wsUrl = `ws://localhost:${defaultPort}`;
  let preferredRoomCode: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith('--bots=')) {
      bots = Math.max(1, Math.min(200, Number.parseInt(arg.slice('--bots='.length), 10) || 30));
    } else if (arg.startsWith('--duration=')) {
      durationSec = Math.max(1, Math.min(300, Number.parseFloat(arg.slice('--duration='.length)) || 15));
    } else if (arg.startsWith('--url=')) {
      wsUrl = arg.slice('--url='.length).trim();
    } else if (arg.startsWith('--room=')) {
      preferredRoomCode = arg.slice('--room='.length).trim();
    }
  }

  const httpUrl = wsUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
  return { bots, durationSec, wsUrl, httpUrl, preferredRoomCode };
}

const HIKE_PATH: Array<[number, number]> = [
  [-45, 30],
  [-18, 4],
  [12, -25],
  [34, -52],
  [52, -75],
  [89, -75],
];

const COAT_STYLES: CoatStyleId[] = ['wool_trench', 'knit_sweater', 'puffer_vest', 'vintage_poncho'];
const HEADWEAR: HeadwearId[] = ['beanie', 'beret', 'scarf_only', 'none'];
const HELD_ITEMS: HeldItemId[] = ['soy_milk', 'phin_coffee', 'film_camera', 'lantern'];

interface BotTelemetry {
  index: number;
  roomCode: string;
  snapshotsReceived: number;
  movesSent: number;
  bytesSent: number;
  bytesReceived: number;
  nearPeerSamplesSum: number;
  maxFarBeacons: number;
  rttSamplesMs: number[];
}

async function runSwarm(): Promise<void> {
  const cfg = parseCliArgs(process.argv.slice(2));
  console.log(
    `[BotSwarm] Connecting ${cfg.bots} highland hikers to ${cfg.wsUrl} for ${cfg.durationSec}s...`
  );

  const activeRooms: Room[] = [];
  const telemetries: BotTelemetry[] = [];
  const hikerStates: Array<{
    room: Room;
    telemetry: BotTelemetry;
    segIdx: number;
    segT: number;
    seq: number;
    lateralOffset: number;
    speedFactor: number;
  }> = [];

  const connectStartMs = performance.now();

  for (let i = 0; i < cfg.bots; i++) {
    const client = new Client(cfg.wsUrl);
    const displayName = `SwarmHiker #${String(i + 1).padStart(2, '0')}`;
    const outfit = {
      coatStyle: COAT_STYLES[i % COAT_STYLES.length],
      coatColor: HIGHLAND_PALETTE.coats[i % HIGHLAND_PALETTE.coats.length],
      scarfColor: HIGHLAND_PALETTE.scarves[i % HIGHLAND_PALETTE.scarves.length],
      headwear: HEADWEAR[i % HEADWEAR.length],
      hairColor: HIGHLAND_PALETTE.hair[i % HIGHLAND_PALETTE.hair.length],
      backpack: i % 2 === 0,
    };
    const heldItem = HELD_ITEMS[i % HELD_ITEMS.length];
    const joinOptions = { displayName, outfit, heldItem };

    const telemetry: BotTelemetry = {
      index: i,
      roomCode: 'UNKNOWN',
      snapshotsReceived: 0,
      movesSent: 0,
      bytesSent: 0,
      bytesReceived: 0,
      nearPeerSamplesSum: 0,
      maxFarBeacons: 0,
      rttSamplesMs: [],
    };

    try {
      const res = await fetch(`${cfg.httpUrl}/api/resolve-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredRoomCode: cfg.preferredRoomCode,
          reserveSeat: true,
          clientOptions: joinOptions,
        }),
      });

      let room: Room;
      if (res.ok) {
        const resolved = (await res.json()) as {
          roomId: string;
          roomCode: string;
          seatReservation?: Parameters<Client['consumeSeatReservation']>[0];
        };
        telemetry.roomCode = resolved.roomCode;
        if (resolved.seatReservation) {
          room = await client.consumeSeatReservation(resolved.seatReservation);
        } else {
          room = await client.joinById(resolved.roomId, joinOptions);
        }
      } else {
        room = await client.joinOrCreate('cloud_hunting', joinOptions);
      }

      room.onMessage('world_init', (msg: { roomCode?: string }) => {
        if (msg?.roomCode) {
          telemetry.roomCode = msg.roomCode;
        }
      });

      room.onMessage('pong_sync', (msg: { clientSendMs?: number }) => {
        if (typeof msg?.clientSendMs === 'number') {
          telemetry.rttSamplesMs.push(Math.max(0.1, Date.now() - msg.clientSendMs));
        }
      });

      room.onMessage('snap', (bytes: Uint8Array) => {
        telemetry.bytesReceived += bytes.byteLength;
        const decoded = decodeWorldSnapshot(bytes);
        if (decoded) {
          telemetry.snapshotsReceived++;
          telemetry.nearPeerSamplesSum += decoded.nearPeers.length;
          if (decoded.farPeers.length > telemetry.maxFarBeacons) {
            telemetry.maxFarBeacons = decoded.farPeers.length;
          }
        }
      });

      // Ignore broadcast social events quietly
      room.onMessage('*', () => {});

      activeRooms.push(room);
      telemetries.push(telemetry);
      hikerStates.push({
        room,
        telemetry,
        segIdx: i % (HIKE_PATH.length - 1),
        segT: (i * 0.17) % 1,
        seq: 0,
        lateralOffset: ((i % 5) - 2) * 0.55,
        speedFactor: 0.88 + (i % 4) * 0.08,
      });
    } catch (err) {
      console.error(`[BotSwarm] Bot #${i + 1} failed to join:`, err);
    }
  }

  const connectElapsedMs = Math.round(performance.now() - connectStartMs);
  console.log(
    `[BotSwarm] Connected ${hikerStates.length}/${cfg.bots} bots in ${connectElapsedMs}ms. Streaming 12 Hz binary moves...`
  );

  const tickIntervalMs = Math.round(1000 / WORLD_CONSTANTS.NET_TICK_HZ);
  const dtSec = 1 / WORLD_CONSTANTS.NET_TICK_HZ;
  const simStartMs = performance.now();

  let tickCounter = 0;
  const loopTimer = setInterval(() => {
    tickCounter++;
    const doClockPing = tickCounter % 12 === 1;

    for (let i = 0; i < hikerStates.length; i++) {
      const bot = hikerStates[i];
      const [ax, az] = HIKE_PATH[bot.segIdx];
      const [bx, bz] = HIKE_PATH[bot.segIdx + 1];
      const segDx = bx - ax;
      const segDz = bz - az;
      const segLen = Math.hypot(segDx, segDz) || 1;
      const speed = WORLD_CONSTANTS.MAX_WALK_SPEED * bot.speedFactor;

      bot.segT += (speed * dtSec) / segLen;
      if (bot.segT >= 1) {
        bot.segT -= 1;
        bot.segIdx = (bot.segIdx + 1) % (HIKE_PATH.length - 1);
      }

      const [curAx, curAz] = HIKE_PATH[bot.segIdx];
      const [curBx, curBz] = HIKE_PATH[bot.segIdx + 1];
      const dx = curBx - curAx;
      const dz = curBz - curAz;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;

      const x = curAx + dx * bot.segT + nx * bot.lateralOffset;
      const z = curAz + dz * bot.segT + nz * bot.lateralOffset;
      const y = sampleWalkableHeight(x, z);
      const yaw = Math.atan2(dx, dz);

      bot.seq = (bot.seq + 1) & 0xffff;
      const moveBytes = encodeClientMove({
        seq: bot.seq,
        x,
        y,
        z,
        yaw,
        vx: (dx / len) * speed,
        vz: (dz / len) * speed,
        moving: true,
        running: false,
        grounded: true,
        warmBuff: true,
      });

      bot.room.sendBytes('mv', moveBytes);
      bot.telemetry.movesSent++;
      bot.telemetry.bytesSent += moveBytes.byteLength;

      if (doClockPing) {
        bot.room.send('ping_sync', { clientSendMs: Date.now() });
      }
    }
  }, tickIntervalMs);

  await new Promise((resolve) => setTimeout(resolve, cfg.durationSec * 1000));
  clearInterval(loopTimer);

  const actualDurationSec = Math.max(0.1, (performance.now() - simStartMs) / 1000);

  await Promise.allSettled(activeRooms.map((r) => r.leave(true)));

  // Aggregate benchmark metrics
  const channelCounts: Record<string, number> = {};
  let totalSnapshots = 0;
  let totalMovesSent = 0;
  let totalBytesSent = 0;
  let totalBytesReceived = 0;
  let totalNearPeers = 0;
  let maxFarBeacons = 0;
  const allRtts: number[] = [];

  for (const t of telemetries) {
    channelCounts[t.roomCode] = (channelCounts[t.roomCode] || 0) + 1;
    totalSnapshots += t.snapshotsReceived;
    totalMovesSent += t.movesSent;
    totalBytesSent += t.bytesSent;
    totalBytesReceived += t.bytesReceived;
    totalNearPeers += t.nearPeerSamplesSum;
    if (t.maxFarBeacons > maxFarBeacons) maxFarBeacons = t.maxFarBeacons;
    allRtts.push(...t.rttSamplesMs);
  }

  allRtts.sort((a, b) => a - b);
  const avgRttMs =
    allRtts.length > 0
      ? Number((allRtts.reduce((s, v) => s + v, 0) / allRtts.length).toFixed(2))
      : 0;
  const p95RttMs =
    allRtts.length > 0
      ? Number(allRtts[Math.min(allRtts.length - 1, Math.floor(allRtts.length * 0.95))].toFixed(2))
      : 0;

  const connectedCount = Math.max(1, telemetries.length);
  const summary = {
    connectedBots: telemetries.length,
    targetBots: cfg.bots,
    durationSec: Number(actualDurationSec.toFixed(2)),
    connectTimeMs: connectElapsedMs,
    channelDistribution: channelCounts,
    movesSentTotal: totalMovesSent,
    snapshotsReceivedTotal: totalSnapshots,
    avgSnapshotHzPerClient: Number((totalSnapshots / connectedCount / actualDurationSec).toFixed(2)),
    avgNearPeersPerSnapshot:
      totalSnapshots > 0 ? Number((totalNearPeers / totalSnapshots).toFixed(1)) : 0,
    maxFarBeaconsObserved: maxFarBeacons,
    txBytesPerSecPerClient: Math.round(totalBytesSent / connectedCount / actualDurationSec),
    rxBytesPerSecPerClient: Math.round(totalBytesReceived / connectedCount / actualDurationSec),
    totalBandwidthKBps: Number(((totalBytesSent + totalBytesReceived) / 1024 / actualDurationSec).toFixed(2)),
    avgRttMs,
    p95RttMs,
  };

  console.table([
    {
      Bots: `${summary.connectedBots}/${summary.targetBots}`,
      'Duration (s)': summary.durationSec,
      'Snap Rate (Hz)': summary.avgSnapshotHzPerClient,
      'Avg Near Peers': summary.avgNearPeersPerSnapshot,
      'TX B/s/bot': summary.txBytesPerSecPerClient,
      'RX B/s/bot': summary.rxBytesPerSecPerClient,
      'Total KB/s': summary.totalBandwidthKBps,
      'Avg RTT (ms)': summary.avgRttMs,
      'P95 RTT (ms)': summary.p95RttMs,
    },
  ]);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

void runSwarm();
