// Colours for cells by age: just born / just drawn is white, then it cools
// through sky blue down to a deep blue. Dead cells leave a fading trail.

export const AGE_MAX = 64;
export const TRAIL_MAX = 28;
export const BACKGROUND = [5, 12, 28];

const AGE_STOPS = [
  [0, '#ffffff'],
  [1, '#dff6ff'],
  [3, '#9fe1ff'],
  [6, '#4cc4fb'],
  [12, '#2f95f0'],
  [24, '#2b6ae0'],
  [40, '#2449b8'],
  [64, '#1c3486'],
];

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function ramp(stops, size) {
  const out = [];
  for (let a = 0; a <= size; a++) {
    let i = 0;
    while (i < stops.length - 2 && a > stops[i + 1][0]) i++;
    const [a0, c0] = stops[i];
    const [a1, c1] = stops[i + 1];
    const t = Math.min(1, Math.max(0, (a - a0) / (a1 - a0)));
    out.push(mix(hex(c0), hex(c1), t));
  }
  return out;
}

// ageRGB[a] for a live cell that is a generations old
export const ageRGB = ramp(AGE_STOPS, AGE_MAX);

// trailRGB[t] for a cell that died t generations ago, blended into the background
export const trailRGB = Array.from({ length: TRAIL_MAX + 1 }, (_, t) => {
  const k = t === 0 ? 0 : Math.pow(1 - t / TRAIL_MAX, 1.6) * 0.42;
  return mix(BACKGROUND, hex('#2f6fe0'), k);
});

export function ageGradientCSS() {
  const stops = AGE_STOPS.map(([a, c]) => `${c} ${(a / AGE_MAX) * 100}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export const CATEGORIES = [
  { key: 'stable', color: '#9085e9', shape: 'circle', desc: 'Settles into a still life (period 1)' },
  { key: 'oscillating', color: '#008300', shape: 'square', desc: 'Falls into a repeating cycle' },
  { key: 'chaotic', color: '#d55181', shape: 'triangle', desc: 'Never repeats, high local entropy' },
  { key: 'complex', color: '#c98500', shape: 'diamond', desc: 'Never repeats, but structured' },
];

// Keeps per-cell ages up to date. Call update() with the new grid after each
// frame's steps; drawn cells are reset to age 0 with touch().
export class AgeTracker {
  constructor(size) {
    this.size = size;
    this.prev = new Uint8Array(size);
    // >= 0: live cell's age. < 0: -(generations since it died), 0 = never lived
    this.age = new Int16Array(size);
  }

  // a freshly loaded grid starts a few generations "old", so only cells that
  // are drawn or born afterwards show up white
  reset(cells, startAge = 6) {
    this.prev.set(cells);
    for (let i = 0; i < this.size; i++) this.age[i] = cells[i] ? startAge : -TRAIL_MAX - 1;
  }

  update(cells, gens) {
    const { prev, age } = this;
    for (let i = 0; i < this.size; i++) {
      const alive = cells[i];
      if (alive) {
        if (prev[i]) age[i] = Math.min(AGE_MAX, age[i] + gens);
        else age[i] = gens > 1 ? Math.min(AGE_MAX, gens - 1) : 0;
      } else if (prev[i]) {
        age[i] = -1;
      } else if (age[i] > -TRAIL_MAX - 1) {
        age[i] = Math.max(-TRAIL_MAX - 1, age[i] - gens);
      }
    }
    prev.set(cells);
  }

  touch(i, alive) {
    this.prev[i] = alive ? 1 : 0;
    this.age[i] = alive ? 0 : -1;
  }
}
