// beta 的團隊計畫：每個階段（g.turn）算一次，整隊共用。
import {weaponStats} from '../../../src/weapons.js';
import {WEAPONS} from '../../../src/data.js';
import {skillActive} from '../../../src/skills.js';
import {dist} from '../../clear-bot/util.mjs';
import {lineOfSight} from '../../../src/world.js';
import {objectSightGrid} from '../../../src/scenery.js';
import {marked, markedSight, focusWeight, on as pbOn, PB_TUNING} from './beta-playbook.mjs';
import {lineOpen} from '../../clear-bot/tactics.mjs';

const homeDist = new WeakMap();

// 對方一個人真的武器：{range, damage（一輪的總傷害）, rounds, melee, band}
export function threatOf(u) {
  let best = null, melee = null;
  for (const s of u.owned || []) {
    const base = u.weaponBases?.[s]; if (!WEAPONS[base]) continue;
    const w = weaponStats(base, u.affixes?.[s], u);
    if (w.melee) { const d = (w.min + w.max) / 2; if (!melee || d > melee.damage) melee = {damage: d, slot: s}; continue; }
    if (w.pointTarget || w.flame) continue;
    const pellets = Boolean(w.pellets);
    const dmg = pellets ? 30 : (w.burst || 1) * (w.min + w.max) / 2;
    const rec = {range: w.range, damage: dmg, rounds: pellets ? 1 : (w.burst || 1), band: w.band || null, slot: s, pellets};
    if (!best || (s === u.weapon) || (best.slot !== u.weapon && dmg * w.range > best.damage * best.range)) best = rec;
  }
  const held = u.owned?.includes(u.weapon) ? WEAPONS[u.weaponBases?.[u.weapon]] : null;
  const anchored = skillActive(u, 'anchor');
  const out = held?.melee && melee ? {range: 1, damage: melee.damage, rounds: 1, melee: true, band: null}
    : best ? {...best, melee: false} : melee ? {range: 1, damage: melee.damage, rounds: 1, melee: true, band: null} : null;
  if (out && anchored && !out.melee) out.damage *= 2, out.rounds *= 2;
  return out;
}
const unitOf = (g, id) => { const sid = String(id).startsWith('px-') ? String(id).slice(3) : null; return sid ? g.unit(sid) : null; };

export function patchView(view) {
  const g = view.g;
  for (const e of [...view.enemies, ...(view.ghosts || [])]) {
    const u = unitOf(g, e.id); if (!u) continue;
    const t = threatOf(u); if (!t) continue;
    e.range = t.range; e.damage = t.damage; e.rounds = t.rounds; e.melee = t.melee; e.rapid = false;
    if (t.band) e.band = t.band; e.pvpClass = u.character;
    if (u.character === 'berserker' && t.melee) e.fast = true;   // 鉤鎖：近戰的威脅範圍大一點
  }
}

// 從對方開場走到每一格的步數（推進時比較誰跑在前面）
function distField(g, goal) {
  let byGoal = homeDist.get(g); if (!byGoal) { byGoal = new Map(); homeDist.set(g, byGoal); }
  const k = `${goal.x},${goal.y}`; if (byGoal.has(k)) return byGoal.get(k);
  const N = g.grid.length, D = Array.from({length: N}, () => new Array(N).fill(Infinity));
  const q = [[goal.x, goal.y]]; D[goal.y][goal.x] = 0;
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (g.grid[ny]?.[nx] !== 1 || D[ny][nx] !== Infinity) continue;
      D[ny][nx] = D[y][x] + 1; q.push([nx, ny]);
    }
  }
  byGoal.set(k, D); return D;
}

// 全隊共享視野（正式規則，Alan 2026-10-15）：隊上任何人看得到的敵人，全隊都知道（開火還是只能打射手自己看得到的）。
// 看得到＝跟 ASH 的 visible 同一套（偵測距離、隱形、視線含黑暗與煙、轉角貼牆看不到、暴露中到處看得到），只是換成每個隊員
export function teamSight(g) {
  const out = new Map(), members = g.alive(g.pvp.side);
  for (const e of g.enemies) {
    if (e.hp <= 0 || (e.pvpOf == null && e.pvpAlly == null)) continue;
    if (e.pvpExposed) { out.set(e.id, e); continue; }
    for (const m of members) {
      const reach = Math.max(10, threatOf(m)?.range || 0);
      // 預警標到的人（手冊 pb1）：隊上每個人看黑暗都亮一級（ASH 只算目前操作的人）
      if (dist(m, e) <= reach && g.revealed(m, e) && (pbOn('pb1') && marked(e) ? markedSight(g, m, e) : g.sight(m, e))) { out.set(e.id, e); break; }
    }
  }
  return out;
}
// 整隊共用的記憶：對方每個人最後看到的位置（ASH 的記憶在那一格看得到時就忘掉，但貼牆的人站在看得到的格子上也看不到）
const sightings = new WeakMap();
export function teamMemory(g, view, sight = teamSight(g)) {
  const side = g.pvp.side;
  let all = sightings.get(g); if (!all) { all = {A: new Map(), B: new Map()}; sightings.set(g, all); }
  const mem = all[side];
  for (const e of sight.values()) {
    const u = unitOf(g, e.id), t = u ? threatOf(u) : null;
    mem.set(e.id, {id: e.id, x: e.x, y: e.y, turn: g.turn, hp: e.hp, range: t?.range ?? 5, damage: t?.damage ?? 20, melee: !!t?.melee, seen: true, ally: e.pvpAlly != null, cls: u?.character, checked: false});
  }
  for (const [id, r] of mem) {
    r.seen = sight.has(id);
    if (r.ally) { if (!r.seen) mem.delete(id); continue; }
    const u = unitOf(g, id); if (!u || u.hp <= 0) { mem.delete(id); continue; }
    if (!r.seen) { const t = threatOf(u); if (t) Object.assign(r, {range: t.range, damage: t.damage, melee: t.melee}); }
  }
  return mem;
}
export function teamPlan(g, view, bot) {
  const side = g.pvp.side;
  const sight = teamSight(g), memory = teamMemory(g, view, sight);
  let p;   // 每次決策重算（隊友動過、看到的人變了；算起來很便宜）
  const members = g.alive(side);
  const enemies = view.enemies.filter(e => !e.civilian);
  p = {turn: g.turn, side, members, memory, sight, focus: null, focusBonus: 12, hold: new Set(), threat: enemies.length > 0 || (view.ghosts || []).some(x => view.turn - x.turn <= 6)};
  // 集火：打得到的人越多、血越少、威脅越大越好
  let best = null;
  for (const e of enemies) {
    if (unitOf(g, e.id)?.pvpSafe) continue;   // 剛復活（保護中）：打不動
    let shooters = 0;
    for (const m of members) {
      const t = threatOf(m); if (!t) continue;
      const d = dist(m, e); if (d > t.range) continue;
      if (t.melee ? d <= 1 : (g.shotClear(m, e.ref) && g.nativeSight(m, e.ref))) shooters++;
    }
    if (!shooters) continue;
    const s = (e.damage + 20) / Math.max(10, e.hp) * (1 + shooters) * (e.pvpAlly ? .3 : 1) * focusWeight(g, e);
    if (!best || s > best.s) best = {s, id: e.id};
  }
  p.focus = best?.id ?? null;
  const fe = p.focus && enemies.find(e => e.id === p.focus);
  if (fe && pbOn('pb1') && marked(fe.ref || fe)) p.focusBonus = PB_TUNING.focusBonus;
  p.goal = teamGoal(g, memory, members);
  p.bound = pbOn('ov') ? bounding(g, memory, members) : null;
  // 推進：沒看到敵人時，跑在最前面的等後面的人
  if (!enemies.length && members.length >= 2) {
    const goal = p.goal;
    if (goal) {
      const D = distField(g, goal);
      const ds = members.map(m => D[m.y]?.[m.x] ?? Infinity).filter(Number.isFinite).sort((a, b) => a - b);
      if (ds.length >= 2) {
        const ref = ds[ds.length - 2];
        for (const m of members) { const d = D[m.y]?.[m.x]; if (Number.isFinite(d) && d < ref - 4) p.hold.add(m); }
      }
    }
  }
  return p;
}

// 整隊要去哪（沒看到人的時候）：記得的敵人（最近看到的、還沒去看過的）→ 對方開場 → 自己開場（對方多半走別條路去那裡）→ 再回對方開場……
// 不探索角落、不隨機巡邏（舊的 PvpBot 在空曠的新地圖上會走散）
const sweeps = new WeakMap();
export const GOAL_TUNING = {memoryTurns: 40};
export function teamGoal(g, memory, members) {
  const side = g.pvp.side;
  const fresh = [...memory.values()].filter(r => !r.ally && !r.seen && !r.checked && g.turn - r.turn <= GOAL_TUNING.memoryTurns);
  // 去過了（隊上有人站到旁邊、還是沒看到）：那一筆記憶不再當目標
  for (const r of fresh) if (members.some(m => dist(m, r) <= 1)) r.checked = true;
  const live = fresh.filter(r => !r.checked).sort((a, b) => b.turn - a.turn);
  if (live.length) return {x: live[0].x, y: live[0].y, why: `memory ${live[0].id}`, enemy: live[0].id};
  let sw = sweeps.get(g); if (!sw) { sw = {A: 0, B: 0}; sweeps.set(g, sw); }
  const ends = [g.pvpGoal?.[side], g.pvpGoal?.[g.other(side)]].filter(Boolean); if (!ends.length) return null;
  let t = ends[sw[side] % ends.length];
  if (members.some(m => dist(m, t) <= 3)) { sw[side]++; t = ends[sw[side] % ends.length]; }
  return {x: t.x, y: t.y, why: sw[side] % 2 ? 'sweep home' : 'sweep enemy start'};
}

// 破片手榴彈（半徑 2、中心 55、每格 −10、波及自己人，落點看得到就能丟、不暴露）：
// 目標包括看不到但剛剛還在那裡的人（貼牆的、下錨的、煙裡的）——落點那一格看得到就好。
const blastReach = (g, c, t) => dist(c, t) <= 2 && lineOfSight(objectSightGrid(g, c, t), c, t, g.barriers || [], 'blast');
export function fragChoice(g, view, plan, {reserve = 12} = {}) {
  const me = view.me, n = me.grenades?.frag || 0; if (!n || !plan) return null;
  const targets = [];
  for (const r of plan.memory.values()) {
    const age = g.turn - r.turn; if (!r.seen && age > 2) continue;
    const conf = r.seen ? 1 : age <= 1 ? .8 : .5;
    targets.push({...r, conf, value: (r.damage || 30) * 1.8 + 20});
  }
  if (!targets.length) return null;
  const friends = plan.members.filter(m => m.hp > 0);
  let best = null; const tried = new Set();
  for (const t of targets) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const c = {x: t.x + dx, y: t.y + dy}, k = c.x + ',' + c.y;
    if (tried.has(k)) continue; tried.add(k);
    if (dist(c, t) > 2 || dist(c, me) > 5 || g.grid[c.y]?.[c.x] !== 1 || !g.visible(c)) continue;
    let value = 0, kills = 0, hits = 0;
    for (const e of targets) {
      if (!blastReach(g, c, e)) continue;
      const dmg = Math.max(1, 55 + (me.ref.blastBonus || 0) - dist(c, e) * 10), hp = Math.max(1, e.hp);
      value += e.conf * (Math.min(dmg, hp) / hp * e.value + (dmg >= hp ? e.value * .8 : 0)); hits++;
      if (dmg >= hp) kills += e.conf;
    }
    if (!value) continue;
    let friendly = 0;
    for (const m of friends) if (blastReach(g, c, m)) { const dmg = 55 - dist(c, m) * 10; friendly += dmg * (m === me.ref ? 3 : 2) + (dmg >= m.hp + (m.plates || 0) ? 150 : 0); }
    const score = value - friendly - reserve * (n <= 1 ? 1.4 : 1);
    if (!best || score > best.score) best = {x: c.x, y: c.y, score, hits, kills, value};
  }
  return best && best.value > 0 ? best : null;
}

// 交互掩護前進（ASH 小隊長的 bounding overwatch，src/squad.js）：打得到人的掩護（已就緒＝待機：減傷一半、下一槍 +15，或直接開火），
// 打不到的前進——一次最多一半的人、沒有射線的先走；其餘的人在原地待機。近戰職業照自己的打法（不排進來）。
export function bounding(g, memory, members) {
  const known = [...memory.values()].filter(r => !r.ally && g.turn - r.turn <= 3);
  if (!known.length || members.length < 2) return null;
  const ranged = members.filter(m => { const t = threatOf(m); return t && !t.melee; });
  if (ranged.length < 2) return null;
  const line = m => { const t = threatOf(m); return known.some(r => dist(m, r) <= t.range && lineOpen(g, m, r)); };
  const near = m => Math.min(...known.map(r => dist(m, r)));
  const cover = new Set(ranged.filter(line)), blind = ranged.filter(m => !cover.has(m)).sort((a, b) => near(a) - near(b));
  if (!cover.size) return {cover, advance: new Set(blind), hold: new Set(), known};   // 沒人有射線：一起前進（找人）
  const maxAdv = Math.max(1, Math.floor(ranged.length / 2));
  return {cover, advance: new Set(blind.slice(0, maxAdv)), hold: new Set(blind.slice(maxAdv)), known};
}
