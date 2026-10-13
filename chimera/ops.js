// ===== 行動（Alan 2026-10-13，warband/DESIGN.md「等待太久：隨時有得打的主力模式」）=====
// 跟沙盒無關、隨時能打的副本：一次行動是一張分岔的路線圖，每個點是一場戰鬥（或休整），最後一個是王點。
// - 出發：基地裡挑一到四個人（在家、活著、沒在休息），付這次行動的素材；這些人進入「行動中」（status 'op'），別的事派不到他們。
// - 每一點：選一個接得上的點。戰鬥用自己的編號（OP-…）開，不建小隊、不建服務單；打完由 settle 結算。
//   生命、護甲板帶到下一點；局內的三選一（ASH 原本的強化）每打贏一點，每人多一次，只在這次行動裡有效。
// - 倒下就是真的死（Alan：要真死），但這種行動的遺體全數收回，可以重新培養。全滅、打輸、撤出都算行動失敗，已經拿到的獎勵不收回。
// - 打完（成功或失敗）參加的人要休息 REST_H 小時（疲勞先綁角色，AP 還是角色疲勞待 Alan 決定）。
import * as C from './cases.js';
export const REST_H = 12;
// 試玩路線圖（Alan 2026-10-13：先做骨架，沒有故事）。layer 1～5，next 是接得上的點；type 對上現有的戰鬥類型，rest 是休整
export const OPS = {
  trial: {title: '試玩行動：鏽牙礦場', text: '礦主「鏽牙」帶著一夥掠奪者佔了北邊的舊礦場。從外圍一路打進去，拿下他的堡壘。', side: 'warlord', cost: {food: 40, water: 40}, cash: 60, nodes: [
    {id: 'a', layer: 1, type: 'clear', kind: '突破', name: '外圍營地', text: '木柵圍起來的營地，清掉裡面的人。', next: ['c', 'd']},
    {id: 'b', layer: 1, type: 'pursuit', kind: '潛入', name: '油料庫', text: '油料庫已經點著了，追兵從後面追上來：跑到另一頭的撤離點。', next: ['d', 'e']},
    {id: 'c', layer: 2, type: 'hold', kind: '守住', name: '斷橋', text: '守住橋頭，撐到援軍被打退。', next: ['f']},
    {id: 'd', layer: 2, type: 'rest', kind: '休整', name: '廢棄加油站', text: '喘口氣：每人回復一半的生命、補滿護甲板。', next: ['f', 'g']},
    {id: 'e', layer: 2, type: 'ambush', kind: '車隊', name: '礦車道', text: '搭上運礦車往裡面衝，路上會被追上來。', next: ['g']},
    {id: 'f', layer: 3, type: 'assault', kind: '突破', name: '礦場大門', text: '正面打下大門的陣地。', next: ['h', 'i']},
    {id: 'g', layer: 3, type: 'facility', kind: '室內', name: '礦坑', text: '從坑道繞進去，裡面又窄又暗。', next: ['h', 'i']},
    {id: 'h', layer: 4, type: 'rest', kind: '休整', name: '工寮', text: '最後一次休整：每人回復一半的生命、補滿護甲板。', next: ['j']},
    {id: 'i', layer: 4, type: 'probe', kind: '精英', name: '親衛巡邏隊', text: '鏽牙的親衛在礦場裡巡邏，人多、裝備好。', next: ['j'], elite: true},
    {id: 'j', layer: 5, type: 'clear', kind: '王點', name: '鏽牙的堡壘', text: '礦主本人和他最後的手下。', next: [], boss: {ash: 'delisted_soldier', name: '礦主「鏽牙」', hp: 3}}]},
};
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
  const power = (n.boss ? 32 : 14 + 7 * n.layer) * (n.elite ? 1.4 : 1) * (1 + .25 * Math.max(0, op.uids.length - 2));
  const units = C.opUnits({rs: op.seed ^ f.n}, D.side, power, n.type === 'facility' ? 'clear' : n.type, 26);
  const facility = n.type === 'facility';
  return {id: f.ticket, title: `${D.title}・${n.kind}：${n.name}`, type: facility ? 'hunting' : n.type, facility, floors: facility ? 1 : 0, biome: '礫丘', night: r() < .3,
    enemy: {side: D.side, name: '鏽牙的人', power: Math.round(power), units, veh: {}, boss: n.boss || null}, intro: n.text, wave: 0};
}
// 戰場送進去的每個人多帶的東西：局內的強化、還沒挑的、帶過來的生命與護甲板
export function runOf(G, c) {
  const op = G.op; if (!op) return null; const k = op.carry[c.uid] || {};
  const picks = op.picks[c.uid] || [];
  return {picks, pending: Math.max(0, wonFights(op) - picks.length), hp: k.hp ?? null, plates: k.plates ?? null};
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
  if (n.boss) { C.pay(book, h, G.name, D.cash, 'op', `${D.title}：完成`, null); return finish(G, book, h, true, `拿下${n.name}${lines.length ? '，' + lines.join('、') : ''}；獎勵 $${D.cash}k`); }
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
export function leave(G, book, h) { const op = G.op; if (!op) return '沒有進行中的行動'; if (op.fight) return '先把這一點打完（戰鬥裡可以撤出）'; return finish(G, book, h, false, `在${op.at ? nodeOf(op, op.at)?.name : '出發點'}撤回`); }
// 畫面
export function view(G, h) {
  const op = G.op, defs = Object.entries(OPS).map(([id, D]) => ({id, title: D.title, text: D.text, cost: D.cost, cash: D.cash, nodes: D.nodes.map(({boss, ...n}) => ({...n, boss: !!boss}))}));
  return {defs, rest: REST_H, log: (G.opLog || []).slice(-5).reverse(),
    cur: op ? {def: op.def, at: op.at, done: op.done, uids: op.uids, next: nextNodes(op).map(n => n.id), fight: op.fight, cells: op.cells, carry: op.carry, picks: op.picks} : null};
}
