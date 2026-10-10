// 像素工作室：編輯器、本機暫存（IndexedDB）與伺服器同步
'use strict';
const $ = id => document.getElementById(id);
const DB32 = '000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30'.split(' ').map(h => '#' + h);
const MAX_UNDO = 80;

/* ───────────── 小工具 ───────────── */
const toast = (msg, ms = 2600) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); };
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), b => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'[b & 63]).join('');
const hex2rgba = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
const rgba2hex = c => '#' + c.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
const when = t => { const d = new Date(t), s = (Date.now() - t) / 1000; if (s < 60) return '剛剛'; if (s < 3600) return Math.floor(s / 60) + ' 分鐘前'; if (s < 86400) return Math.floor(s / 3600) + ' 小時前'; return d.toLocaleDateString('zh-TW') + ' ' + d.toTimeString().slice(0, 5); };

function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
async function pipe(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()); }
const zip = u8 => pipe(u8, new CompressionStream('deflate'));
const unzip = u8 => pipe(u8, new DecompressionStream('deflate'));

/* ───────────── 本機資料庫 ───────────── */
const idb = (() => {
  let dbp;
  const open = () => dbp ??= new Promise((ok, no) => { const r = indexedDB.open('pixel-studio', 1); r.onupgradeneeded = () => r.result.createObjectStore('docs', {keyPath: 'id'}); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((ok, no) => { const t = db.transaction('docs', mode), s = t.objectStore('docs'); const r = fn(s); t.oncomplete = () => ok(r && r.result); t.onerror = () => no(t.error); }); };
  return {get: id => tx('readonly', s => s.get(id)), all: () => tx('readonly', s => s.getAll()), put: rec => tx('readwrite', s => s.put(rec)), del: id => tx('readwrite', s => s.delete(id))};
})();

/* ───────────── 伺服器 ───────────── */
let online = navigator.onLine, authed = false;
async function api(path, opt = {}) {
  const r = await fetch(path, {...opt, headers: {'x-studio': '1', ...(opt.body ? {'content-type': 'application/json'} : {}), ...(opt.headers || {})}, credentials: 'same-origin', cache: 'no-store'});
  setOnline(true);
  let data = null; try { data = await r.json(); } catch {}
  if (r.status === 401 && path !== '/api/login') { authed = false; showLogin(); }
  return {ok: r.ok, status: r.status, data};
}
function setOnline(v) { online = v; renderNet(); }
function renderNet() {
  const n = $('net'); if (!n) return;
  n.textContent = !online ? '離線（改動會留在這台裝置，連線後同步）' : authed ? '已連線' : '未登入';
  n.className = 'pill ' + (online && authed ? 'ok' : 'warn');
}
addEventListener('online', () => { setOnline(true); syncSoon(200); });
addEventListener('offline', () => setOnline(false));

/* ───────────── 作品 序列化 ───────────── */
async function serialize(doc) {
  const layers = [];
  for (const L of doc.layers) layers.push({name: L.name, visible: L.visible, opacity: L.opacity, px: b64(await zip(new Uint8Array(L.px.buffer)))});
  return JSON.stringify({v: 1, palette: doc.palette, guides: doc.guides || '0', mirror: doc.mirror || 0, platform: doc.platform || 'free', lockPal: !!doc.lockPal, freePalette: doc.freePalette || null, layers});
}
async function deserialize(rec) {
  const doc = {id: rec.id, name: rec.name, w: rec.w, h: rec.h, palette: DB32.slice(), layers: []};
  if (rec.data) {
    const d = JSON.parse(rec.data); doc.palette = d.palette || doc.palette; doc.guides = d.guides || '0'; doc.mirror = d.mirror || 0; doc.platform = d.platform || 'free'; doc.lockPal = !!d.lockPal; doc.freePalette = d.freePalette || null;
    for (const L of d.layers) {
      const raw = await unzip(unb64(L.px)), px = new Uint8ClampedArray(rec.w * rec.h * 4); px.set(raw.subarray(0, px.length));
      doc.layers.push({uid: rid(), name: L.name, visible: L.visible !== false, opacity: L.opacity ?? 1, px});
    }
  }
  if (!doc.layers.length) doc.layers.push(newLayer(doc, '圖層 1'));
  return doc;
}
const newLayer = (doc, name) => ({uid: rid(), name, visible: true, opacity: 1, px: new Uint8ClampedArray(doc.w * doc.h * 4)});

function composite(doc, onlyVisible = true, target) {
  const out = target || new Uint8ClampedArray(doc.w * doc.h * 4); out.fill(0);
  for (const L of doc.layers) {
    if (onlyVisible && !L.visible) continue;
    const p = L.px, op = L.opacity;
    for (let i = 0; i < p.length; i += 4) {
      const a = p[i + 3] / 255 * op; if (!a) continue;
      const da = out[i + 3] / 255, oa = a + da * (1 - a);
      for (let k = 0; k < 3; k++) out[i + k] = (p[i + k] * a + out[i + k] * da * (1 - a)) / oa;
      out[i + 3] = oa * 255;
    }
  }
  return out;
}
function thumbOf(doc) {
  const c = document.createElement('canvas'), s = Math.max(1, Math.floor(96 / Math.max(doc.w, doc.h)));
  c.width = doc.w * s; c.height = doc.h * s;
  const src = document.createElement('canvas'); src.width = doc.w; src.height = doc.h;
  src.getContext('2d').putImageData(new ImageData(composite(doc), doc.w, doc.h), 0, 0);
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/* ───────────── 同步 ───────────── */
// 本機紀錄：{id,name,w,h,data,thumb,version(伺服器版本),updated,dirty,rev,local(尚未上傳)}
let syncing = false, syncAgain = false, syncTimer = null;
const syncSoon = (ms = 1500) => { clearTimeout(syncTimer); syncTimer = setTimeout(syncAll, ms); };
async function syncAll() {
  if (syncing) { syncAgain = true; return; }
  if (!online || !authed) { renderSave(); return; }
  syncing = true; renderSave();
  try {
    for (const rec of await idb.all()) if (rec.dirty) await syncOne(rec);
  } catch (e) { if (e instanceof TypeError) setOnline(false); else console.error(e); }
  syncing = false; renderSave();
  if (syncAgain) { syncAgain = false; syncSoon(300); }
}
async function syncOne(rec) {
  const sentRev = rec.rev;
  let r;
  if (rec.local) {
    r = await api('/api/docs', {method: 'POST', body: JSON.stringify({id: rec.id, name: rec.name, w: rec.w, h: rec.h, data: rec.data, thumb: rec.thumb})});
    if (r.status === 409) { rec.local = false; rec.version = 1; await idb.put(rec); return syncOne(rec); }
  } else {
    r = await api('/api/docs/' + rec.id, {method: 'PUT', body: JSON.stringify({baseVersion: rec.version, name: rec.name, w: rec.w, h: rec.h, data: rec.data, thumb: rec.thumb, snapshot: rec.snapshot, note: rec.note})});
  }
  if (r.ok) {
    const now = await idb.get(rec.id) || rec;
    now.version = r.data.version; now.local = false; now.snapshot = false; now.note = '';
    if (now.rev === sentRev) now.dirty = false;
    await idb.put(now); return;
  }
  if (r.status === 409) return resolveConflict(rec);
  if (r.status === 413) { toast(r.data?.error || '作品太大，存不上伺服器（仍保存在這台裝置）', 6000); return; }
  if (r.status === 404 && !rec.local) { rec.local = true; await idb.put(rec); return syncOne(rec); }
}
// 衝突：別的裝置先存了。把這邊的版本另存成副本，原作品換成伺服器上的版本。
async function resolveConflict(rec) {
  const copyName = rec.name + '（衝突副本）', copyId = rid();
  await idb.put({...rec, id: copyId, name: copyName, local: true, dirty: true, rev: 1, version: 0});
  const s = await api('/api/docs/' + rec.id);
  if (s.ok) await idb.put({...s.data, dirty: false, rev: 0, local: false});
  if (cur && cur.id === rec.id) await openDoc(rec.id, true);
  toast(`另一台裝置改過「${rec.name}」。你這邊的修改另存為「${copyName}」。`, 7000);
  await syncOne(await idb.get(copyId));
}

/* ───────────── 畫面切換 ───────────── */
function show(id) { for (const s of ['login', 'home', 'assets', 'editor']) $(s).hidden = s !== id; }
function showLogin(msg) {
  if (!$('login').hidden) return;
  flush();
  $('loginMsg').textContent = msg || ''; show('login'); $('loginKey').focus();
  idb.all().then(a => { $('offlineBtn').hidden = !a.length; });
}
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('loginMsg').textContent = '';
  try {
    const r = await api('/api/login', {method: 'POST', body: JSON.stringify({key: $('loginKey').value})});
    if (!r.ok) { $('loginMsg').textContent = r.data?.error || '登入失敗'; return; }
    authed = true; $('loginKey').value = ''; await goHome(); syncSoon(100);
  } catch { $('loginMsg').textContent = '連不上伺服器'; $('offlineBtn').hidden = false; }
});
$('offlineBtn').onclick = () => goHome();
$('logoutBtn').onclick = async () => { await flush(); try { await api('/api/logout', {method: 'POST'}); } catch {} authed = false; showLogin(); };

/* ───────────── 作品列表 ───────────── */
let showTrash = false;
async function goHome() {
  await flush(); cur = null; show('home'); renderNet(); await renderHome();
}
async function renderHome() {
  $('listTitle').textContent = showTrash ? '垃圾桶' : '我的作品';
  $('trashBtn').textContent = showTrash ? '回作品' : '垃圾桶';
  const local = new Map((await idb.all()).map(r => [r.id, r]));
  let server = null;
  if (online && authed) { try { const r = await api('/api/docs' + (showTrash ? '?trash=1' : '')); if (r.ok) server = r.data; } catch { setOnline(false); } }
  let items;
  if (showTrash) items = (server || []).map(s => ({...s, trash: true}));
  else {
    const m = new Map();
    for (const s of server || []) { const l = local.get(s.id); m.set(s.id, {...s, ...(l && (l.dirty || l.version >= s.version) ? {name: l.name, thumb: l.thumb, updated: Math.max(l.updated, s.updated), dirty: l.dirty} : {})}); }
    for (const l of local.values()) if (!m.has(l.id) && (l.dirty || l.local || !server)) m.set(l.id, l);
    // 伺服器上已不存在（被刪或在垃圾桶）、本機又沒有未同步改動的，清掉本機快取
    if (server) for (const l of local.values()) if (!m.has(l.id)) idb.del(l.id);
    items = [...m.values()].sort((a, b) => b.updated - a.updated);
  }
  const box = $('docs'); box.innerHTML = '';
  $('empty').hidden = items.length > 0;
  $('empty').textContent = showTrash ? '垃圾桶是空的。' : '還沒有作品。從上面挑個尺寸開始吧。';
  for (const d of items) {
    const el = document.createElement('div'); el.className = 'doc';
    el.innerHTML = `<div class="th">${d.thumb ? `<img alt="">` : ''}</div><div class="meta"><b></b><span class="muted">${d.w}×${d.h}・${when(d.updated)}${d.dirty ? '・<span style="color:var(--accent)">未同步</span>' : ''}</span></div><div class="acts"></div>`;
    if (d.thumb) el.querySelector('img').src = d.thumb;
    el.querySelector('b').textContent = d.name;
    const acts = el.querySelector('.acts');
    const btn = (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.onclick = e => { e.stopPropagation(); fn(); }; acts.append(b); };
    if (d.trash) {
      btn('救回來', async () => { await api(`/api/docs/${d.id}/restore`, {method: 'POST'}); renderHome(); });
      btn('永久刪除', async () => { if (!confirm(`永久刪除「${d.name}」和它的所有版本？這無法復原。`)) return; await api(`/api/docs/${d.id}?purge=1`, {method: 'DELETE'}); renderHome(); });
    } else {
      el.onclick = () => openDoc(d.id);
      btn('丟垃圾桶', async () => {
        if (!online || !authed) { toast('離線時不能刪除，連線後再試'); return; }
        const l = local.get(d.id);
        if (l && l.local) { await idb.del(d.id); renderHome(); return; }
        const r = await api('/api/docs/' + d.id, {method: 'DELETE'}); if (r.ok) { await idb.del(d.id); toast('已移到垃圾桶'); renderHome(); }
      });
      btn('複製', async () => { const doc = await loadDoc(d.id); if (!doc) return; doc.id = rid(); doc.name += ' 複本'; await saveLocal(doc, true); renderHome(); });
    }
    box.append(el);
  }
}
$('trashBtn').onclick = () => { showTrash = !showTrash; renderHome(); };
document.querySelectorAll('[data-size]').forEach(b => b.onclick = () => createDoc(+b.dataset.size, +b.dataset.size));
$('customNew').onclick = () => createDoc(Math.min(512, Math.max(1, +$('cw').value | 0)), Math.min(512, Math.max(1, +$('ch').value | 0)));
async function createDoc(w, h) {
  const plat = $('newPlat').value;
  const doc = {id: rid(), name: `新作品 ${w}×${h}`, w, h, palette: plat === 'gba16' ? [] : DB32.slice(), platform: plat, layers: []};
  doc.layers.push(newLayer(doc, '圖層 1'));
  await saveLocal(doc, true);
  openDoc(doc.id);
}

/* ───────────── 讀寫單一作品 ───────────── */
async function loadDoc(id, preferServer) {
  let rec = await idb.get(id);
  if (online && authed && (!rec || (!rec.dirty && !rec.local) || preferServer)) {
    try {
      const r = await api('/api/docs/' + id);
      if (r.ok && (!rec || !rec.dirty || preferServer)) { rec = {...r.data, dirty: false, rev: 0, local: false}; await idb.put(rec); }
    } catch { setOnline(false); }
  }
  return rec ? deserialize(rec) : null;
}
async function saveLocal(doc, isNew, extra = {}) {
  const old = await idb.get(doc.id);
  const rec = {id: doc.id, name: doc.name, w: doc.w, h: doc.h, data: await serialize(doc), thumb: thumbOf(doc), updated: Date.now(),
    version: old?.version ?? 0, local: old ? old.local : true, dirty: true, rev: (old?.rev || 0) + 1, snapshot: old?.snapshot || !!extra.snapshot, note: extra.note || old?.note || ''};
  await idb.put(rec); syncSoon(isNew ? 200 : 1500);
}

/* ───────────── 編輯器 ───────────── */
let cur = null, active = 0, tool = 'pencil', color = [0, 0, 0, 255], brush = 1, grid = true;
let undo = [], redo = [], dirty = false, saveTimer = null, saving = null;
const view = {z: 8, x: 0, y: 0};
const cv = $('view'), g = cv.getContext('2d');
const flat = document.createElement('canvas'), fg = flat.getContext('2d');
let flatBuf = null;

async function openDoc(id, keepView) {
  const doc = await loadDoc(id, keepView);
  if (!doc) { toast('打不開這件作品（離線且這台裝置沒有它的副本）'); return; }
  cur = doc; active = Math.min(active, doc.layers.length - 1); if (!keepView) active = doc.layers.length - 1;
  undo = []; redo = []; dirty = false;
  flat.width = doc.w; flat.height = doc.h; flatBuf = new Uint8ClampedArray(doc.w * doc.h * 4);
  show('editor'); $('docName').value = doc.name;
  if (!keepView) fit();
  $('guides').value = doc.guides || '0'; renderMirror(); renderPlatform(); hiColor = null; lastCount = '';
  resize(); renderPalette(); renderLayers(); renderSave(); updateUndo();
}
function markDirty() {
  dirty = true; renderSave();
  clearTimeout(saveTimer); saveTimer = setTimeout(flush, 700);
}
async function flush(extra) {
  clearTimeout(saveTimer);
  if (saving) await saving;
  if (!cur || (!dirty && !extra)) return;
  dirty = false; const doc = cur;
  saving = saveLocal(doc, false, extra).catch(e => { dirty = true; toast('存到本機失敗：' + e.message, 5000); });
  await saving; saving = null; renderSave();
}
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flush(); syncSoon(0); } });
addEventListener('pagehide', () => flush());

async function renderSave() {
  const el = $('saveState'); if (!el || !cur) return;
  const rec = await idb.get(cur.id);
  let t, c;
  if (dirty || saving) { t = '編輯中…'; c = 'warn'; }
  else if (syncing) { t = '同步中…'; c = 'warn'; }
  else if (rec?.dirty) { t = !online ? '已存在本機・離線' : !authed ? '已存在本機・未登入' : '已存在本機・等待同步'; c = 'warn'; }
  else { t = '已同步'; c = 'ok'; }
  el.textContent = t; el.className = 'pill ' + c;
}

/* 繪製 */
function resize() {
  const r = $('stage').getBoundingClientRect(), d = devicePixelRatio || 1;
  cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); draw();
}
new ResizeObserver(() => cur && resize()).observe($('stage'));
function fit() {
  const r = $('stage').getBoundingClientRect();
  view.z = Math.max(1, Math.floor(Math.min((r.width - 32) / cur.w, (r.height - 32) / cur.h)) || 1);
  view.x = Math.round((r.width - cur.w * view.z) / 2); view.y = Math.round((r.height - cur.h * view.z) / 2);
}
let raf = 0;
const draw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };
function paint() {
  if (!cur) return;
  const d = devicePixelRatio || 1, W = cv.width, H = cv.height, z = view.z * d, ox = view.x * d, oy = view.y * d;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
  const pw = cur.w * z, ph = cur.h * z;
  // 透明棋盤
  g.save(); g.beginPath(); g.rect(ox, oy, pw, ph); g.clip();
  const cs = Math.max(8, z / 2) ;
  g.fillStyle = '#cfcfcf'; g.fillRect(ox, oy, pw, ph); g.fillStyle = '#efefef';
  for (let y = 0; y * cs < ph; y++) for (let x = (y & 1); x * cs < pw; x += 2) g.fillRect(ox + x * cs, oy + y * cs, cs, cs);
  g.restore();
  composite(cur, true, flatBuf); fg.putImageData(new ImageData(flatBuf, cur.w, cur.h), 0, 0); updateCount();
  g.imageSmoothingEnabled = false; g.drawImage(flat, ox, oy, pw, ph);
  if (grid && view.z >= 6) {
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1; g.beginPath();
    for (let x = 0; x <= cur.w; x++) { const X = Math.round(ox + x * z) + .5; g.moveTo(X, oy); g.lineTo(X, oy + ph); }
    for (let y = 0; y <= cur.h; y++) { const Y = Math.round(oy + y * z) + .5; g.moveTo(ox, Y); g.lineTo(ox + pw, Y); }
    g.stroke();
  }
  g.strokeStyle = 'rgba(128,128,128,.6)'; g.strokeRect(ox - .5, oy - .5, pw + 1, ph + 1);
  // 等分參考線
  const gd = cur.guides || '0';
  if (gd !== '0') {
    const n = +gd.slice(1), xs = [], ys = [];
    if (gd[0] === 'd') { for (let i = 1; i < n; i++) { xs.push(Math.round(cur.w * i / n)); ys.push(Math.round(cur.h * i / n)); } }
    else { for (let i = n; i < cur.w; i += n) xs.push(i); for (let i = n; i < cur.h; i += n) ys.push(i); }
    g.setLineDash([]); g.beginPath();
    for (const x of xs) { const X = Math.round(ox + x * z) + .5; g.moveTo(X, oy); g.lineTo(X, oy + ph); }
    for (const y of ys) { const Y = Math.round(oy + y * z) + .5; g.moveTo(ox, Y); g.lineTo(ox + pw, Y); }
    g.lineWidth = 3 * d; g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke();   // 深色襯底，任何底色上都看得到
    g.lineWidth = Math.max(1, d); g.strokeStyle = 'rgba(80,220,255,.95)'; g.stroke();
  }
  // 鏡像軸
  if (cur.mirror) {
    g.lineWidth = Math.max(2, 2 * d); g.strokeStyle = 'rgba(255,60,180,.85)'; g.setLineDash([6 * d, 4 * d]); g.beginPath();
    if (cur.mirror & 1) { const X = ox + pw / 2; g.moveTo(X, oy); g.lineTo(X, oy + ph); }
    if (cur.mirror & 2) { const Y = oy + ph / 2; g.moveTo(ox, Y); g.lineTo(ox + pw, Y); }
    g.stroke(); g.setLineDash([]);
  }
  if (hiColor !== null) {   // 標出用到某個顏色的格子
    g.fillStyle = (performance.now() / 400 | 0) % 2 ? 'rgba(255,0,200,.75)' : 'rgba(0,255,255,.75)';
    for (let i = 0, n = cur.w * cur.h; i < n; i++) { const k = i * 4; if (flatBuf[k + 3] && ((flatBuf[k] << 16) | (flatBuf[k + 1] << 8) | flatBuf[k + 2]) === hiColor) g.fillRect(ox + (i % cur.w) * z + z * .25, oy + (i / cur.w | 0) * z + z * .25, z * .5, z * .5); }
    if (!hiTimer) hiTimer = setTimeout(() => { hiTimer = 0; draw(); }, 400);
  }
  if (hover && (tool === 'pencil' || tool === 'eraser' || tool === 'lighten' || tool === 'darken')) {
    const o = Math.floor((brush - 1) / 2);
    g.strokeStyle = tool === 'eraser' ? '#ff5050' : tool === 'lighten' ? '#ffe066' : tool === 'darken' ? '#7a6cff' : '#fff'; g.lineWidth = Math.max(1, d);
    for (const [hx, hy] of mirrors(hover[0] - o, hover[1] - o)) {
      const fx = (cur.mirror & 1) && hx !== hover[0] - o ? hx - brush + 1 : hx, fy = (cur.mirror & 2) && hy !== hover[1] - o ? hy - brush + 1 : hy;
      g.strokeRect(ox + fx * z, oy + fy * z, brush * z, brush * z);
    }
  }
}

/* 圖層面板 */
function renderLayers() {
  const box = $('layers'); box.innerHTML = '';
  for (let i = cur.layers.length - 1; i >= 0; i--) {
    const L = cur.layers[i], row = document.createElement('div');
    row.className = 'layer' + (i === active ? ' on' : '');
    const eye = document.createElement('button'); eye.className = 'eye'; eye.textContent = L.visible ? '👁' : '—'; eye.title = L.visible ? '隱藏' : '顯示';
    eye.onclick = e => { e.stopPropagation(); docOp(() => { L.visible = !L.visible; }); };
    const th = document.createElement('canvas'); th.width = cur.w; th.height = cur.h; th.getContext('2d').putImageData(new ImageData(L.px.slice(), cur.w, cur.h), 0, 0);
    const name = document.createElement('input'); name.value = L.name; name.setAttribute('aria-label', '圖層名稱');
    name.onchange = () => docOp(() => { L.name = name.value.slice(0, 40) || L.name; });
    row.onclick = e => { if (e.target === name && i === active) return; active = i; renderLayers(); };
    row.append(eye, th, name); box.append(row);
  }
  $('opacity').value = Math.round(cur.layers[active].opacity * 100); $('opacity').disabled = isGBA();
  $('delLayer').disabled = cur.layers.length < 2; $('mergeLayer').disabled = active === 0;
  $('upLayer').disabled = active === cur.layers.length - 1; $('downLayer').disabled = active === 0;
}
let layerThumbTimer = 0;
const refreshLayerThumbs = () => { clearTimeout(layerThumbTimer); layerThumbTimer = setTimeout(() => cur && !$('editor').hidden && renderLayers(), 250); };

/* 復原 */
const cloneLayers = ls => ls.map(L => ({...L, px: L.px.slice()}));
const docState = () => ({layers: cloneLayers(cur.layers), active, palette: cur.palette.slice(), platform: cur.platform, freePalette: cur.freePalette && cur.freePalette.slice(), lockPal: cur.lockPal});
function pushUndo(e) { undo.push(e); if (undo.length > MAX_UNDO) undo.shift(); redo = []; updateUndo(); }
function updateUndo() { $('undoBtn').disabled = !undo.length; $('redoBtn').disabled = !redo.length; }
function docOp(fn) {
  const before = docState();
  fn();
  pushUndo({type: 'doc', before, after: docState()});
  active = Math.max(0, Math.min(active, cur.layers.length - 1));
  renderLayers(); draw(); markDirty();
}
function applyEntry(e, dir) {
  if (e.type === 'px') { const L = cur.layers.find(l => l.uid === e.uid); if (L) L.px.set(dir < 0 ? e.before : e.after); }
  else { const s = dir < 0 ? e.before : e.after; cur.layers = cloneLayers(s.layers); active = s.active; if (s.palette) { cur.palette = s.palette.slice(); cur.platform = s.platform; cur.freePalette = s.freePalette; cur.lockPal = s.lockPal; renderPlatform(); } }
}
function doUndo() { const e = undo.pop(); if (!e) return; applyEntry(e, -1); redo.push(e); after(); }
function doRedo() { const e = redo.pop(); if (!e) return; applyEntry(e, 1); undo.push(e); after(); }
function after() { active = Math.max(0, Math.min(active, cur.layers.length - 1)); updateUndo(); renderLayers(); draw(); markDirty(); }

/* 圖層按鈕 */
$('addLayer').onclick = () => docOp(() => { cur.layers.splice(active + 1, 0, newLayer(cur, '圖層 ' + (cur.layers.length + 1))); active++; });
$('dupLayer').onclick = () => docOp(() => { const L = cur.layers[active]; cur.layers.splice(active + 1, 0, {...L, uid: rid(), name: L.name + ' 複本', px: L.px.slice()}); active++; });
$('delLayer').onclick = () => cur.layers.length > 1 && docOp(() => { cur.layers.splice(active, 1); active = Math.max(0, active - 1); });
$('upLayer').onclick = () => active < cur.layers.length - 1 && docOp(() => { const l = cur.layers; [l[active], l[active + 1]] = [l[active + 1], l[active]]; active++; });
$('downLayer').onclick = () => active > 0 && docOp(() => { const l = cur.layers; [l[active], l[active - 1]] = [l[active - 1], l[active]]; active--; });
$('mergeLayer').onclick = () => active > 0 && docOp(() => {
  const top = cur.layers[active], below = cur.layers[active - 1];
  const tmp = {w: cur.w, h: cur.h, layers: [{...below, visible: true}, {...top, visible: true}]};
  below.px = composite(tmp, true); below.opacity = 1; cur.layers.splice(active, 1); active--;
});
let opBefore = null;
$('opacity').addEventListener('pointerdown', () => { opBefore = {layers: cloneLayers(cur.layers), active}; });
$('opacity').addEventListener('input', () => { cur.layers[active].opacity = $('opacity').value / 100; draw(); });
$('opacity').addEventListener('change', () => {
  const before = opBefore || {layers: cloneLayers(cur.layers), active}; opBefore = null;
  pushUndo({type: 'doc', before, after: {layers: cloneLayers(cur.layers), active}}); markDirty();
});
$('layersToggle').onclick = () => $('side').classList.toggle('open');

/* 調色盤 */
function renderPalette() {
  const box = $('palette'); box.innerHTML = '';
  const h = rgba2hex(color);
  for (const c of cur.palette) {
    const s = document.createElement('span'); s.className = 'swatch' + (c === h && color[3] ? ' on' : ''); s.style.background = c; s.title = c;
    s.onclick = () => setColor(hex2rgba(c)); box.append(s);
  }
  $('cur').style.background = h;
}
function setColor(c) { color = c; if (tool === 'eraser' || tool === 'pan' || tool === 'lighten' || tool === 'darken') setTool('pencil'); renderPalette(); }
$('picker').addEventListener('change', () => {
  let h = $('picker').value.toLowerCase();
  if (isGBA()) { h = rgba2hex(snap15(hex2rgba(h))); $('picker').value = h; }
  if (!cur.palette.includes(h)) {
    if (isGBA() && cur.lockPal) { toast('色票已鎖定，要先解鎖才能加新顏色'); return; }
    if (isGBA() && cur.palette.length >= PAL_MAX) { toast(`GBA 16 色模式的色票最多 ${PAL_MAX} 色（加 1 格透明），先移除一色再加`); return; }
    cur.palette.push(h); markDirty();
  }
  setColor(hex2rgba(h));
});
$('rmColor').onclick = () => { const h = rgba2hex(color), i = cur.palette.indexOf(h); if (i >= 0) { cur.palette.splice(i, 1); renderPalette(); markDirty(); } };

/* 工具 */
function setTool(t) { tool = t; document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t)); cv.style.cursor = t === 'pan' ? 'grab' : 'crosshair'; draw(); }
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
const MIRROR_LABEL = ['鏡像：關', '鏡像：左右', '鏡像：上下', '鏡像：四向'];
function renderMirror() { const b = $('mirrorBtn'), m = cur.mirror || 0; b.textContent = MIRROR_LABEL[m]; b.setAttribute('aria-pressed', m > 0); }
$('mirrorBtn').onclick = () => { cur.mirror = ((cur.mirror || 0) + 1) % 4; renderMirror(); draw(); markDirty(); };
$('guides').onchange = () => { cur.guides = $('guides').value; draw(); markDirty(); };
$('brush').onchange = () => { brush = +$('brush').value; draw(); };
$('gridBtn').onclick = () => { grid = !grid; $('gridBtn').setAttribute('aria-pressed', grid); draw(); };
$('fitBtn').onclick = () => { fit(); draw(); };
$('undoBtn').onclick = doUndo; $('redoBtn').onclick = doRedo;
$('backBtn').onclick = () => goHome();
$('docName').onchange = () => { cur.name = $('docName').value.slice(0, 80) || cur.name; markDirty(); };

// 鏡像：0 關、1 左右、2 上下、3 四向；以畫布正中央為軸
function mirrors(x, y) {
  const m = cur.mirror || 0, mx = cur.w - 1 - x, my = cur.h - 1 - y, out = [[x, y]];
  if (m & 1) out.push([mx, y]);
  if (m & 2) out.push([x, my]);
  if (m === 3) out.push([mx, my]);
  return out;
}
function plot(L, x, y, c) {
  const o = Math.floor((brush - 1) / 2);
  for (let j = 0; j < brush; j++) for (let i = 0; i < brush; i++) {
    for (const [X, Y] of mirrors(x - o + i, y - o + j)) {
      if (X < 0 || Y < 0 || X >= cur.w || Y >= cur.h) continue;
      const k = (Y * cur.w + X) * 4;
      if (stroke && stroke.shade) {   // 明暗筆刷：依「這一筆開始前」的顏色換算，同一格一筆只變一次
        const b = stroke.before; if (!b[k + 3]) continue;
        const key = (b[k] << 16) | (b[k + 1] << 8) | b[k + 2];
        let r = stroke.cache.get(key); if (r === undefined) { r = shadeOf([b[k], b[k + 1], b[k + 2]], stroke.shade); stroke.cache.set(key, r); }
        if (!r) continue; L.px[k] = r[0]; L.px[k + 1] = r[1]; L.px[k + 2] = r[2]; continue;
      }
      L.px[k] = c[0]; L.px[k + 1] = c[1]; L.px[k + 2] = c[2]; L.px[k + 3] = c[3];
    }
  }
}
function fillM(L, x, y, c) { let any = false; for (const [X, Y] of mirrors(x, y)) if (flood(L, X, Y, c)) any = true; return any; }
function line(L, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
  for (;;) { plot(L, x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
}
function flood(L, x, y, c) {
  const W = cur.w, H = cur.h, p = L.px, k0 = (y * W + x) * 4;
  const t = [p[k0], p[k0 + 1], p[k0 + 2], p[k0 + 3]];
  if (t[0] === c[0] && t[1] === c[1] && t[2] === c[2] && t[3] === c[3]) return false;
  const match = k => t[3] === 0 ? p[k + 3] === 0 : p[k] === t[0] && p[k + 1] === t[1] && p[k + 2] === t[2] && p[k + 3] === t[3];
  const stack = [x, y], seen = new Uint8Array(W * H);
  while (stack.length) {
    const yy = stack.pop(), xx = stack.pop(), i = yy * W + xx;
    if (seen[i]) continue; seen[i] = 1;
    const k = i * 4; if (!match(k)) continue;
    p[k] = c[0]; p[k + 1] = c[1]; p[k + 2] = c[2]; p[k + 3] = c[3];
    if (xx > 0) stack.push(xx - 1, yy); if (xx < W - 1) stack.push(xx + 1, yy);
    if (yy > 0) stack.push(xx, yy - 1); if (yy < H - 1) stack.push(xx, yy + 1);
  }
  return true;
}
function pick(x, y) {
  composite(cur, true, flatBuf); const k = (y * cur.w + x) * 4;
  if (flatBuf[k + 3] === 0) { toast('這裡是透明的'); return; }
  setColor([flatBuf[k], flatBuf[k + 1], flatBuf[k + 2], 255]);
}

/* 指標輸入：單指畫、雙指縮放平移、滾輪縮放、空白鍵/中鍵拖曳平移 */
const ptrs = new Map();
let stroke = null, gesture = null, panDrag = null, hover = null, spaceDown = false, altDown = false;
const toPx = e => { const r = cv.getBoundingClientRect(); return [Math.floor((e.clientX - r.left - view.x) / view.z), Math.floor((e.clientY - r.top - view.y) / view.z)]; };
const inside = ([x, y]) => x >= 0 && y >= 0 && x < cur.w && y < cur.h;
function zoomAt(cx, cy, nz) {
  nz = Math.max(1, Math.min(80, nz)); const r = cv.getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
  view.x = px - (px - view.x) * nz / view.z; view.y = py - (py - view.y) * nz / view.z; view.z = nz; draw();
}
function cancelStroke() { if (stroke) { const L = cur.layers.find(l => l.uid === stroke.uid); if (L) L.px.set(stroke.before); stroke = null; draw(); } }
function endStroke() {
  if (!stroke) return;
  const L = cur.layers.find(l => l.uid === stroke.uid);
  if (stroke.changed && L) { pushUndo({type: 'px', uid: L.uid, before: stroke.before, after: L.px.slice()}); markDirty(); refreshLayerThumbs(); }
  stroke = null;
}
cv.addEventListener('pointerdown', e => {
  if (!cur) return; cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
  $('side').classList.remove('open');
  if (ptrs.size === 2) { cancelStroke(); panDrag = null; const [a, b] = [...ptrs.values()]; gesture = {d: Math.hypot(a.x - b.x, a.y - b.y), z: view.z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2}; return; }
  if (ptrs.size > 2) return;
  if (tool === 'pan' || spaceDown || e.button === 1 || e.button === 2) { panDrag = {x: e.clientX, y: e.clientY}; cv.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  const p = toPx(e), L = cur.layers[active];
  const t = altDown ? 'picker' : tool;
  if (t === 'picker') { if (inside(p)) pick(...p); return; }
  if (!L.visible) { toast('這個圖層隱藏中，先打開它再畫'); return; }
  if ((t === 'fill' || t === 'pencil') && !ensureInPalette()) return;
  if (t === 'fill') { if (!inside(p)) return; const before = L.px.slice(); if (fillM(L, ...p, color)) { pushUndo({type: 'px', uid: L.uid, before, after: L.px.slice()}); markDirty(); refreshLayerThumbs(); draw(); } return; }
  stroke = {uid: L.uid, before: L.px.slice(), last: p, changed: true, c: t === 'eraser' ? [0, 0, 0, 0] : color, shade: t === 'lighten' ? 1 : t === 'darken' ? -1 : 0, cache: new Map()};
  plot(L, ...p, stroke.c); draw();
});
cv.addEventListener('pointermove', e => {
  if (!cur) return;
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
  if (gesture && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    view.x += cx - gesture.cx; view.y += cy - gesture.cy; gesture.cx = cx; gesture.cy = cy;
    const nz = Math.round(gesture.z * d / gesture.d); if (nz !== view.z) zoomAt(cx, cy, nz); else draw(); return;
  }
  if (panDrag) { view.x += e.clientX - panDrag.x; view.y += e.clientY - panDrag.y; panDrag = {x: e.clientX, y: e.clientY}; draw(); return; }
  const p = toPx(e); hover = inside(p) ? p : null;
  if (stroke) { const L = cur.layers.find(l => l.uid === stroke.uid); line(L, ...stroke.last, ...p, stroke.c); stroke.last = p; }
  draw();
});
const up = e => {
  ptrs.delete(e.pointerId);
  if (gesture) { if (ptrs.size < 2) gesture = null; return; }
  if (panDrag) { panDrag = null; cv.style.cursor = tool === 'pan' ? 'grab' : 'crosshair'; return; }
  endStroke();
};
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); cancelStroke(); gesture = null; panDrag = null; });
cv.addEventListener('pointerleave', () => { hover = null; draw(); });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaY < 0 ? 1.25 : 0.8; zoomAt(e.clientX, e.clientY, Math.round(view.z * f) === view.z ? view.z + (e.deltaY < 0 ? 1 : -1) : Math.round(view.z * f)); }, {passive: false});

addEventListener('keydown', e => {
  if (!cur || $('editor').hidden || document.querySelector('dialog[open]') || e.target.matches('input,select,textarea')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doRedo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); flush().then(() => syncSoon(0)); return; }
  if (e.ctrlKey || e.metaKey) return;
  if (k === ' ') { spaceDown = true; cv.style.cursor = 'grab'; e.preventDefault(); }
  else if (k === 'alt') { altDown = true; e.preventDefault(); }
  else if (k === 'b') setTool('pencil'); else if (k === 'e') setTool('eraser'); else if (k === 'g') setTool('fill'); else if (k === 'i') setTool('picker'); else if (k === 'h') setTool('pan'); else if (k === 'm') $('mirrorBtn').click(); else if (k === 'l') setTool('lighten'); else if (k === 'd') setTool('darken');
  else if (k === '#') $('gridBtn').click(); else if (k === '0') $('fitBtn').click();
  else if (k === '[' || k === ']') { const o = [...$('brush').options].map(o => +o.value), i = o.indexOf(brush); brush = o[Math.max(0, Math.min(o.length - 1, i + (k === ']' ? 1 : -1)))]; $('brush').value = brush; draw(); }
  else if (k === '+' || k === '=') zoomAt(innerWidth / 2, innerHeight / 2, view.z + 1); else if (k === '-') zoomAt(innerWidth / 2, innerHeight / 2, view.z - 1);
});
addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; cv.style.cursor = tool === 'pan' ? 'grab' : 'crosshair'; } if (e.key === 'Alt') altDown = false; });
addEventListener('blur', () => { spaceDown = altDown = false; });

/* 版本 */
$('histBtn').onclick = async () => {
  await flush(); const box = $('versions'); box.innerHTML = '<p class="muted">讀取中…</p>'; $('histDlg').showModal();
  if (!online || !authed) { box.innerHTML = '<p class="muted">要連線並登入才看得到伺服器上的歷史版本。</p>'; return; }
  await syncAll();
  const r = await api(`/api/docs/${cur.id}/versions`);
  box.innerHTML = r.ok && r.data.length ? '' : '<p class="muted">還沒有歷史版本（作品同步上去之後才會開始記）。</p>';
  for (const v of r.data || []) {
    const el = document.createElement('div'); el.className = 'ver';
    el.innerHTML = `<img alt=""><span>v${v.version}</span><span class="muted">${when(v.saved)}</span>${v.note ? `<span class="muted"></span>` : ''}`;
    el.querySelector('img').src = v.thumb || ''; if (v.note) el.lastChild.textContent = v.note;
    el.onclick = async () => {
      if (!confirm(`把畫面換成 v${v.version}（${when(v.saved)}）？目前的內容會先記成一個版本，之後也能用 ↶ 復原。`)) return;
      const full = await api('/api/versions/' + v.id); if (!full.ok) return;
      const old = await deserialize({...full.data, id: cur.id, name: cur.name, w: full.data.w ?? cur.w, h: full.data.h ?? cur.h});
      if (old.layers[0].px.length !== cur.w * cur.h * 4) { toast('尺寸不同，無法還原'); return; }
      docOp(() => { cur.layers = old.layers; cur.palette = old.palette; active = cur.layers.length - 1; });
      renderPalette(); $('histDlg').close(); await flush({snapshot: true, note: `從 v${v.version} 還原`}); syncSoon(0);
    };
    box.append(el);
  }
};

/* PNG 匯出 */
$('pngBtn').onclick = () => $('pngDlg').showModal();
$('pngDlg').addEventListener('close', () => {
  if ($('pngDlg').returnValue !== 'go') return;
  const s = +$('pngScale').value, c = document.createElement('canvas'); c.width = cur.w * s; c.height = cur.h * s;
  const src = document.createElement('canvas'); src.width = cur.w; src.height = cur.h;
  src.getContext('2d').putImageData(new ImageData(composite(cur, $('pngVisible').checked), cur.w, cur.h), 0, 0);
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(src, 0, 0, c.width, c.height);
  c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${cur.name}${s > 1 ? '@' + s + 'x' : ''}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, 'image/png');
});

/* 啟動 */
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  setTool('pencil');
  try {
    const r = await api('/api/me');
    authed = r.ok; if (!authed) { if (r.status !== 401) showLogin(r.data?.error); return; }
  } catch { setOnline(false); }
  await goHome(); syncSoon(300);
}
setInterval(() => { if (online && authed) syncAll(); }, 30000);
boot();


/* ───────────── 平台模式（GBA 16 色）、明暗筆刷、顏色數檢查 ───────────── */
const PAL_MAX = 15;                       // GBA 4bpp：16 格，第 0 格是透明
const isGBA = () => cur && cur.platform === 'gba16';
const q5 = v => { const q = Math.round(v * 31 / 255); return (q << 3) | (q >> 2); };   // 8-bit → 5-bit → 8-bit
const snap15 = c => [q5(c[0]), q5(c[1]), q5(c[2]), 255];
let hiColor = null, hiTimer = 0, lastCount = '';

function renderPlatform() {
  $('platform').value = cur.platform || 'free';
  $('lockPal').hidden = !isGBA(); $('lockPal').setAttribute('aria-pressed', !!cur.lockPal);
  $('lockPal').textContent = cur.lockPal ? '🔒 色票已鎖' : '🔓 色票未鎖';
  if (isGBA()) { color = color[3] && cur.palette.includes(rgba2hex(color)) ? color : (cur.palette[0] ? hex2rgba(cur.palette[0]) : [0, 0, 0, 255]); }
  $('opacity').disabled = isGBA(); lastCount = ''; renderPalette(); draw();
}
$('lockPal').onclick = () => { cur.lockPal = !cur.lockPal; renderPlatform(); markDirty(); };
// 切換到 GBA：所有像素貼齊 15-bit、半透明變成全透明或不透明、圖層不透明度歸 1；色票換成圖上實際用到的顏色
$('platform').onchange = () => {
  const to = $('platform').value; if (to === (cur.platform || 'free')) return;
  docOp(() => {
    if (to === 'gba16') {
      const used = new Set();
      let fixedOpacity = false;
      for (const L of cur.layers) {
        if (L.opacity !== 1) { L.opacity = 1; fixedOpacity = true; }
        const p = L.px;
        for (let k = 0; k < p.length; k += 4) {
          if (p[k + 3] < 128) { p[k] = p[k + 1] = p[k + 2] = p[k + 3] = 0; continue; }
          p[k] = q5(p[k]); p[k + 1] = q5(p[k + 1]); p[k + 2] = q5(p[k + 2]); p[k + 3] = 255;
          used.add(rgba2hex([p[k], p[k + 1], p[k + 2]]));
        }
      }
      cur.freePalette = cur.palette.slice();
      cur.palette = [...used].slice(0, 64);
      cur.platform = 'gba16';
      setTimeout(() => toast(`已切到 GBA 16 色：顏色貼齊 15-bit，半透明改成全透明或不透明${fixedOpacity ? '，圖層不透明度歸回 100%' : ''}。目前用了 ${used.size} 色${used.size > PAL_MAX ? '，超過上限，記得減色' : ''}。`, 6000), 0);
    } else {
      cur.platform = 'free'; cur.palette = cur.freePalette || DB32.slice(); cur.freePalette = null;
    }
  });
  renderPlatform();
};

// 明暗筆刷：在 OKLCH 色彩空間調整。加亮＝明度上升、色相往暖（黃）偏、最亮處稍降彩度；壓暗＝明度下降、色相往冷（藍紫）偏、彩度稍升
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const gam = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function toOklch([r, g, b]) {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A) * 180 / Math.PI];
}
function fromOklch([L, C, H]) {
  const A = C * Math.cos(H * Math.PI / 180), B = C * Math.sin(H * Math.PI / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  const out = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return out.map(v => Math.max(0, Math.min(255, Math.round(gam(Math.max(0, Math.min(1, v)))))));
}
const toward = (h, target, deg) => { let d = ((target - h + 540) % 360) - 180; return h + Math.sign(d) * Math.min(Math.abs(d), deg); };
function shiftColor(rgb, dir) {
  let [L, C, H] = toOklch(rgb);
  const w = Math.min(1, C / 0.08);                         // 越接近灰色，色相偏移越小
  if (dir > 0) { L = Math.min(1, L + 0.08); H = toward(H, 95, 10 * w); if (L > 0.75) C *= 0.9; }
  else { L = Math.max(0, L - 0.08); H = toward(H, 285, 10 * w); C = Math.min(0.32, C * 1.03); }
  return fromOklch([L, C, H]);
}
const oklab = rgb => { const [L, C, H] = toOklch(rgb); return [L, C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180)]; };
// 沿色票走：在色票裡找「往這個方向一階」最自然的顏色
function stepInPalette(rgb, dir) {
  const [L0, a0, b0] = oklab(rgb); let best = null, bs = Infinity;
  for (const h of cur.palette) {
    const c = hex2rgba(h), [L, a, b] = oklab(c), dL = (L - L0) * dir;
    if (dL < 0.025) continue;
    const sc = dL + 2.2 * Math.hypot(a - a0, b - b0);
    if (sc < bs) { bs = sc; best = c; }
  }
  return best;
}
function shadeOf(rgb, dir) {
  if (!isGBA()) { const c = shiftColor(rgb, dir); return c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2] ? null : c; }
  if (!cur.lockPal) {
    const c = snap15(shiftColor(rgb, dir)), h = rgba2hex(c);
    if (h !== rgba2hex(rgb)) {
      if (cur.palette.includes(h)) return c;
      if (cur.palette.length < PAL_MAX) { cur.palette.push(h); setTimeout(renderPalette, 0); return c; }
    }
  }
  return stepInPalette(rgb, dir);   // 色票滿了或已鎖定：只用色票裡的顏色
}

// 顏色數：看得見的圖層合成後，實際用到幾種不透明顏色
function countColors() {
  const m = new Map(); let semi = 0;
  for (let k = 0; k < flatBuf.length; k += 4) {
    const a = flatBuf[k + 3]; if (!a) continue; if (a < 255) semi++;
    const key = (flatBuf[k] << 16) | (flatBuf[k + 1] << 8) | flatBuf[k + 2]; m.set(key, (m.get(key) || 0) + 1);
  }
  return {m, semi};
}
function updateCount() {
  const {m, semi} = countColors(), n = m.size, el = $('colorCount');
  const over = isGBA() && (n > PAL_MAX || semi > 0);
  const t = isGBA() ? `色數 ${n}/${PAL_MAX}${semi ? '・半透明!' : ''}` : `色數 ${n}`;
  if (t === lastCount) return; lastCount = t;
  el.textContent = t; el.className = 'pill click ' + (over ? 'bad' : isGBA() ? 'ok' : '');
}
const keyHex = k => '#' + k.toString(16).padStart(6, '0');
$('colorCount').onclick = () => {
  composite(cur, true, flatBuf);
  const {m, semi} = countColors(), box = $('colorList'); box.innerHTML = '';
  $('countSum').textContent = `這張圖（看得見的圖層）用了 ${m.size} 種顏色` + (isGBA() ? `，上限 ${PAL_MAX}。` : '。') + (semi ? ` 另有 ${semi} 格是半透明，GBA 不支援。` : '') + ' 點一個顏色會在畫布上標出它的位置。';
  for (const [k, n] of [...m].sort((a, b) => a[1] - b[1])) {
    const h = keyHex(k), row = document.createElement('div'); row.className = 'crow' + (hiColor === k ? ' on' : '');
    const inPal = cur.palette.includes(h);
    row.innerHTML = `<span class="swatch" style="background:${h}"></span><span class="grow">${h}</span><span class="muted">${n} 格</span>${inPal ? '' : '<span class="pill bad">不在色票</span>'}`;
    const rep = document.createElement('button'); rep.textContent = '全換成目前顏色'; rep.title = '把圖上所有這個顏色的格子（所有圖層）換成目前選的顏色';
    rep.onclick = e => { e.stopPropagation(); replaceColor(k); $('countDlg').close(); };
    row.append(rep);
    row.onclick = () => { hiColor = hiColor === k ? null : k; $('countDlg').close(); draw(); if (hiColor !== null) toast('閃爍的格子就是這個顏色；再點同一色或按「取消標示」就關掉', 3500); };
    box.append(row);
  }
  $('clearHi').hidden = hiColor === null;
  $('countDlg').showModal();
};
$('clearHi').onclick = () => { hiColor = null; draw(); };
function replaceColor(k) {
  const r = k >> 16, g2 = (k >> 8) & 255, b = k & 255;
  if (rgba2hex(color) === keyHex(k)) { toast('目前選的就是這個顏色，先選另一色'); return; }
  docOp(() => { for (const L of cur.layers) { const p = L.px; for (let i = 0; i < p.length; i += 4) if (p[i + 3] && p[i] === r && p[i + 1] === g2 && p[i + 2] === b) { p[i] = color[0]; p[i + 1] = color[1]; p[i + 2] = color[2]; } } });
  if (hiColor === k) hiColor = null;
  refreshLayerThumbs();
}

// GBA 模式下，畫上去的顏色一定要在色票裡：還有空位就自動加，滿了或鎖了就擋下
function ensureInPalette() {
  if (!isGBA()) return true;
  const c = snap15(color), h = rgba2hex(c); color = c;
  if (cur.palette.includes(h)) return true;
  if (cur.lockPal) { toast('這個顏色不在已鎖定的色票裡'); return false; }
  if (cur.palette.length >= PAL_MAX) { toast(`色票已滿 ${PAL_MAX} 色，先移除一色或改用色票裡的顏色`); return false; }
  cur.palette.push(h); renderPalette(); markDirty(); return true;
}

/* 手機手勢：擋掉瀏覽器自己的選取、長按選單、雙擊放大、整頁捏合縮放 */
const editable = t => t && t.closest && t.closest('input,textarea,select,[contenteditable]');
document.addEventListener('selectstart', e => { if (!editable(e.target)) e.preventDefault(); });
document.addEventListener('contextmenu', e => { if (!editable(e.target)) e.preventDefault(); });
document.addEventListener('dblclick', e => { if (!editable(e.target)) e.preventDefault(); }, {passive: false});
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), {passive: false});
$('stage').addEventListener('touchstart', e => e.preventDefault(), {passive: false});
$('stage').addEventListener('touchmove', e => e.preventDefault(), {passive: false});

/* 減色：相近色合併。一開始每個顏色各自一群，反覆把「看起來最像」（OKLab 距離最近）的兩群併在一起，
   直到剩 n 群。合併後的代表色取格數較多的那一色，所以結果都是圖上本來就有的顏色，不會混出新的濁色；
   面積小但很不一樣的顏色（眼睛、高光）會被留下來。 */
function mergeSimilar(counts, n) {
  let items = [...counts].map(([k, c]) => ({k, n: c, keys: [k]}));
  // 顏色太多時先把幾乎一樣的顏色（每色 5-bit 相同）收成一群，再進入兩兩合併
  for (const sh of [3, 4, 5, 6, 7]) {
    if (items.length <= 256) break;
    const g = new Map();
    for (const it of items) {
      const b = (it.k >> (16 + sh)) << 16 | ((it.k >> (8 + sh)) & 255) << 8 | ((it.k & 255) >> sh);
      const e = g.get(b);
      if (!e) g.set(b, {...it, keys: it.keys.slice()});
      else { if (it.n > e.n) e.k = it.k; e.n += it.n; e.keys.push(...it.keys); }
    }
    items = [...g.values()];
  }
  const rgbOf = k => [k >> 16, (k >> 8) & 255, k & 255];
  for (const it of items) it.lab = oklab(rgbOf(it.k));
  const dist = (a, b) => (a.lab[0] - b.lab[0]) ** 2 + (a.lab[1] - b.lab[1]) ** 2 + (a.lab[2] - b.lab[2]) ** 2;
  const nnOf = i => { let bj = -1, bd = Infinity; for (let j = 0; j < items.length; j++) if (j !== i && items[j]) { const d = dist(items[i], items[j]); if (d < bd) { bd = d; bj = j; } } items[i].nn = bj; items[i].nd = bd; };
  items.forEach((_, i) => nnOf(i));
  let alive = items.length;
  while (alive > Math.max(1, n)) {
    let a = -1, bd = Infinity;
    for (let i = 0; i < items.length; i++) if (items[i] && items[i].nd < bd) { bd = items[i].nd; a = i; }
    const b = items[a].nn, A = items[a], B = items[b];
    if (B.n > A.n) { A.k = B.k; A.lab = B.lab; }
    A.n += B.n; A.keys.push(...B.keys); items[b] = null; alive--;
    for (let i = 0; i < items.length; i++) if (items[i] && (i === a || items[i].nn === a || items[i].nn === b)) nnOf(i);
    // 代表色可能變了，其他群和 a 的距離也要更新
    for (let i = 0; i < items.length; i++) if (items[i] && i !== a) { const d = dist(items[i], A); if (d < items[i].nd) { items[i].nd = d; items[i].nn = a; } }
  }
  const map = new Map(), pal = [];
  for (const it of items) if (it) { const c = rgbOf(it.k); pal.push(c); for (const k of it.keys) map.set(k, c); }
  return {pal, map};
}
// 把整張作品（所有圖層）減到 n 色
function reduceDocColors(n) {
  const counts = new Map();
  for (const L of cur.layers) { const p = L.px; for (let i = 0; i < p.length; i += 4) if (p[i + 3]) { const k = p[i] << 16 | p[i + 1] << 8 | p[i + 2]; counts.set(k, (counts.get(k) || 0) + 1); } }
  if (counts.size <= n) { toast(`目前只有 ${counts.size} 色，不用減`); return; }
  const {pal, map} = mergeSimilar(counts, n);
  docOp(() => {
    for (const L of cur.layers) { const p = L.px; for (let i = 0; i < p.length; i += 4) if (p[i + 3]) { const c = map.get(p[i] << 16 | p[i + 1] << 8 | p[i + 2]); p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; } }
    const hexes = pal.map(c => rgba2hex(c));
    if (isGBA()) cur.palette = hexes; else for (const h of hexes) if (!cur.palette.includes(h)) cur.palette.push(h);
  });
  renderPalette(); refreshLayerThumbs(); toast(`已把 ${counts.size} 色合併成 ${pal.length} 色（↶ 可復原）`, 4000);
}
$('reduceGo').onclick = () => { const n = Math.max(1, +$('reduceN').value | 0); $('countDlg').close(); reduceDocColors(n); };
