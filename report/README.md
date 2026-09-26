# Report

`report.tex` is the LaTeX source; `report.pdf` is a compiled copy.

**Overleaf:** New Project → Upload Project → choose `overleaf.zip` (it holds
`report.tex` and the figures it uses). It compiles with the default pdfLaTeX.

Only the figures `report.tex` uses are in the zip; `figures/` also holds extra
plots from the experiments.

Every number and figure comes from the code in `../experiments/`:

```sh
g++ -O3 -std=c++17 experiments/experiments.cpp -o experiments/run
./experiments/run all              # ~30 min on 4 cores; writes experiments/out/*.csv
python3 experiments/figures.py     # writes report/figures/*.pdf and report/tables/*.tex
```

The `site_*.jpg` screenshots were taken from the website in headless Chromium.
