import { lazy, StrictMode, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { demoGraph, demoSnapshot } from "./demo-data";
import "./styles.css";

const GalaxyView = lazy(() => import("../../src/galaxy-view/GalaxyView"));
const NearFocus2D = lazy(() => import("../../src/near-focus-2d/NearFocus2D"));
const NearFocus3D = lazy(() => import("../../src/near-focus-3d/NearFocus3D"));

const snapshot = demoSnapshot();
const graph = demoGraph();

type Tab = "galaxy" | "near2d" | "near3d";

function App() {
  const [tab, setTab] = useState<Tab>("galaxy");
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
          {tab === "galaxy" ? <GalaxyView graph={graph} /> : tab === "near2d" ? <NearFocus2D snapshot={snapshot} /> : <NearFocus3D snapshot={snapshot} />}
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
