// A few well-known 2D patterns to stamp onto the grid, in RLE
// (b = dead, o = alive, $ = end of row, a number repeats the next symbol).

export const patterns = [
  { name: 'Glider', rule: 'B3/S23', rle: 'bob$2bo$3o!' },
  { name: 'Lightweight spaceship', rule: 'B3/S23', rle: 'bo2bo$o4b$o3bo$4o!' },
  { name: 'R-pentomino', rule: 'B3/S23', rle: 'b2o$2ob$bo!' },
  { name: 'Acorn', rule: 'B3/S23', rle: 'bo5b$3bo3b$2o2b3o!' },
  { name: 'Pulsar', rule: 'B3/S23', rle: '2b3o3b3o2b2$o4bobo4bo$o4bobo4bo$o4bobo4bo$2b3o3b3o2b2$2b3o3b3o2b$o4bobo4bo$o4bobo4bo$o4bobo4bo2$2b3o3b3o!' },
  { name: 'Gosper glider gun', rule: 'B3/S23', rle: '24bo11b$22bobo11b$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o14b$2o8bo3bob2o4bobo11b$10bo5bo7bo11b$11bo3bo20b$12b2o!' },
  { name: 'Diehard', rule: 'B3/S23', rle: '6bob$2o6b$bo3b3o!' },
  { name: 'HighLife replicator', rule: 'B36/S23', rle: '2b3o$bo2bo$o3bo$o2bob$3o!' },
];

// returns a list of [x, y] live cells
export function parseRLE(rle) {
  const cells = [];
  let x = 0;
  let y = 0;
  let num = '';
  for (const ch of rle) {
    if (ch >= '0' && ch <= '9') { num += ch; continue; }
    const n = num ? parseInt(num, 10) : 1;
    num = '';
    if (ch === 'b') x += n;
    else if (ch === 'o') { for (let i = 0; i < n; i++) cells.push([x + i, y]); x += n; }
    else if (ch === '$') { y += n; x = 0; }
    else if (ch === '!') break;
  }
  return cells;
}

// rotates cells a quarter turn clockwise `turns` times, keeping them at >= 0
export function rotate(cells, turns) {
  let out = cells;
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
    const maxY = Math.max(...out.map(c => c[1]));
    out = out.map(([x, y]) => [maxY - y, x]);
  }
  return out;
}
