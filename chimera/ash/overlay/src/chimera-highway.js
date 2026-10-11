// 奇美拉：公路戰（Alan 2026-10-09，warband/DESIGN.md「公路戰」）——接舷戰，多輛大小車靠近又離開。
// 畫面由右往左開：我方在中間一台 3×15 的大卡車上（第 12～14 排，不動）。上下各兩條車道（北 9～11、6～8 排，南 15～17、18～20 排），其餘是沙漠。
// - 車輛：大車（卡車，3 格寬、12～14 格長，左邊 2×3 的車頭是牆格）、越野車（2×3）、機車（1×2）。
//   照時刻表從右邊（後方）由遠而近開進車道（速度時快時慢），追到並排後前後飄移；車上還有活著的敵人就一直貼著，人打光了才慢慢落後、退出地圖（Alan 2026-10-11）。
//   越野車、機車只走緊貼我方的內側車道。
//   每一回合結束時移動一次（MissionGame.action → vehicleStep）：車上的人、屍體、貨箱、地上的東西跟著一起移，車欄（矮牆）重新算。
//   一條車道一台車，不會重疊。
// - 乘員：服務單上的敵人照時刻表分給每一台車（人數照服務單，Alan 2026-10-09）；車開進地圖時，人陸續出現在看得到的車斗上。
// - 拉開前兩回合提示；開出地圖時還在那台車上的：敵人離開戰場（不算擊殺），我方的人被帶走（算陣亡，Alan 2026-10-09）。
// - 路面（沙漠）不能走，被炸、被推下車就摔死（chimera-mission.js）。跨到另一台車上吃翻越破綻＋3 層壓制。
// - 勝利（goal drive）：撐過 holdTurns 回合，或時刻表上所有的車都來過、場上沒有活著的敵人（Alan 2026-10-09）。
// - 「在開」只是畫面：路面往右捲（chimera-outdoor-render.js），規則上大家都在我方卡車的座標裡。
import {SIZE} from './data.js';

const N = SIZE, OURS = {id: 1, kind: 'truck', lane: 'ours', y0: 12, w: 3, c0: 12, x0: 6, x1: 20, len: 15, state: 'ours'};
// 車道：inner＝緊貼我方卡車（小車只走這兩條），near＝小車擺在靠我方的哪幾排
const LANES = {n1: {y0: 9, inner: true, near: [11, 10]}, n2: {y0: 6}, s1: {y0: 15, inner: true, near: [15, 16]}, s2: {y0: 18}};
const KIND = {
  truck: {len: [12, 14], crew: [4, 6], enter: 3, stay: [6, 9], leave: 2},
  buggy: {len: [3, 3], w: 2, crew: [2, 3], enter: 4, stay: [2, 3], leave: 4},
  bike: {len: [2, 2], w: 1, crew: [1, 1], enter: 5, stay: [2, 2], leave: 5},
};
const VEH_NAME = {truck: '敵方卡車', buggy: '越野車', bike: '機車'};

// 一台車的形狀：y0／w 照車道與種類，x0..x1 是車斗，車頭（卡車才有）在 x0 左邊兩格、c0 起三排
function shape(v) {
  const L = LANES[v.lane], K = KIND[v.kind];
  if (v.kind === 'truck') { v.y0 = L.y0; v.w = 3; v.c0 = L.y0; }
  else { const rows = L.near.slice(0, K.w).sort((a, b) => a - b); v.y0 = rows[0]; v.w = K.w; v.c0 = null; }
  v.x1 = v.x0 + v.len - 1; return v;
}
const inside = (x, y) => x > 0 && y > 0 && x < N - 1 && y < N - 1;
export const onVehicle = (v, x, y) => y >= v.y0 && y < v.y0 + v.w && x >= v.x0 && x <= v.x1;

// 照目前的車輛位置重建：deck、grid（車頭是牆格）、barriers（車欄；ASH 的 barrierBetween 照陣列快取，所以每次給新的陣列）
export function rebuild(o, grid, floor) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { o.deck[y][x] = 0; grid[y][x] = x === 0 || y === 0 || x === N - 1 || y === N - 1 ? 0 : 1; }
  for (const v of o.trucks) {
    for (let y = v.y0; y < v.y0 + v.w; y++) for (let x = v.x0; x <= v.x1; x++) if (inside(x, y)) o.deck[y][x] = v.id;
    if (v.kind === 'truck') for (let y = v.c0; y < v.c0 + 3; y++) for (const x of [v.x0 - 2, v.x0 - 1]) if (inside(x, y)) grid[y][x] = 0;
  }
  const barriers = [], edges = new Set(), low = (x, y, axis) => { const b = axis === 'y' ? {axis, x, y: y + .5} : {axis, x: x + .5, y}, k = `${b.axis}:${b.x},${b.y}`; if (edges.has(k)) return; edges.add(k);
    barriers.push({id: `${floor}-rail-${barriers.length}`, type: 'low_partition', ...b, hp: 80, maxHp: 80}); };
  const D = o.deck;
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    if (!D[y][x]) continue;
    if (D[y - 1][x] !== D[y][x]) low(x, y - 1, 'y');
    if (D[y + 1][x] !== D[y][x]) low(x, y, 'y');
    if (D[y][x - 1] !== D[y][x] && grid[y][x - 1] === 1) low(x - 1, y, 'x');
    if (D[y][x + 1] !== D[y][x] && x + 1 < N - 1) low(x, y, 'x');
  }
  return barriers;
}

export function highwayMap(tk, floor, R, bio, G) {
  const grid = Array.from({length: N}, () => Array(N).fill(1));
  // 車外是沙漠（Alan 2026-10-09）：ground.png 的沙地、沙紋、碎石沙
  const ground = Array.from({length: N}, () => Array.from({length: N}, () => { const r = R(); return r < .55 ? G.sand : r < .85 ? G.ripple : G.pebble; }));
  const trench = Array.from({length: N}, () => Array(N).fill(0)), deck = Array.from({length: N}, () => Array(N).fill(0));
  const o = {layout: 'highway', biome: tk.biome || '', goal: 'drive', holdTurns: 24, ground, trench, deck, trucks: [{...OURS}], schedule: [], night: !!tk.night, nextId: 2,
    enemyDeck: tk.enemy?.side === 'native' ? 2 : 3};   // 敵方車斗：根者是木板貨台，其餘是鏽鐵拼補（truck.png 的格子）
  const props = [], items = [], start = {x: 12, y: 13}, taken = new Set([`${start.x},${start.y}`]);
  // 我方車上：貨箱（掩體）、彈藥、醫療包
  for (let i = 0, put = 0; i < 40 && put < 3; i++) { const x = 7 + Math.floor(R() * 13), y = 12 + Math.floor(R() * 3), k = `${x},${y}`; if (taken.has(k) || Math.abs(x - start.x) + Math.abs(y - start.y) < 2) continue; props.push({id: `${floor}-crate-${props.length}`, x, y, type: 'cover', hp: 90, maxHp: 90}); taken.add(k); put++; }
  for (const [type, amount] of [['ammo', 60], ['med', 1], ['ammo', 40]]) for (let i = 0; i < 30; i++) { const x = 7 + Math.floor(R() * 13), y = 12 + Math.floor(R() * 3), k = `${x},${y}`; if (taken.has(k)) continue; items.push({x, y, type, amount, floor}); taken.add(k); break; }
  const light = grid.map(row => row.map(() => tk.night ? 0 : 1));
  const footprint = []; for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) footprint.push({x, y});
  return {map: {grid, rooms: [{x: 1, y: 1, w: N - 2, h: N - 2, cx: 13, cy: 13, id: 0, cellIds: [0], footprint}],
    start, end: {x: 7, y: 13}, startRoom: 0, endRoom: 0, links: [], mainRoute: [0], rewardRooms: [], enemies: [], items, props, hazards: [], marks: [], barriers: rebuild(o, grid, floor),
    cells: [{id: 0, row: 0, col: 0, roomId: 0}], openings: [], annexes: [], generation: {version: 2, recipeId: 'chimera-highway-v2'}, lighting: light, slots: [], lamps: [], lightModel: 2},
    spots: [], style: 'chimera-truck', outdoor: o};
}

// 時刻表：把敵人（已經做好的 ASH 敵人，還沒放上地圖）分給一台台車。第一台卡車開場就在北邊並排；其餘從第 2 回合起每 3～5 回合追上來一台
export function planConvoy(o, enemies, R) {
  const rng = ([a, b]) => a + Math.floor(R() * (b - a + 1)), left = [...enemies], plan = [];
  const rushers = left.filter(e => e.courseName === '衝鋒車乘員'); for (const e of rushers) left.splice(left.indexOf(e), 1);   // 衝鋒車乘員坐越野車
  const first = {kind: 'truck', crew: left.splice(0, Math.min(left.length, rng(KIND.truck.crew) + 1)), at: 0};
  for (const e of rushers) plan.push({kind: 'buggy', crew: [e, ...left.splice(0, 1)]});
  while (left.length) { const kind = left.length >= 4 && R() < .55 ? 'truck' : left.length >= 2 && R() < .6 ? 'buggy' : 'bike'; plan.push({kind, crew: left.splice(0, Math.min(left.length, rng(KIND[kind].crew)))}); }
  for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }
  let t = 2; for (const p of plan) { p.at = t; t += 3 + Math.floor(R() * 3); }
  o.schedule = plan; o.holdTurns = Math.max(24, t + 6);
  // 第一台卡車也是從後方開上來（開場在畫面右邊、還沒並排；Alan 2026-10-11：開場就接舷氣氛很差）
  const v = arrive(o, first, 'n1', R); v.x0 = 15 + Math.floor(R() * 4); shape(v);
  return v;
}
function arrive(o, p, lane, R) {
  const K = KIND[p.kind], len = K.len[0] + Math.floor(R() * (K.len[1] - K.len[0] + 1));
  const v = shape({id: o.nextId++, kind: p.kind, lane, len, x0: N - 2, state: 'enter', crew: p.crew, name: VEH_NAME[p.kind],
    tx: p.kind === 'truck' ? 8 + Math.floor(R() * 4) : 9 + Math.floor(R() * 8), left: K.stay[0] + Math.floor(R() * (K.stay[1] - K.stay[0] + 1)), crates: p.kind === 'truck' ? 2 : 0});
  o.trucks.push(v); return v;
}
// 空的車道：小車只走內側；卡車先佔內側，內側滿了才走外側
function freeLane(o, kind, R) {
  const used = new Set(o.trucks.map(v => v.lane)), lanes = Object.keys(LANES).filter(k => !used.has(k) && (kind === 'truck' || LANES[k].inner));
  const inner = lanes.filter(k => LANES[k].inner), pool = inner.length ? inner : lanes;
  return pool.length ? pool[Math.floor(R() * pool.length)] : null;
}

// 每一回合結束時：到點的車開進來，車照狀態移動，車上的東西跟著移，開出地圖的帶走，乘員上車。回傳要記的紀錄 [文字, 危險]
export function vehicleStep(g, R) {
  const o = g.chimeraOutdoor, floor = g.floor, logs = [], squad = g.members || [g.player];
  for (const p of [...o.schedule]) { if (p.at > g.turn) continue; const lane = freeLane(o, p.kind, R); if (!lane) continue; o.schedule.splice(o.schedule.indexOf(p), 1); logs.push([`後方追上來一台${arrive(o, p, lane, R).name}。`, false]); }
  const units = [...squad, ...g.enemies];
  for (const v of o.trucks) {
    if (v.state === 'ours') continue;
    let dx = 0;
    // 車上（還有人沒下車也算）活著的敵人
    const crewAlive = (v.crew?.length || 0) + g.enemies.filter(e => e.hp > 0 && onVehicle(v, e.x, e.y)).length, minX = v.kind === 'truck' ? 3 : 1;
    // 開上來：每回合 1～enter 格，時快時慢；偶爾加速衝一段
    if (v.state === 'enter') { const sp = 1 + Math.floor(R() * KIND[v.kind].enter) + (R() < .15 ? 2 : 0); dx = -Math.min(sp, v.x0 - v.tx); if (v.x0 + dx <= v.tx) v.state = 'beside'; }
    else if (v.state === 'beside') {
      // 並排：前後飄移（四成的回合動一格，偶爾落後兩格又追上來）
      if (R() < .4) { let d = R() < .5 ? -1 : 1; if (R() < .1) d *= 2; const nx = Math.max(minX, Math.max(v.tx - 3, Math.min(v.tx + 3, v.x0 + d))); dx = nx - v.x0; }
      v.left--;
      if (crewAlive > 0 && v.left <= 0) v.left = KIND[v.kind].stay[0];   // 車上還有人：繼續貼著
      if (crewAlive === 0 && v.left > 2) v.left = 2;
      if (crewAlive === 0 && v.left === 2) { const ours = squad.some(m => m.hp > 0 && onVehicle(v, m.x, m.y)); logs.push([`${v.name}上的人打光了，要拉開了${ours ? '，車上的人兩回合內要跳回來' : ''}。`, ours]); }
      if (crewAlive === 0 && v.left <= 0) v.state = 'leave';
    } else if (v.state === 'leave') dx = 1 + Math.floor(R() * KIND[v.kind].leave);   // 慢慢落後
    if (!dx) continue;
    for (const u of units) if (onVehicle(v, u.x, u.y)) u.x += dx;
    for (const q of g.props) if (onVehicle(v, q.x, q.y)) q.x += dx;
    for (const it of g.items) if (onVehicle(v, it.x, it.y)) it.x += dx;
    v.x0 += dx; v.x1 += dx;
  }
  // 開出地圖的：敵人離開戰場，我方的人被帶走（陣亡），東西不見；整台都出去的車拿掉
  const out = (x, y) => !inside(x, y);
  for (const m of squad) if (out(m.x, m.y)) { if (m.hp > 0) { m.hp = 0; logs.push([`${m.callName || m.squadId || '隊員'}被敵車帶走了。`, true]); } m.x = Math.min(m.x, N - 1); }
  const gone = g.enemies.filter(e => out(e.x, e.y));
  if (gone.length) { g.enemies = g.enemies.filter(e => !gone.includes(e)); const live = gone.filter(e => e.hp > 0).length; if (live) logs.push([`${live} 個敵人跟著車離開了。`, false]); }
  g.props = g.props.filter(q => !out(q.x, q.y)); g.items = g.items.filter(it => !out(it.x, it.y));
  o.trucks = o.trucks.filter(v => !(v.state === 'leave' && v.x0 - 2 > N - 2));
  g.barriers = rebuild(o, g.grid, floor);
  // 乘員上車、卡車上放貨箱：放在看得到、空著的車斗上（貨箱不放在靠我方的那一排）
  const busy = new Set([...units.filter(u => u.hp > 0), ...g.props].map(u => `${u.x},${u.y}`));
  for (const v of o.trucks) {
    if (v.state === 'ours' || v.state === 'leave') continue;
    const cells = []; for (let y = v.y0; y < v.y0 + v.w; y++) for (let x = Math.max(v.x0, 1); x <= Math.min(v.x1, N - 2); x++) if (!busy.has(`${x},${y}`)) cells.push({x, y});
    for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    const edgeRow = v.lane[0] === 'n' ? v.y0 + v.w - 1 : v.y0;
    while (v.crates > 0 && cells.length > 4) { const i = cells.findIndex(c => c.y !== edgeRow); if (i < 0) break; const c = cells.splice(i, 1)[0]; g.props.push({id: `${floor}-crate-v${v.id}-${v.crates}`, x: c.x, y: c.y, type: 'cover', hp: 90, maxHp: 90}); busy.add(`${c.x},${c.y}`); v.crates--; }
    while (v.crew?.length && cells.length) { const e = v.crew.shift(), c = cells.pop(); e.x = c.x; e.y = c.y; e.alert = true; e.lastKnown = {x: g.player.x, y: g.player.y}; g.enemies.push(e); busy.add(`${c.x},${c.y}`); }
  }
  return logs;
}
// 時刻表上的車都來過、車上沒有還沒下車的人
export const convoyDone = o => !o.schedule.length && o.trucks.every(v => !v.crew?.length);
// 還沒上場的敵人（測試用）
export const pendingCrew = o => o.schedule.reduce((x, p) => x + p.crew.length, 0) + o.trucks.reduce((x, v) => x + (v.crew?.length || 0), 0);
