@echo off
chcp 65001 >nul
echo ==========================================================
echo   Iniciando Espaco Isa - Clinica de Desenvolvimento Infantil
echo   Acesse no navegador: http://localhost:8000
echo ==========================================================
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000"
"C:\Users\Ledina\AppData\Local\Programs\Python\Python312\python.exe" "%~dp0app.py"
pause
