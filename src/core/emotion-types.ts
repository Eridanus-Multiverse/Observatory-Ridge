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
 * Shared valence/arousal color ramp, ported verbatim from the upstream
 * renderer: deep blue for the low days, grey-lavender around neutral, then
 * burning through amber into red-hot for the bright ones. No green anywhere —
 * moods don't come in green. Arousal adds heat to every band. Both Echo
 * renderers use this so a moment keeps its color across views.
 */
export function echoColorRGB(valence: number, arousal: number): [number, number, number] {
  const vv = clampValence(valence);
  const aa = clampArousal(arousal);
  if (vv < -0.5) return [0.3 + aa * 0.15, 0.35 + aa * 0.1, 0.9 + aa * 0.1];
  if (vv < -0.15) {
    const t = (vv + 0.5) / 0.35;
    return [0.3 + t * 0.35 + aa * 0.1, 0.35 + t * 0.3 + aa * 0.1, 0.9 - t * 0.15];
  }
  if (vv < 0.15) return [0.65 + aa * 0.15, 0.65 + aa * 0.1, 0.75 + aa * 0.1];
  if (vv < 0.5) {
    const t = (vv - 0.15) / 0.35;
    return [0.75 + t * 0.25, 0.65 - t * 0.2 + aa * 0.1, 0.55 - t * 0.3];
  }
  return [1.0, 0.4 + aa * 0.15, 0.15 + aa * 0.1];
}

/** CSS form of `echoColorRGB` for canvas renderers. */
export function echoColor(valence: number, arousal: number): string {
  const [r, g, b] = echoColorRGB(valence, arousal);
  const to255 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}
