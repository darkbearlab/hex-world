// 增援波次（大戰役的大規模服務單）：40 名敵人的突擊、守點、戰壕、巡邏——場上最多 ON_MAP 名，其餘從邊緣一波波進來；
// 清光要連排隊的都打完；機器人打得完（或撐到守點的回合數）。node tools/chimera/wave-check.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
import {ON_MAP} from '../../src/chimera-mission.js';
import {isNoncombatant} from '../../src/enemy-data.js';
const squad = [['A', 'soldier'], ['B', 'recon'], ['C', 'bulwark'], ['D', 'berserker']].map(([id, cls]) => ({id, cls, st: {hp: cls === 'berserker' ? 160 : 100}, lv: 6}));
let bad = 0; const fail = m => { bad++; console.log('✗', m); }, rows = [];
for (const type of ['assault', 'hold', 'trench', 'probe']) for (const seed of [3, 9]) {
  const g = new SquadGame({seed, faction: 'loyalist', type, biome: '旱原', night: false, enemy: {units: {trooper: 30, trooper_heavy: 10}, veh: {}, boss: null}, squad});
  const o = g.chimeraOutdoor, q0 = o.waves?.length || 0;
  if (g.enemies.length > ON_MAP) fail(`${type} 場上 ${g.enemies.length} > ${ON_MAP}`);
  if (g.enemies.length + q0 !== 40) fail(`${type} 總數 ${g.enemies.length + q0}`);
  let peak = 0; const {botFor} = installFullSquad(g); let k = 0, err = '';
  try { while (g.status === 'playing' && k++ < 6000) { botFor(g.player).step(); peak = Math.max(peak, g.enemies.filter(e => e.hp > 0).length); } } catch (e) { err = String(e.stack || e).slice(0, 200); }
  if (err) fail(err);
  const left = g.enemies.filter(e => e.hp > 0 && !isNoncombatant(e)).length, waves = o.waves?.length || 0;
  if (g.status === 'won' && o.goal === 'kill' && (left || waves)) fail(`${type} 還有敵人就贏了 ${left}+${waves}`);
  rows.push({type, seed, layout: o.layout, onMap0: 40 - q0, queued0: q0, peak, spawned: g.enemies.length, left, waves, status: g.status, turns: g.turn, alive: g.living.length, kills: g.missionResult.kills});
}
console.table(rows);
console.log(bad ? `有 ${bad} 項不對` : '全部正常');
process.exit(bad ? 1 : 0);
