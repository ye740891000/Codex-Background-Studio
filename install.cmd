@echo off
node "%~dp0plugins\codex-background-studio\scripts\studio-cli.mjs" install %*
if errorlevel 1 pause
