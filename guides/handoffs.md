# Handoffs between models

Use handoffs for a substantial, isolated deliverable, not quick questions. Copy `templates/handoff.md` to the ray's `handoffs/` folder and fill every section.

The handoff must contain a concrete goal, the names of **real attached files**, constraints, exact paths to return, and commands the receiving model must run. Attach a copy or archive of the relevant source, data, and tests. Remove secrets, local identifiers, and unrelated material. Never say "see the previous chat."

Send the brief and attached files to a second model using its normal file-upload or command interface. There is no required bridge. Record the job and expected output under **In flight** in `plans/resume.md`. Continue useful work while waiting; do not send duplicate jobs just because a reply is late.

When results arrive, inspect the complete files and diff; run the acceptance commands in a clean working tree, reject changes that violate ownership or expose private data, then apply and commit only after review. Update Now, the resume note, and a short change document. State whether the handoff was applied, rejected, or superseded, and why. A transfer service can automate delivery, but not review or acceptance.
