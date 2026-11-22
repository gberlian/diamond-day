# Coordinator ray

Owns the inbox, routes requests, and checks written goal status. It does not edit another ray's code without explicit ownership.

Read `../rays.txt`, `inbox.md`, `GOALS.md`, and `plans/resume.md`. A new request is saved here, assigned to exactly one ray, and written as a short file under that ray's `plans/`. The next session in that ray picks it up.

## Authorized repositories

| Repository | Path | Permission |
| --- | --- | --- |
| None | — | Route requests by file notes instead |
