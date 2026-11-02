(() => {
  "use strict";
  const CATALOG_URL = "https://raw.githubusercontent.com/detiillimichel-max/TV-BRASIL-ENGINE/main/data/catalog-final.json";
  const $ = (id) => document.getElementById(id);
  const state = { channels: [], results: new Map(), selectedId: null, hls: null, mediaTimer: null };
  const video = $("video");

  function setPill(el, type, label) {
    el.className = "status-pill " + type;
    el.innerHTML = "<i></i>" + label;
  }
  function stopPlayback() {
    if (state.mediaTimer) clearTimeout(state.mediaTimer);
    state.mediaTimer = null;
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    video.pause();
    video.removeAttribute("src");
    video.load();
    $("video-placeholder").hidden = false;
    $("stop-btn").disabled = true;
  }
  function resultCounts() {
    const vals = [...state.results.values()];
    const ok = vals.filter(x => x.status === "playing").length;
    const fail = vals.filter(x => x.status === "failed").length;
    $("tested-count").textContent = vals.length;
    $("tested-detail").textContent = ok + " reproduziram · " + fail + " falharam";
  }
  function setResult(id, status, message) {
    state.results.set(id, {status, message, at: Date.now()});
    resultCounts();
    renderChannels();
  }
  function categoryList(channel) {
    return Array.isArray(channel.categories) && channel.categories.length ? channel.categories : [channel.category || "Undefined"];
  }
  function renderFilters() {
    const cats = [...new Set(state.channels.flatMap(categoryList))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    $("category-filter").innerHTML = '<option value="">Todas as categorias</option>' + cats.map(c=>'<option value="'+escapeHtml(c)+'">'+escapeHtml(c)+'</option>').join("");
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function renderChannels() {
    const q = $("search-input").value.trim().toLocaleLowerCase("pt-BR");
    const cat = $("category-filter").value;
    const fmt = $("format-filter").value;
    const filter = $("result-filter").value;
    const list = state.channels.filter(c => {
      const result = state.results.get(c.id);
      return (!q || (c.name+" "+c.id).toLocaleLowerCase("pt-BR").includes(q)) &&
        (!cat || categoryList(c).includes(cat)) && (!fmt || c.format === fmt) &&
        (!filter || (filter === "untested" ? !result : result?.status === filter));
    });
    $("visible-count").textContent = list.length + " canais";
    $("channel-grid").innerHTML = list.length ? list.map(c => {
      const result = state.results.get(c.id);
      const selected = state.selectedId === c.id;
      const resultClass = result?.status === "playing" ? "ok" : result?.status === "failed" ? "bad" : "";
      const resultLabel = result ? result.message : "Ainda não testado";
      const initials = escapeHtml((c.name || "TV").replace(/[^\p{L}\p{N} ]/gu,"").split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase());
      return '<article class="channel-card '+(selected?'selected':'')+'"><div class="channel-logo">'+(c.logo ? '<img loading="lazy" src="'+escapeHtml(c.logo)+'" alt="" onerror="this.remove();this.parentElement.innerHTML=\'<span class=&quot;logo-fallback&quot;>'+initials+'</span>\'">' : '<span class="logo-fallback">'+initials+'</span>')+'</div><div class="channel-info"><div class="channel-name">'+escapeHtml(c.name)+'</div><div class="channel-meta"><span>'+escapeHtml(categoryList(c)[0])+'</span><span class="tag">'+escapeHtml(c.format || "formato?")+'</span></div><div class="result-line"><span class="result-text '+resultClass+'">'+escapeHtml(resultLabel)+'</span><button class="test-btn" data-test="'+escapeHtml(c.id)+'">Testar</button></div></div></article>';
    }).join("") : '<div class="empty-state">Nenhuma emissora corresponde aos filtros.</div>';
    $("channel-grid").querySelectorAll("[data-test]").forEach(btn => btn.addEventListener("click", () => testChannel(btn.dataset.test)));
  }
  function updateTechnical(text) { $("technical-info").textContent = text; }
  function fail(id, message, detail) {
    setPill($("playback-status"), "bad", "Falha na reprodução");
    $("diagnostic-message").textContent = message;
    updateTechnical(detail || message);
    setResult(id, "failed", message);
  }
  function testChannel(id) {
    const channel = state.channels.find(c => c.id === id);
    if (!channel) return;
    stopPlayback();
    state.selectedId = id;
    $("selected-name").textContent = channel.name;
    $("selected-meta").textContent = categoryList(channel).join(" · ") + " · " + String(channel.format || "formato desconhecido").toUpperCase();
    setPill($("playback-status"), "pending", "Iniciando teste");
    $("diagnostic-message").textContent = "Conectando à transmissão. Aguarde o navegador tentar carregar o vídeo.";
    updateTechnical("URL: " + channel.url + " | Formato: " + channel.format);
    $("video-placeholder").hidden = true;
    $("stop-btn").disabled = false;
    renderChannels();

    if (channel.format === "mpegts") {
      fail(id, "MPEG-TS não é reproduzido diretamente por este player web. O canal foi preservado; precisa de gateway autorizado para conversão.", "Formato MPEG-TS | URL: " + channel.url);
      return;
    }
    if (!channel.url || !/^https?:\/\//i.test(channel.url)) {
      fail(id, "Endereço da transmissão inválido ou ausente.");
      return;
    }
    const isHls = channel.format === "hls" || /\.m3u8($|\?)/i.test(channel.url);
    if (!isHls) {
      fail(id, "Formato ainda não suportado pelo teste HLS.", "Formato informado: " + channel.format);
      return;
    }

    const onPlaying = () => {
      if (state.selectedId !== id) return;
      setPill($("playback-status"), "ok", "Reproduzindo");
      $("diagnostic-message").textContent = "Sucesso: o vídeo começou a reproduzir neste navegador e nesta rede.";
      updateTechnical("PLAYING confirmado | " + channel.url);
      setResult(id, "playing", "Reproduziu");
    };
    const onError = () => {
      if (state.selectedId !== id) return;
      fail(id, "O navegador não conseguiu reproduzir. Possíveis causas: CORS, conteúdo misto HTTP/HTTPS, bloqueio geográfico, URL expirada ou incompatibilidade do servidor.", "Erro de mídia do navegador | URL: " + channel.url);
    };
    video.addEventListener("playing", onPlaying, {once:true});
    video.addEventListener("error", onError, {once:true});
    state.mediaTimer = setTimeout(() => {
      if (state.selectedId === id && video.paused) {
        fail(id, "A transmissão não começou em 15 segundos. Verifique CORS, rede, playlist e segmentos.", "Timeout de reprodução (15s) | URL: " + channel.url);
      }
    }, 15000);

    if (window.Hls && Hls.isSupported()) {
      state.hls = new Hls({enableWorker:true, lowLatencyMode:false, manifestLoadingTimeOut:12000, fragLoadingTimeOut:12000});
      state.hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || state.selectedId !== id) return;
        const detail = "HLS fatal: " + data.type + " / " + data.details + " | URL: " + channel.url;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) state.hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) state.hls.recoverMediaError();
        else fail(id, "HLS.js encontrou um erro fatal. Pode ser CORS, playlist ou segmentos inacessíveis.", detail);
      });
      state.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        updateTechnical("Playlist HLS carregada; aguardando decodificação e reprodução. " + channel.url);
        video.play().catch(() => {
          $("diagnostic-message").textContent = "Playlist carregada. Toque no botão de reprodução do vídeo para concluir o teste.";
          setPill($("playback-status"), "pending", "Aguardando toque");
        });
      });
      state.hls.loadSource(channel.url);
      state.hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = channel.url;
      video.play().catch(() => setPill($("playback-status"), "pending", "Toque para reproduzir"));
    } else {
      fail(id, "Este navegador não oferece suporte HLS nativo e HLS.js não está disponível. Confira a conexão com a biblioteca do player.");
    }
  }
  async function loadCatalog() {
    stopPlayback();
    setPill($("api-status"), "pending", "Carregando catálogo");
    $("channel-grid").innerHTML = '<div class="empty-state">Buscando catálogo no TV-BRASIL-ENGINE...</div>';
    try {
      const response = await fetch(CATALOG_URL + "?t=" + Date.now(), {cache:"no-store"});
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      if (!Array.isArray(data.channels)) throw new Error("O JSON não contém a lista channels.");
      state.channels = data.channels;
      state.results.clear();
      $("total-count").textContent = data.channels.length;
      $("hls-count").textContent = data.channels.filter(c=>c.format==="hls").length;
      $("ts-count").textContent = data.channels.filter(c=>c.format==="mpegts").length;
      $("updated-at").textContent = "Atualizado em " + (data.updated_at ? new Date(data.updated_at).toLocaleString("pt-BR") : "data não informada");
      renderFilters();
      renderChannels();
      setPill($("api-status"), "ok", "Catálogo conectado");
      $("tested-count").textContent = "0";
      $("tested-detail").textContent = "nenhum teste iniciado";
    } catch (error) {
      setPill($("api-status"), "bad", "Catálogo indisponível");
      $("channel-grid").innerHTML = '<div class="empty-state">Não foi possível carregar o JSON. Erro: '+escapeHtml(error.message)+'. Verifique se o arquivo está público e se o GitHub Raw está acessível.</div>';
      updateTechnical("Falha ao buscar catálogo: " + error.message);
    }
  }
  $("reload-btn").addEventListener("click", loadCatalog);
  $("stop-btn").addEventListener("click", () => {
    stopPlayback();
    setPill($("playback-status"), "neutral", "Teste interrompido");
    $("diagnostic-message").textContent = "Teste interrompido manualmente.";
  });
  ["search-input","category-filter","format-filter","result-filter"].forEach(id => $(id).addEventListener(id==="search-input"?"input":"change", renderChannels));
  video.addEventListener("playing", () => { if(state.mediaTimer) clearTimeout(state.mediaTimer); });
  loadCatalog();
})();