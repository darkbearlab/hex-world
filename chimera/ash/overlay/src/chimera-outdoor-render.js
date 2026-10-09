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

const URL = {ground: '/ash-outdoor/ground.png', walls: '/ash-outdoor/walls.png'};
const img = src => { const i = new Image(); i.src = src; return i; };
const ATLAS = {ground: img(URL.ground), walls: img(URL.walls)};
const ready = i => i.complete && i.naturalWidth > 0;
// walls.png 的格子：牆面 0～3（磚、土坯、石、廢鐵）、牆頂 4～7、木柵面 8／頂 9、鐵皮面 10／頂 11、邊緣塵霧 12、沙包面 13／頂 14、瓦礫 15
const WALL = {brick: 0, adobe: 1, stone: 2, scrap: 3}, LOW = {palisade: 8, fence: 10}, HAZE = 12;
const W = index => ({url: URL.walls, index}), T = index => ({url: TERRAIN_ATLAS, index});
function registerStyles() {
  const facility = MAP_STYLES.facility;
  for (const [wall, wi] of Object.entries(WALL)) for (const [low, li] of Object.entries(LOW)) MAP_STYLES[`chimera-${wall}-${low}`] = {themes: facility.themes, selection: facility.selection,
    materials: {floor: W(15), face: W(wi), cap: W(wi + 4), partitionFace: W(wi), partitionCap: W(wi + 4), lowFace: W(li), lowCap: W(li + 1), cover: T(10), barrel: T(11), terminal: T(12), case: T(13), grate: T(1)}};
}
function blit(c, atlas, n, cx, cy, size) {
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(atlas, (n % 4) * 32, Math.floor(n / 4) * 32, 32, 32, Math.round(cx - size / 2), Math.round(cy - size / 2), size, size);
  c.restore();
}
const edge = (x, y) => x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1;

export function installOutdoor(renderer) {
  registerStyles();
  if (renderer?.terrainImages) for (const u of Object.values(URL)) if (!renderer.terrainImages.has(u)) renderer.terrainImages.set(u, img(u));
  const R = Renderer.prototype, terrain = R.terrain, wall = R.wall, exit = R.exit;
  R.terrain = function (role, a, point, size = Math.round(this.tile), rotation = 0) {
    const o = this.game?.chimeraOutdoor;
    if (o && role === 'floor' && point && ready(ATLAS.ground)) {
      blit(this.ctx, ATLAS.ground, o.ground[point.y]?.[point.x] ?? 0, a.x, a.y, size);
      const lv = o.trench?.[point.y]?.[point.x];   // 戰壕：全身格暗、半身格淡一點，四周畫溝緣
      if (lv) { const c = this.ctx, t = size, l = Math.round(a.x - t / 2), tp = Math.round(a.y - t / 2); c.save(); c.fillStyle = lv === 2 ? 'rgba(0,0,0,.38)' : 'rgba(0,0,0,.18)'; c.fillRect(l, tp, t, t);
        c.fillStyle = lv === 2 ? 'rgba(20,14,8,.7)' : 'rgba(20,14,8,.45)'; const e = Math.max(2, Math.round(t * .08));
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) if ((o.trench[point.y + dy]?.[point.x + dx] || 0) < lv) dy ? c.fillRect(l, dy < 0 ? tp : tp + t - e, t, e) : c.fillRect(dx < 0 ? l : l + t - e, tp, e, t);
        c.restore(); }
      this.terrainReady = true; return true;
    }
    return terrain.call(this, role, a, point, size, rotation);
  };
  R.wall = function (a, x, y) {
    if (this.game?.chimeraOutdoor && edge(x, y) && ready(ATLAS.walls)) { blit(this.ctx, ATLAS.walls, HAZE, a.x, a.y, Math.round(this.tile)); return null; }
    return wall.call(this, a, x, y);
  };
  R.exit = function (a, time) {
    const o = this.game?.chimeraOutdoor;
    if (o) { if (o.goal !== 'exit') return; const t = this.tile, k = .5 + .5 * Math.sin(time / 300); this.glow(a.x, a.y, t * .9, `rgba(110,220,140,${.25 + .2 * k})`); this.text('撤離', a.x, a.y + 4, '#9ff0b4', 10); return; }
    return exit.call(this, a, time);
  };
}
