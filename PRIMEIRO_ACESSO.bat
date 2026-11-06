@echo off
setlocal
title BioMonitor - Primeiro Acesso
cd /d "%~dp0"
rem Libera o Git somente para esta pasta de rede, no usuario que executar este arquivo
set "PASTA=%%(prefix)///u01vfs062/backup$/Agricola/PDTA - Pesquisa & Desenvolvimento/20 - Projeto BioMonitor/01_BioMonitor"

echo ================================================================================
echo             BioMonitor - PRIMEIRO ACESSO NESTE COMPUTADOR
echo ================================================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  color 0C
  echo [ERRO] O Git nao esta instalado neste computador.
  echo        Instale em https://git-scm.com e execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if not errorlevel 1 (
  echo [OK] Este computador ja estava liberado.
  goto FIM
)

echo [*] Liberando o Git para a pasta do BioMonitor...
git config --global --add safe.directory "%PASTA%"
if errorlevel 1 (
  color 0C
  echo [ERRO] Nao foi possivel liberar o acesso.
  echo.
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  color 0C
  echo [ERRO] O Git ainda nao reconhece esta pasta. Avise o administrador.
  echo.
  pause
  exit /b 1
)

:FIM
color 0A
echo.
echo ================================================================================
echo   [CONCLUIDO] Acesso liberado. Agora use o MENU_MONITORAMENTO.bat.
echo   Se for o primeiro uso, rode a opcao [7] do menu para instalar as bibliotecas.
echo ================================================================================
echo.
pause
