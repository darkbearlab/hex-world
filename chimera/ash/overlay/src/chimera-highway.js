// 奇美拉：公路戰的地圖（Alan 2026-10-09，warband/DESIGN.md「公路戰」）——先做接舷戰。
// 畫面由右往左開：我方在中間一台 5×15 的大卡車上，敵方的卡車並排靠上來（北邊一台；人多再加南邊一台），車欄相接。
// - 車斗：地板格；deck[y][x] 是哪一台車（1 我方，2、3 敵方），其餘是路面。路面不能走（MissionGame.passable），被炸、被推下車就是摔死。
// - 車頭（車斗左邊）：ASH 的牆格，用廢鐵的牆面畫。
// - 車欄：車斗四周 ASH 放在格子之間的矮牆（可翻越、給掩護、不擋視線）。兩台車相接的那一段就是接舷的地方：
//   翻過去吃翻越的破綻＋3 層壓制（和戰壕平地直接跳全身格一樣，chimera-mission.js deckStep）。
// - 車上的貨箱是掩體。
// - 「在開」只是畫面：路面往右捲（chimera-outdoor-render.js），規則上大家都在卡車的座標裡。
// 回傳的欄位和 outdoorMap 一樣。
import {SIZE} from './data.js';

export function highwayMap(tk, floor, R, bio, G) {
  const N = SIZE, pick = a => a[Math.floor(R() * a.length)];
  const grid = Array.from({length: N}, (_, y) => Array.from({length: N}, (_, x) => x === 0 || y === 0 || x === N - 1 || y === N - 1 ? 0 : 1));
  const ground = Array.from({length: N}, () => Array.from({length: N}, () => R() < .8 ? bio.road : pick(bio.g)));
  const trench = Array.from({length: N}, () => Array(N).fill(0)), deck = Array.from({length: N}, () => Array(N).fill(0));
  const props = [], items = [], barriers = [], edges = new Set(), taken = new Set(), key = (x, y) => `${x},${y}`;
  const low = (x, y, axis) => { const b = axis === 'y' ? {axis, x, y: y + .5} : {axis, x: x + .5, y}, k = `${b.axis}:${b.x},${b.y}`; if (edges.has(k)) return; edges.add(k);
    barriers.push({id: `${floor}-rail-${barriers.length}`, type: 'low_partition', ...b, hp: 80, maxHp: 80}); };
  const roster = (tk.enemy?.roster?.length) || Object.values(tk.enemy?.units || {}).reduce((x, y) => x + y, 0);
  // 三台車：我方在中間，敵方北邊一台，人多（超過 8 個）再加南邊一台。x0..x1 是車斗，車頭在 x0 左邊兩格
  const trucks = [{id: 1, y0: 11, x0: 6, x1: 20}, {id: 2, y0: 6, x0: 8 + Math.floor(R() * 3), x1: 21}];
  if (roster > 8) trucks.push({id: 3, y0: 16, x0: 9 + Math.floor(R() * 2), x1: 20});
  for (const T of trucks) {
    for (let y = T.y0; y < T.y0 + 5; y++) for (let x = T.x0; x <= T.x1; x++) deck[y][x] = T.id;
    for (let y = T.y0 + 1; y < T.y0 + 4; y++) for (const x of [T.x0 - 2, T.x0 - 1]) { grid[y][x] = 0; taken.add(key(x, y)); }   // 車頭
  }
  // 車欄：車斗的每一條外緣（車頭那一側不用）
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    if (!deck[y][x]) continue;
    if (deck[y - 1][x] !== deck[y][x]) low(x, y - 1, 'y');
    if (deck[y + 1][x] !== deck[y][x]) low(x, y, 'y');
    if (deck[y][x - 1] !== deck[y][x] && grid[y][x - 1] === 1) low(x - 1, y, 'x');
    if (deck[y][x + 1] !== deck[y][x]) low(x, y, 'x');
  }
  // 貨箱（掩體）：每台車幾個，不放在接舷那一排，也不擋住出生點
  const start = {x: 12, y: 13}; taken.add(key(start.x, start.y));
  for (const T of trucks) {
    const n = T.id === 1 ? 5 : 4;
    for (let i = 0, put = 0; i < 40 && put < n; i++) {
      const x = T.x0 + 1 + Math.floor(R() * (T.x1 - T.x0 - 1)), y = T.y0 + 1 + Math.floor(R() * 3);
      if (taken.has(key(x, y)) || Math.abs(x - start.x) + Math.abs(y - start.y) < 2) continue;
      props.push({id: `${floor}-crate-${props.length}`, x, y, type: 'cover', hp: 90, maxHp: 90}); taken.add(key(x, y)); put++;
    }
  }
  // 補給：我方車上一些彈藥、一個醫療包
  for (const [type, amount] of [['ammo', 60], ['med', 1], ['ammo', 40]]) for (let i = 0; i < 30; i++) {
    const x = 7 + Math.floor(R() * 13), y = 11 + Math.floor(R() * 5); if (taken.has(key(x, y))) continue; items.push({x, y, type, amount, floor}); taken.add(key(x, y)); break;
  }
  // 敵人的站位：敵方的車斗
  const spots = [];
  for (const T of trucks.slice(1)) for (let y = T.y0; y < T.y0 + 5; y++) for (let x = T.x0; x <= T.x1; x++) if (!taken.has(key(x, y))) spots.push({x, y});
  const footprint = []; for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) footprint.push({x, y});
  const room = {x: 1, y: 1, w: N - 2, h: N - 2, cx: 13, cy: 13, id: 0, cellIds: [0], footprint};
  const light = grid.map(row => row.map(() => tk.night ? 0 : 1));
  return {map: {grid, rooms: [room], start, end: {x: 7, y: 13}, startRoom: 0, endRoom: 0, links: [], mainRoute: [0], rewardRooms: [], enemies: [], items, props, hazards: [], marks: [], barriers,
    cells: [{id: 0, row: 0, col: 0, roomId: 0}], openings: [], annexes: [], generation: {version: 2, recipeId: 'chimera-highway-v1'}, lighting: light, slots: [], lamps: [], lightModel: 2},
    spots, style: 'chimera-scrap-fence',
    // drive：撐過 holdTurns 回合（開到目的地）或清光
    outdoor: {layout: 'highway', biome: tk.biome || '', goal: 'drive', holdTurns: 20, ground, trench, deck, trucks, night: !!tk.night}};
}
