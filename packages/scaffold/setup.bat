@echo off

cd /D "%~dp0"

set configPath=%~1

call PowerShell.exe -ExecutionPolicy ByPass -Command "./setup.ps1 '%configPath%'"
