// 行動（ops.js，Alan 2026-10-13）從頭到尾：開公司、出發、照路線圖一點一點打（每一點真的開一場 ASH 戰鬥，機器人打），
// 戰果交回核心；檢查生命、護甲板、局內的強化帶到下一點，倒下的人遺體收回、行動結束後休息、王點的獎勵。
// 先要建好 ASH（node chimera/ash/build.mjs）。node chimera/stats/op-play.mjs [路線：每層選第幾個，例如 0101] [種子] [行動：trial|well|hive|yard]
import '../ash/.work/tools/clear-bot/lang-default.mjs';
import {Core} from '../core.js';
import {OPS, nextNodes} from '../ops.js';
const {SquadGame} = await import('../ash/.work/src/chimera-squad.js');
const {installFullSquad} = await import('../ash/.work/tools/chimera/full-squad.mjs');
let bad = 0; const ok = (c, msg) => { console.log(`${c ? '✓' : '✗'} ${msg}`); if (!c) bad++; };
const route = (process.argv[2] || '00000').split('').map(Number), DEF = process.argv[4] || 'trial';
const out = [], a = new Core(m => out.push(m)); a.start(process.argv[3] || '奇美拉-1'); while (a.year < 100) a.stepYear();
const K = a.sim.peek(), base = Object.keys(K.markets).map(Number).find(t => K.owner[t] >= 0);
a.found(base, '測試公司'); const co = a.co('測試公司'), cmd = m => a.command(m, '測試公司');
co.mats.food = 200; co.mats.water = 200;
const home = co.roster.filter(c => c.alive && c.status === 'home').slice(0, 4);
for (const c of home) { c.lv = 5; }   // 有一點等級（2 級學會職業技能）
if (DEF !== 'trial') { ok(String(cmd({type: 'opStart', def: DEF, uids: home.map(c => c.uid)})).startsWith('要先完成'), '前一組還沒完成不能出發'); co.opClear = {trial: 1, well: 1, hive: 1}; co.mats.implant = 200; co.mats.neural = 200; }
const tpl0 = co.templates.length;
ok(cmd({type: 'opStart', def: DEF, uids: home.map(c => c.uid)}) === null, `出發：${OPS[DEF].title}`);
ok(home.every(c => c.status === 'op') && co.mats.food === 200 - OPS[DEF].cost.food, `行動中、付了素材（熱量 ${co.mats.food}）`);
ok(cmd({type: 'opStart', def: DEF, uids: home.map(c => c.uid)}) === '已經有一個行動在進行中', '不能同時開兩個');
let step = 0, fights = 0, prevPicks = 0, restLast = false;
while (co.op && step < 10) {
  const op = co.op, nx = nextNodes(op), n = nx[Math.min(route[step] ?? 0, nx.length - 1)]; step++;
  // 局內的三選一在路線圖上選（Alan 2026-10-14）：每打贏一點每人一次
  const V = a.view('測試公司').data.ops.cur, DR = Object.entries(V.drafts || {});
  if (fights && !restLast) ok(DR.length === op.uids.filter(u => co.roster.find(c => c.uid === u)?.alive).length && DR.every(([, d]) => d.ids.length === 3), `${n.name} 之前：路線圖上每人三選一（${DR.map(([, d]) => d.ids.join('/')).join('、')}）`);
  for (const [u, d] of DR) { const hp0 = op.carry[u]?.hp; ok(cmd({type: 'opPick', uid: +u, id: d.ids[0]}) === null, `選 ${d.ids[0]}`); if (d.ids[0] === 'health' && hp0 != null) ok(op.carry[u].hp === hp0 + 30, '生存本能立刻回 30'); }
  if (DR.length) ok(cmd({type: 'opPick', uid: +DR[0][0], id: 'health'}) !== null, '選過了不能再選');
  out.length = 0; const err = cmd({type: 'opGo', node: n.id});
  if (err) { ok(false, `選 ${n.name}：${err}`); break; }
  restLast = n.type === 'rest'; if (restLast) { ok(co.op?.at === n.id, `休整：${n.name}`); continue; }
  const m = out.find(x => x.type === 'mission'); if (!m) { ok(false, `${n.name} 沒有開戰`); break; }
  const d = m.data, run = d.squad.map(s => s.run);
  if (fights) ok(run.every(r => r && r.pending === 0 && r.picks.length >= 1), `${n.name}：帶著選好的局內強化進場、戰場上不再跳（${run.map(r => r?.picks.join('+')).join('/')}）`);
  if (fights) ok(run.some(r => r?.hp != null), `${n.name}：帶著上一點的生命（${run.map(r => r?.hp).join('/')}）`);
  const g = new SquadGame(d), {botFor} = installFullSquad(g, {onError: e => console.log('  bot', String(e).slice(0, 200))});
  if (fights) { ok(!g.pendingPerks && !g.perkChoices.length, `${n.name}：開場沒有三選一`); const mm = g.members.find(m => m.chimeraPicks.includes('med')); if (mm) ok(mm.chimeraBonusKits?.meds >= 2, '戰地補給：這一點多帶醫療包'); }
  let k = 0; while (g.status === 'playing' && k++ < 8000) botFor(g.player).step();
  const res = g.missionResult; fights++;
  if (g.status === 'playing') console.log('  打不完：' + (d.night ? '夜戰・' : '白天・') + g.enemies.filter(e => e.hp > 0).map(e => `${e.type}(${e.x},${e.y})${e.alert ? "警覺" : "沒發現"}`).join(' ') + '・隊員 ' + g.members.filter(m => m.hp > 0).map(m => `(${m.x},${m.y})`).join(' '));
  const P = Object.values(res.progress), picks = P.reduce((x, p) => x + (p.picks?.length || 0), 0) / Math.max(1, P.length);   // 每人平均
  console.log(`  ${d.title}：${g.status}，${g.turn} 回合，敵人 ${res.kills}/${res.total}，倒下 ${res.dead.length}，局內強化共 ${picks}`);
  prevPicks = picks;
  out.length = 0; const e2 = cmd({type: 'submit', ticket: d.id, result: res});
  ok(!e2, `交戰果${e2 ? '：' + e2 : ''}`);
  ok(cmd({type: 'submit', ticket: d.id, result: res}) !== null, '同一場不能交兩次');
}
ok(!co.op, '行動結束');
const L = co.opLog?.at(-1); console.log(`結果：${L?.ok ? '成功' : '失敗'}，走了 ${L?.nodes} 點，記憶片段 ${L?.cells}，${L?.why}`);
ok(home.every(c => !c.alive ? c.status === 'recovered' : c.status === 'home'), '活著的回基地；倒下的遺體收回');
if (L?.ok && DEF === 'trial') ok(co.templates.length > tpl0, `首通掉模板（${co.templates.length - tpl0} 張）`);
// 沒有疲勞（Alan 2026-10-14）：付得出素材就能馬上再出發
if (home.some(c => c.alive)) { co.mats.food = 200; co.mats.water = 200; ok(cmd({type: 'opStart', def: 'trial', uids: home.filter(c => c.alive).map(c => c.uid)}) === null, '打完馬上能再出發'); }
console.log(bad ? `有 ${bad} 項不對` : '全部正常'); process.exit(bad ? 1 : 0);
