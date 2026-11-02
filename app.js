(() => {
"use strict";
const CATALOG_URL="https://raw.githubusercontent.com/detiillimichel-max/TV-BRASIL-ENGINE/main/data/catalog-final.json";
const STORAGE_KEY="tv-brasil-engine-test-results-v2";
const LIBRARY_KEY="tv-brasil-engine-approved-library-v1";
function restoreFavorites(){
try{
const raw=localStorage.getItem(LIBRARY_KEY);
if(raw===null)return false;
const saved=JSON.parse(raw);
if(!Array.isArray(saved))return false;
saved.forEach(id=>{if(typeof id==="string"&&id)state.favorites.add(id);});
return true;
}catch(e){console.warn("Biblioteca local inválida; será tentada a recuperação pelo Blob.",e);return false;}
}
async function recoverLibraryFromBlob(restoreAll){
const backupUrl="https://osqdup2f2kumsdtb.public.blob.vercel-storage.com/backups/tv-brasil-engine-biblioteca-88-canais-2026-11-02T21-41-46-360Z.json";
try{
const response=await fetch(backupUrl,{cache:"no-store"});
if(!response.ok)throw new Error("HTTP "+response.status);
const backup=await response.json();
if(backup.total!==88||!Array.isArray(backup.channels)||backup.channels.length!==88)throw new Error("Backup não contém exatamente 88 canais.");
const ids=backup.channels.map(c=>c&&c.id);
if(ids.some(id=>typeof id!=="string"||!id)||new Set(ids).size!==88)throw new Error("Backup com IDs ausentes ou duplicados.");
const catalogIds=new Set(state.channels.map(c=>c.id));
let recovered=0;
backup.channels.forEach(channel=>{
const shouldRestore=restoreAll||state.favorites.has(channel.id);
if(shouldRestore&&!catalogIds.has(channel.id)){
state.channels.push(channel);
catalogIds.add(channel.id);
}
if(restoreAll){
state.favorites.add(channel.id);
if(channel.validation&&channel.validation.status==="playing")state.results.set(channel.id,channel.validation);
recovered++;
}else if(state.favorites.has(channel.id)&&channel.validation&&channel.validation.status==="playing"&&!state.results.has(channel.id)){
state.results.set(channel.id,channel.validation);
}
});
if(restoreAll){
saveFavorites();
save();
state.libraryRecovered=true;
console.info("Biblioteca recuperada do Blob:",recovered,"canais.");
}else if(recovered===0&&state.favorites.size){
save();
}
return restoreAll?recovered:true;
}catch(error){
console.warn("Não foi possível recuperar a biblioteca pelo Blob:",error);
return false;
}
}
function saveFavorites(){try{localStorage.setItem(LIBRARY_KEY,JSON.stringify([...state.favorites]));}catch(e){}}
function refreshIcons(){if(window.lucide&&window.lucide.createIcons)window.lucide.createIcons();}
function switchTab(tab){const lib=tab==="library";$("catalog-section").hidden=lib;$("library-section").hidden=!lib;document.querySelectorAll(".main-tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));state.activeTab=tab;renderLibrary();refreshIcons();}
function toggleFavorite(id){const r=state.results.get(id);if(!r||r.status!=="playing")return;if(state.favorites.has(id))state.favorites.delete(id);else state.favorites.add(id);saveFavorites();const c=findCard(id),b=c&&c.querySelector("[data-favorite]");if(b)b.classList.toggle("saved",state.favorites.has(id));renderLibrary();}
function exportApprovedLibrary(){
const ids=[...state.favorites];
const channels=state.channels.filter(c=>state.favorites.has(c.id));
const missing=ids.filter(id=>!state.channels.some(c=>c.id===id));
if(!ids.length){alert("A biblioteca está vazia neste navegador. Não foi criado nenhum arquivo.");return;}
if(missing.length||channels.length!==ids.length){alert("Exportação interrompida para evitar um backup incompleto. IDs salvos: "+ids.length+"; canais encontrados: "+channels.length+"; não encontrados: "+missing.length+". Mantenha esta página aberta.");return;}
const payload={
schema_version:1,
source:"TV-BRASIL-ENGINE",
exported_at:new Date().toISOString(),
total:channels.length,
description:"Backup completo da Minha biblioteca. Cada canal inclui os dados originais do catálogo e o resultado do teste local.",
channels:channels.map(channel=>({
...channel,
validation:state.results.get(channel.id)||null
}))
};
const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json;charset=utf-8"});
const url=URL.createObjectURL(blob);
const link=document.createElement("a");
link.href=url;
link.download="tv-brasil-engine-biblioteca-"+channels.length+"-canais.json";
document.body.appendChild(link);
link.click();
link.remove();
setTimeout(()=>URL.revokeObjectURL(url),1500);
alert("Backup gerado: "+channels.length+" canais completos. Confira a pasta Downloads do seu celular e não apague a biblioteca original ainda.");
}
function renderLibrary(){const list=state.channels.filter(c=>state.favorites.has(c.id));$("library-count").textContent=list.length;$("library-total").textContent=list.length+" canais";$("library-grid").innerHTML=list.length?list.map(c=>'<article class="channel-card"><div class="channel-logo">'+(c.logo?'<img loading="lazy" src="'+esc(c.logo)+'" alt="">':'<span class="logo-fallback">TV</span>')+'</div><div class="channel-info"><div class="channel-name">'+esc(c.name)+'</div><div class="channel-meta">'+esc(cats(c)[0])+' · HLS</div><div class="library-card-actions"><button class="button primary" data-lib-play="'+esc(c.id)+'">Reproduzir</button><button class="button secondary" data-lib-remove="'+esc(c.id)+'">Remover</button></div></div></article>').join(""):'<div class="empty-state">Nenhum canal salvo ainda. Teste uma emissora e adicione-a quando vídeo e áudio forem confirmados.</div>';$("library-grid").querySelectorAll("[data-lib-play]").forEach(b=>b.addEventListener("click",()=>{const id=b.dataset.libPlay;switchTab("catalog");renderChannels();testChannel(id);}));$("library-grid").querySelectorAll("[data-lib-remove]").forEach(b=>b.addEventListener("click",()=>toggleFavorite(b.dataset.libRemove)));refreshIcons();}
function isYouTube(url){try{const u=new URL(url);return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname);}catch(e){return false;}}
function showExternalFallback(id){const c=findCard(id);const ch=state.channels.find(x=>x.id===id);if(!c||!ch||!ch.url)return;const actions=c.querySelector(".mini-actions");if(!actions||actions.querySelector("[data-external]"))return;const a=document.createElement("a");a.className="external-btn";a.dataset.external="1";a.href=ch.url;a.target="_blank";a.rel="noopener noreferrer";a.innerHTML=isYouTube(ch.url)?'<i data-lucide="external-link"></i> Abrir no YouTube':'<i data-lucide="external-link"></i> Abrir externamente';actions.insertBefore(a,actions.lastElementChild);refreshIcons();}

const $=id=>document.getElementById(id);
const state={channels:[],results:new Map(),favorites:new Set(),activeId:null,hls:null,video:null,mediaTimer:null,frameTimer:null,activeTab:"catalog",libraryRecovered:false};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cats=c=>Array.isArray(c.categories)&&c.categories.length?c.categories:[c.category||"Undefined"];
function setStatus(el,type,label){if(el.id==="api-status"){el.className="status-pill "+type;el.innerHTML="<i></i>"+label;}else{el.className="mini-status "+type;el.textContent=label;}}
function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify([...state.results.entries()]));}catch(e){console.warn("Falha ao salvar histórico",e);}}
function restore(){try{const a=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");if(Array.isArray(a))a.forEach(pair=>{if(Array.isArray(pair)&&typeof pair[0]==="string"&&pair[1])state.results.set(pair[0],pair[1]);});}catch(e){console.warn("Histórico local inválido",e);}}
function cls(s){return s==="playing"?"ok":s==="failed"?"bad":s==="audio_only"?"warn":"";}
function counts(){const a=[...state.results.values()],ok=a.filter(x=>x.status==="playing").length,audio=a.filter(x=>x.status==="audio_only").length,fail=a.filter(x=>x.status==="failed").length;$("tested-count").textContent=a.length;$("tested-detail").textContent=ok+" com vídeo · "+audio+" só áudio · "+fail+" falharam";}
function setResult(id,status,message,detail){state.results.set(id,{status,message,detail:detail||"",at:Date.now()});save();counts();const card=findCard(id);if(card){const label=card.querySelector("[data-result]");label.textContent=message;label.className="result-text "+cls(status);const diag=card.querySelector("[data-diagnostic]");if(diag)diag.textContent=message;const tech=card.querySelector("[data-technical]");if(tech&&detail)tech.textContent=detail;if(status==="playing"){let b=card.querySelector("[data-favorite]");if(!b){b=document.createElement("button");b.className="favorite-btn";b.dataset.favorite=id;b.title="Adicionar à biblioteca";b.setAttribute("aria-label","Adicionar à biblioteca");b.innerHTML='<i data-lucide="list-video"></i>';card.querySelector(".result-line").appendChild(b);b.addEventListener("click",()=>toggleFavorite(id));}b.classList.toggle("saved",state.favorites.has(id));refreshIcons();}else{const b=card.querySelector("[data-favorite]");if(b)b.remove();}}}
function findCard(id){return [...$("channel-grid").querySelectorAll(".channel-card")].find(x=>x.dataset.channelId===id);}
function stopActive(message){clearTimeout(state.mediaTimer);clearTimeout(state.frameTimer);state.mediaTimer=state.frameTimer=null;if(state.hls){state.hls.destroy();state.hls=null;}if(state.video){state.video.pause();state.video.removeAttribute("src");state.video.load();}if(state.activeId){const c=findCard(state.activeId);if(c){const s=c.querySelector("[data-status]");if(s)setStatus(s,"neutral",message?"Pausado":"Pronto");const d=c.querySelector("[data-diagnostic]");if(d&&message)d.textContent=message;c.classList.remove("active");}}state.activeId=null;state.video=null;}
function renderFilters(){const a=[...new Set(state.channels.flatMap(cats))].sort((a,b)=>a.localeCompare(b,"pt-BR"));$("category-filter").innerHTML='<option value="">Todas as categorias</option>'+a.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");}
function renderChannels(){const q=$("search-input").value.trim().toLocaleLowerCase("pt-BR"),cat=$("category-filter").value,fmt=$("format-filter").value,filter=$("result-filter").value;const list=state.channels.filter(c=>{const r=state.results.get(c.id);return(!q||(c.name+" "+c.id).toLocaleLowerCase("pt-BR").includes(q))&&(!cat||cats(c).includes(cat))&&(!fmt||c.format===fmt)&&(!filter||(filter==="untested"?!r:r?.status===filter));});
$("visible-count").textContent=list.length+" canais";
$("channel-grid").innerHTML=list.length?list.map(c=>{const r=state.results.get(c.id);const initials=esc((c.name||"TV").replace(/[^a-zA-Z0-9À-ÿ ]/g,"").split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase());const logo=c.logo?'<img loading="lazy" src="'+esc(c.logo)+'" alt="" onerror="this.remove()">':'<span class="logo-fallback">'+initials+'</span>';return '<article class="channel-card" data-channel-id="'+esc(c.id)+'"><div class="channel-logo">'+logo+'</div><div class="channel-info"><div class="channel-name">'+esc(c.name)+'</div><div class="channel-meta"><span>'+esc(cats(c)[0])+'</span><span class="tag">'+esc(c.format||"formato?")+'</span></div><div class="result-line"><span class="result-text '+cls(r?.status)+'" data-result>'+esc(r?.message||"Ainda não testado")+'</span><button class="test-btn" data-test="'+esc(c.id)+'">Testar</button></div></div><section class="channel-player" data-player hidden><div class="mini-player-head"><strong>PLAYER · '+esc(c.name)+'</strong><span class="mini-status neutral" data-status>Pronto para testar</span></div><div class="channel-video-wrap"><video class="channel-video" controls playsinline preload="none"></video><div class="mini-placeholder" data-placeholder>Player individual desta emissora. Toque em Testar.</div></div><p class="mini-diagnostic" data-diagnostic>Diagnóstico aguardando início.</p><div class="mini-technical" data-technical>URL: '+esc(c.url||"ausente")+' | Formato: '+esc(c.format||"desconhecido")+'</div><div class="mini-actions"><button class="button secondary" data-stop disabled>Parar teste</button><button class="button secondary" data-close>Fechar painel</button></div></section></article>';}).join(""):'<div class="empty-state">Nenhuma emissora corresponde aos filtros.</div>';
$("channel-grid").querySelectorAll("[data-test]").forEach(b=>b.addEventListener("click",()=>testChannel(b.dataset.test)));
$("channel-grid").querySelectorAll(".channel-card").forEach(c=>{const id=c.dataset.channelId;if(state.results.get(id)?.status==="playing"&&!c.querySelector("[data-favorite]")){const b=document.createElement("button");b.className="favorite-btn"+(state.favorites.has(id)?" saved":"");b.dataset.favorite=id;b.title="Adicionar à biblioteca";b.setAttribute("aria-label","Adicionar à biblioteca");b.innerHTML='<i data-lucide="list-video"></i>';c.querySelector(".result-line").appendChild(b);b.addEventListener("click",()=>toggleFavorite(id));}});
$("channel-grid").querySelectorAll("[data-stop]").forEach(b=>b.addEventListener("click",()=>{const c=b.closest(".channel-card");if(c.dataset.channelId===state.activeId)stopActive("Teste interrompido manualmente.");b.disabled=true;}));
$("channel-grid").querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>{const c=b.closest(".channel-card");if(c.dataset.channelId===state.activeId)stopActive("Player fechado.");c.querySelector("[data-player]").hidden=true;}));
}
function fail(id,msg,detail){showExternalFallback(id);const c=findCard(id);if(c){setStatus(c.querySelector("[data-status]"),"bad","Falha na reprodução");c.querySelector("[data-diagnostic]").textContent=msg;c.querySelector("[data-technical]").textContent=detail||msg;c.querySelector("[data-stop]").disabled=true;}setResult(id,"failed",msg,detail);}
function testChannel(id){const ch=state.channels.find(x=>x.id===id);if(!ch)return;stopActive("Outro canal foi selecionado; este player foi pausado.");const c=findCard(id);if(!c)return;const panel=c.querySelector("[data-player]"),v=c.querySelector("video");panel.hidden=false;c.classList.add("active");state.activeId=id;state.video=v;const status=c.querySelector("[data-status]"),diag=c.querySelector("[data-diagnostic]"),tech=c.querySelector("[data-technical]"),placeholder=c.querySelector("[data-placeholder]"),stop=c.querySelector("[data-stop]");setStatus(status,"pending","Iniciando teste");diag.textContent="Conectando à transmissão. Aguarde o carregamento.";tech.textContent="URL: "+ch.url+" | Formato: "+ch.format;placeholder.hidden=true;stop.disabled=false;panel.scrollIntoView({behavior:"smooth",block:"nearest"});
if(ch.format==="mpegts"){fail(id,"MPEG-TS não é reproduzido diretamente pelo player HLS. Canal preservado para suporte futuro.","Formato MPEG-TS | "+ch.url);return;}
if(!ch.url||!/^https?:\/\//i.test(ch.url)){fail(id,"Endereço da transmissão inválido ou ausente.");return;}
if(!(ch.format==="hls"||/\.m3u8($|\?)/i.test(ch.url))){fail(id,"Formato ainda não suportado.","Formato: "+ch.format);return;}
const playing=()=>{if(state.activeId!==id)return;clearTimeout(state.mediaTimer);setStatus(status,"pending","Verificando imagem");diag.textContent="Fluxo iniciado. Verificando quadros de vídeo além do áudio.";state.frameTimer=setTimeout(()=>{if(state.activeId!==id)return;const w=v.videoWidth||0,h=v.videoHeight||0;if(w&&h){setStatus(status,"ok","Vídeo + áudio confirmados");diag.textContent="Imagem confirmada: "+w+" × "+h+" pixels. Áudio também iniciado.";tech.textContent="VIDEO confirmado | "+w+"x"+h+" | "+ch.url;setResult(id,"playing","Vídeo + áudio",tech.textContent);}else{setStatus(status,"pending","Somente áudio detectado");diag.textContent="O áudio iniciou, mas nenhum quadro de vídeo foi detectado após 5 segundos.";const codec=state.hls?.levels?.map(x=>x.videoCodec||"codec não informado").join(", ")||"codec de vídeo não identificado";tech.textContent="AUDIO sem quadro de vídeo | "+codec+" | "+ch.url;setResult(id,"audio_only","Somente áudio",tech.textContent);showExternalFallback(id);}},5000);};
v.addEventListener("playing",playing,{once:true});v.addEventListener("error",()=>{if(state.activeId===id)fail(id,"O navegador não conseguiu reproduzir. Possíveis causas: CORS, bloqueio HTTP, geográfico ou incompatibilidade.","Erro de mídia | "+ch.url);},{once:true});
state.mediaTimer=setTimeout(()=>{if(state.activeId===id&&v.paused)fail(id,"A transmissão não começou em 20 segundos. Verifique playlist, CORS, rede e segmentos.","Timeout 20s | "+ch.url);},20000);
if(window.Hls&&Hls.isSupported()){state.hls=new Hls({enableWorker:true,lowLatencyMode:false,manifestLoadingTimeOut:15000,fragLoadingTimeOut:15000});state.hls.on(Hls.Events.ERROR,(_e,d)=>{if(!d.fatal||state.activeId!==id)return;const info="HLS fatal: "+d.type+" / "+d.details+" | "+ch.url;if(d.type===Hls.ErrorTypes.NETWORK_ERROR)state.hls.startLoad();else if(d.type===Hls.ErrorTypes.MEDIA_ERROR)state.hls.recoverMediaError();else fail(id,"HLS.js encontrou erro fatal. Verifique playlist e segmentos.",info);});state.hls.on(Hls.Events.MANIFEST_PARSED,()=>{tech.textContent="Playlist carregada; aguardando reprodução. "+ch.url;v.play().catch(()=>{setStatus(status,"pending","Toque em play");diag.textContent="Playlist carregada. Toque no play deste player para continuar.";});});state.hls.loadSource(ch.url);state.hls.attachMedia(v);}else if(v.canPlayType("application/vnd.apple.mpegurl")){v.src=ch.url;v.play().catch(()=>{setStatus(status,"pending","Toque em play");diag.textContent="Toque no play do player para iniciar.";});}else fail(id,"Este navegador não oferece suporte HLS e HLS.js não está disponível.");}
async function loadCatalog(){stopActive("Catálogo atualizado.");$("channel-grid").innerHTML='<div class="empty-state">Buscando catálogo...</div>';try{setStatus($("api-status"),"pending","Carregando catálogo");const r=await fetch(CATALOG_URL+"?t="+Date.now(),{cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);const data=await r.json();if(!Array.isArray(data.channels))throw new Error("JSON sem lista channels");state.channels=data.channels;restore();const hasLocalLibrary=restoreFavorites();if(!hasLocalLibrary||[...state.favorites].some(id=>!state.channels.some(c=>c.id===id)))await recoverLibraryFromBlob(!hasLocalLibrary);const valid=new Set(state.channels.map(c=>c.id));for(const id of state.results.keys())if(!valid.has(id))state.results.delete(id);save();$("total-count").textContent=state.channels.length;$("catalog-tab-count").textContent=state.channels.length;$("hls-count").textContent=state.channels.filter(c=>c.format==="hls").length;$("ts-count").textContent=state.channels.filter(c=>c.format==="mpegts").length;$("updated-at").textContent="Catálogo atualizado em "+(data.updated_at?new Date(data.updated_at).toLocaleString("pt-BR"):"data não informada");renderFilters();renderChannels();renderLibrary();counts();setStatus($("api-status"),"ok","Catálogo conectado");refreshIcons();}catch(e){setStatus($("api-status"),"bad","Catálogo indisponível");$("channel-grid").innerHTML='<div class="empty-state">Não foi possível carregar o catálogo: '+esc(e.message)+'</div>';}}
$("export-library-btn").addEventListener("click",exportApprovedLibrary);$("reload-btn").addEventListener("click",loadCatalog);document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));["search-input","category-filter","format-filter","result-filter"].forEach(id=>$(id).addEventListener(id==="search-input"?"input":"change",renderChannels));loadCatalog();
})();