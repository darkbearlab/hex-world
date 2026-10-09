// 奇美拉：戶外戰鬥的地圖（Alan 2026-10-09：設施地圖都不能沿用、沒有終端；先做開闊地形，公路戰之後再討論）。
// 一張 SIZE×SIZE 的開闊地：外圈是地圖邊緣，裡面全是地面；照服務單的類型擺掩體、牆（巨石、柵欄、車殼⋯）與敵人。
// 地面、物件的圖在 chimera/public/ash-outdoor/（chimera/art/outdoor-v1/pixelize.py 產生），畫法在 chimera-outdoor-render.js。
// 回傳和 ASH 的 generate（world.js）同樣的欄位，Game 照常使用；chimeraOutdoor 帶著畫面要的地面與物件編號。
import {SIZE} from './data.js';
// 地面圖集的格子（ground.png，4×4）
export const G = {sand: 0, ripple: 1, pebble: 2, sandRoad: 3, clay: 4, clay2: 5, gravel: 6, road: 7, scrub: 8, scrub2: 9, rock: 10, asphalt: 11, trench: 12, mud: 13, rubble: 14, oil: 15};
// 物件圖集的格子（props.png，4×4）
export const P = {sandbag: 0, sandbagL: 1, boulder: 2, rocks: 3, scrap: 4, tires: 5, tree: 6, wreck: 7, wire: 8, crate: 9, barrier: 10, campfire: 11, palisade: 12, fence: 13, tent: 14, nest: 15};
// 生態（策略層 sim.js 的 BIOMES）→ 地面的幾種變化、路面
const BIOME = {
  鹼海: {g: [G.clay, G.sand], road: G.road}, 鹼灘: {g: [G.clay, G.clay2, G.sand], road: G.road}, 斷崖: {g: [G.rock, G.gravel], road: G.road},
  岩山: {g: [G.rock, G.gravel, G.pebble], road: G.road}, 礫丘: {g: [G.gravel, G.pebble, G.clay], road: G.road}, 寒漠: {g: [G.gravel, G.rock], road: G.road},
  油棘林: {g: [G.scrub, G.scrub2, G.oil], road: G.road}, 旱原: {g: [G.scrub2, G.scrub, G.clay], road: G.road}, 沙海: {g: [G.sand, G.ripple, G.pebble], road: G.sandRoad},
  鹽沼: {g: [G.mud, G.clay], road: G.road}, 總督府: {g: [G.rubble, G.asphalt], road: G.asphalt},
};
// 服務單的類型 → 地圖的布局、勝利條件（kill：全滅敵人；exit：走到另一頭撤離）
export const LAYOUT = {ambush: 'road', native: 'road', intercept: 'roadblock', transit: 'road', assault: 'fort', hold: 'ring', trench: 'trench', sabotage: 'depot', probe: 'open', clear: 'camp'};
const lcg = seed => { let s = (Number(seed) >>> 0) || 1; return () => ((s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 4294967296); };

export function outdoorMap(tk, floor = 1) {
  const R = lcg((tk.seed || 1) ^ 0x5eed), pick = a => a[Math.floor(R() * a.length)], N = SIZE, mid = Math.floor(N / 2);
  const layout = LAYOUT[tk.type] || 'open', bio = BIOME[tk.biome] || BIOME[pick(Object.keys(BIOME))];
  const grid = Array.from({length: N}, (_, y) => Array.from({length: N}, (_, x) => x === 0 || y === 0 || x === N - 1 || y === N - 1 ? 0 : 1));
  const ground = Array.from({length: N}, () => Array.from({length: N}, () => R() < .7 ? bio.g[0] : pick(bio.g)));
  const wallArt = Array.from({length: N}, () => Array(N).fill(P.rocks));   // 地圖邊緣與牆格畫哪個物件
  const props = [], items = [], taken = new Set(), key = (x, y) => `${x},${y}`;
  const inside = (x, y) => x > 0 && y > 0 && x < N - 1 && y < N - 1;
  const free = (x, y) => inside(x, y) && grid[y][x] === 1 && !taken.has(key(x, y));
  const wall = (x, y, art) => { if (!free(x, y)) return; grid[y][x] = 0; wallArt[y][x] = art; taken.add(key(x, y)); };
  const cover = (x, y, art, hp = 70) => { if (!free(x, y)) return; props.push({id: `${floor}-oc-${props.length}`, x, y, type: 'cover', hp, maxHp: hp, chimeraArt: art}); taken.add(key(x, y)); };
  const start = {x: mid, y: N - 3}, end = {x: mid, y: 2};
  const reserve = (p, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) taken.add(key(p.x + dx, p.y + dy)); };
  const spots = [];   // 敵人的站位
  const road = () => { for (let y = 1; y < N - 1; y++) for (let x = mid - 2; x <= mid + 2; x++) ground[y][x] = bio.road; };
  const scatter = (n, arts, asWall = false, area = () => ({x: 1 + Math.floor(R() * (N - 2)), y: 1 + Math.floor(R() * (N - 2))})) => {
    for (let i = 0; i < n * 3 && n > 0; i++) { const p = area(); if (!free(p.x, p.y)) continue; asWall ? wall(p.x, p.y, pick(arts)) : cover(p.x, p.y, pick(arts)); n--; }
  };
  reserve(start, 2);
  if (layout === 'road' || layout === 'roadblock') {
    road(); reserve(end, 1);
    const side = () => R() < .5 ? 1 + Math.floor(R() * (mid - 4)) : mid + 4 + Math.floor(R() * (mid - 4));
    scatter(10, [P.boulder, P.wreck, P.tree], true, () => ({x: side(), y: 2 + Math.floor(R() * (N - 4))}));
    scatter(12, [P.tires, P.crate, P.rocks, P.sandbag], false, () => ({x: side(), y: 2 + Math.floor(R() * (N - 4))}));
    if (layout === 'roadblock') { const y = 7; for (let x = mid - 3; x <= mid + 3; x++) (x === mid - 3 || x === mid + 3) ? wall(x, y, P.scrap) : cover(x, y, x % 2 ? P.barrier : P.scrap, 90); for (let x = mid - 3; x <= mid + 3; x++) spots.push({x, y: y - 2}, {x, y: y - 3}); }
    for (let y = 4; y < N - 8; y++) spots.push({x: 1 + Math.floor(R() * (mid - 5)), y}, {x: mid + 5 + Math.floor(R() * (mid - 6)), y});
  } else if (layout === 'fort') {
    // 敵方陣地在上半：一圈沙包、機槍座、後面有帳棚
    const c = {x: mid, y: 7};
    for (let a = 0; a < 24; a++) { const t = a / 24 * Math.PI * 2, x = Math.round(c.x + Math.cos(t) * 4), y = Math.round(c.y + Math.sin(t) * 3); if (y > c.y - 1 && Math.abs(x - c.x) < 2) continue; cover(x, y, pick([P.sandbag, P.sandbag, P.nest]), 90); }
    for (const dx of [-2, 0, 2]) wall(c.x + dx, c.y - 2, P.tent);
    for (let y = c.y - 2; y <= c.y + 2; y++) for (let x = c.x - 3; x <= c.x + 3; x++) spots.push({x, y});
    scatter(12, [P.boulder, P.rocks, P.wreck], true, () => ({x: 1 + Math.floor(R() * (N - 2)), y: 12 + Math.floor(R() * (N - 16))}));
    scatter(10, [P.tires, P.crate, P.sandbag]);
  } else if (layout === 'ring') {
    // 守點：我方在中間的沙包圈，敵人從四周來
    start.y = mid + 1; const c = {x: mid, y: mid};
    for (let a = 0; a < 28; a++) { const t = a / 28 * Math.PI * 2; cover(Math.round(c.x + Math.cos(t) * 4), Math.round(c.y + Math.sin(t) * 4), pick([P.sandbag, P.sandbagL, P.nest]), 90); }
    end.x = mid; end.y = mid;
    scatter(16, [P.boulder, P.rocks, P.tree, P.wreck], true, () => { const t = R() * Math.PI * 2, r = 7 + R() * 5; return {x: Math.round(c.x + Math.cos(t) * r), y: Math.round(c.y + Math.sin(t) * r)}; });
    for (let i = 1; i < N - 1; i++) spots.push({x: i, y: 2}, {x: i, y: N - 3}, {x: 2, y: i}, {x: N - 3, y: i});
  } else if (layout === 'trench') {
    // 戰壕：上方一道敵方壕溝（泥地＋前緣沙包），中間一排鐵絲網
    for (let x = 1; x < N - 1; x++) for (let y = 5; y <= 7; y++) ground[y][x] = G.trench;
    for (let x = 1; x < N - 1; x++) if (x % 5 !== 2) cover(x, 8, P.sandbag, 100);
    for (let x = 2; x < N - 2; x++) if (x % 4 !== 0) cover(x, 13, P.wire, 60);
    for (let x = 2; x < N - 2; x += 6) wall(x, 4, P.nest);
    for (let x = 1; x < N - 1; x++) for (let y = 5; y <= 7; y++) spots.push({x, y});
    scatter(8, [P.rocks, P.boulder, P.wreck], true, () => ({x: 1 + Math.floor(R() * (N - 2)), y: 15 + Math.floor(R() * (N - 19))}));
    for (let y = 15; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if (R() < .25) ground[y][x] = G.mud;
  } else if (layout === 'depot') {
    // 車場：中間一片車殼、帳棚、油料（夜間），巡邏散在四周
    for (let i = 0; i < 9; i++) wall(mid - 6 + (i % 3) * 6, 5 + Math.floor(i / 3) * 4, pick([P.wreck, P.wreck, P.tent]));
    for (let y = 4; y <= 14; y++) for (let x = mid - 7; x <= mid + 7; x++) if (R() < .5) ground[y][x] = G.oil;
    scatter(14, [P.crate, P.tires, P.barrier]);
    for (let y = 3; y < 16; y++) for (let x = 2; x < N - 2; x++) if (R() < .1) spots.push({x, y});
  } else if (layout === 'camp') {
    // 據點清剿：木柵或鐵皮圍起來的營地，南邊留門；裡面帳棚、營火，頭目在裡面
    const c = {x: mid, y: 8}, w = 7, h = 5, art = R() < .5 ? P.palisade : P.fence;
    for (let x = c.x - w; x <= c.x + w; x++) { wall(x, c.y - h, art); if (Math.abs(x - c.x) > 1) wall(x, c.y + h, art); }
    for (let y = c.y - h; y <= c.y + h; y++) { wall(c.x - w, y, art); wall(c.x + w, y, art); }
    for (const [dx, dy] of [[-4, -2], [4, -2], [-4, 2], [4, 2]]) wall(c.x + dx, c.y + dy, P.tent);
    cover(c.x, c.y, P.campfire, 200);
    for (let y = c.y - h + 1; y < c.y + h; y++) for (let x = c.x - w + 1; x < c.x + w; x++) spots.push({x, y});
    scatter(12, [P.boulder, P.rocks, P.tree], true, () => ({x: 1 + Math.floor(R() * (N - 2)), y: 15 + Math.floor(R() * (N - 18))}));
    scatter(8, [P.tires, P.crate, P.scrap]);
  } else {
    // 開闊地（巡邏遭遇）：零散的岩石和樹，敵人在中段
    scatter(18, [P.boulder, P.rocks, P.tree], true); scatter(12, [P.rocks, P.tires, P.crate]);
    for (let y = 3; y < 13; y++) for (let x = 2; x < N - 2; x++) if (R() < .15) spots.push({x, y});
  }
  // 補給：幾個彈藥、醫療包、手榴彈散在地上
  for (const [type, amount] of [['ammo', 60], ['med', 1], ['grenade', 1], ['ammo', 40]]) for (let i = 0; i < 30; i++) {
    const x = 2 + Math.floor(R() * (N - 4)), y = 3 + Math.floor(R() * (N - 8)); if (!free(x, y)) continue; items.push({x, y, type, amount, floor}); taken.add(key(x, y)); break;
  }
  const footprint = []; for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) footprint.push({x, y});
  const room = {x: 1, y: 1, w: N - 2, h: N - 2, cx: mid, cy: mid, id: 0, cellIds: [0], footprint};
  const light = grid.map(row => row.map(() => tk.night ? 0 : 1));
  const enemySpots = spots.filter(p => free(p.x, p.y) && Math.max(Math.abs(p.x - start.x), Math.abs(p.y - start.y)) >= 6);
  return {map: {grid, rooms: [room], start, end, startRoom: 0, endRoom: 0, links: [], mainRoute: [0], rewardRooms: [], enemies: [], items, props, hazards: [], marks: [], barriers: [],
    cells: [{id: 0, row: 0, col: 0, roomId: 0}], openings: [], annexes: [], generation: {version: 1, recipeId: 'chimera-outdoor-v1'}, lighting: light, slots: [], lamps: [], lightModel: 2},
    spots: enemySpots, outdoor: {layout, goal: tk.type === 'transit' ? 'exit' : layout === 'ring' ? 'hold' : 'kill', holdTurns: 30, ground, wallArt, night: !!tk.night}};   // hold：撐過 holdTurns 回合（或清光）
}
