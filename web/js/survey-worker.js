// Classifies rules off the main thread with Analysis::classify (via wasm).
import createLifeModule from '../wasm/life.js';

const ready = createLifeModule();

self.onmessage = async e => {
  const M = await ready;
  const { id, job } = e.data;
  try {
    const c = job.config;
    const r = M.classifyRule(
      c.is3D, c.w, c.h, c.d, c.gens, c.densities, c.seed, job.ruleIndex, c.threshold,
      job.birth >>> 0, job.survival >>> 0,
    );
    const buffers = r.trials.map(t => t.finalState.buffer);
    self.postMessage({ id, result: r }, buffers);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
