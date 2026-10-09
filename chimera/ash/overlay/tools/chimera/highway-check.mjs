// 公路戰（接舷）的檢查：兩三台車、路面不能走、跨車吃破綻與壓制、摔下車就死、機器人打得完
// node tools/chimera/highway-check.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
const squad = [['A', 'soldier'], ['B', 'recon'], ['C', 'bulwark'], ['D', 'berserker']].map(([id, cls]) => ({id, cls, st: {hp: cls === 'berserker' ? 160 : 100}, lv: 3}));
let bad = 0; const fail = m => { bad++; console.log('✗', m); };
const mk = (seed, n, type = 'ambush') => new SquadGame({seed, faction: 'rebel', type, biome: '旱原', night: false, enemy: {units: {raider: n}, veh: {rush: 1}, boss: null}, squad});
const rows = [];
for (const [seed, n] of [[1, 6], [2, 12], [3, 14], [4, 5]]) {
  const g = mk(seed, n), o = g.chimeraOutdoor;
  if (o.layout !== 'highway') fail('不是公路戰');
  if (g.enemies.some(e => o.deck[e.y][e.x] < 2)) fail('有敵人不在敵方車上');
  if (g.members.some(m => o.deck[m.y][m.x] !== 1)) fail('有隊員不在自己車上');
  const {botFor} = installFullSquad(g); let k = 0, err = '';
  try { while (g.status === 'playing' && k++ < 2500) botFor(g.player).step(); } catch (e) { err = String(e.stack || e).slice(0, 200); }
  if (err) fail(err);
  const logs = g.logs.map(l => l.text || l);
  rows.push({seed, enemies: g.enemies.length, trucks: o.trucks.length, crew: g.enemies.filter(e => e.courseName === '衝鋒車乘員').length, status: g.status, turns: g.turn, alive: g.living.length, jumps: logs.filter(t => t.includes('跳上')).length, falls: logs.filter(t => t.includes('摔下車')).length});
}
console.table(rows);
{ // 路面不能走
  const g = mk(5, 6), p = g.player, T1 = g.chimeraOutdoor.trucks[0], road = {x: p.x, y: T1.y0 + T1.w + 2};
  if (g.passable(road.x, road.y, p)) fail('路面可以走');
  // 跨車：站在我方車斗北緣，往北走一格到敵方車上
  const e = g.enemies; for (const x of e) x.hp = 0;
  const T2 = g.chimeraOutdoor.trucks[1]; p.x = T2.x0 + 2; p.y = T1.y0; const ok = g.action('move', [0, -1]);
  if (!ok || p.y !== T1.y0 - 1) fail(`跨不過去 ${ok} ${p.x},${p.y}`); else if (!p.vaultExposed || !(p.suppression > 0)) fail(`跨車沒有破綻或壓制 ${p.vaultExposed} ${p.suppression}`); else console.log('✓ 跨上敵車：破綻', p.vaultExposed, '壓制', p.suppression);
  // 摔下車
  const g2 = mk(6, 6), m = g2.members[1], U = g2.chimeraOutdoor.trucks[0]; m.x = 13; m.y = U.y0 + U.w + 2; g2.action('wait');
  if (m.hp > 0) fail('摔下車沒死'); else console.log('✓ 摔下車：', g2.logs.map(l => l.text || l).find(t => t.includes('摔下車')));
}
console.log(bad ? `有 ${bad} 項不對` : '全部正常');
process.exit(bad ? 1 : 0);
