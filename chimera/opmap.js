// 作戰地圖（Alan 2026-10-19，warband/OPMAP.md）：一個戰略格切成半徑 3 的小六角群（37 小格），內容全部從沙盒的資料來——
// 生態決定地形（交界處跟鄰格混合）、貿易路線變成道路、河流穿過、城在中心、聚落照人口撒、戰壕與廢墟照那一格的數字。
// 同一格不管什麼時候展開都一樣（照格子編號算的雜湊），不存檔。瀏覽器和伺服器共用這一份。
//
// 座標：小格用軸座標 (q, r)（尖頂六角）。戰略格 (col, row) 是 odd-r 偏移，換成軸座標後乘上「半徑 R 的六角群」的晶格：
//   往 (q+1, r) 的鄰格 ＝ 小格位移 A＝(2R+1, −R)；往 (q, r+1) ＝ B＝(R, R+1)；往 (q−1, r+1) ＝ B−A。三個方向的距離都是 2R+1，六角群剛好鋪滿不重疊。
export const OP = {R: 3};
const R = OP.R, A = [2 * R + 1, -R], B = [R, R + 1];
// 地形：每小格要幾分鐘（車、徒步），之後兵牌再乘自己的倍率；過不去＝Infinity（OPMAP.md 第三節）
export const TERRAIN = {
  road:   {n: '道路', car: 4, foot: 10, c: '#c9b48a'},
  plain:  {n: '平地', car: 8, foot: 12, c: '#b3a466'},
  rough:  {n: '荒地', car: 12, foot: 15, c: '#a78f68'},
  forest: {n: '林', car: 12, foot: 15, c: '#6a7440'},
  slow:   {n: '鹽沼', car: 20, foot: 20, c: '#76857a'},
  trench: {n: '戰壕', car: 20, foot: 20, c: '#6b5a44'},
  cliff:  {n: '崖', car: Infinity, foot: Infinity, c: '#d9cdb8'},
  water:  {n: '水', car: Infinity, foot: Infinity, c: '#34474c'},
};
// 生態（sim.js 的 BIOMES）→ 地形的比例
const MIX = [
  [['water', 1]],                                     // 0 鹼海
  [['plain', .6], ['slow', .4]],                      // 1 鹼灘
  [['rough', .65], ['cliff', .35]],                   // 2 斷崖
  [['rough', .7], ['cliff', .15], ['plain', .15]],    // 3 岩山
  [['rough', .6], ['plain', .4]],                     // 4 礫丘
  [['plain', .7], ['rough', .3]],                     // 5 寒漠
  [['forest', .7], ['plain', .3]],                    // 6 油棘林
  [['plain', .85], ['rough', .15]],                   // 7 旱原
  [['rough', .7], ['plain', .3]],                     // 8 沙海
  [['slow', .75], ['plain', .25]],                    // 9 鹽沼
];
const col = (t, W) => t % W, row = (t, W) => Math.floor(t / W);
// 戰略格 → 軸座標 → 中心小格
export function axial(t, W) { const c = col(t, W), r = row(t, W); return [c - ((r - (r & 1)) >> 1), r]; }
export function center(t, W) { const [q, r] = axial(t, W); return [q * A[0] + r * B[0], q * A[1] + r * B[1]]; }
export const hexDist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[0] + a[1] - b[0] - b[1]));
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const key = (q, r) => q + ',' + r;
// 半徑 R 以內的位移（37 個）
const OFFS = []; for (let q = -R; q <= R; q++) for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) OFFS.push([q, r]);
// 兩個小格之間的直線（六角的線段，含頭尾）
export function line(a, b) {
  const n = hexDist(a, b), out = []; if (!n) return [a];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push(roundHex(a[0] + (b[0] - a[0]) * t + 1e-6, a[1] + (b[1] - a[1]) * t + 1e-6)); }
  return out;
}
function roundHex(q, r) { const s = -q - r; let rq = Math.round(q), rr = Math.round(r); const rs = Math.round(s); const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s); if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs; return [rq, rr]; }
// 照格子算的雜湊（不碰任何亂數狀態）
const hash = (...xs) => { let h = 2166136261 >>> 0; for (const x of xs) { h ^= (x | 0) + 0x9e3779b9; h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0; } return (h >>> 0) / 4294967296; };
const pickMix = (mix, u) => { let a = 0; for (const [k, p] of mix) { a += p; if (u < a) return k; } return mix[mix.length - 1][0]; };

// 產生一個戰略格的 37 小格。D＝地圖資料：{W, N, land, river（陣列，每格 0/1）, biome, pop, trench（0～80）, ruin（每格 0/1）, towns（Set）, roads（Map：格 → 相鄰的路格陣列）, nbr（格 → 鄰格陣列）}
export function cellsOf(t, D) {
  const c = center(t, D.W), out = new Map(), bio = D.biome[t];
  const nb = D.nbr(t);
  // 交界：每個位移最接近哪個鄰格的方向（用鄰格中心算）
  const nc = nb.map(n => ({n, c: center(n, D.W)}));
  for (const [dq, dr] of OFFS) {
    const q = c[0] + dq, r = c[1] + dr, edge = hexDist([dq, dr], [0, 0]) === R;
    let b = bio;
    if (edge && nc.length) { let best = null, bd = 1e9; for (const x of nc) { const d = hexDist([q, r], x.c); if (d < bd) { bd = d; best = x; } } if (best && D.land[best.n] && hash(t, q, r, 1) < .4) b = D.biome[best.n]; }
    let k = D.land[t] ? pickMix(MIX[b] || MIX[7], hash(t, q, r, 2)) : 'water';
    if (k === 'water' && D.land[t]) k = 'slow';   // 陸地格裡的「海」生態不會出現，保險
    out.set(key(q, r), {q, r, t, k, f: null});
  }
  if (!D.land[t]) return out;
  const set = (p, fn) => { const x = out.get(key(p[0], p[1])); if (x) fn(x); };
  // 中心不放崖（城、道路都從中心出發）
  set(c, x => { if (x.k === 'cliff') x.k = 'rough'; });
  // 河：照世界的河道（riverPaths 裡相鄰的兩格），從中心往河道的上下游各畫一半；有路經過的地方是橋（照道路走）
  for (const n of D.rivers.get(t) || []) { const x = nc.find(y => y.n === n); if (!x) continue; for (const p of half(c, x.c)) set(p, y => { y.river = true; y.k = 'water'; }); }
  // 道路：往每一個有路連過去的鄰格畫一半（鄰格自己畫另一半，就接起來了）；路蓋過河就是橋
  for (const n of D.roads.get(t) || []) { const x = nc.find(y => y.n === n); if (!x) continue; for (const p of half(c, x.c)) set(p, y => { if (y.k === 'water') y.wet = true; y.k = 'road'; y.road = true; }); }
  // 橋：路蓋在河上，而且兩邊都還是河（真的橫過去，不是沿著河走）
  for (const x of out.values()) if (x.wet) { const w = DIRS.filter(([dq, dr]) => { const y = out.get(key(x.q + dq, x.r + dr)); return y && y.k === 'water'; }).length; if (w >= 2) x.bridge = true; delete x.wet; }
  // 城：中心是城，外圍一圈是城郊
  if (D.towns.has(t)) { set(c, x => { x.f = 'town'; x.k = 'road'; }); for (const [dq, dr] of DIRS) set([c[0] + dq, c[1] + dr], x => { if (x.k !== 'water' && x.k !== 'cliff') { x.f = x.f || 'suburb'; if (!x.road) x.k = 'plain'; } }); }
  // 聚落：照人口撒（沒有城的格子也會有）
  const free = [...out.values()].filter(x => !x.f && x.k !== 'water' && x.k !== 'cliff');
  const nSet = D.pop[t] > 0 ? Math.min(4, 1 + (D.pop[t] > 40) + (D.pop[t] > 150) + (D.pop[t] > 500)) - (D.towns.has(t) ? 1 : 0) : 0;
  for (let i = 0; i < nSet && free.length; i++) { const j = Math.floor(hash(t, i, 3) * free.length); free.splice(j, 1)[0].f = 'settle'; }
  // 戰壕：照沙盒的戰壕程度，幾格戰壕（排成一段）
  const nT = Math.min(6, Math.round((D.trench[t] || 0) / 15));
  if (nT) { const s = free.filter(x => !x.f); if (s.length) { let x = s[Math.floor(hash(t, 4) * s.length)]; for (let i = 0; i < nT && x; i++) { x.k = 'trench'; x.trench = true; const d = DIRS[(Math.floor(hash(t, 5) * 3) * 2 + (i & 1)) % 6]; x = out.get(key(x.q + d[0], x.r + d[1])); if (x && (x.f || x.k === 'water')) x = null; } } }
  // 廢墟
  if (D.ruin[t]) { const s = free.filter(x => !x.f && x.k !== 'trench'); if (s.length) s[Math.floor(hash(t, 6) * s.length)].f = 'ruin'; }
  return out;
}
// 從中心到往鄰格中心的一半（3～4 小格）
function half(c, n) { const m = [c[0] + (n[0] - c[0]) / 2, c[1] + (n[1] - c[1]) / 2]; return line(c, roundHex(m[0] + 1e-6, m[1] + 1e-6)); }

// 地圖資料：從靜態資料（地形、河）＋這一季的快照（人口、戰壕、廢墟、城、道路）組起來
export function mapData(ST, snap, nbr) {
  const roads = new Map(); for (const [a, b] of snap.roads || []) { if (!roads.has(a)) roads.set(a, []); if (!roads.has(b)) roads.set(b, []); roads.get(a).push(b); roads.get(b).push(a); }
  const rivers = new Map(); for (const P of ST.riverPaths || []) for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i]; if (a === b) continue; if (!rivers.has(a)) rivers.set(a, []); if (!rivers.has(b)) rivers.set(b, []); rivers.get(a).push(b); rivers.get(b).push(a); }
  return {W: ST.W, N: ST.N, land: ST.land, river: ST.river, rivers, biome: snap.biome, pop: snap.pop, trench: snap.trench, ruin: snap.ruin || [], towns: new Set((snap.towns || []).map(x => x.t)), roads, nbr};
}
// 一群戰略格展開成一張作戰地圖（Map：小格 key → 小格）
export function expand(tiles, D) { const all = new Map(); for (const t of tiles) for (const [k, v] of cellsOf(t, D)) all.set(k, v); return all; }
// 兩個相鄰戰略格的中心之間，照地形走的小格路線（道路優先；車的分鐘數當成本）。回傳 [{q, r, at}]，at＝累積成本的比例（0～1），
// 畫面照「戰略上這一段走了幾成」放在路線上對應的位置——總時間還是戰略地圖算的，只是走的路照小格的地形
export function legRoute(a, b, D) {
  const cells = expand([a, b], D), s = center(a, D.W), g = center(b, D.W), K = key(s[0], s[1]), G = key(g[0], g[1]);
  const cost = x => { const m = TERRAIN[x.k]?.car; return isFinite(m) ? m : x.bridge ? 4 : Infinity; };
  const dist = new Map([[K, 0]]), prev = new Map(), open = [[0, K]];
  while (open.length) { open.sort((p, q) => p[0] - q[0]); const [d, k] = open.shift(); if (k === G) break; if (d > (dist.get(k) ?? Infinity)) continue; const x = cells.get(k);
    for (const [dq, dr] of DIRS) { const nk = key(x.q + dq, x.r + dr), y = cells.get(nk); if (!y) continue; const c = cost(y); if (!isFinite(c)) continue; const nd = d + c; if (nd < (dist.get(nk) ?? Infinity)) { dist.set(nk, nd); prev.set(nk, k); open.push([nd, nk]); } } }
  if (!dist.has(G)) return [{q: s[0], r: s[1], at: 0}, {q: g[0], r: g[1], at: 1}];   // 小格走不通（例如河上沒橋）：照直線畫
  const path = []; for (let k = G; k; k = prev.get(k)) { const x = cells.get(k); path.unshift({q: x.q, r: x.r, d: dist.get(k)}); if (k === K) break; }
  const tot = path[path.length - 1].d || 1; return path.map(p => ({q: p.q, r: p.r, at: p.d / tot}));
}
export function alongRoute(route, f) { for (let i = 1; i < route.length; i++) if (f <= route[i].at) { const a = route[i - 1], b = route[i], t = (f - a.at) / Math.max(1e-9, b.at - a.at); return [a.q + (b.q - a.q) * t, a.r + (b.r - a.r) * t]; } const z = route[route.length - 1]; return [z.q, z.r]; }
// 同一個戰略格裡，小格 a 走到小格 b（基地停到某一小格、從某一小格回到中心）：回傳 {path, minutes}；走不通就 null
export function subRoute(t, a, b, D, mult = 1.3) {
  const cells = cellsOf(t, D), K = key(a[0], a[1]), G = key(b[0], b[1]); if (K === G) return {path: [a], minutes: 0};
  const cost = x => { const m = TERRAIN[x.k]?.car; return isFinite(m) ? m * mult : x.bridge ? 4 * mult : Infinity; };
  const dist = new Map([[K, 0]]), prev = new Map(), open = [[0, K]];
  while (open.length) { open.sort((p, q) => p[0] - q[0]); const [d, k] = open.shift(); if (k === G) break; if (d > (dist.get(k) ?? Infinity)) continue; const x = cells.get(k);
    for (const [dq, dr] of DIRS) { const nk = key(x.q + dq, x.r + dr), y = cells.get(nk); if (!y) continue; const c = cost(y); if (!isFinite(c)) continue; const nd = d + c; if (nd < (dist.get(nk) ?? Infinity)) { dist.set(nk, nd); prev.set(nk, k); open.push([nd, nk]); } } }
  if (!dist.has(G)) return null;
  const path = []; for (let k = G; k; k = prev.get(k)) { const x = cells.get(k); path.unshift([x.q, x.r]); if (k === K) break; }
  return {path, minutes: dist.get(G)};
}
// 戰略格 t 往 n 走到一半時，在作戰地圖上的位置（小格的軸座標，帶小數）：從 t 的中心到 n 的中心內插
export function between(a, b, f, W) { const ca = center(a, W), cb = center(b, W); return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f]; }
// 伺服器端：直接從沙盒組地圖資料（跟 core.js snapshot 送給瀏覽器的數字一樣算法，兩邊展開出來的小格才會一模一樣）
export function dataFromSim(w, K, W, nbr) {
  const N = K.biome.length, pop = new Uint16Array(N), trench = new Uint8Array(N), ruin = new Uint8Array(N);
  for (let i = 0; i < N; i++) { pop[i] = Math.round(K.pop[i]); trench[i] = Math.round(K.trench[i] * 80); ruin[i] = K.ruin[i] ? 1 : 0; }
  const towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0).map(t => ({t}));
  return mapData({W, N, land: w.land, river: w.river, riverPaths: w.riverPaths || []}, {biome: K.biome, pop, trench, ruin, towns, roads: roadsOf(K)}, nbr);
}
export function roadsOf(K) {
  const rset = new Set(), roads = [];
  for (const rt of K.routes || []) { if (rt.sea || !rt.path) continue; for (let i = 1; i < rt.path.length; i++) { const a = rt.path[i - 1], b = rt.path[i], k = a < b ? a + '-' + b : b + '-' + a; if (a !== b && !rset.has(k)) { rset.add(k); roads.push([a, b]); } } }
  return roads;
}
