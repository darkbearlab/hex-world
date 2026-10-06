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
// 一格大約是一兩天的路程。季節：冬天路難走（北地更難），春汛時河邊的格子要繞路（有商路的地方有橋）
export const ROAD_MUL = 0.5;   // 有路的格子：走一半的時間（之後改 AP 制時，就是省一半 AP）
export const SEASON_NOTE = ['春汛：河邊不好走', '', '', '冬天：路難走，北地吃得多'];
export const coldAt = i => (C.WS.temp ? C.WS.temp[i] : 1) < 0.45;
export function hexHours(i, k = K()) {
  if (!C.land(i) || k.biome[i] === 2) return Infinity;
  let h = Math.min(72, C.MOVE[k.biome[i]] * 20);
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
  for (const c of k.caravans || []) { if (c.wait > 0) continue; const i = c.path[c.pos]; if (near(i)) out.push({kind: 'caravan', pos: i, fac: c.f, label: `${nm(c.from)}往${nm(c.to)}的${GN[c.g]}商隊`, detail: `載著約 ${Math.round(c.amt / BALE)} 包${GN[c.g]}`}); }
  for (const c of k.carts || []) { if (c.wait > 0) continue; const i = c.path[c.pos]; if (near(i)) out.push({kind: 'cart', pos: i, fac: c.f, label: `往${nm(c.to)}的運貨車`, detail: '村裡的收成要送進城'}); }
  for (const a of armies()) if (near(a.pos)) out.push(a);
  for (const p of w.patrols || []) if (near(p.pos)) out.push({kind: 'patrol', pos: p.pos, fac: p.fac, label: `${k.fac[p.fac]?.n}的巡邏隊`, detail: `${p.size} 人，會趕走盜匪`});
  return out;
}
// 記下親眼看到的行情
function noteIntel(w, i, src) {
  const k = K(), m = k.markets[i]; if (!m) return;
  const p = {}, s = {}; for (const g of GOODS) { p[g] = Math.round(basePrice(i, g, k)); s[g] = stockBales(i, g); }
  w.intel[i] = {day: src === 'seen' ? w.day : w.day - Math.min(12, hdist(i, w.pos)), p, s, src};
  if (src !== 'seen') reveal(w, i, 0);
}

/* ───────────── 新世界 ───────────── */
export function newWorld(seed, heroName) {
  const k = K();
  const w = {v: 2, seed, rng: hashSeed('world', seed), nextId: 1, day: 1, hour: 8, gold: 200, food: 16, log: [], battles: 0, kills: 0, fallen: [], over: null,
    contracts: [], bands: [], towns: {}, vill: {}, press: {}, intel: {}, cargo: {food: 0, wood: 0, iron: 0, stone: 0, salt: 0}, mules: 0, relics: [], leads: [], escort: null, pins: [], seen: new Array(N).fill(0), tick: 0, rumorDay: 0, earned: 0};
  // 從大城開始：人口前五大的市鎮挑一個
  const towns = Object.keys(k.markets).map(Number).filter(i => k.owner[i] >= 0).sort((a, b) => k.markets[b].pop - k.markets[a].pop).slice(0, 5);
  w.pos = towns[rngInt(w, towns.length)];
  w.party = [];
  const h = makeMember(w, 'knight', 2, {id: 'hero', hero: true, name: heroName || '無名的騎士'});
  h.loyalty = 100; h.wage = 0; h.deeds = {battles: 0, kills: 0, joinedDay: 1}; h.sprite = ['people', 'knight'];
  w.party.push(h);
  for (const cls of ['spearman', 'archer', 'herbalist']) w.party.push(makeRecruit(w, cls, 1));
  w.nextWage = 8;
  reveal(w, w.pos, 3);
  arrive(w);
  say(w, `${h.name}帶著三個夥伴，在${facName(k.owner[w.pos])}的${nm(w.pos)}落腳。這是 ${k.stamp.replace(/ \S+$/, '')}。`);
  return w;
}
// 走到委託地點：護送抵達就結算；傭兵、狼害就開打
function arriveJob(w, out) {
  const k = K();
  if (w.escort) { const c = w.contracts.find(x => x.id === w.escort.cid);
    if (c && c.to === w.pos) { const m = k.markets[c.to]; if (m) m.stock[c.g] += c.q * BALE; w.gold += c.reward; w.fame = (w.fame || 0) + 0.5; w.contracts = w.contracts.filter(x => x !== c); w.escort = null;
      for (const p of companions(w)) p.loyalty = Math.min(100, p.loyalty + 3); say(w, `把${GN[c.g]}商隊平安送到${nm(c.to)}，商人付了 ${c.reward} 金幣。`); out.lines.push(`護送完成，拿到 ${c.reward} 金幣。`); } }
  for (const c of w.contracts) if (c.taken && !c.done && (c.kind === 'merc' || c.kind === 'wolves') && c.target === w.pos && !out.battle) { out.battle = battleSetup(w, 'contract', c.id); break; }
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
  return c.kind === 'escort' ? c.to : c.kind === 'deliver' ? c.at : c.target ?? -1;
};
export const KIND_NAME = {gang: '剿匪', escort: '護送', deliver: '收購', merc: '傭兵', wolves: '狼害'};

/* ───────────── 時間流逝 ───────────── */
const RUMOR_TYPES = new Set(['war', 'bandit', 'econ', 'disaster', 'legend', 'hero', 'found']);
function passHours(w, hours, mode, out) {
  for (let i = 0; i < hours; i++) {
    w.hour++;
    w.food = Math.max(0, w.food - eaters(w) / 24 * (K().season === 3 && coldAt(w.pos) ? 1.3 : 1));
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
    w.pins = (w.pins || []).filter(p => w.day - p.day < 12).slice(-30); w.pins.push({tile: e.tile, text: e.text, day: w.day, type: e.type});
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
  for (const c of w.contracts.slice()) if (c.taken && !c.done && c.until < w.day) {
    if (w.escort && w.escort.cid === c.id) failEscort(w, '商隊等不及，另請高明了。');
    else { w.contracts = w.contracts.filter(x => x !== c); say(w, `委託「${c.title}」逾期了。`); }
  }
  for (const m of companions(w).slice()) if (m.loyalty <= 10) { w.party = w.party.filter(x => x !== m); heroGone(w, m, null); say(w, `${m.name}收拾行囊，不告而別。`); trimCargo(w); }
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
  const cv = cargoValue(w) + (w.escort ? w.escort.value : 0), near = k.gangs.filter(g => !g.gone && hdist(g.lair, i) <= 3).sort((a, b) => hdist(a.lair, i) - hdist(b.lair, i))[0];
  const pa = Math.min(0.35, k.bandit[i] / 100 * 0.2 * (0.7 + Math.min(1.5, cv / 400)) * (k.owner[i] >= 0 ? 0.6 : 1));
  if (rngNext(w) < pa) { const b = makeBand(w, 'bandits', i, {str: near ? near.str : 60 + k.bandit[i], gang: near?.id, name: near ? `${near.name}的人` : '一夥盜匪', ttl: 1}); out.encounter = b.id; return; }
  if (k.owner[i] < 0 && k.gameK[i] > 0 && rngNext(w) < 0.06 * k.game[i] / k.gameK[i]) { const b = makeBand(w, 'wolves', i, {ttl: 1}); out.encounter = b.id; }
}
// 附近山寨的人盯上帶著貨的戰幫，派人追過來
function sendBands(w) {
  const k = K(), cv = cargoValue(w) + (w.escort ? w.escort.value : 0);
  // 山寨平常就有人在附近遊蕩：看得到的話可以繞路
  for (const g of k.gangs) {
    if (g.gone || hdist(g.lair, w.pos) > 6 || w.bands.some(b => b.gang === g.id && !b.hunting) || rngNext(w) > 0.12) continue;
    const b = makeBand(w, 'bandits', g.lair, {str: g.str * 0.7, gang: g.id, name: `${g.name}的嘍囉`, ttl: 14}); b.home = g.lair;
  }
  // 各國的巡邏隊：從附近的城出發，在自己的國土上走動，趕走盜匪
  w.patrols = (w.patrols || []).filter(p => --p.ttl > 0);
  for (const p of w.patrols) {
    const nb = NBR[p.pos].filter(n => k.owner[n] === p.fac && passable(n)); if (nb.length) p.pos = rngPick(w, nb);
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
    else { const nb = NBR[b.pos].filter(n => passable(n) && (b.home == null || hdist(n, b.home) <= 3)); if (nb.length) b.pos = rngPick(w, nb); }
    if (b.pos === w.pos && !out.encounter) out.encounter = b.id;
  }
}
// 付錢消災：貨比錢值錢，他們就要貨
export function tollOf(w) { if (w.escort) return {escort: true}; const cv = cargoValue(w); return cv > w.gold * 0.6 && load(w) > 0 ? {cargo: true} : {gold: Math.max(15, Math.round(w.gold * 0.3))}; }
function loseCargo(w, frac, why) {
  const lost = []; for (const g of GOODS) { const d = Math.ceil(w.cargo[g] * frac); if (d > 0) { w.cargo[g] -= d; lost.push(`${GN[g]} ${d} 包`); } }
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
  if (kind === 'band') { const b = w.bands.find(x => x.id === ref); return {seed, biome: battleBiome(w.pos), foes: b.foes, source: {kind, ref}, title: b.name}; }
  if (kind === 'contract') {
    const c = w.contracts.find(x => x.id === ref), k = K(), lvl = 1 + Math.floor(w.day / 12), foes = [];
    if (c.kind === 'wolves') { const n = 3 + rngInt(w, 2); for (let i = 0; i < n; i++) foes.push(makeMember(w, 'wolf', lvl)); foes.push(makeMember(w, rngNext(w) < 0.5 ? 'bear' : 'boar', lvl + 1, {leader: true})); return {seed, biome: 'forest', foes, source: {kind, ref}, title: c.title}; }
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
export function applyBattle(w, setup, bst) {
  const out = {lines: [], loot: 0}, k = K();
  const units = new Map(bst.units.map(u => [u.id, u]));
  for (const m of w.party.slice()) {
    const u = units.get(m.id); if (!u) continue;
    if (!u.alive) {
      w.party = w.party.filter(x => x !== m);
      if (m.hero) continue;
      heroGone(w, m, `隨一支戰幫戰死於${setup.title}`, true);
      w.fallen.push({name: m.name, cls: m.cls, day: w.day, how: u.captured ? '撤退時被俘' : `戰死於${setup.title}`, kills: (m.deeds?.kills || 0) + u.kills});
      out.lines.push(u.captured ? `${m.name}沒能撤出來，被敵人帶走了。` : `${m.name}倒下了，再也沒有起來。`);
      continue;
    }
    const bo = gearBonus(w, m); for (const kk of ['hp', 'max', 'str', 'skl', 'spd', 'def', 'lvl', 'exp']) m[kk] = u[kk] - (bo[kk] || 0);
    m.deeds = m.deeds || {battles: 0, kills: 0}; m.deeds.battles++; m.deeds.kills += u.kills;
    if (u.levels.length && !m.hero) m.wage = wageOf(m);
    w.kills += u.kills;
  }
  const deaths = bst.units.filter(u => u.side === 'ally' && !u.alive && !u.hero).length;
  const hero = bst.units.find(u => u.hero);
  if (!hero.alive) { w.over = {day: w.day, where: setup.title}; return out; }
  if (bst.result === 'win') {
    const fled = bst.units.filter(u => u.side === 'enemy' && u.fled).length;
    if (setup.source.kind === 'contract') {
      const c = w.contracts.find(x => x.id === setup.source.ref), k = K();
      if (c) { c.done = true; w.fame = (w.fame || 0) + (c.kind === 'merc' ? 1 : 0.5); out.lines.push(`委託「${c.title}」完成，回${nm(c.town)}（或${facName(k.owner[c.town])}的其他城）領賞。`);
        if (c.kind === 'merc') { const a = Math.min(c.fac, c.enemy), b = Math.max(c.fac, c.enemy), Wr = k.war[a][b]; if (Wr) Wr.score = (Wr.score || 0) + (Wr.att === c.fac ? 2 : -2);
          k.ev.push({y: k.curY, type: 'war', text: `一支傭兵戰幫替${k.fac[c.fac].n}在${nm(w.pos)}擊潰了${k.fac[c.enemy].n}的守軍。`, tile: w.pos, ts: k.stamp}); }
        else { k.game[w.pos] *= 0.5; } }
      out.loot = c && c.kind === 'merc' ? 30 + rngInt(w, 40) : 0;
    } else if (setup.source.kind === 'band') {
      const b = w.bands.find(x => x.id === setup.source.ref); out.loot = b ? b.loot : 0; w.bands = w.bands.filter(x => x !== b);
      if (b && b.gang) { const g = k.gangs.find(x => x.id === b.gang); if (g && !g.gone) { k.bandit[g.lair] *= 0.85; g.loot = (g.loot || 0) * 0.8; } }
      if (b && b.kind === 'bandits') k.bandit[w.pos] *= 0.7;
    } else {
      const g = k.gangs.find(x => x.id === setup.source.ref);
      out.loot = Math.round(100 + (g.loot || 0) * 2 + g.str * 0.4 + rngInt(w, 60));
      g.gone = 1; g.to = undefined; w.fame = (w.fame || 0) + 2; k.bandit[g.lair] *= 0.25; for (const n of NBR[g.lair]) k.bandit[n] *= 0.4;
      k.ev.push({y: k.curY, type: 'bandit', text: `一支無名的戰幫攻破了${g.name}的山寨。`, tile: g.lair, ts: k.stamp});
      for (const c of w.contracts) if (c.gang === g.id) { if (c.taken) { c.done = true; out.lines.push(`委託「${c.title}」完成，回${nm(c.town)}（或${facName(k.owner[c.town])}的其他城）領賞。`); } else c.void = true; }
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
    if (setup.source.kind === 'band' && w.escort) failEscort(w, '撤退時丟下了商隊，貨被搶光。');
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
  w.leads ||= []; if (w.escort === undefined) w.escort = null;
  const k = K(), here = siteAt(w, w.pos), town = here?.kind === 'town';
  const needTown = () => { if (!town) throw new Error('要在城鎮的市集'); };
  switch (a.type) {
    case 'travel': {   // 只走一格（相鄰）；長途由畫面一格一格呼叫
      if (!NBR[w.pos].includes(a.to) || !passable(a.to)) throw new Error('到不了');
      const h = legHours(w, a.to, k); w.pos = a.to; reveal(w, w.pos, sightOf(w.pos)); passHours(w, h, 'travel', out);
      if (!w.over && !out.encounter) onEnter(w, out);
      if (!out.encounter) { arriveJob(w, out); arrive(w); }
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
      wp.hist.push({y: k.curY, t: `失落多年後，一支無名的戰幫在${nm(w.pos)}${spot === wp.shore ? '的水邊' : ''}找到了「${wp.name}」。`});
      w.relics.push({id: wp.id, name: wp.name, kind: wp.kind, wins: wp.wins, owners: wp.owners});
      w.leads = w.leads.filter(x => x !== L); w.fame = (w.fame || 0) + 2;
      say(w, `在${nm(w.pos)}找到了傳說中的「${wp.name}」！`); out.lines.push(`找到了「${wp.name}」！`);
      break;
    }
    case 'buyMap': {
      needTown(); if (w.gold < MAP_PRICE) throw new Error('錢不夠');
      w.gold -= MAP_PRICE; reveal(w, w.pos, 6); say(w, `在${nm(w.pos)}買了一張附近的地圖（${MAP_PRICE} 金幣）。`); break;
    }
    case 'gear': {
      needTown(); const m = w.party.find(x => x.id === a.id); if (!m) throw new Error('找不到人');
      const key = a.kind === 'w' ? 'gw' : 'ga', tier = (m[key] || 0) + 1; if (tier > 3) throw new Error('已經是最好的了');
      if (stockBales(w.pos, 'iron') < tier) throw new Error('鐵匠沒鐵了，打不出來');
      const cost = gearPrice(w.pos, a.kind, tier); if (cost > w.gold) throw new Error('錢不夠');
      w.gold -= cost; m[key] = tier; k.markets[w.pos].stock.iron -= tier * BALE;
      say(w, `在${nm(w.pos)}的鐵匠鋪替${m.name}換上${GEAR_NAME[a.kind][tier]}（${cost} 金幣）。`); break;
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
      w.party = w.party.filter(x => x !== m); heroGone(w, m, null); say(w, `${m.name}離開了隊伍。`); trimCargo(w);
      break;
    }
    case 'takeContract': {
      const c = w.contracts.find(x => x.id === a.id); if (!c || c.taken) throw new Error('沒有這份委託');
      if (c.kind === 'deliver') throw new Error('收購不用接，直接把貨送到就行');
      if (c.kind === 'escort') { if (w.escort) throw new Error('一次只能護送一支商隊'); if (w.pos !== c.town) throw new Error('要在出發的城接'); w.escort = {cid: c.id, to: c.to, value: c.value}; }
      c.taken = true; say(w, `接下委託：${c.title}。`);
      break;
    }
    case 'claim': {
      needTown();
      const done = w.contracts.filter(c => canClaimHere(w, c)); if (!done.length) { const far = w.contracts.find(c => c.done && c.taken); throw new Error(far ? `賞金要回${C.nm(far.town)}（或${facName(K().owner[far.town])}的其他城）領` : '沒有可以領的賞金'); }
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
      const chance = 0.4 + (forest ? 0.2 : 0) + (b.kind === 'wolves' ? -0.15 : 0) - Math.max(0, w.party.length - 3) * 0.05 - w.mules * 0.04 + (mounted(w) ? 0.15 : 0);
      if (rngNext(w) < chance) { b.pos = -1; w.bands = w.bands.filter(x => x !== b); out.lines.push('趁著地形甩開了他們。'); say(w, `避開了${b.name}。`); }
      else { out.lines.push('沒能甩開，只能打了。'); out.battle = battleSetup(w, 'band', b.id); }
      break;
    }
    case 'pay': {
      const b = w.bands.find(x => x.id === a.band); if (!b || b.kind !== 'bandits') break;
      const t = tollOf(w);
      if (t.escort) { failEscort(w, `${b.name}劫走了護送的貨，`); out.lines.push('他們拉走了商隊的貨，放你們走了。'); }
      else if (t.cargo) { loseCargo(w, 0.5, `${b.name}拿走了一半的貨：`); out.lines.push('他們搬走了一半的貨，讓你們過去了。'); }
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
export const fameWord = f => !f ? '沒沒無聞' : f < 1 ? '小有耳聞' : f < 3 ? '有些名氣' : f < 6 ? '遠近馳名' : '名震一方';
export const eaters = w => w.party.length + w.mules * MULE_FEED + (w.horses || 0) * HORSE_FEED;
export const daysOfFood = w => w.food / Math.max(1, eaters(w));

/* ───────────── 裝備、馬、傳奇武器 ───────────── */
export const GEAR_NAME = {w: ['舊兵器', '精鐵兵器', '名匠兵器', '大師兵器'], a: ['布衣', '皮甲', '鎖子甲', '板甲']};
// 上戰場時加上的數值；回來時要扣掉，才不會疊上去
export function gearBonus(w, m) {
  const b = {str: m.gw || 0, def: m.ga || 0};
  if ((w.relics || []).some(r => r.equip === m.id) || m.relicW) b.str += 2;
  return b;
}
export const battleParty = w => w.party.map(m => { const b = gearBonus(w, m); return {...m, str: m.str + b.str, def: m.def + b.def}; });
const ironMul = (i, k = K()) => Math.max(0.6, Math.min(2.5, k.markets[i].price.iron));
export const gearPrice = (i, kind, tier) => Math.round((kind === 'w' ? 35 : 45) * tier * (0.5 + 0.5 * ironMul(i)));
export const mounted = w => (w.horses || 0) >= w.party.length && w.party.length > 0;
export const legHours = (w, i, k = K()) => { const h = hexHours(i, k); if (!mounted(w) || h === Infinity) return h; const b = k.biome[i]; return Math.round(h * (b === 6 || b === 3 || b === 9 ? 0.85 : 0.65)); };
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
  k.ev.push({y: k.curY, type: 'hero', text: `${k.fac[h.f]?.n || ''}的${h.name}離開了故國，加入了一支無名的戰幫。`, tile: w.pos, ts: k.stamp});
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
