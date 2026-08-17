@echo off
setlocal
cd /d "%~dp0"

echo ==================================================
echo EduSearch AI - Full Backend Local Start
echo ==================================================

where node >nul 2>nul || (
  echo ERROR: Node.js 22.13 or newer is required.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -p "process.versions.node"') do set NODE_VERSION=%%v
echo Node: %NODE_VERSION%
node -e "const [a,b,c]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&(b>13||(b===13&&c>=0)))?0:1)" || (
  echo ERROR: Node.js 22.13 or newer is required. Installed: %NODE_VERSION%
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install --legacy-peer-deps --no-audit --no-fund || goto :error
)

call npm run setup || goto :error
call npm run dev
goto :eof

:error
echo.
echo EduSearch AI could not start. Review the error above.
pause
exit /b 1
