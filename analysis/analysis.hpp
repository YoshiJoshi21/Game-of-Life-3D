#pragma once
#include "../engine/lifeGame.hpp"
#include <cstdint>
#include <vector>
#include <string>
#include <random>
#include <cmath>
#include <algorithm>
#include <unordered_map>
using namespace std;

enum Category { STABLE, OSCILLATING, CHAOTIC, COMPLEX };

// result of one run
struct TrialResult {
    double density = 0;
    Category category = STABLE;
    long period = -1;
    long cycleFoundAt = -1;
    long finalPopulation = 0;
    double entropy = -1;
};

// result of every run of one rule
struct RuleResult {
    vector<int> birth;
    vector<int> survival;
    Category category = STABLE;
    vector<TrialResult> trials;
};

// classifies a single rule
class Analysis {
private:
    // subgrids are 5x5 in 2D and 5x5x5 in 3D
    static const int SUBGRID = 5;
    // entropy is averaged over this many generations at the end of a run
    static const int ENTROPY_GENS = 50;

    // index of (x, y, z) in flatten()
    static size_t index(int x, int y, int z, int w, int h) {
        return (static_cast<size_t>(z) * h + y) * w + x;
    }

    // hash of the whole grid, used to find repeated states
    uint64_t hashGrid(const LifeGame &game) const {
        uint64_t h = 1469598103934665603ULL;
        for (uint8_t c : game.flatten()) {
            h ^= c;
            h *= 1099511628211ULL;
        }
        return h;
    }

    // average shannon entropy of every subgrid. 0 = all dead or all alive,
    // 1 = half alive. chaotic rules score high, complex rules score low
    double meanEntropy(const LifeGame &game) const {
        int w = game.getWidth();
        int h = game.getHeight();
        int d = game.getDepth();
        // a 2D game is 1 deep, so its subgrids are 5x5x1
        int sx = min(SUBGRID, w);
        int sy = min(SUBGRID, h);
        int sz = min(SUBGRID, d);
        int subgridSize = sx * sy * sz;
        const vector<uint8_t> &cells = game.flatten();

        // precompute entropy for every possible live count
        vector<double> entropyTable(subgridSize + 1, 0);
        for (int k = 1; k < subgridSize; ++k) {
            double p = static_cast<double>(k) / subgridSize;
            entropyTable[k] = -(p * log2(p) + (1 - p) * log2(1 - p));
        }

        // count live cells in each subgrid one axis at a time (5 along x,
        // then 5 of those along y, then 5 along z) instead of all 125 cells
        vector<int> sumX(cells.size());
        vector<int> sumXY(cells.size());
        for (int z = 0; z < d; ++z) {
            for (int y = 0; y < h; ++y) {
                for (int x = 0; x < w; ++x) {
                    int s = 0;
                    for (int k = 0; k < sx; ++k)
                        s += cells[index((x + k) % w, y, z, w, h)];
                    sumX[index(x, y, z, w, h)] = s;
                }
            }
        }
        for (int z = 0; z < d; ++z) {
            for (int y = 0; y < h; ++y) {
                for (int x = 0; x < w; ++x) {
                    int s = 0;
                    for (int k = 0; k < sy; ++k)
                        s += sumX[index(x, (y + k) % h, z, w, h)];
                    sumXY[index(x, y, z, w, h)] = s;
                }
            }
        }
        double total = 0;
        for (int z = 0; z < d; ++z) {
            for (int y = 0; y < h; ++y) {
                for (int x = 0; x < w; ++x) {
                    int s = 0;
                    for (int k = 0; k < sz; ++k)
                        s += sumXY[index(x, y, (z + k) % d, w, h)];
                    total += entropyTable[s];
                }
            }
        }
        return total / cells.size();
    }

    // runs the game from one random start until it repeats or hits maxGen
    TrialResult runTrial(LifeGame &game, double density, unsigned seed) const {
        game.randomize(density, seed);
        TrialResult result;
        result.density = density;

        // generation each grid state was first seen
        unordered_map<uint64_t, long> seen;
        double entropySum = 0;
        int entropySamples = 0;

        for (long gen = 0; gen <= maxGen; ++gen) {
            uint64_t h = hashGrid(game);
            if (seen.count(h)) {
                // period 1 is stable, anything longer oscillates
                result.period = gen - seen[h];
                result.cycleFoundAt = gen;
                result.category = result.period == 1 ? STABLE : OSCILLATING;
                result.finalPopulation = game.population();
                return result;
            }
            seen[h] = gen;

            if (gen > maxGen - ENTROPY_GENS) {
                entropySum += meanEntropy(game);
                ++entropySamples;
            }
            if (gen < maxGen) game.step();
        }

        // never repeated, so it's chaotic or complex
        result.entropy = entropySum / entropySamples;
        result.category = result.entropy > chaosThreshold ? CHAOTIC : COMPLEX;
        result.finalPopulation = game.population();
        return result;
    }

    long maxGen = 0;
    // mean entropy above this is chaotic, below is complex
    double chaosThreshold = 0.35;
    vector<double> densities;
    mt19937 rng;

public:
    Analysis(long gens, vector<double> starts, unsigned seed) {
        maxGen = gens;
        densities = starts;
        rng.seed(seed);
    }
    Analysis(long gens, vector<double> starts, unsigned seed, double threshold) : Analysis(gens, starts, seed) {
        chaosThreshold = threshold;
    }

    // runs the game once per starting density and takes a majority vote.
    // ties go to the more interesting category
    RuleResult classify(LifeGame &game) {
        RuleResult result;
        result.birth = game.getBirthCounts();
        result.survival = game.getSurvivalCounts();

        int votes[4] = {};
        for (double d : densities) {
            TrialResult t = runTrial(game, d, rng());
            result.trials.push_back(t);
            ++votes[t.category];
        }
        int best = 0;
        for (int c = 1; c < 4; ++c)
            if (votes[c] >= votes[best]) best = c;
        result.category = static_cast<Category>(best);
        return result;
    }

    static string categoryName(Category c) {
        if (c == STABLE) return "stable";
        if (c == OSCILLATING) return "oscillating";
        if (c == CHAOTIC) return "chaotic";
        return "complex";
    }

};
