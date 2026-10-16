// PVP 地圖生成器：27×27，照 pvp/DESIGN.md 的地圖規則。generate＝第二版（在檔尾：大區、寬通道、半掩體、出煙口、鹵素燈）；generateV1＝第一版（以下這段：二分切割的小房間，留著比較用）
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

export function generateV1(seed, opt = {}) {
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

/* ───── 第二版（Alan 2026-10-15：「地方切得太碎、看起來通道很多其實沒有」，pvp/DESIGN.md「地圖第二版」） ─────
 * - 少而寬的牆：上半部一道橫牆、一到兩道直牆（長短不一，有時一端不接牆），每道開 2–3 格寬的開口；幾根柱子打斷長視線。只做一半，另一半轉 180 度。
 * - 半掩體：ASH 的矮隔板（擋不住子彈、站在後面有掩護、可以翻越），在空曠處一段一段（2–3 格）放在格子之間的邊上。
 * - 出煙口：上下各一個（對稱），放在長直線視線上；週期噴煙（ASH 的 vents，種類 smoke／haze，不用會燙傷的 steam）。
 * - 暗區與鹵素燈：主牆隔出的每一區亮或停電（對稱，開場那區一定亮）；停電的區照原作放鹵素燈（靠牆、約每 20 格一盞、至少一盞、分散）。
 * - 檢查：全部連通；「瓶頸」＝一格寬的格子，堵住它雙方要多繞 8 步以上（或過不去），有就重生。
 * - 戰壕：一到兩段（中間全身深 2、兩頭半身 1），規則照奇美拉戶外（pvp-game.js 的 protectingCover、trenchStep）。
 * 回傳 {T, L, A, B, P（矮隔板：[[x,y],[x2,y2]] 兩格之間）, D（戰壕深度 0/1/2）, lamps, vents, zones, seed, spawn, m}
 */
export function generate(seed, opt = {}) {
  const r = rng((seed * 2654435761 >>> 0) ^ 0x9e3779b9 || 1), pick = a => a[Math.floor(r() * a.length)], ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let tries = 0; tries < 300; tries++) {
    const T = Array.from({length: N}, (_, y) => Array.from({length: N}, (_, x) => x === 0 || y === 0 || x === N - 1 || y === N - 1 ? WALL : FLOOR));
    const set = (x, y, t) => { T[y][x] = t; const [a, b] = rot(x, y); T[b][a] = t; };
    // 1. 主牆：一道橫的（把上半部分成前後）、一到兩道直的；牆不一定接到兩端
    const walls = [];
    const hy = ri(4, C - 3), hx0 = r() < .35 ? ri(3, 6) : 1, hx1 = r() < .35 ? N - 2 - ri(3, 6) : N - 2;
    walls.push({v: false, at: hy, a: hx0, b: hx1});
    const nv = 1 + (r() < .6 ? 1 : 0);
    for (let k = 0; k < nv; k++) { const x = k === 0 ? ri(6, C - 2) : ri(C + 3, N - 7); const y0 = r() < .3 ? hy : 1, y1 = r() < .5 ? C - 1 : hy; if (y1 - y0 >= 3) walls.push({v: true, at: x, a: y0, b: y1}); }
    for (const W of walls) {
      const cells = []; for (let i = W.a; i <= W.b; i++) cells.push(W.v ? [W.at, i] : [i, W.at]);
      for (const [x, y] of cells) set(x, y, WALL);
      // 開口：2–3 格寬，牆越長開越多；不開在兩道牆的交叉點
      const n = 1 + (cells.length >= 10 ? 1 : 0) + (cells.length >= 18 ? 1 : 0); let made = 0;
      for (let k = 0; k < 30 && made < n; k++) {
        const w = r() < .5 ? 2 : 3, s0 = ri(1, cells.length - 1 - w); if (s0 < 1) continue;
        const span = cells.slice(s0, s0 + w); if (span.some(([x, y]) => T[y][x] !== WALL)) continue;
        if (span.some(([x, y]) => D4.filter(([dx, dy]) => T[y + dy]?.[x + dx] === WALL).length > 2)) continue;
        for (const [x, y] of span) set(x, y, FLOOR); made++;
      }
      // 偶爾一段窗（看得到、打得到、不能過）
      if (cells.length >= 8 && r() < .4) { const s0 = ri(1, cells.length - 3); for (const [x, y] of cells.slice(s0, s0 + 2)) if (T[y][x] === WALL) set(x, y, WINDOW); }
    }
    // 中線（第 13 列）：一半的機率有一道牆（開 2 個寬開口；轉 180 度後自己對稱）
    if (r() < .5) {
      for (let x = 1; x < C; x++) set(x, C, WALL);
      for (let k = 0, made = 0; k < 20 && made < 2; k++) { const w = r() < .5 ? 2 : 3, x0 = ri(1, C - w); if ([...Array(w)].some((_, i) => T[C][x0 + i] !== WALL)) continue; for (let i = 0; i < w; i++) set(x0 + i, C, FLOOR); made++; }
      set(C, C, FLOOR);
    }
    // 2. 柱子：1×2、2×2，放在空曠處（四周一格內沒有牆），打斷長視線
    for (let k = 0, made = 0, want = ri(2, 4); k < 60 && made < want; k++) {
      const w = ri(1, 2), h = w === 1 ? 2 : ri(1, 2), x = ri(2, N - 3 - w), y = ri(2, C - h);
      let free = true; for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) if (T[yy]?.[xx] !== FLOOR) free = false;
      if (!free) continue;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(xx, yy, WALL); made++;
    }
    // 高牆連續不超過 6 格（Alan 2026-10-15）：地圖裡面（外框不算）任何一橫排或一直排的厚牆超過 6 格，就在中間開一個 2 格的口（偶爾改成一段窗）
    for (let pass = 0; pass < 3; pass++) for (const vert of [false, true]) for (let a = 1; a < N - 1; a++) {
      let run = [];
      const flush = () => { if (run.length > (opt.maxWall ?? 6)) { const mid = Math.floor(run.length / 2) - 1, win = r() < .25; for (const [x, y] of run.slice(mid, mid + 2)) set(x, y, win ? WINDOW : FLOOR); } run = []; };
      for (let b = 1; b < N - 1; b++) { const x = vert ? a : b, y = vert ? b : a; if (T[y][x] === WALL) run.push([x, y]); else flush(); }
      flush();
    }
    if (!connected(T)) continue;
    // 區：用主牆那一列／行當邊界切開的連通塊（開口算進兩邊之一）——只用來分亮暗、放燈；上半部編號、下半部 +100
    const Z = Array.from({length: N}, () => Array(N).fill(-1));
    {
      const cut = (x, y) => walls.some(W => W.v ? x === W.at && y >= W.a && y <= W.b : y === W.at && x >= W.a && x <= W.b);
      let n = 0;
      for (let y = 1; y <= C; y++) for (let x = 1; x < N - 1; x++) if (passable(T[y][x]) && Z[y][x] < 0 && !cut(x, y)) {
        const q = [[x, y]]; Z[y][x] = n;
        for (let i = 0; i < q.length; i++) { const [a, b] = q[i]; for (const [dx, dy] of D4) { const X = a + dx, Y = b + dy; if (Y <= C && Z[Y]?.[X] === -1 && passable(T[Y][X]) && !cut(X, Y)) { Z[Y][X] = n; q.push([X, Y]); } } }
        n++;
      }
      // 牆上的開口：歸旁邊的區
      for (let y = 1; y <= C; y++) for (let x = 1; x < N - 1; x++) if (passable(T[y][x]) && Z[y][x] < 0) { const nb = D4.map(([dx, dy]) => Z[y + dy]?.[x + dx]).find(v => v >= 0); Z[y][x] = nb ?? 0; }
      for (let y = 1; y <= C; y++) for (let x = 1; x < N - 1; x++) { const [a, b] = rot(x, y); if (b > C || (b === C && a > C)) Z[b][a] = Z[y][x] >= 0 ? 100 + Z[y][x] : -1; }
    }
    // 3. 開場：九宮格的 4/6 或 2/8（同第一版）
    const mode = opt.spawn || (r() < .5 ? '46' : '28'), A = mode === '46' ? spawnNear(T, 2, C) : spawnNear(T, C, N - 3), B = A && rot(...A);
    if (!A || (A[0] === B[0] && A[1] === B[1])) continue;
    // 4. 瓶頸檢查：一格寬的格子（左右或上下都不能走），堵住它雙方的距離要多 8 步以上（或過不去）就是瓶頸
    const d0 = bfs(T, A).D[B[1]][B[0]]; if (d0 < 0) continue;
    let choke = false;
    for (let y = 1; y < N - 1 && !choke; y++) for (let x = 1; x < N - 1 && !choke; x++) {
      if (!passable(T[y][x]) || (x === A[0] && y === A[1]) || (x === B[0] && y === B[1])) continue;
      const blk = (X, Y) => !passable(T[Y][X]); if (!((blk(x - 1, y) && blk(x + 1, y)) || (blk(x, y - 1) && blk(x, y + 1)))) continue;
      const keep = T[y][x]; T[y][x] = WALL; const d = bfs(T, A).D[B[1]][B[0]]; T[y][x] = keep;
      if (d < 0 || d - d0 >= 8) choke = true;
    }
    if (choke) continue;
    // 交戰路線（Alan 2026-10-15：地形要放在會打起來的地方）：雙方開場的距離圖。
    // band＝接近最短的路線上（A 距離＋B 距離 ≤ 最短＋6）；front＝路線中段、兩邊差不多同時到的地方（|A 距離－B 距離| ≤ 5）＝最可能交火
    const dA = bfs(T, A).D, dB = bfs(T, B).D;
    const band = (x, y) => dA[y]?.[x] >= 0 && dB[y]?.[x] >= 0 && dA[y][x] + dB[y][x] <= d0 + 6;
    const front = (x, y) => band(x, y) && Math.abs(dA[y][x] - dB[y][x]) <= 5;
    // 5. 半掩體（矮隔板，在格子之間的邊上）：空曠處一段 2–3 格，離開場 3 格以上；先放上半部，再轉 180 度
    const P = [], edgeSet = new Set(), ek = (a, b) => [a, b].map(p => p.join(',')).sort().join('|');
    const open = (x, y) => T[y]?.[x] === FLOOR && Math.abs(x - A[0]) + Math.abs(y - A[1]) > 2 && Math.abs(x - B[0]) + Math.abs(y - B[1]) > 2;
    const lonely = ([X, Y]) => D4.filter(([dx, dy]) => T[Y + dy]?.[X + dx] === WALL).length <= 1;   // 不要整段貼牆
    for (let k = 0, made = 0, want = ri(4, 7); k < 200 && made < want; k++) {
      const horiz = r() < .5, len = ri(2, 3), x = ri(2, N - 3 - (horiz ? len : 1)), y = ri(2, C - 1 - (horiz ? 1 : len));
      const segs = []; for (let i = 0; i < len; i++) segs.push(horiz ? [[x + i, y], [x + i, y + 1]] : [[x, y + i], [x + 1, y + i]]);
      if (!segs.every(([a, b]) => open(...a) && open(...b) && lonely(a) && lonely(b) && !edgeSet.has(ek(a, b)))) continue;
      if (k < 140 && !segs.some(([a, b]) => band(...a) || band(...b))) continue;   // 先試交戰路線上，放不下才放別處
      for (const [a, b] of segs) for (const [p, q] of [[a, b], [rot(...a), rot(...b)]]) if (!edgeSet.has(ek(p, q))) { P.push([p, q]); edgeSet.add(ek(p, q)); }
      made++;
    }
    // 戰壕（第二步，照奇美拉戶外的規則）：一到兩段，中間全身深（2）、兩頭半身（1）當台階（一層一層走下去不會露破綻，直接從平地跳進全身深的才會）
    // 放在空曠處（不貼牆、不碰矮隔板、離開場 4 格以上），一段 5–8 格，偶爾拐一個彎；上半部放，轉 180 度
    const D = Array.from({length: N}, () => Array(N).fill(0)), dset = (x, y, v) => { D[y][x] = v; const [a, b] = rot(x, y); D[b][a] = v; };
    const onP = (x, y) => P.some(([a, b]) => (a[0] === x && a[1] === y) || (b[0] === x && b[1] === y));
    for (let k = 0, made = 0, want = ri(1, 2); k < 200 && made < want; k++) {
      const len = ri(5, 8), horiz = r() < .5, turn = r() < .35 ? ri(2, len - 3) : -1, x0 = ri(2, N - 3), y0 = ri(2, C - 2);
      const cells = []; let x = x0, y = y0, dir = horiz ? [1, 0] : [0, 1];
      for (let i = 0; i < len; i++) { cells.push([x, y]); if (i === turn) dir = [dir[1], dir[0]]; x += dir[0]; y += dir[1]; }
      const fine = cells.every(([cx, cy]) => cy >= 1 && cy < C && cx >= 1 && cx < N - 1 && T[cy][cx] === FLOOR && !D[cy][cx] && !onP(cx, cy)
        && D4.every(([dx, dy]) => T[cy + dy]?.[cx + dx] !== WALL) && Math.abs(cx - A[0]) + Math.abs(cy - A[1]) >= 4 && Math.abs(cx - B[0]) + Math.abs(cy - B[1]) >= 4)
        && (k >= 170 || cells.filter(([cx, cy]) => k < 90 ? front(cx, cy) : band(cx, cy)).length >= Math.ceil(cells.length / 2));   // 至少一半在交火區（試不出來才放寬到路線上）
      if (!fine) continue;
      cells.forEach(([cx, cy], i) => dset(cx, cy, i === 0 || i === cells.length - 1 ? 1 : 2));
      made++;
    }
    // 散兵坑（Alan 2026-10-16）：一兩格的半身深小坑，散在交戰路線上——不擋視線，推進途中可以搶進去的掩體。每半邊 3–5 個，彼此和戰壕隔 3 格以上
    const farFromD = (x, y) => { for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (D[yy]?.[xx]) return false; return true; };
    for (let k = 0, made = 0, want = ri(3, 5); k < 150 && made < want; k++) {
      const two = r() < .5, horiz = r() < .5, x = ri(2, N - 4), y = ri(2, C - 2), cells = two ? [[x, y], horiz ? [x + 1, y] : [x, y + 1]] : [[x, y]];
      if (!cells.every(([cx, cy]) => cy < C && T[cy][cx] === FLOOR && band(cx, cy) && farFromD(cx, cy) && !onP(cx, cy) && D4.every(([dx, dy]) => T[cy + dy]?.[cx + dx] !== WALL)
        && Math.abs(cx - A[0]) + Math.abs(cy - A[1]) >= 4 && Math.abs(cx - B[0]) + Math.abs(cy - B[1]) >= 4)) continue;
      for (const [cx, cy] of cells) dset(cx, cy, 1);
      made++;
    }
    // 少量木箱（第一版的 c：擋路、擋一部分子彈、可以打壞），不放在一格寬的地方
    const narrow = (x, y) => (T[y][x - 1] !== FLOOR && T[y][x + 1] !== FLOOR) || (T[y - 1][x] !== FLOOR && T[y + 1][x] !== FLOOR);
    for (let k = 0, made = 0, want = ri(2, 4); k < 80 && made < want; k++) {
      const x = ri(2, N - 3), y = ri(2, C - 1);
      if (!open(x, y) || D[y][x] || narrow(x, y) || D4.some(([dx, dy]) => narrow(x + dx, y + dy)) || P.some(([a, b]) => [a, b].some(q => q[0] === x && q[1] === y))) continue;
      set(x, y, COVER); if (!connected(T)) { set(x, y, FLOOR); continue; } made++;
    }
    // 6. 亮暗與鹵素燈：每一區亮或停電（上下對稱），開場的區一定亮
    // 光的三等分（Alan 2026-10-16：只看格數、不限位置）：約 1/3 常亮（有電）、1/3 鹵素燈照亮（停電但在燈旁）、1/3 常暗（停電、燈照不到）
    const L = T.map(row => row.map(() => 2)), size = new Map(), zoneDark = new Map();
    let floorN = 0; for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if (Z[y][x] >= 0) { floorN++; const z = Z[y][x] % 100; size.set(z, (size.get(z) || 0) + 1); }
    const frontN = new Map(); for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if (Z[y][x] >= 0 && front(x, y)) { const z = Z[y][x] % 100; frontN.set(z, (frontN.get(z) || 0) + 1); }
    // 1. 停電的區：交火區占比高的先挑（暗房要在會打起來的地方），一區一區加，停電格數越接近全部的 2/3 越好；開場 4 格內一定有電
    const want2 = floorN * (opt.unpowered ?? 2 / 3);
    const order = [...size.keys()].map(z => [z, (frontN.get(z) || 0) / size.get(z) + r() * .05]).sort((a, b) => b[1] - a[1]).map(([z]) => z); let darkN = 0;
    for (const z of order) { const n = size.get(z); if (Math.abs(darkN + n - want2) < Math.abs(darkN - want2)) { zoneDark.set(z, true); darkN += n; } }
    const nearSpawn = (x, y) => Math.abs(x - A[0]) + Math.abs(y - A[1]) <= 4 || Math.abs(x - B[0]) + Math.abs(y - B[1]) <= 4;
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if (Z[y][x] >= 0 && zoneDark.get(Z[y][x] % 100) && !nearSpawn(x, y)) L[y][x] = 0;
    // 2. 鹵素燈：掛在停電區靠牆的地板上（上半部挑、轉 180 度成對），一對一對加，直到燈照到的停電格（燈旁 3 格內，近似 ASH 的亮 2＋暗 1）約占全部地板的 1/3
    const unpowered = []; for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if (L[y][x] === 0 && passable(T[y][x])) unpowered.push([x, y]);
    const lamps = [], lit = new Set(), reach = 3, wantLit = floorN * (opt.lampLit ?? .29);   // 燈是一對一對加的，目標略低於 1/3，實測（ASH 的 lightAt）才會接近三等分
    const cover = p => unpowered.filter(([x, y]) => Math.abs(x - p[0]) + Math.abs(y - p[1]) <= reach).map(q => q.join(','));
    const cand = []; for (let y = 1; y <= C; y++) for (let x = 1; x < N - 1; x++) if (L[y][x] === 0 && T[y][x] === FLOOR && D4.some(([dx, dy]) => T[y + dy][x + dx] === WALL)) cand.push([x, y]);
    while (lit.size < wantLit && lamps.length < 40) {
      let best = null, gain = 0;
      for (const p of cand) { if (lamps.some(l => l[0] === p[0] && l[1] === p[1])) continue; const g = new Set([...cover(p), ...cover(rot(...p))].filter(k => !lit.has(k))).size + (band(...p) ? .5 : 0); if (g > gain) { gain = g; best = p; } }
      if (!best || gain < 2) break;
      for (const q of [best, rot(...best)]) { lamps.push(q); for (const k of cover(q)) lit.add(k); }
    }
    // 每一張都要接近三等分（Alan：每張圖都是）：三類各在 25%–42% 之間，不然重生
    { const fr = [floorN - unpowered.length, lit.size, unpowered.length - lit.size].map(n => n / floorN); if (fr.some(f => f < (opt.lightMin ?? .25) || f > (opt.lightMax ?? .42))) continue; }
    // 7. 出煙口：上半部一個（轉 180 度另一個），放在長直線上（那一列或那一行連續開闊 8 格以上），離開場 5 格以上
    const run = (x, y, dx, dy) => { let n = 0; for (let X = x, Y = y; T[Y]?.[X] && seeThrough(T[Y][X]); X += dx, Y += dy) n++; return n; };
    const ventCand = [];
    for (let y = 2; y < C; y++) for (let x = 2; x < N - 2; x++) {
      if (T[y][x] !== FLOOR || D[y][x] || !band(x, y) || Math.abs(x - A[0]) + Math.abs(y - A[1]) < 5 || Math.abs(x - B[0]) + Math.abs(y - B[1]) < 5) continue;
      const lane = Math.max(run(x, y, 1, 0) + run(x, y, -1, 0), run(x, y, 0, 1) + run(x, y, 0, -1)) - 1;
      if (lane >= 8 && D4.filter(([dx, dy]) => T[y + dy][x + dx] === FLOOR).length >= 3) ventCand.push([x, y, lane]);
    }
    if (!ventCand.length) continue;
    ventCand.sort((a, b) => b[2] - a[2]);
    const v = pick(ventCand.slice(0, Math.max(1, Math.ceil(ventCand.length / 3)))), vents = [[v[0], v[1]], rot(v[0], v[1])];
    // 8. 搶奪點（Alan 2026-10-16）：戰場兩側各一個高階武器箱（離雙方一樣遠、離雙方連線最遠的地方；一個電漿步槍、一個精準步槍）；正中央一個三倍傷害。都不會重生
    const ax = B[0] - A[0], ay = B[1] - A[1], L2 = Math.hypot(ax, ay) || 1, side2 = (x, y) => Math.abs((x - A[0]) * ay - (y - A[1]) * ax) / L2;
    const taken = q => vents.some(w => w[0] === q[0] && w[1] === q[1]) || lamps.some(w => w[0] === q[0] && w[1] === q[1]) || D[q[1]][q[0]];
    const crateCand = [];
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      if (T[y][x] !== FLOOR || taken([x, y]) || dA[y][x] < 0 || Math.abs(dA[y][x] - dB[y][x]) > 2) continue;
      if (D4.filter(([dx, dy]) => T[y + dy]?.[x + dx] === FLOOR).length < 2 || (x === C && y === C)) continue;
      crateCand.push([x, y, side2(x, y)]);
    }
    if (!crateCand.length) continue;
    crateCand.sort((a, b) => b[2] - a[2]);
    const cr = pick(crateCand.slice(0, Math.min(4, crateCand.length))), crates = [[cr[0], cr[1], 'plasma'], [...rot(cr[0], cr[1]), 'sniper']];
    if (crates[0][0] === crates[1][0] && crates[0][1] === crates[1][1]) continue;
    // 三倍傷害：正中央那一格（轉 180 度不動的唯一一格）；是牆或坑就換成地板（再確認連通）
    T[C][C] = FLOOR; D[C][C] = 0; if (!connected(T)) continue;
    const power = [C, C];
    const g = graphOf(T);
    return {T, L, A, B, P, D, lamps, vents, crates, power, zones: Z, seed, tries, g, spawn: mode, version: 2, m: {...metrics(T, g, A, B), partitions: P.length, lamps: lamps.length, vents: vents.length, trench: D.flat().filter(Boolean).length, light: {floor: floorN, powered: floorN - unpowered.length, lampLit: lit.size, black: unpowered.length - lit.size}}};
  }
  return null;
}
