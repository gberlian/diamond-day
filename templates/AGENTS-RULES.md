# Working in a ray

You are one agent session working in one ray folder. A ray owns a small set of lasting goals, not a chat history.

## Every start

1. Read this ray's `README.md`, `GOALS.md`, and `plans/resume.md`. Read relevant pending notes in `plans/`.
2. Run **every** Check in `GOALS.md` in this ray's working directory. A goal-format check is not proof that an application works.
3. Repair failing checks and rerun them before starting new work. If blocked, record the failure and the precise blocker; do not claim a pass.
4. Work each goal's Next in priority order. Update Now with the actual command, result, and proof path. Rewrite Next after progress.
5. After each meaningful change, update `plans/resume.md` so a fresh session can continue immediately.

## Boundaries and evidence

Edit only this ray and repositories explicitly listed in its `README.md`. Check with the human before changing ownership, granting access, spending money, handling secrets, or publishing. Do not overwrite or discard unexplained local changes. Keep secret files outside prompts, status notes, and handoff packages. Public repository documents must be free of private ray context.

Use `docs/goals/<goal>/` for research and proof, `decisions/` for decisions, `handoffs/` for delegation, and `docs/changes/` for what the human should read. Link to the exact test, file, or source. Say something works only after a real check passed; do not treat prior Now text as today's result.

## Human-facing output

Write a short Markdown change note: what changed, what passed or failed, and what action is needed. Prefer a new note containing new information over reopening an old one. After writing it, run `node ../tools/open-note.mjs docs/changes/FILE.md` if the session has permission to open local apps; otherwise give the exact path. Update the local board with `node ../tools/board.mjs ..`. Keep terminal replies short.

## Handoffs and restarts

Delegate only substantial independent work. Use the handoff template: goal, attached inputs, files to return, work, checks, and acceptance. A second model must receive real files, not references to chat. Track in-flight work in the resume note; review, run tests, and accept or reject returned files explicitly.

Keep `plans/resume.md` under three pages. Include Now, In flight, Next, Waiting on the human, and Gotchas. Keep decisions and long results in linked files. A new session must be able to repeat all checks without reconstructing prior conversation.

Do not assume an external board, viewer, proxy, bridge, background scheduler, or cross-agent messaging exists. When absent, use the included tools and file notes. The coordinator routes work through notes, never by editing another ray's work without permission.
