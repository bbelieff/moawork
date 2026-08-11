@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title 모아워크 작업 대시보드
echo.
echo   대시보드를 켭니다. 이 창을 닫으면 꺼집니다.
echo   브라우저에서  http://localhost:8787
echo.
node tools\dashboard-server.mjs
pause
