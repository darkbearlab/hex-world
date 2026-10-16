// beta 的黑暗狙擊（職業加強：偵察兵開場多一把消焰精準步槍）。消焰槍站在全黑的格子開火不暴露；偵察兵有夜視和紅外線，
// 沒有夜視／紅外線的人（機械除外）看不到站在全黑格子裡的人。所以：
//   - 狙擊點：全黑（lighting.js 的 isBlack）、10 格內看得到整隊記得的敵人（優先重裝兵）、走得到、看得到我的敵人少。
//   - 打燈造出狙擊點：燈一熄就變全黑的格子也算候選，先把燈打掉（站在黑暗裡打燈也不暴露）。
//   - 到了先待機瞄準（精準步槍沒瞄準 −40），瞄準了再開火；開完火還在黑暗裡，下一個階段再瞄準。
// 只用規則公開的東西：地圖、燈、光（畫面上看得到的明暗）、整隊的記憶。
import {isBlack} from '../../../src/lighting.js';
import {weaponStats} from '../../../src/weapons.js';
import {WEAPONS} from '../../../src/data.js';
import {activeTrait} from '../../../src/traits.js';
import {stepField} from './beta-objective.mjs';
import {dist, key} from '../../clear-bot/util.mjs';
import {lineOpen} from '../../clear-bot/tactics.mjs';

export const SNIPE_TUNING = {steps: +(globalThis.process?.env?.BETA_NEST_STEPS || 14), memory: 6, range: 10, nestStay: 18, aim: 18, unaimed: 10, quietFire: 10, bulwark: 10, leave: 12, lampSteps: 4};
const unitOf = (g, id) => String(id).startsWith('px-') ? g.unit(String(id).slice(3)) : null;
// 這個人身上的消焰槍（noFlash）：槽位
export function quietSlot(u) {
  for (const s of u.owned || []) { const b = u.weaponBases?.[s]; if (!WEAPONS[b]) continue; const w = weaponStats(b, u.affixes?.[s], u); if (w.noFlash && !w.melee) return s; }
  return null;
}
// 對方看得到黑暗裡的人嗎：夜視、紅外線、機械（無人機、砲台）
export function seesBlack(g, r) {
  const u = unitOf(g, r.id); if (!u) return true;   // 無人機、砲台：機械找得到溫熱的東西
  return !!(activeTrait(u, 'night_vision') || activeTrait(u, 'infrared'));
}
// 燈一熄就全黑的格子：每個階段算一次（暫時把燈的 hp 設成 0 再算光，算完還原；光的快取看燈的數量，會自己重算）
const darkCache = new WeakMap();
export function lampDark(g) {
  let c = darkCache.get(g); if (c && c.turn === g.turn) return c.map;
  const map = new Map();
  for (const l of g.lamps || []) {
    if (l.hp <= 0) continue;
    const cells = [];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const q = {x: l.x + dx, y: l.y + dy}; if (g.grid[q.y]?.[q.x] === 1 && !isBlack(g, q) && g.lighting?.[q.y]?.[q.x] === 0) cells.push(q); }
    if (!cells.length) continue;
    const hp = l.hp; l.hp = 0;
    try { for (const q of cells) if (isBlack(g, q)) { const k = key(q); if (!map.has(k)) map.set(k, l); } } finally { l.hp = hp; }
  }
  isBlack(g, {x: 0, y: 0});   // 還原後先把快取算回來
  darkCache.set(g, {turn: g.turn, map});
  return map;
}
// 找狙擊點：route 展開的格子（走 steps 步以內），全黑或燈一熄就全黑；看得到的目標越值錢越好
// watch：還沒碰到人（埋伏）時，看對方走過來的路（approachTiles）
export function findNest(g, view, team, watch = null) {
  const me = view.me, p = me.ref, slot = quietSlot(p); if (slot == null) return null;
  let known = [...team.memory.values()].filter(r => !r.ally && g.turn - r.turn <= SNIPE_TUNING.memory);
  if (!known.length && watch) known = watch;
  if (!known.length) return null;
  const value = r => r.watch ? r.watch : (r.cls === 'bulwark' ? 1.6 : r.cls === 'engineer' ? 1.2 : 1) * (r.seen ? 1 : .6) * (r.hp < 40 ? 1.3 : 1);
  const lampMap = lampDark(g);
  const from = t => ({x: t.x, y: t.y, traits: p.traits});
  const score = (t, steps) => {
    let v = 0, seenBy = 0, tgt = null;
    for (const r of known) {
      const d = dist(t, r);
      if (d <= SNIPE_TUNING.range && d >= 2 && lineOpen(g, from(t), r)) { const s = value(r) * (d >= 4 ? 1 : .6); v += s; if (!tgt || s > tgt.s) tgt = {s, r}; }
      if (!r.watch && seesBlack(g, r) && d <= (r.range || 5) + 1 && lineOpen(g, r, t)) seenBy++;
      if (r.melee && d <= 3) v -= 1.5;
    }
    if (!v) return null;
    return {v: v * 10 - steps * 1.5 - seenBy * 6, tgt: tgt.r};
  };
  let best = null;
  const consider = (q, steps, lamp) => {
    const s = score(q, steps + (lamp ? 2 : 0)); if (!s) return;
    if (!best || s.v > best.v) best = {x: q.x, y: q.y, steps, lamp: lamp || null, v: s.v, target: s.tgt};
  };
  // 走得到的步數（只看地形）：狙擊點可以在交火的地方走好幾步以外——前面的人先頂著
  const D = stepField(g, me), N = g.grid.length, mates = new Set(team.members.filter(m => m !== p).map(key));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const steps = D[y]?.[x]; if (!(steps <= SNIPE_TUNING.steps) || g.grid[y][x] !== 1) continue;
    const q = {x, y}, k = key(q); if (steps > 0 && (view.occupied.has(k) || mates.has(k))) continue;
    if (isBlack(g, q)) consider(q, steps, null);
    else { const l = lampMap.get(k); if (l) consider(q, steps, l); }
  }
  if (best && best.v > 0) return best;
  // 分數不夠但腳下就是全黑、看得到目標：就地當狙擊點
  if (best && best.steps === 0 && !best.lamp) return best;
  return null;
}
// 打得到這盞燈嗎（射程、看得到、彈匣）
export function lampShootable(g, me, lamp) {
  const w = me.held; if (!w || w.melee || w.ammo < (w.shotCost || 1)) return false;
  return lamp.hp > 0 && dist(lamp, me) <= Math.min(w.range, 9) && g.teamVisible(lamp) && g.shotClear(me.ref, lamp);
}
// 對方從開場走到我們開場的路（最短路再多 6 步以內的格子），離我們開場 6～16 步的那一段，每 2 步取一層
const approaches = new WeakMap();
export function approachTiles(g, side) {
  let all = approaches.get(g); if (!all) { all = {}; approaches.set(g, all); }
  if (all[side]) return all[side];
  const home = g.pvpGoal?.[g.other(side)], foe = g.pvpGoal?.[side]; if (!home || !foe) return (all[side] = []);
  const Dh = stepField(g, home), De = stepField(g, foe), short = Dh[foe.y]?.[foe.x], out = [];
  if (!Number.isFinite(short)) return (all[side] = []);
  for (let y = 0; y < g.grid.length; y++) for (let x = 0; x < g.grid.length; x++) {
    const a = Dh[y][x], b = De[y][x]; if (!Number.isFinite(a) || !Number.isFinite(b) || a + b > short + 6 || a < 5 || a > 16 || a % 2) continue;
    out.push({x, y, watch: .25, id: `w${x},${y}`});
  }
  return (all[side] = out);
}
