@echo off
cd /d "%~dp0"
echo.
echo  🌿 启动情侣网站...
echo.
start http://localhost:3000
node server.js
pause
