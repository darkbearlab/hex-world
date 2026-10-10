// 回收（Alan 2026-10-10）：打贏當場收回、重新培養；打輸遺體進沙盒、物歸原主沖回損失、別家撿到易主、7 天確認戰死
import {Core} from '../core.js';
import * as C from '../cases.js';
import {donorName} from '../company.js';
const c = new Core(() => {}); c.start('奇美拉-1'); while (c.year < 60) c.stepYear();
const towns = Object.keys(c.sim.peek().markets).map(Number).filter(t => c.sim.peek().owner[t] >= 0);
c.found(towns[0], '甲'); c.found(towns[1], '乙'); c.advanceTo(30);
const b = c.game.book, w = c.w, A = c.co('甲'), B = c.co('乙');
const take = (n, who) => { const e = c.view(who).board.find(x => !['front', 'tense', 'camp'].includes(x.kind) && c.game.h >= x.start && c.game.h < x.closeAt && !x.joined); const G = c.co(who);
  const r = c.command({type: 'accept', kind: e.kind, tile: e.tile, side: '', uids: G.roster.filter(x => x.alive && x.status === 'home').slice(0, n).map(x => x.uid)}, who); if (r) throw r;
  const cs = b.cases.find(x => G.cases.includes(x.id) && !x.settled && x.squads.some(s => b.squads[s].player === who && b.squads[s].clones.some(q => q.alive))); return {cs, sq: b.squads[cs.squads.find(s => b.squads[s].player === who)]}; };
const fake = (cs, sq, tile) => ({id: 'TX' + b.nextId++, caseId: cs.id, type: 'raid', title: '測試戰鬥', tile, objectives: [], squad: sq.id, player: sq.player, done: false});
const loss = n => b.ledger.filter(x => x.player === n && x.kind === 'loss').reduce((s, x) => s + x.amount, 0);
const fight = (cs, sq, tile, win, dead) => { for (const x of dead) x.alive = false; const tk = fake(cs, sq, tile); b.tickets.push(tk); C.settleTicket(b, w, tk, {win, done: [], dead: dead.map(x => x.id), auto: true}, c.game.h); c.advanceTo(c.game.h + 1); };
const nm = x => `${donorName(x)} ${x.id}`;
// 1. 打贏有人倒下：當場收回，不算損失；重新培養
let {cs, sq} = take(4, '甲'); const s2 = take(4, '乙'); const [x1, x2, x3, x4] = sq.clones.slice(), L0 = loss('甲');
fight(cs, sq, cs.tile, true, [x1]);
console.log('1 打贏倒下', nm(x1), x1.status, '損失', loss('甲') - L0);
x1.lv = 4; x1.skills = ['anchor'];
console.log('  重新培養', c.command({type: 'revive', uid: x1.uid}, '甲') || 'ok'); c.advanceTo(c.game.h + 2);
const q = A.queue.find(q => q.ready && q.revive === x1.uid); console.log('  簽收', q ? c.command({type: 'claim', slot: q.slot}, '甲') || 'ok' : '沒好');
console.log('  回到名冊', x1.alive, '已離開舊小隊', !sq.clones.includes(x1), x1.status, '等級', x1.lv, '技能', x1.skills.length, '同一個 uid', A.roster.filter(x => x.uid === x1.uid).length === 1, '紀錄', x1.record.map(e => e.t).join('>'));
// 2. 打輸：遺體進沙盒、算損失；自己人在旁邊打贏撿回、沖回
const L1 = loss('甲'); fight(cs, sq, cs.tile, false, [x2]);
console.log('2 打輸倒下', nm(x2), x2.status, '損失', loss('甲') - L1, '沙盒遺體', (b.bodies || []).length);
fight(cs, sq, cs.tile, true, []); console.log('  撿回', x2.status, '損失沖回後', loss('甲') - L1, '紀錄', x2.record.map(e => e.t).join('>'));
// 3. 打輸、別家（乙）在附近打贏：易主
 fight(cs, sq, cs.tile, false, [x3]);
fight(s2.cs, s2.sq, cs.tile, true, []);
const ghost = A.roster.find(x => x.uid === -x3.uid), mine = B.roster.includes(x3);
console.log('3 易主', '甲那邊', ghost?.status, '乙那邊', mine ? x3.status : '沒有', '甲的通知', A.log.at(-1).text.slice(0, 30), '紀錄', x3.record.map(e => e.t).join('>'));
// 4. 打輸、沒人撿：7 天確認戰死
 fight(cs, sq, 999999, false, [x4]); c.advanceTo(c.game.h + 169);
console.log('4 逾時', x4.status, '紀錄', x4.record.map(e => e.t).join('>'), 'x4 還在沙盒', (b.bodies || []).some(e => e.uid === x4.uid));
const all = Object.values(c.game.cos).flatMap(g => g.roster.map(x => x.uid)); console.log('撞號', all.length - new Set(all).size);
