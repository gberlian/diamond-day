# PowerShell 5.1+ and 7+. Use a child runtime so its files can be removed after exit.
$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
if ($args.Count -gt 0 -and $args[0] -eq '-Legacy') {
  $legacyArgs = @($args | Select-Object -Skip 1)
  & (Join-Path $source 'tools/install-legacy.ps1') @legacyArgs
  exit $LASTEXITCODE
}
if ($args -contains '-Help' -or $args -contains '--help') {
  Write-Output 'Usage: .\install.ps1 [-Root PATH] [-Port PORT] [-Ray NAME] [-Agent AGENT] | -Uninstall [-Purge] | -Legacy ...'; exit 0
}
$homeDir = if ($env:HOME) { $env:HOME } else { $env:USERPROFILE }
$managed = Join-Path $homeDir '.diamond-day'
$bin = Join-Path $managed 'bin'
$uninstall = ($args -contains '-Uninstall' -or $args -contains '--uninstall')
$settingsFile = Join-Path $managed 'settings.json'
if ($uninstall -and -not (Test-Path -LiteralPath $settingsFile)) {
  if (Test-Path -LiteralPath (Join-Path $managed '.bootstrap-owned')) { Remove-Item -LiteralPath $managed -Recurse -Force }
  Write-Output 'No installed board'; exit 0
}
if ((Test-Path -LiteralPath $managed) -and -not (Test-Path -LiteralPath $settingsFile) -and -not (Test-Path -LiteralPath (Join-Path $managed '.bootstrap-owned'))) { throw 'Existing unmanaged installation directory' }
$runtimeArgs = @()
if ($env:RAY_RUNTIME -eq 'node') {
  $runtime = (Get-Command node -ErrorAction Stop).Source
  $runtimeArgs = @('--experimental-strip-types','--disable-warning=ExperimentalWarning')
} else {
  $existing = Get-Command bun -ErrorAction SilentlyContinue
  if ($existing) { $runtime = $existing.Source }
  elseif (Test-Path -LiteralPath (Join-Path $managed 'bun/bin/bun.exe')) { $runtime = Join-Path $managed 'bun/bin/bun.exe' }
  elseif (Test-Path -LiteralPath (Join-Path $homeDir '.bun/bin/bun.exe')) { $runtime = Join-Path $homeDir '.bun/bin/bun.exe' }
  else {
    if ($uninstall) { throw 'Bun missing; use RAY_RUNTIME=node if Node 22 is installed' }
    if (-not (Test-Path -LiteralPath $managed)) { New-Item -ItemType Directory -Path $managed | Out-Null; New-Item -ItemType File -Path (Join-Path $managed '.bootstrap-owned') | Out-Null }
    $archive = Join-Path ([IO.Path]::GetTempPath()) ('diamond-bun-' + [Guid]::NewGuid().ToString('N') + '.zip')
    $staging = $archive + '.dir'
    try {
      $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64' } else { 'x64-baseline' }
      $asset = "bun-windows-$arch"
      Write-Output 'Installing Bun into the managed installation directory...'
      Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/oven-sh/bun/releases/latest/download/$asset.zip" -OutFile $archive -TimeoutSec 180
      Expand-Archive -LiteralPath $archive -DestinationPath $staging
      $target = Join-Path $managed 'bun/bin'; New-Item -ItemType Directory -Force -Path $target | Out-Null
      Copy-Item -LiteralPath (Join-Path $staging "$asset/bun.exe") -Destination $target
      $runtime = Join-Path $target 'bun.exe'
    } finally { Remove-Item -LiteralPath $archive,$staging -Recurse -Force -ErrorAction SilentlyContinue }
  }
}
& $runtime @runtimeArgs (Join-Path $source 'board/src/install.ts') @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# User PATH, not Machine PATH. Preserve unrelated entries. Tests can isolate it.
function Update-Path([string]$value, [bool]$remove) {
  $items = @($value -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $bin.TrimEnd('\') })
  if (-not $remove) { $items = @($bin) + $items }
  return ($items -join ';')
}
if ($env:RAY_TEST_NO_USER_PATH -ne '1') {
  $old = [Environment]::GetEnvironmentVariable('Path','User')
  [Environment]::SetEnvironmentVariable('Path',(Update-Path $old $uninstall),'User')
}
$env:Path = Update-Path $env:Path $uninstall
if ($uninstall -and (Test-Path -LiteralPath $managed)) { Remove-Item -LiteralPath $managed -Recurse -Force }
exit 0
