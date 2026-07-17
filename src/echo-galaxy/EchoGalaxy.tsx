import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import type { EchoMoment, EchoSea } from "../core/emotion-types.js";
import { clampArousal, clampImportance, clampValence, echoColorRGB } from "../core/emotion-types.js";
import { hash01 } from "../core/hash.js";
import {
  clampHeat,
  echoScore,
  layoutMoments,
  normalizedBonds,
  type LayoutMoment,
  type NormalizedBond,
} from "./layout.js";

/**
 * Echo Galaxy — how the days felt, as a night sky.
 *
 * Every moment is a star: valence picks the hue (shared `echoColor` ramp, so
 * the 2D Echo view agrees), arousal drives brightness, importance drives
 * size, heat adds an ember bonus and a slow pulse on the top stars. Bonds
 * render as faint ties. Very dark storms (valence < -0.5, arousal > 0.6)
 * collapse into black wells with dim accretion rings.
 *
 * Scope note (matches NearFocus3D): no post-processing bloom. The glow is
 * layered additive sprites — a hot core over soft halos — which keeps the
 * production look without a composer or an extra peer dependency.
 */

export interface EchoGalaxyProps {
  sea: EchoSea;
  /** Font stack for the in-scene labels. */
  fontFamily?: string;
  /** Called when a moment is selected (null on empty-space click). Render
   * your own detail card from this — the scene marks selection with a glow. */
  onSelect?: (moment: EchoMoment | null) => void;
}

const BACKGROUND = "#04030a";
const LABEL_COUNT = 5;
const FLARE_COUNT = 36; // hard cap; the actual tier scales with population below

/**
 * Soft round sprite with a tight bright core. PITFALL: untextured Points
 * render as hard squares, and mipmapped gradients smear color specks into
 * the center when magnified — so no mipmaps, linear filtering.
 */
function makeDotSprite(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.08, "rgba(255,255,255,0.85)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.4)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.12)");
  gradient.addColorStop(0.8, "rgba(255,255,255,0.02)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/** Shared hue for a moment — the upstream valence/arousal ramp, verbatim. */
function momentColor(moment: { valence: number; arousal: number }): THREE.Color {
  const [r, g, b] = echoColorRGB(moment.valence, moment.arousal);
  return new THREE.Color(r, g, b);
}

function isDarkWell(moment: EchoMoment): boolean {
  return clampValence(moment.valence) < -0.5 && clampArousal(moment.arousal) > 0.6;
}

function momentLabel(moment: EchoMoment): string {
  return moment.label || moment.date.slice(0, 10);
}

const byScoreDesc = (a: EchoMoment, b: EchoMoment) => (
  echoScore(b) - echoScore(a) || (a.id < b.id ? -1 : 1)
);

/** Deterministic backdrop starfield: dim dust plus a few tinted accents. */
function BackgroundStars({ sprite }: { sprite: THREE.Texture }) {
  const dim = useMemo(() => {
    const n = 1600;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const key = `bg-${i}`;
      const r = 240 + hash01(key, 1) * 560;
      const theta = hash01(key, 2) * Math.PI * 2;
      const phi = Math.acos(2 * hash01(key, 3) - 1);
      pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      pos[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r;
      pos[i * 3 + 2] = Math.cos(phi) * r;
      const b = 0.2 + hash01(key, 4) * 0.4;
      col[i * 3] = b * 0.85; col[i * 3 + 1] = b * 0.88; col[i * 3 + 2] = b;
    }
    return { pos, col };
  }, []);

  const accents = useMemo(() => {
    const n = 180;
    const palette: Array<[number, number, number]> = [
      [0.75, 0.85, 1.0], [0.9, 0.95, 1.0], [1.0, 1.0, 0.95],
      [1.0, 0.98, 0.85], [1.0, 0.85, 0.65], [1.0, 0.7, 0.55],
    ];
    const pos = new Float32Array(n * 3);
    const halo = new Float32Array(n * 3);
    const core = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const key = `accent-${i}`;
      const r = 220 + hash01(key, 5) * 600;
      const theta = hash01(key, 6) * Math.PI * 2;
      const phi = Math.acos(2 * hash01(key, 7) - 1);
      pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      pos[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r;
      pos[i * 3 + 2] = Math.cos(phi) * r;
      const pick = palette[Math.floor(hash01(key, 8) * palette.length) % palette.length];
      const haloB = 0.6 + hash01(key, 9) * 0.5;
      halo[i * 3] = haloB * pick[0]; halo[i * 3 + 1] = haloB * pick[1]; halo[i * 3 + 2] = haloB * pick[2];
      const coreB = 1.2 + hash01(key, 10) * 0.9;
      core[i * 3] = coreB; core[i * 3 + 1] = coreB; core[i * 3 + 2] = coreB;
    }
    return { pos, halo, core };
  }, []);

  return (
    <>
      <points raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dim.pos, 3]} />
          <bufferAttribute attach="attributes-color" args={[dim.col, 3]} />
        </bufferGeometry>
        <pointsMaterial vertexColors size={0.9} sizeAttenuation transparent opacity={0.7} depthWrite={false} />
      </points>
      <points raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[accents.pos, 3]} />
          <bufferAttribute attach="attributes-color" args={[accents.halo, 3]} />
        </bufferGeometry>
        <pointsMaterial map={sprite} vertexColors size={2.4} sizeAttenuation transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <points raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[accents.pos, 3]} />
          <bufferAttribute attach="attributes-color" args={[accents.core, 3]} />
        </bufferGeometry>
        <pointsMaterial map={sprite} vertexColors size={0.9} sizeAttenuation transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </>
  );
}

/**
 * The moment cloud: a valence-tinted halo layer under a near-white core
 * layer (production's two-pass glow). PointsMaterial has one size per draw,
 * so moments are bucketed by importance — five sizes, ten draw calls max.
 */
/** Pixel-mode square sprite, upstream style: one solid block, rest transparent. */
function makePixelSprite(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(4, 4, 8, 8);
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

function MomentPoints({ moments, sprite, pixel }: { moments: LayoutMoment[]; sprite: THREE.Texture; pixel: boolean }) {
  const buckets = useMemo(() => {
    const byImportance = new Map<number, LayoutMoment[]>();
    for (const moment of moments) {
      const importance = clampImportance(moment.importance);
      if (!byImportance.has(importance)) byImportance.set(importance, []);
      byImportance.get(importance)!.push(moment);
    }
    return [...byImportance.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([importance, group]) => {
        const pos = new Float32Array(group.length * 3);
        const halo = new Float32Array(group.length * 3);
        const core = new Float32Array(group.length * 3);
        group.forEach((moment, i) => {
          pos[i * 3] = moment.x; pos[i * 3 + 1] = moment.y; pos[i * 3 + 2] = moment.z;
          const color = momentColor(moment);
          const arousal = clampArousal(moment.arousal);
          const heat = clampHeat(moment.heat);
          // Halo: emotion hue; arousal is the emissive driver, heat an ember bonus.
          // "memory" moments render a touch softer than diary-like "event"s.
          const soften = moment.kind === "memory" ? 0.85 : 1;
          const haloB = (0.55 + arousal * 0.55 + heat * 0.3) * soften;
          halo[i * 3] = color.r * haloB; halo[i * 3 + 1] = color.g * haloB; halo[i * 3 + 2] = color.b * haloB;
          // Core: mostly white with a 15% hue tint so cool stars keep a cool heart.
          const coreB = 1.1 + arousal * 0.9 + heat * 0.5;
          core[i * 3] = coreB * (0.85 + color.r * 0.15);
          core[i * 3 + 1] = coreB * (0.85 + color.g * 0.15);
          core[i * 3 + 2] = coreB * (0.85 + color.b * 0.15);
        });
        return { importance, pos, halo, core };
      });
  }, [moments]);

  const pixelSprite = useMemo(() => (pixel ? makePixelSprite() : null), [pixel]);
  useEffect(() => () => pixelSprite?.dispose(), [pixelSprite]);

  if (pixel && pixelSprite) {
    // Upstream pixel face: one flat square layer per moment, no halo, no
    // additive stacking — the quiet retro version of the same sky.
    return (
      <>
        {buckets.map((bucket) => (
          <points key={bucket.importance} raycast={() => null}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[bucket.pos, 3]} />
              <bufferAttribute attach="attributes-color" args={[bucket.halo, 3]} />
            </bufferGeometry>
            <pointsMaterial map={pixelSprite} vertexColors size={1.6 + bucket.importance * 0.4} sizeAttenuation transparent opacity={1} depthWrite={false} alphaTest={0.4} />
          </points>
        ))}
      </>
    );
  }

  return (
    <>
      {buckets.map((bucket) => {
        const haloSize = 2.4 + bucket.importance * 0.55;
        return (
          <group key={bucket.importance}>
            <points raycast={() => null}>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[bucket.pos, 3]} />
                <bufferAttribute attach="attributes-color" args={[bucket.halo, 3]} />
              </bufferGeometry>
              <pointsMaterial map={sprite} vertexColors size={haloSize} sizeAttenuation transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
            </points>
            <points raycast={() => null}>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[bucket.pos, 3]} />
                <bufferAttribute attach="attributes-color" args={[bucket.core, 3]} />
              </bufferGeometry>
              <pointsMaterial map={sprite} vertexColors size={haloSize * 0.42} sizeAttenuation transparent depthWrite={false} blending={THREE.AdditiveBlending} />
            </points>
          </group>
        );
      })}
    </>
  );
}

/** Bonds as faint ties, each end tinted by its moment's hue. */
/**
 * Flares: the brightest moments (importance*10 + heat) get layered sprite
 * halos — the sprite stand-in for bloom — with a slow heat-driven pulse.
 */
function Flares({ moments, sprite, glow }: { moments: LayoutMoment[]; sprite: THREE.Texture; glow: boolean }) {
  const groups = useRef(new Map<string, THREE.Group>());
  const phases = useMemo(
    () => new Map(moments.map((moment) => [moment.id, hash01(moment.id, 17) * Math.PI * 2])),
    [moments],
  );
  useFrame(({ clock }) => {
    if (!glow) return; // upstream pixel face does not pulse
    const t = clock.elapsedTime;
    for (const moment of moments) {
      const group = groups.current.get(moment.id);
      if (!group) continue;
      const heat = clampHeat(moment.heat);
      group.scale.setScalar(1 + heat * 0.07 * Math.sin(t * (1.1 + heat) + phases.get(moment.id)!));
    }
  });
  if (!glow) {
    // Upstream neutron-star pixel face: a faint additive orb and one flat ring.
    return (
      <>
        {moments.map((moment) => {
          const color = momentColor(moment);
          return (
            <group key={moment.id} position={[moment.x, moment.y, moment.z]}>
              <mesh raycast={() => null}>
                <sphereGeometry args={[0.6, 12, 12]} />
                <meshBasicMaterial color={new THREE.Color(color.r * 1.5, color.g * 1.5, color.b * 1.5)} transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} />
              </mesh>
              <mesh raycast={() => null}>
                <ringGeometry args={[1.2, 1.5, 32]} />
                <meshBasicMaterial color={color} transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
            </group>
          );
        })}
      </>
    );
  }

  return (
    <>
      {moments.map((moment) => {
        const color = momentColor(moment);
        const importance = clampImportance(moment.importance);
        const core = 0.75 + importance * 0.13;
        return (
          <group
            key={moment.id}
            position={[moment.x, moment.y, moment.z]}
            ref={(group: THREE.Group | null) => {
              if (group) groups.current.set(moment.id, group);
              else groups.current.delete(moment.id);
            }}
          >
            <sprite scale={[core, core, 1]} raycast={() => null}>
              <spriteMaterial map={sprite} color={new THREE.Color(1.6 + color.r * 0.8, 1.6 + color.g * 0.8, 1.6 + color.b * 0.8)} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
            </sprite>
            <sprite scale={[core * 3.2, core * 3.2, 1]} raycast={() => null}>
              <spriteMaterial map={sprite} color={new THREE.Color(color.r * 1.6, color.g * 1.6, color.b * 1.6)} transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} />
            </sprite>
            <sprite scale={[core * 5.5, core * 5.5, 1]} raycast={() => null}>
              <spriteMaterial map={sprite} color={color} transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} />
            </sprite>
          </group>
        );
      })}
    </>
  );
}

/**
 * Dark wells: very negative, high-arousal moments collapse — an absolutely
 * black core with tilted, low-saturation rings. No additive blending here
 * on purpose; a black hole that glows is just a purple star.
 */
function DarkWells({ moments, glow }: { moments: LayoutMoment[]; glow: boolean }) {
  if (!moments.length) return null;
  if (!glow) {
    // Upstream black-hole pixel face: a small black orb and a dim violet torus.
    return (
      <>
        {moments.map((moment) => (
          <group key={moment.id} position={[moment.x, moment.y, moment.z]}>
            <mesh raycast={() => null}>
              <sphereGeometry args={[0.4, 12, 12]} />
              <meshBasicMaterial color="#000000" transparent opacity={0.9} />
            </mesh>
            <mesh raycast={() => null}>
              <torusGeometry args={[1.8, 0.15, 8, 32]} />
              <meshBasicMaterial color={new THREE.Color(0.4, 0.3, 0.8)} transparent opacity={0.15} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
          </group>
        ))}
      </>
    );
  }
  return (
    <>
      {moments.map((moment) => {
        const tilt = Math.PI * (0.28 + hash01(moment.id, 53) * 0.15);
        const rotY = hash01(moment.id, 59) * Math.PI;
        return (
          <group key={moment.id} position={[moment.x, moment.y, moment.z]}>
            <mesh raycast={() => null}>
              <sphereGeometry args={[0.85, 24, 24]} />
              <meshBasicMaterial color="#000000" depthWrite />
            </mesh>
            <group rotation={[tilt, rotY, 0]}>
              <mesh raycast={() => null}>
                <ringGeometry args={[0.9, 1.15, 64]} />
                <meshBasicMaterial color={new THREE.Color(0.36, 0.34, 0.42)} transparent opacity={0.5} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
              <mesh raycast={() => null}>
                <ringGeometry args={[1.15, 1.55, 64]} />
                <meshBasicMaterial color={new THREE.Color(0.24, 0.24, 0.3)} transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
              <mesh raycast={() => null}>
                <ringGeometry args={[1.55, 2.1, 64]} />
                <meshBasicMaterial color={new THREE.Color(0.16, 0.16, 0.22)} transparent opacity={0.18} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
            </group>
          </group>
        );
      })}
    </>
  );
}

/** Sprite halo pinned to the hovered or selected moment. */
function HighlightGlow({ moment, sprite, strong }: {
  moment: LayoutMoment;
  sprite: THREE.Texture;
  strong: boolean;
}) {
  const color = momentColor(moment);
  const scale = strong ? 1 : 0.55;
  return (
    <group position={[moment.x, moment.y, moment.z]}>
      <sprite scale={[6 * scale, 6 * scale, 1]} raycast={() => null}>
        <spriteMaterial map={sprite} color={new THREE.Color(color.r * 1.4, color.g * 1.4, color.b * 1.4)} transparent opacity={strong ? 0.55 : 0.4} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite scale={[11 * scale, 11 * scale, 1]} raycast={() => null}>
        <spriteMaterial map={sprite} color={color} transparent opacity={strong ? 0.22 : 0.14} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </group>
  );
}

function MomentLabels({ labeled, selected, fontFamily }: {
  labeled: LayoutMoment[];
  selected: LayoutMoment | null;
  fontFamily: string;
}) {
  const visible = selected ? [selected] : labeled;
  return (
    <>
      {visible.map((moment) => {
        const isSel = moment.id === selected?.id;
        return (
          <group key={moment.id} position={[moment.x, moment.y + 2.4, moment.z]}>
            <Html center distanceFactor={22} style={{ pointerEvents: "none" }}>
              <div style={{
                color: isSel ? "rgba(232,238,248,0.85)" : `#${momentColor(moment).getHexString()}`,
                opacity: isSel ? 1 : 0.5,
                fontSize: isSel ? 11 : 9,
                fontFamily,
                whiteSpace: "nowrap",
                textShadow: `0 0 12px ${BACKGROUND}, 0 0 6px ${BACKGROUND}`,
                userSelect: "none",
              }}>{momentLabel(moment)}</div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

/**
 * Screen-space picking (same approach as GalaxyView): project every moment,
 * take the nearest within a small radius. Click selects (or clears on empty
 * space); pointer moves drive the hover highlight and cursor.
 */
function PointerHandler({ moments, onPick, onHover }: {
  moments: LayoutMoment[];
  onPick: (moment: LayoutMoment | null) => void;
  onHover: (id: string | null) => void;
}) {
  const { camera, gl } = useThree();
  const vec = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const canvas = gl.domElement;
    const nearest = (event: { clientX: number; clientY: number }, radius: number) => {
      const rect = canvas.getBoundingClientRect();
      const mx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const my = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      let best: LayoutMoment | null = null;
      let bestDist = radius;
      for (const moment of moments) {
        vec.set(moment.x, moment.y, moment.z).project(camera);
        if (vec.z < -1 || vec.z > 1) continue;
        const d = Math.hypot(vec.x - mx, vec.y - my);
        if (d < bestDist) { bestDist = d; best = moment; }
      }
      return best;
    };
    let pointerStart: [number, number] | null = null;
    const down = (event: PointerEvent) => { pointerStart = [event.clientX, event.clientY]; };
    const click = (event: MouseEvent) => {
      if (pointerStart && Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
      onPick(nearest(event, 0.05));
    };
    const move = (event: PointerEvent) => {
      const hit = nearest(event, 0.045);
      onHover(hit?.id ?? null);
      canvas.style.cursor = hit ? "pointer" : "";
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("click", click);
    canvas.addEventListener("pointermove", move);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("click", click);
      canvas.removeEventListener("pointermove", move);
      canvas.style.cursor = "";
    };
  }, [moments, camera, gl, onPick, onHover, vec]);
  return null;
}

/** Frame the whole cloud regardless of sea size (same approach as GalaxyView). */
function FitCamera({ moments }: { moments: LayoutMoment[] }) {
  const { camera, size } = useThree();
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera) || !moments.length || !size.width || !size.height) return;
    let radius = 8;
    for (const moment of moments) radius = Math.max(radius, Math.hypot(moment.x, moment.y, moment.z));
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * (size.width / size.height));
    const distance = (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.02;
    camera.position.set(0, distance * 0.22, distance);
    camera.near = Math.max(0.1, distance / 500);
    camera.far = Math.max(1500, distance * 12);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, moments, size.height, size.width]);
  return null;
}

export default function EchoGalaxy({
  sea,
  fontFamily = "ui-monospace, monospace",
  onSelect,
}: EchoGalaxyProps) {
  const [glowMode, setGlowMode] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const sprite = useMemo(() => makeDotSprite(), []);
  useEffect(() => () => sprite.dispose(), [sprite]);

  const { moments, bonds, flares, labeled, wells } = useMemo(() => {
    const safeBonds = normalizedBonds(sea.moments, sea.bonds);
    const laid = layoutMoments(sea.moments, safeBonds);
    const ranked = [...laid].sort(byScoreDesc);
    const bright = ranked.filter((moment) => !isDarkWell(moment));
    return {
      moments: laid,
      bonds: safeBonds,
      flares: bright.slice(0, Math.min(FLARE_COUNT, Math.max(3, Math.round(laid.length * 0.15)))),
      labeled: bright.slice(0, LABEL_COUNT),
      wells: laid.filter(isDarkWell),
    };
  }, [sea.moments, sea.bonds]);

  // Pixel mode draws special tiers (neutron orbs, black holes) as meshes; their
  // base squares must not show through behind them as four corners.
  const ordinaryMoments = useMemo(() => {
    const special = new Set([...flares, ...wells].map((moment) => moment.id));
    return moments.filter((moment) => !special.has(moment.id));
  }, [moments, flares, wells]);

  const selected = useMemo(
    () => moments.find((moment) => moment.id === selectedId) || null,
    [moments, selectedId],
  );
  const hovered = useMemo(
    () => (hoveredId && hoveredId !== selectedId
      ? moments.find((moment) => moment.id === hoveredId) || null
      : null),
    [moments, hoveredId, selectedId],
  );

  // Clear a selection that no longer exists after the sea changes.
  useEffect(() => {
    if (selectedId && !selected) {
      setSelectedId(null);
      onSelect?.(null);
    }
  }, [onSelect, selected, selectedId]);

  const pick = useCallback((moment: LayoutMoment | null) => {
    setSelectedId(moment?.id || null);
    onSelect?.(moment);
  }, [onSelect]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: BACKGROUND, fontFamily }}>
      <Canvas dpr={[1, 2]} camera={{ position: [0, 12, 110], fov: 55, near: 0.1, far: 3000 }} style={{ background: BACKGROUND }}>
        <FitCamera moments={moments} />
        <BackgroundStars sprite={sprite} />
        <MomentPoints moments={glowMode ? moments : ordinaryMoments} sprite={sprite} pixel={!glowMode} />
        {/* Upstream never rendered bond lines — bonds only shape the spring layout. */}
        <Flares moments={flares} sprite={sprite} glow={glowMode} />
        <DarkWells moments={wells} glow={glowMode} />
        {selected && <HighlightGlow moment={selected} sprite={sprite} strong />}
        {hovered && <HighlightGlow moment={hovered} sprite={sprite} strong={false} />}
        <MomentLabels labeled={labeled} selected={selected} fontFamily={fontFamily} />
        <PointerHandler moments={moments} onPick={pick} onHover={setHoveredId} />
        <OrbitControls enableDamping dampingFactor={0.05} rotateSpeed={0.2} zoomSpeed={0.4} minDistance={8} maxDistance={1200} autoRotate autoRotateSpeed={0.05} />
      </Canvas>
      {/* Two faces of the same sky, upstream feature: the button names the one
          you would switch to. */}
      <button
        type="button"
        onClick={() => setGlowMode((v) => !v)}
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          background: "rgba(8,10,18,0.82)",
          color: "#cdd8ea",
          border: "1px solid rgba(205,216,238,0.25)",
          padding: "4px 10px",
          fontSize: 11,
          fontFamily,
          cursor: "pointer",
        }}
      >
        {glowMode ? "\u25c6 PIXEL" : "\u2726 GLOW"}
      </button>
    </div>
  );
}
