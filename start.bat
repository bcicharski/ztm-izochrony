@echo off
rem Uruchamia lokalny serwer i otwiera strone w przegladarce.
cd /d "%~dp0"
rem przegladarka startuje z 2-sekundowym opoznieniem, zeby serwer zdazyl wstac
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8123"
node tools\serve.mjs
