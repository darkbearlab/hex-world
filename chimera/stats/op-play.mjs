// 行動（ops.js，Alan 2026-10-13）從頭到尾：開公司、出發、照路線圖一點一點打（每一點真的開一場 ASH 戰鬥，機器人打），
// 戰果交回核心；檢查生命、護甲板、局內的強化帶到下一點，倒下的人遺體收回、行動結束後休息、王點的獎勵。
// 先要建好 ASH（node chimera/ash/build.mjs）。node chimera/stats/op-play.mjs [路線：每層選第幾個，例如 0101] [種子]
import '../ash/.work/tools/clear-bot/lang-default.mjs';
import {Core} from '../core.js';
import {OPS, nextNodes} from '../ops.js';
const {SquadGame} = await import('../ash/.work/src/chimera-squad.js');
const {installFullSquad} = await import('../ash/.work/tools/chimera/full-squad.mjs');
let bad = 0; const ok = (c, msg) => { console.log(`${c ? '✓' : '✗'} ${msg}`); if (!c) bad++; };
const route = (process.argv[2] || '00000').split('').map(Number);
const out = [], a = new Core(m => out.push(m)); a.start(process.argv[3] || '奇美拉-1'); while (a.year < 100) a.stepYear();
const K = a.sim.peek(), base = Object.keys(K.markets).map(Number).find(t => K.owner[t] >= 0);
a.found(base, '測試公司'); const co = a.co('測試公司'), cmd = m => a.command(m, '測試公司');
co.mats.food = 200; co.mats.water = 200;
const home = co.roster.filter(c => c.alive && c.status === 'home').slice(0, 4);
for (const c of home) { c.lv = 5; }   // 有一點等級（2 級學會職業技能）
ok(cmd({type: 'opStart', def: 'trial', uids: home.map(c => c.uid)}) === null, '出發');
ok(home.every(c => c.status === 'op') && co.mats.food === 160, `行動中、付了素材（熱量 ${co.mats.food}）`);
ok(cmd({type: 'opStart', def: 'trial', uids: home.map(c => c.uid)}) === '已經有一個行動在進行中', '不能同時開兩個');
let step = 0, fights = 0, prevPicks = 0;
while (co.op && step < 10) {
  const op = co.op, nx = nextNodes(op), n = nx[Math.min(route[step] ?? 0, nx.length - 1)]; step++;
  out.length = 0; const err = cmd({type: 'opGo', node: n.id});
  if (err) { ok(false, `選 ${n.name}：${err}`); break; }
  if (n.type === 'rest') { ok(co.op?.at === n.id, `休整：${n.name}`); continue; }
  const m = out.find(x => x.type === 'mission'); if (!m) { ok(false, `${n.name} 沒有開戰`); break; }
  const d = m.data, run = d.squad.map(s => s.run);
  if (fights) ok(run.every(r => r && r.pending >= 1), `${n.name}：每人有待選的局內強化（${run.map(r => r?.pending).join('/')}）`);
  if (fights) ok(run.some(r => r?.hp != null), `${n.name}：帶著上一點的生命（${run.map(r => r?.hp).join('/')}）`);
  const g = new SquadGame(d), {botFor} = installFullSquad(g, {onError: e => console.log('  bot', String(e).slice(0, 200))});
  if (fights) { ok(g.pendingPerks >= 1 && g.perkChoices.length === 3, `${n.name}：開場跳出三選一（${g.perkChoices.map(o => o.name).join('、')}）`); }
  let k = 0; while (g.status === 'playing' && k++ < 8000) botFor(g.player).step();
  const res = g.missionResult; fights++;
  const P = Object.values(res.progress), picks = P.reduce((x, p) => x + (p.picks?.length || 0), 0) / Math.max(1, P.length);   // 每人平均
  console.log(`  ${d.title}：${g.status}，${g.turn} 回合，敵人 ${res.kills}/${res.total}，倒下 ${res.dead.length}，局內強化共 ${picks}`);
  if (fights > 1 && res.win) ok(picks > prevPicks, `局內強化有選（${prevPicks}→${picks}）`); prevPicks = picks;
  out.length = 0; const e2 = cmd({type: 'submit', ticket: d.id, result: res});
  ok(!e2, `交戰果${e2 ? '：' + e2 : ''}`);
  ok(cmd({type: 'submit', ticket: d.id, result: res}) !== null, '同一場不能交兩次');
}
ok(!co.op, '行動結束');
const L = co.opLog?.at(-1); console.log(`結果：${L?.ok ? '成功' : '失敗'}，走了 ${L?.nodes} 點，記憶片段 ${L?.cells}，${L?.why}`);
ok(home.every(c => !c.alive ? c.status === 'recovered' : c.status === 'home' && c.restUntil > a.game.h), '活著的回基地、休息中；倒下的遺體收回');
if (home.some(c => c.alive)) ok(cmd({type: 'opStart', def: 'trial', uids: home.filter(c => c.alive).map(c => c.uid)})?.includes('還在休息'), '休息中不能再出發');
console.log(bad ? `有 ${bad} 項不對` : '全部正常'); process.exit(bad ? 1 : 0);
