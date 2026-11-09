-- =========================================================================
-- BIOMONITOR - EXEMPLO PARA DEMONSTRAÇÃO (dados fictícios)
--
--   Usina A > Unidade Araçatuba (sedes já cadastradas) e Unidade Birigui
--   Usina B > Unidade Penápolis
--
-- Gera cerca de dois meses de vistorias com status variados (em dia, atenção,
-- atrasada e sem vistoria), pontos de pressão alta e alguns alertas de GPS.
-- Rode depois de 01, 02 e dos dados iniciais. Pode rodar de novo: as vistorias
-- de exemplo (origem 'importacao') são apagadas e geradas outra vez.
-- =========================================================================
begin;

-- Empresas e unidades -------------------------------------------------------
insert into public.empresas (id, nome) values
  ('b10b0000-0000-4000-8000-000000000001', 'Usina A'),
  ('b10b0000-0000-4000-8000-000000000003', 'Usina B')
on conflict (id) do update set nome = excluded.nome;

insert into public.usinas (id, empresa_id, nome, municipio, uf, inicio_monitoramento) values
  ('b10b0000-0000-4000-8000-000000000002', 'b10b0000-0000-4000-8000-000000000001', 'Unidade Araçatuba', 'Araçatuba', 'SP', '2026-09-01'),
  ('b10b0000-0000-4000-8000-000000000004', 'b10b0000-0000-4000-8000-000000000001', 'Unidade Birigui', 'Birigui', 'SP', '2026-09-01'),
  ('b10b0000-0000-4000-8000-000000000005', 'b10b0000-0000-4000-8000-000000000003', 'Unidade Penápolis', 'Penápolis', 'SP', '2026-09-01')
on conflict (id) do update set
  nome = excluded.nome, municipio = excluded.municipio, uf = excluded.uf,
  inicio_monitoramento = excluded.inicio_monitoramento;

-- Sedes das unidades novas ----------------------------------------------------
insert into public.sedes (usina_id, num_sede, nome, fa, fazenda, proprietario, regiao, local)
select u, n, n || ' - ' || prop, fa, faz, prop, reg,
       extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)::extensions.geography
from (values
  ('b10b0000-0000-4000-8000-000000000004'::uuid, '1',  '910001', 'SITIO BOA ESPERANCA',   'Joaquim Ribeiro',   'Birigui - Setor Norte', -21.2412, -50.3521),
  ('b10b0000-0000-4000-8000-000000000004'::uuid, '2',  '910002', 'FAZENDA SAO BENTO',     'Luzia Carvalho',    'Birigui - Setor Norte', -21.2335, -50.3198),
  ('b10b0000-0000-4000-8000-000000000004'::uuid, '3',  '910003', 'SITIO TRES MARIAS',     'Orlando Pires',     'Birigui - Setor Norte', -21.2508, -50.3756),
  ('b10b0000-0000-4000-8000-000000000004'::uuid, '4',  '910004', 'FAZENDA PALMITAL',      'Celina Duarte',     'Birigui - Setor Leste', -21.2751, -50.2989),
  ('b10b0000-0000-4000-8000-000000000004'::uuid, '5',  '910005', 'SITIO RECREIO',         'Matias Fonseca',    'Birigui - Setor Leste', -21.2967, -50.3052),
  ('b10b0000-0000-4000-8000-000000000004'::uuid, '6',  '910006', 'ESTANCIA SANTA CLARA',  'Rosana Mendes',     'Birigui - Setor Leste', -21.3124, -50.2915),
  ('b10b0000-0000-4000-8000-000000000004'::uuid, '7',  '910007', 'FAZENDA BOA VISTA',     'Ivo Cardoso',       'Birigui - Setor Sul',   -21.3302, -50.3311),
  ('b10b0000-0000-4000-8000-000000000004'::uuid, '8',  '910008', 'SITIO CAPAO BONITO',    'Neusa Prado',       'Birigui - Setor Sul',   -21.3421, -50.3507),
  ('b10b0000-0000-4000-8000-000000000004'::uuid, '9',  '910009', 'FAZENDA SANTA RITA',    'Gilberto Assis',    'Birigui - Setor Sul',   -21.3288, -50.3698),
  ('b10b0000-0000-4000-8000-000000000004'::uuid, '10', '910010', 'SITIO PAU DALHO',       'Vera Toledo',       'Birigui - Setor Oeste', -21.2976, -50.3889),
  ('b10b0000-0000-4000-8000-000000000004'::uuid, '11', '910011', 'FAZENDA CORREGO FUNDO', 'Ademir Lopes',      'Birigui - Setor Oeste', -21.2793, -50.4012),
  ('b10b0000-0000-4000-8000-000000000004'::uuid, '12', '910012', 'SITIO BELA VISTA',      'Marta Siqueira',    'Birigui - Setor Oeste', -21.3059, -50.4104),
  ('b10b0000-0000-4000-8000-000000000005'::uuid, '1',  '920001', 'FAZENDA SANTA FE',      'Otávio Brandão',    'Penápolis - Setor Norte', -21.3812, -50.0921),
  ('b10b0000-0000-4000-8000-000000000005'::uuid, '2',  '920002', 'SITIO AGUA LIMPA',      'Cleide Moraes',     'Penápolis - Setor Norte', -21.3745, -50.0603),
  ('b10b0000-0000-4000-8000-000000000005'::uuid, '3',  '920003', 'FAZENDA CACHOEIRA',     'Renato Faria',      'Penápolis - Setor Norte', -21.3920, -50.0388),
  ('b10b0000-0000-4000-8000-000000000005'::uuid, '4',  '920004', 'SITIO SAO JOSE',        'Albertina Reis',    'Penápolis - Setor Leste', -21.4105, -50.0298),
  ('b10b0000-0000-4000-8000-000000000005'::uuid, '5',  '920005', 'ESTANCIA RIO DOURADO',  'Hélio Batista',     'Penápolis - Setor Leste', -21.4337, -50.0412),
  ('b10b0000-0000-4000-8000-000000000005'::uuid, '6',  '920006', 'FAZENDA LAGOA SECA',    'Sueli Antunes',     'Penápolis - Setor Sul',   -21.4561, -50.0655),
  ('b10b0000-0000-4000-8000-000000000005'::uuid, '7',  '920007', 'SITIO SERRINHA',        'Valter Queiroz',    'Penápolis - Setor Sul',   -21.4628, -50.0897),
  ('b10b0000-0000-4000-8000-000000000005'::uuid, '8',  '920008', 'FAZENDA MONTE ALEGRE',  'Irene Coutinho',    'Penápolis - Setor Sul',   -21.4489, -50.1123),
  ('b10b0000-0000-4000-8000-000000000005'::uuid, '9',  '920009', 'SITIO RIBEIRAO CLARO',  'Durval Simões',     'Penápolis - Setor Oeste', -21.4250, -50.1290),
  ('b10b0000-0000-4000-8000-000000000005'::uuid, '10', '920010', 'FAZENDA ESPIGAO',       'Lourdes Viana',     'Penápolis - Setor Oeste', -21.4017, -50.1186)
) as t(u, n, fa, faz, prop, reg, lat, lon)
on conflict (usina_id, num_sede) do update set
  nome = excluded.nome, fa = excluded.fa, fazenda = excluded.fazenda,
  proprietario = excluded.proprietario, regiao = excluded.regiao, local = excluded.local;

-- Vistorias de exemplo ----------------------------------------------------------
delete from public.vistorias
where origem = 'importacao'
  and usina_id in ('b10b0000-0000-4000-8000-000000000002', 'b10b0000-0000-4000-8000-000000000004', 'b10b0000-0000-4000-8000-000000000005');

with perfil as (
  -- Por sede: há quantos dias foi a última visita (vazio = nunca) e se é um foco de mosca
  select s.id as sede_id, s.local,
         case when s.r < 0.10 then null
              when s.r < 0.62 then floor(random() * 7)::int
              when s.r < 0.82 then 8 + floor(random() * 8)::int
              else 16 + floor(random() * 20)::int end as ultimo_ha,
         random() < 0.25 as foco
  from (select id, local, random() as r from public.sedes
        where usina_id in ('b10b0000-0000-4000-8000-000000000002', 'b10b0000-0000-4000-8000-000000000004', 'b10b0000-0000-4000-8000-000000000005')) s
),
visitas as (
  -- Uma visita por semana para trás a partir da última, com folgas e faltas
  select p.sede_id, p.local, p.foco, g.n,
         (now() at time zone 'America/Sao_Paulo')::date - p.ultimo_ha - g.n * 7
           - case when g.n = 0 then 0 else floor(random() * 3)::int end as data,
         random() as falta
  from perfil p cross join generate_series(0, 12) as g(n)
  where p.ultimo_ha is not null
),
base as (
  select v.*, random() as rp, random() as rb, random() as rl, random() as ri, random() as rc,
         random() as ro, random() as rg, random() as rm, random() as rh
  from visitas v
  where v.data >= date '2026-09-01' and (v.n = 0 or v.falta > 0.15)
)
insert into public.vistorias (sede_id, data_vistoria, hora_vistoria, matricula, pressao, bandeiras,
                              larva_pupa, inseticida, possiveis_causadores, observacoes, local_gps, origem)
select b.sede_id, b.data,
       make_time(7 + floor(b.rh * 9)::int, floor(random() * 60)::int, 0),
       (array['1021', '1047', '2103', '2156', '3012'])[1 + floor(b.rm * 5)::int],
       p.pressao,
       case p.pressao when 'Baixa' then floor(b.rb * 3)::int
                      when 'Média' then 2 + floor(b.rb * 6)::int
                      else 6 + floor(b.rb * 14)::int end,
       case when (p.pressao = 'Alta' and b.rl < 0.7) or (p.pressao = 'Média' and b.rl < 0.35) or b.rl < 0.08
            then 'Presença' else 'Ausência' end,
       case when (p.pressao = 'Alta' and b.ri < 0.75) or (p.pressao = 'Média' and b.ri < 0.3)
            then 'Aplicado' else 'Não Aplicado' end,
       case when p.pressao = 'Baixa' and b.rc < 0.6 then null
            when b.rc < 0.45 then 'Vinhaça'
            when b.rc < 0.8 then 'Torta'
            else 'Outro: Esterco bovino' end,
       case when b.ro < 0.08 then 'Moradores relatam aumento de moscas no fim da tarde.'
            when b.ro < 0.14 then 'Acúmulo de torta próximo ao curral.'
            when b.ro < 0.18 then 'Bandeiras repostas nesta visita.' end,
       -- GPS perto da sede; em ~5% das visitas, longe dela (gera o alerta de distância)
       extensions.st_project(b.local,
         case when b.rg < 0.05 then 600 + b.rg * 20000 else b.rg * 150 end,
         radians(random() * 360)),
       'importacao'
from base b
cross join lateral (
  select case when b.foco then (case when b.rp < 0.2 then 'Baixa' when b.rp < 0.55 then 'Média' else 'Alta' end)
              else (case when b.rp < 0.6 then 'Baixa' when b.rp < 0.9 then 'Média' else 'Alta' end) end as pressao
) p;

commit;

-- Resumo por unidade
select u.nome as unidade, e.nome as usina,
       (select count(*) from public.sedes s where s.usina_id = u.id) as sedes,
       (select count(*) from public.vistorias v where v.usina_id = u.id) as vistorias,
       (select count(*) from public.vw_status_sedes st where st.usina_id = u.id and st.status_cor = 'verde') as em_dia,
       (select count(*) from public.vw_status_sedes st where st.usina_id = u.id and st.status_cor = 'amarelo') as atencao,
       (select count(*) from public.vw_status_sedes st where st.usina_id = u.id and st.status_cor = 'vermelho') as atrasadas
from public.usinas u join public.empresas e on e.id = u.empresa_id
order by e.nome, u.nome;
