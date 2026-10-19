// 戰略地圖的戰爭迷霧（OPMAP.md 第 3 段）：開公司時看得到基地四周 4 格；開過去的地方一直記得；現在看著的只有基地和運兵車四周；線上（NEAR 沒開）沒有迷霧
import fs from 'fs';
import {Core} from '../core.js';
import {NEAR} from '../near.js';
import {hdist} from '../sim.js';
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let bad = 0; const ok = (x, m) => { console.log(`${x ? '✓' : '✗'} ${m}`); if (!x) bad++; };
{ NEAR.on = false; const c = new Core(() => {}); c.load(raw.seed, raw.save); c.found(1398, '線上'); ok(c.view('線上').data.fog === null, '線上沒有迷霧'); }
NEAR.on = true;
const c = new Core(() => {}); c.load(raw.seed, raw.save); const K = c.sim.peek(), N = '迷霧測試';
c.found(1398, N); const G = c.game.cos[N];
let F = c.view(N).data.fog; ok(F && F.seen.length >= 40 && F.seen.length <= 61 && F.vis.length === F.seen.length, `開公司：看過 ${F.seen.length} 格、現在看著 ${F.vis.length} 格`);
ok(F.seen.every(t => hdist(t, 1398) <= 4), '看過的都在基地 4 格內');
const dest = Object.keys(K.markets).map(Number).find(t => K.owner[t] >= 0 && hdist(t, 1398) >= 8 && isFinite(c.sim.pmc.dist(1398, t)));
c.command({type: 'baseGo', tile: dest}, N);
for (let i = 0; i < 200 && G.base !== dest; i++) { c.advanceTo(c.hour + 1); for (const t of c.game.book.tickets.filter(t => t.player === N && !t.done)) c.command({type: 'resolve', ticket: t.id}, N); }
F = c.view(N).data.fog;
ok(G.base === dest, `開到 ${c.w.names[dest]}`);
ok(F.seen.length > 100 && F.seen.includes(1398), `沿路看過 ${F.seen.length} 格（出發地還記得）`);
ok(!F.vis.includes(1398) && F.vis.every(t => hdist(t, dest) <= 4), '現在看著的只有基地四周');
console.log(bad ? `${bad} 項不對` : '全部正常');
