// 奇幻戰幫：世界層——走在大陸沙盒上
// 地圖、城鎮、村莊、盜匪山寨、商路、價格都來自大陸沙盒（cont.js）；這一層只管戰幫自己的人、錢、糧、貨、委託與遭遇。
// 純規則；行動入口是 worldAct(w, action)，回傳訊息與（若有）要開打的戰鬥。
import {CLASSES, RECRUIT_CLASSES, TRAIT_KEYS, NAMES, SURNAMES, rngNext, rngInt, rngPick, hashSeed} from './data.js';
import * as C from './cont.js';

export const {W, H, N, NBR, BIOMES, GOODS, GN, hdist} = C;
const K = C.K, nm = C.nm;

/* ───────────── 常數 ───────────── */
export const BALE = 0.02;           // 一包貨 = 沙盒裡 0.02 單位（戰幫的生意比起整座城的進出貨很小）
export const COINP = 3;             // 沙盒基準價 × 3 = 一包的金幣價
export const RATIONS_PER_BALE = 3;  // 一包糧 = 三份口糧
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
  if (!m.name) m.name = RECRUIT_CLASSES.includes(cls) || cls === 'knight' ? `${rngPick(w, NAMES)}・${rngPick(w, SURNAMES)}` : c.name;
  return m;
}
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
export function hexHours(i, k = K()) {
  if (!C.land(i) || k.biome[i] === 2) return Infinity;
  let h = C.MOVE[k.biome[i]] * 9;
  if (k.routeTiles.has(i)) h *= 0.6;
  return Math.max(4, Math.round(h));
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
export const load = w => GOODS.reduce((s, g) => s + (w.cargo[g] || 0), 0);
export const capacity = w => w.party.length * CARRY_MAN + w.mules * MULE_CAP;
export const cargoValue = w => GOODS.reduce((s, g) => s + (w.cargo[g] || 0) * C.BASEP[g] * COINP, 0);
const seasonId = (k = K()) => Math.floor(k.T / SEASON_T);
// 玩家這一季在這個市集淨買進（正）或賣出（負）多少包：同一季裡會一直推著價格走，換季後沙盒重算價格
function press(w, i, g) { const p = w.press[i]; return p && p.s === seasonId() ? (p[g] || 0) : 0; }
function addPress(w, i, g, d) { let p = w.press[i]; if (!p || p.s !== seasonId()) p = w.press[i] = {s: seasonId()}; p[g] = (p[g] || 0) + d; }
export const basePrice = (i, g, k = K()) => C.BASEP[g] * k.markets[i].price[g] * COINP;
const depth = (i, g, k = K()) => { const m = k.markets[i]; return Math.max(4, (m.stock[g] + m.need[g]) / BALE * 0.35); };
const factor = x => Math.max(0.25, Math.min(4, x));
// 單包的價格：第 j 包（從 0 起算）
function unit(w, i, g, side, j, k) {
  const b = basePrice(i, g, k), d = depth(i, g, k), p = press(w, i, g);
  return side === 'buy' ? b * factor(1 + (p + j + 0.5) / d) * 1.1 : b * factor(1 - (-p + j + 0.5) / d) * 0.9;
}
export function quote(w, i, g, side, q) { const k = K(); let s = 0; for (let j = 0; j < q; j++) s += unit(w, i, g, side, j, k); return Math.round(s); }
export const stockBales = (i, g) => Math.floor(K().markets[i].stock[g] / BALE);
export function rationPrice(w, i) {
  const k = K();
  if (isTown(i, k)) return Math.max(1, basePrice(i, 'food', k) / RATIONS_PER_BALE * 1.15);
  const s = siteAt(w, i); if (s?.kind === 'village' && k.markets[s.mkt]) return Math.max(1, basePrice(s.mkt, 'food', k) / RATIONS_PER_BALE * 0.85);
  return null;
}
export function villageFood(w, i) { const k = K(), v = w.vill[i]; const cap = Math.min(30, Math.round(k.pop[i] / 4)); if (!v) return cap; return Math.min(cap, Math.round(v.food + (w.day - v.day) * 3)); }
// 記下親眼看到的行情
function noteIntel(w, i, src) {
  const k = K(), m = k.markets[i]; if (!m) return;
  const p = {}, s = {}; for (const g of GOODS) { p[g] = Math.round(basePrice(i, g, k)); s[g] = stockBales(i, g); }
  w.intel[i] = {day: src === 'seen' ? w.day : w.day - Math.min(12, hdist(i, w.pos)), p, s, src};
}

/* ───────────── 新世界 ───────────── */
export function newWorld(seed, heroName) {
  const k = K();
  const w = {v: 2, seed, rng: hashSeed('world', seed), nextId: 1, day: 1, hour: 8, gold: 200, food: 16, log: [], battles: 0, kills: 0, fallen: [], over: null,
    contracts: [], bands: [], towns: {}, vill: {}, press: {}, intel: {}, cargo: {food: 0, wood: 0, iron: 0, stone: 0, salt: 0}, mules: 0, relics: [], tick: 0, rumorDay: 0, earned: 0};
  // 從大城開始：人口前五大的市鎮挑一個
  const towns = Object.keys(k.markets).map(Number).filter(i => k.owner[i] >= 0).sort((a, b) => k.markets[b].pop - k.markets[a].pop).slice(0, 5);
  w.pos = towns[rngInt(w, towns.length)];
  w.party = [];
  const h = makeMember(w, 'knight', 2, {id: 'hero', hero: true, name: heroName || '無名的騎士'});
  h.loyalty = 100; h.wage = 0; h.deeds = {battles: 0, kills: 0, joinedDay: 1}; h.sprite = ['people', 'knight'];
  w.party.push(h);
  for (const cls of ['spearman', 'archer', 'herbalist']) w.party.push(makeRecruit(w, cls, 1));
  w.nextWage = 8;
  arrive(w);
  say(w, `${h.name}帶著三個夥伴，在${facName(k.owner[w.pos])}的${nm(w.pos)}落腳。這是 ${k.stamp.replace(/ \S+$/, '')}。`);
  return w;
}
// 走進城鎮：看行情、刷新告示板
function arrive(w) {
  if (!isTown(w.pos)) return;
  noteIntel(w, w.pos, 'seen'); townState(w, w.pos); refreshContracts(w, w.pos);
}
function refreshContracts(w, t) {
  const k = K();
  w.contracts = w.contracts.filter(c => c.taken || c.until >= w.day);
  for (const c of w.contracts) if (c.kind === 'gang' && !c.done) { const g = k.gangs.find(x => x.id === c.gang); if (!g || g.gone) c.void = true; }
  w.contracts = w.contracts.filter(c => !c.void || c.done);
  for (const g of k.gangs) {
    if (g.gone || hdist(g.lair, t) > 7 || w.contracts.some(c => c.gang === g.id)) continue;
    w.contracts.push({id: 'k' + w.nextId++, kind: 'gang', town: t, gang: g.id, title: `剿滅${g.name}的山寨`, reward: Math.round(120 + g.str * 0.6), until: w.day + 24, taken: false, done: false});
  }
}
export const contractSite = (w, c) => { const g = K().gangs.find(x => x.id === c.gang); return g && !g.gone ? g.lair : -1; };

/* ───────────── 時間流逝 ───────────── */
const RUMOR_TYPES = new Set(['war', 'bandit', 'econ', 'disaster', 'legend', 'hero', 'found']);
function passHours(w, hours, mode, out) {
  for (let i = 0; i < hours; i++) {
    w.hour++;
    w.food = Math.max(0, w.food - (w.party.length + w.mules * MULE_FEED) / 24);
    const rate = mode === 'inn' ? 0.5 : mode === 'camp' ? 0.2 : 0.08;
    for (const m of w.party) { m.healBuf = (m.healBuf || 0) + m.max * rate / 24; const whole = Math.floor(m.healBuf); if (whole) { m.hp = Math.min(m.max, Math.round(m.hp) + whole); m.healBuf -= whole; } }
    if (w.hour % 6 === 0) worldTick(w, out);
    if (w.hour >= 24) { w.hour = 0; w.day++; newDay(w, out, mode); if (w.over) return; }
    const b = bandAt(w, w.pos);
    if (b && !out.encounter) { out.encounter = b.id; return; }
  }
}
// 每六小時：沙盒推進一個時段；附近發生的事會傳到耳裡；盜匪會盯上帶著貨的人
function worldTick(w, out) {
  const evs = C.tick(); w.tick++;
  let told = 0;
  for (const e of evs) {
    if (told >= 2 || !RUMOR_TYPES.has(e.type) || e.tile < 0) continue;
    const d = hdist(e.tile, w.pos); if (d > (e.type === 'legend' ? 9 : 4)) continue;
    say(w, d === 0 ? e.text : `聽說：${e.text}`); told++;
  }
  moveBands(w, out);
  sendBands(w);
}
function newDay(w, out, mode) {
  for (const m of w.party) m.hp = Math.round(m.hp);
  if (w.food <= 0) {
    say(w, '糧食吃光了，大家餓著肚子。');
    for (const m of w.party) { m.hp = Math.max(1, m.hp - Math.ceil(m.max * 0.15)); if (!m.hero) m.loyalty -= 8; }
    if (w.mules && rngNext(w) < 0.3) { w.mules--; trimCargo(w); say(w, '一頭騾子餓得走不動，只好丟下了。'); }
  }
  if (mode === 'inn') for (const m of companions(w)) m.loyalty = Math.min(100, m.loyalty + 2);
  if (w.day >= w.nextWage) payday(w);
  for (const m of companions(w).slice()) if (m.loyalty <= 10) { w.party = w.party.filter(x => x !== m); say(w, `${m.name}收拾行囊，不告而別。`); trimCargo(w); }
}
// 人少了、騾子沒了，扛不動的貨只好丟下
function trimCargo(w) {
  let over = load(w) - capacity(w); if (over <= 0) return;
  const lost = [];
  for (const g of GOODS.slice().sort((a, b) => C.BASEP[a] - C.BASEP[b])) { const d = Math.min(over, w.cargo[g]); if (d > 0) { w.cargo[g] -= d; over -= d; lost.push(`${GN[g]} ${d} 包`); } if (over <= 0) break; }
  if (lost.length) say(w, `扛不動了，丟下了${lost.join('、')}。`);
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
  if (kind === 'wolves') { const n = 2 + rngInt(w, 2), l = 1 + Math.floor(w.day / 16); for (let i = 0; i < n; i++) foes.push(makeMember(w, 'wolf', l)); if (rngNext(w) < 0.25) foes.push(makeMember(w, rngNext(w) < 0.5 ? 'bear' : 'boar', l + 1, {leader: true})); }
  else { const str = opt.str || 80, n = Math.min(w.day < 10 ? 4 : 6, 2 + Math.min(3, Math.floor(str / 120) + rngInt(w, 2))), l = bandLvl(w, str); for (let i = 0; i < n; i++) foes.push(makeMember(w, rngPick(w, ['bandit', 'bandit', 'cutthroat', 'poacher']), l + (rngNext(w) < 0.25 ? 1 : 0))); }
  const b = {id: 'b' + w.nextId++, kind, name: kind === 'wolves' ? '狼群' : opt.name || '一夥盜匪', pos, foes, loot: kind === 'wolves' ? 0 : 15 + rngInt(w, 30), gang: opt.gang || 0, ttl: opt.ttl || 8, hunting: !!opt.hunting};
  w.bands.push(b); return b;
}
// 走進一格時：盜匪埋伏（看那一格的盜匪多寡與你身上的貨），荒野裡有狼
function onEnter(w, out) {
  const k = K(), i = w.pos; if (isTown(i, k) || bandAt(w, i)) return;
  const cv = cargoValue(w), near = k.gangs.filter(g => !g.gone && hdist(g.lair, i) <= 3).sort((a, b) => hdist(a.lair, i) - hdist(b.lair, i))[0];
  const pa = Math.min(0.35, k.bandit[i] / 100 * 0.2 * (0.7 + Math.min(1.5, cv / 400)) * (k.owner[i] >= 0 ? 0.6 : 1));
  if (rngNext(w) < pa) { const b = makeBand(w, 'bandits', i, {str: near ? near.str : 60 + k.bandit[i], gang: near?.id, name: near ? `${near.name}的人` : '一夥盜匪', ttl: 1}); out.encounter = b.id; return; }
  if (k.owner[i] < 0 && k.gameK[i] > 0 && rngNext(w) < 0.06 * k.game[i] / k.gameK[i]) { const b = makeBand(w, 'wolves', i, {ttl: 1}); out.encounter = b.id; }
}
// 附近山寨的人盯上帶著貨的戰幫，派人追過來
function sendBands(w) {
  const k = K(), cv = cargoValue(w);
  if (w.bands.filter(b => b.hunting).length >= 2) return;
  for (const g of k.gangs) {
    if (g.gone || g.str < 100 || hdist(g.lair, w.pos) > 4 || w.bands.some(b => b.gang === g.id)) continue;
    if (rngNext(w) > 0.02 + Math.min(0.1, cv / 3000)) continue;
    makeBand(w, 'bandits', g.lair, {str: g.str, gang: g.id, name: `${g.name}的人`, ttl: 10, hunting: true});
    say(w, `有人看見${g.name}的手下在附近打探你們的行蹤。`);
  }
}
function moveBands(w, out) {
  const mine = partyPower(w.party);
  for (const b of w.bands.slice()) {
    if (b.pos === w.pos) continue;
    if (--b.ttl <= 0) { w.bands = w.bands.filter(x => x !== b); continue; }
    const theirs = partyPower(b.foes);
    if (b.hunting && theirs > mine * 0.7) { const p = findPath(w, b.pos, w.pos); if (p && p.length) b.pos = p[0]; }
    else { const nb = NBR[b.pos].filter(passable); if (nb.length) b.pos = rngPick(w, nb); }
    if (b.pos === w.pos && !out.encounter) out.encounter = b.id;
  }
}
// 付錢消災：貨比錢值錢，他們就要貨
export function tollOf(w) { const cv = cargoValue(w); return cv > w.gold * 0.6 && load(w) > 0 ? {cargo: true} : {gold: Math.max(15, Math.round(w.gold * 0.3))}; }
function loseCargo(w, frac, why) {
  const lost = []; for (const g of GOODS) { const d = Math.ceil(w.cargo[g] * frac); if (d > 0) { w.cargo[g] -= d; lost.push(`${GN[g]} ${d} 包`); } }
  if (lost.length) say(w, `${why}${lost.join('、')}。`); return lost;
}

/* ───────────── 戰鬥銜接 ───────────── */
const battleBiome = i => { const b = K().biome[i]; return b === 6 || b === 9 ? 'forest' : b === 3 || b === 4 ? 'hills' : 'plain'; };
export function battleSetup(w, kind, ref) {
  w.battles++;
  const seed = hashSeed(w.seed, 'b', w.battles);
  if (kind === 'band') { const b = w.bands.find(x => x.id === ref); return {seed, biome: battleBiome(w.pos), foes: b.foes, source: {kind, ref}, title: b.name}; }
  const g = K().gangs.find(x => x.id === ref), lvl = bandLvl(w, g.str) + 1;
  const foes = [makeMember(w, 'chief', lvl + 1, {leader: true, name: `頭目${g.name}`})];
  const n = 3 + Math.min(3, Math.floor(g.str / 100));
  for (let i = 0; i < n; i++) foes.push(makeMember(w, rngPick(w, ['bandit', 'bandit', 'cutthroat', 'poacher']), lvl + (i === 0 ? 1 : 0)));
  return {seed, biome: 'camp', foes, source: {kind: 'gang', ref}, title: `${g.name}的山寨`};
}
export function applyBattle(w, setup, bst) {
  const out = {lines: [], loot: 0}, k = K();
  const units = new Map(bst.units.map(u => [u.id, u]));
  for (const m of w.party.slice()) {
    const u = units.get(m.id); if (!u) continue;
    if (!u.alive) {
      w.party = w.party.filter(x => x !== m);
      if (m.hero) continue;
      w.fallen.push({name: m.name, cls: m.cls, day: w.day, how: u.captured ? '撤退時被俘' : `戰死於${setup.title}`, kills: (m.deeds?.kills || 0) + u.kills});
      out.lines.push(u.captured ? `${m.name}沒能撤出來，被敵人帶走了。` : `${m.name}倒下了，再也沒有起來。`);
      continue;
    }
    for (const kk of ['hp', 'max', 'str', 'skl', 'spd', 'def', 'lvl', 'exp']) m[kk] = u[kk];
    m.deeds = m.deeds || {battles: 0, kills: 0}; m.deeds.battles++; m.deeds.kills += u.kills;
    if (u.levels.length && !m.hero) m.wage = wageOf(m);
    w.kills += u.kills;
  }
  const deaths = bst.units.filter(u => u.side === 'ally' && !u.alive && !u.hero).length;
  const hero = bst.units.find(u => u.hero);
  if (!hero.alive) { w.over = {day: w.day, where: setup.title}; return out; }
  if (bst.result === 'win') {
    const fled = bst.units.filter(u => u.side === 'enemy' && u.fled).length;
    if (setup.source.kind === 'band') {
      const b = w.bands.find(x => x.id === setup.source.ref); out.loot = b ? b.loot : 0; w.bands = w.bands.filter(x => x !== b);
      if (b && b.gang) { const g = k.gangs.find(x => x.id === b.gang); if (g && !g.gone) { k.bandit[g.lair] *= 0.85; g.loot = (g.loot || 0) * 0.8; } }
      if (b && b.kind === 'bandits') k.bandit[w.pos] *= 0.7;
    } else {
      const g = k.gangs.find(x => x.id === setup.source.ref);
      out.loot = Math.round(100 + (g.loot || 0) * 2 + g.str * 0.4 + rngInt(w, 60));
      g.gone = 1; g.to = undefined; k.bandit[g.lair] *= 0.25; for (const n of NBR[g.lair]) k.bandit[n] *= 0.4;
      k.ev.push({y: k.curY, type: 'bandit', text: `一支無名的戰幫攻破了${g.name}的山寨。`, tile: g.lair, ts: k.stamp});
      for (const c of w.contracts) if (c.gang === g.id) { if (c.taken) { c.done = true; out.lines.push(`委託「${c.title}」完成，回${nm(c.town)}領賞。`); } else c.void = true; }
      // 山寨裡藏著的傳奇武器
      for (const wp of k.weapons) if (wp.gang === g.id) {
        wp.gang = 0; wp.holder = 0; wp.fac = -1; wp.lost = false; wp.loc = -1; wp.player = 1;
        wp.hist.push({y: k.curY, t: `一支無名的戰幫攻破${g.name}的山寨，從寨裡搜出了「${wp.name}」。`});
        w.relics.push({id: wp.id, name: wp.name, kind: wp.kind, wins: wp.wins, owners: wp.owners});
        out.lines.push(`在寨子深處搜出一把${wp.kind}——是傳說中的「${wp.name}」！`);
      }
    }
    w.gold += out.loot;
    for (const m of companions(w)) m.loyalty = Math.min(100, m.loyalty + 4 + (out.loot && m.traits.includes('greedy') ? 3 : 0) - deaths * 4);
    out.lines.unshift(`打贏了${fled ? `（${fled} 個敵人逃走）` : ''}。${out.loot ? `搜到 ${out.loot} 金幣。` : ''}`);
  } else if (bst.result === 'retreat') {
    for (const m of companions(w)) m.loyalty = Math.max(0, m.loyalty - 3 - deaths * 4);
    out.lines.unshift('撤退了。');
    if (setup.source.kind === 'band') { const b = w.bands.find(x => x.id === setup.source.ref); if (b && b.kind === 'bandits' && load(w) > 0) { loseCargo(w, 0.5, '撤退時丟下了'); out.lines.push('撤退時丟下了一半的貨。'); } if (b) { b.ttl = 1; b.pos = -1; w.bands = w.bands.filter(x => x !== b); } }
    const back = NBR[w.pos].find(p => passable(p) && !bandAt(w, p)); if (back !== undefined) w.pos = back;
  }
  trimCargo(w);
  w.pendingBattle = null;
  for (const l of out.lines) say(w, l);
  return out;
}

/* ───────────── 行動入口 ───────────── */
export function worldAct(w, a) {
  const out = {lines: []};
  if (w.over) throw new Error('這段旅程已經結束');
  const k = K(), here = siteAt(w, w.pos), town = here?.kind === 'town';
  const needTown = () => { if (!town) throw new Error('要在城鎮的市集'); };
  switch (a.type) {
    case 'travel': {   // 只走一格（相鄰）；長途由畫面一格一格呼叫
      if (!NBR[w.pos].includes(a.to) || !passable(a.to)) throw new Error('到不了');
      const h = hexHours(a.to, k); w.pos = a.to; passHours(w, h, 'travel', out);
      if (!w.over && !out.encounter) onEnter(w, out);
      if (!out.encounter) arrive(w);
      break;
    }
    case 'rest': {
      const inn = town && a.inn !== false, cost = inn ? w.party.length * 2 * a.days : 0;
      if (cost > w.gold) throw new Error('錢不夠住旅店');
      w.gold -= cost; passHours(w, 24 * a.days, inn ? 'inn' : 'camp', out);
      say(w, inn ? `在旅店休息了 ${a.days} 天（${cost} 金幣）。` : `紮營休息了 ${a.days} 天。`);
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
        q = Math.min(q, stockBales(w.pos, g), capacity(w) - load(w));
        if (q <= 0) throw new Error(capacity(w) - load(w) <= 0 ? '扛不動了：多雇人或買騾子' : '市集裡沒貨了');
        const cost = quote(w, w.pos, g, 'buy', q); if (cost > w.gold) throw new Error('錢不夠');
        w.gold -= cost; w.cargo[g] += q; k.markets[w.pos].stock[g] -= q * BALE; addPress(w, w.pos, g, q);
        w.spent = (w.spent || 0) + cost;
        say(w, `在${nm(w.pos)}買進${GN[g]} ${q} 包，花了 ${cost} 金幣。`);
      } else {
        q = Math.min(q, w.cargo[g]); if (q <= 0) throw new Error('身上沒有這種貨');
        const got = quote(w, w.pos, g, 'sell', q);
        w.gold += got; w.cargo[g] -= q; k.markets[w.pos].stock[g] += q * BALE; addPress(w, w.pos, g, -q); w.earned += got;
        say(w, `在${nm(w.pos)}賣出${GN[g]} ${q} 包，得 ${got} 金幣。`);
      }
      noteIntel(w, w.pos, 'seen');
      break;
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
      out.lines.push(...lines.map(l => '聽說' + l + '。'));
      say(w, `在酒館裡請了一輪酒，打聽到：${lines.join('；')}。`);
      break;
    }
    case 'sellRelic': {
      needTown(); const r = w.relics.find(x => x.id === a.id); if (!r) throw new Error('沒有這件東西');
      const wp = k.weapons.find(x => x.id === r.id), f = k.owner[w.pos], price = relicPrice(w, r);
      w.gold += price; w.relics = w.relics.filter(x => x !== r);
      if (wp) { wp.player = 0; wp.fac = f; wp.hist.push({y: k.curY, t: `一支無名的戰幫把「${wp.name}」賣給了${nm(w.pos)}，${facName(f)}收進了寶庫。`}); }
      say(w, `把「${r.name}」賣給了${nm(w.pos)}的權貴，得 ${price} 金幣。`);
      break;
    }
    case 'hire': {
      needTown(); const t = townState(w, w.pos);
      const r = t.recruits.find(x => x.id === a.id); if (!r) throw new Error('人已經不在了');
      if (w.party.length >= MAX_PARTY) throw new Error(`隊伍最多 ${MAX_PARTY} 人`);
      const fee = r.wage * 2; if (fee > w.gold) throw new Error('錢不夠');
      w.gold -= fee; t.recruits = t.recruits.filter(x => x !== r); r.deeds.joinedDay = w.day; w.party.push(r);
      say(w, `花了 ${fee} 金幣，${r.name}（${CLASSES[r.cls].name}）加入了隊伍。`);
      break;
    }
    case 'dismiss': {
      const m = w.party.find(x => x.id === a.id && !x.hero); if (!m) throw new Error('找不到');
      w.party = w.party.filter(x => x !== m); say(w, `${m.name}離開了隊伍。`); trimCargo(w);
      break;
    }
    case 'takeContract': {
      const c = w.contracts.find(x => x.id === a.id); if (!c || c.taken) throw new Error('沒有這份委託'); c.taken = true; say(w, `接下委託：${c.title}。`);
      break;
    }
    case 'claim': {
      needTown();
      const done = w.contracts.filter(c => c.done && c.taken && c.town === w.pos); if (!done.length) throw new Error('這裡沒有可以領的賞金');
      for (const c of done) { w.gold += c.reward; say(w, `領了「${c.title}」的賞金 ${c.reward}。`); }
      w.contracts = w.contracts.filter(c => !done.includes(c));
      break;
    }
    case 'assault': {
      const g = gangAt(w.pos, k); if (!g) throw new Error('這裡沒有山寨');
      out.battle = battleSetup(w, 'gang', g.id); break;
    }
    case 'engage': { out.battle = battleSetup(w, 'band', a.band); break; }
    case 'evade': {
      const b = w.bands.find(x => x.id === a.band); if (!b) break;
      const forest = [6, 9, 3].includes(k.biome[w.pos]);
      const chance = 0.4 + (forest ? 0.2 : 0) + (b.kind === 'wolves' ? -0.15 : 0) - Math.max(0, w.party.length - 3) * 0.05 - w.mules * 0.04;
      if (rngNext(w) < chance) { b.pos = -1; w.bands = w.bands.filter(x => x !== b); out.lines.push('趁著地形甩開了他們。'); say(w, `避開了${b.name}。`); }
      else { out.lines.push('沒能甩開，只能打了。'); out.battle = battleSetup(w, 'band', b.id); }
      break;
    }
    case 'pay': {
      const b = w.bands.find(x => x.id === a.band); if (!b || b.kind !== 'bandits') break;
      const t = tollOf(w);
      if (t.cargo) { loseCargo(w, 0.5, `${b.name}拿走了一半的貨：`); out.lines.push('他們搬走了一半的貨，讓你們過去了。'); }
      else { if (w.gold < t.gold) { out.lines.push('身上的錢不夠買路。'); out.battle = battleSetup(w, 'band', b.id); break; } w.gold -= t.gold; say(w, `付了 ${t.gold} 金幣的過路費。`); }
      for (const m of companions(w)) m.loyalty -= m.traits.includes('reckless') ? 6 : 2;
      const g = b.gang && k.gangs.find(x => x.id === b.gang); if (g && !g.gone) g.loot = (g.loot || 0) + 10;
      w.bands = w.bands.filter(x => x !== b);
      break;
    }
    default: throw new Error('未知的行動');
  }
  if (out.battle) w.pendingBattle = out.battle;
  return out;
}
export const relicPrice = (w, r) => { const k = K(), m = k.markets[w.pos]; return Math.round((400 + r.wins * 12 + r.owners * 20) * (m ? Math.min(1.6, 0.6 + m.pop / 600) : 1)); };
const HOURS = ['深夜', '深夜', '凌晨', '凌晨', '清晨', '清晨', '早上', '早上', '上午', '上午', '上午', '中午', '中午', '下午', '下午', '下午', '傍晚', '傍晚', '黃昏', '晚上', '晚上', '晚上', '深夜', '深夜'];
export const timeText = w => { const m = K().stamp.match(/^(\d+) 年 (\S+) 第(\d+)日/); return `${m[1]}年${m[2]}${m[3]}日・${HOURS[Math.floor(w.hour) % 24]}`; };
export const daysOfFood = w => w.food / Math.max(1, w.party.length + w.mules * MULE_FEED);
