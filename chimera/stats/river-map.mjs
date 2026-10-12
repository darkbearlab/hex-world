// 把 river-exp.mjs 的兩份結果畫成一頁：東半邊的地圖（現在、N 年後不加河、N 年後加河）＋每 5 年的數字。
// node chimera/stats/river-map.mjs base.json 版本1.json [版本2.json …] 輸出.html（第一份是不加河的對照組）
import fs from 'fs';
import {BIOMES} from '../sim.js';
const A = process.argv.slice(2), out = A.pop(), B = JSON.parse(fs.readFileSync(A[0], 'utf8')), V = A.slice(1).map(f => JSON.parse(fs.readFileSync(f, 'utf8'))), R = V[0];
const LABEL = {rivers: '照地勢拉河（離城遠）', near: '河靠近東邊的城'};
const {W, H} = R, S0 = 9, SQ3 = Math.sqrt(3), c0 = Math.floor(W * .5);
const col = i => i % W, row = i => Math.floor(i / W), cx = i => (col(i) - c0 + .5 * (row(i) & 1)) * SQ3 * S0 + SQ3 * S0 / 2, cy = i => row(i) * 1.5 * S0 + S0;
const hex = (x, y, s) => { let p = ''; for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (60 * k - 30); p += `${(x + s * Math.cos(a)).toFixed(1)},${(y + s * Math.sin(a)).toFixed(1)} `; } return p; };
const facC = Object.fromEntries(R.fac.map(f => [f.id, f.c]));
const eastLine = Math.floor(W * .66);
function map(snap, rivers, title, newRivers = [], firstTowns = new Set()) {
  const vw = (W - c0 + .5) * SQ3 * S0 + 4, vh = H * 1.5 * S0 + S0;
  let g = '';
  for (let i = 0; i < W * H; i++) { if (col(i) < c0) continue; const x = cx(i), y = cy(i);
    g += `<polygon points="${hex(x, y, S0 * .98)}" fill="${R.land[i] ? BIOMES[R.biome[i]].c : '#1b2a2e'}"/>`;
    const o = snap.owner[i]; if (o >= 0) g += `<polygon points="${hex(x, y, S0 * .98)}" fill="${facC[o] || '#fff'}" fill-opacity=".55"/>`; }
  const line = (p, st) => `<polyline points="${p.filter(t => col(t) >= c0 - 1).map(t => `${cx(t).toFixed(1)},${cy(t).toFixed(1)}`).join(' ')}" fill="none" ${st}/>`;
  for (const p of rivers) g += line(p, 'stroke="#5aa9d6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".8"');
  for (const p of newRivers) g += line(p, 'stroke="#38d6ff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"');
  for (const t of snap.townList) { if (col(t) < c0) continue; const isNew = !firstTowns.has(t); g += `<circle cx="${cx(t).toFixed(1)}" cy="${cy(t).toFixed(1)}" r="${isNew ? 4.5 : 3.2}" fill="${isNew ? '#ffe066' : '#fff'}" stroke="#111" stroke-width="1"/>`; }
  const ex = (eastLine - c0) * SQ3 * S0; g += `<line x1="${ex}" y1="0" x2="${ex}" y2="${vh}" stroke="#fff" stroke-dasharray="4 4" opacity=".5"/>`;
  return `<figure><figcaption>${title}</figcaption><svg viewBox="0 0 ${vw.toFixed(0)} ${vh.toFixed(0)}" xmlns="http://www.w3.org/2000/svg">${g}</svg></figure>`;
}
const first = new Set(R.rows[0].townList), endB = B.rows.at(-1), endR = R.rows.at(-1), yrs = endR.y - R.rows[0].y;
const nm = t => R.names[t] || '無名之地';
const table = `<table><tr><th>年</th><th>不加河：有人的格子</th><th>城</th>${V.map(v => `<th>${LABEL[v.mode] || v.mode}：有人的格子</th><th>城</th>`).join('')}</tr>${B.rows.map((b, k) => `<tr><td>${b.y}</td><td>${b.own}</td><td>${b.towns}</td>${V.map(v => { const r = v.rows.find(x => x.y === b.y) || v.rows[k] || {}; return `<td>${r.own ?? ''}</td><td>${r.towns ?? ''}</td>`; }).join('')}</tr>`).join('')}</table>`;
const evl = X => X.ev.map(e => `<li>第 ${e.y} 年：${e.text}</li>`).join('') || '<li>（沒有）</li>';
const html = `<meta charset="utf-8"><title>東邊的河</title><style>
:root{--bg:#14120e;--fg:#ece4d2;--muted:#9c9380;--line:#3a3428;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:14px/1.6 "Noto Sans TC","Microsoft JhengHei",sans-serif;margin:0;padding:16px}
h1{font-size:20px;margin:0 0 4px}p{color:var(--muted);margin:4px 0 12px}
.maps{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
figure{margin:0;background:#0d0c0a;border:1px solid var(--line);border-radius:8px;padding:8px}figcaption{font-weight:700;margin-bottom:6px}
svg{width:100%;height:auto;display:block}
table{border-collapse:collapse;margin-top:12px}td,th{border:1px solid var(--line);padding:3px 10px;text-align:right}th{color:var(--muted);font-weight:500}
.legend span{display:inline-block;margin-right:14px}.sw{display:inline-block;width:12px;height:12px;vertical-align:-1px;margin-right:4px;border-radius:2px}
ul{margin:4px 0 0;padding-left:20px}
</style>
<h1>東邊拉河，推演 ${yrs} 年</h1>
<p>地圖是右半邊（虛線右邊就是「東邊三分之一」）。同一份線上存檔（第 ${R.rows[0].y} 年）：一份不改當對照；${V.map(v => `「${LABEL[v.mode] || v.mode}」流出 ${v.rivers.length} 條河（${v.rivers.map(p => `${nm(p[0])}→${nm(p[p.length - 1])} ${p.length} 格`).join('、')}）`).join('；')}。</p>
<div class="legend"><span><i class="sw" style="background:#38d6ff"></i>新加的河</span><span><i class="sw" style="background:#5aa9d6"></i>原本的河</span><span><i class="sw" style="background:#fff;border-radius:50%"></i>原本的城</span><span><i class="sw" style="background:#ffe066;border-radius:50%"></i>新出現的城</span><span>有顏色蓋著的格子＝有人（勢力的顏色）</span></div>
<div class="maps">${map(B.rows[0], B.oldRivers, `現在（第 ${B.rows[0].y} 年）`, [], first)}${map(endB, B.oldRivers, `${yrs} 年後・不加河`, [], first)}${V.map(v => { const mid = v.rows.reduce((a, r) => r.own > a.own ? r : a, v.rows[0]); return map(mid, v.oldRivers, `${LABEL[v.mode] || v.mode}・最多人的時候（第 ${mid.y} 年）`, v.rivers, first) + map(v.rows.at(-1), v.oldRivers, `${LABEL[v.mode] || v.mode}・${yrs} 年後`, v.rivers, first); }).join('')}</div>
${table}
${V.map(v => `<h3>${LABEL[v.mode] || v.mode}：東邊的聚落興衰</h3><ul>${evl(v)}</ul>`).join('')}<h3>不加河：東邊的聚落興衰</h3><ul>${evl(B)}</ul>`;
fs.writeFileSync(out, html); console.log('寫好', out);
