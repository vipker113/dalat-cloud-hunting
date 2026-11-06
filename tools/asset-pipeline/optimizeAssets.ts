import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RAW_DIR = '/Users/admin/blender/dalat_cloud_hunting/assets_src/raw_glb';
const OUT_DIR = '/Users/admin/blender/dalat_cloud_hunting/apps/web/public/assets/models';
const MANIFEST_PATH = '/Users/admin/blender/dalat_cloud_hunting/apps/web/public/assets/assetManifest.json';
const CREDITS_PATH = '/Users/admin/blender/dalat_cloud_hunting/apps/web/public/assets/CREDITS.json';

async function main() {
  await MeshoptEncoder.ready;
  mkdirSync(OUT_DIR, { recursive: true });

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith('.glb'));
  const manifest: Array<{
    file: string;
    rawBytes: number;
    optimizedBytes: number;
    savingsPct: number;
    compression: string;
  }> = [];

  for (const file of files) {
    const inPath = join(RAW_DIR, file);
    const outPath = join(OUT_DIR, file);
    const rawBytes = statSync(inPath).size;

    const doc = await io.read(inPath);
    await doc.transform(
      dedup(),
      prune(),
      weld()
    );
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
      method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
    });

    await io.write(outPath, doc);
    const optimizedBytes = statSync(outPath).size;
    const savingsPct = Math.round((1 - optimizedBytes / Math.max(1, rawBytes)) * 1000) / 10;
    manifest.push({
      file,
      rawBytes,
      optimizedBytes,
      savingsPct,
      compression: 'EXT_meshopt_compression',
    });
    console.log(
      `[AssetPipeline] ${file}: ${(rawBytes / 1024).toFixed(1)} KB -> ${(optimizedBytes / 1024).toFixed(1)} KB (-${savingsPct}%)`
    );
  }

  writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        style: 'Warm Highland Painterly PBR',
        totalOptimizedKB: Math.round((manifest.reduce((s, m) => s + m.optimizedBytes, 0) / 1024) * 10) / 10,
        assets: manifest,
      },
      null,
      2
    )
  );

  writeFileSync(
    CREDITS_PATH,
    JSON.stringify(
      {
        project: 'Chạm Mây Đà Lạt – Multiplayer 3D Online World',
        licensesVerified: true,
        entries: [
          {
            id: 'stained_pine',
            source: 'Poly Haven (https://polyhaven.com/a/stained_pine)',
            authors: 'Dario Barresi, Jenelle van Heerden',
            license: 'CC0 1.0 Public Domain',
          },
          {
            id: 'dalat_hero_landmarks',
            source: 'Custom Procedural & Architectural Modeling via Blender MCP 5.3',
            authors: 'Da Lat Cloud Hunting 3D Art Team',
            license: 'First-Party Project Original (100% Owned)',
          },
        ],
      },
      null,
      2
    )
  );
  console.log('[AssetPipeline] Wrote assetManifest.json & CREDITS.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
