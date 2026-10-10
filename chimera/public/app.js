// 奇美拉沙盒觀看頁：背景的 worker 一年一年推演，畫面照選好的速度播放；開了公司之後改用小時推進
import {CLS, MN, MATS, REVIVE_RECIPE, TAGS, classOdds, GCFG, GUNS, MELEES, ARMORS, KITS, SLOTS, slotKind, itemName, shopPrice, MOD_AFFIXES, AFFIX_NAMES, modCost, ARMOR_AFFIXES} from './company.js';
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
const OK = {exp: {n: '遠征', ch: '遠', c: '#7fc06a'}, short: {n: '缺貨', ch: '補', c: '#6fb4e0'}, tense: {n: '快開戰', ch: '壓', c: '#e7a14a'}, front: {n: '前線', ch: '戰', c: '#ff5a3c'}, route: {n: '危險商路', ch: '護', c: '#e0cf5a'}, lair: {n: '據點', ch: '剿', c: '#c98a6a'}, camp: {n: '大戰役', ch: '役', c: '#ff3020'}, logging: {n: '伐木', ch: '柴', c: '#9fbf5a'}, clean: {n: '清運', ch: '收', c: '#b49ad8'}};
let logFilter = 'legend';
let worker = null;

/* ───────── worker ───────── */
function start(seed) {
  if (worker) worker.terminate();
  worker = LOCAL ? new Worker('worker.js', {type: 'module'}) : new ServerLink();
  hist = []; allEvents = []; cur = 0; sel = -1; hiFac = -1; computing = true; GV = null; GM = null; coBuilt = false; $('pane-rep').innerHTML = ''; $('pane-trade').innerHTML = ''; mailSeen.clear(); mailFirst = true; $('mailBtn').hidden = WATCH; $('mail').hidden = true;   // 信封一直在（裡面有系統選單） QT = null; procSel = null; selPath = null; document.body.classList.remove('game'); $('gamebar').hidden = true;
  $('computing').hidden = false; $('computing').textContent = '生成地形…'; $('more').hidden = true;
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'static') { ST = m; fit(); }
    else if (m.type === 'year') {
      hist.push(m.data); for (const ev of m.data.events) allEvents.push(ev);
      $('slider').max = hist.length - 1; $('computing').textContent = `推演到第 ${m.data.y} 年…`;
      if (hist.length === 1) { cur = 0; renderAll(); if (LOCAL) setPlaying(true); }
      else if (GV) { cur = hist.length - 1; lastPanelY = -1; renderAll(); send({type: 'quotes'}); }
      if (!GV && page === 'co' && hist.length % 10 === 0) renderCo();
    } else if (m.type === 'idle') { computing = false; $('computing').hidden = true; $('more').hidden = WATCH; if (!LOCAL && !worker.company) { hideTitle(); showPage('co'); } }
    else if (m.type === 'relogin') { showTitle(m.text); }
    else if (m.type === 'chronicle') { allEvents = m.events; if (curTab() === 'log') renderLog(); }
    else if (m.type === 'game') { if (m.err) hideMissionLoading(); onGame(m); hideTitle(); }
    else if (m.type === 'mission') openMission(m.data);
    else if (m.type === 'error') { hideMissionLoading(); toast(m.text); }
    else if (m.type === 'path') { selPath = m; draw(); if (pickOpp) { renderOpp(); if (curTab() === 'tile' && sel >= 0) renderTile(); } }
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
    const bx = cx(GV.base), by = cy(GV.base);
    ctx.strokeStyle = '#6fd0d8'; ctx.lineWidth = Math.max(1.5, 2.4 / k); ctx.beginPath(); ctx.arc(bx, by, S0 * .9, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(bx, by, S0 * 1.15, 0, 7); ctx.stroke();
    for (const c of GV.cases) { if (c.settled) continue; const x = cx(c.tile), y = cy(c.tile), r = S0 * .85; ctx.strokeStyle = '#f1e6cf'; ctx.lineWidth = Math.max(1.4, 2 / k); ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke(); }
    // 選取的點：從總部沿實際道路拉一條虛線
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
      const col = u.kind === 'returning' ? '#a0c8aa' : u.kind === 'convoy' ? '#e0a64a' : u.kind === 'column' ? '#9fe3ea' : '#6fd0d8';
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
$('pane-tile').onclick = e => { if (recallClick(e)) return; const b = e.target.closest('[data-found]'); if (b) { found(+b.dataset.found); return; } const p = e.target.closest('[data-proc]'); if (p) { procSel = {t: +p.dataset.proc, mat: '', qty: 100, uids: new Set()}; showPage('trade'); send({type: 'quotes'}); } };
$('pane-fac').onclick = e => { const r = e.target.closest('.frow'); if (!r) return; const id = +r.dataset.f; hiFac = hiFac === id ? -1 : id; const f = hist[cur].fac.find(x => x.id === id); if (f && hiFac >= 0) centerOn(f.cap); draw(); };

function renderTile() {
  const s = hist[cur], i = sel; if (i < 0) { $('pane-tile').innerHTML = '<p class="muted">點地圖上的格子看細節。</p>'; return; }
  const F = facById(s), o = s.owner[i], t = s.towns.find(x => x.t === i), g = s.gangs.filter(x => x.lair === i);
  let html = `<h2>${esc(ST.names[i] || '無名之地')}</h2><dl class="kv"><dt>地形</dt><dd>${ST.biomes[s.biome[i]].n}${ST.river[i] ? '・有水脈' : ''}</dd><dt>屬於</dt><dd>${o >= 0 && F[o] ? esc(F[o].n) : '無主'}</dd>`;
  if (s.pop[i]) html += `<dt>人口</dt><dd>${s.pop[i]}</dd>`;
  if (s.trench[i]) html += `<dt>戰壕</dt><dd>${(s.trench[i] / 80).toFixed(1)} 級</dd>`;
  if (s.bandit[i] > 15) html += `<dt>掠奪者</dt><dd>${Math.round(s.bandit[i] / 2.55)}%</dd>`;
  if (i === s.arc.elevator) html += `<dt>地標</dt><dd>軌道電梯</dd>`;
  html += '</dl>';
  for (const o of curOpps(s).filter(o => o.tile === i)) { const K = OK[o.kind]; html += `<p style="border-left:3px solid ${K.c};padding-left:8px"><b style="color:${K.c}">${K.n} ${'●'.repeat(o.lv)}${'○'.repeat(3 - o.lv)}</b>　${esc(o.title)}<br><span class="muted">${esc(o.detail)}</span></p>`; }
  if (GV) { const here = (GV.units || []).filter(u => u.pos && (u.pos.f < .5 ? u.pos.a : u.pos.b) === i);
    if (here.length) html += `<h2 style="margin-top:10px">我的人馬</h2>` + here.map(u => `<div class="card"><b>${esc(u.name)}</b>${u.n ? ` <span class="mini">${u.n} 人</span>` : ''}<div class="mini">${esc(u.status)}${u.where ? '・' + esc(u.where) : ''}</div>${recallBtn(u)}</div>`).join(''); }
  if (GV && t && i !== GV.base) html += `<p><button data-proc="${i}">派車隊來這裡採購</button></p>`;
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
function accPicker(o) {
  const key = o.kind + ':' + o.tile; if (!GV) return '';
  if (o.clean) return `<div class="row" style="margin-top:4px"><button data-clean="${o.tile}">出車清運</button></div>`;
  // 大戰役（Alan 2026-10-09）：不限隊數、接了之後可以一再加派、撤軍不違約
  const camp = o.kind === 'camp', campNote = camp ? '<div class="mini">大戰役：派幾隊都可以，服務單一張接一張、越來越大；撤軍不算違約，已打下的貢獻照算。</div>' : '';
  if (!pickOpp || pickOpp.key !== key) return `${camp && !o.joined ? campNote : ''}<div class="row" style="margin-top:4px"><button data-acc="${key}">${o.joined ? '加派' : '接案'}</button></div>`;
  const s = hist[cur], fn = id => s.fac.find(f => f.id === id)?.n || '';
  const sides = o.joined ? [] : o.kind === 'front' || o.kind === 'camp' ? [['att', '替攻方 ' + fn(o.att)], ['def', '替守方 ' + fn(o.def)]] : o.kind === 'tense' ? [['a', '替 ' + fn(o.a)], ['b', '替 ' + fn(o.b)]] : [];
  const av = GV.roster.filter(c => c.alive && c.status === 'home' && !c.keep);
  return `<div class="picker">${campNote}${sides.length ? `<div class="row">${sides.map(([v, n]) => `<button data-side="${v}" class="${pickOpp.side === v ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>` : ''}
    <div class="mini" style="margin-top:6px">選要派的人（四人一隊，最少兩人${camp ? '；全部派上去也可以' : ''}）：</div>${pickGroups(av)}
    ${speedRow(o.tile, pickOpp.uids.size, pickOpp.fast)}
    <div class="row"><button class="primary" data-go="1">${pickOpp.fast ? '加速' : ''}出發（${pickOpp.uids.size} 人）</button><button data-cancel="1">取消</button></div></div>`;
}
// 加速（Alan 2026-10-09）：路程時間減半，每人每省一小時 $1；來回同一套，回程時再扣一次。費用要等路線查好（selPath）才算得出來
function speedRow(tile, n, on) {
  const p = selPath && selPath.to === tile && selPath.hours > 0 ? selPath : null;
  const info = p ? `${fmtH(p.hours)} → ${fmtH(p.fastHours)}・去程 $${p.fastPer * Math.max(1, n)}k，回程時再扣一次${n ? '' : '（每人）'}` : '路程時間減半，每人每省一小時 $1k，回程時再扣一次';
  return `<label class="speed${on ? ' on' : ''}"><input type="checkbox" data-fast="1"${on ? ' checked' : ''}> 加速 <span class="mini">${info}</span></label>`;
}
// 開了公司之後，機會就是伺服器上的委託板（跟著伺服器時間：公開三天，截止前一天不能再接；Alan 2026-10-09）；沒開公司時是沙盒的機會
// 清運也列進機會（Alan 2026-10-10）：不用派人，按了就出車；自己人倒下的地方程度最高
const cleanOpps = () => (GV?.cleanSites || []).filter(c => c.ok).map(c => ({kind: 'clean', tile: c.tile, lv: c.fallen ? 3 : c.daily || c.waste >= 20 ? 2 : 1, title: c.daily ? `${c.name}（總部）的每日清運` : `清運${c.name}`,
  detail: `${c.fallen ? '有自己人倒在這裡・' : ''}${c.daily ? '免費，附四種素材各 30' : `廢棄物 ${c.waste}・${c.dist} 格・車資 $${c.fare}k`}・約 ${c.hours} 小時`, clean: true}));
const curOpps = (s = hist[cur]) => GM?.board ? [...GM.board, ...cleanOpps()] : s?.opps || [];
function renderOpp() {
  const s = hist[cur], O = curOpps(s).slice().sort((a, b) => (b.joined ? 1 : 0) - (a.joined ? 1 : 0) || b.lv - a.lv || a.kind.localeCompare(b.kind));
  const cnt = k => O.filter(o => (k === 'all' || o.kind === k) && o.lv >= 2).length;
  let html = `<div class="opphead"><p class="muted" style="margin:0">${GM?.board ? '星球上公開的委託：每個公開三天，截止前一天不能再接；大家接同一個委託就在同一個案件裡搶積分。' : '如果玩家此刻進場，沙盒會給出的事。'}外圈越粗越亮，程度越高（●●● 最高）。</p></div><div class="filters">` +
    [['all', '全部'], ...Object.entries(OK).map(([k, v]) => [k, v.n])].map(([k, n]) => `<button data-ok="${k}" class="${oppKind === k ? 'on' : ''}">${n} <span class="muted">${cnt(k)}</span></button>`).join('') + '</div>';
  const list = O.filter(o => oppKind === 'all' || o.kind === oppKind);
  html += '<ol class="log opp">' + list.map(o => { const K = OK[o.kind]; return `<li data-tile="${o.tile}" style="border-left-color:${K.c}"><span class="lv" style="color:${K.c}">${'●'.repeat(o.lv)}${'○'.repeat(3 - o.lv)}</span> <b style="color:${K.c}">${K.n}</b>　${esc(o.title)}<span class="yr" style="font-family:inherit;font-size:12px;color:var(--muted)">${esc(o.detail)}${o.risk ? `・風險 ${'▲'.repeat(o.risk)}` : ''}</span>${o.closeAt != null ? `<span class="due">${o.joined ? `已接・${cd(o.end)}後結束` : `${cd(o.closeAt)}後截止`}${o.n ? `・${o.n} 家公司在打` : ''}</span>` : ''}${o.joined && o.kind !== 'camp' ? '' : accPicker(o)}</li>`; }).join('') + '</ol>';
  $('pane-opp').html = html || '';
}
$('pane-opp').onclick = e => {
  const a = e.target.closest('[data-acc],[data-side],[data-pk],[data-go],[data-cancel],[data-fast],[data-clean]');
  if (a?.dataset.clean) { send({type: 'clean', tile: +a.dataset.clean}); return; }
  if (a) {
    if (a.dataset.acc) { pickOpp = {key: a.dataset.acc, side: '', uids: new Set(), fast: false}; const o = curOpps().find(x => x.kind + ':' + x.tile === a.dataset.acc); if (o) { pickOpp.side = o.side ? o.side : o.kind === 'front' || o.kind === 'camp' ? 'att' : o.kind === 'tense' ? 'a' : ''; if (!selPath || selPath.to !== o.tile) send({type: 'path', to: o.tile}); } }
    else if (a.dataset.fast) pickOpp.fast = a.checked;
    else if (a.dataset.side) pickOpp.side = a.dataset.side;
    else if (a.dataset.pk) { const u = +a.dataset.pk; pickOpp.uids.has(u) ? pickOpp.uids.delete(u) : pickOpp.uids.add(u); }
    else if (a.dataset.go) { const [kind, tile] = pickOpp.key.split(':'); send({type: 'accept', kind, tile: +tile, side: pickOpp.side, uids: [...pickOpp.uids], fast: pickOpp.fast}); pickOpp = null; }
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
let GV = null, GM = null, coBuilt = false, pickOpp = null, pickRe = null, rosterF = 'home', toastT = null;
const recipe = {food: 30, water: 30, implant: 30, neural: 30};
const send = m => worker.postMessage(m);
const img = p => `portraits/${p}.png`;
const who = c => c.name || CLS[c.cls].n;   // 原主的名字（Alan 2026-10-10）；舊資料沒有就顯示職業
const crownTag = c => c.crown === 'gold' ? '<span class="crown gold">金冠</span>' : c.crown === 'silver' ? '<span class="crown silver">銀冠</span>' : c.template ? '<span class="crown tpl">模板</span>' : '';
const chip = (c, on, key) => `<span class="chip${on ? ' on' : ''}${c.alive ? '' : ' dead'}${key ? '' : ' static'}"${key && c.alive ? ` data-${key}="${c.uid}"` : ''}><img src="${img(c.portrait)}" alt="">${who(c)} ${c.id}</span>`;   // 金冠、銀冠只在詳細資料裡顯示（Alan 2026-10-09）
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
Object.defineProperty(HTMLElement.prototype, 'html', {configurable: true, set(v) { const k = String(v).replace(/(<span class="cd"[^>]*>)[^<]*/g, '$1'); if (this._k === k && this.childNodes.length) return; this._k = k; this.innerHTML = v; }});
const STATUS = {home: '待命', away: '出勤', returning: '歸途', kia: '陣亡', recovered: '遺體已收回', lost: '遺體沒能帶回'};
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3200); }
function found(base) { if (WATCH) return; send({type: 'found', base}); }
function onGame(m) {
  const first = !GV; GV = m.data; GM = m;
  if (m.campaigns?.some(c => !c.done) || $('campbar') && !$('campbar').hidden) draw();   // 大戰役每 6 小時變一次
  if (m.err) toast(m.err);
  if (first) { setPlaying(false); cur = hist.length - 1; computing = false; $('computing').hidden = true; $('more').hidden = true; document.body.classList.add('game'); $('gamebar').hidden = false; $('mailBtn').hidden = false; $('gyd').value = m.yearDays; showPage('co'); renderAll(); send({type: 'quotes'}); }
  $('gclock').textContent = clockText(Math.max(GV.h, hourNow() ?? GV.h), m);
  $('gsub').textContent = `${GV.name}・總部 ${GV.baseName}`;
  $('gcash').textContent = `$${GV.cash}k`; $('gcash').classList.toggle('neg', GV.cash < 0);
  $('gmats').html = MATS.map(m => `<span>${MN[m]} <b>${GV.mats[m]}</b></span>`).join('');   // 玩家的資源都在頂端（Alan 2026-10-09）
  maybeReveal(); renderPage(); if (page === 'map') { if (curTab() === 'tile' && sel >= 0) renderTile(); else if (curTab() === 'opp') renderOpp(); }
  renderMail();
  draw();
}
$('gspeed').onchange = e => send({type: 'speed', v: +e.target.value});
$('gyd').onchange = e => send({type: 'yearDays', v: +e.target.value});

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
          <div class="box"><h3 class="sec">清運 <span class="muted">不用派人：收生物廢棄物換植入物、神經介質，順便撿回那一帶的遺體</span></h3><div id="co-clean"></div></div></div>
      </div>`;
    coBuilt = true;
  }
  const G = GV, h = G.h;
  const active = G.cases.filter(c => !c.settled), alive = G.roster.filter(c => c.alive);
  $('co-head').html = `<div><div class="mini">${esc(G.name)}・總部 <a href="#" data-center="${G.base}">${esc(G.baseName)}</a></div></div>
    <div class="kpi">待命<b>${alive.filter(c => c.status === 'home' && !c.keep).length}</b></div><div class="kpi">出勤<b>${alive.filter(c => c.status === 'away' || c.status === 'returning').length}</b></div>
    <div class="kpi">不出擊<b>${alive.filter(c => c.keep).length}</b></div><div class="kpi">陣亡<b>${G.roster.length - alive.length}</b></div>
    <div class="kpi">進行中<b>${active.filter(c => !c.own).length} 案・${active.filter(c => c.own).length} 車隊</b></div><div class="kpi">待打的服務單<b>${G.tickets.length}</b></div>
    <div class="kpi">帳面業務損失<b>$${G.lossBook}k</b></div>`;
  $('co-tk').html = G.tickets.length ? G.tickets.map(t => {
    const left = t.deadline - h, U = Object.entries(t.enemy.units || {}).map(([k, n]) => `${unitName(k)}×${n}`).join('、'), V = t.enemy.veh ? Object.entries(t.enemy.veh).filter(([, n]) => n > 0).map(([k, n]) => `${unitName(k)}×${n}`).join('、') : '';
    return `<div class="card tk${t.transit ? ' transit' : ''}"><h4><a href="#" data-center="${t.tile}">${esc(t.title)}</a><span class="due${left > 12 ? ' ok' : ''}">剩 ${cd(t.deadline)}</span></h4>
      <div class="mini">${esc(t.caseTitle || '')}・${esc(t.squad || '')}・${esc(t.biome)}${t.night ? '・夜間' : ''}${t.trench >= .3 ? `・戰壕 ${t.trench} 級` : ''}</div>
      <div>敵人：<b>${esc(t.enemy.name)}</b>（戰力 ${t.enemy.power}）${U ? '・' + U : ''}${V ? '・' + V : ''}${t.enemy.boss ? t.enemy.boss.weapon ? `・頭目${esc(t.enemy.boss.chief || '')}帶著遺產級「${esc(t.enemy.boss.weapon)}」${t.enemy.boss.defeats ? `（被打倒過 ${t.enemy.boss.defeats} 次）` : ''}` : `・${esc(t.enemy.boss.name || '頭目')}帶隊` : ''}</div>
      ${t.transit ? '<div class="mini">行軍遇襲，不算案件積分</div>' : `<div class="mini">目標：${t.objectives.map(o => `${esc(o.text)}（${o.pts}）`).join('、')}</div>`}
      ${t.est ? `<div class="mini">小隊戰力 ${t.est.pow}・自動結算勝算約 <span class="odds-est ${t.est.p < .4 ? 'bad' : t.est.p < .75 ? 'mid' : 'good'}">${Math.round(t.est.p * 100)}%</span>・預估陣亡 ${t.est.dead.toFixed(1)} 人</div>` : ''}
      <div class="row"><button data-act="fight" data-id="${t.id}">親自打</button><button data-act="resolve" data-id="${t.id}">現在自動結算</button></div></div>`; }).join('') : '<p class="muted">沒有待處理的服務單。</p>';
  // 案件分三段（Alan 2026-10-10）：進行中的照舊整張卡；人都回來、只等結案撥款的，和已結案的，收成一行，不再列人
  const nowH = hourNow() ?? h, back = c => !c.own && !c.settled && c.squads.length && c.squads.every(sq => sq.headedHome != null && !(sq.backAt > nowH));
  const brief = c => `<div class="mini caseline"><a href="#" data-center="${c.tile}">${esc(c.title)}</a>・${c.settled ? (c.own ? '車隊已回到總部' : `尾款 $${c.payout || 0}k`) : `${cd(c.end + 24)}後結算`}${c.own ? '' : `・積分 ${c.score}`}${c.kind === 'route' ? `・車隊 ${c.convoys - c.lost}/${c.convoys}` : ''}</div>`;
  const waitC = G.cases.filter(back), doneC = G.cases.filter(c => c.settled), liveC = G.cases.filter(c => !c.settled && !back(c));
  const sec = (t, L) => L.length ? `<h4 class="sec2">${t}（${L.length}）</h4>${L.map(brief).join('')}` : '';
  // 清運（Alan 2026-10-10）
  $('co-clean').html = (G.cleanJobs || []).map(j => `<div class="mini caseline">清運車在${esc(j.name)}・約 ${cd(j.done)}後回來</div>`).join('') + (G.cleanSites || []).map(s => `<div class="row caseline"><span class="mini" style="flex:1"><a href="#" data-center="${s.tile}">${esc(s.name)}</a>${s.daily ? '・總部每天一趟（免費，附基本素材）' : `・${s.dist} 格`}${s.fallen ? '・<b>有自己人倒在這裡</b>' : ''}${s.waste ? `・廢棄物 ${s.waste}` : ''}・約 ${s.hours} 小時${s.fare ? `・車資 $${s.fare}k` : ''}</span>${s.ok ? `<button data-act="clean" data-id="${s.tile}">清運</button>` : `<span class="mini muted">${s.next != null ? `${cd(s.next)}後可再跑` : '車在路上'}</span>`}</div>`).join('');
  $('co-cases').html = !G.cases.length ? '<p class="muted">還沒接案。到戰略地圖的「機會」分頁挑一個點，按「接案」。</p>' : (liveC.length ? '' : '<p class="muted">沒有進行中的案件。</p>') + liveC.map(c => {
    const st = c.settled ? (c.own ? '車隊已回到總部' : `已結案${c.payout ? `・尾款 $${c.payout}k` : ''}`) : c.own ? `來回中・約 ${cd(c.end)}後回到總部` : c.open ? `${cd(c.end - 24)}後合約到期` : `收尾中・${cd(c.end + 24)}後結算`;
    return `<div class="card"><h4><a href="#" data-center="${c.tile}">${esc(c.title)}</a><span class="mini">${c.own ? '採購' : '●'.repeat(c.lv) + '○'.repeat(3 - c.lv)}</span></h4>
      <div class="mini">${st}${c.own ? '' : `・積分 ${c.score}`}${c.kind === 'route' ? `・車隊 ${c.convoys - c.lost}/${c.convoys}` : ''}</div>
      ${c.own && !c.squads.length ? '<div class="mini">沒有護衛，路上出事由雇來的車隊守衛自己打。</div>' : ''}
      ${c.squads.map(sq => { const cl = sq.clones.map(u => G.roster.find(x => x.uid === u)).filter(Boolean), al = cl.filter(x => x.alive).length;
        const sts = sq.headedHome != null ? (sq.backAt > (hourNow() ?? h) ? `歸途中・約 ${cd(sq.backAt)}後回到總部` : '已回到總部') : sq.busy ? '服務單處理中' : sq.readyAt > (hourNow() ?? h) ? `ETA ${cd(sq.readyAt)}` : '待命中';
        return `<div style="margin-top:6px"><span class="mini">${c.settled ? '' : sts}${sq.pending.length ? `・補員 ${sq.pending.map(p => `${p.n} 人 ${cd(p.eta)}後到`).join('、')}` : ''}${sq.refused ? '・<span style="color:var(--war)">雇主不准再補人</span>' : ''}</span>
        <div class="chips">${cl.map(x => chip(x, false)).join('')}</div>
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
    ${G.templates.length ? `<div class="box"><h3 class="sec">模板 <span class="muted">保證拿到這一位，數值固定在約前 20%</span></h3>${G.templates.map(t => `<div class="row"><span class="chip static"><img src="${img(t.portrait)}" alt="">${CLS[t.cls].n}</span><span class="mini">${MATS.map(m => `${MN[m]} ${t.recipe[m]}`).join('・')}</span><button data-act="tpl" data-id="${t.id}"${G.queue.length >= G.vats ? ' disabled' : ''}>用模板培養</button></div>`).join('')}</div>` : ''}</div>`;
  tickVat();
}
// 進度條跟著本機時鐘走
function tickVat() { const now = hourNow() ?? GV?.h; if (now == null) return; for (const el of document.querySelectorAll('.vatbar i[data-s]')) { const s = +el.dataset.s, d = +el.dataset.d; el.style.width = Math.max(0, Math.min(100, (now - s) / Math.max(1e-6, d - s) * 100)) + '%'; } }
setInterval(() => { if (page === 'vat') tickVat(); }, 1000);

// ───── 倉庫（Alan 2026-10-09）：所有人身上的裝備與沒在用的庫存。內容先留空，之後人員詳細資料的換裝會帶到這裡 ─────
// 改裝：倉庫裡的槍換一個詞條（Alan 2026-10-09）
let modPick = null;
const ARMOR_TEXT = {nightvision: '夜視：射擊暗處的目標不扣命中', infrared: '紅外線：看穿煙霧（牆和門還是擋得住）', steady: '壓制抗性：每次被壓制少 1 層', antitox: '抗毒：中毒每回合少 1 點傷害'};   // 照 ASH 的特性說明
function renderStore() {
  const P = $('pane-store'); if (!P) return;
  if (!GV) { P.html = '<div class="box"><p class="muted">開了公司之後才有倉庫。</p></div>'; return; }
  const al = GV.roster.filter(c => c.alive), store = GV.store || [], KN = {gun: '槍', melee: '近戰', armor: '護甲', kit: '預備品'};
  const kit = c => { const get = gearOfC(c); return [get('armor'), get('kit0'), get('kit1')].filter(Boolean).map(itemName).join('、'); };
  P.html = `<div class="cocols"><div class="cocol"><div class="box"><h3 class="sec">身上的裝備 <span class="muted">點人換裝</span></h3>
    <table class="rep"><tr><th>人員</th><th>武器</th><th>護甲、預備品</th></tr>${al.map(c => `<tr><td><span class="chip" data-person="${c.uid}"><img src="${img(c.portrait)}" alt="">${who(c)} ${c.id}</span></td><td>${esc(c.weapon || '')}</td><td>${esc(kit(c))}</td></tr>`).join('')}</table></div></div>
    <div class="cocol"><div class="box"><h3 class="sec">庫存 <span class="muted">戰鬥撿到的、換下來的・本地行情 ×${(GV.sellFactor ?? 1).toFixed(2)}</span></h3>
    ${store.length ? `<table class="rep"><tr><th>種類</th><th>名稱</th><th></th></tr>${store.map(it => `<tr><td>${KN[it.kind]}</td><td>${esc(it.name)}${it.kind === 'armor' && it.affix ? `<div class="mini muted">${esc(ARMOR_TEXT[it.affix] || '')}</div>` : ''}</td><td class="acts">${it.kind === 'gun' ? `<button data-modpick="${it.id}">改裝</button>` : ''}<button data-sell="${it.id}">${it.value ? `賣 $${it.value}k` : '丟棄'}</button></td></tr>${modPick === it.id ? `<tr><td colspan="3"><div class="gpick">${Object.keys(MOD_AFFIXES).filter(a => !MOD_AFFIXES[a].notOn?.includes(it.base) && a !== it.affix).map(a => `<button data-mod="${it.id}:${a}">${AFFIX_NAMES[a]}</button>`).join('')}<span class="mini">每次 $${modCost(it.base)}k</span><button data-modx="1">取消</button></div></td></tr>` : ''}`).join('')}</table>` : '<p class="muted">沒有沒在用的裝備。</p>'}</div></div></div>`;
}
// ───── 交易：素材庫存、在總部買、派車隊去別座城採購（之後賣人也放這裡） ─────
function renderTrade() {
  const P = $('pane-trade'); if (!P) return;
  if (!GV) { P.innerHTML = '<div class="box"><p class="muted">開了公司之後才能交易。</p></div>'; return; }
  if (!$('co-mats')) P.innerHTML = `<div class="cocols"><div class="cocol"><div class="box"><h3 class="sec">素材</h3><div id="co-mats"></div></div></div>
    <div class="cocol"><div class="box"><h3 class="sec">採購路線 <span class="muted">派車隊去別座城買料，來回都可能被劫</span></h3><div id="co-proc"></div></div></div></div>
    <div class="box"><h3 class="sec">裝備 <span class="muted">在總部的市場買，買了放進倉庫</span></h3><div id="co-shop"></div></div>`;
  const G = GV;
  const shopRow = (kind, T) => Object.keys(T).map(b => { const it = {kind, base: b, ...(kind === 'kit' ? {n: KITS[b].max} : {})}; return `<button data-shop="${kind}:${b}">${esc(itemName(it))}　$${shopPrice(it)}k</button>`; }).join('');
  $('co-shop').html = [['槍', 'gun', GUNS], ['近戰', 'melee', MELEES], ['護甲', 'armor', ARMORS], ['預備品', 'kit', KITS]].map(([n, k, T]) => `<div class="shoprow"><b>${n}</b>${shopRow(k, T)}</div>`).join('');
  $('co-mats').html = `<table class="mats"><tr><td class="muted">素材</td><td class="muted">庫存</td><td class="muted">本地單價</td><td></td></tr>` + MATS.map(m => `<tr><td>${MN[m]}</td><td>${G.mats[m]}</td><td>$${G.prices[m]}k</td><td><button data-act="buy" data-mat="${m}" data-q="100">+100（$${Math.round(G.prices[m] * 100)}k）</button></td></tr>`).join('') + '</table>';
  renderProc();
}

// ───── 名冊：任務管制、培養槽、交易共用的底部面板（Alan 2026-10-09）。平常收著，點了往上展開；點人看詳細資料 ─────
let drawerOpen = false, personSel = null;
const RF = {home: '待命', away: '出勤', keep: '不出擊', ...Object.fromEntries(Object.entries(TAGS).map(([k, n]) => ['t:' + k, n])), recovered: '遺體', kia: '陣亡', all: '全部'};
const inF = (c, f = rosterF) => f === 'all' || (f.startsWith('t:') ? (c.tags || []).includes(f.slice(2)) && (c.alive || c.status === 'recovered') : f === 'keep' ? c.keep && c.alive : f === 'home' ? c.status === 'home' && !c.keep : f === 'away' ? c.status === 'away' || c.status === 'returning' : f === 'kia' ? !c.alive && c.status !== 'recovered' : c.status === f);
// 簽收時跳出新人的卡片（Alan 2026-10-09：對標艦隊收藏）：簽收送出後，等伺服器回來、最新的人換了就秀出來
let revealAfter;
function maybeReveal() {
  if (revealAfter === undefined || !GV || GV.fresh == null || GV.fresh === revealAfter) return;
  revealAfter = undefined; const c = GV.roster.find(x => x.uid === GV.fresh); if (!c) return;
  const rank = c.crown === 'gold' ? 'gold' : c.crown === 'silver' ? 'silver' : c.template ? 'tpl' : '';
  const box = Object.assign(document.createElement('div'), {className: 'reveal', innerHTML: `<div class="rcard ${rank}">
    <div class="rflash"></div>
    ${rank ? `<div class="rrank">${rank === 'gold' ? '金冠' : rank === 'silver' ? '銀冠' : '模板'}</div>` : ''}
    <img src="${img(c.portrait)}" alt="">
    <div class="rname">${who(c)} ${c.id}</div>
    <table class="rep pstats"><tr><th>生命</th><th>命中</th><th>閃避</th><th>近戰</th></tr><tr><td>${c.st.hp}</td><td>${sg(c.st.acc)}</td><td>${sg(c.st.eva)}</td><td>${sg(c.st.mel)}</td></tr></table>
    <div class="mini">素質前 ${Math.max(1, Math.round((1 - c.pct) * 100))}%・${esc(c.weapon || '')}</div>
    <div class="mini muted">點一下關閉</div></div>`});
  box.onclick = () => box.remove(); document.body.appendChild(box);
}
function renderRoster() {
  const D = $('drawer'); if (!D) return;
  D.hidden = !GV || !['co', 'vat', 'store', 'trade'].includes(page); if (D.hidden) return;
  D.classList.toggle('open', drawerOpen);
  const G = GV, alive = G.roster.filter(c => c.alive), n = k => G.roster.filter(c => inF(c, k)).length;
  $('drawbar').html = `<b>名冊</b><span class="mini">活著 ${alive.length}・待命 ${n('home')}・出勤 ${G.roster.filter(c => c.alive && c.status === 'away').length}${G.roster.some(c => c.alive && c.status === 'returning') ? `・歸途 ${G.roster.filter(c => c.alive && c.status === 'returning').length}` : ''}${n('kia') ? `・陣亡 ${n('kia')}` : ''}</span><span class="caret">${drawerOpen ? '▼' : '▲'}</span>`;
  if (!drawerOpen) return;
  const B = $('drawbody');
  const c = personSel != null && G.roster.find(x => x.uid === personSel);
  if (c) { B.html = personCard(c); return; }
  const R = G.roster.filter(x => inF(x)).sort((a, b) => b.pct - a.pct);
  B.html = `<div class="filters">${Object.entries(RF).map(([k, v]) => `<button data-rf="${k}" class="${rosterF === k ? 'on' : ''}">${v} <span class="muted">${n(k)}</span></button>`).join('')}</div>
    <div class="faces">${R.map(x => `<button class="face${x.alive ? '' : ' kia'}${x.uid === G.fresh ? ' fresh' : ''}" data-person="${x.uid}"><img src="${img(x.portrait)}" alt=""><b>${who(x)}</b><span>${x.id}・${CLS[x.cls].n} ${x.lv || 1}級</span>${x.keep ? '<i class="kept">供</i>' : ''}</button>`).join('') || '<p class="muted">沒有。</p>'}</div>`;
}
// 裝備欄（Alan 2026-10-09）：槍 ×3、近戰、護甲、預備品 ×2。在總部待命時可以換：點「換」從倉庫挑，原本那件回倉庫
const SLOT_N = {gun0: '槍 1', gun1: '槍 2', gun2: '槍 3', melee: '近戰', armor: '護甲', kit0: '預備品 1', kit1: '預備品 2'};
let gearPick = null;   // {uid, slot}：正在挑哪一格
function gearOfC(c) { const g = c.gear || {guns: [], kits: []}; return s => s.startsWith('gun') ? g.guns?.[+s[3]] : s.startsWith('kit') ? g.kits?.[+s[3]] : g[s]; }
function gearBox(c) {
  const get = gearOfC(c), can = c.alive && c.status === 'home';
  const rows = SLOTS.map(s => { const it = get(s), open = gearPick && gearPick.uid === c.uid && gearPick.slot === s;
    const pick = open ? `<div class="gpick">${(GV.store || []).filter(x => x.kind === slotKind(s)).map(x => `<button data-eq="${x.id}">${esc(x.name)}</button>`).join('') || '<span class="mini muted">倉庫裡沒有能放進這一格的</span>'}${it ? '<button data-eq="">卸下</button>' : ''}<button data-eqx="1">取消</button></div>` : '';
    return `<tr><th>${SLOT_N[s]}</th><td>${it ? esc(itemName(it)) : '<span class="muted">—</span>'}</td><td>${can ? `<button data-gslot="${s}">換</button>` : ''}</td></tr>${pick ? `<tr><td colspan="3">${pick}</td></tr>` : ''}`; }).join('');
  return `<table class="rep gear">${rows}</table>${can ? '' : '<p class="mini muted">出勤中，回到總部才能換裝。</p>'}`;
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
    : e.t === 'merge' ? `${d(e.h)}・吸收了 ${esc(e.fed)} 的記憶片段，多了 ${e.gain} 片`
    : e.t === 'revive' ? `${d(e.h)}・在${esc(e.co)}重新培養，等級、技能從頭來` : esc(e.t);
  return `<h4 class="sec2">服役紀錄</h4>${R.length ? R.map(e => `<div class="mini caseline">${line(e)}</div>`).join('') : '<p class="mini muted">還沒有紀錄。</p>'}`;
}
function personCard(c) {
  const st = c.alive ? (STATUS[c.status] || c.status) + (c.squad ? `・${esc(c.squad)}` : '') : c.status === 'recovered' ? (c.reviving ? '遺體在培養槽裡，重新培養中' : '遺體已收回，可以重新培養（等級、技能從頭來）')
    : c.status === 'lost' ? `遺體沒能從${esc(c.downPlace)}帶回來・約 ${cd((c.downAt ?? 0) + 168)}後確認戰死（有人在那一帶打贏就可能撿回來）` : '陣亡';
  const rv = REVIVE_RECIPE[c.cls], canRv = c.status === 'recovered' && !c.reviving;
  return `<div class="person"><button class="back" data-person="">← 名冊</button>
    <div class="phead"><img src="${img(c.portrait)}" alt=""><div><div class="pname">${who(c)} ${c.id}${crownTag(c)}</div><div class="mini">${CLS[c.cls].n}</div><div class="mini">${st}</div><div class="mini">${c.lv || 1} 級・記憶片段 ${cellCount(c)}／100・出勤 ${c.missions || 0} 次</div></div></div>
    <table class="rep pstats"><tr><th>生命</th><th>命中</th><th>閃避</th><th>近戰</th><th>素質</th></tr><tr><td>${c.st.hp}</td><td>${sg(c.st.acc)}</td><td>${sg(c.st.eva)}</td><td>${sg(c.st.mel)}</td><td>前 ${Math.max(1, Math.round((1 - c.pct) * 100))}%</td></tr></table>
    ${gearBox(c)}
    <div class="mini">技能：${(c.skills || []).length ? c.skills.map(k => (SKN[k] || k) + (k === c.prep ? '（預備）' : '')).join('、') : '還沒有（3 級學會職業技能）'}</div>
    <div class="mini" style="margin-top:8px">分類（可以多選；「不出擊」的人不會被派出去）</div>
    <div class="row tags">${c.alive || c.status === 'recovered' ? [['keep', '不出擊'], ...Object.entries(TAGS)].map(([k, n]) => `<button data-act="tag" data-id="${c.uid}" data-tag="${k}" class="${k === 'keep' ? c.keep ? 'on' : '' : (c.tags || []).includes(k) ? 'on' : ''}">${n}</button>`).join('') : ''}</div>
    ${canRv ? `<div class="row"><button class="primary" data-act="revive" data-id="${c.uid}"${MATS.some(m => GV.mats[m] < rv[m]) ? ' disabled title="素材不夠"' : ''}>重新培養（${MATS.map(m => `${MN[m]} ${rv[m]}`).join('・')}）</button></div>` : ''}
    ${cellBox(c)}
    ${serviceRecord(c)}
    <p class="mini muted">強化、合成、換武器、加入最愛、指名為看板⋯之後會放在這裡。</p></div>`;
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
  const u = {recall: {type: 'squad', id: sq.id, penalty: c.own || c.kind === 'camp' ? 0 : c.pay.deposit + (c.midPaid ? c.pay.mid : 0) + 10 * c.lv}, kind: c.own ? 'escort' : c.kind === 'camp' ? 'camp' : 'squad', busy: !!sq.busy, fast: sq.fast};
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
  const why = u.recall.type === 'column' ? `這 ${u.n || ''} 名補員在路上掉頭，走回總部。` : u.kind === 'escort' ? '護衛離開車隊，走回總部；車隊之後出事由雇來的守衛自己打。'
    : u.kind === 'camp' ? `從大戰役撤軍：不算違約，已打下的貢獻照算，之後不再累積。${u.busy ? '手上那張服務單作廢。' : ''}`
    : `等於毀約：付違約金 <b>$${u.recall.penalty}k</b>，這個案件的積分作廢。${u.busy ? '手上的服務單交給案件的護衛去打。' : ''}`;
  return `<div class="confirm"><div class="mini">${why}${u.fast ? '回程照樣加速，回程時扣加速的錢。' : ''}</div><div class="row"><button class="warn" data-recall="${key}">確定${u.kind === 'camp' ? '撤軍' : '召回'}</button><button data-recall-x="1">取消</button></div></div>`;
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
  html += `<div class="row"><button data-act="qt-refresh">重新查詢報價</button><span class="mini">價格是那座城的市價；風險是整趟路上出事的機率。可以點地圖上的城鎮「派車隊來這裡採購」。</span></div>`;
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
      <div class="row"><button class="primary" data-act="proc-go">出發（${procSel.uids.size >= 2 ? `護衛 ${procSel.uids.size} 人` : '不帶護衛'}）</button><button data-act="proc-x">取消</button><span class="mini">至少兩人才成隊；不帶護衛時，出事由雇來的守衛自己打。</span></div>`;
  }
  el.html = html;
}

// ───── 報表 ─────
const FK = [['camp', '戰役報酬'], ['deposit', '訂金'], ['mid', '期中款'], ['final', '尾款'], ['upkeep', '維持費'], ['speed', '加速'], ['buy', '本地買料'], ['trip', '採購路線'], ['shop', '買裝備'], ['sell', '變賣'], ['mod', '改裝'], ['ammo', '彈藥費']];
function renderRepPage() {
  const P = $('pane-rep');
  if (!GV) { P.innerHTML = '<div class="box"><h3 class="sec">報表</h3><p class="muted">開了公司之後才有報表。</p></div>'; return; }
  if (!$('co-rep')) P.innerHTML = `<div class="cohead"><div><div class="mini">${esc(GV.name)}・總部 ${esc(GV.baseName)}</div><div class="big" id="rep-cash"></div></div></div><div class="box"><h3 class="sec">報表</h3><div id="co-rep"></div></div>`;
  $('rep-cash').textContent = `$${GV.cash}k`; $('rep-cash').classList.toggle('neg', GV.cash < 0);
  renderRep();
}
function renderRep() {
  const el = $('co-rep'); if (!el) return;
  const R = GV.report, money = v => `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${Math.round(v || 0)}k</span>`;
  const tot = o => FK.reduce((x, [k]) => x + (o[k] || 0), 0);
  let html = `<div class="mini">現金走勢（每天一點）</div><div class="spark" id="co-spark">${sparkSvg(R.daily, Math.max(280, (el.clientWidth || 320) - 4), 180)}</div>`;
  html += `<table class="rep" style="margin-top:8px"><tr><th>收支</th><th>近 30 天</th><th>累計</th></tr>` + FK.map(([k, n]) => `<tr><td>${n}</td><td>${money(R.d30[k])}</td><td>${money(R.all[k])}</td></tr>`).join('') +
    `<tr class="tot"><td>現金合計</td><td>${money(tot(R.d30))}</td><td>${money(tot(R.all))}</td></tr><tr><td class="muted">帳面業務損失（陣亡）</td><td>${money(R.d30.loss)}</td><td>${money(R.all.loss)}</td></tr></table>`;
  // 進行中的案件：已收（訂金、期中款）與應收（還沒付的期中款、尾款池）（Alan 2026-10-09：從任務管制的案件卡搬過來）
  const act = GV.cases.filter(c => !c.settled && !c.own);
  if (act.length) html += `<div class="mini" style="margin-top:10px">進行中的案件</div><table class="rep"><tr><th>案件</th><th>已收</th><th>應收</th></tr>` + act.map(c => { const n = c.squads.length;
    return `<tr><td>${esc(c.title)}</td><td>訂金 $${c.pay.deposit * n}k${c.midPaid ? `＋期中 $${c.pay.mid * n}k` : ''}</td><td>${c.midPaid ? '' : `期中 $${c.pay.mid * n}k＋`}尾款池 $${c.pay.final}k<span class="mini">（依積分平分）</span></td></tr>`; }).join('') + '</table>';
  html += `<div class="mini" style="margin-top:10px">結案紀錄</div>` + (R.hist.length ? `<table class="rep"><tr><th>案件</th><th>服務單（勝／自動）</th><th>陣亡</th><th>收入</th></tr>` + R.hist.slice(0, 15).map(c => `<tr><td>${esc(c.title)}${c.delivered !== undefined ? ` <span class="mini">送達 ${Math.round(c.delivered * 100)}%</span>` : ''}</td><td>${c.tickets}（${c.wins}／${c.auto}）</td><td>${c.dead || ''}</td><td>${c.own ? '<span class="muted">—</span>' : money(c.income + c.upkeep)}</td></tr>`).join('') + '</table>' : '<p class="muted">還沒有結案。</p>');
  const al = GV.roster.filter(c => c.alive), byC = {}; for (const c of al) byC[c.cls] = (byC[c.cls] || 0) + 1;
  html += `<div class="mini" style="margin-top:10px">人員：${Object.entries(byC).map(([k, n]) => `${CLS[k].n} ${n}`).join('・') || '沒有'}・金冠 ${al.filter(c => c.crown === 'gold').length}・銀冠 ${al.filter(c => c.crown === 'silver').length}</div>`;
  el.innerHTML = html;
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
const PAGES = ['map', 'co', 'vat', 'store', 'trade', 'rep'];
function renderPage() {
  if (page === 'co') renderCo(); else if (page === 'vat') renderVat(); else if (page === 'store') renderStore(); else if (page === 'trade') renderTrade(); else if (page === 'rep') renderRepPage();
  renderRoster();
}
function showPage(p) {
  page = p; const at = PAGES.indexOf(p);
  // 分頁一層一層疊（Alan 2026-10-09）：右邊的疊在左邊的上面，每層往右縮一點，看得到下面幾層的邊；比現在這頁右邊的先收到畫面外
  for (const [i, el] of [...$('track').children].entries()) { el.classList.toggle('above', i > at); el.classList.toggle('under', i < at); }
  for (const b of document.querySelectorAll('.pager button')) b.classList.toggle('on', b.dataset.page === p);
  if (p === 'map') { draw(); renderRoster(); } else renderPage();
}
for (const b of document.querySelectorAll('.pager button')) b.onclick = () => showPage(b.dataset.page);
// 一開始就把地圖以外的分頁收到右邊（單人測試模式不會經過 showPage，其他分頁會蓋在地圖上）
for (const [i, el] of [...$('track').children].entries()) el.classList.toggle('above', i > PAGES.indexOf(page));
let swipe = null;
$('pages').addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { swipe = null; return; }
  const t = e.touches[0], el = e.target;
  if (el.closest('input,select,textarea,.tabs')) { swipe = null; return; }
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
  return `<div class="picker confirm"><div class="mini">契約變更：從總部調人補這一隊，雇主不另付錢。還能補 ${room} 人；走過去要時間，路上可能遇襲。打輸太多或放著不打，雇主會拒絕。</div><div class="chips">${av.map(c => chip(c, pickRe.uids.has(c.uid), 'rp')).join('') || '<span class="muted">總部沒有待命的人</span>'}</div>
    <label class="speed${pickRe.fast ? ' on' : ''}"><input type="checkbox" data-refast="1"${pickRe.fast ? ' checked' : ''}> 加速 <span class="mini">路程時間減半，每人每省一小時 $1k</span></label>
    <div class="row"><button class="primary" data-act="re-go">送出契約變更（${pickRe.uids.size} 人${pickRe.fast ? '・加速' : ''}）</button><button data-act="re-x">取消</button></div></div>`;
}
function renderOdds() { if (!$('co-odds')) return; const o = classOdds(recipe); $('co-odds').innerHTML = Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${CLS[k].n} ${Math.round(v * 100)}%</span>`).join(''); }
const coPanes = ['pane-co', 'pane-vat', 'pane-store', 'pane-trade', 'drawer'].map($);
for (const el of coPanes) el.addEventListener('change', e => { const f = e.target.dataset.pf; if (!f || !procSel) return; procSel[f] = f === 'qty' ? Math.max(10, +e.target.value || 0) : e.target.value; renderProc(); });
for (const el of coPanes) el.addEventListener('input', e => { const m = e.target.dataset.rc; if (!m) return; const r = e.target.dataset.vat != null ? vatRecipe(+e.target.dataset.vat) : recipe; r[m] = Math.max(0, +e.target.value || 0); renderOdds(); });
// 配方輸入框打完（離開焦點）才重畫培養槽，機率跟著更新
$('pane-vat').addEventListener('focusout', () => setTimeout(() => { if (page === 'vat') renderVat(); }, 0));
// 服務單的「親自打」「現在自動結算」在按下去那一刻就送出：公司時間跑得快時清單每秒重畫好幾次，
// 按下與放開落在不同的按鈕上就不會有 click（2026-10-08 Alan 回報：按了親自打一直沒反應）
$('pane-co').addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-act="fight"],[data-act="resolve"]'); if (!b || e.button !== 0) return;
  e.preventDefault(); const id = b.dataset.id;
  if (b.dataset.act === 'fight') { send({type: 'fight', ticket: id}); showMissionLoading(); } else send({type: 'resolve', ticket: id});
});
const coClick = e => {
  if (e.target.closest('#drawbar')) { drawerOpen = !drawerOpen; renderRoster(); return; }
  const go = e.target.closest('[data-goto]'); if (go) { e.preventDefault(); drawerOpen = false; showPage(go.dataset.goto); return; }
  const gs = e.target.closest('[data-gslot]'); if (gs) { gearPick = gearPick?.slot === gs.dataset.gslot ? null : {uid: personSel, slot: gs.dataset.gslot}; renderRoster(); return; }
  if (e.target.closest('[data-eqx]')) { gearPick = null; renderRoster(); return; }
  const eq = e.target.closest('[data-eq]'); if (eq && gearPick) { send({type: 'equip', uid: gearPick.uid, slot: gearPick.slot, item: eq.dataset.eq || null}); gearPick = null; return; }
  const sl = e.target.closest('[data-sell]'); if (sl) { send({type: 'sell', item: sl.dataset.sell}); return; }
  const mp = e.target.closest('[data-modpick]'); if (mp) { modPick = modPick === mp.dataset.modpick ? null : mp.dataset.modpick; renderStore(); return; }
  if (e.target.closest('[data-modx]')) { modPick = null; renderStore(); return; }
  const md = e.target.closest('[data-mod]'); if (md) { const [item, affix] = md.dataset.mod.split(':'); send({type: 'mod', item, affix}); modPick = null; return; }
  const sh = e.target.closest('[data-shop]'); if (sh) { const [kind, base] = sh.dataset.shop.split(':'); send({type: 'shop', kind, base}); return; }
  const ps = e.target.closest('[data-person]'); if (ps) { gearPick = null; personSel = ps.dataset.person === '' ? null : +ps.dataset.person; drawerOpen = true; renderRoster(); return; }
  const rf2 = e.target.closest('[data-refast]'); if (rf2) { pickRe.fast = rf2.checked; renderCo(); return; }
  const st = e.target.closest('[data-rcd]'); if (st) { const r = vatRecipe(+st.dataset.vat), m = st.dataset.m; r[m] = Math.max(GCFG.MIN, Math.min(GCFG.MAX, (r[m] || 0) + +st.dataset.rcd)); renderVat(); return; }
  if (recallClick(e)) return;
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
  else if (A === 'revive') send({type: 'revive', uid: +id});
  else if (A === 'clean') send({type: 'clean', tile: +id});
  else if (A === 'merge') { if (confirm('合成之後，被吃掉的那一位就不在了。確定？')) send({type: 'merge', keep: +id, feed: +b.dataset.feed}); }
  else if (A === 'resolve' || A === 'fight') return;   // 上面 pointerdown 已經送出
  else if (A === 're') { pickRe = {squad: id, uids: new Set()}; renderCo(); }
  else if (A === 're-go') { send({type: 'reinforce', squad: pickRe.squad, uids: [...pickRe.uids], fast: !!pickRe.fast}); pickRe = null; }
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
function openSys() {
  const email = account(), co = GV?.name;
  $('sysBody').innerHTML = `<p class="mini">${LOCAL ? '單人測試模式' : email ? `已用 ${esc(email)} 登入` : '訪客（這個瀏覽器）'}${co ? `・公司：${esc(co)}` : ''}</p>
    <button data-sys="devlog">開發日誌</button>
    <button data-sys="vhs">畫面濾鏡（VHS）：${vhsOn ? '開' : '關'}</button>
    ${LOCAL ? '' : '<button data-sys="watch">觀看世界生成</button>'}
    ${LOCAL ? '' : '<button data-sys="title">回標題畫面</button>'}
    ${!LOCAL && email ? '<button data-sys="logout">登出</button>' : ''}`;
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
    const r = await fetch('/api/arena', {method: 'POST', headers: {...authHeaders(), 'content-type': 'application/json'}, body: JSON.stringify({size: +$('arenaSize').value, night: $('arenaNight').checked || null, boss: $('arenaBoss').checked, mode: $('arenaMode').value, type: $('arenaType').value, biome: $('arenaBiome').value, side: $('arenaSide').value, defeats: +$('arenaDefeats').value, veh: $('arenaVeh').checked})});
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
  E.onresult = (id, result) => { if (mission && mission.id === id) { if (mission.arena) showTitle('測試戰鬥打完了（不結算）'); else if (result?.server) worker?.poll?.(); else send({type: 'submit', ticket: id, result}); mission = null; } };
  // 先不打：伺服器上的戰鬥留在伺服器，下次按親自打接著打；單人測試模式要讓時間恢復
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
