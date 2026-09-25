// Rules are passed around as bitmasks: bit n set means count n is in the list.
// Same layout as the masks the C++ bindings take.

export const maxNeighbors = is3D => (is3D ? 26 : 8);

export function maskToCounts(mask) {
  const counts = [];
  for (let n = 0; n <= 26; n++) if (mask & (1 << n)) counts.push(n);
  return counts;
}

export function countsToMask(counts) {
  let mask = 0;
  for (const n of counts) mask |= 1 << n;
  return mask >>> 0;
}

// same format as ruleString() in main.cpp: "B3/S23", with commas once any
// count has two digits
export function ruleString(birth, survival) {
  const B = maskToCounts(birth);
  const S = maskToCounts(survival);
  const commas = [...B, ...S].some(n => n >= 10);
  const sep = commas ? ',' : '';
  return `B${B.join(sep)}/S${S.join(sep)}`;
}

// parses "B3/S23", "b36/s23", "S23/B3", "B5/S4,5" or "B13-14,17-19/S13-26".
// Returns null if it can't be read or uses counts above maxN
export function parseRule(text, maxN) {
  const t = text.trim().toUpperCase().replace(/\s+/g, '');
  const m = t.match(/^(?:B([0-9,\-]*)\/S([0-9,\-]*)|S([0-9,\-]*)\/B([0-9,\-]*))$/);
  if (!m) return null;
  const b = m[1] ?? m[4];
  const s = m[2] ?? m[3];
  const bm = parseCounts(b, maxN);
  const sm = parseCounts(s, maxN);
  if (bm === null || sm === null) return null;
  return { birth: bm, survival: sm };
}

function parseCounts(str, maxN) {
  if (!str) return 0;
  let mask = 0;
  // without commas or ranges, every digit is its own count (the 2D style)
  if (!/[,\-]/.test(str)) {
    for (const ch of str) {
      const n = +ch;
      if (n > maxN) return null;
      mask |= 1 << n;
    }
    return mask >>> 0;
  }
  for (const part of str.split(',')) {
    if (!part) continue;
    const range = part.split('-');
    if (range.length > 2 || range.some(r => r === '')) return null;
    const lo = +range[0];
    const hi = +(range[1] ?? range[0]);
    if (hi < lo || hi > maxN) return null;
    for (let n = lo; n <= hi; n++) mask |= 1 << n;
  }
  return mask >>> 0;
}

// share of the 2(N+1) rule entries that produce a live cell
export function lambda(birth, survival, maxN) {
  return (maskToCounts(birth).length + maskToCounts(survival).length) / (2 * (maxN + 1));
}

function listPhrase(counts) {
  if (counts.length === 0) return null;
  if (counts.length === 1) return `${counts[0]}`;
  return `${counts.slice(0, -1).join(', ')} or ${counts[counts.length - 1]}`;
}

export function describeRule(birth, survival, maxN) {
  const B = maskToCounts(birth);
  const S = maskToCounts(survival);
  const born = B.length === 0
    ? 'Nothing is ever <b>born</b>.'
    : B.length === maxN + 1
      ? 'Every dead cell is <b>born</b>.'
      : `A dead cell with <b>${listPhrase(B)}</b> live neighbour${B.length === 1 && B[0] === 1 ? '' : 's'} is born.`;
  const lives = S.length === 0
    ? 'Every live cell <b>dies</b> the next step.'
    : S.length === maxN + 1
      ? 'Live cells <b>never die</b>.'
      : `A live cell with <b>${listPhrase(S)}</b> survives; any other count kills it.`;
  const warn = birth & 1 ? ' <span style="color:#fbbf24">B0 makes empty space flash on, so expect strobing.</span>' : '';
  return `${born} ${lives}${warn}`;
}

const R = (b, s) => ({ birth: countsToMask(b), survival: countsToMask(s) });
const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

export const presets2D = [
  { name: "Conway's Life", ...R([3], [2, 3]) },
  { name: 'HighLife', ...R([3, 6], [2, 3]) },
  { name: 'Seeds', ...R([2], []), density: 0.05 },
  { name: 'Day & Night', ...R([3, 6, 7, 8], [3, 4, 6, 7, 8]), density: 0.5 },
  { name: 'Life without Death', ...R([3], range(0, 8)), density: 0.08 },
  { name: 'Maze', ...R([3], [1, 2, 3, 4, 5]), density: 0.08 },
  { name: 'Morley (Move)', ...R([3, 6, 8], [2, 4, 5]) },
  { name: '2x2', ...R([3, 6], [1, 2, 5]) },
  { name: 'Replicator', ...R([1, 3, 5, 7], [1, 3, 5, 7]), density: 0.02 },
  { name: 'Diamoeba', ...R([3, 5, 6, 7, 8], [5, 6, 7, 8]), density: 0.5 },
  { name: 'Anneal', ...R([4, 6, 7, 8], [3, 5, 6, 7, 8]), density: 0.5 },
  { name: 'Coral', ...R([3], [4, 5, 6, 7, 8]) },
  { name: 'Gnarl', ...R([1], [1]), density: 0.01 },
];

// start states picked by running each rule on a 32^3 grid and keeping ones
// that do something visible for at least a hundred generations
export const presets3D = [
  { name: "Bays' Life 4555", ...R([5], [4, 5]), density: 0.45, blob: 0.6 },
  { name: "Bays' Life 5766", ...R([6], [5, 6, 7]), density: 0.3, blob: 1 },
  { name: 'Clouds', ...R([13, 14, 17, 18, 19], range(13, 26)), density: 0.5, blob: 0.9 },
  { name: 'Amoeba growth', ...R([6], [5, 6, 7, 8]), density: 0.3, blob: 0.3 },
  { name: 'Crystal', ...R([6], [4, 5, 6, 7, 8]), density: 0.2, blob: 0.3 },
  { name: 'Coral growth', ...R([5, 6, 7], range(5, 11)), density: 0.06, blob: 0.4 },
  { name: 'Boiling', ...R([4, 5], [5]), density: 0.2, blob: 0.3 },
  { name: "Conway's numbers in 3D", ...R([3], [2, 3]), density: 0.1, blob: 1 },
];
