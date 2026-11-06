# -*- coding: utf-8 -*-
"""
Funcoes compartilhadas do BioMonitor (Monitoramento de Sedes).
Usado por atualizar_base_web.py.
"""
import os
import re
import sys
import json
import math
from datetime import datetime

import requests
import pandas as pd

# ---------------------------------------------------------------------------
# Caminhos
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR) if os.path.basename(SCRIPT_DIR).lower() == "scripts" else SCRIPT_DIR
GIS_DIR = os.path.join(ROOT_DIR, "banco de dados geograficos")
XLSX_DIR = os.path.join(ROOT_DIR, "relatorios e formularios")
XLSX_PATH = os.path.join(XLSX_DIR, "Visitas_Monitoramento_Sedes_Kobo.xlsx")
DADOS_LOCAIS_DIR = os.path.join(ROOT_DIR, "dados_locais")  # fora do GitHub
CACHE_COMPLETO = os.path.join(DADOS_LOCAIS_DIR, "vistorias_completas.json")
FOTOS_DIR = os.path.join(ROOT_DIR, "fotos")  # publicada no site junto com o app
OUT_JS = os.path.join(ROOT_DIR, "dados_mapa.js")
OUT_JSON_PUBLICO = os.path.join(ROOT_DIR, "vistorias_kobo.json")
SW_PATH = os.path.join(ROOT_DIR, "sw.js")
CONFIG_PATH = os.path.join(SCRIPT_DIR, "biomonitor_config.json")


def configurar_gis_do_qgis():
    """O Python do QGIS, usado fora do QGIS, nao acha os dados do PROJ e do GDAL sozinho."""
    raiz = os.path.dirname(os.path.dirname(sys.prefix))  # ...\QGIS x\apps\Python312
    proj = os.path.join(raiz, "share", "proj")
    if os.path.exists(os.path.join(proj, "proj.db")):
        os.environ.setdefault("PROJ_DATA", proj)
        os.environ.setdefault("PROJ_LIB", proj)
    gdal = os.path.join(raiz, "apps", "gdal", "share", "gdal")
    if os.path.exists(os.path.join(gdal, "header.dxf")):
        os.environ.setdefault("GDAL_DATA", gdal)


configurar_gis_do_qgis()

CONFIG_PADRAO = {
    "kobo": {"servidor": "kf.kobotoolbox.org", "asset_uid": "aK9E8d8UZ5XkKCXqwWnmpG", "tamanho_pagina": 1000},
    "monitoramento": {"inicio": ""},
    "status": {"verde_max_dias": 7, "amarelo_max_dias": 15},
    "validacao": {"distancia_max_metros": 500, "matricula_regex": r"^\d{1,6}$"},
    "privacidade": {"mascarar_matricula_no_site": True, "publicar_gps_avaliador_no_site": True},
}


def preparar_console():
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass


def carregar_config():
    cfg = json.loads(json.dumps(CONFIG_PADRAO))
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                user = json.load(f)
            for sec, vals in user.items():
                if isinstance(vals, dict):
                    cfg.setdefault(sec, {}).update(vals)
        except Exception as e:
            print(f"[AVISO] biomonitor_config.json invalido, usando padroes: {e}")
    return cfg


def _ler_env_arquivo(caminho):
    vals = {}
    if os.path.exists(caminho):
        with open(caminho, "r", encoding="utf-8") as f:
            for linha in f:
                linha = linha.strip()
                if not linha or linha.startswith("#") or "=" not in linha:
                    continue
                k, v = linha.split("=", 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


def obter_token():
    """Token vem da variavel de ambiente KOBO_TOKEN ou do arquivo scripts/.env (nunca do codigo)."""
    tok = os.environ.get("KOBO_TOKEN", "").strip()
    if not tok:
        for p in (os.path.join(SCRIPT_DIR, ".env"), os.path.join(ROOT_DIR, ".env")):
            tok = _ler_env_arquivo(p).get("KOBO_TOKEN", "").strip()
            if tok:
                break
    if not tok or tok == "cole_o_token_aqui":
        return None
    return tok


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def limpar(v):
    s = "" if v is None else str(v).strip()
    return "" if s in ("nan", "None", "NaN") else s


def distancia_metros(lat1, lon1, lat2, lon2):
    try:
        R = 6371000
        dlat = math.radians(float(lat2) - float(lat1))
        dlon = math.radians(float(lon2) - float(lon1))
        a = (math.sin(dlat / 2) ** 2 + math.cos(math.radians(float(lat1)))
             * math.cos(math.radians(float(lat2))) * math.sin(dlon / 2) ** 2)
        return round(R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 1)
    except Exception:
        return ""


def parse_data(d_str, sub_str=""):
    d_str = limpar(d_str).split(" ")[0].split("T")[0]
    try:
        if "/" in d_str:
            p = d_str.split("/")
            if len(p) == 3:
                return datetime(int(p[2]), int(p[1]), int(p[0]))
        elif "-" in d_str:
            p = d_str.split("-")
            if len(p) == 3:
                if len(p[0]) == 4:
                    return datetime(int(p[0]), int(p[1]), int(p[2]))
                return datetime(int(p[2]), int(p[1]), int(p[0]))
    except Exception:
        pass
    if sub_str:
        try:
            return datetime.fromisoformat(str(sub_str).replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            pass
    return None


def classificar_status(dias, cfg):
    v = cfg["status"]["verde_max_dias"]
    a = cfg["status"]["amarelo_max_dias"]
    if dias is None:
        return "Vermelho (Sem Vistoria)"
    if dias <= v:
        return f"Verde (<= {v} dias)"
    if dias <= a:
        return f"Amarelo ({v + 1} a {a} dias)"
    return f"Vermelho (>= {a + 1} dias)"


def mascarar_matricula(m):
    m = limpar(m)
    if len(m) <= 2:
        return "*" * len(m)
    return "*" * (len(m) - 2) + m[-2:]


# ---------------------------------------------------------------------------
# Sedes (shapefile)
# ---------------------------------------------------------------------------
def localizar_shp(nome):
    cands = [os.path.join(GIS_DIR, nome), os.path.join(ROOT_DIR, "SHP", nome), os.path.join(ROOT_DIR, nome)]
    return next((p for p in cands if os.path.exists(p)), None)


def carregar_sedes():
    """Retorna (GeoDataFrame em WGS84, dict num_sede -> dados de referencia)."""
    import geopandas as gpd
    shp = localizar_shp("Sede.shp")
    if not shp:
        raise FileNotFoundError("Sede.shp nao encontrado em 'banco de dados geograficos'.")
    gdf = gpd.read_file(shp, encoding="utf-8").to_crs(epsg=4326)
    ref = {}
    for idx, row in gdf.iterrows():
        num = limpar(row.get("NUM_SEDE", idx + 1)) or str(idx + 1)
        lat = round(row.geometry.y, 6) if row.geometry is not None else ""
        lon = round(row.geometry.x, 6) if row.geometry is not None else ""
        ref[num] = {
            "num_sede": num,
            "nome_sede": limpar(row.get("NOME_SEDE", "")),
            "fa": limpar(row.get("FA", "")),
            "fazenda": limpar(row.get("FAZENDA", "")),
            "proprietario": limpar(row.get("proprietar", "")),
            "regiao": limpar(row.get("regiao", "")),
            "lat_sede": lat,
            "lon_sede": lon,
            "localizacao_sede": f"{lat}, {lon}" if lat != "" and lon != "" else "",
            "link_maps": f"https://www.google.com/maps?q={lat},{lon}" if lat != "" and lon != "" else "",
        }
    return gdf, ref


# ---------------------------------------------------------------------------
# KoboToolbox
# ---------------------------------------------------------------------------
def baixar_kobo(cfg):
    """Baixa TODAS as submissoes, seguindo a paginacao da API. Retorna lista ou None se falhar."""
    token = obter_token()
    if not token:
        print("[ERRO] Token do KoboToolbox nao configurado.")
        print("       Crie o arquivo scripts\\.env com a linha: KOBO_TOKEN=seu_token")
        print("       (modelo em scripts\\.env.example)")
        return None
    k = cfg["kobo"]
    url = f"https://{k['servidor']}/api/v2/assets/{k['asset_uid']}/data.json?limit={int(k.get('tamanho_pagina', 1000))}"
    headers = {"Authorization": f"Token {token}"}
    resultados = []
    pagina = 0
    try:
        while url:
            pagina += 1
            resp = requests.get(url, headers=headers, timeout=30)
            if resp.status_code == 401:
                print("[ERRO] Token do Kobo recusado (401). Gere um novo e atualize scripts\\.env")
                return None
            if resp.status_code != 200:
                print(f"[AVISO] Kobo respondeu {resp.status_code} na pagina {pagina}")
                return None
            js = resp.json()
            resultados.extend(js.get("results", []))
            url = js.get("next")
        print(f"-> [KOBOTOOLBOX] {len(resultados)} vistoria(s) baixada(s) em {pagina} pagina(s).")
        return resultados
    except Exception as e:
        print(f"[AVISO] Nao foi possivel conectar ao Kobo: {e}")
        return None


CAMPOS_FOTO = ("pressao", "bandeiras", "larva_pupa", "inseticida", "causador")


def _fotos_da_submissao(r):
    """Nome do arquivo de cada foto citada na submissao (campos foto_<item>, com ou sem grupo)."""
    fotos = {}
    for chave, valor in r.items():
        nome = chave.split("/")[-1]
        if nome.startswith("foto_") and nome[5:] in CAMPOS_FOTO and valor:
            fotos[nome[5:]] = str(valor)
    return fotos


def baixar_fotos_kobo(kobo_results):
    """Baixa as fotos das vistorias para a pasta fotos/. Retorna {kobo_id: [{campo, arquivo}]}."""
    token = obter_token()
    if not token:
        return {}
    os.makedirs(FOTOS_DIR, exist_ok=True)
    headers = {"Authorization": f"Token {token}"}
    indice, novas, falhas = {}, 0, 0
    for r in kobo_results:
        fotos = _fotos_da_submissao(r)
        if not fotos:
            continue
        anexos = {os.path.basename(str(a.get("filename", ""))): a for a in r.get("_attachments", [])}
        itens = []
        for campo, arquivo in fotos.items():
            anexo = anexos.get(os.path.basename(arquivo))
            if not anexo:
                continue
            local = os.path.join(FOTOS_DIR, f"{r.get('_id')}_{os.path.basename(arquivo)}")
            if not os.path.exists(local):
                url = anexo.get("download_large_url") or anexo.get("download_url")
                try:
                    resp = requests.get(url, headers=headers, timeout=60)
                    if resp.status_code != 200:
                        falhas += 1
                        continue
                    with open(local, "wb") as f:
                        f.write(resp.content)
                    novas += 1
                except Exception:
                    falhas += 1
                    continue
            itens.append({"campo": campo, "arquivo": "fotos/" + os.path.basename(local)})
        if itens:
            indice[str(r.get("_id"))] = itens
    total = sum(len(v) for v in indice.values())
    print(f"-> [FOTOS] {total} foto(s) disponiveis para os relatorios ({novas} nova(s) baixada(s)).")
    if falhas:
        print(f"[AVISO] {falhas} foto(s) nao puderam ser baixadas; tente novamente mais tarde.")
    return indice


def _gps_da_submissao(r):
    lat, lon = None, None
    gps = r.get("localizacao_gps")
    if gps:
        partes = str(gps).strip().split()
        if len(partes) >= 2:
            try:
                lat, lon = float(partes[0]), float(partes[1])
            except Exception:
                pass
    if lat is None and r.get("latitude"):
        try:
            lat = float(r.get("latitude"))
        except Exception:
            pass
    if lon is None and r.get("longitude"):
        try:
            lon = float(r.get("longitude"))
        except Exception:
            pass
    return lat, lon


def validar_vistoria(v, cfg):
    alertas = []
    regex = cfg["validacao"].get("matricula_regex")
    if regex and not re.match(regex, limpar(v.get("matricula"))):
        alertas.append("Matricula invalida")
    dmax = cfg["validacao"].get("distancia_max_metros")
    d = v.get("distancia_sede_metros")
    if d == "" or d is None:
        alertas.append("Sem GPS de lancamento")
    elif dmax and float(d) > float(dmax):
        alertas.append(f"GPS a {round(float(d))} m da sede (limite {dmax} m)")
    return alertas


def normalizar_submissoes(kobo_results, sedes_ref, cfg):
    vistorias = []
    for r in kobo_results:
        num = limpar(r.get("num_sede"))
        ref = sedes_ref.get(num, {})
        causador = limpar(r.get("possiveis_causadores"))
        if causador == "Outro" and r.get("causador_outro"):
            causador = f"Outro: {r.get('causador_outro')}"
        lat_g, lon_g = _gps_da_submissao(r)

        lat_s = ref.get("lat_sede", "") or limpar(r.get("lat_sede"))
        lon_s = ref.get("lon_sede", "") or limpar(r.get("lon_sede"))
        loc_s = ref.get("localizacao_sede", "") or (f"{lat_s}, {lon_s}" if lat_s and lon_s else "")
        link = ref.get("link_maps", "") or (f"https://www.google.com/maps?q={lat_s},{lon_s}" if lat_s and lon_s else "")

        dist = ""
        if lat_g is not None and lon_g is not None and lat_s != "" and lon_s != "":
            dist = distancia_metros(lat_g, lon_g, lat_s, lon_s)

        v = {
            "num_sede": num,
            "nome_sede": limpar(r.get("nome_sede")) or ref.get("nome_sede") or f"Sede {num}",
            "fa": limpar(r.get("fa")) or ref.get("fa", ""),
            "fazenda": limpar(r.get("fazenda")) or ref.get("fazenda", ""),
            "proprietario": limpar(r.get("proprietario")) or ref.get("proprietario", ""),
            "regiao": limpar(r.get("regiao")) or ref.get("regiao", ""),
            "data_vistoria": _formatar_data_excel(limpar(r.get("data_vistoria"))) if limpar(r.get("data_vistoria")) else "",
            "hora_vistoria": limpar(r.get("hora_vistoria")),
            "matricula": limpar(r.get("matricula")),
            "pressao": limpar(r.get("pressao")),
            "bandeiras": r.get("bandeiras", ""),
            "larva_pupa": limpar(r.get("larva_pupa")),
            "inseticida": limpar(r.get("inseticida")),
            "possiveis_causadores": causador,
            "observacoes": limpar(r.get("observacoes")),
            "lat": lat_g,
            "lon": lon_g,
            "latitude_gps_lancamento": lat_g if lat_g is not None else "",
            "longitude_gps_lancamento": lon_g if lon_g is not None else "",
            "lat_sede": lat_s,
            "lon_sede": lon_s,
            "localizacao_sede": loc_s,
            "link_google_maps_sede": link,
            "distancia_sede_metros": dist,
            "origem": "KoboToolbox",
            "submetido_em": r.get("_submission_time", ""),
            "kobo_id": r.get("_id"),
            "instance_id": r.get("meta/instanceID") or r.get("_uuid") or "",
        }
        v["alertas"] = validar_vistoria(v, cfg)
        vistorias.append(v)
    return vistorias


# ---------------------------------------------------------------------------
# Datas corrigidas manualmente no Excel (por VISTORIA, nao por sede)
# ---------------------------------------------------------------------------
def _formatar_data_excel(dv):
    if hasattr(dv, "strftime"):
        return dv.strftime("%d/%m/%Y")
    d = str(dv).split()[0]
    if "-" in d:
        p = d.split("-")
        if len(p) == 3 and len(p[0]) == 4:
            return f"{p[2]}/{p[1]}/{p[0]}"
    return d


def ler_datas_manuais_excel():
    """Retorna dict com chaves ('id', kobo_id) e ('envio', DATA_ENVIO) -> data corrigida."""
    datas = {}
    if not os.path.exists(XLSX_PATH):
        return datas
    try:
        df = pd.read_excel(XLSX_PATH, sheet_name="Vistorias_Kobo")
    except Exception as e:
        print(f"[AVISO] Nao foi possivel ler datas do Excel: {e}")
        return datas
    for _, rx in df.iterrows():
        dv = rx.get("DATA_VISTORIA")
        if pd.isna(dv):
            continue
        data = _formatar_data_excel(dv)
        kid = rx.get("KOBO_ID")
        if kid is not None and not pd.isna(kid):
            try:
                datas[("id", str(int(float(kid))))] = data
                continue
            except Exception:
                pass
        envio = limpar(rx.get("DATA_ENVIO"))
        if envio:
            datas[("envio", envio)] = data
    return datas


def aplicar_datas_manuais(vistorias, datas):
    n = 0
    for v in vistorias:
        nova = None
        if v.get("kobo_id") is not None:
            nova = datas.get(("id", str(v["kobo_id"])))
        if nova is None and v.get("submetido_em"):
            nova = datas.get(("envio", str(v["submetido_em"])))
        if nova and nova != v.get("data_vistoria"):
            v["data_vistoria"] = nova
            n += 1
    if n:
        print(f"-> [EXCEL] {n} data(s) corrigida(s) manualmente foram preservadas.")
    return vistorias


# ---------------------------------------------------------------------------
# Cache local completo (fora do GitHub)
# ---------------------------------------------------------------------------
def salvar_cache_completo(vistorias):
    os.makedirs(DADOS_LOCAIS_DIR, exist_ok=True)
    with open(CACHE_COMPLETO, "w", encoding="utf-8") as f:
        json.dump(vistorias, f, ensure_ascii=False, indent=2)


def ler_cache_completo():
    for p in (CACHE_COMPLETO, OUT_JSON_PUBLICO):
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    dados = json.load(f)
                print(f"-> [OFFLINE] {len(dados)} vistoria(s) carregadas do cache local ({os.path.basename(p)}).")
                return dados
            except Exception:
                pass
    return []


def no_periodo(data, enviado_em, cfg):
    """Vistorias anteriores ao inicio do monitoramento (testes) ficam fora do sistema."""
    inicio = parse_data(cfg["monitoramento"].get("inicio"))
    dt = parse_data(data, enviado_em)
    return not inicio or (dt is not None and dt >= inicio)


def obter_vistorias(sedes_ref, cfg):
    """Baixa do Kobo (ou usa cache), aplica datas manuais do Excel e grava o cache completo."""
    brutos = baixar_kobo(cfg)
    if brutos is None:
        vistorias = [v for v in ler_cache_completo() if no_periodo(v.get("data_vistoria"), v.get("submetido_em"), cfg)]
        for v in vistorias:
            v.setdefault("alertas", validar_vistoria(v, cfg))
    else:
        brutos = [r for r in brutos if no_periodo(r.get("data_vistoria"), r.get("_submission_time"), cfg)]
        vistorias = normalizar_submissoes(brutos, sedes_ref, cfg)
        fotos = baixar_fotos_kobo(brutos)
        for v in vistorias:
            v["fotos_arquivos"] = fotos.get(str(v.get("kobo_id")), [])
    vistorias = aplicar_datas_manuais(vistorias, ler_datas_manuais_excel())
    if brutos is not None:
        salvar_cache_completo(vistorias)
    n_alerta = sum(1 for v in vistorias if v.get("alertas"))
    if n_alerta:
        print(f"-> [VALIDACAO] {n_alerta} vistoria(s) com alerta (veja a coluna ALERTAS_VALIDACAO no Excel).")
    return vistorias


def ultima_por_sede(vistorias):
    ult = {}
    for v in vistorias:
        s = limpar(v.get("num_sede"))
        if not s:
            continue
        dt = parse_data(v.get("data_vistoria"), v.get("submetido_em")) or datetime(1900, 1, 1)
        if s not in ult or dt >= ult[s][0]:
            ult[s] = (dt, v)
    return {k: val[1] for k, val in ult.items()}


def versao_publica(vistorias, cfg):
    """Copia das vistorias para publicar no site, respeitando as regras de privacidade."""
    priv = cfg["privacidade"]
    saida = []
    for v in vistorias:
        p = dict(v)
        if priv.get("mascarar_matricula_no_site", True):
            p["matricula"] = mascarar_matricula(p.get("matricula"))
        if not priv.get("publicar_gps_avaliador_no_site", True):
            for c in ("lat", "lon", "latitude_gps_lancamento", "longitude_gps_lancamento"):
                p[c] = None if c in ("lat", "lon") else ""
        saida.append(p)
    return saida


# ---------------------------------------------------------------------------
# Excel consolidado
# ---------------------------------------------------------------------------
def gravar_excel(vistorias, linhas_sedes):
    os.makedirs(XLSX_DIR, exist_ok=True)
    colunas = ["ORIGEM", "KOBO_ID", "DATA_VISTORIA", "HORA", "NUM_SEDE", "NOME_SEDE", "FA", "FAZENDA",
               "PROPRIETARIO", "REGIAO", "LATITUDE_SEDE", "LONGITUDE_SEDE", "LOCALIZACAO_SEDE",
               "LINK_GOOGLE_MAPS_SEDE", "MATRICULA_AVALIADOR", "PRESSAO", "NUM_BANDEIRAS", "LARVA_PUPA",
               "INSETICIDA", "POSSIVEIS_CAUSADORES", "OBSERVACOES", "LATITUDE_GPS_LANCAMENTO",
               "LONGITUDE_GPS_LANCAMENTO", "DISTANCIA_SEDE_METROS", "ALERTAS_VALIDACAO", "DATA_ENVIO"]
    linhas = [{
        "ORIGEM": v.get("origem", "KoboToolbox"),
        "KOBO_ID": v.get("kobo_id", ""),
        "DATA_VISTORIA": v.get("data_vistoria", ""),
        "HORA": v.get("hora_vistoria", ""),
        "NUM_SEDE": v.get("num_sede", ""),
        "NOME_SEDE": v.get("nome_sede", ""),
        "FA": v.get("fa", ""),
        "FAZENDA": v.get("fazenda", ""),
        "PROPRIETARIO": v.get("proprietario", ""),
        "REGIAO": v.get("regiao", ""),
        "LATITUDE_SEDE": v.get("lat_sede", ""),
        "LONGITUDE_SEDE": v.get("lon_sede", ""),
        "LOCALIZACAO_SEDE": v.get("localizacao_sede", ""),
        "LINK_GOOGLE_MAPS_SEDE": v.get("link_google_maps_sede", ""),
        "MATRICULA_AVALIADOR": v.get("matricula", ""),
        "PRESSAO": v.get("pressao", ""),
        "NUM_BANDEIRAS": v.get("bandeiras", ""),
        "LARVA_PUPA": v.get("larva_pupa", ""),
        "INSETICIDA": v.get("inseticida", ""),
        "POSSIVEIS_CAUSADORES": v.get("possiveis_causadores", ""),
        "OBSERVACOES": v.get("observacoes", ""),
        "LATITUDE_GPS_LANCAMENTO": v.get("latitude_gps_lancamento", ""),
        "LONGITUDE_GPS_LANCAMENTO": v.get("longitude_gps_lancamento", ""),
        "DISTANCIA_SEDE_METROS": v.get("distancia_sede_metros", ""),
        "ALERTAS_VALIDACAO": "; ".join(v.get("alertas") or []),
        "DATA_ENVIO": v.get("submetido_em", ""),
    } for v in vistorias]
    df_v = pd.DataFrame(linhas, columns=colunas)
    df_s = pd.DataFrame(linhas_sedes)
    try:
        with pd.ExcelWriter(XLSX_PATH, engine="openpyxl") as w:
            df_v.to_excel(w, index=False, sheet_name="Vistorias_Kobo")
            if not df_s.empty:
                df_s.to_excel(w, index=False, sheet_name="Status_Sedes")
        print(f"   [OK] Planilha Excel atualizada: {XLSX_PATH}")
        return True
    except PermissionError:
        print("   [ERRO] O Excel esta aberto. Feche a planilha e rode novamente.")
        return False


def linhas_status_sedes(sedes_ref, ultimas, cfg):
    hoje = datetime.now().date()
    linhas = []
    for num, ref in sedes_ref.items():
        v = ultimas.get(num, {})
        dias = None
        if v:
            dt = parse_data(v.get("data_vistoria"), v.get("submetido_em"))
            if dt:
                dias = max(0, (hoje - dt.date()).days)
        linhas.append({
            "NUM_SEDE": num,
            "NOME_SEDE": ref.get("nome_sede") or f"Sede {num}",
            "FA": ref.get("fa", ""),
            "FAZENDA": ref.get("fazenda", ""),
            "PROPRIETARIO": ref.get("proprietario", ""),
            "REGIAO": ref.get("regiao", ""),
            "LATITUDE_SEDE": ref.get("lat_sede", ""),
            "LONGITUDE_SEDE": ref.get("lon_sede", ""),
            "LOCALIZACAO_SEDE": ref.get("localizacao_sede", ""),
            "LINK_GOOGLE_MAPS_SEDE": ref.get("link_maps", ""),
            "STATUS_VISTORIA": "Vistoriada" if v else "Pendente",
            "STATUS_TEMATICO": classificar_status(dias, cfg),
            "DIAS_DESDE_VISTORIA": dias if dias is not None else "",
            "ULTIMA_DATA": v.get("data_vistoria", ""),
            "ULTIMA_HORA": v.get("hora_vistoria", ""),
            "AVALIADOR": v.get("matricula", ""),
            "PRESSAO": v.get("pressao", ""),
            "BANDEIRAS": v.get("bandeiras", ""),
            "LARVA_PUPA": v.get("larva_pupa", ""),
            "INSETICIDA": v.get("inseticida", ""),
            "CAUSADORES": v.get("possiveis_causadores", ""),
            "OBSERVACOES": v.get("observacoes", ""),
        })
    return linhas


def atualizar_versao_sw():
    """Gera uma versao nova do cache do app a cada publicacao (celulares baixam a versao nova)."""
    if not os.path.exists(SW_PATH):
        return
    with open(SW_PATH, "r", encoding="utf-8") as f:
        txt = f.read()
    nova = "biomonitor-sedes-" + datetime.now().strftime("%Y%m%d-%H%M")
    txt2 = re.sub(r"const CACHE_NAME = '[^']*';", f"const CACHE_NAME = '{nova}';", txt, count=1)
    if txt2 != txt:
        with open(SW_PATH, "w", encoding="utf-8") as f:
            f.write(txt2)
        print(f"   [OK] Versao do app (cache) atualizada para {nova}")
