$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('arpe-' + [Guid]::NewGuid().ToString('N'))
$oldHome = $env:HOME; $oldPath = $env:Path; $oldRoot = $env:RAYS_ROOT; $oldPort = $env:RAY_BOARD_PORT; $oldTest = $env:RAY_TEST_NO_USER_PATH; $oldUserPath = [Environment]::GetEnvironmentVariable('Path','User')
$env:HOME = Join-Path $tmp 'home with spaces'; New-Item -ItemType Directory -Force -Path $env:HOME | Out-Null
$env:RAYS_ROOT = $null; $env:RAY_TEST_NO_USER_PATH = $null
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0); $listener.Start(); $env:RAY_BOARD_PORT = [string]$listener.LocalEndpoint.Port; $listener.Stop()
$exe = (Get-Process -Id $PID).Path
$installer = Join-Path $repo 'install.ps1'
$watch = [Diagnostics.Stopwatch]::StartNew()
function Install-Run([string[]]$flags) {
  & $exe -NoProfile -ExecutionPolicy Bypass -File $installer @flags
  if ($LASTEXITCODE -ne 0) { throw "Installer exit $LASTEXITCODE" }
}
try {
  Install-Run @()
  $bin = Join-Path $env:HOME '.arpe/bin'; if (([Environment]::GetEnvironmentVariable('Path','User') -split ';') -notcontains $bin) { throw 'User PATH entry missing' }; $env:Path = "$bin;$oldPath"
  $arpe = (Get-Command arpe.cmd -ErrorAction Stop).Source
  if (@(& $arpe list) -notcontains 'demo' -or $LASTEXITCODE -ne 0) { throw 'Missing demo' }
  & $arpe new demo2 'A small demo'; if ($LASTEXITCODE -ne 0) { throw 'arpe new failed' }
  $settings = Get-Content -Raw (Join-Path $env:HOME '.arpe/settings.json') | ConvertFrom-Json
  foreach ($name in @('demo','demo2')) {
    Write-Output "RPM check: $name"
    $rtargs = @($settings.runtimeArgs)
    & $settings.runtime @rtargs (Join-Path $repo 'tools/rpm-check.ts') (Join-Path $env:HOME "rays/$name")
    if ($LASTEXITCODE -ne 0) { throw "RPM check failed: $name" }
  }
  $base = "http://localhost:$env:RAY_BOARD_PORT"
  $page = Invoke-WebRequest -UseBasicParsing "$base/board"
  if ($page.StatusCode -ne 200 -or $page.Content -notmatch '/board/p/demo"' -or $page.Content -notmatch '/board/p/demo2"') { throw 'Board listing missing' }
  $data = Invoke-RestMethod "$base/api/board/projects"
  if ((($data.projects.ray | Sort-Object) -join ',') -ne 'demo,demo2') { throw 'Unexpected projects' }
  foreach ($name in @('demo','demo2')) {
    if ((Invoke-WebRequest -UseBasicParsing "$base/board/p/$name").StatusCode -ne 200) { throw 'Project page failed' }
    $p = Invoke-RestMethod "$base/api/board/project/$name"
    if ($p.results[0].cards.Count -ne 3 -or -not $p.results[0].cards[0].must) { throw 'Cards missing' }
  }
  $check = Invoke-RestMethod "$base/api/board/project/demo/card?result=1&step=0&view=check"
  if ($check.last.state -ne 'pass') { throw 'Demo check did not pass' }
  Write-Output "PASS demo Check: $($check.last.output)"
  Write-Output 'PASS board: HTTP 200; projects demo, demo2; both RPM project pages and card APIs answer'
  $shareListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0); $shareListener.Start(); $sharePort = $shareListener.LocalEndpoint.Port; $shareListener.Stop()
  & $arpe share start $sharePort; if ($LASTEXITCODE -ne 0) { throw 'Sharing start failed' }
  $shareBase = 'http://' + (@(127,0,0,1) -join '.') + ":$sharePort"
  $sharePage = Invoke-WebRequest -UseBasicParsing "$base/board/sharing"
  if ($sharePage.StatusCode -ne 200) { throw 'Sharing page failed' }
  $denied = Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck "$shareBase/api/board"
  if ($denied.StatusCode -ne 404) { throw 'Owner API exposed on share listener' }
  $invite = (& $arpe share demo Guest viewer 1 | Select-Object -Last 1); if ($LASTEXITCODE -ne 0 -or $invite -notmatch '/join#demo/([A-Za-z0-9_-]{43})$') { throw 'Invite failed' }
  $inviteToken = $Matches[1]
  $shared = Invoke-RestMethod "$shareBase/c/demo/api" -Headers @{ Authorization = "Bearer $inviteToken" }
  if ($shared.ray -ne 'demo' -or $shared.role -ne 'viewer') { throw 'Invite scope failed' }
  Write-Output 'PASS sharing: owner page HTTP 200; share listener /api/board HTTP 404; viewer invitation works'
  Install-Run @('-Uninstall','-Purge')
  $answering = $false; try { $null = Invoke-WebRequest -UseBasicParsing "$base/board" -TimeoutSec 2; $answering = $true } catch {}
  if ($answering) { throw 'Board still answering' }
  $answering = $false; try { $null = Invoke-WebRequest -UseBasicParsing "$shareBase/join" -TimeoutSec 2; $answering = $true } catch {}
  if ($answering) { throw 'Share listener still answering' }
  if (@(Get-ChildItem -LiteralPath $env:HOME -Force).Count -ne 0) { throw 'HOME not empty after uninstall' }
  if (Test-Path -LiteralPath $arpe) { throw 'arpe wrapper remains' }
  if (([Environment]::GetEnvironmentVariable('Path','User') -split ';') -contains $bin) { throw 'User PATH entry remains' }
  if ($watch.Elapsed.TotalSeconds -ge 900) { throw 'Install test exceeded 15 minutes' }
  Write-Output "PASS clean-install.ps1: board stopped; empty HOME after uninstall; $($watch.Elapsed.TotalSeconds)s elapsed"
} finally {
  if (Test-Path -LiteralPath (Join-Path $env:HOME '.arpe')) { & $exe -NoProfile -ExecutionPolicy Bypass -File $installer -Uninstall -Purge }
  [Environment]::SetEnvironmentVariable('Path',$oldUserPath,'User')
  $env:HOME=$oldHome; $env:Path=$oldPath; $env:RAYS_ROOT=$oldRoot; $env:RAY_BOARD_PORT=$oldPort; $env:RAY_TEST_NO_USER_PATH=$oldTest
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
