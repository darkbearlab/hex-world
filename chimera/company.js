// 奇美拉：玩家公司（MVP，沒有戰鬥層）
// 總部設在開局選的主城；四種素材（糧、水、植入物、神經介質）在培養槽造複製人；
// 沒有模板時看投入比例決定容易出哪個職業，每個人的數值是純抽的浮動（評級：銀冠前 10%、金冠前 1%）；
// 模板保證拿到某一位、數值固定（約前 20%），是事件和活動的獎勵。
// 接機會層的案、編成小隊派出去；服務單只能自動結算（戰鬥層還沒接上）。
import * as C from './cases.js';
import {hdist} from './sim.js';

export const MATS = ['food', 'water', 'implant', 'neural'];
export const MN = {food: '熱量', water: '淨水', implant: '植入物', neural: '神經介質'};   // 玩家的素材（Alan 2026-10-09：糧、水改寫成熱量、淨水）
// 職業與出生配發的武器，對上 ASH 的同名職業（chimera/ash）。槍都是「土製」（只有壞詞條）；職業天生的近戰武器（動力拳、斧頭）不是
export const CLS = {
  soldier:   {n: '士兵', base: {hp: 100, acc: 8, eva: 0, mel: 0}, k: 1, weapon: '土製步槍、土製霰彈槍'},
  recon:     {n: '偵察兵', base: {hp: 100, acc: 0, eva: 10, mel: 0}, k: .95, weapon: '土製衝鋒槍、土製霰彈槍'},
  bulwark:   {n: '重裝兵', base: {hp: 100, acc: 0, eva: 0, mel: 0}, k: 1.05, weapon: '土製輕機槍、動力拳'},
  berserker: {n: '狂戰士', base: {hp: 160, acc: -10, eva: 0, mel: 0}, k: 1.05, weapon: '斧頭、土製霰彈槍'},
  engineer:  {n: '工兵', base: {hp: 100, acc: 0, eva: 0, mel: 0}, k: .95, weapon: '土製衝鋒槍、土製霰彈槍'},
};
// ASH 技能的中文名（複製人出生沒有技能，3 級學會職業技能；chimera/ash/overlay/src/chimera-squad.js）
export const SKILL_NAME = {early_warning: '預警', signal_break: '訊號斷層', anchor: '下錨', grapple: '鉤鎖', workshop: '工坊'};
export const PORTRAITS = ['ember', 'onyx', 'silver', 'cedar', ...Array.from({length: 12}, (_, i) => `portrait-${String(i + 5).padStart(2, '0')}`)];
// 資料主人（DNA 原主）（Alan 2026-10-10）：每張立繪是一位原主，名字和職業都綁在原主身上（大和不會變成輕巡）；
// 複製人是原主的一批，畫面顯示「原主名字 編號」。名單是暫定的，之後 Alan 會換掉。
export const DONORS = {
  ember: {name: '凱拉', cls: 'soldier'}, onyx: {name: '伊薇', cls: 'recon'}, silver: {name: '莎菈', cls: 'bulwark'}, cedar: {name: '娜迪亞', cls: 'berserker'},
  'portrait-05': {name: '蕾雅', cls: 'engineer'}, 'portrait-06': {name: '米菈', cls: 'soldier'}, 'portrait-07': {name: '塔莉亞', cls: 'recon'}, 'portrait-08': {name: '艾琳', cls: 'bulwark'},
  'portrait-09': {name: '薇拉', cls: 'berserker'}, 'portrait-10': {name: '諾娃', cls: 'engineer'}, 'portrait-11': {name: '茵格', cls: 'soldier'}, 'portrait-12': {name: '菲歐', cls: 'recon'},
  'portrait-13': {name: '瑟琳', cls: 'bulwark'}, 'portrait-14': {name: '朵拉', cls: 'berserker'}, 'portrait-15': {name: '雅絲', cls: 'engineer'}, 'portrait-16': {name: '露恩', cls: 'soldier'},
};
export const donorName = c => DONORS[c.donor ?? c.portrait]?.name || '';
// 綽號（call sign，Alan 2026-10-10）：每個人可以自己取；完整的叫法是「瑟琳 “人獵人” X-0910」
export const label = c => `${donorName(c)}${c.callsign ? ` “${c.callsign}”` : ''} ${c.id}`;
export function setCallsign(G, uid, name) {
  const c = G.roster.find(x => x.uid === uid); if (!c) return '找不到這個人';
  const v = String(name || '').replace(/[“”"'<>\n\r\t]/g, '').trim().slice(0, 8);
  if (v) { c.callsign = v; C.rec(c, {h: G.h, t: 'callsign', co: G.name, name: v}); } else delete c.callsign;
  return null;
}
const donorsOf = cls => PORTRAITS.filter(p => DONORS[p]?.cls === cls);
// 先照素材比例擲職業，再從這個職業的原主裡挑一位
const pickPortrait = (r, cls) => { const L = donorsOf(cls); return L.length ? L[Math.floor(r() * L.length)] : PORTRAITS[Math.floor(r() * PORTRAITS.length)]; };
export const GCFG = {
  START_CASH: 400, START_MATS: {food: 400, water: 400, implant: 200, neural: 200},
  MIN: 30, MAX: 999,       // 每種素材一次最少、最多投多少
  VATS: 2, BUILD_H: 1,     // 自有培養槽數、造一個人要幾小時（現實時間一比一後改成 1，原本 6；Alan 2026-10-08）
  TEMPLATE_P: .3,          // 結案時分到尾款的公司拿到模板的機率
  TEMPLATE_U: .62,
  ARMOR_P: .3,             // 結案分到尾款時拿到帶詞條護甲的機率（Alan 2026-10-09）         // 模板固定數值（每項的分位，約總和前 20%）
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
  // 編號（Alan 2026-10-10）：uid 是全星球的流水號（帳本 book.cloneSeq 發號），之後易主、回收不會撞號；顯示的編號也照流水號（五位數，跟舊的四位數亂數分得開）
  const n = Math.floor(rng() * 10000);
  return {id: o.uid != null ? `${L}-${String(o.uid).padStart(5, '0')}` : `${L}-${String(n).padStart(4, '0')}`, uid: o.uid ?? G.seq++, cls, portrait, st, u, pct: +pct.toFixed(4),
    crown: pct >= .99 ? 'gold' : pct >= .9 ? 'silver' : '', pow: +(6 * CLS[cls].k * (.85 + .075 * sum)).toFixed(2), weapon: CLS[cls].weapon,
    hp: 20, alive: true, status: 'home', keep: false, born: o.born || 0, template: !!o.template, kills: 0, missions: 0, donor: portrait, record: [], lv: 1, cells: [0, 0, 0, 0], dup: 0, cellPts: 0};
}

// ===== 公司 =====
export function newCompany(w, base, name = '我的公司', seed = 7, book = null) {
  const G = {flows: [], daily: [], name, base, cash: GCFG.START_CASH, mats: {...GCFG.START_MATS}, roster: [], templates: [], queue: [], store: [], itemSeq: 0, seq: 1, fameLog: [], rs: seed | 0, h: 0, ledgerAt: 0, inboxAt: 0, log: [], cases: [], returning: []};
  const r = () => rnd(G);
  // 開局：一隊四人（配方平均），外加一張模板
  for (let i = 0; i < 6; i++) { const cls = pickW(r, classOdds({food: 30, water: 30, implant: 30, neural: 30})), c = makeClone(G, r, cls, pickPortrait(r, cls), [r(), r(), r(), r()], {uid: nextUid(book)}); C.rec(c, {h: 0, t: 'born', co: name, tile: base}); G.roster.push(c); }
  G.templates.push(mkTemplate(G, r));
  note(G, 0, `公司在${w.names[base]}掛牌。培養槽 ${GCFG.VATS} 座，六名複製人待命，另有一張模板。`);
  return G;
}
function rnd(G) { let a = G.rs | 0; a = a + 0x6D2B79F5 | 0; G.rs = a; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
function pickW(r, odds) { let x = r(); for (const k in odds) { x -= odds[k]; if (x <= 0) return k; } return 'soldier'; }
function note(G, h, text) { G.log.push({h, text}); if (G.log.length > 200) G.log.shift(); }
function mkTemplate(G, r) {
  const cls = Object.keys(CLS)[Math.floor(r() * 5)], portrait = pickPortrait(r, cls);
  const lean = {soldier: {food: 60, water: 80, implant: 60, neural: 60}, recon: {food: 50, water: 50, implant: 50, neural: 120}, bulwark: {food: 60, water: 50, implant: 120, neural: 50},
    berserker: {food: 130, water: 60, implant: 50, neural: 40}, engineer: {food: 40, water: 50, implant: 100, neural: 100}}[cls];
  return {id: 'TP' + G.seq++, cls, portrait, recipe: lean};
}

// ===== 素材價格：跟總部所在城的市價走 =====
// 行情（Alan 2026-10-10）：植入物看離廠區多遠（廠區打七折，越遠越貴）；神經介質只有培養槽城做得出來，培養槽越多越便宜、打仗的勢力越貴，沒有培養槽的城要從最近的培養槽城運來
const nearest = (K, t, ok) => { let d = 99; for (const k in K.markets) { const u = +k; if (K.owner[u] >= 0 && ok(K.markets[k]) && hdist(u, t) < d) d = hdist(u, t); } return d; };
function implantK(K, t) { const m = K.markets[t]; return m?.works ? .7 : 1 + .02 * Math.min(25, nearest(K, t, x => x.works)); }
function neuralAt(w, t) {
  const K = w.sim.peek(), m = K.markets[t], o = K.owner[t], P = w.sim.pmc;
  let wars = 0; if (o >= 0) for (let f = 0; f < K.fac.length; f++) if (f !== o && P.atWar(f, o)) wars++;
  const war = 1 + .08 * Math.min(4, wars);
  if ((m?.vat || 0) > 0) return +(.8 * Math.max(.6, Math.min(1.25, 1.25 - .07 * m.vat)) * war).toFixed(2);
  return +(.8 * 1.1 * (1 + .04 * Math.min(25, nearest(K, t, x => (x.vat || 0) > 0))) * war).toFixed(2);
}
export function prices(G, w) {
  const K = w.sim.peek(), m = K.markets[G.base], p = g => m?.price?.[g] ?? 1;
  return {food: +(.2 * p('food')).toFixed(2), water: +(.24 * p('water')).toFixed(2), implant: +(.25 * p('parts') * implantK(K, G.base)).toFixed(2), neural: neuralAt(w, G.base)};
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
    implant: {price: +(.25 * p('parts') * implantK(K, t)).toFixed(2), max: m.works ? 999 : (m.vat || 0) > 0 ? 500 : Math.min(999, Math.floor(m.stock.parts * 200 / 100) * 100)},
    neural: {price: neuralAt(w, t), max: (m.vat || 0) > 0 ? 999 : 0},
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
  const cost = Math.round(o.price * qty) + q.fee; if (cost > G.cash) return `錢不夠（要 $${cost}k）`;
  const pick = uids.map(u => G.roster.find(c => c.uid === u)).filter(c => c && c.alive && c.status === 'home' && !c.keep);
  const K = w.sim.peek(), m = K.markets[t];
  if (mat === 'food' || mat === 'water') m.stock[mat] -= qty * .05; else if (mat === 'implant' && !m.works && !(m.vat > 0)) m.stock.parts -= qty / 200;
  C.registerCompany(book, G.name, G.base);
  const c = C.openCase(book, w, {kind: 'route', own: G.name, guard: 16, title: `採購：${MN[mat]} ${qty}（${q.name}）`, tile: t, from: t, to: G.base, fac: K.owner[G.base], lv: 1, hours: q.trip,
    cargo: {g: mat, amt: qty, val: o.price}}, now);
  c.mat = mat; c.qty = qty;
  G.cash -= cost; flow(G, 'trip', -cost, `採購路線：${q.name}的${MN[mat]} ${qty}（貨款 $${Math.round(o.price * qty)}k、車隊 $${q.fee}k）`);
  const groups = []; for (let i = 0; i < pick.length; i += 4) groups.push(pick.slice(i, i + 4));
  for (const g of groups) { if (g.length < 2) continue; const sq = C.makeSquad(book, G.name, {clones: g, gear: 3, at: G.base, name: `${G.name}・護衛${G.seq++}隊`}); if (C.enlist(book, c.id, sq.id, now)) for (const x of g) { x.status = 'away'; x.missions++; } }
  G.cases.push(c.id);
  note(G, now, `車隊出發去${q.name}買${MN[mat]} ${qty}，來回約 ${fmtH(q.trip)}${pick.length >= 2 ? '，有護衛' : '，沒有護衛（只有雇來的車隊守衛）'}。`);
  return null;
}
const fmtH = x => x < 48 ? `${Math.round(x)} 小時` : `${Math.floor(x / 24)} 天 ${Math.round(x % 24)} 小時`;

// ===== 培養槽 =====
// slot：用哪一座培養槽（畫面一座一列，Alan 2026-10-09 像艦娘的建造船塢）；沒指定就用第一座空的
export function build(G, recipe, tplId, slot, now = G.h) {
  if (G.queue.length >= GCFG.VATS) return '培養槽都在用';
  const used = new Set(G.queue.map((q, i) => q.slot ?? i));
  if (slot == null || !(slot >= 0 && slot < GCFG.VATS)) slot = [...Array(GCFG.VATS).keys()].find(i => !used.has(i));
  if (used.has(slot)) return '這座培養槽在用';
  let r = recipe, tpl = null;
  if (tplId) { tpl = G.templates.find(t => t.id === tplId); if (!tpl) return '沒有這張模板'; r = tpl.recipe; }
  for (const m of MATS) { if (!(r[m] >= GCFG.MIN && r[m] <= GCFG.MAX)) return `${MN[m]}要投 ${GCFG.MIN}～${GCFG.MAX}`; if (G.mats[m] < r[m]) return `${MN[m]}不夠`; }
  for (const m of MATS) G.mats[m] -= r[m];
  if (tpl) G.templates = G.templates.filter(t => t !== tpl);
  G.queue.push({recipe: {...r}, tpl, start: now, done: now + GCFG.BUILD_H, slot});
  return null;
}
// 準時出槽（Alan 2026-10-09）：開始時記下精確的時刻（帶小數的遊戲小時），伺服器用自己的時鐘確認時間到了就出槽，不等整點。
// t：現在的精確時刻。回傳出槽了幾個
export function finishDue(G, t) {
  let n = 0;
  // 走回總部的人：到了就待命
  for (const r of G.returning.slice()) if (t >= r.at) { G.returning.splice(G.returning.indexOf(r), 1); const c = G.roster.find(x => x.uid === r.uid); if (c && c.alive) c.status = 'home'; n++; }
  for (const q of G.queue) if (!q.ready && t >= q.done) { readyBuild(G, q, G.h); n++; }
  return n;
}
// 培養完成：留在槽裡等簽收（Alan 2026-10-09：要去簽收才會入列）
function readyBuild(G, q, h) { q.ready = true; note(G, h, `第 ${(q.slot ?? 0) + 1} 座培養槽培養完成，到培養槽簽收。`); }
// 簽收：這一座培養好的人進名冊，培養槽空出來
export const nextUid = book => book ? (book.cloneSeq ??= 1, book.cloneSeq++) : undefined;
export function claim(G, slot, book = null) {
  const q = G.queue.find((x, i) => (x.slot ?? i) === slot && x.ready); if (!q) return '這座培養槽沒有可以簽收的人';
  G.queue.splice(G.queue.indexOf(q), 1); finishBuild(G, q, G.h, book); return null;
}
function finishBuild(G, q, h, book = null) {
  const r = () => rnd(G);
  if (q.revive != null) {
    const c = G.roster.find(x => x.uid === q.revive); if (!c || c.status !== 'recovered') { for (const m of MATS) G.mats[m] += q.recipe[m] || 0; note(G, h, '重新培養失敗：遺體不在了，素材退回。'); return; }
    Object.assign(c, {alive: true, status: 'home', hp: 20, lv: 1, xp: 0, cells: [0, 0, 0, 0], dup: 0, cellPts: 0, picks: [], skills: [], prep: null, perkPicks: 0, classPerkMisses: 0, legacyPerkPicks: 0, downAs: null, downAt: null, downTile: null, diedH: null, born: h});
    // 舊小隊的名單裡還有這個人（倒下時留著，給結案記紀錄用）：拿掉，不然活過來的人會被當成那一隊的人繼續派單
    if (book) for (const sq of Object.values(book.squads)) { const i = sq.clones.indexOf(c); if (i >= 0) sq.clones.splice(i, 1); }
    C.rec(c, {h, t: 'revive', co: G.name, tile: G.base}); G.fresh = c.uid;
    note(G, h, `培養槽出槽：${CLS[c.cls].n} ${label(c)} 重新培養完成，回到名冊（等級、技能從頭來）。`); return;
  }
  const c = q.tpl ? makeClone(G, r, q.tpl.cls, q.tpl.portrait, [GCFG.TEMPLATE_U, GCFG.TEMPLATE_U, GCFG.TEMPLATE_U, GCFG.TEMPLATE_U], {born: h, template: true, uid: nextUid(book)})
    : (cls => makeClone(G, r, cls, pickPortrait(r, cls), [r(), r(), r(), r()], {born: h, uid: nextUid(book)}))(pickW(r, classOdds(q.recipe)));
  C.rec(c, {h, t: 'born', co: G.name, tile: G.base});
  gearOf(G, c); c.weapon = gearLabel(c.gear); G.roster.push(c); G.fresh = c.uid;
  note(G, h, `培養槽出槽：${CLS[c.cls].n} ${label(c)}${c.crown === 'gold' ? '（金冠！）' : c.crown === 'silver' ? '（銀冠）' : ''}${c.template ? '（模板）' : ''}，配發${c.weapon}。`);
}

// ===== 接案、派兵、補員 =====
// ===== 裝備（Alan 2026-10-09，warband/DESIGN.md「裝備欄與變賣」） =====
// 每個人：槍 ×3（種類＋一個詞條）、近戰 ×1（天生的狂戰斧、忍刀、動力拳套不佔欄，由職業帶）、護甲 ×1（開戰時的裝甲板）、預備品 ×2（消耗品，一格一種）。
// 名稱與 ASH 的繁中翻譯一致；帶進戰鬥時照這裡配給 ASH（ash/overlay/src/chimera-squad.js applyGear），打完照身上剩的寫回。
export const GUNS = {rifle: {n: '突擊步槍', v: 40}, shotgun: {n: '霰彈槍', v: 35}, smg: {n: '衝鋒槍', v: 35}, sniper: {n: '精準步槍', v: 60}, lmg: {n: '輕機槍', v: 70}, launcher: {n: '榴彈發射器', v: 80}, plasma: {n: '電漿步槍', v: 120}, flamer: {n: '火焰發射器', v: 60}};
export const MELEES = {knife: {n: '求生小刀', v: 10}, sabre: {n: '軍刀', v: 25}, spear: {n: '長矛', v: 25}, claws: {n: '手爪', v: 30}, chainsaw: {n: '鏈鋸', v: 50}};
export const ARMORS = {light: {n: '輕型護甲', plates: 10, v: 20}, medium: {n: '中型護甲', plates: 20, v: 45}, heavy: {n: '重型護甲', plates: 30, v: 80}};
export const KITS = {meds: {n: '醫療包', v: 5, max: 3}, grenades: {n: '破片彈', v: 6, max: 3}, smoke: {n: '煙霧彈', v: 4, max: 3}, stun: {n: '震撼彈', v: 5, max: 3}, emp: {n: 'EMP', v: 8, max: 2}};
export const AFFIX_NAMES = {homemade: '土製', stable: '穩定', piercing: '穿甲', extended: '擴容', powerful: '強擊', longbarrel: '長管', shortbarrel: '短管', tracking: '追獵', flashhider: '消焰', lance: '貫穿', burst: '爆裂', rapid: '速射'};
const DROP_ONLY = ['lance', 'burst', 'rapid'];
// 護甲的詞條＝ASH 的特性（TRAITS），穿上時掛上、來源標成護甲（chimera-squad.js applyGear）。先用 ASH 現成的
export const ARMOR_AFFIXES = {nightvision: {n: '夜視', traits: ['night_vision']}, infrared: {n: '紅外線', traits: ['infrared']}, steady: {n: '抗壓', traits: ['suppression_resistance']}, antitox: {n: '防毒', traits: ['poison_resistance']}};
// 倉庫裡的槍可以改裝成這些詞條（ASH 終端改裝的那幾種；只會掉落的不行）。notOn：這些種類不能裝
export const MOD_AFFIXES = {stable: {}, piercing: {}, extended: {}, powerful: {}, longbarrel: {}, shortbarrel: {}, tracking: {notOn: ['shotgun']}, flashhider: {notOn: ['shotgun', 'plasma']}};
export const modCost = base => Math.round((GUNS[base]?.v || 40) * .6);
// 彈藥（ASH 的五種）每發的價錢；自費的任務結算時扣，接案由雇主吸收（Alan 2026-10-09）
export const AMMO_PRICE = {pistol: .04, reserve: .05, shell: .12, energy: .3, ordnance: 2};
export const AMMO_N = {pistol: '手槍彈', reserve: '步槍彈', shell: '霰彈', energy: '能量匣', ordnance: '重彈藥'};
export const ammoCost = used => Math.round(Object.entries(used || {}).reduce((x, [k, n]) => x + (AMMO_PRICE[k] || 0) * Math.max(0, n), 0));
// 變賣看總部那座城的行情：彈藥越缺，槍越值錢（0.8～1.5 倍）
export function sellFactor(G, w) { const r = w?.sim.peek().markets[G.base]?.ratio?.ammo ?? 1; return Math.round(Math.max(.8, Math.min(1.5, 1.6 - .6 * r)) * 100) / 100; }
export const SLOTS = ['gun0', 'gun1', 'gun2', 'melee', 'armor', 'kit0', 'kit1'];
export const slotKind = s => s.startsWith('gun') ? 'gun' : s.startsWith('kit') ? 'kit' : s;
const slotGet = (g, s) => s.startsWith('gun') ? g.guns[+s[3]] : s.startsWith('kit') ? g.kits[+s[3]] : g[s];
const slotSet = (g, s, v) => { if (s.startsWith('gun')) g.guns[+s[3]] = v; else if (s.startsWith('kit')) g.kits[+s[3]] = v; else g[s] = v; };
// 出槽時的配發（照 ASH 各職業的起始武器，槍都是土製；預備品各 2）
export const CLASS_GEAR = {soldier: {guns: ['rifle', 'shotgun'], kits: ['meds', 'grenades']}, recon: {guns: ['smg', 'shotgun'], kits: ['meds', 'smoke']}, bulwark: {guns: ['lmg'], kits: ['meds', 'grenades']},
  berserker: {guns: ['shotgun'], kits: ['meds', 'grenades']}, engineer: {guns: ['smg', 'shotgun'], kits: ['meds', 'grenades']}};
// 遺產級（Alan 2026-10-09）：從戰死的頭目身上帶回來的，照沙盒裡那件的類別變成一件裝備。槍帶只會掉落的詞條、護甲多一些裝甲板；不能改裝
export const LEGACY_GEAR = {光束步槍: {kind: 'gun', base: 'plasma', affix: 'lance'}, 磁軌狙擊槍: {kind: 'gun', base: 'sniper', affix: 'lance'}, 脈衝手槍: {kind: 'gun', base: 'smg', affix: 'rapid'},
  重型霰彈槍: {kind: 'gun', base: 'shotgun', affix: 'burst'}, 電漿切割刀: {kind: 'melee', base: 'chainsaw'}, 單分子刀: {kind: 'melee', base: 'sabre'},
  動力裝甲: {kind: 'armor', base: 'heavy', affix: 'steady', plates: 15}, 外骨骼護甲: {kind: 'armor', base: 'medium', affix: 'steady', plates: 10},
  戰術目鏡: {kind: 'armor', base: 'light', affix: 'nightvision', plates: 5}, 護盾產生器: {kind: 'armor', base: 'medium', affix: 'antitox', plates: 20}};
export function gainLegacy(G, boss, h) {
  const d = LEGACY_GEAR[boss.kind] || LEGACY_GEAR.光束步槍;
  const it = newItem(G, {...d, legacy: {id: boss.legacy, name: boss.weapon, kind: boss.kind, bonus: boss.bonus}});
  (G.store ||= []).push(it); note(G, h, `帶回遺產級「${boss.weapon}」（${boss.kind}），放進倉庫。`);
  return it;
}
export const itemName = it => !it ? '' : it.legacy ? `遺產級「${it.legacy.name}」` : it.kind === 'gun' ? `${it.affix ? AFFIX_NAMES[it.affix] || it.affix : ''}${GUNS[it.base]?.n || it.base}` : it.kind === 'melee' ? MELEES[it.base]?.n || it.base
  : it.kind === 'armor' ? `${it.affix ? ARMOR_AFFIXES[it.affix]?.n || '' : ''}${ARMORS[it.base]?.n || it.base}` : `${KITS[it.base]?.n || it.base} ×${it.n}`;
// 變賣的價錢：土製永遠 $0；有詞條 ×1.3；只會掉落的詞條 ×2
export function itemValue(it) {
  if (it.legacy) return Math.round(600 + 2000 * (it.legacy.bonus || .1));   // 再也造不出來的東西
  if (it.kind === 'gun') return it.affix === 'homemade' ? 0 : Math.round((GUNS[it.base]?.v || 0) * (!it.affix ? 1 : DROP_ONLY.includes(it.affix) ? 2 : 1.3));
  if (it.kind === 'melee') return MELEES[it.base]?.v || 0;
  if (it.kind === 'armor') return Math.round((ARMORS[it.base]?.v || 0) * (it.affix ? 1.5 : 1));
  return (KITS[it.base]?.v || 0) * (it.n || 0);
}
export const shopPrice = it => Math.round(itemValue({...it, affix: null}) * 1.5);   // 在總部的市場買：沒有詞條，變賣價的 1.5 倍
function newItem(G, o) { G.itemSeq = (G.itemSeq || 0) + 1; return {id: 'I' + G.itemSeq, ...o}; }
// 一個人身上的裝備（還沒有的照職業配發；舊存檔的人第一次用到時補上）
export function gearOf(G, c) {
  if (!c.gear) { const d = CLASS_GEAR[c.cls] || CLASS_GEAR.soldier;
    c.gear = {guns: [0, 1, 2].map(i => d.guns[i] ? newItem(G, {kind: 'gun', base: d.guns[i], affix: 'homemade'}) : null), melee: null, armor: null, kits: [0, 1].map(i => d.kits[i] ? newItem(G, {kind: 'kit', base: d.kits[i], n: 2}) : null)}; }
  return c.gear;
}
const gearLabel = g => g.guns.filter(Boolean).map(itemName).concat(g.melee ? [itemName(g.melee)] : []).join('、');
// 換裝：把倉庫的一件放進某一格（itemId 為空＝卸下），原本那一件回倉庫。只有在總部待命的人可以換
export function equipItem(G, uid, slot, itemId) {
  const c = G.roster.find(x => x.uid === uid); if (!c || !c.alive) return '找不到這個人';
  if (c.status !== 'home') return '出勤中不能換裝';
  if (!SLOTS.includes(slot)) return '沒有這個欄位';
  const g = gearOf(G, c); G.store ||= [];
  let it = null;
  if (itemId) { it = G.store.find(x => x.id === itemId); if (!it) return '倉庫裡沒有這件'; if (it.kind !== slotKind(slot)) return '放不進這一格'; G.store.splice(G.store.indexOf(it), 1); }
  const old = slotGet(g, slot); if (old) G.store.push(old);
  slotSet(g, slot, it); c.weapon = gearLabel(g);
  return null;
}
// 變賣倉庫裡的一件（土製是 $0，等於丟掉）
export function sellItem(G, itemId, w) {
  G.store ||= []; const it = G.store.find(x => x.id === itemId); if (!it) return '倉庫裡沒有這件';
  const v = Math.round(itemValue(it) * sellFactor(G, w)); G.store.splice(G.store.indexOf(it), 1); G.cash += v; flow(G, 'sell', v, `變賣${itemName(it)}`);
  return null;
}
// 改裝倉庫裡的一把槍：換成另一個詞條（土製也可以改掉），付錢
export function modItem(G, itemId, affix) {
  G.store ||= []; const it = G.store.find(x => x.id === itemId); if (!it || it.kind !== 'gun') return '倉庫裡沒有這把槍';
  if (it.legacy) return '遺產級不能改裝';
  const A = MOD_AFFIXES[affix]; if (!A || A.notOn?.includes(it.base)) return '這把槍裝不了這個';
  if (it.affix === affix) return '已經是這個詞條了';
  const cost = modCost(it.base); if (G.cash < cost) return '錢不夠';
  G.cash -= cost; flow(G, 'mod', -cost, `改裝${itemName(it)}→${AFFIX_NAMES[affix]}`); it.affix = affix;
  return null;
}
// 雇主的報酬：一件帶詞條的護甲（結案分到尾款時有機會拿到）
function rewardArmor(G, h) {
  const r = () => rnd(G), tiers = ['light', 'light', 'medium', 'medium', 'heavy'], affs = Object.keys(ARMOR_AFFIXES);
  const it = newItem(G, {kind: 'armor', base: tiers[Math.floor(r() * tiers.length)], affix: affs[Math.floor(r() * affs.length)]});
  (G.store ||= []).push(it); note(G, h, `雇主另外送了一件${itemName(it)}，放進倉庫。`);
}
// 在總部的市場買（槍沒有詞條、近戰、護甲、預備品一次買滿一格）
export function buyItem(G, kind, base) {
  const T = {gun: GUNS, melee: MELEES, armor: ARMORS, kit: KITS}[kind]; if (!T?.[base]) return '沒有這種東西';
  const it = {kind, base, affix: null, ...(kind === 'kit' ? {n: KITS[base].max} : {})}, price = shopPrice(it);
  if (G.cash < price) return '錢不夠';
  G.cash -= price; flow(G, 'shop', -price, `買進${itemName(it)}`); (G.store ||= []).push(newItem(G, it));
  return null;
}
// 戰後寫回：身上的槍（含撿到的）、近戰、剩下的預備品照 ASH 的結果；護甲照舊
export function gearAfterBattle(G, c, r) {
  if (!r) return; const g = gearOf(G, c);
  g.guns = [0, 1, 2].map(i => r.guns[i] ? newItem(G, {kind: 'gun', base: r.guns[i].base, affix: r.guns[i].affix || null, ...(r.guns[i].legacy ? {legacy: r.guns[i].legacy} : {})}) : null);
  g.melee = r.melee ? newItem(G, {kind: 'melee', base: r.melee, ...(r.meleeLegacy ? {legacy: r.meleeLegacy} : {})}) : null;
  const left = {...r.kits}; g.kits = g.kits.map(k => { if (!k) return null; const n = Math.min(left[k.base] || 0, KITS[k.base]?.max || 3); left[k.base] = (left[k.base] || 0) - n; return n > 0 ? {...k, n} : null; });
  // 身上兩格放不下的（撿到的）進倉庫，一疊最多 max 個
  G.store ||= []; for (const [b, n0] of Object.entries(left)) { let n = n0; while (KITS[b] && n > 0) { const k = Math.min(n, KITS[b].max); G.store.push(newItem(G, {kind: 'kit', base: b, n: k})); n -= k; } }
  c.weapon = gearLabel(g);
}
const avail = G => G.roster.filter(c => c.alive && c.status === 'home' && !c.keep);
export function accept(G, book, w, opp, side, uids, now, fast = false, contract = null) {
  const pick = uids.map(u => G.roster.find(c => c.uid === u)).filter(c => c && c.alive && c.status === 'home' && !c.keep);
  if (pick.length < 2) return '至少派兩個人';
  const why = gate(G, book, w, opp, pick); if (why) return why;
  const camp = opp.kind === 'camp';   // 大戰役：不限隊數，接了之後還可以再加派（Alan 2026-10-09）
  if (!camp && G.cases.some(k => { const c = book.cases.find(x => x.id === k); return c && !c.settled && c.tile === opp.tile && c.kind === kindOf(opp); })) return '這個點已經接了';
  C.registerCompany(book, G.name, G.base);
  // 委託板上的委託：同一邊已經有人開了案件就加入；沒有就開一個，案期照委託的公開時刻算（晚接的人能打的時間就少）
  const sideKey = side || '';
  let c = contract ? book.cases.find(x => x.id === contract.cases[sideKey] && !x.settled) : null, created = false;
  if (c && G.cases.includes(c.id) && !camp) return '這個委託已經接了';
  if (camp && contract && Object.entries(contract.cases).some(([k, id]) => k !== sideKey && G.cases.includes(id))) return '已經替另一邊打了';
  if (!c) { c = C.caseFromOpp(book, w, opp, contract ? contract.start : now, {side, hours: contract ? contract.end - contract.start : undefined}); if (!c) return '這個案子開不起來'; created = true; if (contract) contract.cases[sideKey] = c.id; }
  const groups = []; for (let i = 0; i < pick.length; i += 4) groups.push(pick.slice(i, i + 4));
  if (groups.length > 1 && groups[groups.length - 1].length < 2) groups[groups.length - 2].push(...groups.pop());
  let n = 0;
  for (const g of groups) {
    const sq = C.makeSquad(book, G.name, {clones: g, gear: 3, at: G.base, name: `${G.name}・第${G.seq++}隊`}); sq.fast = !!fast;
    if (C.enlist(book, c.id, sq.id, now, w)) { n++; for (const x of g) { x.status = 'away'; x.missions++; C.joinRec(x, c, G.name, now); } }
    else delete book.squads[sq.id];
  }
  if (!n) {
    if (created) { book.cases.splice(book.cases.indexOf(c), 1); if (contract) delete contract.cases[sideKey]; }
    return '趕不上：到現場的時候已經不再派服務單了';
  }
  const again = G.cases.includes(c.id); if (!again) G.cases.push(c.id);
  note(G, now, again ? `「${c.title}」加派 ${n} 隊${fast ? '（加速）' : ''}。` : `接下「${c.title}」，${fast ? '加速' : ''}派出 ${n} 隊。`);
  return null;
}
const kindOf = o => ({short: 'route', route: 'route', exp: 'route', logging: 'route', front: 'front', tense: 'garrison', lair: 'hunt', camp: 'camp', shadow: 'shadow', counter: 'shadow', privateer: 'privateer'})[o.kind];

// ===== 派系關係（Alan 2026-10-11）=====
// 每家公司對每個勢力一個關係值（−100～100）。一般委託做得好就上升；暗影行動曝光、替人私掠就下降。
// 太低（≤ REL.REFUSE）：那個勢力不開單給你、長約不跟你簽；夠高（≥ REL.BLACK）：開黑單給你、採購有折扣。每一筆記在 G.relLog（報表看得到）
export const REL = {MIN: -100, MAX: 100, REFUSE: -30, BLACK: 20, CASE: 2, EXPOSED_VICTIM: -40, EXPOSED_EMPLOYER: -10, BLACK_FAME: 20};
export const relOf = (G, f) => (G.rel || {})[f] || 0;
export function relAdd(G, f, v, why, h) { if (f == null || f < 0 || !v) return; G.rel ||= {}; G.rel[f] = Math.max(REL.MIN, Math.min(REL.MAX, (G.rel[f] || 0) + v)); (G.relLog ||= []).push({h, f, v: Math.round(v * 10) / 10, why}); if (G.relLog.length > 200) G.relLog.shift(); }
function gate(G, book, w, opp, pick) {
  const K = w.sim.peek(), me = K.owner[G.base];
  if (opp.fac >= 0 && relOf(G, opp.fac) <= REL.REFUSE) return `${K.fac[opp.fac]?.n || '這個勢力'}不跟你往來（派系關係太低）`;
  if (opp.kind === 'shadow') {
    // 黑單只開給名氣或規模夠、跟雇主關係不差的公司；雇主要求參與的人的等級（不能派免洗人，Alan 2026-10-11）
    if (fame(G, book) < REL.BLACK_FAME && relOf(G, opp.fac) < REL.BLACK) return `黑單只找名氣 ${REL.BLACK_FAME} 以上、或跟雇主關係 ${REL.BLACK} 以上的公司`;
    const low = pick.filter(c => (c.lv || 1) < (opp.minLv || 0)); if (low.length) return `雇主要求至少 ${opp.minLv} 級（${low.map(c => label(c)).join('、')} 不夠）`;
  }
  if (opp.kind === 'privateer' && opp.foe === me) return '不能替人私掠自己總部的勢力';
  if (opp.kind === 'shadow' && opp.foe === me) return '不能接對付自己總部勢力的黑單';
  return null;
}
// 暗影行動結算（core.js 呼叫）：被點名的公司扣名氣、派系關係，倒在那件案子裡的人遺體直接銷毀（不能回收）
export function exposed(G, book, w, o, caseIds, h) {
  const K = w.sim.peek(), fn = f => K.fac[f]?.n || '某勢力';
  fame(G, book); G.fameLog.push({h, title: `黑單曝光：${fn(o.b)}抓到你的人`, fame: -FAME.BREACH});
  relAdd(G, o.b, REL.EXPOSED_VICTIM, `替人${o.op}被${fn(o.b)}抓到`, h); relAdd(G, o.a, REL.EXPOSED_EMPLOYER, `${fn(o.a)}不認帳`, h);
  let burnt = 0;
  for (const b of (book.bodies || []).slice()) if (b.co === G.name && caseIds.includes(b.caseId) && !b.takenBy) {
    const c = G.roster.find(x => x.uid === b.uid); book.bodies.splice(book.bodies.indexOf(b), 1);
    if (c && c.status === 'lost') { c.status = 'kia'; C.rec(c, {h, t: 'kia', co: G.name, burnt: true}); burnt++; }
  }
  note(G, h, `黑單曝光！${fn(o.b)}抓到我們的人，公開了公司的名字：名氣 −${FAME.BREACH}、與${fn(o.b)}的關係 ${REL.EXPOSED_VICTIM}、雇主${fn(o.a)}不認帳（${REL.EXPOSED_EMPLOYER}）${burnt ? `；倒在現場的 ${burnt} 人遺體被當場銷毀` : ''}。`);
}
export function reinforce(G, book, w, squadId, uids, now, fast = false) {
  const pick = uids.map(u => G.roster.find(c => c.uid === u)).filter(c => c && c.alive && c.status === 'home' && !c.keep);
  if (!pick.length) return '沒有選人';
  const r = C.amend(book, w, squadId, pick.length, G.base, now, {clones: pick, fast});
  if (!r.ok) return r.why;
  const cs = book.cases.find(x => x.id === book.squads[squadId]?.caseId);
  for (const c of r.amend.col ? book.squads[r.amend.col].clones : []) { c.status = 'away'; c.missions++; if (cs) C.joinRec(c, cs, G.name, now); }
  return null;
}

// ===== 每小時 =====
export function hour(G, book, w, h) {
  G.h = h;
  if (book.relQ?.length) for (const q of book.relQ.splice(0)) { if (q.co === G.name) relAdd(G, q.f, q.v, q.why, h); else (book.relQ2 ||= []).push(q); }
  if (book.relQ2?.length) { book.relQ = book.relQ2; book.relQ2 = []; }
  for (const q of G.queue) if (!q.ready && h >= q.done) readyBuild(G, q, h);
  // 帳：真正進出的錢（陣亡是帳面上的業務損失，不再扣一次現金：人和素材早就付過了）
  for (; G.ledgerAt < book.ledger.length; G.ledgerAt++) { const x = book.ledger[G.ledgerAt]; if (x.player !== G.name) continue; if (x.kind !== 'loss') { G.cash += x.amount; if (x.amount) flow(G, x.kind, x.amount, x.text); } else { G.lossBook = (G.lossBook || 0) - x.amount; flow(G, 'loss', x.amount, x.text); } }
  // 陣亡
  // 倒下（Alan 2026-10-10 回收）：打贏的當場收回（recovered，可以重新培養）；打輸的遺體留在戰場（lost，7 天內可能被撿回來）；其他路徑倒下的直接算戰死
  const nm = t => w.names[t] || '無名之地', who = c => `${CLS[c.cls].n} ${label(c)}${c.crown === 'gold' ? '（金冠）' : ''}`;
  for (const c of G.roster) if (!c.alive && !['kia', 'recovered', 'lost', 'sold'].includes(c.status)) {
    c.status = c.downAs || 'kia'; c.diedH = h;
    if (c.status === 'recovered') note(G, h, `${who(c)} 倒下，遺體連同裝備當場收回，可以到培養槽重新培養（等級、技能從頭來）。`);
    else if (c.status === 'lost') note(G, h, `${who(c)} 倒下，遺體沒能從${nm(c.downTile)}帶回來。7 天內有人在那一帶打贏，還有機會撿回來。`);
    else { note(G, h, `${who(c)} 陣亡。`); C.rec(c, {h, t: 'kia', co: G.name}); }
  }
  // 清運車回來
  for (const j of (G.cleanJobs || []).slice()) if (h >= j.done) { G.cleanJobs.splice(G.cleanJobs.indexOf(j), 1); cleanDone(G, book, w, j, h); }
  // 遺體 7 天沒撿回來：確認戰死
  for (const c of G.roster) if (c.status === 'lost' && h >= (c.downAt ?? h) + C.CFG.BODY_H) { c.status = 'kia'; C.rec(c, {h, t: 'kia', co: G.name, confirm: true}); note(G, h, `${who(c)} 的遺體沒能收回，確認戰死。`); }

  // 收尾就啟程（Alan 2026-10-10）：案件進入收尾（不再派服務單），自己的服務單都打完的小隊就啟程返回，不必等案件結算（結算還要等案期結束、一天緩衝、別家的單打完）
  for (const id of G.cases) {
    const c = book.cases.find(x => x.id === id); if (!c || c.settled || c.own || c.open) continue;
    for (const sid of c.squads) { const sq = book.squads[sid]; if (sq.player !== G.name || sq.headedHome || book.tickets.some(t => t.squad === sid && !t.done)) continue;
      const away = sq.clones.filter(x => x.alive && x.status === 'away'); sq.headedHome = h; if (!away.length) continue;
      if (sq.garrison != null) { sq.readyAt = Math.max(sq.readyAt, h + 6); note(G, h, `「${c.title}」收尾，${sq.name} 回到駐地。`); continue; }   // 駐軍回駐地待命（休整 6 小時）
      const back = C.travelHours(w, c.tile, G.base, sq.fast), path = w.sim.pmc.route(c.tile, G.base), t1 = h + (isFinite(back) ? back : 24);
      if (sq.fast) C.paySpeed(book, w, G.name, c.tile, G.base, away.length, h, `${c.title}（${sq.name}）回程`, c.id);
      for (const x of away) { x.status = 'returning'; G.returning.push({uid: x.uid, at: t1, move: {path, t0: h, t1}}); }
      note(G, h, `「${c.title}」收尾，${sq.name} ${away.length} 人啟程返回（約 ${Math.round(t1 - h)} 小時），尾款等結案再分。`); }
  }
  // 結案：活著的人走回總部（合約到期時已經啟程的就不再重複）
  for (const id of G.cases) {
    // 歸建要每家公司各記一次（案件是大家共用的；原本整個案件記一個旗子，先處理的公司把旗子立起來，其他公司的人就永遠回不來——NPC 上線後抓到）
    const c = book.cases.find(x => x.id === id); if (!c || !c.settled || c.backHome === true || c.backHome?.[G.name]) continue; (c.backHome ||= {})[G.name] = true;
    if (c.own) {
      const got = Math.round(c.qty * (c.delivered ?? 1)); G.mats[c.mat] += got;
      for (const sid of c.squads) for (const x of book.squads[sid].clones) if (x.alive && x.status === 'away') x.status = 'home';
      note(G, h, `採購車隊回到總部：${MN[c.mat]} ${got}／${c.qty}${got < c.qty ? `（路上被劫走 ${c.qty - got}）` : ''}。`); continue;
    }
    for (const sid of c.squads) { const sq = book.squads[sid]; if (sq.player !== G.name || sq.garrison != null) continue; const back = C.travelHours(w, c.tile, G.base, sq.fast), path = w.sim.pmc.route(c.tile, G.base), t1 = h + (isFinite(back) ? back : 24);
      if (sq.fast) C.paySpeed(book, w, G.name, c.tile, G.base, sq.clones.filter(x => x.alive && x.status === 'away').length, h, `${c.title}（${sq.name}）回程`, c.id); for (const x of sq.clones) if (x.alive && x.status === 'away') { x.status = 'returning'; G.returning.push({uid: x.uid, at: t1, move: {path, t0: h, t1}}); } }
    const got = c.payout?.[G.name] || 0;
    if (got > 0) { fame(G, book); const f = fameOfCase(G, book, c); if (f.fame) G.fameLog.push({h, title: c.title, kind: c.kind, ...f}); }   // 名氣
    if (got > 0 && c.fac >= 0) relAdd(G, c.fac, REL.CASE + (c.lv || 1), `${c.title}結案`, h);   // 派系關係
    if (c.contract && c.delivered < 1) { const k = (book.contracts || []).find(x => x.id === c.contract)?.signers.find(s => s.co === G.name); if (k) k.lost++; }   // 長約：丟了車隊，這一季沒有獎金
    for (const sid of c.squads) { const sq = book.squads[sid]; if (sq?.player !== G.name) continue; for (const x of sq.clones) { const e = C.caseRec(x, c.id); if (e && e.end == null) { e.end = h; e.payout = got; if (c.delivered !== undefined) e.delivered = c.delivered; } } }
    note(G, h, `「${c.title}」結案${c.delivered !== undefined ? `，送達 ${Math.round(c.delivered * 100)}%` : ''}，分到尾款 $${got}k。`);
    if (got > 0 && rnd(G) < GCFG.TEMPLATE_P) { const t = mkTemplate(G, () => rnd(G)); G.templates.push(t); note(G, h, `雇主另外送了一張模板：${CLS[t.cls].n}。`); }
    if (got > 0 && rnd(G) < GCFG.ARMOR_P) rewardArmor(G, h);
  }
  if (h % 24 === 0) { G.daily.push({h, cash: Math.round(G.cash), alive: G.roster.filter(c => c.alive).length, kia: G.roster.filter(c => !c.alive).length}); if (G.daily.length > 400) G.daily.shift(); }
  for (const r of G.returning.slice()) if (h >= r.at) { G.returning.splice(G.returning.indexOf(r), 1); const c = G.roster.find(x => x.uid === r.uid); if (c && c.alive) c.status = 'home'; }
  // 補員縱隊全滅、或到的時候案件已結算：人留在現場（駐紮），MVP 先直接讓他們走回來
  // 也包括「還在已結案的舊小隊名單裡」的人（共用案件的歸建問題留下的，見上面）：只算還在案子裡的小隊、還在路上的補員縱隊
  for (const c of G.roster) if (c.alive && c.status === 'away' && !Object.values(book.squads).some(sq => sq.clones.includes(c) && (sq.caseId || sq.column || sq.garrison != null))) { c.status = 'returning'; G.returning.push({uid: c.uid, at: h + 12}); }
}

// ===== 清運案（Alan 2026-10-09 方向、2026-10-10 做）=====
// 不用派人：雇一隊清運車去收生物廢棄物，花車資和時間，回收植入物、神經介質；那一帶（同一格、隔壁）還沒壞的遺體一起撿回來（自己的沖回損失，別家的就易主）。
// 總部那座城每天一趟免費的小清運，保底收得到一個人的素材（玩得再爛，每天也補得出一個人）。
export const CLEAN = {RANGE: 10, MIN_WASTE: 4, FARE: 4, FARE_PER: 1.5, H0: 6, H_PER: .5, H_MAX: 12, YIELD: .8, CAP: 120, DAILY: {food: 30, water: 30, implant: 30, neural: 30}};
const cleanHours = d => Math.min(CLEAN.H_MAX, CLEAN.H0 + d * CLEAN.H_PER), cleanFare = d => Math.round(CLEAN.FARE + d * CLEAN.FARE_PER);
export function cleanSites(G, book, w) {
  const nm = t => w.names[t] || '無名之地', W = book.waste || {}, busy = new Set((G.cleanJobs || []).map(j => j.tile)), out = [];
  const dailyOk = !busy.has(G.base) && G.h - (G.cleanDaily ?? -999) >= 24;
  out.push({tile: G.base, name: nm(G.base), daily: true, ok: dailyOk, waste: Math.round(W[G.base] || 0), hours: CLEAN.H0, fare: 0, next: dailyOk ? null : (G.cleanDaily ?? 0) + 24});
  // 自己的人倒在哪裡是知道的：那一格不管遠近、廢棄物多少都列出來（被賣走了就撲空）
  const mine = new Set(G.roster.filter(c => c.status === 'lost' && c.downTile != null).map(c => c.downTile));
  for (const t of new Set([...Object.keys(W).map(Number), ...mine])) { const v = W[t] || 0, d = hdist(t, G.base); if (t === G.base || !mine.has(t) && (v < CLEAN.MIN_WASTE || d > CLEAN.RANGE)) continue;
    out.push({tile: t, name: nm(t), waste: Math.round(v), dist: d, hours: cleanHours(d), fare: cleanFare(d), ok: !busy.has(t), fallen: mine.has(t)}); }
  return out.sort((a, b) => (b.daily ? 1 : 0) - (a.daily ? 1 : 0) || (b.fallen ? 1 : 0) - (a.fallen ? 1 : 0) || b.waste - a.waste).slice(0, 13);
}
export function clean(G, book, w, tile, now) {
  const s = cleanSites(G, book, w).find(x => x.tile === tile); if (!s) return '那裡沒有可以清運的東西';
  if (!s.ok) return s.daily ? '今天的清運已經跑過了' : '那裡已經有車在清運';
  if (G.cash < s.fare) return '錢不夠付車資';
  if (s.fare) C.pay(book, now, G.name, -s.fare, 'clean', `清運車資：${s.name}`);
  if (s.daily) G.cleanDaily = now;
  (G.cleanJobs ||= []).push({tile, daily: !!s.daily, start: now, done: now + s.hours});
  note(G, now, `雇了清運車去${s.name}${s.daily ? '（總部每天一趟，免費）' : `，車資 $${s.fare}k`}，約 ${s.hours} 小時後回來。`);
  return null;
}
function cleanDone(G, book, w, j, h) {
  const W = book.waste || {}, nm = t => w.names[t] || '無名之地', got = {};
  if (j.daily) Object.assign(got, CLEAN.DAILY);
  const waste = W[j.tile] || 0, take = Math.min(waste, CLEAN.CAP);
  if (take > 0) { got.implant = (got.implant || 0) + Math.round(take * CLEAN.YIELD); got.neural = (got.neural || 0) + Math.round(take * CLEAN.YIELD); W[j.tile] = waste - take; if (W[j.tile] < 1) delete W[j.tile]; }
  for (const [m, n] of Object.entries(got)) G.mats[m] = Math.min(GCFG.MAX * 10, (G.mats[m] || 0) + n);
  let bodies = 0; for (const b of book.bodies || []) if (!b.takenBy && h < b.at + C.CFG.BODY_H && hdist(b.tile, j.tile) <= 1) { b.takenBy = G.name; b.takenAt = h; bodies++; }
  note(G, h, `清運車從${nm(j.tile)}回來了：${Object.entries(got).filter(([, n]) => n).map(([m, n]) => `${MN[m]} ${n}`).join('、') || '沒撈到什麼'}${bodies ? `，還撿到 ${bodies} 具遺體` : ''}。`);
}

// ===== 長期護衛合約與駐紮（Alan 2026-10-10，warband/DESIGN.md「長期合約 v2」）=====
// 產地（石油城、彈藥農場、綠洲）每季在委託板開一份長期護衛約，期限 4 季、4 個名額；只找世界名氣排行前 4 名（至少有過一張成功的單子）的公司（Alan 2026-10-10），規模太小、跟產地的勢力在打仗、被那個勢力拉黑的公司看不到。
// 錢：簽約金一次給，或分四季給（總額多兩成）；有些要先付履約保證金（期滿沒違約就退）；一整季沒丟車隊、沒違約，季末有獎金。
// 義務：產地每 2～4 天發一趟車隊，輪流指派給一家簽約公司；5 小時內要決定派誰，時限到了還沒派，就從駐在那個產地的小隊隨機拉一隊；連駐軍都沒有就是違約。
// 違約：第一次賠簽約金的四分之一、保證金沒收；第二次再賠一半、合約作廢、那個勢力一年（4 季）不跟你往來。
export const RET = {SLOTS: 4, SEASONS: 4, WINDOW: 5, GAP0: 48, GAP1: 96, TOP_N: 4, SIZE_MIN: 8, GAR_UPKEEP: 1.5, BAN_SEASONS: 4, INSTALL: .3, BONUS: .15};
const SITE_N = {oil: '石油城', ammo: '彈藥農場', oasis: '綠洲'}, SITE_G = {oil: 'fuel', ammo: 'ammo', oasis: 'water'}, GOOD_N = {fuel: '燃料', ammo: '彈藥', water: '淨水'};
const h01 = (a, b) => (((a * 2654435761) ^ (b * 40503)) >>> 0) / 4294967296;
// 名氣（Alan 2026-10-10）：成功的單子（拿到尾款）才加：規模（案子類型）× 威脅（案子的等級 × 實際碰到的敵人戰力）× 貢獻（自己的積分佔整個案子的比例）；違約扣 60。
// 每一筆記在 G.fameLog（報表看得到）
export const FAME = {BASE: {camp: 40, front: 30, hunt: 25, garrison: 25, route: 20, shadow: 30, privateer: 25}, POW: 15, BREACH: 60};
export function fameOfCase(G, book, c) {
  const me = G.name, tot = Object.values(c.score || {}).reduce((x, y) => x + y, 0), share = tot > 0 ? (c.score[me] || 0) / tot : 0;
  const T = book.tickets.filter(t => t.caseId === c.id && t.player === me && t.done && t.enemy), pow = T.length ? T.reduce((s, t) => s + (t.enemy.power || 0), 0) / T.length : FAME.POW;
  const threat = (c.lv || 1) * Math.max(.7, Math.min(1.5, pow / FAME.POW)), base = FAME.BASE[c.kind] || 20;
  return {base, lv: c.lv || 1, pow: +pow.toFixed(1), threat: +threat.toFixed(2), share: +share.toFixed(2), fame: Math.round(base * threat * share)};
}
export function fame(G, book) {
  if (!G.fameLog) {   // 舊存檔：照已經結案、拿到尾款的案子補算一次；違約照記
    G.fameLog = []; for (const id of G.cases) { const c = book.cases.find(x => x.id === id); if (c && c.settled && !c.own && (c.payout?.[G.name] || 0) > 0) { const f = fameOfCase(G, book, c); G.fameLog.push({h: c.settledAt ?? 0, title: c.title, kind: c.kind, ...f}); } }
    for (let i = 0; i < (G.breaches || 0); i++) G.fameLog.push({h: 0, title: '違約（舊紀錄）', fame: -FAME.BREACH});
  }
  return G.fameLog.reduce((s, e) => s + e.fame, 0);
}
const garSquads = (G, book, site) => Object.values(book.squads).filter(sq => sq.player === G.name && sq.garrison === site);
const garFree = (sq, now) => !sq.caseId && sq.readyAt <= now && sq.clones.filter(c => c.alive).length >= 2 && sq.clones.filter(c => c.alive).every(c => c.status === 'away');
function canSign(G, book, w, c, now) {
  const K = w.sim.peek(), P = w.sim.pmc, me = K.owner[G.base];
  if (c.done || now >= c.signUntil) return '這份合約已經不簽了';
  if (c.signers.some(s => s.co === G.name)) return '已經簽了';
  if (c.signers.length >= c.slots) return '名額滿了';
  if (me >= 0 && c.fac >= 0 && P.atWar(me, c.fac)) return '跟你的總部勢力在打仗';
  if ((G.bans?.[c.fac] ?? -1) > now || relOf(G, c.fac) <= REL.REFUSE) return '這個勢力不跟你往來';
  if (!(book.fameTop || []).includes(G.name) || G.roster.filter(x => x.alive).length < RET.SIZE_MIN) return '名氣排行或規模不夠';
  return null;
}
export function sign(G, book, w, id, now) {
  const c = (book.contracts || []).find(x => x.id === id); if (!c) return '沒有這份合約';
  const why = canSign(G, book, w, c, now); if (why) return why;
  if (c.bond && G.cash < c.bond) return `錢不夠付履約保證金 $${c.bond}k`;
  const nm = w.names[c.site] || '無名之地';
  if (c.bond) C.pay(book, now, G.name, -c.bond, 'bond', `${nm}${SITE_N[c.kind]}長約：履約保證金`);
  const first = c.plan === 'lump' ? c.fee : Math.round(c.fee * RET.INSTALL);
  C.pay(book, now, G.name, first, 'retainer', `${nm}${SITE_N[c.kind]}長約：簽約金${c.plan === 'lump' ? '' : '（第 1 期）'}`);
  c.signers.push({co: G.name, at: now, paid: c.plan === 'lump' ? RET.SEASONS : 1, bond: c.bond || 0, breaches: 0, lost: 0, missed: 0});
  note(G, now, `簽下${nm}${SITE_N[c.kind]}的長期護衛約（到第 ${Math.floor(c.end / 24) + 1} 天）。產地發車隊時要在 ${RET.WINDOW} 小時內派人；駐在那裡的小隊會在時限到時自動接。`);
  return null;
}
// 駐紮：派人去簽約的產地待命（每天付駐紮費）；時限到了還沒手動派，就從駐軍裡隨機拉一隊
export function garrison(G, book, w, site, uids, now) {
  const c = (book.contracts || []).find(x => !x.done && x.site === site && x.signers.some(s => s.co === G.name && !s.void)); if (!c) return '只能駐在簽了長約的產地';
  const pick = uids.map(u => G.roster.find(x => x.uid === u)).filter(x => x && x.alive && x.status === 'home' && !x.keep);
  if (pick.length < 2) return '至少兩個人';
  let n = 0;
  for (let i = 0; i < pick.length; i += 4) { const g = pick.slice(i, i + 4); if (g.length < 2) break;
    const sq = C.makeSquad(book, G.name, {clones: g, gear: 3, at: site, name: `${G.name}・${w.names[site] || ''}駐軍`}); sq.garrison = site;
    const t = C.travelHours(w, G.base, site), eta = now + (isFinite(t) ? t : 24); sq.readyAt = eta; sq.move = {path: w.sim.pmc.route(G.base, site), t0: now, t1: eta};
    for (const x of g) { x.status = 'away'; C.rec(x, {h: now, t: 'garrison', co: G.name, tile: site}); } n++; }
  note(G, now, `派 ${n} 隊去${w.names[site] || ''}駐紮，約 ${Math.round(C.travelHours(w, G.base, site))} 小時後到位。`);
  return null;
}
export function ungarrison(G, book, w, squadId, now) {
  const sq = book.squads[squadId]; if (!sq || sq.player !== G.name || sq.garrison == null) return '找不到這支駐軍';
  if (sq.caseId) return '這支駐軍正在護送車隊';
  const hrs = sendHome(G, w, sq.clones, sq.garrison, now, false, book, sq.name); delete book.squads[squadId];
  note(G, now, `撤回${sq.name}，約 ${C.fmtDur(hrs)}後回到總部。`);
  return null;
}
// 接一趟車隊應召：手動選人（uids，從總部出發）或指定駐軍（squad）
export function answer(G, book, w, callId, how, now) {
  const c = (book.contracts || []).find(x => x.calls?.some(q => q.id === callId)), q = c?.calls.find(x => x.id === callId);
  if (!q || q.co !== G.name || q.state !== 'open') return '這趟應召已經結束了';
  const K = w.sim.peek(), nm = t => w.names[t] || '無名之地';
  const path = w.sim.pmc.route(c.site, q.to), risk = path.reduce((s, i) => s + (K.bandit[i] || 0), 0), lv = risk > 400 ? 3 : risk > 150 ? 2 : 1;
  let sq = null;
  if (how.squad) { sq = book.squads[how.squad]; if (!sq || sq.player !== G.name || sq.garrison !== c.site || !garFree(sq, now)) return '這支駐軍現在不能出動'; }
  else { const pick = (how.uids || []).map(u => G.roster.find(x => x.uid === u)).filter(x => x && x.alive && x.status === 'home' && !x.keep).slice(0, 4);
    if (pick.length < 2) return '至少兩個人'; sq = C.makeSquad(book, G.name, {clones: pick, gear: 3, at: G.base, name: `${G.name}・第${G.seq++}隊`}); }
  const lead = C.travelHours(w, sq.at, c.site), hours = Math.round((isFinite(lead) ? lead : 24) + C.travelHours(w, c.site, q.to) * 2 + 48);
  const cs = C.openCase(book, w, {kind: 'route', title: `護送${nm(c.site)}${SITE_N[c.kind]}的${GOOD_N[q.g]}車隊往${nm(q.to)}（長約）`, tile: c.site, from: c.site, to: q.to, fac: c.fac, lv, hours, cargo: {g: q.g, amt: q.amt, src: c.site}}, now);
  cs.pay.final = Math.round(cs.pay.final * .5); cs.contract = c.id;   // 長約的車馬費比較少（簽約金已經付過）
  delete sq.headedHome;
  if (!C.enlist(book, cs.id, sq.id, now, w)) { book.cases.splice(book.cases.indexOf(cs), 1); if (!sq.garrison) delete book.squads[sq.id]; return '趕不上'; }
  for (const x of sq.clones) if (x.alive) { if (x.status === 'home') { x.status = 'away'; } x.missions++; C.joinRec(x, cs, G.name, now); }
  G.cases.push(cs.id); q.state = 'answered'; q.case = cs.id; q.auto = !!how.auto;
  note(G, now, `${how.auto ? '時限到了，駐軍' : ''}${sq.name}接下${nm(c.site)}的車隊應召（往${nm(q.to)}）。`);
  return null;
}
function breach(cos, book, w, c, q, h, SH) {
  const s = c.signers.find(x => x.co === q.co), G = cos[q.co]; q.state = 'missed'; if (!s || !G) return;
  s.breaches++; s.missed++; G.breaches = (G.breaches || 0) + 1; fame(G, book); G.fameLog.push({h, title: `違約：${w.names[c.site] || ''}${SITE_N[c.kind]}的車隊沒人護送`, fame: -FAME.BREACH});
  const nm = (w.names[c.site] || '') + SITE_N[c.kind];
  if (s.breaches === 1) {
    const pen = Math.round(c.fee * .25); C.pay(book, h, q.co, -pen, 'breach', `${nm}長約：違約金（第一次）`);
    if (s.bond) { s.bondLost = true; }
    note(G, h, `違約！${nm}的車隊在時限內沒人來護送：賠 $${pen}k${s.bond ? `，履約保證金 $${s.bond}k 沒收` : ''}。再違約一次，合約作廢、那個勢力一年不跟你往來。`);
  } else {
    const pen = Math.round(c.fee * .5); C.pay(book, h, q.co, -pen, 'breach', `${nm}長約：違約金（第二次，合約作廢）`);
    s.void = true; (G.bans ||= {})[c.fac] = h + SH * RET.BAN_SEASONS;
    note(G, h, `再次違約：${nm}的長約作廢，賠 $${pen}k；${w.sim.peek().fac[c.fac]?.n || '那個勢力'}一年內不跟你往來。`);
  }
}
// 每個遊戲小時（core.js 呼叫）
export function retainerHour(cos, book, w, h, SH) {
  const K = w.sim.peek(), P = w.sim.pmc, sites = P.sites ? P.sites() : {}; book.contracts ||= [];
  const nm = t => w.names[t] || '無名之地';
  // 名氣排行：前 TOP_N 名、名氣大於 0 的公司才會被產地找
  const rank = Object.values(cos).map(g => [g.name, fame(g, book)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  book.fameRank = rank; book.fameTop = rank.filter(([, f]) => f > 0).slice(0, RET.TOP_N).map(([n]) => n);
  // 開約：每季、每個還在的產地一份
  if (h % SH === 0 || !book.contractsInit) { book.contractsInit = true;
    for (const [k, kind] of Object.entries(sites)) { const t = +k, m = K.markets[t]; if (!m || K.owner[t] < 0 || book.contracts.some(c => c.site === t && h < c.signUntil)) continue;
      const out = m.site?.out || 10, fee = Math.round(150 + out * 3), r = h01(t, h);
      book.contracts.push({id: 'R' + book.nextId++, site: t, kind, fac: K.owner[t], start: h, signUntil: h + SH, end: h + SH * RET.SEASONS, fee, plan: r < .5 ? 'lump' : 'install',
        bond: h01(t + 1, h) < .4 ? Math.round(fee * .5) : 0, bonus: Math.round(fee * RET.BONUS), slots: RET.SLOTS, signers: [], nextAt: h + 24, turn: 0, calls: []}); } }
  for (const c of book.contracts) {
    if (c.done) continue;
    const m = K.markets[c.site], gone = !m || K.owner[c.site] < 0, S = c.signers.filter(s => !s.void);
    if (gone || h >= c.end) {
      c.done = true;
      for (const s of c.signers) { const G = cos[s.co]; if (!G) continue; if (s.bond && !s.bondLost) C.pay(book, h, s.co, s.bond, 'bond', `${nm(c.site)}${SITE_N[c.kind]}長約：退還履約保證金`);
        if (!s.void) note(G, h, gone ? `${nm(c.site)}的${SITE_N[c.kind]}沒了（被打下或荒廢），長約提前結束，不算違約。` : `${nm(c.site)}${SITE_N[c.kind]}的長約期滿。`); }
      continue;
    }
    if (!c.signers.length && h >= c.signUntil) { c.done = true; continue; }   // 一季都沒人簽
    // 分期與季末獎金
    if ((h - c.start) % SH === 0 && h > c.start) for (const s of S) { const G = cos[s.co]; if (!G) continue;
      if (c.plan === 'install' && s.paid < RET.SEASONS) { s.paid++; C.pay(book, h, s.co, Math.round(c.fee * RET.INSTALL), 'retainer', `${nm(c.site)}${SITE_N[c.kind]}長約：簽約金第 ${s.paid} 期`); }
      if (!s.lost && !s.missed && h - s.at >= SH) { C.pay(book, h, s.co, c.bonus, 'retainer', `${nm(c.site)}${SITE_N[c.kind]}長約：這一季車隊一趟沒丟，獎金`); }
      s.lost = 0; s.missed = 0; }
    // 發車隊
    if (S.length && h >= c.nextAt) {
      const s = S[c.turn++ % S.length], g = SITE_G[c.kind], me = K.owner[c.site];
      const dests = Object.keys(K.markets).map(Number).filter(t => t !== c.site && K.owner[t] >= 0 && !P.atWar(K.owner[t], me) && hdist(t, c.site) >= 3 && hdist(t, c.site) <= 15);
      dests.sort((a, b) => (K.markets[a].ratio?.[g] ?? 1) - (K.markets[b].ratio?.[g] ?? 1) || a - b);
      const to = dests[0], amt = Math.round(Math.min(m.stock[g] * .4, (m.site?.out || 10) * .5 * (globalThis.WSCALE ?? 1e4)));
      if (to !== undefined && amt >= 2 * (globalThis.WSCALE ?? 1e4)) { const q = {id: 'Q' + book.nextId++, co: s.co, to, g, amt, at: h, deadline: h + RET.WINDOW, state: 'open'}; c.calls.push(q);
        book.inbox.push({t: h, player: s.co, kind: 'ticket', text: `長約應召：${nm(c.site)}${SITE_N[c.kind]}有一趟${GOOD_N[g]}車隊要往${nm(to)}，${RET.WINDOW} 小時內派人（沒派就從駐軍拉一隊；沒有駐軍就是違約）。`, ref: q.id}); }
      c.nextAt = h + RET.GAP0 + Math.floor(h01(c.site, h) * (RET.GAP1 - RET.GAP0));
    }
    // 應召時限
    for (const q of c.calls) if (q.state === 'open' && h >= q.deadline) {
      const G = cos[q.co], free = G ? garSquads(G, book, c.site).filter(sq => garFree(sq, h)) : [];
      if (free.length && !answer(G, book, w, q.id, {squad: free[Math.floor(h01(c.site, h + 7) * free.length)].id, auto: true}, h)) continue;
      breach(cos, book, w, c, q, h, SH);
    }
    if (c.calls.length > 40) c.calls = c.calls.filter(q => q.state === 'open' || h - q.at < 24 * 14);
  }
  // 駐紮費：每天
  if (h % 24 === 0) for (const sq of Object.values(book.squads)) if (sq.garrison != null && cos[sq.player]) { const n = sq.clones.filter(c => c.alive).length; if (n) C.pay(book, h, sq.player, -RET.GAR_UPKEEP * n, 'garrison', `${sq.name}：駐紮費（${n} 人）`); }
}
// 給畫面：看得到的長約、自己簽的、應召、駐軍
export function retainerView(G, book, w) {
  const K = w.sim.peek(), nm = t => w.names[t] || '無名之地', now = G.h, L = book.contracts || [];
  const offers = L.filter(c => !canSign(G, book, w, c, now)).map(c => ({id: c.id, site: c.site, name: nm(c.site), kind: c.kind, kn: SITE_N[c.kind], fac: K.fac[c.fac]?.n || '', fee: c.fee, plan: c.plan, bond: c.bond, bonus: c.bonus,
    total: c.plan === 'lump' ? c.fee : Math.round(c.fee * RET.INSTALL * RET.SEASONS), seasons: RET.SEASONS, left: c.slots - c.signers.length, until: c.signUntil}));
  const mine = L.filter(c => c.signers.some(s => s.co === G.name) && (!c.done || now - c.end < 72)).map(c => { const s = c.signers.find(x => x.co === G.name);
    return {id: c.id, site: c.site, name: nm(c.site), kn: SITE_N[c.kind], end: c.end, done: !!c.done, void: !!s.void, breaches: s.breaches, plan: c.plan, paid: s.paid, bond: s.bond, bondLost: !!s.bondLost,
      calls: c.calls.filter(q => q.co === G.name && q.state === 'open').map(q => ({id: q.id, to: nm(q.to), g: GOOD_N[q.g], deadline: q.deadline})),
      garrison: garSquads(G, book, c.site).map(sq => ({id: sq.id, name: sq.name, alive: sq.clones.filter(x => x.alive).length, uids: sq.clones.map(x => x.uid), busy: !!sq.caseId, ready: sq.readyAt <= now, readyAt: sq.readyAt}))}; });
  const rk = (book.fameRank || []).findIndex(([n]) => n === G.name);
  return {fame: fame(G, book), rank: rk >= 0 ? rk + 1 : null, of: (book.fameRank || []).length, topN: RET.TOP_N, fameLog: G.fameLog.slice(-40).reverse(), sizeMin: RET.SIZE_MIN, offers, mine};
}

// 沙盒裡的遺體被撿走（每個遊戲小時，在所有公司的 hour 之後；core.js 呼叫）：物歸原主就沖回損失；別家撿到就易主（原公司只看到確認戰死）
export function bodiesHour(cos, book, w, h) {
  // 廢棄物每天少一成（風沙、拾荒的、野狗）
  if (h % 24 === 0 && book.waste) for (const k of Object.keys(book.waste)) { book.waste[k] *= .9; if (book.waste[k] < 1) delete book.waste[k]; }
  const L = book.bodies; if (!L?.length) return;
  // 沒人撿的遺體放了兩天，可能被拾荒的拖去賣（Alan 2026-10-10：出現在地圖另一邊就說是輾轉被賣過去的）：搬到 10 格內的一座市鎮，那裡的清運或打贏的人撿得到
  const K = w.sim.peek(), towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
  for (const b of L) if (!b.takenBy && !b.sold && h - b.at >= 48) { let x = (b.uid * 2654435761 + h * 40503) >>> 0; if (x % 1000 >= 15) continue;
    const near = towns.filter(t => t !== b.tile && hdist(t, b.tile) <= 10); if (!near.length) continue; b.from = b.tile; b.tile = near[(x >>> 8) % near.length]; b.sold = true; const W = book.waste ||= {}; W[b.tile] = (W[b.tile] || 0) + 5; }   // 賣到的那座城多了一點「貨」，清運看得到
  for (const b of L.slice()) {
    const own = cos[b.co], c = own?.roster.find(x => x.uid === b.uid);
    if (!c || c.status !== 'lost') { L.splice(L.indexOf(b), 1); continue; }   // 已經確認戰死（或資料不在了）
    if (!b.takenBy) continue;
    L.splice(L.indexOf(b), 1);
    const to = cos[b.takenBy], who = `${CLS[c.cls].n} ${label(c)}`;
    if (!to) continue;
    if (to === own) {
      c.status = 'recovered'; C.rec(c, {h, t: 'recovered', co: own.name, tile: b.tile});
      C.pay(book, h, own.name, b.value, 'loss', `${who} 的遺體撿回來了，沖回損失`);
      note(own, h, `${who} 的遺體在${w.names[b.tile] || '無名之地'}一帶撿回來了，可以到培養槽重新培養。`); continue;
    }
    // 易主：原公司名冊留一個確認戰死的影子（編號改成負的，不跟正本撞號），正本搬到撿到的公司
    const ghost = {...c, uid: -c.uid, status: 'kia', record: [...(c.record || []), {h, t: 'kia', co: own.name, confirm: true}], gear: null};
    // 原公司的舊小隊名單也換成影子：同一個物件不能同時掛在兩家公司（存檔讀回來會拆成兩份，狀態就對不上）
    for (const sq of Object.values(book.squads)) { const i = sq.clones.indexOf(c); if (i >= 0) sq.clones[i] = ghost; }
    own.roster[own.roster.indexOf(c)] = ghost; note(own, h, `${who} 的遺體沒能收回，確認戰死。`);
    c.status = 'recovered'; c.keep = false; C.rec(c, {h, t: 'transfer', from: own.name, co: to.name, tile: b.tile});
    to.roster.push(c); note(to, h, `在${w.names[b.tile] || '無名之地'}一帶撿到一具遺體：${who}（原本是別家的人）。可以到培養槽重新培養。`);
  }
}

// 分類標籤（Alan 2026-10-10，可以多選）：不出擊（就是原本的 keep：不會被派出去）之外，純粹給玩家整理用；在機會選人時照分類列
export const TAGS = {main: '主力', fav: '最愛', train: '培育中', bench: '替補', fodder: '待合成'};
export function tag(G, uid, t) {
  const c = G.roster.find(x => x.uid === uid); if (!c) return '找不到這個人';
  if (t === 'keep') { c.keep = !c.keep; return null; }
  if (!TAGS[t]) return '沒有這個分類';
  c.tags ||= []; const i = c.tags.indexOf(t); if (i >= 0) c.tags.splice(i, 1); else c.tags.push(t);
  return null;
}
// 合成（Alan 2026-10-10）：同一位原主的兩個人，留主體（個體值、編號、裝備、服役紀錄都是主體的），被合成的只提供格子，合成後就沒了（身上的裝備進倉庫）
export function merge(G, keepUid, feedUid, now = G.h, book = null) {
  const K = G.roster.find(x => x.uid === keepUid), F = G.roster.find(x => x.uid === feedUid);
  if (!K || !F || K === F) return '要選兩個不同的人';
  if (!K.alive || !F.alive || K.status !== 'home' || F.status !== 'home') return '兩個人都要在總部待命';
  if ((K.donor ?? K.portrait) !== (F.donor ?? F.portrait)) return '只有同一位原主的人才能合成';
  const g = gearOf(G, F); G.store ||= []; for (const s of SLOTS) { const it = slotGet(g, s); if (it && !it.homemade && !/^土製/.test(itemName(it))) G.store.push(it); slotSet(g, s, null); }
  const lv0 = K.lv || 1, gain = C.mergeCells(K, F); K.lv = C.cellLevel(K);
  C.rec(K, {h: now, t: 'merge', co: G.name, fed: F.id, gain});
  G.roster.splice(G.roster.indexOf(F), 1); if (G.fresh === F.uid) G.fresh = null;
  if (book) for (const sq of Object.values(book.squads)) { const i = sq.clones.indexOf(F); if (i >= 0) sq.clones.splice(i, 1); }
  note(G, now, `合成：${label(K)} 吸收了 ${F.id} 的記憶片段，多了 ${gain} 片（${C.cellCount(K)}／100）${K.lv > lv0 ? `，升到 ${K.lv} 級` : ''}。${F.id} 身上的裝備放進倉庫。`);
  return null;
}

// 處置遺體：直接賣掉（Alan 2026-10-10）。時價：基本 18k，金冠 ×2、銀冠 ×1.4，記憶片段越多越值錢（滿了 +40%）；
// 最近 7 天全星球倒下的人越多越便宜（÷（1＋死亡數／25））。身上非土製的裝備先拆下來放進倉庫
export const BODY = {BASE: 18, GOLD: 2, SILVER: 1.4, CELLS: .4, GLUT: 25};
export const deaths7 = (book, h) => book.tickets.reduce((s, t) => s + (t.done && (t.doneAt ?? -1) >= h - 168 ? (t.dead?.length || 0) : 0), 0);
export function bodyPrice(book, c, h) {
  const k = c.crown === 'gold' ? BODY.GOLD : c.crown === 'silver' ? BODY.SILVER : 1;
  return Math.max(1, Math.round(BODY.BASE * k * (1 + BODY.CELLS * C.cellCount(c) / 100) / (1 + deaths7(book, h) / BODY.GLUT)));
}
export function sellBody(G, book, uid, now = G.h) {
  const c = G.roster.find(x => x.uid === uid); if (!c || c.status !== 'recovered') return '沒有可以處置的遺體';
  if (G.queue.some(q => q.revive === uid)) return '遺體在培養槽裡';
  const price = bodyPrice(book, c, now), g = gearOf(G, c); G.store ||= [];
  for (const s of SLOTS) { const it = slotGet(g, s); if (it && !it.homemade && !/^土製/.test(itemName(it))) G.store.push(it); slotSet(g, s, null); }
  for (const sq of Object.values(book.squads)) { const i = sq.clones.indexOf(c); if (i >= 0) sq.clones.splice(i, 1); }
  c.status = 'sold'; c.keep = false; C.rec(c, {h: now, t: 'sold', co: G.name, price});
  C.pay(book, now, G.name, price, 'body', `賣掉${label(c)}的遺體`);
  note(G, now, `賣掉 ${label(c)} 的遺體，$${price}k（最近 7 天全星球倒下 ${deaths7(book, now)} 人）。身上的裝備先拆下來放進倉庫。`);
  return null;
}

// 重新培養（Alan 2026-10-10）：把收回的遺體放進培養槽，同一個人回到名冊——職業、立繪、個體值、編號、裝備、服役紀錄都留著，等級和技能從頭來。素材照職業的固定配方
export const REVIVE_RECIPE = {soldier: {food: 60, water: 80, implant: 60, neural: 60}, recon: {food: 50, water: 50, implant: 50, neural: 120}, bulwark: {food: 60, water: 50, implant: 120, neural: 50},
  berserker: {food: 130, water: 60, implant: 50, neural: 40}, engineer: {food: 40, water: 50, implant: 100, neural: 100}};
export function revive(G, uid, slot, now = G.h) {
  const c = G.roster.find(x => x.uid === uid); if (!c || c.status !== 'recovered') return '這個人沒有可以重新培養的遺體';
  if (G.queue.some(q => q.revive === uid)) return '已經在培養槽裡了';
  if (G.queue.length >= GCFG.VATS) return '培養槽都在用';
  const used = new Set(G.queue.map((q, i) => q.slot ?? i));
  if (slot == null || !(slot >= 0 && slot < GCFG.VATS)) slot = [...Array(GCFG.VATS).keys()].find(i => !used.has(i));
  if (used.has(slot)) return '這座培養槽在用';
  const r = REVIVE_RECIPE[c.cls] || REVIVE_RECIPE.soldier;
  for (const m of MATS) if (G.mats[m] < r[m]) return `${MN[m]}不夠（要 ${r[m]}）`;
  for (const m of MATS) G.mats[m] -= r[m];
  G.queue.push({recipe: {...r}, tpl: null, revive: uid, start: now, done: now + GCFG.BUILD_H, slot});
  return null;
}

// ===== 召回：派出去的小隊（合約算毀約）、還在路上的補員 =====
function sendHome(G, w, clones, from, h, fast = false, book = null, what = '召回') {
  const back = C.travelHours(w, from, G.base, fast), t1 = h + (isFinite(back) ? back : 24), path = w.sim.pmc.route(from, G.base);
  if (fast && book) C.paySpeed(book, w, G.name, from, G.base, clones.filter(x => x.alive).length, h, `${what}回程`);
  for (const x of clones) if (x.alive) { x.status = 'returning'; G.returning.push({uid: x.uid, at: t1, move: {path, t0: h, t1}}); }
  return t1 - h;
}
export function recall(G, book, w, squadId, now) {
  const sq = book.squads[squadId]; if (!sq || sq.player !== G.name) return '找不到這一隊';
  const caseId = sq.caseId, r = C.withdraw(book, w, squadId, now); if (!r.ok) return r.why;
  for (const x of sq.clones) { const e = C.caseRec(x, caseId); if (e && e.end == null) { e.end = now; e.recalled = true; } }
  const hrs = sendHome(G, w, sq.clones, r.here, now, sq.fast, book, sq.name);
  for (const col of r.cols) sendHome(G, w, col.clones, col.here, now, col.fast, book, `${sq.name} 的補員`);
  note(G, now, `召回${sq.name}${r.penalty ? `，付違約金 $${r.penalty}k` : ''}，約 ${C.fmtDur(hrs)}後回到總部。`);
  return null;
}
export function recallColumn(G, book, w, amendId, now) {
  const r = C.cancelAmend(book, amendId, now); if (!r) return '補員正在路上交戰，打完才能撤回';
  const hrs = sendHome(G, w, r.clones, r.here, now, r.fast, book, '補員');
  note(G, now, `撤回補員，${r.clones.length} 人約 ${C.fmtDur(hrs)}後回到總部。`);
  return null;
}

// 給畫面用的樣子
export function view(G, book, w) {
  for (const c of G.roster) if (c.alive && !c.gear) { gearOf(G, c); c.weapon = gearLabel(c.gear); }   // 舊存檔的人補上裝備
  const nm = t => w.names[t] || '無名之地';
  const sqOf = {}; for (const sq of Object.values(book.squads)) for (const c of sq.clones) sqOf[c.uid] = sq;
  // 結案的案件留三天給玩家看結果；採購車隊回到總部就拿掉（Alan 2026-10-10：車隊都回家了還留在任務管制）
  const cases = G.cases.map(id => book.cases.find(x => x.id === id)).filter(Boolean).filter(c => !c.settled || (!c.own && G.h - c.settledAt < 72)).map(c => ({
    id: c.id, own: !!c.own, title: c.title, kind: c.kind, tile: c.tile, lv: c.lv, start: c.start, end: c.end, open: c.open, settled: c.settled, score: Math.round(c.score[G.name] || 0),
    payout: c.payout?.[G.name], midPaid: c.midPaid, quit: !!c.quit?.[G.name], delivered: c.delivered, convoys: c.convoys, lost: c.lostConvoys.length, pay: c.pay, tickets: c.tickets,
    squads: c.squads.map(id => book.squads[id]).filter(sq => sq && sq.player === G.name).map(sq => ({id: sq.id, name: sq.name, readyAt: sq.readyAt, busy: sq.busy, headedHome: sq.headedHome,
      backAt: Math.max(-1, ...G.returning.filter(r => sq.clones.some(x => x.uid === r.uid)).map(r => r.at)),   // 收尾後啟程返回：最後一個人到總部的時刻 refused: !!sq.refused, fast: !!sq.fast,
      clones: sq.clones.map(x => x.uid), pending: book.amends.filter(a => a.squad === sq.id && !a.done).map(a => ({id: a.id, n: a.n, eta: a.eta}))}))}));
  const units = unitsView(G, book, G.h);
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
  const K = w.sim.peek(), rel = K.fac.map((f, i) => ({f: i, n: f.n, c: f.c, alive: f.alive !== false, v: Math.round(relOf(G, i)), trait: w.sim.pmc.trait ? w.sim.pmc.trait(i) : ''})).filter(x => x.alive);
  return {rel, relLog: (G.relLog || []).slice(-40).reverse().map(e => ({...e, n: K.fac[e.f]?.n || ''})), relRefuse: REL.REFUSE, relBlack: REL.BLACK, deaths7: deaths7(book, G.h), retainer: retainerView(G, book, w), cleanSites: cleanSites(G, book, w), cleanJobs: (G.cleanJobs || []).map(j => ({...j, name: nm(j.tile)})), units, report, name: G.name, base: G.base, baseName: nm(G.base), h: G.h, cash: Math.round(G.cash), lossBook: Math.round(G.lossBook || 0), mats: G.mats, prices: prices(G, w), queue: G.queue.map((q, i) => ({done: q.done, start: q.start, slot: q.slot ?? i, recipe: q.recipe, tpl: q.tpl ? q.tpl.cls : null, revive: q.revive != null ? (c => c ? `${donorName(c)} ${c.id}` : '') (G.roster.find(x => x.uid === q.revive)) : null, ready: !!q.ready})),
    templates: G.templates, roster: G.roster.map(c => ({...c, name: donorName(c), squad: sqOf[c.uid]?.name || '', record: (c.record || []).slice(-60).map(e => ({...e, place: e.tile != null ? nm(e.tile) : ''})), downPlace: c.downTile != null ? nm(c.downTile) : '', reviving: G.queue.some(q => q.revive === c.uid), bodyPrice: c.status === 'recovered' ? bodyPrice(book, c, G.h) : null})), cases, tickets, done, log: G.log.slice(-40).reverse(), vats: GCFG.VATS, buildH: GCFG.BUILD_H, fresh: G.fresh ?? null, sellFactor: sellFactor(G, w), store: (G.store || []).map(it => ({...it, name: itemName(it), value: Math.round(itemValue(it) * sellFactor(G, w))}))};
}

// 地圖上要標的：每一支派出去的人馬現在在哪、往哪走
function rest(move, h) { if (!move || !move.path?.length) return []; const f = Math.max(0, Math.min(1, (h - move.t0) / Math.max(1, move.t1 - move.t0))); return move.path.slice(Math.floor(f * (move.path.length - 1))); }
function unitsView(G, book, h) {
  const out = [];
  for (const sq of Object.values(book.squads)) {
    if (sq.player !== G.name) continue;
    const n = sq.clones.filter(c => c.alive).length; if (!n) continue;
    if (sq.column) {
      const a = book.amends.find(x => x.col === sq.id && !x.done); if (!a) continue;
      const c = book.cases.find(x => x.id === a.caseId);
      out.push({key: sq.id, kind: 'column', name: sq.name, n, pos: C.whereIs(sq, null, h), path: rest(sq.move, h), status: `補員行軍中，約 ${C.fmtDur(a.eta - h)}後到`, where: c?.title || '', recall: {type: 'column', id: a.id}, busy: !!sq.busy});
      continue;
    }
    const c = sq.caseId && book.cases.find(x => x.id === sq.caseId); if (!c || c.settled) continue;
    const moving = sq.move && h < sq.move.t1;
    out.push({key: sq.id, kind: c.own ? 'escort' : 'squad', name: sq.name, n, pos: C.whereIs(sq, c, h), path: moving ? rest(sq.move, h) : [], where: c.title, own: !!c.own,
      status: sq.busy ? '正在打服務單' : moving ? `行軍中，約 ${C.fmtDur(sq.move.t1 - h)}後到位` : c.own ? '護送車隊中' : '在現場待命',
      recall: {type: 'squad', id: sq.id, penalty: c.own ? 0 : c.pay.deposit + (c.midPaid ? c.pay.mid : 0) + 10 * c.lv}, busy: !!sq.busy});
  }
  for (const id of G.cases) { const c = book.cases.find(x => x.id === id); if (!c || !c.own || c.settled) continue;
    const f = (h - c.start) / Math.max(1, c.end - c.start);
    out.push({key: c.id, kind: 'convoy', name: c.title, n: 0, pos: C.whereIs({}, c, h), path: f < .5 ? [...c.path].reverse() : c.path, status: f < .5 ? '採購車隊去程' : '採購車隊回程', where: c.title}); }
  const grp = {};
  for (const r of G.returning) { if (!r.move) continue; const k = r.move.t0 + ':' + r.move.path[0]; (grp[k] = grp[k] || {move: r.move, n: 0}).n++; }
  for (const k in grp) { const g = grp[k]; out.push({key: 'R' + k, kind: 'returning', name: '歸途', n: g.n, pos: C.posOn(g.move.path, (h - g.move.t0) / Math.max(1, g.move.t1 - g.move.t0)), path: rest(g.move, h), status: `回總部途中，約 ${C.fmtDur(g.move.t1 - h)}後到`, where: ''}); }
  return out;
}
