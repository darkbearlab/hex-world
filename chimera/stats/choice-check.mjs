// 遭遇的三個選擇（OPMAP.md）：撤退成功＝單子取消、人回基地；撤退失敗＝單子還在、不能再撤；主要任務不能自動戰鬥、不能撤退
// node chimera/stats/choice-check.mjs 存檔.json
import fs from 'fs';
import {Core} from '../core.js';
import {NEAR} from '../near.js';
import {hdist} from '../sim.js';
NEAR.on = true;
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = new Core(() => {}); c.load(raw.seed, raw.save);
const K = c.sim.peek(), w = c.w, N = '選擇測試';
const home = 1398; c.found(home, N); const G = c.game.cos[N];
const wild = []; for (let i = 0; i < K.bandit.length; i++) if (w.land[i] && !K.markets[i] && hdist(i, home) >= 1 && hdist(i, home) <= 3 && isFinite(c.sim.pmc.dist(home, i))) wild.push(i);
let bad = 0; const ok = (x, m) => { console.log(`${x ? '✓' : '✗'} ${m}`); if (!x) bad++; };
const free = () => G.roster.filter(x => x.alive && x.status === 'home').slice(0, 2).map(x => x.uid);
const tickets = () => c.game.book.tickets.filter(t => t.player === N && !t.done);
let fledOk = 0, fledFail = 0;
for (let k = 0; k < 12 && (fledOk < 1 || fledFail < 1); k++) {
  if (c.command({type: 'sortie', tile: wild[k % wild.length], mode: 'fight', uids: free()}, N)) { c.advanceTo(c.hour + 24); continue; }
  for (let i = 0; i < 48 && !tickets().length; i++) c.advanceTo(c.hour + 1);
  const tk = tickets()[0]; if (!tk) continue;
  ok(!c.command({type: 'flee', ticket: tk.id}, N), `撤退擲骰（${tk.id}）`);
  if (tk.done) { fledOk++; ok(tk.fled, '撤退成功：單子取消'); for (let i = 0; i < 72 && G.roster.some(x => x.status === 'away'); i++) c.advanceTo(c.hour + 1); ok(!G.roster.some(x => x.alive && x.status === 'away'), '撤退成功：人回到基地'); }
  else { fledFail++; ok(c.command({type: 'flee', ticket: tk.id}, N) === '已經試過撤退了，只能打', '撤退失敗：不能再撤'); c.command({type: 'resolve', ticket: tk.id}, N); for (let i = 0; i < 72 && G.roster.some(x => x.status === 'away'); i++) c.advanceTo(c.hour + 1); }
}
ok(fledOk && fledFail, `撤退成功 ${fledOk} 次、失敗 ${fledFail} 次`);
console.log(bad ? `${bad} 項不對` : '全部正常');
