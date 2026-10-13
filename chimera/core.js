// 奇美拉的遊戲核心（伺服器化 S0，warband/DESIGN.md「伺服器化實作計畫」）：沙盒、帳本、公司，收指令、吐畫面資料。
// 不碰 postMessage、不管時間怎麼走：瀏覽器的 public/worker.js 用加速時鐘推它（單人測試模式），之後伺服器用現實時鐘推。
// 一切亂數都來自種子與帳本（沒有 Math.random），同樣的「指令＋發生的遊戲小時」重播出同樣的結果（stats/core-replay.mjs 驗證），
// 伺服器的存檔＝快照＋指令紀錄（log）。
import * as S from './sim.js';
import * as C from './cases.js';
import * as G from './company.js';
import {ensureNpcs, npcHour} from './npc.js';
import * as RV from './rover.js';

const r1 = v => Math.round(v * 10) / 10;
// 可以開 50×50 的戰鬥類型（清光敵人或守住就贏的；2026-10-13 size-check：巡邏遭遇 245 回合、守點 36 回合、清剿 304 回合打完）
const BIG_OK = new Set(['probe', 'hold', 'clear', 'patrol', 'sweep', 'scout', 'guard', 'rally', 'drill']);
// 會改變遊戲狀態、要記進指令紀錄的指令（path、quotes 只是查詢）
const BOARD_COOL = 24;   // 委託結束後冷卻多久才再公開（Alan 2026-10-09）
// 沙盒一年幾天（現實時間）：四季，每季結算一次戰事
export const SEASONAL_YEAR_DAYS = 56;
export const COMMANDS = ['speed', 'yearDays', 'buy', 'build', 'keep', 'accept', 'reinforce', 'resolve', 'fight', 'submit', 'abort', 'procure', 'recall', 'recallCol', 'read', 'claim', 'revive', 'clean', 'merge', 'tag', 'callsign', 'sellbody', 'sign', 'garrison', 'ungarrison', 'retHide', 'readReport', 'baseGo', 'baseStop', 'baseSearch', 'baseUpgrade', 'baseJob', 'buyVan', 'register', 'deal', 'note', 'say', 'answer', 'equip', 'fieldEquip', 'sell', 'shop', 'mod', 'talent'];
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
      opps: this.sim.opportunities().filter(o => o.kind !== 'shadow'),   // 黑單不公開（只在符合條件的公司的委託板上）
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
    this.game = {book: C.newBook(seed % 1000000 + 7), cos: {}, h: 0, speed: 3, yearDays: SEASONAL_YEAR_DAYS, seasonal: true, mig: {gar1011: true, hq1012: true, east1012: true, east1013: true, tal1013: true}};   // 新開的星球：舊存檔的轉換、東方謠言都不用補跑
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
      this.shadowHour(t);
      this.postBoard(t);
      for (const g of Object.values(game.cos)) G.hour(g, game.book, this.w, t);
      G.bodiesHour(game.cos, game.book, this.w, t);
      RV.hqHour(game.cos, game.book, this.w, t);   // 移動基地（原本的 Rover）
      G.retainerHour(game.cos, game.book, this.w, t, Math.max(1, Math.round(24 * game.yearDays / 4)));
      for (const e of this.sim.campaignHour(t)) this.campaignNews(e, t);
      if (this.npcOn) npcHour(this, t);   // NPC 傭兵公司（npc.js；伺服器才開）
      if (t % 24 === 0) G.pruneSquads(game.cos, game.book, t);   // 用完的小隊每天清一次
      if (t % 6 === 0 || !game.book.sites) this.worldBits(t);   // 遠征點、突發事件、搶購、留言（移動基地，2026-10-12）
      if (t % 24 === 0) { const r = this.sim.stepDay(Math.max(1, Math.round(game.yearDays / 4))); if (r) yearDone = true; }
    }
    if (yearDone) this.emit({type: 'year', data: this.snapshot()});
    return yearDone;
  }
  // 委託板（Alan 2026-10-09）：機會跟著伺服器時間跑。沙盒裡的每個機會（種類＋地點）在板上公開一次，案期三天從公開起算，
  // 不管有沒有人接；同一個委託大家共用同一個案件（各自算積分、各分尾款）。公開時刻依地點錯開（0～23 小時）；
  // 結束後冷卻一天，沙盒的問題還在就再公開；問題不在了：還沒公開的拿掉，進行中的標記 gone（不能再接，已經接的照常打完）。
  postBoard(h) {
    const book = this.game.book, first = !book.board, B = book.board ||= {}, seen = new Set();
    for (const o of this.allOpps()) {
      const key = o.kind + ':' + o.tile, e = B[key]; seen.add(key);
      // 公開時刻依地點錯開。第一批（星球剛開）往前錯開 0～47 小時，當作開服前就公開了：一開服就有委託可接，而且進度各不相同
      // 大戰役的委託：一開打就公開，開到戰役結束（opportunities 不再列出時就收掉）
      if (!e && o.kind === 'camp') { B[key] = {key, opp: o, start: h, end: h + 24 * 14, cases: {}}; continue; }
      // 黑單與反情報：跟著那件行動的期限（反情報是察覺之後才開，開到同一個期限）
      if ((o.kind === 'shadow' || o.kind === 'counter') && o.closeH != null) { if (!e || e.opp.op !== o.op) B[key] = {key, opp: o, start: h, end: o.closeH + C.CFG.FREEZE, cases: {}}; else { e.opp = o; e.gone = false; } continue; }
      if (!e) { let s = 7; for (const ch of key) s = (s * 31 + ch.charCodeAt(0)) >>> 0; const st = first ? h - s % 48 : h + s % 24; B[key] = {key, opp: o, start: st, end: st + (o.board || C.CFG.CASE_HOURS), cases: {}}; continue; }
      e.opp = o; e.gone = false;
      if (h >= e.end + BOARD_COOL) { e.start = h; e.end = h + C.CFG.CASE_HOURS; e.cases = {}; }
    }
    for (const [key, e] of Object.entries(B)) if (!seen.has(key)) { if (h < e.start || h >= e.end + BOARD_COOL) delete B[key]; else e.gone = true; }
  }
  // 暗影戰爭（Alan 2026-10-11）：行動一開放就定好期限；期限到了集體擲骰，結果交給參與的公司（報酬、曝光的後果）
  shadowHour(t) {
    const P = this.sim.pmc; if (!P.openOps) return;
    for (const o of P.openOps()) { if (o.closeH == null) o.closeH = t + o.hours; else if (t >= o.closeH) P.resolveOp(o.id); }
    for (const o of P.doneOps()) { o.handled = true; this.shadowOutcome(o, t); }
    this.shadowReports(t);
  }
  // 黑單的結算報告（Alan 2026-10-11：行動的付出換來什麼，結算時跳一張大卡片）：行動擲骰過、自己那張案件也結案之後，每家參與的公司各一份
  shadowReports(t) {
    const game = this.game, b = game.book, P = this.sim.pmc, K = this.sim.peek(), w = this.w, nm = x => w.names[x] || '某地', fn = f => K.fac[f]?.n || '某勢力';
    const SITE = {oil: '石油城', ammo: '彈藥農場', oasis: '綠洲', salvage: '拆解場'};
    for (const c of b.cases) { if (c.kind !== 'shadow' || !c.settled) continue; const o = P.op(c.op); if (!o || o.state !== 'done' || !o.res) continue;
      const cos = new Set([...Object.keys(c.score), ...c.squads.map(id => b.squads[id]?.player).filter(Boolean)]);
      for (const co of cos) { const G2 = game.cos[co]; if (!G2 || c.reported?.[co]) continue; (c.reported ||= {})[co] = true;
        const r = o.res, def = c.side === 'def', win = def ? !r.ok : !!r.ok;
        // 實際被打到的城：新的行動記在 res.hit；舊的照「那一年被燒、被斷水」的城找回來
        const old = r.ok && (o.op === '破壞' || o.op === '斷水') ? Object.keys(K.markets).map(Number).find(x => K.owner[x] === o.b && (o.op === '破壞' ? K.markets[x].sabY === o.y && K.markets[x].site : K.markets[x].waterCut === o.y)) : undefined;
        const at = r.hit ?? o.at ?? old ?? o.tile, site = K.markets[at]?.site?.kind;
        const T = b.tickets.filter(x => x.caseId === c.id && x.player === co), tot = Object.values(c.score).reduce((x, y) => x + y, 0);
        const L = b.ledger.filter(x => x.caseId === c.id && x.player === co), money = {}; for (const x of L) money[x.kind] = (money[x.kind] || 0) + x.amount;
        // 世界上實際發生的事
        const world = [];
        if (r.gone) world.push('目標勢力已經不在了，行動取消。');
        else if (r.ok) { world.push(r.text ? r.text + '。' : '行動成功。');
          if (o.op === '破壞') world.push(`${nm(at)}的燃料、零件、彈藥庫存各少了一半${site ? `；${SITE[site] || '產地'}到第 ${o.y} 年年底都不生產` : ''}。`);
          if (o.op === '斷水') world.push(`${nm(at)}的存水一滴不剩，到第 ${o.y} 年年底都缺水。`);
          if (o.op === '煽動' || o.op === '收買') world.push('那一帶的民心更不穩，之後可能脫離。');
          if (o.op === '資助匪幫') world.push('附近的匪幫壯大，那一帶的車隊會更常出事。');
          if (o.op === '嫁禍') world.push('被栽贓的兩個勢力之間更緊張了。'); }
        else world.push(def ? '對方的行動被你們擋下來了，沒有造成任何損害。' : '行動的分量不夠，擲骰沒過，沒有造成影響。');
        world.push(o.detected ? `${fn(o.b)}事前有察覺，開過懸賞緝拿。` : `${fn(o.b)}事前沒有察覺。`);
        if (r.caught) world.push(r.blame ? `密探被抓到，${fn(o.b)}公開點名「${r.blame}」。` : '密探被抓到了。');
        else if (r.ok) world.push('沒有人知道是誰幹的。');
        // 對你的影響
        const me = [];
        if (r.caught && r.blame === co) me.push(`你被點名了：名氣 −60、與${fn(o.b)}和雇主${fn(o.a)}的關係下降，倒在現場的遺體被銷毀。`);
        else if (!def) me.push('你沒有曝光：名聲、派系關係沒有被扣。');
        const rel = (G2.relLog || []).filter(e => e.why.includes(c.title)); for (const e of rel) me.push(`與${fn(e.f)}的關係 ${e.v > 0 ? '+' : ''}${e.v}`);
        const mine = (b.contracts || []).filter(k => k.site === at && k.signers.some(s => s.co === co && !s.void));
        if (r.ok && (o.op === '破壞' || o.op === '斷水') && mine.length) me.push(`⚠ ${nm(at)}${SITE[site] || ''}是你簽了長約的產地，這次也被波及：停工期間庫存只出不進，車隊可能變少。`);
        const rep = {id: 'RP' + b.nextId++, kind: 'shadow', h: t, seen: false, title: c.title, op: o.op, side: c.side, win, tile: at, place: nm(at) + (site ? SITE[site] || '' : ''),
          employer: fn(def ? o.b : o.a), target: fn(def ? o.a : o.b), odds: P.oddsOf ? P.oddsOf(o)?.tier : null, alert: c.alert ?? null,
          tickets: T.length, wins: T.filter(x => x.win).length, auto: T.filter(x => x.auto).length, dead: T.reduce((s, x) => s + (x.dead || []).length, 0),
          share: tot > 0 ? Math.round((c.score[co] || 0) / tot * 100) : 0, others: Object.entries(c.score).filter(([k, v]) => k !== co && v > 0).map(([k, v]) => ({co: k, pct: Math.round(v / tot * 100)})),
          money, net: L.reduce((s, x) => s + x.amount, 0), world, me};
        (G2.reports ||= []).push(rep); if (G2.reports.length > 60) G2.reports.shift();
      }
    }
  }
  shadowOutcome(o, t) {
    const game = this.game, b = game.book, K = this.sim.peek(), fn = f => K.fac[f]?.n || '某勢力', nm = this.w.names[o.tile] || '某地', r = o.res || {};
    const cs = b.cases.filter(c => c.kind === 'shadow' && c.op === o.id), ids = cs.map(c => c.id);
    for (const c of cs) {
      const win = c.side === 'def' ? !r.ok : !!r.ok, tot = Object.values(c.score).reduce((x, y) => x + y, 0), bonus = Math.round(60 * c.lv);
      for (const [co, sc] of Object.entries(c.score)) { if (!sc || !game.cos[co]) continue;
        const v = win && tot > 0 ? bonus * sc / tot : 0; if (v > 0) C.pay(b, t, co, v, 'shadow', `${c.title}：${c.side === 'def' ? '緝拿成功' : '行動成功'}獎金`, c.id);
        b.inbox.push({t, player: co, kind: 'war', text: `${c.title}：${r.gone ? '目標已經不在了，行動取消。' : r.ok ? '行動成功' : '行動失敗'}${r.caught ? '，密探被抓' : ''}${v > 0 ? `，分到獎金 $${Math.round(v)}k` : ''}。`, ref: c.id}); }
    }
    if (r.caught && r.blame && game.cos[r.blame]) {
      G.exposed(game.cos[r.blame], b, this.w, o, ids, t);
      for (const name of Object.keys(game.cos)) b.inbox.push({t, player: name, kind: 'war', text: `${fn(o.b)}公開了在${nm}抓到的密探：是傭兵公司「${r.blame}」的人。`, ref: 'op' + o.id});
    }
  }
  // 練兵單、狩獵場、場地維安（Alan 2026-10-11）：不是沙盒的事件，委託板自己開（公司模式才有）
  allOpps() { return [...this.sim.opportunities().filter(o => o.kind !== 'exp'), ...this.workOpps()]; }   // 遠征改成基地到場搜索（book.sites），不上委託板（Alan 2026-10-12）
  // ---- 移動基地的世界小東西（Alan 2026-10-12，DESIGN.md「移動基地」）：每 6 小時整理一次 ----
  // - 遠征點（沙盒的遺產級舊戰場、無主的舊礦坑、燃料林、廢墟）：基地開過去搜索才拿得到，先搜到的先拿（之後冷卻一週）
  // - 突發事件：墜毀的補給艙、走私者的藏貨、沙暴後露出的車隊殘骸。只在三天內、基地到場搜索才拿得到，誰先搜到就是誰的
  // - 搶購：某座城便宜賣一批素材或裝備，先預告 6 小時、開賣 24 小時、名額先搶先贏；基地要停在那座城才能買（NPC 公司不搶）
  // - 留言（三天）、對話（一天）：同一格的公司看得到
  worldBits(t) {
    const b = this.game.book, K = this.sim.peek(), w = this.w, nm = x => w.names[x] || '荒野', hsh = (...a) => { let x = 0x9e3779b9; for (const v of a) { x = Math.imul(x ^ (v + 0x7f4a7c15), 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; } return (x >>> 0) / 4294967296; };
    b.sites = this.sim.opportunities().filter(o => o.kind === 'exp').map(o => ({tile: o.tile, lv: o.lv, title: o.title, hint: o.detail,
      kind: /遺產級/.test(o.detail) ? 'legacy' : /礦坑/.test(o.title) ? 'mine' : /油棘林/.test(o.title) ? 'fuel' : 'ruin'}));
    const towns = Object.keys(K.markets).map(Number).filter(x => K.owner[x] >= 0); if (!towns.length) return;
    b.events = (b.events || []).filter(e => t < e.end && !e.taken);
    if (t % 24 === 12 && b.events.length < 6 && hsh(t, 1) < .7) {
      const town = towns[Math.floor(hsh(t, 2) * towns.length)], near = []; for (let i = 0; i < K.owner.length; i++) { const d = S.hdist(i, town); if (d >= 3 && d <= 8 && w.land[i] && !K.markets[i]) near.push(i); }
      if (near.length) { const tile = near[Math.floor(hsh(t, 3) * near.length)], k = ['pod', 'cache', 'wreck'][Math.floor(hsh(t, 4) * 3)];
        const E = {pod: ['墜毀的補給艙', '天上掉下來的舊時代補給艙，還冒著煙；熱量、淨水、植入物、神經介質'], cache: ['走私者的藏貨', '走私者埋在沙裡的貨，聽說有帶詞條的槍'], wreck: ['沙暴後露出的車隊殘骸', '沙暴把一整列舊車隊吹了出來；值錢的貨、護甲']}[k];
        b.events.push({id: 'E' + t, kind: k, tile, start: t, end: t + 72, title: `${nm(tile)}：${E[0]}`, hint: E[1], lv: 3}); } }
    b.deals = (b.deals || []).filter(d => t < d.close);
    if (t % 24 === 6) for (let i = 0; i < 2; i++) {
      const tile = towns[Math.floor(hsh(t, 10 + i) * towns.length)], m = K.markets[tile], x = hsh(t, 20 + i), id = `D${t}-${i}`;
      if (b.deals.some(d => d.tile === tile)) continue;   // 同一座城同時只有一筆
      if (x < .6) { const mat = ['food', 'water', 'implant', 'neural'][Math.floor(hsh(t, 30 + i) * 4)], g = {food: 'food', water: 'water', implant: 'parts', neural: 'parts'}[mat], base = {food: .2, water: .24, implant: .25, neural: .8}[mat], price = +(base * (m?.price?.[g] ?? 1) * .55).toFixed(2);
        b.deals.push({id, tile, kind: 'mat', mat, qty: 100, price, cost: Math.round(price * 100), slots: 3, buyers: [], open: t + 6, close: t + 30, title: `${nm(tile)}便宜賣${G.MN?.[mat] || mat} 100 份（$${Math.round(price * 100)}k，約五五折）`}); }
      else { const kind = x < .85 ? 'gun' : 'armor', T = kind === 'gun' ? G.GUNS : G.ARMORS, keys = Object.keys(T), bs = keys[Math.floor(hsh(t, 40 + i) * keys.length)], af = Object.keys(kind === 'gun' ? G.AFFIX_NAMES : G.ARMOR_AFFIXES || {}).filter(a => a !== 'homemade'), affix = af.length ? af[Math.floor(hsh(t, 50 + i) * af.length)] : null;
        const cost = Math.round((T[bs]?.v || 40) * 1.2);
        b.deals.push({id, tile, kind, base: bs, affix, cost, slots: 1, buyers: [], open: t + 6, close: t + 30, title: `${nm(tile)}有人出清${G.itemName({kind, base: bs, affix})}（$${cost}k，只有一件）`}); } }
    { const R = this.sim.rumor; if (R?.found && !b.stationNews) { b.stationNews = t; const K2 = this.sim.peek(), who = R.found.who || K2.fac[R.found.by]?.n || '有人'; for (const name of Object.keys(this.game.cos)) b.inbox.push({t, player: name, kind: 'war', text: `東邊的傳聞是真的：${who}在${w.names[R.tile] || '枯焦站'}找到了舊星艦維修站。誰握著它，誰就有用不完的燃料、彈藥、零件和水——各方勢力都會來搶。`, ref: null}); } }
    b.notes = (b.notes || []).filter(n => t - n.h < 72);
    for (const k of Object.keys(b.chat || {})) { b.chat[k] = b.chat[k].filter(c => t - c.h < 24); if (!b.chat[k].length) delete b.chat[k]; }
  }
  workOpps() {
    const K = this.sim.peek(), w = this.w, nm = t => w.names[t] || '無名之地', fn = f => K.fac[f]?.n || '', out = [];
    const towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0), hash = t => ((t * 2654435761) >>> 0) % 1000;
    const banditNear = t => { let m = 0; for (let i = 0; i < K.bandit.length; i++) if (S.hdist(i, t) <= 2) m = Math.max(m, K.bandit[i]); return m; };
    // 掃蕩流寇：附近匪患最重的 8 座城
    for (const t of towns.map(t => [t, banditNear(t)]).filter(([, b]) => b > 8).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t))
      out.push({kind: 'drill', tile: t, lv: 2, risk: 1, fac: K.owner[t], board: 72, title: `掃蕩${nm(t)}附近的流寇`, detail: `練兵單・${fn(K.owner[t])}・到點立刻開打、打完就回家・車馬費 $2k×難度・彈藥雇主吸收到 $5k×難度為止・記憶片段 40 格以上不再抽`});
    // 狩獵場：離城不遠的幾處舊設施（廢墟、舊礦坑），入口由最近那座城的勢力派守衛（開服時挑一次，記在帳本）
    const b = this.game.book;
    if (!b.huntSites) { const c = []; for (let i = 0; i < K.owner.length; i++) { if (!(K.ruin[i] || K.vein[i] > 0)) continue; const d = Math.min(...towns.map(t => S.hdist(i, t))); if (d >= 2 && d <= 6) c.push([i, d]); }
      c.sort((p, q) => hash(p[0]) - hash(q[0])); const pick = []; for (const [i] of c) { if (pick.length >= 4) break; if (pick.some(j => S.hdist(i, j) < 8)) continue; pick.push(i); } b.huntSites = pick; }
    for (const t of b.huntSites) { const near = towns.slice().sort((p, q) => S.hdist(p, t) - S.hdist(q, t))[0]; if (near === undefined) continue;
      out.push({kind: 'hunting', tile: t, lv: 3, risk: 3, fac: K.owner[near], board: 72, title: `${nm(t)}的狩獵場`, detail: `舊時代的設施，被幾乎絕種的外星生物佔據，生命力極強、怎麼清都清不完・入口由${fn(K.owner[near])}的守衛看著，場地費每人 $3k・最多三層，越深越兇・彈藥自費・記憶片段 40 格以上不再抽`}); }
    // 場地維安：人口最多的 8 座城，駐守 24～72 小時
    for (const t of towns.slice().sort((p, q) => (K.markets[q].pop || 0) - (K.markets[p].pop || 0)).slice(0, 8)) { const hours = 24 * (1 + hash(t) % 3);
      out.push({kind: 'security', tile: t, lv: 1, risk: 0, fac: K.owner[t], hours, board: hours + 48, title: `${nm(t)}的場地維安`, detail: `駐守 ${hours} 小時・報酬約打平交通費與維持費・每駐守 6 小時抽一次記憶片段（25 格以上不再抽）・偶爾有人來騷擾・彈藥自費`}); }
    // 東邊的前哨（Alan 2026-10-13）：缺水缺糧、或最近被劫的前哨開「護送補給車隊」；6 格內有對手的前哨開「前哨爭奪」（替守方守，或替對手去搶）
    for (const o of this.sim.outposts ? this.sim.outposts() : []) {
      const f = o.f, nmT = nm(o.tile), h = this.game.h, yr = this.sim.year;
      if (o.home >= 0 && (o.water < .9 || o.food < .9 || o.raided === yr)) out.push({kind: 'supply', tile: o.tile, home: o.home, lv: o.rivals.length ? 3 : 2, risk: o.rivals.length ? 3 : 1, fac: f, board: 72,
        title: `護送${fn(f)}往${nmT}前哨的補給車隊`, detail: `從${nm(o.home)}運淨水過去・前哨淨水 ${Math.round(o.water * 100)}%、熱量 ${Math.round(o.food * 100)}%${o.raided === yr ? '・今年被劫過' : ''}${o.rivals.length ? `・附近有${o.rivals.map(fn).join('、')}的人` : ''}`});
      for (const r of o.rivals.slice(0, 1)) out.push({kind: 'outpost', tile: o.tile, a: f, b: r, lv: 3, risk: 2, board: 72, station: o.tile === this.sim.rumor?.tile,
        title: o.tile === this.sim.rumor?.tile ? `${nmT}維修站的爭奪` : `${nmT}前哨的爭奪`, detail: `${fn(f)}的${o.tile === this.sim.rumor?.tile ? '維修站' : '前哨'}・${fn(r)}想搶下來・守住了前哨多一批人和物資，搶成了前哨的水窖糧倉被砸`});
      void h;
    }
    return out;
  }
  // 一家公司看得到的委託：已經公開、還能接的；加上自己接了、還沒結束的
  boardView(name) {
    if (!this.game.book.board) this.postBoard(this.game.h);   // 還沒公開過（星球剛開、還沒過第一個整點）
    const book = this.game.book, h = this.game.h, g = this.co(name), mine = new Set(g?.cases || []);
    return Object.values(book.board || {}).map(e => {
      const ids = Object.values(e.cases), joined = ids.some(id => mine.has(id)), cs = ids.map(id => book.cases.find(c => c.id === id)).filter(Boolean);
      const n = new Set(cs.flatMap(c => c.squads.map(s => book.squads[s]?.player).filter(Boolean))).size;
      const side = Object.entries(e.cases).find(([, id]) => mine.has(id))?.[0];   // 自己接的是哪一邊（大戰役加派時沿用）
      return {...e.opp, key: e.key, start: e.start, end: e.end, closeAt: e.end - C.CFG.FREEZE, gone: !!e.gone, joined, side, n, here: g ? G.onSite(g, e.opp.tile) : false};   // here：基地在現場（直接派、不用車、不限隊數）
    }).filter(e => h >= e.start && ((h < e.closeAt && !e.gone && (!g || G.canSee(g, book, this.w, e))) || (e.joined && h < e.end)));
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
      inbox: game.book.inbox.filter(x => x.player === name).slice(-30).reverse().map(x => ({...x, ...this.mailRef(x, name)})), data: {...G.view(g, game.book, this.w), hq: RV.hqView(g, game.book, this.w, game.h),
        vans: {cap: G.vanCap(g), used: G.vansUsed(g, game.book)}, depot: g.depot || {}, world: this.worldView(g), here: this.hereView(g)}};
  }
  // 地圖上的遠征點、突發事件、搶購（每家看到的都一樣，加上自己買過沒有）
  worldView(g) {
    const b = this.game.book, h = this.game.h, w = this.w;
    return {sites: (b.sites || []).map(s => ({tile: s.tile, kind: s.kind, lv: s.lv, title: s.title, hint: s.hint, taken: (t => t && h - t.h < G.SITE_CD ? t.co : null)(b.siteTaken?.[s.tile])})),
      events: (b.events || []).filter(e => h >= e.start && h < e.end && !e.taken).map(e => ({id: e.id, tile: e.tile, kind: e.kind, title: e.title, hint: e.hint, end: e.end})),
      // 此地（Alan 2026-10-12：改在戰略地圖的地點分頁看）：每一格的留言、停在哪一格的公司，點哪一格就看哪一格
      rumor: (R => R ? {tile: R.tile, place: w.names[R.tile] || '', y: R.y, found: R.found ? {y: R.found.y, who: R.found.who || (K2 => K2.fac[R.found.by]?.n || '')(this.sim.peek())} : null, holder: R.holder != null && R.holder >= 0 ? this.sim.peek().fac[R.holder]?.n || '' : null} : null)(this.sim.rumor),   // 東方謠言：傳聞中的舊星艦維修站（地圖上的紅★）
      notes: (b.notes || []).slice(-200), bases: Object.values(this.game.cos).filter(x => x !== g).map(x => ({name: x.name, tile: x.base, npc: !!x.npc, n: x.roster.filter(c => c.alive).length})),
      deals: (b.deals || []).map(d => ({id: d.id, tile: d.tile, kind: d.kind, title: d.title, cost: d.cost, open: d.open, close: d.close, left: d.slots - d.buyers.length, mine: d.buyers.includes(g.name), place: w.names[d.tile] || ''}))};
  }
  // 此地（Alan 2026-10-12，照 warband 的「此地」）：基地同一格的其他公司、留在這一格的留言（三天）、對話（一天）
  hereView(g) {
    const b = this.game.book, t = g.base;
    return {tile: t, cos: Object.values(this.game.cos).filter(x => x !== g && x.base === t).map(x => ({name: x.name, npc: !!x.npc, n: x.roster.filter(c => c.alive).length})),
      notes: (b.notes || []).filter(n => n.tile === t).slice(-20).reverse(), chat: (b.chat?.[t] || []).slice(-30)};
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
    if (m.type === 'sign') return G.sign(g, b, w, String(m.id), h);
    if (m.type === 'garrison') return G.garrison(g, b, w, +m.site, m.uids || [], h);
    if (m.type === 'ungarrison') return G.ungarrison(g, b, w, String(m.squad), h);
    if (m.type === 'answer') return G.answer(g, b, w, String(m.call), m.squad ? {squad: String(m.squad)} : {uids: m.uids || []}, h);
    if (m.type === 'merge') return G.merge(g, +m.keep, +m.feed, h, b);
    if (m.type === 'clean') return G.clean(g, b, w, +m.tile, h);
    if (m.type === 'revive') return G.revive(g, +m.uid, m.slot == null ? null : +m.slot, this.exactNow ?? h);
    if (m.type === 'equip') return G.equipItem(g, +m.uid, String(m.slot), m.item || null);
    if (m.type === 'retHide') return G.retHide(g, b, String(m.id));
    // 移動基地（Alan 2026-10-12；原本的 Rover）
    if (m.type === 'baseGo') return RV.baseGo(g, b, w, +m.tile, h);
    if (m.type === 'baseStop') return RV.baseStop(g, b, w, h);
    if (m.type === 'baseSearch') return RV.baseSearch(g, b, w, h);
    if (m.type === 'baseUpgrade') return RV.baseUpgrade(g, b, w, String(m.kind), h);
    if (m.type === 'baseJob') return RV.baseJob(g, b, w, String(m.id), h);
    if (m.type === 'buyVan') return RV.buyVan(g, b, w, h);
    if (m.type === 'register') return RV.register(g, b, w, h, Math.max(1, Math.round(24 * game.yearDays / 4)));
    if (m.type === 'deal') return this.deal(g, String(m.id));
    if (m.type === 'note' || m.type === 'say') return this.post(g, m.type, m.text);
    if (m.type === 'readReport') { for (const r of g.reports || []) if (m.id === 'all' || r.id === m.id) r.seen = true; return null; }
    if (m.type === 'fieldEquip') return G.fieldEquip(g, b, String(m.squad), +m.uid, String(m.slot), m.item || null);
    if ((m.type === 'sell' || m.type === 'mod' || m.type === 'shop') && !G.inTown(g, w)) return '基地要停在城裡才能買賣裝備';
    if (m.type === 'sell') return G.sellItem(g, String(m.item), w);
    if (m.type === 'mod') return G.modItem(g, String(m.item), String(m.affix));
    if (m.type === 'shop') return G.buyItem(g, String(m.kind), String(m.base));
    if (m.type === 'build') return G.build(g, m.recipe, m.tpl, m.slot, this.exactNow ?? h);   // exactNow：伺服器的精確時刻（單人測試模式沒有，就用整點）
    // 通知看過了（Alan 2026-10-09：重新登入後看過的通知又變紅）：記到看過的最後一個小時，和那個小時裡看過的幾則（同一小時之後才來的仍算新的）
    if (m.type === 'read') { const h = +m.h || 0, sigs = (Array.isArray(m.sigs) ? m.sigs : []).slice(0, 40).map(String); if (!g.mailRead || h > g.mailRead.h) g.mailRead = {h, sigs}; else if (h === g.mailRead.h) g.mailRead.sigs = [...new Set([...g.mailRead.sigs, ...sigs])].slice(-80); return null; }
    if (m.type === 'keep') { const c = g.roster.find(x => x.uid === m.uid); if (c) c.keep = !c.keep; return null; }
    if (m.type === 'tag') return G.tag(g, +m.uid, String(m.tag));
    if (m.type === 'sellbody') return G.sellBody(g, b, +m.uid, h);
    if (m.type === 'callsign') return G.setCallsign(g, +m.uid, m.name);
    if (m.type === 'talent') return G.pickTalent(g, +m.uid, +m.row, +m.k);   // 成長（Alan 2026-10-13）：在角色詳細裡選
    if (m.type === 'accept') {
      const o = this.allOpps().find(x => x.kind === m.kind && x.tile === m.tile), e = b.board?.[m.kind + ':' + m.tile];
      if (!o || !e || e.gone) return '這個委託已經不在了';
      if (h < e.start) return '這個委託還沒公開';
      if (h >= e.end - (o.kind === 'camp' ? 0 : C.CFG.FREEZE)) return '這個委託已經截止';
      return G.accept(g, b, w, o, m.side, m.uids || [], this.exactNow ?? h, false, e);   // 大戰役可以一再加派
    }
    if (m.type === 'reinforce') return G.reinforce(g, b, w, m.squad, m.uids || [], this.exactNow ?? h);
    if (m.type === 'recall') return G.recall(g, b, w, m.squad, this.exactNow ?? h);
    if (m.type === 'recallCol') return G.recallColumn(g, b, w, m.amend, this.exactNow ?? h);
    if (m.type === 'path') { const path = w.sim.pmc.route(g.base, m.to), ok = path.length > 0; this.emit({type: 'path', to: m.to, path, hours: ok ? C.travelHours(w, g.base, m.to) : -1, fare: ok ? C.fareCost(w, g.base, m.to, 1) : 0, base: ok ? RV.hqTrip(g, w, m.to) : null}); return null; }   // 運兵車要多久、油錢；基地開過去要多久、油錢
    if (m.type === 'procure') return G.procure(g, b, w, m.town, m.mat, m.qty, m.uids || [], h);
    if (m.type === 'quotes') { this.emit({type: 'quotes', data: G.quotes(g, w)}); return null; }
    if (m.type === 'resolve') { const tk = b.tickets.find(x => x.id === m.ticket); if (!tk || tk.player !== name) return '這張服務單不是你的'; C.resolveNow(b, w, m.ticket, h); G.hour(g, b, w, h); return null; }
    // 親自打（ASH 任務戰鬥）：把服務單和小隊交給畫面去開戰。單人測試模式打的時候時間停住（pauseOnFight）；伺服器上大家共用時鐘，不停
    if (m.type === 'fight') {
      const tk = b.tickets.find(x => x.id === m.ticket && !x.done && x.player === name), sq = tk && b.squads[tk.squad];
      if (!sq) return '這張服務單已經不在了';
      const squad = sq.clones.filter(c => c.alive).slice(0, 4).map(c => ({id: c.id, name: G.donorName(c) || null, callsign: c.callsign || null, donor: c.donor ?? c.portrait, cls: c.cls || 'soldier', portrait: c.portrait, st: c.st || {hp: 100},
        lv: c.lv || 1, xp: c.xp || 0, picks: [], tal: G.talentIds(c), grow: G.growOf(c), scrap: c.cls === 'engineer' ? G.engineerScrap(c.lv) : 0, skills: c.skills || [], prep: c.prep || null, gear: G.gearOf(g, c), perkPicks: c.perkPicks || 0, classPerkMisses: c.classPerkMisses || 0, legacyPerkPicks: c.legacyPerkPicks || 0}));
      if (!squad.length) return '這一隊沒有活著的人';
      if (tk.fightAt == null) tk.fightAt = h;   // 開打了：打完之前這一隊不能整補（戰場上的裝備是開打那一刻的）
      let seed = 7; for (const ch of tk.id + ':' + h) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
      if (this.pauseOnFight) { if (game.fighting == null) game.fighting = game.speed; game.speed = 0; }
      // 戰場大小（Alan 2026-10-13：照 Claude 的意思）：敵人 12 名以上的大單開 50×50（據點群的佈陣），其餘 27×27；室內設施、公路戰由戰場那邊固定 27
      // 只開在「清光敵人／守住」的戰場：奪點、裝炸藥（突擊、戰壕、破壞…）在 50×50 上機器人隊員打不完（size-check 18 名敵人：卡到步數上限），先維持 27
      const roster = C.enemyRoster(tk.enemy), size = roster.length >= 12 && BIG_OK.has(tk.transit ? 'transit' : tk.type) ? 50 : 27;
      this.emit({type: 'mission', data: {id: tk.id, title: tk.title, seed: seed % 1000000, faction: C.ASH_FACTION[tk.enemy.side] || 'rebel', night: tk.night, enemy: {...tk.enemy, roster}, squad, type: tk.transit ? 'transit' : tk.type, intro: tk.transit ? null : tk.intro || null, biome: tk.biome, facility: !!tk.facility, floors: tk.floors || 0, size,
        depth: Math.max(1, Math.min(12, 1 + Math.round((tk.enemy.power || 10) / 7) + (tk.wave ? Math.floor(tk.wave / 3) : 0)))}});   // 敵人的強度（菁英、詞條的機率照 ASH 的樓層），Alan 2026-10-11
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
        if (pr.gear) G.gearAfterBattle(g, c, pr.gear, sq);   // 撿到的槍、用剩的預備品
      }
      // 彈藥費（Alan 2026-10-09）：接案的由雇主吸收；自費的（自己的車隊）結算時扣
      const ammo = Object.values(m.result.progress || {}).reduce((x, pr) => x + G.ammoCost(pr?.gear?.ammoUsed), 0), cs = b.cases.find(x => x.id === tk.caseId), selfPay = !!(cs?.own || cs?.selfAmmo);
      // 戰場回收（Alan 2026-10-11）：打贏時，地上的槍、補給收進倉庫；地上的彈藥照價抵這一場的彈藥費（抵完不另外給錢）
      const loot = m.result.win && m.result.loot ? m.result.loot : null, lootText = loot ? G.lootAfterBattle(g, loot, h, sq) : '', credit = loot ? G.ammoCost(loot.ammo) : 0;
      const cap = selfPay ? 0 : C.CFG.AMMO_CAP * (cs?.lv || 1), mine = Math.max(0, ammo - cap - credit);
      if (mine > 0) C.pay(b, h, name, -mine, 'ammo', `${tk.title}：彈藥費${selfPay ? '' : `（雇主吸收 $${cap}k，超過的自付）`}`, tk.caseId);
      if (ammo > 0) b.inbox.push({t: h, player: name, kind: 'result', text: `${tk.title}：彈藥費 $${ammo}k${credit ? `，現場撿回的彈藥抵 $${Math.min(credit, Math.max(0, ammo - cap))}k` : ''}${selfPay ? `（自費${mine > 0 ? `，扣 $${mine}k` : ''}）` : mine > 0 ? `（雇主只吸收 $${cap}k，自付 $${mine}k）` : '（雇主吸收）'}${lootText ? `；戰場回收：${lootText}` : ''}`, ref: tk.id});
      // 遺產級頭目（Alan 2026-10-09）：戰場回報撤退或戰死；戰死時有人活著帶出遺產級就進倉庫
      const carrier = m.result.legacy && sq.clones.find(c => c.id === m.result.legacy && c.alive && !dead.includes(c.id));
      C.submit(b, w, tk.id, {win, dead, done: C.objectivesDone(tk, win, dead, wipe), boss: m.result.boss === 'dead' || m.result.boss === 'retreat' ? m.result.boss : null, legacy: !!carrier, kills: Number.isFinite(m.result.kills) ? m.result.kills : undefined}, h);
      if (tk.bossOut === 'taken') G.gainLegacy(g, tk.enemy.boss, h);
      if (win && C.OUTRO[tk.type] && !tk.transit) b.inbox.push({t: h, player: name, kind: 'result', text: `${tk.title}：${C.OUTRO[tk.type]}`, ref: tk.id});
      if (ups.length) b.inbox.push({t: h, player: name, kind: 'result', text: `${tk.title}：升級　${ups.join('；')}`, ref: tk.id});
      G.hour(g, b, w, h); return null;
    }
    return '不認得的指令';
  }

  // ===== 東方謠言（Alan 2026-10-12，warband/DESIGN.md「東邊有沒有救」）=====
  // 這顆星球（種子 奇美拉-1、60×48）專用：東邊低地一條從北往南流進東南海的大河，從西南沿南邊到東北每 5～6 格一個綠洲當跳板；
  // 大河中段傳出有一座舊星艦維修站。被吸引的勢力（35 格內有城）當場各派兩支遠征隊沿跳板立前哨，之後每年 30% 的機會繼續往東。只發生一次（g.mig.east1012）
  eastRumor() {
    const w = this.w, W = S.W, H = S.H, game = this.game; if (this.seed !== '奇美拉-1' || W !== 60 || H !== 48 || !game) return null;
    const at = (q, r) => r * W + q, NB = i => { const r = Math.floor(i / W), q = i % W, d = (r & 1) ? [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]] : [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]], o = []; for (const [dq, dr] of d) { const a = q + dq, b = r + dr; if (a >= 0 && a < W && b >= 0 && b < H) o.push(b * W + a); } return o; };
    // 大河：從東北的高處沿最低的谷地（成本＝1＋高度×4）走到東南第一格海
    const src = at(52, 7), isMouth = t => !w.land[t] && Math.floor(t / W) >= 32 && t % W >= 46, dist = new Map([[src, 0]]), prev = new Map(), Q = [[0, src]]; let dst = -1;
    while (Q.length) { Q.sort((a, b) => a[0] - b[0]); const [d0, u] = Q.shift(); if (isMouth(u)) { dst = u; break; } if (d0 > dist.get(u)) continue; for (const n of NB(u)) { if (!w.land[n] && !isMouth(n)) continue; const nd = d0 + 1 + w.elev[n] * 4; if (nd < (dist.get(n) ?? 1e9)) { dist.set(n, nd); prev.set(n, u); Q.push([nd, n]); } } }
    const big = [dst]; while (prev.has(big[0])) big.unshift(prev.get(big[0]));
    const stones = [[17, 38], [23, 40], [29, 41], [34, 40], [40, 39], [45, 37], [49, 34], [51, 29], [53, 24], [54, 18]].map(([q, r]) => at(q, r)).filter(t => w.land[t]).map(t => { const n = NB(t).find(x => w.land[x] && !w.river[x]); return n != null ? [t, n] : [t]; });
    this.sim.addRivers([big, ...stones]);
    const tile = at(54, 22), nm = t => w.names[t] || '荒野', K = this.sim.peek();
    const made = this.sim.rumorStart({tile, reach: 35, opr: .3, pull: .5, first: 2, text: `沙暴過後，東邊的舊河道又有水流出來，南邊一路冒出好幾口泉眼。走過東邊的行商說，大河中段的${nm(tile)}一帶露出了舊時代的鋼骨，像是一座舊星艦的維修站——對廢土的人來說，那是能改變一切的東西。`}, this.sim.year);
    const fn = f => K.fac[f]?.n || '某勢力', text = `傳聞：東邊大河中段的${nm(tile)}一帶，可能有一座舊星艦的維修站。南邊冒出一串泉眼，東邊的舊河道復流了；${made.length ? `${[...new Set(made.map(x => fn(x.f)))].join('、')}已經派出遠征隊，在${made.map(x => nm(x.t)).join('、')}立起前哨` : '還沒有勢力動身'}。地圖上的紅★是傳聞的地點。`;
    for (const name of Object.keys(game.cos)) game.book.inbox.push({t: game.h, player: name, kind: 'war', text, ref: null});
    return {river: big.length, stones: stones.length, made};
  }
  // 搶購（2026-10-12）：基地停在那座城、開賣時間內、名額還有、還沒買過
  deal(g, id) {
    const b = this.game.book, h = this.game.h, d = (b.deals || []).find(x => x.id === id); if (!d) return '這筆已經結束了';
    if (g.npc) return 'NPC 公司不搶購';
    if (h < d.open) return `還沒開賣（${Math.ceil(d.open - h)} 小時後）`; if (h >= d.close) return '已經賣完了';
    if (d.buyers.includes(g.name)) return '已經買過了'; if (d.buyers.length >= d.slots) return '名額被搶光了';
    if (!G.inTown(g, this.w) || g.base !== d.tile) return `基地要停在${this.w.names[d.tile] || '那座城'}才能買`;
    if (g.cash < d.cost) return '錢不夠';
    d.buyers.push(g.name); C.pay(b, h, g.name, -d.cost, 'deal', `搶購：${d.title}`);
    if (d.kind === 'mat') g.mats[d.mat] = (g.mats[d.mat] || 0) + d.qty; else G.giveItem(g, {kind: d.kind, base: d.base, affix: d.affix});
    return null;
  }
  // 留言（三天）、對話（一天）：留在基地現在這一格
  post(g, kind, text) {
    const b = this.game.book, h = this.game.h, t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120); if (!t) return '沒有內容';
    if (kind === 'note') { if ((b.notes ||= []).some(n => n.co === g.name && n.tile === g.base && h - n.h < 6)) return '同一格六小時內只能留一則';
      b.notes.push({id: 'N' + b.nextId++, tile: g.base, co: g.name, text: t, h}); return null; }
    const L = (b.chat ||= {})[g.base] ||= []; L.push({co: g.name, text: t, h}); if (L.length > 40) L.splice(0, L.length - 40); return null;
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
    // 舊存檔（Alan 2026-10-11）：舊案件結案曾把駐軍的人拉回總部、又被派去別的案子。駐軍名單只留還在駐地的人（最後一個差事是這個駐地、人在外面）；不到兩人就撤掉這支駐軍
    // 「這個人現在的差事是不是駐在 site」：最後一筆是駐紮在這裡，或是這個產地長約的護送（駐軍自己接的應召，護送完回到駐地）
    const siteOfCase = id => { const k = g.book.cases.find(x => x.id === id); return k?.contract ? (g.book.contracts || []).find(x => x.id === k.contract)?.site : undefined; };
    const garAt = (c, site) => { const e = (c.record || []).findLast(e => e.t === 'case' || e.t === 'garrison'); return e?.t === 'garrison' ? e.tile === site : e?.t === 'case' && siteOfCase(e.case) === site; };
    // 這三個駐軍修補只跑一次（g.mig）：原本每次讀檔都跑，伺服器每重開一次就照紀錄重判一次駐軍；執行中的規則跟修補的判斷稍有不同時（例如駐軍只剩一人），重開就拆掉活著的駐軍（soak 測試 2026-10-12）
    const mig = g.mig ||= {};
    if (!mig.gar1011) for (const [id, sq] of Object.entries(g.book.squads)) { if (sq.garrison == null || sq.caseId) continue;
      sq.clones = sq.clones.filter(c => c.alive && c.status === 'away' && garAt(c, sq.garrison));
      if (sq.clones.length < 2) { for (const c of sq.clones) c.status = 'home'; delete g.book.squads[id]; } }
    // 舊存檔（Alan 2026-10-11）：上一版的修復把「護送完回到駐地」的駐軍誤拆了（人被放回總部）。合約還有效的，照原本的產地重新編回駐軍
    if (!mig.gar1011) for (const co of Object.values(g.cos)) {
      const lost = {}; for (const c of co.roster) { if (!c.alive || c.status !== 'home' || (co.returning || []).some(r => r.uid === c.uid)) continue;
        // 往回看：最後幾筆都是同一個產地長約的護送、再往前是駐紮在那裡，才算是被誤拆的駐軍（從總部臨時派去應召的人不算）
        const J = (c.record || []).filter(e => e.t === 'case' || e.t === 'garrison'), last = J[J.length - 1];
        let site = last?.t === 'case' && last.end != null ? siteOfCase(last.case) : undefined;
        if (site !== undefined) { let i = J.length - 1; while (i >= 0 && J[i].t === 'case' && siteOfCase(J[i].case) === site) i--; if (!(i >= 0 && J[i].t === 'garrison' && J[i].tile === site)) site = undefined; }
        if (site === undefined || Object.values(g.book.squads).some(sq => sq.clones.includes(c) && (sq.caseId || sq.garrison != null))) continue;
        const k = (g.book.contracts || []).find(x => !x.done && x.site === site && x.signers.some(s => s.co === co.name && !s.void)); if (k) (lost[site] ||= []).push(c); }
      for (const [site, L] of Object.entries(lost)) for (let i = 0; i + 1 < L.length; i += 4) { const grp = L.slice(i, i + 4);
        const sq = C.makeSquad(g.book, co.name, {clones: grp, gear: 3, at: +site, name: `${co.name}・${this.w.names[+site] || ''}駐軍`}); sq.garrison = +site; sq.readyAt = g.h ?? 0;
        for (const c of grp) { c.status = 'away'; C.rec(c, {h: g.h ?? 0, t: 'garrison', co: co.name, tile: +site}); } }
    }
    // 舊存檔（Alan 2026-10-11）：已經回到駐地、還掛在護送單上的駐軍，脫鉤
    if (!mig.gar1011) for (const sq of Object.values(g.book.squads)) if (sq.garrison != null && sq.caseId && sq.headedHome != null && g.cos[sq.player]) { const c = g.book.cases.find(x => x.id === sq.caseId); if (c) G.garBack(g.cos[sq.player], g.book, sq, c, g.h ?? 0); }
    mig.gar1011 = true;
    // 舊存檔（2026-10-12）：移動基地。登記地＝原本的總部；兩台運兵車；Rover 併進基地（升級、日誌留著；車上的人回基地、車上的熱量淨水收進倉庫、多送一台運兵車）；
    // 出勤中的小隊都算坐車出去的、集合點是原本的總部（基地還沒動過，回來照舊）
    if (!mig.hq1012) { mig.hq1012 = true;
      for (const co of Object.values(g.cos)) { co.home ??= co.base; co.vans ??= G.VAN.START;
        for (const r of co.returning || []) r.to ??= co.base;
        const R = co.rover; if (R) { const hq = G.ensureHq(co); Object.assign(hq, {up: R.up || {}, log: R.log || [], searched: R.searched || {}, seen: R.seen || [], jobs: R.jobs || []}); co.vans += 1;
          co.mats.food = (co.mats.food || 0) + (R.cargo?.food || 0); co.mats.water = (co.mats.water || 0) + (R.cargo?.water || 0);
          const sq = R.squad && g.book.squads[R.squad];
          if (sq) { for (const tk of g.book.tickets) if (tk.squad === sq.id && !tk.done) { tk.done = true; tk.abandoned = true; }
            for (const c of g.book.cases) c.squads = c.squads.filter(id => id !== sq.id);
            const far = R.tile !== co.base, back = far ? C.travelHours(this.w, R.tile, co.base) : 0;
            for (const x of sq.clones) if (x.alive) { if (far) { x.status = 'returning'; co.returning.push({uid: x.uid, at: (g.h ?? 0) + (isFinite(back) ? back : 24), move: {path: this.w.sim.pmc.route(R.tile, co.base), t0: g.h ?? 0, t1: (g.h ?? 0) + (isFinite(back) ? back : 24)}, to: co.base}); } else x.status = 'home'; }
            if (sq.pack?.length) (co.store ||= []).push(...sq.pack); delete g.book.squads[sq.id]; }
          delete co.rover;
          (co.log ||= []).push({h: g.h ?? 0, text: '移動基地上線：整家公司跟著基地走，原本的 Rover 併進基地（升級留著），多送一台運兵車（共 3 台）。'}); } }
      for (const sq of Object.values(g.book.squads)) { const co = g.cos[sq.player]; if (!co) continue; sq.meet ??= co.base; if (sq.van == null && (sq.caseId || sq.column) && sq.garrison == null) sq.van = true; } }   // 舊規則派出去的駐軍不佔車（照舊駐著；撤回時也不收油錢）
    // 東方謠言（2026-10-12）：上線後第一次讀檔時發生一次
    if (!mig.east1012) { mig.east1012 = true; this.eastRumor(); }
    // 前哨的補給線（2026-10-13）：謠言事件當下立的前哨補上標記
    if (!mig.east1013) { mig.east1013 = true; if (this.sim.rumor) for (const e of this.w.events) if (e.tile != null && /立起前哨/.test(e.text)) this.sim.markOutpost(e.tile); }
    // 成長改版（Alan 2026-10-13）：ASH 的升級三選一拿掉，改成在角色詳細裡選性格技能；之前選的強化清掉，等級、記憶片段不動
    if (!mig.tal1013) { mig.tal1013 = true;
      for (const co of Object.values(g.cos)) { let n = 0; for (const c of co.roster) { if ((c.picks || []).length) n++; Object.assign(c, {picks: [], perkPicks: 0, classPerkMisses: 0, legacyPerkPicks: 0}); c.tal ||= {}; }
        const can = co.roster.filter(c => (c.lv || 1) >= 4 && c.status !== 'sold').length;
        if ((n || can) && !co.npc) g.book.inbox.push({t: g.h ?? 0, player: co.name, kind: 'log', text: `成長改版：戰鬥裡的升級三選一拿掉了，改成每個職業三種性格，4、6、8、10 級在角色詳細裡選一個（選了就固定），3、5、7、9、11 級自動長數值；職業技能改成 2 級學會。之前選的強化已經清掉。${can ? ` 你有 ${can} 個人已經可以選了。` : ''}`, ref: null}); } }
    // 舊存檔（2026-10-12）：易主遺體帶來的裝備跟倉庫撞號的，重新發號
    for (const co of Object.values(g.cos)) G.reidItems(co, g.book);
    // 舊存檔（Alan 2026-10-11）：補上錫冠、鉛冠
    for (const co of Object.values(g.cos)) for (const c of co.roster) if (!c.crown && c.pct != null) c.crown = G.crownOf(c.pct);
    // 舊存檔：格子收集取代經驗（Alan 2026-10-10）。原本的等級換成等量的格子（每級 10 格，照 uid 擲），不降級
    for (const co of Object.values(g.cos)) for (const c of co.roster) if (!c.cells) { c.cells = [0, 0, 0, 0]; c.dup = 0; c.cellPts = 0; let s = (c.uid * 2654435761) >>> 0; const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
      const want = ((c.lv || 1) - 1) * 10; for (let k = 0; k < 2000 && C.cellCount(c) < want; k++) C.drawCells(c, 1, r); c.lv = C.cellLevel(c); }
    // 舊存檔：名氣紀錄照已經結案的案子補算（Alan 2026-10-10）
    for (const co of Object.values(g.cos)) G.fame(co, g.book);
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
  // 後台修復（只給 admin/fix）
  adminFix(b) { const g = this.game; if (!g) return '還沒有世界'; if (b.op === 'resetSigner') return G.resetSigner(g.cos, g.book, this.w, String(b.contract), String(b.co), g.h); return '不認得的修復'; }
  // 狀態指紋：比對兩個核心是不是一模一樣（帳本＋公司＋沙盒的年份與時間）
  fingerprint() {
    const K = this.sim.peek(), world = {owner: Array.from(K.owner), pop: Array.from(K.pop), bandit: Array.from(K.bandit), trench: Array.from(K.trench), stock: Object.entries(K.markets).map(([t, m]) => [t, m.stock, m.veh]), gangs: K.gangs.map(g => [g.id, g.str, g.gone])};
    const s = JSON.stringify({y: this.sim.year, h: this.game?.h, book: this.game?.book, cos: this.game?.cos, world});
    let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16) + ':' + s.length;
  }
}
