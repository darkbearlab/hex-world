// 像素工作室：Chimera 素材（Alan 2026-10-10：一站式的工作區——看 Chimera 現在用的所有點陣圖，挑一張開成新作品來改或照著畫）
// 清單是 Chimera 部署時產生的 asset-manifest.json；圖和清單都開了跨網域讀取，畫進 canvas 不會變成髒圖
'use strict';
(() => {
  const BASE = 'https://chimera.darkbearlab.workers.dev/';
  let items = null, group = '', q = '', pick = null, loading = null;
  const S = $('assets'), D = $('assetDlg');

  async function load() {
    if (items) return items;
    if (!loading) loading = fetch(BASE + 'asset-manifest.json', {cache: 'no-cache'}).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => (items = d.items || [])).catch(e => { loading = null; throw e; });
    return loading;
  }
  async function open() {
    show('assets'); $('assetGrid').innerHTML = '<p class="muted">讀取 Chimera 的素材清單…</p>';
    try { await load(); } catch { $('assetGrid').innerHTML = '<p class="err">讀不到 Chimera 的素材清單（離線，或 Chimera 還沒部署清單）。</p>'; return; }
    const groups = [...new Set(items.map(x => x.group))];
    $('assetGroup').innerHTML = `<option value="">全部（${items.length}）</option>` + groups.map(g => `<option value="${g}">${g}（${items.filter(x => x.group === g).length}）</option>`).join('');
    $('assetGroup').value = group; render();
  }
  function render() {
    const L = items.filter(x => (!group || x.group === group) && (!q || x.path.toLowerCase().includes(q)));
    $('assetCount').textContent = `${L.length} 張`;
    let last = '';
    $('assetGrid').innerHTML = L.map(x => { const head = x.group !== last ? `<h3 class="agroup">${x.group}</h3>` : ''; last = x.group;
      return `${head}<button class="acard" data-p="${x.path}"><span class="athumb"><img loading="lazy" src="${BASE + x.path}" alt="" crossorigin="anonymous"></span><span class="aname">${x.path.split('/').pop()}</span><span class="muted asize">${x.w}×${x.h}</span></button>`; }).join('') || '<p class="muted">沒有符合的素材。</p>';
  }
  $('assetsBtn').onclick = open;
  $('assetBack').onclick = () => { show('home'); };
  $('assetGroup').onchange = () => { group = $('assetGroup').value; render(); };
  $('assetSearch').oninput = () => { q = $('assetSearch').value.trim().toLowerCase(); render(); };
  $('assetGrid').onclick = e => { const b = e.target.closest('.acard'); if (b) detail(items.find(x => x.path === b.dataset.p)); };

  // 詳細：放大看（整數倍）、資訊、開成新作品／用匯入工具裁一塊／下載
  function detail(x) {
    pick = x; const url = BASE + x.path;
    $('adName').textContent = x.path.split('/').pop();
    $('adInfo').textContent = `${x.group}・${x.w}×${x.h}・${(x.bytes / 1024).toFixed(1)} KB・${x.path}`;
    const big = x.w > 512 || x.h > 512;
    $('adOpen').disabled = big; $('adOpen').title = big ? '超過 512，請用「裁一塊」' : '';
    $('adRaw').href = url; $('adRaw').setAttribute('download', x.path.split('/').pop());
    const im = $('adImg'); im.src = url; im.style.width = ''; im.onload = () => fit();
    D.showModal(); fit();
  }
  function fit() {
    const im = $('adImg'), box = $('adView'); if (!pick || !box.clientWidth) return;
    const z = Math.max(1, Math.floor(Math.min((box.clientWidth - 16) / pick.w, (box.clientHeight - 16) / pick.h)));
    im.style.width = pick.w * z + 'px'; im.style.height = pick.h * z + 'px'; $('adZoom').textContent = `×${z}`;
  }
  addEventListener('resize', () => { if (D.open) fit(); });
  $('adClose').onclick = () => D.close();
  async function blobOf(x) { const r = await fetch(BASE + x.path, {mode: 'cors'}); if (!r.ok) throw new Error(r.status); return r.blob(); }
  // 原尺寸開新作品：每個像素照搬，色票＝圖上用到的顏色（64 色以內，不夠的補預設色票）
  $('adOpen').onclick = async () => {
    const x = pick; if (!x) return;
    try {
      const bmp = await createImageBitmap(await blobOf(x)), c = document.createElement('canvas'); c.width = x.w; c.height = x.h;
      const g2 = c.getContext('2d'); g2.drawImage(bmp, 0, 0); const px = g2.getImageData(0, 0, x.w, x.h).data;
      const used = []; const seen = new Set(); for (let k = 0; k < px.length; k += 4) if (px[k + 3]) { const h = rgba2hex([px[k], px[k + 1], px[k + 2]]); if (!seen.has(h)) { seen.add(h); used.push(h); } }
      const doc = {id: rid(), name: x.path.split('/').pop().replace(/\.png$/i, ''), w: x.w, h: x.h, platform: 'free', palette: used.length <= 64 ? used : DB32.slice(), layers: []};
      if (used.length > 64) toast(`這張用了 ${used.length} 色，色票先放預設的（圖本身照原樣）`);
      const L = newLayer(doc, '原圖'); L.px.set(px); doc.layers.push(L);
      D.close(); await flush(); await saveLocal(doc, true); openDoc(doc.id);
    } catch { toast('讀不到這張圖（離線？）'); }
  };
  // 太大的圖集：交給「從圖片轉像素」的匯入工具，用取樣框裁一塊
  $('adCrop').onclick = async () => {
    const x = pick; if (!x) return;
    try { const b = await blobOf(x); D.close(); window.importFromBlob(b); } catch { toast('讀不到這張圖（離線？）'); }
  };
})();
