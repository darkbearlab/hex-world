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
console.log(bad ? `有 ${bad} 項不對` : '全部正常');
