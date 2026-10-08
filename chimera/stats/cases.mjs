// 案件管線的測試：幾家玩家公司一起接同一個案件，看票怎麼分、錢怎麼分、沙盒被改了什麼
// 用法：node stats/cases.mjs [種子數=6] [推到第幾年=90]；SPEED=1 改成兩家同樣隊數、一快一慢的公司
import * as S from '../sim.js';
import * as C from '../cases.js';
const seeds = +(process.argv[2] || 6), Y = +(process.argv[3] || 90);
const SPEED = process.env.SPEED === '1';
const PLAYERS = SPEED ? [
  {name: '快手', n: 3, delay: .5, skill: .25, plays: 1},
  {name: '慢手', n: 3, delay: 16, skill: .25, plays: 1},
] : [
  {name: '獨行俠', n: 1, delay: 2, skill: .4, plays: 1},
  {name: '小公司', n: 3, delay: 8, skill: .25, plays: 1},
  {name: '壟斷', n: 8, delay: 1, skill: .15, plays: 1},
  {name: '放置', n: 3, delay: 0, skill: 0, plays: 0},
];
const agg = {};
function run(seed, kind) {
  const w = S.generate('案件-' + seed, {history: false}); w.sim.begin(); for (let y = 0; y < Y; y++) w.sim.stepYear();
  const opps = w.sim.opportunities().filter(o => o.kind === kind).sort((a, b) => b.lv - a.lv || b.risk - a.risk);
  if (!opps.length) return null;
  const book = C.newBook(seed * 7 + kind.length), K = w.sim.peek();
  const c = C.caseFromOpp(book, w, opps[0], 0, {side: 'att'}); if (!c) return null;
  const before = {bandit: c.path.reduce((x, t) => x + K.bandit[t], 0), trench: K.trench[c.tile], aid: K.fac.length ? w.sim.pmc.pmcAid[c.fac] : 0};
  for (const P of PLAYERS) for (let i = 0; i < P.n; i++) C.enlist(book, c.id, C.makeSquad(book, P.name).id, 0);
  const due = {};
  for (let h = 1; h <= 168 + 72; h++) {
    C.tick(book, w, h);
    for (const tk of book.tickets) {
      if (tk.done || !tk.squad) continue;
      const P = PLAYERS.find(p => p.name === tk.player); if (!P.plays) continue;
      if (due[tk.id] === undefined) due[tk.id] = tk.issued + Math.random() * 2 * P.delay;
      if (h >= due[tk.id]) {
        const sq = book.squads[tk.squad], r = C.fight(book, sq, tk.enemy, (1 + P.skill) * (.85 + Math.random() * .3));
        C.submit(book, w, tk.id, {win: r.win, dead: r.dead, done: C.objectivesDone(tk, r.win, r.dead, !C.alive(sq).length)}, h);
      }
    }
  }
  const after = {bandit: c.path.reduce((x, t) => x + K.bandit[t], 0), trench: K.trench[c.tile], aid: w.sim.pmc.pmcAid[c.fac]};
  return {book, c, before, after};
}
for (const kind of ['short', 'route', 'front', 'tense', 'lair']) {
  const A = {cases: 0, tk: 0, npc: 0, per: {}, delivered: 0, bandit: [0, 0], trench: [0, 0], aid: 0, drops: 0, pool: 0};
  for (const P of PLAYERS) A.per[P.name] = {tk: 0, win: 0, auto: 0, autoWin: 0, dead: 0, pts: 0, net: 0, final: 0};
  for (let s = 1; s <= seeds; s++) {
    const R = run(s, kind); if (!R) continue; const {book, c, before, after} = R;
    A.cases++; A.tk += c.tickets; A.npc += book.tickets.filter(t => t.npc).length; A.pool += c.pay.final * (c.delivered ?? 1);
    if (c.kind === 'route') { A.delivered += c.delivered; A.bandit[0] += before.bandit; A.bandit[1] += after.bandit; }
    A.trench[0] += before.trench || 0; A.trench[1] += after.trench || 0; A.aid += after.aid;
    for (const P of PLAYERS) {
      const Q = A.per[P.name], mine = book.tickets.filter(t => t.player === P.name && t.done);
      Q.tk += mine.length; Q.win += mine.filter(t => t.win && !t.auto).length; Q.auto += mine.filter(t => t.auto).length; Q.autoWin += mine.filter(t => t.auto && t.win).length;
      Q.dead += mine.reduce((x, t) => x + (t.dead?.length || 0), 0); Q.pts += c.score[P.name] || 0; Q.final += c.payout[P.name] || 0; Q.net += C.summary(book, P.name).net;
    }
  }
  if (!A.cases) { console.log(`\n== ${kind}：沒有這種機會`); continue; }
  const n = A.cases, f = v => (v / n).toFixed(1);
  console.log(`\n== ${kind}（${n} 個案件，每案平均）票 ${f(A.tk)}・沒人接由護衛打 ${f(A.npc)}・尾款池 ${f(A.pool)}` +
    (A.bandit[0] ? `・送達 ${(A.delivered / n * 100).toFixed(0)}%・沿路掠奪者 ${f(A.bandit[0])}→${f(A.bandit[1])}` : '') + (A.trench[0] ? `・戰壕 ${(A.trench[0] / n).toFixed(2)}→${(A.trench[1] / n).toFixed(2)}` : '') + (A.aid ? `・留給下一場仗的戰功 ${f(A.aid)}` : ''));
  console.log('公司      隊數  票數  親打勝  自動(勝)  陣亡  積分   尾款   淨收');
  const totTk = PLAYERS.reduce((x, P) => x + A.per[P.name].tk, 0) || 1;
  for (const P of PLAYERS) { const Q = A.per[P.name];
    console.log(`${P.name.padEnd(6, '　')} ${String(P.n).padStart(3)} ${f(Q.tk).padStart(5)}(${(Q.tk / totTk * 100).toFixed(0).padStart(2)}%) ${String(Q.tk - Q.auto ? ((Q.win / (Q.tk - Q.auto)) * 100).toFixed(0) + '%' : '-').padStart(5)} ${f(Q.auto).padStart(5)}(${Q.auto ? (Q.autoWin / Q.auto * 100).toFixed(0) + '%' : '-'}) ${f(Q.dead).padStart(5)} ${f(Q.pts).padStart(6)} ${f(Q.final).padStart(6)} ${f(Q.net).padStart(6)}`); }
}
