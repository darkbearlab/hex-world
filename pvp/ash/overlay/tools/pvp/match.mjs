// PVP 機器人對打（pvp/DESIGN.md）：產生一張地圖、兩隊各 4 個職業、機器人輪流打到分出勝負或回合上限。
// 機器人＝ASH 的通關機器人（ClearBot），看到的敵人就是對方的替身；沒看到敵人時去最近看到敵人的地方，從沒看到過就往對方的開場走。
// node pvp/ash/build.mjs && node pvp/ash/.work/tools/pvp/match.mjs [場數 6] [起始種子 1] [--trace]
import '../clear-bot/lang-default.mjs';
import '../../src/game.js';   // 先載入遊戲本體（不然模組循環引用會出錯，同奇美拉的測試腳本）
import {ClearBot} from '../clear-bot/bot.mjs';
import {route, exploreRoute} from '../clear-bot/nav.mjs';
import {dist} from '../clear-bot/util.mjs';
import {PvpGame, PVP_CLASSES} from '../../src/pvp-game.js';
import {generate} from '../../../../tools/mapgen.mjs';

export class PvpBot extends ClearBot {
  chooseGoal(view) {
    const g = this.g, me = view.me, side = g.pvp.side;
    const ghost = [...(view.ghosts || [])].sort((a, b) => b.turn - a.turn)[0];
    // 去哪：最近看到敵人的地方 → 對方的開場（還沒到過）→ 沒看過的地方（探索）→ 地圖上隨便一格（巡邏，到了再換）
    // 兩隊在對稱地圖上互找對方的開場，常常走不同的路錯身而過；所以到了開場還沒碰到人就改成探索、巡邏
    if (ghost && dist(me, ghost) <= 1) this.pvpGhostDone = ghost.turn;
    const fresh = ghost && ghost.turn !== this.pvpGhostDone ? ghost : null;
    let goal = fresh ? {x: fresh.x, y: fresh.y} : null;
    const home = g.pvpGoal?.[side]; if (home && dist(me, home) <= 2) this.pvpReached = true;
    if (!goal && !this.pvpReached) goal = home;
    if (!goal) { const ex = exploreRoute(view, {allyCost: 2}); if (ex) return {type: 'move', arg: ex.first, walk: true, why: 'explore'}; }
    if (!goal) { const N = g.grid.length; if (!this.patrol || dist(me, this.patrol) <= 1) { for (let k = 0; k < 50; k++) { const x = Math.floor(this.rng() * N), y = Math.floor(this.rng() * N); if (g.grid[y]?.[x] === 1) { this.patrol = {x, y}; break; } } } goal = this.patrol; }
    if (!goal || dist(me, goal) <= 1) return {type: 'wait', why: 'at goal'};
    // 目標在迷霧裡：走向「緊鄰看過的地方、離目標最近的那一格未探索地板」，邊走邊探（ASH 的找路只走看過的格子）
    let r = g.seen[goal.y]?.[goal.x] ? route(view, q => dist(q, goal) <= 1, {allyCost: 2}) : null;
    if (!r) {
      let best = Infinity; const N = g.grid.length;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!g.seen[y][x] && g.grid[y][x] === 1 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.seen[y + dy]?.[x + dx])) best = Math.min(best, dist({x, y}, goal));
      // 離目標最近的未探索格可能在窗（看得到、不能過）的另一邊：放寬幾次，再不行就一般的探索
      for (const slack of [1, 4, 10]) { if (r || best === Infinity) break; r = route(view, q => !g.seen[q.y]?.[q.x] && g.grid[q.y]?.[q.x] === 1 && dist(q, goal) <= best + slack, {allyCost: 2, unknownGoal: true}); }
      r ||= exploreRoute(view, {allyCost: 2});
    }
    return r ? {type: 'move', arg: r.first, walk: true, why: ghost ? `hunt ${ghost.id}` : 'advance'} : {type: 'wait', why: 'no way'};
  }
}
// bots：{A: 機器人類別, B: …}（預設 PvpBot；tools/pvp/duel.mjs 用來比兩個機器人）
export function installPvpBots(g, {onError = null, bots = {}} = {}) {
  const made = new Map();
  const botFor = m => { let b = made.get(m); if (!b) { const Bot = bots[m.pvpSide] || PvpBot; b = new Bot(g, {seed: (Number(g.seed) || 1) + made.size * 7919}); made.set(m, b); } return b; };
  for (const m of [...g.sides.A, ...g.sides.B]) g.brains.set(m, (game, unit) => { try { botFor(unit).step(); } catch (error) { (onError || console.warn)(`${unit.squadId}: ${error.stack || error}`); game.soloDone = true; } });
  return {bots: made, botFor};
}
const pick4 = (r) => { const L = PVP_CLASSES.slice(); for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [L[i], L[j]] = [L[j], L[i]]; } return L.slice(0, 4); };
const lcg = s => () => ((s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 4294967296);

export function playMatch(seed, {A, B, trace = false, bots = {}} = {}) {
  let map = null; for (let s = seed; !map; s++) map = generate(s);
  const r = lcg(seed * 7 + 3); A ||= pick4(r); B ||= pick4(r);
  const g = new PvpGame({seed, map, A, B});
  g.pvpGoal = {A: {x: map.B[0], y: map.B[1]}, B: {x: map.A[0], y: map.A[1]}};
  const errors = []; installPvpBots(g, {onError: e => errors.push(e), bots});
  const t0 = performance.now(); let firstContact = null, shots = {A: 0, B: 0};
  while (g.status === 'playing') {
    for (const side of ['A', 'B']) {
      const hp0 = Object.fromEntries([...g.sides.A, ...g.sides.B].map(m => [m.squadId, m.hp + (m.plates || 0)]));
      g.phase(side);
      for (const m of [...g.sides.A, ...g.sides.B]) if (m.hp + (m.plates || 0) < hp0[m.squadId]) { shots[g.other(m.pvpSide)]++; firstContact ??= g.pvp.round; }
      if (trace) console.log(`  第 ${g.pvp.round} 回合 ${side}：` + [...g.sides.A, ...g.sides.B].map(m => `${m.squadId}${m.character.slice(0, 3)}(${m.x},${m.y})${m.hp}${m.plates ? '+' + m.plates : ''}`).join(' '));
      if (g.status !== 'playing') break;
    }
  }
  return {seed, A, B, status: g.status, winner: g.pvp.winner, rounds: g.pvp.round, firstContact, hits: shots, kills: g.pvp.kills, log: g.pvp.log, errors, ms: performance.now() - t0,
    left: Object.fromEntries(['A', 'B'].map(s => [s, g.sides[s].map(m => `${m.squadId}:${m.character}:${Math.max(0, m.hp)}${m.plates ? '+' + m.plates : ''}`).join(' ')]))};
}

if (process.argv[1]?.endsWith('match.mjs')) {
  const n = +(process.argv[2] || 6), s0 = +(process.argv[3] || 1), trace = process.argv.includes('--trace');
  const R = [];
  for (let s = s0; s < s0 + n; s++) {
    const m = playMatch(s, {trace}); R.push(m);
    console.log(`#${s}：${m.status === 'won' ? m.winner + ' 隊贏' : '平手'}，${m.rounds} 回合（第 ${m.firstContact ?? '—'} 回合第一次交火），命中次數 A ${m.hits.A}／B ${m.hits.B}，${(m.ms / 1000).toFixed(1)} 秒`);
    console.log(`    A：${m.A.join('、')}｜${m.left.A}`); console.log(`    B：${m.B.join('、')}｜${m.left.B}`);
    for (const l of m.log) console.log('    ・' + l);
    if (m.errors.length) console.log('    錯誤 ' + m.errors.length + ' 次：' + m.errors[0].split('\n').slice(0, 3).join(' / '));
  }
  const w = {A: R.filter(m => m.winner === 'A').length, B: R.filter(m => m.winner === 'B').length};
  console.log(`\n共 ${R.length} 場：A 贏 ${w.A}、B 贏 ${w.B}、平手 ${R.length - w.A - w.B}；平均 ${(R.reduce((x, m) => x + m.rounds, 0) / R.length).toFixed(0)} 回合`);
}
