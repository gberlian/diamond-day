# arpe-demo

**Ultimate Vision:** a countdown page anyone can open, set to any date and share as a link, built and checked end to end by a ray started from the new ray command.
**Ultimate Purpose:** so that the ray command is proven on a small real project; because what the first ray finds missing in its setup makes every later ray start right.
**Roles:** Page Builder, Tester.
**Week of 2026-11-26:** done: none; crossed off: none; carried over: review the mission.

Plan legend: `*` marks a must; each card ends with who does it and roughly how long.

## 1. A one-page countdown timer
- **Result:** a single page counts down to a date set in its link or picked on the page, stays within 5 seconds of the true time, shows zero once the date passes, and fits screens from 390 to 1280 pixels wide.
- **Purpose:** so that the new ray command has one finished, tested project to point at; because a small page shows quickly whether a fresh ray can plan, build and prove its work alone.
- **Plan:**
  - [~] Mission reviewed and first steps written down (session, 15m)
  - [ ] * Page counts down to the date from the link or the date picker (session, 1h)
  - [ ] * Automatic test opens the page in a browser, checks the countdown and takes pictures at phone and desktop width (session, 30m)
  - [ ] Gaps in the new ray's setup written down for the coordinator (session, 20m)
  - [ ] * Owner looks at the page pictures and says whether it is right (owner, 10m)
  - [ ] Owner decides whether the page goes online, and it is put online if yes (owner, 10m; session, 30m)
- **Check:** the automatic browser test passes against the countdown page.
  check: run bun site/test/e2e.mjs timeout=90s
- **Now:** The owner has supplied a mission; the repaired plan awaits review and the page awaits a fresh test.
