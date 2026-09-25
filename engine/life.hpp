#pragma once
#include "lifeGame.hpp"
#include <cstdint>
#include <vector>
#include <random>
#include <algorithm>
using namespace std;
// 2D game of life simulator
class LifeGrid : public LifeGame {
private:
    inline bool at(int x, int y) const {
        return cells[y][x];
    }

    // precompute lookup tables for canBirth and canSurvive
    void rebuildRuleTables() {
        fill(begin(canBirth), end(canBirth), false);
        fill(begin(canSurvive), end(canSurvive), false);
        for (int n : birthCounts) if (n >= 0 && n <= 8) canBirth[n] = true;
        for (int n : survivalCounts) if (n >= 0 && n <= 8) canSurvive[n] = true;
    }
    int width = 0;
    int height = 0;
    long generation = 0;
    vector<vector<bool>> cells;
    vector<vector<bool>> nextCells;
    vector<int> birthCounts;
    vector<int> survivalCounts;
    bool canBirth[9] = {};
    bool canSurvive[9] = {};
    mutable vector<uint8_t> flat;

public:
    LifeGrid(int w, int h) {
        width = w;
        height = h;
        cells.assign(height, vector<bool>(width));
        nextCells.assign(height, vector<bool>(width));
        generation = 0;
        birthCounts = {3};
        survivalCounts = {2, 3};
        rebuildRuleTables();
    }
    LifeGrid(int w, int h, vector<int> B, vector<int> S) : LifeGrid(w, h) {
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
    // a 2D grid is one layer deep
    int getDepth() const override {
        return 1;
    }
    long getGeneration() const override {
        return generation;
    }

    void clear() override {
        for (auto &row : cells)
            fill(row.begin(), row.end(), 0);
        generation = 0;
    }

    static int wrap(int v, int n) {
        return (v % n + n) % n;
    }

    bool get(int x, int y) const {
        x = wrap(x, width);
        y = wrap(y, height);
        return cells[y][x];
    }

    void set(int x, int y, bool alive) {
        x = wrap(x, width);
        y = wrap(y, height);
        cells[y][x] = alive;
    }

    void toggle(int x, int y) {
        x = wrap(x, width);
        y = wrap(y, height);
        cells[y][x] = !cells[y][x];
    }

    int neighborCount(int x, int y) const {
        int n = 0;
        for (int dy = -1; dy <= 1; ++dy) {
            for (int dx = -1; dx <= 1; ++dx) {
                if (dx == 0 && dy == 0) continue;
                n += get(x + dx, y + dy);
            }
        }
        return n;
    }

    // Advances the simulation by one step using the current birth/death rules
    void step() override {
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                int n = neighborCount(x, y);
                bool alive = at(x, y);
                nextCells[y][x] = alive ? canSurvive[n] : canBirth[n];
            }
        }
        swap(cells, nextCells);
        ++generation;
    }

    void randomize(double density, unsigned seed) override {
        mt19937 rng(seed);
        bernoulli_distribution dist(density);
        for (auto &row : cells)
            for (size_t x = 0; x < row.size(); ++x)
                row[x] = dist(rng);
        generation = 0;
    }

    long population() const override {
        long p = 0;
        for (auto &row : cells)
            for (bool c : row) p += c;
        return p;
    }

    const vector<vector<bool>> &getCells() const {
        return cells;
    }

    // this is needed for UI to work
    const vector<uint8_t> &flatten() const override {
        flat.resize(static_cast<size_t>(width) * height);
        for (int y = 0; y < height; ++y)
            for (int x = 0; x < width; ++x)
                flat[static_cast<size_t>(y) * width + x] = cells[y][x] ? 1 : 0;
        return flat;
    }

    bool equals(const LifeGrid &other) const {
        return width == other.width && height == other.height && cells == other.cells;
    }

};
