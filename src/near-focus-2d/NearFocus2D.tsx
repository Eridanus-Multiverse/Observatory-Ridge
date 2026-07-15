import { useEffect, useMemo, useState } from "react";
import type { RidgeMemory, RidgePlanet, RidgeSnapshot } from "../core/types";
import { hash01, GOLDEN_ANGLE } from "../core/hash";

/**
 * Near Focus 2D — an SVG star-system chart.
 *
 * Concentric orbits (one per planet), an asteroid belt of unattributed
 * memories between the inner and outer families, glowing candy-colored
 * planets, and a starfield dust background. Tap a planet, the star, or the
 * belt to open a detail card. Designed for low-power devices: one SVG, a
 * 30fps clock, and a memoized dust field.
 */

export interface NearFocus2DProps {
  snapshot: RidgeSnapshot;
  /** Candy wheel for planets, assigned by orbit order. */
  palette?: string[];
  background?: string;
  fontFamily?: string;
  onSelect?: (selection: { kind: "star" | "planet" | "belt"; planet?: RidgePlanet } | null) => void;
}

const CANDY_WHEEL = [
  "#ff6d8a", "#ffb26b", "#ffd166", "#c5e05a", "#6fe6a3", "#3ed3ff",
  "#5aa9ff", "#8f7ff5", "#c98bf5", "#f48fce", "#ff8a65", "#7fd8c8",
];

const LAYOUT = Object.freeze({
  viewMinX: -16,
  viewMinY: 0,
  viewWidth: 392,
  viewHeight: 410,
  centerX: 180,
  centerY: 200,
  innerCount: 8,
  beltInner: 110,
  beltOuter: 124,
  outerMaxRadius: 175.5,
});

export function orbitRadius(index: number, planetCount: number): number {
  const inner = LAYOUT.innerCount;
  if (index < inner) return 44 + index * 9;
  const outerCount = Math.max(1, planetCount - inner);
  const step = Math.min(6.5, (LAYOUT.outerMaxRadius - 130) / Math.max(1, outerCount - 1));
  return 130 + (index - inner) * step;
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round((((pa >> shift) & 255) * (1 - t)) + (((pb >> shift) & 255) * t));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

// Starfield dust: LCG-seeded, ten subtle tints — the "galaxy grain" backdrop.
const DUST_TINTS = [
  "225,228,240", "225,228,240", "225,228,240", "236,232,222",
  "172,192,240", "172,192,240", "255,226,185", "230,122,136",
  "178,224,208", "196,178,238",
];
const DUST_FIELD = (() => {
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const n = Math.round((LAYOUT.viewWidth * LAYOUT.viewHeight) / 400);
  return Array.from({ length: n }, () => ({
    x: LAYOUT.viewMinX + rand() * LAYOUT.viewWidth,
    y: LAYOUT.viewMinY + rand() * LAYOUT.viewHeight,
    r: 0.25 + rand() * 0.85,
    fill: `rgba(${DUST_TINTS[Math.floor(rand() * DUST_TINTS.length)]},${(0.1 + rand() * 0.34).toFixed(3)})`,
  }));
})();

function useClock(fps = 30, active = true) {
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 1000 / fps) {
        last = t;
        setFrame((v) => (v + 1) % 100000);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps, active]);
  return typeof performance !== "undefined" ? performance.now() : 0;
}

export default function NearFocus2D({
  snapshot,
  palette = CANDY_WHEEL,
  background = "#020408",
  fontFamily = "ui-monospace, monospace",
  onSelect,
}: NearFocus2DProps) {
  const clockTick = useClock(30, true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const t = clockTick / 1000;
  const flare = (Math.sin(t * 0.7) + 1) / 2;
  const { centerX: CX, centerY: CY } = LAYOUT;

  const planets = useMemo(() => {
    const ranked = [...snapshot.planets].sort((a, b) => a.rank - b.rank);
    const maxCount = Math.max(1, ...ranked.map((p) => p.memoryCount));
    return ranked.map((planet, i) => {
      const rx = orbitRadius(i, ranked.length);
      return {
        planet,
        orbit: i,
        rx,
        color: palette[i % palette.length],
        r: 3.2 + Math.min((planet.memoryCount / maxCount) * 3, 3),
        phase: hash01(planet.id, 17) * Math.PI * 2 + i * GOLDEN_ANGLE,
        speed: 15 / Math.pow(rx, 1.5),
      };
    });
  }, [snapshot, palette]);

  // Belt: real unattributed memories plus decorative filler so the ring reads
  // as a band even with sparse data.
  const dust = useMemo(() => {
    const ring = (id: string, salt: number, sizeBase: number, opacityBase: number) => {
      const angle = hash01(id, 29 + salt) * Math.PI * 2;
      const radial = LAYOUT.beltInner + hash01(id, 31 + salt) * (LAYOUT.beltOuter - LAYOUT.beltInner);
      return {
        x: CX + Math.cos(angle) * radial,
        y: CY + Math.sin(angle) * radial,
        r: sizeBase + hash01(id, 37 + salt) * sizeBase * 1.3,
        opacity: opacityBase + hash01(id, 41 + salt) * 0.22,
        color: hash01(id, 43 + salt) < 0.5 ? "#c8a37a" : "#8fa3bd",
      };
    };
    return [
      ...Array.from({ length: 90 }, (_, i) => ring(`belt-fill-${i}`, 7, 0.35, 0.13)),
      ...snapshot.asteroids.map((m) => ring(m.id, 0, 0.5, 0.24)),
      ...Array.from({ length: 8 }, (_, i) => ring(`belt-rock-${i}`, 13, 1.15, 0.3)),
    ];
  }, [snapshot, CX, CY]);

  const dustFieldEl = useMemo(() => (
    <g pointerEvents="none">
      {DUST_FIELD.map((dot, i) => (
        <circle key={`df-${i}`} cx={dot.x} cy={dot.y} r={dot.r} fill={dot.fill} />
      ))}
    </g>
  ), []);

  const starSelected = selectedId === "star";
  const beltSelected = selectedId === "belt";
  const selectedPlanet = planets.find((p) => p.planet.id === selectedId) || null;

  const select = (next: string | null) => {
    setSelectedId(next);
    if (!onSelect) return;
    if (next === null) onSelect(null);
    else if (next === "star") onSelect({ kind: "star" });
    else if (next === "belt") onSelect({ kind: "belt" });
    else {
      const hit = planets.find((p) => p.planet.id === next);
      if (hit) onSelect({ kind: "planet", planet: hit.planet });
    }
  };

  const memoryDate = (m: RidgeMemory) => m.date || "";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background, fontFamily, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <svg
          width="100%"
          height="100%"
          viewBox={`${LAYOUT.viewMinX} ${LAYOUT.viewMinY} ${LAYOUT.viewWidth} ${LAYOUT.viewHeight}`}
          style={{ display: "block" }}
          onClick={() => select(null)}
        >
          <defs>
            <radialGradient id="or2d-sun" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="25%" stopColor="#fff5d4" stopOpacity="0.95" />
              <stop offset="50%" stopColor="#ffc24a" stopOpacity="0.7" />
              <stop offset="75%" stopColor="#f4511e" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#7a2503" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="or2d-corona" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffd77a" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#ffd77a" stopOpacity="0" />
            </radialGradient>
            {/* PITFALL: default SVG filter regions clip wide blurs into boxes. */}
            <filter id="or2d-blur-lg" x="-70%" y="-70%" width="240%" height="240%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
            <filter id="or2d-blur-sm" x="-70%" y="-70%" width="240%" height="240%">
              <feGaussianBlur stdDeviation="2.5" />
            </filter>
            {/* Glowing-orb planet gradient: white-hot core, solid color body,
                only the outer rim melts away. Mid-gradient opacity steps read
                as plastic bands — keep the falloff continuous. */}
            {planets.map(({ planet, orbit, color }) => (
              <radialGradient key={`pg-${planet.id}`} id={`or2d-pg-${orbit}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="26%" stopColor="#ffffff" />
                <stop offset="44%" stopColor={mixHex(color, "#ffffff", 0.2)} />
                <stop offset="62%" stopColor={color} stopOpacity="0.92" />
                <stop offset="82%" stopColor={color} stopOpacity="0.3" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </radialGradient>
            ))}
          </defs>

          {dustFieldEl}

          {/* Orbits: sparse dotted circles; a selected orbit becomes solid. */}
          {planets.map(({ planet, rx }) => {
            const isSelected = planet.id === selectedId;
            return (
              <circle
                key={`orbit-${planet.id}`}
                pointerEvents="none"
                cx={CX} cy={CY} r={rx}
                fill="none"
                stroke={isSelected ? "rgba(255,216,146,0.5)" : "rgba(200,216,240,0.14)"}
                strokeWidth={isSelected ? 0.8 : 0.6}
                strokeDasharray={isSelected ? undefined : "0.7 5.8"}
                strokeLinecap="round"
              />
            );
          })}

          {/* Asteroid belt (clickable as one body). */}
          <g pointerEvents="none" opacity={beltSelected ? 1 : 0.82 + Math.sin(t * 0.4) * 0.14}>
            {dust.map((dot, i) => (
              <circle key={`dust-${i}`} cx={dot.x} cy={dot.y} r={beltSelected ? dot.r * 1.25 : dot.r} fill={dot.color} opacity={beltSelected ? Math.min(1, dot.opacity * 2) : dot.opacity} />
            ))}
          </g>
          <circle
            cx={CX} cy={CY} r={(LAYOUT.beltInner + LAYOUT.beltOuter) / 2}
            fill="none" stroke="rgba(0,0,0,0)"
            strokeWidth={LAYOUT.beltOuter - LAYOUT.beltInner + 8}
            pointerEvents="stroke"
            style={{ cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); select(beltSelected ? null : "belt"); }}
          />
          {beltSelected && (
            <g pointerEvents="none">
              <circle cx={CX} cy={CY} r={LAYOUT.beltInner - 2.5} fill="none" stroke="rgba(255,216,146,0.5)" strokeWidth={0.7} strokeDasharray="3 4" />
              <circle cx={CX} cy={CY} r={LAYOUT.beltOuter + 2.5} fill="none" stroke="rgba(255,216,146,0.5)" strokeWidth={0.7} strokeDasharray="3 4" />
            </g>
          )}

          {/* Sun. */}
          <circle pointerEvents="none" cx={CX} cy={CY} r={92 + flare * 10} fill="url(#or2d-corona)" opacity={0.55} />
          <circle pointerEvents="none" cx={CX} cy={CY} r={58 + flare * 8} fill="url(#or2d-corona)" />
          <g
            onClick={(e) => { e.stopPropagation(); select(starSelected ? null : "star"); }}
            style={{ cursor: "pointer" }}
          >
            <circle cx={CX} cy={CY} r={32} fill="url(#or2d-sun)" />
            <circle cx={CX} cy={CY} r={20 + flare * 4} fill="#fff8e1" opacity={0.35} filter="url(#or2d-blur-lg)" />
            <circle cx={CX} cy={CY} r={12 + flare * 2} fill="#fff" opacity={0.8} filter="url(#or2d-blur-sm)" />
            {starSelected && (
              <circle cx={CX} cy={CY} r={37} fill="none" stroke="#d9e8ff" strokeWidth={0.8} strokeDasharray="3 4" opacity={0.85} />
            )}
          </g>

          {/* Planets: glowing orbs, name shown only when selected. */}
          {planets.map(({ planet, orbit, rx, r, phase, speed, color }) => {
            const angle = phase + t * speed;
            const sx = CX + Math.cos(angle) * rx;
            const sy = CY + Math.sin(angle) * rx;
            const isSelected = planet.id === selectedId;
            return (
              <g
                key={planet.id}
                onClick={(e) => { e.stopPropagation(); select(isSelected ? null : planet.id); }}
                style={{ cursor: "pointer" }}
              >
                <circle cx={sx} cy={sy} r={15} fill="rgba(0,0,0,0)" />
                <circle
                  cx={sx} cy={sy} r={r * 1.5}
                  fill={`url(#or2d-pg-${orbit})`}
                  opacity={0.95 + Math.sin(clockTick * 0.0018 + phase * 7) * 0.05}
                />
                {isSelected && (
                  <>
                    <circle cx={sx} cy={sy} r={r + 4} fill="none" stroke="#d9e8ff" strokeWidth={0.7} strokeDasharray="2.5 3" opacity={0.85} />
                    <text x={sx} y={sy - r - 7} textAnchor="middle" style={{ fontSize: 8, fill: "#fff", paintOrder: "stroke", stroke: background, strokeWidth: 2.5 }}>
                      {planet.name}
                    </text>
                  </>
                )}
                <circle cx={sx} cy={sy} r={r * 3.4} fill={color} opacity={0.06} pointerEvents="none" />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Detail card. */}
      <div style={{ borderTop: "1px solid rgba(255,223,146,0.12)", background: "rgba(2,4,8,0.9)", padding: "8px 14px 10px", minHeight: 72, color: "#cdd8ea", fontSize: 11 }}>
        {selectedPlanet ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 6, height: 14, background: selectedPlanet.color, display: "inline-block" }} />
              <span style={{ color: "#efede6", fontSize: 12 }}>{selectedPlanet.planet.name}</span>
              <span style={{ marginLeft: "auto", opacity: 0.55, fontSize: 9 }}>{selectedPlanet.planet.memoryCount} memories</span>
            </div>
            {selectedPlanet.planet.definition && (
              <div style={{ marginTop: 5, opacity: 0.8, lineHeight: 1.5 }}>{selectedPlanet.planet.definition}</div>
            )}
            {(selectedPlanet.planet.memories || []).slice(0, 3).map((m) => (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 5 }}>
                <span style={{ opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
                <span style={{ opacity: 0.4, flexShrink: 0, fontSize: 9 }}>{memoryDate(m)}</span>
              </div>
            ))}
          </>
        ) : starSelected ? (
          <>
            <div style={{ color: "#efede6", fontSize: 12 }}>{snapshot.star.name}</div>
            {snapshot.star.definition && <div style={{ marginTop: 5, opacity: 0.8 }}>{snapshot.star.definition}</div>}
          </>
        ) : beltSelected ? (
          <>
            <div style={{ color: "#efede6", fontSize: 12 }}>Asteroid belt</div>
            <div style={{ marginTop: 5, opacity: 0.8 }}>{snapshot.asteroids.length} unattributed memories drifting here.</div>
          </>
        ) : (
          <div style={{ opacity: 0.5 }}>
            {snapshot.planets.length} planets · {snapshot.asteroids.length} drifting memories — tap anything.
          </div>
        )}
      </div>
    </div>
  );
}
