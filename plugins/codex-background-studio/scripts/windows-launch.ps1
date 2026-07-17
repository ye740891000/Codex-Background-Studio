[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$InstallRoot,
  [Parameter(Mandatory)][string]$NodePath
)

$ErrorActionPreference = 'Stop'
$cli = Join-Path $InstallRoot 'scripts/studio-cli.mjs'

try { $Host.UI.RawUI.WindowTitle = 'Codex Background Studio' } catch {}

if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
  Write-Host "Node.js was not found at $NodePath" -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) {
  Write-Host "Codex Background Studio is not installed correctly: $cli" -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

& $NodePath $cli launch
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  Write-Host ''
  Write-Host 'Codex Background Studio could not start. The error is shown above.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
}
exit $exitCode
