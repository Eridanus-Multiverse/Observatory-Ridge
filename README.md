# Observatory Ridge

Turn notes, memories, and relationships into an explorable star system.

Most knowledge graphs look like wiring diagrams. This kit starts from a
different question: what if the things you remember deserved a sky? Concepts
become planets, memories orbit the ones they belong to, the unresolved ones
drift in an asteroid belt — and when you step back far enough, everything
you've written clusters into colored nebulae, like a galaxy that only you
could have grown.

Observatory Ridge is a backend-agnostic visualization toolkit for three related
views of the same knowledge base:

- **Near Focus 3D**: a navigable star-and-planet system with satellite and asteroid context.
- **Near Focus 2D**: an SVG system map for lower-power devices and compact layouts.
- **Galaxy View**: a community-colored, force-balanced memory graph.

The visualizations consume plain JSON. They do not own a database, call a
private API, or decide how an application authenticates its users.

> **Development status:** data contract, hardened hash, Solar System preset,
> Galaxy View, Near Focus 2D, and the runnable demo are in the tree. Near
> Focus 3D ships as a preview subset (star shader with seam-safe halo, orbit
> layout, star/planet picking, visual-only belt and satellites); bloom
> post-processing, camera-follow navigation, belt/satellite detail events, and
> per-planet surface shaders are still upstream and on the roadmap.

## Design principles

### Memory attribution: concepts become planets

A planet is a curated concept. A memory attributed to that concept becomes one
of its satellites; a memory with no confident owner remains in the asteroid
belt. This makes uncertainty visible instead of silently forcing every record
into a category.

Attribution belongs in an adapter or ingestion layer, not in a renderer. A
practical engine should:

1. Normalize aliases and candidate text without changing source records.
2. Prefer explicit ownership and exact alias matches over heuristic matches.
3. Score keyword or semantic matches only after deterministic rules.
4. Resolve ties with a stable rule, and leave low-confidence records unassigned.
5. Emit a `RidgeSnapshot`; never make a visualization fetch private data itself.

The current scaffold defines the output contract. It does not ship a semantic
classifier.

### Community detection becomes color

Galaxy View treats memories as nodes and their relationships as weighted edges.
The target implementation seeds each node with its category, then applies a
deterministic label-propagation pass. Neighbor votes merge related regions into
communities; stable tie-breaking and stable community ordering keep colors from
changing between identical renders.

Color communicates community, not identity. Selection, relationship strength,
and attention can still change brightness or emphasis without destroying the
community map.

### Force layout balances the graph

A useful galaxy cannot be only attractive. It must remain readable when hubs,
isolated notes, and dense communities coexist. The target layout combines:

- deterministic positions near golden-angle community anchors;
- pair repulsion to prevent node collapse (exact on small graphs, deterministic
  bounded sampling on larger graphs);
- weighted springs for connected memories;
- degree-normalized spring strength so hubs do not absorb all force;
- a community pull plus a weaker global centering force; and
- fixed iteration limits and damping for reproducible output.

Near Focus and Galaxy View use stable IDs as visual seeds. The same payload
should produce the same scene until the data changes.

## Parts

| Path | Status | Responsibility |
| --- | --- | --- |
| `src/core` | Available | Shared TypeScript data contracts and deterministic visual utilities. |
| `src/presets` | Available | Generic snapshots and themes, including the Solar System preset. |
| `src/near-focus-3d` | Preview | React Three Fiber star-system view with navigation and star/planet detail events; belt and satellites are visual-only. |
| `src/near-focus-2d` | Available | SVG system map with the same selection semantics and data model. |
| `src/galaxy-view` | Available | Community detection, force layout, graph rendering, and picking. |
| `demo` | Available | Vite application with generated data and configurable themes. |

The 2D and 3D near-focus views are peers, not separate products. They should
accept the same `RidgeSnapshot` and expose equivalent star/planet event payloads
wherever the platform permits. Selection is currently uncontrolled; a host that
switches views must preserve its own selected entity if continuity is required.

## Data contract

All IDs must be stable strings. Edges refer to memory IDs; `planetId` refers to
a planet ID. Dates, when supplied, should be ISO 8601 strings. Adapters must
normalize source attention scores into the documented `heat` range of 0 through
1. Renderers should validate foreign keys and ignore invalid edges instead of
crashing the scene.

### Near-focus snapshot

```json
{
  "star": {
    "name": "Archive",
    "definition": "The center of this collection"
  },
  "planets": [
    {
      "id": "concept-projects",
      "name": "Projects",
      "definition": "Things being built",
      "archetype": "rocky",
      "rank": 1,
      "memoryCount": 2,
      "memories": [
        {
          "id": "note-prototype",
          "title": "Prototype notes",
          "date": "2026-01-15",
          "category": "work",
          "preview": "First pass and open questions",
          "heat": 0.8,
          "planetId": "concept-projects"
        }
      ]
    }
  ],
  "asteroids": [
    {
      "id": "note-inbox",
      "title": "Unsorted note",
      "heat": 0.2,
      "planetId": null
    }
  ]
}
```

`RidgeSnapshot` contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `star` | `{ name, definition? }` | Central star label and optional description. |
| `planets` | `RidgePlanet[]` | Curated concepts ordered by their 1-based `rank`. |
| `asteroids` | `RidgeMemory[]` | Unattributed memories rendered outside a planet system. |

`RidgePlanet` contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Stable unique concept ID. |
| `name` | `string` | Display name. |
| `definition` | `string?` | Short description for a detail view. |
| `archetype` | `rocky \| oceanic \| gas \| ice \| volcanic` | Optional visual surface family. |
| `rank` | `number` | 1-based display order; lower ranks orbit closer to the star. |
| `memoryCount` | `number` | Total attributed records, including records omitted from `memories`. |
| `memories` | `RidgeMemory[]?` | Optional records available to a detail view. |

`RidgeMemory` contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Stable unique memory ID. |
| `title` | `string` | Display title. |
| `date` | `string?` | ISO 8601 date used for labels or sorting. |
| `category` | `string?` | Category seed used by Galaxy View. |
| `preview` | `string?` | Short, already-redacted detail text. |
| `heat` | `number?` | Attention value from 0 through 1. |
| `planetId` | `string \| null?` | Owning planet, or `null` when unattributed. |

`memoryCount` is deliberately separate from `memories.length`. A server may
report the true count while returning only a small, redacted preview set.

### Galaxy graph

```json
{
  "nodes": [
    {
      "id": "note-prototype",
      "title": "Prototype notes",
      "category": "work",
      "heat": 0.8,
      "planetId": "concept-projects"
    },
    {
      "id": "note-review",
      "title": "Review notes",
      "category": "work",
      "heat": 0.5,
      "planetId": "concept-projects"
    }
  ],
  "edges": [
    {
      "source": "note-prototype",
      "target": "note-review",
      "weight": 0.7
    }
  ]
}
```

`RidgeGraph.nodes` uses the same `RidgeMemory` shape. Each `RidgeEdge` has a
`source` ID, a `target` ID, and an optional `weight` from 0 through 1. Duplicate
or self-referential edges should be normalized by the data adapter before
rendering.

### Theme

```ts
import type { RidgeStarTheme } from "./src/core/types";

const theme: RidgeStarTheme = {
  starHot: "#fff3d2",
  starWarm: "#e8a052",
  keyLight: "#ffd6a0",
  background: "#01040c",
};
```

The bundled `SOLAR_STAR_THEME`, `BLUE_STAR_THEME`, and
`solarSystemSnapshot()` exports live in `src/presets/solar-system.ts`.

## Install and use

Requirements: Node 20.19+ and npm. Everything else installs locally.

```bash
cd Observatory-Ridge
npm install    # pulls React, three.js, @react-three/fiber, @react-three/drei, Vite
npm run demo   # opens the demo app (Galaxy View + Near Focus, synthetic data)
```

Other commands:

```bash
npm run typecheck  # TypeScript contract and component checks
npm test           # deterministic layout and SVG/SSR regression tests
npm run build      # production library + demo builds
npm run verify:package  # inspect the publish tarball and import its built entry
```

To embed the components in your own React app, install the peer dependencies
(`react`, `react-dom`, `three`, `@react-three/fiber`, `@react-three/drei` —
exact ranges in `package.json`) and import from the package root:

```tsx
import { GalaxyView, NearFocus2D, NearFocus3D } from "observatory-ridge";

<GalaxyView graph={yourGraph} />
<NearFocus2D snapshot={yourSnapshot} />
<NearFocus3D snapshot={yourSnapshot} />
```

`NearFocus2D.palette` accepts `#RRGGBB` colors and falls back to its built-in
wheel when the array is empty. `GalaxyView.dustPerNode` is normalized to an
integer from 0 through 32 so malformed display configuration cannot trigger an
unbounded typed-array allocation.

No plugins, no build-time codegen, no service dependencies — the components
render whatever JSON you hand them.

While working from a source checkout, an adapter can already target the shared
contract without coupling its private record shape to a renderer:

```ts
import type { RidgeMemory, RidgeSnapshot } from "./src/core/types";

type SourceRecord = {
  key: string;
  label: string;
  owner?: string;
};

export function makeSnapshot(records: SourceRecord[]): RidgeSnapshot {
  const memories: RidgeMemory[] = records.map((record) => ({
    id: record.key,
    title: record.label,
    planetId: record.owner ?? null,
  }));

  return {
    star: { name: "Archive" },
    planets: [],
    asteroids: memories.filter((memory) => memory.planetId == null),
  };
}
```

Keep fetching, authorization, attribution, and redaction in the host
application. Pass only the minimum display payload into a visualization.

## Deploy the demo

```bash
npm run build:demo   # emits demo/dist with relative asset paths (base: "./")
```

`demo/dist` is a fully static site — no server code, no environment
variables, no rewrite rules. Host it anywhere that can serve files:

- **GitHub Pages**: `npx gh-pages -d demo/dist`, or a Pages workflow that
  uploads `demo/dist`. The relative base means it works from a project
  subpath (`user.github.io/repo/`) out of the box.
- **Netlify / Vercel**: build command `npm run build:demo`, publish
  directory `demo/dist`.
- **Your own server**: copy the directory under any web root —
  `rsync -a demo/dist/ server:/var/www/ridge/` — and serve it as plain
  static files.

The demo ships synthetic data only; deploying it publishes no personal
content. When you wire the components to a real knowledge base, keep the
adapter and its data source in your host application (see the section
above) and deploy that application however you already deploy it — the
components themselves stay a static dependency.

## Pitfall log

These are implementation failures that look cosmetic at first and then consume
hours in production. Each entry records the visible symptom, the actual cause,
and the repair that held.

### SVG glow clipped into a box

**Symptom:** a blurred star or corona has straight, transparent edges above,
below, or beside the glow.

**Root cause:** an SVG filter uses a small default object bounding-box region.
It provides only about a 10% margin on each side, so a wide Gaussian blur is
discarded at the filter boundary. Enlarging the circle does not enlarge that
filter region enough.

**Fix:** give glow filters an explicit, generously padded region. For example,
`x="-70%" y="-70%" width="240%" height="240%"` works for a moderate blur;
`filterUnits="userSpaceOnUse"` is safer when the needed bounds are known in
scene coordinates. Test the glow at viewport edges, not only at the center.

### Transparent gradients eat clicks

**Symptom:** a planet is visible but cannot be selected, especially when it is
behind a corona or nebula overlay.

**Root cause:** visual transparency does not remove an SVG or HTML element from
hit testing. A fully transparent gradient can still sit above an interactive
node and become the event target.

**Fix:** set `pointer-events="none"` on every decorative layer. Add separate,
explicit hit targets for small objects, keep those targets above decoration,
and stop propagation only inside real interaction handlers.

### Sequential IDs produce identical rings

**Symptom:** planets with IDs such as `planet-01`, `planet-02`, and `planet-03`
receive suspiciously similar ring counts, tilts, or textures.

**Root cause:** raw FNV-1a is deterministic and fast, but its avalanche is weak
for inputs that differ only near the end. Mapping those correlated outputs into
a small number of visual buckets makes collisions obvious.

**Fix:** run a final avalanche mixer after FNV-1a. `src/core/hash.ts` uses the
MurmurHash3 `fmix32` sequence, then maps the unsigned result to `[0, 1)`. Use
different salts for unrelated visual properties. This is visual randomness,
not a security hash.

### Equirectangular skies show a seam or polar arcs

**Symptom:** the sky has a vertical join, duplicated stars, or concentric arcs
near the poles.

**Root cause:** an equirectangular texture joins at `u=0/1` and compresses many
texels into very little area near each pole. Discrete star dots expose both the
seam and the projection distortion.

**Fix:** reserve the equirectangular texture for seamless, low-frequency color
and noise. Match or cross-fade its horizontal edges. Render discrete stars as
real 3D `Points` distributed on a sphere so density does not collapse at the
poles.

### A PWA updates but keeps the old bundle

**Symptom:** the service worker and cache are new, yet an installed PWA keeps
running old JavaScript until the entire page is reloaded.

**Root cause:** updating a service worker does not replace code already
executing in the current document. Activation, control, and document navigation
are separate lifecycle steps.

**Fix:** call `registration.update()` when the app returns to the foreground,
detect `controllerchange` or a server build-ID mismatch, then perform one
guarded whole-page reload after the new worker controls the page. Store the
observed build ID to prevent reload loops, and retain old hashed assets during
the transition so existing documents do not request missing chunks.

### UnrealBloom is expensive at DPR 3

**Symptom:** the base scene is sharp on a high-density phone, but orbiting or
zooming stutters as soon as bloom is enabled.

**Root cause:** full-screen post-processing cost follows pixel count. DPR 3 is
roughly nine device pixels per CSS pixel for every full-resolution pass, and
UnrealBloom adds several blur render targets.

**Fix:** cap the effect composer's pixel ratio independently, usually at 1 to
2, while leaving the base renderer at the device ratio when sharp geometry is
important. Reduce bloom passes or disable them for constrained devices, and
measure render calls and frame time on real phones.

### `Points` render as square particles

**Symptom:** a star field looks like colored square confetti, even with additive
blending.

**Root cause:** a point primitive rasterizes a square point sprite. Without an
alpha mask, every fragment in that square remains visible.

**Fix:** attach a small radial-alpha texture, such as a `CanvasTexture`, to the
points material or sample it with `gl_PointCoord` in a shader. Use transparency,
disable depth writes for additive dust, and dispose generated textures and
materials when their owner unmounts.

### Force graphs tear around hubs

**Symptom:** highly connected memories pull the layout into long loose threads,
while low-degree relationships no longer read as close pairs.

**Root cause:** applying the same spring strength to every edge gives a hub far
more cumulative force than an ordinary node. Stronger global attraction hides
the problem only by collapsing the whole graph.

**Fix:** normalize each link by endpoint degree. A useful starting point is
`1 / max(1, min(degree(source), degree(target)))`, multiplied by edge weight.
Keep separate community and global centering forces, give isolated nodes a
slightly stronger community pull, and use deterministic initialization plus a
fixed iteration budget. If using `d3-force`, implement the same policy through
the link-strength accessor rather than assuming one constant fits every graph.

## Publication safety

Treat every release candidate as if its repository were already public. Before
publishing:

1. Scan source, fixtures, screenshots, source maps, and Git history for real
   names, private entity labels, hostnames, addresses, and local filesystem
   paths.
2. Reject real memory titles, previews, dates, relationship text, and database
   extracts. Examples must be synthetic.
3. Reject credentials, session material, authorization headers, signing files,
   environment files, and copied deployment configuration.
4. Confirm the demo generator has no network dependency and no fallback to a
   private endpoint.
5. Build from a clean checkout, inspect the emitted bundle, and repeat the scan
   against build artifacts before changing repository visibility.

A clean working tree is not proof of a clean history. Rewrite or replace any
leaked material before publication; deleting it in a later commit is not
sufficient.

## License

[MIT](LICENSE)
