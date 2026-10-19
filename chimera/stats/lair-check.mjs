// 清剿據點（OPMAP.md 第十三節）：據點的確切小格、巡查整格（找到旁邊一小格才算）、開車／徒步、哨兵驚動、警戒過後搬家、清剿（主要任務）、存貨、委託板要先找到
import fs from 'fs';
import {Core} from '../core.js';
import {NEAR, od, lairInfo, opPlan, opEnd} from '../near.js';
import {TRIP, isEncounter} from '../cases.js';
import {accept} from '../company.js';
import {hdist, W} from '../sim.js';
import {cellsOf, hexDist, center, key} from '../opmap.js';
NEAR.on = true; TRIP.dice = false;
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = new Core(() => {}); c.load(raw.seed, raw.save); const K = c.sim.peek(), w = c.w, N = '清剿';
let bad = 0; const ok = (x, m) => { console.log(`${x ? '✓' : '✗'} ${m}`); if (!x) bad++; };
c.found(1398, N); const G = c.game.cos[N], cmd = m => c.command(m, N), B = c.game.book;
const run = n => { for (let i = 0; i < n; i++) { c.advanceTo(c.hour + 1); for (const t of B.tickets.filter(t => t.player === N && !t.done)) cmd({type: 'resolve', ticket: t.id}); } };
const quiet = () => { NEAR.BANDIT = 0; NEAR.NATIVE = 0; NEAR.PATROL = 0; NEAR.CARAVAN = 0; G.hq.near = []; };
const home = () => G.roster.filter(x => x.alive && x.status === 'home' && !x.keep).map(x => x.uid);
// 找一個走得到、不在城裡的掠奪者據點
const g = K.gangs.filter(x => !x.gone && !x.native && w.land[x.lair] && !K.markets[x.lair] && isFinite(c.sim.pmc.dist(G.base, x.lair))).sort((a, b) => hdist(a.lair, G.base) - hdist(b.lair, G.base))[0];
ok(!!g, `目標：${g.name}的據點（${w.names[g.lair]}，離總部 ${hdist(g.lair, G.base)} 格）`);
const L = lairInfo(G, w, g), cells = cellsOf(g.lair, od(w)), cell = cells.get(key(L.sub[0], L.sub[1]));
ok(cell && !cell.road && cell.f !== 'town' && cell.f !== 'suburb' && cell.f !== 'settle' && hexDist(L.sub, center(g.lair, W)) >= 1, `據點在 [${L.sub}]：${cell?.k}${cell?.f ? '・' + cell.f : ''}，不在路上、城、聚落、中心`);
ok(JSON.stringify(lairInfo(G, w, g).sub) === JSON.stringify(L.sub), '同一個據點每次在同一小格');
// 巡查路線：37 小格（走得過去的）都在路線某一點旁邊一小格內；開車比徒步快
const Pc = opPlan(w, g.lair, {sweep: true, mode: 'car'}, 0), Pf = opPlan(w, g.lair, {sweep: true, mode: 'foot'}, 0);
const pass = [...cells.values()].filter(x => isFinite({road: 4, plain: 8, rough: 12, forest: 12, slow: 20, trench: 20}[x.k]));
const unc = pass.filter(x => !Pc.pts.some(p => hexDist([p[0], p[1]], [x.q, x.r]) <= 1));
ok(unc.length === 0, `巡查整格：走 ${Pc.pts.length - 1} 小格，${pass.length} 小格走得過去的都掃到（漏 ${unc.length}）`);
ok(opEnd(Pc) < opEnd(Pf), `開車 ${opEnd(Pc).toFixed(1)} 小時、徒步 ${opEnd(Pf).toFixed(1)} 小時`);
// 委託板的清剿：還沒找到不能接
run(1); ok(/單機：清剿據點改成「派人過去」/.test(accept(G, B, w, {kind: 'lair', tile: g.lair, gang: g.id, fac: -1, lv: 1, title: g.name}, '', home().slice(0, 3), c.hour) || ''), '委託板的清剿：單機改成派人過去（一處一處打）');
ok(/還不知道據點在哪一小格/.test(cmd({type: 'sortie', tile: g.lair, mode: 'fight', uids: home().slice(0, 3), lair: g.id}) || ''), '派人攻擊據點：還沒找到不能去');
// 巡查（哨兵關掉，先看找不找得到）
quiet(); NEAR.SPOT = 0;
ok(cmd({type: 'sortie', tile: g.lair, mode: 'explore', uids: home().slice(0, 3), sweep: true, move: 'car'}) === null, '派三個人開車巡查整格');
const cs = B.cases.filter(x => G.cases.includes(x.id) && x.sortie?.sweep).pop();
let t0 = null; for (let i = 0; i < 72 && !cs.sortie.done; i++) { run(1); const sq = Object.values(B.squads).find(s => s.caseId === cs.id); if (sq?.op && t0 == null) t0 = sq.op.pts[0][2]; }
ok(lairInfo(G, w, g).found != null, `找到了確切位置（${lairInfo(G, w, g).found < t0 ? '運兵車開進來的路上就經過旁邊' : `開始巡查後 ${(lairInfo(G, w, g).found - t0).toFixed(1)} 小時`}）`);
ok(G.hq.log.some(e => /找到了.*確切位置/.test(e.text)), `基地日誌：${(G.hq.log.find(e => /找到了.*確切位置/.test(e.text)) || {}).text}`);
ok(c.view(N).data.hq.lairs?.some(x => x.id === g.id), '畫面拿得到找到的據點');
run(48);
// 巡查到一半被攔：打完接著走，最後照樣回報
quiet(); NEAR.SPOT = 0;
const tb = Object.keys(K.markets).map(Number).filter(t => t !== G.base && !K.gangs.some(x => !x.gone && x.lair === t) && isFinite(c.sim.pmc.dist(G.base, t)) && hdist(t, G.base) <= 4).filter(t => !(K.markets[t] && K.owner[t] >= 0))[0] ?? c.sim.pmc.route(G.base, g.lair)[1];
ok(cmd({type: 'sortie', tile: tb, mode: 'explore', uids: home().slice(0, 2), sweep: true}) === null, `再派兩個人巡查 ${w.names[tb]}`);
const cb = B.cases.filter(x => G.cases.includes(x.id) && x.sortie?.sweep && x.tile === tb).pop(); let sqb = null;
for (let i = 0; i < 48 && !sqb?.op; i++) { run(1); sqb = Object.values(B.squads).find(s => s.caseId === cb.id); }
const pp = sqb.op.pts[Math.min(3, sqb.op.pts.length - 1)]; G.hq.near.push({id: 999, kind: 'bandit', tile: tb, pos: [pp[0], pp[1] + 1], mins: 0, born: c.hour, str: 2});
for (let i = 0; i < 24 && !cb.sortie.done; i++) run(1);
ok(G.hq.log.some(e => /打完了，接著巡查/.test(e.text)), '被攔下、打完了接著巡查');
ok(cb.sortie.done && G.hq.log.some(e => /巡查.*路上遇襲過一次/.test(e.text)), `巡查回報：${(G.hq.log.filter(e => /派遣・巡查/.test(e.text)).pop() || {}).text}`);
run(48);
// 哨兵：開車在 3 小格內，看到就警戒、派人出來追
quiet(); NEAR.SPOT = 1; const L2 = lairInfo(G, w, g); L2.alert = null;
const sq0 = {player: N, clones: [], op: {tile: g.lair, mode: 'car', sweep: false, pts: [[L2.sub[0] + 2, L2.sub[1], c.hour - 1], [L2.sub[0] + 2, L2.sub[1], c.hour + 5]], done: false}, id: 'Sx'};
B.squads.Sx = sq0; run(1); delete B.squads.Sx;
ok(L2.alert > c.hour, `開車到 2 小格內：被哨兵看到，警戒到 ${L2.alert?.toFixed(1)}`);
ok(G.hq.log.some(e => /派了一群人出來追/.test(e.text)), '據點派了一群人出來追');
L2.alert = null; G.hq.near = []; B.squads.Sx = {...sq0, op: {...sq0.op, mode: 'foot', done: false}}; run(1); delete B.squads.Sx;
ok(!(L2.alert > c.hour), '徒步在 2 小格：哨兵看不到');
// 警戒過後沒人來打：搬家（機率先拉到 1）
NEAR.MOVE_AWAY = 1; const old = [...L2.sub]; L2.alert = c.hour; G.hq.near = []; run(1);
ok(L2.found == null && (L2.sub[0] !== old[0] || L2.sub[1] !== old[1]), `警戒過了搬家：[${old}] → [${L2.sub}]，情報退回「那一格」`);
NEAR.MOVE_AWAY = .5;
// 清剿：找到後派人攻擊；是主要任務（不是遭遇）；打完據點拆掉或警戒
L2.found = c.hour; quiet(); NEAR.SPOT = 0;
ok(cmd({type: 'sortie', tile: g.lair, mode: 'fight', uids: home().slice(0, 4), lair: g.id, move: 'foot'}) === null, '找到了：派四個人徒步去清剿');
const cl = B.cases.filter(x => G.cases.includes(x.id) && x.sortie?.lair === g.id).pop(); let tk = null;
for (let i = 0; i < 72 && !tk; i++) { c.advanceTo(c.hour + 1); tk = B.tickets.find(t => t.caseId === cl.id); }
ok(tk && tk.type === 'clear' && !isEncounter(B, tk), `到了據點旁邊開一張清剿（${tk?.enemy?.name}，戰力 ${tk?.enemy?.power}），是主要任務`);
const imp0 = G.mats.implant || 0; if (process.argv[3] === 'win') { tk.enemy.power = 1; tk.enemy.units = {thug: 1}; tk.enemy.boss = null; } cmd({type: 'resolve', ticket: tk.id}); run(3);
const x = (await import('../near.js')).gangInfo(G, w, g);
if (cl.sortie.win) { ok(!x.sites.some(s => s.head && s.sub[0] === L2.sub[0] && s.sub[1] === L2.sub[1] && s.tile === L2.tile) || K.gangs.find(q => q.id === g.id).gone, `打贏：主據點拆掉了（還有 ${x.sites.length} 處${x.sites.length ? '，頭目逃到別處' : '，這一夥人散了'}）`);
  ok(x.sites.length ? G.hq.log.some(e => /逃到了/.test(e.text)) : (G.mats.implant || 0) === imp0 + 2, x.sites.length ? '日誌寫了頭目逃到哪裡' : `搬回存貨（植入物 ${imp0} → ${G.mats.implant}）`); }
else { ok(lairInfo(G, w, g).alert > c.hour, '沒打下來：據點警戒中'); console.log('（這次自動結算輸了；打贏的分支沒測到）'); }
console.log(bad ? `${bad} 項不對` : '全部正常');
