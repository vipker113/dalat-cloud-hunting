import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { useGameStore } from '../store/gameStore';
import { sceneRenderStats } from '../world/sceneRenderStats';
import {
  VOLUMETRIC_CLOUD_PASS_FRAG,
  volumetricCloudSharedUniforms,
} from './CloudSeaSystem';

const FG_PARTICLE_LAYER = 2;

/**
 * Assigns `depthWrite: false` atmospheric particle & drizzle meshes (`DaLatAtmosphereParticles`
 * and `DaLatSkyAndLighting`'s drizzle `InstancedMesh`) to `targetLayer` so they can be composited
 * AFTER `DaLatAtmospherePass` with exact hardware scene depth occlusion (preserving campfire smoke,
 * rising embers, mist motes, and highland drizzle in front of the volumetric cloud sea).
 */
function syncForegroundParticleLayer(scene: THREE.Scene, targetLayer: number): void {
  const particleGroup = scene.getObjectByName('DaLatAtmosphereParticles');
  if (particleGroup) {
    particleGroup.layers.set(targetLayer);
    for (let i = 0; i < particleGroup.children.length; i++) {
      particleGroup.children[i].layers.set(targetLayer);
    }
  }
  const skyGroup = scene.getObjectByName('DaLatSkyAndLighting');
  if (skyGroup) {
    for (let i = 0; i < skyGroup.children.length; i++) {
      const child = skyGroup.children[i];
      if ((child as THREE.InstancedMesh).isInstancedMesh && child.renderOrder === 25) {
        child.layers.set(targetLayer);
      }
    }
  }
}

class SceneStatsCapturePass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
  }

  override render(renderer: THREE.WebGLRenderer): void {
    sceneRenderStats.drawCalls = renderer.info.render.calls;
    sceneRenderStats.triangles = renderer.info.render.triangles;
  }
}

class ForegroundParticleCompositePass extends Pass {
  scene: THREE.Scene;
  camera: THREE.Camera;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    const prevAutoClear = renderer.autoClear;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevMask = this.camera.layers.mask;
    const prevBg = this.scene.background;

    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    this.scene.background = null;
    this.camera.layers.set(FG_PARTICLE_LAYER);

    renderer.setRenderTarget(readBuffer);
    renderer.render(this.scene, this.camera);

    sceneRenderStats.drawCalls += renderer.info.render.calls;
    sceneRenderStats.triangles += renderer.info.render.triangles;

    this.camera.layers.mask = prevMask;
    this.scene.background = prevBg;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.autoClear = prevAutoClear;
  }
}

let activeComposerRenderFn: ((camera?: THREE.Camera) => void) | null = null;

/**
 * Renders the full post-processed pipeline synchronously if active,
 * falling back to standard WebGLRenderer.render on Mobile tier.
 */
export function renderSceneWithPostProcessing(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): void {
  if (activeComposerRenderFn) {
    activeComposerRenderFn(camera);
  } else {
    gl.render(scene, camera);
    sceneRenderStats.drawCalls = gl.info.render.calls;
    sceneRenderStats.triangles = gl.info.render.triangles;
  }
}

const DALAT_ATMOSPHERE_POST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CLOUD_RT_SCALE = 0.56;

/**
 * Hardware Scene-Depth Occluded Volumetric Cloud Pass:
 * Raymarches volumetric clouds into a 0.56x resolution HDR FBO (`~3.2x` fewer pixels raymarched)
 * using hardware `readBuffer.depthTexture`. `DaLatAtmospherePass` then composites `tempRT.texture`
 * onto full-res `readBuffer` in a single pass (zero extra blit pass, zero WebGL feedback loops!).
 */
class DaLatVolumetricCloudPass extends Pass {
  uniforms: Record<string, THREE.IUniform>;
  material: THREE.ShaderMaterial;
  private cloudQuad: FullScreenQuad;
  private tempRT: THREE.WebGLRenderTarget;

  constructor(width: number, height: number) {
    super();
    const cw = Math.max(1, Math.floor(width * CLOUD_RT_SCALE));
    const ch = Math.max(1, Math.floor(height * CLOUD_RT_SCALE));
    this.tempRT = new THREE.WebGLRenderTarget(cw, ch, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this.uniforms = {
      ...volumetricCloudSharedUniforms,
      tDepth: { value: null },
      uInvProjection: { value: new THREE.Matrix4() },
      uCamWorldMatrix: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
    };

    this.material = new THREE.ShaderMaterial({
      name: 'DaLatVolumetricCloudPassShader',
      uniforms: this.uniforms,
      vertexShader: DALAT_ATMOSPHERE_POST_VERT,
      fragmentShader: VOLUMETRIC_CLOUD_PASS_FRAG,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });

    this.cloudQuad = new FullScreenQuad(this.material);
    this.needsSwap = false;
  }

  getCloudTexture(): THREE.Texture {
    return this.tempRT.texture;
  }

  syncCamera(cam: THREE.Camera): void {
    cam.updateMatrixWorld();
    this.uniforms.uCamWorldMatrix.value.copy(cam.matrixWorld);
    this.uniforms.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    if (cam instanceof THREE.PerspectiveCamera) {
      this.uniforms.uInvProjection.value.copy(cam.projectionMatrixInverse);
    }
  }

  override setSize(width: number, height: number): void {
    const cw = Math.max(1, Math.floor(width * CLOUD_RT_SCALE));
    const ch = Math.max(1, Math.floor(height * CLOUD_RT_SCALE));
    this.tempRT.setSize(cw, ch);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.tempRT);
    renderer.clear();
    this.cloudQuad.render(renderer);
  }

  override dispose(): void {
    this.material.dispose();
    this.cloudQuad.dispose();
    this.tempRT.dispose();
  }
}

const DALAT_ATMOSPHERE_POST_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform sampler2D tCloud;
  uniform vec2 uResolution;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform mat4 uInvProjection;
  uniform mat4 uProjection;

  uniform float uAoStrength;
  uniform vec2 uSunScreenUv;
  uniform vec3 uSunColor;
  uniform float uGodRayWeight;

  uniform float uDofAmount;
  uniform float uDofFocusDist;
  uniform float uWarmGrade;
  uniform float uTime;

  varying vec2 vUv;

  float ign(vec2 p) {
    vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(p, magic.xy)));
  }

  float readLinearEyeDepth(vec2 uv) {
    float z = texture2D(tDepth, uv).x;
    float ndcZ = z * 2.0 - 1.0;
    return (2.0 * uCameraNear * uCameraFar) / (uCameraFar + uCameraNear - ndcZ * (uCameraFar - uCameraNear));
  }

  vec3 reconstructViewPos(vec2 uv, float rawDepth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
    vec4 view = uInvProjection * clip;
    return view.xyz / max(view.w, 1e-6);
  }

  void main() {
    vec4 baseSample = texture2D(tDiffuse, vUv);
    vec3 hdrColor = baseSample.rgb;
    float rawDepth = texture2D(tDepth, vUv).x;
    float centerDepth = readLinearEyeDepth(vUv);
    vec2 texel = 1.0 / uResolution;

    // 1. Center-Reticle Autofocus Optical Bokeh Depth-of-Field (Photo Mode 50mm / 85mm lenses!)
    if (uDofAmount > 0.005) {
      float centerReticleDepth = readLinearEyeDepth(vec2(0.5, 0.5));
      float focusDist = (centerReticleDepth < 420.0) ? clamp(centerReticleDepth, 2.0, 260.0) : uDofFocusDist;
      float focalSpan = max(7.0, focusDist * 0.65);
      float coc = clamp(abs(centerDepth - focusDist) / focalSpan, 0.0, 1.0);
      float blurRadius = coc * uDofAmount * 7.2;
      if (blurRadius > 0.35) {
        vec3 acc = hdrColor;
        float wSum = 1.0;
        float rotBase = ign(gl_FragCoord.xy) * 6.2831853;
        // 12-tap Golden-Angle Vogel disc kernel
        for (int i = 0; i < 12; i++) {
          float fi = float(i) + 0.5;
          float r = sqrt(fi / 12.0) * blurRadius;
          float theta = fi * 2.3999632 + rotBase;
          vec2 sUv = clamp(vUv + vec2(cos(theta), sin(theta)) * texel * r, vec2(0.001), vec2(0.999));
          float sDepth = readLinearEyeDepth(sUv);
          float sCoc = clamp(abs(sDepth - focusDist) / focalSpan, 0.0, 1.0);
          // Prevent sharp foreground silhouettes from bleeding onto blurred background
          float w = (sDepth >= centerDepth - 0.35) ? 1.0 : smoothstep(0.0, 0.35, sCoc);
          acc += texture2D(tDiffuse, sUv).rgb * w;
          wSum += w;
        }
        hdrColor = acc / wSum;
      }
    }

    // 2. Dual-Scale 6-Tap Analytical Depth-Valley Contact Ambient Occlusion (micro crevices + architectural corners!)
    if (uAoStrength > 0.005 && rawDepth < 0.9996 && centerDepth < 95.0) {
      float projScale = uProjection[1][1] * uResolution.y * 0.5 / max(1.1, centerDepth);
      float microRadPx = clamp(0.18 * projScale, 1.4, 7.5);
      float macroRadPx = clamp(0.62 * projScale, 2.5, 19.0);
      float jitter = ign(gl_FragCoord.xy);
      float microOcc = 0.0;
      float macroOcc = 0.0;

      for (int i = 0; i < 6; i++) {
        float fi = (float(i) + jitter) / 6.0;
        float ang = float(i) * 2.3999632 + jitter * 6.2831853;
        vec2 dir2 = vec2(cos(ang), sin(ang)) * texel;
        bool isMicro = (i < 3);
        float rad = isMicro ? mix(0.45, 1.0, float(i) * 0.5) * microRadPx : mix(0.45, 1.0, float(i - 3) * 0.5) * macroRadPx;
        vec2 offset = dir2 * rad;
        float dA = readLinearEyeDepth(clamp(vUv + offset, vec2(0.001), vec2(0.999)));
        float dB = readLinearEyeDepth(clamp(vUv - offset, vec2(0.001), vec2(0.999)));
        float valley = centerDepth - 0.5 * (dA + dB);
        float span = abs(dA - dB);
        if (isMicro) {
          if (valley > 0.008 && valley < 0.48 && span < 0.65) {
            microOcc += smoothstep(0.008, 0.14, valley) * (1.0 - smoothstep(0.24, 0.48, valley));
          }
        } else {
          if (valley > 0.02 && valley < 1.55 && span < 1.85) {
            macroOcc += smoothstep(0.02, 0.42, valley) * (1.0 - smoothstep(0.70, 1.55, valley));
          }
        }
      }

      float totalOcc = (microOcc / 3.0) * 0.58 + (macroOcc / 3.0) * 0.48;
      float distFade = 1.0 - smoothstep(42.0, 92.0, centerDepth);
      float luma = dot(hdrColor, vec3(0.2126, 0.7152, 0.0722));
      float emissiveGuard = 1.0 - smoothstep(1.05, 2.4, luma);
      float ao = clamp(1.0 - totalOcc * uAoStrength * 1.58 * distFade * emissiveGuard, 0.50, 1.0);
      vec3 aoTint = mix(vec3(0.72, 0.77, 0.88) * ao, vec3(1.0), ao);
      hdrColor *= aoTint;
    }

    // 2b. Depth-aware 5-tap bilateral upsample of 0.56x Volumetric Cloud Sea (erases IGN raymarch stipple!)
    vec2 cOff = texel * 1.75;
    vec4 c0 = texture2D(tCloud, vUv);
    vec2 uv1 = clamp(vUv + vec2(cOff.x, cOff.y * 0.5), vec2(0.001), vec2(0.999));
    vec2 uv2 = clamp(vUv + vec2(-cOff.x, -cOff.y * 0.5), vec2(0.001), vec2(0.999));
    vec2 uv3 = clamp(vUv + vec2(-cOff.x * 0.5, cOff.y), vec2(0.001), vec2(0.999));
    vec2 uv4 = clamp(vUv + vec2(cOff.x * 0.5, -cOff.y), vec2(0.001), vec2(0.999));
    float depthTol = max(1.6, centerDepth * 0.085);
    float w1 = exp(-abs(readLinearEyeDepth(uv1) - centerDepth) / depthTol) * 0.68;
    float w2 = exp(-abs(readLinearEyeDepth(uv2) - centerDepth) / depthTol) * 0.68;
    float w3 = exp(-abs(readLinearEyeDepth(uv3) - centerDepth) / depthTol) * 0.68;
    float w4 = exp(-abs(readLinearEyeDepth(uv4) - centerDepth) / depthTol) * 0.68;
    vec4 cloudSample =
      (c0 + texture2D(tCloud, uv1) * w1 + texture2D(tCloud, uv2) * w2 + texture2D(tCloud, uv3) * w3 + texture2D(tCloud, uv4) * w4) /
      (1.0 + w1 + w2 + w3 + w4);
    if (cloudSample.a > 0.002) {
      float fgGuard = rawDepth < 0.99992 ? smoothstep(3.0, 14.5, centerDepth) : 1.0;
      float hdrPeak = max(hdrColor.r, max(hdrColor.g, hdrColor.b));
      float nearEmissiveMask = rawDepth < 0.99992 ? (1.0 - smoothstep(16.0, 44.0, centerDepth)) : 0.0;
      float hdrGlowGuard = 1.0 - smoothstep(1.12, 2.45, hdrPeak) * 0.86 * nearEmissiveMask;
      hdrColor = mix(hdrColor, cloudSample.rgb, clamp(cloudSample.a * fgGuard * hdrGlowGuard, 0.0, 0.985));
    }

    // 3. Volumetric Crepuscular Sunrise God-Rays (8-tap screen-space depth-occluded golden shafts!)
    if (uGodRayWeight > 0.004) {
      vec2 deltaUv = (vUv - uSunScreenUv);
      float sunDist = length(deltaUv * vec2(uResolution.x / max(1.0, uResolution.y), 1.0));
      float radialFalloff = exp(-sunDist * 2.35);
      if (radialFalloff > 0.012) {
        vec2 marchStep = deltaUv * (0.80 / 8.0);
        vec2 curUv = vUv - marchStep * ign(gl_FragCoord.xy + fract(uTime * 0.13));
        float shaftAcc = 0.0;
        float decay = 1.0;
        for (int s = 0; s < 8; s++) {
          curUv -= marchStep;
          if (curUv.x < 0.0 || curUv.x > 1.0 || curUv.y < 0.0 || curUv.y > 1.0) break;
          float d = texture2D(tDepth, curUv).x;
          float skyOpen = smoothstep(0.99945, 0.99990, d);
          shaftAcc += skyOpen * decay;
          decay *= 0.91;
        }
        float shaft = (shaftAcc / 8.0) * radialFalloff * uGodRayWeight;
        hdrColor += uSunColor * shaft * 0.34;
      }
    }

    // 4. Subtle Da Lat Cinema Color Harmony (warm golden-peach highlights + misty blue-pine shadows + gentle vignette)
    float lum = dot(hdrColor, vec3(0.2126, 0.7152, 0.0722));
    vec3 shadowTint = vec3(0.96, 0.985, 1.035);
    vec3 highlightTint = mix(vec3(1.0), vec3(1.045, 1.008, 0.965), uWarmGrade);
    hdrColor *= mix(shadowTint, highlightTint, smoothstep(0.06, 0.85, lum));

    vec2 centered = vUv - 0.5;
    float vig = 1.0 - dot(centered, centered) * 0.24;
    hdrColor *= clamp(vig, 0.78, 1.0);

    // Subtle organic 35mm film micro-grain (eliminates 8-bit sky/fog gradient banding!)
    float filmGrain = (ign(gl_FragCoord.xy + fract(uTime * 7.13) * 100.0) - 0.5) * 0.0075;
    hdrColor += filmGrain * clamp(0.35 + lum * 0.65, 0.35, 1.0);

    gl_FragColor = vec4(max(hdrColor, vec3(0.0)), 1.0);
    // Preserve exact 32-bit scene depth into writeBuffer so ForegroundParticleCompositePass depth-tests accurately
    gl_FragDepth = rawDepth;
  }
`;

class DaLatAtmospherePass extends Pass {
  uniforms: Record<string, THREE.IUniform>;
  material: THREE.ShaderMaterial;
  private fsQuad: FullScreenQuad;

  constructor() {
    super();
    this.uniforms = {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tCloud: { value: null },
      uResolution: { value: new THREE.Vector2(1440, 900) },
      uCameraNear: { value: 0.25 },
      uCameraFar: { value: 2600 },
      uInvProjection: { value: new THREE.Matrix4() },
      uProjection: { value: new THREE.Matrix4() },
      uAoStrength: { value: 0.95 },
      uSunScreenUv: { value: new THREE.Vector2(0.5, 0.5) },
      uSunColor: { value: new THREE.Color('#FFB86C') },
      uGodRayWeight: { value: 0.0 },
      uDofAmount: { value: 0.0 },
      uDofFocusDist: { value: 6.5 },
      uWarmGrade: { value: 0.65 },
      uTime: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      name: 'DaLatAtmospherePostShader',
      uniforms: this.uniforms,
      vertexShader: DALAT_ATMOSPHERE_POST_VERT,
      fragmentShader: DALAT_ATMOSPHERE_POST_FRAG,
      depthWrite: true,
      depthTest: true,
      depthFunc: THREE.AlwaysDepth,
      toneMapped: false,
    });

    this.fsQuad = new FullScreenQuad(this.material);
    this.needsSwap = true;
  }

  override setSize(width: number, height: number): void {
    this.uniforms.uResolution.value.set(Math.max(1, width), Math.max(1, height));
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
      this.fsQuad.render(renderer);
    }
  }

  override dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

const _sunWorldPos = new THREE.Vector3();
const _sunDir = new THREE.Vector3();
const _camForward = new THREE.Vector3();

function makeHdrDepthRenderTarget(width: number, height: number): THREE.WebGLRenderTarget {
  const depthTexture = new THREE.DepthTexture(width, height);
  depthTexture.type = THREE.UnsignedIntType;
  depthTexture.format = THREE.DepthFormat;
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;

  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture,
  });
}

export function CinematicPostProcessing() {
  const { gl, scene, camera, size } = useThree();
  const qualityTier = useGameStore((s) => s.qualityTier);

  const pipelineRef = useRef<{
    composer: EffectComposer;
    renderPass: RenderPass;
    statsPass: SceneStatsCapturePass;
    cloudPass: DaLatVolumetricCloudPass;
    atmoPass: DaLatAtmospherePass;
    fgParticlePass: ForegroundParticleCompositePass;
    bloomPass: UnrealBloomPass;
    fxaaPass: ShaderPass;
  } | null>(null);

  useEffect(() => {
    if (qualityTier === 'mobile') {
      activeComposerRenderFn = null;
      pipelineRef.current = null;
      syncForegroundParticleLayer(scene, 0);
      camera.layers.enable(0);
      return;
    }

    const dpr = gl.getPixelRatio();
    const pxW = Math.max(1, Math.floor(size.width * dpr));
    const pxH = Math.max(1, Math.floor(size.height * dpr));

    const rt1 = makeHdrDepthRenderTarget(pxW, pxH);
    const rt2 = makeHdrDepthRenderTarget(pxW, pxH);

    const composer = new EffectComposer(gl, rt1);
    composer.renderTarget2.dispose();
    composer.renderTarget2 = rt2;
    composer.readBuffer = rt1;
    composer.writeBuffer = rt2;

    const renderPass = new RenderPass(scene, camera);
    const statsPass = new SceneStatsCapturePass();
    const cloudPass = new DaLatVolumetricCloudPass(pxW, pxH);
    const atmoPass = new DaLatAtmospherePass();
    atmoPass.setSize(pxW, pxH);
    atmoPass.uniforms.tCloud.value = cloudPass.getCloudTexture();
    const fgParticlePass = new ForegroundParticleCompositePass(scene, camera);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, Math.floor(pxW * 0.5)), Math.max(1, Math.floor(pxH * 0.5))),
      qualityTier === 'high' ? 0.24 : 0.19,
      0.56,
      1.06
    );

    const outputPass = new OutputPass();
    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.material.uniforms['resolution'].value.set(1 / pxW, 1 / pxH);

    composer.addPass(renderPass);
    composer.addPass(statsPass);
    composer.addPass(cloudPass);
    composer.addPass(atmoPass);
    composer.addPass(fgParticlePass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);
    composer.addPass(fxaaPass);

    pipelineRef.current = {
      composer,
      renderPass,
      statsPass,
      cloudPass,
      atmoPass,
      fgParticlePass,
      bloomPass,
      fxaaPass,
    };

    activeComposerRenderFn = (overrideCam?: THREE.Camera) => {
      const camToUse = overrideCam ?? camera;
      syncForegroundParticleLayer(scene, FG_PARTICLE_LAYER);
      camToUse.layers.disable(FG_PARTICLE_LAYER);
      renderPass.camera = camToUse;
      fgParticlePass.scene = scene;
      fgParticlePass.camera = camToUse;
      cloudPass.syncCamera(camToUse);
      composer.render(0.016);
      gl.info.render.calls = sceneRenderStats.drawCalls;
      gl.info.render.triangles = sceneRenderStats.triangles;
    };

    return () => {
      activeComposerRenderFn = null;
      pipelineRef.current = null;
      syncForegroundParticleLayer(scene, 0);
      statsPass.dispose();
      cloudPass.dispose();
      atmoPass.dispose();
      fgParticlePass.dispose();
      bloomPass.dispose();
      outputPass.dispose();
      fxaaPass.dispose();
      rt1.depthTexture?.dispose();
      rt2.depthTexture?.dispose();
      rt1.dispose();
      rt2.dispose();
    };
  }, [gl, scene, camera, qualityTier]);

  // Resize FBOs + passes cleanly when viewport or DPR changes
  useEffect(() => {
    const pipe = pipelineRef.current;
    if (!pipe) return;
    const dpr = gl.getPixelRatio();
    const pxW = Math.max(1, Math.floor(size.width * dpr));
    const pxH = Math.max(1, Math.floor(size.height * dpr));

    pipe.composer.setPixelRatio(dpr);
    pipe.composer.setSize(size.width, size.height);
    pipe.cloudPass.setSize(pxW, pxH);
    pipe.atmoPass.setSize(pxW, pxH);
    pipe.bloomPass.setSize(Math.max(1, Math.floor(pxW * 0.5)), Math.max(1, Math.floor(pxH * 0.5)));
    pipe.fxaaPass.material.uniforms['resolution'].value.set(1 / pxW, 1 / pxH);
  }, [gl, size.width, size.height]);

  // Priority = 1 hands final frame presentation to EffectComposer (falls back to gl.render on Mobile)
  useFrame(({ clock }, dt) => {
    const pipe = pipelineRef.current;
    if (!pipe) {
      gl.render(scene, camera);
      sceneRenderStats.drawCalls = gl.info.render.calls;
      sceneRenderStats.triangles = gl.info.render.triangles;
      return;
    }

    const st = useGameStore.getState();
    const atmo = st.atmosphere;
    const u = pipe.atmoPass.uniforms;

    syncForegroundParticleLayer(scene, FG_PARTICLE_LAYER);
    camera.layers.disable(FG_PARTICLE_LAYER);

    pipe.renderPass.scene = scene;
    pipe.renderPass.camera = camera;
    pipe.fgParticlePass.scene = scene;
    pipe.fgParticlePass.camera = camera;
    pipe.cloudPass.syncCamera(camera);

    if (camera instanceof THREE.PerspectiveCamera) {
      u.uCameraNear.value = camera.near;
      u.uCameraFar.value = camera.far;
      u.uProjection.value.copy(camera.projectionMatrix);
      u.uInvProjection.value.copy(camera.projectionMatrixInverse);
    }

    u.uTime.value = clock.getElapsedTime();
    u.uAoStrength.value = qualityTier === 'high' ? 0.92 : 0.65;

    // Project East sun direction into screen UV for Volumetric Crepuscular God-Rays
    _sunDir.set(atmo.sunDirection[0], atmo.sunDirection[1], atmo.sunDirection[2]).normalize();
    camera.getWorldDirection(_camForward);
    const cosLookSun = _camForward.dot(_sunDir);
    const sunAboveHorizon = THREE.MathUtils.smoothstep(_sunDir.y, -0.05, 0.12);
    const lowAngleBeamBoost = 1.0 - THREE.MathUtils.smoothstep(_sunDir.y, 0.22, 0.68);
    const lookWeight = THREE.MathUtils.smoothstep(cosLookSun, 0.08, 0.86);

    _sunWorldPos.copy(camera.position).addScaledVector(_sunDir, 1000);
    _sunWorldPos.project(camera);
    u.uSunScreenUv.value.set(_sunWorldPos.x * 0.5 + 0.5, _sunWorldPos.y * 0.5 + 0.5);
    u.uSunColor.value.set(atmo.sunLightHex);

    const weatherBeamMul =
      atmo.weather === 'light_drizzle' || atmo.weather === 'deep_evening_fog' ? 0.35 : 1.0;
    u.uGodRayWeight.value =
      qualityTier === 'high'
        ? sunAboveHorizon * (0.35 + 0.65 * lowAngleBeamBoost) * lookWeight * weatherBeamMul
        : sunAboveHorizon * 0.45 * lookWeight * weatherBeamMul;

    // Warm golden-hour highlight grade peaks during sunrise & golden dusk
    u.uWarmGrade.value = atmo.isSunriseWindow ? 0.92 : 0.48;

    // Adaptive subtle bloom boost during pre-dawn greenhouse glow & golden sunrise
    const targetBloom =
      atmo.gameHour < 5.35
        ? 0.28
        : atmo.isSunriseWindow
          ? 0.24
          : 0.19;
    pipe.bloomPass.strength += (targetBloom - pipe.bloomPass.strength) * Math.min(1, dt * 4);

    // Real optical Bokeh Depth-of-Field in Photo Mode for 50mm & 85mm portrait/telephoto lenses!
    const targetDof =
      st.photoModeActive && st.photoFocalMm === 85
        ? 1.0
        : st.photoModeActive && st.photoFocalMm === 50
          ? 0.52
          : 0.0;
    u.uDofAmount.value += (targetDof - u.uDofAmount.value) * Math.min(1, dt * 10);
    u.uDofFocusDist.value = st.photoFocalMm === 85 ? 8.5 : 7.0;

    pipe.composer.render(Math.min(dt, 0.05));
    // Expose accurate 3D scene draw calls & triangles on WebGLRenderer.info after post-processing FullScreenQuads
    gl.info.render.calls = sceneRenderStats.drawCalls;
    gl.info.render.triangles = sceneRenderStats.triangles;
  }, 1);

  return null;
}
