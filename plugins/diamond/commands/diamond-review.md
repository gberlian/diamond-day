---
description: Scan configured repos and list all undecided Diamond replies with DIFF links
disable-model-invocation: true
---
Run the Diamond review command using the Bash tool, then show its output:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/diamond-hook.mjs" --config "${CLAUDE_PROJECT_DIR}/.diamond.json" review`

This command runs `diamond scan` and lists **all** undecided replies (even newer than the hook's `minAgeMinutes` threshold), ordered oldest first. If it reports a scan error, report that error; do not infer any decisions. Open the linked DIFF file before recommending a merge or skip.
