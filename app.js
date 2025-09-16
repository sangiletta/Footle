
const MAX_GUESSES = 4;
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

// ===== Color similarity config (RGB / Lab / HSL) =====
const COLOR_SIMILARITY = {
  mode: 'lab',          // 'lab' | 'rgb' | 'hsl'
  // RGB euclidean (en valores 0..255)
  rgbThr: 75,           // subir si querés más “laxo”
  // Lab ΔE76 (perceptual, recomendado)
  labThr: 20,           // 10-25 típico; más alto = más permisivo
  // HSL (tolerancia por tono)
  hsl: { dh: 12, ds: 0.28, dl: 0.28, hueWeight: 2.0 }, // dh en grados
  // generales
  ignoreAlphaBelow: 8,  // pixeles casi transparentes se ignoran
};

// ===== sRGB -> Lab (ΔE76) helpers =====
const _SRGB_TO_LINEAR_LUT = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    lut[i] = v <= 0.04045 ? (v / 12.92) : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return lut;
})();

function _rgbToLab_fast(r, g, b){
  // sRGB (0..255) -> linear 0..1
  const R = _SRGB_TO_LINEAR_LUT[r|0], G = _SRGB_TO_LINEAR_LUT[g|0], B = _SRGB_TO_LINEAR_LUT[b|0];
  // linear RGB -> XYZ (D65)
  const X = R*0.4124564 + G*0.3575761 + B*0.1804375;
  const Y = R*0.2126729 + G*0.7151522 + B*0.0721750;
  const Z = R*0.0193339 + G*0.1191920 + B*0.9503041;

  // XYZ -> Lab (D65)
  const Xn = 0.95047, Yn = 1.00000, Zn = 1.08883;
  const fx = _fxyz(X / Xn), fy = _fxyz(Y / Yn), fz = _fxyz(Z / Zn);
  const L = (116 * fy) - 16;
  const a = 500 * (fx - fy);
  const b2 = 200 * (fy - fz);
  return [L, a, b2];
}
function _fxyz(t){
  const delta = 6/29;
  return t > delta*delta*delta ? Math.cbrt(t) : (t/(3*delta*delta) + 4/29);
}

function _deltaE76(L1,a1,b1, L2,a2,b2){
  const dL=L1-L2, da=a1-a2, db=b1-b2;
  return Math.sqrt(dL*dL + da*da + db*db);
}

// ===== HSL helpers (para modo 'hsl') =====
function _rgbToHsl(r,g,b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h, s, l=(max+min)/2;
  if(max===min){ h=0; s=0; }
  else{
    const d=max-min;
    s = l>0.5 ? d/(2-max-min) : d/(max+min);
    switch(max){
      case r: h=(g-b)/d + (g<b?6:0); break;
      case g: h=(b-r)/d + 2; break;
      default: h=(r-g)/d + 4;
    }
    h*=60;
  }
  return [h,s,l];
}
function _hueDist(a,b){
  let d=Math.abs(a-b);
  return d>180? 360-d : d;
}

// ===== Comparador configurable (sin colisiones de nombres) =====
function colorsSimilar(r1, g1, b1, r2, g2, b2){
  const mode = (COLOR_SIMILARITY.mode || 'lab').toLowerCase();

  if (mode === 'rgb'){
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    const thr = COLOR_SIMILARITY.rgbThr;
    return (dr*dr + dg*dg + db*db) <= (thr*thr);
  }

  if (mode === 'hsl'){
    const [h1, s1, l1] = _rgbToHsl(r1, g1, b1);
    const [h2, s2, l2] = _rgbToHsl(r2, g2, b2);
    const dh = _hueDist(h1, h2);
    const ds = Math.abs(s1 - s2);
    const dl = Math.abs(l1 - l2);
    const cfg = COLOR_SIMILARITY.hsl;
    const w   = cfg.hueWeight || 1.0;
    return (dh <= cfg.dh) &&
           (ds <= cfg.ds) &&
           (dl <= cfg.dl || (w*dh <= cfg.dh*0.6));
  }

  // 'lab' por defecto (renombramos componentes para evitar choque con b1/b2 de RGB)
  const [L1, a1, b1Lab] = _rgbToLab_fast(r1, g1, b1);
  const [L2, a2, b2Lab] = _rgbToLab_fast(r2, g2, b2);
  return _deltaE76(L1, a1, b1Lab, L2, a2, b2Lab) <= COLOR_SIMILARITY.labThr;
}



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

// Image caching system to prevent network inspection of target
const IMAGE_CACHE = new Map();  // teamId -> {dataUrl, tempId}
let TEMP_ID_COUNTER = 1;

// Convert image URL to data URL and cache it
async function cacheImage(team) {
  if (IMAGE_CACHE.has(team.id)) return IMAGE_CACHE.get(team.id);
  
  try {
    const img = await loadImage(team.crest);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    const entry = { dataUrl, tempId: `img_${TEMP_ID_COUNTER++}` };
    IMAGE_CACHE.set(team.id, entry);
    return entry;
  } catch(e) {
    console.warn('Failed to cache image for', team.id, e);
    return null;
  }
}

// Pre-cache all images for a league
async function precacheLeagueImages(teams) {
  const results = await Promise.allSettled(teams.map(t => cacheImage(t)));
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) console.warn(`Failed to cache ${failed} images`);
}

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
      name: String(it.name || ''),                  
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
async function handleLeagueSelect(key){
  if(!key) return;
  currentLeagueKey = key;
  TARGET_POOL = LEAGUE_INDEX.get(key) || [];
  currentCountry = TARGET_POOL[0]?.country || null;
  GUESS_POOL = ALL_TEAMS.filter(t=> t.country === currentCountry);
  if(els.leagueSelect) els.leagueSelect.value = key;

  // Pre-cache all images before starting
  els.menuInfo.textContent = 'Cargando imágenes...';
  await precacheLeagueImages([...TARGET_POOL, ...GUESS_POOL]);
  els.menuInfo.textContent = `Ligas disponibles: ${LEAGUE_INDEX.size}`;

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

// Load image from cache if available, otherwise load from URL
async function loadCachedImage(team) {
  const cached = IMAGE_CACHE.get(team.id);
  if (cached) {
    return loadImage(cached.dataUrl);
  }
  const entry = await cacheImage(team);
  return entry ? loadImage(entry.dataUrl) : loadImage(team.crest);
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
// caches globales del target ya rasterizado al canvas
let TARGET_RGBA = null;           // Uint8ClampedArray
let TARGET_LAB  = null;           // Float32Array de [L,a,b] por pixel (contiguo)

async function loadTarget(idx){
  state.targetIndex = idx;
  targetImg = await loadCachedImage(TARGET_POOL[idx]);

  const W = targetImg.naturalWidth || targetImg.width;
  const H = targetImg.naturalHeight || targetImg.height;
  els.canvas.width = W; els.canvas.height = H;

  // máscara limpia + primer render
  state.revealedMask = new Uint8Array(W*H);
  composeRevealed(ctx, targetImg, state.revealedMask);
  els.canvas.style.opacity = '1';

  // ---- PRECOMPUTE: RGBA y Lab del objetivo (a resolución final) ----
  // Rasterizamos el target con "contain" exactamente como usaremos para comparar
  const tCan = document.createElement('canvas'); tCan.width=W; tCan.height=H;
  const tctx = tCan.getContext('2d');
  drawContain(tctx, targetImg, W, H);
  const tImage = tctx.getImageData(0,0,W,H);
  TARGET_RGBA = tImage.data; // Uint8ClampedArray (W*H*4)

  // Si usamos modo 'lab', precomputamos Lab del objetivo para acelerar
  if ((COLOR_SIMILARITY.mode||'lab').toLowerCase() === 'lab'){
    TARGET_LAB = new Float32Array(W*H*3);
    for(let i=0, j=0; i<TARGET_RGBA.length; i+=4, j+=3){
      const r = TARGET_RGBA[i], g = TARGET_RGBA[i+1], b = TARGET_RGBA[i+2];
      const a = TARGET_RGBA[i+3];
      if (a > COLOR_SIMILARITY.ignoreAlphaBelow){
        const [L,a1,b1] = _rgbToLab_fast(r,g,b);
        TARGET_LAB[j]   = L;
        TARGET_LAB[j+1] = a1;
        TARGET_LAB[j+2] = b1;
      } else {
        TARGET_LAB[j]   = TARGET_LAB[j+1] = TARGET_LAB[j+2] = NaN; // marca “ignorar”
      }
    }
  } else {
    TARGET_LAB = null;
  }
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
      const cached = IMAGE_CACHE.get(g.teamId);
      thImg.src = cached ? cached.dataUrl : g.crest;
      thImg.alt=g.name;
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
  const guessImg=await loadCachedImage(team);
  offGuess.width=W; offGuess.height=H;
  drawContain(gctx, guessImg, W, H);
  const gData=gctx.getImageData(0,0,W,H).data;

  const tCan=document.createElement('canvas'); tCan.width=W; tCan.height=H;
  const tctx=tCan.getContext('2d'); drawContain(tctx, targetImg, W, H);
  const tData=tctx.getImageData(0,0,W,H).data;

  if(!state.revealedMask || state.revealedMask.length!==W*H) state.revealedMask=new Uint8Array(W*H);

const ALPHA_MIN = COLOR_SIMILARITY.ignoreAlphaBelow|0;
let matches=0, targetNonTransparent=0;

// Preparar “target” según el modo
const mode = (COLOR_SIMILARITY.mode||'lab').toLowerCase();
const We=els.canvas.width, He=els.canvas.height;

// Si no tenemos cache RGBA del target, generarla (por seguridad)
let tRGBA = TARGET_RGBA;
if(!tRGBA){
  const tCan=document.createElement('canvas'); tCan.width=We; tCan.height=He;
  const tctx=tCan.getContext('2d'); drawContain(tctx, targetImg, We, He);
  tRGBA = tctx.getImageData(0,0,We,He).data;
}

for(let i=0, px=0, jLab=0; i<gData.length; i+=4, px++, jLab+=3){
  const aG = gData[i+3];
  const aT = tRGBA[i+3];
  if(aT>ALPHA_MIN) targetNonTransparent++;

  if(aG>ALPHA_MIN && aT>ALPHA_MIN){
    // RGB del guess y del target
    const rG=gData[i],   gG=gData[i+1], bG=gData[i+2];
    const rT=tRGBA[i],   gT=tRGBA[i+1], bT=tRGBA[i+2];

    let similar = false;

    if (mode === 'lab' && TARGET_LAB){
      // Guess en Lab (on-the-fly) vs Target en Lab (precomputado)
      const [Lg, ag, bg] = _rgbToLab_fast(rG,gG,bG);
      const Lt = TARGET_LAB[jLab], at = TARGET_LAB[jLab+1], bt = TARGET_LAB[jLab+2];
      if (!Number.isNaN(Lt)){
        similar = (_deltaE76(Lg,ag,bg, Lt,at,bt) <= COLOR_SIMILARITY.labThr);
      }
    } else {
      // rgb / hsl
      similar = colorsSimilar(rG,gG,bG, rT,gT,bT);
    }

    if(similar){ state.revealedMask[px]=1; matches++; }
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
els.playAgain.addEventListener('click', ()=> { start('random'); els.input.value=''; });
els.shareBtn.addEventListener('click', shareResults);
els.backToMenu.addEventListener('click', ()=>{ els.gameCard.style.display='none'; els.menuCard.style.display=''; els.input.value='';});
els.leagueSelect.addEventListener('change', (e)=>{ const key=e.target.value; if(key && key!==currentLeagueKey) handleLeagueSelect(key); els.input.value='';});

// ===== Boot =====
(async function init(){
  els.canvas.style.opacity='1';
  const ok=await loadCatalogFromJson();
  if(!ok){ els.menuInfo.innerHTML='<span style="color:#f87171">No se pudo leer catalog.json</span>'; return; }
  buildLeagueMenu();
  const restored=load();
  if(restored && currentLeagueKey && LEAGUE_INDEX.has(currentLeagueKey)){ handleLeagueSelect(currentLeagueKey); }
})();
