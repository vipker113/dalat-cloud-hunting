import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {
  AvatarGender,
  BagStyleId,
  CoatStyleId,
  EyewearId,
  HeadwearId,
  HeldItemId,
  NeckwearId,
} from '@dalat/protocol';

const _pos = new THREE.Vector3();
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

export function composeLocalMatrix(
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1]
): THREE.Matrix4 {
  _pos.set(pos[0], pos[1], pos[2]);
  _euler.set(rot[0], rot[1], rot[2], 'XYZ');
  _quat.setFromEuler(_euler);
  _scale.set(scale[0], scale[1], scale[2]);
  return new THREE.Matrix4().compose(_pos, _quat, _scale);
}

/**
 * Converts any BufferGeometry into non-indexed vertex-colored geometry with optional gradient shading.
 */
export function paintPart(
  src: THREE.BufferGeometry,
  topHex: string,
  matrix?: THREE.Matrix4,
  bottomHex?: string
): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  if (matrix) g.applyMatrix4(matrix);
  g.computeVertexNormals();

  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const norm = g.getAttribute('normal') as THREE.BufferAttribute;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', pos);
  out.setAttribute('normal', norm);

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanY = Math.max(0.001, maxY - minY);

  const cTop = new THREE.Color(topHex);
  const cBot = new THREE.Color(bottomHex ?? topHex);
  if (!bottomHex) cBot.multiplyScalar(0.76);
  const cTmp = new THREE.Color();

  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, (pos.getY(i) - minY) / spanY));
    cTmp.copy(cBot).lerp(cTop, t);
    colors[i * 3] = cTmp.r;
    colors[i * 3 + 1] = cTmp.g;
    colors[i * 3 + 2] = cTmp.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  src.dispose();
  return out;
}

export function mergePainted(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

export const SHARED_VCOLOR_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.74,
  metalness: 0.06,
});

export const SHARED_METALLIC_VCOLOR_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.32,
  metalness: 0.55,
});

const LENS_MAT_CACHE = new Map<string, THREE.MeshStandardMaterial>();
export function getLensMaterial(hex: string, opacity = 0.62): THREE.MeshStandardMaterial {
  const key = `${hex}|${opacity}`;
  const hit = LENS_MAT_CACHE.get(key);
  if (hit) return hit;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    roughness: 0.12,
    metalness: 0.25,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
  });
  LENS_MAT_CACHE.set(key, mat);
  return mat;
}

export function isMaleCoatStyle(coatStyle: CoatStyleId, gender?: AvatarGender): boolean {
  if (gender === 'male') return true;
  if (gender === 'female') return false;
  return (
    coatStyle === 'puffer_vest' ||
    coatStyle === 'quilted_gilet' ||
    coatStyle === 'vintage_poncho' ||
    coatStyle === 'duffle_parka' ||
    coatStyle === 'corduroy_safari' ||
    coatStyle === 'tweed_overcoat'
  );
}

export function resolveBaseGlbForCoat(coatStyle: CoatStyleId, gender?: AvatarGender): string {
  const isMale = isMaleCoatStyle(coatStyle, gender);
  if (!isMale) {
    switch (coatStyle) {
      case 'knit_sweater':
      case 'sherpa_cape':
      case 'cardigan_vest':
        return '/assets/models/hiker_f_casual.glb?v=rpm2';
      case 'wool_trench':
      case 'highland_poncho':
      case 'velvet_cloak':
      default:
        return '/assets/models/hiker_f_adventurer.glb?v=rpm2';
    }
  }
  switch (coatStyle) {
    case 'vintage_poncho':
    case 'tweed_overcoat':
      return '/assets/models/hiker_m_sweater.glb?v=rpm2';
    case 'puffer_vest':
    case 'quilted_gilet':
    case 'duffle_parka':
    case 'corduroy_safari':
    default:
      return '/assets/models/hiker_m_jacket.glb?v=rpm2';
  }
}

// ============================================================================
// 1. HELD PROPS (10 3D Da Lat Highland Props — shared by Avatar & 3D Thumbnails)
// ============================================================================

export const SHARED_HELD_PROPS = (() => {
  // 1a. Cà phê Phin sữa đá / nóng
  const phPlate = paintPart(
    new THREE.CylinderGeometry(0.052, 0.052, 0.006, 14),
    '#DCE3EC',
    composeLocalMatrix([0, 0.048, 0]),
    '#9FA9B8'
  );
  const phChamber = paintPart(
    new THREE.CylinderGeometry(0.038, 0.036, 0.052, 14),
    '#E4EAF2',
    composeLocalMatrix([0, 0.076, 0]),
    '#A8B2C0'
  );
  const phLid = paintPart(
    new THREE.CylinderGeometry(0.042, 0.04, 0.008, 14),
    '#EEF3F8',
    composeLocalMatrix([0, 0.104, 0]),
    '#B6C0CE'
  );
  const phKnob = paintPart(
    new THREE.SphereGeometry(0.007, 8, 6),
    '#F4F7FA',
    composeLocalMatrix([0, 0.111, 0])
  );
  const phMilk = paintPart(
    new THREE.CylinderGeometry(0.033, 0.031, 0.024, 14),
    '#FFF6DC',
    composeLocalMatrix([0, -0.028, 0]),
    '#EADAB4'
  );
  const phCoffee = paintPart(
    new THREE.CylinderGeometry(0.037, 0.033, 0.056, 14),
    '#3B1F14',
    composeLocalMatrix([0, 0.005, 0]),
    '#1F0F09'
  );
  const phinCoreFull = mergePainted([phMilk, phCoffee, phPlate, phChamber, phLid, phKnob]);

  // 1b. Acoustic Spruce & Mahogany Guitar
  const gParts: THREE.BufferGeometry[] = [
    paintPart(
      new THREE.CylinderGeometry(0.135, 0.135, 0.068, 16),
      '#D69859',
      composeLocalMatrix([0, -0.09, 0], [Math.PI / 2, 0, 0], [1, 1, 0.92]),
      '#9E6834'
    ),
    paintPart(
      new THREE.CylinderGeometry(0.098, 0.098, 0.066, 16),
      '#DC9E5E',
      composeLocalMatrix([0, 0.05, 0], [Math.PI / 2, 0, 0], [1, 1, 0.92]),
      '#A66E38'
    ),
    paintPart(
      new THREE.CylinderGeometry(0.042, 0.042, 0.072, 12),
      '#2A150D',
      composeLocalMatrix([0, 0.01, 0.002], [Math.PI / 2, 0, 0])
    ),
    paintPart(
      new THREE.BoxGeometry(0.082, 0.018, 0.014),
      '#4B2818',
      composeLocalMatrix([0, -0.095, 0.034])
    ),
    paintPart(
      new THREE.BoxGeometry(0.034, 0.34, 0.022),
      '#4B2818',
      composeLocalMatrix([0, 0.28, 0.01]),
      '#321A0F'
    ),
    paintPart(
      new THREE.BoxGeometry(0.046, 0.085, 0.018),
      '#3E2012',
      composeLocalMatrix([0, 0.47, 0.004], [-0.14, 0, 0])
    ),
  ];
  const guitarFull = mergePainted(gParts);

  // 1c. 35mm Vintage Rangefinder Film Camera
  const cameraFull = mergePainted([
    paintPart(
      new THREE.BoxGeometry(0.128, 0.078, 0.048),
      '#232730',
      composeLocalMatrix([0, 0, 0]),
      '#14171D'
    ),
    paintPart(
      new THREE.BoxGeometry(0.13, 0.022, 0.05),
      '#DCE3EC',
      composeLocalMatrix([0, 0.032, 0]),
      '#AAB3C0'
    ),
    paintPart(
      new THREE.CylinderGeometry(0.031, 0.034, 0.04, 16),
      '#D5DCE6',
      composeLocalMatrix([0, -0.002, 0.04], [Math.PI / 2, 0, 0]),
      '#8E98A8'
    ),
    paintPart(
      new THREE.CylinderGeometry(0.024, 0.024, 0.008, 16),
      '#1E2D42',
      composeLocalMatrix([0, -0.002, 0.06], [Math.PI / 2, 0, 0]),
      '#0D1520'
    ),
    paintPart(
      new THREE.CylinderGeometry(0.01, 0.01, 0.012, 10),
      '#D8A24A',
      composeLocalMatrix([-0.042, 0.046, 0])
    ),
  ]);

  // 1d. Brass Storm Lantern
  const lanternBrassFull = mergePainted([
    paintPart(
      new THREE.TorusGeometry(0.068, 0.0055, 6, 14, Math.PI),
      '#E2AD52',
      composeLocalMatrix([0, 0.042, 0]),
      '#9E6F24'
    ),
    paintPart(
      new THREE.ConeGeometry(0.064, 0.044, 14),
      '#E2AD52',
      composeLocalMatrix([0, 0.034, 0]),
      '#A67628'
    ),
    paintPart(
      new THREE.CylinderGeometry(0.052, 0.064, 0.038, 14),
      '#D8A24A',
      composeLocalMatrix([0, -0.068, 0]),
      '#8C5E1C'
    ),
  ]);

  // 1e. Bắp nướng mỡ hành Đà Lạt (Grilled Golden Corn on Bamboo Skewer with Scallion Glaze)
  const cornParts: THREE.BufferGeometry[] = [
    paintPart(
      new THREE.CylinderGeometry(0.005, 0.005, 0.14, 8),
      '#C89E68',
      composeLocalMatrix([0, -0.045, 0]),
      '#8E683C'
    ),
    paintPart(
      new THREE.CapsuleGeometry(0.034, 0.105, 8, 14),
      '#F6BE3B',
      composeLocalMatrix([0, 0.058, 0]),
      '#D4881C'
    ),
  ];
  // Char flecks & green scallion oil dabs
  const scallionSpots: Array<[number, number, number, string]> = [
    [0.028, 0.065, 0.018, '#4E9A42'],
    [-0.024, 0.082, 0.022, '#58AA48'],
    [0.014, 0.035, 0.03, '#478E3C'],
    [-0.018, 0.052, -0.028, '#58AA48'],
    [0.026, 0.095, -0.016, '#5A3218'],
    [-0.029, 0.028, 0.015, '#5A3218'],
    [0.008, 0.075, -0.032, '#4E9A42'],
  ];
  for (const [sx, sy, sz, hex] of scallionSpots) {
    cornParts.push(
      paintPart(
        new THREE.SphereGeometry(0.0085, 6, 5),
        hex,
        composeLocalMatrix([sx, sy, sz], [0, 0, 0], [1.2, 0.7, 1.2])
      )
    );
  }
  const roastedCornFull = mergePainted(cornParts);

  // 1f. Khoai lang mật nướng (Paper-wrapped Split Honey Roasted Sweet Potato)
  const potatoParts: THREE.BufferGeometry[] = [
    // Kraft paper cone wrapper
    paintPart(
      new THREE.ConeGeometry(0.046, 0.115, 12),
      '#D2AE82',
      composeLocalMatrix([0, 0.005, 0], [Math.PI, 0, 0]),
      '#9C7850'
    ),
    // Purple-brown roasted skin
    paintPart(
      new THREE.CapsuleGeometry(0.034, 0.075, 7, 12),
      '#7C3F38',
      composeLocalMatrix([0, 0.048, 0], [0.08, 0, 0.06]),
      '#4E2420'
    ),
    // Glowing golden-orange split honey flesh
    paintPart(
      new THREE.SphereGeometry(0.029, 10, 8),
      '#FF9E2C',
      composeLocalMatrix([0.006, 0.072, 0.012], [0, 0, -0.15], [0.95, 1.35, 0.85]),
      '#E06B12'
    ),
  ];
  const sweetPotatoFull = mergePainted(potatoParts);

  // 1g. Bó hoa Cẩm Tú Cầu Đà Lạt (Pastel Blue-Lavender Hydrangea Bouquet in Kraft Paper)
  const hydParts: THREE.BufferGeometry[] = [
    paintPart(
      new THREE.ConeGeometry(0.072, 0.165, 12),
      '#DEC09A',
      composeLocalMatrix([0, 0.02, 0], [Math.PI, 0, 0]),
      '#A88660'
    ),
    paintPart(
      new THREE.TorusGeometry(0.028, 0.007, 6, 12),
      '#D97B8F',
      composeLocalMatrix([0, -0.015, 0], [Math.PI / 2, 0, 0])
    ),
  ];
  const leafAngles = [0, 1.25, 2.5, 3.75, 5.0];
  for (const ang of leafAngles) {
    hydParts.push(
      paintPart(
        new THREE.SphereGeometry(0.032, 7, 6),
        '#467E4A',
        composeLocalMatrix(
          [Math.cos(ang) * 0.048, 0.095, Math.sin(ang) * 0.048],
          [0.35, ang, 0],
          [1.1, 0.45, 1.3]
        ),
        '#254B2A'
      )
    );
  }
  const floretCenters: Array<[number, number, number, string]> = [
    [0, 0.132, 0, '#9EC0FA'],
    [0.036, 0.118, 0.024, '#B9B0FA'],
    [-0.036, 0.12, 0.022, '#8FB2F4'],
    [0.024, 0.116, -0.034, '#C8D8FF'],
    [-0.026, 0.118, -0.032, '#ACBAFA'],
    [0, 0.108, 0.044, '#B4C8FC'],
  ];
  for (const [fx, fy, fz, col] of floretCenters) {
    hydParts.push(
      paintPart(new THREE.IcosahedronGeometry(0.032, 1), col, composeLocalMatrix([fx, fy, fz]))
    );
  }
  const hydrangeaBouquetFull = mergePainted(hydParts);

  // 1h. Nhành hoa Dã Quỳ vàng rực (Wild Highland Sunflower Bouquet)
  const dqParts: THREE.BufferGeometry[] = [
    paintPart(
      new THREE.CylinderGeometry(0.016, 0.012, 0.14, 8),
      '#467A3E',
      composeLocalMatrix([0, 0.01, 0]),
      '#284B24'
    ),
    paintPart(
      new THREE.TorusGeometry(0.019, 0.005, 6, 10),
      '#C87D55',
      composeLocalMatrix([0, -0.01, 0], [Math.PI / 2, 0, 0])
    ),
  ];
  const dqHeads: Array<[number, number, number, number, number]> = [
    [0, 0.122, 0.015, 0.35, 0],
    [-0.044, 0.102, 0.022, 0.42, 0.45],
    [0.044, 0.104, 0.018, 0.42, -0.45],
    [-0.024, 0.11, -0.032, -0.35, 0.3],
    [0.026, 0.108, -0.03, -0.35, -0.3],
  ];
  for (const [hx, hy, hz, rx, rz] of dqHeads) {
    for (let p = 0; p < 8; p++) {
      const a = (p / 8) * Math.PI * 2;
      dqParts.push(
        paintPart(
          new THREE.ConeGeometry(0.011, 0.038, 4),
          '#FFCA28',
          composeLocalMatrix(
            [hx + Math.cos(a) * 0.02, hy + 0.004, hz + Math.sin(a) * 0.02],
            [Math.PI * 0.48 + rx * 0.4, -a, rz * 0.4],
            [1, 1, 0.35]
          ),
          '#E0890B'
        )
      );
    }
    dqParts.push(
      paintPart(
        new THREE.SphereGeometry(0.014, 8, 6),
        '#8A420A',
        composeLocalMatrix([hx, hy + 0.006, hz], [0, 0, 0], [1, 0.6, 1]),
        '#4E2204'
      )
    );
  }
  const daQuyBouquetFull = mergePainted(dqParts);

  // 1i. Pháo sáng bình minh (Handheld Sparkler Wand + Golden Star Rays)
  const spRod = mergePainted([
    paintPart(
      new THREE.CylinderGeometry(0.0028, 0.0028, 0.19, 6),
      '#9AA4B2',
      composeLocalMatrix([0, 0.045, 0])
    ),
    paintPart(
      new THREE.CylinderGeometry(0.0055, 0.0055, 0.095, 8),
      '#585E68',
      composeLocalMatrix([0, 0.095, 0])
    ),
  ]);
  const sparkRayParts: THREE.BufferGeometry[] = [
    paintPart(new THREE.OctahedronGeometry(0.022, 0), '#FFF8DC'),
  ];
  for (let r = 0; r < 10; r++) {
    const phi = (r / 10) * Math.PI * 2;
    const elev = ((r % 3) - 1) * 0.55;
    sparkRayParts.push(
      paintPart(
        new THREE.ConeGeometry(0.0045, 0.075, 4),
        '#FFD86B',
        composeLocalMatrix(
          [Math.cos(phi) * 0.028, Math.sin(elev) * 0.028, Math.sin(phi) * 0.028],
          [elev + Math.PI / 2, 0, -phi]
        ),
        '#FF9824'
      )
    );
  }
  const sparklerBurstGeo = mergePainted(sparkRayParts);

  return {
    phinCoreFull,
    guitarFull,
    cameraFull,
    lanternBrassFull,
    roastedCornFull,
    sweetPotatoFull,
    hydrangeaBouquetFull,
    daQuyBouquetFull,
    sparklerRodGeo: spRod,
    sparklerBurstGeo,
    soyGlass: new THREE.CylinderGeometry(0.042, 0.035, 0.108, 20),
    soyLiquid: new THREE.CylinderGeometry(0.038, 0.032, 0.088, 18),
    phinCup: new THREE.CylinderGeometry(0.041, 0.035, 0.092, 20),
    lanternGlobe: new THREE.SphereGeometry(0.056, 14, 12),
    lanternHalo: new THREE.SphereGeometry(0.115, 12, 10),
    vaporPuff: new THREE.SphereGeometry(0.026, 10, 8),
    shadowBlob: new THREE.CircleGeometry(0.38, 20),
  };
})();

// ============================================================================
// 2. HEADWEAR 3D BUILDERS (Parented to `Head` bone in 1.0x rig space)
// ============================================================================

const HEADWEAR_GEO_CACHE = new Map<string, THREE.BufferGeometry>();

export function getCustomHeadwearGeometry(
  headwear: HeadwearId,
  coatColor: string,
  scarfColor: string
): THREE.BufferGeometry | null {
  if (
    headwear === 'none' ||
    headwear === 'scarf_only' ||
    headwear === 'beanie' ||
    headwear === 'beret'
  ) {
    return null; // Handled by built-in GLB meshes
  }

  const key = `${headwear}|${coatColor}|${scarfColor}`;
  const cached = HEADWEAR_GEO_CACHE.get(key);
  if (cached) return cached;

  let geo: THREE.BufferGeometry;

  switch (headwear) {
    case 'bucket_hat': {
      // Sloped canvas bucket hat with contrast scarfColor ribbon band
      geo = mergePainted([
        paintPart(
          new THREE.CylinderGeometry(0.096, 0.108, 0.072, 24),
          coatColor,
          composeLocalMatrix([0, 0.042, 0]),
          undefined
        ),
        paintPart(
          new THREE.CylinderGeometry(0.094, 0.096, 0.012, 24),
          coatColor,
          composeLocalMatrix([0, 0.079, 0])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.109, 0.111, 0.018, 24),
          scarfColor,
          composeLocalMatrix([0, 0.014, 0])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.11, 0.156, 0.032, 28, 1, true),
          coatColor,
          composeLocalMatrix([0, -0.008, 0])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.108, 0.153, 0.03, 28, 1, true),
          coatColor,
          composeLocalMatrix([0, -0.009, 0], [0, 0, 0], [-1, 1, 1])
        ),
      ]);
      break;
    }

    case 'fedora_wool': {
      // Wide-brim felt highland fedora with pinched crown & leather buckle band
      geo = mergePainted([
        paintPart(
          new THREE.CylinderGeometry(0.168, 0.172, 0.009, 28),
          coatColor,
          composeLocalMatrix([0, 0.0, 0], [0.04, 0, 0], [0.94, 1, 1.04])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.088, 0.106, 0.082, 24),
          coatColor,
          composeLocalMatrix([0, 0.044, 0], [0, 0, 0], [0.92, 1, 1.06])
        ),
        paintPart(
          new THREE.SphereGeometry(0.088, 18, 10),
          coatColor,
          composeLocalMatrix([0, 0.08, 0], [0, 0, 0], [0.9, 0.28, 1.05])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.107, 0.108, 0.02, 24),
          scarfColor,
          composeLocalMatrix([0, 0.014, 0], [0, 0, 0], [0.93, 1, 1.06])
        ),
        paintPart(
          new THREE.BoxGeometry(0.018, 0.022, 0.008),
          '#E0AC52',
          composeLocalMatrix([-0.098, 0.014, 0.02], [0, 0.2, 0])
        ),
      ]);
      break;
    }

    case 'straw_boater': {
      // Woven golden straw boater hat with dark ribbon & white daisy
      const parts: THREE.BufferGeometry[] = [
        paintPart(
          new THREE.CylinderGeometry(0.166, 0.168, 0.01, 28),
          '#E6C480',
          composeLocalMatrix([0, 0, 0]),
          '#C29B52'
        ),
        paintPart(
          new THREE.CylinderGeometry(0.104, 0.106, 0.068, 24),
          '#ECD092',
          composeLocalMatrix([0, 0.038, 0]),
          '#C6A058'
        ),
        paintPart(
          new THREE.CylinderGeometry(0.107, 0.108, 0.022, 24),
          scarfColor,
          composeLocalMatrix([0, 0.016, 0])
        ),
        paintPart(
          new THREE.SphereGeometry(0.01, 8, 6),
          '#F5B82E',
          composeLocalMatrix([0.098, 0.026, 0.048])
        ),
      ];
      for (let p = 0; p < 6; p++) {
        const a = (p / 6) * Math.PI * 2;
        parts.push(
          paintPart(
            new THREE.SphereGeometry(0.009, 6, 5),
            '#FFFDF8',
            composeLocalMatrix([
              0.102,
              0.026 + Math.sin(a) * 0.014,
              0.048 + Math.cos(a) * 0.014,
            ])
          )
        );
      }
      geo = mergePainted(parts);
      break;
    }

    case 'non_la': {
      // Iconic Vietnamese conical palm hat (Nón Lá) with bamboo rings & silk ribbon
      const parts: THREE.BufferGeometry[] = [
        paintPart(
          new THREE.ConeGeometry(0.205, 0.145, 28),
          '#EFE0BA',
          composeLocalMatrix([0, 0.056, 0]),
          '#C8B080'
        ),
        paintPart(
          new THREE.TorusGeometry(0.203, 0.004, 6, 28),
          '#B89660',
          composeLocalMatrix([0, -0.015, 0], [Math.PI / 2, 0, 0])
        ),
        paintPart(
          new THREE.TorusGeometry(0.132, 0.003, 6, 24),
          '#C6A670',
          composeLocalMatrix([0, 0.034, 0], [Math.PI / 2, 0, 0])
        ),
        // Soft silk chin ribbon tucked gracefully along jawline
        paintPart(
          new THREE.TorusGeometry(0.098, 0.0045, 6, 18, Math.PI),
          scarfColor,
          composeLocalMatrix([0, -0.015, 0.012], [Math.PI + 0.18, 0, 0], [0.96, 1.22, 1])
        ),
      ];
      geo = mergePainted(parts);
      break;
    }

    case 'earmuffs': {
      // Plush cream/scarf fleece earmuffs arching over hair down to left & right ears
      geo = mergePainted([
        paintPart(
          new THREE.TorusGeometry(0.114, 0.0085, 8, 22, Math.PI),
          coatColor,
          composeLocalMatrix([0, -0.068, -0.018], [0, 0, 0], [0.95, 1.12, 1])
        ),
        paintPart(
          new THREE.SphereGeometry(0.038, 14, 12),
          scarfColor,
          composeLocalMatrix([-0.108, -0.072, -0.018], [0, 0, 0], [0.68, 1.05, 1.05])
        ),
        paintPart(
          new THREE.SphereGeometry(0.038, 14, 12),
          scarfColor,
          composeLocalMatrix([0.108, -0.072, -0.018], [0, 0, 0], [0.68, 1.05, 1.05])
        ),
      ]);
      break;
    }

    case 'flower_crown': {
      // Braided eucalyptus vine + 7 golden Da Quy wildflower blossoms around crown
      const parts: THREE.BufferGeometry[] = [
        paintPart(
          new THREE.TorusGeometry(0.11, 0.009, 8, 26),
          '#427644',
          composeLocalMatrix([0, -0.004, 0.005], [Math.PI / 2 + 0.08, 0, 0], [0.94, 1.08, 1]),
          '#254A28'
        ),
      ];
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const fx = Math.cos(ang) * 0.105;
        const fz = Math.sin(ang) * 0.118 + 0.005;
        const fy = -0.004 - Math.sin(ang) * 0.009;
        const petalCol = i % 2 === 0 ? '#FFCA28' : '#FFF4D4';
        for (let p = 0; p < 6; p++) {
          const pa = (p / 6) * Math.PI * 2;
          parts.push(
            paintPart(
              new THREE.SphereGeometry(0.0095, 6, 5),
              petalCol,
              composeLocalMatrix([
                fx + Math.cos(ang) * 0.006 + Math.cos(pa) * 0.011 * -Math.sin(ang),
                fy + Math.sin(pa) * 0.011,
                fz + Math.sin(ang) * 0.006 + Math.cos(pa) * 0.011 * Math.cos(ang),
              ])
            )
          );
        }
        parts.push(
          paintPart(
            new THREE.SphereGeometry(0.0075, 6, 5),
            '#B86214',
            composeLocalMatrix([fx + Math.cos(ang) * 0.009, fy, fz + Math.sin(ang) * 0.009])
          )
        );
      }
      geo = mergePainted(parts);
      break;
    }

    case 'cat_beanie':
    default: {
      // Cozy ribbed knit beanie with folded cuff & twin pointed cat ears
      geo = mergePainted([
        paintPart(
          new THREE.SphereGeometry(0.116, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56),
          scarfColor,
          composeLocalMatrix([0, -0.018, 0.004], [0, 0, 0], [0.95, 0.96, 1.06])
        ),
        paintPart(
          new THREE.TorusGeometry(0.112, 0.018, 10, 24),
          coatColor,
          composeLocalMatrix([0, -0.012, 0.004], [Math.PI / 2 + 0.06, 0, 0], [0.96, 1.08, 1])
        ),
        // Left & right cat ears
        paintPart(
          new THREE.ConeGeometry(0.036, 0.058, 4),
          scarfColor,
          composeLocalMatrix([-0.068, 0.082, 0.01], [0.08, Math.PI / 4, 0.34])
        ),
        paintPart(
          new THREE.ConeGeometry(0.036, 0.058, 4),
          scarfColor,
          composeLocalMatrix([0.068, 0.082, 0.01], [0.08, Math.PI / 4, -0.34])
        ),
        paintPart(
          new THREE.ConeGeometry(0.02, 0.036, 4),
          '#F2B6C1',
          composeLocalMatrix([-0.066, 0.08, 0.02], [0.1, Math.PI / 4, 0.34])
        ),
        paintPart(
          new THREE.ConeGeometry(0.02, 0.036, 4),
          '#F2B6C1',
          composeLocalMatrix([0.066, 0.08, 0.02], [0.1, Math.PI / 4, -0.34])
        ),
      ]);
      break;
    }
  }

  HEADWEAR_GEO_CACHE.set(key, geo);
  return geo;
}

// ============================================================================
// 3. EYEWEAR 3D BUILDERS (Parented to `Head` bone at exact Eye midpoint)
// ============================================================================

export function buildEyewearGroup(eyewear: EyewearId): THREE.Group | null {
  if (eyewear === 'none') return null;

  const group = new THREE.Group();
  group.name = `CustomEyewear_${eyewear}`;

  if (eyewear === 'blush_cheeks') {
    const geo = mergePainted([
      paintPart(
        new THREE.SphereGeometry(0.018, 10, 8),
        '#F28B9C',
        composeLocalMatrix([-0.048, -0.024, -0.004], [0, -0.32, 0], [1.25, 0.68, 0.32])
      ),
      paintPart(
        new THREE.SphereGeometry(0.018, 10, 8),
        '#F28B9C',
        composeLocalMatrix([0.048, -0.024, -0.004], [0, 0.32, 0], [1.25, 0.68, 0.32])
      ),
      // Cute cream highland band-aid across nose bridge
      paintPart(
        new THREE.BoxGeometry(0.03, 0.009, 0.006),
        '#F5DFC6',
        composeLocalMatrix([0, -0.014, 0.012], [0.22, 0, 0.08])
      ),
    ]);
    const mesh = new THREE.Mesh(geo, SHARED_VCOLOR_MAT);
    group.add(mesh);
    return group;
  }

  const isTortoise = eyewear === 'retro_tortoise';
  const frameHex =
    eyewear === 'round_vintage'
      ? '#E0B458'
      : eyewear === 'sun_amber'
        ? '#D9A448'
        : eyewear === 'rose_tinted'
          ? '#E4A8A8'
          : '#38241A';
  const lensHex =
    eyewear === 'round_vintage'
      ? '#D8ECF8'
      : eyewear === 'sun_amber'
        ? '#E08C28'
        : eyewear === 'rose_tinted'
          ? '#E87A9E'
          : '#1D222B';
  const lensOpacity = eyewear === 'round_vintage' ? 0.32 : 0.72;
  const rimTube = isTortoise ? 0.0042 : 0.0024;
  const lensR = isTortoise ? 0.023 : 0.022;

  const frameGeo = mergePainted([
    paintPart(
      new THREE.TorusGeometry(lensR, rimTube, 8, isTortoise ? 16 : 22),
      frameHex,
      composeLocalMatrix([-0.033, 0, 0], [0, 0, 0], isTortoise ? [1.12, 0.92, 1] : [1, 1, 1])
    ),
    paintPart(
      new THREE.TorusGeometry(lensR, rimTube, 8, isTortoise ? 16 : 22),
      frameHex,
      composeLocalMatrix([0.033, 0, 0], [0, 0, 0], isTortoise ? [1.12, 0.92, 1] : [1, 1, 1])
    ),
    // Nose bridge
    paintPart(
      new THREE.CylinderGeometry(rimTube * 0.9, rimTube * 0.9, 0.022, 6),
      frameHex,
      composeLocalMatrix([0, 0.004, 0.002], [0, 0, Math.PI / 2])
    ),
    // Left & right ear temples
    paintPart(
      new THREE.CylinderGeometry(rimTube * 0.8, rimTube * 0.8, 0.078, 6),
      frameHex,
      composeLocalMatrix([-0.058, 0.003, -0.038], [Math.PI / 2, 0, 0.06])
    ),
    paintPart(
      new THREE.CylinderGeometry(rimTube * 0.8, rimTube * 0.8, 0.078, 6),
      frameHex,
      composeLocalMatrix([0.058, 0.003, -0.038], [Math.PI / 2, 0, -0.06])
    ),
  ]);

  const lensGeo = new THREE.CylinderGeometry(lensR - 0.001, lensR - 0.001, 0.002, 20);
  lensGeo.rotateX(Math.PI / 2);

  const frameMesh = new THREE.Mesh(
    frameGeo,
    isTortoise ? SHARED_VCOLOR_MAT : SHARED_METALLIC_VCOLOR_MAT
  );
  const leftLens = new THREE.Mesh(lensGeo, getLensMaterial(lensHex, lensOpacity));
  leftLens.position.set(-0.033, 0, 0);
  if (isTortoise) leftLens.scale.set(1.12, 0.92, 1);

  const rightLens = new THREE.Mesh(lensGeo, getLensMaterial(lensHex, lensOpacity));
  rightLens.position.set(0.033, 0, 0);
  if (isTortoise) rightLens.scale.set(1.12, 0.92, 1);

  group.add(frameMesh, leftLens, rightLens);
  return group;
}

// ============================================================================
// 4. COAT LAYERING OVERLAYS & NECKWEAR & BAGS (Parented to `Spine2` chest bone)
// ============================================================================

const COAT_OVERLAY_CACHE = new Map<string, THREE.BufferGeometry>();

export function getCoatOverlayGeometry(
  coatStyle: CoatStyleId,
  coatColor: string,
  scarfColor: string
): THREE.BufferGeometry | null {
  if (coatStyle === 'knit_sweater' || coatStyle === 'puffer_vest') {
    return null; // Pure base GLB silhouette
  }

  const key = `${coatStyle}|${coatColor}|${scarfColor}`;
  const cached = COAT_OVERLAY_CACHE.get(key);
  if (cached) return cached;

  let geo: THREE.BufferGeometry;

  switch (coatStyle) {
    case 'wool_trench': {
      // Double-breasted horn buttons + belted trench waist sash with brass buckle
      const parts: THREE.BufferGeometry[] = [
        paintPart(
          new THREE.CylinderGeometry(0.148, 0.154, 0.034, 22),
          coatColor,
          composeLocalMatrix([0, -0.175, 0.025], [0, 0, 0], [1.06, 1, 0.88])
        ),
        paintPart(
          new THREE.BoxGeometry(0.042, 0.044, 0.014),
          '#E0AC52',
          composeLocalMatrix([0, -0.175, 0.162])
        ),
      ];
      for (const bx of [-0.042, 0.042]) {
        for (const by of [0.025, -0.045, -0.115]) {
          parts.push(
            paintPart(
              new THREE.CylinderGeometry(0.011, 0.011, 0.008, 10),
              '#3E2618',
              composeLocalMatrix([bx, by, 0.164], [Math.PI / 2, 0, 0])
            )
          );
        }
      }
      geo = mergePainted(parts);
      break;
    }

    case 'sherpa_cape': {
      // Tailored mid-arm highland wool capelet with plush cream shearling border, front trim & horn toggles
      const zCenter = 0.012;
      const parts: THREE.BufferGeometry[] = [
        paintPart(
          new THREE.CylinderGeometry(0.122, 0.252, 0.27, 28, 1, true),
          coatColor,
          composeLocalMatrix([0, 0.0, zCenter], [0, 0, 0], [1.07, 1, 0.74])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.12, 0.249, 0.268, 28, 1, true),
          '#F5EDE0',
          composeLocalMatrix([0, 0.0, zCenter], [0, 0, 0], [-1.06, 1, 0.73])
        ),
        // Plush cream shearling bottom border band hugging the capelet drape
        paintPart(
          new THREE.CylinderGeometry(0.234, 0.254, 0.042, 28, 1, true),
          '#F7EFE2',
          composeLocalMatrix([0, -0.116, zCenter], [0, 0, 0], [1.078, 1, 0.748]),
          '#E6DAC6'
        ),
        // Rolled cream sherpa collar
        paintPart(
          new THREE.TorusGeometry(0.12, 0.021, 10, 26),
          '#F7EFE2',
          composeLocalMatrix([0, 0.132, zCenter - 0.002], [Math.PI / 2 + 0.06, 0, 0], [1.04, 0.8, 1]),
          '#E6DAC6'
        ),
        // Center-front cream shearling placket strip sloped flush along the capelet front
        paintPart(
          new THREE.BoxGeometry(0.032, 0.255, 0.012),
          '#F7EFE2',
          composeLocalMatrix([0, 0.002, 0.151], [-0.342, 0, 0]),
          '#E6DAC6'
        ),
        // Twin cord loops + wooden horn toggles flush on the sloped front
        paintPart(
          new THREE.BoxGeometry(0.052, 0.008, 0.009),
          '#E8D8C0',
          composeLocalMatrix([0, 0.056, 0.135], [-0.342, 0, 0])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.007, 0.005, 0.038, 8),
          '#5C3620',
          composeLocalMatrix([0, 0.056, 0.14], [0, 0, Math.PI / 2])
        ),
        paintPart(
          new THREE.BoxGeometry(0.052, 0.008, 0.009),
          '#E8D8C0',
          composeLocalMatrix([0, -0.022, 0.162], [-0.342, 0, 0])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.007, 0.005, 0.038, 8),
          '#5C3620',
          composeLocalMatrix([0, -0.022, 0.167], [0, 0, Math.PI / 2])
        ),
      ];
      geo = mergePainted(parts);
      break;
    }

    case 'highland_poncho':
    case 'vintage_poncho': {
      // Authentic draped highland woven poncho cape with scarfColor pattern band & bottom fringes
      const zCenter = coatStyle === 'vintage_poncho' ? -0.008 : 0.014;
      const parts: THREE.BufferGeometry[] = [
        paintPart(
          new THREE.CylinderGeometry(0.125, 0.275, 0.35, 26, 1, true),
          coatColor,
          composeLocalMatrix([0, -0.035, zCenter], [0, 0, 0], [1.08, 1, 0.74])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.123, 0.272, 0.348, 26, 1, true),
          coatColor,
          composeLocalMatrix([0, -0.035, zCenter], [0, 0, 0], [-1.07, 1, 0.73])
        ),
        // Contrast woven geometric band near hem
        paintPart(
          new THREE.CylinderGeometry(0.242, 0.268, 0.052, 26, 1, true),
          scarfColor,
          composeLocalMatrix([0, -0.168, zCenter], [0, 0, 0], [1.085, 1, 0.745])
        ),
        paintPart(
          new THREE.TorusGeometry(0.122, 0.018, 8, 22),
          scarfColor,
          composeLocalMatrix([0, 0.132, zCenter], [Math.PI / 2 + 0.06, 0, 0], [1.05, 0.82, 1])
        ),
      ];
      // 18 cream woven tassels around poncho hem
      for (let t = 0; t < 18; t++) {
        const ang = (t / 18) * Math.PI * 2;
        const tx = Math.cos(ang) * 0.276 * 1.07;
        const tz = Math.sin(ang) * 0.276 * 0.74 + zCenter;
        parts.push(
          paintPart(
            new THREE.ConeGeometry(0.008, 0.042, 5),
            '#F4EBDD',
            composeLocalMatrix([tx, -0.225, tz], [Math.PI, 0, 0])
          )
        );
      }
      geo = mergePainted(parts);
      break;
    }

    case 'quilted_gilet': {
      // Tailored 4-baffle quilted down puffer gilet vest snugly enclosing the jacket torso with exposed long sleeves
      const zOff = 0.016;
      const parts: THREE.BufferGeometry[] = [
        // Stand-up puffy collar
        paintPart(
          new THREE.CylinderGeometry(0.116, 0.126, 0.056, 24),
          scarfColor,
          composeLocalMatrix([0, 0.144, zOff - 0.01], [0.06, 0, 0], [1.0, 1, 0.92])
        ),
        // Upper contrast shoulder yoke baffle
        paintPart(
          new THREE.CylinderGeometry(0.154, 0.172, 0.078, 26),
          scarfColor,
          composeLocalMatrix([0, 0.082, zOff], [0, 0, 0], [1.05, 1, 0.9])
        ),
        // 3 sculpted horizontal down baffles in coatColor with crisp quilt seams
        paintPart(
          new THREE.CylinderGeometry(0.173, 0.176, 0.076, 26),
          coatColor,
          composeLocalMatrix([0, 0.004, zOff], [0, 0, 0], [1.06, 1, 0.91])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.176, 0.175, 0.076, 26),
          coatColor,
          composeLocalMatrix([0, -0.074, zOff], [0, 0, 0], [1.06, 1, 0.91])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.174, 0.168, 0.078, 26),
          coatColor,
          composeLocalMatrix([0, -0.152, zOff], [0, 0, 0], [1.05, 1, 0.9])
        ),
        // Subtle quilt seam grooves
        paintPart(
          new THREE.TorusGeometry(0.173, 0.004, 6, 26),
          '#2A201B',
          composeLocalMatrix([0, 0.043, zOff], [Math.PI / 2, 0, 0], [1.06, 0.91, 1])
        ),
        paintPart(
          new THREE.TorusGeometry(0.176, 0.004, 6, 26),
          '#2A201B',
          composeLocalMatrix([0, -0.035, zOff], [Math.PI / 2, 0, 0], [1.06, 0.91, 1])
        ),
        paintPart(
          new THREE.TorusGeometry(0.174, 0.004, 6, 26),
          '#2A201B',
          composeLocalMatrix([0, -0.113, zOff], [Math.PI / 2, 0, 0], [1.05, 0.9, 1])
        ),
        // Front center silver zipper placket + twin angled hand-warmer welt pockets
        paintPart(
          new THREE.BoxGeometry(0.016, 0.33, 0.012),
          '#DCE3EC',
          composeLocalMatrix([0, -0.026, zOff + 0.159])
        ),
        paintPart(
          new THREE.BoxGeometry(0.014, 0.082, 0.012),
          scarfColor,
          composeLocalMatrix([-0.088, -0.108, zOff + 0.134], [0, -0.46, -0.18])
        ),
        paintPart(
          new THREE.BoxGeometry(0.014, 0.082, 0.012),
          scarfColor,
          composeLocalMatrix([0.088, -0.108, zOff + 0.134], [0, 0.46, 0.18])
        ),
      ];
      geo = mergePainted(parts);
      break;
    }

    case 'cardigan_vest': {
      // Female vintage Da Lat knit cardigan vest with cream Peter-Pan collar, silk ribbon bow-tie & pine buttons
      const zOff = 0.014;
      const parts: THREE.BufferGeometry[] = [
        // Ribbed knit vest bodice overlay
        paintPart(
          new THREE.CylinderGeometry(0.146, 0.156, 0.24, 24),
          coatColor,
          composeLocalMatrix([0, -0.045, zOff], [0, 0, 0], [1.04, 1, 0.86])
        ),
        // Contrast ribbed bottom hem band
        paintPart(
          new THREE.CylinderGeometry(0.156, 0.152, 0.036, 24),
          scarfColor,
          composeLocalMatrix([0, -0.168, zOff], [0, 0, 0], [1.05, 1, 0.87])
        ),
        // Crisp cream blouse collar at neckline
        paintPart(
          new THREE.TorusGeometry(0.114, 0.017, 8, 22),
          '#FAF3E6',
          composeLocalMatrix([0, 0.128, zOff - 0.004], [Math.PI / 2 + 0.08, 0, 0], [1.04, 0.82, 1]),
          '#E2D6C3'
        ),
        // Silk ribbon bow-tie at throat in scarfColor
        paintPart(
          new THREE.BoxGeometry(0.036, 0.022, 0.012),
          scarfColor,
          composeLocalMatrix([-0.022, 0.095, zOff + 0.122], [0, 0.18, 0.18])
        ),
        paintPart(
          new THREE.BoxGeometry(0.036, 0.022, 0.012),
          scarfColor,
          composeLocalMatrix([0.022, 0.095, zOff + 0.122], [0, -0.18, -0.18])
        ),
        paintPart(
          new THREE.SphereGeometry(0.012, 8, 8),
          scarfColor,
          composeLocalMatrix([0, 0.095, zOff + 0.127])
        ),
        paintPart(
          new THREE.BoxGeometry(0.016, 0.064, 0.008),
          scarfColor,
          composeLocalMatrix([-0.014, 0.056, zOff + 0.132], [-0.14, 0, 0.18])
        ),
        paintPart(
          new THREE.BoxGeometry(0.016, 0.064, 0.008),
          scarfColor,
          composeLocalMatrix([0.014, 0.056, zOff + 0.132], [-0.14, 0, -0.18])
        ),
        // Center cardigan button placket
        paintPart(
          new THREE.BoxGeometry(0.024, 0.24, 0.01),
          scarfColor,
          composeLocalMatrix([0, -0.052, zOff + 0.132])
        ),
      ];
      for (const by of [0.012, -0.042, -0.096, -0.15]) {
        parts.push(
          paintPart(
            new THREE.CylinderGeometry(0.009, 0.009, 0.008, 10),
            '#5C3620',
            composeLocalMatrix([0, by, zOff + 0.139], [Math.PI / 2, 0, 0])
          )
        );
      }
      geo = mergePainted(parts);
      break;
    }

    case 'velvet_cloak': {
      // Female double-tiered Peter-Pan pelerine capelet coat with vintage gold brooch & warm hand-muff pockets
      const zCenter = 0.015;
      const parts: THREE.BufferGeometry[] = [
        // Lower tailored velvet pelerine shoulder capelet
        paintPart(
          new THREE.CylinderGeometry(0.126, 0.238, 0.195, 26, 1, true),
          coatColor,
          composeLocalMatrix([0, 0.032, zCenter], [0, 0, 0], [1.06, 1, 0.76])
        ),
        // Upper contrast Peter-Pan collar tier in scarfColor
        paintPart(
          new THREE.CylinderGeometry(0.118, 0.188, 0.088, 26, 1, true),
          scarfColor,
          composeLocalMatrix([0, 0.094, zCenter], [0, 0, 0], [1.065, 1, 0.77])
        ),
        // Soft rolled collar rim
        paintPart(
          new THREE.TorusGeometry(0.118, 0.016, 8, 24),
          '#FAF2E4',
          composeLocalMatrix([0, 0.134, zCenter - 0.002], [Math.PI / 2 + 0.06, 0, 0], [1.04, 0.8, 1])
        ),
        // Vintage brass & pearl oval brooch at throat
        paintPart(
          new THREE.CylinderGeometry(0.018, 0.018, 0.008, 12),
          '#E6B455',
          composeLocalMatrix([0, 0.088, zCenter + 0.135], [Math.PI / 2 - 0.25, 0, 0])
        ),
        paintPart(
          new THREE.SphereGeometry(0.01, 8, 8),
          '#FFF8EE',
          composeLocalMatrix([0, 0.088, zCenter + 0.14])
        ),
        // Tailored waist belt + plush front hand-warmer pockets
        paintPart(
          new THREE.CylinderGeometry(0.148, 0.154, 0.03, 22),
          scarfColor,
          composeLocalMatrix([0, -0.155, zCenter + 0.01], [0, 0, 0], [1.05, 1, 0.88])
        ),
        paintPart(
          new THREE.BoxGeometry(0.056, 0.068, 0.022),
          coatColor,
          composeLocalMatrix([-0.068, -0.142, zCenter + 0.136], [0, -0.24, 0])
        ),
        paintPart(
          new THREE.BoxGeometry(0.06, 0.018, 0.024),
          scarfColor,
          composeLocalMatrix([-0.068, -0.112, zCenter + 0.138], [0, -0.24, 0])
        ),
        paintPart(
          new THREE.BoxGeometry(0.056, 0.068, 0.022),
          coatColor,
          composeLocalMatrix([0.068, -0.142, zCenter + 0.136], [0, 0.24, 0])
        ),
        paintPart(
          new THREE.BoxGeometry(0.06, 0.018, 0.024),
          scarfColor,
          composeLocalMatrix([0.068, -0.112, zCenter + 0.138], [0, 0.24, 0])
        ),
      ];
      geo = mergePainted(parts);
      break;
    }

    case 'corduroy_safari': {
      // Male shearling-collared corduroy safari field jacket with 4 cargo flap pockets & belted waist
      const zOff = 0.015;
      const parts: THREE.BufferGeometry[] = [
        // Plush cream shearling turnover collar
        paintPart(
          new THREE.TorusGeometry(0.124, 0.022, 10, 24),
          '#F6EDE0',
          composeLocalMatrix([0, 0.142, zOff - 0.008], [Math.PI / 2 + 0.08, 0, 0], [1.04, 0.86, 1]),
          '#E2D4C0'
        ),
        // Shoulder epaulettes in scarfColor
        paintPart(
          new THREE.BoxGeometry(0.068, 0.012, 0.032),
          scarfColor,
          composeLocalMatrix([-0.132, 0.122, zOff], [0, 0, 0.22])
        ),
        paintPart(
          new THREE.BoxGeometry(0.068, 0.012, 0.032),
          scarfColor,
          composeLocalMatrix([0.132, 0.122, zOff], [0, 0, -0.22])
        ),
        // Center storm placket + belted safari waist sash with brass buckle
        paintPart(
          new THREE.BoxGeometry(0.034, 0.31, 0.012),
          coatColor,
          composeLocalMatrix([0, -0.025, zOff + 0.146])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.168, 0.172, 0.034, 24),
          scarfColor,
          composeLocalMatrix([0, -0.115, zOff + 0.004], [0, 0, 0], [1.05, 1, 0.9])
        ),
        paintPart(
          new THREE.BoxGeometry(0.042, 0.044, 0.016),
          '#E0AC52',
          composeLocalMatrix([0, -0.115, zOff + 0.156])
        ),
      ];
      // 4 pleated cargo pockets (2 upper chest + 2 lower hip) with contrast flaps & brass snaps
      for (const [px, py, rotY] of [
        [-0.068, 0.032, -0.22],
        [0.068, 0.032, 0.22],
        [-0.072, -0.168, -0.24],
        [0.072, -0.168, 0.24],
      ] as const) {
        parts.push(
          paintPart(
            new THREE.BoxGeometry(0.056, 0.064, 0.018),
            coatColor,
            composeLocalMatrix([px, py, zOff + 0.142], [0, rotY, 0])
          ),
          paintPart(
            new THREE.BoxGeometry(0.058, 0.02, 0.022),
            scarfColor,
            composeLocalMatrix([px, py + 0.024, zOff + 0.144], [0, rotY, 0])
          ),
          paintPart(
            new THREE.CylinderGeometry(0.006, 0.006, 0.008, 8),
            '#E0AC52',
            composeLocalMatrix([px, py + 0.018, zOff + 0.154], [Math.PI / 2, 0, 0])
          )
        );
      }
      geo = mergePainted(parts);
      break;
    }

    case 'tweed_overcoat': {
      // Male double-breasted highland tweed overcoat with wide notched lapels, 6 horn buttons & waist belt
      const zOff = 0.006;
      const parts: THREE.BufferGeometry[] = [
        // Tailored tweed double-breasted torso wrap covering inner waistcoat cleanly
        paintPart(
          new THREE.CylinderGeometry(0.152, 0.174, 0.33, 26),
          coatColor,
          composeLocalMatrix([0, -0.028, zOff], [0, 0, 0], [1.06, 1, 0.89])
        ),
        // Wide notched overcoat lapels in contrast scarfColor
        paintPart(
          new THREE.BoxGeometry(0.048, 0.185, 0.014),
          scarfColor,
          composeLocalMatrix([-0.048, 0.046, zOff + 0.142], [0, -0.18, 0.24])
        ),
        paintPart(
          new THREE.BoxGeometry(0.048, 0.185, 0.014),
          scarfColor,
          composeLocalMatrix([0.048, 0.046, zOff + 0.142], [0, 0.18, -0.24])
        ),
        // Upright collar band
        paintPart(
          new THREE.TorusGeometry(0.122, 0.018, 8, 22, Math.PI * 1.35),
          scarfColor,
          composeLocalMatrix([0, 0.134, zOff - 0.008], [Math.PI / 2 + 0.08, 0, 0.42], [1.04, 0.86, 1])
        ),
        // Belted tweed waist sash + brass buckle
        paintPart(
          new THREE.CylinderGeometry(0.172, 0.175, 0.034, 26),
          scarfColor,
          composeLocalMatrix([0, -0.142, zOff], [0, 0, 0], [1.07, 1, 0.91])
        ),
        paintPart(
          new THREE.BoxGeometry(0.044, 0.046, 0.016),
          '#E0AC52',
          composeLocalMatrix([0, -0.142, zOff + 0.16])
        ),
      ];
      // 6 double-breasted horn buttons
      for (const bx of [-0.044, 0.044]) {
        for (const by of [0.015, -0.052, -0.115]) {
          parts.push(
            paintPart(
              new THREE.CylinderGeometry(0.01, 0.01, 0.008, 10),
              '#3B2314',
              composeLocalMatrix([bx, by, zOff + 0.156], [Math.PI / 2, 0, 0])
            )
          );
        }
      }
      geo = mergePainted(parts);
      break;
    }

    case 'duffle_parka':
    default: {
      // Sherpa-lined rolled parka hood at upper back + front wooden horn-toggle storm placket
      const parts: THREE.BufferGeometry[] = [
        paintPart(
          new THREE.TorusGeometry(0.132, 0.038, 10, 18, Math.PI * 1.15),
          coatColor,
          composeLocalMatrix([0, 0.138, -0.035], [Math.PI / 2 - 0.28, 0, -0.24], [1.04, 0.92, 1])
        ),
        paintPart(
          new THREE.TorusGeometry(0.136, 0.022, 8, 18, Math.PI * 1.1),
          '#F5ECE0',
          composeLocalMatrix([0, 0.158, -0.04], [Math.PI / 2 - 0.28, 0, -0.22], [1.05, 0.94, 1])
        ),
        // Front storm placket
        paintPart(
          new THREE.BoxGeometry(0.044, 0.28, 0.012),
          coatColor,
          composeLocalMatrix([0, -0.02, 0.146])
        ),
      ];
      for (const ty of [0.075, 0.0, -0.075]) {
        parts.push(
          paintPart(
            new THREE.BoxGeometry(0.056, 0.008, 0.01),
            '#E8D8C0',
            composeLocalMatrix([0, ty, 0.153])
          ),
          paintPart(
            new THREE.CylinderGeometry(0.008, 0.005, 0.038, 8),
            '#5C3620',
            composeLocalMatrix([0.024, ty, 0.158], [0, 0, Math.PI / 2 - 0.15])
          )
        );
      }
      geo = mergePainted(parts);
      break;
    }
  }

  COAT_OVERLAY_CACHE.set(key, geo);
  return geo;
}

const NECKWEAR_GEO_CACHE = new Map<string, THREE.BufferGeometry>();

export function getCustomNeckwearGeometry(
  neckwear: NeckwearId,
  scarfColor: string,
  isMaleRig: boolean
): THREE.BufferGeometry | null {
  if (neckwear === 'none' || neckwear === 'knit_scarf') {
    return null; // `knit_scarf` uses GLB `Hiker_Scarf`
  }

  const key = `${neckwear}|${scarfColor}|${isMaleRig ? 'm' : 'f'}`;
  const cached = NECKWEAR_GEO_CACHE.get(key);
  if (cached) return cached;

  const zFront = isMaleRig ? 0.142 : 0.156;
  const yCollar = isMaleRig ? 0.138 : 0.122;
  let geo: THREE.BufferGeometry;

  switch (neckwear) {
    case 'plaid_shawl': {
      // Draped front wool scarf tails with tassels (worn together with Hiker_Scarf collar)
      const parts: THREE.BufferGeometry[] = [
        paintPart(
          new THREE.BoxGeometry(0.058, 0.22, 0.018),
          scarfColor,
          composeLocalMatrix([-0.046, yCollar - 0.13, zFront], [-0.08, 0.08, 0.05])
        ),
        paintPart(
          new THREE.BoxGeometry(0.054, 0.17, 0.018),
          scarfColor,
          composeLocalMatrix([0.048, yCollar - 0.105, zFront + 0.004], [-0.1, -0.08, -0.06])
        ),
      ];
      for (const fx of [-0.062, -0.046, -0.03]) {
        parts.push(
          paintPart(
            new THREE.ConeGeometry(0.006, 0.032, 5),
            '#F6EFE4',
            composeLocalMatrix([fx, yCollar - 0.252, zFront + 0.008], [Math.PI, 0, 0])
          )
        );
      }
      for (const fx of [0.034, 0.048, 0.062]) {
        parts.push(
          paintPart(
            new THREE.ConeGeometry(0.006, 0.032, 5),
            '#F6EFE4',
            composeLocalMatrix([fx, yCollar - 0.202, zFront + 0.012], [Math.PI, 0, 0])
          )
        );
      }
      geo = mergePainted(parts);
      break;
    }

    case 'bandana': {
      // Knotted trail bandana triangle kerchief around neck
      geo = mergePainted([
        paintPart(
          new THREE.TorusGeometry(0.108, 0.016, 8, 20),
          scarfColor,
          composeLocalMatrix([0, yCollar + 0.01, isMaleRig ? -0.012 : 0.006], [Math.PI / 2 + 0.12, 0, 0], [1, 0.92, 1])
        ),
        paintPart(
          new THREE.ConeGeometry(0.085, 0.13, 3),
          scarfColor,
          composeLocalMatrix([0, yCollar - 0.042, zFront - 0.01], [Math.PI - 0.22, Math.PI, 0], [1.15, 1, 0.28])
        ),
        paintPart(
          new THREE.SphereGeometry(0.02, 8, 6),
          scarfColor,
          composeLocalMatrix([0, yCollar + 0.012, isMaleRig ? -0.118 : -0.102])
        ),
      ]);
      break;
    }

    case 'camera_strap':
    default: {
      // Leather neck strap + compact vintage 35mm rangefinder camera resting on chest
      geo = mergePainted([
        paintPart(
          new THREE.TorusGeometry(0.125, 0.0065, 6, 22),
          '#6B4228',
          composeLocalMatrix(
            [0, yCollar - 0.055, isMaleRig ? 0.038 : 0.052],
            [Math.PI / 2 + 0.82, 0, 0],
            [0.78, 1.38, 1]
          )
        ),
        paintPart(
          new THREE.BoxGeometry(0.098, 0.062, 0.038),
          '#232730',
          composeLocalMatrix([0, yCollar - 0.145, zFront + 0.018], [-0.08, 0, 0]),
          '#14171D'
        ),
        paintPart(
          new THREE.BoxGeometry(0.1, 0.018, 0.04),
          '#DCE3EC',
          composeLocalMatrix([0, yCollar - 0.12, zFront + 0.016], [-0.08, 0, 0])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.024, 0.026, 0.03, 14),
          '#D5DCE6',
          composeLocalMatrix([0, yCollar - 0.148, zFront + 0.048], [Math.PI / 2 - 0.08, 0, 0])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.018, 0.018, 0.006, 14),
          '#1A283B',
          composeLocalMatrix([0, yCollar - 0.15, zFront + 0.064], [Math.PI / 2 - 0.08, 0, 0])
        ),
      ]);
      break;
    }
  }

  NECKWEAR_GEO_CACHE.set(key, geo);
  return geo;
}

const BAG_GEO_CACHE = new Map<string, THREE.BufferGeometry>();

export function getCustomBagGeometry(
  bagStyle: BagStyleId,
  coatColor: string,
  scarfColor: string,
  isMaleRig: boolean
): THREE.BufferGeometry | null {
  if (bagStyle === 'none' || bagStyle === 'trek_pack') {
    return null; // `trek_pack` uses built-in GLB `Hiker_Backpack`
  }

  const key = `${bagStyle}|${coatColor}|${scarfColor}|${isMaleRig ? 'm' : 'f'}`;
  const cached = BAG_GEO_CACHE.get(key);
  if (cached) return cached;

  const zBack = isMaleRig ? -0.165 : -0.152;
  let geo: THREE.BufferGeometry;

  switch (bagStyle) {
    case 'leather_satchel': {
      // Vintage cognac saddle-leather rucksack with brass buckles & side pockets
      geo = mergePainted([
        paintPart(
          new THREE.BoxGeometry(0.24, 0.28, 0.125),
          '#8A5232',
          composeLocalMatrix([0, 0.015, zBack]),
          '#5C341E'
        ),
        // Rounded leather top flap
        paintPart(
          new THREE.CylinderGeometry(0.122, 0.122, 0.244, 14, 1, false, 0, Math.PI),
          '#9C5E3A',
          composeLocalMatrix([0, 0.15, zBack], [0, 0, Math.PI / 2], [0.52, 1, 0.54]),
          '#6E3E24'
        ),
        // Twin vertical buckle straps + brass buckles
        paintPart(
          new THREE.BoxGeometry(0.026, 0.22, 0.016),
          '#4E2C1A',
          composeLocalMatrix([-0.062, 0.03, zBack - 0.064])
        ),
        paintPart(
          new THREE.BoxGeometry(0.026, 0.22, 0.016),
          '#4E2C1A',
          composeLocalMatrix([0.062, 0.03, zBack - 0.064])
        ),
        paintPart(
          new THREE.BoxGeometry(0.036, 0.032, 0.02),
          '#E2AE52',
          composeLocalMatrix([-0.062, -0.02, zBack - 0.068])
        ),
        paintPart(
          new THREE.BoxGeometry(0.036, 0.032, 0.02),
          '#E2AE52',
          composeLocalMatrix([0.062, -0.02, zBack - 0.068])
        ),
        // Shoulder straps
        paintPart(
          new THREE.TorusGeometry(0.135, 0.013, 6, 16),
          '#5C341E',
          composeLocalMatrix([-0.088, 0.045, zBack + 0.12], [0, Math.PI / 2, 0], [0.95, 1.25, 1])
        ),
        paintPart(
          new THREE.TorusGeometry(0.135, 0.013, 6, 16),
          '#5C341E',
          composeLocalMatrix([0.088, 0.045, zBack + 0.12], [0, Math.PI / 2, 0], [0.95, 1.25, 1])
        ),
      ]);
      break;
    }

    case 'rattan_basket': {
      // Iconic Da Lat woven wicker back-basket brimming with golden Da Quy & pastel Hydrangeas!
      const parts: THREE.BufferGeometry[] = [
        paintPart(
          new THREE.CylinderGeometry(0.142, 0.104, 0.29, 18),
          '#C89658',
          composeLocalMatrix([0, 0.02, zBack - 0.02]),
          '#8E6232'
        ),
        paintPart(
          new THREE.TorusGeometry(0.144, 0.012, 8, 20),
          '#A6743E',
          composeLocalMatrix([0, 0.162, zBack - 0.02], [Math.PI / 2, 0, 0])
        ),
        paintPart(
          new THREE.TorusGeometry(0.124, 0.008, 6, 18),
          '#9C6B36',
          composeLocalMatrix([0, 0.04, zBack - 0.02], [Math.PI / 2, 0, 0])
        ),
        // Woven shoulder straps
        paintPart(
          new THREE.TorusGeometry(0.135, 0.012, 6, 16),
          '#8E6232',
          composeLocalMatrix([-0.085, 0.045, zBack + 0.12], [0, Math.PI / 2, 0], [0.95, 1.25, 1])
        ),
        paintPart(
          new THREE.TorusGeometry(0.135, 0.012, 6, 16),
          '#8E6232',
          composeLocalMatrix([0.085, 0.045, zBack + 0.12], [0, Math.PI / 2, 0], [0.95, 1.25, 1])
        ),
        // Lush green foliage mound inside basket
        paintPart(
          new THREE.SphereGeometry(0.128, 12, 10),
          '#447E48',
          composeLocalMatrix([0, 0.165, zBack - 0.02], [0, 0, 0], [1, 0.55, 1]),
          '#254B28'
        ),
      ];
      // Overflowing Hydrangea & Da Quy blooms!
      const basketBlooms: Array<[number, number, number, string, number]> = [
        [-0.058, 0.215, zBack - 0.04, '#9EC0FA', 0.046],
        [0.056, 0.218, zBack - 0.03, '#FFCA28', 0.044],
        [0.0, 0.236, zBack + 0.01, '#B8B0FA', 0.048],
        [-0.048, 0.208, zBack + 0.04, '#FFCA28', 0.04],
        [0.054, 0.21, zBack + 0.04, '#9AC2FA', 0.042],
        [0.008, 0.212, zBack - 0.085, '#FFD54F', 0.042],
      ];
      for (const [bx, by, bz, col, rad] of basketBlooms) {
        parts.push(
          paintPart(new THREE.IcosahedronGeometry(rad, 1), col, composeLocalMatrix([bx, by, bz]))
        );
      }
      geo = mergePainted(parts);
      break;
    }

    case 'canvas_tote': {
      // Diagonal crossbody cream canvas strap + structured cafe messenger pouch at hip
      geo = mergePainted([
        paintPart(
          new THREE.TorusGeometry(0.235, 0.015, 8, 28),
          '#EFE5D4',
          composeLocalMatrix([0.005, -0.045, isMaleRig ? 0.0 : 0.018], [0, 0.18, 0.72], [0.85, 1.28, 0.72]),
          '#C8BCA6'
        ),
        paintPart(
          new THREE.BoxGeometry(0.085, 0.19, 0.175),
          '#F2E8D8',
          composeLocalMatrix([-0.172, -0.215, 0.01], [0, 0.08, 0.1]),
          '#CBBDA6'
        ),
        paintPart(
          new THREE.BoxGeometry(0.092, 0.085, 0.178),
          scarfColor,
          composeLocalMatrix([-0.175, -0.16, 0.01], [0, 0.08, 0.1])
        ),
        paintPart(
          new THREE.CylinderGeometry(0.014, 0.014, 0.012, 10),
          '#6E4428',
          composeLocalMatrix([-0.222, -0.19, 0.01], [0, 0, Math.PI / 2])
        ),
      ]);
      break;
    }

    case 'guitar_case':
    default: {
      // Padded mocha acoustic guitar gig-bag worn diagonally on back
      geo = mergePainted([
        paintPart(
          new THREE.CylinderGeometry(0.145, 0.145, 0.092, 16),
          '#3E322E',
          composeLocalMatrix([-0.04, -0.07, zBack - 0.01], [Math.PI / 2, 0, -0.32]),
          '#261E1B'
        ),
        paintPart(
          new THREE.CylinderGeometry(0.108, 0.108, 0.088, 16),
          '#463834',
          composeLocalMatrix([0.01, 0.075, zBack - 0.01], [Math.PI / 2, 0, -0.32]),
          '#2C221F'
        ),
        paintPart(
          new THREE.CylinderGeometry(0.036, 0.042, 0.34, 12),
          '#3E322E',
          composeLocalMatrix([0.095, 0.31, zBack - 0.01], [0, 0, -0.32]),
          '#241C19'
        ),
        // Front pocket in scarfColor accent
        paintPart(
          new THREE.BoxGeometry(0.14, 0.12, 0.025),
          scarfColor,
          composeLocalMatrix([-0.032, -0.055, zBack - 0.062], [0, 0, -0.32])
        ),
        // Diagonal padded strap across torso
        paintPart(
          new THREE.TorusGeometry(0.225, 0.014, 6, 24),
          '#2E2420',
          composeLocalMatrix([0.0, -0.01, isMaleRig ? 0.0 : 0.016], [0, -0.15, -0.68], [0.82, 1.24, 0.72])
        ),
      ]);
      break;
    }
  }

  BAG_GEO_CACHE.set(key, geo);
  return geo;
}

/**
 * Builds a standalone Three.js Object3D of any HeldItemId for studio 3D thumbnail rendering.
 */
export function buildStandaloneHeldPropObject(itemId: HeldItemId): THREE.Object3D | null {
  if (itemId === 'none') return null;

  const group = new THREE.Group();
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#E6F2F8',
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.52,
  });
  const soyMat = new THREE.MeshStandardMaterial({
    color: '#FCF3D9',
    roughness: 0.42,
    emissive: '#FFF2CC',
    emissiveIntensity: 0.18,
  });
  const lanternGlowMat = new THREE.MeshStandardMaterial({
    color: '#FFD28A',
    emissive: '#FFA938',
    emissiveIntensity: 1.8,
    roughness: 0.2,
  });
  const sparkMat = new THREE.MeshBasicMaterial({ color: '#FFE484' });

  switch (itemId) {
    case 'soy_milk': {
      const liq = new THREE.Mesh(SHARED_HELD_PROPS.soyLiquid, soyMat);
      liq.position.set(0, -0.004, 0);
      const gls = new THREE.Mesh(SHARED_HELD_PROPS.soyGlass, glassMat);
      group.add(liq, gls);
      break;
    }
    case 'phin_coffee': {
      group.add(
        new THREE.Mesh(SHARED_HELD_PROPS.phinCoreFull, SHARED_VCOLOR_MAT),
        new THREE.Mesh(SHARED_HELD_PROPS.phinCup, glassMat)
      );
      break;
    }
    case 'roasted_corn': {
      const m = new THREE.Mesh(SHARED_HELD_PROPS.roastedCornFull, SHARED_VCOLOR_MAT);
      m.rotation.z = -0.25;
      group.add(m);
      break;
    }
    case 'sweet_potato': {
      const m = new THREE.Mesh(SHARED_HELD_PROPS.sweetPotatoFull, SHARED_VCOLOR_MAT);
      m.rotation.z = -0.18;
      group.add(m);
      break;
    }
    case 'hydrangea_bouquet': {
      const m = new THREE.Mesh(SHARED_HELD_PROPS.hydrangeaBouquetFull, SHARED_VCOLOR_MAT);
      m.rotation.z = -0.18;
      group.add(m);
      break;
    }
    case 'da_quy_bouquet': {
      const m = new THREE.Mesh(SHARED_HELD_PROPS.daQuyBouquetFull, SHARED_VCOLOR_MAT);
      m.rotation.z = -0.18;
      group.add(m);
      break;
    }
    case 'film_camera': {
      group.add(new THREE.Mesh(SHARED_HELD_PROPS.cameraFull, SHARED_METALLIC_VCOLOR_MAT));
      break;
    }
    case 'lantern': {
      const globe = new THREE.Mesh(SHARED_HELD_PROPS.lanternGlobe, lanternGlowMat);
      globe.position.set(0, -0.018, 0);
      group.add(new THREE.Mesh(SHARED_HELD_PROPS.lanternBrassFull, SHARED_METALLIC_VCOLOR_MAT), globe);
      break;
    }
    case 'sparkler': {
      const rod = new THREE.Mesh(SHARED_HELD_PROPS.sparklerRodGeo, SHARED_METALLIC_VCOLOR_MAT);
      const burst = new THREE.Mesh(SHARED_HELD_PROPS.sparklerBurstGeo, sparkMat);
      burst.position.set(0, 0.145, 0);
      group.add(rod, burst);
      group.rotation.z = -0.35;
      break;
    }
    case 'guitar': {
      const g = new THREE.Mesh(SHARED_HELD_PROPS.guitarFull, SHARED_VCOLOR_MAT);
      g.rotation.z = -0.45;
      group.add(g);
      break;
    }
  }
  return group;
}
