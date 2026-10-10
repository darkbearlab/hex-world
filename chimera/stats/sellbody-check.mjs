// 賣遺體（Alan 2026-10-10）：收回的遺體可以賣掉，時價跟最近 7 天的死亡人數走；裝備先放進倉庫
import {Core} from '../core.js';
import * as C from '../cases.js';
import * as G from '../company.js';
const c = new Core(() => {}); c.start('奇美拉-1'); while (c.year < 60) c.stepYear();
const towns = Object.keys(c.sim.peek().markets).map(Number).filter(t => c.sim.peek().owner[t] >= 0);
c.found(towns[0], '甲'); c.advanceTo(30); const A = c.co('甲'), b = c.game.book;
const e = c.view('甲').board.find(x => !['front', 'tense', 'camp'].includes(x.kind) && c.game.h >= x.start && c.game.h < x.closeAt);
c.command({type: 'accept', kind: e.kind, tile: e.tile, side: '', uids: A.roster.slice(0, 4).map(x => x.uid)}, '甲');
const cs = b.cases.find(x => A.cases.includes(x.id) && !x.own), sq = b.squads[cs.squads[0]], [x1, x2] = sq.clones;
const fight = (win, dead) => { for (const x of dead) x.alive = false; const tk = {id: 'TX' + b.nextId++, caseId: cs.id, type: 'raid', title: '測試', tile: cs.tile, objectives: [], squad: sq.id, player: '甲', done: false}; b.tickets.push(tk); C.settleTicket(b, w, tk, {win, done: [], dead: dead.map(x => x.id), auto: true}, c.game.h); c.advanceTo(c.game.h + 1); };
const w = c.w; fight(true, [x1]);
console.log('收回', x1.status, '時價', G.bodyPrice(b, x1, c.game.h), '最近 7 天死亡', G.deaths7(b, c.game.h));
// 多死幾個人，時價應該變低
for (let i = 0; i < 20; i++) b.tickets.push({id: 'D' + i, done: true, doneAt: c.game.h, dead: ['a', 'b']});
const p2 = G.bodyPrice(b, x1, c.game.h); console.log('死了 40 人之後的時價', p2);
const cash0 = b.ledger.filter(x => x.player === '甲' && x.kind === 'body').length, store0 = A.store.length;
console.log('賣', c.command({type: 'sellbody', uid: x1.uid}, '甲') || 'ok', '再賣', c.command({type: 'sellbody', uid: x1.uid}, '甲'), '活人不能賣', c.command({type: 'sellbody', uid: x2.uid}, '甲'));
c.advanceTo(c.game.h + 1);
console.log('狀態', x1.status, '入帳', b.ledger.filter(x => x.player === '甲' && x.kind === 'body').map(x => x.amount).join(','), '倉庫', store0, '→', A.store.length, '紀錄', x1.record.at(-1).t, '報表', A.flows.filter(f => f.kind === 'body').length);
