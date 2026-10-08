// 奇美拉沙盒觀看頁：背景的 worker 一年一年推演，畫面照選好的速度播放
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
  hist = []; allEvents = []; cur = 0; sel = -1; hiFac = -1; computing = true;
  $('computing').hidden = false; $('computing').textContent = '生成地形…'; $('more').hidden = true;
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'static') { ST = m; fit(); }
    else if (m.type === 'year') {
      hist.push(m.data); for (const ev of m.data.events) allEvents.push(ev);
      $('slider').max = hist.length - 1; $('computing').textContent = `推演到第 ${m.data.y} 年…`;
      if (hist.length === 1) { cur = 0; renderAll(); setPlaying(true); }
    } else if (m.type === 'idle') { computing = false; $('computing').hidden = true; $('more').hidden = false; }
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
for (const b of document.querySelectorAll('.layers button')) b.onclick = () => { const L = b.dataset.layer; layers[L] = !layers[L]; if (L === 'fac' && layers.fac) layers.pop = false; if (L === 'pop' && layers.pop) layers.fac = false; for (const x of document.querySelectorAll('.layers button')) x.classList.toggle('on', layers[x.dataset.layer]); draw(); };
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
  for (const x of g) html += `<p>${x.native ? '原住民' : '掠奪者據點'}：<b>${esc(x.name)}</b>（勢力 ${x.str}${x.legacy ? '，手上有遺產級' : ''}）</p>`;
  if (t) {
    html += `<h2 style="margin-top:10px">市鎮</h2><dl class="kv"><dt>服務人口</dt><dd>${t.pop}</dd>${t.lord ? `<dt>課長</dt><dd>${esc(t.lord)}</dd>` : ''}<dt>培養槽</dt><dd>${t.vat || '沒有'}</dd>${t.works ? '<dt>廠區</dt><dd>有</dd>' : ''}`;
    if (t.veh) html += `<dt>車庫</dt><dd>${Object.entries(t.veh).filter(([, v]) => v >= .5).map(([v, n]) => `${ST.vn[v]} ${Math.round(n)}`).join('・') || '空的'}</dd>`;
    html += '</dl><table class="stock"><tr><th>貨物</th><th>存量</th><th>滿足度</th></tr>' + ST.goods.map(gd => `<tr><td>${ST.gn[gd]}</td><td>${t.stock[gd]}</td><td style="color:${t.ratio[gd] < .8 ? 'var(--war)' : 'inherit'}">${Math.round(t.ratio[gd] * 100)}%</td></tr>`).join('') + '</table>';
  }
  $('pane-tile').innerHTML = html;
}
function renderOpp() {
  const s = hist[cur], O = (s.opps || []).slice().sort((a, b) => b.lv - a.lv || a.kind.localeCompare(b.kind));
  const cnt = k => O.filter(o => (k === 'all' || o.kind === k) && o.lv >= 2).length;
  let html = `<p class="muted" style="margin:0 0 8px">如果玩家此刻進場，沙盒會給出的事。外圈越粗越亮，程度越高（●●● 最高）。</p><div class="filters">` +
    [['all', '全部'], ...Object.entries(OK).map(([k, v]) => [k, v.n])].map(([k, n]) => `<button data-ok="${k}" class="${oppKind === k ? 'on' : ''}">${n} <span class="muted">${cnt(k)}</span></button>`).join('') + '</div>';
  const list = O.filter(o => oppKind === 'all' || o.kind === oppKind);
  html += '<ol class="log opp">' + list.map(o => { const K = OK[o.kind]; return `<li data-tile="${o.tile}" style="border-left-color:${K.c}"><span class="lv" style="color:${K.c}">${'●'.repeat(o.lv)}${'○'.repeat(3 - o.lv)}</span> <b style="color:${K.c}">${K.n}</b>　${esc(o.title)}<span class="yr" style="font-family:inherit;font-size:12px;color:var(--muted)">${esc(o.detail)}${o.risk ? `・風險 ${'▲'.repeat(o.risk)}` : ''}</span></li>`; }).join('') + '</ol>';
  $('pane-opp').innerHTML = html || '';
}
$('pane-opp').onclick = e => { const b = e.target.closest('button[data-ok]'); if (b) { oppKind = b.dataset.ok; renderOpp(); draw(); return; } const li = e.target.closest('li[data-tile]'); if (li) select(+li.dataset.tile, true, true); };
function renderGear() {
  const s = hist[cur];
  $('pane-gear').innerHTML = `<p class="muted" style="margin:0 0 10px">企業時代留下、再也造不出來的裝備。</p><ul class="gear" style="padding-left:18px">` + s.weapons.map(x => `<li><b>「${esc(x.name)}」</b>${esc(x.kind)}<br><span class="muted">${x.holder ? `在 ${esc(x.holder)} 手上` : x.fac ? `收在${esc(x.fac)}的軍械庫` : x.gang ? `在 ${esc(x.gang)} 手上` : x.lost ? `${x.sealed ? '封在' : '失落在'}${esc(ST.names[x.at] || '某處')}${x.sealed ? '的舊倉庫' : ''}` : ''}・易手 ${x.owners} 次・打贏 ${x.wins} 場</span></li>`).join('') + '</ul>';
}
function renderPanel() { if (!hist.length) return; const t = curTab(); if (t === 'opp') renderOpp(); else if (t === 'log') renderLog(); else if (t === 'fac') renderFac(); else if (t === 'tile') renderTile(); else renderGear(); }
function select(i, center, keep) { sel = i; if (center) centerOn(i); if (!keep) tab('tile'); draw(); }

function renderHeader() {
  const s = hist[cur], a = s.arc; $('yearNum').textContent = `第 ${s.y} 年`; $('slider').value = cur;
  $('phase').textContent = !a.ackY || s.y < a.ackY ? `等待接駁船（第 ${a.ackY || '?'} 年承認）` : a.fallY == null || s.y < a.fallY ? '承認：企業不會回來了' : !a.blocY || s.y < a.blocY ? '崩塌之後，各自為王' : '陣營對峙';
}
let lastPanelY = -1;
function renderAll() { renderHeader(); draw(); if (hist[cur].y !== lastPanelY || curTab() !== 'log') { lastPanelY = hist[cur].y; renderPanel(); } if (hover >= 0) showTip(mouse.x, mouse.y); }

$('legend').innerHTML = '<span>機會：</span>' + Object.values(OK).map(v => `<span style="color:${v.c}">${v.ch} ${v.n}</span>`).join('') + '<span style="flex-basis:100%;height:0"></span>' + '<span><i style="background:#f1e6cf;border-radius:50%"></i>市鎮</span><span>★ 首府</span><span><i style="background:#6fd0d8;transform:rotate(45deg) scale(.8)"></i>培養槽</span><span><i style="background:#d9b86a"></i>廠區</span><span style="color:#ff5a3c">━ 戰線</span><span style="color:#c4593c">✕ 掠奪者</span><span style="color:#e0915a">▲ 原住民</span>';

const seed0 = new URL(location).searchParams.get('seed') || '奇美拉-1';
$('seed').value = seed0; start(seed0);
