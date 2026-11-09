# -*- coding: utf-8 -*-
"""
Gera o SQL com os dados atuais do BioMonitor para carregar no Supabase.

Le as sedes de dados_mapa.js, as regras de biomonitor_config.json e as vistorias
do cache local (dados_locais/vistorias_completas.json, se houver) e grava
dados_locais/supabase_dados_iniciais.sql, que fica fora do GitHub.

Uso: python scripts/gerar_sql_supabase.py
Depois cole o arquivo gerado no SQL Editor do Supabase e clique em Run.
Pode rodar de novo: nada e duplicado.
"""
import os
import re
import sys
import json
import uuid

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
DADOS_MAPA = os.path.join(ROOT_DIR, "dados_mapa.js")
CONFIG_PATH = os.path.join(SCRIPT_DIR, "biomonitor_config.json")
CACHE_COMPLETO = os.path.join(ROOT_DIR, "dados_locais", "vistorias_completas.json")
SAIDA = os.path.join(ROOT_DIR, "dados_locais", "supabase_dados_iniciais.sql")

# Ids fixos para a empresa e a usina de demonstracao: rodar de novo nao duplica nada
EMPRESA_DEMO = "b10b0000-0000-4000-8000-000000000001"
USINA_DEMO = "b10b0000-0000-4000-8000-000000000002"
EMPRESA_DEMO_NOME = "Usina A"
USINA_DEMO_NOME = "Unidade Araçatuba"


def txt(v):
    """Literal SQL de texto (ou null)."""
    s = "" if v is None else str(v).strip()
    if s in ("", "nan", "None"):
        return "null"
    return "'" + s.replace("'", "''") + "'"


def ponto(lat, lon):
    try:
        return f"extensions.st_setsrid(extensions.st_makepoint({float(lon)}, {float(lat)}), 4326)::extensions.geography"
    except (TypeError, ValueError):
        return "null"


def data_iso(d):
    d = str(d or "").split(" ")[0].split("T")[0]
    p = d.split("/")
    if len(p) == 3:
        return f"{p[2]}-{int(p[1]):02d}-{int(p[0]):02d}"
    return d if re.match(r"^\d{4}-\d{2}-\d{2}$", d) else ""


def ler_sedes():
    with open(DADOS_MAPA, "r", encoding="utf-8") as f:
        js = f.read()
    m = re.search(r"^const DADOS_SEDES = (\{.*\});\s*$", js, re.M)
    if not m:
        raise SystemExit("[ERRO] DADOS_SEDES nao encontrado em dados_mapa.js")
    return [ft["properties"] for ft in json.loads(m.group(1))["features"]]


def ler_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def ler_vistorias():
    if not os.path.exists(CACHE_COMPLETO):
        return []
    with open(CACHE_COMPLETO, "r", encoding="utf-8") as f:
        return json.load(f)


def sql_vistoria(v):
    data = data_iso(v.get("data_vistoria"))
    try:
        bandeiras = int(float(v.get("bandeiras")))
    except (TypeError, ValueError):
        bandeiras = 0
    kobo_id = v.get("kobo_id")
    kobo = str(int(kobo_id)) if str(kobo_id or "").strip().isdigit() else "null"
    return (
        "insert into public.vistorias (sede_id, data_vistoria, hora_vistoria, avaliador_id, matricula, pressao,"
        " bandeiras, larva_pupa, inseticida, possiveis_causadores, observacoes, local_gps, origem, kobo_id)\n"
        f"select s.id, {txt(data)}::date, {txt(v.get('hora_vistoria'))}::time, null, {txt(v.get('matricula'))},"
        f" {txt(v.get('pressao'))}, {bandeiras}, {txt(v.get('larva_pupa'))}, {txt(v.get('inseticida'))},"
        f" {txt(v.get('possiveis_causadores'))}, {txt(v.get('observacoes'))},"
        f" {ponto(v.get('latitude_gps_lancamento'), v.get('longitude_gps_lancamento'))}, 'kobo', {kobo}\n"
        f"from public.sedes s where s.usina_id = '{USINA_DEMO}' and s.num_sede = {txt(v.get('num_sede'))}\n"
        "on conflict (kobo_id) do nothing;"
    )


def main():
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    cfg = ler_config()
    st, val, mon = cfg.get("status", {}), cfg.get("validacao", {}), cfg.get("monitoramento", {})
    sedes = ler_sedes()
    vistorias = [v for v in ler_vistorias() if data_iso(v.get("data_vistoria"))]

    linhas = [
        "-- Dados iniciais do BioMonitor (gerado por scripts/gerar_sql_supabase.py).",
        "-- Rode depois de 01_estrutura.sql e 02_acessos.sql. Pode rodar de novo sem duplicar.",
        "begin;",
        "",
        "insert into public.empresas (id, nome) values",
        f"  ('{EMPRESA_DEMO}', {txt(EMPRESA_DEMO_NOME)})",
        "on conflict (id) do nothing;",
        "",
        "insert into public.usinas (id, empresa_id, nome, municipio, uf, verde_max_dias, amarelo_max_dias,"
        " distancia_max_metros, inicio_monitoramento) values",
        f"  ('{USINA_DEMO}', '{EMPRESA_DEMO}', {txt(USINA_DEMO_NOME)}, 'Araçatuba', 'SP',"
        f" {int(st.get('verde_max_dias', 7))}, {int(st.get('amarelo_max_dias', 15))},"
        f" {int(val.get('distancia_max_metros', 500))}, {txt(data_iso(mon.get('inicio')))}::date)",
        "on conflict (id) do update set",
        "  verde_max_dias = excluded.verde_max_dias, amarelo_max_dias = excluded.amarelo_max_dias,",
        "  distancia_max_metros = excluded.distancia_max_metros, inicio_monitoramento = excluded.inicio_monitoramento;",
        "",
        "insert into public.sedes (id, usina_id, num_sede, nome, fa, fazenda, proprietario, regiao, local) values",
    ]
    valores = []
    for s in sedes:
        num = str(s.get("num_sede") or s.get("id"))
        sede_id = uuid.uuid5(uuid.UUID(USINA_DEMO), "sede-" + num)
        valores.append(
            f"  ('{sede_id}', '{USINA_DEMO}', {txt(num)}, {txt(s.get('nome_sede'))}, {txt(s.get('fa'))},"
            f" {txt(s.get('fazenda'))}, {txt(s.get('proprietario'))}, {txt(s.get('regiao'))},"
            f" {ponto(s.get('lat_sede', s.get('lat')), s.get('lon_sede', s.get('lon')))})"
        )
    linhas.append(",\n".join(valores))
    linhas += [
        "on conflict (usina_id, num_sede) do update set",
        "  nome = excluded.nome, fa = excluded.fa, fazenda = excluded.fazenda,",
        "  proprietario = excluded.proprietario, regiao = excluded.regiao, local = excluded.local;",
        "",
    ]
    linhas += [sql_vistoria(v) for v in vistorias]
    linhas += ["", "commit;", ""]

    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, "w", encoding="utf-8") as f:
        f.write("\n".join(linhas))
    print(f"[OK] {len(sedes)} sede(s) e {len(vistorias)} vistoria(s) gravadas em {SAIDA}")


if __name__ == "__main__":
    main()
