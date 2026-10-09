// 奇美拉：戶外戰鬥的地圖（Alan 2026-10-09：設施地圖都不能沿用、沒有終端；先做開闊地形，公路戰之後再討論）。
// 一張 SIZE×SIZE 的開闊地：外圈是地圖邊緣（畫成塵霧，不是牆或石頭），裡面全是地面；照服務單的類型擺牆、矮牆、掩體、戰壕與敵人。
// - 牆：ASH 的牆格（grid 0），照 ASH 原本的「牆面＋牆頂」畫，材質由地圖風格決定（磚、土坯、石、廢鐵；chimera-outdoor-render.js 註冊）。
// - 木柵、鐵皮、路障：ASH 放在格子之間的矮牆（barriers 的 low_partition：擋路、給掩護、不擋視線，可以翻越）。
// - 掩體：ASH 的 cover（暫時照 ASH 原本的畫法；Alan：先不要套用現在的戰場裝飾物）。
// - 戰壕：特殊地形（像煙霧那樣的一層格子），全身（2）與半身（1）兩種，規則在 chimera-mission.js。
// 回傳和 ASH 的 generate（world.js）同樣的欄位，Game 照常使用；chimeraOutdoor 帶著畫面與規則要的東西。
import {SIZE} from './data.js';
// 地面圖集的格子（ground.png，4×4）
export const G = {sand: 0, ripple: 1, pebble: 2, sandRoad: 3, clay: 4, clay2: 5, gravel: 6, road: 7, scrub: 8, scrub2: 9, rock: 10, asphalt: 11, trench: 12, mud: 13, rubble: 14, oil: 15};
// 生態（策略層 sim.js 的 BIOMES）→ 地面的幾種變化、路面、牆的材質
const BIOME = {
  鹼海: {g: [G.clay, G.sand], road: G.road, wall: 'adobe'}, 鹼灘: {g: [G.clay, G.clay2, G.sand], road: G.road, wall: 'adobe'}, 斷崖: {g: [G.rock, G.gravel], road: G.road, wall: 'stone'},
  岩山: {g: [G.rock, G.gravel, G.pebble], road: G.road, wall: 'stone'}, 礫丘: {g: [G.gravel, G.pebble, G.clay], road: G.road, wall: 'stone'}, 寒漠: {g: [G.gravel, G.rock], road: G.road, wall: 'stone'},
  油棘林: {g: [G.scrub, G.scrub2, G.oil], road: G.road, wall: 'scrap'}, 旱原: {g: [G.scrub2, G.scrub, G.clay], road: G.road, wall: 'adobe'}, 沙海: {g: [G.sand, G.ripple, G.pebble], road: G.sandRoad, wall: 'adobe'},
  鹽沼: {g: [G.mud, G.clay], road: G.road, wall: 'adobe'}, 總督府: {g: [G.rubble, G.asphalt], road: G.asphalt, wall: 'brick'},
};
// 服務單的類型 → 地圖的布局
export const LAYOUT = {ambush: 'road', native: 'road', intercept: 'roadblock', transit: 'road', assault: 'fort', hold: 'ring', trench: 'trench', sabotage: 'depot', probe: 'open', clear: 'camp'};
const lcg = seed => { let s = (Number(seed) >>> 0) || 1; return () => ((s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 4294967296); };

export function outdoorMap(tk, floor = 1) {
  const R = lcg((tk.seed || 1) ^ 0x5eed), pick = a => a[Math.floor(R() * a.length)], N = SIZE, mid = Math.floor(N / 2);
  const layout = LAYOUT[tk.type] || 'open', bio = BIOME[tk.biome] || BIOME[pick(Object.keys(BIOME))];
  const grid = Array.from({length: N}, (_, y) => Array.from({length: N}, (_, x) => x === 0 || y === 0 || x === N - 1 || y === N - 1 ? 0 : 1));
  const ground = Array.from({length: N}, () => Array.from({length: N}, () => R() < .7 ? bio.g[0] : pick(bio.g)));
  const trench = Array.from({length: N}, () => Array(N).fill(0));   // 戰壕：0 平地、1 半身、2 全身
  const props = [], items = [], barriers = [], taken = new Set(), key = (x, y) => `${x},${y}`;
  const inside = (x, y) => x > 0 && y > 0 && x < N - 1 && y < N - 1;
  const free = (x, y) => inside(x, y) && grid[y][x] === 1 && !taken.has(key(x, y));
  const wall = (x, y) => { if (!free(x, y)) return false; grid[y][x] = 0; taken.add(key(x, y)); return true; };
  const cover = (x, y, hp = 70) => { if (!free(x, y)) return; props.push({id: `${floor}-oc-${props.length}`, x, y, type: 'cover', hp, maxHp: hp}); taken.add(key(x, y)); };
  // 格子之間的矮牆：axis 'y' 是 (x,y) 與 (x,y+1) 之間的橫邊；axis 'x' 是 (x,y) 與 (x+1,y) 之間的直邊
  const edges = new Set();
  const low = (x, y, axis) => { const b = axis === 'y' ? {axis, x, y: y + .5} : {axis, x: x + .5, y}, k = `${b.axis}:${b.x},${b.y}`; if (edges.has(k)) return; edges.add(k);
    barriers.push({id: `${floor}-low-${barriers.length}`, type: 'low_partition', ...b, hp: 60, maxHp: 60}); };
  // 一段短牆（2～4 格，直的或 L 形）
  const wallRun = (x, y) => { const n = 2 + Math.floor(R() * 3), h = R() < .5; let ok = 0;
    for (let i = 0; i < n; i++) if (wall(h ? x + i : x, h ? y : y + i)) ok++;
    if (ok > 1 && R() < .3) wall(h ? x : x + 1, h ? y + 1 : y); };
  const start = {x: mid, y: N - 3}, end = {x: mid, y: 2};
  const reserve = (p, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) taken.add(key(p.x + dx, p.y + dy)); };
  const spots = [];   // 敵人的站位
  const road = () => { for (let y = 1; y < N - 1; y++) for (let x = mid - 2; x <= mid + 2; x++) ground[y][x] = bio.road; };
  const area = (x0, x1, y0, y1) => () => ({x: x0 + Math.floor(R() * (x1 - x0 + 1)), y: y0 + Math.floor(R() * (y1 - y0 + 1))});
  const walls = (n, at) => { for (let i = 0; i < n * 3 && n > 0; i++) { const p = at(); if (!free(p.x, p.y)) continue; wallRun(p.x, p.y); n--; } };
  const covers = (n, at) => { for (let i = 0; i < n * 3 && n > 0; i++) { const p = at(); if (!free(p.x, p.y)) continue; cover(p.x, p.y); n--; } };
  const any = area(1, N - 2, 1, N - 2);
  reserve(start, 2);
  if (layout === 'road' || layout === 'roadblock') {
    road(); reserve(end, 1);
    for (let y = 1; y < N - 1; y++) for (let x = mid - 2; x <= mid + 2; x++) taken.add(key(x, y));   // 路面保持暢通
    const side = () => R() < .5 ? area(1, mid - 4, 2, N - 4)() : area(mid + 4, N - 2, 2, N - 4)();
    walls(6, side); covers(10, side);
    if (layout === 'roadblock') {   // 路障：橫越路面的一排矮牆，敵人在後面
      for (let x = mid - 3; x <= mid + 3; x++) low(x, 7, 'y');
      for (let x = mid - 3; x <= mid + 3; x++) spots.push({x, y: 5}, {x, y: 6});
    }
    for (let y = 4; y < N - 8; y++) spots.push(area(1, mid - 5, y, y)(), area(mid + 5, N - 2, y, y)());
  } else if (layout === 'fort') {
    // 突擊：敵方陣地在上半，一圈掩體、後面幾段牆
    const c = {x: mid, y: 7};
    for (let a = 0; a < 24; a++) { const t = a / 24 * Math.PI * 2, x = Math.round(c.x + Math.cos(t) * 4), y = Math.round(c.y + Math.sin(t) * 3); if (y > c.y && Math.abs(x - c.x) < 2) continue; cover(x, y, 90); }
    for (const dx of [-3, 2]) { wall(c.x + dx, c.y - 2); wall(c.x + dx + 1, c.y - 2); }
    for (let y = c.y - 2; y <= c.y + 2; y++) for (let x = c.x - 3; x <= c.x + 3; x++) spots.push({x, y});
    walls(7, area(1, N - 2, 13, N - 5)); covers(10, area(1, N - 2, 12, N - 4));
  } else if (layout === 'ring') {
    // 守點：我方在中間的掩體圈，敵人從四周來
    start.y = mid + 1; end.x = mid; end.y = mid; const c = {x: mid, y: mid};
    for (let a = 0; a < 28; a++) { const t = a / 28 * Math.PI * 2; cover(Math.round(c.x + Math.cos(t) * 4), Math.round(c.y + Math.sin(t) * 4), 90); }
    walls(9, () => { const t = R() * Math.PI * 2, r = 7 + R() * 5; return {x: Math.round(c.x + Math.cos(t) * r), y: Math.round(c.y + Math.sin(t) * r)}; });
    for (let i = 1; i < N - 1; i++) spots.push({x: i, y: 2}, {x: i, y: N - 3}, {x: 2, y: i}, {x: N - 3, y: i});
  } else if (layout === 'trench') {
    // 戰壕：上方一道敵方壕溝（兩排全身格），前後每隔幾格有半身的出入口；中間一排矮牆（鐵絲網）
    for (let x = 1; x < N - 1; x++) for (const y of [5, 6]) { trench[y][x] = 2; ground[y][x] = G.trench; }
    for (let x = 2; x < N - 2; x++) if (x % 6 === 2 || x % 6 === 3) { trench[4][x] = 1; trench[7][x] = 1; ground[4][x] = G.mud; ground[7][x] = G.mud; }
    for (let x = 2; x < N - 2; x++) if (x % 5 !== 0) low(x, 12, 'y');
    for (let x = 1; x < N - 1; x++) for (const y of [5, 6]) spots.push({x, y});
    // 我方這邊也有一道淺壕（半身），可以躲
    for (let x = 3; x < N - 3; x++) if (x % 7 !== 0) { trench[N - 6][x] = 1; ground[N - 6][x] = G.mud; }
    walls(4, area(1, N - 2, 14, N - 8));
  } else if (layout === 'depot') {
    // 車場（夜間）：中間幾棟棚子（短牆）、油污地，巡邏散在四周
    for (let i = 0; i < 6; i++) { const x = mid - 7 + (i % 3) * 6, y = 5 + Math.floor(i / 3) * 5; for (let dx = 0; dx < 3; dx++) wall(x + dx, y); }
    for (let y = 4; y <= 14; y++) for (let x = mid - 8; x <= mid + 8; x++) if (R() < .45) ground[y][x] = G.oil;
    covers(12, area(2, N - 3, 3, 16));
    for (let y = 3; y < 16; y++) for (let x = 2; x < N - 2; x++) if (R() < .1) spots.push({x, y});
  } else if (layout === 'camp') {
    // 據點清剿：木柵或鐵皮圍起來的營地（矮牆圍一圈，南邊留門），裡面幾段牆當棚屋，頭目在裡面
    const c = {x: mid, y: 8}, w = 7, h = 5;
    for (let x = c.x - w; x <= c.x + w; x++) { low(x, c.y - h - 1, 'y'); if (Math.abs(x - c.x) > 1) low(x, c.y + h, 'y'); }
    for (let y = c.y - h; y <= c.y + h; y++) { low(c.x - w - 1, y, 'x'); low(c.x + w, y, 'x'); }
    for (const [dx, dy] of [[-4, -3], [3, -3], [-4, 2], [3, 2]]) { wall(c.x + dx, c.y + dy); wall(c.x + dx + 1, c.y + dy); }
    cover(c.x, c.y, 200);
    for (let y = c.y - h; y <= c.y + h; y++) for (let x = c.x - w; x <= c.x + w; x++) spots.push({x, y});
    walls(6, area(1, N - 2, 16, N - 5)); covers(8, area(1, N - 2, 15, N - 4));
  } else {
    // 開闊地（巡邏遭遇）：零散的短牆與掩體，敵人在中段
    walls(9, any); covers(12, any);
    for (let y = 3; y < 13; y++) for (let x = 2; x < N - 2; x++) if (R() < .15) spots.push({x, y});
  }
  // 補給：幾個彈藥、醫療包、手榴彈散在地上
  for (const [type, amount] of [['ammo', 60], ['med', 1], ['grenade', 1], ['ammo', 40]]) for (let i = 0; i < 30; i++) {
    const x = 2 + Math.floor(R() * (N - 4)), y = 3 + Math.floor(R() * (N - 8)); if (!free(x, y) || trench[y][x]) continue; items.push({x, y, type, amount, floor}); taken.add(key(x, y)); break;
  }
  const footprint = []; for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) footprint.push({x, y});
  const room = {x: 1, y: 1, w: N - 2, h: N - 2, cx: mid, cy: mid, id: 0, cellIds: [0], footprint};
  const light = grid.map(row => row.map(() => tk.night ? 0 : 1));
  const enemySpots = spots.filter(p => free(p.x, p.y) && Math.max(Math.abs(p.x - start.x), Math.abs(p.y - start.y)) >= 6);
  // 地圖風格：牆的材質照生態；矮牆照布局（營地：原住民木柵、其他鐵皮）
  const lowArt = layout === 'camp' && tk.enemy?.units && Object.keys(tk.enemy.units).some(k => k.startsWith('native')) ? 'palisade' : layout === 'trench' ? 'palisade' : 'fence';
  return {map: {grid, rooms: [room], start, end, startRoom: 0, endRoom: 0, links: [], mainRoute: [0], rewardRooms: [], enemies: [], items, props, hazards: [], marks: [], barriers,
    cells: [{id: 0, row: 0, col: 0, roomId: 0}], openings: [], annexes: [], generation: {version: 2, recipeId: 'chimera-outdoor-v2'}, lighting: light, slots: [], lamps: [], lightModel: 2},
    spots: enemySpots, style: `chimera-${bio.wall}-${lowArt}`,
    outdoor: {layout, biome: tk.biome || '', goal: tk.type === 'transit' ? 'exit' : layout === 'ring' ? 'hold' : 'kill', holdTurns: 30, ground, trench, night: !!tk.night}};   // hold：撐過 holdTurns 回合（或清光）
}
