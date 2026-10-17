#!/usr/bin/env bash
# Fetch the model files Kino's apps need, into ComfyUI's folder layout.
#
#   bash download-models.sh image-fast video-pro      # just these apps
#   bash download-models.sh --all                     # everything
#   bash download-models.sh --dry-run video-pro       # sizes and free space, no download
#   bash download-models.sh --list                    # app names
#
# Where files go: $MODELS_DIR if set; else /workspace/ComfyUI/models on a
# ComfyUI pod; else /workspace/models (a network volume on a pod, which
# Serverless workers see as /runpod-volume/models). Files already there are
# skipped, interrupted downloads resume. Set HF_TOKEN for gated models.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
manifest="$here/models.json"
dry=0
all=0
list=0
wanted=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry=1 ;;
    --all) all=1 ;;
    --list) list=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) wanted+=("$arg") ;;
  esac
done

if [ -n "${MODELS_DIR:-}" ]; then dest="$MODELS_DIR"
elif [ -d /workspace/ComfyUI/models ]; then dest=/workspace/ComfyUI/models
else dest=/workspace/models
fi

command -v python3 >/dev/null || { echo "python3 is needed to read models.json" >&2; exit 1; }

if [ "$list" = 1 ]; then
  python3 - "$manifest" <<'PY'
import json, sys
apps = sorted({a for m in json.load(open(sys.argv[1]))["models"] for a in m.get("apps", [])})
print("Apps:", " ".join(apps))
PY
  exit 0
fi

if [ "$all" = 0 ] && [ "${#wanted[@]}" = 0 ]; then
  echo "Name the apps to fetch models for (or --all). Try --list." >&2
  exit 2
fi

plan="$(python3 - "$manifest" "$all" "${wanted[@]}" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))["models"]
everything = sys.argv[2] == "1"
wanted = set(sys.argv[3:])
known = {a for f in m for a in f.get("apps", []) + f.get("usedBy", [])}
unknown = sorted(wanted - known)
if unknown:
    sys.stderr.write("Unknown app(s): %s\nKnown: %s\n" % (", ".join(unknown), " ".join(sorted(known))))
    sys.exit(3)
for f in m:
    if everything or wanted & set(f.get("apps", []) + f.get("usedBy", [])):
        print("\t".join([f["directory"], f["name"], f["url"]]))
PY
)"

auth=()
[ -n "${HF_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $HF_TOKEN")

# Bytes behind a URL (0 when the host can't be reached); never fails the script.
size_of() {
  { curl -sIL --max-time 30 "${auth[@]}" "$1" || true; } | tr -d '\r' |
    awk 'tolower($1)=="x-linked-size:"{s=$2} tolower($1)=="content-length:"{c=$2} /^HTTP/{code=$2} END{print (code>=200 && code<300) ? (s?s:c)+0 : 0}'
}
gb() { awk -v b="$1" 'BEGIN{printf "%.1f", b/1e9}'; }

total=0
count=0
while IFS=$'\t' read -r dir name url; do
  [ -z "$name" ] && continue
  count=$((count + 1))
  target="$dest/$dir/$name"
  if [ -s "$target" ] && [ ! -e "$target.part" ]; then
    echo "have   $dir/$name"
    continue
  fi
  if [ "$dry" = 1 ]; then
    bytes="$(size_of "$url")"
    total=$((total + bytes))
    if [ "$bytes" = 0 ]; then size="  size unknown"; else size="$(gb "$bytes") GB"; fi
    printf 'fetch  %-22s %-64s %s\n' "$dir" "$name" "$size"
    continue
  fi
  mkdir -p "$dest/$dir"
  echo "fetch  $dir/$name"
  curl -L --fail --retry 5 --retry-delay 3 -C - "${auth[@]}" -o "$target.part" "$url"
  mv "$target.part" "$target"
done <<< "$plan"

if [ "$dry" = 1 ]; then
  mkdir -p "$dest"
  free="$(df -B1 --output=avail "$dest" | tail -1 | tr -d ' ')"
  printf '\n%d files, %s GB to download (known sizes), %s GB free in %s\n' "$count" "$(gb "$total")" "$(gb "$free")" "$dest"
  [ "$total" -lt "$free" ] || echo "Not enough space: grow the volume first." >&2
else
  echo "Done: $count files in $dest"
fi
