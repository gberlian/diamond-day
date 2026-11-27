# PowerShell 7; all installation and PATH changes are scoped to child processes.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$oldPath = $env:Path
$oldUserPath = if ($IsWindows) { [Environment]::GetEnvironmentVariable('Path','User') }
$code = 1
try {
  & node (Join-Path $repo 'test/lib/tutorial.mjs')
  $code = $LASTEXITCODE
} finally {
  $env:Path = $oldPath
  if ($IsWindows -and [Environment]::GetEnvironmentVariable('Path','User') -cne $oldUserPath) {
    # The installer is invoked with RAY_TEST_NO_USER_PATH=1; never overwrite
    # concurrent user changes. Treat any unexpected modification as a failure.
    Write-Error 'User PATH changed during recording; inspect before retrying.' -ErrorAction Continue
    $code = 1
  }
}
exit $code
