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
  detourW: +(process.env.ALPHA_MDW ?? 3), focusMark: +(process.env.ALPHA_MFOCUS ?? 15), grabBonus: +(process.env.ALPHA_MGRAB ?? 25)};
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
  const why = unseen ? 'unseen fire' : unk && near ? 'recon hidden' : hostile.some(e => distance(e, me) <= R) ? 'contact' : null;
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
export function anchorSpot(bot, view, foes) {
  const g = bot.g, me = view.me;
  if ((g.trenchAt?.(me.x, me.y) || 0) > 0) return 'trench';
  let open = 0, shooters = 0;
  for (const f of foes) {
    if (f.melee) continue;
    const d = distance(f, me); if (d > (f.range || 8) + 1) continue;
    const a = {x: f.x, y: f.y}, b = {x: me.x, y: me.y};
    if (!g.sight(a, b) || !g.shotClear(a, b)) continue;
    shooters++;
    const ref = g.enemies.find(e => e.id === f.id) || f;
    const cover = g.protectingCover({x: me.x, y: me.y, traits: me.ref.traits}, ref), fx = coverEffects(cover, me, f);
    if (!(fx.efficiency > 0)) open++;
  }
  return open ? 'open' : shooters ? 'cover' : 'unseen';
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
