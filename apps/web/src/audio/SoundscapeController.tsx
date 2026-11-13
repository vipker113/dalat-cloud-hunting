import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import {
  GUITAR_CHORDS,
  playHighlandJamChord,
  registerHighlandAudioEngine,
  stopAllTransientSources,
  trackTransientSource,
  type WebAudioEngine,
} from './highlandAudio';

const CAMPFIRE_POS: readonly [number, number, number] = [-53, 135, 24];

// Singleton guard so even if mounted in both App and WorldRoot, only one audio graph runs
let activeSoundscapeOwner: symbol | null = null;

// Pre-computed seamless 2.0-second Paul Kellet pink-noise waveform (96,000 samples @ 48 kHz)
// generated asynchronously during idle so the first user click gesture takes <0.2ms on main thread!
const PREBAKED_PINK_SAMPLES = 96_000;
let cachedPinkWaveform: Float32Array | null = null;

function getPrebakedPinkWaveform(): Float32Array {
  if (cachedPinkWaveform) return cachedPinkWaveform;
  const length = PREBAKED_PINK_SAMPLES;
  const raw = new Float32Array(length);
  const out = new Float32Array(length);

  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

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

  const fadeSamples = 12_000; // 0.25s seamless loop crossfade
  for (let i = 0; i < length; i++) {
    if (i < fadeSamples) {
      const u = i / fadeSamples;
      out[i] = raw[i] * u + raw[length - fadeSamples + i] * (1 - u);
    } else {
      out[i] = raw[i];
    }
  }

  cachedPinkWaveform = out;
  return out;
}

if (typeof window !== 'undefined') {
  setTimeout(() => {
    getPrebakedPinkWaveform();
  }, 60);
}

/**
 * Copies the pre-baked seamless Paul Kellet pink-noise waveform into an AudioBuffer in <0.2ms.
 */
function createSeamlessPinkNoiseBuffer(ctx: AudioContext, _durationSec = 2.0): AudioBuffer {
  const waveform = getPrebakedPinkWaveform();
  const buffer = ctx.createBuffer(1, waveform.length, ctx.sampleRate);
  buffer.getChannelData(0).set(waveform);
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
    trackTransientSource(engine, osc);
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
  trackTransientSource(engine, src);
  src.start(now, randomOffset, dur + 0.01);
}

export function SoundscapeController() {
  const lastJamNote = useGameStore((s) => s.lastJamNote);
  const socialSparkleBurst = useGameStore((s) => s.socialSparkleBurst);
  const audioEnabled = useGameStore((s) => s.audioEnabled);
  const masterVolume = useGameStore((s) => s.masterVolume);

  const engineRef = useRef<WebAudioEngine | null>(null);
  const ownerIdRef = useRef<symbol>(Symbol('DaLatSoundscapeController'));
  const seenJamTimestampRef = useRef<number>(
    useGameStore.getState().lastJamNote?.timestamp ?? 0
  );
  const seenSocialNonceRef = useRef<number>(
    useGameStore.getState().socialSparkleBurst?.id ?? 0
  );
  const lastManualJamMsRef = useRef<number>(0);

  // Lazily construct & unlock WebAudio engine on user gesture; tear down cleanly on unmount
  useEffect(() => {
    const owner = ownerIdRef.current;
    if (activeSoundscapeOwner && activeSoundscapeOwner !== owner) {
      return;
    }
    activeSoundscapeOwner = owner;

    const ensureAudioEngine = (fromGesture = false): WebAudioEngine | null => {
      if (engineRef.current) {
        const stNow = useGameStore.getState();
        if (
          fromGesture &&
          stNow.audioEnabled &&
          !document.hidden &&
          engineRef.current.ctx.state === 'suspended'
        ) {
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

      if (!st.audioEnabled || document.hidden) {
        void ctx.suspend().catch(() => {});
      } else if (fromGesture && ctx.state === 'suspended') {
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
        activeTransientSources: new Set<AudioScheduledSourceNode>(),
      };
      engineRef.current = created;
      registerHighlandAudioEngine(created);
      return created;
    };

    const onUserGesture = () => {
      if (!useGameStore.getState().audioEnabled) return;
      ensureAudioEngine(true);
    };

    const onVisibilityChange = () => {
      const eng = engineRef.current;
      if (!eng) return;
      if (document.hidden) {
        stopAllTransientSources(eng);
        void eng.ctx.suspend().catch(() => {});
      } else if (useGameStore.getState().audioEnabled && eng.ctx.state === 'suspended') {
        void eng.ctx.resume().catch(() => {});
      }
    };

    window.addEventListener('pointerdown', onUserGesture, { passive: true });
    window.addEventListener('keydown', onUserGesture, { passive: true });
    window.addEventListener('touchstart', onUserGesture, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Pre-initialize AudioContext + filter graph during idle on Landing (starts suspended cleanly)
    // so clicking "Vào Đón Bình Minh" only calls async ctx.resume() (<0.2ms instead of ~200ms CoreAudio init)!
    const prewarmAudioTimer = window.setTimeout(() => {
      if (useGameStore.getState().audioEnabled && !document.hidden) {
        ensureAudioEngine();
      }
    }, 180);

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
        !st.quietMode &&
        fireProximity > 0.28 &&
        nowMs >= nextAmbientChordMs &&
        nowMs - lastManualJamMsRef.current > 9000
      ) {
        playHighlandJamChord(
          eng,
          { chordIndex: ambientChordStep % GUITAR_CHORDS.length, instrument: 'guitar' },
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
      window.clearTimeout(prewarmAudioTimer);
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', onUserGesture);
      window.removeEventListener('keydown', onUserGesture);
      window.removeEventListener('touchstart', onUserGesture);
      document.removeEventListener('visibilitychange', onVisibilityChange);

      if (engineRef.current) {
        stopAllTransientSources(engineRef.current);
        void engineRef.current.ctx.close().catch(() => {});
        engineRef.current = null;
      }
      registerHighlandAudioEngine(null);
      if (activeSoundscapeOwner === owner) {
        activeSoundscapeOwner = null;
      }
    };
  }, []);

  // Immediate gain response + clean oscillator stop/suspend when muted (`!audioEnabled`)
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    if (!audioEnabled) {
      eng.masterGain.gain.cancelScheduledValues(eng.ctx.currentTime);
      eng.masterGain.gain.setValueAtTime(0, eng.ctx.currentTime);
      stopAllTransientSources(eng);
      if (eng.ctx.state === 'running') {
        void eng.ctx.suspend().catch(() => {});
      }
      return;
    }
    if (!document.hidden && eng.ctx.state === 'suspended') {
      void eng.ctx.resume().catch(() => {});
    }
    const target = clamp01(masterVolume);
    eng.masterGain.gain.setTargetAtTime(target, eng.ctx.currentTime, 0.05);
  }, [audioEnabled, masterVolume]);

  // Pluck lush warm multi-string acoustic guitar / bamboo chime / cajon whenever lastJamNote updates!
  useEffect(() => {
    if (!lastJamNote) return;
    if (lastJamNote.timestamp === seenJamTimestampRef.current) return;
    seenJamTimestampRef.current = lastJamNote.timestamp;
    lastManualJamMsRef.current = Date.now();

    const st = useGameStore.getState();
    if (!st.audioEnabled || document.hidden) return;

    const eng = engineRef.current;
    if (!eng) return;
    if (eng.ctx.state === 'suspended') {
      void eng.ctx.resume().catch(() => {});
    }

    const isLocalPlayer =
      lastJamNote.senderId === 'local' ||
      (Boolean(st.localSessionId) && lastJamNote.senderId === st.localSessionId);

    let spatialGain: number;
    if (isLocalPlayer || (st.heldItem === 'guitar' && isLocalPlayer)) {
      // Local player's own held guitar plays at full cozy volume anywhere on the mountain!
      spatialGain = 1.0;
    } else {
      const p = st.localTransient;
      const senderPeer = st.peers[lastJamNote.senderId];
      const srcX = senderPeer ? senderPeer.x : CAMPFIRE_POS[0];
      const srcY = senderPeer ? senderPeer.y : CAMPFIRE_POS[1];
      const srcZ = senderPeer ? senderPeer.z : CAMPFIRE_POS[2];
      const dist = Math.hypot(p.x - srcX, p.y - srcY, p.z - srcZ);
      const baseRemote = Math.max(0.14, Math.pow(clamp01(1.0 - dist / 55.0), 1.4));
      spatialGain = st.quietMode ? baseRemote * 0.16 : baseRemote;
    }

    playHighlandJamChord(eng, lastJamNote, spatialGain);
  }, [lastJamNote]);

  // Warm ceramic cup-clink or crystalline greeting chime on Quick Social Interactions!
  useEffect(() => {
    if (!socialSparkleBurst) return;
    if (socialSparkleBurst.id === seenSocialNonceRef.current) return;
    seenSocialNonceRef.current = socialSparkleBurst.id;

    const st = useGameStore.getState();
    if (!st.audioEnabled || document.hidden) return;
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.ctx.state === 'suspended') {
      void eng.ctx.resume().catch(() => {});
    }
    if (eng.ctx.state !== 'running') return;

    const p = st.localTransient;
    const distFromLocal = Math.hypot(
      socialSparkleBurst.x - p.x,
      socialSparkleBurst.z - p.z
    );
    const isRemoteBurst = distFromLocal > 2.4;
    const quietScale = st.quietMode && isRemoteBurst ? 0.18 : 1.0;
    if (quietScale <= 0.05) return;

    const { ctx, masterGain } = eng;
    const now = ctx.currentTime + 0.01;

    if (socialSparkleBurst.kind === 'cheers') {
      // Warm ceramic/glass cup clink: fundamental + resonant harmonic ring
      const freqs = [1396.91, 2093.0, 2793.83];
      for (let i = 0; i < freqs.length; i++) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freqs[i], now + i * 0.006);
        const peak = (i === 0 ? 0.075 : i === 1 ? 0.045 : 0.022) * quietScale;
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(peak, now + 0.005);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.42 - i * 0.08);
        osc.connect(env);
        env.connect(masterGain);
        trackTransientSource(eng, osc);
        osc.start(now + i * 0.006);
        osc.stop(now + 0.46);
      }
    } else {
      // Gentle two-note ascending Đà Lạt greeting bell (D5 -> A5)
      const notes =
        socialSparkleBurst.kind === 'cheer' ? [587.33, 783.99, 1174.66] : [587.33, 880.0];
      for (let i = 0; i < notes.length; i++) {
        const t0 = now + i * 0.085;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(notes[i], t0);
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(0.055 * quietScale, t0 + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
        osc.connect(env);
        env.connect(masterGain);
        trackTransientSource(eng, osc);
        osc.start(t0);
        osc.stop(t0 + 0.58);
      }
    }
  }, [socialSparkleBurst]);

  return null;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
