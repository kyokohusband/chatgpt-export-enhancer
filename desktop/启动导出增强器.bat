@echo off
rem Launcher for Export Enhancer GUI (source mode, no packaging).
rem ASCII only on purpose: keeps working under any console code page.
setlocal
chcp 65001 >nul 2>&1

set "APP=%~dp0"
if "%APP:~-1%"=="\" set "APP=%APP:~0,-1%"

rem venv: desktop\.venv-app, else one level up (project root)\.venv-app
set "VENV=%APP%\.venv-app"
if not exist "%VENV%\Scripts\pythonw.exe" if not exist "%VENV%\Scripts\python.exe" set "VENV=%APP%\..\.venv-app"

set "PY=%VENV%\Scripts\pythonw.exe"
if not exist "%PY%" set "PY=%VENV%\Scripts\python.exe"

if not exist "%PY%" (
    echo.
    echo [ERROR] Python venv not found:
    echo         %VENV%
    echo.
    echo Create it once with:
    echo         python -m venv "%VENV%"
    echo         "%VENV%\Scripts\python.exe" -m pip install tkinterdnd2
    echo.
    pause
    exit /b 1
)

start "" "%PY%" "%APP%\app\main.py" %*
exit /b 0
