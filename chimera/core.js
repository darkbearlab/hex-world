// 奇美拉的遊戲核心（伺服器化 S0，warband/DESIGN.md「伺服器化實作計畫」）：沙盒、帳本、公司，收指令、吐畫面資料。
// 不碰 postMessage、不管時間怎麼走：瀏覽器的 public/worker.js 用加速時鐘推它（單人測試模式），之後伺服器用現實時鐘推。
// 一切亂數都來自種子與帳本（沒有 Math.random），同樣的「指令＋發生的遊戲小時」重播出同樣的結果（stats/core-replay.mjs 驗證），
// 伺服器的存檔＝快照＋指令紀錄（log）。
import * as S from './sim.js';
import * as C from './cases.js';
import * as G from './company.js';

const r1 = v => Math.round(v * 10) / 10;
// 會改變遊戲狀態、要記進指令紀錄的指令（path、quotes 只是查詢）
export const COMMANDS = ['speed', 'yearDays', 'buy', 'build', 'keep', 'accept', 'reinforce', 'resolve', 'fight', 'submit', 'abort', 'procure', 'recall', 'recallCol'];
export const QUERIES = ['path', 'quotes'];
export const YEARS = S.YEARS;   // 推演多少年才開放開公司（globalThis.YEARS 可改）

export class Core {
  // emit(msg)：送畫面資料（static、year、idle、game、path、quotes、mission）
  constructor(emit) { this.emit = emit; this.w = null; this.sim = null; this.game = null; this.lastEv = 0; this.log = []; }

  // ---- 沙盒 ----
  start(seed) {
    this.game = null; this.lastEv = 0; this.log = [];
    this.w = S.generate(seed, {history: false}); this.sim = this.w.sim; this.sim.begin(); this.seed = seed;
    this.emit({type: 'static', seed, W: S.W, H: S.H, N: S.N, names: this.w.names, land: this.w.land, river: Array.from(this.w.river), biomes: S.BIOMES.map(b => ({n: b.n, c: b.c})), goods: S.GOODS, gn: S.GN, vn: S.VN});
    this.emit({type: 'year', data: this.snapshot()});
  }
  stepYear() { this.sim.stepYear(); this.emit({type: 'year', data: this.snapshot()}); }
  get year() { return this.sim.year; }

  snapshot() {
    const {sim, w} = this, K = sim.peek(), L = sim.legendData(), y = sim.year;
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
    const ev = w.events.slice(this.lastEv).filter(e => e.y === y || e.y === y - 1 || e.y === 0); this.lastEv = w.events.length;
    return {y, owner, pop, trench, bandit, biome: Uint8Array.from(K.biome), towns, fac, wars, gangs, weapons,
      blocs: (K.ARC.blocs || []).filter(B => !B.gone).map(B => ({id: B.id, n: B.n, lead: B.lead})), leagues: (K.leagues || []).map(x => ({id: x.id, n: x.n})),
      arc: {ackY: K.ARC.ackY, fallY: K.ARC.fallY, blocY: K.ARC.blocY, elevator: K.ARC.elevator, phase: K.ARC.phase},
      opps: this.sim.opportunities(),
      events: ev.map(e => ({y: e.y, type: e.type, text: e.text, tile: e.tile}))};
  }

  // ---- 公司模式：沙盒停在當下這一年，改用小時推進；每過 yearDays 天，沙盒推一年 ----
  // 現實時間一比一時 yearDays 暫定 90（Alan 2026-10-08，可能就是一個賽季）
  found(base, name) {
    this.game = {book: C.newBook(base * 31 + 7), G: G.newCompany(this.w, base, name || '我的公司', base * 17 + 3), h: 0, speed: 3, yearDays: 90};
    this.log = [{h: 0, year: this.sim.year, cmd: {type: 'found', base, name}}];
    this.view();
  }
  get hour() { return this.game ? this.game.h : 0; }
  // 推進到第 h 個遊戲小時（伺服器：依現實時間補算；瀏覽器：加速時鐘）
  advanceTo(h) {
    const game = this.game; if (!game) return;
    let yearDone = false;
    while (game.h < h) {
      const t = ++game.h;
      C.tick(game.book, this.w, t); G.hour(game.G, game.book, this.w, t);
      if (t % (24 * game.yearDays) === 0) { this.sim.stepYear(); yearDone = true; }
    }
    if (yearDone) this.emit({type: 'year', data: this.snapshot()});
  }
  // 通知信指向哪裡：任務票（還沒打的可以直接親自打）、案件、補員縱隊所在的地圖位置
  mailRef(x) {
    const b = this.game.book; if (!x.ref) return {};
    const tk = b.tickets.find(t => t.id === x.ref);
    if (tk) return {tile: tk.tile, fight: !tk.done && tk.player === this.game.G.name && tk.squad ? tk.id : null};
    const c = b.cases.find(k => k.id === x.ref); if (c) return {tile: c.tile};
    const am = b.amends.find(k => k.id === x.ref), ac = am && b.cases.find(k => k.id === am.caseId); if (ac) return {tile: ac.tile};
    return {};
  }
  view(err) {
    const game = this.game;
    this.emit({type: 'game', err: err || null, year: this.sim.year, speed: game.speed, yearDays: game.yearDays,
      inbox: game.book.inbox.filter(x => x.player === game.G.name).slice(-30).reverse().map(x => ({...x, ...this.mailRef(x)})), data: G.view(game.G, game.book, this.w)});
  }
  // 指令：會改狀態的記進 log（遊戲小時＋指令），回傳錯誤訊息或 null
  command(m) {
    if (!this.game) return '還沒開公司';
    if (COMMANDS.includes(m.type)) this.log.push({h: this.game.h, cmd: m});
    return this.act(m);
  }
  act(m) {
    const {w, sim} = this, game = this.game, g = game.G, b = game.book, h = game.h;
    if (m.type === 'speed') { game.speed = m.v; return null; }
    if (m.type === 'yearDays') { game.yearDays = Math.max(3, Math.min(365, m.v | 0)); return null; }
    if (m.type === 'buy') return G.buy(g, w, m.mat, m.qty);
    if (m.type === 'build') return G.build(g, m.recipe, m.tpl);
    if (m.type === 'keep') { const c = g.roster.find(x => x.uid === m.uid); if (c) c.keep = !c.keep; return null; }
    if (m.type === 'accept') { const o = sim.opportunities().find(x => x.kind === m.kind && x.tile === m.tile); if (!o) return '這個機會已經不在了'; return G.accept(g, b, w, o, m.side, m.uids, h); }
    if (m.type === 'reinforce') return G.reinforce(g, b, w, m.squad, m.uids, h);
    if (m.type === 'recall') return G.recall(g, b, w, m.squad, h);
    if (m.type === 'recallCol') return G.recallColumn(g, b, w, m.amend, h);
    if (m.type === 'path') { const path = w.sim.pmc.route(g.base, m.to); this.emit({type: 'path', to: m.to, path, hours: path.length ? C.travelHours(w, g.base, m.to) : -1}); return null; }
    if (m.type === 'procure') return G.procure(g, b, w, m.town, m.mat, m.qty, m.uids || [], h);
    if (m.type === 'quotes') { this.emit({type: 'quotes', data: G.quotes(g, w)}); return null; }
    if (m.type === 'resolve') { C.resolveNow(b, w, m.ticket, h); G.hour(g, b, w, h); return null; }
    // 親自打（ASH 任務戰鬥）：把任務票和小隊交給畫面去開戰；打的時候公司的時間停住
    if (m.type === 'fight') {
      const tk = b.tickets.find(x => x.id === m.ticket && !x.done && x.player === g.name), sq = tk && b.squads[tk.squad];
      if (!sq) return '這張票已經不在了';
      const squad = sq.clones.filter(c => c.alive).slice(0, 4).map(c => ({id: c.id, cls: c.cls || 'soldier', portrait: c.portrait, st: c.st || {hp: 100},
        lv: c.lv || 1, xp: c.xp || 0, picks: c.picks || [], skills: c.skills || [], prep: c.prep || null, perkPicks: c.perkPicks || 0, classPerkMisses: c.classPerkMisses || 0, legacyPerkPicks: c.legacyPerkPicks || 0}));
      if (!squad.length) return '這一隊沒有活著的人';
      let seed = 7; for (const ch of tk.id + ':' + h) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
      if (game.fighting == null) game.fighting = game.speed; game.speed = 0;
      this.emit({type: 'mission', data: {id: tk.id, title: tk.title, seed: seed % 1000000, faction: tk.enemy.side === 'faction' ? 'loyalist' : 'rebel', night: tk.night, enemy: tk.enemy, squad}});
      return null;
    }
    if (m.type === 'submit' || m.type === 'abort') {
      if (game.fighting != null) { game.speed = game.fighting; game.fighting = null; }
      if (m.type === 'abort') return null;
      const tk = b.tickets.find(x => x.id === m.ticket && !x.done), sq = tk && b.squads[tk.squad];
      if (!sq) return '這張票已經結算了';
      const win = !!m.result.win, dead = (m.result.dead || []).filter(id => sq.clones.some(c => c.id === id && c.alive));
      const wipe = !sq.clones.some(c => c.alive && !dead.includes(c.id));
      // 成長寫回名冊（等級、經驗、升級三選一、技能、預備欄），升級的人另外發一則通知
      const ups = [];
      for (const [id, pr] of Object.entries(m.result.progress || {})) {
        const c = sq.clones.find(x => x.id === id); if (!c || !pr) continue;
        if ((pr.lv || 1) > (c.lv || 1)) ups.push(`${c.id} ${c.lv || 1}→${pr.lv} 級${(pr.skills || []).length > (c.skills || []).length ? `，學會了${pr.skills.filter(s => !(c.skills || []).includes(s)).map(s => G.SKILL_NAME[s] || s).join('、')}` : ''}`);
        Object.assign(c, {lv: pr.lv, xp: pr.xp, picks: pr.picks, skills: pr.skills, prep: pr.prep, perkPicks: pr.perkPicks, classPerkMisses: pr.classPerkMisses, legacyPerkPicks: pr.legacyPerkPicks});
      }
      C.submit(b, w, tk.id, {win, dead, done: C.objectivesDone(tk, win, dead, wipe)}, h);
      if (ups.length) b.inbox.push({t: h, player: g.name, kind: 'result', text: `${tk.title}：升級　${ups.join('；')}`, ref: tk.id});
      G.hour(g, b, w, h); return null;
    }
    return '不認得的指令';
  }

  // 重播：在全新的核心上，照「發生的遊戲小時」重新下同樣的指令（存檔＝起始種子＋指令紀錄；第一筆記著開公司那一年）
  replay(seed, log, untilHour = null) {
    this.start(seed);
    for (const e of log) {
      if (e.cmd.type === 'found') { while (this.sim.year < e.year) this.sim.stepYear(); this.found(e.cmd.base, e.cmd.name); continue; }
      this.advanceTo(e.h); this.command(e.cmd);
    }
    if (untilHour != null) this.advanceTo(untilHour);
  }
  // 狀態指紋：比對兩個核心是不是一模一樣（帳本＋公司＋沙盒的年份與時間）
  fingerprint() {
    const K = this.sim.peek(), world = {owner: Array.from(K.owner), pop: Array.from(K.pop), bandit: Array.from(K.bandit), trench: Array.from(K.trench), stock: Object.entries(K.markets).map(([t, m]) => [t, m.stock, m.veh]), gangs: K.gangs.map(g => [g.id, g.str, g.gone])};
    const s = JSON.stringify({y: this.sim.year, h: this.game?.h, book: this.game?.book, G: this.game?.G, world});
    let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16) + ':' + s.length;
  }
}
