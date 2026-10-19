// 作戰地圖第 4 段（OPMAP.md 十二）：巡邏隊（敵對看交戰／派系關係）、日夜（夜裡看不遠）、藏身、跟商隊買、在聚落打聽、廢墟要停在那一小格
import fs from 'fs';
import {Core} from '../core.js';
import {NEAR, isNight, basePos, od} from '../near.js';
import {TRIP} from '../cases.js';
import {hdist, W} from '../sim.js';
import {center, cellsOf, hexDist} from '../opmap.js';
NEAR.on = true; TRIP.dice = false;
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = new Core(() => {}); c.load(raw.seed, raw.save); const K = c.sim.peek(), w = c.w, N = '第四段';
let bad = 0; const ok = (x, m) => { console.log(`${x ? '✓' : '✗'} ${m}`); if (!x) bad++; };
c.found(1398, N); const G = c.game.cos[N], cmd = m => c.command(m, N), run = n => { for (let i = 0; i < n; i++) { c.advanceTo(c.hour + 1); for (const t of c.game.book.tickets.filter(t => t.player === N && !t.done)) cmd({type: 'resolve', ticket: t.id}); } };
ok(isNight(22) && isNight(3) && !isNight(12), '夜裡是 20:00～06:00');
// 巡邏隊：跑幾天看有沒有出現、是不是中立；把派系關係降到不往來就變敵對
const kinds = {}; let patrol = null;
for (let i = 0; i < 24 * 6 && !patrol; i++) { run(1); for (const p of G.hq.near || []) { kinds[p.kind] = (kinds[p.kind] || 0) + 1; if (p.kind === 'patrol') patrol = p; } }
ok(!!patrol, `巡邏隊出現了（兵牌種類 ${JSON.stringify(kinds)}）`);
if (patrol) { ok(patrol.hostile === false, `${patrol.facName}巡邏隊：關係普通時中立`); (G.rel ||= {})[patrol.fac] = -80; run(1); const p2 = (G.hq.near || []).find(p => p.id === patrol.id); ok(!p2 || p2.hostile === true, '派系關係低到不往來：變敵對'); G.rel[patrol.fac] = 0; }
// 日夜：夜裡 2 格外的兵牌看不到
const vis = () => c.view(N).data.hq.near; let night = null, day = null;
for (let i = 0; i < 48 && !(night && day); i++) { run(1); const V = vis(); const far = (G.hq.near || []).filter(p => Math.abs(hdist(p.tile, G.base)) > 2); if (!far.length) continue; const shown = V.list.filter(p => far.some(f => f.id === p.id)).length; if (isNight(c.hour)) night = {far: far.length, shown}; else day = {far: far.length, shown}; }
ok(night && night.shown === 0, `夜裡：2 格外的 ${night?.far} 個兵牌都看不到`);
ok(day && day.shown > 0, `白天：2 格外看得到 ${day?.shown}／${day?.far}`);
// 商隊：放一支在基地旁邊，買熱量
const c0 = center(G.base, W); G.hq.near = [{id: 990, kind: 'caravan', tile: G.base, pos: [c0[0] + 1, c0[1]], mins: 0, born: c.hour, str: 3, to: Object.keys(K.markets).map(Number).find(t => t !== G.base && K.owner[t] >= 0), cargo: {food: 40, water: 40}}];
const f0 = G.mats.food; ok(cmd({type: 'caravanBuy', id: 990, mat: 'food', qty: 10}) === null && G.mats.food === f0 + 10, `跟商隊買熱量 10（${f0} → ${G.mats.food}）`);
G.hq.near[0].pos = [c0[0] + 3, c0[1]]; ok(cmd({type: 'caravanBuy', id: 990, mat: 'food', qty: 10}) === '基地要開到商隊旁邊一小格', '商隊不在旁邊就買不到');
// 打聽：停在城（中心）可以；同一天第二次不行
ok(cmd({type: 'askLocal'}) === null, `在城裡打聽：${G.hq.log.at(-1).text.slice(0, 60)}`);
ok(cmd({type: 'askLocal'}) === '這裡今天已經打聽過了', '同一處一天一次');
// 廢墟：找一格有廢墟、走得到的，停在別的小格搜不到，停在廢墟那一小格才搜得到
const rt = Object.keys(K.ruin).map(Number).filter(t => K.ruin[t] && w.land[t] && !K.markets[t] && hdist(t, G.base) <= 14 && isFinite(c.sim.pmc.dist(G.base, t)))[0];
if (rt != null) {
  const rc = [...cellsOf(rt, od(w)).values()].find(x => x.f === 'ruin');
  cmd({type: "baseGo", tile: rt}); run(80);
  ok(G.base === rt, `基地開到有廢墟的 ${w.names[rt]}`);
  G.hq.searched = {}; cmd({type: 'baseSearch'}); run(5); ok(G.hq.log.some(e => /廢墟在別處/.test(e.text)), '停在中心搜：說廢墟在別處');
  cmd({type: 'baseGo', tile: rt, sub: [rc.q, rc.r]}); run(3); ok(G.hq.sub && G.hq.sub[0] === rc.q, '停到廢墟那一小格');
  G.hq.searched = {}; const n0 = G.hq.log.length; cmd({type: 'baseSearch'}); run(5); ok(G.hq.log.slice(n0).some(e => /廢墟/.test(e.text) && !/在別處/.test(e.text)), `停在廢墟搜：${G.hq.log.slice(n0).map(e => e.text).filter(t => /廢墟/.test(t)).join('').slice(0, 50)}`);
}
console.log(bad ? `${bad} 項不對` : '全部正常');
