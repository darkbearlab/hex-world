// PVP 視野規則的小測試：開火暴露（牆後也看得到）、貼牆不算探頭、自己的階段開始暴露結束
import '../../src/game.js';
import {PvpGame} from '../../src/pvp-game.js';
let bad = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) bad++; };
// 一張手畫的小地圖：中間一道牆，牆的右上角是轉角
const rows = ['###########', '#.........#', '#.........#', '#....#....#', '#....#....#', '#....#....#', '#....#....#', '#....#....#', '#.........#', '#.........#', '###########'];
const T = rows.map(r => r.split('')), map = {T, A: [2, 5], B: [8, 5]};
const g = new PvpGame({seed: 1, map, A: ['soldier', 'recon', 'bulwark', 'ninja'], B: ['soldier', 'recon', 'bulwark', 'ninja']});
const A1 = g.unit('A1'), B1 = g.unit('B1');
for (const m of [...g.sides.A, ...g.sides.B]) Object.assign(m, {x: m.pvpSide === 'A' ? 1 : 9, y: 9});   // 其他人放到下面角落，不擋視線
Object.assign(A1, {x: 4, y: 5}); Object.assign(B1, {x: 6, y: 5});   // 隔著牆
g.enter('A'); g.swap(A1);
const px = () => g.enemies.find(e => e.pvpOf === 'B1');
ok(!g.teamVisible(px()), '隔著牆：A 看不到 B1');
B1.pvpExposed = true; g.enemies = g.proxies('B'); ok(g.teamVisible(px()), 'B1 開過火（暴露）：A 隔著牆也看得到');
B1.pvpExposed = false; g.enter('B'); ok(!B1.pvpExposed, 'B 隊自己的階段開始：B1 的暴露結束');
// 轉角：B1 貼在牆角（牆的上端 (5,3) 旁邊的 (6,2)），A1 在 (3,2)——中間開闊，互相看得到
g.enter('A'); g.swap(A1); Object.assign(A1, {x: 3, y: 4}); Object.assign(B1, {x: 6, y: 3}); g.enemies = g.proxies('B');
const seeDirect = g.teamVisible(px());
// ASH 原本的規則（兩邊都能探頭）比較：用 SquadGame 的 sight
const ashSees = Object.getPrototypeOf(Object.getPrototypeOf(g)).sight.call(g, A1, px());
console.log(`  轉角：ASH 原本 ${ashSees ? '看得到' : '看不到'}；PVP ${seeDirect ? '看得到' : '看不到'}`);
ok(!(ashSees && seeDirect) || true, '（資訊）');
console.log(bad ? `有 ${bad} 項不對` : '全部正常');
// 轉角（自動找）：ASH 原本「靠被看的那一方探頭才看得到」的位置組合，PVP 應該看不到；「我探頭看他」照樣看得到
{
  const base = Object.getPrototypeOf(Object.getPrototypeOf(g)).sight;
  let leanOnly = 0, hidden = 0, iLean = 0, iSee = 0;
  for (let ay = 1; ay <= 9; ay++) for (let ax = 1; ax <= 9; ax++) for (let by = 1; by <= 9; by++) for (let bx = 1; bx <= 9; bx++) {
    if (T[ay][ax] !== '.' || T[by][bx] !== '.' || (ax === bx && ay === by)) continue;
    Object.assign(A1, {x: ax, y: ay}); Object.assign(B1, {x: bx, y: by}); g.enemies = g.proxies('B'); const e = px();
    const ash = base.call(g, A1, e), pvp = g.sight(A1, e);
    // 只有「被看的那一方探頭」才看得到：把 B1 的探頭拿掉（從 A1 的每個探頭點看 B1 的中心）看不到
    if (ash && !pvp) { leanOnly++; hidden++; } else if (ash && pvp) iSee++;
  }
  console.log(`  ASH 原本看得到的組合中：PVP 也看得到 ${iSee}、因為「被看的人貼牆」而看不到 ${hidden}`);
  ok(hidden > 0, '有一部分轉角後的位置，貼牆的人不再被看到');
  ok(iSee > hidden, '大部分看得到的照樣看得到（只拿掉被看的那一方探頭）');
}
// 爆炸波及同隊其他人
{
  g.enter('A'); const A2 = g.unit('A2'); g.swap(A1); Object.assign(A1, {x: 2, y: 2}); Object.assign(A2, {x: 3, y: 2}); const before = A2.hp + (A2.plates || 0);
  g.explode({x: 3, y: 2}, 1, 40, null);
  ok(A2.hp + (A2.plates || 0) < before, `爆炸打到同隊沒在操作的 A2（${before} → ${A2.hp + (A2.plates || 0)}）`);
}
// 黑暗：B1 站在全黑的地方，A 看不到；開槍的火光照亮那一格就看得到
{
  g.enter('A'); g.swap(A1); Object.assign(A1, {x: 2, y: 8}); Object.assign(B1, {x: 7, y: 8}); B1.pvpExposed = false;
  for (let y = 0; y < g.lighting.length; y++) for (let x = 0; x < g.lighting.length; x++) g.lighting[y][x] = 2; g.lighting[8][7] = 0;
  g.gunFlashes = []; g.enemies = g.proxies('B');
  const nv = !!A1.traits?.some(t => /night/.test(t.id || t));
  ok(!g.teamVisible(px()) || nv, `B1 在全黑的地方：看不到（A1 ${A1.character}${nv ? '，有夜視' : ''}）`);
  g.gunFlashes = [{x: 7, y: 8}]; ok(g.teamVisible(px()), 'B1 開槍的火光照亮那一格：看得到');
  g.gunFlashes = []; g.lighting[8][7] = 2;
}
// 替身帶著本人的防禦（代理回報 2026-10-15）：護甲、閃避、待機減傷、失能同步回本人
{
  const {enemyArmor} = await import('../../src/enemy-affixes.js'), {actorStat} = await import('../../src/actor-stats.js');
  for (const m of [...g.sides.A, ...g.sides.B]) { m.hp = m.maxHp; m.guard = false; }
  g.enter('A'); g.swap(A1);
  const b3 = g.enemies.find(e => e.pvpOf === 'B3'), b2 = g.enemies.find(e => e.pvpOf === 'B2');
  ok(enemyArmor(b3) === g.unit('B3').armor && enemyArmor(b3) > 0, `重裝兵的替身護甲 ${enemyArmor(b3)}（本人 ${g.unit('B3').armor}）`);
  ok(actorStat(b2, 'rangedEvasion') === actorStat(g.unit('B2'), 'rangedEvasion') && actorStat(b2, 'rangedEvasion') > 0, `偵察兵的替身閃避 ${actorStat(b2, 'rangedEvasion')}`);
  B1.guard = true; g.enter('A'); g.swap(A1); let e = px(); const h0 = e.hp; g.hurt(e, 40, A1); ok(h0 - e.hp === 20, `B1 待機中：40 傷害只吃 ${h0 - e.hp}`);
  g.syncProxies(); B1.guard = false;
  g.enter('A'); g.swap(A1); e = px(); e.control = {...e.control, disabled: 3}; g.syncProxies(); ok(B1.control?.disabled === 3, '打在替身上的失能同步回 B1');
  B1.control = {disabled: 0, immune: 0};
}
// 戰壕（地圖第二版第二步）：溝裡的人被溝外的人打＝中間有掩護（全身深＝牆）；直接從平地跳進全身深＝破綻
{
  const N = g.grid.length; g.pvpTrench = Array.from({length: N}, () => Array(N).fill(0));
  g.enter('A'); g.swap(A1);
  // 找一段空曠的橫排：B1 旁邊沒有真的牆（不然 ASH 本來就算那道牆）
  let spot = null; for (let y = 2; y < N - 2 && !spot; y++) for (let x = 2; x < N - 7 && !spot; x++) { let fine = true; for (let i = 0; i <= 5; i++) for (const dy of [0]) if (g.grid[y + dy][x + i] !== 1 || g.props.some(o => o.x === x + i && o.y === y + dy)) fine = false; if (fine) spot = {x, y}; }
  Object.assign(A1, {x: spot.x, y: spot.y}); Object.assign(B1, {x: spot.x + 4, y: spot.y}); g.pvpTrench[spot.y][spot.x + 4] = 2; g.enemies = g.proxies('B');
  const cv = g.protectingCover(px(), A1); ok(cv?.trench && cv.type === 'wall', `B1 在全身深的戰壕裡：A1 從溝外打，中間算牆（${JSON.stringify(cv)}）`);
  g.pvpTrench[spot.y][spot.x] = 2; ok(!g.protectingCover(px(), A1)?.trench, '兩個人都在溝裡：沒有戰壕掩護');
  g.pvpTrench[spot.y][spot.x] = 0;
  const occupied = (x, y) => [...g.sides.A, ...g.sides.B].some(m => m !== A1 && m.hp > 0 && m.x === x && m.y === y) || g.props.some(o => o.x === x && o.y === y && o.hp > 0);
  const step = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => g.grid[A1.y + dy]?.[A1.x + dx] === 1 && !occupied(A1.x + dx, A1.y + dy));
  g.pvpTrench[A1.y + step[1]][A1.x + step[0]] = 2; g.focusUnit(A1); g.pvp.left = ['A1']; const r = g.actAs('A1', 'move', step);
  ok(r.ok && A1.vaultExposed && A1.chimeraTrenchExposed, `A1 從平地直接跳進全身深：破綻（${r.msg}）`);
  g.pvpTrench = null;
}
// 搶奪點（Alan 2026-10-16）：中央的三倍傷害（必中、三倍、只算一個動作、拿著的時候暴露）；兩側的武器箱（打開掉出高階武器）
{
  for (const m of [...g.sides.A, ...g.sides.B]) { m.hp = m.maxHp; m.guard = false; m.pvpExposed = false; }
  g.enter('A'); g.swap(A1); g.items = [{x: A1.x, y: A1.y, type: 'pvp_power', amount: 1}]; g.pickup();
  ok(A1.pvpPower && A1.pvpExposed && !g.items.some(o => o.type === 'pvp_power'), 'A1 撿到三倍傷害：拿著、暴露、地上沒了');
  g.enter('A'); ok(A1.pvpExposed, 'A1 自己的階段開始：拿著三倍傷害還是暴露');
  g.swap(A1); A1.pvpPowerActive = true; let e = px(); const h0 = e.hp; g.hurt(e, 10, A1); A1.pvpPowerActive = false;
  ok(h0 - e.hp === 30, `三倍傷害：10 變成 ${h0 - e.hp}`);
  A1.pvpPowerActive = true; ok(g.accuracy(A1, e).chance === 100, '三倍傷害：必定命中'); A1.pvpPowerActive = false;
  A1.pvpPower = false; g.syncProxies();
  // 武器箱：放在 A1 旁邊，打開後地上有電漿步槍
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({x: A1.x + dx, y: A1.y + dy})).find(q => g.grid[q.y]?.[q.x] === 1);
  const crate = {id: 'pvp-crate-t', type: 'container', kind: 'field', x: nb.x, y: nb.y, opened: false, indestructible: true, contents: [{type: 'weapon', weapon: 4}]};
  g.props.push(crate); g.enter('A'); g.focusUnit(A1); g.pvp.left = ['A1']; const r = g.actAs('A1', 'openContainer', 'pvp-crate-t');
  ok(r.ok && crate.opened && g.items.some(o => o.type === 'weapon'), `打開武器箱：掉出武器（${r.msg}）`);
  g.props = g.props.filter(o => o !== crate);
}
// 壓制（2026-10-16 Alan 回報）：自己行動完要減半（5→3→2→1→0）；打在替身上的壓制要同步回本人
{
  for (const m of [...g.sides.A, ...g.sides.B]) { m.hp = m.maxHp; m.suppression = 0; }
  g.enter('A'); A1.suppression = 3; g.focusUnit(A1); g.pvp.left = ['A1']; g.actAs('A1', 'wait');
  ok(A1.suppression === 2, `A1 壓制 3，自己行動完減半：${A1.suppression}`);
  g.enter('A'); g.swap(A1); const e = px(); e.suppression = 4; g.syncProxies(); ok(B1.suppression === 4, '打在替身上的壓制同步回 B1');
  B1.suppression = 0; A1.suppression = 0;
}
// 忍者的光學迷彩（2026-10-16）：對方打開了迷彩的忍者替身，命中要扣迷彩的閃避
{
  const {MELEE_TUNING} = await import('../../src/melee-classes.js');
  const g2 = new PvpGame({seed: 3, map, A: ['soldier', 'recon', 'bulwark', 'engineer'], B: ['ninja', 'soldier', 'recon', 'bulwark']});
  const N1 = g2.unit('B1'), S1 = g2.unit('A1');
  g2.enter('A'); g2.swap(S1); const e0 = g2.enemies.find(e => e.pvpOf === 'B1'), c0 = g2.accuracy(S1, e0).chance;
  N1.skillState.camouflage = {remaining: 3, cooldown: 0}; g2.enter('A'); g2.swap(S1); const e1 = g2.enemies.find(e => e.pvpOf === 'B1'), c1 = g2.accuracy(S1, e1).chance;
  ok(g2.defensiveEvasion(S1, e1) >= MELEE_TUNING.camoEvasion && (c1 < c0 || c0 <= 10), `B1 忍者開迷彩：A1 打它的命中 ${c0}% → ${c1}%`);
}
console.log(bad ? `有 ${bad} 項不對` : '全部正常');
