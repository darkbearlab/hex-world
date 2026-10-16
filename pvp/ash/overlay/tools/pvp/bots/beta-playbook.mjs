// beta 的「打法手冊」（pvp/DESIGN.md，Alan 2026-10-16）：整隊協調的版本。每一條都可以用 BETA_OFF=pb1..pb8 單獨關掉（量效果用），
// PB_OFF=1 全部關掉但保留統計（基準）。統計在 PB_STATS（beta-analyze.mjs 印出來）。
//   pb1 士兵預警抓偵察兵：對方偵察兵位置不明（或有人被看不到的對手打）→ 開預警；標到的人全隊集火（標到的偵察兵最優先）。
//   pb2 重裝兵只在戰壕裡、或實牆／掩體擋住射界的格子下錨；附近有這種格子就先走過去。
//   pb3 忍者：迷彩（免費）＋天誅（hookBlade）同一個階段打出去，偵察兵優先；還沒進天誅距離時繞開偵察兵的視線靠近。
//   pb4 對方有紅外線（偵察兵、忍者）：煙、黑暗不當掩護（走進煙的加分、腳下丟煙都拿掉）。
//   pb5 狂戰士：鉤爪優先拉偵察兵；鉤爪還沒好時不先走進偵察兵的射界。
//   pb6 對方偵察兵還沒抓掉、位置不明：走路避開開闊又亮的格子（迂迴）。
//   pb7 同上：不去拿三倍傷害。
//   pb8 自殺無人機：預先放在對方會經過的路上（來路、箱子、中央、剛看到人的地方），不在交火中直接派出去。
import {activeTrait} from '../../../src/traits.js';
import {isDark, isBlack} from '../../../src/lighting.js';
import {coverEffects} from '../../../src/cover.js';
import {hookBladePlan, camoActive, ambushReady, ambushMultiplier, MELEE_TUNING} from '../../../src/melee-classes.js';
import {buildReason, deployReason, deployedUnits} from '../../../src/workshop.js';
import {droneCells} from '../../../src/allies.js';
import {lineOpen} from '../../clear-bot/tactics.mjs';
import {route} from '../../clear-bot/nav.mjs';
import {lineOfSight} from '../../../src/world.js';
import {dist, key} from '../../clear-bot/util.mjs';
import {ready, stayCost, hostiles} from '../../clear-bot/classes/common.mjs';
import {threatOf} from './beta-team.mjs';
import {stepFlaw} from './beta-terrain.mjs';

const ENV = globalThis.process?.env || {};
const OFF = new Set((ENV.BETA_OFF || '').split(','));
const ALL_OFF = !!ENV.PB_OFF;
// pb8（自殺無人機伏擊）預設關：實測對 alpha 80 場 24 勝 → 關掉 36 勝（做無人機吃掉重做跟隨無人機的廢料，伏擊 5～35 台只炸到 1 次、還炸到自己人）；BETA_PB8=1 打開
export const on = k => !ALL_OFF && !OFF.has(k) && (k !== 'pb8' || !!ENV.BETA_PB8);
export const PB_STATS = {};
export const pb = (k, v = 1) => { PB_STATS[k] = (PB_STATS[k] || 0) + v; };
export const PB_TUNING = {focusMark: 2.5, focusRecon: 2, focusBonus: 20, anchorGood: .75, anchorSteps: 6, anchorSeek: 8, tenchu: 12, tenchuRecon: 15,
  ninjaSight: 4, ovHold: 4, ovWait: 6, ovAdvance: 6, soldierFlank: 7, engSneak: 6, munition: 24, grappleRecon: 14, berserkLine: 8, detour: 3, munitionLane: 2};
const unitOf = (g, id) => String(id).startsWith('px-') ? g.unit(String(id).slice(3)) : null;
const foes = g => g.alive(g.other(g.pvp.side));

// 對方偵察兵：還活著嗎、整隊知不知道它在哪（最近 1 回合內看到過）
export function reconState(g, plan) {
  const recons = foes(g).filter(u => u.character === 'recon');
  if (!recons.length) return {alive: false, hidden: false, known: []};
  const known = [...(plan?.memory?.values() || [])].filter(r => !r.ally && r.cls === 'recon' && g.turn - r.turn <= 2);
  return {alive: true, hidden: known.length < recons.length, known};
}
// 對方有紅外線的人（偵察兵、忍者）還活著
export const irFoes = g => foes(g).filter(u => activeTrait(u, 'infrared'));
// 最近被看不到的人打（開火的人沒暴露：消焰槍在黑暗裡、或看不到的地方）
export function unseenHits(g, rounds = 1) {
  const mine = new Set(g.sides[g.pvp.side].map(m => m.squadId));
  return (g.pvp.events || []).filter(e => mine.has(e.target) && !e.byVisible && e.how?.type && e.how.type !== 'drone' && g.pvp.round - e.round <= rounds);
}
// 預警標到的（替身上有 exposed 特性）
export const marked = e => !!(e?.traits || []).some(t => t.id === 'exposed');

// 標到的人：隊上任何人（不只現在操作的）看黑暗的時候亮一級——ASH 的 markedFor 只看「目前的玩家」，這裡暫時換過去問一次
export function markedSight(g, m, e) {
  const keep = g.player; if (keep === m) return g.sight(m, e);
  g.player = m; try { return g.sight(m, e); } finally { g.player = keep; }
}

// 掩護下摸過去：走到離 tgt reach 格以內（ok 再篩落點），沿路避開已知敵人的射界（偵察兵的射界加重）
export function sneakRoute(view, bot, tgt, reach, ok = null, maxCost = 40) {
  const g = bot.g, watchers = [...bot.team.memory.values()].filter(r => !r.ally && !r.melee && g.turn - r.turn <= 3);
  const cost = q => watchers.reduce((n, r) => n + (dist(r, q) <= (r.range || 8) && lineOpen(g, r, q) ? (r.cls === 'recon' ? PB_TUNING.ninjaSight : 2) : 0), 0);
  return route(view, q => dist(q, tgt) <= reach && g.grid[q.y]?.[q.x] === 1 && (!ok || ok(q)), {cost, maxCost, allyCost: 2});
}
export function pushStep(opts, r, bonus, why, extra = {}) {
  const same = opts.find(o => o.type === 'move' && !o.target && o.arg && o.arg[0] === r.first[0] && o.arg[1] === r.first[1]);
  const base = same ? same.score : Math.max(-50, ...opts.filter(o => o.type === 'move').map(o => o.score));
  opts.push({type: 'move', arg: r.first, score: base + bonus, why, ...extra});
}
// 士兵往偵察兵摸過去（預警半徑 8：要進到 8 格內才標得到）
export function soldierTarget(g, plan, me) {
  const rs = reconState(g, plan);
  const known = [...plan.memory.values()].filter(r => !r.ally && r.cls === 'recon' && g.turn - r.turn <= 6).sort((a, b) => b.turn - a.turn)[0];
  return rs.alive ? known || null : null;
}
export function soldierFlank(view, bot, opts) {
  if (!on('pb1')) return null;
  const g = bot.g, me = view.me, sk = me.skills.early_warning; if (!sk || me.pinned || me.hp < me.maxHp * .45 || (sk.cooldown || 0) > 2) return null;
  const t = soldierTarget(g, bot.team, me); if (!t || dist(t, me) <= 7 || dist(t, me) > 18) return null;
  const r = sneakRoute(view, bot, t, 7); if (!r) return null;
  const why = `pb1 flank recon ${t.x},${t.y}`;
  if (opts) { pushStep(opts, r, PB_TUNING.soldierFlank, why); return null; }
  return {type: 'move', arg: r.first, walk: true, why};
}
// ---- pb1 士兵預警 ----
export function soldierScan(view, bot) {
  const g = bot.g, me = view.me; if (!ready(me, 'early_warning')) return null;
  const plan = bot.team, rs = reconState(g, plan);
  // ASH 原本的條件：8 格內看得到或剛看到人
  const base = hostiles(view).some(e => dist(e, me) <= 8) || (view.ghosts || []).some(e => dist(e, me) <= 8 && view.turn - e.turn <= 3);
  if (!on('pb1')) return base ? {type: 'skill', arg: 'early_warning', why: 'scan'} : null;
  // 偵察兵（記得的位置）在 8 格內就掃：看不到也標得到（標記讓黑暗亮一級）
  const t = soldierTarget(g, plan, me), hits = unseenHits(g, 1);
  const near = [...plan.memory.values()].some(r => !r.ally && g.turn - r.turn <= 3 && dist(r, me) <= 8);
  let why = null;
  if (t && dist(t, me) <= 8) why = 'recon-in-8';
  else if (hits.length && near) why = 'unseen-hit';
  else if (rs.hidden && near) why = 'recon-hidden';
  else if (base) why = 'base';
  if (!why) return null;
  return {type: 'skill', arg: 'early_warning', why: `pb1 scan ${why}`};
}
export function afterScan(g) {
  const ms = g.enemies.filter(e => e.hp > 0 && marked(e));
  pb('pb1:marked', ms.length); pb('pb1:markedRecon', ms.filter(e => e.pvpCls === 'recon').length);
  if (!ms.length) pb('pb1:scanEmpty');
}
// 集火的加權：標到的人、偵察兵
export function focusWeight(g, e) {
  if (!on('pb1')) return 1;
  const ref = e.ref || e; let w = 1;
  if (marked(ref)) w *= PB_TUNING.focusMark;
  if (ref.pvpCls === 'recon' || unitOf(g, e.id)?.character === 'recon') w *= PB_TUNING.focusRecon;
  return w;
}

// ---- pb2 重裝兵下錨 ----
// 這一格好不好下錨：戰壕裡，或對打得到這一格的人平均有一半以上的掩護（實牆、掩體）
export function anchorQuality(g, me, t, threats) {
  // 全身深的戰壕（D=2，等於實牆；同一條戰壕裡的人打不算）或對每個打得到的人都有實牆
  const D = g.pvpTrench?.[t.y]?.[t.x] || 0;
  if (!threats.length) return {good: D === 2, why: D === 2 ? 'trench2' : D === 1 ? 'trench1' : 'none', eff: D === 2 ? 1 : 0};
  let eff = 0;
  for (const e of threats) { const c = g.protectingCover({x: t.x, y: t.y, traits: me.ref.traits}, e.ref || e); eff += coverEffects(c, t, e.ref || e).efficiency || 0; }
  eff /= threats.length;
  const good = eff >= PB_TUNING.anchorGood;
  return {good, why: D === 2 ? (good ? 'trench2' : 'trench2-flanked') : D === 1 ? 'trench1' : good ? 'wall' : eff >= .4 ? 'half' : 'open', eff};
}
const shooters = (view, t, pad = 2) => view.enemies.filter(e => !e.civilian && !e.melee && !e.disabled && dist(e, t) <= (e.range || 5) + pad);
export function bulwarkCombat(view, bot, base) {
  const out = base(view, bot) || [], g = bot.g, me = view.me;
  if (!on('pb2')) { for (const o of out) if (o.type === 'skill' && o.arg === 'anchor') o.pbAnchor = anchorQuality(g, me, me, shooters(view, me)).why; return out; }
  // ASH 的下錨：拿掉開闊地的
  const q = anchorQuality(g, me, me, shooters(view, me));
  for (let i = out.length - 1; i >= 0; i--) if (out[i].type === 'skill' && out[i].arg === 'anchor') { if (!q.good) { out.splice(i, 1); pb('pb2:refuseOpen'); } else out[i].pbAnchor = q.why; }
  if (me.anchored || !me.skills.anchor || me.prepared.skill !== 'anchor' || me.pinned || me.hp < me.maxHp * .4) return out;
  const range = me.held?.range || 7;
  const targets = t => view.enemies.filter(e => !e.civilian && !e.remote && dist(e, t) <= range && lineOpen(g, t, e.ref || e));
  // 在好位置、有打得到的人：下錨（ASH 的條件要求「只有一個人看得到我」，戰壕／掩體裡放寬）
  if (q.good && !out.some(o => o.type === 'skill' && o.arg === 'anchor')) {
    const tg = targets(me), hp = tg.reduce((a, e) => a + e.hp, 0);
    if (tg.length && hp >= 40 && !view.danger.has(key(me))) out.push({type: 'skill', arg: 'anchor', score: Math.min(30, hp / 6) - stayCost(view) + 4, why: `pb2 anchor ${q.why}`, pbAnchor: q.why});
  }
  // 附近（4 步內）有好位置、在那裡打得到人：走過去
  if (!q.good) {
    let best = null;
    const r = route(view, t => {
      if (dist(t, me) > PB_TUNING.anchorSteps) return false;
      const qq = anchorQuality(g, me, t, shooters(view, t)); if (!qq.good) return false;
      const tg = targets(t); if (!tg.length) return false;
      best = qq; return true;
    }, {maxCost: PB_TUNING.anchorSteps + 2, allyCost: 3});
    if (r && best) {
      // 直接從平地跳進全身深（或爬出來）＝破綻（命中 +20、壓制 +3）：先走到旁邊半身深的那一格當台階
      let step = r.first, pts = [me, ...r.path], k = pts.findIndex((q, i) => i > 0 && stepFlaw(g, pts[i - 1], q) === 'trench');
      if (k > 0) {
        const deep = pts[k], st = route(view, t => (g.pvpTrench?.[t.y]?.[t.x] || 0) === 1 && dist(t, deep) === 1, {maxCost: PB_TUNING.anchorSteps + 4, allyCost: 3, cost: q => stepFlaw(g, me, q) === 'trench' && dist(q, me) === 1 ? Infinity : 0});
        step = st && !stepFlaw(g, me, {x: me.x + st.first[0], y: me.y + st.first[1]}) ? st.first : null;
      }
      if (step) out.push({type: 'move', arg: step, score: PB_TUNING.anchorSeek - r.cost * 1.5, why: `pb2 to anchor spot ${r.end.x},${r.end.y} ${best.why}`});
    }
  }
  return out;
}
// 下錨的格子、受的傷：每個自己的階段第一次決策時，結算上一個階段之後掉了多少（對方整個階段打的）
const bulTrack = new WeakMap();
export function trackBulwark(g, view) {
  const me = view.me; if (me.character !== 'bulwark') return;
  const p = me.ref, now = p.hp + (p.plates || 0), last = bulTrack.get(p);
  if (last && last.turn === g.turn) return;
  if (last) { pb(`pb2:phase:${last.state}`); pb(`pb2:dmg:${last.state}`, Math.max(0, last.hp - now)); }
  const state = (me.anchored ? 'anchor-' : 'free-') + anchorQuality(g, me, me, shooters(view, me)).why;
  bulTrack.set(p, {turn: g.turn, hp: now, state});
}

// ---- pb3 忍者：迷彩＋天誅 ----
function tenchuPlan(g, p, id) {
  if (camoActive(p)) return hookBladePlan(g, id);
  const s = p.skillState || (p.skillState = {}), keep = s.camouflage;
  s.camouflage = {remaining: 1, cooldown: 0};
  try { return hookBladePlan(g, id); } finally { if (keep === undefined) delete s.camouflage; else s.camouflage = keep; }
}
export function ninjaPrepare(view, bot, base) {
  if (!on('pb3')) return base(view, bot);
  // 迷彩只跟天誅一起開（ninjaCombat），或有人貼到 2 格內
  const me = view.me;
  if (ready(me, 'camouflage') && hostiles(view).some(e => dist(e, me) <= 2 && !e.remote)) return {type: 'skill', arg: 'camouflage', why: 'pb3 camo (close)'};
  return null;
}
export function ninjaCombat(view, bot, base) {
  const out = base(view, bot) || [], g = bot.g, me = view.me, p = me.ref;
  if (on('pb4') && irFoes(g).length) for (const o of out) if (/smoke/.test(o.why || '')) { const ir = view.enemies.filter(e => !e.remote && dist(e, me) <= 10 && (e.ir || unitOf(g, e.id)?.character === 'recon')); if (ir.length) { o.score -= 12; pb('pb4:smokeThrowDown'); } }
  if (!on('pb3')) return out;
  const camo = camoActive(p), canCamo = ready(me, 'camouflage');
  if (!camo && !canCamo) return out;
  if (me.hp < me.maxHp * .35) return out;
  for (const e of view.enemies) {
    if (e.civilian || e.remote || dist(e, me) > 4) continue;
    const plan = tenchuPlan(g, p, e.id); if (plan.reason) continue;
    const w = g.weaponAt(plan.slot); if (!w?.melee) continue;
    const dmg = g.weaponDamage(plan.slot, e.ref), pierce = w.pierce || 0;
    const avg = Math.max(1, ((dmg.min + dmg.max) / 2 - (e.armor || 0) * (1 - pierce)));
    const amb = ambushReady(g, e.ref) ? ambushMultiplier(p) : 1;
    const exp = .99 * avg * MELEE_TUNING.camoMelee * amb * (w.hits || 1);
    const u = unitOf(g, e.id), recon = u?.character === 'recon', drone = e.ref?.pvpAlly != null;
    const kill = exp >= e.hp;
    let score = PB_TUNING.tenchu + 30 * Math.min(1, exp / Math.max(1, e.hp)) + (kill ? 25 : 0) + (recon ? PB_TUNING.tenchuRecon : 0) - (drone ? 25 : 0);
    // 落地的格子：打得到我的人越多越危險（迷彩：命中 −30）
    const land = plan.point, around = view.enemies.filter(x => !x.remote && x !== e && !x.melee && dist(x, land) <= (x.range || 5) && lineOpen(g, x.ref || x, land)).length;
    score -= around * (camo || canCamo ? 3 : 6);
    const strike = {type: 'hookBlade', arg: {id: e.id, slot: plan.slot}, target: e.id, attack: true, enemy: e.id, kill: kill ? .9 : .2, score, pbTenchu: {recon, cls: u?.character || 'drone'}, why: `pb3 tenchu ${u?.character || 'drone'} exp${exp.toFixed(0)}/${e.hp}`};
    out.push(camo ? strike : {type: 'skill', arg: 'camouflage', score, then: {type: 'hookBlade', arg: strike.arg, target: e.id}, target: e.id, attack: true, enemy: e.id, pbTenchu: strike.pbTenchu, why: 'pb3 camo+' + strike.why});
  }
  return out;
}
const tenchuLineOk = (g, a, b) => lineOfSight(g.grid, a, b, g.barriers, 'sight');
// 天誅距離外：往偵察兵（優先）或集火目標繞過去，避開偵察兵看得到的格子
export function ninjaApproach(view, bot, opts) {
  if (!on('pb3')) return;
  const g = bot.g, me = view.me; if (me.anchored || me.pinned || me.hp < me.maxHp * .5) return;
  if (!camoActive(me.ref) && !ready(me, 'camouflage')) return;
  if (opts.some(o => o.pbTenchu)) return;
  // 目標：偵察兵優先，再來是集火目標、最近的人（天誅距離 4：摸到 4 格內、刀索拉得到的地方）
  const rs = reconState(g, bot.team), mem = [...bot.team.memory.values()].filter(r => !r.ally && g.turn - r.turn <= 2);
  const tgt = rs.known.sort((a, b) => dist(a, me) - dist(b, me))[0] || mem.find(r => r.id === bot.team.focus) || mem.sort((a, b) => dist(a, me) - dist(b, me))[0];
  if (!tgt || dist(tgt, me) > 12 || dist(tgt, me) <= 4) return;
  const r = sneakRoute(view, bot, tgt, 4, q => tenchuLineOk(g, q, tgt)); if (!r) return;
  pushStep(opts, r, 6, `pb3 sneak ${tgt.cls || ''} ${tgt.x},${tgt.y}`, {pbFlank: true});
}

// ---- pb5 狂戰士 ----
export function berserkerCombat(view, bot, base) {
  const out = base(view, bot) || [], g = bot.g;
  if (!on('pb5')) return out;
  for (const o of out) if (o.type === 'skill' && o.arg === 'grapple') { const u = unitOf(g, o.target); if (u?.character === 'recon') { o.score += PB_TUNING.grappleRecon; o.why += ' +pb5 recon'; o.pbGrappleRecon = true; } }
  return out;
}
// 鉤爪還沒好（或偵察兵在鉤爪距離外）：走進偵察兵的射界扣分
export function berserkerMoves(view, bot, opts) {
  if (!on('pb5')) return;
  const g = bot.g, me = view.me, rs = reconState(g, bot.team); if (!rs.known.length) return;
  const hook = ready(me, 'grapple');
  for (const o of opts) {
    if (o.type !== 'move' || o.target || !o.arg) continue;
    const t = {x: me.x + o.arg[0], y: me.y + o.arg[1]};
    for (const r of rs.known) {
      const inLine = dist(r, t) <= (r.range || 8) && lineOpen(g, r, t), was = dist(r, me) <= (r.range || 8) && lineOpen(g, r, me);
      if (inLine && !was && !(hook && dist(r, t) <= 5)) { o.score -= PB_TUNING.berserkLine; pb('pb5:avoidLine'); }
    }
  }
}

// ---- pb6 迂迴：開闊又亮的格子 ----
const openCache = new WeakMap();
export function openLit(g, q) {
  let c = openCache.get(g); if (!c || c.turn !== g.turn) { c = {turn: g.turn, m: new Map()}; openCache.set(g, c); }
  const k = key(q); if (c.m.has(k)) return c.m.get(k);
  let v = false;
  if (!isDark(g, q) && !(g.pvpTrench?.[q.y]?.[q.x] > 0)) {
    let floor = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (g.grid[q.y + dy]?.[q.x + dx] === 1) floor++;
    const cover = g.props.some(o => (o.type === 'cover' || o.type === 'container') && dist(o, q) <= 1);
    v = floor >= 23 && !cover;
  }
  c.m.set(k, v); return v;
}
export const detourCost = (g, plan) => on('pb6') && reconState(g, plan).hidden ? q => openLit(g, q) ? PB_TUNING.detour : 0 : null;

// ---- pb7 三倍傷害 ----
// 風險判斷（Alan）：對方偵察兵死了才放心拿；還活著就要知道它在哪、而且它看不到中央那一格和它周圍
export function skipPower(g, plan) {
  if (!on('pb7') || !g.pvpPowerAt) return false;
  const rs = reconState(g, plan); if (!rs.alive) return false;
  if (rs.hidden) return true;
  const [x, y] = g.pvpPowerAt, P = {x, y};
  return rs.known.some(r => [P, {x: x + 1, y}, {x: x - 1, y}, {x, y: y + 1}, {x, y: y - 1}].some(q => dist(r, q) <= (r.range || 10) + 1 && lineOpen(g, r, q)));
}

// ---- pb8 自殺無人機伏擊 ----
// 對方會經過的路：對方往我們開場的來路、箱子、中央三倍傷害、最近看到人的地方
export function lanePoints(g, plan, approach) {
  const pts = [...(approach || []).map(t => ({x: t.x, y: t.y, w: 1}))];
  for (const c of g.props.filter(o => o.type === 'container' && String(o.id).startsWith('pvp-crate') && !o.opened)) pts.push({x: c.x, y: c.y, w: 2});
  if (g.pvpPowerAt) pts.push({x: g.pvpPowerAt[0], y: g.pvpPowerAt[1], w: 2});
  for (const r of plan.memory.values()) if (!r.ally && g.turn - r.turn <= 8) pts.push({x: r.x, y: r.y, w: 3});
  return pts;
}
export function munitionAmbush(view, bot, approach) {
  if (!on('pb8')) return null;
  const g = bot.g, p = g.player, i = p.productionLines.findIndex(l => l.blueprint === 'drone_munition'); if (i < 0) return null;
  if ((g.allies || []).some(a => a.sourceId === 'drone_munition' && a.status === 'active' && a.hp > 0)) return null;   // 一次一台
  const plan = bot.team, pts = lanePoints(g, plan, approach), known = [...plan.memory.values()].filter(r => !r.ally && g.turn - r.turn <= 3);
  let best = null;
  for (const c of droneCells(g)) {
    if (deployReason(g, i, c)) continue;
    // 對方看得到的格子：部署那一階段就被打掉
    if (known.some(r => dist(r, c) <= 10 && lineOpen(g, r, c))) continue;
    // 自己人太近（它撞最近看到的對方，爆炸半徑 2 會波及）
    if (plan.members.some(m => m !== p && dist(m, c) <= 2)) continue;
    let v = 0, hot = false; for (const t of pts) { const d = dist(t, c); if (d <= PB_TUNING.munitionLane + 2) v += t.w * (d <= PB_TUNING.munitionLane ? 1 : .4); if (t.w >= 2 && d <= 3) hot = true; }
    if (!hot) continue;   // 只放在剛看到人的地方、箱子、中央附近（光是來路：實測 35 台只炸到 1 次）
    if (v > 0 && (!best || v > best.v)) best = {v, c};
  }
  if (!best || best.v < 3) return null;
  return {type: 'deployUnit', arg: {line: i, x: best.c.x, y: best.c.y}, why: `pb8 munition ambush v${best.v.toFixed(1)}`};
}
// 交火中：部署在 2 步內、4 格內有直線看得到對方的格子（這一階段結束就俯衝爆炸，對方沒有階段打它）；爆炸點附近不能有自己人
export function munitionStrike(view, bot) {
  if (!on('pb8')) return null;
  const g = bot.g, p = g.player, i = p.productionLines.findIndex(l => l.blueprint === 'drone_munition'); if (i < 0) return null;
  const foesSeen = view.enemies.filter(e => !e.civilian && !e.remote && e.ref?.pvpOf != null);
  let best = null;
  for (const c of droneCells(g)) {
    if (deployReason(g, i, c)) continue;
    for (const e of foesSeen) {
      const d = dist(c, e); if (d > 4 || !lineOpen(g, c, e.ref || e)) continue;
      if (plan(bot).members.some(m => dist(m, e) <= 3)) continue;   // 爆炸半徑 2（落在牠旁邊）：自己人留 3 格
      const near = foesSeen.filter(f => dist(f, e) <= 2).length, u = unitOf(g, e.id);
      const v = Math.min(45, e.hp) / Math.max(1, e.hp) * 20 + (e.hp <= 45 ? 20 : 0) + (near - 1) * 15 + (u?.character === 'recon' ? 8 : 0);
      if (!best || v > best.v) best = {v, c, e};
    }
  }
  if (!best) return null;
  return {type: 'deployUnit', arg: {line: i, x: best.c.x, y: best.c.y}, score: PB_TUNING.munition + best.v - stayCost(view) * .5, why: `pb8 munition strike ${best.e.id} v${best.v.toFixed(0)}`};
}
const plan = bot => bot.team;
// 生產線上有自殺無人機：往最近的敵人摸過去（到 5 格內、掩護下），好在轉角後面放
export function engineerSneak(view, bot, opts) {
  if (!on('pb8')) return;
  const g = bot.g, me = view.me, p = me.ref; if (p.productionLines.findIndex(l => l.blueprint === 'drone_munition') < 0 || me.pinned || me.hp < me.maxHp * .5) return;
  if (opts.some(o => /pb8 munition strike/.test(o.why || ''))) return;
  const mem = [...bot.team.memory.values()].filter(r => !r.ally && g.turn - r.turn <= 2).sort((a, b) => dist(a, me) - dist(b, me));
  const t = mem[0]; if (!t || dist(t, me) <= 5 || dist(t, me) > 12) return;
  const r = sneakRoute(view, bot, t, 5); if (!r) return;
  pushStep(opts, r, PB_TUNING.engSneak, `pb8 sneak ${t.x},${t.y}`);
}
// 要不要做自殺無人機：有常駐單位、還有 15 廢料、身上有破片
export function munitionBuild(g) {
  if (!on('pb8')) return null;
  const p = g.player; if (p.productionLines.length || !deployedUnits(g).length) return null;
  if ((p.pbMunitions || 0) >= 2) return null;
  // 留 30 廢料重做跟隨無人機（實測：沒留的版本對 alpha 勝率 30%，完全不做 45%）
  if ((p.scrap || 0) >= 45 && (p.grenades || 0) >= 1 && !buildReason(g, 'drone_munition', 'frag')) { return {blueprint: 'drone_munition', payload: 'frag'}; }
  return null;
}

// ---- 效果統計：每次攻擊打掉多少（目標：標到的、偵察兵；手段：天誅、鉤爪） ----
export function attackStats(g, intent, before) {
  for (const [e, hp0] of before) {
    const d = hp0 - Math.max(0, e.hp); if (d <= 0) continue;
    const cls = e.pvpCls || (e.pvpAlly != null ? 'drone' : '?');
    if (e.pbMarked) { pb('pb1:dmgOnMarked', d); pb('pb1:hitsOnMarked'); if (e.hp <= 0) pb('pb1:killMarked'); }
    if (intent.type === 'hookBlade' || intent.then?.type === 'hookBlade') { pb('pb3:tenchuDmg', d); if (e.hp <= 0) pb('pb3:tenchuKill'); if (cls === 'recon') pb('pb3:tenchuReconDmg', d); }
    if (intent.type === 'skill' && intent.arg === 'grapple') { pb(`pb5:grappleDmg:${cls === 'recon' ? 'recon' : 'other'}`, d); if (e.hp <= 0) pb('pb5:grappleKill'); }
    if (cls === 'recon') pb('dmgOnRecon', d);
  }
}

// ---- ov 交互掩護前進：每個人照整隊的分工調分數（交火中） ----
export function overwatchScores(view, bot, opts) {
  const b = bot.team?.bound, me = view.me, g = bot.g; if (!b) return;
  const p = me.ref, near = q => Math.min(...b.known.map(r => dist(q, r)));
  const attacks = opts.filter(o => o.attack || o.type === 'fire' || o.then?.type === 'fire');
  if (b.cover.has(p) || b.hold.has(p)) {
    // 掩護／等待：不往前走；這一階段沒有好打的就待機（已就緒）
    for (const o of opts) if (o.type === 'move' && !o.target && o.arg) { const t = {x: me.x + o.arg[0], y: me.y + o.arg[1]}; if (near(t) < near(me)) { o.score -= PB_TUNING.ovHold; o.why = (o.why || '') + ' -ov'; } }
    if (!attacks.length || Math.max(...attacks.map(o => o.score)) < 0) {
      let w = opts.find(o => o.type === 'wait'); if (!w) { w = {type: 'wait', score: 0, why: 'ov'}; opts.push(w); }
      w.score += PB_TUNING.ovWait; w.why = `ov ${b.cover.has(p) ? 'cover' : 'hold'} wait`;
    }
  } else if (b.advance.has(p) && !me.anchored && !me.pinned && me.hp >= me.maxHp * .4) {
    const tgt = b.known.reduce((a, r) => dist(r, me) < dist(a, me) ? r : a);
    const range = Math.max(2, Math.min(me.held?.melee ? 1 : (me.held?.range || 6), 8) - 1);
    if (dist(tgt, me) > range) { const r = sneakRoute(view, bot, tgt, range, q => lineOpen(g, q, tgt), 30); if (r) pushStep(opts, r, PB_TUNING.ovAdvance, `ov advance ${tgt.x},${tgt.y}`); }
  }
}
// 沒看到人（但剛剛有）：掩護的人待機守住射線，等待的人原地等，前進的人照原本的目標走
export function overwatchQuiet(view, bot) {
  const b = bot.team?.bound, p = view.me.ref; if (!b) return null;
  if (b.cover.has(p)) return {type: 'wait', why: 'ov overwatch'};
  if (b.hold.has(p)) return {type: 'wait', why: 'ov hold'};
  return null;
}
