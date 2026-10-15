// beta 的地形判斷（地圖第二版）：矮隔板、戰壕、出煙口、鹵素燈。只讀規則公開的東西（地圖上畫得出來的）。
import {barrierBetween} from '../../../src/barriers.js';
import {ventSpraying, ventWarning} from '../../../src/vents.js';
import {activeTrait} from '../../../src/traits.js';
import {dist} from '../../clear-bot/util.mjs';

export const trenchAt = (g, p) => g.pvpTrench?.[p.y]?.[p.x] || 0;
// 這一步會不會露出破綻（到下次行動前被射擊命中 +20）：平地直接跳進全身深、或直接爬出來；翻越矮隔板
export function stepFlaw(g, a, b) {
  if (Math.abs(trenchAt(g, a) - trenchAt(g, b)) >= 2) return 'trench';
  const e = barrierBetween(g.barriers || [], a, b);
  if (e && e.type === 'low_partition' && e.hp > 0) return 'vault';
  return null;
}
// 現在在噴煙（或下一回合就要噴）的出煙口
export const sprayingVents = g => (g.vents || []).filter(v => ventSpraying(v, g.turn));
export const warningVents = g => (g.vents || []).filter(v => ventWarning(v, g.turn));
// 一格在不在煙裡（濃煙擋視線；淡煙命中減半）
export function cloudAt(g, p) {
  for (const s of g.smoke || []) if (s.cells.some(c => c.x === p.x && c.y === p.y)) return s.kind || 'smoke';
  return null;
}
export const hasNV = u => activeTrait(u, 'night_vision') || activeTrait(u, 'infrared');
// 鹵素燈照得到的範圍（亮 2 格、第 3 格昏暗）
export const lampLights = (lamp, p) => dist(lamp, p) <= 3;
