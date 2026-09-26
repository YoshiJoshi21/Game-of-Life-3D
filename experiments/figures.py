"""Turns the CSVs from experiments/run into the report's figures.

    python3 experiments/figures.py      # writes report/figures/*.pdf
"""
import collections
import csv
import os
import statistics as st

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import ListedColormap

OUT = "experiments/out/"
FIG = "report/figures/"
os.makedirs(FIG, exist_ok=True)

# categories: validated as a set on white (all pairs), and every chart also
# uses marker shapes or direct labels so colour is never the only cue
CATS = ["stable", "oscillating", "chaotic", "complex"]
CAT_COLOR = {"stable": "#4a3aa7", "oscillating": "#2a78d6", "chaotic": "#e34948", "complex": "#eda100"}
CAT_MARK = {"stable": "o", "oscillating": "s", "chaotic": "^", "complex": "D"}
LIFE, HIGHLIFE = "#2a78d6", "#eb6834"
INK, INK2, MUTED, GRID = "#1a1a1a", "#52514e", "#8a8984", "#e6e5e1"
CELLS = ListedColormap(["#ffffff", "#0d366b"])

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 8.5,
    "axes.edgecolor": MUTED,
    "axes.labelcolor": INK2,
    "axes.titlesize": 9,
    "axes.titleweight": "bold",
    "axes.titlecolor": INK,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.color": GRID,
    "grid.linewidth": 0.6,
    "xtick.color": INK2,
    "ytick.color": INK2,
    "xtick.major.size": 0,
    "ytick.major.size": 0,
    "legend.frameon": False,
    "lines.linewidth": 1.6,
    "savefig.bbox": "tight",
    "savefig.pad_inches": 0.03,
})


def rows(name):
    with open(OUT + name) as f:
        return list(csv.DictReader(f))


def grids(name):
    out = []
    with open(OUT + name) as f:
        for line in f:
            label, w, h, d, cells = line.strip().split(",")
            w, h, d = int(w), int(h), int(d)
            a = np.frombuffer(cells.encode(), dtype=np.uint8) - ord("0")
            out.append((label, a.reshape(d, h, w)))
    return out


def show_grid(ax, g, title=None):
    ax.imshow(g, cmap=CELLS, vmin=0, vmax=1, interpolation="nearest")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.grid(False)
    for s in ax.spines.values():
        s.set_visible(True)
        s.set_color(MUTED)
        s.set_linewidth(0.6)
    if title:
        ax.set_title(title, fontsize=8, fontweight="normal", color=INK2, pad=3)


def rule_table(name):
    table = {}
    for r in rows(name):
        t = table.setdefault(int(r["number"]), {
            "rule": r["rule"], "cat": r["category"], "b": int(r["birth_mask"]), "s": int(r["survival_mask"]),
            "nb": int(r["n_birth"]), "ns": int(r["n_survival"]), "trials": []})
        t["trials"].append(r)
    return table


def save(fig, name):
    fig.savefig(FIG + name)
    plt.close(fig)
    print("wrote", FIG + name)


# ---------- task 1: Life soups ----------

def soup_snapshots():
    life = grids("life_snaps.grids")
    high = grids("highlife_snaps.grids")
    fig, axes = plt.subplots(2, len(life), figsize=(6.6, 2.5))
    for row, (data, name) in enumerate([(life, "Life"), (high, "HighLife")]):
        for ax, (label, g) in zip(axes[row], data):
            show_grid(ax, g[0], f"gen {label}")
        axes[row][0].set_ylabel(name, fontsize=8.5, color=INK)
    fig.subplots_adjust(wspace=0.08, hspace=0.25)
    save(fig, "soup_snapshots.pdf")


def soup_traces():
    fig, axes = plt.subplots(1, 2, figsize=(6.6, 2.3), sharey=True)
    for ax, tag, title in [(axes[0], "life", "Life  B3/S23"), (axes[1], "highlife", "HighLife  B36/S23")]:
        by = collections.defaultdict(list)
        for r in rows(f"{tag}_traces.csv"):
            by[float(r["density"])].append(int(r["population"]) / 128 ** 2)
        shades = {0.1: "#9ec5f4", 0.35: "#3987e5", 0.6: "#1c5cab", 0.8: "#0d366b"}
        for d, color in shades.items():
            y = by[d]
            ax.plot(range(len(y)), y, color=color, lw=1.3)
            ax.annotate(f"{d:.2f}", (len(y) - 1, y[-1]), xytext=(3, 0), textcoords="offset points",
                        fontsize=7.5, color=INK2, va="center")
        ax.set_xscale("symlog", linthresh=10)
        ax.set_xlim(0, 7000)
        ax.set_title(title, loc="left")
        ax.set_xlabel("generation (log scale after 10)")
    axes[0].set_ylabel("live-cell density")
    fig.text(0.99, 0.02, "labels: starting density", ha="right", fontsize=7, color=MUTED)
    save(fig, "soup_traces.pdf")


def soup_settling():
    fig, axes = plt.subplots(1, 2, figsize=(6.6, 2.4))
    for tag, color, name in [("life", LIFE, "Life"), ("highlife", HIGHLIFE, "HighLife")]:
        by = collections.defaultdict(list)
        for r in rows(f"{tag}_soups.csv"):
            by[float(r["density"])].append(r)
        ds = sorted(by)
        med, lo, hi, fin = [], [], [], []
        for d in ds:
            reps = [int(r["first_repeat"]) for r in by[d] if int(r["first_repeat"]) >= 0]
            q = np.percentile(reps, [25, 50, 75])
            lo.append(q[0]); med.append(q[1]); hi.append(q[2])
            fin.append(100 * st.mean(int(r["final_pop"]) / 128 ** 2 for r in by[d]))
        axes[0].fill_between(ds, lo, hi, color=color, alpha=0.15, lw=0)
        axes[0].plot(ds, med, color=color, marker="o", ms=4)
        axes[0].annotate(name, (ds[2], med[2]), xytext=(0, 9 if name == "Life" else -12), textcoords="offset points",
                         color=INK2, fontsize=7.5, ha="center")
        axes[1].plot(ds, fin, color=color, marker="o", ms=4)
        axes[1].annotate(name, (ds[5], fin[5]), xytext=(0, 6), textcoords="offset points", color=INK2, fontsize=7.5)
    axes[0].set_title("Generation of first repeated state", loc="left")
    axes[0].set_xlabel("starting density")
    axes[0].set_ylabel("generation (median, IQR band)")
    axes[1].set_title("Density of the settled 'ash'", loc="left")
    axes[1].set_xlabel("starting density")
    axes[1].set_ylabel("final live cells (%)")
    save(fig, "soup_settling.pdf")


def census_counts(tag):
    counts = collections.Counter()
    for r in rows(f"{tag}_census.csv"):
        if 0.2 <= float(r["density"]) <= 0.5:
            name = r["object"]
            n = int(r["count"])
            if name.endswith(" part"):
                # a toad or beacon split into two pieces in this phase
                name = name[:-5]
                n = n / 2
            counts[name] += n
    return counts


def census():
    life, high = census_counts("life"), census_counts("highlife")
    names = [n for n, _ in (life + high).most_common() if n != "other"][:10] + ["other"]
    lt, ht = sum(life.values()), sum(high.values())
    y = np.arange(len(names))
    fig, ax = plt.subplots(figsize=(6.6, 2.8))
    h = 0.38
    ax.barh(y - h / 2 - 0.01, [100 * life[n] / lt for n in names], height=h, color=LIFE, label=f"Life ({int(lt):,} objects)")
    ax.barh(y + h / 2 + 0.01, [100 * high[n] / ht for n in names], height=h, color=HIGHLIFE, label=f"HighLife ({int(ht):,} objects)")
    for i, n in enumerate(names):
        for off, val in [(-h / 2, 100 * life[n] / lt), (h / 2, 100 * high[n] / ht)]:
            ax.text(val + 0.4, i + off, f"{val:.1f}%", va="center", fontsize=6.5, color=INK2)
    ax.set_yticks(y, names)
    ax.invert_yaxis()
    ax.grid(axis="y", visible=False)
    ax.set_xlabel("share of objects in the settled grid (%)")
    ax.legend(loc="lower right")
    ax.set_title("Objects left behind by random soups (densities 0.2–0.5, 48 soups each)", loc="left")
    save(fig, "census.pdf")


def replicator():
    snaps = grids("replicator.grids")
    trace = [int(r["population"]) for r in rows("replicator_trace.csv")]
    fig = plt.figure(figsize=(6.6, 3.6))
    gs = fig.add_gridspec(2, len(snaps), height_ratios=[1.25, 1], hspace=0.45, wspace=0.08)
    for i, (label, g) in enumerate(snaps):
        ax = fig.add_subplot(gs[0, i])
        # the same 100x100 window round the start for every panel, so sizes compare
        c = g[0]
        mid = c.shape[0] // 2
        show_grid(ax, c[mid - 50:mid + 50, mid - 50:mid + 50], f"gen {label}")
    ax = fig.add_subplot(gs[1, :])
    ax.plot(range(len(trace)), trace, color=HIGHLIFE, lw=1.0, alpha=0.55, label="population")
    ks = np.arange(0, len(trace), 12)
    ax.plot(ks, [12 * 2 ** bin(k // 12).count("1") for k in ks], "o", ms=3.2, color=INK,
            label="12 × 2^(number of 1 bits in k), at generation 12k")
    ax.legend(loc="upper left", fontsize=7, handletextpad=0.3)
    ax.set_yscale("log", base=2)
    ax.set_yticks([12, 24, 48, 96, 192, 384], ["12", "24", "48", "96", "192", "384"])
    ax.set_xlabel("generation")
    ax.set_ylabel("live cells")
    save(fig, "replicator.pdf")


# ---------- task 3: rule survey ----------

def category_bars():
    small = collections.Counter(r["cat"] for r in rule_table("survey2d.csv").values())
    big = collections.Counter(r["cat"] for r in rule_table("survey2d_big.csv").values())
    fig, ax = plt.subplots(figsize=(3.2, 2.2))
    x = np.arange(4)
    w = 0.38
    for off, data, n, alpha in [(-w / 2, small, 100, 1.0), (w / 2, big, 1000, 0.45)]:
        vals = [100 * data[c] / n for c in CATS]
        ax.bar(x + off, vals, width=w - 0.02, color=[CAT_COLOR[c] for c in CATS], alpha=alpha)
        for i, v in enumerate(vals):
            ax.text(x[i] + off, v + 1.5, f"{v:.0f}" if v >= 1 else f"{v:.1f}", ha="center", fontsize=6.5, color=INK2)
    ax.set_xticks(x, CATS)
    ax.set_ylabel("rules (%)")
    ax.set_ylim(0, 85)
    ax.grid(axis="x", visible=False)
    ax.set_title("2D categories", loc="left")
    ax.text(0.02, 0.97, "solid: 100 rules (seed 2026)\nfaded: 1000 rules (seed 7)", transform=ax.transAxes,
            ha="left", va="top", fontsize=6.5, color=INK2)
    save(fig, "survey_categories.pdf")


def birth_breakdown():
    table = rule_table("survey2d_big.csv")
    groups = [
        ("has B0", lambda r: r["b"] & 1),
        ("lowest birth 1", lambda r: not r["b"] & 1 and r["b"] & 2),
        ("lowest birth 2", lambda r: not r["b"] & 3 and r["b"] & 4),
        ("lowest birth ≥ 3", lambda r: not r["b"] & 7),
    ]
    fig, ax = plt.subplots(figsize=(6.6, 1.9))
    for i, (label, cond) in enumerate(groups):
        sub = [r for r in table.values() if cond(r)]
        c = collections.Counter(r["cat"] for r in sub)
        left = 0
        for cat in CATS:
            v = 100 * c[cat] / len(sub)
            if v == 0:
                continue
            ax.barh(i, v - 0.4, left=left, color=CAT_COLOR[cat], height=0.62)
            if v >= 6:
                ax.text(left + v / 2, i, f"{v:.0f}%", ha="center", va="center", fontsize=7, color="white" if cat != "complex" else INK)
            left += v
        ax.text(101, i, f"n={len(sub)}", va="center", fontsize=7, color=INK2)
    ax.set_yticks(range(len(groups)), [g[0] for g in groups])
    ax.invert_yaxis()
    ax.set_xlim(0, 108)
    ax.set_xlabel("share of rules in the group (%)")
    ax.grid(visible=False)
    handles = [plt.Rectangle((0, 0), 1, 1, color=CAT_COLOR[c]) for c in CATS]
    ax.legend(handles, CATS, ncol=4, loc="lower center", bbox_to_anchor=(0.45, 1.0), fontsize=7.5)
    save(fig, "survey_birth.pdf")


def lambda_strip(name, fig_name, max_n, title):
    table = rule_table(name)
    fig, ax = plt.subplots(figsize=(6.6, 1.9))
    rng = np.random.default_rng(1)
    for i, cat in enumerate(CATS):
        sub = [r for r in table.values() if r["cat"] == cat]
        if not sub:
            continue
        lam = np.array([(r["nb"] + r["ns"]) / (2 * (max_n + 1)) for r in sub])
        ax.scatter(lam, i + rng.uniform(-0.28, 0.28, len(lam)), s=14, marker=CAT_MARK[cat],
                   color=CAT_COLOR[cat], edgecolor="white", linewidth=0.4)
        ax.text(1.02, i, f"n={len(sub)}, median λ={np.median(lam):.2f}", va="center", fontsize=7, color=INK2,
                transform=ax.get_yaxis_transform())
    ax.set_yticks(range(4), CATS)
    ax.invert_yaxis()
    ax.set_xlim(0, 1)
    ax.set_xlabel("λ = (|B| + |S|) / 2(N+1)")
    ax.set_title(title, loc="left")
    save(fig, fig_name)


def thumbnails():
    table = rule_table("survey2d.csv")
    finals = {label: g[0] for label, g in grids("survey2d.grids")}
    picks = []
    for cat, k in [("stable", 3), ("oscillating", 3), ("complex", 1), ("chaotic", 3)]:
        picks += [(n, r) for n, r in table.items() if r["cat"] == cat][:k]
    fig, axes = plt.subplots(2, 5, figsize=(6.6, 3.3))
    for ax, (n, r) in zip(axes.flat, picks):
        # show the trial that agrees with the vote
        t = next(i for i, tr in enumerate(r["trials"]) if tr["trial_category"] == r["cat"])
        show_grid(ax, finals[f"{n}_{t}"])
        ax.set_title(f"#{n}  {r['rule']}", fontsize=6.5, fontweight="normal", color=INK2, pad=3)
        color = CAT_COLOR[r["cat"]] if r["cat"] != "complex" else "#8a5d00"
        ax.text(0.5, -0.05, f"{r['cat']}, d={float(r['trials'][t]['density']):.2f}", transform=ax.transAxes,
                ha="center", va="top", fontsize=7, color=color)
    fig.subplots_adjust(wspace=0.12, hspace=0.35)
    save(fig, "survey_thumbnails.pdf")


def strobe_rule():
    snaps = grids("rule_B012367_S35.grids")
    trace = [int(r["population"]) / 128 ** 2 for r in rows("rule_B012367_S35_trace.csv")]
    fig = plt.figure(figsize=(6.6, 2.6))
    gs = fig.add_gridspec(2, 6, width_ratios=[1, 1, 1, 1, 0.45, 2.6], hspace=0.3)
    for i, (label, g) in enumerate(snaps):
        ax = fig.add_subplot(gs[i % 2, i // 2])
        show_grid(ax, g[0][:64, :64], f"gen {label}")
    ax = fig.add_subplot(gs[:, 5])
    gens = np.arange(len(trace))
    tr = np.array(trace)
    ax.plot(gens[::2], tr[::2], color=LIFE, lw=1.2)
    ax.plot(gens[1::2], tr[1::2], color=HIGHLIFE, lw=1.2)
    ax.text(200, tr[200] - 0.07, "even generations", color=INK2, fontsize=7)
    ax.text(200, tr[201] + 0.04, "odd generations", color=INK2, fontsize=7)
    ax.set_ylim(0, 1)
    ax.set_xlabel("generation")
    ax.set_ylabel("live-cell density")
    ax.set_title("B012367/S35 strobes", loc="left")
    save(fig, "strobe.pdf")


# ---------- task 4: 3D ----------

def categories_3d():
    sets = [("survey3d.csv", "uniform bits\n(like main.cpp)"), ("survey3d_p20.csv", "each count\np = 0.2"), ("survey3d_p10.csv", "each count\np = 0.1")]
    fig, ax = plt.subplots(figsize=(6.6, 1.7))
    for i, (name, label) in enumerate(sets):
        c = collections.Counter(r["cat"] for r in rule_table(name).values())
        n = sum(c.values())
        left = 0
        for cat in CATS:
            v = 100 * c[cat] / n
            if v == 0:
                continue
            ax.barh(i, v - 0.4, left=left, color=CAT_COLOR[cat], height=0.62)
            if v >= 5:
                ax.text(left + v / 2, i, f"{v:.0f}%", ha="center", va="center", fontsize=7, color="white" if cat != "complex" else INK)
            left += v
    ax.set_yticks(range(len(sets)), [s[1] for s in sets], fontsize=7.5)
    ax.invert_yaxis()
    ax.set_xlim(0, 100)
    ax.grid(visible=False)
    ax.set_xlabel("share of 100 sampled 3D rules (%)")
    handles = [plt.Rectangle((0, 0), 1, 1, color=CAT_COLOR[c]) for c in CATS]
    ax.legend(handles, CATS, ncol=4, loc="lower center", bbox_to_anchor=(0.45, 1.0), fontsize=7.5)
    save(fig, "survey3d_categories.pdf")


def traces_3d():
    fig, ax = plt.subplots(figsize=(3.3, 2.2))
    series = [("3d_4555", "B5/S45 (4555)", "#9085e9", 0), ("3d_5766", "B6/S567 (5766)", "#4a3aa7", 0),
              ("3d_B6S5678", "B6/S5678", "#2a78d6", 5), ("3d_B45S5", "B45/S5", "#e34948", -5)]
    for f, label, color, dy in series:
        t = [int(r["population"]) / 32 ** 3 for r in rows(f + "_trace.csv")]
        ax.plot(range(len(t)), t, color=color, lw=1.4)
        ax.annotate(label, (len(t) - 1, t[-1]), xytext=(3, dy), textcoords="offset points", fontsize=6.5, color=INK2, va="center")
    ax.set_yscale("symlog", linthresh=0.001)
    ax.set_xlabel("generation")
    ax.set_ylabel("live-cell density")
    ax.set_title("3D soups, 32³, 20–30% start", loc="left")
    ax.set_xlim(0, 300)
    save(fig, "traces3d.pdf")


def timing():
    fig, ax = plt.subplots(figsize=(3.3, 2.3))
    series = [("timing.csv", "2", LIFE, "-", "2D, -O3", -7), ("timing.csv", "3", HIGHLIFE, "-", "3D, -O3", 5),
              ("timing_O2.csv", "3", HIGHLIFE, "--", "3D, -O2", 0)]
    for f, dim, color, ls, label, dy in series:
        sub = [r for r in rows(f) if r["dim"] == dim]
        x = [int(r["cells"]) for r in sub]
        y = [float(r["ms_per_step"]) for r in sub]
        ax.plot(x, y, marker="o", ms=3, color=color, ls=ls, lw=1.3, label=label)
        if f == "timing.csv" and dim == "3":
            for r in sub:
                if int(r["n"]) in (32, 64, 128, 256):
                    ax.annotate(f"{r['n']}³", (int(r["cells"]), float(r["ms_per_step"])), xytext=(2, -9),
                                textcoords="offset points", fontsize=6.5, color=INK2)
    ax.axhline(1000 / 30, color=MUTED, lw=0.8, ls=":")
    ax.text(6e2, 1000 / 30 * 1.25, "30 steps/s", fontsize=6.5, color=MUTED)
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.legend(loc="lower right", fontsize=6.5)
    ax.set_xlabel("cells")
    ax.set_ylabel("ms per step (native, one core)")
    ax.set_title("Cost of one generation", loc="left")
    save(fig, "timing.pdf")

def survey_table():
    """LaTeX longtable of every rule in the 100-rule 2D survey (report appendix)."""
    table = rule_table("survey2d.csv")
    os.makedirs("report/tables", exist_ok=True)
    short = {"stable": "S", "oscillating": "O", "chaotic": "X", "complex": "C"}
    lines = []
    for n in sorted(table):
        r = table[n]
        cells = []
        for t in r["trials"]:
            detail = f"p{t['period']}@{t['first_repeat']}" if int(t["period"]) > 0 else f"H{float(t['entropy']):.2f}"
            ext = r"$^\dagger$" if t["final_pop"] == "0" else ""
            cells.append(f"{short[t['trial_category']]} {detail}{ext}")
        lines.append(f"{n} & \\texttt{{{r['rule']}}} & {r['cat']} & " + " & ".join(cells) + r" \\")
    # the whole environment goes in the file: \input inside a longtable breaks \bottomrule
    head = (r"{\small" "\n" r"\begin{longtable}{@{}rllccc@{}}" "\n" r"\toprule" "\n"
            r"\# & Rule & Label & $d=0.20$ & $d=0.35$ & $d=0.50$ \\" "\n" r"\midrule" "\n" r"\endhead" "\n")
    tail = r"\bottomrule" "\n" r"\end{longtable}" "\n}\n"
    with open("report/tables/survey2d_table.tex", "w") as f:
        f.write(head + "\n".join(lines) + "\n" + tail)
    print("wrote report/tables/survey2d_table.tex")


if __name__ == "__main__":
    import sys
    which = sys.argv[1:] or ["all"]
    jobs = {
        "snapshots": soup_snapshots, "traces": soup_traces, "settling": soup_settling, "census": census,
        "replicator": replicator, "categories": category_bars, "birth": birth_breakdown,
        "lambda": lambda: lambda_strip("survey2d_big.csv", "survey_lambda.pdf", 8, "2D, 1000 rules: λ by category"),
        "thumbs": thumbnails, "strobe": strobe_rule, "categories3d": categories_3d,
        "lambda3d": lambda: lambda_strip("survey3d_p20.csv", "survey3d_lambda.pdf", 26, "3D, 100 rules with p = 0.2: λ by category"),
        "traces3d": traces_3d, "timing": timing, "table": survey_table,
    }
    for name, fn in jobs.items():
        if "all" in which or name in which:
            fn()
