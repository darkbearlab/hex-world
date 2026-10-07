// 各種戰場樣子跑一輪：勝率、回合數、每場花多久（看大戰場跑不跑得動）
// 用法：node warband/test/layout-sim.mjs [每種幾場]
import {CLASSES} from '../public/js/data.js';
import * as B from '../public/js/battle.js';
let nid = 0;
const mk = (cls, lvl = 1, extra = {}) => { const c = CLASSES[cls], b = c.base; return {id: 'u' + (nid++), name: c.name + nid, cls, sprite: c.sprites[0], lvl, exp: 0, hp: b.hp + lvl - 1, max: b.hp + lvl - 1, str: b.str, skl: b.skl, spd: b.spd, def: b.def, mov: b.mov, weapon: c.weapon, eq: c.kit ? Object.fromEntries(Object.entries(c.kit).map(([s, k]) => [s, {id: 'x' + s, b: k, t: 0}])) : undefined, traits: [], loyalty: 60, ...extra}; };
function heroPlan(st) {
  const h = B.hero(st), r = B.reach(st, h), foes = B.living(st, 'enemy'); let best = null;
  for (const [x, y] of r.tiles) for (const t of foes) { const d = Math.abs(x - t.x) + Math.abs(y - t.y), [lo, hi] = B.weaponOfUnit(h).range; if (d < lo || d > hi) continue; const f = B.forecast(st, h, t, x, y); const s = f.aHit * f.aDmg * f.aCount - f.dHit * f.dDmg * f.dCount * 1.5; if (!best || s > best.s) best = {s, to: [x, y], target: t.id}; }
  if (best) return {type: 'hero', to: best.to, act: {kind: 'attack', target: best.target}};
  let to = [h.x, h.y], bs = Infinity; for (const [x, y] of r.tiles) { const de = Math.min(...foes.map(f => Math.abs(f.x - x) + Math.abs(f.y - y))); if (Math.abs(de - 2) < bs) { bs = Math.abs(de - 2); to = [x, y]; } }
  return {type: 'hero', to, act: {kind: 'wait'}};
}
const N = +(process.argv[2] || 30);
const CASES = [
  ['field 4v4', 'field', 'plain', () => [mk('knight', 2, {hero: true}), mk('spearman'), mk('archer'), mk('herbalist')], () => [mk('bandit'), mk('bandit'), mk('cutthroat'), mk('poacher')]],
  ['ambush 4v5', 'ambush', 'forest', () => [mk('knight', 2, {hero: true}), mk('spearman'), mk('archer'), mk('herbalist')], () => [mk('bandit'), mk('bandit'), mk('cutthroat'), mk('poacher'), mk('bandit')]],
  ['night 4v5', 'night', 'plain', () => [mk('knight', 2, {hero: true}), mk('spearman'), mk('archer'), mk('herbalist')], () => [mk('bandit'), mk('bandit'), mk('cutthroat'), mk('poacher'), mk('bandit')]],
  ['caravan 4v5', 'caravan', 'plain', () => [mk('knight', 2, {hero: true}), mk('spearman'), mk('archer'), mk('herbalist')], () => [mk('swordsman', 2, {leader: true}), mk('spearman'), mk('archer'), mk('spearman'), mk('swordsman')]],
  ['fort 6v6', 'fort', 'camp', () => [mk('knight', 3, {hero: true}), mk('spearman', 2), mk('archer', 2), mk('herbalist', 2), mk('axeman', 2), mk('swordsman', 2)], () => [mk('chief', 3, {leader: true}), mk('bandit', 2), mk('bandit', 2), mk('cutthroat', 2), mk('poacher', 2), mk('bandit', 2)]],
  ['scatter 4v3 wolves', 'scatter', 'forest', () => [mk('knight', 2, {hero: true}), mk('spearman'), mk('archer'), mk('herbalist')], () => [mk('wolf'), mk('wolf'), mk('wolf')]],
  ['duel', 'duel', 'plain', () => [mk('knight', 2, {hero: true})], () => [mk('chief', 2, {leader: true})]],
  ['mounted field 4v4', 'field', 'plain', () => [mk('knight', 2, {hero: true, mounted: true}), mk('spearman', 1, {mounted: true}), mk('archer', 1, {mounted: true}), mk('herbalist', 1, {mounted: true})], () => [mk('bandit'), mk('bandit'), mk('cutthroat'), mk('poacher')]],
  ['big 16v18', 'field', 'plain', () => [mk('knight', 4, {hero: true}), ...Array.from({length: 15}, (_, i) => mk(['spearman', 'archer', 'swordsman', 'axeman', 'herbalist'][i % 5], 3))], () => Array.from({length: 18}, (_, i) => mk(['bandit', 'cutthroat', 'poacher'][i % 3], 3, {leader: i === 0}))],
];
for (const [name, layout, biome, P, F] of CASES) {
  let win = 0, turns = 0, ms = 0, size = '', maxMs = 0;
  for (let s = 0; s < N; s++) {
    nid = 0; const t0 = performance.now();
    const st = B.createBattle({seed: s, biome, party: P(), foes: F(), layout, order: {stance: 'follow'}}); size = `${st.W}×${st.H}`;
    let g = 0; while (!st.result && g++ < 40) B.act(st, heroPlan(st));
    const dt = performance.now() - t0; ms += dt; maxMs = Math.max(maxMs, dt); if (st.result === 'win') win++; turns += st.turn;
  }
  console.log(`${name.padEnd(20)} ${size.padEnd(6)} 勝 ${Math.round(win / N * 100)}%  平均 ${(turns / N).toFixed(1)} 回合  每場 ${Math.round(ms / N)}ms（最久 ${Math.round(maxMs)}ms）`);
}
