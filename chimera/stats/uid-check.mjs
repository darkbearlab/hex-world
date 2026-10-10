// 複製人編號是全星球流水號（Alan 2026-10-10）：新開的公司不撞號；舊存檔（每家各自數）讀回來重新發號，小隊、歸途、新出槽都接得上
import {Core} from '../core.js';
const a = new Core(() => {}); a.start('奇美拉-1'); while (a.year < 60) a.stepYear();
const towns = Object.keys(a.sim.peek().markets).map(Number).filter(t => a.sim.peek().owner[t] >= 0);
a.found(towns[0], '甲'); a.found(towns[3], '乙'); a.advanceTo(30);
const uids = core => Object.values(core.game.cos).flatMap(g => g.roster.map(c => c.uid));
const dup = L => L.length - new Set(L).size;
console.log('新世界', uids(a).join(','), '撞號', dup(uids(a)), '下一號', a.game.book.cloneSeq, '顯示', a.co('乙').roster[0].id);
// 派一隊出去，讓小隊裡有人
const e = a.view('甲').board.find(x => !['front', 'tense', 'camp'].includes(x.kind) && a.game.h >= x.start && a.game.h < x.closeAt);
a.command({type: 'accept', kind: e.kind, tile: e.tile, side: '', uids: a.co('甲').roster.slice(0, 4).map(c => c.uid)}, '甲');
// 做成舊存檔：拿掉流水號，每家公司 uid 從 1 數
const S = JSON.parse(JSON.stringify(a.save())); delete S.game.book.cloneSeq;
for (const g of Object.values(S.game.cos)) { const m = new Map(); g.roster.forEach((c, i) => { m.set(c.uid, i + 1); c.uid = i + 1; }); for (const sq of Object.values(S.game.book.squads)) if (sq.player === g.name) for (const c of sq.clones) c.uid = m.get(c.uid); }
console.log('舊存檔撞號', dup(Object.values(S.game.cos).flatMap(g => g.roster.map(c => c.uid))));
const b = new Core(() => {}); b.load('奇美拉-1', S);
console.log('讀回', uids(b).join(','), '撞號', dup(uids(b)), '下一號', b.game.book.cloneSeq);
const sq = Object.values(b.game.book.squads).find(s => s.player === '甲' && s.caseId);
console.log('小隊成員是名冊裡那位', sq.clones.every(c => b.co('甲').roster.includes(c)));
b.advanceTo(200); console.log('推到 200 小時', uids(b).length, '人，撞號', dup(uids(b)));
const G = b.co('乙'); for (const m of ['food', 'water', 'implant', 'neural']) if (G.mats[m] < 40) b.command({type: 'buy', mat: m, qty: 100}, '乙');
console.log('培養', b.command({type: 'build', recipe: {food: 40, water: 40, implant: 40, neural: 40}}, '乙') || 'ok');
b.advanceTo(b.game.h + 200); const q = G.queue.find(x => x.ready); console.log('簽收', q ? b.command({type: 'claim', slot: q.slot ?? 0}, '乙') || 'ok' : '還沒好');
const nw = G.roster.at(-1); console.log('新人', nw.id, nw.uid, '撞號', dup(uids(b)), '下一號', b.game.book.cloneSeq);
