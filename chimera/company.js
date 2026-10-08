// 奇美拉：玩家公司（MVP，沒有戰鬥層）
// 總部設在開局選的主城；四種素材（糧、水、植入物、神經介質）在培養槽造複製人；
// 沒有模板時看投入比例決定容易出哪個職業，每個人的數值是純抽的浮動（評級：銀冠前 10%、金冠前 1%）；
// 模板保證拿到某一位、數值固定（約前 20%），是事件和活動的獎勵。
// 接機會層的案、編成小隊派出去；任務票只能自動結算（戰鬥層還沒接上）。
import * as C from './cases.js';
import {hdist} from './sim.js';

export const MATS = ['food', 'water', 'implant', 'neural'];
export const MN = {food: '糧', water: '水', implant: '植入物', neural: '神經介質'};
export const CLS = {
  soldier:   {n: '士兵', base: {hp: 100, acc: 8, eva: 0, mel: 0}, k: 1, weapon: '土製步槍'},
  recon:     {n: '偵察兵', base: {hp: 100, acc: 0, eva: 10, mel: 0}, k: .95, weapon: '土製卡賓槍'},
  bulwark:   {n: '重裝兵', base: {hp: 100, acc: 0, eva: 0, mel: 0}, k: 1.05, weapon: '土製霰彈槍與鐵板盾'},
  berserker: {n: '狂戰士', base: {hp: 160, acc: -10, eva: 0, mel: 10}, k: 1.05, weapon: '土製砍刀'},
  engineer:  {n: '工兵', base: {hp: 100, acc: 0, eva: 0, mel: 0}, k: .95, weapon: '土製手槍與焊槍'},
};
export const PORTRAITS = ['ember', 'onyx', 'silver', 'cedar', ...Array.from({length: 12}, (_, i) => `portrait-${String(i + 5).padStart(2, '0')}`)];
export const GCFG = {
  START_CASH: 400, START_MATS: {food: 400, water: 400, implant: 200, neural: 200},
  MIN: 30, MAX: 999,       // 每種素材一次最少、最多投多少
  VATS: 2, BUILD_H: 6,     // 自有培養槽數、造一個人要幾小時
  TEMPLATE_P: .3,          // 結案時分到尾款的公司拿到模板的機率
  TEMPLATE_U: .62,         // 模板固定數值（每項的分位，約總和前 20%）
};

// ===== 配方 → 職業機率 =====
export function classOdds(r) {
  const tot = MATS.reduce((x, m) => x + r[m], 0), f = {}; for (const m of MATS) f[m] = r[m] / tot;
  const v = MATS.reduce((x, m) => x + (f[m] - .25) ** 2, 0) / 4;
  const s = {berserker: f.food * 3, bulwark: f.implant * 3, recon: f.neural * 3, engineer: (f.implant + f.neural) * 1.8 - Math.abs(f.implant - f.neural) * 2,
    soldier: .75 + f.water * 2 - 10 * v};
  const e = {}; let z = 0; for (const k in s) { e[k] = Math.exp(3 * s[k]); z += e[k]; }
  for (const k in e) e[k] /= z; return e;
}

// 四項數值各擲一個 0～1；總和的百分位（Irwin–Hall，n=4）決定評級
function ihCdf(x) { let t = 0; const C4 = [1, 4, 6, 4, 1]; for (let k = 0; k <= Math.floor(x) && k <= 4; k++) t += (k % 2 ? -1 : 1) * C4[k] * (x - k) ** 4; return Math.min(1, Math.max(0, t / 24)); }
export function makeClone(G, rng, cls, portrait, u, o = {}) {
  const B = CLS[cls].base, sum = u.reduce((x, y) => x + y, 0), pct = ihCdf(sum);
  const st = {hp: Math.round(B.hp * (.9 + .2 * u[0])), acc: B.acc + Math.round(-8 + 16 * u[1]), eva: B.eva + Math.round(-8 + 16 * u[2]), mel: B.mel + Math.round(-8 + 16 * u[3])};
  const L = 'ABCDEFGHJKLMNPRSTVWXZ'[Math.floor(rng() * 21)];
  return {id: `${L}-${String(Math.floor(rng() * 10000)).padStart(4, '0')}`, uid: G.seq++, cls, portrait, st, u, pct: +pct.toFixed(4),
    crown: pct >= .99 ? 'gold' : pct >= .9 ? 'silver' : '', pow: +(6 * CLS[cls].k * (.85 + .075 * sum)).toFixed(2), weapon: CLS[cls].weapon,
    hp: 20, alive: true, status: 'home', keep: false, born: o.born || 0, template: !!o.template, kills: 0, missions: 0};
}

// ===== 公司 =====
export function newCompany(w, base, name = '我的公司', seed = 7) {
  const G = {flows: [], daily: [], name, base, cash: GCFG.START_CASH, mats: {...GCFG.START_MATS}, roster: [], templates: [], queue: [], seq: 1, rs: seed | 0, h: 0, ledgerAt: 0, inboxAt: 0, log: [], cases: [], returning: []};
  const r = () => rnd(G);
  // 開局：一隊四人（配方平均），外加一張模板
  for (let i = 0; i < 6; i++) G.roster.push(makeClone(G, r, pickW(r, classOdds({food: 30, water: 30, implant: 30, neural: 30})), PORTRAITS[Math.floor(r() * PORTRAITS.length)], [r(), r(), r(), r()]));
  G.templates.push(mkTemplate(G, r));
  note(G, 0, `公司在${w.names[base]}掛牌。培養槽 ${GCFG.VATS} 座，六名複製人待命，另有一張模板。`);
  return G;
}
function rnd(G) { let a = G.rs | 0; a = a + 0x6D2B79F5 | 0; G.rs = a; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
function pickW(r, odds) { let x = r(); for (const k in odds) { x -= odds[k]; if (x <= 0) return k; } return 'soldier'; }
function note(G, h, text) { G.log.push({h, text}); if (G.log.length > 200) G.log.shift(); }
function mkTemplate(G, r) {
  const cls = Object.keys(CLS)[Math.floor(r() * 5)], portrait = PORTRAITS[Math.floor(r() * PORTRAITS.length)];
  const lean = {soldier: {food: 60, water: 80, implant: 60, neural: 60}, recon: {food: 50, water: 50, implant: 50, neural: 120}, bulwark: {food: 60, water: 50, implant: 120, neural: 50},
    berserker: {food: 130, water: 60, implant: 50, neural: 40}, engineer: {food: 40, water: 50, implant: 100, neural: 100}}[cls];
  return {id: 'TP' + G.seq++, cls, portrait, recipe: lean};
}

// ===== 素材價格：跟總部所在城的市價走 =====
export function prices(G, w) {
  const K = w.sim.peek(), m = K.markets[G.base], p = g => m?.price?.[g] ?? 1;
  const vat = (m?.vat || 0) > 0;
  return {food: +(.2 * p('food')).toFixed(2), water: +(.24 * p('water')).toFixed(2), implant: +(.25 * p('parts')).toFixed(2), neural: vat ? .8 : 1.4};
}
export function buy(G, w, mat, qty) {
  const pr = prices(G, w)[mat], cost = Math.round(pr * qty);
  if (cost > G.cash) return '錢不夠';
  const K = w.sim.peek(), m = K.markets[G.base];
  // 糧和水直接從市場存貨裡買走（100 份吃掉 5 份存貨）；植入物在有廠區或培養槽的城直接有賣，其他城要用零件存貨做（100 份吃掉 0.5 份零件）
  if (m && (mat === 'food' || mat === 'water')) { if (m.stock[mat] < qty * .05) return `${w.names[G.base]}的${MN[mat]}不夠賣`; m.stock[mat] -= qty * .05; }
  if (m && mat === 'implant' && !m.works && !(m.vat > 0)) { if (m.stock.parts < qty / 200) return `${w.names[G.base]}的零件不夠做植入物`; m.stock.parts -= qty / 200; }
  G.cash -= cost; G.mats[mat] += qty; flow(G, 'buy', -cost, `本地買進${MN[mat]} ${qty}`); return null;
}
function flow(G, kind, amount, text) { G.flows.push({h: G.h, kind, amount: Math.round(amount), text}); if (G.flows.length > 3000) G.flows.splice(0, 500); }

// ===== 採購路線：派車隊去別座城買料，沿實際道路來回，路上可能被劫 =====
// 價格看那座城的市價；廠區和有培養槽的城賣植入物（廠區便宜），有培養槽的城才有神經介質。跟總部所屬勢力交戰中的城不賣。
const TRIP_FEE = 1.2, TRIP_LOAD = 6;
function offerAt(w, t) {
  const K = w.sim.peek(), m = K.markets[t], p = g => m?.price?.[g] ?? 1;
  if (!m) return null;
  return {
    food: {price: +(.2 * p('food')).toFixed(2), max: Math.min(999, Math.floor(m.stock.food / .05 / 100) * 100)},
    water: {price: +(.24 * p('water')).toFixed(2), max: Math.min(999, Math.floor(m.stock.water / .05 / 100) * 100)},
    implant: {price: +(.25 * p('parts') * (m.works ? .7 : 1)).toFixed(2), max: m.works ? 999 : (m.vat || 0) > 0 ? 500 : Math.min(999, Math.floor(m.stock.parts * 200 / 100) * 100)},
    neural: {price: .8, max: (m.vat || 0) > 0 ? 999 : 0},
  };
}
export function quotes(G, w) {
  const K = w.sim.peek(), P = w.sim.pmc, T = P.tree(G.base), me = K.owner[G.base];
  const out = [];
  for (const k of Object.keys(K.markets)) {
    const t = +k, o = K.owner[t]; if (o < 0 || t === G.base || !isFinite(T.dist[t])) continue;
    const path = T.path(t), risk = path.reduce((x, i) => x + K.bandit[i] + (me >= 0 && K.owner[i] >= 0 && P.atWar(K.owner[i], me) ? 40 : 0), 0);
    const hours = Math.ceil(T.dist[t] * C.CFG.TRAVEL);
    out.push({t, name: w.names[t], fac: K.fac[o]?.n || '', war: me >= 0 && P.atWar(o, me), works: !!K.markets[t].works, vat: K.markets[t].vat || 0,
      hours, trip: hours * 2 + TRIP_LOAD, risk: Math.min(.99, 1 - Math.exp(-risk / 1500 * 2)), fee: Math.round(hours * 2 * TRIP_FEE), offer: offerAt(w, t)});
  }
  return out.sort((a, b) => a.hours - b.hours).slice(0, 40);
}
export function procure(G, book, w, t, mat, qty, uids, now) {
  const q = quotes(G, w).find(x => x.t === t); if (!q) return '到不了那座城';
  if (q.war) return `${q.fac}跟我們這邊在打仗，不賣`;
  const o = q.offer[mat]; qty = Math.floor(qty / 10) * 10;
  if (qty <= 0) return '數量要大於 0';
  if (qty > o.max) return `${q.name}只賣得出 ${o.max}`;
  const cost = Math.round(o.price * qty) + q.fee; if (cost > G.cash) return `錢不夠（要 $${cost}）`;
  const pick = uids.map(u => G.roster.find(c => c.uid === u)).filter(c => c && c.alive && c.status === 'home' && !c.keep);
  const K = w.sim.peek(), m = K.markets[t];
  if (mat === 'food' || mat === 'water') m.stock[mat] -= qty * .05; else if (mat === 'implant' && !m.works && !(m.vat > 0)) m.stock.parts -= qty / 200;
  C.registerCompany(book, G.name, G.base);
  const c = C.openCase(book, w, {kind: 'route', own: G.name, guard: 16, title: `採購：${MN[mat]} ${qty}（${q.name}）`, tile: t, from: t, to: G.base, fac: K.owner[G.base], lv: 1, hours: q.trip,
    cargo: {g: mat, amt: qty, val: o.price}}, now);
  c.mat = mat; c.qty = qty;
  G.cash -= cost; flow(G, 'trip', -cost, `採購路線：${q.name}的${MN[mat]} ${qty}（貨款 $${Math.round(o.price * qty)}、車隊 $${q.fee}）`);
  const groups = []; for (let i = 0; i < pick.length; i += 4) groups.push(pick.slice(i, i + 4));
  for (const g of groups) { if (g.length < 2) continue; const sq = C.makeSquad(book, G.name, {clones: g, gear: 3, at: G.base, name: `${G.name}・護衛${G.seq++}隊`}); if (C.enlist(book, c.id, sq.id, now)) for (const x of g) { x.status = 'away'; x.missions++; } }
  G.cases.push(c.id);
  note(G, now, `車隊出發去${q.name}買${MN[mat]} ${qty}，來回約 ${fmtH(q.trip)}${pick.length >= 2 ? '，有護衛' : '，沒有護衛（只有雇來的車隊守衛）'}。`);
  return null;
}
const fmtH = x => x < 48 ? `${Math.round(x)} 小時` : `${Math.floor(x / 24)} 天 ${Math.round(x % 24)} 小時`;

// ===== 培養槽 =====
export function build(G, recipe, tplId) {
  if (G.queue.length >= GCFG.VATS) return '培養槽都在用';
  let r = recipe, tpl = null;
  if (tplId) { tpl = G.templates.find(t => t.id === tplId); if (!tpl) return '沒有這張模板'; r = tpl.recipe; }
  for (const m of MATS) { if (!(r[m] >= GCFG.MIN && r[m] <= GCFG.MAX)) return `${MN[m]}要投 ${GCFG.MIN}～${GCFG.MAX}`; if (G.mats[m] < r[m]) return `${MN[m]}不夠`; }
  for (const m of MATS) G.mats[m] -= r[m];
  if (tpl) G.templates = G.templates.filter(t => t !== tpl);
  G.queue.push({recipe: {...r}, tpl, start: G.h, done: G.h + GCFG.BUILD_H});
  return null;
}
function finishBuild(G, q, h) {
  const r = () => rnd(G);
  const c = q.tpl ? makeClone(G, r, q.tpl.cls, q.tpl.portrait, [GCFG.TEMPLATE_U, GCFG.TEMPLATE_U, GCFG.TEMPLATE_U, GCFG.TEMPLATE_U], {born: h, template: true})
    : makeClone(G, r, pickW(r, classOdds(q.recipe)), PORTRAITS[Math.floor(r() * PORTRAITS.length)], [r(), r(), r(), r()], {born: h});
  G.roster.push(c); G.fresh = c.uid;
  note(G, h, `培養槽出槽：${CLS[c.cls].n} ${c.id}${c.crown === 'gold' ? '（金冠！）' : c.crown === 'silver' ? '（銀冠）' : ''}${c.template ? '（模板）' : ''}，配發${c.weapon}。`);
}

// ===== 接案、派兵、補員 =====
const avail = G => G.roster.filter(c => c.alive && c.status === 'home' && !c.keep);
export function accept(G, book, w, opp, side, uids, now) {
  const pick = uids.map(u => G.roster.find(c => c.uid === u)).filter(c => c && c.alive && c.status === 'home' && !c.keep);
  if (pick.length < 2) return '至少派兩個人';
  if (G.cases.some(k => { const c = book.cases.find(x => x.id === k); return c && !c.settled && c.tile === opp.tile && c.kind === kindOf(opp); })) return '這個點已經接了';
  C.registerCompany(book, G.name, G.base);
  const c = C.caseFromOpp(book, w, opp, now, {side}); if (!c) return '這個案子開不起來';
  const groups = []; for (let i = 0; i < pick.length; i += 4) groups.push(pick.slice(i, i + 4));
  if (groups.length > 1 && groups[groups.length - 1].length < 2) groups[groups.length - 2].push(...groups.pop());
  let n = 0;
  for (const g of groups) {
    const sq = C.makeSquad(book, G.name, {clones: g, gear: 3, at: G.base, name: `${G.name}・第${G.seq++}隊`});
    if (C.enlist(book, c.id, sq.id, now, w)) { n++; for (const x of g) { x.status = 'away'; x.missions++; } }
    else delete book.squads[sq.id];
  }
  if (!n) { c.settled = true; c.open = false; return '趕不上：到現場的時候已經不出票了'; }
  G.cases.push(c.id);
  note(G, now, `接下「${c.title}」，派出 ${n} 隊。`);
  return null;
}
const kindOf = o => ({short: 'route', route: 'route', exp: 'route', front: 'front', tense: 'garrison', lair: 'hunt'})[o.kind];
export function reinforce(G, book, w, squadId, uids, now) {
  const pick = uids.map(u => G.roster.find(c => c.uid === u)).filter(c => c && c.alive && c.status === 'home' && !c.keep);
  if (!pick.length) return '沒有選人';
  const r = C.amend(book, w, squadId, pick.length, G.base, now, {clones: pick});
  if (!r.ok) return r.why;
  for (const c of r.amend.col ? book.squads[r.amend.col].clones : []) { c.status = 'away'; c.missions++; }
  return null;
}

// ===== 每小時 =====
export function hour(G, book, w, h) {
  G.h = h;
  for (const q of G.queue.slice()) if (h >= q.done) { G.queue.splice(G.queue.indexOf(q), 1); finishBuild(G, q, h); }
  // 帳：真正進出的錢（陣亡是帳面上的業務損失，不再扣一次現金：人和素材早就付過了）
  for (; G.ledgerAt < book.ledger.length; G.ledgerAt++) { const x = book.ledger[G.ledgerAt]; if (x.player !== G.name) continue; if (x.kind !== 'loss') { G.cash += x.amount; if (x.amount) flow(G, x.kind, x.amount, x.text); } else { G.lossBook = (G.lossBook || 0) - x.amount; flow(G, 'loss', x.amount, x.text); } }
  // 陣亡
  for (const c of G.roster) if (!c.alive && c.status !== 'kia') { c.status = 'kia'; c.diedH = h; note(G, h, `${CLS[c.cls].n} ${c.id} 陣亡${c.crown === 'gold' ? '（金冠）' : ''}。`); }
  // 結案：活著的人走回總部
  for (const id of G.cases) {
    const c = book.cases.find(x => x.id === id); if (!c || !c.settled || c.backHome) continue; c.backHome = true;
    if (c.own) {
      const got = Math.round(c.qty * (c.delivered ?? 1)); G.mats[c.mat] += got;
      for (const sid of c.squads) for (const x of book.squads[sid].clones) if (x.alive && x.status === 'away') x.status = 'home';
      note(G, h, `採購車隊回到總部：${MN[c.mat]} ${got}／${c.qty}${got < c.qty ? `（路上被劫走 ${c.qty - got}）` : ''}。`); continue;
    }
    const back = C.travelHours(w, c.tile, G.base);
    for (const sid of c.squads) { const sq = book.squads[sid]; if (sq.player !== G.name) continue; for (const x of sq.clones) if (x.alive && x.status === 'away') { x.status = 'returning'; G.returning.push({uid: x.uid, at: h + (isFinite(back) ? back : 24)}); } }
    const got = c.payout?.[G.name] || 0;
    note(G, h, `「${c.title}」結案${c.delivered !== undefined ? `，送達 ${Math.round(c.delivered * 100)}%` : ''}，分到尾款 ${got}。`);
    if (got > 0 && rnd(G) < GCFG.TEMPLATE_P) { const t = mkTemplate(G, () => rnd(G)); G.templates.push(t); note(G, h, `雇主另外送了一張模板：${CLS[t.cls].n}。`); }
  }
  if (h % 24 === 0) { G.daily.push({h, cash: Math.round(G.cash), alive: G.roster.filter(c => c.alive).length, kia: G.roster.filter(c => !c.alive).length}); if (G.daily.length > 400) G.daily.shift(); }
  for (const r of G.returning.slice()) if (h >= r.at) { G.returning.splice(G.returning.indexOf(r), 1); const c = G.roster.find(x => x.uid === r.uid); if (c && c.alive) c.status = 'home'; }
  // 補員縱隊全滅、或到的時候案件已結算：人留在現場（駐紮），MVP 先直接讓他們走回來
  for (const c of G.roster) if (c.alive && c.status === 'away' && !Object.values(book.squads).some(sq => sq.clones.includes(c))) { c.status = 'returning'; G.returning.push({uid: c.uid, at: h + 12}); }
}

// 給畫面用的樣子
export function view(G, book, w) {
  const nm = t => w.names[t] || '無名之地';
  const sqOf = {}; for (const sq of Object.values(book.squads)) for (const c of sq.clones) sqOf[c.uid] = sq;
  const cases = G.cases.map(id => book.cases.find(x => x.id === id)).filter(Boolean).filter(c => !c.settled || G.h - c.settledAt < 72).map(c => ({
    id: c.id, own: !!c.own, title: c.title, kind: c.kind, tile: c.tile, lv: c.lv, start: c.start, end: c.end, open: c.open, settled: c.settled, score: Math.round(c.score[G.name] || 0),
    payout: c.payout?.[G.name], delivered: c.delivered, convoys: c.convoys, lost: c.lostConvoys.length, pay: c.pay, tickets: c.tickets,
    squads: c.squads.map(id => book.squads[id]).filter(sq => sq && sq.player === G.name).map(sq => ({id: sq.id, name: sq.name, readyAt: sq.readyAt, busy: sq.busy, refused: !!sq.refused,
      clones: sq.clones.map(x => x.uid), pending: book.amends.filter(a => a.squad === sq.id && !a.done).map(a => ({n: a.n, eta: a.eta}))}))}));
  const tickets = book.tickets.filter(t => t.player === G.name && !t.done).map(t => ({id: t.id, title: t.title, type: t.type, transit: !!t.transit, deadline: t.deadline, issued: t.issued, tile: t.tile,
    biome: t.biome, night: t.night, trench: t.trench, enemy: {name: t.enemy.name, power: t.enemy.power, side: t.enemy.side, units: t.enemy.units, boss: t.enemy.boss, veh: t.enemy.veh},
    objectives: t.objectives, squad: book.squads[t.squad]?.name, est: book.squads[t.squad] ? C.estimate(book.squads[t.squad], t.enemy) : null, caseTitle: book.cases.find(c => c.id === t.caseId)?.title}));
  const done = book.tickets.filter(t => t.player === G.name && t.done).slice(-12).reverse().map(t => ({id: t.id, title: t.title, win: t.win, auto: t.auto, pts: t.pts, dead: (t.dead || []).length, at: t.doneAt}));
  // 報表
  const hist = G.cases.map(id => book.cases.find(x => x.id === id)).filter(c => c && c.settled).map(c => {
    const T = book.tickets.filter(t => t.caseId === c.id && t.player === G.name && t.done);
    const L = book.ledger.filter(x => x.caseId === c.id && x.player === G.name);
    return {title: c.title, own: !!c.own, kind: c.kind, at: c.settledAt, tickets: T.length, wins: T.filter(t => t.win).length, auto: T.filter(t => t.auto).length, dead: T.reduce((x, t) => x + (t.dead?.length || 0), 0),
      income: L.filter(x => ['deposit', 'mid', 'final'].includes(x.kind)).reduce((a, x) => a + x.amount, 0), upkeep: L.filter(x => x.kind === 'upkeep').reduce((a, x) => a + x.amount, 0), delivered: c.delivered};
  }).reverse();
  const sum = since => { const o = {}; for (const f of G.flows) if (f.h >= since) o[f.kind] = (o[f.kind] || 0) + f.amount; return o; };
  const report = {all: sum(0), d30: sum(G.h - 24 * 30), daily: G.daily, hist};
  return {report, name: G.name, base: G.base, baseName: nm(G.base), h: G.h, cash: Math.round(G.cash), lossBook: Math.round(G.lossBook || 0), mats: G.mats, prices: prices(G, w), queue: G.queue.map(q => ({done: q.done, tpl: q.tpl ? q.tpl.cls : null})),
    templates: G.templates, roster: G.roster.map(c => ({...c, squad: sqOf[c.uid]?.name || ''})), cases, tickets, done, log: G.log.slice(-40).reverse(), vats: GCFG.VATS, buildH: GCFG.BUILD_H};
}
