# Local board and readable notes

Run `node tools/board.mjs serve .` in an installed rays root to start the live local board. It shows PASS/FAIL/STALE/MANUAL/NEVER for each declared goal, last-run time and output, and accessible Run buttons for automated checks. The server binds only to loopback, rejects cross-origin POSTs and enforces a ten-minute per-goal cooldown. `/api/board` returns JSON. Every outcome comes from execution or an explicit manual report, never from inferred Now prose. See [goal checks](checks.md) for the full grammar, storage and trust boundary.

For compatibility, `node tools/board.mjs .` writes a static `board.html` snapshot. It does not run commands and its buttons are disabled.

A ray can open a change note with `node ../tools/open-note.mjs docs/changes/FILE.md`; the OS opener uses your local default application. An external viewer or agent supervisor is optional and should be configured separately, with explicit authorization for any execution privileges.
