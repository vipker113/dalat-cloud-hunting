import type { AcousticJamNote, SurfaceType } from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';

/**
 * True acoustic guitar chord voicings (Hz) matching the 6 DiegeticHUD / interactions.ts labels:
 * 0: Cadd9, 1: G6, 2: Em7, 3: Dsus4, 4: Am7, 5: Bm7
 */
export const GUITAR_CHORDS: ReadonlyArray<readonly number[]> = [
  [130.81, 164.81, 196.0, 293.66, 392.0], // 0: Cadd9
  [98.0, 123.47, 146.83, 196.0, 246.94, 329.63], // 1: G6
  [82.41, 123.47, 164.81, 196.0, 293.66, 392.0], // 2: Em7
  [146.83, 220.0, 293.66, 392.0], // 3: Dsus4
  [110.0, 164.81, 196.0, 261.63, 329.63], // 4: Am7
  [123.47, 185.0, 220.0, 293.66, 369.99], // 5: Bm7
] as const;

export interface WebAudioEngine {
  ctx: AudioContext;
  masterGain: GainNode;
  pinkBuffer: AudioBuffer;
  windGain: GainNode;
  windBandpass: BiquadFilterNode;
  drizzleGain: GainNode;
  fireBedGain: GainNode;
  cubEngineOsc: OscillatorNode;
  cubSubOsc: OscillatorNode;
  cubFilter: BiquadFilterNode;
  cubGain: GainNode;
  activeTransientSources: Set<AudioScheduledSourceNode>;
}

let registeredAudioEngine: WebAudioEngine | null = null;

export function registerHighlandAudioEngine(engine: WebAudioEngine | null): void {
  registeredAudioEngine = engine;
}

export function trackTransientSource(
  engine: WebAudioEngine,
  node: AudioScheduledSourceNode
): void {
  engine.activeTransientSources.add(node);
  node.onended = () => {
    node.onended = null;
    engine.activeTransientSources.delete(node);
    try {
      node.disconnect();
    } catch {
      // ignore already-disconnected transient source
    }
  };
}

export function stopAllTransientSources(engine: WebAudioEngine): void {
  for (const src of engine.activeTransientSources) {
    try {
      src.stop();
    } catch {
      // ignore already-stopped scheduled sources
    }
  }
  engine.activeTransientSources.clear();
}

/**
 * Synthesizes a multi-string acoustic guitar strum, bamboo wind-chime, or woody cajon tap
 * using the true GUITAR_CHORDS voicings.
 */
export function playHighlandJamChord(
  engine: WebAudioEngine,
  jam: Pick<AcousticJamNote, 'chordIndex' | 'instrument'>,
  attenuation: number
): void {
  const { ctx, pinkBuffer, masterGain } = engine;
  if (ctx.state !== 'running' || attenuation <= 0.015) return;

  const safeIdx =
    ((Math.round(jam.chordIndex) % GUITAR_CHORDS.length) + GUITAR_CHORDS.length) %
    GUITAR_CHORDS.length;
  const chord = GUITAR_CHORDS[safeIdx];
  const now = ctx.currentTime + 0.015;

  if (jam.instrument === 'cajon') {
    const kickOsc = ctx.createOscillator();
    const kickGain = ctx.createGain();
    kickOsc.type = 'sine';
    kickOsc.frequency.setValueAtTime(132, now);
    kickOsc.frequency.exponentialRampToValueAtTime(54, now + 0.14);
    kickGain.gain.setValueAtTime(0.24 * attenuation, now);
    kickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    kickOsc.connect(kickGain);
    kickGain.connect(masterGain);
    trackTransientSource(engine, kickOsc);
    kickOsc.start(now);
    kickOsc.stop(now + 0.24);

    const snareSrc = ctx.createBufferSource();
    snareSrc.buffer = pinkBuffer;
    const snareBp = ctx.createBiquadFilter();
    snareBp.type = 'highpass';
    snareBp.frequency.setValueAtTime(1400, now);
    const snareGain = ctx.createGain();
    snareGain.gain.setValueAtTime(0.11 * attenuation, now + 0.005);
    snareGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
    snareSrc.connect(snareBp);
    snareBp.connect(snareGain);
    snareGain.connect(masterGain);
    trackTransientSource(engine, snareSrc);
    snareSrc.start(now, Math.random() * 3.0, 0.1);
    return;
  }

  if (jam.instrument === 'chime') {
    const noteCount = Math.min(chord.length, 5);
    for (let i = 0; i < noteCount; i++) {
      const t0 = now + i * 0.042;
      const freq = chord[i] * 2.0;
      const oscFund = ctx.createOscillator();
      const oscOvertone = ctx.createOscillator();
      const env = ctx.createGain();

      oscFund.type = 'sine';
      oscFund.frequency.setValueAtTime(freq, t0);
      oscOvertone.type = 'triangle';
      oscOvertone.frequency.setValueAtTime(freq * 2.756, t0);

      const overtoneGain = ctx.createGain();
      overtoneGain.gain.setValueAtTime(0.22, t0);

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.072 * attenuation, t0 + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.1);

      oscFund.connect(env);
      oscOvertone.connect(overtoneGain);
      overtoneGain.connect(env);
      env.connect(masterGain);

      trackTransientSource(engine, oscFund);
      trackTransientSource(engine, oscOvertone);
      oscFund.start(t0);
      oscOvertone.start(t0);
      oscFund.stop(t0 + 2.15);
      oscOvertone.stop(t0 + 2.15);
    }
    return;
  }

  // Warm multi-string acoustic guitar chord strum across all strings in the voicing
  const bodyFilter = ctx.createBiquadFilter();
  bodyFilter.type = 'lowpass';
  bodyFilter.frequency.setValueAtTime(2650, now);
  bodyFilter.frequency.exponentialRampToValueAtTime(760, now + 1.9);
  bodyFilter.Q.setValueAtTime(1.15, now);
  bodyFilter.connect(masterGain);

  const perStringGain = (0.34 / Math.max(4, chord.length)) * attenuation;
  for (let i = 0; i < chord.length; i++) {
    const t0 = now + i * 0.024; // Gentle thumb-brush arpeggio stagger
    const freq = chord[i];
    const dur = Math.max(1.45, 2.25 - i * 0.09);

    const oscBody = ctx.createOscillator();
    const oscPluck = ctx.createOscillator();
    const pluckSubGain = ctx.createGain();
    const stringEnv = ctx.createGain();

    oscBody.type = 'triangle';
    oscBody.frequency.setValueAtTime(freq, t0);

    oscPluck.type = 'sawtooth';
    oscPluck.frequency.setValueAtTime(freq * 1.0014, t0);
    pluckSubGain.gain.setValueAtTime(0.3, t0);
    pluckSubGain.gain.exponentialRampToValueAtTime(0.02, t0 + 0.24);

    stringEnv.gain.setValueAtTime(0.0001, t0);
    stringEnv.gain.linearRampToValueAtTime(Math.max(0.0002, perStringGain), t0 + 0.009);
    stringEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    oscBody.connect(stringEnv);
    oscPluck.connect(pluckSubGain);
    pluckSubGain.connect(stringEnv);
    stringEnv.connect(bodyFilter);

    trackTransientSource(engine, oscBody);
    trackTransientSource(engine, oscPluck);
    oscBody.start(t0);
    oscPluck.start(t0);
    oscBody.stop(t0 + dur + 0.04);
    oscPluck.stop(t0 + dur + 0.04);
  }
}

/**
 * Soft tactile footstep / jump-landing thud modulated by Da Lat surface material
 * (wooden pier/veranda planks, red-basalt trail, or soft pine-needle grass).
 */
export function playLandingFootstep(surface: SurfaceType = 'pine_grass'): void {
  const engine = registeredAudioEngine;
  if (!engine) return;
  const st = useGameStore.getState();
  if (!st.audioEnabled || st.masterVolume <= 0.001) return;
  if (typeof document !== 'undefined' && document.hidden) return;

  const { ctx, pinkBuffer, masterGain } = engine;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
  if (ctx.state !== 'running') return;

  const now = ctx.currentTime + 0.005;

  // 1. Soft low-end boot/plank thud
  const thudOsc = ctx.createOscillator();
  const thudGain = ctx.createGain();
  const isWood = surface === 'wood_deck';
  const isBasalt = surface === 'red_basalt_trail';

  thudOsc.type = isWood ? 'triangle' : 'sine';
  thudOsc.frequency.setValueAtTime(isWood ? 148 : isBasalt ? 116 : 96, now);
  thudOsc.frequency.exponentialRampToValueAtTime(isWood ? 58 : 44, now + 0.09);

  thudGain.gain.setValueAtTime(0.0001, now);
  thudGain.gain.linearRampToValueAtTime(isWood ? 0.11 : 0.075, now + 0.006);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

  thudOsc.connect(thudGain);
  thudGain.connect(masterGain);
  trackTransientSource(engine, thudOsc);
  thudOsc.start(now);
  thudOsc.stop(now + 0.12);

  // 2. Subtle gravel / pine-needle / plank scuff texture
  const scuffSrc = ctx.createBufferSource();
  scuffSrc.buffer = pinkBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(isWood ? 720 : isBasalt ? 1380 : 980, now);
  bp.Q.setValueAtTime(1.6, now);

  const scuffGain = ctx.createGain();
  scuffGain.gain.setValueAtTime(0.0001, now);
  scuffGain.gain.linearRampToValueAtTime(isBasalt ? 0.048 : 0.034, now + 0.008);
  scuffGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.095);

  scuffSrc.connect(bp);
  bp.connect(scuffGain);
  scuffGain.connect(masterGain);
  trackTransientSource(engine, scuffSrc);
  scuffSrc.start(now, Math.random() * Math.max(0.2, pinkBuffer.duration - 0.25), 0.11);
}

const footPannerCache = new WeakMap<AudioContext, { left: AudioNode; right: AudioNode }>();

function getFootDestination(ctx: AudioContext, masterGain: GainNode, isLeftFoot: boolean): AudioNode {
  if (typeof ctx.createStereoPanner !== 'function') return masterGain;
  let pair = footPannerCache.get(ctx);
  if (!pair) {
    const left = ctx.createStereoPanner();
    left.pan.value = -0.11;
    left.connect(masterGain);
    const right = ctx.createStereoPanner();
    right.pan.value = 0.11;
    right.connect(masterGain);
    pair = { left, right };
    footPannerCache.set(ctx, pair);
  }
  return isLeftFoot ? pair.left : pair.right;
}

/**
 * Rhythmic, surface-accurate walking/running footstep synthesis:
 * - wood_deck: warm hollow highland cedar plank resonance
 * - red_basalt_trail: crisp damp laterite gravel crunch (+ rain sheen when wet)
 * - tea_terrace: cushioned loamy earth step
 * - pine_grass / pink_grass_meadow: soft dewy alpine grass & pine-needle brush
 */
export function playStrideFootstep(
  surface: SurfaceType = 'pine_grass',
  running = false,
  isLeftFoot = false,
  wetFactor = 0
): void {
  const engine = registeredAudioEngine;
  if (!engine) return;
  const st = useGameStore.getState();
  if (!st.audioEnabled || st.masterVolume <= 0.001) return;
  if (typeof document !== 'undefined' && document.hidden) return;

  const { ctx, pinkBuffer, masterGain } = engine;
  if (ctx.state !== 'running') return;

  const now = ctx.currentTime + 0.004;
  const jitter = 0.94 + Math.random() * 0.12;
  const footBias = isLeftFoot ? 0.97 : 1.03;
  const energy = running ? 1.38 : 0.85;
  const dest = getFootDestination(ctx, masterGain, isLeftFoot);

  const isWood = surface === 'wood_deck';
  const isBasalt = surface === 'red_basalt_trail';
  const isTea = surface === 'tea_terrace';

  // 1. Heel/sole body resonance
  const heelOsc = ctx.createOscillator();
  const heelGain = ctx.createGain();
  heelOsc.type = isWood ? 'triangle' : 'sine';
  const baseHz = (isWood ? 142 : isBasalt ? 108 : isTea ? 88 : 82) * jitter * footBias;
  heelOsc.frequency.setValueAtTime(baseHz, now);
  heelOsc.frequency.exponentialRampToValueAtTime(isWood ? 56 : 38, now + (isWood ? 0.075 : 0.06));

  const peakHeel = (isWood ? 0.056 : isBasalt ? 0.036 : 0.028) * energy;
  heelGain.gain.setValueAtTime(0.0001, now);
  heelGain.gain.linearRampToValueAtTime(peakHeel, now + 0.005);
  heelGain.gain.exponentialRampToValueAtTime(0.0001, now + (isWood ? 0.088 : 0.068));

  heelOsc.connect(heelGain);
  heelGain.connect(dest);
  trackTransientSource(engine, heelOsc);
  heelOsc.start(now);
  heelOsc.stop(now + 0.095);

  // 2. Material grain / brush / gravel crunch texture
  const texSrc = ctx.createBufferSource();
  texSrc.buffer = pinkBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  const centerHz =
    (isWood ? 690 : isBasalt ? 1580 : isTea ? 1120 : 920) * jitter * (wetFactor > 0.15 ? 1.18 : 1.0);
  bp.frequency.setValueAtTime(centerHz, now);
  bp.Q.setValueAtTime(isBasalt ? 1.35 : isWood ? 2.1 : 1.5, now);

  const texGain = ctx.createGain();
  const peakTex =
    (isBasalt ? 0.036 : isWood ? 0.018 : isTea ? 0.024 : 0.026) *
    energy *
    (1 + Math.min(0.4, wetFactor * 0.35));
  const texDur = isBasalt ? 0.085 : isWood ? 0.055 : 0.095;
  texGain.gain.setValueAtTime(0.0001, now);
  texGain.gain.linearRampToValueAtTime(peakTex, now + 0.009);
  texGain.gain.exponentialRampToValueAtTime(0.0001, now + texDur);

  texSrc.connect(bp);
  bp.connect(texGain);
  texGain.connect(dest);
  trackTransientSource(engine, texSrc);
  texSrc.start(now, Math.random() * Math.max(0.2, pinkBuffer.duration - 0.25), texDur + 0.02);
}

/**
 * Cheerful vintage Honda Super Cub 50 double-beep electric horn ("Bíp-bíp!").
 */
export function playScooterHorn(attenuation = 1): void {
  const engine = registeredAudioEngine;
  if (!engine) return;
  const st = useGameStore.getState();
  if (!st.audioEnabled || st.quietMode || st.masterVolume <= 0.001) return;
  if (typeof document !== 'undefined' && document.hidden) return;

  const { ctx, masterGain } = engine;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
  if (ctx.state !== 'running') return;

  const att = Math.max(0.05, Math.min(1, attenuation));
  const now = ctx.currentTime + 0.008;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1080, now);
  bp.Q.setValueAtTime(1.8, now);
  bp.connect(masterGain);

  for (let b = 0; b < 2; b++) {
    const t0 = now + b * 0.125;
    const dur = b === 0 ? 0.082 : 0.105;

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const env = ctx.createGain();

    oscA.type = 'sawtooth';
    oscA.frequency.setValueAtTime(488, t0);
    oscB.type = 'triangle';
    oscB.frequency.setValueAtTime(612, t0);

    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(0.095 * att, t0 + 0.008);
    env.gain.setValueAtTime(0.088 * att, t0 + dur - 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    oscA.connect(env);
    oscB.connect(env);
    env.connect(bp);

    trackTransientSource(engine, oscA);
    trackTransientSource(engine, oscB);
    oscA.start(t0);
    oscB.start(t0);
    oscA.stop(t0 + dur + 0.015);
    oscB.stop(t0 + dur + 0.015);
  }
}

/**
 * Tactile metallic kickstand spring clack on scooter mount / dismount.
 */
export function playKickstandClack(): void {
  const engine = registeredAudioEngine;
  if (!engine) return;
  const st = useGameStore.getState();
  if (!st.audioEnabled || st.masterVolume <= 0.001) return;
  if (typeof document !== 'undefined' && document.hidden) return;

  const { ctx, masterGain } = engine;
  if (ctx.state !== 'running') return;

  const now = ctx.currentTime + 0.005;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(840, now);
  osc.frequency.exponentialRampToValueAtTime(220, now + 0.048);

  env.gain.setValueAtTime(0.0001, now);
  env.gain.linearRampToValueAtTime(0.075, now + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

  osc.connect(env);
  env.connect(masterGain);
  trackTransientSource(engine, osc);
  osc.start(now);
  osc.stop(now + 0.065);
}

/**
 * Dual-shock suspension compression thump + gravel crunch when landing a Super Cub jump.
 */
export function playScooterLandingThump(impact: number): void {
  const engine = registeredAudioEngine;
  if (!engine || impact <= 0.08) return;
  const st = useGameStore.getState();
  if (!st.audioEnabled || st.masterVolume <= 0.001) return;
  if (typeof document !== 'undefined' && document.hidden) return;

  const { ctx, pinkBuffer, masterGain } = engine;
  if (ctx.state !== 'running') return;

  const amp = Math.min(1, Math.max(0.15, impact));
  const now = ctx.currentTime + 0.004;

  const thud = ctx.createOscillator();
  const thudEnv = ctx.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(118 + amp * 28, now);
  thud.frequency.exponentialRampToValueAtTime(36, now + 0.14);

  thudEnv.gain.setValueAtTime(0.0001, now);
  thudEnv.gain.linearRampToValueAtTime(0.16 * amp, now + 0.007);
  thudEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

  thud.connect(thudEnv);
  thudEnv.connect(masterGain);
  trackTransientSource(engine, thud);
  thud.start(now);
  thud.stop(now + 0.17);

  const crunch = ctx.createBufferSource();
  crunch.buffer = pinkBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1240, now);
  bp.Q.setValueAtTime(1.4, now);
  const cEnv = ctx.createGain();
  cEnv.gain.setValueAtTime(0.0001, now);
  cEnv.gain.linearRampToValueAtTime(0.065 * amp, now + 0.01);
  cEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);

  crunch.connect(bp);
  bp.connect(cEnv);
  cEnv.connect(masterGain);
  trackTransientSource(engine, crunch);
  crunch.start(now, Math.random() * Math.max(0.2, pinkBuffer.duration - 0.25), 0.14);
}
