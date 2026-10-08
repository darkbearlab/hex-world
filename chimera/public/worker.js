// 在背景推演奇美拉星球：開局後一年一年推進，每推完一年就把那一年的樣子送回畫面
import * as S from './sim.js';

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

onmessage = e => {
  const m = e.data;
  if (m.type === 'start') {
    running = false; lastEv = 0;
    w = S.generate(m.seed, {history: false}); sim = w.sim; sim.begin();
    postMessage({type: 'static', seed: m.seed, W: S.W, H: S.H, N: S.N, names: w.names, land: w.land, river: Array.from(w.river), biomes: S.BIOMES.map(b => ({n: b.n, c: b.c})), goods: S.GOODS, gn: S.GN, vn: S.VN});
    postMessage({type: 'year', data: snapshot()});
    target = m.years || S.YEARS; running = true; loop();
  } else if (m.type === 'more') { target = sim.year + (m.years || 50); if (!running) { running = true; loop(); } }
  else if (m.type === 'stop') running = false;
};
