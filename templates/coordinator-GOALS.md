# coordinator

## 1. Every active ray has a goal file
- **Want:** All active rays have structurally complete goals.
- **Check:** The validator exits successfully for each ray in rays.txt.
  check: run node ../tools/check-rays.mjs .. timeout=30s
- **Research:** `docs/goals/ray-health/`
- **Now:** Ready to verify.
- **Next:** Run the check and route missing goal details to owning rays.

## 2. Requests reach an owner ray
- **Want:** Every new request has one owner and an acceptance check.
- **Check:** Review inbox.md, rays.txt and each request's plan, then record a judgement.
  check: manual
- **Research:** `docs/goals/routing/`
- **Now:** Inbox starts empty; no review recorded.
- **Next:** Record the next request, its owner and an evidence note.
