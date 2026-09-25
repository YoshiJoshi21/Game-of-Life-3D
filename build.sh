#!/usr/bin/env bash
# Compiles the C++ engine + analysis to WebAssembly for the website.
# Needs Emscripten (https://emscripten.org/docs/getting_started/downloads.html).
# Output goes to web/wasm/, which the site loads.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p web/wasm
em++ wasm/bindings.cpp -o web/wasm/life.js \
  -std=c++17 -O3 -lembind \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createLifeModule \
  -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,worker \
  -sFILESYSTEM=0
echo "built web/wasm/life.js + web/wasm/life.wasm"
