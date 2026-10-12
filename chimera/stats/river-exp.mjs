// 實驗（Alan 2026-10-12）：東邊拉幾條河，有沒有機會讓那裡開始有人？只在本機跑，不動線上。
// 同一份存檔：rivers＝在東邊（地圖右邊三分之一）的高地照開服時的做法「流」出幾條河（從高處沿最陡的方向往下，直到海或窪地），
// base＝什麼都不改。各自往後推演 N 個沙盒年，每 5 年記一次東邊有人的格子、人口、城，最後寫成 JSON 給 river-map.mjs 畫圖。
// node chimera/stats/river-exp.mjs 存檔.json rivers|base 年數 輸出.json [河的條數=3]
import fs from 'fs';
import {Core} from '../core.js';
import * as S from '../sim.js';

const [file, mode, years = '40', out, nRiv = '3'] = process.argv.slice(2);
if (process.env.OPR) globalThis.OPR = +process.env.OPR;
if (process.env.NOSUPPLY) globalThis.NOSUPPLY = 1;   // 關掉前哨的補給線（比較用）   // 拓荒者遠行的機率（每個勢力每年，預設 0.06）
// 謠言（RUMOR=1）：東邊大河中段（欄 54、列 22）有舊星艦維修站的謠言；SEED=n 換沙盒的亂數種子（同一份存檔跑出不同的未來）
if (process.env.RUMOR) globalThis.RUMOR = {tile: 22 * 60 + 54, reach: +(process.env.REACH || 35), opr: +(process.env.ROPR || .3), pull: .5};
const raw = JSON.parse(fs.readFileSync(file, 'utf8')); if (process.env.SEED) raw.save.sim.rng = (raw.save.sim.rng ^ Math.imul(+process.env.SEED, 2654435761)) | 0;
const c = new Core(() => {}); c.load(raw.seed, raw.save); const w = c.w, W = S.W, N = S.N;
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
// corridor（Alan 2026-10-12）：東邊低地一條從北往南、流進東南海的大河；從西南的城沿南邊、經南岸的聚落往東北，每 5～6 格一個綠洲當跳板（這張地圖專用的路線）
if (mode === 'corridor') {
  const at = (q, r) => r * W + q, st = c.sim.exportState(), wet = (t, k = 1) => { if (!w.land[t]) return; if (!w.river[t]) { w.river[t] = 1; st.fert[t] = Math.min(1.3, st.fert[t] + .35); w.fert[t] = Math.min(1.3, w.fert[t] + .35); } w.water[t] = Math.min(1.2, w.water[t] + .4 * k); w.waterK[t] = Math.min(1.3, w.waterK[t] + .6 * k); };
  const NB = i => { const r = Math.floor(i / W), q = i % W, d = (r & 1) ? [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]] : [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]], o = []; for (const [dq, dr] of d) { const a = q + dq, b = r + dr; if (a >= 0 && a < W && b >= 0 && b < S.H) o.push(b * W + a); } return o; };
  // 大河：從東北的高處沿最低的谷地（成本＝1＋高度×4）走到東南的海
  const src = at(52, 7), isMouth = t => !w.land[t] && Math.floor(t / W) >= 32 && t % W >= 46; let dst = -1; const dist = new Map([[src, 0]]), prev = new Map(), Q = [[0, src]];
  while (Q.length) { Q.sort((a, b) => a[0] - b[0]); const [d0, u] = Q.shift(); if (isMouth(u)) { dst = u; break; } if (d0 > dist.get(u)) continue; for (const n of NB(u)) { if (!w.land[n] && !isMouth(n)) continue; const nd = d0 + 1 + w.elev[n] * 4; if (nd < (dist.get(n) ?? 1e9)) { dist.set(n, nd); prev.set(n, u); Q.push([nd, n]); } } }
  const big = [dst]; while (prev.has(big[0])) big.unshift(prev.get(big[0])); rivers.push(big); for (const t of big) wet(t, 1.2);
  // 跳板：沿著這些點（欄, 列）放綠洲（中心＋一格小水脈）
  const stones = [[17, 38], [23, 40], [29, 41], [34, 40], [40, 39], [45, 37], [49, 34], [51, 29], [53, 24], [54, 18]].map(([q, r]) => at(q, r)).filter(t => w.land[t]);
  for (const t of stones) { const n = NB(t).find(x => w.land[x] && !w.river[x]); const p = n != null ? [t, n] : [t]; rivers.push(p); for (const x of p) wet(x, 1); }
  console.log(`大河 ${big.length} 格（${w.names[big[0]]} → ${w.names[big[big.length - 1]] || '海'}），跳板綠洲 ${stones.length} 個：${stones.map(t => w.names[t]).join('、')}`);
}
const snap = () => { const K = c.sim.peek(), towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
  let own = 0, pop = 0; for (let i = 0; i < N; i++) if (east(i) && K.owner[i] >= 0) { own++; pop += K.pop[i]; }
  return {y: c.year, own, pop: Math.round(pop), towns: towns.filter(east).length, owner: Array.from(K.owner), townList: towns}; };
const rows = [snap()], y0 = c.year, t0 = Date.now(), seen = new Set(w.events.map((e, i) => i));
while (c.year < y0 + +years) { c.advanceTo(c.hour + 24 * 14); if (c.year % 5 === 0 && rows.at(-1).y !== c.year) { rows.push(snap()); console.log(`  ${mode} 第 ${c.year} 年：東邊有人 ${rows.at(-1).own} 格、城 ${rows.at(-1).towns}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`); } }
rows.push(snap());
const ev = w.events.filter((e, i) => !seen.has(i) && e.tile != null && east(e.tile) && /聚落|拓荒|新市鎮|打了井|廢墟/.test(e.text)).map(e => ({y: e.y, text: e.text, tile: e.tile}));
const K = c.sim.peek(), RM = c.sim.rumor, warEv = w.events.filter((e, i) => !seen.has(i) && e.tile != null && east(e.tile) && (e.type === 'war' || /截下|洗劫|維修站/.test(e.text))).map(e => ({y: e.y, text: e.text}));
const station = RM ? {found: RM.found || null, holder: RM.holder ?? null, holderN: RM.holder >= 0 ? K.fac[RM.holder]?.n : null, heldY: RM.heldY ?? null} : null, outposts = c.sim.outposts ? c.sim.outposts().length : 0;
console.log(`  維修站：${station?.found ? `第 ${station.found.y} 年被${station.found.who || K.fac[station.found.by]?.n}找到，現在在${station.holderN || '沒有人'}手上` : '還沒找到'}；前哨 ${outposts} 座；東邊的衝突事件 ${warEv.length} 件`);
fs.writeFileSync(out, JSON.stringify({station, outposts, warEv, mode: process.env.TAG || mode, W, H: S.H, rivers, oldRivers: w.riverPaths.filter(p => !rivers.includes(p)), land: w.land, biome: Array.from(K.biome), fac: K.fac.map(f => ({id: f.id, n: f.n, c: f.c, alive: f.alive})), names: w.names, rows, ev}));
console.log(`${mode}：${rows[0].y} → ${rows.at(-1).y} 年，東邊有人 ${rows[0].own} → ${rows.at(-1).own} 格、城 ${rows[0].towns} → ${rows.at(-1).towns}、人口 ${rows[0].pop} → ${rows.at(-1).pop}；東邊的拓殖事件 ${ev.length} 件`);
