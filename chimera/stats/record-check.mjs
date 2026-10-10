// 資料主人與服役紀錄（Alan 2026-10-10）：職業綁原主、出槽／案件／陣亡都記進每個人的履歷
import {Core} from '../core.js';
import {DONORS, donorName} from '../company.js';
const c = new Core(() => {}); c.start('奇美拉-1'); while (c.year < 60) c.stepYear();
const towns = Object.keys(c.sim.peek().markets).map(Number).filter(t => c.sim.peek().owner[t] >= 0);
c.found(towns[0], '甲'); c.advanceTo(30); const G = c.co('甲');
console.log('開局', G.roster.map(x => `${donorName(x)}(${x.cls})`).join('、'), '職業對得上', G.roster.every(x => DONORS[x.portrait].cls === x.cls));
let cnt = 0;
for (let k = 0; k < 14; k++) {
  const e = c.view('甲').board.find(x => !['front', 'tense', 'camp'].includes(x.kind) && c.game.h >= x.start && c.game.h < x.closeAt && !x.joined && (k < 6 || x.lv >= 2));
  const home = G.roster.filter(x => x.alive && x.status === 'home'); if (e && home.length >= 2) c.command({type: 'accept', kind: e.kind, tile: e.tile, side: '', uids: home.slice(0, k < 6 ? 4 : 2).map(x => x.uid)}, '甲');
  for (let h = 0; h < 48; h++) { for (const t of c.game.book.tickets.filter(t => t.player === '甲' && !t.done && t.squad)) c.command({type: 'resolve', ticket: t.id}, '甲'); c.advanceTo(c.game.h + 1); }
}
for (const x of G.roster.filter(x => x.record.length > 1).slice(0, 3)) console.log(`${donorName(x)} ${x.id}${x.alive ? '' : '（陣亡）'}：` + x.record.map(e => e.t === 'case' ? `[${e.title} ${e.fights}戰${e.wins}勝${e.end != null ? ' 尾款' + e.payout : ''}]` : `[${e.t}${e.title ? ' ' + e.title : ''}]`).join(' '));
const v = c.view('甲').data.roster[0]; console.log('畫面', v.name, v.record.map(e => e.place).join('/'));
console.log('陣亡有紀錄', G.roster.filter(x => !x.alive).every(x => x.record.some(e => e.t === 'down' || e.t === 'kia')), '陣亡', G.roster.filter(x => !x.alive).length);
console.log('倒下的狀態', G.roster.filter(x => !x.alive).map(x => x.status + ':' + x.record.at(-1).t).join(' '))
