# Demo ray: a two-page static site

No AI service or package download required. From an **installed** demo ray, run:

```sh
node ../tools/check-goals.mjs GOALS.md
node checks/build.mjs
node checks/links.mjs
```

When running directly in this repository under `examples/demo-ray/`, use `node ../../tools/check-goals.mjs GOALS.md` for the first line (the build and links commands stay the same). The two checks build `dist/` from `site/` and verify local links and fragments.

This ray edits only its own `site/`, `checks/`, and `docs/` files. Its `dist/` directory is generated output. The instructions for your selected agent are installed beside this file.
