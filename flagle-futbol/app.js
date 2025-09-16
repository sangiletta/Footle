
const MAX_GUESSES = 6;
const STORAGE_KEY = 'flagle-futbol-state-v07';

// ===== Fade configuration (defaults + per-image override) =====
// Default durations (ms) and easing for fades. You can override per-team
// by adding an entry to `window.IMAGE_FADE_CONFIG` keyed by team id.
const FADE_DEFAULTS = {
  overlayIn: 2000,   // ms to fade overlay in
  overlayOut: 500,  // ms to fade overlay out
  canvasIn: 100,    // ms to fade canvas in
  canvasOut: 1,   // ms to fade canvas out (unused currently)
  easing: 'ease'
};

// Example usage: window.IMAGE_FADE_CONFIG = { 'argentina-primeradivision-boca': { overlayIn:500, overlayOut:500 } }
window.IMAGE_FADE_CONFIG = window.IMAGE_FADE_CONFIG || {};

function getFadeConfigForTeam(team){
  try{
    const id = team?.id || '';
    const custom = window.IMAGE_FADE_CONFIG[id] || {};
    return Object.assign({}, FADE_DEFAULTS, custom);
  }catch(e){ return Object.assign({}, FADE_DEFAULTS); }
}

// ===== Helpers básicos =====
function yyyymmdd(d=new Date()){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296}}
function hashString(s){let h=2166136261; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i); h=Math.imul(h,16777619)} return h>>>0}

const els = {
  menuCard: document.getElementById('menuCard'),
  menuInfo: document.getElementById('menuInfo'),
  leagueButtons: document.getElementById('leagueButtons'),
  gameCard: document.getElementById('gameCard'),
  canvas: document.getElementById('targetCanvas'),
  input: document.getElementById('guessInput'),
  btn: document.getElementById('guessBtn'),
  list: document.getElementById('teamsList'),
  guessList: document.getElementById('guessList'),
  playAgain: document.getElementById('playAgain'),
  shareBtn: document.getElementById('shareBtn'),
  backToMenu: document.getElementById('backToMenu'),
  leagueSelect: document.getElementById('leagueSelect'),
  guessOverlay: document.getElementById('guessOverlay'),
  guessOverlayImg: document.getElementById('guessOverlayImg'),
};

const ctx = els.canvas.getContext('2d');
const offGuess = document.createElement('canvas');
const gctx = offGuess.getContext('2d');
let targetImg = null;

// ===== Catalog (Plan B: catalog.json) =====
let ALL_TEAMS = [];
const LEAGUE_INDEX = new Map();
let GUESS_POOL = [];
let TARGET_POOL = [];
let currentLeagueKey = null;
let currentCountry = null;

async function loadCatalogFromJson(){
  try{
    const res = await fetch('./catalog.json', {cache:'no-cache'});
    if(!res.ok) return false;
    const data = await res.json();
    if(!data || !Array.isArray(data.items) || data.items.length===0) return false;

    ALL_TEAMS = data.items.map(it=>({
      id: `${(it.country||'').toLowerCase()}-${(it.league||'').toLowerCase()}-${String(it.name||'').toLowerCase().replace(/\s+/g,'-')}`,
      name: `${it.name}${it.country? ' ('+String(it.country).toUpperCase()+')':''}`,
      crest: it.crest,
      country: (it.country||'').toLowerCase(),
      league:  (it.league||'').toLowerCase(),
    }));

    LEAGUE_INDEX.clear();
    ALL_TEAMS.forEach(t=>{
      const k = `${t.country}/${t.league}`;
      if(!LEAGUE_INDEX.has(k)) LEAGUE_INDEX.set(k, []);
      LEAGUE_INDEX.get(k).push(t);
    });
    return true;
  }catch(e){ console.warn(e); return false }
}

function prettyWord(s){
  return String(s).replaceAll('_',' ').replaceAll('-',' ')
    .split(' ').filter(Boolean).map(w=>w[0]?.toUpperCase()+w.slice(1)).join(' ');
}

function buildLeagueMenu(){
  els.leagueButtons.innerHTML='';
  const entries = Array.from(LEAGUE_INDEX.entries()).filter(([,arr])=>arr && arr.length>0);
  if(entries.length===0){
    els.menuInfo.innerHTML = '<span style="color:#f87171">No se encontraron ligas.</span> Generá <code>catalog.json</code>.';
    return;
  }
  els.menuInfo.textContent = `Ligas disponibles: ${entries.length}`;
  entries.sort((a,b)=> a[0].localeCompare(b[0]));
  entries.forEach(([key,list])=>{
    const s=list[0];
    const label = `${prettyWord(s.country)} — ${prettyWord(s.league)} (${list.length})`;
    const btn = document.createElement('button');
    btn.className='leagueBtn'; btn.textContent=label;
    btn.addEventListener('click', ()=> handleLeagueSelect(key));
    els.leagueButtons.appendChild(btn);
  });
  populateLeagueSelect(currentLeagueKey);
}
function labelFromKey(key){
  const [country, league] = key.split('/');
  return `${prettyWord(country||'')} — ${prettyWord(league||'')}`;
}
function populateLeagueSelect(selectedKey=null){
  const sel = els.leagueSelect; if(!sel) return;
  sel.innerHTML = '';
  const entries = Array.from(LEAGUE_INDEX.keys()).sort((a,b)=> a.localeCompare(b));
  for(const key of entries){
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = labelFromKey(key);
    if(selectedKey && key===selectedKey) opt.selected = true;
    sel.appendChild(opt);
  }
  if(!selectedKey && currentLeagueKey) sel.value = currentLeagueKey;
}
function handleLeagueSelect(key){
  if(!key) return;
  currentLeagueKey = key;
  TARGET_POOL = LEAGUE_INDEX.get(key) || [];
  currentCountry = TARGET_POOL[0]?.country || null;
  GUESS_POOL = ALL_TEAMS.filter(t=> t.country === currentCountry);
  if(els.leagueSelect) els.leagueSelect.value = key;

  els.menuCard.style.display='none';
  els.gameCard.style.display='';

  state.guesses=[]; state.solved=false; state.revealedMask=null; state.targetIndex=0;
  populateDatalist();
  resetGuessListUI();
  start('random');
}

// ===== Images / canvas utils =====
function loadImage(src){
  return new Promise((res, rej)=>{ const img=new Image(); img.crossOrigin='anonymous';
    img.onload=()=>res(img); img.onerror=rej; img.src=src; });
}
// drawContain: dibuja IMG dentro de (W,H) centrado, AR preservado
function drawContain(ctx, img, W, H){
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(W/iw, H/ih);
  const dw = Math.max(1, Math.round(iw*s)), dh = Math.max(1, Math.round(ih*s));
  const dx = Math.round((W-dw)/2), dy = Math.round((H-dh)/2);
  ctx.clearRect(0,0,W,H);
  ctx.drawImage(img, dx, dy, dw, dh);
}
// compone el objetivo con la máscara (0=transparente,1=visible)
function composeRevealed(targetCtx, targetImg, maskData){
  const W=targetCtx.canvas.width, H=targetCtx.canvas.height;
  const tmp=document.createElement('canvas'); tmp.width=W; tmp.height=H;
  const t=tmp.getContext('2d'); drawContain(t, targetImg, W, H);
  const img=t.getImageData(0,0,W,H); const p=img.data, m=maskData;
  for(let i=0;i<p.length;i+=4){ if(m[i>>2]===0){ p[i+3]=0; } }
  targetCtx.clearRect(0,0,W,H);
  targetCtx.putImageData(img,0,0);
}

// ===== Estado + almacenamiento compacto =====
const state = { mode:'daily', date: yyyymmdd(), targetIndex:0, guesses:[], revealedMask:null, solved:false };

function bytesToBase64(bytes){
  let binary=''; const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i,i+chunk));
  return btoa(binary);
}
function base64ToBytes(b64){ const bin=atob(b64); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
function packMaskToB64(mask){ const N=mask.length, bytes=new Uint8Array(Math.ceil(N/8)); for(let i=0;i<N;i++) if(mask[i]) bytes[i>>3]|=(1<<(7-(i&7))); return bytesToBase64(bytes); }
function unpackMaskFromB64(b64,N){ const bytes=base64ToBytes(b64); const out=new Uint8Array(N); for(let i=0;i<N;i++){ const b=bytes[i>>3]; out[i]=((b>>(7-(i&7)))&1)?1:0; } return out; }
function safeSetLocalStorage(key, value){
  try{ localStorage.setItem(key, value); return true; }
  catch(e1){ try{ localStorage.removeItem(key); localStorage.setItem(key, value); return true; } catch(e2){ console.warn('Storage quota exceeded', e2); return false; } }
}
function save(){
  const W=els.canvas.width, H=els.canvas.height;
  let maskB64=null; if(state.revealedMask && state.revealedMask.length===W*H) maskB64=packMaskToB64(state.revealedMask);
  const payload={ mode:state.mode, date:state.date, league:currentLeagueKey, targetIndex:state.targetIndex, guesses:state.guesses, dims:[W,H], mask:maskB64, v:2 };
  const ok=safeSetLocalStorage(STORAGE_KEY, JSON.stringify(payload));
  if(!ok){ const lite={ mode:state.mode, date:state.date, league:currentLeagueKey, targetIndex:state.targetIndex, guesses:state.guesses.map(g=>({teamId:g.teamId,name:g.name,crest:g.crest,hitPct:g.hitPct})), dims:[W,H], mask:null, v:2 }; safeSetLocalStorage(STORAGE_KEY, JSON.stringify(lite)); }
}
function load(){
  const raw=localStorage.getItem(STORAGE_KEY); if(!raw) return false;
  try{
    const p=JSON.parse(raw); if(p.mode==='daily' && p.date!==yyyymmdd()) return false;
    state.mode=p.mode||'daily'; state.date=p.date||yyyymmdd(); state.targetIndex=typeof p.targetIndex==='number'?p.targetIndex:0;
    state.guesses=Array.isArray(p.guesses)?p.guesses:[]; state.solved=!!p.solved; if(p.league) currentLeagueKey=p.league;
    const W=(Array.isArray(p.dims)&&p.dims[0])?p.dims[0]:els.canvas.width; const H=(Array.isArray(p.dims)&&p.dims[1])?p.dims[1]:els.canvas.height;
    state.revealedMask = p.mask ? unpackMaskFromB64(p.mask, W*H) : null;
    return true;
  }catch(e){ console.warn('Failed to load', e); return false; }
}

// ===== Target load =====
async function loadTarget(idx){
  state.targetIndex = idx;
  targetImg = await loadImage(TARGET_POOL[idx].crest);

  // tamaño nativo, CSS lo ajusta al contenedor
  const W = targetImg.naturalWidth || targetImg.width;
  const H = targetImg.naturalHeight || targetImg.height;
  els.canvas.width = W; els.canvas.height = H;

  state.revealedMask = new Uint8Array(W*H);
  composeRevealed(ctx, targetImg, state.revealedMask);
  els.canvas.style.opacity = '1';
}

// ===== Fades mínimos =====
function forceReflow(el){ void el.offsetWidth; }
function fade(el, toOpacity, ms, easing){
  return new Promise((resolve)=>{
    el.style.transition = `opacity ${ms}ms ${easing}`;    
    requestAnimationFrame(()=>{ el.style.opacity = String(toOpacity); });
    const onEnd=(ev)=>{ if(ev.propertyName==='opacity'){ el.removeEventListener('transitionend', onEnd); resolve(); } };
    el.addEventListener('transitionend', onEnd, { once:true });
    setTimeout(resolve, ms+80);
  });
}
async function setClubSelectedOverlay(team){
  const W=els.canvas.width, H=els.canvas.height;
  const tmp=document.createElement('canvas'); tmp.width=W; tmp.height=H;
  const tctx=tmp.getContext('2d');
  const crest=await loadImage(team.crest);
  drawContain(tctx, crest, W, H);
  els.guessOverlayImg.src = tmp.toDataURL('image/png');
  els.guessOverlayImg.alt = team.name;
  if(els.guessOverlayImg.decode){ try{ await els.guessOverlayImg.decode(); }catch{} }
}

// ===== Guess handling + UI =====
function populateDatalist(){
  els.list.innerHTML='';
  GUESS_POOL.forEach(t=>{
    const opt=document.createElement('option');
    opt.value=t.name; opt.dataset.id=t.id;
    els.list.appendChild(opt);
  });
}
function findTeamByName(s){
  const q=s.trim().toLowerCase(); if(!q) return null;
  return GUESS_POOL.find(t=> t.name.toLowerCase()===q) ||
         GUESS_POOL.find(t=> t.name.toLowerCase().startsWith(q)) ||
         GUESS_POOL.find(t=> t.name.toLowerCase().includes(q));
}
function resetGuessListUI(){
  els.guessList.innerHTML='';
  for(let i=0;i<MAX_GUESSES;i++){
    const row=document.createElement('div'); row.className='guessRow empty';
    row.innerHTML=`
      <div class="name muted">—</div>
      <div class="pct muted">—</div>
      <div class="thumbWrap"><img class="thumb" alt="" /></div>
    `;
    els.guessList.appendChild(row);
  }
}
function renderGuessList(){
  const rows=els.guessList.querySelectorAll('.guessRow');
  for(let i=0;i<MAX_GUESSES;i++){
    const row=rows[i]; if(!row) continue;
    const nameEl=row.querySelector('.name'), pctEl=row.querySelector('.pct'), thImg=row.querySelector('.thumb');
    if(i<state.guesses.length){
      const g=state.guesses[i];
      row.classList.remove('empty'); row.classList.toggle('solved', g.hitPct>=99.95);
      nameEl.textContent=g.name; nameEl.classList.remove('muted');
      pctEl.textContent=g.hitPct.toFixed(1)+'%'; pctEl.classList.remove('muted');
      thImg.src=g.crest; thImg.alt=g.name;
    }else{
      row.classList.add('empty'); row.classList.remove('solved');
      nameEl.textContent='—'; nameEl.classList.add('muted');
      pctEl.textContent='—'; pctEl.classList.add('muted');
      thImg.removeAttribute('src'); thImg.alt='';
    }
  }
}

async function processGuess(team){
  if(state.solved || state.guesses.length>=MAX_GUESSES) return;

  const W=els.canvas.width, H=els.canvas.height;
  const guessImg=await loadImage(team.crest);
  offGuess.width=W; offGuess.height=H;
  drawContain(gctx, guessImg, W, H);
  const gData=gctx.getImageData(0,0,W,H).data;

  const tCan=document.createElement('canvas'); tCan.width=W; tCan.height=H;
  const tctx=tCan.getContext('2d'); drawContain(tctx, targetImg, W, H);
  const tData=tctx.getImageData(0,0,W,H).data;

  if(!state.revealedMask || state.revealedMask.length!==W*H) state.revealedMask=new Uint8Array(W*H);

  const thr=18, thrSq=thr*thr;
  let matches=0, targetNonTransparent=0;

  for(let i=0, px=0;i<gData.length;i+=4, px++){
    const ga=gData[i+3], ta=tData[i+3];
    if(ta>8) targetNonTransparent++;
    if(ga>8 && ta>8){
      const dr=gData[i]-tData[i], dg=gData[i+1]-tData[i+1], db=gData[i+2]-tData[i+2];
      if(dr*dr+dg*dg+db*db<=thrSq){ state.revealedMask[px]=1; matches++; }
    }
  }
  const hitPct = targetNonTransparent? (matches/targetNonTransparent*100) : 0;
  state.guesses.push({teamId:team.id, name:team.name, crest:team.crest, hitPct});
  if(hitPct>=99.95) state.solved=true;

  composeRevealed(ctx, targetImg, state.revealedMask);
  renderGuessList();
  save();

  if(state.solved || state.guesses.length>=MAX_GUESSES){ els.input.disabled=true; els.btn.disabled=true; }
  return hitPct;
}

// ===== Flow & events =====
function dailyIndex(dateStr){
  const seed=mulberry32(hashString(dateStr + (currentLeagueKey||'')));
  return Math.floor(seed()*Math.max(1,TARGET_POOL.length));
}
async function start(mode='daily'){
  if(!TARGET_POOL.length){ els.menuCard.style.display=''; els.gameCard.style.display='none'; return; }
  state.mode=mode; state.date=yyyymmdd();
  els.input.disabled=false; els.btn.disabled=false;
  els.canvas.style.opacity='1';
  state.guesses=[]; state.solved=false; state.revealedMask=null;
  resetGuessListUI();

  const idx=(mode==='daily')? dailyIndex(state.date) : Math.floor(Math.random()*TARGET_POOL.length);
  await loadTarget(idx);
  renderGuessList();
  save();
}
function buildShareText(){
  const leagueTxt=currentLeagueKey? currentLeagueKey.replace('/',' · ') : 'Liga';
  const rows=state.guesses.map(g=> `${g.name} ${g.hitPct.toFixed(1)}%`);
  return `Flagle Futbol — ${leagueTxt}\n${rows.join('\n')}`;
}
async function shareResults(){
  const text=buildShareText();
  try{ if(navigator.share){ await navigator.share({text}); } else { await navigator.clipboard.writeText(text); alert('Resultado copiado ✅'); } }catch{}
}

// === Evento principal (secuencia limpia de superposición) ===
els.btn.addEventListener('click', async ()=>{
  const team=findTeamByName(els.input.value);
  if(!team){ els.input.value=''; els.input.focus(); return; }
  els.btn.disabled=true; els.input.disabled=true;

  // 1) clubSelected fade-in (overlay)
  const fcfg = getFadeConfigForTeam(team);
  await setClubSelectedOverlay(team);
  els.guessOverlay.style.display='block';
  els.guessOverlay.style.opacity='0';
  (function(el){ void el.offsetWidth; })(els.guessOverlay);
  await fade(els.guessOverlay, 1, fcfg.overlayIn, fcfg.easing);
  
  // 2) preparar canvas oculto sin transición y procesar guess
  const prevTrans=els.canvas.style.transition;
  els.canvas.style.transition='none';
  els.canvas.style.opacity='1';
  (function(el){ void el.offsetWidth; })(els.canvas);
  els.canvas.style.transition=prevTrans||'';

  const hitPct = await processGuess(team);
  await fade(els.guessOverlay, 0, fcfg.overlayOut, fcfg.easing);
  
  els.guessOverlay.style.display='none';
  els.guessOverlayImg.src='';

  if(!(state.solved || state.guesses.length>=MAX_GUESSES)){
    // If guess was incorrect (not solved), clear the input so player can type a new guess
    if(!(hitPct>=99.95)) els.input.value='';
    els.btn.disabled=false; els.input.disabled=false;
    els.input.focus();
  }
});
els.input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ els.btn.click(); }});
els.playAgain.addEventListener('click', ()=> start('random'));
els.shareBtn.addEventListener('click', shareResults);
els.backToMenu.addEventListener('click', ()=>{ els.gameCard.style.display='none'; els.menuCard.style.display=''; });
els.leagueSelect.addEventListener('change', (e)=>{ const key=e.target.value; if(key && key!==currentLeagueKey) handleLeagueSelect(key); });

// ===== Boot =====
(async function init(){
  els.canvas.style.opacity='1';
  const ok=await loadCatalogFromJson();
  if(!ok){ els.menuInfo.innerHTML='<span style="color:#f87171">No se pudo leer catalog.json</span>'; return; }
  buildLeagueMenu();
  const restored=load();
  if(restored && currentLeagueKey && LEAGUE_INDEX.has(currentLeagueKey)){ handleLeagueSelect(currentLeagueKey); }
})();
