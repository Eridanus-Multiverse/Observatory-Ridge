import type { RidgeGraph, RidgeMemory, RidgeSnapshot } from "../../src/core/types";
import { hash01 } from "../../src/core/hash";
import { solarSystemSnapshot } from "../../src/presets/solar-system";

/**
 * Synthetic demo data. Every title here is invented — the generator exists so
 * the demo never needs anyone's real notes.
 */

const TOPICS: Array<{ category: string; titles: string[] }> = [
  { category: "travel", titles: ["First time seeing the ocean", "Night train to the coast", "Getting lost in the old town", "The lighthouse at dawn", "Missed the last ferry"] },
  { category: "cooking", titles: ["Finally nailed the omelette", "Bread that refused to rise", "Grandmother's soup, attempt 3", "Burnt the caramel again", "Sunday dumpling marathon"] },
  { category: "reading", titles: ["Finished the trilogy at 3am", "A paragraph worth copying out", "Library corner seat", "Lent a book, made a friend", "Re-reading chapter one"] },
  { category: "friends", titles: ["Board game night went long", "The call that fixed everything", "Postcard from far away", "Two umbrellas, one storm", "Inside joke, year three"] },
  { category: "projects", titles: ["Shipped the first version", "The bug that was a typo", "Whiteboard full of arrows", "Refactor day", "Demo went better than feared"] },
  { category: "seasons", titles: ["First snow on the balcony", "Cherry blossoms a week early", "Typhoon day at home", "The long bright evenings", "Frost on the window"] },
];

export function demoSnapshot(): RidgeSnapshot {
  const base = solarSystemSnapshot();
  let memorySerial = 0;
  const memoryFor = (planetId: string, title: string, category: string): RidgeMemory => {
    memorySerial += 1;
    const id = `demo-m-${memorySerial}`;
    const month = 1 + Math.floor(hash01(id, 5) * 12);
    const day = 1 + Math.floor(hash01(id, 9) * 28);
    return {
      id,
      title,
      category,
      date: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      heat: hash01(id, 21),
      planetId,
    };
  };
  base.planets = base.planets.map((planet, i) => {
    const topic = TOPICS[i % TOPICS.length];
    const memories = topic.titles.map((title) => memoryFor(planet.id, title, topic.category));
    return { ...planet, memories, memoryCount: planet.memoryCount };
  });
  base.asteroids = Array.from({ length: 24 }, (_, i) => {
    const topic = TOPICS[i % TOPICS.length];
    const title = `${topic.titles[i % topic.titles.length]} (unfiled)`;
    const memory = memoryFor("", title, topic.category);
    return { ...memory, planetId: null };
  });
  return base;
}

export function demoGraph(): RidgeGraph {
  const nodes: RidgeMemory[] = [];
  let serial = 0;
  for (const topic of TOPICS) {
    // ~60 memories per topic so communities form visible nebulae.
    for (let i = 0; i < 36; i += 1) {
      serial += 1;
      const id = `demo-g-${serial}`;
      nodes.push({
        id,
        title: `${topic.titles[i % topic.titles.length]} #${Math.floor(i / topic.titles.length) + 1}`,
        category: topic.category,
        heat: hash01(id, 33),
        date: `2026-${String(1 + Math.floor(hash01(id, 5) * 12)).padStart(2, "0")}-${String(1 + Math.floor(hash01(id, 9) * 28)).padStart(2, "0")}`,
      });
    }
  }
  const edgeMap = new Map<string, RidgeGraph["edges"][number]>();
  const addEdge = (source: string, target: string, weight: number) => {
    if (source === target) return;
    const [a, b] = source < target ? [source, target] : [target, source];
    const key = `${a}\u0000${b}`;
    const previous = edgeMap.get(key);
    if (!previous || weight > (previous.weight ?? 0)) edgeMap.set(key, { source: a, target: b, weight });
  };
  const byCategory = new Map<string, RidgeMemory[]>();
  for (const n of nodes) {
    if (!byCategory.has(n.category!)) byCategory.set(n.category!, []);
    byCategory.get(n.category!)!.push(n);
  }
  // Dense-ish links inside a topic, occasional bridges between topics.
  for (const list of byCategory.values()) {
    for (let i = 0; i < list.length; i += 1) {
      const links = 1 + Math.floor(hash01(list[i].id, 41) * 3);
      for (let k = 0; k < links; k += 1) {
        const j = Math.floor(hash01(list[i].id, 47 + k * 7) * list.length);
        if (j !== i) addEdge(list[i].id, list[j].id, 0.35 + hash01(list[i].id, 53 + k) * 0.5);
      }
    }
  }
  for (let b = 0; b < 18; b += 1) {
    const i = Math.floor(hash01(`bridge-${b}`, 3) * nodes.length);
    let j = Math.floor(hash01(`bridge-${b}`, 11) * nodes.length);
    if (nodes[i].category === nodes[j].category) j = (j + 36 + (b % 5) * 36) % nodes.length;
    addEdge(nodes[i].id, nodes[j].id, 0.25);
  }
  return { nodes, edges: [...edgeMap.values()] };
}
