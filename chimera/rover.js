// Rover（Alan 2026-10-11，warband/DESIGN.md「直接操作的旅行小隊」）：一家公司一台、最多四個人，玩家自己開著走。
// 速度跟快車一樣；錢直接報帳（從公司扣），資源（熱量、淨水、撿到的東西）綁在車上。每到一格寫日誌（地景、人、傷痕、秘密、現在），
// 照那一格擲遭遇（跟接單一樣：有服務單就不能移動）；可以搜索（遺產級、遺體、廢墟）、在城裡補給、在委託的地點接單（當作移動的駐紮地）。
// 人用帳本裡的一支小隊（sq.rover），掛在一張不結算的案件（kind 'rover'）上，遭遇的服務單、戰鬥、記憶片段都照原本的流程走。
import * as C from './cases.js';
import {gainLegacy} from './company.js';
import {BIOMES, hdist} from './sim.js';

export const ROVER = {PRICE: 300, TOW: 50, CAP: 40, SEARCH_H: 4, SEARCH_CD: 24 * 7, FOOD_K: 1, WATER_K: 1, UPKEEP: 1, BUY: {food: 1, water: 1}};
const SITE = {oil: '石油城', ammo: '彈藥農場', oasis: '綠洲', salvage: '拆解場'};
const say = (R, h, tile, text, kind = 'note') => { R.log.push({h, tile, text, kind}); if (R.log.length > 200) R.log.shift(); };

function roverCase(book, G, R, h) {
  let c = R.caseId && book.cases.find(x => x.id === R.caseId);
  if (!c) { c = {id: 'K' + book.nextId++, kind: 'rover', title: `${G.name} 的 Rover`, tile: R.tile, fac: -1, foe: -1, gang: 0, lv: 1, start: h, end: 1e9, settled: false, open: false, midPaid: true,
    score: {}, squads: [], tickets: 0, pay: {deposit: 0, mid: 0, final: 0}}; book.cases.push(c); R.caseId = c.id; }
  return c;
}
export const roverSquad = (book, R) => R?.squad ? book.squads[R.squad] : null;
const crewOf = (book, R) => roverSquad(book, R)?.clones.filter(c => c.alive) || [];
const busyTicket = (book, R) => book.tickets.find(t => t.squad === R.squad && !t.done);
// 能不能動：有人、沒有服務單、沒有在搜索、沒有在接委託
export function roverBlock(book, R, h) {
  const sq = roverSquad(book, R);
  if (!sq || !crewOf(book, R).length) return '車上沒有人';
  if (busyTicket(book, R)) return '有一張服務單還沒處理';
  if (R.busyUntil > h) return '正在搜索';
  if (sq.caseId !== R.caseId) return '正在接委託（當作駐紮在這裡）';
  return null;
}

export function buyRover(G, book, w, h) {
  if (G.rover) return '已經有一台 Rover 了';
  if (G.cash < ROVER.PRICE) return '錢不夠';
  G.cash -= ROVER.PRICE; C.pay(book, h, G.name, -ROVER.PRICE, 'rover', '買了一台 Rover');
  G.rover = {tile: G.base, at: h, cargo: {food: 0, water: 0}, route: [], move: null, log: [], searched: {}, seen: [], squad: null, caseId: null, hungry: 0, busyUntil: 0};
  say(G.rover, h, G.base, `買了一台 Rover，停在總部。挑最多四個人上車、搬一些熱量和淨水，就可以出發了。`);
  return null;
}
// 上車、下車：只能在總部換人
export function roverCrew(G, book, w, uids, h) {
  const R = G.rover; if (!R) return '還沒有 Rover';
  if (R.tile !== G.base || R.move) return 'Rover 要停在總部才能換人';
  const sq0 = roverSquad(book, R); if (sq0 && (busyTicket(book, R) || sq0.caseId !== R.caseId)) return '有服務單或委託還沒處理完';
  const keep = new Set(uids);
  const pick = uids.slice(0, 4).map(u => G.roster.find(x => x.uid === u)).filter(x => x && x.alive && (x.status === 'home' && !x.keep || sq0?.clones.includes(x)));
  for (const x of sq0?.clones || []) if (x.alive && !keep.has(x.uid)) x.status = 'home';
  if (!pick.length) { if (sq0) { const c = book.cases.find(k => k.id === R.caseId); if (c) c.squads = c.squads.filter(id => id !== sq0.id); delete book.squads[sq0.id]; } R.squad = null; say(R, h, R.tile, '所有人都下車了。'); return null; }
  const c = roverCase(book, G, R, h);
  let sq = sq0;
  if (!sq) { sq = C.makeSquad(book, G.name, {clones: pick, gear: 3, at: R.tile, name: `${G.name}・Rover`}); sq.rover = true; sq.caseId = c.id; sq.readyAt = h; c.squads.push(sq.id); R.squad = sq.id; }
  else sq.clones = pick;
  for (const x of pick) if (x.status !== 'away') { x.status = 'away'; C.joinRec(x, c, G.name, h); }
  say(R, h, R.tile, `上車的人：${pick.map(x => x.id).join('、')}。`);
  return null;
}
// 補給：在總部從倉庫的素材搬（不用錢）；在別的城照價錢買（從公司扣）
export function roverSupply(G, book, w, food, water, h) {
  const R = G.rover; if (!R) return '還沒有 Rover'; if (R.move) return '開車中不能補給';
  const K = w.sim.peek(), m = K.markets[R.tile], home = R.tile === G.base;
  if (!home && !(m && K.owner[R.tile] >= 0)) return '這裡沒有城可以補給';
  const f = Math.max(0, Math.min(food | 0, ROVER.CAP - R.cargo.food)), wa = Math.max(0, Math.min(water | 0, ROVER.CAP - R.cargo.water)); if (!f && !wa) return '車上放不下了';
  if (home) { if ((G.mats.food || 0) < f || (G.mats.water || 0) < wa) return '倉庫的素材不夠'; G.mats.food -= f; G.mats.water -= wa; }
  else { const cost = f * ROVER.BUY.food + wa * ROVER.BUY.water; if (G.cash < cost) return '錢不夠'; G.cash -= cost; C.pay(book, h, G.name, -cost, 'rover', `Rover 在${w.names[R.tile] || ''}補給（熱量 ${f}、淨水 ${wa}）`); }
  R.cargo.food += f; R.cargo.water += wa;
  say(R, h, R.tile, `補給：${[f && `熱量 +${f}`, wa && `淨水 +${wa}`].filter(Boolean).join('、')}${home ? '（從倉庫搬）' : ''}。`);
  return null;
}
// 開到某一格：照路線一格一格走
export function roverGo(G, book, w, to, h) {
  const R = G.rover; if (!R) return '還沒有 Rover';
  const why = roverBlock(book, R, h); if (why) return why;
  if (to === R.tile && !R.move) return '已經在這裡了';
  const from = R.move ? R.move.to : R.tile, path = w.sim.pmc.route(from, to);
  if (!path?.length || path[path.length - 1] !== to) return '開不到那裡';
  R.route = path[0] === from ? path.slice(1) : path;
  say(R, h, R.tile, `出發，目的地：${w.names[to] || '荒野'}（${R.route.length} 格）。`);
  if (!R.move) nextLeg(w, R, h);   // 下了命令就開走，不等下一個整點
  return null;
}
export function roverStop(G, book, w, h) { const R = G.rover; if (!R) return '還沒有 Rover'; R.route = []; say(R, h, R.tile, '停車。'); return null; }
// 搜索：花 4 小時，同一格 7 天內只搜一次
export function roverSearch(G, book, w, h) {
  const R = G.rover; if (!R) return '還沒有 Rover';
  const why = roverBlock(book, R, h); if (why) return why; if (R.move) return '開車中不能搜索';
  if (h - (R.searched[R.tile] ?? -1e9) < ROVER.SEARCH_CD) return '這一格最近搜過了';
  R.searched[R.tile] = h; R.busyUntil = h + ROVER.SEARCH_H; R.searching = R.tile; R.route = [];
  say(R, h, R.tile, `開始搜索這一帶（約 ${ROVER.SEARCH_H} 小時）。`);
  return null;
}

// ---- 日誌：地景、人、傷痕、秘密、現在 ----
const BIO_LINE = {
  鹼灘: ['白色的鹼殼在車輪底下碎裂，風一吹就揚起一層刺眼的粉。', '鹼灘一望無際，遠處的地平線在熱氣裡晃。', '鹼殼底下埋著半截車殼，車牌還看得清。'],
  斷崖: ['路沿著斷崖邊緣走，往下看不到底。', '崖壁上有舊時代留下的鋼樁，鏽成了紅褐色。'],
  岩山: ['岩山的影子很長，石縫裡卡著被風吹來的塑膠片。', '車在碎石坡上打滑了好幾次。'],
  礫丘: ['礫丘一座接一座，像被翻過的田。', '礫石底下偶爾露出一截電纜。'],
  寒漠: ['冷風從縫隙灌進車廂，呼出來的氣都是白的。', '寒漠的地面硬得像鐵，車聲在空曠裡傳得很遠。'],
  油棘林: ['油棘林的刺上掛著黑色的油珠，空氣裡是燒焦的甜味。', '棘叢擦過車身，留下一道一道油痕。'],
  旱原: ['旱原的草乾得一碰就碎。', '地上的裂縫比手掌還寬。', '一群瘦得見骨的野狗遠遠跟著車。', '路邊插著一塊褪色的路牌，地名已經被風沙磨掉了。', '熱浪裡什麼都在晃，連遠處的山都像在走。'],
  沙海: ['沙丘的稜線被風削得很利。', '沙子灌進每一道縫，嘴裡都是沙。'],
  鹽沼: ['鹽沼的水面映著天，看不出哪裡能踩。', '腐爛的氣味從鹽殼底下冒出來。'],
};
const pickBy = (arr, seed) => arr[((seed * 2654435761) >>> 0) % arr.length];
export function tileStory(G, book, w, t, h) {
  const R = G.rover, K = w.sim.peek(), nm = x => w.names[x] || '無名之地', fn = f => K.fac[f]?.n || '', lines = [], bio = BIOMES[K.biome[t]]?.n;
  // 地景
  // 地景：換了地形、或隔了幾格才寫一句（不然一路都是同一句）
  const B = BIO_LINE[bio], fresh = bio !== R.lastBio || (R.quiet = (R.quiet || 0) + 1) >= 4; if (fresh) { R.quiet = 0; R.lastBio = bio; }
  lines.push(`【${nm(t)}・${bio || '荒野'}】` + (fresh && B ? pickBy(B, t + h) : ''));
  if (K.ruin[t]) lines.push('路邊有舊時代的廢墟，鋼骨從沙裡伸出來。');
  if ((K.trench[t] || 0) > .2) lines.push('地上是一道道填了一半的戰壕，這裡打過仗。');
  // 人
  const m = K.markets[t];
  if (m && K.owner[t] >= 0) {
    // 城的大小照全星球的排名（人口的單位會跟著世界規模變）
    const pops = Object.values(K.markets).map(x => x.pop || 0).sort((a, b) => b - a), rk = pops.indexOf(m.pop || 0) / Math.max(1, pops.length), size = rk < .1 ? '大城' : rk < .45 ? '市鎮' : '小聚落', site = m.site?.kind ? SITE[m.site.kind] : '';
    const F = K.fac[K.owner[t]], ruler = F?.ruler != null ? (K.heroes || []).find(x => x.id === F.ruler) : null, lord = m.lord != null ? (K.heroes || []).find(x => x.id === m.lord) : null;
    lines.push(`${fn(K.owner[t])}的${size}${site ? `，有一座${site}` : ''}。${t === F?.cap && ruler ? `這裡是首府，${ruler.title || '首領'}${ruler.name}坐鎮。` : lord ? `管這裡的課長是${lord.name}。` : ''}${m.unrest > 1 ? '街上的人看外人的眼神不太友善，最近不太平。' : ''}${m.incited ? '牆上貼著鼓動脫離的傳單。' : ''}`);
    const y = w.sim.year; if (m.sabY === y) lines.push(site ? `${site}的鋼架燒得發黑，工人說是夜裡起的火，沒人知道是誰。` : '倉庫燒掉了一半，焦味還沒散。');
    if (m.waterCut === y) lines.push('水井封了，排隊領水的人排到街尾。');
  }
  // 傷痕：這一格的編年史（沒看過的）
  const seen = new Set(R.seen), hist = [...(K.saga || []), ...(K.ev || [])].filter(e => e.tile === t && e.type !== 'trade' && !seen.has(e.y + ':' + e.text));
  if (hist.length) { const e = hist[((t * 7 + h) >>> 0) % hist.length]; lines.push(`第 ${e.y} 年，${e.text}`); R.seen.push(e.y + ':' + e.text); if (R.seen.length > 400) R.seen.shift(); }
  // 秘密的線索
  const wp = (K.weapons || []).find(x => x.lost && x.loc === t && !x.lake);
  if (wp) lines.push(wp.sealed ? '附近好像有一座被封起來的舊倉庫，入口被沙埋了一半——值得搜索。' : '沙地裡有東西在反光——值得搜索。');
  if ((book.bodies || []).some(b => b.tile === t && !b.takenBy)) lines.push('路邊倒著一具穿制服的遺體。');
  // 現在
  const bd = K.bandit[t] || 0; if (bd > 40) lines.push('路上的車轍很新，到處是彈殼。這一帶的匪很兇。'); else if (bd > 15) lines.push('遠處的坡上有人在看，一看到車就縮回去了。');
  if (lines.length === 1 && !fresh) lines[0] = `經過${nm(t)}（${bio || '荒野'}）。`;   // 沒什麼可寫的格子：一句帶過
  return lines;
}
// 遭遇機率：匪患越重越容易出事；原住民的地盤也是
function encounterP(w, t) { const K = w.sim.peek(), bd = K.bandit[t] || 0, native = (K.gangs || []).some(g => !g.gone && g.native && hdist(g.lair, t) <= 3); return Math.min(.5, .03 + bd * .004 + (native ? .08 : 0)); }
const roll = (t, h, salt) => (((t * 2654435761) ^ (h * 40503) ^ salt) >>> 0) % 10000 / 10000;

function searchResult(G, book, w, t, h, sq) {
  const R = G.rover, K = w.sim.peek(), out = [];
  const wp = (K.weapons || []).find(x => x.lost && x.loc === t && !x.lake);
  if (wp) { Object.assign(wp, {holder: 0, fac: -1, gang: 0, lost: false, loc: -1, pmc: G.name, sealed: false}); wp.owners = (wp.owners || 0) + 1; wp.hist?.push({y: w.sim.year, t: `${G.name}的 Rover 在${w.names[t] || '荒野'}找到它。`});
    gainLegacy(G, {kind: wp.kind, weapon: wp.name, legacy: wp.id, bonus: wp.bonus}, h, sq); out.push(`找到了遺產級「${wp.name}」（${wp.kind}），放進車上的行李。`); }
  for (const b of (book.bodies || []).filter(b => b.tile === t && !b.takenBy)) { b.takenBy = G.name; out.push(b.co === G.name ? '找到了我們自己人的遺體，帶回去還能重新培養。' : `找到一具${b.co}的人的遺體。`); }
  if (K.ruin[t]) { const r = roll(t, h, 77); if (r < .5) { G.mats.implant = (G.mats.implant || 0) + 3; G.mats.neural = (G.mats.neural || 0) + 3; out.push('在廢墟裡拆到一些還能用的植入物和神經介質（植入物 +3、神經介質 +3，算進倉庫）。'); } else out.push('廢墟裡翻了一圈，只有爛掉的電路板。'); }
  if (!out.length) out.push(roll(t, h, 5) < .3 ? `撿到一些補給（熱量 +${Math.min(2, ROVER.CAP - R.cargo.food)}）。` : '搜了一圈，什麼也沒找到。');
  if (out[0].startsWith('撿到一些補給')) R.cargo.food = Math.min(ROVER.CAP, R.cargo.food + 2);
  return out;
}

const nextLeg = (w, R, h) => { const to = R.route.shift(), t = Math.max(1, Math.round(C.travelHours(w, R.tile, to, true))); R.move = {from: R.tile, to, t0: h, t1: h + t, path: [R.tile, to]}; };
// 每個遊戲小時（core.js 呼叫）
export function roverHour(cos, book, w, h) {
  for (const G of Object.values(cos)) { const R = G.rover; if (!R) continue;
    const sq = roverSquad(book, R), crew = crewOf(book, R);
    // 全員倒下：拖回總部
    if (R.squad && !crew.length && !busyTicket(book, R)) {
      const c = book.cases.find(k => k.id === R.caseId); if (c && sq) c.squads = c.squads.filter(id => id !== sq.id);
      if (sq) { if (sq.pack?.length) (G.store ||= []).push(...sq.pack); delete book.squads[sq.id]; }
      R.squad = null; R.move = null; R.route = []; const far = R.tile !== G.base; R.tile = G.base;
      if (far) { G.cash -= ROVER.TOW; C.pay(book, h, G.name, -ROVER.TOW, 'rover', 'Rover 的人全倒下了，拖車把車拖回總部'); }
      say(R, h, G.base, '車上的人全倒下了。拖車把 Rover 拖回總部，車上的東西收進倉庫。', 'danger'); continue; }
    if (!sq) continue;
    // 每天：吃喝、維持費（直接報帳）
    if (h % 24 === 0 && crew.length) {
      const n = crew.length; if (sq.caseId === R.caseId) C.pay(book, h, G.name, -ROVER.UPKEEP * n, 'upkeep', `Rover 的維持費（${n} 人）`);   // 接委託的時候照委託記應付帳款
      const fOk = R.cargo.food >= n * ROVER.FOOD_K, wOk = R.cargo.water >= n * ROVER.WATER_K;
      R.cargo.food = Math.max(0, R.cargo.food - n * ROVER.FOOD_K); R.cargo.water = Math.max(0, R.cargo.water - n * ROVER.WATER_K);
      if (!fOk || !wOk) { R.hungry++; say(R, h, R.tile, `${!wOk ? '淨水' : '熱量'}不夠分了，大家餓著肚子（缺糧第 ${R.hungry} 天，打起來會比較弱）。`, 'danger'); } else R.hungry = 0;
      sq.gear = R.hungry ? 0 : 3; }
    // 搜索完成
    if (R.searching != null && h >= R.busyUntil) { const t = R.searching; R.searching = null; for (const s of searchResult(G, book, w, t, h, sq)) say(R, h, t, s, 'find'); }
    // 開車
    if (R.move && h >= R.move.t1) { R.tile = R.move.to; sq.at = R.tile; R.move = null;
      for (const s of tileStory(G, book, w, R.tile, h)) say(R, h, R.tile, s, 'story');
      if (R.tile !== G.base && roll(R.tile, h, 1) < encounterP(w, R.tile)) { const c = roverCase(book, G, R, h); C.roverEncounter(book, w, c, sq, R.tile, h); R.route = []; say(R, h, R.tile, '有人擋住了去路——打完才能繼續走。', 'danger'); }
      else if (!R.route.length) say(R, h, R.tile, `到了${w.names[R.tile] || '目的地'}。`); }
    if (!R.move && R.route.length && !roverBlock(book, R, h)) nextLeg(w, R, h);
  }
}

// 給畫面
export function roverView(G, book, w, h) {
  const R = G.rover; if (!R) return null; const sq = roverSquad(book, R), K = w.sim.peek(), m = K.markets[R.tile];
  return {tile: R.tile, place: w.names[R.tile] || '荒野', move: R.move, route: R.route, dest: R.route.length ? R.route[R.route.length - 1] : R.move?.to ?? null, cargo: R.cargo, cap: ROVER.CAP, hungry: R.hungry,
    crew: sq ? sq.clones.map(c => c.uid) : [], squad: R.squad, pack: (sq?.pack || []).length, block: roverBlock(book, R, h), ticket: busyTicket(book, R)?.id || null, searching: R.searching != null ? R.busyUntil : null,
    atHome: R.tile === G.base, town: !!(m && K.owner[R.tile] >= 0), searchedAt: R.searched[R.tile] ?? null, log: R.log.slice(-80).reverse(), price: ROVER.PRICE, buy: ROVER.BUY};
}
