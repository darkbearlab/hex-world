// 近的一層（DESIGN.md「縮小規模」第 3 步）：基地附近生出隊伍、會動、敵對的追上基地就開服務單；開進牠們那一格也打。
// node chimera/stats/near-check.mjs 存檔.json
import fs from 'fs';
import {Core} from '../core.js';
import {NEAR} from '../near.js';
import {hdist} from '../sim.js';
NEAR.on = true;
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = new Core(() => {}); c.load(raw.seed, raw.save);
const K = c.sim.peek(), w = c.w;
// 找一座城，旁邊 3 格內有匪患高的荒野：把基地停在那裡
const towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
let spot = -1, home = -1, best = 0;
for (const t of towns) for (let i = 0; i < K.bandit.length; i++) if (w.land[i] && !K.markets[i] && hdist(i, t) <= 3 && K.bandit[i] > best) { best = K.bandit[i]; spot = i; home = t; }
console.log('城', w.names[home], '荒野格', spot, '匪患', best.toFixed(0));
c.found(home, '近測試'); const G = c.game.cos['近測試'];
G.base = spot; if (c.game.book.companies['近測試']) c.game.book.companies['近測試'].base = spot;
const kinds = {}, seen = new Set(); let tickets = 0, maxN = 0, hours = 0;
const inbox0 = () => c.game.book.inbox.filter(x => x.player === '近測試' && x.kind === 'ticket').length;
let t0 = inbox0();
for (let d = 0; d < 14 * 24; d++) {
  c.advanceTo(c.hour + 1); hours++;
  const L = G.hq?.near || []; maxN = Math.max(maxN, L.length);
  for (const p of L) if (!seen.has(p.id)) { seen.add(p.id); kinds[p.kind] = (kinds[p.kind] || 0) + 1; }
  const t1 = inbox0(); if (t1 > t0) { tickets += t1 - t0; t0 = t1;
    // 自動結算掉，讓遊戲繼續（服務單在 24 小時後自動結算）
  }
}
console.log(`停在荒野 14 天：出現過 ${seen.size} 隊 ${JSON.stringify(kinds)}，同時最多 ${maxN} 隊，被追上 ${tickets} 次`);
const v = c.view('近測試').data.hq.near; console.log('畫面資料', JSON.stringify(v).slice(0, 300));
