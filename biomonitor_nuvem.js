// =========================================================================
// BIOMONITOR NA NUVEM: login, dados da usina e envio das vistorias (Supabase)
//
// Substitui o dados_mapa.js. As páginas continuam lendo DADOS_SEDES,
// DADOS_VISTORIAS_KOBO e CONFIG_BIOMONITOR, que aqui vêm do último download
// guardado no aparelho: a página abre na hora e funciona sem sinal. Em seguida
// os dados novos são buscados no banco e a página é avisada.
// Precisa ser carregado depois do supabase-js e do supabase_config.js.
// =========================================================================
(function () {
  const CACHE_KEY = "biomonitor_cache_v1";
  const USINA_KEY = "biomonitor_usina";
  const FILA_KEY = "biomonitor_fila_envio";
  const VALIDADE_FOTO_S = 7 * 24 * 3600;
  const POR_PAGINA = 1000;

  const cfg = window.BIOMONITOR_SUPABASE || {};
  const sb = window.supabase.createClient(cfg.url, cfg.chave, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  let cache = lerCache();
  let sessao = null;
  let atualizando = false;

  function lerCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (e) { return null; }
  }
  function gravarCache(c) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {}
  }

  // -------------------------------------------------------------------------
  // Globais lidas pelas páginas (mesmos nomes do antigo dados_mapa.js)
  // -------------------------------------------------------------------------
  function publicar(c) {
    const d = c && c.dados;
    window.CONFIG_BIOMONITOR = d ? d.config
      : { verde_max_dias: 7, amarelo_max_dias: 15, distancia_max_metros: 500, inicio_monitoramento: "" };
    window.DADOS_SEDES = d ? d.sedes : { type: "FeatureCollection", features: [] };
    window.DADOS_PONTOS = window.DADOS_SEDES;
    window.DADOS_VISTORIAS_KOBO = d ? d.vistorias : [];
    window.DADOS_ATUALIZADO_EM = c ? c.baixadoEm : undefined;
  }

  window.visitaNoPeriodo = function (v) {
    const data = String(v.data_vistoria || v.data || "");
    const p = data.split("/");
    const iso = p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : data.slice(0, 10);
    return iso >= (window.CONFIG_BIOMONITOR.inicio_monitoramento || "");
  };

  publicar(cache);

  // -------------------------------------------------------------------------
  // Download dos dados da usina escolhida
  // -------------------------------------------------------------------------
  const dataBR = iso => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
  const horaCurta = h => (h ? String(h).slice(0, 5) : "");
  const num = v => (v === null || v === undefined || v === "" ? "" : Number(v));

  async function todas(consulta) {
    const linhas = [];
    for (let de = 0; ; de += POR_PAGINA) {
      const { data, error } = await consulta().range(de, de + POR_PAGINA - 1);
      if (error) throw error;
      linhas.push(...data);
      if (data.length < POR_PAGINA) return linhas;
    }
  }

  function sedeParaFeature(r) {
    const lat = num(r.lat), lon = num(r.lon);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        id: r.sede_id, sede_id: r.sede_id, usina_id: r.usina_id,
        num_sede: r.num_sede, nome_sede: r.nome_sede || `Sede ${r.num_sede}`,
        fa: r.fa || "", fazenda: r.fazenda || "",
        fa_completo: [r.fa, r.fazenda].filter(Boolean).join(" - "),
        proprietario: r.proprietario || "", regiao: r.regiao || "",
        lat: lat, lon: lon, lat_sede: lat, lon_sede: lon,
        localizacao_sede: `${lat}, ${lon}`,
        link_google_maps_sede: `https://www.google.com/maps?q=${lat},${lon}`,
        visitado: !!r.vistoria_id,
        dias_vistoria: r.dias_vistoria,
        status_tematico: r.status_tematico,
        data_vistoria: dataBR(r.data_vistoria), hora_vistoria: horaCurta(r.hora_vistoria),
        matricula: r.matricula || "", pressao: r.pressao || "",
        bandeiras: r.bandeiras === null || r.bandeiras === undefined ? "" : r.bandeiras,
        larva_pupa: r.larva_pupa || "", inseticida: r.inseticida || "",
        possiveis_causadores: r.possiveis_causadores || "", observacoes: r.observacoes || ""
      }
    };
  }

  function vistoriaParaPagina(r, fotos) {
    const latS = num(r.lat_sede), lonS = num(r.lon_sede);
    return {
      id: r.id, sede_id: r.sede_id, usina_id: r.usina_id,
      num_sede: r.num_sede, nome_sede: r.nome_sede, fa: r.fa || "", fazenda: r.fazenda || "",
      proprietario: r.proprietario || "", regiao: r.regiao || "",
      data_vistoria: dataBR(r.data_vistoria), hora_vistoria: horaCurta(r.hora_vistoria),
      matricula: r.matricula || "", pressao: r.pressao, bandeiras: r.bandeiras,
      larva_pupa: r.larva_pupa, inseticida: r.inseticida,
      possiveis_causadores: r.possiveis_causadores || "", observacoes: r.observacoes || "",
      lat: r.lat_gps === null ? null : num(r.lat_gps),
      lon: r.lon_gps === null ? null : num(r.lon_gps),
      latitude_gps_lancamento: num(r.lat_gps), longitude_gps_lancamento: num(r.lon_gps),
      lat_sede: latS, lon_sede: lonS, localizacao_sede: `${latS}, ${lonS}`,
      link_google_maps_sede: `https://www.google.com/maps?q=${latS},${lonS}`,
      distancia_sede_metros: num(r.distancia_sede_m),
      alertas: r.alertas || [],
      origem: r.origem === "app" ? "BioMonitor" : r.origem,
      submetido_em: r.criado_em, kobo_id: r.kobo_id,
      instance_id: "uuid:" + r.id,
      fotos_arquivos: fotos || []
    };
  }

  async function baixarDados(usuario) {
    const [perfilR, usinasR] = await Promise.all([
      sb.from("perfis").select("nome, matricula, e_admin").eq("id", usuario.id).maybeSingle(),
      sb.from("usinas").select("id, nome, municipio, uf, verde_max_dias, amarelo_max_dias, distancia_max_metros, inicio_monitoramento, empresas(nome)")
        .eq("ativa", true).order("nome")
    ]);
    if (perfilR.error) throw perfilR.error;
    if (usinasR.error) throw usinasR.error;
    const usinas = usinasR.data.map(u => ({ id: u.id, nome: u.nome, empresa: u.empresas ? u.empresas.nome : "", u: u }));
    if (!usinas.length) {
      const e = new Error("sem_usina");
      e.semUsina = true;
      throw e;
    }
    let usinaId = localStorage.getItem(USINA_KEY);
    if (!usinas.some(u => u.id === usinaId)) usinaId = usinas[0].id;
    const usina = usinas.find(u => u.id === usinaId).u;

    const [sedes, vistorias, fotos] = await Promise.all([
      todas(() => sb.from("vw_status_sedes").select("*").eq("usina_id", usinaId).order("num_sede")),
      todas(() => sb.from("vw_vistorias").select("*").eq("usina_id", usinaId)
        .order("data_vistoria", { ascending: false }).order("criado_em", { ascending: false })),
      todas(() => sb.from("fotos").select("vistoria_id, campo, caminho").like("caminho", usinaId + "/%").order("caminho"))
    ]);

    // Fotos ficam em pasta privada: cada uma ganha um link temporário
    const links = {};
    for (let i = 0; i < fotos.length; i += 100) {
      const lote = fotos.slice(i, i + 100).map(f => f.caminho);
      const { data, error } = await sb.storage.from("fotos").createSignedUrls(lote, VALIDADE_FOTO_S);
      if (error) throw error;
      data.forEach(d => { if (d.signedUrl) links[d.path] = d.signedUrl; });
    }
    const fotosPorVistoria = {};
    fotos.forEach(f => {
      (fotosPorVistoria[f.vistoria_id] = fotosPorVistoria[f.vistoria_id] || [])
        .push({ campo: f.campo, caminho: f.caminho, arquivo: links[f.caminho] || "" });
    });

    return {
      perfil: perfilR.data || {},
      usinas: usinas.map(u => ({ id: u.id, nome: u.nome, empresa: u.empresa })),
      usinaId: usinaId,
      dados: {
        config: {
          verde_max_dias: usina.verde_max_dias,
          amarelo_max_dias: usina.amarelo_max_dias,
          distancia_max_metros: usina.distancia_max_metros,
          inicio_monitoramento: usina.inicio_monitoramento || ""
        },
        usina: { id: usina.id, nome: usina.nome, municipio: usina.municipio, uf: usina.uf },
        sedes: { type: "FeatureCollection", features: sedes.map(sedeParaFeature) },
        vistorias: vistorias.map(v => vistoriaParaPagina(v, fotosPorVistoria[v.id]))
      }
    };
  }

  // Os links das fotos mudam a cada download; so o resto conta como "dado novo"
  const assinatura = d => JSON.stringify(d, (k, v) => (k === "arquivo" ? undefined : v));

  async function atualizar(manual) {
    if (atualizando || !sessao) return;
    atualizando = true;
    const anterior = cache;
    try {
      const baixado = await baixarDados(sessao.user);
      const novo = Object.assign({ usuario: sessao.user.id, email: sessao.user.email, baixadoEm: new Date().toISOString() }, baixado);
      const mudou = !anterior || anterior.usinaId !== novo.usinaId || assinatura(anterior.dados) !== assinatura(novo.dados);
      cache = novo;
      gravarCache(novo);
      podarHistoricoLocal(novo.dados.vistorias);
      montarBotaoUsuario();
      if (!anterior) {
        location.reload(); // primeira vez neste aparelho: a página abriu sem dados
        return;
      }
      publicar(novo);
      if (typeof window.aoReceberDadosNuvem === "function") {
        window.aoReceberDadosNuvem();
        if (manual) aviso(mudou ? "Dados atualizados." : "Os dados já estão em dia.");
      } else if (manual) {
        location.reload();
      } else if (mudou) {
        faixaDadosNovos();
      }
    } catch (e) {
      if (e.semUsina) {
        mostrarLogin("Seu login ainda não tem acesso a nenhuma usina. Peça acesso ao administrador.", true);
      } else {
        console.warn("[BioMonitor] Não foi possível baixar os dados:", e);
        if (manual || !anterior) aviso("Não foi possível buscar os dados agora. Verifique o sinal e tente de novo.", true);
      }
    } finally {
      atualizando = false;
    }
  }

  // Vistorias lançadas neste aparelho que já chegaram ao banco saem da lista local
  function podarHistoricoLocal(vistorias) {
    try {
      const noBanco = new Set(vistorias.map(v => v.instance_id));
      const local = JSON.parse(localStorage.getItem("visitas_historico") || "[]");
      const resto = local.filter(v => !(v.instance_id && noBanco.has(v.instance_id)));
      if (resto.length !== local.length) localStorage.setItem("visitas_historico", JSON.stringify(resto));
    } catch (e) {}
  }

  // -------------------------------------------------------------------------
  // Envio de uma vistoria (chamado pela fila do index.html). Pode repetir sem
  // duplicar: o id da vistoria nasce no celular e as fotos têm caminho fixo.
  // -------------------------------------------------------------------------
  async function enviarVistoria(reg, fotos) {
    const temGps = reg.lat !== null && reg.lat !== undefined && reg.lat !== "" && reg.lon !== null && reg.lon !== undefined && reg.lon !== "";
    const linha = {
      id: reg.id,
      sede_id: reg.sede_id,
      data_vistoria: reg.data_vistoria,
      hora_vistoria: reg.hora_vistoria || null,
      matricula: reg.matricula || null,
      pressao: reg.pressao,
      bandeiras: reg.bandeiras,
      larva_pupa: reg.larva_pupa,
      inseticida: reg.inseticida,
      possiveis_causadores: reg.possiveis_causadores || null,
      observacoes: reg.observacoes || null,
      local_gps: temGps ? `SRID=4326;POINT(${Number(reg.lon)} ${Number(reg.lat)})` : null,
      origem: "app"
    };
    let r = await sb.from("vistorias").upsert(linha, { onConflict: "id", ignoreDuplicates: true });
    if (r.error) throw r.error;
    for (const f of fotos) {
      const caminho = `${reg.usina_id}/${reg.id}/${f.campo}.jpg`;
      const up = await sb.storage.from("fotos").upload(caminho, f.blob, { contentType: "image/jpeg", upsert: false });
      if (up.error && !/already exists|duplicate/i.test(up.error.message || "")) throw up.error;
      r = await sb.from("fotos").upsert({ vistoria_id: reg.id, campo: f.campo, caminho: caminho }, { onConflict: "caminho", ignoreDuplicates: true });
      if (r.error) throw r.error;
    }
  }

  // -------------------------------------------------------------------------
  // Tela de entrada
  // -------------------------------------------------------------------------
  const css = `
    #bm-login { position: fixed; inset: 0; z-index: 100000; background: #0f172a; display: flex; align-items: center;
      justify-content: center; padding: 16px; font-family: 'Inter', system-ui, sans-serif; overflow-y: auto; }
    #bm-login .bm-cartao { width: min(380px, 100%); background: #1e293b; border: 1px solid #334155; border-radius: 14px;
      padding: 24px 20px; color: #f8fafc; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5); }
    #bm-login .bm-topo { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
    #bm-login .bm-topo img { width: 48px; height: 48px; border-radius: 12px; }
    #bm-login h2 { font-size: 20px; font-weight: 800; margin: 0; }
    #bm-login .bm-sub { font-size: 12.5px; color: #94a3b8; margin: 2px 0 0; }
    #bm-login label { display: block; font-size: 12px; font-weight: 700; color: #cbd5e1; margin: 12px 0 5px; }
    #bm-login input { width: 100%; box-sizing: border-box; background: #0f172a; color: #f8fafc; border: 1px solid #334155;
      border-radius: 9px; padding: 11px 12px; font-size: 15px; }
    #bm-login input:focus { outline: 2px solid #22c55e; border-color: transparent; }
    #bm-login button { width: 100%; border: none; border-radius: 9px; padding: 12px; font-size: 15px; font-weight: 800;
      cursor: pointer; margin-top: 16px; color: #fff; background: #15803d; }
    #bm-login button:disabled { opacity: 0.6; cursor: wait; }
    #bm-login button.bm-sec { background: #334155; margin-top: 10px; }
    #bm-login .bm-link { background: none; color: #4ade80; font-size: 13px; font-weight: 700; padding: 6px; margin-top: 8px; }
    #bm-login .bm-msg { font-size: 13px; margin-top: 12px; line-height: 1.45; color: #cbd5e1; }
    #bm-login .bm-msg.erro { color: #fca5a5; }
    #bm-login .bm-msg.ok { color: #86efac; }
    #bm-usuario-btn { display: inline-flex; align-items: center; gap: 6px; background: #1e293b; color: #f8fafc;
      border: 1px solid #334155; border-radius: 8px; padding: 6px 10px; font-size: 12px; font-weight: 700; cursor: pointer;
      white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis; font-family: inherit; }
    #bm-usuario-btn.bm-flutuante { position: fixed; left: 12px; bottom: 12px; z-index: 9000; }
    @media (max-width: 700px) { #bm-usuario-btn .bm-nome-btn { display: none; } }
    #bm-usuario-painel { position: fixed; z-index: 99990; right: 12px; top: 64px; width: min(300px, calc(100vw - 24px));
      background: #1e293b; color: #f8fafc; border: 1px solid #334155; border-radius: 12px; padding: 14px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55); font-size: 13px; display: none; font-family: 'Inter', system-ui, sans-serif; }
    #bm-usuario-painel.aberto { display: block; }
    #bm-usuario-painel .bm-nome { font-weight: 800; font-size: 14px; }
    #bm-usuario-painel .bm-email { color: #94a3b8; font-size: 12px; margin-bottom: 10px; word-break: break-all; }
    #bm-usuario-painel label { display: block; font-size: 11.5px; color: #cbd5e1; font-weight: 700; margin: 8px 0 4px; }
    #bm-usuario-painel select { width: 100%; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 8px;
      padding: 8px; font-size: 13px; }
    #bm-usuario-painel button { width: 100%; margin-top: 10px; border: none; border-radius: 8px; padding: 9px; font-weight: 700;
      font-size: 13px; cursor: pointer; color: #fff; background: #334155; }
    #bm-usuario-painel button.bm-sair { background: #7f1d1d; }
    #bm-faixa { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 99980; background: #15803d;
      color: #fff; border-radius: 10px; padding: 10px 14px; font-size: 13px; font-weight: 700; display: flex; gap: 10px;
      align-items: center; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); font-family: 'Inter', system-ui, sans-serif; }
    #bm-faixa button { border: none; border-radius: 7px; padding: 6px 10px; font-weight: 800; cursor: pointer; }
    #bm-aviso { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); z-index: 100001; background: #1e293b;
      color: #f8fafc; border: 1px solid #334155; border-radius: 10px; padding: 10px 14px; font-size: 13px; font-weight: 600;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); font-family: 'Inter', system-ui, sans-serif; max-width: calc(100vw - 32px); }
    #bm-aviso.erro { border-color: #b91c1c; }
  `;

  function estilos() {
    if (document.getElementById("bm-estilos")) return;
    const st = document.createElement("style");
    st.id = "bm-estilos";
    st.textContent = css;
    document.head.appendChild(st);
  }

  function quandoPronto(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function elemento(tag, props, filhos) {
    const el = document.createElement(tag);
    Object.assign(el, props || {});
    (filhos || []).forEach(f => el.appendChild(typeof f === "string" ? document.createTextNode(f) : f));
    return el;
  }

  function traduzirErro(e) {
    const m = (e && e.message) || "";
    if (/invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
    if (/email not confirmed/i.test(m)) return "Este e-mail ainda não foi confirmado. Peça ajuda ao administrador.";
    if (/password should be at least|weak/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
    if (/rate limit|too many/i.test(m)) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
    if (/fetch|network/i.test(m)) return "Sem conexão com a internet. Verifique o sinal e tente de novo.";
    return "Não foi possível concluir: " + m;
  }

  function telaLogin() {
    estilos();
    let tela = document.getElementById("bm-login");
    if (!tela) {
      tela = elemento("div", { id: "bm-login" });
      document.body.appendChild(tela);
    }
    tela.innerHTML = "";
    const cartao = elemento("div", { className: "bm-cartao" }, [
      elemento("div", { className: "bm-topo" }, [
        elemento("img", { src: "logos/icon-192.png", alt: "" }),
        elemento("div", {}, [
          elemento("h2", { textContent: "BioMonitor" }),
          elemento("p", { className: "bm-sub", textContent: "Monitoramento de Sedes" })
        ])
      ])
    ]);
    tela.appendChild(cartao);
    return cartao;
  }

  function mensagem(cartao, texto, tipo) {
    let m = cartao.querySelector(".bm-msg");
    if (!m) { m = elemento("p", { className: "bm-msg" }); cartao.appendChild(m); }
    m.className = "bm-msg " + (tipo || "");
    m.textContent = texto || "";
  }

  function mostrarLogin(textoInicial, soSair) {
    quandoPronto(() => {
      const cartao = telaLogin();
      if (soSair) {
        mensagem(cartao, textoInicial, "erro");
        cartao.appendChild(elemento("button", { className: "bm-sec", textContent: "Sair", onclick: () => sair(true) }));
        return;
      }
      const email = elemento("input", { type: "email", autocomplete: "username", inputMode: "email", placeholder: "seu@email.com" });
      const senha = elemento("input", { type: "password", autocomplete: "current-password", placeholder: "Sua senha" });
      const entrar = elemento("button", { type: "submit", textContent: "Entrar" });
      const esqueci = elemento("button", { type: "button", className: "bm-link", textContent: "Esqueci minha senha" });
      const form = elemento("form", {}, [
        elemento("label", { textContent: "E-mail" }), email,
        elemento("label", { textContent: "Senha" }), senha,
        entrar, esqueci
      ]);
      cartao.appendChild(form);
      if (textoInicial) mensagem(cartao, textoInicial);
      form.onsubmit = async ev => {
        ev.preventDefault();
        entrar.disabled = true;
        entrar.textContent = "Entrando...";
        mensagem(cartao, "");
        const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: senha.value });
        if (error) {
          mensagem(cartao, traduzirErro(error), "erro");
          entrar.disabled = false;
          entrar.textContent = "Entrar";
          return;
        }
        sessao = data.session;
        entrar.textContent = "Carregando dados...";
        cache = null;
        localStorage.removeItem(CACHE_KEY);
        await atualizar(false);
      };
      esqueci.onclick = async () => {
        const e = email.value.trim();
        if (!e) { mensagem(cartao, "Digite seu e-mail acima e toque de novo em \"Esqueci minha senha\".", "erro"); email.focus(); return; }
        esqueci.disabled = true;
        const { error } = await sb.auth.resetPasswordForEmail(e, { redirectTo: location.origin + location.pathname });
        esqueci.disabled = false;
        mensagem(cartao, error ? traduzirErro(error) : "Se este e-mail estiver cadastrado, chegará um link para criar uma senha nova. Abra o link neste mesmo aparelho.", error ? "erro" : "ok");
      };
      setTimeout(() => email.focus(), 50);
    });
  }

  function mostrarNovaSenha() {
    quandoPronto(() => {
      const cartao = telaLogin();
      const senha = elemento("input", { type: "password", autocomplete: "new-password", placeholder: "Pelo menos 6 caracteres" });
      const salvar = elemento("button", { type: "submit", textContent: "Salvar nova senha" });
      const form = elemento("form", {}, [elemento("label", { textContent: "Nova senha" }), senha, salvar]);
      cartao.appendChild(form);
      form.onsubmit = async ev => {
        ev.preventDefault();
        salvar.disabled = true;
        const { error } = await sb.auth.updateUser({ password: senha.value });
        salvar.disabled = false;
        if (error) { mensagem(cartao, traduzirErro(error), "erro"); return; }
        mensagem(cartao, "Senha alterada. Carregando seus dados...", "ok");
        history.replaceState(null, "", location.pathname); // tira o código do link do e-mail
        const { data } = await sb.auth.getSession();
        sessao = data.session;
        cache = null;
        localStorage.removeItem(CACHE_KEY);
        await atualizar(false);
      };
      setTimeout(() => senha.focus(), 50);
    });
  }

  // -------------------------------------------------------------------------
  // Botão do usuário (nome, usina, atualizar, sair)
  // -------------------------------------------------------------------------
  function montarBotaoUsuario() {
    // Página embutida em outra (ex.: aba Calor do relatório): o botão fica só na de fora
    if (!cache || window.self !== window.top) return;
    quandoPronto(() => {
      estilos();
      const nome = (cache.perfil && cache.perfil.nome && cache.perfil.nome !== cache.email)
        ? cache.perfil.nome.split(" ")[0] : String(cache.email || "").split("@")[0];
      let btn = document.getElementById("bm-usuario-btn");
      if (!btn) {
        btn = elemento("button", { id: "bm-usuario-btn", type: "button", title: "Sua conta, usina e saída" });
        const botaoAtualizar = document.querySelector('[onclick^="BioMonitorAtualizacao"]');
        const lugar = document.querySelector(".top-actions, .header-actions, .header-controls")
          || (botaoAtualizar && botaoAtualizar.parentElement);
        if (lugar) lugar.insertBefore(btn, lugar.firstChild);
        else { btn.classList.add("bm-flutuante"); document.body.appendChild(btn); }
        btn.onclick = ev => { ev.stopPropagation(); abrirPainel(); };
      }
      btn.innerHTML = "";
      btn.appendChild(elemento("i", { className: "fa-solid fa-circle-user" }));
      btn.appendChild(elemento("span", { className: "bm-nome-btn", textContent: nome }));
    });
  }

  function abrirPainel() {
    let p = document.getElementById("bm-usuario-painel");
    if (p && p.classList.contains("aberto")) { p.classList.remove("aberto"); return; }
    if (!p) {
      p = elemento("div", { id: "bm-usuario-painel" });
      p.onclick = ev => ev.stopPropagation();
      document.body.appendChild(p);
      document.addEventListener("click", () => p.classList.remove("aberto"));
    }
    p.innerHTML = "";
    const perfil = cache.perfil || {};
    p.appendChild(elemento("div", { className: "bm-nome", textContent: perfil.nome || cache.email }));
    p.appendChild(elemento("div", { className: "bm-email", textContent: cache.email + (perfil.e_admin ? " · administrador" : "") }));
    p.appendChild(elemento("label", { textContent: "Usina" }));
    const sel = elemento("select", {});
    (cache.usinas || []).forEach(u => sel.appendChild(elemento("option", {
      value: u.id, textContent: u.empresa ? `${u.nome} (${u.empresa})` : u.nome, selected: u.id === cache.usinaId
    })));
    sel.disabled = (cache.usinas || []).length < 2;
    sel.onchange = () => {
      localStorage.setItem(USINA_KEY, sel.value);
      localStorage.removeItem(CACHE_KEY);
      location.reload();
    };
    p.appendChild(sel);
    p.appendChild(elemento("button", { type: "button", textContent: "Buscar dados novos", onclick: () => { p.classList.remove("aberto"); atualizar(true); } }));
    p.appendChild(elemento("button", { type: "button", className: "bm-sair", textContent: "Sair", onclick: () => sair(false) }));
    const btn = document.getElementById("bm-usuario-btn");
    if (btn && !btn.classList.contains("bm-flutuante")) {
      const r = btn.getBoundingClientRect();
      p.style.top = Math.round(r.bottom + 8) + "px";
      p.style.bottom = "";
    } else {
      p.style.top = "auto";
      p.style.bottom = "60px";
    }
    p.classList.add("aberto");
  }

  async function sair(semPerguntar) {
    let pendentes = 0;
    try { pendentes = JSON.parse(localStorage.getItem(FILA_KEY) || "[]").length; } catch (e) {}
    if (!semPerguntar && pendentes > 0 &&
      !confirm(`Há ${pendentes} vistoria(s) neste aparelho que ainda não foram enviadas. Se sair agora, elas serão descartadas. Sair mesmo assim?`)) return;
    try { await sb.auth.signOut(); } catch (e) {}
    [CACHE_KEY, FILA_KEY, "visitas_historico"].forEach(k => localStorage.removeItem(k));
    try { indexedDB.deleteDatabase("biomonitor_fotos"); } catch (e) {}
    location.reload();
  }

  function faixaDadosNovos() {
    quandoPronto(() => {
      estilos();
      if (document.getElementById("bm-faixa")) return;
      const f = elemento("div", { id: "bm-faixa" }, [
        "Há dados novos.",
        elemento("button", { type: "button", textContent: "Mostrar", onclick: () => location.reload() })
      ]);
      document.body.appendChild(f);
    });
  }

  function aviso(texto, erro) {
    quandoPronto(() => {
      estilos();
      const a = elemento("div", { id: "bm-aviso", className: erro ? "erro" : "", textContent: texto });
      const velho = document.getElementById("bm-aviso");
      if (velho) velho.remove();
      document.body.appendChild(a);
      setTimeout(() => a.remove(), 3500);
    });
  }

  // -------------------------------------------------------------------------
  // Início
  // -------------------------------------------------------------------------
  sb.auth.onAuthStateChange(evento => {
    if (evento === "PASSWORD_RECOVERY") mostrarNovaSenha();
  });

  async function iniciar() {
    // Link de "esqueci minha senha": o evento PASSWORD_RECOVERY cuida
    if (/type=recovery/.test(location.hash) || new URLSearchParams(location.search).has("code")) return;
    const { data, error } = await sb.auth.getSession();
    sessao = data && data.session;
    if (!sessao) {
      // Sem sinal, quem já entrou continua usando os dados guardados
      if (cache && (!navigator.onLine || (error && /fetch|network/i.test(error.message || "")))) return;
      cache = null;
      localStorage.removeItem(CACHE_KEY);
      publicar(null);
      mostrarLogin();
      return;
    }
    if (cache && cache.usuario !== sessao.user.id) {
      localStorage.removeItem(CACHE_KEY);
      cache = null;
    }
    montarBotaoUsuario();
    await atualizar(false);
  }

  window.BioMonitorNuvem = {
    sb: sb,
    atualizar: (manual = true) => atualizar(manual),
    enviarVistoria: enviarVistoria,
    sair: () => sair(false),
    temSessao: async () => { const { data } = await sb.auth.getSession(); return !!(data && data.session); },
    usuario: () => (cache ? { email: cache.email, perfil: cache.perfil, usinaId: cache.usinaId } : null)
  };
  // Botões "Atualizar dados" dos relatórios
  window.BioMonitorAtualizacao = { abrir: () => atualizar(true) };

  iniciar();
})();
