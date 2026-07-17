import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import type { RidgeEdge, RidgeGraph, RidgeMemory } from "../core/types.js";
import { hash01 } from "../core/hash.js";

/**
 * Galaxy View — a community-colored memory graph.
 *
 * Every node is a memory. Label propagation groups connected memories into
 * topic communities; each community gets a pastel color and a gravity anchor,
 * so related memories condense into colored nebulae inside one galaxy ball.
 * Sparse data still reads as a galaxy thanks to per-node companion dust.
 */

export interface GalaxyViewProps {
  graph: RidgeGraph;
  /** Pastel community palette. Defaults to a 12-color set. */
  palette?: string[];
  /** Scene background. Pure black lets nebula edges dissolve. */
  background?: string;
  /** Called when a memory is selected (null when deselected). */
  onSelect?: (memory: RidgeMemory | null) => void;
  /** Font stack for labels/panels. */
  fontFamily?: string;
  /** Companion dust points per node (visual density; 0 disables). */
  dustPerNode?: number;
}

const DEFAULT_PALETTE = [
  "#a8e6c7", "#c5b3f0", "#f0a8c8", "#f0d8a0", "#a0c4f0", "#f5b895",
  "#8fd8d0", "#d8aef0", "#b5d8a0", "#f0a898", "#96c8e8", "#ece3a0",
];

type LayoutNode = RidgeMemory & { x: number; y: number; z: number };

const stableCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const clamp01 = (value: number | undefined, fallback = 0.5) => (
  Number.isFinite(value) ? Math.min(1, Math.max(0, value!)) : fallback
);

function normalizedEdges(nodes: RidgeMemory[], edges: RidgeEdge[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const pairs = new Map<string, { source: string; target: string; weight: number }>();
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    const [source, target] = stableCompare(edge.source, edge.target) <= 0
      ? [edge.source, edge.target]
      : [edge.target, edge.source];
    const key = JSON.stringify([source, target]);
    const weight = clamp01(edge.weight);
    const previous = pairs.get(key);
    if (!previous || weight > previous.weight) pairs.set(key, { source, target, weight });
  }
  return [...pairs.values()].sort((a, b) => (
    stableCompare(a.source, b.source) || stableCompare(a.target, b.target)
  ));
}

/** Deterministic label propagation. Seeds from `category`, converges along edges. */
export function detectCommunities(nodes: RidgeMemory[], edges: RidgeEdge[]): Map<string, number> {
  const label = new Map<string, string>();
  const seed = new Map<string, string | null>();
  const sorted = [...nodes].sort((a, b) => stableCompare(a.id, b.id));
  for (const node of sorted) {
    const category = node.category?.trim();
    const initial = category ? `category:${category}` : `node:${node.id}`;
    label.set(node.id, initial);
    seed.set(node.id, category ? initial : null);
  }
  const neighbors = new Map<string, Array<{ id: string; weight: number }>>();
  for (const edge of normalizedEdges(nodes, edges)) {
    if (!neighbors.has(edge.source)) neighbors.set(edge.source, []);
    if (!neighbors.has(edge.target)) neighbors.set(edge.target, []);
    neighbors.get(edge.source)!.push({ id: edge.target, weight: edge.weight });
    neighbors.get(edge.target)!.push({ id: edge.source, weight: edge.weight });
  }
  for (let round = 0; round < 12; round += 1) {
    let changed = 0;
    for (const node of sorted) {
      const around = neighbors.get(node.id);
      if (!around || !around.length) continue;
      const votes = new Map<string, number>();
      const current = label.get(node.id)!;
      votes.set(current, 0.22);
      const categorySeed = seed.get(node.id);
      if (categorySeed) votes.set(categorySeed, (votes.get(categorySeed) || 0) + 0.75);
      for (const other of around) {
        const neighborLabel = label.get(other.id)!;
        votes.set(neighborLabel, (votes.get(neighborLabel) || 0) + other.weight);
      }
      let bestLabel = current;
      let bestScore = votes.get(current) || 0;
      for (const [candidate, score] of votes) {
        if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && stableCompare(candidate, bestLabel) < 0)) {
          bestLabel = candidate;
          bestScore = score;
        }
      }
      if (bestLabel !== current) {
        label.set(node.id, bestLabel);
        changed += 1;
      }
    }
    if (!changed) break;
  }
  const sizes = new Map<string, number>();
  for (const l of label.values()) sizes.set(l, (sizes.get(l) || 0) + 1);
  const order = [...sizes.entries()]
    .sort((a, b) => b[1] - a[1] || stableCompare(a[0], b[0]))
    .map(([l]) => l);
  const indexOf = new Map(order.map((l, i) => [l, i]));
  const out = new Map<string, number>();
  for (const [id, l] of label) out.set(id, indexOf.get(l) || 0);
  return out;
}

/**
 * Force layout tuned for "ball of colored nebulae":
 * - community anchors on a golden-angle sphere (blobs form where they're born)
 * - degree-normalized springs (hubs relax, exclusive pairs hug — d3 wisdom)
 * - dual gravity: toward the community anchor and toward the global center
 * - deterministic: seeded by id hashes, identical on every load
 */
export function galaxyLayout(
  nodes: RidgeMemory[],
  edges: RidgeEdge[],
  community: Map<string, number>,
): LayoutNode[] {
  const out: LayoutNode[] = nodes.map((n) => ({ ...n, x: 0, y: 0, z: 0 }));
  const N = out.length;
  const idx = new Map<string, number>();
  const communityValue = (id: string) => {
    const value = community.get(id);
    return Number.isFinite(value) ? value! : 0;
  };
  const communityValues = [...new Set(out.map((node) => communityValue(node.id)))].sort((a, b) => a - b);
  const communityIndex = new Map(communityValues.map((value, index) => [value, index]));
  const communityCount = Math.max(1, communityValues.length);
  const communityOf = (id: string) => communityIndex.get(communityValue(id)) ?? 0;
  const anchors: Array<[number, number, number]> = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let c = 0; c < communityCount; c += 1) {
    const t = communityCount > 1 ? c / (communityCount - 1) : 0.5;
    const y = 1 - 2 * t;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const a = c * golden;
    const depth = communityCount === 1 ? 0 : 8 + hash01(`community-${c}`, 31) * 12;
    anchors.push([Math.cos(a) * rad * depth, y * depth * 0.82, Math.sin(a) * rad * depth]);
  }
  out.forEach((n, i) => {
    idx.set(n.id, i);
    const anchor = anchors[communityOf(n.id)];
    const theta = hash01(n.id, 7) * Math.PI * 2;
    const phi = Math.acos(2 * hash01(n.id, 11) - 1);
    const r = 4 + hash01(n.id, 13) * 12;
    n.x = anchor[0] + Math.sin(phi) * Math.cos(theta) * r;
    n.y = anchor[1] + Math.cos(phi) * r * 0.9;
    n.z = anchor[2] + Math.sin(phi) * Math.sin(theta) * r;
  });
  const adj = normalizedEdges(nodes, edges).map((edge) => ({
    s: idx.get(edge.source)!,
    t: idx.get(edge.target)!,
    w: edge.weight,
  }));
  const degree = new Float32Array(N);
  for (const e of adj) { degree[e.s] += 1; degree[e.t] += 1; }
  const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
  const iterations = Math.min(120, Math.max(56, Math.round(9000 / Math.max(1, N))));
  const exactRepulsion = N <= 96;
  const sampleCount = Math.min(18, Math.max(0, N - 1));
  const sampledScale = sampleCount ? Math.max(1, (N - 1) / (sampleCount * 2)) : 1;
  const repelPair = (i: number, j: number, repel: number, scale: number) => {
    const dx = out[i].x - out[j].x, dy = out[i].y - out[j].y, dz = out[i].z - out[j].z;
    const d2 = dx * dx + dy * dy + dz * dz + 0.5;
    const d = Math.sqrt(d2);
    const f = (repel / d2) * scale;
    vx[i] += (dx / d) * f; vy[i] += (dy / d) * f; vz[i] += (dz / d) * f;
    vx[j] -= (dx / d) * f; vy[j] -= (dy / d) * f; vz[j] -= (dz / d) * f;
  };
  for (let it = 0; it < iterations; it += 1) {
    const alpha = 1 - it / iterations;
    const repel = 500 * alpha;
    const attract = 0.048 * alpha;
    if (exactRepulsion) {
      for (let i = 0; i < N; i += 1) {
        for (let j = i + 1; j < N; j += 1) repelPair(i, j, repel, 1);
      }
    } else {
      for (let i = 0; i < N; i += 1) {
        for (let k = 0; k < sampleCount; k += 1) {
          let mixed = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(it + 1, 0x85ebca6b) ^ Math.imul(k + 1, 0xc2b2ae35)) >>> 0;
          mixed = (mixed ^ (mixed >>> 16)) >>> 0;
          let j = mixed % N;
          if (j === i) j = (j + 1) % N;
          repelPair(i, j, repel, sampledScale);
        }
      }
    }
    for (const e of adj) {
      const a = out[e.s], b = out[e.t];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
      const target = 6 + (1 - e.w) * 8;
      const normalize = 1 / Math.max(1, Math.min(degree[e.s], degree[e.t]));
      const f = (d - target) * attract * 2 * (0.3 + e.w) * normalize;
      vx[e.s] += (dx / d) * f; vy[e.s] += (dy / d) * f; vz[e.s] += (dz / d) * f;
      vx[e.t] -= (dx / d) * f; vy[e.t] -= (dy / d) * f; vz[e.t] -= (dz / d) * f;
    }
    for (let i = 0; i < N; i += 1) {
      const anchor = anchors[communityOf(out[i].id)];
      const pull = (degree[i] === 0 ? 0.008 : 0.004) * alpha;
      vx[i] += (anchor[0] - out[i].x) * pull;
      vy[i] += (anchor[1] - out[i].y) * pull;
      vz[i] += (anchor[2] - out[i].z) * pull;
      vx[i] -= out[i].x * 0.0012 * alpha;
      vy[i] -= out[i].y * 0.0012 * alpha;
      vz[i] -= out[i].z * 0.0012 * alpha;
      vx[i] *= 0.82; vy[i] *= 0.82; vz[i] *= 0.82;
      const velocity = Math.hypot(vx[i], vy[i], vz[i]);
      const maxVelocity = 0.8 + alpha * 2.2;
      if (velocity > maxVelocity) {
        const scale = maxVelocity / velocity;
        vx[i] *= scale; vy[i] *= scale; vz[i] *= scale;
      }
      out[i].x += vx[i]; out[i].y += vy[i]; out[i].z += vz[i];
    }
  }
  if (N) {
    const center = out.reduce((sum, node) => {
      sum[0] += node.x; sum[1] += node.y; sum[2] += node.z;
      return sum;
    }, [0, 0, 0]);
    center[0] /= N; center[1] /= N; center[2] /= N;
    let maxRadius = 0;
    for (const node of out) {
      node.x -= center[0]; node.y -= center[1]; node.z -= center[2];
      maxRadius = Math.max(maxRadius, Math.hypot(node.x, node.y, node.z));
    }
    if (maxRadius > 46) {
      const scale = 46 / maxRadius;
      for (const node of out) { node.x *= scale; node.y *= scale; node.z *= scale; }
    }
  }
  return out;
}

/** Soft round sprite. PITFALL: untextured Points render as hard squares. */
function makeStarSprite(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.22, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.3)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function NodePoints({ nodes, selId, connectedIds, community, palette, dustPerNode }: {
  nodes: LayoutNode[];
  selId: string | null;
  connectedIds: Set<string>;
  community: Map<string, number>;
  palette: string[];
  dustPerNode: number;
}) {
  const sprite = useMemo(() => makeStarSprite(), []);
  useEffect(() => () => sprite.dispose(), [sprite]);
  const paletteOf = useCallback(
    (n: LayoutNode) => palette[(community.get(n.id) || 0) % palette.length],
    [community, palette],
  );
  const [positions, colors] = useMemo(() => {
    const pos = new Float32Array(nodes.length * 3);
    const col = new Float32Array(nodes.length * 3);
    nodes.forEach((n, i) => {
      pos[i * 3] = n.x; pos[i * 3 + 1] = n.y; pos[i * 3 + 2] = n.z;
      const isSel = n.id === selId;
      const isConn = connectedIds.has(n.id);
      const c = new THREE.Color(isSel ? "#ffffff" : isConn ? "#cfe4ff" : paletteOf(n));
      const b = isSel ? 1.5 : isConn ? 1.15 : 0.62 + clamp01(n.heat, 0.2) * 0.5;
      col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
    });
    return [pos, col];
  }, [nodes, selId, connectedIds, paletteOf]);

  // Companion dust: a few dim same-color sparks around each node. This is how
  // a few hundred records still read as a fluffy galaxy. Decorative only.
  const [dustPositions, dustColors] = useMemo(() => {
    const per = dustPerNode;
    const pos = new Float32Array(nodes.length * per * 3);
    const col = new Float32Array(nodes.length * per * 3);
    nodes.forEach((n, i) => {
      const c = new THREE.Color(paletteOf(n));
      for (let k = 0; k < per; k += 1) {
        const j = (i * per + k) * 3;
        const theta = hash01(n.id, 71 + k * 13) * Math.PI * 2;
        const phi = Math.acos(2 * hash01(n.id, 73 + k * 13) - 1);
        const r = 1.2 + hash01(n.id, 79 + k * 13) * 3.4;
        pos[j] = n.x + Math.sin(phi) * Math.cos(theta) * r;
        pos[j + 1] = n.y + Math.cos(phi) * r;
        pos[j + 2] = n.z + Math.sin(phi) * Math.sin(theta) * r;
        const b = 0.18 + hash01(n.id, 83 + k * 13) * 0.3;
        col[j] = c.r * b; col[j + 1] = c.g * b; col[j + 2] = c.b * b;
      }
    });
    return [pos, col];
  }, [nodes, paletteOf, dustPerNode]);

  return (
    <>
      {dustPerNode > 0 && (
        <points raycast={() => null}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[dustPositions, 3]} />
            <bufferAttribute attach="attributes-color" args={[dustColors, 3]} />
          </bufferGeometry>
          <pointsMaterial map={sprite} vertexColors size={1.8} sizeAttenuation transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>
      )}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial map={sprite} vertexColors size={3.6} sizeAttenuation transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </>
  );
}

function EdgeLines({ nodes, edges, selId }: {
  nodes: LayoutNode[];
  edges: RidgeEdge[];
  selId: string | null;
}) {
  const hasSelection = !!selId;
  const geo = useMemo(() => {
    const m = new Map<string, LayoutNode>();
    nodes.forEach((n) => m.set(n.id, n));
    const pos: number[] = [], col: number[] = [];
    for (const e of edges) {
      const a = m.get(e.source), b = m.get(e.target);
      if (!a || !b) continue;
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const hot = selId && (e.source === selId || e.target === selId);
      if (hot) {
        col.push(0.55, 0.8, 1.0, 0.55, 0.8, 1.0);
      } else {
        const dim = hasSelection ? 0.4 : 1;
        const w = (0.08 + (e.weight ?? 0.3) * 0.15) * 0.4;
        col.push(0.3 * w * dim, 0.4 * w * dim, 0.6 * w * dim, 0.3 * w * dim, 0.4 * w * dim, 0.6 * w * dim);
      }
    }
    return { p: new Float32Array(pos), c: new Float32Array(col) };
  }, [nodes, edges, selId, hasSelection]);
  if (!geo.p.length) return null;
  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geo.p, 3]} />
        <bufferAttribute attach="attributes-color" args={[geo.c, 3]} />
      </bufferGeometry>
      <lineBasicMaterial vertexColors transparent opacity={hasSelection ? 0.5 : 0.3} blending={THREE.AdditiveBlending} />
    </lineSegments>
  );
}

function ClickHandler({ nodes, onPick }: { nodes: LayoutNode[]; onPick: (n: LayoutNode | null) => void }) {
  const { camera, gl } = useThree();
  const vec = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const canvas = gl.domElement;
    let pointerStart: [number, number] | null = null;
    const down = (event: PointerEvent) => { pointerStart = [event.clientX, event.clientY]; };
    const handler = (e: MouseEvent) => {
      if (pointerStart && Math.hypot(e.clientX - pointerStart[0], e.clientY - pointerStart[1]) > 5) return;
      const rect = canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      let best: LayoutNode | null = null;
      let bestDist = 0.06;
      for (const n of nodes) {
        vec.set(n.x, n.y, n.z).project(camera);
        if (vec.z < -1 || vec.z > 1) continue;
        const d = Math.hypot(vec.x - mx, vec.y - my);
        if (d < bestDist) { bestDist = d; best = n; }
      }
      onPick(best);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("click", handler);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("click", handler);
    };
  }, [nodes, camera, gl, onPick, vec]);
  return null;
}

function FitCamera({ nodes }: { nodes: LayoutNode[] }) {
  const { camera, size } = useThree();
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera) || !nodes.length || !size.width || !size.height) return;
    let radius = 8;
    for (const node of nodes) radius = Math.max(radius, Math.hypot(node.x, node.y, node.z));
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * (size.width / size.height));
    const distance = (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.3;
    camera.position.set(0, distance * 0.28, distance);
    camera.near = Math.max(0.1, distance / 500);
    camera.far = Math.max(500, distance * 12);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, nodes, size.height, size.width]);
  return null;
}

export default function GalaxyView({
  graph,
  palette = DEFAULT_PALETTE,
  background = "#000000",
  onSelect,
  fontFamily = "ui-monospace, monospace",
  dustPerNode = 4,
}: GalaxyViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const resolvedPalette = useMemo(() => {
    const valid = palette.filter((color) => typeof color === "string" && color.trim().length > 0);
    return valid.length ? valid : DEFAULT_PALETTE;
  }, [palette]);
  const resolvedDustPerNode = Number.isFinite(dustPerNode)
    ? Math.min(32, Math.max(0, Math.floor(dustPerNode)))
    : 4;

  const { nodes, community, edges } = useMemo(() => {
    const safeEdges = normalizedEdges(graph.nodes, graph.edges);
    const communityMap = detectCommunities(graph.nodes, safeEdges);
    return {
      nodes: galaxyLayout(graph.nodes, safeEdges, communityMap),
      community: communityMap,
      edges: safeEdges,
    };
  }, [graph.edges, graph.nodes]);
  const selected = useMemo(
    () => nodes.find((node) => node.id === selectedId) || null,
    [nodes, selectedId],
  );

  useEffect(() => {
    if (selectedId && !selected) {
      setSelectedId(null);
      onSelect?.(null);
    }
  }, [onSelect, selected, selectedId]);

  const connectedIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selected) return ids;
    for (const e of edges) {
      if (e.source === selected.id) ids.add(e.target);
      if (e.target === selected.id) ids.add(e.source);
    }
    return ids;
  }, [edges, selected]);

  const pick = useCallback((n: LayoutNode | null) => {
    setSelectedId(n?.id || null);
    onSelect?.(n);
  }, [onSelect]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background, fontFamily }}>
      <Canvas dpr={[1, 2]} camera={{ position: [0, 40, 90], fov: 50, near: 0.1, far: 3000 }} style={{ background }}>
        <ambientLight intensity={0.08} />
        <FitCamera nodes={nodes} />
        <NodePoints nodes={nodes} selId={selected?.id || null} connectedIds={connectedIds} community={community} palette={resolvedPalette} dustPerNode={resolvedDustPerNode} />
        <EdgeLines nodes={nodes} edges={edges} selId={selected?.id || null} />
        {selected && (
          <group position={[selected.x, selected.y + 1.6, selected.z]}>
            <Html center distanceFactor={18} style={{ pointerEvents: "none" }}>
              <div style={{ color: "#e8eef8", fontSize: 11, whiteSpace: "nowrap", textShadow: `0 0 8px ${background}, 0 0 4px ${background}` }}>
                {selected.title}
              </div>
            </Html>
          </group>
        )}
        <ClickHandler nodes={nodes} onPick={pick} />
        <OrbitControls enableDamping dampingFactor={0.04} rotateSpeed={0.3} zoomSpeed={0.5} minDistance={5} maxDistance={1500} />
      </Canvas>
      {selected && (
        <div style={{
          position: "absolute", bottom: 10, left: 10, right: 10,
          background: "rgba(2,6,12,0.94)", border: "1px solid rgba(120,150,190,0.18)",
          borderRadius: 6, padding: 12, color: "#cdd8ea", fontSize: 12,
        }}>
          <button
            type="button"
            onClick={() => pick(null)}
            style={{ position: "absolute", top: 4, right: 8, background: "none", border: 0, color: "#5a6a80", fontSize: 16, cursor: "pointer" }}
            aria-label="Close"
          >×</button>
          <div style={{ fontSize: 13, color: "#e8eef8", marginBottom: 4 }}>{selected.title}</div>
          {selected.preview && <div style={{ opacity: 0.7, lineHeight: 1.5 }}>{selected.preview}</div>}
          {selected.date && <div style={{ opacity: 0.45, marginTop: 6, fontSize: 10 }}>{selected.date}</div>}
        </div>
      )}
    </div>
  );
}
