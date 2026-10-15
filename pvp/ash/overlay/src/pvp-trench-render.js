// PVP 室內地圖的戰壕畫法（地圖第二版第二步）：奇美拉的戰壕是戶外地圖的材質（chimera-outdoor-render.js），室內另外畫——
// 地板畫完之後（人還沒畫），在有戰壕的格子上蓋一層凹下去的溝：半身深淺一點、全身深暗一點，靠平地的那一邊畫一道沙包護緣。
// 只畫看過的格子（伺服器送的 pvpTrench 本來就只有看過的）。
export function installTrenchRender(renderer) {
  const orig = renderer.drawGround.bind(renderer);
  renderer.drawGround = function (time) {
    const cells = orig(time), g = this.game, D = g?.pvpTrench;
    if (!D) return cells;
    const c = this.ctx, t = this.tile, half = t / 2;
    for (let y = 0; y < D.length; y++) for (let x = 0; x < D.length; x++) {
      const d = D[y][x]; if (!d || !g.mapped?.(x, y)) continue;
      const a = this.project(x, y), l = a.x - half, top = a.y - half;
      if (l > this.w + t || top > this.h + t || l < -2 * t || top < -2 * t) continue;
      c.save(); c.globalAlpha = g.visibleTiles?.has(`${x},${y}`) ? 1 : .4;
      c.fillStyle = d === 2 ? '#0d1310e6' : '#1a2219c0'; c.fillRect(l + 2, top + 2, t - 4, t - 4);
      // 溝底的陰影：上緣、左緣暗一點，看起來是凹下去的
      c.fillStyle = '#00000066'; c.fillRect(l + 2, top + 2, t - 4, Math.max(2, t * .12)); c.fillRect(l + 2, top + 2, Math.max(2, t * .08), t - 4);
      // 護緣：旁邊不是戰壕的那一邊畫沙包色的邊
      c.fillStyle = '#8a7a52cc';
      const edge = Math.max(2, t * .1);
      if (!(D[y - 1]?.[x])) c.fillRect(l + 1, top + 1, t - 2, edge);
      if (!(D[y + 1]?.[x])) c.fillRect(l + 1, top + t - 1 - edge, t - 2, edge);
      if (!(D[y]?.[x - 1])) c.fillRect(l + 1, top + 1, edge, t - 2);
      if (!(D[y]?.[x + 1])) c.fillRect(l + t - 1 - edge, top + 1, edge, t - 2);
      if (d === 1) { c.fillStyle = '#c8b88040'; for (let i = 1; i <= 2; i++) c.fillRect(l + 6, top + t * i / 3, t - 12, 2); }   // 台階
      c.restore();
    }
    return cells;
  };
}
