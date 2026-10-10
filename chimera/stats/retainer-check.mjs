// 長期護衛合約與駐紮（Alan 2026-10-10）：開約、名氣門檻、簽約金與保證金、車隊應召、駐軍在時限到時自動接、違約兩次作廢與拉黑
import {Core} from '../core.js';
import * as G from '../company.js';
const c = new Core(() => {}); c.start('奇美拉-1'); while (c.year < 60) c.stepYear();
const K = c.sim.peek(), towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
c.found(towns[0], '甲'); c.advanceTo(30); const A = c.co('甲'), b = c.game.book;
const ledger = k => b.ledger.filter(x => x.player === '甲' && x.kind === k).reduce((s, x) => s + x.amount, 0);
let v = c.view('甲').data.retainer;
console.log('1 開約', (b.contracts || []).length, '份｜名氣', v.fame, '門檻', v.fameMin, '｜看得到', v.offers.length, '份');
G.RET.FAME_MIN = 0; G.RET.SIZE_MIN = 0;   // 測試：門檻先拿掉
v = c.view('甲').data.retainer; const off = v.offers.sort((a, b2) => (a.bond ? 1 : 0) - (b2.bond ? 1 : 0))[0];
console.log('  拿掉門檻後看得到', v.offers.length, '份；簽', off.name + off.kn, `簽約金 ${off.fee}（${off.plan}）保證金 ${off.bond}`, c.command({type: 'sign', id: off.id}, '甲') || 'ok', '再簽一次', c.command({type: 'sign', id: off.id}, '甲'));
c.advanceTo(c.game.h + 1); console.log('  入帳 簽約金', ledger('retainer'), '保證金', ledger('bond'));
// 2. 駐紮兩隊
const home = () => A.roster.filter(x => x.alive && x.status === 'home').map(x => x.uid);
console.log('2 駐紮', c.command({type: 'garrison', site: off.site, uids: home().slice(0, 4)}, '甲') || 'ok', '沒簽的產地', c.command({type: 'garrison', site: towns[3], uids: home().slice(0, 2)}, '甲'));
// 3. 等應召：不手動派，看時限到時駐軍會不會自動接
const ct = b.contracts.find(x => x.id === off.id); let auto = 0, missed = 0;
for (let i = 0; i < 24 * 10; i++) { c.advanceTo(c.game.h + 1); for (const t of b.tickets.filter(t => t.player === '甲' && !t.done && t.squad)) c.command({type: 'resolve', ticket: t.id}, '甲'); }
auto = ct.calls.filter(q => q.auto).length; missed = ct.calls.filter(q => q.state === 'missed').length;
console.log('3 十天內應召', ct.calls.length, '趟｜駐軍自動接', auto, '｜違約', missed, '｜駐紮費', ledger('garrison'), '｜長約車隊案件', A.cases.filter(id => b.cases.find(x => x.id === id)?.contract).length);
const gar = Object.values(b.squads).filter(s => s.player === '甲' && s.garrison === off.site);
console.log('  駐軍還在', gar.map(s => `${s.name} ${s.clones.filter(x => x.alive).map(x => x.status).join(',')}`).join(' | '));
// 4. 撤回駐軍，讓下一趟沒人接：違約兩次 → 作廢、拉黑
for (const s of gar) console.log('4 撤回', c.command({type: 'ungarrison', squad: s.id}, '甲') || 'ok');
for (let i = 0; i < 24 * 12 && !ct.signers[0].void; i++) c.advanceTo(c.game.h + 1);
const s0 = ct.signers[0]; console.log('  違約', s0.breaches, '次・作廢', !!s0.void, '・保證金沒收', !!s0.bondLost, '・違約金', ledger('breach'), '・拉黑到', A.bans?.[ct.fac], '・名氣', G.fame(A, b));
console.log('  那個勢力的新約還看得到嗎', c.view('甲').data.retainer.offers.filter(o => b.contracts.find(x => x.id === o.id).fac === ct.fac).length);
// 5. 存檔一致
const S = JSON.parse(JSON.stringify(c.save())); const d = new Core(() => {}); d.load('奇美拉-1', S); c.advanceTo(c.game.h + 48); d.advanceTo(d.game.h + 48);
console.log('5 存檔讀回推 48 小時', c.fingerprint() === d.fingerprint() ? '一致' : '不一致');
for (const id of A.cases) { const k = b.cases.find(x => x.id === id); if (!k?.contract) continue; const T = b.tickets.filter(t => t.caseId === k.id && t.player === '甲'); console.log('  ', k.title, 'lv', k.lv, '服務單', T.map(t => `${t.win ? '勝' : '敗'}${t.dead?.length ? '死' + t.dead.length : ''}(戰力${t.enemy?.power})`).join(' '), '送達', k.delivered); }
