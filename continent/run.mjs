// node continent/run.mjs <種子> [年數]：推演大陸，輸出舊王國的傳說、傳奇的結局、傳奇武器的流轉、家族
import {generate} from './sim.js';
const seed = process.argv[2] || '大陸-1';
const t0 = Date.now();
const w = generate(seed);
const L = w.sim.legendData(), nm = i => (i >= 0 && L.names[i]) || '某處';
const out = [];
out.push(`# 種子 ${seed}（${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
out.push(`\n## 舊王國的興亡`);
for (const e of L.saga.filter(e => e.y <= (L.ARC.fallY ?? 30) + 3)) out.push(`- ${e.y} 年：${e.text}`);
out.push(`\n## 傳奇們的結局`);
for (const h of L.heroes.filter(h => h.legend)) out.push(`- ${h.title}${h.name}：${h.alive ? '（還活著？）' : `${h.diedY} 年，${h.end}`}`);
out.push(`\n## 傳奇武器`);
for (const wp of L.weapons) {
  const now = wp.holder ? `在${wp.holderName}手上` : wp.fac >= 0 ? `收在${L.fac[wp.fac].n}的寶庫` : wp.gang ? `在盜匪${wp.gangName}的山寨` : wp.lost ? `失落於${nm(wp.lake && wp.shore !== undefined ? wp.shore : wp.loc)}${wp.lake ? '外的水中' : ''}（${wp.lostY} 年起${wp.lake ? '，沉在水裡' : wp.sealed ? '，封在古林' : ''}）` : '?';
  out.push(`\n### 「${wp.name}」${wp.kind}：易手 ${wp.owners} 次，打贏 ${wp.wins} 場，現在${now}`);
  // 同一家族代代相傳的一段，縮成一行
  let run = null;
  const flush = () => { if (run) { out.push(run.n > 1 ? `  - ${run.y0}–${run.y1} 年：在${run.house}家代代相傳（${run.n} 代）` : `  - ${run.y0} 年：${run.t}`); run = null; } };
  for (const h of wp.hist) {
    const m = h.t.match(/^(\S+?)(壽終於|戰死於)\S*，「\S+」傳給了(\S+)。$/);
    if (m && m[1][0] === m[3][0]) { if (run && run.house === m[3][0]) { run.n++; run.y1 = h.y; } else { flush(); run = {house: m[3][0], y0: h.y, y1: h.y, n: 1, t: h.t}; } continue; }
    flush(); out.push(`  - ${h.y} 年：${h.t}`);
  }
  flush();
}
const alive = L.fac.filter(f => f.alive);
out.push(`\n## 400 年後的大陸（${alive.length} 國）`);
const tiles = {}; for (const o of L.owner) if (o >= 0) tiles[o] = (tiles[o] || 0) + 1;
for (const f of alive.sort((a, b) => (tiles[b.id] || 0) - (tiles[a.id] || 0))) { const r = L.heroes.find(h => h.id === f.ruler); out.push(`- ${f.n}（${tiles[f.id] || 0} 格，${f.born} 年立國${f.liege >= 0 ? `，${L.fac[f.liege].n}的封臣` : ''}）：國君${r ? r.name : '?'}，${f.house}家`); }
const houses = {}; for (const h of L.heroes) if (h.legend || h.ruled) (houses[h.name[0]] = houses[h.name[0]] || []).push(h);
out.push(`\n## 家族恩怨（最深的五對）`);
for (const [k, v] of Object.entries(L.houseAff).sort((a, b) => a[1] - b[1]).slice(0, 5)) out.push(`- ${k.replace('|', '家 vs ')}家：${v.toFixed(2)}`);
out.push(`\n## 之後的傳說（王國崩解後）`);
for (const e of L.saga.filter(e => e.y > (L.ARC.fallY ?? 30) + 3)) out.push(`- ${e.y} 年：${e.text}`);
const bk = L.events.filter(e => /自立為王|斷了香火|身後無嗣/.test(e.text));
out.push(`\n## 盜匪稱王與絕嗣（${bk.length} 件）`);
for (const e of bk.slice(0, 40)) out.push(`- ${e.y} 年：${e.text}`);
console.log(out.join('\n'));
