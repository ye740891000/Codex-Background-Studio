[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('install', 'uninstall')][string]$Action,
  [Parameter(Mandatory)][string]$InstallRoot,
  [Parameter(Mandatory)][string]$NodePath
)

$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'
$shortcutNames = @('Codex Background Studio.lnk', 'Uninstall Codex Background Studio.lnk')

if ($Action -eq 'uninstall') {
  foreach ($folder in @($desktop, $startMenu)) {
    foreach ($name in $shortcutNames) { Remove-Item -LiteralPath (Join-Path $folder $name) -Force -ErrorAction SilentlyContinue }
  }
  exit 0
}

$shell = New-Object -ComObject WScript.Shell
$cli = Join-Path $InstallRoot 'scripts/studio-cli.mjs'
foreach ($folder in @($desktop, $startMenu)) {
  $launch = $shell.CreateShortcut((Join-Path $folder 'Codex Background Studio.lnk'))
  $launch.TargetPath = $NodePath
  $launch.Arguments = "`"$cli`" launch"
  $launch.WorkingDirectory = $InstallRoot
  $launch.Description = 'Launch the official Codex app with Codex Background Studio'
  $launch.Save()

  $remove = $shell.CreateShortcut((Join-Path $folder 'Uninstall Codex Background Studio.lnk'))
  $remove.TargetPath = $NodePath
  $remove.Arguments = "`"$cli`" uninstall"
  $remove.WorkingDirectory = $InstallRoot
  $remove.Description = 'Uninstall Codex Background Studio without changing Codex'
  $remove.Save()
}
