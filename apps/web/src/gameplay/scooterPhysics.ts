import * as THREE from 'three';
import {
  checkPedestrianDeckZone,
  getSurfaceType,
  sampleGroundGradient,
  sampleGroundHeight,
  WORLD_CONSTANTS,
} from '@dalat/protocol';
import { worldColliderRegistry } from '../world/colliderRegistry';

export interface ScooterControlInput {
  throttle: number; // -1 (reverse/brake) .. +1 (forward throttle)
  steer: number; // -1 (left, KeyA) .. +1 (right, KeyD)
  boost: boolean; // Shift held -> full 60 km/h (up to 68+ km/h downhill)
  handbrake: boolean; // Space held -> rear drum brake & dirt-trail tail slide
}

export interface ScooterPhysicsState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number; // Longitudinal nose-up (<0 or >0: nose up is negative X rot in Three.js! Let's store noseUpRad > 0 = nose higher than tail)
  pitchVel: number;
  bankRoll: number; // rotation.z lean into corners
  steerAngle: number; // Front fork rotation.y (+left, -right)
  wheelRotRad: number; // Cumulative wheel spin angle
  frontCompression: number; // 0..0.22m telescopic fork compression
  rearCompression: number; // 0..0.22m rear shock compression
  forwardSpeed: number; // Signed speed along heading (m/s)
  speedKmh: number;
  gear: 1 | 2 | 3 | 4;
  grounded: boolean;
  frontGrounded: boolean;
  rearGrounded: boolean;
  airborneTimeSec: number;
  drifting: boolean;
  braking: boolean;
  landingImpact: number; // 0..1 transient spike on touchdown for shock/audio/avatar crouch
  pedestrianBlockedZone: string;
}

const GRAVITY = 9.81;
const WHEELBASE = WORLD_CONSTANTS.SCOOTER_WHEELBASE; // 1.20m
const HALF_WHEELBASE = WHEELBASE * 0.5; // 0.60m
const WHEEL_RADIUS = 0.275;
const SUSP_REST = 0.11;
const SUSP_MAX = 0.22;
const CHASSIS_SPHERE_RADIUS = 0.46;

const _invMat = new THREE.Matrix4();
const _obsLocalCenter = new THREE.Vector3();
const _obsBox = new THREE.Box3();
const _triClosest = new THREE.Vector3();
const _pushDir = new THREE.Vector3();

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function wrapAnglePi(rad: number): number {
  let r = (rad + Math.PI) % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r - Math.PI;
}

export function createInitialScooterPhysicsState(
  x: number,
  y: number,
  z: number,
  yaw: number
): ScooterPhysicsState {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw,
    pitch: 0,
    pitchVel: 0,
    bankRoll: 0,
    steerAngle: 0,
    wheelRotRad: 0,
    frontCompression: 0.04,
    rearCompression: 0.04,
    forwardSpeed: 0,
    speedKmh: 0,
    gear: 1,
    grounded: true,
    frontGrounded: true,
    rearGrounded: true,
    airborneTimeSec: 0,
    drifting: false,
    braking: false,
    landingImpact: 0,
    pedestrianBlockedZone: '',
  };
}

/**
 * Samples the smooth analytical C² terrain heightfield beneath a scooter wheel at (wx, wz).
 * Using analytical terrain directly (instead of the 4m faceted BVH floor mesh) eliminates
 * polygon-edge slope kinks and micro-jitter at 60 km/h!
 */
function sampleWheelSurfaceHeight(wx: number, wz: number): number {
  return sampleGroundHeight(wx, wz);
}

/**
 * Sweeps a horizontal sphere against static world obstacles (pines, greenhouses, rocks, benches)
 * and slides tangentially so grazing a tree trunk at 55 km/h feels smooth and never dead-locks!
 */
function resolveScooterObstacleSlide(
  state: ScooterPhysicsState,
  prevX: number,
  prevZ: number
): void {
  const obsCol = worldColliderRegistry.getObstacleCollider();
  if (!obsCol) return;

  const { mesh, bvh } = obsCol;
  _invMat.copy(mesh.matrixWorld).invert();

  const sinY = Math.sin(state.yaw);
  const cosY = Math.cos(state.yaw);
  // Check front & rear chassis spheres
  const offsets = [0.36, -0.36];

  for (let pIdx = 0; pIdx < offsets.length; pIdx++) {
    const off = offsets[pIdx];
    const cx = state.x + sinY * off;
    const cy = state.y + 0.58;
    const cz = state.z + cosY * off;
    const prevCx = prevX + sinY * off;
    const prevCz = prevZ + cosY * off;

    _obsLocalCenter.set(cx, cy, cz).applyMatrix4(_invMat);
    const prevLocalX = prevCx * _invMat.elements[0] + cy * _invMat.elements[4] + prevCz * _invMat.elements[8] + _invMat.elements[12];
    const prevLocalZ = prevCx * _invMat.elements[2] + cy * _invMat.elements[6] + prevCz * _invMat.elements[10] + _invMat.elements[14];
    _obsBox.min.copy(_obsLocalCenter).addScalar(-CHASSIS_SPHERE_RADIUS - 0.16);
    _obsBox.max.copy(_obsLocalCenter).addScalar(CHASSIS_SPHERE_RADIUS + 0.16);

    let pushedX = 0;
    let pushedZ = 0;
    let hitAny = false;

    bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(_obsBox),
      intersectsTriangle: (tri) => {
        tri.closestPointToPoint(_obsLocalCenter, _triClosest);
        _pushDir.subVectors(_obsLocalCenter, _triClosest);
        const dist = _pushDir.length();
        if (dist < CHASSIS_SPHERE_RADIUS) {
          let nx = dist > 1e-5 ? _pushDir.x / dist : prevLocalX - _triClosest.x;
          let nz = dist > 1e-5 ? _pushDir.z / dist : prevLocalZ - _triClosest.z;
          const horizLen = Math.hypot(nx, nz);
          if (horizLen > 0.35) {
            nx /= horizLen;
            nz /= horizLen;
            // Anti-tunneling guard: if center crossed a thin greenhouse/cabin/railing face in 1 substep,
            // orient push outward toward the approach side so the scooter NEVER gets sucked inside!
            const approachDot = (prevLocalX - _triClosest.x) * nx + (prevLocalZ - _triClosest.z) * nz;
            const crossedThinWall = approachDot < -0.002;
            if (crossedThinWall) {
              nx = -nx;
              nz = -nz;
            }
            const overlap = crossedThinWall
              ? CHASSIS_SPHERE_RADIUS + dist + 0.01
              : CHASSIS_SPHERE_RADIUS - dist;
            pushedX += nx * overlap;
            pushedZ += nz * overlap;
            hitAny = true;
          }
        }
        return false;
      },
    });

    if (hitAny) {
      const pushLen = Math.hypot(pushedX, pushedZ);
      if (pushLen > 1e-4) {
        const clampedPush = Math.min(pushLen, 0.35);
        const ux = pushedX / pushLen;
        const uz = pushedZ / pushLen;
        state.x += ux * clampedPush;
        state.z += uz * clampedPush;

        // Remove inward normal velocity component (smooth tangential wall slide!)
        const vn = state.vx * ux + state.vz * uz;
        if (vn < 0) {
          state.vx -= ux * vn * 1.05;
          state.vz -= uz * vn * 1.05;
          // Gentle scrape speed damping
          state.vx *= 0.9;
          state.vz *= 0.9;
        }
      }
    }
  }
}

/**
 * Advances the 2-wheel Honda Super Cub 50 rigid-body simulation at 120 Hz (2 substeps per 60 FPS frame):
 * - Cruise top speed 42 km/h, Shift full-throttle 60 km/h (up to 68+ km/h coasting steep downhill).
 * - True longitudinal slope gravity (-g * sin(pitch)) + dual-wheel Hooke's Law suspension.
 * - Real parabolic ballistic airtime (g = 9.81 m/s²) when launching over steep hill crests!
 * - Rear-drum handbrake drift (Space) + polite wooden-deck sanctuary geofencing.
 */
export function stepScooterPhysics(
  state: ScooterPhysicsState,
  input: ScooterControlInput,
  rawDt: number,
  drizzleIntensity = 0
): void {
  const totalDt = clamp(rawDt, 0.001, 0.05);
  const substeps = 2;
  const dt = totalDt / substeps;

  // Decay transient landing spike smoothly across frames
  state.landingImpact = Math.max(0, state.landingImpact - totalDt * 3.6);
  state.pedestrianBlockedZone = '';

  for (let step = 0; step < substeps; step++) {
    const sinYaw = Math.sin(state.yaw);
    const cosYaw = Math.cos(state.yaw);
    const fwdX = sinYaw;
    const fwdZ = cosYaw;
    // Right-side unit vector in world XZ (when facing +Z, right is -X)
    const rightX = -cosYaw;
    const rightZ = sinYaw;

    // Decompose current horizontal velocity into forward & lateral components
    let vFwd = state.vx * fwdX + state.vz * fwdZ;
    let vLat = state.vx * rightX + state.vz * rightZ;
    const absFwd = Math.abs(vFwd);

    // 1. Speed-sensitive handlebar steering angle (+left when input.steer < 0, -right when input.steer > 0)
    // Real motorcycle tire cornering friction limits max lateral acceleration (~0.82 G normal, ~1.48 G handbrake slide),
    // preventing unrealistic top-spinning at 40-60 km/h while keeping 2.1m courtyard U-turns nimble!
    const maxCornerLatAccel = input.handbrake && absFwd > 3.2 ? 14.5 : 8.2;
    const gLimitedSteerRad =
      absFwd > 1.2
        ? Math.atan((maxCornerLatAccel * WHEELBASE) / Math.max(1.5, absFwd * absFwd))
        : 0.52;
    const maxSteerRad = clamp(gLimitedSteerRad, 0.036, 0.52);
    const desiredSteer = -clamp(input.steer, -1, 1) * maxSteerRad;
    const steerLambda = Math.abs(input.steer) < 0.04 ? 22.0 : 11.5;
    state.steerAngle += (desiredSteer - state.steerAngle) * (1 - Math.exp(-steerLambda * dt));

    // 2. Probe ground beneath Front (+0.60m) and Rear (-0.60m) axles
    const fx = state.x + fwdX * HALF_WHEELBASE;
    const fz = state.z + fwdZ * HALF_WHEELBASE;
    const rx = state.x - fwdX * HALF_WHEELBASE;
    const rz = state.z - fwdZ * HALF_WHEELBASE;

    const groundFrontY = sampleWheelSurfaceHeight(fx, fz);
    const groundRearY = sampleWheelSurfaceHeight(rx, rz);
    const groundCenterY = (groundFrontY + groundRearY) * 0.5;
    const terrainSlopePitch = clamp(
      Math.atan2(groundFrontY - groundRearY, WHEELBASE),
      -0.56,
      0.56
    );

    const wasGrounded = state.grounded;

    // Expected wheel clearances given current chassis height & pitch
    const wheelTouchMargin = 0.045;
    const frontClearance = state.y + Math.sin(state.pitch) * HALF_WHEELBASE - groundFrontY;
    const rearClearance = state.y - Math.sin(state.pitch) * HALF_WHEELBASE - groundRearY;

    if (!wasGrounded) {
      state.frontGrounded = frontClearance <= wheelTouchMargin;
      state.rearGrounded = rearClearance <= wheelTouchMargin;
      state.grounded = state.frontGrounded || state.rearGrounded;
    }

    // 3. Longitudinal Engine Drive, 4-Speed Gearbox, Slope Gravity & Rear-Drum Braking
    const surface = getSurfaceType(state.x, state.z);
    const wetSlip = drizzleIntensity > 0.2 ? 0.84 : 1.0;
    const offTrailDrag = surface === 'red_basalt_trail' ? 1.0 : 0.985;

    const topTargetSpeed =
      (input.boost
        ? WORLD_CONSTANTS.MAX_SCOOTER_BOOST_SPEED
        : WORLD_CONSTANTS.MAX_SCOOTER_CRUISE_SPEED) * offTrailDrag;

    const throttleIn = clamp(input.throttle, -1, 1);
    let isBrakingNow = input.handbrake;

    if (state.grounded) {
      // Real slope gravity acceleration along the hillside: -g * sin(slopePitch)
      // Climbing uphill pulls backward; coasting downhill accelerates past flat 60 km/h up to ~68 km/h!
      const slopeGravityAccel = -GRAVITY * Math.sin(terrainSlopePitch) * 0.78;

      let driveAccel = 0;
      if (throttleIn > 0.04) {
        if (vFwd < -0.25) {
          // Braking out of reverse
          driveAccel = 18.5 * throttleIn;
          isBrakingNow = true;
        } else {
          // Governed 4-stroke torque curve: cruises at 42 km/h (W), hits 60 km/h (Shift+W), and surges to ~68 km/h only on real steep downhills!
          const headroom = clamp(1 - vFwd / Math.max(1, topTargetSpeed), 0, 1);
          const boostPunch = input.boost ? 18.2 : 11.4;
          const enginePull = throttleIn * boostPunch * Math.pow(headroom, 0.34);
          const overSpeedDrag = vFwd > topTargetSpeed ? -(vFwd - topTargetSpeed) * 1.45 : 0;
          const aeroDrag = -0.0028 * vFwd * Math.abs(vFwd);
          driveAccel = enginePull + overSpeedDrag + aeroDrag;
        }
      } else if (throttleIn < -0.04) {
        if (vFwd > 0.45) {
          // Strong front+rear drum braking
          driveAccel = throttleIn * 22.0 * wetSlip;
          isBrakingNow = true;
        } else {
          // Smooth foot-assisted walk-back reverse up to -2.8 m/s (-10 km/h)
          const revHeadroom = Math.max(0, 1 - Math.abs(vFwd) / 2.8);
          driveAccel = throttleIn * 6.5 * revHeadroom;
          isBrakingNow = true;
        }
      } else {
        // Responsive 4-stroke engine compression braking + rolling resistance so releasing W on hills feels safe and controlled
        const rollingDrag = -vFwd * 2.25 - Math.sign(vFwd) * 0.95;
        driveAccel = rollingDrag;
      }

      if (input.handbrake) {
        driveAccel -= Math.sign(vFwd) * 13.5 * wetSlip;
        if (Math.abs(vFwd) < 0.35 && Math.abs(throttleIn) < 0.05) {
          vFwd = 0;
        }
      }

      // Apply drive + slope gravity (except auto-standstill hold when idle on a slope)
      const idleHold =
        Math.abs(throttleIn) < 0.04 && !input.handbrake && Math.abs(vFwd) < 0.42;
      if (idleHold) {
        vFwd *= Math.exp(-14.0 * dt);
        if (Math.abs(vFwd) < 0.03) vFwd = 0;
      } else {
        vFwd += (driveAccel + slopeGravityAccel) * dt;
      }

      // Aerodynamic speed cap (allows surging up to ~69 km/h on steep downhill runs!)
      const maxDownhillCap = WORLD_CONSTANTS.MAX_SCOOTER_DOWNHILL_SPEED;
      vFwd = clamp(vFwd, -3.1, maxDownhillCap);

      // Lateral tire grip (high grip normally; loosened to 0.36 during Space rear-brake drift!)
      const lateralGripLambda = input.handbrake && absFwd > 3.2 ? 3.4 * wetSlip : 13.5 * wetSlip;
      vLat *= Math.exp(-lateralGripLambda * dt);
      state.drifting = input.handbrake && absFwd > 4.2 && Math.abs(state.steerAngle) > 0.12;
    } else {
      // In mid-air: tiny aerodynamic drag only — horizontal ballistic momentum is conserved!
      vFwd *= Math.exp(-0.14 * dt);
      vLat *= Math.exp(-0.4 * dt);
      state.drifting = false;
    }

    state.braking = isBrakingNow;

    // 4. Bicycle/Ackermann Yaw Rate & Centrifugal Cornering Lean
    let yawRate = 0;
    if (Math.abs(vFwd) > 0.12) {
      const steerGain = state.grounded ? (state.drifting ? 1.38 : 1.08) : 0.28;
      yawRate = (vFwd / WHEELBASE) * Math.tan(state.steerAngle) * steerGain;
      state.yaw = wrapAnglePi(state.yaw + yawRate * dt);
    }

    // Recompute horizontal velocity in world XZ from updated yaw
    const nFwdX = Math.sin(state.yaw);
    const nFwdZ = Math.cos(state.yaw);
    const nRightX = -Math.cos(state.yaw);
    const nRightZ = Math.sin(state.yaw);
    state.vx = nFwdX * vFwd + nRightX * vLat;
    state.vz = nFwdZ * vFwd + nRightZ * vLat;

    // Advance XZ & clamp to world bounds [-443, 443]
    const prevStepX = state.x;
    const prevStepZ = state.z;
    state.x = clamp(state.x + state.vx * dt, -443, 443);
    state.z = clamp(state.z + state.vz * dt, -443, 443);

    // Polite Wooden-Deck Pedestrian Sanctuary Geofence (Cầu Gỗ, Hiên Café, Bếp Lửa)
    const pedZone = checkPedestrianDeckZone(state.x, state.z);
    if (pedZone.inside) {
      state.x = pedZone.pushX;
      state.z = pedZone.pushZ;
      state.vx *= 0.15;
      state.vz *= 0.15;
      vFwd *= 0.15;
      state.pedestrianBlockedZone = pedZone.zoneLabel;
    }

    // Swept dual-sphere obstacle slide (trees, rocks, greenhouses, benches)
    resolveScooterObstacleSlide(state, prevStepX, prevStepZ);

    // Keep steeper cliff walls (> 58 deg) drivable along contours without climbing vertical rock faces
    const grad = sampleGroundGradient(state.x, state.z);
    if (grad.slopeTan > 1.55) {
      const upSlopeDot = state.vx * grad.dhdx + state.vz * grad.dhdz;
      if (upSlopeDot > 0) {
        const gLenSq = grad.dhdx * grad.dhdx + grad.dhdz * grad.dhdz || 1;
        state.vx -= (grad.dhdx * upSlopeDot) / gLenSq;
        state.vz -= (grad.dhdz * upSlopeDot) / gLenSq;
      }
    }

    // 5. Vertical Ballistic Gravity & Dual-Wheel Hooke's Law Suspension Touchdown
    const newFx = state.x + nFwdX * HALF_WHEELBASE;
    const newFz = state.z + nFwdZ * HALF_WHEELBASE;
    const newRx = state.x - nFwdX * HALF_WHEELBASE;
    const newRz = state.z - nFwdZ * HALF_WHEELBASE;
    const newGf = sampleWheelSurfaceHeight(newFx, newFz);
    const newGr = sampleWheelSurfaceHeight(newRx, newRz);
    const newGc = (newGf + newGr) * 0.5;
    const newTerrainPitch = clamp(Math.atan2(newGf - newGr, WHEELBASE), -0.56, 0.56);

    // Exact Path-Curvature & Newtonian Detachment Check:
    // Measure convex hilltop curvature kappa = d²h/ds² over a 1m span along heading so gentle rolling trails
    // and downhill runs stay 100% planted (0 micro-bounces), while charging over steep hill crests (>52 km/h)
    // launches cleanly into true parabolic flight!
    const nextAirVy = state.vy - GRAVITY * dt;
    const nextAirY = state.y + nextAirVy * dt;

    if (state.grounded && absFwd > 11.5) {
      const hCenter = sampleWheelSurfaceHeight(state.x, state.z);
      const hAhead = sampleWheelSurfaceHeight(state.x + nFwdX, state.z + nFwdZ);
      const hBehind = sampleWheelSurfaceHeight(state.x - nFwdX, state.z - nFwdZ);
      const kappa = hAhead - 2 * hCenter + hBehind;
      const crestDownAccel = -kappa * absFwd * absFwd;
      if (crestDownAccel > 55.0 && nextAirY > newGc + 0.0025) {
        state.grounded = false;
        state.frontGrounded = false;
        state.rearGrounded = false;
      }
    }

    if (!state.grounded) {
      state.airborneTimeSec += dt;
      state.vy = nextAirVy;
      state.y = nextAirY;

      // Mid-air pitch dynamics: natural trajectory arc + subtle W/S rider pitch trim, stabilized in [-24°, +28°]
      const flightTrajPitch = clamp(Math.atan2(state.vy, Math.max(4.0, absFwd)) * 0.55, -0.42, 0.48);
      const riderAirTrim = clamp(-throttleIn * 0.10, -0.12, 0.14);
      const targetAirPitch = clamp(flightTrajPitch + riderAirTrim, -0.44, 0.50);
      state.pitch += (targetAirPitch - state.pitch) * (1 - Math.exp(-5.5 * dt));

      // Relax suspension forks to full extension in mid-air!
      state.frontCompression += (0.0 - state.frontCompression) * (1 - Math.exp(-12.0 * dt));
      state.rearCompression += (0.0 - state.rearCompression) * (1 - Math.exp(-12.0 * dt));

      // Unconditional solid-earth touchdown: the instant tires reach newGc on ANY slope (flat, uphill, or steep downhill),
      // land immediately so the scooter can NEVER plunge below the terrain surface!
      const touchMargin = state.airborneTimeSec < 0.06 ? 0.0 : 0.012;
      if (state.y <= newGc + touchMargin) {
        const slopeFollowVy = vFwd * Math.tan(newTerrainPitch);
        const impactSpeed = Math.max(0, slopeFollowVy - state.vy);
        state.y = newGc;
        state.vy = slopeFollowVy;
        state.grounded = true;
        state.frontGrounded = true;
        state.rearGrounded = true;

        const normImpact = clamp((impactSpeed - 1.0) / 8.0, 0.12, 1.0);
        if (state.airborneTimeSec > 0.12) {
          state.landingImpact = Math.max(state.landingImpact, normImpact);
          // Compress both telescopic front fork & rear twin shocks on landing!
          state.frontCompression = clamp(0.05 + normImpact * 0.14, 0.04, SUSP_MAX);
          state.rearCompression = clamp(0.05 + normImpact * 0.15, 0.04, SUSP_MAX);
        }
        state.airborneTimeSec = 0;
      }
    } else {
      state.airborneTimeSec = 0;
      const prevY = state.y;
      // Follow hillside contour smoothly while tracking instantaneous vertical launch velocity!
      state.y = newGc;
      const instVy = clamp((state.y - prevY) / dt, -14.0, 14.0);
      state.vy = state.vy * 0.35 + instVy * 0.65;

      // Smoothly track longitudinal ground pitch + subtle squat on hard acceleration / dive on braking
      const accelDive = isBrakingNow && vFwd > 1.5 ? -0.055 : throttleIn > 0.2 ? 0.032 : 0;
      const targetPitch = clamp(newTerrainPitch + accelDive, -0.56, 0.56);
      state.pitch += (targetPitch - state.pitch) * (1 - Math.exp(-14.0 * dt));

      // Spring-damper suspension return + micro trail-bump ripple
      const bumpRipple =
        absFwd > 0.5 ? Math.sin((state.x + state.z) * 2.9) * 0.012 * clamp(absFwd / 10, 0, 1) : 0;
      const targetFrontComp = clamp(
        0.04 + (isBrakingNow && vFwd > 1.5 ? 0.055 : 0) + bumpRipple,
        0.01,
        SUSP_MAX
      );
      const targetRearComp = clamp(
        0.045 + (throttleIn > 0.2 ? 0.035 : 0) - bumpRipple,
        0.01,
        SUSP_MAX
      );
      state.frontCompression += (targetFrontComp - state.frontCompression) * (1 - Math.exp(-11.0 * dt));
      state.rearCompression += (targetRearComp - state.rearCompression) * (1 - Math.exp(-11.0 * dt));
    }

    // 6. Gyroscopic & Centrifugal Cornering Lean (auto-levels toward 0° in mid-air for safe 2-wheel landings!)
    const targetBank = state.grounded
      ? clamp(-yawRate * absFwd * 0.052, -0.36, 0.36)
      : 0;
    const bankLambda = state.grounded ? 10.5 : 5.5;
    state.bankRoll = clamp(
      state.bankRoll + (targetBank - state.bankRoll) * (1 - Math.exp(-bankLambda * dt)),
      -0.38,
      0.38
    );
    if (!Number.isFinite(state.bankRoll)) state.bankRoll = 0;
    if (!Number.isFinite(state.pitch)) state.pitch = 0;

    // 7. Wheel rotation (continues spinning with throttle inertia even in mid-air!)
    const wheelLinearVel = state.grounded
      ? vFwd
      : vFwd * 0.85 + (throttleIn > 0.1 ? 6.0 * throttleIn : 0);
    state.wheelRotRad = (state.wheelRotRad + (wheelLinearVel * dt) / WHEEL_RADIUS) % (Math.PI * 200);
  }

  // Final derived HUD telemetry
  const fSin = Math.sin(state.yaw);
  const fCos = Math.cos(state.yaw);
  state.forwardSpeed = state.vx * fSin + state.vz * fCos;
  const totalHorizSpeed = Math.hypot(state.vx, state.vz);
  state.speedKmh = Math.round(totalHorizSpeed * 3.6);
  state.gear =
    state.speedKmh < 14 ? 1 : state.speedKmh < 29 ? 2 : state.speedKmh < 45 ? 3 : 4;
}

export { SUSP_REST, WHEEL_RADIUS, WHEELBASE };
