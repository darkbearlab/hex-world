// 公路戰的車（Alan 2026-10-11）：開場由遠而近、並排時前後飄移、車上有人就不走；印出每一回合每台車的狀態
// node tools/chimera/convoy-trace.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
import {onVehicle} from '../../src/chimera-highway.js';
const squad = [['A', 'soldier'], ['B', 'recon'], ['C', 'bulwark'], ['D', 'berserker']].map(([id, cls]) => ({id, cls, st: {hp: 100}, lv: 3}));
for (const seed of [2, 6]) {
  const g = new SquadGame({seed, faction: 'rebel', type: 'ambush', biome: '旱原', night: false, enemy: {units: {raider: 10, gunner: 4}, veh: {}, boss: null}, squad});
  const o = g.chimeraOutdoor, {botFor} = installFullSquad(g); let k = 0, last = -1, bad = 0; const trace = [];
  const snap = () => o.trucks.filter(v => v.state !== 'ours').map(v => `${v.kind[0]}${v.id}:${v.state[0]}@${v.x0}(${g.enemies.filter(e => e.hp > 0 && onVehicle(v, e.x, e.y)).length + (v.crew?.length || 0)})`).join(' ');
  trace.push(`開場 ${snap()}`);
  while (g.status === 'playing' && k++ < 4000) { botFor(g.player).step(); if (g.turn !== last) { last = g.turn; for (const v of o.trucks) if (v.state === 'leave' && g.enemies.some(e => e.hp > 0 && onVehicle(v, e.x, e.y)) && !v.flagged) { v.flagged = 1; bad++; } if (g.turn <= 12 || g.turn % 6 === 0) trace.push(`第${g.turn}回合 ${snap()}`); } }
  console.log(`種子 ${seed}：${g.status}・${g.turn} 回合・載著活人離開的車 ${bad} 台`); for (const t of trace.slice(0, 16)) console.log('  ' + t);
}
