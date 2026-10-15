// alpha：比 PvpBot 強一點的 PVP 機器人（pvp/DESIGN.md）。在 ClearBot 的決策前後加上 PVP 的判斷：
// - 威脅模型：替身是 ASH 的 raider，傷害、射程跟真的職業武器差很多；改成對方本人手上的武器（職業是公開的）。
//   黑暗不當掩護（對方可能有夜視、我方開著手電筒）。
// - PVP 的替身每階段重建，移動閃避、待機減傷都不存在；對方整個階段都會打 → 威脅全部算「這一回合」，移動、待機不打折。整體再保守一點（riskAll）。
// - 破片手榴彈：自己算（含隊友、自己、爆炸視線），用 ClearBot 的 enemyValue 單位放進選項跟開槍比（必中 55，常常比開槍好）；
//   ClearBot 原本的手榴彈不看隊友，拿掉。
// - 煙霧：有紅外線的（偵察兵、忍者）把煙丟在對方看得到我方的地方（模擬擋掉的射線）。
// - 集火：血少的、能打死的加分。散開：交戰中的移動避開緊貼隊友的格子。
// - 看不到但剛看過的對方（ghost）照他的武器算威脅。
// 參數在 T（ALPHA_* 環境變數只給實驗用；預設值是測過的最好組合）。
import {PvpBot} from '../match.mjs';
import {WEAPONS} from '../../../src/data.js';
import {lineOfSight, distance} from '../../../src/world.js';
import {objectSightGrid} from '../../../src/scenery.js';
import {skillActive} from '../../../src/skills.js';
import {activeTrait} from '../../../src/traits.js';
import {areaCells} from '../../../src/throwables.js';
import {threatAt, enemyValue} from '../../clear-bot/tactics.mjs';
import {damageCost} from '../../clear-bot/combat.mjs';

const T = {
  threat: process.env.ALPHA_THREAT !== '0',
  frag: process.env.ALPHA_FRAG !== '0',
  focus: process.env.ALPHA_FOCUS !== '0',
  spread: process.env.ALPHA_SPREAD !== '0',
  hold: +(process.env.ALPHA_HOLD ?? 0),
  nv: process.env.ALPHA_NV !== '0',
  fk: +(process.env.ALPHA_FK ?? 999), f2: +(process.env.ALPHA_F2 ?? 999), f1: +(process.env.ALPHA_F1 ?? 999), fnow: +(process.env.ALPHA_FNOW ?? 999),
  light: process.env.ALPHA_LIGHT !== '0',
  def: process.env.ALPHA_DEF !== '0', fast: process.env.ALPHA_FAST === '1',
  smoke: process.env.ALPHA_SMOKE !== '0', smokeMin: +(process.env.ALPHA_SMIN ?? 60), smokeGain: +(process.env.ALPHA_SGAIN ?? 50),
  riskAll: +(process.env.ALPHA_RK ?? 0.3), riskOur: +(process.env.ALPHA_RO ?? 0), riskTheir: +(process.env.ALPHA_RT ?? 0),
  space: +(process.env.ALPHA_SPACE ?? 0),
  planDef: process.env.ALPHA_PLANDEF === '1',
  fragEv: process.env.ALPHA_FEV !== '0', reserve: +(process.env.ALPHA_RES ?? 12),
  ghost: +(process.env.ALPHA_GHOST ?? 0.5),
  ghostAge: +(process.env.ALPHA_GAGE ?? 4),
  cohesion: +(process.env.ALPHA_COH ?? 0),
};

const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export default class Alpha extends PvpBot {
  side() { return this.g.pvp.side; }
  mates() { const g = this.g, me = g.player; return g.alive(this.side()).filter(m => m !== me); }
  // 對方本人（替身 → 本人）
  realOf(e) { const id = e.ref?.pvpOf ?? e.pvpOf; return id ? this.g.unit(id) : null; }

  patchThreat(view) {
    const g = this.g;
    for (const e of view.enemies) {
      const m = this.realOf(e); if (!m) continue;
      const w = WEAPONS[m.weaponBases?.[m.weapon]] || g.weaponAt?.(m.weapon); if (!w) continue;
      e.real = m;
      const anchored = skillActive(m, 'anchor');
      if (w.melee) { e.melee = true; e.range = 1; e.damage = (w.min + w.max) / 2; e.rounds = 1; }
      else if (w.pellets) { e.melee = false; e.range = w.range; e.damage = Math.round((w.min + w.max) / 2 * .8); e.rounds = 1; }
      else { e.melee = false; e.range = w.range; e.rounds = w.burst || 1; e.damage = (w.min + w.max) / 2 * e.rounds * (anchored ? 2 : 1); }
      // 近戰職業手上拿近戰武器時，一回合能走一格再砍：當成「快」
      if (w.melee && T.fast) e.fast = true;
      if (T.def && !w.melee) e.charge = true;   // PVP：我動完，對方整個階段都會打，全部算「這一回合」
      if (T.nv) { e.nv = true; e.ir = true; }
    }
  }

  // 一格中心 c 丟破片：對每個人的傷害（照 PvpGame.explode：距離每 1 少 10、要爆炸視線）
  fragAt(view, c) {
    const g = this.g, me = g.player, dmg0 = 55 + (me.blastBonus || 0);
    const hit = u => { const d = distance(c, u); if (d > 2) return 0; if (d > 0 && !lineOfSight(objectSightGrid(g, c, u), c, u, g.barriers, 'blast')) return 0; return Math.max(1, dmg0 - d * 10); };
    let value = 0, kills = 0, hits = 0, friendly = 0;
    let ev = 0;
    for (const e of view.enemies) { const d = hit(e); if (!d) continue; hits++; value += Math.min(d, e.hp); const v = enemyValue(view, e); if (d >= e.hp) { kills++; value += 70; ev += v * 1.3; } else ev += v * .8 * d / Math.max(1, e.hp); }
    for (const m of [me, ...this.mates()]) { const d = hit(m); if (!d) continue; const hp = m.hp + (m.plates || 0); friendly += Math.min(d, hp) * 1.6 + (d >= hp ? 150 : 0); }
    return {value, kills, hits, friendly, score: value - friendly, ev: ev - friendly};
  }
  fragOption(view) {
    const g = this.g, me = view.me;
    if (!(me.grenades.frag > 0)) return null;
    let best = null; const tried = new Set();
    for (const e of view.enemies) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 2) continue;
      const c = {x: e.x + dx, y: e.y + dy}, k = c.x + ',' + c.y; if (tried.has(k)) continue; tried.add(k);
      if (distance(c, me) > 5 || g.grid[c.y]?.[c.x] !== 1 || !g.visible(c)) continue;
      const f = this.fragAt(view, c); if (!best || f.score > best.f.score) best = {c, f};
    }
    if (!best) return null;
    const {f} = best;
    // 值不值得：炸死一人，或同時打到兩人以上、總傷害夠
    const worth = f.kills >= 1 && f.score > T.fk || f.hits >= 2 && f.score > T.f2 || f.score > T.f1 && me.grenades.frag >= 2;
    if (!worth) {
      if (!T.fragEv) return null;
      // 不夠好到直接丟：用 ClearBot 的單位（enemyValue）放進選項裡，跟開槍比
      let soft = null;
      for (const k of tried) { const [x, y] = k.split(',').map(Number), c = {x, y}; if (distance(c, me) > 5 || g.grid[y]?.[x] !== 1 || !g.visible(c)) continue; const f2 = this.fragAt(view, c); if (!soft || f2.ev > soft.f.ev) soft = {c, f: f2}; }
      if (!soft) return null;
      const sc = soft.f.ev - T.reserve * (me.grenades.frag <= 1 ? 1.6 : 1);
      if (sc <= 0) return null;
      return {type: 'grenade', arg: {x: soft.c.x, y: soft.c.y, grenade: 'frag'}, pre: me.prepared.grenade !== 'frag' ? {type: 'prepare', arg: {category: 'grenade', id: 'frag'}} : null, soft: true, score: sc, kills: 0, why: `alpha soft frag ev${sc.toFixed(0)}`};
    }
    return {type: 'grenade', arg: {x: best.c.x, y: best.c.y, grenade: 'frag'}, pre: me.prepared.grenade !== 'frag' ? {type: 'prepare', arg: {category: 'grenade', id: 'frag'}} : null,
      score: f.score, kills: f.kills, why: `alpha frag ${f.kills}k ${f.hits}h v${f.score.toFixed(0)}`};
  }

  // 看不到但最近看過的對方（ghost）：照他本人的武器，從他最後的位置打得到這一格的話算進威脅
  ghostThreat(view, t) {
    const g = this.g; let sum = 0;
    for (const gh of view.ghosts) {
      const age = view.turn - gh.turn; if (age > T.ghostAge) continue;
      const id = String(gh.id).startsWith('px-') ? gh.id.slice(3) : null; const m = id && g.unit(id); if (!m || m.hp <= 0) continue;
      const w = WEAPONS[m.weaponBases?.[m.weapon]]; if (!w) continue;
      const d = distance(gh, t);
      if (w.melee) { if (d <= 2) sum += (w.min + w.max) / 2 * .5; continue; }
      if (d > w.range) continue;
      const k = `${gh.x},${gh.y}>${t.x},${t.y}`; this.lineMemo ||= new Map(); if (this.lineMemo.size > 20000) this.lineMemo.clear();
      let open = this.lineMemo.get(k); if (open === undefined) { const from = {x: gh.x, y: gh.y}, to = {x: t.x, y: t.y}; open = g.sight(from, to) && g.shotClear(from, to); this.lineMemo.set(k, open); }
      if (!open) continue;
      const per = w.pellets ? (w.min + w.max) / 2 * .8 : (w.min + w.max) / 2 * (w.burst || 1) * (skillActive(m, 'anchor') ? 2 : 1);
      sum += per * .7;
    }
    return sum;
  }
  // 煙霧（偵察兵、忍者有紅外線、看得穿）：丟在對方看得到我方的地方，擋掉沒紅外線的對方的射線
  smokeOption(view) {
    const g = this.g, me = view.me, p = g.player;
    if (!(me.grenades.smoke > 0) || !activeTrait(p, 'infrared')) return null;
    const ours = [p, ...this.mates()];
    const shooters = view.enemies.filter(e => e.real && !e.melee && !activeTrait(e.real, 'infrared'));
    if (!shooters.length) return null;
    const lines = () => { let t = 0; for (const e of shooters) for (const u of ours) if (distance(e, u) <= e.range && g.sight(e.ref, u) && g.shotClear(e.ref, u)) t += e.damage * (u === p ? 1.2 : 1); return t; };
    const mine = () => { let t = 0; for (const u of ours) { if (u === p || activeTrait(u, 'infrared')) continue; for (const e of view.enemies) if (g.sight(u, e.ref) && g.shotClear(u, e.ref)) t += 15; } return t; };
    const before = lines(); if (before < T.smokeMin) return null;
    const mine0 = mine(), keep = g.smoke; let best = null; const tried = new Set();
    const cands = [];
    for (const e of shooters) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { if (Math.abs(dx) + Math.abs(dy) > 2) continue; cands.push({x: e.x + dx, y: e.y + dy}); }
    try {
      for (const c of cands) {
        const k = c.x + ',' + c.y; if (tried.has(k)) continue; tried.add(k);
        if (distance(c, me) > 5 || g.grid[c.y]?.[c.x] !== 1 || !g.visible(c)) continue;
        const cells = areaCells(g.grid, c, 2, g.barriers, g).filter(q => g.grid[q.y]?.[q.x] === 1);
        g.smoke = [...keep, {cells, expires: g.turn + 4}];
        const v = before - lines() - (mine0 - mine());
        if (!best || v > best.v) best = {c, v};
      }
    } finally { g.smoke = keep; }
    if (!best || best.v < T.smokeGain) return null;
    return {type: 'grenade', arg: {x: best.c.x, y: best.c.y, grenade: 'smoke'}, pre: me.prepared.grenade !== 'smoke' ? {type: 'prepare', arg: {category: 'grenade', id: 'smoke'}} : null, score: best.v, why: `alpha smoke v${best.v.toFixed(0)}`};
  }
  decide(view) {
    if (!T.light) view.me.black = false;   // 手電筒只會暴露自己：不開
    if (T.threat) this.patchThreat(view);
    const hostile = view.enemies.filter(e => !e.civilian);
    if (T.smoke && hostile.length) { const sm = this.smokeOption(view); if (sm && !this.isRefused(sm)) return sm; }
    if (T.frag && hostile.length) {
      const fr = this.fragOption(view);
      if (fr && !this.isRefused(fr) && !fr.soft && (fr.kills || fr.score >= T.fnow)) return fr;
      if (fr && !this.isRefused(fr)) this.pendingFrag = fr; else this.pendingFrag = null;
    } else this.pendingFrag = null;
    return super.decide(view);
  }
  chooseGoal(view) {
    const g = this.g, me = view.me;
    const contact = view.ghosts.length > 0 || g.enemies.some(e => e.hp > 0 && g.teamVisible(e));
    if (!contact && g.pvp.round < T.hold && !this.isRefused({type: 'wait'})) return {type: 'wait', why: 'alpha hold'};
    if (T.cohesion && !contact) {
      // 不要一個人衝太前面：比隊上最後面的人離對方開場近 cohesion 格以上就等
      const home = g.pvpGoal?.[this.side()];
      if (home) {
        const mine = distance(me, home), mates = this.mates();
        const back = Math.max(...mates.map(m => distance(m, home)));
        if (mates.length && mine < back - T.cohesion && !this.isRefused({type: 'wait'})) return {type: 'wait', why: 'alpha cohesion'};
      }
    }
    const r = super.chooseGoal(view);
    if (T.space && r?.type === 'move' && Array.isArray(r.arg) && g.pvp.round > 4) {
      const to = {x: me.x + r.arg[0], y: me.y + r.arg[1]};
      const crowd = this.mates().filter(m => distance(m, to) <= T.space).length;
      if (crowd && (this.spaceWaits || 0) < 2 && !this.isRefused({type: 'wait'})) { this.spaceWaits = (this.spaceWaits || 0) + 1; return {type: 'wait', why: 'alpha spacing'}; }
    }
    this.spaceWaits = 0;
    return r;
  }
}

// ClearBot 的 combatOptions 在 decide 裡呼叫：用 pickBest 前的過濾太深，改成包一層 stance（opts 會傳進來）
const baseStance = Object.getPrototypeOf(Alpha.prototype).stance;
Alpha.prototype.stance = function (view, opts) {
  // 拿掉原本不看隊友的手榴彈，換成自己的
  for (let i = opts.length - 1; i >= 0; i--) if (opts[i].type === 'grenade' && T.frag) opts.splice(i, 1);
  if (this.pendingFrag) opts.push(this.pendingFrag);
  if (T.focus) for (const o of opts) {
    if (!o.attack || !o.enemy) continue;
    const e = view.enemies.find(x => x.id === o.enemy); if (!e) continue;
    const hurt = 1 - e.hp / Math.max(1, e.maxHp);
    o.score += 12 * hurt + 25 * (o.kill || 0);
  }
  if (T.spread) {
    const mates = this.mates();
    for (const o of opts) if (o.type === 'move' && !o.target && Array.isArray(o.arg)) {
      const to = {x: view.me.x + o.arg[0], y: view.me.y + o.arg[1]};
      const near = mates.filter(m => distance(m, to) <= 1).length;
      o.score -= near * 6;
    }
  }
  // PVP 的替身每階段重建：移動不會閃避、待機也不減傷（替身沒有 moved、guard）。把 ClearBot 對移動、待機的減傷估計拿掉
  if (T.def) {
    const g = this.g, me = view.me, cache = new Map();
    const real = t => { const k = t.x + ',' + t.y; let v = cache.get(k); if (v === undefined) { v = damageCost(me, threatAt(view, t, {})); cache.set(k, v); } return v; };
    for (const o of opts) {
      if (o.plan) { if (T.planDef && Array.isArray(o.arg)) { const to = {x: me.x + o.arg[0], y: me.y + o.arg[1]}; o.score += damageCost(me, threatAt(view, to, {moved: true}), {soonWeight: .2}) - real(to); } continue; }
      if (o.type === 'move' && !o.target && Array.isArray(o.arg)) { const to = {x: me.x + o.arg[0], y: me.y + o.arg[1]}; o.score += damageCost(me, threatAt(view, to, {moved: true})) - real(to); }
      else if (o.type === 'wait') o.score += damageCost(me, threatAt(view, me, {guard: true})) - real(me);
    }
    const side = this.side(), ourDead = g.sides[side].filter(m => m.hp <= 0).length, theirDead = g.sides[g.other(side)].filter(m => m.hp <= 0).length;
    const k = T.riskAll + T.riskOur * ourDead - T.riskTheir * theirDead;
    if (k) for (const o of opts) {
      if (o.plan) continue;
      const to = o.type === 'move' && !o.target && Array.isArray(o.arg) ? {x: me.x + o.arg[0], y: me.y + o.arg[1]} : me;
      o.score -= k * real(to);
    }
  }
  if (T.ghost) {
    const me = view.me, here = this.ghostThreat(view, me);
    for (const o of opts) {
      const to = o.type === 'move' && !o.target && Array.isArray(o.arg) ? {x: me.x + o.arg[0], y: me.y + o.arg[1]} : me;
      const gt = to === me ? here : this.ghostThreat(view, to);
      o.score -= T.ghost * gt;
    }
  }
  return baseStance.call(this, view, opts);
};
