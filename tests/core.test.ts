import { describe, expect, it } from "vitest";
import type { RidgeEdge, RidgeMemory } from "../src/core/types";
import { hash01 } from "../src/core/hash";
import { detectCommunities, galaxyLayout } from "../src/galaxy-view/GalaxyView";
import { orbitRadius } from "../src/near-focus-2d/NearFocus2D";
import { demoGraph } from "../demo/src/demo-data";

const memory = (id: string, category?: string): RidgeMemory => ({ id, title: id, category });

describe("deterministic visual utilities", () => {
  it("keeps hashes stable while separating sequential ids", () => {
    const first = Array.from({ length: 20 }, (_, index) => hash01(`planet-${index}`, 17));
    const second = Array.from({ length: 20 }, (_, index) => hash01(`planet-${index}`, 17));
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
    expect(Math.max(...first) - Math.min(...first)).toBeGreaterThan(0.65);
  });

  it("keeps disconnected category-less components separate", () => {
    const nodes = [memory("a"), memory("b"), memory("c"), memory("d")];
    const communities = detectCommunities(nodes, [
      { source: "a", target: "b", weight: 0.8 },
      { source: "c", target: "d", weight: 0.8 },
    ]);
    expect(communities.get("a")).toBe(communities.get("b"));
    expect(communities.get("c")).toBe(communities.get("d"));
    expect(communities.get("a")).not.toBe(communities.get("c"));
  });

  it("uses edge strength without letting weak bridges erase category seeds", () => {
    const nodes = [memory("a", "red"), memory("b", "blue"), memory("c", "blue")];
    const weak = detectCommunities(nodes, [
      { source: "a", target: "b", weight: 0.1 },
      { source: "a", target: "c", weight: 0.1 },
    ]);
    const strong = detectCommunities(nodes, [
      { source: "a", target: "b", weight: 1 },
      { source: "a", target: "c", weight: 1 },
    ]);
    expect(weak.get("a")).not.toBe(weak.get("b"));
    expect(strong.get("a")).toBe(strong.get("b"));
  });

  it("is stable across payload ordering", () => {
    const nodes = [memory("a"), memory("b"), memory("c")];
    const edges: RidgeEdge[] = [
      { source: "a", target: "b", weight: 0.7 },
      { source: "b", target: "c", weight: 0.4 },
    ];
    expect([...detectCommunities(nodes, edges)]).toEqual([
      ...detectCommunities([...nodes].reverse(), [...edges].reverse()),
    ]);
  });

  it("keeps malformed numeric inputs finite and lays out the demo within budget", () => {
    const graph = demoGraph();
    graph.edges.push({ source: graph.nodes[0].id, target: graph.nodes[1].id, weight: Infinity });
    const start = performance.now();
    const communities = detectCommunities(graph.nodes, graph.edges);
    const layout = galaxyLayout(graph.nodes, graph.edges, communities);
    const elapsed = performance.now() - start;
    expect(layout).toHaveLength(graph.nodes.length);
    expect(layout.every((node) => [node.x, node.y, node.z].every(Number.isFinite))).toBe(true);
    expect(elapsed).toBeLessThan(1500);
  });

  it("normalizes sparse or negative public community labels", () => {
    const nodes = [memory("a"), memory("b")];
    for (const labels of [new Map([["a", 99], ["b", 99]]), new Map([["a", -4], ["b", 12]])]) {
      const layout = galaxyLayout(nodes, [], labels);
      expect(layout.every((node) => [node.x, node.y, node.z].every(Number.isFinite))).toBe(true);
    }
  });

  it("keeps orbit radii ordered for large systems", () => {
    const radii = Array.from({ length: 16 }, (_, index) => orbitRadius(index, 16));
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
    expect(radii.at(-1)).toBeLessThanOrEqual(175.5);
  });

  it("generates a normalized synthetic graph", () => {
    const graph = demoGraph();
    const category = new Map(graph.nodes.map((node) => [node.id, node.category]));
    const keys = graph.edges.map((edge) => [edge.source, edge.target].sort().join("\u0000"));
    expect(new Set(keys).size).toBe(keys.length);
    for (const edge of graph.edges.filter((item) => item.weight === 0.25)) {
      expect(category.get(edge.source)).not.toBe(category.get(edge.target));
    }
  });
});
