// 奇美拉：NPC 傭兵公司（Alan 2026-10-09：只是想讓世界動起來）。住在共用星球上，跟玩家一樣開公司、培養複製人、接委託、打服務單、
// 參加大戰役。打仗用自動結算（比真人親自打弱一點，不會把玩家擠掉）。只在每天 8～20 時行動，一小時最多結算兩張服務單。
// 個性（沿用大戰役 NPC 實測的四種）：
// - allin（全押）：人多、接得多；大戰役一開打就把待命的人全派上去，不撤軍
// - careful（謹慎）：人少、挑程度低的；大戰役派一半，陣亡過半就撤軍
// - late（後到）：等大戰役的行情到 ×2 才進場，站攻方
// - contrarian（逆風）：等哪一邊的行情先到 ×2 就替那一邊打
// 由 core.js 每個遊戲小時呼叫 npcHour；所有決定都照目前的狀態與時刻算（不另外存亂數），重播一樣。
import * as C from './cases.js';
import * as G from './company.js';

export const NPCS = [
  {name: '鐵砧兵團', style: 'allin', size: 16, cases: 3},
  {name: '灰鷺保全', style: 'careful', size: 10, cases: 1},
  {name: '晚鐘傭兵團', style: 'late', size: 14, cases: 2},
  {name: '逆流公司', style: 'contrarian', size: 14, cases: 2},
];
const RECIPE = {food: 40, water: 40, implant: 40, neural: 40};
const hash = s => { let x = 2166136261; for (const ch of String(s)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967296; };
const online = h => h % 24 >= 8 && h % 24 < 20;

// 開出 NPC 公司（還沒有的才開）：總部放在不同的大城
export function ensureNpcs(core) {
  const game = core.game; if (!game) return;
  const K = core.sim.peek(), used = new Set(Object.values(game.cos).map(g => g.base));
  const towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0 && K.fac[K.owner[t]]?.cap === t).sort((a, b) => (K.markets[b].pop || 0) - (K.markets[a].pop || 0));
  for (const [i, N] of NPCS.entries()) {
    if (game.cos[N.name]) { game.cos[N.name].npc ||= {style: N.style}; continue; }
    const base = towns.find(t => !used.has(t)) ?? towns[i % Math.max(1, towns.length)]; if (base === undefined) return;
    if (core.found(base, N.name)) continue;
    used.add(base); game.cos[N.name].npc = {style: N.style};
  }
}

export function npcHour(core, h) {
  const game = core.game; if (!game) return;
  for (const N of NPCS) { const g = game.cos[N.name]; if (g?.npc) try { act(core, g, N, h); } catch (e) { g.npc.err = String(e.message || e).slice(0, 120); } }
}

function act(core, g, N, h) {
  const cmd = m => core.command(m, N.name), b = core.game.book, home = () => g.roster.filter(c => c.alive && c.status === 'home' && !c.keep);
  // 培養槽：出槽的簽收；人不夠就培養（素材不夠先買）
  for (const [i, q] of g.queue.entries()) if (q.ready) cmd({type: 'claim', slot: q.slot ?? i});
  const alive = g.roster.filter(c => c.alive).length + g.queue.length;
  // 金主：人打光了、錢也不夠重新培養時，每 7 天撥一筆 300k（讓世界一直有 NPC 在動）
  if (alive < 2 && g.cash < 300 && h - (g.npc.funded ?? -999) >= 24 * 7) { g.cash += 300; g.npc.funded = h; g.log.push({h, text: '金主撥了一筆款子：$300k，重新招兵。'}); }
  if (alive < N.size && g.queue.length < G.GCFG.VATS) {
    for (const m of Object.keys(RECIPE)) if (g.mats[m] < RECIPE[m] && g.cash > 150) cmd({type: 'buy', mat: m, qty: 100});
    if (Object.keys(RECIPE).every(m => g.mats[m] >= RECIPE[m])) cmd({type: 'build', recipe: RECIPE});
  }
  if (!online(h)) return;
  // 服務單：先打最早的，一小時最多兩張（自動結算）
  const mine = b.tickets.filter(t => t.player === N.name && !t.done && t.squad).sort((a, b2) => a.issued - b2.issued).slice(0, 2);
  for (const t of mine) cmd({type: 'resolve', ticket: t.id});
  const board = core.boardView(N.name);
  // 大戰役
  for (const e of board.filter(x => x.kind === 'camp')) {
    const v = core.sim.campaignOf(e.camp); if (!v || v.done) continue;
    const st = g.npc.camp?.[e.camp] || {}, cs = b.cases.find(c => c.kind === 'camp' && c.camp === e.camp && g.cases.includes(c.id));
    if (!st.joined) {
      const hi = Math.max(v.mulA, v.mulD), want = N.style === 'allin' || N.style === 'careful' || hi >= 2;
      const side = N.style === 'contrarian' ? (v.mulD >= v.mulA ? 'def' : 'att') : N.style === 'late' ? 'att' : hash(N.name + e.camp) < .5 ? 'att' : 'def';
      const pick = home().slice(0, N.style === 'careful' ? Math.ceil(home().length / 2) : 99).map(c => c.uid);
      if (want && pick.length >= 2 && !cmd({type: 'accept', kind: 'camp', tile: e.tile, side, uids: pick})) { (g.npc.camp ||= {})[e.camp] = {joined: true, sent: pick.length, dead0: g.roster.filter(c => !c.alive).length}; }
      continue;
    }
    // 謹慎：陣亡過半就撤軍
    if (N.style === 'careful' && cs && !st.quit && g.roster.filter(c => !c.alive).length - st.dead0 >= st.sent / 2) { for (const sid of [...cs.squads]) cmd({type: 'recall', squad: sid}); st.quit = true; }
    // 全押：有空的人就加派
    if (N.style === 'allin' && cs && !cs.settled && home().length >= 4) cmd({type: 'accept', kind: 'camp', tile: e.tile, side: e.side || 'att', uids: home().map(c => c.uid)});
  }
  // 一般委託：案件數沒滿、有待命的人就接一個（全押挑程度高的、謹慎挑程度低的，其他照公開順序）
  const open = g.cases.map(id => b.cases.find(c => c.id === id)).filter(c => c && !c.settled).length;
  if (open >= N.cases || home().length < 4) return;
  const cands = board.filter(e => e.kind !== 'camp' && !e.joined && h >= e.start && h < e.closeAt && !e.gone)
    .sort((a, b2) => (N.style === 'allin' ? b2.lv - a.lv : N.style === 'careful' ? a.lv - b2.lv : 0) || hash(N.name + a.key + h) - hash(N.name + b2.key + h));
  for (const e of cands.slice(0, 3)) {
    const side = e.kind === 'front' ? (hash(N.name + e.key) < .5 ? 'att' : 'def') : e.kind === 'tense' ? (hash(N.name + e.key) < .5 ? 'a' : 'b') : '';
    const n = N.style === 'allin' ? Math.min(8, home().length) : 4;
    if (!cmd({type: 'accept', kind: e.kind, tile: e.tile, side, uids: home().slice(0, n).map(c => c.uid)})) return;
  }
}
