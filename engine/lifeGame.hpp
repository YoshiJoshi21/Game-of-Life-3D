#pragma once
#include <cstdint>
#include <vector>
using namespace std;
// interface shared by the 2D and 3D game of life simulators
class LifeGame {
public:
    virtual ~LifeGame() = default;

    virtual void setRule(vector<int> B, vector<int> S) = 0;
    virtual vector<int> getBirthCounts() const = 0;
    virtual vector<int> getSurvivalCounts() const = 0;

    // a 2D grid is one layer deep
    virtual int getWidth() const = 0;
    virtual int getHeight() const = 0;
    virtual int getDepth() const = 0;
    virtual long getGeneration() const = 0;

    virtual void clear() = 0;
    virtual void step() = 0;
    virtual void randomize(double density, unsigned seed) = 0;
    virtual long population() const = 0;

    // one byte per cell, index of (x, y, z) is (z * height + y) * width + x
    virtual const vector<uint8_t> &flatten() const = 0;
};
