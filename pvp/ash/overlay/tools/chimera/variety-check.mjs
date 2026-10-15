// 服務單的多樣性（Alan 2026-10-11）：新戰場的地圖尋路——拆路障、排炸彈的每個點走得到、一開場不能撤離；
// 撤離追兵、突破封鎖線走得到撤離點；拋錨守車有據點。另外把每一種都推到結束（點全部推完就贏）。實際打法 Alan 自己測。
// node tools/chimera/variety-check.mjs
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
for (const type of ['barricade', 'ied', 'breakdown', 'patrol', 'checkpoint', 'pursuit', 'cordon']) for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const g = new SquadGame({seed, faction: 'loyalist', type, biome: ['旱原', '鹽沼', '油棘林', '寒漠'][seed % 4], night: false, intro: '測試情境', enemy: {units: {trooper: 22}, veh: {}, boss: null}, squad});
  const o = g.chimeraOutdoor, S = g.survival, R = reach(g, {x: g.player.x, y: g.player.y}), ex = g.exitPoint;
  const pts = S?.points || [], okPts = pts.filter(p => R.has(`${p.x},${p.y}`)).length;
  const okExit = R.has(`${ex.x},${ex.y}`) || D8.some(([dx, dy]) => R.has(`${ex.x + dx},${ex.y + dy}`));
  const intro = g.logs.some(l => (l.text || l) === '測試情境' || JSON.stringify(l).includes('測試情境'));
  let ok = intro, note = '';
  if (o.clear) {   // 拆路障、排炸彈：三個點、走得到、不能撤離；把點推完就贏
    const blocked = !g.descend(); ok &&= pts.length === 3 && okPts === 3 && blocked;
    for (const pt of S.points) pt.hp = 0; g.chimeraPoints(o); ok &&= g.status === 'won'; note = `${pts.length} 點、撤離${blocked ? '擋下' : '沒擋'}、推完 ${g.status}`;
  } else if (o.goal === 'exit') { ok &&= okExit; note = `撤離點${okExit ? '走得到' : '走不到'}・場上 ${g.enemies.length}・後面 ${o.waves?.length || 0}`; }
  else if (type === 'breakdown') { ok &&= o.goal === 'hold' && pts.length > 0; note = `據點 ${pts.length}`; }
  else { ok &&= o.goal === 'kill'; note = o.goal; }
  if (type === 'pursuit') { const N = g.grid.length, south = g.enemies.filter(e => e.y > N / 2).length; ok &&= o.waveFrom === 'south' && south >= g.enemies.length / 2; note += `・在南邊 ${south}`; }
  if (!ok) bad++;
  rows.push({type, seed, layout: o.layout, goal: o.goal, note, intro, ok});
}
console.table(rows.filter(r => !r.ok).length ? rows.filter(r => !r.ok) : rows.filter(r => r.seed === 1));
console.log(bad ? `有 ${bad} 張地圖不對` : `全部 ${rows.length} 張地圖都對`);
process.exit(bad ? 1 : 0);
