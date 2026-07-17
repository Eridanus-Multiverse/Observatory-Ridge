/**
 * Echo Sea data contract — the emotional counterpart of `RidgeSnapshot`.
 *
 * Where the knowledge views render what you know, the Echo Sea renders how
 * the days felt. A moment is one remembered point in time with an affect
 * reading; bonds link moments that belong together. Adapters normalize
 * whatever the host application records (diary entries, mood check-ins,
 * message sentiment) into this shape — renderers never fetch private data
 * themselves.
 */

export interface EchoMoment {
  /** Stable unique ID. */
  id: string;
  /** ISO 8601 date or datetime; drives placement along the time axis. */
  date: string;
  /** Pleasantness of the moment, -1 (dark) through 1 (bright). */
  valence: number;
  /** Intensity of the moment, 0 (calm) through 1 (storming). */
  arousal: number;
  /** Optional 1-5 weight; larger moments render larger. Defaults to 3. */
  importance?: number;
  /** Optional 0-1 attention value; brighter when higher. */
  heat?: number;
  /** Short, already-redacted display label. */
  label?: string;
  /** Rendering family: diary-like events vs attributed memories. */
  kind?: "event" | "memory";
}

export interface EchoBond {
  /** `EchoMoment.id` on each end. Invalid references are ignored. */
  source: string;
  target: string;
  /** Optional 0-1 strength; stronger bonds render brighter. */
  strength?: number;
}

export interface EchoSea {
  moments: EchoMoment[];
  bonds?: EchoBond[];
}

/** Clamp helpers shared by both Echo renderers. */
export function clampValence(v: number): number {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

export function clampArousal(a: number): number {
  return Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 0;
}

export function clampImportance(i: number | undefined): number {
  if (!Number.isFinite(i as number)) return 3;
  return Math.max(1, Math.min(5, Math.round(i as number)));
}

/**
 * Shared valence/arousal color ramp: dark violet (low valence) through calm
 * blue to warm gold (high valence); arousal saturates the tone. Both Echo
 * renderers use this so a moment keeps its color across views.
 */
export function echoColor(valence: number, arousal: number): string {
  const v = (clampValence(valence) + 1) / 2; // 0..1
  const a = clampArousal(arousal);
  const hue = 265 - v * 220; // 265 (violet) -> 45 (gold)
  const sat = 35 + a * 45;
  const light = 42 + v * 22;
  return `hsl(${Math.round(hue)}, ${Math.round(sat)}%, ${Math.round(light)}%)`;
}
