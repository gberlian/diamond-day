#!/usr/bin/env bash
set -euo pipefail
REPO=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO"
failed=0
# The literal-deny-list must exclude itself; the structural scan includes it.
# Never put real private identifiers in the deny-list or its comments.
scan() {
  local label=$1 pattern=$2
  local results
  results=$(LC_ALL=C grep -ERin --binary-files=without-match --exclude-dir=.git \
    --include='*' -e "$pattern" . || true)
  if [[ -n "$results" ]]; then
    echo "FAIL private: $label" >&2
    echo "$results" >&2
    failed=1
  fi
}
scan 'Windows user folders' '([A-Za-z]:[\\/](Users|Documents and Settings)[\\/][^[:space:]"<>]+)'
scan 'email addresses' '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
scan 'IPv4 addresses' '(^|[^0-9])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9]|$)'
scan 'wallet-shaped base58 strings' '(^|[^[:alnum:]])[1-9A-HJ-NP-Za-km-z]{32,44}([^[:alnum:]]|$)'
scan 'long hexadecimal identifiers' '(^|[^[:xdigit:]])(0x)?[[:xdigit:]]{40,64}([^[:xdigit:]]|$)'
if LC_ALL=C grep -RinFi --binary-files=without-match --exclude-dir=.git \
  --exclude='deny-list.txt' -f test/deny-list.txt . ; then
  echo 'FAIL private: a deny-list term appeared' >&2
  failed=1
fi
# Absolute paths and unsafe filenames should not be included either.
if find . -type f -not -path './.git/*' | LC_ALL=C grep -Ei \
  '([A-Za-z]:[\\/](Users|Documents and Settings)[\\/])|(@[A-Za-z0-9.-]+[.][A-Za-z]{2,})' ; then
  echo 'FAIL private: sensitive-looking filename' >&2
  failed=1
fi
if ((failed)); then exit 1; fi
echo 'PASS no-private.sh: no user paths, addresses, wallet-like strings, or deny-list terms'
