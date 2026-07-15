import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard, Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { RidgePlanet, RidgeSnapshot, RidgeStarTheme } from "../core/types";
import { hash01, GOLDEN_ANGLE } from "../core/hash";
import { SOLAR_STAR_THEME } from "../presets/solar-system";

/**
 * Near Focus 3D — a navigable star system.
 *
 * The star breathes at the center, planets ride their own orbits (spacing
 * accumulates with size so neighbors never collide), unattributed memories
 * form a dust belt, and each planet's memories appear as small satellites
 * when it is selected.
 *
 * v0.1 scope notes (see README): no post-processing bloom (the halo shader
 * carries the glow), no camera-follow navigation, no per-planet surface
 * shaders — those exist upstream and are on the extraction roadmap.
 */

export interface NearFocus3DProps {
  snapshot: RidgeSnapshot;
  theme?: RidgeStarTheme;
  onSelect?: (selection: { kind: "star" | "planet"; planet?: RidgePlanet } | null) => void;
  fontFamily?: string;
}

const ARCHETYPE_COLORS: Record<string, string> = {
  rocky: "#b08a5e",
  oceanic: "#3f6fb5",
  gas: "#d9b380",
  ice: "#a8d4e8",
  volcanic: "#b5533c",
};

// ── Star shaders ────────────────────────────────────────────────────────────

const STAR_VERTEX = /* glsl */ `
  varying vec3 vLocalPosition;
  varying vec3 vNormal;
  void main() {
    vLocalPosition = position;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Convective granules via cheap value noise; hot core, warm limb.
const STAR_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uWarm;
  uniform vec3 uHot;
  varying vec3 vLocalPosition;
  varying vec3 vNormal;
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
      mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
          mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
          mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }
  void main() {
    vec3 p = normalize(vLocalPosition) * 10.5;
    float granules = noise3(p + vec3(uTime * 0.028, -uTime * 0.017, uTime * 0.012)) * 0.76
      + noise3(p * 2.07 + 13.7) * 0.24;
    float cells = smoothstep(0.28, 0.84, granules);
    float facing = clamp(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
    float limb = pow(facing, 0.38);
    vec3 color = mix(uWarm * 0.98, uHot * 1.1, 0.4 + cells * 0.42);
    color = mix(uWarm * (0.78 + cells * 0.22), color, 0.3 + limb * 0.7);
    color += uHot * pow(cells, 3.0) * 0.12;
    gl_FragColor = vec4(color, 1.0);
  }
`;

const HALO_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// PITFALL baked in: the edge window guarantees the glow reaches zero before
// the billboard boundary. Without it, a bright halo shows its square canvas
// as a straight seam across the sky.
const HALO_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uWarm;
  uniform vec3 uHot;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float radius = length(p);
    float angle = atan(p.y, p.x + 0.00001);
    float pulse = 0.975 + sin(uTime * 0.5) * 0.025;
    float rays = smoothstep(0.28, 0.9,
      0.5 + 0.24 * sin(angle * 5.0 + uTime * 0.035)
          + 0.16 * sin(angle * 11.0 - uTime * 0.022)
          + 0.1 * sin(angle * 19.0 + 1.7));
    float core = exp(-radius * radius * 54.0);
    float innerHalo = exp(-radius * radius * 11.0) * 0.3;
    float corona = exp(-radius * (3.4 + rays * 1.6)) * (0.1 + rays * 0.2);
    float energy = (core * 0.58 + innerHalo + corona) * pulse * 1.15;
    float edge = max(abs(p.x), abs(p.y));
    energy *= 1.0 - smoothstep(0.78, 0.985, edge);
    if (energy < 0.0025) discard;
    vec3 color = mix(uWarm, uHot, clamp(core * 1.35 + innerHalo * 0.42, 0.0, 1.0));
    gl_FragColor = vec4(color, clamp(energy, 0.0, 0.75));
  }
`;

// ── Layout ──────────────────────────────────────────────────────────────────

interface PlanetLayout {
  planet: RidgePlanet;
  radius: number;
  size: number;
  phase: number;
  speed: number;
  inclination: number;
  color: string;
}

function layoutPlanets(planets: RidgePlanet[]): { rows: PlanetLayout[]; outerEdge: number } {
  const ranked = [...planets].sort((a, b) => a.rank - b.rank);
  const maxCount = Math.max(1, ...ranked.map((p) => p.memoryCount));
  let cursor = 4.3;
  let previousFootprint = 0;
  const rows = ranked.map((planet, i) => {
    const size = 0.34 + Math.min(planet.memoryCount / maxCount, 1) * 0.5;
    const footprint = size * 1.6 + 0.08;
    const radius = cursor + (previousFootprint > 0 ? Math.max(previousFootprint, footprint) + 0.58 : footprint);
    cursor = radius;
    previousFootprint = footprint;
    return {
      planet,
      radius,
      size,
      phase: i * GOLDEN_ANGLE + hash01(planet.id, 17) * 0.9,
      speed: 0.094 * Math.pow(radius / 4.3, -1.5),
      inclination: (hash01(planet.id, 41) - 0.5) * 0.045,
      color: ARCHETYPE_COLORS[planet.archetype || ""] || "#8b98ac",
    };
  });
  return { rows, outerEdge: cursor + previousFootprint + 1.2 };
}

// ── Scene pieces ────────────────────────────────────────────────────────────

function Star({ theme, selected, onClick }: { theme: RidgeStarTheme; selected: boolean; onClick: () => void }) {
  const surfaceRef = useRef<THREE.ShaderMaterial>(null);
  const haloRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWarm: { value: new THREE.Color(theme.starWarm) },
    uHot: { value: new THREE.Color(theme.starHot) },
  }), [theme]);
  const haloUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWarm: { value: new THREE.Color(theme.starWarm) },
    uHot: { value: new THREE.Color(theme.starHot) },
  }), [theme]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (surfaceRef.current) surfaceRef.current.uniforms.uTime.value = t;
    if (haloRef.current) haloRef.current.uniforms.uTime.value = t;
  });
  return (
    <group onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <Billboard follow raycast={() => null} renderOrder={-4}>
        <mesh scale={[18, 18, 1]} raycast={() => null}>
          <planeGeometry args={[1, 1]} />
          <shaderMaterial
            ref={haloRef}
            uniforms={haloUniforms}
            vertexShader={HALO_VERTEX}
            fragmentShader={HALO_FRAGMENT}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </Billboard>
      <mesh>
        <sphereGeometry args={[1.9, 48, 32]} />
        <shaderMaterial ref={surfaceRef} uniforms={uniforms} vertexShader={STAR_VERTEX} fragmentShader={STAR_FRAGMENT} />
      </mesh>
      {selected && (
        <mesh raycast={() => null}>
          <torusGeometry args={[2.5, 0.015, 8, 64]} />
          <meshBasicMaterial color="#d9e8ff" transparent opacity={0.6} />
        </mesh>
      )}
    </group>
  );
}

function Planet({ row, selected, onClick, keyLight, fontFamily }: {
  row: PlanetLayout;
  selected: boolean;
  onClick: () => void;
  keyLight: string;
  fontFamily: string;
}) {
  const orbitRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (orbitRef.current) orbitRef.current.rotation.y = row.phase + state.clock.elapsedTime * row.speed;
  });
  const points = useMemo(() => {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i += 1) {
      const a = (i / 96) * Math.PI * 2;
      out.push(new THREE.Vector3(Math.cos(a) * row.radius, 0, Math.sin(a) * row.radius));
    }
    return out;
  }, [row.radius]);
  return (
    <group rotation={[row.inclination, 0, 0]}>
      <Line
        points={points}
        color={selected ? "#ffd992" : "#68799f"}
        lineWidth={selected ? 1.6 : 0.9}
        transparent
        opacity={selected ? 0.8 : 0.16}
        raycast={() => null}
      />
      <group ref={orbitRef}>
        <group position={[row.radius, 0, 0]}>
          <mesh onClick={(e) => { e.stopPropagation(); onClick(); }}>
            <sphereGeometry args={[Math.max(row.size * 1.4, 0.5), 12, 8]} />
            <meshBasicMaterial transparent opacity={0} colorWrite={false} depthWrite={false} />
          </mesh>
          <mesh raycast={() => null}>
            <sphereGeometry args={[row.size, 32, 22]} />
            <meshStandardMaterial color={row.color} emissive={new THREE.Color(row.color).multiplyScalar(0.14)} roughness={0.72} metalness={0.05} />
          </mesh>
          {selected && (
            <>
              <mesh raycast={() => null}>
                <torusGeometry args={[row.size * 1.5, 0.012, 8, 48]} />
                <meshBasicMaterial color="#d9e8ff" transparent opacity={0.55} />
              </mesh>
              <Satellites row={row} />
              <Html center position={[0, row.size + 0.5, 0]} style={{ pointerEvents: "none" }}>
                <div style={{ color: "#f2f6ff", fontSize: 12, whiteSpace: "nowrap", fontFamily, textShadow: "0 1px 3px #01030a" }}>
                  {row.planet.name} · {row.planet.memoryCount}
                </div>
              </Html>
            </>
          )}
        </group>
      </group>
      {/* keyLight tint is applied by the central point light; this keeps the
          prop referenced for future per-planet shading parity. */}
      <group userData={{ keyLight }} />
    </group>
  );
}

function Satellites({ row }: { row: PlanetLayout }) {
  const memories = (row.planet.memories || []).slice(0, 8);
  const groupRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (groupRef.current) groupRef.current.rotation.y = state.clock.elapsedTime * 0.22;
  });
  if (!memories.length) return null;
  return (
    <group ref={groupRef} raycast={() => null}>
      {memories.map((memory, i) => {
        const orbit = row.size * 1.9 + 0.24 + i * 0.22;
        const angle = hash01(memory.id, 107) * Math.PI * 2;
        return (
          <mesh key={memory.id} position={[Math.cos(angle) * orbit, (hash01(memory.id, 13) - 0.5) * 0.16, Math.sin(angle) * orbit]} raycast={() => null}>
            <sphereGeometry args={[0.05 + (memory.heat ?? 0.3) * 0.05, 10, 8]} />
            <meshBasicMaterial color="#e8ecf4" transparent opacity={0.85} />
          </mesh>
        );
      })}
    </group>
  );
}

function Belt({ innerRadius, count, memoriesSeed }: { innerRadius: number; count: number; memoriesSeed: string[] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (groupRef.current) groupRef.current.rotation.y = state.clock.elapsedTime * 0.012;
  });
  const [positions, colors] = useMemo(() => {
    const total = count + memoriesSeed.length;
    const pos = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const warm = new THREE.Color("#c8a37a");
    const cold = new THREE.Color("#8fa3bd");
    for (let i = 0; i < total; i += 1) {
      const seed = i < memoriesSeed.length ? memoriesSeed[i] : `belt-fill-${i}`;
      const angle = hash01(seed, 29) * Math.PI * 2;
      const radial = innerRadius + hash01(seed, 31) * 1.6;
      pos[i * 3] = Math.cos(angle) * radial;
      pos[i * 3 + 1] = (hash01(seed, 37) - 0.5) * 0.5;
      pos[i * 3 + 2] = Math.sin(angle) * radial;
      const c = hash01(seed, 43) < 0.5 ? warm : cold;
      const b = 0.5 + hash01(seed, 47) * 0.45;
      col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
    }
    return [pos, col];
  }, [innerRadius, count, memoriesSeed]);
  return (
    <group ref={groupRef} raycast={() => null}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial vertexColors size={0.16} sizeAttenuation transparent opacity={0.68} depthWrite={false} />
      </points>
    </group>
  );
}

function FarStars() {
  const [positions, colors] = useMemo(() => {
    const count = 420;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const theta = hash01(`far-a-${i}`, 7) * Math.PI * 2;
      const phi = Math.acos(2 * hash01(`far-p-${i}`, 11) - 1);
      const r = 60 + hash01(`far-r-${i}`, 13) * 40;
      pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      pos[i * 3 + 1] = Math.cos(phi) * r;
      pos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
      const b = 0.25 + hash01(`far-b-${i}`, 17) * 0.5;
      col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b * 1.06;
    }
    return [pos, col];
  }, []);
  return (
    <points raycast={() => null}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial vertexColors size={0.5} sizeAttenuation transparent opacity={0.85} depthWrite={false} />
    </points>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export default function NearFocus3D({
  snapshot,
  theme = SOLAR_STAR_THEME,
  onSelect,
  fontFamily = "ui-monospace, monospace",
}: NearFocus3DProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { rows, outerEdge } = useMemo(() => layoutPlanets(snapshot.planets), [snapshot.planets]);
  const beltSeeds = useMemo(() => snapshot.asteroids.map((m) => m.id), [snapshot.asteroids]);

  const select = (next: string | null) => {
    setSelectedId(next);
    if (!onSelect) return;
    if (next === null) onSelect(null);
    else if (next === "star") onSelect({ kind: "star" });
    else {
      const hit = rows.find((r) => r.planet.id === next);
      if (hit) onSelect({ kind: "planet", planet: hit.planet });
    }
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: theme.background, fontFamily }}>
      <Canvas
        camera={{ position: [0.5, 10.6, 30.5], fov: 42, near: 0.1, far: 220 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.98;
          gl.setClearColor(theme.background, 1);
        }}
        onPointerMissed={() => select(null)}
      >
        <ambientLight intensity={0.12} />
        <pointLight color={theme.keyLight} intensity={60} distance={80} decay={2} />
        <FarStars />
        <Star theme={theme} selected={selectedId === "star"} onClick={() => select(selectedId === "star" ? null : "star")} />
        {rows.map((row) => (
          <Planet
            key={row.planet.id}
            row={row}
            selected={selectedId === row.planet.id}
            onClick={() => select(selectedId === row.planet.id ? null : row.planet.id)}
            keyLight={theme.keyLight}
            fontFamily={fontFamily}
          />
        ))}
        <Belt innerRadius={outerEdge + 1.4} count={500} memoriesSeed={beltSeeds} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.055}
          enablePan
          screenSpacePanning={false}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
          rotateSpeed={0.45}
          zoomSpeed={0.72}
          minDistance={4}
          maxDistance={70}
          minPolarAngle={0.16}
          maxPolarAngle={Math.PI * 0.48}
        />
      </Canvas>
    </div>
  );
}
