import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chromium, Browser, Page } from 'playwright-core';
import { z } from 'zod';
import { mkdirSync } from 'node:fs';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_GAME_URL = process.env.GAME_URL || 'http://localhost:5173';
const SCREENSHOT_DIR = '/Users/admin/blender/dalat_cloud_hunting/tools/dalat-game-qa-mcp/screenshots';

let browser: Browser | null = null;
let page: Page | null = null;

async function ensureGamePage(url = DEFAULT_GAME_URL): Promise<Page> {
  if (!browser) {
    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'],
    });
  }
  if (!page || page.isClosed()) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean((window as unknown as { __DALAT_QA__?: unknown }).__DALAT_QA__), {
      timeout: 15000,
    });
  }
  return page;
}

const server = new McpServer({
  name: 'dalat-game-qa-mcp',
  version: '0.1.0',
});

server.tool('inspect_scene', 'Inspect WebGL draw calls, triangles, VRAM estimate, and room sync stats', {}, async () => {
  const p = await ensureGamePage();
  const data = await p.evaluate(() => (window as any).__DALAT_QA__.inspectScene());
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
});

server.tool('get_player_state', 'Get local player coordinates, ASL altitude, surface type, warmth buff, and held item', {}, async () => {
  const p = await ensureGamePage();
  const data = await p.evaluate(() => (window as any).__DALAT_QA__.getPlayerState());
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
});

server.tool(
  'teleport_player',
  'Teleport player to a named Da Lat landmark or explicit [x, y, z] coordinates',
  {
    landmarkId: z
      .enum(['quan-mo-suong', 'cau-go-san-may', 'cay-thong-co-don', 'dai-ngam-den', 'gac-che-1927'])
      .optional(),
    position: z.tuple([z.number(), z.number(), z.number()]).optional(),
    lookAt: z.tuple([z.number(), z.number(), z.number()]).optional(),
  },
  async (args) => {
    const p = await ensureGamePage();
    const data = await p.evaluate((opts) => (window as any).__DALAT_QA__.teleportPlayer(opts), args);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'inspect_collision',
  'Scan three-mesh-bvh world collider across landmarks, wooden bridges, and trails for holes or steepness',
  { sampleStep: z.number().optional() },
  async (args) => {
    const p = await ensureGamePage();
    const data = await p.evaluate((opts) => (window as any).__DALAT_QA__.inspectCollision(opts), args);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'trigger_interaction',
  'Trigger an in-game Da Lat interaction (enter_world, brew_coffee, pour_soy_milk, sit_bench, jam_guitar, send_chat, snap_polaroid)',
  {
    action: z.string(),
    payload: z.record(z.unknown()).optional(),
  },
  async ({ action, payload }) => {
    const p = await ensureGamePage();
    const data = await p.evaluate(
      ({ a, pl }) => (window as any).__DALAT_QA__.triggerInteraction(a, pl),
      { a: action, pl: payload }
    );
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'set_world_atmosphere',
  'Override in-game 24h clock and Da Lat weather state for visual & shader verification',
  {
    gameHour: z.number().nullable(),
    weather: z
      .enum([
        'golden_cloud_sea',
        'morning_mist_boil',
        'clear_highland_sun',
        'cloudy_breeze',
        'deep_evening_fog',
        'light_drizzle',
      ])
      .nullable(),
  },
  async ({ gameHour, weather }) => {
    const p = await ensureGamePage();
    const data = await p.evaluate(
      ({ gh, w }) => (window as any).__DALAT_QA__.setWorldAtmosphere(gh, w),
      { gh: gameHour, w: weather }
    );
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'capture_screenshot',
  'Capture a high-resolution PNG screenshot of the live 3D viewport',
  { filename: z.string().default('qa_capture.png') },
  async ({ filename }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const p = await ensureGamePage();
    const outPath = `${SCREENSHOT_DIR}/${filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    await p.waitForTimeout(350);
    await p.screenshot({ path: outPath });
    return { content: [{ type: 'text', text: JSON.stringify({ savedTo: outPath }) }] };
  }
);

server.tool(
  'measure_fps',
  'Measure live WebGL FPS (avg, P95, min), frameTimeMs, drawCalls, triangles, and VRAM estimate',
  { durationMs: z.number().default(2000) },
  async ({ durationMs }) => {
    const p = await ensureGamePage();
    const data = await p.evaluate((ms) => (window as any).__DALAT_QA__.measureFps(ms), durationMs);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

async function start() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

start().catch((err) => {
  console.error('[dalat-game-qa-mcp] Fatal:', err);
  process.exit(1);
});

