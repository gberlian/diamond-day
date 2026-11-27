# Install ARPE and reproduce arpe-demo

## 1. What you get

```text
┌────────────────────────── arpe-demo ──────────────────────────┐
│ A one-page countdown timer                               4/6 │
│ Result: accurate to 5 seconds; fits phone and desktop.         │
│ Purpose: prove that a fresh project can finish tested work.    │
│ PLANNED          RUNNING                  DONE                 │
│ Publish if yes   ★ Owner reviews page     Mission reviewed     │
│                  waiting on you           ★ Countdown page     │
│                  [online / local / change]★ Browser test       │
│                                           Setup gaps recorded  │
│ Check: browser test passes                                    │
│ Now: page passes all five checks; waiting for your decision.   │
├────────────────────────── Countdown ──────────────────────────┤
│           2       03       09       57                        │
│          days    hours     min      sec                       │
│                 [ Choose date and time ]                      │
└───────────────────────────────────────────────────────────────┘
```

*Drawing of the board at the owner-review stage and the page it controls. The four numbers change every second. A star marks a card that must be done.*

ARPE stands for Agentic Result-oriented Purpose-driven Execution. Install the kit and you get a board on your computer, a command called `ray` to create and open projects, and a folder for each project. The board turns the project's plain-text plan into three columns. An agent is a program that can read and edit your project, run tests and record what happened. You choose the outcome and why it matters; the agent chooses and carries out the work.

The example ships the original single-file countdown page from 26 November 2026. Its browser test checks five behaviours and takes pictures at 1280 and 390 pixels. Follow the walkthrough to recreate the project, make the decision on the board, and run the test on your own machine. The replay uses the saved page so everyone starts with identical code. With an agent you can also ask it to build independently against the same Result and Check; its implementation may differ.

## 2. Install

Get the repository at [github.com/gberlian/diamond-day](https://github.com/gberlian/diamond-day) (Code → Download ZIP), or use the checkout that contains this guide. Extract it and open a terminal in the extracted repository folder. Keep that folder until you have copied the example.

**macOS and Linux** (Bash, curl and unzip available):

```sh
bash install.sh
```

**Windows** (PowerShell 5.1+ or 7+):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

These are the kit's board installation commands. The installer uses Bun, a program that runs JavaScript, and downloads it if needed. You need internet access for that download. The board starts at `http://localhost:5195/board`. Open the address it prints. Open a new terminal after installation; on Linux you can also run `source ~/.profile`. On macOS use a new shell so the updated PATH is loaded. On Windows use a new terminal to pick up your user PATH.

From the new terminal, run:

```sh
ray list
ray board
```

You should see `demo`, the small project installed by default, and the board in your browser. For the countdown example, install Chrome, Edge or Chromium if you do not already have one. The example's test uses the installed browser in the background; it has no additional package dependencies. No AI account is necessary for the replay. For a live agent session, install and sign in to Claude Code separately. The installer does not change its trust settings.

## 3. Replicate arpe-demo

The original order was exactly:

> Demo project to prove the ray CLI: a one-page countdown timer site

On 26 November 2026 the command saved these words at 14:28:38. The first goals file copied the sentence instead of defining a measurable outcome and lacked a Check. The shipped example separates that original, failing starter (reconstructed from the recorded descriptions) from the repaired plan, which is reset to the beginning of execution. None of its cards start done, and its reference page has no pre-recorded passing test.

### Create the project and agree on the outcome

Return to the extracted repository folder and run the same command on all three systems:

```sh
ray new arpe-demo --from examples/arpe-demo
ray board arpe-demo
```

The command copies the example to your installed project root, normally `~/rays/arpe-demo`, and adds it to the active list. It refuses to overwrite a project. On the board you should see one Result, six cards, and 0/6 done. One card is running; the others are planned. The page and test are already in the project, ready to be checked. The original project created a separate code folder; this example keeps the code in `site/` to make the whole project portable.

In a terminal, enter the installed project folder. On macOS/Linux:

```sh
cd ~/rays/arpe-demo
```

On Windows PowerShell:

```powershell
Set-Location "$HOME/rays/arpe-demo"
```

If you installed with a custom project root, use that location instead. The remaining commands work from this project folder. To have an agent run the replay, open another terminal and run `ray open arpe-demo`, approve access to this project when prompted, and give it the original sentence above followed by: “Read the project instructions and follow the reproducible walkthrough. Ask me on the board before publishing.” The instructions tell it exactly what to do. If running the example without an agent, execute each command yourself. Use only one of these paths at a time; two processes editing the same plan can lose proof.

Open `GOALS.md`. Its Result is the original measurable sentence from the repaired plan:

> a single page counts down to a date set in its link or picked on the page, stays within 5 seconds of the true time, shows zero once the date passes, and fits screens from 390 to 1280 pixels wide.

Its Purpose is to give the new project command one finished, tested project and see quickly whether a fresh ray can plan, build and prove its work alone. As owner, agree to these two fields before starting. The agent may propose them but needs your approval to change them.

To see what went wrong in the original starter, run this optional demonstration:

```sh
bun ../tools/rpm-check.ts docs/original-starter.md --today 2026-11-26
```

Expect `score 10/17 (59%)` and `hard failures 5: FAIL`, exit 1. The five failures were missing fields, missing runnable Check, too few cards/no running card, no must and incomplete weekly review. They were five rules in one run, not five separate attempts.

Now review the mission and approve the repaired plan:

```sh
bun replay.mjs prepare
bun ../tools/rpm-check.ts .
```

The first command writes the first-steps note, updates the review to today's date and moves the mission card to Done with proof. The checker should print `score 17/17 (100%)` and `hard failures 0: PASS`. The board, which polls the files, will show 1/6 done and the page card running. Refresh if needed. This score measures the structure of the plan. The page still needs its own test.

### Run the actual page and browser Check

```sh
bun replay.mjs build
```

The script runs the actual browser test against the shipped page on a temporary local web server. The test must print five PASS lines and `all checks passed (5/5)`. It opens a link with a target two days, three hours and ten minutes ahead, waits 2.2 seconds, and checks:

1. The remaining time is within five seconds of the target.
2. The numbers go down by one to four seconds during the wait.
3. The page has no horizontal overflow at 1280 and 390 pixels.
4. A past target displays zero and marks the page finished.
5. Without a target it counts to the next New Year; changing the date changes the clock and link.

The original test had the same five headings, but the desktop width, date picker and exact fallback date were weaker or untested. The shipped test includes those assertions, uses the installed browser directly and saves the output from this run. Open `site/index.html` in your browser to see the original page. Open `site/test/shots/1280.png` and `site/test/shots/390.png` to inspect the new pictures. The decision on the board also shows them.

After a successful build stage the board shows 4/6 done. The mission, page, test and setup notes have proof beneath their cards; the owner's review card is running and marked waiting on you. The publication card remains planned. Open a done card to inspect its proof, or open the test output at `site/test/last-run.txt`. If the test fails, the stage stops without recording completion. Read the error and the resume note; do not advance the cards until the test passes.

You can rerun the outcome Check directly any time:

```sh
bun site/test/e2e.mjs
```

The public RPM board displays the Check declaration and recorded proof; it does not run the browser test on a timer or provide a live PASS/STALE light. The command above is the authoritative current outcome check. Exit 0 and five PASS lines confirm it. The original private board ran the declared check automatically; it recorded 29 passing runs from 14:55 to 21:29 that day. Run checks again after changes and before reporting a result.

### Answer the question on the board

Click **decisions** at the top of the board, then **Countdown page: right, and online?** (or open the running owner-review card). Inspect both images. The options are “Looks right, put it online”, “Looks right, keep it local”, and “Needs changes (say what)”. Choose one and click **Answer**. An optional note can explain the choice. The board saves your answer to the project's decision inbox; it does not grant a hosting account or publish anything on its own. The agent reads the answer from disk. If the agent is stopped, start it again or continue the replay from the resume note. There is no automatic wake-up integration in this kit.

For a complete local rehearsal without a hosting account, choose **Looks right, keep it local** and run:

```sh
bun replay.mjs finish
```

To follow the original decision exactly, choose **Looks right, put it online** (the original owner answered at 16:32:08). Publish only `site/index.html` on a static web host you control. For example, create a repository on GitHub, upload that one file to its default branch, open Settings → Pages, choose Deploy from a branch, choose the default branch and root folder, and save. When Pages gives you a public HTTPS address, open it and confirm it shows the countdown. Supply that actual address to the following command in place of the example address:

```sh
bun replay.mjs finish https://example.com/countdown/
```

The script reruns the same Check against the address you supply, records the result and updates the Check line. It will not accept an online answer without an HTTPS address or pretend that a local test proves publication. If you choose changes, write what needs changing and have the agent revise the page, rerun the test and create a new decision before marking the review done. The original owner chose online; the historical test passed 5/5 against the published page at 20:20.

The board now has six done cards and a seventh running case-log card, just as the original evening board did. The local path records your local decision instead of a live address. To finish the rehearsal rather than leave an open-ended case log, run:

```sh
bun replay.mjs close
```

This reruns the declared Check, requires proof on the three must cards, writes one final case-log entry, marks its card done and saves the finished Result in `docs/completed-result.md`. The board shows 7/7. The method checker may flag that the finished plan should be replaced; this is expected. Save the completed record, then replace the Result with your next approved Result or retire this finished project. For a managed agent session, `ray stop arpe-demo` stops the agent without deleting the project or stopping the board. A project can stay on the board as a completed example. `ray restore` restarts the board and reopens active rays where a terminal is available, otherwise it prints resume commands.

## 4. Start your own project

Choose a small useful outcome, not a list of jobs. For instance, create a page with opening hours and contact details for a club. From a terminal:

```sh
ray new club-page "A public information page for our club"
ray board club-page
ray open club-page
```

The first command writes a starter goal, project instructions and a resume note. The last command opens your agent in the project (Claude Code must be installed). Without an agent you can edit the Markdown files yourself. Give the agent the Result, the reason, and the boundary: make the page locally first; ask before publishing. Replace the generated first goal in `GOALS.md` with the following example; keep its header and update the weekly review date.

```markdown
## 1. Club information page
- **Result:** A single page shows our opening hours, contact details and location, with no horizontal scrolling at 390 pixels.
- **Purpose:** So that a new visitor can find the club without asking a volunteer.
- **Plan:**
  - [~] Collect and confirm opening hours and contact details (owner, 15m)
  - [ ] * Build the page with the confirmed information (session, 1h)
  - [ ] Run a browser check of the information and phone width (session, 30m)
- **Check:** The browser confirms the three facts and no horizontal overflow.
  check: run bun site/test/e2e.mjs timeout=90s
- **Now:** Waiting for the confirmed club information.
```

The check command is a specification until your agent writes that test in your project; ask it to implement the test and run it. It should validate the actual facts against your confirmed information, open the page and verify the width. A runnable declaration alone is not proof. Use `bun ../tools/rpm-check.ts .` from the installed club project to check the structure. For each card, ask for a link to the evidence before the agent marks it done. If facts need your approval, ask the agent to put a question on the board with a unique decision ID and link it to the relevant card. See the example's `replay.mjs` for the simple JSON format: a file in `decisions/` with an ID, title, question, options and optional note, plus `decision: ID` indented under a card. The answer is written alongside it as `ID.answer.json`.

You can change the plan when the work changes. Only you can approve changes to the Result or Purpose. Keep the first Result small enough to prove and replace when it is reached.

## 5. How it remembers, learns, evolves and finishes

### Remember: leave the next session enough to act

An agent's conversation history is temporary. Its project folder survives a restart. The resume note is a small handoff to the next session, updated after each meaningful step. It has five parts: **Now** (what is true and its proof), **In flight** (work or handoffs still running), **Next** (the next action), **Waiting on the owner** (the exact decision or input), and **Gotchas** (mistakes and how to avoid them). Open `plans/resume.md` after the build stage: it says the browser Check passed five of five, the pictures are ready, and the next action is to read the saved answer. A fresh session can continue from those facts without asking the same question again.

In the original arpe-demo, the first resume note was only one line. At 14:50 the command was fixed after the project reported the missing parts. At 17:51 a coordinator wrote that the project was open, but the project's next recorded session began at 20:20. The saved order was still there and the session published the page within three minutes. A written order survives; a running session must be verified. When replacing an agent, give the successor the resume note and ask it to confirm the Result, proof, next action and waiting decisions before the old session closes. The wider record describes the coordinator replacement that evening closing too early; the handover confirmation rule addresses that failure. The public CLI stops and opens sessions; the confirmation is a procedure the owner and agents perform, not an automatic guarantee.

### Learn: keep facts and decisions

An Insight is a permanent one-paragraph fact about how something really behaves. In this example, `insights/2026-11-26-method.md` records a finding from the day: the initial goals failed five hard rules, the rewritten plan passed 17/17, and a separate browser test proved five behaviours. That is useful on every new project. A Gotcha says what went wrong and what to avoid. At 14:47 the shell ate a backslash in the original test; the first repair failed, a different way of writing the line worked, and the third run passed. Save that fact and the working alternative rather than retrying the broken command. The portable test is a standalone file, so it avoids that original shell-quoting step.

A decision records its context, the chosen answer and the reason or owner note. The original question was whether the tested countdown belonged online or locally. The owner chose online at 16:32. The replay saves your own answer and the decision note after the final test. A later session can tell what was approved and why it acted. It cannot assume that approval applies to another project. The Insights and Decisions sections of the board read these files. Do not invent a reason if the owner gave none; record the actual choice and its context.

### Evolve: keep the project, replace its Results

The lasting project is the area you care about; a Result is a temporary outcome within it. The plan is a menu ordered by importance, with a few musts. If a different approach reaches the Result, cross off the unnecessary work and record it in the weekly review. The review line has a date and three parts: `done`, `crossed off`, and `carried over`. Update it every week. In arpe-demo, the session's setup-gap notes led to the command being repaired that afternoon, so later projects started with a better template. The Result remained the countdown page. After the page passed and the owner chose its destination, the original goals still had an ongoing case-log card. In the replay the case log has a finite end, and the completed Result is archived. The next Result can be something different, such as testing a second project on a clean machine, if the owner wants it.

### Finish: define the test before doing the work

A Result is one measurable sentence; its Check is a command that measures it. The agent cannot change the five-second threshold to fifty seconds or remove the phone width to make a failure pass. It can change the plan, but only the owner changes the outcome. Each must card needs an actual proof line, and the Check needs a fresh passing run. Done is both of those together. In arpe-demo the four early cards were marked done without proof at 14:48. The owner noticed at 17:20, the coordinator ran the test and added the missing evidence at 17:22. The replay writes the proof at the same time as each tick. A done card's proof explains what happened; a fresh Check tells you whether the outcome holds now.

Exactly one card is marked `[~]` while work remains, so another agent or the next session knows what is being worked on. A blocked question goes to the decision inbox with the options and what the owner needs to see. Work on another useful unblocked card if one exists; leave an honest waiting state if nothing remains. The original question sat answered for over an hour because the session had not read the answer. The replay reads it before finishing. It cannot silently select a destination or leave a requested publication half done. Once the three musts have proof and the five checks pass, stop adding refinements. Tick the completed work, archive the Result and get the next Result from the owner. The current board counts done cards; the archive preserves the completed outcome after you replace its plan.

## 6. When it goes wrong

These are the original recorded milestones on 26 November 2026, in the owner's local time. The precise times are historical, not durations to expect on your computer.

| Time | What happened |
| --- | --- |
| 14:28:38 | Project created from the owner's sentence; initial template incomplete. |
| 14:36:51 | Session opened and began reading the project. |
| 14:37 | First steps proposed; first card completed with proof. |
| 14:46:34 | Coordinator sent the five-rule method failure back to the session. |
| 14:47:20–14:47:37 | Page and test written; two failed attempts due to shell quoting; third passed 5/5. |
| 14:48:11 | Repaired plan passed 17/17; four cards marked done, proof omitted. |
| 14:48:37–14:48:50 | Owner question created with screenshots and tied to the review card. |
| 14:50 | Command repaired from the project's setup gaps. |
| 14:55 | Historical board first recorded a passing Check. |
| 16:32:08 | Owner selected online. |
| 17:20–17:22 | Owner asked about missing proof; coordinator reran test and restored proof lines. |
| 17:49–17:51 | Coordinator found the saved answer, moved cards and wrote the publish order. |
| 20:20–20:22 | Session returned, published page, passed live test 5/5 and added the case-log card. |
| 20:44 | Historical system added a mechanism to notify a running session of answers. |
| 22:20 | Owner decided the project should be a repeatable benchmark. |

If the board is missing, run `ray board` again. If the command is not found, reopen the terminal to load the PATH. If a project was only partly made, check `ray list`, the folder and its resume note. The original command stopped during service restarts and left missing registration. A copy error in the new option refuses to overwrite existing work; inspect the folder rather than deleting it blindly. A missing agent executable means you need to install/sign in to the agent or use the replay commands yourself.

If the method check fails, read its hard-rule lines. The example's deliberately faulty starter reproduces the five failures; the repaired plan has enough cards, a runnable Check, one active card, a must and a current weekly review. Refresh the review when it is stale, based on real events. A score can still pass a vague Result or Purpose because some rules are soft; read the wording yourself.

If a browser test fails, read the exact error. Install a Chromium-family browser if needed, or set the `CHROME` environment variable to the executable on your machine. In Bash use `export CHROME="<browser executable>"`; in PowerShell use `$env:CHROME = '<browser executable>'` (replace the placeholder with your browser's real location). On a managed machine the browser may block local navigation; use a machine or browser where you are authorized to open the page. A failure before navigation proves nothing about the page. The original shell-quoting error was fixed by changing the way the script was written, not by weakening the assertions. If a picture looks wrong or the test fails, fix the page, rerun the Check and retain the failure note.

If a card is done without proof, open it and request the actual output or file. Do not fill the gap with invented times or evidence. If an answer sits unanswered by the agent, check the decision inbox, confirm that the session really is open, and read the resume note. The original coordinator found the answer by chance at 17:49, and the reported 17:51 opening did not produce a recorded session until 20:20. In this kit answers stay on disk; read the answer file or ask the agent to do so. If the owner changes their mind, preserve the old answer and ask a new question with a new ID. The original system also duplicated questions; the example uses one linked decision ID and rejects a second answer. Confirm a fresh session has read and understood the handover before ending the previous one.

## 7. Glossary

**ARPE:** Agentic Result-oriented Purpose-driven Execution. **Ray:** a project folder with its goals, notes, decisions and work. **Agent:** a program that carries out the work and can run tools. **Session:** one running conversation with an agent, which can be stopped and restarted. **Board:** the local browser view of the project files. **Result:** a measurable outcome owned by the person. **Purpose:** why that outcome matters. **Execution / Plan:** the agent's ranked menu of cards; `[ ]` planned, `[~]` running, `[x]` done. **Must:** a starred card that the outcome depends on. **Proof:** evidence of a completed card. **Check:** a command that runs and measures the Result. **RPM check:** a separate check of the shape of the plan. **Now:** the current state in plain words. **Resume note:** the five-part note a fresh session reads. **Handoff:** a task sent to another agent, with a specific result and a way to check it. **Handover:** transfer of the current session's context to a successor, confirmed before closing the old one. **Decision inbox:** questions with options and saved owner answers. **Insight:** a permanent fact learned in work. **Gotcha:** a known failure and how to avoid repeating it. **Weekly review:** a dated record of what is done, crossed off and carried over. **Coordinator:** an agent that routes work between projects and checks that it arrived. The kit's walkthrough uses one ray; shared coordinator and automatic agent-wake services are outside its scope.

## Share a project with one person

A shared company is one ray. The guest sees the Result, Purpose, Plan, and only the artifacts and decisions you publish. The owner board, other projects, chat, stats, and agent controls are not exposed.

1. Install the kit using the command above. Create a project with `ray new demo2 "A small demo"` or use the installed `demo`. Review its GOALS.md, including every plan card and proof label. Do not share credentials or sensitive text.
2. Start the separate loopback listener: `ray share start 5196`. Choose a free port different from the owner board. This saves `sharePort` in `~/.diamond-day/settings.json` and restarts the board. It starts again automatically when `ray board` starts the board. For a local test, run `ray share demo Guest viewer 1` and open the printed invitation in a browser on this computer.
3. For another person, install Tailscale, enable HTTPS for your tailnet and restrict access to that person. Use Tailscale **Serve**, not Funnel. In PowerShell, run:

   ```powershell
   $loopback = @(127,0,0,1) -join '.'
   tailscale serve --bg "http://${loopback}:5196"
   tailscale serve status
   ```

   In Bash, use `tailscale serve --bg "http://$(printf '%s.%s.%s.%s' 127 0 0 1):5196"`. Copy the HTTPS origin reported by Serve and run `ray share start 5196 HTTPS_ORIGIN`, replacing `HTTPS_ORIGIN` with that origin. Never proxy the owner board port. The listener binds only to IPv4 loopback; no firewall opening or direct Internet exposure is needed.
4. Open **sharing** on the owner board. Select `demo`. Enter reviewed ray-relative artifact paths (for example `docs/design.md`) and decision IDs, one per line, and save the publication. Only supported presentation files under `docs/` or `decisions/images/` can be published; images used in decisions must also be individually published. Published files are live, so review later edits too. Raw queue files, credentials and private/internal paths are not served.
5. Run `ray share demo Guest viewer 24` for a one-day viewer invitation, or use the sharing page. Replace `viewer` with `editor` to permit intent edits (Result/Purpose, new results and result ordering), comments and answers to published pending decisions. Execution cards remain agent-owned. Send the printed HTTPS link privately. The guest opens it while connected to Tailscale; the fragment token is exchanged for a company-scoped cookie. The token is reusable until expiry or revocation. The company URL without a token or cookie returns 404. The guest can refresh the shared page or connect it from their own board's sharing page.
6. Revoke an invitation on the sharing page to invalidate its token and cookies. Use `ray share stop` to disable the guest listener and remove its setting; also disable the corresponding Tailscale Serve configuration. Stopping the listener does not revoke existing invitations. Uninstall stops both listeners. Keep `.board/` out of version control and protect your managed settings directory; invite hashes and connection tokens are stored locally. On Windows, use account-only directory permissions. Revocation cannot recall downloaded documents.

The shared editor checks the GOALS.md revision before writing and records audit notes under `plans/`. Coordinate human and agent edits; the revision check is not a filesystem lock across processes. The starter does not import a private handoff ledger; publish reviewed handoff excerpts as documents instead.

### Project notes, chat and stats

The project page shows Result, Purpose, and the Plan columns. Notes lists dated `-from-` files in `plans/`; Plans lists other plan files; Changes lists `docs/changes/` and exported chat replies. `ray note TO FROM SLUG FILE` writes a note for another project (`-` reads standard input). Board chat reads local Claude Code transcripts for the configured project folder, clamps replies to five lines, and expands the full text. Recent long replies are exported into `docs/changes/chat/` when chat is read. **Save note** writes a message to Notes; the portable starter does not install the private live-session messaging hook. The agent reads the note on its next turn or resume. A decision inbox **Dismiss** writes an answer with key `dismissed`: no choice was approved. The agent should close that question or ask a new one.

Open **stats** for local transcript token totals, estimated costs, handoff timing and retained check history. Empty sources produce empty data. The default Claude transcript root is `~/.claude/projects`; set `claudeProjectsDir` in managed settings to override it. For optional prompt-proxy usage, set `usageProxyDb` to your local usage SQLite database and optionally `usageProxyPrices` to its price JSON file. The usage panel stays hidden when no compatible records exist. Restart the board after changing settings (`ray share start PORT` with the same configuration or reinstall using the original options). No proxy service is installed or contacted by default.

