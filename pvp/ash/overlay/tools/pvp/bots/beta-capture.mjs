// beta 的佔領模式（pvp/DESIGN.md「佔領模式」，rules.capture）：整隊分配誰站哪一個點。只在 g.captureRule() 有值時用；
// 拿下兩人的原本模式完全不走這裡。點的位置、價值、誰佔著都是公開的（畫面上的點）。
//   - 分配：點的價值（自己這側 1、中央 1、對面 2）、走過去的步數、職業（重裝兵守自己這側／中央、近戰職業去偷對面）、
//     上一次的分配（不要每個決策換人）、比分（領先守、落後搶）。
//   - 站在點上：不離開（離開就丟分），開火、待機；重裝兵在點上下錨。
//   - 不在點上：往點走；點被對方佔著就集火站在上面的人。
//   - 剛復活（復活保護）：打不動、也打不到——不打牠，自己保護中也不開火。
import {dist, key} from '../../clear-bot/util.mjs';
import {stepField} from './beta-objective.mjs';

const ENV = globalThis.process?.env || {};
const OFF = new Set((ENV.BETA_OFF || '').split(','));
export const CAP_TUNING = {value: 10, step: .8, sticky: 6, bulwarkHome: 4, meleeFar: 4, reconHome: 2, lead: 15, behind: 10, hold: 22, go: +(ENV.BETA_CAPGO || 40), roam: +(ENV.BETA_ROAM ?? 0)};
export const CAP_STATS = {};
const cs = (k, v = 1) => { CAP_STATS[k] = (CAP_STATS[k] || 0) + v; };
export const captureOn = g => !!g.captureRule?.() && (g.pvpPoints || []).length > 0 && !OFF.has('cap');
const unitOf = (g, id) => String(id).startsWith('px-') ? g.unit(String(id).slice(3)) : null;
export const safeFoe = (g, e) => { const u = unitOf(g, e.id ?? e); return !!u?.pvpSafe; };

const assigns = new WeakMap();
// 分配（每次決策重算，跟上一次的分配有黏性）：Map<隊員, 點>
export function captureAssign(g, plan) {
  const side = g.pvp.side, other = g.other(side), sc = g.pvp.score || {A: 0, B: 0}, lead = sc[side] - sc[other];
  let all = assigns.get(g); if (!all) { all = {A: new Map(), B: new Map()}; assigns.set(g, all); }
  const prev = all[side], out = new Map();
  const farMult = lead >= CAP_TUNING.lead ? .7 : lead <= -CAP_TUNING.behind ? 1.4 : 1;
  const pairs = [];
  for (const pt of g.pvpPoints) {
    const D = stepField(g, pt), mine = g.pointValue(pt, side), far = pt.half && pt.half !== side, home = pt.half === side;
    let val = mine * (far ? farMult : 1) + (pt.holder === other ? g.pointValue(pt, other) * .5 : 0);
    for (const m of plan.members) {
      const d = D[m.y]?.[m.x]; if (!Number.isFinite(d)) continue;
      let s = val * CAP_TUNING.value - d * CAP_TUNING.step;
      if (m.character === 'bulwark' && !far) s += CAP_TUNING.bulwarkHome;
      if ((m.character === 'berserker' || m.character === 'ninja') && far) s += CAP_TUNING.meleeFar;
      if (m.character === 'recon' && home) s += CAP_TUNING.reconHome;
      if (prev.get(m)?.id === pt.id) s += CAP_TUNING.sticky;
      pairs.push({m, pt, s, d});
    }
  }
  pairs.sort((a, b) => b.s - a.s);
  const limit = Math.max(1, plan.members.length - CAP_TUNING.roam), usedPt = new Set();
  for (const p of pairs) {
    if (out.size >= limit) break;
    if (out.has(p.m) || usedPt.has(p.pt.id)) continue;
    out.set(p.m, p.pt); usedPt.add(p.pt.id);
  }
  all[side] = out;
  return out;
}
export const onPoint = (me, pt) => pt && me.x === pt.x && me.y === pt.y;
// 交火中的分數：站在點上的不走開；不在點上的往點走；對方站在點上的人優先打；保護中的人不打
export function captureStance(view, bot, opts, route) {
  const g = bot.g, me = view.me, pt = bot.point;
  for (let i = opts.length - 1; i >= 0; i--) {
    const o = opts[i], t = o.type === 'fire' || o.attack ? o.target ?? o.enemy : o.then?.type === 'fire' ? o.then.target : null;
    if (t != null && (safeFoe(g, t) || me.ref.pvpSafe) && (o.attack || o.type === 'fire' || o.then?.type === 'fire' || o.type === 'grenade')) { opts.splice(i, 1); cs('cap:dropSafeAttack'); }
  }
  // 對方站在點上：打牠加分（把牠打下來才搶得到）
  const on = new Set(g.pvpPoints.filter(p => p.holder && p.holder !== g.pvp.side).map(p => key(p)));
  for (const o of opts) {
    const t = o.target ?? o.then?.target, e = t != null && view.enemies.find(x => x.id === t);
    if (e && on.has(key(e)) && (o.attack || o.type === 'fire' || o.then?.type === 'fire')) { o.score += 8; o.why = (o.why || '') + ' +cap'; }
  }
  if (!pt) return;
  if (onPoint(me, pt)) {
    for (const o of opts) if (o.type === 'move' && !o.target) { o.score -= CAP_TUNING.hold; o.why = (o.why || '') + ' -cap leave'; }
    for (const o of opts) if (o.type === 'rope') o.score -= CAP_TUNING.hold;
    if (me.character === 'bulwark' && !me.anchored && me.skills.anchor && me.prepared.skill === 'anchor' && !opts.some(o => o.type === 'skill' && o.arg === 'anchor')) opts.push({type: 'skill', arg: 'anchor', score: 8, why: 'cap anchor on point'});
    if (!opts.some(o => o.type === 'wait')) opts.push({type: 'wait', score: 0, why: 'cap hold point'});
    return;
  }
  if (me.anchored || me.pinned) return;
  const r = route(view, q => q.x === pt.x && q.y === pt.y, {maxCost: 60, allyCost: 2});
  if (!r) return;
  const same = opts.find(o => o.type === 'move' && !o.target && o.arg && o.arg[0] === r.first[0] && o.arg[1] === r.first[1]);
  const base = same ? same.score : Math.max(-50, ...opts.filter(o => o.type === 'move').map(o => o.score));
  opts.push({type: 'move', arg: r.first, score: base + CAP_TUNING.go, why: `cap go ${pt.id} ${pt.x},${pt.y}`});
}
