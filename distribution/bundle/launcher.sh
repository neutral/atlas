#!/bin/sh
set -eu
atlas_launcher=$0
case "$atlas_launcher" in */*) ;; *) atlas_launcher=./$atlas_launcher ;; esac
atlas_invoked=$(CDPATH= cd -P -- "${atlas_launcher%/*}" && pwd)/${atlas_launcher##*/}
while [ -L "$atlas_launcher" ]; do
  atlas_directory=$(CDPATH= cd -P -- "${atlas_launcher%/*}" && pwd)
  atlas_link=$(/usr/bin/readlink "$atlas_launcher")
  case "$atlas_link" in
    /*) atlas_launcher=$atlas_link ;;
    *) atlas_launcher=$atlas_directory/$atlas_link ;;
  esac
done
atlas_directory=$(CDPATH= cd -P -- "${atlas_launcher%/*}/.." && pwd)
ATLAS_LAUNCHER=$atlas_invoked
export ATLAS_LAUNCHER
unset NODE_PATH NODE_OPTIONS
atlas_node=${ATLAS_NODE:-$atlas_directory/runtime/bin/node}
case "$atlas_node" in /*) ;; *) echo 'Atlas: ATLAS_NODE requires an absolute executable path.' >&2; exit 2 ;; esac
if [ ! -x "$atlas_node" ]; then
  echo 'Atlas: runtime unavailable. A payload requires ATLAS_NODE=/absolute/path/to/node.' >&2
  exit 2
fi
if [ -n "${ATLAS_NODE:-}" ]; then
  atlas_manifest=$atlas_directory/payload.json
  if [ ! -f "$atlas_manifest" ]; then atlas_manifest=$atlas_directory/bundle.json; fi
  "$atlas_node" --input-type=module -e 'import fs from "node:fs"; const [major,minor,patch]=process.versions.node.split(".").map(Number); if (!((major===22 && (minor>23 || minor===23 && patch>=2)) || major===24)) { console.error("Atlas: shared runtime requires Node 22.23.2+ on major 22, or Node 24."); process.exit(2); } const target=JSON.parse(fs.readFileSync(process.argv[1], "utf8")).target; if (target!==`${process.platform}-${process.arch}`) { console.error(`Atlas: application payload requires ${target}; selected runtime is ${process.platform}-${process.arch}.`); process.exit(2); }' "$atlas_manifest" || exit 2
fi
exec "$atlas_node" "$atlas_directory/app/node_modules/atlas-reference-validator/bin/atlas.mjs" "$@"
