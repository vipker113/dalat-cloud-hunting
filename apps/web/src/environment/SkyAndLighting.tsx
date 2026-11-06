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

  varying vec3 vWorldDir;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
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

    // Smooth upper sky zenith-horizon interpolation + lower valley mist bowl
    float up = clamp(dir.y, 0.0, 1.0);
    float zenithCurve = pow(up, 0.58);
    vec3 skyCol = mix(uHorizonColor, uZenithColor, zenithCurve);

    // Warm horizon atmospheric belt near y = 0
    float horizonBand = exp(-abs(dir.y) * 7.5);
    skyCol = mix(skyCol, mix(uHorizonColor, uFogColor, 0.32), horizonBand * 0.42);

    // Below-horizon valley haze bowl
    if (dir.y < 0.0) {
      float downBlend = smoothstep(0.0, -0.22, dir.y);
      skyCol = mix(skyCol, uFogColor, downBlend);
    }

    // East Sunrise Solar Disc & Multi-Lobe Mie Golden Halo
    float cosSun = dot(dir, sunDir);
    float sunAboveMask = smoothstep(-0.14, 0.05, sunDir.y);

    // Broad warm Mie atmospheric scatter around East horizon
    float mieWide = pow(max(cosSun, 0.0), 5.0) * (0.28 + 0.34 * uIsSunrise);
    float mieTight = pow(max(cosSun, 0.0), 38.0) * (0.45 + 0.45 * sunAboveMask);
    // Crisp limb-darkened solar disc
    float solarDisc = smoothstep(0.99935, 0.99982, cosSun) * smoothstep(-0.04, 0.02, dir.y) * sunAboveMask;

    skyCol += uSunColor * (mieWide + mieTight) * smoothstep(-0.22, 0.08, dir.y);
    skyCol += mix(uSunColor, vec3(1.0, 0.98, 0.92), 0.65) * solarDisc * 3.4;

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
    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    // Screen-space dithering (+-1/255) eliminates pre-dawn & dusk 8-bit twilight banding
    float dither = (ignDither(gl_FragCoord.xy) - 0.5) * (2.0 / 255.0);
    gl_FragColor.rgb = clamp(gl_FragColor.rgb + vec3(dither), 0.0, 1.0);
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
const _cGroundFill = new THREE.Color('#3D312A');
const _vSunDir = new THREE.Vector3();

function computeStarVisibility(gameHour: number): number {
  // Visible before 05:15 AM and after 18:40 PM with silky twilight fade
  if (gameHour < 4.75) return 1.0;
  if (gameHour < 5.15) return 1.0 - (gameHour - 4.75) / 0.4;
  if (gameHour > 18.85) return 1.0;
  if (gameHour > 18.4) return (gameHour - 18.4) / 0.45;
  return 0.0;
}

export function SkyAndLighting() {
  const { scene } = useThree();
  const qualityTier = useGameStore((s) => s.qualityTier);

  const skyMeshRef = useRef<THREE.Mesh>(null);
  const dirLightRef = useRef<THREE.DirectionalLight>(null);
  const dirTargetRef = useRef<THREE.Object3D>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight>(null);
  const drizzleMeshRef = useRef<THREE.InstancedMesh>(null);

  const shadowMapSize = qualityTier === 'high' ? 2048 : qualityTier === 'medium' ? 1024 : 512;

  // 1. Sky Dome Geometry & ShaderMaterial
  const { skyGeometry, skyMaterial } = useMemo(() => {
    const geo = new THREE.SphereGeometry(SKY_RADIUS, 48, 32);
    const initAtmo = useGameStore.getState().atmosphere;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uZenithColor: { value: new THREE.Color(initAtmo.skyZenithHex) },
        uHorizonColor: { value: new THREE.Color(initAtmo.skyHorizonHex) },
        uFogColor: { value: new THREE.Color(initAtmo.fogHex) },
        uSunColor: { value: new THREE.Color(initAtmo.sunLightHex) },
        uSunDir: { value: new THREE.Vector3(...initAtmo.sunDirection) },
        uStarVisibility: { value: computeStarVisibility(initAtmo.gameHour) },
        uIsSunrise: { value: initAtmo.isSunriseWindow ? 1.0 : 0.0 },
        uTime: { value: 0 },
      },
      vertexShader: SKY_DOME_VERT,
      fragmentShader: SKY_DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      toneMapped: true,
    });
    return { skyGeometry: geo, skyMaterial: mat };
  }, []);

  // 2. Highland Drizzle 500-Streak InstancedMesh
  const { drizzleGeometry, drizzleMaterial, drizzleSeeds } = useMemo(() => {
    const geo = new THREE.BoxGeometry(0.018, 1.0, 0.018);
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
    const fog = new THREE.FogExp2(initAtmo.fogHex, 0.00095);
    scene.fog = fog;
    fogRef.current = fog;
    return () => {
      if (scene.fog === fog) {
        scene.fog = null;
      }
      fogRef.current = null;
    };
  }, [scene]);

  // Link directional light target & resize shadow map cleanly on qualityTier changes
  useEffect(() => {
    const light = dirLightRef.current;
    const target = dirTargetRef.current;
    if (!light || !target) return;

    light.target = target;
    target.position.set(-10, 115, -15);
    target.updateMatrixWorld();

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
  }, [shadowMapSize]);

  // Dispose geometries & materials on unmount
  useEffect(() => {
    return () => {
      skyGeometry.dispose();
      skyMaterial.dispose();
      drizzleGeometry.dispose();
      drizzleMaterial.dispose();
    };
  }, [skyGeometry, skyMaterial, drizzleGeometry, drizzleMaterial]);

  useFrame(({ clock, camera }, dt) => {
    const t = clock.getElapsedTime();
    const atmo = useGameStore.getState().atmosphere;
    const lerpRate = Math.min(1, dt * 3.5);

    _cZenith.set(atmo.skyZenithHex);
    _cHorizon.set(atmo.skyHorizonHex);
    _cFog.set(atmo.fogHex);
    _cSun.set(atmo.sunLightHex);
    _vSunDir.set(atmo.sunDirection[0], atmo.sunDirection[1], atmo.sunDirection[2]).normalize();

    // Keep sky dome centered on camera so horizon distance is invariant
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

    // Update Directional Sun Light (anchored to playable ridge center (-10, 115, -15) + sunDirection * 320)
    const dirLight = dirLightRef.current;
    if (dirLight) {
      const clampedSunY = Math.max(0.11, _vSunDir.y);
      dirLight.position.set(
        -10 + _vSunDir.x * 320,
        115 + clampedSunY * 320,
        -15 + _vSunDir.z * 320
      );
      dirLight.color.lerp(_cSun, lerpRate);
      dirLight.intensity += (atmo.sunIntensity - dirLight.intensity) * lerpRate;
    }

    // Update Hemisphere Sky/Ground Fill Light
    const hemi = hemiLightRef.current;
    if (hemi) {
      hemi.color.lerp(_cHorizon, lerpRate);
      hemi.groundColor.copy(_cGroundFill);
      hemi.intensity += (atmo.ambientIntensity - hemi.intensity) * lerpRate;
    }

    // Update Scene Exponential Fog
    const fog = fogRef.current;
    if (fog) {
      fog.color.lerp(_cFog, lerpRate);
      const targetDensity =
        atmo.weather === 'deep_evening_fog'
          ? 0.00195
          : atmo.weather === 'light_drizzle'
            ? 0.00165
            : atmo.weather === 'morning_mist_boil'
              ? 0.00118
              : atmo.weather === 'clear_highland_sun'
                ? 0.00062
                : 0.00088;
      fog.density += (targetDensity - fog.density) * lerpRate;
    }

    // Update 500-Streak Light Highland Drizzle around camera (zero allocations)
    const drizzleMesh = drizzleMeshRef.current;
    if (drizzleMesh) {
      const activeDrizzle = atmo.drizzleIntensity > 0.05;
      drizzleMesh.visible = activeDrizzle;

      if (activeDrizzle) {
        drizzleMaterial.opacity = Math.min(0.42, atmo.drizzleIntensity * 0.38);
        const slantZ = 0.08 + atmo.windStrength * 0.11;
        const slantX = -0.12 - atmo.windStrength * 0.14;

        const camX = camera.position.x;
        const camY = camera.position.y;
        const camZ = camera.position.z;
        const halfXZ = DRIZZLE_BOX_XZ * 0.5;

        for (let i = 0; i < DRIZZLE_COUNT; i++) {
          const s = drizzleSeeds[i];
          const fallDist = t * s.speed;

          // Wrap seamlessly around camera box
          let relY = ((s.oy - fallDist) % DRIZZLE_BOX_Y + DRIZZLE_BOX_Y) % DRIZZLE_BOX_Y - 10;
          let relX =
            (((s.ox - fallDist * 0.16 - camX) % DRIZZLE_BOX_XZ) + DRIZZLE_BOX_XZ) %
              DRIZZLE_BOX_XZ -
            halfXZ;
          let relZ =
            (((s.oz + fallDist * 0.09 - camZ) % DRIZZLE_BOX_XZ) + DRIZZLE_BOX_XZ) %
              DRIZZLE_BOX_XZ -
            halfXZ;

          _skyDummy.position.set(camX + relX, camY + relY, camZ + relZ);
          _skyDummy.rotation.set(slantZ, 0, slantX);
          _skyDummy.scale.set(1, s.len, 1);
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

      <object3D ref={dirTargetRef} position={[-10, 115, -15]} />

      <directionalLight
        ref={dirLightRef}
        castShadow
        position={[240, 220, 45]}
        intensity={1.6}
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
        shadow-camera-left={-190}
        shadow-camera-right={190}
        shadow-camera-top={190}
        shadow-camera-bottom={-190}
        shadow-camera-near={20}
        shadow-camera-far={720}
      />

      <hemisphereLight
        ref={hemiLightRef}
        args={['#FFD194', '#3D312A', 0.65]}
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
