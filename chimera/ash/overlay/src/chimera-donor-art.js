// 奇美拉：每位資料主人（原主）各自的戰場 sprite（Alan 2026-10-10）
// 檔案：/donors/<原主>/sprite.png，64×32、透明底、彩色：左半（0,0）站著、右半（32,0）倒地（照被從左邊打倒的樣子畫，從右邊打倒時 ASH 會左右翻）。
// 有這張圖的人直接畫它、不套操作員顏色（ASH 的職業圖是灰階再上色）；沒有就照舊畫職業圖。
// 有沒有這張圖看部署時產生的素材清單（/asset-manifest.json）。
// 要比 chimera-outdoor-render.js 的戰壕裁切先裝（那邊在外面包一層，這裡在最裡面），所以由它 import。
import {Renderer} from './renderer.js';
const R = Renderer.prototype, cache = new Map();
let have = null;
fetch('/asset-manifest.json', {cache: 'no-cache'}).then(r => r.ok ? r.json() : null).then(d => { have = new Set((d?.items || []).map(x => x.path)); }).catch(() => { have = new Set(); });
export const donorSpritePath = k => `donors/${k}/sprite.png`;
export function donorSprite(u) {
  const k = u?.donor; if (!k || !have?.has(donorSpritePath(k))) return null;
  let im = cache.get(k); if (!im) { im = new Image(); im.src = '/' + donorSpritePath(k); cache.set(k, im); }
  return im.complete && im.naturalWidth ? im : null;
}
// 正在畫哪一個人：actor 的第四個參數；隊長的屍體與戰死演出在 drawActors 裡畫（這時就是 game.player）
const actor = R.actor;
R.actor = function (a, type, time, e, ...rest) {
  const k = this.chimeraUnit; this.chimeraUnit = type === 'player' ? e : null;
  try { return actor.call(this, a, type, time, e, ...rest); } finally { this.chimeraUnit = k; }
};
const drawActors = R.drawActors;
R.drawActors = function (...args) {
  const k = this.chimeraUnit; this.chimeraUnit = this.game?.player || null;
  try { return drawActors.apply(this, args); } finally { this.chimeraUnit = k; }
};
const classSprite = R.classSprite;
R.classSprite = function (a, size, character, dead = false, dark = false, tint = null) {
  const im = tint ? null : donorSprite(this.chimeraUnit);   // 有 tint 的是敵方的除名幹員，照舊
  if (!im) return classSprite.call(this, a, size, character, dead, dark, tint);
  const c = this.ctx, src = dark && this.darkActors ? this.darkActors.get(im) : im;
  c.drawImage(src, dead ? 32 : 0, 0, 32, 32, Math.round(a.x - size / 2), Math.round(a.y - size / 2), size, size);
  return true;
};
