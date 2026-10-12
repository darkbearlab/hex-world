// 移動基地的規則檢查（Alan 2026-10-12，DESIGN.md「移動基地」）：運兵車、集合點、基地到場、搶購、搜索、留言、登記地。
// node chimera/stats/hq-check.mjs 存檔.json（admin/save 的回應或 core.save()）
import fs from 'fs';
import {Core} from '../core.js';
import * as G from '../company.js';
import {hdist} from '../sim.js';

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), seed = raw.save ? raw.seed : '奇美拉-1';
const c = new Core(() => {}); c.load(seed, raw.save || raw); c.enableNpcs();
const K = c.sim.peek(), towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
let bad = 0; const ok = (cond, text) => { console.log(`${cond ? '✓' : '✗'} ${text}`); if (!cond) bad++; };
const N = '基地測試', run = (h = 1) => c.advanceTo(c.hour + h), cmd = m => c.command(m, N);
c.found(towns[5], N); const g = c.co(N); g.cash += 3000;
for (let i = 0; i < 14; i++) g.roster.push({...JSON.parse(JSON.stringify(g.roster[0])), uid: c.game.book.cloneSeq++, id: `Q-${i}`, status: 'home', record: []});
const home = () => g.roster.filter(x => x.alive && x.status === 'home' && !x.keep).map(x => x.uid);
const board = () => c.boardView(N).filter(e => !e.joined && c.hour >= e.start && c.hour < e.closeAt && !e.gone && !['drill', 'camp', 'front', 'hunting', 'security'].includes(e.kind));
run(2);

// 1. 運兵車：一次一台、四個人
const far = board().find(e => !e.here && e.kind !== 'tense');
ok(far, `有不在現場的委託可以測（${far?.title}）`);
ok(/四個人|4 個人/.test(cmd({type: 'accept', kind: far.kind, tile: far.tile, side: '', uids: home().slice(0, 6)}) || ''), '不在現場：派六個人被拒（一台車四人）');
ok(cmd({type: 'accept', kind: far.kind, tile: far.tile, side: '', uids: home().slice(0, 4)}) === null, '不在現場：派四個人坐一台車');
const sq = Object.values(c.game.book.squads).find(s => s.player === N && s.caseId); ok(sq?.van === true && sq.meet === g.base, `小隊坐車、集合點是基地現在的位置（van ${sq?.van}、meet ${sq?.meet}）`);
ok(G.vansUsed(g, c.game.book) === 1, `佔一台車（${G.vansUsed(g, c.game.book)}/${G.vanCap(g)}）`);
const other = board().find(e => e.tile !== far.tile && !e.here && e.kind !== 'tense'); cmd({type: 'accept', kind: other.kind, tile: other.tile, side: '', uids: home().slice(0, 4)});
const third = board().find(e => e.tile !== far.tile && e.tile !== other.tile && !e.here && e.kind !== 'tense');
ok(/運兵車都派出去了/.test(cmd({type: 'accept', kind: third.kind, tile: third.tile, side: '', uids: home().slice(0, 4)}) || ''), '兩台車都出去了：第三隊被拒');

// 2. 大戰役、勢力戰要基地到場
const front = c.boardView(N).find(e => e.kind === 'front' && !e.here && c.hour < e.closeAt);
if (front) ok(/勢力戰要把基地開過去/.test(cmd({type: 'accept', kind: 'front', tile: front.tile, side: 'att', uids: home().slice(0, 2)}) || ''), '勢力戰：基地不在現場被拒'); else console.log('（現在沒有勢力戰可以測）');

// 3. 基地到場：直接派、不用車、不限隊數
const spot = board().find(e => e.tile !== far.tile && e.tile !== other.tile && e.kind !== 'tense' && towns.some(t => hdist(t, e.tile) <= 1));
const parkAt = towns.find(t => hdist(t, spot.tile) <= 1);
ok(cmd({type: 'baseGo', tile: parkAt}) === null || g.base === parkAt, `基地開往 ${c.w.names[parkAt]}（${spot.title} 旁邊）`);
for (let i = 0; i < 400 && !G.parked(g); i++) { run(1); for (const t of c.game.book.tickets.filter(t => t.player === N && !t.done)) cmd({type: 'resolve', ticket: t.id}); }
ok(g.base === parkAt && G.parked(g), `基地到了（${c.w.names[g.base]}）`);
const e2 = c.boardView(N).find(e => e.tile === spot.tile && e.kind === spot.kind);
ok(e2?.here, '委託板標示基地在現場');
ok(cmd({type: 'accept', kind: spot.kind, tile: spot.tile, side: '', uids: home().slice(0, 8)}) === null, '基地在現場：一次派八個人（兩隊）');
const spotCase = g.cases.at(-1), sqs = Object.values(c.game.book.squads).filter(s => s.player === N && s.caseId === spotCase);   // 剛接下的案件（案件的地點不一定是委託那一格，例如私掠許可）
ok(sqs.length === 2 && sqs.every(s => !s.van), `兩隊、都不佔車（${sqs.map(s => s.van).join(',')}）`);

// 4. 集合點：基地開走，回來的人在集合點等；基地回來就上車
const meet = g.base, away = sqs[0].clones.map(x => x.uid);
const dest = towns.filter(t => hdist(t, meet) >= 6 && hdist(t, meet) <= 10)[0]; cmd({type: 'baseGo', tile: dest});
for (let i = 0; i < 600; i++) { run(1); for (const t of c.game.book.tickets.filter(t => t.player === N && !t.done)) cmd({type: 'resolve', ticket: t.id}); if (g.returning.some(r => away.includes(r.uid) && r.wait != null)) break; }
const waiting = g.returning.filter(r => away.includes(r.uid) && r.wait != null);
ok(waiting.length > 0, `基地不在：回來的人在集合點 ${c.w.names[meet]} 等（${waiting.length} 人，補給撐到第 ${waiting[0]?.wait} 小時）`);
ok(c.view(N).data.units.some(u => u.kind === 'waiting'), '地圖上畫出在集合點等的人');
cmd({type: 'baseGo', tile: meet}); for (let i = 0; i < 200 && (g.base !== meet || !G.parked(g)); i++) { run(1); for (const t of c.game.book.tickets.filter(t => t.player === N && !t.done)) cmd({type: 'resolve', ticket: t.id}); }
run(1);
ok(away.every(u => { const x = g.roster.find(y => y.uid === u); return !x.alive || x.status === 'home'; }), '基地開回集合點：等的人上車了');

// 5. 等不到：倒在集合點
const fresh = home().slice(0, 2), x0 = g.roster.find(x => x.uid === fresh[0]);
x0.status = 'returning'; g.returning.push({uid: x0.uid, at: c.hour, to: dest, van: null});
for (let i = 0; i < 60; i++) run(1);
ok(!x0.alive && x0.downAs === 'lost' && x0.record.some(e => e.t === 'down' && e.tile === dest) && ((c.game.book.bodies || []).some(b => b.uid === x0.uid && b.tile === dest) || x0.record.some(e => e.t === 'transfer' || e.t === 'recovered')), `等了 48 小時基地沒來：倒在 ${c.w.names[dest]}（遺體留在那裡，7 天內可能被撿走）`);

// 6. 搶購、留言、登記、買車、遠征點
c.worldBits(c.hour - c.hour % 24 + 6); const d = c.game.book.deals.find(x => true);
if (d) { g.base = d.tile; G.ensureHq(g).route = []; g.hq.move = null; while (c.hour < d.open) run(1);
  const cash = g.cash; ok(cmd({type: 'deal', id: d.id}) === null, `搶購：${d.title}`); run(1); ok(g.cash < cash, '扣了錢');
  ok(/已經買過了/.test(cmd({type: 'deal', id: d.id}) || ''), '同一筆不能買兩次'); }
ok(cmd({type: 'note', text: '到此一遊'}) === null && c.view(N).data.here.notes.length === 1, '留言留在這一格');
ok(/六小時/.test(cmd({type: 'note', text: '再一則'}) || ''), '同一格六小時內只能留一則');
ok(cmd({type: 'say', text: '有人嗎'}) === null && c.view(N).data.here.chat.length === 1, '對話');
const home0 = g.home; ok(cmd({type: 'register'}) === null || g.home === g.base, `換登記到 ${c.w.names[g.base]}`); run(1); ok(g.home === g.base && g.home !== home0, '登記地換了');
ok(/一季/.test(cmd({type: 'register'}) || '') || /已經登記/.test(cmd({type: 'register'}) || ''), '一季只能換一次');
ok(cmd({type: 'buyVan'}) === null, '買第三台運兵車'); run(1); ok(G.vanCap(g) === 3, `運兵車 ${G.vanCap(g)} 台`);
const site = (c.game.book.sites || []).find(s => s.kind === 'ruin' || s.kind === 'mine');
if (site) { g.base = site.tile; g.hq.route = []; g.hq.move = null; const m0 = g.mats.implant; ok(cmd({type: 'baseSearch'}) === null, `在遠征點搜索：${site.title}`);
  for (let i = 0; i < 6; i++) run(1); ok(g.mats.implant > m0, `搜到東西（植入物 ${m0} → ${g.mats.implant}）`);
  ok(/搜過了/.test(cmd({type: 'baseSearch'}) || ''), '同一處不能馬上再搜'); }
const fp = c.fingerprint(), d2 = new Core(() => {}); d2.load(seed, JSON.parse(JSON.stringify(c.save()))); ok(d2.fingerprint() === fp, '存檔讀回一樣');
console.log(bad ? `\n${bad} 項不對` : '\n全部通過'); process.exit(bad ? 1 : 0);
