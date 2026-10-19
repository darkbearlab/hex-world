// 奇美拉：玩家公司（MVP，沒有戰鬥層）
// 總部設在開局選的主城；四種素材（糧、水、植入物、神經介質）在培養槽造複製人；
// 沒有模板時看投入比例決定容易出哪個職業，每個人的數值是純抽的浮動（評級：銀冠前 10%、金冠前 1%）；
// 模板保證拿到某一位、數值固定（約前 20%），是事件和活動的獎勵。
// 接機會層的案、編成小隊派出去；服務單只能自動結算（戰鬥層還沒接上）。
import * as C from './cases.js';
import {hdist} from './sim.js';

// ===== 移動基地與運兵車（Alan 2026-10-12，warband/DESIGN.md「移動基地」）=====
// G.base 是基地現在停的格子（會動，rover.js）；G.home 是登記地（勢力看這裡）。運兵車是「同時能派幾隊出去」：一台四個人，
// 出門到回到基地都佔著；從現場的基地直接派（基地停在旁邊一格以內）不用車、不限隊數。大戰役、勢力戰一定要基地到場。
// 出門時記下集合點（出發時基地的位置）：回來時基地不在，就在那裡等 VAN.WAIT_H 小時；基地開到回程的路上（或集合點旁邊）就上車；等不到就倒在那裡（遺體）
export const VAN = {START: 2, MAX: 4, PRICE: [150, 250], WAIT_H: 48, NPC: 8};
export const ensureHq = G => G.hq ||= {route: [], move: null, log: [], searched: {}, seen: [], up: {}, jobs: [], busyUntil: 0, searching: null, hungry: 0, caseId: null, guard: null};
export const parked = G => !G.hq || (!G.hq.move && !G.hq.route.length);
export const inTown = (G, w) => { const K = w.sim.peek(); return parked(G) && !!K.markets[G.base] && K.owner[G.base] >= 0; };
export const onSite = (G, tile) => !!G.npc || (parked(G) && hdist(G.base, tile) <= 1);
const homeFac = (G, K) => K.owner[G.home ?? G.base];
// 運兵車：出勤中（還在外面、沒有在回程）的小隊，加上回程中的人坐的車（同一台車回來的算一台）
export function vansUsed(G, book) {
  const used = new Set();
  for (const sq of Object.values(book.squads)) if (sq.player === G.name && sq.van && sq.headedHome == null && (sq.caseId || sq.garrison != null || sq.column) && sq.clones.some(x => x.alive && x.status === 'away')) used.add(sq.id);
  for (const r of G.returning || []) if (r.van) used.add(r.van);
  return used.size;
}
export const vanCap = G => G.npc ? VAN.NPC : G.vans ?? VAN.START;
export const vansFree = (G, book) => vanCap(G) - vansUsed(G, book);
const NO_VAN = '運兵車都派出去了（等車回來，或把基地開過去直接派）';
// 遠征點與突發事件（core.js 每天整理進 book.sites、book.events）：一定要基地到場搜索，先搜到的先拿
export const SITE_CD = 24 * 7;
export function nearSite(book, w, t, h) {
  const R = w.sim.rumor; if (R && R.tile === t && !R.found) return {kind: 'station', title: '傳聞中的舊星艦維修站', hint: '鋼骨從沙裡伸出來，底下好像還有東西在動', lv: 3, taken: null, event: true,
    claim: () => {}, loot: (G, h2) => { w.sim.stationFound(-1, w.sim.year, G.name); G.mats.implant = (G.mats.implant || 0) + 60; G.mats.neural = (G.mats.neural || 0) + 60; C.pay(book, h2, G.name, 80, 'site', `${w.names[t] || ''}：找到舊星艦維修站`);
      return ['鋼骨底下真的是一座舊星艦的維修站——工廠還在動。從外圍拆下一批舊時代的零件：植入物 +60、神經介質 +60，另外賣掉一些拆下來的東西 $80k。消息很快就會傳開。']; }};
  const ev = (book.events || []).find(e => e.tile === t && !e.taken && h >= e.start && h < e.end), st = ev ? null : (book.sites || []).find(x => x.tile === t), s = ev || st;
  if (!s) return null;
  const tk = st && book.siteTaken?.[t], taken = tk && h - tk.h < SITE_CD ? tk.co : null;
  return {kind: s.kind, title: s.title, hint: s.hint, lv: s.lv || 1, taken, event: !!ev,
    claim: co => { if (ev) ev.taken = co; else (book.siteTaken ||= {})[t] = {co, h}; }, loot: (G, h2) => siteLoot(G, book, w, s, h2)};
}
function siteLoot(G, book, w, s, h) {
  const K = w.sim.peek(), t = s.tile, lv = s.lv || 1, out = [], add = (m, n) => { G.mats[m] = (G.mats[m] || 0) + n; };
  if (s.kind === 'legacy') { const wp = (K.weapons || []).find(x => x.lost && x.loc === t && !x.lake) || (K.weapons || []).find(x => x.lost && hdist(x.loc, t) <= 1 && !x.lake);
    if (wp) { Object.assign(wp, {holder: 0, fac: -1, gang: 0, lost: false, loc: -1, pmc: G.name, sealed: false}); wp.owners = (wp.owners || 0) + 1; wp.hist?.push({y: w.sim.year, t: `${G.name}的基地在${w.names[t] || '荒野'}挖出它。`});
      gainLegacy(G, {kind: wp.kind, weapon: wp.name, legacy: wp.id, bonus: wp.bonus}, h); out.push(`挖出了遺產級「${wp.name}」（${wp.kind}），收進倉庫。`); }
    else out.push('翻遍了舊戰場，那件東西已經不在了。'); }
  else if (s.kind === 'mine') { const n = 15 * lv; add('implant', n); if (K.vein[t] > 0) K.vein[t] *= .8; out.push(`從舊礦坑拆出零件，做成植入物 +${n}。`); }
  else if (s.kind === 'fuel') { const v = 8 * lv; C.pay(book, h, G.name, v, 'site', `在${w.names[t] || ''}的油棘林收燃料賣掉`); out.push(`收了一車燃料賣掉，$${v}k。`); }
  else if (s.kind === 'ruin') { add('implant', 6 * lv); add('neural', 6 * lv); out.push(`在廢墟裡拆到植入物 +${6 * lv}、神經介質 +${6 * lv}。`); }
  else if (s.kind === 'pod') { add('food', 60); add('water', 60); add('implant', 20); add('neural', 20); out.push('撬開墜毀的補給艙：熱量、淨水各 +60，植入物、神經介質各 +20。'); }
  else if (s.kind === 'cache') { const b = ['rifle', 'smg', 'shotgun', 'sniper', 'lmg'], af = Object.keys(AFFIX_NAMES).filter(a => a !== 'homemade');
    for (let i = 0; i < 2; i++) { const it = newItem(G, {kind: 'gun', base: b[(t * 7 + h + i * 3) % b.length], affix: af[(t + h + i) % af.length] || null}); (G.store ||= []).push(it); }
    (G.store ||= []).push(newItem(G, {kind: 'kit', base: 'meds', n: 3})); out.push('找到走私者的藏貨：兩把帶詞條的槍、一組醫療包，收進倉庫。'); }
  else if (s.kind === 'wreck') { C.pay(book, h, G.name, 30, 'site', `${w.names[t] || ''}的車隊殘骸`); rewardArmor(G, h); out.push('從沙暴後露出的車隊殘骸裡拆到 $30k 的貨，還有一件護甲。'); }
  return out;
}
// 到了集合點（或在路上碰到基地）：上車回到基地
function boardHq(G, c, r) { G.returning.splice(G.returning.indexOf(r), 1); if (c && c.alive && c.status === 'returning') c.status = 'home'; }

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
// ASH 技能的中文名（複製人出生沒有技能，2 級學會職業技能（2026-10-13 起；原本 3 級）；chimera/ash/overlay/src/chimera-squad.js）
export const SKILL_NAME = {early_warning: '預警', signal_break: '訊號斷層', anchor: '下錨', grapple: '鉤鎖', workshop: '工坊', suppressive_fire: '壓制射擊'};
// ===== 成長（Alan 2026-10-13，DESIGN.md「強化（perk）整組重做」：模仿 XCOM）=====
// 2 級學會職業技能；4、6、8、10 級各從三種性格裡選一個（選了就固定，可以跨性格）；3、5、7、9、11 級長數值（GROW 每次的量）。
// 規則在戰鬥那邊（chimera/ash/overlay/src/chimera-talents.js，照 id）；ASH 原本的升級三選一不再出現。
export const TALENT_ROWS = [4, 6, 8, 10];
const T = (id, n, text) => ({id, n, text});
export const TALENTS = {
  soldier: {paths: ['觀測手', '火線手', '突入手'], grow: {hp: 6, acc: 2, eva: 1}, rows: {
    4: [T('sol_wide', '廣域預警', '預警半徑 +4、冷卻 −2。'), T('sol_brace', '架槍精通', '打躲在掩體後的目標，架槍的命中加成 +12 → +20。'), T('sol_close', '近身射擊', '3 格內的霰彈槍傷害 +20%。')],
    6: [T('sol_weaken', '標定弱化', '預警的標定多 1 回合；被標定的敵人打全隊的命中 −10。'), T('sol_track', '修正到底', '著彈修正多一層（最多 +32）；換目標只掉一層，不歸零。'), T('sol_charge', '衝鋒', '每場第一次移動不花回合。')],
    8: [T('sol_press', '標定壓制', '預警的標定多 1 回合；全隊打被標定的目標傷害再 +10%（共 +20%）。'), T('sol_supp', '壓制射擊', '學會壓制射擊（技能：消耗 3 發，目標格與相鄰的敵人被壓制）。技能的預備欄一次放一個。'), T('sol_finish', '補刀', '打中但沒打倒的敵人，到下一回合結束前你打他命中 +15、傷害 +15%。')],
    10: [T('sol_net', '戰場網', '每回合開始自動預警一次（照你的預警半徑），不用自己放。'), T('sol_line', '火線', '敵人在你的射程內、看得到的地方移動時，你自動開一槍（命中 −15，每回合一次）。'), T('sol_stand', '不倒', '每場一次，致命傷改成剩 1 點生命。')]}},
  recon: {paths: ['獵影', '斥候', '游擊'], grow: {hp: 4, acc: 2, eva: 2}, rows: {
    4: [T('rec_unseen', '隱蔽射手', '目標看不到你時，傷害 +24%。'), T('rec_smoke', '煙幕專家', '每場多帶 2 顆煙霧彈、2 顆震撼彈。'), T('rec_side', '側身精通', '側身時，敵人打你的命中再 −12。')],
    6: [T('rec_break', '斷層延長', '訊號斷層持續 +1、冷卻 −1。'), T('rec_spot', '前方觀測', '你看得到的敵人，隊友打它命中 +8。'), T('rec_hitrun', '打帶跑', '開槍之後可以再走一格，不花回合（每回合一次）。')],
    8: [T('rec_first', '第一槍', '每場的第一輪射擊，以及打還沒發現你們的敵人時，傷害 ×1.5。'), T('rec_nv', '夜眼分享', '身邊 3 格內的隊友也有夜視。'), T('rec_dodge', '閃身', '每回合第一次被打中，傷害減半。')],
    10: [T('rec_ghost', '幽靈', '你擊倒敵人時，訊號斷層的冷卻歸零。'), T('rec_cover', '全隊掩護', '身邊 3 格內的隊友被打中的機率 −10。'), T('rec_blur', '無影', '移動之後，敵人打中你的機率最多 30%。')]}},
  bulwark: {paths: ['堡壘', '彈幕', '破陣'], grow: {plates: 10, acc: 1}, rows: {
    4: [T('bul_anchor', '下錨強化', '下錨時受到的傷害 −30%，解除下錨不花回合。'), T('bul_belt', '彈鏈', '輕機槍彈匣 +50%。'), T('bul_knock', '破陣拳', '動力拳打中時，把敵人擊退一格。')],
    6: [T('bul_plate', '板甲護持', '還有護甲板時，受到的傷害再 −16%。'), T('bul_deep', '壓得更深', '輕機槍每打中一次，多疊一層壓制。'), T('bul_ram', '衝撞', '走到敵人身邊時順手打一拳（動力拳傷害的一半，每回合一次）。')],
    8: [T('bul_guard', '護衛', '身邊的隊友受到的傷害，三成改由你的護甲板吃。'), T('bul_sweep', '掃射', '輕機槍打中目標時，目標身邊的敵人各挨一發。'), T('bul_wall', '拆牆', '動力拳打中敵人時，把他身邊的掩體一起打爛。')],
    10: [T('bul_rock', '不動如山', '下錨時不會被壓制，每回合回 10 點護甲板。'), T('bul_net', '火力網', '下錨時，每回合射程內最近的兩個敵人各被壓制一層。'), T('bul_hammer', '重錘', '動力拳擊倒敵人時，他身邊的敵人各受 15 點傷害。')]}},
  berserker: {paths: ['屠夫', '狂徒', '獵犬'], grow: {hp: 10, mel: 2, eva: 1}, rows: {
    4: [T('ber_thirst', '嗜血狂歡', '近戰吸血 20% → 36%。'), T('ber_fury', '狂怒堆疊', '戰意上限 5 → 7 層。'), T('ber_hook', '快鉤', '鉤鎖冷卻 −2。')],
    6: [T('ber_endure', '血怒不退', '戰意晚 4 回合才開始掉。'), T('ber_whirl', '旋斬', '近戰打中時，身邊其他敵人各挨一半的傷害。'), T('ber_rehook', '連鉤', '鉤鎖那一刀擊倒敵人時，鉤鎖冷卻歸零。')],
    8: [T('ber_bloodplate', '血甲', '吸血超過生命上限的部分變成護甲板。'), T('ber_roar', '戰吼', '近戰擊倒敵人時，身邊 3 格的敵人被壓制一層。'), T('ber_pounce', '撲殺', '鉤鎖那一刀傷害 +50%，打大型與頭目再 +50%。')],
    10: [T('ber_undying', '不死', '致命傷改成剩 1 點生命，消耗一層戰意（沒有戰意就照常倒下）。'), T('ber_slaughter', '屠戮', '每回合第一次擊倒敵人後，可以再攻擊一次，不花回合。'), T('ber_execute', '處決', '近戰打中生命低於三成的敵人直接斃命（頭目除外）。')]}},
  engineer: {paths: ['機師', '工廠', '陣地'], grow: {hp: 5, acc: 1, drone: 5}, rows: {
    4: [T('eng_frame', '機體強化', '機體最大生命 +40、裝甲 +2。'), T('eng_lines', '生產序列', '工坊多一條生產線。'), T('eng_cover', '架設掩體', '這回合沒有移動、身邊沒有掩體時，回合結束自動花 10 廢料在面向敵人的一側立一塊掩體。')],
    6: [T('eng_fire', '火控校準', '機體射擊命中 +16、傷害 +6。'), T('eng_deploy', '部署上限', '同時部署的機體 +1 台。'), T('eng_sentry', '砲台延伸', '定點砲台射程 +2。')],
    8: [T('eng_remote', '遙控', '這回合沒有移動時，身邊 3 格內的機體多行動一次。'), T('eng_salvage', '戰場回收', '全隊每擊倒一個敵人，你拿到 3 廢料。'), T('eng_mine', '絆雷', '這回合沒有移動時，回合結束自動花 15 廢料在身邊埋一顆絆雷（最多 3 顆）；敵人踩到就爆炸（60 點傷害，周圍 1 格）。')],
    10: [T('eng_boom', '自爆', '機體被打爆時，身邊 1 格的敵人受 30 點傷害。'), T('eng_repair', '免費維修', '每回合自動修理受傷最重的一台機體（回復 25% 生命），不花廢料。'), T('eng_line', '堡壘線', '站在掩體或定點砲台旁邊的隊友，受到的傷害 −20%。')]}},
};
// 數值成長的次數（3、5、7、9、11 級各一次）與總量
export const growSteps = lv => Math.max(0, Math.floor(((lv || 1) - 1) / 2));
export function growOf(c) { const g = TALENTS[c.cls]?.grow || {}, n = growSteps(c.lv); return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v * n])); }
export const talentIds = c => TALENT_ROWS.map(r => c.tal?.[r] != null ? TALENTS[c.cls]?.rows[r]?.[c.tal[r]]?.id : null).filter(Boolean);
// 工兵的廢料（Alan 2026-10-13）：ASH 不再給廢料（擊殺、拆武器、撿到的都沒有），每場進場照等級補滿到這個數
export const engineerScrap = lv => (lv || 1) < 2 ? 0 : 40 + 20 * ((lv || 1) - 2);
export const SKILL_LV = 2;
export function pickTalent(G, uid, row, k) {
  const c = G.roster.find(x => x.uid === uid), R = TALENTS[c?.cls];
  if (!c || !R) return '找不到這個人';
  if (!TALENT_ROWS.includes(row) || !(k >= 0 && k < 3)) return '沒有這個選項';
  if ((c.lv || 1) < row) return `${row} 級才能選`;
  if (c.tal?.[row] != null) return '這一級已經選過了';
  (c.tal ||= {})[row] = k; C.rec(c, {h: G.h, t: 'talent', co: G.name, lv: row, name: R.rows[row][k].n});
  return null;
}
export const PORTRAITS = ['ember', 'onyx', 'silver', 'cedar', ...Array.from({length: 12}, (_, i) => `portrait-${String(i + 5).padStart(2, '0')}`)];
// 資料主人（DNA 原主）（Alan 2026-10-10）：每張立繪是一位原主，名字和職業都綁在原主身上（大和不會變成輕巡）；
// 複製人是原主的一批，畫面顯示「原主名字 編號」。名單是暫定的，之後 Alan 會換掉。
export const DONORS = {
  ember: {name: '凱拉', cls: 'soldier'}, onyx: {name: '伊薇', cls: 'recon'}, silver: {name: '莎菈', cls: 'bulwark'}, cedar: {name: '娜迪亞', cls: 'berserker'},
  'portrait-05': {name: '蕾雅', cls: 'engineer'}, 'portrait-06': {name: '米菈', cls: 'soldier'}, 'portrait-07': {name: '塔莉亞', cls: 'recon'}, 'portrait-08': {name: '艾琳', cls: 'bulwark'},
  'portrait-09': {name: '薇拉', cls: 'berserker'}, 'portrait-10': {name: '諾娃', cls: 'engineer'}, 'portrait-11': {name: '茵格', cls: 'soldier'}, 'portrait-12': {name: '菲歐', cls: 'recon'},
  'portrait-13': {name: '瑟琳', cls: 'bulwark'}, 'portrait-14': {name: '朵拉', cls: 'berserker'}, 'portrait-15': {name: '雅絲', cls: 'engineer'}, 'portrait-16': {name: '露恩', cls: 'soldier'},
  io: {name: '伊歐', cls: 'engineer'},   // 守密者（不在 PORTRAITS 裡：培養槽抽不到她，每家公司只有一位）
};
export const donorName = c => DONORS[c.donor ?? c.portrait]?.name || '';
// 換裝（Alan 2026-10-14）：同一位原主可以有好幾套衣服；第一套是預設，放在 donors/<原主>/，其他的放 donors/<原主>/<衣服>/（立繪、頭像、站姿、戰場 sprite 都換）。
// 只換外觀；c.outfit 記穿哪一套，畫面和戰場用 artKey(c) 找圖
export const OUTFITS = {io: [['work', '維修工作服'], ['combat', '戰鬥服']]};
export const artKey = c => { const d = c.donor ?? c.portrait, o = c.outfit, L = OUTFITS[d]; return o && L && L.findIndex(([k]) => k === o) > 0 ? `${d}/${o}` : d; };
export function setOutfit(G, uid, id) {
  const c = G.roster.find(x => x.uid === uid); if (!c) return '找不到這個人';
  const L = OUTFITS[c.donor ?? c.portrait]; if (!L?.some(([k]) => k === id)) return '沒有這套衣服';
  if (id === L[0][0]) delete c.outfit; else c.outfit = id; return null;
}
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
// 評級：銀冠前 10%、金冠前 1%；反過來的（Alan 2026-10-11：紀念素質這麼差的）錫冠後 10%、鉛冠後 1%
export const crownOf = pct => pct >= .99 ? 'gold' : pct >= .9 ? 'silver' : pct <= .01 ? 'lead' : pct <= .1 ? 'tin' : '';
export function makeClone(G, rng, cls, portrait, u, o = {}) {
  const B = CLS[cls].base, sum = u.reduce((x, y) => x + y, 0), pct = ihCdf(sum);
  const st = {hp: Math.round(B.hp * (.9 + .2 * u[0])), acc: B.acc + Math.round(-8 + 16 * u[1]), eva: B.eva + Math.round(-8 + 16 * u[2]), mel: B.mel + Math.round(-8 + 16 * u[3])};
  const L = 'ABCDEFGHJKLMNPRSTVWXZ'[Math.floor(rng() * 21)];
  // 編號（Alan 2026-10-10）：uid 是全星球的流水號（帳本 book.cloneSeq 發號），之後易主、回收不會撞號；顯示的編號也照流水號（五位數，跟舊的四位數亂數分得開）
  const n = Math.floor(rng() * 10000);
  return {id: o.uid != null ? `${L}-${String(o.uid).padStart(5, '0')}` : `${L}-${String(n).padStart(4, '0')}`, uid: o.uid ?? G.seq++, cls, portrait, st, u, pct: +pct.toFixed(4),
    crown: crownOf(pct), pow: +(6 * CLS[cls].k * (.85 + .075 * sum)).toFixed(2), weapon: CLS[cls].weapon,
    hp: 20, alive: true, status: 'home', keep: false, born: o.born || 0, template: !!o.template, kills: 0, missions: 0, donor: portrait, record: [], lv: 1, cells: [0, 0, 0, 0], dup: 0, cellPts: 0};
}

// ===== 公司 =====
export function newCompany(w, base, name = '我的公司', seed = 7, book = null) {
  const G = {flows: [], daily: [], name, base, home: base, vans: VAN.START, cash: GCFG.START_CASH, mats: {...GCFG.START_MATS}, roster: [], templates: [], queue: [], store: [], itemSeq: 0, seq: 1, fameLog: [], rs: seed | 0, h: 0, ledgerAt: 0, inboxAt: 0, log: [], cases: [], returning: []};
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
// 守密者伊歐（Alan 2026-10-14）：受命守住這台 Rover 的複製人，玩家的鏡子——編號對著玩家的流水號（G.no）。
// 玩家本來是闖進基地的掠奪者，被同夥暗算、九死一生時伊歐醒來打跑了掠奪者；她認定玩家在保護基地，認了這個新指揮官。
// 不會死：倒下只算撤退，躺回培養槽（不佔槽、不花素材），KEEPER.REGEN_H 小時後回來。不能賣、不能合成。
export const KEEPER = {REGEN_H: 24, U: .6};
export function makeKeeper(G, book, h = 0) {
  const c = makeClone(G, () => .5, 'engineer', 'io', [KEEPER.U, KEEPER.U, KEEPER.U, KEEPER.U], {uid: nextUid(book), born: h});
  Object.assign(c, {id: `IO-${String(G.no ?? 0).padStart(5, '0')}`, keeper: true, callsign: '守密者'}); c.crown = '';
  C.rec(c, {h, t: 'born', co: G.name, tile: G.base}); G.roster.unshift(c); return c;
}
export const KEEPER_INTRO = '你本來是闖進這座基地的掠奪者，卻被同夥從背後暗算。倒在地上、九死一生的時候，基地深處的培養槽亮了——守密者伊歐醒過來，把那夥人打跑了。她認定你是在保護基地的人，於是叫你「指揮官」。公司就這樣開張了。';
function keeperHour(G, book, h) {
  for (const c of G.roster) if (c.keeper) {
    if (!c.alive || ['kia', 'lost', 'recovered', 'sold'].includes(c.status)) {   // 倒下＝撤退：遺體不留在戰場，名單上拿掉，直接躺回培養槽
      if (book.bodies) book.bodies = book.bodies.filter(b => !(b.co === G.name && b.uid === c.uid));
      for (const sq of Object.values(book.squads || {})) { const i = sq.clones.indexOf(c); if (i >= 0) sq.clones.splice(i, 1); }
      G.returning = (G.returning || []).filter(x => x.uid !== c.uid);
      Object.assign(c, {alive: true, status: 'regen', regenAt: h + KEEPER.REGEN_H, hp: 20}); delete c.downAs; delete c.downAt; delete c.downTile; delete c.diedH;
      C.rec(c, {h, t: 'regen', co: G.name}); note(G, h, `${label(c)} 撤回基地，躺回培養槽。${KEEPER.REGEN_H} 小時後回來（不花素材）。`);
    } else if (c.status === 'regen' && h >= c.regenAt) { c.status = 'home'; delete c.regenAt; note(G, h, `${label(c)} 從培養槽出來了：「我回來了，指揮官。」`); }
  }
}
// 最低編制（Alan 2026-10-14：玩得太爛、一直犧牲人又沒辦法重新培養的救濟）：企業撤走時留下的培養槽緊急程式。
// 卡住＝能出擊的人不到 2、素材湊不出最便宜的一份配方（某一種不到 GCFG.MIN）、現金不到 RELIEF.CASH。卡住時：
// 每 RELIEF.EVERY 小時免費出一個配給型（數值偏低、不能賣、不能合成），補到能出擊的有 2 人；行動一不用付素材（不給現金、不掉模板）；每日清運順便撿回總部附近的自己人
export const RELIEF = {CASH: 50, EVERY: 12, READY: 2, U: .3, NEAR: 6};
const readyN = G => G.roster.filter(c => c.alive && c.status === 'home' && !c.keep).length;
const poor = G => MATS.some(m => (G.mats[m] || 0) < GCFG.MIN) && G.cash < RELIEF.CASH;
function reliefHour(G, book, h) {
  if (G.npc) return; const R = G.relief ||= {on: false, next: 0};
  const stuck = poor(G);
  if (!R.on && stuck && readyN(G) < RELIEF.READY) { R.on = true; R.next = h; R.since = h; note(G, h, '伊歐：「人手不夠了。我把企業留下的緊急程式打開了——別讓我後悔。」（最低編制啟動）'); }
  else if (R.on && !stuck) { R.on = false; note(G, h, '伊歐：「素材夠了，緊急程式我關掉了。」（最低編制結束）'); return; }
  if (R.on && h >= R.next && readyN(G) < RELIEF.READY) { R.next = h + RELIEF.EVERY; const r = () => rnd(G), cls = pickW(r, classOdds({food: 30, water: 30, implant: 30, neural: 30}));
    const c = makeClone(G, r, cls, pickPortrait(r, cls), [RELIEF.U, RELIEF.U, RELIEF.U, RELIEF.U], {uid: nextUid(book), born: h}); c.ration = true; c.crown = '';
    C.rec(c, {h, t: 'born', co: G.name, tile: G.base, ration: true}); G.roster.push(c); G.fresh = c.uid; note(G, h, `緊急程式出了一個配給型：${CLS[c.cls].n} ${label(c)}（數值偏低、不能賣、不能合成）。`); }
}
export function mkTemplate(G, r) {
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
// 稀有素材（Alan 2026-10-18，DESIGN.md「縮小規模」第 2 步）：培養本身很簡單，貴在植入物、神經介質這類非生活必需品難取得——
// 每座城一週只進得了一點（cap），買走的要慢慢補回來（一週補滿）；剩得越少越貴（全部買光時 ×(1+SURGE)）。
// 廠區的植入物多一點；有培養槽的城才有神經介質，槽越多進得越多；其他城的植入物還是要用零件做（照原本的零件存貨）
// on：只有單機（SOLO=1 的伺服器）打開；線上的共用星球維持原本的行情（Alan 還沒決定線上要不要改）
export const RARE = {on: false, WEEK: 168, SURGE: 1.5,
  implant: m => m.works ? 120 : (m.vat || 0) > 0 ? 40 + 10 * Math.min(4, m.vat) : 30,
  neural: m => (m.vat || 0) > 0 ? 20 + 10 * Math.min(4, m.vat) : 0};
export function rareLeft(m, mat, h) {
  if (!RARE.on || !m || !RARE[mat]) return null;
  const cap = RARE[mat](m); if (!cap) return {cap: 0, left: 0, k: 1, s: null};
  const R = m.rare ||= {}, s = R[mat] ||= {left: cap, h};
  if (h > s.h) { s.left = Math.min(cap, s.left + cap * (h - s.h) / RARE.WEEK); s.h = h; }
  s.left = Math.min(cap, s.left);
  return {cap, left: Math.floor(s.left), k: 1 + RARE.SURGE * (1 - s.left / cap), s};
}
const surge = (m, mat, h) => rareLeft(m, mat, h)?.k ?? 1;
export function prices(G, w) {
  const K = w.sim.peek(), m = K.markets[G.base], p = g => m?.price?.[g] ?? 1;
  return {food: +(.2 * p('food')).toFixed(2), water: +(.24 * p('water')).toFixed(2), implant: +(.25 * p('parts') * implantK(K, G.base) * surge(m, 'implant', G.h)).toFixed(2), neural: +(neuralAt(w, G.base) * surge(m, 'neural', G.h)).toFixed(2)};
}
// 在基地所在的城買得到多少（畫面用；糧水看存貨，稀有素材看這週剩多少）
export function stockHere(G, w) {
  const m = w.sim.peek().markets[G.base]; if (!m || !RARE.on) return null; const out = {};
  for (const mat of ['implant', 'neural']) { const r = rareLeft(m, mat, G.h); out[mat] = mat === 'implant' && !m.works && !(m.vat > 0) ? Math.min(r.left, Math.floor(m.stock.parts * 200)) : r.left; }
  return out;
}
export function buy(G, w, mat, qty) {
  if (!inTown(G, w)) return '基地要停在城裡才能買素材';
  const pr = prices(G, w)[mat], cost = Math.round(pr * qty);
  if (cost > G.cash) return '錢不夠';
  const K = w.sim.peek(), m = K.markets[G.base];
  // 糧和水直接從市場存貨裡買走（100 份吃掉 5 份存貨）；植入物在有廠區或培養槽的城直接有賣，其他城要用零件存貨做（100 份吃掉 0.5 份零件）
  if (m && (mat === 'food' || mat === 'water')) { if (m.stock[mat] < qty * .05) return `${w.names[G.base]}的${MN[mat]}不夠賣`; m.stock[mat] -= qty * .05; }
  const rr = m && rareLeft(m, mat, G.h); if (rr && rr.left < qty) return rr.cap ? `${w.names[G.base]}這週的${MN[mat]}只剩 ${rr.left}（每週約進 ${rr.cap}）` : `${w.names[G.base]}沒有賣${MN[mat]}`;
  if (m && mat === 'implant' && !m.works && !(m.vat > 0)) { if (m.stock.parts < qty / 200) return `${w.names[G.base]}的零件不夠做植入物`; m.stock.parts -= qty / 200; }
  if (rr) rr.s.left -= qty;
  G.cash -= cost; G.mats[mat] += qty; flow(G, 'buy', -cost, `本地買進${MN[mat]} ${qty}`); return null;
}
function flow(G, kind, amount, text) { G.flows.push({h: G.h, kind, amount: Math.round(amount), text}); if (G.flows.length > 3000) G.flows.splice(0, 500); }

// ===== 採購路線：派車隊去別座城買料，沿實際道路來回，路上可能被劫 =====
// 價格看那座城的市價；廠區和有培養槽的城賣植入物（廠區便宜），有培養槽的城才有神經介質。跟總部所屬勢力交戰中的城不賣。
const TRIP_FEE = 1.2, TRIP_LOAD = 6;
function offerAt(w, t, h) {
  const K = w.sim.peek(), m = K.markets[t], p = g => m?.price?.[g] ?? 1;
  if (!m) return null;
  const off = {k: 1, left: Infinity, cap: null}, ri = rareLeft(m, 'implant', h) || off, rn = rareLeft(m, 'neural', h) || {...off, left: (m.vat || 0) > 0 ? 999 : 0};   // 線上（稀有素材沒開）：照原本的上限
  return {
    food: {price: +(.2 * p('food')).toFixed(2), max: Math.min(999, Math.floor(m.stock.food / .05 / 100) * 100)},
    water: {price: +(.24 * p('water')).toFixed(2), max: Math.min(999, Math.floor(m.stock.water / .05 / 100) * 100)},
    implant: {price: +(.25 * p('parts') * implantK(K, t) * ri.k).toFixed(2), max: RARE.on ? Math.min(ri.left, m.works || (m.vat || 0) > 0 ? 999 : Math.floor(m.stock.parts * 200)) : m.works ? 999 : (m.vat || 0) > 0 ? 500 : Math.min(999, Math.floor(m.stock.parts * 200 / 100) * 100), ...(RARE.on ? {week: ri.cap} : {})},
    neural: {price: +(neuralAt(w, t) * rn.k).toFixed(2), max: RARE.on ? rn.left : (m.vat || 0) > 0 ? 999 : 0, ...(RARE.on ? {week: rn.cap} : {})},
  };
}
export function quotes(G, w) {
  const K = w.sim.peek(), P = w.sim.pmc, T = P.tree(G.base), me = homeFac(G, K);
  const out = [];
  for (const k of Object.keys(K.markets)) {
    const t = +k, o = K.owner[t]; if (o < 0 || t === G.base || !isFinite(T.dist[t])) continue;
    const path = T.path(t), risk = path.reduce((x, i) => x + K.bandit[i] + (me >= 0 && K.owner[i] >= 0 && P.atWar(K.owner[i], me) ? 40 : 0), 0);
    const hours = Math.ceil(T.dist[t] * C.CFG.TRAVEL);
    out.push({t, name: w.names[t], fac: K.fac[o]?.n || '', war: me >= 0 && P.atWar(o, me), works: !!K.markets[t].works, vat: K.markets[t].vat || 0,
      hours, trip: hours * 2 + TRIP_LOAD, risk: Math.min(.99, 1 - Math.exp(-risk / 1500 * 2)), fee: Math.round(hours * 2 * TRIP_FEE), offer: offerAt(w, t, G.h)});
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
  if (!inTown(G, w)) return '基地要停在城裡才能下訂單（貨送到基地現在停的城）';
  let pick = uids.map(u => G.roster.find(c => c.uid === u)).filter(c => c && c.alive && c.status === 'home' && !c.keep);
  // 護衛：從基地坐一台運兵車去（最多四人）；基地就停在那座城旁邊的話直接派
  const near = onSite(G, t); if (pick.length >= 2 && !near) { if (vansFree(G, book) < 1) return NO_VAN; pick = pick.slice(0, 4); }
  const K = w.sim.peek(), m = K.markets[t];
  if (mat === 'food' || mat === 'water') m.stock[mat] -= qty * .05; else if (mat === 'implant' && !m.works && !(m.vat > 0)) m.stock.parts -= qty / 200;
  const rr = rareLeft(m, mat, G.h); if (rr?.s) rr.s.left -= qty;   // 稀有素材：訂下來就算買走了
  C.registerCompany(book, G.name, G.base);
  const c = C.openCase(book, w, {kind: 'route', own: G.name, guard: 16, title: `採購：${MN[mat]} ${qty}（${q.name}）`, tile: t, from: t, to: G.base, fac: homeFac(G, K), lv: 1, hours: q.trip,
    cargo: {g: mat, amt: qty, val: o.price}}, now);
  c.mat = mat; c.qty = qty;
  G.cash -= cost; flow(G, 'trip', -cost, `採購路線：${q.name}的${MN[mat]} ${qty}（貨款 $${Math.round(o.price * qty)}k、車隊 $${q.fee}k）`);
  const groups = []; for (let i = 0; i < pick.length; i += 4) groups.push(pick.slice(i, i + 4));
  for (const g of groups) { if (g.length < 2) continue; const sq = C.makeSquad(book, G.name, {clones: g, gear: 3, at: G.base, name: `${G.name}・護衛${G.seq++}隊`}); sq.van = !near; sq.meet = G.base; if (C.enlist(book, c.id, sq.id, now)) for (const x of g) { x.status = 'away'; x.missions++; } }
  G.cases.push(c.id);
  note(G, now, `車隊出發去${q.name}買${MN[mat]} ${qty}，來回約 ${fmtH(q.trip)}，送到${w.names[G.base] || ''}（基地現在的位置；到時候基地不在，貨先寄放在那座城）${pick.length >= 2 ? '，有護衛' : '，沒有護衛（只有雇來的車隊守衛）'}。`);
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
  for (const r of G.returning.slice()) if (t >= r.at) { G.returning.splice(G.returning.indexOf(r), 1); const c = G.roster.find(x => x.uid === r.uid); if (c && c.alive && c.status === 'returning') c.status = 'home'; n++; }
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
    Object.assign(c, {alive: true, status: 'home', hp: 20, lv: 1, xp: 0, cells: [0, 0, 0, 0], dup: 0, cellPts: 0, picks: [], tal: {}, skills: [], prep: null, perkPicks: 0, classPerkMisses: 0, legacyPerkPicks: 0, downAs: null, downAt: null, downTile: null, diedH: null, born: h});
    // 舊小隊的名單裡還有這個人（倒下時留著，給結案記紀錄用）：拿掉，不然活過來的人會被當成那一隊的人繼續派單
    if (book) for (const sq of Object.values(book.squads)) { const i = sq.clones.indexOf(c); if (i >= 0) sq.clones.splice(i, 1); }
    C.rec(c, {h, t: 'revive', co: G.name, tile: G.base}); G.fresh = c.uid;
    note(G, h, `培養槽出槽：${CLS[c.cls].n} ${label(c)} 重新培養完成，回到名冊（等級、技能從頭來）。`); return;
  }
  const c = q.tpl ? makeClone(G, r, q.tpl.cls, q.tpl.portrait, [GCFG.TEMPLATE_U, GCFG.TEMPLATE_U, GCFG.TEMPLATE_U, GCFG.TEMPLATE_U], {born: h, template: true, uid: nextUid(book)})
    : (cls => makeClone(G, r, cls, pickPortrait(r, cls), [r(), r(), r(), r()], {born: h, uid: nextUid(book)}))(pickW(r, classOdds(q.recipe)));
  C.rec(c, {h, t: 'born', co: G.name, tile: G.base});
  gearOf(G, c); c.weapon = gearLabel(c.gear); G.roster.push(c); G.fresh = c.uid;
  note(G, h, `培養槽出槽：${CLS[c.cls].n} ${label(c)}${c.crown === 'gold' ? '（金冠！）' : c.crown === 'silver' ? '（銀冠）' : c.crown === 'lead' ? '（鉛冠……）' : c.crown === 'tin' ? '（錫冠）' : ''}${c.template ? '（模板）' : ''}，配發${c.weapon}。`);
}

// ===== 接案、派兵、補員 =====
// ===== 裝備（Alan 2026-10-09，warband/DESIGN.md「裝備欄與變賣」） =====
// 每個人：槍 ×3（種類＋一個詞條）、近戰 ×1（天生的狂戰斧、忍刀、動力拳套不佔欄，由職業帶）、護甲 ×1（開戰時的裝甲板）、預備品 ×2（消耗品，一格一種）。
// 名稱與 ASH 的繁中翻譯一致；帶進戰鬥時照這裡配給 ASH（ash/overlay/src/chimera-squad.js applyGear），打完照身上剩的寫回。
export const GUNS = {rifle: {n: '突擊步槍', v: 40}, shotgun: {n: '霰彈槍', v: 35}, smg: {n: '衝鋒槍', v: 35}, sniper: {n: '精準步槍', v: 60}, lmg: {n: '輕機槍', v: 70}, launcher: {n: '榴彈發射器', v: 80}, plasma: {n: '電漿步槍', v: 120}, flamer: {n: '火焰發射器', v: 60}};
export const MELEES = {knife: {n: '求生小刀', v: 10}, sabre: {n: '軍刀', v: 25}, spear: {n: '長矛', v: 25}, claws: {n: '手爪', v: 30}, chainsaw: {n: '鏈鋸', v: 50}};
export const ARMORS = {light: {n: '輕型護甲', plates: 10, v: 20}, medium: {n: '中型護甲', plates: 20, v: 45}, heavy: {n: '重型護甲', plates: 30, v: 80}};
export const KITS = {meds: {n: '醫療包', v: 5, max: 3}, grenades: {n: '破片彈', v: 6, max: 3}, smoke: {n: '煙霧彈', v: 4, max: 3}, stun: {n: '震撼彈', v: 5, max: 3}, emp: {n: 'EMP', v: 8, max: 2}, glowsticks: {n: '螢光棒', v: 2, max: 6}, flares: {n: '照明彈', v: 4, max: 3}};   // 螢光棒、照明彈（2026-10-14 進市集）
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
export function gainLegacy(G, boss, h, sq = null) {
  const d = LEGACY_GEAR[boss.kind] || LEGACY_GEAR.光束步槍;
  const it = newItem(G, {...d, legacy: {id: boss.legacy, name: boss.weapon, kind: boss.kind, bonus: boss.bonus}});
  const bag = bagOf(G, sq); bag.push(it); note(G, h, `帶回遺產級「${boss.weapon}」（${boss.kind}），放進${bag === G.store ? '倉庫' : '隨隊行李'}。`);
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
export function giveItem(G, o) { const it = newItem(G, o); (G.store ||= []).push(it); return it; }   // 搶購、事件拿到的東西直接進倉庫
function newItem(G, o) { G.itemSeq = (G.itemSeq || 0) + 1; return {id: 'I' + G.itemSeq, ...o}; }
// 物品編號只在同一家公司裡不重複（I1、I2……）。易主的遺體身上的裝備帶著原公司的編號，會跟新公司的倉庫撞號（soak 測試 2026-10-12）：
// 這家公司所有的物品（倉庫、名冊身上、自己小隊的行李）裡撞號的重新發號；讀舊存檔時也跑一次
export function reidItems(G, book) {
  const all = [...(G.store || [])]; for (const c of G.roster) if (c.gear) for (const s of SLOTS) { const it = slotGet(c.gear, s); if (it) all.push(it); }
  for (const sq of Object.values(book?.squads || {})) if (sq.player === G.name) all.push(...(sq.pack || []));
  let mx = G.itemSeq || 0; for (const it of all) { const n = +String(it.id).slice(1); if (n > mx) mx = n; } G.itemSeq = mx;
  const seen = new Set(), done = new Set(); let n = 0;
  for (const it of all) { if (done.has(it)) continue; done.add(it); if (seen.has(it.id)) { it.id = 'I' + ++G.itemSeq; n++; } seen.add(it.id); }
  return n;
}
// 一個人身上的裝備（還沒有的照職業配發；舊存檔的人第一次用到時補上）
export function gearOf(G, c) {
  if (!c.gear) { const d = CLASS_GEAR[c.cls] || CLASS_GEAR.soldier;
    c.gear = {guns: [0, 1, 2].map(i => d.guns[i] ? newItem(G, {kind: 'gun', base: d.guns[i], affix: 'homemade'}) : null), melee: null, armor: null, kits: [0, 1].map(i => d.kits[i] ? newItem(G, {kind: 'kit', base: d.kits[i], n: 2}) : null)}; }
  return c.gear;
}
const gearLabel = g => g.guns.filter(Boolean).map(itemName).concat(g.melee ? [itemName(g.melee)] : []).join('、');
// 換裝：把倉庫的一件放進某一格（itemId 為空＝卸下），原本那一件回倉庫。只有在總部待命的人可以換
// 消耗品不當成一件一件的東西（Alan 2026-10-12）：倉庫、行李裡同名的預備品併成一疊；放上身時只拿一格放得下的數量，其餘留在那一疊
export function stackKits(list) {
  if (!list?.length) return list; const first = {};
  for (let i = 0; i < list.length; i++) { const it = list[i]; if (it.kind !== 'kit' || it.legacy) continue;
    const f = first[it.base]; if (!f) { first[it.base] = it; continue; } f.n = (f.n || 0) + (it.n || 0); list.splice(i--, 1); }
  for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === 'kit' && !(list[i].n > 0)) list.splice(i, 1);
  return list;
}
// 從一疊預備品拿出放得進一格的數量（同種的就補滿那一格）；回傳要放上去的那一份（null＝已經補在原本那一格）或錯誤訊息
function takeKit(G, bag, it, old) {
  const mx = KITS[it.base]?.max || 3;
  if (old && old.kind === 'kit' && old.base === it.base) { const k = Math.min(it.n, mx - old.n); if (k <= 0) return '這一格已經滿了'; old.n += k; it.n -= k; if (!it.n) bag.splice(bag.indexOf(it), 1); return null; }
  const k = Math.min(it.n, mx); if (k === it.n) { bag.splice(bag.indexOf(it), 1); return it; }
  it.n -= k; return newItem(G, {kind: 'kit', base: it.base, n: k});
}
export function equipItem(G, uid, slot, itemId) {
  const c = G.roster.find(x => x.uid === uid); if (!c || !c.alive) return '找不到這個人';
  if (c.status !== 'home') return '出勤中不能換裝';
  if (!SLOTS.includes(slot)) return '沒有這個欄位';
  const g = gearOf(G, c); G.store ||= [];
  let it = null;
  if (itemId) { it = G.store.find(x => x.id === itemId); if (!it) return '倉庫裡沒有這件'; if (it.kind !== slotKind(slot)) return '放不進這一格'; }
  const old = slotGet(g, slot);
  if (it?.kind === 'kit') { const piece = takeKit(G, G.store, it, old); if (typeof piece === 'string') return piece; if (piece) { if (old) G.store.push(old); slotSet(g, slot, piece); } }
  else { if (it) G.store.splice(G.store.indexOf(it), 1); if (old) G.store.push(old); slotSet(g, slot, it); }
  stackKits(G.store); c.weapon = gearLabel(g);
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
// 隨隊行李（Alan 2026-10-11）：出勤中撿到的、身上放不下的先進小隊的行李，回到總部才收進倉庫；單子之間可以整補（fieldEquip）
const bagOf = (G, sq) => sq && sq.player === G.name && sq.clones.some(c => c.alive && c.status === 'away') ? (sq.pack ||= []) : (G.store ||= []);
export function unpack(G, sq, h) {
  if (!sq?.pack?.length) return; G.store ||= []; const n = sq.pack.length; G.store.push(...sq.pack); sq.pack = [];
  note(G, h, `${sq.name}的隨隊行李（${n} 件）收進倉庫。`);
}
// 整補：小隊沒在打的時候，把行李裡的東西換到某個人身上（itemId 空的就是卸下來放進行李）。同種的預備品會補滿那一格，多的留在行李
export function fieldEquip(G, book, squadId, uid, slot, itemId) {
  const sq = book.squads[squadId]; if (!sq || sq.player !== G.name) return '找不到這一隊';
  const c = sq.clones.find(x => x.uid === uid); if (!c || !c.alive || c.status !== 'away') return '這個人不在這一隊的現場';
  if (book.tickets.some(t => t.squad === sq.id && !t.done && t.fightAt != null)) return '這一隊有一場戰鬥還沒打完，打完才能整補';
  if (!SLOTS.includes(slot)) return '沒有這個欄位';
  const g = gearOf(G, c), bag = (sq.pack ||= []), old = slotGet(g, slot);
  let it = null;
  if (itemId) { it = bag.find(x => x.id === itemId); if (!it) return '行李裡沒有這件'; if (it.kind !== slotKind(slot)) return '放不進這一格'; }
  if (it?.kind === 'kit') { const piece = takeKit(G, bag, it, old); if (typeof piece === 'string') return piece; if (piece) { if (old) bag.push(old); slotSet(g, slot, piece); } }
  else { if (it) bag.splice(bag.indexOf(it), 1); if (old) bag.push(old); slotSet(g, slot, it); }
  stackKits(bag);
  c.weapon = gearLabel(g);
  return null;
}
export function gearAfterBattle(G, c, r, sq = null) {
  if (!r) return; const g = gearOf(G, c);
  g.guns = [0, 1, 2].map(i => r.guns[i] ? newItem(G, {kind: 'gun', base: r.guns[i].base, affix: r.guns[i].affix || null, ...(r.guns[i].legacy ? {legacy: r.guns[i].legacy} : {})}) : null);
  g.melee = r.melee ? newItem(G, {kind: 'melee', base: r.melee, ...(r.meleeLegacy ? {legacy: r.meleeLegacy} : {})}) : null;
  const left = {...r.kits}; g.kits = g.kits.map(k => { if (!k) return null; const n = Math.min(left[k.base] || 0, KITS[k.base]?.max || 3); left[k.base] = (left[k.base] || 0) - n; return n > 0 ? {...k, n} : null; });
  // 身上兩格放不下的（撿到的）進隨隊行李（在總部就進倉庫），一疊最多 max 個
  const bag = bagOf(G, sq); for (const [b, n0] of Object.entries(left)) { let n = n0; while (KITS[b] && n > 0) { const k = Math.min(n, KITS[b].max); bag.push(newItem(G, {kind: 'kit', base: b, n: k})); n -= k; } }
  c.weapon = gearLabel(g);
}
// 戰場回收（Alan 2026-10-11）：打贏時，戰場上留下的槍、近戰武器、補給收進倉庫（彈藥抵彈藥費，core.js 算）。回傳收了什麼（給通知）
export function lootAfterBattle(G, loot, h, sq = null) {
  if (!loot) return ''; const bag = bagOf(G, sq), where = bag === G.store ? '倉庫' : '隨隊行李', got = [];
  for (const g of loot.guns || []) if (GUNS[g.base]) { bag.push(newItem(G, {kind: 'gun', base: g.base, affix: g.affix || null})); got.push(GUNS[g.base].n); }
  for (const b of loot.melee || []) if (MELEES[b]) { bag.push(newItem(G, {kind: 'melee', base: b})); got.push(MELEES[b].n); }
  for (const [b, n0] of Object.entries(loot.kits || {})) { let n = n0; if (!KITS[b] || n <= 0) continue; got.push(`${KITS[b].n} ${n0}`); while (n > 0) { const k = Math.min(n, KITS[b].max); bag.push(newItem(G, {kind: 'kit', base: b, n: k})); n -= k; } }
  if (got.length) note(G, h, `戰場回收：${got.join('、')}，收進${where}。`);
  return got.join('、');
}
const avail = G => G.roster.filter(c => c.alive && c.status === 'home' && !c.keep);
export function accept(G, book, w, opp, side, uids, now, _fast = false, contract = null) {
  const pick = uids.map(u => G.roster.find(c => c.uid === u)).filter(c => c && c.alive && c.status === 'home' && !c.keep);
  if (pick.length < 2) return '至少派兩個人';
  const why = gate(G, book, w, opp, pick); if (why) return why;
  const camp = opp.kind === 'camp';   // 大戰役：不限隊數，接了之後還可以再加派（Alan 2026-10-09）
  // 運兵車（2026-10-12）：基地在現場（旁邊一格以內、停著）就直接派、不限隊數；不然一次一台車、四個人。大戰役、勢力戰要基地到場
  const here = onSite(G, opp.tile);
  if (!here && (camp || opp.kind === 'front')) return `${camp ? '大戰役' : '勢力戰'}要把基地開過去（停在旁邊一格以內）才能接`;
  if (!here) { if (pick.length > C.CFG.VAN_SIZE) return `一台運兵車只能載 ${C.CFG.VAN_SIZE} 個人；要派更多人，把基地開過去`; if (vansFree(G, book) < 1) return NO_VAN; }
  if (!camp && G.cases.some(k => { const c = book.cases.find(x => x.id === k); return c && !c.settled && c.tile === opp.tile && c.kind === kindOf(opp); })) return '這個點已經接了';
  C.registerCompany(book, G.name, G.base);
  // 委託板上的委託：同一邊已經有人開了案件就加入；沒有就開一個，案期照委託的公開時刻算（晚接的人能打的時間就少）
  const sideKey = side || '';
  const solo = ['drill', 'hunting', 'security'].includes(opp.kind);   // 練兵單、狩獵場、場地維安：各開各的
  let c = contract && !solo ? book.cases.find(x => x.id === contract.cases[sideKey] && !x.settled) : null, created = false;
  if (c && G.cases.includes(c.id) && !camp) return '這個委託已經接了';
  if (camp && contract && Object.entries(contract.cases).some(([k, id]) => k !== sideKey && G.cases.includes(id))) return '已經替另一邊打了';
  if (!c) { c = C.caseFromOpp(book, w, opp, solo ? now : contract ? contract.start : now, {side, hours: solo ? (opp.hours || (opp.kind === 'hunting' ? 72 : 48)) : contract ? contract.end - contract.start : undefined}); if (!c) return '這個案子開不起來'; created = true; if (contract && !solo) contract.cases[sideKey] = c.id; }
  const groups = []; for (let i = 0; i < pick.length; i += 4) groups.push(pick.slice(i, i + 4));
  if (groups.length > 1 && groups[groups.length - 1].length < 2) groups[groups.length - 2].push(...groups.pop());
  let n = 0;
  for (const g of groups) {
    const sq = C.makeSquad(book, G.name, {clones: g, gear: 3, at: G.base, name: `${G.name}・第${G.seq++}隊`}); sq.van = !here; sq.meet = G.base;   // 集合點：出發時基地的位置
    if (C.enlist(book, c.id, sq.id, now, w)) { n++; for (const x of g) { x.status = 'away'; x.missions++; C.joinRec(x, c, G.name, now); }
      if (c.kind === 'hunting') C.pay(book, now, G.name, -3 * g.length, 'venue', `${c.title}：入口守衛的場地費（${g.length} 人）`, c.id);
      // 場地維安：報酬約打平來回的交通費和維持費，再多一點點
      if (c.kind === 'security') sq.secPay = Math.round((sq.van ? C.fareCost(w, G.base, c.tile, g.length) * 2 : 0) + C.CFG.UPKEEP * g.length * Math.ceil((c.end - now) / 24) + 2); }
    else delete book.squads[sq.id];
  }
  if (!n) {
    if (created) { book.cases.splice(book.cases.indexOf(c), 1); if (contract) delete contract.cases[sideKey]; }
    return '趕不上：到現場的時候已經不再派服務單了';
  }
  const again = G.cases.includes(c.id); if (!again) G.cases.push(c.id);
  note(G, now, `${again ? `「${c.title}」加派` : `接下「${c.title}」，派出`} ${n} 隊（${here ? '基地在現場，直接派' : '坐運兵車'}；集合點${w.names[G.base] || '這裡'}）。`);
  return null;
}
export const kindOf = o => ({supply: 'route', outpost: 'garrison', short: 'route', route: 'route', exp: 'route', logging: 'route', front: 'front', tense: 'garrison', lair: 'hunt', camp: 'camp', shadow: 'shadow', counter: 'shadow', privateer: 'privateer', drill: 'drill', hunting: 'hunting', security: 'security'})[o.kind];

// ===== 派系關係（Alan 2026-10-11）=====
// 每家公司對每個勢力一個關係值（−100～100）。一般委託做得好就上升；暗影行動曝光、替人私掠就下降。
// 太低（≤ REL.REFUSE）：那個勢力不開單給你、長約不跟你簽；夠高（≥ REL.BLACK）：開黑單給你、採購有折扣。每一筆記在 G.relLog（報表看得到）
export const REL = {MIN: -100, MAX: 100, REFUSE: -30, BLACK: 20, CASE: 2, EXPOSED_VICTIM: -40, EXPOSED_EMPLOYER: -10, BLACK_FAME: 20};
export const relOf = (G, f) => (G.rel || {})[f] || 0;
export function relAdd(G, f, v, why, h) { if (f == null || f < 0 || !v) return; G.rel ||= {}; G.rel[f] = Math.max(REL.MIN, Math.min(REL.MAX, (G.rel[f] || 0) + v)); (G.relLog ||= []).push({h, f, v: Math.round(v * 10) / 10, why}); if (G.relLog.length > 200) G.relLog.shift(); }
// 委託板上看不看得到（Alan 2026-10-11：條件不符的黑單不該出現在板上）：等級以外的門檻都照接案的規則
export const canSee = (G, book, w, opp) => !gate(G, book, w, opp, []);
// 派遣（Alan 2026-10-18，DESIGN.md「縮小規模」第 4 步）：自己挑一格派人去——探索（搜那一格，可能撞上零星的人）、交流（跟當地的人談，不打）、
// 攻擊（掃蕩那一格的匪，近的一層裡那一格的敵對隊伍一起清掉）。坐運兵車、一隊最多四人；打的部分照練兵單的服務單（親自打或自動結算）
export const SORTIE = {explore: '探索', talk: '交流', fight: '攻擊'};
export function sortie(G, book, w, tile, mode, uids, now) {
  if (!SORTIE[mode]) return '不認得的派遣';
  if (!Number.isInteger(tile) || !w.land[tile]) return '去不了那裡';
  const K = w.sim.peek(), town = !!K.markets[tile] && K.owner[tile] >= 0, nm = w.names[tile] || '無名之地';
  if (mode === 'fight' && town) return '不能在城裡動手';
  if (!isFinite(w.sim.pmc.dist(G.base, tile))) return '路走不到那裡';
  const lv = Math.max(1, Math.min(3, Math.round((K.bandit[tile] || 0) / 25) + 1));
  return accept(G, book, w, {kind: 'drill', tile, fac: -1, lv, hours: 48, sortie: mode, title: `派遣・${SORTIE[mode]}：${nm}`}, '', uids, now);
}
function gate(G, book, w, opp, pick) {
  const K = w.sim.peek(), me = homeFac(G, K);
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
export function reinforce(G, book, w, squadId, uids, now) {
  const pick = uids.map(u => G.roster.find(c => c.uid === u)).filter(c => c && c.alive && c.status === 'home' && !c.keep).slice(0, C.CFG.VAN_SIZE);
  if (!pick.length) return '沒有選人';
  const cs0 = book.cases.find(x => x.id === book.squads[squadId]?.caseId), van = !(cs0 && onSite(G, cs0.tile));   // 補員也是一台車（基地在現場就直接走過去）
  if (van && vansFree(G, book) < 1) return NO_VAN;
  const r = C.amend(book, w, squadId, pick.length, G.base, now, {clones: pick, van});
  if (!r.ok) return r.why;
  const cs = book.cases.find(x => x.id === book.squads[squadId]?.caseId);
  for (const c of r.amend.col ? book.squads[r.amend.col].clones : []) { c.status = 'away'; c.missions++; if (cs) C.joinRec(c, cs, G.name, now); }
  return null;
}

// ===== 每小時 =====
export function hour(G, book, w, h) {
  stackKits(G.store); for (const sq of Object.values(book.squads)) if (sq.player === G.name && sq.pack?.length) stackKits(sq.pack);   // 消耗品併成一疊
  G.h = h;
  if (book.relQ?.length) for (const q of book.relQ.splice(0)) { if (q.co === G.name) relAdd(G, q.f, q.v, q.why, h); else (book.relQ2 ||= []).push(q); }
  if (book.relQ2?.length) { book.relQ = book.relQ2; book.relQ2 = []; }
  for (const q of G.queue) if (!q.ready && h >= q.done) readyBuild(G, q, h);
  keeperHour(G, book, h); reliefHour(G, book, h);
  // 駐軍剩不到兩人（有人在護送時倒下）：撤回總部。不到兩人不能出動，留著只會在車隊來的時候違約（soak 測試 2026-10-12）
  for (const sq of Object.values(book.squads)) if (sq.player === G.name && sq.garrison != null && !sq.caseId && sq.clones.filter(x => x.alive && x.status === 'away').length < 2) {
    const left = sq.clones.filter(x => x.alive && x.status === 'away'); if (left.length) sendHome(G, w, left, sq.garrison, h, book, sq.name, G.base, sq.van ? sq.id : null); unpack(G, sq, h); delete book.squads[sq.id];
    note(G, h, `${sq.name}只剩 ${left.length} 人，開車回基地${left.length ? `（約 ${Math.round(C.travelHours(w, sq.garrison, G.base))} 小時，集合點${w.names[G.base] || ''}）` : ''}。駐軍至少要兩人才能出動，要繼續駐紮請重新派人。`); }
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

  // 這個人現在的差事是不是這個案件（Alan 2026-10-11）：舊案件的小隊名單還留著已經去做別的事（下一個案件、駐軍）的人，
  // 舊案件結案時不能把他們拉回總部（空暗原駐軍被前一張護送單結案拉回來，害長約違約）
  // 收尾就啟程（Alan 2026-10-10）：案件進入收尾（不再派服務單），自己的服務單都打完的小隊就啟程返回，不必等案件結算（結算還要等案期結束、一天緩衝、別家的單打完）
  for (const id of G.cases) {
    const c = book.cases.find(x => x.id === id); if (!c || c.settled || c.own || c.open) continue;
    for (const sid of c.squads) { const sq = book.squads[sid]; if (sq.player !== G.name || sq.headedHome || book.tickets.some(t => t.squad === sid && !t.done)) continue;
      const away = sq.clones.filter(x => x.alive && x.status === 'away' && onCase(x, c.id)); sq.headedHome = h;
      // 駐軍：就算隊上已經沒有在這張單上的人，也要從護送單脫鉤（原本跳過，一直掛在案件上；讀檔的修補才脫鉤，存檔讀回就不一樣——soak 測試 2026-10-12）
      if (!away.length) { if (sq.garrison != null) garBack(G, book, sq, c, h); continue; }
      if (sq.garrison != null) { garBack(G, book, sq, c, h); sq.readyAt = Math.max(sq.readyAt, h + 6); note(G, h, `「${c.title}」收尾，${sq.name} 回到駐地。`); continue; }   // 駐軍回駐地待命（休整 6 小時）
      const hrs = sendHome(G, w, away, c.tile, h, book, `${c.title}（${sq.name}）`, sq.meet ?? G.base, sq.van ? sq.id : null, c.id);
      unpack(G, sq, h);
      note(G, h, `「${c.title}」收尾，${sq.name} ${away.length} 人啟程回到集合點${w.names[sq.meet ?? G.base] || ''}（約 ${Math.round(hrs)} 小時），尾款等結案再分。`); }
  }
  // 結案：活著的人走回總部（合約到期時已經啟程的就不再重複）
  for (const id of G.cases) {
    // 歸建要每家公司各記一次（案件是大家共用的；原本整個案件記一個旗子，先處理的公司把旗子立起來，其他公司的人就永遠回不來——NPC 上線後抓到）
    const c = book.cases.find(x => x.id === id); if (!c || !c.settled || c.backHome === true || c.backHome?.[G.name]) continue; (c.backHome ||= {})[G.name] = true;
    if (c.own) {
      const got = Math.round(c.qty * (c.delivered ?? 1)), there = parked(G) && G.base === c.to;
      if (there) G.mats[c.mat] += got; else { const D = (G.depot ||= {})[c.to] ||= {}; D[c.mat] = (D[c.mat] || 0) + got; }   // 基地不在：貨先寄放在那座城，基地停過去才收
      // 護衛跟著車隊到了目的地：基地在就上車，不在就在那裡等（集合點的規則）
      for (const sid of c.squads) { const sq = book.squads[sid]; if (!sq) continue; for (const x of sq.clones) if (x.alive && x.status === 'away' && onCase(x, c.id)) { x.status = 'returning'; G.returning.push({uid: x.uid, at: h, to: c.to, van: sq.van ? sq.id : null}); } }
      note(G, h, `採購車隊到了${w.names[c.to] || ''}：${MN[c.mat]} ${got}／${c.qty}${got < c.qty ? `（路上被劫走 ${c.qty - got}）` : ''}${there ? '' : '。基地不在那裡，貨先寄放在城裡'}。`); continue;
    }
    for (const sid of c.squads) { const sq = book.squads[sid]; if (!sq || sq.player !== G.name || sq.garrison != null || sq.guard) continue; unpack(G, sq, h); if (sq.headedHome != null) continue;
      const away = sq.clones.filter(x => x.alive && x.status === 'away' && onCase(x, c.id)); if (!away.length) continue;
      sendHome(G, w, away, c.tile, h, book, `${c.title}（${sq.name}）`, sq.meet ?? G.base, sq.van ? sq.id : null, c.id); }
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
  // 回程（2026-10-12）：到了集合點基地在（旁邊一格以內）就上車；在路上經過基地停的格子也上車；基地不在就等 VAN.WAIT_H 小時，等不到就倒在那裡
  for (const r of G.returning.slice()) {
    const c = G.roster.find(x => x.uid === r.uid); if (!c || !c.alive || c.status !== 'returning') { G.returning.splice(G.returning.indexOf(r), 1); continue; }
    const dest = r.to ?? G.base;
    if (h < r.at) { const P = r.move?.path, i = P ? P.indexOf(G.base) : -1; if (i >= 0 && i < P.length - 1 && (h - r.move.t0) / Math.max(.01, r.move.t1 - r.move.t0) * (P.length - 1) >= i - 1e-6) { boardHq(G, c, r); note(G, h, `${label(c)} 在路上碰到基地，上車了。`); } continue; }
    if (hdist(G.base, dest) <= 1) { boardHq(G, c, r); continue; }
    if (r.wait == null) { r.wait = h + VAN.WAIT_H; note(G, h, `${label(c)} 到了集合點${w.names[dest] || '荒野'}，基地不在，帶的補給撐得了 ${VAN.WAIT_H} 小時——把基地開過去接。`); continue; }
    if (h >= r.wait) { G.returning.splice(G.returning.indexOf(r), 1);
      // 狀態當場就設成「遺體沒收回」（不等下一個小時的陣亡處理）：同一個小時的 bodiesHour 看到狀態不是 lost 會把遺體當成已確認戰死刪掉
      c.alive = false; c.downAs = 'lost'; c.status = 'lost'; c.diedH = h; c.downAt = h; c.downTile = dest; C.rec(c, {h, t: 'down', co: G.name, title: '在集合點等不到基地', tile: dest, recovered: false});
      note(G, h, `${label(c)} 在${w.names[dest] || '荒野'}等不到基地，倒下了。7 天內有人在那一帶打贏或把基地開過去搜索，還有機會撿回來。`);
      C.pay(book, h, G.name, -C.CFG.CLONE_VALUE, 'loss', `${label(c)} 在${w.names[dest] || '荒野'}等不到基地，倒下了`);
      (book.bodies ||= []).push({uid: c.uid, co: G.name, tile: dest, at: h, value: C.CFG.CLONE_VALUE, caseId: null}); }
  }
  // 寄放的貨：基地停到那座城就收
  if (G.depot?.[G.base] && parked(G)) { const D = G.depot[G.base]; for (const [m, n] of Object.entries(D)) G.mats[m] = (G.mats[m] || 0) + n; delete G.depot[G.base]; note(G, h, `收下寄放在${w.names[G.base] || ''}的貨：${Object.entries(D).map(([m, n]) => `${MN[m]} ${n}`).join('、')}。`); }
  // 補員縱隊全滅、或到的時候案件已結算：人留在現場（駐紮），MVP 先直接讓他們走回來
  // 也包括「還在已結案的舊小隊名單裡」的人（共用案件的歸建問題留下的，見上面）：只算還在案子裡的小隊、還在路上的補員縱隊
  for (const c of G.roster) if (c.alive && c.status === 'away' && !Object.values(book.squads).some(sq => sq.clones.includes(c) && (sq.caseId || sq.column || sq.garrison != null))) { c.status = 'returning'; G.returning.push({uid: c.uid, at: h + 12, to: G.base}); }
}

// ===== 清運案（Alan 2026-10-09 方向、2026-10-10 做）=====
// 不用派人：雇一隊清運車去收生物廢棄物，花車資和時間，回收植入物、神經介質；那一帶（同一格、隔壁）還沒壞的遺體一起撿回來（自己的沖回損失，別家的就易主）。
// 總部那座城每天一趟免費的小清運，保底收得到一個人的素材（玩得再爛，每天也補得出一個人）。
export const CLEAN = {RANGE: 10, MIN_WASTE: 4, FARE: 4, FARE_PER: 1.5, H0: 6, H_PER: .5, H_MAX: 12, YIELD: .8, CAP: 120, DAILY: {food: 30, water: 30, implant: 30, neural: 30}};
const cleanHours = d => Math.min(CLEAN.H_MAX, CLEAN.H0 + d * CLEAN.H_PER), cleanFare = d => Math.round(CLEAN.FARE + d * CLEAN.FARE_PER);
export function cleanSites(G, book, w) {
  const nm = t => w.names[t] || '無名之地', W = book.waste || {}, busy = new Set((G.cleanJobs || []).map(j => j.tile)), out = [];
  const dailyOk = inTown(G, w) && !busy.has(G.base) && G.h - (G.cleanDaily ?? -999) >= 24;   // 每日免費清運：基地停在城裡才有
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
  let bodies = 0; for (const b of book.bodies || []) if (!b.takenBy && h < b.at + C.CFG.BODY_H && (hdist(b.tile, j.tile) <= 1 || j.daily && G.relief?.on && b.co === G.name && hdist(b.tile, j.tile) <= RELIEF.NEAR)) { b.takenBy = G.name; b.takenAt = h; bodies++; }   // 最低編制：每日清運順便撿回總部附近的自己人
  note(G, h, `清運車從${nm(j.tile)}回來了：${Object.entries(got).filter(([, n]) => n).map(([m, n]) => `${MN[m]} ${n}`).join('、') || '沒撈到什麼'}${bodies ? `，還撿到 ${bodies} 具遺體` : ''}。`);
}

// ===== 長期護衛合約與駐紮（Alan 2026-10-10，warband/DESIGN.md「長期合約 v2」）=====
// 產地（石油城、彈藥農場、綠洲）每季在委託板開一份長期護衛約，期限 4 季、4 個名額；只找世界名氣排行前 4 名（至少有過一張成功的單子）的公司（Alan 2026-10-10），規模太小、跟產地的勢力在打仗、被那個勢力拉黑的公司看不到。
// 錢：簽約金一次給，或分四季給（總額多兩成）；有些要先付履約保證金（期滿沒違約就退）；一整季沒丟車隊、沒違約，季末有獎金。
// 義務：產地每 2～4 天發一趟車隊，輪流指派給一家簽約公司；5 小時內要決定派誰，時限到了還沒派，就從駐在那個產地的小隊隨機拉一隊；連駐軍都沒有就是違約。
// 違約：第一次賠簽約金的四分之一、保證金沒收；第二次再賠一半、合約作廢、那個勢力一年（4 季）不跟你往來。
export const RET = {SLOTS: 4, SEASONS: 4, WINDOW: 5, GAP0: 48, GAP1: 96, TOP_N: 4, SIZE_MIN: 8, GAR_UPKEEP: 1.5, BAN_SEASONS: 4, INSTALL: .3, BONUS: .15};
const SITE_N = {oil: '石油城', ammo: '彈藥農場', oasis: '綠洲', salvage: '拆解場'}, SITE_G = {oil: 'fuel', ammo: 'ammo', oasis: 'water', salvage: 'parts'}, GOOD_N = {fuel: '燃料', ammo: '彈藥', water: '淨水', parts: '零件'};   // 拆解場（2026-10-11 新世界加的產地）
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
// 駐軍護送完回到駐地（Alan 2026-10-11）：當場跟那張護送單脫鉤（維持費先結、服役紀錄記結束），尾款照積分等結案再分。
// 原本要等案件結算（收尾後還有一天緩衝）才脫鉤，這段時間駐軍算「在案子裡」，下一趟應召拉不到人，被判違約
export function garBack(G, book, sq, c, h) {
  if (sq.due > 0) C.pay(book, h, sq.player, -sq.due, 'upkeep', `${c.title}：維持費（${sq.name}，回到駐地時結帳）`, c.id); sq.due = 0;
  for (const x of sq.clones) { const e = C.caseRec(x, c.id); if (e && e.end == null) e.end = h; }
  c.squads = c.squads.filter(id => id !== sq.id); sq.caseId = null; sq.busy = null; delete sq.headedHome;
  for (const x of sq.clones) if (x.alive) C.rec(x, {h, t: 'garrison', co: G.name, tile: sq.garrison});   // 服役紀錄：回到駐地（讀檔的修復照最後一筆差事判斷人在哪）
}
const garSquads = (G, book, site) => Object.values(book.squads).filter(sq => sq.player === G.name && sq.garrison === site);
const garFree = (sq, now) => !sq.caseId && sq.readyAt <= now && sq.clones.filter(c => c.alive).length >= 2 && sq.clones.filter(c => c.alive).every(c => c.status === 'away');
function canSign(G, book, w, c, now) {
  const K = w.sim.peek(), P = w.sim.pmc, me = homeFac(G, K);
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
  let pick = uids.map(u => G.roster.find(x => x.uid === u)).filter(x => x && x.alive && x.status === 'home' && !x.keep);
  if (pick.length < 2) return '至少兩個人';
  // 駐軍的運兵車就停在駐地（Alan 2026-10-12）：一隊佔一台；基地就停在產地旁邊的話直接派、不用車
  const here = onSite(G, site); if (!here) { if (vansFree(G, book) < 1) return NO_VAN; pick = pick.slice(0, C.CFG.VAN_SIZE); }
  let n = 0;
  for (let i = 0; i < pick.length; i += 4) { const g = pick.slice(i, i + 4); if (g.length < 2) break;
    const sq = C.makeSquad(book, G.name, {clones: g, gear: 3, at: site, name: `${G.name}・${w.names[site] || ''}駐軍`}); sq.garrison = site; sq.van = !here;
    const t = C.travelHours(w, G.base, site), eta = now + (isFinite(t) ? t : 24); sq.readyAt = eta; sq.move = {path: w.sim.pmc.route(G.base, site), t0: now, t1: eta}; if (sq.van) C.payFare(book, w, G.name, G.base, site, g.length, now, `${sq.name}去程`);
    for (const x of g) { x.status = 'away'; C.rec(x, {h: now, t: 'garrison', co: G.name, tile: site}); } n++; }
  note(G, now, `派 ${n} 隊去${w.names[site] || ''}駐紮，約 ${Math.round(C.travelHours(w, G.base, site))} 小時後到位。`);
  return null;
}
export function ungarrison(G, book, w, squadId, now) {
  const sq = book.squads[squadId]; if (!sq || sq.player !== G.name || sq.garrison == null) return '找不到這支駐軍';
  if (sq.caseId) return '這支駐軍正在護送車隊';
  const hrs = sendHome(G, w, sq.clones, sq.garrison, now, book, sq.name, G.base, sq.van ? sq.id : null); unpack(G, sq, now); delete book.squads[squadId];   // 集合點：撤回這一刻基地的位置
  note(G, now, `撤回${sq.name}，約 ${C.fmtDur(hrs)}後到${w.names[G.base] || ''}（基地現在的位置）。`);
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
    if (pick.length < 2) return '至少兩個人'; const here = onSite(G, c.site); if (!here && vansFree(G, book) < 1) return NO_VAN;
    sq = C.makeSquad(book, G.name, {clones: pick, gear: 3, at: G.base, name: `${G.name}・第${G.seq++}隊`}); sq.van = !here; sq.meet = G.base; }
  const lead = C.travelHours(w, sq.at, c.site), hours = Math.round((isFinite(lead) ? lead : 24) + C.travelHours(w, c.site, q.to) * 2 + 48);
  const cs = C.openCase(book, w, {kind: 'route', title: `護送${nm(c.site)}${SITE_N[c.kind]}的${GOOD_N[q.g]}車隊往${nm(q.to)}（長約）`, tile: c.site, from: c.site, to: q.to, fac: c.fac, lv, hours, cargo: {g: q.g, amt: q.amt, src: c.site}}, now);
  cs.pay.final = Math.round(cs.pay.final * .5); cs.contract = c.id;   // 長約的車馬費比較少（簽約金已經付過）
  delete sq.headedHome;
  if (!C.enlist(book, cs.id, sq.id, now, w)) { book.cases.splice(book.cases.indexOf(cs), 1); if (!sq.garrison) delete book.squads[sq.id]; return '趕不上'; }
  for (const x of sq.clones) if (x.alive) { if (x.status === 'home') { x.status = 'away'; } x.missions++; C.joinRec(x, cs, G.name, now); }
  G.cases.push(cs.id); q.state = 'answered'; q.case = cs.id; q.auto = !!how.auto; c.runs = (c.runs || 0) + 1;   // 跑了幾趟：同一條路跑越多趟越容易被針對（cases.js drawType）
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
    s.void = true; s.voidAt = h; (G.bans ||= {})[c.fac] = h + SH * RET.BAN_SEASONS;
    note(G, h, `再次違約：${nm}的長約作廢，賠 $${pen}k；${w.sim.peek().fac[c.fac]?.n || '那個勢力'}一年內不跟你往來。`);
  }
}
// 後台修復（Alan 2026-10-11：程式的錯誤害的違約，讓公司可以重新簽）：拿掉這家公司在這份長約的簽約紀錄、那個勢力的往來禁令、
// 這個產地的違約名氣扣分；簽約期限過了就延長三天。賠掉的錢不退
export function resetSigner(cos, book, w, id, co, h) {
  const c = (book.contracts || []).find(x => x.id === id), G = cos[co]; if (!c || !G) return '找不到這份合約或公司';
  const s = c.signers.find(x => x.co === co); if (!s) return '這家公司沒有簽這份合約';
  c.signers.splice(c.signers.indexOf(s), 1);
  for (const sq of Object.values(book.squads)) if (sq.player === co && sq.garrison === c.site && !sq.caseId) { for (const x of sq.clones) if (x.alive) x.status = 'home'; delete book.squads[sq.id]; }
  if (G.bans) delete G.bans[c.fac];
  const nm = `違約：${w.names[c.site] || ''}${SITE_N[c.kind]}`, n0 = G.fameLog?.length || 0; if (G.fameLog) G.fameLog = G.fameLog.filter(e => !e.title.startsWith(nm));
  G.breaches = Math.max(0, (G.breaches || 0) - (n0 - (G.fameLog?.length || 0)));
  c.signUntil = Math.max(c.signUntil, h + 72);
  note(G, h, `後台修復：${w.names[c.site] || ''}${SITE_N[c.kind]}的長約紀錄拿掉了，可以重新簽約（三天內）。`);
  return null;
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
// 收起一份已結束的長約（只是不顯示成卡片，紀錄還在）
export function retHide(G, book, id) {
  const c = (book.contracts || []).find(x => x.id === id), s = c?.signers.find(x => x.co === G.name); if (!s) return '找不到這份長約';
  if (!c.done && !s.void) return '還在進行中的長約不能收起';
  (G.retHide ||= []).includes(id) || G.retHide.push(id); return null;
}
// 給畫面：看得到的長約、自己簽的、應召、駐軍
export function retainerView(G, book, w) {
  const K = w.sim.peek(), nm = t => w.names[t] || '無名之地', now = G.h, L = book.contracts || [];
  const offers = L.filter(c => !canSign(G, book, w, c, now)).map(c => ({id: c.id, site: c.site, name: nm(c.site), kind: c.kind, kn: SITE_N[c.kind], fac: K.fac[c.fac]?.n || '', fee: c.fee, plan: c.plan, bond: c.bond, bonus: c.bonus,
    total: c.plan === 'lump' ? c.fee : Math.round(c.fee * RET.INSTALL * RET.SEASONS), seasons: RET.SEASONS, left: c.slots - c.signers.length, until: c.signUntil}));
  // 已結束的長約（Alan 2026-10-11）：作廢、期滿的照樣列出（紀錄不刪）；結束 3 天後或按了「收起」就收進「已結束的長約」
  const endOf = (c, s) => s.void ? s.voidAt ?? Math.max(0, ...c.calls.filter(q => q.co === G.name && q.state === 'missed').map(q => q.deadline)) : c.done ? c.end : null;
  const mine = L.filter(c => c.signers.some(s => s.co === G.name)).map(c => { const s = c.signers.find(x => x.co === G.name), endedAt = endOf(c, s);
    return {id: c.id, site: c.site, name: nm(c.site), kn: SITE_N[c.kind], end: c.end, done: !!c.done, void: !!s.void, endedAt, hidden: endedAt != null && (now - endedAt >= 72 || (G.retHide || []).includes(c.id)), breaches: s.breaches, plan: c.plan, paid: s.paid, bond: s.bond, bondLost: !!s.bondLost,
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
    to.roster.push(c); reidItems(to, book); note(to, h, `在${w.names[b.tile] || '無名之地'}一帶撿到一具遺體：${who}（原本是別家的人）。可以到培養槽重新培養。`);
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
  if (F.keeper || F.ration || K.ration) return F.keeper ? '守密者不能拿去合成' : '配給型不能合成';
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
  if (c.ration) return '配給型的遺體不能賣';
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
// 回程：開回集合點 meet（出發時基地的位置；駐軍撤回是撤回那一刻的）。van：坐的是哪台運兵車（小隊 id；從現場的基地走過去的沒有車、不收油錢）
function sendHome(G, w, clones, from, h, book = null, what = '召回', meet = G.base, van = null, caseId) {
  const back = C.travelHours(w, from, meet), t1 = h + (isFinite(back) ? back : 24), path = w.sim.pmc.route(from, meet);
  const n = clones.filter(x => x.alive).length; if (book && van && n) C.payFare(book, w, G.name, from, meet, n, h, `${what}回程`, caseId);
  for (const x of clones) if (x.alive) { x.status = 'returning'; G.returning.push({uid: x.uid, at: t1, move: {path, t0: h, t1}, to: meet, van}); }
  return t1 - h;
}
// 這個人現在的差事是不是這個案件（最後一筆差事紀錄）：小隊名單留著已經去做別的事的人（例如回程後上了 Rover），結案、召回都只動還在這個案件上的人
const onCase = (x, id) => { const e = (x.record || []).findLast(e => e.t === 'case' || e.t === 'garrison'); return !e || (e.t === 'case' && e.case === id); };
export function recall(G, book, w, squadId, now) {
  const sq = book.squads[squadId]; if (!sq || sq.player !== G.name) return '找不到這一隊';
  // 已經在回程的小隊（收尾就啟程）不能再召回：原本照樣扣違約金，還把隊上已經去做別的事的人拉回總部（soak 測試 2026-10-12 找到）
  if (sq.headedHome != null) return '這一隊已經在回程了';
  const caseId = sq.caseId, r = C.withdraw(book, w, squadId, now); if (!r.ok) return r.why;
  for (const x of sq.clones) { const e = C.caseRec(x, caseId); if (e && e.end == null) { e.end = now; e.recalled = true; } }
  const hrs = sendHome(G, w, sq.clones.filter(x => onCase(x, caseId)), r.here, now, book, sq.name, sq.meet ?? G.base, sq.van ? sq.id : null, caseId); unpack(G, sq, now);
  for (const col of r.cols) sendHome(G, w, col.clones, col.here, now, book, `${sq.name} 的補員`, sq.meet ?? G.base, col.van ? 'col:' + sq.id : null);
  note(G, now, `召回${sq.name}${r.penalty ? `，付違約金 $${r.penalty}k` : ''}，約 ${C.fmtDur(hrs)}後到集合點${w.names[sq.meet ?? G.base] || ''}。`);
  return null;
}
export function recallColumn(G, book, w, amendId, now) {
  const r = C.cancelAmend(book, amendId, now); if (!r) return '補員正在路上交戰，打完才能撤回';
  const hrs = sendHome(G, w, r.clones, r.here, now, book, '補員', G.base, r.van ? 'col:' + amendId : null);
  note(G, now, `撤回補員，${r.clones.length} 人約 ${C.fmtDur(hrs)}後回到基地。`);
  return null;
}

// 給畫面用的樣子
export function view(G, book, w) {
  for (const c of G.roster) if (c.alive && !c.gear) { gearOf(G, c); c.weapon = gearLabel(c.gear); }   // 舊存檔的人補上裝備
  const nm = t => w.names[t] || '無名之地';
  const sqOf = {}; for (const sq of Object.values(book.squads)) if (sq.player === G.name) for (const c of sq.clones) if (!sqOf[c.uid] || sq.caseId || sq.garrison != null || sq.column) sqOf[c.uid] = sq;
  // 整補（Alan 2026-10-11）：出勤中的小隊的行李、能不能整補
  const packs = {}; for (const sq of Object.values(book.squads)) if (sq.player === G.name && (sq.caseId || sq.garrison != null) && sq.clones.some(c => c.alive && c.status === 'away'))
    packs[sq.id] = {name: sq.name, lock: book.tickets.some(t => t.squad === sq.id && !t.done && t.fightAt != null), uids: sq.clones.filter(c => c.alive && c.status === 'away').map(c => c.uid), items: (sq.pack || []).map(it => ({...it, name: itemName(it)}))};
  // 結案的案件留三天給玩家看結果；採購車隊回到總部就拿掉（Alan 2026-10-10：車隊都回家了還留在任務管制）
  const cases = G.cases.map(id => book.cases.find(x => x.id === id)).filter(Boolean).filter(c => !c.settled || (!c.own && G.h - c.settledAt < 72)).map(c => ({
    id: c.id, own: !!c.own, title: c.title, kind: c.kind, tile: c.tile, lv: c.lv, alert: c.kind === 'shadow' && c.side === 'att' ? c.alert || 0 : null, start: c.start, end: c.end, open: c.open, settled: c.settled, score: Math.round(c.score[G.name] || 0),
    ...(() => { const L = book.ledger.filter(x => x.caseId === c.id && x.player === G.name && x.kind !== 'loss'); return {got: L.filter(x => x.amount > 0).reduce((t, x) => t + x.amount, 0), spent: -L.filter(x => x.amount < 0).reduce((t, x) => t + x.amount, 0)}; })(),   // 這個案件已經入帳的收入、已經付出去的錢（報表的會計帳用）
    scoreTot: Object.values(c.score || {}).reduce((t, v) => t + v, 0),
    freeze: c.freeze ?? C.CFG.FREEZE, buffer: c.own || C.SOLO.has(c.kind) ? 0 : C.CFG.BUFFER,   // 截止前幾小時不再出單、結束後緩衝幾小時才結算（練兵、狩獵、維安都是 0）
    payout: c.payout?.[G.name], midPaid: c.midPaid, due: c.squads.map(id => book.squads[id]).filter(sq => sq && sq.player === G.name).reduce((s, sq) => s + (sq.due || 0), 0), quit: !!c.quit?.[G.name], delivered: c.delivered, convoys: c.convoys, lost: c.lostConvoys.length, pay: c.pay, tickets: c.tickets,
    squads: c.squads.map(id => book.squads[id]).filter(sq => sq && sq.player === G.name).map(sq => ({id: sq.id, name: sq.name, readyAt: sq.readyAt, busy: sq.busy, headedHome: sq.headedHome,
      backAt: Math.max(-1, ...G.returning.filter(r => sq.clones.some(x => x.uid === r.uid)).map(r => r.at)),   // 收尾後啟程返回：最後一個人到總部的時刻 refused: !!sq.refused, fast: !!sq.fast,
      clones: sq.clones.map(x => x.uid), pending: book.amends.filter(a => a.squad === sq.id && !a.done).map(a => ({id: a.id, n: a.n, eta: a.eta}))}))}));
  const units = unitsView(G, book, G.h);
  const tickets = book.tickets.filter(t => t.player === G.name && !t.done).map(t => ({id: t.id, title: t.title, type: t.type, transit: !!t.transit, fleeTried: !!t.fleeTried, enc: C.isEncounter(book, t), deadline: t.deadline, issued: t.issued, tile: t.tile,
    biome: t.biome, night: t.night, trench: t.trench, intro: t.intro || null, enemy: {name: t.enemy.name, power: t.enemy.power, side: t.enemy.side, units: t.enemy.units, boss: t.enemy.boss, veh: t.enemy.veh},
    objectives: t.objectives, squad: book.squads[t.squad]?.name, est: book.squads[t.squad] ? C.estimate(book.squads[t.squad], t.enemy) : null, caseTitle: book.cases.find(c => c.id === t.caseId)?.title}));
  const done = book.tickets.filter(t => t.player === G.name && t.done).slice(-12).reverse().map(t => ({id: t.id, title: t.title, win: t.win, auto: t.auto, pts: t.pts, dead: (t.dead || []).length, at: t.doneAt}));
  // 報表
  const hist = [...(G.caseArch || []), ...G.cases.map(id => book.cases.find(x => x.id === id)).filter(c => c && c.settled).map(c => caseSummary(G, book, c))].reverse();   // 封存的（修剪掉的舊案件）在前
  const sum = (since, base = {}) => { const o = {...base}; for (const f of G.flows) if (f.h >= since) o[f.kind] = (o[f.kind] || 0) + f.amount; return o; };
  const report = {all: sum(0, G.flowsArch), d30: sum(G.h - 24 * 30), daily: G.daily, hist};
  const K = w.sim.peek(), rel = K.fac.map((f, i) => ({f: i, n: f.n, c: f.c, alive: f.alive !== false, v: Math.round(relOf(G, i)), trait: w.sim.pmc.trait ? w.sim.pmc.trait(i) : ''})).filter(x => x.alive);
  const payable = Object.values(book.squads).filter(sq => sq.player === G.name && sq.caseId).reduce((s, sq) => s + (sq.due || 0), 0);
  return {payable, rel, relLog: (G.relLog || []).slice(-40).reverse().map(e => ({...e, n: K.fac[e.f]?.n || ''})), relRefuse: REL.REFUSE, relBlack: REL.BLACK, deaths7: deaths7(book, G.h), retainer: retainerView(G, book, w), cleanSites: cleanSites(G, book, w), cleanJobs: (G.cleanJobs || []).map(j => ({...j, name: nm(j.tile)})), units, report, name: G.name, base: G.base, baseName: nm(G.base), h: G.h, cash: Math.round(G.cash), lossBook: Math.round(G.lossBook || 0), mats: G.mats, stock: stockHere(G, w), prices: prices(G, w), queue: G.queue.map((q, i) => ({done: q.done, start: q.start, slot: q.slot ?? i, recipe: q.recipe, tpl: q.tpl ? q.tpl.cls : null, revive: q.revive != null ? (c => c ? `${donorName(c)} ${c.id}` : '') (G.roster.find(x => x.uid === q.revive)) : null, ready: !!q.ready})),
    templates: G.templates, relief: G.relief?.on ? {since: G.relief.since, next: G.relief.next} : null, packs, reports: (G.reports || []).slice(-30), roster: G.roster.map(c => ({...c, name: donorName(c), squad: sqOf[c.uid]?.name || '', field: c.alive && c.status === 'away' && packs[sqOf[c.uid]?.id] ? sqOf[c.uid].id : null, record: (c.record || []).slice(-60).map(e => ({...e, place: e.tile != null ? nm(e.tile) : ''})), downPlace: c.downTile != null ? nm(c.downTile) : '', reviving: G.queue.some(q => q.revive === c.uid), bodyPrice: c.status === 'recovered' ? bodyPrice(book, c, G.h) : null})), cases, tickets, done, log: G.log.slice(-40).reverse(), vats: GCFG.VATS, buildH: GCFG.BUILD_H, fresh: G.fresh ?? null, sellFactor: sellFactor(G, w), store: (G.store || []).map(it => ({...it, name: itemName(it), value: Math.round(itemValue(it) * sellFactor(G, w))}))};
}

// 地圖上要標的：每一支派出去的人馬現在在哪、往哪走
function rest(move, h) { if (!move || !move.path?.length) return []; const f = Math.max(0, Math.min(1, (h - move.t0) / Math.max(1, move.t1 - move.t0))); return move.path.slice(Math.floor(f * (move.path.length - 1))); }
function unitsView(G, book, h) {
  const out = [];
  for (const sq of Object.values(book.squads)) {
    if (sq.player !== G.name || sq.guard) continue;   // 基地守衛就在基地上
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
  for (const r of G.returning) { const wait = r.wait != null || h >= r.at; if (!r.move && !wait) continue; const k = wait ? 'W' + (r.to ?? G.base) : r.move.t0 + ':' + r.move.path[0]; (grp[k] = grp[k] || {r, n: 0, wait}).n++; }
  for (const k in grp) { const g = grp[k], r = g.r, to = r.to ?? G.base;
    if (g.wait) out.push({key: 'R' + k, kind: 'waiting', name: '在集合點等基地', n: g.n, pos: {a: to, b: to, f: 0}, path: [], status: r.wait != null ? `補給還撐 ${C.fmtDur(Math.max(0, r.wait - h))}` : '剛到集合點', where: '', to});
    else out.push({key: 'R' + k, kind: 'returning', name: '歸途', n: g.n, pos: C.posOn(r.move.path, (h - r.move.t0) / Math.max(1, r.move.t1 - r.move.t0)), path: rest(r.move, h), status: `開回集合點，約 ${C.fmtDur(r.move.t1 - h)}後到`, where: '', to}); }
  return out;
}

// 清掉用完的小隊（Alan 2026-10-12：沒有資料相依就刪）：帳本裡的小隊是出勤時的編組，人回到總部、案件結案之後就只剩名單，
// 一直留著會佔掉存檔一半。還有人引用的都留著：沒結案（或結案不到三天、畫面還在顯示）的案件、沒打完的服務單、還在路上的補員、
// 行軍中的事件、駐軍、Rover；隊上還有出勤中的人、而且不在別的小隊裡的也留著。每天一次（core.js）
// 舊紀錄修剪（Alan 2026-10-15：玩家一多存檔會一直長，每次存檔都要整包重寫）：每天一次（core.js 跟清小隊一起），在核心裡做，重播照樣一致。
// 完整的紀錄留 PRUNE.H 小時；更舊的：結案的案件變成公司身上的摘要（G.caseArch，報表的案件歷史照樣看得到）、帳本照公司和種類累計（book.ledgerArch，查帳的總數不變）、
// 公司收支照種類累計（G.flowsArch，報表「全部」不變）；服務單每家留最近 PRUNE.DONE 場、通知每家留 PRUNE.INBOX 則、每個人的服役紀錄留 PRUNE.RECORD 筆
export const PRUNE = {H: 24 * 30, FLOW_H: 24 * 31, DONE: 12, INBOX: 50, RECORD: 120, ARCH: 300};
export function caseSummary(G, book, c) {   // 報表案件歷史的一行（view 和封存共用）
  const T = book.tickets.filter(t => t.caseId === c.id && t.player === G.name && t.done);
  const L = book.ledger.filter(x => x.caseId === c.id && x.player === G.name);
  return {title: c.title, own: !!c.own, kind: c.kind, at: c.settledAt, tickets: T.length, wins: T.filter(t => t.win).length, auto: T.filter(t => t.auto).length, dead: T.reduce((x, t) => x + (t.dead?.length || 0), 0),
    income: L.filter(x => ['deposit', 'mid', 'final'].includes(x.kind)).reduce((a, x) => a + x.amount, 0), upkeep: L.filter(x => x.kind === 'upkeep').reduce((a, x) => a + x.amount, 0), delivered: c.delivered};
}
export function pruneHistory(cos, book, h) {
  const cut = h - PRUNE.H, out = {cases: 0, tickets: 0, ledger: 0, inbox: 0, flows: 0, records: 0, squads: 0};
  const all = Object.values(cos);
  // 小隊能不能丟：沒有還在外面、而且不在別隊名單上的活人；駐軍、Rover 的護衛不丟
  const inSquads = new Map(); for (const sq of Object.values(book.squads)) for (const x of sq.clones) inSquads.set(x, (inSquads.get(x) || 0) + 1);
  const disposable = sq => !sq || (sq.garrison == null && !sq.guard && !sq.clones.some(x => x.alive && (x.status === 'away' || x.status === 'returning') && inSquads.get(x) === 1));
  // 1. 結案很久的案件 → 公司身上的摘要
  const old = book.cases.filter(c => c.settled && (c.settledAt ?? h) < cut && !book.tickets.some(t => t.caseId === c.id && !t.done) && c.squads.every(id => disposable(book.squads[id])));
  if (old.length) {
    const ids = new Set(old.map(c => c.id));
    for (const G of all) {
      const mine = old.filter(c => (G.cases || []).includes(c.id)); if (!mine.length) continue;
      G.caseArch = [...(G.caseArch || []), ...mine.sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0)).map(c => caseSummary(G, book, c))].slice(-PRUNE.ARCH);
      G.cases = G.cases.filter(id => !ids.has(id));
    }
    for (const c of old) for (const id of c.squads) if (book.squads[id]) { delete book.squads[id]; out.squads++; }
    book.cases = book.cases.filter(c => !ids.has(c.id)); out.cases = old.length;
  }
  const live = new Set(book.cases.map(c => c.id));
  // 2. 已完成的服務單：不屬於現存的案件、超過保留期的拿掉；每家公司留最近 PRUNE.DONE 場（「最近戰鬥」）
  const keepDone = new Set(); const byP = {};
  for (const t of book.tickets) if (t.done && t.player) (byP[t.player] ||= []).push(t);
  for (const L of Object.values(byP)) for (const t of L.slice(-PRUNE.DONE)) keepDone.add(t);
  const n0 = book.tickets.length;
  book.tickets = book.tickets.filter(t => !t.done || keepDone.has(t) || (t.caseId && live.has(t.caseId)) || (t.doneAt ?? h) >= cut);
  out.tickets = n0 - book.tickets.length;
  // 3. 帳本：每家公司都已經入帳（ledgerAt 之前）、超過保留期、不屬於現存案件的 → 照公司和種類累計
  const m = Math.min(...all.map(G => G.ledgerAt ?? 0), book.ledger.length); let drop = 0;
  const A = book.ledgerArch ||= {}, kept = [];
  for (let i = 0; i < book.ledger.length; i++) {
    const x = book.ledger[i];
    if (i < m && x.t < cut && !(x.caseId && live.has(x.caseId))) { const a = A[x.player] ||= {}; a[x.kind] = (a[x.kind] || 0) + x.amount; drop++; continue; }
    kept.push(x);
  }
  if (drop) { book.ledger = kept; for (const G of all) G.ledgerAt = Math.max(0, (G.ledgerAt ?? 0) - drop); out.ledger = drop; }   // 拿掉的都在每家的游標之前
  // 4. 通知：每家公司留最近 PRUNE.INBOX 則（畫面只顯示 30 則）
  const cnt = {}; for (const x of book.inbox) cnt[x.player] = (cnt[x.player] || 0) + 1;
  if (Object.values(cnt).some(n => n > PRUNE.INBOX)) { const seen = {}; const n1 = book.inbox.length;
    book.inbox = book.inbox.filter(x => (seen[x.player] = (seen[x.player] || 0) + 1) > cnt[x.player] - PRUNE.INBOX); out.inbox = n1 - book.inbox.length; }
  // 5. 公司收支、服役紀錄
  for (const G of all) {
    const fcut = h - PRUNE.FLOW_H, i = (G.flows || []).findIndex(f => f.h >= fcut), k = i < 0 ? (G.flows || []).length : i;
    if (k > 0) { const F = G.flowsArch ||= {}; for (const f of G.flows.slice(0, k)) F[f.kind] = (F[f.kind] || 0) + f.amount; G.flows = G.flows.slice(k); out.flows += k; }
    for (const c of G.roster) if (c.record?.length > PRUNE.RECORD) { out.records += c.record.length - PRUNE.RECORD; c.record = c.record.slice(-PRUNE.RECORD); }
    // 6. 除名很久的人（戰死、遺體賣掉）：NPC 公司直接移出名冊；玩家公司留一份精簡的（名字、職業、等級、評級、最後幾筆紀錄），拿掉記憶片段、裝備等大資料。還在小隊名單上的不動
    const gone = c => !c.alive && (c.status === 'kia' || c.status === 'sold') && !inSquads.has(c) && (c.diedH ?? c.record?.at(-1)?.h ?? h) < cut;
    if (G.npc) { const n = G.roster.length; G.roster = G.roster.filter(c => !gone(c)); out.dead = (out.dead || 0) + n - G.roster.length; }
    else for (let i = 0; i < G.roster.length; i++) { const c = G.roster[i]; if (!gone(c) || c.slim) continue;
      G.roster[i] = {uid: c.uid, id: c.id, cls: c.cls, portrait: c.portrait, donor: c.donor, outfit: c.outfit, callsign: c.callsign, lv: c.lv, crown: c.crown, pct: c.pct, st: c.st, template: c.template, keeper: c.keeper, ration: c.ration,
        alive: false, status: c.status, diedH: c.diedH ?? c.record?.at(-1)?.h, kills: c.kills, missions: c.missions, cells: c.cells, tal: c.tal, skills: c.skills, weapon: c.weapon, u: c.u, record: (c.record || []).slice(-8), tags: c.tags, slim: true};
      out.slim = (out.slim || 0) + 1; }
  }
  return out;
}
export function pruneSquads(cos, book, h) {
  const keep = new Set();
  for (const c of book.cases) if (!c.settled || h - (c.settledAt ?? h) < 72 || c.squads.some(id => { const p = book.squads[id]?.player; return p && cos[p] && !(c.backHome === true || c.backHome?.[p]); })) for (const id of c.squads) keep.add(id);
  for (const t of book.tickets) if (!t.done && t.squad) keep.add(t.squad);
  for (const a of book.amends || []) if (!a.done) { keep.add(a.squad); keep.add(a.col); }
  for (const tr of book.trips || []) if (!tr.done) keep.add(tr.unit);
  for (const g of Object.values(cos)) if (g.hq?.guard) keep.add(g.hq.guard);
  const drop = Object.values(book.squads).filter(sq => !keep.has(sq.id) && sq.garrison == null && !sq.guard && !sq.caseId);
  if (!drop.length) return 0;
  const dropIds = new Set(drop.map(sq => sq.id)), elsewhere = new Set();
  for (const sq of Object.values(book.squads)) if (!dropIds.has(sq.id)) for (const x of sq.clones) elsewhere.add(x);
  let n = 0;
  for (const sq of drop) {
    if (sq.clones.some(x => x.alive && x.status === 'away' && !elsewhere.has(x))) continue;
    if (sq.pack?.length && cos[sq.player]) unpack(cos[sq.player], sq, h);   // 行李沒收進倉庫的（照理不會有）先收
    delete book.squads[sq.id]; n++;
  }
  return n;
}
