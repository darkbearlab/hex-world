// 奇美拉：案件與事件管線（沙盒端）
// 玩家公司把小隊（四名複製人＋裝備＋可選的載具）投進一個案件：補給線、遠征、主戰場、壓陣、清剿。
// 案件進行中，沙盒依當地真實狀況抽事件；抽到的事件發給「最早空出來」的小隊，變成一張限時 24 小時的任務票。
// 玩家可以親自打（ASH 單層任務，結果用 submit 回報），逾期就自動結算：只算火力，打折。
// 每張票的結果立刻寫回沙盒（掠奪者壓力、戰壕、下一場仗的戰力、遺落的裝備），案件結束後依積分分尾款。
// 時間單位一律是「小時」；整本帳（book）是純資料，可以直接存進 Durable Object。
import {BIOMES, GN, BASEP, NBR, hdist, VEH} from './sim.js';

export const CFG = {
  DEADLINE: 24,     // 任務票期限
  FREEZE: 24,       // 案件結束前多久不再出票
  BUFFER: 24,       // 案件結束後的緩衝，之後才結算尾款
  PENDING: 6,       // 沒有小隊空著時，事件最多等幾小時；再等不到就由案件自帶的護衛自己打（沒有積分）
  REST: 1,          // 小隊打完一張票後，休整幾小時才能接下一張
  AUTO_POW: .8,     // 自動結算：火力打折
  AUTO_PTS: .8,     // 自動結算：積分打折
  CLONE_VALUE: 30,  // 一名複製人的成本（死了就是業務損失）
  UPKEEP: 4,        // 每小隊每天的維持費（糧水、零件）
  ROUNDS: 6,        // 自動結算的交火回合
  TRAVEL: 1.5,      // 行軍：每一點路程成本要幾小時（沿實際道路）
  SQUAD: 4,         // 小隊滿編人數
};

// ===== 亂數：狀態存在帳本裡，存檔讀檔後接得上 =====
function rng(book) { let a = book.rs | 0; a = a + 0x6D2B79F5 | 0; book.rs = a; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const pickOf = (book, arr) => arr[Math.floor(rng(book) * arr.length)];

export function newBook(seed = 1) { return {rs: seed | 0, nextId: 1, t: 0, cases: [], tickets: [], squads: {}, ledger: [], inbox: [], companies: {}, amends: [], trips: []}; }

// ===== 小隊 =====
const VPOW = {rush: 4, gt: 6, armor: 14};
export function makeSquad(book, player, o = {}) {
  const id = 'S' + book.nextId++;
  const clones = o.clones ? o.clones.map(c => Object.assign(c, {hp: 20, alive: true})) : Array.from({length: o.size || 4}, () => ({id: 'C-' + (1000 + book.nextId++), pow: o.pow || 6, hp: 20, alive: true}));
  const at = o.at ?? book.companies[player]?.base ?? -1;
  const sq = {id, player, name: o.name || `${player}・${id}`, clones, gear: o.gear ?? 6, veh: o.veh || null, caseId: null, readyAt: 0, busy: null, at};
  book.squads[id] = sq; return sq;
}
export const alive = sq => sq.clones.filter(c => c.alive);
export function squadPower(sq) { return alive(sq).reduce((x, c) => x + c.pow, 0) * (1 + sq.gear / 20) + (sq.veh ? VPOW[sq.veh] : 0); }

// ===== 帳本與通知 =====
function pay(book, t, player, amount, kind, text, caseId) { book.ledger.push({t, player, amount: Math.round(amount), kind, text, caseId}); }
function notify(book, t, player, kind, text, ref) { book.inbox.push({t, player, kind, text, ref}); }

// ===== 開案 =====
// spec：{kind:'route'|'front'|'garrison'|'hunt', title, tile, from, to, fac(雇主), foe(敵對勢力，沒有就 -1), gang, lv, hours, cargo:{g,amt}}
export function openCase(book, w, spec, now) {
  const P = w.sim.pmc, K = w.sim.peek();
  const c = {id: 'K' + book.nextId++, kind: spec.kind, title: spec.title, tile: spec.tile, from: spec.from ?? -1, to: spec.to ?? -1,
    fac: spec.fac ?? -1, foe: spec.foe ?? -1, gang: spec.gang ?? 0, lv: spec.lv || 1, start: now, end: now + (spec.hours || 168), settled: false, midPaid: false,
    path: [], convoys: 0, lostConvoys: [], cargo: spec.cargo || null, squads: [], score: {}, tickets: 0, open: true, basePow: 14 + 4 * (spec.lv || 1), history: []};
  if (c.kind === 'route') {
    c.path = P.route(c.from, c.to);
    c.convoys = Math.max(4, Math.min(12, Math.round(c.path.length * .6)));
  }
  const L = c.lv, H = (c.end - c.start) / 168;
  c.pay = {deposit: 5 * L, mid: 5 * L, final: Math.round(160 * L * H * (c.kind === 'front' ? 1.4 : c.kind === 'hunt' ? 1.2 : c.kind === 'route' ? 1.2 : 1))};
  if (spec.own) { c.own = spec.own; c.freeze = 0; c.pay = {deposit: 0, mid: 0, final: 0}; c.basePow = spec.guard ?? c.basePow; }
  book.cases.push(c);
  return c;
}

// 從機會層的一個點開案（玩家在地圖上點一個機會、接下合約）
export function caseFromOpp(book, w, opp, now, o = {}) {
  const K = w.sim.peek(), nm = t => w.names[t] || '無名之地';
  const towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
  const nearTowns = (t, ok = () => true) => towns.filter(ok).sort((a, b) => hdist(a, t) - hdist(b, t));
  const lv = opp.lv, hours = o.hours || 168;
  if (opp.kind === 'short') {
    const g = opp.g, to = opp.tile, f = K.owner[to];
    const src = nearTowns(to, t => t !== to && (K.markets[t].ratio?.[g] ?? 1) >= 1 && K.markets[t].stock[g] > 5)[0] ?? nearTowns(to, t => t !== to)[0];
    if (src === undefined) return null;
    const amt = Math.round(Math.max(10, K.markets[to].pop * .3));
    return openCase(book, w, {kind: 'route', title: `把${GN[g]}從${nm(src)}運到${nm(to)}`, tile: to, from: src, to, fac: f, lv, hours, cargo: {g, amt}}, now);
  }
  if (opp.kind === 'route') {
    const [a, b] = nearTowns(opp.tile); if (b === undefined) return null;
    const m = K.markets[a], g = ['food', 'water', 'fuel', 'parts', 'ammo'].sort((x, y) => m.stock[y] * BASEP[y] - m.stock[x] * BASEP[x])[0];
    return openCase(book, w, {kind: 'route', title: `護送${nm(a)}往${nm(b)}的${GN[g]}車隊`, tile: opp.tile, from: a, to: b, fac: K.owner[a], lv, hours, cargo: {g, amt: Math.round(20 + 15 * lv)}}, now);
  }
  if (opp.kind === 'exp') {
    const [home] = nearTowns(opp.tile); if (home === undefined) return null;
    return openCase(book, w, {kind: 'route', title: `從${nm(opp.tile)}把東西運回${nm(home)}`, tile: opp.tile, from: opp.tile, to: home, fac: K.owner[home], lv, hours, cargo: {g: 'parts', amt: Math.round(10 + 10 * lv)}}, now);
  }
  if (opp.kind === 'front') {
    const side = o.side === 'def' ? 'def' : 'att', f = opp[side], foe = side === 'att' ? opp.def : opp.att;
    return openCase(book, w, {kind: 'front', title: `${K.fac[f].n}的戰線：${opp.title}`, tile: opp.tile, fac: f, foe, lv: Math.max(2, lv), hours}, now);
  }
  if (opp.kind === 'tense') {
    const f = o.side === 'b' ? opp.b : opp.a, foe = f === opp.a ? opp.b : opp.a;
    return openCase(book, w, {kind: 'garrison', title: `替${K.fac[f].n}在${nm(opp.tile)}壓陣`, tile: opp.tile, fac: f, foe, lv, hours}, now);
  }
  if (opp.kind === 'lair') {
    const [home] = nearTowns(opp.tile);
    return openCase(book, w, {kind: 'hunt', title: `清剿${opp.title}`, tile: opp.tile, fac: home !== undefined ? K.owner[home] : -1, gang: opp.gang, lv, hours}, now);
  }
  return null;
}

// ===== 公司與駐紮地 =====
// 公司總部在某座城（開局選的主城），培養槽在那裡：從總部派人要現造複製人（付成本）。
// 駐紮地是事先用遠征模式送到位的人手（已經付過錢），離戰場近，派過去快。
export function registerCompany(book, player, base) { book.companies[player] = book.companies[player] || {player, base, posts: {}}; return book.companies[player]; }
export function station(book, player, tile, n) { const C = book.companies[player]; C.posts[tile] = (C.posts[tile] || 0) + n; }
export function travelHours(w, from, to) { if (from < 0 || from === to) return 0; const d = w.sim.pmc.dist(from, to); return isFinite(d) ? Math.ceil(d * CFG.TRAVEL) : Infinity; }

// ===== 報名：每隊付訂金；小隊從所在地沿路走到案件現場，到了才能接票 =====
export function enlist(book, caseId, squadId, now, w) {
  const c = book.cases.find(x => x.id === caseId), sq = book.squads[squadId];
  if (!c || !sq || !c.open || sq.caseId) return false;
  const eta = now + (w ? travelHours(w, sq.at, c.tile) : 0);
  if (eta >= c.end - (c.freeze ?? CFG.FREEZE)) return false;   // 趕不上：到的時候已經不出票了
  const from = sq.at;
  sq.caseId = c.id; sq.readyAt = eta; c.squads.push(sq.id); sq.at = c.tile;
  if (w && eta > now) sq.move = {path: w.sim.pmc.route(from, c.tile), t0: now, t1: eta};
  if (w) planTrip(book, w, c, sq.id, from, now, eta);
  pay(book, now, sq.player, c.pay.deposit, 'deposit', `${c.title}：訂金（${sq.name}）`, c.id);
  if (eta > now) notify(book, now, sq.player, 'move', `${sq.name} 出發前往${c.title}，約 ${eta - now} 小時後到位。`, c.id);
  return true;
}

// ===== 契約變更：補員 =====
// 小隊打薄了，向雇主申請變更契約、從總部或駐紮地調人補上。
// 雇主不另付錢（訂金、期中款還是按原本的隊算），人要自己出；調來的人沿路走過來，走到之前這隊照樣用殘編上場。
// 只能在還會出票的期間申請，而且要趕得上。
export function amend(book, w, squadId, n, from, now, o = {}) {
  const sq = book.squads[squadId], c = sq && book.cases.find(x => x.id === sq.caseId), C = sq && book.companies[sq.player];
  if (!sq || !c || !c.open || !C) return {ok: false, why: '沒有進行中的案件'};
  // 雇主看你在這個案件的表現：打了三張以上、輸掉一半以上或一半以上放著讓它自動結算，就不准補人
  const mine = book.tickets.filter(t => t.caseId === c.id && t.player === sq.player && t.done && !t.transit);
  const lost = mine.filter(t => !t.win).length, autos = mine.filter(t => t.auto).length;
  if (sq.refused) return {ok: false, why: '雇主拒絕', refused: true};
  if (mine.length >= 3 && (lost / mine.length > .5 || autos / mine.length > .5)) {
    sq.refused = true;
    notify(book, now, sq.player, 'refused', `${c.title}：雇主拒絕契約變更（${lost > mine.length / 2 ? `${mine.length} 場輸了 ${lost} 場` : `${mine.length} 張票有 ${autos} 張放著沒打`}）。`, c.id);
    return {ok: false, why: '雇主拒絕', refused: true};
  }
  const pending = book.amends.filter(a => a.squad === sq.id && !a.done).reduce((x, a) => x + a.n, 0);
  if (o.clones) n = o.clones.length;
  n = Math.min(n, CFG.SQUAD - alive(sq).length - pending); if (n <= 0) return {ok: false, why: '已經滿編'};
  if (o.clones) o.clones = o.clones.slice(0, n);
  const fromPost = from !== C.base && !o.clones;
  if (fromPost && (C.posts[from] || 0) < n) return {ok: false, why: '駐紮地人手不夠'};
  const eta = now + travelHours(w, from, c.tile);
  if (eta >= c.end - (c.freeze ?? CFG.FREEZE)) return {ok: false, why: '趕不上'};
  if (fromPost) C.posts[from] -= n;
  else if (!o.clones) pay(book, now, sq.player, -CFG.CLONE_VALUE * n, 'reinforce', `${c.title}：契約變更，從總部培養槽調 ${n} 人補${sq.name}`, c.id);
  // 調來的人編成一支行軍縱隊，路上一樣可能被劫
  const col = makeSquad(book, sq.player, {size: n, clones: o.clones, at: from, gear: sq.gear, name: `${sq.name} 的補員`}); col.column = true; col.caseId = null;
  col.move = {path: w.sim.pmc.route(from, c.tile), t0: now, t1: eta};
  const a = {id: 'A' + book.nextId++, squad: sq.id, col: col.id, caseId: c.id, n, from, at: now, eta, done: false};
  book.amends.push(a);
  planTrip(book, w, c, col.id, from, now, eta);
  notify(book, now, sq.player, 'move', `契約變更：${n} 人從${fromPost ? '駐紮地' : '總部'}出發補${sq.name}，約 ${eta - now} 小時後到。`, a.id);
  return {ok: true, eta, amend: a};
}
function arrive(book, a, now) {
  const col = book.squads[a.col];
  if (col && col.busy) return;   // 還在路上打，打完再到
  a.done = true; const sq = book.squads[a.squad];
  const got = col ? alive(col) : [];
  if (col) delete book.squads[col.id];
  if (!got.length) { notify(book, now, sq.player, 'move', `${sq.name} 的補員在路上全滅，沒有人到。`, a.id); return; }
  a.n = got.length;
  // 打到全滅、或案件已經結算，人就留在現場當駐紮
  const c = book.cases.find(x => x.id === a.caseId);
  if (!sq.caseId || c?.settled) { station(book, sq.player, c ? c.tile : sq.at, a.n); return; }
  for (const g of got) { g.hp = 20; sq.clones.push(g); }
  sq.clones = sq.clones.filter(c => c.alive).concat(sq.clones.filter(c => !c.alive)).slice(0, 12);
  notify(book, now, sq.player, 'move', `補員到位：${sq.name} 回到 ${alive(sq).length} 人。`, a.id);
}

// ===== 召回 =====
// 沿路徑算出某一刻在哪：回傳 {a, b, f}（在 a、b 兩格之間，走了 f）
export function posOn(path, f) {
  if (!path || !path.length) return null; if (path.length === 1) return {a: path[0], b: path[0], f: 0};
  const x = Math.max(0, Math.min(1, f)) * (path.length - 1), i = Math.min(path.length - 2, Math.floor(x));
  return {a: path[i], b: path[i + 1], f: x - i};
}
export function whereIs(sq, c, now) {
  if (sq.move && now < sq.move.t1) return posOn(sq.move.path, (now - sq.move.t0) / Math.max(1, sq.move.t1 - sq.move.t0));
  if (c && c.own) { const f = (now - c.start) / Math.max(1, c.end - c.start); return f < .5 ? posOn([...c.path].reverse(), f * 2) : posOn(c.path, f * 2 - 1); }
  const t = c ? c.tile : sq.at; return {a: t, b: t, f: 0};
}
// 把小隊從案件裡撤出來。正式合約算毀約：付違約金（這一隊拿過的訂金、期中款，再加 10×程度），
// 公司在這個案件裡已經沒有別的小隊的話，積分作廢、不分尾款。手上的任務票交給案件的護衛自己打。
export function withdraw(book, w, squadId, now) {
  const sq = book.squads[squadId], c = sq && book.cases.find(x => x.id === sq.caseId);
  if (!sq || !c || c.settled) return {ok: false, why: '沒有進行中的案件'};
  const pos = whereIs(sq, c, now), here = pos ? (pos.f < .5 ? pos.a : pos.b) : c.tile;
  if (sq.busy) { const tk = book.tickets.find(t => t.id === sq.busy); if (tk && !tk.done) { tk.player = null; tk.squad = null; tk.abandoned = true; if (!tk.transit) npcResolve(book, w, c, tk, now); else tk.done = true; } }
  sq.busy = null; c.squads = c.squads.filter(id => id !== sq.id); sq.caseId = null; sq.move = null; sq.at = here;
  for (const tr of book.trips) if (tr.unit === sq.id) tr.done = true;
  let penalty = 0;
  if (!c.own) {
    penalty = c.pay.deposit + (c.midPaid ? c.pay.mid : 0) + 10 * c.lv;
    pay(book, now, sq.player, -penalty, 'penalty', `${c.title}：毀約召回${sq.name}，違約金`, c.id);
    if (!c.squads.some(id => book.squads[id]?.player === sq.player)) { c.score[sq.player] = 0; (c.quit = c.quit || {})[sq.player] = true; }
  }
  // 還在路上的補員一起掉頭
  const cols = [];
  for (const a of book.amends) if (a.squad === sq.id && !a.done) { const r = cancelAmend(book, a.id, now); if (r) cols.push(r); }
  notify(book, now, sq.player, 'move', `${sq.name} 被召回${c.own ? '' : `（毀約，違約金 $${penalty}）`}，從${w.names[here] || '野外'}動身回總部。`, c.id);
  return {ok: true, penalty, here, cols};
}
export function cancelAmend(book, amendId, now) {
  const a = book.amends.find(x => x.id === amendId); if (!a || a.done) return null;
  const col = book.squads[a.col]; if (col && col.busy) return null;   // 正在路上打，打完再說
  a.done = true; a.cancelled = true;
  for (const tr of book.trips) if (tr.unit === a.col) tr.done = true;
  const pos = col ? whereIs(col, null, now) : null, here = pos ? (pos.f < .5 ? pos.a : pos.b) : a.from;
  const clones = col ? alive(col) : []; if (col) delete book.squads[col.id];
  return {here, clones};
}

// ===== 事件骰：這個案件現在每小時出事的機率（跟沙盒的真實狀況走） =====
function hazard(c, w) {
  const K = w.sim.peek(), P = w.sim.pmc;
  if (c.kind === 'route') {
    let b = 0, warT = 0; for (const t of c.path) { b += K.bandit[t]; if (c.fac >= 0 && K.owner[t] >= 0 && P.atWar(K.owner[t], c.fac)) warT++; }
    const left = c.convoys - c.lostConvoys.length; if (left <= 0) return 0;
    return (.04 + b / 4000 + warT * .02) * (.6 + .4 * left / c.convoys);
  }
  if (c.kind === 'front') {
    const W = P.war(c.fac, c.foe); if (!W) return 0;
    return .12 + Math.min(.08, (K.trench[c.tile] || 0) * .04) + (W.siege ? .05 : 0);
  }
  if (c.kind === 'garrison') {
    if (P.atWar(c.fac, c.foe)) return .15;   // 壓陣壓到開戰了
    return .03 + Math.min(.1, P.tension(c.fac, c.foe) / 400);
  }
  if (c.kind === 'hunt') {
    const g = K.gangs.find(x => x.id === c.gang); if (!g || g.gone) return 0;
    return .05 + Math.min(.07, g.str / 4000);
  }
  return 0;
}

// 案件還成立嗎（仗打完了、據點散了，案件就提早收尾：不再出票）
function stillValid(c, w) {
  const K = w.sim.peek(), P = w.sim.pmc;
  if (c.kind === 'front') return !!P.war(c.fac, c.foe);
  if (c.kind === 'hunt') { const g = K.gangs.find(x => x.id === c.gang); return !!g && !g.gone; }
  if (c.kind === 'route') return c.lostConvoys.length < c.convoys;
  return K.fac[c.fac]?.alive && K.fac[c.foe]?.alive;
}

// ===== 事件 → 任務票 =====
const TYPES = {
  ambush:    {n: '車隊遇襲', night: .3, obj: [['protect', '護住車隊', 3], ['repel', '擊退掠奪者', 2], ['nolose', '全員生還', 1]]},
  native:    {n: '原住民襲擊', night: .5, obj: [['protect', '護住車隊', 3], ['repel', '擊退襲擊者', 2], ['nolose', '全員生還', 1]]},
  intercept: {n: '敵軍攔截', night: .2, obj: [['protect', '護住車隊', 3], ['break', '突破攔截', 2], ['nolose', '全員生還', 1]]},
  trench:    {n: '夜襲戰壕', night: 1, obj: [['breach', '突入壕溝', 3], ['demo', '炸毀工事', 2], ['nolose', '全員生還', 1]]},
  assault:   {n: '突擊', night: .2, obj: [['take', '奪下目標', 4], ['nolose', '全員生還', 1]]},
  hold:      {n: '守點', night: .4, obj: [['hold', '守住陣地', 4], ['nolose', '全員生還', 1]]},
  sabotage:  {n: '破壞車場', night: 1, obj: [['demo', '炸掉載具', 3], ['out', '全身而退', 2]]},
  probe:     {n: '巡邏遭遇', night: .3, obj: [['repel', '逼退對方巡邏隊', 3], ['nolose', '全員生還', 1]]},
  transit:   {n: '行軍遇襲', night: .4, obj: [['through', '突圍到位', 0], ['nolose', '全員生還', 0]]},
  clear:     {n: '清剿', night: .3, obj: [['clear', '掃蕩據點外圍', 3], ['boss', '擊倒頭目', 2], ['nolose', '全員生還', 1]]},
};

// 路上某一格會碰到誰：交戰勢力的地盤是攔截，附近有原住民是原住民，其餘是掠奪者
function eventAt(c, w, t) {
  const K = w.sim.peek(), P = w.sim.pmc, o = K.owner[t];
  if (c.fac >= 0 && o >= 0 && P.atWar(o, c.fac)) return {type: 'intercept', tile: t, foe: o};
  const g = K.gangs.find(x => !x.gone && x.native && hdist(x.lair, t) <= 3);
  return g ? {type: 'native', tile: t, gang: g.id} : {type: 'ambush', tile: t};
}

function drawType(book, c, w) {
  const K = w.sim.peek(), P = w.sim.pmc;
  if (c.kind === 'route') {
    // 在路上挑一格：掠奪者越多越容易出事；碰到交戰勢力的地盤就是攔截
    const tw = c.path.map(t => K.bandit[t] + 4 + (c.fac >= 0 && K.owner[t] >= 0 && P.atWar(K.owner[t], c.fac) ? 40 : 0));
    let r = rng(book) * tw.reduce((x, y) => x + y, 0), i = 0; for (; i < tw.length - 1 && r > tw[i]; i++) r -= tw[i];
    return eventAt(c, w, c.path[i]);
  }
  if (c.kind === 'front') {
    const W = P.war(c.fac, c.foe), atk = W && W.att === c.fac, tr = K.trench[c.tile] || 0;
    const opts = atk ? [['assault', 3], ['trench', tr > .2 ? 4 : 0], ['sabotage', 1.5], ['hold', 1]] : [['hold', 4], ['trench', tr > .2 ? 1.5 : 0], ['sabotage', 1.5], ['assault', 1]];
    let r = rng(book) * opts.reduce((x, o) => x + o[1], 0), k = 0; for (; k < opts.length - 1 && r > opts[k][1]; k++) r -= opts[k][1];
    return {type: opts[k][0], tile: c.tile, foe: c.foe};
  }
  if (c.kind === 'garrison') return {type: 'probe', tile: c.tile, foe: c.foe};
  if (c.kind === 'hunt') return {type: 'clear', tile: c.tile, gang: c.gang};
}

// 敵人：從沙盒裡真正在那裡的東西算出來
function enemyOf(book, w, c, ev) {
  const K = w.sim.peek(), t = ev.tile, L = c.lv;
  if (ev.type === 'ambush' || ev.type === 'native' || ev.type === 'clear') {
    const g = ev.gang ? K.gangs.find(x => x.id === ev.gang) : K.gangs.filter(x => !x.gone && hdist(x.lair, t) <= 3).sort((a, b) => hdist(a.lair, t) - hdist(b.lair, t))[0];
    const leg = g ? K.weapons.find(x => x.gang === g.id) : null;
    const power = 6 + K.bandit[t] * .12 + (g ? g.str * .025 : 0) + (ev.type === 'clear' ? 6 : 0) + 2 * L;
    const side = g && g.native ? 'native' : 'raider';
    return {side, name: g ? g.name : '流竄的掠奪者', fac: -1, power: Math.round(power), units: unitsOf(book, side, power, null), boss: leg ? {weapon: leg.name, kind: leg.kind} : null};
  }
  // 勢力部隊：看對方的複製兵、車庫、壕溝
  const f = ev.foe, F = K.fac[f];
  const towns = Object.keys(K.markets).map(Number).filter(x => K.owner[x] === f).sort((a, b) => hdist(a, t) - hdist(b, t));
  const m = towns.length ? K.markets[towns[0]] : null, veh = {};
  for (const v of ['rush', 'armor', 'gt']) veh[v] = m && m.veh ? Math.min(v === 'rush' ? 3 : 1, Math.floor((m.veh[v] || 0) * (.2 + rng(book) * .3))) : 0;
  if (ev.type === 'trench' || ev.type === 'sabotage') { veh.rush = 0; }
  const tr = K.trench[t] || 0, cl = Math.min(1, (F.clones || 0) / 80);
  const power = (16 + 6 * L + (ev.type === 'hold' ? 6 : 0) + (ev.type === 'trench' ? tr * 8 : 0) + 8 * cl) * (ev.type === 'probe' ? .7 : 1) + veh.rush * 3 + veh.armor * 10 + veh.gt * 4;
  return {side: 'faction', name: F.n, fac: f, power: Math.round(power), clones: cl, trench: +tr.toFixed(2), veh,
    units: unitsOf(book, 'faction', power - veh.rush * 3 - veh.armor * 10 - veh.gt * 4, cl)};
}
function unitsOf(book, side, power, cloneShare) {
  const n = Math.max(3, Math.min(14, Math.round(power / 4))), u = {};
  const add = k => u[k] = (u[k] || 0) + 1;
  for (let i = 0; i < n; i++) {
    const r = rng(book);
    if (side === 'raider') add(r < .15 ? 'raider_heavy' : 'raider');
    else if (side === 'native') add(r < .25 ? 'native_hunter' : 'native');
    else add(r < (cloneShare || 0) ? 'clone_trooper' : r < .85 ? 'trooper' : 'trooper_heavy');
  }
  return u;
}

function issue(book, w, c, now) {
  const ev = drawType(book, c, w); if (!ev) return null;
  const T = TYPES[ev.type], K = w.sim.peek(), nm = t => w.names[t] || '無名之地';
  const enemy = enemyOf(book, w, c, ev);
  const tk = {id: 'T' + book.nextId++, caseId: c.id, type: ev.type, title: `${T.n}：${nm(ev.tile)}`, tile: ev.tile,
    biome: BIOMES[K.biome[ev.tile]]?.n || '', night: rng(book) < T.night, trench: +(K.trench[ev.tile] || 0).toFixed(2), enemy,
    objectives: T.obj.map(([k, text, pts]) => ({k, text, pts: pts * c.lv})), born: now, squad: null, player: null, issued: -1, deadline: -1, done: false};
  if (c.kind === 'route') { const left = []; for (let i = 0; i < c.convoys; i++) if (!c.lostConvoys.includes(i)) left.push(i); tk.convoy = pickOf(book, left); }
  book.tickets.push(tk); c.tickets++;
  return tk;
}

// ===== 行軍途中遇襲 =====
// 出發時就沿實際道路算好這一趟的風險（跟沙盒裡商隊被劫的算法同一套），決定會不會、在哪一格、第幾小時出事
function planTrip(book, w, c, unitId, from, now, eta) {
  if (eta - now < 2 || from < 0) return;
  const K = w.sim.peek(), P = w.sim.pmc, path = P.route(from, c.tile).filter(t => t !== c.tile);
  if (!path.length) return;
  const tw = path.map(t => K.bandit[t] + (c.fac >= 0 && K.owner[t] >= 0 && P.atWar(K.owner[t], c.fac) ? 40 : 0));
  const risk = tw.reduce((x, y) => x + y, 0);
  if (rng(book) >= 1 - Math.exp(-risk / 1500)) return;
  let r = rng(book) * risk, i = 0; for (; i < tw.length - 1 && r > tw[i]; i++) r -= tw[i];
  book.trips.push({unit: unitId, caseId: c.id, tile: path[i], at: now + 1 + Math.floor(rng(book) * (eta - now - 1)), done: false});
}
function tripAmbush(book, w, trip, now) {
  trip.done = true;
  const c = book.cases.find(x => x.id === trip.caseId), sq = book.squads[trip.unit];
  if (!sq || !alive(sq).length || sq.busy) return;
  const ev = eventAt(c, w, trip.tile), K = w.sim.peek(), nm = t => w.names[t] || '無名之地';
  const tk = {id: 'T' + book.nextId++, caseId: c.id, type: ev.type, transit: true, title: `行軍遇襲：${nm(ev.tile)}`, tile: ev.tile,
    biome: BIOMES[K.biome[ev.tile]]?.n || '', night: rng(book) < TYPES.transit.night, trench: 0, enemy: enemyOf(book, w, c, ev),
    objectives: TYPES.transit.obj.map(([k, text, pts]) => ({k, text, pts})), born: now, done: false};
  book.tickets.push(tk);
  sq.busy = tk.id; tk.squad = sq.id; tk.player = sq.player; tk.issued = now; tk.deadline = now + CFG.DEADLINE;
  notify(book, now, sq.player, 'ticket', `${sq.name} 在前往${c.title}的路上遇襲（${tk.enemy.name}，戰力 ${tk.enemy.power}）。${CFG.DEADLINE} 小時內要打完，不然自動結算。行軍遇襲不算案件積分。`, tk.id);
}

// 指派：在這個案件裡、沒有票、休整完畢的小隊，誰最早空出來就給誰（打得快、派得多的公司就拿得多）
function assign(book, c, tk, now) {
  const free = c.squads.map(id => book.squads[id]).filter(s => !s.busy && s.readyAt <= now && alive(s).length >= 2);
  if (!free.length) return false;
  free.sort((a, b) => a.readyAt - b.readyAt || (rng(book) - .5));
  const sq = free[0];
  sq.busy = tk.id; tk.squad = sq.id; tk.player = sq.player; tk.issued = now; tk.deadline = now + CFG.DEADLINE;
  notify(book, now, sq.player, 'ticket', `${sq.name} 被抽到：${tk.title}（${tk.enemy.name}，戰力 ${tk.enemy.power}）。${CFG.DEADLINE} 小時內要打完，不然自動結算。`, tk.id);
  return true;
}

// ===== 交火：自動結算與手動打的模擬都用這一套（快速火力戰） =====
// mult：我方火力倍率（自動結算 0.8；手動打在測試裡用玩家技術來模擬）
export function fight(book, sq, enemy, mult = 1) {
  const HP0 = enemy.power * 3; let foeHP = HP0; const dead = [];
  for (let r = 0; r < CFG.ROUNDS && foeHP > 0; r++) {
    const live = alive(sq); if (!live.length) break;
    foeHP -= squadPower(sq) * mult * .6 * (.7 + rng(book) * .6);
    if (foeHP <= 0) break;
    let dmg = enemy.power * .6 * Math.max(.35, foeHP / HP0) * (.7 + rng(book) * .6);
    while (dmg > 0) { const L = alive(sq); if (!L.length) break; const c = pickOf(book, L), hit = Math.min(dmg, 6 + rng(book) * 6); c.hp -= hit; dmg -= hit; if (c.hp <= 0) { c.alive = false; dead.push(c.id); } }
  }
  return {win: foeHP <= 0, dead};
}

// 估勝算：拿小隊的複本打 n 場（用自己的亂數，不動帳本的亂數）
export function estimate(sq, enemy, mult = CFG.AUTO_POW, n = 200) {
  const tmp = {rs: 12345}; let win = 0, dead = 0;
  for (let i = 0; i < n; i++) { const cp = {...sq, clones: sq.clones.filter(c => c.alive).map(c => ({...c, hp: 20}))}; const r = fight(tmp, cp, enemy, mult); win += r.win ? 1 : 0; dead += r.dead.length; }
  return {p: win / n, dead: dead / n, pow: Math.round(squadPower(sq))};
}

// 把一場仗的結果轉成「完成了哪些目標」
export function objectivesDone(tk, win, dead, wipe) {
  const done = [];
  for (const o of tk.objectives) {
    if (o.k === 'nolose') { if (!dead.length && win) done.push(o.k); }
    else if (o.k === 'out') { if (!wipe) done.push(o.k); }
    else if (win) done.push(o.k);
  }
  return done;
}

// ===== 回報結果（手動打完） =====
// result：{win, done:[目標 k], dead:[複製人 id], gearLost?:數值}
export function submit(book, w, ticketId, result, now) {
  const tk = book.tickets.find(x => x.id === ticketId);
  if (!tk || tk.done || !tk.squad) return false;
  const sq = book.squads[tk.squad];
  for (const id of result.dead || []) { const c = sq.clones.find(x => x.id === id); if (c && c.alive) { c.alive = false; c.hp = 0; } }
  settleTicket(book, w, tk, {win: !!result.win, done: result.done || [], dead: result.dead || [], auto: false}, now);
  return true;
}

export function resolveNow(book, w, ticketId, now) { const tk = book.tickets.find(x => x.id === ticketId); if (!tk || tk.done || !tk.squad) return false; autoResolve(book, w, tk, now); return true; }
function autoResolve(book, w, tk, now) {
  const sq = book.squads[tk.squad];
  const r = fight(book, sq, tk.enemy, CFG.AUTO_POW);
  settleTicket(book, w, tk, {win: r.win, done: objectivesDone(tk, r.win, r.dead, !alive(sq).length), dead: r.dead, auto: true}, now);
}

// 沒有玩家接的事件：案件自帶的護衛自己打，沒有人拿積分，但結果一樣寫回沙盒
function npcResolve(book, w, c, tk, now) {
  const fake = {clones: Array.from({length: 4}, (_, i) => ({id: 'npc' + i, pow: c.basePow / 4 / 1.3, hp: 20, alive: true})), gear: 6, veh: null};
  const r = fight(book, fake, tk.enemy, 1);
  tk.done = true; tk.npc = true; tk.win = r.win;
  writeBack(book, w, c, tk, r.win, 0, now);
}

function settleTicket(book, w, tk, res, now) {
  const c = book.cases.find(x => x.id === tk.caseId), sq = book.squads[tk.squad];
  tk.done = true; tk.win = res.win; tk.auto = res.auto; tk.dead = res.dead; tk.doneAt = now;
  const valid = new Set(tk.objectives.map(o => o.k));
  const pts = tk.objectives.filter(o => res.done.includes(o.k) && valid.has(o.k)).reduce((x, o) => x + o.pts, 0) * (res.auto ? CFG.AUTO_PTS : 1);
  tk.pts = Math.round(pts * 10) / 10;
  if (!tk.transit) c.score[sq.player] = (c.score[sq.player] || 0) + tk.pts;
  // 陣亡的複製人：當下就是業務損失；身上的裝備掉在那一格
  let gearLost = 0;
  for (const id of res.dead) { pay(book, now, sq.player, -(CFG.CLONE_VALUE + sq.gear), 'loss', `${tk.title}：${id} 陣亡`, c.id); gearLost += sq.gear; }
  const wiped = !alive(sq).length;
  if (wiped && sq.veh) { gearLost += VPOW[sq.veh] * 4; pay(book, now, sq.player, -VPOW[sq.veh] * 4, 'loss', `${tk.title}：${sq.name} 的${sq.veh === 'rush' ? '衝鋒車' : sq.veh === 'gt' ? '戰鬥卡車' : '武裝車'}丟在戰場上`, c.id); sq.veh = null; }
  writeBack(book, w, c, tk, res.win, gearLost, now);
  sq.busy = null; sq.readyAt = Math.max(sq.readyAt, now + CFG.REST);
  if (tk.transit && !res.win) {   // 被打退：重整隊伍再走，多花 6 小時
    sq.readyAt += 6; if (sq.move) sq.move.t1 += 6; const a = book.amends.find(x => x.col === sq.id && !x.done); if (a) a.eta += 6; }
  for (const cl of alive(sq)) cl.hp = 20;   // 休整：活著的人傷勢恢復
  notify(book, now, sq.player, 'result', `${tk.title}：${res.win ? '勝' : '敗'}${res.auto ? '（自動結算）' : ''}，積分 ${tk.pts}${res.dead.length ? `，陣亡 ${res.dead.length}` : ''}。`, tk.id);
}

// ===== 寫回沙盒 =====
function writeBack(book, w, c, tk, win, gearLost, now) {
  const K = w.sim.peek(), P = w.sim.pmc, t = tk.tile;
  const nb = t => NBR[t].filter(n => n >= 0);
  if (tk.type === 'ambush' || tk.type === 'native' || tk.type === 'intercept') {
    if (win) { if (tk.type !== 'intercept') { K.bandit[t] = Math.max(0, K.bandit[t] - (5 + 3 * c.lv)); for (const n of nb(t)) K.bandit[n] = Math.max(0, K.bandit[n] - 2); } else P.aid(c.fac, 3); }
    else {
      K.bandit[t] = Math.min(100, K.bandit[t] + 3);
      if (c.cargo && tk.convoy !== undefined && !c.lostConvoys.includes(tk.convoy)) {
        c.lostConvoys.push(tk.convoy);
        const v = c.cargo.amt / c.convoys * (c.cargo.val ?? BASEP[c.cargo.g] ?? 1);
        if (tk.type === 'intercept') { const m = K.markets[Object.keys(K.markets).map(Number).filter(x => K.owner[x] === tk.enemy.fac).sort((a, b) => hdist(a, t) - hdist(b, t))[0]]; if (m && m.stock[c.cargo.g] !== undefined) m.stock[c.cargo.g] += c.cargo.amt / c.convoys; }
        else P.drop(t, v);   // 被搶走的貨：附近的人馬撿去坐大
      }
    }
  } else if (tk.type === 'trench') {
    if (win) { K.trench[t] = Math.max(0, K.trench[t] - .5); P.aid(c.fac, 8); }
  } else if (tk.type === 'assault') { if (win) P.aid(c.fac, 15); }
  else if (tk.type === 'hold') { if (win) P.aid(c.fac, 12); else P.aid(c.foe, 6); }
  else if (tk.type === 'sabotage') {
    if (win) { const tw = Object.keys(K.markets).map(Number).filter(x => K.owner[x] === c.foe).sort((a, b) => hdist(a, t) - hdist(b, t))[0], m = K.markets[tw];
      if (m && m.veh) { m.veh.armor = Math.max(0, (m.veh.armor || 0) - .5); m.veh.rush = Math.max(0, (m.veh.rush || 0) - 1); m.veh.gt = Math.max(0, (m.veh.gt || 0) - .3); m.stock.fuel *= .9; } }
  } else if (tk.type === 'probe') { if (win) P.calm(c.fac, c.foe, 3); }
  else if (tk.type === 'clear') {
    if (win) { const g = K.gangs.find(x => x.id === c.gang);
      if (g) { for (const n of [g.lair, ...nb(g.lair)]) K.bandit[n] *= .7; g.str *= .8;
        if (K.bandit[g.lair] < 12 && !g.gone) { g.gone = 1; P.say('bandit', `${g.name}${g.native ? '' : '的據點'}被傭兵公司清剿，手下四散。`, g.lair); c.closedEarly = true; } } }
  }
  if (gearLost > 0) P.drop(t, gearLost);
}

// ===== 時間推進：一小時一小時往前走 =====
export function tick(book, w, now) {
  for (let h = Math.floor(book.t) + 1; h <= now; h++) hour(book, w, h);
  book.t = Math.max(book.t, now);
}

function hour(book, w, now) {
  for (const tr of book.trips) if (!tr.done && now >= tr.at) tripAmbush(book, w, tr, now);
  for (const a of book.amends) if (!a.done && now >= a.eta) arrive(book, a, now);
  for (const c of book.cases) {
    if (c.settled) continue;
    // 1. 逾期的票：自動結算
    for (const tk of book.tickets) if (tk.caseId === c.id && !tk.done && tk.squad && now >= tk.deadline) autoResolve(book, w, tk, now);
    // 2. 等人接的事件：有小隊空出來就給它；等太久就讓護衛自己打
    for (const tk of book.tickets) if (tk.caseId === c.id && !tk.done && !tk.squad) {
      if (!assign(book, c, tk, now) && now - tk.born >= CFG.PENDING) npcResolve(book, w, c, tk, now);
    }
    // 3. 期中款
    if (!c.midPaid && now >= (c.start + c.end) / 2) { c.midPaid = true; for (const id of c.squads) { const s = book.squads[id]; if (alive(s).length) pay(book, now, s.player, c.pay.mid, 'mid', `${c.title}：期中款（${s.name}）`, c.id); } }
    // 4. 抽事件：結束前一段時間不再出票；案件已經不成立也不出
    if (c.open && (now >= c.end - (c.freeze ?? CFG.FREEZE) || c.closedEarly || !stillValid(c, w))) { c.open = false; c.closedAt = now; }
    if (c.open && rng(book) < hazard(c, w)) { const tk = issue(book, w, c, now); if (tk) assign(book, c, tk, now); }
    // 5. 結算：結束（或提早收尾）後再留一段緩衝
    const FZ = c.freeze ?? CFG.FREEZE, endAt = Math.min(c.end, (c.closedAt ?? c.end) + FZ) + (c.own ? 0 : CFG.BUFFER);
    if (now >= endAt && !book.tickets.some(tk => tk.caseId === c.id && !tk.done)) settleCase(book, w, c, now);
  }
}

function settleCase(book, w, c, now) {
  c.settled = true; c.settledAt = now;
  const K = w.sim.peek(), P = w.sim.pmc, nm = t => w.names[t] || '無名之地';
  let mult = 1;
  if (c.kind === 'route') {
    const delivered = 1 - c.lostConvoys.length / c.convoys; c.delivered = delivered; mult = delivered;
    if (c.cargo && !c.own && K.markets[c.to]) K.markets[c.to].stock[c.cargo.g] += c.cargo.amt * delivered;   // 送到的貨真的進了市場
  }
  const pool = c.pay.final * mult, tot = Object.values(c.score).reduce((x, y) => x + y, 0);
  c.payout = {};
  if (tot > 0 && pool > 0) for (const p in c.score) { if (!c.score[p] || c.quit?.[p]) continue; const v = pool * c.score[p] / tot; c.payout[p] = Math.round(v); pay(book, now, p, v, 'final', `${c.title}：尾款（積分 ${Math.round(c.score[p])}／${Math.round(tot)}）`, c.id); notify(book, now, p, 'pay', `${c.title} 結案，分到尾款 ${Math.round(v)}。`, c.id); }
  // 維持費、小隊歸建
  for (const id of c.squads) { const s = book.squads[id]; const days = (Math.min(now, c.end) - c.start) / 24; pay(book, now, s.player, -CFG.UPKEEP * days, 'upkeep', `${c.title}：維持費（${s.name}）`, c.id); s.caseId = null; s.busy = null; }
  // 編年史：只記值得記的
  const top = Object.entries(c.score).sort((a, b) => b[1] - a[1])[0];
  if (top && tot >= 10 * c.lv && !c.own) {
    if (c.kind === 'route' && c.delivered >= .99) P.say('trade', `${top[0]}護送的${c.cargo ? GN[c.cargo.g] : ''}車隊一路打到${nm(c.to)}，貨一車沒少。`, c.to);
    else if (c.kind === 'front') P.say('war', `${top[0]}替${K.fac[c.fac].n}在${nm(c.tile)}一帶打了 ${book.tickets.filter(t => t.caseId === c.id && t.player === top[0]).length} 場硬仗。`, c.tile);
  }
}

// ===== 查帳 =====
export function summary(book, player) {
  const L = book.ledger.filter(x => x.player === player), by = {};
  for (const x of L) by[x.kind] = (by[x.kind] || 0) + x.amount;
  return {by, net: L.reduce((x, y) => x + y.amount, 0)};
}
