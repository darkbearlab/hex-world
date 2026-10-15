// 目標點＋撤離（Alan 2026-10-11：破壞任務通用）：檢查地圖尋路——從出發點走得到每個目標點和撤離點（照 ASH 的移動規則，不算敵人擋路）；
// 一開場撤離會被擋下（炸藥還沒裝完）。實際打法 Alan 自己測。
// node tools/chimera/plant-check.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
const squad = [{id: 'A', cls: 'soldier', st: {hp: 100}, lv: 3}];
const D8 = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
function reach(g, from) {
  const N = g.grid.length, seen = new Set([`${from.x},${from.y}`]), q = [from];
  for (let i = 0; i < q.length; i++) { const c = q[i];
    for (const [dx, dy] of D8) { const x = c.x + dx, y = c.y + dy, k = `${x},${y}`; if (x < 0 || y < 0 || x >= N || y >= N || seen.has(k) || g.grid[y][x] !== 1 || !g.canCross(c, {x, y})) continue; seen.add(k); q.push({x, y}); } }
  return seen;
}
const rows = []; let bad = 0;
for (const type of ['sabotage', 'demo', 'well', 'armory', 'heist']) for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
  const g = new SquadGame({seed, faction: 'loyalist', type, biome: ['旱原', '鹽沼', '油棘林', '寒漠'][seed % 4], night: true, enemy: {units: {trooper: 4}, veh: {}, boss: null}, squad});
  const S = g.survival, R = reach(g, {x: g.player.x, y: g.player.y}), ex = g.exitPoint;
  const pts = S?.points || [], okPts = pts.filter(p => R.has(`${p.x},${p.y}`)).length;
  const okExit = R.has(`${ex.x},${ex.y}`) || D8.some(([dx, dy]) => R.has(`${ex.x + dx},${ex.y + dy}`));
  const blocked = !g.descend();
  const ok = g.chimeraOutdoor.goal === 'plant' && pts.length > 0 && okPts === pts.length && okExit && blocked;
  if (!ok) bad++;
  rows.push({type, seed, points: pts.length, reachable: okPts, exitReachable: okExit, exitBlockedAtStart: blocked, ok});
}
console.table(rows.filter(r => !r.ok).length ? rows.filter(r => !r.ok) : rows.slice(0, 5));
console.log(bad ? `有 ${bad} 張地圖不通` : `全部 ${rows.length} 張地圖都走得到每個目標點和撤離點`);
process.exit(bad ? 1 : 0);
