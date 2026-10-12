// 實驗（Alan 2026-10-12）：東邊拉幾條河，有沒有機會讓那裡開始有人？只在本機跑，不動線上。
// 同一份存檔：rivers＝在東邊（地圖右邊三分之一）的高地照開服時的做法「流」出幾條河（從高處沿最陡的方向往下，直到海或窪地），
// base＝什麼都不改。各自往後推演 N 個沙盒年，每 5 年記一次東邊有人的格子、人口、城，最後寫成 JSON 給 river-map.mjs 畫圖。
// node chimera/stats/river-exp.mjs 存檔.json rivers|base 年數 輸出.json [河的條數=3]
import fs from 'fs';
import {Core} from '../core.js';
import * as S from '../sim.js';

const [file, mode, years = '40', out, nRiv = '3'] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(file, 'utf8')), c = new Core(() => {}); c.load(raw.seed, raw.save); const w = c.w, W = S.W, N = S.N;
const east = i => i % W >= Math.floor(W * .66), K0 = c.sim.peek();
const rivers = [];
if (mode === 'rivers' || mode === 'near') {   // near：源頭挑離東邊現有的城 2～6 格的高地（河流過有人的地方附近）
  // 源頭：東邊、陸地、夠高、不是斷崖；彼此至少隔 7 格。照高度從高到低挑
  const NB = i => { const r = Math.floor(i / W), q = i % W, d = (r & 1) ? [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]] : [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]], o = []; for (const [dq, dr] of d) { const a = q + dq, b = r + dr; if (a >= 0 && a < W && b >= 0 && b < S.H) o.push(b * W + a); } return o; };
  const springs = []; for (let i = 0; i < N; i++) if (east(i) && w.land[i] && K0.biome[i] !== 2 && !w.river[i] && w.elev[i] > .62) springs.push(i);
  const etowns = Object.keys(K0.markets).map(Number).filter(t => K0.owner[t] >= 0 && east(t)), dT = i => Math.min(99, ...etowns.map(t => S.hdist(i, t)));
  if (mode === 'near') { springs.splice(0, springs.length, ...springs.filter(i => dT(i) >= 2 && dT(i) <= 6)); for (let i = 0; i < N; i++) if (east(i) && w.land[i] && K0.biome[i] !== 2 && !w.river[i] && w.elev[i] > .5 && w.elev[i] <= .62 && dT(i) >= 2 && dT(i) <= 6) springs.push(i); }
  springs.sort((a, b) => mode === 'near' ? dT(a) - dT(b) || w.elev[b] - w.elev[a] : w.elev[b] - w.elev[a]);
  for (const s0 of springs) { if (rivers.length >= +nRiv) break; if (rivers.some(p => p.some(t => S.hdist(t, s0) < (mode === 'near' ? 5 : 7)))) continue;
    const path = [s0]; let cur = s0;
    for (let step = 0; step < 60; step++) { let best = -1, be = w.elev[cur]; for (const n of NB(cur)) if (w.elev[n] < be) { be = w.elev[n]; best = n; } if (best < 0) break; path.push(best); cur = best; if (!w.land[cur]) break; }
    if (path.length >= (mode === 'near' ? 4 : 6)) rivers.push(path); }
  const st = c.sim.exportState();   // 沙盒內部的陣列（同一個參照）：肥沃度要改這裡
  for (const p of rivers) { w.riverPaths.push(p); for (const t of p) if (w.land[t] && !w.river[t]) { w.river[t] = 1; st.fert[t] = Math.min(1.3, st.fert[t] + .35); w.fert[t] = Math.min(1.3, w.fert[t] + .35); w.water[t] = Math.min(1.2, w.water[t] + .4); w.waterK[t] = Math.min(1.3, w.waterK[t] + .6); } }
  console.log(`加了 ${rivers.length} 條河：${rivers.map(p => `${p.length} 格（${w.names[p[0]]} → ${w.names[p[p.length - 1]] || '海'}）`).join('、')}`);
}
const snap = () => { const K = c.sim.peek(), towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
  let own = 0, pop = 0; for (let i = 0; i < N; i++) if (east(i) && K.owner[i] >= 0) { own++; pop += K.pop[i]; }
  return {y: c.year, own, pop: Math.round(pop), towns: towns.filter(east).length, owner: Array.from(K.owner), townList: towns}; };
const rows = [snap()], y0 = c.year, t0 = Date.now(), seen = new Set(w.events.map((e, i) => i));
while (c.year < y0 + +years) { c.advanceTo(c.hour + 24 * 14); if (c.year % 5 === 0 && rows.at(-1).y !== c.year) { rows.push(snap()); console.log(`  ${mode} 第 ${c.year} 年：東邊有人 ${rows.at(-1).own} 格、城 ${rows.at(-1).towns}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`); } }
rows.push(snap());
const ev = w.events.filter((e, i) => !seen.has(i) && e.tile != null && east(e.tile) && /聚落|拓荒|新市鎮|打了井|廢墟/.test(e.text)).map(e => ({y: e.y, text: e.text, tile: e.tile}));
const K = c.sim.peek();
fs.writeFileSync(out, JSON.stringify({mode, W, H: S.H, rivers, oldRivers: w.riverPaths.filter(p => !rivers.includes(p)), land: w.land, biome: Array.from(K.biome), fac: K.fac.map(f => ({id: f.id, n: f.n, c: f.c, alive: f.alive})), names: w.names, rows, ev}));
console.log(`${mode}：${rows[0].y} → ${rows.at(-1).y} 年，東邊有人 ${rows[0].own} → ${rows.at(-1).own} 格、城 ${rows[0].towns} → ${rows.at(-1).towns}、人口 ${rows[0].pop} → ${rows.at(-1).pop}；東邊的拓殖事件 ${ev.length} 件`);
