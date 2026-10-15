// 裝備的整條路：公司的人帶裝備開戰（core fight）→ ASH 打完 → 結算寫回名冊與倉庫
import '../clear-bot/lang-default.mjs';
import {Core} from '../../../../core.js';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
let mission = null;
const c = new Core(m => { if (m.type === 'mission') mission = m.data; }); c.start('奇美拉-1'); while (c.year < 60) c.stepYear();
const K = c.sim.peek(), town = Object.keys(K.markets).map(Number).find(t => K.owner[t] >= 0);
c.found(town, '測'); c.advanceTo(24); const G = c.co('測'); c.view('測');
console.log('買', c.command({type: 'shop', kind: 'armor', base: 'heavy'}, '測') || 'ok', c.command({type: 'shop', kind: 'gun', base: 'sniper'}, '測') || 'ok');
const p = G.roster.find(x => x.alive && x.cls === 'soldier');
console.log('換裝', c.command({type: 'equip', uid: p.uid, slot: 'armor', item: G.store.find(x => x.kind === 'armor').id}, '測') || 'ok', c.command({type: 'equip', uid: p.uid, slot: 'gun1', item: G.store.find(x => x.base === 'sniper').id}, '測') || 'ok', '→', p.weapon, '倉庫', G.store.map(x => x.base).join(','));
const opp = c.view('測').board.find(x => x.kind !== 'front' && x.kind !== 'tense');
const uids = [p.uid, ...G.roster.filter(x => x.alive && x.status === 'home' && x !== p).slice(0, 3).map(x => x.uid)];
console.log('接案', c.command({type: 'accept', kind: opp.kind, tile: opp.tile, side: '', uids}, '測') || 'ok');
for (let h = 25; h < 400 && !c.game.book.tickets.some(t => t.player === '測' && !t.done); h++) c.advanceTo(h);
const tk = c.game.book.tickets.find(t => t.player === '測' && !t.done); c.command({type: 'fight', ticket: tk.id}, '測');
console.log('任務裡的裝備', JSON.stringify(mission.squad.find(s => s.id === p.id).gear.armor), mission.squad.find(s => s.id === p.id).gear.guns.map(g => g && g.base).join(','));
const g = new SquadGame(mission); const {botFor} = installFullSquad(g); let n = 0; while (g.status === 'playing' && n++ < 3000) botFor(g.player).step();
console.log('戰鬥', g.status, JSON.stringify(g.missionResult.progress[p.id]?.gear));
const cs = c.game.book.cases.find(x => x.id === tk.caseId); cs.selfAmmo = true;   // 當成自費的任務，看彈藥費有沒有扣
const res = g.missionResult; if (res.progress[p.id]) res.progress[p.id].gear.ammoUsed = {reserve: 300, ordnance: 2};   // 假設打到彈藥見底：步槍彈 300 發＋重彈藥 2 發要補
const cash0 = G.cash; console.log('結算', c.command({type: 'submit', ticket: tk.id, result: res}, '測') || 'ok');
console.log('寫回', p.alive ? p.weapon : '陣亡', '護甲', p.gear.armor?.base, '預備品', p.gear.kits.map(k => k ? k.base + k.n : '-').join(','), '倉庫', G.store.map(x => x.base + (x.n ? x.n : '')).join(','));
c.advanceTo(c.game.h + 1);
console.log('彈藥費', JSON.stringify(g.missionResult.progress[p.id]?.gear?.ammoUsed), '帳', c.game.book.ledger.filter(x => x.kind === 'ammo').map(x => x.amount + ' ' + x.text).join('；'), '通知', c.game.book.inbox.filter(x => /彈藥費/.test(x.text)).map(x => x.text).join('；'));
const gun = G.store.find(x => x.kind === 'gun') || (c.command({type: 'shop', kind: 'gun', base: 'rifle'}, '測'), G.store.find(x => x.kind === 'gun'));
console.log('改裝', c.command({type: 'mod', item: gun.id, affix: 'powerful'}, '測') || 'ok', '→', G.store.find(x => x.id === gun.id).affix, '不能裝', c.command({type: 'mod', item: gun.id, affix: 'lance'}, '測'));
const v = c.view('測'); console.log('行情', v.data.sellFactor, '倉庫價', v.data.store.map(x => x.name + ' $' + x.value).join('、'));
