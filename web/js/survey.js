// The rule-space survey: samples random rules, classifies them in a pool of
// web workers, and shows the results as tiles, two charts and a card grid.
import { CATEGORIES } from './palette.js';
import { ruleString, lambda, maxNeighbors } from './rules.js';

const $ = id => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const DEFAULTS = {
  false: { grid: '64×64', gens: 500, dens: '0.2, 0.35, 0.5' },
  true: { grid: '24×24×24', gens: 200, dens: '0.1, 0.2, 0.35' },
};

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) e.append(c);
  return e;
}
function svg(tag, attrs = {}) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
const shapeEl = cat => el('span', { class: `shape ${cat.shape}`, style: `--c:${cat.color}` });

// svg path for a category's marker shape, centred on (x, y)
function shapePath(shape, x, y, r) {
  if (shape === 'circle') return `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  if (shape === 'square') { const s = r * 0.9; return `M${x - s},${y - s}h${2 * s}v${2 * s}h${-2 * s}z`; }
  if (shape === 'triangle') { const s = r * 1.2; return `M${x},${y - s}L${x + s},${y + s * 0.8}L${x - s},${y + s * 0.8}z`; }
  const s = r * 1.25;
  return `M${x},${y - s}L${x + s},${y}L${x},${y + s}L${x - s},${y}z`;
}

// same fields main.cpp prints for a trial
function trialText(t) {
  const cat = CATEGORIES[t.category].key;
  const tail = t.period > 0 ? `p=${t.period} @${t.cycleFoundAt}` : `H=${t.entropy.toFixed(3)}`;
  return `d=${t.density.toFixed(2)} ${cat} ${tail}${t.finalPopulation === 0 ? ' (extinct)' : ''}`;
}
function trialShort(t) {
  const tail = t.period > 0 ? `p=${t.period} @${t.cycleFoundAt}` : `H=${t.entropy.toFixed(3)}`;
  return `d=${t.density.toFixed(2)}  ${tail}${t.finalPopulation === 0 ? ' ∅' : ''}`;
}

export class Survey {
  constructor({ engine, onOpen, currentRule }) {
    this.M = engine;
    this.onOpen = onOpen;
    this.currentRule = currentRule;
    this.is3D = false;
    this.results = [];
    this.cards = new Map();
    this.filter = null;
    this.selected = null;
    this.workers = [];
    this.running = false;
    this.tooltip = $('tooltip');
    this.bind();
    this.renderTiles();
    this.renderLegend();
    this.renderFilters();
  }

  // ---------- setup ----------

  bind() {
    $('survey2d').onclick = () => this.setDim(false);
    $('survey3d').onclick = () => this.setDim(true);
    $('svRun').onclick = () => (this.running ? this.stop() : this.run());
    $('svCurrent').onclick = () => this.classifyCurrent();
    $('svExport').onclick = () => this.exportCSV();
    $('svSort').onchange = () => this.applyView();
    $('svSearch').oninput = () => this.applyView();
  }

  setDim(is3D) {
    if (this.running) return;
    this.is3D = is3D;
    $('survey2d').classList.toggle('active', !is3D);
    $('survey3d').classList.toggle('active', is3D);
    const d = DEFAULTS[is3D];
    $('svGrid').value = d.grid;
    $('svGens').value = d.gens;
    $('svDens').value = d.dens;
  }

  readConfig() {
    const dims = $('svGrid').value.split(/[×x*, ]+/i).map(Number).filter(n => n > 0);
    const [w, h = w, d = this.is3D ? w : 1] = dims;
    const densities = $('svDens').value.split(/[, ]+/).map(Number).filter(n => n > 0 && n <= 1);
    if (!w || !densities.length) return null;
    return {
      is3D: this.is3D,
      w: Math.min(w, 512), h: Math.min(h, 512), d: this.is3D ? Math.min(d, 128) : 1,
      gens: Math.max(1, +$('svGens').value || 1),
      densities,
      seed: (+$('svSeed').value >>> 0),
      threshold: +$('svThresh').value,
      count: Math.max(1, Math.min(2000, +$('svCount').value || 1)),
    };
  }

  spawnWorkers() {
    if (this.workers.length) return;
    const n = Math.max(1, Math.min(12, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./survey-worker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      this.workers.push(w);
    }
  }

  killWorkers() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }

  // ---------- running ----------

  async run() {
    const config = this.readConfig();
    if (!config) return;
    this.config = config;
    this.results = [];
    this.cards.clear();
    this.selected = null;
    $('svResults').replaceChildren();
    this.spawnWorkers();
    this.running = true;
    $('svRun').textContent = 'Stop';
    $('svCurrent').disabled = true;
    $('svExport').disabled = true;
    $('svProgress').hidden = false;

    const rules = this.M.randomRules(config.count, config.is3D, config.seed);
    const queue = rules.map((r, i) => ({ ruleIndex: i, birth: r.birth, survival: r.survival }));
    const total = queue.length;
    let done = 0;
    const t0 = performance.now();
    this.updateProgress(0, total, t0);

    await new Promise(resolve => {
      const feed = w => {
        if (!this.running) return;
        const job = queue.shift();
        if (!job) { if (done === total) resolve(); return; }
        w.busy = true;
        w.onmessage = e => {
          w.busy = false;
          done++;
          if (e.data.result) this.addResult(job, e.data.result, config);
          this.updateProgress(done, total, t0);
          if (done === total) resolve();
          else feed(w);
        };
        w.postMessage({ id: job.ruleIndex, job: { ...job, config } });
      };
      this.resolveStop = resolve;
      this.workers.forEach(feed);
    });

    this.finish();
  }

  stop() {
    this.running = false;
    this.killWorkers();
    this.resolveStop?.();
  }

  finish() {
    this.running = false;
    $('svRun').textContent = 'Run survey';
    $('svCurrent').disabled = false;
    $('svExport').disabled = this.results.length === 0;
    this.scheduleRender(true);
  }

  // classifies whatever rule is in the viewer with the current settings
  async classifyCurrent() {
    if (this.running) return;
    const rule = this.currentRule();
    if (rule.is3D !== this.is3D) this.setDim(rule.is3D);
    const cfg = this.readConfig();
    if (!cfg) return;
    cfg.count = 1;
    // results from the other dimension can't share the charts
    if (this.config && this.config.is3D !== cfg.is3D) {
      this.results = [];
      this.cards.clear();
      $('svResults').replaceChildren();
    }
    if (!this.results.length) this.config = cfg;
    this.spawnWorkers();
    const w = this.workers[0];
    $('svCurrent').disabled = true;
    $('svCurrent').textContent = 'Classifying…';
    // trial seeds are the ones the first sampled rule gets
    const job = { ruleIndex: 0, birth: rule.birth, survival: rule.survival };
    const r = await new Promise(resolve => {
      w.onmessage = e => resolve(e.data.result);
      w.postMessage({ id: -1, job: { ...job, config: cfg } });
    });
    $('svCurrent').disabled = false;
    $('svCurrent').textContent = 'Classify viewer rule';
    if (!r) return;
    const res = this.addResult(job, r, cfg, true);
    $('svExport').disabled = false;
    this.renderAll();
    this.select(res.id);
    this.cards.get(res.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  addResult(job, r, config, custom = false) {
    const maxN = maxNeighbors(config.is3D);
    const cells = config.w * config.h * config.d;
    const trials = r.trials.map(t => ({ ...t, finalDensity: t.finalPopulation / cells }));
    const entropies = trials.filter(t => t.entropy >= 0).map(t => t.entropy);
    const res = {
      id: this.results.length,
      number: custom ? null : job.ruleIndex + 1,
      custom,
      birth: r.birth,
      survival: r.survival,
      rule: ruleString(r.birth, r.survival),
      category: r.category,
      trials,
      config,
      lambda: lambda(r.birth, r.survival, maxN),
      meanDensity: trials.reduce((s, t) => s + t.finalDensity, 0) / trials.length,
      meanEntropy: entropies.length ? entropies.reduce((a, b) => a + b, 0) / entropies.length : -1,
      maxPeriod: Math.max(...trials.map(t => t.period)),
    };
    // the trial shown on the card: first one that agrees with the vote
    res.featured = Math.max(0, trials.findIndex(t => t.category === r.category));
    this.results.push(res);
    this.cards.set(res.id, this.makeCard(res));
    this.scheduleRender();
    return res;
  }

  updateProgress(done, total, t0) {
    const pct = total ? (100 * done) / total : 0;
    $('svProgressFill').style.width = `${pct}%`;
    const secs = (performance.now() - t0) / 1000;
    const eta = done ? (secs / done) * (total - done) : 0;
    $('svProgressText').textContent = done < total
      ? `${done}/${total} rules · ${this.workers.length} workers · ~${Math.ceil(eta)}s left`
      : `${total} rules in ${secs.toFixed(1)}s on ${this.workers.length} workers`;
  }

  scheduleRender(now = false) {
    if (now) { this.renderAll(); return; }
    if (this.renderQueued) return;
    this.renderQueued = true;
    setTimeout(() => { this.renderQueued = false; this.renderAll(); }, 120);
  }

  renderAll() {
    this.renderTiles();
    this.renderFilters();
    this.renderScatter();
    this.renderHistogram();
    this.applyView();
  }

  // ---------- tiles, legend, filters ----------

  counts() {
    const c = [0, 0, 0, 0];
    for (const r of this.results) c[r.category]++;
    return c;
  }

  renderTiles() {
    const counts = this.counts();
    const total = this.results.length || 1;
    $('svTiles').replaceChildren(...CATEGORIES.map((cat, i) => el('button', {
      class: `tile${this.filter === i ? ' active' : ''}`,
      style: `--c:${cat.color}`,
      onclick: () => this.setFilter(this.filter === i ? null : i),
    }, [
      el('div', { class: 'name' }, [shapeEl(cat), cat.key]),
      el('div', { class: 'count' }, [String(counts[i]), el('span', { class: 'pct' }, this.results.length ? `${Math.round((100 * counts[i]) / total)}%` : '')]),
      el('div', { class: 'desc' }, cat.desc),
      el('div', { class: 'meter' }, el('div', { style: `width:${(100 * counts[i]) / total}%` })),
    ])));
  }

  renderLegend() {
    $('svLegend').replaceChildren(...CATEGORIES.map(cat => el('span', {}, [shapeEl(cat), cat.key])));
  }

  renderFilters() {
    const counts = this.counts();
    const mk = (label, idx, n) => el('button', {
      class: `filter${this.filter === idx ? ' active' : ''}`,
      onclick: () => this.setFilter(idx),
    }, [idx === null ? '' : shapeEl(CATEGORIES[idx]), label, el('span', { class: 'n' }, String(n))]);
    $('svFilters').replaceChildren(
      mk('All', null, this.results.length),
      ...CATEGORIES.map((c, i) => mk(c.key, i, counts[i])),
    );
  }

  setFilter(idx) {
    this.filter = idx;
    this.renderTiles();
    this.renderFilters();
    this.renderScatter();
    this.applyView();
  }

  // ---------- cards ----------

  makeCard(res) {
    const cat = CATEGORIES[res.category];
    const thumb = el('canvas', { width: res.config.w, height: res.config.h, 'aria-hidden': 'true' });
    this.drawThumb(thumb, res, res.featured);
    const trials = el('div', { class: 'trials' }, res.trials.map((t, i) => el('button', {
      class: 'trial',
      title: `${trialText(t)} · click to replay from its exact start (seed ${t.seed})`,
      onclick: ev => { ev.stopPropagation(); this.open(res, i, 'replay'); },
      onmouseenter: () => this.drawThumb(thumb, res, i),
      onmouseleave: () => this.drawThumb(thumb, res, res.featured),
    }, [shapeEl(CATEGORIES[t.category]), trialShort(t), el('span', { class: 'play' }, '▶')])));
    const card = el('article', {
      class: 'rcard',
      tabindex: '0',
      onclick: () => this.open(res, res.featured, 'replay'),
      onkeydown: e => { if (e.key === 'Enter') this.open(res, res.featured, 'replay'); },
    }, [
      thumb,
      el('div', {}, [
        el('div', { class: 'top' }, [
          el('span', { class: 'idx' }, res.custom ? 'viewer rule' : `#${res.number}`),
          el('span', { class: 'badge', style: `--c:${cat.color}` }, [shapeEl(cat), cat.key]),
        ]),
        el('div', { class: 'rule-str' }, res.rule),
        trials,
      ]),
    ]);
    return card;
  }

  // final grid of one trial. 3D grids show their middle layer, with a faint
  // look down each column behind it so structure off that layer still shows
  drawThumb(canvas, res, trialIdx) {
    const { w, h, d } = res.config;
    const cells = res.trials[trialIdx].finalState;
    const mid = d >> 1;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let f = cells[(mid * h + y) * w + x];
        if (d > 1 && !f) {
          let n = 0;
          for (let z = 0; z < d; z++) n += cells[(z * h + y) * w + x];
          f = 0.35 * (n / d);
        }
        const p = (y * w + x) * 4;
        img.data[p] = 5 + f * 120;
        img.data[p + 1] = 12 + f * 200;
        img.data[p + 2] = 28 + f * 227;
        img.data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  applyView() {
    const q = $('svSearch').value.trim().toUpperCase();
    const key = $('svSort').value;
    const sorters = {
      index: (a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || a.id - b.id,
      lambda: (a, b) => a.lambda - b.lambda,
      entropy: (a, b) => b.meanEntropy - a.meanEntropy,
      density: (a, b) => b.meanDensity - a.meanDensity,
      period: (a, b) => b.maxPeriod - a.maxPeriod,
    };
    const list = [...this.results].sort(sorters[key]);
    const box = $('svResults');
    const shown = [];
    for (const r of list) {
      const ok = (this.filter === null || r.category === this.filter) && (!q || r.rule.includes(q));
      if (ok) shown.push(this.cards.get(r.id));
    }
    if (!this.results.length) return;
    if (!shown.length) {
      box.replaceChildren(el('div', { class: 'empty' }, 'No rules match this filter.'));
      return;
    }
    box.replaceChildren(...shown);
  }

  select(id) {
    this.selected = id;
    for (const [k, c] of this.cards) c.classList.toggle('sel', k === id);
    this.renderScatter();
  }

  open(res, trialIdx, how) {
    this.select(res.id);
    this.onOpen(res, trialIdx, how);
  }

  // ---------- charts ----------

  renderScatter() {
    const box = $('svScatter');
    const W = box.clientWidth || 600;
    const H = box.clientHeight || 280;
    const m = { l: 44, r: 12, t: 10, b: 34 };
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Scatter of rules by lambda and final density' });
    const x = v => m.l + v * (W - m.l - m.r);
    // round the top up to the next 20% so the ticks land on round numbers
    const yMax = Math.min(1, Math.ceil(Math.max(0.01, ...this.results.map(r => r.meanDensity)) * 5 + 1e-9) / 5);
    const y = v => H - m.b - (v / yMax) * (H - m.t - m.b);

    const grid = svg('g', { class: 'grid' });
    const axis = svg('g', { class: 'axis' });
    for (let i = 0; i <= 5; i++) {
      const v = i / 5;
      grid.append(svg('line', { x1: x(v), x2: x(v), y1: m.t, y2: H - m.b }));
      const t = svg('text', { x: x(v), y: H - m.b + 16, 'text-anchor': 'middle' });
      t.textContent = v.toFixed(1);
      axis.append(t);
    }
    const yTicks = yMax <= 0.2 ? 4 : Math.round(yMax / 0.2);
    for (let i = 0; i <= yTicks; i++) {
      const v = (yMax * i) / yTicks;
      grid.append(svg('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
      const t = svg('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' });
      t.textContent = `${Math.round(v * 100)}%`;
      axis.append(t);
    }
    const xt = svg('text', { class: 'axis-title', x: W - m.r, y: H - 2, 'text-anchor': 'end' });
    xt.textContent = 'λ  (share of counts that give a live cell) →';
    const yt = svg('text', { class: 'axis-title', x: 4, y: m.t + 2, transform: `rotate(-90 ${4} ${m.t + 2})`, 'text-anchor': 'end', dy: '0.8em' });
    yt.textContent = 'final density';
    s.append(grid, axis, xt, yt);

    const maxN = this.config ? maxNeighbors(this.config.is3D) : 8;
    const stepPx = (W - m.l - m.r) / (2 * (maxN + 1));
    const marks = svg('g');
    for (const r of this.results) {
      const cat = CATEGORIES[r.category];
      // spread rules that share a λ sideways so they don't stack
      const jitter = (((r.birth * 2654435761) ^ r.survival) % 1000) / 1000 - 0.5;
      const cx = x(r.lambda) + jitter * stepPx * 0.8;
      const cy = y(r.meanDensity);
      const dim = this.filter !== null && this.filter !== r.category;
      const p = svg('path', {
        d: shapePath(cat.shape, cx, cy, 5),
        fill: cat.color,
        class: `mark${dim ? ' dim' : ''}${this.selected === r.id ? ' sel' : ''}`,
      });
      p.addEventListener('mouseenter', e => this.showTip(e, `<b>${r.rule}</b><br>${cat.key} · λ ${r.lambda.toFixed(2)} · final density ${(r.meanDensity * 100).toFixed(1)}%${r.meanEntropy >= 0 ? ` · H ${r.meanEntropy.toFixed(3)}` : ''}`));
      p.addEventListener('mousemove', e => this.moveTip(e));
      p.addEventListener('mouseleave', () => this.hideTip());
      p.addEventListener('click', () => { this.open(r, r.featured, 'replay'); });
      marks.append(p);
    }
    s.append(marks);
    box.replaceChildren(s);
  }

  renderHistogram() {
    const box = $('svHist');
    const W = box.clientWidth || 400;
    const H = box.clientHeight || 280;
    const m = { l: 36, r: 8, t: 10, b: 34 };
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Histogram of when trials first repeated' });
    const maxGen = this.config?.gens || 500;
    const BINS = 16;
    const binW = Math.ceil((maxGen + 1) / BINS);
    // counts[bin][category] for trials that repeated
    const counts = Array.from({ length: BINS }, () => [0, 0, 0, 0]);
    let never = 0;
    let trials = 0;
    for (const r of this.results) {
      for (const t of r.trials) {
        trials++;
        if (t.cycleFoundAt < 0) { never++; continue; }
        counts[Math.min(BINS - 1, Math.floor(t.cycleFoundAt / binW))][t.category]++;
      }
    }
    $('svHistSub').textContent = trials
      ? `Generation where each trial's grid first repeated. ${never} of ${trials} trials (${Math.round((100 * never) / trials)}%) never repeated within ${maxGen} generations and are left out.`
      : "Generation where each trial's grid first repeated.";
    const yMax = Math.max(1, ...counts.map(c => c.reduce((a, b) => a + b, 0)));
    const plotW = W - m.l - m.r;
    const bw = plotW / BINS;
    const y = v => H - m.b - (v / yMax) * (H - m.t - m.b);

    const grid = svg('g', { class: 'grid' });
    const axis = svg('g', { class: 'axis' });
    for (let i = 0; i <= 4; i++) {
      const v = Math.round((yMax * i) / 4);
      grid.append(svg('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
      const t = svg('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' });
      t.textContent = v;
      axis.append(t);
    }
    s.append(grid, axis);

    counts.forEach((c, b) => {
      const bx = m.l + b * bw + 1;
      let acc = 0;
      c.forEach((n, cat) => {
        if (!n) return;
        const y0 = y(acc);
        const y1 = y(acc + n);
        acc += n;
        const hgt = Math.max(1, y0 - y1 - 2); // 2px gap between stacked segments
        const rect = svg('rect', { x: bx, y: y1, width: Math.max(1, bw - 2), height: hgt, rx: 2, fill: CATEGORIES[cat].color });
        const range = `first repeat at generation ${b * binW}–${Math.min(maxGen, (b + 1) * binW - 1)}`;
        rect.addEventListener('mouseenter', e => this.showTip(e, `<b>${n}</b> ${CATEGORIES[cat].key} trial${n === 1 ? '' : 's'}<br>${range}`));
        rect.addEventListener('mousemove', e => this.moveTip(e));
        rect.addEventListener('mouseleave', () => this.hideTip());
        s.append(rect);
      });
      if (b % 4 === 0) {
        const t = svg('text', { x: bx, y: H - m.b + 16, 'text-anchor': 'middle' });
        t.textContent = String(b * binW);
        axis.append(t);
      }
    });
    const xt = svg('text', { class: 'axis-title', x: W - m.r, y: H - 2, 'text-anchor': 'end' });
    xt.textContent = 'generation of first repeat →';
    s.append(xt);
    box.replaceChildren(s);
  }

  showTip(e, html) {
    this.tooltip.innerHTML = html;
    this.tooltip.hidden = false;
    this.moveTip(e);
  }
  moveTip(e) {
    const t = this.tooltip;
    const x = Math.min(window.innerWidth - t.offsetWidth - 8, e.clientX + 14);
    t.style.left = `${x}px`;
    t.style.top = `${e.clientY + 14}px`;
  }
  hideTip() { this.tooltip.hidden = true; }

  // ---------- export ----------

  exportCSV() {
    const n = Math.max(...this.results.map(r => r.trials.length));
    const head = ['number', 'rule', 'category', 'lambda', 'mean_final_density'];
    for (let i = 1; i <= n; i++) head.push(`t${i}_density`, `t${i}_seed`, `t${i}_category`, `t${i}_period`, `t${i}_cycle_found_at`, `t${i}_final_population`, `t${i}_entropy`);
    const rows = [head.join(',')];
    for (const r of [...this.results].sort((a, b) => a.id - b.id)) {
      const row = [r.custom ? 'viewer' : r.number, r.rule, CATEGORIES[r.category].key, r.lambda.toFixed(4), r.meanDensity.toFixed(4)];
      for (const t of r.trials) row.push(t.density, t.seed, CATEGORIES[t.category].key, t.period, t.cycleFoundAt, t.finalPopulation, t.entropy >= 0 ? t.entropy.toFixed(4) : '');
      rows.push(row.map(v => (String(v).includes(',') ? `"${v}"` : v)).join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `survey-${this.config.is3D ? '3d' : '2d'}-seed${this.config.seed}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
  }
}
