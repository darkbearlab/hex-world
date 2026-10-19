// 近的一層（Alan 2026-10-18，DESIGN.md「縮小規模」第 3 步；2026-10-19 升級到作戰地圖的小格，warband/OPMAP.md 第 2 段）：
// 沙盒是遠的那層（數字：匪患、原住民地盤、城），基地附近的數字變成作戰地圖上看得到、會動的兵牌——掠奪者、原住民、商隊。
// - 只在看得到的範圍生出來（基地四周 RANGE 格），走遠了就消失（不追蹤去哪）。
// - 一小格一小格走：每小時 60 分鐘的預算，照小格地形（opmap.js 的 TERRAIN）× 兵牌自己的倍率。等速追不上；騎車的掠奪者比基地快。
// - 控制區：敵對的兵牌走到基地旁邊一小格（或基地開到牠旁邊）＝接觸，開遭遇的服務單（親自打／自動戰鬥／撤退）。
// - 非玩家之間（掠奪者碰到商隊）：擲戰鬥結果表（CRT），結果寫回沙盒（被劫：目的地的城少一點貨、那一帶匪患升；擊退：匪患降），交戰時雙方卡在原地。
// 只在單機開（NEAR.on，server/worker.js 的 soloInit）；線上的共用星球照舊擲骰。
import {NBR, W as MAPW} from './sim.js';
import {TERRAIN, DIRS, center, key, hexDist, cellsOf, dataFromSim, legRoute, alongRoute} from './opmap.js';

export const NEAR = {
  on: false,
  RANGE: 4,          // 看得到幾格戰略格
  MAX: 8,            // 同時最多幾個兵牌
  LIFE: 96,          // 一個兵牌最多留幾小時
  CHASE: 3,          // 敵對兵牌離基地幾格戰略格以內就追過來
  BANDIT: 2.5e-5,    // 掠奪者：每格每小時出現的機率 ＝ 匪患 × BANDIT
  NATIVE: 4e-4,      // 原住民：地盤（巢穴 3 格內）每格每小時
  CARAVAN: .02,      // 商隊：範圍內每座城每小時
  // 移動：地形的分鐘數用車還是徒步，再乘這個倍率（OPMAP.md：掠奪者騎車快、商隊慢、基地 ×1.3）
  MOVE: {bandit: ['car', .8], native: ['foot', 1], caravan: ['car', 1.5]},
};
const KIND = {bandit: {n: '掠奪者', hostile: true}, native: {n: '原住民', hostile: true}, caravan: {n: '商隊', hostile: false}};
const roll = (t, h, salt) => (((t * 2654435761) ^ (h * 40503) ^ (salt * 2246822519)) >>> 0) % 100000 / 100000;
const ring = (c, r) => { const out = [], seen = new Set([c]); let edge = [c]; for (let d = 0; d < r; d++) { const nx = []; for (const t of edge) for (const n of NBR[t]) if (!seen.has(n)) { seen.add(n); nx.push(n); out.push(n); } edge = nx; } return out; };
const town = (K, t) => !!K.markets[t] && K.owner[t] >= 0;

// 作戰地圖的資料（每季換一次）與小格（照需要展開、快取）
let OD = null, ODkey = '', CELLS = new Map();
function od(w) { const K = w.sim.peek(), k = K.curY + ':' + (w.sim.season || 0) + ':' + (K.routes?.length || 0); if (k !== ODkey) { ODkey = k; OD = dataFromSim(w, K, MAPW, t => NBR[t]); CELLS = new Map(); } return OD; }
function cellAt(w, t, q, r) { const D = od(w); let m = CELLS.get(t); if (!m) { if (CELLS.size > 400) CELLS.clear(); m = cellsOf(t, D); CELLS.set(t, m); } return m.get(key(q, r)); }
// 小格屬於哪個戰略格：先看原本那格，再看鄰格（六角群半徑 3）
function tileOf(t, pos) { if (hexDist(center(t, MAPW), pos) <= 3) return t; for (const n of NBR[t]) if (hexDist(center(n, MAPW), pos) <= 3) return n; for (const n of NBR[t]) for (const m of NBR[n]) if (hexDist(center(m, MAPW), pos) <= 3) return m; return t; }
function cellOf(w, t, pos) { const u = tileOf(t, pos); return {t: u, c: cellAt(w, u, pos[0], pos[1])}; }
const minutes = (kind, c) => { if (!c) return Infinity; const [m, x] = NEAR.MOVE[kind]; const v = TERRAIN[c.k]?.[m]; return isFinite(v) ? v * x : c.bridge ? 4 * x : Infinity; };

// 基地在作戰地圖上的位置（小格）：開動中照小格路線內插（跟畫面同一套），停著就是那一格的中心
const legCache = new Map();
export function basePos(G, w, h) {
  const R = G.hq; if (!R?.move) return center(G.base, MAPW);
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

// 每個遊戲小時（rover.js 的 hqHour，每家玩家公司）：生出、移動、非玩家之間的交戰、接觸。回傳接觸到基地的敵對兵牌（交給 defend 開遭遇的單），沒有就 null
export function nearHour(G, w, h, canFight, say) {
  if (!NEAR.on) return null;
  const R = G.hq; if (!R) return null;
  const K = w.sim.peek(), base = G.base, P = R.near ||= [], bpos = basePos(G, w, h), safe = town(K, base) && !R.move;
  for (const p of P) if (!p.pos) { p.pos = center(p.tile, MAPW); p.mins = 0; }   // 舊的兵牌（升級前只有戰略格）：放到那一格的中心
  // 走遠了、待太久的就消失
  for (let i = P.length - 1; i >= 0; i--) if (hexDistT(P[i].tile, base) > NEAR.RANGE + 1 || h - P[i].born > NEAR.LIFE) P.splice(i, 1);
  // 生出
  if (P.length < NEAR.MAX) for (const t of ring(base, NEAR.RANGE)) {
    if (P.length >= NEAR.MAX || !w.land[t] || P.some(p => p.tile === t)) continue;
    if (town(K, t)) { if (roll(t, h, 11) < NEAR.CARAVAN) { const to = Object.keys(K.markets).map(Number).filter(u => u !== t && town(K, u) && hexDistT(u, t) <= 10).sort((a, b) => hexDistT(a, t) - hexDistT(b, t))[Math.floor(roll(t, h, 12) * 3)]; if (to != null) P.push(make(G, w, 'caravan', t, h, {to, str: 3})); } continue; }
    const native = (K.gangs || []).some(g => !g.gone && g.native && hexDistT(g.lair, t) <= 3);
    if (native && roll(t, h, 13) < NEAR.NATIVE) { P.push(make(G, w, 'native', t, h, {str: 5})); continue; }
    if (roll(t, h, 14) < (K.bandit[t] || 0) * NEAR.BANDIT) P.push(make(G, w, 'bandit', t, h, {str: 3 + Math.round((K.bandit[t] || 0) / 20)}));
  }
  // 移動：每小時 60 分鐘的預算（沒走完的留到下一小時）
  for (const p of P) {
    if (p.hold > h) continue;
    p.mins = Math.min(120, (p.mins || 0) + 60);
    for (let guard = 0; guard < 20; guard++) {
      let goal;
      if (p.kind === 'caravan') goal = center(p.to, MAPW);
      else if (!safe && hexDistT(p.tile, base) <= NEAR.CHASE) { goal = bpos; p.chase = true; }
      else { p.chase = false; if (!p.wander || hexDist(p.pos, p.wander) <= 1) { const c0 = center(p.tile, MAPW), d = DIRS[Math.floor(roll(p.id, h + guard, 7) * 6)]; p.wander = [c0[0] + d[0] * 3, c0[1] + d[1] * 3]; } goal = p.wander; }
      if (hexDist(p.pos, goal) <= (p.kind === 'caravan' ? 0 : 1)) break;
      const s = stepToward(w, p, goal); if (!s || s.m > p.mins) break;
      p.mins -= s.m; p.pos = s.pos; p.tile = s.t;
    }
  }
  // 商隊到了就消失
  for (let i = P.length - 1; i >= 0; i--) if (P[i].kind === 'caravan' && hexDist(P[i].pos, center(P[i].to, MAPW)) <= 0) P.splice(i, 1);
  // 非玩家之間：掠奪者碰到商隊（相鄰一小格）擲戰鬥結果表
  for (const a of P.filter(p => p.kind === 'bandit' && !(p.hold > h))) {
    const v = P.find(p => p.kind === 'caravan' && !(p.hold > h) && hexDist(p.pos, a.pos) <= 1); if (!v) continue;
    const r = crt(a.str, v.str, roll(a.id * 31 + v.id, h, 21), v.pos && cellOf(w, v.tile, v.pos).c?.road ? 0 : 0), nm = w.names[v.tile] || '荒野';
    const hold = h + 1 + Math.floor(roll(a.id, h, 22) * 3); a.hold = hold; v.hold = hold;
    if (r === 'robbed') { const m = K.markets[v.to]; if (m) { const g = ['food', 'water', 'fuel', 'parts'][Math.floor(roll(v.id, h, 23) * 4)]; m.stock[g] = Math.max(0, m.stock[g] * .995); } K.bandit[v.tile] = Math.min(100, (K.bandit[v.tile] || 0) + 1); a.str += 1; P.splice(P.indexOf(v), 1); say?.(h, v.tile, `附近：${nm}一帶，一群掠奪者攔下往${w.names[v.to] || '別座城'}的商隊，搶走了貨。`); }
    else if (r === 'repelled') { K.bandit[a.tile] = Math.max(0, (K.bandit[a.tile] || 0) - 1); a.str = Math.max(1, a.str - 1); a.wander = null; for (let i = 0; i < 2; i++) { const s = stepToward(w, a, [a.pos[0] * 2 - v.pos[0], a.pos[1] * 2 - v.pos[1]]); if (s) { a.pos = s.pos; a.tile = s.t; } } say?.(h, v.tile, `附近：${nm}一帶，往${w.names[v.to] || '別座城'}的商隊打退了一群掠奪者。`); }
    else say?.(h, v.tile, `附近：${nm}一帶，掠奪者和商隊交上火了。`);
  }
  // 接觸：敵對兵牌在基地旁邊一小格（控制區）
  if (safe || !canFight) return null;
  const i = P.findIndex(p => KIND[p.kind].hostile && !(p.hold > h) && hexDist(p.pos, bpos) <= 1);
  return i < 0 ? null : P.splice(i, 1)[0];
}
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
  return {id: R.nearSeq, kind, tile, pos, mins: 0, born: h, ...extra};
}
export const nearName = p => KIND[p.kind]?.n || '隊伍';
// 舊的「基地開進某一格就打」：改成每小時看控制區（nearHour），這裡不再用
export function nearAt() { return null; }
// 給畫面：範圍與每一個兵牌（種類、名字、在哪一格、哪一小格、戰力、敵對、在追、在交戰）
export function nearView(G, h) {
  if (!NEAR.on || !G.hq) return null;
  return {range: NEAR.RANGE, list: (G.hq.near || []).map(p => ({id: p.id, kind: p.kind, name: nearName(p), tile: p.tile, pos: p.pos || null, str: p.str || 0, hostile: KIND[p.kind].hostile, chase: !!p.chase, hold: h != null && p.hold > h, to: p.to ?? null}))};
}
