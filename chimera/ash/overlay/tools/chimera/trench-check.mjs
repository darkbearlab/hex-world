// 戰壕規則：平地直接跳進全身格 → 翻越破綻＋3 層壓制；經過半身格就不會；人在壕溝裡、射擊的人在外面時有掩護
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {suppressionStacks} from '../../src/suppression.js';
const mk = () => new SquadGame({seed: 3, faction: 'rebel', type: 'trench', biome: '旱原', enemy: {units: {trooper: 1}, veh: {}}, squad: [{id: 'A', cls: 'soldier', st: {hp: 100}, lv: 1}]});
let g = mk(), p = g.player; g.enemies.forEach(e => { e.x = 25; e.y = 25; e.hp = 999; });
Object.assign(p, {x: 5, y: 8}); g.reveal();
console.log('（5,7）', g.trenchAt(5, 7), '（5,6）', g.trenchAt(5, 6), '（2,7）', g.trenchAt(2, 7));
g.action('move', [0, -1]); g.action('move', [0, -1]);
console.log('平地→全身：位置', p.x, p.y, '破綻', p.vaultExposed, '壓制', suppressionStacks(p));
g = mk(); p = g.player; g.enemies.forEach(e => { e.x = 25; e.y = 25; e.hp = 999; }); Object.assign(p, {x: 2, y: 8}); g.reveal();
g.action('move', [0, -1]); g.action('move', [0, -1]);
console.log('平地→半身→全身：位置', p.x, p.y, '破綻', p.vaultExposed, '壓制', suppressionStacks(p));
const e = g.enemies[0]; Object.assign(e, {x: 10, y: 6}); const shooter = {x: 10, y: 14};
const c = g.protectingCover(e, shooter), c2 = g.protectingCover(e, {x: 12, y: 6});
console.log('壕溝裡的敵人被外面的人打：掩護', c?.type, c?.trench ? '（戰壕）' : '', '；被同一條壕溝裡的人打：', c2 ? c2.type : '沒有');
