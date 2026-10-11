// 奇美拉：案件與事件管線（沙盒端）
// 玩家公司把小隊（四名複製人＋裝備＋可選的載具）投進一個案件：補給線、遠征、主戰場、壓陣、清剿。
// 案件進行中，沙盒依當地真實狀況抽事件；抽到的事件發給「最早空出來」的小隊，變成一張限時 24 小時的服務單。
// 玩家可以親自打（ASH 單層任務，結果用 submit 回報），逾期就自動結算：只算火力，打折。
// 每張票的結果立刻寫回沙盒（掠奪者壓力、戰壕、下一場仗的戰力、遺落的裝備），案件結束後依積分分尾款。
// 時間單位一律是「小時」；整本帳（book）是純資料，可以直接存進 Durable Object。
import {BIOMES, GN, BASEP, NBR, hdist, VEH} from './sim.js';
const WX = () => globalThis.WSCALE ?? 1e4;   // 世界倍率（人口、物資、車、兵都放大這麼多；Alan 2026-10-11 新世界 ×10,000）

export const CFG = {
  DEADLINE: 24,     // 服務單期限
  FREEZE: 24,       // 案件結束前多久不再出票
  BUFFER: 24,       // 案件結束後的緩衝，之後才結算尾款
  PENDING: 6,       // 沒有小隊空著時，事件最多等幾小時；再等不到就由案件自帶的護衛自己打（沒有積分）
  REST: 1,          // 小隊打完一張票後，休整幾小時才能接下一張
  AUTO_POW: .8,     // 自動結算：火力打折
  NPC_POW: 1,       // NPC 傭兵公司（npc.js）的服務單用自動結算，不打折（真人親自打還是強得多）
  AUTO_PTS: .8,     // 自動結算：積分打折
  BODY_H: 168,      // 打輸留在戰場的遺體，幾小時內還撿得回來（Alan 2026-10-10：7 天），過了就確認戰死
  CLONE_VALUE: 30,  // 一名複製人的成本（死了就是業務損失）
  UPKEEP: 1,        // 維持費：每人每天（Alan 2026-10-11：原本每小隊每天 4、結案才一次算；改成每天記進應付帳款 sq.due，結案時結帳）
  FARE: .2,         // 交通費（Alan 2026-10-11）：慢車每人每格；快車三倍、速度兩倍（FAST）
  FARE_FAST: .6,
  AMMO_CAP: 5,      // 雇主吸收彈藥費的上限：每張服務單 5 × 案件等級，超過的自己付
  CELL_CAP_DRILL: 40, CELL_CAP_GUARD: 25,   // 練兵單、狩獵場：記憶片段 40 格以上不再抽；場地維安 25 格
  ROUNDS: 6,        // 自動結算的交火回合
  CASE_HOURS: 72,   // 案件長度（現實時間一比一後改成三天，原本 168；Alan 2026-10-08）
  TRAVEL: .15,      // 行軍：每一點路程成本要幾小時（沿實際道路）。測試用：原本 1.5，2026-10-08 Alan 要求縮成十分之一；伺服器化 S1 時重新平衡
  SQUAD: 4,         // 小隊滿編人數
  // 加速（Alan 2026-10-09）：付錢包車，路程時間乘上 FAST；每人每節省一小時 FAST_PRICE 元。來回同一套：去程加速，回程也加速、回程時再扣一次
  FAST: .5,
  FAST_PRICE: 1,
  TICKET_RATE: 2,   // 服務單派送頻率：每小時出事的機率乘上這個（Alan 2026-10-09：加倍，能做的事太少）
};

// ===== 亂數：狀態存在帳本裡，存檔讀檔後接得上 =====
function rng(book) { let a = book.rs | 0; a = a + 0x6D2B79F5 | 0; book.rs = a; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const pickOf = (book, arr) => arr[Math.floor(rng(book) * arr.length)];

// 服役紀錄（Alan 2026-10-10：每個實體自己的履歷，服務過哪些公司、打過哪些仗——故事的來源）。跟著人走，易主也不斷。
// 事件：born（出槽）、case（一個案件：打了幾場、贏幾場、尾款）、kia（陣亡）；之後加 down／recovered／transfer／merge
const REC_MAX = 300;
export function rec(cl, e) { (cl.record ||= []).push(e); if (cl.record.length > REC_MAX) cl.record.splice(1, 1); }
export const caseRec = (cl, id) => id == null ? null : (cl.record || []).findLast(e => e.t === 'case' && e.case === id);
export function joinRec(cl, c, co, now) { if (!caseRec(cl, c.id)) rec(cl, {h: now, t: 'case', co, case: c.id, title: c.title, tile: c.tile, kind: c.kind, fights: 0, wins: 0}); }
// ===== 格子收集經驗（Alan 2026-10-10）=====
// 每個人 100 格（存成 4 個 32 位元整數，格子編號 0～99；之後要把某一段對應到技能時不用改存檔）。照貢獻抽：每 1 點積分抽 CELL_DRAWS 次（照貢獻數抽）；
// 抽到空格就填上，抽到已經有的就累積保底，重複 CELL_PITY 次後下一抽保證是空格。等級＝1＋已填格數／10。同名（同一位原主）的兩個人可以合成：格子取聯集。
export const CELLS = 100, CELL_DRAWS = 1, CELL_PITY = 4;
export const cellHas = (c, i) => !!((c.cells?.[i >> 5] >>> (i & 31)) & 1);
const cellSet = (c, i) => { (c.cells ||= [0, 0, 0, 0])[i >> 5] = (c.cells[i >> 5] | (1 << (i & 31))) >>> 0; };
export const cellCount = c => { let n = 0; for (let i = 0; i < CELLS; i++) if (cellHas(c, i)) n++; return n; };
export const cellLevel = c => 1 + Math.floor(cellCount(c) / 10);
// 抽 n 次（r：0～1 的亂數）；回傳填了幾格
export function drawCells(c, n, r) {
  let got = 0; c.cells ||= [0, 0, 0, 0];
  for (let k = 0; k < n; k++) {
    const empty = []; for (let i = 0; i < CELLS; i++) if (!cellHas(c, i)) empty.push(i); if (!empty.length) break;
    if ((c.dup || 0) >= CELL_PITY) { cellSet(c, empty[Math.floor(r() * empty.length)]); c.dup = 0; got++; continue; }
    const i = Math.floor(r() * CELLS); if (cellHas(c, i)) c.dup = (c.dup || 0) + 1; else { cellSet(c, i); got++; }
  }
  return got;
}
// 合成：把 feed 的格子併進 keep；回傳多了幾格
export function mergeCells(keep, feed) { const n0 = cellCount(keep); keep.cells = [0, 1, 2, 3].map(i => ((keep.cells?.[i] || 0) | (feed.cells?.[i] || 0)) >>> 0); return cellCount(keep) - n0; }

export function newBook(seed = 1) { return {rs: seed | 0, nextId: 1, cloneSeq: 1, t: 0, cases: [], tickets: [], squads: {}, ledger: [], inbox: [], companies: {}, amends: [], trips: []}; }

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
export function pay(book, t, player, amount, kind, text, caseId) { book.ledger.push({t, player, amount: Math.round(amount), kind, text, caseId}); }
function notify(book, t, player, kind, text, ref) { book.inbox.push({t, player, kind, text, ref}); }

// ===== 開案 =====
// spec：{kind:'route'|'front'|'garrison'|'hunt', title, tile, from, to, fac(雇主), foe(敵對勢力，沒有就 -1), gang, lv, hours, cargo:{g,amt}}
export function openCase(book, w, spec, now) {
  const P = w.sim.pmc, K = w.sim.peek();
  const c = {id: 'K' + book.nextId++, kind: spec.kind, title: spec.title, tile: spec.tile, from: spec.from ?? -1, to: spec.to ?? -1,
    fac: spec.fac ?? -1, foe: spec.foe ?? -1, gang: spec.gang ?? 0, lv: spec.lv || 1, start: now, end: now + (spec.hours || CFG.CASE_HOURS), settled: false, midPaid: false,
    path: [], convoys: 0, lostConvoys: [], cargo: spec.cargo || null, squads: [], score: {}, tickets: 0, open: true, basePow: 14 + 4 * (spec.lv || 1), history: [], camp: spec.camp ?? null,
    op: spec.op ?? null, opName: spec.opName ?? null, side: spec.side ?? null, minLv: spec.minLv || 0, lic: spec.lic ?? null};
  if (c.kind === 'route') {
    c.path = P.route(c.from, c.to);
    c.convoys = Math.max(4, Math.min(12, Math.round(c.path.length * .6)));
  }
  const L = c.lv, H = (c.end - c.start) / 168;
  c.pay = {deposit: 5 * L, mid: 5 * L, final: Math.round(160 * L * H * (c.kind === 'front' ? 1.4 : c.kind === 'hunt' ? 2.6 : c.kind === 'route' ? 1.2 : c.kind === 'shadow' ? 1.6 : c.kind === 'privateer' ? .6 : 1))};
  if (c.kind === 'shadow' && c.side === 'att') { c.pay.deposit = 10 * L; c.pay.mid = 10 * L; }   // 黑單：訂金高、尾款更高（Alan 2026-10-11）
  if (spec.own) { c.own = spec.own; c.freeze = 0; c.pay = {deposit: 0, mid: 0, final: 0}; c.basePow = spec.guard ?? c.basePow; }
  // 大戰役：沒有訂金、期中款；每張服務單照當下的傭兵行情付報酬，戰役結束時再照貢獻分一筆（settleCase）
  if (c.kind === 'camp') { c.freeze = 0; c.pay = {deposit: 0, mid: 0, final: 0}; c.wave = {}; }
  book.cases.push(c);
  return c;
}

// 從機會層的一個點開案（玩家在地圖上點一個機會、接下合約）
export function caseFromOpp(book, w, opp, now, o = {}) {
  const K = w.sim.peek(), nm = t => w.names[t] || '無名之地';
  const towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
  const nearTowns = (t, ok = () => true) => towns.filter(ok).sort((a, b) => hdist(a, t) - hdist(b, t));
  const lv = opp.lv, hours = o.hours || CFG.CASE_HOURS;
  if (opp.kind === 'short') {
    const g = opp.g, to = opp.tile, f = K.owner[to];
    const src = opp.src ?? nearTowns(to, t => t !== to && (K.markets[t].ratio?.[g] ?? 1) >= 1 && K.markets[t].stock[g] > 5 * WX())[0];
    if (src === undefined) return null;   // 沒有一座城有多的貨，就不開（不再從沒貨的城「運」）
    // 一車貨＝目的地兩季的需求，但不超過來源城存貨的一半（結案時從來源城扣）
    const ms = K.markets[src], amt = Math.round(Math.min((K.markets[to].need?.[g] || 5) * 2, ms.stock[g] * .5));
    if (amt < 1) return null;
    return openCase(book, w, {kind: 'route', title: `把${GN[g]}從${nm(src)}運到${nm(to)}`, tile: to, from: src, to, fac: f, lv, hours, cargo: {g, amt, src}}, now);
  }
  // 伐木車隊（Alan 2026-10-10）：從林子（或油棘林）把燃料運回缺燃料的城；送到的燃料從那片林子扣（settleCase）
  if (opp.kind === 'logging') {
    // 一車燃料＝目的地兩季的需求，但不超過那片林子能砍的一半（只砍超過三成林木的部分；油棘林一份林木做三份燃料）
    const to = opp.to, oil = (K.biome[opp.tile] === 6), spare = Math.max(0, K.timber[opp.tile] - .3 * K.timberK[opp.tile]) * (oil ? 3 : 1);
    const amt = Math.round(Math.min((K.markets[to]?.need?.fuel || 5) * 2, spare * .5)); if (amt < 1) return null;
    return openCase(book, w, {kind: 'route', title: `護送${nm(opp.tile)}往${nm(to)}的${oil ? '油料' : '木柴'}車隊`, tile: opp.tile, from: opp.tile, to, fac: K.owner[to], lv, hours, cargo: {g: 'fuel', amt, forest: opp.tile}}, now);
  }
  if (opp.kind === 'route') {
    const [a, b] = nearTowns(opp.tile); if (b === undefined) return null;
    const m = K.markets[a], g = ['food', 'water', 'fuel', 'parts', 'ammo'].sort((x, y) => m.stock[y] * BASEP[y] - m.stock[x] * BASEP[x])[0];
    return openCase(book, w, {kind: 'route', title: `護送${nm(a)}往${nm(b)}的${GN[g]}車隊`, tile: opp.tile, from: a, to: b, fac: K.owner[a], lv, hours, cargo: {g, amt: Math.round((20 + 15 * lv) * WX())}}, now);
  }
  if (opp.kind === 'exp') {
    const [home] = nearTowns(opp.tile); if (home === undefined) return null;
    return openCase(book, w, {kind: 'route', title: `從${nm(opp.tile)}把東西運回${nm(home)}`, tile: opp.tile, from: opp.tile, to: home, fac: K.owner[home], lv, hours, cargo: {g: 'parts', amt: Math.round((10 + 10 * lv) * WX())}}, now);
  }
  if (opp.kind === 'front') {
    const side = o.side === 'def' ? 'def' : 'att', f = opp[side], foe = side === 'att' ? opp.def : opp.att;
    return openCase(book, w, {kind: 'front', title: `${K.fac[f].n}的戰線：${opp.title}`, tile: opp.tile, fac: f, foe, lv: Math.max(2, lv), hours}, now);
  }
  if (opp.kind === 'camp') {
    const side = o.side === 'def' ? 'def' : 'att', f = opp[side], foe = side === 'att' ? opp.def : opp.att;
    return openCase(book, w, {kind: 'camp', title: `${K.fac[f].n}的${opp.title}`, tile: opp.tile, fac: f, foe, lv: 3, hours, camp: opp.camp}, now);
  }
  if (opp.kind === 'tense') {
    const f = o.side === 'b' ? opp.b : opp.a, foe = f === opp.a ? opp.b : opp.a;
    return openCase(book, w, {kind: 'garrison', title: `替${K.fac[f].n}在${nm(opp.tile)}壓陣`, tile: opp.tile, fac: f, foe, lv, hours}, now);
  }
  // 暗影戰爭（Alan 2026-10-11）：黑單（攻方，雇主不具名）與反情報（守方，察覺之後才開）；案期跟著那件行動，到期集體擲骰
  if (opp.kind === 'shadow' || opp.kind === 'counter') {
    const def = opp.kind === 'counter', o = w.sim.pmc.op(opp.op); if (!o || o.state !== 'open') return null;
    return openCase(book, w, {kind: 'shadow', side: def ? 'def' : 'att', op: o.id, opName: o.op, title: def ? `替${K.fac[o.b].n}緝拿密探（${nm(o.tile)}）` : `${K.fac[o.a].n}的黑單：${opp.title.replace(/^黑單：/, '')}`,
      tile: o.tile, fac: def ? o.b : o.a, foe: def ? o.a : o.b, lv, minLv: def ? 0 : opp.minLv, hours}, now);
  }
  // 私掠（Alan 2026-10-11）：替發許可的勢力攔截敵國的商隊；許可範圍以外的勢力不會出單子
  if (opp.kind === 'privateer') {
    const t = towns.filter(x => K.owner[x] === opp.foe).sort((a, b) => hdist(a, opp.tile) - hdist(b, opp.tile))[0]; if (t === undefined) return null;
    return openCase(book, w, {kind: 'privateer', title: `${K.fac[opp.fac].n}的私掠：攔截${K.fac[opp.foe].n}的商隊`, tile: t, fac: opp.fac, foe: opp.foe, lic: opp.lic, lv, hours}, now);
  }
  // 練兵單（Alan 2026-10-11）：掃蕩城附近的流寇，難度 1～3（side）；到點立刻開打、打完就回家；車馬費很少，記憶片段 40 格以上不再抽
  if (opp.kind === 'drill') { const L = Math.max(1, Math.min(3, +o.side || 1));
    const c = openCase(book, w, {kind: 'drill', title: `掃蕩${nm(opp.tile)}附近的流寇（難度 ${L}）`, tile: opp.tile, fac: opp.fac, lv: L, hours: 48}, now); c.freeze = 0; c.pay = {deposit: 0, mid: 0, final: 0}; return c; }
  // 狩獵場：舊時代的設施，被幾乎絕種的外星生物佔據；入口的守衛收場地費；最多三層，彈藥自費
  if (opp.kind === 'hunting') { const c = openCase(book, w, {kind: 'hunting', title: opp.title, tile: opp.tile, fac: opp.fac, lv: 2, hours: 72}, now); c.freeze = 0; c.pay = {deposit: 0, mid: 0, final: 0}; c.selfAmmo = true; return c; }
  // 場地維安：駐守一段時間，報酬約打平交通費與維持費；照駐守時數抽記憶片段，偶爾有騷擾者；彈藥自費
  if (opp.kind === 'security') { const c = openCase(book, w, {kind: 'security', title: opp.title, tile: opp.tile, fac: opp.fac, lv: 1, hours}, now); c.freeze = 0; c.pay = {deposit: 0, mid: 0, final: 0}; c.selfAmmo = true; return c; }
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
// 行軍要幾小時（帶小數，不進位；Alan 2026-10-09：加速要真的減半，出發、抵達都照精確時刻，伺服器到時間用自己的時鐘確認）
export function travelHours(w, from, to, fast = false) { if (from < 0 || from === to) return 0; const d = w.sim.pmc.dist(from, to); return isFinite(d) ? d * CFG.TRAVEL * (fast ? CFG.FAST : 1) : Infinity; }
// 「約 X 小時 Y 分」
export const fmtDur = h => { const m = Math.max(0, Math.round(h * 60)); return m >= 60 ? `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分鐘`; };
// 加速的費用：n 個人、從 from 到 to，比一般走法省下的小時數 × 單價
export function speedCost(w, from, to, n) { const a = travelHours(w, from, to), b = travelHours(w, from, to, true); return isFinite(a) && isFinite(b) ? Math.round(Math.max(0, a - b) * n * CFG.FAST_PRICE) : 0; }
// 交通費（Alan 2026-10-11）：不是用走的，有慢車和快車；照路程格數、人數算，快車三倍
export function fareCost(w, from, to, n, fast = false) { if (from < 0 || from === to) return 0; const tiles = Math.max(0, w.sim.pmc.route(from, to).length - 1); return Math.round(tiles * n * (fast ? CFG.FARE_FAST : CFG.FARE) * 10) / 10; }
export function payFare(book, w, player, from, to, n, now, what, caseId, fast = false) { const cost = fareCost(w, from, to, n, fast); if (cost > 0) pay(book, now, player, -cost, 'fare', `${what}：${fast ? '快車' : '慢車'}交通費（${n} 人，$${cost}k）`, caseId); return cost; }
// 這一趟用加速：扣錢、記帳（kind 'speed'）
export function paySpeed(book, w, player, from, to, n, now, what, caseId) { const cost = speedCost(w, from, to, n); if (cost > 0) pay(book, now, player, -cost, 'speed', `${what}：加速（${n} 人，$${cost}k）`, caseId); return cost; }

// ===== 報名：每隊付訂金；小隊從所在地沿路走到案件現場，到了才能接票 =====
export function enlist(book, caseId, squadId, now, w) {
  const c = book.cases.find(x => x.id === caseId), sq = book.squads[squadId];
  if (!c || !sq || !c.open || sq.caseId) return false;
  const eta = now + (w ? travelHours(w, sq.at, c.tile, sq.fast) : 0);
  if (eta >= c.end - (c.freeze ?? CFG.FREEZE)) return false;   // 趕不上：到的時候已經不再派服務單了
  const from = sq.at;
  if (w && !c.own) payFare(book, w, sq.player, from, c.tile, alive(sq).length, now, `${c.title}（${sq.name}）去程`, c.id, !!sq.fast);
  sq.caseId = c.id; sq.readyAt = eta; sq.joinedAt = now; c.squads.push(sq.id); sq.at = c.tile;
  if (w && eta > now) sq.move = {path: w.sim.pmc.route(from, c.tile), t0: now, t1: eta};
  if (w) planTrip(book, w, c, sq.id, from, now, eta);
  if (c.pay.deposit) pay(book, now, sq.player, c.pay.deposit, 'deposit', `${c.title}：訂金（${sq.name}）`, c.id);
  if (eta > now) notify(book, now, sq.player, 'move', `${sq.name} ${sq.fast ? '加速' : ''}出發前往${c.title}，約 ${fmtDur(eta - now)}後到位。`, c.id);
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
    notify(book, now, sq.player, 'refused', `${c.title}：雇主拒絕契約變更（${lost > mine.length / 2 ? `${mine.length} 場輸了 ${lost} 場` : `${mine.length} 張服務單有 ${autos} 張放著沒打`}）。`, c.id);
    return {ok: false, why: '雇主拒絕', refused: true};
  }
  const pending = book.amends.filter(a => a.squad === sq.id && !a.done).reduce((x, a) => x + a.n, 0);
  if (o.clones) n = o.clones.length;
  n = Math.min(n, CFG.SQUAD - alive(sq).length - pending); if (n <= 0) return {ok: false, why: '已經滿編'};
  if (o.clones) o.clones = o.clones.slice(0, n);
  const fromPost = from !== C.base && !o.clones;
  if (fromPost && (C.posts[from] || 0) < n) return {ok: false, why: '駐紮地人手不夠'};
  const eta = now + travelHours(w, from, c.tile, !!o.fast);
  if (eta >= c.end - (c.freeze ?? CFG.FREEZE)) return {ok: false, why: '趕不上'};
  if (fromPost) C.posts[from] -= n;
  else if (!o.clones) pay(book, now, sq.player, -CFG.CLONE_VALUE * n, 'reinforce', `${c.title}：契約變更，從總部培養槽調 ${n} 人補${sq.name}`, c.id);
  // 調來的人編成一支行軍縱隊，路上一樣可能被劫
  const col = makeSquad(book, sq.player, {size: n, clones: o.clones, at: from, gear: sq.gear, name: `${sq.name} 的補員`}); col.column = true; col.caseId = null; col.fast = !!o.fast;
  payFare(book, w, sq.player, from, c.tile, n, now, `${c.title}（${sq.name} 的補員）`, c.id, !!col.fast);
  col.move = {path: w.sim.pmc.route(from, c.tile), t0: now, t1: eta};
  const a = {id: 'A' + book.nextId++, squad: sq.id, col: col.id, caseId: c.id, n, from, at: now, eta, done: false};
  book.amends.push(a);
  planTrip(book, w, c, col.id, from, now, eta);
  notify(book, now, sq.player, 'move', `契約變更：${n} 人從${fromPost ? '駐紮地' : '總部'}出發補${sq.name}，約 ${fmtDur(eta - now)}後到。`, a.id);
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
// 公司在這個案件裡已經沒有別的小隊的話，積分作廢、不分尾款。手上的服務單交給案件的護衛自己打。
export function withdraw(book, w, squadId, now) {
  const sq = book.squads[squadId], c = sq && book.cases.find(x => x.id === sq.caseId);
  if (!sq || !c || c.settled) return {ok: false, why: '沒有進行中的案件'};
  const pos = whereIs(sq, c, now), here = pos ? (pos.f < .5 ? pos.a : pos.b) : c.tile;
  if (sq.busy) { const tk = book.tickets.find(t => t.id === sq.busy); if (tk && !tk.done) { tk.player = null; tk.squad = null; tk.abandoned = true; if (!tk.transit && c.kind !== 'camp') npcResolve(book, w, c, tk, now); else tk.done = true; } }   // 大戰役：撤軍時手上那張就作廢
  sq.busy = null; c.squads = c.squads.filter(id => id !== sq.id); sq.caseId = null; sq.move = null; sq.at = here;
  for (const tr of book.trips) if (tr.unit === sq.id) tr.done = true;
  let penalty = 0;
  if (!c.own && c.kind !== 'camp') {   // 大戰役撤軍不算違約，已經打下的貢獻照算（Alan 2026-10-09）
    penalty = c.pay.deposit + (c.midPaid ? c.pay.mid : 0) + 10 * c.lv;
    pay(book, now, sq.player, -penalty, 'penalty', `${c.title}：毀約召回${sq.name}，違約金`, c.id);
    if (!c.squads.some(id => book.squads[id]?.player === sq.player)) { c.score[sq.player] = 0; (c.quit = c.quit || {})[sq.player] = true; }
  }
  // 還在路上的補員一起掉頭
  const cols = [];
  for (const a of book.amends) if (a.squad === sq.id && !a.done) { const r = cancelAmend(book, a.id, now); if (r) cols.push(r); }
  notify(book, now, sq.player, 'move', c.kind === 'camp' ? `${sq.name} 從${c.title}撤軍（不算違約，已打下的貢獻照算），從${w.names[here] || '野外'}動身回總部。` : `${sq.name} 被召回${c.own ? '' : `（毀約，違約金 $${penalty}k）`}，從${w.names[here] || '野外'}動身回總部。`, c.id);
  return {ok: true, penalty, here, cols};
}
export function cancelAmend(book, amendId, now) {
  const a = book.amends.find(x => x.id === amendId); if (!a || a.done) return null;
  const col = book.squads[a.col]; if (col && col.busy) return null;   // 正在路上打，打完再說
  a.done = true; a.cancelled = true;
  for (const tr of book.trips) if (tr.unit === a.col) tr.done = true;
  const pos = col ? whereIs(col, null, now) : null, here = pos ? (pos.f < .5 ? pos.a : pos.b) : a.from;
  const clones = col ? alive(col) : [], fast = !!col?.fast; if (col) delete book.squads[col.id];
  return {here, clones, fast};
}

// ===== 事件骰：這個案件現在每小時出事的機率（跟沙盒的真實狀況走） =====
function hazard(c, w) {
  const K = w.sim.peek(), P = w.sim.pmc;
  if (c.kind === 'camp') return 0;   // 大戰役的服務單不是骰出來的：空出來的小隊直接接下一張（campTickets）
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
  if (c.kind === 'shadow') { const o = P.op(c.op); return o && o.state === 'open' ? (c.side === 'def' ? .12 : .14) : 0; }
  if (c.kind === 'privateer') return P.atWar(c.fac, c.foe) && P.lic(c.lic) ? .14 : 0;
  if (c.kind === 'security') return .004;   // 騷擾者：一天大約一成
  return 0;
}

// 案件還成立嗎（仗打完了、據點散了，案件就提早收尾：不再出票）
function stillValid(c, w) {
  const K = w.sim.peek(), P = w.sim.pmc;
  if (c.kind === 'front') return !!P.war(c.fac, c.foe);
  if (c.kind === 'hunt') { const g = K.gangs.find(x => x.id === c.gang); return !!g && !g.gone; }
  if (c.kind === 'route') return c.lostConvoys.length < c.convoys;
  if (c.kind === 'camp') { const v = w.sim.campaignOf(c.camp); return !!v && !v.done; }
  if (c.kind === 'shadow') return P.op(c.op)?.state === 'open';
  if (c.kind === 'privateer') return !!P.lic(c.lic) && P.atWar(c.fac, c.foe);
  if (c.kind === 'drill' || c.kind === 'hunting' || c.kind === 'security') return true;
  return K.fac[c.fac]?.alive && K.fac[c.foe]?.alive;
}

// ===== 事件 → 服務單 =====
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
  // 暗影戰爭（Alan 2026-10-11）：都借現有的戰場（ash/overlay chimera-outdoor.js 的 LAYOUT）
  scout:     {n: '偵察', night: .8, obj: [['repel', '清掉巡邏', 2], ['out', '全身而退', 2]]},
  post:      {n: '拔除哨站', night: .9, obj: [['take', '拔掉哨站', 3], ['nolose', '不留下自己人', 2]]},
  heist:     {n: '潛入竊取', night: 1, obj: [['demo', '拿到東西', 3], ['out', '全身而退', 2]]},
  smuggle:   {n: '暗中運送', night: .7, obj: [['protect', '東西送到', 3], ['nolose', '不留下自己人', 2]]},
  rally:     {n: '守住集會', night: .3, obj: [['hold', '撐到集會散場', 3], ['nolose', '不留下自己人', 1]]},
  armory:    {n: '突襲軍械庫', night: .8, obj: [['demo', '打掉軍械庫', 3], ['out', '全身而退', 2]]},
  gunrun:    {n: '押運軍火', night: .5, obj: [['protect', '軍火送進匪窩', 3], ['nolose', '不留下自己人', 1]]},
  demo:      {n: '安裝炸藥', night: 1, obj: [['demo', '炸掉目標', 3], ['out', '全身而退', 2]]},
  flag:      {n: '偽旗突擊', night: .5, obj: [['take', '打下目標', 3], ['nolose', '不留下自己人', 3]]},
  well:      {n: '破壞水源', night: 1, obj: [['demo', '毀掉水井與抽水站', 3], ['out', '全身而退', 2]]},
  sweep:     {n: '搜捕密探', night: .5, obj: [['clear', '抓到密探', 3], ['nolose', '全員生還', 1]]},
  guard:     {n: '護衛要地', night: .6, obj: [['hold', '守住目標', 3], ['nolose', '全員生還', 1]]},
  raidcv:    {n: '攔截商隊', night: .3, obj: [['take', '攔下商隊', 3], ['nolose', '全員生還', 1]]},
  // 服務單的多樣性（Alan 2026-10-11）：黑單的接近（巡邏、檢查哨）與撤離（追兵、封鎖線）；護送的路障、路邊炸彈、拋錨守車
  patrol:    {n: '巡邏遭遇', night: .6, obj: [['repel', '打退巡邏隊', 2], ['out', '全身而退', 2]]},
  checkpoint:{n: '檢查哨', night: .5, obj: [['break', '拔掉檢查哨', 2], ['nolose', '不留下自己人', 2]]},
  pursuit:   {n: '撤離追兵', night: .6, obj: [['through', '撤到撤離點', 3], ['nolose', '不留下自己人', 2]]},
  cordon:    {n: '突破封鎖線', night: .4, obj: [['through', '衝過封鎖線', 3], ['nolose', '不留下自己人', 2]]},
  barricade: {n: '清除路障', night: .3, obj: [['protect', '拆掉路障', 3], ['nolose', '全員生還', 1]]},
  ied:       {n: '路邊炸彈', night: .2, obj: [['protect', '排除炸彈', 3], ['nolose', '全員生還', 1]]},
  breakdown: {n: '拋錨守車', night: .4, obj: [['protect', '守住車隊', 3], ['nolose', '全員生還', 1]]},
  drill:     {n: '掃蕩流寇', night: .2, obj: [['clear', '擊退流寇', 3], ['nolose', '全員生還', 1]]},
  hunting:   {n: '狩獵', night: 0, obj: [['clear', '打穿這一層', 3], ['nolose', '全員生還', 1]]},
  harass:    {n: '騷擾者', night: .6, obj: [['repel', '趕走騷擾的人', 2], ['nolose', '全員生還', 1]]},
};
// 每種暗影行動的服務單組合（DESIGN 定案）；守方是搜捕與護衛
const SHADOW_TICKETS = {暗殺: ['scout', 'post', 'heist'], 綁架: ['scout', 'post', 'heist', 'smuggle'], 煽動: ['smuggle', 'rally', 'armory'], 收買: ['smuggle', 'scout'],
  資助匪幫: ['gunrun'], 破壞: ['scout', 'demo'], 嫁禍: ['flag'], 斷水: ['scout', 'well']};
export const SOLO = new Set(['drill', 'hunting', 'security']);   // 各公司各開各的、打完就結算的案件
export const SHADOW_TYPES = new Set(['scout', 'post', 'heist', 'smuggle', 'rally', 'armory', 'gunrun', 'demo', 'flag', 'well', 'sweep', 'guard', 'patrol', 'checkpoint', 'pursuit', 'cordon']);
// 黑單分三段（Alan 2026-10-11）：案期前三成是接近、最後兩成是撤離，中間動手。PHASE 是接近、撤離的單（成功只算一部分，主要影響警戒度）
const PHASE = new Set(['patrol', 'checkpoint', 'pursuit', 'cordon']);
// 護送的特殊遭遇：base 是原本會碰到的（掠奪者、原住民、攔截），敵人照 base 產生
const ROAD = new Set(['barricade', 'ied', 'breakdown']);
// 開打前的情境（兩三句）。{p} 地名、{e} 敵人
const INTRO = {
  ambush: ['車隊在{p}放慢速度，路邊的廢車後面有人影晃動。', '{p}的彎道視線很差。前車的駕駛剛喊出聲，槍聲就響了。'],
  native: ['{p}的岩縫裡傳出哨音，一聲接一聲。{e}從高處衝下來了。', '車隊經過{p}時，路上插滿了骨飾。這是警告，也是宣戰。'],
  intercept: ['{e}的部隊在{p}攔路，要車隊停車受檢。沒有人打算停。', '無線電裡傳來{e}的口令：「前方車隊，原地停下。」'],
  barricade: ['前車急煞。{p}的路中央橫著幾台還在冒煙的車殼，後面拉了拒馬。這不是意外，是有人在等你們。', '{p}的路被堵死了：焚毀的卡車、鐵絲、拒馬。兩側的坡上有反光。'],
  ied: ['前導車的駕駛停下來，指著{p}路面上一塊新翻過的土。「不只一個。」', '{p}的路肩上有不該出現的電線。有人在這條路上埋了東西，而且知道車隊會經過。'],
  breakdown: ['{p}，主車的引擎冒出黑煙，整個車隊停在路中央。修好之前哪裡都去不了。', '車軸在{p}斷了。修車的人說要一段時間，遠處已經揚起了塵土。'],
  patrol: ['摸向{p}的路上，前面傳來腳步聲和閒聊。{e}的巡邏隊，比預期的早。', '{p}外圍。一隊{e}的巡邏兵正朝這邊走過來。'],
  checkpoint: ['通往{p}的路上，{e}設了一道檢查哨。繞不過去，只能拔掉。', '{p}前的檢查哨亮著燈，哨兵比情報說的多。'],
  pursuit: ['任務完成了，但{p}的警報響徹整片地。{e}的追兵從後面湧上來，撤離點在前方。', '身後的{p}一片火光。{e}的人一路追了上來。'],
  cordon: ['{e}在{p}一帶拉起了封鎖線。要回去，就得衝過去。', '撤離路線被{e}堵住了。{p}的封鎖線後面是唯一的出路。'],
};
// 打贏後的一句收尾（通知裡）
export const OUTRO = {barricade: '路障拆了，車隊重新上路。', ied: '炸彈都排除了，車隊慢慢通過。', breakdown: '車修好了，車隊重新上路。', pursuit: '甩掉了追兵，全員撤出。', cordon: '衝過了封鎖線。', checkpoint: '檢查哨拔掉了，路通了。', patrol: '巡邏隊打退了，沒有驚動更多人。'};

// 路上某一格會碰到誰：交戰勢力的地盤是攔截，附近有原住民是原住民，其餘是掠奪者
function eventAt(c, w, t) {
  const K = w.sim.peek(), P = w.sim.pmc, o = K.owner[t];
  if (c.fac >= 0 && o >= 0 && P.atWar(o, c.fac)) return {type: 'intercept', tile: t, foe: o};
  const g = K.gangs.find(x => !x.gone && x.native && hdist(x.lair, t) <= 3);
  return g ? {type: 'native', tile: t, gang: g.id} : {type: 'ambush', tile: t};
}

function drawType(book, c, w, now) {
  const K = w.sim.peek(), P = w.sim.pmc;
  if (c.kind === 'route') {
    // 在路上挑一格：掠奪者越多越容易出事；碰到交戰勢力的地盤就是攔截
    const tw = c.path.map(t => K.bandit[t] + 4 + (c.fac >= 0 && K.owner[t] >= 0 && P.atWar(K.owner[t], c.fac) ? 40 : 0));
    let r = rng(book) * tw.reduce((x, y) => x + y, 0), i = 0; for (; i < tw.length - 1 && r > tw[i]; i++) r -= tw[i];
    const ev = eventAt(c, w, c.path[i]);
    // 特殊遭遇（Alan 2026-10-11）：偶爾是路障、路邊炸彈、拋錨守車；長約跑同一條路越多趟，越常被刻意針對（路障、炸彈、伏擊變強）
    const runs = c.contract ? ((book.contracts || []).find(k => k.id === c.contract)?.runs || 0) : 0, tgt = Math.min(.45, Math.max(0, runs - 2) * .06);
    if (rng(book) < .12 + tgt) { ev.base = ev.type; ev.type = pickOf(book, ['barricade', 'barricade', 'ied', 'breakdown']); }
    if (tgt && rng(book) < tgt) ev.targeted = true;
    return ev;
  }
  if (c.kind === 'front') {
    const W = P.war(c.fac, c.foe), atk = W && W.att === c.fac, tr = K.trench[c.tile] || 0;
    const opts = atk ? [['assault', 3], ['trench', tr > .2 ? 4 : 0], ['sabotage', 1.5], ['hold', 1]] : [['hold', 4], ['trench', tr > .2 ? 1.5 : 0], ['sabotage', 1.5], ['assault', 1]];
    let r = rng(book) * opts.reduce((x, o) => x + o[1], 0), k = 0; for (; k < opts.length - 1 && r > opts[k][1]; k++) r -= opts[k][1];
    return {type: opts[k][0], tile: c.tile, foe: c.foe};
  }
  if (c.kind === 'garrison') return {type: 'probe', tile: c.tile, foe: c.foe};
  if (c.kind === 'shadow') {
    if (c.side === 'def') return {type: pickOf(book, ['sweep', 'sweep', 'guard']), tile: c.tile, foe: c.foe};
    // 三段＋警戒度：警戒越高，動手階段也越常撞上巡邏
    const f = (now - c.start) / Math.max(1, c.end - c.start), a = c.alert || 0;
    const type = f < .3 ? pickOf(book, ['patrol', 'patrol', 'checkpoint']) : f > .8 ? pickOf(book, ['pursuit', 'pursuit', 'cordon']) : rng(book) < a / 250 ? 'patrol' : pickOf(book, SHADOW_TICKETS[c.opName] || ['scout']);
    return {type, tile: c.tile, foe: c.foe};
  }
  if (c.kind === 'privateer') return {type: 'raidcv', tile: c.tile, foe: c.foe};
  if (c.kind === 'security') return {type: 'harass', tile: c.tile};
  if (c.kind === 'hunt') return {type: 'clear', tile: c.tile, gang: c.gang};
}

// ===== 敵人（Alan 2026-10-09，warband/DESIGN.md「敵人單位重新配置」）=====
// 沙盒的每一方有自己的兵種表；服務單上的名字就是戰場上的名字。ash：借 ASH 的哪個兵種（規則與圖）
export const UNITS = {
  // 掠奪者（盜匪幫派）
  scav: {n: '拾荒槍手', ash: 'raider'}, shotgun: {n: '霰彈手', ash: 'gunner'}, thug: {n: '狂徒', ash: 'brute'}, sniper: {n: '狙擊手', ash: 'sniper'},
  // 巢匪（掠奪者和蟲群共生的一支）
  infected: {n: '感染槍手', ash: 'raider_infected'}, infected_rifle: {n: '感染步槍手', ash: 'rifleman_infected'}, hound: {n: '裂隙獵犬', ash: 'crawler'},
  larva: {n: '幼蟲', ash: 'brood'}, spitter: {n: '毒液噴吐者', ash: 'spitter'}, bug: {n: '巨蟲', ash: 'giant_bug'},
  // 根者（原住民）
  warrior: {n: '部落戰士', ash: 'raider'}, hunter: {n: '獵手', ash: 'sniper'}, dog: {n: '獵犬', ash: 'crawler'},
  // 正規軍（總督府與一般勢力）、自由城市的雇傭兵
  trooper: {n: '士兵', ash: 'rifleman'}, trooper_heavy: {n: '重裝士兵', ash: 'rifleman_armored'}, shotgunner: {n: '霰彈兵', ash: 'gunner'}, marksman: {n: '狙擊手', ash: 'sniper'},
  drone: {n: '無人機', ash: 'drone'}, flamer: {n: '噴火兵', ash: 'heavy_flamer'}, leader: {n: '小隊長', ash: 'squad_leader'}, clone_trooper: {n: '複製兵', ash: 'chimera_clone'},
  merc: {n: '傭兵', ash: 'rifleman_armored'}, merc_shotgun: {n: '傭兵霰彈手', ash: 'gunner_elite'},
  // 工廠群（機械為主）
  bomb_bot: {n: '自爆機器人', ash: 'bomber_bot'}, turret: {n: '砲塔', ash: 'turret'}, guard_elite: {n: '精銳霰彈兵', ash: 'gunner_elite'},
  // 軍閥
  elite: {n: '精銳突擊手', ash: 'raider_elite'}, enforcer: {n: '執法者', ash: 'enforcer'},
  // 舊的服務單
  raider: {n: '掠奪者', ash: 'raider'}, raider_heavy: {n: '重武裝掠奪者', ash: 'gunner'}, native: {n: '原住民戰士', ash: 'raider_infected'}, native_hunter: {n: '原住民獵手', ash: 'sniper'},
};
// 車輛：衝鋒車（自爆衝撞，耐打）、武裝車（加裝甲的房車）。戰鬥卡車只在公路戰出現，一般戰場換成車上下來的乘員
export const VEH_UNITS = {rush: {n: '衝鋒車', ash: 'chimera_rush'}, armor: {n: '武裝車', ash: 'chimera_armor'}};
const ROSTER = {
  raider: [['scav', 6], ['shotgun', 2], ['thug', 1.2], ['sniper', .8]],
  hive: [['infected', 3], ['infected_rifle', 2], ['hound', 2], ['larva', 2], ['spitter', 1], ['bug', .5]],
  native: [['warrior', 5], ['hunter', 2.5], ['dog', 2]],
  army: [['trooper', 6], ['trooper_heavy', 2], ['shotgunner', 1.5], ['marksman', 1], ['drone', 1], ['flamer', .6]],
  free: [['merc', 5], ['merc_shotgun', 2], ['marksman', 1.5], ['drone', 1]],
  works: [['drone', 4], ['bomb_bot', 3], ['guard_elite', 2], ['flamer', 1]],
  warlord: [['elite', 3], ['scav', 4], ['enforcer', 1.5], ['drone', 1.5]],
};
// 沙盒的哪一方。幫派：原住民、巢匪（油棘林、鹽沼一帶的掠奪者幫派，以及其他地方約三分之一的幫派，和蟲群共生）、軍閥（手上有遺產級）、其餘掠奪者；勢力：工廠群、自由城市、根者、正規軍
const HIVE_BIOMES = ['油棘林', '鹽沼'];
export const isHive = (K, g) => !!g && !g.native && (g.id % 3 === 0 || HIVE_BIOMES.includes(BIOMES[K.biome[g.lair]]?.n));
function gangSide(K, g) { if (!g) return 'raider'; if (g.native) return 'native'; if (isHive(K, g)) return 'hive'; return K.weapons.some(x => x.gang === g.id) ? 'warlord' : 'raider'; }
const facSide = F => F.works ? 'works' : F.free ? 'free' : F.native ? 'native' : 'army';
// 戰場上 ASH 的陣營：叛軍的個性（膽小、會逃）、效忠派（守紀律、小隊）、蟲群
export const ASH_FACTION = {raider: 'rebel', warlord: 'rebel', native: 'rebel', hive: 'swarm', army: 'loyalist', free: 'loyalist', works: 'loyalist', faction: 'loyalist'};
// 頭目：拿遺產級的照武器類別挑 ASH 的除名特工；勢力的軍官用 ASH 各陣營的頭目；巢匪是巢母；沒有遺產級的幫派頭目是加強過的小隊長
export const LEGACY_BOSS = {光束步槍: 'delisted_soldier', 磁軌狙擊槍: 'delisted_recon', 動力裝甲: 'delisted_soldier', 外骨骼護甲: 'delisted_soldier', 電漿切割刀: 'delisted_berserker',
  脈衝手槍: 'delisted_engineer', 戰術目鏡: 'delisted_recon', 護盾產生器: 'delisted_engineer', 單分子刀: 'delisted_berserker', 重型霰彈槍: 'delisted_soldier'};
// 遺產級頭目被打倒：前兩次負傷撤退，之後戰死的機率（Alan 2026-10-09）
export const BOSS_DEATH = [0, 0, .3, .6, 1];
export const LEGACY_KINDS = Object.keys(LEGACY_BOSS);
const BOSS_TEXT = {retreat: b => `${b.chief}負傷撤退，遺產級「${b.weapon}」還在他手上`, dead: b => `${b.chief}戰死，遺產級「${b.weapon}」沒人帶出來，落在戰場上`, taken: b => `${b.chief}戰死，帶回遺產級「${b.weapon}」`};
function legacyBoss(book, g, leg) {
  const n = g.bossDefeats || 0, dies = rng(book) < BOSS_DEATH[Math.min(n, BOSS_DEATH.length - 1)];
  return {weapon: leg.name, kind: leg.kind, bonus: leg.bonus || .1, legacy: leg.id, chief: g.chief || g.name, ash: LEGACY_BOSS[leg.kind] || 'delisted_soldier', defeats: n, dies, gang: g.id};
}
// 服務單上的敵人 → 戰場的清單（給畫面與戰場；戰場用 type 挑 ASH 兵種）
export const unitName = k => UNITS[k]?.n || VEH_UNITS[k]?.n || k;
export function enemyRoster(e) {
  const out = [];
  if (e.boss) out.push({type: e.boss.ash || 'squad_leader', name: e.boss.weapon ? `${e.boss.chief || '頭目'}（${e.boss.weapon}）` : e.boss.name || '頭目', boss: e.boss});
  for (const [k, n] of Object.entries(e.units || {}).sort()) for (let i = 0; i < n; i++) out.push({type: UNITS[k]?.ash || 'raider', name: unitName(k)});
  for (const [k, n] of Object.entries(e.veh || {}).sort()) for (let i = 0; i < n; i++) if (VEH_UNITS[k]) out.push({type: VEH_UNITS[k].ash, name: VEH_UNITS[k].n, vehicle: k});
  return out;
}

// 敵人：從沙盒裡真正在那裡的東西算出來
function enemyOf(book, w, c, ev, o = {}) {
  const K = w.sim.peek(), t = ev.tile, L = c.lv;
  if (ev.type === 'drill' || ev.type === 'harass') { const power = ev.type === 'drill' ? 4 + 4 * L : 4 + 2 * L;
    return {side: 'raider', name: ev.type === 'drill' ? '流寇' : '騷擾的人', fac: -1, gang: null, power, units: unitsOf(book, 'raider', power, null, ev.type, ev.type === 'harass' ? 4 : 10), veh: {}, boss: null}; }
  if (ev.type === 'hunting') { const power = 10 + 8 * (ev.floor || 1);   // 越深越強
    return {side: 'hive', name: `第 ${ev.floor || 1} 層的異形`, fac: -1, gang: null, power, units: unitsOf(book, 'hive', power, null, 'clear', 14), veh: {}, boss: ev.floor >= 3 ? {ash: 'hive_beast', name: '巢母'} : null}; }
  if (ev.type === 'ambush' || ev.type === 'native' || ev.type === 'clear') {
    const g = ev.gang ? K.gangs.find(x => x.id === ev.gang) : K.gangs.filter(x => !x.gone && hdist(x.lair, t) <= 3).sort((a, b) => hdist(a.lair, t) - hdist(b.lair, t))[0];
    const leg = g ? K.weapons.find(x => x.gang === g.id) : null, side = gangSide(K, g);
    const power = 6 + K.bandit[t] * .12 + (g ? g.str * .025 : 0) + (ev.type === 'clear' ? 6 : 0) + 2 * L;
    // 頭目：遺產級在誰手上誰就是頭目；清剿據點一定有頭目（巢匪是巢母）
    const boss = leg ? legacyBoss(book, g, leg) : ev.type === 'clear' ? (side === 'hive' ? {ash: 'hive_beast', name: '巢母'} : {ash: 'squad_leader', name: `頭目${g?.chief || ''}`, hp: 3}) : null;
    const veh = {}; if ((side === 'raider' || side === 'warlord') && power > 14 && rng(book) < (side === 'warlord' ? .6 : .3)) veh.rush = 1 + (power > 24 && rng(book) < .4 ? 1 : 0);
    return {side, name: g ? g.name : '流竄的掠奪者', fac: -1, gang: g?.id ?? null, power: Math.round(power + bossPow(boss)), units: unitsOf(book, side, power - (veh.rush || 0) * 6, null, ev.type), veh, boss};
  }
  // 勢力部隊：看對方的複製兵、車庫、壕溝
  const f = ev.foe, F = K.fac[f], side = facSide(F);
  const towns = Object.keys(K.markets).map(Number).filter(x => K.owner[x] === f).sort((a, b) => hdist(a, t) - hdist(b, t));
  const m = towns.length ? K.markets[towns[0]] : null, veh = {};
  for (const v of ['rush', 'armor', 'gt']) veh[v] = m && m.veh ? Math.min(v === 'rush' ? 3 : 1, Math.floor((m.veh[v] || 0) / WX() * (.2 + rng(book) * .3))) : 0;
  if (ev.type === 'trench' || ev.type === 'sabotage') { veh.rush = 0; }
  const tr = K.trench[t] || 0, cl = Math.min(1, (F.clones || 0) / (80 * WX()));
  const power = ((16 + 6 * L + (ev.type === 'hold' ? 6 : 0) + (ev.type === 'trench' ? tr * 8 : 0) + 8 * cl) * (ev.type === 'probe' ? .7 : 1) + veh.rush * 3 + veh.armor * 10 + veh.gt * 4) * (o.scale || 1);   // 大戰役：一張比一張大
  // 戰鬥卡車只在公路戰：一般戰場換成車上下來的三名乘員
  const crew = veh.gt * 3; veh.gt = 0;
  const units = unitsOf(book, side, power - veh.rush * 3 - veh.armor * 10 - crew * 1.3, cl, ev.type, o.cap);
  if (crew) { const k = side === 'works' ? 'guard_elite' : side === 'free' ? 'merc' : side === 'native' ? 'warrior' : 'trooper'; units[k] = (units[k] || 0) + crew; }
  // 軍官：正規軍、工廠群的大仗（突擊、守點、戰壕）案件等級 2 以上時有機會由 ASH 陣營的頭目帶隊
  const officer = (side === 'army' || side === 'works') && L >= 2 && ['assault', 'hold', 'trench'].includes(ev.type) && rng(book) < .3 + (o.wave ? Math.min(.5, .05 * o.wave) : 0);   // 大戰役越後面越常有軍官
  const boss = officer ? (side === 'army' ? (L >= 3 ? {ash: 'gunline', name: '火線官'} : {ash: 'designator', name: '標定官'}) : {ash: 'burnline', name: '焚線官'}) : null;
  return {side, name: F.n, fac: f, power: Math.round(power + bossPow(boss)), clones: cl, trench: +tr.toFixed(2), veh: Object.fromEntries(Object.entries(veh).filter(([, n]) => n > 0)), units, boss};
}
// 頭目算進戰力（自動結算用）：遺產級頭目最強
const bossPow = b => !b ? 0 : b.legacy ? 3 + 10 * (b.bonus || .1) : b.ash === 'squad_leader' ? 1 : 3;
function unitsOf(book, side, power, cloneShare, type, cap = 14) {
  const n = Math.max(3, Math.min(cap, Math.round(power / 4))), u = {};
  const add = k => u[k] = (u[k] || 0) + 1;
  let table = ROSTER[side] || ROSTER.raider;
  if (side === 'works' && ['hold', 'probe'].includes(type)) table = [...table, ['turret', 1.5]];   // 砲塔只在廠區守點
  if (side === 'army' && n >= 5) for (let i = 0; i < Math.floor(n / 5); i++) add('leader');   // 正規軍：每五人一個小隊長帶隊
  const total = table.reduce((x, [, v]) => x + v, 0);
  for (let i = Object.values(u).reduce((x, y) => x + y, 0); i < n; i++) {
    if ((side === 'army' || side === 'free') && rng(book) < (cloneShare || 0)) { add('clone_trooper'); continue; }
    let r = rng(book) * total, k = 0; for (; k < table.length - 1 && r > table[k][1]; k++) r -= table[k][1];
    add(table[k][0]);
  }
  return u;
}

function issue(book, w, c, now) {
  const ev = drawType(book, c, w, now); if (!ev) return null;
  const T = TYPES[ev.type], K = w.sim.peek(), nm = t => w.names[t] || '無名之地';
  const scale = (c.kind === 'shadow' && c.side === 'att' ? 1 + (c.alert || 0) / 250 : 1) * (ev.targeted ? 1.25 : 1) * (ev.type === 'ied' ? .7 : ev.type === 'breakdown' ? 1.2 : 1);
  const enemy = enemyOf(book, w, c, ev.base ? {...ev, type: ev.base} : ev, scale !== 1 ? {scale} : {});
  const I = INTRO[ev.type] || INTRO[ev.base], intro = I ? pickOf(book, I).replaceAll('{p}', nm(ev.tile)).replaceAll('{e}', enemy.name) + (ev.targeted ? '對方像是早就摸清了車隊的路線。' : '') : null;
  const tk = {id: 'T' + book.nextId++, caseId: c.id, type: ev.type, ...(ev.base ? {base: ev.base} : {}), ...(ev.targeted ? {targeted: true} : {}), ...(intro ? {intro} : {}), title: `${T.n}${ev.targeted ? '（埋伏）' : ''}：${nm(ev.tile)}`, tile: ev.tile,
    biome: BIOMES[K.biome[ev.tile]]?.n || '', night: rng(book) < T.night, trench: +(K.trench[ev.tile] || 0).toFixed(2), enemy,
    objectives: T.obj.map(([k, text, pts]) => ({k, text, pts: pts * c.lv})), born: now, squad: null, player: null, issued: -1, deadline: -1, done: false};
  if (c.kind === 'route') { const left = []; for (let i = 0; i < c.convoys; i++) if (!c.lostConvoys.includes(i)) left.push(i); tk.convoy = pickOf(book, left); }
  book.tickets.push(tk); c.tickets++;
  return tk;
}

// ===== 大戰役的服務單（Alan 2026-10-09）=====
// 在場、空著、休整完的小隊直接接下一張；每家公司一串，一張比一張大（×CAMP_GROW，沒有上限；地圖放不下的之後用增援波次）。
// 攻方打突擊或夜襲戰壕，守方守點。打到人死光或撤軍為止。
export const CAMP_GROW = 1.2, CAMP_CAP = 60;
// 晚進場（Alan 2026-10-09）：第一張就照戰役已經打了多久來開——每過 12 小時（兩輪）往上跳一波，晚來的直接接大單、報酬也高
const campLate = (w, c) => Math.floor((w.sim.campaignOf(c.camp)?.round || 0) / 2);
function campTickets(book, w, c, now) {
  const att = w.sim.campaignOf(c.camp)?.att === c.fac, K = w.sim.peek(), nm = t => w.names[t] || '無名之地';
  for (const id of c.squads) {
    const sq = book.squads[id]; if (!sq || sq.busy || sq.headedHome || sq.readyAt > now || alive(sq).length < 2) continue;
    // 波數照整家公司累計（Alan 2026-10-09：比較過每隊各自累計，那樣拆小隊就能一直刷前幾波的小單）；CAMP_WAVE_BY='squad' 改成每隊（比較用）
    const wk = (globalThis.CAMP_WAVE_BY ?? 'player') === 'squad' ? sq.id : sq.player, wave = c.wave[wk] = (c.wave[wk] ?? campLate(w, c)) + 1, type = att ? (rng(book) < .35 ? 'trench' : 'assault') : 'hold', T = TYPES[type];
    const enemy = enemyOf(book, w, c, {type, tile: c.tile, foe: c.foe}, {scale: Math.pow(CAMP_GROW, wave - 1), cap: CAMP_CAP, wave});
    const tk = {id: 'T' + book.nextId++, caseId: c.id, type, camp: true, wave, title: `${nm(c.tile)}大戰役第 ${wave} 波：${T.n}`, tile: c.tile,
      biome: BIOMES[K.biome[c.tile]]?.n || '', night: rng(book) < T.night, trench: +(K.trench[c.tile] || 0).toFixed(2), enemy,
      objectives: T.obj.map(([k, text, pts]) => ({k, text, pts: pts * c.lv})), born: now, squad: null, player: null, issued: -1, deadline: -1, done: false};
    book.tickets.push(tk); c.tickets++;
    sq.busy = tk.id; tk.squad = sq.id; tk.player = sq.player; tk.issued = now; tk.deadline = now + CFG.DEADLINE;
    notify(book, now, sq.player, 'ticket', `${sq.name}：${tk.title}（${enemy.name}，敵人 ${Object.values(enemy.units).reduce((x, y) => x + y, 0)} 名，戰力 ${enemy.power}）。若在 ${CFG.DEADLINE} 小時內未簽收，則由雇主逕行結算。`, tk.id);
  }
}
// 大戰役的貢獻與報酬：打倒的敵人 × 當下的傭兵行情；貢獻直接變成雇主下一輪交戰的戰功，報酬當場付
function campSettle(book, w, c, tk, res, sq, now) {
  const v = w.sim.campaignOf(c.camp), mul = v ? (v.att === c.fac ? v.mulA : v.mulD) : 1;
  const total = enemyRoster(tk.enemy).length, kills = Math.max(0, Math.min(total, res.kills ?? (res.win ? total : Math.round(total * .3))));
  const contrib = Math.round(kills * mul * 10) / 10, reward = Math.round((2 + kills * 1.2) * mul);
  tk.pts = contrib; tk.kills = kills; tk.mul = mul;
  c.score[sq.player] = (c.score[sq.player] || 0) + contrib;
  if (kills > 0 || contrib > 0) w.sim.campaignHit(c.camp, c.fac, kills, contrib);   // 打倒的就是對方的兵；貢獻變成雇主這場戰役的加成
  if (reward > 0) pay(book, now, sq.player, reward, 'camp', `${tk.title}：戰役報酬（打倒 ${kills}、行情 ×${mul}）`, c.id);
}

// ===== 練兵單、狩獵場（Alan 2026-10-11）：小隊到點就直接開一張，打完就回家；狩獵打贏可以往下一層（最多三層），不想打就召回 =====
function directTickets(book, w, c, now) {
  const K = w.sim.peek(), nm = t => w.names[t] || '無名之地';
  for (const id of c.squads) {
    const sq = book.squads[id]; if (!sq || sq.busy || sq.headedHome || sq.drillDone || sq.readyAt > now || alive(sq).length < 1) continue;
    const floor = c.kind === 'hunting' ? 1 : 0, type = c.kind === 'hunting' ? 'hunting' : 'drill', T = TYPES[type];   // 狩獵場一場打到底（電梯口選往下或撤離，Alan 2026-10-11）
    const enemy = enemyOf(book, w, c, {type, tile: c.tile, floor});
    const tk = {id: 'T' + book.nextId++, caseId: c.id, type, title: c.kind === 'hunting' ? `${nm(c.tile)}狩獵場` : `${T.n}：${nm(c.tile)}`, tile: c.tile, floor, floors: c.kind === 'hunting' ? 3 : 0, facility: c.kind === 'hunting',
      biome: BIOMES[K.biome[c.tile]]?.n || '', night: rng(book) < T.night, trench: 0, enemy, objectives: T.obj.map(([k, text, pts]) => ({k, text, pts: pts * c.lv * (floor || 1)})), born: now, squad: null, player: null, issued: -1, deadline: -1, done: false};
    book.tickets.push(tk); c.tickets++;
    sq.busy = tk.id; tk.squad = sq.id; tk.player = sq.player; tk.issued = now; tk.deadline = now + CFG.DEADLINE; sq.floor = floor;
    notify(book, now, sq.player, 'ticket', `${sq.name}：${tk.title}（${enemy.name}，戰力 ${enemy.power}）。${c.kind === 'hunting' ? '最多三層，每到一層的電梯口可以選往下或撤離；' : ''}若在 ${CFG.DEADLINE} 小時內未簽收，則由雇主逕行結算${c.kind === 'hunting' ? '（只算第一層）' : ''}。`, tk.id);
  }
  if (c.squads.length && c.squads.every(id => { const s = book.squads[id]; return !s || s.drillDone || s.headedHome != null || !alive(s).length; })) c.closedEarly = true;   // 打完、召回、或在路上全滅
}
// ===== 行軍途中遇襲 =====
// 出發時就沿實際道路算好這一趟的風險（跟沙盒裡商隊被劫的算法同一套），決定會不會、在哪一格、第幾小時出事
function planTrip(book, w, c, unitId, from, now, eta) {
  if (eta - now < 2 || from < 0) return;
  const K = w.sim.peek(), P = w.sim.pmc, path = P.route(from, c.tile).filter(t => t !== c.tile);
  if (!path.length) return;
  const tw = path.map(t => K.bandit[t] + (c.fac >= 0 && K.owner[t] >= 0 && P.atWar(K.owner[t], c.fac) ? 40 : 0));
  const risk = tw.reduce((x, y) => x + y, 0), p = 1 - Math.exp(-risk / 1500);
  if (rng(book) >= (book.squads[unitId]?.fast ? p / 2 : p)) return;   // 加速：路上待得短，出事的機會減半
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
  notify(book, now, sq.player, 'ticket', `${sq.name} 在前往${c.title}的路上遇襲（${tk.enemy.name}，戰力 ${tk.enemy.power}）。若在 ${CFG.DEADLINE} 小時內未簽收，則由雇主逕行結算。行軍遇襲不算案件積分。`, tk.id);
}

// 指派：在這個案件裡、沒有票、休整完畢的小隊，誰最早空出來就給誰（打得快、派得多的公司就拿得多）
// 精確時刻的結算（每次有請求、鬧鐘響時，用伺服器的時鐘）：補員到了、路上遇襲、空出來的小隊接等著的服務單。回傳有沒有變化
export function exactTick(book, w, t) {
  let n = 0;
  for (const a of book.amends) if (!a.done && t >= a.eta) { arrive(book, a, t); n++; }
  for (const tr of book.trips) if (!tr.done && t >= tr.at) { tripAmbush(book, w, tr, t); n++; }
  for (const c of book.cases) { if (c.settled) continue; for (const tk of book.tickets) if (tk.caseId === c.id && !tk.done && !tk.squad && assign(book, c, tk, t)) n++; }
  return n;
}
// 下一個要結算的精確時刻（排鬧鐘用）
export function nextDue(book, t) {
  let x = Infinity;
  for (const a of book.amends) if (!a.done && a.eta > t) x = Math.min(x, a.eta);
  for (const tr of book.trips) if (!tr.done && tr.at > t) x = Math.min(x, tr.at);
  for (const sq of Object.values(book.squads)) if (sq.caseId && sq.readyAt > t) x = Math.min(x, sq.readyAt);
  return x;
}
function assign(book, c, tk, now) {
  const free = c.squads.map(id => book.squads[id]).filter(s => !s.busy && !s.headedHome && s.readyAt <= now && alive(s).length >= 2);   // 合約到期已啟程返回的不再派
  if (!free.length) return false;
  free.sort((a, b) => a.readyAt - b.readyAt || (rng(book) - .5));
  const sq = free[0];
  sq.busy = tk.id; tk.squad = sq.id; tk.player = sq.player; tk.issued = now; tk.deadline = now + CFG.DEADLINE;
  notify(book, now, sq.player, 'ticket', `${sq.name} 被抽到：${tk.title}（${tk.enemy.name}，戰力 ${tk.enemy.power}）。若在 ${CFG.DEADLINE} 小時內未簽收，則由雇主逕行結算。`, tk.id);
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
// result：{win, done:[目標 k], dead:[複製人 id], gearLost?:數值, boss?:'retreat'|'dead', legacy?:有人帶出遺產級}
export function submit(book, w, ticketId, result, now) {
  const tk = book.tickets.find(x => x.id === ticketId);
  if (!tk || tk.done || !tk.squad) return false;
  const sq = book.squads[tk.squad];
  for (const id of result.dead || []) { const c = sq.clones.find(x => x.id === id); if (c && c.alive) { c.alive = false; c.hp = 0; } }
  settleTicket(book, w, tk, {win: !!result.win, done: result.done || [], dead: result.dead || [], auto: false, boss: result.boss || null, legacy: !!result.legacy, kills: result.kills, floors: result.floors}, now);
  return true;
}

export function resolveNow(book, w, ticketId, now) { const tk = book.tickets.find(x => x.id === ticketId); if (!tk || tk.done || !tk.squad) return false; autoResolve(book, w, tk, now); return true; }
function autoResolve(book, w, tk, now) {
  const sq = book.squads[tk.squad];
  const r = fight(book, sq, tk.enemy, book.npcs?.includes(sq.player) ? CFG.NPC_POW : CFG.AUTO_POW);
  settleTicket(book, w, tk, {win: r.win, done: objectivesDone(tk, r.win, r.dead, !alive(sq).length), dead: r.dead, auto: true}, now);
}

// 沒有玩家接的事件：案件自帶的護衛自己打，沒有人拿積分，但結果一樣寫回沙盒
function npcResolve(book, w, c, tk, now) {
  const fake = {clones: Array.from({length: 4}, (_, i) => ({id: 'npc' + i, pow: c.basePow / 4 / 1.3, hp: 20, alive: true})), gear: 6, veh: null};
  const r = fight(book, fake, tk.enemy, 1);
  tk.done = true; tk.npc = true; tk.win = r.win;
  writeBack(book, w, c, tk, r.win, 0, now);
  bossOutcome(book, w, tk, {win: r.win}, null, now);
}

export function settleTicket(book, w, tk, res, now) {   // export 給 stats/recovery-check.mjs
  const c = book.cases.find(x => x.id === tk.caseId), sq = book.squads[tk.squad];
  tk.done = true; tk.win = res.win; tk.auto = res.auto; tk.dead = res.dead; tk.doneAt = now;
  const valid = new Set(tk.objectives.map(o => o.k));
  const pts = tk.objectives.filter(o => res.done.includes(o.k) && valid.has(o.k)).reduce((x, o) => x + o.pts, 0) * (res.auto ? CFG.AUTO_PTS : 1);
  tk.pts = Math.round(pts * (c.kind === 'hunting' && !tk.transit ? Math.max(1, res.floors || 1) : 1) * 10) / 10; if (c.kind === 'hunting') tk.floorsDone = res.floors || (res.win ? 1 : 0);   // 狩獵場：打穿幾層算幾倍
  if (c.kind === 'camp' && !tk.transit) campSettle(book, w, c, tk, res, sq, now);
  else if (!tk.transit) c.score[sq.player] = (c.score[sq.player] || 0) + tk.pts;
  // 服役紀錄：這一隊的每個人都記一場（不記殺敵數，Alan 2026-10-10）；這一場倒下的記陣亡
  for (const cl of sq.clones) { if (!cl.alive && !res.dead.includes(cl.id)) continue; let e = caseRec(cl, c.id); if (!e) { joinRec(cl, c, sq.player, now); e = caseRec(cl, c.id); }
    e.fights++; if (res.win) e.wins++;
    if (res.dead.includes(cl.id)) rec(cl, {h: now, t: 'down', co: sq.player, title: tk.title, tile: tk.tile, case: c.id, recovered: !!res.win}); }
  // 回收（Alan 2026-10-10）：打贏，倒下的人連同裝備當場收回（不算損失，回總部可以重新培養）；
  // 打輸，當下就算業務損失、裝備值掉在那一格，遺體進沙盒（book.bodies），7 天內有人在附近打贏就撿走（物歸原主就沖回損失，別家撿到就易主）
  let gearLost = 0;
  for (const id of res.dead) { const cl = sq.clones.find(x => x.id === id && !x.alive && !x.downAs); if (!cl) continue;
    cl.downAt = now; cl.downTile = tk.tile;
    if (res.win) { cl.downAs = 'recovered'; continue; }
    cl.downAs = 'lost'; pay(book, now, sq.player, -(CFG.CLONE_VALUE + sq.gear), 'loss', `${tk.title}：${id} 倒下，遺體沒能帶回`, c.id); gearLost += sq.gear;
    (book.bodies ||= []).push({uid: cl.uid, co: sq.player, tile: tk.tile, at: now, value: CFG.CLONE_VALUE + sq.gear, caseId: c.id}); }
  // 格子收集：這一場的積分換成抽格子的次數，這一隊活下來的人各抽各的；升級的人寫進通知
  const ups = [];
  const capped = (c.kind === 'drill' || c.kind === 'hunting') ? CFG.CELL_CAP_DRILL : c.kind === 'security' ? CFG.CELL_CAP_GUARD : Infinity;
  if (c.kind === 'drill' && !tk.transit) { pay(book, now, sq.player, 2 * c.lv, 'final', `${tk.title}：車馬費`, c.id); sq.drillDone = true; }
  if (c.kind === 'hunting' && !tk.transit) sq.drillDone = true;
  if (tk.pts > 0) for (const cl of alive(sq)) { if (cellCount(cl) >= capped) continue; cl.cellPts = (cl.cellPts || 0) + tk.pts * CELL_DRAWS; const n = Math.floor(cl.cellPts); cl.cellPts -= n;
    const lv0 = cl.lv || 1; drawCells(cl, n, () => rng(book)); cl.lv = cellLevel(cl); if (cl.lv > lv0) ups.push(`${cl.id} 升到 ${cl.lv} 級`); }
  if (ups.length) notify(book, now, sq.player, 'result', `${tk.title}：${ups.join('、')}（記憶片段）`, tk.id);
  // 生物廢棄物（清運案的來源）：這一場倒下的敵人（打贏全算、打輸算三成）加上我方倒下的人
  { const foes = tk.enemy ? enemyRoster(tk.enemy).length : 0, waste = foes * (res.win ? 1 : .3) + res.dead.length; if (waste > 0) { const W = book.waste ||= {}; W[tk.tile] = (W[tk.tile] || 0) + waste; } }
  // 打贏的人順便撿走附近（同一格或隔壁）還沒壞的遺體
  if (res.win) for (const b of book.bodies || []) if (!b.takenBy && now < b.at + CFG.BODY_H && hdist(b.tile, tk.tile) <= 1 && b.at < now) { b.takenBy = sq.player; b.takenAt = now; }
  const wiped = !alive(sq).length;
  if (wiped && sq.wipedAt == null) sq.wipedAt = now;   // 全滅之後不再算維持費
  if (wiped && sq.veh) { gearLost += VPOW[sq.veh] * 4; pay(book, now, sq.player, -VPOW[sq.veh] * 4, 'loss', `${tk.title}：${sq.name} 的${sq.veh === 'rush' ? '衝鋒車' : sq.veh === 'gt' ? '戰鬥卡車' : '武裝車'}丟在戰場上`, c.id); sq.veh = null; }
  if (c.kind !== 'camp') writeBack(book, w, c, tk, res.win, gearLost, now); else if (gearLost > 0) w.sim.pmc.drop(c.tile, gearLost);
  tk.bossOut = bossOutcome(book, w, tk, res, sq.player, now);
  sq.busy = null; sq.readyAt = Math.max(sq.readyAt, now + CFG.REST);
  if (tk.transit && !res.win) {   // 被打退：重整隊伍再走，多花 6 小時
    sq.readyAt += 6; if (sq.move) sq.move.t1 += 6; const a = book.amends.find(x => x.col === sq.id && !x.done); if (a) a.eta += 6; }
  for (const cl of alive(sq)) cl.hp = 20;   // 休整：活著的人傷勢恢復
  notify(book, now, sq.player, 'result', `${tk.title}：${res.win ? '勝' : '敗'}${res.auto ? '（自動結算）' : ''}，積分 ${tk.pts}${res.dead.length ? `，陣亡 ${res.dead.length}` : ''}${BOSS_TEXT[tk.bossOut] ? `。${BOSS_TEXT[tk.bossOut](tk.enemy.boss)}` : ''}。`, tk.id);
}

// ===== 遺產級頭目被打倒（Alan 2026-10-09）=====
// 前兩次負傷撤退（幫派記一次敗績，遺產級還在他手上）；之後照服務單開出來時骰好的 dies 戰死：遺產級掉在戰場上，
// 有人撿起來活著帶出去（res.legacy）就歸傭兵公司，沒有就照沙盒的規則流落在那一格（之後可能被別人撿走）。
// res.boss：戰場回報的 'retreat'／'dead'；自動結算、沒人接的照 dies。回傳 'retreat'／'dead'／'taken'／null
function bossOutcome(book, w, tk, res, player, now) {
  const b = tk.enemy?.boss; if (!b?.legacy || !res.win) return null;
  const K = w.sim.peek(), P = w.sim.pmc, g = K.gangs.find(x => x.id === b.gang), wp = K.weapons.find(x => x.id === b.legacy);
  if (!g || !wp || wp.gang !== g.id) return null;
  const nm = w.names[tk.tile] || '荒野', y = w.sim.year, out = res.boss || (b.dies ? 'dead' : 'retreat');
  if (out === 'retreat') { g.bossDefeats = (g.bossDefeats || 0) + 1; P.say('bandit', `${b.chief}在${nm}被傭兵擊倒，負傷撤退；遺產級「${wp.name}」還在他手上。`, tk.tile); return 'retreat'; }
  g.bossDefeats = 0;
  if (res.legacy && player) {
    Object.assign(wp, {holder: 0, fac: -1, gang: 0, lost: false, loc: -1, pmc: player}); wp.owners = (wp.owners || 0) + 1;
    wp.hist?.push({y, t: `${b.chief}在${nm}戰死，${player}的傭兵從他身上取走遺產級「${wp.name}」。`});
    P.say('bandit', `${b.chief}在${nm}戰死，${player}的傭兵取走了他的遺產級「${wp.name}」。`, tk.tile); return 'taken';
  }
  Object.assign(wp, {holder: 0, fac: -1, gang: 0, lost: true, loc: tk.tile, lostY: y, lake: false, sealed: false});
  wp.hist?.push({y, t: `${b.chief}在${nm}戰死，遺產級「${wp.name}」落在戰場上。`});
  P.say('bandit', `${b.chief}在${nm}戰死，遺產級「${wp.name}」落在戰場上沒人帶走。`, tk.tile); return 'dead';
}

// ===== 寫回沙盒 =====
function writeBack(book, w, c, tk, win, gearLost, now) {
  const K = w.sim.peek(), P = w.sim.pmc, t = tk.tile;
  const nb = t => NBR[t].filter(n => n >= 0), ty = ROAD.has(tk.type) ? tk.base || 'ambush' : tk.type;
  if (ty === 'ambush' || ty === 'native' || ty === 'intercept') {
    if (win) { if (ty !== 'intercept') { K.bandit[t] = Math.max(0, K.bandit[t] - (5 + 3 * c.lv)); for (const n of nb(t)) K.bandit[n] = Math.max(0, K.bandit[n] - 2); } else P.aid(c.fac, 3); }
    else {
      K.bandit[t] = Math.min(100, K.bandit[t] + 3);
      if (c.cargo && tk.convoy !== undefined && !c.lostConvoys.includes(tk.convoy)) {
        c.lostConvoys.push(tk.convoy);
        const v = c.cargo.amt / c.convoys * (c.cargo.val ?? BASEP[c.cargo.g] ?? 1);
        if (ty === 'intercept') { const m = K.markets[Object.keys(K.markets).map(Number).filter(x => K.owner[x] === tk.enemy.fac).sort((a, b) => hdist(a, t) - hdist(b, t))[0]]; if (m && m.stock[c.cargo.g] !== undefined) m.stock[c.cargo.g] += c.cargo.amt / c.convoys; }
        else P.drop(t, v);   // 被搶走的貨：附近的人馬撿去坐大
      }
    }
  } else if (tk.type === 'trench') {
    if (win) { K.trench[t] = Math.max(0, K.trench[t] - .5); P.aid(c.fac, 8); }
  } else if (tk.type === 'assault') { if (win) P.aid(c.fac, 15); }
  else if (tk.type === 'hold') { if (win) P.aid(c.fac, 12); else P.aid(c.foe, 6); }
  else if (tk.type === 'sabotage') {
    if (win) { const tw = Object.keys(K.markets).map(Number).filter(x => K.owner[x] === c.foe).sort((a, b) => hdist(a, t) - hdist(b, t))[0], m = K.markets[tw];
      if (m && m.veh) { m.veh.armor = Math.max(0, (m.veh.armor || 0) - .5 * WX()); m.veh.rush = Math.max(0, (m.veh.rush || 0) - WX()); m.veh.gt = Math.max(0, (m.veh.gt || 0) - .3 * WX()); m.stock.fuel *= .9; } }
  } else if (tk.type === 'probe') { if (win) P.calm(c.fac, c.foe, 3); }
  else if (tk.type === 'clear') {
    if (win) { const g = K.gangs.find(x => x.id === c.gang);
      if (g) { for (const n of [g.lair, ...nb(g.lair)]) K.bandit[n] *= .7; g.str *= .8;
        if (K.bandit[g.lair] < 12 && !g.gone) { g.gone = 1; P.say('bandit', `${g.name}${g.native ? '' : '的據點'}被傭兵公司清剿，手下四散。`, g.lair); c.closedEarly = true; } } }
  }
  else if (c.kind === 'shadow' && SHADOW_TYPES.has(tk.type)) {
    // 成功一張＝難度（案件等級）×等級加成；曝光：警報（輸）、留下屍體、派太多人、放著讓雇主自動結算（Alan 2026-10-11 DESIGN）
    const sq = book.squads[tk.squad], L = sq ? sq.clones.filter(x => x.alive || (tk.dead || []).includes(x.id)) : [], lvA = L.length ? L.reduce((s, x) => s + (x.lv || 1), 0) / L.length : 1;
    const nd = (tk.dead || []).length, ph = PHASE.has(tk.type);
    // 警戒度（0～100，所有接案的人共用）：接近、撤離打得難看就升高、乾淨就降低；動手失手也會升高。警戒越高，成功的分量越少
    if (c.side === 'att') { const d = ph ? (win && !nd ? -6 : 8 + 4 * nd) : !win ? 6 + 3 * nd : nd ? 3 : -3; c.alert = Math.max(0, Math.min(100, (c.alert || 0) + d)); }
    const s = win ? (.6 + .2 * c.lv) * (1 + (lvA - 1) * .08) * (ph ? .4 : 1) * (c.side === 'att' ? 1 - (c.alert || 0) / 400 : 1) : 0;
    if (c.side === 'def') { if (win) { P.shadowAid(c.op, 'def', s, 0, tk.player); if (tk.player) pay(book, now, tk.player, 4 * c.lv, 'shadow', `${tk.title}：緝拿報酬`, c.id); } }
    else if (tk.player) {
      const left = win ? 0 : (tk.dead || []).length, e = (.005 + (win ? 0 : .025) + .015 * left + .003 * Math.max(0, L.length - 2) + (tk.auto ? .005 : 0)) * (tk.night ? .8 : 1);
      P.shadowAid(c.op, 'att', s, e, tk.player); tk.exposure = +e.toFixed(3);
      // 勝算接近升級時報酬加碼（Alan 2026-10-11：催雙方在最後一天下場）
      const o = P.op(c.op), od = o ? P.oddsOf(o) : {more: null};
      if (win) pay(book, now, tk.player, 4 * c.lv * (od.more != null && od.more <= 3 ? 1.5 : 1), 'shadow', `${tk.title}：黑單報酬`, c.id);
    }
  } else if (tk.type === 'drill') { if (win) for (const n of [t, ...nb(t)]) K.bandit[n] = Math.max(0, K.bandit[n] - 1);
  } else if (tk.type === 'raidcv') {
    if (win) { P.privAid(c.lic, 1 + .2 * c.lv);
      if (tk.player) { pay(book, now, tk.player, 6 * c.lv, 'loot', `${tk.title}：攔下的貨分六成`, c.id); (book.relQ ||= []).push({co: tk.player, f: c.foe, v: -1, why: `替${K.fac[c.fac]?.n || ''}私掠`}); }
      const m = K.markets[K.fac[c.fac]?.cap]; if (m) m.stock.fuel += 2 * c.lv * (globalThis.WSCALE ?? 1e4) / 100; }   // 雇主拿四成（記成燃料進首府）
  }
  if (gearLost > 0) P.drop(t, gearLost);
}

// ===== 時間推進：一小時一小時往前走 =====
export function tick(book, w, now) {
  for (let h = Math.floor(book.t) + 1; h <= now; h++) hour(book, w, h);
  book.t = Math.max(book.t, now);
}

function hour(book, w, now) {
  // 維持費（Alan 2026-10-11）：每人每天，先記進應付帳款（小隊的 due），結案時結帳
  if (now % 24 === 0) for (const s of Object.values(book.squads)) { if (!s.caseId || s.column || s.headedHome != null || s.wipedAt != null) continue; const c = book.cases.find(x => x.id === s.caseId); if (!c || c.settled || c.own) continue; s.due = (s.due || 0) + CFG.UPKEEP * alive(s).length; }
  for (const tr of book.trips) if (!tr.done && now >= tr.at) tripAmbush(book, w, tr, now);
  for (const a of book.amends) if (!a.done && now >= a.eta) arrive(book, a, now);
  for (const c of book.cases) {
    if (c.settled) continue;
    // 1. 逾期的票：自動結算（狩獵場第二層以後沒打，就當作撤離）
    for (const tk of book.tickets) if (tk.caseId === c.id && !tk.done && tk.squad && now >= tk.deadline) {
      autoResolve(book, w, tk, now); }
    if (c.open && (c.kind === 'drill' || c.kind === 'hunting')) directTickets(book, w, c, now);
    // 場地維安：每駐守 6 小時，記憶片段 25 格以下的人各抽一次
    if (c.kind === 'security' && now % 6 === 0) for (const id of c.squads) { const s = book.squads[id]; if (!s || s.busy || s.headedHome || s.readyAt > now) continue; const ups = [];
      for (const cl of alive(s)) if (cellCount(cl) < CFG.CELL_CAP_GUARD) { const lv0 = cl.lv || 1; drawCells(cl, 1, () => rng(book)); cl.lv = cellLevel(cl); if (cl.lv > lv0) ups.push(`${cl.id} 升到 ${cl.lv} 級`); }
      if (ups.length) notify(book, now, s.player, 'result', `${c.title}：${ups.join('、')}（記憶片段）`, c.id); }
    // 2. 等人接的事件：有小隊空出來就給它；等太久就讓護衛自己打
    for (const tk of book.tickets) if (tk.caseId === c.id && !tk.done && !tk.squad) {
      if (!assign(book, c, tk, now) && now - tk.born >= CFG.PENDING) npcResolve(book, w, c, tk, now);
    }
    // 3. 期中款
    if (!c.midPaid && now >= (c.start + c.end) / 2) { c.midPaid = true; for (const id of c.squads) { const s = book.squads[id]; if (alive(s).length && c.pay.mid) pay(book, now, s.player, c.pay.mid, 'mid', `${c.title}：期中款（${s.name}）`, c.id); } }
    // 4. 抽事件：結束前一段時間不再出票；案件已經不成立也不出
    if (c.open && (now >= c.end - (c.freeze ?? CFG.FREEZE) || c.closedEarly || !stillValid(c, w))) { c.open = false; c.closedAt = now; }
    if (c.open && c.kind === 'camp') campTickets(book, w, c, now);
    else if (c.open && rng(book) < Math.min(.9, hazard(c, w) * CFG.TICKET_RATE)) { const tk = issue(book, w, c, now); if (tk) assign(book, c, tk, now); }
    // 5. 結算：結束（或提早收尾）後再留一段緩衝
    const FZ = c.freeze ?? CFG.FREEZE, endAt = Math.min(c.end, (c.closedAt ?? c.end) + FZ) + (c.own || SOLO.has(c.kind) ? 0 : CFG.BUFFER);   // 練兵單、狩獵場、場地維安：打完（或駐守期滿）就直接結算，不等緩衝（Alan 2026-10-11）
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
    if (c.cargo?.forest !== undefined) w.sim.pmc.cutForest(c.cargo.forest, c.cargo.amt * delivered);   // 伐木車隊：林子少了這麼多
    if (c.cargo?.src !== undefined && K.markets[c.cargo.src]) K.markets[c.cargo.src].stock[c.cargo.g] = Math.max(0, K.markets[c.cargo.src].stock[c.cargo.g] - c.cargo.amt * delivered);   // 缺貨委託：來源城少了這麼多
  }
  // 大戰役：戰役結束時照貢獻再分一筆（每點貢獻 1k；雇主輸了只付一半）
  if (c.kind === 'camp') { const v = w.sim.campaignOf(c.camp); c.pay.final = Math.round(Object.values(c.score).reduce((x, y) => x + y, 0) * (v && v.done && v.win !== c.fac ? .5 : 1)); }
  const pool = c.pay.final * mult, tot = Object.values(c.score).reduce((x, y) => x + y, 0);
  c.payout = {};
  if (tot > 0 && pool > 0) for (const p in c.score) { if (!c.score[p] || c.quit?.[p]) continue; const v = pool * c.score[p] / tot; c.payout[p] = Math.round(v); pay(book, now, p, v, 'final', `${c.title}：尾款（積分 ${Math.round(c.score[p])}／${Math.round(tot)}）`, c.id); notify(book, now, p, 'pay', `${c.title} 結案，分到尾款 $${Math.round(v)}k。`, c.id); }
  // 維持費（從這一隊加入時算：委託共用案件，晚加入的不多付）、小隊歸建
  for (const id of c.squads) { const s = book.squads[id]; if (s.due > 0) pay(book, now, s.player, -s.due, 'upkeep', `${c.title}：維持費（${s.name}，應付帳款結帳）`, c.id); s.due = 0;
    if (c.kind === 'security' && s.secPay) pay(book, now, s.player, s.secPay, 'final', `${c.title}：維安報酬（${s.name}）`, c.id);
    s.caseId = null; s.busy = null; }
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
