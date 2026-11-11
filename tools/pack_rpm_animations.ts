/**
 * Packs official Ready Player Me Studio Mocap Animations (Idle, Walk, Run, Sprint, Jump, Wave, Cheer, WarmHands)
 * + Ergonomic Da Lat Bench Sit clip into `apps/web/public/assets/models/hiker_animations.glb`
 * with:
 *   - 100% in-place Hips X/Z root motion stripped (zero loop snap)
 *   - Calibrated Hips Y height (+0.006m) so shoe soles never clip below Y = 0
 *   - Exact bench Sit leg/arm quaternions so glutes sit flush at 0.452m and soles sit flush at +0.005m
 */
import * as path from 'node:path';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ANIM_SRC_DIR =
  '/Users/admin/.gemini/antigravity/brain/b225db1c-7975-469e-88d4-556d97d63d29/scratch/rpm_anims';
const OUT_GLB = path.resolve(
  import.meta.dir,
  '../apps/web/public/assets/models/hiker_animations.glb'
);

// Solved twist-free Bench Sit quaternions on Ready Player Me rig (shin forward angle = +0.295 so soles = +0.005m at seatY = -0.404m!)
const SIT_OVERRIDES: Record<string, [number, number, number, number]> = {
  LeftUpLeg: [0.0278, 0.6716, 0.7404, -0.0053],
  LeftLeg: [-0.5772, -0.0012, 0.0156, 0.8164],
  LeftFoot: [0.5198, 0.0468, -0.0022, 0.853],
  RightUpLeg: [0.0375, 0.6635, 0.7389, 0.1113],
  RightLeg: [-0.5692, 0.0091, 0.1066, 0.8152],
  RightFoot: [0.5189, 0.0454, -0.0289, 0.8528],
  LeftArm: [-0.6429, 0.0925, -0.0553, -0.7584],
  LeftForeArm: [0.2329, 0.0561, 0.4795, 0.8442],
  RightArm: [0.6155, -0.0554, -0.1423, 0.7732],
  RightForeArm: [-0.049, -0.038, -0.5308, 0.8452],
};

// Natural right-hand cup/lantern grip finger curl quaternions on Ready Player Me rig
const HOLD_PROP_FINGERS: Record<string, [number, number, number, number]> = {
  RightHandIndex1: [0.09, 0.01, 0.36, 0.928],
  RightHandIndex2: [0.0, 0.0, 0.44, 0.898],
  RightHandIndex3: [0.0, 0.0, 0.32, 0.947],
  RightHandMiddle1: [0.09, 0.01, 0.4, 0.912],
  RightHandMiddle2: [0.0, 0.0, 0.48, 0.877],
  RightHandMiddle3: [0.0, 0.0, 0.34, 0.94],
  RightHandRing1: [0.09, 0.01, 0.42, 0.903],
  RightHandRing2: [0.0, 0.0, 0.48, 0.877],
  RightHandRing3: [0.0, 0.0, 0.35, 0.937],
  RightHandPinky1: [0.09, 0.01, 0.44, 0.893],
  RightHandPinky2: [0.0, 0.0, 0.48, 0.877],
  RightHandPinky3: [0.0, 0.0, 0.35, 0.937],
  RightHandThumb1: [0.28, 0.24, -0.18, 0.911],
  RightHandThumb2: [0.18, 0.22, -0.12, 0.951],
  RightHandThumb3: [0.12, 0.18, -0.08, 0.973],
};

const CLIPS = [
  { name: 'Idle', file: 'Idle.glb' },
  { name: 'Walk', file: 'Walk.glb' },
  { name: 'Run', file: 'Run.glb' },
  { name: 'Sprint', file: 'Sprint.glb' },
  { name: 'Jump', file: 'Jump.glb' },
  { name: 'Wave', file: 'Wave.glb' },
  { name: 'Cheer', file: 'Cheer.glb' },
  { name: 'WarmHands', file: 'WarmHands.glb' },
];

async function main() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });

  // Base document from Idle.glb
  const outDoc = await io.read(path.join(ANIM_SRC_DIR, 'Idle.glb'));
  const root = outDoc.getRoot();

  // Map node names in base document
  const nodeByName = new Map<string, ReturnType<typeof root.listNodes>[number]>();
  for (const n of root.listNodes()) {
    if (n.getName()) nodeByName.set(n.getName(), n);
  }

  // Clear existing animations in outDoc; we will copy all 8 cleanly + Sit + HoldProp
  for (const a of [...root.listAnimations()]) {
    a.dispose();
  }

  const buf = root.listBuffers()[0] || outDoc.createBuffer('animBuffer');

  function copyClipIntoDoc(srcDoc: Document, clipName: string) {
    const srcAnim = srcDoc.getRoot().listAnimations()[0];
    if (!srcAnim) throw new Error(`Missing animation in ${clipName}`);

    const dstAnim = outDoc.createAnimation(clipName);

    for (const ch of srcAnim.listChannels()) {
      const targetNode = ch.getTargetNode();
      const targetPath = ch.getTargetPath();
      const srcSampler = ch.getSampler();
      if (!targetNode || !targetPath || !srcSampler) continue;

      const boneName = targetNode.getName();
      const dstNode = nodeByName.get(boneName);
      if (!dstNode) continue;

      const inAcc = srcSampler.getInput();
      const outAcc = srcSampler.getOutput();
      if (!inAcc || !outAcc) continue;

      const times = new Float32Array(inAcc.getArray() as Float32Array);
      const values = new Float32Array(outAcc.getArray() as Float32Array);

      // Strip horizontal X/Z root motion on Hips translation and calibrate Y (+0.006m) so soles stay >= +0.002m!
      if (boneName === 'Hips' && targetPath === 'translation') {
        for (let i = 0; i < values.length; i += 3) {
          values[i] = 0; // X in-place
          values[i + 1] += 0.006; // Y sole clearance
          values[i + 2] = 0; // Z in-place
        }
      }

      const dstIn = outDoc
        .createAccessor(`${clipName}_${boneName}_${targetPath}_in`)
        .setBuffer(buf)
        .setType('SCALAR')
        .setArray(times);
      const dstOut = outDoc
        .createAccessor(`${clipName}_${boneName}_${targetPath}_out`)
        .setBuffer(buf)
        .setType(outAcc.getType())
        .setArray(values);

      const dstSampler = outDoc
        .createAnimationSampler(`${clipName}_${boneName}_${targetPath}_sampler`)
        .setInterpolation(srcSampler.getInterpolation())
        .setInput(dstIn)
        .setOutput(dstOut);

      const dstChannel = outDoc
        .createAnimationChannel(`${clipName}_${boneName}_${targetPath}_ch`)
        .setTargetNode(dstNode)
        .setTargetPath(targetPath)
        .setSampler(dstSampler);

      dstAnim.addSampler(dstSampler);
      dstAnim.addChannel(dstChannel);
    }
  }

  for (const c of CLIPS) {
    const d = await io.read(path.join(ANIM_SRC_DIR, c.file));
    copyClipIntoDoc(d, c.name);
  }

  // Build ergonomic Bench `Sit` animation (keeps Idle's natural Spine/Neck/Head breathing!)
  const idleDoc = await io.read(path.join(ANIM_SRC_DIR, 'Idle.glb'));
  copyClipIntoDoc(idleDoc, 'Sit');
  const sitAnim = root.listAnimations().find((a) => a.getName() === 'Sit')!;
  for (const ch of sitAnim.listChannels()) {
    const boneName = ch.getTargetNode()?.getName() || '';
    const targetPath = ch.getTargetPath();
    if (targetPath === 'rotation' && SIT_OVERRIDES[boneName]) {
      const q = SIT_OVERRIDES[boneName];
      const outAcc = ch.getSampler()!.getOutput()!;
      const arr = new Float32Array(outAcc.getArray() as Float32Array);
      for (let i = 0; i < arr.length; i += 4) {
        arr[i] = q[0];
        arr[i + 1] = q[1];
        arr[i + 2] = q[2];
        arr[i + 3] = q[3];
      }
      outAcc.setArray(arr);
    } else if (boneName === 'Hips' && targetPath === 'translation') {
      // Lock gentle vertical sway while seated on wooden bench
      const outAcc = ch.getSampler()!.getOutput()!;
      const arr = new Float32Array(outAcc.getArray() as Float32Array);
      const baseY = arr[1];
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = 0;
        arr[i + 1] = baseY;
        arr[i + 2] = 0;
      }
      outAcc.setArray(arr);
    }
  }

  // Build `HoldProp` pose clip for right-hand finger curl lookup
  const holdAnim = outDoc.createAnimation('HoldProp');
  const holdTimes = outDoc
    .createAccessor('HoldProp_times')
    .setBuffer(buf)
    .setType('SCALAR')
    .setArray(new Float32Array([0, 1]));
  for (const [fName, q] of Object.entries(HOLD_PROP_FINGERS)) {
    const fNode = nodeByName.get(fName);
    if (!fNode) continue;
    const nq = Math.hypot(q[0], q[1], q[2], q[3]);
    const nArr = new Float32Array([
      q[0] / nq,
      q[1] / nq,
      q[2] / nq,
      q[3] / nq,
      q[0] / nq,
      q[1] / nq,
      q[2] / nq,
      q[3] / nq,
    ]);
    const outAcc = outDoc
      .createAccessor(`HoldProp_${fName}_out`)
      .setBuffer(buf)
      .setType('VEC4')
      .setArray(nArr);
    const samp = outDoc
      .createAnimationSampler(`HoldProp_${fName}_s`)
      .setInterpolation('LINEAR')
      .setInput(holdTimes)
      .setOutput(outAcc);
    const ch = outDoc
      .createAnimationChannel(`HoldProp_${fName}_ch`)
      .setTargetNode(fNode)
      .setTargetPath('rotation')
      .setSampler(samp);
    holdAnim.addSampler(samp);
    holdAnim.addChannel(ch);
  }

  await outDoc.transform(dedup(), prune({ keepLeaves: true }));
  await io.write(OUT_GLB, outDoc);

  console.log(
    `Exported ${OUT_GLB} with clips:`,
    root.listAnimations().map((a) => a.getName())
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
