// 大戰役的統計（Alan 2026-10-09，warband/DESIGN.md「大戰役」）：公司模式推幾季，看沙盒自己長出幾場大戰役、打幾天、兵力怎麼消耗、
// 傭兵行情怎麼漲、前線物價怎麼變、誰贏。node chimera/stats/campaign-check.mjs [種子數=3] [天數=112]
import {Core} from '../core.js';
const seeds = +(process.argv[2] || 3), days = +(process.argv[3] || 112);
const all = [];
for (let k = 1; k <= seeds; k++) {
  const c = new Core(() => {}); c.start('奇美拉-' + k); while (c.year < 100) c.stepYear();
  const K = c.sim.peek(), town = Object.keys(K.markets).map(Number).find(t => K.owner[t] >= 0); c.found(town, '觀察');
  const price = {}, seen = new Map();
  for (let h = 1; h <= days * 24; h++) {
    c.advanceTo(h);
    for (const v of c.sim.campaignView()) {
      let r = seen.get(v.id); if (!r) { const P = c.sim.peek(); r = {seed: k, id: v.id, h0: h, name: v.name, an: v.an, dn: v.dn, FA0: v.FA, FD0: v.FD, startH: h, p0: P.markets[v.tile]?.price?.ammo, mulTimes: {}}; seen.set(v.id, r); }
      for (const m of [2, 4]) if (Math.max(v.mulA, v.mulD) >= m && r.mulTimes[m] == null) r.mulTimes[m] = +((h - r.startH) / 24).toFixed(1);
      if (v.done && r.end == null) { const P = c.sim.peek(); r.end = h; r.days = +((h - r.startH) / 24).toFixed(1); r.win = v.win === v.att ? '攻' : '守'; r.fa = v.fa; r.fd = v.fd; r.p1 = P.markets[v.tile]?.price?.ammo; r.rounds = v.round; }
    }
  }
  all.push(...seen.values());
}
console.table(all.map(r => ({seed: r.seed, 開打: Math.round(r.h0 / 24) + '天', 地點: r.name, 攻: r.an, 守: r.dn, 兵力: `${r.FA0}:${r.FD0}`, 天數: r.days ?? '進行中', 勝: r.win ?? '', 剩: r.fa != null ? `${Math.round(r.fa * 100)}%:${Math.round(r.fd * 100)}%` : '', '×2 第幾天': r.mulTimes[2] ?? '', '×4 第幾天': r.mulTimes[4] ?? '', 彈藥價: r.p0 != null ? `${r.p0.toFixed(2)}→${(r.p1 ?? 0).toFixed(2)}` : ''})));
console.log(`${seeds} 個世界 ${days} 天：大戰役 ${all.length} 場`);
