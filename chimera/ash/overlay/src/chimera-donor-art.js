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
// 那半張（左＝站著、右＝倒地）有沒有畫：整片透明就當作沒畫，照舊用職業圖
const drawn = new WeakMap();
function hasHalf(im, dead) {
  let o = drawn.get(im); if (!o) drawn.set(im, o = {});
  if (o[dead] !== undefined) return o[dead];
  let any = false; try { const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32; const x = cv.getContext('2d'); x.drawImage(im, dead ? 32 : 0, 0, 32, 32, 0, 0, 32, 32);
    const d = x.getImageData(0, 0, 32, 32).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) { any = true; break; } } catch { any = true; }
  return o[dead] = any;
}
// 倒地的血（Alan 2026-10-12：倒地圖要隨機沾上一些血肉的粒子）：每個人照自己的編號擲，幾團深淺不一的紅，只沾在身體的像素上
const BLOOD = ['#4a0b0e', '#6e1416', '#8f1d1b', '#b02a22'], blood = new Map();
function bloodOf(im, key) {
  const k = key + '|' + im.src; if (blood.has(k)) return blood.get(k);
  let cv = null; try {
    const src = document.createElement('canvas'); src.width = 32; src.height = 32; const sx = src.getContext('2d'); sx.drawImage(im, 32, 0, 32, 32, 0, 0, 32, 32);
    const a = sx.getImageData(0, 0, 32, 32).data, body = []; for (let i = 0; i < 1024; i++) if (a[i * 4 + 3] > 128) body.push(i);
    let h = 2166136261; for (const ch of String(key)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
    cv = document.createElement('canvas'); cv.width = 32; cv.height = 32; const x = cv.getContext('2d'), on = new Set(body);
    const clusters = 3 + Math.floor(rnd() * 4);
    for (let c = 0; c < clusters && body.length; c++) { const at = body[Math.floor(rnd() * body.length)], cx = at % 32, cy = at >> 5, r = 1 + rnd() * 2.2;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const px = cx + dx, py = cy + dy, d = Math.hypot(dx, dy);
        if (px < 0 || py < 0 || px > 31 || py > 31 || !on.has(py * 32 + px) || d > r || rnd() > 1 - d / (r + 1.2)) continue;
        x.fillStyle = BLOOD[Math.min(3, Math.floor(rnd() * 2 + (d < 1 ? 0 : 1) + rnd()))]; x.fillRect(px, py, 1, 1); } }
    for (let i = 0; i < 4 + Math.floor(rnd() * 6) && body.length; i++) { const at = body[Math.floor(rnd() * body.length)]; x.fillStyle = BLOOD[Math.floor(rnd() * 4)]; x.fillRect(at % 32, at >> 5, 1, 1); }   // 零星的濺點
  } catch { cv = null; }
  blood.set(k, cv); return cv;
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
  if (!im || !hasHalf(im, !!dead)) return classSprite.call(this, a, size, character, dead, dark, tint);   // 那半張空著就照舊用職業圖（Alan 2026-10-12：有的人只有倒地圖、有的只有站姿）
  const c = this.ctx, src = dark && this.darkActors ? this.darkActors.get(im) : im;
  c.drawImage(src, dead ? 32 : 0, 0, 32, 32, Math.round(a.x - size / 2), Math.round(a.y - size / 2), size, size);
  if (dead) { const u = this.chimeraUnit, b = bloodOf(im, u?.id || u?.squadId || u?.callName || 'x'); if (b) { c.save(); if (dark && this.darkActors) c.globalAlpha = .55; c.imageSmoothingEnabled = false; c.drawImage(b, 0, 0, 32, 32, Math.round(a.x - size / 2), Math.round(a.y - size / 2), size, size); c.restore(); } }
  return true;
};
