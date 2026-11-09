# BioMonitor no Supabase

Banco de dados com login e separação por empresa e usina. Funciona no plano gratuito do Supabase.
Só passe para o plano pago quando o primeiro cliente fechar contrato.

| Arquivo | O que faz |
|---|---|
| `01_estrutura.sql` | Tabelas (empresas, usinas, sedes, vistorias, fotos, acessos, histórico), cálculo de distância e alertas, e as telas de status |
| `02_acessos.sql` | Regras de quem vê o quê, e a pasta privada de fotos (até 1 MB por foto) |
| `../scripts/gerar_sql_supabase.py` | Gera `dados_locais/supabase_dados_iniciais.sql` com a empresa e a usina de demonstração e as sedes atuais |

Os três arquivos podem ser rodados de novo sem perder nem duplicar dados.

## 1. Criar a conta e o projeto

1. Entre em **supabase.com** e clique em **Start your project**. Use sua conta pessoal do GitHub ou seu e-mail pessoal, nunca contas da empresa onde você trabalha.
2. Crie a organização **BioMonitor** no plano **Free**.
3. Crie o projeto:
   - **Name:** `biomonitor`
   - **Database Password:** clique em **Generate a password** e guarde no seu gerenciador de senhas. Não cole essa senha no chat.
   - **Region:** **South America (São Paulo)**

## 2. Criar o banco

No menu da esquerda, abra **SQL Editor** e clique em **New query**. Para cada arquivo abaixo, nesta ordem: abra o arquivo no Bloco de Notas, copie tudo (Ctrl+A, Ctrl+C), cole no editor e clique em **Run**.

1. `supabase/01_estrutura.sql`
2. `supabase/02_acessos.sql`. Se aparecer um aviso de operação destrutiva, confirme: ele só recria as regras.
3. `dados_locais/supabase_dados_iniciais.sql`. Se faltar, gere antes com `python scripts/gerar_sql_supabase.py`.

Cada um deve terminar com **Success. No rows returned**.

## 3. Criar o seu login de administrador

1. Abra **Authentication > Users > Add user > Create new user**, informe seu e-mail e uma senha e marque **Auto Confirm User**.
2. Volte ao **SQL Editor**, troque o e-mail abaixo pelo seu e clique em **Run**:

```sql
update public.perfis set e_admin = true
where id = (select id from auth.users where email = 'SEU_EMAIL_AQUI');
```

## 4. Conferir

Em **Table Editor**, a tabela `sedes` deve ter 24 linhas e `usinas` deve ter a "Usina Demonstração - Araçatuba".

## Chaves do projeto

Em **Project Settings > API Keys** existem dois tipos de chave:

- **Publishable** (ou *anon*): vai no site. Ela é pública por natureza, e quem protege os dados são as regras do `02_acessos.sql`.
- **Secret** (ou *service_role*): passa por cima de todas as regras. Nunca coloque essa chave no site, no GitHub nem no chat.

## Como funcionam os acessos

- **Empresa > usinas > sedes > vistorias > fotos.** Cada vistoria pertence à usina da sua sede.
- Na tabela `acessos`, cada linha dá a um usuário um papel em uma empresa: **gestor**, **tecnico** ou **leitor**. Se a usina ficar vazia, o papel vale para todas as usinas da empresa.
- Se você marcar `ativa = false` em uma empresa ou usina, ninguém dela entra mais (por exemplo, com o contrato suspenso). Os dados continuam guardados.
- Toda criação, correção ou exclusão de vistoria, sede ou acesso fica registrada em `historico`, com quem fez e quando.

## Plano gratuito

- O projeto pausa depois de cerca de uma semana sem uso. Os dados não se perdem: para reativar, clique em **Restore** no painel. Antes de uma demonstração, confira se ele está ativo.
- As fotos acima de 1 MB são recusadas. O app vai reduzir as fotos antes de enviar, o que é a próxima etapa.
