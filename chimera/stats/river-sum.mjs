// 把 river-exp.mjs 的多次結果（每種情況換幾個亂數種子）彙整成一頁：東邊有人的格子、城的平均與範圍，每 5 年的平均曲線，每種情況挑中間那一次畫 40 年後的地圖。
// node chimera/stats/river-sum.mjs 輸出.html 標籤=說明 … -- 檔案…（檔名裡要有 ry-<標籤>-s<種子>.json）
import fs from 'fs';
import path from 'path';
import {BIOMES} from '../sim.js';
const A = process.argv.slice(2), out = A.shift(), sep = A.indexOf('--'), labels = Object.fromEntries(A.slice(0, sep).map(x => x.split('='))), files = A.slice(sep + 1);
const runs = {}; for (const f of files) { const m = /ry-(\w+)-s(\d+)\.json$/.exec(path.basename(f)); if (!m) continue; (runs[m[1]] ||= []).push({seed: +m[2], d: JSON.parse(fs.readFileSync(f, 'utf8'))}); }
const tags = Object.keys(labels).filter(t => runs[t]);
const any = runs[tags[0]][0].d, {W, H} = any, S0 = 8, SQ3 = Math.sqrt(3), c0 = Math.floor(W * .45), RUMOR = 22 * 60 + 54;
const col = i => i % W, row = i => Math.floor(i / W), cx = i => (col(i) - c0 + .5 * (row(i) & 1)) * SQ3 * S0 + SQ3 * S0 / 2, cy = i => row(i) * 1.5 * S0 + S0;
const hex = (x, y, s) => { let p = ''; for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (60 * k - 30); p += `${(x + s * Math.cos(a)).toFixed(1)},${(y + s * Math.sin(a)).toFixed(1)} `; } return p; };
const first = new Set(any.rows[0].townList);
function map(d, snap, title, rumor) {
  const facC = Object.fromEntries(d.fac.map(f => [f.id, f.c])), vw = (W - c0 + .5) * SQ3 * S0 + 4, vh = H * 1.5 * S0 + S0; let g = '';
  for (let i = 0; i < W * H; i++) { if (col(i) < c0) continue; const x = cx(i), y = cy(i); g += `<polygon points="${hex(x, y, S0 * .98)}" fill="${d.land[i] ? BIOMES[d.biome[i]].c : '#1b2a2e'}"/>`; const o = snap.owner[i]; if (o >= 0) g += `<polygon points="${hex(x, y, S0 * .98)}" fill="${facC[o] || '#fff'}" fill-opacity=".6"/>`; }
  const line = (p, st) => `<polyline points="${p.filter(t => col(t) >= c0 - 1).map(t => `${cx(t).toFixed(1)},${cy(t).toFixed(1)}`).join(' ')}" fill="none" ${st}/>`;
  for (const p of d.oldRivers) g += line(p, 'stroke="#5aa9d6" stroke-width="1.8" opacity=".8"');
  for (const p of d.rivers) g += p.length <= 2 ? `<circle cx="${cx(p[0]).toFixed(1)}" cy="${cy(p[0]).toFixed(1)}" r="4" fill="none" stroke="#38d6ff" stroke-width="2"/>` : line(p, 'stroke="#38d6ff" stroke-width="3" stroke-linecap="round"');
  for (const t of snap.townList) { if (col(t) < c0) continue; const nw = !first.has(t); g += `<circle cx="${cx(t).toFixed(1)}" cy="${cy(t).toFixed(1)}" r="${nw ? 4 : 3}" fill="${nw ? '#ffe066' : '#fff'}" stroke="#111"/>`; }
  if (rumor) { const x = cx(RUMOR), y = cy(RUMOR); g += `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="16" fill="#ff6b6b" stroke="#000" stroke-width=".8">★</text>`; }
  return `<figure><figcaption>${title}</figcaption><svg viewBox="0 0 ${vw.toFixed(0)} ${vh.toFixed(0)}" xmlns="http://www.w3.org/2000/svg">${g}</svg></figure>`;
}
const st = a => { const s = [...a].sort((x, y) => x - y), m = a.reduce((x, y) => x + y, 0) / a.length; return {m, lo: s[0], hi: s.at(-1)}; };
const f1 = v => (Math.round(v * 10) / 10).toString();
const sum = tags.map(t => { const R = runs[t], end = R.map(r => r.d.rows.at(-1)), own = st(end.map(e => e.own)), tw = st(end.map(e => e.towns)), all = st(end.map(e => e.townList.length)), pop = st(end.map((e, k) => e.pop / R[k].d.rows[0].pop));
  const ev = st(R.map(r => r.d.ev.filter(e => /立起新的聚落/.test(e.text)).length)), med = R.slice().sort((a, b) => a.d.rows.at(-1).own - b.d.rows.at(-1).own)[Math.floor((R.length - 1) / 2)];
  return {t, n: R.length, own, tw, all, pop, ev, med, curve: R[0].d.rows.map((r, k) => st(R.map(x => x.d.rows[k]?.own ?? x.d.rows.at(-1).own)).m)}; });
const y0 = any.rows[0].y, years = any.rows.map(r => r.y);
const html = `<meta charset="utf-8"><title>東邊有救嗎</title><style>
:root{--bg:#14120e;--fg:#ece4d2;--muted:#9c9380;--line:#3a3428;color-scheme:dark}body{background:var(--bg);color:var(--fg);font:14px/1.6 "Noto Sans TC","Microsoft JhengHei",sans-serif;margin:0;padding:16px}
h1{font-size:20px;margin:0 0 4px}p{color:var(--muted);margin:4px 0 12px}table{border-collapse:collapse;margin:8px 0 16px}td,th{border:1px solid var(--line);padding:3px 10px;text-align:right}th{color:var(--muted);font-weight:500}td:first-child,th:first-child{text-align:left}
.maps{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}figure{margin:0;background:#0d0c0a;border:1px solid var(--line);border-radius:8px;padding:8px}figcaption{font-weight:700;margin-bottom:6px;font-size:13px}svg{width:100%;height:auto;display:block}
.bar{display:inline-block;height:10px;background:#8fd18b;border-radius:2px;vertical-align:middle}</style>
<h1>東邊有救嗎：四種情況、各 ${sum[0].n} 次</h1>
<p>同一份線上存檔（第 ${y0} 年），每種情況換 ${sum[0].n} 個亂數種子、各推 ${years.at(-1) - y0} 年。「謠言」＝東邊大河中段（紅色★）有舊星艦維修站的謠言：有城在 35 格內的勢力，拓荒者遠行的機率從每年 6% 變成 30%，而且只往謠言的方向立村。跳板＝從西南沿南邊到東北的 10 個綠洲；大河＝東邊從北往南流進海的 27 格。</p>
<table><tr><th>情況</th><th>東邊有人的格子（${any.rows[0].own} →）</th><th>東邊的城（${any.rows[0].towns} →）</th><th>拓荒者在東邊立村（次）</th><th>東邊人口（倍）</th><th>全星球的城（${any.rows[0].townList.length} →）</th></tr>
${sum.map(s => `<tr><td>${labels[s.t]}</td><td>${f1(s.own.m)}（${s.own.lo}～${s.own.hi}） <span class="bar" style="width:${s.own.m * 4}px"></span></td><td>${f1(s.tw.m)}（${s.tw.lo}～${s.tw.hi}）</td><td>${f1(s.ev.m)}（${s.ev.lo}～${s.ev.hi}）</td><td>${f1(s.pop.m)}（${f1(s.pop.lo)}～${f1(s.pop.hi)}）</td><td>${f1(s.all.m)}（${s.all.lo}～${s.all.hi}）</td></tr>`).join('')}</table>
<h3>東邊有人的格子，每 5 年的平均</h3>
<table><tr><th>年</th>${sum.map(s => `<th>${labels[s.t]}</th>`).join('')}</tr>${years.map((y, k) => `<tr><td>${y}</td>${sum.map(s => `<td>${f1(s.curve[k] ?? '')}</td>`).join('')}</tr>`).join('')}</table>
<h3>每種情況中間那一次的 ${years.at(-1) - y0} 年後（右半邊地圖；黃點＝新出現的城）</h3>
<div class="maps">${sum.map(s => map(s.med.d, s.med.d.rows.at(-1), `${labels[s.t]}（種子 ${s.med.seed}）`, /rumor|both/.test(s.t))).join('')}</div>`;
fs.writeFileSync(out, html); console.log('寫好', out); for (const s of sum) console.log(labels[s.t].padEnd(16), '東邊格子', f1(s.own.m), `(${s.own.lo}-${s.own.hi})`, '城', f1(s.tw.m), `(${s.tw.lo}-${s.tw.hi})`, '立村', f1(s.ev.m), '全星球城', f1(s.all.m));
