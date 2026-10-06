@echo off
rem faamoffice launcher for the packaged Windows app: <install>\resources\cli\faamoffice.cmd
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\FaamOffice.exe" "%~dp0genoffice.cjs" %*
endlocal
