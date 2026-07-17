$ErrorActionPreference = 'Stop'

try {
  $node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $cli = Join-Path $PSScriptRoot 'scripts/studio-cli.mjs'
  & $node $cli install @args
  if ($LASTEXITCODE -ne 0) { throw "Installer exited with code $LASTEXITCODE" }
  exit 0
} catch {
  Write-Error "Installation failed: $($_.Exception.Message)"
  exit 1
}
