import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import {
  distanceToTrail,
  fbm2D,
  getSurfaceType,
  sampleGroundHeight,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
import { useGameStore } from '../store/gameStore';
import { worldColliderRegistry } from './colliderRegistry';

const TERRAIN_SEGMENTS = 160;
const WORLD_SPAN = WORLD_CONSTANTS.HALF_SIZE * 2; // 900m [-450, 450]

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

/**
 * Strips non-position attributes from a geometry so mergeGeometries + MeshBVH stay compact & fast.
 */
function toPositionOnlyGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const pos = src.getAttribute('position');
  geo.setAttribute('position', pos.clone());
  if (src.index) {
    geo.setIndex(src.index.clone());
  }
  return geo;
}

/**
 * Builds the exact walkable collider geometry for Cầu Gỗ Săn Mây (x: 50..99, z: -75, rising 196.15 -> 198.25)
 * and Tiệm Cà Phê Mơ Sương stilted veranda deck (x: -51.5..-23, z: 19..41, y: 135.15).
 */
function createWalkableDeckColliders(): THREE.BufferGeometry[] {
  // 1. Cầu Gỗ Săn Mây inclined wooden bridge corridor: x in [50, 86.5], z in [-77.7, -72.3]
  const bridgeLen = 36.5;
  const bridgeWidth = 5.4;
  const bridgeThickness = 0.5;
  const bridgeBox = new THREE.BoxGeometry(bridgeLen, bridgeThickness, bridgeWidth, 20, 1, 2);
  bridgeBox.translate(50 + bridgeLen * 0.5, -bridgeThickness * 0.5, -75);

  const bPos = bridgeBox.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < bPos.count; i++) {
    const wx = bPos.getX(i);
    const localY = bPos.getY(i); // 0 on top face, -0.5 on bottom face
    const t = clamp((wx - 50) / 41, 0, 1);
    const surfaceY = 196.15 + t * 2.1;
    bPos.setY(i, surfaceY + localY);
  }

  // 2. Cầu Gỗ Săn Mây circular sunrise deck centered at (91, -75) radius 7.35m (reaches x ~ 98.35m)
  const roundDeck = new THREE.CylinderGeometry(7.35, 7.35, bridgeThickness, 28, 1);
  roundDeck.translate(91, -bridgeThickness * 0.5, -75);

  const dPos = roundDeck.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < dPos.count; i++) {
    const wx = dPos.getX(i);
    const localY = dPos.getY(i);
    const t = clamp((wx - 50) / 41, 0, 1);
    const surfaceY = 196.15 + t * 2.1;
    dPos.setY(i, surfaceY + localY);
  }

  // 3. Tiệm Cà Phê Mơ Sương stilted veranda deck: x in [-51.5, -23], z in [19, 41], top y = 135.15
  const cafeWidthX = -23 - -51.5; // 28.5m
  const cafeDepthZ = 41 - 19; // 22m
  const cafeThickness = 0.8;
  const cafeDeck = new THREE.BoxGeometry(cafeWidthX, cafeThickness, cafeDepthZ, 4, 1, 4);
  cafeDeck.translate(-37.25, 135.15 - cafeThickness * 0.5, 30);

  const out = [
    toPositionOnlyGeometry(bridgeBox),
    toPositionOnlyGeometry(roundDeck),
    toPositionOnlyGeometry(cafeDeck),
  ];

  bridgeBox.dispose();
  roundDeck.dispose();
  cafeDeck.dispose();

  return out;
}

interface TerrainShaderUniforms {
  uDrizzle: { value: number };
  uPinkGrassPhase: { value: number };
  uPinkDayFade: { value: number };
  uSnowGrassColor: { value: THREE.Color };
  uRosePinkColor: { value: THREE.Color };
  uDayPinkMeadowColor: { value: THREE.Color };
}

export function DaLatWorldTerrain() {
  // Construct sculpted 240x240 terrain + splatmap attributes + merged MeshBVH collider once
  const { terrainGeometry, colliderMesh, bvh } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(
      WORLD_SPAN,
      WORLD_SPAN,
      TERRAIN_SEGMENTS,
      TERRAIN_SEGMENTS
    );
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const vertCount = posAttr.count;

    // 1. Displace Y using exact shared protocol terrain heightfield
    for (let i = 0; i < vertCount; i++) {
      const wx = posAttr.getX(i);
      const wz = posAttr.getZ(i);
      posAttr.setY(i, sampleGroundHeight(wx, wz));
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();

    const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
    const colors = new Float32Array(vertCount * 3);
    // vec4: x = redBasaltTrailMask, y = pinkGrassMeadowMask, z = teaTerraceMask, w = morningDewMask
    const surfaceWeights = new Float32Array(vertCount * 4);

    // Linear-sRGB palette colors via THREE.Color
    const cGrassLight = new THREE.Color('#3E6B48');
    const cGrassDeep = new THREE.Color('#2A4B3C');
    const cBasaltClay = new THREE.Color('#8F4933');
    const cBasaltEdge = new THREE.Color('#704432');
    const cTeaLeaf = new THREE.Color('#4F7D3B');
    const cTeaSoil = new THREE.Color('#5A3B2B');
    const cValleySoil = new THREE.Color('#324433');
    const cScratch = new THREE.Color();
    const cBlend = new THREE.Color();

    for (let i = 0; i < vertCount; i++) {
      const wx = posAttr.getX(i);
      const wy = posAttr.getY(i);
      const wz = posAttr.getZ(i);
      const ny = normAttr.getY(i);

      const dapple = clamp(0.5 + fbm2D(wx * 0.045, wz * 0.045, 2) * 0.65, 0, 1);
      const slopeSteepness = clamp((1.0 - ny) * 3.2, 0, 1);

      // Base Highland Dewy Pine Grass (#3E6B48 -> #2A4B3C)
      const grassMix = clamp(slopeSteepness * 0.55 + (1.0 - dapple) * 0.45, 0, 1);
      cScratch.copy(cGrassLight).lerp(cGrassDeep, grassMix);

      // Valley floor transition below Y = 52m
      const valleyMask = smoothstep(56, 38, wy);
      if (valleyMask > 0.001) {
        cScratch.lerp(cValleySoil, valleyMask * 0.72);
      }

      // Cầu Đất Tea Terrace soil & contour stripes (#4F7D3B)
      const surfaceType = getSurfaceType(wx, wz);
      const teaFieldGauss = gaussian2D(wx, wz, 36, -58, 64, 64);
      const teaMask =
        surfaceType === 'tea_terrace'
          ? clamp(teaFieldGauss * 1.65, 0, 1)
          : smoothstep(0.24, 0.42, teaFieldGauss);

      if (teaMask > 0.001) {
        const stepPhase = ((wy % 1.65) + 1.65) % 1.65 / 1.65;
        const riserSoil = smoothstep(0.0, 0.28, stepPhase) * (1.0 - smoothstep(0.28, 0.55, stepPhase));
        cBlend.copy(cTeaLeaf).lerp(cTeaSoil, riserSoil * 0.58 + slopeSteepness * 0.25);
        cScratch.lerp(cBlend, teaMask * 0.88);
      }

      // Secret Hõm Cỏ Tuyết / Cỏ Hồng meadow mask around (-12, -175)
      const pinkGauss = gaussian2D(wx, wz, -12, -175, 42, 38);
      const pinkMask =
        surfaceType === 'pink_grass_meadow'
          ? clamp((pinkGauss - 0.25) * 1.8, 0.45, 1.0)
          : smoothstep(0.28, 0.48, pinkGauss);

      // Da Lat Red-Basalt Clay (#8F4933) along TRAIL_SEGMENTS + landmark footpaths
      const distTrail = distanceToTrail(wx, wz);
      const trailCore = 1.0 - smoothstep(2.35, 3.85, distTrail);
      const trailMask = surfaceType === 'red_basalt_trail' ? Math.max(0.85, trailCore) : trailCore;

      if (trailMask > 0.001) {
        const pebble = 0.88 + 0.22 * fbm2D(wx * 0.28, wz * 0.28, 2);
        cBlend.copy(cBasaltEdge).lerp(cBasaltClay, smoothstep(0.15, 0.78, trailMask));
        cBlend.multiplyScalar(pebble);
        cScratch.lerp(cBlend, trailMask);
      }

      colors[i * 3] = cScratch.r;
      colors[i * 3 + 1] = cScratch.g;
      colors[i * 3 + 2] = cScratch.b;

      surfaceWeights[i * 4] = trailMask;
      surfaceWeights[i * 4 + 1] = pinkMask * (1.0 - trailMask * 0.92);
      surfaceWeights[i * 4 + 2] = teaMask * (1.0 - trailMask);
      surfaceWeights[i * 4 + 3] = clamp((1.0 - trailMask) * ny, 0, 1);
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSurfaceWeights', new THREE.BufferAttribute(surfaceWeights, 4));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    // 2. Build combined walkable MeshBVH collider (Terrain + Cầu Gỗ Săn Mây + Mơ Sương Veranda)
    const terrainPosGeo = toPositionOnlyGeometry(geo);
    const deckGeos = createWalkableDeckColliders();
    const mergedColliderGeo = mergeGeometries([terrainPosGeo, ...deckGeos], false);

    terrainPosGeo.dispose();
    for (const dg of deckGeos) dg.dispose();

    const builtBvh = new MeshBVH(mergedColliderGeo, { maxLeafSize: 12 });
    (mergedColliderGeo as unknown as { boundsTree: MeshBVH }).boundsTree = builtBvh;

    const colMat = new THREE.MeshBasicMaterial({ visible: false });
    const colMesh = new THREE.Mesh(mergedColliderGeo, colMat);
    colMesh.name = 'DaLatWorldWalkableCollider';
    colMesh.visible = false;
    colMesh.raycast = acceleratedRaycast;
    colMesh.updateMatrixWorld(true);

    return {
      terrainGeometry: geo,
      colliderMesh: colMesh,
      bvh: builtBvh,
    };
  }, []);

  // Custom shader uniforms shared with MeshStandardMaterial.onBeforeCompile
  const shaderUniforms = useMemo<TerrainShaderUniforms>(
    () => ({
      uDrizzle: { value: 0 },
      uPinkGrassPhase: { value: 0 }, // 0 = frosty silver-white (#DCE8F2), 1 = sunrise rose-pink (#F28DB2)
      uPinkDayFade: { value: 0 }, // >07:00 soft sunlit meadow blend
      uSnowGrassColor: { value: new THREE.Color('#DCE8F2') },
      uRosePinkColor: { value: new THREE.Color('#F28DB2') },
      uDayPinkMeadowColor: { value: new THREE.Color('#C88BA6') },
    }),
    []
  );

  const terrainMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.03,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDrizzle = shaderUniforms.uDrizzle;
      shader.uniforms.uPinkGrassPhase = shaderUniforms.uPinkGrassPhase;
      shader.uniforms.uPinkDayFade = shaderUniforms.uPinkDayFade;
      shader.uniforms.uSnowGrassColor = shaderUniforms.uSnowGrassColor;
      shader.uniforms.uRosePinkColor = shaderUniforms.uRosePinkColor;
      shader.uniforms.uDayPinkMeadowColor = shaderUniforms.uDayPinkMeadowColor;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          attribute vec4 aSurfaceWeights;
          varying vec4 vSurfaceWeights;
          varying vec3 vTerrainWorldPos;
          `
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          vSurfaceWeights = aSurfaceWeights;
          vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform float uDrizzle;
          uniform float uPinkGrassPhase;
          uniform float uPinkDayFade;
          uniform vec3 uSnowGrassColor;
          uniform vec3 uRosePinkColor;
          uniform vec3 uDayPinkMeadowColor;
          varying vec4 vSurfaceWeights;
          varying vec3 vTerrainWorldPos;

          float terrainGrain(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
            float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
            float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
            float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }
          `
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          float trailW = vSurfaceWeights.x;
          float pinkW = vSurfaceWeights.y;
          float teaW = vSurfaceWeights.z;

          // Subtle painterly micro-grain across grass, tea contours & basalt clay
          float micro = terrainGrain(vTerrainWorldPos.xz * 1.35);
          diffuseColor.rgb *= (0.93 + 0.14 * micro);

          // Crisp Cầu Đất tea terrace contour stripe accent
          if (teaW > 0.01) {
            float contourWave = 0.5 + 0.5 * sin(vTerrainWorldPos.y * (6.28318 / 1.65));
            diffuseColor.rgb *= mix(1.0, 0.88 + 0.22 * contourWave, teaW * 0.75);
          }

          // Magical Cỏ Tuyết (#DCE8F2 before 05:15) -> Cỏ Hồng (#F28DB2 during 05:15-07:00 sunrise)
          if (pinkW > 0.01) {
            vec3 meadowTint = mix(uSnowGrassColor, uRosePinkColor, uPinkGrassPhase);
            meadowTint = mix(meadowTint, uDayPinkMeadowColor, uPinkDayFade);
            float frostSparkle = 0.90 + 0.18 * terrainGrain(vTerrainWorldPos.xz * 3.6);
            diffuseColor.rgb = mix(diffuseColor.rgb, meadowTint * frostSparkle, pinkW * 0.88);
          }

          // Red-Basalt clay trail darkens richly when wet from Highland Drizzle
          if (trailW > 0.01 && uDrizzle > 0.01) {
            float puddlePatch = smoothstep(0.42, 0.78, terrainGrain(vTerrainWorldPos.xz * 0.55));
            float wetDarken = mix(1.0, 0.58 - 0.12 * puddlePatch, trailW * uDrizzle);
            diffuseColor.rgb *= wetDarken;
          }
          `
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `
          #include <roughnessmap_fragment>
          // Wet red-basalt clay & morning dew shimmer reduce surface roughness gracefully
          float wetTrailSheen = vSurfaceWeights.x * uDrizzle * 0.56;
          float morningDewSheen = vSurfaceWeights.w * (1.0 - uPinkDayFade) * 0.12;
          roughnessFactor = clamp(roughnessFactor - wetTrailSheen - morningDewSheen, 0.24, 0.96);
          `
        );
    };

    mat.customProgramCacheKey = () => 'dalat-painterly-terrain-v1';
    return mat;
  }, [shaderUniforms]);

  // Register MeshBVH collider immediately on mount & clean up on unmount
  useEffect(() => {
    colliderMesh.updateMatrixWorld(true);
    worldColliderRegistry.setCollider(colliderMesh, bvh);

    return () => {
      worldColliderRegistry.clearCollider(colliderMesh);
      terrainGeometry.dispose();
      terrainMaterial.dispose();
      colliderMesh.geometry.dispose();
      (colliderMesh.material as THREE.Material).dispose();
    };
  }, [colliderMesh, bvh, terrainGeometry, terrainMaterial]);

  // Animate dynamic Cỏ Tuyết / Cỏ Hồng sunrise shift & wet basalt drizzle sheen (zero allocations)
  useFrame((_, dt) => {
    const atmo = useGameStore.getState().atmosphere;
    const lerpRate = Math.min(1, dt * 4.0);
    const gh = atmo.gameHour;

    // Frosty silver-white (#DCE8F2) before 05:15 -> glowing rose-pink (#F28DB2) during 05:15-07:00 sunrise!
    let targetPinkPhase = 0.0;
    let targetDayFade = 0.0;
    if (gh >= 5.15 && gh <= 7.15) {
      targetPinkPhase = smoothstep(5.12, 5.45, gh);
      targetDayFade = smoothstep(6.75, 7.25, gh) * 0.55;
    } else if (gh > 7.15 && gh < 17.6) {
      targetPinkPhase = 1.0;
      targetDayFade = 0.65;
    } else if (gh >= 17.6 && gh < 18.8) {
      targetPinkPhase = 1.0 - smoothstep(17.6, 18.7, gh);
      targetDayFade = 0.3 * (1.0 - smoothstep(17.6, 18.4, gh));
    }

    shaderUniforms.uDrizzle.value +=
      (atmo.drizzleIntensity - shaderUniforms.uDrizzle.value) * lerpRate;
    shaderUniforms.uPinkGrassPhase.value +=
      (targetPinkPhase - shaderUniforms.uPinkGrassPhase.value) * lerpRate;
    shaderUniforms.uPinkDayFade.value +=
      (targetDayFade - shaderUniforms.uPinkDayFade.value) * lerpRate;
  });

  return (
    <group name="DaLatWorldTerrainGroup">
      <mesh
        name="DaLatSculptedTerrain"
        geometry={terrainGeometry}
        material={terrainMaterial}
        receiveShadow
      />
      <primitive object={colliderMesh} />
    </group>
  );
}
