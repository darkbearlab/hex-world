// beta 的工兵（加強版開場 60 廢料）：三種單位照整隊計畫挑（src/workshop.js 的 UNIT_BLUEPRINTS）。
//   - 定點砲台 drone_sentry（30）：埋伏（整隊守開場）時架在看得到來路的格子；之後不動，守路口。
//   - 跟隨無人機 drone_follow（30）：推進時用，跟著工兵走。
//   - 自殺無人機 drone_munition（15，裝一顆破片當彈頭）：先做好放在生產線上，對方擠在一起（爆炸範圍 2 內兩個以上）
//     或重裝兵下錨不動時才部署在最靠近的格子；它自己飛過去（視野 8、俯衝 4），不靠近自己人才放。
// 一條生產線、一台常駐單位（自殺無人機不算）：先做常駐的，再做自殺無人機。
import {buildReason, deployReason, deployedUnits} from '../../../src/workshop.js';
import {droneCells, MUNITION_TUNING} from '../../../src/allies.js';
import {skillActive} from '../../../src/skills.js';
import {dist, key} from '../../clear-bot/util.mjs';
import {lineOpen} from '../../clear-bot/tactics.mjs';
import {stayCost} from '../../clear-bot/classes/common.mjs';
import {isBlack} from '../../../src/lighting.js';
import {seesBlack, approachTiles} from './beta-sniper.mjs';
const approachTilesOf = bot => approachTiles(bot.g, bot.g.pvp.side);
import {munitionAmbush, munitionBuild, munitionStrike, on as pbOn} from './beta-playbook.mjs';

export const ENG_TUNING = {munition: 20, cluster: 18, anchored: 20, deploy: 25, keepFrag: 1, seen: 12};
export const ENG_STATS = {};
const MUNITION = !!globalThis.process?.env?.BETA_MUNITION;
const OFF = new Set((globalThis.process?.env?.BETA_OFF || '').split(','));
const count = k => { if (globalThis.process?.env?.BETA_STATS) ENG_STATS[k] = (ENG_STATS[k] || 0) + 1; };
const unitOf = (g, id) => String(id).startsWith('px-') ? g.unit(String(id).slice(3)) : null;

// 要做哪一種：沒有常駐單位就先做（埋伏＝砲台、推進＝跟隨）；再做自殺無人機（要有破片）
function buildChoice(g, team, ambush) {
  const p = g.player; if (p.productionLines.length) return null;
  const standing = deployedUnits(g).length;
  if (!standing) { const bp = ambush && !OFF.has('sentry') ? 'drone_sentry' : 'drone_follow'; if (!buildReason(g, bp)) return {blueprint: bp}; }
  // 自殺無人機：留 30 廢料重做常駐單位（它被打掉時）
  // 實測（40 場、加強規則）：部署 11～21 台只炸到 1～3 次，而且都炸到自己人（它撞最近看到的人，我們的人常在旁邊；部署那階段又會被打掉）——預設不做，廢料留著重做跟隨無人機；BETA_MUNITION=1 打開
  const pbm = munitionBuild(g); if (pbm) return pbm;
  if (MUNITION && (p.scrap || 0) >= 45 && (p.grenades || 0) >= 1 && !buildReason(g, 'drone_munition', 'frag')) return {blueprint: 'drone_munition', payload: 'frag'};
  return null;
}
// 砲台的格子：看得到最多「來路」或記得的敵人（7 格內）
function sentryCell(g, team, watch) {
  const cells = droneCells(g); if (!cells.length) return null;
  const known = [...team.memory.values()].filter(r => !r.ally && g.turn - r.turn <= 10);
  const pts = known.length ? known : watch || [];
  let best = null;
  for (const c of cells) {
    let v = 0; for (const t of pts) { const d = dist(c, t); if (d <= 7 && d >= 2 && lineOpen(g, c, t)) v += t.watch ? 1 : 3; }
    if (!best || v > best.v) best = {v, c};
  }
  return best?.c || null;
}
// 自殺無人機值不值得放：對方（看得到或剛剛看到的）在爆炸範圍 2 內擠了幾個、有沒有下錨的重裝兵；附近不能有自己人
function munitionTarget(g, view, team) {
  const foes = [...team.memory.values()].filter(r => !r.ally && g.turn - r.turn <= 1);
  if (!foes.length) return null;
  const cells = droneCells(g); if (!cells.length) return null;
  let best = null;
  for (const e of foes) {
    const u = unitOf(g, e.id); if (!u) continue;
    const near = foes.filter(f => dist(f, e) <= 2).length;
    const anchored = u.character === 'bulwark' && skillActive(u, 'anchor');
    if (near < 2 && !anchored) continue;
    if (team.members.some(m => dist(m, e) <= 3)) continue;   // 自己人在爆炸範圍附近（它會撞最近看到的人，人會動）：不放
    // 部署的那個階段它還不能動，對方的階段會先打它（30 血）：只放在對方看不到的格子（牆後，或全黑而對方沒有夜視）
    const hidden = c => foes.every(f => !lineOpen(g, f, c) || isBlack(g, c) && !seesBlack(g, f) && !f.ally);
    const order = cells.filter(c => dist(c, e) <= MUNITION_TUNING.sight).sort((a, b) => (hidden(b) - hidden(a)) || dist(a, e) - dist(b, e));
    const cell = order[0]; if (!cell || !hidden(cell)) continue;   // 看得到的格子：部署那一階段就被打掉（實測 21 台只炸到 2 次，都炸到自己人）
    const v = (near - 1) * ENG_TUNING.cluster + (anchored ? ENG_TUNING.anchored : 0) + (dist(cell, e) <= MUNITION_TUNING.dive + 1 ? 6 : 0) - (hidden(cell) ? 0 : ENG_TUNING.seen);
    if (v > 0 && (!best || v > best.v)) best = {v, cell, e, near, anchored};
  }
  return best;
}
const lineOf = (p, bp) => p.productionLines.findIndex(l => l.blueprint === bp);

// 交火中的選項（取代 ClearBot 的 engineer.combat：它一做好就部署，自殺無人機也一樣）
export function engCombat(bot, view) {
  const g = bot.g, p = g.player, team = bot.team, out = [];
  for (const bp of ['drone_sentry', 'drone_follow']) {
    const i = lineOf(p, bp); if (i < 0) continue;
    const cell = bp === 'drone_sentry' ? sentryCell(g, team, null) : null;
    if (!deployReason(g, i, cell)) out.push({type: 'deployUnit', arg: cell ? {line: i, x: cell.x, y: cell.y} : {line: i}, score: ENG_TUNING.deploy - stayCost(view), why: `deploy ${bp}`});
  }
  const strike = munitionStrike(view, bot); if (strike) out.push(strike);
  const amb = strike ? null : munitionAmbush(view, bot, approachTilesOf(bot)); if (amb) out.push({...amb, score: 6 - stayCost(view) * .5});
  const mi = lineOf(p, 'drone_munition');
  if (mi >= 0 && !pbOn('pb8')) {
    const t = munitionTarget(g, view, team);
    if (t && !deployReason(g, mi, t.cell)) out.push({type: 'deployUnit', arg: {line: mi, x: t.cell.x, y: t.cell.y}, score: ENG_TUNING.munition + t.v - stayCost(view) * .5, why: `munition at ${t.e.id} near${t.near}${t.anchored ? ' anchored' : ''}`});
  }
  return out;
}
// 沒在交火：部署常駐單位（砲台挑格子）、做下一台；自殺無人機留在生產線上等
export function engQuiet(bot, view, ambush, watch) {
  const g = bot.g, p = g.player, team = bot.team;
  for (const bp of ['drone_sentry', 'drone_follow']) {
    const i = lineOf(p, bp); if (i < 0) continue;
    const cell = bp === 'drone_sentry' ? sentryCell(g, team, watch) : null;
    if (!deployReason(g, i, cell)) { count(`ENG:deploy:${bp}`); return {type: 'deployUnit', arg: cell ? {line: i, x: cell.x, y: cell.y} : {line: i}, why: `deploy ${bp}`}; }
  }
  const amb = munitionAmbush(view, bot, watch); if (amb) return amb;
  const mi = lineOf(p, 'drone_munition');
  if (mi >= 0 && !pbOn('pb8')) { const t = munitionTarget(g, view, team); if (t && !deployReason(g, mi, t.cell)) { count('ENG:deploy:drone_munition'); return {type: 'deployUnit', arg: {line: mi, x: t.cell.x, y: t.cell.y}, why: `munition at ${t.e.id}`}; } }
  const b = buildChoice(g, team, ambush);
  if (b) { count(`ENG:build:${b.blueprint}`); return {type: 'buildUnit', arg: b, why: `build ${b.blueprint}`}; }
  return null;
}
