@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pi-team.ps1" %*
exit /b %ERRORLEVEL%
