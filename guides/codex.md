# Codex CLI

1. Install Codex CLI and Node.js 20+. See the [official Codex CLI guide](https://learn.chatgpt.com/docs/codex/cli).
2. Run `bash install.sh --agent codex --root ./my-rays --ray website --demo`, or `.\install.ps1 -Agent codex -Root .\my-rays -Ray website -Demo`.
3. Change directory to `my-rays/demo` and run `codex`. Each ray has its own `AGENTS.md` at its root. Codex reads that instruction file at startup, along with any applicable parent guidance.
4. First prompt: "Read GOALS.md and plans/resume.md. Run all goal Checks, repair failures, then work each Next and record proof."
5. In the same ray directory, use `codex resume --last` for its latest saved chat, `codex resume` for the picker, or `codex resume SESSION_ID` for a specific chat. A fresh `codex` session can restart solely from ray files.

Sources: [AGENTS.md lookup and precedence](https://learn.chatgpt.com/docs/agent-configuration/agents-md) and [CLI resume commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli). Codex walks from its detected project root to the current working directory and normally reads one instruction file per directory. Keep your working directory set to the ray; a higher-level override may still apply.

## Start hooks (optional)

Current Codex supports `SessionStart` hooks. For a trusted project, you can create `<ray>/.codex/hooks.json` with this small format check:

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

Review and trust it using `/hooks` in Codex. This checks only the GOALS.md structure. It does **not** execute the actual goal Checks; the agent must run those commands. Codex can ignore project hooks if the project is not trusted or policy disables them. Source: [Codex hooks](https://learn.chatgpt.com/docs/hooks).

## Deliver notes

Write a new `docs/changes/` Markdown note with results and evidence. Run `node ../tools/open-note.mjs docs/changes/<topic>.md` to open it in the OS default application. Refresh the file-based board with `node ../tools/board.mjs ..`, then open `../board.html`. These steps also work with no optional viewer or live board. The CLI doesn't itself keep rays running after the session exits; restart it or use an independent scheduler with explicit permission.
