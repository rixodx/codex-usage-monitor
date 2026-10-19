@echo off
cd /d "%~dp0"
if exist "%~dp0codex-usage-monitor.exe" (
    start "" "%~dp0codex-usage-monitor.exe"
) else (
    powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Widget.ps1"
    if errorlevel 1 pause
)
