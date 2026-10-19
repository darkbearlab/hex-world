// 移動基地（Alan 2026-10-12，warband/DESIGN.md「移動基地」）：整家公司連培養槽跟著基地到處跑，原本的 Rover 併進來。
// - 基地就在 G.base（現在停的那一格）；開動照原本慢車的速度一格一格走（引擎升級再乘），每格要油（HQ.FUEL）。
// - 在家的人（status 'home'）就是在基地上的人。基地在路上照那一格擲遭遇：從在家的人裡挑最強的四個當守衛上場（基地防衛戰），打完回到基地；
//   一個人都沒有就被搶（現金、素材少一些）。有服務單、正在搜索的時候不能開。
// - 停在城外（荒野、或還在路上）每天要吃喝：在家的人每人每天熱量、淨水各一份（從倉庫的素材扣，儲糧艙、淨水器升級再乘）；不夠就缺糧，培養槽停一天。
// - 搜索：停在一格搜 4 小時。遠征點（舊礦坑、燃料林、廢墟、遺產級的舊戰場）和突發事件（core.js）一定要基地到場搜，先搜到的先拿。
// - 在地小事、升級、加買運兵車、換登記地（勢力）都要停在城裡。
// 遭遇的服務單掛在一張不結算的案件（kind 'rover'，沿用原本的種類）上，戰鬥、記憶片段都照原本的流程走。
import * as C from './cases.js';
import {gainLegacy, relAdd, unpack, parked, inTown, nearSite, ensureHq, VAN} from './company.js';
import {BIOMES, hdist} from './sim.js';
import {nearHour, nearAt, nearName, nearView, NEAR, od, fogMark, opPlan, opEnd, lairsView, lairInfo, gangInfo, siteName, headSite, layerPower, LAIR} from './near.js';
import {center as opCenter, cellsOf, subRoute, hexDist as opDist} from './opmap.js';
import {W as MAPW} from './sim.js';

export const HQ = {FUEL: 3, SEARCH_H: 4, SEARCH_CD: 24 * 7, SITE_CD: 24 * 7, FOOD_K: 1, WATER_K: 1, REG_COST: 100, RAID: .05};
const SITE = {oil: '石油城', ammo: '彈藥農場', oasis: '綠洲', salvage: '拆解場'};
// 升級（原本 Rover 的三項，Alan 2026-10-12）：要到對的地方才能升級，畫面上直接指出該去哪裡
export const UP = {
  engine: {n: '引擎', at: 'oil', where: '石油城', k: [1, .85, .7, .55], text: v => `每格的時間 ×${v}`},
  food: {n: '儲糧艙', at: 'big', where: '大城（人口前一成）', k: [1, .75, .5, .35], text: v => `在城外每人每天吃 ${v} 份熱量`},
  water: {n: '淨水器', at: 'oasis', where: '綠洲', k: [1, .75, .5, .35], text: v => `在城外每人每天喝 ${v} 份淨水`},
};
const UP_COST = [60, 120, 200];
const upLv = (R, k) => R.up?.[k] || 0, upK = (R, k) => UP[k].k[upLv(R, k)];
function upHere(w, t, kind) {
  const K = w.sim.peek(), m = K.markets[t]; if (!m || K.owner[t] < 0) return false;
  if (UP[kind].at === 'big') { const pops = Object.values(K.markets).map(x => x.pop || 0).sort((a, b) => b - a); return (m.pop || 0) >= pops[Math.floor(pops.length * .1)]; }
  return m.site?.kind === UP[kind].at;
}
const say = (R, h, tile, text, kind = 'note') => { R.log.push({h, tile, text, kind}); if (R.log.length > 200) R.log.shift(); };
const nmOf = w => t => w.names[t] || '荒野';

function hqCase(book, G, h) {
  const R = ensureHq(G); let c = R.caseId && book.cases.find(x => x.id === R.caseId);
  if (!c) { c = {id: 'K' + book.nextId++, kind: 'rover', title: `${G.name} 的基地`, tile: G.base, fac: -1, foe: -1, gang: 0, lv: 1, start: h, end: 1e9, settled: false, open: false, midPaid: true,
    score: {}, squads: [], tickets: 0, pay: {deposit: 0, mid: 0, final: 0}}; book.cases.push(c); R.caseId = c.id; }
  return c;
}
const guardOf = (book, R) => R.guard ? book.squads[R.guard] : null;
const busyTicket = (book, R) => { const sq = guardOf(book, R); return sq ? book.tickets.find(t => t.squad === sq.id && !t.done) : null; };
// 能不能開動、搜索
export function hqBlock(book, G, h) {
  const R = ensureHq(G);
  if (busyTicket(book, R)) return '基地正在被襲擊，打完才能動';
  if (R.holdUntil > h) return '剛打完，正在整頓';
  if (R.busyUntil > h) return '正在搜索';
  return null;
}
// 基地防衛戰：從在家的人裡挑最強的四個（不出擊的不挑）上場；沒有人就被搶
function defend(G, book, w, h, why) {
  const R = ensureHq(G), pick = G.roster.filter(x => x.alive && x.status === 'home' && !x.keep).sort((a, b) => (b.pow || 0) - (a.pow || 0)).slice(0, 4);
  if (!pick.length) {
    const cash = Math.round(Math.max(0, G.cash) * HQ.RAID); C.pay(book, h, G.name, -cash, 'raid', `基地在${nmOf(w)(G.base)}被搶`);   // 帳本進出（company.js hour 從帳本扣現金；原本 Rover 的升級、拖車又直接扣一次，扣了兩次）
    for (const m of Object.keys(G.mats)) G.mats[m] = Math.round(G.mats[m] * (1 - HQ.RAID));
    say(R, h, G.base, `${why}——基地上沒有人能打，被搶走了現金 $${cash}k 和一些素材。`, 'danger'); return null;
  }
  const c = hqCase(book, G, h), sq = C.makeSquad(book, G.name, {clones: pick, gear: R.hungry ? 0 : 3, at: G.base, name: `${G.name}・基地守衛`});
  sq.guard = true; sq.caseId = c.id; sq.readyAt = h; c.squads.push(sq.id); R.guard = sq.id;
  for (const x of pick) { x.status = 'away'; C.joinRec(x, c, G.name, h); }
  const tk = C.roverEncounter(book, w, c, sq, G.base, h);
  say(R, h, G.base, `${why}——${pick.map(x => x.id).join('、')}上場守住基地${R.route.length ? `（打完會接著往${nmOf(w)(R.route[R.route.length - 1])}開）` : ''}。`, 'danger');
  return tk;
}
// 守衛打完：回到基地
function guardBack(G, book, R, h) {
  const sq = guardOf(book, R); if (!sq) { R.guard = null; return; }
  for (const c of book.cases) if (c.id === sq.caseId) c.squads = c.squads.filter(id => id !== sq.id);
  for (const x of sq.clones) if (x.alive && x.status === 'away') { x.status = 'home'; const e = C.caseRec(x, sq.caseId); if (e && e.end == null) e.end = h; }
  unpack(G, sq, h); delete book.squads[sq.id]; R.guard = null;
}

// 開到某一格：照路線一格一格走
export function baseGo(G, book, w, to, h, sub = null) {
  if (!Number.isInteger(to) || !w.land[to]) return '開不到那裡';   // 不是地圖上的陸地格（2026-10-18 測試時送了 NaN，基地開到第 0 格）
  const R = ensureHq(G), why = hqBlock(book, G, h); if (why) return why;
  // 作戰地圖（單機）：可以指定停在目的地的哪一小格（OPMAP.md 第 2 段）
  if (sub != null) { if (!NEAR.on || !Array.isArray(sub) || !Number.isInteger(sub[0]) || !Number.isInteger(sub[1]) || opDist(opCenter(to, MAPW), sub) > 3) return '開不到那一小格';
    const c = cellsOf(to, od(w)).get(sub[0] + ',' + sub[1]); if (!c || !subRoute(to, opCenter(to, MAPW), sub, od(w))) return '開不到那一小格'; }
  const subGoal = sub && !(sub[0] === opCenter(to, MAPW)[0] && sub[1] === opCenter(to, MAPW)[1]) ? sub : null;
  if (to === G.base && !R.move && !R.subMove) {   // 同一格裡換一小格
    if (!NEAR.on) return '已經在這裡了';
    const from = R.sub || opCenter(G.base, MAPW), dest = subGoal || opCenter(G.base, MAPW); if (from[0] === dest[0] && from[1] === dest[1]) return '已經在這裡了';
    const r = subRoute(G.base, from, dest, od(w)); if (!r) return '開不到那一小格';
    R.subMove = {from, to: dest, t0: h, t1: +(h + r.minutes / 60).toFixed(3)}; R.subGoal = null; R.route = [];
    say(R, h, G.base, `基地在${nmOf(w)(G.base)}挪到另一處（約 ${Math.round(r.minutes)} 分鐘）。`); return null;
  }
  R.subGoal = subGoal;
  const from = R.move ? R.move.to : G.base, path = w.sim.pmc.route(from, to);
  if (!path?.length || path[path.length - 1] !== to) return '開不到那裡';
  R.route = path[0] === from ? path.slice(1) : path;
  say(R, h, G.base, `基地出發，目的地：${nmOf(w)(to)}（${R.route.length} 格，油錢約 $${R.route.length * HQ.FUEL}k）。`);
  if (!R.move && !R.subMove) nextLeg(G, book, w, R, h);   // 下了命令就開走，不等下一個整點
  return null;
}
export function baseStop(G, book, w, h) { const R = ensureHq(G); R.route = []; say(R, h, G.base, '基地停下。'); return null; }
// 搜索：停下來搜 4 小時；同一格同一家 7 天內只搜一次，遠征點、突發事件被任何一家搜過就要等
export function baseSearch(G, book, w, h) {
  const R = ensureHq(G), why = hqBlock(book, G, h); if (why) return why; if (!parked(G)) return '基地在路上，停下來才能搜索';
  if (h - (R.searched[G.base] ?? -1e9) < HQ.SEARCH_CD) return '這一格最近搜過了';
  const site = nearSite(book, w, G.base, h); if (site?.taken) return `${site.title}最近被${site.taken}搜過了`;
  R.searched[G.base] = h; R.busyUntil = h + HQ.SEARCH_H; R.searching = G.base;
  say(R, h, G.base, `開始搜索這一帶${site ? `（${site.title}）` : ''}（約 ${HQ.SEARCH_H} 小時）。`);
  return null;
}
export function baseUpgrade(G, book, w, kind, h) {
  const R = ensureHq(G), U = UP[kind]; if (!U) return '沒有這項升級';
  if (!parked(G)) return '基地在路上不能升級'; const lv = upLv(R, kind); if (lv >= U.k.length - 1) return '已經升到頂了';
  if (!upHere(w, G.base, kind)) return `${U.n}要到${U.where}才能升級`;
  const cost = UP_COST[lv]; if (G.cash < cost) return '錢不夠';
  C.pay(book, h, G.name, -cost, 'rover', `基地升級：${U.n} ${lv + 1} 級（${nmOf(w)(G.base)}）`);
  (R.up ||= {})[kind] = lv + 1; say(R, h, G.base, `在${nmOf(w)(G.base)}把${U.n}升到 ${lv + 1} 級：${U.text(U.k[lv + 1])}。`, 'find');
  return null;
}
// 加買運兵車（Alan 2026-10-12：一開始兩台；第三台 $150k、第四台 $250k）
export function buyVan(G, book, w, h) {
  if (!inTown(G, w)) return '要停在城裡才能買車';
  const n = G.vans ?? VAN.START; if (n >= VAN.MAX) return `最多 ${VAN.MAX} 台`;
  const cost = VAN.PRICE[n - VAN.START] ?? VAN.PRICE[VAN.PRICE.length - 1]; if (G.cash < cost) return '錢不夠';
  C.pay(book, h, G.name, -cost, 'rover', `買了第 ${n + 1} 台運兵車（${nmOf(w)(G.base)}）`); G.vans = n + 1;
  say(ensureHq(G), h, G.base, `在${nmOf(w)(G.base)}買了第 ${n + 1} 台運兵車：同時可以派 ${n + 1} 隊出去。`, 'find');
  return null;
}
// 換登記地（勢力）：停在哪座城就登記在那座城的勢力；一季一次、要錢（不然開到別人地盤就能躲禁令、換邊接案）
export function register(G, book, w, h, SH) {
  if (!inTown(G, w)) return '要停在城裡才能換登記';
  const K = w.sim.peek(); if (G.home === G.base) return '已經登記在這裡了';
  if (h - (G.homeAt ?? -1e9) < SH) return `一季只能換一次（還要 ${Math.ceil((SH - (h - G.homeAt)) / 24)} 天）`;
  if (G.cash < HQ.REG_COST) return '錢不夠';
  C.pay(book, h, G.name, -HQ.REG_COST, 'rover', `公司登記換到${nmOf(w)(G.base)}（${K.fac[K.owner[G.base]]?.n || ''}）`);
  G.home = G.base; G.homeAt = h; book.companies[G.name] && (book.companies[G.name].home = G.base);
  say(ensureHq(G), h, G.base, `公司登記換到${nmOf(w)(G.base)}，現在算是${K.fac[K.owner[G.base]]?.n || '這裡'}的公司。`, 'find');
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
  旱原: ['旱原的草乾得一碰就碎。', '地上的裂縫比手掌還寬。', '一群瘦得見骨的野狗遠遠跟著車隊。', '路邊插著一塊褪色的路牌，地名已經被風沙磨掉了。', '熱浪裡什麼都在晃，連遠處的山都像在走。'],
  沙海: ['沙丘的稜線被風削得很利。', '沙子灌進每一道縫，嘴裡都是沙。'],
  鹽沼: ['鹽沼的水面映著天，看不出哪裡能踩。', '腐爛的氣味從鹽殼底下冒出來。'],
};
const pickBy = (arr, seed) => arr[((seed * 2654435761) >>> 0) % arr.length];
export function tileStory(G, book, w, t, h) {
  const R = ensureHq(G), K = w.sim.peek(), nm = x => w.names[x] || '無名之地', fn = f => K.fac[f]?.n || '', lines = [], bio = BIOMES[K.biome[t]]?.n;
  // 地景：換了地形、或隔了幾格才寫一句（不然一路都是同一句）
  const B = BIO_LINE[bio], fresh = bio !== R.lastBio || (R.quiet = (R.quiet || 0) + 1) >= 4; if (fresh) { R.quiet = 0; R.lastBio = bio; }
  lines.push(`【${nm(t)}・${bio || '荒野'}】` + (fresh && B ? pickBy(B, t + h) : ''));
  if (K.ruin[t]) lines.push('路邊有舊時代的廢墟，鋼骨從沙裡伸出來。');
  if ((K.trench[t] || 0) > .2) lines.push('地上是一道道填了一半的戰壕，這裡打過仗。');
  const m = K.markets[t];
  if (m && K.owner[t] >= 0) {
    const pops = Object.values(K.markets).map(x => x.pop || 0).sort((a, b) => b - a), rk = pops.indexOf(m.pop || 0) / Math.max(1, pops.length), size = rk < .1 ? '大城' : rk < .45 ? '市鎮' : '小聚落', site = m.site?.kind ? SITE[m.site.kind] : '';
    const F = K.fac[K.owner[t]], ruler = F?.ruler != null ? (K.heroes || []).find(x => x.id === F.ruler) : null, lord = m.lord != null ? (K.heroes || []).find(x => x.id === m.lord) : null;
    lines.push(`${fn(K.owner[t])}的${size}${site ? `，有一座${site}` : ''}。${t === F?.cap && ruler ? `這裡是首府，${ruler.title || '首領'}${ruler.name}坐鎮。` : lord ? `管這裡的課長是${lord.name}。` : ''}${m.unrest > 1 ? '街上的人看外人的眼神不太友善，最近不太平。' : ''}${m.incited ? '牆上貼著鼓動脫離的傳單。' : ''}`);
    const y = w.sim.year; if (m.sabY === y) lines.push(site ? `${site}的鋼架燒得發黑，工人說是夜裡起的火，沒人知道是誰。` : '倉庫燒掉了一半，焦味還沒散。');
    if (m.waterCut === y) lines.push('水井封了，排隊領水的人排到街尾。');
  }
  const seen = new Set(R.seen), hist = [...(K.saga || []), ...(K.ev || [])].filter(e => e.tile === t && e.type !== 'trade' && !seen.has(e.y + ':' + e.text));
  if (hist.length) { const e = hist[((t * 7 + h) >>> 0) % hist.length]; lines.push(`第 ${e.y} 年，${e.text}`); R.seen.push(e.y + ':' + e.text); if (R.seen.length > 400) R.seen.shift(); }
  const site = nearSite(book, w, t, h); if (site && !site.taken) lines.push(`${site.title}：${site.hint}——值得停下來搜索。`);
  if ((book.bodies || []).some(b => b.tile === t && !b.takenBy)) lines.push('路邊倒著一具穿制服的遺體。');
  const bd = K.bandit[t] || 0; if (bd > 40) lines.push('路上的車轍很新，到處是彈殼。這一帶的匪很兇。'); else if (bd > 15) lines.push('遠處的坡上有人在看，一看到車隊就縮回去了。');
  if (lines.length === 1 && !fresh) lines[0] = `經過${nm(t)}（${bio || '荒野'}）。`;
  return lines;
}
// 遭遇機率：匪患越重越容易出事；原住民的地盤也是。城裡（有主的市鎮）不會
function encounterP(w, t) { const K = w.sim.peek(); if (K.markets[t] && K.owner[t] >= 0) return 0; const bd = K.bandit[t] || 0, native = (K.gangs || []).some(g => !g.gone && g.native && hdist(g.lair, t) <= 3); return Math.min(.5, .03 + bd * .004 + (native ? .08 : 0)); }
const roll = (t, h, salt) => (((t * 2654435761) ^ (h * 40503) ^ salt) >>> 0) % 10000 / 10000;

// 搜索的結果：遠征點、突發事件（先搜到的先拿）、遺體、廢墟
function searchResult(G, book, w, t, h) {
  const K = w.sim.peek(), out = [], site = nearSite(book, w, t, h);
  if (site && !site.taken) { site.claim(G.name); out.push(...site.loot(G, h)); }
  for (const b of (book.bodies || []).filter(b => b.tile === t && !b.takenBy)) { b.takenBy = G.name; out.push(b.co === G.name ? '找到了我們自己人的遺體，帶回去還能重新培養。' : `找到一具${b.co}的人的遺體。`); }
  const ruinCell = NEAR.on && K.ruin[t] ? [...cellsOf(t, od(w)).values()].find(c => c.f === 'ruin') : null, atRuin = !ruinCell || (G.hq?.sub && G.hq.sub[0] === ruinCell.q && G.hq.sub[1] === ruinCell.r);
  if (!site && K.ruin[t] && !atRuin) out.push('這一格的廢墟在別處（作戰地圖上的 ✕），把基地停到那一小格再搜。');
  if (!site && K.ruin[t] && atRuin) { const r = roll(t, h, 77); if (r < .5) { G.mats.implant = (G.mats.implant || 0) + 3; G.mats.neural = (G.mats.neural || 0) + 3; out.push('在廢墟裡拆到一些還能用的植入物和神經介質（植入物 +3、神經介質 +3）。'); } else out.push('廢墟裡翻了一圈，只有爛掉的電路板。'); }
  if (!out.length) { const k = 2; out.push(roll(t, h, 5) >= .3 ? '搜了一圈，什麼也沒找到。' : `撿到一些補給（熱量 +${k}）。`); if (out[0].startsWith('撿到一些補給')) G.mats.food = (G.mats.food || 0) + k; }
  return out;
}

// 一格要多久：原本慢車的速度，引擎再乘
const legH = (w, R, a, b) => Math.max(.01, +(C.baseHours(w, a, b) * upK(R, 'engine')).toFixed(3));
function nextLeg(G, book, w, R, h) {
  // 停在某一小格（作戰地圖）：先開回這一格的中心再上路
  if (R.sub && NEAR.on) { const c0 = opCenter(G.base, MAPW), r = subRoute(G.base, R.sub, c0, od(w)); R.subMove = {from: R.sub, to: c0, t0: h, t1: +(h + (r ? r.minutes : 10) / 60).toFixed(3)}; R.sub = null; return; }
  const to = R.route.shift(), t = legH(w, R, G.base, to);
  C.pay(book, h, G.name, -HQ.FUEL, 'fare', `基地開往${nmOf(w)(to)}：油錢`);
  R.move = {from: G.base, to, t0: h, t1: +(h + t).toFixed(2), path: [G.base, to]};
}

// ---- 在地小事：基地停在城裡時，城裡的人直接拜託的小事；三天換一批、最多同時接三件 ----
const JOB_PERIOD = 72, JOB_MAX = 3;
const THING = ['一箱藥品', '一袋零件', '一封信', '一包種子', '幾支濾水芯', '一台修好的收音機', '一盒彈藥'];
const WHO = ['一個出去撿廢料的孩子', '一個沒回來的礦工', '一個行商', '一個獵人', '一個去修水泵的工人'];
const jr = (t, p, i, s) => ((((t * 2654435761) ^ (p * 40503) ^ (i * 977) ^ s) >>> 0) % 10000) / 10000;
export function townJobs(w, t, h) {
  const K = w.sim.peek(), m = K.markets[t]; if (!m || K.owner[t] < 0) return [];
  const p = Math.floor(h / JOB_PERIOD), nm = x => w.names[x] || '荒野', out = [], n = 1 + Math.floor(jr(t, p, 0, 1) * 3);
  const near = r => { const L = []; for (let i = 0; i < K.owner.length; i++) { const d = hdist(i, t); if (d >= 1 && d <= r) L.push(i); } return L; };
  for (let i = 0; i < n; i++) {
    const r = jr(t, p, i, 7), id = `J${t}-${p}-${i}`, fac = K.owner[t];
    if (r < .3) { const towns = Object.keys(K.markets).map(Number).filter(x => x !== t && K.owner[x] >= 0 && hdist(x, t) >= 2 && hdist(x, t) <= 8); if (!towns.length) continue;
      const to = towns[Math.floor(jr(t, p, i, 11) * towns.length)], thing = THING[Math.floor(jr(t, p, i, 13) * THING.length)], d = hdist(to, t);
      out.push({id, kind: 'deliver', from: t, to, fac, reward: Math.round(4 + 1.5 * d), title: `把${thing}送到${nm(to)}`}); }
    else if (r < .55) { const L = near(3); if (!L.length) continue; const to = L[Math.floor(jr(t, p, i, 17) * L.length)], who = WHO[Math.floor(jr(t, p, i, 19) * WHO.length)];
      out.push({id, kind: 'find', from: t, to, fac, reward: 10, title: `找${who}（最後在${nm(to)}一帶被看到）`}); }
    else if (r < .8) { const L = near(3).filter(x => (K.bandit[x] || 0) > 8); if (!L.length) continue; const to = L[Math.floor(jr(t, p, i, 23) * L.length)];
      out.push({id, kind: 'clear', from: t, to, fac, reward: 14, title: `趕走在${nm(to)}攔路收過路費的匪`}); }
    else { const g = jr(t, p, i, 29) < .5 ? 'food' : 'water', q = 5 + Math.floor(jr(t, p, i, 31) * 6);
      out.push({id, kind: 'supply', from: t, to: t, fac, g, n: q, reward: q * 2, title: `賣給城裡 ${q} 份${g === 'food' ? '熱量' : '淨水'}（缺得緊，價錢比平常好）`}); }
  }
  const seen = new Set(); return out.filter(j => { const k = j.kind + ':' + j.to; if (seen.has(k)) return false; seen.add(k); return true; }).map(j => ({...j, expires: (p + 1) * JOB_PERIOD + JOB_PERIOD}));
}
function jobDone(G, book, w, R, j, h) {
  j.state = 'done'; C.pay(book, h, G.name, j.reward, 'rover', `基地的在地小事：${j.title}`); relAdd(G, j.fac, 1, `替${w.names[j.from] || ''}的人辦事`, h);
  say(R, h, G.base, `小事辦完了：${j.title}。報酬 $${j.reward}k，跟${w.sim.peek().fac[j.fac]?.n || '那裡'}的關係 +1。`, 'find');
}
export function baseJob(G, book, w, id, h) {
  const R = ensureHq(G); if (!inTown(G, w)) return '要停在城裡才能接';
  const j = townJobs(w, G.base, h).find(x => x.id === id); if (!j) return '這件事已經不在了';
  R.jobs ||= []; if (R.jobs.some(x => x.id === id)) return '已經接了';
  if (R.jobs.filter(x => x.state !== 'done' && x.state !== 'failed').length >= JOB_MAX) return `一次最多接 ${JOB_MAX} 件`;
  const job = {...j, state: 'open', at: h, expires: h + JOB_PERIOD}; R.jobs.push(job);
  if (j.kind === 'supply') { if ((G.mats[j.g] || 0) < j.n) { R.jobs.pop(); return `倉庫的${j.g === 'food' ? '熱量' : '淨水'}不夠 ${j.n} 份`; } G.mats[j.g] -= j.n; jobDone(G, book, w, R, job, h); }
  else say(R, h, G.base, `接下在地小事：${j.title}。`);
  if (R.jobs.length > 30) R.jobs.splice(0, R.jobs.length - 30);
  return null;
}
function jobsArrive(G, book, w, R, h) {
  for (const j of R.jobs || []) { if (j.state === 'done' || j.state === 'failed') continue;
    if (j.kind === 'deliver' && j.to === G.base) jobDone(G, book, w, R, j, h);
    else if (j.kind === 'find' && j.state === 'open' && j.to === G.base) { j.state = 'found'; say(R, h, G.base, `找到人了（${j.title.replace(/^找/, '').replace(/（.*$/, '')}），要帶回${w.names[j.from] || ''}。`, 'find'); }
    else if (j.kind === 'find' && j.state === 'found' && j.from === G.base) jobDone(G, book, w, R, j, h);
    else if (j.kind === 'clear' && j.state === 'open' && j.to === G.base && !busyTicket(book, R)) { const tk = defend(G, book, w, h, '找到那夥收過路費的匪了'); if (tk) { j.state = 'fight'; j.ticket = tk.id; } else { j.state = 'failed'; } }
  }
}
function jobsHour(G, book, w, R, h) {
  for (const j of R.jobs || []) { if (j.state === 'done' || j.state === 'failed') continue;
    if (j.kind === 'clear' && j.state === 'fight') { const tk = book.tickets.find(t => t.id === j.ticket); if (tk?.done) { if (tk.win) jobDone(G, book, w, R, j, h); else { j.state = 'failed'; say(R, h, G.base, `沒能趕走那夥匪：${j.title}，這件事沒辦成。`, 'danger'); } } continue; }
    if (h >= j.expires) { j.state = 'failed'; say(R, h, G.base, `小事過期了：${j.title}。`); }
  }
}

// 每個遊戲小時（core.js 呼叫）
export function hqHour(cos, book, w, h) {
  for (const G of Object.values(cos)) { if (G.npc) continue; const R = ensureHq(G);
    if (R.guard && !busyTicket(book, R)) guardBack(G, book, R, h);
    // 每天：在城外要吃喝（在家的人；從倉庫的素材扣）
    if (h % 24 === 0 && !inTown(G, w)) {
      const n = G.roster.filter(x => x.alive && x.status === 'home').length;
      if (n) { const fNeed = n * HQ.FOOD_K * upK(R, 'food'), wNeed = n * HQ.WATER_K * upK(R, 'water'), fOk = (G.mats.food || 0) >= fNeed - 1e-6, wOk = (G.mats.water || 0) >= wNeed - 1e-6;
        G.mats.food = Math.max(0, +((G.mats.food || 0) - fNeed).toFixed(2)); G.mats.water = Math.max(0, +((G.mats.water || 0) - wNeed).toFixed(2));
        if (!fOk || !wOk) { R.hungry = (R.hungry || 0) + 1; for (const q of G.queue) if (!q.ready) q.done += 24; say(R, h, G.base, `${!wOk ? '淨水' : '熱量'}不夠分了（缺糧第 ${R.hungry} 天）：培養槽停一天，守衛打起來也比較弱。`, 'danger'); } else R.hungry = 0; }
    } else if (h % 24 === 0) R.hungry = 0;
    jobsHour(G, book, w, R, h);
    if (R.searching != null && h >= R.busyUntil) { const t = R.searching; R.searching = null; for (const s of searchResult(G, book, w, t, h)) say(R, h, t, s, 'find'); }
    // 作戰地圖的小格之間（單機）：到了就停在那一小格；要上路的話接著開下一段
    if (R.subMove && h >= R.subMove.t1) { const c0 = opCenter(G.base, MAPW), to = R.subMove.to; R.sub = to[0] === c0[0] && to[1] === c0[1] ? null : to; R.subMove = null;
      if (!R.route.length) say(R, h, G.base, `基地停好了（${nmOf(w)(G.base)}）。`); }
    // 開動
    for (let legs = 0; legs < 200 && R.move && h >= R.move.t1; legs++) { const t1 = R.move.t1; G.base = R.move.to; R.move = null; if (book.companies[G.name]) book.companies[G.name].base = G.base;
      for (const s of tileStory(G, book, w, G.base, h)) say(R, h, G.base, s, 'story');
      jobsArrive(G, book, w, R, h); if (busyTicket(book, R)) break;
      // 遭遇：單機用近的一層（near.js：開進有敵對隊伍的那一格就打）；線上照原本每到一格擲一次
      const foe = NEAR.on ? nearAt(G, w, G.base) : null;
      if (foe || (!NEAR.on && roll(G.base, h, 1) < encounterP(w, G.base))) { defend(G, book, w, h, foe ? `基地在${nmOf(w)(G.base)}撞上一群${nearName(foe)}` : `基地在${nmOf(w)(G.base)}被人攔住`); if (busyTicket(book, R)) break; }
      else if (!R.route.length) { say(R, h, G.base, `基地到了${nmOf(w)(G.base)}。`); if (R.subGoal && NEAR.on) { const c0 = opCenter(G.base, MAPW), r = subRoute(G.base, c0, R.subGoal, od(w)); if (r) R.subMove = {from: c0, to: R.subGoal, t0: t1, t1: +(t1 + r.minutes / 60).toFixed(3)}; R.subGoal = null; } }
      if (R.route.length && !hqBlock(book, G, h)) nextLeg(G, book, w, R, t1); }
    if (!R.move && !R.subMove && R.route.length && !hqBlock(book, G, h)) nextLeg(G, book, w, R, h);
    // 派遣的結果（單機第 4 步）：探索打贏＝搜那一格；交流＝那一格的故事和附近的線索；攻擊打贏＝那一格的敵對隊伍散了
    for (const id of G.cases) { const c = book.cases.find(x => x.id === id); if (!c?.sortie || c.sortie.done || c.sortie.win == null) continue;
      c.sortie.done = true; const t = c.tile, nm = nmOf(w);
      if (c.sortie.lair != null) { lairResult(G, book, w, R, c, h); continue; }
      if (!c.sortie.win) { say(R, h, t, `${c.title}：沒有辦成。`, 'danger'); continue; }
      // 探索只帶回消息：東西要基地開過去才搬得走（Alan 2026-10-12：搜索一定要整個基地開過去）
      if (c.sortie.mode === 'explore') { const L = tileStory(G, book, w, t, h), site = nearSite(book, w, t, h), body = (book.bodies || []).filter(b => b.tile === t && !b.takenBy).length, K = w.sim.peek();
        say(R, h, t, `${c.title}：${L.join('')}${site && !site.taken ? `找到了${site.title}——要把基地開過來才搬得走。` : ''}${body ? `那裡倒著 ${body} 具遺體。` : ''}${K.ruin[t] ? '有一片廢墟，基地停過來可以搜。' : ''}`, 'find'); }
      else if (c.sortie.mode === 'talk') { const L = tileStory(G, book, w, t, h); const site = nearSite(book, w, t, h); say(R, h, t, `${c.title}：${L.join('')}${site && !site.taken ? `當地人說起附近的${site.title}。` : ''}`, 'story'); }
      else { if (R.near) R.near = R.near.filter(p => !(p.tile === t && p.kind !== 'caravan')); say(R, h, t, `${c.title}：把${nm(t)}的匪打散了。`, 'find'); } }
    // 近的一層（單機）：附近的隊伍生出、移動；敵對的追上基地就打（手上已經有服務單時先不追上）
    if (NEAR.on) opsStart(G, book, w, h);   // 小格上的派遣：到了那一格就照小格路線走
    if (NEAR.on) fogMark(G, book, w, h);   // 戰爭迷霧：看過的格子記下來
    if (NEAR.on) { const c = nearHour(G, w, h, !busyTicket(book, R) && !(R.holdUntil > h), (hh, t, text) => say(R, hh, t, text, 'note'), book);
      if (c?.base) defend(G, book, w, h, `一群${nearName(c.base)}追上了基地（${nmOf(w)(G.base)}）`);
      for (const v of c?.vans || []) if (C.ambushNow(book, w, v.sq.id, v.tile, h)) { say(R, h, v.tile, `${v.sq.name}${v.sq.op && !v.sq.op.done ? '' : '的運兵車'}在${nmOf(w)(v.tile)}被一群${nearName(v.p)}攔下。`, 'danger'); if (v.sq.op && !v.sq.op.done) { v.sq.op.pause = h; v.sq.op.cut = true; } }   // 小格上走到一半被攔：打完再接著走
      // 清剿據點（OPMAP.md 第十三、十四節）：找到確切位置、被哨兵看到、警戒過後搬家、流寇換地方
      const who = e => e.kind === 'base' ? '基地' : e.sq.name;
      for (const f of c?.found || []) say(R, h, f.s.tile, `${who(f.e)}在${nmOf(w)(f.s.tile)}找到了${siteName(f.g, f.s)}的確切位置${gangInfo(G, w, f.g).sites.length > 1 ? `（這一夥人有 ${gangInfo(G, w, f.g).sites.length} 處${f.g.native ? '' : gangInfo(G, w, f.g).nomad ? '營地' : '據點'}）` : ''}：作戰地圖上標出來了，可以派人過去攻擊。`, 'find');
      for (const f of c?.spotted || []) say(R, h, f.s.tile, `${who(f.e)}被${siteName(f.g, f.s)}的哨兵看到了：警戒 ${NEAR.ALERT} 小時，派了一群人出來追${gangInfo(G, w, f.g).nomad ? '；流寇會趕快換地方' : ''}。`, 'danger');
      for (const m of c?.moved || []) say(R, h, m.g.lair, m.all ? `${m.g.name}那一夥流寇換了地方：之前找到的營地都不算了。` : `${siteName(m.g, m.s)}被驚動後搬走了：要再找一次確切的位置。`, 'note');
      opsFinish(G, book, w, h); }
  }
}

// ───── 小格上的派遣（OPMAP.md 第十三節：巡查併在派人過去底下）─────
const opSquads = (G, book) => Object.values(book.squads).filter(sq => sq.player === G.name && sq.caseId && !sq.headedHome && C.alive(sq).length).map(sq => ({sq, c: book.cases.find(x => x.id === sq.caseId)})).filter(x => x.c?.sortie?.op && !x.c.settled);
function opsStart(G, book, w, h) {
  for (const {sq, c} of opSquads(G, book)) {
    if (sq.op?.pause != null && !sq.busy) { const d = h - sq.op.pause; for (const p of sq.op.pts) if (p[2] > sq.op.pause) p[2] = +(p[2] + d).toFixed(3); sq.op.pause = null; say(G.hq, h, c.tile, `${sq.name}打完了，接著${c.sortie.sweep ? '巡查' : '走'}。`, 'note'); continue; }
    if (sq.op || sq.busy || sq.drillDone || sq.readyAt > h) continue;
    sq.op = opPlan(w, c.tile, {sweep: c.sortie.sweep, sub: c.sortie.sub, mode: c.sortie.move}, h);
    say(G.hq, h, c.tile, `${sq.name}到了${nmOf(w)(c.tile)}，${c.sortie.sweep ? '開始巡查整格' : '往那一小格過去'}（${sq.op.mode === 'foot' ? '徒步' : '開車'}，約 ${C.fmtDur(Math.max(0, opEnd(sq.op) - h))}）。`, 'note'); }
}
function opsFinish(G, book, w, h) {
  const R = G.hq, K = w.sim.peek(), nm = nmOf(w);
  for (const {sq, c} of opSquads(G, book)) { const op = sq.op; if (!op || op.handled || sq.busy || op.pause != null || !(op.done || h >= opEnd(op))) continue;
    op.handled = true; op.done = true; const t = c.tile, cut = op.cut ? '路上遇襲過一次。' : '';
    if (c.sortie.mode === 'fight') {
      if (c.sortie.lair != null) { const g = (K.gangs || []).find(x => x.id === c.sortie.lair), x = g && !g.gone ? gangInfo(G, w, g) : null, L = x ? x.sites.find(s => s.sid === (c.sortie.site ?? headSite(x).sid)) : null;
        if (!L || L.found == null || L.sub[0] !== c.sortie.sub[0] || L.sub[1] !== c.sortie.sub[1]) { c.sortie.win = false; c.sortie.done = true; sq.drillDone = true; say(R, h, t, `${c.title}：撲了個空，據點已經不在那裡。`, 'danger'); continue; }
        // 這一層的守軍：那處據點的兵力 ÷ 還剩幾層；警戒中多兩成，沒被發現就到了（偷襲）少一點；派出去在外面晃的人不在家
        const out = (R.near || []).filter(p => p.lairId === g.id && (p.siteId == null || p.siteId === L.sid) && opDist(p.pos, L.sub) > 2).length, alert = L.alert > h;
        const pow = Math.round(layerPower(L) * (alert ? 1.2 : 1) - (alert ? 0 : 2) - 2 * out);
        // 增援：同一夥人的其他據點（同一格第 4 回合、隔壁格第 7 回合；警戒中早 2 回合），一次抽那處兵力的 1/4，來了就回不去
        const reinf = [], side = g.native ? 'native' : 'raider';
        for (const o of x.sites) { if (o === L || o.pool < 8) continue; const d = opDist(opCenter(o.tile, MAPW), opCenter(L.tile, MAPW)) / 7; if (d > 1.01) continue;
          const amt = Math.round(o.pool * LAIR.REINF.share); if (amt < 4) continue; o.pool -= amt;
          reinf.push({turn: Math.max(2, (d < .5 ? LAIR.REINF.same : LAIR.REINF.near) - (alert ? LAIR.REINF.alert : 0)), units: C.opUnits(book, side, amt, 'clear', 8), from: siteName(g, o)}); }
        c.sortie.pow = pow;
        C.sortieTicket(book, w, c, sq, h, {type: 'clear', gang: g.id, power: pow, boss: !!L.head, floors: L.layers - L.taken, reinf});
        say(R, h, t, `${sq.name}摸到了${siteName(g, L)}旁邊：${alert ? '警戒中，守得比較嚴' : '對方還沒發現，可以偷襲'}${out ? `；${out} 群人不在家` : ''}。還有 ${L.layers - L.taken} 層要打${reinf.length ? `，${reinf.map(r => r.from).join('、')}會派人來增援` : ''}。`, 'note');
      } else C.sortieTicket(book, w, c, sq, h, {type: 'drill'});
      continue; }
    c.sortie.win = true; c.sortie.done = true; sq.drillDone = true;
    if (c.sortie.mode === 'talk') { const L = tileStory(G, book, w, t, h); say(R, h, t, `${c.title}：${cut}${L.join('')}`, 'story'); continue; }
    // 這一格的據點（每一處各算）：這一趟找到的、之前就找到的
    const here = []; for (const g of (K.gangs || []).filter(g => !g.gone)) { const x = G.lairs?.[g.id]; if (x?.sites) for (const s of x.sites) if (s.tile === t) here.push({g, s}); }
    const mine = new Set((op.found || []).map(f => Array.isArray(f) ? f.join(':') : f + ':0')), found = here.filter(q => mine.has(q.g.id + ':' + q.s.sid)), known = here.filter(q => !mine.has(q.g.id + ':' + q.s.sid) && q.s.found != null);
    const site = nearSite(book, w, t, h), body = (book.bodies || []).filter(b => b.tile === t && !b.takenBy).length;
    say(R, h, t, `${c.title}：${cut}${found.length ? `找到了${found.map(q => siteName(q.g, q.s)).join('、')}的確切位置。` : op.sweep ? (known.length ? '整格掃過一遍。' : '整格掃過一遍，沒有據點。') : ''}${known.length ? `${known.map(q => siteName(q.g, q.s)).join('、')}之前就找到了。` : ''}${site && !site.taken ? `找到了${site.title}——要把基地開過來才搬得走。` : ''}${body ? `那裡倒著 ${body} 具遺體。` : ''}${K.ruin[t] ? '有一片廢墟，基地停到那一小格可以搜。' : ''}動身回基地。`, 'find');
  }
}
// 清剿的結果（OPMAP.md 第十四節）：打下的層數記下來、打倒的人從那處據點的兵力扣掉（不補回）；
// 層數打完或兵力打光＝那一處拆掉（小據點給一點存貨）；主據點拆掉頭目逃到剩下的據點；全部拆光＝這夥人散了（存貨、賞金，一夥人一次）；沒打下來＝警戒
function lairResult(G, book, w, R, c, h) {
  const K = w.sim.peek(), g = (K.gangs || []).find(x => x.id === c.sortie.lair);
  if (!g || g.gone) { say(R, h, c.tile, `${c.title}：那一夥人已經散了。`, 'note'); return; }
  const x = gangInfo(G, w, g), s = x.sites.find(q => q.sid === (c.sortie.site ?? headSite(x).sid)), nm = s ? siteName(g, s) : '據點';
  if (!s) { say(R, h, c.tile, `${c.title}：那一處據點已經不在了。`, 'note'); return; }
  const r = c.sortie.res || {}, rem = s.layers - s.taken, cleared = Math.max(0, Math.min(rem, r.floors != null && !r.auto ? r.floors : c.sortie.win ? rem : 0));
  const pow = c.sortie.pow || layerPower(s), before = x.sites.reduce((a, q) => a + q.pool, 0) + (c.sortie.reinfPow || 0);
  s.taken += cleared; s.pool = Math.max(0, s.pool - cleared * pow - (cleared < rem ? (r.kills || 0) * LAIR.UNIT : 0));
  if (x.nomad) x.nextMove = Math.min(x.nextMove ?? Infinity, h + 24);   // 流寇被打過就提早搬
  if (x.native && (cleared || r.kills)) { G.grudge = (G.grudge || []).filter(q => h < q.until); G.grudge.push({tile: s.tile, until: h + 24 * 7, name: g.name}); say(R, h, s.tile, `附近的聚落知道你打了${g.name}：一週內打聽不到消息，商隊也不跟你買賣。`, 'note'); }   // 附近的聚落一週不理你
  const after = () => x.sites.reduce((a, q) => a + q.pool, 0); g.str = Math.max(1, (g.str || 1) * Math.max(.05, after() / Math.max(1, before)));
  if (s.taken < s.layers && s.pool > 0) {
    s.alert = h + NEAR.ALERT;
    say(R, h, c.tile, cleared ? `${c.title}：打下了 ${cleared} 層（共 ${s.taken}／${s.layers}），撤出來了。${nm}剩下的守軍約 ${Math.round(s.pool)}，打掉的不會補回來，只會慢慢招人。警戒中。` : `${c.title}：沒打下來。${nm}警戒中${x.native || x.nomad ? '' : '，可能會搬走'}。`, cleared ? 'note' : 'danger');
    return; }
  // 這一處拆掉了
  x.sites.splice(x.sites.indexOf(s), 1);
  K.bandit[s.tile] = (K.bandit[s.tile] || 0) * .7;
  if (!x.sites.length) {   // 全部拆光：這一夥人散了
    for (const n of [g.lair, s.tile]) K.bandit[n] = (K.bandit[n] || 0) * .4; g.gone = 1; w.sim.pmc.say?.('bandit', `${g.name}${g.native ? '' : '那一夥人'}最後一處${g.native ? '村子' : '據點'}被傭兵公司拆了，手下四散。`, s.tile);
    const M = G.mats, cash = Math.round(8 + (x.str0 || 0) * .04);
    if (!x.looted) { x.looted = true; M.food = (M.food || 0) + 10; M.water = (M.water || 0) + 10; M.implant = (M.implant || 0) + 2; M.neural = (M.neural || 0) + 2; C.pay(book, h, G.name, cash, 'final', `${c.title}：據點的存貨與賞金`, c.id); }
    say(R, h, c.tile, `${c.title}：拆掉了${nm}——${g.name}${g.native ? '' : '那一夥人'}散了，四周的匪患大降。${x.looted ? `搬回存貨與賞金：$${cash}k、熱量 10、淨水 10、植入物 2、神經介質 2。` : ''}`, 'find');
    return; }
  const cash = 3; C.pay(book, h, G.name, cash, 'final', `${c.title}：搬回的東西`, c.id);
  let line = `${c.title}：拆掉了${nm}（搬回 $${cash}k）。`;
  if (s.head) { const nx = x.sites.slice().sort((a, b) => b.pool - a.pool)[0]; nx.head = true; if (nx.kind === 'out') { nx.kind = 'main'; nx.layers += 1; } g.lair = nx.tile; line += `頭目${g.name}逃到了${nmOf(w)(nx.tile)}的另一處據點，那裡升格成主據點（${nx.layers} 層）。`; }
  line += `${g.name}${g.native ? '' : '那一夥人'}還有 ${x.sites.length} 處${x.nomad ? '營地' : '據點'}。`;
  say(R, h, c.tile, line, 'find');
}

// 給畫面
export function hqView(G, book, w, h) {
  const R = ensureHq(G), K = w.sim.peek(), m = K.markets[G.base], nm = nmOf(w);
  const legHours = (from, route) => { let t = 0, a = from; for (const b of route) { t += legH(w, R, a, b); a = b; } return +t.toFixed(2); };
  return {near: nearView(G, h), lairs: NEAR.on ? lairsView(G, w, h) : null, sub: R.sub || null, subMove: R.subMove || null, hold: R.holdUntil > h ? R.holdUntil : null, tile: G.base, place: nm(G.base), move: R.move, route: R.route, dest: R.route.length ? R.route[R.route.length - 1] : R.move?.to ?? null, parked: parked(G), inTown: inTown(G, w), town: !!(m && K.owner[G.base] >= 0),
    block: hqBlock(book, G, h), ticket: busyTicket(book, R)?.id || null, guard: guardOf(book, R)?.clones.map(c => c.uid) || [], searching: R.searching != null ? R.busyUntil : null, searchedAt: R.searched[G.base] ?? null,
    up: Object.entries(UP).map(([k, U]) => { const lv = upLv(R, k), max = U.k.length - 1, here = upHere(w, G.base, k);
      const near = here ? [] : Object.keys(K.markets).map(Number).filter(t => upHere(w, t, k)).map(t => ({t, d: w.sim.pmc.dist(G.base, t)})).filter(x => isFinite(x.d)).sort((a, b) => a.d - b.d).slice(0, 3)
        .map(x => { const path = w.sim.pmc.route(G.base, x.t) || []; return {tile: x.t, name: nm(x.t), d: Math.max(0, path.length - 1), hours: legHours(G.base, path.slice(1))}; });
      return {kind: k, n: U.n, lv, max, now: U.text(U.k[lv]), next: lv < max ? U.text(U.k[lv + 1]) : null, cost: lv < max ? UP_COST[lv] : null, where: U.where, here, near}; }),
    jobsHere: inTown(G, w) ? townJobs(w, G.base, h).filter(j => !(R.jobs || []).some(x => x.id === j.id)) : [],
    jobs: (R.jobs || []).filter(j => j.state !== 'done' && j.state !== 'failed').map(j => ({...j, toName: nm(j.to), fromName: nm(j.from), d: Math.round(w.sim.pmc.dist(G.base, j.state === 'found' ? j.from : j.to)) || 0})),
    etaH: (() => { const t = R.move ? Math.max(0, R.move.t1 - h) : 0; return +(t + legHours(R.move ? R.move.to : G.base, R.route)).toFixed(2); })(),
    // 之後要開回集合點的人（出勤中的小隊、回程中、在集合點等的）；駐軍不算（撤回時照當下基地的位置）
    // here：集合點就是基地現在這一格（基地不動就會自己回來）；far：集合點在別的地方（要把基地開過去接）
    out: (() => { const o = {here: 0, far: 0, farAt: []}, add = (to, n) => { if (!n) return; if (hdist(to ?? G.base, G.base) <= 1) o.here += n; else { o.far += n; if (!o.farAt.includes(to)) o.farAt.push(to); } };
      for (const sq of Object.values(book.squads)) if (sq.player === G.name && sq.headedHome == null && sq.garrison == null && !sq.guard && (sq.caseId || sq.column)) add(sq.meet ?? G.base, sq.clones.filter(x => x.alive && x.status === 'away').length);
      for (const r of G.returning || []) add(r.to ?? G.base, 1);
      return {...o, farAt: o.farAt.map(t => ({tile: t, name: nm(t)}))}; })(),
    // 外出的人（Alan 2026-10-12）：照集合點分組；每個人現在在做什麼、什麼時候到集合點（任務中的是預估：案期結束後開回來）、到了之後還能等多久
    outs: (() => { const by = {}, grp = to => by[to] ||= {tile: to, name: nm(to), here: hdist(to, G.base) <= 1, d: Math.max(0, (w.sim.pmc.route(G.base, to) || [0]).length - 1), people: []};
      for (const sq of Object.values(book.squads)) { if (sq.player !== G.name || sq.headedHome != null || sq.garrison != null || sq.guard || !(sq.caseId || sq.column)) continue;
        const c = book.cases.find(k => k.id === sq.caseId), to = sq.meet ?? G.base, back = c ? C.travelHours(w, c.tile, to) : 0;
        for (const x of sq.clones) if (x.alive && x.status === 'away') grp(to).people.push({uid: x.uid, state: sq.column ? 'column' : 'case', what: c?.title || sq.name, eta: c ? +(c.end + (isFinite(back) ? back : 24)).toFixed(2) : null, est: true}); }
      for (const r of G.returning || []) { const to = r.to ?? G.base; grp(to).people.push(h >= r.at ? {uid: r.uid, state: 'wait', until: r.wait ?? r.at + 48} : {uid: r.uid, state: 'travel', eta: r.at, until: r.at + 48}); }
      return Object.values(by).sort((a, b) => b.here - a.here || a.d - b.d); })(),
    fuel: HQ.FUEL, daily: {food: HQ.FOOD_K * upK(R, 'food'), water: HQ.WATER_K * upK(R, 'water')}, hungry: R.hungry || 0,
    home: G.home ?? G.base, homeName: nm(G.home ?? G.base), homeFac: K.fac[K.owner[G.home ?? G.base]]?.n || '', regCost: HQ.REG_COST, regAt: G.homeAt ?? null,
    site: (s => s && {title: s.title, hint: s.hint, taken: s.taken || null, kind: s.kind})(nearSite(book, w, G.base, h)), log: R.log.slice(-80).reverse()};
}
// 某一段路線要多久（畫面上的「基地開到這裡」卡片用）
export function hqTrip(G, w, to) {
  const R = ensureHq(G), from = R.move ? R.move.to : G.base, path = w.sim.pmc.route(from, to) || [];
  if (!path.length || path[path.length - 1] !== to) return null;
  let t = R.move ? Math.max(0, R.move.t1 - G.h) : 0, a = from; for (const b of path.slice(1)) { t += legH(w, R, a, b); a = b; }
  return {tiles: path.length - 1, hours: +t.toFixed(2), fuel: (path.length - 1) * HQ.FUEL, path};
}
