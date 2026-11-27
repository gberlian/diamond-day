# Changelog

## Unreleased

- Port company invitations, scoped viewer/editor pages, publication allowlists, revocation and remote company connections. Add persistent `ray share start`, `ray share PROJECT` and `ray share stop`. Keep the guest listener separate from the owner router.
- Label Result/Purpose/Plan, add Notes/Plans/Changes, clamped transcript chat with long-reply exports, and durable cross-project notes.
- Add Dismiss to the decision inbox; support both flat and pending/answered decision files while preserving the arpe-demo answer protocol.
- Add local stats and optional read-only prompt-proxy usage. No proxy is required.
- Extend clean-install checks on Windows and Linux for the owner sharing page, invitation access, guest owner-route denial and shutdown. Add integration tests for guest permissions, revocation, publication, chat, decisions and stats.
