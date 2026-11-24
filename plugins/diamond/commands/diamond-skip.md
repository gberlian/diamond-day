---
description: Skip one Diamond reply and record why it was rejected
argument-hint: <job> <reason>
disable-model-invocation: true
---
Arguments: `$ARGUMENTS`. Require an exact job name **and** a nonempty reason. If either is absent, ask for it. Only run this command when the user explicitly wants this reply skipped.

Review its DIFF first, using `/diamond:diamond-review` or the saved DIFF page. Then invoke the Bash tool with separately shell-quoted arguments equivalent to:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/diamond-hook.mjs" --config "${CLAUDE_PROJECT_DIR}/.diamond.json" decide JOB skip "REASON"`

Replace `JOB` and `REASON` with the supplied arguments, never by interpolating raw `$ARGUMENTS` into the shell. This calls `diamond decide JOB skip REASON`, which stores the decision in `<inbox>/.diamond/decisions.json`. Display the actual result; do not claim success unless the command exits 0.
