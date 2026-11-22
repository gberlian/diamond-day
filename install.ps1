# PowerShell 5.1+ / PowerShell 7+. Uses explicit parsing so -Ray may be repeated.
$ErrorActionPreference = 'Stop'
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootValue = './rays'
$agent = 'claude-code'
$demo = $false
$rays = [System.Collections.Generic.List[string]]::new()

function Usage {
  Write-Output 'Usage: .\install.ps1 [-Root PATH] [-Agent claude-code|codex|claude-desktop] [-Ray NAME ...] [-Demo]'
  Write-Output 'Creates missing files only. -Demo adds the executable demo ray.'
}
$index = 0
while ($index -lt $args.Count) {
  $arg = [string]$args[$index]
  switch -Regex ($arg) {
    '^(-Root|--root)$' {
      if ($index + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $rootValue = [string]$args[$index + 1]; $index += 2; break
    }
    '^(-Agent|--agent)$' {
      if ($index + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $agent = [string]$args[$index + 1]; $index += 2; break
    }
    '^(-Ray|--ray)$' {
      if ($index + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $rays.Add([string]$args[$index + 1]); $index += 2; break
    }
    '^(-Demo|--demo)$' { $demo = $true; $index++; break }
    '^(-Help|--help|-h)$' { Usage; exit 0 }
    default { throw "Unknown option: $arg" }
  }
}
switch ($agent) {
  'claude-code' { $ruleFile = 'CLAUDE.md' }
  'codex' { $ruleFile = 'AGENTS.md' }
  'claude-desktop' { $ruleFile = 'PROJECT-INSTRUCTIONS.md' }
  default { throw "Invalid agent: $agent" }
}
if ($rays.Count -eq 0 -and -not $demo) { $rays.Add('work') }
if ($demo) { $rays.Add('demo') }
foreach ($ray in $rays) {
  if ($ray -cnotmatch '^[a-z][a-z0-9-]*$') { throw "Invalid ray name: $ray" }
  if (@('tools','templates','plans','docs','decisions','handoffs') -ccontains $ray) {
    throw "Reserved ray name: $ray"
  }
}
if ([IO.Path]::IsPathRooted($rootValue)) { $RootDir = [IO.Path]::GetFullPath($rootValue) }
else { $RootDir = [IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $rootValue)) }
[IO.Directory]::CreateDirectory($RootDir) | Out-Null
$script:created = 0
$script:preserved = 0
$utf8 = [System.Text.UTF8Encoding]::new($false)

function Copy-Missing([string]$source, [string]$destination) {
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
  if ([IO.File]::Exists($destination) -or [IO.Directory]::Exists($destination)) {
    $script:preserved++; return
  }
  [IO.File]::Copy($source, $destination)
  $script:created++
}
function Render-Missing([string]$source, [string]$destination, [string]$ray) {
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
  if ([IO.File]::Exists($destination) -or [IO.Directory]::Exists($destination)) {
    $script:preserved++; return
  }
  $content = [IO.File]::ReadAllText($source).Replace('{{RAY_NAME}}', $ray)
  [IO.File]::WriteAllText($destination, $content, $utf8)
  $script:created++
}
foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $SourceDir 'templates') -File)) {
  Copy-Missing $file.FullName (Join-Path $RootDir ("templates/" + $file.Name))
}
foreach ($name in @('check-goals','check-rays','board','open-note')) {
  Copy-Missing (Join-Path $SourceDir ("tools/" + $name)) (Join-Path $RootDir ("tools/" + $name))
}
Copy-Missing (Join-Path $SourceDir 'templates/root-README.md') (Join-Path $RootDir 'README.md')
$raysFile = Join-Path $RootDir 'rays.txt'
if (-not [IO.File]::Exists($raysFile)) {
  Copy-Missing (Join-Path $SourceDir 'templates/rays.txt') $raysFile
}
function Add-ActiveRay([string]$ray) {
  $content = [IO.File]::ReadAllText($raysFile)
  $names = @($content -split '\r?\n' | ForEach-Object { $_.Trim() })
  if ($names -ccontains $ray) { return }
  if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) {
    [IO.File]::AppendAllText($raysFile, "`n", $utf8)
  }
  [IO.File]::AppendAllText($raysFile, ($ray + "`n"), $utf8)
}
function Make-Ray([string]$ray) {
  $dir = Join-Path $RootDir $ray
  foreach ($folder in @('plans','decisions','docs/goals','docs/changes','handoffs')) {
    [IO.Directory]::CreateDirectory((Join-Path $dir $folder)) | Out-Null
  }
  if ($ray -eq 'coordinator') {
    Copy-Missing (Join-Path $SourceDir 'templates/coordinator-README.md') (Join-Path $dir 'README.md')
    Copy-Missing (Join-Path $SourceDir 'templates/coordinator-GOALS.md') (Join-Path $dir 'GOALS.md')
    Copy-Missing (Join-Path $SourceDir 'templates/coordinator-inbox.md') (Join-Path $dir 'inbox.md')
    Copy-Missing (Join-Path $SourceDir 'templates/resume-note.md') (Join-Path $dir 'plans/resume.md')
  } elseif ($ray -eq 'demo' -and $demo) {
    $sampleDir = Join-Path $SourceDir 'examples/demo-ray'
    foreach ($file in (Get-ChildItem -LiteralPath $sampleDir -File -Recurse)) {
      $relative = $file.FullName.Substring($sampleDir.Length + 1)
      Copy-Missing $file.FullName (Join-Path $dir $relative)
    }
  } else {
    Render-Missing (Join-Path $SourceDir 'templates/ray-README.md') (Join-Path $dir 'README.md') $ray
    Render-Missing (Join-Path $SourceDir 'templates/GOALS.md') (Join-Path $dir 'GOALS.md') $ray
    Copy-Missing (Join-Path $SourceDir 'templates/resume-note.md') (Join-Path $dir 'plans/resume.md')
  }
  Copy-Missing (Join-Path $SourceDir 'templates/AGENTS-RULES.md') (Join-Path $dir $ruleFile)
  Add-ActiveRay $ray
}
Make-Ray 'coordinator'
foreach ($ray in $rays) {
  if ($ray -ne 'coordinator') { Make-Ray $ray }
}
$boardFile = Join-Path $RootDir 'board.html'
if (-not [IO.File]::Exists($boardFile) -and (Get-Command node -ErrorAction SilentlyContinue)) {
  & node (Join-Path $RootDir 'tools/board') $RootDir | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not generate initial board' }
  $script:created++
}
Write-Output "PASS install: agent=$agent root=$RootDir new=$script:created preserved=$script:preserved"
Write-Output "Next: Set-Location '$RootDir/demo' (if -Demo), or Set-Location '$RootDir/<ray>'"
Write-Output 'Run: node ../tools/check-goals GOALS.md; then run every Check listed in GOALS.md'
switch ($agent) {
  'claude-code' { Write-Output 'Start the ray agent with: claude' }
  'codex' { Write-Output 'Start the ray agent with: codex' }
  'claude-desktop' { Write-Output 'Create a Claude Desktop Project per ray; paste PROJECT-INSTRUCTIONS.md into its instructions.' }
}
Write-Output "Board: $boardFile (regenerate with node tools/board $RootDir)"
