@echo off
setlocal
REM ============================================================
REM  Antigravity Daddy 启动入口（不修改官方任何文件）
REM  关键：清掉可能被 IDE/Agent 终端注入的 ELECTRON_RUN_AS_NODE，
REM        否则 Antigravity.exe 会以纯 Node 模式启动并立即退出。
REM ============================================================
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="

set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
  if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
)

cd /d "%~dp0"
echo [Antigravity Daddy] 使用 Node: %NODE_EXE%
"%NODE_EXE%" src\launcher.js %*
if errorlevel 1 pause
endlocal
