@echo off
setlocal
cd /d "%~dp0"

rem Inicia el servidor en otra ventana
start "API Tareas" cmd /k "npm start"

rem Solo inicia el servidor (sin navegador)
