# PowerShell 7+. Equivalent content and filename checks to no-private.sh.
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$denyFile = Join-Path $Repo 'test/deny-list.txt'
$failed = $false

$patterns = @(
  @{ Label = 'Windows user folders'; Regex = '([A-Za-z]:[\\/](Users|Documents and Settings)[\\/][^\s"<>]+)' },
  @{ Label = 'email addresses'; Regex = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' },
  @{ Label = 'IPv4 addresses'; Regex = '(^|[^0-9])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9]|$)' },
  @{ Label = 'wallet-shaped base58 strings'; Regex = '(^|[^a-zA-Z0-9])[1-9A-HJ-NP-Za-km-z]{32,44}([^a-zA-Z0-9]|$)' },
  @{ Label = 'long hexadecimal identifiers'; Regex = '(^|[^0-9A-Fa-f])(0x)?[0-9A-Fa-f]{40,64}([^0-9A-Fa-f]|$)' }
)
$filenamePattern = '([A-Za-z]:[\\/](Users|Documents and Settings)[\\/])|(@[A-Za-z0-9.-]+[.][A-Za-z]{2,})'

try {
  if (-not [IO.File]::Exists($denyFile)) { throw 'deny-list.txt is missing' }
  $terms = @([IO.File]::ReadAllLines($denyFile) | ForEach-Object { $_.TrimEnd([char]13) } |
    Where-Object { $_.Trim().Length -gt 0 -and -not $_.TrimStart().StartsWith('#') })

  # Directory recursion is explicit to avoid traversing .git and junction loops.
  $files = [System.Collections.Generic.List[string]]::new()
  $pending = [System.Collections.Generic.Stack[string]]::new()
  $pending.Push($Repo)
  while ($pending.Count -gt 0) {
    $directory = $pending.Pop()
    foreach ($item in (Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)) {
      if ($item.PSIsContainer) {
        if ($item.Name -ne '.git' -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
          $pending.Push($item.FullName)
        }
      } elseif (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        $files.Add($item.FullName)
      }
    }
  }

  foreach ($file in $files) {
    $relative = [IO.Path]::GetRelativePath($Repo, $file)
    if ([regex]::IsMatch($relative, $filenamePattern)) {
      [Console]::Error.WriteLine("FAIL private: sensitive-looking filename: $relative")
      $failed = $true
    }
    # grep --binary-files=without-match ignores files containing NUL bytes.
    $bytes = [IO.File]::ReadAllBytes($file)
    if ([Array]::IndexOf($bytes, [byte]0) -ge 0) { continue }
    $content = [Text.Encoding]::UTF8.GetString($bytes)
    foreach ($pattern in $patterns) {
      if ([regex]::IsMatch($content, $pattern.Regex)) {
        [Console]::Error.WriteLine("FAIL private: $($pattern.Label): $relative")
        $failed = $true
      }
    }
    if ([IO.Path]::GetFullPath($file) -ne [IO.Path]::GetFullPath($denyFile)) {
      foreach ($term in $terms) {
        if ($content.IndexOf($term, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
          [Console]::Error.WriteLine("FAIL private: deny-list term: $relative")
          $failed = $true
          break
        }
      }
    }
  }
} catch {
  [Console]::Error.WriteLine("FAIL private: scan error: $($_.Exception.Message)")
  exit 2
}

if ($failed) { exit 1 }
Write-Output 'PASS no-private.ps1: no user paths, addresses, wallet-like strings, or deny-list terms'
