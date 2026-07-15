import type { RidgeSnapshot, RidgeStarTheme } from "../core/types.js";

/**
 * The classic. Default face of Observatory Ridge — a warm G-type sun and the
 * eight planets everyone grew up with. Swap it out with your own snapshot to
 * make the sky yours.
 */

export const SOLAR_STAR_THEME: RidgeStarTheme = {
  starHot: "#fff3d2",
  starWarm: "#e8a052",
  keyLight: "#ffd6a0",
  background: "#01040c",
};

/** A cool blue-white alternative star theme. */
export const BLUE_STAR_THEME: RidgeStarTheme = {
  starHot: "#5e97f2",
  starWarm: "#a3c2f4",
  keyLight: "#d4e2ff",
  background: "#01040c",
};

export function solarSystemSnapshot(): RidgeSnapshot {
  const planet = (
    rank: number,
    name: string,
    archetype: "rocky" | "oceanic" | "gas" | "ice" | "volcanic",
    definition: string,
    memoryCount: number,
  ) => ({ id: `sol-${rank}`, name, archetype, definition, rank, memoryCount, memories: [] });

  return {
    star: { name: "Sol", definition: "The one that lights everything you remember." },
    planets: [
      planet(1, "Mercury", "rocky", "Small, fast, scorched.", 8),
      planet(2, "Venus", "volcanic", "Beautiful and uninhabitable.", 12),
      planet(3, "Earth", "oceanic", "Home. Every memory starts here.", 42),
      planet(4, "Mars", "rocky", "The one we keep writing stories about.", 18),
      planet(5, "Jupiter", "gas", "Giant. Keeps the neighborhood safe.", 24),
      planet(6, "Saturn", "gas", "The rings everybody came to see.", 20),
      planet(7, "Uranus", "ice", "Rolls sideways. Judged unfairly.", 9),
      planet(8, "Neptune", "ice", "Far, blue, patient.", 11),
    ],
    asteroids: [],
  };
}
