// 作戰地圖第 2 段收尾（OPMAP.md）：基地停在某一小格、同一格裡挪動、從小格出發先回中心；城裡判定；打完要整頓；運兵車被兵牌攔下
// node chimera/stats/sub-check.mjs 存檔.json
import fs from 'fs';
import {Core} from '../core.js';
import {NEAR, basePos} from '../near.js';
import {TRIP} from '../cases.js';
import * as Gm from '../company.js';
import {hdist, W} from '../sim.js';
import {center, cellsOf, hexDist, DIRS, TERRAIN} from '../opmap.js';
import {od} from '../near.js';
NEAR.on = true; TRIP.dice = false;
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = new Core(() => {}); c.load(raw.seed, raw.save);
const K = c.sim.peek(), w = c.w, N = '小格測試';
let bad = 0; const ok = (x, m) => { console.log(`${x ? '✓' : '✗'} ${m}`); if (!x) bad++; };
const home = 1398; c.found(home, N); const G = c.game.cos[N], cmd = m => c.command(m, N), run = n => { for (let i = 0; i < n; i++) c.advanceTo(c.hour + 1); };
const c0 = center(home, W), cells = [...cellsOf(home, od(w)).values()];
const far = cells.filter(x => isFinite(TERRAIN[x.k].car) && hexDist([x.q, x.r], c0) === 3)[0];
ok(Gm.inTown(G, w), '一開始在城裡');
ok(cmd({type: 'baseGo', tile: home, sub: [far.q, far.r]}) === null, `同一格挪到邊上的小格 ${far.q},${far.r}`);
ok(!Gm.parked(G), '挪動中不算停著');
run(2); ok(G.hq.sub && G.hq.sub[0] === far.q && G.hq.sub[1] === far.r, `停在那一小格（${JSON.stringify(G.hq.sub)}）`);
ok(!Gm.inTown(G, w), '停在城的邊上（離中心 3 小格）不算在城裡');
const bp = basePos(G, w, c.hour); ok(bp[0] === far.q && bp[1] === far.r, '基地在作戰地圖上的位置＝那一小格');
// 從小格出發：先回中心再上路
const dest = Object.keys(K.markets).map(Number).find(t => t !== home && K.owner[t] >= 0 && hdist(t, home) >= 2 && hdist(t, home) <= 5 && isFinite(c.sim.pmc.dist(home, t)));
ok(cmd({type: 'baseGo', tile: dest}) === null, `開往 ${w.names[dest]}`);
ok(!!G.hq.subMove && !G.hq.move, '先回這一格的中心');
for (let i = 0; i < 48 && (G.base !== dest || !Gm.parked(G)); i++) { run(1); for (const t of c.game.book.tickets.filter(t => t.player === N && !t.done)) cmd({type: 'resolve', ticket: t.id}); }
ok(G.base === dest && Gm.parked(G) && !G.hq.sub, `到了 ${w.names[dest]}，停在中心`);
// 打完要整頓
G.hq.holdUntil = c.hour + 1; ok(cmd({type: 'baseGo', tile: home}) === '剛打完，正在整頓', '整頓中不能開走'); G.hq.holdUntil = 0;
// 運兵車被攔：派一台車往遠處，旁邊放一隻掠奪者
const site = Object.keys(K.markets).map(Number).find(t => t !== dest && K.owner[t] >= 0 && hdist(t, dest) >= 3 && hdist(t, dest) <= 8 && isFinite(c.sim.pmc.dist(dest, t)));
const uids = G.roster.filter(x => x.alive && x.status === 'home').slice(0, 2).map(x => x.uid);
const e = cmd({type: 'sortie', tile: site, mode: 'talk', uids}); ok(!e, `派運兵車去 ${w.names[site]}（${e || '出發'}）`);
run(1);
const sq = Object.values(c.game.book.squads).find(s => s.player === N && s.van && s.move);
let ambushed = false; if (process.env.DBG) console.log('DBG sq', !!sq, sq && {van: sq.van, move: sq.move && {t0: sq.move.t0, t1: sq.move.t1, len: sq.move.path?.length}, h: c.hour, busy: sq.busy}, (await import('../near.js')).eyes(G, c.game.book, w, c.hour).map(e => e.kind + '@' + e.tile + ':' + e.pos));
for (let i = 0; i < 30 && sq && !ambushed; i++) {
  // 在車的前面一小格放一隻掠奪者
  const E = (await import('../near.js')).eyes(G, c.game.book, w, c.hour).find(x => x.kind === 'van'); if (!E) break;
  G.hq.near = [{id: 900 + i, kind: 'bandit', tile: E.tile, pos: [E.pos[0] + 1, E.pos[1]], mins: 0, born: c.hour, str: 3}];
  run(1); ambushed = !!sq.busy; if (process.env.DBG && i < 3) console.log('DBG', i, JSON.stringify(G.hq.near), sq.busy, E.pos);
}
ok(ambushed, '運兵車被兵牌攔下，開了行軍遇襲的單');
console.log(bad ? `${bad} 項不對` : '全部正常');
