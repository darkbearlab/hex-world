// PVP 地圖生成器（原型，Alan 2026-10-15「你試試看」）：27×27，照 pvp/DESIGN.md 的地圖規則
// - 房間用二分切割（BSP），切割線是牆，牆上開門；只生成一半，另一半轉 180 度（骨架對稱，公平）
// - 牆有三種：厚牆 #（擋路擋視線）、窗 =（看得到、打得到、不能過）、門口 +（可以過、看得穿）
// - 檢查：每個房間至少兩個出入口、房間的連接圖沒有橋（任何一條通道都能被繞過）、雙方在對角的房間開場
// - 指標：雙方最短距離、開場到中央、視線長度分布、環路數；不合格就修（補門），修不好就重生
// 預覽圖：node pvp/tools/mapgen-sheet.mjs [張數 6] [起始種子 1] → pvp/tools/out/maps.png（每張下面一排是雙方開場：藍＝A、紅＝B）
// 這個檔不用 node 的模組（Worker 的伺服器也會載入它）

export const N = 27, C = 13;   // 地圖邊長、中心
const FLOOR = '.', WALL = '#', WINDOW = '=', DOOR = '+', COVER = 'c';
const rng = s => () => ((s = Math.imul(s ^ s >>> 15, 1 | s) + 0x6D2B79F5 | 0, ((s ^ s >>> 14) >>> 0) / 4294967296));
const rot = (x, y) => [N - 1 - x, N - 1 - y];
const passable = t => t === FLOOR || t === DOOR || t === COVER;
const seeThrough = t => t === FLOOR || t === DOOR || t === WINDOW;   // 掩體（c）擋一部分視線；這裡的視線長度只算完全開闊的

export function generate(seed, opt = {}) {
  const r = rng(seed * 2654435761 >>> 0 || 1), pick = a => a[Math.floor(r() * a.length)];
  for (let tries = 0; tries < 200; tries++) {
    const T = Array.from({length: N}, (_, y) => Array.from({length: N}, (_, x) => x === 0 || y === 0 || x === N - 1 || y === N - 1 ? WALL : FLOOR));
    const set = (x, y, t) => { T[y][x] = t; const [a, b] = rot(x, y); T[b][a] = t; };
    // 1. BSP：只切上半部（含中線的一半），每條切割線開 1～2 個門、偶爾一段窗
    const lines = [];
    const split = (x0, y0, x1, y1, depth) => {
      const w = x1 - x0 + 1, h = y1 - y0 + 1, min = opt.min || 4;
      const canV = w >= 2 * min + 1, canH = h >= 2 * min + 1;
      if ((!canV && !canH) || depth > 4 || (depth > 1 && r() < .18)) return;
      const vert = canV && (!canH || w > h ? r() < .8 : r() < .3);
      if (vert) { const x = x0 + min + Math.floor(r() * (w - 2 * min)); lines.push({v: true, at: x, a: y0, b: y1}); split(x0, y0, x - 1, y1, depth + 1); split(x + 1, y0, x1, y1, depth + 1); }
      else { const y = y0 + min + Math.floor(r() * (h - 2 * min)); lines.push({v: false, at: y, a: x0, b: x1}); split(x0, y0, x1, y - 1, depth + 1); split(x0, y + 1, x1, y1, depth + 1); }
    };
    const mid = r() < .7;   // 中線要不要是一道牆：是的話上半部只切到中線上面一列，免得切出一格寬的長條房
    split(1, 1, N - 2, mid ? C - 1 : C, 0);
    for (const L of lines) {
      const cells = []; for (let i = L.a; i <= L.b; i++) cells.push(L.v ? [L.at, i] : [i, L.at]);
      for (const [x, y] of cells) set(x, y, WALL);
      const nd = 1 + (cells.length > 7 && r() < .55 ? 1 : 0);
      const inner = cells.slice(1, -1); if (!inner.length) continue;
      for (let k = 0; k < nd; k++) { const [x, y] = pick(inner); set(x, y, DOOR); }
      if (cells.length > 5 && r() < .45) { const s = 1 + Math.floor(r() * (cells.length - 4)); for (let i = s; i < s + 2; i++) { const [x, y] = cells[i]; if (T[y][x] === WALL) set(x, y, WINDOW); } }
    }
    // 中線（第 13 列）：上下兩半的交界。左半段的格子決定右半段（轉 180 度），開幾個口讓兩半接起來
    if (mid) { for (let x = 1; x < C; x++) set(x, C, WALL); for (let k = 0; k < 2; k++) set(1 + Math.floor(r() * (C - 2)), C, DOOR); if (r() < .5) set(C - 1 - Math.floor(r() * 3), C, WINDOW); }
    // 2. 房間、連接：房間＝地板的連通塊（門口、窗不算房間內），門口連接它兩邊的房間
    const fix = () => { const g = graphOf(T); return g; };
    let g = fix();
    // 3. 修：出入口不到兩個的房間、橋，補門（成對：轉 180 度的那一格也開）
    for (let k = 0; k < 40 && !ok(g); k++) {
      const bad = new Set([...g.rooms.filter(R => R.doors.size < 2).map(R => R.id), ...g.bridges.flatMap(([a, b]) => [a, b])]);
      const cand = [];
      for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if (T[y][x] === WALL || T[y][x] === WINDOW) {
        const ab = [[[x - 1, y], [x + 1, y]], [[x, y - 1], [x, y + 1]]].map(([p, q]) => [g.room[p[1]][p[0]], g.room[q[1]][q[0]]]).find(([p, q]) => p >= 0 && q >= 0 && p !== q);
        if (ab && (bad.has(ab[0]) || bad.has(ab[1]))) cand.push([x, y]);
      }
      if (!cand.length) break;
      const [x, y] = pick(cand); set(x, y, DOOR); g = fix();
    }
    if (!ok(g)) continue;
    // 4. 掩體：房間裡（不擋門口、不貼門）撒一些，對稱
    const nearDoor = (x, y) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => T[y + dy]?.[x + dx] === DOOR);
    for (let y = 2; y <= C; y++) for (let x = 2; x < N - 2; x++) {
      if (y === C && x >= C) continue;
      if (T[y][x] === FLOOR && !nearDoor(x, y) && r() < (opt.cover ?? .07)) { set(x, y, COVER); if (!ok(graphOf(T)) || !connected(T)) set(x, y, FLOOR); }
    }
    g = graphOf(T); if (!ok(g) || !connected(T)) continue;
    // 開場（Alan 2026-10-15：角落對角走到接觸要 29 回合，太長）：九宮格的 4 和 6（左中、右中）或 2 和 8（下中、上中），轉 180 度剛好是對方
    const mode = opt.spawn || (r() < .5 ? '46' : '28'), A = mode === '46' ? spawnNear(T, 2, C) : spawnNear(T, C, N - 3), B = A && rot(...A);
    if (!A || g.room[A[1]][A[0]] === g.room[B[1]][B[0]]) continue;
    // 光（Alan 2026-10-15：黑暗與消焰）：每個房間亮（2）或全黑（0），轉 180 度對稱；開場的房間一定亮。門口、窗跟著旁邊的房間
    const L = lightOf(T, g, r, opt.dark ?? .35, [A, B]);
    return {T, L, seed, tries, g, A, B, spawn: mode, m: metrics(T, g, A, B)};
  }
  return null;
}
function lightOf(T, g, r, dark, spawns) {
  const lv = new Map(), keyOf = id => id, spawnRooms = new Set(spawns.map(([x, y]) => g.room[y][x]));
  const L = T.map(row => row.map(() => 2));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const id = g.room[y][x]; if (id < 0) continue;
    const [a, b] = rot(x, y), twin = g.room[b][a];   // 對稱：轉過去那一格的房間用同一個決定（兩個房間的編號小的那個決定）
    const k = Math.min(id, twin < 0 ? id : twin);
    if (!lv.has(k)) lv.set(k, spawnRooms.has(id) || spawnRooms.has(twin) ? 2 : r() < dark ? 0 : 2);
    L[y][x] = lv.get(k);
  }
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if (g.room[y][x] < 0) { const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].map(([a, b]) => L[b][a]).filter((v, i) => g.room[[y, y, y - 1, y + 1][i]][[x - 1, x + 1, x, x][i]] >= 0); L[y][x] = nb.length && nb.every(v => v === 0) ? 0 : 2; }
  return L;
}
const ok = g => g.rooms.length >= 4 && g.rooms.every(R => R.doors.size >= 2) && !g.bridges.length;
// 離 (x0,y0) 最近的地板（中線那一列可能剛好是牆）
function spawnNear(T, x0, y0) { for (let d = 0; d < 8; d++) for (let y = y0 - d; y <= y0 + d; y++) for (let x = x0 - d; x <= x0 + d; x++) if (Math.max(Math.abs(x - x0), Math.abs(y - y0)) === d && T[y]?.[x] === FLOOR) return [x, y]; return null; }
function spawnOf(T, x0, y0) { for (let d = 0; d < 6; d++) for (let y = y0; y <= y0 + d; y++) for (let x = x0; x <= x0 + d; x++) if (T[y]?.[x] === FLOOR) return [x, y]; return null; }
function connected(T) {
  let s = null, n = 0; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (passable(T[y][x])) { n++; s ||= [x, y]; }
  return bfs(T, s).reach === n;
}
function bfs(T, s) {
  const D = Array.from({length: N}, () => Array(N).fill(-1)), q = [s]; D[s[1]][s[0]] = 0; let reach = 1;
  for (let i = 0; i < q.length; i++) { const [x, y] = q[i]; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (D[Y]?.[X] === -1 && passable(T[Y][X])) { D[Y][X] = D[y][x] + 1; reach++; q.push([X, Y]); } } }
  return {D, reach};
}
// 房間＝地板（含掩體）的連通塊；門口連接上下或左右兩邊不同的房間
export function graphOf(T) {
  const room = Array.from({length: N}, () => Array(N).fill(-1)), rooms = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((T[y][x] === FLOOR || T[y][x] === COVER) && room[y][x] < 0) {
    const id = rooms.length, q = [[x, y]]; room[y][x] = id; const R = {id, cells: 0, doors: new Set()};
    for (let i = 0; i < q.length; i++) { const [a, b] = q[i]; R.cells++; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = a + dx, Y = b + dy; if (room[Y]?.[X] === -1 && (T[Y][X] === FLOOR || T[Y][X] === COVER)) { room[Y][X] = id; q.push([X, Y]); } } }
    rooms.push(R);
  }
  const edges = [];
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if (T[y][x] === DOOR) {
    const sides = [...new Set([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].map(([a, b]) => room[b][a]).filter(v => v >= 0))];
    for (const id of sides) rooms[id].doors.add(`${x},${y}`);
    if (sides.length >= 2) edges.push([sides[0], sides[1], `${x},${y}`]);
  }
  return {room, rooms, edges, bridges: bridgesOf(rooms.length, edges)};
}
// 橋（Tarjan）：同一對房間之間有兩個門就不是橋
function bridgesOf(n, edges) {
  const adj = Array.from({length: n}, () => []); edges.forEach(([a, b], i) => { adj[a].push([b, i]); adj[b].push([a, i]); });
  const tin = Array(n).fill(-1), low = Array(n).fill(0), out = []; let t = 0;
  const dfs = (v, pe) => { tin[v] = low[v] = t++; for (const [u, i] of adj[v]) { if (i === pe) continue; if (tin[u] >= 0) low[v] = Math.min(low[v], tin[u]); else { dfs(u, i); low[v] = Math.min(low[v], low[u]); if (low[u] > tin[v]) out.push([v, u]); } } };
  for (let v = 0; v < n; v++) if (tin[v] < 0) dfs(v, -1);
  return out;
}
function metrics(T, g, A, B) {
  const da = bfs(T, A).D, dist = da[B[1]][B[0]];
  let center = 99; for (const [x, y] of [[C, C], [C - 1, C], [C, C - 1], [C + 1, C], [C, C + 1]]) if (da[y][x] >= 0) center = Math.min(center, da[y][x]);
  // 視線：每一列、每一行裡完全開闊的連續段長度（看得穿的格子）
  const runs = {短: 0, 中: 0, 長: 0};
  const add = len => { if (len >= 3) runs[len <= 5 ? '短' : len <= 10 ? '中' : '長']++; };
  for (let y = 1; y < N - 1; y++) { let n = 0; for (let x = 0; x < N; x++) { if (seeThrough(T[y][x])) n++; else { add(n); n = 0; } } add(n); }
  for (let x = 1; x < N - 1; x++) { let n = 0; for (let y = 0; y < N; y++) { if (seeThrough(T[y][x])) n++; else { add(n); n = 0; } } add(n); }
  return {rooms: g.rooms.length, doors: g.edges.length, loops: g.edges.length - g.rooms.length + 1, dist, center, runs};
}

/* ───── 預覽圖 ───── */
