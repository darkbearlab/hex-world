// alpha 的搶奪點（地圖第三版，2026-10-16）：兩側的武器箱（電漿步槍、精準步槍）、中央的三倍傷害、忍者的繩索。
// - 一隊一份的分派（掛在 game 上）：每個看過的箱子、中央的三倍傷害各派一個人去（離得最近的；忍者有繩索，算快），派定了就不換，人死了再派。
//   箱子只算看過的（地圖不公開；箱子的大概位置照規則在兩側，先派人往兩側看）。三倍傷害的位置照規則在正中央，一開始就知道。
// - 去的路上：有脫離繩（免費動作）就先拉一段（落點離目標更近 3 步以上、落點沒被已知的對方射到），再照常走一步；重新部署繩（一個動作）比走一步多省 4 步以上才用。
// - 到了：相鄰就打開（一個動作），武器掉在箱子那一格，走上去撿，撿到就換上（之後 mainWeapon 也優先它）。
import {distance} from '../../../src/world.js';
import {lineReason} from '../../../src/lines.js';
import {WEAPONS} from '../../../src/data.js';

export const LT = {
  crate: process.env.ALPHA_CRATE !== '0', power: process.env.ALPHA_POW !== '0', rope: process.env.ALPHA_ROPE !== '0',
  ropeKeep: +(process.env.ALPHA_RKEEP ?? 1), redeployGain: +(process.env.ALPHA_RGAIN ?? 5), flank: process.env.ALPHA_FLANK !== '0',
  powerMax: +(process.env.ALPHA_PMAX ?? 8), crateMax: +(process.env.ALPHA_CMAX ?? 99),
};
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const LOOT = new WeakMap();
export function lootState(g, side) { let t = LOOT.get(g); if (!t) { t = {A: {assign: new Map()}, B: {assign: new Map()}}; LOOT.set(g, t); } return t[side]; }

// 從目標格（goals）往外的走路步數（只走看過的地板；看不到的格子不算）
export function distMap(g, goals, unseen = false) {
  const N = g.grid.length, D = Array.from({length: N}, () => new Array(N).fill(Infinity)), q = [];
  for (const c of goals) if (g.grid[c.y]?.[c.x] === 1) { D[c.y][c.x] = 0; q.push(c); }
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    for (const [dx, dy] of D4) {
      const b = {x: a.x + dx, y: a.y + dy};
      if (g.grid[b.y]?.[b.x] !== 1 || D[b.y][b.x] <= D[a.y][a.x] + 1 || !unseen && !g.seen[b.y]?.[b.x] || g.solid(b.x, b.y) || !g.canCross(a, b)) continue;
      D[b.y][b.x] = D[a.y][a.x] + 1; q.push(b);
    }
  }
  return D;
}
const wid = (g, slot) => g.weaponAt?.(slot)?.id ?? WEAPONS[g.player.weaponBases?.[slot]]?.id;
export const isLootGun = id => id === 'plasma' || id === 'sniper';

// 這一隊要搶的東西（還在的）：{key, goals（站上去／相鄰的格子）, kind, at}
function targets(bot) {
  const g = bot.g, out = [];
  if (LT.crate) for (const c of g.props) {
    if (c.type !== 'container' || !String(c.id).startsWith('pvp-crate')) continue;
    if (!c.opened) { if (!g.seen[c.y]?.[c.x]) continue; out.push({key: c.id, kind: 'crate', at: c, goals: D4.map(([dx, dy]) => ({x: c.x + dx, y: c.y + dy})).filter(q => g.grid[q.y]?.[q.x] === 1 && g.canCross(q, c))}); continue; }
  }
  if (LT.crate) for (const i of g.items) if (i.type === 'weapon' && isLootGun(WEAPONS[i.weapon]?.id ?? g.weaponAt?.(i.slot)?.id) && g.seen[i.y]?.[i.x]) out.push({key: 'gun' + i.slot, kind: 'gun', at: i, goals: [{x: i.x, y: i.y}]});
  // 箱子還沒看到：照規則在兩側（離雙方一樣遠、離雙方連線最遠），派人往那邊看
  if (LT.crate && LT.flank) {
    const side = bot.side(), B = g.pvpGoal?.[side], A = g.pvpGoal?.[g.other(side)];
    if (A && B) {
      const N = g.grid.length, cx = (A.x + B.x) / 2, cy = (A.y + B.y) / 2, L = Math.hypot(B.x - A.x, B.y - A.y) || 1, px = -(B.y - A.y) / L, py = (B.x - A.x) / L;
      const crates = g.props.filter(c => c.type === 'container' && String(c.id).startsWith('pvp-crate'));
      for (const sg of [1, -1]) {
        const known = crates.some(c => Math.sign((c.x - cx) * px + (c.y - cy) * py) === sg && (c.opened || g.seen[c.y]?.[c.x]));
        if (known) continue;
        let k = 0; while (true) { const x = Math.round(cx + sg * px * (k + 1)), y = Math.round(cy + sg * py * (k + 1)); if (x < 2 || y < 2 || x > N - 3 || y > N - 3) break; k++; }
        const P = {x: Math.round(cx + sg * px * k * .8), y: Math.round(cy + sg * py * k * .8)};
        const goals = []; for (let y = P.y - 3; y <= P.y + 3; y++) for (let x = P.x - 3; x <= P.x + 3; x++) if (g.grid[y]?.[x] === 1 && distance({x, y}, P) <= 3) goals.push({x, y});
        if (goals.length) out.push({key: 'flank' + sg, kind: 'flank', at: P, goals, unseen: true});
      }
    }
  }
  if (LT.power) for (const i of g.items) if (i.type === 'pvp_power') out.push({key: 'power', kind: 'power', at: i, goals: [{x: i.x, y: i.y}]});
  return out;
}

// 派人：每個目標一個人（目前離它最近、還沒被派的；忍者的繩索算快）；派定不換
function assign(bot, list) {
  const g = bot.g, side = bot.side(), S = lootState(g, side), team = g.alive(side);
  const live = new Set(list.map(t => t.key));
  for (const [k, id] of S.assign) { const u = g.unit(id); if (!live.has(k) || !u || u.hp <= 0) S.assign.delete(k); }
  // 箱子打開後，開箱的人接著去撿那把槍
  for (const t of list) if (t.kind === 'gun' && !S.assign.has(t.key)) { const opener = S.opened?.get(`${t.at.x},${t.at.y}`); if (opener && g.unit(opener)?.hp > 0) S.assign.set(t.key, opener); }
  const busy = new Set(S.assign.values());
  for (const t of list) {
    if (S.assign.has(t.key)) continue;
    const D = distMap(g, t.goals, t.unseen); let best = null;
    for (const u of team) {
      if (busy.has(u.squadId)) continue;
      if (t.kind === 'gun' && (u.owned?.length || 0) >= (g.weaponCapacity || 3)) continue;
      let d = D[u.y]?.[u.x]; if (!Number.isFinite(d)) d = distance(u, t.at) * 1.6 + 6;
      const speed = (u.escapeLines || 0) + (u.redeployLines || 0) > 2 ? .4 : 1;
      const c = d * speed;
      if (c > (t.kind === 'power' ? LT.powerMax : LT.crateMax)) continue;
      if (!best || c < best.c) best = {c, u};
    }
    if (best) { S.assign.set(t.key, best.u.squadId); busy.add(best.u.squadId); }
  }
}

// 這個人這一步要不要去搶：回傳意圖或 null。threatened(q)：q 這一格會不會被已知的對方打到
export function lootIntent(bot, view, {threatened = () => false} = {}) {
  const g = bot.g, me = g.player, side = bot.side(), S = lootState(g, side);
  const list = targets(bot); assign(bot, list);
  // 撿到的電漿／精準步槍：換上
  const mine = list.filter(t => S.assign.get(t.key) === me.squadId);
  const held = wid(g, me.weapon);
  if (!isLootGun(held)) { const slot = (me.owned || []).find(s => isLootGun(wid(g, s))); if (slot !== undefined && !bot.isRefused({type: 'weapon', arg: slot})) return {type: 'weapon', arg: slot, why: 'alpha loot gun'}; }
  if (!mine.length) return null;
  // 最近的一個
  let best = null;
  for (const t of mine) { const D = distMap(g, t.goals, t.unseen), d = D[me.y]?.[me.x]; if (!best || d < best.d) best = {t, D, d}; }
  const {t, D} = best;
  if (t.kind === 'crate' && distance(me, t.at) === 1 && g.canCross(me, t.at)) {
    const it = {type: 'openContainer', arg: t.at.id, why: 'alpha open crate'};
    if (!bot.isRefused(it)) { (S.opened ||= new Map()).set(`${t.at.x},${t.at.y}`, me.squadId); return it; }
  }
  if (!Number.isFinite(best.d)) return null;   // 還走不到（路沒看過）：照常走，邊走邊看
  // 繩索
  if (LT.rope) {
    const r = ropeToward(bot, view, D, threatened);
    if (r) return r;
  }
  // 走一步：照距離圖往下
  let step = null;
  for (const [dx, dy] of D4) {
    const q = {x: me.x + dx, y: me.y + dy}, d = D[q.y]?.[q.x];
    if (!Number.isFinite(d) || d >= D[me.y][me.x] || !g.passable(q.x, q.y) || !g.canCross(me, q)) continue;
    if (g.enemies.some(e => e.hp > 0 && e.x === q.x && e.y === q.y) || g.alive(side).some(u => u !== me && u.x === q.x && u.y === q.y)) continue;
    const s = d + (threatened(q) ? 3 : 0) + bot.rng() * .1;
    if (!step || s < step.s) step = {s, arg: [dx, dy]};
  }
  if (step) { const it = {type: 'move', arg: step.arg, walk: true, why: `alpha loot ${t.key}`}; if (!bot.isRefused(it)) return it; }
  return null;
}

// 拉繩：脫離繩免費（之後還能動一次）；重新部署繩要一個動作（比走一步多省 redeployGain 步才用）
export function ropeToward(bot, view, D, threatened = () => false) {
  const g = bot.g, me = g.player, here = D[me.y]?.[me.x];
  for (const [item, res, gain] of [['escape_line', 'escapeLines', 3], ['redeploy_line', 'redeployLines', LT.redeployGain]]) {
    if (!((me[res] || 0) > LT.ropeKeep)) continue;
    let best = null;
    for (let y = me.y - 6; y <= me.y + 6; y++) for (let x = me.x - 6; x <= me.x + 6; x++) {
      const d = D[y]?.[x]; if (!Number.isFinite(d) || here - d < gain) continue;
      const q = {x, y}; if (distance(q, me) > 6 || threatened(q)) continue;
      if (lineReason(g, {x, y, item})) continue;
      const s = d - bot.rng() * .1;
      if (!best || s < best.s) best = {s, q};
    }
    if (best) { const it = {type: 'rope', arg: {x: best.q.x, y: best.q.y, item}, why: `alpha ${item} → ${best.q.x},${best.q.y}`}; if (!bot.isRefused(it)) return it; }
  }
  return null;
}
