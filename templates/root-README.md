# Rays root

This folder is the private working area, not the public `diamond-day` package.

- `rays.txt`: active ray names, including `coordinator`.
- `<ray>/GOALS.md`: durable Want, Check, Research, Now, Next.
- `<ray>/plans/resume.md`: restart note.
- `tools/check-goals.mjs`: validate goal format. It never executes Check commands.
- `tools/check-rays.mjs`: check every active ray's goal format.
- `tools/board.mjs`: generate `board.html` from the written state.
- `tools/open-note.mjs`: open a result note in the OS default app.
- `templates/`: clean document starters.

Run an agent from within one ray directory. Recheck the goals on every start and update the resume note after each meaningful change. To add another ray, rerun the installer; existing files are left alone.
