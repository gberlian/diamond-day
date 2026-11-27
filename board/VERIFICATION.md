# Verification handoff

Executed in a Linux sandbox with Node 22.16.0. Commands were run from the kit root, using isolated temporary homes and dynamically allocated ports. Output excerpts omit temporary paths, ports and invitation credentials.

## Full Node suite — exit 1

Command: `node --test`

```text
# net::ERR_BLOCKED_BY_ADMINISTRATOR
not ok 1 - examples/arpe-demo/site/test/e2e.mjs
not ok 5 - arpe-demo example: actual browser Check passes five of five and captures both widths
    net::ERR_BLOCKED_BY_ADMINISTRATOR
1..60
# tests 60
# suites 0
# pass 58
# fail 2
# cancelled 0
# skipped 0
# todo 0
```

The supplied baseline was also extracted unchanged and tested with `node --test examples/arpe-demo/site/test/e2e.mjs`: exit 1, `net::ERR_BLOCKED_BY_ADMINISTRATOR`. The original browser assertions were not modified or skipped. The full suite is not a pass.

## New integration tests — exit 0

Command: `node --test test/sharing.test.mjs`

```text
ok 1 - sharing: invitation scope, cookie, viewer denial, revoke, separate listener
ok 2 - sharing: editor may change intent and publish reviewed artifacts, not execution
ok 3 - board: stats, notes, long transcript export and Dismiss
ok 4 - optional prompt-proxy usage stays hidden without records and scopes costs to the project
1..4
# tests 4
# suites 0
# pass 4
# fail 0
```

## Linux clean install (explicit Node fallback) — exit 0

Command: `RAY_RUNTIME=node bash test/clean-install.sh`

```text
score 17/17 (100%), 1 results, hard failures 0: PASS
PASS board: HTTP 200; projects demo, demo2; both RPM project pages and card APIs answer; scripts parse; resume links resolve
Sharing listener started
PASS sharing: owner page HTTP 200; share listener /api/board HTTP 404; viewer invitation works
Ray already exists: demo2
PASS uninstall (project root purged)
PASS uninstall: board no longer answers
PASS clean-install.sh: empty HOME after uninstall; 5s elapsed
```

## Default Bun clean install — exit 6

Command: `bash test/clean-install.sh`

```text
Installing Bun into the managed installation directory...
curl: (6) Could not resolve host: github.com
```

Bun is not installed in the sandbox, and downloading it failed. The Bun path was not verified.

## Windows clean install — exit 127

Command: `pwsh -NoProfile -File test/clean-install.ps1`

```text
pwsh: command not found
```

The Windows script now asserts the owner sharing page returns 200, the guest listener rejects the owner API with 404, a viewer invitation works, and uninstall shuts down both listeners. It retains the 15-minute assertion. Windows execution, browser UI interaction, Tailscale Serve from a remote node and the owner's actual prompt-proxy integration were not tested here. Run the Windows checks on a network-enabled Windows machine with PowerShell 7 and Bun or the installer download available.

## Privacy scan — exit 0

Command: `bash test/no-private.sh`

```text
PASS no-private.sh: no user paths, addresses, wallet-like strings, or deny-list terms
```
