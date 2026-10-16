// PVP 觀戰（Alan 2026-10-15「我要觀戰看看」）：伺服器跑一場機器人對機器人，每個人的每一步都錄 ASH 的動畫快照，觀戰頁（pvp/web/watch.html）用 ASH 的畫面一步一步播。
// - 觀眾看全場：沒有迷霧、兩隊都看得到（畫面以「現在行動的那一隊」為我方，換階段時換邊）
// - 邊播邊算（generator）：一場的快照全部存起來太大（每一步幾百 KB），觀眾要第幾格就往下算到第幾格；倒回去就從頭重算（同一個種子，一模一樣）
import {PvpGame} from './pvp-game.js';
import {captureAction, snapshot} from './presentation.js';
import {LOOK} from './pvp-room.js';

// 全場可見的快照：看過的格子＝全部、看得到的格子＝全部地板、敵人（對方的替身）全部留著；替身的種類換回一般的替身（瀏覽器沒有 pvp-proxy-* 這些種類）
export function full(s, proxy) {
  const N = s.grid?.length || 0, all = Array.from({length: N}, () => Array(N).fill(true)), vis = new Set();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (s.grid[y][x]) vis.add(`${x},${y}`);
  const out = {...s, seen: all, visibleTiles: vis, enemies: (s.enemies || []).map(e => /^pvp-proxy-/.test(e.type) || e.pvpAlly != null ? {...e, type: LOOK[e.pvpCls] || (e.pvpAlly != null ? 'drone' : proxy)} : e)};
  for (const k of ['pvpSeen', 'pvpParked', 'pvpActor', 'pvpHow', 'pvpFlashes']) delete out[k];
  return out;
}

// 一場觀戰：next() 回傳下一格 {kind: 'phase'|'act'|'end'|'over', side, round, unit, steps, state, log}
export function* watchMatch({seed, map, A, B, bots, installBots, proxy = 'raider', rules = null}) {
  const g = new PvpGame({seed, map, A, B, rules});   // rules：模式（佔領＝{capture: …}）
  installBots(g, {bots});
  const view = () => full(snapshot(g), proxy);
  const shown = steps => steps.map(s => ({before: full(s.before, proxy), after: full(s.after, proxy), effects: s.effects}));
  while (g.status === 'playing') {
    for (const side of ['A', 'B']) {
      if (g.status !== 'playing' || !g.beginPhase(side)) continue;
      yield {kind: 'phase', side, round: g.pvp.round, state: view(), log: g.pvp.log.slice()};
      for (const m of g.alive(side)) {
        if (g.status !== 'playing' || m.hp <= 0) continue;
        const brain = g.brains.get(m); if (!brain) continue;
        g.focusUnit(m); g.pvpActor = {id: m.squadId, get exposed() { return !!m.pvpExposed; }};
        let steps = [];
        try { ({steps} = captureAction(g, () => { for (let i = 0; i < 6 && !g.soloDone && m.hp > 0 && g.status === 'playing'; i++) brain(g, m); return true; })); }
        finally { g.unitDone(m); }
        g.controlled = m;
        yield {kind: 'act', side, round: g.pvp.round, unit: m.squadId, steps: shown(steps), state: view(), log: g.pvp.log.slice()};
      }
      // 階段結束：無人機、砲台行動與世界推進（火、煙、狀態）
      const {steps} = captureAction(g, () => { g.endPhase(); return true; });
      yield {kind: 'end', side, round: g.pvp.round, steps: shown(steps), state: view(), log: g.pvp.log.slice()};
    }
  }
  yield {kind: 'over', winner: g.pvp.winner, status: g.status, round: g.pvp.round, log: g.pvp.log.slice(), state: view()};
}
