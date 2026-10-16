// PVP 地圖上 ASH 沒有的東西的畫法：戰壕（地圖第二版第二步）、中央的三倍傷害。
// 戰壕：奇美拉的戰壕是戶外地圖的材質（chimera-outdoor-render.js），室內另外畫——
// 地板畫完之後（人還沒畫），在有戰壕的格子上蓋一層凹下去的溝：半身深淺一點、全身深暗一點，靠平地的那一邊畫一道沙包護緣。
// 只畫看過的格子（伺服器送的 pvpTrench 本來就只有看過的）。
export function installTrenchRender(renderer) {
  const orig = renderer.drawGround.bind(renderer);
  renderer.drawGround = function (time) {
    const cells = orig(time), g = this.game, D = g?.pvpTrench;
    const c = this.ctx, t = this.tile, half = t / 2;
    if (D) for (let y = 0; y < D.length; y++) for (let x = 0; x < D.length; x++) {
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
    // 佔領點（佔領模式）：地上一圈＋分數；我方站著青色、對方站著紅色、沒人灰白。沒看過的地方也畫（點的位置和歸屬雙方都知道）
    if (g?.captureOn) for (const pt of g.pvpPoints || []) {
      const a = this.project(pt.x, pt.y); if (a.x < -t || a.y < -t || a.x > this.w + t || a.y > this.h + t) continue;
      // 觀戰（沒有 pvpSide）：A 隊青色、B 隊紅色
      const mine = pt.holder && (g.pvpSide ? pt.holder === g.pvpSide : pt.holder === 'A'), col = !pt.holder ? '#d9e5df' : mine ? '#5fd3e0' : '#ff6a5a';
      c.save(); c.strokeStyle = col; c.lineWidth = Math.max(2, t * .09); c.globalAlpha = .9;
      c.beginPath(); c.arc(a.x, a.y, t * .42, 0, 7); c.stroke();
      c.globalAlpha = .25; c.fillStyle = col; c.beginPath(); c.arc(a.x, a.y, t * .42, 0, 7); c.fill();
      // 分數寫在圈中間（夠大才看得清楚；黑邊讓它壓在地板、人身上也看得到）
      // 觀戰：兩邊各值幾分都寫（A 這側的點：A 1、B 2）
      const label = !g.pvpSide && pt.half ? (pt.half === 'A' ? 'A1 B2' : 'A2 B1') : String(pt.value ?? (pt.half && g.pvpSide && pt.half !== g.pvpSide ? 2 : 1));
      c.globalAlpha = 1; c.font = `bold ${Math.max(10, Math.round(t * (label.length > 2 ? .3 : .6)))}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = Math.max(2, t * .12); c.strokeStyle = '#000000cc'; c.strokeText(label, a.x, a.y + 1); c.fillStyle = col; c.fillText(label, a.x, a.y + 1);
      c.restore();
    }
    return cells;
  };
  // 中央的三倍傷害（pvp_power）：ASH 標題的標誌（assets/icon.svg、標題畫面的 title-mark）浮在空中轉——Alan 2026-10-16：像 Quake 的四倍傷害用 Quake 的標誌。
  // 接手 ASH 畫地上物品的那一步（不然它會把不認得的東西畫成「?」方塊）
  const item = renderer.item.bind(renderer);
  // 地上物品是畫在快取的那一層（不是每格重畫），會轉的標誌要在每格畫完之後另外疊上去
  renderer.item = function (a, it, time) { if (it?.type === 'pvp_power') return; return item(a, it, time); };
  const draw = renderer.draw.bind(renderer);
  renderer.draw = function (...args) {
    const out = draw(...args), g = this.game, c = this.ctx;
    for (const it of g?.items || []) {
      if (it.type !== 'pvp_power' || !g.mapped?.(it.x, it.y)) continue;
      c.save(); c.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0); drawPower(c, this.project(it.x, it.y), this.tile, this.time || 0); c.restore();
    }
    return out;
  };
}


// ASH 的標誌（assets/icon.svg 的兩條路徑，128×128）：橙色的 A 字、白色的小三角
const MARK = typeof Path2D === 'function' ? [new Path2D('M23 99 58 24h15l34 75H85L65 50 44 99Z'), new Path2D('m56 85 9-21 9 21Z')] : null;
// 繞直軸轉（橫向縮放＝cos，轉到背面變暗）、上下浮、外圍一圈脈動的光、地上一個影子
function drawPower(c, a, t, time) {
  if (!MARK) return;
  const bob = Math.sin(time / 380) * t * .06, spin = Math.cos(time / 600), pulse = .55 + .45 * Math.sin(time / 200), cx = a.x, cy = a.y - t * .14 + bob, size = t * 1.0;
  c.save();
  c.globalAlpha = .35; c.fillStyle = '#000'; c.beginPath(); c.ellipse(a.x, a.y + t * .32, t * .22 - bob * .5, t * .07, 0, 0, 7); c.fill();
  const glow = c.createRadialGradient(cx, cy, size * .1, cx, cy, size * .75);
  glow.addColorStop(0, `rgba(250,140,75,${.8 * pulse})`); glow.addColorStop(1, 'rgba(250,140,75,0)');
  c.globalAlpha = 1; c.fillStyle = glow; c.beginPath(); c.arc(cx, cy, size * .75, 0, 7); c.fill();
  c.translate(cx, cy); c.scale(Math.max(.06, Math.abs(spin)) * size / 128, size / 128); c.translate(-64, -62);
  const back = spin < 0;
  c.shadowColor = '#fa8c4b'; c.shadowBlur = 16 * pulse;
  c.fillStyle = back ? '#a8582c' : '#fa8c4b'; c.fill(MARK[0]);
  c.shadowBlur = 0; c.fillStyle = back ? '#8fa29a' : '#d9e5df'; c.fill(MARK[1]);
  c.restore();
}
