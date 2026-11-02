#!/bin/sh
# Builds mbrola.js: the MBROLA standalone program, unmodified, compiled to WebAssembly with
# Emscripten (the .wasm is embedded in the .js so that the page also works from file://).
#
#   git clone https://github.com/numediart/MBROLA.git   (built from commit 274dead1)
#   source /path/to/emsdk/emsdk_env.sh
#   sh build.sh /path/to/MBROLA
set -e
SRC=${1:?usage: sh build.sh /path/to/MBROLA}
cd "$(dirname "$0")"

emcc -O2 -DLITTLE_ENDIAN -DROMDATABASE_STORE -DROMDATABASE_INIT \
  -I"$SRC/Parser" -I"$SRC/Standalone" -I"$SRC/Misc" -I"$SRC/Engine" -I"$SRC/Database" \
  "$SRC/Standalone/synth.c" \
  "$SRC/Engine/mbrola.c" "$SRC/Engine/diphone.c" \
  "$SRC/Parser/phone.c" "$SRC/Parser/parser_input.c" "$SRC/Parser/input_file.c" "$SRC/Parser/phonbuff.c" \
  "$SRC/Misc/audio.c" "$SRC/Misc/vp_error.c" "$SRC/Misc/mbralloc.c" "$SRC/Misc/common.c" \
  "$SRC/Database/database.c" "$SRC/Database/database_old.c" "$SRC/Database/diphone_info.c" \
  "$SRC/Database/little_big.c" "$SRC/Database/hash_tab.c" "$SRC/Database/zstring_list.c" \
  "$SRC/Database/rom_handling.c" "$SRC/Database/rom_database.c" \
  reset.c \
  -sMODULARIZE -sEXPORT_NAME=createMbrola -sSINGLE_FILE -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
  -sALLOW_MEMORY_GROWTH -sFORCE_FILESYSTEM -sENVIRONMENT=web,node \
  -sEXPORTED_RUNTIME_METHODS=FS,callMain -sEXPORTED_FUNCTIONS=_main,_mbrola_reset \
  -o mbrola.js
