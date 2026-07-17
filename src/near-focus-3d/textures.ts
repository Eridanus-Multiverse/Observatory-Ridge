import * as THREE from "three";
import { hash01 } from "../core/hash.js";

/**
 * Canvas-generated textures for Near Focus 3D. All deterministic; owners are
 * responsible for disposal (see useDisposableTexture in NearFocus3D).
 */

// PITFALL (README): point primitives rasterize as squares — every particle
// layer needs a radial alpha sprite or the sky turns into confetti.
export function makeSoftParticleTexture(size = 64): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.16, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.52, "rgba(255,255,255,0.24)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft core plus thin horizontal/vertical diffraction spikes — camera-lens bright stars. */
export function makeStarburstTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const center = size / 2;
  const core = context.createRadialGradient(center, center, 0, center, center, center * 0.32);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.35, "rgba(255,255,255,0.5)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = core;
  context.fillRect(0, 0, size, size);
  const spike = (angle: number, length: number, width: number) => {
    context.save();
    context.translate(center, center);
    context.rotate(angle);
    const gradient = context.createLinearGradient(-length, 0, length, 0);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.85)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(-length, -width / 2, length * 2, width);
    context.restore();
  };
  spike(0, center * 0.96, size * 0.022);
  spike(Math.PI / 2, center * 0.96, size * 0.022);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Horizontal lens-flare bar: long gradient masked by a vertical falloff. */
export function makeLensFlareTexture(width = 512, height = 40): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const horizontal = context.createLinearGradient(0, 0, width, 0);
  horizontal.addColorStop(0, "rgba(255,255,255,0)");
  horizontal.addColorStop(0.18, "rgba(255,255,255,0.12)");
  horizontal.addColorStop(0.5, "rgba(255,255,255,0.95)");
  horizontal.addColorStop(0.82, "rgba(255,255,255,0.12)");
  horizontal.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = horizontal;
  context.fillRect(0, 0, width, height);
  const vertical = context.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, "rgba(0,0,0,0)");
  vertical.addColorStop(0.5, "rgba(0,0,0,1)");
  vertical.addColorStop(1, "rgba(0,0,0,0)");
  context.globalCompositeOperation = "destination-in";
  context.fillStyle = vertical;
  context.fillRect(0, 0, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Deterministic value noise — same parameters always draw the same image. */
function valueNoiseFactory(seedSalt: number) {
  const lattice = (x: number, y: number) => {
    let hash = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seedSalt, 1442695041)) | 0;
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const a = lattice(x0, y0);
    const b = lattice(x0 + 1, y0);
    const c = lattice(x0, y0 + 1);
    const d = lattice(x0 + 1, y0 + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves = 4): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += noise(x * frequency, y * frequency) * amplitude;
    amplitude *= 0.5;
    frequency *= 2.05;
  }
  return value;
}

/**
 * Deep-sky dome texture: base color plus a faint galactic band glow only.
 * PITFALL (README): equirectangular textures pinch at the poles — discrete
 * stars belong to Points layers, the dome only carries seamless low-frequency
 * color so the projection distortion never shows.
 */
export function makeDeepSkyTexture(width = 2048, height = 1024): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#050c1f";
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = "lighter";
  const bandTint = "88,104,150";
  for (let x = 0; x < width; x += 4) {
    const u = x / width;
    const bandCenter = (0.5 + Math.sin(u * Math.PI * 2 + 0.8) * 0.14) * height;
    const gradient = context.createLinearGradient(0, bandCenter - height * 0.16, 0, bandCenter + height * 0.16);
    gradient.addColorStop(0, `rgba(${bandTint},0)`);
    gradient.addColorStop(0.5, `rgba(${bandTint},0.055)`);
    gradient.addColorStop(1, `rgba(${bandTint},0)`);
    context.fillStyle = gradient;
    context.fillRect(x, bandCenter - height * 0.16, 4, height * 0.32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/**
 * Moon surface with fbm rock grain and cratered basins (dark bowl, bright
 * rim). Plastic-ball satellites were the original sin — the fix is a surface
 * with a story on it. Five shared variants cover the whole scene.
 */
export function makeMoonSurfaceTexture(variant = 0, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const noise = valueNoiseFactory(811 + variant * 97);
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const base = fbm(noise, u * 6, v * 6, 4);
      const grain = fbm(noise, u * 18 + 9, v * 18 + 9, 3);
      const level = 150 + (base - 0.5) * 110 + (grain - 0.5) * 50;
      const offset = (y * size + x) * 4;
      const clamped = Math.max(70, Math.min(235, level));
      image.data[offset] = clamped;
      image.data[offset + 1] = clamped;
      image.data[offset + 2] = clamped;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const craterCount = 15 + variant * 2;
  for (let index = 0; index < craterCount; index += 1) {
    const seed = `moon-${variant}-crater-${index}`;
    const cx = hash01(seed, 907) * size;
    const cy = hash01(seed, 911) * size;
    const big = hash01(seed, 929) > 0.72;
    const radius = (big ? 14 : 4) + hash01(seed, 919) * (size * (big ? 0.13 : 0.07));
    const bowl = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
    bowl.addColorStop(0, "rgba(22,22,28,0.72)");
    bowl.addColorStop(0.68, "rgba(34,34,42,0.46)");
    bowl.addColorStop(0.86, "rgba(240,240,246,0.5)");
    bowl.addColorStop(1, "rgba(240,240,246,0)");
    context.fillStyle = bowl;
    context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Warp streak with a glowing head — shown while the camera is traveling. */
export function makeCourseStreakTexture(width = 160, height = 32): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const center = height / 2;
  const trail = context.createLinearGradient(0, 0, width, 0);
  trail.addColorStop(0, "rgba(255,255,255,0)");
  trail.addColorStop(0.24, "rgba(255,255,255,0.08)");
  trail.addColorStop(0.7, "rgba(255,255,255,0.34)");
  trail.addColorStop(0.9, "rgba(255,255,255,0.92)");
  trail.addColorStop(1, "rgba(255,255,255,0)");

  context.save();
  context.shadowColor = "rgba(105,174,255,0.72)";
  context.shadowBlur = height * 0.18;
  context.fillStyle = trail;
  context.beginPath();
  context.moveTo(width * 0.02, center);
  context.lineTo(width * 0.88, center - height * 0.075);
  context.quadraticCurveTo(width * 0.965, center, width * 0.88, center + height * 0.075);
  context.closePath();
  context.fill();
  context.restore();

  context.strokeStyle = trail;
  context.lineWidth = Math.max(1, height * 0.035);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(width * 0.08, center);
  context.lineTo(width * 0.94, center);
  context.stroke();

  const head = context.createRadialGradient(
    width * 0.91,
    center,
    0,
    width * 0.91,
    center,
    height * 0.28
  );
  head.addColorStop(0, "rgba(255,255,255,1)");
  head.addColorStop(0.24, "rgba(255,255,255,0.78)");
  head.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = head;
  context.fillRect(width * 0.84, center - height * 0.3, height * 0.6, height * 0.6);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
