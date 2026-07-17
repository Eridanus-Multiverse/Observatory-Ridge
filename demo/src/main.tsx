import { lazy, StrictMode, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import type { NearFocus3DSelection } from "../../src/near-focus-3d/NearFocus3D";
import { demoGraph, demoSnapshot } from "./demo-data";
import "./styles.css";

const GalaxyView = lazy(() => import("../../src/galaxy-view/GalaxyView"));
const NearFocus2D = lazy(() => import("../../src/near-focus-2d/NearFocus2D"));
const NearFocus3D = lazy(() => import("../../src/near-focus-3d/NearFocus3D"));

/** Same visual language as NearFocus2D's built-in card, so 2D and 3D feel
 * like the same product. */
function Detail3DCard({ selection, asteroidCount }: { selection: NearFocus3DSelection; asteroidCount: number }) {
  return (
    <div
      aria-live="polite"
      style={{ borderTop: "1px solid rgba(255,223,146,0.12)", background: "rgba(2,4,8,0.9)", padding: "8px 14px 10px", minHeight: 72, color: "#cdd8ea", fontSize: 11 }}
    >
      {selection?.kind === "planet" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ color: "#efede6", fontSize: 12 }}>{selection.planet.name}</span>
            <span style={{ marginLeft: "auto", opacity: 0.55, fontSize: 9 }}>{selection.planet.memoryCount} memories</span>
          </div>
          {selection.planet.definition && (
            <div style={{ marginTop: 5, opacity: 0.8, lineHeight: 1.5 }}>{selection.planet.definition}</div>
          )}
          {(selection.planet.memories || []).slice(0, 3).map((m) => (
            <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 5 }}>
              <span style={{ opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
              <span style={{ opacity: 0.4, flexShrink: 0, fontSize: 9 }}>{m.date || ""}</span>
            </div>
          ))}
        </>
      ) : selection?.kind === "star" ? (
        <>
          <div style={{ color: "#efede6", fontSize: 12 }}>{snapshot.star.name}</div>
          {snapshot.star.definition && <div style={{ marginTop: 5, opacity: 0.8 }}>{snapshot.star.definition}</div>}
          <div style={{ marginTop: 5, opacity: 0.55, fontSize: 9 }}>{asteroidCount} unattributed memories in the belt.</div>
        </>
      ) : (
        <div style={{ opacity: 0.5 }}>Tap the star or a planet — its memories appear here.</div>
      )}
    </div>
  );
}

const snapshot = demoSnapshot();
const graph = demoGraph();

type Tab = "galaxy" | "near2d" | "near3d";

function App() {
  const [tab, setTab] = useState<Tab>("galaxy");
  const [sel3d, setSel3d] = useState<NearFocus3DSelection>(null);
  const tabs: Array<{ key: Tab; label: string; shortLabel: string }> = [
    { key: "galaxy", label: "Galaxy View", shortLabel: "Galaxy" },
    { key: "near2d", label: "Near Focus 2D", shortLabel: "2D" },
    { key: "near3d", label: "Near Focus 3D", shortLabel: "3D" },
  ];
  return (
    <div className="app-shell">
      <header className="app-header">
        <strong className="app-title">Observatory Ridge</strong>
        <span className="app-subtitle">demo · synthetic data</span>
        <nav className="view-tabs" aria-label="Visualization">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`view-tab${tab === item.key ? " is-active" : ""}`}
              aria-pressed={tab === item.key}
            >
              <span className="tab-label-full">{item.label}</span>
              <span className="tab-label-short">{item.shortLabel}</span>
            </button>
          ))}
        </nav>
      </header>
      <main className="view-stage">
        <Suspense fallback={<div className="loading-state" role="status">Loading view…</div>}>
          {tab === "galaxy" ? (
            <GalaxyView graph={graph} />
          ) : tab === "near2d" ? (
            <NearFocus2D snapshot={snapshot} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                <NearFocus3D snapshot={snapshot} onSelect={setSel3d} />
              </div>
              <Detail3DCard selection={sel3d} asteroidCount={snapshot.asteroids.length} />
            </div>
          )}
        </Suspense>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
