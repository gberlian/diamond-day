# Local board and human-readable notes

The core package works with no other repository. Each ray writes short Markdown documents under `docs/changes/`. Its instructions say to open new notes with `node ../tools/open-note docs/changes/FILE.md`; this launches the OS default Markdown application on macOS, Linux (with `xdg-open`), or Windows. When a graphical opener is unavailable, the script prints the file path and exits nonzero so the agent can give the human the path.

`node tools/board .` from the installed rays root generates `board.html`. It reads `rays.txt` and each ray's `GOALS.md` and shows Want, Check, Now, and Next. This is a **snapshot of written state**, not a live pass/fail dashboard, queue monitor, or background restarter. Refresh it after each meaningful update. Do not mistake an old Now value for a current check.

## Plug in an external viewer

If you already use a Markdown viewer, change the last step of the ray's local instructions to open the same note with your viewer's documented command. Pass an absolute path when working directories differ. Keep the note valid plain Markdown and use ordinary relative source links so it remains readable without a special renderer. Verify the viewer exits successfully and actually opens the right document before relying on it.

## Plug in an external live board

Configure your board to discover active names from `rays.txt`, read each ray's `GOALS.md`, resume note, and change notes, and display *measured* Check results only when they were actually run. Use an adapter/exporter if its expected schema differs. Any controls that start, stop, or restart agents need separate authorization and a safe per-ray working directory; this repository neither registers those controls nor guesses an external API.

If you use a restarter, make it wait for a fresh `plans/resume.md` before closing a busy session. Avoid concurrent writers in the same ray. With no external board, `board.html` remains a useful manual overview.
