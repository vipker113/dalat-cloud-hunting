import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { BunWebSockets } from '@colyseus/bun-websockets';
import {
  createEndpoint,
  createRouter,
  matchMaker,
  Server,
  type IRoomCache,
} from '@colyseus/core';
import { WORLD_CONSTANTS } from '@dalat/protocol';
import { activeCloudRooms, CloudHuntingRoom } from './CloudHuntingRoom';
import { worldPersistence } from './persistence';
import type { CloudRoomMetadata } from './schema';

const PORT = Number(process.env.PORT || 2567);
const ROOM_TYPE = 'cloud_hunting';
const STATIC_WEB_DIST_DIR = resolve(
  process.env.STATIC_WEB_DIR || join(import.meta.dir, '../../web/dist')
);

export interface RoomChannelSummary {
  roomId: string;
  roomCode: string;
  channelName: string;
  playerCount: number;
  softCap: number;
  hardCap: number;
}

const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}

function toChannelSummary(cache: IRoomCache<CloudRoomMetadata>): RoomChannelSummary {
  const liveRoom = activeCloudRooms.get(cache.roomId);
  const playerCount = liveRoom ? Math.max(cache.clients, liveRoom.clients.length) : cache.clients;
  return {
    roomId: cache.roomId,
    roomCode: cache.metadata?.roomCode || liveRoom?.roomCode || 'MAY-01',
    channelName:
      cache.metadata?.channelName || liveRoom?.channelName || 'Sương Sớm Cầu Đất #1',
    playerCount,
    softCap: cache.metadata?.softCap ?? WORLD_CONSTANTS.SOFT_ROOM_CAP,
    hardCap: cache.metadata?.hardCap ?? WORLD_CONSTANTS.HARD_ROOM_CAP,
  };
}

async function listActiveRoomCaches(): Promise<Array<IRoomCache<CloudRoomMetadata>>> {
  const rooms = (await matchMaker.query({ name: ROOM_TYPE })) as Array<
    IRoomCache<CloudRoomMetadata>
  >;
  rooms.sort((a, b) => (a.metadata?.shardIndex ?? 99) - (b.metadata?.shardIndex ?? 99));
  return rooms;
}

// Serialize concurrent matchmaking resolutions so parallel joins never race on shard creation
let resolveChain: Promise<unknown> = Promise.resolve();
function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = resolveChain.then(fn, fn);
  resolveChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

interface ResolveRoomRequestBody {
  preferredRoomCode?: string;
  roomCodeOrId?: string;
  reserveSeat?: boolean;
  clientOptions?: Record<string, unknown>;
}

async function resolveWarmestOrPreferredRoom(body: ResolveRoomRequestBody): Promise<{
  roomId: string;
  roomCode: string;
  channelName: string;
  playerCount: number;
  softCap: number;
  hardCap: number;
  fallbackFromFull?: boolean;
  seatReservation?: Awaited<ReturnType<typeof matchMaker.reserveSeatFor>>;
}> {
  return runSerialized(async () => {
    let rooms = await listActiveRoomCaches();
    const rawTarget = (body.preferredRoomCode || body.roomCodeOrId || '').trim();
    const upperTarget = rawTarget.toUpperCase();

    let chosen: IRoomCache<CloudRoomMetadata> | undefined;
    let fallbackFromFull = false;

    if (rawTarget) {
      const exactMatch = rooms.find(
        (r) =>
          r.roomId === rawTarget ||
          (r.metadata?.roomCode || '').toUpperCase() === upperTarget
      );

      if (exactMatch) {
        if (exactMatch.clients < WORLD_CONSTANTS.HARD_ROOM_CAP && !exactMatch.locked) {
          chosen = exactMatch;
        } else {
          fallbackFromFull = true;
        }
      } else if (/^[A-Z0-9-]{3,10}$/.test(upperTarget)) {
        // Create requested named channel / friend code on demand
        chosen = (await matchMaker.createRoom(ROOM_TYPE, {
          customRoomCode: upperTarget,
        })) as IRoomCache<CloudRoomMetadata>;
      }
    }

    // Warmest-First Public Matchmaking: fullest shard strictly below SOFT_ROOM_CAP (35)
    if (!chosen) {
      rooms = await listActiveRoomCaches();
      const publicCandidates = rooms
        .filter((r) => !r.locked && r.clients < WORLD_CONSTANTS.SOFT_ROOM_CAP)
        .sort((a, b) => b.clients - a.clients);

      if (publicCandidates.length > 0) {
        chosen = publicCandidates[0];
      } else {
        chosen = (await matchMaker.createRoom(ROOM_TYPE, {})) as IRoomCache<CloudRoomMetadata>;
      }
    }

    let seatReservation: Awaited<ReturnType<typeof matchMaker.reserveSeatFor>> | undefined;
    if (body.reserveSeat) {
      seatReservation = await matchMaker.reserveSeatFor(chosen, body.clientOptions || {});
    }

    const summary = toChannelSummary(chosen);
    return {
      ...summary,
      ...(fallbackFromFull ? { fallbackFromFull: true } : {}),
      ...(seatReservation ? { seatReservation } : {}),
    };
  });
}

async function parseJsonBody(ctx: { body?: unknown; request?: Request }): Promise<ResolveRoomRequestBody> {
  if (ctx.body && typeof ctx.body === 'object') {
    return ctx.body as ResolveRoomRequestBody;
  }
  if (ctx.request) {
    try {
      const text = await ctx.request.text();
      if (text) return JSON.parse(text) as ResolveRoomRequestBody;
    } catch {
      // ignore empty/malformed JSON body
    }
  }
  return {};
}

const healthEndpoint = createEndpoint('/health', { method: 'GET' }, async () => {
  const rooms = await listActiveRoomCaches();
  const totalPlayers = rooms.reduce((sum, r) => sum + r.clients, 0);
  return jsonResponse({
    ok: true,
    service: 'dalat-cloud-hunting-server',
    uptimeSec: Math.round(process.uptime()),
    roomCount: rooms.length,
    totalPlayers,
    serverEpochMs: Date.now(),
  });
});

const channelsEndpoint = createEndpoint('/api/channels', { method: 'GET' }, async () => {
  let rooms = await listActiveRoomCaches();
  if (rooms.length === 0) {
    await matchMaker.createRoom(ROOM_TYPE, { customRoomCode: 'MAY-01', keepAlive: true });
    rooms = await listActiveRoomCaches();
  }
  const channels: RoomChannelSummary[] = rooms.map(toChannelSummary);
  return jsonResponse(channels);
});

const resolveRoomEndpoint = createEndpoint('/api/resolve-room', { method: 'POST' }, async (ctx) => {
  const body = await parseJsonBody(ctx);
  const resolved = await resolveWarmestOrPreferredRoom(body);
  return jsonResponse(resolved);
});

const joinChannelEndpoint = createEndpoint('/api/join-channel', { method: 'POST' }, async (ctx) => {
  const body = await parseJsonBody(ctx);
  const resolved = await resolveWarmestOrPreferredRoom(body);
  return jsonResponse(resolved);
});

const transport = new BunWebSockets({
  maxPayloadLength: 2 * 1024 * 1024, // 2 MB for Polaroid canvas data URLs
});

function isFileOnDisk(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

async function serveStaticWebAsset(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const decodedPath = decodeURIComponent(url.pathname);
  const candidatePath = resolve(STATIC_WEB_DIST_DIR, '.' + decodedPath);
  if (!candidatePath.startsWith(STATIC_WEB_DIST_DIR)) {
    return new Response('Forbidden', { status: 403 });
  }

  let targetPath = candidatePath;
  let isImmutableAsset = decodedPath.startsWith('/assets/');

  if (!isFileOnDisk(targetPath)) {
    // SPA fallback for client routes without a file extension
    if (!extname(decodedPath) || decodedPath === '/') {
      targetPath = join(STATIC_WEB_DIST_DIR, 'index.html');
      isImmutableAsset = false;
    } else {
      return new Response('Not Found', { status: 404 });
    }
  }

  if (!isFileOnDisk(targetPath)) {
    return new Response('Not Found', { status: 404 });
  }

  const file = Bun.file(targetPath);
  const headers: Record<string, string> = {
    'Content-Type': file.type || 'application/octet-stream',
    'Cache-Control': isImmutableAsset
      ? 'public, max-age=31536000, immutable'
      : targetPath.endsWith('index.html')
        ? 'no-cache'
        : 'public, max-age=3600',
  };

  return new Response(req.method === 'HEAD' ? null : file.stream(), {
    status: 200,
    headers,
  });
}

const originalBindRouter = transport.bindRouter.bind(transport);
transport.bindRouter = (router: any) => {
  const wrappedRouter = {
    ...router,
    findRoute(method: string, pathname: string) {
      const matched = router.findRoute(method, pathname);
      if (matched !== undefined) return matched;
      if (
        (method === 'GET' || method === 'HEAD') &&
        !pathname.startsWith('/api/') &&
        !pathname.startsWith('/matchmake/') &&
        existsSync(STATIC_WEB_DIST_DIR)
      ) {
        return { staticWebFallback: true };
      }
      return undefined;
    },
    async handler(req: Request) {
      const url = new URL(req.url);
      if (router.findRoute(req.method, url.pathname) !== undefined) {
        return router.handler(req);
      }
      return serveStaticWebAsset(req);
    },
  };
  originalBindRouter(wrappedRouter);
};

const gameServer = new Server({
  transport,
  greet: false,
});

gameServer.router = createRouter(
  {
    healthEndpoint,
    channelsEndpoint,
    resolveRoomEndpoint,
    joinChannelEndpoint,
  },
  { openapi: { disabled: true } }
);

gameServer
  .define(ROOM_TYPE, CloudHuntingRoom)
  .sortBy({ clients: -1 }); // Warmest-first native matchmaker sorting

gameServer.onBeforeShutdown(async () => {
  worldPersistence.flushToDiskNow();
});

async function bootstrap(): Promise<void> {
  await gameServer.listen(PORT);
  // Pre-warm Channel #1 ("Sương Sớm Cầu Đất #1" / MAY-01) with 5 autonomous hikers
  const existing = await listActiveRoomCaches();
  if (existing.length === 0) {
    await matchMaker.createRoom(ROOM_TYPE, { customRoomCode: 'MAY-01', keepAlive: true });
  }
  console.log(
    `[Chạm Mây Đà Lạt] Colyseus + Bun WebSocket server listening on ws://localhost:${PORT} (12 Hz binary sync)`
  );
}

void bootstrap();
