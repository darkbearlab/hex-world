// 重播儲存的戰鬥（Alan 2026-10-16：人類玩家打完可以選擇把戰鬥過程存在線上）：存的是那一場的完整紀錄（選角、每個動作、機器人的座位）＋種子，
// 照順序在一個新的房間重播就是同一場（遊戲用種子的亂數；機器人也是）。這裡一邊重播一邊錄每個動作的動畫，給觀戰頁（watch.html?replay=）播：
// 全場可見（同 pvp-spectate.js），畫面以「現在行動的那一隊」為我方。
// 注意：機器人的程式改了以後，有機器人的舊紀錄可能重播得不一樣（那一場當時的機器人已經換掉了）。
import {createRoom} from './pvp-room.js';
import {snapshot} from './presentation.js';
import {full} from './pvp-spectate.js';

export function* replayMatch({saved, generate, installBots, proxy = 'raider'}) {
  const queue = [];
  let room = null;
  const g = () => room.game, view = () => full(snapshot(g()), proxy);
  const shown = steps => steps.map(s => ({before: full(s.before, proxy), after: full(s.after, proxy), effects: s.effects}));
  room = createRoom({generate, installBots, bots: saved.bots || {}, seed: saved.seed, match: 0, seats: false,
    onPhase: side => queue.push({kind: 'phase', side, round: g().pvp.round, state: view(), log: g().pvp.log.slice()}),
    onSteps: (side, unit, steps) => queue.push({kind: unit ? 'act' : 'end', side, unit, round: g().pvp.round, steps: shown(steps), state: view(), log: g().pvp.log.slice()})});
  for (const e of saved.journal || []) {
    try { room.handle(e.p, e.side, e.body); } catch (err) { queue.push({kind: 'error', error: String(err?.message || err)}); }
    while (queue.length) yield queue.shift();
  }
  const G = g();
  yield {kind: 'over', winner: G?.pvp.winner || saved.result?.winner || null, status: G?.status, round: G?.pvp.round, log: G?.pvp.log.slice() || [], state: G ? view() : null};
}
