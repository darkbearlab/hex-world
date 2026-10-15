// 據點（參考 ASH 生存模式的佔點）：奪點（突擊、戰壕）敵人守在點旁邊、我方拿下就贏；守點敵人會衝據點、全部失守就輸。
// node tools/chimera/point-check.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
const squad = lv => [['A', 'soldier'], ['B', 'recon'], ['C', 'bulwark'], ['D', 'berserker']].map(([id, cls]) => ({id, cls, st: {hp: 100}, lv}));
const rows = [];
for (const type of ['assault', 'trench', 'hold']) for (const [lv, n] of [[3, 12], [3, 30], [1, 30]]) for (const seed of [2, 5, 8]) {
  const g = new SquadGame({seed, faction: 'loyalist', type, biome: '旱原', night: type === 'trench', enemy: {units: {trooper: Math.round(n * .7), trooper_heavy: Math.round(n * .3)}, veh: {}, boss: null}, squad: squad(lv)});
  const S = g.survival, near0 = g.enemies.filter(e => S && S.points.some(p => Math.abs(p.x - e.x) + Math.abs(p.y - e.y) <= 3)).length;
  const {botFor} = installFullSquad(g); let k = 0; while (g.status === 'playing' && k++ < 4000) botFor(g.player).step();
  const logs = g.logs.map(l => l.text || l);
  rows.push({type, lv, n, seed, points: S?.points.length, hp: S?.points.map(p => p.hp).join('/'), nearAtStart: near0, status: g.status, turns: g.turn, alive: g.living.length,
    end: logs.find(t => /據點全部|全部失守|撐過|清光|開到/.test(t)) || '', fell: logs.filter(t => /失守|拿下據點/.test(t)).length});
}
console.table(rows);
