// alpha 的佔領模式（rules.capture，Alan 2026-10-16，引擎 be875b7）：5 個點，自己這半邊 2 個（各 1 分）、中央 1 個（1 分）、對方那半邊 2 個（各 2 分）；
// 站在點上才算佔（復活保護中的不算），每一大輪結算；擊倒不得分，倒下的人下個自己的階段在開場復活（保護到再下一個自己的階段）。
// - 分派（一隊一份，每個 turn 重算一次）：站在點上的人鎖在那個點；其他人照「點的分數 ÷ 距離」＋職業（重裝兵、工兵、士兵守近點，忍者、狂戰士、偵察兵搶遠點）
//   ＋比分（領先守近點、落後搶遠點）貪心地配，一個點一個人。
// - 站在點上：不離開（拿掉移動選項和 ClearBot 的退後計畫，只打、待機、下錨）。
// - 還沒到：看得到打得到的人交給一般戰鬥（移動選項加上「離點更近」的分數），不然往點走（路上少被看到）。
// 統計在 MS（cap.*）。參數在 CP（ALPHA_C* 環境變數只給實驗用）。
import {distance} from '../../../src/world.js';
import {MT, tick, exposureFn} from './alpha-manual.mjs';

export const CP = {
  on: process.env.ALPHA_CAP !== '0',
  role: +(process.env.ALPHA_CROLE ?? .35), lead: +(process.env.ALPHA_CLEAD ?? 15), score: +(process.env.ALPHA_CSCORE ?? .3),
  dist: +(process.env.ALPHA_CDIST ?? 10), pull: +(process.env.ALPHA_CPULL ?? 4), hold: process.env.ALPHA_CHOLD !== '0', brave: +(process.env.ALPHA_CBRAVE ?? .4),
};
const RAIDER = new Set(['ninja', 'berserker', 'recon']), KEEPER = new Set(['bulwark', 'engineer', 'soldier']);
const ST = new WeakMap();
export const captureOn = g => CP.on && !!g.captureRule?.() && (g.pvpPoints || []).length > 0;

// 這一隊的分派：Map 單位 id → 點
export function assignment(bot) {
  const g = bot.g, side = bot.side();
  let S = ST.get(g); if (!S) { S = {}; ST.set(g, S); }
  const cur = S[side]; if (cur && cur.turn === g.turn) return cur.map;
  const team = g.alive(side), pts = g.pvpPoints, map = new Map(), taken = new Set();
  const sc = g.pvp.score || {A: 0, B: 0}, diff = (sc[side] || 0) - (sc[g.other(side)] || 0);
  const kind = pt => pt.half == null ? 'mid' : pt.half === side ? 'near' : 'far';
  // 站在點上的（不在保護中）鎖住
  for (const u of team) { const pt = pts.find(p => p.x === u.x && p.y === u.y); if (pt && !u.pvpSafe && !taken.has(pt.id)) { map.set(u.squadId, pt); taken.add(pt.id); } }
  // 上一次的分派：沒有更好的理由就不換（避免來回）
  const prev = cur?.map || new Map();
  const free = team.filter(u => !map.has(u.squadId));
  const score = (u, pt) => {
    const k = kind(pt), v = g.pointValue(pt, side), d = distance(u, pt);
    let s = v / (1 + d / CP.dist);
    if (k === 'far' && RAIDER.has(u.character) || k !== 'far' && KEEPER.has(u.character)) s += CP.role;
    if (diff >= CP.lead && k !== 'far') s += CP.score;     // 領先：守
    if (diff <= -CP.lead && k === 'far') s += CP.score;    // 落後：搶
    if (pt.holder === side) s -= .5;                       // 已經有人佔著（隊友）—— 不會發生（鎖住），保險
    if (prev.get(u.squadId)?.id === pt.id) s += .15;
    return s;
  };
  while (free.length) {
    let best = null;
    for (const u of free) for (const pt of pts) { if (taken.has(pt.id)) continue; const s = score(u, pt); if (!best || s > best.s) best = {s, u, pt}; }
    if (!best) break;
    map.set(best.u.squadId, best.pt); taken.add(best.pt.id); free.splice(free.indexOf(best.u), 1);
  }
  S[side] = {turn: g.turn, map};
  for (const [, pt] of map) tick('cap.assign.' + kind(pt));
  return map;
}
export function myPoint(bot) { return assignment(bot).get(bot.g.player.squadId) || null; }
export const onPoint = (bot, pt) => !!pt && bot.g.player.x === pt.x && bot.g.player.y === pt.y;
