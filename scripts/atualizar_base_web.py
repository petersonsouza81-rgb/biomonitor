# -*- coding: utf-8 -*-
"""
Atualiza a base do app web (dados_mapa.js e vistorias_kobo.json) e o Excel consolidado.
Fluxo: Sede.shp + vistorias do KoboToolbox -> arquivos do site.
O token do Kobo fica em scripts/.env (veja scripts/.env.example).
"""
import os
import sys
import json
from datetime import datetime

import biomonitor_core as core

core.preparar_console()
print("=" * 70)
print("  BIOMONITOR - ATUALIZADOR DA BASE WEB DE SEDES (KOBOTOOLBOX & GIS)")
print("=" * 70)

cfg = core.carregar_config()

# 1. Sedes ------------------------------------------------------------------
try:
    pts, sedes_ref = core.carregar_sedes()
except Exception as e:
    print(f"[ERRO] {e}")
    sys.exit(1)
print(f"-> {len(sedes_ref)} sedes de referencia carregadas.")

# 2. Vistorias --------------------------------------------------------------
vistorias = core.obter_vistorias(sedes_ref, cfg)
ultimas = core.ultima_por_sede(vistorias)
print(f"-> Total de sedes distintas vistoriadas: {len(ultimas)}")

publicas = core.versao_publica(vistorias, cfg)
ultimas_pub = core.ultima_por_sede(publicas)

with open(core.OUT_JSON_PUBLICO, "w", encoding="utf-8") as f:
    json.dump(publicas, f, ensure_ascii=False, indent=2)
print(f"   [OK] vistorias_kobo.json gravado ({len(publicas)} vistorias)")

# 3. Pontos das sedes -------------------------------------------------------
hoje = datetime.now().date()
features = []
for idx, row in pts.iterrows():
    num = core.limpar(row.get("NUM_SEDE", idx + 1)) or str(idx + 1)
    ref = sedes_ref[num]
    fa, faz = ref["fa"], ref["fazenda"]
    if fa in ("-", "SEM FA"):
        fa = ""
    if fa and faz:
        fa_completo = f"{fa} - {faz}"
    elif faz:
        fa_completo = faz
    elif fa:
        fa_completo = f"FA {fa}"
    else:
        fa_completo = "Sem Informacao"

    v = ultimas_pub.get(num, {})
    dias = None
    if v:
        dt = core.parse_data(v.get("data_vistoria"), v.get("submetido_em"))
        if dt:
            dias = max(0, (hoje - dt.date()).days)
    try:
        id_int = int(float(num))
    except Exception:
        id_int = idx + 1

    lat, lon = ref["lat_sede"], ref["lon_sede"]
    props = {
        "id": id_int,
        "num_sede": num,
        "nome_sede": ref["nome_sede"] or f"Sede {num}",
        "fa": fa,
        "fazenda": faz,
        "fa_completo": fa_completo,
        "proprietario": ref["proprietario"],
        "regiao": ref["regiao"],
        "lat": lat, "lon": lon,
        "lat_sede": lat, "lon_sede": lon,
        "localizacao_sede": ref["localizacao_sede"],
        "link_google_maps_sede": ref["link_maps"],
        "visitado": bool(v),
        "dias_vistoria": dias,
        "status_tematico": core.classificar_status(dias, cfg),
        "data_vistoria": v.get("data_vistoria", ""),
        "hora_vistoria": v.get("hora_vistoria", ""),
        "matricula": v.get("matricula", ""),
        "pressao": v.get("pressao", ""),
        "bandeiras": v.get("bandeiras", ""),
        "larva_pupa": v.get("larva_pupa", ""),
        "inseticida": v.get("inseticida", ""),
        "possiveis_causadores": v.get("possiveis_causadores", ""),
        "observacoes": v.get("observacoes", ""),
    }
    features.append({"type": "Feature",
                     "geometry": {"type": "Point", "coordinates": [lon, lat]},
                     "properties": props})
print(f"   [OK] {len(features)} sedes processadas.")

# Vistorias de teste guardadas no celular nao entram nos mapas e relatorios
JS_VISITA_NO_PERIODO = """function visitaNoPeriodo(v) {
  const data = String(v.data_vistoria || v.data || "");
  const p = data.split("/");
  const iso = p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : data.slice(0, 10);
  return iso >= CONFIG_BIOMONITOR.inicio_monitoramento;
}

"""

# 4. dados_mapa.js ----------------------------------------------------------
agora = datetime.now()
config_js = {
    "verde_max_dias": cfg["status"]["verde_max_dias"],
    "amarelo_max_dias": cfg["status"]["amarelo_max_dias"],
    "distancia_max_metros": cfg["validacao"]["distancia_max_metros"],
    "inicio_monitoramento": cfg["monitoramento"].get("inicio", ""),
}
with open(core.OUT_JS, "w", encoding="utf-8") as f:
    f.write("// BASE DE DADOS COMPILADA DO MONITORAMENTO DE SEDES BIOMONITOR\n")
    f.write(f"// Atualizado em: {agora.strftime('%d/%m/%Y %H:%M:%S')}\n\n")
    f.write(f"const DADOS_ATUALIZADO_EM = \"{agora.strftime('%Y-%m-%dT%H:%M:%S')}\";\n\n")
    f.write("const CONFIG_BIOMONITOR = " + json.dumps(config_js) + ";\n\n")
    f.write(JS_VISITA_NO_PERIODO)
    f.write("const DADOS_VISTORIAS_KOBO = " + json.dumps(publicas, ensure_ascii=False) + ";\n\n")
    f.write("const DADOS_SEDES = " + json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False) + ";\n\n")
    f.write("const DADOS_PONTOS = DADOS_SEDES;\n")
print(f"   [OK] dados_mapa.js atualizado ({os.path.getsize(core.OUT_JS) / 1048576:.2f} MB)")

# 5. Excel (dados completos, so no computador) ------------------------------
core.gravar_excel(vistorias, core.linhas_status_sedes(sedes_ref, ultimas, cfg))

# 6. Nova versao do cache do app --------------------------------------------
core.atualizar_versao_sw()

print("=" * 70)
print(f"  [CONCLUIDO] {len(ultimas)} sedes com vistoria ativa no mapa!")
print("=" * 70)
