// 奇美拉沙盒觀看頁：背景的 worker 一年一年推演，畫面照選好的速度播放；開了公司之後改用小時推進
import {CLS, MN, MATS, classOdds, GCFG} from './company.js';
const $ = id => document.getElementById(id);
const canvas = $('map'), ctx = canvas.getContext('2d');
const SQ3 = Math.sqrt(3);

let ST = null;                 // 靜態資料：地圖大小、地名、地形
let hist = [];                 // 每一年的樣子
let cur = 0, playing = false, timer = null, computing = false;
let allEvents = [];
let sel = -1, hover = -1, hiFac = -1, mouse = {x: 0, y: 0};
const layers = {fac: true, pop: false, bandit: false, trench: false, opp: true};
let oppKind = 'all';
const OK = {exp: {n: '遠征', ch: '遠', c: '#7fc06a'}, short: {n: '缺貨', ch: '補', c: '#6fb4e0'}, tense: {n: '快開戰', ch: '壓', c: '#e7a14a'}, front: {n: '前線', ch: '戰', c: '#ff5a3c'}, route: {n: '危險商路', ch: '護', c: '#e0cf5a'}, lair: {n: '據點', ch: '剿', c: '#c98a6a'}};
let logFilter = 'legend';
let worker = null;

/* ───────── worker ───────── */
function start(seed) {
  if (worker) worker.terminate();
  worker = new Worker('worker.js', {type: 'module'});
  hist = []; allEvents = []; cur = 0; sel = -1; hiFac = -1; computing = true; GV = null; GM = null; coBuilt = false; $('pane-rep').innerHTML = ''; mailSeen.clear(); mailFirst = true; $('mailBtn').hidden = true; $('mail').hidden = true; QT = null; procSel = null; selPath = null; document.body.classList.remove('game'); $('gamebar').hidden = true;
  $('computing').hidden = false; $('computing').textContent = '生成地形…'; $('more').hidden = true;
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'static') { ST = m; fit(); }
    else if (m.type === 'year') {
      hist.push(m.data); for (const ev of m.data.events) allEvents.push(ev);
      $('slider').max = hist.length - 1; $('computing').textContent = `推演到第 ${m.data.y} 年…`;
      if (hist.length === 1) { cur = 0; renderAll(); setPlaying(true); }
      else if (GV) { cur = hist.length - 1; lastPanelY = -1; renderAll(); send({type: 'quotes'}); }
      if (!GV && page === 'co' && hist.length % 10 === 0) renderCo();
    } else if (m.type === 'idle') { computing = false; $('computing').hidden = true; $('more').hidden = false; }
    else if (m.type === 'game') { if (m.err) hideMissionLoading(); onGame(m); }
    else if (m.type === 'mission') openMission(m.data);
    else if (m.type === 'path') { selPath = m; draw(); }
    else if (m.type === 'quotes') { QT = m.data; if (procSel && !QT.some(q => q.t === procSel.t)) procSel = null; if (page === 'co') renderProc(); }
  };
  worker.onerror = e => { $('computing').textContent = '推演出錯：' + (e.message || ''); };
  worker.postMessage({type: 'start', seed});
  const u = new URL(location); u.searchParams.set('seed', seed); history.replaceState(null, '', u);
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
function drawNow() {
  if (!ST || !hist.length) return;
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
  // 機會：圓牌上一個字，外圈越粗越亮程度越高
  if (layers.opp && s.opps) for (const o of s.opps) {
    if (oppKind !== 'all' && o.kind !== oppKind) continue;
    const K = OK[o.kind], x = cx(o.tile) + S0 * .35, y = cy(o.tile) + S0 * .3, r = S0 * (.38 + o.lv * .08);
    if (o.lv === 3) { ctx.fillStyle = K.c + '55'; ctx.beginPath(); ctx.arc(x, y, r * 1.55, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#15120e'; ctx.strokeStyle = K.c; ctx.lineWidth = Math.max(.8, (o.lv * .9) / Math.sqrt(k)) * (S0 / 10); ctx.globalAlpha = o.lv === 1 ? .7 : 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = K.c; ctx.font = `700 ${r * 1.15}px 'Noto Sans TC',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(K.ch, x, y + r * .05); ctx.globalAlpha = 1;
  }
  // 公司：總部、接下的案件、任務票
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
function tab(name) { for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === name); for (const p of document.querySelectorAll('.pane')) p.hidden = p.id !== 'pane-' + name; renderPanel(); }
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => tab(b.dataset.tab);
for (const b of document.querySelectorAll('#filters button')) b.onclick = () => { logFilter = b.dataset.f; for (const x of document.querySelectorAll('#filters button')) x.classList.toggle('on', x === b); renderLog(); };
$('legend').hidden = innerWidth < 820;
document.querySelector('.layers [data-legend]').onclick = e => { $('legend').hidden = !$('legend').hidden; e.currentTarget.classList.toggle('on', !$('legend').hidden); };
document.querySelector('.layers [data-legend]').classList.toggle('on', innerWidth >= 820);
for (const b of document.querySelectorAll('.layers button[data-layer]')) b.onclick = () => { const L = b.dataset.layer; layers[L] = !layers[L]; if (L === 'fac' && layers.fac) layers.pop = false; if (L === 'pop' && layers.pop) layers.fac = false; for (const x of document.querySelectorAll('.layers button[data-layer]')) x.classList.toggle('on', layers[x.dataset.layer]); draw(); };
const curTab = () => document.querySelector('.tabs button.on').dataset.tab;

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
$('pane-tile').onclick = e => { if (recallClick(e)) return; const b = e.target.closest('[data-found]'); if (b) { found(+b.dataset.found); return; } const p = e.target.closest('[data-proc]'); if (p) { procSel = {t: +p.dataset.proc, mat: '', qty: 100, uids: new Set()}; showPage('co'); send({type: 'quotes'}); } };
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
  for (const o of (s.opps || []).filter(o => o.tile === i)) { const K = OK[o.kind]; html += `<p style="border-left:3px solid ${K.c};padding-left:8px"><b style="color:${K.c}">${K.n} ${'●'.repeat(o.lv)}${'○'.repeat(3 - o.lv)}</b>　${esc(o.title)}<br><span class="muted">${esc(o.detail)}</span></p>`; }
  if (GV) { const here = (GV.units || []).filter(u => u.pos && (u.pos.f < .5 ? u.pos.a : u.pos.b) === i);
    if (here.length) html += `<h2 style="margin-top:10px">我的人馬</h2>` + here.map(u => `<div class="card"><b>${esc(u.name)}</b>${u.n ? ` <span class="mini">${u.n} 人</span>` : ''}<div class="mini">${esc(u.status)}${u.where ? '・' + esc(u.where) : ''}</div>${recallBtn(u)}</div>`).join(''); }
  if (GV && t && i !== GV.base) html += `<p><button data-proc="${i}">派車隊來這裡採購</button></p>`;
  if (!GV && s.fac.some(f => f.cap === i)) html += `<p><button class="primary" data-found="${i}">在這裡開公司</button> <span class="muted">總部設在這座主城，從這一年開始經營。</span></p>`;
  for (const x of g) html += `<p>${x.native ? '原住民' : '掠奪者據點'}：<b>${esc(x.name)}</b>（勢力 ${x.str}${x.legacy ? '，手上有遺產級' : ''}）</p>`;
  if (t) {
    html += `<h2 style="margin-top:10px">市鎮</h2><dl class="kv"><dt>服務人口</dt><dd>${t.pop}</dd>${t.lord ? `<dt>課長</dt><dd>${esc(t.lord)}</dd>` : ''}<dt>培養槽</dt><dd>${t.vat || '沒有'}</dd>${t.works ? '<dt>廠區</dt><dd>有</dd>' : ''}`;
    if (t.veh) html += `<dt>車庫</dt><dd>${Object.entries(t.veh).filter(([, v]) => v >= .5).map(([v, n]) => `${ST.vn[v]} ${Math.round(n)}`).join('・') || '空的'}</dd>`;
    html += '</dl><table class="stock"><tr><th>貨物</th><th>存量</th><th>滿足度</th></tr>' + ST.goods.map(gd => `<tr><td>${ST.gn[gd]}</td><td>${t.stock[gd]}</td><td style="color:${t.ratio[gd] < .8 ? 'var(--war)' : 'inherit'}">${Math.round(t.ratio[gd] * 100)}%</td></tr>`).join('') + '</table>';
  }
  $('pane-tile').innerHTML = html;
}
function accPicker(o) {
  const key = o.kind + ':' + o.tile; if (!GV) return '';
  if (!pickOpp || pickOpp.key !== key) return `<div class="row" style="margin-top:4px"><button data-acc="${key}">接案</button></div>`;
  const s = hist[cur], fn = id => s.fac.find(f => f.id === id)?.n || '';
  const sides = o.kind === 'front' ? [['att', '替攻方 ' + fn(o.att)], ['def', '替守方 ' + fn(o.def)]] : o.kind === 'tense' ? [['a', '替 ' + fn(o.a)], ['b', '替 ' + fn(o.b)]] : [];
  const av = GV.roster.filter(c => c.alive && c.status === 'home' && !c.keep);
  return `<div class="picker">${sides.length ? `<div class="row">${sides.map(([v, n]) => `<button data-side="${v}" class="${pickOpp.side === v ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>` : ''}
    <div class="mini" style="margin-top:6px">選要派的人（四人一隊，最少兩人）：</div><div class="chips">${av.map(c => chip(c, pickOpp.uids.has(c.uid), 'pk')).join('') || '<span class="muted">沒有待命的人</span>'}</div>
    <div class="row"><button class="primary" data-go="1">出發（${pickOpp.uids.size} 人）</button><button data-cancel="1">取消</button></div></div>`;
}
function renderOpp() {
  const s = hist[cur], O = (s.opps || []).slice().sort((a, b) => b.lv - a.lv || a.kind.localeCompare(b.kind));
  const cnt = k => O.filter(o => (k === 'all' || o.kind === k) && o.lv >= 2).length;
  let html = `<p class="muted" style="margin:0 0 8px">如果玩家此刻進場，沙盒會給出的事。外圈越粗越亮，程度越高（●●● 最高）。</p><div class="filters">` +
    [['all', '全部'], ...Object.entries(OK).map(([k, v]) => [k, v.n])].map(([k, n]) => `<button data-ok="${k}" class="${oppKind === k ? 'on' : ''}">${n} <span class="muted">${cnt(k)}</span></button>`).join('') + '</div>';
  const list = O.filter(o => oppKind === 'all' || o.kind === oppKind);
  html += '<ol class="log opp">' + list.map(o => { const K = OK[o.kind]; return `<li data-tile="${o.tile}" style="border-left-color:${K.c}"><span class="lv" style="color:${K.c}">${'●'.repeat(o.lv)}${'○'.repeat(3 - o.lv)}</span> <b style="color:${K.c}">${K.n}</b>　${esc(o.title)}<span class="yr" style="font-family:inherit;font-size:12px;color:var(--muted)">${esc(o.detail)}${o.risk ? `・風險 ${'▲'.repeat(o.risk)}` : ''}</span>${accPicker(o)}</li>`; }).join('') + '</ol>';
  $('pane-opp').innerHTML = html || '';
}
$('pane-opp').onclick = e => {
  const a = e.target.closest('[data-acc],[data-side],[data-pk],[data-go],[data-cancel]');
  if (a) {
    if (a.dataset.acc) { pickOpp = {key: a.dataset.acc, side: '', uids: new Set()}; const o = (hist[cur].opps || []).find(x => x.kind + ':' + x.tile === a.dataset.acc); if (o) pickOpp.side = o.kind === 'front' ? 'att' : o.kind === 'tense' ? 'a' : ''; }
    else if (a.dataset.side) pickOpp.side = a.dataset.side;
    else if (a.dataset.pk) { const u = +a.dataset.pk; pickOpp.uids.has(u) ? pickOpp.uids.delete(u) : pickOpp.uids.add(u); }
    else if (a.dataset.go) { const [kind, tile] = pickOpp.key.split(':'); send({type: 'accept', kind, tile: +tile, side: pickOpp.side, uids: [...pickOpp.uids]}); pickOpp = null; }
    else pickOpp = null;
    renderOpp(); return;
  }
  const b = e.target.closest('button[data-ok]'); if (b) { oppKind = b.dataset.ok; renderOpp(); draw(); return; } const li = e.target.closest('li[data-tile]'); if (li) select(+li.dataset.tile, true, true); };
function renderGear() {
  const s = hist[cur];
  $('pane-gear').innerHTML = `<p class="muted" style="margin:0 0 10px">企業時代留下、再也造不出來的裝備。</p><ul class="gear" style="padding-left:18px">` + s.weapons.map(x => `<li><b>「${esc(x.name)}」</b>${esc(x.kind)}<br><span class="muted">${x.holder ? `在 ${esc(x.holder)} 手上` : x.fac ? `收在${esc(x.fac)}的軍械庫` : x.gang ? `在 ${esc(x.gang)} 手上` : x.lost ? `${x.sealed ? '封在' : '失落在'}${esc(ST.names[x.at] || '某處')}${x.sealed ? '的舊倉庫' : ''}` : ''}・易手 ${x.owners} 次・打贏 ${x.wins} 場</span></li>`).join('') + '</ul>';
}
function renderPanel() { if (!hist.length) return; const t = curTab(); if (t === 'opp') renderOpp(); else if (t === 'log') renderLog(); else if (t === 'fac') renderFac(); else if (t === 'tile') renderTile(); else renderGear(); }
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
const crownTag = c => c.crown === 'gold' ? '<span class="crown gold">金冠</span>' : c.crown === 'silver' ? '<span class="crown silver">銀冠</span>' : c.template ? '<span class="crown tpl">模板</span>' : '';
const chip = (c, on, key) => `<span class="chip${on ? ' on' : ''}${c.alive ? '' : ' dead'}${key ? '' : ' static'}"${key && c.alive ? ` data-${key}="${c.uid}"` : ''}><img src="${img(c.portrait)}" alt="">${CLS[c.cls].n} ${c.id}${crownTag(c)}</span>`;
const fmtH = x => x <= 0 ? '0 小時' : x < 48 ? `${Math.round(x)} 小時` : `${Math.floor(x / 24)} 天 ${Math.round(x % 24)} 小時`;
const STATUS = {home: '待命', away: '出勤', returning: '歸途', kia: '陣亡'};
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3200); }
function found(base) { send({type: 'found', base}); }
function onGame(m) {
  const first = !GV; GV = m.data; GM = m;
  if (m.err) toast(m.err);
  if (first) { setPlaying(false); cur = hist.length - 1; computing = false; $('computing').hidden = true; $('more').hidden = true; document.body.classList.add('game'); $('gamebar').hidden = false; $('mailBtn').hidden = false; $('gyd').value = m.yearDays; showPage('co'); renderAll(); send({type: 'quotes'}); }
  const day = Math.floor(GV.h / 24) % m.yearDays + 1, hh = GV.h % 24;
  $('gclock').textContent = `第 ${m.year} 年・第 ${day} 天 ${String(hh).padStart(2, '0')}:00`;
  $('gsub').textContent = `${GV.name}・總部 ${GV.baseName}`;
  $('gcash').textContent = `$${GV.cash}`; $('gcash').classList.toggle('neg', GV.cash < 0);
  if (page === 'co') renderCo(); else if (page === 'rep') renderRepPage(); else if (curTab() === 'tile' && sel >= 0) renderTile();
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
    P.innerHTML = `<div class="box"><h3 class="sec">開一家公司</h3><p class="muted" style="margin:0 0 10px">任何一座主城都可以當總部。選了之後，沙盒會從目前推演到的最後一年（第 ${s.y} 年）開始，改用小時推進：你造複製人、接戰略地圖上的案子、把人派出去、開採購路線買料。任務票目前只能自動結算（戰鬥層還沒接上）。</p><div class="coinit">` +
      s.fac.filter(f => f.cap >= 0).sort((a, b) => b.pop - a.pop).map(f => { const t = s.towns.find(x => x.t === f.cap); return `<div class="frow"><i class="sw" style="background:${f.c}"></i><span class="nm">${esc(ST.names[f.cap])}　<span class="muted">${esc(f.n)}</span></span><button data-found="${f.cap}">開在這裡</button><span class="meta">人口 ${f.pop}・${t?.vat ? `培養槽 ${t.vat}（神經介質便宜）` : '沒有培養槽'}${t?.works ? '・廠區（植入物便宜）' : ''}${s.wars.some(w => w.att === f.id || w.def === f.id) ? '・<span style="color:var(--war)">交戰中</span>' : ''}</span></div>`; }).join('') + '</div></div>';
    coBuilt = false; return;
  }
  if (!coBuilt) {
    P.innerHTML = `<div class="cohead" id="co-head"></div>
      <div class="colay">
        <div class="comain">
          <div class="cocols" id="co-ops">
            <div class="cocol">
              <div class="box"><h3 class="sec">任務票 <span class="muted">24 小時內要打完，不然自動結算（火力、積分打八折）</span></h3><div id="co-tk"></div></div>
              <div class="box"><h3 class="sec">案件與車隊</h3><div id="co-cases"></div></div>
            </div>
            <div class="cocol">
              <div class="box"><h3 class="sec">培養槽 <span class="muted" id="co-vatinfo"></span></h3><div id="co-mats"></div>
                <div class="recipe">${MATS.map(m => `<label>${MN[m]}<input type="number" min="${GCFG.MIN}" max="${GCFG.MAX}" step="10" value="${recipe[m]}" data-rc="${m}"></label>`).join('')}</div>
                <div class="odds" id="co-odds"></div><div class="row"><button class="primary" data-act="build">開始培養</button><span class="mini" id="co-queue"></span></div><div id="co-tpl"></div></div>
              <div class="box"><h3 class="sec">採購路線 <span class="muted">派車隊去別座城買料，來回都可能被劫</span></h3><div id="co-proc"></div></div>
            </div>
          </div>
        </div>
        <aside class="coside"><div class="box"><h3 class="sec">名冊 <span class="muted" id="co-rcount"></span></h3><div class="filters" id="co-rf"></div><div class="roster" id="co-roster"></div></div></aside>
      </div>`;
    coBuilt = true; renderOdds();
  }
  const G = GV, h = G.h;
  const active = G.cases.filter(c => !c.settled), alive = G.roster.filter(c => c.alive);
  $('co-head').innerHTML = `<div><div class="mini">${esc(G.name)}・總部 <a href="#" data-center="${G.base}">${esc(G.baseName)}</a></div><div class="big${G.cash < 0 ? ' neg' : ''}">$${G.cash}</div></div>
    <div class="kpi">待命<b>${alive.filter(c => c.status === 'home' && !c.keep).length}</b></div><div class="kpi">出勤<b>${alive.filter(c => c.status === 'away' || c.status === 'returning').length}</b></div>
    <div class="kpi">供在家裡<b>${alive.filter(c => c.keep).length}</b></div><div class="kpi">陣亡<b>${G.roster.length - alive.length}</b></div>
    <div class="kpi">進行中<b>${active.filter(c => !c.own).length} 案・${active.filter(c => c.own).length} 車隊</b></div><div class="kpi">待打的票<b>${G.tickets.length}</b></div>
    <div class="kpi">帳面業務損失<b>$${G.lossBook}</b></div>`;
  $('co-tk').innerHTML = G.tickets.length ? G.tickets.map(t => {
    const left = t.deadline - h, U = Object.entries(t.enemy.units || {}).map(([k, n]) => `${UNIT[k] || k}×${n}`).join('、'), V = t.enemy.veh ? Object.entries(t.enemy.veh).filter(([, n]) => n > 0).map(([k, n]) => `${ST.vn[k] || k}×${n}`).join('、') : '';
    return `<div class="card tk${t.transit ? ' transit' : ''}"><h4><a href="#" data-center="${t.tile}">${esc(t.title)}</a><span class="due${left > 12 ? ' ok' : ''}">剩 ${fmtH(left)}</span></h4>
      <div class="mini">${esc(t.caseTitle || '')}・${esc(t.squad || '')}・${esc(t.biome)}${t.night ? '・夜間' : ''}${t.trench >= .3 ? `・戰壕 ${t.trench} 級` : ''}</div>
      <div>敵人：<b>${esc(t.enemy.name)}</b>（戰力 ${t.enemy.power}）${U ? '・' + U : ''}${V ? '・' + V : ''}${t.enemy.boss ? `・頭目帶著遺產級「${esc(t.enemy.boss.weapon)}」` : ''}</div>
      ${t.transit ? '<div class="mini">行軍遇襲，不算案件積分</div>' : `<div class="mini">目標：${t.objectives.map(o => `${esc(o.text)}（${o.pts}）`).join('、')}</div>`}
      ${t.est ? `<div class="mini">小隊戰力 ${t.est.pow}・自動結算勝算約 <span class="odds-est ${t.est.p < .4 ? 'bad' : t.est.p < .75 ? 'mid' : 'good'}">${Math.round(t.est.p * 100)}%</span>・預估陣亡 ${t.est.dead.toFixed(1)} 人</div>` : ''}
      <div class="row"><button data-act="fight" data-id="${t.id}">親自打</button><button data-act="resolve" data-id="${t.id}">現在自動結算</button></div></div>`; }).join('') : '<p class="muted">沒有待處理的任務票。</p>';
  $('co-cases').innerHTML = G.cases.length ? G.cases.map(c => {
    const st = c.settled ? (c.own ? '車隊已回到總部' : `已結案${c.payout ? `・尾款 $${c.payout}` : ''}`) : c.own ? `來回中・約 ${fmtH(c.end - h)}後回到總部` : c.open ? `出票中・${fmtH(c.end - 24 - h)}後停止出票` : `收尾中・${fmtH(c.end + 24 - h)}後結算`;
    return `<div class="card"><h4><a href="#" data-center="${c.tile}">${esc(c.title)}</a><span class="mini">${c.own ? '採購' : '●'.repeat(c.lv) + '○'.repeat(3 - c.lv)}</span></h4>
      <div class="mini">${st}${c.own ? '' : `・積分 ${c.score}・全案已出 ${c.tickets} 張票`}${c.kind === 'route' ? `・車隊 ${c.convoys - c.lost}/${c.convoys}` : ''}${c.own ? '' : `・訂金 $${c.pay.deposit}/隊、期中 $${c.pay.mid}/隊、尾款池 $${c.pay.final}`}</div>
      ${c.own && !c.squads.length ? '<div class="mini">沒有護衛，路上出事由雇來的車隊守衛自己打。</div>' : ''}
      ${c.squads.map(sq => { const cl = sq.clones.map(u => G.roster.find(x => x.uid === u)).filter(Boolean), al = cl.filter(x => x.alive).length;
        const sts = sq.busy ? '打任務票中' : sq.readyAt > h ? `行軍中，${fmtH(sq.readyAt - h)}後到位` : '待命中';
        return `<div style="margin-top:6px"><b>${esc(sq.name)}</b> <span class="mini">${c.settled ? '' : sts}・${al} 人${sq.pending.length ? `・補員 ${sq.pending.map(p => `${p.n} 人 ${fmtH(p.eta - h)}後到`).join('、')}` : ''}${sq.refused ? '・<span style="color:var(--war)">雇主不准再補人</span>' : ''}</span>
        <div class="chips">${cl.map(x => chip(x, false)).join('')}</div>
        ${!c.settled ? recallBtn({recall: {type: 'squad', id: sq.id, penalty: c.own ? 0 : c.pay.deposit + (c.midPaid ? c.pay.mid : 0) + 10 * c.lv}, kind: c.own ? 'escort' : 'squad', busy: !!sq.busy}) : ''}
        ${sq.pending.map(p => recallBtn({recall: {type: 'column', id: p.id}, kind: 'column', n: p.n})).join('')}
        ${!c.own && !c.settled && c.open && al < 4 && !sq.refused ? (pickRe && pickRe.squad === sq.id ? rePicker(4 - al - sq.pending.reduce((a, p) => a + p.n, 0)) : `<div class="row"><button data-act="re" data-id="${sq.id}">契約變更：補員</button></div>`) : ''}</div>`; }).join('')}</div>`; }).join('') : '<p class="muted">還沒接案。到戰略地圖的「機會」分頁挑一個點，按「接案」。</p>';
  $('co-vatinfo').textContent = `${G.vats} 座・每個 ${G.buildH} 小時`;
  $('co-mats').innerHTML = `<table class="mats"><tr><td class="muted">素材</td><td class="muted">庫存</td><td class="muted">總部單價</td><td></td></tr>` + MATS.map(m => `<tr><td>${MN[m]}</td><td>${G.mats[m]}</td><td>$${G.prices[m]}</td><td><button data-act="buy" data-mat="${m}" data-q="100">+100（$${Math.round(G.prices[m] * 100)}）</button></td></tr>`).join('') + '</table>';
  $('co-queue').textContent = G.queue.length ? G.queue.map(q => `${q.tpl ? CLS[q.tpl].n + '模板' : '培養中'}：${fmtH(q.done - h)}後出槽`).join('・') : `空著 ${G.vats} 座`;
  $('co-tpl').innerHTML = G.templates.length ? `<div class="mini" style="margin-top:8px">模板（保證拿到這一位，數值固定在約前 20%）：</div>` + G.templates.map(t => `<div class="row"><span class="chip static"><img src="${img(t.portrait)}" alt="">${CLS[t.cls].n}</span><span class="mini">${MATS.map(m => `${MN[m]} ${t.recipe[m]}`).join('・')}</span><button data-act="tpl" data-id="${t.id}">用模板培養</button></div>`).join('') : '';
  renderProc();
  const RF = {home: '待命', away: '出勤', keep: '供在家裡', kia: '陣亡', all: '全部'};
  const inF = (c, f = rosterF) => f === 'all' || (f === 'keep' ? c.keep && c.alive : f === 'home' ? c.status === 'home' && !c.keep : f === 'away' ? c.status === 'away' || c.status === 'returning' : c.status === f);
  $('co-rf').innerHTML = Object.entries(RF).map(([k, n]) => `<button data-rf="${k}" class="${rosterF === k ? 'on' : ''}">${n} <span class="muted">${G.roster.filter(c => inF(c, k)).length}</span></button>`).join('');
  $('co-rcount').textContent = `活著 ${alive.length}・陣亡 ${G.roster.length - alive.length}`;
  const R = G.roster.filter(c => inF(c)).sort((a, b) => b.pct - a.pct);
  $('co-roster').innerHTML = R.map(c => `<div class="cl${c.alive ? '' : ' kia'}${c.uid === G.fresh ? ' fresh' : ''}"><img src="${img(c.portrait)}" alt=""><div><b>${c.id}</b> ${CLS[c.cls].n}${crownTag(c)}</div>
    <div class="st">生命 ${c.st.hp}・命中 ${sg(c.st.acc)}・閃避 ${sg(c.st.eva)}・近戰 ${sg(c.st.mel)}</div><div class="st">前 ${Math.max(1, Math.round((1 - c.pct) * 100))}%・${STATUS[c.status] || c.status}${c.squad && c.status === 'away' ? '・' + esc(c.squad) : ''}・出勤 ${c.missions} 次</div>
    ${c.alive && c.status === 'home' ? `<button class="keep${c.keep ? ' on' : ''}" data-act="keep" data-id="${c.uid}" title="供在家裡的不會被派出去">${c.keep ? '供著' : '供'}</button>` : ''}</div>`).join('') || '<p class="muted">沒有。</p>';
}

// ───── 通知：收在右上角的信封，點開一疊卡片 ─────
const mailSeen = new Set(); let mailFirst = true, mailSig = '';
const MK = {ticket: '任務票', result: '戰果', pay: '結案', move: '調動', refused: '雇主', kia: '陣亡', vat: '培養槽', log: '公司'};
function mailItems() {
  if (!GV || !GM) return [];
  const a = [...GM.inbox.map(x => ({h: x.t, kind: x.kind, text: x.text})), ...GV.log.map(x => ({h: x.h, kind: /陣亡/.test(x.text) ? 'kia' : /出槽/.test(x.text) ? 'vat' : /結案|回到總部/.test(x.text) ? 'pay' : 'log', text: x.text}))];
  a.sort((p, q) => q.h - p.h); return a.slice(0, 60).map(x => ({...x, sig: x.h + '|' + x.text}));
}
function renderMail() {
  const items = mailItems();
  if (mailFirst && items.length) { for (const x of items) if (x.kind === 'log' && x.h === 0) mailSeen.add(x.sig); mailFirst = false; }
  const open = !$('mail').hidden;
  const unread = items.filter(x => !mailSeen.has(x.sig)).length;
  $('mailN').hidden = !unread || open; $('mailN').textContent = unread > 99 ? '99+' : unread;
  if (!open) return;
  const sig = items.length + ':' + (items[0]?.sig || ''); if (sig === mailSig) return; mailSig = sig;
  $('mailSub').textContent = `最近 ${items.length} 則`;
  $('mailBody').innerHTML = items.map(x => `<div class="msg ${x.kind}${mailSeen.has(x.sig) ? '' : ' new'}"><div class="mh"><b>${MK[x.kind] || '通知'}</b><span>${fmtH(x.h)}</span></div>${esc(x.text)}</div>`).join('') || '<p class="muted">沒有通知。</p>';
}
function closeMail() { $('mail').hidden = true; for (const x of mailItems()) mailSeen.add(x.sig); renderMail(); }
$('mailBtn').onclick = e => { e.stopPropagation(); if (!$('mail').hidden) { closeMail(); return; } $('mail').hidden = false; mailSig = ''; renderMail(); };
$('mailClose').onclick = closeMail;
document.addEventListener('pointerdown', e => { if (!$('mail').hidden && !e.target.closest('#mail,#mailBtn')) closeMail(); });

// ───── 召回（兩段式確認：第一下變成「確定？」，三秒內再按一下才送出） ─────
let selPath = null, armed = null, armT = null;
function recallBtn(u) {
  if (!u.recall) return '';
  const key = u.recall.type + ':' + u.recall.id, on = armed === key;
  const txt = u.recall.type === 'column' ? `撤回補員${u.n ? `（${u.n} 人）` : ''}` : u.kind === 'escort' ? '召回護衛' : `召回（毀約，違約金 $${u.recall.penalty}）`;
  return `<div class="row"><button class="${on ? 'warn' : ''}" data-recall="${key}">${on ? '確定召回？' : txt}</button>${u.busy && u.recall.type === 'squad' ? '<span class="mini">手上的任務票會交給案件的護衛去打</span>' : ''}</div>`;
}
function recallClick(e) {
  const b = e.target.closest('[data-recall]'); if (!b) return false;
  const key = b.dataset.recall, [type, id] = key.split(/:(.+)/);
  if (armed !== key) { armed = key; clearTimeout(armT); armT = setTimeout(() => { armed = null; if (page === 'co') renderCo(); else renderTile(); }, 3000); }
  else { armed = null; clearTimeout(armT); send(type === 'column' ? {type: 'recallCol', amend: id} : {type: 'recall', squad: id}); }
  if (page === 'co') renderCo(); else renderTile();
  return true;
}

// ───── 採購路線 ─────
let QT = null, procSel = null;
function renderProc() {
  const el = $('co-proc'); if (!el) return;
  if (el.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;   // 正在輸入，先不重畫
  if (!QT) { el.innerHTML = '<p class="muted">查詢各城報價中…</p>'; return; }
  const cell = (q, m) => { const o = q.offer?.[m]; return !o || o.max <= 0 ? '<span class="muted">—</span>' : `$${o.price}`; };
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
      <span>買</span><select data-pf="mat">${mats.map(m => `<option value="${m}"${m === procSel.mat ? ' selected' : ''}>${MN[m]}（$${q.offer[m].price}，最多 ${q.offer[m].max}）</option>`).join('')}</select>
      <span>數量</span><input type="number" min="10" step="100" value="${procSel.qty}" data-pf="qty">
      <span>花費</span><span>貨款 $${o ? Math.round(o.price * procSel.qty) : 0} ＋ 雇車隊 $${q.fee} ＝ <b>$${cost}</b>${cost > GV.cash ? ' <span class="neg">錢不夠</span>' : ''}</span>
      <span>護衛</span><span class="chips" style="margin:0">${av.map(c => chip(c, procSel.uids.has(c.uid), 'pu')).join('') || '<span class="muted">沒有待命的人</span>'}</span></div>
      <div class="row"><button class="primary" data-act="proc-go">出發（${procSel.uids.size >= 2 ? `護衛 ${procSel.uids.size} 人` : '不帶護衛'}）</button><button data-act="proc-x">取消</button><span class="mini">至少兩人才成隊；不帶護衛時，出事由雇來的守衛自己打。</span></div>`;
  }
  el.innerHTML = html;
}

// ───── 報表 ─────
const FK = [['deposit', '訂金'], ['mid', '期中款'], ['final', '尾款'], ['upkeep', '維持費'], ['buy', '本地買料'], ['trip', '採購路線']];
function renderRepPage() {
  const P = $('pane-rep');
  if (!GV) { P.innerHTML = '<div class="box"><h3 class="sec">報表</h3><p class="muted">開了公司之後才有報表。</p></div>'; return; }
  if (!$('co-rep')) P.innerHTML = `<div class="cohead"><div><div class="mini">${esc(GV.name)}・總部 ${esc(GV.baseName)}</div><div class="big" id="rep-cash"></div></div></div><div class="box"><h3 class="sec">報表</h3><div id="co-rep"></div></div>`;
  $('rep-cash').textContent = `$${GV.cash}`; $('rep-cash').classList.toggle('neg', GV.cash < 0);
  renderRep();
}
function renderRep() {
  const el = $('co-rep'); if (!el) return;
  const R = GV.report, money = v => `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${Math.round(v || 0)}</span>`;
  const tot = o => FK.reduce((x, [k]) => x + (o[k] || 0), 0);
  let html = `<div class="mini">現金走勢（每天一點）</div><div class="spark" id="co-spark">${sparkSvg(R.daily, Math.max(280, (el.clientWidth || 320) - 4), 180)}</div>`;
  html += `<table class="rep" style="margin-top:8px"><tr><th>收支</th><th>近 30 天</th><th>累計</th></tr>` + FK.map(([k, n]) => `<tr><td>${n}</td><td>${money(R.d30[k])}</td><td>${money(R.all[k])}</td></tr>`).join('') +
    `<tr class="tot"><td>現金合計</td><td>${money(tot(R.d30))}</td><td>${money(tot(R.all))}</td></tr><tr><td class="muted">帳面業務損失（陣亡）</td><td>${money(R.d30.loss)}</td><td>${money(R.all.loss)}</td></tr></table>`;
  html += `<div class="mini" style="margin-top:10px">結案紀錄</div>` + (R.hist.length ? `<table class="rep"><tr><th>案件</th><th>票（勝／自動）</th><th>陣亡</th><th>收入</th></tr>` + R.hist.slice(0, 15).map(c => `<tr><td>${esc(c.title)}${c.delivered !== undefined ? ` <span class="mini">送達 ${Math.round(c.delivered * 100)}%</span>` : ''}</td><td>${c.tickets}（${c.wins}／${c.auto}）</td><td>${c.dead || ''}</td><td>${c.own ? '<span class="muted">—</span>' : money(c.income + c.upkeep)}</td></tr>`).join('') + '</table>' : '<p class="muted">還沒有結案。</p>');
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
    <text x="${pl - 4}" y="${Y(hi) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(hi)}</text>
    <text x="${pl - 4}" y="${Y(lo) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(lo)}</text>
    <text x="${pl}" y="${H - 4}" font-size="10" fill="var(--muted)">第 ${Math.round(D[0].h / 24)} 天</text><text x="${W - pr}" y="${H - 4}" text-anchor="end" font-size="10" fill="var(--muted)">第 ${Math.round(D[D.length - 1].h / 24)} 天</text>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <line class="xh" x1="0" x2="0" y1="${pt}" y2="${H - pb}" stroke="var(--muted)" stroke-width="1" visibility="hidden" vector-effect="non-scaling-stroke"/></svg><div class="tt" hidden></div>`;
}
$('pane-co').addEventListener('pointermove', e => {
  const box = e.target.closest('#co-spark'); if (!box || !GV) return; const svg = box.querySelector('svg'); if (!svg) return;
  const D = GV.report.daily, r = svg.getBoundingClientRect(), W = +svg.dataset.w, iw = W - 46, fx = (e.clientX - r.left) / r.width * W, i = Math.max(0, Math.min(D.length - 1, Math.round((fx - 40) / iw * (D.length - 1))));
  const x = 40 + iw * i / (D.length - 1), tt = box.querySelector('.tt'), xh = svg.querySelector('.xh');
  xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
  tt.hidden = false; tt.textContent = `第 ${Math.round(D[i].h / 24)} 天　$${D[i].cash}　活著 ${D[i].alive}`; tt.style.left = Math.min(r.width - tt.offsetWidth, Math.max(0, x / W * r.width - tt.offsetWidth / 2)) + 'px'; tt.style.top = '0px';
});
$('pane-co').addEventListener('pointerleave', () => { const b = $('co-spark'); if (b) { const tt = b.querySelector('.tt'); if (tt) tt.hidden = true; b.querySelector('.xh')?.setAttribute('visibility', 'hidden'); } }, true);

// ───── 兩頁切換：上方按鈕，或左右滑 ─────
let page = 'map';
function showPage(p) {
  page = p; $('track').classList.toggle('co', p === 'co'); $('track').classList.toggle('rep', p === 'rep');
  for (const b of document.querySelectorAll('.pager button')) b.classList.toggle('on', b.dataset.page === p);
  if (p === 'co') renderCo(); else if (p === 'rep') renderRepPage(); else draw();
}
for (const b of document.querySelectorAll('.pager button')) b.onclick = () => showPage(b.dataset.page);
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
  const order = ['map', 'co', 'rep'], i = order.indexOf(page), j = i + (dx < 0 ? 1 : -1);
  if (j >= 0 && j < order.length) showPage(order[j]);
}, {passive: true});

const sg = v => (v > 0 ? '+' : '') + v;
const UNIT = {raider: '掠奪者', raider_heavy: '重武裝掠奪者', native: '原住民戰士', native_hunter: '原住民獵手', trooper: '士兵', trooper_heavy: '重裝士兵', clone_trooper: '複製兵'};
function rePicker(room) {
  const av = GV.roster.filter(c => c.alive && c.status === 'home' && !c.keep);
  return `<div class="picker"><div class="mini">從總部調人（還能補 ${room} 人，走過去要時間，路上可能遇襲）：</div><div class="chips">${av.map(c => chip(c, pickRe.uids.has(c.uid), 'rp')).join('') || '<span class="muted">總部沒有待命的人</span>'}</div>
    <div class="row"><button class="primary" data-act="re-go">送出契約變更（${pickRe.uids.size} 人）</button><button data-act="re-x">取消</button></div></div>`;
}
function renderOdds() { const o = classOdds(recipe); $('co-odds').innerHTML = Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${CLS[k].n} ${Math.round(v * 100)}%</span>`).join(''); }
$('pane-co').addEventListener('change', e => { const f = e.target.dataset.pf; if (!f || !procSel) return; procSel[f] = f === 'qty' ? Math.max(10, +e.target.value || 0) : e.target.value; renderProc(); });
$('pane-co').addEventListener('input', e => { const m = e.target.dataset.rc; if (!m) return; recipe[m] = Math.max(0, +e.target.value || 0); renderOdds(); });
// 任務票的「親自打」「現在自動結算」在按下去那一刻就送出：公司時間跑得快時清單每秒重畫好幾次，
// 按下與放開落在不同的按鈕上就不會有 click（2026-10-08 Alan 回報：按了親自打一直沒反應）
$('pane-co').addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-act="fight"],[data-act="resolve"]'); if (!b || e.button !== 0) return;
  e.preventDefault(); const id = b.dataset.id;
  if (b.dataset.act === 'fight') { send({type: 'fight', ticket: id}); showMissionLoading(); } else send({type: 'resolve', ticket: id});
});
$('pane-co').onclick = e => {
  if (recallClick(e)) return;
  const c = e.target.closest('[data-center]'); if (c && !e.target.closest('button')) { e.preventDefault(); select(+c.dataset.center, true, true); return; }
  const f = e.target.closest('[data-found]'); if (f) { found(+f.dataset.found); return; }
  const r = e.target.closest('[data-rf]'); if (r) { rosterF = r.dataset.rf; renderCo(); return; }
  const p = e.target.closest('[data-rp]'); if (p) { const u = +p.dataset.rp; pickRe.uids.has(u) ? pickRe.uids.delete(u) : pickRe.uids.add(u); renderCo(); return; }
  const q = e.target.closest('[data-qt]'); if (q) { const t = +q.dataset.qt; procSel = procSel && procSel.t === t ? null : {t, mat: '', qty: 100, uids: new Set()}; renderProc(); return; }
  const pu = e.target.closest('[data-pu]'); if (pu) { const u = +pu.dataset.pu; procSel.uids.has(u) ? procSel.uids.delete(u) : procSel.uids.add(u); renderProc(); return; }
  const b = e.target.closest('[data-act]'); if (!b) return; const A = b.dataset.act, id = b.dataset.id;
  if (A === 'qt-refresh') { QT = null; renderProc(); send({type: 'quotes'}); return; }
  if (A === 'proc-x') { procSel = null; renderProc(); return; }
  if (A === 'proc-go') { send({type: 'procure', town: procSel.t, mat: procSel.mat, qty: procSel.qty, uids: [...procSel.uids]}); procSel = null; setTimeout(() => send({type: 'quotes'}), 50); return; }
  if (A === 'buy') send({type: 'buy', mat: b.dataset.mat, qty: +b.dataset.q});
  else if (A === 'build') send({type: 'build', recipe: {...recipe}});
  else if (A === 'tpl') send({type: 'build', tpl: id});
  else if (A === 'keep') send({type: 'keep', uid: +id});
  else if (A === 'resolve' || A === 'fight') return;   // 上面 pointerdown 已經送出
  else if (A === 're') { pickRe = {squad: id, uids: new Set()}; renderCo(); }
  else if (A === 're-go') { send({type: 'reinforce', squad: pickRe.squad, uids: [...pickRe.uids]}); pickRe = null; }
  else if (A === 're-x') { pickRe = null; renderCo(); }
};

$('legend').innerHTML = '<span>機會：</span>' + Object.values(OK).map(v => `<span style="color:${v.c}">${v.ch} ${v.n}</span>`).join('') + '<span style="flex-basis:100%;height:0"></span>' + '<span><i style="background:#f1e6cf;border-radius:50%"></i>市鎮</span><span>★ 首府</span><span><i style="background:#6fd0d8;transform:rotate(45deg) scale(.8)"></i>培養槽</span><span><i style="background:#d9b86a"></i>廠區</span><span style="color:#ff5a3c">━ 戰線</span><span style="color:#c4593c">✕ 掠奪者</span><span style="color:#e0915a">▲ 原住民</span>';

const seed0 = new URL(location).searchParams.get('seed') || '奇美拉-1';
$('seed').value = seed0; start(seed0);
window.addEventListener('resize', () => { if (page === 'co' && GV) renderCo(); if (page === 'rep') { const P = $('pane-rep'); P.innerHTML = ''; renderRepPage(); } });

// ===== 親自打：ASH 的任務戰鬥直接跑在這個頁面裡（不用 iframe；public/ash/chimera-boot.js，由 chimera/ash/build.mjs 建置）。
// 頁面一打開就在背景把 ASH 載好（#ash-root 平常藏著）；每張票用 ASH_EMBED.start 換一場新的戰鬥，不重新初始化。
// 打完傳回 {win, dead}，交給 worker 的 submit；按「先不打」票還在。打的時候公司的時間停住。
let mission = null;
const ash = import('./ash/chimera-boot.js').then(m => m.bootAsh()).then(E => {
  E.onresult = (id, result) => { if (mission && mission.id === id) { send({type: 'submit', ticket: id, result}); mission = null; } };
  E.onabort = id => { if (mission && mission.id === id) { send({type: 'abort'}); mission = null; } };
  return E;
});
async function openMission(tk) { mission = {id: tk.id}; const E = await ash; hideMissionLoading(); E.start(tk); }
// ASH 還在背景載入時先蓋上一層「載入中」，按下去立刻有反應
let loadingBox = null;
function showMissionLoading() {
  if (window.ASH_EMBED?.renderer) return;
  loadingBox ??= Object.assign(document.createElement('div'), {id: 'mission-loading', innerHTML: '<b>載入戰鬥中…</b><span>第一次開戰要先把戰鬥程式載好，公司的時間已經停住。</span>'});
  document.body.appendChild(loadingBox);
}
function hideMissionLoading() { loadingBox?.remove(); }
