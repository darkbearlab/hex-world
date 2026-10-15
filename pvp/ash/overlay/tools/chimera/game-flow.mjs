// 整個遊戲接起來的檢查（Alan 2026-10-09：都接進遊戲內）：核心（沙盒＋帳本＋公司）開出真的服務單 → 親自打送出的任務資料 →
// 在 ASH 裡開戰（公路戰、新的敵人兵種）→ 機器人打完 → 戰果交回核心結算。路線案件、勢力戰各試幾張。
// node tools/chimera/game-flow.mjs [種子]
import '../clear-bot/lang-default.mjs';
import {Core} from '../../../../core.js';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
import {pendingCrew} from '../../src/chimera-highway.js';
const seed = process.argv[2] || '奇美拉-1';
let mission = null;
const c = new Core(m => { if (m.type === 'mission') mission = m.data; }); c.start(seed); while (c.year < 60) c.stepYear();
const K = c.sim.peek(), town = Object.keys(K.markets).map(Number).find(t => K.owner[t] >= 0);
c.found(town, '測試'); const G = c.co('測試');
let accepted = 0; const why = {};
c.advanceTo(30);
const H = () => c.game.book.t ?? 30, board = () => c.game.book.board || {};
const tryAccept = () => { for (const o of c.sim.opportunities()) {
  const e = board()[o.kind + ':' + o.tile]; if (!e || e.gone || H() < e.start || H() >= e.end - 24) continue; const uids = G.roster.filter(x => x.alive && x.status === 'home').slice(0, 4).map(x => x.uid); if (uids.length < 2) break; const r = c.command({type: 'accept', kind: o.kind, tile: o.tile, side: o.sides?.[0] ?? '', uids}, '測試'); if (!r) accepted++; else why[r] = (why[r] || 0) + 1; } };
tryAccept();
console.log('接案', accepted, JSON.stringify(why));
const rows = []; let bad = 0, h = 31;
for (let n = 0; n < 10 && h < 1500; ) {
  c.advanceTo(h++); if (h % 24 === 0) tryAccept();
  const tk = c.game.book.tickets.find(t => t.player === '測試' && !t.done && t.squad); if (!tk) continue;
  mission = null; const err = c.command({type: 'fight', ticket: tk.id}, '測試'); if (err || !mission) { c.command({type: 'resolve', ticket: tk.id}, '測試'); continue; }
  n++;
  let g, e = '', k = 0;
  try { g = new SquadGame(mission); const {botFor} = installFullSquad(g); while (g.status === 'playing' && k++ < 4000) botFor(g.player).step(); } catch (x) { e = String(x.stack || x).slice(0, 300); }
  const r = g?.missionResult, o = g?.chimeraOutdoor;
  const names = [...new Set((mission.enemy.roster || []).map(u => u.name))].join('、');
  const before = c.game.book.tickets.find(t => t.id === tk.id);
  const se = e ? 'battle' : c.command({type: 'submit', ticket: tk.id, result: r}, '測試');
  const done = c.game.book.tickets.find(t => t.id === tk.id)?.done;
  if (e || se || !done) { bad++; console.log('✗', tk.type, e || se || '沒有結算'); }
  rows.push({type: tk.type, side: mission.enemy.side, faction: mission.faction, layout: o?.layout, enemies: (mission.enemy.roster || []).length, onMap: g?.enemies.length, pending: o?.layout === 'highway' ? pendingCrew(o) : 0, boss: mission.enemy.boss?.weapon || mission.enemy.boss?.name || '', status: g?.status, turns: g?.turn, dead: r?.dead.length, settled: !!done, names: names.slice(0, 40)});
  void before;
}
console.table(rows);
console.log(`接了 ${accepted} 個案子；${bad ? `有 ${bad} 場不對` : '全部打完並結算'}`);
process.exit(bad || !rows.length ? 1 : 0);
