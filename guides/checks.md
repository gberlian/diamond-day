# Goal checks

Every goal has a prose `- **Check:**` acceptance criterion. Its executable declaration is a **separate indented line directly under that field**:

```markdown
## 1. Site builds
- **Want:** The site can be deployed.
- **Check:** The static build finishes with valid pages.
  check: run node checks/build.mjs timeout=30s
- **Now:** Waiting for test results.
- **Next:** Repair failing output.
```

Only this line can execute. Backticks, `Command:`, inline text, malformed declarations, declarations in `Now` or `Next`, and multiple declarations are inert. No checks run until explicitly declared. An undeclared goal has a `NEVER` light.

## Portable grammar

```text
check: run <executable> [argument ...] [timeout=<N>s]
check: http GET <http-or-https-URL> <expected-status> [timeout=<N>s]
check: file <ray-relative-path> younger <N><m|h|d> [timeout=<N>s]
check: file-age <ray-relative-path> younger <N><m|h|d> [timeout=<N>s]
check: manual
```

Commands are spawned as executable + argv, **never through a shell**. Tokens may be unquoted or single/double-quoted; backslashes are literal except a backslash escaping a matching quote inside quotation marks. No variable substitution, globbing, pipelines, command chaining or shell syntax runs. Commands run with the ray folder as the working directory, and the exit code determines PASS (0) or FAIL (nonzero). Output from stdout and stderr is recorded in arrival order, retaining only the final 2 KiB. Timeout defaults to 60 seconds and accepts integer values of 1–300 seconds; a timeout terminates the process tree (POSIX process group or Windows `taskkill /T /F`). For PowerShell, explicitly declare an available interpreter, e.g. `check: run pwsh -File checks/verify.ps1`.

HTTP checks require the **exact** response status 100–599. Redirects are not followed. Connection errors and timeouts fail. The limited response body is stored as evidence. File checks require a regular existing file strictly inside the ray after resolving symlinks, newer than a positive number of minutes (`m`), hours (`h`) or days (`d`). Escaping paths, missing, old and future-dated files fail. A fresh file or HTTP 200 proves only that narrow assertion, not a compound acceptance criterion.

Use `manual` for a judgement that an automated test cannot honestly verify. Its initial light is `MANUAL` until a person or agent explicitly reports evidence.

## Running and viewing

From the **installed rays root**:

```sh
node tools/checks.mjs run
node tools/checks.mjs run demo 2
node tools/checks.mjs status
node tools/checks.mjs report demo 3 pass "Reviewed the rendered pages"
node tools/board.mjs serve .
```

The `run` CLI executes all declared automated goals in the root, or a selected ray or goal. Manual and undeclared goals are never executed. Check failures are reported as FAIL lights rather than treated as a broken runner. The board listens only on loopback (default port 5195) and has a Run button on each automated goal. Requests to `/api/checks/run?ray=demo&goal=2` must be local POSTs; cross-origin browser POSTs are refused. `/api/board` returns the current states. The board scans automated declarations and schedules checks at most once every ten minutes; it runs at most two at a time. Button POSTs have the same cooldown and respond `429` with `Retry-After` while cooling down. CLI `--force` is an explicit operator override to **recheck immediately after a repair**:

```sh
node tools/checks.mjs run demo 2 --force
```

PASS/FAIL results become STALE after 24 hours; timestamps and output remain visible. A valid manual check without a report shows MANUAL. An automated check without a result (or a missing/malformed declaration) shows NEVER. Manual reports require a nonempty note and cannot turn an undeclared goal green.

History lives in the installed root under `.arpe/checks-history.json`, with atomic lock-protected changes, most recent 50 records per goal, and persisted check start times. Keep `.arpe/` private and out of git. The board snapshot `node tools/board.mjs .` still writes an offline `board.html` for compatibility; use `serve` to run checks.

**Trust boundary:** Declared run commands and HTTP targets are trusted local execution, not a sandbox. Do not enable unreviewed GOALS.md content, do not place secrets in checks or reports, and do not expose the board to a network. Review the declaration like code.
