# Claude Code: review Diamond replies at every session boundary

The `diamond` plugin runs Diamond's normal `scan` on `SessionStart` and `Stop`.
If an undecided reply is at least `minAgeMinutes` old, it reports how many are
waiting and shows the oldest five jobs, their ages, their `+added -removed`
line counts, and clickable `DIFF.md` file links. With no eligible replies
it prints nothing. The `Stop` hook sends the block as a Claude Code
`systemMessage` without blocking or restarting the agent. `SessionStart`
delivers plain-text context to Claude. You decide what to merge or skip:
**the hooks never make decisions or mutate the live worktree.**

## Install and configure

Requirements: Claude Code with plugin hooks, Node.js 20+, and Git on `PATH`.
No npm dependencies or network access are needed for scanning.

From the arpe checkout, load the local plugin for one session with
**one command**:

```sh
claude --plugin-dir ./plugins/diamond
```

For persistent, marketplace-based installation, this repository also has
`.claude-plugin/marketplace.json` with source `./plugins/diamond`. From the
arpe checkout, run:

```sh
claude plugin marketplace add .
claude plugin install diamond@arpe-local
```

A single shell line can combine those commands with `&&`. Claude Code will
load the plugin in subsequent sessions when enabled. To validate the actual
Claude Code installation when available, use:

```sh
claude plugin validate ./plugins/diamond
claude plugin validate .
claude plugin list
```

The plugin's `scripts/` directory contains its own copies of
`diamond-hook.mjs` and `diamond.mjs`, so a marketplace install or copy of
only `plugins/diamond/` still works. The canonical files also live at
`tools/diamond-hook.mjs` and `tools/diamond.mjs` for CLI use. The
`diamond-plugin` test checks the bundled copies match the canonical code.

In the **Claude Code target project's root** (not in the installed plugin
cache), create `.diamond.json`:

```json
{
  "inbox": "./inbox",
  "repos": ["."],
  "maxAgeHours": 6,
  "minAgeMinutes": 30
}
```

Paths in `inbox` and `repos` are relative to the directory containing
`.diamond.json`. Absolute paths work as well. `repos` is a nonempty string
or array of paths (to a Git repository, directory of repositories, or a text
file of paths) accepted by `diamond scan`. `maxAgeHours` must be a positive
number; it configures Diamond's stale-reply status, which may make the
underlying scan exit 2. `minAgeMinutes` is a nonnegative number; it selects
how old a **pending** reply must be to appear in automatic hook output.
Its default is **0** (show all pending replies). `maxAgeHours` defaults
to **6**. A stale exit 2 is expected and is **not** an error.

The demo configuration is `examples/demo-ray/.diamond.json`. In a **Git
checkout** (Diamond needs a committed HEAD), inspect the two packaged
demo replies from the repository root:

```sh
node tools/diamond-hook.mjs --config examples/demo-ray/.diamond.json
```

The command should print `fix-navigation` and `clarify-about`, with their
DIFF links, assuming neither has already been decided. The demo sets
`minAgeMinutes` to 0. The scan writes generated pages and local state to
`examples/demo-ray/inbox/` and creates `reply/<job>` refs in the matched
Git repository, but does not check out or merge them.

## Review and decide

All commands are namespaced by the plugin name. In a Claude Code session
started from the project that contains `.diamond.json`, use:

- `/diamond:diamond-review` — scan and list **all** undecided replies, including those under `minAgeMinutes`, oldest first.
- `/diamond:diamond-merge JOB "reason"` — inspect that reply's DIFF and merge it with a required reason.
- `/diamond:diamond-skip JOB "reason"` — inspect it and record a required skip reason.

These Markdown commands instruct Claude to run the bundled Node CLI. They
use the normal Claude Code Bash permission flow, and do not bypass it. The
runner forwards positional arguments to `diamond decide` without a shell.
Unlike `diamond`'s generic CLI, this wrapper requires a reason for **both**
merge and skip. A merge will fail if the worktree or index is dirty, the
branch changed, or the reviewed base is no longer the target HEAD.
Skip reasons and merge reasons are recorded in
`<inbox>/.diamond/decisions.json`. Review generated
`<inbox>/<job>.DIFF.md` before making either decision.

For manual troubleshooting, you can run the same CLI outside Claude Code:

```sh
node tools/diamond-hook.mjs --config examples/demo-ray/.diamond.json review
node tools/diamond-hook.mjs --config examples/demo-ray/.diamond.json decide fix-navigation skip "Superseded"
```

The `review` command reports "no replies waiting" if empty, whereas an
automatic lifecycle hook is completely silent. If `.diamond.json` is absent,
lifecycle hooks are also silent; malformed configuration prints exactly
`diamond: invalid .diamond.json`. On scanner failure or timeout, the hook
prints only one diagnostic line and exits 0 so it never blocks an agent
turn. It does not mask failures in manual `review` or `decide` commands.

Each hook handler has a **9-second** Claude Code timeout, and the Node
runner kills its synchronous scan subprocess after **7.5 seconds**. This
bounds hook delay even if a `git` command inside `diamond scan` stalls.
The `Stop` hook emits JSON containing `systemMessage` so Claude Code
displays pending replies without continuing the conversation or trapping
Claude in a stop-hook loop. A session restart/compaction triggers another
`SessionStart`; the `Stop` event runs after the main agent finishes each
response (not after an interrupt or API error).

## Tests and limitations

From the starter-kit root:

```sh
node --test test/
bash test/no-private.sh
```

`test/diamond-plugin.test.mjs` validates the manifest, marketplace, hook
fields and command files, exercises real temporary Git repos and inboxes,
checks empty output and age filtering, the oldest-five summary and links,
the Stop JSON, skip and merge decisions, config/scanner error behavior and
the hard timeout. It does **not** replace `claude plugin validate` or prove
that a Claude Code session actually loaded the plugin; live integration
requires a locally installed `claude` CLI.

Official Claude Code documentation consulted (November 2026):

- [Plugin manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference) — `.claude-plugin/plugin.json`, standard component locations, name and metadata.
- [Hooks reference](https://code.claude.com/docs/en/hooks) — `hooks/hooks.json`, command `args`, timeouts in seconds, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PROJECT_DIR}`, `SessionStart` plain text, and `Stop` `systemMessage`.
- [Plugin components](https://code.claude.com/docs/en/plugins/components) — flat `commands/*.md` files and command namespaces.
- [Create a Claude Code plugin](https://code.claude.com/docs/en/plugins/create) — `claude --plugin-dir`.
- [Create a marketplace](https://code.claude.com/docs/en/plugins/create-marketplace) — local `marketplace.json` and two-step persistent install.

For Diamond's underlying branch/DIFF format, stale exit codes, safety
checks, and decision semantics, see [diamond.md](diamond.md).
