-- =========================================================================
-- BIOMONITOR - 2/2: REGRAS DE ACESSO (rode depois do 01_estrutura.sql)
--
-- O proprio banco bloqueia cada linha: mesmo com erro no site, uma usina
-- nunca ve dados de outra. Pode rodar de novo quantas vezes quiser.
--
--   administrador (perfis.e_admin)  tudo
--   gestor                          ve, corrige vistorias e cadastra sedes
--   tecnico                         ve e lanca vistorias com fotos
--   leitor                          so ve
-- O papel vale para a usina do acesso, ou para todas da empresa se a usina
-- ficar vazia. Empresa ou usina desativada corta o acesso de todos (menos o admin).
-- =========================================================================

-- -------------------------------------------------------------------------
-- Funcoes usadas pelas regras
-- -------------------------------------------------------------------------
create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.e_admin from public.perfis p where p.id = auth.uid()), false)
$$;

create or replace function public.tem_acesso(
  p_usina uuid,
  p_papeis text[] default array['gestor', 'tecnico', 'leitor']
) returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (
    select 1
    from public.acessos a
    join public.empresas e on e.id = a.empresa_id and e.ativa
    join public.usinas u on u.empresa_id = a.empresa_id and u.ativa
    where a.usuario_id = auth.uid()
      and u.id = p_usina
      and (a.usina_id is null or a.usina_id = p_usina)
      and a.papel = any (p_papeis)
  )
$$;

-- Primeira pasta do caminho de uma foto no Storage = usina (texto invalido vira vazio)
create or replace function public.usina_do_caminho(p_caminho text)
returns uuid language plpgsql immutable set search_path = public as $$
begin
  return split_part(p_caminho, '/', 1)::uuid;
exception when others then
  return null;
end $$;

-- -------------------------------------------------------------------------
-- Permissoes gerais: visitante sem login nao acessa nada
-- -------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

-- O usuario so muda o proprio nome e matricula (nunca o e_admin)
revoke update on public.perfis from authenticated;
grant update (nome, matricula) on public.perfis to authenticated;

-- Historico e so leitura (quem grava sao os gatilhos)
revoke insert, update, delete, truncate on public.historico from authenticated;

alter table public.empresas  enable row level security;
alter table public.usinas    enable row level security;
alter table public.perfis    enable row level security;
alter table public.acessos   enable row level security;
alter table public.sedes     enable row level security;
alter table public.vistorias enable row level security;
alter table public.fotos     enable row level security;
alter table public.historico enable row level security;

-- -------------------------------------------------------------------------
-- Regras por tabela
-- -------------------------------------------------------------------------

-- empresas
drop policy if exists "ver empresas" on public.empresas;
create policy "ver empresas" on public.empresas for select to authenticated
  using (public.eh_admin() or exists (
    select 1 from public.acessos a where a.usuario_id = auth.uid() and a.empresa_id = empresas.id and empresas.ativa));
drop policy if exists "admin cuida das empresas" on public.empresas;
create policy "admin cuida das empresas" on public.empresas for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- usinas
drop policy if exists "ver usinas" on public.usinas;
create policy "ver usinas" on public.usinas for select to authenticated
  using (public.tem_acesso(id));
drop policy if exists "admin cuida das usinas" on public.usinas;
create policy "admin cuida das usinas" on public.usinas for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- perfis
drop policy if exists "ver perfis" on public.perfis;
create policy "ver perfis" on public.perfis for select to authenticated
  using (id = auth.uid() or public.eh_admin());
drop policy if exists "editar o proprio perfil" on public.perfis;
create policy "editar o proprio perfil" on public.perfis for update to authenticated
  using (id = auth.uid() or public.eh_admin()) with check (id = auth.uid() or public.eh_admin());

-- acessos
drop policy if exists "ver acessos" on public.acessos;
create policy "ver acessos" on public.acessos for select to authenticated
  using (usuario_id = auth.uid() or public.eh_admin());
drop policy if exists "admin cuida dos acessos" on public.acessos;
create policy "admin cuida dos acessos" on public.acessos for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- sedes
drop policy if exists "ver sedes" on public.sedes;
create policy "ver sedes" on public.sedes for select to authenticated
  using (public.tem_acesso(usina_id));
drop policy if exists "gestor cadastra sedes" on public.sedes;
create policy "gestor cadastra sedes" on public.sedes for insert to authenticated
  with check (public.tem_acesso(usina_id, array['gestor']));
drop policy if exists "gestor altera sedes" on public.sedes;
create policy "gestor altera sedes" on public.sedes for update to authenticated
  using (public.tem_acesso(usina_id, array['gestor'])) with check (public.tem_acesso(usina_id, array['gestor']));
drop policy if exists "admin apaga sedes" on public.sedes;
create policy "admin apaga sedes" on public.sedes for delete to authenticated
  using (public.eh_admin());

-- vistorias
drop policy if exists "ver vistorias" on public.vistorias;
create policy "ver vistorias" on public.vistorias for select to authenticated
  using (public.tem_acesso(usina_id));
drop policy if exists "lancar vistorias" on public.vistorias;
create policy "lancar vistorias" on public.vistorias for insert to authenticated
  with check (
    public.tem_acesso(usina_id, array['gestor', 'tecnico'])
    and (avaliador_id = auth.uid() or public.tem_acesso(usina_id, array['gestor'])));
drop policy if exists "gestor corrige vistorias" on public.vistorias;
create policy "gestor corrige vistorias" on public.vistorias for update to authenticated
  using (public.tem_acesso(usina_id, array['gestor'])) with check (public.tem_acesso(usina_id, array['gestor']));
drop policy if exists "admin apaga vistorias" on public.vistorias;
create policy "admin apaga vistorias" on public.vistorias for delete to authenticated
  using (public.eh_admin());

-- fotos (a vistoria precisa ser visivel e o arquivo precisa estar na pasta dela)
drop policy if exists "ver fotos" on public.fotos;
create policy "ver fotos" on public.fotos for select to authenticated
  using (exists (select 1 from public.vistorias v where v.id = fotos.vistoria_id));
drop policy if exists "enviar fotos" on public.fotos;
create policy "enviar fotos" on public.fotos for insert to authenticated
  with check (exists (
    select 1 from public.vistorias v
    where v.id = fotos.vistoria_id
      and public.tem_acesso(v.usina_id, array['gestor', 'tecnico'])
      and fotos.caminho like v.usina_id::text || '/' || v.id::text || '/%'));
drop policy if exists "gestor apaga fotos" on public.fotos;
create policy "gestor apaga fotos" on public.fotos for delete to authenticated
  using (exists (
    select 1 from public.vistorias v
    where v.id = fotos.vistoria_id and public.tem_acesso(v.usina_id, array['gestor'])));

-- historico
drop policy if exists "gestor ve o historico" on public.historico;
create policy "gestor ve o historico" on public.historico for select to authenticated
  using (public.eh_admin() or (usina_id is not null and public.tem_acesso(usina_id, array['gestor'])));

-- -------------------------------------------------------------------------
-- Storage: pasta privada "fotos", ate 1 MB por foto (o app reduz antes de enviar)
-- -------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 1048576, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "biomonitor: ver fotos" on storage.objects;
create policy "biomonitor: ver fotos" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and public.tem_acesso(public.usina_do_caminho(name)));
drop policy if exists "biomonitor: enviar fotos" on storage.objects;
create policy "biomonitor: enviar fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.tem_acesso(public.usina_do_caminho(name), array['gestor', 'tecnico']));
drop policy if exists "biomonitor: apagar fotos" on storage.objects;
create policy "biomonitor: apagar fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.tem_acesso(public.usina_do_caminho(name), array['gestor']));
