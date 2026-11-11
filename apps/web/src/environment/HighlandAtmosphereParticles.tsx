import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';

const MOTE_VERT = /* glsl */ `
  attribute vec4 aSeed; // x, y, z normalized [0..1], w = phase

  uniform vec3 uCamPos;
  uniform float uTime;
  uniform float uWindStrength;
  uniform float uPixelRatio;

  varying float vAlpha;
  varying float vTwinkle;

  void main() {
    vec3 span = vec3(34.0, 14.0, 34.0);
    vec3 drift = vec3(
      -uTime * (0.35 + uWindStrength * 0.55) + sin(uTime * 0.65 + aSeed.w * 6.283) * 0.9,
      uTime * 0.14 + cos(uTime * 0.52 + aSeed.w * 9.1) * 0.55,
      sin(uTime * 0.42 + aSeed.w * 12.4) * 0.85
    );

    vec3 local = mod(aSeed.xyz * span + drift - uCamPos + span * 0.5, span) - span * 0.5;
    vec3 worldPos = uCamPos + local;

    float dist = length(local);
    float edgeFade = (1.0 - smoothstep(11.5, 16.8, dist)) * smoothstep(1.1, 3.2, dist);
    vTwinkle = 0.55 + 0.45 * sin(uTime * (1.6 + aSeed.w * 2.2) + aSeed.w * 31.4);
    vAlpha = edgeFade * vTwinkle;

    vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPos;
    gl_PointSize = clamp((24.0 + aSeed.w * 20.0) * uPixelRatio / max(1.0, -mvPos.z), 1.5, 9.0);
  }
`;

const MOTE_FRAG = /* glsl */ `
  uniform vec3 uMoteColor;
  uniform float uOpacity;

  varying float vAlpha;
  varying float vTwinkle;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p) * 2.0;
    if (r > 1.0) discard;
    float softDisc = pow(1.0 - r * r, 2.2);
    float alpha = softDisc * vAlpha * uOpacity;
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(uMoteColor * (1.0 + 0.45 * vTwinkle), alpha);
  }
`;

const EMBER_VERT = /* glsl */ `
  attribute vec4 aSeed; // x: radial, y: lifeOffset, z: angle, w: speed

  uniform float uTime;
  uniform float uWindStrength;
  uniform float uPixelRatio;

  varying float vLife;

  void main() {
    float life = fract(uTime * (0.28 + aSeed.w * 0.34) + aSeed.y);
    vLife = life;

    float height = life * 4.4 + 0.22;
    float swirl = aSeed.z * 6.28318 + life * 4.8 + uTime * 0.9;
    float rad = (0.16 + aSeed.x * 0.56) * (1.0 + life * 0.85);

    vec3 pos = vec3(
      cos(swirl) * rad - life * life * (0.45 + uWindStrength * 0.85),
      height,
      sin(swirl) * rad + life * 0.25
    );

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;
    float sizeFade = sin(life * 3.1415926);
    gl_PointSize = clamp((30.0 * sizeFade + 6.0) * uPixelRatio / max(1.0, -mvPos.z), 1.5, 11.0);
  }
`;

const EMBER_FRAG = /* glsl */ `
  varying float vLife;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p) * 2.0;
    if (r > 1.0) discard;
    float core = pow(1.0 - r, 1.8);
    // HDR glowing ember from bright white-gold at base -> deep orange-red aloft (triggers bloom!)
    vec3 hotCore = vec3(3.2, 1.85, 0.62);
    vec3 coolTip = vec3(2.1, 0.45, 0.08);
    vec3 col = mix(hotCore, coolTip, smoothstep(0.08, 0.88, vLife));
    float alpha = core * sin(vLife * 3.1415926) * 0.92;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

const SMOKE_VERT = /* glsl */ `
  attribute vec4 aSeed;

  uniform float uTime;
  uniform float uWindStrength;
  uniform float uPixelRatio;

  varying float vLife;

  void main() {
    float life = fract(uTime * (0.11 + aSeed.w * 0.06) + aSeed.y);
    vLife = life;

    float h = life * 6.8;
    float sway = aSeed.z * 6.28318 + life * 2.6;
    float spread = 0.18 + life * 1.15;

    vec3 pos = vec3(
      cos(sway) * spread * 0.45 - life * life * (1.2 + uWindStrength * 2.1),
      h,
      sin(sway) * spread * 0.45 + life * 0.55
    );

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;
    gl_PointSize = clamp((65.0 + life * 165.0) * uPixelRatio / max(1.5, -mvPos.z), 4.0, 64.0);
  }
`;

const SMOKE_FRAG = /* glsl */ `
  uniform vec3 uSmokeColor;
  varying float vLife;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p) * 2.0;
    if (r > 1.0) discard;
    float puff = smoothstep(1.0, 0.05, r);
    float fade = smoothstep(0.0, 0.18, vLife) * (1.0 - smoothstep(0.45, 1.0, vLife));
    float alpha = puff * puff * fade * 0.22;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uSmokeColor, alpha);
  }
`;

function seeded(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function makeSeededPointGeo(count: number, salt: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    seeds[i * 4] = seeded(i * 4 + 1 + salt);
    seeds[i * 4 + 1] = seeded(i * 4 + 2 + salt);
    seeds[i * 4 + 2] = seeded(i * 4 + 3 + salt);
    seeds[i * 4 + 3] = seeded(i * 4 + 4 + salt);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1200);
  return geo;
}

const _moteTint = new THREE.Color();
const _goldMote = new THREE.Color('#FFE0A3');
const _dawnDewMote = new THREE.Color('#C8DCF6');
const _smokeTint = new THREE.Color();

export function HighlandAtmosphereParticles() {
  const qualityTier = useGameStore((s) => s.qualityTier);
  const moteCount = qualityTier === 'high' ? 280 : qualityTier === 'medium' ? 160 : 70;

  const { moteGeo, moteMat, emberGeo, emberMat, smokeGeo, smokeMat } = useMemo(() => {
    const mGeo = makeSeededPointGeo(moteCount, 17);
    const mMat = new THREE.ShaderMaterial({
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uWindStrength: { value: 0.5 },
        uPixelRatio: { value: 1.5 },
        uMoteColor: { value: new THREE.Color('#FFE0A3') },
        uOpacity: { value: 0.52 },
      },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    const eGeo = makeSeededPointGeo(72, 93);
    const eMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWindStrength: { value: 0.5 },
        uPixelRatio: { value: 1.5 },
      },
      vertexShader: EMBER_VERT,
      fragmentShader: EMBER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    const sGeo = makeSeededPointGeo(40, 211);
    const sMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWindStrength: { value: 0.5 },
        uPixelRatio: { value: 1.5 },
        uSmokeColor: { value: new THREE.Color('#DCE6F2') },
      },
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });

    return {
      moteGeo: mGeo,
      moteMat: mMat,
      emberGeo: eGeo,
      emberMat: eMat,
      smokeGeo: sGeo,
      smokeMat: sMat,
    };
  }, [moteCount]);

  const emberPointsRef = useRef<THREE.Points>(null);

  useEffect(() => {
    return () => {
      moteGeo.dispose();
      moteMat.dispose();
      emberGeo.dispose();
      emberMat.dispose();
      smokeGeo.dispose();
      smokeMat.dispose();
    };
  }, [moteGeo, moteMat, emberGeo, emberMat, smokeGeo, smokeMat]);

  useFrame(({ clock, camera, gl }) => {
    const t = clock.getElapsedTime();
    const atmo = useGameStore.getState().atmosphere;
    const dpr = gl.getPixelRatio();

    moteMat.uniforms.uCamPos.value.copy(camera.position);
    moteMat.uniforms.uTime.value = t;
    moteMat.uniforms.uWindStrength.value = atmo.windStrength;
    moteMat.uniforms.uPixelRatio.value = dpr;

    const sunWarmth = atmo.isSunriseWindow
      ? 1.0
      : atmo.gameHour >= 5.1 && atmo.gameHour <= 17.6
        ? 0.72
        : 0.18;
    _moteTint.copy(_dawnDewMote).lerp(_goldMote, sunWarmth);
    moteMat.uniforms.uMoteColor.value.copy(_moteTint);
    moteMat.uniforms.uOpacity.value =
      atmo.weather === 'light_drizzle' ? 0.22 : atmo.isSunriseWindow ? 0.62 : 0.42;

    emberMat.uniforms.uTime.value = t;
    emberMat.uniforms.uWindStrength.value = atmo.windStrength;
    emberMat.uniforms.uPixelRatio.value = dpr;

    smokeMat.uniforms.uTime.value = t;
    smokeMat.uniforms.uWindStrength.value = atmo.windStrength;
    smokeMat.uniforms.uPixelRatio.value = dpr;
    _smokeTint.set(atmo.fogHex).lerp(_goldMote, sunWarmth * 0.35);
    smokeMat.uniforms.uSmokeColor.value.copy(_smokeTint);
  });

  return (
    <group name="DaLatAtmosphereParticles">
      {/* Floating golden morning mist & pollen motes around camera */}
      <points geometry={moteGeo} material={moteMat} frustumCulled={false} renderOrder={18} />

      {/* Acoustic Campfire Rising Glowing Embers at [-53, 135.25, 24] */}
      <points
        ref={emberPointsRef}
        position={[-53, 135.25, 24]}
        geometry={emberGeo}
        material={emberMat}
        frustumCulled={false}
        renderOrder={19}
      />

      {/* Cozy Cafe Mơ Sương Warm Chimney & Kettle Steam Plume */}
      <points
        position={[-44.8, 139.9, 29.5]}
        geometry={smokeGeo}
        material={smokeMat}
        frustumCulled={false}
        renderOrder={17}
      />
    </group>
  );
}
