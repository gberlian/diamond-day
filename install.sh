#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR=$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT="./rays"
AGENT="claude-code"
DEMO=0
RAYS=()

usage() {
  cat <<'HELP'
Usage: bash install.sh [--root PATH] [--agent claude-code|codex|claude-desktop]
                       [--ray NAME ...] [--demo]
Defaults: --root ./rays, --agent claude-code, --ray work.
--demo adds a ready-to-check 'demo' ray.
All existing files are preserved. New ray names are appended to rays.txt.
HELP
}
while (($#)); do
  case "$1" in
    --root) (($# >= 2)) || { usage >&2; exit 2; }; ROOT=$2; shift 2 ;;
    --agent) (($# >= 2)) || { usage >&2; exit 2; }; AGENT=$2; shift 2 ;;
    --ray) (($# >= 2)) || { usage >&2; exit 2; }; RAYS+=("$2"); shift 2 ;;
    --demo) DEMO=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done
case "$AGENT" in
  claude-code) RULE_FILE=CLAUDE.md ;;
  codex) RULE_FILE=AGENTS.md ;;
  claude-desktop) RULE_FILE=PROJECT-INSTRUCTIONS.md ;;
  *) echo "Invalid agent: $AGENT" >&2; exit 2 ;;
esac
if ((${#RAYS[@]} == 0)) && ((DEMO == 0)); then RAYS=(work); fi
if ((DEMO)); then RAYS+=(demo); fi

for ray in "${RAYS[@]}"; do
  [[ "$ray" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "Invalid ray name: $ray" >&2; exit 2; }
  case "$ray" in
    tools|templates|plans|docs|decisions|handoffs) echo "Reserved ray name: $ray" >&2; exit 2 ;;
  esac
done
mkdir -p "$ROOT"
ROOT=$(CDPATH= cd -- "$ROOT" && pwd)
created=0
preserved=0

copy_missing() {
  local from=$1 to=$2
  mkdir -p "$(dirname "$to")"
  if [[ -e "$to" || -L "$to" ]]; then
    preserved=$((preserved + 1))
  else
    cp "$from" "$to"
    created=$((created + 1))
  fi
}
render_missing() {
  local from=$1 to=$2 ray=$3
  mkdir -p "$(dirname "$to")"
  if [[ -e "$to" || -L "$to" ]]; then
    preserved=$((preserved + 1))
  else
    sed "s/{{RAY_NAME}}/$ray/g" "$from" > "$to"
    created=$((created + 1))
  fi
}
for file in "$SOURCE_DIR"/templates/*; do
  [[ -f "$file" ]] || continue
  copy_missing "$file" "$ROOT/templates/$(basename "$file")"
done
for name in check-goals.mjs check-rays.mjs board.mjs open-note.mjs; do
  copy_missing "$SOURCE_DIR/tools/$name" "$ROOT/tools/$name"
done
copy_missing "$SOURCE_DIR/templates/root-README.md" "$ROOT/README.md"
if [[ ! -e "$ROOT/rays.txt" && ! -L "$ROOT/rays.txt" ]]; then
  copy_missing "$SOURCE_DIR/templates/rays.txt" "$ROOT/rays.txt"
fi

add_active_ray() {
  local ray=$1
  if ! tr -d '\r' < "$ROOT/rays.txt" | grep -Fqx "$ray"; then
    [[ -z "$(tail -c 1 "$ROOT/rays.txt")" ]] || printf '\n' >> "$ROOT/rays.txt"
    printf '%s\n' "$ray" >> "$ROOT/rays.txt"
  fi
}
make_ray() {
  local ray=$1 dir="$ROOT/$1"
  mkdir -p "$dir/plans" "$dir/decisions" "$dir/docs/goals" "$dir/docs/changes" "$dir/handoffs"
  if [[ "$ray" == "coordinator" ]]; then
    copy_missing "$SOURCE_DIR/templates/coordinator-README.md" "$dir/README.md"
    copy_missing "$SOURCE_DIR/templates/coordinator-GOALS.md" "$dir/GOALS.md"
    copy_missing "$SOURCE_DIR/templates/coordinator-inbox.md" "$dir/inbox.md"
    copy_missing "$SOURCE_DIR/templates/resume-note.md" "$dir/plans/resume.md"
  elif [[ "$ray" == demo && "$DEMO" == 1 ]]; then
    while IFS= read -r -d '' file; do
      copy_missing "$file" "$dir/${file#"$SOURCE_DIR/examples/demo-ray/"}"
    done < <(find "$SOURCE_DIR/examples/demo-ray" -type f -print0)
  else
    render_missing "$SOURCE_DIR/templates/ray-README.md" "$dir/README.md" "$ray"
    render_missing "$SOURCE_DIR/templates/GOALS.md" "$dir/GOALS.md" "$ray"
    copy_missing "$SOURCE_DIR/templates/resume-note.md" "$dir/plans/resume.md"
  fi
  copy_missing "$SOURCE_DIR/templates/AGENTS-RULES.md" "$dir/$RULE_FILE"
  add_active_ray "$ray"
}
make_ray coordinator
for ray in "${RAYS[@]}"; do
  [[ "$ray" == coordinator ]] && continue
  make_ray "$ray"
done
if [[ ! -e "$ROOT/board.html" && ! -L "$ROOT/board.html" ]] && command -v node >/dev/null 2>&1; then
  node "$ROOT/tools/board.mjs" "$ROOT" >/dev/null
  created=$((created + 1))
fi
echo "PASS install: agent=$AGENT root=$ROOT new=$created preserved=$preserved"
echo "Next: cd \"$ROOT/demo\" (if --demo) or cd \"$ROOT/<ray>\""
echo "Run: node ../tools/check-goals.mjs GOALS.md; run every Check listed in GOALS.md"
case "$AGENT" in
  claude-code) echo "Start the ray agent with: claude" ;;
  codex) echo "Start the ray agent with: codex" ;;
  claude-desktop) echo "Create a Claude Desktop Project for each ray; paste PROJECT-INSTRUCTIONS.md into Project instructions." ;;
esac
echo "Board: $ROOT/board.html (regenerate with node \"$ROOT/tools/board.mjs\" \"$ROOT\")"
