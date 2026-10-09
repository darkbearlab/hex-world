// 委託板的驗證：公開時刻錯開、兩家公司接同一個委託共用一個案件、晚接的案期照公開時刻算、截止後不能接、結案各分尾款
// node chimera/stats/board-check.mjs
import {Core} from '../core.js';
const c = new Core(() => {}); c.start('奇美拉-1'); while (c.year < 60) c.stepYear();
const K = c.sim.peek(), towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
c.found(towns[0], '甲'); c.found(towns[5], '乙');
let t0 = performance.now(); c.advanceTo(1); console.log('第一小時（含公開委託）', Math.round(performance.now() - t0), 'ms');
const B = c.game.book.board, E = Object.values(B);
console.log('板上委託', E.length, '公開時刻分布', [...new Set(E.map(e => e.start))].sort((a, b) => a - b).join(','));
c.advanceTo(30);
const v = c.view('甲').board; console.log('甲看得到', v.length, '個；第一個', v[0]?.title, '公開', v[0]?.start, '截止', v[0]?.closeAt);
const pick = v.find(e => e.kind !== 'front' && e.kind !== 'tense'), uids = n => c.co(n).roster.filter(x => x.alive && x.status === 'home').slice(0, 4).map(x => x.uid);
console.log('甲接', c.command({type: 'accept', kind: pick.kind, tile: pick.tile, side: '', uids: uids('甲')}, '甲') || 'ok');
c.advanceTo(40);
console.log('乙接', c.command({type: 'accept', kind: pick.kind, tile: pick.tile, side: '', uids: uids('乙')}, '乙') || 'ok');
const e = B[pick.key], cs = c.game.book.cases.find(x => x.id === e.cases['']);
console.log('共用案件', cs.id, '案期', cs.start, '→', cs.end, '（委託', e.start, '→', e.end, '）小隊', cs.squads.map(s => c.game.book.squads[s].player).join('、'));
console.log('甲再接', c.command({type: 'accept', kind: pick.kind, tile: pick.tile, side: '', uids: uids('甲')}, '甲'));
c.advanceTo(e.end - 23);
console.log('截止後', c.command({type: 'accept', kind: pick.kind, tile: pick.tile, side: '', uids: uids('甲')}, '甲'));
t0 = performance.now(); c.advanceTo(e.end + 60); console.log('推到結案', Math.round(performance.now() - t0), 'ms');
console.log('結案', cs.settled, '積分', JSON.stringify(cs.score), '尾款', JSON.stringify(cs.payout));
const up = c.game.book.ledger.filter(x => x.kind === 'upkeep' && x.caseId === cs.id).map(x => `${x.player} ${x.amount}`); console.log('維持費', up.join('、'));
console.log('冷卻後再公開', B[pick.key] ? `${B[pick.key].start}→${B[pick.key].end}` : '不在了');
