// Canvas renderer and mouse/touch drawing for the 2D grid.
import { ageRGB, trailRGB, TRAIL_MAX, BACKGROUND } from './palette.js';

export class View2D {
  constructor(canvas, { isAlive, onPaint, onStamp }) {
    this.isAlive = isAlive;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPaint = onPaint;
    this.onStamp = onStamp;
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.options = { trails: true, gridLines: true, glow: true };
    this.stamp = null; // [[x, y], ...] while a stamp is picked
    this.hover = null;
    this.painting = null; // true = drawing, false = erasing
    this.last = null;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.bindInput();
  }

  setSize(w, h) {
    this.w = w;
    this.h = h;
    this.off.width = w;
    this.off.height = h;
    this.image = this.offCtx.createImageData(w, h);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.layout();
    this.dirty = true;
  }

  // where the grid sits on the canvas, in canvas pixels
  layout() {
    const { width: cw, height: ch } = this.canvas;
    const pad = 16 * Math.min(window.devicePixelRatio || 1, 2);
    let cell = Math.min((cw - 2 * pad) / this.w, (ch - 2 * pad) / this.h);
    if (cell >= 3) cell = Math.floor(cell);
    this.cell = Math.max(cell, 0.25);
    this.gw = this.cell * this.w;
    this.gh = this.cell * this.h;
    this.ox = Math.round((cw - this.gw) / 2);
    this.oy = Math.round((ch - this.gh) / 2);
  }

  render(tracker) {
    if (!this.image) return;
    const { data } = this.image;
    const age = tracker.age;
    const trails = this.options.trails;
    for (let i = 0, p = 0; i < age.length; i++, p += 4) {
      const a = age[i];
      let c;
      if (a >= 0) c = ageRGB[a];
      else if (trails && -a <= TRAIL_MAX) c = trailRGB[-a];
      else c = BACKGROUND;
      data[p] = c[0];
      data[p + 1] = c[1];
      data[p + 2] = c[2];
      data[p + 3] = 255;
    }
    this.offCtx.putImageData(this.image, 0, 0);

    const ctx = this.ctx;
    const { ox, oy, gw, gh, cell } = this;
    ctx.save();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;

    // soft outer frame
    ctx.shadowColor = 'rgba(56, 189, 248, 0.35)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = `rgb(${BACKGROUND.join(',')})`;
    ctx.fillRect(ox, oy, gw, gh);
    ctx.shadowBlur = 0;

    ctx.drawImage(this.off, ox, oy, gw, gh);

    if (this.options.glow) {
      // blur a copy of the grid and add it on top for a bloom look
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45;
      ctx.filter = `blur(${Math.max(2, cell * 0.9)}px)`;
      ctx.drawImage(this.off, ox, oy, gw, gh);
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    if (this.options.gridLines && cell >= 6) {
      ctx.strokeStyle = 'rgba(120, 170, 255, 0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= this.w; x++) {
        const px = ox + x * cell + 0.5;
        ctx.moveTo(px, oy);
        ctx.lineTo(px, oy + gh);
      }
      for (let y = 0; y <= this.h; y++) {
        const py = oy + y * cell + 0.5;
        ctx.moveTo(ox, py);
        ctx.lineTo(ox + gw, py);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 0.5, oy - 0.5, gw + 1, gh + 1);

    // hover: stamp preview or single-cell outline
    if (this.hover) {
      const [hx, hy] = this.hover;
      if (this.stamp) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        for (const [sx, sy] of this.stamp) {
          const x = (hx + sx) % this.w;
          const y = (hy + sy) % this.h;
          ctx.fillRect(ox + x * cell, oy + y * cell, Math.max(1, cell), Math.max(1, cell));
        }
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = Math.max(1, cell / 8);
        ctx.strokeRect(ox + hx * cell, oy + hy * cell, Math.max(1, cell), Math.max(1, cell));
      }
    }
    ctx.restore();
    this.dirty = false;
  }

  cellAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / r.width;
    const px = (e.clientX - r.left) * sx;
    const py = (e.clientY - r.top) * sx;
    const x = Math.floor((px - this.ox) / this.cell);
    const y = Math.floor((py - this.oy) / this.cell);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return [x, y];
  }

  bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const p = this.cellAt(e);
      if (!p) return;
      if (this.stamp) {
        this.onStamp(p[0], p[1], this.stamp);
        return;
      }
      c.setPointerCapture(e.pointerId);
      // starting on a live cell erases, starting on a dead one draws
      this.painting = !this.isAlive(p[0], p[1]);
      this.onPaint(p[0], p[1], this.painting);
      this.last = p;
    });
    c.addEventListener('pointermove', e => {
      const p = this.cellAt(e);
      this.hover = p;
      this.dirty = true;
      if (this.painting === null || !p) return;
      // fill the gap between pointer events so fast strokes stay continuous
      const [x0, y0] = this.last;
      const [x1, y1] = p;
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 1; i <= n; i++) {
        this.onPaint(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), this.painting);
      }
      this.last = p;
    });
    const end = () => { this.painting = null; this.last = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { this.hover = null; this.dirty = true; });
  }
}
