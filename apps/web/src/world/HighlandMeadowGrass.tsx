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
const PATCH_SPAN = 76.0; // Dense 76m x 76m toroidal sliding meadow carpet around player/camera

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
      const trailClear = smoothstep(2.45, 4.35, dTrail);
      const altitudeMask = smoothstep(68.0, 86.0, h);
      const slopeMask = 1.0 - smoothstep(0.55, 0.92, slope);

      // Keep Cafe Mơ Sương veranda, Campfire ring, Cầu Gỗ bridge & Gác Chè 1927 platform 100% clear!
      const inCafePad =
        wx >= -54.0 && wx <= -22.2 && wz >= 17.8 && wz <= 42.2 ? 0.0 : 1.0;
      const inCauGoPad =
        wx >= 48.5 && wx <= 99.5 && Math.abs(wz - -75.0) <= 8.5 ? 0.0 : 1.0;
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
 * Builds a single curved 7-vertex 3D tapered grass blade (5 triangles = ultra-low vertex cost, rich 3D silhouette).
 */
function createSingleGrassBladeGeometry(): THREE.BufferGeometry {
  const w0 = 0.052;
  const w1 = 0.036;
  const w2 = 0.018;

  // [x, y (0..1), z (natural arch)]
  const positions = new Float32Array([
    -w0, 0.0, 0.0,
     w0, 0.0, 0.0,
    -w1, 0.36, 0.025,
     w1, 0.36, 0.025,
    -w2, 0.72, 0.075,
     w2, 0.72, 0.075,
     0.0, 1.0, 0.145,
  ]);

  const normals = new Float32Array([
    -0.25, 0.25, 0.93,
     0.25, 0.25, 0.93,
    -0.22, 0.35, 0.91,
     0.22, 0.35, 0.91,
    -0.18, 0.48, 0.86,
     0.18, 0.48, 0.86,
     0.0,  0.65, 0.76,
  ]);

  const indices = new Uint16Array([
    0, 1, 2,
    1, 3, 2,
    2, 3, 4,
    3, 5, 4,
    4, 5, 6,
  ]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

const GRASS_VERT = /* glsl */ `
  attribute vec4 aBladeInstance; // x: offsetX, y: offsetZ, z: rotYaw, w: scaleVar

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

    // 1. Toroidal wrap in [-38m, +38m] around camera/player (100% GPU, zero CPU updates!)
    float patchSpan = ${PATCH_SPAN.toFixed(1)};
    vec2 cellXZ = floor((uFocusPos.xz - aBladeInstance.xy) / patchSpan + 0.5) * patchSpan + aBladeInstance.xy;

    // Fast horizontal camera-frustum cone culling: skip blades behind the camera before texture fetch!
    vec2 fromCamXZ = cellXZ - uCamPos.xz;
    float camDistSqXZ = dot(fromCamXZ, fromCamXZ);
    if (camDistSqXZ > 20.0) {
      float invCamDist = inversesqrt(camDistSqXZ);
      if (dot(fromCamXZ * invCamDist, uCamForwardXZ) < -0.28) {
        gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
        vWorldPos = vec3(0.0);
        vWorldNormal = vec3(0.0, 1.0, 0.0);
        return;
      }
    }

    // Distance fade near outer rim of 76m grass carpet so blades taper seamlessly into distant hillsides
    float focusDist = length(cellXZ - uFocusPos.xz);
    float rimScale = 1.0 - smoothstep(25.5, 37.2, focusDist);
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

    // Cull cleanly on wooden decks, basalt trail cores, and steep cliffs
    float activeMask = smoothstep(0.14, 0.42, density) * rimScale;
    if (activeMask <= 0.01) {
      gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
      vWorldPos = vec3(0.0);
      vWorldNormal = vec3(0.0, 1.0, 0.0);
      return;
    }

    float bladeHeight = (0.35 + aBladeInstance.w * 0.31 + vPinkMask * 0.16) * activeMask;
    float bladeWidth = 1.08 + aBladeInstance.w * 0.56;

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
    vWorldNormal = normalize(mix(rotN, vec3(0.0, 1.0, 0.0), 0.58));

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
  uniform float uLinearHdrOutput;

  varying float vBladeH;
  varying float vPinkMask;
  varying float vColorSeed;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vWorldPos);

    // Rich painterly Da Lat pine-meadow palette: deep mossy root -> sunlit olive-emerald tip!
    vec3 rootGreen = mix(vec3(0.052, 0.108, 0.068), vec3(0.072, 0.132, 0.076), vColorSeed);
    vec3 tipGreen  = mix(vec3(0.155, 0.305, 0.135), vec3(0.245, 0.385, 0.155), vColorSeed);
    vec3 albedo = mix(rootGreen, tipGreen, smoothstep(0.05, 0.95, vBladeH));

    // Secret Hõm Cỏ Tuyết (frosty silver-dew before 05:15) -> Cỏ Hồng (rose-pink sunrise!)
    if (vPinkMask > 0.02) {
      vec3 snowTip = vec3(0.76, 0.85, 0.95);
      vec3 roseTip = vec3(0.92, 0.42, 0.62);
      vec3 magicTip = mix(snowTip, roseTip, uPinkPhase);
      albedo = mix(albedo, mix(albedo * 0.75, magicTip, smoothstep(0.18, 0.92, vBladeH)), vPinkMask * 0.92);
    }

    // Hemisphere + Direct Sun + Golden Subsurface Backlight Translucency!
    float ndl = clamp(dot(N, L) * 0.65 + 0.35, 0.0, 1.0);
    float rootAO = mix(0.46, 1.0, smoothstep(0.0, 0.65, vBladeH));
    float forwardScatter = pow(clamp(dot(-V, L), 0.0, 1.0), 3.2) * vBladeH;

    vec3 ambient = mix(vec3(0.10, 0.13, 0.17), uHorizonColor * 0.48, 0.58);
    vec3 direct = uSunColor * (ndl * uSunIntensity * 0.62);
    vec3 sssGlow = uSunColor * forwardScatter * uSunIntensity * 0.58;

    vec3 color = albedo * (ambient + direct) * rootAO + albedo * sssGlow;

    // Subtle morning dew specular glint on blade tips
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 28.0) * vBladeH * 0.14 * uSunIntensity;
    color += uSunColor * spec;

    // Exponential highland fog blend matching terrain 1:1
    float camDist = length(vWorldPos - cameraPosition);
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

export function HighlandMeadowGrass() {
  const qualityTier = useGameStore((s) => s.qualityTier);
  const bladeCount = qualityTier === 'high' ? 48000 : qualityTier === 'medium' ? 24000 : 10000;

  const terrainTex = useMemo(() => buildGrassTerrainTexture(), []);

  const { instancedGeo, grassMat } = useMemo(() => {
    const baseBlade = createSingleGrassBladeGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = baseBlade.index;
    geo.attributes.position = baseBlade.attributes.position;
    geo.attributes.normal = baseBlade.attributes.normal;

    const instData = new Float32Array(bladeCount * 4);
    const gridN = Math.ceil(Math.sqrt(bladeCount));
    const step = PATCH_SPAN / gridN;

    for (let i = 0; i < bladeCount; i++) {
      const gx = i % gridN;
      const gz = Math.floor(i / gridN);
      const jx = (gx + seeded(i * 3 + 1)) * step - PATCH_SPAN * 0.5;
      const jz = (gz + seeded(i * 3 + 2)) * step - PATCH_SPAN * 0.5;
      instData[i * 4] = jx;
      instData[i * 4 + 1] = jz;
      instData[i * 4 + 2] = seeded(i * 5 + 3) * Math.PI * 2;
      instData[i * 4 + 3] = seeded(i * 7 + 5);
    }

    geo.setAttribute('aBladeInstance', new THREE.InstancedBufferAttribute(instData, 4));
    geo.instanceCount = bladeCount;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1500);
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

    return { instancedGeo: geo, grassMat: mat };
  }, [bladeCount, terrainTex]);

  useEffect(() => {
    grassMat.uniforms.uLinearHdrOutput.value = qualityTier === 'mobile' ? 0.0 : 1.0;
  }, [qualityTier, grassMat]);

  useEffect(() => {
    return () => {
      instancedGeo.dispose();
      grassMat.dispose();
    };
  }, [instancedGeo, grassMat]);

  useEffect(() => {
    return () => {
      terrainTex.dispose();
    };
  }, [terrainTex]);

  const meshRef = useRef<THREE.Mesh>(null);

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
    <mesh
      ref={meshRef}
      name="HighlandMeadowGrassCarpet"
      geometry={instancedGeo}
      material={grassMat}
      frustumCulled={false}
    />
  );
}
