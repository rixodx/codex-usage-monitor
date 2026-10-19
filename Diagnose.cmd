@echo off
cd /d "%~dp0"
echo Starting codex-usage-monitor in diagnostic mode...
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Widget.ps1"
echo.
echo Exit code: %errorlevel%
pause
