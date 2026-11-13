import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';

const SKY_RADIUS = 2200;
const DRIZZLE_COUNT = 500;
const DRIZZLE_BOX_XZ = 46;
const DRIZZLE_BOX_Y = 26;

const SKY_DOME_VERT = /* glsl */ `
  varying vec3 vWorldDir;

  void main() {
    vWorldDir = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const SKY_DOME_FRAG = /* glsl */ `
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uFogColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uStarVisibility;
  uniform float uIsSunrise;
  uniform float uTime;
  uniform float uLinearHdrOutput;
  uniform float uGroundBounceMix;

  varying vec3 vWorldDir;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float cirrusFbm(vec2 uv) {
    float v = 0.0;
    float amp = 0.52;
    mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
    for (int i = 0; i < 4; i++) {
      v += amp * valueNoise2(uv);
      uv = rot * uv * 2.12 + vec2(13.7, 7.3);
      amp *= 0.5;
    }
    return v;
  }

  // Crisp subtle twilight starfield on sphere cells
  float starLayer(vec3 dir, float scale, float densityThreshold) {
    vec3 p = dir * scale;
    vec3 cell = floor(p);
    vec3 local = fract(p) - 0.5;
    float rnd = hash31(cell);
    if (rnd < densityThreshold) return 0.0;

    vec3 jitter = vec3(
      hash31(cell + vec3(11.3, 0.0, 0.0)),
      hash31(cell + vec3(0.0, 23.7, 0.0)),
      hash31(cell + vec3(0.0, 0.0, 37.1))
    ) - 0.5;

    float d = length(local - jitter * 0.55);
    float radius = mix(0.045, 0.11, fract(rnd * 97.3));
    float core = smoothstep(radius, 0.0, d);
    float twinkle = 0.72 + 0.28 * sin(uTime * (1.4 + fract(rnd * 31.7) * 2.4) + rnd * 62.8);
    return core * core * twinkle;
  }

  // Screen-space Interleaved Gradient Noise for +-1/255 anti-banding dither
  float ignDither(vec2 fragCoord) {
    vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(fragCoord, magic.xy)));
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    vec3 sunDir = normalize(uSunDir);

    // Smooth upper sky zenith-horizon interpolation + Rayleigh twilight belt
    float up = clamp(dir.y, 0.0, 1.0);
    float zenithCurve = pow(up, 0.54);
    vec3 skyCol = mix(uHorizonColor, uZenithColor, zenithCurve);

    // Warm horizon atmospheric belt near y = 0
    float horizonBand = exp(-abs(dir.y) * 6.8);
    skyCol = mix(skyCol, mix(uHorizonColor, uFogColor, 0.28), horizonBand * 0.46);

    // Below-horizon valley haze bowl (sky dome) vs warm highland earth/forest bounce (IBL probe)
    if (dir.y < 0.0) {
      float downBlend = smoothstep(0.0, -0.22, dir.y);
      skyCol = mix(skyCol, uFogColor, downBlend);
      if (uGroundBounceMix > 0.5) {
        float deepBounce = smoothstep(-0.10, -0.58, dir.y);
        vec3 earthBounce = vec3(0.095, 0.115, 0.092) + uSunColor * 0.038 + uFogColor * 0.16;
        skyCol = mix(skyCol, earthBounce, deepBounce);
      }
    }

    // East Sunrise Solar Disc & Multi-Lobe Mie Golden Halo
    float cosSun = dot(dir, sunDir);
    float sunAboveMask = smoothstep(-0.14, 0.06, sunDir.y);

    // High-altitude painterly Da Lat dawn cirrus wisps catching coral/gold sunlight
    if (dir.y > 0.035) {
      vec2 skyUv = dir.xz / (dir.y + 0.16);
      vec2 windDrift = vec2(-uTime * 0.0055, uTime * 0.0018);
      float wispA = cirrusFbm(skyUv * vec2(1.45, 3.6) + windDrift);
      float wispB = cirrusFbm(skyUv * vec2(2.8, 5.2) - windDrift * 1.4 + vec2(4.2, 1.9));
      float cirrus = smoothstep(0.52, 0.86, wispA * 0.68 + wispB * 0.32);
      cirrus *= smoothstep(0.035, 0.22, dir.y) * (1.0 - smoothstep(0.68, 0.96, dir.y));

      float sunLitCirrus = pow(max(cosSun * 0.5 + 0.5, 0.0), 2.6);
      vec3 cirrusDark = mix(uZenithColor, uHorizonColor, 0.62) * 1.03;
      vec3 cirrusGlow = mix(uHorizonColor, uSunColor * 1.06, 0.48 + 0.28 * uIsSunrise);
      vec3 cirrusCol = mix(cirrusDark, cirrusGlow, sunLitCirrus);
      skyCol = mix(skyCol, cirrusCol, cirrus * (0.28 + 0.22 * uIsSunrise) * (1.0 - uStarVisibility * 0.65));
    }

    // Distant Horizon Towering Cumulus Banks (seamless 360-deg panorama bridging the Volumetric Cloud Sea!)
    if (dir.y > -0.045 && dir.y < 0.13) {
      // Smooth wrap-free 2D sampling directly on unit circle (dir.x, dir.z) so there is zero atan() seam!
      vec2 horizRingA = dir.xz * 5.2 + vec2(-uTime * 0.008, uTime * 0.003);
      vec2 horizRingB = dir.xz * 11.4 + vec2(-uTime * 0.014 + 3.7, -uTime * 0.004 + 1.9);
      float billowFar = cirrusFbm(horizRingA) * 0.65 + valueNoise2(horizRingB) * 0.35;
      float billowNear = cirrusFbm(horizRingB * 0.72 + vec2(8.1, 2.4)) * 0.6 + valueNoise2(horizRingB * 1.9) * 0.4;

      float crestFar = -0.008 + pow(clamp(billowFar, 0.0, 1.0), 1.35) * 0.098;
      float crestNear = -0.016 + pow(clamp(billowNear, 0.0, 1.0), 1.45) * 0.068;

      float maskFar = smoothstep(crestFar + 0.014, crestFar - 0.018, dir.y) * smoothstep(-0.042, -0.006, dir.y);
      float maskNear = smoothstep(crestNear + 0.011, crestNear - 0.016, dir.y) * smoothstep(-0.042, -0.008, dir.y);

      float rimFar = smoothstep(crestFar - 0.026, crestFar + 0.004, dir.y);
      float rimNear = smoothstep(crestNear - 0.022, crestNear + 0.004, dir.y);
      float sunForward = pow(max(cosSun * 0.5 + 0.5, 0.0), 2.8);

      vec3 farBelly = mix(uFogColor, uHorizonColor, 0.36);
      vec3 farCrown = mix(uHorizonColor * 1.06, mix(vec3(1.0, 0.96, 0.90), uSunColor * 1.12, 0.52), sunForward * (0.45 + 0.55 * sunAboveMask));
      vec3 colFar = mix(farBelly, farCrown, clamp(rimFar * 0.85 + 0.15, 0.0, 1.0));
      skyCol = mix(skyCol, colFar, maskFar * 0.62 * (1.0 - uStarVisibility * 0.45));

      vec3 nearBelly = mix(uFogColor * 0.92, uZenithColor, 0.14);
      vec3 nearCrown = mix(uHorizonColor, uSunColor * 1.08, sunForward * 0.62);
      vec3 colNear = mix(nearBelly, nearCrown, clamp(rimNear * 0.88 + 0.12, 0.0, 1.0));
      skyCol = mix(skyCol, colNear, maskNear * 0.52 * (1.0 - uStarVisibility * 0.45));
    }

    // Controlled golden Mie atmospheric scatter around East horizon (preserves crisp turbine & cloud silhouettes!)
    float mieWide = pow(max(cosSun, 0.0), 9.0) * (0.18 + 0.22 * uIsSunrise);
    float mieTight = pow(max(cosSun, 0.0), 62.0) * (0.34 + 0.42 * sunAboveMask);
    // Crisp limb-darkened HDR solar disc (feeds bloom & god-rays naturally!)
    float solarDisc = smoothstep(0.99936, 0.99985, cosSun) * smoothstep(-0.04, 0.02, dir.y) * sunAboveMask;

    skyCol += uSunColor * (mieWide + mieTight) * smoothstep(-0.22, 0.08, dir.y);
    skyCol += mix(uSunColor, vec3(1.0, 0.98, 0.92), 0.68) * solarDisc * 3.4;

    // Subtle Highland Twilight Stars (active when gameHour < 5.15 || gameHour > 18.4)
    if (uStarVisibility > 0.005 && dir.y > 0.05) {
      float horizonFade = smoothstep(0.05, 0.34, dir.y);
      float sunGlareMask = 1.0 - smoothstep(0.45, 0.92, cosSun);
      float stars =
        starLayer(dir, 145.0, 0.968) * 1.15 +
        starLayer(dir, 260.0, 0.978) * 0.65;
      vec3 starTint = mix(vec3(0.84, 0.90, 1.0), vec3(1.0, 0.93, 0.84), hash31(floor(dir * 145.0)));
      skyCol += starTint * stars * uStarVisibility * horizonFade * sunGlareMask * 0.95;
    }

    gl_FragColor = vec4(skyCol, 1.0);
    if (uLinearHdrOutput < 0.5) {
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      float dither = (ignDither(gl_FragCoord.xy) - 0.5) * (2.0 / 255.0);
      gl_FragColor.rgb = clamp(gl_FragColor.rgb + vec3(dither), 0.0, 1.0);
    }
  }
`;

interface DrizzleDropSeed {
  ox: number;
  oy: number;
  oz: number;
  speed: number;
  len: number;
}

// Reusable scratch objects (zero allocations in useFrame)
const _skyDummy = new THREE.Object3D();
const _cZenith = new THREE.Color();
const _cHorizon = new THREE.Color();
const _cFog = new THREE.Color();
const _cSun = new THREE.Color();
const _cGroundFill = new THREE.Color('#4A3930');
const _vSunDir = new THREE.Vector3();

function computeStarVisibility(gameHour: number): number {
  if (gameHour < 4.75) return 1.0;
  if (gameHour < 5.15) return 1.0 - (gameHour - 4.75) / 0.4;
  if (gameHour > 18.85) return 1.0;
  if (gameHour > 18.4) return (gameHour - 18.4) / 0.45;
  return 0.0;
}

export function SkyAndLighting() {
  const { scene, gl } = useThree();
  const qualityTier = useGameStore((s) => s.qualityTier);

  const skyMeshRef = useRef<THREE.Mesh>(null);
  const dirLightRef = useRef<THREE.DirectionalLight>(null);
  const dirTargetRef = useRef<THREE.Object3D>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight>(null);
  const drizzleMeshRef = useRef<THREE.InstancedMesh>(null);

  const shadowMapSize = qualityTier === 'high' ? 2048 : qualityTier === 'medium' ? 1024 : 512;
  const shadowFrustumHalf = qualityTier === 'high' ? 42 : qualityTier === 'medium' ? 68 : 105;

  // 1. Sky Dome Geometry & ShaderMaterial (+ mini HDR sky probe for live PBR IBL reflections!)
  const { skyGeometry, skyMaterial, iblScene, iblMaterial } = useMemo(() => {
    const geo = new THREE.SphereGeometry(SKY_RADIUS, 48, 32);
    const initAtmo = useGameStore.getState().atmosphere;
    const makeUniforms = (linearHdr: number, groundBounceMix: number) => ({
      uZenithColor: { value: new THREE.Color(initAtmo.skyZenithHex) },
      uHorizonColor: { value: new THREE.Color(initAtmo.skyHorizonHex) },
      uFogColor: { value: new THREE.Color(initAtmo.fogHex) },
      uSunColor: { value: new THREE.Color(initAtmo.sunLightHex) },
      uSunDir: { value: new THREE.Vector3(...initAtmo.sunDirection) },
      uStarVisibility: { value: computeStarVisibility(initAtmo.gameHour) },
      uIsSunrise: { value: initAtmo.isSunriseWindow ? 1.0 : 0.0 },
      uTime: { value: 0 },
      uLinearHdrOutput: { value: linearHdr },
      uGroundBounceMix: { value: groundBounceMix },
    });

    const mat = new THREE.ShaderMaterial({
      uniforms: makeUniforms(qualityTier === 'mobile' ? 0.0 : 1.0, 0.0),
      vertexShader: SKY_DOME_VERT,
      fragmentShader: SKY_DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });

    const probeScene = new THREE.Scene();
    const probeGeo = new THREE.SphereGeometry(12, 24, 16);
    const probeMat = new THREE.ShaderMaterial({
      uniforms: makeUniforms(1.0, 1.0),
      vertexShader: SKY_DOME_VERT,
      fragmentShader: SKY_DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    });
    const probeMesh = new THREE.Mesh(probeGeo, probeMat);
    probeScene.add(probeMesh);

    return {
      skyGeometry: geo,
      skyMaterial: mat,
      iblScene: probeScene,
      iblMaterial: probeMat,
    };
  }, []);

  useEffect(() => {
    skyMaterial.uniforms.uLinearHdrOutput.value = qualityTier === 'mobile' ? 0.0 : 1.0;
  }, [qualityTier, skyMaterial]);

  // 1b. Live PMREM Environment Map Baker (updates lazily when sun/weather shifts — <0.25ms amortized, zero per-frame cost!)
  const pmremRef = useRef<{
    generator: THREE.PMREMGenerator;
    currentRT: THREE.WebGLRenderTarget | null;
    lastBakeHour: number;
    lastBakeWeather: string;
    lastBakeElapsed: number;
  } | null>(null);

  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    generator.compileEquirectangularShader();
    pmremRef.current = {
      generator,
      currentRT: null,
      lastBakeHour: -999,
      lastBakeWeather: '',
      lastBakeElapsed: -999,
    };

    return () => {
      if (pmremRef.current?.currentRT) {
        pmremRef.current.currentRT.dispose();
      }
      generator.dispose();
      if (scene.environment) {
        scene.environment = null;
      }
      pmremRef.current = null;
    };
  }, [gl, scene]);

  // 2. Highland Drizzle 500-Streak InstancedMesh (ultra-fine silky mist streaks)
  const { drizzleGeometry, drizzleMaterial, drizzleSeeds } = useMemo(() => {
    const geo = new THREE.BoxGeometry(0.0042, 1.0, 0.0042);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#DCE8F5'),
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });

    const seeds: DrizzleDropSeed[] = [];
    const hash = (n: number) => {
      const s = Math.sin(n * 91.3458) * 47453.5453;
      return s - Math.floor(s);
    };

    for (let i = 0; i < DRIZZLE_COUNT; i++) {
      seeds.push({
        ox: (hash(i * 3 + 1) - 0.5) * DRIZZLE_BOX_XZ,
        oy: hash(i * 3 + 2) * DRIZZLE_BOX_Y,
        oz: (hash(i * 3 + 3) - 0.5) * DRIZZLE_BOX_XZ,
        speed: 13.5 + hash(i * 5 + 7) * 6.5,
        len: 0.58 + hash(i * 7 + 11) * 0.52,
      });
    }

    return { drizzleGeometry: geo, drizzleMaterial: mat, drizzleSeeds: seeds };
  }, []);

  // Attach exponential highland atmospheric fog to the scene
  const fogRef = useRef<THREE.FogExp2 | null>(null);
  useEffect(() => {
    const initAtmo = useGameStore.getState().atmosphere;
    const fog = new THREE.FogExp2(initAtmo.fogHex, 0.00088);
    scene.fog = fog;
    fogRef.current = fog;
    return () => {
      if (scene.fog === fog) {
        scene.fog = null;
      }
      fogRef.current = null;
    };
  }, [scene]);

  // Link directional light target & resize crisp camera-following shadow frustum cleanly
  useEffect(() => {
    const light = dirLightRef.current;
    const target = dirTargetRef.current;
    if (!light || !target) return;

    light.target = target;
    target.updateMatrixWorld();

    light.shadow.camera.left = -shadowFrustumHalf;
    light.shadow.camera.right = shadowFrustumHalf;
    light.shadow.camera.top = shadowFrustumHalf;
    light.shadow.camera.bottom = -shadowFrustumHalf;
    light.shadow.camera.near = 8;
    light.shadow.camera.far = 420;
    light.shadow.camera.updateProjectionMatrix();

    if (
      light.shadow.mapSize.width !== shadowMapSize ||
      light.shadow.mapSize.height !== shadowMapSize
    ) {
      light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      if (light.shadow.map) {
        light.shadow.map.dispose();
        light.shadow.map = null;
      }
    }
  }, [shadowMapSize, shadowFrustumHalf]);

  // Dispose geometries & materials on unmount
  useEffect(() => {
    return () => {
      skyGeometry.dispose();
      skyMaterial.dispose();
      iblMaterial.dispose();
      drizzleGeometry.dispose();
      drizzleMaterial.dispose();
    };
  }, [skyGeometry, skyMaterial, iblMaterial, drizzleGeometry, drizzleMaterial]);

  useFrame(({ clock, camera }, dt) => {
    const t = clock.getElapsedTime();
    const st = useGameStore.getState();
    const atmo = st.atmosphere;
    const lerpRate = Math.min(1, dt * 3.5);

    _cZenith.set(atmo.skyZenithHex);
    _cHorizon.set(atmo.skyHorizonHex);
    _cFog.set(atmo.fogHex);
    _cSun.set(atmo.sunLightHex);
    _vSunDir.set(atmo.sunDirection[0], atmo.sunDirection[1], atmo.sunDirection[2]).normalize();

    if (skyMeshRef.current) {
      skyMeshRef.current.position.copy(camera.position);
    }

    // Update Sky Dome uniforms
    const su = skyMaterial.uniforms;
    su.uTime.value = t;
    su.uZenithColor.value.lerp(_cZenith, lerpRate);
    su.uHorizonColor.value.lerp(_cHorizon, lerpRate);
    su.uFogColor.value.lerp(_cFog, lerpRate);
    su.uSunColor.value.lerp(_cSun, lerpRate);
    su.uSunDir.value.lerp(_vSunDir, lerpRate);

    const targetStars = computeStarVisibility(atmo.gameHour);
    su.uStarVisibility.value += (targetStars - su.uStarVisibility.value) * lerpRate;
    const targetSunrise = atmo.isSunriseWindow ? 1.0 : 0.0;
    su.uIsSunrise.value += (targetSunrise - su.uIsSunrise.value) * lerpRate;

    // Refresh live PMREM sky environment reflection map whenever sun elevation/weather shifts meaningfully
    const pmrem = pmremRef.current;
    if (
      pmrem &&
      t - pmrem.lastBakeElapsed > 1.25 &&
      (Math.abs(atmo.gameHour - pmrem.lastBakeHour) >= 0.045 ||
        atmo.weather !== pmrem.lastBakeWeather)
    ) {
      const iu = iblMaterial.uniforms;
      iu.uZenithColor.value.copy(su.uZenithColor.value);
      iu.uHorizonColor.value.copy(su.uHorizonColor.value);
      iu.uFogColor.value.copy(su.uFogColor.value);
      iu.uSunColor.value.copy(su.uSunColor.value);
      iu.uSunDir.value.copy(su.uSunDir.value);
      iu.uStarVisibility.value = 0.0;
      iu.uIsSunrise.value = su.uIsSunrise.value;

      const prevRT = pmrem.currentRT;
      const nextRT = pmrem.generator.fromScene(iblScene, 0.04, 0.5, 50);
      pmrem.currentRT = nextRT;
      pmrem.lastBakeHour = atmo.gameHour;
      pmrem.lastBakeWeather = atmo.weather;
      pmrem.lastBakeElapsed = t;

      scene.environment = nextRT.texture;
      (scene as THREE.Scene & { environmentIntensity?: number }).environmentIntensity =
        atmo.gameHour >= 5.1 && atmo.gameHour <= 17.6 ? 0.68 : 0.46;

      if (prevRT) {
        prevRT.dispose();
      }
    }

    // Update Directional Sun Light with texel-snapped camera-following focus (5x sharper local shadows, zero shimmer!)
    const dirLight = dirLightRef.current;
    const dirTarget = dirTargetRef.current;
    if (dirLight && dirTarget) {
      const focusX = st.hasEnteredWorld ? st.localTransient.x : camera.position.x;
      const focusY = st.hasEnteredWorld ? st.localTransient.y : camera.position.y;
      const focusZ = st.hasEnteredWorld ? st.localTransient.z : camera.position.z;
      const snapStep = (shadowFrustumHalf * 2) / shadowMapSize * 4.0;
      const snappedX = Math.round(focusX / snapStep) * snapStep;
      const snappedY = Math.round(focusY / 1.5) * 1.5;
      const snappedZ = Math.round(focusZ / snapStep) * snapStep;

      dirTarget.position.set(snappedX, snappedY, snappedZ);
      dirTarget.updateMatrixWorld();

      const clampedSunY = Math.max(0.12, _vSunDir.y);
      dirLight.position.set(
        snappedX + _vSunDir.x * 220,
        snappedY + clampedSunY * 220,
        snappedZ + _vSunDir.z * 220
      );
      dirLight.color.lerp(_cSun, lerpRate);
      dirLight.intensity += (atmo.sunIntensity * 1.12 - dirLight.intensity) * lerpRate;
    }

    // Update Hemisphere Sky/Ground Fill Light
    const hemi = hemiLightRef.current;
    if (hemi) {
      hemi.color.lerp(_cHorizon, lerpRate);
      hemi.groundColor.copy(_cGroundFill);
      hemi.intensity += (atmo.ambientIntensity * 0.94 - hemi.intensity) * lerpRate;
    }

    // Update Scene Exponential Fog
    const fog = fogRef.current;
    if (fog) {
      fog.color.lerp(_cFog, lerpRate);
      const targetDensity =
        atmo.weather === 'deep_evening_fog'
          ? 0.00185
          : atmo.weather === 'light_drizzle'
            ? 0.00155
            : atmo.weather === 'morning_mist_boil'
              ? 0.00112
              : atmo.weather === 'clear_highland_sun'
                ? 0.00056
                : 0.00082;
      fog.density += (targetDensity - fog.density) * lerpRate;
    }

    // Update 500-Streak Light Highland Drizzle around camera (zero allocations)
    const drizzleMesh = drizzleMeshRef.current;
    if (drizzleMesh) {
      const activeDrizzle = atmo.drizzleIntensity > 0.05;
      drizzleMesh.visible = activeDrizzle;

      if (activeDrizzle) {
        drizzleMaterial.opacity = Math.min(0.24, atmo.drizzleIntensity * 0.22);
        const slantZ = 0.08 + atmo.windStrength * 0.11;
        const slantX = -0.12 - atmo.windStrength * 0.14;

        const camX = camera.position.x;
        const camY = camera.position.y;
        const camZ = camera.position.z;
        const halfXZ = DRIZZLE_BOX_XZ * 0.5;

        for (let i = 0; i < DRIZZLE_COUNT; i++) {
          const s = drizzleSeeds[i];
          const fallDist = t * s.speed;

          const relY = ((s.oy - fallDist) % DRIZZLE_BOX_Y + DRIZZLE_BOX_Y) % DRIZZLE_BOX_Y - 10;
          const relX =
            (((s.ox - fallDist * 0.16 - camX) % DRIZZLE_BOX_XZ) + DRIZZLE_BOX_XZ) %
              DRIZZLE_BOX_XZ -
            halfXZ;
          const relZ =
            (((s.oz + fallDist * 0.09 - camZ) % DRIZZLE_BOX_XZ) + DRIZZLE_BOX_XZ) %
              DRIZZLE_BOX_XZ -
            halfXZ;

          const distSq = relX * relX + relZ * relZ;
          const nearFade = distSq < 7.5 ? 0.0 : Math.min(1.0, (distSq - 7.5) * 0.18);

          _skyDummy.position.set(camX + relX, camY + relY, camZ + relZ);
          _skyDummy.rotation.set(slantZ, 0, slantX);
          _skyDummy.scale.set(nearFade, s.len * nearFade, nearFade);
          _skyDummy.updateMatrix();
          drizzleMesh.setMatrixAt(i, _skyDummy.matrix);
        }
        drizzleMesh.instanceMatrix.needsUpdate = true;
      }
    }
  });

  return (
    <group name="DaLatSkyAndLighting">
      <mesh
        ref={skyMeshRef}
        geometry={skyGeometry}
        material={skyMaterial}
        frustumCulled={false}
        renderOrder={-100}
      />

      <object3D ref={dirTargetRef} position={[-35, 135, 28]} />

      <directionalLight
        ref={dirLightRef}
        castShadow
        position={[200, 210, 45]}
        intensity={1.7}
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.014}
        shadow-radius={1.65}
        shadow-camera-left={-shadowFrustumHalf}
        shadow-camera-right={shadowFrustumHalf}
        shadow-camera-top={shadowFrustumHalf}
        shadow-camera-bottom={-shadowFrustumHalf}
        shadow-camera-near={8}
        shadow-camera-far={420}
      />

      <hemisphereLight
        ref={hemiLightRef}
        args={['#FFD194', '#4A3930', 0.62]}
      />

      <instancedMesh
        ref={drizzleMeshRef}
        args={[drizzleGeometry, drizzleMaterial, DRIZZLE_COUNT]}
        visible={false}
        frustumCulled={false}
        renderOrder={25}
      />
    </group>
  );
}
