// 大戰役的 NPC 實測（Alan 2026-10-09：讓幾個 NPC 玩家實際測試這個機制並提各階段戰報）。
// 一個會打出大戰役的世界、四家策略不同的公司；親自打的服務單真的在 ASH 戰場上由機器人打（SquadGame＋full-squad），
// 放置的公司用自動結算。輸出 JSON（每一輪的戰況與物價、每張服務單、每家公司的帳）給戰報用。
// node tools/chimera/campaign-npc.mjs [種子=奇美拉-4] [輸出檔]
import '../clear-bot/lang-default.mjs';
import {writeFileSync} from 'node:fs';
import {Core} from '../../../../core.js';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
const seed = process.argv[2] || '奇美拉-4', outFile = process.argv[3] || 'campaign-npc.json';
if (process.argv[4] && process.argv[4] !== '-') globalThis.CAMP_WAVE_BY = process.argv[4];   // 'squad'：規模照每隊累計（比較用）
// 陣營：第五個參數「全押,謹慎,後到」各站哪一邊（att／def），逆風照行情自己選
const SIDES = (process.argv[5] || 'att,att,att').split(',');
// 真人節奏（第六個參數 human）：一家公司一次只打一場、一場約 30 分鐘（每小時最多兩張），每天只有 10 小時在線（每天 9～19 時）；
// 不在線時服務單就放著，放超過 24 小時由雇主逕行結算（自動結算）
const HUMAN = process.argv[6] === 'human', online = h => !HUMAN || (h % 24 >= 9 && h % 24 < 19), PER_HOUR = HUMAN ? 2 : Infinity;
let mission = null;
const c = new Core(m => { if (m.type === 'mission') mission = m.data; }); c.start(seed); while (c.year < 100) c.stepYear();
const K0 = c.sim.peek(), towns = Object.keys(K0.markets).map(Number).filter(t => K0.owner[t] >= 0);
// 四家公司：策略、人數、邊、打法
const NPC = [
  {name: '全押', n: 16, side: SIDES[0], manual: true, join: () => true, quit: () => false, note: '開打就把 16 人全派上去，打到最後一人'},
  {name: '謹慎', n: 16, side: SIDES[1], manual: true, send: 8, join: () => true, quit: s => s.dead >= s.sent / 2, note: '只派 8 人，陣亡過半就撤軍'},
  {name: '後到', n: 16, side: SIDES[2], manual: true, join: v => Math.max(v.mulA, v.mulD) >= 2, quit: () => false, note: '等傭兵行情翻倍才進場，16 人全派'},
  {name: '逆風', n: 16, side: null, manual: true, join: v => Math.max(v.mulA, v.mulD) >= 2, quit: () => false, note: '等哪一邊的行情先到 ×2 就替那一邊打（逆風局），16 人全派'},
];
for (const [i, P] of NPC.entries()) {
  c.found(towns[(i * 3 + 1) % towns.length], P.name); const G = c.co(P.name);
  const base = G.roster[0];
  for (let k = G.roster.length; k < P.n; k++) G.roster.push({...JSON.parse(JSON.stringify(base)), uid: 5000 + i * 100 + k, id: `${P.name[0]}-${k}`, alive: true, status: 'home', gear: null});
  P.cash0 = G.cash; P.state = {sent: 0, dead: 0, joined: false, quit: false};
}
// 等大戰役開打
let h = 1, camp = null;
for (; h <= 24 * 140 && !camp; h++) { c.advanceTo(h); camp = c.boardView(NPC[0].name).find(x => x.kind === 'camp') || null; }
if (!camp) { console.log('沒有打出大戰役'); process.exit(1); }
const id = camp.camp, P0 = c.sim.peek(), v0 = c.sim.campaignOf(id), front = camp.tile;
const capOf = f => P0.fac[f]?.cap;
const report = {seed, start: h, title: camp.title, detail: camp.detail, att: P0.fac[v0.att].n, def: P0.fac[v0.def].n, rounds: [], tickets: [], events: [], npc: NPC.map(p => ({name: p.name, note: p.note, side: p.side}))};
const priceAt = t => { const m = c.sim.peek().markets[t]; return m ? {ammo: +m.price.ammo.toFixed(2), fuel: +m.price.fuel.toFixed(2), food: +m.price.food.toFixed(2), stockAmmo: Math.round(m.stock.ammo), stockFood: Math.round(m.stock.food)} : null; };
report.config = {sides: SIDES, human: HUMAN, waveBy: globalThis.CAMP_WAVE_BY ?? 'player'};
report.price0 = {front: priceAt(front), attCap: priceAt(capOf(v0.att)), defCap: priceAt(capOf(v0.def))};
const ev = t => report.events.push({h, day: +((h - report.start) / 24).toFixed(2), t});
let lastRound = -1, done = false;
for (let n = 0; n < 24 * 14 && !done; n++, h++) {
  c.advanceTo(h);
  const v = c.sim.campaignOf(id);
  if (v && v.round !== lastRound) { lastRound = v.round; const V = c.sim.campaignView().find(x => x.id === id); report.rounds.push({h, day: +((h - report.start) / 24).toFixed(2), round: v.round, fa: +v.fa.toFixed(3), fd: +v.fd.toFixed(3), mulA: v.mulA, mulD: v.mulD, bonusA: V?.bonusA, bonusD: V?.bonusD, pmcKillA: V?.pmcKillA, pmcKillD: V?.pmcKillD, front: priceAt(front), attCap: priceAt(capOf(v.att)), defCap: priceAt(capOf(v.def))}); }
  for (const P of NPC) {
    const G = c.co(P.name), S = P.state;
    // 進場
    if (!S.joined && v && !v.done && P.join(v)) {
      const free = G.roster.filter(x => x.alive && x.status === 'home').slice(0, P.send || P.n).map(x => x.uid);
      const e = c.boardView(P.name).find(x => x.kind === 'camp');
      const side = P.side || (v.mulD >= v.mulA ? 'def' : 'att'); P.side = side; report.npc.find(x => x.name === P.name).side = side;
      const err = e && c.command({type: 'accept', kind: 'camp', tile: e.tile, side, uids: free}, P.name);
      if (e && !err) { S.joined = true; S.sent = free.length; ev(`${P.name}進場（${P.side === 'att' ? '攻方' : '守方'}，${free.length} 人；行情 ×${v.mulA}／×${v.mulD}）`); } else if (err) ev(`${P.name}接案失敗：${err}`);
    }
    const cs = c.game.book.cases.find(k => k.kind === 'camp' && k.camp === id && G.cases.includes(k.id)); if (!cs) continue;
    // 打手上的服務單（真人節奏：在線才打、一小時最多兩張、先打最早的）
    const mine = c.game.book.tickets.filter(t => t.caseId === cs.id && t.player === P.name && !t.done).sort((a, b) => a.issued - b.issued).slice(0, online(h) ? PER_HOUR : 0);
    for (const tk of mine) {
      let how = 'auto', turns = 0, res = null;
      if (P.manual) {
        mission = null; c.command({type: 'fight', ticket: tk.id}, P.name);
        if (mission) {
          try { const g = new SquadGame(mission); const {botFor} = installFullSquad(g); let k = 0; while (g.status === 'playing' && k++ < 6000) botFor(g.player).step(); res = g.missionResult; turns = g.turn; how = 'manual';
            c.command({type: 'submit', ticket: tk.id, result: res}, P.name); } catch (e) { ev(`${P.name}：戰鬥出錯 ${String(e.message).slice(0, 80)}`); c.command({type: 'resolve', ticket: tk.id}, P.name); }
        } else c.command({type: 'resolve', ticket: tk.id}, P.name);
      } else c.command({type: 'resolve', ticket: tk.id}, P.name);
      const d = c.game.book.tickets.find(t => t.id === tk.id);
      S.dead += d.dead?.length || 0;
      const pay = c.game.book.ledger.filter(x => x.player === P.name && x.kind === 'camp' && x.text.startsWith(d.title)).reduce((a, x) => a + x.amount, 0);
      report.tickets.push({npc: P.name, h, day: +((h - report.start) / 24).toFixed(2), wave: d.wave, type: d.type, enemies: Object.values(d.enemy.units).reduce((a, b) => a + b, 0) + Object.values(d.enemy.veh || {}).reduce((a, b) => a + b, 0) + (d.enemy.boss ? 1 : 0),
        boss: d.enemy.boss?.name || d.enemy.boss?.weapon || '', how, turns, win: !!d.win, kills: d.kills, mul: d.mul, contrib: d.pts, dead: d.dead?.length || 0, pay});
    }
    // 撤軍
    if (S.joined && !S.quit && P.quit(S)) { for (const sid of [...cs.squads]) c.command({type: 'recall', squad: sid}, P.name); S.quit = true; ev(`${P.name}撤軍（派 ${S.sent}、陣亡 ${S.dead}）`); }
    const aliveIn = cs.squads.map(s => c.game.book.squads[s]).filter(Boolean).reduce((a, s) => a + s.clones.filter(x => x.alive).length, 0);
    if (S.joined && !S.quit && !S.wiped && aliveIn < 2 && !cs.settled) { S.wiped = true; ev(`${P.name}在場的人打光了（陣亡 ${S.dead}）`); }
  }
  if (v?.done && !report.end) { report.end = {h, day: +((h - report.start) / 24).toFixed(2), win: v.win === v.att ? '攻方' : '守方', fa: v.fa, fd: v.fd}; ev(`戰役結束：${report.end.win}勝`); }
  if (report.end && h > report.end.h + 30) done = true;
}
for (const P of NPC) {
  const G = c.co(P.name), cs = c.game.book.cases.find(k => k.kind === 'camp' && k.camp === id && G.cases.includes(k.id));
  const led = c.game.book.ledger.filter(x => x.player === P.name && (!cs || x.caseId === cs.id)), by = {};
  for (const x of led) by[x.kind] = (by[x.kind] || 0) + x.amount;
  Object.assign(report.npc.find(x => x.name === P.name), {sent: P.state.sent, dead: P.state.dead, joined: P.state.joined, quit: P.state.quit, wiped: !!P.state.wiped, score: Math.round(cs?.score?.[P.name] || 0), ledger: by, settled: !!cs?.settled, cashDelta: Math.round(G.cash - P.cash0),
    tickets: c.game.book.tickets.filter(t => cs && t.caseId === cs.id && t.player === P.name).length, autoTimeout: c.game.book.tickets.filter(t => cs && t.caseId === cs.id && t.player === P.name && t.auto).length});
}
report.chronicle = c.sim.exportState().events.filter(e => /大戰役/.test(e.text || e.t || '')).slice(-8).map(e => e.text || e.t);
writeFileSync(outFile, JSON.stringify(report, null, 1));
console.log(`${report.title}：${report.end ? `${report.end.day} 天後${report.end.win}勝` : '還沒結束'}；服務單 ${report.tickets.length} 張；輸出 ${outFile}`);
for (const p of report.npc) console.log(p.name, JSON.stringify({sent: p.sent, dead: p.dead, score: p.score, ledger: p.ledger, cash: p.cashDelta}));
