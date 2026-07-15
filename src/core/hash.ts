/**
 * Deterministic hashing for visual randomness.
 *
 * PITFALL (learned the hard way): raw FNV-1a has weak avalanche on inputs
 * that differ only in their last characters — e.g. sequential ids like
 * `planet-01`, `planet-02`. Feed those to a naive hash and every planet
 * rolls the same ring type, the same tilt, the same face. We finish with
 * the MurmurHash3 fmix32 mixer so sequential inputs still land uniformly.
 */
export function hash01(value: string, salt = 0): number {
  let hash = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash / 4294967296;
}

/** Golden angle in radians — spreads any count of items evenly around a circle. */
export const GOLDEN_ANGLE = 2.399963229728653;
