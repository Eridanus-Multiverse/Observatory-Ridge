import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RidgeSnapshot } from "../src/core/types";
import NearFocus2D from "../src/near-focus-2d/NearFocus2D";
import NearFocus3D from "../src/near-focus-3d/NearFocus3D";

const snapshot: RidgeSnapshot = {
  star: { name: "Archive" },
  planets: [
    { id: "star", name: "A planet named star", rank: 1, memoryCount: 2 },
    { id: "belt", name: "A planet named belt", rank: 2, memoryCount: 1 },
  ],
  asteroids: [],
};

describe("NearFocus2D server rendering", () => {
  it("is deterministic before the client clock starts", () => {
    const first = renderToStaticMarkup(<NearFocus2D snapshot={snapshot} />);
    const second = renderToStaticMarkup(<NearFocus2D snapshot={snapshot} />);
    expect(first).toBe(second);
  });

  it("falls back safely when an empty palette is supplied", () => {
    expect(() => renderToStaticMarkup(<NearFocus2D snapshot={snapshot} palette={[]} />)).not.toThrow();
  });

  it("generates collision-free SVG resource ids for multiple instances", () => {
    const html = renderToStaticMarkup(
      <>
        <NearFocus2D snapshot={snapshot} palette={["#ff0000"]} />
        <NearFocus2D snapshot={snapshot} palette={["#00ff00"]} />
      </>,
    );
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const references = [...html.matchAll(/url\(#([^\)]+)\)/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const reference of references) expect(ids).toContain(reference);
  });

  it("does not reserve valid planet ids for star or belt selection", () => {
    const html = renderToStaticMarkup(<NearFocus2D snapshot={snapshot} />);
    expect(html).toContain('aria-label="A planet named star, 2 memories"');
    expect(html).toContain('aria-label="A planet named belt, 1 memories"');
  });

  it("keeps the 3D shell server-renderable", () => {
    expect(() => renderToStaticMarkup(<NearFocus3D snapshot={snapshot} />)).not.toThrow();
  });
});
