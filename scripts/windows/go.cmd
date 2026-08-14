@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" >C:\zenith-firstlogon.log 2>&1
