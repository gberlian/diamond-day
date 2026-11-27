# Verification handoff

Baseline: arpe-kit-c228817; owner board: ray-board-ff0db73.

## Executed in Linux with Node fallback

- `node --test` — exit 1; 60 tests, 58 passed, 2 failed. Failures:
  - `examples/arpe-demo/site/test/e2e.mjs`
  - `arpe-demo example: actual browser Check passes five of five and captures both widths`
  - Both fail at browser navigation with `net::ERR_BLOCKED_BY_ADMINISTRATOR`.
- `bash test/no-private.sh` — exit 0.
  - PASS no-private.sh: no user paths, addresses, wallet-like strings, or deny-list terms
- `RAY_RUNTIME=node bash test/clean-install.sh` — exit 0.
  - PASS demo Check: plans/resume.md: fresh (0s; max 86400s)
  - PASS board: HTTP 200; projects demo, demo2; both RPM project pages and card APIs answer; scripts parse; resume links resolve
  - ray has been renamed to arpe.
  - PASS sharing: owner page HTTP 200; share listener /api/board HTTP 404; viewer invitation works
  - PASS upgrade: existing project, token, root, board and share ports preserved
  - PASS uninstall: board no longer answers
  - PASS clean-install.sh: empty HOME after uninstall; 5s elapsed
- Separate upgrade experiment: installed the unmodified baseline, created a project with the old command, installed the port into the same HOME, compared project bytes and root/port/token/agent settings, and listed the project using `arpe list`. Exit 0.
  - PASS baseline-to-port upgrade: old project and settings preserved; arpe list works
- `node tools/capture-managed-board.mjs` against a fresh install — exit 1.
  - FAIL managed screenshots: net::ERR_BLOCKED_BY_ADMINISTRATOR

## Outstanding acceptance

The Windows PowerShell and Bun runtimes are unavailable in this environment; no Windows or Bun test pass is claimed. The real browser captures could not be generated because navigation was blocked. No replacement screenshots or fabricated check results are included. Run the capture script against a fresh managed install with a browser that can access the local board. It saves the three requested images only after all three views render and a real check verdict is visible.

The scheduler's initial real check was verified; a full ten-minute elapsed-time rerun was not observed. The full owner fleet dashboard and private integration-specific routes, including external workspace diff/blob and vendor renderer routes, are not registered in the public server. The `/board/all` route is a project-list alias. The core RPM pages and check API are ported, but pixel-for-pixel UI parity and every owner-specific route are not verified.
