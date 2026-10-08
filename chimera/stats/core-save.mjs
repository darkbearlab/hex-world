// 伺服器化 S1 的驗證：存檔（沙盒 exportState＋帳本＋公司）讀回全新的核心後，兩邊往後推一樣久，結果必須一模一樣。
// node chimera/stats/core-save.mjs [種子] [推演年數] [存檔前小時] [存檔後小時]
import {Core} from '../core.js';
Core.prototype.cmd = function (m, who = '測試公司') { return this.command(m, who); };
const seed = process.argv[2] || '奇美拉-1', years = Number(process.argv[3] || 100), h1 = Number(process.argv[4] || 300), h2 = Number(process.argv[5] || 2400);
const q = () => {};
const a = new Core(q); a.start(seed); while (a.year < years) a.stepYear();
const base = Object.keys(a.sim.peek().markets).map(Number).find(t => a.sim.peek().owner[t] >= 0);
a.found(base, '測試公司'); a.found(Object.keys(a.sim.peek().markets).map(Number).filter(t => a.sim.peek().owner[t] >= 0)[3], '對手公司');
const o = a.sim.opportunities().find(x => x.lv >= 2 && x.kind !== 'front' && x.kind !== 'tense');
a.cmd({type: 'accept', kind: o.kind, tile: o.tile, side: '', uids: a.co('測試公司').roster.filter(c => c.alive).slice(0, 4).map(c => c.uid)});
a.advanceTo(h1);
const save = JSON.stringify(a.save());
const b = new Core(q); b.load(seed, JSON.parse(save));
console.log(`存檔 ${Math.round(save.length / 1024)} KB；讀回後指紋 ${a.fingerprint() === b.fingerprint() ? '一致' : '不一致'}`);
// 讀回後，小隊成員要和名冊裡的是同一個物件（JSON 會拆成兩份；core.load 的 relink 接回）
const split = Object.values(b.game.book.squads).flatMap(sq => sq.clones.map(c => [sq, c])).filter(([sq, c]) => c.uid != null && b.game.cos[sq.player]?.roster.find(x => x.uid === c.uid) !== c).length;
console.log(split ? `小隊成員有 ${split} 位和名冊不是同一個物件！` : '小隊成員與名冊是同一個物件');
if (split) process.exit(1);
a.advanceTo(h2); b.advanceTo(h2);
const fa = a.fingerprint(), fb = b.fingerprint();
console.log(fa === fb ? `往後推到 ${h2} 小時仍一致 ${fa}（沙盒第 ${a.year} 年）` : `不一致！\n  原本 ${fa}\n  讀檔 ${fb}`);
process.exit(fa === fb ? 0 : 1);
