// 派遣（DESIGN.md「縮小規模」第 4 步）：探索、交流、攻擊三種，到點開服務單（交流不打）、打完回基地、結果寫進基地日誌
// node chimera/stats/sortie-check.mjs 存檔.json
import fs from 'fs';
import {Core} from '../core.js';
import {NEAR} from '../near.js';
import {RARE} from '../company.js';
import {hdist} from '../sim.js';
NEAR.on = true; RARE.on = true;
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = new Core(() => {}); c.load(raw.seed, raw.save);
const K = c.sim.peek(), w = c.w, N = '派遣測試';
const home = Object.keys(K.markets).map(Number).find(t => K.owner[t] >= 0);
c.found(home, N); const G = c.game.cos[N];
const wild = []; for (let i = 0; i < K.bandit.length; i++) if (w.land[i] && !K.markets[i] && hdist(i, home) >= 2 && hdist(i, home) <= 4) wild.push(i);
let bad = 0; const ok = (x, t) => { console.log(`${x ? '✓' : '✗'} ${t}`); if (!x) bad++; };
const home4 = () => G.roster.filter(x => x.alive && x.status === 'home').slice(0, 2).map(x => x.uid);
const town = Object.keys(K.markets).map(Number).find(t => t !== home && K.owner[t] >= 0 && hdist(t, home) <= 6);
ok(c.command({type: 'sortie', tile: town, mode: 'fight', uids: home4()}, N) === '不能在城裡動手', '城裡不能攻擊');
for (const [mode, tile] of [['explore', wild[0]], ['talk', town ?? wild[1]], ['fight', wild[2]]]) {
  const err = c.command({type: 'sortie', tile, mode, uids: home4()}, N); ok(!err, `派遣・${mode} 到 ${w.names[tile] || tile}（${err || '出發'}）`);
  const caseId = G.cases[G.cases.length - 1], cs = c.game.book.cases.find(x => x.id === caseId);
  for (let i = 0; i < 24 * 8 && !(cs.sortie?.done); i++) c.advanceTo(c.hour + 1);
  const log = G.hq.log.filter(e => e.text.startsWith(cs.title)).map(e => e.text);
  ok(cs.sortie?.done, `${mode}：結果 ${JSON.stringify(log).slice(0, 160)}`);
  for (let i = 0; i < 24 * 5 && G.roster.some(x => x.status === 'away'); i++) c.advanceTo(c.hour + 1);
  ok(!G.roster.some(x => x.status === 'away'), `${mode}：人回到基地`);
}
console.log(bad ? `${bad} 項不對` : '全部正常');
