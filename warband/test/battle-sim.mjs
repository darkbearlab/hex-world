import {CLASSES, hashSeed} from '../public/js/data.js';
import * as B from '../public/js/battle.js';
let nid = 0;
const mk = (cls, lvl = 1, extra = {}) => { const c = CLASSES[cls], b = c.base; return {id: 'u' + (nid++), name: c.name + nid, cls, sprite: c.sprites[0], lvl, exp: 0, hp: b.hp + lvl - 1, max: b.hp + lvl - 1, str: b.str, skl: b.skl, spd: b.spd, def: b.def, mov: b.mov, weapon: c.weapon, eq: c.kit ? Object.fromEntries(Object.entries(c.kit).map(([s, b]) => [s, {id: 'x' + s, b, t: 0}])) : undefined, traits: [], loyalty: 60, ...extra}; };
function heroPlan(st) {
  const h = B.hero(st), r = B.reach(st, h), foes = B.living(st, 'enemy');
  let best = null;
  for (const [x, y] of r.tiles) for (const t of foes) { const d = Math.abs(x - t.x) + Math.abs(y - t.y); if (d !== 1) continue; const f = B.forecast(st, h, t, x, y); const s = f.aHit * f.aDmg * f.aCount - f.dHit * f.dDmg * f.dCount * 1.5; if (!best || s > best.s) best = {s, to: [x, y], target: t.id, f}; }
  // 太危險就不打：血量低時退到同伴身邊
  if (best && !(h.hp < h.max * 0.4 && best.f.dDmg * best.f.dCount >= h.hp)) return {type: 'hero', to: best.to, act: {kind: 'attack', target: best.target}};
  const allies = B.living(st, 'ally').filter(u => !u.hero); let to = [h.x, h.y], bs = Infinity;
  for (const [x, y] of r.tiles) { const de = Math.min(...foes.map(f => Math.abs(f.x - x) + Math.abs(f.y - y))); const da = allies.length ? Math.min(...allies.map(a => Math.abs(a.x - x) + Math.abs(a.y - y))) : 0; const s = h.hp < h.max * 0.4 ? -de + da : Math.abs(de - 3) + da * 0.5; if (s < bs) { bs = s; to = [x, y]; } }
  return {type: 'hero', to, act: {kind: 'wait'}};
}
function run(seed, biome, foesSpec, stance) {
  nid = 0;
  const party = [mk('knight', 2, {hero: true}), mk('spearman'), mk('archer'), mk('herbalist')];
  const foes = foesSpec.map(([c, l, lead]) => mk(c, l, {leader: !!lead}));
  const st = B.createBattle({seed, biome, party, foes, order: {stance, focus: null}});
  let guard = 0;
  while (!st.result && guard++ < 60) B.act(st, heroPlan(st));
  const lost = st.units.filter(u => u.side === 'ally' && !u.alive).length;
  return {result: st.result || 'timeout', turns: st.turn, lost, json: JSON.stringify(st)};
}
// 決定性：同一個種子跑兩次要完全一樣
const a = run(7, 'forest', [['bandit', 1], ['bandit', 1], ['poacher', 1]], 'follow'), b = run(7, 'forest', [['bandit', 1], ['bandit', 1], ['poacher', 1]], 'follow');
console.log('deterministic', a.json === b.json);
const scen = {
  '3 山賊（路上）': ['plain', [['bandit', 1], ['cutthroat', 1], ['poacher', 1]]],
  '狼群': ['forest', [['wolf', 1], ['wolf', 1], ['wolf', 2]]],
  '山寨': ['camp', [['bandit', 1], ['bandit', 2], ['cutthroat', 1], ['poacher', 1], ['chief', 3, 1]]],
  '熊': ['forest', [['bear', 3]]],
};
for (const [name, [biome, foes]] of Object.entries(scen)) for (const stance of ['follow', 'engage', 'hold']) {
  let w = 0, l = 0, t = 0, turns = 0, lost = 0, N = 150;
  for (let s = 0; s < N; s++) { const r = run(hashSeed(name, s), biome, foes, stance); if (r.result === 'win') w++; else if (r.result === 'lose') l++; else t++; turns += r.turns; lost += r.lost; }
  console.log(name.padEnd(10), stance.padEnd(7), `勝 ${(w / N * 100).toFixed(0)}% 敗 ${(l / N * 100).toFixed(0)}% 逾時 ${t}  平均 ${(turns / N).toFixed(1)} 回合  每場陣亡同伴 ${(lost / N).toFixed(2)}`);
}
// 誰最常陣亡
{ const deaths = {}; for (let s = 0; s < 300; s++) { nid = 0; const party = [mk('knight', 2, {hero: true}), mk('spearman'), mk('archer'), mk('herbalist')]; const st = B.createBattle({seed: s, biome: 'plain', party, foes: [['bandit', 1], ['cutthroat', 1], ['poacher', 1]].map(([c, l]) => mk(c, l)), order: {stance: 'follow'}}); let g = 0; while (!st.result && g++ < 60) B.act(st, heroPlan(st)); for (const u of st.units) if (u.side === 'ally' && !u.alive) deaths[u.cls] = (deaths[u.cls] || 0) + 1; } console.log('陣亡統計（300 場路上遭遇）', deaths); }
