// 像素工作室：匯入圖片並轉成像素（取樣框可以用原圖像素為單位移動、縮放，結果即時預覽）
'use strict';
(() => {
  const D = $('impDlg'), srcCv = $('impSrc'), outCv = $('impOut'), sg = srcCv.getContext('2d'), og = outCv.getContext('2d');
  const MAX_SRC = 2048;
  let img = null;          // {w, h, px, canvas}
  let F = {x: 0, y: 0, cell: 1};   // 取樣框：左上角（原圖像素）與「每格幾個原圖像素」
  let out = {w: 32, h: 32};
  let V = {z: 1, x: 0, y: 0};      // 原圖檢視：縮放與位移（CSS px）
  let result = null, target = 'layer', raf = 0;

  /* ── 開啟 ── */
  function open(mode) {
    target = mode;
    if (mode === 'layer' && !cur) mode = target = 'new';
    $('impTarget').value = target;
    $('impTarget').querySelector('[value=layer]').disabled = !cur;
    syncTarget();
    D.showModal(); resize();
    if (!img) $('impFile').click();
  }
  $('importNew').onclick = () => open('new');
  $('importBtn').onclick = () => { flush(); open('layer'); };
  $('impCancel').onclick = () => D.close();
  $('impTarget').onchange = () => { target = $('impTarget').value; syncTarget(); fitFrame(); };
  function syncTarget() {
    const fixed = target === 'layer' && cur;
    if (fixed) { out = {w: cur.w, h: cur.h}; }
    $('impW').disabled = $('impH').disabled = !!fixed;
    $('impW').value = out.w; $('impH').value = out.h;
    $('impSizeNote').textContent = fixed ? `匯入成圖層時，尺寸跟著目前作品（${cur.w}×${cur.h}）。` : '新作品的尺寸。';
    const pal = $('impColors').querySelector('[value=pal]'); pal.disabled = !fixed;
    if (!fixed && $('impColors').value === 'pal') $('impColors').value = '0';
    if (fixed && isGBA()) {   // GBA：顏色一定要能放進 15 色
      const room = PAL_MAX - cur.palette.length;
      $('impColors').value = room >= 2 ? String([15, 12, 8, 4].find(n => n <= room) || 4) : 'pal';
    }
    schedule();
  }

  /* ── 讀圖 ── */
  $('impFile').onchange = () => { const f = $('impFile').files[0]; if (f) load(f); $('impFile').value = ''; };
  D.addEventListener('dragover', e => e.preventDefault());
  D.addEventListener('drop', e => { e.preventDefault(); const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image/')); if (f) load(f); });
  addEventListener('paste', e => { if (!D.open) return; const it = [...e.clipboardData.items].find(i => i.type.startsWith('image/')); if (it) load(it.getAsFile()); });
  async function load(file) {
    let bmp;
    try { bmp = await createImageBitmap(file); } catch { toast('讀不了這個圖片'); return; }
    const s = Math.min(1, MAX_SRC / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, w, h);
    img = {w, h, px: x.getImageData(0, 0, w, h).data, canvas: c};
    if (s < 1) toast(`圖片較大，先縮成 ${w}×${h} 再取樣`);
    $('impHint').hidden = true; $('impOk').disabled = false;
    if (!(target === 'layer' && cur)) {   // 新作品：預設寬 32，高依比例
      out.w = Math.min(512, +$('impW').value || 32); out.h = Math.max(1, Math.min(512, Math.round(out.w * h / w)));
      $('impW').value = out.w; $('impH').value = out.h;
    }
    fitFrame(); viewFit();
  }

  /* ── 取樣框操作 ── */
  const clampCell = c => Math.max(0.25, Math.min(512, Math.round(c * 4) / 4));
  function fitFrame() {
    if (!img) return schedule();
    F.cell = clampCell(Math.max(img.w / out.w, img.h / out.h));
    centerFrame();
  }
  function centerFrame() { if (!img) return; F.x = Math.round((img.w - out.w * F.cell) / 2); F.y = Math.round((img.h - out.h * F.cell) / 2); schedule(); }
  function scaleFrame(f) {   // 以框中心為準縮放
    const cx = F.x + out.w * F.cell / 2, cy = F.y + out.h * F.cell / 2;
    F.cell = clampCell(F.cell * f === F.cell ? F.cell + (f > 1 ? 0.25 : -0.25) : F.cell * f);
    F.x = Math.round(cx - out.w * F.cell / 2); F.y = Math.round(cy - out.h * F.cell / 2); schedule();
  }
  const move = (dx, dy) => { F.x += dx; F.y += dy; schedule(); };
  document.querySelectorAll('[data-mv]').forEach(b => b.onclick = e => { const [x, y] = b.dataset.mv.split(',').map(Number), k = e.shiftKey ? 10 : 1; move(x * k, y * k); });
  $('impCenter').onclick = centerFrame;
  $('impC-').onclick = () => scaleFrame(1 / 1.1); $('impC+').onclick = () => scaleFrame(1.1);
  $('impFit').onclick = fitFrame;
  $('impX').onchange = () => { F.x = Math.round(+$('impX').value || 0); schedule(); };
  $('impY').onchange = () => { F.y = Math.round(+$('impY').value || 0); schedule(); };
  $('impCell').onchange = () => { F.cell = clampCell(+$('impCell').value || 1); schedule(); };
  $('impW').onchange = $('impH').onchange = () => {
    out.w = Math.max(1, Math.min(512, +$('impW').value | 0)); out.h = Math.max(1, Math.min(512, +$('impH').value | 0));
    $('impW').value = out.w; $('impH').value = out.h; fitFrame();
  };
  for (const id of ['impMode', 'impColors', 'impReduce', 'impAlpha', 'impBgOn']) $(id).addEventListener('input', schedule);
  D.addEventListener('keydown', e => {
    if (e.target.matches('input,select')) return;
    const k = e.shiftKey ? 10 : 1, m = {ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k]}[e.key];
    if (m) { e.preventDefault(); move(...m); }
    else if (e.key === '+' || e.key === '=') scaleFrame(1.1); else if (e.key === '-') scaleFrame(1 / 1.1);
  });

  /* ── 原圖檢視：拖曳移動框、滾輪/雙指縮放框 ── */
  const ptr = new Map(); let drag = null, pinch = null;
  srcCv.addEventListener('pointerdown', e => {
    if (!img) return; srcCv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = {d: Math.hypot(a.x - b.x, a.y - b.y), cell: F.cell}; drag = null; }
    else drag = {x: e.clientX, y: e.clientY, fx: F.x, fy: F.y};
  });
  srcCv.addEventListener('pointermove', e => {
    if (!ptr.has(e.pointerId)) return; ptr.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (pinch && ptr.size === 2) {
      const [a, b] = [...ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = F.x + out.w * F.cell / 2, cy = F.y + out.h * F.cell / 2;
      F.cell = clampCell(pinch.cell * pinch.d / d);   // 手指張開＝框變小（像放大原圖）
      F.x = Math.round(cx - out.w * F.cell / 2); F.y = Math.round(cy - out.h * F.cell / 2); schedule(); return;
    }
    if (drag) { F.x = drag.fx + Math.round((e.clientX - drag.x) / V.z); F.y = drag.fy + Math.round((e.clientY - drag.y) / V.z); schedule(); }
  });
  const end = e => { ptr.delete(e.pointerId); if (ptr.size < 2) pinch = null; if (!ptr.size) drag = null; };
  srcCv.addEventListener('pointerup', end); srcCv.addEventListener('pointercancel', end);
  srcCv.addEventListener('wheel', e => { e.preventDefault(); if (img) scaleFrame(e.deltaY < 0 ? 1 / 1.1 : 1.1); }, {passive: false});

  function viewFit() {
    if (!img) return; const r = srcCv.getBoundingClientRect();
    V.z = Math.min((r.width - 16) / img.w, (r.height - 16) / img.h); V.x = (r.width - img.w * V.z) / 2; V.y = (r.height - img.h * V.z) / 2; schedule();
  }
  function viewFrame() {
    if (!img) return; const r = srcCv.getBoundingClientRect(), fw = out.w * F.cell, fh = out.h * F.cell;
    V.z = Math.min((r.width - 40) / fw, (r.height - 40) / fh); V.x = r.width / 2 - (F.x + fw / 2) * V.z; V.y = r.height / 2 - (F.y + fh / 2) * V.z; schedule();
  }
  const viewZoom = f => { const r = srcCv.getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2; V.x = cx - (cx - V.x) * f; V.y = cy - (cy - V.y) * f; V.z *= f; schedule(); };
  $('impVfit').onclick = viewFit; $('impVframe').onclick = viewFrame;
  $('impVz-').onclick = () => viewZoom(1 / 1.4); $('impVz+').onclick = () => viewZoom(1.4);
  function resize() {
    const d = devicePixelRatio || 1;
    for (const c of [srcCv, outCv]) { const r = c.getBoundingClientRect(); c.width = Math.max(1, Math.round(r.width * d)); c.height = Math.max(1, Math.round(r.height * d)); }
    schedule();
  }
  new ResizeObserver(() => D.open && resize()).observe($('impSrcWrap'));

  /* ── 取樣與減色 ── */
  function sample() {
    const {w: W, h: H, px} = img, n = out.w * out.h, res = new Uint8ClampedArray(n * 4);
    const mode = $('impMode').value, c = F.cell, k = mode === 'center' ? 1 : Math.max(1, Math.min(6, Math.ceil(c)));
    const at = (x, y) => { x = Math.floor(x); y = Math.floor(y); return x < 0 || y < 0 || x >= W || y >= H ? -1 : (y * W + x) * 4; };
    const buckets = new Map();
    for (let j = 0; j < out.h; j++) for (let i = 0; i < out.w; i++) {
      const o = (j * out.w + i) * 4, x0 = F.x + i * c, y0 = F.y + j * c;
      if (mode === 'center') { const q = at(x0 + c / 2, y0 + c / 2); if (q >= 0) res.set(px.subarray(q, q + 4), o); continue; }
      let r = 0, g = 0, b = 0, a = 0, cnt = 0; buckets.clear();
      for (let v = 0; v < k; v++) for (let u = 0; u < k; u++) {
        const q = at(x0 + (u + .5) * c / k, y0 + (v + .5) * c / k); cnt++;
        if (q < 0 || !px[q + 3]) continue;
        const A = px[q + 3];
        if (mode === 'avg') { r += px[q] * A; g += px[q + 1] * A; b += px[q + 2] * A; a += A; }
        else {
          const key = (px[q] >> 4) << 8 | (px[q + 1] >> 4) << 4 | (px[q + 2] >> 4);
          let e = buckets.get(key); if (!e) buckets.set(key, e = [0, 0, 0, 0, 0]);
          e[0] += px[q]; e[1] += px[q + 1]; e[2] += px[q + 2]; e[3] += A; e[4]++;
        }
      }
      if (mode === 'avg') { if (a) { res[o] = r / a; res[o + 1] = g / a; res[o + 2] = b / a; res[o + 3] = a / cnt; } continue; }
      let best = null; for (const e of buckets.values()) if (!best || e[4] > best[4]) best = e;
      if (best) { const tot = [...buckets.values()].reduce((s, e) => s + e[4], 0); res[o] = best[0] / best[4]; res[o + 1] = best[1] / best[4]; res[o + 2] = best[2] / best[4]; res[o + 3] = tot / cnt * 255; }
    }
    return res;
  }
  // 中位切割：把顏色分成 n 群，取每群平均
  function medianCut(cols, n) {
    let boxes = [cols];
    while (boxes.length < n) {
      let bi = -1, bc = 0, br = 0;
      boxes.forEach((bx, idx) => { if (bx.length < 2) return; for (let ch = 0; ch < 3; ch++) { let lo = 255, hi = 0; for (const c of bx) { if (c[ch] < lo) lo = c[ch]; if (c[ch] > hi) hi = c[ch]; } const rg = (hi - lo) * Math.sqrt(bx.length); if (rg > br) { br = rg; bi = idx; bc = ch; } } });
      if (bi < 0) break;
      const bx = boxes[bi].sort((a, b) => a[bc] - b[bc]), mid = bx.length >> 1;
      boxes.splice(bi, 1, bx.slice(0, mid), bx.slice(mid));
    }
    return boxes.filter(b => b.length).map(b => { const s = [0, 0, 0]; for (const c of b) { s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; } return s.map(v => Math.round(v / b.length)); });
  }
  function nearestFn(pal) {
    const labs = pal.map(c => oklab(c)), cache = new Map();
    return c => {
      const key = c[0] << 16 | c[1] << 8 | c[2]; let r = cache.get(key); if (r) return r;
      const [L, A, B] = oklab(c); let bd = Infinity;
      labs.forEach((l, i) => { const d = (l[0] - L) ** 2 + (l[1] - A) ** 2 + (l[2] - B) ** 2; if (d < bd) { bd = d; r = pal[i]; } });
      cache.set(key, r); return r;
    };
  }
  function process() {
    const px = sample(), thr = +$('impAlpha').value, gba = target === 'layer' && cur ? isGBA() : $('newPlat').value === 'gba16';
    // 背景色去除：四角裡出現最多的顏色
    if ($('impBgOn').checked) {
      const corners = [0, out.w - 1, (out.h - 1) * out.w, out.h * out.w - 1].map(i => i * 4).filter(k => px[k + 3] >= thr);
      const keyOf = k => (px[k] >> 3) << 10 | (px[k + 1] >> 3) << 5 | (px[k + 2] >> 3);
      const cnt = new Map(); for (const k of corners) cnt.set(keyOf(k), (cnt.get(keyOf(k)) || 0) + 1);
      let bg = null, bn = 0; for (const [k, n] of cnt) if (n > bn) { bn = n; bg = k; }
      if (bg !== null) for (let k = 0; k < px.length; k += 4) if (px[k + 3] && keyOf(k) === bg) px[k + 3] = 0;
    }
    const cols = [];
    for (let k = 0; k < px.length; k += 4) {
      if (px[k + 3] < thr) { px[k] = px[k + 1] = px[k + 2] = px[k + 3] = 0; continue; }
      px[k + 3] = 255; if (gba) { px[k] = q5(px[k]); px[k + 1] = q5(px[k + 1]); px[k + 2] = q5(px[k + 2]); }
      cols.push([px[k], px[k + 1], px[k + 2]]);
    }
    const cm = $('impColors').value;
    let pal = null;
    if (cm === 'pal' && cur && cur.palette.length) pal = cur.palette.map(hex2rgba);
    else if (+cm > 0 && cols.length && $('impReduce').value === 'near') {
      const counts = new Map(); for (const c of cols) { const k = c[0] << 16 | c[1] << 8 | c[2]; counts.set(k, (counts.get(k) || 0) + 1); }
      const {map} = mergeSimilar(counts, +cm);
      for (let k = 0; k < px.length; k += 4) if (px[k + 3]) { const c = map.get(px[k] << 16 | px[k + 1] << 8 | px[k + 2]); px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; }
    }
    else if (+cm > 0 && cols.length) { pal = medianCut(cols, +cm); if (gba) pal = pal.map(c => snap15(c)); }
    if (pal) { const f = nearestFn(pal); for (let k = 0; k < px.length; k += 4) if (px[k + 3]) { const c = f([px[k], px[k + 1], px[k + 2]]); px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; } }
    const used = new Set(); for (let k = 0; k < px.length; k += 4) if (px[k + 3]) used.add(rgba2hex([px[k], px[k + 1], px[k + 2]]));
    return {px, used, gba};
  }

  /* ── 繪製 ── */
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
  function render() {
    $('impX').value = F.x; $('impY').value = F.y; $('impCell').value = F.cell;
    const d = devicePixelRatio || 1;
    sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, srcCv.width, srcCv.height);
    og.setTransform(1, 0, 0, 1, 0, 0); og.clearRect(0, 0, outCv.width, outCv.height);
    if (!img) { $('impInfo').textContent = ''; return; }
    // 原圖＋取樣框
    sg.setTransform(d, 0, 0, d, 0, 0); sg.imageSmoothingEnabled = V.z < 1;
    sg.drawImage(img.canvas, V.x, V.y, img.w * V.z, img.h * V.z);
    const fx = V.x + F.x * V.z, fy = V.y + F.y * V.z, fw = out.w * F.cell * V.z, fh = out.h * F.cell * V.z;
    sg.fillStyle = 'rgba(0,0,0,.45)'; const R = srcCv.width / d, B = srcCv.height / d;
    sg.fillRect(0, 0, R, fy); sg.fillRect(0, fy + fh, R, B - fy - fh); sg.fillRect(0, fy, fx, fh); sg.fillRect(fx + fw, fy, R - fx - fw, fh);
    if (F.cell * V.z >= 6) {   // 框裡的格線
      sg.strokeStyle = 'rgba(255,255,255,.25)'; sg.lineWidth = 1; sg.beginPath();
      for (let i = 1; i < out.w; i++) { const x = fx + i * F.cell * V.z; sg.moveTo(x, fy); sg.lineTo(x, fy + fh); }
      for (let j = 1; j < out.h; j++) { const y = fy + j * F.cell * V.z; sg.moveTo(fx, y); sg.lineTo(fx + fw, y); }
      sg.stroke();
    }
    sg.lineWidth = 2; sg.strokeStyle = '#000'; sg.strokeRect(fx, fy, fw, fh); sg.lineWidth = 1; sg.strokeStyle = '#ffcc33'; sg.strokeRect(fx, fy, fw, fh);
    // 結果
    result = process();
    const tmp = document.createElement('canvas'); tmp.width = out.w; tmp.height = out.h;
    tmp.getContext('2d').putImageData(new ImageData(result.px, out.w, out.h), 0, 0);
    const W = outCv.width, H = outCv.height, z = Math.max(1, Math.floor(Math.min((W - 16 * d) / out.w, (H - 16 * d) / out.h)));
    og.imageSmoothingEnabled = false; og.drawImage(tmp, Math.round((W - out.w * z) / 2), Math.round((H - out.h * z) / 2), out.w * z, out.h * z);
    const n = result.used.size, lim = result.gba ? PAL_MAX : 0;
    let warn = '';
    if (target === 'layer' && cur && result.gba) {
      const extra = [...result.used].filter(h => !cur.palette.includes(h)).length;
      if (cur.palette.length + extra > PAL_MAX) warn = `・色票會變成 ${cur.palette.length + extra} 色，超過 ${PAL_MAX}`;
    } else if (lim && n > lim) warn = `・超過 ${lim} 色`;
    $('impInfo').textContent = `${out.w}×${out.h}・${n} 色・每格 ${F.cell} 原圖像素${warn}`;
    $('impInfo').style.color = warn ? 'var(--err)' : '';
  }

  /* ── 匯入 ── */
  $('impOk').onclick = async () => {
    if (!img) return;
    const r = process();
    if (target === 'layer' && cur) {
      docOp(() => {
        const L = newLayer(cur, '匯入的圖'); L.px.set(r.px);
        cur.layers.splice(active + 1, 0, L); active++;
        for (const h of r.used) if (!cur.palette.includes(h)) cur.palette.push(h);
      });
      renderPalette(); refreshLayerThumbs(); D.close();
      toast(isGBA() && cur.palette.length > PAL_MAX ? `已匯入成新圖層。色票變成 ${cur.palette.length} 色，超過 ${PAL_MAX}，記得減色（↶ 可復原）` : '已匯入成新圖層（↶ 可復原）', 5000);
    } else {
      const plat = $('newPlat').value;
      const doc = {id: rid(), name: '匯入的圖', w: out.w, h: out.h, platform: plat, palette: plat === 'gba16' ? [...r.used] : DB32.slice(), layers: []};
      if (plat !== 'gba16') for (const h of r.used) if (doc.palette.length < 64 && !doc.palette.includes(h)) doc.palette.push(h);
      const L = newLayer(doc, '圖層 1'); L.px.set(r.px); doc.layers.push(L);
      D.close(); await flush(); await saveLocal(doc, true); openDoc(doc.id);
    }
  };
})();
