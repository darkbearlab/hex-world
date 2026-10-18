// 奇美拉沙盒觀看頁：背景的 worker 一年一年推演，畫面照選好的速度播放；開了公司之後改用小時推進
import {CLS, MN, MATS, REVIVE_RECIPE, TAGS, classOdds, GCFG, GUNS, MELEES, ARMORS, KITS, SLOTS, slotKind, itemName, shopPrice, MOD_AFFIXES, AFFIX_NAMES, modCost, ARMOR_AFFIXES, TALENTS, TALENT_ROWS, growOf, SKILL_LV, OUTFITS, artKey} from './company.js';
import {playScene} from './story.js';
import {REST_TALK, SOLO, IO, STORY} from './story-lines.js';
import {unitName, cellHas, cellCount, CELL_PITY} from './cases.js';
import {ServerLink, account, signOut, signedIn, authHeaders, token as guestToken} from './link.js';
// 預設連伺服器（大家共用的星球）；網址加 ?local 是單人測試模式（推演在這個瀏覽器的 worker 裡跑，可以加速）
// ?watch：觀看世界生成（Alan 2026-10-09，系統選單裡）：用星球的種子在這個瀏覽器從頭推演到開服那一年，只能看，不能開公司、不能再往後推
const WATCH = new URL(location).searchParams.has('watch');
const LOCAL = WATCH || new URL(location).searchParams.has('local');
document.body.classList.toggle('watch', WATCH);
document.body.classList.toggle('server', !LOCAL);
const $ = id => document.getElementById(id);
// 擋掉電腦瀏覽器的右鍵選單（Alan 2026-10-09）；輸入框照常可以貼上。戰鬥畫面的右鍵開火由 ASH 自己處理
document.addEventListener('contextmenu', e => { if (!e.target.closest('input,textarea')) e.preventDefault(); });
// 不能手勢縮放（Alan 2026-10-09）：iPhone 的 Safari 不理 user-scalable=no，要擋手勢事件；地圖自己的雙指縮放不受影響（用的是 touch 事件）
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), {passive: false});
const canvas = $('map'), ctx = canvas.getContext('2d');
const SQ3 = Math.sqrt(3);

let ST = null;                 // 靜態資料：地圖大小、地名、地形
let hist = [];                 // 每一年的樣子
let cur = 0, playing = false, timer = null, computing = false;
let allEvents = [];
let sel = -1, hover = -1, hiFac = -1, mouse = {x: 0, y: 0};
const layers = {fac: true, pop: false, bandit: false, trench: false, opp: true};
let oppKind = 'all';
const OK = {supply: {n: '前哨補給', ch: '補', c: '#5fd0c0'}, outpost: {n: '前哨爭奪', ch: '奪', c: '#ff7a5a'}, exp: {n: '遠征', ch: '遠', c: '#7fc06a'}, short: {n: '缺貨', ch: '補', c: '#6fb4e0'}, tense: {n: '快開戰', ch: '壓', c: '#e7a14a'}, front: {n: '前線', ch: '戰', c: '#ff5a3c'}, route: {n: '危險商路', ch: '護', c: '#e0cf5a'}, lair: {n: '據點', ch: '剿', c: '#c98a6a'}, camp: {n: '大戰役', ch: '役', c: '#ff3020'}, logging: {n: '伐木', ch: '柴', c: '#9fbf5a'}, clean: {n: '清運', ch: '收', c: '#b49ad8'}, retainer: {n: '長約', ch: '約', c: '#e8c35a'},
  shadow: {n: '黑單', ch: '暗', c: '#a070e0'}, counter: {n: '反情報', ch: '緝', c: '#60a0d0'}, privateer: {n: '私掠', ch: '掠', c: '#d0603a'},
  drill: {n: '練兵', ch: '練', c: '#8fbf8f'}, hunting: {n: '狩獵場', ch: '獵', c: '#7ad0b0'}, security: {n: '場地維安', ch: '安', c: '#c0b0e0'}};   // 練兵單、狩獵場、場地維安（Alan 2026-10-11）   // 暗影戰爭、私掠（Alan 2026-10-11）
let logFilter = 'legend';
let worker = null;

/* ───────── worker ───────── */
function start(seed) {
  if (worker) worker.terminate();
  worker = LOCAL ? new Worker('worker.js', {type: 'module'}) : new ServerLink();
  hist = []; allEvents = []; cur = 0; sel = -1; hiFac = -1; computing = true; GV = null; GM = null; coBuilt = false; $('pane-rep').innerHTML = ''; $('pane-trade').innerHTML = ''; mailSeen.clear(); mailFirst = true; $('mailBtn').hidden = WATCH; $('mail').hidden = true;   // 信封一直在（裡面有系統選單） QT = null; procSel = null; selPath = null; document.body.classList.remove('game'); $('gamebar').hidden = true;
  $('computing').hidden = false; $('computing').textContent = '生成地形…'; $('more').hidden = true;
  worker.onmessage = e => { try { handle(e.data); } catch (err) { reportError(err, e.data?.type); } };
  const handle = m => {
    if (m.type === 'static') { ST = m; fit(); }
    else if (m.type === 'year') {
      hist.push(m.data); for (const ev of m.data.events) allEvents.push(ev);
      $('slider').max = hist.length - 1; $('computing').textContent = `推演到第 ${m.data.y} 年…`;
      if (hist.length === 1) { cur = 0; renderAll(); if (LOCAL) setPlaying(true); }
      else if (GV) { cur = hist.length - 1; lastPanelY = -1; renderAll(); send({type: 'quotes'}); }
      if (!GV && page === 'co' && hist.length % 10 === 0) renderCo();
    } else if (m.type === 'solo') { onSolo(m.solo); } else if (m.type === 'idle') { computing = false; $('computing').hidden = true; $('more').hidden = WATCH; if (!LOCAL && !worker.company) { hideTitle(); showPage('co'); } }
    else if (m.type === 'relogin') { showTitle(m.text); }
    else if (m.type === 'chronicle') { allEvents = m.events; if (curTab() === 'log') renderLog(); }
    else if (m.type === 'game') { if (m.err) hideMissionLoading(); onGame(m); hideTitle(); }
    else if (m.type === 'mission') openMission(m.data);
    else if (m.type === 'error') { hideMissionLoading(); if (entering) showTitle('連線失敗：' + m.text); else toast(m.text); }   // 進場時出錯：停在標題畫面寫出原因，不卡在「連線中」
    else if (m.type === 'path') { selPath = m; draw(); renderSortie(); if (pickOpp) { renderOpp(); if (curTab() === 'tile' && sel >= 0) renderTile(); } }
    else if (m.type === 'quotes') { QT = m.data; if (procSel && !QT.some(q => q.t === procSel.t)) procSel = null; if (page === 'trade') renderProc(); }
  };
  worker.onerror = e => { $('computing').textContent = '推演出錯：' + (e.message || ''); };
  worker.postMessage({type: 'start', seed});
  if (LOCAL) { const u = new URL(location); u.searchParams.set('seed', seed); history.replaceState(null, '', u); }
}

/* ───────── 播放 ───────── */
function setPlaying(on) {
  playing = on; $('playBtn').textContent = on ? '❚❚' : '▶'; $('playBtn').setAttribute('aria-label', on ? '暫停' : '播放');
  clearInterval(timer);
  if (on) timer = setInterval(() => {
    if (cur < hist.length - 1) { cur++; renderAll(); }
    else if (!computing) setPlaying(false);
  }, 1000 / +$('speed').value);
}
$('playBtn').onclick = () => { if (!playing && cur >= hist.length - 1 && !computing) cur = 0; setPlaying(!playing); };
$('speed').onchange = () => { if (playing) setPlaying(true); };
$('slider').oninput = e => { cur = +e.target.value; renderAll(); };
$('gen').onclick = () => start($('seed').value.trim() || '奇美拉-1');
$('seed').onkeydown = e => { if (e.key === 'Enter') $('gen').click(); };
$('more').onclick = () => { computing = true; $('more').hidden = true; $('computing').hidden = false; worker.postMessage({type: 'more', years: 50}); if (!playing) setPlaying(true); };

/* ───────── 地圖幾何 ───────── */
let S0 = 10, k = 1, ox = 0, oy = 0, dpr = 1;
const colOf = i => i % ST.W, rowOf = i => Math.floor(i / ST.W);
const cx = i => (colOf(i) + .5 * (rowOf(i) & 1)) * SQ3 * S0 + SQ3 * S0 / 2;
const cy = i => rowOf(i) * 1.5 * S0 + S0;
function fit() {
  if (!ST) return;
  const r = canvas.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  S0 = Math.min(r.width / ((ST.W + .5) * SQ3), r.height / (ST.H * 1.5 + .5));
  k = 1; ox = (r.width - (ST.W + .5) * SQ3 * S0) / 2; oy = (r.height - (ST.H * 1.5 + .5) * S0) / 2; draw();
}
window.addEventListener('resize', () => { const kk = k, a = ox, b = oy; fit(); if (kk !== 1) { k = kk; ox = a; oy = b; draw(); } });
function hexPath(x, y, s) { ctx.beginPath(); for (let c = 0; c < 6; c++) { const a = Math.PI / 180 * (60 * c - 30); const px = x + s * Math.cos(a), py = y + s * Math.sin(a); c ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }
function nbrs(i) { const c = colOf(i), r = rowOf(i), d = (r & 1) ? [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]] : [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]], o = []; for (const [dc, dr] of d) { const cc = c + dc, rr = r + dr; if (cc >= 0 && cc < ST.W && rr >= 0 && rr < ST.H) o.push(rr * ST.W + cc); } return o; }
function hit(mx, my) {
  const x = (mx - ox) / k, y = (my - oy) / k, r = Math.round((y - S0) / (1.5 * S0));
  let best = -1, bd = 1e9;
  for (let rr = r - 1; rr <= r + 1; rr++) { if (rr < 0 || rr >= ST.H) continue; const c = Math.round((x - SQ3 * S0 / 2) / (SQ3 * S0) - .5 * (rr & 1)); for (let cc = c - 1; cc <= c + 1; cc++) { if (cc < 0 || cc >= ST.W) continue; const i = rr * ST.W + cc, d = (cx(i) - x) ** 2 + (cy(i) - y) ** 2; if (d < bd) { bd = d; best = i; } } }
  return bd <= S0 * S0 * 1.1 ? best : -1;
}

/* ───────── 顏色 ───────── */
const hex2 = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
const facById = s => { const m = {}; for (const f of s.fac) m[f.id] = f; return m; };

/* ───────── 畫地圖 ───────── */
let drawQueued = false;
function draw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(() => { drawQueued = false; drawNow(); }); } }
// 大戰役：公司模式照公司畫面（每 15 秒更新），觀看模式照年度資料
const campaignsNow = s => (GM?.campaigns || s?.campaigns || []);
function renderCampBar() {
  const el = $('campbar'); if (!el) return; const s = hist[cur], L = campaignsNow(s), fn = id => esc(s?.fac.find(f => f.id === id)?.n || '?');
  const live = L.filter(c => !c.done), ended = L.filter(c => c.done).slice(-2);
  el.hidden = !live.length && !ended.length;
  el.innerHTML = live.map(c => `<div class="camp"><b>⚔ ${esc(c.name)}大戰役</b> <span class="mini">第 ${Math.floor(c.days) + 1} 天</span>
    <div class="cside"><span>${fn(c.att)}</span><i style="width:${Math.round(c.fa * 100)}%"></i><em>${Math.round(c.fa * 100)}%${c.mulA > 1 ? `・傭兵 ×${c.mulA}` : ''}</em></div>
    <div class="cside d"><span>${fn(c.def)}</span><i style="width:${Math.round(c.fd * 100)}%"></i><em>${Math.round(c.fd * 100)}%${c.mulD > 1 ? `・傭兵 ×${c.mulD}` : ''}</em></div></div>`).join('')
    + ended.map(c => `<div class="camp done">${esc(c.name)}大戰役結束：${fn(c.win)}獲勝（${Math.max(1, Math.round(c.days))} 天）</div>`).join('');
}
function drawNow() {
  if (!ST || !hist.length) return;
  renderCampBar();
  const s = hist[cur], F = facById(s), N = ST.N;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0d0c0a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
  const bc = ST.biomes.map(b => hex2(b.c));
  const atWar = new Set(); for (const w of s.wars) { atWar.add(w.att + ':' + w.def); atWar.add(w.def + ':' + w.att); }
  // 地塊
  for (let i = 0; i < N; i++) {
    const x = cx(i), y = cy(i), b = s.biome[i], o = s.owner[i];
    let col = bc[b];
    let fill;
    if (layers.pop && ST.land[i]) { const p = Math.min(1, s.pop[i] / 120); fill = mix([40, 36, 30], [245, 215, 140], Math.sqrt(p)); }
    else if (layers.fac && o >= 0 && F[o]) { const fc = hex2(F[o].c); fill = mix(col, fc, hiFac >= 0 ? (o === hiFac ? .75 : .2) : .55); }
    else fill = `rgb(${col.join(',')})`;
    ctx.fillStyle = fill; hexPath(x, y, S0 + .35); ctx.fill();
    if (ST.river[i] && ST.land[i]) { ctx.fillStyle = 'rgba(120,170,190,.28)'; hexPath(x, y, S0 * .45); ctx.fill(); }
    if (layers.bandit && s.bandit[i] > 15) { ctx.fillStyle = `rgba(200,60,40,${Math.min(.65, s.bandit[i] / 255)})`; hexPath(x, y, S0); ctx.fill(); }
    if (layers.trench && s.trench[i]) { const lv = s.trench[i] / 80; ctx.strokeStyle = `rgba(30,20,10,${.35 + .2 * lv})`; ctx.lineWidth = S0 * .12; ctx.beginPath(); for (let q = -1; q <= 1; q++) { ctx.moveTo(x - S0 * .55, y + q * S0 * .32); ctx.lineTo(x + S0 * .55, y + q * S0 * .32 - S0 * .18); } ctx.stroke(); }
  }
  // 疆界與戰線
  ctx.lineCap = 'round';
  for (let i = 0; i < N; i++) {
    const o = s.owner[i]; if (o < 0) continue;
    for (const n of nbrs(i)) {
      const p = s.owner[n]; if (p === o || (p >= 0 && n < i)) continue;
      const war = p >= 0 && atWar.has(o + ':' + p);
      const a = Math.atan2(cy(n) - cy(i), cx(n) - cx(i)), x = cx(i), y = cy(i);
      ctx.strokeStyle = war ? '#ff5a3c' : 'rgba(15,12,8,.85)'; ctx.lineWidth = war ? Math.max(1.6, 2.6 / k) : Math.max(.7, 1.1 / k);
      ctx.beginPath(); ctx.moveTo(x + S0 * Math.cos(a - Math.PI / 6), y + S0 * Math.sin(a - Math.PI / 6)); ctx.lineTo(x + S0 * Math.cos(a + Math.PI / 6), y + S0 * Math.sin(a + Math.PI / 6)); ctx.stroke();
    }
  }
  // 城鎮與記號
  const caps = new Set(s.fac.map(f => f.cap)), sieges = new Set(s.wars.map(w => w.siege).filter(t => t >= 0));
  for (const t of s.towns) {
    const x = cx(t.t), y = cy(t.t), f = F[s.owner[t.t]];
    if (sieges.has(t.t)) { ctx.strokeStyle = '#ff5a3c'; ctx.lineWidth = Math.max(1.5, 2 / k); ctx.beginPath(); ctx.arc(x, y, S0 * .78, 0, 7); ctx.stroke(); }
    if (caps.has(t.t)) { star(x, y, S0 * .55, f ? f.c : '#fff'); }
    else { ctx.fillStyle = '#f1e6cf'; ctx.strokeStyle = '#1a1510'; ctx.lineWidth = Math.max(.6, 1 / k); ctx.beginPath(); ctx.arc(x, y, S0 * (.17 + Math.min(.16, t.pop / 2500)), 0, 7); ctx.fill(); ctx.stroke(); }
    if (t.vat) { ctx.fillStyle = '#6fd0d8'; const d = S0 * .2; ctx.beginPath(); ctx.moveTo(x + S0 * .45, y - S0 * .45 - d); ctx.lineTo(x + S0 * .45 + d, y - S0 * .45); ctx.lineTo(x + S0 * .45, y - S0 * .45 + d); ctx.lineTo(x + S0 * .45 - d, y - S0 * .45); ctx.closePath(); ctx.fill(); }
    if (t.works) { ctx.fillStyle = '#d9b86a'; ctx.fillRect(x - S0 * .62, y + S0 * .25, S0 * .3, S0 * .3); }
  }
  if (s.arc.elevator >= 0) { const x = cx(s.arc.elevator), y = cy(s.arc.elevator); ctx.strokeStyle = '#e9e1d2'; ctx.lineWidth = Math.max(1, 1.4 / k); ctx.beginPath(); ctx.moveTo(x, y - S0 * .55); ctx.lineTo(x, y - S0 * 1.6); ctx.stroke(); }
  for (const g of s.gangs) {
    const x = cx(g.lair), y = cy(g.lair), r = S0 * .32;
    if (g.native) { ctx.fillStyle = '#e0915a'; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * .8); ctx.lineTo(x - r, y + r * .8); ctx.closePath(); ctx.fill(); }
    else { ctx.strokeStyle = g.legacy ? '#ffd27a' : '#c4593c'; ctx.lineWidth = Math.max(1.2, 1.8 / k); ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); }
  }
  // 大戰役（Alan 2026-10-09）：戰場上兩圈紅環，外圈照雙方剩下的兵力（攻方左半、守方右半）
  for (const c of campaignsNow(s)) {
    if (c.done) continue;
    const x = cx(c.tile), y = cy(c.tile), r = S0 * 1.25, lw = Math.max(2, 3 / k);
    ctx.strokeStyle = '#ff4a2e88'; ctx.lineWidth = lw * 2.2; ctx.beginPath(); ctx.arc(x, y, r * 1.25, 0, 7); ctx.stroke();
    ctx.lineWidth = lw * 1.6; ctx.strokeStyle = F[c.att]?.c || '#f66'; ctx.beginPath(); ctx.arc(x, y, r, Math.PI / 2, Math.PI / 2 + Math.PI * Math.max(.02, c.fa)); ctx.stroke();
    ctx.strokeStyle = F[c.def]?.c || '#66f'; ctx.beginPath(); ctx.arc(x, y, r, Math.PI / 2, Math.PI / 2 - Math.PI * Math.max(.02, c.fd), true); ctx.stroke();
    ctx.fillStyle = '#ffd9cf'; ctx.font = `700 ${S0 * 1.1}px 'Noto Sans TC',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⚔', x, y - r * 1.55);
  }
  // 機會：圓牌上一個字，外圈越粗越亮程度越高
  if (layers.opp) for (const o of curOpps(s)) {
    if (oppKind !== 'all' && o.kind !== oppKind) continue;
    const K = OK[o.kind], x = cx(o.tile) + S0 * .35, y = cy(o.tile) + S0 * .3, r = S0 * (.38 + o.lv * .08);
    if (o.lv === 3) { ctx.fillStyle = K.c + '55'; ctx.beginPath(); ctx.arc(x, y, r * 1.55, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#15120e'; ctx.strokeStyle = K.c; ctx.lineWidth = Math.max(.8, (o.lv * .9) / Math.sqrt(k)) * (S0 / 10); ctx.globalAlpha = o.lv === 1 ? .7 : 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = K.c; ctx.font = `700 ${r * 1.15}px 'Noto Sans TC',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(K.ch, x, y + r * .05); ctx.globalAlpha = 1;
  }
  // 公司：總部、接下的案件、服務單
  if (GV) {
    // 遠征點（基地到場搜索）、突發事件、搶購（Alan 2026-10-12 移動基地）
    const W = GV.world || {};
    for (const x of W.sites || []) { if (x.taken) continue; const px = cx(x.tile), py = cy(x.tile), r = S0 * .38; ctx.fillStyle = '#2a2116'; ctx.strokeStyle = '#c49a5a'; ctx.lineWidth = Math.max(1, 1.4 / k); ctx.beginPath(); ctx.rect(px - r, py - r, r * 2, r * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#e0c08a'; ctx.font = `700 ${r * 1.3}px 'Noto Sans TC',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('搜', px, py + r * .05); }
    for (const x of W.events || []) { const px = cx(x.tile), py = cy(x.tile), r = S0 * .55; ctx.fillStyle = '#f2c94c'; ctx.strokeStyle = '#0d0c0a'; ctx.lineWidth = Math.max(1, 1.5 / k); ctx.beginPath(); for (let q = 0; q < 10; q++) { const a = q * Math.PI / 5 - Math.PI / 2, rr = q % 2 ? r * .5 : r; ctx.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
    for (const x of W.deals || []) { if (x.left <= 0) continue; const px = cx(x.tile) + S0 * .45, py = cy(x.tile) - S0 * .45, r = S0 * .36; ctx.fillStyle = x.mine ? '#5b6b55' : '#8fd18b'; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill(); ctx.fillStyle = '#0d0c0a'; ctx.font = `700 ${r * 1.4}px 'IBM Plex Mono',monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', px, py + r * .05); }
    // 東方謠言（Alan 2026-10-12）：傳聞中的舊星艦維修站，紅★
    if (W.rumor) { const px = cx(W.rumor.tile), py = cy(W.rumor.tile), r = S0 * .9; ctx.fillStyle = '#ff5a5a'; ctx.strokeStyle = '#0d0c0a'; ctx.lineWidth = Math.max(1, 1.6 / k); ctx.beginPath(); for (let q = 0; q < 10; q++) { const a = q * Math.PI / 5 - Math.PI / 2, rr = q % 2 ? r * .45 : r; ctx.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
    // 基地：開動中照時間在兩格之間移動，剩下的路畫虛線（原本的 Rover）
    const H = GV.hq || {tile: GV.base, route: []}, hnow = hourNow() ?? GV.h, hf = H.move ? Math.max(0, Math.min(1, (hnow - H.move.t0) / Math.max(.01, H.move.t1 - H.move.t0))) : 0, ha = H.move ? H.move.from : GV.base, hb = H.move ? H.move.to : GV.base;
    const bx = cx(ha) + (cx(hb) - cx(ha)) * hf, by = cy(ha) + (cy(hb) - cy(ha)) * hf, hrest = [hb, ...(H.route || [])];
    if (hrest.length > 1) { ctx.save(); ctx.setLineDash([S0 * .25, S0 * .3]); ctx.lineWidth = Math.max(1, 1.8 / k); ctx.strokeStyle = 'rgba(111,208,216,.8)'; ctx.beginPath(); ctx.moveTo(bx, by); hrest.forEach(t => ctx.lineTo(cx(t), cy(t))); ctx.stroke(); ctx.restore(); }
    ctx.strokeStyle = '#6fd0d8'; ctx.lineWidth = Math.max(1.5, 2.4 / k); ctx.beginPath(); ctx.arc(bx, by, S0 * .9, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(bx, by, S0 * 1.15, 0, 7); ctx.stroke();
    ctx.fillStyle = '#6fd0d8'; ctx.font = `700 ${S0 * .8}px 'IBM Plex Mono',monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', bx, by + S0 * .04);
    for (const c of GV.cases) { if (c.settled) continue; const x = cx(c.tile), y = cy(c.tile), r = S0 * .85; ctx.strokeStyle = '#f1e6cf'; ctx.lineWidth = Math.max(1.4, 2 / k); ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke(); }
    // 選取的點：從基地沿實際道路拉一條虛線
    if (selPath && selPath.to === sel && selPath.path.length > 1) {
      ctx.save(); ctx.setLineDash([S0 * .5, S0 * .35]); ctx.lineWidth = Math.max(1.6, 2.6 / k); ctx.strokeStyle = 'rgba(255,240,210,.95)'; ctx.lineJoin = 'round';
      ctx.beginPath(); selPath.path.forEach((t, q) => q ? ctx.lineTo(cx(t), cy(t)) : ctx.moveTo(cx(t), cy(t))); ctx.stroke(); ctx.restore();
      if (selPath.hours >= 0) { const t = selPath.path[selPath.path.length - 1]; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; label(`單程 ${fmtH(selPath.hours)}`, cx(t), cy(t) + S0 * .9, Math.max(9 / k, S0 * .6), '#fff0d2'); }
    }
    // 派出去的人馬：剩下的路（淡虛線）＋現在的位置
    for (const u of GV.units || []) {
      if (u.path && u.path.length > 1) { ctx.save(); ctx.setLineDash([S0 * .25, S0 * .3]); ctx.lineWidth = Math.max(1, 1.4 / k); ctx.strokeStyle = u.kind === 'returning' ? 'rgba(160,200,170,.6)' : u.kind === 'convoy' ? 'rgba(224,166,74,.6)' : 'rgba(111,208,216,.65)';
        ctx.beginPath(); u.path.forEach((t, q) => q ? ctx.lineTo(cx(t), cy(t)) : ctx.moveTo(cx(t), cy(t))); ctx.stroke(); ctx.restore(); }
    }
    for (const u of GV.units || []) {
      if (!u.pos) continue; const x = cx(u.pos.a) + (cx(u.pos.b) - cx(u.pos.a)) * u.pos.f, y = cy(u.pos.a) + (cy(u.pos.b) - cy(u.pos.a)) * u.pos.f, r = S0 * .42;
      const col = u.kind === 'waiting' ? '#f2c94c' : u.kind === 'returning' ? '#a0c8aa' : u.kind === 'convoy' ? '#e0a64a' : u.kind === 'column' ? '#9fe3ea' : '#6fd0d8';
      ctx.fillStyle = col; ctx.strokeStyle = '#0d0c0a'; ctx.lineWidth = Math.max(1, 1.5 / k);
      if (u.kind === 'convoy') { ctx.beginPath(); ctx.rect(x - r * .8, y - r * .6, r * 1.6, r * 1.2); ctx.fill(); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      if (u.n) { ctx.fillStyle = '#0d0c0a'; ctx.font = `700 ${r * 1.05}px 'IBM Plex Mono',monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(u.n, x, y + r * .05); }
      if (u.busy) { ctx.strokeStyle = '#e05a43'; ctx.lineWidth = Math.max(1.4, 2 / k); ctx.beginPath(); ctx.arc(x, y, r * 1.35, 0, 7); ctx.stroke(); }
    }
    for (const t of GV.tickets) { const x = cx(t.tile) - S0 * .4, y = cy(t.tile) - S0 * .45, r = S0 * .42; ctx.fillStyle = t.transit ? '#b3784a' : '#e05a43'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = `700 ${r * 1.4}px 'Noto Sans TC',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', x, y + r * .05); }
  }
  // 名字：首府一定標，放大後標城鎮
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const fs = Math.max(9 / k, S0 * .62);
  for (const f of s.fac) { if (f.cap < 0) continue; label(f.n, cx(f.cap), cy(f.cap) - S0 * .6, fs * 1.05, '#fff'); }
  if (k > 1.7) for (const t of s.towns) if (!caps.has(t.t)) label(ST.names[t.t], cx(t.t), cy(t.t) - S0 * .4, fs * .85, '#e9e1d2');
  if (sel >= 0) { ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, 2.2 / k); hexPath(cx(sel), cy(sel), S0 * .95); ctx.stroke(); }
}
function star(x, y, r, c) { ctx.beginPath(); for (let q = 0; q < 10; q++) { const a = -Math.PI / 2 + q * Math.PI / 5, rr = q % 2 ? r * .45 : r; ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); } ctx.closePath(); ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = '#120f0b'; ctx.lineWidth = Math.max(.8, 1.2 / k); ctx.stroke(); }
function label(t, x, y, size, col) { ctx.font = `500 ${size}px 'Noto Sans TC',sans-serif`; ctx.lineWidth = size * .28; ctx.strokeStyle = 'rgba(10,8,6,.9)'; ctx.strokeText(t, x, y); ctx.fillStyle = col; ctx.fillText(t, x, y); }

/* ───────── 平移縮放、點選 ───────── */
const pts = new Map(); let moved = false, pinch0 = null;
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, {x: e.offsetX, y: e.offsetY}); moved = false; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = {d: Math.hypot(a.x - b.x, a.y - b.y), k, ox, oy, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2}; } canvas.classList.add('drag'); });
canvas.addEventListener('pointermove', e => {
  const p = pts.get(e.pointerId);
  if (!p) { if (ST && hist.length && e.pointerType === 'mouse') { mouse = {x: e.offsetX, y: e.offsetY}; const i = hit(e.offsetX, e.offsetY); if (i !== hover) { hover = i; showTip(e.offsetX, e.offsetY); } else moveTip(e.offsetX, e.offsetY); } return; }
  if (pts.size === 2 && pinch0) { p.x = e.offsetX; p.y = e.offsetY; const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); zoomAt(pinch0.mx, pinch0.my, Math.max(.6, Math.min(8, pinch0.k * d / pinch0.d)), pinch0); moved = true; return; }
  const dx = e.offsetX - p.x, dy = e.offsetY - p.y; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; ox += dx; oy += dy; p.x = e.offsetX; p.y = e.offsetY; draw();
});
const up = e => { const was = pts.has(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null; canvas.classList.remove('drag'); if (was && !moved && pts.size === 0 && ST) { const i = hit(e.offsetX, e.offsetY); if (i >= 0) select(i); } };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('pointerleave', () => { hover = -1; $('tip').hidden = true; });
canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.max(.6, Math.min(8, k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); }, {passive: false});
function zoomAt(mx, my, nk, base) { const b = base || {k, ox, oy}; ox = mx - (mx - b.ox) * nk / b.k; oy = my - (my - b.oy) * nk / b.k; k = nk; draw(); }
$('zin').onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, Math.min(8, k * 1.4)); };
$('zout').onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, Math.max(.6, k / 1.4)); };
$('zfit').onclick = fit;
function centerOn(i) { const r = canvas.getBoundingClientRect(); if (k < 1.8) k = 1.8; ox = r.width / 2 - cx(i) * k; oy = r.height / 2 - cy(i) * k; draw(); }

function showTip(mx, my) {
  const tip = $('tip'); if (hover < 0) { tip.hidden = true; return; }
  const s = hist[cur], o = s.owner[hover], F = facById(s), t = s.towns.find(x => x.t === hover);
  tip.innerHTML = `<b>${ST.names[hover] || ST.biomes[s.biome[hover]].n}</b>　<span class="muted">${ST.biomes[s.biome[hover]].n}</span><br>${o >= 0 && F[o] ? F[o].n : '<span class="muted">無主</span>'}${s.pop[hover] ? `・人口 ${s.pop[hover]}` : ''}${t ? `<br>市鎮${t.vat ? `・培養槽 ${t.vat}` : ''}${t.works ? '・廠區' : ''}` : ''}${s.trench[hover] ? `<br>戰壕 ${(s.trench[hover] / 80).toFixed(1)} 級` : ''}`;
  tip.hidden = false; moveTip(mx, my);
}
function moveTip(mx, my) { const tip = $('tip'), r = canvas.getBoundingClientRect(); tip.style.left = Math.min(mx + 14, r.width - tip.offsetWidth - 6) + 'px'; tip.style.top = Math.min(my + 14, r.height - tip.offsetHeight - 6) + 'px'; }

/* ───────── 側欄 ───────── */
const esc = t => String(t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
// 地圖的面板（Alan 2026-10-09）：像名冊一樣收在底部，點分頁往上展開；再點同一個分頁或 ▲▼ 收起
let panelOpen = false;
function setPanel(open) { panelOpen = open; document.querySelector('.panel').classList.toggle('open', open); $('pcaret').textContent = open ? '▼' : '▲'; }
function tab(name, toggle = false) {
  if (toggle && panelOpen && curTab() === name) { setPanel(false); return; }
  for (const b of document.querySelectorAll('.tabs button[data-tab]')) b.classList.toggle('on', b.dataset.tab === name); for (const p of document.querySelectorAll('.pane')) p.hidden = p.id !== 'pane-' + name;
  setPanel(true); renderPanel();
}
for (const b of document.querySelectorAll('.tabs button[data-tab]')) b.onclick = () => tab(b.dataset.tab, true);
$('pcaret').onclick = () => setPanel(!panelOpen);
for (const b of document.querySelectorAll('#filters button')) b.onclick = () => { logFilter = b.dataset.f; for (const x of document.querySelectorAll('#filters button')) x.classList.toggle('on', x === b); renderLog(); };
$('legend').hidden = innerWidth < 820;
document.querySelector('.layers [data-legend]').onclick = e => { $('legend').hidden = !$('legend').hidden; e.currentTarget.classList.toggle('on', !$('legend').hidden); };
document.querySelector('.layers [data-legend]').classList.toggle('on', innerWidth >= 820);
for (const b of document.querySelectorAll('.layers button[data-layer]')) b.onclick = () => { const L = b.dataset.layer; layers[L] = !layers[L]; if (L === 'fac' && layers.fac) layers.pop = false; if (L === 'pop' && layers.pop) layers.fac = false; for (const x of document.querySelectorAll('.layers button[data-layer]')) x.classList.toggle('on', layers[x.dataset.layer]); draw(); };
const curTab = () => document.querySelector('.tabs button[data-tab].on').dataset.tab;

const CAT = {legend: t => t === 'legend', war: t => t === 'war', econ: t => ['econ', 'build', 'found', 'ruin', 'disaster'].includes(t), bandit: t => t === 'bandit', all: t => t !== 'trade'};
function renderLog() {
  const y = hist[cur].y, f = CAT[logFilter], list = [];
  for (let i = allEvents.length - 1; i >= 0 && list.length < 500; i--) { const e = allEvents[i]; if (e.y <= y && f(e.type)) list.push(e); }
  let html = '', lastY = null;
  for (const e of list) { if (e.y !== lastY) { html += `<li class="yh">第 ${e.y} 年</li>`; lastY = e.y; } html += `<li class="${e.type}"${e.tile >= 0 ? ` data-tile="${e.tile}"` : ''}>${esc(e.text)}</li>`; }
  $('log').innerHTML = html || '<li class="muted">這段時間還沒有記錄。</li>';
}
$('log').onclick = e => { const li = e.target.closest('li[data-tile]'); if (li) { const t = +li.dataset.tile; select(t, true, true); } };

function facTags(f, s) { const L = s.leagues.find(x => x.id === f.league), lg = f.liege >= 0 ? s.fac.find(x => x.id === f.liege) : null; return `${f.free ? '<span class="tag free">自由城市</span>' : ''}${f.works ? '<span class="tag works">廠鎮</span>' : ''}${f.native ? '<span class="tag native">原住民</span>' : ''}${L ? `<span class="tag works">${esc(L.n)}</span>` : ''}${lg ? `<span class="tag">${esc(lg.n)}的附庸</span>` : ''}`; }
function renderFac() {
  const s = hist[cur], groups = [...s.blocs.map(B => ({B, m: s.fac.filter(f => f.bloc === B.id)})), {B: null, m: s.fac.filter(f => !s.blocs.some(B => B.id === f.bloc))}];
  let html = `<p class="muted" style="margin:0 0 10px">${s.fac.length} 個勢力・${s.wars.length} 場戰爭進行中。點一個勢力看它的地盤。</p>`;
  for (const {B, m} of groups) {
    if (!m.length) continue; m.sort((a, b) => b.pop - a.pop);
    html += `<div class="bloc"><h3>${B ? esc(B.n) + `<span class="muted" style="font-weight:400">　盟主 ${esc(s.fac.find(f => f.id === B.lead)?.n || '')}</span>` : (s.blocs.length ? '不屬於任何陣營' : '各方勢力')}</h3>`;
    for (const f of m) {
      const wars = s.wars.filter(w => w.att === f.id || w.def === f.id).map(w => s.fac.find(x => x.id === (w.att === f.id ? w.def : w.att))?.n).filter(Boolean);
      html += `<div class="frow" data-f="${f.id}"><i class="sw" style="background:${f.c}"></i><span class="nm">${esc(f.n)} ${facTags(f, s)}</span><span class="pp">${f.pop}</span>
        <span class="meta">${f.ruler ? esc(f.ruler) + '・' : ''}${f.tiles} 格・複製兵 ${f.clones}・培養槽 ${f.vats}${f.taboo >= .05 ? `（顧忌 ${f.taboo}）` : ''}・武裝車 ${Math.round(f.veh.armor)}・衝鋒車 ${Math.round(f.veh.rush + (f.veh.bomb || 0))}・卡車 ${Math.round(f.veh.truck)}${wars.length ? `<br><span style="color:var(--war)">交戰：${wars.map(esc).join('、')}</span>` : ''}</span></div>`;
    }
    html += '</div>';
  }
  $('pane-fac').innerHTML = html;
}
$('pane-tile').onclick = e => { if (recallClick(e)) return; if (e.target.closest('[data-act^="base"],[data-act="deal"],[data-act="note"],[data-act="say"]')) { coClick(e); return; }   // 基地開到這裡、搶購、留言
  const b = e.target.closest('[data-found]'); if (b) { found(+b.dataset.found); return; } const p = e.target.closest('[data-proc]'); if (p) { procSel = {t: +p.dataset.proc, mat: '', qty: 100, uids: new Set()}; showPage('trade'); send({type: 'quotes'}); } };
$('pane-fac').onclick = e => { const r = e.target.closest('.frow'); if (!r) return; const id = +r.dataset.f; hiFac = hiFac === id ? -1 : id; const f = hist[cur].fac.find(x => x.id === id); if (f && hiFac >= 0) centerOn(f.cap); draw(); };

function renderTile() {
  if ($('pane-tile').contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;   // 正在打留言，先不重畫
  const s = hist[cur], i = sel; if (i < 0) { $('pane-tile').innerHTML = '<p class="muted">點地圖上的格子看細節。</p>'; return; }
  const F = facById(s), o = s.owner[i], t = s.towns.find(x => x.t === i), g = s.gangs.filter(x => x.lair === i);
  let html = `<h2>${esc(ST.names[i] || '無名之地')}</h2><dl class="kv"><dt>地形</dt><dd>${ST.biomes[s.biome[i]].n}${ST.river[i] ? '・有水脈' : ''}</dd><dt>屬於</dt><dd>${o >= 0 && F[o] ? esc(F[o].n) : '無主'}</dd>`;
  if (s.pop[i]) html += `<dt>人口</dt><dd>${s.pop[i]}</dd>`;
  if (s.trench[i]) html += `<dt>戰壕</dt><dd>${(s.trench[i] / 80).toFixed(1)} 級</dd>`;
  if (s.bandit[i] > 15) html += `<dt>掠奪者</dt><dd>${Math.round(s.bandit[i] / 2.55)}%</dd>`;
  if (i === s.arc.elevator) html += `<dt>地標</dt><dd>軌道電梯</dd>`;
  html += '</dl>';
  for (const o of curOpps(s).filter(o => o.tile === i)) { const K = OK[o.kind]; html += `<p style="border-left:3px solid ${K.c};padding-left:8px"><b style="color:${K.c}">${K.n} ${'●'.repeat(o.lv)}${'○'.repeat(3 - o.lv)}</b>　${esc(o.title)}${ownWarn(o)}<br><span class="muted">${esc(o.detail)}</span></p>`; }
  if (GV) html += baseTileHtml(i);
  if (GV) { const here = (GV.units || []).filter(u => u.pos && (u.pos.f < .5 ? u.pos.a : u.pos.b) === i);
    if (here.length) html += `<h2 style="margin-top:10px">我的人馬</h2>` + here.map(u => `<div class="card"><b>${esc(u.name)}</b>${u.n ? ` <span class="mini">${u.n} 人</span>` : ''}<div class="mini">${esc(u.status)}${u.where ? '・' + esc(u.where) : ''}</div>${recallBtn(u)}</div>`).join(''); }
  if (GV && t && i !== GV.base) html += `<p><button data-proc="${i}">向這座城訂貨</button> <span class="mini muted">對方派車隊送到基地現在停的城</span></p>`;
  if (!GV && s.fac.some(f => f.cap === i)) html += `<p><button class="primary" data-found="${i}">在這裡開公司</button> <span class="muted">總部設在這座主城，從這一年開始經營。</span></p>`;
  for (const x of g) html += `<p>${x.native ? '原住民' : x.hive ? '巢匪據點' : '掠奪者據點'}：<b>${esc(x.name)}</b>（勢力 ${x.str}${x.legacy ? '，手上有遺產級' : ''}）</p>`;
  if (t) {
    html += `<h2 style="margin-top:10px">市鎮</h2><dl class="kv"><dt>服務人口</dt><dd>${t.pop}</dd>${t.lord ? `<dt>課長</dt><dd>${esc(t.lord)}</dd>` : ''}<dt>培養槽</dt><dd>${t.vat || '沒有'}</dd>${t.works ? '<dt>廠區</dt><dd>有</dd>' : ''}`;
    if (t.veh) html += `<dt>車庫</dt><dd>${Object.entries(t.veh).filter(([, v]) => v >= .5).map(([v, n]) => `${ST.vn[v]} ${Math.round(n)}`).join('・') || '空的'}</dd>`;
    html += '</dl><table class="stock"><tr><th>貨物</th><th>存量</th><th>滿足度</th></tr>' + ST.goods.map(gd => `<tr><td>${ST.gn[gd]}</td><td>${t.stock[gd]}</td><td style="color:${t.ratio[gd] < .8 ? 'var(--war)' : 'inherit'}">${Math.round(t.ratio[gd] * 100)}%</td></tr>`).join('') + '</table>';
  }
  $('pane-tile').innerHTML = html;
}
// 選人照分類列（Alan 2026-10-10）：主力、最愛、培育中、替補、待合成、沒分類；有好幾個分類的人每一組都會出現（勾的是同一個人）
function pickGroups(av) {
  if (!av.length) return '<div class="chips"><span class="muted">沒有待命的人</span></div>';
  const G = [...Object.entries(TAGS).map(([k, n]) => [n, av.filter(c => (c.tags || []).includes(k))]), ['沒分類', av.filter(c => !(c.tags || []).length)]].filter(([, L]) => L.length);
  return G.map(([n, L]) => `<div class="mini pgroup">${n}（${L.length}）</div><div class="chips">${L.map(c => chip(c, pickOpp.uids.has(c.uid), 'pk')).join('')}</div>`).join('');
}
// ===== 出擊編成（Alan 2026-10-10）=====
// 在機會按「接案」進到這個畫面：一隊四個位置。電腦橫向是四張直長卡片排開，選中的人卡片下半壓一層他現在的裝備；
// 手機直向是四張橫長卡片，只露出頭和往右延伸的名字，裝備收在卡片下面、點開才展開。按「確認出擊」才真的派出去。
let sortie = null;   // {key, tile, side, fast, sq: [[uid|null ×4]…], pick: [i, j] | null, open: Set}
function openSortie(o) {
  sortie = {key: o.kind + ':' + o.tile, tile: o.tile, side: o.side ? o.side : o.kind === 'front' || o.kind === 'camp' ? 'att' : o.kind === 'tense' || o.kind === 'outpost' ? 'a' : o.kind === 'drill' ? '1' : '', fast: false, sq: [[null, null, null, null]], pick: null, open: new Set()};
  if (!selPath || selPath.to !== o.tile) send({type: 'path', to: o.tile});
  renderSortie();
}
const sortieUids = () => sortie.sq.flat().filter(u => u != null);
function sortieCard(u, i, j) {
  const c = u != null && GV.roster.find(x => x.uid === u);
  if (!c) return `<button class="scard empty${sortie.pick?.[0] === i && sortie.pick?.[1] === j ? ' on' : ''}" data-slot="${i}:${j}"><span>＋</span><small>選人</small></button>`;
  const get = gearOfC(c), gear = SLOTS.map(s => [SLOT_N[s], get(s)]).filter(([, it]) => it).map(([n, it]) => `<div><span>${n}</span>${esc(itemName(it))}</div>`).join('') || '<div class="muted">沒有裝備</div>';
  const open = sortie.open.has(u);
  return `<div class="scard full${open ? ' gopen' : ''}">
    <div class="sart" data-smenu="${i}:${j}" title="點一下：換人、編輯裝備"><img class="sface" src="${face(c)}" alt=""><img class="sfull" src="${fullArt(c)}" alt="" onerror="this.onerror=null;this.src='${face(c)}';this.parentElement.classList.add('px')"></div>
    ${sortie.menu?.[0] === i && sortie.menu?.[1] === j ? `<div class="smenu"><button data-slot="${i}:${j}">換人</button><button data-sgear="${u}">編輯裝備</button><button data-sinfo="${u}">看資料</button></div>` : ''}
    <div class="sinfo"><div class="sname"><b>${c.callsign ? csq(c) : esc(who(c))}</b> <span class="mini">${c.callsign ? esc(who(c)) + ' ' : ''}${c.id}・${CLS[c.cls].n}・${c.lv || 1} 級</span></div>
    <div class="sgear">${gear}</div></div>
    <button class="sgtog" data-sg="${u}">${open ? '收起裝備 ▴' : '裝備 ▾'}</button>
    <button class="sx" data-sx="${i}:${j}" aria-label="拿掉">✕</button></div>`;
}
function renderSortie() {
  const P = $('sortie'); if (!P) return;
  const o = sortie && GV && (sortie.custom || curOpps().find(x => x.kind + ':' + x.tile === sortie.key));
  P.hidden = !o; if (!o) { $('spick').hidden = true; if (sortie && GV) sortie = null; return; }
  const K = OK[o.kind] || {n: '行動', c: '#e6c281'}, s = hist[cur], fn = id => s?.fac?.find(f => f.id === id)?.n || '';
  const sides = o.joined || sortie.custom ? [] : o.kind === 'front' || o.kind === 'camp' ? [['att', '替攻方 ' + fn(o.att)], ['def', '替守方 ' + fn(o.def)]] : o.kind === 'outpost' ? [['a', '替 ' + fn(o.a) + ' 守'], ['b', '替 ' + fn(o.b) + ' 搶']] : o.kind === 'tense' ? [['a', '替 ' + fn(o.a)], ['b', '替 ' + fn(o.b)]] : o.kind === 'drill' ? [['1', '難度 1'], ['2', '難度 2'], ['3', '難度 3']] : [];
  const chosen = new Set(sortieUids()), n = chosen.size, bad = !sortie.custom?.min && sortie.sq.some(q => q.filter(u => u != null).length === 1);
  const av = GV.roster.filter(c => c.alive && c.status === 'home' && !c.keep && !chosen.has(c.uid) && (!sortie.custom?.avail || sortie.custom.avail(c)));   
  const groups = [...Object.entries(TAGS).map(([k, nm]) => [nm, av.filter(c => (c.tags || []).includes(k))]), ['沒分類', av.filter(c => !(c.tags || []).length)]].filter(([, L]) => L.length);
  // 選人：另一張卡片疊在編成畫面上（Alan 2026-10-10）；一列一個人，照分類分組
  const row = c => `<button class="sprow" data-sp="${c.uid}"><img src="${face(c)}" alt=""><span class="sprn"><b>${c.callsign ? csq(c) : esc(who(c))}</b> <span class="mini">${c.callsign ? esc(who(c)) + ' ' : ''}${c.id}</span><br><span class="mini">${CLS[c.cls].n}・${c.lv || 1} 級・記憶片段 ${cellCount(c)}${c.crown === 'gold' ? '・金冠' : c.crown === 'silver' ? '・銀冠' : ''}${(c.tags || []).length ? '・' + c.tags.map(t => TAGS[t]).join('、') : ''}</span></span></button>`;
  const SP = $('spick'); SP.hidden = !sortie.pick;
  if (sortie.pick) $('spbox').html = `<div class="shead"><b style="flex:1">選人：第 ${sortie.pick[0] + 1} 隊第 ${sortie.pick[1] + 1} 位</b><button data-pickx="1" aria-label="關閉">✕</button></div>${groups.map(([nm, L]) => `<div class="mini pgroup">${nm}（${L.length}）</div><div class="sprows">${L.map(row).join('')}</div>`).join('') || '<p class="muted">沒有待命的人（「不出擊」的人不會列出）</p>'}`;
  const picker = '';
  $('sbox').html = `<div class="shead"><div style="flex:1"><b style="color:${K.c}">${K.n} ${'●'.repeat(o.lv)}${'○'.repeat(3 - o.lv)}</b>　${esc(o.title)}${ownWarn(o)}<div class="mini muted">${esc(o.detail || '')}</div></div><button data-scancel="1" aria-label="關閉">✕</button></div>
    ${sides.length ? `<div class="row">${sides.map(([v, nm]) => `<button data-side="${v}" class="${sortie.side === v ? 'on' : ''}">${esc(nm)}</button>`).join('')}</div>` : ''}
    ${sortie.sq.map((q, i) => `<div class="sqlabel mini">第 ${i + 1} 隊（${q.filter(u => u != null).length}／4）${sortie.sq.length > 1 && !q.some(u => u != null) ? ` <button data-sqx="${i}">拿掉這一隊</button>` : ''}</div><div class="srow">${q.map((u, j) => sortieCard(u, i, j)).join('')}</div>`).join('')}
    <div class="row">${sortie.custom?.one ? '<span class="mini muted">一次行動一隊（最多四人）</span>' : o.here || sortie.custom ? '<button data-addsq="1">＋ 再編一隊</button>' : '<span class="mini muted">一台運兵車載一隊（四人）；要派更多隊，把基地開到這裡</span>'}</div>
    ${picker}
    ${sortie.custom ? '' : vanRow(o, sortie.sq.filter(q => q.some(u => u != null)).length)}
    <div class="row sfoot">${bad ? '<span class="mini" style="color:var(--war)">每一隊至少兩個人</span>' : ''}<button class="primary" data-sgo="1"${n < (sortie.custom?.min || 2) || bad || (!sortie.custom && vanBlock(o, sortie.sq.filter(q => q.some(u => u != null)).length)) ? ' disabled' : ''}>確認出擊（${n} 人）</button><button data-scancel="1">取消</button></div>`;
}
$('sortie').onclick = e => {
  if (e.target.id === 'sortie') { sortie = null; renderSortie(); return; }
  const a = e.target.closest('[data-smenu],[data-sgear],[data-sinfo],[data-slot],[data-sp],[data-sx],[data-sg],[data-addsq],[data-sqx],[data-side],[data-sgo],[data-scancel],[data-pickx]');
  if (!sortie) return;
  // 點大頭照：卡片上面跳出小選單（換人、編輯裝備、看資料）；點別的地方就收起來
  const menu0 = sortie.menu; sortie.menu = null;
  if (!a) { if (menu0) renderSortie(); return; }
  const d = a.dataset, ij = v => v.split(':').map(Number);
  if (d.smenu) { const m = ij(d.smenu); sortie.menu = menu0 && menu0[0] === m[0] && menu0[1] === m[1] ? null : m; }
  else if (d.sgear || d.sinfo) { personSel = +(d.sgear || d.sinfo); gearPick = null; renderRoster(); }   // 人員卡片疊在編成畫面上，裝備在那裡換
  else if (d.slot) sortie.pick = ij(d.slot);
  else if (d.sp) { const [i, j] = sortie.pick || []; if (i != null) sortie.sq[i][j] = +d.sp; sortie.pick = null; }
  else if (d.sx) { const [i, j] = ij(d.sx); sortie.open.delete(sortie.sq[i][j]); sortie.sq[i][j] = null; }
  else if (d.sg) { const u = +d.sg; sortie.open.has(u) ? sortie.open.delete(u) : sortie.open.add(u); }
  else if (d.addsq) sortie.sq.push([null, null, null, null]);
  else if (d.sqx) sortie.sq.splice(+d.sqx, 1);
  else if (d.side) sortie.side = d.side;
  else if (d.pickx) sortie.pick = null;
  else if (d.sgo && sortie.custom) { sortie.custom.go(sortie.sq.flatMap(q => q.filter(u => u != null))); sortie = null; }
  else if (d.sgo) { const [kind, tile] = sortie.key.split(':'); send({type: 'accept', kind, tile: +tile, side: sortie.side, uids: sortie.sq.flatMap(q => q.filter(u => u != null))}); sortie = null; }
  else if (d.scancel) sortie = null;
  renderSortie();
};
$('spick').onclick = e => {
  if (!sortie) return;
  if (e.target.id === 'spick' || e.target.closest('[data-pickx]')) { sortie.pick = null; renderSortie(); return; }
  const a = e.target.closest('[data-sp]'); if (!a) return;
  const [i, j] = sortie.pick || []; if (i != null) sortie.sq[i][j] = +a.dataset.sp; sortie.pick = null; renderSortie();
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sortie && $('pcard').hidden) { if (sortie.pick) sortie.pick = null; else sortie = null; renderSortie(); } });
function accPicker(o) {
  const key = o.kind + ':' + o.tile; if (!GV) return '';
  if (o.busy) return '';   // 同一格已經接了別的委託（core.js boardView）
  if (o.clean) return `<div class="row" style="margin-top:4px"><button data-clean="${o.tile}">出車清運</button></div>`;
  if (o.ret) return `<div class="row" style="margin-top:4px"><button data-ret="${o.ret.id}">簽約</button></div>`;
  // 大戰役（Alan 2026-10-09）：不限隊數、接了之後可以一再加派、撤軍不違約
  const camp = o.kind === 'camp', campNote = camp ? '<div class="mini">大戰役：派幾隊都可以，服務單一張接一張、越來越大；撤軍不算違約，已打下的貢獻照算。</div>' : '';
  if (!pickOpp || pickOpp.key !== key) return `${camp && !o.joined ? campNote : ''}<div class="row" style="margin-top:4px"><button data-acc="${key}">${o.joined ? '加派' : '接案'}</button></div>`;
  const s = hist[cur], fn = id => s.fac.find(f => f.id === id)?.n || '';
  const sides = o.joined ? [] : o.kind === 'front' || o.kind === 'camp' ? [['att', '替攻方 ' + fn(o.att)], ['def', '替守方 ' + fn(o.def)]] : o.kind === 'outpost' ? [['a', '替 ' + fn(o.a) + ' 守'], ['b', '替 ' + fn(o.b) + ' 搶']] : o.kind === 'tense' ? [['a', '替 ' + fn(o.a)], ['b', '替 ' + fn(o.b)]] : o.kind === 'drill' ? [['1', '難度 1'], ['2', '難度 2'], ['3', '難度 3']] : [];
  const av = GV.roster.filter(c => c.alive && c.status === 'home' && !c.keep);
  return `<div class="picker">${campNote}${sides.length ? `<div class="row">${sides.map(([v, n]) => `<button data-side="${v}" class="${pickOpp.side === v ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>` : ''}
    <div class="mini" style="margin-top:6px">選要派的人（四人一隊，最少兩人${camp ? '；全部派上去也可以' : ''}）：</div>${pickGroups(av)}
    ${vanRow(o, Math.ceil(pickOpp.uids.size / 4))}
    <div class="row"><button class="primary" data-go="1">出發（${pickOpp.uids.size} 人）</button><button data-cancel="1">取消</button></div></div>`;
}
// 運兵車（Alan 2026-10-12，取代快車／行軍）：一台車載一隊四個人、油錢每格 $0.6k；基地在現場（旁邊一格以內、停著）就直接派、不用車、不限隊數。大戰役、勢力戰要基地到場
const vanFree = () => GV?.vans ? GV.vans.cap - GV.vans.used : 0;
function vanBlock(o, nsq) {
  if (o.here) return '';
  if (o.kind === 'camp' || o.kind === 'front') return `${o.kind === 'camp' ? '大戰役' : '勢力戰'}要把基地開過去（停在旁邊一格以內）才能接`;
  if (nsq > 1) return '一台運兵車只能載一隊；要派更多隊，把基地開過去';
  if (vanFree() < 1) return '運兵車都派出去了（等車回來，或把基地開過去直接派）';
  return '';
}
function vanRow(o, nsq) {
  const p = selPath && selPath.to === o.tile && selPath.hours >= 0 ? selPath : null, why = vanBlock(o, nsq);
  const info = o.here ? '<b>基地在現場</b>：直接派，不用運兵車、不限隊數' : `坐運兵車：剩 <b>${Math.max(0, vanFree())}</b>／${GV.vans?.cap ?? 2} 台${p ? `・單程 ${fmtLeft(p.hours)}・去程油錢 $${p.fare}k（回程另計）` : '・油錢每格 $0.6k（回程另計）'}`;
  return `<div class="mini" style="margin:6px 0">${info}・集合點：${esc(GV.hq?.place || GV.baseName)}（基地現在的位置；回來時基地不在，只能在那裡等 48 小時）</div>${why ? `<div class="mini" style="color:var(--war)">${esc(why)}</div>` : ''}`;
}
// 開了公司之後，機會就是伺服器上的委託板（跟著伺服器時間：公開三天，截止前一天不能再接；Alan 2026-10-09）；沒開公司時是沙盒的機會
// 清運也列進機會（Alan 2026-10-10）：不用派人，按了就出車；自己人倒下的地方程度最高
const cleanOpps = () => (GV?.cleanSites || []).filter(c => c.ok).map(c => ({kind: 'clean', tile: c.tile, lv: c.fallen ? 3 : c.daily || c.waste >= 20 ? 2 : 1, title: c.daily ? `${c.name}（總部）的每日清運` : `清運${c.name}`,
  detail: `${c.fallen ? '有自己人倒在這裡・' : ''}${c.daily ? '免費，附四種素材各 30' : `廢棄物 ${c.waste}・${c.dist} 格・車資 $${c.fare}k`}・約 ${c.hours} 小時`, clean: true}));
// 長期護衛合約（Alan 2026-10-10）：名氣、規模夠了才看得到
const retOpps = () => (GV?.retainer?.offers || []).map(r => ({kind: 'retainer', tile: r.site, lv: 3, title: `${r.name}${r.kn}的長期護衛`, ret: r,
  detail: `${r.fac}・${r.seasons} 季・簽約金 $${r.plan === 'lump' ? r.fee + 'k 一次給' : Math.round(r.total / r.seasons) + 'k × ' + r.seasons + ' 季'}${r.bond ? `・履約保證金 $${r.bond}k` : ''}・季末獎金 $${r.bonus}k・剩 ${r.left} 個名額`}));
const curOpps = (s = hist[cur]) => GM?.board ? [...GM.board, ...cleanOpps(), ...retOpps()] : s?.opps || [];
function renderOpp() {
  const s = hist[cur], O = curOpps(s).slice().sort((a, b) => (b.joined || b.busy ? 1 : 0) - (a.joined || a.busy ? 1 : 0) || b.lv - a.lv || a.kind.localeCompare(b.kind));
  const cnt = k => O.filter(o => (k === 'all' || o.kind === k) && o.lv >= 2).length;
  let html = `<div class="opphead"><p class="muted" style="margin:0">${GM?.board ? '星球上公開的委託：每個公開三天，截止前一天不能再接；大家接同一個委託就在同一個案件裡搶積分。' : '如果玩家此刻進場，沙盒會給出的事。'}外圈越粗越亮，程度越高（●●● 最高）。</p></div><div class="filters">` +
    [['all', '全部'], ...Object.entries(OK).map(([k, v]) => [k, v.n])].map(([k, n]) => `<button data-ok="${k}" class="${oppKind === k ? 'on' : ''}">${n} <span class="muted">${cnt(k)}</span></button>`).join('') + '</div>';
  const list = O.filter(o => oppKind === 'all' || o.kind === oppKind);
  html += '<ol class="log opp">' + list.map(o => { const K = OK[o.kind]; return `<li data-tile="${o.tile}" style="border-left-color:${K.c}"><span class="lv" style="color:${K.c}">${'●'.repeat(o.lv)}${'○'.repeat(3 - o.lv)}</span> <b style="color:${K.c}">${K.n}</b>　${esc(o.title)}${ownWarn(o)}<span class="yr" style="font-family:inherit;font-size:12px;color:var(--muted)">${esc(o.detail)}${o.risk ? `・風險 ${'▲'.repeat(o.risk)}` : ''}</span>${o.closeAt != null ? `<span class="due">${o.joined ? `已接・${cd(o.end)}後結束` : o.busy ? '這裡已經接了別的委託' : `${cd(o.closeAt)}後截止`}${o.n ? `・${o.n} 家公司在打` : ''}</span>` : ''}${o.joined && o.kind !== 'camp' ? '' : accPicker(o)}</li>`; }).join('') + '</ol>';
  $('pane-opp').html = html || '';
}
$('pane-opp').onclick = e => {
  const a = e.target.closest('[data-acc],[data-side],[data-pk],[data-go],[data-cancel],[data-clean],[data-ret]');
  if (a?.dataset.clean) { send({type: 'clean', tile: +a.dataset.clean}); return; }
  if (a?.dataset.ret) { const r = (GV?.retainer?.offers || []).find(x => x.id === a.dataset.ret); if (r && confirm(`簽下${r.name}${r.kn}的長期護衛約？\n\n期限 ${r.seasons} 季。產地發車隊時要在 5 小時內派人；沒派就從駐在那裡的小隊隨機拉一隊，連駐軍都沒有就是違約。\n違約第一次賠簽約金的四分之一${r.bond ? '、保證金沒收' : ''}；第二次合約作廢、那個勢力一年不跟你往來。`)) send({type: 'sign', id: r.id}); return; }
  if (a) {
    if (a.dataset.acc) { const o = curOpps().find(x => x.kind + ':' + x.tile === a.dataset.acc); if (o) openSortie(o); return; }
    else if (a.dataset.side) pickOpp.side = a.dataset.side;
    else if (a.dataset.pk) { const u = +a.dataset.pk; pickOpp.uids.has(u) ? pickOpp.uids.delete(u) : pickOpp.uids.add(u); }
    else if (a.dataset.go) { const [kind, tile] = pickOpp.key.split(':'); send({type: 'accept', kind, tile: +tile, side: pickOpp.side, uids: [...pickOpp.uids]}); pickOpp = null; }
    else pickOpp = null;
    renderOpp(); return;
  }
  if (e.target.closest('[data-wide]')) { document.body.classList.toggle('panelwide'); renderOpp(); requestAnimationFrame(() => { fit?.(); draw(); }); return; }   // Alan 2026-10-09：機會的面板可以放大
  const b = e.target.closest('button[data-ok]'); if (b) { oppKind = b.dataset.ok; renderOpp(); draw(); return; } const li = e.target.closest('li[data-tile]'); if (li) select(+li.dataset.tile, true, true); };
function renderPanel() { if (!hist.length) return; const t = curTab(); if (t === 'opp') renderOpp(); else if (t === 'log') renderLog(); else if (t === 'fac') renderFac(); else if (t === 'tile') renderTile(); }
function select(i, center, keep) { sel = i; if (GV && worker) { if (!selPath || selPath.to !== i) selPath = null; send({type: 'path', to: i}); } if (center) centerOn(i); if (!keep) tab('tile'); draw(); }

function renderHeader() {
  const s = hist[cur], a = s.arc; $('yearNum').textContent = `第 ${s.y} 年`; $('slider').value = cur;
  $('phase').textContent = !a.ackY || s.y < a.ackY ? `等待接駁船（第 ${a.ackY || '?'} 年承認）` : a.fallY == null || s.y < a.fallY ? '承認：企業不會回來了' : !a.blocY || s.y < a.blocY ? '崩塌之後，各自為王' : '陣營對峙';
}
let lastPanelY = -1;
function renderAll() { renderHeader(); draw(); if (hist[cur].y !== lastPanelY || curTab() !== 'log') { lastPanelY = hist[cur].y; renderPanel(); } if (hover >= 0) showTip(mouse.x, mouse.y); }

/* ───────── 公司 ───────── */
// 黑單的目標是自己簽長約的產地（Alan 2026-10-11：縱火燒到自己的長約產地）：標紅提醒
const ownWarn = o => (o.kind === 'shadow') && (GV?.retainer?.mine || []).some(c => c.endedAt == null && c.site === o.tile) ? ' <b style="color:var(--war)">⚠ 目標是你簽長約的產地</b>' : '';
let settling = null;   // 剛打完、伺服器還在結算的那一場（任務票編號，2026-10-14）
let GV = null, GM = null, coBuilt = false, pickOpp = null, pickRe = null, rosterF = 'home', toastT = null;
const recipe = {food: 30, water: 30, implant: 30, neural: 30};
const send = m => worker.postMessage(m);
const img = p => `portraits/${p}.png`;
// 每位資料主人的專屬圖（Alan 2026-10-10）：public/donors/<原主>/portrait.png（頭像）、full.png（立繪）、sprite.png（戰場）。
// 部署時的素材清單（asset-manifest.json）列得到就用，沒有就照舊（頭像用 portraits/、立繪用 art/full/、都沒有就放大頭像）
let ART = new Set();
fetch('asset-manifest.json', {cache: 'no-cache'}).then(r => r.ok ? r.json() : null).then(d => { if (!d) return; ART = new Set(d.items.map(x => x.path)); if (GV) { try { renderPage(); renderRoster(); } catch {} } }).catch(() => {});
const donorKey = c => c.donor ?? c.portrait;
const face = c => ART.has(`donors/${artKey(c)}/portrait.png`) ? `donors/${artKey(c)}/portrait.png` : img(c.portrait);   // 換裝：圖照穿的那套找（artKey）
// 主選單的站姿立繪：去背的 stand.png（chimera/scripts/stand-cutout.py），沒有就用一般的立繪
const standArt = c => ART.has(`donors/${artKey(c)}/stand.png`) ? `donors/${artKey(c)}/stand.png` : fullArt(c);
const fullArt = c => ART.has(`donors/${artKey(c)}/full.png`) ? `donors/${artKey(c)}/full.png` : `art/full/${c.portrait}.png`;
const who = c => c.name || CLS[c.cls].n;   // 原主的名字（Alan 2026-10-10）；舊資料沒有就顯示職業
// 綽號（call sign，Alan 2026-10-10）：有綽號就優先顯示。完整：瑟琳 “人獵人” X-0910；簡短：瑟琳 “人獵人”；最短：“人獵人”
const csq = c => c.callsign ? `“${esc(c.callsign)}”` : '';
const nameFull = c => `${esc(who(c))}${c.callsign ? ' ' + csq(c) : ''} ${c.id}`;
const nameShort = c => c.callsign ? `${esc(who(c))} ${csq(c)}` : `${esc(who(c))} ${c.id}`;
const nameMin = c => c.callsign ? csq(c) : esc(who(c));
const CROWN_N = {gold: '金冠', silver: '銀冠', tin: '錫冠', lead: '鉛冠'};   // 錫冠後 10%、鉛冠後 1%（Alan 2026-10-11）
const pctText = c => c.pct >= .5 ? `前 ${Math.max(1, Math.round((1 - c.pct) * 100))}%` : `後 ${Math.max(1, Math.round(c.pct * 100))}%`;
const crownTag = c => c.keeper ? '<span class="crown keeper">守密者</span>' : c.ration ? '<span class="crown ration">配給</span>' : CROWN_N[c.crown] ? `<span class="crown ${c.crown}">${CROWN_N[c.crown]}</span>` : c.template ? '<span class="crown tpl">模板</span>' : '';   // 守密者伊歐、最低編制的配給型（2026-10-14）
const chip = (c, on, key) => `<span class="chip${on ? ' on' : ''}${c.alive ? '' : ' dead'}${key ? '' : ' static'}"${key && c.alive ? ` data-${key}="${c.uid}"` : ''}><img src="${face(c)}" alt="">${nameShort(c)}</span>`;   // 金冠、銀冠只在詳細資料裡顯示（Alan 2026-10-09）
const fmtH = x => x <= 0 ? '0 小時' : x < 48 ? `${Math.round(x)} 小時` : `${Math.floor(x / 24)} 天 ${Math.round(x % 24)} 小時`;
// 倒數在本機跑（每秒更新；到點之後的結果仍以伺服器為準，伺服器結算完下一次拉資料才會出現）。單人測試模式的時鐘是加速的，照舊只顯示小時
const hourNow = () => !LOCAL && worker?.hourNow ? worker.hourNow() : null;
function fmtLeft(x) {
  if (x <= 0) return '片刻';   // 到點了，等伺服器結算
  const s = Math.ceil(x * 3600), H = Math.floor(s / 3600), M = Math.floor(s % 3600 / 60), S = s % 60;
  return H >= 48 ? `${Math.floor(H / 24)} 天 ${H % 24} 小時` : H ? `${H} 小時 ${M} 分` : `${M} 分 ${String(S).padStart(2, '0')} 秒`;
}
// 到第 at 個遊戲小時還有多久
const cd = at => { const now = hourNow(); return now == null ? fmtH(at - GV.h) : `<span class="cd" data-at="${at}">${fmtLeft(at - now)}</span>`; };
// 沙盒一季一季結算（Alan 2026-10-09：兩週結算）：顯示現在是哪一年第幾季、這一季的第幾天、還有幾天結算
function clockText(x, m) {
  const H = Math.floor(x), mm = Math.floor((x - H) * 60), q = m.season || 0, sh = Math.max(1, Math.round(24 * m.yearDays / 4)), day = Math.floor((H % sh) / 24) + 1, left = Math.ceil((sh - H % sh) / 24);
  return `第 ${q ? m.year : m.year + 1} 年・第 ${q + 1} 季第 ${day} 天 ${String(H % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}・${left} 天後結算`;
}
const asked = new Set();   // 已經為了哪些到點的倒數問過伺服器
setInterval(() => {
  const now = hourNow(); if (now == null || !GV) return;
  $('gclock').textContent = clockText(Math.max(GV.h, now), GM);
  for (const el of document.querySelectorAll('.cd[data-at]')) {
    const at = +el.dataset.at; el.textContent = fmtLeft(at - now);
    // 倒數到了：問伺服器一次（伺服器用自己的時鐘確認，例如培養槽準時出槽；Alan 2026-10-09）
    if (at <= now && !asked.has(at)) { asked.add(at); setTimeout(() => worker?.poll?.(), 600); }
  }
}, 1000);
// el.html = ...：內容（倒數的數字不算）和上次一樣就不重畫。整塊 innerHTML 重設會讓頭像重新載入、閃一下（Alan 2026-10-09 回報）
// 重畫時圖不閃（Alan 2026-10-14 回報：頭像、立繪隔一陣子閃一下）：每次伺服器送來新的畫面資料，整塊 HTML 重建、<img> 也跟著重建，
// 瀏覽器要重新解碼那一格就空白一下。換內容時，src 一樣的圖沿用原本的那個元素（屬性照新的改）
const keepImgs = (el, v) => {
  const t = document.createElement('template'); t.innerHTML = v; const old = new Map();
  for (const im of el.querySelectorAll('img')) { const k = im.getAttribute('src'); if (!old.has(k)) old.set(k, []); old.get(k).push(im); }
  if (old.size) for (const im of t.content.querySelectorAll('img')) { const o = old.get(im.getAttribute('src'))?.shift(); if (!o) continue;
    for (const at of [...o.attributes]) if (!im.hasAttribute(at.name)) o.removeAttribute(at.name);
    for (const at of im.attributes) if (o.getAttribute(at.name) !== at.value) o.setAttribute(at.name, at.value);
    im.replaceWith(o); }
  el.replaceChildren(t.content);
};
Object.defineProperty(HTMLElement.prototype, 'html', {configurable: true, set(v) { const k = String(v).replace(/(<span class="cd"[^>]*>)[^<]*/g, '$1'); if (this._k === k && this.childNodes.length) return; this._k = k; keepImgs(this, v); }});
const STATUS = {home: '待命', away: '出勤', op: '行動中', returning: '歸途', regen: '在培養槽休養', kia: '已除名', recovered: '遺體已收回', lost: '遺體沒能帶回', sold: '已除名'};   // 陣亡、遺體賣掉都算除名（Alan 2026-10-10）
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3200); }
function found(base) { if (WATCH) return; send({type: 'found', base}); }
// 簽核狀態（Alan 2026-10-14：讓玩家知道伺服器現在怎麼了）：畫面上方一顆小標籤。
// 打的時候伺服器驗證輸入（超過一下子才出現，免得每一步都閃）；打完到伺服器結算完（settling）一直轉；收齊或結算完出「已審核」，兩秒半後收起
const syncEl = Object.assign(document.createElement('div'), {id: 'sync-chip', hidden: true}); document.body.appendChild(syncEl);
let syncT = null, syncShown = false;
// 戰鬥中（Alan 2026-10-14）：只在右上角轉一個小圈，同步到最新就消失；打完還在跑、會卡住後面的操作時（settling）才出完整的標籤
let dotT = null;
const syncDot = Object.assign(document.createElement('div'), {id: 'sync-dot', hidden: true, title: '伺服器同步中'}); document.body.appendChild(syncDot);
function syncChip(state, n = 0) {
  if (!settling && state !== 'done') { syncEl.hidden = true; syncShown = false; clearTimeout(syncT); clearTimeout(dotT); syncDot.classList.toggle('retry', state === 'retry');
    if (state === 'ok') syncDot.hidden = true; else if (syncDot.hidden) dotT = setTimeout(() => { syncDot.hidden = false; }, 250); return; }   // 很快就同步好的那一步不出現
  syncDot.hidden = true; clearTimeout(dotT);
  clearTimeout(syncT);
  if (state === 'done' && !syncShown) { syncEl.hidden = true; return; }   // 打完很快就結算好了：什麼都不用出
  if (state === 'busy' || state === 'retry') {
    const show = () => { syncShown = true; syncEl.className = state; syncEl.innerHTML = state === 'retry' ? '<i class="spin"></i>連線不穩，重送中…' : `<i class="spin"></i>服務單簽核中…${n > 1 ? `<small>${n} 筆</small>` : ''}`; syncEl.hidden = false; };
    if (syncShown || state === 'retry' || settling) show(); else syncT = setTimeout(show, 500);
    return;
  }
  if (state === 'ok' && (settling || !syncShown)) { if (!syncShown) syncEl.hidden = true; return; }   // 戰鬥打完還在等結算：伺服器收齊輸入不算完，等畫面資料確定結算了才算
  if (!syncShown && state !== 'done') { syncEl.hidden = true; return; }
  syncEl.className = 'ok'; syncEl.innerHTML = '✓ 已審核'; syncEl.hidden = false; syncShown = false;
  syncT = setTimeout(() => { syncEl.hidden = true; }, 2500);
}
// 打完的那一場結算了沒：行動的那一點清掉了、服務單不在待打清單裡
const settled = () => !(GV?.ops?.cur?.fight?.ticket === settling || (GV?.tickets || []).some(t => t.id === settling));
function onGame(m) {
  const first = !GV; GV = m.data; GM = m;
  if (settling && settled()) { settling = null; syncChip('done'); }
  if (m.campaigns?.some(c => !c.done) || $('campbar') && !$('campbar').hidden) draw();   // 大戰役每 6 小時變一次
  if (m.err && roverToast == null && roverAct == null) toast(m.err);
  if (roverToast != null) { roverToastCheck(m.err); roverSeen = rvKey(GV?.hq?.log?.[0]); } else roverNews(m.err);
  if (first) { setPlaying(false); cur = hist.length - 1; computing = false; $('computing').hidden = true; $('more').hidden = true; document.body.classList.add('game'); $('gamebar').hidden = false; $('mailBtn').hidden = false; $('gyd').value = m.yearDays; for (const b of document.querySelectorAll('.pager [data-page="home"],.pager [data-page="ops"]')) b.hidden = false; showPage('home'); renderAll(); send({type: 'quotes'}); }
  $('gclock').textContent = clockText(Math.max(GV.h, hourNow() ?? GV.h), m);
  $('gsub').textContent = `${GV.name}・基地 ${GV.hq?.place || GV.baseName}${GV.hq && !GV.hq.parked ? '（開動中）' : ''}・運兵車 ${GV.vans ? `${Math.max(0, GV.vans.cap - GV.vans.used)}／${GV.vans.cap}` : ''}`;
  $('gcash').textContent = `$${GV.cash}k`; $('gcash').classList.toggle('neg', GV.cash < 0);
  $('gmats').html = MATS.map(m => `<span>${MN[m]} <b>${GV.mats[m]}</b></span>`).join('');   // 玩家的資源都在頂端（Alan 2026-10-09）
  maybeReveal(); maybeReport(); renderPage(); renderSortie(); if (page === 'map') { if (curTab() === 'tile' && sel >= 0) renderTile(); else if (curTab() === 'opp') renderOpp(); }
  renderMail();
  draw();
}
$('gspeed').onchange = e => send({type: 'speed', v: +e.target.value});
// 單機（Alan 2026-10-18）：伺服器回報速度、為什麼停（服務單、基地到站、離開太久、正在打）
const SOLO_WHY = {ticket: '有服務單要處理，時間暫停', arrive: '基地到站，時間暫停', away: '離開太久，時間暫停'};
// 三段速度輪流切（Alan 2026-10-18）：普通＝照現實（一個遊戲小時＝現實一小時）、加速 1＝每秒一小時、加速 2＝每秒六小時；另外一顆暫停
const SOLO_SP = [[1 / 3600, '普通'], [1, '加速 1'], [6, '加速 2']];
let soloLast = SOLO_SP[0][0], soloNow = 0;
const spIdx = v => SOLO_SP.findIndex(([x]) => Math.abs(x - v) < 1e-9);
function onSolo(s) {
  document.body.classList.add('solo'); soloNow = s.speed; if (s.speed) soloLast = s.speed;
  const i = Math.max(0, spIdx(soloLast)), lock = !!s.fighting;
  $('gCycle').textContent = SOLO_SP[i][1]; $('gCycle').title = `切換速度（現在：${SOLO_SP[i][1]}${i === 0 ? '，照現實時間' : i === 1 ? '，每秒一小時' : '，每秒六小時'}）`;
  $('gPause').textContent = s.speed ? '⏸' : '▶'; $('gPause').classList.toggle('on', !s.speed);
  for (const b of [$('gPause'), $('gCycle')]) b.disabled = lock;
  if (lock) $('gPause').title = '親自打的時候時間停住'; else $('gPause').title = s.speed ? '暫停' : '繼續';
  if (!s.speed && s.pause && SOLO_WHY[s.pause]) toast(SOLO_WHY[s.pause]);
}
$('gPause').onclick = () => send({type: 'speed', v: soloNow ? 0 : soloLast});
$('gCycle').onclick = () => { const i = spIdx(soloLast), next = SOLO_SP[(i + 1) % SOLO_SP.length][0]; soloLast = next; send({type: 'speed', v: next}); };   // 切速度也順便繼續
$('gyd').onchange = e => send({type: 'yearDays', v: +e.target.value});

// ===== 行動（Alan 2026-10-13，chimera/ops.js）：隨時能打的副本——路線圖、每點一場、局內三選一、王點 =====
function renderOps() {
  const O = GV?.ops, el = $('ops-box'); if (!O || !el) return;
  const cur = O.cur, D = cur && O.defs.find(d => d.id === cur.def), h = GV.h, who2 = u => GV.roster.find(c => c.uid === u);
  const costTxt = d => Object.entries(d.cost).map(([m, n]) => `${MN[m]} ${n}`).join('・');
  // 說明文字 Alan 2026-10-14 說平常不要顯示，留在註解裡：
  //   標題旁：「隨時能打：一張路線圖，每一點一場，最後是王點。倒下是真的死，但遺體全數收回。前一組打贏了，後面的才能打。」
  let html = `<h3 class="sec">行動</h3>`;
  if (!cur) {
    // 行動的清單（Alan 2026-10-14：多幾組，照順序解鎖）；挑人用出擊編成（跟接案一樣的卡片）
    // 常駐和活動（Alan 2026-10-14）：暫時上下分開、加標籤，之後介面再區分
    const card = d => { const lock = !d.open, req = d.req && O.defs.find(x => x.id === d.req), ev = d.kind === 'event', st = d.kind === 'story';
      return `<div class="opcard${lock ? ' lock' : ''}${d.cleared ? ' cleared' : ''}"><div class="opct"><span class="optag ${st ? 'story' : ev ? 'ev' : 'main'}">${st ? '主線' : ev ? '活動' : '常駐'}</span><b>${esc(d.title)}</b>${d.cleared ? `<span class="tagok">完成 ${d.cleared} 次</span>` : ''}</div><div class="mini">${esc(d.text)}</div>
        <div class="mini muted">代價：${d.free ? '<b>免費（最低編制，不給現金、不掉模板）</b>' : Object.keys(d.cost).length ? costTxt(d) : '免費'}・${d.paid ? `再打 $${d.again}k` : `首通 $${d.cash}k＋模板`}・${d.nodes.length} 個點${ev && d.to != null ? `・${cd(d.to)}後結束` : ''}</div>
        <div class="row">${lock ? `<span class="mini">🔒 要先完成「${esc(req?.title || '')}」</span>` : ev && !d.live ? '<span class="mini">現在沒有開放</span>' : `<button class="primary" data-opsel="${d.id}"${!d.free && Object.entries(d.cost).some(([m, n]) => GV.mats[m] < n) ? ' disabled title="素材不夠"' : ''}>出發</button>`}</div></div>`; };
    const story = O.defs.filter(d => d.kind === 'story'), main = O.defs.filter(d => d.kind === 'main'), evs = O.defs.filter(d => d.kind === 'event');
    html += `${story.length ? `<h4 class="sec2">主線</h4><div class="oplist">${story.map(card).join('')}</div>` : ''}<h4 class="sec2">常駐行動</h4><div class="oplist">${main.map(card).join('')}</div>
      <h4 class="sec2">活動行動</h4>${evs.length ? `<div class="oplist">${evs.map(card).join('')}</div>` : '<p class="mini muted">目前沒有活動。</p>'}`;
    // 清單下面的說明（2026-10-14 起不顯示）：「一次一組；派一到四個人。沒有疲勞，付得出素材就能一直打；但報酬打不平素材，
    //   主要是練等級（每打贏一點每人 2 片記憶片段，王點 6 片）和撈模板（首通必掉，之後打下王點 ${Math.round(O.tplP * 100)}%）。」
  } else {
    html += `<div class="optitle"><b>${esc(D.title)}</b>　<span class="mini muted">${esc(D.text)}</span></div>`;
    const next = new Set(cur.next), fightNode = cur.fight?.node, byId = Object.fromEntries(D.nodes.map(n => [n.id, n]));
    const legs = D.nodes.flatMap(n => n.next.map(t => [n, byId[t]])).filter(([, t]) => t);
    html += `<div class="opmap" data-def="${cur.def}"><canvas id="opcv"></canvas><svg class="oplegs" viewBox="0 0 100 100" preserveAspectRatio="none">${legs.map(([f, t]) => { const walked = cur.done.includes(f.id) && (cur.done.includes(t.id) || fightNode === t.id), live = (cur.at === f.id || !cur.at && f.layer === 1 && false) && next.has(t.id);
      return `<line x1="${f.x * 100}" y1="${f.y * 100}" x2="${t.x * 100}" y2="${t.y * 100}" class="${walked ? 'walked' : cur.at === f.id ? 'live' : ''}"/>`; }).join('')}</svg>${D.nodes.map(n => {
      const done = cur.done.includes(n.id), here = cur.at === n.id, open = next.has(n.id) && !cur.fight, fighting = fightNode === n.id;
      const cls = done ? 'done' : fighting ? 'fight' : open ? 'open' : 'lock';
      return `<button class="opnode ${cls}${n.boss ? ' boss' : ''}${here ? ' here' : ''} t-${n.type}" style="left:${n.x * 100}%;top:${n.y * 100}%"${open ? ` data-opgo="${n.id}"` : fighting ? ` data-opfight="${esc(cur.fight.ticket)}"` : ' disabled'} title="${esc(n.text)}"><i class="dot">${n.boss ? '★' : n.type === 'rest' ? '✚' : done ? '✓' : '●'}</i><b>${esc(n.kind)}</b><span>${esc(n.name)}</span>${open ? '<em>前往</em>' : fighting ? '<em>繼續打</em>' : ''}</button>`;
    }).join('')}<div class="opmapname">作戰區域　${esc(D.title.replace(/^試玩行動：/, ''))}</div></div>`;
    // 局內的三選一（Alan 2026-10-14：在路線圖上選）：每打贏一點，每人多一次
    const DR = Object.entries(cur.drafts || {});
    if (DR.length) html += `<div class="opdraft"><h4 class="sec2">局內強化 <span class="muted">每打贏一點每人選一個，只在這次行動有效</span></h4>${DR.map(([u, d]) => { const c = who2(+u); return `<div class="row draftrow"><span class="mini who">${c ? `${esc(who(c))} ${c.id}・${CLS[c.cls].n}` : u}${d.left > 1 ? `（還有 ${d.left} 次）` : ''}</span>${d.ids.map(id => `<button class="perk" data-oppk="${u}" data-id="${id}"><b>${esc(O.perks[id]?.n || id)}</b><span>${esc(O.perks[id]?.text || '')}</span></button>`).join('')}</div>`; }).join('')}</div>`;
    html += `      <div class="mini">隊伍：${cur.uids.map(u => { const c = who2(u), k = cur.carry[u]; return c ? `${esc(who(c))} ${c.id}${!c.alive ? '（倒下）' : k?.hp != null ? `（生命 ${k.hp}${k.maxHp ? '／' + k.maxHp : ''}・局內強化 ${(cur.picks[u] || []).length}）` : ''}` : ''; }).join('、')}・這次已拿記憶片段 ${cur.cells}</div>
      <div class="row">${cur.fight && cur.fight.ticket === settling ? '<span class="mini"><i class="spin"></i>服務單簽核中——伺服器正在審核剛才那一場，好了這裡會自己更新（超過一分鐘還是這樣，重新整理頁面）</span>' : cur.fight ? `<button class="primary" data-opfight="${esc(cur.fight.ticket)}">繼續這一場</button>` : `<button data-opresupply="1"${GV.cash < cur.resupply.cash || GV.mats.implant < cur.resupply.implant || GV.mats.neural < cur.resupply.neural ? ' disabled' : ''} title="全隊補滿生命和護甲板；同一次行動每用一次價錢加倍">整補（$${cur.resupply.cash}k・${MN.implant} ${cur.resupply.implant}・${MN.neural} ${cur.resupply.neural}）</button>`}<button data-opleave="1"${cur.fight ? ' disabled title="先把這一點打完（戰鬥裡可以撤出）"' : ''}>撤回基地（行動結束）</button></div>`;
  }
  if (!cur) storyAfter(O);
  // 最近幾次的紀錄（2026-10-14 起不顯示）：
  // if (O.log.length) html += `<div class="mini muted" style="margin-top:6px">最近：${O.log.map(x => `第 ${Math.floor(x.h / 24) + 1} 天 ${x.ok ? '成功' : '結束'}（${x.nodes} 點・記憶片段 ${x.cells}）`).join('；')}</div>`;
  el.html = html;
  const mp = el.querySelector('.opmap'); if (mp) drawOpMap(mp);
}
// 休整點的閒聊（Alan 2026-10-14：劇情還沒寫，先挑幾個人隨機說幾句）：story-lines.js 的台詞，story.js 演出
// 主線的劇情（Alan 2026-10-14）：story-lines.js 的 STORY[行動].before／after
function storyScene(d, part) {
  const S = STORY[d.id], L = S?.[part]; if (!L) return Promise.resolve();
  const cast = Object.fromEntries(Object.entries(S.cast || {}).map(([k, c]) => [k, {...c}]));
  return playScene({place: part === 'before' ? d.title : `${d.title}・終`, sub: part === 'before' ? '主線' : '主線・完', reveal: true, cast, lines: L.map(([who, text]) => ({who, text}))});
}
// 打完主線行動（opLog 最新一筆成功、還沒演過）演結束之後的劇情；記在瀏覽器，同一次只演一次
function storyAfter(O) {
  const L = O.log?.[0]; if (!L?.ok || !STORY[L.def]?.after) return;
  const key = `${GV.name}:${L.def}:${L.h}`; let seen = ''; try { seen = localStorage.getItem('chimera.storyAfter') || ''; } catch {}
  if (seen === key) return; try { localStorage.setItem('chimera.storyAfter', key); } catch {}
  const d = O.defs.find(x => x.id === L.def); if (d && GV.h - L.h < 48) storyScene(d, 'after');
}
function restScene(D, n, party) {
  if (!party.length) return;
  const io = party.find(c => c.keeper), pick = a => a[Math.floor(Math.random() * a.length)];
  const rest = party.filter(c => c !== io).sort(() => Math.random() - .5);
  let talk, who;
  if (party.length === 1) { talk = pick(SOLO); who = party; }
  else if (io && Math.random() < .5) { talk = pick(IO); who = [io, ...rest]; }
  else { talk = pick(REST_TALK); who = [...party].sort(() => Math.random() - .5); }
  const roles = ['A', 'B', 'C'].filter(r => talk.some(([k, t]) => k === r || t.includes(`{${r}}`)));
  if (roles.length > who.length) { talk = pick(SOLO); who = [who[0]]; roles.length = 1; roles[0] = 'A'; }
  const nm = c => c.callsign || c.name || c.id, pos = roles.length === 1 ? ['c'] : roles.length === 2 ? ['l', 'r'] : ['l', 'r', 'c'];
  const cast = Object.fromEntries(roles.map((r, i) => [r, {name: nm(who[i]), art: standArt(who[i]), pos: pos[i]}]));
  const fill = t => t.replace(/\{([ABCP])\}/g, (_, k) => k === 'P' ? n.name : cast[k]?.name || '');
  playScene({place: n.name, sub: `${D.title}・${n.kind}`, cast, lines: talk.map(([k, t]) => ({who: k, text: fill(t)}))});
}
function opClick(e) {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  if (b.dataset.oppk) { send({type: 'opPick', uid: +b.dataset.oppk, id: b.dataset.id}); return; }
  if (b.dataset.opsel) { const d = GV.ops.defs.find(x => x.id === b.dataset.opsel); if (!d) return;
    const pick = () => {
    sortie = {key: 'custom', tile: GV.base, side: '', fast: false, sq: [[null, null, null, null]], pick: null, open: new Set(), custom: {kind: 'op', lv: 3, one: true, min: 1, tile: GV.base, title: d.title, detail: `${d.text}　代價：${costTxt2(d)}`, go: uids => send({type: 'opStart', def: d.id, uids})}};
    renderSortie(); };
    if (STORY[d.id]?.before) storyScene(d, 'before').then(pick); else pick();   // 主線：開始之前先演劇情，演完再挑人
    return; }
  if (b.dataset.opgo) { const D = GV.ops.defs.find(d => d.id === GV.ops.cur.def), n = D.nodes.find(x => x.id === b.dataset.opgo); const party = GV.ops.cur.uids.map(u => GV.roster.find(c => c.uid === u)).filter(c => c?.alive);
    send({type: 'opGo', node: n.id}); if (n.type !== 'rest') showMissionLoading(); else restScene(D, n, party); return; }
  if (b.dataset.opfight) { send({type: 'fight', ticket: b.dataset.opfight}); showMissionLoading(); return; }
  if (b.dataset.opresupply) { const c = GV.ops.cur.resupply; if (confirm(`花 $${c.cash}k、${MN.implant} ${c.implant}、${MN.neural} ${c.neural} 整補？\n全隊補滿生命和護甲板。這次行動下一次整補的價錢加倍。`)) send({type: 'opResupply'}); return; }
  if (b.dataset.opleave && confirm('撤回基地？這次行動就結束了（已經拿到的記憶片段不會收回）。')) send({type: 'opLeave'});
}
// 區域地圖（Alan 2026-10-14：路線圖套在一張像真的區域地圖上）：照行動的 id 產生地形——起伏的等高線、一條河、格線與座標、指北、比例尺。
// 地形算一次存起來（同一個行動、同一個大小），每次只重畫上面的東西
const opTerrain = new Map();
function drawOpMap(box) {
  const cv = box.querySelector('canvas'), W = box.clientWidth, H = box.clientHeight; if (!cv || !W || !H) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const plan = GV?.ops?.defs.find(d => d.id === box.dataset.def)?.plan; if (plan) { drawPlan(cv.getContext('2d'), dpr, W, H, plan); return; }   // 第一幕：基地的平面圖
  const key = box.dataset.def + ':' + W + 'x' + H; let T = opTerrain.get(key);
  if (!T) {
    let seed = 7; for (const ch of box.dataset.def) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const hash = (x, y) => { let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0; h = Math.imul(h ^ h >>> 13, 1274126177) >>> 0; return ((h ^ h >>> 16) >>> 0) / 4294967296; };
    const sm = t => t * t * (3 - 2 * t), vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi), a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf; };
    const fbm = (x, y) => { let v = 0, a = .5, f = 1; for (let i = 0; i < 5; i++) { v += a * vn(x * f, y * f); a /= 2; f *= 2; } return v; };
    const w = Math.ceil(W / 2), h = Math.ceil(H / 2), E = new Float32Array(w * h);
    // 河：從左上往右下彎過去（在它附近把地勢壓低）
    const river = t => ({x: t, y: .18 + .55 * t + .12 * Math.sin(t * 7 + seed % 5)});
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = x / w, v = y / h; let e = fbm(u * 4.2, v * 4.2 * H / W) * .9 + .25 * (1 - v) * u;
      const r = river(u); e -= .35 * Math.exp(-((v - r.y) ** 2) / .004); E[y * w + x] = e; }
    const img = new ImageData(w, h), band = e => Math.floor(e * 14);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const e = E[y * w + x], i = (y * w + x) * 4, wet = e < .22;
      const k = Math.max(0, Math.min(1, (e - .2) / .7)); let r = 40 + 52 * k, g = 38 + 42 * k, bl = 30 + 26 * k;
      if (wet) { r = 34; g = 52; bl = 60; }
      const edge = x + 1 < w && band(E[y * w + x + 1]) !== band(e) || y + 1 < h && band(E[(y + 1) * w + x]) !== band(e);
      if (edge && !wet) { r += 26; g += 22; bl += 14; }
      const n = hash(x, y) * 10 - 5; img.data[i] = r + n; img.data[i + 1] = g + n; img.data[i + 2] = bl + n; img.data[i + 3] = 255; }
    T = document.createElement('canvas'); T.width = w; T.height = h; T.getContext('2d').putImageData(img, 0, 0); opTerrain.set(key, T); if (opTerrain.size > 8) opTerrain.delete(opTerrain.keys().next().value);
  }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(T, 0, 0, W, H);
  // 格線與座標
  g.strokeStyle = 'rgba(230,194,129,.10)'; g.lineWidth = 1; g.fillStyle = 'rgba(230,194,129,.45)'; g.font = '10px monospace';
  for (let i = 1; i < 10; i++) { const x = W * i / 10; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.fillText(String.fromCharCode(64 + i), x + 3, 11); }
  for (let j = 1; j < 6; j++) { const y = H * j / 6; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.fillText(String(j), 3, y - 3); }
  // 指北、比例尺
  const cx = W - 26, cy = 30; g.fillStyle = 'rgba(230,194,129,.7)'; g.beginPath(); g.moveTo(cx, cy - 14); g.lineTo(cx + 6, cy + 6); g.lineTo(cx, cy + 2); g.lineTo(cx - 6, cy + 6); g.closePath(); g.fill(); g.fillText('N', cx - 3, cy + 18);
  g.fillRect(W - 110, H - 16, 40, 3); g.fillStyle = 'rgba(230,194,129,.3)'; g.fillRect(W - 70, H - 16, 40, 3); g.fillStyle = 'rgba(230,194,129,.6)'; g.fillText('0　　1　　2 km', W - 112, H - 22);
  // 外框
  g.strokeStyle = 'rgba(230,194,129,.35)'; g.strokeRect(.5, .5, W - 1, H - 1);
}
// 平面圖（Alan 2026-10-14：第一幕的路線圖是基地的平面圖）：藍圖底、細格線、外殼（Rover 的車身）、房間（走廊淡一點）、房名
function drawPlan(g, dpr, W, H, plan) {
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#0d171c'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(120,190,210,.07)'; g.lineWidth = 1;
  for (let x = 0; x < W; x += 16) { g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, H); g.stroke(); }
  for (let y = 0; y < H; y += 16) { g.beginPath(); g.moveTo(0, y + .5); g.lineTo(W, y + .5); g.stroke(); }
  const px = r => [r.x * W, r.y * H, r.w * W, r.h * H];
  const x0 = Math.min(...plan.map(r => r.x)) * W - 10, y0 = Math.min(...plan.map(r => r.y)) * H - 10, x1 = Math.max(...plan.map(r => r.x + r.w)) * W + 10, y1 = Math.max(...plan.map(r => r.y + r.h)) * H + 10;
  g.strokeStyle = 'rgba(140,210,230,.55)'; g.lineWidth = 2; g.beginPath(); if (g.roundRect) g.roundRect(x0, y0, x1 - x0, y1 - y0, 18); else g.rect(x0, y0, x1 - x0, y1 - y0); g.stroke();
  g.fillStyle = 'rgba(140,210,230,.35)'; for (const fx of [.18, .42, .66, .88]) { const cx = x0 + (x1 - x0) * fx; g.fillRect(cx - 14, y1 + 2, 28, 7); g.fillRect(cx - 14, y0 - 9, 28, 7); }   // 履帶／輪組
  for (const r of plan) { const [x, y, w, h] = px(r);
    g.fillStyle = r.hall ? 'rgba(120,190,210,.06)' : 'rgba(120,190,210,.11)'; g.fillRect(x, y, w, h);
    g.strokeStyle = r.hall ? 'rgba(140,210,230,.25)' : 'rgba(140,210,230,.6)'; g.lineWidth = r.hall ? 1 : 1.5; g.setLineDash(r.hall ? [4, 4] : []); g.strokeRect(x + .5, y + .5, w - 1, h - 1); g.setLineDash([]);
    g.fillStyle = 'rgba(160,220,235,.75)'; g.font = '11px monospace'; g.fillText(r.name, x + 6, y + 14); }
  g.fillStyle = 'rgba(160,220,235,.5)'; g.font = '10px monospace'; g.textAlign = 'right'; g.fillText('ROVER／平面圖　企業財產・未經授權禁止進入', W - 8, H - 8); g.textAlign = 'left';
}
addEventListener('resize', () => { const mp = document.querySelector('#ops-box .opmap'); if (mp) drawOpMap(mp); });
const costTxt2 = d => Object.entries(d.cost).map(([m, n]) => `${MN[m]} ${n}`).join('・') || '免費';
function renderOpsPage() {
  const P = $('pane-ops'); if (!P) return; if (!GV) { P.innerHTML = '<p class="muted">開了公司之後才有行動。</p>'; return; }
  if (!$('ops-box')) { P.innerHTML = '<div class="box" id="ops-box"></div>'; $('ops-box').onclick = opClick; }
  renderOps();
}
// ===== 主選單（Alan 2026-10-14）：最左邊一頁。左邊是封面角色（從名冊挑，記在伺服器），右邊是各個入口 =====
let coverPick = false;
// 封面角色的一句話（照時間換）；之後可以換成原主自己的台詞
const HOME_LINES = [['深夜了。指揮官也該睡一下吧？', 0, 5], ['早。今天的委託板我看過了。', 5, 11], ['午安。外面的風沙又變大了。', 11, 17], ['晚上好。槍我都擦過了。', 17, 24]];
function renderHome() {
  const P = $('pane-home'); if (!P) return; if (!GV) { P.innerHTML = ''; return; }
  const R = GV.roster, c = R.find(x => x.uid === GV.cover) || R.find(x => x.keeper) || R.find(x => x.alive) || R[0], O = GV.ops?.cur, D = O && GV.ops.defs.find(d => d.id === O.def);
  const opLine = O ? `進行中・打下 ${O.done.length} 點${O.fight ? '・有一場沒打完' : ''}${Object.keys(O.drafts || {}).length ? '・有強化沒選' : ''}` : '路線圖・王點';
  const hr = new Date().getHours(), line = GV.relief ? '人手不夠了。我把企業留下的緊急程式打開了——別讓我後悔。' : (HOME_LINES.find(([, a, b]) => hr >= a && hr < b) || HOME_LINES[1])[0];   // 最低編制啟動中：封面角色提醒
  const news = (GM.inbox || [])[0];
  P.html = `<div class="home2">
    <div class="hbg"><span>CHIMERA</span></div>
    ${c ? `<img class="hchar" src="${standArt(c)}" alt="" onerror="this.onerror=null;this.src='${face(c)}';this.classList.add('px')">` : ''}
    <div class="htop"><b>${esc(GV.name)}</b><span>基地 ${esc(GV.hq?.place || GV.baseName)}</span><span>$${GV.cash}k</span>${MATS.map(m => `<span>${MN[m]} ${GV.mats[m]}</span>`).join('')}</div>
    ${c ? `<div class="hsay"><b>${esc(who(c))}${c.callsign ? ' ' + csq(c) : ''}</b><span>${esc(line)}</span></div>
    <div class="hname"><b>${esc(who(c))}</b><span>${CLS[c.cls].n}・${c.lv || 1} 級</span><button data-hcover="1">換封面</button></div>` : ''}
    ${coverPick ? `<div class="roster-pick">${R.filter(x => x.status !== 'sold').map(x => `<button data-hpick="${x.uid}"${x === c ? ' class="on"' : ''}>${esc(who(x))} ${x.id}</button>`).join('')}</div>` : ''}
    <nav class="hmenu">
      <button class="hb big" data-goto="ops"><b>行動</b><span>${opLine}</span></button>
      <button class="hb" data-goto="co"><b>任務管制</b><span>服務單 ${GV.tickets.length}・案件 ${GV.cases.filter(x => !x.settled).length}</span></button>
      <button class="hb" data-goto="map"><b>戰略地圖</b><span>星球、委託</span></button>
      <button class="hb" data-goto="vat"><b>培養槽</b><span>造人、重新培養</span></button>
      <button class="hb" data-goto="store"><b>裝備</b><span>裝備</span></button>
      <button class="hb" data-goto="rover"><b>基地</b><span>運兵車</span></button>
      <button class="hb" data-goto="trade"><b>交易</b><span>素材</span></button>
      <button class="hb" data-goto="rep"><b>報表</b><span>收支</span></button>
    </nav>
    ${news ? `<div class="hnews"><b>通知</b>${esc(String(news.text).slice(0, 80))}${String(news.text).length > 80 ? '…' : ''}</div>` : ''}
  </div>`;
}
if ($('pane-home')) $('pane-home').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.goto) { showPage(b.dataset.goto); return; }
  if (b.dataset.hcover) { coverPick = !coverPick; renderHome(); return; }
  if (b.dataset.hpick) { coverPick = false; GV.cover = +b.dataset.hpick; send({type: 'cover', uid: +b.dataset.hpick}); renderHome(); }
};
function renderCo() {
  const P = $('pane-co');
  if (!GV) {
    if (!hist.length) { P.innerHTML = '<p class="muted">沙盒推演中…</p>'; return; }
    const s = hist[hist.length - 1];
    P.innerHTML = `<div class="box"><h3 class="sec">開一家公司</h3><p class="muted" style="margin:0 0 10px">任何一座主城都可以當總部。選了之後，沙盒會從目前推演到的最後一年（第 ${s.y} 年）開始，改用小時推進：你造複製人、接戰略地圖上的案子、把人派出去、開採購路線買料。服務單目前只能自動結算（戰鬥層還沒接上）。</p><div class="coinit">` +
      s.fac.filter(f => f.cap >= 0).sort((a, b) => b.pop - a.pop).map(f => { const t = s.towns.find(x => x.t === f.cap); return `<div class="frow"><i class="sw" style="background:${f.c}"></i><span class="nm">${esc(ST.names[f.cap])}　<span class="muted">${esc(f.n)}</span></span><button data-found="${f.cap}">開在這裡</button><span class="meta">人口 ${f.pop}・${t?.vat ? `培養槽 ${t.vat}（神經介質便宜）` : '沒有培養槽'}${t?.works ? '・廠區（植入物便宜）' : ''}${s.wars.some(w => w.att === f.id || w.def === f.id) ? '・<span style="color:var(--war)">交戰中</span>' : ''}</span></div>`; }).join('') + '</div></div>';
    coBuilt = false; return;
  }
  if (!coBuilt) {
    P.innerHTML = `<div class="cohead" id="co-head"></div>
      <div class="cocols" id="co-ops">
        <div class="cocol"><div class="box"><h3 class="sec">服務單</h3><div id="co-tk"></div></div></div>
        <div class="cocol"><div class="box"><h3 class="sec">案件與車隊</h3><div id="co-cases"></div></div>
          <div class="box"><h3 class="sec">長約與駐紮 <span class="muted">產地的長期護衛：應召時限 5 小時，沒派就從駐軍拉一隊</span></h3><div id="co-ret"></div></div>
          <div class="box"><h3 class="sec">清運 <span class="muted">不用派人：收生物廢棄物換植入物、神經介質，順便撿回那一帶的遺體</span></h3><div id="co-clean"></div></div></div>
      </div>`;
    coBuilt = true;
  }
  const G = GV, h = G.h;
  const active = G.cases.filter(c => !c.settled), alive = G.roster.filter(c => c.alive);
  $('co-head').html = (G.relief ? `<div class="relief"><b>最低編制啟動中</b>　人手和素材都不夠了：每 12 小時免費出一個配給型（補到能出擊 2 人）、行動一免費、每日清運順便撿回總部附近的自己人。素材補回來就結束。</div>` : '') + `<div><div class="mini">${esc(G.name)}・總部 <a href="#" data-center="${G.base}">${esc(G.baseName)}</a></div></div>
    <div class="kpi">待命<b>${alive.filter(c => c.status === 'home' && !c.keep).length}</b></div><div class="kpi">出勤<b>${alive.filter(c => c.status === 'away' || c.status === 'returning').length}</b></div>
    <div class="kpi">不出擊<b>${alive.filter(c => c.keep).length}</b></div><div class="kpi">已除名<b>${G.roster.filter(c => c.status === 'kia' || c.status === 'sold').length}</b></div>
    <div class="kpi">進行中<b>${active.filter(c => !c.own).length} 案・${active.filter(c => c.own).length} 車隊</b></div><div class="kpi">待打的服務單<b>${G.tickets.length}</b></div>
    <div class="kpi">帳面業務損失<b>$${G.lossBook}k</b></div>`;
  $('co-tk').html = G.tickets.length ? G.tickets.map(t => {
    const left = t.deadline - h, U = Object.entries(t.enemy.units || {}).map(([k, n]) => `${unitName(k)}×${n}`).join('、'), V = t.enemy.veh ? Object.entries(t.enemy.veh).filter(([, n]) => n > 0).map(([k, n]) => `${unitName(k)}×${n}`).join('、') : '';
    return `<div class="card tk${t.transit ? ' transit' : ''}"><h4><a href="#" data-center="${t.tile}">${esc(t.title)}</a><span class="due${left > 12 ? ' ok' : ''}">剩 ${cd(t.deadline)}</span></h4>
      <div class="mini">${esc(t.caseTitle || '')}・${esc(t.squad || '')}・${esc(t.biome)}${t.night ? '・夜間' : ''}${t.trench >= .3 ? `・戰壕 ${t.trench} 級` : ''}</div>
      <div>敵人：<b>${esc(t.enemy.name)}</b>（戰力 ${t.enemy.power}）${U ? '・' + U : ''}${V ? '・' + V : ''}${t.enemy.boss ? t.enemy.boss.weapon ? `・頭目${esc(t.enemy.boss.chief || '')}帶著遺產級「${esc(t.enemy.boss.weapon)}」${t.enemy.boss.defeats ? `（被打倒過 ${t.enemy.boss.defeats} 次）` : ''}` : `・${esc(t.enemy.boss.name || '頭目')}帶隊` : ''}</div>
      ${t.intro ? `<div class="mini" style="font-style:italic;opacity:.85">${esc(t.intro)}</div>` : ''}
      ${t.transit ? '<div class="mini">行軍遇襲，不算案件積分</div>' : `<div class="mini">目標：${t.objectives.map(o => `${esc(o.text)}（${o.pts}）`).join('、')}</div>`}
      ${t.est ? `<div class="mini">小隊戰力 ${t.est.pow}・自動結算勝算約 <span class="odds-est ${t.est.p < .4 ? 'bad' : t.est.p < .75 ? 'mid' : 'good'}">${Math.round(t.est.p * 100)}%</span>・預估陣亡 ${t.est.dead.toFixed(1)} 人</div>` : ''}
      <div class="row"><button data-act="fight" data-id="${t.id}">親自打</button><button data-act="resolve" data-id="${t.id}">現在自動結算</button></div></div>`; }).join('') : '<p class="muted">沒有待處理的服務單。</p>';
  // 案件分三段（Alan 2026-10-10）：進行中的照舊整張卡；人都回來、只等結案撥款的，和已結案的，收成一行，不再列人
  const nowH = hourNow() ?? h, back = c => !c.own && !c.settled && c.squads.length && c.squads.every(sq => sq.headedHome != null && !(sq.backAt > nowH));
  const brief = c => `<div class="mini caseline"><a href="#" data-center="${c.tile}">${esc(c.title)}</a>・${c.settled ? (c.own ? '車隊已回到總部' : `尾款 $${c.payout || 0}k`) : `${cd(c.end + (c.buffer ?? 24))}後結算`}${c.own ? '' : `・積分 ${c.score}`}${c.kind === 'route' ? `・車隊 ${c.convoys - c.lost}/${c.convoys}` : ''}</div>`;
  const waitC = G.cases.filter(back), doneC = G.cases.filter(c => c.settled), liveC = G.cases.filter(c => !c.settled && !back(c));
  const sec = (t, L) => L.length ? `<h4 class="sec2">${t}（${L.length}）</h4>${L.map(brief).join('')}` : '';
  // 清運（Alan 2026-10-10）
  $('co-clean').html = (G.cleanJobs || []).map(j => `<div class="mini caseline">清運車在${esc(j.name)}・約 ${cd(j.done)}後回來</div>`).join('') + (G.cleanSites || []).map(s => `<div class="row caseline"><span class="mini" style="flex:1"><a href="#" data-center="${s.tile}">${esc(s.name)}</a>${s.daily ? '・總部每天一趟（免費，附基本素材）' : `・${s.dist} 格`}${s.fallen ? '・<b>有自己人倒在這裡</b>' : ''}${s.waste ? `・廢棄物 ${s.waste}` : ''}・約 ${s.hours} 小時${s.fare ? `・車資 $${s.fare}k` : ''}</span>${s.ok ? `<button data-act="clean" data-id="${s.tile}">清運</button>` : `<span class="mini muted">${s.next != null ? `${cd(s.next)}後可再跑` : '車在路上'}</span>`}</div>`).join('');
  // 長約與駐紮（Alan 2026-10-10）
  // 已結束的長約（Alan 2026-10-11）：摺起來，一份一行；點開看細節
  const retEnded = L => !L.length ? '' : `<details class="retold"><summary class="mini">已結束的長約（${L.length}）</summary>${L.map(c => `<details class="retrow"><summary class="mini">${esc(c.name)}${c.kn}・${c.void ? '違約作廢' : '期滿'}・違約 ${c.breaches || 0} 次・第 ${Math.floor(c.endedAt / 24) + 1} 天結束</summary>
    <div class="mini muted">${c.plan === 'lump' ? '簽約金一次付清' : `簽約金分期（收了 ${c.paid} 期）`}${c.bond ? `・保證金 $${c.bond}k${c.bondLost ? '（沒收）' : '（退回）'}` : ''}</div></details>`).join('')}</details>`;
  // 駐軍合併顯示（Alan 2026-10-11）：同一個產地分批派去的駐軍併成一塊，照狀態分行列出是誰（點人名看詳細）；內部還是每批一隊，應召時一次派一隊
  const garBlock = c => { if (!c.garrison.length) return '';
    const st = s => s.busy ? '護送中' : s.ready ? '待命' : `${cd(s.readyAt)}後到位`, rows = {};
    for (const s of c.garrison) for (const u of s.uids) { const x = G.roster.find(y => y.uid === u); if (x?.alive) (rows[st(s)] ||= []).push(x); }
    const n = Object.values(rows).reduce((a, L) => a + L.length, 0), free = c.garrison.filter(s => !s.busy).map(s => s.id);
    return `<div class="row caseline"><span class="mini" style="flex:1">${esc(G.name)}・${esc(c.name)}駐軍・共 ${n} 人</span>${free.length ? `<button data-act="ungarall" data-id="${free.join(',')}">全部撤回</button>` : ''}</div>`
      + Object.entries(rows).map(([k, L]) => `<div class="mini caseline">${k}：${L.map(x => `<span class="chip" data-person="${x.uid}"><img src="${face(x)}" alt="">${nameShort(x)}</span>`).join(' ')}</div>`).join(''); };
  const R = G.retainer || {mine: [], fame: 0};
  $('co-ret').html = `<div class="mini muted">名氣 ${R.fame}・世界排行第 ${R.rank ?? '-'}／${R.of ?? '-'} 名（產地只找前 ${R.topN} 名、活著的人 ${R.sizeMin} 個以上的公司；明細在報表）</div>` + (R.mine.length ? R.mine.filter(c => !c.hidden).map(c => `<div class="card"><h4><a href="#" data-center="${c.site}">${esc(c.name)}${c.kn}</a><span class="mini">${c.void ? '<b style="color:var(--war)">已作廢</b>' : c.done ? '<b style="color:var(--war)">已期滿</b>' : `${cd(c.end)}後期滿`}${c.endedAt != null ? ` <button data-act="rethide" data-id="${c.id}">收起</button>` : ''}</span></h4>
    <div class="mini">${c.plan === 'lump' ? '簽約金一次付清' : `簽約金分期（已收 ${c.paid} 期）`}${c.bond ? `・保證金 $${c.bond}k${c.bondLost ? '（已沒收）' : ''}` : ''}${c.breaches ? `・<span style="color:var(--war)">違約 ${c.breaches} 次</span>` : ''}</div>
    ${c.calls.map(q => `<div class="row caseline"><span class="mini" style="flex:1;color:var(--accent)">應召：${esc(q.g)}車隊往${esc(q.to)}・<b>${cd(q.deadline)}</b>內要派人</span>${c.garrison.filter(s => s.ready && !s.busy && s.alive >= 2).map(s => `<button data-act="callgar" data-id="${q.id}" data-sq="${s.id}">派${s.uids.map(u => G.roster.find(x => x.uid === u)).filter(x => x?.alive).map(nameMin).join('、')}</button>`).join('')}<button data-act="callpick" data-id="${q.id}">從總部派人</button></div>`).join('')}
    ${garBlock(c) || (c.void || c.done ? '' : '<div class="mini muted">沒有駐軍：應召時限到了還沒派人就是違約。</div>')}
    ${c.void || c.done ? '' : `<div class="row"><button data-act="garpick" data-id="${c.site}" data-nm="${esc(c.name + c.kn)}">派人駐紮</button></div>`}</div>`).join('') + retEnded(R.mine.filter(c => c.hidden)) : '<p class="mini muted">還沒有長約。名氣排進世界前幾名，產地會在機會裡找你。</p>');
  $('co-cases').html = !G.cases.length ? '<p class="muted">還沒接案。到戰略地圖的「機會」分頁挑一個點，按「接案」。</p>' : (liveC.length ? '' : '<p class="muted">沒有進行中的案件。</p>') + liveC.map(c => {
    const st = c.settled ? (c.own ? '車隊已回到總部' : `已結案${c.payout ? `・尾款 $${c.payout}k` : ''}`) : c.own ? `來回中・約 ${cd(c.end)}後回到總部` : c.open ? (c.kind === 'security' ? `駐守中・${cd(c.end)}後期滿` : `${cd(c.end - (c.freeze ?? 24))}後合約到期`) : `收尾中・${cd(c.end + (c.buffer ?? 24))}後結算`;
    return `<div class="card"><h4><a href="#" data-center="${c.tile}">${esc(c.title)}</a><span class="mini">${c.own ? '採購' : '●'.repeat(c.lv) + '○'.repeat(3 - c.lv)}</span></h4>
      <div class="mini">${st}${c.own ? '' : `・積分 ${c.score}`}${c.alert != null && !c.settled ? `・目標警戒 <b style="color:${c.alert >= 60 ? 'var(--war)' : c.alert >= 30 ? 'var(--accent)' : 'inherit'}">${c.alert >= 60 ? '高' : c.alert >= 30 ? '中' : '低'}</b>` : ''}${c.kind === 'route' ? `・車隊 ${c.convoys - c.lost}/${c.convoys}` : ''}</div>
      ${c.own && !c.squads.length ? '<div class="mini">沒有護衛，路上出事由雇來的車隊守衛自己打。</div>' : ''}
      ${c.squads.map(sq => { const cl = sq.clones.map(u => G.roster.find(x => x.uid === u)).filter(Boolean), al = cl.filter(x => x.alive).length;
        const sts = sq.headedHome != null ? (sq.backAt > (hourNow() ?? h) ? `歸途中・約 ${cd(sq.backAt)}後回到總部` : '已回到總部') : sq.busy ? '服務單處理中' : sq.readyAt > (hourNow() ?? h) ? `ETA ${cd(sq.readyAt)}` : '待命中';
        return `<div style="margin-top:6px"><span class="mini">${c.settled ? '' : sts}${sq.pending.length ? `・補員 ${sq.pending.map(p => `${p.n} 人 ${cd(p.eta)}後到`).join('、')}` : ''}${sq.refused ? '・<span style="color:var(--war)">雇主不准再補人</span>' : ''}</span>
        <div class="chips">${cl.map(x => chip(x, false, 'person')).join('')}</div>
        ${G.packs?.[sq.id] ? `<div class="mini muted">隨隊行李：${G.packs[sq.id].items.map(x => esc(x.name)).join('、') || '空的'}${G.packs[sq.id].lock ? '' : '・點人可以整補'}</div>` : ''}
        ${sq.headedHome != null ? '' : squadActions(sq, c, al)}</div>`; }).join('')}</div>`; }).join('') + sec('人都回來了，等結案撥款', waitC) + sec('已結案', doneC);
}

// ───── 培養槽（Alan 2026-10-09：像艦娘的建造船塢，一座一列；培養中整列蓋上倒數） ─────
const recipes = [];   // 每一座各自的配方（畫面上的輸入，還沒送出）
const vatRecipe = i => recipes[i] ??= {...recipe};
function renderVat() {
  const P = $('pane-vat'); if (!P) return;
  if (!GV) { P.html = '<div class="box"><p class="muted">開了公司之後才有培養槽。</p></div>'; return; }
  if (P.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') { tickVat(); return; }   // 正在打數字，先不重畫
  const G = GV, busy = new Map(G.queue.map(q => [q.slot, q])), fresh = G.fresh != null && G.roster.find(c => c.uid === G.fresh);
  const row = i => {
    const q = busy.get(i), r = vatRecipe(i);
    const short = MATS.filter(m => G.mats[m] < r[m]);
    return `<div class="vat${q ? ' busy' : ''}" data-vat="${i}"><div class="vatno">第 ${i + 1} 座</div>
      <table class="vatform"><tr>${MATS.map(m => `<th>${MN[m]}</th>`).join('')}</tr><tr>${MATS.map(m => `<td data-n="${MN[m]}"><div class="stepper"><button data-rcd="-10" data-m="${m}" data-vat="${i}" aria-label="少 10">−</button><input type="number" min="${GCFG.MIN}" max="${GCFG.MAX}" step="10" value="${r[m]}" data-rc="${m}" data-vat="${i}"${short.includes(m) ? ' class="short"' : ''}><button data-rcd="10" data-m="${m}" data-vat="${i}" aria-label="多 10">＋</button></div></td>`).join('')}</tr></table>
      <div class="vatgo"><button class="primary" data-act="build" data-vat="${i}"${short.length ? ' disabled title="素材不夠"' : ''}>開始培養</button></div>
      ${q ? (q.ready ? `<div class="vatcover ready"><b>培養完成</b><button class="primary" data-act="claim" data-vat="${i}">簽收</button></div>`
        : `<div class="vatcover"><b>${q.revive != null ? `重新培養 ${esc(q.revive)}` : q.tpl ? CLS[q.tpl].n + '模板' : '培養中'}</b><span class="vatcd">${cd(q.done)}</span><div class="vatbar"><i data-s="${q.start}" data-d="${q.done}"></i></div><span class="mini">${q.tpl ? '' : MATS.map(m => `${MN[m]} ${q.recipe?.[m] ?? '?'}`).join('・')}</span></div>`) : ''}
    </div>`;
  };
  P.html = `<div class="vatpage"><div class="cohead"><div class="mini">每座 ${G.buildH} 小時・素材在「交易」補</div></div>
    <div class="vats">${Array.from({length: G.vats}, (_, i) => row(i)).join('')}</div>
    ${G.templates.length ? `<div class="box"><h3 class="sec">模板 <span class="muted">保證拿到這一位，數值固定在約前 20%</span></h3>${G.templates.map(t => `<div class="row"><span class="chip static"><img src="${face(t)}" alt="">${CLS[t.cls].n}</span><span class="mini">${MATS.map(m => `${MN[m]} ${t.recipe[m]}`).join('・')}</span><button data-act="tpl" data-id="${t.id}"${G.queue.length >= G.vats ? ' disabled' : ''}>用模板培養</button></div>`).join('')}</div>` : ''}</div>`;
  tickVat();
}
// 進度條跟著本機時鐘走
function tickVat() { const now = hourNow() ?? GV?.h; if (now == null) return; for (const el of document.querySelectorAll('.vatbar i[data-s]')) { const s = +el.dataset.s, d = +el.dataset.d; el.style.width = Math.max(0, Math.min(100, (now - s) / Math.max(1e-6, d - s) * 100)) + '%'; } }
setInterval(() => { if (page === 'vat') tickVat(); }, 1000);

// ───── 倉庫（Alan 2026-10-09）：所有人身上的裝備與沒在用的庫存。內容先留空，之後人員詳細資料的換裝會帶到這裡 ─────
// 改裝：倉庫裡的槍換一個詞條（Alan 2026-10-09）
let modPick = null;
// 庫存的篩選與排序（Alan 2026-10-12）：種類（槍、近戰、護甲、預備品、遺產級）、槍種／款式、詞條；排序照種類、名稱、價值、詞條。記在這個瀏覽器
let storeF = (() => { try { return {kind: 'all', base: '', affix: '', sort: 'kind', ...JSON.parse(localStorage.getItem('chimera-storeF') || '{}')}; } catch { return {kind: 'all', base: '', affix: '', sort: 'kind'}; } })();
const saveStoreF = () => { try { localStorage.setItem('chimera-storeF', JSON.stringify(storeF)); } catch {} };
const KIND_N = {gun: '槍', melee: '近戰', armor: '護甲', kit: '預備品'};
const baseN = it => ({gun: GUNS, melee: MELEES, armor: ARMORS, kit: KITS}[it.kind]?.[it.base]?.n || it.base);
const affixN = it => !it.affix ? '' : it.kind === 'armor' ? ARMOR_AFFIXES[it.affix]?.n || it.affix : AFFIX_NAMES[it.affix] || it.affix;
const kindOfIt = it => it.legacy ? 'legacy' : it.kind;
function storeFilters(store) {
  const cnt = f => store.filter(f).length, btn = (key, v, label, n) => `<button data-sf="${key}:${v}" class="${storeF[key] === v ? 'on' : ''}">${esc(label)} <span class="muted">${n}</span></button>`;
  const inKind = store.filter(it => storeF.kind === 'all' || kindOfIt(it) === storeF.kind);
  const bases = [...new Set(inKind.map(it => it.kind + ':' + it.base))].map(k => { const it = inKind.find(x => x.kind + ':' + x.base === k); return [k, baseN(it), inKind.filter(x => x.kind + ':' + x.base === k).length]; }).sort((a, b) => a[1].localeCompare(b[1]));
  const affs = [...new Set(inKind.filter(it => it.affix).map(it => it.kind === 'armor' ? 'a:' + it.affix : 'g:' + it.affix))].map(k => { const it = inKind.find(x => (x.kind === 'armor' ? 'a:' : 'g:') + x.affix === k); return [k, affixN(it), inKind.filter(x => x.affix && (x.kind === 'armor' ? 'a:' : 'g:') + x.affix === k).length]; }).sort((a, b) => a[1].localeCompare(b[1]));
  return `<div class="filters">${btn('kind', 'all', '全部', store.length)}${Object.entries(KIND_N).map(([k, n]) => cnt(it => kindOfIt(it) === k) ? btn('kind', k, n, cnt(it => kindOfIt(it) === k)) : '').join('')}${cnt(it => it.legacy) ? btn('kind', 'legacy', '遺產級', cnt(it => it.legacy)) : ''}</div>
    ${bases.length > 1 ? `<div class="filters">${btn('base', '', '全部款式', inKind.length)}${bases.map(([k, n, c]) => btn('base', k, n, c)).join('')}</div>` : ''}
    ${affs.length ? `<div class="filters">${btn('affix', '', '不限詞條', inKind.length)}${btn('affix', '-', '沒有詞條', inKind.filter(it => !it.affix).length)}${affs.map(([k, n, c]) => btn('affix', k, n, c)).join('')}</div>` : ''}
    <div class="filters"><span class="mini muted" style="align-self:center">排序</span>${[['kind', '種類'], ['name', '名稱'], ['value', '價值'], ['affix', '詞條']].map(([v, n]) => `<button data-sf="sort:${v}" class="${storeF.sort === v ? 'on' : ''}">${n}</button>`).join('')}</div>`;
}
function storeList(store) {
  const order = {gun: 0, melee: 1, armor: 2, kit: 3}, by = {
    kind: (a, b) => (a.legacy ? -1 : 0) - (b.legacy ? -1 : 0) || order[a.kind] - order[b.kind] || baseN(a).localeCompare(baseN(b)) || affixN(a).localeCompare(affixN(b)),
    name: (a, b) => a.name.localeCompare(b.name), value: (a, b) => (b.value || 0) - (a.value || 0) || a.name.localeCompare(b.name),
    affix: (a, b) => (a.affix ? 0 : 1) - (b.affix ? 0 : 1) || affixN(a).localeCompare(affixN(b)) || order[a.kind] - order[b.kind]};
  return store.filter(it => (storeF.kind === 'all' || kindOfIt(it) === storeF.kind) && (!storeF.base || it.kind + ':' + it.base === storeF.base)
    && (!storeF.affix || (storeF.affix === '-' ? !it.affix : it.affix && (it.kind === 'armor' ? 'a:' : 'g:') + it.affix === storeF.affix))).sort(by[storeF.sort] || by.kind);
}
const ARMOR_TEXT = {nightvision: '夜視：射擊暗處的目標不扣命中', infrared: '紅外線：看穿煙霧（牆和門還是擋得住）', steady: '壓制抗性：每次被壓制少 1 層', antitox: '抗毒：中毒每回合少 1 點傷害'};   // 照 ASH 的特性說明
function renderStore() {
  const P = $('pane-store'); if (!P) return;
  if (!GV) { P.html = '<div class="box"><p class="muted">開了公司之後才有倉庫。</p></div>'; return; }
  const al = GV.roster.filter(c => c.alive), store = GV.store || [], KN = {gun: '槍', melee: '近戰', armor: '護甲', kit: '預備品'};
  const kit = c => { const get = gearOfC(c); return [get('armor'), get('kit0'), get('kit1')].filter(Boolean).map(itemName).join('、'); };
  P.html = `<div class="cocols"><div class="cocol"><div class="box"><h3 class="sec">身上的裝備 <span class="muted">點人換裝</span></h3>
    <table class="rep"><tr><th>人員</th><th>武器</th><th>護甲、預備品</th></tr>${al.map(c => `<tr><td><span class="chip" data-person="${c.uid}"><img src="${face(c)}" alt="">${nameShort(c)}</span></td><td>${esc(c.weapon || '')}</td><td>${esc(kit(c))}</td></tr>`).join('')}</table></div></div>
    <div class="cocol"><div class="box"><h3 class="sec">庫存 <span class="muted">戰鬥撿到的、換下來的・本地行情 ×${(GV.sellFactor ?? 1).toFixed(2)}</span></h3>
    ${store.length ? storeFilters(store) : ''}${store.length ? `<table class="rep"><tr><th>種類</th><th>名稱</th><th></th></tr>${(L => L.length ? L : [])(storeList(store)).map(it => `<tr><td>${it.legacy ? '遺產級' : KN[it.kind]}</td><td>${esc(it.name)}${it.kind === 'armor' && it.affix ? `<div class="mini muted">${esc(ARMOR_TEXT[it.affix] || '')}</div>` : ''}</td><td class="acts">${it.kind === 'gun' ? `<button data-modpick="${it.id}">改裝</button>` : ''}<button data-sell="${it.id}">${it.value ? `賣 $${it.value}k` : '丟棄'}</button></td></tr>${modPick === it.id ? `<tr><td colspan="3"><div class="gpick">${Object.keys(MOD_AFFIXES).filter(a => !MOD_AFFIXES[a].notOn?.includes(it.base) && a !== it.affix).map(a => `<button data-mod="${it.id}:${a}">${AFFIX_NAMES[a]}</button>`).join('')}<span class="mini">每次 $${modCost(it.base)}k</span><button data-modx="1">取消</button></div></td></tr>` : ''}`).join('') || '<tr><td colspan="3" class="muted">沒有符合的裝備。</td></tr>'}</table>` : '<p class="muted">沒有沒在用的裝備。</p>'}</div></div></div>`;
}
// ───── 交易：素材庫存、在總部買、派車隊去別座城採購（之後賣人也放這裡） ─────
function renderTrade() {
  const P = $('pane-trade'); if (!P) return;
  if (!GV) { P.innerHTML = '<div class="box"><p class="muted">開了公司之後才能交易。</p></div>'; return; }
  if (!$('co-mats')) P.innerHTML = `<div class="cocols"><div class="cocol"><div class="box"><h3 class="sec">素材</h3><div id="co-mats"></div></div></div>
    <div class="cocol"><div class="box"><h3 class="sec">向別座城訂貨 <span class="muted">對方派車隊送到基地現在停的城，路上可能被劫</span></h3><div id="co-proc"></div></div></div></div>
    <div class="box"><h3 class="sec">裝備 <span class="muted">在基地停的那座城的市場買，買了放進倉庫</span></h3><div id="co-shop"></div></div>`;
  const G = GV;
  const shopRow = (kind, T) => Object.keys(T).map(b => { const it = {kind, base: b, ...(kind === 'kit' ? {n: KITS[b].max} : {})}; return `<button data-shop="${kind}:${b}">${esc(itemName(it))}　$${shopPrice(it)}k</button>`; }).join('');
  const away = GV.hq && !GV.hq.inTown ? `<p class="mini" style="color:var(--war)">基地${GV.hq.parked ? '停在荒野' : '在路上'}：停進城裡才能買素材、買賣裝備、下訂單。</p>` : '';
  $('co-shop').html = away + [['槍', 'gun', GUNS], ['近戰', 'melee', MELEES], ['護甲', 'armor', ARMORS], ['預備品', 'kit', KITS]].map(([n, k, T]) => `<div class="shoprow"><b>${n}</b>${shopRow(k, T)}</div>`).join('');
  $('co-mats').html = away + `<table class="mats"><tr><td class="muted">素材</td><td class="muted">庫存</td><td class="muted">本地單價</td><td class="muted">這週還買得到</td><td></td></tr>` + MATS.map(m => { const left = G.stock?.[m];   // 稀有素材（Alan 2026-10-18）：每座城一週只進一點，剩越少越貴
    const qs = left == null ? [100] : [10, 50].filter(q => q <= left);
    return `<tr><td>${MN[m]}</td><td>${G.mats[m]}</td><td>$${G.prices[m]}k</td><td>${left == null ? '<span class="muted">—</span>' : left}</td><td>${qs.map(q => `<button data-act="buy" data-mat="${m}" data-q="${q}">+${q}（$${Math.round(G.prices[m] * q)}k）</button>`).join(' ') || '<span class="muted">賣完了</span>'}</td></tr>`; }).join('') + '</table>';
  renderProc();
}

// ───── 名冊：任務管制、培養槽、交易共用的底部面板（Alan 2026-10-09）。平常收著，點了往上展開；點人看詳細資料 ─────
let drawerOpen = false, personSel = null;
const RF = {home: '待命', away: '出勤', keep: '不出擊', ...Object.fromEntries(Object.entries(TAGS).map(([k, n]) => ['t:' + k, n])), recovered: '遺體', kia: '已除名', all: '全部'};
const inF = (c, f = rosterF) => f === 'all' || (f.startsWith('t:') ? (c.tags || []).includes(f.slice(2)) && (c.alive || c.status === 'recovered') : f === 'keep' ? c.keep && c.alive : f === 'home' ? (c.status === 'home' || c.status === 'regen') && !c.keep : f === 'away' ? c.status === 'away' || c.status === 'returning' : f === 'kia' ? c.status === 'kia' || c.status === 'sold' : f === 'recovered' ? c.status === 'recovered' || c.status === 'lost' : c.status === f);   // 遺體＝收回的＋還沒撿回的；已除名＝陣亡＋賣掉
// 簽收時跳出新人的卡片（Alan 2026-10-09：對標艦隊收藏）：簽收送出後，等伺服器回來、最新的人換了就秀出來
let revealAfter;
// 簽收（Alan 2026-10-10：對標艦隊收藏的建造完成）：全版立繪＋名字、兵種、編號；數值、素質、金冠銀冠依序淡入；下面的對話框打出入伍台詞。
// 演出途中點一下跳到最後，演完再點一下關閉。
// 入伍台詞（Alan 2026-10-12：每位原主各自的台詞，先當 placeholder）：每位三句，照這個複製人的編號挑一句（同一個人每次都說同一句，同一位原主的不同批會不一樣）
const ENLIST = {
  ember: ['管理序列 K 型，凱拉。指令請說清楚——我照做，也會記得是誰下的令。', '凱拉，到職。效率、紀律、結果。其餘的，與我無關。', '我是凱拉。別期待我笑，期待我完成任務就好。'],
  onyx: ['伊薇報到！無人機已經配對好了——有地圖嗎？沒有的話，我來畫。', '我是伊薇。鹽沼、廢墟、沒人去過的地方，我都想先去看一眼。', '伊薇！啊，空拍的時候請不要對著我的無人機開槍，拜託。'],
  silver: ['那、那個……我是莎菈。重的東西交給我就好，真的。', '莎菈……報到。別看我這樣，扛兩個人跑都沒問題的。', '我、我會努力的！擋在前面這種事……我其實不怕。'],
  cedar: ['娜迪亞，到！要送什麼、送去哪？多遠我都跑得到——打架也行！', '嘿，我是娜迪亞！沙暴、匪幫、斷掉的路，都擋不住我啦。', '娜迪亞報到！先說好，遲到從來不是我的錯，是路的錯。'],
  'portrait-05': ['蕾雅。槍會卡彈？車會拋錨？太好了，我最喜歡那種東西。', '我是蕾雅。給我一把扳手和半天，什麼爛東西都能動起來。', '蕾雅，報到！別擔心，炸掉的部分我也修得回來。大部分啦。'],
  'portrait-06': ['米菈。別擔心，我在天上都沒摔過，地上更不會。', '我是米菈。前面交給我，你們跟著我的背影就好。', '米菈，入伍。有什麼要我第一個衝進去的？'],
  'portrait-07': ['……塔莉亞。我會先看見他們。他們不會看見我。', '塔莉亞。話不多，但我看到的，你都會知道。', '我是塔莉亞。風往哪吹、腳印往哪走——我都記得。'],
  'portrait-08': ['艾琳。站我後面。這是唯一的要求。', '我是艾琳。子彈要先過我這關，所以別離我太遠。', '艾琳，就位。你只管往前走，背後交給我。'],
  'portrait-09': ['薇拉。高的地方、窄的地方、沒人敢去的地方——都歸我。', '我是薇拉。爬上去，跳下來，然後敵人就沒了。就這麼簡單。', '薇拉，報到。怕高的人可以留在下面幫我看包包。'],
  'portrait-10': ['諾娃。火燒不到我，煙嗆不倒我。剩下的，我們慢慢來。', '我是諾娃。煉油廠爆炸的那晚我在場，所以這裡嚇不到我。', '諾娃，入伍。給我時間，我能讓任何東西燒得剛剛好。'],
  'portrait-11': ['茵格！車鑰匙給我，油加滿，剩下的路我來搞定。', '我是茵格。最快的路線？我知道三條，有兩條是違法的。', '茵格報到！車隊跟緊我，掉隊的我可不會回頭——開玩笑的，會回頭啦。'],
  'portrait-12': ['菲歐。沙漠會說話，我聽得懂。走吧。', '我是菲歐。水在哪、匪在哪、哪條路會要人命——問我。', '菲歐，到。太陽下山之前，我們得到下一個水源。'],
  'portrait-13': ['瑟琳。不管風沙多大，我都會把人帶回來。一個都不留下。', '我是瑟琳。倒下的人交給我，你們只管繼續打。', '瑟琳，報到。沙暴裡找人是我的本行，戰場也沒差多少。'],
  'portrait-14': ['朵拉～廢墟底下的好東西，我都潛得到喔。先說好，撈到的分我一點？', '我是朵拉！生鏽的、沉掉的、被埋起來的，我都喜歡。', '朵拉報到～別緊張，我只是看起來很不正經而已。'],
  'portrait-15': ['雅絲……毒氣、輻射、腐蝕液。嗯，都習慣了。可以開始了嗎。', '我是雅絲。危險的地方我先進去，你們等我說安全再進來。', '雅絲。防毒面具借你一個？不用的話，就站遠一點。'],
  'portrait-16': ['露恩。夜班交給我吧。天亮之前，誰也過不來。', '我是露恩。黑暗裡我看得比你們清楚，所以晚上請相信我。', '露恩，報到。冷一點的地方我比較喜歡——你們呢？'],
};
const enlistLine = c => { const L = ENLIST[donorKey(c)]; if (!L) return `${who(c)}、入伍。`; let h = 7; for (const ch of String(c.uid ?? c.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return L[h % L.length]; };
function maybeReveal() {
  if (revealAfter === undefined || !GV || GV.fresh == null || GV.fresh === revealAfter) return;
  revealAfter = undefined; const c = GV.roster.find(x => x.uid === GV.fresh); if (!c) return;
  const rank = CROWN_N[c.crown] ? c.crown : c.template ? 'tpl' : '';
  const rows = [['生命', c.st.hp], ['命中', sg(c.st.acc)], ['閃避', sg(c.st.eva)], ['近戰', sg(c.st.mel)], ['素質', pctText(c)]];
  const STEP = .32, t0 = .6, tRank = t0 + rows.length * STEP + .2, tLine = tRank + (rank ? .7 : 0), line = enlistLine(c);
  const box = Object.assign(document.createElement('div'), {className: `reveal r2 ${rank}`, innerHTML: `
    <div class="rart"><img src="${fullArt(c)}" alt="" onerror="this.onerror=null;this.src='${face(c)}';this.parentElement.classList.add('px')"></div>
    <div class="rflash"></div>
    <div class="rinfo">
      <div class="rcls">${CLS[c.cls].n}</div>
      <div class="rname2">${esc(who(c))}${c.callsign ? ` <span>${csq(c)}</span>` : ''}</div>
      <div class="rid">${c.id}</div>
      <div class="rstats">${rows.map(([k, v], i) => `<div class="rs" style="animation-delay:${(t0 + i * STEP).toFixed(2)}s"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      ${rank ? `<div class="rstamp ${rank}" style="animation-delay:${tRank.toFixed(2)}s">${CROWN_N[rank] || '模板'}</div>` : ''}
    </div>
    <div class="rdlg" style="animation-delay:${(tLine - .25).toFixed(2)}s"><b>${esc(who(c))}</b><p class="rline"></p><span class="rhint">點一下繼續</span></div>`});
  const P = box.querySelector('.rline'), timers = [];
  let done = false;
  const finish = () => { done = true; timers.forEach(clearTimeout); box.classList.add('rdone'); P.textContent = line; };
  [...line].forEach((ch, k) => timers.push(setTimeout(() => { P.textContent += ch; if (k === line.length - 1) finish(); }, (tLine + k * .09) * 1000)));
  box.onclick = () => { if (!done) finish(); else box.remove(); };
  document.body.appendChild(box);
}

// 結算報告（Alan 2026-10-11：行動的付出換來什麼）：一張大卡片，有沒看過的就跳出來（不在戰鬥中、沒有其他卡片時）；報表的「結算報告」可以回頭翻
const repDay = h => `第 ${Math.floor(h / 24) + 1} 天`;
function reportCard(r) {
  const FKN = Object.fromEntries(FK), m = Object.entries(r.money || {}).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  const res = r.side === 'def' ? (r.win ? '緝拿成功' : '沒能擋下') : (r.win ? '行動成功' : '行動失敗');
  return `<div class="rpc ${r.win ? 'win' : 'lose'}">
    <div class="rpc-eyebrow">黑單結算報告・${repDay(r.h)}</div>
    <h2>${esc(r.title)}</h2>
    <div class="rpc-stamp">${res}</div>
    <div class="rpc-sec"><h4>行動</h4><p>${r.side === 'def' ? `替${esc(r.employer)}緝拿${esc(r.target)}派來的密探` : `雇主${esc(r.employer)}，目標${esc(r.target)}`}・地點 <a href="#" data-center="${r.tile}" data-rpclose="1">${esc(r.place)}</a>・行動種類 ${esc(r.op)}${r.odds ? `・收單時${/勝算/.test(r.odds) ? '' : '勝算'}${esc(r.odds)}` : ''}${r.alert != null ? `・目標警戒 ${r.alert >= 60 ? '高' : r.alert >= 30 ? '中' : '低'}` : ''}</p></div>
    <div class="rpc-sec"><h4>你的付出</h4><p>打了 ${r.tickets} 張服務單、贏 ${r.wins} 張${r.auto ? `（${r.auto} 張由雇主自動結算）` : ''}${r.dead ? `・倒下 ${r.dead} 人` : '・沒有人倒下'}・積分佔 <b>${r.share}%</b>${r.others.length ? `（${r.others.map(o => `${esc(o.co)} ${o.pct}%`).join('、')}）` : '（只有你）'}</p></div>
    <div class="rpc-sec"><h4>世界上發生的事</h4>${r.world.map(x => `<p>${esc(x)}</p>`).join('')}</div>
    <div class="rpc-sec"><h4>對你的影響</h4>${r.me.map(x => `<p${x.startsWith('⚠') ? ' class="warn"' : ''}>${esc(x)}</p>`).join('')}
      <table class="rep">${m.map(([k, v]) => `<tr><td>${FKN[k] || k}</td><td class="n ${v < 0 ? 'neg' : ''}">${v < 0 ? '−' : '+'}$${Math.abs(Math.round(v))}k</td></tr>`).join('')}<tr class="tot"><td>合計</td><td class="n ${r.net < 0 ? 'neg' : ''}">${r.net < 0 ? '−' : '+'}$${Math.abs(Math.round(r.net))}k</td></tr></table></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button data-rpclose="1">知道了</button></div></div>`;
}
let reportOpen = null;
function showReport(r) {
  document.querySelector('.reveal.rp')?.remove(); reportOpen = r.id;
  const box = Object.assign(document.createElement('div'), {className: 'reveal rp', innerHTML: reportCard(r)});
  box.onclick = e => { if (e.target === box || e.target.closest('[data-rpclose]')) { box.remove(); reportOpen = null; if (!r.seen) { r.seen = true; send({type: 'readReport', id: r.id}); } } };
  document.body.appendChild(box);
}
function maybeReport() {
  if (!GV || WATCH || mission || reportOpen || document.querySelector('.reveal')) return;
  const r = (GV.reports || []).find(x => !x.seen); if (r) showReport(r);
}

// ───── 基地（Alan 2026-10-12：移動基地，原本的 Rover 併進來）：開動、搜索、遭遇、運兵車、登記地、搶購、突發事件、在地小事、升級、日誌 ─────
let roverPick = null;
// 下令開動之後跳一張卡片：伺服器回來、路線排好了才秀，開不過去就秀原因
let roverToast = null;
// 其他基地的動作：送出前記下日誌最新那一筆，回來之後把新的幾筆秀成卡片；失敗就秀原因
let roverAct = null, roverSeen = null;
const rvKey = e => e ? e.h + '|' + e.text : '';
function roverSend(m, title) { roverAct = {title, top: rvKey(GV?.hq?.log?.[0])}; send(m); }
function roverNews(err) {
  const R = GV?.hq, L = R?.log || [];
  const fresh = top => { const out = []; for (const e of L) { if (rvKey(e) === top) break; out.push(e); } return out.reverse(); };
  if (roverAct) { const a = roverAct; roverAct = null; roverSeen = rvKey(L[0]);
    if (err) { roverCard(`${a.title}：沒有成功`, esc(err)); return; }
    const lines = fresh(a.top); roverCard(a.title, lines.map(e => esc(e.text)).join('<br>') || '完成了。'); return; }
  if (roverSeen == null) { roverSeen = rvKey(L[0]); return; }
  const lines = fresh(roverSeen).filter(e => e.kind === 'find' || e.kind === 'danger'); roverSeen = rvKey(L[0]);
  if (lines.length && roverToast == null) roverCard('基地回報', lines.slice(-4).map(e => esc(e.text)).join('<br>'));
}
function roverToastCheck(err) {
  if (roverToast == null) return; const to = roverToast; roverToast = null; const R = GV?.hq;
  if (err) { roverCard('基地開不過去', esc(err)); return; }
  if (!R || R.dest !== to && R.move?.to !== to) return;
  const n = R.route.length + (R.move ? 1 : 0), nm = t => esc(ST.names?.[t] || '荒野');
  roverCard(`基地出發：開往${nm(to)}`, `${n} 格，約 ${fmtLeft(R.etaH)}，油錢每格 $${R.fuel}k。路上遇到人會停下來，在家的人上場守住基地，打完接著開。`);
}
function roverCard(title, body) {
  document.querySelector('.rvcard')?.remove();
  const el = Object.assign(document.createElement('div'), {className: 'rvcard', innerHTML: `<b>${title}</b><p>${body}</p><div class="row"><button data-x="1">知道了</button><button data-rv="1">看基地</button></div>`});
  el.onclick = e => { if (e.target.closest('[data-rv]')) showPage('rover'); if (e.target.closest('button')) el.remove(); };
  document.body.appendChild(el); setTimeout(() => el.remove(), 8000);
}
// 在外面的人（出勤、回程、在集合點等）：基地開走前要提醒
const outside = () => GV?.hq?.out?.here ?? 0;   // 集合點就是基地現在這一格的人（基地開走就接不到；駐軍不算）
function baseGoAsk(tile) {
  const nm = t => ST.names?.[t] || '荒野', p = selPath && selPath.to === tile ? selPath.base : null, n = outside();
  const msg = `基地開到${nm(tile)}？\n\n${p ? `${p.tiles} 格，約 ${fmtLeft(p.hours)}，油錢 $${p.fuel}k（每格 $${GV.hq?.fuel ?? 3}k）。` : `油錢每格 $${GV.hq?.fuel ?? 3}k。`}路上可能被攔，在家的人會上場守住基地。${n ? `\n\n⚠ 現在有 ${n} 個人在外面：他們會開回出發時的集合點；基地不在那裡（也不在他們回程的路上），就只能在那裡等 48 小時，等不到會倒下。` : ''}`;
  if (confirm(msg)) { roverToast = tile; send({type: 'baseGo', tile}); }
}
// 地圖上一格：基地開到這裡、這裡的遠征點／突發事件／搶購、此地（同一格的公司、留言、對話）
function baseTileHtml(i) {
  const H = GV.hq || {}, W = GV.world || {}, nm = t => esc(ST.names?.[t] || '荒野'); let html = '';
  if (W.rumor?.tile === i) html += W.rumor.found ? `<p style="border-left:3px solid #ff5a5a;padding-left:8px"><b style="color:#ff5a5a">舊星艦維修站</b>　第 ${W.rumor.found.y} 年由${esc(W.rumor.found.who)}找到<br><span class="muted">${W.rumor.holder ? `現在在${esc(W.rumor.holder)}手上：每段時間吐出大量燃料、彈藥、零件和水，駐守的人越多產得越多。其他勢力一直在打它的主意。` : '還沒有勢力佔下它。'}</span></p>`
    : `<p style="border-left:3px solid #ff5a5a;padding-left:8px"><b style="color:#ff5a5a">傳聞</b>　舊星艦的維修站<br><span class="muted">第 ${W.rumor.y} 年開始流傳：東邊大河中段的${nm(i)}一帶露出了舊時代的鋼骨。還沒有人真的找到它；好幾個勢力派了遠征隊往這裡走。把基地開到這一格搜索，或某個勢力推進到附近，就會知道是真是假。</span></p>`;
  for (const x of (W.events || []).filter(x => x.tile === i)) html += `<p style="border-left:3px solid #f2c94c;padding-left:8px"><b style="color:#f2c94c">突發事件</b>　${esc(x.title)}<br><span class="muted">${esc(x.hint)}・${cd(x.end)}後消失・基地開過來搜索，先搜到的先拿</span></p>`;
  for (const x of (W.sites || []).filter(x => x.tile === i)) html += `<p style="border-left:3px solid #c49a5a;padding-left:8px"><b style="color:#c49a5a">遠征點 ${'●'.repeat(x.lv)}${'○'.repeat(3 - x.lv)}</b>　${esc(x.title)}<br><span class="muted">${esc(x.hint)}・${x.taken ? `最近被${esc(x.taken)}搜過了` : '基地開過來搜索才拿得到，先搜到的先拿'}</span></p>`;
  for (const d of (W.deals || []).filter(x => x.tile === i)) html += `<p style="border-left:3px solid #8fd18b;padding-left:8px"><b style="color:#8fd18b">搶購</b>　${esc(d.title)}<br><span class="muted">${hourNow() < d.open ? `${cd(d.open)}後開賣` : `${cd(d.close)}後結束`}・剩 ${d.left} 個名額${d.mine ? '・你買過了' : ''}・基地要停在這座城才能買</span>${H.tile === i && H.inTown && !d.mine && d.left > 0 && hourNow() >= d.open ? `<br><button data-act="deal" data-id="${d.id}">買（$${d.cost}k）</button>` : ''}</p>`;
  if (i !== H.tile || !H.parked) html += `<p><button data-act="basego" data-id="${i}">基地開到這裡</button> <span class="mini muted">${selPath?.to === i && selPath.base ? `${selPath.base.tiles} 格・約 ${fmtLeft(selPath.base.hours)}・油錢 $${selPath.base.fuel}k` : '基地照原本慢車的速度一格一格走'}</span></p>`;
  html += hereHtml(i);
  return html;
}
// 此地（Alan 2026-10-12：在戰略地圖的地點分頁）：這一格停著哪些公司的基地、留在這一格的留言（三天）；基地停在這一格時可以留言、跟同一格的人對話（一天）
function hereHtml(i) {
  const W = GV.world || {}, mine = GV.hq?.tile === i, X = mine ? GV.here : null, rel = h => `${repDay(h)} ${String(Math.floor(h) % 24).padStart(2, '0')}:00`;
  const cos = (W.bases || []).filter(c => c.tile === i), notes = (W.notes || []).filter(n => n.tile === i).slice(-20).reverse();
  if (!mine && !cos.length && !notes.length) return '';
  return `<h2 style="margin-top:10px">此地</h2><div class="mini">${mine ? '<b>我們的基地停在這裡</b>・' : ''}${cos.length ? cos.map(c => `<b>${esc(c.name)}</b>${c.npc ? '（NPC）' : ''} ${c.n} 人`).join('・') : '沒有別家公司的基地停在這裡。'}</div>
    <h4 class="sec2">留言 <span class="mini muted">留三天</span></h4>${notes.map(n => `<p class="mini"><span class="muted">${rel(n.h)}</span> <b>${esc(n.co)}</b>：${esc(n.text)}</p>`).join('') || '<p class="mini muted">沒有留言。</p>'}
    ${mine ? `<div class="row"><input id="noteIn" maxlength="120" placeholder="留一句話給之後經過的人（120 字以內）" style="flex:1"><button data-act="note">留言</button></div>
    <h4 class="sec2">對話 <span class="mini muted">基地停在這一格的人看得到，留一天</span></h4>${X.chat.map(n => `<p class="mini"><span class="muted">${rel(n.h)}</span> <b>${esc(n.co)}</b>：${esc(n.text)}</p>`).join('') || '<p class="mini muted">還沒有人說話。</p>'}
    <div class="row"><input id="sayIn" maxlength="120" placeholder="跟這一格的人說話" style="flex:1"><button data-act="say">說</button></div>` : '<p class="mini muted">基地停在這一格才能留言、說話。</p>'}`;
}
// 外出的人（Alan 2026-10-12）：照集合點分組；誰、在做什麼、什麼時候到集合點、到了之後還能等多久。駐軍另外在長約那邊
function outsHtml(R) {
  const G = R.outs || []; if (!G.length) return '';
  const who = u => { const c = GV.roster.find(x => x.uid === u); return c ? chip(c, false, 'person') : `#${u}`; };   // 點人看詳細資料（跟名冊一樣）
  const row = p => { const now = hourNow() ?? GV.h;
    const st = p.state === 'wait' ? `<b style="color:var(--war)">在集合點等基地</b>・補給還撐 ${cd(p.until)}` : p.state === 'travel' ? `開回集合點・${cd(p.eta)}後到・到了之後可以等 48 小時` : `${p.state === 'column' ? '補員路上' : '任務中'}：${esc(p.what || '')}${p.eta != null ? `・預估 ${cd(p.eta)}後到集合點（案期結束後開回來）` : ''}`;
    return `<div class="row caseline"><span style="flex:0 0 auto">${who(p.uid)}</span><span class="mini" style="flex:1">${st}</span></div>`; };
  return `<div class="box"><h3 class="sec">外出的人 <span class="muted">照集合點分組；回到集合點時基地在那裡（或旁邊一格）就上車，不在就最多等 48 小時</span></h3>
    ${G.map(g => `<h4 class="sec2">集合點：<a href="#" data-mappick="${g.tile}" title="到地圖上看這一格">📍${esc(g.name)}</a>　${g.here ? '<span style="color:var(--ok, #8fd18b)">基地在這裡，回來就上車</span>' : `<span style="color:var(--war)">基地不在（${g.d} 格外）</span> <button data-act="basego" data-id="${g.tile}">基地開過去</button>`}　<span class="mini muted">${g.people.length} 人</span></h4>${g.people.slice().sort((a, b) => (a.state === 'wait' ? 0 : 1) - (b.state === 'wait' ? 0 : 1) || (a.eta ?? 1e9) - (b.eta ?? 1e9)).map(row).join('')}`).join('')}</div>`;
}
function renderRover() {
  const P = $('pane-rover'); if (!P) return;
  if (!GV) { P.html = '<div class="box"><p class="muted">開了公司之後才有基地。</p></div>'; return; }
  if (P.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;   // 正在打字，先不重畫
  const R = GV.hq, W = GV.world || {}, nm = t => esc(ST.names?.[t] || '荒野'), V = GV.vans || {cap: 2, used: 0};
  const st = R.ticket ? '<b style="color:var(--war)">基地被攔住了，打完才能繼續走</b>' : R.searching ? `搜索中，${cd(R.searching)}後結束`
    : R.move ? `開往${nm(R.move.to)}，${cd(R.move.t1)}後到${R.dest != null && R.dest !== R.move.to ? `・目的地 ${nm(R.dest)}（還有 ${R.route.length + 1} 格、約 ${fmtLeft(R.etaH)}）` : ''}` : `停在${nm(R.tile)}${R.inTown ? '（城裡）' : '（荒野）'}`;
  const tk = R.ticket && (GV.tickets || []).find(t => t.id === R.ticket), homeN = GV.roster.filter(c => c.alive && c.status === 'home').length, out = outside();
  const vanPrice = [150, 250][V.cap - 2];
  const deals = (W.deals || []).filter(d => d.left > 0 && !d.mine), here = (W.deals || []).filter(d => d.tile === R.tile);
  P.html = `<div class="box"><h3 class="sec">基地 <span class="muted">・<a href="#" data-center="${R.tile}">${nm(R.tile)}</a></span></h3>
    <div class="mini">${st}</div>
    <div class="mini" style="margin-top:4px">登記在 <b>${esc(R.homeName)}</b><!-- 說明（不顯示）：（登記地的勢力，勢力照這裡算） -->${R.inTown && R.home !== R.tile ? ` <button data-act="baseregister">換登記到${nm(R.tile)}（$${R.regCost}k，一季一次）</button>` : ''}</div>
    <div class="mini">運兵車 <b>${Math.max(0, V.cap - V.used)}</b>／${V.cap} 台空著${V.used > V.cap ? '（舊規則派出去的隊伍還沒回來）' : ''}${R.inTown && V.cap < 4 ? ` <button data-act="basevan">買第 ${V.cap + 1} 台（$${vanPrice}k）</button>` : ''}・一台載一隊四人；基地在現場就直接派、不用車</div>
    <div class="mini">${R.inTown ? '停在城裡：吃喝照城裡的' : `在城外每天：熱量 ${+(homeN * R.daily.food).toFixed(1)}、淨水 ${+(homeN * R.daily.water).toFixed(1)}（在家 ${homeN} 人，從倉庫扣）`}${R.hungry ? `・<span style="color:var(--war)">缺糧第 ${R.hungry} 天（培養槽停擺）</span>` : ''}</div>
    ${out ? `<div class="mini">有 ${out} 個人在外面，集合點就是這裡：基地不要開走，他們回來就會自己上車。</div>` : ''}
    ${R.out?.far ? `<div class="mini" style="color:var(--war)">有 ${R.out.far} 個人的集合點在別的地方：${R.out.farAt.map(x => `<a href="#" data-mappick="${x.tile}">📍${esc(x.name)}</a>`).join('、')}——把基地開過去接（到了集合點基地不在，只能等 48 小時；下面「外出的人」有每個人的時間）。</div>` : ''}
    ${tk ? `<div class="card" style="margin-top:8px"><b>${esc(tk.title)}</b><div class="mini">敵人：${esc(tk.enemy.name)}（戰力 ${tk.enemy.power}）・守衛：${R.guard.map(u => esc(nameShort(GV.roster.find(x => x.uid === u) || {}))).join('、')}</div>${tk.intro ? `<div class="mini" style="font-style:italic">${esc(tk.intro)}</div>` : ''}<div class="row"><button data-act="fight" data-id="${tk.id}">親自打</button><button data-act="resolve" data-id="${tk.id}">現在自動結算</button></div></div>` : ''}
    <div class="row" style="margin-top:8px;flex-wrap:wrap">${R.route.length || R.move ? '<button data-act="basestop">停下</button>' : ''}<button data-act="basesearch"${R.block || !R.parked ? ' disabled' : ''}>搜索這一帶（4 小時）${R.site && !R.site.taken ? `：${esc(R.site.title)}` : ''}</button></div>
    ${R.site ? `<p class="mini">${esc(R.site.title)}：${esc(R.site.hint)}${R.site.taken ? `（最近被${esc(R.site.taken)}搜過了）` : ''}</p>` : ''}
    <!-- 說明（不顯示）：要去哪裡：到戰略地圖點一格，按「基地開到這裡」。基地照原本慢車的速度走，每格油錢 $3k；停在委託旁邊一格以內，那個委託就能直接派人（不用車、不限隊數） --></div>
    ${here.length ? `<div class="box"><h3 class="sec">這座城的搶購</h3>${here.map(d => `<div class="row caseline"><span class="mini" style="flex:1">${esc(d.title)}・剩 ${d.left} 個名額・${hourNow() < d.open ? `${cd(d.open)}後開賣` : `${cd(d.close)}後結束`}</span>${R.inTown && !d.mine && d.left > 0 && hourNow() >= d.open ? `<button data-act="deal" data-id="${d.id}">買（$${d.cost}k）</button>` : d.mine ? '<span class="mini">買過了</span>' : ''}</div>`).join('')}</div>` : ''}
    ${outsHtml(R)}
    <div class="box"><h3 class="sec">突發事件與搶購 <span class="muted">基地到場才拿得到，先到先得</span></h3>
    ${(W.events || []).map(x => `<div class="row caseline"><span class="mini" style="flex:1"><b style="color:#f2c94c">★</b> ${esc(x.title)}・${esc(x.hint)}・${cd(x.end)}後消失</span><button data-act="basego" data-id="${x.tile}">開過去</button></div>`).join('')}
    ${deals.map(d => `<div class="row caseline"><span class="mini" style="flex:1"><b style="color:#8fd18b">$</b> ${esc(d.title)}・${hourNow() < d.open ? `${cd(d.open)}後開賣` : `${cd(d.close)}後結束`}・剩 ${d.left}</span>${d.tile !== R.tile ? `<button data-act="basego" data-id="${d.tile}">開過去</button>` : ''}</div>`).join('')}
    ${!(W.events || []).length && !deals.length ? '<p class="mini muted">現在沒有。</p>' : ''}</div>
    <!-- 說明（Alan 2026-10-12：不要顯示，留在註解）：地圖上的「搜」是遠征點（舊戰場、舊礦坑、燃料林、廢墟），也要基地到場搜索；★是突發事件，$是搶購 -->
    <div class="box"><h3 class="sec">在地小事 <span class="muted">基地停在城裡時，城裡的人拜託的事，最多同時接三件</span></h3>
    ${R.jobs.map(j => `<div class="row caseline"><span class="mini" style="flex:1"><b>${esc(j.title)}</b>・$${j.reward}k・${j.state === 'found' ? `人找到了，帶回${esc(j.fromName)}` : j.state === 'fight' ? '正在打' : j.kind === 'deliver' ? `送到${esc(j.toName)}` : `去${esc(j.toName)}`}・${cd(j.expires)}後過期</span>${j.state !== 'fight' ? `<button data-act="basego" data-id="${j.state === 'found' ? j.from : j.to}">開過去（${j.d} 格）</button>` : ''}</div>`).join('') || '<p class="mini muted">沒有接著的小事。</p>'}
    ${R.jobsHere.length ? `<h4 class="sec2">${nm(R.tile)}的人拜託的</h4>${R.jobsHere.map(j => `<div class="row caseline"><span class="mini" style="flex:1">${esc(j.title)}・$${j.reward}k</span><button data-act="basejob" data-id="${j.id}">${j.kind === 'supply' ? '賣給他們（從倉庫）' : '接下'}</button></div>`).join('')}` : R.inTown ? '<p class="mini muted">這座城現在沒有人拜託事情。</p>' : ''}</div>
    <!-- 說明（不顯示）：停在城裡才有人拜託事情 -->
    <div class="box"><h3 class="sec">升級 <span class="muted">要到對的地方才能升</span></h3>
    ${R.up.map(u => `<div class="caseline" style="margin:6px 0"><div class="row"><span style="flex:1"><b>${esc(u.n)}</b> ${u.lv}／${u.max} 級<span class="mini muted">・現在：${esc(u.now)}${u.next ? `・下一級：${esc(u.next)}（$${u.cost}k）` : '・已經升到頂'}</span></span>${u.next && u.here ? `<button data-act="baseup" data-id="${u.kind}">升級（$${u.cost}k）</button>` : ''}</div>
      ${u.next && !u.here ? `<div class="mini muted">要到${esc(u.where)}：${u.near.map(x => `<button data-act="basego" data-id="${x.tile}">${esc(x.name)}（${x.d} 格・約 ${fmtLeft(x.hours)}）</button>`).join(' ') || '附近找不到'}</div>` : ''}</div>`).join('')}</div>
    <div class="box"><h3 class="sec">基地日誌</h3><div class="rvlog">${R.log.map(e => `<p class="rv-${e.kind}"><span class="mini muted">${repDay(e.h)} ${String(Math.floor(e.h) % 24).padStart(2, '0')}:00</span> ${esc(e.text)}</p>`).join('')}</div></div>`;
}

// 人員詳細資料：獨立的一張卡片，疊在畫面上（Alan 2026-10-10：比較好控制版面）；✕、點外面、Esc 關掉
function renderPerson() {
  const P = $('pcard'); if (!P) return;
  const c = GV && personSel != null && (['co', 'roster', 'vat', 'store', 'trade', 'rover'].includes(page) || sortie) && GV.roster.find(x => x.uid === personSel);
  P.hidden = !c; if (c) $('pcbox').html = personCard(c);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && personSel != null && !$('pcard').hidden) { personSel = null; gearPick = null; renderRoster(); } });
function renderRoster() {
  renderPerson(); renderRosterPage();
  const D = $('drawer'); if (!D) return;
  D.hidden = !GV || !['co', 'vat', 'store', 'trade'].includes(page); if (D.hidden) return;
  D.classList.toggle('open', drawerOpen);
  const G = GV, alive = G.roster.filter(c => c.alive), n = k => G.roster.filter(c => inF(c, k)).length;
  $('drawbar').html = `<b>名冊</b><span class="mini">活著 ${alive.length}・待命 ${n('home')}・出勤 ${G.roster.filter(c => c.alive && c.status === 'away').length}${G.roster.some(c => c.alive && c.status === 'returning') ? `・歸途 ${G.roster.filter(c => c.alive && c.status === 'returning').length}` : ''}${n('kia') ? `・已除名 ${n('kia')}` : ''}</span><span class="caret">${drawerOpen ? '▼' : '▲'}</span>`;
  if (!drawerOpen) return;
  $('drawbody').html = rosterBody();
}
function renderRosterPage() {
  const P = $('pane-roster'); if (!P || page !== 'roster') return;
  P.html = GV ? `<div class="box"><h3 class="sec">名冊 <span class="muted">點人看詳細資料、換裝備</span></h3>${rosterBody()}</div>` : '<div class="box"><p class="muted">開了公司之後才有名冊。</p></div>';
}
// 名冊的內容：底部抽屜和「部隊・名冊」子分頁共用
function rosterBody() {
  const G = GV, n = k => G.roster.filter(c => inF(c, k)).length;
  const R = G.roster.filter(x => inF(x)).sort((a, b) => b.pct - a.pct);
  return `<div class="filters">${Object.entries(RF).map(([k, v]) => `<button data-rf="${k}" class="${rosterF === k ? 'on' : ''}">${v} <span class="muted">${n(k)}</span></button>`).join('')}</div>
    <div class="faces">${R.map(x => `<button class="face${x.alive ? '' : ' kia'}${x.status === 'regen' ? ' resting' : ''}${x.uid === G.fresh ? ' fresh' : ''}" data-person="${x.uid}"><img src="${face(x)}" alt=""><b>${nameMin(x)}</b><span>${x.callsign ? esc(who(x)) + '・' : ''}${x.id}・${CLS[x.cls].n} ${x.lv || 1}級</span>${x.keep ? '<i class="kept">供</i>' : ''}${x.status === 'regen' ? `<i class="regen">休養 ${cd(x.regenAt)}</i>` : ''}</button>`).join('') || '<p class="muted">沒有。</p>'}</div>`;   // 守密者撤退後在培養槽休養：照樣列出來、標剩多久
}
// 裝備欄（Alan 2026-10-09）：槍 ×3、近戰、護甲、預備品 ×2。在總部待命時可以換：點「換」從倉庫挑，原本那件回倉庫
const SLOT_N = {gun0: '武器 1', gun1: '武器 2', gun2: '武器 3', melee: '近戰', armor: '護甲', kit0: '預備品 1', kit1: '預備品 2'};
let gearPick = null;   // {uid, slot}：正在挑哪一格
function gearOfC(c) { const g = c.gear || {guns: [], kits: []}; return s => s.startsWith('gun') ? g.guns?.[+s[3]] : s.startsWith('kit') ? g.kits?.[+s[3]] : g[s]; }
function gearBox(c) {
  // 整補（Alan 2026-10-11）：出勤中的人從隨隊行李換（隊員之間交換：一個人卸下放進行李、另一個人拿起來）；在總部從倉庫換
  const get = gearOfC(c), home = c.alive && c.status === 'home', fs = c.field ? GV.packs?.[c.field] : null, can = home || (fs && !fs.lock), src = home ? GV.store || [] : fs?.items || [], where = home ? '倉庫' : '行李';
  const rows = SLOTS.map(s => { const it = get(s), open = gearPick && gearPick.uid === c.uid && gearPick.slot === s;
    const pick = open ? `<div class="gpick">${src.filter(x => x.kind === slotKind(s)).map(x => `<button data-eq="${x.id}">${esc(x.name)}</button>`).join('') || `<span class="mini muted">${where}裡沒有能放進這一格的</span>`}${it ? `<button data-eq="">卸下${home ? '' : '（放進行李）'}</button>` : ''}<button data-eqx="1">取消</button></div>` : '';
    return `<tr><th>${SLOT_N[s]}</th><td>${it ? esc(itemName(it)) : '<span class="muted">—</span>'}</td><td>${can ? `<button data-gslot="${s}">換</button>` : ''}</td></tr>${pick ? `<tr><td colspan="3">${pick}</td></tr>` : ''}`; }).join('');
  const bag = fs ? `<div class="mini" style="margin-top:6px">${esc(fs.name)}的隨隊行李：${fs.items.map(x => esc(x.name)).join('、') || '空的'}${fs.lock ? '<br><span class="muted">這一隊有一場戰鬥還沒打完，打完才能整補。</span>' : ''}</div>` : '';
  return `<table class="rep gear">${rows}</table>${bag}${can || fs ? '' : '<p class="mini muted">出勤中，回到總部才能換裝。</p>'}`;
}
// 服役紀錄（Alan 2026-10-10）：新的在上面
// 格子收集（Alan 2026-10-10）：10×10，填上的亮起來；同一位原主的人可以合成（留這一位，吃掉對方，格子取聯集）
function cellBox(c) {
  let g = ''; for (let i = 0; i < 100; i++) g += `<i class="${cellHas(c, i) ? 'on' : ''}"></i>`;
  const mates = c.alive && c.status === 'home' ? GV.roster.filter(x => x !== c && x.alive && x.status === 'home' && (x.donor ?? x.portrait) === (c.donor ?? c.portrait)) : [];
  const gain = x => { let n = 0; for (let i = 0; i < 100; i++) if (cellHas(x, i) && !cellHas(c, i)) n++; return n; };
  return `<h4 class="sec2">記憶片段 ${cellCount(c)}／100 <span class="muted">保底 ${c.dup || 0}／${CELL_PITY}・每 1 點積分抽 1 片・每 10 片升一級</span></h4><div class="cells">${g}</div>
    ${mates.length ? `<div class="mini" style="margin-top:6px">合成：留下這一位，吃掉另一位（對方只提供記憶片段，身上的裝備進倉庫）</div>${mates.map(x => `<div class="row caseline"><span class="mini" style="flex:1">${esc(who(x))} ${x.id}・${x.lv || 1} 級・記憶片段 ${cellCount(x)}・能多 <b>${gain(x)}</b> 片</span><button data-act="merge" data-id="${c.uid}" data-feed="${x.uid}">吃掉這位</button></div>`).join('')}` : ''}`;
}
function serviceRecord(c) {
  const R = (c.record || []).slice().reverse(), d = h => `第 ${Math.floor(h / 24) + 1} 天`;
  const line = e => e.t === 'born' ? (e.before ? `${esc(e.co)}・在這之前的事沒有留下紀錄` : `${d(e.h)}・在${esc(e.place)}的${esc(e.co)}出槽`)
    : e.t === 'case' ? `${d(e.h)}・${esc(e.co)}「${esc(e.title)}」：打了 ${e.fights} 場、贏 ${e.wins} 場${e.recalled ? '・中途召回' : e.end != null ? `・結案${e.delivered !== undefined ? `（送達 ${Math.round(e.delivered * 100)}%）` : ''}・尾款 $${e.payout || 0}k` : '・進行中'}`
    : e.t === 'kia' ? (e.confirm ? `${d(e.h)}・遺體沒能收回，確認戰死` : e.title ? `${d(e.h)}・在${esc(e.place)}「${esc(e.title)}」陣亡` : `${d(e.h)}・陣亡`)
    : e.t === 'down' ? `${d(e.h)}・在${esc(e.place)}「${esc(e.title)}」倒下${e.recovered ? '，遺體當場收回' : '，遺體沒能帶回'}`
    : e.t === 'recovered' ? `${d(e.h)}・${esc(e.co)}在${esc(e.place)}一帶撿回遺體`
    : e.t === 'transfer' ? `${d(e.h)}・遺體輾轉到了${esc(e.co)}手上`
    : e.t === 'callsign' ? `${d(e.h)}・在${esc(e.co)}被叫作 “${esc(e.name)}”`
    : e.t === 'sold' ? `${d(e.h)}・${esc(e.co)}把遺體賣了（$${e.price}k）`
    : e.t === 'talent' ? `${d(e.h)}・${e.lv} 級選了「${esc(e.name)}」`
    : e.t === 'merge' ? `${d(e.h)}・吸收了 ${esc(e.fed)} 的記憶片段，多了 ${e.gain} 片`
    : e.t === 'revive' ? `${d(e.h)}・在${esc(e.co)}重新培養，等級、技能從頭來` : esc(e.t);
  return `<h4 class="sec2">服役紀錄</h4>${R.length ? R.map(e => `<div class="mini caseline">${line(e)}</div>`).join('') : '<p class="mini muted">還沒有紀錄。</p>'}`;
}
// 數值：出生的天賦＋等級的成長（3、5、7、9、11 級；company.js growOf）
function statTable(c) {
  const g = growOf(c), up = k => g[k] ? `<span class="grow">+${g[k]}</span>` : '';
  const extra = [g.plates ? `護甲板上限 +${g.plates}` : '', g.drone ? `機體生命 +${g.drone}` : ''].filter(Boolean).join('・');
  return `<table class="rep pstats"><tr><th>生命</th><th>命中</th><th>閃避</th><th>近戰</th><th>素質</th></tr><tr><td>${c.st.hp + (g.hp || 0)}${up('hp')}</td><td>${sg(c.st.acc + (g.acc || 0))}${up('acc')}</td><td>${sg(c.st.eva + (g.eva || 0))}${up('eva')}</td><td>${sg(c.st.mel + (g.mel || 0))}${up('mel')}</td><td>${pctText(c)}</td></tr></table>${extra ? `<div class="mini">等級成長：${extra}</div>` : ''}`;
}
// 性格技能（Alan 2026-10-13，模仿 XCOM）：4、6、8、10 級各從三種性格裡選一個，選了就固定
function talentBox(c) {
  const R = TALENTS[c.cls]; if (!R) return '';
  const lv = c.lv || 1, live = c.alive || c.status === 'recovered';
  const rows = TALENT_ROWS.map(r => {
    const got = c.tal?.[r], open = live && lv >= r && got == null;
    return `<div class="talrow${lv < r ? ' locked' : ''}"><div class="tallv">${r} 級</div>${R.rows[r].map((o, k) => `<button class="tal${got === k ? ' on' : got != null ? ' off' : ''}"${open ? ` data-act="talent" data-id="${c.uid}" data-row="${r}" data-k="${k}"` : ' disabled'}><b>${esc(o.n)}</b><span>${esc(o.text)}</span></button>`).join('')}</div>`;
  }).join('');
  const due = TALENT_ROWS.filter(r => lv >= r && c.tal?.[r] == null).length;
  return `<h4 class="sec2">性格與技能 ${due && live ? `<span class="due">有 ${due} 個可以選</span>` : ''}</h4>
    <div class="talrow talhead"><div></div>${R.paths.map(n => `<div>${esc(n)}</div>`).join('')}</div>${rows}
    <div class="mini muted">選了就固定，可以跨性格選。3、5、7、9、11 級自動長數值。</div>`;
}
// 手機的人員卡片（Alan 2026-10-14）：資料那一片的上緣可以往上、往下拉；拉到底只留名字那一條，看得到完整的立繪。點一下上緣在「收起」和「預設」之間切換。
// 位置記在 sheetY（px，null＝預設），換人、重畫都照著放
let sheetY = null, sheetDrag = null;
const sheetLim = () => ({min: Math.round(innerHeight * .1), max: Math.round(innerHeight - 150)});
document.addEventListener('pointerdown', e => {
  const g = e.target.closest?.('.pcgrip'); if (!g || innerWidth >= 760) return;
  const m = g.parentElement; e.preventDefault(); g.setPointerCapture?.(e.pointerId);
  sheetDrag = {m, y0: e.clientY, top0: parseFloat(getComputedStyle(m).marginTop) || innerHeight * .4, moved: false};
});
document.addEventListener('pointermove', e => {
  if (!sheetDrag) return; const dy = e.clientY - sheetDrag.y0; if (Math.abs(dy) > 4) sheetDrag.moved = true;
  const {min, max} = sheetLim(); sheetY = Math.max(min, Math.min(max, Math.round(sheetDrag.top0 + dy))); sheetDrag.m.style.marginTop = sheetY + 'px';
});
const sheetEnd = () => {
  if (!sheetDrag) return; const {m, moved} = sheetDrag, {max} = sheetLim(); sheetDrag = null;
  if (!moved) sheetY = (parseFloat(m.style.marginTop) || 0) >= max - 4 ? null : max;   // 點一下：收起 ↔ 預設
  m.classList.add('snap'); m.style.marginTop = sheetY == null ? '' : sheetY + 'px'; setTimeout(() => m.classList.remove('snap'), 260);
};
document.addEventListener('pointerup', sheetEnd); document.addEventListener('pointercancel', sheetEnd);
function personCard(c) {
  const st = c.alive ? (STATUS[c.status] || c.status) + (c.status === 'regen' && c.regenAt != null ? `（撤退回基地，${cd(c.regenAt)}後回來，不花素材）` : '') + (c.squad ? `・${esc(c.squad)}` : '') : c.status === 'recovered' ? (c.reviving ? '遺體在培養槽裡，重新培養中' : '遺體已收回，可以重新培養（等級、技能從頭來）')
    : c.status === 'sold' ? '已除名'
    : c.status === 'lost' ? `遺體沒能從${esc(c.downPlace)}帶回來・約 ${cd((c.downAt ?? 0) + 168)}後確認戰死（有人在那一帶打贏就可能撿回來）` : '已除名';
  const rv = REVIVE_RECIPE[c.cls], canRv = c.status === 'recovered' && !c.reviving;
  // 版面（Alan 2026-10-10）：左邊（手機在上面）留一整欄給之後的半身／全身立繪（art/full/<立繪>.png，還沒有就先放像素頭像）；右邊是資料
  return `<div class="person pc2"><button class="pcx" data-person="" aria-label="關閉">✕</button>
    <div class="pcart"><img src="${fullArt(c)}" alt="" onerror="this.onerror=null;this.src='${face(c)}';this.parentElement.classList.add('px')"><span class="pcart-cap">${esc(who(c))}${c.callsign ? ' ' + csq(c) : ''}${crownTag(c)}</span></div>
    <div class="pcmain"${sheetY != null ? ` style="margin-top:${sheetY}px"` : ''}><div class="pcgrip" title="往下拉看完整的立繪，往上拉看更多資料"><i></i></div>
    <div class="phead"><div><div class="pname">${nameFull(c)}${crownTag(c)} <button class="csbtn" data-act="callsign" data-id="${c.uid}" title="取綽號">✎ 綽號</button></div><div class="mini">${CLS[c.cls].n}</div><div class="mini">${st}</div><div class="mini">${c.lv || 1} 級・記憶片段 ${cellCount(c)}／100・出勤 ${c.missions || 0} 次</div></div></div>
    ${statTable(c)}
    ${gearBox(c)}
    ${talentBox(c)}
    <div class="mini">技能：${(c.skills || []).length ? c.skills.map(k => (SKN[k] || k) + (k === c.prep ? '（預備）' : '')).join('、') : `還沒有（${SKILL_LV} 級學會職業技能）`}</div>
    ${OUTFITS[donorKey(c)] && c.alive ? `<div class="mini" style="margin-top:8px">服裝</div><div class="row tags">${OUTFITS[donorKey(c)].map(([k, n], i) => `<button data-act="outfit" data-id="${c.uid}" data-o="${k}" class="${(c.outfit || OUTFITS[donorKey(c)][0][0]) === k ? 'on' : ''}">${n}</button>`).join('')}</div>` : ''}
    <div class="mini" style="margin-top:8px">分類（可以多選；「不出擊」的人不會被派出去）</div>
    <div class="row tags">${c.alive || c.status === 'recovered' ? [['keep', '不出擊'], ...Object.entries(TAGS)].map(([k, n]) => `<button data-act="tag" data-id="${c.uid}" data-tag="${k}" class="${k === 'keep' ? c.keep ? 'on' : '' : (c.tags || []).includes(k) ? 'on' : ''}">${n}</button>`).join('') : ''}</div>
    ${canRv ? `<div class="row"><button class="primary" data-act="revive" data-id="${c.uid}"${MATS.some(m => GV.mats[m] < rv[m]) ? ' disabled title="素材不夠"' : ''}>重新培養（${MATS.map(m => `${MN[m]} ${rv[m]}`).join('・')}）</button><button data-act="sellbody" data-id="${c.uid}" data-p="${c.bodyPrice}">賣掉遺體（時價 $${c.bodyPrice}k）</button></div><div class="mini muted">時價：最近 7 天全星球倒下 ${GV.deaths7 ?? 0} 人，死的人越多越便宜；金冠、銀冠、記憶片段多的比較值錢。賣掉前身上的裝備會先放進倉庫。</div>` : ''}
    ${cellBox(c)}
    ${serviceRecord(c)}
    </div></div>`;
}

// ───── 通知：收在右上角的信封，點開一疊卡片 ─────
const mailSeen = new Set(); let mailFirst = true, mailSig = '';
const SKN = {early_warning: '預警', signal_break: '訊號斷層', anchor: '下錨', grapple: '鉤鎖', workshop: '工坊'};
const MK = {ticket: '服務單', result: '戰果', pay: '結案', move: '調動', refused: '雇主', kia: '陣亡', vat: '培養槽', log: '公司'};
function mailItems() {
  if (!GV || !GM) return [];
  const a = [...GM.inbox.map(x => ({h: x.t, kind: x.kind, text: x.text, tile: x.tile, fight: x.fight})), ...GV.log.map(x => ({h: x.h, kind: /陣亡/.test(x.text) ? 'kia' : /出槽|培養完成/.test(x.text) ? 'vat' : /結案|回到總部/.test(x.text) ? 'pay' : 'log', text: x.text}))];
  a.sort((p, q) => q.h - p.h); return a.slice(0, 60).map(x => ({...x, sig: x.h + '|' + x.text}));
}
function renderMail() {
  const items = mailItems();
  if (mailFirst && items.length) { for (const x of items) if (x.kind === 'log' && x.h === 0) mailSeen.add(x.sig); mailFirst = false; }
  // 伺服器記著的已讀（換裝置、重新登入也一樣）
  const R = GM.mailRead; if (R) for (const x of items) if (x.h < R.h || (x.h === R.h && R.sigs.includes(x.sig))) mailSeen.add(x.sig);
  const open = !$('mail').hidden;
  const unread = items.filter(x => !mailSeen.has(x.sig)).length;
  $('mailN').hidden = !unread || open; $('mailN').textContent = unread > 99 ? '99+' : unread;
  if (!open) return;
  const sig = items.length + ':' + (items[0]?.sig || '') + ':' + items.map(x => x.fight || '').join(','); if (sig === mailSig) return; mailSig = sig;
  $('mailSub').textContent = `最近 ${items.length} 則`;
  const sig2 = items.map(x => x.fight || '').join(','); if (sig2 !== mailFights) { mailFights = sig2; mailSig = ''; }
  $('mailBody').innerHTML = items.map(x => `<div class="msg ${x.kind}${mailSeen.has(x.sig) ? '' : ' new'}${x.fight || x.tile != null ? ' go' : ''}"${x.fight ? ` data-mfight="${esc(x.fight)}"` : ''}${x.tile != null ? ` data-mtile="${x.tile}"` : ''}><div class="mh"><b>${MK[x.kind] || '通知'}</b><span>${x.fight ? '點一下親自打・' : x.tile != null ? '點一下看地圖・' : ''}${fmtH(x.h)}</span></div>${esc(x.text)}</div>`).join('') || '<p class="muted">沒有通知。</p>';
}
function closeMail() {
  $('mail').hidden = true; const items = mailItems(); for (const x of items) mailSeen.add(x.sig); renderMail();
  if (items.length) { const h = Math.max(...items.map(x => x.h)), R = GM.mailRead; if (!R || h > R.h || items.some(x => x.h === h && !R.sigs.includes(x.sig))) send({type: 'read', h, sigs: items.filter(x => x.h === h).map(x => x.sig)}); }
}
$('mailBtn').onclick = e => { e.stopPropagation(); if (!$('mail').hidden) { closeMail(); return; } $('mail').hidden = false; mailSig = ''; renderMail(); };
$('mailClose').onclick = closeMail;
// 點通知：還沒打的服務單（交戰）直接親自打；其他有位置的（案件、補員、戰果）切到戰略地圖並指過去
$('mailBody').addEventListener('pointerdown', e => {
  const m = e.target.closest('.msg.go'); if (!m || e.button !== 0) return;
  e.preventDefault(); closeMail();
  if (m.dataset.mfight) { send({type: 'fight', ticket: m.dataset.mfight}); showMissionLoading(); return; }
  if (m.dataset.mtile != null) { showPage('map'); select(+m.dataset.mtile, true, false); }
});
document.addEventListener('pointerdown', e => { if (!$('mail').hidden && !e.target.closest('#mail,#mailBtn')) closeMail(); });

// ───── 召回（兩段式確認：第一下變成「確定？」，三秒內再按一下才送出） ─────
let selPath = null, armed = null, armT = null, mailFights = '';
// 一隊的召回、補員（同一行；按下後的說明卡片在下面）
function squadActions(sq, c, al) {
  if (c.settled) return '';
  const u = {recall: {type: 'squad', id: sq.id, penalty: c.own || c.kind === 'camp' ? 0 : c.pay.deposit + (c.midPaid ? c.pay.mid : 0) + 10 * c.lv}, kind: c.own ? 'escort' : c.kind === 'camp' ? 'camp' : 'squad', busy: !!sq.busy};
  const canRe = !c.own && c.open && al < 4 && !sq.refused, picking = pickRe && pickRe.squad === sq.id;
  const btns = [recallBtn(u, true), ...sq.pending.map(p => recallBtn({recall: {type: 'column', id: p.id}, kind: 'column', n: p.n}, true)), canRe && !picking ? `<button data-act="re" data-id="${sq.id}">補員</button>` : ''].join('');
  const cards = [recallBtn(u), ...sq.pending.map(p => recallBtn({recall: {type: 'column', id: p.id}, kind: 'column', n: p.n}))].filter(x => x.includes('confirm')).join('');
  return `<div class="row">${btns}</div>${cards}${canRe && picking ? rePicker(4 - al - sq.pending.reduce((a, p) => a + p.n, 0)) : ''}`;
}
// 召回（Alan 2026-10-09：按鈕只寫兩個字，為多語言做準備；違約金等說明放在另外的確認卡片裡）
// onlyBtn：只要按鈕（放進同一行）；否則只回傳確認卡片（按下之後）或整列（地圖上的人馬）
function recallBtn(u, onlyBtn = false) {
  if (!u.recall) return '';
  const key = u.recall.type + ':' + u.recall.id;
  const label = u.kind === 'camp' ? '撤軍' : '召回';
  if (onlyBtn) return armed === key ? '' : `<button data-recall="${key}">${label}</button>`;
  if (armed !== key) return u.inRow ? '' : `<div class="row"><button data-recall="${key}">召回</button></div>`;
  const why = u.recall.type === 'column' ? `這 ${u.n || ''} 名補員在路上掉頭，開回基地。` : u.kind === 'escort' ? '護衛離開車隊，開回集合點；車隊之後出事由雇來的守衛自己打。'
    : u.kind === 'camp' ? `從大戰役撤軍：不算違約，已打下的貢獻照算，之後不再累積。${u.busy ? '手上那張服務單作廢。' : ''}`
    : `等於毀約：付違約金 <b>$${u.recall.penalty}k</b>，這個案件的積分作廢。${u.busy ? '手上的服務單交給案件的護衛去打。' : ''}`;
  return `<div class="confirm"><div class="mini">${why}回到出發時的集合點；基地不在，就在那裡等 48 小時。</div><div class="row"><button class="warn" data-recall="${key}">確定${u.kind === 'camp' ? '撤軍' : '召回'}</button><button data-recall-x="1">取消</button></div></div>`;
}
function recallClick(e) {
  if (e.target.closest('[data-recall-x]')) { armed = null; if (page === 'map') renderTile(); else renderPage(); return true; }
  const b = e.target.closest('[data-recall]'); if (!b) return false;
  const key = b.dataset.recall, [type, id] = key.split(/:(.+)/);
  if (armed !== key) armed = key;
  else { armed = null; send(type === 'column' ? {type: 'recallCol', amend: id} : {type: 'recall', squad: id}); }
  if (page === 'map') renderTile(); else renderPage();
  return true;
}

// ───── 採購路線 ─────
let QT = null, procSel = null;
function renderProc() {
  const el = $('co-proc'); if (!el) return;
  if (el.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;   // 正在輸入，先不重畫
  if (!QT) { el.innerHTML = '<p class="muted">查詢各城報價中…</p>'; return; }
  const cell = (q, m) => { const o = q.offer?.[m]; return !o || o.max <= 0 ? '<span class="muted">—</span>' : `$${o.price}k`; };
  let html = `<table class="rep"><tr><th>城</th><th>來回</th><th>風險</th>${MATS.map(m => `<th>${MN[m]}</th>`).join('')}</tr>` +
    QT.slice(0, 14).map(q => `<tr data-qt="${q.t}" class="${procSel && procSel.t === q.t ? 'sel' : ''}"><td>${esc(q.name)}${q.war ? ' <span class="neg">交戰</span>' : ''}${q.works ? ' <span class="mini">廠區</span>' : ''}</td><td>${fmtH(q.trip)}</td><td class="${q.risk > .5 ? 'neg' : ''}">${Math.round(q.risk * 100)}%</td>${MATS.map(m => `<td>${cell(q, m)}</td>`).join('')}</tr>`).join('') + '</table>';
  html += `<div class="row"><button data-act="qt-refresh">重新查詢報價</button><span class="mini">價格是那座城的市價；風險是整趟路上出事的機率。貨送到基地現在停的城；送到時基地不在，貨先寄放在那座城，基地停過去才收。</span></div>`;
  const q = procSel && QT.find(x => x.t === procSel.t);
  if (q) {
    const mats = MATS.filter(m => q.offer[m].max > 0); if (!mats.includes(procSel.mat)) procSel.mat = mats[0] || '';
    const o = q.offer[procSel.mat], cost = o ? Math.round(o.price * procSel.qty) + q.fee : 0;
    const av = GV.roster.filter(c => c.alive && c.status === 'home' && !c.keep);
    html += q.war ? `<p class="neg">${esc(q.fac)}跟我們這邊在打仗，不賣。</p>` : !mats.length ? '<p class="muted">這座城現在沒有可以賣的料。</p>' : `<div class="procform">
      <span>去</span><span><b>${esc(q.name)}</b> <span class="muted">${esc(q.fac)}・單程 ${fmtH(q.hours)}・來回加裝貨 ${fmtH(q.trip)}</span></span>
      <span>買</span><select data-pf="mat">${mats.map(m => `<option value="${m}"${m === procSel.mat ? ' selected' : ''}>${MN[m]}（$${q.offer[m].price}k，最多 ${q.offer[m].max}）</option>`).join('')}</select>
      <span>數量</span><input type="number" min="10" step="100" value="${procSel.qty}" data-pf="qty">
      <span>花費</span><span>貨款 $${o ? Math.round(o.price * procSel.qty) : 0}k ＋ 雇車隊 $${q.fee}k ＝ <b>$${cost}k</b>${cost > GV.cash ? ' <span class="neg">錢不夠</span>' : ''}</span>
      <span>護衛</span><span class="chips" style="margin:0">${av.map(c => chip(c, procSel.uids.has(c.uid), 'pu')).join('') || '<span class="muted">沒有待命的人</span>'}</span></div>
      <div class="row"><button class="primary" data-act="proc-go">出發（${procSel.uids.size >= 2 ? `護衛 ${procSel.uids.size} 人` : '不帶護衛'}）</button><button data-act="proc-x">取消</button><span class="mini">護衛坐一台運兵車（最多四人，至少兩人）；不帶護衛時，出事由雇來的守衛自己打。</span></div>`;
  }
  el.html = html;
}

// ───── 報表 ─────
const FK = [['fare', '油錢'], ['rover', '基地'], ['site', '搜索所得'], ['deal', '搶購'], ['raid', '基地被搶'], ['venue', '場地費'], ['shadow', '黑單報酬'], ['loot', '私掠分貨'], ['camp', '戰役報酬'], ['deposit', '訂金'], ['mid', '期中款'], ['final', '尾款'], ['upkeep', '維持費'], ['speed', '加速'], ['buy', '本地買料'], ['trip', '採購路線'], ['shop', '買裝備'], ['sell', '變賣'], ['mod', '改裝'], ['ammo', '彈藥費'], ['retainer', '長約'], ['bond', '履約保證金'], ['breach', '違約金'], ['garrison', '駐紮費'], ['clean', '清運'], ['body', '賣遺體']];
function renderRepPage() {
  const P = $('pane-rep');
  if (!GV) { P.innerHTML = '<div class="box"><h3 class="sec">報表</h3><p class="muted">開了公司之後才有報表。</p></div>'; return; }
  if (!$('co-rep')) P.innerHTML = `<div class="cohead"><div><div class="mini">${esc(GV.name)}・總部 ${esc(GV.baseName)}</div><div class="big" id="rep-cash"></div></div></div><div class="box"><h3 class="sec">報表</h3><div id="co-rep"></div></div>`;
  $('rep-cash').textContent = `$${GV.cash}k`; $('rep-cash').classList.toggle('neg', GV.cash < 0);
  renderRep();
}
// 報表分頁（Alan 2026-10-11：越拖越長，依性質分）：收支、案件、名氣、派系、人員；記住上次看的分頁
const REP_TABS = [['money', '收支'], ['reports', '結算報告'], ['cases', '案件'], ['fame', '名氣'], ['rel', '派系'], ['people', '人員']];
let repPeriod = 'all';
let repTab = (() => { try { return localStorage.getItem('chimera.repTab') || 'money'; } catch { return 'money'; } })();
function renderRep() {
  const el = $('co-rep'); if (!el) return;
  const R = GV.report, money = v => `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${Math.round(v || 0)}k</span>`;
  const tot = o => FK.reduce((x, [k]) => x + (o[k] || 0), 0), day = h => `第 ${Math.floor(h / 24) + 1} 天`;
  if (!REP_TABS.some(([k]) => k === repTab)) repTab = 'money';
  const sec = {
    // 結算報告（Alan 2026-10-11）：新的在上面，點一下打開那張卡片
    reports: () => { const L = (GV.reports || []).slice().reverse(); return L.length ? `<table class="rep">${L.map(r => `<tr data-rpopen="${r.id}" style="cursor:pointer"><td>${repDay(r.h)}</td><td>${esc(r.title)}</td><td>${r.side === 'def' ? (r.win ? '緝拿成功' : '沒能擋下') : (r.win ? '成功' : '失敗')}</td><td class="n ${r.net < 0 ? 'neg' : ''}">${r.net < 0 ? '−' : '+'}$${Math.abs(Math.round(r.net))}k</td></tr>`).join('')}</table>` : '<p class="mini muted">還沒有結算報告。參與的黑單行動結算後會出現在這裡。</p>'; },
    // 收支（Alan 2026-10-11：正式的會計帳）：名目｜資產（已入帳的收入）｜應收｜支出（已付）｜應支未支。
    // 上半是各科目（照期間：累計或近 30 天）；下半是進行中的案件——資產、支出已經算在上面的科目裡（灰字），應收、應支未支另外加總
    money: () => { const P = repPeriod === 'd30' ? R.d30 : R.all, cell = (v, cls = '') => v ? `<td class="n ${cls}">$${Math.round(v).toLocaleString()}k</td>` : '<td class="n"></td>';
      const rows = FK.map(([k, n]) => [n, Math.round(P[k] || 0)]).filter(([, v]) => v);
      const inc = rows.filter(([, v]) => v > 0), exp = rows.filter(([, v]) => v < 0), A = inc.reduce((t, [, v]) => t + v, 0), X = -exp.reduce((t, [, v]) => t + v, 0);
      const act = GV.cases.filter(c => !c.settled && !c.own), recv = c => { const n = c.squads.length; return (!c.midPaid && c.pay.mid ? c.pay.mid * n : 0) + (c.pay.final && c.scoreTot > 0 ? Math.round(c.pay.final * c.score / c.scoreTot) : 0); };
      const AR = act.reduce((t, c) => t + recv(c), 0), AP = act.reduce((t, c) => t + (c.due || 0), 0) || 0;
      return `<div class="mini">現金走勢（每天一點）</div><div class="spark" id="co-spark">${sparkSvg(R.daily, Math.max(280, (el.clientWidth || 320) - 4), 180)}</div>` +
        `<div class="chips reptabs" style="margin-top:8px">${[['all', '累計'], ['d30', '近 30 天']].map(([k, n]) => `<button class="chip${k === repPeriod ? ' on' : ''}" data-rper="${k}">${n}</button>`).join('')}</div>` +
        `<div class="hscroll"><table class="rep ledger"><tr><th>名目</th><th>資產</th><th>應收</th><th>支出</th><th>應支未支</th></tr>` +
        `<tr class="grp"><td colspan="5">收入</td></tr>` + (inc.map(([n, v]) => `<tr><td>${n}</td>${cell(v, 'pos')}<td></td><td></td><td></td></tr>`).join('') || '<tr><td class="muted" colspan="5">沒有</td></tr>') +
        `<tr class="grp"><td colspan="5">支出</td></tr>` + (exp.map(([n, v]) => `<tr><td>${n}</td><td></td><td></td>${cell(-v, 'neg')}<td></td></tr>`).join('') || '<tr><td class="muted" colspan="5">沒有</td></tr>') +
        (act.length ? `<tr class="grp"><td colspan="5">進行中的案件 <span class="mini">（資產、支出已記在上面的科目裡；尾款照目前的積分估）</span></td></tr>` + act.map(c => `<tr><td>${esc(c.title)}</td>${cell(c.got, 'muted')}${cell(recv(c), 'pos')}${cell(c.spent, 'muted')}${cell(c.due, 'neg')}</tr>`).join('') : '') +
        `<tr class="tot"><td>合計</td>${cell(A, 'pos')}${cell(AR, 'pos')}${cell(X, 'neg')}${cell(AP, 'neg')}</tr>` +
        `<tr><td>淨額</td><td class="n" colspan="2">現金 ${money(A - X)}</td><td class="n" colspan="2">含應收應付 ${money(A + AR - X - AP)}</td></tr>` +
        `<tr><td class="muted">帳面業務損失（陣亡，不是現金）</td><td></td><td></td>${cell(-(P.loss || 0), 'muted')}<td></td></tr></table></div>`; },
    // 案件：進行中的（已收、應收、應付維持費）與結案紀錄
    cases: () => { const act = GV.cases.filter(c => !c.settled && !c.own);
      return (act.length ? `<div class="mini">進行中的案件</div><table class="rep"><tr><th>案件</th><th>已收</th><th>應收</th><th>應付維持費</th></tr>` + act.map(c => { const n = c.squads.length;
        return `<tr><td>${esc(c.title)}</td><td>${c.pay.deposit ? `訂金 $${c.pay.deposit * n}k` : ''}${c.midPaid && c.pay.mid ? `＋期中 $${c.pay.mid * n}k` : ''}</td><td>${!c.midPaid && c.pay.mid ? `期中 $${c.pay.mid * n}k＋` : ''}${c.pay.final ? `尾款池 $${c.pay.final}k<span class="mini">（依積分平分）</span>` : ''}</td><td>${c.due ? `−$${Math.round(c.due)}k` : ''}</td></tr>`; }).join('') + '</table>' : '<p class="mini muted">沒有進行中的案件。</p>') +
        `<div class="mini" style="margin-top:10px">結案紀錄</div>` + (R.hist.length ? `<table class="rep"><tr><th>案件</th><th>服務單（勝／自動）</th><th>陣亡</th><th>收入</th></tr>` + R.hist.slice(0, 30).map(c => `<tr><td>${esc(c.title)}${c.delivered !== undefined ? ` <span class="mini">送達 ${Math.round(c.delivered * 100)}%</span>` : ''}</td><td>${c.tickets}（${c.wins}／${c.auto}）</td><td>${c.dead || ''}</td><td>${c.own ? '<span class="muted">—</span>' : money(c.income + c.upkeep)}</td></tr>`).join('') + '</table>' : '<p class="muted">還沒有結案。</p>'); },
    // 名氣（Alan 2026-10-10）：每一筆怎麼來的
    fame: () => { const FR = GV.retainer || {fameLog: []}, KN = {camp: '大戰役', front: '勢力戰', hunt: '據點', garrison: '駐守', route: '護送', shadow: '黑單', privateer: '私掠'};
      return `<div class="mini">名氣 <b>${FR.fame ?? 0}</b>・世界排行第 ${FR.rank ?? '-'}／${FR.of ?? '-'} 名（產地只找前 ${FR.topN ?? '-'} 名）・成功的單子：規模 × 威脅（等級 × 實際碰到的敵人戰力）× 貢獻（自己的積分佔全案的比例）；違約、黑單曝光扣 ${60}</div>` +
        (FR.fameLog?.length ? `<table class="rep"><tr><th>時間</th><th>案件</th><th>規模</th><th>威脅</th><th>貢獻</th><th>名氣</th></tr>` + FR.fameLog.map(e => `<tr><td>${day(e.h)}</td><td>${esc(e.title)}</td><td>${e.base != null ? `${KN[e.kind] || e.kind} ${e.base}` : ''}</td><td>${e.threat != null ? `${'●'.repeat(e.lv)}×${(e.threat / e.lv).toFixed(2)}（敵 ${e.pow}）` : ''}</td><td>${e.share != null ? Math.round(e.share * 100) + '%' : ''}</td><td>${money(e.fame).replace(/k</, '<')}</td></tr>`).join('') + '</table>' : '<p class="mini muted">還沒有。結案拿到尾款就會記上。</p>'); },
    // 派系關係（Alan 2026-10-11）：每個勢力對你的觀感與統治者性格
    rel: () => { if (!GV.rel) return '<p class="mini muted">沒有資料。</p>'; const TN = {好戰: '好戰', 結盟: '重盟約', 機會: '機會主義', 守成: '守成', 均衡: '均衡', 擴張: '擴張', 多疑: '多疑', 重商: '重商', 記仇: '記仇'};
      return `<div class="mini">${GV.relRefuse} 以下不跟你往來；黑單要名氣夠、或跟雇主 ${GV.relBlack} 以上</div><table class="rep"><tr><th>勢力</th><th>統治者</th><th>關係</th></tr>` +
        GV.rel.slice().sort((a, b) => b.v - a.v).map(r => `<tr><td>${esc(r.n)}</td><td>${TN[r.trait] || ''}</td><td>${money(r.v).replace(/k</, '<')}</td></tr>`).join('') + '</table>' +
        (GV.relLog?.length ? `<div class="mini" style="margin-top:10px">最近的變化</div><table class="rep"><tr><th>時間</th><th>勢力</th><th>原因</th><th>變化</th></tr>` + GV.relLog.slice(0, 30).map(e => `<tr><td>${day(e.h)}</td><td>${esc(e.n)}</td><td>${esc(e.why)}</td><td>${money(e.v).replace(/k</, '<')}</td></tr>`).join('') + '</table>' : ''); },
    people: () => { const al = GV.roster.filter(c => c.alive), byC = {}; for (const c of al) byC[c.cls] = (byC[c.cls] || 0) + 1;
      const lv = {}; for (const c of al) lv[c.lv || 1] = (lv[c.lv || 1] || 0) + 1;
      return `<table class="rep"><tr><th>項目</th><th>人數</th></tr>` + Object.entries(byC).map(([k, n]) => `<tr><td>${CLS[k].n}</td><td>${n}</td></tr>`).join('') +
        `<tr><td>金冠</td><td>${al.filter(c => c.crown === 'gold').length}</td></tr><tr><td>銀冠</td><td>${al.filter(c => c.crown === 'silver').length}</td></tr><tr><td>錫冠</td><td>${al.filter(c => c.crown === 'tin').length}</td></tr><tr><td>鉛冠</td><td>${al.filter(c => c.crown === 'lead').length}</td></tr><tr class="tot"><td>活著</td><td>${al.length}</td></tr><tr><td class="muted">已除名</td><td>${GV.roster.length - al.length}</td></tr></table>` +
        `<div class="mini" style="margin-top:10px">等級分布</div><table class="rep"><tr><th>等級</th><th>人數</th></tr>` + Object.entries(lv).sort((a, b) => b[0] - a[0]).map(([k, n]) => `<tr><td>${k} 級</td><td>${n}</td></tr>`).join('') + '</table>'; },
  };
  el.innerHTML = `<div class="chips reptabs">${REP_TABS.map(([k, n]) => `<button class="chip${k === repTab ? ' on' : ''}" data-rtab="${k}">${n}</button>`).join('')}</div><div style="margin-top:8px">${sec[repTab]()}</div>`;
  el.onclick = e => { const pb = e.target.closest('[data-rper]'); if (pb) { repPeriod = pb.dataset.rper; renderRep(); return; } const b = e.target.closest('[data-rtab]'); if (!b) return; repTab = b.dataset.rtab; try { localStorage.setItem('chimera.repTab', repTab); } catch {} renderRep(); };
}
function sparkSvg(D, W = 320, H = 120) {
  if (!D || D.length < 2) return '<p class="muted" style="margin:6px 0">過一天之後就會畫出來。</p>';
  const pl = 40, pr = 6, pt = 8, pb = 18, v = D.map(d => d.cash), lo = Math.min(0, ...v), hi = Math.max(...v, 1);
  const X = i => pl + (W - pl - pr) * i / (D.length - 1), Y = c => pt + (H - pt - pb) * (1 - (c - lo) / (hi - lo || 1));
  const pts = D.map((d, i) => `${X(i).toFixed(1)},${Y(d.cash).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" style="height:${H}px" role="img" aria-label="現金走勢" data-w="${W}">
    <line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)" stroke-width="1"/>
    <text x="${pl - 4}" y="${Y(hi) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(hi)}k</text>
    <text x="${pl - 4}" y="${Y(lo) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(lo)}k</text>
    <text x="${pl}" y="${H - 4}" font-size="10" fill="var(--muted)">第 ${Math.round(D[0].h / 24)} 天</text><text x="${W - pr}" y="${H - 4}" text-anchor="end" font-size="10" fill="var(--muted)">第 ${Math.round(D[D.length - 1].h / 24)} 天</text>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <line class="xh" x1="0" x2="0" y1="${pt}" y2="${H - pb}" stroke="var(--muted)" stroke-width="1" visibility="hidden" vector-effect="non-scaling-stroke"/></svg><div class="tt" hidden></div>`;
}
$('pane-co').addEventListener('pointermove', e => {
  const box = e.target.closest('#co-spark'); if (!box || !GV) return; const svg = box.querySelector('svg'); if (!svg) return;
  const D = GV.report.daily, r = svg.getBoundingClientRect(), W = +svg.dataset.w, iw = W - 46, fx = (e.clientX - r.left) / r.width * W, i = Math.max(0, Math.min(D.length - 1, Math.round((fx - 40) / iw * (D.length - 1))));
  const x = 40 + iw * i / (D.length - 1), tt = box.querySelector('.tt'), xh = svg.querySelector('.xh');
  xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
  tt.hidden = false; tt.textContent = `第 ${Math.round(D[i].h / 24)} 天　$${D[i].cash}k　活著 ${D[i].alive}`; tt.style.left = Math.min(r.width - tt.offsetWidth, Math.max(0, x / W * r.width - tt.offsetWidth / 2)) + 'px'; tt.style.top = '0px';
});
$('pane-co').addEventListener('pointerleave', () => { const b = $('co-spark'); if (b) { const tt = b.querySelector('.tt'); if (tt) tt.hidden = true; b.querySelector('.xh')?.setAttribute('visibility', 'hidden'); } }, true);

// ───── 兩頁切換：上方按鈕，或左右滑 ─────
let page = 'map';
// 分頁（Alan 2026-10-09）：戰略地圖｜任務管制（原「公司」）｜培養槽｜交易｜報表
// 上方分頁整併（Alan 2026-10-14）：主選單・戰略地圖・任務管制・行動・部隊（名冊｜培養槽｜裝備）・公司（基地｜交易｜報表）。
// 子分頁還是各自一頁（PAGES 的順序就是疊的順序），上方按「部隊」「公司」回到上次看的那個子分頁
const PAGES = ['home', 'map', 'co', 'ops', 'roster', 'vat', 'store', 'rover', 'trade', 'rep'];
const GROUPS = {force: [['roster', '名冊'], ['vat', '培養槽'], ['store', '裝備']], corp: [['rover', '基地'], ['trade', '交易'], ['rep', '報表']]};
const groupOf = p => Object.keys(GROUPS).find(g => GROUPS[g].some(([k]) => k === p)) || p;
const lastSub = (() => { try { return JSON.parse(localStorage.getItem('chimera.sub') || '{}'); } catch { return {}; } })();
for (const [g, L] of Object.entries(GROUPS)) for (const [k] of L) { const sec = $('page-' + k); if (!sec) continue;
  const nav = document.createElement('nav'); nav.className = 'subtabs'; nav.innerHTML = L.map(([k2, n]) => `<button data-sub="${k2}" class="${k2 === k ? 'on' : ''}">${n}</button>`).join(''); sec.prepend(nav);
  nav.onclick = e => { const b = e.target.closest('[data-sub]'); if (b) showPage(b.dataset.sub); }; }
function renderPage() {
  if (page === 'home') renderHome(); else if (page === 'ops') renderOpsPage(); else if (page === 'co') renderCo(); else if (page === 'vat') renderVat(); else if (page === 'store') renderStore(); else if (page === 'trade') renderTrade(); else if (page === 'rover') renderRover(); else if (page === 'rep') renderRepPage();
  renderRoster();
}
function showPage(p) {
  if (GROUPS[p]) p = GROUPS[p].some(([k]) => k === lastSub[p]) ? lastSub[p] : GROUPS[p][0][0];
  const g = groupOf(p); if (GROUPS[g]) { lastSub[g] = p; try { localStorage.setItem('chimera.sub', JSON.stringify(lastSub)); } catch {} }
  page = p; const at = PAGES.indexOf(p);
  // 分頁一層一層疊（Alan 2026-10-09）：右邊的疊在左邊的上面，每層往右縮一點，看得到下面幾層的邊；比現在這頁右邊的先收到畫面外
  for (const [i, el] of [...$('track').children].entries()) { el.classList.toggle('above', i > at); el.classList.toggle('under', i < at);
    // 同一組的子分頁：只有現在看的（或那一組上次看的）那頁參與疊層，其他的藏起來，組內切換不滑動
    const k = el.id.replace(/^page-/, ''), gk = groupOf(k), sib = GROUPS[gk] && k !== (gk === g ? p : lastSub[gk] || GROUPS[gk][0][0]);
    el.classList.toggle('sib', !!sib); if (sib) el.classList.remove('above', 'under'); }
  for (const b of document.querySelectorAll('.pager button')) b.classList.toggle('on', b.dataset.page === g);
  if (p === 'map') { draw(); renderRoster(); } else renderPage();
}
for (const b of document.querySelectorAll('.pager button')) b.onclick = () => showPage(b.dataset.page);
// 一開始就把地圖以外的分頁收到右邊（單人測試模式不會經過 showPage，其他分頁會蓋在地圖上）
for (const [i, el] of [...$('track').children].entries()) el.classList.toggle('above', i > PAGES.indexOf(page));
let swipe = null;
$('pages').addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { swipe = null; return; }
  const t = e.touches[0], el = e.target;
  if (el.closest('input,select,textarea,.tabs,.hscroll')) { swipe = null; return; }
  // 在可以左右捲動的東西上（寬的報表等）滑動是捲動，不是換分頁（Alan 2026-10-11）
  for (let n = el; n && n !== document.body; n = n.parentElement) { const ox = getComputedStyle(n).overflowX; if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 2) { swipe = null; return; } }
  const edge = t.clientX < 28 || t.clientX > innerWidth - 28;
  if (el.closest('#map') && !edge) { swipe = null; return; }
  swipe = {x: t.clientX, y: t.clientY, at: Date.now()};
}, {passive: true});
$('pages').addEventListener('touchend', e => {
  if (!swipe) return; const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y; const ok = Date.now() - swipe.at < 800; swipe = null;
  if (!ok || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
  const order = PAGES, i = order.indexOf(page), j = i + (dx < 0 ? 1 : -1);
  if (j >= 0 && j < order.length) showPage(order[j]);
}, {passive: true});

const sg = v => (v > 0 ? '+' : '') + v;
function rePicker(room) {
  const av = GV.roster.filter(c => c.alive && c.status === 'home' && !c.keep);
  return `<div class="picker confirm"><div class="mini">契約變更：從基地調人補這一隊，雇主不另付錢。還能補 ${room} 人；坐一台運兵車過去（剩 ${Math.max(0, vanFree())} 台；基地在現場就直接走過去），路上可能遇襲。打輸太多或放著不打，雇主會拒絕。</div><div class="chips">${av.map(c => chip(c, pickRe.uids.has(c.uid), 'rp')).join('') || '<span class="muted">基地上沒有待命的人</span>'}</div>
    <div class="row"><button class="primary" data-act="re-go">送出契約變更（${pickRe.uids.size} 人）</button><button data-act="re-x">取消</button></div></div>`;
}
function renderOdds() { if (!$('co-odds')) return; const o = classOdds(recipe); $('co-odds').innerHTML = Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${CLS[k].n} ${Math.round(v * 100)}%</span>`).join(''); }
const coPanes = ['pane-co', 'pane-roster', 'pane-vat', 'pane-store', 'pane-trade', 'pane-rover', 'drawer', 'pcard'].map($);
for (const el of coPanes) el.addEventListener('change', e => { const f = e.target.dataset.pf; if (!f || !procSel) return; procSel[f] = f === 'qty' ? Math.max(10, +e.target.value || 0) : e.target.value; renderProc(); });
for (const el of coPanes) el.addEventListener('input', e => { const m = e.target.dataset.rc; if (!m) return; const r = e.target.dataset.vat != null ? vatRecipe(+e.target.dataset.vat) : recipe; r[m] = Math.max(0, +e.target.value || 0); renderOdds(); });
// 配方輸入框打完（離開焦點）才重畫培養槽，機率跟著更新
$('pane-vat').addEventListener('focusout', () => setTimeout(() => { if (page === 'vat') renderVat(); }, 0));
// 服務單的「親自打」「現在自動結算」在按下去那一刻就送出：公司時間跑得快時清單每秒重畫好幾次，
// 按下與放開落在不同的按鈕上就不會有 click（2026-10-08 Alan 回報：按了親自打一直沒反應）
for (const pane of ['pane-co', 'pane-rover']) $(pane).addEventListener('pointerdown', e => {   // Rover 分頁的遭遇也是這兩顆（Alan 2026-10-12 抓到：Rover 分頁上按了沒反應）
  const b = e.target.closest('[data-act="fight"],[data-act="resolve"]'); if (!b || e.button !== 0) return;
  e.preventDefault(); const id = b.dataset.id;
  if (b.dataset.act === 'fight') { send({type: 'fight', ticket: id}); showMissionLoading(); } else send({type: 'resolve', ticket: id});
});
const coClick = e => {
  if (e.target.closest('#drawbar')) { drawerOpen = !drawerOpen; renderRoster(); return; }
  const go = e.target.closest('[data-goto]'); if (go) { e.preventDefault(); drawerOpen = false; showPage(go.dataset.goto); return; }
  const gs = e.target.closest('[data-gslot]'); if (gs) { gearPick = gearPick?.slot === gs.dataset.gslot ? null : {uid: personSel, slot: gs.dataset.gslot}; renderRoster(); return; }
  if (e.target.closest('[data-eqx]')) { gearPick = null; renderRoster(); return; }
  const eq = e.target.closest('[data-eq]'); if (eq && gearPick) { const pc = GV.roster.find(x => x.uid === gearPick.uid);
    send(pc?.field ? {type: 'fieldEquip', squad: pc.field, uid: gearPick.uid, slot: gearPick.slot, item: eq.dataset.eq || null} : {type: 'equip', uid: gearPick.uid, slot: gearPick.slot, item: eq.dataset.eq || null}); gearPick = null; return; }
  const sl = e.target.closest('[data-sell]'); if (sl) { send({type: 'sell', item: sl.dataset.sell}); return; }
  const sf = e.target.closest('[data-sf]'); if (sf) { const [k, v] = sf.dataset.sf.split(/:(.+)/); storeF[k] = storeF[k] === v && k !== 'sort' && k !== 'kind' ? (k === 'affix' || k === 'base' ? '' : v) : v; if (k === 'kind') { storeF.base = ''; storeF.affix = ''; } saveStoreF(); renderStore(); return; }   // 庫存的篩選、排序
  const mp = e.target.closest('[data-modpick]'); if (mp) { modPick = modPick === mp.dataset.modpick ? null : mp.dataset.modpick; renderStore(); return; }
  if (e.target.closest('[data-modx]')) { modPick = null; renderStore(); return; }
  const md = e.target.closest('[data-mod]'); if (md) { const [item, affix] = md.dataset.mod.split(':'); send({type: 'mod', item, affix}); modPick = null; return; }
  const sh = e.target.closest('[data-shop]'); if (sh) { const [kind, base] = sh.dataset.shop.split(':'); send({type: 'shop', kind, base}); return; }
  if (e.target.id === 'pcard') { personSel = null; gearPick = null; renderRoster(); return; }   // 點卡片外面
  const rpo = e.target.closest('[data-rpopen]'); if (rpo) { const r = (GV.reports || []).find(x => x.id === rpo.dataset.rpopen); if (r) showReport(r); return; }
  const ps = e.target.closest('[data-person]'); if (ps) { gearPick = null; personSel = ps.dataset.person === '' ? null : +ps.dataset.person; renderRoster(); return; }
  const st = e.target.closest('[data-rcd]'); if (st) { const r = vatRecipe(+st.dataset.vat), m = st.dataset.m; r[m] = Math.max(GCFG.MIN, Math.min(GCFG.MAX, (r[m] || 0) + +st.dataset.rcd)); renderVat(); return; }
  if (recallClick(e)) return;
  // 集合點（Alan 2026-10-12）：點了跳到戰略地圖、選取那一格（格子面板有「基地開到這裡」）
  const mpk = e.target.closest('[data-mappick]'); if (mpk) { e.preventDefault(); showPage('map'); select(+mpk.dataset.mappick, true); return; }
  const c = e.target.closest('[data-center]'); if (c && !e.target.closest('button')) { e.preventDefault(); select(+c.dataset.center, true, true); return; }
  const f = e.target.closest('[data-found]'); if (f) { found(+f.dataset.found); return; }
  const r = e.target.closest('[data-rf]'); if (r) { rosterF = r.dataset.rf; renderRoster(); return; }
  const p = e.target.closest('[data-rp]'); if (p) { const u = +p.dataset.rp; pickRe.uids.has(u) ? pickRe.uids.delete(u) : pickRe.uids.add(u); renderCo(); return; }
  const q = e.target.closest('[data-qt]'); if (q) { const t = +q.dataset.qt; procSel = procSel && procSel.t === t ? null : {t, mat: '', qty: 100, uids: new Set()}; renderProc(); return; }
  const pu = e.target.closest('[data-pu]'); if (pu) { const u = +pu.dataset.pu; procSel.uids.has(u) ? procSel.uids.delete(u) : procSel.uids.add(u); renderProc(); return; }
  const b = e.target.closest('[data-act]'); if (!b) return; const A = b.dataset.act, id = b.dataset.id;
  if (A === 'qt-refresh') { QT = null; renderProc(); send({type: 'quotes'}); return; }
  if (A === 'proc-x') { procSel = null; renderProc(); return; }
  if (A === 'proc-go') { send({type: 'procure', town: procSel.t, mat: procSel.mat, qty: procSel.qty, uids: [...procSel.uids]}); procSel = null; setTimeout(() => send({type: 'quotes'}), 50); return; }
  if (A === 'buy') send({type: 'buy', mat: b.dataset.mat, qty: +b.dataset.q});
  else if (A === 'build') { const i = b.dataset.vat != null ? +b.dataset.vat : null, r = i != null ? vatRecipe(i) : recipe; Object.assign(recipe, r); send({type: 'build', recipe: {...r}, slot: i}); }
  else if (A === 'tpl') send({type: 'build', tpl: id});
  else if (A === 'claim') { revealAfter = GV.fresh ?? null; send({type: 'claim', slot: +b.dataset.vat}); }
  else if (A === 'keep') send({type: 'keep', uid: +id});
  else if (A === 'tag') send({type: 'tag', uid: +id, tag: b.dataset.tag});
  else if (A === 'outfit') send({type: 'outfit', uid: +id, id: b.dataset.o});
  else if (A === 'sellbody') { const c = GV.roster.find(x => x.uid === +id); if (c && confirm(`賣掉 ${who(c)} ${c.id} 的遺體，$${b.dataset.p}k？\n賣掉之後就不能再重新培養了。`)) send({type: 'sellbody', uid: +id}); }
  else if (A === 'talent') { const c = GV.roster.find(x => x.uid === +id), o = TALENTS[c?.cls]?.rows[+b.dataset.row]?.[+b.dataset.k]; if (o && confirm(`替 ${who(c)} ${c.id} 選「${o.n}」？\n${o.text}\n\n選了就不能改。`)) send({type: 'talent', uid: +id, row: +b.dataset.row, k: +b.dataset.k}); }
  else if (A === 'callsign') { const c = GV.roster.find(x => x.uid === +id), v = prompt('綽號（最多 8 個字；清空就拿掉）', c?.callsign || ''); if (v !== null) send({type: 'callsign', uid: +id, name: v}); }
  else if (A === 'revive') send({type: 'revive', uid: +id});
  else if (A === 'clean') send({type: 'clean', tile: +id});
  else if (A === 'callgar') send({type: 'answer', call: id, squad: b.dataset.sq});
  else if (A === 'ungar') send({type: 'ungarrison', squad: id});
  else if (A === 'rethide') send({type: 'retHide', id});
  // 基地（Alan 2026-10-12；原本的 Rover）
  else if (A === 'basego') baseGoAsk(+id);
  else if (A === 'basestop') roverSend({type: 'baseStop'}, '基地停下');
  else if (A === 'baseup') roverSend({type: 'baseUpgrade', kind: id}, '基地升級');
  else if (A === 'basejob') roverSend({type: 'baseJob', id}, '在地小事');
  else if (A === 'basesearch') roverSend({type: 'baseSearch'}, '基地開始搜索');
  else if (A === 'basevan') { if (confirm('買一台運兵車？同時可以多派一隊出去。')) roverSend({type: 'buyVan'}, '買運兵車'); }
  else if (A === 'baseregister') { if (confirm(`公司登記換到${ST.names?.[GV.hq.tile] || '這裡'}？\n\n之後算是這裡的勢力的公司（跟誰打仗、能不能接哪一邊的委託、簽長約都照這裡）。$${GV.hq.regCost}k，一季只能換一次。`)) roverSend({type: 'register'}, '換登記'); }
  else if (A === 'deal') { const d = (GV.world?.deals || []).find(x => x.id === id); if (d && confirm(`搶購：${d.title}？`)) roverSend({type: 'deal', id}, '搶購'); }
  else if (A === 'note' || A === 'say') { const inp = $(A === 'note' ? 'noteIn' : 'sayIn'); const t = inp?.value.trim(); if (t) { send({type: A, text: t}); inp.value = ''; } }
  else if (A === 'ungarall') { if (confirm('撤回這個產地所有不在護送中的駐軍？')) for (const sq of id.split(',')) send({type: 'ungarrison', squad: sq}); }
  else if (A === 'callpick' || A === 'garpick') {
    const c = (GV.retainer?.mine || []).find(x => A === 'garpick' ? x.site === +id : x.calls.some(q => q.id === id)), q = c?.calls.find(x => x.id === id); if (!c) return;
    sortie = {key: 'custom', tile: c.site, side: '', fast: false, sq: [[null, null, null, null]], pick: null, open: new Set(), custom: A === 'garpick'
      ? {kind: 'retainer', lv: 3, tile: c.site, title: `派人駐紮：${b.dataset.nm}`, detail: '駐軍在產地待命，每天每人駐紮費 $1.5k；應召時限到了還沒派，就從駐軍隨機拉一隊。', go: uids => send({type: 'garrison', site: c.site, uids})}
      : {kind: 'retainer', lv: 3, tile: c.site, title: `長約應召：${q.g}車隊往${q.to}`, detail: `從基地坐一台運兵車出發，一隊（最多四人）`, go: uids => send({type: 'answer', call: q.id, uids})}};
    renderSortie();
  }
  else if (A === 'merge') { if (confirm('合成之後，被吃掉的那一位就不在了。確定？')) send({type: 'merge', keep: +id, feed: +b.dataset.feed}); }
  else if (A === 'resolve' || A === 'fight') return;   // 上面 pointerdown 已經送出
  else if (A === 're') { pickRe = {squad: id, uids: new Set()}; renderCo(); }
  else if (A === 're-go') { send({type: 'reinforce', squad: pickRe.squad, uids: [...pickRe.uids]}); pickRe = null; }
  else if (A === 're-x') { pickRe = null; renderCo(); }
};
for (const el of coPanes) el.addEventListener('click', coClick);

$('legend').innerHTML = '<span>機會：</span>' + Object.values(OK).map(v => `<span style="color:${v.c}">${v.ch} ${v.n}</span>`).join('') + '<span style="flex-basis:100%;height:0"></span>' + '<span><i style="background:#f1e6cf;border-radius:50%"></i>市鎮</span><span>★ 首府</span><span><i style="background:#6fd0d8;transform:rotate(45deg) scale(.8)"></i>培養槽</span><span><i style="background:#d9b86a"></i>廠區</span><span style="color:#ff5a3c">━ 戰線</span><span style="color:#c4593c">✕ 掠奪者</span><span style="color:#e0915a">▲ 原住民</span>';

const seed0 = new URL(location).searchParams.get('seed') || '奇美拉-1';
$('seed').value = seed0;

/* ───────── 標題畫面（伺服器模式）：Google 登入或訪客，連上之前蓋住整個頁面 ───────── */
let AUTH = {clientId: '', gsi: false}, entering = false;
async function showTitle(msg) {
  if (worker) { worker.terminate(); worker = null; }
  entering = false; $('title').hidden = false; $('enterBtn').disabled = false;
  $('titleMsg').hidden = !msg; $('titleMsg').textContent = msg || '';
  let hello = null;
  try { const r = await fetch('/api/hello', {headers: authHeaders()}); hello = await r.json(); if (r.status === 401) { signOut(); hello = await (await fetch('/api/hello', {headers: authHeaders()})).json(); } } catch { $('titleMsg').hidden = false; $('titleMsg').textContent = '連不上伺服器，稍後再試'; }
  AUTH.clientId = hello?.clientId || '';
  AUTH.hello = hello; renderAcct(hello);
  if (AUTH.clientId && !AUTH.gsi && !account()) await loadGsi();
}
// 畫面處理伺服器資料時出錯（Alan 2026-10-10：進遊戲卡在「連線中」查不出原因）：寫在標題畫面上，並回報給伺服器（後台看得到）
function reportError(err, where) {
  console.error(err);
  const text = `畫面出錯（${where || '?'}）：${err?.message || err}`;
  if (entering || !$('title').hidden) showTitle(text); else toast(text);
  try { fetch('/api/clientlog', {method: 'POST', headers: {...authHeaders(), 'content-type': 'application/json'}, body: JSON.stringify({where, msg: String(err?.message || err), stack: String(err?.stack || '').slice(0, 1500), ua: navigator.userAgent.slice(0, 200), href: location.href})}); } catch {}
}
addEventListener('error', e => { if (e.error) reportError(e.error, 'window'); });
addEventListener('unhandledrejection', e => reportError(e.reason, 'promise'));
function hideTitle() { $('title').hidden = true; entering = false; }
function renderAcct(hello) {
  const email = account(), note = $('acctNote'), co = hello?.company;
  $('gsiBtn').innerHTML = ''; note.innerHTML = '';
  if (email) {
    note.append(`已用 ${email} 登入。`, Object.assign(document.createElement('a'), {textContent: '登出', onclick: () => { signOut(); showTitle(); }}));
    $('enterBtn').textContent = co ? `進入「${co}」` : '進入星球';
  } else {
    if (AUTH.gsi) google.accounts.id.renderButton($('gsiBtn'), {theme: 'filled_black', text: 'signin_with', shape: 'pill', locale: 'zh-TW'});
    note.textContent = AUTH.clientId ? '用 Google 登入，換手機或電腦都能接著經營同一家公司。也可以不登入，用這個瀏覽器當訪客。' : '目前只能用訪客身分（這個瀏覽器）。';
    $('enterBtn').textContent = co ? `以訪客身分進入「${co}」` : '以訪客身分進入';
  }
}
async function loadGsi() {
  await new Promise(ok => { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = ok; sc.onerror = ok; document.head.append(sc); });
  if (!window.google?.accounts?.id) return;
  google.accounts.id.initialize({client_id: AUTH.clientId, callback: onGoogle, ux_mode: 'popup'});
  AUTH.gsi = true; if (!account()) renderAcct(AUTH.hello);
}
async function onGoogle(resp) {
  try {
    const r = await fetch('/api/auth/google', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({credential: resp.credential, legacy: guestToken()})});
    const d = await r.json(); if (!r.ok) throw new Error(d.error || '登入失敗');
    signedIn(d.session, d.email);
    enter();
    if (d.moved) setTimeout(() => toast(`這個瀏覽器原本的「${d.moved}」已經綁到你的 Google 帳號上`), 1500);
  } catch (e) { $('titleMsg').hidden = false; $('titleMsg').textContent = e.message; }
}
function enter() {
  if (entering) return; entering = true;
  $('enterBtn').disabled = true; $('enterBtn').textContent = '連線中…'; $('titleMsg').hidden = true;
  start(seed0);
}
$('enterBtn').onclick = enter;
// 系統選單（Alan 2026-10-09：左上不再顯示標題；帳號、開發日誌、回標題畫面等收在這裡）
// 畫面濾鏡（Alan 2026-10-09：沿用 ASH 的 VHS、色差效果）。預設開；同一個設定也給戰鬥用（ASH 讀 ash-vhs）
let vhsOn = true; try { vhsOn = localStorage.getItem('chimera-vhs') !== 'off'; } catch {}
function applyVhs() { document.documentElement.classList.toggle('vhs', vhsOn); try { localStorage.setItem('chimera-vhs', vhsOn ? 'on' : 'off'); localStorage.setItem('ash-vhs', vhsOn ? 'on' : 'off'); } catch {} }
applyVhs();
// 版本號（2026-10-15）：放在 manifest.webmanifest 的 version，標題畫面和 ⚙ 系統顯示
let APP_VERSION = '';
fetch('manifest.webmanifest', {cache: 'no-store'}).then(r => r.json()).then(j => { APP_VERSION = j.version || ''; if ($('appVer')) $('appVer').textContent = APP_VERSION ? `v${APP_VERSION}` : ''; }).catch(() => {});
const isApp = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
function openSys() {
  const email = account(), co = GV?.name;
  $('sysBody').innerHTML = `<p class="mini">${LOCAL ? '單人測試模式' : email ? `已用 ${esc(email)} 登入` : '訪客（這個瀏覽器）'}${co ? `・公司：${esc(co)}` : ''}</p>
    <button data-sys="devlog">開發日誌</button>
    <button data-sys="vhs">畫面濾鏡（VHS）：${vhsOn ? '開' : '關'}</button>
    ${LOCAL ? '' : '<button data-sys="watch">觀看世界生成</button>'}
    ${LOCAL ? '' : '<button data-sys="title">回標題畫面</button>'}
    ${!LOCAL && email ? '<button data-sys="logout">登出</button>' : ''}
    <p class="mini muted">版本 ${esc(APP_VERSION || '—')}${isApp() ? '・主畫面捷徑（全螢幕）' : ''}</p>`;
  $('sys').hidden = false;
}
$('sysBtn').onclick = e => { e.stopPropagation(); $('mail').hidden = true; openSys(); };
$('sysClose').onclick = () => $('sys').hidden = true;
$('sys').onclick = e => {
  if (e.target.id === 'sys') { $('sys').hidden = true; return; }
  const b = e.target.closest('[data-sys]'); if (!b) return; if (b.dataset.sys !== 'vhs') $('sys').hidden = true;
  if (b.dataset.sys === 'vhs') { vhsOn = !vhsOn; applyVhs(); openSys(); return; }
  if (b.dataset.sys === 'devlog') devlog();
  else if (b.dataset.sys === 'watch') location.href = '/?watch&seed=' + encodeURIComponent(worker?.hello?.seed || seed0);
  else if (b.dataset.sys === 'title') { if (!mission) showTitle(); }
  else if (b.dataset.sys === 'logout') { signOut(); showTitle(); }
};

/* ───────── 開發日誌（changelog.json） ───────── */
async function devlog() {
  let log = []; try { log = await (await fetch('changelog.json', {cache: 'no-store'})).json(); } catch {}
  $('devlogBody').innerHTML = log.length ? log.map(d => `<h3>${esc(d.date)}</h3>` + d.items.map(t => `<p>・${esc(t)}</p>`).join('')).join('') : '<p class="muted">暫時沒有開發日誌。</p>';
  $('devlog').hidden = false;
}
$('devlogBtn').onclick = devlog;

/* ───────── 戰鬥測試場（開發用，網址加 ?arena）：開一場隨機的伺服器戰鬥，打完不結算、不影響公司 ───────── */
if (!LOCAL && new URL(location).searchParams.has('arena')) $('arenaBox').hidden = false;
async function arena() {
  const btn = $('arenaGo'); btn.disabled = true; btn.textContent = '開戰中…';
  try {
    const r = await fetch('/api/arena', {method: 'POST', headers: {...authHeaders(), 'content-type': 'application/json'}, body: JSON.stringify({size: +$('arenaSize').value, map: +$('arenaMap').value, night: $('arenaNight').checked || null, boss: $('arenaBoss').checked, mode: $('arenaMode').value, type: $('arenaType').value, biome: $('arenaBiome').value, side: $('arenaSide').value, defeats: +$('arenaDefeats').value, veh: $('arenaVeh').checked})});
    const tk = await r.json(); if (!r.ok) throw new Error(tk.error || '開戰失敗');
    const E = await ash; hideTitle(); mission = {id: tk.id, arena: true}; await launch(E, tk);
  } catch (e) { $('titleMsg').hidden = false; $('titleMsg').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = '開一場測試戰鬥'; }
}
$('arenaGo').onclick = arena;
$('devlogClose').onclick = () => $('devlog').hidden = true;
$('devlog').onclick = e => { if (e.target.id === 'devlog') $('devlog').hidden = true; };
if (LOCAL) { $('title').hidden = true; start(seed0); if (WATCH) { tab('log'); setPanel(false); } } else showTitle();
window.addEventListener('resize', () => { if (page !== 'map' && page !== 'rep' && GV) renderPage(); if (page === 'rep') { const P = $('pane-rep'); P.innerHTML = ''; renderRepPage(); } });

// ===== 親自打：ASH 的任務戰鬥直接跑在這個頁面裡（不用 iframe；public/ash/chimera-boot.js，由 chimera/ash/build.mjs 建置）。
// 頁面一打開就在背景把 ASH 載好（#ash-root 平常藏著）；每張票用 ASH_EMBED.start 換一場新的戰鬥，不重新初始化。
// 打完傳回 {win, dead}，交給 worker 的 submit；按「先不打」票還在。打的時候公司的時間停住。
let mission = null;
const ash = import('./ash/chimera-boot.js').then(m => m.bootAsh()).then(E => {
  // 伺服器上的戰鬥由伺服器自己結算，這裡只要更新畫面；單人測試模式把戰果交給背景的核心
  E.onresult = (id, result) => { if (mission && mission.id === id) { if (mission.arena) showTitle('測試戰鬥打完了（不結算）'); else if (result?.server) { settling = id; setTimeout(() => { if (settling === id) syncChip('busy'); }, 1500);   // 打完一下子就結算好的不出標籤；還在跑才出完整的「簽核中」
      for (const t of [0, 3000, 8000, 15000, 30000, 60000]) setTimeout(() => worker?.poll?.(), t); setTimeout(() => { if (settling === id && !syncShown) return; if (settling === id) { syncEl.className = 'retry'; syncEl.innerHTML = '<i class="spin"></i>簽核比平常久，重新整理頁面看看'; } }, 65000); } else send({type: 'submit', ticket: id, result}); mission = null; } };   // 伺服器結算可能要一點時間：多拉幾次（2026-10-14）
  // 先不打：伺服器上的戰鬥留在伺服器，下次按親自打接著打；單人測試模式要讓時間恢復
  E.onSync = (state, n) => syncChip(state, n);   // 打的時候伺服器驗證輸入的狀態（chimera-entry.js uplink）
  E.onabort = id => { if (mission && mission.id === id) { if (mission.arena) showTitle(); else if (LOCAL) send({type: 'abort'}); mission = null; } };
  return E;
});
async function openMission(tk) { mission = {id: tk.id}; const E = await ash; await launch(E, tk); }
// 開戰：verify＝瀏覽器跑、伺服器驗證（接回時要先重播已送出的輸入，可能要幾秒，「載入中」那層等它跑完才拿掉）；authority＝伺服器跑；其他＝單人測試模式
async function launch(E, tk) {
  if (tk.mode === 'verify') { if (tk.log?.length) { showMissionLoading(`接回戰鬥中…（重播 ${tk.log.length} 個行動）`); await new Promise(r => setTimeout(r, 30)); } await E.startVerified(tk); }
  else if (tk.remote) E.startRemote(tk, tk.state); else E.start(tk);
  hideMissionLoading();
}
// ASH 還在背景載入時先蓋上一層「載入中」，按下去立刻有反應
let loadingBox = null;
function showMissionLoading(text) {
  if (window.ASH_EMBED?.renderer && !text) return;
  if (text) { hideMissionLoading(); loadingBox = Object.assign(document.createElement('div'), {id: 'mission-loading', innerHTML: `<b>${text}</b>`}); document.body.appendChild(loadingBox); return; }
  loadingBox ??= Object.assign(document.createElement('div'), {id: 'mission-loading', innerHTML: '<b>載入戰鬥中…</b><span>第一次開戰要先把戰鬥程式載好，公司的時間已經停住。</span>'});
  document.body.appendChild(loadingBox);
}
function hideMissionLoading() { loadingBox?.remove(); }
