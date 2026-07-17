@echo off
node "%~dp0plugins\codex-background-studio\scripts\studio-cli.mjs" launch %*
if errorlevel 1 pause
