/**
 * Observatory Ridge — data contract.
 *
 * Every visualization in this kit consumes plain JSON matching these types.
 * Bring your own backend, static file, or the bundled demo generator —
 * the components never fetch anything themselves.
 */

/** A "planet" is a curated concept that memories orbit around. */
export interface RidgePlanet {
  /** Stable unique id. Avoid purely sequential ids if you can (see README pitfalls). */
  id: string;
  /** Display name. */
  name: string;
  /** Optional one-line definition shown in detail panels. */
  definition?: string;
  /** Visual archetype — drives surface shading in 3D. */
  archetype?: "rocky" | "oceanic" | "gas" | "ice" | "volcanic";
  /** 1-based display rank. Lower = closer to the star. */
  rank: number;
  /** Number of memories attributed to this planet (drives size/brightness). */
  memoryCount: number;
  /** Memories to show in detail panels (a subset is fine). */
  memories?: RidgeMemory[];
}

/** A memory/note/record — the "satellite" of whichever planet owns it. */
export interface RidgeMemory {
  id: string;
  title: string;
  /** ISO date string used for sorting/labels. */
  date?: string;
  /** Optional category key — used by Galaxy View community seeding. */
  category?: string;
  /** Optional short preview text for panels. */
  preview?: string;
  /** 0..1 attention/heat — drives brightness where supported. */
  heat?: number;
  /** Owning planet id. Memories without one drift into the asteroid belt. */
  planetId?: string | null;
}

/** A relation between two memories — Galaxy View edges. */
export interface RidgeEdge {
  source: string;
  target: string;
  /** 0..1 strength. */
  weight?: number;
}

/** The full snapshot the near-focus views consume. */
export interface RidgeSnapshot {
  /** The central star. */
  star: { name: string; definition?: string };
  planets: RidgePlanet[];
  /** Unattributed memories — rendered as the asteroid belt. */
  asteroids: RidgeMemory[];
}

/** Graph payload for Galaxy View. */
export interface RidgeGraph {
  nodes: RidgeMemory[];
  edges: RidgeEdge[];
}

/** Star/scene colors — swap the whole mood with one object. */
export interface RidgeStarTheme {
  /** Star surface hot core color. */
  starHot: string;
  /** Star limb/corona color. */
  starWarm: string;
  /** Key light tint cast on planets. */
  keyLight: string;
  /** Scene background. */
  background: string;
}
