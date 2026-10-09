// 公路戰（接舷）的檢查：多輛大小車照時刻表進出、路面不能走、跨車吃破綻與壓制、摔下車就死、被敵車帶走、命中懲罰、機器人打得完
// node tools/chimera/highway-check.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
import {pendingCrew, onVehicle} from '../../src/chimera-highway.js';
import {HIGHWAY_SHAKE} from '../../src/chimera-mission.js';
const squad = [['A', 'soldier'], ['B', 'recon'], ['C', 'bulwark'], ['D', 'berserker']].map(([id, cls]) => ({id, cls, st: {hp: cls === 'berserker' ? 160 : 100}, lv: 3}));
let bad = 0; const fail = m => { bad++; console.log('✗', m); };
const mk = (seed, n, type = 'ambush') => new SquadGame({seed, faction: 'rebel', type, biome: '旱原', night: false, enemy: {units: {raider: n}, veh: {rush: 1}, boss: null}, squad});
const rows = [];
for (const [seed, n] of [[1, 6], [2, 12], [3, 14], [4, 5], [5, 14]]) {
  const g = mk(seed, n), o = g.chimeraOutdoor;
  if (o.layout !== 'highway') fail('不是公路戰');
  if (g.enemies.some(e => o.deck[e.y][e.x] < 2)) fail('有敵人不在敵方車上');
  if (g.members.some(m => o.deck[m.y][m.x] !== 1)) fail('有隊員不在自己車上');
  const want = g.enemies.length + pendingCrew(o), seen = new Set(), kinds = {}; let maxV = 0;
  const {botFor} = installFullSquad(g); let k = 0, err = '';
  try { while (g.status === 'playing' && k++ < 4000) { botFor(g.player).step(); maxV = Math.max(maxV, o.trucks.length); for (const v of o.trucks) if (!seen.has(v.id)) { seen.add(v.id); kinds[v.kind] = (kinds[v.kind] || 0) + 1; } } } catch (e) { err = String(e.stack || e).slice(0, 200); }
  if (err) fail(err);
  const logs = g.logs.map(l => l.text || l);
  rows.push({seed, want, vehicles: JSON.stringify(kinds), maxOnMap: maxV, hold: o.holdTurns, crew: g.enemies.filter(e => e.courseName === '衝鋒車乘員').length, status: g.status, turns: g.turn, alive: g.living.length, jumps: logs.filter(t => t.includes('跳上')).length, falls: logs.filter(t => t.includes('摔下車')).length, leftWith: logs.filter(t => t.includes('跟著車離開')).length, taken: logs.filter(t => t.includes('帶走')).length});
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
{ // 被敵車帶走：站在要離開的車上，等它開出地圖
  const g = mk(7, 6), v = g.chimeraOutdoor.trucks.find(q => q.id !== 1), m = g.members[1];
  for (const e of g.enemies) e.hp = 0; for (const p of g.chimeraOutdoor.schedule) p.at = 999;
  m.x = v.x0 + 1; m.y = v.y0; let n = 0; while (m.hp > 0 && n++ < 40 && g.status === 'playing') g.action('wait');
  if (m.hp > 0) fail('站在離開的車上沒有被帶走'); else console.log('✓ 被敵車帶走：', g.logs.map(l => l.text || l).filter(t => t.includes('拉開') || t.includes('帶走')).join(' / '));
}
{ // 命中懲罰：一般射擊扣 HIGHWAY_SHAKE，下錨不扣
  const g = mk(8, 6), e = g.enemies[0], p = g.player;
  const d0 = g.defensiveEvasion(p, e); p.skillState = {...p.skillState, anchor: {remaining: 2, cooldown: 0}}; const d1 = g.defensiveEvasion(p, e);
  if (d0 - d1 !== HIGHWAY_SHAKE) fail(`命中懲罰不對 ${d0} ${d1}`); else console.log('✓ 公路戰命中懲罰', d0, '下錨', d1);
}
console.log(bad ? `有 ${bad} 項不對` : '全部正常');
process.exit(bad ? 1 : 0);
