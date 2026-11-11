import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleGroundHeight, sampleWalkableHeight, WORLD_CONSTANTS } from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';

const TERRAIN_RES = 256;
const ATLAS_RES = 256;
const WORLD_HALF = WORLD_CONSTANTS.HALF_SIZE; // 450m
const WORLD_SPAN = WORLD_HALF * 2; // 900m

const GREENHOUSE_CLUSTERS: ReadonlyArray<{
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  weight: number;
}> = [
  { cx: 175, cz: 35, rx: 44, rz: 36, weight: 0.95 },
  { cx: 235, cz: 92, rx: 58, rz: 48, weight: 1.0 },
  { cx: 295, cz: 55, rx: 52, rz: 44, weight: 0.92 },
  { cx: 345, cz: 118, rx: 46, rz: 52, weight: 0.88 },
  { cx: 205, cz: 158, rx: 54, rz: 42, weight: 0.94 },
  { cx: 278, cz: 178, rx: 60, rz: 46, weight: 1.0 },
  { cx: 342, cz: 196, rx: 44, rz: 36, weight: 0.82 },
  { cx: 162, cz: -12, rx: 36, rz: 30, weight: 0.76 },
  { cx: 268, cz: -18, rx: 42, rz: 32, weight: 0.8 },
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstepJS(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function quintic(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerpJS(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash2DPeriodic(ix: number, iy: number, period: number, salt: number): [number, number] {
  const px = ((ix % period) + period) % period;
  const py = ((iy % period) + period) % period;
  const s1 = Math.sin(px * 127.1 + py * 311.7 + salt * 74.7) * 43758.5453123;
  const s2 = Math.sin(px * 269.5 + py * 183.3 + salt * 19.3) * 43758.5453123;
  return [s1 - Math.floor(s1), s2 - Math.floor(s2)];
}

/**
 * Seamless tileable 2D Gradient Perlin noise in [0, 1].
 */
function perlinPeriodic(u: number, v: number, cells: number, salt: number): number {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = quintic(fx);
  const uy = quintic(fy);

  const gradDot = (gx: number, gy: number, dx: number, dy: number): number => {
    const [h1] = hash2DPeriodic(gx, gy, cells, salt);
    const ang = h1 * Math.PI * 2;
    return Math.cos(ang) * dx + Math.sin(ang) * dy;
  };

  const n00 = gradDot(ix, iy, fx, fy);
  const n10 = gradDot(ix + 1, iy, fx - 1, fy);
  const n01 = gradDot(ix, iy + 1, fx, fy - 1);
  const n11 = gradDot(ix + 1, iy + 1, fx - 1, fy - 1);

  const nx0 = lerpJS(n00, n10, ux);
  const nx1 = lerpJS(n01, n11, ux);
  return clamp01(lerpJS(nx0, nx1, uy) * 0.72 + 0.5);
}

function perlinFbmPeriodic(u: number, v: number, baseCells: number, octaves: number, salt: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseCells;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlinPeriodic(u, v, freq, salt + i * 13.7);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return clamp01(sum / Math.max(1e-5, norm));
}

/**
 * Seamless tileable inverted Worley cellular domes (1 - F1) with soft hemispherical profile.
 */
function worleyDomePeriodic(u: number, v: number, cells: number, salt: number): number {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  let d1 = 8.0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const [jx, jy] = hash2DPeriodic(ix + dx, iy + dy, cells, salt);
      const rx = dx + 0.08 + jx * 0.84 - fx;
      const ry = dy + 0.08 + jy * 0.84 - fy;
      const dist = Math.hypot(rx, ry);
      if (dist < d1) d1 = dist;
    }
  }
  const normR = clamp01(d1 / 0.92);
  return Math.sqrt(Math.max(0, 1.0 - normR * normR * 0.94));
}

function remap01(val: number, lo: number, hi: number): number {
  return clamp01((val - lo) / Math.max(1e-4, hi - lo));
}

function make1x1DummyHalfTex(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.needsUpdate = true;
  return tex;
}

function make1x1DummyByteTex(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 128]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Shared live uniform bridge so `DaLatVolumetricCloudPass` in `CinematicPostProcessing`
 * raymarches volumetric clouds against the exact 32-bit hardware scene `DepthTexture`!
 */
export const volumetricCloudSharedUniforms = {
  uTerrainMap: { value: make1x1DummyHalfTex() as THREE.Texture },
  uCloudAtlas: { value: make1x1DummyByteTex() as THREE.Texture },
  uTime: { value: 0 },
  uCloudBottomY: { value: 30 },
  uCloudTopY: { value: 108 },
  uCloudDensity: { value: 0.78 },
  uWindStrength: { value: 0.55 },
  uGreenhouseIntensity: { value: 0.0 },
  uSunDir: { value: new THREE.Vector3(0.85, 0.18, 0.1) },
  uCloudLitColor: { value: new THREE.Color('#FFF4E4') },
  uCloudShadowColor: { value: new THREE.Color('#7C92B8') },
  uSunLightColor: { value: new THREE.Color('#FFD29D') },
  uSkyZenithColor: { value: new THREE.Color('#3E7CB8') },
  uSkyHorizonColor: { value: new THREE.Color('#FFD194') },
  uFogColor: { value: new THREE.Color('#C9D6E8') },
  uFogDensity: { value: 0.00088 },
  uQualitySteps: { value: 28.0 },
};

/**
 * Prebakes:
 * 1) HalfFloat 256x256 Terrain + Walkable Deck + Orographic Lift + Valley Openness + 2,700K Greenhouse Map
 * 2) Seamless 256x256 4-Channel Volumetric Cloud Atlas
 */
function createVolumetricCloudTextures(): {
  terrainMap: THREE.DataTexture;
  cloudAtlas: THREE.DataTexture;
} {
  const terrainHalf = new Uint16Array(TERRAIN_RES * TERRAIN_RES * 4);
  const atlasBytes = new Uint8Array(ATLAS_RES * ATLAS_RES * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;

  for (let iy = 0; iy < TERRAIN_RES; iy++) {
    const v = (iy + 0.5) / TERRAIN_RES;
    const wz = -WORLD_HALF + v * WORLD_SPAN;

    for (let ix = 0; ix < TERRAIN_RES; ix++) {
      const u = (ix + 0.5) / TERRAIN_RES;
      const wx = -WORLD_HALF + u * WORLD_SPAN;
      const idx = (iy * TERRAIN_RES + ix) * 4;

      const groundH = sampleGroundHeight(wx, wz);
      const walkableH = sampleWalkableHeight(wx, wz);
      const h = Math.max(groundH, walkableH);
      const hUpwind = sampleGroundHeight(wx + 18, wz - 6);
      const hDownwind = sampleGroundHeight(wx - 18, wz + 6);
      const windwardSlope = clamp01((hDownwind - hUpwind + 4) / 30);
      const orographic = windwardSlope * smoothstepJS(32, 92, groundH) * (1 - smoothstepJS(98, 128, groundH));

      // Keep cloud-sea billows lush in valleys (< 92m) while depressing cleanly below scenic overlooks & veranda decks!
      const nearOverlook = smoothstepJS(36, 12, Math.hypot(wx - 18, wz - 128));
      const nearVeranda = smoothstepJS(42, 16, Math.hypot(wx - -36, wz - 30));
      const valleyOpen =
        (1 - smoothstepJS(80, 118, h)) * (1 - nearOverlook * 0.92) * (1 - nearVeranda * 0.95);

      let irradiance = 0;
      if (wx >= 105 && wx <= 420 && wz >= -85 && wz <= 270) {
        const valleyMask = 1 - smoothstepJS(42, 78, groundH);
        let clusterSum = 0;
        for (let c = 0; c < GREENHOUSE_CLUSTERS.length; c++) {
          const cl = GREENHOUSE_CLUSTERS[c];
          const dx = (wx - cl.cx) / cl.rx;
          const dz = (wz - cl.cz) / cl.rz;
          clusterSum += cl.weight * Math.exp(-(dx * dx + dz * dz));
        }
        const rowMod = 0.8 + 0.2 * Math.sin(wx * 0.2 + wz * 0.08) * Math.cos(wz * 0.18 - wx * 0.05);
        irradiance = clamp01(clusterSum * 0.86 * valleyMask * rowMod);
      }

      terrainHalf[idx] = toHalf(h);
      terrainHalf[idx + 1] = toHalf(orographic);
      terrainHalf[idx + 2] = toHalf(valleyOpen);
      terrainHalf[idx + 3] = toHalf(irradiance);
    }
  }

  for (let iy = 0; iy < ATLAS_RES; iy++) {
    const v = iy / ATLAS_RES;
    for (let ix = 0; ix < ATLAS_RES; ix++) {
      const u = ix / ATLAS_RES;
      const idx = (iy * ATLAS_RES + ix) * 4;

      const warpX = (perlinFbmPeriodic(u, v, 2, 3, 2.3) - 0.5) * 0.16;
      const warpY = (perlinFbmPeriodic(u + 0.37, v + 0.61, 2, 3, 8.9) - 0.5) * 0.16;
      const wu = (((u + warpX) % 1) + 1) % 1;
      const wv = (((v + warpY) % 1) + 1) % 1;

      const basePerlin = perlinFbmPeriodic(wu, wv, 3, 4, 1.7);
      const wLow =
        worleyDomePeriodic(wu, wv, 3, 3.1) * 0.56 +
        worleyDomePeriodic(wu, wv, 6, 7.7) * 0.30 +
        worleyDomePeriodic(wu, wv, 11, 13.3) * 0.14;

      const perlinWorley = remap01(basePerlin * 0.58 + wLow * 0.42, (1.0 - wLow) * 0.34, 0.95);

      const cauliflower = clamp01(
        worleyDomePeriodic(wu, wv, 4, 5.3) * 0.52 +
          worleyDomePeriodic(u, v, 8, 11.9) * 0.32 +
          worleyDomePeriodic(u, v, 14, 19.1) * 0.16
      );

      const wispyFbm = perlinFbmPeriodic(u, v, 4, 4, 29.4);
      const flowWarp = perlinFbmPeriodic(u, v, 2, 3, 43.1);

      atlasBytes[idx] = Math.round(perlinWorley * 255);
      atlasBytes[idx + 1] = Math.round(cauliflower * 255);
      atlasBytes[idx + 2] = Math.round(wispyFbm * 255);
      atlasBytes[idx + 3] = Math.round(flowWarp * 255);
    }
  }

  const terrainMap = new THREE.DataTexture(
    terrainHalf,
    TERRAIN_RES,
    TERRAIN_RES,
    THREE.RGBAFormat,
    THREE.HalfFloatType
  );
  terrainMap.minFilter = THREE.LinearFilter;
  terrainMap.magFilter = THREE.LinearFilter;
  terrainMap.wrapS = THREE.ClampToEdgeWrapping;
  terrainMap.wrapT = THREE.ClampToEdgeWrapping;
  terrainMap.needsUpdate = true;

  const cloudAtlas = new THREE.DataTexture(
    atlasBytes,
    ATLAS_RES,
    ATLAS_RES,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  cloudAtlas.minFilter = THREE.LinearFilter;
  cloudAtlas.magFilter = THREE.LinearFilter;
  cloudAtlas.wrapS = THREE.RepeatWrapping;
  cloudAtlas.wrapT = THREE.RepeatWrapping;
  cloudAtlas.needsUpdate = true;

  return { terrainMap, cloudAtlas };
}

export const VOLUMETRIC_CLOUD_COMMON_GLSL = /* glsl */ `
  uniform sampler2D uTerrainMap;
  uniform sampler2D uCloudAtlas;
  uniform float uTime;
  uniform float uCloudBottomY;
  uniform float uCloudTopY;
  uniform float uCloudDensity;
  uniform float uWindStrength;
  uniform float uGreenhouseIntensity;
  uniform vec3 uSunDir;
  uniform vec3 uCloudLitColor;
  uniform vec3 uCloudShadowColor;
  uniform vec3 uSunLightColor;
  uniform vec3 uSkyZenithColor;
  uniform vec3 uSkyHorizonColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uQualitySteps;

  float cloudIgn(vec2 p) {
    vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(p, magic.xy)));
  }

  float henyeyGreenstein(float cosTheta, float g) {
    float g2 = g * g;
    float denom = max(1e-4, pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
    return (1.0 - g2) / (4.0 * 3.14159265 * denom);
  }

  float dualLobeHG(float cosTheta) {
    return mix(henyeyGreenstein(cosTheta, -0.30), henyeyGreenstein(cosTheta, 0.76), 0.74);
  }

  vec4 sampleValleyTerrain(vec2 xz) {
    vec2 uv = (xz + 450.0) / 900.0;
    vec2 clampedUv = clamp(uv, 0.002, 0.998);
    vec4 tex = texture2D(uTerrainMap, clampedUv);

    vec2 outsideDist = max(abs(xz) - 450.0, vec2(0.0));
    float outLen = length(outsideDist);
    float insideWeight = exp(-outLen * 0.0055);

    float farBasinH = mix(22.0, 68.0, smoothstep(120.0, -620.0, xz.x));
    float h = mix(farBasinH, tex.r, insideWeight);
    float orographic = tex.g * insideWeight;
    float valleyOpen = mix(1.0, tex.b, insideWeight);
    float greenhouse = (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) ? tex.a : 0.0;

    return vec4(h, orographic, valleyOpen, greenhouse);
  }

  const mat2 ROT_GOLD_A = mat2(-0.7373688, 0.6754903, -0.6754903, -0.7373688);
  const mat2 ROT_GOLD_B = mat2(0.4975710, 0.8674232, -0.8674232, 0.4975710);

  float evalCloudDensity3D(vec3 p, float roofY, float bottomY, vec4 tInfo, float detailLod, out float outHeightFrac) {
    float terrainH = tInfo.x;
    float orographic = tInfo.y;
    float valleyOpen = tInfo.z;

    // Depress cloud tops near ridges & walkable decks so hilltops/verandas stay crisp above plush valley clouds!
    float localRoof = roofY - (1.0 - valleyOpen) * 24.0 + orographic * 7.5;
    float slabSpan = max(16.0, localRoof - bottomY);
    float hFrac = clamp((p.y - bottomY) / slabSpan, 0.0, 1.0);
    outHeightFrac = hFrac;

    if (p.y <= terrainH + 0.65 || p.y >= localRoof) return 0.0;

    float shoreMist = smoothstep(0.65, 19.5, p.y - terrainH);

    float windSpeed = 2.4 + uWindStrength * 3.4;
    vec2 windDrift = vec2(-uTime * windSpeed, uTime * windSpeed * 0.24) * (0.70 + 0.48 * hFrac);

    vec4 macroSample = texture2D(uCloudAtlas, (p.xz + windDrift * 0.48) * 0.00052);
    vec2 flowWarp = (vec2(macroSample.a, macroSample.b) - 0.5) * 145.0;

    vec2 uvBillow = (ROT_GOLD_A * (p.xz + flowWarp + windDrift)) * 0.00128;
    vec4 billowSample = texture2D(uCloudAtlas, uvBillow);

    float valleyWave = 0.5 + 0.5 * sin(p.x * 0.0068 - p.z * 0.0046 + macroSample.a * 4.4 - uTime * 0.032);

    float rawCrown =
      macroSample.r * 0.34 +
      billowSample.r * 0.38 +
      billowSample.g * 0.22 +
      valleyWave * 0.14 +
      orographic * 0.10 - 0.10;
    float domeCrownH = smoothstep(0.20, 0.78, rawCrown);
    domeCrownH = pow(domeCrownH, 1.22);

    float coverage = clamp(domeCrownH * (0.72 + 0.38 * uCloudDensity) + (uCloudDensity - 0.75) * 0.18, 0.0, 1.0);

    float baseFade = smoothstep(0.0, 0.12, hFrac);
    float turretTop = clamp(0.18 + coverage * 0.80, 0.16, 0.99);
    float topRounding = 1.0 - smoothstep(turretTop * 0.58, turretTop, hFrac);

    float rawShape = coverage * baseFade * topRounding;
    if (rawShape <= 0.0025) return 0.0;

    vec2 uvTurret = (ROT_GOLD_B * (p.xz + vec2(p.y * 0.78, -p.y * 0.52) + windDrift * 1.18)) * 0.00295;
    vec4 turretSample = texture2D(uCloudAtlas, uvTurret);

    float mediumLobes = mix(0.46, turretSample.g, 0.35 + 0.65 * detailLod);
    float fineWisps = 0.48;
    if (detailLod > 0.25) {
      vec4 wispSample = texture2D(uCloudAtlas, (p.xz - windDrift * 1.35 + vec2(p.y * 0.32)) * 0.0064);
      fineWisps = mix(0.48, wispSample.b, detailLod);
    }
    float detailErode = mediumLobes * 0.64 + fineWisps * 0.36;
    float erodeWeight = mix(0.18, 0.58, smoothstep(0.16, 0.90, hFrac)) * (0.45 + 0.55 * detailLod);
    float sculpted = smoothstep(detailErode * erodeWeight, 0.64, rawShape);

    float valleyBed = (1.0 - smoothstep(0.08, 0.28, hFrac)) * valleyOpen * smoothstep(0.18, 0.70, uCloudDensity) * 0.68;

    float finalDensity = (sculpted * 0.122 + valleyBed * 0.066) * shoreMist * (0.56 + 0.62 * uCloudDensity);
    return finalDensity;
  }

  // Fast 2-lookup solar optical depth estimator (replaces 2 full 5-lookup evalCloudDensity3D calls per step)
  float evalSunShadowDensity(vec3 p, float roofY, float bottomY) {
    if (p.y >= roofY || p.y <= bottomY) return 0.0;
    vec2 uv = clamp((p.xz + 450.0) / 900.0, 0.002, 0.998);
    vec4 tTex = texture2D(uTerrainMap, uv);
    float localRoof = roofY - (1.0 - tTex.b) * 24.0 + tTex.g * 7.5;
    if (p.y <= tTex.r + 0.65 || p.y >= localRoof) return 0.0;
    float hFrac = clamp((p.y - bottomY) / max(16.0, localRoof - bottomY), 0.0, 1.0);
    float windSpeed = 2.4 + uWindStrength * 3.4;
    vec2 windDrift = vec2(-uTime * windSpeed, uTime * windSpeed * 0.24) * (0.70 + 0.48 * hFrac);
    vec4 macroSample = texture2D(uCloudAtlas, (p.xz + windDrift * 0.48) * 0.00052);
    vec2 uvBillow = (ROT_GOLD_A * (p.xz + windDrift)) * 0.00128;
    vec4 billowSample = texture2D(uCloudAtlas, uvBillow);
    float rawCrown = macroSample.r * 0.42 + billowSample.r * 0.42 + billowSample.g * 0.16;
    float cov = clamp(smoothstep(0.22, 0.78, rawCrown) * (0.72 + 0.38 * uCloudDensity), 0.0, 1.0);
    return cov * (1.0 - smoothstep(0.55, 0.98, hFrac)) * 0.095 * uCloudDensity;
  }

  /**
   * Raymarches volumetric cloud scattering along (rayOrigin, rayDir) from [tEnter, tEnd],
   * strictly bounded by hardware scene depth sceneHitDist (when hasSceneHit > 0.5) so
   * zero cloud pixels EVER bleed over decks, railings, cabins, string-light poles, wires, or avatars!
   */
  vec4 integrateVolumetricCloudRay(
    vec3 rayOrigin,
    vec3 rayDir,
    float tEnter,
    float tEnd,
    float roofY,
    float bottomY,
    float sceneHitDist,
    float hasSceneHit,
    vec2 fragCoord
  ) {
    float span = tEnd - tEnter;
    if (span <= 0.15 || uCloudDensity < 0.04) {
      return vec4(0.0);
    }

    int steps = int(uQualitySteps);
    float fSteps = float(steps);
    // Gentle sub-step jitter damped when ray span is short near solid geometry -> ZERO stipple dots!
    float jitterAmp = smoothstep(4.0, 26.0, span);
    float jitter = mix(0.5, cloudIgn(fragCoord), jitterAmp);

    vec3 sunDir = normalize(uSunDir);
    float cosTheta = dot(rayDir, sunDir);
    float phase = dualLobeHG(cosTheta);
    float sunVis = smoothstep(-0.14, 0.14, sunDir.y);

    vec3 litCrownTint = mix(uCloudLitColor, vec3(1.0, 0.96, 0.90), 0.45 * sunVis);
    vec3 peachRimTint = mix(uSunLightColor, vec3(1.0, 0.72, 0.48), 0.38 * (1.0 - smoothstep(0.04, 0.42, sunDir.y)));
    vec3 deepCreviceTint = mix(uCloudShadowColor * 0.68, vec3(0.32, 0.40, 0.62), 0.58);
    vec3 skyBounceTop = mix(uSkyHorizonColor, uSkyZenithColor, 0.45) * 0.38 + litCrownTint * 0.24;

    vec3 accumLight = vec3(0.0);
    float transmittance = 1.0;
    float weightedDist = 0.0;
    float weightSum = 0.0;

    float prevT = 0.0;
    for (int i = 0; i < 30; i++) {
      if (i >= steps) break;
      if (transmittance < 0.012) break;

      float u0 = float(i) / fSteps;
      float u1 = (float(i) + 1.0) / fSteps;
      float uMid = mix(u0, u1, jitter);
      float tLocal = span * mix(uMid, uMid * uMid, 0.45);
      float tNext = span * mix(u1, u1 * u1, 0.45);
      float stepLen = max(0.35, tNext - prevT);
      prevT = tNext;

      float camDist = tEnter + tLocal;
      if (hasSceneHit > 0.5 && camDist >= sceneHitDist - 0.05) {
        break;
      }

      vec3 p = rayOrigin + rayDir * camDist;
      vec4 tInfo = sampleValleyTerrain(p.xz);
      if (p.y <= tInfo.x + 0.55) {
        break;
      }

      float detailLod = exp(-camDist * 0.0021);
      float hFrac = 0.5;
      float sigma = evalCloudDensity3D(p, roofY, bottomY, tInfo, detailLod, hFrac);

      // Keep a crisp personal visibility clearing around the camera lens & smoothly feather solid contacts
      float nearClear = smoothstep(8.0, 24.0, camDist);
      float solidFeather = hasSceneHit > 0.5 ? smoothstep(0.05, 3.2, sceneHitDist - camDist) : 1.0;
      sigma *= nearClear * solidFeather;

      if (sigma > 0.0004) {
        vec3 pSun1 = p + sunDir * 48.0;
        float dSun1 = evalSunShadowDensity(pSun1, roofY, bottomY);

        float tauSun = dSun1 * 42.0 + (1.0 - hFrac) * 1.32;

        float scatterSingle = exp(-tauSun);
        float scatterMulti = exp(-tauSun * 0.32) * 0.42 + exp(-tauSun * 0.11) * 0.15;
        float powder = 1.0 - exp(-sigma * stepLen * 3.4);
        float silverBoost = mix(1.0, 2.05 * powder + 0.45, max(0.0, cosTheta));

        vec3 directSun = peachRimTint * (scatterSingle * (0.68 + 1.62 * phase * silverBoost) + scatterMulti * 0.46) * (0.16 + 1.12 * sunVis);

        float ambientH = smoothstep(0.12, 0.88, hFrac);
        vec3 ambient = mix(deepCreviceTint, skyBounceTop, ambientH);

        float slopeProximity = 1.0 - smoothstep(1.0, 18.0, p.y - tInfo.x);
        ambient = mix(ambient, uFogColor * 1.04, slopeProximity * 0.30);

        vec3 stepScattering = ambient + directSun;

        if (uGreenhouseIntensity > 0.002 && tInfo.w > 0.003) {
          float underTransmit = (1.0 - smoothstep(0.05, 0.82, hFrac)) * 1.45 + 0.25;
          stepScattering += vec3(1.0, 0.66, 0.22) * (tInfo.w * uGreenhouseIntensity * underTransmit * 2.35);
        }

        float stepTrans = exp(-sigma * stepLen);
        float stepWeight = transmittance * (1.0 - stepTrans);
        accumLight += stepScattering * stepWeight;
        weightedDist += camDist * stepWeight;
        weightSum += stepWeight;
        transmittance *= stepTrans;
      }
    }

    float alpha = 1.0 - transmittance;
    if (alpha < 0.003) return vec4(0.0);

    vec3 cloudColor = accumLight / max(1e-4, alpha);
    float meanDist = weightSum > 1e-4 ? (weightedDist / weightSum) : tEnter;
    float fogFactor = 1.0 - exp(-pow(meanDist * uFogDensity * 0.48, 2.0));
    cloudColor = mix(cloudColor, uFogColor, clamp(fogFactor, 0.0, 0.88));

    float horizonFade = 1.0 - smoothstep(1750.0, 2450.0, tEnter);
    alpha *= horizonFade;
    if (alpha < 0.003) return vec4(0.0);

    return vec4(cloudColor, clamp(alpha, 0.0, 0.985));
  }
`;

export const VOLUMETRIC_CLOUD_PASS_FRAG = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uInvProjection;
  uniform mat4 uCamWorldMatrix;
  uniform vec3 uCamPos;
  varying vec2 vUv;

  ${VOLUMETRIC_CLOUD_COMMON_GLSL}

  void main() {
    if (uCloudDensity < 0.04) {
      gl_FragColor = vec4(0.0);
      return;
    }

    // Reconstruct exact world-space view ray from NDC UV
    vec4 clipFar = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec4 viewFar = uInvProjection * clipFar;
    vec3 viewRay = normalize(viewFar.xyz / max(1e-6, viewFar.w));
    vec3 rayDir = normalize((uCamWorldMatrix * vec4(viewRay, 0.0)).xyz);

    // Realistic Da Lat cloud-sea inversion lid (keeps veranda at 135.3m & upper overlooks crystal-clear!)
    float roofY = min(uCloudTopY + 18.0, 131.5);
    float bottomY = min(uCloudBottomY - 10.0, roofY - 24.0);

    // Analytical ray-slab [bottomY, roofY] intersection
    float tEnter = 0.0;
    float tExit = 0.0;

    if (uCamPos.y > roofY) {
      if (rayDir.y >= -0.0015) {
        gl_FragColor = vec4(0.0);
        return;
      }
      tEnter = (roofY - uCamPos.y) / rayDir.y;
      tExit = (bottomY - uCamPos.y) / rayDir.y;
    } else if (uCamPos.y >= bottomY) {
      tEnter = 0.0;
      if (rayDir.y < -0.0015) {
        tExit = (bottomY - uCamPos.y) / rayDir.y;
      } else if (rayDir.y > 0.0015) {
        tExit = (roofY - uCamPos.y) / rayDir.y;
      } else {
        tExit = 760.0;
      }
    } else {
      if (rayDir.y <= 0.0015) {
        gl_FragColor = vec4(0.0);
        return;
      }
      tEnter = (bottomY - uCamPos.y) / rayDir.y;
      tExit = (roofY - uCamPos.y) / rayDir.y;
    }

    if (tEnter > 2450.0 || tExit <= tEnter) {
      gl_FragColor = vec4(0.0);
      return;
    }

    // Hardware 32-bit DepthTexture occlusion: 100% pixel-exact around planks, poles, wires, trees & avatars!
    float rawDepth = texture2D(tDepth, vUv).x;
    float hasSceneHit = rawDepth < 0.99992 ? 1.0 : 0.0;
    float sceneHitDist = 1e6;

    if (hasSceneHit > 0.5) {
      vec4 clipHit = vec4(vUv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
      vec4 viewHit = uInvProjection * clipHit;
      vec3 viewPos = viewHit.xyz / max(1e-6, viewHit.w);
      sceneHitDist = length(viewPos);

      // Instant early-out if solid geometry sits in front of the cloud slab!
      if (sceneHitDist <= tEnter + 0.08) {
        gl_FragColor = vec4(0.0);
        return;
      }
      tExit = min(tExit, sceneHitDist);
    }

    float tEnd = min(tExit, tEnter + 760.0);
    vec4 cloud = integrateVolumetricCloudRay(
      uCamPos,
      rayDir,
      tEnter,
      tEnd,
      roofY,
      bottomY,
      sceneHitDist,
      hasSceneHit,
      gl_FragCoord.xy
    );

    gl_FragColor = cloud;
  }
`;

// Lightweight Mobile-tier fallback mesh shader (only visible when EffectComposer is bypassed on mobile)
const MOBILE_CLOUD_VERT = /* glsl */ `
  uniform float uCloudTopY;
  varying vec3 vEntryWorldPos;
  varying float vEffectiveRoofY;

  void main() {
    float roofY = min(min(uCloudTopY + 12.0, 118.0), cameraPosition.y - 4.0);
    vEffectiveRoofY = roofY;

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    worldPos.x += cameraPosition.x;
    worldPos.z += cameraPosition.z;
    worldPos.y = roofY;

    vEntryWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const MOBILE_CLOUD_FRAG = /* glsl */ `
  varying vec3 vEntryWorldPos;
  varying float vEffectiveRoofY;

  ${VOLUMETRIC_CLOUD_COMMON_GLSL}

  void main() {
    if (uCloudDensity < 0.04) discard;

    vec3 rayOrigin = cameraPosition;
    vec3 toEntry = vEntryWorldPos - rayOrigin;
    float distToEntry = length(toEntry);
    vec3 rayDir = toEntry / max(1e-4, distToEntry);

    if (rayDir.y >= -0.0035 || distToEntry > 2450.0) discard;

    float roofY = vEffectiveRoofY;
    float bottomY = min(uCloudBottomY - 10.0, roofY - 22.0);
    float maxSpan = min((roofY - bottomY) / max(0.055, -rayDir.y), 680.0);

    vec4 cloud = integrateVolumetricCloudRay(
      rayOrigin,
      rayDir,
      distToEntry,
      distToEntry + maxSpan,
      roofY,
      bottomY,
      1e6,
      0.0,
      gl_FragCoord.xy
    );

    if (cloud.a < 0.004) discard;
    gl_FragColor = cloud;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const _sunDirVec = new THREE.Vector3();
const _colLit = new THREE.Color();
const _colShadow = new THREE.Color();
const _colSun = new THREE.Color();
const _colZenith = new THREE.Color();
const _colHorizon = new THREE.Color();
const _colFog = new THREE.Color();

export function CloudSeaSystem() {
  const qualityTier = useGameStore((s) => s.qualityTier);
  const isMobile = qualityTier === 'mobile';

  const { terrainMap, cloudAtlas } = useMemo(() => createVolumetricCloudTextures(), []);

  useEffect(() => {
    volumetricCloudSharedUniforms.uTerrainMap.value = terrainMap;
    volumetricCloudSharedUniforms.uCloudAtlas.value = cloudAtlas;
    return () => {
      terrainMap.dispose();
      cloudAtlas.dispose();
    };
  }, [terrainMap, cloudAtlas]);

  const slabGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(4800, 4800, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 95, 0), 4200);
    return geo;
  }, []);

  const mobileSlabMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: volumetricCloudSharedUniforms,
      vertexShader: MOBILE_CLOUD_VERT,
      fragmentShader: MOBILE_CLOUD_FRAG,
      side: THREE.FrontSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
  }, []);

  useEffect(() => {
    return () => {
      slabGeometry.dispose();
      mobileSlabMaterial.dispose();
    };
  }, [slabGeometry, mobileSlabMaterial]);

  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime();
    const atmo = useGameStore.getState().atmosphere;
    const lerpRate = Math.min(1, dt * 3.5);

    _sunDirVec.set(atmo.sunDirection[0], atmo.sunDirection[1], atmo.sunDirection[2]).normalize();
    _colLit.set(atmo.cloudLitHex);
    _colShadow.set(atmo.cloudShadowHex);
    _colSun.set(atmo.sunLightHex);
    _colZenith.set(atmo.skyZenithHex);
    _colHorizon.set(atmo.skyHorizonHex);
    _colFog.set(atmo.fogHex);

    const targetFogDensity =
      atmo.weather === 'deep_evening_fog'
        ? 0.00145
        : atmo.weather === 'light_drizzle'
          ? 0.00135
          : atmo.weather === 'clear_highland_sun'
            ? 0.00062
            : 0.00084;

    const u = volumetricCloudSharedUniforms;
    u.uQualitySteps.value = qualityTier === 'high' ? 20.0 : qualityTier === 'medium' ? 14.0 : 9.0;
    u.uTime.value = t;
    u.uCloudBottomY.value += (atmo.cloudBottomY - u.uCloudBottomY.value) * lerpRate;
    u.uCloudTopY.value += (atmo.cloudTopY - u.uCloudTopY.value) * lerpRate;
    u.uCloudDensity.value += (atmo.cloudDensity - u.uCloudDensity.value) * lerpRate;
    u.uWindStrength.value += (atmo.windStrength - u.uWindStrength.value) * lerpRate;
    u.uGreenhouseIntensity.value += (atmo.greenhouseGlow - u.uGreenhouseIntensity.value) * lerpRate;
    u.uFogDensity.value += (targetFogDensity - u.uFogDensity.value) * lerpRate;
    u.uSunDir.value.lerp(_sunDirVec, lerpRate);
    u.uCloudLitColor.value.lerp(_colLit, lerpRate);
    u.uCloudShadowColor.value.lerp(_colShadow, lerpRate);
    u.uSunLightColor.value.lerp(_colSun, lerpRate);
    u.uSkyZenithColor.value.lerp(_colZenith, lerpRate);
    u.uSkyHorizonColor.value.lerp(_colHorizon, lerpRate);
    u.uFogColor.value.lerp(_colFog, lerpRate);
  });

  // On Desktop/Medium tiers, DaLatVolumetricCloudPass in CinematicPostProcessing renders clouds
  // with 100% hardware DepthTexture occlusion; only render proxy plane on Mobile fallback tier.
  if (!isMobile) {
    return null;
  }

  return (
    <group name="DaLatCloudSeaSystemMobile">
      <mesh
        name="VolumetricCloudOceanMobile"
        geometry={slabGeometry}
        material={mobileSlabMaterial}
        frustumCulled={false}
        renderOrder={10}
      />
    </group>
  );
}
