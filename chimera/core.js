// 奇美拉的遊戲核心（伺服器化 S0，warband/DESIGN.md「伺服器化實作計畫」）：沙盒、帳本、公司，收指令、吐畫面資料。
// 不碰 postMessage、不管時間怎麼走：瀏覽器的 public/worker.js 用加速時鐘推它（單人測試模式），之後伺服器用現實時鐘推。
// 一切亂數都來自種子與帳本（沒有 Math.random），同樣的「指令＋發生的遊戲小時」重播出同樣的結果（stats/core-replay.mjs 驗證），
// 伺服器的存檔＝快照＋指令紀錄（log）。
import * as S from './sim.js';
import * as C from './cases.js';
import * as G from './company.js';
import {ensureNpcs, npcHour} from './npc.js';

const r1 = v => Math.round(v * 10) / 10;
// 會改變遊戲狀態、要記進指令紀錄的指令（path、quotes 只是查詢）
const BOARD_COOL = 24;   // 委託結束後冷卻多久才再公開（Alan 2026-10-09）
// 沙盒一年幾天（現實時間）：四季，每季結算一次戰事
export const SEASONAL_YEAR_DAYS = 56;
export const COMMANDS = ['speed', 'yearDays', 'buy', 'build', 'keep', 'accept', 'reinforce', 'resolve', 'fight', 'submit', 'abort', 'procure', 'recall', 'recallCol', 'read', 'claim', 'revive', 'clean', 'merge', 'tag', 'equip', 'sell', 'shop', 'mod'];
export const QUERIES = ['path', 'quotes'];
export const YEARS = S.YEARS;   // 推演多少年才開放開公司（globalThis.YEARS 可改）

export class Core {
  // emit(msg)：送畫面資料（static、year、idle、game、path、quotes、mission）
  constructor(emit) { this.emit = emit; this.w = null; this.sim = null; this.game = null; this.lastEv = 0; this.log = []; }

  // ---- 沙盒 ----
  start(seed) {
    this.game = null; this.lastEv = 0; this.log = [];
    this.w = S.generate(seed, {history: false}); this.sim = this.w.sim; this.sim.begin(); this.seed = seed;
    this.emitStatic();
    this.emit({type: 'year', data: this.snapshot()});
  }
  // 不會變的資料（地形、地名、河流、貨物名稱）：連上時送一次
  emitStatic() { this.emit({type: 'static', seed: this.seed, W: S.W, H: S.H, N: S.N, names: this.w.names, land: this.w.land, river: Array.from(this.w.river), biomes: S.BIOMES.map(b => ({n: b.n, c: b.c})), goods: S.GOODS, gn: S.GN, vn: S.VN}); }
  stepYear() { this.sim.stepYear(); this.emit({type: 'year', data: this.snapshot()}); }
  get year() { return this.sim.year; }
  // 沙盒結算到哪裡（年×4＋這一年已結算的季）：每季結算一次，畫面照這個判斷要不要拉新的地圖
  get stamp() { const q = this.sim.season || 0; return (this.sim.year - (q ? 1 : 0)) * 4 + q; }

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
    const gangs = K.gangs.filter(g => !g.gone).map(g => ({name: g.name, lair: g.lair, native: !!g.native, hive: C.isHive(K, g), str: Math.round(g.str), legacy: K.weapons.some(x => x.gang === g.id)}));
    const weapons = L.weapons.map(x => ({name: x.name, kind: x.kind, at: x.at, holder: x.holder ? x.holderName : '', fac: x.fac >= 0 ? K.fac[x.fac]?.n : '', gang: x.gang ? x.gangName : '', lost: x.lost, sealed: x.sealed, owners: x.owners || 0, wins: x.wins || 0}));
    const ev = w.events.slice(this.lastEv).filter(e => e.y === y || e.y === y - 1 || e.y === 0); this.lastEv = w.events.length;
    return {y, stamp: this.stamp, campaigns: sim.campaignView(), owner, pop, trench, bandit, biome: Uint8Array.from(K.biome), towns, fac, wars, gangs, weapons,
      blocs: (K.ARC.blocs || []).filter(B => !B.gone).map(B => ({id: B.id, n: B.n, lead: B.lead})), leagues: (K.leagues || []).map(x => ({id: x.id, n: x.n})),
      arc: {ackY: K.ARC.ackY, fallY: K.ARC.fallY, blocY: K.ARC.blocY, elevator: K.ARC.elevator, phase: K.ARC.phase},
      opps: this.sim.opportunities(),
      events: ev.map(e => ({y: e.y, type: e.type, text: e.text, tile: e.tile}))};
  }

  // ---- 公司模式：沙盒停在當下這一季，改用小時推進；每過 yearDays/4 天，沙盒推一季（結算一次戰事），四季一年 ----
  // 一顆共用的星球（伺服器化 S1）：一本帳本、很多家公司（以公司名稱區分）、一個時鐘。單人測試模式就是只有一家。
  // 現實時間一比一時 yearDays＝56：每兩週結算一季、八週一年（Alan 2026-10-09：兩週結算；原本 90 天一次推一整年）
  // this.game = {book, cos: {公司名: 公司}, h: 現在第幾個遊戲小時, yearDays, speed（只有單人測試的加速時鐘用）}
  co(name) { return this.game?.cos[name] || null; }
  // NPC 傭兵公司：伺服器開（NPC 環境變數不是 0 時），開出還沒有的 NPC 公司
  enableNpcs() { this.npcOn = true; ensureNpcs(this); if (this.game) this.game.book.npcs = Object.values(this.game.cos).filter(g => g.npc).map(g => g.name); }
  get hour() { return this.game ? this.game.h : 0; }
  // 星球開始用小時推進（伺服器開服時；單人測試模式在開第一家公司時）
  open() {
    if (this.game) return;
    let seed = 7; for (const ch of String(this.seed)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    this.game = {book: C.newBook(seed % 1000000 + 7), cos: {}, h: 0, speed: 3, yearDays: SEASONAL_YEAR_DAYS, seasonal: true};
    this.log = [{h: 0, year: this.sim.year, cmd: {type: 'open'}}];
    this.sim.setCampaigns(true);   // 大戰役只在照小時推進時開
  }
  // 開公司（任何一座主城）。第一家公司開張時星球改用小時推進。回傳錯誤訊息或 null
  found(base, name) {
    name = String(name || '').trim().slice(0, 16) || '我的公司';
    const K = this.sim.peek();
    if (!K.markets[base] || K.owner[base] < 0) return '這裡不能開公司';
    if (this.game?.cos[name]) return '這個名字已經有人用了';
    if (!this.game) this.open();
    this.log.push({h: this.game.h, year: this.sim.year, who: name, cmd: {type: 'found', base, name}});
    const g = G.newCompany(this.w, base, name, base * 17 + 3 + Object.keys(this.game.cos).length * 7919, this.game.book);
    g.h = this.game.h; this.game.cos[name] = g;
    return null;
  }
  // ---- 後台：上帝視角（Alan 2026-10-09）。整顆星球的現況，只給管理員看（server/worker.js admin/world） ----
  adminView(accounts = {}) {
    const game = this.game, K = this.sim.peek(), w = this.w, nm = t => w.names[t] || (t >= 0 ? `#${t}` : '—'), fn = f => K.fac[f]?.n || '—';
    const S = this.sim.exportState(), facPop = {}, facTiles = {};
    for (let i = 0; i < K.owner.length; i++) if (K.owner[i] >= 0) { facPop[K.owner[i]] = (facPop[K.owner[i]] || 0) + K.pop[i]; facTiles[K.owner[i]] = (facTiles[K.owner[i]] || 0) + 1; }
    const mk = Object.entries(K.markets).map(([t, m]) => ({t: +t, m})), r1 = x => Math.round(x * 10) / 10;
    const facs = K.fac.filter(f => f.alive).map(f => {
      const ms = mk.filter(x => K.owner[x.t] === f.id), sum = g => r1(ms.reduce((a, x) => a + (x.m.stock[g] || 0), 0)), veh = {};
      for (const x of ms) for (const [v, n] of Object.entries(x.m.veh || {})) veh[v] = r1((veh[v] || 0) + n);
      return {id: f.id, n: f.n, c: f.c, cap: nm(f.cap), pop: Math.round(facPop[f.id] || 0), tiles: facTiles[f.id] || 0, towns: ms.length, clones: Math.round(f.clones || 0), vats: f.vats || 0, merc: Math.round(f.merc || 0),
        aggr: r1(f.aggr || 0), taboo: r1(f.taboo || 0), aid: Math.round(S.pmcAid?.[f.id] || 0), exhaust: r1(f.exhaust || 0), shock: r1(f.shock || 0), kind: f.works ? '工廠群' : f.free ? '自由城市' : f.native ? '根者' : '正規軍',
        stock: {food: sum('food'), water: sum('water'), ammo: sum('ammo'), fuel: sum('fuel'), parts: sum('parts')}, price: f.price ? Object.fromEntries(Object.entries(f.price).map(([k, v]) => [k, Math.round(v * 100) / 100])) : null, veh};
    }).sort((a, b) => b.pop - a.pop);
    const wars = []; for (const row of S.war) for (const W of row) if (W && W.att !== undefined) wars.push({att: fn(W.att), def: fn(W.def), goal: nm(W.goal), siege: W.siege ? `${nm(W.siege.t)}（第 ${W.siege.prog} 季）` : '', since: W.start, end: W.end, score: W.score, camp: W.camp || 0});
    const gangs = K.gangs.filter(g => !g.gone).map(g => ({name: g.name, lair: nm(g.lair), str: Math.round(g.str), kind: g.native ? '根者' : C.isHive(K, g) ? '巢匪' : K.weapons.some(x => x.gang === g.id) ? '軍閥' : '掠奪者', chief: g.chief || '', bossDefeats: g.bossDefeats || 0, bandit: Math.round(K.bandit[g.lair] || 0)})).sort((a, b) => b.str - a.str);
    const weapons = K.weapons.map(x => ({name: x.name, kind: x.kind, bonus: x.bonus, who: x.pmc ? `傭兵公司 ${x.pmc}` : x.holder ? `英雄 ${x.holderName || x.holder}` : x.gang ? `幫派 ${K.gangs.find(g => g.id === x.gang)?.name || x.gang}` : x.fac >= 0 ? `${fn(x.fac)}的軍械庫` : x.lost ? `遺落在${nm(x.loc)}${x.sealed ? '（封在舊倉庫）' : ''}` : '—'}));
    const out = {now: {hour: this.hour, year: this.year, season: this.sim.season, stamp: this.stamp, yearDays: game?.yearDays, seasonHours: game ? Math.round(24 * game.yearDays / 4) : 0},
      factions: facs, wars, campaigns: this.sim.campaignView(), gangs, weapons, events: S.events.slice(-300).map(e => ({y: e.y, type: e.type, text: e.text, tile: nm(e.tile)}))};
    if (!game) return out;
    const b = game.book, h = game.h;
    out.board = Object.values(b.board || {}).map(e => ({kind: e.opp.kind, title: e.opp.title, detail: e.opp.detail, tile: nm(e.opp.tile), lv: e.opp.lv, start: e.start, end: e.end, gone: !!e.gone, cases: Object.keys(e.cases).length})).filter(e => h < e.end + 24);
    out.cases = b.cases.filter(c => !c.settled || h - (c.settledAt || 0) < 72).map(c => ({id: c.id, kind: c.kind, title: c.title, lv: c.lv, tile: nm(c.tile), start: c.start, end: c.end, open: c.open, settled: c.settled,
      squads: c.squads.map(id => b.squads[id]).filter(Boolean).map(s => ({name: s.name, player: s.player, alive: s.clones.filter(x => x.alive).length, busy: !!s.busy, id: s.id, readyAt: s.readyAt, headedHome: s.headedHome ?? null, status: s.clones.filter(x => x.alive).map(x => x.status).join(','),
        openTickets: b.tickets.filter(t => t.squad === s.id && !t.done).map(t => t.id)})), closedAt: c.closedAt ?? null, own: !!c.own,
      score: Object.fromEntries(Object.entries(c.score).map(([k, v]) => [k, r1(v)])), tickets: b.tickets.filter(t => t.caseId === c.id).length, open_tickets: b.tickets.filter(t => t.caseId === c.id && !t.done).length, payout: c.payout || null}));
    out.companies = Object.values(game.cos).map(G => {
      const R = G.roster, st = {}; for (const c of R) { const k = c.alive ? c.status : 'kia'; st[k] = (st[k] || 0) + 1; }
      const led = b.ledger.filter(x => x.player === G.name), by = {}; for (const x of led) by[x.kind] = (by[x.kind] || 0) + x.amount;
      return {name: G.name, npc: !!G.npc, account: accounts[G.name] || '', base: nm(G.base), cash: Math.round(G.cash), lossBook: Math.round(G.lossBook || 0), roster: R.length, status: st, maxLv: Math.max(0, ...R.filter(c => c.alive).map(c => c.lv || 1)),
        cases: G.cases.length, building: G.queue.filter(q => !q.ready).length, store: (G.store || []).length, ledger: by, log: G.log.slice(-12).map(x => ({h: x.h, text: x.text}))};
    }).sort((a, b) => b.cash - a.cash);
    out.tickets = b.tickets.filter(t => !t.done).map(t => ({id: t.id, title: t.title, player: t.player || '（等人接）', enemies: Object.values(t.enemy.units || {}).reduce((a, x) => a + x, 0), power: t.enemy.power, deadline: t.deadline, wave: t.wave || null}));
    return out;
  }
  // 大戰役的消息發給每一家公司（開打、行情翻倍、壓上存底、結束）
  campaignNews(e, t) {
    const c = e.c, K = this.sim.peek(), fn = f => K.fac[f]?.n || '?', nm = this.w.names[c.n] || '某地', side = e.side === 'a' ? c.att : c.def;
    const text = e.kind === 'start' ? `大戰役：${fn(c.att)}與${fn(c.def)}在${nm}全國動員，開打了。` : e.kind === 'price' ? `${nm}大戰役：${fn(side)}的兵快見底，傭兵行情漲到 ×${e.mul}。`
      : e.kind === 'reserve' ? `${nm}大戰役：${fn(e.f)}把後方的守軍和剛出槽的兵都壓上前線。` : `${nm}大戰役結束：${fn(e.win)}${e.took ? `奪下${nm}` : '獲勝'}（打了 ${Math.max(1, Math.round(c.round / 4))} 天）。`;
    for (const name of Object.keys(this.game.cos)) this.game.book.inbox.push({t, player: name, kind: 'war', text, ref: 'camp' + c.id});
  }
  // 推進到第 h 個遊戲小時（伺服器：依現實時間補算；瀏覽器：加速時鐘）。回傳這段期間沙盒有沒有結算（推了一季）
  advanceTo(h) {
    const game = this.game; if (!game) return false;
    let yearDone = false;
    while (game.h < h) {
      const t = ++game.h;
      C.tick(game.book, this.w, t);
      this.postBoard(t);
      for (const g of Object.values(game.cos)) G.hour(g, game.book, this.w, t);
      G.bodiesHour(game.cos, game.book, this.w, t);
      for (const e of this.sim.campaignHour(t)) this.campaignNews(e, t);
      if (this.npcOn) npcHour(this, t);   // NPC 傭兵公司（npc.js；伺服器才開）
      if (t % Math.max(1, Math.round(24 * game.yearDays / 4)) === 0) { this.sim.stepSeason(); yearDone = true; }
    }
    if (yearDone) this.emit({type: 'year', data: this.snapshot()});
    return yearDone;
  }
  // 委託板（Alan 2026-10-09）：機會跟著伺服器時間跑。沙盒裡的每個機會（種類＋地點）在板上公開一次，案期三天從公開起算，
  // 不管有沒有人接；同一個委託大家共用同一個案件（各自算積分、各分尾款）。公開時刻依地點錯開（0～23 小時）；
  // 結束後冷卻一天，沙盒的問題還在就再公開；問題不在了：還沒公開的拿掉，進行中的標記 gone（不能再接，已經接的照常打完）。
  postBoard(h) {
    const book = this.game.book, first = !book.board, B = book.board ||= {}, seen = new Set();
    for (const o of this.sim.opportunities()) {
      const key = o.kind + ':' + o.tile, e = B[key]; seen.add(key);
      // 公開時刻依地點錯開。第一批（星球剛開）往前錯開 0～47 小時，當作開服前就公開了：一開服就有委託可接，而且進度各不相同
      // 大戰役的委託：一開打就公開，開到戰役結束（opportunities 不再列出時就收掉）
      if (!e && o.kind === 'camp') { B[key] = {key, opp: o, start: h, end: h + 24 * 14, cases: {}}; continue; }
      if (!e) { let s = 7; for (const ch of key) s = (s * 31 + ch.charCodeAt(0)) >>> 0; const st = first ? h - s % 48 : h + s % 24; B[key] = {key, opp: o, start: st, end: st + C.CFG.CASE_HOURS, cases: {}}; continue; }
      e.opp = o; e.gone = false;
      if (h >= e.end + BOARD_COOL) { e.start = h; e.end = h + C.CFG.CASE_HOURS; e.cases = {}; }
    }
    for (const [key, e] of Object.entries(B)) if (!seen.has(key)) { if (h < e.start || h >= e.end + BOARD_COOL) delete B[key]; else e.gone = true; }
  }
  // 一家公司看得到的委託：已經公開、還能接的；加上自己接了、還沒結束的
  boardView(name) {
    if (!this.game.book.board) this.postBoard(this.game.h);   // 還沒公開過（星球剛開、還沒過第一個整點）
    const book = this.game.book, h = this.game.h, g = this.co(name), mine = new Set(g?.cases || []);
    return Object.values(book.board || {}).map(e => {
      const ids = Object.values(e.cases), joined = ids.some(id => mine.has(id)), cs = ids.map(id => book.cases.find(c => c.id === id)).filter(Boolean);
      const n = new Set(cs.flatMap(c => c.squads.map(s => book.squads[s]?.player).filter(Boolean))).size;
      const side = Object.entries(e.cases).find(([, id]) => mine.has(id))?.[0];   // 自己接的是哪一邊（大戰役加派時沿用）
      return {...e.opp, key: e.key, start: e.start, end: e.end, closeAt: e.end - C.CFG.FREEZE, gone: !!e.gone, joined, side, n};
    }).filter(e => h >= e.start && ((h < e.closeAt && !e.gone) || (e.joined && h < e.end)));
  }
  // 準時出槽：時間（帶小數的遊戲小時）到了的培養槽出槽。回傳出槽了幾個
  finishDue(t) { if (!this.game) return 0; let n = C.exactTick(this.game.book, this.w, t); for (const g of Object.values(this.game.cos)) n += G.finishDue(g, t); return n; }
  // 下一個培養槽完成的時刻（排鬧鐘用）
  nextDue() { if (!this.game) return Infinity; const now = this.exactNow ?? this.game.h; let t = C.nextDue(this.game.book, now); for (const g of Object.values(this.game.cos)) { for (const q of g.queue) if (!q.ready) t = Math.min(t, q.done); for (const r of g.returning) if (r.at > now) t = Math.min(t, r.at); } return t; }
  // 通知信指向哪裡：服務單（還沒打的可以直接親自打）、案件、補員縱隊所在的地圖位置
  mailRef(x, name) {
    const b = this.game.book; if (!x.ref) return {};
    const tk = b.tickets.find(t => t.id === x.ref);
    if (tk) return {tile: tk.tile, fight: !tk.done && tk.player === name && tk.squad ? tk.id : null};
    const c = b.cases.find(k => k.id === x.ref); if (c) return {tile: c.tile};
    const am = b.amends.find(k => k.id === x.ref), ac = am && b.cases.find(k => k.id === am.caseId); if (ac) return {tile: ac.tile};
    return {};
  }
  // 一家公司看到的畫面資料（回傳訊息物件，由呼叫的人送出）
  view(name, err) {
    const game = this.game, g = this.co(name); if (!g) return null;
    return {type: 'game', err: err || null, year: this.sim.year, season: this.sim.season, campaigns: this.sim.campaignView(), speed: game.speed, yearDays: game.yearDays, mailRead: g.mailRead || null, board: this.boardView(name),
      inbox: game.book.inbox.filter(x => x.player === name).slice(-30).reverse().map(x => ({...x, ...this.mailRef(x, name)})), data: G.view(g, game.book, this.w)};
  }
  // 指令（name：下指令的公司）：會改狀態的記進 log（遊戲小時＋公司＋指令），回傳錯誤訊息或 null
  command(m, name) {
    if (!this.co(name)) return '還沒開公司';
    if (COMMANDS.includes(m.type)) this.log.push({h: this.game.h, who: name, cmd: m});
    return this.act(m, name);
  }
  act(m, name) {
    const {w, sim} = this, game = this.game, g = this.co(name), b = game.book, h = game.h;
    if (m.type === 'speed') { game.speed = m.v; return null; }
    if (m.type === 'yearDays') { game.yearDays = Math.max(3, Math.min(365, m.v | 0)); return null; }
    if (m.type === 'buy') return G.buy(g, w, m.mat, m.qty);
    if (m.type === 'claim') return G.claim(g, +m.slot, this.game.book);
    if (m.type === 'merge') return G.merge(g, +m.keep, +m.feed, h, b);
    if (m.type === 'clean') return G.clean(g, b, w, +m.tile, h);
    if (m.type === 'revive') return G.revive(g, +m.uid, m.slot == null ? null : +m.slot, this.exactNow ?? h);
    if (m.type === 'equip') return G.equipItem(g, +m.uid, String(m.slot), m.item || null);
    if (m.type === 'sell') return G.sellItem(g, String(m.item), w);
    if (m.type === 'mod') return G.modItem(g, String(m.item), String(m.affix));
    if (m.type === 'shop') return G.buyItem(g, String(m.kind), String(m.base));
    if (m.type === 'build') return G.build(g, m.recipe, m.tpl, m.slot, this.exactNow ?? h);   // exactNow：伺服器的精確時刻（單人測試模式沒有，就用整點）
    // 通知看過了（Alan 2026-10-09：重新登入後看過的通知又變紅）：記到看過的最後一個小時，和那個小時裡看過的幾則（同一小時之後才來的仍算新的）
    if (m.type === 'read') { const h = +m.h || 0, sigs = (Array.isArray(m.sigs) ? m.sigs : []).slice(0, 40).map(String); if (!g.mailRead || h > g.mailRead.h) g.mailRead = {h, sigs}; else if (h === g.mailRead.h) g.mailRead.sigs = [...new Set([...g.mailRead.sigs, ...sigs])].slice(-80); return null; }
    if (m.type === 'keep') { const c = g.roster.find(x => x.uid === m.uid); if (c) c.keep = !c.keep; return null; }
    if (m.type === 'tag') return G.tag(g, +m.uid, String(m.tag));
    if (m.type === 'accept') {
      const o = sim.opportunities().find(x => x.kind === m.kind && x.tile === m.tile), e = b.board?.[m.kind + ':' + m.tile];
      if (!o || !e || e.gone) return '這個委託已經不在了';
      if (h < e.start) return '這個委託還沒公開';
      if (h >= e.end - (o.kind === 'camp' ? 0 : C.CFG.FREEZE)) return '這個委託已經截止';
      return G.accept(g, b, w, o, m.side, m.uids, this.exactNow ?? h, !!m.fast, e);   // 大戰役可以一再加派
    }
    if (m.type === 'reinforce') return G.reinforce(g, b, w, m.squad, m.uids, this.exactNow ?? h, !!m.fast);
    if (m.type === 'recall') return G.recall(g, b, w, m.squad, this.exactNow ?? h);
    if (m.type === 'recallCol') return G.recallColumn(g, b, w, m.amend, this.exactNow ?? h);
    if (m.type === 'path') { const path = w.sim.pmc.route(g.base, m.to), ok = path.length > 0; this.emit({type: 'path', to: m.to, path, hours: ok ? C.travelHours(w, g.base, m.to) : -1, fastHours: ok ? C.travelHours(w, g.base, m.to, true) : -1, fastPer: ok ? C.speedCost(w, g.base, m.to, 1) : 0}); return null; }
    if (m.type === 'procure') return G.procure(g, b, w, m.town, m.mat, m.qty, m.uids || [], h);
    if (m.type === 'quotes') { this.emit({type: 'quotes', data: G.quotes(g, w)}); return null; }
    if (m.type === 'resolve') { const tk = b.tickets.find(x => x.id === m.ticket); if (!tk || tk.player !== name) return '這張服務單不是你的'; C.resolveNow(b, w, m.ticket, h); G.hour(g, b, w, h); return null; }
    // 親自打（ASH 任務戰鬥）：把服務單和小隊交給畫面去開戰。單人測試模式打的時候時間停住（pauseOnFight）；伺服器上大家共用時鐘，不停
    if (m.type === 'fight') {
      const tk = b.tickets.find(x => x.id === m.ticket && !x.done && x.player === name), sq = tk && b.squads[tk.squad];
      if (!sq) return '這張服務單已經不在了';
      const squad = sq.clones.filter(c => c.alive).slice(0, 4).map(c => ({id: c.id, cls: c.cls || 'soldier', portrait: c.portrait, st: c.st || {hp: 100},
        lv: c.lv || 1, xp: c.xp || 0, picks: c.picks || [], skills: c.skills || [], prep: c.prep || null, gear: G.gearOf(g, c), perkPicks: c.perkPicks || 0, classPerkMisses: c.classPerkMisses || 0, legacyPerkPicks: c.legacyPerkPicks || 0}));
      if (!squad.length) return '這一隊沒有活著的人';
      let seed = 7; for (const ch of tk.id + ':' + h) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
      if (this.pauseOnFight) { if (game.fighting == null) game.fighting = game.speed; game.speed = 0; }
      this.emit({type: 'mission', data: {id: tk.id, title: tk.title, seed: seed % 1000000, faction: C.ASH_FACTION[tk.enemy.side] || 'rebel', night: tk.night, enemy: {...tk.enemy, roster: C.enemyRoster(tk.enemy)}, squad, type: tk.transit ? 'transit' : tk.type, biome: tk.biome}});
      return null;
    }
    if (m.type === 'submit' || m.type === 'abort') {
      if (game.fighting != null) { game.speed = game.fighting; game.fighting = null; }
      if (m.type === 'abort') return null;
      const tk = b.tickets.find(x => x.id === m.ticket && !x.done && x.player === name), sq = tk && b.squads[tk.squad];
      if (!sq) return '這張服務單已經結算了';
      const win = !!m.result.win, dead = (m.result.dead || []).filter(id => sq.clones.some(c => c.id === id && c.alive));
      const wipe = !sq.clones.some(c => c.alive && !dead.includes(c.id));
      // 成長寫回名冊（等級、經驗、升級三選一、技能、預備欄），升級的人另外發一則通知
      const ups = [];
      for (const [id, pr] of Object.entries(m.result.progress || {})) {
        const c = sq.clones.find(x => x.id === id); if (!c || !pr) continue;
        // 等級改由格子收集決定（Alan 2026-10-10）：戰場上不再用經驗升級，這裡不寫回 lv、xp
        if (false) ups.push(`${c.id} ${c.lv || 1}→${pr.lv} 級${(pr.skills || []).length > (c.skills || []).length ? `，學會了${pr.skills.filter(s => !(c.skills || []).includes(s)).map(s => G.SKILL_NAME[s] || s).join('、')}` : ''}`);
        Object.assign(c, {picks: pr.picks, skills: pr.skills, prep: pr.prep, perkPicks: pr.perkPicks, classPerkMisses: pr.classPerkMisses, legacyPerkPicks: pr.legacyPerkPicks});
        if (pr.gear) G.gearAfterBattle(g, c, pr.gear);   // 撿到的槍、用剩的預備品
      }
      // 彈藥費（Alan 2026-10-09）：接案的由雇主吸收；自費的（自己的車隊）結算時扣
      const ammo = Object.values(m.result.progress || {}).reduce((x, pr) => x + G.ammoCost(pr?.gear?.ammoUsed), 0), cs = b.cases.find(x => x.id === tk.caseId), selfPay = !!(cs?.own || cs?.selfAmmo);
      if (ammo > 0 && selfPay) C.pay(b, h, name, -ammo, 'ammo', `${tk.title}：彈藥費`, tk.caseId);
      if (ammo > 0) b.inbox.push({t: h, player: name, kind: 'result', text: `${tk.title}：彈藥費 $${ammo}k${selfPay ? '（自費，已扣）' : '（雇主吸收）'}`, ref: tk.id});
      // 遺產級頭目（Alan 2026-10-09）：戰場回報撤退或戰死；戰死時有人活著帶出遺產級就進倉庫
      const carrier = m.result.legacy && sq.clones.find(c => c.id === m.result.legacy && c.alive && !dead.includes(c.id));
      C.submit(b, w, tk.id, {win, dead, done: C.objectivesDone(tk, win, dead, wipe), boss: m.result.boss === 'dead' || m.result.boss === 'retreat' ? m.result.boss : null, legacy: !!carrier, kills: Number.isFinite(m.result.kills) ? m.result.kills : undefined}, h);
      if (tk.bossOut === 'taken') G.gainLegacy(g, tk.enemy.boss, h);
      if (ups.length) b.inbox.push({t: h, player: name, kind: 'result', text: `${tk.title}：升級　${ups.join('；')}`, ref: tk.id});
      G.hour(g, b, w, h); return null;
    }
    return '不認得的指令';
  }

  // 重播：在全新的核心上，照「發生的遊戲小時」重新下同樣的指令（第一筆記著開第一家公司那一年）
  replay(seed, log, untilHour = null) {
    this.start(seed);
    for (const e of log) {
      if (e.cmd.type === 'open') { while (this.sim.year < e.year) this.sim.stepYear(); this.open(); continue; }
      if (e.cmd.type === 'found') { if (!this.game) { while (this.sim.year < e.year) this.sim.stepYear(); } else this.advanceTo(e.h); this.found(e.cmd.base, e.cmd.name); continue; }
      this.advanceTo(e.h); this.command(e.cmd, e.who);
    }
    if (untilHour != null) this.advanceTo(untilHour);
  }
  // 存檔：沙盒的完整狀態（sim.exportState）＋帳本與所有公司＋指令紀錄。讀檔要先用同一個種子產生地圖（地形、地名不存）
  save() { const st = this.sim.exportState(); for (const k of Object.keys(st)) if (ArrayBuffer.isView(st[k])) st[k] = Array.from(st[k]);
    return {sim: st, year: this.sim.year, lastEv: this.lastEv, game: this.game, log: this.log}; }
  load(seed, d) {
    this.w = S.generate(seed, {history: false}); this.sim = this.w.sim; this.sim.begin(); this.seed = seed;
    this.sim.importState(d.sim); this.lastEv = d.lastEv; this.game = d.game; this.log = d.log || [];
    if (this.game) this.sim.setCampaigns(true);
    if (this.game && !this.game.seasonal) { this.game.yearDays = SEASONAL_YEAR_DAYS; this.game.seasonal = true; }   // 舊存檔：90 天一年改成兩週一季
    this.relink();
  }
  // 存檔是 JSON：同一個複製人（公司名冊裡的那位、帳本裡小隊的成員）讀回來會變成兩份。接回同一個物件，
  // 不然小隊那邊的陣亡、升級傳不到名冊，公司也會以為出勤的人已經不在小隊裡（company.js 用 includes 判斷）
  relink() {
    const g = this.game; if (!g) return;
    // uid 只在同一家公司裡不重複，所以照小隊所屬的公司找
    for (const sq of Object.values(g.book.squads)) {
      const co = g.cos[sq.player]; if (!co) continue;
      const byUid = new Map(co.roster.map(c => [c.uid, c]));
      sq.clones = sq.clones.map(c => (c.uid != null && byUid.get(c.uid)) || c);
    }
    // 舊存檔：格子收集取代經驗（Alan 2026-10-10）。原本的等級換成等量的格子（每級 10 格，照 uid 擲），不降級
    for (const co of Object.values(g.cos)) for (const c of co.roster) if (!c.cells) { c.cells = [0, 0, 0, 0]; c.dup = 0; c.cellPts = 0; let s = (c.uid * 2654435761) >>> 0; const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
      const want = ((c.lv || 1) - 1) * 10; for (let k = 0; k < 2000 && C.cellCount(c) < want; k++) C.drawCells(c, 1, r); c.lv = C.cellLevel(c); }
    // 舊存檔：服役紀錄從現在開始記（之前的事補不回來），先補一筆出槽
    for (const co of Object.values(g.cos)) for (const c of co.roster) if (!c.record) c.record = [{h: c.born || 0, t: 'born', co: co.name, tile: co.base, before: true}];
    // 舊存檔（Alan 2026-10-10）：uid 從「每家公司各自數」改成全星球流水號。照公司、名冊的順序重新發號；顯示的編號不改（認得的人還是那個名字）
    if (!g.book.cloneSeq) {
      let n = 1; const all = Object.values(g.book.squads);
      for (const co of Object.values(g.cos)) {
        const map = new Map(); for (const c of co.roster) { map.set(c.uid, n); c.uid = n++; }
        for (const r of co.returning || []) if (map.has(r.uid)) r.uid = map.get(r.uid);
        if (co.fresh != null) co.fresh = map.get(co.fresh) ?? null;
        for (const sq of all) if (sq.player === co.name) for (const c of sq.clones) if (!co.roster.includes(c) && map.has(c.uid)) c.uid = map.get(c.uid);
      }
      g.book.cloneSeq = n;
    }
  }
  // 狀態指紋：比對兩個核心是不是一模一樣（帳本＋公司＋沙盒的年份與時間）
  fingerprint() {
    const K = this.sim.peek(), world = {owner: Array.from(K.owner), pop: Array.from(K.pop), bandit: Array.from(K.bandit), trench: Array.from(K.trench), stock: Object.entries(K.markets).map(([t, m]) => [t, m.stock, m.veh]), gangs: K.gangs.map(g => [g.id, g.str, g.gone])};
    const s = JSON.stringify({y: this.sim.year, h: this.game?.h, book: this.game?.book, cos: this.game?.cos, world});
    let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16) + ':' + s.length;
  }
}
