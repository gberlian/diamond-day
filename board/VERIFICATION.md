# Verification handoff

Executed in the Linux sandbox, with Node.js 22.16.0 available and no Bun or PowerShell executable. The test uses a new temporary HOME containing a space and an unused loopback port; it never uses a real project directory. The normal Bun-first acceptance is **blocked**, not passed. The explicit Node fallback runs the same board, installer, CLI and RPM checker source with Node type stripping. No Bun runtime is mocked.

## Normal clean install (exit 6)

Command: `bash test/clean-install.sh`

```text
Installing Bun into the managed installation directory...
curl: (6) Could not resolve host: github.com
```

The sandbox cannot resolve the official release host. An earlier attempt through the Bun installer endpoint also failed with curl exit 6. The final installer downloads the official archive directly to avoid unintended upstream shell profile edits. The default Bun path must still be run on a network-enabled Linux host. Windows PowerShell and AutoHotkey placement were not run. The 15-minute limit is proven only for the explicit Node fallback below.

## Explicit fallback clean install (exit 0)

Command: `RAY_RUNTIME=node bash test/clean-install.sh`

```text
Created demo: /tmp/tmp.kcOmMag2hZ/home with spaces/rays/demo
PASS install: http://localhost:45579/board (runtime: Node fallback)
PATH: /tmp/tmp.kcOmMag2hZ/home with spaces/.diamond-day/bin
/tmp/tmp.kcOmMag2hZ/home with spaces/.diamond-day/bin/ray
demo
Created demo2: /tmp/tmp.kcOmMag2hZ/home with spaces/rays/demo2
http://localhost:45579/board/p/demo2
Resume in a terminal: ray open demo2
RPM check: demo
PASS hard     R1-header            L2    A small demo of the RPM board
PASS hard     R1-header            L3    Because meaningful progress deserves a clear direction.
PASS hard     R1-header            L4    Builder, Tester
PASS hard     R2-goal-count              1 goals
PASS hard #1  R2-fields            L8    ok
PASS hard #1  R3-runnable-check    L16   check: file plans/resume.md younger 24h
PASS soft #1  R4-measurable        L9    11 words
PASS soft #1  R5-outcome-reason    L10   reason word present
PASS hard #1  R6-plan-shape        L11   3 chunks, 1 in progress
PASS hard #1  R7-musts             L11   1 of 3 marked *
PASS hard #1  R8-who               L11   3 open, all assigned
PASS soft #1  R9-duration          L11   open time 1.1h, must time 30m
PASS soft #1  R10-no-duplicates    L11   ok
PASS soft #1  R11-not-stalled      L11   ok
PASS hard #1  R13-plain-words      L9    ok
PASS soft #1  R13-plain-steps      L11   ok
PASS hard     R12-weekly-review    L6    2026-11-26 (0 days ago)
score 17/17 (100%), 1 results, hard failures 0: PASS
RPM check: demo2
PASS hard     R1-header            L2    A small demo
PASS hard     R1-header            L3    Because meaningful progress deserves a clear direction.
PASS hard     R1-header            L4    Builder, Tester
PASS hard     R2-goal-count              1 goals
PASS hard #1  R2-fields            L8    ok
PASS hard #1  R3-runnable-check    L16   check: file plans/resume.md younger 24h
PASS soft #1  R4-measurable        L9    11 words
PASS soft #1  R5-outcome-reason    L10   reason word present
PASS hard #1  R6-plan-shape        L11   3 chunks, 1 in progress
PASS hard #1  R7-musts             L11   1 of 3 marked *
PASS hard #1  R8-who               L11   3 open, all assigned
PASS soft #1  R9-duration          L11   open time 1.1h, must time 30m
PASS soft #1  R10-no-duplicates    L11   ok
PASS soft #1  R11-not-stalled      L11   ok
PASS hard #1  R13-plain-words      L9    ok
PASS soft #1  R13-plain-steps      L11   ok
PASS hard     R12-weekly-review    L6    2026-11-26 (0 days ago)
score 17/17 (100%), 1 results, hard failures 0: PASS
PASS board: HTTP 200; projects demo, demo2; both RPM project pages and card APIs answer; scripts parse; resume links resolve
Ray already exists: demo2
PASS uninstall (project root purged)
PASS uninstall: board no longer answers
PASS clean-install.sh: empty HOME after uninstall; 2s elapsed
```

## Requested Node checks (exit 0)

Command: `node test/checks.test.mjs`

```text
1..8
# tests 8
# suites 0
# pass 8
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3285.619921
```

## Broader regression suite (exit 0)

Command: `node --test test/`

The first run failed one pre-existing frontmatter assertion on CRLF Markdown from the supplied archive. The assertion now accepts LF or CRLF without weakening the content match. The rerun passed:

```text
1..25
# tests 25
# suites 0
# pass 25
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 15550.693164
```

## Private-path scan

The exact requested recursive literal-pattern grep returned no matches and exit 1 (grep's conventional no-match code). `bash test/no-private.sh` also passed; it scans paths, addresses, long identifiers and the existing deny-list.

## Browser verification

The Linux HTTP test verified both project pages, their JSON cards, declared Check, linked resume documents and JavaScript syntax. The independent `chromium --headless --dump-dom` attempt timed out without DOM output. The subsequent Playwright browser navigation failed with exit 1: `Page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR at http://localhost:53197/board/p/demo`. No visual screenshot or live click-through is claimed. The README contains the requested screenshot placeholder. Actual Claude/Codex account startup and Windows window placement remain untested.
