// 燃料自給率檢查（Alan 2026-10-10）：跑到第 150 年，看燃料存量、零存貨的城、需求滿足率、伐木/油棘林、委託板上的燃料單
import {Core} from '../core.js';
const c = new Core(() => {}); c.start('奇美拉-1'); while (c.year < 150) c.stepYear();
const K = c.sim.peek(), towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
let tot = 0, zero = 0, need = 0, sat = 0, log = 0, oil = 0;
for (const t of towns) { const m = K.markets[t]; tot += m.stock.fuel; if (m.stock.fuel < .5) zero++; const w = m.pop; need += w; sat += w * Math.min(1, m.ratio?.fuel ?? 1); if (m.logging) { log++; if (m.logging.oil) oil++; } }
console.log(`城 ${towns.length}・燃料總量 ${tot.toFixed(0)}・零存貨 ${zero}・人口加權滿足 ${(sat / need * 100).toFixed(0)}%・有伐木隊 ${log}（油棘林 ${oil}）`);
const ops = c.sim.opportunities?.() || [];
const by = {}; for (const o of ops) by[o.kind + (o.g ? ':' + o.g : '')] = (by[o.kind + (o.g ? ':' + o.g : '')] || 0) + 1;
console.log('委託機會', JSON.stringify(by));
for (const o of ops.filter(o => o.kind === 'logging' || o.kind === 'short').slice(0, 6)) console.log(' ', o.kind, o.title, '|', o.detail);
