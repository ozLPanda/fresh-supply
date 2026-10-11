@echo off
rem START gives PowerShell its own console while this detached launcher waits.
rem Paths remain quoted environment data; delayed expansion is disabled by Node.
start "" /min /wait "%FRESH_SUPPLY_POWERSHELL%" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand %FRESH_SUPPLY_UPDATE_SCRIPT%
exit /b %errorlevel%
