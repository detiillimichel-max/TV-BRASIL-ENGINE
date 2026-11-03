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
function switchTab(tab){
state.activeTab=tab;
$("catalog-section").hidden=tab!=="catalog";
$("library-section").hidden=tab!=="library";
$("channels-section").hidden=tab!=="channels";
$("feed-section").hidden=tab!=="feed";
$("featured-player").hidden=!(tab==="channels"||tab==="feed");
$("featured-player").classList.toggle("feed-player-mode",tab==="feed");
document.querySelectorAll(".main-tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
if(tab==="library")renderLibrary();
if(tab==="channels")renderChannelRows();
if(tab==="feed"){renderTvFeed();if(!state.featuredId&&state.approvedChannels.length)playFeaturedChannel(state.approvedChannels[0].id);}
refreshIcons();
}
function toggleFavorite(id){const r=state.results.get(id);if(!r||!(r.status==="playing"||r.status==="PLAYING"))return;if(state.favorites.has(id))state.favorites.delete(id);else state.favorites.add(id);saveFavorites();const c=findCard(id),b=c&&c.querySelector("[data-favorite]");if(b)b.classList.toggle("saved",state.favorites.has(id));renderLibrary();}
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

function stopFeatured(){
if(state.featuredHls){state.featuredHls.destroy();state.featuredHls=null;}if(state.featuredMpegts){state.featuredMpegts.destroy();state.featuredMpegts=null;}
const v=$("featured-video");v.pause();v.removeAttribute("src");v.load();state.featuredId=null;
}
function playFeaturedChannel(id){
const ch=state.approvedChannels.find(x=>x.id===id);if(!ch)return;
stopActive("Player principal selecionado.");stopFeatured();
state.featuredId=id;
const v=$("featured-video"),stage=$("featured-stage");
$("featured-player").hidden=false;$("featured-title").textContent=ch.name;
$("featured-channel-name").textContent=ch.name;$("featured-category").textContent=cats(ch)[0]||"Emissora";
$("featured-placeholder").hidden=true;$("featured-status").textContent="Conectando à transmissão...";
$("featured-favorite").classList.toggle("is-favorite",state.favorites.has(id));
if(ch.format!=="hls"&&!/\.m3u8($|\?)/i.test(ch.url||"")){$("featured-status").textContent="Formato não suportado neste player.";return;}
v.muted=false;
v.onerror=()=>{$("featured-status").textContent="Não foi possível reproduzir esta transmissão neste navegador.";};
v.onplaying=()=>{$("featured-status").textContent="Transmissão conectada · "+ch.name;};
if(window.Hls&&Hls.isSupported()){
state.featuredHls=new Hls({enableWorker:true,lowLatencyMode:false,manifestLoadingTimeOut:15000,fragLoadingTimeOut:15000});
state.featuredHls.on(Hls.Events.ERROR,(_e,d)=>{if(d.fatal)$("featured-status").textContent="Falha na transmissão. Tente novamente mais tarde.";});
state.featuredHls.on(Hls.Events.MANIFEST_PARSED,()=>v.play().catch(()=>{$("featured-status").textContent="Toque em reproduzir para iniciar."; }));
state.featuredHls.loadSource(ch.url);state.featuredHls.attachMedia(v);
}else if(v.canPlayType("application/vnd.apple.mpegurl")){v.src=ch.url;v.play().catch(()=>{$("featured-status").textContent="Toque em reproduzir para iniciar.";});}
else $("featured-status").textContent="Este navegador não oferece suporte a HLS.";
renderTvFeed();
}
function renderChannelRows(){
const channels=state.approvedChannels;if(!channels.length)return;
const groups=[
["Todos os canais",()=>true],
["Notícias",c=>cats(c).some(x=>/news|not[ií]cia/i.test(x))],
["Filmes e séries",c=>cats(c).some(x=>/movie|film|series|classic/i.test(x))],
["Infantil e animação",c=>cats(c).some(x=>/kids|child|animation|cartoon/i.test(x))],
["Educação e cultura",c=>cats(c).some(x=>/education|culture|documentary/i.test(x))],
["Entretenimento",c=>cats(c).some(x=>/entertainment|comedy|general/i.test(x))],
["Esportes",c=>cats(c).some(x=>/sport/i.test(x))],
["Outras emissoras",c=>cats(c).some(x=>/religious|music|shop|outdoor/i.test(x))]
];
$("channel-rows").innerHTML=groups.map(([title,match],i)=>{
const list=channels.filter(match);
return '<section class="channel-row"><div class="channel-row-head"><h3>'+esc(title)+'</h3><span>'+list.length+' canais</span></div><div class="channel-carousel">'+list.map(c=>'<button class="station-card" data-station="'+esc(c.id)+'" type="button"><span class="station-logo">'+(c.logo?'<img loading="lazy" src="'+esc(c.logo)+'" alt="" onerror="this.style.display=\'none\'">':'<i data-lucide="tv"></i>')+'</span><strong>'+esc(c.name)+'</strong><span class="station-live"><i></i> AO VIVO</span></button>').join("")+'</div></section>';
}).join("");
$("channel-rows").querySelectorAll("[data-station]").forEach(b=>b.addEventListener("click",()=>{playFeaturedChannel(b.dataset.station);$("featured-player").scrollIntoView({behavior:"smooth",block:"start"});}));
refreshIcons();
}
function renderTvFeed(){
const list=state.approvedChannels;if(!list.length)return;
const active=list.findIndex(c=>c.id===state.featuredId);
$("feed-position").textContent="Canal "+(active<0?1:active+1)+" de "+list.length;
$("feed-list").innerHTML=list.map((c,i)=>'<button type="button" class="feed-channel'+(c.id===state.featuredId?' active':'')+'" data-feed-channel="'+esc(c.id)+'"><span class="feed-channel-logo">'+(c.logo?'<img loading="lazy" src="'+esc(c.logo)+'" alt="">':'<i data-lucide="tv"></i>')+'</span><span class="feed-channel-copy"><strong>'+esc(c.name)+'</strong><small>'+esc(cats(c)[0])+' · Canal '+(i+1)+'</small></span><i data-lucide="play-circle"></i></button>').join("");
$("feed-list").querySelectorAll("[data-feed-channel]").forEach(b=>b.addEventListener("click",()=>playFeaturedChannel(b.dataset.feedChannel)));
refreshIcons();
}
function stepFeatured(direction){
const list=state.approvedChannels;if(!list.length)return;
let i=list.findIndex(c=>c.id===state.featuredId);i=(i+direction+list.length)%list.length;playFeaturedChannel(list[i].id);
}

function isYouTube(url){try{const u=new URL(url);return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname);}catch(e){return false;}}
function showExternalFallback(id){const c=findCard(id);const ch=state.channels.find(x=>x.id===id);if(!c||!ch||!ch.url)return;const actions=c.querySelector(".mini-actions");if(!actions||actions.querySelector("[data-external]"))return;const a=document.createElement("a");a.className="external-btn";a.dataset.external="1";a.href=ch.url;a.target="_blank";a.rel="noopener noreferrer";a.innerHTML=isYouTube(ch.url)?'<i data-lucide="external-link"></i> Abrir no YouTube':'<i data-lucide="external-link"></i> Abrir externamente';actions.insertBefore(a,actions.lastElementChild);refreshIcons();}

const $=id=>document.getElementById(id);
const state={channels:[],approvedChannels:[],results:new Map(),favorites:new Set(),activeId:null,hls:null,video:null,mediaTimer:null,frameTimer:null,featuredId:null,featuredHls:null,mpegts:null,playbackConfig:{schema_version:1,channels:{}},approvedIds:new Set(),activeTab:"catalog",libraryRecovered:false};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cats=c=>Array.isArray(c.categories)&&c.categories.length?c.categories:[c.category||"Undefined"];
function setStatus(el,type,label){if(el.id==="api-status"){el.className="status-pill "+type;el.innerHTML="<i></i>"+label;}else{el.className="mini-status "+type;el.textContent=label;}}
function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify([...state.results.entries()]));}catch(e){console.warn("Falha ao salvar histórico",e);}}
function restore(){try{const a=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");if(Array.isArray(a))a.forEach(pair=>{if(Array.isArray(pair)&&typeof pair[0]==="string"&&pair[1])state.results.set(pair[0],pair[1]);});}catch(e){console.warn("Histórico local inválido",e);}}
function isFailureStatus(s){return !!s&&s!=="playing"&&s!=="PLAYING"&&s!=="audio_only"&&s!=="AUDIO_ONLY";}
function cls(s){return s==="playing"||s==="PLAYING"?"ok":isFailureStatus(s)?"bad":s==="audio_only"||s==="AUDIO_ONLY"?"warn":"";}
function counts(){const a=[...state.results.values()],ok=a.filter(x=>x.status==="playing").length,audio=a.filter(x=>x.status==="audio_only").length,fail=a.filter(x=>isFailureStatus(x.status)).length;$("tested-count").textContent=a.length;$("tested-detail").textContent=ok+" com vídeo · "+audio+" só áudio · "+fail+" falharam";}
function setResult(id,status,message,detail){state.results.set(id,{status,message,detail:detail||"",at:Date.now()});save();counts();const card=findCard(id);if(card){const label=card.querySelector("[data-result]");label.textContent=message;label.className="result-text "+cls(status);const diag=card.querySelector("[data-diagnostic]");if(diag)diag.textContent=message;const tech=card.querySelector("[data-technical]");if(tech&&detail)tech.textContent=detail;if(status==="playing"){let b=card.querySelector("[data-favorite]");if(!b){b=document.createElement("button");b.className="favorite-btn";b.dataset.favorite=id;b.title="Adicionar à biblioteca";b.setAttribute("aria-label","Adicionar à biblioteca");b.innerHTML='<i data-lucide="list-video"></i>';card.querySelector(".result-line").appendChild(b);b.addEventListener("click",()=>toggleFavorite(id));}b.classList.toggle("saved",state.favorites.has(id));refreshIcons();}else{const b=card.querySelector("[data-favorite]");if(b)b.remove();}}}
function findCard(id){return [...$("channel-grid").querySelectorAll(".channel-card")].find(x=>x.dataset.channelId===id);}
function stopActive(message){clearTimeout(state.mediaTimer);clearTimeout(state.frameTimer);state.mediaTimer=state.frameTimer=null;if(state.hls){state.hls.destroy();state.hls=null;}if(state.mpegts){state.mpegts.destroy();state.mpegts=null;}if(state.video){state.video.pause();state.video.removeAttribute("src");state.video.load();}if(state.activeId){const c=findCard(state.activeId);if(c){const s=c.querySelector("[data-status]");if(s)setStatus(s,"neutral",message?"Pausado":"Pronto");const d=c.querySelector("[data-diagnostic]");if(d&&message)d.textContent=message;c.classList.remove("active");}}state.activeId=null;state.video=null;}
function renderFilters(){const a=[...new Set(state.channels.flatMap(cats))].sort((a,b)=>a.localeCompare(b,"pt-BR"));$("category-filter").innerHTML='<option value="">Todas as categorias</option>'+a.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");}
function renderChannels(){const q=$("search-input").value.trim().toLocaleLowerCase("pt-BR"),cat=$("category-filter").value,fmt=$("format-filter").value,filter=$("result-filter").value;const list=state.channels.filter(c=>{const r=state.results.get(c.id);return(!q||(c.name+" "+c.id).toLocaleLowerCase("pt-BR").includes(q))&&(!cat||cats(c).includes(cat))&&(!fmt||c.format===fmt)&&(!filter||(filter==="untested"?!r:filter==="failed"?isFailureStatus(r?.status):r?.status===filter));});
$("visible-count").textContent=list.length+" canais";
$("channel-grid").innerHTML=list.length?list.map(c=>{const r=state.results.get(c.id);const initials=esc((c.name||"TV").replace(/[^a-zA-Z0-9À-ÿ ]/g,"").split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase());const logo=c.logo?'<img loading="lazy" src="'+esc(c.logo)+'" alt="" onerror="this.remove()">':'<span class="logo-fallback">'+initials+'</span>';return '<article class="channel-card" data-channel-id="'+esc(c.id)+'"><div class="channel-logo">'+logo+'</div><div class="channel-info"><div class="channel-name">'+esc(c.name)+'</div><div class="channel-meta"><span>'+esc(cats(c)[0])+'</span><span class="tag">'+esc(c.format||"formato?")+'</span></div><div class="result-line"><span class="result-text '+cls(r?.status)+'" data-result>'+esc(r?.message||"Ainda não testado")+'</span><button class="test-btn" data-test="'+esc(c.id)+'">Testar</button></div></div><section class="channel-player" data-player hidden><div class="mini-player-head"><strong>PLAYER · '+esc(c.name)+'</strong><span class="mini-status neutral" data-status>Pronto para testar</span></div><div class="channel-video-wrap"><video class="channel-video" controls playsinline preload="none"></video><div class="mini-placeholder" data-placeholder>Player individual desta emissora. Toque em Testar.</div></div><p class="mini-diagnostic" data-diagnostic>Diagnóstico aguardando início.</p><div class="mini-technical" data-technical>URL: '+esc(c.url||"ausente")+' | Formato: '+esc(c.format||"desconhecido")+'</div><div class="mini-actions"><button class="button secondary" data-stop disabled>Parar teste</button><button class="button secondary" data-close>Fechar painel</button></div></section></article>';}).join(""):'<div class="empty-state">Nenhuma emissora corresponde aos filtros.</div>';
$("channel-grid").querySelectorAll("[data-test]").forEach(b=>b.addEventListener("click",()=>testChannel(b.dataset.test)));
$("channel-grid").querySelectorAll(".channel-card").forEach(c=>{const id=c.dataset.channelId;if((state.results.get(id)?.status==="playing"||state.results.get(id)?.status==="PLAYING")&&!c.querySelector("[data-favorite]")){const b=document.createElement("button");b.className="favorite-btn"+(state.favorites.has(id)?" saved":"");b.dataset.favorite=id;b.title="Adicionar à biblioteca";b.setAttribute("aria-label","Adicionar à biblioteca");b.innerHTML='<i data-lucide="list-video"></i>';c.querySelector(".result-line").appendChild(b);b.addEventListener("click",()=>toggleFavorite(id));}});
$("channel-grid").querySelectorAll("[data-stop]").forEach(b=>b.addEventListener("click",()=>{const c=b.closest(".channel-card");if(c.dataset.channelId===state.activeId)stopActive("Teste interrompido manualmente.");b.disabled=true;}));
$("channel-grid").querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>{const c=b.closest(".channel-card");if(c.dataset.channelId===state.activeId)stopActive("Player fechado.");c.querySelector("[data-player]").hidden=true;}));
}
function fail(id,msg,detail){showExternalFallback(id);const c=findCard(id);if(c){setStatus(c.querySelector("[data-status]"),"bad","Falha na reprodução");c.querySelector("[data-diagnostic]").textContent=msg;c.querySelector("[data-technical]").textContent=detail||msg;c.querySelector("[data-stop]").disabled=true;}setResult(id,"failed",msg,detail);}
function classifySource(url){
try{
const u=new URL(url),host=u.hostname.toLowerCase();
const officialHosts=["tvcultura.com.br","sbt.com.br","band.com.br","redetv.uol.com.br","recordtv.com.br","recordnews.com.br","cnnbrasil.com.br","youtube.com","youtu.be","pluto.tv"];
const official=officialHosts.some(d=>host===d||host.endsWith("."+d));
const platform=/youtube\.com|youtu\.be/.test(host)?"youtube":/pluto\.tv/.test(host)?"pluto":/cloudfront\.net/.test(host)?"cdn":"direct";
return {protocol:u.protocol.replace(":","").toUpperCase(),host,origin:official?"official_domain":platform==="cdn"?"cdn":"public_url",platform,secure:u.protocol==="https:"};
}catch(e){return {protocol:"INVALID",host:"",origin:"unknown",platform:"unknown",secure:false};}
}
function detectFormat(ch,url){
const f=String(ch.format||"").toLowerCase(),u=String(url||"").toLowerCase();
if(f==="mpegts"||f==="mpeg-ts"||/\.ts($|[?#])/.test(u))return "mpegts";
if(/youtube\.com|youtu\.be/.test(u))return "official_embed";
if(f==="hls"||/\.m3u8($|[?#])/.test(u))return "hls";
return f||"unknown";
}
function youtubeEmbed(url){
try{
const u=new URL(url);let id="";
if(u.hostname==="youtu.be")id=u.pathname.slice(1);
else if(u.pathname.startsWith("/embed/"))id=u.pathname.split("/")[2];
else if(u.pathname.startsWith("/live/"))id=u.pathname.split("/")[2];
else id=u.searchParams.get("v")||"";
return /^[\w-]{11}$/.test(id)?"https://www.youtube-nocookie.com/embed/"+id+"?autoplay=1&playsinline=1":null;
}catch(e){return null;}
}
async function probeCors(url){
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
try{
const response=await fetch(url,{method:"HEAD",mode:"cors",cache:"no-store",signal:controller.signal});
return {cors:"CORS_ACCESSIBLE",httpStatus:response.status,contentType:response.headers.get("content-type")||"unknown"};
}catch(error){
return {cors:error&&error.name==="AbortError"?"PROBE_TIMEOUT":"CORS_OR_NETWORK_UNVERIFIED",probeError:error?.name||"NetworkError"};
}finally{clearTimeout(timer);}
}
function strategyFor(channel,url,format){
const config=state.playbackConfig?.channels?.[channel.id];
const override=(config?.sources||[]).find(s=>s.url===url)||null;
if(override?.type==="official_embed"||format==="official_embed")return "official_embed";
if(format==="mpegts")return "mpegts.js";
if(format==="hls")return "hls.js_or_native";
return "unsupported";
}
function setMaestroResult(id,status,message,detail,extra={}){
const record={status,message,detail:detail||"",at:Date.now(),maestro:true,...extra};
state.results.set(id,record);save();counts();
const card=findCard(id);
if(card){
const label=card.querySelector("[data-result]");
if(label){label.textContent=message;label.className="result-text "+(status==="PLAYING"?"ok":status==="AUDIO_ONLY"?"warn":"bad");}
const diag=card.querySelector("[data-diagnostic]");if(diag)diag.textContent=message;
const tech=card.querySelector("[data-technical]");if(tech)tech.textContent=detail||status;
}
}
function showOfficialEmbed(id,embedUrl,done){
const card=findCard(id),wrap=card?.querySelector(".channel-video-wrap"),video=card?.querySelector("video");
if(!wrap||!embedUrl)return false;
if(video){video.pause();video.hidden=true;}
let frame=wrap.querySelector("iframe[data-maestro-embed]");
if(!frame){frame=document.createElement("iframe");frame.dataset.maestroEmbed="1";frame.title="Player oficial incorporado";frame.allow="autoplay; encrypted-media; picture-in-picture; fullscreen";frame.allowFullscreen=true;frame.referrerPolicy="strict-origin-when-cross-origin";frame.style.cssText="width:100%;height:100%;min-height:180px;border:0;background:#000";wrap.appendChild(frame);}
frame.src=embedUrl;
const status=card.querySelector("[data-status]"),diag=card.querySelector("[data-diagnostic]");
setStatus(status,"pending","Player oficial");
diag.textContent="Player oficial incorporado. A confirmação de reprodução depende do próprio player.";
setMaestroResult(id,"OFFICIAL_EMBED_REQUIRED","Player oficial incorporado","Estratégia: iframe autorizado | "+embedUrl,{strategy:"official_embed"});
if(done)done();
return true;
}
function testChannel(id){
const ch=state.channels.find(x=>x.id===id);if(!ch)return;
if(state.approvedIds.has(id)){console.info("Maestro: canal protegido, somente leitura:",id);}
stopActive("Outro canal foi selecionado; este player foi pausado.");
const c=findCard(id);if(!c)return;
const panel=c.querySelector("[data-player]"),v=c.querySelector("video");
const oldEmbed=panel.querySelector("iframe[data-maestro-embed]");if(oldEmbed)oldEmbed.remove();v.hidden=false;
panel.hidden=false;c.classList.add("active");state.activeId=id;state.video=v;
const status=c.querySelector("[data-status]"),diag=c.querySelector("[data-diagnostic]"),tech=c.querySelector("[data-technical]"),placeholder=c.querySelector("[data-placeholder]"),stop=c.querySelector("[data-stop]");
setStatus(status,"pending","Maestro analisando");
diag.textContent="Identificando formato, origem, protocolo e estratégia de reprodução.";
placeholder.hidden=true;stop.disabled=false;panel.scrollIntoView({behavior:"smooth",block:"nearest"});
const config=state.approvedIds.has(id)?{}:(state.playbackConfig?.channels?.[id]||{});
const sources=[...(config.sources||[]).slice(0,2),{url:ch.url,type:"catalog",priority:999}].filter(s=>s&&s.url);
if(!sources.length){finish("SOURCE_UNAVAILABLE","Nenhuma fonte configurada para este canal.");return;}
let sourceIndex=0;
const tryNext=async(lastStatus,lastDetail)=>{
if(state.activeId!==id)return;
if(sourceIndex>=sources.length){finish(lastStatus||"SOURCE_UNAVAILABLE",lastDetail||"Todas as fontes configuradas falharam.");return;}
const source=sources[sourceIndex++],url=source.url;
const sourceInfo=classifySource(url),format=source.type==="official_embed"?"official_embed":detectFormat(ch,url),strategy=strategyFor(ch,url,format);
const details="Origem: "+sourceInfo.origin+" ("+sourceInfo.host+") | Protocolo: "+sourceInfo.protocol+" | Formato: "+format+" | Estratégia: "+strategy+" | URL: "+url;
tech.textContent=details;
if(!sourceInfo.secure){finish("HTTP_INSECURE","A fonte usa HTTP. O navegador pode bloquear conteúdo inseguro dentro do aplicativo HTTPS.",details);return;}
if(format==="official_embed"){
const embed=source.embedUrl||youtubeEmbed(url);
if(embed&&showOfficialEmbed(id,embed))return;
finish("OFFICIAL_EMBED_REQUIRED","A fonte parece exigir player oficial, mas não foi encontrada uma URL de incorporação validada.",details);return;
}
if(format!=="hls"&&format!=="mpegts"){finish("SOURCE_UNAVAILABLE","Formato não reconhecido pelo Maestro.",details);return;}
diag.textContent="Verificando acesso à fonte e iniciando "+strategy+".";
const probe=await probeCors(url);
if(state.activeId!==id)return;
const diagnostic=details+" | CORS: "+probe.cors+(probe.httpStatus?" | HTTP: "+probe.httpStatus:"");
if(probe.cors==="PROBE_TIMEOUT"){finish("TIMEOUT","A verificação da fonte excedeu 5 segundos. A transmissão não foi declarada fora do ar.",diagnostic);return;}
if(format==="mpegts"){
if(!window.mpegts||!mpegts.isSupported()){finish("UNSUPPORTED_CODEC","Este navegador não oferece suporte MSE necessário ao MPEG-TS.",diagnostic);return;}
try{
state.mpegts=mpegts.createPlayer({type:"mpegts",isLive:true,url, cors:true, withCredentials:false});
state.mpegts.attachMediaElement(v);state.mpegts.load();
state.mpegts.on(mpegts.Events.ERROR,(_type,detail,info)=>{if(state.activeId!==id)return;finish(/network/i.test(String(detail))?"SOURCE_UNAVAILABLE":"UNSUPPORTED_CODEC","mpegts.js informou erro na reprodução.",diagnostic+" | MPEGTS: "+detail+" | "+JSON.stringify(info||{}));});
v.play().catch(()=>{setStatus(status,"pending","Toque em play");diag.textContent="Fluxo preparado. Toque no play do vídeo para iniciar.";});
watchPlayback(id,ch,url,"mpegts.js",diagnostic,(code,detail)=>finish(code,"Falha na reprodução MPEG-TS.",detail));
}catch(error){finish("UNSUPPORTED_CODEC","Não foi possível iniciar o player MPEG-TS.",diagnostic+" | "+error.message);}
return;
}
if(window.Hls&&Hls.isSupported()){
state.hls=new Hls({enableWorker:true,lowLatencyMode:false,manifestLoadingTimeOut:12000,fragLoadingTimeOut:12000});
state.hls.on(Hls.Events.ERROR,(_e,d)=>{
if(!d.fatal||state.activeId!==id)return;
const info=diagnostic+" | HLS: "+d.type+"/"+d.details;
if(d.details==="manifestLoadTimeOut"||d.details==="fragLoadTimeOut"){finish("TIMEOUT","A playlist ou os segmentos excederam o tempo limite.",info);return;}
if(d.details==="manifestLoadError"||d.details==="levelLoadError"||d.details==="fragLoadError"){
finish(probe.cors==="CORS_ACCESSIBLE"?"SOURCE_UNAVAILABLE":"CORS_BLOCKED","Não foi possível carregar playlist ou segmentos. CORS é uma possibilidade, não uma certeza.",info);return;}
if(d.type===Hls.ErrorTypes.MEDIA_ERROR){finish("UNSUPPORTED_CODEC","Falha de mídia ou codec incompatível.",info);return;}
finish("SOURCE_UNAVAILABLE","HLS.js encontrou erro fatal.",info);
});
state.hls.on(Hls.Events.MANIFEST_PARSED,()=>{v.play().catch(()=>{setStatus(status,"pending","Toque em play");diag.textContent="Playlist carregada. Toque no play para iniciar.";});});
state.hls.loadSource(url);state.hls.attachMedia(v);
}else if(v.canPlayType("application/vnd.apple.mpegurl")){
v.src=url;v.play().catch(()=>{setStatus(status,"pending","Toque em play");diag.textContent="Toque no play para iniciar.";});
}else{finish("UNSUPPORTED_CODEC","Este navegador não oferece HLS.js nem HLS nativo.",diagnostic);return;}
watchPlayback(id,ch,url,"hls.js_or_native",diagnostic,(code,detail)=>finish(code,"Falha na reprodução HLS.",detail));
};
function finish(code,message,detail){
if(state.activeId!==id)return;
clearTimeout(state.mediaTimer);clearTimeout(state.frameTimer);
if(state.hls){state.hls.destroy();state.hls=null;}
if(state.mpegts){state.mpegts.destroy();state.mpegts=null;}
v.pause();v.removeAttribute("src");v.load();
setStatus(status,"bad",code);diag.textContent=message;tech.textContent=detail||code;
setMaestroResult(id,code,message,detail,{strategy:strategyFor(ch,sources[Math.max(0,sourceIndex-1)]?.url||ch.url,detectFormat(ch,ch.url))});
if(sourceIndex<sources.length){setStatus(status,"pending","Tentando fonte alternativa");tryNext(code,detail);}
else{showExternalFallback(id);}
}
tryNext("SOURCE_UNAVAILABLE","");
}
function watchPlayback(id,ch,url,strategy,details,onFailure){
const card=findCard(id),video=card?.querySelector("video"),status=card?.querySelector("[data-status]"),diag=card?.querySelector("[data-diagnostic]");
if(!video)return;
video.onplaying=()=>{
if(state.activeId!==id)return;
clearTimeout(state.mediaTimer);
setStatus(status,"pending","Confirmando imagem");
diag.textContent="Fluxo iniciado; verificando quadros de vídeo e áudio.";
state.frameTimer=setTimeout(()=>{
if(state.activeId!==id)return;
if(video.videoWidth&&video.videoHeight){
setStatus(status,"ok","Vídeo + áudio confirmados");
const report=details+" | Vídeo: "+video.videoWidth+"x"+video.videoHeight;
diag.textContent="Imagem e reprodução confirmadas.";
setMaestroResult(id,"PLAYING","Vídeo + áudio",report,{strategy});
}else{
setStatus(status,"pending","Somente áudio detectado");
setMaestroResult(id,"AUDIO_ONLY","Somente áudio",details,{strategy});
}
},5000);
};
video.onerror=()=>{
if(state.activeId!==id)return;
const code=video.error?.code===4?"UNSUPPORTED_CODEC":"SOURCE_UNAVAILABLE";
const msg=video.error?.code===4?"Formato ou codec não suportado pelo navegador.":"O elemento de vídeo não conseguiu reproduzir a fonte.";
setMaestroResult(id,code,msg,details,{strategy});
if(typeof onFailure==="function")onFailure(code,details);
if(state.hls){state.hls.destroy();state.hls=null;}
if(state.mpegts){state.mpegts.destroy();state.mpegts=null;}
if(state.activeId===id){setStatus(status,"bad",code);diag.textContent=msg;}
};
state.mediaTimer=setTimeout(()=>{
if(state.activeId!==id)return;
if(video.readyState<2){const msg="A transmissão não começou dentro de 20 segundos.";
setMaestroResult(id,"TIMEOUT",msg,details,{strategy});setStatus(status,"bad","TIMEOUT");diag.textContent=msg;if(typeof onFailure==="function")onFailure("TIMEOUT",details);}
},20000);
}
async function loadCatalog(){stopActive("Catálogo atualizado.");$("channel-grid").innerHTML='<div class="empty-state">Buscando catálogo...</div>';try{setStatus($("api-status"),"pending","Carregando catálogo");const r=await fetch(CATALOG_URL+"?t="+Date.now(),{cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);const data=await r.json();if(!Array.isArray(data.channels))throw new Error("JSON sem lista channels");state.channels=data.channels;restore();const hasLocalLibrary=restoreFavorites();if(!hasLocalLibrary||[...state.favorites].some(id=>!state.channels.some(c=>c.id===id)))await recoverLibraryFromBlob(!hasLocalLibrary);
try{const configResponse=await fetch("./data/playback-strategies.json?v=1",{cache:"no-store"});if(configResponse.ok){const configData=await configResponse.json();if(configData&&configData.schema_version===1&&configData.channels&&typeof configData.channels==="object")state.playbackConfig=configData;}}catch(configError){console.warn("Maestro: configuração indisponível; usando estratégias padrão.",configError);}
try{const br=await fetch("https://osqdup2f2kumsdtb.public.blob.vercel-storage.com/backups/tv-brasil-engine-biblioteca-88-canais-2026-11-02T21-41-46-360Z.json",{cache:"no-store"});if(!br.ok)throw new Error("HTTP "+br.status);const bj=await br.json();if(bj.total!==88||!Array.isArray(bj.channels)||bj.channels.length!==88||new Set(bj.channels.map(c=>c.id)).size!==88)throw new Error("Backup inválido");state.approvedChannels=bj.channels;state.approvedIds=new Set(bj.channels.map(c=>c.id));$("approved-tab-count").textContent=state.approvedChannels.length;}catch(backupError){console.warn("Não foi possível carregar os 88 canais do Blob",backupError);state.approvedChannels=state.channels.filter(c=>state.favorites.has(c.id));state.approvedIds=new Set(state.approvedChannels.map(c=>c.id));}
const valid=new Set(state.channels.map(c=>c.id));for(const id of state.results.keys())if(!valid.has(id))state.results.delete(id);save();$("total-count").textContent=state.channels.length;$("catalog-tab-count").textContent=state.channels.length;$("hls-count").textContent=state.channels.filter(c=>c.format==="hls").length;$("ts-count").textContent=state.channels.filter(c=>c.format==="mpegts").length;$("updated-at").textContent="Catálogo atualizado em "+(data.updated_at?new Date(data.updated_at).toLocaleString("pt-BR"):"data não informada");renderFilters();renderChannels();renderLibrary();renderChannelRows();if(state.activeTab==="feed")renderTvFeed();if(state.libraryRecovered){const note=$("library-recovery-status");if(note){note.hidden=false;note.textContent="Biblioteca recuperada automaticamente do backup seguro: 88 emissoras restauradas do Vercel Blob.";} }counts();setStatus($("api-status"),"ok","Catálogo conectado");refreshIcons();}catch(e){setStatus($("api-status"),"bad","Catálogo indisponível");$("channel-grid").innerHTML='<div class="empty-state">Não foi possível carregar o catálogo: '+esc(e.message)+'</div>';}}
$("export-library-btn").addEventListener("click",exportApprovedLibrary);
$("featured-prev").addEventListener("click",()=>stepFeatured(-1));$("featured-next").addEventListener("click",()=>stepFeatured(1));
$("featured-play").addEventListener("click",()=>{const v=$("featured-video");if(v.paused)v.play().catch(()=>{});else v.pause();});
$("featured-fullscreen").addEventListener("click",()=>{const el=$("featured-stage");if(el.requestFullscreen)el.requestFullscreen();else if($("featured-video").webkitEnterFullscreen)$("featured-video").webkitEnterFullscreen();});
$("featured-favorite").addEventListener("click",()=>{const id=state.featuredId;if(!id)return;if(state.favorites.has(id))state.favorites.delete(id);else state.favorites.add(id);saveFavorites();$("featured-favorite").classList.toggle("is-favorite",state.favorites.has(id));renderLibrary();});
let feedTouchY=0;$("featured-stage").addEventListener("touchstart",e=>{feedTouchY=e.changedTouches[0].clientY;},{passive:true});$("featured-stage").addEventListener("touchend",e=>{if(state.activeTab!=="feed")return;const delta=feedTouchY-e.changedTouches[0].clientY;if(Math.abs(delta)>55)stepFeatured(delta>0?1:-1);},{passive:true});
$("reload-btn").addEventListener("click",loadCatalog);document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));["search-input","category-filter","format-filter","result-filter"].forEach(id=>$(id).addEventListener(id==="search-input"?"input":"change",renderChannels));loadCatalog();
})();