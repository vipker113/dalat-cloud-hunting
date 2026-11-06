import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE_URL = process.env.GAME_URL || 'http://localhost:5173';
const OUT_DIR = '/Users/admin/blender/dalat_cloud_hunting/tools/dalat-game-qa-mcp/screenshots';

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const consoleErrors: string[] = [];

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'],
  });

  try {
    const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    const pageA = await contextA.newPage();
    pageA.on('pageerror', (err) => consoleErrors.push(`PageA error: ${err.message}`));
    pageA.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`PageA console.error: ${msg.text()}`);
    });

    console.log('[QA] 1. Opening Client A at', BASE_URL);
    await pageA.goto(BASE_URL, { waitUntil: 'networkidle' });
    await pageA.waitForFunction(() => Boolean((window as any).__DALAT_QA__), { timeout: 15000 });
    await pageA.waitForTimeout(1200);

    // Set golden sunrise for entry preview screenshot
    await pageA.evaluate(() => (window as any).__DALAT_QA__.setWorldAtmosphere(5.38, 'golden_cloud_sea'));
    await pageA.waitForTimeout(700);
    await pageA.screenshot({ path: join(OUT_DIR, '01_landing_entry_screen.png') });

    // Enter world on Client A
    await pageA.evaluate(() => (window as any).__DALAT_QA__.triggerInteraction('enter_world'));
    await pageA.waitForTimeout(1500);

    const sceneA1 = await pageA.evaluate(() => (window as any).__DALAT_QA__.inspectScene());
    const roomCode = String(sceneA1.roomCode || 'MAY-01');
    console.log('[QA] Client A connected to roomCode:', roomCode, 'connected:', sceneA1.connected);

    // 2. Open Client B via Friend Deep-Link (?room=<roomCode>)!
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const pageB = await contextB.newPage();
    pageB.on('pageerror', (err) => consoleErrors.push(`PageB error: ${err.message}`));
    const inviteUrl = `${BASE_URL}/?room=${encodeURIComponent(roomCode)}`;
    console.log('[QA] 2. Opening Client B via Friend Invite Link:', inviteUrl);
    await pageB.goto(inviteUrl, { waitUntil: 'networkidle' });
    await pageB.waitForFunction(() => Boolean((window as any).__DALAT_QA__), { timeout: 15000 });
    await pageB.evaluate(() => (window as any).__DALAT_QA__.triggerInteraction('enter_world'));
    await pageB.waitForTimeout(1600);

    // Move Client B right onto Cầu Gỗ Săn Mây so Client A sees Client B standing admiring sunrise!
    await pageB.evaluate(() => {
      (window as any).__DALAT_QA__.teleportPlayer({ position: [91.5, 198.25, -73.8], lookAt: [260, 165, -75] });
      (window as any).__DALAT_QA__.triggerInteraction('pour_soy_milk');
      (window as any).__DALAT_QA__.triggerInteraction('send_chat', {
        text: 'Biển mây Cầu Đất sáng nay đẹp mê hồn luôn!',
      });
    });

    // 3. Collision BVH Verification across all landmarks & trails
    const collisionReport = await pageA.evaluate(() => (window as any).__DALAT_QA__.inspectCollision({ sampleStep: 5 }));
    console.log('[QA] 3. Collision BVH Audit:', JSON.stringify(collisionReport));

    // 4. Screenshot Tour across Landmarks & Time-of-Day
    // 4A. Tiệm Cà Phê Gỗ Mơ Sương at Pre-Dawn / Early Dawn
    await pageA.evaluate(() => {
      (window as any).__DALAT_QA__.setWorldAtmosphere(5.05, 'golden_cloud_sea');
      (window as any).__DALAT_QA__.teleportPlayer({ landmarkId: 'quan-mo-suong' });
      (window as any).__DALAT_QA__.triggerInteraction('brew_coffee');
    });
    await pageA.waitForTimeout(900);
    await pageA.screenshot({ path: join(OUT_DIR, '02_cafe_mo_suong_dawn.png') });

    // 4B. Đài Ngắm Thung Lũng Đèn 2,700K at 04:42 AM Pre-Dawn!
    await pageA.evaluate(() => {
      (window as any).__DALAT_QA__.setWorldAtmosphere(4.7, 'golden_cloud_sea');
      (window as any).__DALAT_QA__.teleportPlayer({ landmarkId: 'dai-ngam-den' });
    });
    await pageA.waitForTimeout(900);
    await pageA.screenshot({ path: join(OUT_DIR, '03_thung_lung_den_2700k_predawn.png') });

    // 4C. Cầu Gỗ Săn Mây Cầu Đất & 5 Wind Turbines at Peak Golden Sunrise (05:32 AM) with Client B + Peers!
    await pageA.evaluate(() => {
      (window as any).__DALAT_QA__.setWorldAtmosphere(5.52, 'golden_cloud_sea');
      (window as any).__DALAT_QA__.teleportPlayer({ position: [86.5, 198.1, -75.2], lookAt: [250, 175, -75] });
    });
    await pageB.evaluate(() => {
      (window as any).__DALAT_QA__.triggerInteraction('send_chat', {
        text: 'Mặt trời lên ngay giữa cánh quạt điện gió kìa! Chụp chung tấm Polaroid nhé!',
      });
    });
    await pageA.waitForTimeout(1000);
    await pageA.screenshot({ path: join(OUT_DIR, '04_cau_go_golden_sunrise_multiplayer.png') });

    // 4D. Measure Live FPS & Performance Budget at Peak Crowd + Cloud Sea Viewpoint!
    const fpsReport = await pageA.evaluate(() => (window as any).__DALAT_QA__.measureFps(2200));
    console.log('[QA] 4. Performance Metrics on Cầu Gỗ Sunrise:', JSON.stringify(fpsReport));

    // 4E. Đồi Thông Cô Đơn & Langbiang 2,167m North Vista!
    await pageA.evaluate(() => {
      (window as any).__DALAT_QA__.setWorldAtmosphere(5.85, 'golden_cloud_sea');
      (window as any).__DALAT_QA__.teleportPlayer({ landmarkId: 'cay-thong-co-don' });
    });
    await pageA.waitForTimeout(850);
    await pageA.screenshot({ path: join(OUT_DIR, '05_cay_thong_co_don_langbiang.png') });

    // 4F. Analog Film Camera Photo Mode & Polaroid Capture!
    await pageA.evaluate(() => {
      (window as any).__DALAT_QA__.setWorldAtmosphere(5.52, 'golden_cloud_sea');
      (window as any).__DALAT_QA__.teleportPlayer({ position: [87.0, 198.1, -75.0], lookAt: [250, 175, -75] });
      (window as any).__DALAT_QA__.triggerInteraction('open_photo_mode');
    });
    await pageA.waitForTimeout(600);
    await pageA.screenshot({ path: join(OUT_DIR, '06_film_camera_viewfinder.png') });

    await pageA.evaluate(() => (window as any).__DALAT_QA__.triggerInteraction('snap_polaroid'));
    await pageA.waitForTimeout(900);
    await pageA.screenshot({ path: join(OUT_DIR, '07_polaroid_captured_result.png') });

    const sceneB = await pageB.evaluate(() => (window as any).__DALAT_QA__.inspectScene());

    const report = {
      timestamp: new Date().toISOString(),
      multiplayerSync: {
        clientARoom: roomCode,
        clientBRoom: sceneB.roomCode,
        sameInstanceJoinedViaUrl: roomCode === sceneB.roomCode,
        clientAPeerCount: fpsReport.peerCount,
        clientBPeerCount: sceneB.peerCount,
        rttMs: fpsReport.rttMs,
      },
      collisionAudit: collisionReport,
      performanceAudit: fpsReport,
      consoleErrors,
    };

    const reportPath = join(OUT_DIR, 'qa_report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log('[QA] Completed Golden Sunrise Playtest! Report saved to', reportPath);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[QA Runner Fatal]', err);
  process.exit(1);
});

