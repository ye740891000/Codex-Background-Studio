@echo off
node "%~dp0plugins\codex-background-studio\scripts\studio-cli.mjs" uninstall %*
if errorlevel 1 pause
