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
  return {id: `${L}-${String(Math.floor(rng() * 10000)).padStart(4, '0')}`, uid: G.seq++, cls, portrait, st, u, pct: +pct.toFixed(4),
    crown: pct >= .99 ? 'gold' : pct >= .9 ? 'silver' : '', pow: +(6 * CLS[cls].k * (.85 + .075 * sum)).toFixed(2), weapon: CLS[cls].weapon,
    hp: 20, alive: true, status: 'home', keep: false, born: o.born || 0, template: !!o.template, kills: 0, missions: 0};
}

// ===== 公司 =====
export function newCompany(w, base, name = '我的公司', seed = 7) {
  const G = {flows: [], daily: [], name, base, cash: GCFG.START_CASH, mats: {...GCFG.START_MATS}, roster: [], templates: [], queue: [], store: [], itemSeq: 0, seq: 1, rs: seed | 0, h: 0, ledgerAt: 0, inboxAt: 0, log: [], cases: [], returning: []};
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
export function claim(G, slot) {
  const q = G.queue.find((x, i) => (x.slot ?? i) === slot && x.ready); if (!q) return '這座培養槽沒有可以簽收的人';
  G.queue.splice(G.queue.indexOf(q), 1); finishBuild(G, q, G.h); return null;
}
function finishBuild(G, q, h) {
  const r = () => rnd(G);
  const c = q.tpl ? makeClone(G, r, q.tpl.cls, q.tpl.portrait, [GCFG.TEMPLATE_U, GCFG.TEMPLATE_U, GCFG.TEMPLATE_U, GCFG.TEMPLATE_U], {born: h, template: true})
    : makeClone(G, r, pickW(r, classOdds(q.recipe)), PORTRAITS[Math.floor(r() * PORTRAITS.length)], [r(), r(), r(), r()], {born: h});
  gearOf(G, c); c.weapon = gearLabel(c.gear); G.roster.push(c); G.fresh = c.uid;
  note(G, h, `培養槽出槽：${CLS[c.cls].n} ${c.id}${c.crown === 'gold' ? '（金冠！）' : c.crown === 'silver' ? '（銀冠）' : ''}${c.template ? '（模板）' : ''}，配發${c.weapon}。`);
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
    if (C.enlist(book, c.id, sq.id, now, w)) { n++; for (const x of g) { x.status = 'away'; x.missions++; } }
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
const kindOf = o => ({short: 'route', route: 'route', exp: 'route', logging: 'route', front: 'front', tense: 'garrison', lair: 'hunt', camp: 'camp'})[o.kind];
export function reinforce(G, book, w, squadId, uids, now, fast = false) {
  const pick = uids.map(u => G.roster.find(c => c.uid === u)).filter(c => c && c.alive && c.status === 'home' && !c.keep);
  if (!pick.length) return '沒有選人';
  const r = C.amend(book, w, squadId, pick.length, G.base, now, {clones: pick, fast});
  if (!r.ok) return r.why;
  for (const c of r.amend.col ? book.squads[r.amend.col].clones : []) { c.status = 'away'; c.missions++; }
  return null;
}

// ===== 每小時 =====
export function hour(G, book, w, h) {
  G.h = h;
  for (const q of G.queue) if (!q.ready && h >= q.done) readyBuild(G, q, h);
  // 帳：真正進出的錢（陣亡是帳面上的業務損失，不再扣一次現金：人和素材早就付過了）
  for (; G.ledgerAt < book.ledger.length; G.ledgerAt++) { const x = book.ledger[G.ledgerAt]; if (x.player !== G.name) continue; if (x.kind !== 'loss') { G.cash += x.amount; if (x.amount) flow(G, x.kind, x.amount, x.text); } else { G.lossBook = (G.lossBook || 0) - x.amount; flow(G, 'loss', x.amount, x.text); } }
  // 陣亡
  for (const c of G.roster) if (!c.alive && c.status !== 'kia') { c.status = 'kia'; c.diedH = h; note(G, h, `${CLS[c.cls].n} ${c.id} 陣亡${c.crown === 'gold' ? '（金冠）' : ''}。`); }
  // 收尾就啟程（Alan 2026-10-10）：案件進入收尾（不再派服務單），自己的服務單都打完的小隊就啟程返回，不必等案件結算（結算還要等案期結束、一天緩衝、別家的單打完）
  for (const id of G.cases) {
    const c = book.cases.find(x => x.id === id); if (!c || c.settled || c.own || c.open) continue;
    for (const sid of c.squads) { const sq = book.squads[sid]; if (sq.player !== G.name || sq.headedHome || book.tickets.some(t => t.squad === sid && !t.done)) continue;
      const away = sq.clones.filter(x => x.alive && x.status === 'away'); sq.headedHome = h; if (!away.length) continue;
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
    for (const sid of c.squads) { const sq = book.squads[sid]; if (sq.player !== G.name) continue; const back = C.travelHours(w, c.tile, G.base, sq.fast), path = w.sim.pmc.route(c.tile, G.base), t1 = h + (isFinite(back) ? back : 24);
      if (sq.fast) C.paySpeed(book, w, G.name, c.tile, G.base, sq.clones.filter(x => x.alive && x.status === 'away').length, h, `${c.title}（${sq.name}）回程`, c.id); for (const x of sq.clones) if (x.alive && x.status === 'away') { x.status = 'returning'; G.returning.push({uid: x.uid, at: t1, move: {path, t0: h, t1}}); } }
    const got = c.payout?.[G.name] || 0;
    note(G, h, `「${c.title}」結案${c.delivered !== undefined ? `，送達 ${Math.round(c.delivered * 100)}%` : ''}，分到尾款 $${got}k。`);
    if (got > 0 && rnd(G) < GCFG.TEMPLATE_P) { const t = mkTemplate(G, () => rnd(G)); G.templates.push(t); note(G, h, `雇主另外送了一張模板：${CLS[t.cls].n}。`); }
    if (got > 0 && rnd(G) < GCFG.ARMOR_P) rewardArmor(G, h);
  }
  if (h % 24 === 0) { G.daily.push({h, cash: Math.round(G.cash), alive: G.roster.filter(c => c.alive).length, kia: G.roster.filter(c => !c.alive).length}); if (G.daily.length > 400) G.daily.shift(); }
  for (const r of G.returning.slice()) if (h >= r.at) { G.returning.splice(G.returning.indexOf(r), 1); const c = G.roster.find(x => x.uid === r.uid); if (c && c.alive) c.status = 'home'; }
  // 補員縱隊全滅、或到的時候案件已結算：人留在現場（駐紮），MVP 先直接讓他們走回來
  // 也包括「還在已結案的舊小隊名單裡」的人（共用案件的歸建問題留下的，見上面）：只算還在案子裡的小隊、還在路上的補員縱隊
  for (const c of G.roster) if (c.alive && c.status === 'away' && !Object.values(book.squads).some(sq => sq.clones.includes(c) && (sq.caseId || sq.column))) { c.status = 'returning'; G.returning.push({uid: c.uid, at: h + 12}); }
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
  const r = C.withdraw(book, w, squadId, now); if (!r.ok) return r.why;
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
  return {units, report, name: G.name, base: G.base, baseName: nm(G.base), h: G.h, cash: Math.round(G.cash), lossBook: Math.round(G.lossBook || 0), mats: G.mats, prices: prices(G, w), queue: G.queue.map((q, i) => ({done: q.done, start: q.start, slot: q.slot ?? i, recipe: q.recipe, tpl: q.tpl ? q.tpl.cls : null, ready: !!q.ready})),
    templates: G.templates, roster: G.roster.map(c => ({...c, squad: sqOf[c.uid]?.name || ''})), cases, tickets, done, log: G.log.slice(-40).reverse(), vats: GCFG.VATS, buildH: GCFG.BUILD_H, fresh: G.fresh ?? null, sellFactor: sellFactor(G, w), store: (G.store || []).map(it => ({...it, name: itemName(it), value: Math.round(itemValue(it) * sellFactor(G, w))}))};
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
