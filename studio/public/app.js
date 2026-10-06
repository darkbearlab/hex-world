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
  return JSON.stringify({v: 1, palette: doc.palette, guides: doc.guides || '0', mirror: doc.mirror || 0, layers});
}
async function deserialize(rec) {
  const doc = {id: rec.id, name: rec.name, w: rec.w, h: rec.h, palette: DB32.slice(), layers: []};
  if (rec.data) {
    const d = JSON.parse(rec.data); doc.palette = d.palette || doc.palette; doc.guides = d.guides || '0'; doc.mirror = d.mirror || 0;
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
function show(id) { for (const s of ['login', 'home', 'editor']) $(s).hidden = s !== id; }
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
  const doc = {id: rid(), name: `新作品 ${w}×${h}`, w, h, palette: DB32.slice(), layers: []};
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
  $('guides').value = doc.guides || '0'; renderMirror();
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
  composite(cur, true, flatBuf); fg.putImageData(new ImageData(flatBuf, cur.w, cur.h), 0, 0);
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
  if (hover && (tool === 'pencil' || tool === 'eraser')) {
    const o = Math.floor((brush - 1) / 2);
    g.strokeStyle = tool === 'eraser' ? '#ff5050' : '#fff'; g.lineWidth = Math.max(1, d);
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
  $('opacity').value = Math.round(cur.layers[active].opacity * 100);
  $('delLayer').disabled = cur.layers.length < 2; $('mergeLayer').disabled = active === 0;
  $('upLayer').disabled = active === cur.layers.length - 1; $('downLayer').disabled = active === 0;
}
let layerThumbTimer = 0;
const refreshLayerThumbs = () => { clearTimeout(layerThumbTimer); layerThumbTimer = setTimeout(() => cur && !$('editor').hidden && renderLayers(), 250); };

/* 復原 */
const cloneLayers = ls => ls.map(L => ({...L, px: L.px.slice()}));
function pushUndo(e) { undo.push(e); if (undo.length > MAX_UNDO) undo.shift(); redo = []; updateUndo(); }
function updateUndo() { $('undoBtn').disabled = !undo.length; $('redoBtn').disabled = !redo.length; }
function docOp(fn) {
  const before = {layers: cloneLayers(cur.layers), active};
  fn();
  pushUndo({type: 'doc', before, after: {layers: cloneLayers(cur.layers), active}});
  active = Math.max(0, Math.min(active, cur.layers.length - 1));
  renderLayers(); draw(); markDirty();
}
function applyEntry(e, dir) {
  if (e.type === 'px') { const L = cur.layers.find(l => l.uid === e.uid); if (L) L.px.set(dir < 0 ? e.before : e.after); }
  else { const s = dir < 0 ? e.before : e.after; cur.layers = cloneLayers(s.layers); active = s.active; }
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
function setColor(c) { color = c; if (tool === 'eraser' || tool === 'pan') setTool('pencil'); renderPalette(); }
$('picker').addEventListener('change', () => {
  const h = $('picker').value.toLowerCase();
  if (!cur.palette.includes(h)) { cur.palette.push(h); markDirty(); }
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
      const k = (Y * cur.w + X) * 4; L.px[k] = c[0]; L.px[k + 1] = c[1]; L.px[k + 2] = c[2]; L.px[k + 3] = c[3];
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
  if (t === 'fill') { if (!inside(p)) return; const before = L.px.slice(); if (fillM(L, ...p, color)) { pushUndo({type: 'px', uid: L.uid, before, after: L.px.slice()}); markDirty(); refreshLayerThumbs(); draw(); } return; }
  stroke = {uid: L.uid, before: L.px.slice(), last: p, changed: true, c: t === 'eraser' ? [0, 0, 0, 0] : color};
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
  if (!cur || $('editor').hidden || e.target.matches('input,select,textarea')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doRedo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); flush().then(() => syncSoon(0)); return; }
  if (e.ctrlKey || e.metaKey) return;
  if (k === ' ') { spaceDown = true; cv.style.cursor = 'grab'; e.preventDefault(); }
  else if (k === 'alt') { altDown = true; e.preventDefault(); }
  else if (k === 'b') setTool('pencil'); else if (k === 'e') setTool('eraser'); else if (k === 'g') setTool('fill'); else if (k === 'i') setTool('picker'); else if (k === 'h') setTool('pan'); else if (k === 'm') $('mirrorBtn').click();
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
