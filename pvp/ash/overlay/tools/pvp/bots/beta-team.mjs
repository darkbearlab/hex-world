// beta 的團隊計畫：每個階段（g.turn）算一次，整隊共用。
import {weaponStats} from '../../../src/weapons.js';
import {WEAPONS} from '../../../src/data.js';
import {skillActive} from '../../../src/skills.js';
import {dist} from '../../clear-bot/util.mjs';
import {lineOfSight} from '../../../src/world.js';
import {objectSightGrid} from '../../../src/scenery.js';

const plans = new WeakMap();
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

// 整隊共用的記憶：對方每個人最後看到的位置（ASH 的記憶在那一格看得到時就忘掉，但貼牆的人站在看得到的格子上也看不到）
const sightings = new WeakMap();
export function teamMemory(g, view) {
  const side = g.pvp.side;
  let all = sightings.get(g); if (!all) { all = {A: new Map(), B: new Map()}; sightings.set(g, all); }
  const mem = all[side];
  for (const e of view.enemies) if (e.pvpClass || e.ref?.pvpOf) mem.set(e.id, {id: e.id, x: e.x, y: e.y, turn: g.turn, hp: e.hp, range: e.range, damage: e.damage, melee: e.melee, seen: true});
  const visible = new Set(view.enemies.map(e => e.id));
  for (const [id, r] of mem) { r.seen = visible.has(id); const u = unitOf(g, id); if (!u || u.hp <= 0) mem.delete(id); else if (!r.seen) { const t = threatOf(u); if (t) Object.assign(r, {range: t.range, damage: t.damage, melee: t.melee}); } }
  return mem;
}
export function teamPlan(g, view, bot) {
  const side = g.pvp.side;
  const memory = teamMemory(g, view);
  let p = plans.get(g);
  if (p && p.turn === g.turn && p.side === side) { p.update?.(view); return p; }
  const members = g.alive(side);
  const enemies = view.enemies.filter(e => !e.civilian);
  p = {turn: g.turn, side, members, memory, focus: null, focusBonus: 12, hold: new Set(), threat: enemies.length > 0 || (view.ghosts || []).some(x => view.turn - x.turn <= 6)};
  // 集火：打得到的人越多、血越少、威脅越大越好
  let best = null;
  for (const e of enemies) {
    let shooters = 0;
    for (const m of members) {
      const t = threatOf(m); if (!t) continue;
      const d = dist(m, e); if (d > t.range) continue;
      if (t.melee ? d <= 1 : (g.shotClear(m, e.ref) && g.nativeSight(m, e.ref))) shooters++;
    }
    if (!shooters) continue;
    const s = (e.damage + 20) / Math.max(10, e.hp) * (1 + shooters) * (e.pvpAlly ? .3 : 1);
    if (!best || s > best.s) best = {s, id: e.id};
  }
  p.focus = best?.id ?? null;
  // 推進：沒看到敵人時，跑在最前面的等後面的人
  if (!enemies.length && members.length >= 2) {
    const goal = g.pvpGoal?.[side];
    if (goal) {
      const D = distField(g, goal);
      const ds = members.map(m => D[m.y]?.[m.x] ?? Infinity).filter(Number.isFinite).sort((a, b) => a - b);
      if (ds.length >= 2) {
        const ref = ds[ds.length - 2];
        for (const m of members) { const d = D[m.y]?.[m.x]; if (Number.isFinite(d) && d < ref - 4) p.hold.add(m); }
      }
    }
  }
  plans.set(g, p);
  return p;
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
