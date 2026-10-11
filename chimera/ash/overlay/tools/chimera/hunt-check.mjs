// 狩獵場（Alan 2026-10-11）：舊時代設施的多層地圖、蟲族、越深越強；每一層各打一場（機器人），看地圖與撤離點
// node tools/chimera/hunt-check.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
const squad = [['A', 'soldier'], ['B', 'recon'], ['C', 'bulwark'], ['D', 'berserker']].map(([id, cls]) => ({id, cls, st: {hp: 100}, lv: 3}));
const rows = [];
for (const [floor, seed] of [[1, 3], [2, 5], [3, 8]]) {
  const n = 4 + 2 * floor, g = new SquadGame({seed, faction: 'swarm', type: 'hunting', facility: true, floor, biome: '', night: false, enemy: {units: {infected: Math.ceil(n / 2), larva: Math.floor(n / 2)}, veh: {}, boss: floor >= 3 ? {ash: 'hive_beast', name: '巢母'} : null}, squad});
  const {botFor} = installFullSquad(g); let k = 0, err = '';
  try { while (g.status === 'playing' && k++ < 5000) botFor(g.player).step(); } catch (e) { err = String(e.message || e).slice(0, 80); }
  rows.push({floor, seed, enemies: g.enemies.length, exit: !!g.exitPoint, status: g.status, turns: g.turn, alive: g.living.length, err});
}
console.table(rows);
