// 奇幻戰幫切片：畫面與操作
import {CLASSES, TRAITS, ORDERS, WEAPONS, TERRAIN} from './data.js';
import * as Wd from './world.js';
import * as B from './battle.js';
import * as C from './cont.js';

const $ = id => document.getElementById(id);
const SAVE = 'warband-v2';   // v2：世界換成大陸沙盒，沙盒狀態另存在 SAVE-sim
let G = {world: null, battle: null};

/* ───────────── 小工具 ───────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
function toast(text, ms = 2200) { const t = $('toast'); t.textContent = text; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); }
async function banner(text, ms = 700) { const b = $('banner'); b.textContent = text; b.classList.add('show'); await sleep(ms); b.classList.remove('show'); await sleep(150); }
function save(sim = true) { try { localStorage.setItem(SAVE, JSON.stringify(G)); if (sim && C.SIM) localStorage.setItem(SAVE + '-sim', JSON.stringify(C.saveState())); } catch (e) { console.warn('存檔失敗', e); } }
function loadSim() { try { const s = localStorage.getItem(SAVE + '-sim'); return s ? JSON.parse(s) : null; } catch { return null; } }
function load() { try { const s = localStorage.getItem(SAVE); return s ? JSON.parse(s) : null; } catch { return null; } }
function wipe() { try { localStorage.removeItem(SAVE); localStorage.removeItem(SAVE + '-sim'); } catch {} }
function show(id) { for (const s of ['title', 'world', 'battle']) $(s).hidden = s !== id; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const clsName = m => CLASSES[m.cls]?.name || m.cls;

/* ───────────── sprite ───────────── */
const SHEETS = {}; let ATLAS = {};
async function loadArt() {
  ATLAS = await (await fetch('art/atlas.json')).json();
  await Promise.all(['people', 'foes', 'props'].map(n => new Promise(ok => { const im = new Image(); im.onload = ok; im.onerror = ok; im.src = `art/${n}.png`; SHEETS[n] = im; })));
}
function sprite(ctx, ref, x, y, size, {flip = false, alpha = 1, gray = false} = {}) {
  if (!ref) return; const [sheet, name] = ref, p = ATLAS[sheet]?.[name], im = SHEETS[sheet]; if (!p || !im) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = false;
  if (gray) ctx.filter = 'grayscale(1) brightness(.7)';
  if (flip) { ctx.translate(x + size, y); ctx.scale(-1, 1); ctx.drawImage(im, p[0], p[1], 64, 64, 0, 0, size, size); }
  else ctx.drawImage(im, p[0], p[1], 64, 64, x, y, size, size);
  ctx.restore();
}
function avatar(ref, size = 56, flip = false) { const c = document.createElement('canvas'); c.width = c.height = 64; sprite(c.getContext('2d'), ref, 0, 0, 64, {flip}); c.style.width = c.style.height = size + 'px'; return c; }
function fit(canvas) { const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1; canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d); const g = canvas.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); return {g, w: r.width, h: r.height}; }

/* ───────────── 抽屜 ───────────── */
let sheetOnClose = null;
function openSheet(html, onClose) { $('sheetContent').innerHTML = ''; if (typeof html === 'string') $('sheetContent').innerHTML = html; else $('sheetContent').append(html); $('sheet').hidden = false; sheetOnClose = onClose || null; $('sheetClose').hidden = !!(onClose && onClose.locked); }
function closeSheet() { $('sheet').hidden = true; const f = sheetOnClose; sheetOnClose = null; if (f) f(); }
$('sheetClose').onclick = closeSheet;
$('sheet').addEventListener('click', e => { if (e.target === $('sheet') && !(sheetOnClose && sheetOnClose.locked)) closeSheet(); });
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'onclick') e.onclick = v; else if (k === 'html') e.innerHTML = v; else if (k === 'class') e.className = v; else if (v !== false && v != null) e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c); return e; };

/* ───────────── 人物卡 ───────────── */
function traitTags(m) { return (m.traits || []).map(t => el('span', {class: 'tag trait', onclick: () => toast(`${TRAITS[t].name}：${TRAITS[t].desc}`, 3500)}, TRAITS[t].name)); }
function memberCard(m, extra) {
  const hpPct = Math.round(m.hp / m.max * 100);
  return el('div', {class: 'card'}, avatar(m.sprite),
    el('div', {class: 'body'},
      el('div', {class: 'top'}, el('b', {}, m.name), el('span', {class: 'muted'}, `${clsName(m)} Lv${m.lvl}${m.hero ? '・你' : ''}`)),
      el('div', {class: 'meter'}, el('i', {style: `width:${hpPct}%;background:${hpPct < 40 ? 'var(--enemy)' : hpPct < 70 ? 'var(--warn)' : 'var(--ok)'}`})),
      el('div', {class: 'stats'}, ...[['生命', `${Math.round(m.hp)}/${m.max}`], ['力量', m.str], ['技巧', m.skl], ['速度', m.spd], ['防禦', m.def]].map(([k, v]) => el('span', {}, k + ' ', el('b', {}, v)))),
      el('div', {class: 'muted', style: 'font-size:12px'}, `${m.famous ? '有名者・' : ''}${m.gw || m.ga ? `${Wd.GEAR_NAME.w[m.gw || 0]}、${Wd.GEAR_NAME.a[m.ga || 0]}・` : ''}${WEAPONS[m.weapon].name}・經驗 ${m.exp}/100${m.wage ? `・週薪 ${m.wage}` : ''}${m.deeds ? `・${m.deeds.battles} 戰 ${m.deeds.kills} 殺` : ''}`),
      m.hero ? null : el('div', {style: 'display:flex;gap:6px;align-items:center;font-size:12px'}, el('span', {class: 'muted'}, '忠誠'), el('div', {class: 'meter loy', style: 'flex:1'}, el('i', {style: `width:${Math.max(0, m.loyalty)}%`})), el('span', {}, Math.round(m.loyalty))),
      el('div', {}, ...traitTags(m)),
      extra || null));
}

/* ───────────── 世界檔 ───────────── */
let PACK = null;
async function getPack() { if (!PACK) PACK = await (await fetch('data/genesis.json')).json(); return PACK; }

/* ───────────── 標題 ───────────── */
function titleScreen() {
  show('title');
  const s = load(); $('continueRun').hidden = !(s && s.world && !s.world.over);
}
$('newRun').onclick = async () => {
  const s = load(); if (s && s.world && !s.world.over && !confirm('會蓋掉目前的旅程，確定重新開始？')) return;
  $('newRun').disabled = true; $('newRun').textContent = '世界展開中…';
  try { C.loadPack(await getPack()); } finally { $('newRun').disabled = false; $('newRun').textContent = '踏上旅程'; }
  const seed = (Math.random() * 2 ** 31) | 0;
  G = {world: Wd.newWorld(seed, $('heroName').value.trim() || '無名的騎士'), battle: null};
  cam = null; save(); worldScreen();
};
$('continueRun').onclick = async () => {
  $('continueRun').disabled = true;
  try { C.loadPack(await getPack()); const st = loadSim(); if (st) C.loadState(st); } finally { $('continueRun').disabled = false; }
  G = load(); cam = null; if (G.battle) battleScreen(); else worldScreen();
};

/* ═════════════ 大地圖（大陸） ═════════════ */
let wsel = null, traveling = false, cam = null, mapSize = {w: 1, h: 1};
const SQ3 = Math.sqrt(3);
function worldScreen() { show('world'); wsel = null; renderWorld(); afterWorldAction(); }
// 鏡頭：世界座標以「六角半徑 = 1」為單位，cam.s 是半徑的像素數
const wxy = i => { const q = C.col(i), r = C.row(i); return [SQ3 * (q + 0.5 * (r & 1)), 1.5 * r]; };
function ensureCam() {
  if (cam) return;
  const [x, y] = wxy(G.world.pos); cam = {x, y, s: Math.max(18, Math.min(30, mapSize.w / 15))};
}
const scr = i => { const [x, y] = wxy(i); return [(x - cam.x) * cam.s + mapSize.w / 2, (y - cam.y) * cam.s + mapSize.h / 2]; };
function clampCam() {
  const minS = Math.min(mapSize.w / (SQ3 * (Wd.W + 0.5)), mapSize.h / (1.5 * Wd.H + 0.5));
  cam.s = Math.max(minS, Math.min(56, cam.s));
  cam.x = Math.max(0, Math.min(SQ3 * (Wd.W + 0.5), cam.x)); cam.y = Math.max(0, Math.min(1.5 * Wd.H, cam.y));
}
function followParty() { const [px, py] = scr(G.world.pos), m = Math.min(mapSize.w, mapSize.h) * 0.18; if (px < m || py < m || px > mapSize.w - m || py > mapSize.h - m) { const [x, y] = wxy(G.world.pos); cam.x = x; cam.y = y; } }
function hexPath(g, cx, cy, s) { g.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); g.lineTo(cx + s * Math.cos(a), cy + s * Math.sin(a)); } g.closePath(); }
function renderStatus() {
  const w = G.world;
  $('wTime').textContent = Wd.timeText(w);
  $('wGold').textContent = w.gold;
  const fd = Wd.daysOfFood(w); $('wFood').textContent = `${w.food.toFixed(0)}（${fd.toFixed(1)} 天）`; $('wFood').style.color = fd < 2 ? 'var(--enemy)' : '';
  $('wLoad').textContent = `${Wd.load(w)}/${Wd.capacity(w)}`;
}
let showDanger = false;
const RISKCOL = r => r < 0.15 ? '#9fd18a' : r < 0.4 ? '#f1c45c' : '#f0705a';
function renderWorld() {
  const w = G.world; if (!w) return;
  renderStatus();
  const {g, w: cw, h: ch} = fit($('map')); mapSize = {w: cw, h: ch}; ensureCam(); clampCam();
  const k = C.K(), s = cam.s, SEEN = i => Wd.seen(w, i);
  g.fillStyle = '#10243a'; g.fillRect(0, 0, cw, ch);
  const vis = [];
  for (let i = 0; i < Wd.N; i++) { const [x, y] = scr(i); if (x < -s * 2 || y < -s * 2 || x > cw + s * 2 || y > ch + s * 2) continue; vis.push([i, x, y]); }
  const winter = k.season === 3;
  // 地形與國土（沒去過的地方是一片空白）
  for (const [i, x, y] of vis) {
    if (!SEEN(i)) { hexPath(g, x, y, s * 1.01); g.fillStyle = '#1d1813'; g.fill(); hexPath(g, x, y, s * 0.96); g.strokeStyle = '#2a231b'; g.lineWidth = 1; g.stroke(); continue; }
    const b = k.biome[i]; hexPath(g, x, y, s * 1.01); g.fillStyle = Wd.BIOMES[b].c; g.fill();
    const o = k.owner[i]; if (o >= 0) { g.fillStyle = k.fac[o].c + '40'; g.fill(); }
    if (winter && Wd.coldAt(i) && C.land(i)) { g.fillStyle = '#ffffff38'; g.fill(); }
    if (showDanger && C.land(i)) { const r = Wd.tileRisk(i, k); if (r > 0.12) { hexPath(g, x, y, s * 0.98); g.fillStyle = `rgba(208,60,40,${Math.min(0.55, r * 0.6)})`; g.fill(); } }
    if (s >= 16) {
      if (b === 6) sprite(g, ['props', 'tree'], x - s * 0.5, y - s * 0.6, s, {alpha: 0.75});
      if (b === 3 || b === 2) { g.fillStyle = b === 2 ? '#f4f6f7' : '#9a948c'; g.beginPath(); g.moveTo(x - s * 0.55, y + s * 0.35); g.lineTo(x - s * 0.05, y - s * 0.5); g.lineTo(x + s * 0.5, y + s * 0.35); g.fill(); }
      if (b === 4) { g.strokeStyle = '#6e6a4588'; g.lineWidth = 1.5; g.beginPath(); g.arc(x - s * 0.2, y + s * 0.2, s * 0.28, Math.PI, 0); g.arc(x + s * 0.25, y + s * 0.25, s * 0.22, Math.PI, 0); g.stroke(); }
    }
    if (C.river(i) && C.land(i)) { g.fillStyle = k.season === 0 ? '#7fb8ee' : '#5a96d2'; g.beginPath(); g.arc(x, y, s * (k.season === 0 ? 0.18 : 0.13), 0, 7); g.fill(); }
  }
  // 國界；交戰國之間的邊界畫成紅色的戰線
  const edge = (x, y, n, col, wd) => { const [nx, ny] = scr(n), a = Math.atan2(ny - y, nx - x); g.strokeStyle = col; g.lineWidth = wd; g.beginPath(); g.moveTo(x + s * Math.cos(a - Math.PI / 6), y + s * Math.sin(a - Math.PI / 6)); g.lineTo(x + s * Math.cos(a + Math.PI / 6), y + s * Math.sin(a + Math.PI / 6)); g.stroke(); };
  for (const [i, x, y] of vis) { const o = k.owner[i]; if (o < 0 || !SEEN(i)) continue;
    for (const n of Wd.NBR[i]) { const e = k.owner[n]; if (e === o) continue;
      const atWar = e >= 0 && k.war[Math.min(e, o)][Math.max(e, o)];
      edge(x, y, n, atWar ? '#e0402a' : '#140f0bcc', atWar ? Math.max(2.5, s * 0.16) : Math.max(1.5, s * 0.09)); } }
  // 商路
  g.strokeStyle = '#d8bf86'; g.lineWidth = Math.max(1.5, s * 0.1); g.lineCap = 'round';
  for (const [i, x, y] of vis) if (SEEN(i) && k.routeTiles.has(i)) for (const n of Wd.NBR[i]) if (n > i && SEEN(n) && k.routeTiles.has(n)) { const [nx, ny] = scr(n); g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke(); }
  // 規劃中的路線：每一段依危險上色
  if (wsel && wsel.path) { let prev = scr(w.pos); g.lineWidth = Math.max(3, s * 0.16); g.setLineDash([6, 4]);
    for (const p of wsel.path) { const q = scr(p); g.strokeStyle = SEEN(p) ? RISKCOL(Wd.tileRisk(p, k)) : '#cfc4b0'; g.beginPath(); g.moveTo(...prev); g.lineTo(...q); g.stroke(); prev = q; } g.setLineDash([]); }
  // 村莊、城鎮、山寨
  const label = (text, x, y, color, size) => { g.font = `600 ${size}px system-ui`; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = '#000b'; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y); };
  for (const [i, x, y] of vis) {
    if (!SEEN(i)) continue;
    if (Wd.isTown(i, k)) { const z = s * 1.35, fc = k.fac[k.owner[i]].c, cap = k.fac[k.owner[i]].cap === i;
      g.fillStyle = fc; g.strokeStyle = '#140f0b'; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y + s * 0.18, s * 0.62, s * 0.3, 0, 0, 7); g.fill(); g.stroke();
      sprite(g, ['props', 'tower'], x - z / 2, y - z * 0.7, z);
      g.fillStyle = fc; g.beginPath(); g.moveTo(x + s * 0.1, y - z * 0.72); g.lineTo(x + s * 0.1, y - z * 0.98); g.lineTo(x + s * 0.5, y - z * 0.88); g.lineTo(x + s * 0.1, y - z * 0.8); g.fill(); g.strokeStyle = '#140f0b'; g.lineWidth = 1; g.stroke();
      label((cap ? '★' : '') + nm(i), x, y + s * 0.95, fc, Math.max(10, s * 0.46));
      if (w.intel[i]) { g.fillStyle = '#d9a441'; g.beginPath(); g.arc(x + s * 0.55, y - s * 0.55, Math.max(2.5, s * 0.12), 0, 7); g.fill(); }
      if (k.markets[i].ratio?.food < 0.8) label('饑荒', x, y - s * 0.75, '#ff8a6e', Math.max(9, s * 0.38)); }
    else if (s >= 24 && k.owner[i] >= 0 && k.pop[i] >= 8) sprite(g, ['props', 'cottage'], x - s * 0.28, y - s * 0.3, s * 0.56, {alpha: 0.6});
    const gg = Wd.gangAt(i, k); if (gg) { const z = s * 1.1; sprite(g, ['props', 'banner'], x - z / 2, y - z * 0.65, z); if (s >= 16) label(gg.name + '寨', x, y + s * 0.95, '#f3b2a6', Math.max(9, s * 0.4)); }
  }
  // 委託地點、傳聞、聽說的事
  const mark = (i, text, col) => { const [x, y] = scr(i); g.fillStyle = col; g.beginPath(); g.arc(x + s * 0.5, y + s * 0.45, Math.max(6, s * 0.26), 0, 7); g.fill(); g.strokeStyle = '#000a'; g.lineWidth = 1.5; g.stroke(); g.fillStyle = '#1b150d'; g.font = `800 ${Math.max(8, s * 0.3)}px system-ui`; g.textAlign = 'center'; g.fillText(text, x + s * 0.5, y + s * 0.45 + Math.max(3, s * 0.11)); };
  for (const p of w.pins || []) if (w.day - p.day < 12) mark(p.tile, '!', '#e9dcbf');
  for (const c of w.contracts) { const t = Wd.contractSite(w, c); if (t >= 0 && (c.taken || c.kind === 'deliver') && !c.done) mark(t, Wd.KIND_NAME[c.kind][0], '#f1c45c'); if (c.done) mark(c.town, '賞', '#9fd18a'); }
  for (const L of w.leads || []) mark(L.center, '?', '#b6e3a8');
  // 視野內的商隊、運貨車、軍隊、巡邏隊
  const R = Wd.viewRadius(w);
  if (s >= 12) { g.strokeStyle = '#f1d38a55'; g.setLineDash([2, 5]); g.lineWidth = 1.5; for (const [i, x, y] of vis) if (Wd.hdist(i, w.pos) === R) { hexPath(g, x, y, s * 0.98); g.stroke(); } g.setLineDash([]); }
  const UNIT = {caravan: ['people', 'merchant'], cart: ['props', 'cart'], patrol: ['people', 'spearman'], army: ['people', 'knight']};
  const stack = {};
  for (const u of Wd.unitsInView(w)) {
    const n = stack[u.pos] = (stack[u.pos] || 0) + 1; if (n > 3) continue;
    const [x0, y0] = scr(u.pos), x = x0 + (n - 2) * s * 0.42, y = y0 - s * 0.05, fc = k.fac[u.fac]?.c || '#aaa', z = u.kind === 'army' ? s * 0.95 : s * 0.7;
    g.fillStyle = fc + 'cc'; g.beginPath(); g.arc(x, y + z * 0.28, z * 0.42, 0, 7); g.fill(); g.strokeStyle = '#140f0b'; g.lineWidth = 1.5; g.stroke();
    sprite(g, UNIT[u.kind], x - z / 2, y - z * 0.45, z, {alpha: u.kind === 'cart' ? 0.85 : 1});
    if (u.n > 1 && s >= 14) { g.fillStyle = '#140f0b'; g.beginPath(); g.arc(x + z * 0.38, y - z * 0.3, Math.max(6, s * 0.2), 0, 7); g.fill(); g.fillStyle = '#f6ecd4'; g.font = `700 ${Math.max(8, s * 0.24)}px system-ui`; g.textAlign = 'center'; g.fillText(u.n, x + z * 0.38, y - z * 0.3 + Math.max(3, s * 0.08)); }
    if (u.kind === 'army') { g.fillStyle = fc; g.fillRect(x + z * 0.25, y - z * 0.7, z * 0.32, z * 0.2); g.strokeStyle = '#140f0b'; g.lineWidth = 1; g.strokeRect(x + z * 0.25, y - z * 0.7, z * 0.32, z * 0.2); }
  }
  // 遊蕩的隊伍：視野內才看得到；在追你的會標出來
  for (const b of w.bands) { if (b.pos < 0 || (!b.hunting && Wd.hdist(b.pos, w.pos) > R)) continue; const [x, y] = scr(b.pos); g.fillStyle = b.hunting ? '#e0402a99' : '#d0533f66'; g.beginPath(); g.arc(x, y, s * 0.62, 0, 7); g.fill(); sprite(g, b.kind === 'wolves' ? ['foes', 'wolf'] : ['foes', 'bandit'], x - s * 0.55, y - s * 0.65, s * 1.1, {flip: true});
    if (b.hunting) { label('追兵', x, y - s * 0.7, '#ff8a6e', Math.max(9, s * 0.36)); const [px, py] = scr(w.pos); g.strokeStyle = '#e0402a88'; g.setLineDash([3, 4]); g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(px, py); g.stroke(); g.setLineDash([]); } }
  // 玩家
  const [px, py] = scr(w.pos);
  g.strokeStyle = w.escort ? '#9fd18a' : '#d9a441'; g.lineWidth = 2.5; g.beginPath(); g.arc(px, py, s * 0.72, 0, 7); g.stroke();
  sprite(g, ['people', 'knight'], px - s * 0.6, py - s * 0.7, s * 1.2);
  if (w.escort && s >= 16) label('護送中', px, py + s * 0.98, '#bfe3b0', Math.max(9, s * 0.36));
  if (wsel) { hexPath(g, ...scr(wsel.pos), s * 0.97); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
}
const nm = i => C.nm(i);
function pickHex(x, y) { let best = null, bd = Infinity; for (let i = 0; i < Wd.N; i++) { const [cx, cy] = scr(i), d = (cx - x) ** 2 + (cy - y) ** 2; if (d < bd) { bd = d; best = i; } } return bd < (cam.s * 1.05) ** 2 ? best : null; }
// 拖曳平移、雙指縮放、滾輪縮放；沒有拖動就當成點擊
{
  const ptrs = new Map(); let moved = 0, pinch = null, raf = 0;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderWorld(); }); };
  const map = $('map');
  map.addEventListener('pointerdown', e => { map.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = ptrs.size > 1 ? 99 : 0; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = {d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: cam.s}; } });
  map.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId) || !cam) return; const [ox, oy] = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) { moved += Math.abs(e.clientX - ox) + Math.abs(e.clientY - oy); if (moved > 6) { cam.x -= (e.clientX - ox) / cam.s; cam.y -= (e.clientY - oy) / cam.s; redraw(); } }
    else if (ptrs.size === 2 && pinch) { const [a, b] = [...ptrs.values()]; cam.s = pinch.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d; redraw(); }
  });
  const up = e => {
    if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0 && moved <= 6 && !traveling && cam) { const r = map.getBoundingClientRect(), p = pickHex(e.clientX - r.left, e.clientY - r.top); if (p != null) selectHex(p); }
  };
  map.addEventListener('pointerup', up); map.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); pinch = null; moved = 99; });
  map.addEventListener('wheel', e => { e.preventDefault(); if (!cam) return; cam.s *= e.deltaY < 0 ? 1.15 : 1 / 1.15; redraw(); }, {passive: false});
}
function selectHex(p) {
  const w = G.world, here = p === w.pos;
  wsel = {pos: p, path: here ? null : Wd.findPath(w, w.pos, p)}; renderWorld(); hexInfo();
}
const strength = (foes) => { const r = Wd.partyPower(foes) / Math.max(1, Wd.partyPower(G.world.party)); return r < 0.5 ? ['弱', 'good'] : r < 0.85 ? ['稍弱', 'good'] : r < 1.15 ? ['相當', 'warn'] : r < 1.6 ? ['強', 'bad'] : ['很強', 'bad']; };
function foeSummary(foes) { const c = {}; for (const f of foes) c[clsName(f)] = (c[clsName(f)] || 0) + 1; return Object.entries(c).map(([k, n]) => `${k}×${n}`).join('、'); }
const gangWord = str => str > 260 ? '人多勢眾' : str > 160 ? '有一定規模' : '人不多';
let infoFolded = false;
$('hexInfo').addEventListener('click', e => { if (e.target.closest('.row') && !e.target.closest('button')) { infoFolded = !infoFolded; $('hexInfo').classList.toggle('folded', infoFolded); const f = $('hexInfo').querySelector('.fold'); if (f) f.textContent = infoFolded ? '▸' : '▾'; } });
function hexInfo() {
  const w = G.world, box = $('hexInfo'), k = C.K(); box.innerHTML = '';
  box.style.bottom = ($('world').querySelector('.bar').offsetHeight + 8) + 'px';
  box.classList.toggle('folded', !!infoFolded);
  const p = wsel ? wsel.pos : w.pos, here = p === w.pos;
  if (!Wd.seen(w, p)) {
    box.append(el('div', {class: 'row'}, el('span', {class: 'fold'}, infoFolded ? '▸' : '▾'), el('b', {}, '未知之地'), el('span', {class: 'tag'}, '沒去過，也沒人說過')));
    const row = el('div', {class: 'rowbtn'});
    if (wsel?.path) { const hrs = Wd.pathHoursW(w, wsel.path); box.append(el('div', {class: 'muted'}, `${wsel.path.length} 格，粗估 ${(hrs / 24).toFixed(1)} 天。路上的情況不清楚。`)); row.append(el('button', {class: 'primary', onclick: () => travel(wsel.path)}, '前往')); }
    else box.append(el('div', {class: 'muted'}, '看起來走不過去。'));
    box.append(row); return;
  }
  const site = Wd.siteAt(w, p), band = Wd.bandAt(w, p), o = k.owner[p];
  const title = el('div', {class: 'row'}, el('span', {class: 'fold'}, infoFolded ? '▸' : '▾'), el('b', {}, nm(p)), el('span', {class: 'tag'}, Wd.BIOMES[k.biome[p]].n),
    o >= 0 ? el('span', {class: 'tag'}, Wd.facName(o)) : el('span', {class: 'tag warn'}, '無主之地'),
    here ? el('span', {class: 'tag good'}, '你在這裡') : null, k.routeTiles.has(p) ? el('span', {class: 'tag'}, '商路') : null,
    k.bandit[p] > 40 ? el('span', {class: 'tag bad'}, '盜匪出沒') : k.bandit[p] > 15 ? el('span', {class: 'tag warn'}, '不太平') : null);
  box.append(title);
  if (band) { const [lab, cls] = strength(band.foes); box.append(el('div', {}, `${band.name}：${foeSummary(band.foes)} `, el('span', {class: 'tag ' + cls}, '戰力' + lab))); }
  const units = Wd.unitsInView(w).filter(u => u.pos === p);
  for (const u of units.slice(0, 6)) box.append(el('div', {}, el('span', {class: 'tag'}, {caravan: '商隊', cart: '運貨車', patrol: '巡邏', army: '軍隊'}[u.kind]), ` ${u.label}・`, el('span', {class: 'muted'}, u.detail)));
  if (units.length > 6) box.append(el('div', {class: 'muted'}, `還有 ${units.length - 6} 組……`));
  if (o >= 0 && Wd.wantedBy(w, o) >= 1) box.append(el('div', {}, el('span', {class: 'tag bad'}, '通緝'), ` ${Wd.facName(o)}正在通緝你們${Wd.wantedBy(w, o) >= 3 ? '：城裡的人不會跟你們打交道' : ''}`));
  if (Wd.hdist(p, w.pos) > Wd.viewRadius(w)) box.append(el('div', {class: 'muted', style: 'font-size:12px'}, '在你的視野外：那裡現在有誰經過，你看不到。'));
  for (const pin of (w.pins || []).filter(x => x.tile === p && w.day - x.day < 12)) box.append(el('div', {class: 'muted', style: 'font-size:13px'}, `第 ${pin.day} 天聽說：${pin.text}`));
  if (site?.kind === 'town') { const wars = Wd.atWarWith(site.fac); box.append(el('div', {class: 'muted'}, `市鎮。市集、酒館、告示板、旅店。${k.fac[site.fac].hardy ? `${Wd.facName(site.fac)}是北地之國，耐寒。` : ''}${wars.length ? `${Wd.facName(site.fac)}正與${wars.join('、')}交戰。` : ''}`)); const it = w.intel[p]; if (it && !here) box.append(intelLine(p)); }
  if (site?.kind === 'village') box.append(el('div', {class: 'muted'}, `村莊。可以買到 ${Wd.villageFood(w, p)} 份口糧，每份約 ${Wd.rationPrice(w, p).toFixed(1)} 金幣。`));
  if (site?.kind === 'camp') { const g = k.gangs.find(x => x.id === site.gang); box.append(el('div', {class: 'muted'}, `盜匪${g.name}的山寨，${gangWord(g.str)}。拔掉它能拿到寨裡的財物；告示板上可能有人出賞金。`)); }
  for (const c of w.contracts) if (Wd.contractSite(w, c) === p && (c.taken || c.kind === 'deliver')) box.append(el('div', {}, el('span', {class: 'tag warn'}, Wd.KIND_NAME[c.kind]), ' ', c.title));
  for (const L of w.leads || []) if (Wd.hdist(L.center, p) <= 1) box.append(el('div', {}, el('span', {class: 'tag good'}, '傳聞'), ` 「${L.name}」可能在這一帶${(L.searched || []).includes(p) ? '（這格找過了）' : ''}`));
  const row = el('div', {class: 'rowbtn'});
  if (here) for (const u of units.filter(u => u.kind === 'caravan' || u.kind === 'cart').slice(0, 2)) row.append(el('button', {class: 'danger', onclick: () => { if (confirm(`劫${u.label}？${Wd.facName(u.fac)}會通緝你們，巡邏隊看到會來抓人。`)) doWorld({type: 'raid', what: u.kind, to: u.to}); }}, `劫${u.kind === 'caravan' ? '商隊' : '運貨車'}（往${nm(u.to)}）`));
  if (here) for (const L of w.leads || []) if (Wd.hdist(L.center, p) <= 1) row.append(el('button', {onclick: () => doWorld({type: 'search', id: L.id})}, `搜尋「${L.name}」（一天）`));
  if (!here && wsel?.path) {
    const hrs = Wd.pathHoursW(w, wsel.path), risks = wsel.path.filter(i => Wd.seen(w, i)).map(i => Wd.tileRisk(i, k)), bad = risks.filter(r => r >= 0.4).length, mid = risks.filter(r => r >= 0.15 && r < 0.4).length;
    const need = Wd.eaters(w) * hrs / 24;
    box.append(el('div', {}, `${wsel.path.length} 格，約 ${hrs < 30 ? hrs + ' 小時' : (hrs / 24).toFixed(1) + ' 天'}，吃掉 ${need.toFixed(0)} 份糧食`, need > w.food ? el('span', {class: 'tag bad'}, '糧食不夠') : null));
    box.append(el('div', {class: 'muted', style: 'font-size:13px'}, `沿路：${bad ? `危險 ${bad} 格・` : ''}${mid ? `不太平 ${mid} 格・` : ''}${!bad && !mid ? '看起來還算太平・' : ''}${wsel.path.some(i => !Wd.seen(w, i)) ? '有些路段沒走過・' : ''}${Wd.SEASON_NOTE[k.season] || '天氣不錯'}`));
    row.append(el('button', {class: 'primary', onclick: () => travel(wsel.path)}, '前往'));
  } else if (!here) box.append(el('div', {class: 'muted'}, '走不到那裡。'));
  if (here && site) {
    if (site.kind === 'town') row.append(el('button', {class: 'primary', onclick: () => townSheet()}, '進城'));
    if (site.kind === 'village') row.append(el('button', {class: 'primary', onclick: () => villageSheet(p)}, '進村'));
    if (site.kind === 'camp') row.append(el('button', {class: 'danger', onclick: () => { if (confirm('進攻山寨？')) doWorld({type: 'assault'}); }}, '進攻'));
  }
  box.append(row);
}
async function travel(path) {
  traveling = true; wsel = null;
  for (const p of path) {
    const out = doWorld({type: 'travel', to: p}, true, true); followParty(); renderWorld(); await sleep(150);
    if (!out || out.encounter || G.world.pendingBattle || G.world.over || Wd.bandAt(G.world, G.world.pos)) break;
  }
  traveling = false; save(); afterWorldAction();
}
function doWorld(a, quiet, noSave) {
  let out;
  try { out = Wd.worldAct(G.world, a); } catch (e) { toast(e.message); return null; }
  if (!noSave) save(); for (const l of out.lines) toast(l, 2600);
  if (!quiet) afterWorldAction();
  return out;
}
function afterWorldAction() {
  const w = G.world;
  renderWorld(); hexInfo();
  if (w.over) return gameOver();
  if (w.pendingBattle) return startBattle(w.pendingBattle);
  const b = Wd.bandAt(w, w.pos); if (b) return encounterSheet(b);
}
function encounterSheet(b) {
  const [lab, cls] = strength(b.foes), w = G.world, toll = Wd.tollOf(w);
  if (b.kind === 'soldiers') {
    const fine = Wd.fineOf(w, b.fac), box = el('div', {}, el('h2', {}, `${b.name}攔下了你們`), el('p', {}, `${foeSummary(b.foes)}　`, el('span', {class: 'tag ' + cls}, '戰力' + lab)),
      el('p', {class: 'muted'}, '「你們就是通緝告示上那夥人吧。跟我們走一趟，或者把罰金繳了。」'));
    box.append(el('div', {class: 'rowbtn'}, el('button', {class: 'primary', onclick: () => { closeSheet(); doWorld({type: 'engage', band: b.id}); }}, '迎戰（通緝更緊）'),
      el('button', {onclick: () => { closeSheet(); doWorld({type: 'evade', band: b.id}); }}, '試著甩開'),
      el('button', {onclick: () => { closeSheet(); doWorld({type: 'bribe', band: b.id}); }}, `繳罰金（${fine}）`)));
    const lock = () => {}; lock.locked = true; return openSheet(box, lock);
  }
  const box = el('div', {}, el('h2', {}, b.kind === 'wolves' ? '狼群！' : `${b.name}擋住了去路`),
    el('p', {}, `${foeSummary(b.foes)}　`, el('span', {class: 'tag ' + cls}, '戰力' + lab)),
    el('p', {class: 'muted'}, b.kind === 'wolves' ? '牠們已經聞到你們的味道了。' : toll.escort ? '「商隊的貨留下，你們可以走。」' : toll.cargo ? '「騾子背上的東西留一半下來，人就可以走。」' : '「把錢留下，人就可以走。」'));
  const row = el('div', {class: 'rowbtn'},
    el('button', {class: 'primary', onclick: () => { closeSheet(); doWorld({type: 'engage', band: b.id}); }}, '迎戰'),
    el('button', {onclick: () => { closeSheet(); doWorld({type: 'evade', band: b.id}); }}, w.mules ? `試著避開（帶著騾子不好跑）` : '試著避開'));
  if (b.kind === 'bandits') row.append(el('button', {onclick: () => { closeSheet(); doWorld({type: 'pay', band: b.id}); }}, toll.escort ? '交出商隊的貨（護送失敗）' : toll.cargo ? '交出一半的貨' : `付過路費（${toll.gold}）`));
  box.append(row);
  const lock = () => {}; lock.locked = true; openSheet(box, lock);
}

/* ───────────── 城鎮 ───────────── */
const fmtDays = d => d <= 0 ? '今天' : `${d} 天前`;
function intelLine(i) { const it = G.world.intel[i]; return el('div', {class: 'muted', style: 'font-size:13px'}, `${it.src === 'seen' ? '上次來' : '聽說'}（${fmtDays(G.world.day - it.day)}）：` + Wd.GOODS.map(g => `${Wd.GN[g]} ${it.p[g]}`).join('・')); }
function townSheet(tab = 'market') {
  const w = G.world, t = w.pos, k = C.K(), box = el('div', {});
  box.append(el('h2', {}, nm(t)), el('p', {class: 'muted', style: 'margin:-4px 0 4px'}, `${Wd.facName(k.owner[t])}的市鎮・人口約 ${Math.round(k.markets[t].pop * 10)}`));
  const tabs = el('div', {class: 'tabs'});
  for (const [key, n] of [['market', '市集'], ['smith', '鐵匠'], ['tavern', '酒館'], ['board', '告示'], ['inn', '旅店']]) tabs.append(el('button', {class: key === tab ? 'on' : '', onclick: () => townSheet(key)}, n));
  box.append(tabs);
  const n = w.party.length, again = () => townSheet(tab);
  if (tab === 'market') {
    const pr = Wd.rationPrice(w, t), eat = Math.ceil(Wd.eaters(w));
    box.append(el('h3', {}, '口糧'), el('p', {class: 'muted'}, `每份約 ${pr.toFixed(1)} 金幣。一天吃 ${eat} 份（騾子也要吃），現有 ${w.food.toFixed(0)} 份。`));
    box.append(el('div', {class: 'rowbtn'}, ...[3, 7, 14].map(d => el('button', {onclick: () => { doWorld({type: 'buyFood', n: eat * d}); again(); }}, `${d} 天份（${Math.ceil(eat * d * pr)}）`))));
    box.append(el('h3', {style: 'margin-top:10px'}, '貨物'), el('p', {class: 'muted'}, `載重 ${Wd.load(w)}/${Wd.capacity(w)} 包：每人扛 ${Wd.CARRY_MAN} 包、每頭騾子 ${Wd.MULE_CAP} 包。買得越多越貴、賣得越多越便宜；換季後行情會重新變動。`));
    box.append(goodsTable(t, again));
    box.append(el('div', {class: 'rowbtn'},
      el('button', {onclick: () => { doWorld({type: 'buyMule'}); again(); }}, `買騾子（${Wd.MULE_PRICE}）・有 ${w.mules} 頭`),
      el('button', {onclick: () => { doWorld({type: 'buyMap'}); again(); }}, `買附近的地圖（${Wd.MAP_PRICE}）`)));
    box.append(el('h3', {style: 'margin-top:10px'}, '馬'), el('p', {class: 'muted'}, `人人有馬才走得快（平地快三成五，林地山地快一成五），也比較甩得掉追兵。一匹馬一天吃 ${Wd.HORSE_FEED} 份糧。現在有 ${w.horses || 0} 匹，隊伍 ${n} 人${Wd.mounted(w) ? '，全員騎馬' : ''}。`));
    box.append(el('div', {class: 'rowbtn'}, el('button', {onclick: () => { doWorld({type: 'buyHorse'}); again(); }}, `買馬（${Wd.HORSE_PRICE}）`),
      w.horses ? el('button', {onclick: () => { doWorld({type: 'sellHorse'}); again(); }}, `賣馬（${Math.round(Wd.HORSE_PRICE / 2)}）`) : null,
      w.mules ? el('button', {onclick: () => { doWorld({type: 'sellMule'}); again(); }}, `賣騾子（${Math.round(Wd.MULE_PRICE / 2)}）`) : null,
      w.cargo.food > 0 ? el('button', {onclick: () => { doWorld({type: 'eat'}); again(); }}, `拆一包糧當口糧`) : null));
    if (w.relics.length) {
      box.append(el('h3', {style: 'margin-top:10px'}, '寶物'));
      for (const r of w.relics) box.append(el('div', {class: 'card'}, el('div', {class: 'body'}, el('div', {class: 'top'}, el('b', {}, `「${r.name}」`), el('span', {class: 'muted'}, r.kind)),
        el('div', {class: 'muted', style: 'font-size:13px'}, `傳奇武器・換過 ${r.owners} 個主人・打贏過 ${r.wins} 場`),
        el('div', {class: 'rowbtn'}, el('button', {onclick: () => { if (confirm(`把「${r.name}」賣給${nm(t)}？`)) { doWorld({type: 'sellRelic', id: r.id}); again(); } }}, `賣給這裡的權貴（${Wd.relicPrice(w, r)}）`)))));
    }
  }
  if (tab === 'smith') {
    const iron = Wd.stockBales(t, 'iron');
    box.append(el('p', {class: 'muted'}, `鐵匠的價錢跟著這座城的鐵價走；打一件第 N 級的裝備要用掉 N 包鐵（鐵匠手上還有 ${iron} 包）。兵器每級力量 +1，護甲每級防禦 +1。`));
    for (const m of w.party) {
      const gw = m.gw || 0, ga = m.ga || 0;
      box.append(el('div', {class: 'card'}, avatar(m.sprite, 44), el('div', {class: 'body'},
        el('div', {class: 'top'}, el('b', {}, m.name), el('span', {class: 'muted'}, `${Wd.GEAR_NAME.w[gw]}・${Wd.GEAR_NAME.a[ga]}`)),
        el('div', {class: 'rowbtn'},
          el('button', {disabled: gw >= 3 || iron < gw + 1 || null, onclick: () => { doWorld({type: 'gear', id: m.id, kind: 'w'}); again(); }}, gw >= 3 ? '兵器已頂級' : `${Wd.GEAR_NAME.w[gw + 1]}（${Wd.gearPrice(t, 'w', gw + 1)}）`),
          el('button', {disabled: ga >= 3 || iron < ga + 1 || null, onclick: () => { doWorld({type: 'gear', id: m.id, kind: 'a'}); again(); }}, ga >= 3 ? '護甲已頂級' : `${Wd.GEAR_NAME.a[ga + 1]}（${Wd.gearPrice(t, 'a', ga + 1)}）`)))));
    }
  }
  if (tab === 'tavern') {
    const ts = Wd.townState(w, t);
    const fam = Wd.famousHere(w, t);
    if (fam.length) {
      box.append(el('h3', {}, '有名者'), el('p', {class: 'muted'}, `沙盒裡真實存在的人。雇了他，他就從原本的國家消失；他戰死，歷史會記下來。你的戰幫：${Wd.fameWord(w.fame || 0)}。`));
      for (const h of fam) { const o = Wd.famousOffer(w, h), need = h.legend ? 3 : h.famed ? 1 : 0;
        box.append(el('div', {class: 'card'}, el('div', {class: 'body'},
          el('div', {class: 'top'}, el('b', {}, h.epithet ? `「${h.epithet}」${h.name}` : h.name), el('span', {class: 'muted'}, `${CLASSES[o.cls].name} Lv${o.lvl}`)),
          el('div', {class: 'muted', style: 'font-size:13px'}, `${Wd.facName(h.f)}的人・打過 ${h.battles || 0} 場、贏 ${h.wins} 場${h.famed ? '・事蹟傳遍各地' : ''}${o.relic ? `・帶著傳奇武器「${o.relic}」` : ''}・週薪 ${o.wage}`),
          el('div', {class: 'rowbtn'}, el('button', {class: 'primary', disabled: (w.fame || 0) < need || null, onclick: () => { doWorld({type: 'hireFamous', id: h.id}); again(); }}, (w.fame || 0) < need ? '他看不上你們（名聲不夠）' : `請他加入（${o.fee}）`)))));
      }
    }
    box.append(el('div', {class: 'rowbtn'}, el('button', {onclick: () => { doWorld({type: 'rumor'}); again(); }}, '請一輪酒，打聽各地行情（3）')));
    box.append(el('p', {class: 'muted'}, `招募要先付兩週薪水當安家費。隊伍最多 ${Wd.MAX_PARTY} 人（現在 ${n} 人）。新面孔第 ${ts.nextRecruit} 天會來。`));
    if (!ts.recruits.length) box.append(el('p', {}, '今天酒館裡沒有想找差事的人。'));
    for (const r of ts.recruits) box.append(memberCard(r, el('div', {class: 'rowbtn'}, el('button', {class: 'primary', onclick: () => { doWorld({type: 'hire', id: r.id}); again(); }}, `雇用（${r.wage * 2}）`))));
  }
  if (tab === 'board') {
    const claim = w.contracts.filter(c => Wd.canClaimHere(w, c));
    if (claim.length) box.append(el('button', {class: 'primary', onclick: () => { doWorld({type: 'claim'}); again(); }}, `領賞（${claim.reduce((s, c) => s + c.reward, 0)}）`));
    box.append(contractList(t));
  }
  if (tab === 'inn') {
    box.append(el('p', {}, `每人每晚 2 金幣，一天能養好一半的傷，大家的心情也會好一點。`));
    box.append(el('div', {class: 'rowbtn'}, ...[1, 3].map(d => el('button', {onclick: () => { doWorld({type: 'rest', days: d}); again(); }}, `住 ${d} 晚（${n * 2 * d}）`))));
    box.append(el('div', {class: 'rowbtn'}, el('button', {onclick: () => { doWorld({type: 'rest', days: 1, inn: false}); again(); }}, '在城外紮營一天（免費）')));
  }
  openSheet(box);
}
function goodsTable(t, again) {
  const w = G.world, wrap = el('div', {class: 'goods'});
  for (const g of Wd.GOODS) {
    const stock = Wd.stockBales(t, g), have = w.cargo[g], room = Wd.capacity(w) - Wd.load(w);
    const b1 = stock > 0 ? Wd.quote(w, t, g, 'buy', 1) : null, s1 = Wd.quote(w, t, g, 'sell', 1);
    const bq = Math.min(5, stock, room), sq = have;
    wrap.append(el('div', {class: 'goodrow'},
      el('div', {class: 'gname'}, el('b', {}, Wd.GN[g]), el('span', {class: 'muted'}, `存貨 ${stock > 999 ? '999+' : stock}・你有 ${have}`)),
      el('div', {class: 'gprice'}, el('span', {}, '買 ', el('b', {}, b1 ?? '—')), el('span', {}, '賣 ', el('b', {}, s1))),
      el('div', {class: 'gbtn'},
        el('button', {disabled: !(bq >= 1) || null, onclick: () => { doWorld({type: 'buy', g, q: 1}); again(); }}, '買 1'),
        el('button', {disabled: !(bq >= 2) || null, onclick: () => { doWorld({type: 'buy', g, q: bq}); again(); }}, bq >= 2 ? `買 ${bq}（${Wd.quote(w, t, g, 'buy', bq)}）` : '買 5'),
        el('button', {disabled: !have || null, onclick: () => { doWorld({type: 'sell', g, q: 1}); again(); }}, '賣 1'),
        el('button', {disabled: !(sq >= 2) || null, onclick: () => { doWorld({type: 'sell', g, q: sq}); again(); }}, sq >= 2 ? `全賣（${Wd.quote(w, t, g, 'sell', sq)}）` : '全賣'))));
  }
  return wrap;
}
function contractList(t) {
  const w = G.world, box = el('div', {}), k = C.K();
  const list = w.contracts.filter(c => t == null ? (c.taken || c.kind === 'deliver') : (c.town === t || c.taken || (c.kind === 'deliver' && Wd.hdist(c.at, t) <= 8)));
  if (!list.length) box.append(el('p', {class: 'muted'}, t == null ? '手上沒有委託。在城鎮的告示板接委託、領賞。' : '告示板上沒有委託。'));
  for (const c of list) {
    const site = Wd.contractSite(w, c), dist = site >= 0 ? Wd.hdist(site, w.pos) : -1;
    let info = '', status = c.done ? (Wd.canClaimHere(w, c) ? '完成，可以領賞' : '完成，待領賞') : c.taken ? '進行中' : c.kind === 'deliver' ? `每包 ${c.pay}` : `賞金 ${c.reward}`;
    if (c.kind === 'gang') info = site >= 0 ? `山寨在${nm(site)}（離你 ${dist} 格）` : c.done ? '' : '山寨已經不在了';
    if (c.kind === 'escort') info = `貨：${Wd.GN[c.g]} ${c.q} 包。送到${nm(c.to)}（離你 ${dist} 格），到了當場付錢。帶著商隊更容易被盜匪盯上；付過路費或撤退，貨就沒了。`;
    if (c.kind === 'deliver') info = `把${Wd.GN[c.g]}送到${nm(c.at)}（離你 ${dist} 格）的官倉，還收 ${c.left} 包。不用接，到了在告示板交貨。`;
    if (c.kind === 'merc') info = `${c.desc}目標：${nm(c.target)}（離你 ${dist} 格）。`;
    if (c.kind === 'wolves') info = `狼窩在${nm(c.target)}（離你 ${dist} 格）。`;
    const btns = el('div', {class: 'rowbtn'});
    if (!c.taken && t != null && c.kind !== 'deliver') btns.append(el('button', {onclick: () => { doWorld({type: 'takeContract', id: c.id}); townSheet('board'); }}, c.kind === 'escort' ? '接下，帶商隊出發' : '接下'));
    if (c.kind === 'deliver' && c.at === w.pos && w.cargo[c.g] > 0) btns.append(el('button', {class: 'primary', onclick: () => { doWorld({type: 'deliver', id: c.id}); townSheet('board'); }}, `交貨（${Math.min(c.left, w.cargo[c.g])} 包，${Math.min(c.left, w.cargo[c.g]) * c.pay}）`));
    if (site >= 0 && site !== w.pos) btns.append(el('button', {onclick: () => { closeSheet(); showOnMap(site); }}, '在地圖上看'));
    if (c.done && !Wd.canClaimHere(w, c)) btns.append(el('button', {class: 'primary', onclick: () => { closeSheet(); showOnMap(c.town); }}, `回${nm(c.town)}領賞（${Wd.hdist(c.town, w.pos)} 格）`));
    box.append(el('div', {class: 'card'}, el('div', {class: 'body'},
      el('div', {class: 'top'}, el('b', {}, el('span', {class: 'tag'}, Wd.KIND_NAME[c.kind]), ' ', c.title), el('span', {class: 'tag ' + (c.done ? 'good' : c.taken ? 'warn' : '')}, status)),
      el('div', {class: 'muted', style: 'font-size:13px'}, `${nm(c.town)}的告示（${Wd.facName(k.owner[c.town]) || '已亡國'}）・${info ? info + '・' : ''}期限第 ${c.until} 天${c.kind !== 'deliver' ? `・賞金 ${c.reward}` : ''}`),
      btns)));
  }
  if (t == null && w.leads?.length) {
    box.append(el('h3', {style: 'margin-top:12px'}, '傳聞'));
    for (const L of w.leads) box.append(el('div', {class: 'card'}, el('div', {class: 'body'},
      el('div', {class: 'top'}, el('b', {}, `「${L.name}」的下落`), el('span', {class: 'muted'}, `第 ${L.day} 天聽說`)),
      el('div', {class: 'muted', style: 'font-size:13px'}, `據說在${nm(L.center)}一帶（離你 ${Wd.hdist(L.center, w.pos)} 格）。到那一帶（含周圍一格）每找一次花一天${L.searched?.length ? `；已經找過：${L.searched.map(nm).join('、')}` : ''}。`),
      el('div', {class: 'rowbtn'}, el('button', {onclick: () => { closeSheet(); showOnMap(L.center); }}, '在地圖上看'),
        Wd.hdist(L.center, w.pos) <= 1 ? el('button', {class: 'primary', onclick: () => { closeSheet(); doWorld({type: 'search', id: L.id}); }}, `在${nm(w.pos)}搜尋一天`) : null))));
  }
  return box;
}
function showOnMap(i) { const [x, y] = wxy(i); cam.x = x; cam.y = y; selectHex(i); }
function villageSheet(v) {
  const w = G.world, eat = Math.ceil(w.party.length + w.mules * Wd.MULE_FEED), pr = Wd.rationPrice(w, v), have = Wd.villageFood(w, v);
  const box = el('div', {}, el('h2', {}, nm(v)), el('p', {}, `村裡能匀出 ${have} 份口糧，每份約 ${pr.toFixed(1)} 金幣，比城裡便宜。`),
    el('div', {class: 'rowbtn'}, ...[1, 3, 7].map(d => el('button', {disabled: !have || null, onclick: () => { doWorld({type: 'buyFood', n: Math.min(eat * d, have)}); villageSheet(v); }}, `${d} 天份`))),
    el('div', {class: 'rowbtn'}, el('button', {onclick: () => { doWorld({type: 'rest', days: 1}); closeSheet(); }}, '在村邊紮營一天')));
  openSheet(box);
}
// 行情：去過或聽說過的市集
function marketSheet() {
  const w = G.world, ids = Object.keys(w.intel).map(Number).sort((a, b) => Wd.hdist(a, w.pos) - Wd.hdist(b, w.pos));
  const box = el('div', {}, el('h2', {}, '行情'), el('p', {class: 'muted'}, '只記得親眼看過或在酒館聽來的價格（一包的買價），越久越不準。金色是這張表裡最便宜的，紅色是最貴的。'));
  if (!ids.length) { box.append(el('p', {}, '還沒有任何市集的消息。')); return openSheet(box); }
  const lo = {}, hi = {}; for (const g of Wd.GOODS) { const v = ids.map(i => w.intel[i].p[g]); lo[g] = Math.min(...v); hi[g] = Math.max(...v); }
  const tb = el('table', {class: 'intel'}, el('tr', {}, el('th', {}, '市集'), ...Wd.GOODS.map(g => el('th', {}, Wd.GN[g]))));
  for (const i of ids) {
    const it = w.intel[i];
    tb.append(el('tr', {onclick: () => { closeSheet(); showOnMap(i); }}, el('td', {}, el('b', {}, nm(i)), el('div', {class: 'muted'}, `${Wd.hdist(i, w.pos)} 格・${fmtDays(w.day - it.day)}${it.src === 'seen' ? '' : '・聽說'}`)),
      ...Wd.GOODS.map(g => el('td', {class: it.s && it.s[g] === 0 ? 'none' : it.p[g] === lo[g] ? 'lo' : it.p[g] === hi[g] ? 'hi' : ''}, it.s && it.s[g] === 0 ? `${it.p[g]}*` : it.p[g]))));
  }
  box.append(tb, el('p', {class: 'muted', style: 'font-size:12px'}, '＊ 當時沒有存貨，只收不賣。點一列可以在地圖上找到它。'));
  openSheet(box);
}
$('btnParty').onclick = () => {
  const w = G.world, due = w.party.filter(m => !m.hero).reduce((s, m) => s + m.wage, 0);
  const box = el('div', {}, el('h2', {}, `隊伍（${w.party.length}/${Wd.MAX_PARTY}）`),
    el('p', {class: 'muted'}, `下次發餉：第 ${w.nextWage} 天，共 ${due} 金幣。騾子 ${w.mules} 頭。`),
    el('p', {}, `身上的貨：${Wd.GOODS.filter(g => w.cargo[g]).map(g => `${Wd.GN[g]} ${w.cargo[g]} 包`).join('、') || '沒有'}（${Wd.load(w)}/${Wd.capacity(w)}）`));
  const wl = Object.entries(w.wanted || {}).filter(([, v]) => v >= 0.5);
  if (wl.length) box.append(el('p', {}, el('span', {class: 'tag bad'}, '通緝'), ' ', wl.map(([f, v]) => `${Wd.facName(+f)}（${v >= 3 ? '重犯' : v >= 2 ? '巡邏隊會抓人' : '小心'}）`).join('、')));
  box.append(el('p', {class: 'muted'}, `名聲：${Wd.fameWord(w.fame || 0)}。馬 ${w.horses || 0} 匹${Wd.mounted(w) ? '（全員騎馬）' : ''}。`));
  for (const r of w.relics) { const who = w.party.find(m => m.id === r.equip);
    box.append(el('div', {class: 'rowbtn'}, el('span', {style: 'flex:2;align-self:center'}, `「${r.name}」${r.kind}：${who ? who.name + '佩帶（力量 +2）' : '收在行囊裡'}`), el('button', {onclick: () => { doWorld({type: 'equipRelic', id: r.id}); $('btnParty').onclick(); }}, who ? '換人' : '交給人佩帶'))); }
  for (const m of w.party) box.append(memberCard(m, m.hero ? null : el('div', {class: 'rowbtn'}, el('button', {class: 'danger', onclick: () => { if (confirm(`讓${m.name}離開隊伍？`)) { doWorld({type: 'dismiss', id: m.id}); closeSheet(); } }}, '遣散'))));
  if (w.fallen.length) { box.append(el('h3', {style: 'margin-top:12px'}, '倒下的人')); for (const f of w.fallen) box.append(el('p', {class: 'muted'}, `${f.name}（${CLASSES[f.cls].name}）・第 ${f.day} 天・${f.how}`)); }
  openSheet(box);
};
$('btnLog').onclick = () => { const box = el('div', {class: 'log'}, el('h2', {}, '日誌')); for (const l of G.world.log) box.append(el('p', {}, el('span', {class: 'd'}, `第 ${l.day} 天`), l.text)); openSheet(box); };
$('btnJobs').onclick = () => openSheet(el('div', {}, el('h2', {}, '委託'), contractList(null)));
$('btnMarket').onclick = () => marketSheet();
$('btnRest').onclick = () => { if (confirm('原地紮營休息一天？（會吃掉一天的糧食）')) doWorld({type: 'rest', days: 1, inn: false}); };
// 筆記：從右邊拉出來，隨手記
{
  const pane = $('notes'), ta = $('notesText'); let t0 = 0;
  const open = v => { pane.classList.toggle('open', v); if (v) { ta.value = G.world?.notes || ''; } else if (G.world) { G.world.notes = ta.value; save(false); } };
  $('notesTab').onclick = () => open(!pane.classList.contains('open'));
  ta.addEventListener('input', () => { if (!G.world) return; G.world.notes = ta.value; clearTimeout(t0); t0 = setTimeout(() => save(false), 600); });
  $('notesStamp').onclick = () => { const w = G.world; if (!w) return; const line = `\n【${Wd.timeText(w)}・${nm(w.pos)}】`; ta.setRangeText(line, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); ta.dispatchEvent(new Event('input')); };
  // 從右邊緣往左拖也能拉出來
  let sx = null; addEventListener('touchstart', e => { const x = e.touches[0].clientX; sx = x > innerWidth - 24 && !$('world').hidden ? x : null; }, {passive: true});
  addEventListener('touchmove', e => { if (sx != null && sx - e.touches[0].clientX > 40) { open(true); sx = null; } }, {passive: true});
  pane.addEventListener('touchstart', e => { pane._x = e.touches[0].clientX; }, {passive: true});
  pane.addEventListener('touchmove', e => { if (pane._x != null && e.touches[0].clientX - pane._x > 60 && e.target !== ta) { open(false); pane._x = null; } }, {passive: true});
}
$('btnDanger').onclick = () => { showDanger = !showDanger; $('btnDanger').classList.toggle('on', showDanger); renderWorld(); };
$('btnHome').onclick = () => { const [x, y] = wxy(G.world.pos); cam.x = x; cam.y = y; renderWorld(); };
addEventListener('resize', () => { if (!$('world').hidden) renderWorld(); });

/* ═════════════ 戰鬥 ═════════════ */
let bsel = null, disp = null, popups = [], animating = false, bubbles = [], picking = null, cell = 32, fo = {x: 0, y: 0};
function startBattle(setup) {
  const w = G.world;
  const st = B.createBattle({seed: setup.seed, biome: setup.biome, party: Wd.battleParty(w), foes: setup.foes, order: w.lastOrder || {stance: 'follow', focus: null}});
  G.battle = {setup, st}; save(false); battleScreen(true);
}
function battleScreen(fresh) {
  show('battle'); bsel = null; picking = null; syncDisp(); renderOrders(); bInfo();
  $('bTitle').textContent = G.battle.setup.title;
  if (fresh) banner('開戰');
  if (!battleScreen.loop) { battleScreen.loop = true; const loop = () => { if (!$('battle').hidden) drawField(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
}
function syncDisp() { const st = ST(); disp = {}; for (const u of st.units) disp[u.id] = {x: u.x, y: u.y, hp: u.hp, alpha: u.alive && !u.fled ? 1 : 0, ox: 0, oy: 0}; }
let lastSt = null;
const ST = () => (G.battle ? G.battle.st : lastSt);
const uById = id => ST().units.find(u => u.id === id);
function renderOrders() {
  const box = $('orders'); box.innerHTML = ''; const o = ST().order;
  for (const [k, v] of Object.entries(ORDERS)) box.append(el('button', {class: o.stance === k ? 'on' : '', onclick: () => setOrder(k)}, k === 'focus' && o.focus && o.stance === 'focus' ? `集火：${uById(o.focus)?.name || ''}` : v.name));
}
function setOrder(k) {
  if (animating) return;
  if (k === 'focus') { picking = 'focus'; toast('點一個敵人當集火目標'); return; }
  B.act(ST(), {type: 'order', stance: k}); G.world.lastOrder = ST().order; save(false); renderOrders(); bInfo(); toast(`${ORDERS[k].name}：${ORDERS[k].desc}`);
}
// 版面
function layout() { const c = $('field').getBoundingClientRect(); cell = Math.floor(Math.min(c.width / B.W, c.height / B.H)); fo = {x: Math.floor((c.width - cell * B.W) / 2), y: Math.floor((c.height - cell * B.H) / 2)}; }
const TILECOL = {grass: '#4f6034', road: '#87744f', bush: '#4f6034', forest: '#3d5530', hill: '#7a6a45', rock: '#4f6034', water: '#2e5672', wall: '#4f6034', camp: '#6b5a3e'};
function drawField() {
  const st = ST(); if (!st) return; const {g, w: cw, h: ch} = fit($('field')); layout();
  g.fillStyle = '#17130f'; g.fillRect(0, 0, cw, ch);
  const X = x => fo.x + x * cell, Y = y => fo.y + y * cell;
  for (let y = 0; y < B.H; y++) for (let x = 0; x < B.W; x++) {
    const t = st.tiles[y * B.W + x]; g.fillStyle = TILECOL[t]; g.fillRect(X(x), Y(y), cell, cell);
    if ((x + y) % 2) { g.fillStyle = '#00000014'; g.fillRect(X(x), Y(y), cell, cell); }
    if (t === 'forest') sprite(g, ['props', 'tree'], X(x) + cell * 0.05, Y(y), cell * 0.9);
    if (t === 'bush') sprite(g, ['props', 'bush'], X(x) + cell * 0.15, Y(y) + cell * 0.2, cell * 0.7);
    if (t === 'hill') { g.strokeStyle = '#a8946488'; g.lineWidth = 2; g.beginPath(); g.arc(X(x) + cell / 2, Y(y) + cell * 0.75, cell * 0.35, Math.PI, 0); g.stroke(); }
    if (t === 'rock') { g.fillStyle = '#8b8780'; g.beginPath(); g.ellipse(X(x) + cell / 2, Y(y) + cell * 0.6, cell * 0.38, cell * 0.28, 0, 0, 7); g.fill(); g.fillStyle = '#a9a59c'; g.beginPath(); g.ellipse(X(x) + cell * 0.42, Y(y) + cell * 0.5, cell * 0.18, cell * 0.12, 0, 0, 7); g.fill(); }
    if (t === 'wall') { g.fillStyle = '#6b4f2e'; for (let i = 0; i < 4; i++) g.fillRect(X(x) + cell * (0.06 + i * 0.24), Y(y) + cell * 0.15, cell * 0.18, cell * 0.75); }
    if (t === 'water') { g.strokeStyle = '#ffffff22'; g.beginPath(); g.moveTo(X(x) + cell * 0.2, Y(y) + cell * 0.5); g.quadraticCurveTo(X(x) + cell * 0.5, Y(y) + cell * 0.35, X(x) + cell * 0.8, Y(y) + cell * 0.5); g.stroke(); }
  }
  // 危險範圍
  if ($('showDanger').checked && !animating) { const d = bsel?.danger || B.dangerTiles(st); if (bsel) bsel.danger = d; g.fillStyle = '#d0533f33'; for (const k of d) g.fillRect(X(k % B.W), Y((k / B.W) | 0), cell, cell); }
  // 主角可走範圍
  const h = B.hero(st);
  if (!animating && !st.result && h.alive) {
    const r = bsel?.reach || B.reach(st, h); if (bsel) bsel.reach = r; else bsel = {reach: r};
    g.fillStyle = '#5b9bd544'; for (const [x, y] of r.tiles) g.fillRect(X(x) + 1, Y(y) + 1, cell - 2, cell - 2);
    if (bsel.to) { g.strokeStyle = '#f1d38a'; g.lineWidth = 2; g.strokeRect(X(bsel.to[0]) + 2, Y(bsel.to[1]) + 2, cell - 4, cell - 4); }
    // 從預定位置打得到的敵人
    const from = bsel.to || [h.x, h.y];
    g.strokeStyle = '#ff6b55'; g.lineWidth = 2;
    for (const e of B.living(st, 'enemy')) { const d = Math.abs(e.x - from[0]) + Math.abs(e.y - from[1]), [lo, hi] = WEAPONS[h.weapon].range; if (d >= lo && d <= hi) g.strokeRect(X(e.x) + 3, Y(e.y) + 3, cell - 6, cell - 6); }
  }
  // 單位
  const units = st.units.slice().sort((a, b) => disp[a.id].y - disp[b.id].y);
  for (const u of units) {
    const d = disp[u.id]; if (d.alpha <= 0.01) continue;
    const ux = X(d.x) + d.ox * cell, uy = Y(d.y) + d.oy * cell;
    g.globalAlpha = d.alpha;
    g.fillStyle = u.side === 'ally' ? '#5b9bd5aa' : '#d0533faa'; g.beginPath(); g.ellipse(ux + cell / 2, uy + cell * 0.86, cell * 0.36, cell * 0.12, 0, 0, 7); g.fill();
    if (u.hero) { g.strokeStyle = '#d9a441'; g.lineWidth = 2; g.beginPath(); g.ellipse(ux + cell / 2, uy + cell * 0.86, cell * 0.4, cell * 0.15, 0, 0, 7); g.stroke(); }
    if (bsel?.to && u.hero && !animating) sprite(g, u.sprite, X(bsel.to[0]) + cell * 0.04, Y(bsel.to[1]) - cell * 0.04, cell * 0.92, {alpha: 0.55});
    sprite(g, u.sprite, ux + cell * 0.04, uy - cell * 0.04, cell * 0.92, {flip: u.side === 'enemy', alpha: d.alpha});
    // 血條
    g.fillStyle = '#000a'; g.fillRect(ux + cell * 0.12, uy + cell * 0.92, cell * 0.76, 4);
    g.fillStyle = u.side === 'ally' ? '#7fbf6a' : '#e06a52'; g.fillRect(ux + cell * 0.12, uy + cell * 0.92, cell * 0.76 * Math.max(0, d.hp) / u.max, 4);
    if (u.leader) { g.fillStyle = '#d9a441'; g.font = `700 ${cell * 0.3}px system-ui`; g.textAlign = 'left'; g.fillText('★', ux + 2, uy + cell * 0.3); }
    if (ST().order.focus === u.id && ST().order.stance === 'focus') { g.strokeStyle = '#f1d38a'; g.setLineDash([3, 3]); g.strokeRect(ux + 1, uy + 1, cell - 2, cell - 2); g.setLineDash([]); }
    g.globalAlpha = 1;
  }
  // 同伴的打算
  if (!animating && !st.result && bsel?.plans) for (const p of bsel.plans) {
    const u = uById(p.id); if (!u) continue;
    if (p.hidden) { g.fillStyle = '#e0a03c'; g.font = `800 ${cell * 0.45}px system-ui`; g.textAlign = 'center'; g.fillText('?', X(u.x) + cell * 0.85, Y(u.y) + cell * 0.38); continue; }
    const c = p.disobey || /膽小/.test(p.why) ? '#e0a03c' : '#8fd0ff';
    const a = [X(u.x) + cell / 2, Y(u.y) + cell / 2], b = p.to ? [X(p.to[0]) + cell / 2, Y(p.to[1]) + cell / 2] : a;
    if (p.to && (p.to[0] !== u.x || p.to[1] !== u.y)) arrow(g, a, b, c, 2);
    if (p.kind === 'attack' || p.kind === 'heal') { const t = uById(p.target); if (t) arrow(g, b, [X(t.x) + cell / 2, Y(t.y) + cell / 2], p.kind === 'heal' ? '#7fbf6a' : c, 3, true); }
    if (p.disobey) { g.fillStyle = '#e0a03c'; g.font = `700 ${cell * 0.4}px system-ui`; g.textAlign = 'center'; g.fillText('!', X(u.x) + cell * 0.85, Y(u.y) + cell * 0.35); }
  }
  // 敵人意圖
  if ($('showDanger').checked && !animating && !st.result) { const ep = bsel?.eplans || B.previewEnemies(st); if (bsel) bsel.eplans = ep; for (const p of ep) { if (p.kind !== 'attack') continue; const t = uById(p.target), u = uById(p.id); if (!t || !u) continue; arrow(g, [X(p.to[0]) + cell / 2, Y(p.to[1]) + cell / 2], [X(t.x) + cell / 2, Y(t.y) + cell / 2], '#ff6b55', 2, true); } }
  // 跳字與對話
  const now = performance.now();
  popups = popups.filter(p => now - p.t0 < 900);
  for (const p of popups) { const k = (now - p.t0) / 900; g.globalAlpha = 1 - k; g.font = `800 ${cell * 0.42}px system-ui`; g.textAlign = 'center'; g.fillStyle = '#000'; g.fillText(p.text, X(p.x) + cell / 2 + 1, Y(p.y) - k * cell * 0.6 + 1); g.fillStyle = p.color; g.fillText(p.text, X(p.x) + cell / 2, Y(p.y) - k * cell * 0.6); g.globalAlpha = 1; }
  bubbles = bubbles.filter(b => now - b.t0 < 1600);
  for (const b of bubbles) { const d = disp[b.id]; if (!d) continue; g.font = `600 ${Math.max(11, cell * 0.3)}px system-ui`; const tw = g.measureText(b.text).width + 12, bx = Math.min(cw - tw - 4, Math.max(4, X(d.x) + cell / 2 - tw / 2)), by = Y(d.y) - cell * 0.45; g.fillStyle = '#f4ead2'; g.fillRect(bx, by - 16, tw, 22); g.fillStyle = '#1b150d'; g.textAlign = 'left'; g.fillText(b.text, bx + 6, by); }
}
function arrow(g, a, b, color, w, head) {
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w; g.globalAlpha = 0.9;
  g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
  if (head) { const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), s = 8; g.beginPath(); g.moveTo(...b); g.lineTo(b[0] - s * Math.cos(ang - 0.4), b[1] - s * Math.sin(ang - 0.4)); g.lineTo(b[0] - s * Math.cos(ang + 0.4), b[1] - s * Math.sin(ang + 0.4)); g.fill(); }
  g.globalAlpha = 1;
}
function refreshPlans() { if (!bsel) bsel = {}; const h = B.hero(ST()), to = bsel.to || [h.x, h.y]; bsel.plans = B.previewAllies(ST(), to[0], to[1]); bsel.eplans = null; bsel.danger = null; }
// 點戰場
$('field').addEventListener('click', e => {
  if (animating || ST().result) return;
  const r = $('field').getBoundingClientRect(), x = Math.floor((e.clientX - r.left - fo.x) / cell), y = Math.floor((e.clientY - r.top - fo.y) / cell);
  if (x < 0 || y < 0 || x >= B.W || y >= B.H) return;
  const st = ST(), h = B.hero(st), u = B.unitAt(st, x, y);
  if (!bsel) bsel = {};
  if (picking === 'focus') {
    if (u && u.side === 'enemy') { B.act(st, {type: 'order', stance: 'focus', focus: u.id}); G.world.lastOrder = st.order; picking = null; save(false); renderOrders(); refreshPlans(); bInfo(); toast(`集火：${u.name}`); }
    else { picking = null; toast('取消集火'); }
    return;
  }
  const reachable = (bsel.reach || B.reach(st, h)).tiles.some(([a, b]) => a === x && b === y);
  if (u && u.side === 'enemy') {
    const from = bsel.to || [h.x, h.y], [lo, hi] = WEAPONS[h.weapon].range, inR = (fx, fy) => { const d = Math.abs(u.x - fx) + Math.abs(u.y - fy); return d >= lo && d <= hi; };
    if (!inR(...from)) {
      // 自動找一個打得到它的位置（命中最高、反擊最少）
      let best = null; for (const [tx, ty] of (bsel.reach || B.reach(st, h)).tiles) if (inR(tx, ty)) { const f = B.forecast(st, h, u, tx, ty), s = f.aHit * f.aDmg - f.dHit * f.dDmg * f.dCount; if (!best || s > best.s) best = {s, to: [tx, ty]}; }
      if (!best) { bsel.inspect = u.id; bsel.target = null; bInfo(); return; }
      bsel.to = best.to; refreshPlans();
    }
    bsel.target = u.id; bsel.inspect = null; bInfo(); return;
  }
  if (u && u !== h && !(reachable && u === h)) { bsel.inspect = u.id; bsel.target = null; bInfo(); return; }
  if (reachable) { bsel.to = (x === h.x && y === h.y) ? null : [x, y]; bsel.target = null; bsel.inspect = null; refreshPlans(); bInfo(); return; }
  bsel.to = null; bsel.target = null; bsel.inspect = null; refreshPlans(); bInfo();
});
function unitInfo(u) {
  const st = ST(), t = B.terrainAt(st, u.x, u.y), s = B.stats(st, u);
  const wrap = el('div', {}, el('div', {class: 'plan'}, el('b', {}, u.name), el('span', {class: 'muted'}, `${clsName(u)} Lv${u.lvl}・${WEAPONS[u.weapon].name}・${t.name}`)),
    el('div', {class: 'stats', style: 'margin:4px 0'}, ...[['生命', `${u.hp}/${u.max}`], ['攻擊', s.atk], ['命中', s.hit], ['迴避', s.avo], ['防禦', s.def]].map(([k, v]) => el('span', {}, k + ' ', el('b', {}, v)))),
    el('div', {}, ...traitTags(u)));
  if (u.side === 'ally' && !u.hero) { const p = (bsel?.plans || []).find(p => p.id === u.id); wrap.append(el('div', {class: 'muted', style: 'font-size:13px;margin-top:4px'}, `忠誠 ${Math.round(u.loyalty)}・這回合${st.obey[u.id] === false ? '不聽令' : '聽令'}${p ? `・打算：${planText(p)}` : ''}`)); }
  return wrap;
}
function planText(p) { if (p.hidden) return '不聽令——看不出他在打算什麼'; const t = p.target && uById(p.target); return p.kind === 'attack' ? `${p.why}→${t?.name}（命中 ${p.f?.aHit ?? '?'}%）` : p.kind === 'heal' ? `包紮 ${t?.name}` : p.why; }
function bInfo() {
  const st = ST(), box = $('bInfo'), acts = $('bActions'); box.innerHTML = ''; acts.innerHTML = '';
  $('bTurn').textContent = `第 ${st.turn} 回合・敵人 ${B.living(st, 'enemy').length}`;
  if (st.result) return;
  if (!bsel || !bsel.plans) refreshPlans();
  const h = B.hero(st);
  if (bsel.target) {
    const e = uById(bsel.target), from = bsel.to || [h.x, h.y], f = B.forecast(st, h, e, from[0], from[1]);
    const triTxt = f.tri > 0 ? '武器有利' : f.tri < 0 ? '武器不利' : '';
    box.append(el('div', {class: 'fc'},
      el('div', {}, el('b', {}, h.name)), el('div', {class: 'mid'}, triTxt || 'VS'), el('div', {class: 'r'}, el('b', {}, e.name)),
      el('div', {class: 'big'}, `${h.hp}`), el('div', {class: 'mid'}, '生命'), el('div', {class: 'big r'}, `${e.hp}`),
      el('div', {}, `${f.aDmg}${f.aCount > 1 ? ' ×2' : ''}`), el('div', {class: 'mid'}, '傷害'), el('div', {class: 'r'}, f.canCounter ? `${f.dDmg}${f.dCount > 1 ? ' ×2' : ''}` : '無法反擊'),
      el('div', {}, `${f.aHit}%`), el('div', {class: 'mid'}, '命中'), el('div', {class: 'r'}, f.canCounter ? `${f.dHit}%` : '—'),
      el('div', {}, `${f.aCrit}%`), el('div', {class: 'mid'}, '暴擊'), el('div', {class: 'r'}, f.canCounter ? `${f.dCrit}%` : '—')));
    acts.append(el('button', {class: 'primary', onclick: () => commit({type: 'hero', to: from, act: {kind: 'attack', target: e.id}})}, '攻擊'), el('button', {onclick: () => { bsel.target = null; bInfo(); }}, '取消'));
    return;
  }
  if (bsel.inspect) { box.append(unitInfo(uById(bsel.inspect))); }
  else {
    box.append(el('div', {class: 'muted', style: 'font-size:13px'}, `命令：${ORDERS[st.order.stance].name}——${ORDERS[st.order.stance].desc}。點藍色格子移動，點敵人看預測。`));
    for (const p of bsel.plans) { const u = uById(p.id); box.append(el('div', {class: 'plan' + (p.disobey ? ' dis' : '')}, el('b', {}, u.name), el('span', {}, planText(p)))); }
  }
  const to = bsel.to || [h.x, h.y], edge = to[0] === 0 || to[1] === 0 || to[0] === B.W - 1 || to[1] === B.H - 1;
  acts.append(el('button', {class: 'primary', onclick: () => commit({type: 'hero', to, act: {kind: 'wait'}})}, bsel.to ? '移動並待命' : '待命'));
  if (edge) acts.append(el('button', {class: 'danger', onclick: () => { if (confirm('撤離戰場？還跟敵人貼身纏鬥的同伴會被丟下。')) commit({type: 'flee', to}); }}, '撤離'));
  if (bsel.to || bsel.inspect) acts.append(el('button', {onclick: () => { bsel = null; refreshPlans(); bInfo(); }}, '取消'));
}
$('showDanger').onchange = () => { if (bsel) { bsel.danger = null; bsel.eplans = null; } };
async function commit(action) {
  if (animating) return;
  const st = ST(); let ev;
  try { ev = B.act(st, action); } catch (e) { toast(e.message); return; }
  animating = true; $('bActions').innerHTML = ''; $('bInfo').innerHTML = '';
  save(false);
  await play(ev);
  animating = false; bsel = null; syncDisp();
  if (st.result) return battleOver();
  refreshPlans(); bInfo();
}
async function play(events) {
  for (const e of events) {
    const d = disp[e.id] || disp[e.a];
    if (e.t === 'move') { for (let i = 1; i < e.path.length; i++) { await tween(disp[e.id], e.path[i][0], e.path[i][1], 80); } }
    else if (e.t === 'strike') {
      const a = disp[e.a], t = disp[e.d], dx = Math.sign(t.x - a.x) * 0.25, dy = Math.sign(t.y - a.y) * 0.25;
      a.ox = dx; a.oy = dy; await sleep(110); a.ox = 0; a.oy = 0;
      popups.push({x: t.x, y: t.y, text: e.hit ? (e.crit ? `暴擊 ${e.dmg}` : `${e.dmg}`) : '未命中', color: e.hit ? (e.crit ? '#ffd166' : '#ffffff') : '#a8997d', t0: performance.now()});
      t.hp = e.hp; await sleep(330);
    }
    else if (e.t === 'die') { const u = disp[e.id]; for (let k = 0; k < 6; k++) { u.alpha -= 0.17; await sleep(50); } u.alpha = 0; const un = uById(e.id); if (un.side === 'ally') toast(`${un.name}倒下了`, 2500); }
    else if (e.t === 'heal') { const t = disp[e.d]; popups.push({x: t.x, y: t.y, text: `+${e.amt}`, color: '#7fbf6a', t0: performance.now()}); t.hp = e.hp; await sleep(400); }
    else if (e.t === 'flee' || e.t === 'captured') { const u = disp[e.id]; if (e.t === 'captured') popups.push({x: u.x, y: u.y, text: '被俘', color: '#e06a52', t0: performance.now()}); for (let k = 0; k < 5; k++) { u.alpha -= 0.2; await sleep(40); } u.alpha = 0; }
    else if (e.t === 'level') { const u = uById(e.id), gains = Object.keys(e.gains).map(k => ({hp: '生命', str: '力量', skl: '技巧', spd: '速度', def: '防禦'}[k] + '+1')).join(' '); toast(`${u.name} 升到 Lv${e.lvl}！${gains || '（什麼都沒長）'}`, 2600); await sleep(500); }
    else if (e.t === 'bark') { bubbles.push({id: e.id, text: e.text, t0: performance.now()}); }
    else if (e.t === 'phase') { await banner(e.side === 'ally' ? '同伴行動' : '敵人行動', 450); }
    else if (e.t === 'turn') { $('bTurn').textContent = `第 ${e.n} 回合`; await banner(`第 ${e.n} 回合`, 450); }
    void d;
  }
}
function tween(d, x, y, ms) { return new Promise(res => { const x0 = d.x, y0 = d.y, t0 = performance.now(); const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); d.x = x0 + (x - x0) * k; d.y = y0 + (y - y0) * k; if (k < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); }); }
function battleOver() {
  const {setup, st} = G.battle, w = G.world; lastSt = st;
  const lvBefore = new Map(w.party.map(m => [m.id, m.lvl]));
  const out = Wd.applyBattle(w, setup, st);
  G.battle = null; save();
  if (w.over) return gameOver();
  const box = el('div', {}, el('h2', {}, st.result === 'win' ? '勝利' : st.result === 'retreat' ? '撤退' : '戰鬥結束'));
  for (const l of out.lines) box.append(el('p', {}, l));
  for (const m of w.party) { const u = st.units.find(x => x.id === m.id); if (!u) continue; const lv = m.lvl - (lvBefore.get(m.id) || m.lvl); box.append(el('div', {class: 'plan'}, el('b', {}, m.name), el('span', {class: 'muted'}, `生命 ${m.hp}/${m.max}・擊倒 ${u.kills}${lv ? `・升了 ${lv} 級` : ''}`))); }
  openSheet(box, () => worldScreen());
}
function gameOver() {
  const w = G.world; wipe();
  const h = {name: w.party.find(m => m.hero)?.name};
  const box = el('div', {}, el('h2', {}, '旅程結束'),
    el('p', {}, `你在第 ${w.day} 天倒在${w.over?.where || '路上'}。`),
    el('p', {class: 'muted'}, `打過 ${w.battles} 場仗，隊伍一共擊倒 ${w.kills} 個敵人。`));
  if (w.fallen.length) { box.append(el('h3', {}, '先你而去的人')); for (const f of w.fallen) box.append(el('p', {class: 'muted'}, `${f.name}（${CLASSES[f.cls].name}）・第 ${f.day} 天・${f.how}`)); }
  const alive = w.party.filter(m => !m.hero); if (alive.length) { box.append(el('h3', {}, '活下來的人')); box.append(el('p', {class: 'muted'}, alive.map(m => m.name).join('、') + '——他們會各自散去。')); }
  box.append(el('button', {class: 'primary', onclick: () => { closeSheet(); G = {world: null, battle: null}; titleScreen(); }}, '重新開始'));
  void h; const lock = () => {}; lock.locked = true; openSheet(box, lock);
}
addEventListener('resize', () => { if (!$('battle').hidden) { bsel && (bsel.reach = null); } });

/* ───────────── 啟動 ───────────── */
loadArt().then(titleScreen);
