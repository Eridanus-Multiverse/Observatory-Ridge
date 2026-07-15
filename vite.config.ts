import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const PEER_DEPENDENCIES = [
  "@react-three/drei",
  "@react-three/fiber",
  "react",
  "react-dom",
  "react/jsx-runtime",
  "three",
];

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "observatory-ridge",
    },
    rollupOptions: {
      external: PEER_DEPENDENCIES,
    },
  },
});
