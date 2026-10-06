// 奇幻戰幫切片：世界層（小型六角地圖、時間、糧食、薪餉、山賊與狼群、委託、招募）
// 純規則；行動入口是 worldAct(w, action)，回傳訊息與（若有）要開打的戰鬥。
import {CLASSES, RECRUIT_CLASSES, TRAITS, TRAIT_KEYS, NAMES, SURNAMES, rngNext, rngInt, rngPick, hashSeed} from './data.js';

export const MW = 11, MH = 14;
const idx = (q, r) => r * MW + q;
const inM = (q, r) => q >= 0 && r >= 0 && q < MW && r < MH;
// 尖頂六角、奇數列右移（odd-r）
export function hexNeighbors(q, r) {
  const odd = r & 1;
  const d = odd ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
  return d.map(([dq, dr]) => [q + dq, r + dr]).filter(([a, b]) => inM(a, b));
}
const toCube = (q, r) => { const x = q - (r - (r & 1)) / 2; return [x, r, -x - r]; };
export const hexDist = (a, b) => { const [x1, y1, z1] = toCube(a[0], a[1]), [x2, y2, z2] = toCube(b[0], b[1]); return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2)); };

export const HEX = {
  plain: {name: '平原', hours: 5, biome: 'plain'},
  forest: {name: '森林', hours: 8, biome: 'forest'},
  hills: {name: '丘陵', hours: 9, biome: 'hills'},
  mountain: {name: '山', hours: Infinity},
  lake: {name: '湖', hours: Infinity},
};
const ROAD_HOURS = 3;
export const hexHours = (w, q, r) => w.road[idx(q, r)] ? ROAD_HOURS : HEX[w.tiles[idx(q, r)]].hours;

const TOWN_NAMES = ['灰石鎮'], VILLAGE_NAMES = ['麥田村', '老橋村', '鹽沼村', '紅泥村'], CAMP_NAMES = ['黑溪寨', '狼嶺寨'];

/* ───────────── 人 ───────────── */
let uidCounter = 0;
export function makeMember(w, cls, lvl, opts = {}) {
  const c = CLASSES[cls], b = c.base, g = c.grow;
  const m = {id: opts.id || `${cls}-${w.seed}-${w.nextId++}`, cls, sprite: rngPick(w, c.sprites), lvl: 1, exp: 0, max: b.hp, hp: b.hp, str: b.str, skl: b.skl, spd: b.spd, def: b.def, mov: b.mov, weapon: c.weapon, traits: [], loyalty: 100, ...opts};
  // 個體差異
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

/* ───────────── 新世界 ───────────── */
export function newWorld(seed, heroName) {
  const w = {v: 1, seed, rng: hashSeed('world', seed), nextId: 1, day: 1, hour: 8, gold: 120, food: 14, log: [], battles: 0, kills: 0, fallen: [], over: null, contracts: [], bands: [], nextBand: 3};
  // 地形：用幾個種子點長出森林、丘陵、山、湖
  const t = new Array(MW * MH).fill('plain');
  const grow = (kind, n, size) => { for (let i = 0; i < n; i++) { let q = rngInt(w, MW), r = rngInt(w, MH); for (let s = 0; s < size; s++) { t[idx(q, r)] = kind; const nb = hexNeighbors(q, r); [q, r] = rngPick(w, nb); } } };
  grow('forest', 7, 9); grow('hills', 4, 7); grow('mountain', 3, 4); grow('lake', 1, 3);
  w.tiles = t; w.road = new Array(MW * MH).fill(0);
  // 據點
  const free = (pred) => { for (let tries = 0; tries < 500; tries++) { const q = rngInt(w, MW), r = rngInt(w, MH); if (HEX[t[idx(q, r)]].hours < Infinity && !w.sites?.some(s => hexDist(s.pos, [q, r]) < 3) && pred([q, r])) return [q, r]; } return null; };
  w.sites = [];
  const center = [5, 7];
  const town = free(p => hexDist(p, center) <= 2) || center; t[idx(...town)] = 'plain';
  w.sites.push({id: 'town', kind: 'town', name: TOWN_NAMES[0], pos: town, foodPrice: 2, recruits: [], nextRecruit: 1});
  for (let i = 0; i < 3; i++) { const p = free(p => hexDist(p, town) >= 3 && hexDist(p, town) <= 6); if (p) { t[idx(...p)] = 'plain'; w.sites.push({id: 'v' + i, kind: 'village', name: VILLAGE_NAMES[i], pos: p, food: 30, foodPrice: 1, raided: 0}); } }
  for (let i = 0; i < 2; i++) { const p = free(p => hexDist(p, town) >= 5); if (p) w.sites.push({id: 'c' + i, kind: 'camp', name: CAMP_NAMES[i], pos: p, alive: true, power: 0}); }
  const den = free(p => hexDist(p, town) >= 3 && t[idx(...p)] === 'forest') || free(p => hexDist(p, town) >= 3);
  if (den) w.sites.push({id: 'den', kind: 'den', name: '狼穴', pos: den, alive: true});
  // 路：從鎮上連到每個村莊
  for (const s of w.sites.filter(s => s.kind === 'village')) for (const [q, r] of findPath(w, town, s.pos, true) || []) w.road[idx(q, r)] = 1;
  // 隊伍
  w.party = [];
  const h = makeMember(w, 'knight', 2, {id: 'hero', hero: true, name: heroName || '無名的騎士'});
  h.loyalty = 100; h.wage = 0; h.deeds = {battles: 0, kills: 0, joinedDay: 1}; h.sprite = ['people', 'knight'];
  w.party.push(h);
  for (const cls of ['spearman', 'archer', 'herbalist']) w.party.push(makeRecruit(w, cls, 1));
  w.pos = town.slice();
  w.nextWage = 8;
  refreshRecruits(w); refreshContracts(w);
  say(w, `${h.name}帶著三個夥伴，在${TOWN_NAMES[0]}落腳。錢只夠撐一陣子。`);
  return w;
}
const say = (w, text) => { w.log.unshift({day: w.day, text}); if (w.log.length > 60) w.log.length = 60; };
export const town = w => w.sites.find(s => s.kind === 'town');
export const siteAt = (w, p) => w.sites.find(s => s.pos[0] === p[0] && s.pos[1] === p[1] && (s.kind !== 'camp' && s.kind !== 'den' || s.alive));
export const bandAt = (w, p) => w.bands.find(b => b.pos[0] === p[0] && b.pos[1] === p[1]);

function refreshRecruits(w) {
  const t = town(w); t.recruits = [];
  for (let i = 0; i < 3; i++) t.recruits.push(makeRecruit(w, rngPick(w, RECRUIT_CLASSES), 1 + (rngNext(w) < 0.3 ? 1 : 0) + (rngNext(w) < 0.1 ? 1 : 0)));
  t.nextRecruit = w.day + 5;
}
function refreshContracts(w) {
  w.contracts = w.contracts.filter(c => c.taken || c.until >= w.day);
  for (const s of w.sites.filter(s => s.kind === 'camp' && s.alive)) if (!w.contracts.some(c => c.site === s.id)) w.contracts.push({id: 'k' + w.nextId++, kind: 'camp', site: s.id, title: `剿滅${s.name}`, reward: 220, until: w.day + 20, taken: false, done: false});
  const den = w.sites.find(s => s.kind === 'den' && s.alive);
  if (den && !w.contracts.some(c => c.site === den.id)) w.contracts.push({id: 'k' + w.nextId++, kind: 'den', site: den.id, title: '清掉狼穴', reward: 110, until: w.day + 20, taken: false, done: false});
}

/* ───────────── 路徑 ───────────── */
export function findPath(w, from, to, ignoreRoad) {
  const best = new Map([[idx(...from), 0]]), prev = new Map(), q = [[0, ...from]];
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]); const [c, x, y] = q.shift();
    if (x === to[0] && y === to[1]) break;
    if (c > best.get(idx(x, y))) continue;
    for (const [nx, ny] of hexNeighbors(x, y)) {
      const h = ignoreRoad ? HEX[w.tiles[idx(nx, ny)]].hours : hexHours(w, nx, ny); if (h === Infinity) continue;
      const nc = c + h; if (nc < (best.get(idx(nx, ny)) ?? Infinity)) { best.set(idx(nx, ny), nc); prev.set(idx(nx, ny), idx(x, y)); q.push([nc, nx, ny]); }
    }
  }
  if (!best.has(idx(...to))) return null;
  const out = []; let k = idx(...to);
  while (k !== idx(...from)) { out.unshift([k % MW, (k / MW) | 0]); k = prev.get(k); }
  return out;
}

/* ───────────── 時間流逝 ───────────── */
const companions = w => w.party.filter(m => !m.hero);
function passHours(w, hours, mode, out) {
  for (let i = 0; i < hours; i++) {
    w.hour++;
    w.food = Math.max(0, w.food - w.party.length / 24);
    // 療傷：每小時一點點；旅店最快，紮營次之，趕路最慢
    const rate = mode === 'inn' ? 0.5 : mode === 'camp' ? 0.2 : 0.08;
    for (const m of w.party) m.hp = Math.min(m.max, m.hp + m.max * rate / 24);
    moveBands(w, out);
    if (w.hour >= 24) { w.hour = 0; w.day++; newDay(w, out, mode); if (w.over) return; }
    const b = bandAt(w, w.pos);
    if (b && !out.encounter) { out.encounter = b.id; return; }
  }
}
function newDay(w, out, mode) {
  for (const m of w.party) m.hp = Math.round(m.hp);
  if (w.food <= 0) {
    say(w, '糧食吃光了，大家餓著肚子。');
    for (const m of w.party) { m.hp = Math.max(1, m.hp - Math.ceil(m.max * 0.15)); if (!m.hero) m.loyalty -= 8; }
  }
  if (mode === 'inn') for (const m of companions(w)) m.loyalty = Math.min(100, m.loyalty + 2);
  if (w.day >= w.nextWage) payday(w);
  // 忠誠太低就走人
  for (const m of companions(w).slice()) if (m.loyalty <= 10) { w.party = w.party.filter(x => x !== m); say(w, `${m.name}收拾行囊，不告而別。`); }
  // 據點與山賊
  const t = town(w);
  if (w.day >= t.nextRecruit) refreshRecruits(w);
  t.foodPrice = Math.min(4, 2 + w.sites.filter(s => s.kind === 'village' && s.raided > w.day).length);
  for (const v of w.sites.filter(s => s.kind === 'village')) v.foodPrice = v.raided > w.day ? 2 : 1;
  for (const v of w.sites.filter(s => s.kind === 'village')) v.food = Math.min(40, v.food + 3);
  if (w.day >= w.nextBand) { spawnBand(w); w.nextBand = w.day + 3 + rngInt(w, 3); }
  refreshContracts(w);
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
function spawnBand(w) {
  const camps = w.sites.filter(s => s.kind === 'camp' && s.alive);
  if (camps.length && w.bands.filter(b => b.kind === 'bandits').length < 3) {
    const c = rngPick(w, camps), n = 2 + rngInt(w, 3), lvl = 1 + Math.floor(w.day / 12);
    const foes = []; for (let i = 0; i < n; i++) foes.push(makeMember(w, rngPick(w, ['bandit', 'bandit', 'cutthroat', 'poacher']), lvl + (rngNext(w) < 0.3 ? 1 : 0)));
    const target = rngPick(w, w.sites.filter(s => s.kind === 'village'));
    w.bands.push({id: 'b' + w.nextId++, kind: 'bandits', name: `${c.name}的山賊`, pos: c.pos.slice(), home: c.id, target: target.id, foes, speed: 6, clock: 0, loot: 20 + rngInt(w, 40)});
  }
  const den = w.sites.find(s => s.kind === 'den' && s.alive);
  if (den && w.bands.filter(b => b.kind === 'wolves').length < 1 && rngNext(w) < 0.6) {
    const foes = []; for (let i = 0; i < 2 + rngInt(w, 2); i++) foes.push(makeMember(w, 'wolf', 1 + Math.floor(w.day / 15)));
    w.bands.push({id: 'b' + w.nextId++, kind: 'wolves', name: '狼群', pos: den.pos.slice(), home: den.id, foes, speed: 5, clock: 0, loot: 0, wander: 6});
  }
}
function moveBands(w, out) {
  const mine = partyPower(w.party);
  for (const b of w.bands.slice()) {
    b.clock++; if (b.clock < b.speed) continue; b.clock = 0;
    let goal;
    const theirs = partyPower(b.foes), d = hexDist(b.pos, w.pos);
    if (b.kind === 'bandits' && !w.sites.some(s => s.id === b.target && (s.kind === 'village' || s.alive))) b.target = rngPick(w, w.sites.filter(s => s.kind === 'village')).id;
    if (b.kind === 'bandits' && d <= 2 && theirs > mine * 0.8) goal = w.pos;            // 覺得打得贏就來搶
    else if (b.kind === 'bandits' && d <= 1 && theirs < mine * 0.5) goal = null;        // 打不贏就躲
    else if (b.kind === 'bandits') goal = (w.sites.find(s => s.id === b.target) || {}).pos;
    else { if (--b.wander <= 0) { w.bands = w.bands.filter(x => x !== b); continue; } goal = d <= 2 ? w.pos : rngPick(w, hexNeighbors(...b.pos)); }
    if (!goal) { const away = hexNeighbors(...b.pos).filter(p => HEX[w.tiles[idx(...p)]].hours < Infinity).sort((a, c) => hexDist(c, w.pos) - hexDist(a, w.pos))[0]; if (away) b.pos = away; continue; }
    const path = findPath(w, b.pos, goal); if (path && path.length) b.pos = path[0];
    if (b.kind === 'bandits' && b.target && b.pos[0] === goal[0] && b.pos[1] === goal[1] && goal !== w.pos) {
      const v = w.sites.find(s => s.id === b.target);
      if (v && v.kind === 'village') { v.raided = w.day + 6; v.food = Math.max(0, v.food - 15); say(w, `${b.name}洗劫了${v.name}。`); b.loot += 30; b.target = b.home;
        if (!w.contracts.some(c => c.band === b.id)) w.contracts.push({id: 'k' + w.nextId++, kind: 'band', band: b.id, title: `討伐洗劫${v.name}的山賊`, reward: 60 + b.foes.length * 10, until: w.day + 12, taken: false, done: false}); }
      else if (v && v.kind === 'camp') { w.bands = w.bands.filter(x => x !== b); }
    }
  }
}

/* ───────────── 戰鬥銜接 ───────────── */
export function battleSetup(w, kind, ref) {
  w.battles++;
  const seed = hashSeed(w.seed, 'b', w.battles);
  if (kind === 'band') {
    const b = w.bands.find(x => x.id === ref);
    return {seed, biome: HEX[w.tiles[idx(...w.pos)]].biome || 'plain', foes: b.foes, source: {kind, ref}, title: b.name};
  }
  const s = w.sites.find(x => x.id === ref), lvl = 1 + Math.floor(w.day / 10);
  if (s.kind === 'camp') {
    const foes = [makeMember(w, 'chief', lvl + 2, {leader: true, name: `${s.name}的頭目`})];
    for (let i = 0; i < 4; i++) foes.push(makeMember(w, rngPick(w, ['bandit', 'bandit', 'cutthroat', 'poacher']), lvl + (i === 0 ? 1 : 0)));
    return {seed, biome: 'camp', foes, source: {kind: 'site', ref}, title: s.name};
  }
  const foes = [makeMember(w, 'wolf', lvl), makeMember(w, 'wolf', lvl), makeMember(w, 'wolf', lvl + 1)];
  if (rngNext(w) < 0.5) foes.push(makeMember(w, 'bear', lvl + 1, {leader: true}));
  return {seed, biome: 'forest', foes, source: {kind: 'site', ref}, title: s.name};
}
// 把戰鬥結果寫回世界
export function applyBattle(w, setup, bst) {
  const out = {lines: [], loot: 0};
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
    for (const k of ['hp', 'max', 'str', 'skl', 'spd', 'def', 'lvl', 'exp']) m[k] = u[k];
    m.deeds = m.deeds || {battles: 0, kills: 0}; m.deeds.battles++; m.deeds.kills += u.kills;
    if (u.levels.length && !m.hero) { m.wage = wageOf(m); }
    w.kills += u.kills;
  }
  const deaths = bst.units.filter(u => u.side === 'ally' && !u.alive && !u.hero).length;
  const hero = bst.units.find(u => u.hero);
  if (!hero.alive) { w.over = {day: w.day, where: setup.title}; return out; }
  if (bst.result === 'win') {
    const fled = bst.units.filter(u => u.side === 'enemy' && u.fled).length;
    if (setup.source.kind === 'band') {
      const b = w.bands.find(x => x.id === setup.source.ref); out.loot = b ? b.loot : 0; w.bands = w.bands.filter(x => x !== b);
      const c = w.contracts.find(c => c.band === setup.source.ref); if (c) { c.done = true; c.taken = true; out.lines.push(`懸賞「${c.title}」達成，回鎮上領賞。`); }
    } else {
      const s = w.sites.find(x => x.id === setup.source.ref); s.alive = false; out.loot = s.kind === 'camp' ? 120 + rngInt(w, 80) : 0;
      const c = w.contracts.find(c => c.site === s.id && c.taken); if (c) { c.done = true; out.lines.push(`委託「${c.title}」完成，回鎮上領賞。`); }
    }
    w.gold += out.loot;
    for (const m of companions(w)) m.loyalty = Math.min(100, m.loyalty + 4 + (out.loot && m.traits.includes('greedy') ? 3 : 0) - deaths * 4);
    out.lines.unshift(`打贏了${fled ? `（${fled} 個敵人逃走）` : ''}。${out.loot ? `搜到 ${out.loot} 金幣。` : ''}`);
  } else if (bst.result === 'retreat') {
    for (const m of companions(w)) m.loyalty = Math.max(0, m.loyalty - 3 - deaths * 4);
    out.lines.unshift('撤退了。');
    const back = hexNeighbors(...w.pos).find(p => HEX[w.tiles[idx(...p)]].hours < Infinity && !bandAt(w, p)); if (back) w.pos = back;
  }
  w.pendingBattle = null;
  for (const l of out.lines) say(w, l);
  return out;
}

/* ───────────── 行動入口 ───────────── */
export function worldAct(w, a) {
  const out = {lines: []};
  if (w.over) throw new Error('這段旅程已經結束');
  const here = siteAt(w, w.pos);
  switch (a.type) {
    case 'travel': {
      const path = findPath(w, w.pos, a.to); if (!path) throw new Error('到不了');
      for (const p of path) {
        const h = hexHours(w, ...p); w.pos = p.slice(); passHours(w, h, 'travel', out);
        if (w.over || out.encounter) break;
      }
      break;
    }
    case 'rest': {
      const inn = here && here.kind === 'town' && a.inn !== false, cost = inn ? w.party.length * 2 * a.days : 0;
      if (cost > w.gold) throw new Error('錢不夠住旅店');
      w.gold -= cost; passHours(w, 24 * a.days, inn ? 'inn' : 'camp', out);
      say(w, inn ? `在旅店休息了 ${a.days} 天（${cost} 金幣）。` : `紮營休息了 ${a.days} 天。`);
      break;
    }
    case 'buyFood': {
      if (!here || (here.kind !== 'town' && here.kind !== 'village')) throw new Error('這裡沒有市集');
      const n = Math.min(a.n, here.kind === 'village' ? here.food : 999), cost = n * here.foodPrice;
      if (n <= 0) throw new Error('村裡沒糧可賣了'); if (cost > w.gold) throw new Error('錢不夠');
      w.gold -= cost; w.food += n; if (here.kind === 'village') here.food -= n;
      say(w, `買了 ${n} 份口糧（${cost} 金幣）。`);
      break;
    }
    case 'hire': {
      const t = town(w); if (here !== t) throw new Error('要在鎮上的酒館');
      const r = t.recruits.find(x => x.id === a.id); if (!r) throw new Error('人已經不在了');
      if (w.party.length >= 6) throw new Error('隊伍最多 6 人');
      const fee = r.wage * 2; if (fee > w.gold) throw new Error('錢不夠');
      w.gold -= fee; t.recruits = t.recruits.filter(x => x !== r); r.deeds.joinedDay = w.day; w.party.push(r);
      say(w, `花了 ${fee} 金幣，${r.name}（${CLASSES[r.cls].name}）加入了隊伍。`);
      break;
    }
    case 'dismiss': {
      const m = w.party.find(x => x.id === a.id && !x.hero); if (!m) throw new Error('找不到');
      w.party = w.party.filter(x => x !== m); say(w, `${m.name}離開了隊伍。`);
      break;
    }
    case 'takeContract': {
      const c = w.contracts.find(x => x.id === a.id); if (!c || c.taken) throw new Error('沒有這份委託'); c.taken = true; say(w, `接下委託：${c.title}。`);
      break;
    }
    case 'claim': {
      if (here !== town(w)) throw new Error('要回鎮上領賞');
      const done = w.contracts.filter(c => c.done && c.taken); if (!done.length) throw new Error('沒有可以領的賞金');
      for (const c of done) { w.gold += c.reward; say(w, `領了「${c.title}」的賞金 ${c.reward}。`); }
      w.contracts = w.contracts.filter(c => !(c.done && c.taken));
      break;
    }
    case 'assault': {
      const s = w.sites.find(x => x.id === a.site); if (!s || !s.alive || hexDist(s.pos, w.pos) !== 0) throw new Error('不在那裡');
      out.battle = battleSetup(w, 'site', s.id); break;
    }
    case 'engage': { out.battle = battleSetup(w, 'band', a.band); break; }
    case 'evade': {
      const b = w.bands.find(x => x.id === a.band); if (!b) break;
      const chance = 0.35 + (w.tiles[idx(...w.pos)] === 'forest' ? 0.25 : 0) + (b.kind === 'wolves' ? -0.15 : 0) - Math.max(0, w.party.length - 3) * 0.05;
      if (rngNext(w) < chance) { const away = hexNeighbors(...w.pos).filter(p => HEX[w.tiles[idx(...p)]].hours < Infinity && !bandAt(w, p)); if (away.length) w.pos = rngPick(w, away); out.lines.push('趁著地形甩開了他們。'); say(w, `避開了${b.name}。`); }
      else { out.lines.push('沒能甩開，只能打了。'); out.battle = battleSetup(w, 'band', b.id); }
      break;
    }
    case 'pay': {
      const b = w.bands.find(x => x.id === a.band); if (!b || b.kind !== 'bandits') break;
      const toll = Math.max(15, Math.round(w.gold * 0.3)); if (w.gold < toll) { out.lines.push('身上的錢不夠買路。'); out.battle = battleSetup(w, 'band', b.id); break; }
      w.gold -= toll; b.loot += toll; for (const m of companions(w)) m.loyalty -= m.traits.includes('reckless') ? 6 : 2;
      const away = hexNeighbors(...w.pos).filter(p => HEX[w.tiles[idx(...p)]].hours < Infinity && !bandAt(w, p)); b.pos = away.length ? rngPick(w, away) : b.pos;
      say(w, `付了 ${toll} 金幣的過路費。`); break;
    }
    default: throw new Error('未知的行動');
  }
  if (out.battle) w.pendingBattle = out.battle;
  out.lines.push(...[]);
  return out;
}
export const timeText = w => `第 ${w.day} 天 ${['深夜', '深夜', '凌晨', '凌晨', '清晨', '清晨', '早上', '早上', '上午', '上午', '上午', '中午', '中午', '下午', '下午', '下午', '傍晚', '傍晚', '黃昏', '晚上', '晚上', '晚上', '深夜', '深夜'][Math.floor(w.hour) % 24]}`;
export const daysOfFood = w => w.food / Math.max(1, w.party.length);
