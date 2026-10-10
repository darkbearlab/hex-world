// 格子收集與合成（Alan 2026-10-10）：抽格子、保底、等級、合成（同一位原主才行、留主體、裝備進倉庫）、舊存檔的等級換成格子
import {Core} from '../core.js';
import * as C from '../cases.js';
import {donorName} from '../company.js';
// 1. 填滿 100 格平均要抽幾次（有保底 vs 沒保底）
let s = 7; const r = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };   // mulberry32
const fill = pity => { const c = {}; let n = 0; const P = C.CELL_PITY; while (C.cellCount(c) < 100 && n < 5000) { if (!pity) c.dup = 0; C.drawCells(c, 1, r); n++; } return n; };
const avg = (f, k = 200) => Math.round(Array.from({length: k}, f).reduce((a, b) => a + b, 0) / k);
console.log('1 填滿 100 格平均抽', avg(() => fill(true)), '次（保底 4）；沒保底', avg(() => fill(false)), '次');
const at = n => { const c = {}; C.drawCells(c, n, r); return C.cellCount(c); };
console.log('  抽 30 次平均', avg(() => at(30)), '格；60 次', avg(() => at(60)), '；150 次', avg(() => at(150)));
// 2. 實際打：積分換格子、升級
const g = new Core(() => {}); g.start('奇美拉-1'); while (g.year < 60) g.stepYear();
const towns = Object.keys(g.sim.peek().markets).map(Number).filter(t => g.sim.peek().owner[t] >= 0);
g.found(towns[0], '甲'); g.advanceTo(30); const A = g.co('甲');
for (let k = 0; k < 8; k++) {
  const e = g.view('甲').board.find(x => !['front', 'tense', 'camp'].includes(x.kind) && g.game.h >= x.start && g.game.h < x.closeAt && !x.joined);
  const home = A.roster.filter(x => x.alive && x.status === 'home'); if (e && home.length >= 2) g.command({type: 'accept', kind: e.kind, tile: e.tile, side: '', uids: home.slice(0, 4).map(x => x.uid)}, '甲');
  for (let h = 0; h < 48; h++) { for (const t of g.game.book.tickets.filter(t => t.player === '甲' && !t.done && t.squad)) g.command({type: 'resolve', ticket: t.id}, '甲'); g.advanceTo(g.game.h + 1); }
}
console.log('2 打了 16 天', A.roster.map(x => `${donorName(x)}${x.id.slice(-2)} ${x.lv}級/${C.cellCount(x)}格${x.alive ? '' : '(' + x.status + ')'}`).join('、'), '服務單積分', g.game.book.tickets.filter(t => t.player === '甲' && t.done).map(t => t.pts).join(','));
console.log('  等級＝1＋格子/10', A.roster.every(x => x.lv === C.cellLevel(x)));
// 3. 合成
const by = {}; for (const x of A.roster.filter(x => x.alive && x.status === 'home')) (by[x.donor] ||= []).push(x);
const pair = Object.values(by).find(L => L.length >= 2), other = A.roster.find(x => x.alive && x.status === 'home' && pair && x.donor !== pair[0].donor);
if (pair) {
  const [K, F] = pair, n0 = C.cellCount(K), nF = C.cellCount(F), st0 = JSON.stringify(K.st), store0 = A.store.length;
  if (other) console.log('3 不同原主', g.command({type: 'merge', keep: K.uid, feed: other.uid}, '甲'));
  console.log('  合成', donorName(K), K.id, '吃', F.id, g.command({type: 'merge', keep: K.uid, feed: F.uid}, '甲') || 'ok', `格子 ${n0}+${nF} → ${C.cellCount(K)}`, '個體值沒變', JSON.stringify(K.st) === st0, '被吃的不在了', !A.roster.includes(F), '倉庫', store0, '→', A.store.length, '紀錄', K.record.at(-1).t);
} else console.log('3 這次沒有同原主的兩個人在家（跳過）');
// 4. 舊存檔：原本 5 級的人換成 40 格
const S = JSON.parse(JSON.stringify(g.save())); const co = S.game.cos['甲']; for (const x of co.roster) { delete x.cells; x.lv = 5; }
const b = new Core(() => {}); b.load('奇美拉-1', S); const L = b.co('甲').roster.filter(x => x.alive);
console.log('4 舊存檔 5 級 →', [...new Set(L.map(x => `${x.lv}級/${C.cellCount(x)}格`))].join('、'));
