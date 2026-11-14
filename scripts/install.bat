@echo off
rem Copies the script to Documents\GroceryCompare, runs it once, and schedules it daily at 07:30.
set "DIR=%USERPROFILE%\Documents\GroceryCompare"
if not exist "%DIR%" mkdir "%DIR%"
copy /Y "%~dp0get-prices.ps1" "%DIR%\get-prices.ps1" >nul
echo Downloading prices...
powershell -NoProfile -ExecutionPolicy Bypass -File "%DIR%\get-prices.ps1"
schtasks /Create /F /SC DAILY /ST 07:30 /TN "GroceryCompare prices" /TR "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%DIR%\get-prices.ps1\"" >nul
echo.
echo Done. Prices will update automatically every day at 07:30.
pause
