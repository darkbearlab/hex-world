// 戰場大小的挑法（2026-10-13）：正式服務單敵人 12 名以上、而且是清光或守住就贏的類型才開 50×50，其餘 27
// node chimera/stats/size-pick.mjs
import {Core} from '../core.js';
import {makeSquad} from '../cases.js';
const out = [], a = new Core(m => out.push(m)); a.start('奇美拉-1'); while (a.year < 100) a.stepYear();
const K = a.sim.peek(), base = Object.keys(K.markets).map(Number).find(t => K.owner[t] >= 0);
a.found(base, '測試公司');
a.advanceTo(2); const B = a.game.book, sq = makeSquad(B, '測試公司', {size: 4, at: base, name: '測試隊'});
if (!sq) { console.log('找不到小隊'); process.exit(1); }
const tk = {id: 'T-size', title: '大小測試', type: 'hold', tile: base, biome: '', night: false, enemy: {side: 'army', units: {}, veh: {}, boss: null, power: 20}, squad: sq.id, player: '測試公司', done: false, deadline: 1e9}; B.tickets.push(tk);
const cases = [['hold', 14, 50], ['probe', 12, 50], ['clear', 11, 27], ['assault', 20, 27], ['trench', 14, 27], ['hold', 6, 27]];
let bad = 0;
for (const [type, n, want] of cases) {
  Object.assign(tk, {type, transit: false, facility: false, enemy: {...tk.enemy, units: {trooper: n}, veh: {}, boss: null}}); delete tk.fightAt;
  out.length = 0; const err = a.command({type: 'fight', ticket: tk.id}, '測試公司'), m = out.find(x => x.type === 'mission');
  const got = m?.data.size, ok = got === want; if (!ok) bad++;
  console.log(`${type} ${n} 名 → ${err || got}（應為 ${want}）${ok ? '' : ' ✗'}`);
}
console.log(bad ? `有 ${bad} 項不對` : '全部正常'); process.exit(bad ? 1 : 0);
