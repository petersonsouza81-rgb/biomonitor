// =========================================================================
// BOTÃO "ATUALIZAR DADOS": pede ao GitHub para buscar vistorias e fotos
// novas no KoboToolbox (workflow .github/workflows/atualizar_base.yml).
// O token do GitHub fica só no navegador de quem atualiza (nunca no código).
// =========================================================================
(function () {
  const REPO = "petersonsouza81-rgb/biomonitor";
  const WORKFLOW = "atualizar_base.yml";
  const TOKEN_KEY = "biomonitor_github_token";
  const LINK_ACTIONS = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;
  const LINK_NOVO_TOKEN = "https://github.com/settings/personal-access-tokens/new";
  const API = `https://api.github.com/repos/${REPO}`;

  const css = `
    #biomonitor-upd-backdrop { position: fixed; inset: 0; background: rgba(2, 6, 23, 0.7); z-index: 99998; display: none; }
    #biomonitor-upd-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(460px, calc(100vw - 32px));
      max-height: calc(100vh - 32px); overflow-y: auto; background: #1e293b; color: #f8fafc; border: 1px solid #334155;
      border-radius: 12px; padding: 18px; z-index: 99999; display: none; font-size: 13px; line-height: 1.5;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6); }
    #biomonitor-upd-modal h3 { font-size: 16px; font-weight: 800; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
    #biomonitor-upd-modal p { color: #cbd5e1; margin-bottom: 10px; }
    #biomonitor-upd-modal ol { color: #cbd5e1; margin: 0 0 10px 18px; }
    #biomonitor-upd-modal a { color: #4ade80; font-weight: 700; }
    #biomonitor-upd-modal input { width: 100%; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 8px;
      padding: 9px 10px; font-size: 13px; margin-bottom: 10px; font-family: monospace; }
    #biomonitor-upd-modal .upd-acoes { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    #biomonitor-upd-modal button { border: none; border-radius: 8px; padding: 9px 14px; font-size: 13px; font-weight: 700; cursor: pointer;
      color: #fff; background: #334155; display: inline-flex; align-items: center; gap: 6px; }
    #biomonitor-upd-modal button.upd-principal { background: #15803d; }
    #biomonitor-upd-modal .upd-etapa { display: flex; gap: 8px; align-items: center; padding: 4px 0; color: #94a3b8; }
    #biomonitor-upd-modal .upd-etapa.ativa { color: #f8fafc; font-weight: 700; }
    #biomonitor-upd-modal .upd-etapa.ok { color: #4ade80; }
    #biomonitor-upd-modal .upd-etapa.erro { color: #f87171; font-weight: 700; }
    #biomonitor-upd-modal small { color: #94a3b8; }
  `;

  let modal, backdrop, emAndamento = false;

  function lerToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function gravarToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function montar() {
    if (modal) return;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    backdrop = document.createElement("div");
    backdrop.id = "biomonitor-upd-backdrop";
    backdrop.onclick = () => { if (!emAndamento) fechar(); };
    modal = document.createElement("div");
    modal.id = "biomonitor-upd-modal";
    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
  }

  function abrir(html) {
    montar();
    modal.innerHTML = html;
    backdrop.style.display = "block";
    modal.style.display = "block";
  }

  function fechar() {
    if (modal) modal.style.display = "none";
    if (backdrop) backdrop.style.display = "none";
  }

  function telaToken(msgErro) {
    abrir(`
      <h3><i class="fa-solid fa-cloud-arrow-down"></i> Atualizar dados do Kobo</h3>
      ${msgErro ? `<p style="color:#f87171;font-weight:700;">${msgErro}</p>` : ""}
      <p>Na primeira vez, cole a <strong>chave de acesso do BioMonitor</strong> gerada na sua conta do GitHub. Ela fica salva só neste navegador.</p>
      <p><small>Para gerar a chave (na sua conta do GitHub):</small></p>
      <ol>
        <li>Entre no GitHub com a sua conta e abra <a href="${LINK_NOVO_TOKEN}" target="_blank" rel="noopener">este link</a>.</li>
        <li>Em <em>Repository access</em>, escolha <strong>Only select repositories</strong> → <strong>o seu repositório</strong>.</li>
        <li>Em <em>Permissions</em>, deixe <strong>Actions: Read and write</strong>.</li>
        <li>Clique em <strong>Generate token</strong> e cole aqui.</li>
      </ol>
      <input type="password" id="biomonitor-upd-token" placeholder="github_pat_..." autocomplete="off">
      <div class="upd-acoes">
        <button onclick="window.open('${LINK_ACTIONS}', '_blank')"><i class="fa-brands fa-github"></i> Atualizar pelo GitHub</button>
        <button onclick="BioMonitorAtualizacao.fechar()">Cancelar</button>
        <button class="upd-principal" onclick="BioMonitorAtualizacao.salvarTokenEAtualizar()"><i class="fa-solid fa-rotate"></i> Salvar e atualizar</button>
      </div>
    `);
    setTimeout(() => { const i = document.getElementById("biomonitor-upd-token"); if (i) i.focus(); }, 100);
  }

  function telaProgresso(etapa, erro) {
    const etapas = ["Pedido enviado ao GitHub", "Baixando vistorias e fotos do Kobo", "Publicando no site", "Pronto! Recarregando..."];
    abrir(`
      <h3><i class="fa-solid fa-cloud-arrow-down"></i> Atualizando dados</h3>
      ${etapas.map((t, i) => {
        const cls = erro && i === etapa ? "erro" : (i < etapa ? "ok" : (i === etapa ? "ativa" : ""));
        const ic = cls === "ok" ? "fa-circle-check" : (cls === "erro" ? "fa-circle-xmark" : (cls === "ativa" ? "fa-spinner fa-spin" : "fa-circle"));
        return `<div class="upd-etapa ${cls}"><i class="fa-solid ${ic}"></i> ${t}</div>`;
      }).join("")}
      ${erro ? `<p style="color:#f87171;margin-top:8px;">${erro}</p>
        <div class="upd-acoes"><button onclick="window.open('${LINK_ACTIONS}', '_blank')"><i class="fa-brands fa-github"></i> Ver no GitHub</button>
        <button onclick="BioMonitorAtualizacao.fechar()">Fechar</button></div>`
        : `<p style="margin-top:8px;"><small>Leva de 2 a 5 minutos. Pode deixar esta tela aberta.</small></p>`}
    `);
  }

  const esperar = ms => new Promise(r => setTimeout(r, ms));

  function api(caminho, token, opcoes = {}) {
    return fetch(API + caminho, {
      ...opcoes,
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", ...(opcoes.headers || {}) },
      cache: "no-store"
    });
  }

  async function dataBaseAtual() {
    try {
      const txt = await (await fetch(`dados_mapa.js?t=${Date.now()}`, { cache: "no-store" })).text();
      const m = txt.match(/DADOS_ATUALIZADO_EM = "([^"]+)"/);
      return m ? m[1] : "";
    } catch (e) { return ""; }
  }

  async function atualizar() {
    const token = lerToken();
    if (!token) return telaToken();
    if (emAndamento) return;
    emAndamento = true;
    try {
      const antes = await dataBaseAtual();
      const pedidoEm = Date.now();
      telaProgresso(0);
      const resp = await api(`/actions/workflows/${WORKFLOW}/dispatches`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main" })
      });
      if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
        gravarToken("");
        emAndamento = false;
        return telaToken("A chave foi recusada pelo GitHub (vencida ou sem permissão de Actions). Gere uma nova.");
      }
      if (!resp.ok) throw new Error(`GitHub respondeu ${resp.status}.`);

      // Acompanha a execução que acabou de ser criada
      telaProgresso(1);
      let run = null;
      for (let i = 0; i < 120 && !(run && run.status === "completed"); i++) {
        await esperar(5000);
        const r = await api(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=5`, token);
        if (!r.ok) continue;
        const js = await r.json();
        run = (js.workflow_runs || []).find(w => new Date(w.created_at).getTime() >= pedidoEm - 60000) || run;
      }
      if (!run || run.status !== "completed") throw new Error("A atualização está demorando mais que o normal. Confira no GitHub.");
      if (run.conclusion !== "success") throw new Error("A atualização falhou no GitHub (veja o motivo em \"Ver no GitHub\").");

      // Espera o GitHub Pages servir a base nova
      telaProgresso(2);
      for (let i = 0; i < 60; i++) {
        const agora = await dataBaseAtual();
        if (agora && agora !== antes) break;
        await esperar(5000);
      }
      telaProgresso(3);
      await esperar(1200);
      location.reload();
    } catch (err) {
      emAndamento = false;
      telaProgresso(1, err.message || "Erro ao atualizar.");
    }
  }

  window.BioMonitorAtualizacao = {
    abrir: atualizar,
    fechar: fechar,
    salvarTokenEAtualizar() {
      const v = (document.getElementById("biomonitor-upd-token") || {}).value || "";
      if (!v.trim()) return;
      gravarToken(v.trim());
      atualizar();
    },
    esquecerToken() { gravarToken(""); }
  };
})();
