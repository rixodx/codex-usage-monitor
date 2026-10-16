@echo off
cd /d "%~dp0"
if exist "%~dp0CodexUsage_Monitor.exe" (
    start "" "%~dp0CodexUsage_Monitor.exe"
) else (
    powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Widget.ps1"
    if errorlevel 1 pause
)
