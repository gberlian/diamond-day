#!/usr/bin/env bash
set -euo pipefail
REPO=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

command -v node >/dev/null 2>&1 || { echo "FAIL: Node.js 20+ is required" >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' ||
  { echo "FAIL: Node.js 20+ is required" >&2; exit 1; }
node "$REPO/tools/check-goals.mjs" "$REPO/examples/demo-ray/GOALS.md"
echo "PASS fixture: goal file is valid"
node "$REPO/test/tools-portability.mjs"

for agent in claude-code codex claude-desktop; do
  root="$TMP/$agent root"
  bash "$REPO/install.sh" --root "$root" --agent "$agent" --ray website --ray notes --demo >/dev/null
  test -f "$root/coordinator/GOALS.md"
  test -f "$root/website/GOALS.md"
  test -f "$root/notes/GOALS.md"
  test -f "$root/demo/GOALS.md"
  case "$agent" in
    claude-code) expected=CLAUDE.md ;;
    codex) expected=AGENTS.md ;;
    claude-desktop) expected=PROJECT-INSTRUCTIONS.md ;;
  esac
  for ray in coordinator website notes demo; do
    test -f "$root/$ray/$expected"
    node "$root/tools/check-goals.mjs" "$root/$ray/GOALS.md" >/dev/null
  done
  node "$root/tools/check-rays.mjs" "$root" >/dev/null
  test -f "$root/board.html"
  echo "PASS install: $agent rules, rays, goals, and board"
done

root="$TMP/claude-code root"
printf '%s\n' 'DO NOT OVERWRITE' > "$root/website/GOALS.md"
bash "$REPO/install.sh" --root "$root" --agent claude-code --ray website --ray extra --demo >/dev/null
test "$(cat "$root/website/GOALS.md")" = 'DO NOT OVERWRITE'
grep -Fxq 'extra' "$root/rays.txt"
test "$(grep -Fxc 'demo' "$root/rays.txt")" -eq 1
echo "PASS safety: existing content preserved and new ray appended"

demo="$root/demo"
(
  cd "$demo"
  node checks/build.mjs
  if node checks/links.mjs >/dev/null 2>&1; then
    echo "FAIL: deliberately broken demo link went undetected" >&2; exit 1
  fi
  echo "PASS demo: initial link check FAILS as designed"
  sed -i.bak 's/href="missing.html"/href="about.html#purpose"/' site/index.html
  rm -f site/index.html.bak
  node checks/build.mjs
  node checks/links.mjs
)
node "$root/tools/board.mjs" "$root" >/dev/null
grep -Fq 'demo' "$root/board.html"
echo "PASS demo: offline build, links, and board"

# A broken local link must be detected.
printf '%s\n' '<!doctype html><html><a href="absent.html">Missing</a></html>' > "$demo/dist/index.html"
if (cd "$demo" && node checks/links.mjs >/dev/null 2>&1); then
  echo "FAIL: broken link went undetected" >&2
  exit 1
fi
echo "PASS negative: broken local link fails"

# A goal missing Check must return a nonzero exit code.
cat > "$TMP/missing-check.md" <<'BAD'
# missing

## 1. Untestable outcome
- **Want:** A site exists.
- **Now:** Not measured.
- **Next:** Build it.
BAD
if node "$REPO/tools/check-goals.mjs" "$TMP/missing-check.md" >/dev/null 2>&1; then
  echo "FAIL: missing Check accepted" >&2
  exit 1
fi
echo "PASS negative: missing Check fails"
echo "PASS clean-install.sh"
