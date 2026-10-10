// 清運案（Alan 2026-10-10）：總部每天一趟保底、去有廢棄物的地方收植入物神經介質、順便撿回遺體；沒人撿的遺體兩天後可能被賣到附近的市鎮
import {Core} from '../core.js';
import * as C from '../cases.js';
const c = new Core(() => {}); c.start('奇美拉-1'); while (c.year < 60) c.stepYear();
const towns = Object.keys(c.sim.peek().markets).map(Number).filter(t => c.sim.peek().owner[t] >= 0);
c.found(towns[0], '甲'); c.advanceTo(30);
const b = c.game.book, w = c.w, A = c.co('甲'), mats = () => JSON.stringify(A.mats);
// 1. 總部每天一趟
let m0 = mats(); console.log('1 總部清運', c.command({type: 'clean', tile: A.base}, '甲') || 'ok', '再跑一次', c.command({type: 'clean', tile: A.base}, '甲'));
c.advanceTo(c.game.h + 7); console.log('  素材', m0, '→', mats()); c.advanceTo(c.game.h + 18); console.log('  隔天', c.command({type: 'clean', tile: A.base}, '甲') || 'ok');
// 2. 打仗留下廢棄物與遺體，清運撿回
const e = c.view('甲').board.find(x => !['front', 'tense', 'camp'].includes(x.kind) && c.game.h >= x.start && c.game.h < x.closeAt);
c.command({type: 'accept', kind: e.kind, tile: e.tile, side: '', uids: A.roster.filter(x => x.alive && x.status === 'home').slice(0, 4).map(x => x.uid)}, '甲');
const cs = b.cases.find(x => A.cases.includes(x.id) && !x.settled && !x.own), sq = b.squads[cs.squads[0]], x1 = sq.clones[0];
const tile = towns.find(t => t !== A.base && C.hdist?.(t, A.base) <= 10) ?? cs.tile;
x1.alive = false; const tk = {id: 'TX1', caseId: cs.id, type: 'raid', title: '測試', tile: cs.tile, objectives: [], squad: sq.id, player: '甲', done: false, enemy: b.tickets.find(t => t.enemy && !t.id.startsWith('TX'))?.enemy};
b.tickets.push(tk); C.settleTicket(b, w, tk, {win: false, done: [], dead: [x1.id], auto: true}, c.game.h); c.advanceTo(c.game.h + 1);
console.log('2 打輸', x1.status, '廢棄物', JSON.stringify(b.waste), '遺體', JSON.stringify(b.bodies));
const site = c.view('甲').data.cleanSites.find(s => s.tile === cs.tile); console.log('  清運點', JSON.stringify(site));
m0 = mats(); console.log('  清運', c.command({type: 'clean', tile: cs.tile}, '甲') || 'ok'); c.advanceTo(c.game.h + 13);
console.log('  回來', x1.status, m0, '→', mats(), A.log.slice(-3).map(x => x.text).join(' / '));
// 3. 沒人撿的遺體被賣到附近的市鎮
const x2 = sq.clones[1]; x2.alive = false; const tk2 = {...tk, id: 'TX2'}; b.tickets.push(tk2); C.settleTicket(b, w, tk2, {win: false, done: [], dead: [x2.id], auto: true}, c.game.h); c.advanceTo(c.game.h + 1);
const bd = b.bodies.find(x => x.uid === x2.uid); for (let i = 0; i < 300 && !bd.sold && bd.at + 168 > c.game.h; i++) c.advanceTo(c.game.h + 1);
console.log('3', bd.sold ? `被賣：從${w.names[bd.from]}到${w.names[bd.tile]}，倒下後 ${c.game.h - bd.at} 小時；那座城的廢棄物 ${Math.round(b.waste[bd.tile] || 0)}` : '7 天內沒被賣（每小時 1.5%，有可能）');
