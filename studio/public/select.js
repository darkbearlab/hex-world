// 像素工作室：選取、移動、翻轉旋轉、剪貼簿、印章（Alan 2026-10-15）
// 選取工具（S）：在目前圖層拉一個方框；拖方框裡面就把那塊拿起來（浮動）移動，按「確定」或點方框外面放下。
// 浮動中可以左右／上下翻轉、旋轉 90°、複製一份、刪除、存成印章。放下、刪除各算一步復原。
// 印章：選取存成印章（同步到伺服器，手機、電腦共用）；從「印章」挑一個，浮在畫布上，拖到位置按確定就蓋上去。
// 跟 app.js 共用全域：cur、active、tool、setTool、draw、pushUndo、markDirty、refreshLayerThumbs、toast、rid、b64、unb64、zip、unzip、api、online、authed、view、cv、isGBA、snap15、PAL_MAX、renderPalette
'use strict';
let sel = null;          // 選取的方框 {x, y, w, h}（畫布格子）
let float = null;        // 浮動的那塊 {px, w, h, x, y, uid（從哪個圖層拿起來／要蓋到哪個圖層）, before（拿起來之前那個圖層的樣子；印章、貼上是 null）}
let selDrag = null;      // 拖曳中 {mode: 'rect'|'move', x0, y0, dx, dy, moved}
let clip = null;         // 剪貼簿 {px, w, h}
let antsT = 0;
const fcv = document.createElement('canvas'), fcg = fcv.getContext('2d');

const within = (p, r) => r && p[0] >= r.x && p[1] >= r.y && p[0] < r.x + r.w && p[1] < r.y + r.h;
const layerOf = uid => cur.layers.find(l => l.uid === uid) || cur.layers[active];
function region(L, r) {   // 圖層上一塊方框的像素（超出畫布的部分是透明）
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const X = r.x + x, Y = r.y + y; if (X < 0 || Y < 0 || X >= cur.w || Y >= cur.h) continue;
    const s = (Y * cur.w + X) * 4, d = (y * r.w + x) * 4; out[d] = L.px[s]; out[d + 1] = L.px[s + 1]; out[d + 2] = L.px[s + 2]; out[d + 3] = L.px[s + 3];
  }
  return out;
}
function clearRegion(L, r) { for (let y = Math.max(0, r.y); y < Math.min(cur.h, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(cur.w, r.x + r.w); x++) L.px.fill(0, (y * cur.w + x) * 4, (y * cur.w + x) * 4 + 4); }
function fitSel(r) { const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(cur.w, r.x + r.w), y1 = Math.min(cur.h, r.y + r.h); return x1 > x0 && y1 > y0 ? {x: x0, y: y0, w: x1 - x0, h: y1 - y0} : null; }

// 拿起來：選取範圍的像素從圖層剪下，變成浮動的一塊
function lift() {
  if (float || !sel) return !!float;
  const L = cur.layers[active]; if (!L.visible) { toast('這個圖層隱藏中，先打開它'); return false; }
  const before = L.px.slice(), px = region(L, sel); clearRegion(L, sel);
  float = {px, w: sel.w, h: sel.h, x: sel.x, y: sel.y, uid: L.uid, before}; return true;
}
// 放下：浮動的那塊蓋到圖層上（透明的格子不蓋），記一步復原
function selCommit() {
  if (!float) return false;
  const f = float, L = layerOf(f.uid), before = f.before || L.px.slice();
  let added = 0, over = false;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const X = f.x + x, Y = f.y + y; if (X < 0 || Y < 0 || X >= cur.w || Y >= cur.h) continue;
    const s = (y * f.w + x) * 4; if (!f.px[s + 3]) continue;
    let c = [f.px[s], f.px[s + 1], f.px[s + 2], f.px[s + 3]];
    if (isGBA()) {   // GBA 16 色：顏色貼齊 15-bit、不透明；不在色票裡的有空位就加
      c = snap15(c); const h = rgba2hex(c);
      if (!cur.palette.includes(h)) { if (!cur.lockPal && cur.palette.length < PAL_MAX) { cur.palette.push(h); added++; } else over = true; }
    }
    const d = (Y * cur.w + X) * 4; L.px[d] = c[0]; L.px[d + 1] = c[1]; L.px[d + 2] = c[2]; L.px[d + 3] = c[3];
  }
  float = null; sel = fitSel({x: f.x, y: f.y, w: f.w, h: f.h});
  pushUndo({type: 'px', uid: L.uid, before, after: L.px.slice()}); markDirty(); refreshLayerThumbs();
  if (added) renderPalette(); if (over) toast('有些顏色不在 GBA 色票裡（色票滿了或鎖了），記得檢查色數');
  renderSelBar(); draw(); return true;
}
// 取消浮動：拿起來的放回原處；印章、貼上的直接丟掉
function selCancelFloat() {
  if (!float) return false;
  if (float.before) { layerOf(float.uid).px.set(float.before); sel = fitSel({x: float.x, y: float.y, w: float.w, h: float.h}); }
  float = null; renderSelBar(); draw(); return true;
}
function selReset() { float = null; sel = null; selDrag = null; renderSelBar(); }
function deselect() { if (float) selCommit(); sel = null; renderSelBar(); draw(); }

/* 指標（app.js 的 pointerdown／move／up 在選取工具時交給這裡） */
function selDown(p) {
  if (float && within(p, float)) { selDrag = {mode: 'move', dx: p[0] - float.x, dy: p[1] - float.y, moved: false}; return; }
  if (!float && sel && within(p, sel)) { if (!lift()) return; selDrag = {mode: 'move', dx: p[0] - float.x, dy: p[1] - float.y, moved: false}; renderSelBar(); return; }
  if (float) selCommit();
  selDrag = {mode: 'rect', x0: p[0], y0: p[1], moved: false, had: !!sel};
  sel = fitSel({x: p[0], y: p[1], w: 1, h: 1}); renderSelBar(); draw();
}
function selMove(p) {
  if (!selDrag) return;
  if (selDrag.mode === 'move') { const nx = p[0] - selDrag.dx, ny = p[1] - selDrag.dy; if (nx !== float.x || ny !== float.y) { float.x = nx; float.y = ny; selDrag.moved = true; } return; }
  const x0 = Math.min(selDrag.x0, p[0]), y0 = Math.min(selDrag.y0, p[1]), x1 = Math.max(selDrag.x0, p[0]), y1 = Math.max(selDrag.y0, p[1]);
  if (x1 !== x0 || y1 !== y0) selDrag.moved = true;
  sel = fitSel({x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1});
}
function selUp() {
  if (!selDrag) return;
  if (selDrag.mode === 'rect' && !selDrag.moved && selDrag.had) sel = null;   // 在方框外點一下：取消選取
  selDrag = null; renderSelBar(); draw();
}

/* 變形 */
function flipFloat(horizontal) {
  if (!lift()) return; const f = float, out = new Uint8ClampedArray(f.px.length);
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const s = (y * f.w + x) * 4, X = horizontal ? f.w - 1 - x : x, Y = horizontal ? y : f.h - 1 - y, d = (Y * f.w + X) * 4; out.set(f.px.subarray(s, s + 4), d); }
  f.px = out; renderSelBar(); draw();
}
function rotateFloat() {   // 順時針 90°，以中心為準
  if (!lift()) return; const f = float, W = f.h, H = f.w, out = new Uint8ClampedArray(f.px.length);
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const s = (y * f.w + x) * 4, X = f.h - 1 - y, Y = x; out.set(f.px.subarray(s, s + 4), (Y * W + X) * 4); }
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  Object.assign(f, {px: out, w: W, h: H, x: Math.round(cx - W / 2), y: Math.round(cy - H / 2)}); renderSelBar(); draw();
}
const pieceOf = () => float ? {px: float.px.slice(), w: float.w, h: float.h} : sel ? {px: region(cur.layers[active], sel), w: sel.w, h: sel.h} : null;
function copySel() { const p = pieceOf(); if (!p) return false; clip = p; toast('複製了選取的範圍'); return true; }
function cutSel() { if (!copySel()) return; delSel(); }
function delSel() {
  if (float) { const f = float; float = null; if (f.before) { const L = layerOf(f.uid); pushUndo({type: 'px', uid: L.uid, before: f.before, after: L.px.slice()}); markDirty(); refreshLayerThumbs(); } }
  else if (sel) { const L = cur.layers[active], before = L.px.slice(); clearRegion(L, sel); pushUndo({type: 'px', uid: L.uid, before, after: L.px.slice()}); markDirty(); refreshLayerThumbs(); }
  renderSelBar(); draw();
}
// 浮起一塊新的（貼上、印章）：放在選取的位置，沒有選取就放在畫面中央
function floatPiece(p) {
  if (float) selCommit();
  const r = $('stage').getBoundingClientRect();
  const cx = sel ? sel.x : Math.round((r.width / 2 - view.x) / view.z - p.w / 2), cy = sel ? sel.y : Math.round((r.height / 2 - view.y) / view.z - p.h / 2);
  float = {px: p.px.slice(), w: p.w, h: p.h, x: cx, y: cy, uid: cur.layers[active].uid, before: null};
  if (tool !== 'select') setTool('select');
  renderSelBar(); draw();
}
function pasteClip() { if (!clip) { toast('剪貼簿是空的'); return; } floatPiece(clip); }
function dupFloat() {   // 複製一份：浮動中＝先蓋下去、再浮一份一樣的（連續蓋章）；只有選取＝把那塊複製成浮動的
  if (float) { const p = {px: float.px.slice(), w: float.w, h: float.h}, at = {x: float.x, y: float.y}; selCommit(); float = {...p, ...at, uid: cur.layers[active].uid, before: null}; renderSelBar(); draw(); return; }
  if (sel) floatPiece({px: region(cur.layers[active], sel), w: sel.w, h: sel.h});
}

/* 畫在畫布上：浮動的那塊、選取框（螞蟻線） */
function paintSel(g, ox, oy, z, d) {
  if (!cur) return;
  if (float) {
    fcv.width = float.w; fcv.height = float.h; fcg.putImageData(new ImageData(float.px, float.w, float.h), 0, 0);
    g.imageSmoothingEnabled = false; g.drawImage(fcv, ox + float.x * z, oy + float.y * z, float.w * z, float.h * z);
  }
  const r = float || sel; if (!r) { clearTimeout(antsT); antsT = 0; return; }
  const X = Math.round(ox + r.x * z) + .5, Y = Math.round(oy + r.y * z) + .5, W = Math.round(r.w * z), H = Math.round(r.h * z);
  g.lineWidth = Math.max(1, d); g.setLineDash([4 * d, 4 * d]);
  g.strokeStyle = '#000'; g.lineDashOffset = 0; g.strokeRect(X, Y, W, H);
  g.strokeStyle = float ? '#ffd24a' : '#fff'; g.lineDashOffset = (performance.now() / 60 | 0) % (8 * d); g.strokeRect(X, Y, W, H);
  g.setLineDash([]); g.lineDashOffset = 0;
  if (!antsT) antsT = setTimeout(() => { antsT = 0; draw(); }, 120);
}

/* 選取工具列（有選取時出現在畫布上方） */
function renderSelBar() {
  const b = $('selBar'); if (!b) return;
  b.hidden = !(sel || float) || !cur;
  if (b.hidden) return;
  $('selInfo').textContent = float ? `浮動 ${float.w}×${float.h}${float.before ? '' : '（新的）'}` : `${sel.w}×${sel.h}`;
  $('selOk').hidden = !float;
}
$('selFlipH').onclick = () => flipFloat(true);
$('selFlipV').onclick = () => flipFloat(false);
$('selRot').onclick = () => rotateFloat();
$('selDup').onclick = () => dupFloat();
$('selDel').onclick = () => delSel();
$('selStamp').onclick = () => saveStamp();
$('selOk').onclick = () => selCommit();
$('selX').onclick = () => { if (!selCancelFloat()) { sel = null; renderSelBar(); draw(); } };

// 鍵盤：Ctrl+A 全選、Ctrl+C／X／V、Delete 刪除、Enter 放下、Esc 取消；回傳 true 表示處理掉了
function selKey(e, k) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'a') { e.preventDefault(); if (float) selCommit(); sel = {x: 0, y: 0, w: cur.w, h: cur.h}; if (tool !== 'select') setTool('select'); renderSelBar(); draw(); return true; }
  if (mod && k === 'c') { if (sel || float) { e.preventDefault(); copySel(); } return !!(sel || float); }
  if (mod && k === 'x') { if (sel || float) { e.preventDefault(); cutSel(); } return !!(sel || float); }
  if (mod && k === 'v') { e.preventDefault(); pasteClip(); return true; }
  if (mod) return false;
  if (k === 's') { setTool('select'); return true; }
  if (!(sel || float)) return false;
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); delSel(); return true; }
  if (k === 'enter') { e.preventDefault(); if (float) selCommit(); return true; }
  if (k === 'escape') { if (!selCancelFloat()) { sel = null; renderSelBar(); draw(); } return true; }
  if (float && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) { e.preventDefault(); float.x += k === 'arrowleft' ? -1 : k === 'arrowright' ? 1 : 0; float.y += k === 'arrowup' ? -1 : k === 'arrowdown' ? 1 : 0; draw(); return true; }
  return false;
}

/* ───────────── 印章 ───────────── */
// 本機先存一份（localStorage），連線、登入時跟伺服器同步：新增的先送上去，刪掉的也送；再用伺服器的清單蓋回來（留著還沒送上去的）
const STAMP_KEY = 'studio-stamps';
const loadStamps = () => { try { return JSON.parse(localStorage.getItem(STAMP_KEY) || '[]'); } catch { return []; } };
const keepStamps = L => { try { localStorage.setItem(STAMP_KEY, JSON.stringify(L)); } catch { toast('這台裝置存不下更多印章了'); } };
let stamps = loadStamps(), stampSyncing = null;
async function syncStamps() {
  if (stampSyncing) return stampSyncing;
  if (!online || !authed) return;
  stampSyncing = (async () => {
    try {
      for (const s of stamps.filter(s => s.pending || s.gone)) {
        const r = s.gone ? await api('/api/stamps/' + s.id, {method: 'DELETE'}) : await api('/api/stamps', {method: 'POST', body: JSON.stringify({id: s.id, name: s.name, w: s.w, h: s.h, px: s.px, created: s.created})});
        if (r.ok) { if (s.gone) stamps = stamps.filter(x => x !== s); else delete s.pending; }
      }
      const r = await api('/api/stamps');
      if (r.ok) { const left = stamps.filter(s => s.pending || s.gone), ids = new Set(left.map(s => s.id)); stamps = [...r.data.filter(s => !ids.has(s.id)), ...left]; }
      keepStamps(stamps);
    } catch {}
    stampSyncing = null;
  })();
  return stampSyncing;
}
async function saveStamp() {
  const p = pieceOf(); if (!p) return;
  let n = 0; for (let k = 3; k < p.px.length; k += 4) if (p.px[k]) n++;
  if (!n) { toast('選取的範圍是空的'); return; }
  const name = (prompt('印章名稱', `印章 ${stamps.filter(s => !s.gone).length + 1}`) || '').trim().slice(0, 40); if (!name) return;
  stamps.push({id: rid(), name, w: p.w, h: p.h, px: b64(await zip(new Uint8Array(p.px.buffer))), created: Date.now(), pending: true});
  keepStamps(stamps); toast(`存成印章「${name}」`); syncStamps();
}
async function stampPx(s) { const raw = await unzip(unb64(s.px)), px = new Uint8ClampedArray(s.w * s.h * 4); px.set(raw.subarray(0, px.length)); return px; }
async function openStamps() {
  const D = $('stampDlg'), box = $('stampList');
  const render = async () => {
    const L = stamps.filter(s => !s.gone);
    box.innerHTML = L.length ? '' : '<p class="muted">還沒有印章。用選取工具（⬚）框一塊，按「存成印章」。</p>';
    for (const s of L) {
      const el = document.createElement('div'); el.className = 'stamp';
      const c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
      try { c.getContext('2d').putImageData(new ImageData(await stampPx(s), s.w, s.h), 0, 0); } catch {}
      const nm = document.createElement('span'); nm.textContent = s.name;
      const sz = document.createElement('small'); sz.className = 'muted'; sz.textContent = `${s.w}×${s.h}${s.pending ? '・未同步' : ''}`;
      const x = document.createElement('button'); x.className = 'stx'; x.textContent = '✕'; x.title = '刪除這個印章';
      x.onclick = e => { e.stopPropagation(); if (!confirm(`刪除印章「${s.name}」？`)) return; if (s.pending) stamps = stamps.filter(t => t !== s); else s.gone = true; keepStamps(stamps); syncStamps(); render(); };
      el.onclick = async () => { D.close(); floatPiece({px: await stampPx(s), w: s.w, h: s.h}); toast('拖到要放的位置，按「確定」蓋上去'); };
      el.append(c, nm, sz, x); box.append(el);
    }
  };
  await render(); D.showModal();
  await syncStamps(); if (D.open) render();
}
$('stampBtn').onclick = () => { if (cur) openStamps(); };
setInterval(() => { if (stamps.some(s => s.pending || s.gone)) syncStamps(); }, 30000);
