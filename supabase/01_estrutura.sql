-- =========================================================================
-- BIOMONITOR - 1/2: ESTRUTURA DO BANCO (Supabase: PostgreSQL + PostGIS)
--
-- Como rodar: Supabase > SQL Editor > New query > cole este arquivo > Run.
-- Pode rodar de novo sem perder dados: so cria o que ainda nao existe e
-- atualiza funcoes, gatilhos e telas de consulta.
--
-- Organizacao dos dados:
--   empresas (contratantes) > usinas > sedes > vistorias > fotos
-- Quem ve o que fica em "acessos" e e garantido pelo 02_acessos.sql.
-- =========================================================================

create extension if not exists postgis with schema extensions;

-- -------------------------------------------------------------------------
-- Tabelas
-- -------------------------------------------------------------------------
create table if not exists public.empresas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  cnpj       text,
  ativa      boolean not null default true,  -- false = contrato suspenso, ninguem da empresa entra
  criado_em  timestamptz not null default now()
);

create table if not exists public.usinas (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references public.empresas (id) on delete restrict,
  nome                  text not null,
  municipio             text,
  uf                    text,
  -- regras que antes ficavam em scripts/biomonitor_config.json, agora uma por usina
  verde_max_dias        int not null default 7,
  amarelo_max_dias      int not null default 15,
  distancia_max_metros  int not null default 500,
  inicio_monitoramento  date,  -- vistorias anteriores (testes) ficam fora do status
  ativa                 boolean not null default true,
  criado_em             timestamptz not null default now(),
  unique (id, empresa_id),
  check (verde_max_dias > 0 and amarelo_max_dias > verde_max_dias)
);

-- Um perfil por login (criado sozinho pelo gatilho ao_criar_usuario)
create table if not exists public.perfis (
  id         uuid primary key references auth.users (id) on delete cascade,
  nome       text,
  matricula  text,
  e_admin    boolean not null default false,  -- administrador do sistema (voce)
  criado_em  timestamptz not null default now()
);

-- Quem pode ver/lancar em qual empresa ou usina.
--   usina_id vazio = todas as usinas da empresa (ex.: gestor da contratante)
--   papel: gestor (ve, corrige e cadastra sedes), tecnico (ve e lanca vistorias), leitor (so ve)
create table if not exists public.acessos (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.perfis (id) on delete cascade,
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  usina_id    uuid,
  papel       text not null check (papel in ('gestor', 'tecnico', 'leitor')),
  criado_em   timestamptz not null default now(),
  -- a usina precisa ser da mesma empresa
  foreign key (usina_id, empresa_id) references public.usinas (id, empresa_id) on delete cascade
);
create unique index if not exists acessos_unico
  on public.acessos (usuario_id, empresa_id, coalesce(usina_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists acessos_usuario_idx on public.acessos (usuario_id);

create table if not exists public.sedes (
  id            uuid primary key default gen_random_uuid(),
  usina_id      uuid not null references public.usinas (id) on delete restrict,
  num_sede      text not null,
  nome          text not null,
  fa            text,
  fazenda       text,
  proprietario  text,
  regiao        text,
  local         extensions.geography(Point, 4326) not null,
  ativa         boolean not null default true,
  criado_em     timestamptz not null default now(),
  unique (usina_id, num_sede)
);
create index if not exists sedes_local_idx on public.sedes using gist (local);

create table if not exists public.vistorias (
  id                    uuid primary key default gen_random_uuid(),
  sede_id               uuid not null references public.sedes (id) on delete restrict,
  usina_id              uuid not null references public.usinas (id),  -- preenchido sozinho a partir da sede
  data_vistoria         date not null default (now() at time zone 'America/Sao_Paulo')::date,
  hora_vistoria         time,
  avaliador_id          uuid default auth.uid() references public.perfis (id) on delete set null,
  matricula             text,  -- vazio = usa a matricula do perfil de quem lancou
  pressao               text not null check (pressao in ('Baixa', 'Média', 'Alta')),
  bandeiras             int  not null check (bandeiras >= 0),
  larva_pupa            text not null check (larva_pupa in ('Ausência', 'Presença')),
  inseticida            text not null check (inseticida in ('Aplicado', 'Não Aplicado')),
  possiveis_causadores  text,
  observacoes           text,
  local_gps             extensions.geography(Point, 4326),  -- onde o celular estava ao lancar
  distancia_sede_m      numeric(10, 1),                      -- calculada sozinha
  alertas               text[] not null default '{}',        -- calculados sozinhos
  origem                text not null default 'app' check (origem in ('app', 'kobo', 'importacao')),
  kobo_id               bigint unique,
  criado_em             timestamptz not null default now()
);
create index if not exists vistorias_sede_data_idx on public.vistorias (sede_id, data_vistoria desc);
create index if not exists vistorias_usina_data_idx on public.vistorias (usina_id, data_vistoria desc);

-- Arquivo no Storage (bucket "fotos"), sempre em <usina_id>/<vistoria_id>/<arquivo>
create table if not exists public.fotos (
  id           uuid primary key default gen_random_uuid(),
  vistoria_id  uuid not null references public.vistorias (id) on delete cascade,
  campo        text not null check (campo in ('pressao', 'bandeiras', 'larva_pupa', 'inseticida', 'causador')),
  caminho      text not null unique,
  criado_em    timestamptz not null default now()
);
create index if not exists fotos_vistoria_idx on public.fotos (vistoria_id);

-- Quem criou, alterou ou apagou o que, e quando (preenchido so pelos gatilhos)
create table if not exists public.historico (
  id           bigint generated always as identity primary key,
  tabela       text not null,
  registro_id  uuid not null,
  usina_id     uuid,
  acao         text not null,
  antes        jsonb,
  depois       jsonb,
  usuario_id   uuid default auth.uid(),
  quando       timestamptz not null default now()
);
create index if not exists historico_registro_idx on public.historico (tabela, registro_id);
create index if not exists historico_usina_idx on public.historico (usina_id, quando desc);

-- -------------------------------------------------------------------------
-- Gatilhos
-- -------------------------------------------------------------------------

-- Cada login novo ganha um perfil
create or replace function public.criar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.criar_perfil();

-- Logins criados antes deste arquivo tambem ganham perfil
insert into public.perfis (id, nome)
select id, email from auth.users
on conflict (id) do nothing;

-- Antes de gravar uma vistoria: usina da sede, matricula, distancia e alertas.
-- A usina vem sempre da sede, entao ninguem consegue lancar em usina alheia trocando o campo.
create or replace function public.vistorias_preparar()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
begin
  select se.usina_id, se.local, u.distancia_max_metros into s
  from public.sedes se join public.usinas u on u.id = se.usina_id
  where se.id = new.sede_id;
  if not found then
    raise exception 'Sede % não encontrada', new.sede_id;
  end if;
  new.usina_id := s.usina_id;

  if coalesce(new.matricula, '') = '' and new.avaliador_id is not null then
    select p.matricula into new.matricula from public.perfis p where p.id = new.avaliador_id;
  end if;

  new.alertas := '{}';
  if new.local_gps is null then
    new.distancia_sede_m := null;
    new.alertas := array_append(new.alertas, 'Sem GPS de lançamento');
  else
    new.distancia_sede_m := round(st_distance(new.local_gps, s.local)::numeric, 1);
    if new.distancia_sede_m > s.distancia_max_metros then
      new.alertas := array_append(new.alertas,
        format('GPS a %s m da sede (limite %s m)', round(new.distancia_sede_m), s.distancia_max_metros));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists vistorias_preparar on public.vistorias;
create trigger vistorias_preparar before insert or update on public.vistorias
  for each row execute function public.vistorias_preparar();

create or replace function public.registrar_historico()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  antes  jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  depois jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  linha  jsonb := coalesce(depois, antes);
begin
  if tg_op = 'UPDATE' and antes = depois then
    return new;
  end if;
  insert into public.historico (tabela, registro_id, usina_id, acao, antes, depois)
  values (tg_table_name, (linha ->> 'id')::uuid, (linha ->> 'usina_id')::uuid, lower(tg_op), antes, depois);
  return coalesce(new, old);
end $$;

drop trigger if exists historico on public.vistorias;
create trigger historico after insert or update or delete on public.vistorias
  for each row execute function public.registrar_historico();
drop trigger if exists historico on public.sedes;
create trigger historico after insert or update or delete on public.sedes
  for each row execute function public.registrar_historico();
drop trigger if exists historico on public.acessos;
create trigger historico after insert or update or delete on public.acessos
  for each row execute function public.registrar_historico();

-- -------------------------------------------------------------------------
-- Telas de consulta para o site (respeitam as regras de acesso de quem consulta)
-- -------------------------------------------------------------------------

-- Ultima vistoria e status de cada sede (o que hoje o mapa monta a partir do dados_mapa.js)
create or replace view public.vw_status_sedes with (security_invoker = true) as
select
  s.id as sede_id, s.usina_id, u.empresa_id, u.nome as usina,
  s.num_sede, s.nome as nome_sede, s.fa, s.fazenda, s.proprietario, s.regiao,
  round(extensions.st_y(s.local::extensions.geometry)::numeric, 6) as lat,
  round(extensions.st_x(s.local::extensions.geometry)::numeric, 6) as lon,
  ult.id as vistoria_id, ult.data_vistoria, ult.hora_vistoria, ult.matricula,
  ult.pressao, ult.bandeiras, ult.larva_pupa, ult.inseticida,
  ult.possiveis_causadores, ult.observacoes, ult.alertas,
  d.dias as dias_vistoria,
  case
    when d.dias is null then 'vermelho'
    when d.dias <= u.verde_max_dias then 'verde'
    when d.dias <= u.amarelo_max_dias then 'amarelo'
    else 'vermelho'
  end as status_cor,
  case
    when d.dias is null then 'Vermelho (Sem Vistoria)'
    when d.dias <= u.verde_max_dias then format('Verde (<= %s dias)', u.verde_max_dias)
    when d.dias <= u.amarelo_max_dias then format('Amarelo (%s a %s dias)', u.verde_max_dias + 1, u.amarelo_max_dias)
    else format('Vermelho (>= %s dias)', u.amarelo_max_dias + 1)
  end as status_tematico
from public.sedes s
join public.usinas u on u.id = s.usina_id
left join lateral (
  select v.* from public.vistorias v
  where v.sede_id = s.id
    and (u.inicio_monitoramento is null or v.data_vistoria >= u.inicio_monitoramento)
  order by v.data_vistoria desc, v.hora_vistoria desc nulls last, v.criado_em desc
  limit 1
) ult on true
cross join lateral (
  -- greatest() ignora null: sem o "case", sede sem vistoria ficaria com 0 dias (verde)
  select case when ult.data_vistoria is not null
    then greatest(0, (now() at time zone 'America/Sao_Paulo')::date - ult.data_vistoria) end as dias
) d
where s.ativa;

-- Vistorias com dados da sede e coordenadas em numero (para relatorios e exportacao)
create or replace view public.vw_vistorias with (security_invoker = true) as
select
  v.id, v.usina_id, u.empresa_id, u.nome as usina, v.sede_id,
  s.num_sede, s.nome as nome_sede, s.fa, s.fazenda, s.proprietario, s.regiao,
  round(extensions.st_y(s.local::extensions.geometry)::numeric, 6) as lat_sede,
  round(extensions.st_x(s.local::extensions.geometry)::numeric, 6) as lon_sede,
  v.data_vistoria, v.hora_vistoria, v.avaliador_id, v.matricula,
  v.pressao, v.bandeiras, v.larva_pupa, v.inseticida, v.possiveis_causadores, v.observacoes,
  round(extensions.st_y(v.local_gps::extensions.geometry)::numeric, 6) as lat_gps,
  round(extensions.st_x(v.local_gps::extensions.geometry)::numeric, 6) as lon_gps,
  v.distancia_sede_m, v.alertas, v.origem, v.kobo_id, v.criado_em
from public.vistorias v
join public.sedes s on s.id = v.sede_id
join public.usinas u on u.id = v.usina_id;
