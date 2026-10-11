// 戰場大小（Alan 2026-10-11：先做 50×50 的測試場）：每種戶外戰場在 27 和 50 各開幾張，檢查地圖大小、目標點與撤離點走得到、
// 場上與增援的人數；再讓機器人小隊打完，量每回合花多少時間（手機和伺服器的負擔）。最後確認換回 27 的戰鬥不受影響。
// node tools/chimera/size-check.mjs [--seeds 2] [--types probe,assault]
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
import {SIZE} from '../../src/data.js';
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const seeds = +opt('seeds', 2), types = opt('types', 'probe,assault,hold,trench,sabotage,clear,ambush,barricade,pursuit').split(',');
const squad = [['A', 'soldier'], ['B', 'recon'], ['C', 'berserker'], ['D', 'engineer']].map(([id, cls]) => ({id, cls, st: {hp: cls === 'berserker' ? 160 : 100}, lv: 3}));
const D8 = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
function reach(g, from) {
  const N = g.grid.length, seen = new Set([`${from.x},${from.y}`]), q = [from];
  for (let i = 0; i < q.length; i++) { const c = q[i];
    for (const [dx, dy] of D8) { const x = c.x + dx, y = c.y + dy, k = `${x},${y}`; if (x < 0 || y < 0 || x >= N || y >= N || seen.has(k) || g.grid[y][x] !== 1 || !g.canCross(c, {x, y})) continue; seen.add(k); q.push({x, y}); } }
  return seen;
}
const rows = []; let bad = 0;
for (const size of [27, 50]) for (const type of types) for (let seed = 1; seed <= seeds; seed++) {
  const dens = (size / 27) ** 2, units = {trooper: Math.round(8 * dens), trooper_heavy: Math.round(2 * dens), shotgunner: Math.round(2 * dens)};
  const g = new SquadGame({seed, faction: 'loyalist', type, size, biome: '旱原', night: false, enemy: {units, veh: {}, boss: null}, squad});
  const o = g.chimeraOutdoor, R = reach(g, {x: g.player.x, y: g.player.y}), ex = g.exitPoint, pts = g.survival?.points || [];
  const okPts = pts.every(p => R.has(`${p.x},${p.y}`)), okExit = o.goal !== 'exit' && o.goal !== 'plant' || R.has(`${ex.x},${ex.y}`) || D8.some(([dx, dy]) => R.has(`${ex.x + dx},${ex.y + dy}`));
  const onMap = g.enemies.filter(e => e.hp > 0).length, waves = o.waves?.length || 0, sizeOk = g.grid.length === size && SIZE === size;
  const {botFor} = installFullSquad(g, {onError: () => {}});
  const t0 = performance.now(); let n = 0; while (g.status === 'playing' && n++ < 6000) botFor(g.player).step();
  const ms = performance.now() - t0, perTurn = ms / Math.max(1, g.turn);
  const ok = sizeOk && okPts && okExit; if (!ok) bad++;
  rows.push({size, type, seed, grid: g.grid.length, onMap, waves, points: pts.length, reach: okPts && okExit, status: g.status, turns: g.turn, 'ms/回合': +perTurn.toFixed(1), ok}); console.log(JSON.stringify(rows[rows.length - 1]));
}
console.table(rows);
for (const size of [27, 50]) { const R = rows.filter(r => r.size === size); console.log(`${size}×${size}：平均每回合 ${(R.reduce((x, r) => x + r['ms/回合'], 0) / R.length).toFixed(1)} ms，平均 ${(R.reduce((x, r) => x + r.turns, 0) / R.length).toFixed(0)} 回合，勝 ${R.filter(r => r.status === 'won').length}/${R.length}`); }
console.log(bad ? `有 ${bad} 張不對` : '全部正常');
process.exit(bad ? 1 : 0);
