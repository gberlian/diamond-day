# Rays root

This is your working area, not the public `arpe` repository.

`rays.txt` lists active rays. Each ray's `GOALS.md` declares an explicit `check:` under its Check field.
Results and the most recent 50 history records live in `.arpe/checks-history.json` in this root.
That directory is local and private; do not commit it.

From this root:

```sh
node tools/checks.mjs run
node tools/checks.mjs status
node tools/board.mjs serve .
```

Open the local URL printed by the board. Run buttons execute only declared automated checks.
Manual judgements require `node tools/checks.mjs report <ray> <goal> pass|fail "note"`.
The old `node tools/board.mjs .` command still writes an offline `board.html` snapshot.
Start each agent inside its ray; update `plans/resume.md` after meaningful work.
