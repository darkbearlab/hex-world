// 大戰役第二階段的驗證：公司接大戰役委託（全部的人派上去）、服務單一張接一張越來越大、自動結算、報酬照行情、
// 貢獻變成雇主的戰功、中途撤軍不違約、戰役結束分尾款。node chimera/stats/campaign-play.mjs [種子=奇美拉-4] [最多天數=112]
import {Core} from '../core.js';
const seed = process.argv[2] || '奇美拉-4', maxDays = +(process.argv[3] || 112);
const c = new Core(() => {}); c.start(seed); while (c.year < 100) c.stepYear();
const K = c.sim.peek(), town = Object.keys(K.markets).map(Number).find(t => K.owner[t] >= 0);
c.found(town, '絞肉機'); const G = c.co('絞肉機');
// 多養一點人：直接塞進名冊（測試用）
for (let i = 0; i < 12; i++) G.roster.push({...G.roster[0], uid: 9000 + i, id: `X-${i}`, alive: true, status: 'home', gear: null});
let h = 1, camp = null;
for (; h <= maxDays * 24; h++) { c.advanceTo(h); const e = c.boardView('絞肉機').find(x => x.kind === 'camp'); if (e) { camp = e; break; } }
if (!camp) { console.log('這段期間沒有大戰役'); process.exit(1); }
console.log(`第 ${(h / 24).toFixed(1)} 天：${camp.title}（${camp.detail}）`);
const uids = G.roster.filter(x => x.alive && x.status === 'home').map(x => x.uid);
console.log('接案：', c.command({type: 'accept', kind: 'camp', tile: camp.tile, side: 'att', uids}, '絞肉機') || `派出 ${uids.length} 人`);
const cs = c.game.book.cases.find(x => x.kind === 'camp' && G.cases.includes(x.id));
{ for (let i = 0; i < 4; i++) G.roster.push({...G.roster[0], uid: 9100 + i, id: `Y-${i}`, alive: true, status: 'home', gear: null});
  const more = G.roster.filter(x => x.alive && x.status === 'home').map(x => x.uid), n0 = cs.squads.length;
  console.log('加派：', c.command({type: 'accept', kind: 'camp', tile: camp.tile, side: 'att', uids: more}, '絞肉機') || `成功，${n0}→${cs.squads.length} 隊`, '・替另一邊：', c.command({type: 'accept', kind: 'camp', tile: camp.tile, side: 'def', uids: more}, '絞肉機') || '（居然可以）'); }
{ const sq = c.game.book.squads[cs.squads[0]], r = c.command({type: 'recall', squad: sq.id}, '絞肉機'); console.log('一接就撤一隊：', r || '成功', '・違約金', c.game.book.ledger.filter(x => x.kind === 'penalty' && x.player === '絞肉機').length ? '有' : '沒有', '・還在案子裡的隊', cs.squads.length); }
const rows = []; let withdrew = true, cash0 = G.cash;
for (let n = 0; n < 24 * 12; n++, h++) {
  c.advanceTo(h);
  for (const tk of c.game.book.tickets.filter(t => t.caseId === cs.id && t.player === '絞肉機' && !t.done)) {
    c.command({type: 'resolve', ticket: tk.id}, '絞肉機');
    const d = c.game.book.tickets.find(t => t.id === tk.id);
    rows.push({h: (h / 24).toFixed(1) + '天', 波: d.wave, 敵人: Object.values(d.enemy.units).reduce((x, y) => x + y, 0), 戰力: d.enemy.power, 勝: d.win ? '勝' : '敗', 打倒: d.kills, 行情: d.mul, 貢獻: d.pts, 陣亡: d.dead.length});
  }
  const v = c.sim.campaignOf(cs.camp);
  // 打到一半撤一隊
  if (!withdrew && rows.length >= 1) { const sq = cs.squads.map(id => c.game.book.squads[id]).find(s => s && !s.busy && s.clones.some(x => x.alive)); if (sq) { const r = c.command({type: 'recall', squad: sq.id}, '絞肉機'); console.log('撤一隊：', r || '成功', '（不違約）'); withdrew = true; } }
  if (cs.settled) break;
  if (v?.done && !rows.done) { rows.done = true; console.log(`戰役結束（第 ${(h / 24).toFixed(1)} 天）：${v.win === v.att ? '攻方' : '守方'}勝`); }
}
console.table(rows);
const led = c.game.book.ledger.filter(x => x.player === '絞肉機' && x.caseId === cs.id), by = {};
for (const x of led) by[x.kind] = (by[x.kind] || 0) + x.amount;
console.log('這個案子的帳：', JSON.stringify(by), '貢獻', Math.round(cs.score['絞肉機'] || 0), '結案', cs.settled, '違約金', by.penalty || 0);
console.log('現金', Math.round(cash0), '→', Math.round(G.cash));
