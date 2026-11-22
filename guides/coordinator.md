# Coordinator ray

The installer always creates `coordinator/` and lists it in `rays.txt`. It has its own `GOALS.md`, resume note, and agent instruction file.

Send a new idea, link, or request to the coordinator. It writes an item in `coordinator/inbox.md`, chooses an owner ray from `rays.txt`, and creates a short note in `<ray>/plans/` with the task, source, and acceptance check. That ray reads the note on its next start; do not assume it received an instant message.

The coordinator's first Check is `node ../tools/check-rays ..`: every active ray must exist and have a valid `GOALS.md`. This proves *format*, not application health. For health, read the latest proof under each goal's Now and rerun its actual Check when permitted. Do not present unverified past results as fresh passes.

After routing or reviewing work, update the coordinator's resume note, run `node ../tools/board ..`, and open `../board.html`. The generated board lists the written goals and their Now/Next values; it does not start agents or poll checks. A live board and restarter can be attached later; see [optional integrations](board-and-viewer.md).

Keep each ray's authorized repositories in its README. Requests involving another ray's repository go to that ray as a note. If no ray fits, propose adding a new one with `install.sh --ray NAME` or `install.ps1 -Ray NAME`, which preserves existing files.
