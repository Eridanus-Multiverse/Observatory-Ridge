import { hash01 } from "../core/hash.js";

/**
 * GLSL sources and the observatory color palette for Near Focus 3D.
 *
 * All noise is cheap value noise evaluated in the fragment shader — no
 * texture fetches, no per-frame CPU work. Star and planet shaders share one
 * vertex shader that forwards local position and world normal.
 */

export const OBSERVATORY_PALETTE = {
  void: "#020606",
  panel: "#070a13",
  stellar: "#e8a052",
  stellarCore: "#fff3d2",
  corona: "#ffc878",
  coldDust: "#52698f",
  warmDust: "#c18459",
  target: "#d9e8ff",
  text: "#e7edf8",
} as const;

export interface PlanetVisualProfile {
  archetype: "rocky" | "oceanic" | "gas" | "ice" | "volcanic";
  archetypeIndex: number;
  base: string;
  deep: string;
  accent: string;
  atmosphere: string;
  atmosphereStrength: number;
  ring: string;
}

const PLANET_PROFILES: readonly PlanetVisualProfile[] = [
  {
    archetype: "rocky",
    archetypeIndex: 0,
    base: "#735f5a",
    deep: "#38272a",
    accent: "#b18d75",
    atmosphere: "#a8b2c3",
    atmosphereStrength: 0.05,
    ring: "#9e8b78",
  },
  {
    archetype: "oceanic",
    archetypeIndex: 1,
    base: "#3c6f9e",
    deep: "#102642",
    accent: "#92b0c6",
    atmosphere: "#83b9e6",
    atmosphereStrength: 0.15,
    ring: "#8395ad",
  },
  {
    archetype: "gas",
    archetypeIndex: 2,
    base: "#9b7467",
    deep: "#3c2526",
    accent: "#d0a273",
    atmosphere: "#d8bb98",
    atmosphereStrength: 0.11,
    ring: "#b19a7d",
  },
  {
    archetype: "ice",
    archetypeIndex: 3,
    base: "#6f85a9",
    deep: "#202944",
    accent: "#c0cde0",
    atmosphere: "#9bb9e8",
    atmosphereStrength: 0.13,
    ring: "#91a2bb",
  },
  {
    archetype: "volcanic",
    archetypeIndex: 4,
    base: "#7c443f",
    deep: "#32171c",
    accent: "#d06c50",
    atmosphere: "#ad8178",
    atmosphereStrength: 0.035,
    ring: "#956c5f",
  },
];

/** Explicit archetype wins; otherwise a stable hash draw picks the profile. */
export function planetVisualProfile(id: string, archetype?: string | null): PlanetVisualProfile {
  const explicitIndex = archetype
    ? PLANET_PROFILES.findIndex((profile) => profile.archetype === archetype)
    : -1;
  const profileIndex = explicitIndex >= 0
    ? explicitIndex
    : Math.floor(hash01(id, 211) * PLANET_PROFILES.length);
  return PLANET_PROFILES[profileIndex];
}

export const CELESTIAL_VERTEX_SHADER = /* glsl */ `
  varying vec3 vLocalPosition;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    vLocalPosition = position;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const STELLAR_HALO_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// PITFALL baked in: the edge window guarantees the glow reaches zero before
// the billboard boundary. Without it, a bright halo shows its square canvas
// as a straight seam across the sky — corners are pressed together with the
// Chebyshev distance so they fade with the sides.
export const STELLAR_HALO_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uLuminosity;
  uniform float uActivity;
  uniform vec3 uWarm;
  uniform vec3 uHot;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float radius = length(p);
    float angle = atan(p.y, p.x + 0.00001);
    float pulse = 0.975 + sin(uTime * (0.42 + uActivity * 0.16)) * 0.025;
    float rayField = 0.5
      + 0.24 * sin(angle * 5.0 + uTime * 0.035)
      + 0.16 * sin(angle * 11.0 - uTime * 0.022)
      + 0.1 * sin(angle * 19.0 + 1.7);
    rayField = smoothstep(0.28, 0.9, rayField);

    // Thin body fog, long ray-carved corona: the glow should read as the
    // star's atmosphere, not a light bulb in mist.
    float core = exp(-radius * radius * 54.0);
    float innerHalo = exp(-radius * radius * 11.0) * 0.3;
    float corona = exp(-radius * (3.4 + rayField * 1.6)) * (0.1 + rayField * 0.2);
    float horizontal = exp(-abs(p.y) * 92.0) * exp(-abs(p.x) * 2.7) * 0.1;
    float vertical = exp(-abs(p.x) * 108.0) * exp(-abs(p.y) * 5.6) * 0.032;
    float energy = (core * 0.58 + innerHalo + corona + horizontal + vertical)
      * pulse * (1.08 + uLuminosity * 0.5);
    float edge = max(abs(p.x), abs(p.y));
    energy *= 1.0 - smoothstep(0.78, 0.985, edge);
    if (energy < 0.0025) discard;

    vec3 color = mix(uWarm, uHot, clamp(core * 1.35 + innerHalo * 0.42, 0.0, 1.0));
    color *= 0.7 + core * 0.5 + horizontal * 0.4;
    gl_FragColor = vec4(color, clamp(energy, 0.0, 0.75));
  }
`;

const VALUE_NOISE_GLSL = /* glsl */ `
  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
          mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
          mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }
  float compactFbm(vec3 p, float detail) {
    float value = noise3(p) * 0.76;
    if (detail > 0.5) {
      value += noise3(p * 2.07 + 13.7) * 0.24;
    }
    return value;
  }
`;

// Convective granules drift over the surface; the limb sinks into the warm
// color while the facing core pushes toward the hot color. Brightness gains
// ride the hot channel so the hue never washes out to white.
export const STAR_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uDetail;
  uniform vec3 uWarm;
  uniform vec3 uHot;
  varying vec3 vLocalPosition;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  ${VALUE_NOISE_GLSL}
  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float facing = clamp(dot(normal, viewDir), 0.0, 1.0);
    vec3 p = normalize(vLocalPosition) * 10.5;
    float granules = compactFbm(p + vec3(uTime * 0.028, -uTime * 0.017, uTime * 0.012), uDetail);
    float fine = noise3(p * 2.0 - vec3(uTime * 0.018, uTime * 0.011, -uTime * 0.014));
    float cells = smoothstep(0.28, 0.84, granules * 0.78 + fine * 0.22);
    float limb = pow(facing, 0.38);
    vec3 color = mix(uWarm * 0.98, uHot * 1.14, 0.4 + cells * 0.42);
    color = mix(uWarm * (0.78 + cells * 0.22), color, 0.3 + limb * 0.7);
    color -= uWarm * (1.0 - cells) * 0.025;
    color += uHot * pow(cells, 3.0) * 0.13;
    color += uHot * pow(facing, 5.0) * 0.12;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Archetype-aware planet surface: oceans with land masses, banded gas giants
// with storms, icy sheens, volcanic fissures, rocky terrain. Wrap lighting
// from the star at the origin plus a fresnel atmosphere rim.
export const PLANET_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uDeep;
  uniform vec3 uAccent;
  uniform vec3 uAtmosphere;
  uniform vec3 uKeyColor;
  uniform vec3 uFillColor;
  uniform float uAtmosphereStrength;
  uniform float uArchetype;
  uniform float uSeed;
  uniform float uOpacity;
  uniform float uDetail;
  uniform float uFocus;
  varying vec3 vLocalPosition;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  ${VALUE_NOISE_GLSL}
  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 lightDir = normalize(-vWorldPosition);
    float facing = clamp(dot(normal, viewDir), 0.0, 1.0);
    float nDotL = dot(normal, lightDir);
    float wrap = clamp((nDotL + 0.16) / 1.16, 0.0, 1.0);
    float day = smoothstep(-0.12, 0.18, nDotL);
    vec3 local = normalize(vLocalPosition);
    vec3 samplePoint = local * (3.0 + uSeed * 1.6);
    float broad = compactFbm(samplePoint + uSeed * 19.0, uDetail);
    float fine = noise3(samplePoint * 2.65 - uSeed * 7.0);
    float latitude = local.y;
    float gasBands = 0.5 + 0.5 * sin(latitude * 22.0 + (broad - 0.5) * 7.5 + uSeed * 17.0);
    float gasStorm = smoothstep(0.62, 0.84, abs(broad - fine));
    float terrain = smoothstep(0.38, 0.66, broad * 0.76 + fine * 0.24);
    vec3 surface = mix(uDeep, uBase, 0.42 + broad * 0.38);
    if (uArchetype > 0.5 && uArchetype < 1.5) {
      vec3 ocean = mix(uDeep, uBase, 0.36 + broad * 0.36);
      vec3 land = mix(uBase, uAccent, 0.3 + fine * 0.26);
      surface = mix(ocean, land, terrain * 0.58);
      surface = mix(surface, uAtmosphere, smoothstep(0.74, 0.9, fine) * 0.18);
    } else if (uArchetype > 1.5 && uArchetype < 2.5) {
      surface = mix(uDeep, uBase, 0.44 + gasBands * 0.34);
      surface = mix(surface, uAccent, gasStorm * 0.16 + gasBands * 0.09);
    } else if (uArchetype > 2.5 && uArchetype < 3.5) {
      surface = mix(uDeep, uBase, 0.42 + broad * 0.36);
      surface = mix(surface, uAccent, smoothstep(0.62, 0.86, fine) * 0.17);
    } else if (uArchetype > 3.5) {
      float fissure = smoothstep(0.58, 0.76, abs(broad - fine));
      surface = mix(uDeep, uBase, 0.18 + terrain * 0.5);
      surface = mix(surface, uAccent, fissure * 0.26);
    } else {
      surface = mix(uDeep, uBase, 0.2 + terrain * 0.52);
      surface = mix(surface, uAccent, smoothstep(0.68, 0.9, fine) * 0.16);
    }
    vec3 keyLight = uKeyColor * (0.11 + wrap * 0.82);
    vec3 fillLight = uFillColor * (0.2 + facing * 0.12);
    vec3 nightSurface = mix(uDeep, uFillColor * 0.34, 0.46) * (0.36 + facing * 0.08);
    vec3 daySurface = surface * (keyLight + fillLight);
    vec3 color = mix(nightSurface, daySurface, day);
    color += uFillColor * (0.012 + facing * 0.014);

    // The fresnel rim is what makes a planet look alive — be generous.
    float rim = pow(1.0 - facing, 2.3);
    float sunRim = pow(1.0 - facing, 3.2) * smoothstep(-0.3, 0.35, nDotL);
    float atmosphereMask = 0.06 + uAtmosphereStrength * (0.95 + day * 1.7) + uFocus * 0.12;
    color += uAtmosphere * rim * atmosphereMask;
    color += mix(uAtmosphere, uKeyColor, 0.55) * sunRim * (0.22 + uAtmosphereStrength * 1.4);

    vec3 halfVector = lightDir + viewDir;
    vec3 halfDir = halfVector / max(length(halfVector), 0.0001);
    float specPower = 12.0;
    float specStrength = 0.025;
    if (uArchetype > 0.5 && uArchetype < 1.5) {
      specPower = 64.0;
      specStrength = 0.22;
    } else if (uArchetype > 1.5 && uArchetype < 2.5) {
      specPower = 20.0;
      specStrength = 0.055;
    } else if (uArchetype > 2.5 && uArchetype < 3.5) {
      specPower = 36.0;
      specStrength = 0.1;
    }
    float specular = pow(max(dot(normal, halfDir), 0.0), specPower) * day * specStrength;
    color += mix(uKeyColor, uAtmosphere, 0.22) * specular;
    color += mix(uBase, uAtmosphere, 0.3) * uFocus * (0.035 + rim * 0.055);
    gl_FragColor = vec4(color, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
