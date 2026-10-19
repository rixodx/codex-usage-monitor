@echo off
setlocal
cd /d "%~dp0"
set "WIDGET_CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%WIDGET_CSC%" set "WIDGET_CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%WIDGET_CSC%" (
    echo .NET Framework C# compiler was not found.
    exit /b 1
)
"%WIDGET_CSC%" /nologo /target:winexe /codepage:65001 /reference:System.Windows.Forms.dll /out:codex-usage-monitor.exe Launcher.cs DesktopIdentity.cs
exit /b %errorlevel%
