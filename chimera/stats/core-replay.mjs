// 伺服器化 S0 的驗證：同一份「種子＋指令紀錄」在全新的核心上重播，結果必須一模一樣（伺服器的存檔靠這個）。
// node chimera/stats/core-replay.mjs [種子] [推演年數] [遊戲小時]
import {Core} from '../core.js';
const seed = process.argv[2] || '奇美拉-1', years = Number(process.argv[3] || 100), hours = Number(process.argv[4] || 24 * 20);
const quiet = () => {};
const a = new Core(quiet); a.start(seed); while (a.year < years) a.stepYear();
const base = Object.keys(a.sim.peek().markets).map(Number).find(t => a.sim.peek().owner[t] >= 0);
a.found(base, '測試公司');
// 一段腳本化的經營：買料、造人、接案、自動結算任務票、親自打（假戰果）、採購
const G = () => a.game.G, B = () => a.game.book;
a.command({type: 'buy', mat: 'food', qty: 100}); a.command({type: 'build', recipe: {food: 60, water: 60, implant: 40, neural: 40}});
let fought = 0;
for (let h = 1; h <= hours; h++) {
  a.advanceTo(h);
  if (h === 3) { const o = a.sim.opportunities().find(x => x.lv >= 2 && x.kind !== 'front' && x.kind !== 'tense'); const uids = G().roster.filter(c => c.alive && c.status === 'home').slice(0, 4).map(c => c.uid); if (o) a.command({type: 'accept', kind: o.kind, tile: o.tile, side: '', uids}); }
  if (h === 10) a.command({type: 'quotes'});
  for (const tk of B().tickets.filter(t => !t.done && t.player === G().name && t.squad)) {
    if (fought < 2) { a.command({type: 'fight', ticket: tk.id}); const sq = B().squads[tk.squad]; a.command({type: 'submit', ticket: tk.id, result: {win: true, dead: [], progress: Object.fromEntries(sq.clones.filter(c => c.alive).map(c => [c.id, {lv: 2, xp: 1, picks: ['health'], skills: [], prep: null, perkPicks: 1}]))}}); fought++; }
    else if ((h + tk.id.length) % 5 === 0) a.command({type: 'resolve', ticket: tk.id});
  }
}
const b = new Core(quiet); b.replay(seed, a.log, a.hour);
const fa = a.fingerprint(), fb = b.fingerprint();
console.log(`指令 ${a.log.length} 筆、遊戲 ${a.hour} 小時、沙盒第 ${a.year} 年、任務票 ${B().tickets.length} 張（親自打 ${fought}）`);
console.log(fa === fb ? `重播一致 ${fa}` : `重播不一致！\n  原本 ${fa}\n  重播 ${fb}`);
process.exit(fa === fb ? 0 : 1);
