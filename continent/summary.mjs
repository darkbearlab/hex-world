// node continent/summary.mjs 6：跑 6 個種子，彙整舊王國崩解與四百年後的局面
import {generate} from './sim.js';
const n = +(process.argv[2] || 6), LEG = {曦: '少年王', 燧: '王之劍', 煬: '王甥', 岑: '日輪騎士兄弟', 鈞: '家宰', 淵: '忠臣', 珀: '海歌騎士', 璟: '白騎士'};
const rows = [];
for (let k = 1; k <= n; k++) {
  const L = generate('大陸-' + k).sim.legendData(), alive = L.fac.filter(f => f.alive);
  const sided = L.saga.filter(e => /站在燧衡這一邊/.test(e.text)).length;
  const legendRulers = alive.filter(f => LEG[f.house]).map(f => `${f.house}家（${LEG[f.house]}）治${f.n}`);
  const lake = L.weapons.find(w => w.name === '誓約'), lakeBack = lake.hist.find(h => /尋回|撈起/.test(h.t));
  const gangW = L.weapons.reduce((s, w) => s + w.hist.filter(h => /盜匪頭目.*(挖出|撈起)|火併.*奪得/.test(h.t)).length, 0);
  const lost = L.weapons.filter(w => w.lost).map(w => w.name), sealed = L.weapons.filter(w => w.sealed && w.lost).map(w => w.name);
  const dyn = []; for (const w of L.weapons) { let cur = null, n2 = 0, best = {h: '', n: 0}; for (const h of w.hist) { const m = h.t.match(/傳給了(\S)/); if (m && m[1] === cur) n2++; else { cur = m ? m[1] : null; n2 = 1; } if (n2 > best.n) best = {h: cur, n: n2}; } if (best.n >= 5) dyn.push(`「${w.name}」在${best.h}家傳了 ${best.n} 代`); }
  const feud = Object.entries(L.houseAff).sort((a, b) => a[1] - b[1])[0];
  rows.push({seed: k, fall: L.ARC.fallY, sided, states: alive.length, top: alive.map(f => f.n).slice(0, 3).join('、'), legendRulers, lakeBack: lakeBack ? `${lakeBack.y} 年被尋回` : '仍在水中', gangW, lost, sealed, dyn, feud: feud ? `${feud[0]} ${feud[1].toFixed(1)}` : '', gawain: L.heroes.find(h => h.role === 'gawain')?.end, percival: L.heroes.find(h => h.role === 'percival')?.end});
}
for (const r of rows) console.log(JSON.stringify(r, null, 0));
