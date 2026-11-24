---
description: Merge a reviewed Diamond reply and record the reason
argument-hint: <job> <reason>
disable-model-invocation: true
---
Arguments: `$ARGUMENTS`. Require an exact job name **and** a nonempty human-written reason. If either is missing, request it before running anything. This changes the target Git repository: only do it if the user has explicitly requested the merge of that job.

First use `/diamond:diamond-review` or read the job's DIFF page to verify what will be merged. Then invoke the Bash tool with **separately shell-quoted** arguments equivalent to:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/diamond-hook.mjs" --config "${CLAUDE_PROJECT_DIR}/.diamond.json" decide JOB merge "REASON"`

Replace `JOB` and `REASON` with the supplied arguments; do not pass raw `$ARGUMENTS` into a shell expression. The Node runner calls `diamond decide` with a direct argument vector, and Diamond checks for a clean worktree and unchanged reviewed HEAD. Return the actual outcome or error. Do not claim a merge if the command fails.
