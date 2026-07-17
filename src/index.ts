export { default as GalaxyView, detectCommunities, galaxyLayout } from "./galaxy-view/GalaxyView.js";
export type { GalaxyViewProps } from "./galaxy-view/GalaxyView.js";

export { default as NearFocus2D, orbitRadius } from "./near-focus-2d/NearFocus2D.js";
export type { NearFocus2DProps, NearFocus2DSelection } from "./near-focus-2d/NearFocus2D.js";

export { default as NearFocus3D } from "./near-focus-3d/NearFocus3D.js";
export type { NearFocus3DProps, NearFocus3DSelection } from "./near-focus-3d/NearFocus3D.js";

export { hash01, GOLDEN_ANGLE } from "./core/hash.js";
export type {
  RidgeEdge,
  RidgeGraph,
  RidgeMemory,
  RidgePlanet,
  RidgeSnapshot,
  RidgeStarTheme,
} from "./core/types.js";

export {
  BLUE_STAR_THEME,
  SOLAR_STAR_THEME,
  solarSystemSnapshot,
} from "./presets/solar-system.js";
export { default as EchoStarmap } from "./echo-starmap/EchoStarmap";
export { default as EchoGalaxy } from "./echo-galaxy/EchoGalaxy";
export * from "./core/emotion-types";
