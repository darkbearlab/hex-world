// 據點要連打好幾場（OPMAP.md 第十四節）：一夥人＝幾處據點＋兵力池；一層一層打（照設施的打法）、打掉的不補回、每天慢慢回補；
// 其他據點派增援；主據點拆掉頭目逃到別處；全部拆光才散、存貨一次；流寇會整群換地方
import fs from 'fs';
import {Core} from '../core.js';
import {NEAR, gangInfo, headSite, siteName, LAIR} from '../near.js';
import {TRIP, isEncounter} from '../cases.js';
import {hdist} from '../sim.js';
NEAR.on = true; TRIP.dice = false;
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = new Core(() => {}); c.load(raw.seed, raw.save); const K = c.sim.peek(), w = c.w, N = '連打';
let bad = 0; const ok = (x, m) => { console.log(`${x ? '✓' : '✗'} ${m}`); if (!x) bad++; };
c.found(1398, N); const G = c.game.cos[N], cmd = m => c.command(m, N), B = c.game.book;
const quiet = () => { NEAR.BANDIT = 0; NEAR.NATIVE = 0; NEAR.PATROL = 0; NEAR.CARAVAN = 0; NEAR.SPOT = 0; if (G.hq) G.hq.near = []; };
const step = () => { c.advanceTo(c.hour + 1); quiet(); };
const home = () => G.roster.filter(x => x.alive && x.status === 'home' && !x.keep).map(x => x.uid);
step();
// 1. 最大的一夥掠奪者：拆成主據點＋小據點
const g = K.gangs.filter(x => !x.gone && !x.native && w.land[x.lair] && isFinite(c.sim.pmc.dist(G.base, x.lair))).sort((a, b) => b.str - a.str)[0];
const x = gangInfo(G, w, g), H = headSite(x), str0 = g.str, pool0 = x.sites.reduce((a, s) => a + s.pool, 0);
ok(x.sites.length === 1 + Math.min(3, Math.floor(str0 / 150)) && !x.nomad, `${g.name}（實力 ${Math.round(str0)}）：${x.sites.length} 處據點，兵力共 ${Math.round(pool0)}`);
ok(H.layers === 3 && x.sites.filter(s => !s.head).every(s => s.layers === 2 && hdist(s.tile, H.tile) <= 1), `主據點 3 層、小據點 2 層，都在主據點那一格或隔壁格（${x.sites.map(s => `${s.kind}@${s.tile}:${Math.round(s.pool)}`).join('、')}）`);
for (const s of x.sites) s.found = c.hour;   // 情報：假裝都找到了（找據點在 lair-check 測過）
// 派人打一處、等到開打；回傳那張單
const attack = (s, gg = g) => { const e = cmd({type: 'sortie', tile: s.tile, mode: 'fight', uids: home().slice(0, 4), lair: gg.id, site: s.sid, move: 'foot'}); if (e) return e;
  const cs = B.cases.filter(q => G.cases.includes(q.id) && q.sortie?.lair === gg.id && q.sortie.site === s.sid && !q.settled).pop();
  for (let i = 0; i < 96; i++) { step(); const tk = B.tickets.find(t => t.caseId === cs.id && !t.done); if (tk) return tk; } return '等不到開打'; };
const backHome = () => { for (let i = 0; i < 96 && G.roster.filter(q => q.alive && q.status !== 'home').length > 0; i++) step(); };
// 2. 先打一處小據點：兩層、沒有頭目、有增援
const O = x.sites.find(s => !s.head); let tk = attack(O);
ok(typeof tk === 'object' && tk.type === 'clear' && tk.facility && tk.floors === 2 && !tk.enemy.boss && !isEncounter(B, tk), `打${siteName(g, O)}：設施的打法，${tk.floors} 層，沒有頭目（戰力 ${tk.enemy?.power}），主要任務`);
const near = x.sites.filter(s => s !== O && hdist(s.tile, O.tile) <= 1).length;
ok(near ? tk.reinf?.length === near && tk.reinf.every(r => r.turn >= 2 && r.turn <= 7 && Object.keys(r.units).length) : !tk.reinf, `增援：${(tk.reinf || []).map(r => `${r.from} 第 ${r.turn} 回合`).join('、') || '附近沒有別處'}`);
const p1 = O.pool; cmd({type: 'submit', ticket: tk.id, result: {win: false, dead: [], kills: 2, floors: 1}}); for (let i = 0; i < 3; i++) step();
ok(O.taken === 1 && O.pool < p1 && O.alert > c.hour, `打下 1 層撤出：${O.taken}／${O.layers} 層，守軍 ${Math.round(p1)} → ${Math.round(O.pool)}，警戒中`);
ok(G.hq.log.some(e => /打下了 1 層/.test(e.text)), `日誌：${(G.hq.log.filter(e => /打下了 1 層/.test(e.text)).pop() || {}).text}`);
// 3. 回補：每天補 5%，最多補到 80%
const p2 = O.pool; backHome(); for (let i = 0; i < 48; i++) step();
ok(O.pool > p2 && O.pool <= O.max * LAIR.REGEN_CAP + 1e-6, `兩天後回補：${Math.round(p2)} → ${Math.round(O.pool)}（上限 ${Math.round(O.max * LAIR.REGEN_CAP)}）`);
// 4. 再打：只剩 1 層，從上次的地方開始；打下來那一處就拆掉
O.found = c.hour; O.alert = null; tk = attack(O);
ok(typeof tk === 'object' && tk.floors === 1, `再打${siteName(g, O)}：只剩 ${tk.floors} 層`);
const n0 = x.sites.length; cmd({type: 'submit', ticket: tk.id, result: {win: true, dead: [], kills: 5, floors: 1}}); for (let i = 0; i < 3; i++) step();
ok(x.sites.length === n0 - 1 && !x.sites.includes(O) && !g.gone, `${siteName(g, O)}拆掉了，還有 ${x.sites.length} 處`);
ok(g.str < str0, `沙盒裡的實力跟著降：${Math.round(str0)} → ${Math.round(g.str)}`);
// 5. 打主據點：3 層、有頭目；打下來頭目逃到別處
backHome(); H.found = c.hour; H.alert = null; tk = attack(H);
ok(typeof tk === 'object' && tk.floors === 3 && !!tk.enemy.boss, `打主據點：${tk.floors} 層，有頭目（${tk.enemy?.boss?.name}）`);
cmd({type: 'submit', ticket: tk.id, result: {win: true, dead: [], kills: 9, floors: 3}}); for (let i = 0; i < 3; i++) step();
const H2 = x.sites.length ? headSite(x) : null;
ok(!g.gone && H2 && H2 !== H && H2.head && g.lair === H2.tile, `主據點拆掉：頭目逃到${H2 ? siteName(g, H2) : '?'}（${H2?.layers} 層），這一夥人還在`);
ok(G.hq.log.some(e => /頭目.*逃到了/.test(e.text)), `日誌：${(G.hq.log.filter(e => /逃到了/.test(e.text)).pop() || {}).text}`);
// 6. 剩下的全部拆光：這一夥人散了、存貨一次
const imp0 = G.mats.implant || 0;
for (let k = 0; k < 6 && x.sites.length && !g.gone; k++) { backHome(); const s = x.sites[0]; s.found = c.hour; s.alert = null; tk = attack(s); if (typeof tk !== 'object') { ok(false, `打不下去：${tk}`); break; }
  cmd({type: 'submit', ticket: tk.id, result: {win: true, dead: [], kills: 6, floors: tk.floors}}); for (let i = 0; i < 3; i++) step(); }
ok(g.gone, `全部拆光：${g.name}那一夥人散了`);
ok((G.mats.implant || 0) === imp0 + 2 && x.looted, `存貨一次（植入物 ${imp0} → ${G.mats.implant}）`);
// 7. 流寇：時間到就整群換地方，找到的情報作廢
const g2 = K.gangs.filter(q => !q.gone && !q.native && q !== g)[0], x2 = gangInfo(G, w, g2);
x2.nomad = true; x2.sites = x2.sites.slice(0, 2).map(s => ({...s, kind: 'camp', layers: 1})); x2.sites[0].head = true; x2.sites.forEach(s => s.found = c.hour); x2.nextMove = c.hour; const from = g2.lair;
step();
ok(g2.lair !== from && x2.sites.every(s => s.found == null) && hdist(g2.lair, from) <= LAIR.NOMAD_RANGE, `流寇${g2.name}換了地方：${w.names[from]} → ${w.names[g2.lair]}，營地要重新找`);
ok(G.hq.log.some(e => /流寇換了地方/.test(e.text)), '日誌：流寇換了地方');
// 8. 原住民的村子：警戒過了不搬；打了以後附近的聚落一週不理你
const g3 = K.gangs.filter(q => !q.gone && q.native && w.land[q.lair] && isFinite(c.sim.pmc.dist(G.base, q.lair))).sort((a, b) => hdist(a.lair, G.base) - hdist(b.lair, G.base))[0];
if (g3) { const x3 = gangInfo(G, w, g3), V = headSite(x3), sub0 = [...V.sub]; NEAR.MOVE_AWAY = 1; V.alert = c.hour; step(); NEAR.MOVE_AWAY = .5;
  ok(V.sub[0] === sub0[0] && V.sub[1] === sub0[1], `${siteName(g3, V)}：警戒過了不搬`);
  backHome(); V.found = c.hour; tk = attack(V, g3);
  if (typeof tk === 'object') { cmd({type: 'submit', ticket: tk.id, result: {win: true, dead: [], kills: 4, floors: 1}}); for (let i = 0; i < 3; i++) step();
    ok((G.grudge || []).some(q => q.name === g3.name && q.until > c.hour), `打了${g3.name}：附近的聚落一週不理你`);
    const gr = G.grudge.find(q => q.name === g3.name); G.base = gr.tile; G.hq.sub = null; ok(/沒有人願意跟你說話|基地要停在聚落/.test(cmd({type: 'askLocal'}) || ''), '在那一帶打聽：沒人理'); }
  else ok(false, `打不了原住民：${tk}`); }
console.log(bad ? `${bad} 項不對` : '全部正常');
