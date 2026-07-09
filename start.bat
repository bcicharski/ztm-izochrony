@echo off
rem Uruchamia lokalny serwer i otwiera strone w przegladarce.
cd /d "%~dp0"
start "" "http://localhost:8123"
node tools\serve.mjs
