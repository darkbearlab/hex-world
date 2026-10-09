// 合約到期就啟程返回（Alan 2026-10-10）：案期一過、自己的服務單打完，人就開始走回總部，不等結案
import {Core} from '../core.js';
const c = new Core(() => {}); c.start('奇美拉-1'); while (c.year < 60) c.stepYear();
const K = c.sim.peek(), towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
c.found(towns[0], '甲'); c.advanceTo(30);
const e = c.view('甲').board.find(x => x.kind !== 'front' && x.kind !== 'tense' && x.kind !== 'camp' && c.game.h >= x.start && c.game.h < x.closeAt);
const G = c.co('甲'), uids = G.roster.filter(x => x.alive && x.status === 'home').slice(0, 4).map(x => x.uid);
console.log('接', e.title, c.command({type: 'accept', kind: e.kind, tile: e.tile, side: '', uids}, '甲') || 'ok');
const cs = c.game.book.cases.find(x => G.cases.includes(x.id) && !x.settled);
const st = () => uids.map(u => G.roster.find(x => x.uid === u)).map(x => x.alive ? x.status : 'kia').join(',');
let left = null;
for (let h = c.game.h; h < cs.end + 80; h++) {
  for (const t of c.game.book.tickets.filter(t => t.player === '甲' && !t.done && t.squad)) c.command({type: 'resolve', ticket: t.id}, '甲');
  c.advanceTo(h + 1);
  if (left === null && /returning/.test(st())) { left = c.game.h; console.log('啟程', left, '案期結束', cs.end, '結算了嗎', cs.settled, st()); }
}
console.log('結算時刻', cs.settledAt, '名冊', st()); console.log(G.log.slice(-4).map(x => x.h + ' ' + x.text).join('\n'));
