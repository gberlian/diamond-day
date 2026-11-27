# Show HN draft

<!-- Owner approval required before posting. Title and body below are the post. -->

Show HN: ARPE – Give AI agents a result, not a list of steps

https://github.com/gberlian/arpe

ARPE is a local board and command-line kit for working with AI agents. You write what must be true (the Result) and why (the Purpose). The agent owns the plan. A finished card needs proof, and a separate Check tests whether the Result holds.

The plan lives in Markdown, alongside decisions and a resume note. When an agent needs your judgement, it puts a question in the board's inbox. A fresh session can read the project files instead of reconstructing the work from chat.

The repository includes a countdown page and a reproducible walkthrough. The replay runs a browser test, records its output and waits for your answer on the board before finishing locally. You can try it without an AI account. For a live session, install and sign in to Claude Code separately.

The kit includes installers for Windows, macOS and Linux. It is not an autonomous agent runner.

I'm interested in whether keeping the result and its evidence outside the conversation makes agent work easier to direct. What would you want to see on the board before trusting that a task is done?

<!-- Claim references (not part of post): ../../README.md (method, platforms and scope); ../GUIDE.md (resume, decisions and replay); ../../examples/arpe-demo/GOALS.md and ../../examples/arpe-demo/replay.mjs (plan and local replay); ../../examples/arpe-demo/site/test/e2e.mjs (browser test); ../tutorial/README.md (recorded walkthrough). -->
