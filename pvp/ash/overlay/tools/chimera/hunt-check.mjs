// 狩獵場（Alan 2026-10-11）：舊時代設施的多層地圖、蟲族、越深越強；每一層各打一場（機器人），看地圖與撤離點
// node tools/chimera/hunt-check.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
const squad = [['A', 'soldier'], ['B', 'recon'], ['C', 'bulwark'], ['D', 'berserker']].map(([id, cls]) => ({id, cls, st: {hp: 100}, lv: 3}));
const rows = [];
for (const seed of [3, 5, 8]) { const floor = 3;
  const n = 4 + 2 * floor, g = new SquadGame({seed, faction: 'swarm', type: 'hunting', facility: true, floors: 3, depth: 2, biome: '', night: false, enemy: {units: {infected: Math.ceil(n / 2), larva: Math.floor(n / 2)}, veh: {}, boss: floor >= 3 ? {ash: 'hive_beast', name: '巢母'} : null}, squad});
  const {botFor} = installFullSquad(g); let k = 0, err = '';
  let deeper = 0, hp0 = 0;
  try { while (g.status === 'playing' && k++ < 8000) { if (g.chimeraAtExit) { hp0 = g.living.reduce((x, m) => x + m.hp, 0); g.action('chimeraDeeper'); deeper++; if (g.living.reduce((x, m) => x + m.hp, 0) > hp0) err = '往下一層時狀態恢復了'; continue; } botFor(g.player).step(); } } catch (e) { err = String(e.message || e).slice(0, 80); }
  rows.push({seed, deeper, reached: g.floor, floorsResult: g.missionResult.floors, enemiesLast: g.enemies.length, elites: g.enemies.filter(e => e.elite).length, status: g.status, turns: g.turn, alive: g.living.length, err});
}
console.table(rows);
