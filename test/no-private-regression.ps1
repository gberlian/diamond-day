# PowerShell 7+. Verify a planted literal is rejected by the native scanner.
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("arpe-private-" + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory((Join-Path $Tmp 'repo/test')) | Out-Null
try {
  [IO.File]::Copy((Join-Path $Repo 'test/no-private.ps1'), (Join-Path $Tmp 'repo/test/no-private.ps1'))
  [IO.File]::Copy((Join-Path $Repo 'test/deny-list.txt'), (Join-Path $Tmp 'repo/test/deny-list.txt'))
  $script = Join-Path $Tmp 'repo/test/no-private.ps1'
  & pwsh -NoProfile -File $script
  if ($LASTEXITCODE -ne 0) { throw 'Clean fixture failed' }
  $term = @([IO.File]::ReadAllLines((Join-Path $Tmp 'repo/test/deny-list.txt')) |
    Where-Object { $_.Trim().Length -gt 0 -and -not $_.TrimStart().StartsWith('#') })[0]
  if (-not $term) { throw 'Deny-list is empty' }
  $plantedDir = Join-Path $Tmp 'repo/ray with spaces'
  [IO.Directory]::CreateDirectory($plantedDir) | Out-Null
  [IO.File]::WriteAllText((Join-Path $plantedDir 'planted.txt'), ($term + "`r`n"))
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & pwsh -NoProfile -File $script 2>&1
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $oldPreference }
  if ($code -eq 0 -or -not (($out | Out-String).Contains('FAIL private: deny-list term'))) {
    throw 'Planted deny-list entry passed or did not report its failure'
  }
  Write-Output 'PASS regression: planted deny-list entry fails'
  Write-Output 'PASS no-private-regression.ps1'
} finally {
  Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
