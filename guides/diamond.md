# Diamond: turn agent replies into reviewable branches

Generating code is cheap. Deciding whether to apply it is the bottleneck. `diamond`
makes the decision visible: every **undecided** agent file reply gets a branch
`reply/<job>` on the target repository's **current HEAD**, a `<job>.DIFF.md`
review page, and one Markdown index. Review the actual changes, then merge, amend
the proposal on its branch, or skip with a recorded reason.

Diamond needs Node.js 20+ and Git on `PATH`. There are **no npm packages**,
no Bun requirement, no agent account, and no ZIP/unzip CLI requirement. Its
Node ZIP reader accepts stored and deflate-compressed files. It rejects unsafe
paths, symlinks, unsupported ZIP methods, and oversized archives.

## Commands and files

Run from the public repository root, or use absolute paths:

```sh
node tools/diamond.mjs scan --inbox examples/demo-ray/inbox --repos examples
node tools/diamond.mjs scan --inbox inbox --repos "./repo-a,./repo-b" --out reviews.md --dry-run
node tools/diamond.mjs scan --inbox inbox --repos repos.txt --max-age-hours 6 --watch 300
node tools/diamond.mjs show fix-navigation --inbox examples/demo-ray/inbox
node tools/diamond.mjs decide fix-navigation skip "Superseded by another change" --inbox examples/demo-ray/inbox
node tools/diamond.mjs decide clarify-about merge "Reviewed the diff" --inbox examples/demo-ray/inbox
```

`--repos` accepts a Git repo, a directory containing Git repos, a directory
**inside** a Git worktree (such as `examples`), a comma-separated list, repeated
`--repos` flags, or a text file listing paths one per line. Quoting a list is
recommended when paths contain spaces. Nested file paths are matched by overlap
with the tracked paths at `HEAD`: for example, `site/index.html` in a reply
maps to `examples/demo-ray/site/index.html` in this repository. If no existing
filename matches, directory overlap may identify a repo; a reply with no
meaningful overlap is flagged as unmapped and is **not** applied.

Replies in `--inbox` are one `<job>.zip` archive or one `<job>/` directory
each. They may contain files directly, or under a `files/` wrapper. ZIPs are
parsed with `node:zlib`, in memory, not passed to a shell. Top-level and nested
`APPLY.md`, `NOTES`, `SUMMARY`, `VERIFICATION`, related change/test notes, and
`*.patch` files are excluded from the overlay. Existing text files retain
the CRLF/LF style at `HEAD`; new text files use LF. Binary files are preserved
byte for byte.

A normal scan writes `<inbox>/<job>.DIFF.md`,
`<inbox>/.diamond/index.md`, and `<inbox>/.diamond/state.json`.
Decisions live separately in `<inbox>/.diamond/decisions.json`; **skip reasons
are stored as data**, never executed. `--out` moves only the index page.
`.diamond/` and generated `*.DIFF.md` are ignored by this starter kit.
Keep private inboxes outside public repositories unless you intend to commit
their contents; the provided demo replies are fake and safe to publish.

`show` and `decide` default to `./inbox`; set `DIAMOND_INBOX` or pass
`--inbox` to address another folder. Run `scan` before either command.
`decide merge` runs `git merge --no-ff --no-edit reply/<job>` only after
confirming the worktree **and index** are clean and that `HEAD` still matches
the reviewed base. If the base changed, scan again. Merge can conflict if
two proposals edit the same lines; resolve Git conflicts using normal Git
procedures. `decide skip` requires a nonempty human-readable reason.

The branch is created with `read-tree HEAD`, `hash-object -w`,
`update-index --cacheinfo`, `write-tree`, `commit-tree`, and `update-ref`
using a disposable `GIT_INDEX_FILE`: no checkout, no mutation of the live
index or worktree. `--dry-run` goes further: it uses a temporary Git object
directory, so no refs, repository objects, review files, or state are written.
A regenerated branch is based on the newest HEAD. If someone commits on a
diamond branch, its tip is **never overwritten**, even when HEAD moves; the
index marks it `kept`, so the reviewer can handle it manually.

The Markdown review includes changed-file counts and +/- stats, a file
table, merge command, and per-file unified patches (at most 4,000 total
patch lines). Binary changes are labeled, not dumped. One index row per
reply shows job, repo, +/- lines, changed files, age, and decision/state.
A scan returns **0** for OK, **1** for errors/unmapped replies, or **2**
if any undecided reply is older than `--max-age-hours` (default **6**).
Errors take precedence over stale replies. Already-decided replies remain
visible in the index, but are not rebuilt. Use `--watch 300` to rescan
every five minutes until interrupted.

## Five-minute offline walkthrough

Start in a **committed Git checkout** of arpe (not a ZIP extraction
with no `.git` directory). The shipped `examples/demo-ray/inbox` contains a
real folder reply, `fix-navigation/`, and a fake ZIP reply,
`clarify-about.zip`. Both target the existing `examples/demo-ray/site`
files, without downloading anything or invoking an AI. In a clean checkout:

```sh
git status --porcelain
node tools/diamond.mjs scan --inbox examples/demo-ray/inbox --repos examples
git branch --list 'reply/*'
node tools/diamond.mjs show fix-navigation --inbox examples/demo-ray/inbox
node tools/diamond.mjs show clarify-about --inbox examples/demo-ray/inbox
git status --porcelain
```

There should be **two** `reply/` branches, `fix-navigation.DIFF.md`
and `clarify-about.DIFF.md` in the inbox, and the same Git status before
and after. The folder reply fixes the demo's intentionally broken link;
the ZIP reply clarifies the About page and stylesheet. Read the two
review pages, or open `.diamond/index.md`. A dry-run instead previews
both and prints the matched repository, changed files, and +/- totals
without writing branches or Markdown pages:

```sh
node tools/diamond.mjs scan --inbox examples/demo-ray/inbox --repos examples --dry-run
```

The walkthrough does not change the baseline demo files or run the
merge command. In a working checkout, use `decide ... merge` to apply
an approved reply, or `decide ... skip "reason"` to reject it. To
replay the walkthrough after decisions, use a fresh disposable clone
rather than clearing your audit trail.

## Scheduler and GOALS.md check

A scan is short-lived; a scheduler can run it periodically and surface exit
code 2 as "reply waiting too long." Examples below assume the checkout's
working directory is the project root. Adjust paths for your deployment.

**cron (Linux/macOS)** — add this entry to `crontab -e`:

```cron
*/5 * * * * cd /opt/arpe && node tools/diamond.mjs scan --inbox inbox --repos repos >> /tmp/diamond-scan.log 2>&1
```

**systemd user timer (Linux)** — create
`~/.config/systemd/user/diamond-scan.service`:

```ini
[Unit]
Description=Diamond reply scan
[Service]
Type=oneshot
WorkingDirectory=/opt/arpe
ExecStart=/usr/bin/node tools/diamond.mjs scan --inbox inbox --repos repos
```

Create `~/.config/systemd/user/diamond-scan.timer`:

```ini
[Unit]
Description=Scan diamond inbox every five minutes
[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
```

Then enable it with
`systemctl --user daemon-reload` and
`systemctl --user enable --now diamond-scan.timer`.
A nonzero service exit is recorded by systemd; review `journalctl --user
-u diamond-scan.service`.

**Windows Task Scheduler** — create a basic task named `Diamond scan`
with a five-minute repeat trigger. Use `node.exe` as the **Program/script**,
`tools/diamond.mjs scan --inbox inbox --repos repos` for **Add arguments**,
and the checkout folder for **Start in**. Run under your own account, not
as a network-facing service. A Task Scheduler history entry records
nonzero completion codes; check the task history and `.diamond/index.md`.

Within `examples/demo-ray/GOALS.md`, or in a real ray whose current
directory is the ray folder, use this indented executable check directly
under a goal's `- **Check:**` field (adapt the paths to your layout):

```text
  check: run node ../../tools/diamond.mjs scan --inbox inbox --repos ../.. --dry-run --max-age-hours 6 timeout=60s
```

The goal runner executes that command from the ray folder. A fresh reply
passes; a stale undecided reply returns 2 and fails that check. The check
does not silently merge or skip anything. Keep the reason for a skip and
the evidence for a merge next to the goal's `Now` and `Next` updates.

## Verification

From the repository root:

```sh
node --test test/
bash test/no-private.sh
node tools/diamond.mjs scan --inbox examples/demo-ray/inbox --repos examples --dry-run
```

The Node tests exercise disposable Git repositories, ZIP methods, CRLF,
branch rebuilds, human-commit protection, untouched worktrees/indexes,
decisions and stale exit codes. Linux and macOS checks can run locally.
On Windows, run the Node command and `test/no-private.ps1` in PowerShell;
a Linux run is not evidence that Windows-specific tests passed.
