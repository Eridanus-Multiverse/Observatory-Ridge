import type { RidgeMemory, RidgePlanet, RidgeSnapshot } from "../core/types.js";
import { GOLDEN_ANGLE, hash01 } from "../core/hash.js";

/**
 * Near Focus 3D layout model.
 *
 * Pure math: turns a RidgeSnapshot into orbital parameters for planets,
 * satellites (a planet's memories), and the asteroid belt (unattributed
 * memories). Everything is deterministic — visual randomness comes from
 * hash01 on stable ids, never Math.random.
 */

export const TAU = Math.PI * 2;

/** Innermost orbit anchor. */
export const PLANET_ORBIT_MIN = 4.3;
/** Breathing gap between neighboring orbital footprints. */
const PLANET_ORBIT_GAP = 0.58;
/** Width of the inter-planet gap reserved for the main asteroid belt. */
const MAIN_BELT_GAP = 2.6;
const PLANET_SPEED_AT_INNER_ORBIT = 0.094;
const PLANET_DISK_INCLINATION_SPAN = 0.045;
const MAX_SATELLITES_PER_PLANET = 8;
const MAX_ASTEROIDS = 64;

/** Planets with at least this many memories earn a Saturn-style particle ring. */
export const MEMORY_RING_THRESHOLD = 12;

/** Visual radius multiplier for an unfocused planet — layout and render share it. */
export const PLANET_VISUAL_SCALE = 0.52;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function hasMemoryRing(memoryCount: number): boolean {
  return Number.isFinite(memoryCount) && memoryCount >= MEMORY_RING_THRESHOLD;
}

/**
 * Ring/satellite system plane per planet. Rings can be tilted (character),
 * but rings and camera focus share this one function so a focused planet
 * always reads level. Tilt is capped low enough to stay believable.
 */
export function planetSystemTilt(planetId: string): [number, number] {
  return [0.05 + hash01(planetId, 353) * 0.19, hash01(planetId, 359) * TAU];
}

export interface PlanetNode {
  planet: RidgePlanet;
  /** Stable scene key, `planet:<id>`. */
  key: string;
  memoryCount: number;
  rank: number;
  /** Importance blend — more important planets take inner orbits. */
  score: number;
  size: number;
  radius: number;
  phase: number;
  inclination: number;
  ascendingNode: number;
  angularSpeed: number;
}

export interface SatelliteNode {
  memory: RidgeMemory;
  key: string;
  localRadius: number;
  phase: number;
  inclination: number;
  angularSpeed: number;
  size: number;
  color: string;
}

export interface AsteroidNode {
  memory: RidgeMemory;
  key: string;
  radius: number;
  phase: number;
  inclination: number;
  ascendingNode: number;
  angularSpeed: number;
  size: number;
  color: string;
}

export interface NearFocusLayout {
  planets: PlanetNode[];
  satellitesByPlanet: Map<string, SatelliteNode[]>;
  asteroids: AsteroidNode[];
  /** Main belt center — embedded in the planet sequence like Mars/Jupiter. */
  mainBeltCenter: number;
  /** Outer edge of the planet region (outermost orbit + its footprint). */
  outerEdge: number;
  /** Cold outer belt center, just past the planet region. */
  outerBelt: number;
}

/** Muted category palette for memory satellites and belt stones. */
const MEMORY_CATEGORY_COLORS = [
  "#9a835c",
  "#756f86",
  "#94727a",
  "#66878a",
  "#718873",
  "#947866",
  "#627f90",
  "#788188",
] as const;

export function memoryCategoryColor(category: unknown): string {
  const normalized = typeof category === "string" ? category.trim().toLowerCase() : "";
  if (!normalized) return "#76858b";
  return MEMORY_CATEGORY_COLORS[
    Math.floor(hash01(normalized, 83) * MEMORY_CATEGORY_COLORS.length)
  ];
}

function memoryHeat(memory: RidgeMemory): number {
  return Number.isFinite(memory.heat) ? clamp(memory.heat!, 0, 1) : 0.3;
}

function memoryDateValue(memory: RidgeMemory): number {
  const parsed = Date.parse(String(memory.date || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareMemories(a: RidgeMemory, b: RidgeMemory): number {
  return memoryHeat(b) - memoryHeat(a)
    || memoryDateValue(b) - memoryDateValue(a)
    || a.id.localeCompare(b.id);
}

function uniqueMemories(memories: readonly RidgeMemory[] | undefined | null): RidgeMemory[] {
  const ordered = [...(memories || [])]
    .filter((memory) => Boolean(String(memory?.id || "").trim()))
    .sort(compareMemories);
  const unique = new Map<string, RidgeMemory>();
  for (const memory of ordered) {
    if (!unique.has(memory.id)) unique.set(memory.id, memory);
  }
  return [...unique.values()];
}

/**
 * The contract has no per-planet luminosity reading; derive a stable stand-in
 * from the id so sizes and scores keep their production variance.
 */
function planetLuminosity(planet: RidgePlanet): number {
  return hash01(planet.id, 61);
}

function safeMemoryCount(planet: RidgePlanet): number {
  return Number.isFinite(planet.memoryCount) ? Math.max(0, Math.floor(planet.memoryCount)) : 0;
}

function safeRank(planet: RidgePlanet): number {
  return Number.isFinite(planet.rank) ? Math.max(0, Math.floor(planet.rank)) : Number.MAX_SAFE_INTEGER;
}

/**
 * Size range is roughly 6:1; the 1.5 power compresses the small tail and
 * lifts the head so a heavily-attributed planet reads as a giant.
 */
function planetSize(planet: RidgePlanet): number {
  const memorySignal = clamp(Math.log1p(safeMemoryCount(planet)) / Math.log1p(140), 0, 1);
  return clamp(0.24 + Math.pow(memorySignal, 1.5) * 1.02 + planetLuminosity(planet) * 0.1, 0.24, 1.42);
}

function planetScore(planet: RidgePlanet): number {
  const rankSignal = 1 / (1 + safeRank(planet));
  const memorySignal = clamp(Math.log1p(safeMemoryCount(planet)) / Math.log1p(200), 0, 1);
  return clamp(rankSignal * 0.35 + memorySignal * 0.45 + planetLuminosity(planet) * 0.2, 0, 1);
}

/** Orbital footprint: sphere (or ring A-ring outer edge) plus breathing pad. */
export function planetFootprint(size: number, memoryCount: number): number {
  return size * PLANET_VISUAL_SCALE * (hasMemoryRing(memoryCount) ? 2.08 : 1.0) + 0.08;
}

function satelliteSize(memory: RidgeMemory): number {
  // Production sized moons from importance/heat/pinned; the contract only has
  // heat (0..1), so heat carries the signal and a hash jitter keeps variance.
  const jitter = 0.75 + hash01(memory.id, 733) * 0.6;
  return clamp((0.06 + memoryHeat(memory) * 0.14) * jitter, 0.055, 0.21);
}

function asteroidSize(memory: RidgeMemory): number {
  const jitter = 0.7 + hash01(memory.id, 727) * 0.6;
  return clamp((0.062 + memoryHeat(memory) * 0.046) * jitter, 0.05, 0.14);
}

function buildSatellite(
  memory: RidgeMemory,
  ownerPlanetId: string,
  ownerPlanetSize: number,
  ownerMemoryCount: number,
  ownerIndex: number
): SatelliteNode {
  const seed = `${ownerPlanetId}:${memory.id}`;
  // Orbits start outside the ring's A-ring edge (measured at the focused
  // 0.8 planet scale — satellites only show when focused, so the expanded
  // ring is the one they must clear), then space geometrically outward.
  const ringOuter = hasMemoryRing(ownerMemoryCount) ? 2.15 : 1.25;
  const surface = ownerPlanetSize * 0.8 * ringOuter + 0.34;
  const localRadius = surface + ownerIndex * 0.42 + (hash01(seed, 103) - 0.5) * 0.05;
  return {
    memory,
    key: `memory:${memory.id}`,
    localRadius,
    phase: hash01(seed, 107) * TAU,
    // Moon mode: satellite orbits stay near the global ecliptic even when
    // the planet's ring is tilted — like the Moon riding the ecliptic.
    inclination: (hash01(seed, 109) - 0.5) * 0.06,
    angularSpeed: 0.24 * Math.pow(localRadius / surface, -1.5) * (0.9 + hash01(seed, 113) * 0.2),
    size: satelliteSize(memory),
    color: memoryCategoryColor(memory.category),
  };
}

function buildAsteroid(memory: RidgeMemory, innerBelt: number, outerBelt: number): AsteroidNode {
  const key = `memory:${memory.id}`;
  const scattered = Math.floor(hash01(key, 179) * 8) === 0;
  const radialSeed = hash01(key, 151);
  const inclinationSeed = hash01(key, 163);
  const inclinationDirection = hash01(key, 181) < 0.5 ? -1 : 1;
  // Two-belt structure: hot memories settle in the inner belt, the rest in
  // the cold outer belt, and a few strays drift across on high inclinations.
  const beltCenter = memoryHeat(memory) >= 0.4 ? innerBelt : outerBelt;
  return {
    memory,
    key,
    radius: scattered
      ? innerBelt - 1.6 + radialSeed * (outerBelt - innerBelt + 3.2)
      : beltCenter - 1.4 + radialSeed * 2.8,
    phase: hash01(key, 157) * TAU,
    inclination: scattered
      ? inclinationDirection * (0.18 + inclinationSeed * 0.26)
      : (inclinationSeed - 0.5) * 0.16,
    ascendingNode: hash01(key, 167) * TAU,
    angularSpeed: scattered
      ? 0.01 + hash01(key, 173) * 0.007
      : 0.015 + hash01(key, 173) * 0.004,
    size: asteroidSize(memory),
    color: memoryCategoryColor(memory.category),
  };
}

export function buildNearFocusLayout(snapshot: RidgeSnapshot): NearFocusLayout {
  const ordered = [...(snapshot.planets || [])]
    .filter((planet) => Boolean(String(planet?.id || "").trim()))
    .sort((a, b) => safeRank(a) - safeRank(b) || a.id.localeCompare(b.id));
  const uniquePlanets = new Map<string, RidgePlanet>();
  for (const planet of ordered) {
    if (!uniquePlanets.has(planet.id)) uniquePlanets.set(planet.id, planet);
  }
  const planetsInput = [...uniquePlanets.values()];

  const signals = planetsInput.map((planet) => ({
    planet,
    memoryCount: safeMemoryCount(planet),
    rank: safeRank(planet),
    score: planetScore(planet),
    size: planetSize(planet),
  }));

  // Importance decides distance: higher score = inner orbit. Spacing
  // accumulates each neighbor's footprint so rings never overlap orbits,
  // and the main belt occupies a widened gap about 40% of the way out.
  const orbitOrder = [...signals].sort((a, b) => (
    b.score - a.score || a.rank - b.rank || a.planet.id.localeCompare(b.planet.id)
  ));
  const radiusById = new Map<string, number>();
  const orbitIndexById = new Map<string, number>();
  let orbitCursor = PLANET_ORBIT_MIN;
  let previousFootprint = 0;
  let mainBeltCenter = PLANET_ORBIT_MIN + 1.6;
  const beltSlot = Math.max(1, Math.floor(orbitOrder.length * 0.4));
  orbitOrder.forEach((signal, index) => {
    const footprint = planetFootprint(signal.size, signal.memoryCount);
    if (index === beltSlot) {
      mainBeltCenter = orbitCursor + MAIN_BELT_GAP / 2;
      orbitCursor += MAIN_BELT_GAP;
    }
    const radius = orbitCursor
      + (previousFootprint > 0 || index === beltSlot
        ? Math.max(previousFootprint, footprint) + PLANET_ORBIT_GAP
        : footprint);
    radiusById.set(signal.planet.id, radius);
    orbitIndexById.set(signal.planet.id, index);
    orbitCursor = radius;
    previousFootprint = footprint;
  });
  if (orbitOrder.length > 0 && beltSlot >= orbitOrder.length) {
    mainBeltCenter = orbitCursor + MAIN_BELT_GAP / 2;
  }

  const planets: PlanetNode[] = signals.map((signal) => {
    const id = signal.planet.id;
    const orbitIndex = orbitIndexById.get(id) || 0;
    const radius = radiusById.get(id) ?? PLANET_ORBIT_MIN;
    return {
      planet: signal.planet,
      key: `planet:${id}`,
      memoryCount: signal.memoryCount,
      rank: signal.rank,
      score: signal.score,
      size: signal.size,
      radius,
      // Golden-angle phases spread any planet count evenly; the hash is only
      // a perturbation (sequential ids would otherwise cluster).
      phase: orbitIndex * GOLDEN_ANGLE + hash01(id, 17) * 0.9,
      inclination: (hash01(id, 41) - 0.5) * PLANET_DISK_INCLINATION_SPAN,
      ascendingNode: hash01(id, 53) * TAU,
      angularSpeed: PLANET_SPEED_AT_INNER_ORBIT
        * Math.pow(radius / PLANET_ORBIT_MIN, -1.35)
        * (0.97 + hash01(id, 67) * 0.06),
    };
  });

  let outerEdge = PLANET_ORBIT_MIN;
  for (const node of planets) {
    outerEdge = Math.max(outerEdge, node.radius + planetFootprint(node.size, node.memoryCount));
  }
  const outerBelt = outerEdge + 2.2;

  const satellitesByPlanet = new Map<string, SatelliteNode[]>();
  for (const node of planets) {
    const memories = uniqueMemories(node.planet.memories).slice(0, MAX_SATELLITES_PER_PLANET);
    satellitesByPlanet.set(
      node.planet.id,
      memories.map((memory, index) => (
        buildSatellite(memory, node.planet.id, node.size, node.memoryCount, index)
      ))
    );
  }

  const asteroids = uniqueMemories(snapshot.asteroids)
    .slice(0, MAX_ASTEROIDS)
    .map((memory) => buildAsteroid(memory, mainBeltCenter, outerBelt));

  return { planets, satellitesByPlanet, asteroids, mainBeltCenter, outerEdge, outerBelt };
}
