param(
  [Parameter(Mandatory=$true)][ValidateSet('protect','unprotect')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$In,
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
try {
  if ($Mode -eq 'protect') {
    if (-not $Out) { throw 'protect 需要 -Out' }
    $plain = [System.IO.File]::ReadAllText($In, [System.Text.Encoding]::UTF8)
    $sec = ConvertTo-SecureString -String $plain -AsPlainText -Force
    $enc = ConvertFrom-SecureString -SecureString $sec
    [System.IO.File]::WriteAllText($Out, $enc, [System.Text.Encoding]::ASCII)
    Write-Output 'OK'
  } else {
    $enc = [System.IO.File]::ReadAllText($In, [System.Text.Encoding]::ASCII)
    $sec = ConvertTo-SecureString -String $enc
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try {
      $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
      [Console]::Out.Write($plain)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
