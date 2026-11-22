# Optional proxy and handoff bridge

Neither component is bundled, and neither is needed to install, check, or run the demo. There are no assumed private endpoints, credentials, package names, or unpublished dependencies.

## Model-traffic proxy

If your CLI supports a provider-specific proxy or gateway, configure it using that CLI's official networking settings **outside this repository**. Point only the intended agent at it. Keep credentials in the agent's supported secret store or environment, never in a ray rule, GOALS.md, or a public note. First verify a single request, a denied request, and recovery when the proxy is offline. No portable proxy switch is promised across Claude Code, Codex, and Claude Desktop.

A traffic proxy cannot change goal checks, resume semantics, or connector permissions. Do not put a speculative proxy URL in the installer.

## File-handoff bridge

A bridge can take `handoffs/JOB.md` and its explicitly named attachments, queue the job for another model, and return complete files to a staging directory in the same ray. Record queued, running, done, failed, and applied/rejected states in the resume note. Ensure returned files are reviewed, scanned, and tested before merging. When the bridge is unavailable, use a manual file upload/download as described in [handoffs](handoffs.md).

Do not assume a queue daemon, a restart hook, cross-agent messaging, or any remote service is installed. Provide the external tool's own configuration, test its permissions and failure behavior, and keep its generated state out of public repositories.
