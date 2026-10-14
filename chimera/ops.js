// ===== 行動（Alan 2026-10-13，warband/DESIGN.md「等待太久：隨時有得打的主力模式」）=====
// 跟沙盒無關、隨時能打的副本：一次行動是一張分岔的路線圖，每個點是一場戰鬥（或休整），最後一個是王點。
// - 出發：基地裡挑一到四個人（在家、活著、沒在休息），付這次行動的素材；這些人進入「行動中」（status 'op'），別的事派不到他們。
// - 每一點：選一個接得上的點。戰鬥用自己的編號（OP-…）開，不建小隊、不建服務單；打完由 settle 結算。
//   生命、護甲板帶到下一點；局內的三選一（ASH 原本的強化）每打贏一點，每人多一次，只在這次行動裡有效。
// - 倒下就是真的死（Alan：要真死），但這種行動的遺體全數收回，可以重新培養。全滅、打輸、撤出都算行動失敗，已經拿到的獎勵不收回。
// - 打完（成功或失敗）參加的人要休息 REST_H 小時（疲勞先綁角色，AP 還是角色疲勞待 Alan 決定）。
import * as C from './cases.js';
export const REST_H = 12;
// 試玩路線圖（Alan 2026-10-13：先做骨架，沒有故事）。layer 1～5，next 是接得上的點；type 對上現有的戰鬥類型，rest 是休整；x、y 是在區域地圖上的位置（0～1）
export const OPS = {
  trial: {title: '行動一：鏽牙礦場', tier: 0, foe: '鏽牙的人', text: '礦主「鏽牙」帶著一夥掠奪者佔了北邊的舊礦場。從外圍一路打進去，拿下他的堡壘。', side: 'warlord', cost: {food: 40, water: 40}, cash: 60, nodes: [
    {id: 'a', x: .1, y: .34, layer: 1, type: 'clear', kind: '突破', name: '外圍營地', text: '木柵圍起來的營地，清掉裡面的人。', next: ['c', 'd']},
    {id: 'b', x: .12, y: .72, layer: 1, type: 'pursuit', kind: '潛入', name: '油料庫', text: '油料庫已經點著了，追兵從後面追上來：跑到另一頭的撤離點。', next: ['d', 'e']},
    {id: 'c', x: .32, y: .2, layer: 2, type: 'hold', kind: '守住', name: '斷橋', text: '守住橋頭，撐到援軍被打退。', next: ['f']},
    {id: 'd', x: .33, y: .5, layer: 2, type: 'rest', kind: '休整', name: '廢棄加油站', text: '喘口氣：每人回復一半的生命、補滿護甲板。', next: ['f', 'g']},
    {id: 'e', x: .3, y: .82, layer: 2, type: 'ambush', kind: '車隊', name: '礦車道', text: '搭上運礦車往裡面衝，路上會被追上來。', next: ['g']},
    {id: 'f', x: .54, y: .3, layer: 3, type: 'assault', kind: '突破', name: '礦場大門', text: '正面打下大門的陣地。', next: ['h', 'i']},
    {id: 'g', x: .55, y: .7, layer: 3, type: 'facility', kind: '室內', name: '礦坑', text: '從坑道繞進去，裡面又窄又暗。', next: ['h', 'i']},
    {id: 'h', x: .75, y: .22, layer: 4, type: 'rest', kind: '休整', name: '工寮', text: '最後一次休整：每人回復一半的生命、補滿護甲板。', next: ['j']},
    {id: 'i', x: .77, y: .6, layer: 4, type: 'probe', kind: '精英', name: '親衛巡邏隊', text: '鏽牙的親衛在礦場裡巡邏，人多、裝備好。', next: ['j'], elite: true},
    {id: 'j', x: .92, y: .42, layer: 5, type: 'clear', kind: '王點', name: '鏽牙的堡壘', text: '礦主本人和他最後的手下。', next: [], boss: {ash: 'arsonist', name: '礦主「鏽牙」'}}]},
  // 行動二～四（Alan 2026-10-14：多幾組，前一組打贏了後面的才能打；每組都是樹狀路線、多個點）
  // 王點的頭目照 ASH 的強度分級（Alan 2026-10-14）：前期＝縱火犯、標定官、典獄官；中期＝火線官、焚線官、核心守衛；除名幹員是 ASH 後期才會出現的，留給更後面的行動
  well: {title: '行動二：枯井淨水廠', req: 'trial', tier: 1, foe: '佔廠的傭兵', text: '一夥傭兵佔了枯井的淨水廠，把水賣給出價最高的人。從乾河床摸過去，奪回廠區。', side: 'free', cost: {food: 60, water: 20, implant: 20}, cash: 100, nodes: [
    {id: 'a', x: .08, y: .5, layer: 1, type: 'probe', kind: '遭遇', name: '乾河床', text: '河床上的巡邏隊。', next: ['c', 'd']},
    {id: 'b', x: .12, y: .18, layer: 1, type: 'ambush', kind: '車隊', name: '運水車道', text: '攔下傭兵的運水車隊。', next: ['c']},
    {id: 'c', x: .3, y: .3, layer: 2, type: 'hold', kind: '守住', name: '抽水站', text: '奪下抽水站，守到傭兵退走。', next: ['e', 'f']},
    {id: 'd', x: .3, y: .72, layer: 2, type: 'rest', kind: '休整', name: '廢棄營房', text: '喘口氣：每人回復一半的生命、補滿護甲板。', next: ['f', 'g']},
    {id: 'e', x: .52, y: .16, layer: 3, type: 'trench', kind: '戰壕', name: '外圍壕溝', text: '跳進壕溝一路清過去。', next: ['h']},
    {id: 'f', x: .5, y: .46, layer: 3, type: 'assault', kind: '突破', name: '廠區大門', text: '正面打下大門的陣地。', next: ['h', 'i']},
    {id: 'g', x: .52, y: .8, layer: 3, type: 'pursuit', kind: '潛入', name: '排水渠', text: '從排水渠鑽進去，被發現了就往前跑。', next: ['i']},
    {id: 'h', x: .72, y: .3, layer: 4, type: 'facility', kind: '室內', name: '過濾槽', text: '廠房裡又暗又窄。', next: ['j']},
    {id: 'i', x: .72, y: .66, layer: 4, type: 'rest', kind: '休整', name: '控制室', text: '最後一次休整。', next: ['j']},
    {id: 'j', x: .92, y: .48, layer: 5, type: 'clear', kind: '王點', name: '水塔', text: '傭兵隊長守在水塔下。', next: [], boss: {ash: 'designator', name: '傭兵隊長「渴」'}}]},
  hive: {title: '行動三：鹽沼巢穴', req: 'well', tier: 2, foe: '蟲群', biome: '鹽沼', text: '鹽沼底下的舊設施被蟲群築了巢，附近的聚落一個個空了。一路往下，燒掉巢母。', side: 'hive', cost: {food: 60, water: 60, neural: 20}, cash: 150, nodes: [
    {id: 'a', x: .07, y: .3, layer: 1, type: 'clear', kind: '清剿', name: '空聚落', text: '被蟲群掏空的聚落。', next: ['c', 'd']},
    {id: 'b', x: .1, y: .74, layer: 1, type: 'hold', kind: '守住', name: '鹽田', text: '守住鹽田邊的高地，擋住湧上來的蟲。', next: ['d', 'e']},
    {id: 'c', x: .3, y: .16, layer: 2, type: 'facility', kind: '室內', name: '舊管線', text: '鑽進管線，裡面全是卵。', next: ['f']},
    {id: 'd', x: .32, y: .48, layer: 2, type: 'rest', kind: '休整', name: '鹽工小屋', text: '喘口氣：每人回復一半的生命、補滿護甲板。', next: ['f', 'g']},
    {id: 'e', x: .3, y: .82, layer: 2, type: 'probe', kind: '遭遇', name: '沼澤', text: '泥裡有東西在動。', next: ['g']},
    {id: 'f', x: .54, y: .3, layer: 3, type: 'facility', kind: '室內', name: '巢道', text: '越往下越熱、越黏。', next: ['h', 'i']},
    {id: 'g', x: .54, y: .7, layer: 3, type: 'hold', kind: '守住', name: '升降井', text: '守住升降井，等電梯上來。', next: ['i']},
    {id: 'h', x: .76, y: .2, layer: 4, type: 'probe', kind: '精英', name: '育巢', text: '長大了的那一批。', next: ['j'], elite: true},
    {id: 'i', x: .74, y: .6, layer: 4, type: 'rest', kind: '休整', name: '舊控制台', text: '最後一次休整。', next: ['j']},
    {id: 'j', x: .92, y: .42, layer: 5, type: 'facility', kind: '王點', name: '巢心', text: '巢母本體。', next: [], boss: {ash: 'hive_beast', name: '巢母'}}]},
  yard: {title: '行動四：黑鐵車場', req: 'hive', tier: 3, foe: '工廠群的機械兵', biome: '總督府', text: '工廠群在黑鐵車場囤了一整排戰車和機械兵。在他們開出來之前，把車場打爛。', side: 'works', cost: {food: 80, water: 80, implant: 40, neural: 40}, cash: 220, nodes: [
    {id: 'a', x: .08, y: .22, layer: 1, type: 'probe', kind: '遭遇', name: '外圍哨站', text: '哨站的機械兵。', next: ['c', 'd']},
    {id: 'b', x: .08, y: .64, layer: 1, type: 'ambush', kind: '車隊', name: '補給列車', text: '搭上補給列車混進去。', next: ['d', 'e']},
    {id: 'c', x: .3, y: .12, layer: 2, type: 'trench', kind: '戰壕', name: '防線', text: '一整排壕溝與機槍座。', next: ['f']},
    {id: 'd', x: .3, y: .44, layer: 2, type: 'assault', kind: '突破', name: '鐵絲網', text: '剪開鐵絲網，正面打進去。', next: ['f', 'g']},
    {id: 'e', x: .32, y: .8, layer: 2, type: 'rest', kind: '休整', name: '廢料堆', text: '喘口氣：每人回復一半的生命、補滿護甲板。', next: ['g']},
    {id: 'f', x: .54, y: .26, layer: 3, type: 'hold', kind: '守住', name: '調度場', text: '奪下調度場，擋住反撲。', next: ['h', 'i']},
    {id: 'g', x: .54, y: .64, layer: 3, type: 'facility', kind: '室內', name: '組裝廠', text: '生產線還在動。', next: ['i']},
    {id: 'h', x: .76, y: .2, layer: 4, type: 'probe', kind: '精英', name: '親衛機隊', text: '最新型的機械兵。', next: ['j'], elite: true},
    {id: 'i', x: .74, y: .58, layer: 4, type: 'rest', kind: '休整', name: '油庫', text: '最後一次休整。', next: ['j']},
    {id: 'j', x: .92, y: .42, layer: 5, type: 'clear', kind: '王點', name: '指揮塔', text: '焚線官坐鎮指揮塔。', next: [], boss: {ash: 'burnline', name: '焚線官'}}]},
};
// 局內的三選一（Alan 2026-10-14：在路線圖上選，不在戰鬥開場）：ASH 原本的強化（id 照 ASH，戰場上照 ASH 的規則生效）。
// 一次性的效果（回生命、加護甲板）在選的當下算進帶到下一點的狀態；「每一點多帶」的預備品、廢料是每一場進場時給（打完不會變成倉庫的東西）。
const P = (id, n, text, o = {}) => ({id, n, text, cap: 3, ...o});
export const RUN_PERKS = [
  P('health', '生存本能', '最大生命 +20，立刻回 30。'), P('med', '戰地補給', '這次行動每一點多帶 2 個醫療包、2 顆手榴彈。', {cap: null}), P('blast', '爆破專家', '破片手榴彈與爆炸武器傷害 +12。'),
  P('medic', '急救訓練', '醫療包多回 20；這次行動每一點多帶 1 個醫療包。'), P('hazmat', '密封防護', '環境傷害 −5、中毒每回合 −1；第 3 階免疫。'), P('melee', '格鬥訓練', '近戰命中、近戰迴避 +8。'),
  P('plating', '裝甲回收', '敵人更常掉護甲板；立刻 +10 護甲板。'), P('steady', '沉著', '等待之後下一發的命中加成 +8。'), P('skirmish', '游擊', '你移動之後，敵人打你的移動懲罰再 +6。'),
  P('plate_rack', '加掛板架', '護甲板上限 +10，立刻 +10。'), P('ammo_recovery', '彈藥回收', '敵人掉彈藥的機率 +15%。'), P('scavenger', '資源回收', '這次行動每一點多 15 廢料。', {cls: 'engineer'}),
  P('soldier_overwatch', '廣域預警', '預警半徑 +2、冷卻 −1。', {cls: 'soldier'}), P('soldier_marked', '標定弱化', '標定多 1 回合；被標定的敵人打你命中 −6。', {cls: 'soldier'}), P('soldier_hunter', '標定壓制', '標定多 1 回合；你打被標定的目標傷害 +10%。', {cls: 'soldier'}),
  P('recon_unseen', '隱蔽射手', '目標看不到你時，傷害 +12%。', {cls: 'recon'}), P('recon_blackout', '斷層延長', '訊號斷層持續 +1、冷卻 −1。', {cls: 'recon'}), P('recon_sidestep', '側身精通', '側身時敵人命中再 −6。', {cls: 'recon'}),
  P('bulwark_plating', '板甲護持', '還有護甲板時，受到的傷害再 −8%。', {cls: 'bulwark'}), P('bulwark_recovery', '板材回收', '敵人更常掉護甲板、每份 +5。', {cls: 'bulwark'}), P('bulwark_anchor', '下錨強化', '下錨時受到的傷害 −10%。', {cls: 'bulwark'}),
  P('berserker_fury', '狂怒堆疊', '戰意上限 +1 層。', {cls: 'berserker'}), P('berserker_endure', '血怒不退', '戰意晚 2 回合才開始掉。', {cls: 'berserker'}), P('berserker_thirst', '嗜血狂歡', '近戰吸血 +8%。', {cls: 'berserker'}),
  P('engineer_frame', '機體強化', '機體生命 +20、裝甲 +1。', {cls: 'engineer'}), P('engineer_firecontrol', '火控校準', '機體命中 +8、傷害 +3。', {cls: 'engineer'}), P('engineer_lines', '生產序列', '工坊多一條生產線。', {cls: 'engineer'}), P('engineer_deploy', '部署上限', '同時部署的機體 +1 台。', {cls: 'engineer'})];
const perkOf = id => RUN_PERKS.find(p => p.id === id);
// 抽三個（照 ASH 的抽法：三成先抽一個已經有的、五成放一個職業的，其餘從全部平均抽）
function draft(op, c) {
  const have = op.picks[c.uid] || [], n = id => have.filter(x => x === id).length, r = lcg((op.seed ^ c.uid * 2654435761 ^ (have.length + 1) * 40503) >>> 0);
  const pool = RUN_PERKS.filter(p => (!p.cls || p.cls === c.cls) && (p.cap == null || n(p.id) < p.cap)), out = [];
  const take = L => { const a = L.filter(p => !out.includes(p.id)); if (a.length) out.push(a[Math.floor(r() * a.length)].id); };
  if (r() < .3) take(pool.filter(p => n(p.id) > 0 && p.cap != null));
  if (r() < .5) take(pool.filter(p => p.cls));
  for (let i = 0; i < 9 && out.length < 3; i++) take(pool);
  return out;
}
const pendingOf = (op, c) => Math.max(0, wonFights(op) - (op.picks[c.uid] || []).length);
// 在路線圖上選一個
export function pick(G, h, uid, id) {
  const op = G.op; if (!op) return '沒有進行中的行動'; if (op.fight) return '先把這一點打完';
  const c = G.roster.find(x => x.uid === uid); if (!c || !op.uids.includes(uid) || !c.alive) return '這個人不在這次行動裡';
  if (!pendingOf(op, c)) return '現在沒有可以選的';
  if (!draft(op, c).includes(id)) return '沒有這個選項';   // 抽到的三個照種子固定，不用存
  (op.picks[uid] ||= []).push(id);
  const k = op.carry[uid] ||= {};
  if (id === 'health') { if (k.hp != null) k.hp += 30; if (k.maxHp) k.maxHp += 20; }
  if ((id === 'plating' || id === 'plate_rack') && k.plates != null) k.plates += 10;
  return null;
}
const nodeOf = (op, id) => OPS[op.def]?.nodes.find(n => n.id === id);
// 現在能選的點：還沒走第一步就是第 1 層，不然是上一點的 next
export function nextNodes(op) { const D = OPS[op.def]; if (!D) return []; if (!op.at) return D.nodes.filter(n => n.layer === 1); return (nodeOf(op, op.at)?.next || []).map(id => nodeOf(op, id)).filter(Boolean); }
const lcg = s => () => ((s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 4294967296);
const wonFights = op => op.done.filter(id => nodeOf(op, id)?.type !== 'rest').length;

export function start(G, h, def, uids, book) {
  const D = OPS[def]; if (!D) return '沒有這個行動';
  if (G.op) return '已經有一個行動在進行中';
  const pick = [...new Set(uids || [])].map(u => G.roster.find(c => c.uid === u)).filter(c => c && c.alive && c.status === 'home' && !c.keep);
  if (pick.length < 1 || pick.length > 4) return '一次行動派一到四個人（在基地裡、沒有標「不出擊」的）';
  const tired = pick.find(c => (c.restUntil || 0) > h); if (tired) return `${tired.id} 還在休息（${Math.ceil(tired.restUntil - h)} 小時）`;
  if (D.req && !(G.opClear || {})[D.req]) return `要先完成「${OPS[D.req].title}」`;   // 前一組打贏了後面的才能打
  for (const [m, n] of Object.entries(D.cost)) if ((G.mats[m] || 0) < n) return '素材不夠';
  for (const [m, n] of Object.entries(D.cost)) G.mats[m] -= n;
  G.opSeq = (G.opSeq || 0) + 1; const serial = book.nextId++;   // 編號用全星球的流水號：伺服器上的戰鬥照編號開，兩家公司不能撞
  G.op = {def, id: `OP-${serial}`, seed: ((h * 2654435761) ^ serial * 40503) >>> 0, started: h, at: null, done: [], uids: pick.map(c => c.uid), picks: {}, carry: {}, fight: null, cells: 0};
  for (const c of pick) { c.status = 'op'; C.rec(c, {h, t: 'op', co: G.name, title: D.title}); }
  (G.log ||= []).push({h, text: `出發：${D.title}（${pick.map(c => c.id).join('、')}）。`});
  return null;
}
// 選下一點。休整當場結算；戰鬥記下要打哪一點（fight），由 core 開戰
export function go(G, h, nodeId) {
  const op = G.op; if (!op) return '沒有進行中的行動';
  if (op.fight) return '這一點還沒打完';
  const n = nextNodes(op).find(x => x.id === nodeId); if (!n) return '這一點現在接不上';
  if (n.type === 'rest') {
    for (const u of op.uids) { const c = G.roster.find(x => x.uid === u), k = op.carry[u]; if (!c?.alive || !k) continue; k.hp = Math.min(k.maxHp || k.hp, k.hp + Math.ceil((k.maxHp || k.hp) / 2)); k.plates = null; }   // null＝進場照裝備補滿
    op.at = n.id; op.done.push(n.id); (G.log ||= []).push({h, text: `${OPS[op.def].title}：在${n.name}休整。`}); return null;
  }
  op.fight = {node: n.id, ticket: `${op.id}-${op.done.length + 1}${n.id}`, n: op.done.length + 1};
  return null;
}
// 這一點的戰鬥（給 core 組任務資料）
export function battle(G, w) {
  const op = G.op, f = op?.fight; if (!f) return null;
  const D = OPS[op.def], n = nodeOf(op, f.node), r = lcg(op.seed ^ f.n * 7919);
  const power = (n.boss ? 32 : 14 + 7 * n.layer) * (n.elite ? 1.4 : 1) * (1 + .25 * Math.max(0, op.uids.length - 2)) * (1 + .3 * (D.tier || 0));   // 後面的行動更難
  const units = C.opUnits({rs: op.seed ^ f.n}, D.side, power, n.type === 'facility' ? 'clear' : n.type, 26);
  const facility = n.type === 'facility';
  return {id: f.ticket, title: `${D.title}・${n.kind}：${n.name}`, type: facility ? 'hunting' : n.type, facility, floors: facility ? 1 : 0, biome: D.biome || '礫丘', night: r() < .3,
    enemy: {side: D.side, name: D.foe || '敵人', power: Math.round(power), units, veh: {}, boss: n.boss || null}, intro: n.text, wave: 0};
}
// 戰場送進去的每個人多帶的東西：局內的強化、還沒挑的、帶過來的生命與護甲板
export function runOf(G, c) {
  const op = G.op; if (!op) return null; const k = op.carry[c.uid] || {};
  const picks = op.picks[c.uid] || [];
  return {picks, pending: 0, hp: k.hp ?? null, plates: k.plates ?? null};   // 三選一在路線圖上選（pick），戰場上不再跳
}
// 一點打完
export function settle(G, book, w, h, ticket, res) {
  const op = G.op; if (!op?.fight || op.fight.ticket !== ticket) return '這場行動的戰鬥已經結算了';
  const n = nodeOf(op, op.fight.node), D = OPS[op.def], members = op.uids.map(u => G.roster.find(c => c.uid === u)).filter(Boolean), r = lcg(op.seed ^ op.fight.n * 104729);
  const dead = new Set(res.dead || []), lines = [];
  for (const c of members) {
    const pr = res.progress?.[c.id];
    if (pr) { op.picks[c.uid] = pr.picks || op.picks[c.uid] || []; op.carry[c.uid] = {hp: pr.hp, maxHp: pr.maxHp, plates: pr.plates}; if (pr.skills) c.skills = pr.skills; if (pr.prep !== undefined) c.prep = pr.prep; }
    if (dead.has(c.id) && c.alive) { c.alive = false; c.downAs = 'recovered'; C.rec(c, {h, t: 'down', co: G.name, title: `${D.title}・${n.name}`, recovered: true}); lines.push(`${c.id} 倒下（遺體收回）`); }
  }
  op.fight = null;
  // 倒下的人離開這次行動（遺體已經收回，可能馬上被拿去重新培養）
  const fallen = members.filter(c => !c.alive).map(c => c.uid); if (fallen.length) { op.fallen = [...(op.fallen || []), ...fallen]; op.uids = op.uids.filter(u => !fallen.includes(u)); }
  const alive = members.filter(c => c.alive);
  if (!res.win || !alive.length) return finish(G, book, h, false, `${n.name}${res.retreated ? '撤出' : '打輸了'}${lines.length ? '，' + lines.join('、') : ''}`);
  op.at = n.id; op.done.push(n.id);
  // 獎勵：每打贏一點，活著的人各抽 2 片記憶片段；王點再多 4 片、加現金
  const k = n.boss ? 6 : 2; for (const c of alive) { const lv0 = c.lv || 1; C.drawCells(c, k, r); c.lv = C.cellLevel(c); if (c.lv > lv0) lines.push(`${c.id} 升到 ${c.lv} 級`); }
  op.cells += k * alive.length;
  if (n.boss) { C.pay(book, h, G.name, D.cash, 'op', `${D.title}：完成`, null); (G.opClear ||= {})[op.def] = ((G.opClear || {})[op.def] || 0) + 1; return finish(G, book, h, true, `拿下${n.name}${lines.length ? '，' + lines.join('、') : ''}；獎勵 $${D.cash}k`); }
  book.inbox.push({t: h, player: G.name, kind: 'result', text: `${D.title}：拿下${n.name}${lines.length ? '，' + lines.join('、') : ''}。選下一點繼續，或撤回基地。`, ref: null});
  return null;
}
// 結束：成功、失敗，或在兩點之間自己撤回
export function finish(G, book, h, ok, why) {
  const op = G.op; if (!op) return '沒有進行中的行動'; const D = OPS[op.def];
  for (const u of op.uids) { const c = G.roster.find(x => x.uid === u); if (!c) continue; if (c.alive && c.status === 'op') c.status = 'home'; c.restUntil = h + REST_H; }
  (G.opLog ||= []).push({h, def: op.def, ok, nodes: op.done.length, cells: op.cells, why});
  book.inbox.push({t: h, player: G.name, kind: 'result', text: `${D.title}：${ok ? '行動成功' : '行動結束'}——${why}。記憶片段共 ${op.cells} 片；參加的人休息 ${REST_H} 小時。`, ref: null});
  G.op = null; return null;
}
// 整補（Alan 2026-10-14）：兩點之間花一大筆錢和素材，全隊補滿生命和護甲板；同一次行動每用一次價錢加倍
export const RESUPPLY = {cash: 50, implant: 30, neural: 30};
export const resupplyCost = op => { const k = 2 ** (op.resupplied || 0); return {cash: RESUPPLY.cash * k, implant: RESUPPLY.implant * k, neural: RESUPPLY.neural * k}; };
export function resupply(G, book, h) {
  const op = G.op; if (!op) return '沒有進行中的行動'; if (op.fight) return '先把這一點打完';
  const c = resupplyCost(op); if (G.cash < c.cash) return '錢不夠'; if ((G.mats.implant || 0) < c.implant || (G.mats.neural || 0) < c.neural) return '素材不夠';
  G.mats.implant -= c.implant; G.mats.neural -= c.neural; C.pay(book, h, G.name, -c.cash, 'op', `${OPS[op.def].title}：整補`, null);
  for (const u of op.uids) { const k = op.carry[u]; if (k) { k.hp = k.maxHp || k.hp; k.plates = null; } }
  op.resupplied = (op.resupplied || 0) + 1; (G.log ||= []).push({h, text: `${OPS[op.def].title}：花 $${c.cash}k 整補，全隊補滿。`}); return null;
}
export function leave(G, book, h) { const op = G.op; if (!op) return '沒有進行中的行動'; if (op.fight) return '先把這一點打完（戰鬥裡可以撤出）'; return finish(G, book, h, false, `在${op.at ? nodeOf(op, op.at)?.name : '出發點'}撤回`); }
// 畫面
export function view(G, h) {
  const op = G.op, C2 = G.opClear || {}, defs = Object.entries(OPS).map(([id, D]) => ({id, title: D.title, text: D.text, cost: D.cost, cash: D.cash, req: D.req || null, open: !D.req || !!C2[D.req], cleared: C2[id] || 0, nodes: D.nodes.map(({boss, ...n}) => ({...n, boss: !!boss}))}));
  return {defs, rest: REST_H, log: (G.opLog || []).slice(-5).reverse(),
    cur: op ? {def: op.def, at: op.at, done: op.done, uids: op.uids, next: nextNodes(op).map(n => n.id), fight: op.fight, cells: op.cells, carry: op.carry, picks: op.picks, resupply: resupplyCost(op),
      drafts: Object.fromEntries(op.uids.map(u => G.roster.find(c => c.uid === u)).filter(c => c?.alive && pendingOf(op, c)).map(c => [c.uid, {left: pendingOf(op, c), ids: draft(op, c)}]))} : null,
    perks: Object.fromEntries(RUN_PERKS.map(p => [p.id, {n: p.n, text: p.text}]))};
}
