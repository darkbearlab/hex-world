// 在背景推演奇美拉星球：開局後一年一年推進，每推完一年就把那一年的樣子送回畫面
import * as S from './sim.js';
import * as C from './cases.js';
import * as G from './company.js';

let w = null, sim = null, target = 0, running = false, lastEv = 0;

const r1 = v => Math.round(v * 10) / 10;

function snapshot() {
  const K = sim.peek(), L = sim.legendData(), y = sim.year;
  const owner = Int8Array.from(K.owner), pop = new Uint16Array(S.N), trench = new Uint8Array(S.N), bandit = new Uint8Array(S.N);
  for (let i = 0; i < S.N; i++) { pop[i] = Math.round(K.pop[i]); trench[i] = Math.round(K.trench[i] * 80); bandit[i] = Math.min(255, Math.round(K.bandit[i] * 2.5)); }
  const P = {}, T = {};
  for (let i = 0; i < S.N; i++) if (K.owner[i] >= 0) { P[K.owner[i]] = (P[K.owner[i]] || 0) + K.pop[i]; T[K.owner[i]] = (T[K.owner[i]] || 0) + 1; }
  const towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0).map(t => {
    const m = K.markets[t], lord = m.lord ? K.heroes.find(h => h.id === m.lord) : null;
    return {t, pop: Math.round(m.pop), vat: m.vat || 0, works: !!m.works, veh: m.veh ? Object.fromEntries(S.VEH.map(v => [v, r1(m.veh[v] || 0)])) : null, lord: lord ? lord.name : '',
      stock: Object.fromEntries(S.GOODS.map(g => [g, Math.round(m.stock[g])])), ratio: Object.fromEntries(S.GOODS.map(g => [g, +(m.ratio?.[g] ?? 1).toFixed(2)]))};
  });
  const fac = K.fac.filter(f => f.alive).map(f => {
    const r = K.heroes.find(h => h.id === f.ruler);
    const veh = Object.fromEntries(S.VEH.map(v => [v, 0]));
    for (const tw of towns) if (K.owner[tw.t] === f.id && tw.veh) for (const v of S.VEH) veh[v] += tw.veh[v];
    for (const v of S.VEH) veh[v] = r1(veh[v]);
    return {id: f.id, n: f.n, c: f.c, cap: f.cap, born: f.born, pop: Math.round(P[f.id] || 0), tiles: T[f.id] || 0, bloc: f.bloc || 0, league: f.league || 0,
      free: !!f.free, works: !!f.works, native: !!f.native, liege: f.liege, clones: Math.round(f.clones || 0), taboo: +(f.taboo || 0).toFixed(2), ruler: r ? r.name : '', vats: f.vats || 0, veh};
  });
  const wars = [];
  for (let a = 0; a < K.war.length; a++) for (let b = a + 1; b < K.war.length; b++) { const W = K.war[a][b]; if (W && W.att !== undefined && K.fac[a].alive && K.fac[b].alive) wars.push({att: W.att, def: W.def, goal: W.goal, start: W.start, siege: W.siege ? W.siege.t : -1}); }
  const gangs = K.gangs.filter(g => !g.gone).map(g => ({name: g.name, lair: g.lair, native: !!g.native, str: Math.round(g.str), legacy: K.weapons.some(x => x.gang === g.id)}));
  const weapons = L.weapons.map(x => ({name: x.name, kind: x.kind, at: x.at, holder: x.holder ? x.holderName : '', fac: x.fac >= 0 ? K.fac[x.fac]?.n : '', gang: x.gang ? x.gangName : '', lost: x.lost, sealed: x.sealed, owners: x.owners || 0, wins: x.wins || 0}));
  const ev = w.events.slice(lastEv).filter(e => e.y === y || e.y === y - 1 || e.y === 0); lastEv = w.events.length;
  return {y, owner, pop, trench, bandit, biome: Uint8Array.from(K.biome), towns, fac, wars, gangs, weapons,
    blocs: (K.ARC.blocs || []).filter(B => !B.gone).map(B => ({id: B.id, n: B.n, lead: B.lead})), leagues: (K.leagues || []).map(x => ({id: x.id, n: x.n})),
    arc: {ackY: K.ARC.ackY, fallY: K.ARC.fallY, blocY: K.ARC.blocY, elevator: K.ARC.elevator, phase: K.ARC.phase},
    opps: sim.opportunities(),
    events: ev.map(e => ({y: e.y, type: e.type, text: e.text, tile: e.tile}))};
}

function loop() {
  if (!running) return;
  if (sim.year >= target) { running = false; postMessage({type: 'idle', year: sim.year}); return; }
  sim.stepYear();
  postMessage({type: 'year', data: snapshot()});
  setTimeout(loop, 0);
}

// ===== 公司模式：沙盒停在當下這一年，改用小時推進；每過 yearDays 天，沙盒推一年 =====
let game = null, clock = null;
function gview(err) { postMessage({type: 'game', err: err || null, year: sim.year, speed: game.speed, yearDays: game.yearDays,
  inbox: game.book.inbox.filter(x => x.player === game.G.name).slice(-30).reverse(), data: G.view(game.G, game.book, w)}); }
function gtick() {
  if (!game || !game.speed) return;
  game.acc += game.speed / 4; let n = 0, yearDone = false;
  while (game.acc >= 1 && n < 48) {
    game.acc--; n++; const h = ++game.h;
    C.tick(game.book, w, h); G.hour(game.G, game.book, w, h);
    if (h % (24 * game.yearDays) === 0) { sim.stepYear(); yearDone = true; }
  }
  if (yearDone) postMessage({type: 'year', data: snapshot()});
  gview();
}
function act(m) {
  const g = game.G, b = game.book, h = game.h;
  if (m.type === 'speed') { game.speed = m.v; return null; }
  if (m.type === 'yearDays') { game.yearDays = Math.max(3, Math.min(365, m.v | 0)); return null; }
  if (m.type === 'buy') return G.buy(g, w, m.mat, m.qty);
  if (m.type === 'build') return G.build(g, m.recipe, m.tpl);
  if (m.type === 'keep') { const c = g.roster.find(x => x.uid === m.uid); if (c) c.keep = !c.keep; return null; }
  if (m.type === 'accept') { const o = sim.opportunities().find(x => x.kind === m.kind && x.tile === m.tile); if (!o) return '這個機會已經不在了'; return G.accept(g, b, w, o, m.side, m.uids, h); }
  if (m.type === 'reinforce') return G.reinforce(g, b, w, m.squad, m.uids, h);
  if (m.type === 'recall') return G.recall(g, b, w, m.squad, h);
  if (m.type === 'recallCol') return G.recallColumn(g, b, w, m.amend, h);
  if (m.type === 'path') { const path = w.sim.pmc.route(g.base, m.to); postMessage({type: 'path', to: m.to, path, hours: path.length ? C.travelHours(w, g.base, m.to) : -1}); return null; }
  if (m.type === 'procure') return G.procure(g, b, w, m.town, m.mat, m.qty, m.uids || [], h);
  if (m.type === 'quotes') { postMessage({type: 'quotes', data: G.quotes(g, w)}); return null; }
  if (m.type === 'resolve') { C.resolveNow(b, w, m.ticket, h); G.hour(g, b, w, h); return null; }
  // 親自打（ASH 任務戰鬥）：把任務票和小隊交給畫面去開 iframe；打的時候公司的時間停住
  if (m.type === 'fight') {
    const tk = b.tickets.find(x => x.id === m.ticket && !x.done && x.player === g.name), sq = tk && b.squads[tk.squad];
    if (!sq) return '這張票已經不在了';
    const squad = sq.clones.filter(c => c.alive).slice(0, 4).map(c => ({id: c.id, cls: c.cls || 'soldier', portrait: c.portrait, st: c.st || {hp: 100}}));
    if (!squad.length) return '這一隊沒有活著的人';
    let seed = 7; for (const ch of tk.id + ':' + h) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    if (game.fighting == null) game.fighting = game.speed; game.speed = 0;
    postMessage({type: 'mission', data: {id: tk.id, title: tk.title, seed: seed % 1000000, faction: tk.enemy.side === 'faction' ? 'loyalist' : 'rebel', night: tk.night, enemy: tk.enemy, squad}});
    return null;
  }
  if (m.type === 'submit' || m.type === 'abort') {
    if (game.fighting != null) { game.speed = game.fighting; game.fighting = null; }
    if (m.type === 'abort') return null;
    const tk = b.tickets.find(x => x.id === m.ticket && !x.done), sq = tk && b.squads[tk.squad];
    if (!sq) return '這張票已經結算了';
    const win = !!m.result.win, dead = (m.result.dead || []).filter(id => sq.clones.some(c => c.id === id && c.alive));
    const wipe = !sq.clones.some(c => c.alive && !dead.includes(c.id));
    C.submit(b, w, tk.id, {win, dead, done: C.objectivesDone(tk, win, dead, wipe)}, h); G.hour(g, b, w, h); return null;
  }
  return '不認得的指令';
}

onmessage = e => {
  const m = e.data;
  if (m.type === 'found') {
    running = false;
    game = {book: C.newBook(m.base * 31 + 7), G: G.newCompany(w, m.base, m.name || '我的公司', m.base * 17 + 3), h: 0, acc: 0, speed: 3, yearDays: 30};
    clearInterval(clock); clock = setInterval(gtick, 250); gview(); return;
  }
  if (game && ['speed', 'yearDays', 'buy', 'build', 'keep', 'accept', 'reinforce', 'resolve', 'fight', 'submit', 'abort', 'procure', 'quotes', 'recall', 'recallCol', 'path'].includes(m.type)) { const err = act(m); gview(err); return; }
  if (m.type === 'start') {
    running = false; lastEv = 0; game = null; clearInterval(clock);
    w = S.generate(m.seed, {history: false}); sim = w.sim; sim.begin();
    postMessage({type: 'static', seed: m.seed, W: S.W, H: S.H, N: S.N, names: w.names, land: w.land, river: Array.from(w.river), biomes: S.BIOMES.map(b => ({n: b.n, c: b.c})), goods: S.GOODS, gn: S.GN, vn: S.VN});
    postMessage({type: 'year', data: snapshot()});
    target = m.years || S.YEARS; running = true; loop();
  } else if (m.type === 'more') { target = sim.year + (m.years || 50); if (!running) { running = true; loop(); } }
  else if (m.type === 'stop') running = false;
};
