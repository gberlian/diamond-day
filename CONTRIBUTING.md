# Contributing

Keep changes small and demonstrable. Use Node.js 20+ for the portable tests (Bash/Git Bash and PowerShell 7):

```sh
bash test/clean-install.sh
bash test/no-private.sh
bash test/no-private-regression.sh
node test/tools-portability.mjs
node tools/check-goals.mjs examples/demo-ray/GOALS.md
```

With PowerShell 7, also run `pwsh -NoProfile -File test/clean-install.ps1`,
`pwsh -NoProfile -File test/no-private.ps1` and
`pwsh -NoProfile -File test/no-private-regression.ps1`. The installers must agree: create missing files, preserve existing content, and accept the same agents and ray names.

Do not copy real conversations, private instructions, private product names, local paths, credentials, customer data, or internal incident records into examples or documentation. Check every new string, filename, screenshot, and archive before proposing publication. Add generic patterns to `test/deny-list.txt`, not private identifiers. The deny-list file is excluded from its own literal scan by design; the scanner still inspects all files with the structural patterns.

Code changes need an executable test. Documentation changes need a clear command or linked official reference. The checked-in demo must stay network-free, dependency-free, and usable without an AI account.
