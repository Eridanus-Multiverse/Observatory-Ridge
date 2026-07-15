import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import GalaxyView from "../../src/galaxy-view/GalaxyView";
import NearFocus2D from "../../src/near-focus-2d/NearFocus2D";
import NearFocus3D from "../../src/near-focus-3d/NearFocus3D";
import { demoGraph, demoSnapshot } from "./demo-data";

const snapshot = demoSnapshot();
const graph = demoGraph();

type Tab = "galaxy" | "near2d" | "near3d";

function App() {
  const [tab, setTab] = useState<Tab>("galaxy");
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "galaxy", label: "Galaxy View" },
    { key: "near2d", label: "Near Focus 2D" },
    { key: "near3d", label: "Near Focus 3D" },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#000", color: "#cdd8ea", fontFamily: "ui-monospace, monospace" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid rgba(120,150,190,0.16)" }}>
        <strong style={{ fontSize: 13, letterSpacing: 1 }}>Observatory Ridge</strong>
        <span style={{ opacity: 0.4, fontSize: 10 }}>demo · synthetic data</span>
        <nav style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              style={{
                padding: "4px 10px", fontSize: 11, cursor: "pointer",
                background: tab === item.key ? "rgba(255,223,146,0.14)" : "transparent",
                color: tab === item.key ? "#ffdf92" : "#8fa0b8",
                border: `1px solid ${tab === item.key ? "rgba(255,223,146,0.4)" : "rgba(120,150,190,0.25)"}`,
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <main style={{ flex: 1, minHeight: 0 }}>
        {tab === "galaxy" ? <GalaxyView graph={graph} /> : tab === "near2d" ? <NearFocus2D snapshot={snapshot} /> : <NearFocus3D snapshot={snapshot} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
