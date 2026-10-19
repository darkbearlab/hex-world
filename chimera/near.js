// 近的一層（Alan 2026-10-18，DESIGN.md「縮小規模」第 3 步；2026-10-19 升級到作戰地圖的小格，warband/OPMAP.md 第 2 段）：
// 沙盒是遠的那層（數字：匪患、原住民地盤、城），基地附近的數字變成作戰地圖上看得到、會動的兵牌——掠奪者、原住民、商隊。
// - 只在看得到的範圍生出來（基地四周 RANGE 格），走遠了就消失（不追蹤去哪）。
// - 一小格一小格走：每小時 60 分鐘的預算，照小格地形（opmap.js 的 TERRAIN）× 兵牌自己的倍率。等速追不上；騎車的掠奪者比基地快。
// - 控制區：敵對的兵牌走到基地旁邊一小格（或基地開到牠旁邊）＝接觸，開遭遇的服務單（親自打／自動戰鬥／撤退）。
// - 非玩家之間（掠奪者碰到商隊）：擲戰鬥結果表（CRT），結果寫回沙盒（被劫：目的地的城少一點貨、那一帶匪患升；擊退：匪患降），交戰時雙方卡在原地。
// 只在單機開（NEAR.on，server/worker.js 的 soloInit）；線上的共用星球照舊擲骰。
import {NBR, W as MAPW} from './sim.js';
import {TERRAIN, DIRS, center, key, hexDist, cellsOf, dataFromSim, legRoute, alongRoute, subRoute} from './opmap.js';
import {posOn, pay} from './cases.js';
import {relOf, REL} from './company.js';

export const NEAR = {
  on: false,
  RANGE: 4,          // 看得到幾格戰略格
  MAX: 8,            // 同時最多幾個兵牌
  LIFE: 96,          // 一個兵牌最多留幾小時
  CHASE: 3,          // 敵對兵牌離基地幾格戰略格以內就追過來
  BANDIT: 2.5e-5,    // 掠奪者：每格每小時出現的機率 ＝ 匪患 × BANDIT
  NATIVE: 4e-4,      // 原住民：地盤（巢穴 3 格內）每格每小時
  CARAVAN: .02,      // 商隊：範圍內每座城每小時
  PATROL: .0015,     // 巡邏隊：勢力地盤（不在城裡）每格每小時；那個勢力在打仗的話 ×3（第 4 段）
  NIGHT: [20, 6],    // 夜裡（遊戲時間 20:00～06:00）：敵對兵牌追人的距離縮成 NIGHT_CHASE，離玩家 2 格外的兵牌看不到
  NIGHT_CHASE: 2,
  HIDE: 3,           // 兵牌在林、廢墟的小格裡：離玩家 3 小格外看不到
  TRADE: 1.3,        // 跟商隊買：照目的地城的價格 ×1.3
  // 移動：地形的分鐘數用車還是徒步，再乘這個倍率（OPMAP.md：掠奪者騎車快、商隊慢、基地 ×1.3）
  MOVE: {bandit: ['car', .8], native: ['foot', 1], caravan: ['car', 1.5], patrol: ['car', 1]},
  // 清剿據點（OPMAP.md 第十三節）：走到據點旁邊一小格才找得到；哨兵的耳目：車（和基地）3 小格、徒步 1 小格，夜裡各減一格
  SENTRY: {car: 3, foot: 1}, SPOT: .35, ALERT: 24, MOVE_AWAY: .5,
};
const KIND = {bandit: {n: '掠奪者', hostile: true}, native: {n: '原住民', hostile: true}, caravan: {n: '商隊', hostile: false}, patrol: {n: '巡邏隊', hostile: false}};
// 對這家公司敵不敵對：掠奪者、原住民一律敵對；巡邏隊看登記地的勢力跟牠交戰、或派系關係低到不往來（第 4 段）
function hostileTo(p, G, w) { if (p.kind !== 'patrol') return KIND[p.kind].hostile; const K = w.sim.peek(), f0 = K.owner[G.home ?? G.base]; return (f0 >= 0 && w.sim.pmc.atWar(p.fac, f0)) || relOf(G, p.fac) <= REL.REFUSE; }
export const isNight = h => { const x = ((h % 24) + 24) % 24; return x >= NEAR.NIGHT[0] || x < NEAR.NIGHT[1]; };
const hiddenCell = c => !!c && (c.k === 'forest' || c.f === 'ruin');
const roll = (t, h, salt) => (((t * 2654435761) ^ (h * 40503) ^ (salt * 2246822519)) >>> 0) % 100000 / 100000;
const ring = (c, r) => { const out = [], seen = new Set([c]); let edge = [c]; for (let d = 0; d < r; d++) { const nx = []; for (const t of edge) for (const n of NBR[t]) if (!seen.has(n)) { seen.add(n); nx.push(n); out.push(n); } edge = nx; } return out; };
const town = (K, t) => !!K.markets[t] && K.owner[t] >= 0;

// 作戰地圖的資料（每季換一次）與小格（照需要展開、快取）
let OD = null, ODkey = '', CELLS = new Map();
export function od(w) { const K = w.sim.peek(), k = K.curY + ':' + (w.sim.season || 0) + ':' + (K.routes?.length || 0); if (k !== ODkey) { ODkey = k; OD = dataFromSim(w, K, MAPW, t => NBR[t]); CELLS = new Map(); } return OD; }
function cellAt(w, t, q, r) { const D = od(w); let m = CELLS.get(t); if (!m) { if (CELLS.size > 400) CELLS.clear(); m = cellsOf(t, D); CELLS.set(t, m); } return m.get(key(q, r)); }
// 小格屬於哪個戰略格：先看原本那格，再看鄰格（六角群半徑 3）
function tileOf(t, pos) { if (hexDist(center(t, MAPW), pos) <= 3) return t; for (const n of NBR[t]) if (hexDist(center(n, MAPW), pos) <= 3) return n; for (const n of NBR[t]) for (const m of NBR[n]) if (hexDist(center(m, MAPW), pos) <= 3) return m; return t; }
function cellOf(w, t, pos) { const u = tileOf(t, pos); return {t: u, c: cellAt(w, u, pos[0], pos[1])}; }
const minutes = (kind, c) => { if (!c) return Infinity; const [m, x] = NEAR.MOVE[kind]; const v = TERRAIN[c.k]?.[m]; return isFinite(v) ? v * x : c.bridge ? 4 * x : Infinity; };

// 基地在作戰地圖上的位置（小格）：開動中照小格路線內插（跟畫面同一套），停著就是那一格的中心
const legCache = new Map();
export function basePos(G, w, h) {
  const R = G.hq;
  if (R?.subMove) { const {from, to, t0, t1} = R.subMove, f = Math.max(0, Math.min(1, (h - t0) / Math.max(.01, t1 - t0))); return [Math.round(from[0] + (to[0] - from[0]) * f), Math.round(from[1] + (to[1] - from[1]) * f)]; }
  if (!R?.move) return R?.sub || center(G.base, MAPW);
  const {from, to, t0, t1} = R.move, f = Math.max(0, Math.min(1, (h - t0) / Math.max(.01, t1 - t0))), k2 = ODkey + ':' + from + '-' + to;
  let rt = legCache.get(k2); if (!rt) { if (legCache.size > 200) legCache.clear(); rt = legRoute(from, to, od(w)); legCache.set(k2, rt); }
  const [q, r] = alongRoute(rt, f); return [Math.round(q), Math.round(r)];
}

// 往目標走一步：鄰格裡離目標最近、走得過去的（同距離挑比較快的地形）
function stepToward(w, p, goal) {
  let best = null, bd = hexDist(p.pos, goal), bc = Infinity;
  for (const [dq, dr] of DIRS) { const q = p.pos[0] + dq, r = p.pos[1] + dr, {t, c} = cellOf(w, p.tile, [q, r]), m = minutes(p.kind, c); if (!isFinite(m)) continue; const d = hexDist([q, r], goal); if (d < bd || (d === bd && best && m < bc)) { best = {pos: [q, r], t, m}; bd = d; bc = m; } }
  return best;
}

// 玩家的眼睛：基地、在路上的運兵車（看得到四周 RANGE 格；兵牌只在這附近生出、追這些人）
const vanCache = new Map();
export function eyes(G, book, w, h) {
  const out = [{kind: 'base', tile: G.base, pos: basePos(G, w, h)}];
  for (const sq of Object.values(book?.squads || {})) {
    if (sq.player !== G.name || !sq.van || !sq.move || h >= sq.move.t1 || !sq.move.path?.length) continue;
    const p = posOn(sq.move.path, (h - sq.move.t0) / Math.max(1, sq.move.t1 - sq.move.t0)), k2 = ODkey + ':' + p.a + '-' + p.b;
    let rt = vanCache.get(k2); if (!rt) { if (vanCache.size > 200) vanCache.clear(); rt = p.a === p.b ? [{q: center(p.a, MAPW)[0], r: center(p.a, MAPW)[1], at: 0}] : legRoute(p.a, p.b, od(w)); vanCache.set(k2, rt); }
    const [q, r] = alongRoute(rt, p.f); out.push({kind: 'van', tile: p.f < .5 ? p.a : p.b, pos: [Math.round(q), Math.round(r)], sq});
  }
  // 在一格裡照小格走的人（巡查整格、派人到某一小格）
  for (const sq of Object.values(book?.squads || {})) if (sq.player === G.name && sq.op && !sq.op.done && sq.op.pause == null && !sq.busy) out.push({kind: 'van', team: true, foot: sq.op.mode === 'foot', tile: sq.op.tile, pos: opPos(sq.op, h), sq});
  return out;
}
// 每個遊戲小時（rover.js 的 hqHour，每家玩家公司）：生出、移動、非玩家之間的交戰、接觸。
// 回傳 {base: 接觸到基地的敵對兵牌, vans: [{sq, p}]（接觸到運兵車的）}；canFight＝基地手上沒有別的單
export function nearHour(G, w, h, canFight, say, book) {
  if (!NEAR.on) return null;
  const R = G.hq; if (!R) return null;
  const K = w.sim.peek(), base = G.base, P = R.near ||= [], E = eyes(G, book, w, h), bpos = E[0].pos, safe = town(K, base) && !R.move && !R.subMove;
  const baseHidden = !R.move && !R.subMove && !!R.sub && cellOf(w, G.base, R.sub).c?.k === 'forest';   // 基地停在林的小格裡（第 4 段）
  for (const p of P) if (!p.pos) { p.pos = center(p.tile, MAPW); p.mins = 0; }   // 舊的兵牌（升級前只有戰略格）：放到那一格的中心
  const out = {base: null, vans: [], found: [], spotted: [], moved: []}, hitVan = new Set();
  lairTick(G, w, h, out);   // 據點：警戒過了可能搬家、每天回補、流寇換地方
  // 走遠了、待太久的就消失
  for (let i = P.length - 1; i >= 0; i--) if (Math.min(...E.map(e => hexDistT(P[i].tile, e.tile))) > NEAR.RANGE + 1 || h - P[i].born > NEAR.LIFE) P.splice(i, 1);
  // 生出
  const around = new Set(); for (const e of E) for (const t of ring(e.tile, NEAR.RANGE)) around.add(t);
  if (P.length < NEAR.MAX) for (const t of around) {
    if (P.length >= NEAR.MAX || !w.land[t] || P.some(p => p.tile === t)) continue;
    if (town(K, t)) { if (roll(t, h, 11) < NEAR.CARAVAN) { const to = Object.keys(K.markets).map(Number).filter(u => u !== t && town(K, u) && hexDistT(u, t) <= 10).sort((a, b) => hexDistT(a, t) - hexDistT(b, t))[Math.floor(roll(t, h, 12) * 3)]; if (to != null) P.push(make(G, w, 'caravan', t, h, {to, str: 3})); } continue; }
    const nat = (K.gangs || []).find(g => !g.gone && g.native && hexDistT(g.lair, t) <= 3);
    if (nat && roll(t, h, 13) < NEAR.NATIVE) { P.push(make(G, w, 'native', t, h, {str: 5, lair: nat.lair})); continue; }
    // 巡邏隊：勢力的地盤上，往那個勢力最近的另一座城走
    const f = K.owner[t];
    if (f >= 0 && K.fac[f]?.alive !== false && roll(t, h, 16) < NEAR.PATROL * (K.fac.some((x, j) => j !== f && x.alive !== false && w.sim.pmc.atWar(f, j)) ? 3 : 1)) {
      const to = Object.keys(K.markets).map(Number).filter(u => town(K, u) && K.owner[u] === f).sort((a, b) => hexDistT(a, t) - hexDistT(b, t))[0];
      if (to != null) { P.push(make(G, w, 'patrol', t, h, {str: 6, fac: f, to})); continue; } }
    if (roll(t, h, 14) < (K.bandit[t] || 0) * NEAR.BANDIT) P.push(make(G, w, 'bandit', t, h, {str: 3 + Math.round((K.bandit[t] || 0) / 20)}));
  }
  // 一小時切成 SLICES 段（每段 10 分鐘）：兵牌走一段、玩家的基地和運兵車也照那個時刻的位置，每段檢查一次接觸——
  // 運兵車一小時走 7～14 小格，一小時才看一次會擦身而過
  for (let sl = 1; sl <= SLICES; sl++) {
  const tt = h - 1 + sl / SLICES, Es = sl === SLICES ? E : eyes(G, book, w, tt), bp = Es[0].pos;
  // 移動：每段 60/SLICES 分鐘的預算（沒走完的留著，最多兩小時份）
  for (const p of P) {
    if (p.hold > h) continue;
    p.mins = Math.min(120, (p.mins || 0) + 60 / SLICES);
    for (let guard = 0; guard < 20; guard++) {
      let goal;
      if (p.kind === 'caravan') goal = center(p.to, MAPW);
      else if (p.kind === 'patrol' && !hostileTo(p, G, w)) { goal = center(p.to, MAPW); if (hexDist(p.pos, goal) <= 1) { const o = Object.keys(K.markets).map(Number).filter(u => town(K, u) && K.owner[u] === p.fac && u !== p.to); if (o.length) p.to = o[Math.floor(roll(p.id, h, 17) * o.length)]; } }
      else { const reach = isNight(tt) ? NEAR.NIGHT_CHASE : NEAR.CHASE;
        const tgt = Es.filter(e => !(e.kind === 'base' && safe) && !(e.sq?.busy) && hexDistT(p.tile, e.tile) <= reach
          && !(p.kind === 'native' && p.lair != null && hexDistT(e.tile, p.lair) > 2)                       // 原住民只追進到巢穴 2 格內的人
          && !(e.kind === 'base' && baseHidden && hexDistT(p.tile, e.tile) > .5)).sort((a, b) => hexDist(a.pos, p.pos) - hexDist(b.pos, p.pos))[0];   // 基地躲在林裡：同一格才找得到
        if (tgt) { goal = tgt.pos; p.chase = true; } else goal = null; }
      if (!goal) { p.chase = false; if (!p.wander || hexDist(p.pos, p.wander) <= 1) { const c0 = center(p.kind === 'native' && p.lair != null ? p.lair : p.tile, MAPW), d = DIRS[Math.floor(roll(p.id, h + guard, 7) * 6)], k3 = p.kind === 'native' ? 1 + Math.floor(roll(p.id, h + guard, 8) * 14) : 3; p.wander = [c0[0] + d[0] * k3, c0[1] + d[1] * k3]; } goal = p.wander; }
      if (hexDist(p.pos, goal) <= (p.kind === 'caravan' ? 0 : 1)) break;
      const s = stepToward(w, p, goal); if (!s || s.m > p.mins) break;
      p.mins -= s.m; p.pos = s.pos; p.tile = s.t;
    }
  }
  // 商隊到了就消失
  for (let i = P.length - 1; i >= 0; i--) if (P[i].kind === 'caravan' && hexDist(P[i].pos, center(P[i].to, MAPW)) <= 0) P.splice(i, 1);
  // 非玩家之間：掠奪者碰到商隊（相鄰一小格）擲戰鬥結果表
  // 巡邏隊碰到掠奪者會出手：掠奪者被打散，匪患降
  for (const a of P.filter(p => p.kind === 'patrol' && !(p.hold > h))) {
    const v = P.find(p => p.kind === 'bandit' && !(p.hold > h) && hexDist(p.pos, a.pos) <= 1); if (!v) continue;
    const r = crt(a.str, v.str, roll(a.id * 37 + v.id, h, 24)), nm = w.names[v.tile] || '荒野', hold = h + 1 + Math.floor(roll(a.id, h, 25) * 2); a.hold = hold; v.hold = hold;
    if (r === 'robbed') { K.bandit[v.tile] = Math.max(0, (K.bandit[v.tile] || 0) - 2); P.splice(P.indexOf(v), 1); say?.(h, v.tile, `附近：${nm}一帶，${K.fac[a.fac]?.n || ''}的巡邏隊打散了一群掠奪者。`); }
    else if (r === 'repelled') say?.(h, v.tile, `附近：${nm}一帶，掠奪者擋住了${K.fac[a.fac]?.n || ''}的巡邏隊。`);
  }
  for (const a of P.filter(p => (p.kind === 'bandit' || (p.kind === 'native' && p.lair != null && hexDistT(p.tile, p.lair) <= 3)) && !(p.hold > h))) {
    const v = P.find(p => p.kind === 'caravan' && !(p.hold > h) && hexDist(p.pos, a.pos) <= 1); if (!v) continue;
    const r = crt(a.str, v.str, roll(a.id * 31 + v.id, h, 21), v.pos && cellOf(w, v.tile, v.pos).c?.road ? 0 : 0), nm = w.names[v.tile] || '荒野';
    const hold = h + 1 + Math.floor(roll(a.id, h, 22) * 3); a.hold = hold; v.hold = hold;
    if (r === 'robbed') { const m = K.markets[v.to]; if (m) { const g = ['food', 'water', 'fuel', 'parts'][Math.floor(roll(v.id, h, 23) * 4)]; m.stock[g] = Math.max(0, m.stock[g] * .995); } K.bandit[v.tile] = Math.min(100, (K.bandit[v.tile] || 0) + 1); a.str += 1; P.splice(P.indexOf(v), 1); say?.(h, v.tile, `附近：${nm}一帶，一群${KIND[a.kind].n}攔下往${w.names[v.to] || '別座城'}的商隊，搶走了貨。`); }
    else if (r === 'repelled') { K.bandit[a.tile] = Math.max(0, (K.bandit[a.tile] || 0) - 1); a.str = Math.max(1, a.str - 1); a.wander = null; for (let i = 0; i < 2; i++) { const s = stepToward(w, a, [a.pos[0] * 2 - v.pos[0], a.pos[1] * 2 - v.pos[1]]); if (s) { a.pos = s.pos; a.tile = s.t; } } say?.(h, v.tile, `附近：${nm}一帶，往${w.names[v.to] || '別座城'}的商隊打退了一群掠奪者。`); }
    else say?.(h, v.tile, `附近：${nm}一帶，掠奪者和商隊交上火了。`);
  }
  lairWatch(G, w, Es, tt, h, out, P);
  for (const e of Es) if (e.team && tt >= e.sq.op.pts[e.sq.op.pts.length - 1][2]) e.sq.op.done = true;   // 走完了
  // 接觸：敵對兵牌在基地、運兵車旁邊一小格（控制區）
  if (!out.base && !safe && canFight) { const i = P.findIndex(p => hostileTo(p, G, w) && !(p.hold > h) && hexDist(p.pos, bp) <= 1); if (i >= 0) out.base = P.splice(i, 1)[0]; }
  for (const e of Es.slice(1)) { if (e.sq.busy || hitVan.has(e.sq.id)) continue; const i = P.findIndex(p => hostileTo(p, G, w) && !(p.hold > h) && hexDist(p.pos, e.pos) <= 1); if (i >= 0) { hitVan.add(e.sq.id); out.vans.push({sq: e.sq, tile: e.tile, p: P.splice(i, 1)[0]}); } }
  }
  // 看不看得到（第 4 段）：夜裡離玩家 2 格外看不到；在林、廢墟的小格裡，離玩家 3 小格外看不到
  const night = isNight(h);
  for (const p of P) { const c = cellOf(w, p.tile, p.pos).c; p.vis = E.some(e => (!night || hexDistT(p.tile, e.tile) <= 2) && (!hiddenCell(c) || hexDist(p.pos, e.pos) <= NEAR.HIDE)); p.hostile = hostileTo(p, G, w); }
  return out;
}
// 跟商隊買東西（第 4 段）：基地在商隊旁邊一小格；照牠目的地那座城的價格 ×TRADE；牠的貨有限
export function caravanBuy(G, book, w, h, id, mat, qty) {
  if (!NEAR.on) return '只有單機有';
  const p = (G.hq?.near || []).find(x => x.id === id && x.kind === 'caravan'); if (!p) return '這支商隊已經走了';
  if (mat !== 'food' && mat !== 'water') return '商隊只賣熱量、淨水';
  if (hexDist(basePos(G, w, h), p.pos) > 1) return '基地要開到商隊旁邊一小格';
  const gr = grudge(G, G.base, h); if (gr) return `這一帶的人知道你打了${gr.name}，商隊不跟你買賣`;
  const left = (p.cargo ||= {food: 40, water: 40})[mat]; qty = Math.min(Math.max(1, qty | 0), left); if (!qty) return '這支商隊的貨賣完了';
  const pr = caravanPrice(w, p)[mat], cost = Math.round(pr * qty * 10) / 10; if (cost > G.cash) return '錢不夠';
  pay(book, h, G.name, -cost, 'buy', `跟往${w.names[p.to] || ''}的商隊買${mat === 'food' ? '熱量' : '淨水'} ${qty}`);
  p.cargo[mat] -= qty; G.mats[mat] = (G.mats[mat] || 0) + qty; return null;
}
function caravanPrice(w, p) { const m = w.sim.peek().markets[p.to], q = g => m?.price?.[g] ?? 1; return {food: +(.2 * q('food') * NEAR.TRADE).toFixed(2), water: +(.24 * q('water') * NEAR.TRADE).toFixed(2)}; }
// 打聽消息（第 4 段）：基地停在聚落（或城）的小格；同一處一天一次。說附近的遠征點、據點在哪個方向
const DIR8 = ['東', '東南', '南', '西南', '西', '西北', '北', '東北'];
export function askLocal(G, book, w, h, siteList) {
  if (!NEAR.on) return '只有單機有';
  const R = G.hq; if (!R || R.move || R.subMove) return '基地要停下來';
  const pos = R.sub || center(G.base, MAPW), c = cellOf(w, G.base, pos).c; if (!c || !(c.f === 'settle' || c.f === 'town')) return '基地要停在聚落或城的那一小格';
  const gr = grudge(G, G.base, h); if (gr) return `這一帶的人知道你打了${gr.name}，沒有人願意跟你說話`;
  const k = pos[0] + ',' + pos[1]; R.asked ||= {}; if (h - (R.asked[k] ?? -1e9) < 24) return '這裡今天已經打聽過了';
  R.asked[k] = h;
  const K = w.sim.peek(), from = center(G.base, MAPW), dir = t => { const c2 = center(t, MAPW), x = (c2[0] - from[0]) + (c2[1] - from[1]) / 2, y = (c2[1] - from[1]) * .866, a = Math.atan2(y, x); return DIR8[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]; };
  const near = (L, n) => L.filter(x => x.tile !== G.base).map(x => ({...x, d: hexDistT(x.tile, G.base)})).filter(x => x.d <= n).sort((a, b) => a.d - b.d);
  const lines = [];
  const lair = near((K.gangs || []).filter(g => !g.gone).map(g => ({tile: g.lair, name: g.native ? g.name : `${g.name}的據點`})), 6)[0];
  if (lair) lines.push(`往${dir(lair.tile)}大約 ${Math.round(lair.d)} 格，有${lair.name}。`);
  const site = near(siteList || [], 6)[0]; if (site) lines.push(`往${dir(site.tile)}大約 ${Math.round(site.d)} 格，聽說有${site.title}。`);
  if (!lines.length) lines.push('這一帶最近沒什麼事。');
  return {say: `在${c.f === 'town' ? '城裡' : '聚落'}打聽：${lines.join('')}`};
}
const SLICES = 6;
// ───── 清剿據點（OPMAP.md 第十三、十四節）─────
// 一夥人＝幾處據點＋兵力池（十四節，Alan 2026-10-20）：實力（g.str）換成兵力，分到主據點（頭目在）和 0～3 個小據點；流寇只有 2～3 個臨時營地、會換地方；
// 每處據點有自己的小格、層數（一層一層打，照設施的打法）、兵力（打掉的不補回，每天慢慢回補）。都記在公司身上（G.lairs），第一次用到時排好
export const LAIR = {PER_OUT: 150, MAX_OUT: 3, POOL: [30, .3], MAIN_SHARE: .5, REGEN: .05, REGEN_NATIVE: .1, REGEN_CAP: .8, UNIT: 4,
  REINF: {same: 4, near: 7, share: .25, alert: 2}, NOMAD_DAYS: [3, 5], NOMAD_RANGE: 3};
const siteCells = (w, tile) => { const c0 = center(tile, MAPW), all = [...cellsOf(tile, od(w)).values()].filter(c => isFinite(TERRAIN[c.k]?.foot) && !c.road && !c.bridge && (!c.f || c.f === 'ruin') && hexDist([c.q, c.r], c0) >= 1);
  const pref = all.filter(c => c.k === 'forest' || c.k === 'rough' || c.f === 'ruin'); return pref.length ? pref : all.length ? all : [{q: c0[0], r: c0[1] + 1}]; };
const pickCell = (w, tile, seed, salt, not = []) => { const all = siteCells(w, tile), P = all.filter(c => !not.some(q => q && q[0] === c.q && q[1] === c.r)), L = P.length ? P : all, c = L[Math.floor(roll(seed, salt, 41) * L.length)]; return [c.q, c.r]; };
const isNomad = (K, g) => !g.native && (g.str || 0) < 150 && (K.curY ?? 0) - (g.born ?? -99) <= 5;   // 剛聚眾、人還不多的掠奪者＝流寇
const okTile = (w, K, t) => w.land[t] && !(K.markets[t] && K.owner[t] >= 0);
export function siteName(g, s) { if (g.native) return s.head ? `${g.name}的村子` : `${g.name}的外圍營地`; if (s.kind === 'camp') return s.head ? `${g.name}的營地` : `${g.name}的臨時營地`; return s.head ? `${g.name}的據點` : `${g.name}的小據點`; }
function layoutSites(w, K, g, around, nomad, total, keep = {}) {
  const sites = [], tiles = [around, ...NBR[around].filter(t => okTile(w, K, t))], used = [];
  const put = (i, tile, kind, head, layers, pool) => { const sub = i === 0 && keep.sub ? keep.sub : pickCell(w, tile, g.id * 13 + i, (keep.salt || 0) + i, used); used.push(sub);
    sites.push({sid: (keep.sid0 || 0) + i, tile, sub, kind, head, layers, taken: 0, pool, max: pool, found: i === 0 ? keep.found ?? null : null, alert: i === 0 ? keep.alert ?? null : null}); };
  if (nomad) { const n = 2 + ((g.str || 0) > 100 ? 1 : 0); for (let i = 0; i < n; i++) put(i, i ? tiles[Math.floor(roll(g.id, (keep.salt || 0) + i, 46) * tiles.length)] : around, 'camp', i === 0, 1, total / n); }
  else { const nOut = Math.min(LAIR.MAX_OUT, Math.floor((g.str || 0) / LAIR.PER_OUT)), main = nOut ? total * LAIR.MAIN_SHARE : total;
    put(0, around, 'main', true, 3, main); for (let i = 1; i <= nOut; i++) put(i, tiles[Math.floor(roll(g.id, i, 47) * tiles.length)], 'out', false, 2, (total - main) / nOut); }
  return sites;
}
// 打了原住民的村子（第十四節）：附近 4 格的聚落和商隊一陣子不理你（G.grudge：[{tile, until, name}]）
export const grudge = (G, t, h) => (G.grudge || []).find(x => h < x.until && hexDistT(x.tile, t) <= 4) || null;
export function gangInfo(G, w, g) {
  const L = G.lairs ||= {}; let x = L[g.id]; if (x?.sites) return x;
  const K = w.sim.peek(), old = x || {}, nomad = isNomad(K, g), total = LAIR.POOL[0] + (g.str || 0) * LAIR.POOL[1];
  x = L[g.id] = {sites: layoutSites(w, K, g, g.lair, nomad, total, {sub: old.sub, found: old.found, alert: old.alert}), nomad, native: !!g.native, looted: !!old.looted, nextSid: 9, str0: g.str || 0};
  return x;
}
export const headSite = x => x.sites.find(s => s.head) || x.sites[0];
export const lairInfo = (G, w, g) => headSite(gangInfo(G, w, g));   // 主據點（頭目在的那一處）
export const layerPower = s => Math.max(8, s.pool / Math.max(1, s.layers - s.taken));
function siteMove(w, g, s, h) { s.sub = pickCell(w, s.tile, g.id * 13 + s.sid, Math.floor(h), [s.sub]); s.found = null; s.moved = h; }
// 流寇整群搬走：在 NOMAD_RANGE 格內另找一處，營地全部重排（兵力照舊），找到的情報全部作廢
function nomadMove(w, g, x, h) {
  const K = w.sim.peek(), cand = []; for (const t of ring(g.lair, LAIR.NOMAD_RANGE)) if (okTile(w, K, t)) cand.push(t);
  if (!cand.length) return; const to = cand[Math.floor(roll(g.id, Math.floor(h), 48) * cand.length)], pools = x.sites.map(s => s.pool), max = x.sites.map(s => s.max);
  g.lair = to; x.sites = layoutSites(w, K, g, to, true, 0, {salt: Math.floor(h), sid0: x.nextSid}); x.nextSid += x.sites.length;
  x.sites.forEach((s, i) => { s.pool = pools[i] ?? pools[0] ?? 8; s.max = max[i] ?? s.pool; }); x.moved = h;
}
// 每小時：警戒過了（沒人來打）一半的機會搬到同一格的另一小格（原住民的村子不搬）；每天回補一點兵力；流寇每 3～5 天換一次地方
function lairTick(G, w, h, out) {
  const K = w.sim.peek();
  for (const [id, x] of Object.entries(G.lairs || {})) { if (!x.sites) continue; const g = (K.gangs || []).find(q => q.id === +id); if (!g || g.gone) continue;
    for (const s of x.sites) {
      if (s.alert != null && s.alert <= h) { s.alert = null; if (!x.native && !x.nomad && roll(+id * 11 + s.sid, Math.floor(h), 44) < NEAR.MOVE_AWAY) { const was = s.found != null; siteMove(w, g, s, h); if (was) out.moved.push({g, s}); } }
      if (h % 24 === 0 && s.pool < s.max * LAIR.REGEN_CAP) s.pool = Math.min(s.max * LAIR.REGEN_CAP, s.pool + s.max * (x.native ? LAIR.REGEN_NATIVE : LAIR.REGEN));
    }
    if (x.nomad) { const D = LAIR.NOMAD_DAYS, next = () => h + 24 * (D[0] + roll(+id, Math.floor(h), 45) * (D[1] - D[0]));
      if (x.nextMove == null) x.nextMove = next();
      if (h >= x.nextMove) { const was = x.sites.some(s => s.found != null); nomadMove(w, g, x, h); if (was) out.moved.push({g, all: true}); x.nextMove = next(); } }
  }
}
// 每段（10 分鐘）：玩家的人走到據點旁邊一小格＝找到確切位置；進了哨兵的耳目＝驚動（那一處警戒 ALERT 小時，派一群人出來追；流寇 24 小時內換地方）
function lairWatch(G, w, Es, tt, h, out, P) {
  const K = w.sim.peek(), night = isNight(tt);
  for (const g of K.gangs || []) { if (g.gone) continue;
    if (!Es.some(e => hexDistT(e.tile, g.lair) <= 2.01)) continue;
    const x = gangInfo(G, w, g);
    for (const s of x.sites) { const E = Es.filter(e => hexDistT(e.tile, s.tile) <= 1.01); if (!E.length) continue;
      E.forEach((e, j) => { const d = hexDist(e.pos, s.sub);
        if (d <= 1 && s.found == null) { s.found = +tt.toFixed(3); out.found.push({g, s, e}); if (e.team) { (e.sq.op.found ||= []).push([g.id, s.sid]); if (e.sq.op.sweep) { e.sq.op.done = true; e.sq.op.stopAt = e.pos; } } }
        const range = (e.foot ? NEAR.SENTRY.foot : NEAR.SENTRY.car) - (night ? 1 : 0);
        if (d <= range && !(s.alert > tt) && roll(g.id * 7 + j + s.sid * 101, Math.round(tt * SLICES), 43) < NEAR.SPOT) {
          s.alert = +(tt + NEAR.ALERT).toFixed(3); out.spotted.push({g, s, e}); if (x.nomad) x.nextMove = Math.min(x.nextMove ?? Infinity, tt + 24);
          if (P.length < NEAR.MAX + 2 && s.pool >= 8) { const p = make(G, w, g.native ? 'native' : 'bandit', s.tile, h, {str: 3 + Math.round(s.pool / 10), lairId: g.id, siteId: s.sid, ...(g.native ? {lair: g.lair} : {})}); p.pos = [...s.sub]; P.push(p); } } });
    }
  }
}
// 一格裡照小格走的路線：巡查整格＝經過 7 個點（每個點蓋住自己和四周 6 小格，37 小格全部掃過）；不然直接走到那一小格
// 回傳 {tile, mode, sweep, pts: [[q, r, 到那裡的時刻]…]}；路線照車的成本排（道路優先），時間照開車或徒步的分鐘數
const COVER = [[-3, 0], [-3, 3], [-1, 0], [0, -3], [0, 2], [2, -2], [2, 0]];
const opMin = (x, mode) => { const v = TERRAIN[x?.k]?.[mode]; return isFinite(v) ? v : x?.bridge ? (mode === 'foot' ? 10 : 4) : 15; };
export function opPlan(w, tile, {sweep, sub, mode}, now, from) {
  const D = od(w), cells = cellsOf(tile, D), c0 = from || center(tile, MAPW), ok = p => { const x = cells.get(key(p[0], p[1])); return !!x && isFinite(TERRAIN[x.k]?.car); };
  const nearOk = p => { if (ok(p)) return p; let b = null, bd = 1e9; for (const x of cells.values()) if (ok([x.q, x.r])) { const d = hexDist([x.q, x.r], p); if (d < bd) { bd = d; b = [x.q, x.r]; } } return b; };
  let goals = sweep ? COVER.map(d => nearOk([center(tile, MAPW)[0] + d[0], center(tile, MAPW)[1] + d[1]])).filter(Boolean) : [nearOk(sub)].filter(Boolean);
  if (sweep) { const left = goals.slice(), seq = []; let cur = c0; while (left.length) { left.sort((a, b) => hexDist(a, cur) - hexDist(b, cur)); cur = left.shift(); seq.push(cur); } goals = seq; }
  let cur = c0; const pts = [[c0[0], c0[1], now]]; let m = 0;
  for (const g of goals) { const r = subRoute(tile, cur, g, D, 1); if (!r) continue; for (const p of r.path.slice(1)) { m += opMin(cells.get(key(p[0], p[1])), mode); pts.push([p[0], p[1], +(now + m / 60).toFixed(3)]); } cur = g; }
  return {tile, mode, sweep: !!sweep, pts, done: false};
}
export function opPos(op, h) { let p = op.pts[0]; for (const x of op.pts) { if (x[2] <= h) p = x; else break; } return op.stopAt && op.done ? op.stopAt : [p[0], p[1]]; }
export const opEnd = op => op.pts[op.pts.length - 1][2];
// 給畫面：找到確切位置的據點（每一處各自一筆）
export function lairsView(G, w, h) { const K = w.sim.peek(), out = [];
  for (const [id, x0] of Object.entries(G.lairs || {})) { const g = (K.gangs || []).find(q => q.id === +id); if (!g || g.gone) continue; const x = x0.sites ? x0 : x0.found != null ? gangInfo(G, w, g) : null; if (!x) continue;   // 舊的（只有一處）找到過的：換成新的樣子
    for (const s of x.sites) if (s.found != null) out.push({id: g.id, sid: s.sid, tile: s.tile, sub: s.sub, name: siteName(g, s), native: !!g.native, nomad: !!x.nomad, head: !!s.head, kind: s.kind,
      layers: s.layers, taken: s.taken, pool: Math.round(s.pool), sites: x.sites.length, alert: s.alert > h}); }
  return out; }
const hexDistT = (a, b) => hexDist(center(a, MAPW), center(b, MAPW)) / 7;   // 戰略格的距離（中心之間 7 小格＝1 格）
// 戰鬥結果表（OPMAP.md 第六節，非玩家之間）：攻方戰力 ÷ 守方戰力分欄，擲一顆骰（0～1）。robbed＝守方被劫／打散、repelled＝攻方被擊退、engaged＝還在打
const COLS = [1 / 3, 1 / 2, 1, 2, 3, 4];
const TABLE = [   // 每一欄：骰到這個以下是 repelled，再往上到第二個數字是 engaged，再往上是 robbed
  [.6, .9], [.45, .8], [.3, .65], [.18, .45], [.1, .3], [.05, .2]];
export function crt(att, def, die, shift = 0) {
  const ratio = att / Math.max(.1, def); let c = 0; for (let i = 0; i < COLS.length; i++) if (ratio >= COLS[i] * .999) c = i;
  c = Math.max(0, Math.min(COLS.length - 1, c + shift)); const [rep, eng] = TABLE[c];
  return die < rep ? 'repelled' : die < eng ? 'engaged' : 'robbed';
}
function make(G, w, kind, tile, h, extra = {}) {
  const R = G.hq; R.nearSeq = (R.nearSeq || 0) + 1;
  // 出生在那一格裡一個走得過去、不是城的小格
  const D = od(w), cells = [...cellsOf(tile, D).values()].filter(c => isFinite(minutes(kind, c)) && c.f !== 'town'), c = cells.length ? cells[Math.floor(roll(tile, h, 15) * cells.length)] : null, pos = c ? [c.q, c.r] : center(tile, MAPW);
  const facName = kind === 'patrol' ? w.sim.peek().fac[extra.fac]?.n || '' : undefined;
  return {id: R.nearSeq, kind, tile, pos, mins: 0, born: h, ...(facName != null ? {facName} : {}), ...extra};
}
export const nearName = p => KIND[p.kind]?.n || '隊伍';
// 戰略地圖的戰爭迷霧（OPMAP.md 第 3 段）：基地和在路上的運兵車四周 RANGE 格「現在看著」；看過的格子記在公司身上（G.seen），之後一直知道地形、道路、城
function visibleNow(G, book, w, h) { const S = new Set(); for (const e of eyes(G, book, w, h)) { S.add(e.tile); for (const t of ring(e.tile, NEAR.RANGE)) S.add(t); } return S; }
export function fogMark(G, book, w, h) { if (!NEAR.on) return; const S = new Set(G.seen || []), n = S.size; for (const t of visibleNow(G, book, w, h)) S.add(t); if (S.size !== n) G.seen = [...S]; }
export function fogView(G, book, w, h) { if (!NEAR.on) return null; if (!G.seen) fogMark(G, book, w, h); return {seen: G.seen || [], vis: [...visibleNow(G, book, w, h)]}; }
// 舊的「基地開進某一格就打」：改成每小時看控制區（nearHour），這裡不再用
export function nearAt() { return null; }
// 給畫面：範圍與每一個兵牌（種類、名字、在哪一格、哪一小格、戰力、敵對、在追、在交戰）
export function nearView(G, h) {
  if (!NEAR.on || !G.hq) return null;
  return {range: NEAR.RANGE, night: h != null && isNight(h), list: (G.hq.near || []).filter(p => p.vis !== false).map(p => ({id: p.id, kind: p.kind, name: p.kind === 'patrol' ? `${p.facName || ''}巡邏隊` : nearName(p), tile: p.tile, pos: p.pos || null, str: p.str || 0, hostile: p.hostile ?? KIND[p.kind].hostile, chase: !!p.chase, hold: h != null && p.hold > h, to: p.to ?? null,
    ...(p.kind === 'caravan' ? {cargo: p.cargo || {food: 40, water: 40}} : {})}))};
}
