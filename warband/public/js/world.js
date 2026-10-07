// 奇幻戰幫：世界層——走在大陸沙盒上
// 地圖、城鎮、村莊、盜匪山寨、商路、價格都來自大陸沙盒（cont.js）；這一層只管戰幫自己的人、錢、糧、貨、委託與遭遇。
// 純規則；行動入口是 worldAct(w, action)，回傳訊息與（若有）要開打的戰鬥。
import {CLASSES, RECRUIT_CLASSES, TRAIT_KEYS, NAMES, SURNAMES, FEMALE_NAMES, rngNext, rngInt, rngPick, hashSeed, ITEMS, itemName, itemWeight, gearAdd, weaponOf, TIER_NAME, SLOT_NAME, WTYPE_NAME} from './data.js';
export {ITEMS, itemName, itemWeight, weaponOf, gearAdd, SLOT_NAME, WTYPE_NAME};
import * as C from './cont.js';

export const {W, H, N, NBR, BIOMES, GOODS, hdist} = C;
// 地方特產：沙盒的商隊不跑這些，只有願意穿越荒野的人賺得到。產地便宜，離產地越遠越貴
export const SPEC = {fur: {n: '毛皮', v: 26}, wine: {n: '葡萄酒', v: 18}, fish: {n: '魚乾', v: 9}, gem: {n: '寶石', v: 40}};
export const SPECS = Object.keys(SPEC), TRADE = [...GOODS, ...SPECS];
export const GN = {...C.GN, ...Object.fromEntries(SPECS.map(g => [g, SPEC[g].n]))};
const isSpec = g => !!SPEC[g];
export const unitValue = g => isSpec(g) ? SPEC[g].v : C.BASEP[g] * COINP;
const K = C.K, nm = C.nm;

/* ───────────── 共享世界 ───────────── */
// 單人時：玩家的行動推進沙盒的時鐘。多人時：沙盒由伺服器的鬧鐘推進，
// 玩家的行動只花自己的行動點（1 AP = 1 小時），傳聞來自伺服器的事件流。
export const MODE = {shared: false, events: null, worldT: 0, bandName: '一支無名的戰幫'};
export const AP_MAX = 120;
// 這個行動要花幾小時（= 幾點 AP）
export function apCost(w, a) {
  if (a.type === 'travel') return legHours(w, a.to);
  if (a.type === 'rest') return a.hours || 24 * (a.days || 1);
  if (a.type === 'explore') return 12;
  if (a.type === 'search') return 24;
  if (a.type === 'camp') return campOptions(w).find(o => o.key === a.opt)?.hours || 1;
  if (a.type === 'attackPlayer') return 6;
  if (a.type === 'gather') return gatherOptions(w).find(o => o.key === a.kind)?.hours || 12;
  if (a.type === 'pick') return 2;
  if (a.type === 'work') return 24 * (a.days || 1);
  if (a.type === 'trade' || a.type === 'ask' || a.type === 'hirePatrol' || a.type === 'askLocal') return 1;
  if (a.type === 'escape' || a.type === 'searchTile') return 12;
  if (a.type === 'hideIn') return 1;
  if (a.type === 'waitCaptive' || a.type === 'lodge') return 24;
  return 0;
}
/* ───────────── 常數 ───────────── */
export const BALE = 0.02;           // 一包貨 = 沙盒裡 0.02 單位（戰幫的生意比起整座城的進出貨很小）
export const COINP = 3;             // 沙盒基準價 × 3 = 一包的金幣價
export const RATIONS_PER_BALE = 3;  // 一包糧 = 三份口糧
export const MAP_PRICE = 25;
export const HORSE_PRICE = 110, HORSE_FEED = 1;
export const CARRY_MAN = 1, MULE_CAP = 8, MULE_FEED = 0.5, MULE_PRICE = 45, MAX_MULES = 8, MAX_PARTY = 8;
export const GOOD_DESC = {food: '糧', wood: '木材', iron: '鐵', stone: '石材', salt: '鹽'};
const SEASON_T = 28;

/* ───────────── 人 ───────────── */
export function makeMember(w, cls, lvl, opts = {}) {
  const c = CLASSES[cls], b = c.base, g = c.grow;
  const m = {id: opts.id || `${cls}-${w.seed}-${w.nextId++}`, cls, sprite: rngPick(w, c.sprites), lvl: 1, exp: 0, max: b.hp, hp: b.hp, str: b.str, skl: b.skl, spd: b.spd, def: b.def, mov: b.mov, weapon: c.weapon, traits: [], loyalty: 100, ...opts};
  for (const s of ['str', 'skl', 'spd', 'def']) m[s] = Math.max(0, m[s] + rngInt(w, 3) - 1);
  m.max += rngInt(w, 4) - 1; m.hp = m.max;
  for (let l = 1; l < lvl; l++) { m.lvl++; for (const s of ['hp', 'str', 'skl', 'spd', 'def']) if (rngNext(w) * 100 < g[s]) { if (s === 'hp') { m.max++; m.hp++; } else m[s]++; } }
  if (!m.name) { const human = RECRUIT_CLASSES.includes(cls) || cls === 'knight'; for (let t = 0; t < 6 && (!m.name || (w.party || []).some(x => x.name === m.name)); t++) m.name = human ? `${rngPick(w, NAMES)}・${rngPick(w, SURNAMES)}` : c.name; }
  if (!c.beast && !m.g) { m.g = genderOf(m.name); m.fs = rngInt(w, 1e6); }   // 性別與頭像種子（畫面依性別從頭像庫挑一張）
  if (!c.beast && !m.eq) { const t = lvl >= 5 && rngNext(w) < 0.3 ? 1 : 0; m.eq = kitOf(w, cls, t); }
  return m;
}
/* ───────────── 裝備：武器、套裝、盾牌、飾品四格；行囊 w.pack 放備用的 ───────────── */
export const newItem = (w, b, t = 0) => ({id: 'i' + w.nextId++, b, t});
export function kitOf(w, cls, t = 0) { const k = CLASSES[cls]?.kit || {}, eq = {w: null, a: null, s: null, t: null}; for (const s of ['w', 'a', 's']) if (k[s]) eq[s] = newItem(w, k[s], s === 'w' ? t : 0); return eq; }
// 舊存檔：職業武器＋武器等級（gw）、護甲等級（ga）換成真的物品。ga 本來就是另外加的防禦，換成同等的盔甲；
// 沒有 ga 的照職業配一套，並把那套的防禦、速度從人身上扣回來（新的職業基礎值已經扣掉了）
export function fixGear(w) {
  w.pack ||= [];
  for (const m of [...(w.party || []), ...(w.guard?.men || [])]) {
    if (m.eq || CLASSES[m.cls]?.beast) continue;
    m.eq = kitOf(w, m.cls, m.gw || 0);
    if (m.ga) { m.eq.a = newItem(w, [null, 'leather', 'mail', 'plate'][m.ga] || 'plate'); m.spd -= ITEMS[m.eq.a.b].spd || 0; if (m.eq.s) { const S = ITEMS[m.eq.s.b]; m.def = Math.max(0, m.def - S.def); m.spd -= S.spd || 0; } }
    else { const g = gearAdd(m); m.def = Math.max(0, m.def - g.def); m.spd -= g.spd; }
    delete m.gw; delete m.ga;
  }
}
export const packWeight = w => (w.pack || []).reduce((s, it) => s + itemWeight(it), 0);
export const itemPrice = (w, i, it) => { const I = ITEMS[it.b], metal = !I.soft && !I.wood && I.k !== 't'; return Math.round(I.v * (1 + 0.8 * (it.t || 0)) * (metal && K().markets[i] ? 0.5 + 0.5 * ironMul(i) : 1)); };
export const sellPrice = (w, i, it) => Math.max(1, Math.round(itemPrice(w, i, it) * 0.4));
// 鐵匠鋪的貨：每座城每週換一批；大城、鐵便宜的地方有好貨
export function smithStock(w, t) {
  const k = K(), m = k.markets[t]; if (!m) return [];
  const seed = {rng: hashSeed(w.seed, 'smith', t, Math.floor(w.day / 7))}, out = [], big = m.pop > 3;
  for (const b of Object.keys(ITEMS)) { const I = ITEMS[b]; if (I.rare) continue; out.push({b, t: 0}); if (I.k !== 'a' || !I.soft) { if (rngNext(seed) < 0.5) out.push({b, t: 1}); if (big && rngNext(seed) < 0.2) out.push({b, t: 2}); } }
  if (rngNext(seed) < 0.3) out.push({b: rngPick(seed, ['charm', 'coin', 'badge']), t: 0});
  return out.filter(x => !(w.smithSold || {})[`${t}:${Math.floor(w.day / 7)}:${x.b}:${x.t}`]);
}
const slotOf = it => ITEMS[it.b].k;
// 戰利品：倒下的敵人身上的東西有機會掉下來；扛得動的收進行囊，扛不動的留在地上
function battleLoot(w, bst, foes, out) {
  w.pack ||= [];
  const byId = new Map(foes.map(f => [f.id, f])), got = [], left = [];
  for (const u of bst.units) {
    if (u.side !== 'enemy' || u.alive || u.fled) continue; const f = byId.get(u.id); if (!f?.eq || rngNext(w) > 0.35) continue;
    const opts = ['w', 'w', 'w', 'a', 's'].map(s => f.eq[s]).filter(Boolean); if (!opts.length) continue;
    const it = {...rngPick(w, opts), id: 'i' + w.nextId++};
    if (capacity(w) - load(w) >= itemWeight(it)) { w.pack.push(it); got.push(itemName(it)); } else left.push(it);
  }
  if (got.length) out.lines.push(`從倒下的敵人身上撿了${got.join('、')}。`);
  if (left.length) { addCache(w, w.pos, {}, '戰場上留下的', left); out.lines.push(`扛不動的${left.map(itemName).join('、')}留在地上。`); }
}
export const genderOf = name => FEMALE_NAMES.includes(String(name).split('・')[0]) ? 'f' : 'm';
// 主角的出身：只影響開局（職業、錢、同伴、名聲……）和角色身上的標籤
export const ORIGINS = {
  knight: {n: '落魄騎士', cls: 'knight', d: '家道中落的騎士。一匹老馬、一套鎖子甲，還有兩個不肯走的老部下。', gold: 150, horses: 1, ga: 2, mates: ['spearman', 'spearman']},
  veteran: {n: '老兵', cls: 'swordsman', d: '打過好幾場仗，在軍中小有名氣。帶著三個舊袍澤，缺的是錢。', gold: 110, fame: 0.8, mates: ['spearman', 'archer', 'axeman'], trait: 'veteran'},
  merchant: {n: '商家子弟', cls: 'spearman', d: '家裡跑商的。本錢厚、有騾子、知道附近的行情；能打的人卻不多。', gold: 420, mules: 2, mates: ['herbalist'], intel: 4},
  hunter: {n: '獵戶', cls: 'archer', d: '在林子裡長大，認得路也認得獸。附近的地形都熟，糧也多帶了一些。', gold: 160, food: 32, mates: ['spearman', 'archer'], reveal: 6},
  cloister: {n: '修道院出身', cls: 'herbalist', d: '在修道院長大的醫者。跟著你的人比較死心塌地。', gold: 180, mates: ['spearman', 'swordsman', 'archer'], loyal: 20},
  outlaw: {n: '亡命之徒', cls: 'axeman', d: '背著一條人命逃出來的。手下都是狠角色，但鄰國正在通緝你。', gold: 220, mates: ['axeman', 'swordsman'], wanted: 1.5},
};
function makeRecruit(w, cls, lvl) {
  const m = makeMember(w, cls, lvl);
  const n = rngNext(w) < 0.55 ? 1 : 2;
  while (m.traits.length < n) { const t = rngPick(w, TRAIT_KEYS); if (!m.traits.includes(t)) m.traits.push(t); }
  m.loyalty = 40 + rngInt(w, 31);
  m.wage = wageOf(m);
  m.deeds = {battles: 0, kills: 0, joinedDay: w.day};
  return m;
}
export function wageOf(m) {
  let wage = 8 + (m.lvl - 1) * 2 + (m.cls === 'herbalist' ? 2 : 0);
  if (m.traits.includes('greedy')) wage = Math.round(wage * 1.5);
  if (m.traits.includes('drunkard')) wage = Math.round(wage * 0.7);
  if (m.traits.includes('veteran')) wage += 3;
  return wage;
}
export const partyPower = (list) => list.reduce((s, m) => s + (m.hp / m.max * 0.5 + 0.5) * (m.lvl + 4) * (m.str + m.def + m.spd + m.skl / 2) / 10, 0);
const companions = w => w.party.filter(m => !m.hero);

/* ───────────── 地圖 ───────────── */
const say = (w, text) => { w.log.unshift({day: w.day, text}); if (w.log.length > 80) w.log.length = 80; };
export const passable = i => C.land(i) && K().biome[i] !== 2;
// 走進一格要花幾小時：依地形；商路上的格子有路可走
// 一格大約是一兩天的路程。季節：冬天路難走（北地更難），春汛時河邊的格子要繞路（有商路的地方有橋）
export const HEX_HOURS = 12;   // 大地圖上一格約半天路（平地 12 小時）
export const ROAD_MUL = 0.5;   // 有路的格子：走一半的時間（之後改 AP 制時，就是省一半 AP）
export const SEASON_NOTE = ['春汛：河邊不好走', '', '', '冬天：路難走，北地吃得多'];
export const coldAt = i => (C.WS.temp ? C.WS.temp[i] : 1) < 0.45;
export function hexHours(i, k = K()) {
  if (!C.land(i) || k.biome[i] === 2) return Infinity;
  let h = Math.min(48, C.MOVE[k.biome[i]] * HEX_HOURS);
  const road = k.routeTiles.has(i);
  if (road) h *= ROAD_MUL;
  if (k.season === 3 && !road) h *= coldAt(i) ? 1.6 : 1.3;
  if (k.season === 0 && C.river(i) && !road) h *= 1.4;
  return Math.max(6, Math.round(h));
}
export function findPath(w, from, to) {
  const k = K(); if (!passable(to)) return null;
  const best = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), q = [[0, from]]; best[from] = 0;
  while (q.length) {
    let bi = 0; for (let i = 1; i < q.length; i++) if (q[i][0] < q[bi][0]) bi = i;
    const [c, x] = q[bi]; q[bi] = q[q.length - 1]; q.pop();
    if (x === to) break; if (c > best[x]) continue;
    for (const n of NBR[x]) { const h = hexHours(n, k); if (h === Infinity) continue; const nc = c + h; if (nc < best[n]) { best[n] = nc; prev[n] = x; q.push([nc, n]); } }
  }
  if (best[to] === Infinity) return null;
  const out = []; let x = to; while (x !== from) { out.unshift(x); x = prev[x]; }
  return out;
}
// 一格的危險：盜匪、戰區（屬於交戰國的邊境）
export function tileRisk(i, k = K()) {
  let r = k.bandit[i] / 100; const o = k.owner[i];
  if (o >= 0 && NBR[i].some(n => { const e = k.owner[n]; return e >= 0 && e !== o && k.war[Math.min(e, o)][Math.max(e, o)]; })) r += 0.35;
  if (o < 0) r += 0.1;
  return r;
}
export const pathHours = (path, k = K()) => path.reduce((s, i) => s + hexHours(i, k), 0);

/* ───────────── 據點：直接從沙盒讀 ───────────── */
export const isTown = (i, k = K()) => !!k.markets[i] && k.owner[i] >= 0;
export const gangAt = (i, k = K()) => k.gangs.find(g => !g.gone && g.lair === i);
export function siteAt(w, i) {
  const k = K();
  if (isTown(i, k)) return {kind: 'town', i, name: nm(i), fac: k.owner[i]};
  const g = gangAt(i, k); if (g) return {kind: 'camp', i, name: `${g.name}的山寨`, gang: g.id};
  if (k.owner[i] >= 0 && k.pop[i] >= 8 && C.land(i)) return {kind: 'village', i, name: nm(i), fac: k.owner[i], mkt: k.mkt[i]};
  return null;
}
export const facName = f => { const F = K().fac[f]; return F && F.alive ? F.n : ''; };
export function atWarWith(f) { const k = K(), out = []; for (let o = 0; o < k.fac.length; o++) { if (o === f || !k.fac[o].alive) continue; const a = Math.min(o, f), b = Math.max(o, f); if (k.war[a][b]) out.push(k.fac[o].n); } return out; }
export const bandAt = (w, i) => w.bands.find(b => b.pos === i);
export function townState(w, i) {
  let t = w.towns[i];
  if (!t) t = w.towns[i] = {recruits: [], nextRecruit: 0};
  if (w.day >= t.nextRecruit) {
    t.recruits = []; const n = 2 + (K().markets[i].pop > 300 ? 1 : 0) + rngInt(w, 2);
    for (let j = 0; j < n; j++) t.recruits.push(makeRecruit(w, rngPick(w, RECRUIT_CLASSES), 1 + (rngNext(w) < 0.3 ? 1 : 0) + (rngNext(w) < 0.1 ? 1 : 0)));
    t.nextRecruit = w.day + 5;
  }
  return t;
}

/* ───────────── 市集與貨物 ───────────── */
export const load = w => TRADE.reduce((s, g) => s + (w.cargo[g] || 0), 0) + (w.pack || []).reduce((s, it) => s + itemWeight(it), 0);
export const capacity = w => w.party.length * CARRY_MAN + w.mules * MULE_CAP;
export const cargoValue = w => TRADE.reduce((s, g) => s + (w.cargo[g] || 0) * unitValue(g), 0);
const seasonId = (k = K()) => Math.floor(k.T / SEASON_T);
// 玩家這一季在這個市集淨買進（正）或賣出（負）多少包：同一季裡會一直推著價格走，換季後沙盒重算價格
function press(w, i, g) { const p = w.press[i]; return p && p.s === seasonId() ? (p[g] || 0) : 0; }
function addPress(w, i, g, d) { let p = w.press[i]; if (!p || p.s !== seasonId()) p = w.press[i] = {s: seasonId()}; p[g] = (p[g] || 0) + d; }
export const basePrice = (i, g, k = K()) => isSpec(g) ? specPrice(i, g) : C.BASEP[g] * k.markets[i].price[g] * COINP;
// 特產的產地：看城周圍兩格的地形與氣候（只算一次）
const specCache = {};
export function producers(i) {
  if (specCache[i]) return specCache[i];
  const k = K(), near = []; for (let j = 0; j < N; j++) if (hdist(i, j) <= 2) near.push(j);
  const cnt = f => near.filter(f).length, t = C.WS.temp ? C.WS.temp[i] : .5, out = [];
  if (t < 0.4 && cnt(j => [5, 6].includes(k.biome[j])) >= 5) out.push('fur');
  if (t > 0.6 && cnt(j => [4, 7].includes(k.biome[j])) >= 4) out.push('wine');
  if (NBR[i].filter(n => !C.land(n)).length >= 2) out.push('fish');
  if (cnt(j => k.biome[j] === 3 || k.biome[j] === 2) >= 3) out.push('gem');
  return specCache[i] = out;
}
const townNoise = (i, g) => 0.88 + ((i * 7919 + g.charCodeAt(0) * 104729) % 1000) / 1000 * 0.24;
export function specPrice(i, g) {
  const v = SPEC[g].v; if (producers(i).includes(g)) return v * 0.55 * townNoise(i, g);
  const k = K(); let d = 14; for (const t of Object.keys(k.markets)) { const tt = +t; if (isTown(tt, k) && producers(tt).includes(g)) d = Math.min(d, hdist(tt, i)); }
  return Math.min(v * 2.6, v * (0.6 + (globalThis.SSLOPE ?? 0.12) * d)) * townNoise(i, g);
}
function specStock(w, i, g) { if (!producers(i).includes(g)) return 0; const st = (w.spec ||= {})[i + g] || {n: 30, day: w.day}; return Math.min(40, Math.floor(st.n + (w.day - st.day) * 3)); }
const depth = (i, g, k = K()) => { if (isSpec(g)) return globalThis.SDEPTH ?? 40; const m = k.markets[i]; return Math.max(4, (m.stock[g] + m.need[g]) / BALE * 0.35); };
const factor = x => Math.max(0.25, Math.min(4, x));
// 單包的價格：第 j 包（從 0 起算）
function unit(w, i, g, side, j, k) {
  const b = basePrice(i, g, k), d = depth(i, g, k), p = press(w, i, g);
  return side === 'buy' ? b * factor(1 + (p + j + 0.5) / d) * 1.1 : b * factor(1 - (-p + j + 0.5) / d) * 0.9;
}
export function quote(w, i, g, side, q) { const k = K(); let s = 0; for (let j = 0; j < q; j++) s += unit(w, i, g, side, j, k); return Math.round(s); }
export const stockBales = (i, g, w = null) => isSpec(g) ? (w ? specStock(w, i, g) : (producers(i).includes(g) ? 30 : 0)) : Math.floor(K().markets[i].stock[g] / BALE);
export function rationPrice(w, i) {
  const k = K();
  if (isTown(i, k)) return Math.max(1, basePrice(i, 'food', k) / RATIONS_PER_BALE * 1.15);
  const s = siteAt(w, i); if (s?.kind === 'village' && k.markets[s.mkt]) return Math.max(1, basePrice(s.mkt, 'food', k) / RATIONS_PER_BALE * 0.85);
  return null;
}
export function villageFood(w, i) { const k = K(), v = w.vill[i]; const cap = Math.min(30, Math.round(k.pop[i] / 4)); if (!v) return cap; return Math.min(cap, Math.round(v.food + (w.day - v.day) * 3)); }
// 戰爭迷霧：只看得到走過、看過、聽說過的地方
export const seen = (w, i) => !w.seen || w.seen[i] === 1;
export function reveal(w, c, r) { if (!w.seen) return; const out = [c]; for (let i = 0; i < N; i++) if (hdist(i, c) <= r) w.seen[i] = 1; return out; }
const sightOf = i => { const b = K().biome[i]; return b === 3 || b === 4 ? 3 : b === 6 || b === 9 ? 1 : 2; };
export const viewRadius = w => sightOf(w.pos) + 1;
// 每場戰爭在前線各擺一支軍隊：攻方在圍城的城外或離目標最近的邊境，守方在對面
export function armies() {
  const k = K(), out = [];
  for (let a = 0; a < k.fac.length; a++) for (let b = a + 1; b < k.fac.length; b++) {
    const Wr = k.war[a][b]; if (!Wr || !k.fac[a].alive || !k.fac[b].alive) continue;
    const att = Wr.att, def = Wr.def, goal = Wr.siege ? Wr.siege.t : Wr.goal;
    let best = -1, bd = 99; for (let i = 0; i < N; i++) if (k.owner[i] === att && NBR[i].some(n => k.owner[n] === def)) { const d = hdist(i, goal); if (d < bd) { bd = d; best = i; } }
    if (best < 0) continue;
    out.push({kind: 'army', pos: best, fac: att, label: `${k.fac[att].n}的大軍`, detail: Wr.siege ? `正在圍攻${nm(Wr.siege.t)}（第 ${Wr.siege.prog} 季）` : `往${nm(Wr.goal)}進兵`});
    const d = NBR[best].find(n => k.owner[n] === def); if (d != null) out.push({kind: 'army', pos: d, fac: def, label: `${k.fac[def].n}的守軍`, detail: `擋在${nm(d)}`});
  }
  return out;
}
export function unitsInView(w) {
  const k = K(), R = viewRadius(w), near = i => i >= 0 && hdist(i, w.pos) <= R, out = [];
  const grp = {};
  const put = (key, u) => { const g = grp[key]; if (g) { g.n++; g.bales += u.bales; } else grp[key] = {...u, n: 1}; };
  for (const c of k.caravans || []) { if (c.wait > 0) continue; const i = c.path[c.pos]; if (near(i)) put(`v${i}>${c.to}${c.g}`, {kind: 'caravan', pos: i, fac: c.f, to: c.to, from: c.from, g: c.g, bales: Math.round(c.amt / BALE)}); }
  for (const c of k.carts || []) { if (c.wait > 0) continue; const i = c.path[c.pos]; if (near(i)) put(`c${i}>${c.to}`, {kind: 'cart', pos: i, fac: c.f, to: c.to, bales: Math.round(GOODS.reduce((s, g) => s + c.goods[g], 0) / BALE)}); }
  for (const u of Object.values(grp)) {
    if (u.kind === 'caravan') { u.label = `${nm(u.from)}往${nm(u.to)}的${GN[u.g]}商隊${u.n > 1 ? ` ×${u.n}` : ''}`; u.detail = `載著約 ${u.bales} 包${GN[u.g]}，有護衛`; }
    else { u.label = `往${nm(u.to)}的運貨車${u.n > 1 ? ` ×${u.n}` : ''}`; u.detail = `村裡的收成要送進城，約 ${u.bales} 包`; }
    out.push(u);
  }
  for (const a of armies()) if (near(a.pos)) out.push(a);
  for (const p of w.patrols || []) if (near(p.pos)) out.push({kind: 'patrol', id: p.id, size: p.size, pos: p.pos, fac: p.fac, label: `${k.fac[p.fac]?.n}的巡邏隊`, detail: `${p.size} 人，會趕走盜匪`});
  return out;
}
// 記下親眼看到的行情
function noteIntel(w, i, src) {
  const k = K(), m = k.markets[i]; if (!m) return;
  const p = {}, s = {}; for (const g of TRADE) { p[g] = Math.round(basePrice(i, g, k)); s[g] = stockBales(i, g); }
  w.intel[i] = {day: src === 'seen' ? w.day : w.day - Math.min(12, hdist(i, w.pos)), p, s, src};
  if (src !== 'seen') reveal(w, i, 0);
}

/* ───────────── 新世界 ───────────── */
export function newWorld(seed, heroName, opt = {}) {
  const k = K();
  const w = {v: 2, seed, rng: hashSeed('world', seed), nextId: 1, day: 1, hour: 8, gold: 200, food: 16, log: [], battles: 0, kills: 0, fallen: [], over: null,
    contracts: [], bands: [], towns: {}, vill: {}, press: {}, intel: {}, cargo: {food: 0, wood: 0, iron: 0, stone: 0, salt: 0}, mules: 0, relics: [], leads: [], escort: null, pins: [], wanted: {}, poi: {}, seen: new Array(N).fill(0), tick: 0, rumorDay: 0, earned: 0};
  // 從大城開始：人口前五大的市鎮挑一個
  const towns = Object.keys(k.markets).map(Number).filter(i => k.owner[i] >= 0).sort((a, b) => k.markets[b].pop - k.markets[a].pop).slice(0, 5);
  w.pos = towns[rngInt(w, towns.length)];
  w.party = [];
  const O = ORIGINS[opt.origin] || ORIGINS.knight, okey = ORIGINS[opt.origin] ? opt.origin : 'knight';
  const h = makeMember(w, O.cls, 2, {id: 'hero', hero: true, name: heroName || '無名的騎士'});
  h.loyalty = 100; h.wage = 0; h.deeds = {battles: 0, kills: 0, joinedDay: 1}; h.sprite = O.cls === 'knight' ? ['people', 'knight'] : CLASSES[O.cls].sprites[0];
  h.max += 3; h.hp = h.max; h.str++; h.def++;   // 主角比同職業的傭兵強一點
  h.origin = okey; h.tags = [O.n]; h.g = opt.g === 'f' ? 'f' : 'm'; if (Number.isInteger(opt.face) && opt.face >= 0) h.face = opt.face;
  if (O.trait) h.traits = [O.trait];
  w.party.push(h);
  for (const cls of O.mates) { const m = makeRecruit(w, cls, 1); if (O.loyal) m.loyalty = Math.min(100, m.loyalty + O.loyal); w.party.push(m); }
  w.gold = O.gold; if (O.horses) w.horses = O.horses; if (O.mules) w.mules = O.mules; if (O.food) w.food = O.food; if (O.fame) w.fame = O.fame;
  w.nextWage = 8;
  w.pack = [];
  w.pois = genPOIs();
  reveal(w, w.pos, O.reveal || 3);
  if (O.intel) Object.keys(k.markets).map(Number).filter(i => i !== w.pos && k.owner[i] >= 0).sort((a, b) => hdist(a, w.pos) - hdist(b, w.pos)).slice(0, O.intel).forEach(i => noteIntel(w, i, 'rumor'));
  if (O.wanted) { const f = k.fac.findIndex((F, i) => F.alive && i !== k.owner[w.pos] && Object.keys(k.markets).some(t => k.owner[t] === i && hdist(+t, w.pos) <= 12)); if (f >= 0) w.wanted[f] = O.wanted; }
  arrive(w);
  const mates = ['', '一個', '兩個', '三個', '四個'][w.party.length - 1];
  say(w, `${O.n}${h.name}${mates ? `帶著${mates}夥伴，` : ''}在${facName(k.owner[w.pos])}的${nm(w.pos)}落腳。這是 ${k.stamp.replace(/ \S+$/, '')}。`);
  return w;
}
// 走到委託地點：護送抵達就結算；傭兵、狼害就開打
function arriveJob(w, out) {
  const k = K();
  for (const c of w.contracts.slice()) if (c.kind === 'letter' && c.taken && c.to === w.pos) {
    w.gold += c.reward; w.contracts = w.contracts.filter(x => x !== c); if (c.secret) w.fame = (w.fame || 0) + 0.3;
    say(w, `把${c.secret ? '密信' : '信'}送到了${nm(c.to)}，收信的人付了 ${c.reward} 金幣。`); out.lines.push(`送達，拿到 ${c.reward} 金幣。`);
  }
  if (w.escort) { const c = w.contracts.find(x => x.id === w.escort.cid);
    if (c && c.to === w.pos) { const m = k.markets[c.to]; if (m) m.stock[c.g] += c.q * BALE; w.gold += c.reward; w.fame = (w.fame || 0) + 0.5; w.contracts = w.contracts.filter(x => x !== c); w.escort = null;
      for (const p of companions(w)) p.loyalty = Math.min(100, p.loyalty + 3); say(w, `把${GN[c.g]}商隊平安送到${nm(c.to)}，商人付了 ${c.reward} 金幣。`); out.lines.push(`護送完成，拿到 ${c.reward} 金幣。`); addFavor(w, c.town, 1, out); } }
  for (const c of w.contracts) if (c.taken && !c.done && c.kind === 'missing' && c.target === w.pos) {
    if (rngNext(w) < 0.35 && !out.battle) { out.lines.push('循著腳印找過去，先撞上了一群狼。'); c.kind = 'wolves'; c.wasMissing = true; out.battle = battleSetup(w, 'contract', c.id); break; }
    c.done = true; say(w, `在${nm(w.pos)}找到了${nm(c.vill)}失蹤的人，${rngPick(w, ['腿摔斷了', '迷了路', '躲在樹洞裡發抖', '被困在溪對岸'])}。帶他回村吧。`); out.lines.push('找到失蹤的人了。');
  }
  for (const c of w.contracts) if (c.taken && !c.done && (c.kind === 'merc' || c.kind === 'wolves' || c.kind === 'thugs') && c.target === w.pos && !out.battle) { out.battle = battleSetup(w, 'contract', c.id); break; }
}
// 走進城鎮：看行情、刷新告示板
function arrive(w) {
  if (!isTown(w.pos)) return;
  noteIntel(w, w.pos, 'seen'); townState(w, w.pos); refreshContracts(w, w.pos);
}
const ESCORT_GOODS = ['salt', 'iron', 'food', 'wood', 'stone'];
// 告示板：每次進城刷新。委託都從沙盒現況長出來：真實的山寨、真實的戰爭、真實的饑荒、真實的商路
function refreshContracts(w, t) {
  const k = K(), f = k.owner[t];
  w.contracts = w.contracts.filter(c => c.taken || c.until >= w.day);
  for (const c of w.contracts) {
    if (c.kind === 'gang' && !c.done) { const g = k.gangs.find(x => x.id === c.gang); if (!g || g.gone) c.void = true; }
    if (c.kind === 'merc' && !c.done) { const a = Math.min(c.fac, c.enemy), b = Math.max(c.fac, c.enemy); if (!k.war[a][b] || !k.fac[c.fac].alive || k.owner[c.target] !== c.enemy) c.void = true; }
    if (c.kind === 'deliver' && (!isTown(c.at, k) || c.left <= 0)) c.void = true;
    if (c.kind === 'letter' && !isTown(c.to, k)) c.void = true;
  }
  if (w.escort && !w.contracts.some(c => c.id === w.escort.cid)) w.escort = null;
  w.contracts = w.contracts.filter(c => !c.void || c.done);
  const here = w.contracts.filter(c => c.town === t && !c.taken).length;
  if (here >= 6) return;
  const add = c => { c.id = 'k' + w.nextId++; c.town = c.town ?? t; c.taken = false; c.done = false; w.contracts.push(c); };
  // 山寨懸賞
  for (const g of k.gangs) {
    if (g.gone || hdist(g.lair, t) > 7 || w.contracts.some(c => c.gang === g.id)) continue;
    add({kind: 'gang', gang: g.id, title: `剿滅${g.name}的山寨`, reward: Math.round(120 + g.str * 0.6), until: w.day + 24});
  }
  // 護送商隊：這座城的商人要把貨送去 4–9 格外的城；路上越亂賞金越高
  if (!w.contracts.some(c => c.kind === 'escort' && c.town === t && !c.taken) && rngNext(w) < 0.8) {
    const dests = Object.keys(k.markets).map(Number).filter(i => i !== t && isTown(i, k) && hdist(i, t) >= 4 && hdist(i, t) <= 9);
    if (dests.length) {
      const to = rngPick(w, dests), path = findPath(w, t, to);
      if (path) {
        const risk = path.reduce((s, i) => s + k.bandit[i], 0), days = pathHours(path, k) / 24, g = rngPick(w, ESCORT_GOODS), q = 20 + rngInt(w, 30);
        add({kind: 'escort', to, g, q, value: Math.round(q * C.BASEP[g] * COINP), title: `護送${nm(t)}往${nm(to)}的${GN[g]}商隊`, reward: Math.round(days * 22 + risk * 0.6 + 30), until: w.day + Math.ceil(days * 1.6) + 3});
      }
    }
  }
  // 收糧：附近缺糧的城出高價收糧（其他貨缺得厲害也收）
  for (const i of Object.keys(k.markets).map(Number).sort((a, b) => hdist(a, t) - hdist(b, t))) {
    if (w.contracts.filter(c => c.kind === 'deliver' && hdist(c.at, t) <= 8).length >= 2) break;
    if (!isTown(i, k) || hdist(i, t) > 8 || w.contracts.some(c => c.kind === 'deliver' && c.at === i)) continue;
    const m = k.markets[i]; let g = null;
    if (m.ratio?.food < 0.85 || m.price.food > 1.8) g = 'food'; else if (m.price.wood > 2.6 && hdist(i, t) <= 5) g = 'wood';
    if (!g) continue;
    const q = 20 + rngInt(w, 30), pay = Math.round(basePrice(i, g, k) * 1.5);
    add({kind: 'deliver', town: i, at: i, g, left: q, q, pay, title: `${nm(i)}收${GN[g]}：每包 ${pay}，收 ${q} 包`, reward: pay * q, until: w.day + 14});
  }
  // 傭兵：這座城的國家正在打仗，招人去前線
  if (f >= 0 && !w.contracts.some(c => c.kind === 'merc' && c.fac === f && !c.taken)) {
    for (let e = 0; e < k.fac.length; e++) {
      if (e === f || !k.fac[e].alive) continue; const a = Math.min(e, f), b = Math.max(e, f); if (!k.war[a][b]) continue;
      let best = -1, bd = 99; for (let i = 0; i < N; i++) if (k.owner[i] === e && NBR[i].some(n => k.owner[n] === f)) { const d = hdist(i, t); if (d < bd) { bd = d; best = i; } }
      if (best < 0 || bd > 10) continue;
      add({kind: 'merc', fac: f, enemy: e, target: best, title: `為${k.fac[f].n}出征${nm(best)}`, reward: 160 + bd * 15 + Math.floor(w.day / 10) * 20, until: w.day + 18, desc: `${k.fac[f].n}正與${k.fac[e].n}交戰。到${nm(best)}擊潰那裡的${k.fac[e].n}守軍。`});
      break;
    }
  }
  // 送信：輕、快、錢少；偶爾是密信——錢多，但有人會來截
  if (w.contracts.filter(c => c.kind === 'letter' && c.town === t && !c.taken).length < 2 && rngNext(w) < 0.85) {
    const dests = Object.keys(k.markets).map(Number).filter(i => i !== t && isTown(i, k) && hdist(i, t) >= 3 && hdist(i, t) <= 10);
    if (dests.length) { const to = rngPick(w, dests), path = findPath(w, t, to);
      if (path) { const days = pathHours(path, k) / 24, secret = rngNext(w) < 0.25, base = Math.round(days * 9 + 12);
        add({kind: 'letter', to, secret, title: secret ? `把一封密信送到${nm(to)}` : `替人捎信到${nm(to)}`, reward: secret ? base * 3 : base, until: w.day + Math.ceil(days * 1.5) + 3}); } }
  }
  // 狼害：附近村莊旁的荒野
  if (!w.contracts.some(c => c.kind === 'wolves' && c.town === t && !c.taken) && rngNext(w) < 0.6) {
    const spots = []; for (let i = 0; i < N; i++) if (k.owner[i] < 0 && C.land(i) && k.gameK[i] > 0 && hdist(i, t) <= 5 && NBR[i].some(n => k.owner[n] >= 0 && k.pop[n] >= 8)) spots.push(i);
    if (spots.length) { const i = rngPick(w, spots), v = NBR[i].find(n => k.owner[n] >= 0 && k.pop[n] >= 8); add({kind: 'wolves', target: i, title: `清除${nm(v)}村外${nm(i)}的狼群`, reward: 70 + Math.floor(w.day / 8) * 10, until: w.day + 15}); }
  }
}
// 懸賞是官府出的：回發佈的城，或同一國的任何一座城都能領
export const canClaimHere = (w, c) => { const k = K(); return c.done && c.taken && isTown(w.pos, k) && (c.town === w.pos || (k.owner[c.town] >= 0 && k.owner[c.town] === k.owner[w.pos])); };
export const contractSite = (w, c) => {
  if (c.kind === 'gang') { const g = K().gangs.find(x => x.id === c.gang); return g && !g.gone ? g.lair : -1; }
  return c.kind === 'escort' || c.kind === 'letter' ? c.to : c.kind === 'deliver' ? c.at : c.target ?? -1;
};
export const KIND_NAME = {gang: '剿匪', escort: '護送', deliver: '收購', merc: '傭兵', wolves: '狼害', letter: '送信', thugs: '惡霸', missing: '尋人'};

/* ───────────── 興趣點：荒野裡值得繞路去看看的地方 ───────────── */
// 由世界種子決定，同一個世界裡每個人看到的都一樣（多人時共用探索狀態）
export const POI_TYPES = {
  ruin: {n: '廢墟', icon: '廢', c: '#cdbf9f', d: '不知道哪個年代留下的斷牆。也許還埋著什麼，也許早被人挖空了。'},
  cave: {n: '山洞', icon: '洞', c: '#a99c8a', d: '山壁上黑黝黝的洞口，有野獸的氣味。'},
  fort: {n: '廢棄的哨堡', icon: '堡', c: '#d39a7a', d: '舊王國時代的哨堡，現在只剩半截石牆。常有逃兵和盜匪躲在裡面。'},
  wreck: {n: '沉船', icon: '船', c: '#8fc1df', d: '擱淺在礁石間的船殼，退潮時走得到。'},
  hermit: {n: '隱士小屋', icon: '屋', c: '#b6e3a8', d: '林子裡冒著一縷炊煙。住在這裡的人，知道很多外人不知道的事。'},
  shrine: {n: '古神龕', icon: '龕', c: '#e6d48c', d: '長滿青苔的石龕，供的是誰已經沒人記得。'},
  field: {n: '古戰場', icon: '骨', c: '#d8c7b8', d: '草底下還埋著生鏽的鐵器和白骨。'},
  grove: {n: '古林深處', icon: '林', c: '#9fd18a', d: '林子深處靜得出奇，連鳥都不叫。老人說舊王國的大賢者就是在這樣的地方消失的。'},
  mist: {n: '湖上的霧', icon: '霧', c: '#b9d6f0', d: '水面上終年不散的霧。漁夫說霧裡偶爾會看見一隻手。'},
};
// 開局時生成一次，存在世界裡（之後國界變了也不會跟著變）
export const pois = w => (w && w.pois) || [];
export function genPOIs() {
  const k = K(), st = {rng: hashSeed('poi', C.SEED)}, out = [], taken = new Set();
  const put = (i, type) => { if (taken.has(i)) return; taken.add(i); out.push({id: 'q' + i, tile: i, type}); };
  // 傳奇武器失落的地方：古林與湖霧
  for (const wp of k.weapons) if (wp.lost && wp.loc >= 0) { if (wp.sealed) put(wp.loc, 'grove'); else if (wp.lake && wp.shore != null) put(wp.shore, 'mist'); }
  for (let i = 0; i < N; i++) {
    if (!C.land(i) || k.biome[i] === 2 || k.owner[i] >= 0 || isTown(i, k)) continue;
    if (rngNext(st) > 0.05) continue;
    const b = k.biome[i], coast = NBR[i].some(n => !C.land(n)), nearOwn = NBR[i].some(n => k.owner[n] >= 0);
    const opts = ['ruin', 'field'];
    if (b === 3 || b === 4) opts.push('cave', 'cave', 'shrine');
    if (b === 6 || b === 9) opts.push('hermit', 'grove');
    if (coast) opts.push('wreck', 'wreck');
    if (nearOwn) opts.push('fort');
    if (b === 7 || b === 4) opts.push('shrine');
    put(i, rngPick(st, opts));
  }
  return out;
}
export const poiAt = (w, i) => pois(w).find(p => p.tile === i);
// 探索過的紀錄：單人存在自己身上；多人時由伺服器塞進 w.poiShared
export const poiDone = (w, p) => { const s = w.poiShared && w.poiShared[p.id]; if (s) return MODE.worldT - s.T < 240 ? s : null; const r = w.poi && w.poi[p.id]; return r && w.day - r.day < 60 ? r : null; };
const lootText = L => [L.gold ? `${L.gold} 金幣` : '', ...Object.entries(L.cargo || {}).filter(([, q]) => q > 0).map(([g, q]) => `${GN[g]} ${q} 包`), L.gear ? '一件堪用的兵器' : ''].filter(Boolean).join('、');
function grantLoot(w, L, out) {
  const k = K();
  if (L.gold) w.gold += L.gold;
  let room = capacity(w) - load(w);
  for (const [g, q0] of Object.entries(L.cargo || {})) { const q = Math.min(room, q0); if (q > 0) { w.cargo[g] = (w.cargo[g] || 0) + q; room -= q; } }
  if (L.gear) { const it = newItem(w, rngPick(w, rngNext(w) < 0.3 ? ['charm', 'coin', 'badge'] : ['longsword', 'pike', 'greataxe', 'longbow', 'mail', 'kite']), 1); w.pack.push(it); out.lines.push(`找到了一件${itemName(it)}，收進行囊。`); }
  if (L.reveal) reveal(w, w.pos, L.reveal);
  if (L.heal) for (const m of w.party) m.hp = m.max;
  if (L.loyalty) for (const m of companions(w)) m.loyalty = Math.min(100, m.loyalty + L.loyalty);
  if (L.lead != null) { const wp = k.weapons.find(x => x.id === L.lead); if (wp && wp.lost && !w.leads.some(x => x.wp === wp.id)) { const spot = wp.lake && wp.shore != null ? wp.shore : wp.loc; w.leads.push({id: 'L' + w.nextId++, wp: wp.id, name: wp.name, center: spot, day: w.day}); reveal(w, spot, 1); out.lines.push(`你們打聽到「${wp.name}」的下落。`); } }
  if (L.relic != null) { const wp = k.weapons.find(x => x.id === L.relic); if (wp && wp.lost) {
    wp.lost = false; wp.lake = false; wp.sealed = false; wp.holder = 0; wp.fac = -1; wp.gang = 0; wp.loc = -1; wp.player = 1;
    wp.hist.push({y: k.curY, t: `失落多年後，${MODE.bandName}在${nm(w.pos)}找到了「${wp.name}」。`});
    w.relics.push({id: wp.id, name: wp.name, kind: wp.kind, wins: wp.wins, owners: wp.owners}); w.leads = w.leads.filter(x => x.wp !== wp.id); w.fame = (w.fame || 0) + 2;
    out.lines.push(`找到了傳說中的「${wp.name}」！`); } }
  const t = lootText(L); if (t) out.lines.push(`得到${t}。`);
}
// 探索：花半天。結果可能是一場仗（打贏才拿得到東西）、一筆財物、一條線索，或什麼都沒有
function explorePOI(w, p, out) {
  const k = K(), r = rngNext(w), lvl = 1 + Math.floor(w.day / 14), L = {}, m = (lo, hi) => lo + rngInt(w, hi - lo + 1);
  let fight = null, text = '';
  const nearestLost = () => { let best = null, bd = 99; for (const wp of k.weapons) if (wp.lost && wp.loc >= 0) { const d = hdist(wp.loc, w.pos); if (d < bd) { bd = d; best = wp; } } return best; };
  switch (p.type) {
    case 'ruin': if (r < 0.45) { L.gold = m(40, 140); text = '在倒塌的地窖裡翻出一個生鏽的錢箱。'; } else if (r < 0.75) { fight = {foes: ['bandit', 'cutthroat', 'bandit'], name: '盜墓賊'}; L.gold = m(30, 90); text = '一夥盜墓賊比你們先到。'; } else text = '只有碎陶片和老鼠。'; break;
    case 'cave': if (r < 0.5) { fight = {foes: ['wolf', 'wolf', rngNext(w) < 0.4 ? 'bear' : 'boar'], name: '洞裡的野獸', biome: 'forest'}; L.cargo = {fur: m(2, 5)}; L.gold = m(0, 30); text = '洞裡的東西被吵醒了。'; } else if (r < 0.8) { L.cargo = {gem: m(1, 4)}; text = '洞壁深處有幾顆沒人採的原石。'; } else text = '洞很淺，什麼都沒有。'; break;
    case 'fort': if (r < 0.7) { fight = {foes: ['spearman', 'swordsman', 'archer', 'bandit'], name: '躲在堡裡的逃兵', leader: 'chief'}; L.gold = m(60, 160); L.cargo = {iron: m(2, 6)}; text = '石牆後面射出一支箭。'; } else { L.cargo = {iron: m(1, 4)}; text = '堡裡沒人，兵器庫還剩幾捆生鐵。'; } break;
    case 'wreck': if (r < 0.25) { fight = {foes: ['cutthroat', 'poacher', 'bandit'], name: '撿破爛的海盜'}; L.cargo = {salt: m(3, 8), fish: m(2, 6)}; text = '船殼裡有人。'; } else if (r < 0.85) { L.cargo = rngNext(w) < 0.25 ? {gem: m(1, 3), salt: m(2, 6)} : {salt: m(3, 10), fish: m(2, 8)}; text = '退潮時從船艙裡搬出了一些還能用的貨。'; } else text = '船早就被搬空了。'; break;
    case 'hermit': { L.reveal = 7; L.heal = true; const wp = nearestLost(); if (wp && rngNext(w) < 0.6) L.lead = wp.id; text = '隱士留你們過了一夜，替傷者敷了藥，還在地上畫出了附近的山川。'; break; }
    case 'shrine': if (r < 0.6) { L.loyalty = 10; text = '大家在神龕前默默站了一會兒，心裡都踏實了些。'; } else text = '風穿過石縫，像有人在低聲說話。你們沒有久留。'; break;
    case 'field': if (r < 0.4) { L.gear = true; text = '在白骨堆裡找到一把保養得出奇好的兵器。'; } else if (r < 0.7) { fight = {foes: ['wolf', 'wolf', 'wolf'], name: '啃骨頭的野狗', biome: 'plain'}; L.gold = m(10, 40); text = '一群野狗不肯讓出牠們的地盤。'; } else { const wp = nearestLost(); if (wp) L.lead = wp.id; text = '一塊殘碑上刻著舊王國騎士的名字。'; } break;
    case 'grove': case 'mist': { const wp = k.weapons.find(x => x.lost && (x.loc === w.pos || x.shore === w.pos));
      if (wp && rngNext(w) < (p.type === 'grove' ? 0.35 : 0.2)) { L.relic = wp.id; text = p.type === 'grove' ? '在一棵老得看不出年紀的樹根之間，有什麼東西在發光。' : '霧散開的一瞬間，水邊的石頭上靠著一把劍。'; }
      else { L.loyalty = 3; text = p.type === 'grove' ? '你們在林子裡繞了半天，總覺得有東西在看著。什麼也沒找到，但你確定這裡有什麼。' : '霧太濃了，什麼也看不見。也許換個日子再來。'; } break; }
  }
  return {fight, L, text};
}
/* ───────────── 時間流逝 ───────────── */
const RUMOR_TYPES = new Set(['war', 'bandit', 'econ', 'disaster', 'legend', 'hero', 'found']);
function passHours(w, hours, mode, out) {
  const ci = mode === 'camp' ? campInfo(w) : null, chill = coldNight(w), march = mode === 'travel' && w.march;
  for (let i = 0; i < hours; i++) {
    w.hour++;
    if (march) marchHour(w); else if (mode === 'camp' || mode === 'inn') w.fatigue = Math.max(0, (w.fatigue || 0) - 2);
    w.food = Math.max(0, w.food - eaters(w) / 24 * ((K().season === 3 && coldAt(w.pos) && !(ci && ci.fire) ? 1.3 : 1) + (ci && ci.watch ? 0.25 : 0)));
    const rate = march ? 0 : mode === 'inn' ? 0.5 : mode === 'camp' ? 0.2 + (ci && ci.fire ? 0.1 : 0) - (chill && !(ci && ci.fire) ? 0.12 : 0) : 0.08;
    for (const m of w.party) { m.healBuf = (m.healBuf || 0) + m.max * rate / 24; const whole = Math.floor(m.healBuf); if (whole) { m.hp = Math.min(m.max, Math.round(m.hp) + whole); m.healBuf -= whole; } }
    if (w.hour % 6 === 0) { worldTick(w, out); denRisk(w); }
    if (w.hour >= 24) { w.hour = 0; w.day++; newDay(w, out, mode); if (w.over) return; }
    guardCheck(w);
    const b = bandAt(w, w.pos);
    if (b && !out.encounter) { out.encounter = b.id; return; }
  }
}
// 每六小時：沙盒推進一個時段；附近發生的事會傳到耳裡；盜匪會盯上帶著貨的人
function worldTick(w, out) {
  const evs = MODE.shared ? MODE.events(w) : C.tick(); w.tick++;
  let told = 0;
  for (const e of evs) {
    if (told >= 2 || !RUMOR_TYPES.has(e.type) || e.tile < 0) continue;
    const d = hdist(e.tile, w.pos); if (d > (e.type === 'legend' ? 9 : 4)) continue;
    say(w, d === 0 ? e.text : `聽說：${e.text}`); told++;
    w.pins = (w.pins || []).filter(p => w.day - p.day < 12).slice(-30); w.pins.push({tile: e.tile, text: e.text, day: w.day, type: e.type});
    (w.heard ||= []).unshift({tile: e.tile, text: e.text, day: w.day, hour: w.hour, type: e.type}); if (w.heard.length > 60) w.heard.length = 60;
  }
  moveBands(w, out);
  sendBands(w);
  if (!MODE.shared) { decayCaches(w.caches ||= [], 0.25); simCaches(w.caches, evs, () => rngNext(w), w.day); }
}
function newDay(w, out, mode) {
  for (const m of w.party) m.hp = Math.round(m.hp);
  if (w.bound && rngNext(w) < 0.04 + (w.party.length < 2 ? 0.04 : 0)) { say(w, `夜裡${w.bound.name}掙開繩子逃了。`); w.bound = null; }
  if (w.food <= 0) {
    say(w, '糧食吃光了，大家餓著肚子。');
    for (const m of w.party) { m.hp = Math.max(1, m.hp - Math.ceil(m.max * 0.15)); if (!m.hero) m.loyalty -= 8; }
    if (w.mules && rngNext(w) < 0.3) { w.mules--; trimCargo(w); say(w, '一頭騾子餓得走不動，只好丟下了。'); }
  }
  if (mode === 'inn' || (mode === 'camp' && campInfo(w)?.fire)) for (const m of companions(w)) m.loyalty = Math.min(100, m.loyalty + (mode === 'inn' ? 2 : 1));
  if (w.day >= w.nextWage) payday(w);
  for (const c of w.contracts.slice()) if (c.taken && !c.done && c.until < w.day) {
    if (w.escort && w.escort.cid === c.id) failEscort(w, '商隊等不及，另請高明了。');
    else { w.contracts = w.contracts.filter(x => x !== c); say(w, `委託「${c.title}」逾期了。`); }
  }
  desertCheck(w);
}
function desertCheck(w) { for (const m of companions(w).slice()) if (m.loyalty <= 10) { w.party = w.party.filter(x => x !== m); heroGone(w, m, null); say(w, `${m.name}收拾行囊，不告而別。`); trimCargo(w); } }
// 人少了、騾子沒了，扛不動的貨只好丟下
function trimCargo(w) {
  let over = load(w) - capacity(w); if (over <= 0) return;
  const lost = [];
  const dropped = {};
  for (const g of TRADE.slice().sort((a, b) => unitValue(a) - unitValue(b))) { const d = Math.min(over, w.cargo[g] || 0); if (d > 0) { w.cargo[g] -= d; over -= d; dropped[g] = d; lost.push(`${GN[g]} ${d} 包`); } if (over <= 0) break; }
  if (lost.length) { addCache(w, w.pos, dropped, '扛不動丟下的'); say(w, `扛不動了，把${lost.join('、')}丟在${nm(w.pos)}的路邊。`); }
}
function payday(w) {
  const due = companions(w).reduce((s, m) => s + m.wage, 0);
  w.nextWage = w.day + 7;
  if (!due) return;
  if (w.gold >= due) {
    w.gold -= due; for (const m of companions(w)) m.loyalty = Math.min(100, m.loyalty + (m.traits.includes('loyal') ? 5 : 3));
    say(w, `發了這週的薪餉，共 ${due} 金幣。`);
  } else {
    const paid = w.gold; w.gold = 0;
    for (const m of companions(w)) m.loyalty -= m.traits.includes('loyal') ? 12 : m.traits.includes('greedy') ? 35 : 25;
    say(w, `薪餉發不出來（要 ${due}，只有 ${paid}）。大家的臉色很難看。`);
  }
}

/* ───────────── 路上的危險 ───────────── */
const bandLvl = (w, str) => 1 + Math.floor(w.day / 14) + (str > 220 ? 1 : 0);
function makeBand(w, kind, pos, opt = {}) {
  const foes = [];
  if (kind === 'soldiers') { const l = 1 + Math.floor(w.day / 12); foes.push(makeMember(w, 'knight', l + 1, {leader: true, name: '巡邏隊長'})); for (let i = 1; i < (opt.size || 4); i++) foes.push(makeMember(w, rngPick(w, ['spearman', 'spearman', 'swordsman', 'archer']), l, {name: '巡邏兵'})); }
  else if (kind === 'wolves') { const n = 2 + rngInt(w, 2), l = 1 + Math.floor(w.day / 16); for (let i = 0; i < n; i++) foes.push(makeMember(w, 'wolf', l)); if (rngNext(w) < 0.25) foes.push(makeMember(w, rngNext(w) < 0.5 ? 'bear' : 'boar', l + 1, {leader: true})); }
  else { const str = opt.str || 80, n = Math.min(w.day < 10 ? 4 : 6, 2 + Math.min(3, Math.floor(str / 120) + rngInt(w, 2))), l = bandLvl(w, str); for (let i = 0; i < n; i++) foes.push(makeMember(w, rngPick(w, ['bandit', 'bandit', 'cutthroat', 'poacher']), l + (rngNext(w) < 0.25 ? 1 : 0))); }
  const b = {id: 'b' + w.nextId++, kind, fac: opt.fac, name: kind === 'wolves' ? '狼群' : opt.name || '一夥盜匪', pos, foes, loot: kind === 'wolves' ? 0 : 15 + rngInt(w, 30), gang: opt.gang || 0, ttl: opt.ttl || 8, hunting: !!opt.hunting};
  w.bands.push(b); return b;
}
// 走進一格時：盜匪埋伏（看那一格的盜匪多寡與你身上的貨），荒野裡有狼
function onEnter(w, out) {
  const k = K(), i = w.pos; if (isTown(i, k) || bandAt(w, i)) return;
  const cv = cargoValue(w) + (w.escort ? w.escort.value : 0), near = k.gangs.filter(g => !g.gone && hdist(g.lair, i) <= 3).sort((a, b) => hdist(a.lair, i) - hdist(b.lair, i))[0];
  const pa = Math.min(0.25, k.bandit[i] / 100 * 0.12 * (0.7 + Math.min(1, cv / 800)) * (k.owner[i] >= 0 ? 0.6 : 1));
  if (rngNext(w) < pa * (w.guard ? 0.25 : 1) * (hidden(w) ? 0.3 : 1)) { const b = makeBand(w, 'bandits', i, {str: near ? near.str : 60 + k.bandit[i], gang: near?.id, name: near ? `${near.name}的人` : '一夥盜匪', ttl: 1}); out.encounter = b.id; return; }
  if (k.owner[i] < 0 && k.gameK[i] > 0 && rngNext(w) < (w.guard ? 0.5 : 1) * 0.035 * k.game[i] / k.gameK[i]) { const b = makeBand(w, 'wolves', i, {ttl: 1}); out.encounter = b.id; }
}
// 附近山寨的人盯上帶著貨的戰幫，派人追過來
function sendBands(w) {
  const k = K(), cv = cargoValue(w) + (w.escort ? w.escort.value : 0);
  // 山寨平常就有人在附近遊蕩：看得到的話可以繞路
  for (const g of k.gangs) {
    if (g.gone || hdist(g.lair, w.pos) > 5 || w.bands.some(b => b.gang === g.id && !b.hunting) || rngNext(w) > 0.06) continue;
    const b = makeBand(w, 'bandits', g.lair, {str: g.str * 0.7, gang: g.id, name: `${g.name}的嘍囉`, ttl: 14}); b.home = g.lair;
  }
  // 各國的巡邏隊：從附近的城出發，在自己的國土上走動，趕走盜匪
  w.patrols = (w.patrols || []).filter(p => --p.ttl > 0);
  for (const f in w.wanted || {}) { w.wanted[f] = Math.max(0, w.wanted[f] - 0.025); if (!w.wanted[f]) delete w.wanted[f]; }
  for (const p of w.patrols) {
    const cv = concealment(w), hunt = (!cv || (cv !== 'village' && rngNext(w) < findOdds({party: []}, cv, w.party.length, 0) * 0.4)) && (wantedBy(w, p.fac) >= 2 || hostileBanner(w, p.fac)) && hdist(p.pos, w.pos) <= 4;
    if (hunt) { const path = findPath(w, p.pos, w.pos); if (path && path.length) p.pos = path[0]; if (p.pos === w.pos) { makeBand(w, 'soldiers', w.pos, {fac: p.fac, size: p.size, name: `${k.fac[p.fac]?.n}的巡邏隊`, ttl: 1}); p.ttl = 0; continue; } }
    else { const nb = NBR[p.pos].filter(n => k.owner[n] === p.fac && passable(n)); if (nb.length) p.pos = rngPick(w, nb); }
    k.bandit[p.pos] *= 0.9;
    const b = w.bands.find(x => x.pos === p.pos && x.kind === 'bandits' && x.pos !== w.pos);
    if (b) { w.bands = w.bands.filter(x => x !== b); if (hdist(p.pos, w.pos) <= viewRadius(w)) say(w, `${k.fac[p.fac]?.n}的巡邏隊在${nm(p.pos)}趕跑了${b.name}。`); }
  }
  if (w.patrols.length < 3) for (const t of Object.keys(k.markets).map(Number)) {
    if (!isTown(t, k) || hdist(t, w.pos) > 5 || w.patrols.some(p => p.home === t) || rngNext(w) > 0.08) continue;
    w.patrols.push({id: 'p' + w.nextId++, fac: k.owner[t], home: t, pos: t, ttl: 16, size: 3 + rngInt(w, 3)}); if (w.patrols.length >= 3) break;
  }
  if (w.bands.filter(b => b.hunting).length >= 2) return;
  for (const g of k.gangs) {
    if (g.gone || g.str < 100 || hdist(g.lair, w.pos) > 4 || w.bands.some(b => b.gang === g.id)) continue;
    if (rngNext(w) > (0.01 + Math.min(0.06, cv / 5000)) * (campInfo(w)?.fire ? 1.6 : 1) * (w.guard ? 0.3 : 1)) continue;
    makeBand(w, 'bandits', g.lair, {str: g.str, gang: g.id, name: `${g.name}的人`, ttl: 10, hunting: true});
    say(w, `有人看見${g.name}的手下在附近打探你們的行蹤。`);
  }
}
function moveBands(w, out) {
  const mine = partyPower(battleParty(w));
  for (const b of w.bands.slice()) {
    if (b.pos === w.pos) continue;
    if (--b.ttl <= 0) { w.bands = w.bands.filter(x => x !== b); continue; }
    const theirs = partyPower(b.foes);
    if (b.hunting && theirs > mine * 0.7 && !hidden(w)) { const p = findPath(w, b.pos, w.pos); if (p && p.length) b.pos = p[0]; }
    else { const nb = NBR[b.pos].filter(n => passable(n) && (b.home == null || hdist(n, b.home) <= 3)); if (nb.length) b.pos = rngPick(w, nb); }
    if (b.pos === w.pos && hidden(w)) { const nb = NBR[b.pos].filter(passable); if (nb.length) b.pos = rngPick(w, nb); }
    if (b.pos === w.pos && !out.encounter) out.encounter = b.id;
  }
}
export const wantedBy = (w, f) => (w.wanted && w.wanted[f]) || 0;
export const fineOf = (w, f) => Math.max(30, Math.round(wantedBy(w, f) * 40));
// 付錢消災：貨比錢值錢，他們就要貨
export function tollOf(w) { if (w.escort) return {escort: true}; const cv = cargoValue(w); return cv > w.gold * 0.6 && load(w) > 0 ? {cargo: true} : {gold: Math.max(15, Math.round(w.gold * 0.3))}; }

/* ───────────── 路上的人：商隊、運貨車、巡邏隊 ───────────── */
export const hourAbs = w => w.day * 24 + w.hour;
// 世界的時鐘（共享世界：戰幫的日曆＋手上還沒用掉的行動點；單人就是戰幫的時間）
export const worldHourOf = w => w.clockOff != null ? hourAbs(w) + (w.ap || 0) + w.clockOff : hourAbs(w);
function unitsHere(w, what, to, g) {
  const k = K(), list = (what === 'caravan' ? k.caravans : k.carts) || [];
  return list.filter(c => c.wait <= 0 && c.path[c.pos] === w.pos && (to == null || c.to === to) && (what !== 'caravan' || g == null || c.g === g));
}
// 願不願意跟你打交道：被通緝、掛敵國旗不行；人多會緊張（加價或乾脆不理）；名聲高好說話
export function moodOf(w, fac, guards) {
  if (fac >= 0 && wantedBy(w, fac) >= 1) return {no: `${facName(fac)}正在通緝你們，他們不想惹麻煩`};
  if (fac >= 0 && hostileBanner(w, fac)) return {no: `你們打著跟${facName(fac)}交戰的國家的旗子`};
  const crowd = w.party.length - guards, fame = Math.min(0.15, (w.fame || 0) * 0.01);
  if (crowd >= 5) return {no: '看你們人這麼多，他們手按在刀上，只想趕快走'};
  return {mul: 1 + Math.max(0, crowd) * 0.05 - fame, scared: crowd > 0};
}
const priceAt = (i, g, k = K()) => k.markets[i] ? basePrice(i, g, k) : unitValue(g);
// 跟商隊做生意：只有他們車上那一種貨。價格照出發地到目的地的行情，看走到哪了；
// 離目的地遠、貨又多就急著出清（便宜）；收你的貨一定比賣你的便宜，快到了更不想收；裝不下就不收。
export function caravanDeal(w, u) {
  const k = K(), cs = unitsHere(w, 'caravan', u.to, u.g); if (!cs.length) return null;
  const m = moodOf(w, u.fac, 2 + cs.length * 3); if (m.no) return {no: m.no};
  const c = cs[0], g = c.g, prog = c.pos / Math.max(1, c.path.length - 1);
  const pTo = priceAt(c.to, g, k), pFrom = priceAt(c.from, g, k), mid = pFrom + (pTo - pFrom) * prog;
  const amt = cs.reduce((s, c) => s + c.amt, 0), have = Math.floor(amt / BALE + 1e-6), rush = (1 - prog) * Math.min(1, have / 40);
  const cap = cs.reduce((s, c) => s + (c.cap ?? c.amt * 1.3), 0);
  const buy = Math.max(1, Math.round(mid * (1.15 - 0.2 * rush) * m.mul)), sell = Math.max(1, Math.min(buy - 1, Math.round(mid * (0.75 - 0.25 * prog) / m.mul)));
  return {g, have, room: Math.max(0, Math.floor((cap - amt) / BALE + 1e-6)), prog, buy, sell, scared: m.scared};
}
// 運貨車：村裡的收成，照目的地的價錢打個九五折賣；糧可以拆成口糧賣
export function cartDeal(w, u) {
  const k = K(), cs = unitsHere(w, 'cart', u.to); if (!cs.length) return null;
  const m = moodOf(w, u.fac, 1 + cs.length * 2); if (m.no) return {no: m.no};
  const goods = {};
  for (const g of GOODS) { const n = Math.floor(cs.reduce((s, c) => s + (c.goods[g] || 0), 0) / BALE + 1e-6); if (n > 0) goods[g] = {have: n, buy: Math.max(1, Math.round(priceAt(u.to, g, k) * 0.95 * m.mul))}; }
  const ration = goods.food ? Math.max(1, +(goods.food.buy / RATIONS_PER_BALE * 0.9).toFixed(1)) : 0;
  return {goods, ration, rations: goods.food ? goods.food.have * RATIONS_PER_BALE : 0, scared: m.scared};
}
function drawFrom(list, get, set, amt) { for (const c of list) { const d = Math.min(get(c), amt); set(c, get(c) - d); amt -= d; if (amt <= 1e-9) break; } }
// 共享世界的畫面上沒有沙盒本體，只有鏡像：交易成功後在鏡像上照做一次，數字才不會等到下次同步才變
export function mirrorTrade(w, a) {
  const q = Math.max(1, Math.floor(+a.q || 1));
  if (a.what === 'caravan') { const cs = unitsHere(w, 'caravan', a.to, a.g); if (!cs.length) return; for (const c of cs) c.cap ??= c.amt * 1.3; if (a.side === 'buy') drawFrom(cs, c => c.amt, (c, v) => { c.amt = v; }, q * BALE); else cs[0].amt += q * BALE; }
  else { const cs = unitsHere(w, 'cart', a.to), g = a.g === 'ration' ? 'food' : a.g; drawFrom(cs, c => c.goods[g] || 0, (c, v) => { c.goods[g] = v; }, a.g === 'ration' ? q / RATIONS_PER_BALE * BALE : q * BALE); }
}
// 雇巡邏隊同行：一個兵一天 6 金幣，加 5 金幣給隊長的酒錢；名聲高、掛同一國的旗打折
export const GUARD_HOURS = [12, 24, 48];
export function patrolHire(w, p) {
  if (w.guard) return {no: '已經有巡邏隊跟著你們了'};
  const m = moodOf(w, p.fac, 99); if (m.no) return {no: m.no};
  const per = p.size * 6 * m.mul * (w.banner === p.fac ? 0.8 : 1);
  return {opts: GUARD_HOURS.map(h => ({h, cost: Math.round(per * h / 24) + 5}))};
}
// 同行的巡邏隊：走出那一國，或約好的時間到了（戰幫走滿那麼久，或世界過了那麼久，先到先算）就回去
function guardCheck(w) {
  const g = w.guard; if (!g) return; let why = '';
  if (!g.men.length) why = `${g.name}的人都沒了。`;
  else if (wantedBy(w, g.fac) >= 1 || hostileBanner(w, g.fac)) why = `${g.name}不肯再跟通緝犯走在一起，回去了。`;
  else if (K().owner[w.pos] !== g.fac) why = `走出了${facName(g.fac) || '他們'}的國境，${g.name}回頭了。`;
  else if (hourAbs(w) >= g.untilP || worldHourOf(w) >= g.untilW) why = `約好的時間到了，${g.name}道別回去巡邏。`;
  if (why) { w.guard = null; say(w, why); }
}
function loseCargo(w, frac, why, drop) {
  const lost = [], gone = {}; for (const g of TRADE) { const d = Math.ceil((w.cargo[g] || 0) * frac); if (d > 0) { w.cargo[g] -= d; gone[g] = d; lost.push(`${GN[g]} ${d} 包`); } }
  if (drop && lost.length) addCache(w, w.pos, gone, drop);
  if (lost.length) say(w, `${why}${lost.join('、')}。`); return lost;
}

function failEscort(w, why) {
  const c = w.contracts.find(x => x.id === w.escort?.cid); w.escort = null; if (!c) return;
  w.contracts = w.contracts.filter(x => x !== c);
  for (const m of companions(w)) m.loyalty = Math.max(0, m.loyalty - 4);
  say(w, `${why}「${c.title}」失敗了。`);
}
/* ───────────── 戰鬥銜接 ───────────── */
const battleBiome = i => { const b = K().biome[i]; return b === 6 || b === 9 ? 'forest' : b === 3 || b === 4 ? 'hills' : 'plain'; };
export function battleSetup(w, kind, ref) {
  w.battles++;
  const seed = hashSeed(w.seed, 'b', w.battles);
  if (kind === 'band') { const b = w.bands.find(x => x.id === ref), ci = campInfo(w); return {seed, biome: battleBiome(w.pos), foes: b.foes, source: {kind, ref}, title: b.name, camp: ci ? {side: 'ally', stake: ci.stake, watch: ci.watch, ready: ci.ready, def: ci.ready ? 1 : 0} : null}; }
  if (kind === 'raid') {
    const u = ref, lvl = 1 + Math.floor(w.day / 14), foes = [];
    if (u.kind === 'caravan') { foes.push(makeMember(w, 'swordsman', lvl + 1, {leader: true, name: '護衛隊長'})); const n = 2 + Math.min(3, u.n) + rngInt(w, 2); for (let i = 0; i < n; i++) foes.push(makeMember(w, rngPick(w, ['spearman', 'swordsman', 'archer']), lvl, {name: '商隊護衛'})); }
    else { const n = 1 + Math.min(3, u.n) + rngInt(w, 2); for (let i = 0; i < n; i++) foes.push(makeMember(w, 'spearman', Math.max(1, lvl - 1), {name: '押車的民兵'})); }
    return {seed, biome: battleBiome(w.pos), foes, source: {kind: 'raid', what: u.kind, to: u.to, fac: u.fac}, title: u.label};
  }
  if (kind === 'poi') {
    const {p, fight, L} = ref, lvl = 1 + Math.floor(w.day / 14), foes = [];
    if (fight.leader) foes.push(makeMember(w, fight.leader, lvl + 1, {leader: true}));
    for (const c of fight.foes) foes.push(makeMember(w, c, lvl, CLASSES[c].beast ? {} : {name: fight.name}));
    return {seed, biome: fight.biome || battleBiome(w.pos), foes, source: {kind: 'poi', id: p.id, loot: L}, title: `${POI_TYPES[p.type].n}的${fight.name}`};
  }
  if (kind === 'contract') {
    const c = w.contracts.find(x => x.id === ref), k = K(), lvl = 1 + Math.floor(w.day / 12), foes = [];
    if (c.kind === 'wolves') { const n = 2 + rngInt(w, 2); for (let i = 0; i < n; i++) foes.push(makeMember(w, 'wolf', lvl)); foes.push(makeMember(w, rngNext(w) < 0.3 ? 'bear' : 'boar', lvl, {leader: true})); return {seed, biome: 'forest', foes, source: {kind, ref}, title: c.title}; }
    if (c.kind === 'thugs') { foes.push(makeMember(w, 'cutthroat', lvl, {leader: true, name: '惡霸頭子'})); const n = 1 + rngInt(w, 3); for (let i = 0; i < n; i++) foes.push(makeMember(w, rngPick(w, ['bandit', 'bandit', 'poacher']), Math.max(1, lvl - 1), {name: '打手'})); return {seed, biome: battleBiome(w.pos), foes, source: {kind, ref}, title: c.title}; }
    const E = k.fac[c.enemy].n; foes.push(makeMember(w, 'knight', lvl + 2, {leader: true, name: `${E}的隊長`}));
    const n = 3 + Math.min(3, Math.floor(w.day / 15)); for (let i = 0; i < n; i++) foes.push(makeMember(w, rngPick(w, ['swordsman', 'spearman', 'spearman', 'archer', 'axeman']), lvl + (i === 0 ? 1 : 0), {name: `${E}的士兵`}));
    return {seed, biome: battleBiome(w.pos), foes, source: {kind, ref}, title: `${nm(w.pos)}的${E}守軍`};
  }
  const g = K().gangs.find(x => x.id === ref), lvl = bandLvl(w, g.str) + 1;
  const foes = [makeMember(w, 'chief', lvl + 1, {leader: true, name: `頭目${g.name}`})];
  const n = 3 + Math.min(3, Math.floor(g.str / 100));
  for (let i = 0; i < n; i++) foes.push(makeMember(w, rngPick(w, ['bandit', 'bandit', 'cutthroat', 'poacher']), lvl + (i === 0 ? 1 : 0)));
  return {seed, biome: 'camp', foes, source: {kind: 'gang', ref}, title: `${g.name}的山寨`};
}
/* ───────────── 人情：記在地方上（一座城加上周圍歸它的村子算一區） ───────────── */
export function regionOf(i, k = K()) {
  if (i < 0) return -1; if (isTown(i, k)) return i; if (k.mkt[i] >= 0 && k.markets[k.mkt[i]]) return k.mkt[i];
  let best = -1, bd = 4; for (const t of Object.keys(k.markets).map(Number)) { const d = hdist(t, i); if (d <= bd && isTown(t, k)) { bd = d; best = t; } } return best;
}
const FAVOR_FADE = 0.97;   // 每天淡掉 3%
export function favorAt(w, i) { const r = regionOf(i), f = (w.favor || {})[r]; return f ? f.v * FAVOR_FADE ** Math.max(0, w.day - f.day) : 0; }
export function addFavor(w, i, n, out) {
  const r = regionOf(i); if (r < 0 || !n) return; const v = Math.max(0, favorAt(w, i) + n);
  (w.favor ||= {})[r] = {v, day: w.day}; if (v < 0.05) delete w.favor[r];
  if (n >= 1 && out) out.lines.push(`${nm(r)}一帶的人記下了這份人情。`);
}
const gangWordOf = str => str > 260 ? '人多勢眾' : str > 160 ? '有一定規模' : '人不多';
// 附近（這格或相鄰）有欠你們人情的村子，就能躲
export function canHide(w) { for (const i of [w.pos, ...NBR[w.pos]]) { const s = siteAt(w, i); if ((s?.kind === 'village') && favorAt(w, i) >= FAVOR.hide) return i; } return null; }
export const spendFavor = (w, i, n) => { if (favorAt(w, i) + 1e-9 < n) throw new Error(`${nm(regionOf(i))}一帶欠你們的人情不夠`); addFavor(w, i, -n); };
export const favorList = w => Object.keys(w.favor || {}).map(Number).map(r => ({r, v: favorAt(w, r)})).filter(x => x.v >= 0.1).sort((a, b) => b.v - a.v);
export const FAVOR = {lodge: 1, ask: 1, hide: 2, ransom: 5};
// 藏身村中：借宿就是藏起來（巡邏隊、官兵、盜匪、別的戰幫都找不到）。照世界的時間付人情，
// 藏得越久每天要得越多（第 t 天要 1+t 點），被通緝得越兇村民冒的險越大。人情用完就得走。
export const lodgedHere = w => w.lodged != null && w.lodged === w.pos;
// 從大家眼前消失的三種方法：藏在村民家（花人情）、輕裝躲進深林（三人以內、不帶騾馬、不生火）、躲進洞窟廢墟（裡面有東西）
export const HIDE_POI = new Set(['cave', 'ruin', 'fort', 'wreck']);
export const forestAt = i => K().biome[i] === 6;
export const deepForest = i => forestAt(i) && NBR[i].filter(forestAt).length >= 4;
export function concealment(w) {
  if (w.captive || w.over || (w.exposedH || 0) > worldHourOf(w)) return null;
  if (lodgedHere(w)) return 'village';
  if (w.den != null && w.den === w.pos) return 'den';
  const ci = campInfo(w);
  if (forestAt(w.pos) && w.party.length + (w.bound ? 1 : 0) <= 3 && !w.mules && !(w.horses > 0) && !w.guard && !w.escort && !(ci && ci.fire)) return deepForest(w.pos) ? 'deep' : 'forest';
  return null;
}
export const hidden = w => !!concealment(w);
export const HIDE_NAME = {village: '藏在村民家', den: '躲在洞裡', forest: '躲在林子裡', deep: '躲在深林裡'};
// 洞裡的東西：每六小時可能找上門（沒探索過的比較危險）
function denRisk(w) {
  if (concealment(w) !== 'den' || bandAt(w, w.pos)) return;
  const p = poiAt(w, w.pos); if (!p) { w.den = null; return; }
  if (rngNext(w) >= (poiDone(w, p) ? 0.04 : 0.12)) return;
  const beast = p.type === 'cave' || p.type === 'wreck';
  makeBand(w, beast ? 'wolves' : 'bandits', w.pos, beast ? {ttl: 1} : {str: 70 + K().bandit[w.pos], name: '躲在裡面的逃兵', ttl: 1});
  say(w, beast ? `${POI_TYPES[p.type].n}深處有東西醒了。` : `${POI_TYPES[p.type].n}裡還躲著別人。`);
}
// 鬧出動靜（打劫、襲擊、單挑）：半天之內藏不住
export const expose = (w, h = 6) => { w.exposedH = Math.max(w.exposedH || 0, worldHourOf(w) + h); };
// 搜索：跟探索興趣點同一套，只是找的是藏起來的人。機會看對方怎麼藏、幾個人、有沒有帶馬，以及搜的人
export function findOdds(searcher, kind, size, horses) {
  const base = {village: 0.05, den: 0.35, forest: 0.35, deep: 0.15}[kind] ?? 0;
  const hunter = searcher.party.some(m => (m.tags || []).includes('獵戶') || m.traits.includes('tracker'));
  return Math.max(0.05, Math.min(0.85, base + Math.max(0, size - 1) * 0.06 + (horses ? 0.15 : 0) + (hunter && kind !== 'village' ? 0.15 : 0) + Math.min(0.12, (searcher.party.length - 1) * 0.03)));
}
export function hideRate(w) { const wm = Math.max(0, ...Object.values(w.wanted || {})); return 1 + wm / 2; }
export function hideCharge(w) {
  if (!lodgedHere(w)) { w.lodged = null; return; }
  const now = worldHourOf(w); if (w.hideAt == null) { w.hideAt = now; w.hideT0 = now; return; }
  const dt = Math.max(0, now - w.hideAt) / 24, t = Math.max(0, w.hideAt - w.hideT0) / 24; w.hideAt = now; if (!dt) return;
  const cost = hideRate(w) * (dt + ((t + dt) ** 2 - t ** 2) / 2), have = favorAt(w, w.pos);
  if (cost >= have) { addFavor(w, w.pos, -have); w.lodged = null; w.hideAt = w.hideT0 = null; say(w, `${nm(w.pos)}的人情用完了，村民不敢再藏你們，請你們離開。`); }
  else addFavor(w, w.pos, -cost);
}
// 接濟村子：給口糧、成包的貨或錢換人情。看東西值多少、當地缺不缺；欠你越多，再給換到的越少
export function giftFavor(w, v, value, need = 1) { return value / 40 * need / (1 + favorAt(w, v) / 8); }
export function foodNeed(v, k = K()) { const m = k.mkt[v]; if (!(m >= 0 && k.markets[m])) return 1; return Math.max(0.7, Math.min(2.5, basePrice(m, 'food', k) / (C.BASEP.food * COINP))); }
// 村子的請託：每個村子一週換一次；錢少，主要換人情
export const PLEA_NAME = {wolves: '狼害', thugs: '惡霸', missing: '尋人'};
export function villagePleas(w, v) {
  const k = K(), s = siteAt(w, v); if (s?.kind !== 'village') return [];
  w.pleaDay ||= {}; const mine = () => w.contracts.filter(c => c.vill === v && (!c.taken || !c.paid));
  if ((w.pleaDay[v] ?? -99) > w.day - 7) return mine();
  w.pleaDay[v] = w.day;
  const near = []; for (let i = 0; i < N; i++) if (passable(i) && !isTown(i, k) && hdist(i, v) >= 1 && hdist(i, v) <= 3 && !siteAt(w, i)) near.push(i);
  if (!near.length) return mine();
  const add = (kind, target, title, reward, favor) => w.contracts.push({id: 'k' + w.nextId++, kind, town: v, vill: v, target, title, reward, favor, until: w.day + 10, taken: false, done: false});
  const wild = near.filter(i => k.owner[i] < 0 || k.gameK[i] > 0), rough = near.filter(i => k.bandit[i] > 10);
  if (wild.length && rngNext(w) < 0.6) { const i = rngPick(w, wild); add('wolves', i, `${nm(v)}的羊被咬死了：清掉${nm(i)}的狼群`, 20 + rngInt(w, 20), 2); }
  if (rough.length && rngNext(w) < 0.6) { const i = rngPick(w, rough); add('thugs', i, `趕走在${nm(i)}勒索${nm(v)}村民的惡霸`, 25 + rngInt(w, 25), 3); }
  if (rngNext(w) < 0.5) { const i = rngPick(w, near); add('missing', i, `${nm(v)}有人去${nm(i)}之後就沒回來`, 15 + rngInt(w, 15), 2); }
  return mine();
}
/* ───────────── 主角被打倒：大多是死，值得留活口才會被俘 ───────────── */
// 留活口的機會：聲望越高、看起來越有錢（馬、好裝備），越可能被綁去要贖金
export function worthOf(w) { const h = w.party.find(m => m.hero) || {}; return Math.min(0.7, 0.2 + (w.fame || 0) * 0.03 + ((w.horses || 0) > 0 ? 0.05 : 0) + Object.values(h.eq || {}).filter(Boolean).reduce((s, it) => s + (it.t || 0) + (ITEMS[it.b].v >= 70 ? 1 : 0), 0) * 0.03); }
export const CAPTIVE_DAYS = {bandit: 7, soldier: 4};
function heroDowned(w, setup, out) {
  const k = K(), S = setup.source, h = w.party.find(m => m.hero), b = S.kind === 'band' && w.bands.find(x => x.id === S.ref);
  const c = S.kind === 'contract' && w.contracts.find(x => x.id === S.ref);
  const beast = (b && b.kind === 'wolves') || S.kind === 'poi' || (c && (c.kind === 'wolves' || c.wasMissing));
  if (b) w.bands = w.bands.filter(x => x !== b);
  w.camp = null; if (w.escort) failEscort(w, '主角倒下，商隊的貨被搶光，');
  w.fame = Math.max(0, (w.fame || 0) - 0.5);
  const soldier = (b && b.kind === 'soldiers') || S.kind === 'raid' || (c && c.kind === 'merc');
  const die = () => { w.over = {day: w.day, where: setup.title}; w.party = w.party.filter(m => !m.hero); out.lines.push(`${h.name}倒下了，再也沒有起來。`); };
  if (beast) {   // 野獸不抓人：還有同伴活著，就可能把主角拖回來
    const mates = companions(w), save = mates.length ? 0.5 * Math.min(1, mates.reduce((s, m) => s + m.loyalty, 0) / mates.length / 100) : 0;
    if (rngNext(w) >= save) return die();
    if (load(w) > 0) loseCargo(w, 1, '', '倒下時丟下的');
    out.lines.push(`${h.name}倒在血泊裡，同伴拚死把他拖了回來。貨都丟在原地，總算撿回一條命。`); return;
  }
  if (!soldier && rngNext(w) >= worthOf(w)) return die();   // 盜匪（和失手的襲擊）只留值錢的活口
  if (S.kind === 'pvp') { out.lines.push(`${h.name}被打倒，對方繳了械，把你們趕走了。`); return; }
  const fac = b ? b.fac : S.kind === 'raid' ? S.fac : c && c.kind === 'merc' ? c.enemy : -1;
  const by = soldier && fac >= 0 ? `${facName(fac)}的官兵` : setup.title.replace(/^與|單挑$/g, '');
  const took = Math.round(w.gold * 0.8); w.gold -= took;
  if (load(w) > 0) loseCargo(w, 1, '', null);
  let gear = ''; const best = ['a', 'w', 's', 't'].filter(s => h.eq?.[s]).sort((x, y) => ITEMS[h.eq[y].b].v * (1 + (h.eq[y].t || 0)) - ITEMS[h.eq[x].b].v * (1 + (h.eq[x].t || 0)))[0];
  if (best) { gear = itemName(h.eq[best]); h.eq[best] = null; } if (w.pack?.length) { gear += (gear ? '、' : '') + '行囊裡的裝備'; w.pack = []; }
  const ransom = soldier ? fineOf(w, fac) + 60 : 40 + h.lvl * 15 + Math.round((w.fame || 0) * 8);
  w.captive = {by, soldier, fac, ransom, day: w.day, tries: 0, lastTry: -1};
  out.lines.push(`${h.name}被打倒，醒來時已經被${by}綁著${soldier ? '，關進了牢裡' : '，他們要贖金'}。身上的錢${took ? `（${took} 金幣）` : ''}、貨${gear ? '和' + gear : ''}都被拿走了。`);
  k.ev.push({y: k.curY, type: 'bandit', text: `${MODE.bandName}的首領在${nm(w.pos)}被${by}俘虜了。`, tile: w.pos, ts: k.stamp});
}
// 被關著：時間到了對方就放人（盜匪榨乾了你、官府關夠了）
function captiveCheck(w) {
  const c = w.captive; if (!c) return;
  if (w.day - c.day >= CAPTIVE_DAYS[c.soldier ? 'soldier' : 'bandit']) {
    if (c.soldier) { if (c.fac >= 0) w.wanted[c.fac] = (w.wanted[c.fac] || 0) / 2; say(w, `關滿了日子，${c.by}把你們放了出來。`); }
    else { w.gold = 0; say(w, `${c.by}榨不出更多的錢，把你們丟在荒野裡。`); }
    w.captive = null;
  }
}
export const escapeOdds = w => { const h = w.party.find(m => m.hero), c = w.captive; return Math.max(0.1, Math.min(0.8, 0.25 + (h?.spd || 5) * 0.01 + (w.party.length - 1) * 0.06 - (c?.tries || 0) * 0.05)); };
const CAPTIVE_OK = new Set(['payRansom', 'favorRansom', 'escape', 'waitCaptive', 'eat', 'release']);
/* ───────────── 單挑與俘虜 ───────────── */
// 拔掉一座山寨：賞金、名聲、委託完成、寨裡的寶物。單挑贏的話嘍囉帶著東西散了，搜到的少一些
function breakGang(w, g, out, mul) {
  const k = K();
  out.loot = Math.round((100 + (g.loot || 0) * 2 + g.str * 0.4 + rngInt(w, 60)) * mul);
  g.gone = 1; g.to = undefined; w.fame = (w.fame || 0) + 2; k.bandit[g.lair] *= 0.25; for (const n of NBR[g.lair]) k.bandit[n] *= 0.4;
  k.ev.push({y: k.curY, type: 'bandit', text: mul < 1 ? `${MODE.bandName}的首領單挑擊倒了${g.name}，山寨一夜之間散了。` : `${MODE.bandName}攻破了${g.name}的山寨。`, tile: g.lair, ts: k.stamp});
  for (const c of w.contracts) if (c.gang === g.id) { if (c.taken) { c.done = true; out.lines.push(`委託「${c.title}」完成，回${nm(c.town)}（或${facName(k.owner[c.town])}的其他城）領賞。`); } else c.void = true; }
  addFavor(w, g.lair, 4, out);
  for (const wp of k.weapons) if (wp.gang === g.id) {   // 山寨裡藏著的傳奇武器
    wp.gang = 0; wp.holder = 0; wp.fac = -1; wp.lost = false; wp.loc = -1; wp.player = 1;
    wp.hist.push({y: k.curY, t: `${MODE.bandName}攻破${g.name}的山寨，從寨裡搜出了「${wp.name}」。`});
    w.relics.push({id: wp.id, name: wp.name, kind: wp.kind, wins: wp.wins, owners: wp.owners});
    out.lines.push(`在寨子深處搜出一把${wp.kind}——是傳說中的「${wp.name}」！`);
  }
}
// 把打倒的頭目綁起來：押進城交給官府，賞金比較高；路上多吃一份糧，他也可能逃掉或被同夥劫走
function bindChief(w, g, out, name) {
  if (w.bound) { out.lines.push('手上已經押著一個人，這個只好放了。'); return; }
  w.bound = {name: name || `頭目${g.name}`, gang: g ? g.id : 0, value: g ? Math.round(60 + g.str * 0.3) : 40 + rngInt(w, 30), day: w.day};
  out.lines.push(`把${w.bound.name}綁了起來，押進城可以換賞金。`);
}
// 對方接不接戰帖：聲望越高越不敢拒絕；人多勢眾的一方懶得跟你單挑
export function duelOdds(w, foes) {
  const mine = partyPower(battleParty(w)), theirs = partyPower(foes);
  return Math.max(0.1, Math.min(0.95, 0.35 + (w.fame || 0) * 0.06 + (mine / Math.max(1, theirs) - 1) * 0.4));
}
const leaderOf = foes => foes.find(f => f.leader) || foes.slice().sort((a, b) => partyPower([b]) - partyPower([a]))[0];
export function duelTarget(w) {
  const k = K(), b = bandAt(w, w.pos);
  if (b && b.kind === 'bandits') return {band: b, foes: b.foes, leader: leaderOf(b.foes), asked: !!b.duelAsked, name: b.name};
  const g = gangAt(w.pos, k); if (g) return {gang: g, leader: {name: `頭目${g.name}`}, asked: (w.duelNo || {})[g.id] === w.day, name: `${g.name}的山寨`, odds: Math.max(0.1, Math.min(0.9, 0.2 + (w.fame || 0) * 0.06))};
  return null;
}
function duelOutcome(w, setup, bst, out) {
  const k = K(), S = setup.source, foe = bst.units.find(u => u.side === 'enemy'), hero = bst.units.find(u => u.hero);
  const b = S.band && w.bands.find(x => x.id === S.band), g = S.gang && k.gangs.find(x => x.id === S.gang);
  if (bst.result === 'win') {
    w.fame = (w.fame || 0) + (g ? 1 : 0.5);
    if (b) { out.loot = b.loot; w.bands = w.bands.filter(x => x !== b); out.lines.push(`${foe.name}倒下了，${b.name}一哄而散。`); if (b.gang) { const gg = k.gangs.find(x => x.id === b.gang); if (gg && !gg.gone) gg.str *= 0.9; } k.bandit[w.pos] *= 0.7; }
    if (g) breakGang(w, g, out, 0.6);
    if (!foe.alive) bindChief(w, g, out, g ? null : `${b?.name || '盜匪'}的頭目${foe.name}`);
    battleLoot(w, bst, setup.foes, out);
    w.gold += out.loot || 0;
    out.lines.unshift(`單挑贏了。${out.loot ? `搜到 ${out.loot} 金幣。` : ''}`);
  } else {
    w.fame = Math.max(0, (w.fame || 0) - (hero.yielded ? 0.2 : 0.4));
    out.lines.unshift(hero.yielded ? `${hero.name}被打倒在地，認輸了。` : `${hero.name}退出了單挑，旁觀的人噓聲一片。`);
    if (b) { const t = tollOf(w);
      if (t.cargo) { loseCargo(w, 0.5, `${b.name}拿走了一半的貨：`, null); out.lines.push('照規矩，他們搬走了一半的貨。'); }
      else if (t.gold && w.gold >= t.gold) { w.gold -= t.gold; out.lines.push(`照規矩，交出了 ${t.gold} 金幣。`); }
      else if (t.escort) { failEscort(w, `${b.name}劫走了護送的貨，`); }
      w.bands = w.bands.filter(x => x !== b); }
  }
}
export function applyBattle(w, setup, bst) {
  const out = {lines: [], loot: 0}, k = K();
  const units = new Map(bst.units.map(u => [u.id, u]));
  const gIds = new Set((w.guard?.men || []).map(m => m.id));
  let downed = false;
  const villain = setup.duel && setup.source.gang && (K().gangs.find(g => g.id === setup.source.gang)?.str || 0) > 260;   // 惡名昭彰的頭目可能不守規矩
  for (const u of bst.units) if (u.hero && !u.alive) { if (villain && rngNext(w) < 0.15) { downed = true; continue; } u.alive = true; u.hp = 1; if (setup.duel) u.yielded = true; else downed = true; }   // 主角倒下不會死：單挑就是認輸，其他是被俘
  for (const m of w.party.slice()) {
    const u = units.get(m.id); if (!u) continue;
    if (!u.alive) {
      if (m.hero) { m.hp = 1; continue; }   // 主角的下場在 heroDowned 決定
      w.party = w.party.filter(x => x !== m);
      heroGone(w, m, `隨一支戰幫戰死於${setup.title}`, true);
      w.fallen.push({name: m.name, cls: m.cls, day: w.day, how: u.captured ? '撤退時被俘' : `戰死於${setup.title}`, kills: (m.deeds?.kills || 0) + u.kills});
      out.lines.push(u.captured ? `${m.name}沒能撤出來，被敵人帶走了。` : `${m.name}倒下了，再也沒有起來。`);
      continue;
    }
    const bo = gearBonus(w, m); if (setup.camp && setup.camp.side === 'ally') bo.def = (bo.def || 0) + (setup.camp.def || 0);
    for (const kk of ['hp', 'max', 'str', 'skl', 'spd', 'def', 'lvl', 'exp']) m[kk] = u[kk] - (bo[kk] || 0) - (u.gearAdd?.[kk] || 0);
    m.deeds = m.deeds || {battles: 0, kills: 0}; m.deeds.battles++; m.deeds.kills += u.kills;
    if (u.levels.length && !m.hero) m.wage = wageOf(m);
    w.kills += u.kills;
  }
  if (w.guard) { w.guard.men = w.guard.men.filter(m => { const u = units.get(m.id); if (!u) return true; m.hp = u.hp; m.exp = u.exp; return u.alive; }); if (!w.guard.men.length) { out.lines.push(`${w.guard.name}的人全倒下了。`); w.guard = null; } }
  const deaths = bst.units.filter(u => u.side === 'ally' && !u.alive && !u.hero && !gIds.has(u.id)).length;
  const hero = bst.units.find(u => u.hero);
  if (downed) { heroDowned(w, setup, out); w.pendingBattle = null; trimCargo(w); for (const l of out.lines) say(w, l); return out; }
  if (setup.duel) { duelOutcome(w, setup, bst, out); w.pendingBattle = null; trimCargo(w); for (const l of out.lines) say(w, l); return out; }
  if (bst.result === 'win') {
    const fled = bst.units.filter(u => u.side === 'enemy' && u.fled).length;
    if (setup.source.kind !== 'pvp') battleLoot(w, bst, setup.foes, out);
    if (setup.source.kind === 'poi') { grantLoot(w, setup.source.loot, out); w.fame = (w.fame || 0) + 0.3; }
    else if (setup.source.kind === 'pvp') { w.fame = (w.fame || 0) + 0.3; }
    else if (setup.source.kind === 'raid') {
      const k = K(), S = setup.source, list = S.what === 'caravan' ? k.caravans : k.carts, got = {};
      const hit = list.filter(c => c.wait <= 0 && c.path[c.pos] === w.pos && c.to === S.to);
      for (const c of hit) { if (S.what === 'caravan') got[c.g] = (got[c.g] || 0) + c.amt / BALE; else for (const g of GOODS) got[g] = (got[g] || 0) + c.goods[g] / BALE; }
      const keep = list.filter(c => !hit.includes(c)); list.splice(0, list.length, ...keep);
      k.bandit[w.pos] = Math.min(100, k.bandit[w.pos] + 6);
      let room = capacity(w) - load(w); const took = [];
      for (const g of GOODS.slice().sort((a, b) => C.BASEP[b] - C.BASEP[a])) { const q = Math.min(room, Math.floor(got[g] || 0)); if (q > 0) { w.cargo[g] += q; room -= q; took.push(`${GN[g]} ${q} 包`); } }
      out.loot = S.what === 'caravan' ? 30 + rngInt(w, 50) : rngInt(w, 15);
      w.wanted = w.wanted || {}; const told = S.fac >= 0 && fled > 0; if (told) w.wanted[S.fac] = (w.wanted[S.fac] || 0) + (S.what === 'caravan' ? 3 : 1.5);
      k.ev.push({y: k.curY, type: 'bandit', text: `一夥人在${nm(w.pos)}劫了往${nm(S.to)}的${S.what === 'caravan' ? '商隊' : '運貨車'}。`, tile: w.pos, ts: k.stamp});
      out.lines.push(took.length ? `搶下了${took.join('、')}${room <= 0 ? '，扛不動的只好丟在路邊' : ''}。` : '車上的東西扛不走，只拿了些錢。');
      if (told) out.lines.push(`有人逃回去報信，${k.fac[S.fac]?.n}開始通緝你們。`); else if (S.fac >= 0) out.lines.push('沒有活口回去報信，沒人知道是誰幹的。');
      for (const m of companions(w)) if (m.traits.includes('loyal') || m.traits.includes('guardian')) m.loyalty -= 6;
      if (S.what === 'cart' && favorAt(w, w.pos) > 0) { addFavor(w, w.pos, -Math.min(3, favorAt(w, w.pos))); out.lines.push(`劫的是村民的收成，${nm(regionOf(w.pos))}一帶的人不會再把你們當自己人。`); }
    } else if (setup.source.kind === 'contract') {
      const c = w.contracts.find(x => x.id === setup.source.ref), k = K();
      if (c) { c.done = true; if (c.wasMissing) { c.kind = 'missing'; say(w, `趕跑了狼，在${nm(w.pos)}找到了${nm(c.vill)}失蹤的人。`); } w.fame = (w.fame || 0) + (c.kind === 'merc' ? 1 : c.vill ? 0.2 : 0.5); out.lines.push(c.vill ? `「${c.title}」辦好了，回${nm(c.vill)}說一聲。` : `委託「${c.title}」完成，回${nm(c.town)}（或${facName(k.owner[c.town])}的其他城）領賞。`);
        if (c.kind === 'merc') { const a = Math.min(c.fac, c.enemy), b = Math.max(c.fac, c.enemy), Wr = k.war[a][b]; if (Wr) Wr.score = (Wr.score || 0) + (Wr.att === c.fac ? 2 : -2);
          k.ev.push({y: k.curY, type: 'war', text: `一支傭兵戰幫替${k.fac[c.fac].n}在${nm(w.pos)}擊潰了${k.fac[c.enemy].n}的守軍。`, tile: w.pos, ts: k.stamp}); }
        else { k.game[w.pos] *= 0.5; } }
      out.loot = c && c.kind === 'merc' ? 30 + rngInt(w, 40) : 0;
    } else if (setup.source.kind === 'band') {
      const b = w.bands.find(x => x.id === setup.source.ref); out.loot = b ? b.loot : 0; w.bands = w.bands.filter(x => x !== b);
      if (b && b.gang) { const g = k.gangs.find(x => x.id === b.gang); if (g && !g.gone) { k.bandit[g.lair] *= 0.85; g.loot = (g.loot || 0) * 0.8; } }
      if (b && b.kind === 'bandits') { k.bandit[w.pos] *= 0.7; if (k.owner[w.pos] >= 0) addFavor(w, w.pos, 0.3); }
      if (b && b.kind === 'soldiers' && b.fac >= 0) { if (fled) { w.wanted[b.fac] = (w.wanted[b.fac] || 0) + 2; out.lines.push(`有巡邏兵逃回去報信，${k.fac[b.fac]?.n}的通緝更緊了。`); } else out.lines.push('巡邏兵一個也沒能回去報信。'); }
    } else {
      const g = k.gangs.find(x => x.id === setup.source.ref);
      breakGang(w, g, out, 1);
      const ch = bst.units.find(u => u.side === 'enemy' && u.leader); if (ch && !ch.alive) bindChief(w, g, out);
    }
    w.gold += out.loot;
    for (const m of companions(w)) m.loyalty = Math.min(100, m.loyalty + 4 + (out.loot && m.traits.includes('greedy') ? 3 : 0) - deaths * 4);
    out.lines.unshift(`打贏了${fled ? `（${fled} 個敵人逃走）` : ''}。${out.loot ? `搜到 ${out.loot} 金幣。` : ''}`);
  } else if (bst.result === 'retreat') {
    for (const m of companions(w)) m.loyalty = Math.max(0, m.loyalty - 3 - deaths * 4);
    out.lines.unshift('撤退了。');
    { const S = setup.source, b = S.kind === 'band' && w.bands.find(x => x.id === S.ref), f = S.kind === 'raid' ? S.fac : b && b.kind === 'soldiers' ? b.fac : -1;
      if (f >= 0) { w.wanted = w.wanted || {}; w.wanted[f] = (w.wanted[f] || 0) + (S.kind === 'raid' ? (S.what === 'caravan' ? 3 : 1.5) : 2); out.lines.push(`他們看清了你們的臉，${k.fac[f]?.n}開始通緝你們。`); } }
    if (setup.source.kind === 'band' && w.escort) failEscort(w, '撤退時丟下了商隊，貨被搶光。');
    if (setup.source.kind === 'band') { const b = w.bands.find(x => x.id === setup.source.ref), c = b?.letter && w.contracts.find(x => x.id === b.letter); if (c) { w.contracts = w.contracts.filter(x => x !== c); out.lines.push(`撤退時密信被搶走了，委託「${c.title}」失敗。`); } }
    if (setup.source.kind === 'band') { const b = w.bands.find(x => x.id === setup.source.ref); if (b && b.kind === 'bandits' && load(w) > 0 && !setup.camp) { loseCargo(w, 0.5, '撤退時丟下了', '撤退時丟下的'); out.lines.push('撤退時丟下了一半的貨，散在戰場上。'); } if (b) { b.ttl = 1; b.pos = -1; w.bands = w.bands.filter(x => x !== b); } }
    if (setup.camp && setup.source.kind === 'band') { const b = w.bands.find(x => x.id === setup.source.ref); out.lines.push(defeatStep(w, setup.title, true).text); if (b) w.bands = w.bands.filter(x => x !== b); }
    else { const back = NBR[w.pos].find(p => passable(p) && !bandAt(w, p)); if (back !== undefined) { w.pos = back; w.camp = null; } }
  }
  trimCargo(w);
  w.pendingBattle = null;
  for (const l of out.lines) say(w, l);
  return out;
}

/* ───────────── 紮營 ───────────── */
export const KIT_PRICE = 40, SHIELD_T = 24;   // 被洗劫後的保護時間：24 個時段（遊戲裡 6 天，現實約 48 分鐘）
const hourNow = w => w.day * 24 + w.hour;
const woody = i => [6, 9].includes(K().biome[i]);
const coldNight = w => K().season === 3 || coldAt(w.pos);
export const campHere = w => w.camp && w.camp.pos === w.pos ? w.camp : null;
// 營地現況：紮了多久、有哪些設施；紮滿半天（有工具 6 小時）才算紮穩
export function campInfo(w) { const c = campHere(w); if (!c) return null; const age = hourNow(w) - c.since; return {watch: !!c.watch, stake: !!c.stake, fire: !!c.fire, age, ready: age >= (w.kit ? 6 : 12)}; }
export const campMul = ci => !ci ? 1 : (1.15 + (ci.stake ? 0.3 : 0) + (ci.watch ? 0.1 : 0)) * (ci.ready ? 1 : 0.85);
export const CAMP_OPTS = {
  basic: {n: '紮營', icon: '⛺', d: '清出一塊地、輪流睡。被襲擊時站在營地上比較好守；紮滿半天才算紮穩。'},
  watch: {n: '設哨', icon: '👁', d: '輪班守夜，每天多吃四分之一的糧。敵人摸不上來，只能從遠處衝過來。'},
  stake: {n: '木柵', icon: '🪵', d: '圍一圈木樁，敵人只能從缺口進來；離線時被襲擊也比較守得住。'},
  fire: {n: '營火', icon: '🔥', d: '回血快、大家心情好，冷天不會凍著；但火光從遠處就看得到，盜匪比較容易找上門。'},
};
export function campOptions(w) {
  const k = K(), out = []; if (siteAt(w, w.pos)?.kind === 'town') return out;
  const c = campHere(w), wood = w.cargo.wood || 0, forest = woody(w.pos), cold = coldNight(w);
  const opt = (key, ok, cost, why, hours, woodUse = 0) => out.push({key, ...CAMP_OPTS[key], ok, cost, why, hours, wood: woodUse, on: key === 'basic' ? !!c : !!(c && c[key])});
  opt('basic', !c, '免費・1 小時', c ? '已經紮好營了' : '', 1);
  opt('watch', !(c && c.watch), '每天多吃 1/4 的糧', c && c.watch ? '已經排好班了' : '', 1);
  const sw = w.kit ? 1 : 2, sh = forest ? (w.kit ? 2 : 4) : (w.kit ? 1 : 2), canS = forest || wood >= sw;
  opt('stake', !(c && c.stake) && canS, forest ? `就地砍樹・${sh} 小時` : `木材 ${sw} 包・${sh} 小時`, c && c.stake ? '已經圍好了' : canS ? '' : `要 ${sw} 包木材，或在林地紮營`, sh, forest ? 0 : sw);
  const fw = cold && !forest ? 1 : 0, canF = wood >= fw;
  opt('fire', !(c && c.fire) && canF, fw ? '木材 1 包（天冷，要燒很多柴）' : '撿柴就好・1 小時', c && c.fire ? '火已經生起來了' : canF ? '' : '天冷要 1 包木材當柴', 1, fw);
  void k; return out;
}
// 旗子：掛了某國的旗，在跟它交戰的國家境內就是敵人
const atWarF = (a, b) => { const k = K(); return a >= 0 && b >= 0 && a !== b && !!k.war[Math.min(a, b)][Math.max(a, b)]; };
export const hostileBanner = (w, f) => w.banner != null && atWarF(f, w.banner);
export const hireFee = (w, r) => Math.round(r.wage * 2 * (w.banner != null && w.banner === K().owner[w.pos] ? 0.8 : 1));
export const rewardOf = (w, c) => Math.round(c.reward * (c.kind === 'merc' && w.banner != null && w.banner === c.fac ? 1.25 : 1));
// 打輸了防守戰：照順序掉——貨、錢、營地設施、人；主角不會在防守戰裡死
export function defeatStep(w, by, quiet) {
  const res = {cargo: {}, gold: 0, text: ''};
  if (load(w) > 0) { for (const g of TRADE) { const d = Math.ceil((w.cargo[g] || 0) * 0.5); if (d > 0) { w.cargo[g] -= d; res.cargo[g] = d; } } res.text = `${by}搶走了一半的貨：${Object.entries(res.cargo).map(([g, n]) => `${GN[g]} ${n} 包`).join('、')}。`; }
  else if (w.gold >= 60) { res.gold = Math.round(w.gold * 0.4); w.gold -= res.gold; res.text = `${by}搜走了 ${res.gold} 金幣。`; }
  else if (w.camp && (w.camp.stake || w.camp.watch)) { const key = w.camp.stake ? 'stake' : 'watch'; w.camp[key] = false; res.text = `${by}${key === 'stake' ? '拆了營地的木柵' : '打散了守夜的人'}。`; }
  else if (companions(w).length) {
    const m = rngPick(w, companions(w)); w.party = w.party.filter(x => x !== m); trimCargo(w); res.lost = m.name;
    if (rngNext(w) < 0.5) { heroGone(w, m, null); res.text = `${m.name}在混亂中逃散了。`; }
    else { (w.captives ||= []).push({m, by, price: Math.max(40, (m.wage || 10) * 4), day: w.day}); res.text = `${m.name}被${by}抓走了；到城裡的酒館可以托人贖回來。`; }
  } else res.text = `${by}翻遍了行囊，什麼也沒找到，罵罵咧咧地走了。`;
  if (!quiet) say(w, res.text); return res;
}
function banditFoes(w, str) { const n = Math.min(6, 2 + Math.floor(str / 120) + rngInt(w, 2)), l = bandLvl(w, str), f = []; for (let i = 0; i < n; i++) f.push(makeMember(w, rngPick(w, ['bandit', 'bandit', 'cutthroat', 'poacher']), l)); return f; }
// 沒人指揮的防守戰：直接用數字算
export function autoDefend(w, foePower, by) {
  const ci = campInfo(w), mine = partyPower(battleParty(w)) * campMul(ci), p = mine / (mine + foePower);
  const win = rngNext(w) < Math.max(0.05, Math.min(0.95, 0.5 + (p - 0.5) * 2.2));
  for (const m of w.party) m.hp = Math.max(1, Math.round(m.hp - m.max * (win ? 0.12 : 0.3) * rngNext(w)));
  if (win) { say(w, `${by}趁夜摸上${ci ? '營地' : '你們歇腳的地方'}，被打退了。`); return {win: true, text: `擊退了${by}。`}; }
  return {win: false, ...defeatStep(w, by)};
}
// 共享世界：離線的時間（行動點滿了還沒用掉的時數）。糧吃 1/3、餉發一半；城裡付旅店錢；野外可能被夜襲
// 共享世界的時鐘：世界跟著現實走；行動點是戰幫身上「還沒用掉的過去」。
// 戰幫的時間＝世界時間－手上的行動點。行動點滿了以後沒用掉的時間（離線）已由 idle() 結算，這裡把戰幫的日曆跟上。
export function syncClock(w, worldHours) {
  const party = w.day * 24 + w.hour;
  if (w.clockOff == null) { w.clockOff = worldHours - (w.ap || 0) - party; return 0; }
  const jump = Math.floor(worldHours - (w.ap || 0) - w.clockOff - party); if (jump <= 0) return 0;
  const days = Math.floor((w.hour + jump) / 24); w.hour = (w.hour + jump) % 24; w.day += days;
  w.nextWage += days;   // 離線那幾天的餉已經照離線規則發過一半了
  return jump;
}
export function idle(w, hours, T) {
  const k = K(), rep = {hours: 0, food: 0, gold: 0, raids: []}; let town = siteAt(w, w.pos)?.kind === 'town';
  if (w.lodged !== w.pos) w.lodged = null;
  w.idleBuf = (w.idleBuf || 0) + Math.min(hours, 24 * 30);
  const due = companions(w).reduce((s, m) => s + m.wage, 0);
  while (w.idleBuf >= 6) {
    w.idleBuf -= 6; rep.hours += 6; let hungry = false, cost = due / 168 * 6 / 2; w.fatigue = Math.max(0, (w.fatigue || 0) - 12);
    if (lodgedHere(w) && favorAt(w, w.pos) > 0) { rep.lodged = true; for (const m of w.party) m.hp = Math.min(m.max, m.hp + Math.ceil(m.max * 0.4 * 6 / 24)); w.idleCost = (w.idleCost || 0) + cost; const pay = Math.floor(w.idleCost); if (pay && w.gold >= pay) { w.gold -= pay; rep.gold += pay; w.idleCost -= pay; } continue; }
    if (town) { cost += w.party.length * 2 * 6 / 24; for (const m of w.party) m.hp = Math.min(m.max, m.hp + Math.ceil(m.max * 0.5 * 6 / 24)); }
    else { const need = eaters(w) / 24 * 6 / 3; if (w.food >= need) { w.food -= need; rep.food += need; } else { w.food = 0; hungry = true; } if (!hungry) for (const m of w.party) m.hp = Math.min(m.max, m.hp + Math.ceil(m.max * 0.1 * 6 / 24)); }
    w.idleCost = (w.idleCost || 0) + cost; const pay = Math.floor(w.idleCost);
    if (pay) { if (w.gold >= pay) { w.gold -= pay; rep.gold += pay; w.idleCost -= pay; } else { rep.gold += w.gold; w.gold = 0; w.idleCost = 0; hungry = true; } }
    if (hungry) for (const m of companions(w)) m.loyalty -= m.traits.includes('loyal') ? 1 : 2;
    desertCheck(w);
    if (!town && !w.captive && (w.shieldT || 0) <= T && !(w.idleRaid > 0)) {
      const ci = campInfo(w), cv = concealment(w), base = cv === 'den' ? (poiDone(w, poiAt(w, w.pos) || {}) ? 0.04 : 0.12) : Math.min(0.12, tileRisk(w.pos, k) * 0.15 + (load(w) > 0 ? 0.02 : 0)) * (cv ? 0.2 : 1);
      if (rngNext(w) < base * (ci ? (ci.watch ? 0.5 : 1) * (ci.fire ? 1.4 : 1) * (ci.stake ? 0.8 : 1) : 1.6)) {
        const near = k.gangs.filter(g => !g.gone && hdist(g.lair, w.pos) <= 4)[0], by = near ? `${near.name}的人` : '一夥盜匪';
        const r = autoDefend(w, partyPower(banditFoes(w, near ? near.str : 60 + k.bandit[w.pos])), by); rep.raids.push(r.text);
        w.idleRaid = r.win ? 1 : 3;
      }
    } else if (w.idleRaid > 0) w.idleRaid--;
  }
  if (rep.hours >= 24) say(w, `離開的這段時間（約 ${Math.round(rep.hours / 24)} 天），${town ? '住在旅店' : rep.lodged ? `借住在${nm(w.pos)}的村民家` : '在原地等著'}，${rep.food ? `吃掉 ${Math.round(rep.food)} 份糧、` : ''}花掉 ${rep.gold} 金幣。`);
  return rep;
}

/* ───────────── 急行軍 ───────────── */
export const tired = w => (w.fatigue || 0) > 0;
// 急行軍的每一小時：全隊扣血、傭兵心浮氣躁、騾子可能倒下、馬可能跛腳
function marchHour(w) {
  w.fatigue = Math.min(96, (w.fatigue || 0) + 1);
  for (const m of w.party) m.hp = Math.max(1, m.hp - m.max * 0.006);
  for (const m of companions(w)) m.loyalty -= m.traits.includes('coward') || m.traits.includes('greedy') ? 0.2 : 0.1;
  for (let i = 0; i < w.mules; i++) if (rngNext(w) < 0.003) { w.mules--; say(w, `一頭騾子在${nm(w.pos)}口吐白沫，倒下就再也沒起來。`); trimCargo(w); break; }
  if ((w.horses || 0) > 0 && rngNext(w) < 0.0015 * w.horses) { w.horses--; say(w, '一匹馬跛了腳，只好放牠走。'); }
}

/* ───────────── 地上的貨（丟下的、散落的） ───────────── */
// 單人：存在 w.caches；共享世界：伺服器把共用的陣列掛在 w.caches 上（所有人看到同一份）
const ROT = {food: 0.25, wood: 0.01, stone: 0, iron: 0.01, salt: 0.02, fur: 0.04, wine: 0.02, fish: 0.12, gem: 0};   // 每天爛掉的比例
export const cachesAt = (w, i) => (w.caches || []).filter(c => c.tile === i && cacheTotal(c) > 0);
export const cacheTotal = c => Object.values(c.goods).reduce((s, v) => s + Math.floor(v), 0) + (c.items || []).length;
export function addCache(w, tile, goods, why, items) {
  const list = (w.caches ||= []); let c = list.find(x => x.tile === tile);
  if (!c) { c = {id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), tile, goods: {}, why, day: w.day ?? 0}; list.push(c); }
  for (const [g, n] of Object.entries(goods)) if (n > 0) c.goods[g] = (c.goods[g] || 0) + n;
  if (items?.length) (c.items ||= []).push(...items);
  c.why = why || c.why; return c;
}
// 時間過去：貨會爛；離村子、城近的會被人撿走（撿走的算進最近的市集存貨）
export function decayCaches(list, days) {
  const k = K();
  for (const c of list) {
    const near = k.owner[c.tile] >= 0 && [c.tile, ...NBR[c.tile]].some(n => k.pop[n] >= 8 || k.markets[n]);
    for (const g of Object.keys(c.goods)) {
      const rot = c.goods[g] * (1 - Math.exp(-(ROT[g] || 0.02) * days)), take = near ? c.goods[g] * (1 - Math.exp(-0.3 * days)) : 0;
      c.goods[g] = Math.max(0, c.goods[g] - rot - take);
      if (take > 0 && !isSpec(g)) { const m = nearestMarket(c.tile, k); if (m >= 0) k.markets[m].stock[g] += take * BALE; }
    }
    if (c.items?.length) c.items = c.items.filter(() => Math.random() > (near ? 0.25 : 0.03) * days);   // 裝備不會爛，但附近有人的話很快被撿走
  }
  for (let i = list.length - 1; i >= 0; i--) if (cacheTotal(list[i]) <= 0) list.splice(i, 1);
}
function nearestMarket(t, k) { let best = -1, bd = 99; for (const i of Object.keys(k.markets).map(Number)) { if (k.owner[i] < 0) continue; const d = hdist(i, t); if (d < bd) { bd = d; best = i; } } return bd <= 6 ? best : -1; }
// 沙盒裡的劫案：劫匪帶不走的貨散落在原地；被盜匪盯上的商隊偶爾丟下一部分貨逃命
export function simCaches(list, evs, rand, day) {
  const k = K(), W = {caches: list, day};
  for (const e of evs || []) {
    if (e.type !== 'bandit' || e.tile == null || e.tile < 0 || !/劫/.test(e.text) || !passable(e.tile)) continue;
    const g = GOODS.find(x => e.text.includes(GN[x])) || rngPickR(rand, GOODS);
    addCache(W, e.tile, {[g]: 3 + Math.floor(rand() * 8)}, '被劫的商隊散落的');
  }
  for (const c of k.caravans || []) {
    if (c.wait > 0) continue; const i = c.path[c.pos]; if (i == null || k.bandit[i] < 50 || rand() > 0.004) continue;
    const q = Math.max(1, Math.round(c.amt / BALE * (0.1 + rand() * 0.15))); c.amt = Math.max(0, c.amt - q * BALE);
    addCache(W, i, {[c.g]: q}, '商隊逃命時丟下的');
  }
  if (list.length > 300) list.splice(0, list.length - 300);
}
const rngPickR = (rand, arr) => arr[Math.floor(rand() * arr.length)];

/* ───────────── 採集 ───────────── */
// 選項依這一格的地形與沙盒裡的資源出現：打獵（獵物）、伐木（林木）、採石（丘陵山地）、挖礦（礦脈）、曬鹽（海岸鹽地）
export const GATHER = {
  hunt: {n: '打獵', icon: '🏹', d: '口糧，運氣好有毛皮。可能驚動狼群或熊。'},
  chop: {n: '伐木', icon: '🪓', d: '幾包木材。便宜又重，賺不賺看騾子夠不夠。'},
  quarry: {n: '採石', icon: '🪨', d: '幾包石材。'},
  mine: {n: '挖礦', icon: '⛏', d: '少量的鐵。要紮營工具。'},
  salt: {n: '曬鹽', icon: '🧂', d: '一兩包鹽，要花一整天。'},
};
export function gatherOptions(w) {
  const k = K(), i = w.pos, out = []; if (siteAt(w, i)?.kind === 'town') return out;
  const b = k.biome[i], hands = w.party.length, kit = w.kit ? 1.4 : 1, room = capacity(w) - load(w);
  const opt = (key, ok, why, hours, est) => out.push({key, ...GATHER[key], ok: ok && (key === 'hunt' || room > 0), why: ok ? (key === 'hunt' || room > 0 ? '' : '扛不動了') : why, hours, est});
  if (k.gameK[i] > 0) opt('hunt', k.game[i] > 3, '獵物被打光了', 12, `約 ${Math.round(Math.min(k.game[i] * 0.3, 3 + hands * 1.5))} 份口糧`);
  if (k.timber && (k.timber[i] > 8 || b === 6 || b === 9)) opt('chop', k.timber[i] > 8, '樹都砍光了', 12, `約 ${Math.min(Math.floor(k.timber[i] / 6), Math.round((1 + hands * 0.8) * kit))} 包木材`);
  if (b === 3 || b === 4) opt('quarry', true, '', 12, `約 ${Math.round((1 + hands * 0.6) * kit)} 包石材`);
  if (k.vein && k.vein[i] > 0 && (k.known[i] || w.kit)) opt('mine', !!w.kit, '要紮營工具才挖得動', 12, `約 ${1 + Math.floor(hands / 3)} 包鐵`);
  const sk = C.WS.saltK ? C.WS.saltK[i] : 0; if (sk > 0.5) opt('salt', true, '', 24, `約 ${Math.max(1, Math.round(hands * 0.35 * sk))} 包鹽`);
  return out;
}
// 在有主的土地上採：盜伐、盜獵。附近有巡邏隊就很容易被撞見
function poachCheck(w, out) {
  const k = K(), f = k.owner[w.pos]; if (f < 0) return false;
  const near = (w.patrols || []).some(p => p.fac === f && hdist(p.pos, w.pos) <= 2);
  if (rngNext(w) > (near ? 0.45 : 0.08)) return false;
  w.wanted = w.wanted || {}; w.wanted[f] = (w.wanted[f] || 0) + 1;
  out.lines.push(`被${facName(f)}的巡守撞見了：這是${facName(f)}的地，你們在盜採。`); say(w, `在${nm(w.pos)}盜採時被${facName(f)}的巡守撞見，被記上一筆。`);
  return true;
}
function gather(w, kind, out) {
  const o = gatherOptions(w).find(x => x.key === kind); if (!o) throw new Error('這裡不能這樣採'); if (!o.ok) throw new Error(o.why);
  const k = K(), i = w.pos, hands = w.party.length, kit = w.kit ? 1.4 : 1, luck = 0.7 + rngNext(w) * 0.6;
  passHours(w, o.hours, 'camp', out); if (w.over || out.encounter) return;
  const caught = poachCheck(w, out), keep = caught ? 0.5 : 1, got = {};
  if (kind === 'hunt') {
    const n = Math.max(1, Math.round(Math.min(k.game[i] * 0.3, 3 + hands * 1.5) * luck * keep)); k.game[i] = Math.max(0, k.game[i] - n * 0.25); w.food += n; got.food = n;
    if (rngNext(w) < 0.2 + k.game[i] / 250 && capacity(w) > load(w)) { w.cargo.fur = (w.cargo.fur || 0) + 1; got.fur = 1; }
    if (rngNext(w) < 0.12) { const b = makeBand(w, 'wolves', i, {ttl: 1}); out.encounter = b.id; out.lines.push('血腥味引來了狼群！'); }
  } else {
    let g, n;
    if (kind === 'chop') { g = 'wood'; n = Math.min(Math.floor(k.timber[i] / 6), Math.round((1 + hands * 0.8) * kit * luck)); k.timber[i] = Math.max(0, k.timber[i] - n * 0.4); }
    if (kind === 'quarry') { g = 'stone'; n = Math.round((1 + hands * 0.6) * kit * luck); }
    if (kind === 'mine') { g = 'iron'; n = Math.min(Math.floor(k.vein[i]), 1 + Math.floor(hands / 3 * luck)); k.vein[i] = Math.max(0, k.vein[i] - n); if (!k.known[i]) { k.known[i] = 1; k.ev.push({y: k.curY, type: 'econ', text: `一支戰幫在${nm(i)}挖出了鐵礦脈。`, tile: i, ts: k.stamp}); } if (k.vein[i] <= 0.5) { k.vein[i] = 0; k.ev.push({y: k.curY, type: 'econ', text: `${nm(i)}的鐵礦脈被挖空了。`, tile: i, ts: k.stamp}); } }
    if (kind === 'salt') { g = 'salt'; n = Math.max(1, Math.round(hands * 0.35 * (C.WS.saltK[i] || 1) * luck)); }
    n = Math.max(0, Math.min(Math.round(n * keep), capacity(w) - load(w))); w.cargo[g] = (w.cargo[g] || 0) + n; got[g] = n;
  }
  const txt = Object.entries(got).map(([g, n]) => g === 'food' ? `${n} 份口糧` : `${GN[g]} ${n} 包`).join('、') || '什麼也沒有';
  say(w, `在${nm(i)}${GATHER[kind].n}，得到${txt}。`); out.lines.unshift(`${GATHER[kind].n}：得到${txt}。`);
}

/* ───────────── 共享世界：襲擊其他玩家 ───────────── */
// 合不合法：無主之地沒人管；對方掛著與這裡交戰的國旗，或正被通緝，就不算犯法；否則這裡的國家會通緝你
export function raidLegality(w, target) {
  const k = K(), o = k.owner[w.pos];
  if (o < 0) return {ok: true, note: '無主之地，沒人管'};
  if (target.banner != null && atWarF(o, target.banner)) return {ok: true, note: `他們打著敵國${facName(target.banner)}的旗子，${facName(o)}不會追究`};
  if ((target.wantedMax || 0) >= 2) return {ok: true, note: '他們是通緝犯，抓他們不犯法'};
  return {ok: false, fac: o, note: `${facName(o)}會通緝你們`};
}
// 防守方由 AI 操作：營地地形加上一點數值補償
export function pvpSetup(w, target) {
  w.battles++;
  const foes = target.party.map(m => ({...m, id: 'd' + m.id, leader: !!m.hero, hero: false, name: m.name, loyalty: 100}));
  const ci = target.camp, camp = {side: 'enemy', stake: !!(ci && ci.stake), watch: !!(ci && ci.watch), ready: !!(ci && ci.ready), def: 1 + (ci ? (ci.ready ? 1 : 0) : 0)};
  return {seed: hashSeed(w.seed, 'pvp', w.battles), biome: battleBiome(w.pos), foes, camp: ci ? camp : {side: 'enemy', def: 1, open: true}, source: {kind: 'pvp', target: target.id, name: target.name}, title: `${target.name}的戰幫${ci ? '營地' : ''}`};
}

/* ───────────── 行動入口 ───────────── */
export function worldAct(w, a) {
  const out = {lines: []};
  if (w.over) throw new Error('這段旅程已經結束');
  const apNeed = MODE.shared ? apCost(w, a) : 0;
  if (apNeed > (w.ap ?? 0) + 1e-9) throw new Error(`行動點不夠：要 ${apNeed}，剩 ${Math.floor(w.ap ?? 0)}。時間會慢慢補回來${a.type === 'travel' && !w.march ? '；或開急行軍，用更少的行動點走同一段路' : ''}。`);
  w.leads ||= []; if (w.escort === undefined) w.escort = null;
  fixGear(w); guardCheck(w); captiveCheck(w); hideCharge(w);
  if (w.captive && !CAPTIVE_OK.has(a.type)) throw new Error(`你們還被${w.captive.by}關著`);
  const k = K(), here = siteAt(w, w.pos), town = here?.kind === 'town';
  const needTown = () => { if (!town) throw new Error('要在城鎮的市集'); };
  switch (a.type) {
    case 'travel': {   // 只走一格（相鄰）；長途由畫面一格一格呼叫
      if (!NBR[w.pos].includes(a.to) || !passable(a.to)) throw new Error('到不了');
      const h = legHours(w, a.to, k); w.pos = a.to; w.camp = null; w.lodged = null; w.den = null; reveal(w, w.pos, sightOf(w.pos)); passHours(w, h, 'travel', out);
      if (!w.over && !out.encounter) onEnter(w, out);
      if (!out.encounter) { arriveJob(w, out); arrive(w); }
      break;
    }
    case 'rest': {
      const inn = town && a.inn !== false, cost = inn ? w.party.length * 2 * a.days : 0;
      if (cost > w.gold) throw new Error('錢不夠住旅店');
      if (!inn && !campHere(w)) w.camp = {pos: w.pos, since: hourNow(w)};
      w.gold -= cost; passHours(w, a.hours || 24 * a.days, inn ? 'inn' : 'camp', out);
      say(w, inn ? `在旅店休息了 ${a.days} 天（${cost} 金幣）。` : a.hours ? `在營地休息到${HOURS[w.hour]}。` : `紮營休息了 ${a.days} 天。`);
      if (town) arrive(w);
      break;
    }
    case 'buyFood': {
      const pr = rationPrice(w, w.pos); if (!pr) throw new Error('這裡沒有地方買糧');
      let n = a.n;
      if (here?.kind === 'village') { n = Math.min(n, villageFood(w, w.pos)); if (n <= 0) throw new Error('村裡沒糧可賣了'); }
      else n = Math.min(n, Math.floor(k.markets[w.pos].stock.food / BALE * RATIONS_PER_BALE));
      if (n <= 0) throw new Error('市集裡沒糧了');
      const cost = Math.ceil(n * pr); if (cost > w.gold) throw new Error('錢不夠');
      w.gold -= cost; w.food += n;
      if (here.kind === 'village') { w.vill[w.pos] = {food: villageFood(w, w.pos) - n, day: w.day}; const m = k.markets[here.mkt]; if (m) m.stock.food = Math.max(0, m.stock.food - n / RATIONS_PER_BALE * BALE); }
      else k.markets[w.pos].stock.food -= n / RATIONS_PER_BALE * BALE;
      say(w, `買了 ${n} 份口糧（${cost} 金幣）。`);
      break;
    }
    case 'buy': case 'sell': {
      needTown(); const g = a.g, side = a.type; let q = a.q;
      if (side === 'buy') {
        q = Math.min(q, stockBales(w.pos, g, w), capacity(w) - load(w));
        if (q <= 0) throw new Error(capacity(w) - load(w) <= 0 ? '扛不動了：多雇人或買騾子' : '市集裡沒貨了');
        const cost = quote(w, w.pos, g, 'buy', q); if (cost > w.gold) throw new Error('錢不夠');
        w.gold -= cost; w.cargo[g] = (w.cargo[g] || 0) + q; if (isSpec(g)) { w.spec[w.pos + g] = {n: specStock(w, w.pos, g) - q, day: w.day}; } else k.markets[w.pos].stock[g] -= q * BALE; addPress(w, w.pos, g, q);
        w.spent = (w.spent || 0) + cost;
        say(w, `在${nm(w.pos)}買進${GN[g]} ${q} 包，花了 ${cost} 金幣。`);
      } else {
        q = Math.min(q, w.cargo[g] || 0); if (q <= 0) throw new Error('身上沒有這種貨');
        const got = quote(w, w.pos, g, 'sell', q);
        w.gold += got; w.cargo[g] -= q; if (!isSpec(g)) k.markets[w.pos].stock[g] += q * BALE; addPress(w, w.pos, g, -q); w.earned += got;
        say(w, `在${nm(w.pos)}賣出${GN[g]} ${q} 包，得 ${got} 金幣。`);
      }
      noteIntel(w, w.pos, 'seen');
      break;
    }
    case 'deliver': {
      const c = w.contracts.find(x => x.id === a.id && x.kind === 'deliver'); if (!c || c.at !== w.pos) throw new Error('不在收購的城');
      const q = Math.min(c.left, w.cargo[c.g]); if (q <= 0) throw new Error(`身上沒有${GN[c.g]}`);
      const got = q * c.pay; w.cargo[c.g] -= q; c.left -= q; w.gold += got; w.earned += got; k.markets[w.pos].stock[c.g] += q * BALE;
      say(w, `把${GN[c.g]} ${q} 包交給${nm(w.pos)}的官倉，得 ${got} 金幣。`);
      if (c.left <= 0) w.contracts = w.contracts.filter(x => x !== c);
      break;
    }
    case 'search': {   // 照傳聞去找傳奇武器
      const L = w.leads.find(x => x.id === a.id); if (!L) throw new Error('沒有這條線索'); if (hdist(w.pos, L.center) > 1) throw new Error('不在傳聞說的那一帶');
      const wp = k.weapons.find(x => x.id === L.wp); passHours(w, 24, 'camp', out);
      L.searched = [...new Set([...(L.searched || []), w.pos])];
      const spot = wp && wp.lost ? (wp.lake && wp.shore != null ? wp.shore : wp.loc) : -1;
      if (spot !== w.pos || rngNext(w) > (wp.lake ? 0.25 : wp.sealed ? 0.3 : 0.6)) { say(w, `在${nm(w.pos)}找了一整天，什麼也沒找到。`); out.lines.push('找了一整天，什麼也沒找到。'); break; }
      wp.lost = false; wp.lake = false; wp.sealed = false; wp.holder = 0; wp.fac = -1; wp.gang = 0; wp.loc = -1; wp.player = 1;
      wp.hist.push({y: k.curY, t: `失落多年後，${MODE.bandName}在${nm(w.pos)}${spot === wp.shore ? '的水邊' : ''}找到了「${wp.name}」。`});
      w.relics.push({id: wp.id, name: wp.name, kind: wp.kind, wins: wp.wins, owners: wp.owners});
      w.leads = w.leads.filter(x => x !== L); w.fame = (w.fame || 0) + 2;
      say(w, `在${nm(w.pos)}找到了傳說中的「${wp.name}」！`); out.lines.push(`找到了「${wp.name}」！`);
      break;
    }
    case 'explore': {
      const p = poiAt(w, w.pos); if (!p) throw new Error('這裡沒什麼好探索的'); if (poiDone(w, p)) throw new Error('這裡最近才被探索過');
      passHours(w, 12, 'camp', out); if (w.over || out.encounter) break;
      const res = explorePOI(w, p, out); (w.poi ||= {})[p.id] = {day: w.day, by: w.party.find(m => m.hero)?.name};
      say(w, `探索${POI_TYPES[p.type].n}（${nm(w.pos)}）：${res.text}`); out.lines.push(res.text);
      if (res.fight) out.battle = battleSetup(w, 'poi', {p, ...res});
      else { grantLoot(w, res.L, out); for (const l of out.lines.slice(1)) say(w, l); }
      break;
    }
    case 'buyMap': {
      needTown(); if (w.gold < MAP_PRICE) throw new Error('錢不夠');
      w.gold -= MAP_PRICE; reveal(w, w.pos, 6); say(w, `在${nm(w.pos)}買了一張附近的地圖（${MAP_PRICE} 金幣）。`); break;
    }
    case 'equip': {   // 從行囊拿一件裝備給某人（換下來的放回行囊）。不用時間
      const m = w.party.find(x => x.id === a.mid); if (!m || !m.eq) throw new Error('找不到人');
      const it = w.pack.find(x => x.id === a.item); if (!it) throw new Error('行囊裡沒有這件');
      const sl = slotOf(it), I = ITEMS[it.b];
      if (sl === 's' && m.eq.w && ITEMS[m.eq.w.b].h === 2) throw new Error(`${itemName(m.eq.w)}要用雙手，不能配盾`);
      w.pack = w.pack.filter(x => x !== it);
      if (m.eq[sl]) w.pack.push(m.eq[sl]); m.eq[sl] = it;
      if (sl === 'w' && I.h === 2 && m.eq.s) { w.pack.push(m.eq.s); m.eq.s = null; }
      const wo = weaponOf(m); say(w, `${m.name}換上了${itemName(it)}${sl === 'w' && wo.unskilled ? '（不太會用，命中 −15）' : ''}。`); break;
    }
    case 'unequip': {
      const m = w.party.find(x => x.id === a.mid); if (!m?.eq?.[a.slot]) break;
      w.pack.push(m.eq[a.slot]); say(w, `${m.name}卸下了${itemName(m.eq[a.slot])}。`); m.eq[a.slot] = null; break;
    }
    case 'dropItem': {
      const it = w.pack.find(x => x.id === a.item); if (!it) break;
      w.pack = w.pack.filter(x => x !== it); addCache(w, w.pos, {}, '有人丟下的', [it]); say(w, `把${itemName(it)}丟在${nm(w.pos)}。`); break;
    }
    case 'buyItem': {   // 鐵匠鋪
      needTown(); const o = smithStock(w, w.pos).find(x => x.b === a.b && x.t === (a.t || 0)); if (!o) throw new Error('鐵匠沒有這件');
      const it = newItem(w, o.b, o.t), cost = itemPrice(w, w.pos, it); if (cost > w.gold) throw new Error('錢不夠');
      if (capacity(w) - load(w) < itemWeight(it)) throw new Error('行囊放不下了');
      w.gold -= cost; w.pack.push(it); (w.smithSold ||= {})[`${w.pos}:${Math.floor(w.day / 7)}:${o.b}:${o.t}`] = 1;
      say(w, `在${nm(w.pos)}的鐵匠鋪買了${itemName(it)}（${cost} 金幣）。`); break;
    }
    case 'sellItem': {
      needTown(); const it = w.pack.find(x => x.id === a.item); if (!it) throw new Error('行囊裡沒有這件');
      const p = sellPrice(w, w.pos, it); w.pack = w.pack.filter(x => x !== it); w.gold += p; say(w, `把${itemName(it)}賣給鐵匠（${p} 金幣）。`); break;
    }
    case 'upgradeItem': {   // 請鐵匠改良身上的裝備：每級要用掉鐵
      needTown(); const m = w.party.find(x => x.id === a.mid), it = m?.eq?.[a.slot]; if (!it) throw new Error('沒有這件');
      const I = ITEMS[it.b], tier = (it.t || 0) + 1; if (tier > 3 || I.k === 't') throw new Error('已經是最好的了');
      const iron = I.soft || I.wood ? 0 : tier; if (iron && stockBales(w.pos, 'iron') < iron) throw new Error('鐵匠沒鐵了，打不出來');
      const cost = itemPrice(w, w.pos, {b: it.b, t: tier}) - itemPrice(w, w.pos, it); if (cost > w.gold) throw new Error('錢不夠');
      w.gold -= cost; it.t = tier; if (iron) k.markets[w.pos].stock.iron -= iron * BALE;
      say(w, `${nm(w.pos)}的鐵匠把${m.name}的${I.n}改良成${itemName(it)}（${cost} 金幣）。`); break;
    }
    case 'buyHorse': {
      needTown(); if ((w.horses || 0) >= MAX_PARTY) throw new Error('夠多了'); if (w.gold < HORSE_PRICE) throw new Error('錢不夠');
      w.gold -= HORSE_PRICE; w.horses = (w.horses || 0) + 1; say(w, `買了一匹馬（${HORSE_PRICE} 金幣）。${mounted(w) ? '人人有馬，走得快多了。' : `還差 ${w.party.length - w.horses} 匹才能全員騎馬。`}`); break;
    }
    case 'sellHorse': { needTown(); if (!w.horses) throw new Error('沒有馬'); w.horses--; w.gold += Math.round(HORSE_PRICE / 2); say(w, `賣掉一匹馬（${Math.round(HORSE_PRICE / 2)} 金幣）。`); break; }
    case 'hireFamous': {
      needTown(); const h = famousHere(w, w.pos).find(x => x.id === a.id); if (!h) throw new Error('人已經不在了');
      if (w.party.length >= MAX_PARTY) throw new Error(`隊伍最多 ${MAX_PARTY} 人`);
      const o = famousOffer(w, h); if (o.fee > w.gold) throw new Error('錢不夠');
      if ((w.fame || 0) < (h.legend ? 3 : h.famed ? 1 : 0)) throw new Error(`${h.name}看不上沒沒無聞的戰幫`);
      w.gold -= o.fee; const m = hireFamous(w, h); w.party.push(m);
      say(w, `花了 ${o.fee} 金幣，${m.name}答應跟你走${o.relic ? `，還帶著「${o.relic}」` : ''}。`); break;
    }
    case 'equipRelic': {
      const r = w.relics.find(x => x.id === a.id); if (!r) throw new Error('沒有這件東西');
      const order = w.party.map(m => m.id), cur = order.indexOf(r.equip); r.equip = order[(cur + 1) % order.length];
      say(w, `「${r.name}」交給${w.party.find(m => m.id === r.equip).name}佩帶。`); break;
    }
    case 'eat': {   // 拆一包糧當口糧
      if (w.cargo.food <= 0) throw new Error('沒有成包的糧');
      w.cargo.food--; w.food += RATIONS_PER_BALE; say(w, `拆了一包糧，多了 ${RATIONS_PER_BALE} 份口糧。`); break;
    }
    case 'buyMule': {
      needTown(); if (w.mules >= MAX_MULES) throw new Error(`最多 ${MAX_MULES} 頭`); if (w.gold < MULE_PRICE) throw new Error('錢不夠');
      w.gold -= MULE_PRICE; w.mules++; say(w, `買了一頭騾子（${MULE_PRICE} 金幣），能多扛 ${MULE_CAP} 包。`); break;
    }
    case 'sellMule': {
      needTown(); if (!w.mules) throw new Error('沒有騾子'); if (load(w) > capacity(w) - MULE_CAP) throw new Error('先把貨賣掉一些，不然沒地方放');
      w.mules--; w.gold += Math.round(MULE_PRICE / 2); say(w, `賣掉一頭騾子（${Math.round(MULE_PRICE / 2)} 金幣）。`); break;
    }
    case 'rumor': {   // 酒館裡請人喝一輪，聽聽各地的行情
      needTown(); if (w.gold < 3) throw new Error('連一輪酒都請不起'); if (w.rumorDay === w.day && w.rumorAt === w.pos) throw new Error('今天該聽的都聽過了');
      w.gold -= 3; w.rumorDay = w.day; w.rumorAt = w.pos;
      const cand = Object.keys(k.markets).map(Number).filter(i => i !== w.pos && k.owner[i] >= 0 && hdist(i, w.pos) <= 10);
      const heard = [];
      for (let j = 0; j < 3 && cand.length; j++) { const i = cand.splice(rngInt(w, cand.length), 1)[0]; noteIntel(w, i, 'rumor'); heard.push(i); }
      const lines = heard.map(i => { const it = w.intel[i], g = GOODS.slice().sort((a, b) => it.p[b] / (C.BASEP[b] * COINP) - it.p[a] / (C.BASEP[a] * COINP))[0], g2 = GOODS.slice().sort((a, b) => it.p[a] / (C.BASEP[a] * COINP) - it.p[b] / (C.BASEP[b] * COINP))[0];
        return `${nm(i)}（${hdist(i, w.pos)} 格外）${GN[g]}賣得貴，${GN[g2]}便宜`; });
      const fam = Object.keys(k.markets).map(Number).filter(i => k.owner[i] >= 0 && k.markets[i].ratio?.food < 0.8 && hdist(i, w.pos) <= 10);
      if (fam.length) lines.push(`${nm(fam[0])}一帶在鬧饑荒，糧價一定很高`);
      const lost = k.weapons.filter(x => x.lost && x.loc >= 0 && !w.leads.some(L => L.wp === x.id) && hdist(x.loc, w.pos) <= 12);
      if (lost.length && rngNext(w) < 0.4) { const wp = rngPick(w, lost), spot = wp.lake && wp.shore != null ? wp.shore : wp.loc, cand = [spot, ...NBR[spot]].filter(passable), center = rngPick(w, cand.length ? cand : [spot]);
        w.leads.push({id: 'L' + w.nextId++, wp: wp.id, name: wp.name, center, day: w.day});
        lines.push(`有個老人說，傳說中的「${wp.name}」${wp.lake ? '沉在' : wp.sealed ? '封在' : '遺落在'}${nm(center)}一帶${wp.lake ? '的水裡' : wp.sealed ? '的古林深處' : ''}`); }
      out.lines.push(...lines.map(l => '聽說' + l + '。'));
      say(w, `在酒館裡請了一輪酒，打聽到：${lines.join('；')}。`);
      break;
    }
    case 'sellRelic': {
      needTown(); const r = w.relics.find(x => x.id === a.id); if (!r) throw new Error('沒有這件東西');
      const wp = k.weapons.find(x => x.id === r.id), f = k.owner[w.pos], price = relicPrice(w, r);
      w.gold += price; w.relics = w.relics.filter(x => x !== r);
      if (wp) { wp.player = 0; wp.fac = f; wp.hist.push({y: k.curY, t: `${MODE.bandName}把「${wp.name}」賣給了${nm(w.pos)}，${facName(f)}收進了寶庫。`}); }
      say(w, `把「${r.name}」賣給了${nm(w.pos)}的權貴，得 ${price} 金幣。`);
      break;
    }
    case 'hire': {
      if (wantedBy(w, k.owner[w.pos]) >= 3) throw new Error('酒館裡的人一看到你們就走開了');
      needTown(); const t = townState(w, w.pos);
      const r = t.recruits.find(x => x.id === a.id); if (!r) throw new Error('人已經不在了');
      if (w.party.length >= MAX_PARTY) throw new Error(`隊伍最多 ${MAX_PARTY} 人`);
      const fee = hireFee(w, r); if (fee > w.gold) throw new Error('錢不夠');
      w.gold -= fee; t.recruits = t.recruits.filter(x => x !== r); r.deeds.joinedDay = w.day; w.party.push(r);
      say(w, `花了 ${fee} 金幣，${r.name}（${CLASSES[r.cls].name}）加入了隊伍。`);
      break;
    }
    case 'dismiss': {
      const m = w.party.find(x => x.id === a.id && !x.hero); if (!m) throw new Error('找不到');
      w.party = w.party.filter(x => x !== m); heroGone(w, m, null); say(w, `${m.name}離開了隊伍。`); trimCargo(w);
      break;
    }
    case 'takeContract': {
      if (wantedBy(w, k.owner[w.pos]) >= 3) throw new Error('城裡的人認得你們，沒人肯把差事交給通緝犯');
      const c = w.contracts.find(x => x.id === a.id); if (!c || c.taken) throw new Error('沒有這份委託');
      if (c.kind === 'deliver') throw new Error('收購不用接，直接把貨送到就行');
      if (c.kind === 'escort') { if (w.escort) throw new Error('一次只能護送一支商隊'); if (w.pos !== c.town) throw new Error('要在出發的城接'); w.escort = {cid: c.id, to: c.to, value: c.value}; }
      if (c.kind === 'letter' && w.pos !== c.town) throw new Error('要在寄信的城接');
      c.taken = true; say(w, `接下委託：${c.title}。`);
      if (c.kind === 'letter' && c.secret) { const spots = []; for (let i = 0; i < N; i++) if (passable(i) && !isTown(i, k) && hdist(i, w.pos) === 3) spots.push(i);
        if (spots.length) { const b = makeBand(w, 'bandits', rngPick(w, spots), {str: 90 + w.day * 3, name: '截信的人', ttl: 24, hunting: true}); b.letter = c.id; b.loot = 30 + rngInt(w, 30); say(w, '收下密信時，你注意到酒館角落有人起身離開。'); } }
      break;
    }
    case 'claim': {
      needTown();
      const done = w.contracts.filter(c => canClaimHere(w, c)); if (!done.length) { const far = w.contracts.find(c => c.done && c.taken); throw new Error(far ? `賞金要回${C.nm(far.town)}（或${facName(K().owner[far.town])}的其他城）領` : '沒有可以領的賞金'); }
      for (const c of done) { const r = rewardOf(w, c); w.gold += r; say(w, `領了「${c.title}」的賞金 ${r}${r > c.reward ? '（自己人，多給了一些）' : ''}。`); addFavor(w, c.town, c.kind === 'gang' ? 2 : 1, out); }
      w.contracts = w.contracts.filter(c => !done.includes(c));
      break;
    }
    case 'assault': {
      const g = gangAt(w.pos, k); if (!g) throw new Error('這裡沒有山寨');
      out.battle = battleSetup(w, 'gang', g.id); break;
    }
    case 'engage': { out.battle = battleSetup(w, 'band', a.band); break; }
    case 'duel': {   // 向頭目下戰帖
      expose(w);
      const d = duelTarget(w); if (!d) throw new Error('這裡沒有人可以下戰帖'); if (d.asked) throw new Error('他們已經拒絕過了');
      if (d.band) {
        d.band.duelAsked = true;
        if (rngNext(w) >= duelOdds(w, d.foes)) { out.lines.push(`${d.leader.name}哈哈大笑：「單挑？我們人多，何必。」——他們圍了上來。`); out.battle = battleSetup(w, 'band', d.band.id); break; }
        const s = battleSetup(w, 'band', d.band.id); s.foes = [{...d.leader, leader: true}]; s.source = {kind: 'duel', band: d.band.id}; s.duel = true; s.camp = null; s.title = `與${d.leader.name}單挑`;
        out.lines.push(`${d.leader.name}接下了戰帖。其他人退開，圍成一圈。`); out.battle = s;
      } else {
        (w.duelNo ||= {})[d.gang.id] = w.day;
        if (rngNext(w) >= d.odds) { out.lines.push(`寨門上的人朝你們吐了口水：頭目不跟無名小卒單挑。`); break; }
        const s = battleSetup(w, 'gang', d.gang.id); s.foes = s.foes.filter(f => f.leader); s.source = {kind: 'duel', gang: d.gang.id}; s.duel = true; s.biome = battleBiome(w.pos); s.title = `與頭目${d.gang.name}單挑`;
        out.lines.push(`頭目${d.gang.name}走出寨門，接下了戰帖。`); out.battle = s;
      }
      break;
    }
    case 'handOver': {   // 把押著的頭目交給官府
      needTown(); if (!w.bound) throw new Error('沒有押著人');
      if (wantedBy(w, k.owner[w.pos]) >= 3) throw new Error('官府先要抓的是你們');
      const c = w.contracts.find(x => x.kind === 'gang' && x.gang === w.bound.gang && x.done), bonus = c ? Math.round(c.reward * 0.5) : 0;
      w.gold += w.bound.value + bonus; w.fame = (w.fame || 0) + 0.5; addFavor(w, w.pos, 1, out);
      say(w, `把${w.bound.name}交給了${nm(w.pos)}的官府，領了 ${w.bound.value + bonus} 金幣${bonus ? '（活捉，懸賞加倍）' : ''}。`);
      w.bound = null; break;
    }
    case 'takePlea': {
      const c = w.contracts.find(x => x.id === a.id && x.vill === w.pos); if (!c || c.taken) throw new Error('沒有這件事');
      c.taken = true; say(w, `答應了${nm(c.vill)}的村民：${c.title}。`); break;
    }
    case 'thankPlea': {   // 回村裡交差：錢少，主要是人情
      const done = w.contracts.filter(c => c.vill === w.pos && c.done); if (!done.length) throw new Error('沒有辦好的事');
      for (const c of done) { w.gold += c.reward; say(w, `${nm(c.vill)}的村民湊了 ${c.reward} 金幣謝你們：${c.title}。`); addFavor(w, w.pos, c.favor || 2, out); }
      w.contracts = w.contracts.filter(c => !done.includes(c)); break;
    }
    case 'lodge': {   // 借宿：用人情換一晚（吃住都由村民招待），同時藏了起來
      if (here?.kind !== 'village') throw new Error('要在村子裡');
      spendFavor(w, w.pos, FAVOR.lodge); const f0 = w.food; if (!lodgedHere(w)) { w.lodged = w.pos; w.hideAt = w.hideT0 = null; hideCharge(w); }
      passHours(w, 24, 'inn', out); w.food = Math.max(w.food, f0);
      say(w, `借住在${nm(w.pos)}的村民家，吃了頓熱飯、睡了個好覺。`); break;
    }
    case 'searchTile': {   // 搜索這一格：找藏起來的人（共享世界由伺服器比對名單）
      if (town) throw new Error('城裡人來人往，沒辦法這樣搜');
      passHours(w, 12, 'wait', out); say(w, `在${nm(w.pos)}仔細搜了半天。`); break;
    }
    case 'hideIn': {   // 躲進洞窟、廢墟、哨堡、沉船
      const p = poiAt(w, w.pos); if (!p || !HIDE_POI.has(p.type)) throw new Error('這裡沒有地方可以躲');
      w.den = w.pos; w.camp = null; passHours(w, 1, 'wait', out);
      say(w, `躲進了${POI_TYPES[p.type].n}。${poiDone(w, p) ? '這裡被人探索過，大家都知道這個地方。' : '裡面還沒人探過，不知道有什麼。'}`); break;
    }
    case 'give': {   // 接濟村子
      if (here?.kind !== 'village') throw new Error('要在村子裡');
      const q = Math.max(1, Math.floor(+a.q || 1)), m = k.markets[here.mkt]; let value = 0, need = 1, what = '';
      if (a.what === 'gold') { if (q > w.gold) throw new Error('錢不夠'); w.gold -= q; value = q; what = `${q} 金幣`; k.bandit[w.pos] = Math.max(0, k.bandit[w.pos] - q / 40); }
      else if (a.what === 'ration') { if (q > Math.floor(w.food)) throw new Error('口糧不夠'); w.food -= q; need = foodNeed(w.pos); value = q * Math.max(1, rationPrice(w, w.pos) || 2); w.vill[w.pos] = {food: villageFood(w, w.pos) + q, day: w.day}; what = `${q} 份口糧`; }
      else { const g = a.what; if (!TRADE.includes(g) || q > (w.cargo[g] || 0)) throw new Error('身上沒那麼多'); w.cargo[g] -= q; if (g === 'food') need = foodNeed(w.pos); value = q * (m ? basePrice(here.mkt, g, k) : unitValue(g)); if (m && !isSpec(g)) m.stock[g] += q * BALE; what = `${GN[g]} ${q} 包`; }
      const f = giftFavor(w, w.pos, value, need); addFavor(w, w.pos, f);
      say(w, `把${what}分給了${nm(w.pos)}的村民${need > 1.3 ? '（這裡正缺糧，大家感激得不得了）' : ''}。人情 +${f.toFixed(1)}。`);
      if (value >= 60 && (w.gaveRumor || {})[w.pos] !== w.day) { (w.gaveRumor ||= {})[w.pos] = w.day; k.ev.push({y: k.curY, type: 'legend', text: `有一支戰幫在${nm(w.pos)}${a.what === 'gold' ? '散錢' : '發糧'}給村民。`, tile: w.pos, ts: k.stamp}); }
      break;
    }
    case 'askLocal': {   // 打聽：附近的山寨、懸賞的下落
      if (here?.kind !== 'village' && !town) throw new Error('要在村子或城裡');
      spendFavor(w, w.pos, FAVOR.ask); const lines = [];
      for (const g of k.gangs.filter(g => !g.gone && hdist(g.lair, w.pos) <= 7).sort((a, b) => hdist(a.lair, w.pos) - hdist(b.lair, w.pos)).slice(0, 3)) { reveal(w, g.lair, 0); lines.push(`${g.name}的山寨在${nm(g.lair)}（${gangWordOf(g.str)}）`); w.pins = (w.pins || []).slice(-30); w.pins.push({tile: g.lair, text: `${g.name}的山寨`, day: w.day, type: 'bandit'}); }
      const hot = []; for (let i = 0; i < N; i++) if (hdist(i, w.pos) <= 4 && k.bandit[i] > 40) hot.push(i);
      if (hot.length) lines.push(`${hot.slice(0, 3).map(nm).join('、')}一帶不太平`);
      say(w, lines.length ? `村民壓低聲音說：${lines.join('；')}。` : '村民說這一帶最近還算太平。'); passHours(w, 1, 'wait', out); break;
    }
    case 'hide': {   // 被巡邏隊攔下：請欠你人情的村民把你們藏起來
      const b = w.bands.find(x => x.id === a.band); if (!b || b.kind !== 'soldiers') break;
      if (!canHide(w)) throw new Error('附近沒有欠你們人情的村子');
      const v = canHide(w); spendFavor(w, v, FAVOR.hide); w.bands = w.bands.filter(x => x !== b);
      say(w, `${nm(v)}的村民把你們藏進穀倉，${b.name}搜了一圈，罵罵咧咧地走了。`); break;
    }
    case 'payRansom': {
      const c = w.captive; if (!c) break; if (w.gold < c.ransom) throw new Error(`贖金要 ${c.ransom}，身上不夠`);
      w.gold -= c.ransom; w.captive = null; say(w, `付了 ${c.ransom} 金幣，${c.by}放了人。`); break;
    }
    case 'favorRansom': {
      const c = w.captive; if (!c) break; spendFavor(w, w.pos, FAVOR.ransom);
      w.captive = null; say(w, `${nm(regionOf(w.pos))}一帶的人湊了錢，把你們從${c.by}手上贖了出來。`); break;
    }
    case 'escape': {
      const c = w.captive; if (!c) break; if (c.lastTry === w.day) throw new Error('今天才剛試過，看守盯得很緊');
      c.lastTry = w.day; c.tries++; const ok = rngNext(w) < escapeOdds(w);
      passHours(w, 12, 'wait', out);
      if (ok) { w.captive = null; if (c.soldier && c.fac >= 0) w.wanted[c.fac] = (w.wanted[c.fac] || 0) + 1; say(w, `趁夜裡撬開了鎖，${c.soldier ? '翻出牢房' : '摸黑溜出了寨子'}。${c.soldier ? '越獄的事很快就會傳開。' : ''}`); out.lines.push('逃出來了！'); }
      else { c.ransom = Math.round(c.ransom * 1.2); say(w, `逃跑被抓了回來，挨了一頓打；贖金漲到 ${c.ransom}。`); out.lines.push('沒逃成。'); }
      break;
    }
    case 'waitCaptive': { passHours(w, 24, 'wait', out); captiveCheck(w); if (w.captive) say(w, `又被關了一天。`); break; }
    case 'release': { if (!w.bound) break; say(w, `放了${w.bound.name}。他頭也不回地跑了。`); w.bound = null; break; }
    case 'evade': {
      const b = w.bands.find(x => x.id === a.band); if (!b) break;
      const forest = [6, 9, 3].includes(k.biome[w.pos]);
      const chance = 0.4 + (forest ? 0.2 : 0) + (b.kind === 'wolves' ? -0.15 : 0) - Math.max(0, w.party.length - 3) * 0.05 - w.mules * 0.04 + (mounted(w) ? 0.15 : 0);
      if (rngNext(w) < chance) { b.pos = -1; w.bands = w.bands.filter(x => x !== b); out.lines.push('趁著地形甩開了他們。'); say(w, `避開了${b.name}。`); }
      else { out.lines.push('沒能甩開，只能打了。'); out.battle = battleSetup(w, 'band', b.id); }
      break;
    }
    case 'raid': {   // 劫運貨車或商隊：先跟護衛打一場
      expose(w);
      const u = unitsInView(w).find(x => x.pos === w.pos && x.kind === a.what && (a.to == null || x.to === a.to));
      if (!u) throw new Error('這裡沒有可以劫的車隊');
      if (w.guard && w.guard.fac === u.fac) throw new Error(`${w.guard.name}就在旁邊看著`);
      out.battle = battleSetup(w, 'raid', u); break;
    }
    case 'trade': {   // 跟路上的商隊、運貨車買賣（一次一小時）
      const u = unitsInView(w).find(x => x.pos === w.pos && x.kind === a.what && x.to === a.to && (a.what !== 'caravan' || x.g === a.g));
      if (!u) throw new Error('他們已經走遠了');
      const q = Math.max(1, Math.floor(+a.q || 1)), room = capacity(w) - load(w);
      if (a.what === 'caravan') {
        const d = caravanDeal(w, u); if (d.no) throw new Error(d.no);
        const cs = unitsHere(w, 'caravan', u.to, u.g); for (const c of cs) c.cap ??= c.amt * 1.3;
        if (a.side === 'buy') {
          if (q > d.have) throw new Error('他們沒那麼多貨'); if (q > room) throw new Error('扛不動了');
          const cost = q * d.buy; if (cost > w.gold) throw new Error('錢不夠');
          w.gold -= cost; w.cargo[d.g] = (w.cargo[d.g] || 0) + q; drawFrom(cs, c => c.amt, (c, v) => { c.amt = v; }, q * BALE);
          say(w, `向${u.label.replace(/ ×\d+$/, '')}買了${GN[d.g]} ${q} 包（${cost} 金幣）。`);
        } else {
          if (q > (w.cargo[d.g] || 0)) throw new Error(`身上沒那麼多${GN[d.g]}`); if (q > d.room) throw new Error('他們的車裝不下了');
          w.cargo[d.g] -= q; w.gold += q * d.sell; cs[0].amt += q * BALE;
          say(w, `把${GN[d.g]} ${q} 包賣給了往${nm(u.to)}的商隊（${q * d.sell} 金幣）。`);
        }
      } else {
        const d = cartDeal(w, u); if (d.no) throw new Error(d.no);
        const cs = unitsHere(w, 'cart', u.to), take = (g, amt) => drawFrom(cs, c => c.goods[g] || 0, (c, v) => { c.goods[g] = v; }, amt);
        if (a.g === 'ration') {
          if (q > d.rations) throw new Error('車上沒那麼多糧'); const cost = Math.ceil(q * d.ration); if (cost > w.gold) throw new Error('錢不夠');
          w.gold -= cost; w.food += q; take('food', q / RATIONS_PER_BALE * BALE); say(w, `向運貨車買了 ${q} 份口糧（${cost} 金幣）。`);
        } else {
          const o = d.goods[a.g]; if (!o || q > o.have) throw new Error('車上沒那麼多'); if (q > room) throw new Error('扛不動了');
          const cost = q * o.buy; if (cost > w.gold) throw new Error('錢不夠');
          w.gold -= cost; w.cargo[a.g] = (w.cargo[a.g] || 0) + q; take(a.g, q * BALE); say(w, `向運貨車買了${GN[a.g]} ${q} 包（${cost} 金幣）。`);
        }
      }
      passHours(w, 1, 'wait', out); break;
    }
    case 'ask': {   // 向商隊打聽出發地的行情
      const u = unitsInView(w).find(x => x.pos === w.pos && x.kind === 'caravan' && x.to === a.to && x.g === a.g);
      if (!u) throw new Error('他們已經走遠了');
      const d = caravanDeal(w, u); if (d.no) throw new Error(d.no);
      if (k.markets[u.from]) { noteIntel(w, u.from, 'told'); w.intel[u.from].day = w.day - Math.max(1, Math.round(d.prog * hdist(u.from, w.pos) / 2)); }
      say(w, `跟商隊聊了一陣，打聽到${nm(u.from)}的行情。`); passHours(w, 1, 'wait', out); break;
    }
    case 'hirePatrol': {   // 雇巡邏隊同行
      const p = (w.patrols || []).find(x => x.id === a.id && x.pos === w.pos); if (!p) throw new Error('巡邏隊已經走了');
      const d = patrolHire(w, p); if (d.no) throw new Error(d.no);
      const o = d.opts.find(x => x.h === +a.h) || d.opts[0]; if (o.cost > w.gold) throw new Error('錢不夠');
      const lvl = 1 + Math.floor(w.day / 12), men = [makeMember(w, 'knight', lvl + 1, {name: '巡邏隊長'})];
      for (let i = 1; i < p.size; i++) men.push(makeMember(w, rngPick(w, ['spearman', 'spearman', 'swordsman', 'archer']), lvl, {name: '巡邏兵'}));
      w.gold -= o.cost; w.patrols = w.patrols.filter(x => x !== p);
      w.guard = {fac: p.fac, name: `${facName(p.fac)}的巡邏隊`, men, untilP: hourAbs(w) + o.h, untilW: worldHourOf(w) + o.h};
      say(w, `付了 ${o.cost} 金幣，${w.guard.name}答應跟你們走 ${o.h} 小時（只在${facName(p.fac)}境內）。`);
      passHours(w, 1, 'wait', out); break;
    }
    case 'attackPatrol': {   // 對巡邏隊動手
      expose(w);
      const p = (w.patrols || []).find(x => x.id === a.id && x.pos === w.pos); if (!p) throw new Error('巡邏隊已經走了');
      if (w.guard && w.guard.fac === p.fac) throw new Error(`${w.guard.name}不會跟自己人動手`);
      w.patrols = w.patrols.filter(x => x !== p);
      const b = makeBand(w, 'soldiers', w.pos, {fac: p.fac, size: p.size, name: `${facName(p.fac)}的巡邏隊`, ttl: 1}); b.attacked = true;
      out.battle = battleSetup(w, 'band', b.id); break;
    }
    case 'bribe': {   // 被巡邏隊攔下：繳罰金
      const b = w.bands.find(x => x.id === a.band); if (!b || b.kind !== 'soldiers') break;
      if (hostileBanner(w, b.fac)) throw new Error('他們不收你們的錢——你們打著敵國的旗子');
      const fine = fineOf(w, b.fac); if (w.gold < fine) { out.lines.push('罰金繳不出來，只能打了。'); out.battle = battleSetup(w, 'band', b.id); break; }
      w.gold -= fine; w.wanted[b.fac] = (w.wanted[b.fac] || 0) / 2; w.bands = w.bands.filter(x => x !== b);
      say(w, `向${b.name}繳了 ${fine} 金幣的罰金，對方記下了你們的名字。`); break;
    }
    case 'pay': {
      const b = w.bands.find(x => x.id === a.band); if (!b || b.kind !== 'bandits') break;
      const t = tollOf(w);
      if (b.letter) { const c = w.contracts.find(x => x.id === b.letter); if (c) { w.contracts = w.contracts.filter(x => x !== c); say(w, `把密信交給了${b.name}，委託「${c.title}」失敗了。`); } out.lines.push('交出了密信，他們放你們走了。'); w.bands = w.bands.filter(x => x !== b); break; }
      if (t.escort) { failEscort(w, `${b.name}劫走了護送的貨，`); out.lines.push('他們拉走了商隊的貨，放你們走了。'); }
      else if (t.cargo) { loseCargo(w, 0.5, `${b.name}拿走了一半的貨：`); out.lines.push('他們搬走了一半的貨，讓你們過去了。'); }
      else { if (w.gold < t.gold) { out.lines.push('身上的錢不夠買路。'); out.battle = battleSetup(w, 'band', b.id); break; } w.gold -= t.gold; say(w, `付了 ${t.gold} 金幣的過路費。`); }
      for (const m of companions(w)) m.loyalty -= m.traits.includes('reckless') ? 6 : 2;
      const g = b.gang && k.gangs.find(x => x.id === b.gang); if (g && !g.gone) g.loot = (g.loot || 0) + 10;
      w.bands = w.bands.filter(x => x !== b);
      break;
    }
    case 'camp': {
      const o = campOptions(w).find(x => x.key === a.opt); if (!o) throw new Error(town ? '城裡就住旅店吧' : '沒有這個選項'); if (!o.ok) throw new Error(o.why || '已經弄好了');
      if (!campHere(w)) w.camp = {pos: w.pos, since: hourNow(w)};
      if (o.wood) w.cargo.wood -= o.wood;
      if (o.key !== 'basic') w.camp[o.key] = true;
      passHours(w, o.hours, 'camp', out);
      say(w, o.key === 'basic' ? `在${nm(w.pos)}紮營。` : `營地${o.key === 'stake' ? '圍上了木柵' : o.key === 'watch' ? '排好了守夜的班' : '生起了營火'}。`);
      break;
    }
    case 'march': { w.march = !!a.on; say(w, w.march ? '下令急行軍：走得快，但人和牲口都會吃不消。' : '恢復正常行軍。'); break; }
    case 'drop': {
      const g = a.g, q = Math.min(Math.floor(a.q || 0), w.cargo[g] || 0); if (!TRADE.includes(g) || q <= 0) throw new Error('身上沒有這種貨');
      w.cargo[g] -= q; addCache(w, w.pos, {[g]: q}, '有人丟下的'); say(w, `把${GN[g]} ${q} 包丟在${nm(w.pos)}。`); break;
    }
    case 'pick': {
      const cs = cachesAt(w, w.pos); if (!cs.length) throw new Error('這裡沒有東西可撿');
      let room = capacity(w) - load(w); const took = [];
      for (const c of cs) for (const g of Object.keys(c.goods).sort((x, y) => unitValue(y) - unitValue(x))) {
        if (a.g && a.g !== g) continue; const n = Math.min(room, Math.floor(c.goods[g])); if (n <= 0) continue;
        c.goods[g] -= n; room -= n; if (g === 'food' && a.eat) w.food += n * RATIONS_PER_BALE; else w.cargo[g] = (w.cargo[g] || 0) + n; took.push(`${GN[g]} ${n} 包`);
      }
      for (const c of cs) if (c.items?.length && !a.g) c.items = c.items.filter(it => { if (room < itemWeight(it)) return true; room -= itemWeight(it); w.pack.push(it); took.push(itemName(it)); return false; });
      if (!took.length) throw new Error(room <= 0 ? '扛不動了' : '能撿的都撿完了');
      passHours(w, 2, 'travel', out); say(w, `在${nm(w.pos)}撿起了${took.join('、')}。`); out.lines.push(`撿起了${took.join('、')}。`); break;
    }
    case 'gather': { gather(w, a.kind, out); break; }
    case 'work': {
      needTown(); const d = Math.max(1, Math.min(7, a.days || 1)), pay = Math.round(w.party.length * (2.5 + Math.min(3, k.markets[w.pos].pop / 200)) * d);
      passHours(w, 24 * d, 'camp', out); if (w.over) break; w.gold += pay; w.earned += pay;
      for (const m of companions(w)) m.loyalty = Math.min(100, m.loyalty + 0.5 * d);
      say(w, `在${nm(w.pos)}打了 ${d} 天零工（碼頭、倉庫、田裡），全隊賺了 ${pay} 金幣。`); out.lines.push(`打零工 ${d} 天，賺了 ${pay} 金幣。`); break;
    }
    case 'breakCamp': { if (!campHere(w)) throw new Error('沒有紮營'); w.camp = null; say(w, '拔營。'); break; }
    case 'buyKit': { needTown(); if (w.kit) throw new Error('已經有一套了'); if (w.gold < KIT_PRICE) throw new Error('錢不夠'); w.gold -= KIT_PRICE; w.kit = 1; say(w, `買了一套紮營工具（${KIT_PRICE} 金幣）：斧頭、繩索、帳篷。`); break; }
    case 'banner': {
      needTown(); const f = a.fac == null ? null : +a.fac;
      if (f != null && f !== k.owner[w.pos]) throw new Error('只能在那個國家的城裡掛它的旗');
      if (f != null && wantedBy(w, f) >= 1) throw new Error('通緝犯不能掛這面旗');
      w.banner = f; say(w, f == null ? '收起了旗子，當個誰也不靠的中立戰幫。' : `掛上了${facName(f)}的旗子。`); break;
    }
    case 'ransom': {
      needTown(); const c = (w.captives || [])[a.i]; if (!c) throw new Error('沒有這個人');
      if (w.party.length >= MAX_PARTY) throw new Error(`隊伍最多 ${MAX_PARTY} 人`); if (w.gold < c.price) throw new Error('錢不夠');
      w.gold -= c.price; w.captives.splice(a.i, 1); c.m.loyalty = Math.max(30, c.m.loyalty - 10); w.party.push(c.m);
      say(w, `托人花了 ${c.price} 金幣，把${c.m.name}從${c.by}手上贖了回來。`); break;
    }
    default: throw new Error('未知的行動');
  }
  if (out.battle) w.pendingBattle = out.battle;
  if (apNeed) w.ap -= apNeed;
  return out;
}
export const relicPrice = (w, r) => { const k = K(), m = k.markets[w.pos]; return Math.round((400 + r.wins * 12 + r.owners * 20) * (m ? Math.min(1.6, 0.6 + m.pop / 600) : 1)); };
const HOURS = ['深夜', '深夜', '凌晨', '凌晨', '清晨', '清晨', '早上', '早上', '上午', '上午', '上午', '中午', '中午', '下午', '下午', '下午', '傍晚', '傍晚', '黃昏', '晚上', '晚上', '晚上', '深夜', '深夜'];
export const timeText = w => { const m = K().stamp.match(/^(\d+) 年 (\S+) 第(\d+)日/); return `${m[1]}年${m[2]}${m[3]}日・${HOURS[Math.floor(w.hour) % 24]}`; };
export const fameWord = f => !f ? '沒沒無聞' : f < 1 ? '小有耳聞' : f < 3 ? '有些名氣' : f < 6 ? '遠近馳名' : '名震一方';
export const eaters = w => w.party.length + (w.bound ? 1 : 0) + w.mules * MULE_FEED + (w.horses || 0) * HORSE_FEED;
export const daysOfFood = w => w.food / Math.max(1, eaters(w));

/* ───────────── 裝備、馬、傳奇武器 ───────────── */
// 上戰場時加上的數值；回來時要扣掉，才不會疊上去
export function gearBonus(w, m) {
  const b = {str: 0, def: 0};
  if ((w.relics || []).some(r => r.equip === m.id) || m.relicW) b.str += 2;
  if (tired(w)) { b.def -= 1; b.skl = -5; }   // 疲憊：防禦 -1、命中 -10
  return b;
}
export const battleParty = (w, setup) => setup?.duel ? w.party.filter(m => m.hero).map(m => { const b = gearBonus(w, m); return {...m, str: m.str + b.str, def: m.def + b.def}; }) : w.party.map(m => { const b = gearBonus(w, m); return {...m, str: m.str + b.str, def: m.def + b.def}; }).concat(w.guard ? w.guard.men.map(m => ({...m, guard: true})) : []);
const ironMul = (i, k = K()) => Math.max(0.6, Math.min(2.5, k.markets[i].price.iron));
export const mounted = w => (w.horses || 0) >= w.party.length && w.party.length > 0;
// 載重：貨裝到七成五以上開始變慢，滿載時每格多花四成時間
export const loadMul = w => { const r = load(w) / Math.max(1, capacity(w)); return r <= 0.75 ? 1 : 1 + Math.min(1, (r - 0.75) / 0.25) * 0.4; };
export const MARCH_MUL = 0.7;
export const legHours = (w, i, k = K()) => { let h = hexHours(i, k); if (h === Infinity) return h; const b = k.biome[i]; if (mounted(w)) h *= (b === 6 || b === 3 || b === 9 ? 0.85 : 0.65); h *= loadMul(w); if (w.march) h *= MARCH_MUL; return Math.max(1, Math.round(h)); };
export const pathHoursW = (w, path, k = K()) => path.reduce((s, i) => s + legHours(w, i, k), 0);
// 沙盒裡真實存在的有名者：這座城所屬國家裡打過幾場勝仗、不是國君的人
export function famousHere(w, t) {
  const k = K(), f = k.owner[t]; if (f < 0) return [];
  return k.heroes.filter(h => h.alive && h.f === f && !h.ruled && !h.captive && !h.noCmd && !h.warband && (h.famed || h.wins >= 2))
    .sort((a, b) => (b.famed ? 1 : 0) - (a.famed ? 1 : 0) || b.wins - a.wins).slice(0, 2);
}
const FAMOUS_CLS = ['swordsman', 'spearman', 'axeman', 'archer'];
export function famousOffer(w, h) {
  const lvl = 2 + Math.min(5, Math.floor(h.wins / 2)) + (h.famed ? 1 : 0) + (h.legend ? 2 : 0);
  const wage = 22 + lvl * 4 + (h.famed ? 10 : 0) + (h.legend ? 30 : 0);
  const k = K(), relic = k.weapons.find(x => x.holder === h.id);
  return {lvl, wage, fee: wage * 3, cls: FAMOUS_CLS[h.id % 4], relic: relic ? relic.name : null};
}
function hireFamous(w, h) {
  const k = K(), o = famousOffer(w, h), seedW = {...w};
  const m = makeMember(w, o.cls, o.lvl, {name: h.epithet ? `「${h.epithet}」${h.name}` : h.name});
  m.str += 1; m.skl += 1;
  const n = h.legend ? 2 : 1; while (m.traits.length < n) { const t = rngPick(w, TRAIT_KEYS); if (!m.traits.includes(t)) m.traits.push(t); }
  m.loyalty = 45 + Math.round((h.loyal || 0.5) * 20); m.wage = o.wage; m.deeds = {battles: h.battles || 0, kills: 0, joinedDay: w.day}; m.simHero = h.id; m.famous = true;
  const wp = k.weapons.find(x => x.holder === h.id); if (wp) m.relicW = wp.id;
  h.warband = 1; h.noCmd = 1; if (h.fief >= 0 && k.markets[h.fief]) k.markets[h.fief].lord = 0; h.fief = -1;
  k.ev.push({y: k.curY, type: 'hero', text: `${k.fac[h.f]?.n || ''}的${h.name}離開了故國，加入了${MODE.bandName}。`, tile: w.pos, ts: k.stamp});
  void seedW; return m;
}
// 有名者離隊或戰死：寫回沙盒
function heroGone(w, m, end, died) {
  if (!m.simHero) return; const k = K(), h = k.heroes.find(x => x.id === m.simHero); if (!h) return;
  const wp = m.relicW && k.weapons.find(x => x.id === m.relicW);
  if (died) { h.alive = false; h.diedY = k.curY; h.end = end;
    if (wp) { wp.holder = 0; wp.fac = -1; wp.lost = true; wp.loc = w.pos; wp.lostY = k.curY; wp.hist.push({y: k.curY, t: `${h.name}${end}，「${wp.name}」遺落在${nm(w.pos)}。`}); } }
  else { h.warband = 0; h.noCmd = 0; k.ev.push({y: k.curY, type: 'hero', text: `${h.name}離開了戰幫，回到了${k.fac[h.f]?.n || '故鄉'}。`, tile: w.pos, ts: k.stamp}); }
}
