import type { EchoBond, EchoMoment } from "../core/emotion-types.js";
import { clampImportance } from "../core/emotion-types.js";
import { hash01 } from "../core/hash.js";

/**
 * Deterministic layout for the Echo Galaxy.
 *
 * The scatter looks random but every coordinate is derived from the moment's
 * id via hash01, plus three semantic axes borrowed from the production
 * design this component was extracted from:
 *   x drifts with valence (bright moments lean one way, dark the other),
 *   y lifts with arousal (storms float, calm sinks),
 *   z stretches with time (the cloud reads front-to-back as a timeline).
 * A short bond-spring pass then pulls linked moments together. No
 * Math.random anywhere: the same sea always renders the same sky.
 */

export type LayoutMoment = EchoMoment & { x: number; y: number; z: number };

export interface NormalizedBond {
  source: string;
  target: string;
  strength: number;
}

const clamp01 = (value: number | undefined, fallback: number) => (
  Number.isFinite(value) ? Math.min(1, Math.max(0, value!)) : fallback
);

/** 0-1 attention value; missing heat reads as a faint ember, not zero. */
export function clampHeat(heat: number | undefined): number {
  return clamp01(heat, 0.1);
}

/** Label/flare ranking: importance dominates, heat breaks ties (production rule). */
export function echoScore(moment: EchoMoment): number {
  return clampImportance(moment.importance) * 10 + clampHeat(moment.heat);
}

const stableCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Drop bonds with unknown endpoints or self-loops; dedupe keeping the strongest. */
export function normalizedBonds(
  moments: EchoMoment[],
  bonds: EchoBond[] | undefined,
): NormalizedBond[] {
  if (!bonds?.length) return [];
  const ids = new Set(moments.map((moment) => moment.id));
  const pairs = new Map<string, NormalizedBond>();
  for (const bond of bonds) {
    if (!ids.has(bond.source) || !ids.has(bond.target) || bond.source === bond.target) continue;
    const [source, target] = stableCompare(bond.source, bond.target) <= 0
      ? [bond.source, bond.target]
      : [bond.target, bond.source];
    const key = JSON.stringify([source, target]);
    const strength = clamp01(bond.strength, 0.5);
    const previous = pairs.get(key);
    if (!previous || strength > previous.strength) pairs.set(key, { source, target, strength });
  }
  return [...pairs.values()].sort((a, b) => (
    stableCompare(a.source, b.source) || stableCompare(a.target, b.target)
  ));
}

function momentTime(moment: EchoMoment): number {
  const time = Date.parse(moment.date);
  return Number.isFinite(time) ? time : Number.NaN;
}

export function layoutMoments(
  moments: EchoMoment[],
  bonds: NormalizedBond[],
): LayoutMoment[] {
  const out: LayoutMoment[] = moments.map((moment) => ({ ...moment, x: 0, y: 0, z: 0 }));
  const N = out.length;
  if (!N) return out;

  // Normalize time to 0..1; unparseable dates fall back to a hashed slot so
  // they still spread instead of stacking at one end.
  const times = out.map(momentTime);
  const known = times.filter(Number.isFinite);
  const tMin = known.length ? Math.min(...known) : 0;
  const tSpan = known.length ? Math.max(Math.max(...known) - tMin, 1) : 1;

  out.forEach((moment, i) => {
    const valence = clamp01((moment.valence + 1) / 2, 0.5) * 2 - 1;
    const arousal = clamp01(moment.arousal, 0.5);
    const t = Number.isFinite(times[i])
      ? (times[i] - tMin) / tSpan
      : hash01(moment.id, 41);
    const radius = 26 + hash01(moment.id, 3) * 64;
    const theta = hash01(moment.id, 5) * Math.PI * 2;
    const phi = Math.acos(2 * hash01(moment.id, 7) - 1);
    moment.x = Math.sin(phi) * Math.cos(theta) * radius + valence * 20;
    moment.y = Math.sin(phi) * Math.sin(theta) * radius * 0.6 + (arousal - 0.5) * 25;
    moment.z = Math.cos(phi) * radius * 0.8 + (t - 0.5) * 50;
  });

  // Deterministic spring pass: bonded moments drift toward each other so the
  // bond lines read as ties, not chords across the whole cloud.
  if (bonds.length) {
    const idx = new Map(out.map((moment, i) => [moment.id, i]));
    const iterations = 36;
    for (let it = 0; it < iterations; it += 1) {
      const alpha = 1 - it / iterations;
      for (const bond of bonds) {
        const a = out[idx.get(bond.source)!];
        const b = out[idx.get(bond.target)!];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
        const target = 10 + (1 - bond.strength) * 14;
        const f = ((d - target) / d) * 0.05 * alpha * (0.4 + bond.strength);
        a.x += dx * f; a.y += dy * f; a.z += dz * f;
        b.x -= dx * f; b.y -= dy * f; b.z -= dz * f;
      }
    }
  }

  // Recenter and cap the radius so FitCamera frames every sea the same way.
  const center = out.reduce((sum, moment) => {
    sum[0] += moment.x; sum[1] += moment.y; sum[2] += moment.z;
    return sum;
  }, [0, 0, 0]);
  center[0] /= N; center[1] /= N; center[2] /= N;
  let maxRadius = 0;
  for (const moment of out) {
    moment.x -= center[0]; moment.y -= center[1]; moment.z -= center[2];
    maxRadius = Math.max(maxRadius, Math.hypot(moment.x, moment.y, moment.z));
  }
  if (maxRadius > 64) {
    const scale = 64 / maxRadius;
    for (const moment of out) { moment.x *= scale; moment.y *= scale; moment.z *= scale; }
  }
  return out;
}
