// 奇幻戰幫切片：戰鬥核心
// 純規則，不碰畫面；瀏覽器與（之後的）伺服器共用同一份。
// 所有亂數都走 st.rng；同一份狀態 + 同一串行動 = 同一個結果。
// 行動的唯一入口是 act(st, action)，回傳這一步產生的事件（給畫面演出用）。
import {WEAPONS, TRIANGLE, CLASSES, TERRAIN, TRAITS, ITEMS, rngNext, rngInt, hashSeed, weaponOf, gearAdd, armorSprite} from './data.js';

// 戰場大小不固定：看是哪種仗、雙方幾個人、跑得多快（騎馬）、什麼地形。最大 32×32
export const MAX_SIZE = 32;
const key = (st, x, y) => y * st.W + x;
const inMap = (st, x, y) => x >= 0 && y >= 0 && x < st.W && y < st.H;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const has = (u, t) => u.traits && u.traits.includes(t);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ROUGH = new Set(['forest', 'bush', 'hill']);   // 騎馬走這些地形多花 1
export const moveCost = (st, u, x, y) => { const t = st.tiles[key(st, x, y)], c = TERRAIN[t].cost; return c === Infinity ? c : c + (u.mounted && ROUGH.has(t) ? 1 : 0); };

/* ───────────── 戰場的樣子 ─────────────
   field   路上遭遇：我方在下、敵人在上
   ambush  伏擊：我方在中間的路上，敵人從左右兩側夾過來
   night   營地被襲：我方在中央的營地，敵人從四邊摸進來
   caravan 劫車隊：車隊和護衛在橫過中間的路上，我方從下方衝出來
   fort    攻山寨：寨牆只有門能進，寨子在上方
   scatter 林中遭遇：雙方零散分布
   duel    單挑：中間一圈，外面是圍觀的人
   exits：我方可以從哪幾邊撤離（n 上、s 下、w 左、e 右） */
export const LAYOUTS = {
  field: {exits: ['s', 'w', 'e']}, ambush: {exits: ['n', 's']}, night: {exits: ['n', 's', 'w', 'e']}, caravan: {exits: ['s', 'w', 'e']},
  fort: {exits: ['s']}, scatter: {exits: ['n', 's', 'w', 'e']}, duel: {exits: ['n', 's', 'w', 'e']},
};
export function sizeFor(layout, n, avgMov, biome) {
  const tf = biome === 'forest' ? 1.4 : biome === 'hills' ? 1.25 : 1, reachT = Math.round(avgMov / tf);   // 一回合大約走幾格（林地、丘陵走得慢）
  const c = v => clamp(Math.round(v), 9, MAX_SIZE);
  switch (layout) {
    case 'duel': return [9, 9];
    case 'ambush': return [c(8 + reachT * 2), c(Math.max(12, n + 4))];
    case 'night': { const s = c(Math.max(14, 10 + reachT + n / 3)); return [s, s]; }
    case 'caravan': return [c(Math.max(12, 8 + n * 0.6)), c(Math.max(14, 9 + reachT * 1.2))];
    case 'fort': return [c(Math.max(12, 8 + n * 0.5)), c(Math.max(16, 11 + reachT))];
    case 'scatter': { const s = c(Math.max(12, 8 + n * 0.7)); return [s, s]; }
    default: return [c(Math.max(10, n * 0.6 + 4)), c(Math.max(12, 7 + reachT, n * 0.4 + 6))];
  }
}
/* ───────────── 地圖 ───────────── */
export function genMap(seed, biome, W = 10, H = 12, layout = biome === 'camp' ? 'fort' : 'field') {
  const st = {rng: hashSeed('map', seed, biome, W, H, layout), W, H};
  const t = new Array(W * H).fill('grass');
  const ok = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const put = (x, y, v) => { if (ok(x, y)) t[y * W + x] = v; };
  const area = W * H / 120;   // 以 10×12 為基準放多少地形
  const blob = (kind, n, r) => { for (let i = 0; i < Math.round(n * area); i++) { const cx = rngInt(st, W), cy = rngInt(st, H); for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (Math.abs(x - cx) + Math.abs(y - cy) <= r && rngNext(st) < 0.7) put(x, y, kind); } };
  const b = biome === 'camp' ? 'plain' : biome;
  if (b === 'forest') { blob('forest', 6, 2); blob('bush', 4, 1); blob('rock', 2, 0); }
  else if (b === 'hills') { blob('hill', 5, 2); blob('rock', 4, 1); blob('forest', 2, 1); }
  else { blob('bush', 4, 1); blob('forest', 3, 1); blob('hill', 2, 1); }
  const cx = W >> 1, cy = H >> 1;
  const clear = (x0, y0, x1, y1, v = 'grass') => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, v); };
  if (layout === 'field') { const rx = (W >> 1) - 2 + rngInt(st, 4); for (let y = 0; y < H; y++) put(rx + (y > H / 2 ? 1 : 0), y, 'road'); clear(2, H - 2, W - 3, H - 1); }
  if (layout === 'ambush') { for (let y = 0; y < H; y++) { put(cx, y, 'road'); put(cx - 1, y, 'road'); } clear(cx - 2, cy - 3, cx + 1, cy + 3); }
  if (layout === 'caravan') { for (let x = 0; x < W; x++) { put(x, cy, 'road'); put(x, cy - 1, 'road'); } clear(2, H - 2, W - 3, H - 1); for (const dx of [-2, 1]) put(cx + dx, cy, 'cart'); }
  if (layout === 'night') clear(cx - 3, cy - 3, cx + 3, cy + 3, 'camp');
  if (layout === 'fort') {
    const wy = Math.max(4, Math.round(H * 0.33)); clear(0, wy - 1, W - 1, wy + 1);
    for (let x = 1; x < W - 1; x++) if (Math.abs(x - cx + 0.5) > 1) put(x, wy, 'wall');   // 寨牆，中間留門
    clear(cx - 3, 0, cx + 2, wy - 1, 'camp'); clear(2, H - 2, W - 3, H - 1);
  }
  if (layout === 'duel') { t.fill('grass'); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(x - 4) + Math.abs(y - 4) > 5) put(x, y, 'crowd'); }
  // 保證連通：每一塊可走的地都要接在一起，否則把擋路的石頭、樹叢打掉
  for (let guard = 0; guard < 40; guard++) {
    const start = t.findIndex(v => TERRAIN[v].cost < Infinity), seen = new Set([start]), q = [start];
    while (q.length) { const k = q.pop(), x = k % W, y = (k / W) | 0; for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy, nk = ny * W + nx; if (ok(nx, ny) && !seen.has(nk) && TERRAIN[t[nk]].cost < Infinity) { seen.add(nk); q.push(nk); } } }
    if (t.every((v, i) => TERRAIN[v].cost === Infinity || seen.has(i))) break;
    for (let i = 0; i < t.length; i++) if ((t[i] === 'rock' || t[i] === 'water') && rngNext(st) < 0.35) t[i] = 'grass';
    if (guard > 20) for (let i = 0; i < t.length; i++) if (t[i] === 'wall' && rngNext(st) < 0.3) t[i] = 'camp';
  }
  return t;
}

/* ───────────── 建立戰鬥 ───────────── */
// party：玩家隊伍成員（世界層的資料），foes：敵人清單（同樣格式）
// camp：被襲擊的一方有營地。{side: 'ally'|'enemy', stake, watch, ready, def}
//   營地格（迴避 +10、防禦 +1）；木柵把營地圍起來只留缺口（還沒紮穩時缺口多）；設哨時敵人只能從最外圈出發；def 是額外的防禦加成
function stakeRing(st, camp) {
  const cx = st.W >> 1, cy = st.H >> 1, r = 4, gapN = camp.ready ? 2 : 5, ring = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (inMap(st, x, y) && Math.max(Math.abs(x - cx), Math.abs(y - cy)) === r) ring.push([x, y]);
  ring.forEach(([x, y], i) => { st.tiles[key(st, x, y)] = i % Math.floor(ring.length / gapN) === 0 ? 'grass' : 'wall'; });
}
export function createBattle({seed, biome, party, foes, order, camp, layout}) {
  const units = [...party, ...foes], n = units.length, avgMov = units.reduce((s, m) => s + (m.mov || 5) + (m.mounted ? 2 : 0), 0) / Math.max(1, n);
  layout = LAYOUTS[layout] ? layout : camp && camp.side === 'ally' ? 'night' : biome === 'camp' ? 'fort' : 'field';
  const [W, H] = sizeFor(layout, n, avgMov, biome);
  const st = {v: 2, seed, rng: hashSeed('battle', seed), biome, layout, W, H, exits: LAYOUTS[layout].exits, tiles: genMap(seed, biome, W, H, layout), turn: 0, result: null, units: [], order: order || {stance: 'follow', focus: null}, obey: {}, log: []};
  if (camp && !camp.open) { st.camp = camp; if (layout === 'night' && camp.stake) stakeRing(st, camp); }
  const sp = spawns(st, layout, camp);
  const free = (spots) => { for (const [x, y] of spots) if (inMap(st, x, y) && TERRAIN[st.tiles[key(st, x, y)]].cost < Infinity && !st.units.some(u => u.x === x && u.y === y)) return [x, y]; return null; };
  const anyFree = () => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = free([[x, y]]); if (p) return p; } return [0, 0]; };
  party.forEach(m => st.units.push(toUnit(m, 'ally', free(sp.ally) || anyFree())));
  const es = sp.enemy.slice(); for (let i = es.length - 1; i > 0; i--) { const j = rngInt(st, i + 1); [es[i], es[j]] = [es[j], es[i]]; }
  foes.forEach(m => st.units.push(toUnit(m, 'enemy', free(m.leader && sp.lead ? sp.lead.concat(es) : es) || anyFree())));
  if (camp && camp.def) for (const u of st.units) if (u.side === camp.side) u.def += camp.def;
  st.initialEnemies = foes.length;
  newTurn(st, []);
  return st;
}
// 出生位置（依序填，越前面越先用）
function spawns(st, layout, camp) {
  const {W, H} = st, cx = W >> 1, cy = H >> 1, R = (x0, y0, x1, y1) => { const o = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) o.push([x, y]); return o; };
  const byDist = (pts, x, y) => pts.sort((a, b) => Math.abs(a[0] - x) + Math.abs(a[1] - y) - Math.abs(b[0] - x) - Math.abs(b[1] - y));
  const ring = d => R(0, 0, W - 1, H - 1).filter(([x, y]) => Math.min(x, y, W - 1 - x, H - 1 - y) < d);
  switch (layout) {
    case 'ambush': return {ally: byDist(R(cx - 2, cy - 3, cx + 1, cy + 3), cx, cy), enemy: [...R(0, 0, 2, H - 1), ...R(W - 3, 0, W - 1, H - 1)].filter(([, y]) => y % 2 === 0).concat(R(0, 0, 2, H - 1), R(W - 3, 0, W - 1, H - 1))};
    case 'night': return {ally: byDist(R(cx - 3, cy - 3, cx + 3, cy + 3), cx, cy), enemy: ring(camp?.watch ? 1 : 3)};
    case 'caravan': return {ally: byDist(R(1, H - 3, W - 2, H - 1), cx, H - 1), enemy: byDist(R(0, cy - 3, W - 1, cy + 2), cx, cy), lead: byDist(R(0, cy - 2, W - 1, cy), cx, cy - 2)};
    case 'fort': { const wy = Math.max(4, Math.round(H * 0.33)); return {ally: byDist(R(1, H - 3, W - 2, H - 1), cx, H - 1), enemy: R(0, 0, W - 1, wy - 1).filter(([x, y]) => y >= 1), lead: byDist(R(cx - 2, 0, cx + 1, 1), cx, 0)}; }
    case 'duel': return {ally: [[4, 7]], enemy: [[4, 1]]};
    case 'scatter': {
      const r = {rng: hashSeed('scatter', st.seed)}, ax = 2 + rngInt(r, W - 4), ay = Math.floor(H * 0.6) + rngInt(r, Math.max(1, Math.floor(H * 0.35)));
      const all = R(0, 0, W - 1, H - 1), far = all.filter(([x, y]) => Math.abs(x - ax) + Math.abs(y - ay) >= Math.max(6, Math.floor(W / 2)));
      for (let i = far.length - 1; i > 0; i--) { const j = rngInt(r, i + 1); [far[i], far[j]] = [far[j], far[i]]; }
      return {ally: byDist(all.slice(), ax, ay), enemy: far};
    }
    default: return {ally: byDist(R(1, H - 3, W - 2, H - 1), cx, H - 1), enemy: R(0, 0, W - 1, Math.min(3, H >> 2)), lead: R(0, 0, W - 1, 1)};
  }
}
// 上場：裝備的加成算進數值（記在 gearAdd，打完要扣回去）；手上的武器、盾牌記下來給畫面畫小圖示
function toUnit(m, side, [x, y]) {
  const ga = gearAdd(m), sh = m.eq?.s && ITEMS[m.eq.s.b];
  return {id: m.id, side, hero: !!m.hero, leader: !!m.leader, name: m.name, cls: m.cls, sprite: armorSprite(m), face: m.face ?? null, fs: m.fs, g: m.g, lvl: m.lvl, exp: m.exp || 0, hp: Math.round(m.hp), max: m.max,
    str: m.str + ga.str, skl: m.skl + ga.skl, spd: m.spd + ga.spd, def: m.def + ga.def, mov: m.mov + (m.mounted ? 2 : 0), mounted: !!m.mounted, weapon: m.weapon, wpn: weaponOf(m), shield: sh ? sh.icon : null, arrow: sh ? sh.arrow || 0 : 0, gearAdd: ga,
    traits: m.traits || [], loyalty: m.loyalty ?? 100, x, y, alive: true, fled: false, captured: false, kills: 0, dealt: 0, levels: []};
}

/* ───────────── 查詢 ───────────── */
export const terrainAt = (st, x, y) => TERRAIN[st.tiles[key(st, x, y)]];
export const unitAt = (st, x, y) => st.units.find(u => u.alive && !u.fled && u.x === x && u.y === y);
export const living = (st, side) => st.units.filter(u => u.alive && !u.fled && (!side || u.side === side));
export const hero = st => st.units.find(u => u.hero);
const weapon = u => u.wpn || WEAPONS[u.weapon];
export const weaponOfUnit = weapon;
const isBeast = u => !!CLASSES[u.cls]?.beast;
// 小整數成本的最短路（桶子佇列）：戰場變大後比每次排序快很多
function buckets() { const b = []; let lo = 0; return {push(c, v) { (b[c] ||= []).push(v); if (c < lo) lo = c; }, pop() { while (lo < b.length && !(b[lo] && b[lo].length)) lo++; return lo < b.length ? [lo, b[lo].pop()] : null; }}; }
const occ = st => { const m = new Map(); for (const u of st.units) if (u.alive && !u.fled) m.set(key(st, u.x, u.y), u); return m; };

// 可走的格子：可以穿過自己人，不能穿過敵人，不能停在有人的格子
export function reach(st, u, mov = u.mov + (has(u, 'coward') && st.order.stance === 'retreat' && u.side === 'ally' ? 1 : 0)) {
  const o = occ(st), best = new Map([[key(st, u.x, u.y), 0]]), prev = new Map(), q = buckets(); q.push(0, key(st, u.x, u.y));
  for (let it = q.pop(); it; it = q.pop()) {
    const [c, k] = it; if (c > (best.get(k) ?? Infinity)) continue; const x = k % st.W, y = (k / st.W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy; if (!inMap(st, nx, ny)) continue;
      const cost = moveCost(st, u, nx, ny); if (cost === Infinity) continue;
      const nk = key(st, nx, ny), ou = o.get(nk); if (ou && ou.side !== u.side) continue;
      const nc = c + cost; if (nc > mov) continue;
      if (nc < (best.get(nk) ?? Infinity)) { best.set(nk, nc); prev.set(nk, k); q.push(nc, nk); }
    }
  }
  const tiles = [];
  for (const k of best.keys()) { const ou = o.get(k); if (!ou || ou === u) tiles.push([k % st.W, (k / st.W) | 0]); }
  return {tiles, prev, cost: best};
}
export function pathTo(r, u, x, y, st) {
  const W = st.W, out = [[x, y]]; let k = y * W + x;
  while (k !== u.y * W + u.x) { k = r.prev.get(k); if (k === undefined) return [[u.x, u.y], [x, y]]; out.unshift([k % W, (k / W) | 0]); }
  return out;
}
// 從某格能打到的格子
const inRange = (u, x, y, tx, ty) => { const d = Math.abs(x - tx) + Math.abs(y - ty), [lo, hi] = weapon(u).range; return d >= lo && d <= hi; };

/* ───────────── 戰鬥數學（看得到的數字就是實際的數字） ───────────── */
function tri(a, d) {
  const ta = weapon(a).type, td = weapon(d).type;
  if (TRIANGLE[ta] === td) return 1; if (TRIANGLE[td] === ta) return -1; return 0;
}
const nearHero = (st, u) => { const h = hero(st); return h && h.alive && u !== h && dist(u, h) === 1; };
export function stats(st, u, x = u.x, y = u.y) {
  const t = terrainAt(st, x, y), w = weapon(u);
  return {
    atk: u.str + (has(u, 'reckless') ? 2 : 0) + w.mt,
    hit: w.hit + u.skl * 2 + (has(u, 'marksman') && w.type === 'bow' ? 15 : 0) + (has(u, 'veteran') ? 10 : 0) - (has(u, 'drunkard') ? 10 : 0),
    avo: u.spd * 2 + t.avo + (has(u, 'cautious') ? 10 : 0),
    def: u.def + t.def + (has(u, 'guardian') && nearHero(st, {...u, x, y}) ? 2 : 0),
    crit: Math.floor(u.skl / 2) + w.crit + (has(u, 'bloodthirsty') ? 10 : 0),
    critAvo: Math.floor(u.spd / 2),
  };
}
// 預測：a 站在 (ax, ay) 打 d
export function forecast(st, a, d, ax = a.x, ay = a.y) {
  const sa = stats(st, a, ax, ay), sd = stats(st, d), tr = tri(a, d);
  const aShot = weapon(a).range[0] > 1, dShot = weapon(d).range[0] > 1;   // 盾牌對弓箭多擋一些
  const aHit = clamp(sa.hit + tr * 15 - sd.avo, 0, 100), aDmg = Math.max(0, sa.atk + tr - sd.def - (aShot ? d.arrow || 0 : 0)), aCrit = clamp(sa.crit - sd.critAvo, 0, 100);
  const canCounter = inRange(d, d.x, d.y, ax, ay);
  const dHit = canCounter ? clamp(sd.hit - tr * 15 - sa.avo, 0, 100) : 0, dDmg = canCounter ? Math.max(0, sd.atk - tr - sa.def - (dShot ? a.arrow || 0 : 0)) : 0, dCrit = canCounter ? clamp(sd.crit - sa.critAvo, 0, 100) : 0;
  const aCount = a.spd - d.spd >= 4 ? 2 : 1, dCount = canCounter ? (d.spd - a.spd >= 4 ? 2 : 1) : 0;
  return {aHit, aDmg, aCrit, aCount, canCounter, dHit, dDmg, dCrit, dCount, tri: tr};
}

/* ───────────── 結算 ───────────── */
function strike(st, ev, a, d, f, isA) {
  const hitP = isA ? f.aHit : f.dHit, dmg0 = isA ? f.aDmg : f.dDmg, critP = isA ? f.aCrit : f.dCrit;
  const hit = rngNext(st) * 100 < hitP, crit = hit && rngNext(st) * 100 < critP, dmg = hit ? (crit ? dmg0 * 3 : dmg0) : 0;
  d.hp = Math.max(0, d.hp - dmg); a.dealt += dmg;
  ev.push({t: 'strike', a: a.id, d: d.id, hit, crit, dmg, hp: d.hp});
  if (a.side === 'ally' && hit) gainExp(st, ev, a, 10 + Math.max(0, d.lvl - a.lvl));
  if (d.hp <= 0) {
    d.alive = false; a.kills++; ev.push({t: 'die', id: d.id, by: a.id});
    if (a.side === 'ally') gainExp(st, ev, a, 30 + Math.max(0, (d.lvl - a.lvl) * 3) + (d.leader ? 20 : 0));
    return true;
  }
  return false;
}
function combat(st, ev, a, d) {
  const f = forecast(st, a, d);
  ev.push({t: 'attack', a: a.id, d: d.id});
  if (strike(st, ev, a, d, f, true)) return;
  if (f.dCount && strike(st, ev, d, a, f, false)) return;
  if (f.aCount > 1 && strike(st, ev, a, d, f, true)) return;
  if (f.dCount > 1) strike(st, ev, d, a, f, false);
}
function heal(st, ev, a, d) {
  const amt = Math.min(CLASSES[a.cls].heals || 8, d.max - d.hp); d.hp += amt;
  ev.push({t: 'heal', a: a.id, d: d.id, amt, hp: d.hp});
  gainExp(st, ev, a, 12);
}
function gainExp(st, ev, u, n) {
  if (u.lvl >= 20) return;
  u.exp += n;
  while (u.exp >= 100) {
    u.exp -= 100; u.lvl++;
    const g = CLASSES[u.cls].grow, gains = {}, slow = has(u, 'veteran') ? 0.75 : 1;
    for (const s of ['hp', 'str', 'skl', 'spd', 'def']) if (rngNext(st) * 100 < g[s] * slow) { gains[s] = 1; if (s === 'hp') { u.max++; u.hp++; } else u[s]++; }
    u.levels.push(gains); ev.push({t: 'level', id: u.id, lvl: u.lvl, gains});
  }
}
function moveUnit(st, ev, u, x, y, r) {
  if (u.x === x && u.y === y) return;
  const path = pathTo(r || reach(st, u), u, x, y, st);
  u.x = x; u.y = y; ev.push({t: 'move', id: u.id, path});
}

/* ───────────── 決策（不用亂數：預覽和實際一定一致） ───────────── */
// 距離場：從目標格出發、照 u 的移動成本算到每格要走多遠（不考慮行動力上限）
function field(st, u, goals) {
  const o = occ(st), d = new Array(st.W * st.H).fill(Infinity), q = buckets();
  for (const [x, y] of goals) { if (!inMap(st, x, y)) continue; const k = key(st, x, y); d[k] = 0; q.push(0, k); }
  for (let it = q.pop(); it; it = q.pop()) {
    const [c, k] = it; if (c > d[k]) continue; const x = k % st.W, y = (k / st.W) | 0, here = moveCost(st, u, x, y);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy; if (!inMap(st, nx, ny)) continue;
      if (moveCost(st, u, nx, ny) === Infinity) continue;
      const nk = key(st, nx, ny), ou = o.get(nk), extra = ou && ou.side !== u.side ? 4 : 0;
      const nc = c + (here === Infinity ? 1 : here) + extra; if (nc < d[nk]) { d[nk] = nc; q.push(nc, nk); }
    }
  }
  return d;
}
const attackSpotsAround = (st, u, t) => { const out = [], [lo, hi] = weapon(u).range; for (let dy = -hi; dy <= hi; dy++) for (let dx = -hi; dx <= hi; dx++) { const m = Math.abs(dx) + Math.abs(dy); if (m >= lo && m <= hi && inMap(st, t.x + dx, t.y + dy)) out.push([t.x + dx, t.y + dy]); } return out; };

// 這一步打誰、從哪裡打最划算
function bestAttack(st, u, tiles, targets, score) {
  let best = null;
  for (const [x, y] of tiles) for (const t of targets) {
    if (!inRange(u, x, y, t.x, t.y)) continue;
    const f = forecast(st, u, t, x, y), s = score(t, f, x, y);
    if (s === null) continue;
    if (!best || s > best.score + 1e-9) best = {kind: 'attack', to: [x, y], target: t.id, score: s, f};
  }
  return best;
}
// 期望值打分
function attackValue(st, u, t, f, x, y) {
  const exp = f.aHit / 100 * f.aDmg * f.aCount, kill = f.aDmg * f.aCount >= t.hp ? f.aHit / 100 * 40 : 0;
  const taken = f.dHit / 100 * f.dDmg * f.dCount;
  return exp + kill - taken * 0.8 + terrainAt(st, x, y).avo * 0.05;
}
// 向某些格子靠近：選可到的格子裡距離場最小的
function approach(st, u, r, fd, prefer) {
  let best = null, bs = Infinity;
  for (const [x, y] of r.tiles) { const s = fd[key(st, x, y)] * 10 - terrainAt(st, x, y).avo * 0.1 + (prefer ? prefer(x, y) : 0); if (s < bs) { bs = s; best = [x, y]; } }
  return best;
}
const enemiesOf = (st, u) => living(st).filter(o => o.side !== u.side);

// 每格會被幾個敵人打到（下個敵方階段）
function threat(st, side) {
  const m = new Map();
  for (const e of living(st).filter(o => o.side !== side)) { const seen = new Set(); for (const [x, y] of reach(st, e).tiles) for (const [ax, ay] of attackSpotsAround(st, e, {x, y})) seen.add(key(st, ax, ay)); for (const k of seen) m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
// 同伴的打算
export function planAlly(st, u, th = threat(st, u.side)) {
  const h = hero(st), foes = enemiesOf(st, u), r = reach(st, u);
  const frail = u.hp < u.max * 0.6 || CLASSES[u.cls].heals || weapon(u).range[0] > 1;   // 脆弱的人（傷兵、草藥師、弓手）會避開危險格
  let stance = st.order.stance, why = '';
  const obeys = st.obey[u.id] !== false;
  const low = u.hp < u.max / 2;
  if (has(u, 'coward') && low && stance !== 'retreat') { stance = 'retreat'; why = '膽小，血量太低想逃'; }
  else if (!obeys && stance !== 'engage') {
    stance = has(u, 'cautious') ? 'hold' : 'engage';
    why = has(u, 'reckless') ? '魯莽，不聽令衝上去' : '不聽令，自己找目標';
  }
  if (has(u, 'reckless') && (stance === 'hold' || stance === 'retreat') && foes.some(f => dist(f, u) <= 3) && obeys) { /* 魯莽但這回合有聽令：維持命令 */ }
  const focus = st.order.focus && foes.find(f => f.id === st.order.focus);
  if (stance === 'focus' && !focus) stance = 'engage';
  const cautious = (f) => has(u, 'cautious') && f.dDmg * f.dCount >= u.hp / 2 && f.dHit > 0;
  const score = (t, f, x, y) => {
    if (cautious(f)) return null;
    let s = attackValue(st, u, t, f, x, y);
    if (has(u, 'bloodthirsty')) s += (1 - t.hp / t.max) * 30;
    if (focus && t === focus) s += 60;
    if (has(u, 'guardian') && h && h.alive && Math.abs(x - h.x) + Math.abs(y - h.y) === 1) s += 6;
    if (frail) s -= (th.get(key(st, x, y)) || 0) * 3;
    return s;
  };
  const heals = CLASSES[u.cls].heals;
  // 可以站的格子（依命令限制）
  let tiles = r.tiles;
  if (stance === 'hold') tiles = [[u.x, u.y]];
  if (stance === 'follow' && h && h.alive) { const near = r.tiles.filter(([x, y]) => Math.abs(x - h.x) + Math.abs(y - h.y) <= 2); if (near.length) tiles = near; }
  // 草藥師：先救人
  if (heals && stance !== 'retreat') {
    let hb = null;
    for (const [x, y] of tiles) for (const a of living(st, u.side)) {
      if (a === u || Math.abs(a.x - x) + Math.abs(a.y - y) !== 1 || a.hp > a.max - 5) continue;
      const s = (a.max - a.hp) + (a.hero ? 10 : 0) - (th.get(key(st, x, y)) || 0) * 7;
      if (!hb || s > hb.score) hb = {kind: 'heal', to: [x, y], target: a.id, score: s};
    }
    if (hb) return {...hb, why: why || '包紮傷患'};
  }
  if (stance === 'retreat') {
    const fd = field(st, u, foes.map(f => [f.x, f.y]));
    const to = approach(st, u, r, fd.map(v => -v), (x, y) => h && h.alive && !h.fled ? (Math.abs(x - h.x) + Math.abs(y - h.y)) * 2 : 0);
    return {kind: 'move', to, why: why || '撤退'};
  }
  const atk = (!heals || stance === 'engage' || stance === 'focus') ? bestAttack(st, u, tiles, stance === 'focus' && focus && tiles.some(([x, y]) => inRange(u, x, y, focus.x, focus.y)) ? [focus] : foes, score) : null;
  if (atk) return {...atk, why: why || (focus && atk.target === focus.id ? '集火' : stance === 'hold' ? '守住，站著打' : '攻擊')};
  if (stance === 'hold') return {kind: 'wait', to: [u.x, u.y], why: why || '守住'};
  if (stance === 'follow' && h && h.alive) {
    const fd = field(st, u, foes.map(f => [f.x, f.y]));
    const to = approach(st, u, {tiles}, fd.map(v => Math.min(v, 6)), (x, y) => (Math.abs(x - h.x) + Math.abs(y - h.y)) * 3 + (has(u, 'guardian') && Math.abs(x - h.x) + Math.abs(y - h.y) === 1 ? -8 : 0) + (frail ? (th.get(key(st, x, y)) || 0) * 25 : 0));
    return {kind: 'move', to, why: why || '跟著主角'};
  }
  const goal = stance === 'focus' && focus ? attackSpotsAround(st, u, focus) : foes.flatMap(f => attackSpotsAround(st, u, f));
  const to = approach(st, u, r, field(st, u, goal), frail ? (x, y) => (th.get(key(st, x, y)) || 0) * 25 : null);
  return {kind: 'move', to, why: why || (stance === 'focus' ? '逼近集火目標' : '逼近敵人')};
}

// 敵人的打算
export function moraleBroken(st) {
  const enemies = st.units.filter(u => u.side === 'enemy');
  const leaderDead = enemies.some(u => u.leader && !u.alive);
  return leaderDead || living(st, 'enemy').length <= st.initialEnemies / 2;
}
export function planEnemy(st, u) {
  const foes = enemiesOf(st, u), r = reach(st, u);
  const fleeing = isBeast(u) ? u.hp < u.max * 0.35 : (moraleBroken(st) && u.hp < u.max * 0.6);
  if (fleeing) {
    const edges = []; for (let x = 0; x < st.W; x++) { edges.push([x, 0]); edges.push([x, st.H - 1]); } for (let y = 0; y < st.H; y++) { edges.push([0, y]); edges.push([st.W - 1, y]); }
    return {kind: 'flee', to: approach(st, u, r, field(st, u, edges)), why: '逃跑'};
  }
  const atk = bestAttack(st, u, r.tiles, foes, (t, f, x, y) => {
    const exp = f.aHit / 100 * f.aDmg * f.aCount, kill = f.aDmg * f.aCount >= t.hp ? f.aHit / 100 * 50 : 0;
    return exp + kill + (t.hero ? 4 : 0) - f.dHit / 100 * f.dDmg * f.dCount * 0.4 + terrainAt(st, x, y).avo * 0.05;
  });
  if (u.leader && !atk && !foes.some(f => dist(f, u) <= u.mov + 3)) return {kind: 'wait', to: [u.x, u.y], why: '坐鎮'};
  if (atk) return atk;
  const to = approach(st, u, r, field(st, u, foes.flatMap(f => attackSpotsAround(st, u, f))));
  return {kind: 'move', to, why: '逼近'};
}

function execute(st, ev, u, plan) {
  if (!u.alive || u.fled) return;
  const r = reach(st, u);
  if (plan.to && r.tiles.some(([x, y]) => x === plan.to[0] && y === plan.to[1])) moveUnit(st, ev, u, plan.to[0], plan.to[1], r);
  if (plan.kind === 'attack') { const t = st.units.find(o => o.id === plan.target); if (t && t.alive && inRange(u, u.x, u.y, t.x, t.y)) combat(st, ev, u, t); }
  else if (plan.kind === 'heal') { const t = st.units.find(o => o.id === plan.target); if (t && t.alive && dist(u, t) === 1) heal(st, ev, u, t); }
  else if (plan.kind === 'flee' && (u.x === 0 || u.y === 0 || u.x === st.W - 1 || u.y === st.H - 1)) { u.fled = true; ev.push({t: 'flee', id: u.id}); }
}

/* ───────────── 回合流程 ───────────── */
function newTurn(st, ev) {
  st.turn++; st.heroDone = false; st.obey = {}; st.hidden = {};
  for (const u of living(st, 'ally')) {
    if (u.hero) continue;
    const chance = clamp(50 + u.loyalty * 0.5 + u.traits.reduce((s, t) => s + (TRAITS[t]?.obey || 0), 0), 10, 98);
    st.obey[u.id] = rngNext(st) * 100 < chance;
    if (!st.obey[u.id]) {
      // 不聽令的人，有些連打算都不讓你看出來：忠誠越低越會藏
      st.hidden[u.id] = u.loyalty < 35 || rngNext(st) < 0.4;
      ev.push({t: 'bark', id: u.id, text: st.hidden[u.id] ? '……' : has(u, 'reckless') ? '少囉嗦，我自己來！' : '……我有我的打算。'});
    }
  }
  ev.push({t: 'turn', n: st.turn});
}
function checkEnd(st, ev) {
  const h = hero(st);
  if (!h.alive) { st.result = 'lose'; ev.push({t: 'end', result: 'lose'}); return true; }
  if (!living(st, 'enemy').length) { st.result = 'win'; ev.push({t: 'end', result: 'win'}); return true; }
  return false;
}
const bySpeed = (a, b) => b.spd - a.spd || (a.id < b.id ? -1 : 1);

// 預覽：主角走到 (x, y) 之後，同伴們會怎麼做
export function previewAllies(st, x, y) {
  const c = JSON.parse(JSON.stringify(st)), h = hero(c);
  if (x !== undefined) { h.x = x; h.y = y; }
  const out = [], th = threat(c, 'ally');
  for (const u of living(c, 'ally').filter(u => !u.hero).sort(bySpeed)) {
    const p = planAlly(c, u, th); out.push({id: u.id, ...p, disobey: c.obey[u.id] === false, hidden: !!c.hidden?.[u.id]});
    if (p.to) { u.x = p.to[0]; u.y = p.to[1]; }   // 讓後面的人知道這格被佔了
  }
  return out;
}
export function previewEnemies(st) {
  const c = JSON.parse(JSON.stringify(st)), out = [];
  for (const u of living(c, 'enemy').sort(bySpeed)) { const p = planEnemy(c, u); out.push({id: u.id, ...p}); if (p.to) { u.x = p.to[0]; u.y = p.to[1]; } }
  return out;
}
// 敵人下回合打得到的所有格子（危險範圍）
export function dangerTiles(st) {
  const s = new Set();
  for (const e of living(st, 'enemy')) { const r = reach(st, e); for (const [x, y] of r.tiles) for (const [ax, ay] of attackSpotsAround(st, e, {x, y})) s.add(key(st, ax, ay)); }
  return s;
}
// 我方撤離：站在退路那幾邊的邊緣（被夾擊時，有敵人的那幾邊不是退路）
export const exitAt = (st, x, y) => { const e = st.exits || ['n', 's', 'w', 'e'], W = st.W ?? 10, H = st.H ?? 12; return (e.includes('n') && y === 0) || (e.includes('s') && y === H - 1) || (e.includes('w') && x === 0) || (e.includes('e') && x === W - 1); };
export const heroCanFlee = st => { const h = hero(st); return exitAt(st, h.x, h.y); };

// 唯一的行動入口
export function act(st, a) {
  if (st.result) throw new Error('戰鬥已結束');
  const ev = [];
  if (a.type === 'order') { st.order = {stance: a.stance, focus: a.focus ?? null}; return ev; }
  const h = hero(st);
  if (a.type === 'flee') {
    if (a.to) { const r = reach(st, h); if (r.tiles.some(([x, y]) => x === a.to[0] && y === a.to[1])) moveUnit(st, ev, h, a.to[0], a.to[1], r); }
    if (!heroCanFlee(st)) throw new Error('主角要站在退路那一邊的邊緣才能撤離');
    for (const u of living(st, 'ally')) {
      if (u === h || !living(st, 'enemy').some(e => dist(e, u) === 1)) { u.fled = true; ev.push({t: 'flee', id: u.id}); }
      else { u.captured = true; u.alive = false; ev.push({t: 'captured', id: u.id}); }
    }
    st.result = 'retreat'; ev.push({t: 'end', result: 'retreat'}); return ev;
  }
  if (a.type !== 'hero') throw new Error('未知的行動');
  // 1. 主角
  const r = reach(st, h);
  if (!r.tiles.some(([x, y]) => x === a.to[0] && y === a.to[1])) throw new Error('走不到那裡');
  moveUnit(st, ev, h, a.to[0], a.to[1], r);
  if (a.act?.kind === 'attack') { const t = st.units.find(o => o.id === a.act.target); if (!t || !t.alive || t.side !== 'enemy' || !inRange(h, h.x, h.y, t.x, t.y)) throw new Error('打不到'); combat(st, ev, h, t); }
  if (checkEnd(st, ev)) return ev;
  // 2. 同伴（依速度）
  ev.push({t: 'phase', side: 'ally'});
  { const th = threat(st, 'ally'); for (const u of living(st, 'ally').filter(u => !u.hero).sort(bySpeed)) { execute(st, ev, u, planAlly(st, u, th)); if (checkEnd(st, ev)) return ev; } }
  // 3. 敵人
  ev.push({t: 'phase', side: 'enemy'});
  for (const u of living(st, 'enemy').sort(bySpeed)) { execute(st, ev, u, planEnemy(st, u)); if (checkEnd(st, ev)) return ev; }
  newTurn(st, ev);
  return ev;
}
