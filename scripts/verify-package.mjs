import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const expectedExports = [
  "GalaxyView",
  "NearFocus2D",
  "NearFocus3D",
  "SOLAR_STAR_THEME",
  "hash01",
  "solarSystemSnapshot",
];

execFileSync("npm", ["run", "build:lib"], { stdio: "inherit" });
execFileSync(join(process.cwd(), "node_modules", ".bin", "tsc"), [
  "--noEmit",
  "--skipLibCheck", "false",
  "--module", "NodeNext",
  "--moduleResolution", "NodeNext",
  "--target", "ES2022",
  "--jsx", "react-jsx",
  "dist/types/index.d.ts",
], { stdio: "inherit" });
const pack = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--silent"], { encoding: "utf8" }));
const paths = new Set(pack[0].files.map((file) => file.path));
for (const path of ["dist/observatory-ridge.js", "dist/types/index.d.ts", "LICENSE", "README.md"]) {
  assert.ok(paths.has(path), `missing packed file: ${path}`);
}
for (const path of paths) {
  assert.ok(!path.startsWith("node_modules/"), `dependency leaked into package: ${path}`);
  assert.ok(!path.startsWith("demo/"), `demo artifact leaked into package: ${path}`);
}

const scratch = await mkdtemp(join(process.cwd(), ".pack-smoke-"));
const tarball = join(process.cwd(), pack[0].filename);
try {
  execFileSync("tar", ["-xzf", tarball, "-C", scratch]);
  const manifest = JSON.parse(await readFile(join(scratch, "package", "package.json"), "utf8"));
  const entry = join(scratch, "package", manifest.exports["."].import);
  const module = await import(pathToFileURL(entry).href);
  for (const name of expectedExports) {
    assert.ok(name in module, `missing packed export: ${name}`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
  await rm(tarball, { force: true });
}

console.log(`package smoke passed: ${pack[0].filename} (${paths.size} files, extracted import ok)`);
