# Claude Desktop Projects

Use a **separate Project for each ray**, with its own project instructions and an authorized local folder. This is different from Claude Code's `CLAUDE.md` auto-loading.

1. Install the [Claude Desktop app](https://support.claude.com/en/articles/10065433-install-claude-desktop) and Node.js 18+.
2. Run `.\install.ps1 -Agent claude-desktop -Root .\my-rays -Ray website -Demo` on Windows, or `bash install.sh --agent claude-desktop --root ./my-rays --ray website --demo` on macOS/Linux.
3. In Claude Desktop open Projects and create one Project for `demo` (and one for each further ray). Use **Set project instructions** and paste the full contents of `my-rays/demo/PROJECT-INSTRUCTIONS.md`. That file is a copy of the general rule template, not an automatically loaded Claude Desktop rule.
4. For a local working directory, prefer a Project in Claude **Cowork**: choose **Use an existing folder**, select the ray folder, and set the instructions. If the app instead offers a regular Project chat, upload or link `GOALS.md` and `plans/resume.md` as project context, but note that uploaded copies do **not** remain synchronized with disk.
5. Where local folder access needs a connector, open **Settings → Desktop app → Manage** next to Extensions, install or enable an authorized filesystem desktop extension, and allow **only the ray folder** (and explicitly approved repositories). Select that connector when it is available in the Project/Cowork session. A connector that can only read/write files cannot run Node checks. Have a separate terminal run the checks or use a reviewed tool that supports execution.
6. Start a chat or Cowork task **inside that Project**: "Read the live GOALS.md and plans/resume.md from the ray folder. Run every Check if execution is available; otherwise tell me the exact commands, and wait for their real output. Repair failures, continue Next, update the files."
7. For a restart, open a new task within the same Project and repeat that startup prompt. Treat `plans/resume.md` and the live folder as the durable record; Project chat context does not automatically transfer every detail across chats.

The Project instructions and knowledge behavior are documented in [Projects](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects). Current [Cowork Projects](https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork) support existing local folders and project instructions. For extensions see [connectors](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors).

## Limits and showing a document

A plain Project chat is **not a coding CLI** and cannot be assumed to execute shell commands or open a native window; a filesystem connector alone does not add those powers. For real automatic file editing and checking, use a supported Cowork tool setup or the Claude Code CLI. New Cowork tasks may run in the cloud; accessing local files requires the desktop app to remain open and the folder to be connected. See [Cowork availability and local-file limits](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile).

Ask Claude to write a short note under `docs/changes/`, then preview it in the Project, or open it yourself with the default OS app. A local terminal can run `node my-rays/tools/open-note my-rays/demo/docs/changes/<topic>.md` and `node my-rays/tools/board my-rays` to generate `my-rays/board.html`. The app's own document preview is the nearest equivalent if native auto-opening is unavailable.

No automatic resume hook comparable to a local CLI lifecycle hook is guaranteed for ordinary Project chats. The startup prompt and the persistent files are the fallback.
