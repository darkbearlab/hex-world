// 戰場的敵人數要等於服務單上的規模（沙盒算出來的 units＋veh＋boss）：每種類型、每種布局都放得下，不能被站位數量截掉。
// node tools/chimera/scale-check.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {ticketUnits} from '../../src/chimera-mission.js';
import {pendingCrew} from '../../src/chimera-highway.js';
const squad = [['A', 'soldier'], ['B', 'recon'], ['C', 'bulwark'], ['D', 'berserker']].map(([id, cls]) => ({id, cls, st: {hp: 100}, lv: 3}));
const rows = []; let bad = 0;
for (const type of ['ambush', 'native', 'intercept', 'transit', 'assault', 'hold', 'trench', 'sabotage', 'probe', 'clear']) for (const big of [false, true]) for (const seed of [3, 7, 21, 99]) {
  const units = type === 'native' ? {native: big ? 10 : 2, native_hunter: big ? 4 : 1} : ['ambush', 'transit', 'clear'].includes(type) ? {raider: big ? 12 : 2, raider_heavy: big ? 2 : 1} : {trooper: big ? 9 : 2, trooper_heavy: big ? 3 : 1, clone_trooper: big ? 2 : 0};
  const veh = big && !['native', 'ambush', 'clear', 'transit'].includes(type) ? {rush: type === 'trench' || type === 'sabotage' ? 0 : 3, armor: 1, gt: 1} : {};
  const tk = {seed, faction: 'rebel', type, biome: '旱原', night: false, enemy: {units, veh, boss: big ? {weapon: 'x'} : null}, squad};
  const g = new SquadGame(tk), want = ticketUnits(tk).length, got = g.enemies.length + (g.chimeraOutdoor?.layout === 'highway' ? pendingCrew(g.chimeraOutdoor) : 0);   // 公路戰：還在後面車上的也算
  if (got !== want) { bad++; rows.push({type, seed, big, layout: g.chimeraOutdoor?.layout, want, got}); }
}
if (rows.length) console.table(rows);
console.log(bad ? `有 ${bad} 場敵人數不對` : '全部照規模');
process.exit(bad ? 1 : 0);
