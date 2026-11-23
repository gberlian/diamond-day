# demo

## 1. Static pages build
- **Want:** Two HTML pages and their stylesheet compile to dist/.
- **Check:** Two pages and a stylesheet are copied, with valid document titles.
  check: run node checks/build.mjs timeout=15s
- **Research:** `docs/goals/build/`
- **Now:** The build is checked every time the demo runs.
- **Next:** Keep the generated pages in sync with site/.

## 2. Every local link resolves
- **Want:** No missing local targets or fragments in the generated site.
- **Check:** The link verifier finds no unresolved destination.
  check: run node checks/links.mjs timeout=15s
- **Research:** `docs/goals/links/`
- **Now:** An intentionally broken link in site/index.html makes this check FAIL.
- **Next:** Replace missing.html with about.html#purpose, rebuild, and rerun this check.

## 3. Human acceptance
- **Want:** A human confirms the demo clearly communicates its goals.
- **Check:** Review the pages and record an explicit judgement with supporting notes.
  check: manual
- **Research:** `docs/goals/review/`
- **Now:** No human report has been submitted.
- **Next:** Use node tools/checks.mjs report demo 3 pass "reviewed" from the installed root.
