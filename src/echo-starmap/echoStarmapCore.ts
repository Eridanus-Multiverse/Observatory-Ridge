import type { EchoMoment, EchoSea } from "../core/emotion-types.js";
import {
  clampArousal,
  clampImportance,
  clampValence,
  echoColor,
} from "../core/emotion-types.js";
import { hash01 } from "../core/hash.js";

/**
 * Echo starmap drawing core — a full-sky, astronomy-photo rendering of an
 * EchoSea on the affect grid.
 *
 * The sky is composed back to front: a seeded dust field for galaxy grain,
 * a palette-tinted airglow density field (moments pile up into colored
 * haze), nebula glow around dense clusters, bond lines with greedy
 * anti-crossing, then the stars themselves — most are dim dust points,
 * the brightest slice gets diffraction spikes and a white-hot core, the
 * way real astrophotography separates magnitudes.
 *
 * Placement is the valence/arousal plane: x runs dark to bright valence,
 * y runs storming (top) to calm (bottom). Affect readings are often
 * coarse-grained, so coincident moments are scattered into small star
 * clusters by deterministic id-hash jitter. No randomness survives a
 * redraw: same sea, same sky.
 */

export interface EchoHitPoint {
  x: number;
  y: number;
  r: number;
  moment: EchoMoment;
}

export interface EchoSkyOptions {
  /** Draw the affect grid, axes, and quadrant labels. */
  showAxis: boolean;
  /** CSS font family for axis labels. */
  fontFamily: string;
}

interface PlacedStar {
  moment: EchoMoment;
  v: number;
  a: number;
  importance: number;
  heat: number;
  isEvent: boolean;
  x: number;
  y: number;
  /** "r,g,b" from the shared echoColor ramp. */
  rgb: string;
}

const PAD = Object.freeze({ l: 36, r: 16, t: 16, b: 36 });

// Airglow palette: emission red, star gold, warm white, ionized teal,
// reflection blue, dust violet. Stars keep the shared ramp color; the
// palette lives in the haze, like color lives in real nebulae.
const AIRGLOW_TINTS: readonly (readonly [number, number, number])[] = [
  [232, 96, 116],
  [255, 208, 130],
  [242, 236, 220],
  [134, 222, 198],
  [98, 138, 235],
  [158, 124, 230],
];

// Background dust grain: mostly neutral, a few warm/cool accents.
const DUST_TINTS = [
  "225,228,240", "225,228,240", "225,228,240", "236,232,222",
  "172,192,240", "172,192,240", "255,226,185", "230,122,136",
  "178,224,208", "196,178,238",
];

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

// ── Shared color ramp, as RGB channels ──
// Canvas alpha compositing wants "r,g,b"; echoColor speaks hsl(). Convert
// its output (rather than re-deriving the ramp) so 2D and 3D stay in sync.

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const HSL_RE = /hsl\((-?[\d.]+), ([\d.]+)%, ([\d.]+)%\)/;

export function echoColorRgb(valence: number, arousal: number): string {
  const match = HSL_RE.exec(echoColor(valence, arousal));
  if (!match) return "200,190,170";
  const [r, g, b] = hslToRgb(Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100);
  return `${r},${g},${b}`;
}

// ── Anti-crossing helpers for bond lines ──

function ccw(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): number {
  return (y3 - y1) * (x2 - x1) - (y2 - y1) * (x3 - x1);
}

function pointToSegDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ── The sky ──

export function drawEchoSky(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  sea: EchoSea,
  opts: EchoSkyOptions,
): EchoHitPoint[] {
  const cw = W - PAD.l - PAD.r;
  const ch = H - PAD.t - PAD.b;
  if (cw <= 0 || ch <= 0) return [];

  // Canvas-adaptive scale: 1 on a small card, up to 1.8 fullscreen.
  const scale = Math.min(Math.max(Math.min(W, H) / 420, 1), 1.8);

  // Deterministic jitter: affect readings are often coarse values, and
  // fully overlapping stars burn into one bright smudge — scatter each id
  // into a small cluster instead.
  const jitterOf = (id: string): { dx: number; dy: number } => {
    const ang = hash01(id, 1) * Math.PI * 2;
    const r = hash01(id, 2) * Math.min(cw, ch) * 0.045;
    return { dx: Math.cos(ang) * r, dy: Math.sin(ang) * r };
  };

  const stars: PlacedStar[] = [];
  for (const moment of sea.moments) {
    const v = clampValence(moment.valence);
    const a = clampArousal(moment.arousal);
    const jit = jitterOf(moment.id);
    stars.push({
      moment,
      v,
      a,
      importance: clampImportance(moment.importance),
      heat: Number.isFinite(moment.heat as number) ? clamp01(moment.heat as number) : 0.4,
      isEvent: moment.kind === "event",
      x: PAD.l + ((v + 1) / 2) * cw + jit.dx,
      y: PAD.t + (1 - a) * ch + jit.dy,
      rgb: echoColorRgb(v, a),
    });
  }
  const starById = new Map<string, PlacedStar>();
  for (const s of stars) starById.set(s.moment.id, s);

  // Glows draw with additive blending: overlaps get brighter, not muddier.
  const withGlowBlend = (draw: () => void) => {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    draw();
    ctx.restore();
  };

  // 1. Background dust field: thousands of seeded micro-stars for grain.
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const dustCount = Math.round((W * H) / 650);
  for (let i = 0; i < dustCount; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = (0.25 + rand() * 0.85) * scale;
    const tint = DUST_TINTS[Math.floor(rand() * DUST_TINTS.length)];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${tint},${(0.08 + rand() * 0.3).toFixed(3)})`;
    ctx.fill();
  }

  // 2. Airglow density field: moments binned on the affect grid, one layer
  // per palette tint so mixed neighborhoods keep distinct hues instead of
  // averaging to gray. sqrt compression + per-layer alpha cap so dense
  // regions glow without burning through.
  if (typeof document !== "undefined") {
    const GW = 30;
    const GH = 20;
    const NT = AIRGLOW_TINTS.length;
    const cnt = new Float32Array(NT * GW * GH);
    for (const s of stars) {
      const gi = Math.min(GW - 1, Math.max(0, Math.floor(((s.v + 1) / 2) * GW)));
      const gj = Math.min(GH - 1, Math.max(0, Math.floor((1 - s.a) * GH)));
      const ti = Math.floor(hash01(s.moment.id, 3) * NT) % NT;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = gi + di;
          const jj = gj + dj;
          if (ii < 0 || ii >= GW || jj < 0 || jj >= GH) continue;
          cnt[ti * GW * GH + jj * GW + ii] += di === 0 && dj === 0 ? 1 : 0.35;
        }
      }
    }
    let maxC = 0;
    for (let k = 0; k < cnt.length; k++) if (cnt[k] > maxC) maxC = cnt[k];
    if (maxC > 0) {
      const off = document.createElement("canvas");
      off.width = GW;
      off.height = GH;
      const octx = off.getContext("2d");
      if (octx) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.filter = `blur(${Math.round(Math.min(cw / GW, ch / GH) * 0.8)}px)`;
        for (let ti = 0; ti < NT; ti++) {
          octx.clearRect(0, 0, GW, GH);
          const [tr, tg, tb] = AIRGLOW_TINTS[ti];
          let any = false;
          for (let j = 0; j < GH; j++) {
            for (let i = 0; i < GW; i++) {
              const c = cnt[ti * GW * GH + j * GW + i];
              if (c <= 0) continue;
              any = true;
              const alpha = Math.sqrt(c / maxC) * 0.08;
              octx.fillStyle = `rgba(${tr},${tg},${tb},${alpha.toFixed(3)})`;
              octx.fillRect(i, j, 1, 1);
            }
          }
          if (any) ctx.drawImage(off, PAD.l - 26, PAD.t - 20, cw + 46, ch + 42);
        }
        ctx.filter = "none";
        ctx.restore();
      }
    }
  }

  // 3. Affect grid + axes.
  if (opts.showAxis) {
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= 4; x++) {
      const px = PAD.l + (cw / 4) * x;
      ctx.beginPath();
      ctx.moveTo(px, PAD.t);
      ctx.lineTo(px, PAD.t + ch);
      ctx.stroke();
    }
    for (let y = 0; y <= 4; y++) {
      const py = PAD.t + (ch / 4) * y;
      ctx.beginPath();
      ctx.moveTo(PAD.l, py);
      ctx.lineTo(PAD.l + cw, py);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    const midX = PAD.l + cw / 2;
    const botY = PAD.t + ch;
    ctx.beginPath();
    ctx.moveTo(PAD.l, botY);
    ctx.lineTo(PAD.l + cw, botY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(midX, PAD.t);
    ctx.lineTo(midX, PAD.t + ch);
    ctx.stroke();

    ctx.font = `${Math.round(9 * scale)}px ${opts.fontFamily}`;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.textAlign = "left";
    ctx.fillText("tense · anxious", PAD.l + 4, PAD.t + 14);
    ctx.fillText("down · numb", PAD.l + 4, PAD.t + ch - 4);
    ctx.textAlign = "right";
    ctx.fillText("elated · excited", PAD.l + cw - 4, PAD.t + 14);
    ctx.fillText("calm · tender", PAD.l + cw - 4, PAD.t + ch - 4);
    ctx.fillStyle = "rgba(255,255,255,0.30)";
    ctx.font = `${Math.round(8 * scale)}px ${opts.fontFamily}`;
    ctx.textAlign = "left";
    ctx.fillText("negative", PAD.l, PAD.t + ch + 14);
    ctx.textAlign = "right";
    ctx.fillText("positive", PAD.l + cw, PAD.t + ch + 14);
    ctx.fillText("calm", PAD.l - 4, PAD.t + ch);
    ctx.fillText("storm", PAD.l - 4, PAD.t + 10);
    ctx.textAlign = "left";
  }

  // 4. Local density: shared by nebula glow (dense clusters get haze) and
  // by bond drawing (lines between two dense stars would vanish in glow).
  const NEBULA_RADIUS = Math.min(cw, ch) * 0.12;
  const DENSE_THRESHOLD = 4;
  const density = new Map<string, number>();
  const neighbors = new Map<string, PlacedStar[]>();
  for (const s of stars) {
    let count = 0;
    const nb: PlacedStar[] = [];
    for (const o of stars) {
      if (o === s) continue;
      if (Math.hypot(s.x - o.x, s.y - o.y) < NEBULA_RADIUS) {
        count++;
        nb.push(o);
      }
    }
    density.set(s.moment.id, count);
    neighbors.set(s.moment.id, nb);
  }
  const isDense = (id: string) => (density.get(id) || 0) >= DENSE_THRESHOLD;

  // 5. Nebula glow around dense clusters: one soft outer envelope plus a
  // per-star halo so the cloud reads irregular, not circular.
  const usedInNebula = new Set<string>();
  for (const s of stars) {
    if (!isDense(s.moment.id) || usedInNebula.has(s.moment.id)) continue;
    const cluster = [s];
    usedInNebula.add(s.moment.id);
    for (const nb of neighbors.get(s.moment.id) || []) {
      if (!usedInNebula.has(nb.moment.id) && isDense(nb.moment.id)) {
        cluster.push(nb);
        usedInNebula.add(nb.moment.id);
      }
    }
    const cx = cluster.reduce((sum, p) => sum + p.x, 0) / cluster.length;
    const cy = cluster.reduce((sum, p) => sum + p.y, 0) / cluster.length;
    let maxR = 0;
    for (const p of cluster) {
      maxR = Math.max(maxR, Math.hypot(p.x - cx, p.y - cy));
    }
    const channels = cluster.map((p) => p.rgb.split(",").map(Number));
    const avg = channels
      .reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]])
      .map((n) => Math.round(n / channels.length));
    const [cr, cg, cb] = avg;
    const r = maxR + NEBULA_RADIUS * 0.6;
    withGlowBlend(() => {
      const outerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.5);
      outerGlow.addColorStop(0, `rgba(${cr},${cg},${cb},0.06)`);
      outerGlow.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.03)`);
      outerGlow.addColorStop(1, "transparent");
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = outerGlow;
      ctx.fill();
      for (const p of cluster) {
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, NEBULA_RADIUS * 0.5);
        halo.addColorStop(0, `rgba(${cr},${cg},${cb},0.07)`);
        halo.addColorStop(0.7, `rgba(${cr},${cg},${cb},0.02)`);
        halo.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(p.x, p.y, NEBULA_RADIUS * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = halo;
        ctx.fill();
      }
    });
  }

  // 6. Bond lines. Strong bonds are solid, medium ones dashed, weak ones
  // skipped; long reaches across the sky are skipped too. A greedy pass
  // (strongest first, then longest) enforces a per-star line budget and
  // rejects crossings, so the result reads as constellations rather than
  // a spiderweb.
  interface LineEntry {
    idA: string;
    idB: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    priority: number;
    dash: boolean;
  }
  const SOLID_MIN = 0.6;
  const DASH_MIN = 0.25;
  const MAX_LINE_DIST = Math.min(cw, ch) * 0.3;
  const MAX_LINES_PER_STAR = 2;
  const allLines: LineEntry[] = [];
  for (const bond of sea.bonds || []) {
    if (bond.source === bond.target) continue;
    const p1 = starById.get(bond.source);
    const p2 = starById.get(bond.target);
    if (!p1 || !p2) continue;
    if (isDense(bond.source) && isDense(bond.target)) continue;
    const eff = clamp01(bond.strength ?? 0.5);
    if (eff < DASH_MIN) continue;
    if (Math.hypot(p1.x - p2.x, p1.y - p2.y) > MAX_LINE_DIST) continue;
    allLines.push({
      idA: bond.source,
      idB: bond.target,
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      priority: eff,
      dash: eff < SOLID_MIN,
    });
  }

  const lineLength = (l: LineEntry) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
  allLines.sort((a, b) => b.priority - a.priority || lineLength(b) - lineLength(a));

  const sharesEndpoint = (a: LineEntry, b: LineEntry) =>
    a.idA === b.idA || a.idA === b.idB || a.idB === b.idA || a.idB === b.idB;
  const NEAR_CROSS_PX = 6;
  const segmentsCross = (a: LineEntry, b: LineEntry): boolean => {
    if (sharesEndpoint(a, b)) return false;
    const d1 = ccw(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
    const d2 = ccw(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
    const d3 = ccw(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
    const d4 = ccw(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
      return true;
    }
    // Near-parallel lines skimming each other read as a crossing too.
    return (
      pointToSegDist(a.x1, a.y1, b.x1, b.y1, b.x2, b.y2) < NEAR_CROSS_PX ||
      pointToSegDist(a.x2, a.y2, b.x1, b.y1, b.x2, b.y2) < NEAR_CROSS_PX ||
      pointToSegDist(b.x1, b.y1, a.x1, a.y1, a.x2, a.y2) < NEAR_CROSS_PX ||
      pointToSegDist(b.x2, b.y2, a.x1, a.y1, a.x2, a.y2) < NEAR_CROSS_PX
    );
  };

  const accepted: LineEntry[] = [];
  const starLineCount = new Map<string, number>();
  const visualLineCount = new Map<string, number>();
  const visualKey = (x: number, y: number) => `${Math.round(x / 20)},${Math.round(y / 20)}`;
  for (const line of allLines) {
    const cA = starLineCount.get(line.idA) || 0;
    const cB = starLineCount.get(line.idB) || 0;
    // Visual-cell budget: two stars a few pixels apart share one hub to
    // the eye, so budget by rounded position as well as by id.
    const vA = visualKey(line.x1, line.y1);
    const vB = visualKey(line.x2, line.y2);
    const vcA = visualLineCount.get(vA) || 0;
    const vcB = visualLineCount.get(vB) || 0;
    if (cA >= MAX_LINES_PER_STAR || cB >= MAX_LINES_PER_STAR) continue;
    if (vcA >= MAX_LINES_PER_STAR || vcB >= MAX_LINES_PER_STAR) continue;
    if (accepted.some((a) => segmentsCross(line, a))) continue;
    accepted.push(line);
    starLineCount.set(line.idA, cA + 1);
    starLineCount.set(line.idB, cB + 1);
    visualLineCount.set(vA, vcA + 1);
    visualLineCount.set(vB, vcB + 1);
  }

  for (const line of accepted) {
    if (line.dash) {
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = `rgba(200,190,160,${Math.min(0.18, 0.04 + (line.priority - DASH_MIN) * 0.4).toFixed(3)})`;
      ctx.lineWidth = 0.5;
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(200,190,160,${Math.min(0.25, 0.08 + (line.priority - SOLID_MIN) * 0.42).toFixed(3)})`;
      ctx.lineWidth = 0.8;
    }
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 7. Magnitude split: diffraction spikes go only to the top ~12% of the
  // sky (importance + event bonus + heat); everything else stays dust.
  const spikeScore = (s: PlacedStar) => s.importance + (s.isEvent ? 1.2 : 0) + s.heat;
  const spikeIds = new Set(
    [...stars]
      .sort((a, b) => spikeScore(b) - spikeScore(a))
      .slice(0, Math.max(12, Math.round(stars.length * 0.12)))
      .map((s) => s.moment.id),
  );

  // Orbital rings crown at most six of the heaviest moments.
  const MAX_RINGED = 6;
  const ringedIds = new Set(
    stars
      .filter((s) => s.importance >= 5)
      .sort((a, b) => b.importance + b.heat - (a.importance + a.heat))
      .slice(0, MAX_RINGED)
      .map((s) => s.moment.id),
  );

  // 8. The stars.
  const hits: EchoHitPoint[] = [];
  for (const s of stars) {
    const impLv = Math.max(2, s.importance);
    const hasSpike = spikeIds.has(s.moment.id);
    const alpha = Math.min(
      0.95,
      (0.3 + (impLv - 2) * 0.15 + (s.isEvent ? 0.1 : 0)) * (0.55 + 0.45 * s.heat),
    );
    const outer =
      (0.7 + (impLv - 2) * 0.5 + (s.isEvent ? 0.5 : 0) + (hasSpike ? 0.4 : 0)) * scale;

    if (ringedIds.has(s.moment.id)) {
      const ringR = outer * 3.5;
      ctx.strokeStyle = `rgba(${s.rgb},${(alpha * 0.35).toFixed(3)})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (hasSpike) {
      // Double diffraction spikes: thin long rays plus a thick short cross,
      // so bright stars read at a glance even inside dense fields.
      withGlowBlend(() => {
        const longLen = outer * (4.5 + s.heat * 2);
        const shortLen = outer * 2.2;
        const drawSpike = (len: number, width: number, a: number) => {
          ctx.lineWidth = width;
          for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
            const grad = ctx.createLinearGradient(
              s.x - dx * len, s.y - dy * len,
              s.x + dx * len, s.y + dy * len,
            );
            grad.addColorStop(0, "transparent");
            grad.addColorStop(0.5, `rgba(${s.rgb},${a.toFixed(3)})`);
            grad.addColorStop(1, "transparent");
            ctx.strokeStyle = grad;
            ctx.beginPath();
            ctx.moveTo(s.x - dx * len, s.y - dy * len);
            ctx.lineTo(s.x + dx * len, s.y + dy * len);
            ctx.stroke();
          }
        };
        drawSpike(longLen, Math.max(0.8, scale * 0.8), alpha * 0.55);
        drawSpike(shortLen, Math.max(1.6, scale * 1.5), alpha * 0.75);
      });
    }

    ctx.beginPath();
    ctx.arc(s.x, s.y, outer, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${s.rgb},${alpha.toFixed(3)})`;
    ctx.fill();
    if (hasSpike) {
      // Bright stars get a white-hot core with the ramp color at the rim,
      // like saturated star centers in long-exposure photographs.
      ctx.beginPath();
      ctx.arc(s.x, s.y, outer * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.9, alpha + 0.15).toFixed(3)})`;
      ctx.fill();
    }

    hits.push({ x: s.x, y: s.y, r: outer + 4, moment: s.moment });
  }

  return hits;
}
