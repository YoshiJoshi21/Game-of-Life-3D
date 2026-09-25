#pragma once
#include "lifeGame.hpp"
#include <cstdint>
#include <vector>
#include <random>
#include <algorithm>
using namespace std;
// 3D game of life simulator
class LifeGrid3D : public LifeGame {
private:
    inline bool at(int x, int y, int z) const {
        return cells[z][y][x];
    }

    // precompute lookup tables for canBirth and canSurvive
    void rebuildRuleTables() {
        fill(begin(canBirth), end(canBirth), false);
        fill(begin(canSurvive), end(canSurvive), false);
        for (int n : birthCounts) if (n >= 0 && n <= 26) canBirth[n] = true;
        for (int n : survivalCounts) if (n >= 0 && n <= 26) canSurvive[n] = true;
    }
    int width = 0;
    int height = 0;
    int depth = 0;
    long generation = 0;
    vector<vector<vector<bool>>> cells;
    vector<vector<vector<bool>>> nextCells;
    vector<int> birthCounts;
    vector<int> survivalCounts;
    bool canBirth[27] = {};
    bool canSurvive[27] = {};
    mutable vector<uint8_t> flat;

public:
    LifeGrid3D(int w, int h, int d) {
        width = w;
        height = h;
        depth = d;
        cells.assign(depth, vector<vector<bool>>(height, vector<bool>(width)));
        nextCells.assign(depth, vector<vector<bool>>(height, vector<bool>(width)));
        generation = 0;
        // B5/S45 (Carter Bays' "Life 4555"), a 3D rule known to have gliders
        birthCounts = {5};
        survivalCounts = {4, 5};
        rebuildRuleTables();
    }
    LifeGrid3D(int w, int h, int d, vector<int> B, vector<int> S) : LifeGrid3D(w, h, d) {
        setRule(B, S);
    }

    void setRule(vector<int> B, vector<int> S) override {
        birthCounts = B;
        survivalCounts = S;
        rebuildRuleTables();
    }
    vector<int> getBirthCounts() const override {
        return birthCounts;
    }
    vector<int> getSurvivalCounts() const override {
        return survivalCounts;
    }
    int getWidth() const override {
        return width;
    }
    int getHeight() const override {
        return height;
    }
    int getDepth() const override {
        return depth;
    }
    long getGeneration() const override {
        return generation;
    }

    void clear() override {
        for (auto &layer : cells)
            for (auto &row : layer)
                fill(row.begin(), row.end(), 0);
        generation = 0;
    }

    static int wrap(int v, int n) {
        return (v % n + n) % n;
    }

    bool get(int x, int y, int z) const {
        x = wrap(x, width);
        y = wrap(y, height);
        z = wrap(z, depth);
        return cells[z][y][x];
    }

    void set(int x, int y, int z, bool alive) {
        x = wrap(x, width);
        y = wrap(y, height);
        z = wrap(z, depth);
        cells[z][y][x] = alive;
    }

    void toggle(int x, int y, int z) {
        x = wrap(x, width);
        y = wrap(y, height);
        z = wrap(z, depth);
        cells[z][y][x] = !cells[z][y][x];
    }

    // counts the 26 neighbors in the 3x3x3 cube around (x, y, z)
    int neighborCount(int x, int y, int z) const {
        int n = 0;
        for (int dz = -1; dz <= 1; ++dz) {
            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    if (dx == 0 && dy == 0 && dz == 0) continue;
                    n += get(x + dx, y + dy, z + dz);
                }
            }
        }
        return n;
    }

    // Advances the simulation by one step using the current birth/death rules
    void step() override {
        for (int z = 0; z < depth; ++z) {
            for (int y = 0; y < height; ++y) {
                for (int x = 0; x < width; ++x) {
                    int n = neighborCount(x, y, z);
                    bool alive = at(x, y, z);
                    nextCells[z][y][x] = alive ? canSurvive[n] : canBirth[n];
                }
            }
        }
        swap(cells, nextCells);
        ++generation;
    }

    void randomize(double density, unsigned seed) override {
        mt19937 rng(seed);
        bernoulli_distribution dist(density);
        for (auto &layer : cells)
            for (auto &row : layer)
                for (size_t x = 0; x < row.size(); ++x)
                    row[x] = dist(rng);
        generation = 0;
    }

    long population() const override {
        long p = 0;
        for (auto &layer : cells)
            for (auto &row : layer)
                for (bool c : row) p += c;
        return p;
    }

    const vector<vector<vector<bool>>> &getCells() const {
        return cells;
    }

    // this is needed for UI to work
    // index of (x, y, z) is (z * height + y) * width + x
    const vector<uint8_t> &flatten() const override {
        flat.resize(static_cast<size_t>(width) * height * depth);
        for (int z = 0; z < depth; ++z)
            for (int y = 0; y < height; ++y)
                for (int x = 0; x < width; ++x)
                    flat[(static_cast<size_t>(z) * height + y) * width + x] = cells[z][y][x] ? 1 : 0;
        return flat;
    }

    bool equals(const LifeGrid3D &other) const {
        return width == other.width && height == other.height && depth == other.depth && cells == other.cells;
    }

};
