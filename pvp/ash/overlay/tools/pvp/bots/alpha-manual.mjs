// alpha 的「打法手冊」（Alan 2026-10-16，pvp/DESIGN.md）：八條各一個開關（ALPHA_M1..ALPHA_M8=0 關掉，只給實驗用），統計在 MS。
// 1 士兵預警：懷疑對方偵察兵在暗處／被看不到的人打到時開 early_warning（免費）；標到的人寫進全隊敵情（位置準），全隊集火被標的人。
//   標記（exposed）只到對方自己的階段結束（PVP 的特性在本人那一隊的世界推進時倒數），所以只對士兵之後才動的隊友有用。
// 2 重裝兵只在戰壕裡（pvpTrench>0）、或面前每個射得到它的對方都隔著掩體時才下錨；開闊地不下錨。
// 3 忍者反偵察兵：4 格內（天誅的距離 HOOK_BLADE_RANGE）有天誅打得到的人就開迷彩（免費）、同一個階段接著天誅；偵察兵優先。
//   ClearBot 原本「6 格內有射手就開迷彩」關掉（迷彩冷卻 10，先開了天誅時就沒了），只留貼身時開。偵察兵在視野內、還不到 4 格：往它 4 格內、它看不到的格子靠。
// 4 偵察兵有紅外線、夜視：對方偵察兵活著時，迂迴路線的成本裡全黑的開闊格不打折；忍者不把黑暗當近戰的理由、對偵察兵不丟腳下的煙。
// 5 狂戰士的鉤爪優先拉偵察兵；偵察兵看得到、但還拉不到（5 格外）的格子扣分（不先暴露在它的射界）。
// 6 對方偵察兵活著、位置不明（2 個 turn 內沒人看到）：走路的成本加上「開闊、亮」（迂迴）。
// 7 三倍傷害：對方偵察兵活著、位置不明時不派人去撿。
// 8 自殺無人機：只當伏擊——部署在對方會經過的地方（對方的來路、箱子、中央），對方看不到的格子，不直接派去撞人。
import {distance} from '../../../src/world.js';
import {isBlack, isDark} from '../../../src/lighting.js';
import {activeTrait} from '../../../src/traits.js';
import {skillActive} from '../../../src/skills.js';
import {coverEffects} from '../../../src/cover.js';
import {camoActive, HOOK_BLADE_RANGE} from '../../../src/melee-classes.js';
import {WEAPONS} from '../../../src/data.js';

const on = k => process.env['ALPHA_M' + k] !== '0';
export const MT = {ew: on(1), anchor: on(2), ninja: on(3), ir: on(4), grab: on(5), detour: on(6), power: on(7), ambush: on(8),
  hunt: process.env.ALPHA_MHUNT !== '0', ow: process.env.ALPHA_MOW !== '0', stale: process.env.ALPHA_MSTALE === '1', prePlace: process.env.ALPHA_MPRE === '1', detourW: +(process.env.ALPHA_MDW ?? 3), focusMark: +(process.env.ALPHA_MFOCUS ?? 15), grabBonus: +(process.env.ALPHA_MGRAB ?? 25)};
export const MS = {};
export const tick = (k, n = 1) => { MS[k] = (MS[k] || 0) + n; };
if (process.env.ALPHA_REPORT) process.on('exit', () => console.error('ALPHA_STATS ' + JSON.stringify(MS)));

export const realOf = (g, f) => { const id = f?.ref?.pvpOf ?? f?.pvpOf ?? (String(f?.id).startsWith('px-') ? String(f.id).slice(3) : null); return id != null ? g.unit(id) : null; };
const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// ---- 對方的偵察兵 ----
export function foeRecon(bot) { const g = bot.g; return g.alive(g.other(bot.side())).find(m => m.character === 'recon') || null; }
// 偵察兵的位置：這個 turn 我看得到、或全隊情報 2 個 turn 內看過 → {x,y}；不然 null（位置不明）
export function reconSpot(bot, view) {
  const r = foeRecon(bot); if (!r) return null;
  const id = `px-${r.squadId}`, g = bot.g;
  const e = view.enemies.find(x => x.id === id); if (e) return {x: e.x, y: e.y, fresh: true};
  const v = bot.intel?.().get(id); if (v && g.turn - v.turn <= 2) return {x: v.x, y: v.y};
  return null;
}
export const reconUnknown = (bot, view) => !!foeRecon(bot) && !reconSpot(bot, view);

// 這個 turn 前後我方有人被「看不到的人」打到（戰報 events 的 byVisible）
function hitUnseen(bot) {
  const g = bot.g, side = bot.side(), ev = g.pvp.events || [];
  for (let i = ev.length - 1; i >= 0 && i >= ev.length - 30; i--) {
    const e = ev[i]; if (g.pvp.round - e.round > 1) break;
    const m = g.unit(e.target); if (m?.pvpSide === side && !e.byVisible && e.dmg > 0) return true;
  }
  return false;
}
const ready = (me, id) => Boolean(me.skills?.[id]) && me.prepared?.skill === id && !me.skills[id].remaining && !me.skills[id].cooldown;

// ---- 1 士兵預警 ----
export function soldierIntent(bot, view, hostile, known) {
  if (!MT.ew) return null;
  const g = bot.g, me = view.me, p = g.player;
  if (p.character !== 'soldier' || !ready(me, 'early_warning')) return null;
  const R = 8, unk = reconUnknown(bot, view);
  const near = [...hostile, ...known].some(f => distance(f, me) <= R + 2);
  const unseen = hitUnseen(bot);
  // 對方偵察兵位置不明：被看不到的人打到、或附近有已知的對方（接觸中）就掃；看得到的人在 8 格內也掃（集火加成）
  const why = unseen ? 'unseen fire' : unk && reconNear(bot, view) ? 'recon near' : unk && near ? 'recon hidden' : hostile.some(e => distance(e, me) <= R) ? 'contact' : null;
  if (!why) return null;
  tick('ew.' + why.replace(' ', '_'));
  return {type: 'skill', arg: 'early_warning', why: `alpha manual early warning (${why})`, manual: 'ew'};
}
// 預警之後：被標的人（exposed、source skill:early_warning）寫進全隊情報（這個 turn、位置準）
export function afterWarning(bot) {
  const g = bot.g, I = bot.intel();
  let n = 0, rc = 0;
  for (const e of g.enemies) {
    if (e.hp <= 0 || e.pvpOf == null || !(e.traits || []).some(t => t.id === 'exposed' && t.source === 'skill:early_warning')) continue;
    n++; const m = g.unit(e.pvpOf); if (m?.character === 'recon') rc++;
    const w = m && WEAPONS[m.weaponBases?.[m.weapon]];
    if (MT.ew) I.set(e.id, {id: e.id, type: e.type, x: e.x, y: e.y, turn: g.turn, hp: e.hp, range: w?.melee ? 1 : (w?.range || 6), melee: !!w?.melee, damage: w ? (w.min + w.max) / 2 * (w.burst || 1) : 20, marked: true});
  }
  tick('ew.used'); tick('ew.marked', n); tick('ew.markedRecon', rc);
}
export const marked = e => (e?.ref?.traits || e?.traits || []).some(t => t.id === 'exposed');

// ---- 2 重裝兵下錨 ----
// 在這裡下錨安不安全：戰壕裡，或每個射得到這一格的對方（看得到的、情報）都隔著掩體
// 第二輪（Alan 2026-10-16）：全深戰壕（D=2）＝實牆；D=1 是半掩護、不下錨；不在戰壕就要每個射得到的對方都隔著實牆級的掩體（命中 −42）
export function anchorSpot(bot, view, foes, at = view.me) {
  const g = bot.g, me = {...view.me, x: at.x, y: at.y}, D = g.trenchAt?.(me.x, me.y) || 0;
  if (D >= 2) return 'trench2';
  let open = 0, half = 0, shooters = 0;
  for (const f of foes) {
    if (f.melee) continue;
    const d = distance(f, me); if (d > (f.range || 8) + 1) continue;
    const a = {x: f.x, y: f.y}, b = {x: me.x, y: me.y};
    if (!g.sight(a, b) || !g.shotClear(a, b)) continue;
    shooters++;
    const ref = g.enemies.find(e => e.id === f.id) || f;
    const cover = g.protectingCover({x: me.x, y: me.y, traits: me.ref.traits}, ref), fx = coverEffects(cover, me, f);
    if (!(fx.efficiency > 0)) open++; else if (fx.penalty < 40) half++;
  }
  return open ? 'open' : half ? 'half' : shooters ? 'wall' : D ? 'trench1' : 'unseen';
}
export const anchorOK = spot => spot === 'trench2' || spot === 'wall' || spot === 'unseen';

// ---- 第二輪：走位工具 ----
// 從 from 出發的走路成本（Dijkstra，小整數成本）：edge(a,b) 額外成本、cell(q) 額外成本；不穿過活著的人
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export function walkField(bot, from, {maxCost = 30, cell = null, edge = null} = {}) {
  const g = bot.g, N = g.grid.length, D = new Map(), prev = new Map(), k = q => q.y * 256 + q.x;
  const busy = new Set([...g.sides.A, ...g.sides.B].filter(u => u.hp > 0 && !(u.x === from.x && u.y === from.y)).map(k));
  for (const e of g.enemies) if (e.hp > 0) busy.add(k(e));
  for (const a of g.allies || []) if (a.hp > 0) busy.add(k(a));
  const buckets = [[{x: from.x, y: from.y}]]; D.set(k(from), 0);
  for (let c = 0; c < buckets.length && c <= maxCost; c++) for (const q of buckets[c] || []) {
    if (D.get(k(q)) < c) continue;
    for (const [dx, dy] of D4) {
      const n = {x: q.x + dx, y: q.y + dy}, kn = k(n);
      if (n.x < 0 || n.y < 0 || n.x >= N || n.y >= N || g.grid[n.y]?.[n.x] !== 1 || !g.seen?.[n.y]?.[n.x] || busy.has(kn) || !g.passable(n.x, n.y) || !g.canCross(q, n)) continue;
      const ex = (edge ? edge(q, n) : 0) + (cell ? cell(n) : 0); if (!Number.isFinite(ex)) continue;
      const nc = c + 1 + Math.max(0, Math.round(ex));
      if (D.has(kn) && D.get(kn) <= nc) continue;
      D.set(kn, nc); prev.set(kn, q); (buckets[nc] ||= []).push(n);
    }
  }
  return {D, prev, key: k, from};
}
// 到 goal 那一格的第一步 [dx,dy]
export function firstStep(F, goal) {
  let cur = goal, k = F.key(cur), guard = 0;
  if (!F.D.has(k)) return null;
  while (guard++ < 999) { const p = F.prev.get(k); if (!p) return null; if (p.x === F.from.x && p.y === F.from.y) return [cur.x - p.x, cur.y - p.y]; cur = p; k = F.key(cur); }
  return null;
}
// 戰壕的跳進跳出（深度差 2）：被打 +20、壓制 +3 → 走 D=1 的台階
export const trenchEdge = g => (a, b) => Math.abs((g.trenchAt?.(a.x, a.y) || 0) - (g.trenchAt?.(b.x, b.y) || 0)) >= 2 ? 8 : 0;
// q 這一格被多少已知的射手看到（射程內）
export function exposureFn(bot, foes) {
  const g = bot.g, memo = new Map(), shooters = foes.filter(f => !f.melee);
  return q => { const k = q.y * 256 + q.x; let v = memo.get(k); if (v === undefined) { v = 0; for (const f of shooters) if (distance(f, q) <= (f.range || 8) + 1 && g.sight({x: f.x, y: f.y}, q)) v++; memo.set(k, v); } return v; };
}
// 對方偵察兵最後出現的位置（一隊一份，任何人看到就更新）
const RMEMO = new WeakMap();
export function reconLast(bot, view) {
  const g = bot.g, r = foeRecon(bot); if (!r) return null;
  let t = RMEMO.get(g); if (!t) { t = {}; RMEMO.set(g, t); }
  const now = reconSpot(bot, view); if (now) t[bot.side()] = {x: now.x, y: now.y, turn: g.turn};
  return t[bot.side()] || null;
}

// ---- 3 忍者天誅 ----
// 每個打得到的人：迷彩假裝開著，問 hookBladePlan（純函式）
function hookTargets(bot, view, hostile) {
  const g = bot.g, p = g.player, st = p.skillState?.camouflage; if (!st) return [];
  const keep = st.remaining, out = [];
  try {
    if (!camoActive(p)) st.remaining = 1;
    for (const e of hostile) {
      if (!e.ref || e.remote || distance(e, p) > HOOK_BLADE_RANGE) continue;
      const plan = g.hookBladePlan(e.id); if (plan.reason) continue;
      const m = realOf(g, e), w = g.weaponAt(plan.slot), dmg = g.weaponDamage(plan.slot, e.ref);
      const exp = (dmg.min + dmg.max) / 2 * (w.hits || 1) * 1.5 * (m?.pvpPower ? 1 : 1);
      const kill = exp >= e.hp ? 1 : 0;
      const s = (m?.character === 'recon' ? 100 : 0) + kill * 60 + Math.min(exp, e.hp) - (m?.character === 'bulwark' ? 30 : 0);
      out.push({e, plan, s, m});
    }
  } finally { st.remaining = keep; }
  return out.sort((a, b) => b.s - a.s);
}
export function ninjaIntent(bot, view, hostile) {
  if (!MT.ninja) return null;
  const g = bot.g, p = g.player, me = view.me;
  if (p.character !== 'ninja' || me.pinned) return null;
  const T = hookTargets(bot, view, hostile);
  if (T.length) {
    const t = T[0];
    if (camoActive(p)) return {type: 'hookBlade', arg: {id: t.e.id, slot: t.plan.slot}, target: t.e.id, why: `alpha manual tenchu ${t.m?.character}`, manual: 'tenchu', victim: t.m?.character};
    if (ready(me, 'camouflage')) return {type: 'skill', arg: 'camouflage', why: `alpha manual camo → tenchu ${t.m?.character}`, manual: 'camo'};
  }
  return null;
}
// 忍者靠近偵察兵：偵察兵看得到、4 格外 → 往它 4 格內、它看不到的格子（move 選項加分）
export function ninjaApproach(bot, view, opts) {
  if (!MT.ninja) return;
  const g = bot.g, p = g.player, me = view.me; if (p.character !== 'ninja' || !ready(me, 'camouflage') && !camoActive(p)) return;
  const r = reconSpot(bot, view); if (!r || distance(r, me) <= HOOK_BLADE_RANGE || distance(r, me) > 9) return;
  for (const o of opts) if (o.type === 'move' && !o.target && Array.isArray(o.arg)) {
    const to = {x: me.x + o.arg[0], y: me.y + o.arg[1]}, seen = g.sight({x: r.x, y: r.y}, to);
    o.score += (distance(to, r) < distance(me, r) ? 6 : 0) + (seen ? -8 : 6);
  }
}

// ---- 6（＋4）迂迴：開闊、亮的格子加成本 ----
export function openness(g, q) {
  let n = 0; for (const [dx, dy] of D8) { const x = q.x + dx, y = q.y + dy; if (g.grid[y]?.[x] === 1 && !g.solid(x, y)) n++; }
  return n;
}
export function exposedCost(bot, q, reconAlive) {
  const g = bot.g, o = openness(g, q); if (o < 7) return 0;
  const blk = isBlack(g, q);
  // 4：對方有偵察兵（夜視、紅外線），全黑也藏不住
  if (blk && reconAlive) { if (MT.ir) { tick('ir.blackDenied'); return MT.detourW; } return MT.detourW * .3; }
  if (blk) return MT.detourW * .3;
  return isDark(g, q) ? MT.detourW * .7 : MT.detourW;
}
export function detourCost(bot, view) {
  if (!MT.detour || !reconUnknown(bot, view)) return null;
  const memo = new Map();
  return q => { const k = q.x + ',' + q.y; let v = memo.get(k); if (v === undefined) { v = exposedCost(bot, q, true); memo.set(k, v); } return v; };
}

// ---- 第二輪：士兵摸近偵察兵（Alan：預警半徑 8，要繞掩護摸到 8 格內再開）----
export function soldierHunt(bot, view, hostile, known) {
  if (!MT.ew || !MT.hunt || process.env.ALPHA_MHS === '0') return null;
  const g = bot.g, p = g.player, me = view.me;
  if (p.character !== 'soldier' || !ready(me, 'early_warning') || me.hp < me.maxHp * .5 || me.pinned) return null;
  if (hostile.some(e => distance(e, me) <= 8)) return null;
  const r = reconLast(bot, view); if (!r || g.turn - r.turn > 12 || distance(r, me) <= 7) return null;
  if (distance(r, me) > 22) return null;
  const foes = [...hostile, ...known], ex = exposureFn(bot, foes);
  const F = walkField(bot, me, {maxCost: 30, cell: q => ex(q) * 4, edge: trenchEdge(g)});
  let best = null;
  for (const [k, c] of F.D) { const q = {x: k % 256, y: Math.floor(k / 256)}; if (distance(q, r) > 7) continue; const s = c + ex(q) * 6; if (!best || s < best.s) best = {s, q}; }
  if (!best) return null;
  const st = firstStep(F, best.q); if (!st) return null;
  tick('ew.huntStep');
  return {type: 'move', arg: st, walk: true, why: `alpha manual soldier hunts recon ${r.x},${r.y}`};
}
// 偵察兵最後的位置在 8 格內、位置不明：開預警（soldierIntent 用）
export function reconNear(bot, view, R = 8) { const r = reconLast(bot, view); return !!r && bot.g.turn - r.turn <= 12 && distance(r, view.me) <= R; }

// ---- 第二輪：忍者靠掩護、轉角摸到 4 格內（天誅）----
import {tenchuLine} from '../../../src/melee-classes.js';
export function ninjaHunt(bot, view, hostile, known) {
  if (!MT.ninja || !MT.hunt || process.env.ALPHA_MHN === '0') return null;
  const g = bot.g, p = g.player, me = view.me;
  if (p.character !== 'ninja' || me.pinned || me.hp < me.maxHp * .45) return null;
  if (!ready(me, 'camouflage') && !camoActive(p)) return null;
  const foes = [...hostile, ...known], cands = [];
  for (const f of foes) { const d = distance(f, me); if (d <= HOOK_BLADE_RANGE || d > 10) continue; const m = realOf(g, f); cands.push({f, m, s: d - (m?.character === 'recon' ? 6 : 0) + (m?.character === 'bulwark' ? 3 : 0)}); }
  const r = reconLast(bot, view); if (r && g.turn - r.turn <= 6 && distance(r, me) > HOOK_BLADE_RANGE && distance(r, me) <= 12 && !cands.some(c => c.m?.character === 'recon')) cands.push({f: r, m: foeRecon(bot), s: distance(r, me) - 6});
  if (!cands.length) return null;
  const t = cands.sort((a, b) => a.s - b.s)[0], T = {x: t.f.x, y: t.f.y};
  const ex = exposureFn(bot, foes);
  const F = walkField(bot, me, {maxCost: 16, cell: q => ex(q) * 3, edge: trenchEdge(g)});
  let best = null;
  for (const [k, c] of F.D) { const q = {x: k % 256, y: Math.floor(k / 256)}; const d = distance(q, T); if (d > HOOK_BLADE_RANGE || d < 2 || !tenchuLine(g, q, T)) continue; const s = c + ex(q) * 5; if (!best || s < best.s) best = {s, q}; }
  if (!best) return null;
  const st = firstStep(F, best.q); if (!st) return null;
  tick('ninja.huntStep'); if (t.m?.character === 'recon') tick('ninja.huntRecon');
  return {type: 'move', arg: st, walk: true, why: `alpha manual ninja stalks ${t.m?.character} ${T.x},${T.y}`};
}

// ---- 第二輪：重裝兵找全深戰壕（D=2）下錨，從 D=1 的台階進去 ----
export function bulwarkTrench(bot, view, hostile, known) {
  if (!MT.anchor || !MT.hunt || process.env.ALPHA_MHB !== '1') return null;   // 預設關：循環賽量過，主動去找戰壕讓勝率掉 ~6 點（ALPHA_MHB=1 開）
  const g = bot.g, p = g.player, me = view.me;
  if (p.character !== 'bulwark' || me.anchored || me.pinned || !me.skills?.anchor || me.prepared?.skill !== 'anchor') return null;
  const foes = [...hostile, ...known].filter(f => !f.melee), w = me.held; if (!foes.length || !w || w.melee) return null;
  const range = w.range || 7;
  const D = g.trenchAt?.(me.x, me.y) || 0;
  // 已經在 D=2：有人在射程內、看得到 → 下錨
  if (D >= 2 && ready(me, 'anchor') && hostile.some(e => !e.remote && distance(e, me) <= range && g.sight(me, e.ref || e))) { tick('anchor.forceTrench2'); return {type: 'skill', arg: 'anchor', why: 'alpha manual anchor in full trench'}; }
  if (D >= 2) return null;
  if (hostile.some(e => distance(e, me) <= 3)) return null;
  const ex = exposureFn(bot, foes);
  const F = walkField(bot, me, {maxCost: 10, cell: q => ex(q) * 2, edge: trenchEdge(g)});
  let best = null;
  for (const [k, c] of F.D) {
    const q = {x: k % 256, y: Math.floor(k / 256)}; if ((g.trenchAt?.(q.x, q.y) || 0) < 2) continue;
    if (!foes.some(f => distance(f, q) <= range && g.sight(q, {x: f.x, y: f.y}))) continue;
    if (!best || c < best.c) best = {c, q};
  }
  if (!best) return null;
  const st = firstStep(F, best.q); if (!st) return null;
  tick('anchor.seekTrench');
  return {type: 'move', arg: st, walk: true, why: `alpha manual bulwark to trench ${best.q.x},${best.q.y}`};
}
// 三倍傷害有風險：對方偵察兵活著，除非知道它在哪、而且它看不到三倍傷害那一格（和旁邊）
export function powerRisky(bot, view) {
  if (!MT.power || !foeRecon(bot)) return false;
  const g = bot.g, pw = g.items.find(i => i.type === 'pvp_power'); if (!pw) return false;
  const r = reconSpot(bot, view); if (!r) return true;
  for (const [dx, dy] of [[0, 0], ...D4]) { const q = {x: pw.x + dx, y: pw.y + dy}; if (g.grid[q.y]?.[q.x] === 1 && g.sight({x: r.x, y: r.y}, q)) return true; }
  return false;
}

// ---- 第二輪（Alan）：交互掩護前進（照 ASH 的忠誠派小隊長：打得到的掩護、打不到的前進，一次最多一半的人前進，沒視線的先走）----
// 一隊一份、每個階段重算：movers＝這個階段已經前進的人。我打得到（自己看得到、射程內、射線通）→ 交給一般戰鬥（掩護＝開火或待機已就緒）。
// 打不到：前進名額（隊上活人的一半，進位）還有 → 走向「有掩護、打得到人」的格子（路上少被看到）；名額滿了 → 原地待機（已就緒，等對方走進射線）。
const OW = new WeakMap();
export function overwatch(bot, view, hostile, known) {
  if (!MT.ow) return null;
  const g = bot.g, p = g.player, me = view.me, w = me.held, side = bot.side();
  if (!w || w.melee || view.meleeMode || me.pinned || me.anchored) return null;
  if (['ninja', 'berserker'].includes(p.character)) return null;
  const foes = [...hostile, ...known].filter(f => distance(f, me) <= 12); if (!foes.length) return null;
  // 自己看得到對方（含隊友這個階段看到的）時交給 ClearBot 的戰鬥（接近、退後、守點）；這裡只管「看不到人、但知道人在哪」
  if (hostile.length) return null;
  const canShoot = hostile.some(e => !e.remote && distance(e, me) <= w.range && g.sight(me, e.ref || e) && g.shotClear(me, e.ref || e));
  if (canShoot) { tick('ow.cover'); return null; }
  let S = OW.get(g); if (!S) { S = {}; OW.set(g, S); }
  let st = S[side]; if (!st || st.turn !== g.turn) st = S[side] = {turn: g.turn, movers: new Set()};
  const n = g.alive(side).length, quota = Math.ceil(n / 2);
  const ex = exposureFn(bot, foes);
  if (st.movers.size >= quota) {
    if (ex(me) || bot.isRefused({type: 'wait'})) return null;   // 這裡會被看到就不硬守
    tick('ow.hold'); return {type: 'wait', why: 'alpha overwatch hold (bounding: others advance)'};
  }
  const F = walkField(bot, me, {maxCost: 10, cell: q => ex(q) * 3, edge: trenchEdge(g)});
  let best = null;
  for (const [k, c] of F.D) {
    if (c === 0) continue;
    const q = {x: k % 256, y: Math.floor(k / 256)};
    let shot = 0, cov = 0;
    for (const f of foes) {
      if (f.melee || distance(f, q) > w.range) continue;
      const a = {x: q.x, y: q.y}, b = {x: f.x, y: f.y}; if (!g.sight(a, b) || !g.shotClear(a, b)) continue;
      shot++;
      const ref = g.enemies.find(e => e.id === f.id) || f, fx = coverEffects(g.protectingCover({x: q.x, y: q.y, traits: me.ref.traits}, ref), q, f);
      if (fx.efficiency >= .5) cov++;
    }
    if (!shot || cov < shot || ex(q) > cov) continue;   // 只去每個打得到的人都隔著掩護的格子
    const s = c - (shot === 1 ? 2 : 0);
    if (!best || s < best.s) best = {s, q};
  }
  if (!best) return null;
  const step = firstStep(F, best.q); if (!step) return null;
  st.movers.add(p.squadId); tick('ow.advance');
  return {type: 'move', arg: step, walk: true, why: `alpha bounding advance → ${best.q.x},${best.q.y}`};
}
