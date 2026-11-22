# coordinator

## 1. Every active ray has a goal file
- **Want:** Active rays can restart from complete, readable goals.
- **Check:** `node ../tools/check-rays.mjs ..`
- **Research:** `docs/goals/ray-health/`
- **Now:** Installed. Structural status has not been checked by this ray yet.
- **Next:** Run the check; route missing goal details to each owning ray and refresh the board.

## 2. Requests reach an owner ray
- **Want:** Every new request has one owning ray and an acceptance check.
- **Check:** Review `inbox.md` and confirm every entry names a ray in `../rays.txt` and a note under that ray's `plans/`.
- **Research:** `docs/goals/routing/`
- **Now:** Inbox starts empty.
- **Next:** Record the next request and create its handoff note for the owner ray.
