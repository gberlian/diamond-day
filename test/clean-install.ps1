$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("diamond-day-test-" + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($Tmp) | Out-Null

function Run-Node([string[]]$Values) {
  & node @Values
  if ($LASTEXITCODE -ne 0) { throw "Node returned $LASTEXITCODE" }
}
function Expect-Node-Failure([string[]]$Values) {
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & node @Values *> $null
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $oldPreference }
  if ($code -eq 0) { throw 'Expected a failing Node check' }
}
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20+ is required' }
  if ([int]((& node -p 'process.versions.node.split(".")[0]').Trim()) -lt 20) {
    throw 'Node.js 20+ is required'
  }
  Run-Node @((Join-Path $Repo 'tools/check-goals.mjs'), (Join-Path $Repo 'examples/demo-ray/GOALS.md'))
  Write-Output 'PASS fixture: goal file is valid'
  Run-Node @((Join-Path $Repo 'test/tools-portability.mjs'))

  foreach ($agent in @('claude-code','codex','claude-desktop')) {
    $root = Join-Path $Tmp ($agent + ' root')
    & (Join-Path $Repo 'install.ps1') -Root $root -Agent $agent -Ray website -Ray notes -Demo | Out-Null
    switch ($agent) {
      'claude-code' { $rule = 'CLAUDE.md' }
      'codex' { $rule = 'AGENTS.md' }
      'claude-desktop' { $rule = 'PROJECT-INSTRUCTIONS.md' }
    }
    foreach ($ray in @('coordinator','website','notes','demo')) {
      if (-not (Test-Path -LiteralPath (Join-Path $root "$ray/$rule"))) {
        throw "Missing $ray rule for $agent"
      }
      Run-Node @((Join-Path $root 'tools/check-goals.mjs'), (Join-Path $root "$ray/GOALS.md"))
    }
    Run-Node @((Join-Path $root 'tools/check-rays.mjs'), $root)
    if (-not (Test-Path -LiteralPath (Join-Path $root 'board.html'))) { throw 'Missing board' }
    Write-Output "PASS install: $agent rules, rays, goals, and board"
  }
  $root = Join-Path $Tmp 'claude-code root'
  [IO.File]::WriteAllText((Join-Path $root 'website/GOALS.md'), "DO NOT OVERWRITE`n")
  & (Join-Path $Repo 'install.ps1') -Root $root -Agent claude-code -Ray website -Ray extra -Demo | Out-Null
  if ([IO.File]::ReadAllText((Join-Path $root 'website/GOALS.md')).Trim() -ne 'DO NOT OVERWRITE') {
    throw 'Installer overwrote an existing file'
  }
  $rayNames = @([IO.File]::ReadAllLines((Join-Path $root 'rays.txt')))
  if ($rayNames -cnotcontains 'extra' -or @($rayNames | Where-Object { $_ -eq 'demo' }).Count -ne 1) {
    throw 'rays.txt was not updated safely'
  }
  Write-Output 'PASS safety: existing content preserved and new ray appended'

  $demo = Join-Path $root 'demo'
  Push-Location $demo
  try {
    Run-Node @('checks/build.mjs')
    Expect-Node-Failure @('checks/links.mjs')
    Write-Output 'PASS demo: initial link check FAILS as designed'
    $source = Join-Path $demo 'site/index.html'
    $fixed = [IO.File]::ReadAllText($source).Replace('href="missing.html"', 'href="about.html#purpose"')
    [IO.File]::WriteAllText($source, $fixed)
    Run-Node @('checks/build.mjs')
    Run-Node @('checks/links.mjs')
    [IO.File]::WriteAllText((Join-Path $demo 'dist/index.html'), '<!doctype html><html><a href="absent.html">Missing</a></html>')
    Expect-Node-Failure @('checks/links.mjs')
  } finally { Pop-Location }
  Run-Node @((Join-Path $root 'tools/board.mjs'), $root)
  Write-Output 'PASS demo: offline build, links, and board'
  Write-Output 'PASS negative: broken local link fails'

  $bad = Join-Path $Tmp 'missing-check.md'
  [IO.File]::WriteAllText($bad, "# missing`n`n## 1. Broken`n- **Want:** Example`n- **Now:** New`n- **Next:** Fix`n")
  Expect-Node-Failure @((Join-Path $Repo 'tools/check-goals.mjs'), $bad)
  Write-Output 'PASS negative: missing Check fails'
  Write-Output 'PASS clean-install.ps1'
} finally {
  Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
