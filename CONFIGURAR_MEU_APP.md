# Configuração do BioMonitor

## KoboToolbox

O formulário "Monitoramento de Sedes" está publicado no servidor `kf.kobotoolbox.org`, com envio
sem login liberado. O app e os scripts já estão ligados a ele.

O token fica em `scripts/.env`, que não vai para o GitHub. Se gerar um token novo, troque só o
texto depois de `KOBO_TOKEN=` dentro do arquivo, sem renomeá-lo, e atualize também o segredo no GitHub.

## GitHub

- Segredo `KOBO_TOKEN`: em Settings > Secrets and variables > Actions. O botão "Atualizar dados" precisa dele.
- Site: em Settings > Pages, a partir do branch `main`.

## Conferir

Pelo site publicado, faça uma vistoria de teste e veja se ela aparece nos dados do formulário no Kobo.
Esse teste é importante porque o envio não avisa quando o Kobo recusa uma vistoria.
