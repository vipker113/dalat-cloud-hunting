import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleGroundHeight, WORLD_CONSTANTS } from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';

const MAP_RES = 256;
const WORLD_HALF = WORLD_CONSTANTS.HALF_SIZE; // 450m
const WORLD_SPAN = WORLD_HALF * 2; // 900m
const HEIGHT_ENCODE_MAX = 240.0;
const SLAB_HALF_EXTENT = 1400.0;
const WISP_COUNT = 90;
const MOBILE_SHELL_COUNT = 10;

// Deterministic Thai Phien chrysanthemum greenhouse clusters in Eastern/SE valley
// x in [135, 385], z in [-50, 235]
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

/**
 * Prebakes 256x256 terrain height + windward orographic lift DataTexture
 * and 256x256 Thai Phien 2,700K greenhouse irradiance DataTexture once on startup.
 */
function createCloudPrebakedTextures(): {
  terrainHeightMap: THREE.DataTexture;
  greenhouseGlowMap: THREE.DataTexture;
} {
  const terrainData = new Uint8Array(MAP_RES * MAP_RES * 4);
  const glowData = new Uint8Array(MAP_RES * MAP_RES * 4);

  for (let iy = 0; iy < MAP_RES; iy++) {
    const v = (iy + 0.5) / MAP_RES;
    const wz = -WORLD_HALF + v * WORLD_SPAN;

    for (let ix = 0; ix < MAP_RES; ix++) {
      const u = (ix + 0.5) / MAP_RES;
      const wx = -WORLD_HALF + u * WORLD_SPAN;
      const idx = (iy * MAP_RES + ix) * 4;

      const h = sampleGroundHeight(wx, wz);
      // Wind blows East/ENE -> West/WSW, climbing up toward -X / +Z ridges
      const hUpwind = sampleGroundHeight(wx + 16, wz - 5);
      const hDownwind = sampleGroundHeight(wx - 16, wz + 5);
      const windwardSlope = clamp01((hDownwind - hUpwind + 4) / 28);
      const ridgeCrest = windwardSlope * smoothstepJS(32, 95, h) * smoothstepJS(195, 115, h);
      const valleyOpenness = smoothstepJS(120, 38, h);

      terrainData[idx] = Math.round(clamp01(h / HEIGHT_ENCODE_MAX) * 255);
      terrainData[idx + 1] = Math.round(clamp01(ridgeCrest) * 255);
      terrainData[idx + 2] = Math.round(valleyOpenness * 255);
      terrainData[idx + 3] = 255;

      // Thai Phien greenhouse irradiance in Eastern/SE valley x in [135, 385], z in [-50, 235]
      let irradiance = 0;
      if (wx >= 115 && wx <= 410 && wz >= -75 && wz <= 260) {
        const valleyMask = smoothstepJS(70, 36, h);
        let clusterSum = 0;
        for (let c = 0; c < GREENHOUSE_CLUSTERS.length; c++) {
          const cl = GREENHOUSE_CLUSTERS[c];
          const dx = (wx - cl.cx) / cl.rx;
          const dz = (wz - cl.cz) / cl.rz;
          clusterSum += cl.weight * Math.exp(-(dx * dx + dz * dz));
        }
        // Subtle agricultural terrace row texture diffused through valley mist
        const rowPattern =
          0.78 +
          0.22 *
            Math.sin(wx * 0.21 + wz * 0.08) *
            Math.cos(wz * 0.19 - wx * 0.05);
        irradiance = clamp01(clusterSum * 0.82 * valleyMask * rowPattern);
      }

      // Warm 2,700K sodium/LED chrysanthemum night-break amber (#FFB347 -> #FFA230)
      glowData[idx] = Math.round(irradiance * 255);
      glowData[idx + 1] = Math.round(irradiance * 182);
      glowData[idx + 2] = Math.round(irradiance * 74);
      glowData[idx + 3] = Math.round(irradiance * 255);
    }
  }

  const terrainHeightMap = new THREE.DataTexture(
    terrainData,
    MAP_RES,
    MAP_RES,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  terrainHeightMap.minFilter = THREE.LinearFilter;
  terrainHeightMap.magFilter = THREE.LinearFilter;
  terrainHeightMap.wrapS = THREE.ClampToEdgeWrapping;
  terrainHeightMap.wrapT = THREE.ClampToEdgeWrapping;
  terrainHeightMap.generateMipmaps = false;
  terrainHeightMap.needsUpdate = true;

  const greenhouseGlowMap = new THREE.DataTexture(
    glowData,
    MAP_RES,
    MAP_RES,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  greenhouseGlowMap.minFilter = THREE.LinearFilter;
  greenhouseGlowMap.magFilter = THREE.LinearFilter;
  greenhouseGlowMap.wrapS = THREE.ClampToEdgeWrapping;
  greenhouseGlowMap.wrapT = THREE.ClampToEdgeWrapping;
  greenhouseGlowMap.generateMipmaps = false;
  greenhouseGlowMap.needsUpdate = true;

  return { terrainHeightMap, greenhouseGlowMap };
}

const SHARED_CLOUD_NOISE_GLSL = /* glsl */ `
  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }

  float valueNoise3D(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);

    float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);

    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);

    return mix(nxy0, nxy1, f.z);
  }

  float cloudFbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.54;
    vec3 q = p;
    for (int i = 0; i < 4; i++) {
      sum += amp * valueNoise3D(q);
      q = q * 2.07 + vec3(13.7, -7.3, 5.9);
      amp *= 0.48;
    }
    return sum;
  }

  float henyeyGreenstein(float cosTheta, float g) {
    float g2 = g * g;
    float denom = max(1e-4, pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
    return (1.0 - g2) / (4.0 * 3.14159265 * denom);
  }

  // Dual-Lobe Henyey-Greenstein phase function (gf = 0.76, gb = -0.28)
  float dualLobeHG(float cosTheta) {
    float forwardLobe = henyeyGreenstein(cosTheta, 0.76);
    float backLobe = henyeyGreenstein(cosTheta, -0.28);
    return mix(backLobe, forwardLobe, 0.72);
  }

  // Terrain sample across [-450, 450] with smooth valley roll-off outside playable domain
  vec3 sampleWorldTerrain(sampler2D heightTex, vec2 xz) {
    vec2 uv = (xz + 450.0) / 900.0;
    vec2 clampedUv = clamp(uv, 0.002, 0.998);
    vec4 tex = texture2D(heightTex, clampedUv);

    vec2 outsideDist = max(abs(xz) - 450.0, vec2(0.0));
    float outFade = exp(-length(outsideDist) * 0.0045);

    // Keep western distant ridge gently elevated while eastern basin opens wide
    float farBase = mix(16.0, 96.0, smoothstep(80.0, -520.0, xz.x));
    float h = mix(farBase, tex.r * 240.0, outFade);
    float orographicLift = tex.g * outFade;
    float valleyOpen = mix(0.95, tex.b, outFade);
    return vec3(h, orographicLift, valleyOpen);
  }

  vec3 sampleGreenhouseIrradiance(sampler2D glowTex, vec2 xz) {
    vec2 uv = (xz + 450.0) / 900.0;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      return vec3(0.0);
    }
    vec4 g = texture2D(glowTex, uv);
    // Warm #FFB347 (2,700K amber) irradiance
    return vec3(1.0, 0.68, 0.24) * g.a;
  }
`;

const VOLUMETRIC_CLOUD_VERT = /* glsl */ `
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const VOLUMETRIC_CLOUD_FRAG = /* glsl */ `
  uniform sampler2D uTerrainHeightMap;
  uniform sampler2D uGreenhouseGlowMap;
  uniform float uTime;
  uniform float uCloudBottomY;
  uniform float uCloudTopY;
  uniform float uSlabMinY;
  uniform float uSlabMaxY;
  uniform float uCloudDensity;
  uniform float uWindStrength;
  uniform float uGreenhouseIntensity;
  uniform vec3 uSunDir;
  uniform vec3 uCloudLitColor;
  uniform vec3 uCloudShadowColor;
  uniform vec3 uSunLightColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform mat4 uViewProjMatrix;

  varying vec3 vWorldPos;

  ${SHARED_CLOUD_NOISE_GLSL}

  float interleavedGradientNoise(vec2 screenPos) {
    vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(screenPos, magic.xy)));
  }

  vec2 intersectCloudBox(vec3 ro, vec3 rd, vec3 boxMin, vec3 boxMax) {
    vec3 safeRd = vec3(
      abs(rd.x) < 1e-5 ? (rd.x < 0.0 ? -1e-5 : 1e-5) : rd.x,
      abs(rd.y) < 1e-5 ? (rd.y < 0.0 ? -1e-5 : 1e-5) : rd.y,
      abs(rd.z) < 1e-5 ? (rd.z < 0.0 ? -1e-5 : 1e-5) : rd.z
    );
    vec3 invRd = 1.0 / safeRd;
    vec3 t0 = (boxMin - ro) * invRd;
    vec3 t1 = (boxMax - ro) * invRd;
    vec3 tSmaller = min(t0, t1);
    vec3 tBigger = max(t0, t1);
    float tNear = max(max(tSmaller.x, tSmaller.y), tSmaller.z);
    float tFar = min(min(tBigger.x, tBigger.y), tBigger.z);
    return vec2(max(tNear, 0.0), tFar);
  }

  float evaluateCloudDensity(vec3 pos, vec3 terrainInfo, out float heightFrac, out float localBottom) {
    float terrainH = terrainInfo.x;
    float orographicCrest = terrainInfo.y;
    float valleyOpen = terrainInfo.z;

    // Orographic Lift: clouds push up windward ridges (+16m) & cascade softly down saddles
    float liftMeters = orographicCrest * 17.5 + smoothstep(42.0, 98.0, terrainH) * 6.5;
    localBottom = max(uCloudBottomY, terrainH - 3.0);
    float localTop = uCloudTopY + liftMeters;

    float thickness = max(14.0, localTop - localBottom);
    heightFrac = clamp((pos.y - localBottom) / thickness, 0.0, 1.0);

    if (pos.y <= localBottom || pos.y >= localTop + 10.0) {
      return 0.0;
    }

    // Drift East-to-West / ENE-to-WSW across the valley
    float windSpeed = 3.2 + uWindStrength * 4.4;
    vec3 windDrift = vec3(-uTime * windSpeed, sin(uTime * 0.14) * 1.1, uTime * windSpeed * 0.28);

    // Macro cumulus billows + secondary turbulent curls
    vec3 sampleMacro = (pos + windDrift) * vec3(0.0058, 0.0135, 0.0058);
    float fbmMacro = cloudFbm(sampleMacro);

    vec3 sampleDetail = (pos + windDrift * 1.38) * vec3(0.0175, 0.028, 0.0175);
    float fbmDetail = valueNoise3D(sampleDetail) * 0.65 + valueNoise3D(sampleDetail * 2.15) * 0.35;

    // Rounded anvil-cumulus vertical profile: soft belly, lush middle, sculpted billowing crowns
    float bottomProfile = smoothstep(0.0, 0.22, heightFrac);
    float topProfile = 1.0 - smoothstep(0.56, 1.0, heightFrac);
    float verticalEnvelope = bottomProfile * topProfile;

    float baseField = fbmMacro * 0.76 + fbmDetail * 0.24;
    // Crest waves intensify near windward slopes
    baseField += orographicCrest * 0.14 + valleyOpen * 0.07;

    float coverageThreshold = mix(0.64, 0.31, uCloudDensity);
    float rawDensity = smoothstep(coverageThreshold, coverageThreshold + 0.34, baseField) * verticalEnvelope;

    // Soft terrain shoreline feathering so clouds kiss hillsides without harsh clipping
    float terrainClearance = smoothstep(0.0, 6.5, pos.y - terrainH);
    // Horizontal world-edge feathering near +-1400m
    float edgeDist = max(abs(pos.x), abs(pos.z));
    float horizonFade = 1.0 - smoothstep(1050.0, 1390.0, edgeDist);

    return rawDensity * terrainClearance * horizonFade * uCloudDensity;
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorldPos - cameraPosition);

    vec3 boxMin = vec3(-${SLAB_HALF_EXTENT.toFixed(1)}, uSlabMinY, -${SLAB_HALF_EXTENT.toFixed(1)});
    vec3 boxMax = vec3(${SLAB_HALF_EXTENT.toFixed(1)}, uSlabMaxY, ${SLAB_HALF_EXTENT.toFixed(1)});

    vec2 hit = intersectCloudBox(ro, rd, boxMin, boxMax);
    float tEnter = hit.x;
    float tExit = min(hit.y, tEnter + 780.0);

    if (tExit <= tEnter + 0.05) {
      discard;
    }

    const int STEPS = 22;
    float marchSpan = tExit - tEnter;
    float stepLen = marchSpan / float(STEPS);
    float jitter = interleavedGradientNoise(gl_FragCoord.xy) * 0.20;

    vec3 sunDir = normalize(uSunDir);
    float sunVis = smoothstep(-0.12, 0.08, sunDir.y);
    float cosTheta = dot(rd, sunDir);
    float phase = dualLobeHG(cosTheta);
    float forwardGlare = pow(max(cosTheta, 0.0), 6.0) * sunVis;

    float transmittance = 1.0;
    vec3 scatteredLight = vec3(0.0);
    float depthWeightedSum = 0.0;
    float weightSum = 0.0;

    for (int i = 0; i < STEPS; i++) {
      if (transmittance < 0.015) break;

      float t = tEnter + (float(i) + 0.4 + jitter) * stepLen;
      vec3 pos = ro + rd * t;

      vec3 terrainInfo = sampleWorldTerrain(uTerrainHeightMap, pos.xz);
      // Terminate ray when hitting solid mountain surface so rising peaks & ridges occlude clouds behind them
      if (pos.y < terrainInfo.x - 0.6) {
        break;
      }

      float heightFrac = 0.0;
      float localBottom = uCloudBottomY;
      float density = evaluateCloudDensity(pos, terrainInfo, heightFrac, localBottom);

      // Gentle camera near-zone fade so close characters & railings stay crisp inside mist
      density *= smoothstep(1.8, 10.5, t);

      if (density > 0.0015) {
        // Single directional sun probe for Beer-Lambert-Powder silver-lining
        vec3 sunProbePos = pos + sunDir * 14.0;
        vec3 sunTerrain = sampleWorldTerrain(uTerrainHeightMap, sunProbePos.xz);
        float dummyH = 0.0;
        float dummyB = 0.0;
        float sunSampleDensity = evaluateCloudDensity(sunProbePos, sunTerrain, dummyH, dummyB);

        float opticalDepthSun = (density * 0.65 + sunSampleDensity * 1.45) * 1.9 + (1.0 - heightFrac) * 0.85;
        float beer = exp(-opticalDepthSun);
        float powder = 1.0 - exp(-opticalDepthSun * 2.15);
        // Beer-Lambert-Powder silver-lining boosts sunlit cloud rims when looking toward East sunrise
        float beerPowder = mix(beer, 2.0 * beer * powder, 0.65);

        vec3 directSun =
          mix(uCloudLitColor, uSunLightColor, 0.42 + 0.35 * forwardGlare) *
          beerPowder *
          (0.62 + 2.45 * phase) *
          (0.14 + 0.86 * sunVis);

        vec3 skyAmbient = mix(uCloudShadowColor, uCloudLitColor, smoothstep(0.08, 0.92, heightFrac)) * (0.42 + 0.24 * sunVis);

        // 2,700K Thai Phien Chrysanthemum Greenhouse under-glow scattering upward through cloud bellies
        vec3 greenhouseColor = vec3(0.0);
        if (uGreenhouseIntensity > 0.002) {
          vec3 ghIrr = sampleGreenhouseIrradiance(uGreenhouseGlowMap, pos.xz);
          float upwardPenetration = exp(-max(0.0, pos.y - localBottom) * 0.011) * (1.35 - 0.35 * heightFrac);
          greenhouseColor = ghIrr * uGreenhouseIntensity * upwardPenetration * 6.8;
        }

        vec3 localRadiance = directSun + skyAmbient + greenhouseColor;

        float sigmaExt = density * 0.058;
        float stepTrans = exp(-sigmaExt * stepLen);
        float stepWeight = transmittance * (1.0 - stepTrans);

        scatteredLight += stepWeight * localRadiance;
        depthWeightedSum += stepWeight * t;
        weightSum += stepWeight;
        transmittance *= stepTrans;
      }
    }

    float alpha = clamp(1.0 - transmittance, 0.0, 1.0);
    if (alpha < 0.004) {
      discard;
    }

    float effectiveT = weightSum > 1e-5 ? max(tEnter, (depthWeightedSum / weightSum) - stepLen * 0.35) : tEnter;

    // Write accurate world depth of the cloud scattering centroid so foreground trees, bridges & peaks depth-sort cleanly
    vec4 effectiveClip = uViewProjMatrix * vec4(ro + rd * effectiveT, 1.0);
    float ndcDepth = effectiveClip.z / max(1e-5, effectiveClip.w);
    gl_FragDepth = clamp(ndcDepth * 0.5 + 0.5, 0.0, 0.99999);

    vec3 finalColor = scatteredLight / max(alpha, 1e-4);

    // Smooth atmospheric fog blend toward distant valley horizon
    float fogFactor = 1.0 - exp(-pow(effectiveT * uFogDensity * 0.82, 2.0));
    finalColor = mix(finalColor, uFogColor, clamp(fogFactor, 0.0, 0.92));

    gl_FragColor = vec4(finalColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const MOBILE_SHELL_VERT = /* glsl */ `
  attribute float aShellFrac;

  uniform sampler2D uTerrainHeightMap;
  uniform float uTime;
  uniform float uCloudBottomY;
  uniform float uCloudTopY;
  uniform float uWindStrength;

  varying float vShellFrac;
  varying vec3 vWorldPos;
  varying float vTerrainH;
  varying float vOrographic;

  ${SHARED_CLOUD_NOISE_GLSL}

  void main() {
    vShellFrac = aShellFrac;
    vec3 worldBase = (modelMatrix * vec4(position, 1.0)).xyz;

    vec3 terrainInfo = sampleWorldTerrain(uTerrainHeightMap, worldBase.xz);
    vTerrainH = terrainInfo.x;
    vOrographic = terrainInfo.y;

    float windSpeed = 3.2 + uWindStrength * 4.4;
    vec2 windShift = vec2(-uTime * windSpeed, uTime * windSpeed * 0.28);
    float billow = cloudFbm(vec3((worldBase.xz + windShift) * 0.0062, aShellFrac * 1.7));

    float liftMeters = vOrographic * 16.5 + smoothstep(42.0, 98.0, vTerrainH) * 5.5;
    float localBottom = uCloudBottomY;
    float localTop = uCloudTopY + liftMeters + (billow - 0.5) * 18.0;

    worldBase.y = mix(localBottom, localTop, aShellFrac);
    vWorldPos = worldBase;

    gl_Position = projectionMatrix * viewMatrix * vec4(worldBase, 1.0);
  }
`;

const MOBILE_SHELL_FRAG = /* glsl */ `
  uniform sampler2D uGreenhouseGlowMap;
  uniform float uTime;
  uniform float uCloudDensity;
  uniform float uWindStrength;
  uniform float uGreenhouseIntensity;
  uniform vec3 uSunDir;
  uniform vec3 uCloudLitColor;
  uniform vec3 uCloudShadowColor;
  uniform vec3 uSunLightColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;

  varying float vShellFrac;
  varying vec3 vWorldPos;
  varying float vTerrainH;
  varying float vOrographic;

  ${SHARED_CLOUD_NOISE_GLSL}

  void main() {
    float terrainClearance = smoothstep(-0.5, 6.5, vWorldPos.y - vTerrainH);
    if (terrainClearance <= 0.01) discard;

    float windSpeed = 3.2 + uWindStrength * 4.4;
    vec3 windDrift = vec3(-uTime * windSpeed, 0.0, uTime * windSpeed * 0.28);
    float fbm = cloudFbm((vWorldPos + windDrift) * vec3(0.0062, 0.014, 0.0062));

    float verticalBell = sin(clamp(vShellFrac, 0.02, 0.98) * 3.14159265);
    float threshold = mix(0.62, 0.30, uCloudDensity) - vOrographic * 0.1;
    float shellAlpha = smoothstep(threshold, threshold + 0.32, fbm) * verticalBell * terrainClearance;

    float edgeFade = 1.0 - smoothstep(900.0, 1200.0, max(abs(vWorldPos.x), abs(vWorldPos.z)));
    shellAlpha *= edgeFade * (0.28 * uCloudDensity + 0.08);

    if (shellAlpha < 0.005) discard;

    vec3 viewDir = normalize(vWorldPos - cameraPosition);
    vec3 sunDir = normalize(uSunDir);
    float phase = dualLobeHG(dot(viewDir, sunDir));
    float powder = 1.0 - exp(-shellAlpha * 5.0);

    vec3 col = mix(uCloudShadowColor, uCloudLitColor, smoothstep(0.1, 0.92, vShellFrac));
    col += uSunLightColor * phase * (0.45 + 0.9 * powder) * smoothstep(0.25, 1.0, vShellFrac);

    if (uGreenhouseIntensity > 0.002) {
      vec3 gh = sampleGreenhouseIrradiance(uGreenhouseGlowMap, vWorldPos.xz);
      col += gh * uGreenhouseIntensity * (1.25 - 0.8 * vShellFrac) * 1.85;
    }

    float dist = length(vWorldPos - cameraPosition);
    float fogFactor = 1.0 - exp(-pow(dist * uFogDensity * 0.85, 2.0));
    col = mix(col, uFogColor, clamp(fogFactor, 0.0, 0.92));

    gl_FragColor = vec4(col, clamp(shellAlpha, 0.0, 0.65));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const WISP_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vDistFade;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
    float dist = length(worldPos.xyz - cameraPosition);
    // Smooth fade when very close to camera or far away
    vDistFade = smoothstep(2.5, 11.0, dist) * (1.0 - smoothstep(145.0, 235.0, dist));
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const WISP_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uCloudDensity;
  uniform vec3 uWispColor;
  uniform vec3 uFogColor;

  varying vec2 vUv;
  varying float vDistFade;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec2 centered = vUv * 2.0 - 1.0;
    float radial = max(0.0, 1.0 - dot(centered * vec2(0.92, 1.35), centered * vec2(0.92, 1.35)));
    radial = radial * radial;

    vec2 flowUv = vUv * vec2(3.2, 1.8) + vec2(-uTime * 0.08, sin(uTime * 0.15 + vUv.x * 3.1) * 0.08);
    float wispy = noise2D(flowUv) * 0.65 + noise2D(flowUv * 2.3 + 4.1) * 0.35;

    float alpha = radial * smoothstep(0.28, 0.82, wispy) * vDistFade * (0.09 + 0.16 * uCloudDensity);
    if (alpha < 0.003) discard;

    vec3 col = mix(uWispColor, uFogColor, 0.25);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface WispSeed {
  anchorX: number;
  anchorZ: number;
  yMode: 'shoreline' | 'cafe_cliff' | 'cau_go_pier';
  yOffset: number;
  driftRadius: number;
  speed: number;
  phase: number;
  scaleX: number;
  scaleY: number;
  yaw: number;
}

// Reusable scratch objects for zero-allocation useFrame updates
const _wispDummy = new THREE.Object3D();
const _viewProjMatrix = new THREE.Matrix4();
const _sunDirVec = new THREE.Vector3();
const _colLit = new THREE.Color();
const _colShadow = new THREE.Color();
const _colSun = new THREE.Color();
const _colFog = new THREE.Color();

export function CloudSeaSystem() {
  const qualityTier = useGameStore((s) => s.qualityTier);
  const isMobile = qualityTier === 'mobile';

  const slabMeshRef = useRef<THREE.Mesh>(null);
  const wispMeshRef = useRef<THREE.InstancedMesh>(null);

  // 1. Prebaked 256x256 DataTextures (generated once, disposed on unmount)
  const { terrainHeightMap, greenhouseGlowMap } = useMemo(() => createCloudPrebakedTextures(), []);

  useEffect(() => {
    return () => {
      terrainHeightMap.dispose();
      greenhouseGlowMap.dispose();
    };
  }, [terrainHeightMap, greenhouseGlowMap]);

  // 2. Tier 1A: Volumetric Raymarched Cloud Slab Geometry & Material
  const slabGeometry = useMemo(
    () => new THREE.BoxGeometry(SLAB_HALF_EXTENT * 2, 1, SLAB_HALF_EXTENT * 2),
    []
  );

  const volumetricMaterial = useMemo(() => {
    const initAtmo = useGameStore.getState().atmosphere;
    return new THREE.ShaderMaterial({
      uniforms: {
        uTerrainHeightMap: { value: terrainHeightMap },
        uGreenhouseGlowMap: { value: greenhouseGlowMap },
        uTime: { value: 0 },
        uCloudBottomY: { value: initAtmo.cloudBottomY },
        uCloudTopY: { value: initAtmo.cloudTopY },
        uSlabMinY: { value: initAtmo.cloudBottomY - 6 },
        uSlabMaxY: { value: initAtmo.cloudTopY + 26 },
        uCloudDensity: { value: initAtmo.cloudDensity },
        uWindStrength: { value: initAtmo.windStrength },
        uGreenhouseIntensity: { value: initAtmo.greenhouseGlow },
        uSunDir: { value: new THREE.Vector3(...initAtmo.sunDirection) },
        uCloudLitColor: { value: new THREE.Color(initAtmo.cloudLitHex) },
        uCloudShadowColor: { value: new THREE.Color(initAtmo.cloudShadowHex) },
        uSunLightColor: { value: new THREE.Color(initAtmo.sunLightHex) },
        uFogColor: { value: new THREE.Color(initAtmo.fogHex) },
        uFogDensity: { value: 0.00095 },
        uViewProjMatrix: { value: new THREE.Matrix4() },
      },
      vertexShader: VOLUMETRIC_CLOUD_VERT,
      fragmentShader: VOLUMETRIC_CLOUD_FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: true,
    });
  }, [terrainHeightMap, greenhouseGlowMap]);

  // 3. Tier 1B: 10 Contoured Sculpted Cloud Shells (Mobile Tier, 1 merged draw call back-to-front)
  const mobileShellsGeometry = useMemo(() => {
    const segs = 56;
    const basePlane = new THREE.PlaneGeometry(2400, 2400, segs, segs);
    basePlane.rotateX(-Math.PI / 2);

    const posAttr = basePlane.getAttribute('position') as THREE.BufferAttribute;
    const idxAttr = basePlane.getIndex()!;
    const vertsPerShell = posAttr.count;
    const indicesPerShell = idxAttr.count;

    const mergedPos = new Float32Array(vertsPerShell * MOBILE_SHELL_COUNT * 3);
    const mergedShellFrac = new Float32Array(vertsPerShell * MOBILE_SHELL_COUNT);
    const mergedIndices = new Uint32Array(indicesPerShell * MOBILE_SHELL_COUNT);

    // Order from bottom shell (0) to top shell (1) so alpha blending composites bottom-to-top cleanly
    for (let s = 0; s < MOBILE_SHELL_COUNT; s++) {
      const frac = s / (MOBILE_SHELL_COUNT - 1);
      const vOffset = s * vertsPerShell;
      const iOffset = s * indicesPerShell;

      mergedPos.set(posAttr.array as Float32Array, vOffset * 3);
      for (let v = 0; v < vertsPerShell; v++) {
        mergedShellFrac[vOffset + v] = frac;
      }
      for (let k = 0; k < indicesPerShell; k++) {
        mergedIndices[iOffset + k] = idxAttr.getX(k) + vOffset;
      }
    }

    basePlane.dispose();

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
    geo.setAttribute('aShellFrac', new THREE.BufferAttribute(mergedShellFrac, 1));
    geo.setIndex(new THREE.BufferAttribute(mergedIndices, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 90, 0), 2200);
    return geo;
  }, []);

  const mobileShellsMaterial = useMemo(() => {
    const initAtmo = useGameStore.getState().atmosphere;
    return new THREE.ShaderMaterial({
      uniforms: {
        uTerrainHeightMap: { value: terrainHeightMap },
        uGreenhouseGlowMap: { value: greenhouseGlowMap },
        uTime: { value: 0 },
        uCloudBottomY: { value: initAtmo.cloudBottomY },
        uCloudTopY: { value: initAtmo.cloudTopY },
        uCloudDensity: { value: initAtmo.cloudDensity },
        uWindStrength: { value: initAtmo.windStrength },
        uGreenhouseIntensity: { value: initAtmo.greenhouseGlow },
        uSunDir: { value: new THREE.Vector3(...initAtmo.sunDirection) },
        uCloudLitColor: { value: new THREE.Color(initAtmo.cloudLitHex) },
        uCloudShadowColor: { value: new THREE.Color(initAtmo.cloudShadowHex) },
        uSunLightColor: { value: new THREE.Color(initAtmo.sunLightHex) },
        uFogColor: { value: new THREE.Color(initAtmo.fogHex) },
        uFogDensity: { value: 0.00095 },
      },
      vertexShader: MOBILE_SHELL_VERT,
      fragmentShader: MOBILE_SHELL_FRAG,
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: true,
    });
  }, [terrainHeightMap, greenhouseGlowMap]);

  // 4. Tier 3: 90 Foreground Soft Procedural Mist Ribbons
  const { wispGeometry, wispMaterial, wispSeeds } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    const initAtmo = useGameStore.getState().atmosphere;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCloudDensity: { value: initAtmo.cloudDensity },
        uWispColor: { value: new THREE.Color(initAtmo.cloudLitHex) },
        uFogColor: { value: new THREE.Color(initAtmo.fogHex) },
      },
      vertexShader: WISP_VERT,
      fragmentShader: WISP_FRAG,
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: true,
    });

    const seeds: WispSeed[] = [];
    const rng = (i: number, salt: number) => {
      const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };

    for (let i = 0; i < WISP_COUNT; i++) {
      if (i < 34) {
        // Group A: Tiệm Cà Phê Mơ Sương cliff & campfire edge
        seeds.push({
          anchorX: -28 + (rng(i, 1) - 0.35) * 65,
          anchorZ: 28 + (rng(i, 2) - 0.5) * 58,
          yMode: 'cafe_cliff',
          yOffset: -12 + rng(i, 3) * 18,
          driftRadius: 8 + rng(i, 4) * 14,
          speed: 0.16 + rng(i, 5) * 0.18,
          phase: rng(i, 6) * Math.PI * 2,
          scaleX: 22 + rng(i, 7) * 26,
          scaleY: 5.5 + rng(i, 8) * 5.5,
          yaw: rng(i, 9) * Math.PI,
        });
      } else if (i < 64) {
        // Group B: Cầu Gỗ Săn Mây summit pier & tea slope saddle
        seeds.push({
          anchorX: 74 + (rng(i, 1) - 0.4) * 68,
          anchorZ: -75 + (rng(i, 2) - 0.5) * 54,
          yMode: 'cau_go_pier',
          yOffset: -16 + rng(i, 3) * 19,
          driftRadius: 9 + rng(i, 4) * 15,
          speed: 0.18 + rng(i, 5) * 0.2,
          phase: rng(i, 6) * Math.PI * 2,
          scaleX: 24 + rng(i, 7) * 28,
          scaleY: 6 + rng(i, 8) * 6,
          yaw: rng(i, 9) * Math.PI,
        });
      } else {
        // Group C: Cloud sea shoreline along eastern ridge & Đài Ngắm Thung Lũng Đèn
        const along = (i - 64) / (WISP_COUNT - 64);
        seeds.push({
          anchorX: -95 + along * 210 + (rng(i, 1) - 0.5) * 32,
          anchorZ: 145 - along * 245 + (rng(i, 2) - 0.5) * 36,
          yMode: 'shoreline',
          yOffset: -4 + rng(i, 3) * 11,
          driftRadius: 11 + rng(i, 4) * 16,
          speed: 0.14 + rng(i, 5) * 0.16,
          phase: rng(i, 6) * Math.PI * 2,
          scaleX: 28 + rng(i, 7) * 32,
          scaleY: 6.5 + rng(i, 8) * 6.5,
          yaw: rng(i, 9) * Math.PI,
        });
      }
    }

    return { wispGeometry: geo, wispMaterial: mat, wispSeeds: seeds };
  }, []);

  useEffect(() => {
    return () => {
      slabGeometry.dispose();
      volumetricMaterial.dispose();
      mobileShellsGeometry.dispose();
      mobileShellsMaterial.dispose();
      wispGeometry.dispose();
      wispMaterial.dispose();
    };
  }, [
    slabGeometry,
    volumetricMaterial,
    mobileShellsGeometry,
    mobileShellsMaterial,
    wispGeometry,
    wispMaterial,
  ]);

  useFrame(({ clock, camera }, dt) => {
    const t = clock.getElapsedTime();
    const atmo = useGameStore.getState().atmosphere;
    const lerpRate = Math.min(1, dt * 3.5);

    _sunDirVec.set(atmo.sunDirection[0], atmo.sunDirection[1], atmo.sunDirection[2]).normalize();
    _colLit.set(atmo.cloudLitHex);
    _colShadow.set(atmo.cloudShadowHex);
    _colSun.set(atmo.sunLightHex);
    _colFog.set(atmo.fogHex);

    const targetFogDensity =
      atmo.weather === 'deep_evening_fog'
        ? 0.0018
        : atmo.weather === 'light_drizzle'
          ? 0.0016
          : atmo.weather === 'clear_highland_sun'
            ? 0.00068
            : 0.00095;

    if (!isMobile) {
      const u = volumetricMaterial.uniforms;
      u.uTime.value = t;
      u.uCloudBottomY.value += (atmo.cloudBottomY - u.uCloudBottomY.value) * lerpRate;
      u.uCloudTopY.value += (atmo.cloudTopY - u.uCloudTopY.value) * lerpRate;
      u.uCloudDensity.value += (atmo.cloudDensity - u.uCloudDensity.value) * lerpRate;
      u.uWindStrength.value += (atmo.windStrength - u.uWindStrength.value) * lerpRate;
      u.uGreenhouseIntensity.value += (atmo.greenhouseGlow - u.uGreenhouseIntensity.value) * lerpRate;
      u.uFogDensity.value += (targetFogDensity - u.uFogDensity.value) * lerpRate;

      const slabMinY = Math.max(6, u.uCloudBottomY.value - 8);
      const slabMaxY = u.uCloudTopY.value + 28;
      u.uSlabMinY.value = slabMinY;
      u.uSlabMaxY.value = slabMaxY;

      u.uSunDir.value.lerp(_sunDirVec, lerpRate);
      u.uCloudLitColor.value.lerp(_colLit, lerpRate);
      u.uCloudShadowColor.value.lerp(_colShadow, lerpRate);
      u.uSunLightColor.value.lerp(_colSun, lerpRate);
      u.uFogColor.value.lerp(_colFog, lerpRate);

      _viewProjMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      u.uViewProjMatrix.value.copy(_viewProjMatrix);

      if (slabMeshRef.current) {
        const slabHeight = Math.max(12, slabMaxY - slabMinY);
        slabMeshRef.current.position.set(0, (slabMinY + slabMaxY) * 0.5, 0);
        slabMeshRef.current.scale.set(1, slabHeight, 1);
      }
    } else {
      const u = mobileShellsMaterial.uniforms;
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
      u.uFogColor.value.lerp(_colFog, lerpRate);
    }

    // Update Tier 3 Foreground Mist Ribbons (zero allocations)
    const wu = wispMaterial.uniforms;
    wu.uTime.value = t;
    wu.uCloudDensity.value += (atmo.cloudDensity - wu.uCloudDensity.value) * lerpRate;
    wu.uWispColor.value.lerp(_colLit, lerpRate);
    wu.uFogColor.value.lerp(_colFog, lerpRate);

    const wispMesh = wispMeshRef.current;
    if (wispMesh) {
      const windFactor = 0.7 + atmo.windStrength * 0.65;
      const cloudCrestY = atmo.cloudTopY;

      for (let i = 0; i < WISP_COUNT; i++) {
        const s = wispSeeds[i];
        const angle = t * s.speed * windFactor + s.phase;
        const wx = s.anchorX - Math.cos(angle) * s.driftRadius;
        const wz = s.anchorZ + Math.sin(angle * 0.78) * s.driftRadius * 0.7;

        let baseY = cloudCrestY;
        if (s.yMode === 'cafe_cliff') {
          baseY = Math.max(122, cloudCrestY + 12);
        } else if (s.yMode === 'cau_go_pier') {
          baseY = 188;
        }
        const wy = baseY + s.yOffset + Math.sin(angle * 1.35) * 1.8;

        _wispDummy.position.set(wx, wy, wz);
        // Gentle billboard-ish tilt toward camera yaw while keeping horizontal ribbon flow
        _wispDummy.rotation.set(
          -0.28 + Math.sin(angle) * 0.08,
          s.yaw + Math.sin(angle * 0.4) * 0.22,
          0
        );
        _wispDummy.scale.set(s.scaleX, s.scaleY, 1);
        _wispDummy.updateMatrix();
        wispMesh.setMatrixAt(i, _wispDummy.matrix);
      }
      wispMesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group name="DaLatCloudSeaSystem">
      {!isMobile ? (
        <mesh
          ref={slabMeshRef}
          geometry={slabGeometry}
          material={volumetricMaterial}
          frustumCulled={false}
          renderOrder={10}
        />
      ) : (
        <mesh
          geometry={mobileShellsGeometry}
          material={mobileShellsMaterial}
          frustumCulled={false}
          renderOrder={10}
        />
      )}

      <instancedMesh
        ref={wispMeshRef}
        args={[wispGeometry, wispMaterial, WISP_COUNT]}
        frustumCulled={false}
        renderOrder={14}
      />
    </group>
  );
}
