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
import { normalizeRoomCode, ROOM_CODE_REGEX, WORLD_CONSTANTS } from '@dalat/protocol';
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

function buildCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get('origin');
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': origin || '*',
    ...(origin ? { 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function jsonResponse(data: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: buildCorsHeaders(req),
  });
}

function toChannelSummary(cache: IRoomCache<CloudRoomMetadata>): RoomChannelSummary {
  const liveRoom = activeCloudRooms.get(cache.roomId);
  // Report verified connected human count so unconsumed HTTP seat reservations & bots never inflate shard occupancy
  const playerCount = liveRoom ? liveRoom.getHumanCount() : cache.clients;
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

// Lightweight sliding-window rate limiter protecting HTTP matchmaking & leave-tab endpoints from abuse
const rateBuckets = new Map<string, { count: number; resetAtMs: number }>();
function checkRateLimit(
  req: Request | undefined,
  scope: string,
  maxPerWindow: number,
  windowMs = 10_000
): boolean {
  const ip =
    req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req?.headers.get('cf-connecting-ip')?.trim() ||
    'local';
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || now >= entry.resetAtMs) {
    rateBuckets.set(key, { count: 1, resetAtMs: now + windowMs });
    if (rateBuckets.size > 2048) {
      for (const [k, v] of rateBuckets) {
        if (now >= v.resetAtMs) rateBuckets.delete(k);
      }
    }
    return true;
  }
  if (entry.count >= maxPerWindow) {
    return false;
  }
  entry.count += 1;
  return true;
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
  roomCode?: string;
  strictCustomCode?: boolean;
  reserveSeat?: boolean;
  clientOptions?: Record<string, unknown>;
}

async function resolveWarmestOrPreferredRoom(body: ResolveRoomRequestBody): Promise<{
  ok?: boolean;
  error?: string;
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
    // Evict any lingering ghost session from the exact same browser tab ONLY when leaveSecret matches
    const rawTabId =
      typeof body.clientOptions?.tabId === 'string'
        ? body.clientOptions.tabId.trim().slice(0, 64)
        : '';
    const rawLeaveSecret =
      typeof body.clientOptions?.leaveSecret === 'string'
        ? body.clientOptions.leaveSecret.trim().slice(0, 128)
        : '';
    if (rawTabId && rawLeaveSecret.length >= 12) {
      for (const liveRoom of activeCloudRooms.values()) {
        liveRoom.evictClientSession(undefined, rawTabId, rawLeaveSecret);
      }
    }

    let rooms = await listActiveRoomCaches();
    const rawTarget = (body.preferredRoomCode || body.roomCodeOrId || body.roomCode || '').trim();
    const normalizedTarget = normalizeRoomCode(rawTarget);

    let chosen: IRoomCache<CloudRoomMetadata> | undefined;
    let fallbackFromFull = false;

    if (rawTarget) {
      const exactMatch = rooms.find(
        (r) =>
          r.roomId === rawTarget ||
          normalizeRoomCode(r.metadata?.roomCode || '') === normalizedTarget
      );

      if (exactMatch) {
        if (exactMatch.clients < WORLD_CONSTANTS.HARD_ROOM_CAP && !exactMatch.locked) {
          chosen = exactMatch;
        } else {
          fallbackFromFull = true;
        }
      } else if (ROOM_CODE_REGEX.test(normalizedTarget)) {
        // Create requested named channel / friend code on demand (3..14 chars)
        chosen = (await matchMaker.createRoom(ROOM_TYPE, {
          customRoomCode: normalizedTarget,
        })) as IRoomCache<CloudRoomMetadata>;
      } else if (body.strictCustomCode) {
        return {
          ok: false,
          error: 'Mã phòng cần từ 3–14 ký tự chữ hoặc số (VD: DALAT-SANMAY).',
          roomId: '',
          roomCode: '',
          channelName: '',
          playerCount: 0,
          softCap: WORLD_CONSTANTS.SOFT_ROOM_CAP,
          hardCap: WORLD_CONSTANTS.HARD_ROOM_CAP,
        };
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
  if (typeof ctx.body === 'string') {
    try {
      return JSON.parse(ctx.body) as ResolveRoomRequestBody;
    } catch {
      return {};
    }
  }
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

const healthEndpoint = createEndpoint('/health', { method: 'GET' }, async (ctx) => {
  const rooms = await listActiveRoomCaches();
  const totalPlayers = rooms.reduce((sum, r) => sum + r.clients, 0);
  return jsonResponse(
    {
      ok: true,
      service: 'dalat-cloud-hunting-server',
      uptimeSec: Math.round(process.uptime()),
      roomCount: rooms.length,
      totalPlayers,
      serverEpochMs: Date.now(),
    },
    200,
    ctx.request
  );
});

const channelsEndpoint = createEndpoint('/api/channels', { method: 'GET' }, async (ctx) => {
  let rooms = await listActiveRoomCaches();
  if (rooms.length === 0) {
    await matchMaker.createRoom(ROOM_TYPE, { customRoomCode: 'MAY-01', keepAlive: true });
    rooms = await listActiveRoomCaches();
  }
  const channels: RoomChannelSummary[] = rooms.map(toChannelSummary);
  return jsonResponse(channels, 200, ctx.request);
});

const resolveRoomEndpoint = createEndpoint('/api/resolve-room', { method: 'POST' }, async (ctx) => {
  if (!checkRateLimit(ctx.request, 'resolve', 35, 10_000)) {
    return jsonResponse(
      { ok: false, error: 'Quá nhiều yêu cầu kết nối liên tiếp, vui lòng thử lại sau ít giây.' },
      429,
      ctx.request
    );
  }
  const body = await parseJsonBody(ctx);
  const resolved = await resolveWarmestOrPreferredRoom(body);
  if (resolved.ok === false) {
    return jsonResponse(resolved, 400, ctx.request);
  }
  return jsonResponse(resolved, 200, ctx.request);
});

const joinChannelEndpoint = createEndpoint('/api/join-channel', { method: 'POST' }, async (ctx) => {
  if (!checkRateLimit(ctx.request, 'join', 25, 10_000)) {
    return jsonResponse(
      { ok: false, error: 'Quá nhiều yêu cầu chuyển kênh liên tiếp, vui lòng thử lại sau ít giây.' },
      429,
      ctx.request
    );
  }
  const body = await parseJsonBody(ctx);
  const hasExplicitCode = Boolean(
    (body.preferredRoomCode || body.roomCodeOrId || body.roomCode || '').trim()
  );
  const resolved = await resolveWarmestOrPreferredRoom({
    ...body,
    strictCustomCode: body.strictCustomCode ?? hasExplicitCode,
  });
  if (resolved.ok === false) {
    return jsonResponse(resolved, 400, ctx.request);
  }
  return jsonResponse(resolved, 200, ctx.request);
});

const leaveTabEndpoint = createEndpoint('/api/leave-tab', { method: 'POST' }, async (ctx) => {
  if (!checkRateLimit(ctx.request, 'leave', 30, 10_000)) {
    return jsonResponse({ ok: false, error: 'Rate limit exceeded' }, 429, ctx.request);
  }
  const body = (await parseJsonBody(ctx)) as {
    roomId?: string;
    sessionId?: string;
    tabId?: string;
    leaveSecret?: string;
  };
  const roomId = typeof body?.roomId === 'string' ? body.roomId.trim() : '';
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
  const tabId = typeof body?.tabId === 'string' ? body.tabId.trim().slice(0, 64) : '';
  const leaveSecret =
    typeof body?.leaveSecret === 'string' ? body.leaveSecret.trim().slice(0, 128) : '';

  if ((!sessionId && !tabId) || leaveSecret.length < 12) {
    return jsonResponse(
      { ok: false, error: 'Forbidden: missing session ownership secret' },
      403,
      ctx.request
    );
  }

  let anyMatched = false;
  let anyAuthorized = false;

  if (roomId) {
    const rm = activeCloudRooms.get(roomId);
    if (rm) {
      const res = rm.evictClientSession(sessionId, tabId, leaveSecret);
      if (res.matched) anyMatched = true;
      if (res.authorized) anyAuthorized = true;
    }
  } else {
    for (const rm of activeCloudRooms.values()) {
      const res = rm.evictClientSession(sessionId, tabId, leaveSecret);
      if (res.matched) anyMatched = true;
      if (res.authorized) anyAuthorized = true;
    }
  }

  if (anyMatched && !anyAuthorized) {
    return jsonResponse(
      { ok: false, error: 'Forbidden: invalid session ownership secret' },
      403,
      ctx.request
    );
  }

  return jsonResponse({ ok: true, evicted: anyMatched && anyAuthorized }, 200, ctx.request);
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

function isBackendApiRoute(pathname: string): boolean {
  return (
    pathname === '/health' ||
    pathname === '/__healthcheck' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/matchmake/')
  );
}

const originalBindRouter = transport.bindRouter.bind(transport);
transport.bindRouter = (router: any) => {
  const wrappedRouter = {
    ...router,
    findRoute(method: string, pathname: string) {
      if (method === 'OPTIONS' && isBackendApiRoute(pathname)) {
        return { corsPreflight: true };
      }
      if (isBackendApiRoute(pathname)) {
        return router.findRoute(method, pathname);
      }
      if (
        (method === 'GET' || method === 'HEAD') &&
        existsSync(STATIC_WEB_DIST_DIR)
      ) {
        return { staticWebFallback: true };
      }
      return router.findRoute(method, pathname);
    },
    async handler(req: Request) {
      const url = new URL(req.url);
      if (req.method === 'OPTIONS' && isBackendApiRoute(url.pathname)) {
        return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
      }
      if (isBackendApiRoute(url.pathname)) {
        return router.handler(req);
      }
      if (
        (req.method === 'GET' || req.method === 'HEAD') &&
        existsSync(STATIC_WEB_DIST_DIR)
      ) {
        return serveStaticWebAsset(req);
      }
      return router.handler(req);
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
    leaveTabEndpoint,
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
