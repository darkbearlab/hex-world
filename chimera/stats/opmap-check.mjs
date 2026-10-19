// 作戰地圖（OPMAP.md 第 1 段）：小格鋪滿不重疊、同一格每次一樣、道路接得起來、城在中心
// node chimera/stats/opmap-check.mjs 存檔.json
import fs from 'fs';
import {Core} from '../core.js';
import * as S from '../sim.js';
import {cellsOf, mapData, expand, center, hexDist, key, DIRS} from '../opmap.js';
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = new Core(() => {}); c.load(raw.seed, raw.save);
const snap = c.snapshot(), ST = {W: S.W, N: S.N, land: c.w.land, river: Array.from(c.w.river), riverPaths: c.w.riverPaths};
const D = mapData(ST, snap, t => S.NBR[t]);
let bad = 0; const ok = (x, m) => { console.log(`${x ? '✓' : '✗'} ${m}`); if (!x) bad++; };
// 1. 鋪滿：一塊 10×10 戰略格展開後，小格不重疊；每格 37 小格
const block = []; for (let r = 10; r < 20; r++) for (let q = 10; q < 20; q++) block.push(r * S.W + q);
let total = 0; const seen = new Map(), dup = []; for (const t of block) { const m = cellsOf(t, D); total += m.size; for (const k of m.keys()) { if (seen.has(k)) dup.push(k); seen.set(k, t); } }
ok(total === block.length * 37 && !dup.length, `100 格展開成 ${total} 小格，重疊 ${dup.length}`);
// 沒有洞：內部戰略格的中心周圍半徑 R+1 的小格都屬於某一格
let holes = 0; for (const t of block.filter(t => S.col(t) > 11 && S.col(t) < 18 && S.row(t) > 11 && S.row(t) < 18)) { const cc = center(t, S.W); for (let dq = -5; dq <= 5; dq++) for (let dr = -5; dr <= 5; dr++) if (hexDist([dq, dr], [0, 0]) <= 5 && !seen.has(key(cc[0] + dq, cc[1] + dr))) holes++; }
ok(holes === 0, `內部沒有洞（${holes}）`);
// 2. 同一格每次一樣
const t0 = block[55]; ok(JSON.stringify([...cellsOf(t0, D)]) === JSON.stringify([...cellsOf(t0, D)]), '同一格展開兩次一樣');
// 3. 道路接得起來：每條道路邊，兩格的道路小格在交界相鄰
const roads = snap.roads; let broken = 0;
for (const [a, b] of roads.slice(0, 300)) { const m = expand([a, b], D), rs = [...m.values()].filter(x => x.road); const A = rs.filter(x => x.t === a), B = rs.filter(x => x.t === b); if (!A.some(x => B.some(y => hexDist([x.q, x.r], [y.q, y.r]) <= 1))) broken++; }
ok(roads.length > 0 && broken === 0, `道路 ${roads.length} 段，斷掉的 ${broken}`);
// 4. 城在中心
const towns = snap.towns.map(x => x.t); let off = 0; for (const t of towns) { const m = cellsOf(t, D), cc = center(t, S.W); if (m.get(key(cc[0], cc[1]))?.f !== 'town') off++; }
ok(off === 0, `${towns.length} 座城都在中心（${off} 個不對）`);
// 地形分布
const cnt = {}; for (const t of block) for (const x of cellsOf(t, D).values()) { cnt[x.k] = (cnt[x.k] || 0) + 1; if (x.f) cnt['f:' + x.f] = (cnt['f:' + x.f] || 0) + 1; }
console.log('地形', JSON.stringify(cnt));
console.log(bad ? `${bad} 項不對` : '全部正常');
