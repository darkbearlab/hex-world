// alpha 的工兵（職業加強提案：工兵開場 60 廢料，2026-10-16）。ClearBot 的工兵只做跟隨無人機（classes/engineer.mjs 的 buildChoice）；
// 這裡照局面選種類（src/workshop.js 的 UNIT_BLUEPRINTS；生產線 1 條、同時部署 1 台，自殺無人機不佔部署上限）：
// - 自殺無人機（drone_munition，15 廢料＋1 顆破片當彈頭）：知道的對方裡有下錨的重裝兵、或兩個人擠在 2 格內、或在守點不動的對方，
//   而且在 10 格內——做一台，部署在最靠近他的格子（它自己看到 8 格內的人就飛過去，4 格內俯衝爆炸）。
// - 定點砲台（drone_sentry，30）：交戰中（知道對方在哪）而且場上沒有自己的無人機：做砲台，部署在看得到最多對方位置、最好全黑的格子。
// - 其他：跟隨無人機（drone_follow，30）。
// 統計在 ENG_STATS（做了幾台、部署幾台）。
import {buildReason, deployReason, deployedUnits, UNIT_BLUEPRINTS} from '../../../src/workshop.js';
import {droneCells} from '../../../src/allies.js';
import {skillActive} from '../../../src/skills.js';
import {isBlack} from '../../../src/lighting.js';
import {distance} from '../../../src/world.js';

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
  if (ET.mun && (p.grenades || 0) >= 1) {
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
