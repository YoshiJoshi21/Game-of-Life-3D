// JavaScript bindings for the engine and the analysis, compiled to
// WebAssembly with Emscripten (see build.sh). Nothing in engine/ or analysis/
// is changed; this file only wraps them so the website can call them.
#include "../engine/life.hpp"
#include "../engine/life3D.hpp"
#include "../analysis/analysis.hpp"
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <memory>
#include <unordered_set>

namespace em = emscripten;

// rules cross into JS as bitmasks: bit n set means count n is in the list.
// 3D counts go up to 26, so a mask always fits in 32 bits
static vector<int> maskToCounts(uint32_t mask, int maxNeighbors) {
    vector<int> counts;
    for (int n = 0; n <= maxNeighbors; ++n)
        if (mask & (1u << n)) counts.push_back(n);
    return counts;
}

static uint32_t countsToMask(const vector<int> &counts) {
    uint32_t mask = 0;
    for (int n : counts)
        if (n >= 0 && n < 32) mask |= 1u << n;
    return mask;
}

// copies bytes out of wasm memory into a fresh Uint8Array
static em::val copyBytes(const vector<uint8_t> &bytes) {
    return em::val::global("Uint8Array").new_(em::typed_memory_view(bytes.size(), bytes.data()));
}

// the interactive simulator behind the viewer: one 2D or 3D game
class Simulator {
private:
    unique_ptr<LifeGrid> grid2D;
    unique_ptr<LifeGrid3D> grid3D;
    LifeGame *game = nullptr;
    int maxNeighbors = 8;

public:
    Simulator(int w, int h, int d, bool is3D) {
        if (is3D) {
            grid3D = make_unique<LifeGrid3D>(w, h, d);
            game = grid3D.get();
            maxNeighbors = 26;
        } else {
            grid2D = make_unique<LifeGrid>(w, h);
            game = grid2D.get();
        }
    }

    bool is3D() const { return grid3D != nullptr; }
    int width() const { return game->getWidth(); }
    int height() const { return game->getHeight(); }
    int depth() const { return game->getDepth(); }
    double generation() const { return static_cast<double>(game->getGeneration()); }
    double population() const { return static_cast<double>(game->population()); }

    void setRule(uint32_t birthMask, uint32_t survivalMask) {
        game->setRule(maskToCounts(birthMask, maxNeighbors), maskToCounts(survivalMask, maxNeighbors));
    }
    uint32_t birthMask() const { return countsToMask(game->getBirthCounts()); }
    uint32_t survivalMask() const { return countsToMask(game->getSurvivalCounts()); }

    void step(int n) {
        for (int i = 0; i < n; ++i) game->step();
    }
    void randomize(double density, unsigned seed) { game->randomize(density, seed); }
    void clear() { game->clear(); }

    void set(int x, int y, int z, bool alive) {
        if (grid3D) grid3D->set(x, y, z, alive);
        else grid2D->set(x, y, alive);
    }
    bool get(int x, int y, int z) const {
        return grid3D ? grid3D->get(x, y, z) : grid2D->get(x, y);
    }

    // a view straight into wasm memory, valid until the next call into wasm
    em::val cells() const {
        const vector<uint8_t> &flat = game->flatten();
        return em::val(em::typed_memory_view(flat.size(), flat.data()));
    }

    // loads a whole grid from a Uint8Array laid out like flatten()
    void load(em::val array) {
        vector<uint8_t> bytes = em::convertJSArrayToNumberVector<uint8_t>(array);
        int w = width(), h = height(), d = depth();
        size_t i = 0;
        for (int z = 0; z < d; ++z)
            for (int y = 0; y < h; ++y)
                for (int x = 0; x < w; ++x, ++i)
                    set(x, y, z, i < bytes.size() && bytes[i]);
    }
};

// forwards everything to another game, except that each randomize() uses the
// next seed from a list we choose. Analysis draws trial seeds from one rng in
// order, so this lets any rule be classified on its own (in parallel, in a
// web worker) with exactly the seeds main.cpp would give it. It also keeps
// each trial's final grid for the thumbnails
class SeededGame : public LifeGame {
private:
    LifeGame &inner;
    vector<unsigned> seeds;
    size_t nextSeed = 0;

public:
    vector<vector<uint8_t>> finalStates;

    SeededGame(LifeGame &game, vector<unsigned> trialSeeds) : inner(game), seeds(trialSeeds) {}

    // the grid at the end of the last trial
    void finish() { finalStates.push_back(inner.flatten()); }

    void randomize(double density, unsigned) override {
        if (nextSeed > 0) finish();
        inner.randomize(density, seeds[nextSeed++ % seeds.size()]);
    }

    void setRule(vector<int> B, vector<int> S) override { inner.setRule(B, S); }
    vector<int> getBirthCounts() const override { return inner.getBirthCounts(); }
    vector<int> getSurvivalCounts() const override { return inner.getSurvivalCounts(); }
    int getWidth() const override { return inner.getWidth(); }
    int getHeight() const override { return inner.getHeight(); }
    int getDepth() const override { return inner.getDepth(); }
    long getGeneration() const override { return inner.getGeneration(); }
    void clear() override { inner.clear(); }
    void step() override { inner.step(); }
    long population() const override { return inner.population(); }
    const vector<uint8_t> &flatten() const override { return inner.flatten(); }
};

// the same rules runRandomRules() in main.cpp picks, as {birth, survival}
// masks. main.cpp draws the 3D rules from the same rng right after the 2D
// ones, so for 3D the 2D draws are replayed first to stay in step with it
em::val randomRules(int count, bool is3D, double seed) {
    mt19937_64 rng(static_cast<uint64_t>(seed));
    auto draw = [&](int maxNeighbors, bool keep) {
        int bitsPerSet = maxNeighbors + 1;
        uint64_t mask = (1ULL << (2 * bitsPerSet)) - 1;
        unordered_set<uint64_t> used;
        em::val rules = em::val::array();
        int number = 0;
        while (number < count) {
            uint64_t bits = rng() & mask;
            if (used.count(bits)) continue;
            used.insert(bits);
            ++number;
            if (!keep) continue;
            uint64_t setMask = (1ULL << bitsPerSet) - 1;
            em::val rule = em::val::object();
            rule.set("birth", static_cast<uint32_t>(bits & setMask));
            rule.set("survival", static_cast<uint32_t>((bits >> bitsPerSet) & setMask));
            rules.call<void>("push", rule);
        }
        return rules;
    };
    if (is3D) {
        draw(8, false);
        return draw(26, true);
    }
    return draw(8, true);
}

// classifies one rule with Analysis::classify. ruleIndex is the rule's place
// in the list, which picks its trial seeds out of the Analysis rng stream
em::val classifyRule(bool is3D, int w, int h, int d, double maxGen, em::val densityArray,
                     double analysisSeed, int ruleIndex, double chaosThreshold,
                     uint32_t birthMask, uint32_t survivalMask) {
    vector<double> densities = em::convertJSArrayToNumberVector<double>(densityArray);

    mt19937 seedRng(static_cast<unsigned>(analysisSeed));
    seedRng.discard(static_cast<unsigned long long>(ruleIndex) * densities.size());
    vector<unsigned> seeds;
    for (size_t i = 0; i < densities.size(); ++i) seeds.push_back(seedRng());

    unique_ptr<LifeGame> game;
    int maxNeighbors = is3D ? 26 : 8;
    if (is3D) game = make_unique<LifeGrid3D>(w, h, d);
    else game = make_unique<LifeGrid>(w, h);
    game->setRule(maskToCounts(birthMask, maxNeighbors), maskToCounts(survivalMask, maxNeighbors));

    SeededGame seeded(*game, seeds);
    Analysis analysis(static_cast<long>(maxGen), densities, static_cast<unsigned>(analysisSeed), chaosThreshold);
    RuleResult r = analysis.classify(seeded);
    seeded.finish();

    em::val out = em::val::object();
    out.set("category", static_cast<int>(r.category));
    out.set("categoryName", Analysis::categoryName(r.category));
    out.set("birth", countsToMask(r.birth));
    out.set("survival", countsToMask(r.survival));
    em::val trials = em::val::array();
    for (size_t i = 0; i < r.trials.size(); ++i) {
        const TrialResult &t = r.trials[i];
        em::val trial = em::val::object();
        trial.set("density", t.density);
        trial.set("seed", seeds[i]);
        trial.set("category", static_cast<int>(t.category));
        trial.set("period", static_cast<double>(t.period));
        trial.set("cycleFoundAt", static_cast<double>(t.cycleFoundAt));
        trial.set("finalPopulation", static_cast<double>(t.finalPopulation));
        trial.set("entropy", t.entropy);
        trial.set("finalState", copyBytes(seeded.finalStates[i]));
        trials.call<void>("push", trial);
    }
    out.set("trials", trials);
    return out;
}

EMSCRIPTEN_BINDINGS(life) {
    em::class_<Simulator>("Simulator")
        .constructor<int, int, int, bool>()
        .function("is3D", &Simulator::is3D)
        .function("width", &Simulator::width)
        .function("height", &Simulator::height)
        .function("depth", &Simulator::depth)
        .function("generation", &Simulator::generation)
        .function("population", &Simulator::population)
        .function("setRule", &Simulator::setRule)
        .function("birthMask", &Simulator::birthMask)
        .function("survivalMask", &Simulator::survivalMask)
        .function("step", &Simulator::step)
        .function("randomize", &Simulator::randomize)
        .function("clear", &Simulator::clear)
        .function("set", &Simulator::set)
        .function("get", &Simulator::get)
        .function("cells", &Simulator::cells)
        .function("load", &Simulator::load);
    em::function("randomRules", &randomRules);
    em::function("classifyRule", &classifyRule);
}
