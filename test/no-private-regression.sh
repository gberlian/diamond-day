#!/usr/bin/env bash
set -euo pipefail

REPO=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/repo/test" "$TMP/bin"
cp "$REPO/test/no-private.sh" "$REPO/test/deny-list.txt" "$TMP/repo/test/"

bash "$TMP/repo/test/no-private.sh"

# Plant a real deny-list entry, but never copy its literal text into test code.
term=
while IFS= read -r line || [[ -n "$line" ]]; do
  line=${line%$'\r'}
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  term=$line
  break
done < "$REPO/test/deny-list.txt"
[[ -n "$term" ]] || { echo 'FAIL regression: deny-list is empty' >&2; exit 1; }
mkdir -p "$TMP/repo/ray with spaces"
printf '%s\r\n' "$term" > "$TMP/repo/ray with spaces/planted.txt"
if bash "$TMP/repo/test/no-private.sh" >"$TMP/scan-output" 2>&1; then
  echo 'FAIL regression: planted deny-list entry passed' >&2
  exit 1
fi
grep -Fq 'FAIL private: deny-list term' "$TMP/scan-output"
rm "$TMP/repo/ray with spaces/planted.txt"
echo 'PASS regression: planted deny-list entry fails'

# A grep execution error must fail loudly, not be confused with "no matches".
cat > "$TMP/bin/grep" <<'WRAPPER'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == '--exclude=deny-list.txt' ]]; then
    echo 'simulated grep failure' >&2
    exit 2
  fi
done
exec "$REAL_GREP" "$@"
WRAPPER
chmod +x "$TMP/bin/grep"
if PATH="$TMP/bin:$PATH" REAL_GREP="$(command -v grep)" \
  bash "$TMP/repo/test/no-private.sh" >"$TMP/grep-output" 2>&1; then
  echo 'FAIL regression: grep error passed' >&2
  exit 1
fi
grep -q 'FAIL private: grep error' "$TMP/grep-output"
echo 'PASS regression: grep errors fail loudly'
echo 'PASS no-private-regression.sh'
