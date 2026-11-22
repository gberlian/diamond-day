# demo

## 1. Static pages build
- **Want:** Two readable HTML pages are copied into a clean output folder.
- **Check:** `node checks/build.mjs`
- **Research:** `docs/goals/build/`
- **Now:** The source contains two pages and one stylesheet; run Check at session start to prove the output.
- **Next:** Add a visible release stamp to the home page, then rerun the build check.

## 2. Local links work
- **Want:** Every local link in the built pages points to a real file or page fragment.
- **Check:** `node checks/build.mjs && node checks/links.mjs`
- **Research:** `docs/goals/links/`
- **Now:** The source links home and about pages; rerun Check before claiming there are no broken links.
- **Next:** Add a third page with a link from home, then rerun the link check.
