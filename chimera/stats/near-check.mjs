// 近的一層（OPMAP.md 第 2 段）：兵牌在作戰地圖的小格上生出、照地形一小格一小格走；敵對的走進基地旁邊一小格＝遭遇；
// 掠奪者碰到商隊擲戰鬥結果表，結果寫回沙盒。node chimera/stats/near-check.mjs 存檔.json
import fs from 'fs';
import {Core} from '../core.js';
import {NEAR, crt, basePos} from '../near.js';
import {hdist, W} from '../sim.js';
import {hexDist, center} from '../opmap.js';
NEAR.on = true;
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = new Core(() => {}); c.load(raw.seed, raw.save);
const K = c.sim.peek(), w = c.w;
let bad = 0; const ok = (x, m) => { console.log(`${x ? '✓' : '✗'} ${m}`); if (!x) bad++; };
// 戰鬥結果表：戰力比越高越容易得手
const odds = r => { let n = 0; for (let i = 0; i < 1000; i++) n += crt(r, 1, i / 1000) === 'robbed' ? 1 : 0; return n / 1000; };
ok(odds(.3) < odds(1) && odds(1) < odds(4), `CRT：1:3 得手 ${odds(.3)}、1:1 ${odds(1)}、4:1 ${odds(4)}`);
// 停在匪患高的荒野
const towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
let spot = -1, home = -1, best = 0;
for (const t of towns) for (let i = 0; i < K.bandit.length; i++) if (w.land[i] && !K.markets[i] && hdist(i, t) <= 3 && K.bandit[i] > best) { best = K.bandit[i]; spot = i; home = t; }
c.found(home, '近測試'); const G = c.game.cos['近測試']; G.base = spot;
const kinds = {}, seen = new Set(); let tickets = 0, maxN = 0, moved = 0, onSub = true;
const inbox0 = () => c.game.book.inbox.filter(x => x.player === '近測試' && x.kind === 'ticket').length; let t0 = inbox0();
const last = new Map();
for (let d = 0; d < 14 * 24; d++) {
  c.advanceTo(c.hour + 1);
  const L = G.hq?.near || []; maxN = Math.max(maxN, L.length);
  for (const p of L) { if (!seen.has(p.id)) { seen.add(p.id); kinds[p.kind] = (kinds[p.kind] || 0) + 1; } if (!p.pos) onSub = false; const k = last.get(p.id); if (k && (k[0] !== p.pos[0] || k[1] !== p.pos[1])) moved++; last.set(p.id, p.pos.slice()); if (hexDist(p.pos, center(p.tile, W)) > 3) onSub = false; }
  const t1 = inbox0(); if (t1 > t0) { tickets += t1 - t0; t0 = t1; }
}
ok(onSub, '每個兵牌都在牠那一格的小格上');
ok(moved > 50, `兵牌會動（換小格 ${moved} 次）`);
ok(tickets > 0, `停在匪患 ${best.toFixed(0)} 的荒野 14 天：出現 ${seen.size} 個兵牌 ${JSON.stringify(kinds)}，同時最多 ${maxN}，被追上 ${tickets} 次`);
const fights = (G.hq.log || []).filter(e => /附近：/.test(e.text)).map(e => e.text);
console.log(`  非玩家之間的交戰 ${fights.length} 次：${fights.slice(0, 3).join('｜')}`);
console.log(bad ? `${bad} 項不對` : '全部正常');
