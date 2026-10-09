// 伐木車隊委託的驗證（Alan 2026-10-10）：接單、結案後燃料進城、林子被扣
import {Core} from '../core.js';
const c = new Core(() => {}); c.start('奇美拉-1');
let e; for (let y = 0; y < 400 && !e; y++) { c.stepYear(); if (c.year < 60) continue; const towns = Object.keys(c.sim.peek().markets).map(Number).filter(t => c.sim.peek().owner[t] >= 0);
  if (!c.game) c.found(towns[0], '甲'); c.advanceTo((c.game.h || 0) + 24); e = c.view('甲').board.find(x => x.kind === 'logging' && c.game.h >= x.start && c.game.h < x.closeAt); }
if (!e) { console.log('找不到伐木委託'); process.exit(1); }
const K = c.sim.peek(), S0 = c.sim.exportState(), forest = e.tile;
console.log('委託', e.title, '|', e.detail);
const uids = c.co('甲').roster.filter(x => x.alive && x.status === 'home').slice(0, 4).map(x => x.uid);
console.log('接', c.command({type: 'accept', kind: 'logging', tile: e.tile, side: '', uids}, '甲') || 'ok');
const cs = c.game.book.cases.find(x => x.cargo?.forest === forest && !x.settled); console.log('案件', cs.kind, cs.title, '貨', JSON.stringify(cs.cargo), cs.from, '→', cs.to);
const f0 = K.markets[cs.to].stock.fuel, w0 = c.sim.exportState().timber[forest];
for (const t of c.game.book.tickets.filter(t => t.caseId === cs.id && !t.done)) c.command({type: 'resolve', ticket: t.id}, '甲');
c.advanceTo(cs.end + 2);
for (let i = 0; i < 20 && !cs.settled; i++) { for (const t of c.game.book.tickets.filter(t => t.player === '甲' && !t.done && t.squad)) c.command({type: 'resolve', ticket: t.id}, '甲'); c.advanceTo(c.game.h + 24); }
const K2 = c.sim.peek();
console.log('結案', cs.settled, '送達', cs.delivered ?? '', '城的燃料', f0.toFixed(1), '→', K2.markets[cs.to].stock.fuel.toFixed(1), '林木', (+w0).toFixed(1), '→', (+c.sim.exportState().timber[forest]).toFixed(1));
