#include "analysis.hpp"
#include "../engine/life.hpp"
#include "../engine/life3D.hpp"
#include <iostream>
#include <iomanip>
#include <unordered_set>
using namespace std;

// e.g. "B3/S23". 3D counts go up to 26, so two digit counts get commas
string ruleString(vector<int> B, vector<int> S) {
    bool commas = false;
    for (int n : B) if (n >= 10) commas = true;
    for (int n : S) if (n >= 10) commas = true;
    string s = "B";
    for (size_t i = 0; i < B.size(); ++i) {
        if (commas && i > 0) s += ",";
        s += to_string(B[i]);
    }
    s += "/S";
    for (size_t i = 0; i < S.size(); ++i) {
        if (commas && i > 0) s += ",";
        s += to_string(S[i]);
    }
    return s;
}

// rule and category on the first line, each trial on the second
void printResult(int number, RuleResult r) {
    cout << setw(3) << number << "  " << left << setw(12) << Analysis::categoryName(r.category)
         << right << ruleString(r.birth, r.survival) << "\n     ";
    for (TrialResult t : r.trials) {
        cout << " | d=" << fixed << setprecision(2) << t.density << " " << Analysis::categoryName(t.category);
        if (t.period > 0) cout << " p=" << t.period << " @" << t.cycleFoundAt;
        else cout << " H=" << setprecision(3) << t.entropy;
        if (t.activeEntropy >= 0) cout << " Ha=" << setprecision(3) << t.activeEntropy;
        if (t.finalPopulation == 0) cout << " (extinct)";
    }
    cout << "\n";
}

// classifies `count` different random rules on the same game (2D or 3D).
// a rule is a random number: the first maxNeighbors+1 bits are the birth
// counts and the next maxNeighbors+1 bits are the survival counts
void runRandomRules(LifeGame &game, Analysis &analysis, int maxNeighbors, int count, mt19937_64 &rng) {
    int bitsPerSet = maxNeighbors + 1;
    uint64_t mask = (1ULL << (2 * bitsPerSet)) - 1;
    unordered_set<uint64_t> used;
    int totals[4] = {};

    int number = 0;
    while (number < count) {
        uint64_t bits = rng() & mask;
        if (used.count(bits)) continue;
        used.insert(bits);

        vector<int> B;
        vector<int> S;
        for (int n = 0; n <= maxNeighbors; ++n) {
            if (bits & (1ULL << n)) B.push_back(n);
            if (bits & (1ULL << (n + bitsPerSet))) S.push_back(n);
        }
        game.setRule(B, S);
        RuleResult r = analysis.classify(game);
        ++totals[r.category];
        ++number;
        printResult(number, r);
    }

    cout << "\nTotals:\n";
    for (int c = 0; c < 4; ++c)
        cout << "  " << left << setw(12) << Analysis::categoryName(static_cast<Category>(c)) << right << totals[c] << "\n";
    cout << "\n";
}

int main() {
    mt19937_64 rng(2026);

    cout << "=== 2D rules (64x64, 500 generations) ===\n";
    LifeGrid grid(64, 64);
    Analysis analysis2D(500, {0.2, 0.35, 0.5}, 2026);
    runRandomRules(grid, analysis2D, 8, 100, rng);

    // with 26 neighbors a 50% start overcrowds almost every rule, so 3D
    // starts sparser. Bays' B5/S45 and B6/S567 settle by generation 29-85 at
    // d=0.2 with active entropy 0.13-0.27, so they count as complex
    cout << "=== 3D rules (24x24x24, 200 generations) ===\n";
    LifeGrid3D grid3D(24, 24, 24);
    Analysis analysis3D(200, {0.1, 0.2, 0.35}, 2026, 0.35);
    runRandomRules(grid3D, analysis3D, 26, 100, rng);
    return 0;
}
