// 奇幻戰幫切片：戰鬥核心
// 純規則，不碰畫面；瀏覽器與（之後的）伺服器共用同一份。
// 所有亂數都走 st.rng；同一份狀態 + 同一串行動 = 同一個結果。
// 行動的唯一入口是 act(st, action)，回傳這一步產生的事件（給畫面演出用）。
import {WEAPONS, TRIANGLE, CLASSES, TERRAIN, TRAITS, rngNext, rngInt, hashSeed} from './data.js';

export const W = 10, H = 12;
const key = (x, y) => y * W + x;
const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const has = (u, t) => u.traits && u.traits.includes(t);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ───────────── 地圖 ───────────── */
export function genMap(seed, biome) {
  const st = {rng: hashSeed('map', seed, biome)};
  const t = new Array(W * H).fill('grass');
  const put = (x, y, v) => { if (inMap(x, y)) t[key(x, y)] = v; };
  const blob = (kind, n, r) => { for (let i = 0; i < n; i++) { const cx = rngInt(st, W), cy = 2 + rngInt(st, H - 4); for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (Math.abs(x - cx) + Math.abs(y - cy) <= r && rngNext(st) < 0.7) put(x, y, kind); } };
  if (biome === 'forest') { blob('forest', 6, 2); blob('bush', 4, 1); blob('rock', 2, 0); }
  else if (biome === 'hills') { blob('hill', 5, 2); blob('rock', 4, 1); blob('forest', 2, 1); }
  else if (biome === 'camp') {
    blob('forest', 3, 1); blob('bush', 3, 1);
    for (let x = 1; x < W - 1; x++) if (x !== 4 && x !== 5) put(x, 4, 'wall');   // 寨牆，中間留門
    for (let y = 0; y < 4; y++) for (let x = 3; x < 7; x++) put(x, y, 'camp');
  } else { blob('bush', 4, 1); blob('forest', 3, 1); blob('hill', 2, 1); }
  if (biome !== 'camp') { const rx = 3 + rngInt(st, 4); for (let y = 0; y < H; y++) put(rx + (y > H / 2 ? 1 : 0), y, 'road'); }
  // 雙方的出生區保持空曠
  for (let y = H - 2; y < H; y++) for (let x = 2; x < W - 2; x++) t[key(x, y)] = 'grass';
  // 保證連通：從我方出生區走得到敵方出生區，否則把擋路的石頭打掉
  const reach = () => { const seen = new Set([key(5, H - 1)]), q = [[5, H - 1]]; while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy, k = key(nx, ny); if (inMap(nx, ny) && !seen.has(k) && TERRAIN[t[k]].cost < Infinity) { seen.add(k); q.push([nx, ny]); } } } return seen; };
  for (let guard = 0; guard < 40; guard++) {
    const seen = reach(); let ok = true;
    for (let y = 0; y < 3; y++) for (let x = 0; x < W; x++) if (TERRAIN[t[key(x, y)]].cost < Infinity && !seen.has(key(x, y))) ok = false;
    if (ok) break;
    for (let i = 0; i < t.length; i++) if (TERRAIN[t[i]].cost === Infinity && t[i] !== 'wall' && rngNext(st) < 0.35) t[i] = 'grass';
    if (guard > 20) for (let i = 0; i < t.length; i++) if (t[i] === 'wall' && rngNext(st) < 0.3) t[i] = 'camp';
  }
  return t;
}

/* ───────────── 建立戰鬥 ───────────── */
// party：玩家隊伍成員（世界層的資料），foes：敵人清單（同樣格式）
export function createBattle({seed, biome, party, foes, order}) {
  const st = {v: 1, seed, rng: hashSeed('battle', seed), biome, tiles: genMap(seed, biome), turn: 0, result: null, units: [], order: order || {stance: 'follow', focus: null}, obey: {}, log: []};
  const allySpots = [], enemySpots = [];
  for (let y = H - 1; y >= H - 3; y--) for (let x = 2; x < W - 2; x++) allySpots.push([x, y]);
  for (let y = 0; y < 4; y++) for (let x = 0; x < W; x++) enemySpots.push([x, y]);
  const free = (spots) => { for (const [x, y] of spots) if (TERRAIN[st.tiles[key(x, y)]].cost < Infinity && !st.units.some(u => u.x === x && u.y === y)) return [x, y]; return null; };
  const order1 = [4, 5, 3, 6, 2, 7];
  party.forEach((m, i) => { const p = free([[order1[i % 6], H - 1 - Math.floor(i / 6)], ...allySpots]); st.units.push(toUnit(m, 'ally', p)); });
  // 敵人散開放：頭目在最後面
  const es = enemySpots.slice(); for (let i = es.length - 1; i > 0; i--) { const j = rngInt(st, i + 1); [es[i], es[j]] = [es[j], es[i]]; }
  foes.forEach(m => { const spots = m.leader ? es.filter(([, y]) => y <= 1).concat(es) : es.filter(([, y]) => y >= 1).concat(es); st.units.push(toUnit(m, 'enemy', free(spots))); });
  st.initialEnemies = foes.length;
  newTurn(st, []);
  return st;
}
function toUnit(m, side, [x, y]) {
  return {id: m.id, side, hero: !!m.hero, leader: !!m.leader, name: m.name, cls: m.cls, sprite: m.sprite, lvl: m.lvl, exp: m.exp || 0, hp: m.hp, max: m.max, str: m.str, skl: m.skl, spd: m.spd, def: m.def, mov: m.mov, weapon: m.weapon, traits: m.traits || [], loyalty: m.loyalty ?? 100, x, y, alive: true, fled: false, captured: false, kills: 0, dealt: 0, levels: []};
}

/* ───────────── 查詢 ───────────── */
export const terrainAt = (st, x, y) => TERRAIN[st.tiles[key(x, y)]];
export const unitAt = (st, x, y) => st.units.find(u => u.alive && !u.fled && u.x === x && u.y === y);
export const living = (st, side) => st.units.filter(u => u.alive && !u.fled && (!side || u.side === side));
export const hero = st => st.units.find(u => u.hero);
const weapon = u => WEAPONS[u.weapon];
const isBeast = u => !!CLASSES[u.cls]?.beast;

// 可走的格子：Dijkstra；可以穿過自己人，不能穿過敵人，不能停在有人的格子
export function reach(st, u, mov = u.mov + (has(u, 'coward') && st.order.stance === 'retreat' && u.side === 'ally' ? 1 : 0)) {
  const best = new Map([[key(u.x, u.y), 0]]), prev = new Map(), q = [[0, u.x, u.y]];
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]); const [c, x, y] = q.shift();
    if (c > (best.get(key(x, y)) ?? Infinity)) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy; if (!inMap(nx, ny)) continue;
      const cost = terrainAt(st, nx, ny).cost; if (cost === Infinity) continue;
      const o = unitAt(st, nx, ny); if (o && o.side !== u.side) continue;
      const nc = c + cost; if (nc > mov) continue;
      const k = key(nx, ny); if (nc < (best.get(k) ?? Infinity)) { best.set(k, nc); prev.set(k, key(x, y)); q.push([nc, nx, ny]); }
    }
  }
  const tiles = [];
  for (const k of best.keys()) { const x = k % W, y = (k / W) | 0, o = unitAt(st, x, y); if (!o || o === u) tiles.push([x, y]); }
  return {tiles, prev, cost: best};
}
export function pathTo(r, u, x, y) {
  const out = [[x, y]]; let k = key(x, y);
  while (k !== key(u.x, u.y)) { k = r.prev.get(k); if (k === undefined) return [[u.x, u.y], [x, y]]; out.unshift([k % W, (k / W) | 0]); }
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
  const aHit = clamp(sa.hit + tr * 15 - sd.avo, 0, 100), aDmg = Math.max(0, sa.atk + tr - sd.def), aCrit = clamp(sa.crit - sd.critAvo, 0, 100);
  const canCounter = inRange(d, d.x, d.y, ax, ay);
  const dHit = canCounter ? clamp(sd.hit - tr * 15 - sa.avo, 0, 100) : 0, dDmg = canCounter ? Math.max(0, sd.atk - tr - sa.def) : 0, dCrit = canCounter ? clamp(sd.crit - sa.critAvo, 0, 100) : 0;
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
  const path = pathTo(r || reach(st, u), u, x, y);
  u.x = x; u.y = y; ev.push({t: 'move', id: u.id, path});
}

/* ───────────── 決策（不用亂數：預覽和實際一定一致） ───────────── */
// 距離場：從目標格出發、照 u 的移動成本算到每格要走多遠（不考慮行動力上限）
function field(st, u, goals) {
  const d = new Array(W * H).fill(Infinity), q = [];
  for (const [x, y] of goals) { d[key(x, y)] = 0; q.push([0, x, y]); }
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]); const [c, x, y] = q.shift(); if (c > d[key(x, y)]) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy; if (!inMap(nx, ny)) continue;
      const cost = terrainAt(st, nx, ny).cost; if (cost === Infinity) continue;
      const o = unitAt(st, nx, ny); const extra = o && o.side !== u.side ? 4 : 0;
      const nc = c + terrainAt(st, x, y).cost + extra; if (nc < d[key(nx, ny)]) { d[key(nx, ny)] = nc; q.push([nc, nx, ny]); }
    }
  }
  return d;
}
const attackSpotsAround = (u, t) => { const out = [], [lo, hi] = weapon(u).range; for (let dy = -hi; dy <= hi; dy++) for (let dx = -hi; dx <= hi; dx++) { const m = Math.abs(dx) + Math.abs(dy); if (m >= lo && m <= hi && inMap(t.x + dx, t.y + dy)) out.push([t.x + dx, t.y + dy]); } return out; };

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
  for (const [x, y] of r.tiles) { const s = fd[key(x, y)] * 10 - terrainAt(st, x, y).avo * 0.1 + (prefer ? prefer(x, y) : 0); if (s < bs) { bs = s; best = [x, y]; } }
  return best;
}
const enemiesOf = (st, u) => living(st).filter(o => o.side !== u.side);

// 每格會被幾個敵人打到（下個敵方階段）
function threat(st, side) {
  const m = new Map();
  for (const e of living(st).filter(o => o.side !== side)) { const seen = new Set(); for (const [x, y] of reach(st, e).tiles) for (const [ax, ay] of attackSpotsAround(e, {x, y})) seen.add(key(ax, ay)); for (const k of seen) m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
// 同伴的打算
export function planAlly(st, u) {
  const h = hero(st), foes = enemiesOf(st, u), r = reach(st, u), th = threat(st, u.side);
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
    if (frail) s -= (th.get(key(x, y)) || 0) * 3;
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
      const s = (a.max - a.hp) + (a.hero ? 10 : 0) - (th.get(key(x, y)) || 0) * 7;
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
    const to = approach(st, u, {tiles}, fd.map(v => Math.min(v, 6)), (x, y) => (Math.abs(x - h.x) + Math.abs(y - h.y)) * 3 + (has(u, 'guardian') && Math.abs(x - h.x) + Math.abs(y - h.y) === 1 ? -8 : 0) + (frail ? (th.get(key(x, y)) || 0) * 25 : 0));
    return {kind: 'move', to, why: why || '跟著主角'};
  }
  const goal = stance === 'focus' && focus ? attackSpotsAround(u, focus) : foes.flatMap(f => attackSpotsAround(u, f));
  const to = approach(st, u, r, field(st, u, goal), frail ? (x, y) => (th.get(key(x, y)) || 0) * 25 : null);
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
    const edges = []; for (let x = 0; x < W; x++) edges.push([x, 0]); for (let y = 0; y < H; y++) { edges.push([0, y]); edges.push([W - 1, y]); }
    return {kind: 'flee', to: approach(st, u, r, field(st, u, edges)), why: '逃跑'};
  }
  const atk = bestAttack(st, u, r.tiles, foes, (t, f, x, y) => {
    const exp = f.aHit / 100 * f.aDmg * f.aCount, kill = f.aDmg * f.aCount >= t.hp ? f.aHit / 100 * 50 : 0;
    return exp + kill + (t.hero ? 4 : 0) - f.dHit / 100 * f.dDmg * f.dCount * 0.4 + terrainAt(st, x, y).avo * 0.05;
  });
  if (u.leader && !atk && !foes.some(f => dist(f, u) <= u.mov + 3)) return {kind: 'wait', to: [u.x, u.y], why: '坐鎮'};
  if (atk) return atk;
  const to = approach(st, u, r, field(st, u, foes.flatMap(f => attackSpotsAround(u, f))));
  return {kind: 'move', to, why: '逼近'};
}

function execute(st, ev, u, plan) {
  if (!u.alive || u.fled) return;
  const r = reach(st, u);
  if (plan.to && r.tiles.some(([x, y]) => x === plan.to[0] && y === plan.to[1])) moveUnit(st, ev, u, plan.to[0], plan.to[1], r);
  if (plan.kind === 'attack') { const t = st.units.find(o => o.id === plan.target); if (t && t.alive && inRange(u, u.x, u.y, t.x, t.y)) combat(st, ev, u, t); }
  else if (plan.kind === 'heal') { const t = st.units.find(o => o.id === plan.target); if (t && t.alive && dist(u, t) === 1) heal(st, ev, u, t); }
  else if (plan.kind === 'flee' && (u.x === 0 || u.y === 0 || u.x === W - 1)) { u.fled = true; ev.push({t: 'flee', id: u.id}); }
}

/* ───────────── 回合流程 ───────────── */
function newTurn(st, ev) {
  st.turn++; st.heroDone = false; st.obey = {};
  for (const u of living(st, 'ally')) {
    if (u.hero) continue;
    const chance = clamp(50 + u.loyalty * 0.5 + u.traits.reduce((s, t) => s + (TRAITS[t]?.obey || 0), 0), 10, 98);
    st.obey[u.id] = rngNext(st) * 100 < chance;
    if (!st.obey[u.id]) ev.push({t: 'bark', id: u.id, text: has(u, 'reckless') ? '少囉嗦，我自己來！' : '……我有我的打算。'});
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
  const out = [];
  for (const u of living(c, 'ally').filter(u => !u.hero).sort(bySpeed)) {
    const p = planAlly(c, u); out.push({id: u.id, ...p, disobey: c.obey[u.id] === false});
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
  for (const e of living(st, 'enemy')) { const r = reach(st, e); for (const [x, y] of r.tiles) for (const [ax, ay] of attackSpotsAround(e, {x, y})) s.add(key(ax, ay)); }
  return s;
}
export const heroCanFlee = st => { const h = hero(st); return h.x === 0 || h.x === W - 1 || h.y === H - 1 || h.y === 0; };

// 唯一的行動入口
export function act(st, a) {
  if (st.result) throw new Error('戰鬥已結束');
  const ev = [];
  if (a.type === 'order') { st.order = {stance: a.stance, focus: a.focus ?? null}; return ev; }
  const h = hero(st);
  if (a.type === 'flee') {
    if (a.to) { const r = reach(st, h); if (r.tiles.some(([x, y]) => x === a.to[0] && y === a.to[1])) moveUnit(st, ev, h, a.to[0], a.to[1], r); }
    if (!heroCanFlee(st)) throw new Error('主角要站在地圖邊緣才能撤離');
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
  for (const u of living(st, 'ally').filter(u => !u.hero).sort(bySpeed)) { execute(st, ev, u, planAlly(st, u)); if (checkEnd(st, ev)) return ev; }
  // 3. 敵人
  ev.push({t: 'phase', side: 'enemy'});
  for (const u of living(st, 'enemy').sort(bySpeed)) { execute(st, ev, u, planEnemy(st, u)); if (checkEnd(st, ev)) return ev; }
  newTurn(st, ev);
  return ev;
}
