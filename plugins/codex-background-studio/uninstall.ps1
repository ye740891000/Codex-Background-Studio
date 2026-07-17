$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction Stop).Source
& $node (Join-Path $PSScriptRoot 'scripts/studio-cli.mjs') uninstall @args
exit $LASTEXITCODE
