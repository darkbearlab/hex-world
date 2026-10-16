// alpha 的工兵（職業加強提案：工兵開場 60 廢料，2026-10-16）。ClearBot 的工兵只做跟隨無人機（classes/engineer.mjs 的 buildChoice）；
// 這裡照局面選種類（src/workshop.js 的 UNIT_BLUEPRINTS；生產線 1 條、同時部署 1 台，自殺無人機不佔部署上限）：
// - 自殺無人機（drone_munition，15 廢料＋1 顆破片當彈頭）：知道的對方裡有下錨的重裝兵、或兩個人擠在 2 格內、或在守點不動的對方，
//   而且在 10 格內——做一台，部署在最靠近他的格子（它自己看到 8 格內的人就飛過去，4 格內俯衝爆炸）。
// - 定點砲台（drone_sentry，30）：交戰中（知道對方在哪）而且場上沒有自己的無人機：做砲台，部署在看得到最多對方位置、最好全黑的格子。
// - 其他：跟隨無人機（drone_follow，30）。
// 統計在 ENG_STATS（做了幾台、部署幾台）。
// 打法手冊 8（2026-10-16）：自殺無人機只當伏擊（MT.ambush）：一開始就做一台（有破片），帶著走；
//   走到對方會經過的地方（對方開場→中央、對方開場→我方、已知的對方→我方的連線、還沒開的箱子、中央的三倍傷害）2 格內、
//   已知的對方看不到的格子才部署（全黑加分）；不再對著看得到的人部署（不直接派去撞）。
import {buildReason, deployReason, deployedUnits, UNIT_BLUEPRINTS} from '../../../src/workshop.js';
import {droneCells} from '../../../src/allies.js';
import {skillActive} from '../../../src/skills.js';
import {isBlack} from '../../../src/lighting.js';
import {distance} from '../../../src/world.js';
import {MT, tick, walkField, firstStep, exposureFn, trenchEdge} from './alpha-manual.mjs';
import {pullLanding} from '../../../src/melee-classes.js';

export const ET = {on: process.env.ALPHA_ENG !== '0', mun: process.env.ALPHA_EMUN !== '0', sentry: process.env.ALPHA_ESENTRY !== '0', munRange: +(process.env.ALPHA_EMRANGE ?? 10), munMin: +(process.env.ALPHA_EMMIN ?? 3)};
// 自殺無人機部署的那一個 turn 不行動（bornTurn），要撐過對方整個階段才飛得出去：量過只對不動的目標（下錨的重裝兵，munMin 3）才划算
export const ENG_STATS = {built: {}, deployed: {}};
const realOf = (g, f) => { const id = f.ref?.pvpOf ?? f.pvpOf ?? (String(f.id).startsWith('px-') ? String(f.id).slice(3) : null); return id ? g.unit(id) : null; };

// 自殺無人機的目標：下錨的重裝兵、擠在一起的人、待著不動的
function munitionTarget(g, me, foes) {
  let best = null;
  for (const f of foes) {
    const d = distance(f, me); if (d > ET.munRange) continue;
    const m = realOf(g, f); if (!m || m.hp <= 0) continue;
    const pack = foes.filter(o => o !== f && distance(o, f) <= 2).length;
    let s = 0;
    if (m.character === 'bulwark' && skillActive(m, 'anchor')) s += 3;
    if (pack) s += 2 * pack;
    if (m.pvpGuard || m.guard) s += 1;
    if (s < ET.munMin) continue;
    s -= d * .1;
    if (!best || s > best.s) best = {s, f};
  }
  return best?.f || null;
}

// 回傳意圖或 null（null 時照 ClearBot 的工兵）
export function engineerIntent(bot, view, hostile, known) {
  if (!ET.on) return null;
  const g = bot.g, p = g.player; if (p.character !== 'engineer' || !Array.isArray(p.productionLines)) return null;
  const foes = [...hostile, ...known];
  const lines = p.productionLines, out = deployedUnits(g).length;
  // 部署
  for (let line = 0; line < lines.length; line++) {
    const bp = lines[line].blueprint;
    if (bp === 'drone_munition' && MT.ambush) {
      // 第二輪（部署當階段就會行動）：2 步內有一格離對方 4 格內、直線沒擋 → 部署，階段結束就俯衝
      const st = strikeCell(bot);
      if (st && !deployReason(g, line, st)) { tick('mun.strike'); if (st.hidden) tick('mun.strikeHidden'); return tag({type: 'deployUnit', arg: {line, x: st.x, y: st.y}, why: `alpha munition strike ${st.who} from ${st.x},${st.y}`, ambush: true}, bp, 'deployed'); }
      const ap = MT.hunt && process.env.ALPHA_MHE !== '0' && approachFoe(bot, view, foes); if (ap) return ap;
      if (!MT.prePlace) continue;
      const c = ambushCell(bot, foes);
      if (c && !deployReason(g, line, c)) { tick('mun.deployAmbush'); return tag({type: 'deployUnit', arg: {line, x: c.x, y: c.y}, why: `alpha ambush munition ${c.x},${c.y} d${c.d.toFixed(1)}`, ambush: true}, bp, 'deployed'); }
      continue;
    }
    if (bp === 'drone_munition') {
      // 部署在俯衝得到的地方（4 格內、直線沒擋）：下一個自己的階段就會撞上去；不然留在生產線上等
      let cell = null;
      for (const t of [munitionTarget(g, p, foes), ...foes.slice().sort((a, b) => distance(a, p) - distance(b, p))].filter(Boolean)) {
        const T = {x: t.x, y: t.y};
        cell = droneCells(g).filter(c => distance(c, T) <= 3 && g.sight(c, T) && g.shotClear(c, T)).sort((a, b) => distance(a, T) - distance(b, T))[0];
        if (cell) { cell.t = T; break; }
      }
      const t = cell?.t;
      if (cell && !deployReason(g, line, cell)) return tag({type: 'deployUnit', arg: {line, x: cell.x, y: cell.y}, why: `alpha deploy munition → ${t.x},${t.y}`}, bp, 'deployed');
      continue;
    }
    if (bp === 'drone_sentry') {
      if (deployReason(g, line)) continue;
      // 看得到最多對方位置的格子（全黑加分：沒夜視的看不到它… 機器在黑暗裡照樣被看到，只當小加分）
      let best = null;
      for (const c of droneCells(g)) {
        let s = 0; for (const f of foes) if (distance(c, f) <= 8 && g.sight(c, {x: f.x, y: f.y})) s += 2;
        s += isBlack(g, c) ? .5 : 0;
        if (!best || s > best.s) best = {s, c};
      }
      const arg = best && best.s > 0 ? {line, x: best.c.x, y: best.c.y} : {line};
      if (!deployReason(g, line, best && best.s > 0 ? best.c : null)) return tag({type: 'deployUnit', arg, why: 'alpha deploy sentry'}, bp, 'deployed');
      continue;
    }
    if (!deployReason(g, line)) return tag({type: 'deployUnit', arg: {line}, why: `alpha deploy ${bp}`}, bp, 'deployed');
  }
  // 製造（生產線空著才做）
  if (lines.length) return null;
  if (MT.ambush) {
    const S = munState(g, p);
    if ((p.grenades || 0) >= 1 && S.built < 3 && !hostile.length && !buildReason(g, 'drone_munition', 'frag')) { S.built++; tick('mun.built'); return tag({type: 'buildUnit', arg: {blueprint: 'drone_munition', payload: 'frag'}, why: 'alpha build ambush munition'}, 'drone_munition', 'built'); }
  } else if (ET.mun && (p.grenades || 0) >= 1) {
    const t = munitionTarget(g, p, foes);
    if (t && !buildReason(g, 'drone_munition', 'frag')) return tag({type: 'buildUnit', arg: {blueprint: 'drone_munition', payload: 'frag'}, why: `alpha build munition for ${realOf(g, t)?.character}`}, 'drone_munition', 'built');
  }
  if (out >= 1) return null;   // 場上已有一台（部署上限 1）：留著廢料
  const bp = ET.sentry && foes.length ? 'drone_sentry' : 'drone_follow';
  if (!buildReason(g, bp)) return tag({type: 'buildUnit', arg: {blueprint: bp}, why: `alpha build ${bp}`}, bp, 'built');
  return null;
}
function tag(it, bp, kind) { it.stat = [kind, bp]; return it; }
export function engCount(it) { if (it?.stat) { const [k, bp] = it.stat; ENG_STATS[k][bp] = (ENG_STATS[k][bp] || 0) + 1; } }

// ---- 打法手冊 8：伏擊 ----
const MUN = new WeakMap();
function munState(g, p) { let m = MUN.get(g); if (!m) { m = new Map(); MUN.set(g, m); } let s = m.get(p.squadId); if (!s) { s = {built: 0, ids: new Set()}; m.set(p.squadId, s); } return s; }
const segDist = (q, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / L)); return Math.hypot(q.x - a.x - t * vx, q.y - a.y - t * vy); };
// 對方會經過的地方：線段（對方開場→中央、對方開場→我方、已知對方→我方）、點（還沒開的箱子、三倍傷害、中央）
function ambushCell(bot, foes) {
  const g = bot.g, p = g.player, side = bot.side(), N = g.grid.length, C = {x: (N - 1) / 2, y: (N - 1) / 2};
  const theirStart = g.pvpGoal?.[side], team = g.alive(side), ours = {x: team.reduce((a, m) => a + m.x, 0) / team.length, y: team.reduce((a, m) => a + m.y, 0) / team.length};
  const segs = [], pts = [C];
  const ourStart = g.pvpGoal?.[g.other(side)];
  if (theirStart) segs.push([theirStart, C]);
  for (const f of foes) segs.push([{x: f.x, y: f.y}, ours]);
  for (const c of g.props) if (c.type === 'container' && String(c.id).startsWith('pvp-crate') && !c.opened && g.seen[c.y]?.[c.x]) pts.push(c);
  for (const i of g.items) if (i.type === 'pvp_power') pts.push(i);
  let best = null;
  for (const c of droneCells(g)) {
    if (foes.some(f => distance(f, c) <= 4)) continue;
    if (ourStart && distance(c, ourStart) < 7) continue;   // 自己開場附近：對方不會來   // 太近：等於直接撞
    let d = Infinity; for (const [a, b] of segs) d = Math.min(d, segDist(c, a, b)); for (const q of pts) d = Math.min(d, distance(c, q));
    if (d > 2) continue;
    const seen = foes.some(f => distance(f, c) <= 10 && g.sight({x: f.x, y: f.y}, c));   // 對方看得到：可能被打下來
    const s = -d - (seen ? 1.5 : 0) + (isBlack(g, c) ? 1 : 0) - (team.some(m => distance(m, c) <= 1) ? 1 : 0);
    if (!best || s > best.s) best = {s, d, x: c.x, y: c.y};
  }
  return best;
}
// 部署後記下 id；爆炸的傷害（包 applyThrowable 量，行為不變）
export function trackMunition(bot, intent) {
  const g = bot.g, p = g.player;
  if (intent.type !== 'deployUnit' || !intent.ambush) return;
  const S = munState(g, p);
  for (const a of g.allies) if (a.sourceId === 'drone_munition' && !S.ids.has(a.id)) { S.ids.add(a.id); ALL_MUN.push(a); (MUN_IDS.get(g) || MUN_IDS.set(g, new Set()).get(g)).add(a); }
  if (g.__alphaMunHook) return; g.__alphaMunHook = true;
  const orig = g.applyThrowable;
  g.applyThrowable = function (kind, point, dmg, src, ...rest) {
    if (!src || !MUN_IDS.get(g)?.has(src)) return orig.call(this, kind, point, dmg, src, ...rest);
    const before = new Map([...this.enemies, ...this.members].map(e => [e, e.hp]));
    const r = orig.call(this, kind, point, dmg, src, ...rest);
    tick('mun.detonated'); src.__det = true;
    for (const [e, h] of before) { if (!(e.hp < h)) continue; const own = this.members.includes(e); tick(own ? 'mun.friendlyDmg' : 'mun.dmg', h - Math.max(0, e.hp)); if (!own) { tick('mun.hits'); if (e.hp <= 0) tick('mun.kills'); } }
    return r;
  };
}
const MUN_IDS = new WeakMap(), ALL_MUN = [];
if (process.env.ALPHA_REPORT) process.on('exit', () => { const f = {}; for (const a of ALL_MUN) { const k = a.__det ? 'detonated' : a.hp <= 0 || a.status === 'destroyed' ? 'shotDown' : 'idle'; f[k] = (f[k] || 0) + 1; } console.error('MUN_FATE ' + JSON.stringify(f)); });

// 俯衝打得到誰：部署格 c 到對方（替身，這個階段不會動）4 格內、看得到、直線沒擋、有落點；值：職業、能炸到幾個人、血少
function strikeCell(bot) {
  const g = bot.g, p = g.player, side = bot.side(), team = g.alive(side);
  const foes = g.enemies.filter(e => e.hp > 0 && e.pvpOf != null);
  let best = null;
  for (const c of droneCells(g)) {
    for (const e of foes) {
      if (distance(c, e) > 4 || !g.sight(c, e) || !g.shotClear(c, e)) continue;
      const point = distance(c, e) === 1 ? c : pullLanding(g, {x: c.x, y: c.y, id: 'probe'}, e); if (!point) continue;
      const m = g.unit(e.pvpOf), pack = foes.filter(o => distance(o, point) <= 2).length, own = team.filter(u => distance(u, point) <= 2).length;
      if (own) continue;
      const hidden = !foes.some(o => g.sight({x: o.x, y: o.y}, p));
      const s = pack * 10 + (m?.character === 'recon' ? 6 : 0) + (m?.character === 'bulwark' && skillActive(m, 'anchor') ? 5 : 0) + (e.hp <= 45 ? 8 : 0) + (hidden ? 3 : 0);
      if (!best || s > best.s) best = {s, x: c.x, y: c.y, who: m?.character, hidden};
    }
  }
  return best;
}
// 帶著自殺無人機摸近：往離已知對方 3–5 格、沒人看得到的格子走
function approachFoe(bot, view, foes) {
  const g = bot.g, p = g.player, me = view.me; if (me.hp < me.maxHp * .4 || me.pinned) return null;
  const near = foes.filter(f => distance(f, me) <= 10 && distance(f, me) > 3); if (!near.length) return null;
  if (foes.some(f => distance(f, me) <= 2)) return null;
  const ex = exposureFn(bot, foes), F = walkField(bot, me, {maxCost: 12, cell: q => ex(q) * 4, edge: trenchEdge(g)});
  let best = null;
  for (const [k, c] of F.D) { const q = {x: k % 256, y: Math.floor(k / 256)}; if (ex(q)) continue; if (!near.some(f => distance(f, q) >= 3 && distance(f, q) <= 5)) continue; if (!best || c < best.c) best = {c, q}; }
  if (!best || best.c === 0) return null;
  const st = firstStep(F, best.q); if (!st) return null;
  tick('mun.approachStep');
  return {type: 'move', arg: st, walk: true, why: `alpha engineer sneaks with munition → ${best.q.x},${best.q.y}`};
}
