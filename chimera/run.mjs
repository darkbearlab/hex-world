// node chimera/run.mjs <種子>：推演奇美拉星球，輸出斷鏈之後的編年史、遺產級的流轉、陣營與現存勢力
import {generate, YEARS} from './sim.js';
const seed = process.argv[2] || '奇美拉-1';
const t0 = Date.now();
const w = generate(seed);
const L = w.sim.legendData(), K = w.sim.peek(), nm = i => (i >= 0 && w.names[i]) || '某處';
const out = [`# 種子 ${seed}（${((Date.now() - t0) / 1000).toFixed(1)} 秒，推演 ${YEARS} 年）`];
out.push(`\n斷鏈：第 ${L.ARC.ackY} 年承認企業不會回來；第 ${L.ARC.fallY} 年總督府崩塌；第 ${L.ARC.blocY} 年起形成陣營。`);
out.push(`\n## 編年史（傳說層）`);
for (const e of L.saga) if (!/配給|交給了|傳給了|收進/.test(e.text)) out.push(`- ${e.y} 年：${e.text}`);
out.push(`\n## 遺產級`);
for (const wp of L.weapons) {
  const now = wp.holder ? `在${wp.holderName}手上` : wp.fac >= 0 ? `收在${L.fac[wp.fac].n}的軍械庫` : wp.gang ? `在${wp.gangName}手上` : wp.lost ? `失落在${nm(wp.loc)}${wp.sealed ? '的舊倉庫' : ''}（${wp.lostY} 年起）` : '?';
  out.push(`- 「${wp.name}」${wp.kind}：易手 ${wp.owners} 次，打贏 ${wp.wins} 場，現在${now}`);
}
const alive = L.fac.filter(f => f.alive), P = {};
for (let i = 0; i < K.owner.length; i++) if (K.owner[i] >= 0) P[K.owner[i]] = (P[K.owner[i]] || 0) + K.pop[i];
const tag = f => [f.free && '自由城市', f.works && '廠鎮', f.native && '原住民', f.league && (L.leagues.find(x => x.id === f.league) || {}).n, f.liege >= 0 && `${L.fac[f.liege].n}的附庸`].filter(Boolean).join('、');
for (const B of [...(L.ARC.blocs || []).filter(B => !B.gone), {id: 0, n: '不屬於任何陣營'}]) {
  const m = alive.filter(f => (f.bloc || 0) === B.id).sort((a, b) => (P[b.id] || 0) - (P[a.id] || 0)); if (!m.length) continue;
  out.push(`\n## ${B.n}${B.lead !== undefined ? `（盟主：${L.fac[B.lead].n}）` : ''}`);
  for (const f of m) out.push(`- ${f.n}：人口 ${Math.round(P[f.id] || 0)}，第 ${f.born} 年成立${tag(f) ? '，' + tag(f) : ''}`);
}
console.log(out.join('\n'));
