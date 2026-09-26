# Life Lab: 2D & 3D cellular automata

An interactive cellular-automaton lab for exploring emergent complexity. The
simulations are the C++ engine in `engine/` and the classifier in `analysis/`,
compiled to WebAssembly and driven from a browser UI.

## What's on the site

- **Viewer (2D and 3D).** Play, pause, step, reset to generation 0, clear, and a
  speed slider from 1 gen/s up to "max". Cells are coloured by age: just-born or
  just-drawn cells are white, and they cool through sky blue to deep blue as they
  age. Dead cells leave a fading trail.
- **Click-to-edit rules.** Birth and survival counts are toggle chips (0–8 in 2D,
  each with a tiny 3×3 neighbourhood diagram; 0–26 in 3D). You can also type a rule
  (`B36/S23`, `B5/S4,5`, `B13-14,17-19/S13-26`) or pick a preset. A sentence under
  the chips says what the rule does in plain English.
- **Drawing.** In 2D, click or drag to paint (starting on a live cell erases), or
  stamp a known pattern (glider, LWSS, Gosper gun, HighLife replicator…). In 3D, the
  editor is a real 3D view: drag to orbit, scroll to zoom, right-drag to pan. Click a
  cube face to stack a cell on it, or click the glowing layer plane to place one.
  `[` and `]` move the layer, and "hide cells above the layer" cuts the volume open.
- **Rule-space survey.** Samples N random outer-totalistic rules (2D or 3D) the same
  way `runRandomRules()` in `analysis/main.cpp` does, and classifies each one with
  `Analysis::classify`. It runs in parallel web workers. You get category counts, a λ vs.
  final-density scatter, a histogram of when trials first repeated, and a card per
  rule with thumbnails of each trial's final grid. Clicking a card or trial replays
  that exact trial (same grid, density and seed) in the viewer. You can also classify
  the rule currently in the viewer and export everything as CSV.

With seed 2026 and the default settings (2D: 64×64, 500 generations, densities
0.2/0.35/0.5; 3D: 24³, 200 generations, 0.1/0.2/0.35) the survey produces the
same rules and results as the CLI.

## Layout

```
engine/            LifeGame interface, LifeGrid (2D), LifeGrid3D (3D)
analysis/          Analysis classifier + CLI (main.cpp)
wasm/bindings.cpp  Emscripten bindings the website uses (the only C++ added)
build.sh           compiles bindings.cpp -> web/wasm/life.{js,wasm}
web/               the static website (index.html, css/, js/, wasm/, vendor/three.js)
.github/workflows/pages.yml   builds the wasm and deploys web/ to GitHub Pages
experiments/       experiments.cpp + figures.py behind the report (data in experiments/out/)
report/            the report (LaTeX + compiled PDF + overleaf.zip)
```

`wasm/bindings.cpp` wraps the engine without changing it:

- `Simulator` holds a `LifeGrid` or `LifeGrid3D` for the viewer and exposes
  `step`, `randomize`, `set`/`get`, `setRule` and a zero-copy view of `flatten()`.
- `classifyRule` runs `Analysis::classify` on one rule. `Analysis` draws each
  trial's seed from a single rng, in order, so the rules would normally have to run
  one after another. To run them in parallel, the game is wrapped in a small
  `SeededGame` proxy whose `randomize()` swaps in the seed that rule would have got
  in the sequential run. That keeps parallel results identical to the CLI. The proxy
  also saves each trial's final grid for the thumbnails.
- `randomRules` repeats the rule sampling from `main.cpp` (`mt19937_64`, the same
  bit layout, no duplicates).

## Run it locally

The compiled `web/wasm/life.js` and `life.wasm` are committed, so you only need a
static file server:

```sh
cd web
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` straight from disk won't work, because browsers block ES
modules and web workers on `file://` URLs.)

## Rebuild the engine after changing the C++

Install [Emscripten](https://emscripten.org/docs/getting_started/downloads.html), then:

```sh
./build.sh
```

## Deploy to GitHub Pages

1. In the repo on GitHub, go to **Settings → Pages → Build and deployment → Source**
   and choose **GitHub Actions**.
2. Push to `main` (or run the "Deploy site" workflow by hand from the Actions tab).
   The workflow rebuilds the wasm from the C++ and publishes `web/`.
3. The site appears at `https://<your-username>.github.io/Game-of-Life-3D/`.

## CLI

`analysis/main.cpp` prints the same survey in the terminal:

```sh
g++ -O2 -std=c++17 analysis/main.cpp -o analysis/main && ./analysis/main
```
