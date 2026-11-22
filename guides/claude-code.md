# Claude Code

1. Install Claude Code from the [official setup guide](https://code.claude.com/docs/en/quickstart) and Node.js 20+.
2. Run `bash install.sh --agent claude-code --root ./my-rays --ray website --demo`, or the equivalent `install.ps1`.
3. In a terminal, change directory to `my-rays/demo` and run `claude`. The installer puts `CLAUDE.md` **inside each ray**, where Claude Code reads project instructions on launch. Do not place the ray rule only at the root of an unrelated checkout.
4. First prompt: "Read GOALS.md and plans/resume.md, run every Check, fix failures, then work every Next. Update proof and open a change note."
5. After a break, run `claude -c` **from the same ray** to continue its most recent chat, or run `claude` for a fresh session that reconstructs state from files. To choose a saved session use `claude -r SESSION_ID`. Refresh `plans/resume.md` before a deliberate restart.

Claude Code reads project `CLAUDE.md` at `./CLAUDE.md` or `./.claude/CLAUDE.md`; parent-directory instructions may apply too. Check loaded files with `/context all`. Source: [project memory](https://code.claude.com/docs/en/memory) and [CLI reference](https://code.claude.com/docs/en/cli-reference).

## Start hooks (optional)

`SessionStart` runs for a new or resumed Claude Code session. If you want an automatic **format** check, create `<ray>/.claude/settings.json` yourself with:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          { "type": "command", "command": "node ../tools/check-goals.mjs GOALS.md" }
        ]
      }
    ]
  }
}
```

Run from the ray folder and confirm the hook is trusted and executes in your installation. This hook only lists and validates goals; it does **not** run application checks. `CLAUDE.md` directs the agent to run all Check commands, including after resuming. Do not enable a hook that blindly executes arbitrary commands copied from GOALS.md. Source: [Claude Code hooks](https://code.claude.com/docs/en/hooks).

## Show the result

The ray writes `docs/changes/<topic>.md`, then calls `node ../tools/open-note.mjs docs/changes/<topic>.md` (opens the default Markdown app). It refreshes the snapshot board with `node ../tools/board.mjs ..` and can open `../board.html`. A separate viewer or live board is optional. Without desktop app-launch permission, open the file yourself. See [board and viewer](board-and-viewer.md).

A running terminal or external supervisor is required for long-lived execution; this package does not start a background Claude daemon.
