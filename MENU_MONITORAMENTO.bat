@echo off
setlocal
title BioMonitor - Monitoramento de Sedes
cd /d "%~dp0"
set "SITE=https://petersonsouza81-rgb.github.io/biomonitor"

:MENU
cls
color 0A
echo ================================================================================
echo             BioMonitor - MONITORAMENTO DE SEDES (ROTINA DE VISTORIAS)
echo ================================================================================
echo.
echo   [1] Atualizar tudo e publicar (Kobo, fotos, mapa, Excel e app do celular)
echo   [2] Abrir Relatorios (executivo com Calor e Retorno e por sede - salvar PDF)
echo   [3] Abrir Mapa de Campo
echo   [4] Abrir Manuais (gestao e guia da equipe de campo)
echo   [5] Abrir KoboToolbox (dados na nuvem)
echo   [6] Abrir Projeto no QGIS (BioMonitor.qgz)
echo   [7] Instalar/atualizar bibliotecas Python (primeiro uso)
echo   [0] Sair
echo.
echo ================================================================================
echo.
choice /C 12345670 /N /M "Pressione um numero de 0 a 7: "

if errorlevel 8 goto OP_SAIR
if errorlevel 7 goto OP_DEPS
if errorlevel 6 goto OP_QGIS
if errorlevel 5 goto OP_KOBO
if errorlevel 4 goto OP_MANUAIS
if errorlevel 3 goto OP_MAPAS
if errorlevel 2 goto OP_RELATORIOS
if errorlevel 1 goto OP_ATUALIZAR
goto MENU

:OP_ATUALIZAR
cls
color 0B
echo ================================================================================
echo   [1] ATUALIZANDO TUDO E PUBLICANDO (KOBO, FOTOS, MAPA, EXCEL E SITE)...
echo ================================================================================
echo.
rem So o branch main vai para o site; em outro branch o envio nao atualiza nada
for /f "tokens=*" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="main" (
  color 0C
  echo [ERRO] Este computador esta no branch "%BRANCH%", nao no "main".
  echo        Publicar daqui NAO atualiza o site. Volte para o main e tente de novo.
  pause
  goto MENU
)
echo [*] Baixando atualizacoes feitas online (botao "Atualizar dados")...
git pull --rebase --autostash -q origin main
if errorlevel 1 (
  color 0C
  echo [ERRO] Nao foi possivel sincronizar com o GitHub. Verifique a internet e tente novamente.
  pause
  goto MENU
)
echo [*] Baixando vistorias e fotos do KoboToolbox e gerando mapa e Excel...
python "scripts\atualizar_base_web.py"
if errorlevel 1 (
  color 0C
  echo.
  echo [ERRO] A atualizacao da base falhou. Nada foi publicado.
  pause
  goto MENU
)
echo.
echo [*] Verificando arquivos alterados...
rem A planilha completa (com matriculas) fica so neste computador
git rm --cached --ignore-unmatch -q "relatorios e formularios/Visitas_Monitoramento_Sedes_Kobo.xlsx" >nul 2>&1
git add -A
git status -s
git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo [INFO] Nenhuma alteracao para publicar. O Excel local foi atualizado.
  pause
  goto MENU
)
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-Date -Format 'dd/MM/yyyy HH:mm'"') do set "DATAHORA=%%i"
git commit -q -m "Atualizacao da base BioMonitor - %DATAHORA%"
echo.
echo [*] Enviando atualizacoes para o GitHub...
git push origin main
if errorlevel 1 (
  color 0C
  echo.
  echo ================================================================================
  echo   [ERRO] O envio para o GitHub FALHOU. O app do celular NAO foi atualizado.
  echo   Verifique a internet e o login do Git e tente a opcao [1] novamente.
  echo ================================================================================
  pause
  goto MENU
)
echo.
echo ================================================================================
echo   [CONCLUIDO] Base atualizada e publicada no GitHub em %DATAHORA%.
echo   Excel consolidado: relatorios e formularios\Visitas_Monitoramento_Sedes_Kobo.xlsx
echo   Em alguns minutos o app do celular recebe a nova versao automaticamente.
echo ================================================================================
pause
goto MENU

:OP_RELATORIOS
cls
echo ================================================================================
echo             BioMonitor - RELATORIOS ONLINE (EXECUTIVO E POR SEDE)
echo ================================================================================
echo.
echo Links para qualquer pessoa (celular, computador e WhatsApp):
echo   Executivo: %SITE%/relatorio.html
echo   Por sede : %SITE%/relatorio_sede.html
echo.
echo Nos relatorios, "Atualizar dados" busca vistorias e fotos novas do Kobo.
echo No relatorio por sede, escolha a sede e clique em "Salvar PDF".
echo.
start "" "%SITE%/relatorio.html"
start "" "%SITE%/relatorio_sede.html"
echo Pronto!
timeout /t 4 > nul
goto MENU

:OP_MAPAS
cls
echo Abrindo o Mapa de Campo...
start "" "%SITE%/"
echo Pronto!
timeout /t 3 > nul
goto MENU

:OP_MANUAIS
cls
echo Abrindo o Manual de Gestao e o Guia da Equipe de Campo...
start "" "manual.html"
start "" "guia_campo.html"
echo Pronto!
timeout /t 3 > nul
goto MENU

:OP_KOBO
cls
echo Abrindo tabela de dados no KoboToolbox na nuvem...
start "" "https://kf.kobotoolbox.org/#/forms/aK9E8d8UZ5XkKCXqwWnmpG/data/table"
echo Abrindo navegador!
timeout /t 2 > nul
goto MENU

:OP_QGIS
cls
echo Abrindo o projeto BioMonitor.qgz no QGIS...
start "" "banco de dados geograficos\BioMonitor.qgz"
echo Projeto aberto!
timeout /t 2 > nul
goto MENU

:OP_DEPS
cls
echo ================================================================================
echo   [7] INSTALANDO BIBLIOTECAS PYTHON (requirements.txt)...
echo ================================================================================
python -m pip install -r requirements.txt
if not exist "scripts\.env" (
  echo.
  echo [ATENCAO] Falta o arquivo scripts\.env com o token do KoboToolbox.
  echo           Copie scripts\.env.example para scripts\.env e cole o token.
)
pause
goto MENU

:OP_SAIR
cls
endlocal
exit
