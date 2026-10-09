// NPC 傭兵公司（npc.js）在世界裡跑一段時間：看它們有沒有在培養、接案、打服務單、參加大戰役，錢和人怎麼變。
// 也驗證存檔讀檔後繼續推一樣（NPC 的決定都照狀態算）。node chimera/stats/npc-world.mjs [種子=奇美拉-4] [天數=60]
import {Core} from '../core.js';
const seed = process.argv[2] || '奇美拉-4', days = +(process.argv[3] || 60);
const mk = () => { const c = new Core(() => {}); c.start(seed); while (c.year < 100) c.stepYear(); c.open(); c.enableNpcs(); return c; };
const c = mk(), rows = [];
for (let d = 1; d <= days; d++) {
  c.advanceTo(d * 24);
  if (d % 10 === 0 || d === days) for (const G of Object.values(c.game.cos)) { const R = G.roster;
    rows.push({day: d, npc: G.name, style: G.npc?.style, cash: Math.round(G.cash), alive: R.filter(x => x.alive).length, dead: R.filter(x => !x.alive).length, maxLv: Math.max(...R.filter(x => x.alive).map(x => x.lv || 1), 0),
      cases: G.cases.length, tickets: c.game.book.tickets.filter(t => t.player === G.name).length, won: c.game.book.tickets.filter(t => t.player === G.name && t.win).length, camp: Object.keys(G.npc?.camp || {}).length, err: G.npc?.err || ''}); }
}
console.table(rows);
console.log('大戰役', c.sim.campaignView().map(v => `${v.name} ${v.done ? '結束' : '進行中'}`).join('、') || '無');
// 存檔讀檔一致
const a = mk(); a.advanceTo(24 * 20); const s = JSON.stringify(a.save()), b = new Core(() => {}); b.load(seed, JSON.parse(s)); b.enableNpcs();
a.advanceTo(24 * 30); b.advanceTo(24 * 30);
console.log('存檔讀檔後推 10 天：', a.fingerprint() === b.fingerprint() ? '一致' : `不一致 ${a.fingerprint()} ${b.fingerprint()}`);
