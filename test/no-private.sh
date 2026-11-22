#!/usr/bin/env bash
set -euo pipefail

REPO=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO"
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
failed=0

# grep: 0 means match; 1 means no match; 2+ means the scan is broken.
# Do not turn an error into PASS with "|| true" or an unguarded if.
scan() {
  local label=$1 status results
  shift
  if results=$(LC_ALL=C grep "$@" 2>"$TMP/grep-error"); then
    status=0
  else
    status=$?
  fi
  case "$status" in
    0)
      printf 'FAIL private: %s\n%s\n' "$label" "$results" >&2
      failed=1
      ;;
    1) ;;
    *)
      printf 'FAIL private: grep error (%s, exit %s)\n' "$label" "$status" >&2
      cat "$TMP/grep-error" >&2
      exit 2
      ;;
  esac
}

scan 'Windows user folders' -ERin --binary-files=without-match --exclude-dir=.git \
  -e '([A-Za-z]:[\\/](Users|Documents and Settings)[\\/][^[:space:]"<>]+)' .
scan 'email addresses' -ERin --binary-files=without-match --exclude-dir=.git \
  -e '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' .
scan 'IPv4 addresses' -ERin --binary-files=without-match --exclude-dir=.git \
  -e '(^|[^0-9])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9]|$)' .
scan 'wallet-shaped base58 strings' -ERin --binary-files=without-match --exclude-dir=.git \
  -e '(^|[^[:alnum:]])[1-9A-HJ-NP-Za-km-z]{32,44}([^[:alnum:]]|$)' .
scan 'long hexadecimal identifiers' -ERin --binary-files=without-match --exclude-dir=.git \
  -e '(^|[^[:xdigit:]])(0x)?[[:xdigit:]]{40,64}([^[:xdigit:]]|$)' .

# -f treats comments as ordinary patterns, and blank lines match everything.
# Strip CR (for CRLF clones), comment lines, and blank lines before the literal scan.
while IFS= read -r line || [[ -n "$line" ]]; do
  line=${line%$'\r'}
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  printf '%s\n' "$line" >> "$TMP/deny-patterns"
done < test/deny-list.txt
if [[ -f "$TMP/deny-patterns" ]]; then
  scan 'deny-list term' -RinFi --binary-files=without-match --exclude-dir=.git \
    --exclude='deny-list.txt' -f "$TMP/deny-patterns" .
fi

# Scan relative filenames rather than absolute paths (the checkout may live
# inside a Windows Users folder, which must not by itself fail this test).
if ! find . -type f -not -path './.git/*' -print > "$TMP/filenames"; then
  echo 'FAIL private: find could not enumerate filenames' >&2
  exit 2
fi
scan 'sensitive-looking filename' -Ei \
  '([A-Za-z]:[\\/](Users|Documents and Settings)[\\/])|(@[A-Za-z0-9.-]+[.][A-Za-z]{2,})' \
  "$TMP/filenames"

if ((failed)); then exit 1; fi
echo 'PASS no-private.sh: no user paths, addresses, wallet-like strings, or deny-list terms'
