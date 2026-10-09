// 裝備帶進戰鬥的驗證：照 c.gear 配給 ASH（槍、詞條、近戰、裝甲板、預備品），打完回報身上剩的
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
import {WEAPONS} from '../../src/data.js';
const gear = {guns: [{kind: 'gun', base: 'sniper', affix: 'powerful'}, {kind: 'gun', base: 'rifle', affix: 'homemade'}, null], melee: {kind: 'melee', base: 'sabre'}, armor: {kind: 'armor', base: 'heavy'}, kits: [{kind: 'kit', base: 'meds', n: 3}, {kind: 'kit', base: 'stun', n: 2}]};
const squad = [{id: 'A', cls: 'soldier', st: {hp: 100}, lv: 3, gear}, {id: 'B', cls: 'berserker', st: {hp: 160}, lv: 1, gear: {guns: [{kind: 'gun', base: 'shotgun', affix: 'homemade'}, null, null], melee: null, armor: null, kits: [{kind: 'kit', base: 'grenades', n: 2}, null]}}];
const g = new SquadGame({seed: 11, faction: 'rebel', enemy: {units: {raider: 4}, veh: {}}, squad}); installFullSquad(g);
for (const m of g.members) console.log(m.squadId, m.character, 'owned', m.owned.map(s => `${WEAPONS[m.weaponBases[s]].id}${m.affixes[s] ? '(' + m.affixes[s] + ')' : ''}`).join(','), 'melee', m.meleeSlot != null ? WEAPONS[m.weaponBases[m.meleeSlot]].id : '-', 'plates', m.plates, 'meds', m.meds, 'grenades', m.grenades, 'stun', m.stun);
const {botFor} = installFullSquad(g); let n = 0; while (g.status === 'playing' && n++ < 3000) botFor(g.player).step();
console.log('結果', g.status, JSON.stringify(g.missionResult.progress.A.gear), JSON.stringify(g.missionResult.progress.B.gear));
