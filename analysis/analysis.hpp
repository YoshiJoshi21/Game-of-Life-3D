#pragma once
#include "../engine/lifeGame.hpp"
#include <cstdint>
#include <vector>
#include <string>
#include <random>
#include <cmath>
#include <algorithm>
#include <map>
using namespace std;

enum Category { STABLE, OSCILLATING, CHAOTIC, COMPLEX };

// for 2D simulations the depth is 1
using Grid = vector<vector<vector<uint8_t>>>;
using Sums = vector<vector<vector<int>>>;

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
    // subgrid size and number of generations to average entropy over
    static constexpr int SUBGRID = 5;
    static constexpr int ENTROPY_GENS = 50;

    // copies flatten() into a 3D array
    Grid toGrid(const LifeGame &game) const {
        int w = game.getWidth();
        int h = game.getHeight();
        int d = game.getDepth();
        const vector<uint8_t> &flat = game.flatten();
        Grid grid(d, vector<vector<uint8_t>>(h, vector<uint8_t>(w)));
        size_t i = 0;
        for (int z = 0; z < d; z++)
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                    grid[z][y][x] = flat[i++];
        return grid;
    }

    // hash of the whole grid, used to find repeated states.
    uint64_t hashGrid(const Grid &grid) const {
        uint64_t h = 1469598103934665603ULL;
        for (const auto &layer : grid) {
            for (const auto &row : layer) {
                for (uint8_t c : row) {
                    h ^= c;
                    h *= 1099511628211ULL;
                }
            }
        }
        return h;
    }

    // average shannon entropy of every subgrid
    double meanEntropy(const Grid &grid) const {
        int d = grid.size();
        int h = grid[0].size();
        int w = grid[0][0].size();
        int sx = min(SUBGRID, w);
        int sy = min(SUBGRID, h);
        int sz = min(SUBGRID, d);
        int subgridSize = sx * sy * sz;

        // precompute entropy for every possible live count
        vector<double> entropyTable(subgridSize + 1, 0);
        for (int k = 1; k < subgridSize; k++) {
            double p = ((double)k) / subgridSize;
            entropyTable[k] = -(p * log2(p) + (1 - p) * log2(1 - p));
        }

        // find the number of cells in every 5x5 subgrid
        Sums sumX(d, vector<vector<int>>(h, vector<int>(w)));
        Sums sumXY(d, vector<vector<int>>(h, vector<int>(w)));
        for (int z = 0; z < d; z++) {
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    for (int k = 0; k < sx; k++)
                        sumX[z][y][x] += grid[z][y][(x + k) % w];
                }
            }
        }
        for (int z = 0; z < d; z++) {
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    for (int k = 0; k < sy; k++)
                        sumXY[z][y][x] += sumX[z][(y + k) % h][x];
                }
            }
        }
        double total = 0;
        for (int z = 0; z < d; z++) {
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int sumXYZ = 0;
                    for (int k = 0; k < sz; k++)
                        sumXYZ += sumXY[(z + k) % d][y][x];
                    total += entropyTable[sumXYZ];
                }
            }
        }
        return total / ((double)(w) * h * d);
    }

    // runs the game from one random start until it repeats or hits maxGen
    TrialResult runTrial(LifeGame &game, double density, unsigned seed) const {
        game.randomize(density, seed);
        TrialResult result;
        result.density = density;

        // generation each grid state was first seen
        map<uint64_t, long> seen;
        double entropySum = 0;
        int entropySamples = 0;

        // classify as stable or oscillating
        for (long gen = 0; gen <= maxGen; gen++) {
            Grid grid = toGrid(game);
            uint64_t h = hashGrid(grid);
            if (seen.count(h)) {
                result.period = gen - seen[h];
                result.cycleFoundAt = gen;
                result.category = result.period == 1 ? STABLE : OSCILLATING;
                result.finalPopulation = game.population();
                return result;
            }
            seen[h] = gen;
            if (gen > maxGen - ENTROPY_GENS) {
                entropySum += meanEntropy(grid);
                entropySamples++;
            }
            if (gen < maxGen) game.step();
        }

        // classify as chaotic or complex
        result.entropy = entropySum / entropySamples;
        result.category = result.entropy > chaosThreshold ? CHAOTIC : COMPLEX;
        result.finalPopulation = game.population();
        return result;
    }

    long maxGen = 0;
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

    // runs the analysis for multiple densities and decides catagory via majority vote
    RuleResult classify(LifeGame &game) {
        RuleResult result;
        result.birth = game.getBirthCounts();
        result.survival = game.getSurvivalCounts();

        int votes[4] = {};
        for (double d : densities) {
            TrialResult t = runTrial(game, d, rng());
            result.trials.push_back(t);
            votes[t.category]++;
        }
        int best = 0;
        for (int c = 1; c < 4; c++)
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
