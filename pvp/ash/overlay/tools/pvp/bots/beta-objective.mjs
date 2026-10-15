// beta 的搶奪點（pvp/DESIGN.md「地圖上的搶奪點」）：兩側的高階武器箱、中央的三倍傷害。整隊分工：誰去拿哪一個，其他人照原本的團隊計畫。
// 只用規則公開的東西：箱子和三倍傷害的位置畫在地圖上；箱子開了沒要有人看得到（近到 6 格內）才知道；拿著三倍傷害的人全場都看得到（標記）。
import {dist, key} from '../../clear-bot/util.mjs';
import {WEAPONS} from '../../../src/data.js';
import {lineReason, LINE_TUNING} from '../../../src/lines.js';

export const OBJ_TUNING = {crateReach: +(globalThis.process?.env?.BETA_CR || 22), crates: +(globalThis.process?.env?.BETA_NC ?? 2), powerReach: +(globalThis.process?.env?.BETA_PR || 10),
  crateTurns: 40, powerTurns: 20, ninjaBonus: 4, ropeGain: 3};
const OFF = new Set((globalThis.process?.env?.BETA_OFF || '').split(','));
const state = new WeakMap();
const unitOf = (g, id) => String(id).startsWith('px-') ? g.unit(String(id).slice(3)) : null;
// 從一格走到每一格的步數（只看地形：牆、坑；箱子那一格不能站）
const fields = new WeakMap();
export function stepField(g, from) {
  let byFrom = fields.get(g); if (!byFrom) { byFrom = new Map(); fields.set(g, byFrom); }
  const k = key(from); if (byFrom.has(k)) return byFrom.get(k);
  const N = g.grid.length, D = Array.from({length: N}, () => new Array(N).fill(Infinity)), q = [[from.x, from.y]]; D[from.y][from.x] = 0;
  const solid = new Set(g.props.filter(o => o.type === 'container' || o.type === 'cover').map(key));
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (g.grid[ny]?.[nx] !== 1 || D[ny][nx] !== Infinity || solid.has(`${nx},${ny}`)) continue; D[ny][nx] = D[y][x] + 1; q.push([nx, ny]); }
  }
  byFrom.set(k, D); return D;
}
export const isLoot = w => w === 'plasma' || w === 'sniper';
export const hasLoot = m => m.owned.some(s => isLoot(WEAPONS[m.weaponBases[s]]?.id));
// 誰適合去拿：拿槍的職業（狂戰士靠斧頭、重裝兵靠下錨的輕機槍），還有空位（最多三把）
const crateFit = m => m.owned.length < (m.weaponCapacity || 3) && !hasLoot(m) && !['bulwark', 'berserker'].includes(m.character);

function sideState(g, side) {
  let all = state.get(g); if (!all) { all = {A: {assign: new Map(), opened: new Set(), done: new Set()}, B: {assign: new Map(), opened: new Set(), done: new Set()}}; state.set(g, all); }
  return all[side];
}
// 每次決策更新：箱子的狀態（有人在 6 格內就看得到開了沒）、地上的好槍、三倍傷害還在不在；然後分工
export function objectives(g, plan) {
  const side = g.pvp.side, S = sideState(g, side), members = plan.members;
  const crates = g.props.filter(o => o.type === 'container' && String(o.id).startsWith('pvp-crate'));
  for (const c of crates) if (c.opened && members.some(m => dist(m, c) <= 6)) S.opened.add(c.id);
  // 地上的好槍（箱子打開後掉在旁邊；看得到才算）
  const ground = (g.items || []).filter(i => i.type === 'weapon' && isLoot(WEAPONS[i.weapon]?.id) && members.some(m => dist(m, i) <= 6));
  const power = (g.items || []).find(i => i.type === 'pvp_power');
  const powerHeld = [...members, ...g.alive(g.other(side))].some(m => m.pvpPower);   // 拿著的人頭上有標記
  const targets = [];
  if (!OFF.has('crate')) {
    for (const i of ground) targets.push({kind: 'weapon', id: `w${i.slot}`, x: i.x, y: i.y, adj: false, reach: OBJ_TUNING.crateReach, turns: OBJ_TUNING.crateTurns, fit: crateFit});
    for (const c of crates) if (!S.opened.has(c.id) && !c.opened || c.opened && !S.opened.has(c.id)) targets.push({kind: 'crate', id: c.id, x: c.x, y: c.y, adj: true, reach: OBJ_TUNING.crateReach, turns: OBJ_TUNING.crateTurns, fit: crateFit, weapon: WEAPONS[c.contents?.[0]?.weapon]?.id});
  }
  if (!OFF.has('power') && power && !powerHeld) targets.push({kind: 'power', id: 'power', x: power.x, y: power.y, adj: false, reach: OBJ_TUNING.powerReach, turns: OBJ_TUNING.powerTurns, fit: m => !m.pvpPower});
  const live = new Set(targets.map(t => t.id));
  // 舊的分工：人死了、東西沒了、太久沒拿到 → 取消
  for (const [m, a] of S.assign) {
    if (m.hp <= 0 || !live.has(a.id) || g.turn - a.since > a.turns || S.done.has(a.id)) { S.assign.delete(m); continue; }
    const t = targets.find(t => t.id === a.id); Object.assign(a, {x: t.x, y: t.y});
  }
  // 箱子打開了（我們開的或看到開了）：分給那個人的工作換成「撿地上的槍」（同一個人）
  for (const [m, a] of S.assign) if (a.kind === 'crate' && S.opened.has(a.id)) S.assign.delete(m);
  const busy = new Set([...S.assign.values()].map(a => a.id)), taken = new Set(S.assign.keys());
  let crateRuns = [...S.assign.values()].filter(a => a.kind !== 'power').length;
  // 新的分工：最近的合適人選（忍者有繩索，算近一點）
  for (const t of targets.sort((a, b) => (a.kind === 'weapon' ? 0 : 1) - (b.kind === 'weapon' ? 0 : 1))) {
    if (busy.has(t.id)) continue;
    if (t.kind !== 'power' && t.kind !== 'weapon' && crateRuns >= OBJ_TUNING.crates) continue;
    const D = stepField(g, t);
    let best = null;
    for (const m of members) {
      if (taken.has(m) || !t.fit(m)) continue;
      const d = D[m.y]?.[m.x];
      if (!Number.isFinite(d)) continue;
      const cost = d - (m.character === 'ninja' && m.escapeLines > 0 ? OBJ_TUNING.ninjaBonus : 0);
      if (cost > t.reach) continue;
      if (!best || cost < best.cost) best = {m, cost};
    }
    if (!best) continue;
    S.assign.set(best.m, {kind: t.kind, id: t.id, x: t.x, y: t.y, adj: t.adj, since: g.turn, turns: t.turns});
    taken.add(best.m); busy.add(t.id); if (t.kind !== 'power') crateRuns++;
  }
  return S.assign;
}
export function markDone(g, id) { sideState(g, g.pvp.side).done.add(id); }
export function markOpened(g, id) { sideState(g, g.pvp.side).opened.add(id); }

// 忍者的脫離繩（不花動作、6 格直線、落點要看得到）：往目標拉近至少 ropeGain 步
export function ropeToward(g, me, goal) {
  if (OFF.has('rope') || me.character !== 'ninja') return null;
  const item = me.escapeLines > 2 ? 'escape_line' : null; if (!item) return null;
  const D = stepField(g, goal), here = D[me.y]?.[me.x]; if (!Number.isFinite(here) || here <= 3) return null;
  let best = null; const R = LINE_TUNING.range;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (Math.abs(dx) + Math.abs(dy) > R || (dx && dy)) continue;   // 直線（一條軸）
    const q = {x: me.x + dx, y: me.y + dy}, d = D[q.y]?.[q.x];
    if (!Number.isFinite(d) || here - d < OBJ_TUNING.ropeGain) continue;
    if (lineReason(g, {x: q.x, y: q.y, item})) continue;
    const gain = here - d; if (!best || gain > best.gain) best = {q, gain};
  }
  return best ? {type: 'rope', arg: {x: best.q.x, y: best.q.y, item}, why: `rope to objective gain ${best.gain}`} : null;
}
