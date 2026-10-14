// 守密者伊歐與最低編制（Alan 2026-10-14）的檢查：node chimera/stats/keeper-check.mjs
import {Core} from '../core.js';
import * as G from '../company.js';
let bad = 0; const ok = (c, msg) => { console.log(`${c ? '✓' : '✗'} ${msg}`); if (!c) bad++; };
const out = [], a = new Core(m => out.push(m)); a.start('奇美拉-1'); while (a.year < 100) a.stepYear();
const K = a.sim.peek(), towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
a.found(towns[0], '甲公司'); a.found(towns[1], '乙公司');
const co = a.co('甲公司'), co2 = a.co('乙公司'), cmd = m => a.command(m, '甲公司'), book = a.game.book;
const io = co.roster.find(c => c.keeper), io2 = co2.roster.find(c => c.keeper);
ok(io && io.callsign === '守密者' && io.cls === 'engineer' && G.donorName(io) === '伊歐', `開張就有守密者伊歐：${io && G.label(io)}`);
ok(io2 && io.id !== io2.id && /^IO-0000\d$/.test(io2.id) && co2.no === co.no + 1, `編號對著玩家流水號：${io.id}、${io2.id}`);
const go = n => a.advanceTo(a.game.h + n);
// 換裝（2026-10-14）：只換外觀，戰場拿到的是那套衣服的圖
ok(cmd({type: 'outfit', uid: io.uid, id: 'combat'}) === null && G.artKey(io) === 'io/combat', `換上戰鬥服（${G.artKey(io)}）`);
ok(cmd({type: 'outfit', uid: io.uid, id: 'bikini'}) !== null, '沒有的衣服不能換');
ok(cmd({type: 'outfit', uid: io.uid, id: 'work'}) === null && G.artKey(io) === 'io' && io.outfit === undefined, '換回維修工作服（預設那套不記）');
const other = co.roster.find(c => !c.keeper); ok(cmd({type: 'outfit', uid: other.uid, id: 'combat'}) !== null, '別人沒有這套衣服');
cmd({type: 'outfit', uid: io.uid, id: 'combat'});
// 倒下＝撤退：遺體不留在戰場，躺回培養槽 24 小時
Object.assign(io, {alive: false, status: 'lost', downAs: 'lost', downAt: a.game.h, downTile: co.base}); (book.bodies ||= []).push({uid: io.uid, co: co.name, tile: co.base, at: a.game.h, value: 30, caseId: null});
go(1);
ok(io.alive && io.status === 'regen' && !book.bodies.some(b => b.uid === io.uid), `倒下後在培養槽休養（${io.status}），遺體沒留在戰場`);
go(G.KEEPER.REGEN_H + 1);
ok(io.status === 'home', `${G.KEEPER.REGEN_H} 小時後回來（${io.status}）`);
const twin = co.roster.find(c => !c.keeper && c.alive);
ok(cmd({type: 'merge', keep: twin.uid, feed: io.uid}) !== null, '守密者不能拿去合成');
// 最低編制：只剩伊歐、沒錢、沒素材
for (const c of co.roster) if (!c.keeper) Object.assign(c, {alive: false, status: 'kia'});
co.cash = 0; for (const m of Object.keys(co.mats)) co.mats[m] = 0;
go(1);
const rations = () => co.roster.filter(c => c.ration && c.alive);
ok(co.relief?.on && rations().length === 1, `最低編制啟動，出了一個配給型（${rations().map(c => G.label(c)).join('')}）`);
go(G.RELIEF.EVERY + 1);
ok(rations().length === 1, `能出擊的已經有 2 人（伊歐＋配給型），不再出（配給型 ${rations().length}）`);
rations()[0].status = 'kia'; rations()[0].alive = false; go(G.RELIEF.EVERY + 1);
ok(rations().length === 1, '配給型倒下，下一輪補一個');
ok(cmd({type: 'opStart', def: 'trial', uids: co.roster.filter(c => c.alive && c.status === 'home').map(c => c.uid)}) === null && co.op?.free, '行動一免費出發');
ok(Object.values(co.mats).every(v => v === 0), '沒有扣素材');
cmd({type: 'opLeave'});
const r = rations()[0]; Object.assign(r, {alive: false, status: 'recovered'});
ok(cmd({type: 'sellbody', uid: r.uid}) !== null, '配給型的遺體不能賣');
co.mats.food = co.mats.water = co.mats.implant = co.mats.neural = 100; go(1);
ok(!co.relief.on, '素材補回來，最低編制結束');
console.log(bad ? `有 ${bad} 項不對` : '全部正常'); process.exit(bad ? 1 : 0);
