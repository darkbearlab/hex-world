// 加速的驗證：同一個案子，一般和加速各派一隊，看到位時間、去程與回程的扣款
// node chimera/stats/speed-check.mjs
import {Core} from '../core.js';
const run = fast => {
  const c = new Core(() => {}); c.start('奇美拉-1'); while (c.year < 60) c.stepYear();
  const K = c.sim.peek(), town = Object.keys(K.markets).map(Number).find(t => K.owner[t] >= 0);
  c.found(town, '測'); const G = c.co('測');
  const opps = c.sim.opportunities().filter(x => x.kind !== 'front' && x.kind !== 'tense');
  let err = '?'; for (const o of opps) { err = c.command({type: 'accept', kind: o.kind, tile: o.tile, side: '', fast, uids: G.roster.filter(x => x.alive && x.status === 'home').slice(0, 4).map(x => x.uid)}, '測'); if (!err) break; }
  if (err) return {err};
  const sq = Object.values(c.game.book.squads).find(s => s.player === '測');
  const eta = sq.readyAt;
  for (let h = 1; h <= 24 * 6; h++) c.advanceTo(h);
  const speed = c.game.book.ledger.filter(x => x.player === '測' && x.kind === 'speed');
  return {fast, eta, speed: speed.map(x => `${x.amount}「${x.text}」`), home: G.roster.filter(x => x.status === 'home').length};
};
console.log(run(false)); console.log(run(true));
