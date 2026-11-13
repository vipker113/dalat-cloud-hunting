import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  distanceToTrail,
  fbm2D,
  getSurfaceType,
  sampleGroundHeight,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';

const GRASS_MAP_RES = 256;
const WORLD_HALF = WORLD_CONSTANTS.HALF_SIZE; // 450m
const WORLD_SPAN = WORLD_HALF * 2; // 900m
const GRASS_SECTOR_GRID = 4; // 4x4 world-snapped sectors for hardware frustum culling
const SECTOR_SPAN = 15.5; // 4 x 15.5m = 62m dense velvety carpet (~10x higher blade density per m²!)
const SECTOR_COUNT = GRASS_SECTOR_GRID * GRASS_SECTOR_GRID;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function gaussian2D(x: number, z: number, cx: number, cz: number, rx: number, rz: number): number {
  const dx = (x - cx) / rx;
  const dz = (z - cz) / rz;
  return Math.exp(-(dx * dx + dz * dz));
}

function seeded(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Prebakes a 256x256 HalfFloat DataTexture encoding:
 * - R: Exact float ground height `h` in meters (monotonic hardware LinearFilter — zero 8-bit carry-wrap floating grass!)
 * - G: Grass growth density mask (0 on wooden decks, trails, campfire pit & steep cliffs)
 * - B: Hõm Cỏ Tuyết / Cỏ Hồng magical pink-grass mask
 * - A: 1.0
 */
function buildGrassTerrainTexture(): THREE.DataTexture {
  const data = new Uint16Array(GRASS_MAP_RES * GRASS_MAP_RES * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;

  for (let iy = 0; iy < GRASS_MAP_RES; iy++) {
    const v = (iy + 0.5) / GRASS_MAP_RES;
    const wz = -WORLD_HALF + v * WORLD_SPAN;

    for (let ix = 0; ix < GRASS_MAP_RES; ix++) {
      const u = (ix + 0.5) / GRASS_MAP_RES;
      const wx = -WORLD_HALF + u * WORLD_SPAN;
      const idx = (iy * GRASS_MAP_RES + ix) * 4;

      const h = sampleGroundHeight(wx, wz);

      // Estimate local slope so cliffs don't sprout vertical grass
      const gx = (sampleGroundHeight(wx + 1.2, wz) - sampleGroundHeight(wx - 1.2, wz)) / 2.4;
      const gz = (sampleGroundHeight(wx, wz + 1.2) - sampleGroundHeight(wx, wz - 1.2)) / 2.4;
      const slope = Math.hypot(gx, gz);

      const dTrail = distanceToTrail(wx, wz);
      const trailClear = smoothstep(2.05, 3.18, dTrail);
      const altitudeMask = smoothstep(66.0, 84.0, h);
      const slopeMask = 1.0 - smoothstep(0.82, 1.30, slope);

      // Keep Cafe Mơ Sương veranda, Campfire ring, Cầu Gỗ bridge & Gác Chè 1927 platform 100% clear!
      const inCafePad =
        wx >= -53.2 && wx <= -22.8 && wz >= 18.4 && wz <= 41.6 ? 0.0 : 1.0;
      const inCauGoPad =
        wx >= 49.2 && wx <= 99.2 && Math.abs(wz - -75.0) <= 3.15 ? 0.0 : 1.0;
      const nearCampfire = smoothstep(2.6, 4.4, Math.hypot(wx - -53.0, wz - 24.0));
      const nearGacChe = smoothstep(3.0, 4.8, Math.hypot(wx - -21.0, wz - -181.0));
      const surf = getSurfaceType(wx, wz);
      const deckClear = surf === 'wood_deck' ? 0.0 : 1.0;
      // Shorter trimmed grass between tea hedge rows
      const teaTrim = surf === 'tea_terrace' ? 0.52 : 1.0;

      const clumping = 0.68 + 0.32 * fbm2D(wx * 0.08, wz * 0.08, 2);
      const density = clamp(
        trailClear *
          altitudeMask *
          slopeMask *
          inCafePad *
          inCauGoPad *
          nearCampfire *
          nearGacChe *
          deckClear *
          teaTrim *
          clumping,
        0,
        1
      );

      const pinkGauss = gaussian2D(wx, wz, -12, -175, 42, 38);
      const pinkMask =
        surf === 'pink_grass_meadow'
          ? clamp((pinkGauss - 0.22) * 1.85, 0.45, 1.0)
          : smoothstep(0.28, 0.48, pinkGauss);

      data[idx] = toHalf(h);
      data[idx + 1] = toHalf(density);
      data[idx + 2] = toHalf(clamp(pinkMask, 0, 1));
      data[idx + 3] = toHalf(1.0);
    }
  }

  const tex = new THREE.DataTexture(
    data,
    GRASS_MAP_RES,
    GRASS_MAP_RES,
    THREE.RGBAFormat,
    THREE.HalfFloatType
  );
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds an organic 3-blade alpine grass tussock (21 vertices, 15 triangles).
 * Slender natural blade widths (2.6cm base -> fine arched tip) fanned at asymmetric angles
 * eliminate thick "paper-triangle" silhouettes and deliver 3x lushness with zero extra instance attributes!
 */
function createSingleGrassBladeGeometry(): THREE.BufferGeometry {
  const specs: ReadonlyArray<{
    yaw: number;
    ox: number;
    oz: number;
    hScale: number;
    archScale: number;
    wScale: number;
  }> = [
    { yaw: 0.12, ox: 0.0, oz: 0.0, hScale: 1.0, archScale: 1.15, wScale: 1.05 },
    { yaw: 1.72, ox: 0.055, oz: -0.035, hScale: 0.86, archScale: 1.32, wScale: 0.96 },
    { yaw: 3.35, ox: -0.048, oz: -0.042, hScale: 0.78, archScale: 1.38, wScale: 0.92 },
    { yaw: -1.38, ox: -0.042, oz: 0.052, hScale: 0.68, archScale: 1.46, wScale: 0.88 },
  ];

  const vertsPerBlade = 7;
  const trisPerBlade = 5;
  const positions = new Float32Array(specs.length * vertsPerBlade * 3);
  const normals = new Float32Array(specs.length * vertsPerBlade * 3);
  const indices = new Uint16Array(specs.length * trisPerBlade * 3);

  const baseVerts: ReadonlyArray<[number, number, number]> = [
    [-0.028, 0.0, 0.0],
    [0.028, 0.0, 0.0],
    [-0.021, 0.35, 0.055],
    [0.021, 0.35, 0.055],
    [-0.012, 0.70, 0.155],
    [0.012, 0.70, 0.155],
    [0.0, 0.95, 0.31],
  ];

  const baseNorms: ReadonlyArray<[number, number, number]> = [
    [-0.22, 0.42, 0.88],
    [0.22, 0.42, 0.88],
    [-0.18, 0.56, 0.81],
    [0.18, 0.56, 0.81],
    [-0.12, 0.74, 0.66],
    [0.12, 0.74, 0.66],
    [0.0, 0.9, 0.44],
  ];

  const baseIdx = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6];

  for (let b = 0; b < specs.length; b++) {
    const sp = specs[b];
    const cy = Math.cos(sp.yaw);
    const sy = Math.sin(sp.yaw);
    const vBase = b * vertsPerBlade;
    const iBase = b * trisPerBlade * 3;

    for (let v = 0; v < vertsPerBlade; v++) {
      const [bx, by, bz] = baseVerts[v];
      const lx = bx * sp.wScale;
      const ly = by * sp.hScale;
      const lz = bz * sp.archScale * sp.hScale;

      const rx = lx * cy - lz * sy + sp.ox;
      const rz = lx * sy + lz * cy + sp.oz;

      const [nx, ny, nz] = baseNorms[v];
      const rnx = nx * cy - nz * sy;
      const rnz = nx * sy + nz * cy;

      const o = (vBase + v) * 3;
      positions[o] = rx;
      positions[o + 1] = ly;
      positions[o + 2] = rz;
      normals[o] = rnx;
      normals[o + 1] = ny;
      normals[o + 2] = rnz;
    }

    for (let k = 0; k < baseIdx.length; k++) {
      indices[iBase + k] = vBase + baseIdx[k];
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

const GRASS_VERT = /* glsl */ `
  attribute vec4 aBladeInstance; // x: localOffsetX, y: localOffsetZ, z: rotYaw, w: scaleVar

  uniform sampler2D uGrassTerrainTex;
  uniform vec3 uFocusPos;
  uniform vec3 uPlayerPos;
  uniform vec3 uCamPos;
  uniform vec2 uCamForwardXZ;
  uniform float uTime;
  uniform float uWindStrength;

  varying float vBladeH;
  varying float vPinkMask;
  varying float vColorSeed;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  vec4 sampleGrassField(vec2 worldXZ) {
    vec2 uv = clamp((worldXZ + ${WORLD_HALF.toFixed(1)}) / ${WORLD_SPAN.toFixed(1)}, 0.001, 0.999);
    return texture2D(uGrassTerrainTex, uv);
  }

  void main() {
    vBladeH = clamp(position.y, 0.0, 1.0);
    vColorSeed = aBladeInstance.w;

    // 1. World-snapped 21m x 21m sector tile origin + deterministic blade offset (zero blade swimming!)
    vec2 sectorCenterXZ = modelMatrix[3].xz;
    vec2 cellXZ = sectorCenterXZ + aBladeInstance.xy;

    // Fast horizontal camera-frustum cone culling: skip blades behind the camera before texture fetch!
    vec2 fromCamXZ = cellXZ - uCamPos.xz;
    float camDistSqXZ = dot(fromCamXZ, fromCamXZ);
    if (camDistSqXZ > 16.0) {
      float invCamDist = inversesqrt(camDistSqXZ);
      if (dot(fromCamXZ * invCamDist, uCamForwardXZ) < -0.24) {
        gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
        vWorldPos = vec3(0.0);
        vWorldNormal = vec3(0.0, 1.0, 0.0);
        return;
      }
    }

    // Distance fade inside the 22.8m outer radius so sector hops at >=23.25m are 100% invisible
    float focusDist = length(cellXZ - uFocusPos.xz);
    float rimScale = 1.0 - smoothstep(15.2, 22.8, focusDist);
    if (rimScale <= 0.01) {
      gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
      vWorldPos = vec3(0.0);
      vWorldNormal = vec3(0.0, 1.0, 0.0);
      return;
    }

    vec4 field = sampleGrassField(cellXZ);
    // Exact HalfFloat ground elevation (monotonic hardware LinearFilter — zero floating contour steps!)
    float groundY = field.r;
    float density = field.g;
    vPinkMask = field.b;

    // Cull cleanly on wooden decks, basalt trail cores, steep cliffs, and right against the camera lens
    float camLensDist = length(vec3(cellXZ.x, groundY + 0.18, cellXZ.y) - uCamPos);
    float lensClearMask = smoothstep(0.45, 1.55, camLensDist);
    float activeMask = smoothstep(0.12, 0.38, density) * rimScale * lensClearMask;
    if (activeMask <= 0.01) {
      gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
      vWorldPos = vec3(0.0);
      vWorldNormal = vec3(0.0, 1.0, 0.0);
      return;
    }

    float bladeHeight = (0.24 + aBladeInstance.w * 0.25 + vPinkMask * 0.14) * activeMask;
    float bladeWidth = 0.88 + aBladeInstance.w * 0.34;

    float c = cos(aBladeInstance.z);
    float s = sin(aBladeInstance.z);
    vec3 localPos = vec3(position.x * bladeWidth, position.y * bladeHeight, position.z * bladeHeight);
    vec3 rotatedPos = vec3(
      localPos.x * c - localPos.z * s,
      localPos.y,
      localPos.x * s + localPos.z * c
    );

    // 2. Rolling Da Lat Highland Wind Waves + High-Frequency Flutter
    float bendFactor = vBladeH * vBladeH;
    float gustWave = sin(uTime * (1.65 + uWindStrength * 1.15) - cellXZ.x * 0.14 + cellXZ.y * 0.09)
                   + 0.45 * cos(uTime * 2.8 - cellXZ.x * 0.27 - cellXZ.y * 0.21 + aBladeInstance.z);
    float windAmp = (0.075 + uWindStrength * 0.145) * bendFactor;
    rotatedPos.x -= gustWave * windAmp;
    rotatedPos.z += gustWave * windAmp * 0.42;
    rotatedPos.y -= abs(gustWave) * windAmp * 0.22;

    // 3. Interactive Footstep Trample Bending around Local Player Boots!
    vec2 toPlayer = cellXZ - uPlayerPos.xz;
    float pDist = length(toPlayer);
    if (pDist < 0.95 && abs(groundY - uPlayerPos.y) < 1.2) {
      float push = (1.0 - pDist / 0.95) * bendFactor * 0.34;
      vec2 pushDir = pDist > 0.001 ? (toPlayer / pDist) : vec2(1.0, 0.0);
      rotatedPos.x += pushDir.x * push;
      rotatedPos.z += pushDir.y * push;
      rotatedPos.y *= (1.0 - (1.0 - pDist / 0.95) * 0.45 * vBladeH);
    }

    vec3 worldPos = vec3(cellXZ.x + rotatedPos.x, groundY - 0.018 + rotatedPos.y, cellXZ.y + rotatedPos.z);
    vWorldPos = worldPos;

    vec3 rotN = vec3(normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c);
    vWorldNormal = normalize(mix(rotN, vec3(0.0, 1.0, 0.0), mix(0.64, 0.88, vBladeH)));

    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`;

const GRASS_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uSunIntensity;
  uniform float uPinkPhase;
  uniform float uTime;
  uniform float uLinearHdrOutput;

  varying float vBladeH;
  varying float vPinkMask;
  varying float vColorSeed;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  float grassGrain(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float grassFbm(vec2 p) {
    float s = 0.54 * grassGrain(p);
    s += 0.30 * grassGrain(mat2(0.8, -0.6, 0.6, 0.8) * p * 2.13 + vec2(17.3, 9.1));
    s += 0.16 * grassGrain(mat2(-0.6, 0.8, -0.8, -0.6) * p * 4.37 + vec2(5.7, 31.4));
    return s;
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vWorldPos);

    // Terrain-matched warm highland olive-moss root -> natural dewy sage-meadow tip (zero dark-speck contrast!)
    float patchVar = grassFbm(vWorldPos.xz * 0.085);
    vec3 rootGreen = mix(vec3(0.108, 0.138, 0.064), vec3(0.135, 0.168, 0.078), patchVar);
    vec3 midGreen  = mix(vec3(0.132, 0.186, 0.082), vec3(0.168, 0.224, 0.096), vColorSeed);
    vec3 tipGreen  = mix(vec3(0.185, 0.252, 0.108), vec3(0.245, 0.305, 0.136), patchVar * 0.6 + vColorSeed * 0.4);
    // Occasional sun-bleached warm golden seed-stem accent (~15% of tussocks)
    if (vColorSeed > 0.85) {
      tipGreen = mix(tipGreen, vec3(0.315, 0.295, 0.162), (vColorSeed - 0.85) * 5.2);
    }
    vec3 albedo = mix(rootGreen, mix(midGreen, tipGreen, smoothstep(0.30, 0.96, vBladeH)), smoothstep(0.04, 0.54, vBladeH));

    // Secret Hõm Cỏ Tuyết (frosty silver-dew before 05:15) -> Cỏ Hồng (rose-pink sunrise!)
    if (vPinkMask > 0.02) {
      vec3 snowTip = vec3(0.76, 0.85, 0.95);
      vec3 roseTip = vec3(0.92, 0.42, 0.62);
      vec3 magicTip = mix(snowTip, roseTip, uPinkPhase);
      albedo = mix(albedo, mix(albedo * 0.75, magicTip, smoothstep(0.18, 0.92, vBladeH)), vPinkMask * 0.92);
    }

    // Synced drifting cloud-canopy dapple shadow matching DaLatWorldTerrain 1:1!
    float cloudShadow = smoothstep(0.34, 0.72, grassFbm(vWorldPos.xz * 0.0105 + vec2(uTime * 0.014, -uTime * 0.007)));
    float sunCloudMod = mix(0.48, 1.08, cloudShadow);

    // Hemisphere + Direct Sun + Golden Subsurface Backlight Translucency!
    float ndl = clamp(dot(N, L) * 0.65 + 0.35, 0.0, 1.0);
    float camDist = length(vWorldPos - cameraPosition);
    float distSoft = smoothstep(12.0, 22.8, camDist);
    float rootAO = mix(mix(0.76, 0.92, distSoft), 1.0, smoothstep(0.0, 0.55, vBladeH));
    float forwardScatter = pow(clamp(dot(-V, L), 0.0, 1.0), 2.8) * vBladeH;

    vec3 ambient = mix(vec3(0.095, 0.125, 0.165), uHorizonColor * 0.48, 0.58) * mix(0.86, 1.04, cloudShadow);
    vec3 direct = uSunColor * (ndl * uSunIntensity * 0.64 * sunCloudMod);
    vec3 sssGlow = uSunColor * forwardScatter * uSunIntensity * 0.62 * sunCloudMod;

    vec3 color = albedo * (ambient + direct) * rootAO + albedo * sssGlow;

    // Morning dew sheen on arched blade tips
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 20.0) * vBladeH * 0.09 * uSunIntensity * sunCloudMod;
    color += uSunColor * spec;

    // Exponential highland fog + outer-carpet mist blend matching terrain 1:1
    float fogFactor = 1.0 - exp(-pow(camDist * uFogDensity, 2.0));
    color = mix(color, uFogColor, clamp(fogFactor, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
    if (uLinearHdrOutput < 0.5) {
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  }
`;

const _cSun = new THREE.Color();
const _cHoriz = new THREE.Color();
const _cFog = new THREE.Color();
const _camDir = new THREE.Vector3();
const SECTOR_INDICES = Array.from({ length: SECTOR_COUNT }, (_, idx) => idx);

export function HighlandMeadowGrass() {
  const qualityTier = useGameStore((s) => s.qualityTier);
  const bladesPerSector =
    qualityTier === 'high' ? 4200 : qualityTier === 'medium' ? 2100 : 850;

  const terrainTex = useMemo(() => buildGrassTerrainTexture(), []);

  const { sectorInstancedGeo, grassMat } = useMemo(() => {
    const baseBlade = createSingleGrassBladeGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = baseBlade.index;
    geo.attributes.position = baseBlade.attributes.position;
    geo.attributes.normal = baseBlade.attributes.normal;

    const instData = new Float32Array(bladesPerSector * 4);
    const gridN = Math.ceil(Math.sqrt(bladesPerSector));
    const step = SECTOR_SPAN / gridN;

    for (let i = 0; i < bladesPerSector; i++) {
      const gx = i % gridN;
      const gz = Math.floor(i / gridN);
      const jx = (gx + seeded(i * 3 + 1)) * step - SECTOR_SPAN * 0.5;
      const jz = (gz + seeded(i * 3 + 2)) * step - SECTOR_SPAN * 0.5;
      instData[i * 4] = jx;
      instData[i * 4 + 1] = jz;
      instData[i * 4 + 2] = seeded(i * 5 + 3) * Math.PI * 2;
      instData[i * 4 + 3] = seeded(i * 7 + 5);
    }

    geo.setAttribute('aBladeInstance', new THREE.InstancedBufferAttribute(instData, 4));
    geo.instanceCount = bladesPerSector;
    // Tight 15.5m x 15.5m sector bounding sphere (radius ~16.5m covers diagonal 10.96m + hill elevation delta)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 16.5);
    baseBlade.dispose();

    const initAtmo = useGameStore.getState().atmosphere;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uGrassTerrainTex: { value: terrainTex },
        uFocusPos: { value: new THREE.Vector3(-35, 135, 28) },
        uPlayerPos: { value: new THREE.Vector3(-35, 135, 28) },
        uCamPos: { value: new THREE.Vector3(-35, 135, 28) },
        uCamForwardXZ: { value: new THREE.Vector2(0, -1) },
        uTime: { value: 0 },
        uWindStrength: { value: initAtmo.windStrength },
        uSunDir: { value: new THREE.Vector3(...initAtmo.sunDirection) },
        uSunColor: { value: new THREE.Color(initAtmo.sunLightHex) },
        uHorizonColor: { value: new THREE.Color(initAtmo.skyHorizonHex) },
        uFogColor: { value: new THREE.Color(initAtmo.fogHex) },
        uFogDensity: { value: 0.00088 },
        uSunIntensity: { value: initAtmo.sunIntensity },
        uPinkPhase: { value: 0 },
        uLinearHdrOutput: { value: qualityTier === 'mobile' ? 0.0 : 1.0 },
      },
      vertexShader: GRASS_VERT,
      fragmentShader: GRASS_FRAG,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    return { sectorInstancedGeo: geo, grassMat: mat };
  }, [bladesPerSector, terrainTex]);

  useEffect(() => {
    grassMat.uniforms.uLinearHdrOutput.value = qualityTier === 'mobile' ? 0.0 : 1.0;
  }, [qualityTier, grassMat]);

  useEffect(() => {
    return () => {
      sectorInstancedGeo.dispose();
      grassMat.dispose();
    };
  }, [sectorInstancedGeo, grassMat]);

  useEffect(() => {
    return () => {
      terrainTex.dispose();
    };
  }, [terrainTex]);

  const sectorRefs = useRef<Array<THREE.Mesh | null>>([]);
  const lastSnapKeyRef = useRef<string>('');

  useFrame(({ clock, camera, scene }) => {
    const st = useGameStore.getState();
    const atmo = st.atmosphere;
    const lt = st.localTransient;
    const u = grassMat.uniforms;

    u.uTime.value = clock.getElapsedTime();
    u.uWindStrength.value = atmo.windStrength;

    if (st.hasEnteredWorld && !st.photoModeActive) {
      u.uFocusPos.value.set(lt.x, lt.y, lt.z);
    } else {
      u.uFocusPos.value.copy(camera.position);
    }
    u.uPlayerPos.value.set(lt.x, lt.y, lt.z);
    u.uCamPos.value.copy(camera.position);
    camera.getWorldDirection(_camDir);
    const fwdLen = Math.hypot(_camDir.x, _camDir.z);
    if (fwdLen > 1e-4) {
      u.uCamForwardXZ.value.set(_camDir.x / fwdLen, _camDir.z / fwdLen);
    }

    // Snap 4x4 sector tile origins to world grid so Three.js frustum-culls ~70% of off-camera grass sectors!
    const baseIx = Math.round(u.uFocusPos.value.x / SECTOR_SPAN) - 2;
    const baseIz = Math.round(u.uFocusPos.value.z / SECTOR_SPAN) - 2;
    const snapKey = `${baseIx}:${baseIz}`;
    if (snapKey !== lastSnapKeyRef.current) {
      lastSnapKeyRef.current = snapKey;
      for (let gz = 0; gz < GRASS_SECTOR_GRID; gz++) {
        for (let gx = 0; gx < GRASS_SECTOR_GRID; gx++) {
          const idx = gz * GRASS_SECTOR_GRID + gx;
          const m = sectorRefs.current[idx];
          if (!m) continue;
          const cx = (baseIx + gx + 0.5) * SECTOR_SPAN;
          const cz = (baseIz + gz + 0.5) * SECTOR_SPAN;
          const cy = sampleGroundHeight(cx, cz);
          // Skip entire sector if completely submerged in deep valley below grass altitude line
          m.visible = cy > 62.0;
          m.position.set(cx, cy, cz);
        }
      }
    }

    u.uSunDir.value.set(atmo.sunDirection[0], atmo.sunDirection[1], atmo.sunDirection[2]).normalize();
    _cSun.set(atmo.sunLightHex);
    _cHoriz.set(atmo.skyHorizonHex);
    _cFog.set(atmo.fogHex);

    u.uSunColor.value.copy(_cSun);
    u.uHorizonColor.value.copy(_cHoriz);
    u.uFogColor.value.copy(_cFog);
    u.uSunIntensity.value = atmo.sunIntensity;

    const gh = atmo.gameHour;
    u.uPinkPhase.value = gh >= 5.15 && gh <= 18.2 ? smoothstep(5.12, 5.48, gh) : 0.0;

    if (scene.fog && (scene.fog as THREE.FogExp2).isFogExp2) {
      u.uFogDensity.value = (scene.fog as THREE.FogExp2).density;
    }
  });

  return (
    <group name="HighlandMeadowGrassCarpet">
      {SECTOR_INDICES.map((idx) => (
        <mesh
          key={idx}
          ref={(el) => {
            sectorRefs.current[idx] = el;
            // Reset snap key on remount so sector world positions populate on next frame
            if (el) lastSnapKeyRef.current = '';
          }}
          name={`GrassSector_${idx}`}
          geometry={sectorInstancedGeo}
          material={grassMat}
          frustumCulled
        />
      ))}
    </group>
  );
}
