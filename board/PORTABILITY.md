# Portable board

The managed kit uses the owner's RPM project list and project page, card output tabs, document navigation, decision service and check service. The installer, CLI, listener boundary and portable transcript/usage adapters remain kit-specific. The old standalone static-site walkthrough (`tools/board.mjs`) is separate from the managed board. `/board/all` is a project-list alias rather than the owner's private fleet dashboard.

`~/.arpe/settings.json` retains the existing root, board port, agent, token and sharing settings on upgrade. The command is `arpe`; the old executable is a compatibility wrapper. Stop managed sessions before reinstalling. No agent installation or external supervisor is required. Sharing retains a separate loopback listener that exposes only invitation-scoped routes.

## Integration switches

The `integrations` object defaults to the following disabled values. A missing, malformed or unavailable optional source is disabled. Only the read-only usage adapter is supported as an opt-in in this kit.

| Setting | Default and reason |
| --- | --- |
| `usageProxy` | `{ "enabled": false }`; no local proxy database is assumed. Explicitly enable and supply an absolute `path` to a compatible database to show Context/Spend when records exist. No proxy is started. |
| `ledger` | `{ "enabled": false }`; the private keeper ledger and job execution services are not bundled. Fleet, floor, job, rescue and handoff controls are unavailable. |
| `handoffQueues` | `{ "enabled": false }`; no external job spool or automatic dispatch. |
| `restarter` | `{ "enabled": false }`; no private process supervisor or waker. |
| `diskStatus` | `{ "enabled": false }`; no private workspace/disk monitoring. |
| `codexGate` | `{ "enabled": false }`; no private Codex gate. |
| `chatAsk` | `{ "enabled": false }`; no injection into live agent terminals. |
| `openWith` | `"off"`; no private desktop renderer or placement scripts. |

The private Claude session registry, desktop/workspace orchestration, truth-check and benchmarking are not started or registered as managed services. Some owner source helpers are retained for source parity, not exposed as installed automation. The private fleet dashboard is not exposed. Local transcript lookup uses `claudeProjectsDir` (default `~/.claude/projects`); no transcript is invented. Chat writes durable notes, not live session commands. Stats reads available local records; missing records produce no measurements.

## Checks and trust

The owner board runs the same `check:` grammar (`run`, `http`, `file`, `manual`), uses the original ten-minute cooldown and scans on startup and once per minute. It checks every local project with a GOALS.md file, not just active sessions. Manual checks are not automatically executed. The check history is retained in managed board data. Open a card's Check tab to see the declaration, status and output. A manual Run is subject to cooldown. The structural RPM checker is a different tool.

Outcome checks execute with the current user's permissions: only place trusted projects and check declarations in your local project root. The sharing listener does not expose the local check runner or owner routes. Review any guest edits before trusting them; the shared edit route must not introduce executable check declarations. No private services are necessary for the starter demo.

The owner’s external workspace commit diff/blob routes and external document-renderer vendor endpoint are not registered in the managed server. Local evidence-file previews and the built-in Markdown fallback remain available. See [VERIFICATION.md](VERIFICATION.md) for outstanding browser and runtime verification.
