// Wires the C++ simulator (compiled to wasm) to the viewer, rule editor and survey.
import createLifeModule from '../wasm/life.js';
import { View2D } from './view2d.js';
import { AgeTracker, ageGradientCSS, CATEGORIES } from './palette.js';
import { presets2D, presets3D, ruleString, parseRule, describeRule, maxNeighbors, maskToCounts } from './rules.js';
import { patterns, parseRLE, rotate } from './patterns.js';
import { Survey } from './survey.js';

const $ = id => document.getElementById(id);
const SPEEDS = [1, 2, 5, 10, 20, 30, 60, 120, 240, Infinity];
const SIZES = {
  false: [[64, 64], [96, 64], [128, 80], [160, 100], [200, 125], [256, 160], [256, 256], [400, 250]],
  true: [[16, 16, 16], [24, 24, 24], [32, 32, 32], [40, 40, 40], [48, 48, 48], [64, 64, 64]],
};
const DEFAULT_SIZE = { false: '160×100', true: '32×32×32' };
const sizeKey = s => s.join('×');

const M = await createLifeModule();
$('loading').remove();

// per-dimension state, so flipping between 2D and 3D keeps both worlds
const worlds = {
  false: { size: DEFAULT_SIZE.false, preset: presets2D[0], density: 0.25, blob: 1, speed: 5 },
  true: { size: DEFAULT_SIZE.true, preset: presets3D[3], density: 0.3, blob: 0.3, speed: 3 },
};
let is3D = false;
let world = null; // worlds[is3D]
let running = false;
let view3d = null;
let stampTurns = 0;
let stampBase = null;
let dirty = true;

const view2d = new View2D($('canvas2d'), {
  isAlive: (x, y) => world.sim.get(x, y, 0),
  onPaint: (x, y, alive) => edit(x, y, 0, alive),
  onStamp: (x, y, cells) => {
    for (const [sx, sy] of cells) edit((x + sx) % world.w, (y + sy) % world.h, 0, true);
  },
});

// ---------- world management ----------

function makeWorld(state, key) {
  const dims = key.split('×').map(Number);
  const [w, h, d = 1] = dims;
  state.sim?.delete();
  state.sim = new M.Simulator(w, h, d, is3D);
  state.w = w;
  state.h = h;
  state.d = d;
  state.size = key;
  state.tracker = new AgeTracker(w * h * d);
  state.history = [];
  state.snapshot = null;
  state.sim.setRule(state.birth ?? state.preset.birth, state.survival ?? state.preset.survival);
}

function setMode(to3D) {
  if (world && to3D === is3D) return;
  is3D = to3D;
  world = worlds[is3D];
  const fresh = !world.sim;
  if (fresh) makeWorld(world, world.size);

  $('mode2d').classList.toggle('active', !is3D);
  $('mode3d').classList.toggle('active', is3D);
  $('mode2d').setAttribute('aria-selected', String(!is3D));
  $('mode3d').setAttribute('aria-selected', String(is3D));
  document.querySelector('.mode-switch').classList.toggle('is3d', is3D);
  $('canvas2d').hidden = is3D;
  $('stage3d').hidden = !is3D;
  $('tools2d').hidden = is3D;
  $('tools3d').hidden = !is3D;
  $('blobRow').hidden = !is3D;
  $('gridLinesRow').hidden = is3D;

  buildChips();
  buildPresets();
  buildSizes();
  $('density').value = world.density;
  $('blob').value = world.blob;
  $('speed').value = world.speed;
  syncOutputs();

  if (is3D) ensure3D().then(() => afterResize(fresh));
  else afterResize(fresh);
}

// three.js is only loaded the first time 3D is opened
let view3dReady = null;
function ensure3D() {
  view3dReady ??= import('./view3d.js').then(({ View3D }) => {
    view3d = new View3D($('stage3d'), {
      onEdit: (x, y, z, alive) => edit(x, y, z, alive),
      isAlive: (x, y, z) => world.tracker.prev[(z * world.h + y) * world.w + x] === 1,
    });
    view3d.options.trails = $('trails').checked;
    view3d.resize();
  });
  return view3dReady;
}

// after the grid changes size (or the mode flips)
function afterResize(randomizeNow) {
  if (is3D) {
    view3d.setSize(world.w, world.h, world.d);
    $('layer').max = world.d - 1;
    $('layer').value = Math.min(+$('layer').value, world.d - 1);
    if (randomizeNow) $('layer').value = Math.floor(world.d / 2);
    view3d.setLayer(+$('layer').value);
    view3d.resize();
  } else {
    view2d.setSize(world.w, world.h);
  }
  if (randomizeNow) randomize();
  else { world.tracker.reset(world.sim.cells()); dirty = true; }
  syncRule();
  syncHint();
}

function changeSize(key) {
  makeWorld(world, key);
  afterResize(true);
}

// ---------- editing ----------

function edit(x, y, z, alive) {
  world.sim.set(x, y, z, alive);
  world.tracker.touch((z * world.h + y) * world.w + x, alive);
  if (world.sim.generation() === 0) world.snapshot = null;
  dirty = true;
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomize() {
  const density = +$('density').value;
  const seed = +$('seed').value >>> 0;
  const blob = is3D ? +$('blob').value : 1;
  if (blob >= 1) {
    world.sim.randomize(density, seed);
  } else {
    // only fill a cube in the middle; the engine's randomize() fills everything
    const { w, h, d } = world;
    const cells = new Uint8Array(w * h * d);
    const rnd = mulberry32(seed);
    const bw = Math.max(1, Math.round(w * blob));
    const bh = Math.max(1, Math.round(h * blob));
    const bd = Math.max(1, Math.round(d * blob));
    const x0 = (w - bw) >> 1, y0 = (h - bh) >> 1, z0 = (d - bd) >> 1;
    for (let z = z0; z < z0 + bd; z++)
      for (let y = y0; y < y0 + bh; y++)
        for (let x = x0; x < x0 + bw; x++)
          cells[(z * h + y) * w + x] = rnd() < density ? 1 : 0;
    world.sim.clear();
    world.sim.load(cells);
  }
  afterStateLoad();
}

function afterStateLoad() {
  world.snapshot = null;
  world.history = [];
  world.tracker.reset(world.sim.cells());
  dirty = true;
  updateStats(0);
}

function clearGrid() {
  world.sim.clear();
  afterStateLoad();
}

function reset() {
  if (!world.snapshot) return;
  world.sim.clear();
  world.sim.load(world.snapshot);
  afterStateLoad();
}

// ---------- stepping ----------

let msPerStep = 1;
function step(n) {
  if (n <= 0) return;
  if (world.sim.generation() === 0 && !world.snapshot) world.snapshot = new Uint8Array(world.sim.cells());
  const t = performance.now();
  world.sim.step(n);
  msPerStep = msPerStep * 0.8 + ((performance.now() - t) / n) * 0.2;
  world.tracker.update(world.sim.cells(), n);
  dirty = true;
  stepsThisSecond += n;
}

function setRunning(on) {
  running = on;
  $('playLabel').textContent = on ? 'Pause' : 'Play';
  $('playIcon').innerHTML = on ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
}

let accum = 0;
let last = performance.now();
let stepsThisSecond = 0;
let secondStart = performance.now();
let measuredRate = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running) {
    const speed = SPEEDS[world.speed];
    let n;
    if (speed === Infinity) n = Math.max(1, Math.floor(14 / Math.max(msPerStep, 0.01)));
    else {
      accum += dt * speed;
      n = Math.floor(accum);
      accum -= n;
      n = Math.min(n, Math.max(1, Math.floor(30 / Math.max(msPerStep, 0.01))));
    }
    if (n > 0) step(n);
  }
  if (now - secondStart >= 500) {
    measuredRate = (stepsThisSecond * 1000) / (now - secondStart);
    stepsThisSecond = 0;
    secondStart = now;
    $('statFps').textContent = `${measuredRate < 10 ? measuredRate.toFixed(1) : Math.round(measuredRate)} gen/s`;
  }
  if (dirty) {
    updateStats();
    if (is3D) view3d?.update(world.tracker);
    else view2d.render(world.tracker);
    dirty = false;
  } else if (!is3D && view2d.dirty) {
    view2d.render(world.tracker);
  }
  if (is3D && view3d) view3d.render();
  requestAnimationFrame(frame);
}

// ---------- stats ----------

function updateStats(forceGen) {
  const gen = forceGen ?? world.sim.generation();
  const pop = world.sim.population();
  const total = world.w * world.h * world.d;
  $('statGen').textContent = gen.toLocaleString();
  $('statPop').textContent = pop.toLocaleString();
  $('statDensity').textContent = `${((100 * pop) / total).toFixed(1)}%`;
  const hist = world.history;
  if (!hist.length || hist[hist.length - 1][0] !== gen) hist.push([gen, pop / total]);
  if (hist.length > 240) hist.splice(0, hist.length - 240);
  drawSparkline();
}

function drawSparkline() {
  const c = $('sparkline');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(c.clientWidth * dpr);
  const H = Math.round(c.clientHeight * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const hist = world.history;
  if (hist.length < 2) return;
  const max = Math.max(0.01, ...hist.map(h => h[1])) * 1.1;
  const x = i => (i / 239) * W;
  const y = v => H - (v / max) * (H - 4 * dpr) - 2 * dpr;
  ctx.beginPath();
  hist.forEach(([, v], i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  const line = new Path2D();
  hist.forEach(([, v], i) => (i ? line.lineTo(x(i), y(v)) : line.moveTo(x(i), y(v))));
  ctx.lineTo(x(hist.length - 1), H);
  ctx.lineTo(0, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(56,189,248,0.35)');
  g.addColorStop(1, 'rgba(56,189,248,0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#7dd3fc';
  ctx.lineWidth = 2 * dpr;
  ctx.lineJoin = 'round';
  ctx.stroke(line);
  const [, lv] = hist[hist.length - 1];
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x(hist.length - 1), y(lv), 3 * dpr, 0, Math.PI * 2);
  ctx.fill();
}

// ---------- rule editor ----------

function setRule(birth, survival) {
  world.birth = birth >>> 0;
  world.survival = survival >>> 0;
  world.sim.setRule(world.birth, world.survival);
  syncRule();
}

function buildChips() {
  const maxN = maxNeighbors(is3D);
  for (const [id, kind] of [['birthChips', 'b'], ['survivalChips', 's']]) {
    const box = $(id);
    box.classList.toggle('dense', is3D);
    box.replaceChildren();
    for (let n = 0; n <= maxN; n++) {
      const chip = document.createElement('button');
      chip.className = `chip ${kind}`;
      chip.dataset.n = n;
      chip.title = kind === 'b'
        ? `Dead cell with ${n} live neighbour${n === 1 ? '' : 's'} is born`
        : `Live cell with ${n} live neighbour${n === 1 ? '' : 's'} survives`;
      if (!is3D) {
        // tiny 3x3 neighbourhood with n neighbours lit
        const mini = document.createElement('span');
        mini.className = 'mini';
        const order = [0, 1, 2, 5, 8, 7, 6, 3];
        const on = new Set(order.slice(0, n));
        for (let k = 0; k < 9; k++) {
          const i = document.createElement('i');
          if (k === 4) i.className = 'center';
          else if (on.has(k)) i.className = 'on';
          mini.append(i);
        }
        chip.append(mini);
      }
      chip.append(String(n));
      chip.onclick = () => {
        const bit = 1 << n;
        if (kind === 'b') setRule(world.birth ^ bit, world.survival);
        else setRule(world.birth, world.survival ^ bit);
      };
      box.append(chip);
    }
  }
}

function buildPresets() {
  const sel = $('presetSelect');
  sel.replaceChildren(new Option('Custom rule', ''));
  (is3D ? presets3D : presets2D).forEach((p, i) => sel.append(new Option(`${p.name}  ·  ${ruleString(p.birth, p.survival)}`, i)));
}

function syncRule() {
  world.birth ??= world.sim.birthMask();
  world.survival ??= world.sim.survivalMask();
  const { birth, survival } = world;
  for (const c of $('birthChips').children) c.classList.toggle('on', !!(birth & (1 << c.dataset.n)));
  for (const c of $('survivalChips').children) c.classList.toggle('on', !!(survival & (1 << c.dataset.n)));
  const input = $('ruleInput');
  if (document.activeElement !== input) input.value = ruleString(birth, survival);
  input.classList.remove('bad');
  $('ruleSummary').innerHTML = describeRule(birth, survival, maxNeighbors(is3D));
  const presets = is3D ? presets3D : presets2D;
  const idx = presets.findIndex(p => p.birth === birth && p.survival === survival);
  $('presetSelect').value = idx >= 0 ? String(idx) : '';
}

function applyPreset(p) {
  setRule(p.birth, p.survival);
  if (p.density) { $('density').value = p.density; world.density = p.density; }
  if (is3D) { const b = p.blob ?? 1; $('blob').value = b; world.blob = b; }
  syncOutputs();
  randomize();
}

// ---------- ui plumbing ----------

function buildSizes() {
  const sel = $('gridSize');
  sel.replaceChildren();
  const opts = SIZES[is3D].map(sizeKey);
  if (!opts.includes(world.size)) opts.push(world.size);
  for (const k of opts) sel.append(new Option(is3D && new Set(k.split('×')).size === 1 ? `${k.split('×')[0]}³` : k.replace(/×/g, ' × '), k));
  sel.value = world.size;
}

function syncOutputs() {
  const s = SPEEDS[+$('speed').value];
  $('speedOut').textContent = s === Infinity ? 'max' : `${s} gen/s`;
  $('densityOut').textContent = `${Math.round(+$('density').value * 100)}%`;
  const b = +$('blob').value;
  $('blobOut').textContent = b >= 1 ? 'whole grid' : `${Math.round(b * 100)}% cube`;
  $('layerOut').textContent = $('layer').value;
}

function syncHint() {
  const dims = is3D ? `${world.w}×${world.h}×${world.d}` : `${world.w}×${world.h}`;
  const total = (world.w * world.h * world.d).toLocaleString();
  $('stageHint').textContent = is3D
    ? `${dims} · ${total} cells · layer ${$('layer').value}`
    : `${dims} · ${total} cells · wraps at the edges`;
}

function banner(html) {
  $('bannerText').innerHTML = html;
  $('banner').hidden = !html;
}

function bindUI() {
  $('mode2d').onclick = () => setMode(false);
  $('mode3d').onclick = () => setMode(true);
  $('playBtn').onclick = () => setRunning(!running);
  $('stepBtn').onclick = () => { setRunning(false); step(1); };
  $('resetBtn').onclick = () => { setRunning(false); reset(); };
  $('clearBtn').onclick = () => { setRunning(false); clearGrid(); };
  $('randomizeBtn').onclick = randomize;
  $('newSeedBtn').onclick = () => { $('seed').value = Math.floor(Math.random() * 1e6); randomize(); };
  $('speed').oninput = () => { world.speed = +$('speed').value; syncOutputs(); };
  $('density').oninput = () => { world.density = +$('density').value; syncOutputs(); };
  $('density').onchange = randomize;
  $('blob').oninput = () => { world.blob = +$('blob').value; syncOutputs(); };
  $('blob').onchange = randomize;
  $('gridSize').onchange = () => changeSize($('gridSize').value);
  $('presetSelect').onchange = () => {
    const v = $('presetSelect').value;
    if (v !== '') applyPreset((is3D ? presets3D : presets2D)[+v]);
  };
  $('randomRuleBtn').onclick = () => {
    const maxN = maxNeighbors(is3D);
    // uniform bits in 2D like the survey; sparser in 3D, where uniform rules
    // are almost always chaotic
    const p = is3D ? 0.14 : 0.5;
    let b = 0, s = 0;
    for (let n = 0; n <= maxN; n++) {
      if (Math.random() < p && n > 0) b |= 1 << n;
      if (Math.random() < p) s |= 1 << n;
    }
    setRule(b, s);
    randomize();
  };
  const ruleInput = $('ruleInput');
  const tryRule = commit => {
    const r = parseRule(ruleInput.value, maxNeighbors(is3D));
    ruleInput.classList.toggle('bad', !r);
    if (r && commit) { setRule(r.birth, r.survival); ruleInput.blur(); }
    return r;
  };
  ruleInput.oninput = () => tryRule(false);
  ruleInput.onkeydown = e => { if (e.key === 'Enter') tryRule(true); if (e.key === 'Escape') { ruleInput.blur(); syncRule(); } };
  ruleInput.onblur = () => { if (!tryRule(true)) syncRule(); };

  // stamps
  const stampSel = $('stampSelect');
  stampSel.append(new Option('Paint cells (no stamp)', ''));
  patterns.forEach((p, i) => stampSel.append(new Option(`Stamp: ${p.name}${p.rule !== 'B3/S23' ? ` (${p.rule})` : ''}`, i)));
  const setStamp = () => {
    const v = stampSel.value;
    stampBase = v === '' ? null : parseRLE(patterns[+v].rle);
    view2d.stamp = stampBase ? rotate(stampBase, stampTurns) : null;
    view2d.dirty = true;
  };
  stampSel.onchange = () => { stampTurns = 0; setStamp(); };
  $('rotateBtn').onclick = () => { stampTurns++; setStamp(); };

  // 3D tools
  const modes = { tool3dDraw: 'draw', tool3dErase: 'erase', tool3dView: 'view' };
  for (const [id, mode] of Object.entries(modes)) {
    $(id).onclick = () => {
      for (const other of Object.keys(modes)) $(other).classList.toggle('active', other === id);
      if (!view3d) return;
      view3d.mode = mode;
      view3d.layerGroup.visible = mode !== 'view';
      view3d.ghost.visible = false;
    };
  }
  $('layer').oninput = () => { view3d?.setLayer(+$('layer').value); syncOutputs(); syncHint(); dirty = true; };
  $('cutaway').onchange = () => { if (view3d) { view3d.cutaway = $('cutaway').checked; dirty = true; } };
  $('autoRotate').onchange = () => { if (view3d) view3d.controls.autoRotate = $('autoRotate').checked; };

  // display
  $('trails').onchange = () => { view2d.options.trails = $('trails').checked; if (view3d) view3d.options.trails = $('trails').checked; dirty = true; };
  $('gridLines').onchange = () => { view2d.options.gridLines = $('gridLines').checked; dirty = true; };
  $('glow').onchange = () => { view2d.options.glow = $('glow').checked; dirty = true; };
  $('ageBar').style.background = ageGradientCSS();
  $('bannerClose').onclick = () => banner('');

  // keyboard
  window.addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); setRunning(!running); }
    else if (k === 'n' || k === 'arrowright') { setRunning(false); step(1); }
    else if (k === 'r') { setRunning(false); reset(); }
    else if (k === 'x') randomize();
    else if (k === 'c') { setRunning(false); clearGrid(); }
    else if (k === 'q' && !is3D) $('rotateBtn').click();
    else if (k === 'escape' && !is3D) { stampSel.value = ''; setStamp(); }
    else if ((k === '[' || k === ']') && is3D) {
      const l = $('layer');
      l.value = Math.max(0, Math.min(+l.max, +l.value + (k === ']' ? 1 : -1)));
      l.oninput();
    }
  });
}

// ---------- survey -> viewer ----------

const survey = new Survey({
  engine: M,
  currentRule: () => ({ is3D, birth: world.birth, survival: world.survival }),
  onOpen: async (res, trialIdx) => {
    const c = res.config;
    const t = res.trials[trialIdx];
    if (c.is3D !== is3D) setMode(c.is3D);
    if (c.is3D) await ensure3D();
    const key = c.is3D ? `${c.w}×${c.h}×${c.d}` : `${c.w}×${c.h}`;
    world.birth = res.birth;
    world.survival = res.survival;
    if (world.size !== key) {
      makeWorld(world, key);
      buildSizes();
      afterResize(false);
    }
    setRule(res.birth, res.survival);
    // the exact start the classifier used: same grid, density and seed
    world.sim.randomize(t.density, t.seed);
    $('density').value = t.density;
    $('seed').value = t.seed;
    if (c.is3D) { $('blob').value = 1; world.blob = 1; }
    world.density = t.density;
    syncOutputs();
    afterStateLoad();
    setRunning(true);
    const cat = CATEGORIES[t.category];
    const detail = t.period > 0 ? `period ${t.period}, first repeat at generation ${t.cycleFoundAt}` : `mean entropy H = ${t.entropy.toFixed(3)} after ${c.gens} generations`;
    banner(`Replaying ${res.custom ? 'the viewer rule' : `rule #${res.number}`} <code>${res.rule}</code>, trial d=${t.density.toFixed(2)} (seed ${t.seed}) — the classifier saw <b>${cat.key}</b>: ${detail}.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
});

// ---------- start ----------

bindUI();
setMode(false);
applyPreset(presets2D[0]);
setRunning(true);
requestAnimationFrame(frame);

// for poking at things from the console
Object.assign(window, { lifeModule: M, survey, getWorld: () => world, maskToCounts });
