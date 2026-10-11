// 戰場回收（Alan 2026-10-11）：打贏時 missionResult.loot 列出地上留下的槍、補給、彈藥
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
const squad = [['A', 'soldier'], ['B', 'recon'], ['C', 'bulwark'], ['D', 'berserker']].map(([id, cls]) => ({id, cls, st: {hp: 100}, lv: 3}));
for (const [type, seed] of [['assault', 2], ['probe', 5], ['clear', 9]]) {
  const g = new SquadGame({seed, faction: 'loyalist', type, biome: '旱原', night: false, enemy: {units: {trooper: 6, trooper_heavy: 3}, veh: {}, boss: null}, squad});
  const {botFor} = installFullSquad(g); let k = 0; while (g.status === 'playing' && k++ < 4000) botFor(g.player).step();
  console.log(type, g.status, JSON.stringify(g.missionResult.loot));
}
