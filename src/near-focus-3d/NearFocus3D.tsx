import { Billboard, Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ComponentRef, MutableRefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { RidgePlanet, RidgeSnapshot, RidgeStarTheme } from "../core/types.js";
import { hash01 } from "../core/hash.js";
import { SOLAR_STAR_THEME } from "../presets/solar-system.js";
import {
  buildNearFocusLayout,
  hasMemoryRing,
  planetSystemTilt,
  PLANET_VISUAL_SCALE,
  TAU,
  type AsteroidNode,
  type PlanetNode,
  type SatelliteNode,
} from "./layout.js";
import {
  CELESTIAL_VERTEX_SHADER,
  OBSERVATORY_PALETTE,
  PLANET_FRAGMENT_SHADER,
  planetVisualProfile,
  STAR_FRAGMENT_SHADER,
  STELLAR_HALO_FRAGMENT_SHADER,
  STELLAR_HALO_VERTEX_SHADER,
} from "./shaders.js";
import {
  makeCourseStreakTexture,
  makeDeepSkyTexture,
  makeLensFlareTexture,
  makeMoonSurfaceTexture,
  makeSoftParticleTexture,
  makeStarburstTexture,
} from "./textures.js";

/**
 * Near Focus 3D — a navigable star system.
 *
 * The star breathes at the center under a seam-safe halo shader, planets ride
 * accumulated orbits with archetype-shaded surfaces and particle rings,
 * memories orbit their planet as cratered moons, unattributed memories drift
 * in a two-belt asteroid field, and tapping a planet glides the camera into a
 * follow orbit around it. Bloom runs through an effect composer whose pixel
 * ratio is capped at 2 (see the README pitfall log).
 */

export interface NearFocus3DProps {
  snapshot: RidgeSnapshot;
  theme?: RidgeStarTheme;
  onSelect?: (selection: NearFocus3DSelection) => void;
  fontFamily?: string;
}

export type NearFocus3DSelection =
  | { kind: "star" }
  | { kind: "planet"; planet: RidgePlanet }
  | null;

type InternalSelection = { kind: "star" } | { kind: "planet"; id: string } | null;

type ControlsRef = ComponentRef<typeof OrbitControls> | null;

const ORIGIN = new THREE.Vector3(0, 0, 0);

// Fixed scene accents — the RidgeStarTheme drives star, key light, and
// background; orbit lines keep one canonical appearance.
const ORBIT_COLORS = ["#8795b4", "#68799f", "#54658c"] as const;

// The contract has no live stellar readings; these stand in for the
// production luminosity/activity dials at their default resting values.
const STAR_LUMINOSITY = 0.65;
const STAR_ACTIVITY = 0.5;

function safeLabelPosition(
  element: THREE.Object3D,
  camera: THREE.Camera,
  size: { width: number; height: number }
): [number, number] {
  const projected = new THREE.Vector3();
  element.getWorldPosition(projected).project(camera);
  const x = projected.x * size.width * 0.5 + size.width * 0.5;
  const y = -projected.y * size.height * 0.5 + size.height * 0.5;
  const visible = projected.z >= -1 && projected.z <= 1
    && x >= 54 && x <= size.width - 54
    && y >= 28 && y <= size.height - 80;
  return visible ? [x, y] : [-10000, -10000];
}

function useDisposableTexture(
  factory: () => THREE.CanvasTexture,
  deps: unknown[] = []
): THREE.CanvasTexture {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const texture = useMemo(factory, deps);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

// Five shared moon textures, cached for the module lifetime (~1.3 MB) —
// every satellite picks one by id and tints it with its category color.
let moonTexturesCache: THREE.CanvasTexture[] | null = null;
function getMoonTextures(): THREE.CanvasTexture[] {
  if (!moonTexturesCache) {
    moonTexturesCache = [0, 1, 2, 3, 4].map((variant) => makeMoonSurfaceTexture(variant));
  }
  return moonTexturesCache;
}

// ── Background sky ──────────────────────────────────────────────────────────

const bandRand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const bandGauss = (n: number) => {
  const u = Math.max(1e-6, bandRand(n));
  const v = bandRand(n + 0.5);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/**
 * Star river: rejection sampling builds a galactic density band (warm gold
 * inside the band, cool blue outside) with power-law sizes and per-point
 * size attenuation. Points, not a dome texture — equirect poles would pinch
 * discrete stars into arcs (README pitfall).
 */
function BandedStarfield({ particleTexture }: { particleTexture: THREE.Texture }) {
  const { positions, colors, sizes } = useMemo(() => {
    const count = 5200;
    const positionData = new Float32Array(count * 3);
    const colorData = new Float32Array(count * 3);
    const sizeData = new Float32Array(count);
    const bandNormal = new THREE.Vector3(0.42, 1, 0.3).normalize();
    const warmA = new THREE.Color("#ffdf92");
    const warmB = new THREE.Color("#fff2d8");
    const cool = new THREE.Color("#aac8ff");
    const white = new THREE.Color("#f2f4f8");
    const direction = new THREE.Vector3();
    let placed = 0;
    let attempt = 0;
    while (placed < count && attempt < count * 8) {
      attempt += 1;
      const az = bandRand(7 + attempt * 5.3) * Math.PI * 2;
      const el = Math.asin(2 * bandRand(7 + attempt * 6.1) - 1);
      direction.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
      const band = Math.abs(direction.dot(bandNormal));
      const inBand = band < 0.24 + Math.abs(bandGauss(7 + attempt * 2.7)) * 0.05;
      const accept = inBand ? bandRand(7 + attempt * 3.9) < 0.8 : bandRand(7 + attempt * 3.9) < 0.16;
      if (!accept) continue;
      const radius = 72 + bandRand(7 + attempt * 3.1) * 23;
      positionData.set([direction.x * radius, direction.y * radius, direction.z * radius], placed * 3);
      const r01 = bandRand(7 + attempt * 7.7);
      const color = inBand
        ? (r01 < 0.68 ? warmA.clone().lerp(warmB, bandRand(attempt)) : white.clone())
        : (r01 < 0.45 ? cool.clone().lerp(white, bandRand(attempt)) : white.clone());
      colorData.set([color.r, color.g, color.b], placed * 3);
      const p2 = bandRand(7 + attempt * 9.1);
      sizeData[placed] = (inBand ? 1.0 : 0.78) * (0.35 + p2 * p2 * p2 * 2.6);
      placed += 1;
    }
    return { positions: positionData, colors: colorData, sizes: sizeData };
  }, []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { map: { value: particleTexture } },
    vertexShader: /* glsl */ `
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (240.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0) * texture2D(map, gl_PointCoord);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), [particleTexture]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <points frustumCulled={false} raycast={() => null} material={material}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
    </points>
  );
}

function fibonacciSpherePoint(
  index: number,
  count: number,
  radiusMin: number,
  radiusSpan: number,
  seedOffset: number
): [number, number, number] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - ((index + 0.5) / count) * 2;
  const azimuth = (index + seedOffset) * goldenAngle
    + (hash01(`star-jitter-${seedOffset}-${index}`, 101) - 0.5) * 0.18;
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  const radius = radiusMin + hash01(`star-radius-${seedOffset}-${index}`, 107) * radiusSpan;
  return [
    Math.cos(azimuth) * radial * radius,
    y * radius,
    Math.sin(azimuth) * radial * radius,
  ];
}

/** A handful of hero stars with diffraction spikes — the sky's protagonists. */
function BrightFieldAnchors({ sparkTexture }: { sparkTexture: THREE.Texture }) {
  const count = 46;
  const [positions, colors] = useMemo(() => {
    const positionData = new Float32Array(count * 3);
    const colorData = new Float32Array(count * 3);
    const warm = new THREE.Color("#ffd8a8");
    const cool = new THREE.Color("#9ab9ff");
    const white = new THREE.Color("#ffffff");
    for (let index = 0; index < count; index += 1) {
      positionData.set(fibonacciSpherePoint(index, count, 32, 36, 8700), index * 3);
      const pick = hash01(`bright-anchor-color-${index}`, 269);
      const color = pick < 0.18 ? warm : pick < 0.52 ? cool : white;
      const brightness = 0.78 + hash01(`bright-anchor-luma-${index}`, 271) * 0.22;
      colorData.set([color.r * brightness, color.g * brightness, color.b * brightness], index * 3);
    }
    return [positionData, colorData];
  }, [count]);

  return (
    <points frustumCulled={false} raycast={() => null} renderOrder={-30}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={sparkTexture}
        vertexColors
        size={9.2}
        sizeAttenuation={false}
        transparent
        opacity={0.84}
        alphaTest={0.008}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        fog={false}
        toneMapped={false}
      />
    </points>
  );
}

// ── Orbits and selection ────────────────────────────────────────────────────

function PlanetOrbitPath({ node }: { node: PlanetNode }) {
  const points = useMemo(() => {
    const out: THREE.Vector3[] = [];
    for (let index = 0; index <= 128; index += 1) {
      const angle = (index / 128) * Math.PI * 2;
      out.push(new THREE.Vector3(Math.cos(angle) * node.radius, 0, Math.sin(angle) * node.radius));
    }
    return out;
  }, [node.radius]);
  // Orbits fade with rank — the scene's protagonists are bodies and light,
  // not a stack of record grooves.
  const orbitBand = node.rank <= 3 ? 0 : node.rank <= 7 ? 1 : 2;
  return (
    <group rotation={[node.inclination, node.ascendingNode, 0]}>
      <Line
        points={points}
        color={ORBIT_COLORS[orbitBand]}
        lineWidth={[1.25, 1.0, 0.8][orbitBand]}
        transparent
        opacity={[0.18, 0.13, 0.09][orbitBand]}
        raycast={() => null}
      />
    </group>
  );
}

/**
 * Four torus arcs marking the selected body. Torus geometry lies in the XY
 * plane by default (edge-on from the scene camera = a "vertical ring"); the
 * group rotation lays it flat into the orbital plane so selection reads as a
 * ground ring under the planet.
 */
function SelectionReticle({
  radius,
  color,
  visible,
}: {
  radius: number;
  color: string;
  visible: boolean;
}) {
  if (!visible) return null;
  const rotations = [0.18, Math.PI * 0.5 + 0.18, Math.PI + 0.18, Math.PI * 1.5 + 0.18];
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {rotations.map((rotation, index) => (
        <mesh key={index} raycast={() => null} rotation={[0, 0, rotation]}>
          <torusGeometry args={[radius, Math.max(0.004, radius * 0.006), 4, 18, Math.PI * 0.19]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.5}
            depthTest
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ── Star ────────────────────────────────────────────────────────────────────

function FocusStar({
  theme,
  motionTime,
  onSelect,
  flareTexture,
}: {
  theme: RidgeStarTheme;
  motionTime: MutableRefObject<number>;
  onSelect: () => void;
  flareTexture: THREE.Texture;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const haloMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const starRadius = 2.4;
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uDetail: { value: 1 },
    uWarm: { value: new THREE.Color(theme.starWarm) },
    uHot: { value: new THREE.Color(theme.starHot) },
  }), [theme.starHot, theme.starWarm]);
  const haloUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uLuminosity: { value: STAR_LUMINOSITY },
    uActivity: { value: STAR_ACTIVITY },
    uWarm: { value: new THREE.Color(theme.starWarm) },
    uHot: { value: new THREE.Color(theme.starHot) },
  }), [theme.starHot, theme.starWarm]);

  useFrame(() => {
    const time = motionTime.current;
    if (groupRef.current) {
      const pulse = 1 + Math.sin(time * (0.46 + STAR_ACTIVITY * 0.18))
        * (0.003 + STAR_LUMINOSITY * 0.002);
      groupRef.current.scale.setScalar(pulse);
    }
    if (materialRef.current) materialRef.current.uniforms.uTime.value = time;
    if (haloMaterialRef.current) haloMaterialRef.current.uniforms.uTime.value = time;
  });

  return (
    <group ref={groupRef} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
      {/* Oversized billboard so the slow corona falloff never reaches the
          canvas edge — the shader's edge window does the rest. */}
      <Billboard follow raycast={() => null} renderOrder={-4}>
        <mesh scale={[24 + STAR_LUMINOSITY * 2, 24 + STAR_LUMINOSITY * 2, 1]} raycast={() => null}>
          <planeGeometry args={[1, 1]} />
          <shaderMaterial
            ref={haloMaterialRef}
            uniforms={haloUniforms}
            vertexShader={STELLAR_HALO_VERTEX_SHADER}
            fragmentShader={STELLAR_HALO_FRAGMENT_SHADER}
            transparent
            blending={THREE.AdditiveBlending}
            depthTest
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </Billboard>
      <mesh>
        <sphereGeometry args={[starRadius, 58, 40]} />
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={CELESTIAL_VERTEX_SHADER}
          fragmentShader={STAR_FRAGMENT_SHADER}
        />
      </mesh>
      {/* Brightness rides this glowing backside shell so the surface hue
          itself never washes out to white. */}
      <mesh scale={1.05} raycast={() => null}>
        <sphereGeometry args={[starRadius, 48, 32]} />
        <meshBasicMaterial
          color={theme.starHot}
          side={THREE.BackSide}
          transparent
          opacity={0.2}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Horizontal lens streaks, both layers on the warm color so the hue
          follows the theme. */}
      <Billboard follow raycast={() => null} renderOrder={-3}>
        <mesh raycast={() => null} scale={[starRadius * 7, starRadius * 0.72, 1]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={flareTexture}
            color={theme.starWarm}
            transparent
            opacity={0.07}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh raycast={() => null} scale={[starRadius * 3.8, starRadius * 0.34, 1]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={flareTexture}
            color={theme.starWarm}
            transparent
            opacity={0.09}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </Billboard>
      {/* Star selection feedback is the detail panel plus the halo itself —
          a Saturn-style ring on the star reads as a bug, not a highlight. */}
    </group>
  );
}

// ── Satellites ──────────────────────────────────────────────────────────────

function SatelliteOrbitPath({ satellite }: { satellite: SatelliteNode }) {
  // Ascending node shares the satellite's hash so each moon rides exactly on
  // its own drawn orbit line.
  const nodeRotation = hash01(satellite.memory.id, 191) * TAU;
  const geometry = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let index = 0; index < 56; index += 1) {
      const angle = (index / 56) * Math.PI * 2;
      points.push(new THREE.Vector3(
        Math.cos(angle) * satellite.localRadius,
        0,
        Math.sin(angle) * satellite.localRadius
      ));
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [satellite.localRadius]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group rotation={[satellite.inclination, nodeRotation, 0]}>
      <lineLoop geometry={geometry} raycast={() => null}>
        <lineBasicMaterial
          color={OBSERVATORY_PALETTE.coldDust}
          transparent
          opacity={0.3}
          depthWrite={false}
          toneMapped={false}
        />
      </lineLoop>
    </group>
  );
}

function MemorySatellite({
  satellite,
  motionTime,
}: {
  satellite: SatelliteNode;
  motionTime: MutableRefObject<number>;
}) {
  const orbitRef = useRef<THREE.Group>(null);
  const nodeRotation = hash01(satellite.memory.id, 191) * TAU;
  const visualSize = satellite.size * 0.85;
  const moonTexture = getMoonTextures()[Math.floor(hash01(satellite.memory.id, 983) * 5)];
  const emissive = useMemo(
    () => new THREE.Color(satellite.color).lerp(new THREE.Color("#fff7ea"), 0.3),
    [satellite.color]
  );

  useFrame(() => {
    if (orbitRef.current) {
      orbitRef.current.rotation.y = satellite.phase + motionTime.current * satellite.angularSpeed;
    }
  });

  return (
    <group rotation={[satellite.inclination, nodeRotation, 0]} raycast={() => null}>
      <group ref={orbitRef}>
        <group position={[satellite.localRadius, 0, 0]}>
          <mesh raycast={() => null} rotation={[0, hash01(satellite.memory.id, 977) * TAU, 0]}>
            <sphereGeometry args={[visualSize, 20, 16]} />
            <meshStandardMaterial
              map={moonTexture}
              bumpMap={moonTexture}
              bumpScale={0.35}
              color={satellite.color}
              emissive={emissive}
              emissiveIntensity={0.34}
              roughness={0.88}
              metalness={0.04}
            />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// ── Planet ring ─────────────────────────────────────────────────────────────

function MemoryRing({
  node,
  visualSize,
  active,
  dimmed,
  motionTime,
  particleTexture,
  ringColor,
}: {
  node: PlanetNode;
  visualSize: number;
  active: boolean;
  dimmed: boolean;
  motionTime: MutableRefObject<number>;
  particleTexture: THREE.Texture;
  ringColor: string;
}) {
  // Saturn physics: radial band structure (bright B ring, a gap, faint A
  // ring) — never angular segment gaps, those read as breakage. Five ring
  // templates weighted toward multi-band layouts, chosen per planet id, so
  // every ringed planet has its own face.
  const groupRef = useRef<THREE.Group>(null);
  const baseCount = Math.min(460, Math.max(230, Math.round(node.memoryCount * 11)));
  const systemTilt = planetSystemTilt(node.planet.id);
  const ringRoll = hash01(node.planet.id, 373);
  const ringType = ringRoll < 0.3 ? 0 : ringRoll < 0.6 ? 2 : ringRoll < 0.78 ? 1 : ringRoll < 0.92 ? 3 : 4;
  const granuleScale = [1.0, 1.35, 0.8, 1.7, 0.7][ringType];
  const densityScale = [1.0, 0.8, 1.2, 0.5, 1.45][ringType];
  const count = Math.round(baseCount * densityScale);
  const bands: Array<[number, number, number]> = (
    (ringType === 0 ? [[1.45, 1.72, 1], [1.78, 2.08, 0.55]]
    : ringType === 1 ? [[1.4, 1.95, 0.75]]
    : ringType === 2 ? [[1.45, 1.58, 0.9], [1.66, 1.78, 0.7], [1.88, 2.02, 0.5]]
    : ringType === 3 ? [[1.5, 1.68, 1.25]]
    : [[1.38, 2.2, 0.4]]) as Array<[number, number, number]>
  ).map(([a, b, o]) => [visualSize * a, visualSize * b, o] as [number, number, number]);
  const [positions, colors] = useMemo(() => {
    const positionData = new Float32Array(count * 3);
    const colorData = new Float32Array(count * 3);
    const base = new THREE.Color(ringColor).lerp(new THREE.Color("#f4f0e6"), 0.22);
    const shade = base.clone().multiplyScalar(0.72);
    for (let index = 0; index < count; index += 1) {
      const seed = `${node.planet.id}-memory-ring-${index}`;
      const angle = hash01(seed, 317) * Math.PI * 2;
      // Grains distribute across bands with a gaussian pull to the band
      // centerline; the gaps stay empty.
      const bandPick = hash01(seed, 311) * bands.length;
      const band = bands[Math.min(bands.length - 1, Math.floor(bandPick))];
      const g = (hash01(seed, 331) + hash01(seed, 401)) / 2;
      const radius = band[0] + g * (band[1] - band[0]);
      const height = (hash01(seed, 337) + hash01(seed, 409) - 1) * Math.max(0.012, visualSize * 0.035);
      positionData.set([Math.cos(angle) * radius, height, Math.sin(angle) * radius], index * 3);
      const color = band[2] >= 0.8 ? base : shade;
      const brightness = (0.45 + hash01(seed, 349) * 0.55) * Math.min(1.15, band[2]);
      colorData.set([color.r * brightness, color.g * brightness, color.b * brightness], index * 3);
    }
    return [positionData, colorData];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, node.planet.id, ringColor, ringType, visualSize]);

  useFrame(() => {
    if (groupRef.current) groupRef.current.rotation.y = motionTime.current * 0.045;
  });

  const bandOpacity = active ? 0.3 : dimmed ? 0.02 : 0.19;
  return (
    <group ref={groupRef} rotation={[systemTilt[0], systemTilt[1], 0]} raycast={() => null}>
      {bands.map((band, index) => (
        <mesh key={index} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[band[0], band[1], 96]} />
          <meshBasicMaterial
            color={ringColor}
            transparent
            opacity={bandOpacity * band[2]}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      <points frustumCulled={false} raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={particleTexture}
          vertexColors
          size={0.032 * granuleScale}
          sizeAttenuation
          transparent
          opacity={active ? 0.95 : dimmed ? 0.06 : 0.75}
          alphaTest={0.02}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </points>
    </group>
  );
}

// ── Planet system ───────────────────────────────────────────────────────────

function PlanetSystem({
  node,
  satellites,
  selected,
  dimmed,
  theme,
  fontFamily,
  particleTexture,
  motionTime,
  positionMap,
  onSelect,
}: {
  node: PlanetNode;
  satellites: SatelliteNode[];
  selected: boolean;
  dimmed: boolean;
  theme: RidgeStarTheme;
  fontFamily: string;
  particleTexture: THREE.Texture;
  motionTime: MutableRefObject<number>;
  positionMap: MutableRefObject<Map<string, THREE.Vector3>>;
  onSelect: () => void;
}) {
  const orbitRef = useRef<THREE.Group>(null);
  const anchorRef = useRef<THREE.Group>(null);
  const visualRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const profile = useMemo(
    () => planetVisualProfile(node.planet.id, node.planet.archetype),
    [node.planet.archetype, node.planet.id]
  );
  // Focused planets grow toward their full model size — the concept is the
  // protagonist while the camera rides with it.
  const visualSize = node.size * (selected ? 0.8 : PLANET_VISUAL_SCALE);
  const uniforms = useMemo(() => ({
    uBase: { value: new THREE.Color(profile.base) },
    uDeep: { value: new THREE.Color(profile.deep) },
    uAccent: { value: new THREE.Color(profile.accent) },
    uAtmosphere: { value: new THREE.Color(profile.atmosphere) },
    uKeyColor: { value: new THREE.Color(theme.keyLight) },
    uFillColor: { value: new THREE.Color("#36537f") },
    uAtmosphereStrength: { value: profile.atmosphereStrength },
    uArchetype: { value: profile.archetypeIndex },
    uSeed: { value: hash01(node.planet.id, 197) },
    uOpacity: { value: 1 },
    uDetail: { value: 1 },
    uFocus: { value: 0 },
  }), [node.planet.id, profile, theme.keyLight]);
  // Roomy hit sphere for the overview; once focused the planet fills the
  // frame and the hit volume shrinks to the body.
  const hitRadius = selected ? visualSize * 1.05 : Math.max(node.size * 1.25, 0.42);
  const opacity = dimmed && !hovered ? 0.045 : 1;
  uniforms.uOpacity.value = opacity;
  uniforms.uFocus.value = selected ? 1 : 0;

  useEffect(() => {
    const map = positionMap.current;
    map.set(node.key, worldPosition);
    return () => {
      if (map.get(node.key) === worldPosition) map.delete(node.key);
      document.body.style.removeProperty("cursor");
    };
  }, [node.key, positionMap, worldPosition]);

  useFrame(() => {
    if (orbitRef.current) {
      orbitRef.current.rotation.y = node.phase + motionTime.current * node.angularSpeed;
    }
    if (anchorRef.current) {
      anchorRef.current.getWorldPosition(worldPosition);
      positionMap.current.set(node.key, worldPosition);
    }
    if (visualRef.current) visualRef.current.rotation.y = motionTime.current * 0.075 + node.phase;
  }, -1);

  const visualScale = hovered || selected ? 1.025 : 1;

  return (
    <group rotation={[node.inclination, node.ascendingNode, 0]}>
      <group ref={orbitRef}>
        <group
          ref={anchorRef}
          position={[node.radius, 0, 0]}
          onPointerOver={(event) => {
            event.stopPropagation();
            setHovered(true);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            setHovered(false);
            document.body.style.removeProperty("cursor");
          }}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          <mesh>
            <sphereGeometry args={[hitRadius, 14, 10]} />
            <meshBasicMaterial transparent opacity={0} colorWrite={false} depthWrite={false} />
          </mesh>
          <group ref={visualRef} scale={visualScale}>
            <mesh>
              <sphereGeometry args={[visualSize, selected ? 48 : 36, selected ? 32 : 24]} />
              <shaderMaterial
                uniforms={uniforms}
                vertexShader={CELESTIAL_VERTEX_SHADER}
                fragmentShader={PLANET_FRAGMENT_SHADER}
                transparent={opacity < 1}
                depthWrite={opacity >= 1}
                dithering
              />
            </mesh>
            <SelectionReticle
              radius={visualSize * 1.24}
              color={OBSERVATORY_PALETTE.target}
              visible={selected}
            />
          </group>
          {hasMemoryRing(node.memoryCount) && (
            <MemoryRing
              node={node}
              visualSize={visualSize}
              active={selected}
              dimmed={dimmed}
              motionTime={motionTime}
              particleTexture={particleTexture}
              ringColor={profile.ring}
            />
          )}
          {/* Every satellite gets its own orbit line — a moon without its
              line looks adrift, and 56-point line loops are near-free. */}
          {selected && satellites.map((satellite) => (
            <SatelliteOrbitPath key={`orbit-${satellite.key}`} satellite={satellite} />
          ))}
          {selected && satellites.map((satellite) => (
            <MemorySatellite key={satellite.key} satellite={satellite} motionTime={motionTime} />
          ))}
          {(selected || hovered) && (
            <Html
              center
              position={[0, visualSize + 0.43, 0]}
              calculatePosition={safeLabelPosition}
              style={{ pointerEvents: "none" }}
            >
              <div
                style={{
                  color: selected ? "#f5f8ff" : "rgba(224,233,250,0.86)",
                  fontSize: selected ? 12 : 10,
                  fontFamily,
                  whiteSpace: "nowrap",
                  userSelect: "none",
                  textShadow: "0 1px 3px #01030a, 0 0 8px rgba(94,122,188,0.46)",
                }}
              >
                {node.planet.name} · {node.memoryCount}
              </div>
            </Html>
          )}
        </group>
      </group>
    </group>
  );
}

// ── Asteroid belt ───────────────────────────────────────────────────────────

function BeltDustCloud({
  prefix,
  center,
  halfWidth,
  thickness,
  count,
  colorA,
  colorB,
  dotSize,
  particleTexture,
}: {
  prefix: string;
  center: number;
  halfWidth: number;
  thickness: number;
  count: number;
  colorA: string;
  colorB: string;
  dotSize: number;
  particleTexture: THREE.Texture;
}) {
  // A belt's presence is density: the particle cloud is the skeleton, the
  // clickable-sized stones are only its sampled representatives.
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const from = new THREE.Color(colorA);
    const to = new THREE.Color(colorB);
    const tmp = new THREE.Color();
    for (let index = 0; index < count; index += 1) {
      const angle = hash01(`${prefix}-a-${index}`, 131) * Math.PI * 2;
      const radius = center + (hash01(`${prefix}-r-${index}`, 137) - 0.5) * 2 * halfWidth;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = (hash01(`${prefix}-y-${index}`, 139) - 0.5) * thickness;
      positions[index * 3 + 2] = Math.sin(angle) * radius;
      const brightness = 0.55 + hash01(`${prefix}-b-${index}`, 149) * 0.45;
      tmp.copy(from).lerp(to, hash01(`${prefix}-c-${index}`, 151)).multiplyScalar(brightness);
      colors[index * 3] = tmp.r;
      colors[index * 3 + 1] = tmp.g;
      colors[index * 3 + 2] = tmp.b;
    }
    const built = new THREE.BufferGeometry();
    built.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    built.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return built;
  }, [prefix, center, halfWidth, thickness, count, colorA, colorB]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <points geometry={geometry} raycast={() => null}>
      {/* fog={false}: the outer belt's far wing sits deep in the scene fog
          range, which would otherwise eat the whole cloud. */}
      <pointsMaterial
        map={particleTexture}
        size={dotSize}
        vertexColors
        transparent
        opacity={0.68}
        depthWrite={false}
        sizeAttenuation
        fog={false}
      />
    </points>
  );
}

function AsteroidBeltDust({
  motionTime,
  particleTexture,
  mainBeltCenter,
  outerBase,
}: {
  motionTime: MutableRefObject<number>;
  particleTexture: THREE.Texture;
  /** Main belt center — the reserved gap inside the planet sequence. */
  mainBeltCenter: number;
  /** Planet region outer edge — the cold Kuiper-style belt hugs it. */
  outerBase: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  // Single main belt, solar-system style (2026-07-17 field report) — the
  // second Kuiper-style ring is gone; `outerBase` kept for API stability.
  void outerBase;

  useFrame(() => {
    if (groupRef.current) groupRef.current.rotation.y = motionTime.current * 0.012;
  });

  return (
    <>
      <group ref={groupRef} raycast={() => null}>
        <BeltDustCloud
          prefix="belt-dust-inner"
          center={mainBeltCenter}
          halfWidth={1.3}
          thickness={0.5}
          count={820}
          colorA="#c8a37a"
          colorB="#8a715a"
          dotSize={0.16}
          particleTexture={particleTexture}
        />
      </group>
    </>
  );
}

/**
 * The actual unattributed memories, rendered as glowing spheres riding the
 * belts. Over-unit instance colors let the bloom pass bite a halo out of
 * each one — memories are the belt's lit stones.
 */
function AsteroidField({
  asteroids,
  motionTime,
}: {
  asteroids: AsteroidNode[];
  motionTime: MutableRefObject<number>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 18, 14), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const orbitRotations = useMemo(
    () => asteroids.map((asteroid) => new THREE.Euler(asteroid.inclination, asteroid.ascendingNode, 0)),
    [asteroids]
  );
  const tmpMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tmpQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const tmpScale = useMemo(() => new THREE.Vector3(), []);
  const tmpPoint = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    asteroids.forEach((asteroid, index) => {
      mesh.setColorAt(index, new THREE.Color(asteroid.color).multiplyScalar(1.75));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [asteroids]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const time = motionTime.current;
    asteroids.forEach((asteroid, index) => {
      const angle = asteroid.phase + time * asteroid.angularSpeed;
      tmpPoint.set(
        Math.cos(angle) * asteroid.radius,
        0,
        -Math.sin(angle) * asteroid.radius
      ).applyEuler(orbitRotations[index]);
      tmpQuaternion.identity();
      tmpScale.setScalar(asteroid.size);
      tmpMatrix.compose(tmpPoint, tmpQuaternion, tmpScale);
      mesh.setMatrixAt(index, tmpMatrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, -1);

  if (!asteroids.length) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, asteroids.length]}
      raycast={() => null}
    >
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

// ── Camera ──────────────────────────────────────────────────────────────────

function systemFitDistance(outerEdge: number, fov: number, width: number, height: number) {
  const radius = Math.max(8, outerEdge + 3.2);
  const verticalFov = THREE.MathUtils.degToRad(fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * (width / height));
  const widthDistance = radius / Math.tan(horizontalFov / 2);
  const projectedHeight = radius * 0.42 + 3;
  const heightDistance = projectedHeight / Math.tan(verticalFov / 2);
  return Math.max(widthDistance, heightDistance) * 1.12;
}

/**
 * Shift camera and controls target by the tracked body's frame-to-frame
 * displacement, so orbit gestures happen inside the moving planet's frame.
 */
function followTrackedTarget(
  cameraPosition: THREE.Vector3,
  controlsTarget: THREE.Vector3,
  previousTarget: THREE.Vector3,
  currentTarget: THREE.Vector3
): void {
  const dx = currentTarget.x - previousTarget.x;
  const dy = currentTarget.y - previousTarget.y;
  const dz = currentTarget.z - previousTarget.z;
  if (![dx, dy, dz].every(Number.isFinite)) return;
  cameraPosition.x += dx;
  cameraPosition.y += dy;
  cameraPosition.z += dz;
  controlsTarget.x += dx;
  controlsTarget.y += dy;
  controlsTarget.z += dz;
  previousTarget.copy(currentTarget);
}

function CameraRig({
  controlsRef,
  navKey,
  fitDistance,
  interactingRef,
  cameraMotionRef,
  positionMap,
}: {
  controlsRef: MutableRefObject<ControlsRef>;
  navKey: string | null;
  fitDistance: number;
  interactingRef: MutableRefObject<boolean>;
  cameraMotionRef: MutableRefObject<boolean>;
  positionMap: MutableRefObject<Map<string, THREE.Vector3>>;
}) {
  const { camera, invalidate } = useThree();
  const pendingDestination = useRef(true);
  const requestedKey = useRef<string | null>(navKey);
  const travelProgress = useRef(0);
  const cameraDestination = useMemo(() => new THREE.Vector3(), []);
  const targetDestination = useMemo(() => new THREE.Vector3(), []);
  const cameraStart = useMemo(() => new THREE.Vector3(), []);
  const targetStart = useMemo(() => new THREE.Vector3(), []);
  const trackedTarget = useMemo(() => new THREE.Vector3(), []);
  const systemDestination = useMemo(
    () => new THREE.Vector3(0.5, fitDistance * 0.34, fitDistance),
    [fitDistance]
  );
  // Elevated follow offset: the satellite plane sweeps below the eye line
  // instead of skimming the camera with close-up moons.
  const navigationOffset = useMemo(() => new THREE.Vector3(0, 3.4, 5.2), []);
  const rotatedOffset = useMemo(() => new THREE.Vector3(), []);
  const tiltEuler = useMemo(() => new THREE.Euler(), []);
  // Approach along the ring plane's normal so a tilted ring reads level once
  // the camera settles on the focused planet.
  const alignedOffset = (key: string | null): THREE.Vector3 => {
    if (key && key.startsWith("planet:")) {
      const [tilt, yaw] = planetSystemTilt(key.slice(7));
      tiltEuler.set(tilt, yaw, 0);
      return rotatedOffset.copy(navigationOffset).applyEuler(tiltEuler);
    }
    return rotatedOffset.copy(navigationOffset);
  };

  useEffect(() => {
    requestedKey.current = navKey;
    pendingDestination.current = true;
    travelProgress.current = 0;
    cameraMotionRef.current = true;
    invalidate();
  }, [cameraMotionRef, invalidate, navKey, systemDestination]);

  useFrame((_state, delta) => {
    const target = requestedKey.current ? positionMap.current.get(requestedKey.current) : ORIGIN;
    if (interactingRef.current) {
      // Follow must not pause during gestures — the planet keeps orbiting
      // and the world would slide out from under the pointer.
      if (target && requestedKey.current && !cameraMotionRef.current && controlsRef.current) {
        followTrackedTarget(camera.position, controlsRef.current.target, trackedTarget, target);
      } else if (target) {
        trackedTarget.copy(target);
      }
      return;
    }
    if (!target) {
      if (cameraMotionRef.current) invalidate();
      return;
    }
    const controls = controlsRef.current;
    if (!cameraMotionRef.current) {
      if (requestedKey.current && controls) {
        followTrackedTarget(camera.position, controls.target, trackedTarget, target);
        controls.update();
      }
      return;
    }
    if (pendingDestination.current) {
      targetDestination.copy(target);
      if (requestedKey.current) {
        cameraDestination.copy(target).add(alignedOffset(requestedKey.current));
      } else {
        cameraDestination.copy(systemDestination);
      }
      cameraStart.copy(camera.position);
      targetStart.copy(controls?.target || ORIGIN);
      trackedTarget.copy(target);
      pendingDestination.current = false;
    } else if (requestedKey.current) {
      targetDestination.copy(target);
      cameraDestination.copy(target).add(alignedOffset(requestedKey.current));
      trackedTarget.copy(target);
    }
    const duration = 1.35;
    travelProgress.current = Math.min(1, travelProgress.current + Math.min(delta, 0.1) / duration);
    const progress = travelProgress.current;
    const eased = progress * progress * progress * (progress * (progress * 6 - 15) + 10);
    camera.position.lerpVectors(cameraStart, cameraDestination, eased);
    if (requestedKey.current) {
      const lift = Math.min(0.9, cameraStart.distanceTo(cameraDestination) * 0.07)
        * Math.sin(progress * Math.PI);
      camera.position.y += lift;
    }
    if (controls) {
      controls.target.lerpVectors(targetStart, targetDestination, eased);
      controls.update();
    }
    if (progress >= 1) {
      camera.position.copy(cameraDestination);
      if (controls) {
        controls.target.copy(targetDestination);
        controls.update();
      }
      cameraMotionRef.current = false;
      return;
    }
    invalidate();
  }, -0.5);

  return null;
}

/** Screen-space warp streaks, visible only while the camera is traveling. */
function CourseStreaks({
  cameraMotionRef,
  enabled,
}: {
  cameraMotionRef: MutableRefObject<boolean>;
  enabled: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = 10;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const streakTexture = useDisposableTexture(() => makeCourseStreakTexture(160, 32));
  const seeds = useMemo(() => Array.from({ length: count }, (_, index) => ({
    angle: (index / count) * Math.PI * 2
      + (hash01(`course-angle-${index}`, 239) - 0.5) * 0.22,
    phase: (index * 0.61803398875 + hash01(`course-phase-${index}`, 251) * 0.24) % 1,
    length: index % 6 === 0
      ? 0.24 + (index / count) * 0.08
      : index % 3 === 0
        ? 0.14 + (index / count) * 0.04
        : 0.065 + (((index * 5) % count) / count) * 0.055,
    thickness: index % 6 === 0 ? 0.046 : index % 3 === 0 ? 0.037 : 0.029,
  })), [count]);

  useEffect(() => {
    meshRef.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }, [count]);

  useFrame(({ camera, clock }) => {
    const visible = enabled && cameraMotionRef.current;
    if (groupRef.current) groupRef.current.visible = visible;
    if (!visible || !groupRef.current || !meshRef.current) return;
    groupRef.current.position.copy(camera.position);
    groupRef.current.quaternion.copy(camera.quaternion);
    seeds.forEach(({ angle, phase, length, thickness }, index) => {
      const sweep = (clock.elapsedTime * 1.7 + phase) % 1;
      const startRadius = 0.22 + sweep * 0.82;
      const endRadius = startRadius + length + sweep * 0.045;
      const startX = Math.cos(angle) * startRadius * 1.46;
      const startY = Math.sin(angle) * startRadius * 0.9;
      const endX = Math.cos(angle) * endRadius * 1.46;
      const endY = Math.sin(angle) * endRadius * 0.9;
      dummy.position.set((startX + endX) / 2, (startY + endY) / 2, -3);
      dummy.rotation.set(0, 0, Math.atan2(endY - startY, endX - startX));
      dummy.scale.set(Math.hypot(endX - startX, endY - startY), thickness, 1);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(index, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, -0.25);

  return (
    <group ref={groupRef} visible={false}>
      <instancedMesh ref={meshRef} args={[undefined, undefined, count]} renderOrder={20} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={streakTexture}
          color={OBSERVATORY_PALETTE.target}
          transparent
          opacity={0.72}
          blending={THREE.AdditiveBlending}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}

// ── Post-processing ─────────────────────────────────────────────────────────

function CinematicBloom() {
  const { gl, scene, camera, size, viewport } = useThree();
  const pipeline = useMemo(() => {
    const composer = new EffectComposer(gl);
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.58, 0.44, 0.68);
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);
    return { composer, bloomPass, outputPass };
  }, [camera, gl, scene]);

  useEffect(() => {
    // PITFALL (README): full-screen post cost follows pixel count. Bloom is a
    // blur — it does not need device sharpness, so the composer is pinned at
    // 2x while the base canvas keeps its own ratio.
    const ratio = Math.min(viewport.dpr, 2);
    pipeline.composer.setPixelRatio(ratio);
    pipeline.composer.setSize(size.width, size.height);
    pipeline.bloomPass.strength = 0.58;
    pipeline.bloomPass.radius = 0.44;
    pipeline.bloomPass.threshold = 0.68;
  }, [pipeline, size.height, size.width, viewport.dpr]);

  useEffect(() => () => {
    pipeline.bloomPass.dispose();
    pipeline.outputPass.dispose();
    pipeline.composer.dispose();
  }, [pipeline]);

  useEffect(() => {
    const previousAutoReset = gl.info.autoReset;
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = previousAutoReset;
      gl.info.reset();
    };
  }, [gl]);

  useFrame(() => {
    gl.info.reset();
    pipeline.composer.render();
  }, 1);

  return null;
}

// ── Scene ───────────────────────────────────────────────────────────────────

function SceneContents({
  layout,
  theme,
  fontFamily,
  selection,
  onPick,
}: {
  layout: ReturnType<typeof buildNearFocusLayout>;
  theme: RidgeStarTheme;
  fontFamily: string;
  selection: InternalSelection;
  onPick: (next: InternalSelection) => void;
}) {
  const motionTime = useRef(0);
  const positionMap = useRef(new Map<string, THREE.Vector3>());
  const controlsRef = useRef<ControlsRef>(null);
  const interactingRef = useRef(false);
  const cameraMotionRef = useRef(true);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const particleTexture = useDisposableTexture(() => makeSoftParticleTexture(64));
  const starSparkTexture = useDisposableTexture(() => makeStarburstTexture(128));
  const flareTexture = useDisposableTexture(() => makeLensFlareTexture(512, 40));
  const deepSkyTexture = useDisposableTexture(() => makeDeepSkyTexture(2048, 1024));

  useEffect(() => {
    const map = positionMap.current;
    return () => {
      map.clear();
      document.body.style.removeProperty("cursor");
    };
  }, []);

  useFrame((_state, delta) => {
    motionTime.current += Math.min(delta, 0.05);
  }, -2);

  const activePlanetId = selection?.kind === "planet" ? selection.id : null;
  const navKey = activePlanetId ? `planet:${activePlanetId}` : null;
  const fitDistance = camera instanceof THREE.PerspectiveCamera && size.width && size.height
    ? systemFitDistance(layout.outerEdge, camera.fov, size.width, size.height)
    : 30.5;

  return (
    <>
      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={[theme.background, 28, 82]} />
      <ambientLight intensity={0.055} />
      <hemisphereLight color="#5c76a6" groundColor="#09060b" intensity={0.32} />
      <directionalLight color="#7695c4" intensity={0.22} position={[0, 5, 8]} />
      <pointLight
        color={theme.keyLight}
        intensity={60 + STAR_LUMINOSITY * 32}
        distance={80}
        decay={2}
      />
      {/* Hand-drawn sky dome: seamless low-frequency color only — discrete
          stars live in the Points layers below. */}
      <mesh raycast={() => null} renderOrder={-50} rotation={[0.22, -0.64, -0.18]}>
        <sphereGeometry args={[92, 48, 28]} />
        <meshBasicMaterial
          map={deepSkyTexture}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
      <BandedStarfield particleTexture={particleTexture} />
      <BrightFieldAnchors sparkTexture={starSparkTexture} />
      {/* Warm floor glow around the star, overview only. */}
      {!navKey && (
        <group position={[0, -0.045, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <mesh raycast={() => null} renderOrder={-10} scale={[3.4, 3.4, 1]}>
            <planeGeometry args={[2, 2]} />
            <meshBasicMaterial
              map={particleTexture}
              color="#d68e4d"
              transparent
              opacity={0.085}
              blending={THREE.AdditiveBlending}
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh raycast={() => null} renderOrder={-11} scale={[9.6, 9.6, 1]}>
            <planeGeometry args={[2, 2]} />
            <meshBasicMaterial
              map={particleTexture}
              color="#345279"
              transparent
              opacity={0.018}
              blending={THREE.AdditiveBlending}
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}
      {!activePlanetId && layout.planets.map((node) => (
        <PlanetOrbitPath key={`orbit-${node.key}`} node={node} />
      ))}
      <FocusStar
        theme={theme}
        motionTime={motionTime}
        onSelect={() => onPick(selection?.kind === "star" ? null : { kind: "star" })}
        flareTexture={flareTexture}
      />
      {layout.planets.map((node) => (
        <PlanetSystem
          key={node.key}
          node={node}
          satellites={activePlanetId === node.planet.id
            ? layout.satellitesByPlanet.get(node.planet.id) || []
            : []}
          selected={activePlanetId === node.planet.id}
          dimmed={!!activePlanetId && activePlanetId !== node.planet.id}
          theme={theme}
          fontFamily={fontFamily}
          particleTexture={particleTexture}
          motionTime={motionTime}
          positionMap={positionMap}
          onSelect={() => onPick(activePlanetId === node.planet.id
            ? null
            : { kind: "planet", id: node.planet.id })}
        />
      ))}
      <AsteroidBeltDust
        motionTime={motionTime}
        particleTexture={particleTexture}
        mainBeltCenter={layout.mainBeltCenter}
        outerBase={layout.outerEdge}
      />
      <AsteroidField asteroids={layout.asteroids} motionTime={motionTime} />
      <CourseStreaks cameraMotionRef={cameraMotionRef} enabled={!!navKey} />
      <CinematicBloom />
      <CameraRig
        controlsRef={controlsRef}
        navKey={navKey}
        fitDistance={fitDistance}
        interactingRef={interactingRef}
        cameraMotionRef={cameraMotionRef}
        positionMap={positionMap}
      />
      {/* One-finger orbit; two fingers pinch to zoom and drag to pan
          (DOLLY_PAN reads both the pinch distance and the centroid shift). */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.055}
        enablePan
        screenSpacePanning={false}
        panSpeed={0.9}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        rotateSpeed={0.42}
        zoomSpeed={0.72}
        minDistance={5.5}
        maxDistance={Math.max(62, fitDistance * 1.5)}
        minPolarAngle={0.16}
        maxPolarAngle={Math.PI * 0.48}
        onStart={() => {
          interactingRef.current = true;
          cameraMotionRef.current = false;
        }}
        onEnd={() => { interactingRef.current = false; }}
      />
    </>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export default function NearFocus3D({
  snapshot,
  theme = SOLAR_STAR_THEME,
  onSelect,
  fontFamily = "ui-monospace, monospace",
}: NearFocus3DProps) {
  const [selection, setSelection] = useState<InternalSelection>(null);
  // Search chrome, ported from upstream: collapsed to a hand-drawn magnifier
  // square, expanding into an input on tap ("small UI, silky expand").
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const layout = useMemo(() => buildNearFocusLayout(snapshot), [snapshot]);
  const memoryTotal = useMemo(
    () => snapshot.planets.reduce((sum, planet) => sum + Math.max(planet.memoryCount || 0, planet.memories?.length || 0), 0),
    [snapshot],
  );
  const searchResults = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return [];
    return layout.planets
      .filter((node) => node.planet.name.toLocaleLowerCase().includes(query))
      .slice(0, 7);
  }, [layout, search]);
  const selectedPlanet = selection?.kind === "planet"
    ? layout.planets.find((node) => node.planet.id === selection.id) || null
    : null;

  const select = (next: InternalSelection) => {
    setSelection(next);
    if (!onSelect) return;
    if (next === null) onSelect(null);
    else if (next.kind === "star") onSelect({ kind: "star" });
    else {
      const hit = layout.planets.find((node) => node.planet.id === next.id);
      if (hit) onSelect({ kind: "planet", planet: hit.planet });
    }
  };

  useEffect(() => {
    if (selection?.kind === "planet" && !selectedPlanet) {
      setSelection(null);
      onSelect?.(null);
    }
  }, [onSelect, selectedPlanet, selection]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: theme.background,
        fontFamily,
        touchAction: "none",
      }}
    >
      <Canvas
        dpr={[1.5, 3]}
        camera={{ position: [0.5, 10.6, 30.5], fov: 42, near: 0.1, far: 220 }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.98;
          gl.setClearColor(theme.background, 1);
        }}
        onPointerMissed={() => select(null)}
        style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
      >
        <SceneContents
          layout={layout}
          theme={theme}
          fontFamily={fontFamily}
          selection={selection}
          onPick={select}
        />
      </Canvas>
      {/* Info block, upstream layout: name, census, then a state-aware hint. */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          pointerEvents: "none",
          color: "rgba(205,216,238,0.82)",
          fontSize: 10,
          lineHeight: 1.7,
          letterSpacing: 0.6,
          textShadow: "0 1px 3px rgba(1,3,10,0.9)",
          maxWidth: "62%",
        }}
      >
        <div style={{ color: "rgba(239,237,230,0.92)", fontSize: 11 }}>{snapshot.star.name}</div>
        <div>
          {layout.planets.length} planets · {memoryTotal} memories in orbit
          {snapshot.asteroids.length ? ` · ${snapshot.asteroids.length} drifting stones` : ""}
        </div>
        <div style={{ opacity: 0.55 }}>
          {selection?.kind === "planet"
            ? "Tap empty space to return to the overview"
            : selection?.kind === "star"
              ? snapshot.star.definition || "The center of this collection"
              : "Tap a planet · one finger orbits · pinch zooms"}
        </div>
      </div>
      {/* Search, upstream design: a magnifier square that silkily expands. */}
      <div style={{ position: "absolute", top: 10, right: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => window.setTimeout(() => {
              setSearchFocused(false);
              if (!searchInputRef.current?.value) setSearchOpen(false);
            }, 140)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && searchResults[0]) {
                event.preventDefault();
                select({ kind: "planet", id: searchResults[0].planet.id });
                setSearch("");
                setSearchFocused(false);
                setSearchOpen(false);
              } else if (event.key === "Escape") {
                setSearch("");
                setSearchFocused(false);
                setSearchOpen(false);
              }
            }}
            placeholder="Search planets"
            aria-label="Search planets"
            tabIndex={searchOpen ? 0 : -1}
            style={{
              width: searchOpen ? 148 : 0,
              opacity: searchOpen ? 1 : 0,
              transition: "width 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease",
              background: "rgba(4,7,16,0.88)",
              border: "1px solid rgba(205,216,238,0.22)",
              borderRight: "none",
              color: "#e8eef8",
              fontSize: 11,
              fontFamily,
              padding: searchOpen ? "5px 8px" : "5px 0",
              outline: "none",
            }}
          />
          <button
            type="button"
            title={searchOpen ? "Close search" : "Search planets"}
            aria-label={searchOpen ? "Close search" : "Search planets"}
            aria-expanded={searchOpen}
            onClick={() => {
              if (searchOpen) {
                setSearch("");
                setSearchOpen(false);
                setSearchFocused(false);
              } else {
                setSearchOpen(true);
                window.setTimeout(() => searchInputRef.current?.focus(), 30);
              }
            }}
            style={{
              background: "rgba(4,7,16,0.88)",
              border: "1px solid rgba(205,216,238,0.22)",
              color: "rgba(205,216,238,0.85)",
              width: 27,
              height: 27,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
              <circle cx="6.4" cy="6.4" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <line x1="9.6" y1="9.6" x2="13.2" y2="13.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
          {searchFocused && searchResults.length > 0 && (
            <div
              role="listbox"
              aria-label="Planet search results"
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                right: 0,
                minWidth: 175,
                background: "rgba(4,7,16,0.94)",
                border: "1px solid rgba(205,216,238,0.18)",
                zIndex: 30,
              }}
            >
              {searchResults.map((node) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={selection?.kind === "planet" && selection.id === node.planet.id}
                  key={node.planet.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    select({ kind: "planet", id: node.planet.id });
                    setSearch("");
                    setSearchFocused(false);
                    setSearchOpen(false);
                  }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    width: "100%",
                    background: "none",
                    border: "none",
                    borderBottom: "1px solid rgba(205,216,238,0.08)",
                    color: "#cdd8ea",
                    fontSize: 11,
                    fontFamily,
                    padding: "6px 9px",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span>{node.planet.name}</span>
                  <span style={{ opacity: 0.45 }}>{node.planet.memoryCount}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
