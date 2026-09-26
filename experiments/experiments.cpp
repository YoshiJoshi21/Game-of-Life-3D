// Experiments behind the report. Uses the engine and Analysis unchanged and
// writes CSV files to experiments/out/, which figures.py turns into plots.
//
//   g++ -O3 -std=c++17 experiments/experiments.cpp -o experiments/run
//   ./experiments/run all
#include "../engine/life.hpp"
#include "../engine/life3D.hpp"
#include "../analysis/analysis.hpp"
#include <chrono>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <unordered_set>
using namespace std;

static const string OUT = "experiments/out/";

// ---------- helpers ----------

string ruleString(vector<int> B, vector<int> S) {
    bool commas = false;
    for (int n : B) if (n >= 10) commas = true;
    for (int n : S) if (n >= 10) commas = true;
    string s = "B";
    for (size_t i = 0; i < B.size(); ++i) { if (commas && i > 0) s += ","; s += to_string(B[i]); }
    s += "/S";
    for (size_t i = 0; i < S.size(); ++i) { if (commas && i > 0) s += ","; s += to_string(S[i]); }
    return s;
}

vector<int> digits(const string &s) {
    vector<int> v;
    for (char c : s) v.push_back(c - '0');
    return v;
}

uint64_t hashCells(const vector<uint8_t> &cells) {
    uint64_t h = 1469598103934665603ULL;
    for (uint8_t c : cells) { h ^= c; h *= 1099511628211ULL; }
    return h;
}

// runs until the grid repeats or maxGen; returns {generation of first repeat, period}
pair<long, long> runToRepeat(LifeGame &game, long maxGen, vector<long> *trace = nullptr) {
    unordered_map<uint64_t, long> seen;
    for (long gen = 0; gen <= maxGen; ++gen) {
        if (trace) trace->push_back(game.population());
        uint64_t h = hashCells(game.flatten());
        auto it = seen.find(h);
        if (it != seen.end()) return {gen, gen - it->second};
        seen[h] = gen;
        if (gen < maxGen) game.step();
    }
    return {-1, -1};
}

void writeGrid(ofstream &f, const string &label, const LifeGame &g) {
    const vector<uint8_t> &c = g.flatten();
    f << label << "," << g.getWidth() << "," << g.getHeight() << "," << g.getDepth() << ",";
    for (uint8_t v : c) f << char('0' + v);
    f << "\n";
}

// ---------- object census (2D) ----------

// canonical form of a set of cells: the smallest string over the 8 rotations
// and reflections, after shifting to the origin
string canonical(vector<pair<int, int>> cells) {
    string best;
    for (int t = 0; t < 8; ++t) {
        vector<pair<int, int>> v;
        for (auto [x, y] : cells) {
            int a = x, b = y;
            if (t & 1) a = -a;
            if (t & 2) b = -b;
            if (t & 4) swap(a, b);
            v.push_back({a, b});
        }
        int mx = INT32_MAX, my = INT32_MAX;
        for (auto [a, b] : v) { mx = min(mx, a); my = min(my, b); }
        for (auto &[a, b] : v) { a -= mx; b -= my; }
        sort(v.begin(), v.end());
        string s;
        for (auto [a, b] : v) s += to_string(a) + ":" + to_string(b) + ";";
        if (best.empty() || s < best) best = s;
    }
    return best;
}

// 8-connected components on the torus, each as a canonical string
vector<string> components(const LifeGrid &g) {
    int w = g.getWidth(), h = g.getHeight();
    vector<int> seen(w * h, 0);
    vector<string> out;
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            if (!g.get(x, y) || seen[y * w + x]) continue;
            // BFS keeping unwrapped coordinates so shapes crossing the edge stay whole
            vector<pair<int, int>> cells, queue{{x, y}};
            seen[y * w + x] = 1;
            for (size_t q = 0; q < queue.size(); ++q) {
                auto [cx, cy] = queue[q];
                cells.push_back({cx, cy});
                for (int dy = -1; dy <= 1; ++dy)
                    for (int dx = -1; dx <= 1; ++dx) {
                        int nx = cx + dx, ny = cy + dy;
                        int wx = LifeGrid::wrap(nx, w), wy = LifeGrid::wrap(ny, h);
                        if (g.get(wx, wy) && !seen[wy * w + wx]) {
                            seen[wy * w + wx] = 1;
                            queue.push_back({nx, ny});
                        }
                    }
            }
            out.push_back(canonical(cells));
        }
    }
    return out;
}

// names for the common objects: every phase of each pattern, found by
// running it in an empty grid with the given rule
map<string, string> knownShapes(vector<int> B, vector<int> S) {
    struct P { string name; vector<string> rows; };
    vector<P> pats = {
        {"block", {"oo", "oo"}},
        {"beehive", {".oo.", "o..o", ".oo."}},
        {"loaf", {".oo.", "o..o", ".o.o", "..o."}},
        {"boat", {"oo.", "o.o", ".o."}},
        {"ship", {"oo.", "o.o", ".oo"}},
        {"tub", {".o.", "o.o", ".o."}},
        {"pond", {".oo.", "o..o", "o..o", ".oo."}},
        {"barge", {".o..", "o.o.", ".o.o", "..o."}},
        {"long boat", {"oo..", "o.o.", ".o.o", "..o."}},
        {"blinker", {"ooo"}},
        {"toad", {".ooo", "ooo."}},
        {"beacon", {"oo..", "oo..", "..oo", "..oo"}},
        {"glider", {".o.", "..o", "ooo"}},
        {"LWSS", {".o..o", "o....", "o...o", "oooo."}},
        {"pulsar", {"..ooo...ooo..", ".............", "o....o.o....o", "o....o.o....o", "o....o.o....o", "..ooo...ooo..", ".............", "..ooo...ooo..", "o....o.o....o", "o....o.o....o", "o....o.o....o", ".............", "..ooo...ooo.."}},
        {"replicator", {"..ooo", ".o..o", "o...o", "o..o.", "ooo.."}},
    };
    map<string, string> names;
    for (auto &p : pats) {
        LifeGrid g(40, 40, B, S);
        for (size_t y = 0; y < p.rows.size(); ++y)
            for (size_t x = 0; x < p.rows[y].size(); ++x)
                if (p.rows[y][x] == 'o') g.set(14 + x, 14 + y, true);
        // every phase; an oscillator like the toad splits into separate
        // pieces in one phase, which are named "<name> part"
        for (int i = 0; i < 4; ++i) {
            auto comps = components(g);
            for (auto &c : comps)
                if (!names.count(c)) names[c] = comps.size() == 1 ? p.name : p.name + " part";
            g.step();
        }
    }
    return names;
}

// ---------- experiment 1 & 2: random soups ----------

void soups(const string &tag, vector<int> B, vector<int> S, int size, long maxGen) {
    vector<double> densities = {0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8};
    const int SEEDS = 12;
    auto names = knownShapes(B, S);
    ofstream runs(OUT + tag + "_soups.csv");
    ofstream census(OUT + tag + "_census.csv");
    ofstream traces(OUT + tag + "_traces.csv");
    runs << "density,seed,first_repeat,period,initial_pop,final_pop\n";
    census << "density,seed,object,cells,count,shape\n";
    traces << "density,generation,population\n";
    for (double d : densities) {
        for (int seed = 0; seed < SEEDS; ++seed) {
            LifeGrid g(size, size, B, S);
            g.randomize(d, 1000 + seed);
            long initial = g.population();
            vector<long> trace;
            auto [rep, period] = runToRepeat(g, maxGen, seed == 0 ? &trace : nullptr);
            runs << d << "," << seed << "," << rep << "," << period << "," << initial << "," << g.population() << "\n";
            map<string, int> counts;
            for (auto &c : components(g)) counts[c]++;
            for (auto &[shape, n] : counts) {
                int cells = count(shape.begin(), shape.end(), ';');
                string name = names.count(shape) ? names[shape] : "other";
                census << d << "," << seed << "," << name << "," << cells << "," << n << "," << (name == "other" ? shape : "") << "\n";
            }
            for (size_t i = 0; i < trace.size(); ++i) traces << d << "," << i << "," << trace[i] << "\n";
        }
        cerr << tag << " density " << d << " done\n";
    }
}

// snapshots of one soup at several generations
void snapshots(const string &file, vector<int> B, vector<int> S, int w, int h, double d, unsigned seed, vector<long> gens) {
    ofstream f(OUT + file);
    LifeGrid g(w, h, B, S);
    g.randomize(d, seed);
    long at = 0;
    for (long target : gens) {
        while (at < target) { g.step(); ++at; }
        writeGrid(f, to_string(target), g);
    }
}

// a hand-placed pattern at several generations, plus its population trace
void patternRun(const string &file, vector<int> B, vector<int> S, int size, vector<string> rows, vector<long> gens, long traceGens) {
    ofstream f(OUT + file + ".grids");
    ofstream t(OUT + file + "_trace.csv");
    LifeGrid g(size, size, B, S);
    int ox = size / 2 - rows[0].size() / 2, oy = size / 2 - rows.size() / 2;
    for (size_t y = 0; y < rows.size(); ++y)
        for (size_t x = 0; x < rows[y].size(); ++x)
            if (rows[y][x] == 'o') g.set(ox + x, oy + y, true);
    t << "generation,population\n";
    long at = 0;
    size_t gi = 0;
    for (; at <= traceGens; ++at) {
        t << at << "," << g.population() << "\n";
        if (gi < gens.size() && gens[gi] == at) { writeGrid(f, to_string(at), g); ++gi; }
        g.step();
    }
}

// ---------- experiment 3 & 4: rule surveys ----------

// the same sampling as runRandomRules in main.cpp when p = 0.5 (uniform bits);
// other p include each count independently with probability p
vector<pair<uint32_t, uint32_t>> sampleRules(int maxN, int count, mt19937_64 &rng, double p) {
    int bitsPerSet = maxN + 1;
    uint64_t mask = (1ULL << (2 * bitsPerSet)) - 1;
    unordered_set<uint64_t> used;
    vector<pair<uint32_t, uint32_t>> rules;
    bernoulli_distribution coin(p);
    while ((int)rules.size() < count) {
        uint64_t bits = 0;
        if (p == 0.5) bits = rng() & mask;
        else for (int i = 0; i < 2 * bitsPerSet; ++i) if (coin(rng)) bits |= 1ULL << i;
        if (used.count(bits)) continue;
        used.insert(bits);
        uint64_t setMask = (1ULL << bitsPerSet) - 1;
        rules.push_back({uint32_t(bits & setMask), uint32_t((bits >> bitsPerSet) & setMask)});
    }
    return rules;
}

vector<int> counts(uint32_t m, int maxN) {
    vector<int> v;
    for (int n = 0; n <= maxN; ++n) if (m & (1u << n)) v.push_back(n);
    return v;
}

// like runTrial's randomize, but lets us keep each trial's final grid
struct Recorder : LifeGame {
    LifeGame &g;
    vector<vector<uint8_t>> finals;
    int trials = 0;
    Recorder(LifeGame &game) : g(game) {}
    void randomize(double d, unsigned s) override { if (trials++) finals.push_back(g.flatten()); g.randomize(d, s); }
    void setRule(vector<int> B, vector<int> S) override { g.setRule(B, S); }
    vector<int> getBirthCounts() const override { return g.getBirthCounts(); }
    vector<int> getSurvivalCounts() const override { return g.getSurvivalCounts(); }
    int getWidth() const override { return g.getWidth(); }
    int getHeight() const override { return g.getHeight(); }
    int getDepth() const override { return g.getDepth(); }
    long getGeneration() const override { return g.getGeneration(); }
    void clear() override { g.clear(); }
    void step() override { g.step(); }
    long population() const override { return g.population(); }
    const vector<uint8_t> &flatten() const override { return g.flatten(); }
};

void survey(const string &tag, LifeGame &game, Analysis &analysis, int maxN, int count, mt19937_64 &rng, double p, bool keepGrids) {
    auto rules = sampleRules(maxN, count, rng, p);
    ofstream f(OUT + tag + ".csv");
    ofstream grids;
    if (keepGrids) grids.open(OUT + tag + ".grids");
    f << "number,rule,birth_mask,survival_mask,n_birth,n_survival,category,trial,density,trial_category,period,first_repeat,final_pop,entropy\n";
    int number = 0;
    for (auto [bm, sm] : rules) {
        ++number;
        game.setRule(counts(bm, maxN), counts(sm, maxN));
        Recorder rec(game);
        RuleResult r = analysis.classify(rec);
        rec.finals.push_back(game.flatten());
        for (size_t i = 0; i < r.trials.size(); ++i) {
            const TrialResult &t = r.trials[i];
            f << number << ",\"" << ruleString(r.birth, r.survival) << "\"," << bm << "," << sm << ","
              << r.birth.size() << "," << r.survival.size() << "," << Analysis::categoryName(r.category) << ","
              << i << "," << t.density << "," << Analysis::categoryName(t.category) << "," << t.period << ","
              << t.cycleFoundAt << "," << t.finalPopulation << "," << t.entropy << "\n";
            if (keepGrids) {
                grids << number << "_" << i << "," << game.getWidth() << "," << game.getHeight() << "," << game.getDepth() << ",";
                for (uint8_t v : rec.finals[i]) grids << char('0' + v);
                grids << "\n";
            }
        }
        if (number % 10 == 0) cerr << tag << " " << number << "/" << count << "\n";
    }
}

// population over time for one rule from one soup (2D or 3D)
void trace(const string &file, LifeGame &g, double d, unsigned seed, long gens, vector<long> snaps) {
    ofstream t(OUT + file + "_trace.csv");
    ofstream s(OUT + file + ".grids");
    t << "generation,population\n";
    g.randomize(d, seed);
    size_t si = 0;
    for (long gen = 0; gen <= gens; ++gen) {
        t << gen << "," << g.population() << "\n";
        if (si < snaps.size() && snaps[si] == gen) { writeGrid(s, to_string(gen), g); ++si; }
        g.step();
    }
}

// ---------- experiment 5: how big can the 3D grid be ----------

void timing() {
    ofstream f(OUT + "timing.csv");
    f << "dim,n,cells,ms_per_step\n";
    for (int n : {32, 64, 128, 256, 512, 1024, 2048, 4096}) {
        LifeGrid g(n, n);
        g.randomize(0.3, 1);
        int reps = max(2, int(4e7 / (double(n) * n * 9)));
        auto t0 = chrono::steady_clock::now();
        for (int i = 0; i < reps; ++i) g.step();
        double ms = chrono::duration<double, milli>(chrono::steady_clock::now() - t0).count() / reps;
        f << "2," << n << "," << long(n) * n << "," << ms << "\n";
        cerr << "2D " << n << " " << ms << " ms\n";
    }
    for (int n : {8, 16, 24, 32, 48, 64, 96, 128, 160, 192, 256}) {
        LifeGrid3D g(n, n, n);
        g.randomize(0.2, 1);
        int reps = max(2, int(4e7 / (double(n) * n * n * 27)));
        auto t0 = chrono::steady_clock::now();
        for (int i = 0; i < reps; ++i) g.step();
        double ms = chrono::duration<double, milli>(chrono::steady_clock::now() - t0).count() / reps;
        f << "3," << n << "," << long(n) * n * n << "," << ms << "\n";
        cerr << "3D " << n << " " << ms << " ms\n";
    }
}

int main(int argc, char **argv) {
    string what = argc > 1 ? argv[1] : "all";
    bool all = what == "all";

    if (all || what == "life") {
        soups("life", {3}, {2, 3}, 128, 6000);
        snapshots("life_snaps.grids", {3}, {2, 3}, 128, 128, 0.35, 7, {0, 1, 10, 100, 500, 1500});
    }
    if (all || what == "highlife") {
        soups("highlife", {3, 6}, {2, 3}, 128, 6000);
        snapshots("highlife_snaps.grids", {3, 6}, {2, 3}, 128, 128, 0.35, 7, {0, 1, 10, 100, 500, 1500});
    }
    if (all || what == "highlife" || what == "replicator")
        patternRun("replicator", {3, 6}, {2, 3}, 320, {"..ooo", ".o..o", "o...o", "o..o.", "ooo.."}, {0, 12, 36, 84, 180}, 300);
    if (all || what == "survey") {
        mt19937_64 rng(2026);
        LifeGrid grid(64, 64);
        Analysis a2(500, {0.2, 0.35, 0.5}, 2026);
        survey("survey2d", grid, a2, 8, 100, rng, 0.5, true);
        LifeGrid3D grid3(24, 24, 24);
        Analysis a3(200, {0.1, 0.2, 0.35}, 2026, 0.35);
        survey("survey3d", grid3, a3, 26, 100, rng, 0.5, false);
    }
    if (all || what == "survey2d_big") {
        // a bigger 2D sample to check how stable the category shares are
        mt19937_64 rng(7);
        LifeGrid grid(64, 64);
        Analysis a2(500, {0.2, 0.35, 0.5}, 7);
        survey("survey2d_big", grid, a2, 8, 1000, rng, 0.5, false);
    }
    if (all || what == "survey3d_sparse") {
        // uniform bits make almost every 3D rule chaotic, so sample sparser rules
        for (double p : {0.1, 0.2}) {
            mt19937_64 rng(2026);
            LifeGrid3D grid3(24, 24, 24);
            Analysis a3(200, {0.1, 0.2, 0.35}, 2026, 0.35);
            char tag[64];
            snprintf(tag, sizeof tag, "survey3d_p%02d", int(p * 100));
            survey(tag, grid3, a3, 26, 100, rng, p, false);
        }
    }
    if (all || what == "traces") {
        // closer looks at single rules
        LifeGrid g(128, 128, {0, 1, 2, 3, 6, 7}, {3, 5});
        trace("rule_B012367_S35", g, 0.35, 11, 400, {0, 1, 2, 3, 50, 51, 300, 301});
        LifeGrid g2(128, 128, {3, 6, 7, 8}, {3, 4, 6, 7, 8});
        trace("daynight", g2, 0.5, 3, 2000, {0, 100, 2000});
        for (auto [name, B, S, d] : vector<tuple<string, vector<int>, vector<int>, double>>{
                 {"3d_4555", {5}, {4, 5}, 0.2},
                 {"3d_5766", {6}, {5, 6, 7}, 0.2},
                 {"3d_B6S5678", {6}, {5, 6, 7, 8}, 0.3},
                 {"3d_B45S5", {4, 5}, {5}, 0.2},
             }) {
            LifeGrid3D g3(32, 32, 32, B, S);
            trace(name, g3, d, 5, 300, {0, 300});
        }
    }
    if (all || what == "timing") timing();
    return 0;
}
