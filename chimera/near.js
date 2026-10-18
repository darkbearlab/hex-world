// 近的一層（Alan 2026-10-18，DESIGN.md「縮小規模」第 3 步，輕的版本）：沙盒是遠的那層（數字：匪患、原住民地盤、城），
// 基地附近幾格把數字變成地圖上看得到、會動的隊伍——掠奪者、原住民、商隊。只在看得到的範圍生出來，走遠了就消失（不追蹤去哪）。
// 敵對的隊伍追上基地＝遭遇（照原本的服務單，rover.js 的 defend）；基地開到牠們那一格也一樣。取代原本「每到一格擲一次骰」。
// 只在單機開（NEAR.on，server/worker.js 的 soloInit）；線上的共用星球照舊擲骰。
import {NBR, hdist} from './sim.js';

export const NEAR = {
  on: false,
  RANGE: 4,          // 看得到幾格（之後雷達升級再加）
  MAX: 8,            // 同時最多幾隊
  LIFE: 72,          // 一隊最多留幾小時（還在範圍內也會走掉）
  CHASE: 3,          // 敵對隊伍離基地幾格以內就追過來
  BANDIT: 2.5e-5,    // 掠奪者：每格每小時出現的機率 ＝ 匪患 × BANDIT
  NATIVE: 4e-4,      // 原住民：地盤（巢穴 3 格內）每格每小時
  CARAVAN: .02,      // 商隊：範圍內每座城每小時
  STEP: {bandit: 3, native: 4, caravan: 5},   // 走一格要幾小時
};
const KIND = {bandit: {n: '掠奪者', hostile: true}, native: {n: '原住民', hostile: true}, caravan: {n: '商隊', hostile: false}};
// 跟 rover.js 的 roll 一樣：照格子、時間、鹽算的雜湊（重播一致，不動到帳本的亂數）
const roll = (t, h, salt) => (((t * 2654435761) ^ (h * 40503) ^ (salt * 2246822519)) >>> 0) % 100000 / 100000;
const ring = (c, r) => { const out = [], seen = new Set([c]); let edge = [c]; for (let d = 0; d < r; d++) { const nx = []; for (const t of edge) for (const n of NBR[t]) if (!seen.has(n)) { seen.add(n); nx.push(n); out.push(n); } edge = nx; } return out; };
const town = (K, t) => !!K.markets[t] && K.owner[t] >= 0;

// 往 goal 走一格（只走陸地；挑離 goal 最近的鄰格，平手照雜湊）
function step(w, from, goal, h, salt) {
  let best = from, bd = hdist(from, goal), br = 2;
  for (const n of NBR[from]) { if (!w.land[n]) continue; const d = hdist(n, goal), r = roll(n, h, salt); if (d < bd || (d === bd && n !== from && r < br)) { best = n; bd = d; br = r; } }
  return best;
}
function wander(w, from, h, salt) { const L = NBR[from].filter(n => w.land[n]); return L.length ? L[Math.floor(roll(from, h, salt) * L.length) % L.length] : from; }

// 每個遊戲小時（rover.js 的 hqHour，每家玩家公司）：生出、移動、追上。回傳追上基地的敵對隊伍（交給 defend 開服務單），沒有就 null
export function nearHour(G, w, h, canFight) {
  if (!NEAR.on) return null;
  const R = G.hq; if (!R) return null;
  const K = w.sim.peek(), base = G.base, P = R.near ||= [];
  // 走遠了、待太久的就消失
  for (let i = P.length - 1; i >= 0; i--) if (hdist(P[i].tile, base) > NEAR.RANGE + 1 || h - P[i].born > NEAR.LIFE) P.splice(i, 1);
  // 生出：範圍內的每一格照那一格的數字擲
  if (P.length < NEAR.MAX) {
    const tiles = ring(base, NEAR.RANGE);
    for (const t of tiles) {
      if (P.length >= NEAR.MAX || !w.land[t] || P.some(p => p.tile === t)) continue;
      if (town(K, t)) { if (roll(t, h, 11) < NEAR.CARAVAN) { const to = Object.keys(K.markets).map(Number).filter(u => u !== t && town(K, u) && hdist(u, t) <= 10).sort((a, b) => hdist(a, t) - hdist(b, t))[Math.floor(roll(t, h, 12) * 3)]; if (to != null) P.push(make(G, 'caravan', t, h, {to})); } continue; }
      const native = (K.gangs || []).some(g => !g.gone && g.native && hdist(g.lair, t) <= 3);
      if (native && roll(t, h, 13) < NEAR.NATIVE) { P.push(make(G, 'native', t, h)); continue; }
      if (roll(t, h, 14) < (K.bandit[t] || 0) * NEAR.BANDIT) P.push(make(G, 'bandit', t, h));
    }
  }
  // 移動：敵對的在追擊距離內就往基地走（基地在城裡就不追，在城外遊蕩）；商隊往目的地走，到了就消失
  let caught = null;
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]; if (h < p.next) continue;
    p.next = h + NEAR.STEP[p.kind];
    const safe = town(K, base);
    if (p.kind === 'caravan') { p.tile = step(w, p.tile, p.to, h, i + 1); if (p.tile === p.to) { P.splice(i, 1); continue; } }
    else if (!safe && hdist(p.tile, base) <= NEAR.CHASE) { p.tile = step(w, p.tile, base, h, i + 1); p.chase = true; }
    else { p.tile = wander(w, p.tile, h, i + 7); p.chase = false; }
    if (KIND[p.kind].hostile && p.tile === base && !safe && canFight && !caught) { caught = p; P.splice(i, 1); }
  }
  return caught;
}
// 基地開進某一格：那一格上有敵對隊伍就打起來
export function nearAt(G, w, tile) {
  if (!NEAR.on || !G.hq?.near) return null;
  const K = w.sim.peek(); if (town(K, tile)) return null;
  const i = G.hq.near.findIndex(p => KIND[p.kind].hostile && p.tile === tile); if (i < 0) return null;
  return G.hq.near.splice(i, 1)[0];
}
function make(G, kind, tile, h, extra = {}) { const R = G.hq; R.nearSeq = (R.nearSeq || 0) + 1; return {id: R.nearSeq, kind, tile, born: h, next: h + NEAR.STEP[kind], ...extra}; }
export const nearName = p => KIND[p.kind]?.n || '隊伍';
// 給畫面：範圍與每一隊（種類、名字、在哪、敵對、在追）
export function nearView(G) {
  if (!NEAR.on || !G.hq) return null;
  return {range: NEAR.RANGE, list: (G.hq.near || []).map(p => ({id: p.id, kind: p.kind, name: nearName(p), tile: p.tile, hostile: KIND[p.kind].hostile, chase: !!p.chase, to: p.to ?? null}))};
}
