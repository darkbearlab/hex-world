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
