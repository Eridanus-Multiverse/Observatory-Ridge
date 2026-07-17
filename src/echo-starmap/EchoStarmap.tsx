import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { EchoMoment, EchoSea } from "../core/emotion-types.js";
import { echoColor } from "../core/emotion-types.js";
import type { EchoHitPoint } from "./echoStarmapCore.js";
import { drawEchoSky } from "./echoStarmapCore.js";

/**
 * Echo Starmap — a canvas full-sky chart of an EchoSea.
 *
 * Every moment becomes a star on the affect grid (valence right, arousal
 * up), colored by the shared echoColor ramp so it matches the 3D renderer.
 * Dense neighborhoods grow nebula haze, bonds draw constellation-like
 * lines, and an "Axes" toggle reveals the underlying grid. Hover (or tap)
 * a star for its label and date; clicks report through `onSelect`.
 *
 * Renders purely from props — no fetching, no timers. Redraws are
 * rAF-coalesced: resize, data, and toggle changes arriving in one frame
 * cost a single full-sky pass.
 */

export interface EchoStarmapProps {
  sea: EchoSea;
  /** Component height: px number or CSS size; defaults to filling the parent. */
  height?: number | string;
  fontFamily?: string;
  /** Fired on click/tap: the hit moment, or null for empty sky. */
  onSelect?: (moment: EchoMoment | null) => void;
}

interface TooltipState {
  text: string;
  sub: string;
  x: number;
  y: number;
  /** Anchor the card to the left of the cursor near the right edge. */
  flip: boolean;
}

const SKY_BACKGROUND = "#05060f";
const BAR_BACKGROUND = "rgba(8,9,26,0.85)";
const HAIRLINE = "1px solid rgba(200,216,240,0.08)";

// Valence sweep sampled from the shared ramp, dark to blazing.
const LEGEND = [
  { label: "low", v: -0.9, a: 0.55 },
  { label: "calm", v: -0.35, a: 0.45 },
  { label: "tender", v: 0.15, a: 0.5 },
  { label: "fond", v: 0.55, a: 0.6 },
  { label: "ablaze", v: 0.95, a: 0.75 },
];

const dateLabel = (moment: EchoMoment) => moment.date.slice(0, 10);

export default function EchoStarmap({
  sea,
  height = "100%",
  fontFamily = "ui-monospace, monospace",
  onSelect,
}: EchoStarmapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const skyRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitsRef = useRef<EchoHitPoint[]>([]);
  const [showAxis, setShowAxis] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const bondCount = useMemo(() => {
    const ids = new Set(sea.moments.map((m) => m.id));
    return (sea.bonds || []).filter(
      (b) => b.source !== b.target && ids.has(b.source) && ids.has(b.target),
    ).length;
  }, [sea]);

  const drawNow = useCallback(() => {
    const canvas = canvasRef.current;
    const sky = skyRef.current;
    if (!canvas || !sky) return;
    const W = sky.clientWidth;
    const H = sky.clientHeight;
    if (W <= 0 || H <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = SKY_BACKGROUND;
    ctx.fillRect(0, 0, W, H);
    hitsRef.current = drawEchoSky(ctx, W, H, sea, { showAxis, fontFamily });
  }, [sea, showAxis, fontFamily]);

  // rAF-coalesced redraw: mount fires resize + data + toggle draws
  // back-to-back, and the full sky pass (dust field + airglow density) is
  // the expensive part — collapse them into one frame.
  const drawNowRef = useRef(drawNow);
  const drawQueuedRef = useRef(false);
  const scheduleDraw = useCallback(() => {
    if (drawQueuedRef.current) return;
    drawQueuedRef.current = true;
    requestAnimationFrame(() => {
      drawQueuedRef.current = false;
      drawNowRef.current();
    });
  }, []);

  useEffect(() => {
    drawNowRef.current = drawNow;
    scheduleDraw();
  }, [drawNow, scheduleDraw]);

  useEffect(() => {
    const sky = skyRef.current;
    if (!sky) return;
    const observer = new ResizeObserver(scheduleDraw);
    observer.observe(sky);
    return () => observer.disconnect();
  }, [scheduleDraw]);

  const hitAt = (clientX: number, clientY: number): EchoHitPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    return hitsRef.current.find((p) => Math.hypot(p.x - mx, p.y - my) <= p.r + 4) ?? null;
  };

  const tooltipFor = (hit: EchoHitPoint, clientX: number, clientY: number): TooltipState => {
    const rootRect = rootRef.current?.getBoundingClientRect();
    const left = rootRect ? rootRect.left : 0;
    const top = rootRect ? rootRect.top : 0;
    const width = rootRect ? rootRect.width : Infinity;
    const flip = clientX - left > width * 0.6;
    const v = hit.moment.valence;
    const a = hit.moment.arousal;
    return {
      text: hit.moment.label || "moment",
      sub: `${dateLabel(hit.moment)} · V ${v >= 0 ? "+" : ""}${v.toFixed(2)} · A ${a.toFixed(2)}`,
      x: clientX - left + (flip ? -12 : 12),
      y: clientY - top - 10,
      flip,
    };
  };

  // Dedup by star: a fresh tooltip object per pixel would re-render the
  // tree while sweeping across hundreds of stars.
  const lastHitIdRef = useRef<string | null>(null);
  const handleMouseMove = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const hit = hitAt(event.clientX, event.clientY);
    const key = hit ? hit.moment.id : null;
    if (key === lastHitIdRef.current) return;
    lastHitIdRef.current = key;
    setTooltip(hit ? tooltipFor(hit, event.clientX, event.clientY) : null);
  };
  const handleMouseLeave = () => {
    lastHitIdRef.current = null;
    setTooltip(null);
  };
  const handleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const hit = hitAt(event.clientX, event.clientY);
    // Show the tooltip on tap too — touch devices never hover.
    lastHitIdRef.current = hit ? hit.moment.id : null;
    setTooltip(hit ? tooltipFor(hit, event.clientX, event.clientY) : null);
    onSelect?.(hit ? hit.moment : null);
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        width: "100%",
        height,
        background: SKY_BACKGROUND,
        fontFamily,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        color: "#cdd8ea",
      }}
    >
      {/* Header: sky census + axis toggle. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "6px 10px",
          background: BAR_BACKGROUND,
          borderBottom: HAIRLINE,
        }}
      >
        <span style={{ fontSize: 11, color: "#efede6" }}>
          {sea.moments.length} moments · {bondCount} bonds
        </span>
        <button
          type="button"
          onClick={() => setShowAxis((prev) => !prev)}
          aria-pressed={showAxis}
          style={{
            fontFamily,
            fontSize: 9,
            padding: "2px 7px",
            cursor: "pointer",
            borderRadius: 3,
            border: `1px solid ${showAxis ? "rgba(255,223,146,0.35)" : "rgba(200,216,240,0.2)"}`,
            background: showAxis ? "rgba(255,223,146,0.12)" : "transparent",
            color: showAxis ? "rgba(255,223,146,0.7)" : "rgba(200,216,240,0.4)",
          }}
        >
          Axes
        </button>
      </div>

      {/* The sky. */}
      <div ref={skyRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Echo starmap of ${sea.moments.length} moments`}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "block",
            cursor: "crosshair",
          }}
        />
      </div>

      {/* Spectral legend: valence low to high on the shared ramp. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: "5px 10px",
          background: BAR_BACKGROUND,
          borderTop: HAIRLINE,
        }}
      >
        {LEGEND.map((entry) => (
          <span key={entry.label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: echoColor(entry.v, entry.a),
                display: "inline-block",
              }}
            />
            <span style={{ fontSize: 9, color: "rgba(200,216,240,0.5)" }}>{entry.label}</span>
          </span>
        ))}
      </div>

      {/* Tooltip. */}
      {tooltip && (
        <div
          style={{
            position: "absolute",
            left: tooltip.x,
            top: tooltip.y,
            transform: tooltip.flip ? "translateX(-100%)" : undefined,
            background: "rgba(12,13,34,0.95)",
            border: "1px solid rgba(60,90,140,0.6)",
            padding: "4px 8px",
            maxWidth: 260,
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <div style={{ fontSize: 11, color: "#efede6" }}>{tooltip.text}</div>
          <div style={{ fontSize: 9, color: "rgba(200,216,240,0.5)", marginTop: 1 }}>
            {tooltip.sub}
          </div>
        </div>
      )}
    </div>
  );
}
