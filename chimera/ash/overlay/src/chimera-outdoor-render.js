// 奇美拉：戶外戰鬥的畫法（chimera-outdoor.js 產生的地圖）。不改 ASH 的檔案：
//   - 地圖風格：在 ASH 的 MAP_STYLES 註冊「chimera-<牆>-<矮牆>」幾種風格，牆照 ASH 原本的「牆面＋牆頂」組合畫，矮牆（木柵、鐵皮）照
//     ASH 的矮隔板畫，用的是 /ash-outdoor/walls.png（chimera/art/outdoor-v1）。掩體、補給箱等先照 ASH 原本的圖。
//   - 地面：terrain('floor') 照 game.chimeraOutdoor.ground 畫地面圖集（每格不同的花樣）；戰壕格加暗邊。
//   - 地圖邊緣：外圈的牆格畫成塵霧地面（不是牆、不是石頭；Alan 2026-10-09）。
//   - 撤離點：綠色的信號（行軍遇襲才用得到）。
import {Renderer} from './renderer.js';
import {MAP_STYLES} from './map-styles.js';
import {TERRAIN_ATLAS} from './materials.js';
import {SIZE} from './data.js';
import {isDark,isBlack,seesInDark} from './lighting.js';

const URL = {ground: '/ash-outdoor/ground.png', walls: '/ash-outdoor/walls.png', trench: '/ash-outdoor/trench.png', truck: '/ash-outdoor/truck.png', cab: '/ash-outdoor/cab.png'};
const img = src => { const i = new Image(); i.src = src; return i; };
const ATLAS = {ground: img(URL.ground), walls: img(URL.walls), trench: img(URL.trench), truck: img(URL.truck), cab: img(URL.cab)};
const ready = i => i.complete && i.naturalWidth > 0;
// walls.png 的格子：牆面 0～3（磚、土坯、石、廢鐵）、牆頂 4～7、木柵面 8／頂 9、鐵皮面 10／頂 11、邊緣塵霧 12、沙包面 13／頂 14、瓦礫 15
const WALL = {brick: 0, adobe: 1, stone: 2, scrap: 3}, LOW = {palisade: 8, fence: 10}, HAZE = 12;
const W = index => ({url: URL.walls, index}), T = index => ({url: TERRAIN_ATLAS, index});
// truck.png（公路戰）：車斗 0 花紋鋼板／1 磨損鋼板／2 木板貨台／3 鏽鐵車斗、車頭 4 車頂／5 車側／6 鏽鐵車頂／7 鏽鐵車側、
// 車欄 8 正面／9 上緣／10 鏽鐵正面／11 鏽鐵上緣、路面 12 柏油／13 黃虛線／14 輪胎／15 路邊積沙
const TR = index => ({url: URL.truck, index});
function registerStyles() {
  const facility = MAP_STYLES.facility;
  MAP_STYLES['chimera-truck'] = {themes: facility.themes, selection: facility.selection,
    materials: {floor: TR(0), face: TR(5), cap: TR(4), partitionFace: TR(5), partitionCap: TR(4), lowFace: TR(8), lowCap: TR(9), cover: T(10), barrel: T(11), terminal: T(12), case: T(13), grate: T(1)}};
  for (const [wall, wi] of Object.entries(WALL)) for (const [low, li] of Object.entries(LOW)) MAP_STYLES[`chimera-${wall}-${low}`] = {themes: facility.themes, selection: facility.selection,
    materials: {floor: W(15), face: W(wi), cap: W(wi + 4), partitionFace: W(wi), partitionCap: W(wi + 4), lowFace: W(li), lowCap: W(li + 1), cover: T(10), barrel: T(11), terminal: T(12), case: T(13), grate: T(1)}};
}
function blit(c, atlas, n, cx, cy, size) {
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(atlas, (n % 4) * 32, Math.floor(n / 4) * 32, 32, 32, Math.round(cx - size / 2), Math.round(cy - size / 2), size, size);
  c.restore();
}
const edge = (x, y) => x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1;
// 戰壕下沉（Alan 2026-10-09）：全身格下沉半格、半身格下沉四分之一格（像 ASH 的牆高反過來）。溝的北側露出斷面（貼斷面材質），
// 溝底貼溝底材質；站在溝裡的人也跟著往下畫。trench.png：斷面 0 沙／1 黏土／2 岩／3 泥土、護壁 4 木板／5 枝條／6 鐵皮／7 沙包、
// 8 濕泥／9 鹽殼／10 瓦礫／11 油土；溝底 12 踏板／13 泥／14 水坑／15 碎石
export const TRENCH_DEPTH = [0, .25, .5];
const CUT = {沙海: 0, 鹼海: 0, 鹼灘: 1, 旱原: 1, 岩山: 2, 斷崖: 2, 礫丘: 2, 寒漠: 2, 油棘林: 11, 鹽沼: 9, 總督府: 10};
// 牆跟著黑暗壓暗（Alan 2026-10-09：新做的牆沒有被黑暗規則一起壓暗）：ASH 只在地板上疊暗色，牆是後畫的；照那一格的明暗疊同樣的顏色
function darkWall(r, x, y, rect) {
  const g = r.game, c = r.ctx, p = {x, y};
  const color = isBlack(g, p) && !seesInDark(g, g.player) ? '#020409e0' : isDark(g, p) ? '#060c22a6' : null;
  if (!color) return;
  c.save(); c.globalAlpha = 1; c.fillStyle = color; c.fillRect(rect.left, rect.top, rect.width, rect.height); c.restore();
}

// 公路戰（Alan 2026-10-09）：車斗（我方花紋鋼板、敵方鏽鐵或木板）、路面往右捲（由右往左開）、車斗下緣的車底陰影與輪子；圖在 truck.png
const ROAD_SPEED = 10;   // 每秒捲幾格（Alan 2026-10-09：加快一倍）
function road(r, o, p, a, t) {
  const c = r.ctx, l = Math.round(a.x - t / 2), tp = Math.round(a.y - t / 2), n = o.ground[p.y]?.[p.x] ?? 0;   // 車外是沙漠（ground.png）
  const off = Math.round(((r.time || performance.now()) / 1000 * ROAD_SPEED % 1) * t);
  c.save(); c.beginPath(); c.rect(l, tp, t, t); c.clip(); c.imageSmoothingEnabled = false;
  for (const dx of [off - t, off]) c.drawImage(ATLAS.ground, (n % 4) * 32, Math.floor(n / 4) * 32, 32, 32, l + dx, tp, t, t);
  // 車斗正下方的那一格：車底的陰影與輪子（不跟著捲）
  const up = o.deck[p.y - 1]?.[p.x];
  if (up) { c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(l, tp, t, Math.round(t * .4)); const T = o.trucks.find(q => q.id === up);
    if (T && [T.x0 + 1, T.x0 + 2, T.x1 - 3, T.x1 - 2].includes(p.x)) c.drawImage(ATLAS.truck, 2 * 32 + 9, 3 * 32 + ((off >> 1) % 8), 14, 12, l + Math.round(t * .12), tp, Math.round(t * .76), Math.round(t * .42)); }
  c.restore();
}
function highwayFloor(r, o, p, a, t) {
  const id = o.deck[p.y][p.x];
  if (!id) return road(r, o, p, a, t);
  blit(r.ctx, ATLAS.truck, id === 1 ? ((p.x * 7 + p.y * 3) % 5 ? 0 : 1) : o.enemyDeck ?? 3, a.x, a.y, t);
}
// 車頭（牆格，2×3 格）：照 ASH 的牆，車頂往上抬半格（WALL_HEIGHT），最下面一排露出車側（Alan 2026-10-09：車頭側面也做一組）。
// cab.png：車頂 (0,0) 我方橄欖綠、(64,0) 敵方鏽鐵，各 64×96；車側 y 96 起每條 64×16（橄欖綠 ×2、鏽鐵 ×2）
const CAB_LIFT = .5;
function cab(r, o, x, y, a, t) {
  const T = o.trucks.find(q => y >= (q.c0 ?? q.y0 + 1) && y < (q.c0 ?? q.y0 + 1) + 3 && (x === q.x0 - 1 || x === q.x0 - 2));
  road(r, o, {x, y}, a, t);   // 車頭底下（斜角、尖刺之間透出來的）是路面
  if (!T || !ready(ATLAS.cab)) { blit(r.ctx, ATLAS.truck, T?.id === 1 ? 4 : 6, a.x, a.y, t); return; }
  const c = r.ctx, cx = x - (T.x0 - 2), cy = y - (T.c0 ?? T.y0 + 1), l = Math.round(a.x - t / 2), top = Math.round(a.y - t / 2), h = Math.round(t * CAB_LIFT), ox = T.id === 1 ? 0 : 64, band = T.id === 1 ? 0 : 2;
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(ATLAS.cab, ox + cx * 32, cy * 32, 32, 32, l, top - h, t, t);
  if (cy === 2) c.drawImage(ATLAS.cab, cx * 32, 96 + 16 * band, 32, 16, l, top - h + t, t, h);
  c.restore();
  darkWall(r, x, y, {left: l, top: top - h, width: t, height: t + (cy === 2 ? h : 0)});
}

// 煙霧（Alan 2026-10-09）：每台車後面（右邊）兩道揚起的沙塵、車頭冒的排氣，往右飄散變淡。只是畫面，照時間算，不存
function smoke(r, o, time) {
  const c = r.ctx, t = r.tile, s = time / 1000, puff = (x, y, rad, color) => { const p = r.project(x, y); c.fillStyle = color; c.beginPath(); c.arc(p.x, p.y, rad, 0, Math.PI * 2); c.fill(); };
  c.save();
  for (const T of o.trucks) {
    const small = T.kind && T.kind !== 'truck';
    for (const [k, y0] of small ? [[0, T.y0 + T.w / 2 - .5]] : [[0, T.y0 - .15], [1, T.y0 + T.w - .7]]) for (let i = 0; i < (small ? 7 : 12); i++) {
      const ph = (s * 1.8 + i / 12 + T.id * .37 + k * .5) % 1;
      puff(T.x1 + .3 + ph * 7, y0 + Math.sin(i * 7.3 + T.id + k) * .3 - ph * .25, (.25 + ph * 1.2) * t, `rgba(206,182,132,${(.32 * (1 - ph)).toFixed(3)})`);
    }
    if (T.kind === 'truck') for (let i = 0; i < 8; i++) {   // 排氣：只有卡車的車頭有
      const ph = (s * 1.3 + i / 8 + T.id * .21) % 1;
      puff(T.x0 - 1.2 + ph * 3.8, (T.c0 ?? T.y0) - .55 - ph * .7, (.12 + ph * .55) * t, `rgba(58,56,54,${(.42 * (1 - ph)).toFixed(3)})`);
    }
  }
  c.restore();
}

export function installOutdoor(renderer) {
  registerStyles();
  if (renderer?.terrainImages) for (const u of Object.values(URL)) if (!renderer.terrainImages.has(u)) renderer.terrainImages.set(u, img(u));
  const R = Renderer.prototype, terrain = R.terrain, wall = R.wall, exit = R.exit;
  R.terrain = function (role, a, point, size = Math.round(this.tile), rotation = 0) {
    const o = this.game?.chimeraOutdoor;
    if (o?.deck && role === 'floor' && point && ready(ATLAS.truck)) { highwayFloor(this, o, point, a, size); this.terrainReady = true; return true; }
    if (o && role === 'floor' && point && ready(ATLAS.ground)) {
      const lv = o.trench?.[point.y]?.[point.x] || 0;
      if (!lv || !ready(ATLAS.trench)) blit(this.ctx, ATLAS.ground, o.ground[point.y]?.[point.x] ?? 0, a.x, a.y, size);
      else {
        const c = this.ctx, t = size, l = Math.round(a.x - t / 2), tp = Math.round(a.y - t / 2), depth = TRENCH_DEPTH[lv];
        const at = (dx, dy) => TRENCH_DEPTH[o.trench[point.y + dy]?.[point.x + dx] || 0];
        blit(c, ATLAS.trench, lv === 2 ? 12 : 13, a.x, a.y, t);   // 溝底
        c.save(); c.fillStyle = `rgba(0,0,0,${lv === 2 ? .3 : .15})`; c.fillRect(l, tp, t, t);
        // 北側的斷面：比北邊那一格深多少，就露出多高
        const h = Math.round(Math.max(0, depth - at(0, -1)) * t);
        if (h > 0) { const face = o.layout === 'trench' && lv === 2 ? 4 : CUT[o.biome] ?? 3, n = face; c.imageSmoothingEnabled = false;
          c.drawImage(ATLAS.trench, (n % 4) * 32, Math.floor(n / 4) * 32 + 32 - Math.round(32 * h / t), 32, Math.round(32 * h / t), l, tp, t, h);
          c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(l, tp + h - Math.max(1, Math.round(t * .04)), t, Math.max(1, Math.round(t * .04))); }
        // 東西兩側比較淺：溝緣的陰影
        const e = Math.max(2, Math.round(t * .07)); c.fillStyle = 'rgba(20,14,8,.55)';
        if (at(-1, 0) < depth) c.fillRect(l, tp, e, t); if (at(1, 0) < depth) c.fillRect(l + t - e, tp, e, t);
        c.restore();
      }
      this.terrainReady = true; return true;
    }
    return terrain.call(this, role, a, point, size, rotation);
  };
  R.wall = function (a, x, y) {
    if (!this.game?.chimeraOutdoor) return wall.call(this, a, x, y);
    const t = Math.round(this.tile);
    if (this.game.chimeraOutdoor.deck && !edge(x, y) && ready(ATLAS.truck)) { cab(this, this.game.chimeraOutdoor, x, y, a, t); return null; }
    if (this.game.chimeraOutdoor.deck && edge(x, y) && ready(ATLAS.truck)) { road(this, this.game.chimeraOutdoor, {x, y}, a, t); darkWall(this, x, y, {left: Math.round(a.x - t / 2), top: Math.round(a.y - t / 2), width: t, height: t}); return null; }
    if (edge(x, y) && ready(ATLAS.walls)) { blit(this.ctx, ATLAS.walls, HAZE, a.x, a.y, t); darkWall(this, x, y, {left: Math.round(a.x - t / 2), top: Math.round(a.y - t / 2), width: t, height: t}); return null; }
    const q = wall.call(this, a, x, y);
    if (q) darkWall(this, x, y, {left: q.left, top: q.capTop, width: q.width, height: q.bottom - q.capTop});
    return q;
  };
  // 溝緣擋住溝裡的人（Alan 2026-10-09：敵人下沉了但沒有被蓋住）：人往下畫之後下半身會伸出自己那一格，
  // 畫人的時候裁到南邊溝緣的位置為止，伸出去的部分就像被溝緣擋住
  const sunk = (r, e) => { const lv = e && r.game?.chimeraOutdoor?.trench?.[e.y]?.[e.x]; return lv ? TRENCH_DEPTH[lv] : 0; };
  // 裁到南邊溝緣，再整個往下移 d 格來畫：ASH 用傳進去的位置判斷明暗（unproject）、對倒地動畫，所以傳原本那一格的位置，下沉只靠平移
  const sunken = (r, e, d, draw) => {
    const o = r.game.chimeraOutdoor, c = r.ctx, y = r.project(e.x, e.y).y;
    // 南邊那一格一樣深就不用擋（溝裡連著的格子），比較淺就擋到它的溝底那麼深為止
    const b = y + r.tile * (.5 + Math.min(d, TRENCH_DEPTH[o.trench[e.y + 1]?.[e.x] || 0]));
    c.save(); c.beginPath(); c.rect(-1e4, -1e4, 2e4, b + 1e4); c.clip(); c.translate(0, Math.round(d * r.tile));
    r.chimeraSunk = (r.chimeraSunk || 0) + 1;
    try { return draw(); } finally { r.chimeraSunk--; c.restore(); }
  };
  const up = (r, a, d) => ({...a, y: a.y - Math.round(d * r.tile)});
  const actor = R.actor;
  R.actor = function (a, type, time, e, ...rest) {
    const d = sunk(this, e);
    if (!d || this.chimeraSunk) return actor.call(this, a, type, time, e, ...rest);
    return sunken(this, e, d, () => actor.call(this, up(this, a, d), type, time, e, ...rest));   // a 是 projectActor 下沉過的
  };
  // 屍體也一樣（Alan 2026-10-09）：敵人的屍體 ASH 用 project 畫（沒經過 projectActor）；隊員的屍體已經用 projectActor 往下移過，
  // 從位置找回是哪一個人。轉角度時 ASH 會在 (0,0) 再呼叫一次自己，那次已經在平移裡面，不用管
  const corpse = R.corpse;
  R.corpse = function (a, type, character, dead, ...rest) {
    const g = this.game;
    if (!g?.chimeraOutdoor?.trench || this.chimeraSunk) return corpse.call(this, a, type, character, dead, ...rest);
    if (dead) { const d = sunk(this, dead); return d ? sunken(this, dead, d, () => corpse.call(this, a, type, character, dead, ...rest)) : corpse.call(this, a, type, character, dead, ...rest); }
    const m = (g.members || [g.player]).find(m => m?.hp <= 0 && sunk(this, m) && (q => Math.abs(q.x - a.x) < 1 && Math.abs(q.y - a.y) < 1)(this.projectActor(m)));
    if (!m) return corpse.call(this, a, type, character, dead, ...rest);
    const d = sunk(this, m);
    return sunken(this, m, d, () => corpse.call(this, up(this, a, d), type, character, dead, ...rest));
  };
  // 隊長陣亡的倒地動畫（kia-art 的 drawKiaBody，不經過 actor／corpse，直接畫 classSprite）：陣亡那一刻在溝裡就一樣裁切
  const classSprite = R.classSprite;
  R.classSprite = function (a, ...rest) {
    const p = this.game?.player, d = !this.chimeraSunk && this.kia && p?.hp <= 0 && sunk(this, p);
    if (!d) return classSprite.call(this, a, ...rest);
    // 倒地時會在平移旋轉裡用 (0,0) 畫：換回畫面座標（Renderer.draw 的基本變換是 dpr 縮放加畫面晃動 shift）
    const c = this.ctx, m = c.getTransform(), k = this.dpr || 1, sx = k * (this.shift?.x || 0), sy = k * (this.shift?.y || 0);
    const q = {x: (m.a * a.x + m.c * a.y + m.e - sx) / k, y: (m.b * a.x + m.d * a.y + m.f - sy) / k};
    const o = this.projectActor(p); if (Math.abs(q.x - o.x) > this.tile || Math.abs(q.y - o.y) > this.tile) return classSprite.call(this, a, ...rest);
    const y = this.project(p.x, p.y).y, b = y + this.tile * (.5 + Math.min(d, TRENCH_DEPTH[this.game.chimeraOutdoor.trench[p.y + 1]?.[p.x] || 0]));
    c.save(); c.setTransform(k, 0, 0, k, sx, sy); c.beginPath(); c.rect(-1e4, -1e4, 2e4, b + 1e4); c.setTransform(m); c.clip();
    try { return classSprite.call(this, a, ...rest); } finally { c.restore(); }
  };
  const drawWalls = R.drawWalls;
  R.drawWalls = function (cells, ...rest) {
    const r = drawWalls.call(this, cells, ...rest), o = this.game?.chimeraOutdoor;
    if (o?.deck) smoke(this, o, this.time || performance.now());
    return r;
  };
  // 站在戰壕裡的人跟著溝底往下畫
  const project = R.projectActor;
  R.projectActor = function (actor) {
    const p = project.call(this, actor), o = this.game?.chimeraOutdoor, lv = o?.trench?.[actor?.y]?.[actor?.x];
    return lv ? {...p, y: p.y + TRENCH_DEPTH[lv] * this.tile} : p;
  };
  // 遺產級（頭目戰死掉在地上的）：金色光柱＋字（Alan 2026-10-09）
  const item = R.item;
  R.item = function (a, it, time) {
    if (it?.type !== 'chimera_legacy') return item.call(this, a, it, time);
    const t = this.tile, k = .5 + .5 * Math.sin(time / 260);
    this.glow(a.x, a.y, t * .8, `rgba(255,205,90,${.3 + .25 * k})`);
    const c = this.ctx; c.save(); c.fillStyle = '#ffd36a'; c.fillRect(Math.round(a.x - t * .22), Math.round(a.y - t * .06), Math.round(t * .44), Math.max(2, Math.round(t * .12))); c.restore();
    this.text('遺產', a.x, a.y - t * .28, '#ffe39a', 10);
  };
  // 武裝車：先在借來的砲塔圖底下畫一塊裝甲車身（之後換成自己的圖）
  const actorDraw = R.actor;
  R.actor = function (a, type, time, e, ...rest) {
    if (type === 'chimera_armor' && e?.hp > 0) {
      const c = this.ctx, t = this.tile, w = t * .96, h = t * .62, x = Math.round(a.x - w / 2), y = Math.round(a.y - h / 2 + t * .12);
      c.save(); c.fillStyle = '#3c4234'; c.fillRect(x, y, Math.round(w), Math.round(h)); c.fillStyle = '#5b6450'; c.fillRect(x + 2, y + 2, Math.round(w) - 4, Math.round(h * .35));
      c.fillStyle = '#1b1d18'; for (const dx of [.18, .82]) { c.fillRect(Math.round(x + w * dx - t * .09), y + Math.round(h) - 2, Math.round(t * .18), Math.max(3, Math.round(t * .1))); }
      c.fillStyle = '#9fb3c8aa'; c.fillRect(Math.round(x + w * .62), y + 3, Math.round(w * .28), Math.max(2, Math.round(h * .18))); c.restore();
    }
    return actorDraw.call(this, a, type, time, e, ...rest);
  };
  R.exit = function (a, time) {
    const o = this.game?.chimeraOutdoor;
    if (o) { if (o.goal !== 'exit') return; const t = this.tile, k = .5 + .5 * Math.sin(time / 300); this.glow(a.x, a.y, t * .9, `rgba(110,220,140,${.25 + .2 * k})`); this.text('撤離', a.x, a.y + 4, '#9ff0b4', 10); return; }
    return exit.call(this, a, time);
  };
}
