# Demo ray: a two-page static site

No AI service or package download required. Run from this directory:

```sh
node ../tools/check-goals GOALS.md
node checks/build.mjs
node checks/links.mjs
```

In the repository example, use `node ../../tools/check-goals GOALS.md` for the first line. When installed, use `../tools/check-goals`. The two checks build `dist/` from `site/` and verify local links and fragments.

This ray edits only its own `site/`, `checks/`, and `docs/` files. Its `dist/` directory is generated output. The instructions for your selected agent are installed beside this file.
