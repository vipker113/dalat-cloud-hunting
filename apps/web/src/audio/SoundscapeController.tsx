import { useEffect, useRef } from 'react';
import { AcousticJamNote } from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';

const CAMPFIRE_POS: readonly [number, number, number] = [-53, 135, 24];

// 6-chord Da Lat major-pentatonic / warm highland acoustic progression:
// 0: Fmaj7, 1: G6, 2: Em7, 3: Am9, 4: Dm7, 5: G13
const DALAT_ACOUSTIC_CHORDS: ReadonlyArray<readonly [number, number, number, number]> = [
  [87.31, 130.81, 220.0, 329.63], // Fmaj7 (F2 - C3 - A3 - E4)
  [98.0, 146.83, 246.94, 329.63], // G6    (G2 - D3 - B3 - E4)
  [82.41, 123.47, 196.0, 293.66], // Em7   (E2 - B2 - G3 - D4)
  [110.0, 164.81, 261.63, 493.88], // Am9   (A2 - E3 - C4 - B4)
  [146.83, 220.0, 261.63, 349.23], // Dm7   (D3 - A3 - C4 - F4)
  [98.0, 174.61, 246.94, 329.63], // G13   (G2 - F3 - B3 - E4)
];

// Singleton guard so even if mounted in both App and WorldRoot, only one audio graph runs
let activeSoundscapeOwner: symbol | null = null;

interface WebAudioEngine {
  ctx: AudioContext;
  masterGain: GainNode;
  pinkBuffer: AudioBuffer;
  windGain: GainNode;
  windBandpass: BiquadFilterNode;
  drizzleGain: GainNode;
  fireBedGain: GainNode;
}

/**
 * Generates a seamless 6-second Paul Kellet pink-noise buffer with smooth loop crossfade.
 */
function createSeamlessPinkNoiseBuffer(ctx: AudioContext, durationSec = 6.0): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * durationSec);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  const raw = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }

  // Seamless crossfade over last 0.25s so loop wrap has zero click
  const fadeSamples = Math.floor(sampleRate * 0.25);
  for (let i = 0; i < length; i++) {
    if (i < fadeSamples) {
      const u = i / fadeSamples;
      data[i] = raw[i] * u + raw[length - fadeSamples + i] * (1 - u);
    } else {
      data[i] = raw[i];
    }
  }

  return buffer;
}

function scheduleDawnBirdChirp(engine: WebAudioEngine, volumeScale: number): void {
  const { ctx, masterGain } = engine;
  if (ctx.state !== 'running') return;

  const now = ctx.currentTime + 0.03;
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime((Math.random() - 0.5) * 1.5, now);
  panner.connect(masterGain);

  const noteCount = 2 + Math.floor(Math.random() * 2); // 2 or 3 crystalline dawn notes
  const baseFreq = 1950 + Math.random() * 920;

  for (let n = 0; n < noteCount; n++) {
    const t0 = now + n * (0.14 + Math.random() * 0.05);
    const dur = 0.11 + Math.random() * 0.06;
    const fStart = baseFreq * (n % 2 === 0 ? 1.0 : 1.18);
    const fEnd = fStart * (0.92 + Math.random() * 0.24);

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(fStart, t0);
    osc.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);

    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(0.032 * volumeScale, t0 + 0.018);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(env);
    env.connect(panner);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
}

function scheduleCampfireCrackle(engine: WebAudioEngine, proximity: number): void {
  const { ctx, pinkBuffer, masterGain } = engine;
  if (ctx.state !== 'running' || proximity <= 0.02) return;

  const now = ctx.currentTime + 0.01;
  const dur = 0.014 + Math.random() * 0.022;

  const src = ctx.createBufferSource();
  src.buffer = pinkBuffer;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1650 + Math.random() * 2300, now);
  bp.Q.setValueAtTime(3.2, now);

  const env = ctx.createGain();
  const peak = (0.045 + Math.random() * 0.065) * proximity;
  env.gain.setValueAtTime(0.0001, now);
  env.gain.linearRampToValueAtTime(peak, now + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  src.connect(bp);
  bp.connect(env);
  env.connect(masterGain);

  const randomOffset = Math.random() * Math.max(0.1, pinkBuffer.duration - 0.1);
  src.start(now, randomOffset, dur + 0.01);
}

function playHighlandJamChord(
  engine: WebAudioEngine,
  jam: Pick<AcousticJamNote, 'chordIndex' | 'instrument'>,
  attenuation: number
): void {
  const { ctx, pinkBuffer, masterGain } = engine;
  if (ctx.state !== 'running' || attenuation <= 0.02) return;

  const safeIdx = ((Math.round(jam.chordIndex) % DALAT_ACOUSTIC_CHORDS.length) + DALAT_ACOUSTIC_CHORDS.length) %
    DALAT_ACOUSTIC_CHORDS.length;
  const chord = DALAT_ACOUSTIC_CHORDS[safeIdx];
  const now = ctx.currentTime + 0.015;

  if (jam.instrument === 'cajon') {
    // Warm woody Cajon bass + brush tap + soft sympathetic chord hum
    const kickOsc = ctx.createOscillator();
    const kickGain = ctx.createGain();
    kickOsc.type = 'sine';
    kickOsc.frequency.setValueAtTime(132, now);
    kickOsc.frequency.exponentialRampToValueAtTime(54, now + 0.14);
    kickGain.gain.setValueAtTime(0.24 * attenuation, now);
    kickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    kickOsc.connect(kickGain);
    kickGain.connect(masterGain);
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
    snareSrc.start(now, Math.random() * 3.0, 0.1);
    return;
  }

  if (jam.instrument === 'chime') {
    // Luminous highland bamboo / wind-chime chord
    for (let i = 0; i < 4; i++) {
      const t0 = now + i * 0.042;
      const freq = chord[i] * 2.0; // Octave up for crystalline bamboo/chime bell
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
      env.gain.linearRampToValueAtTime(0.075 * attenuation, t0 + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.1);

      oscFund.connect(env);
      oscOvertone.connect(overtoneGain);
      overtoneGain.connect(env);
      env.connect(masterGain);

      oscFund.start(t0);
      oscOvertone.start(t0);
      oscFund.stop(t0 + 2.15);
      oscOvertone.stop(t0 + 2.15);
    }
    return;
  }

  // Default: Warm 4-string nylon/acoustic guitar chord strum
  const bodyFilter = ctx.createBiquadFilter();
  bodyFilter.type = 'lowpass';
  bodyFilter.frequency.setValueAtTime(2550, now);
  bodyFilter.frequency.exponentialRampToValueAtTime(720, now + 1.85);
  bodyFilter.Q.setValueAtTime(1.15, now);
  bodyFilter.connect(masterGain);

  for (let i = 0; i < 4; i++) {
    const t0 = now + i * 0.028; // Gentle thumb-brush arpeggio stagger
    const freq = chord[i];
    const dur = 2.25 - i * 0.1;

    const oscBody = ctx.createOscillator();
    const oscPluck = ctx.createOscillator();
    const pluckSubGain = ctx.createGain();
    const stringEnv = ctx.createGain();

    oscBody.type = 'triangle';
    oscBody.frequency.setValueAtTime(freq, t0);

    oscPluck.type = 'sawtooth';
    oscPluck.frequency.setValueAtTime(freq * 1.0015, t0);
    pluckSubGain.gain.setValueAtTime(0.32, t0);
    pluckSubGain.gain.exponentialRampToValueAtTime(0.02, t0 + 0.24);

    stringEnv.gain.setValueAtTime(0.0001, t0);
    stringEnv.gain.linearRampToValueAtTime(0.088 * attenuation, t0 + 0.009);
    stringEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    oscBody.connect(stringEnv);
    oscPluck.connect(pluckSubGain);
    pluckSubGain.connect(stringEnv);
    stringEnv.connect(bodyFilter);

    oscBody.start(t0);
    oscPluck.start(t0);
    oscBody.stop(t0 + dur + 0.04);
    oscPluck.stop(t0 + dur + 0.04);
  }
}

export function SoundscapeController() {
  const lastJamNote = useGameStore((s) => s.lastJamNote);
  const audioEnabled = useGameStore((s) => s.audioEnabled);
  const masterVolume = useGameStore((s) => s.masterVolume);

  const engineRef = useRef<WebAudioEngine | null>(null);
  const ownerIdRef = useRef<symbol>(Symbol('DaLatSoundscapeController'));
  const seenJamTimestampRef = useRef<number>(
    useGameStore.getState().lastJamNote?.timestamp ?? 0
  );
  const lastManualJamMsRef = useRef<number>(0);

  // Lazily construct & unlock WebAudio engine on user gesture; tear down cleanly on unmount
  useEffect(() => {
    const owner = ownerIdRef.current;
    if (activeSoundscapeOwner && activeSoundscapeOwner !== owner) {
      return;
    }
    activeSoundscapeOwner = owner;

    const ensureAudioEngine = (): WebAudioEngine | null => {
      if (engineRef.current) {
        if (engineRef.current.ctx.state === 'suspended') {
          void engineRef.current.ctx.resume().catch(() => {});
        }
        return engineRef.current;
      }

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;

      const ctx = new AudioCtx();
      const st = useGameStore.getState();

      const masterGain = ctx.createGain();
      masterGain.gain.value = st.audioEnabled ? st.masterVolume : 0;
      masterGain.connect(ctx.destination);

      const pinkBuffer = createSeamlessPinkNoiseBuffer(ctx, 6.0);

      // 1. Highland Pine Wind loop
      const windSrc = ctx.createBufferSource();
      windSrc.buffer = pinkBuffer;
      windSrc.loop = true;

      const windBandpass = ctx.createBiquadFilter();
      windBandpass.type = 'bandpass';
      windBandpass.frequency.value = 540;
      windBandpass.Q.value = 1.45;

      const windGain = ctx.createGain();
      windGain.gain.value = 0.06;

      windSrc.connect(windBandpass);
      windBandpass.connect(windGain);
      windGain.connect(masterGain);
      windSrc.start();

      // 2. Highland Drizzle soft needle patter loop
      const drizzleSrc = ctx.createBufferSource();
      drizzleSrc.buffer = pinkBuffer;
      drizzleSrc.loop = true;

      const drizzleFilter = ctx.createBiquadFilter();
      drizzleFilter.type = 'highpass';
      drizzleFilter.frequency.value = 2100;

      const drizzleGain = ctx.createGain();
      drizzleGain.gain.value = 0.0;

      drizzleSrc.connect(drizzleFilter);
      drizzleFilter.connect(drizzleGain);
      drizzleGain.connect(masterGain);
      drizzleSrc.start(0, 1.7);

      // 3. Campfire warm hearth bed loop
      const fireSrc = ctx.createBufferSource();
      fireSrc.buffer = pinkBuffer;
      fireSrc.loop = true;

      const fireLowpass = ctx.createBiquadFilter();
      fireLowpass.type = 'lowpass';
      fireLowpass.frequency.value = 165;

      const fireBedGain = ctx.createGain();
      fireBedGain.gain.value = 0.0;

      fireSrc.connect(fireLowpass);
      fireLowpass.connect(fireBedGain);
      fireBedGain.connect(masterGain);
      fireSrc.start(0, 3.3);

      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }

      const created: WebAudioEngine = {
        ctx,
        masterGain,
        pinkBuffer,
        windGain,
        windBandpass,
        drizzleGain,
        fireBedGain,
      };
      engineRef.current = created;
      return created;
    };

    const onUserGesture = () => {
      ensureAudioEngine();
    };

    window.addEventListener('pointerdown', onUserGesture, { passive: true });
    window.addEventListener('keydown', onUserGesture, { passive: true });
    window.addEventListener('touchstart', onUserGesture, { passive: true });

    let nextBirdTimeMs = Date.now() + 2600;
    let nextAmbientChordMs = Date.now() + 5500;
    let ambientChordStep = 0;

    // Spatial & atmospheric modulation loop (10 Hz, zero GC churn)
    const timer = window.setInterval(() => {
      const eng = engineRef.current;
      if (!eng || eng.ctx.state !== 'running') return;

      const st = useGameStore.getState();
      const nowAudio = eng.ctx.currentTime;
      const nowMs = Date.now();

      // Master volume & mute
      const targetMaster = st.audioEnabled ? clamp01(st.masterVolume) : 0.0;
      eng.masterGain.gain.setTargetAtTime(targetMaster, nowAudio, 0.08);
      if (!st.audioEnabled || targetMaster <= 0.001) return;

      const atmo = st.atmosphere;
      const player = st.localTransient;

      // Altitude & windStrength modulated Highland Pine Wind
      const altFactor = clamp01((player.y - 75) / 125); // 0 in deep slope -> 1 on Cầu Gỗ summit
      const gustWave = 0.85 + 0.15 * Math.sin(nowMs * 0.0009) * Math.cos(nowMs * 0.00037);
      const targetWindCutoff = (360 + altFactor * 420 + atmo.windStrength * 260) * gustWave;
      const targetWindVol = (0.045 + altFactor * 0.055 + atmo.windStrength * 0.065) * gustWave;

      eng.windBandpass.frequency.setTargetAtTime(targetWindCutoff, nowAudio, 0.18);
      eng.windGain.gain.setTargetAtTime(targetWindVol, nowAudio, 0.18);

      // Soft drizzle whisper
      const targetDrizzleVol = atmo.drizzleIntensity > 0.05 ? atmo.drizzleIntensity * 0.065 : 0.0;
      eng.drizzleGain.gain.setTargetAtTime(targetDrizzleVol, nowAudio, 0.25);

      // Distance-attenuated Crackling Campfire & Warm Acoustic Guitar near [-53, 135, 24]
      const dx = player.x - CAMPFIRE_POS[0];
      const dy = player.y - CAMPFIRE_POS[1];
      const dz = player.z - CAMPFIRE_POS[2];
      const distFire = Math.hypot(dx, dy, dz);
      const fireProximity = Math.pow(clamp01(1.0 - distFire / 34.0), 1.85);

      eng.fireBedGain.gain.setTargetAtTime(fireProximity * 0.14, nowAudio, 0.15);

      if (fireProximity > 0.04 && Math.random() < 0.34 * fireProximity + 0.06) {
        scheduleCampfireCrackle(eng, fireProximity);
      }

      // Gentle ambient campfire acoustic chord if player lounges by the fire & nobody jammed recently
      if (
        fireProximity > 0.28 &&
        nowMs >= nextAmbientChordMs &&
        nowMs - lastManualJamMsRef.current > 9000
      ) {
        playHighlandJamChord(
          eng,
          { chordIndex: ambientChordStep % 6, instrument: 'guitar' },
          fireProximity * 0.42
        );
        ambientChordStep++;
        nextAmbientChordMs = nowMs + 6200 + Math.random() * 4200;
      }

      // Dawn Forest Birdsong chirps during gameHour in [5.1, 7.8]
      if (
        atmo.gameHour >= 5.1 &&
        atmo.gameHour <= 7.8 &&
        atmo.drizzleIntensity < 0.45 &&
        nowMs >= nextBirdTimeMs
      ) {
        const dawnBell =
          Math.sin(((atmo.gameHour - 5.1) / 2.7) * Math.PI) * 0.75 + 0.25;
        scheduleDawnBirdChirp(eng, dawnBell);
        nextBirdTimeMs = nowMs + 3100 + Math.random() * 4400;
      }
    }, 100);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', onUserGesture);
      window.removeEventListener('keydown', onUserGesture);
      window.removeEventListener('touchstart', onUserGesture);

      if (engineRef.current) {
        void engineRef.current.ctx.close().catch(() => {});
        engineRef.current = null;
      }
      if (activeSoundscapeOwner === owner) {
        activeSoundscapeOwner = null;
      }
    };
  }, []);

  // Immediate gain response when audioEnabled or masterVolume changes
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const target = audioEnabled ? clamp01(masterVolume) : 0.0;
    eng.masterGain.gain.setTargetAtTime(target, eng.ctx.currentTime, 0.05);
  }, [audioEnabled, masterVolume]);

  // Pluck lush warm 4-string acoustic guitar / bamboo chime / cajon whenever lastJamNote updates!
  useEffect(() => {
    if (!lastJamNote) return;
    if (lastJamNote.timestamp === seenJamTimestampRef.current) return;
    seenJamTimestampRef.current = lastJamNote.timestamp;
    lastManualJamMsRef.current = Date.now();

    const st = useGameStore.getState();
    if (!st.audioEnabled) return;

    const eng = engineRef.current;
    if (!eng) return;
    if (eng.ctx.state === 'suspended') {
      void eng.ctx.resume().catch(() => {});
    }

    const isLocalPlayer =
      Boolean(st.localSessionId) && lastJamNote.senderId === st.localSessionId;
    const p = st.localTransient;
    const dist = Math.hypot(
      p.x - CAMPFIRE_POS[0],
      p.y - CAMPFIRE_POS[1],
      p.z - CAMPFIRE_POS[2]
    );
    const spatialGain = isLocalPlayer
      ? 1.0
      : Math.max(0.18, Math.pow(clamp01(1.0 - dist / 55.0), 1.4));

    playHighlandJamChord(eng, lastJamNote, spatialGain);
  }, [lastJamNote]);

  return null;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
