// 戶外地圖的驗證：每種服務單類型各打一場（機器人當玩家），看地圖有沒有問題、打不打得完。
// 勝利要真的達成：清光（kill）的那幾種結束時敵人要全倒；行軍遇襲（exit）是走到另一頭。
// node tools/chimera/outdoor-check.mjs [種子]
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
import {isNoncombatant} from '../../src/enemy-data.js';
const seed = Number(process.argv[2] || 7);
const squad = [['A', 'soldier'], ['B', 'recon'], ['C', 'bulwark'], ['D', 'berserker']].map(([id, cls]) => ({id, cls, st: {hp: cls === 'berserker' ? 160 : 100}, lv: 3}));
const rows = []; let bad = 0;
for (const type of ['ambush', 'native', 'intercept', 'transit', 'assault', 'hold', 'trench', 'sabotage', 'probe', 'clear']) {
  const units = type === 'native' ? {native: 4, native_hunter: 2} : ['intercept', 'assault', 'hold', 'trench', 'sabotage', 'probe'].includes(type) ? {trooper: 4, trooper_heavy: 2} : {raider: 4, raider_heavy: 2};
  const g = new SquadGame({seed, faction: 'rebel', type, biome: '旱原', night: ['trench', 'sabotage'].includes(type), enemy: {units, veh: {}, boss: type === 'clear' ? {weapon: 'x'} : null}, squad});
  const {botFor} = installFullSquad(g); let n = 0, err = '';
  try { while (g.status === 'playing' && n++ < 2500) botFor(g.player).step(); } catch (e) { err = String(e.message || e).slice(0, 80); }
  const left = g.enemies.filter(e => e.hp > 0 && !isNoncombatant(e)).length, goal = g.chimeraOutdoor?.goal;
  const ok = !err && (g.status !== 'won' || goal === 'exit' || left === 0 || (goal === 'hold' && g.turn >= g.chimeraOutdoor.holdTurns));
  if (!ok) bad++;
  rows.push({type, layout: g.chimeraOutdoor?.layout, goal, enemies: g.enemies.length, left, props: g.props.length, status: g.status, turns: g.turn, alive: g.living.length, err, ok});
}
console.table(rows);
console.log(bad ? `有 ${bad} 場不對` : '全部正常');
process.exit(bad ? 1 : 0);
