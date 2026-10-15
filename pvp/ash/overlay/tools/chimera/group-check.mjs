// 據點群（Alan 2026-10-11：50×50 的敵人要有小隊、有攻勢）：50×50 的戶外戰場，敵人照區塊一隊一隊放（守備、巡邏、預備、側襲），
// 巡邏隊會沿路線走，有一隊發現你之後預備隊、側襲隊會動起來，增援整隊從集結點進來。27×27 不受影響。
// node tools/chimera/group-check.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {distance} from '../../src/world.js';
const squad = [['A', 'soldier'], ['B', 'recon'], ['C', 'bulwark'], ['D', 'berserker']].map(([id, cls]) => ({id, cls, st: {hp: 100}, lv: 1}));
const rows = []; let bad = 0;
for (const type of ['probe', 'assault', 'sabotage', 'barricade', 'clear']) for (const seed of [1, 2, 3]) {
  const units = {trooper: 30, trooper_heavy: 8, shotgunner: 6, leader: 4};
  const g = new SquadGame({seed, faction: 'loyalist', type, size: 50, biome: '旱原', night: false, enemy: {units, veh: {}, boss: null}, squad});
  const o = g.chimeraOutdoor, G = o.groups || [], by = r => g.enemies.filter(e => e.hp > 0 && G[e.chimeraG]?.role === r).length;
  const placed = {guard: by('guard'), patrol: by('patrol'), reserve: by('reserve'), flank: by('flank')}, waves = o.waves?.length || 0;
  // 巡邏：站著不動（等待）10 回合，巡邏隊要離開起點
  const pat = g.enemies.filter(e => G[e.chimeraG]?.role === 'patrol'), p0 = pat.map(e => ({x: e.x, y: e.y}));
  for (let i = 0; i < 10 && g.status === 'playing'; i++) g.action('wait');
  const patMoved = pat.some((e, i) => distance(e, p0[i]) > 2);
  // 警報：前線據點的一個人發現你；預備隊要動、朝你靠近
  const res = g.enemies.filter(e => G[e.chimeraG]?.role === 'reserve'), d0 = res.map(e => distance(e, g.player));
  const guard = g.enemies.find(e => G[e.chimeraG]?.role === 'guard' && e.hp > 0); if (guard) { guard.alert = true; guard.lastKnown = {x: g.player.x, y: g.player.y}; }
  for (let i = 0; i < 8 && g.status === 'playing'; i++) g.action('wait');
  const resCloser = res.some((e, i) => e.hp > 0 && distance(e, g.player) < d0[i] - 3), reserveOn = G.some(gr => gr.role === 'reserve' && gr.active);
  // 增援：殺掉一大半，增援要整隊從集結點進來
  for (const e of g.enemies.slice(0, Math.floor(g.enemies.length * .8))) e.hp = 0;
  const w0 = o.waves.length; for (let i = 0; i < 7 && g.status === 'playing'; i++) g.action('wait');
  const waveIn = w0 - o.waves.length;
  const ok = G.length >= 6 && placed.guard >= 8 && placed.patrol >= 3 && placed.reserve >= 3 && patMoved && reserveOn && resCloser && (!w0 || waveIn >= 3);
  if (!ok) bad++;
  rows.push({type, seed, groups: G.length, ...placed, waves, patMoved, reserveOn, resCloser, waveIn, status: g.status, ok});
}
// 27×27 照舊：沒有據點群
const g27 = new SquadGame({seed: 1, faction: 'loyalist', type: 'probe', size: 27, biome: '旱原', night: false, enemy: {units: {trooper: 10}, veh: {}, boss: null}, squad});
const ok27 = !g27.chimeraOutdoor.groups && g27.enemies.length > 0; if (!ok27) bad++;
console.table(rows); console.log('27×27 沒有據點群：', ok27);
console.log(bad ? `有 ${bad} 項不對` : '全部正常');
process.exit(bad ? 1 : 0);
