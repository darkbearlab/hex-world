// 奇美拉：戶外戰鬥的畫法（chimera-outdoor.js 產生的地圖）。不改 ASH 的檔案，只包住 Renderer.prototype 的幾個方法：
//   - terrain('floor')：照 game.chimeraOutdoor.ground 畫地面圖集（/ash-outdoor/ground.png，4×4、每格 32）
//   - wall()：牆格（巨石、柵欄、車殼、帳棚⋯）照 wallArt 畫物件圖集，不畫設施的高牆
//   - prop()：掩體（chimeraArt）畫物件圖集
//   - exit()：撤離點畫成綠色的信號煙（行軍遇襲才用得到）
// 圖還沒載好時照 ASH 原本的畫法。
import {Renderer} from './renderer.js';

const img = src => { const i = new Image(); i.src = src; return i; };
const ATLAS = {ground: img('/ash-outdoor/ground.png'), props: img('/ash-outdoor/props.png')};
const ready = i => i.complete && i.naturalWidth > 0;
function blit(c, atlas, n, cx, cy, size) {
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(atlas, (n % 4) * 32, Math.floor(n / 4) * 32, 32, 32, Math.round(cx - size / 2), Math.round(cy - size / 2), size, size);
  c.restore();
}

export function installOutdoor() {
  const R = Renderer.prototype, terrain = R.terrain, wall = R.wall, prop = R.prop, exit = R.exit;
  R.terrain = function (role, a, point, size = Math.round(this.tile), rotation = 0) {
    const o = this.game?.chimeraOutdoor;
    if (o && role === 'floor' && point && ready(ATLAS.ground)) { blit(this.ctx, ATLAS.ground, o.ground[point.y]?.[point.x] ?? 0, a.x, a.y, size); this.terrainReady = true; return true; }
    return terrain.call(this, role, a, point, size, rotation);
  };
  R.wall = function (a, x, y) {
    const o = this.game?.chimeraOutdoor;
    if (o && ready(ATLAS.props)) {
      const c = this.ctx, t = this.tile; c.fillStyle = '#1a1712'; c.globalAlpha *= .55; c.fillRect(Math.round(a.x - t / 2), Math.round(a.y - t / 2), Math.ceil(t), Math.ceil(t)); c.globalAlpha /= .55;
      blit(c, ATLAS.props, o.wallArt[y]?.[x] ?? 3, a.x, a.y, Math.round(t)); return null;
    }
    return wall.call(this, a, x, y);
  };
  R.prop = function (a, p, time) {
    if (this.game?.chimeraOutdoor && p.chimeraArt != null && ready(ATLAS.props)) {
      blit(this.ctx, ATLAS.props, p.chimeraArt, a.x, a.y, Math.round(this.tile));
      if (p.hp < p.maxHp && p.hp > 0) this.objectHealth?.(p, a.x - 12, a.y - this.tile * .4);
      return;
    }
    return prop.call(this, a, p, time);
  };
  R.exit = function (a, time) {
    const o = this.game?.chimeraOutdoor;
    if (o) { if (o.goal !== 'exit') return; const t = this.tile, k = .5 + .5 * Math.sin(time / 300); this.glow(a.x, a.y, t * .9, `rgba(110,220,140,${.25 + .2 * k})`); this.text('撤離', a.x, a.y + 4, '#9ff0b4', 10); return; }
    return exit.call(this, a, time);
  };
}
